/**
 * Raydium migration monitor
 * Detecteert wanneer een pump.fun token zijn bonding curve voltooit
 * en migreert naar Raydium (dit is vaak het grootste pump moment).
 */

import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { connection } from '../connection';
import { CONFIG } from '../config';
import { log } from '../utils/logger';
import { hasCapacity } from '../positions';
import { buyOnPumpfun } from '../trading/buyer';
import { getBondingCurvePDA, getAssociatedBondingCurve } from './pumpfun';

// Raydium AMM program voor Pump.fun graduations
const RAYDIUM_AMM = new PublicKey(CONFIG.programs.raydiumAmm);

// Raydium initialize2 discriminator (nieuwe pool aanmaken)
const INITIALIZE2_DISC = 'initialize2';

const seenPools = new Set<string>();

export function startRaydiumMonitor(): void {
  log.info('Raydium migration monitor gestart — wachten op pump.fun graduations...');

  connection.onLogs(
    RAYDIUM_AMM,
    async (logInfo) => {
      try {
        const { logs, signature } = logInfo;

        // Detecteer nieuwe pool aanmaak
        const isNewPool = logs.some(
          (l) =>
            l.includes('initialize2') ||
            l.includes('InitializeInstruction2') ||
            l.includes('ray_log')
        );

        if (!isNewPool) return;
        if (seenPools.has(signature)) return;
        seenPools.add(signature);

        log.info(`Nieuwe Raydium pool gedetecteerd: ${signature.substring(0, 16)}...`);

        if (!hasCapacity()) {
          log.warn('Max posities bereikt, pool overgeslagen');
          return;
        }

        await sleep(300);

        const poolInfo = await extractPoolInfo(signature);
        if (!poolInfo) return;

        const { baseMint, quoteMint, liquidity } = poolInfo;

        // We zijn alleen geïnteresseerd in SOL-paired tokens
        const SOL_MINT = 'So11111111111111111111111111111111111111112';
        const isWrappedSol = quoteMint === SOL_MINT || baseMint === SOL_MINT;
        if (!isWrappedSol) return;

        const tokenMint = new PublicKey(baseMint === SOL_MINT ? quoteMint : baseMint);

        // Controleer minimale liquiditeit
        if (liquidity < CONFIG.minLiquiditySol) {
          log.warn(`Raydium pool: te weinig liquiditeit (${liquidity.toFixed(1)} SOL)`);
          return;
        }

        log.trade(
          `Pump.fun graduation! Mint: ${tokenMint.toBase58().substring(0, 8)}... | ` +
          `Liquiditeit: ${liquidity.toFixed(1)} SOL`
        );

        // Koop via pump.fun bonding curve als het nog beschikbaar is,
        // anders via Raydium swap (hier kopen we via pump.fun vlak voor de migration)
        const bondingCurve = getBondingCurvePDA(tokenMint);
        const assocBondingCurve = getAssociatedBondingCurve(tokenMint, bondingCurve);

        const bcInfo = await connection.getAccountInfo(bondingCurve);
        if (bcInfo) {
          // Bonding curve nog actief — koop er via
          await buyOnPumpfun(
            tokenMint,
            tokenMint.toBase58().substring(0, 8),
            bondingCurve,
            assocBondingCurve,
          );
        } else {
          // Bonding curve al gemigreerd — TODO: Raydium swap implementeren
          log.info('Token al gemigreerd naar Raydium (Raydium swap nog niet geïmplementeerd)');
        }

      } catch (err) {
        log.error(`Raydium monitor fout: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    'confirmed',
  );
}

interface PoolInfo {
  baseMint: string;
  quoteMint: string;
  liquidity: number;
}

async function extractPoolInfo(signature: string): Promise<PoolInfo | null> {
  try {
    const tx = await connection.getParsedTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });

    if (!tx?.meta) return null;

    // Haal mints op uit token balances
    const postTokenBalances = tx.meta.postTokenBalances ?? [];
    if (postTokenBalances.length < 2) return null;

    const baseMint = postTokenBalances[0]?.mint;
    const quoteMint = postTokenBalances[1]?.mint;
    if (!baseMint || !quoteMint) return null;

    // Schat liquiditeit op basis van SOL beweging
    const preBalance = tx.meta.preBalances[0] ?? 0;
    const postBalance = tx.meta.postBalances[0] ?? 0;
    const solMoved = Math.abs(preBalance - postBalance) / LAMPORTS_PER_SOL;

    return { baseMint, quoteMint, liquidity: solMoved };
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
