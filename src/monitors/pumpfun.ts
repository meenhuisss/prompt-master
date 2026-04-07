/**
 * Pump.fun Monitor — Hoe vindt de bot nieuwe coins?
 *
 * METHODE: Solana WebSocket log subscription
 *
 * Elke transactie op Solana bevat "program logs" — tekstberichten die het
 * smart contract schrijft tijdens uitvoering. Pump.fun schrijft bij elke
 * nieuwe token een "Instruction: Create" log.
 *
 * De bot doet dit:
 *  1. Opent een WebSocket verbinding met Solana (via Helius/QuickNode RPC)
 *  2. Vraagt: "stuur mij ALLE logs van het pump.fun programma"
 *  3. Filtert op "Create" logs → nieuw token gevonden
 *  4. Haalt de mint address op uit de transactie
 *  5. Voert rugchecks uit (zie safety/rugcheck.ts)
 *  6. Koopt als alles veilig is
 *
 * Waarom WebSocket en niet polling?
 *  Polling (elke X seconden checken) is te langzaam — nieuwe tokens
 *  pumpen vaak in de eerste 10-30 seconden. WebSocket geeft push
 *  notificaties zodra de transactie bevestigd is, dus reactietijd < 1s.
 *
 * Waarom Helius/QuickNode?
 *  Standaard Solana RPC (mainnet.solana.com) heeft rate limits en lag.
 *  Helius/QuickNode hebben dedicated nodes met prioriteit → snellere ontvangst.
 */

import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { connection } from '../connection';
import { CONFIG } from '../config';
import { log } from '../utils/logger';
import { hasCapacity } from '../positions';
import { buyOnPumpfun } from '../trading/buyer';
import { runRugcheck } from '../safety/rugcheck';

const PUMPFUN_PROGRAM = new PublicKey(CONFIG.programs.pumpfun);

// Pump.fun bonding curve PDA
export function getBondingCurvePDA(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('bonding-curve'), mint.toBuffer()],
    PUMPFUN_PROGRAM,
  );
  return pda;
}

export function getAssociatedBondingCurve(mint: PublicKey, bondingCurve: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      bondingCurve.toBuffer(),
      new PublicKey(CONFIG.programs.tokenProgram).toBuffer(),
      mint.toBuffer(),
    ],
    new PublicKey(CONFIG.programs.associatedTokenProgram),
  );
  return pda;
}

// Bijhouden welke tokens al gezien zijn (voorkomt dubbele buys)
const seenTokens = new Set<string>();

export function startPumpfunMonitor(): void {
  log.info('Pump.fun monitor gestart — luistert via WebSocket naar nieuwe tokens...');
  log.info(`  Methode: onLogs subscription op ${CONFIG.programs.pumpfun.substring(0, 8)}...`);
  log.info(`  Rugchecks: mint authority, freeze authority, holder concentratie, curve voortgang`);

  connection.onLogs(
    PUMPFUN_PROGRAM,
    async (logInfo) => {
      try {
        const { logs, signature } = logInfo;

        // Stap 1: Is dit een nieuwe token aanmaak?
        // Pump.fun schrijft "Instruction: Create" bij elke nieuwe token
        const isCreate = logs.some(
          (l) =>
            l.includes('Program log: Instruction: Create') ||
            l.includes('CreateEvent')
        );

        if (!isCreate) return;

        // Stap 2: Haal de mint address op uit de transactie
        const result = await extractMintAndCreator(signature);
        if (!result) return;

        const { mint: mintAddress, creator } = result;
        const mintStr = mintAddress.toBase58();

        if (seenTokens.has(mintStr)) return;
        seenTokens.add(mintStr);

        log.info(`🆕 Nieuw Pump.fun token: ${mintStr.substring(0, 8)}... | Creator: ${creator?.toBase58().substring(0, 8) ?? 'onbekend'}`);

        // Stap 3: Capaciteitscheck
        if (!hasCapacity()) {
          log.warn(`Capaciteit vol (${CONFIG.maxOpenPositions} max), token overgeslagen`);
          return;
        }

        // Stap 4: Wacht even tot de bonding curve account aangemaakt is
        await sleep(800);

        // Stap 5: Rugchecks uitvoeren
        const bondingCurve = getBondingCurvePDA(mintAddress);
        const safety = await runRugcheck(mintAddress, bondingCurve, creator ?? undefined);

        if (!safety.safe) {
          log.warn(`[SKIP] ${mintStr.substring(0, 8)} | Score: ${safety.score}/100 | ${safety.reason}`);
          return;
        }

        log.success(`[SAFE] ${mintStr.substring(0, 8)} | Score: ${safety.score}/100 — kopen!`);

        // Stap 6: Kopen
        const associatedBondingCurve = getAssociatedBondingCurve(mintAddress, bondingCurve);
        await buyOnPumpfun(
          mintAddress,
          mintStr.substring(0, 8),
          bondingCurve,
          associatedBondingCurve,
        );

      } catch (err) {
        log.error(`Pump.fun monitor fout: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    'confirmed',
  );
}

interface MintAndCreator {
  mint: PublicKey;
  creator: PublicKey | null;
}

async function extractMintAndCreator(signature: string): Promise<MintAndCreator | null> {
  try {
    await sleep(300);

    const tx = await connection.getParsedTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });

    if (!tx?.meta || !tx.transaction.message.accountKeys) return null;

    // De maker van de transactie is de token creator
    const creator = tx.transaction.message.accountKeys[0]?.pubkey
      ? new PublicKey(tx.transaction.message.accountKeys[0].pubkey.toString())
      : null;

    // Vind de mint uit postTokenBalances
    const postBalances = tx.meta.postTokenBalances ?? [];
    if (postBalances.length === 0) return null;

    // Filter op de juiste mint (niet de SOL wrapped mint)
    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    const mintEntry = postBalances.find((b) => b.mint !== SOL_MINT);
    if (!mintEntry?.mint) return null;

    return { mint: new PublicKey(mintEntry.mint), creator };
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
