/**
 * PumpSwap AMM Monitor
 *
 * Pump.fun heeft Raydium VERVANGEN door hun eigen AMM: PumpSwap.
 * Tokens migreren nu naar PumpSwap zodra de bonding curve vol is (~85 SOL).
 *
 * PumpSwap program: pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA
 *
 * Strategie: koop zodra een token naar PumpSwap migreert.
 * Dit is het moment waarop veel retail traders instappen → pump kans.
 *
 * Verschil met Raydium monitor:
 *  - Ander program ID
 *  - Andere pool structuur (CPMM vs AMM)
 *  - Pump.fun betaalt zelf de liquiditeit → betrouwbaarder
 */

import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { connection } from '../connection';
import { CONFIG } from '../config';
import { log } from '../utils/logger';
import { hasCapacity } from '../positions';
import { buyOnPumpfun } from '../trading/buyer';
import { getBondingCurvePDA, getAssociatedBondingCurve } from './pumpfun';
import { runRugcheck } from '../safety/rugcheck';
import { sendTelegramAlert } from '../notifications/telegram';

// PumpSwap AMM program ID
const PUMPSWAP_PROGRAM = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');

const seenMigrations = new Set<string>();

export function startPumpSwapMonitor(): void {
  log.info('PumpSwap AMM monitor gestart — wacht op bonding curve graduations...');
  log.info(`  Program: ${PUMPSWAP_PROGRAM.toBase58().substring(0, 16)}...`);

  connection.onLogs(
    PUMPSWAP_PROGRAM,
    async (logInfo) => {
      try {
        const { logs, signature } = logInfo;

        // Detecteer nieuwe pool aanmaak in PumpSwap
        const isNewPool = logs.some(
          (l) =>
            l.includes('CreatePool') ||
            l.includes('create_pool') ||
            l.includes('Initialize')
        );

        if (!isNewPool) return;
        if (seenMigrations.has(signature)) return;
        seenMigrations.add(signature);

        log.info(`🎓 PumpSwap pool aangemaakt: ${signature.substring(0, 16)}...`);

        await sleep(400);

        const poolInfo = await extractPumpSwapPool(signature);
        if (!poolInfo) return;

        const { tokenMint, solLiquidity } = poolInfo;
        const mintStr = tokenMint.toBase58();

        log.trade(
          `🎓 GRADUATION DETECTED | Token: ${mintStr.substring(0, 8)}... | ` +
          `Liquiditeit: ${solLiquidity.toFixed(1)} SOL`
        );

        if (!hasCapacity()) {
          log.warn('Max posities bereikt, migration overgeslagen');
          return;
        }

        if (solLiquidity < CONFIG.minLiquiditySol) {
          log.warn(`Te weinig liquiditeit bij migration: ${solLiquidity.toFixed(1)} SOL`);
          return;
        }

        // Rugcheck op basis van token mint
        const bondingCurve = getBondingCurvePDA(tokenMint);
        const safety = await runRugcheck(tokenMint, bondingCurve);

        if (!safety.safe) {
          log.warn(`PumpSwap migration rugcheck mislukt (${safety.score}/100) — skip`);
          return;
        }

        await sendTelegramAlert(
          `🎓 *GRADUATION*\nToken: \`${mintStr.substring(0, 8)}...\`\nLiquiditeit: ${solLiquidity.toFixed(1)} SOL\nScore: ${safety.score}/100`
        );

        // Koop via bonding curve als het nog beschikbaar is,
        // anders TODO: PumpSwap swap implementeren
        const bcInfo = await connection.getAccountInfo(bondingCurve);
        if (bcInfo) {
          const assocBondingCurve = getAssociatedBondingCurve(tokenMint, bondingCurve);
          await buyOnPumpfun(tokenMint, mintStr.substring(0, 8), bondingCurve, assocBondingCurve);
        } else {
          log.info(`${mintStr.substring(0, 8)} al op PumpSwap — TODO: AMM swap`);
          // TODO: Implementeer directe PumpSwap swap (aparte module)
        }

      } catch (err) {
        log.error(`PumpSwap monitor fout: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    'confirmed',
  );
}

interface PumpSwapPoolInfo {
  tokenMint: PublicKey;
  solLiquidity: number;
}

async function extractPumpSwapPool(signature: string): Promise<PumpSwapPoolInfo | null> {
  try {
    const tx = await connection.getParsedTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });

    if (!tx?.meta) return null;

    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    const postTokenBalances = tx.meta.postTokenBalances ?? [];

    const tokenEntry = postTokenBalances.find((b) => b.mint !== SOL_MINT);
    if (!tokenEntry?.mint) return null;

    // Schat SOL liquiditeit
    const preBalance = tx.meta.preBalances[0] ?? 0;
    const postBalance = tx.meta.postBalances[0] ?? 0;
    const solMoved = Math.abs(preBalance - postBalance) / LAMPORTS_PER_SOL;

    return {
      tokenMint: new PublicKey(tokenEntry.mint),
      solLiquidity: solMoved,
    };
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
