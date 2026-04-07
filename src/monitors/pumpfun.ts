/**
 * Pump.fun monitor
 * Luistert naar nieuwe token launches via Solana WebSocket logs.
 * Zodra een CreateEvent gezien wordt, kopen we onmiddellijk.
 */

import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { connection } from '../connection';
import { CONFIG } from '../config';
import { log } from '../utils/logger';
import { hasCapacity } from '../positions';
import { buyOnPumpfun } from '../trading/buyer';

const PUMPFUN_PROGRAM = new PublicKey(CONFIG.programs.pumpfun);

// Pump.fun bonding curve PDA seed
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
      new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA').toBuffer(),
      mint.toBuffer(),
    ],
    new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1brs'),
  );
  return pda;
}

// Set om dubbele events te voorkomen
const seenTokens = new Set<string>();

export function startPumpfunMonitor(): void {
  log.info('Pump.fun monitor gestart — wachten op nieuwe tokens...');

  connection.onLogs(
    PUMPFUN_PROGRAM,
    async (logInfo) => {
      try {
        const { logs, signature } = logInfo;

        // Detecteer CreateEvent in de logs
        const isCreate = logs.some(
          (l) => l.includes('Program log: Instruction: Create') ||
                 l.includes('initialize_mint') ||
                 l.includes('CreateEvent')
        );

        if (!isCreate) return;

        // Parse de mint address uit de transactie
        const mintAddress = await extractMintFromTx(signature);
        if (!mintAddress) return;

        const mintStr = mintAddress.toBase58();
        if (seenTokens.has(mintStr)) return;
        seenTokens.add(mintStr);

        log.info(`Nieuw Pump.fun token: ${mintStr.substring(0, 8)}...`);

        if (!hasCapacity()) {
          log.warn('Max posities bereikt, token overgeslagen');
          return;
        }

        // Kleine delay om te wachten tot bonding curve account bestaat
        await sleep(500);

        // Rug pull filters
        const safe = await runFilters(mintAddress);
        if (!safe) {
          log.warn(`Token gefilterd: ${mintStr.substring(0, 8)}...`);
          return;
        }

        const bondingCurve = getBondingCurvePDA(mintAddress);
        const associatedBondingCurve = getAssociatedBondingCurve(mintAddress, bondingCurve);

        await buyOnPumpfun(mintAddress, mintStr.substring(0, 8), bondingCurve, associatedBondingCurve);

      } catch (err) {
        log.error(`Pump.fun monitor fout: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    'confirmed',
  );
}

async function extractMintFromTx(signature: string): Promise<PublicKey | null> {
  try {
    await sleep(200); // wacht op bevestiging
    const tx = await connection.getParsedTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });

    if (!tx?.meta || !tx.transaction.message.accountKeys) return null;

    // Zoek nieuwe token accounts (type: 'account' met postTokenBalance)
    const postBalances = tx.meta.postTokenBalances ?? [];
    if (postBalances.length === 0) return null;

    const mintStr = postBalances[0]?.mint;
    if (!mintStr) return null;

    return new PublicKey(mintStr);
  } catch {
    return null;
  }
}

// Basis rug pull filters
async function runFilters(mint: PublicKey): Promise<boolean> {
  try {
    // Filter 1: bonding curve moet al bestaan
    const bondingCurve = getBondingCurvePDA(mint);
    const bcInfo = await connection.getAccountInfo(bondingCurve);
    if (!bcInfo) return false;

    // Filter 2: bonding curve moet liquidity hebben
    const solInCurve = bcInfo.lamports / LAMPORTS_PER_SOL;
    if (solInCurve < CONFIG.minLiquiditySol) {
      log.warn(`Te weinig liquiditeit: ${solInCurve.toFixed(2)} SOL`);
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
