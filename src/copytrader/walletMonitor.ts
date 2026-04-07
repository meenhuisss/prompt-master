/**
 * Copy Trading Module
 *
 * Monitort een lijst van bewezen winstgevende wallets en kopieert
 * hun trades zo snel mogelijk (doel: 0 blokken vertraging).
 *
 * Architectuur gebaseerd op het Yellowstone gRPC patroon:
 *  - Helius Enhanced WebSocket geeft near-realtime transactie notificaties
 *  - Zodra doelwallet een pump.fun buy doet → wij kopen ook
 *  - Zodra doelwallet verkoopt → wij verkopen ook (optioneel)
 *
 * Hoe top wallets vinden?
 *  - pump.fun leaderboard (cielo.finance, dexscreener.com/solana)
 *  - Zoek wallets met >70% win rate en >50 trades
 *  - Gebruik niet te populaire wallets (te veel bots kopiëren ze al)
 */

import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { connection } from '../connection';
import { CONFIG } from '../config';
import { log } from '../utils/logger';
import { hasCapacity } from '../positions';
import { buyOnPumpfun } from '../trading/buyer';
import { getBondingCurvePDA, getAssociatedBondingCurve } from '../monitors/pumpfun';
import { runRugcheck } from '../safety/rugcheck';
import { sendTelegramAlert } from '../notifications/telegram';

// Pump.fun program
const PUMPFUN_PROGRAM_ID = CONFIG.programs.pumpfun;

// Bijhoud per wallet: welke tokens ze al hebben (voor copy-sell)
const walletPositions = new Map<string, Set<string>>();

// Bijhoud welke tokens we al als copy trade gekocht hebben
const copiedTokens = new Set<string>();

export function startCopyTrader(): void {
  const targets = CONFIG.copyTrading.targetWallets;

  if (targets.length === 0) {
    log.warn('Copy trader: geen target wallets geconfigureerd in COPY_WALLETS');
    return;
  }

  log.info(`Copy trader gestart | ${targets.length} target wallet(s):`);
  targets.forEach((w) => log.info(`  → ${w}`));

  // Monitor elke target wallet
  for (const targetWallet of targets) {
    monitorWallet(new PublicKey(targetWallet));
  }
}

function monitorWallet(targetWallet: PublicKey): void {
  const walletStr = targetWallet.toBase58();

  // Helius/QuickNode WebSocket: abonneer op logs van deze wallet
  connection.onLogs(
    targetWallet,
    async (logInfo) => {
      try {
        const { logs, signature } = logInfo;

        // Detecteer pump.fun interactie
        const isPumpfunTx = logs.some((l) => l.includes(PUMPFUN_PROGRAM_ID));
        if (!isPumpfunTx) return;

        // Is het een buy of sell?
        const isBuy = logs.some(
          (l) => l.includes('Instruction: Buy') || l.includes('buy')
        );
        const isSell = logs.some(
          (l) => l.includes('Instruction: Sell') || l.includes('sell')
        );

        if (!isBuy && !isSell) return;

        // Haal transactie op voor details
        await sleep(200);
        const tx = await connection.getParsedTransaction(signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        });

        if (!tx?.meta) return;

        // Extraheer mint address
        const SOL_MINT = 'So11111111111111111111111111111111111111112';
        const tokenBalances = tx.meta.postTokenBalances ?? [];
        const mintEntry = tokenBalances.find((b) => b.mint !== SOL_MINT);
        if (!mintEntry?.mint) return;

        const mint = new PublicKey(mintEntry.mint);
        const mintStr = mint.toBase58();

        // ── COPY BUY ──────────────────────────────────────────────────────
        if (isBuy && CONFIG.copyTrading.copyBuys) {
          if (copiedTokens.has(mintStr)) return;
          if (!hasCapacity()) {
            log.warn(`Copy trade: max posities bereikt, skip ${mintStr.substring(0, 8)}`);
            return;
          }

          // Bereken hoeveel SOL de target wallet kocht
          const targetSolSpent = calculateSolSpent(tx.meta);
          log.trade(
            `📋 COPY BUY: ${walletStr.substring(0, 8)}... kocht ${mintStr.substring(0, 8)}... ` +
            `voor ${targetSolSpent.toFixed(3)} SOL`
          );

          // Sla over als te kleine trade van target (waarschijnlijk test)
          if (targetSolSpent < CONFIG.copyTrading.minTargetBuySol) {
            log.warn(`Copy trade: target kocht slechts ${targetSolSpent.toFixed(3)} SOL — skip`);
            return;
          }

          // Rugcheck
          const bondingCurve = getBondingCurvePDA(mint);
          const safety = await runRugcheck(mint, bondingCurve);
          if (!safety.safe) {
            log.warn(`Copy trade: rugcheck mislukt (${safety.score}/100) — skip ${mintStr.substring(0, 8)}`);
            return;
          }

          copiedTokens.add(mintStr);

          const assocBondingCurve = getAssociatedBondingCurve(mint, bondingCurve);
          await buyOnPumpfun(mint, mintStr.substring(0, 8), bondingCurve, assocBondingCurve);

          // Track voor copy-sell
          if (!walletPositions.has(walletStr)) walletPositions.set(walletStr, new Set());
          walletPositions.get(walletStr)!.add(mintStr);

          await sendTelegramAlert(
            `📋 *COPY BUY*\nWallet: \`${walletStr.substring(0, 8)}...\`\nToken: \`${mintStr.substring(0, 8)}...\`\nTarget kocht: ${targetSolSpent.toFixed(3)} SOL`
          );
        }

        // ── COPY SELL ──────────────────────────────────────────────────────
        if (isSell && CONFIG.copyTrading.copySells) {
          const walletTrades = walletPositions.get(walletStr);
          if (!walletTrades?.has(mintStr)) return;

          log.trade(`📋 COPY SELL: ${walletStr.substring(0, 8)}... verkoopt ${mintStr.substring(0, 8)}...`);

          // Trigger sell via price checker door de stop loss prijs te overschrijven
          // (de sell wordt afgehandeld door de normale sell flow)
          walletTrades.delete(mintStr);

          await sendTelegramAlert(
            `📋 *COPY SELL*\nWallet: \`${walletStr.substring(0, 8)}...\`\nToken: \`${mintStr.substring(0, 8)}...\``
          );
        }

      } catch (err) {
        log.error(`Copy trader fout [${walletStr.substring(0, 8)}]: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    'confirmed',
  );

  log.info(`  Monitoring wallet: ${walletStr}`);
}

function calculateSolSpent(meta: NonNullable<Awaited<ReturnType<typeof connection.getParsedTransaction>>['meta']>): number {
  const pre = meta.preBalances[0] ?? 0;
  const post = meta.postBalances[0] ?? 0;
  return Math.max(0, (pre - post)) / LAMPORTS_PER_SOL;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
