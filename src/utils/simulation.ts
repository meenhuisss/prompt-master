/**
 * Dry-run / Simulatie module
 *
 * Test de bot zonder echt geld te gebruiken.
 * Alle buys en sells worden gesimuleerd — geen transacties on-chain.
 *
 * Gebruik: zet DRY_RUN=true in .env
 *
 * Wat werkt in dry-run:
 *  ✓ Token detectie (ziet echte nieuwe tokens)
 *  ✓ Rugchecks (worden echt uitgevoerd)
 *  ✓ Prijs monitoring (echte prijzen)
 *  ✓ Take profit / stop loss logica
 *  ✓ Telegram notificaties (met [DRY RUN] prefix)
 *  ✗ Echte transacties (worden gesimuleerd)
 *  ✗ Echte SOL uitgegeven
 */

import { CONFIG } from '../config';
import { log } from '../utils/logger';

interface SimulatedTrade {
  mint: string;
  symbol: string;
  buyPrice: number;
  tokenAmount: number;
  solSpent: number;
  openedAt: number;
  peakPrice: number;
  currentPrice: number;
  status: 'open' | 'closed';
  closeReason?: string;
  pnlSol?: number;
}

const simulatedTrades = new Map<string, SimulatedTrade>();
let simulatedBalance = CONFIG.simulation.startingBalance;

export function isDryRun(): boolean {
  return CONFIG.dryRun;
}

export function logDryRunBuy(mint: string, symbol: string, price: number, tokenAmount: number): void {
  if (!CONFIG.dryRun) return;

  simulatedBalance -= CONFIG.buyAmountSol;
  simulatedTrades.set(mint, {
    mint,
    symbol,
    buyPrice: price,
    tokenAmount,
    solSpent: CONFIG.buyAmountSol,
    openedAt: Date.now(),
    peakPrice: price,
    currentPrice: price,
    status: 'open',
  });

  log.trade(`[DRY RUN] BUY: ${symbol} | ${CONFIG.buyAmountSol} SOL | Prijs: ${price.toExponential(4)}`);
  log.info(`[DRY RUN] Gesimuleerde balance: ${simulatedBalance.toFixed(4)} SOL`);
}

export function logDryRunSell(mint: string, currentPrice: number, reason: string): void {
  if (!CONFIG.dryRun) return;

  const trade = simulatedTrades.get(mint);
  if (!trade) return;

  const solReceived = (currentPrice / trade.buyPrice) * trade.solSpent;
  const pnl = solReceived - trade.solSpent;
  const pnlPct = (pnl / trade.solSpent) * 100;

  simulatedBalance += solReceived;

  trade.status = 'closed';
  trade.closeReason = reason;
  trade.pnlSol = pnl;

  const emoji = pnl >= 0 ? '✅' : '❌';
  log.trade(
    `[DRY RUN] SELL (${reason}): ${trade.symbol} | ` +
    `${emoji} P&L: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)} SOL (${pnlPct.toFixed(1)}%)`
  );
  log.info(`[DRY RUN] Gesimuleerde balance: ${simulatedBalance.toFixed(4)} SOL`);
}

export function printDryRunSummary(): void {
  if (!CONFIG.dryRun) return;

  const closed = Array.from(simulatedTrades.values()).filter((t) => t.status === 'closed');
  const wins = closed.filter((t) => (t.pnlSol ?? 0) > 0);
  const losses = closed.filter((t) => (t.pnlSol ?? 0) <= 0);
  const totalPnl = closed.reduce((sum, t) => sum + (t.pnlSol ?? 0), 0);

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║         DRY RUN SAMENVATTING             ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`Startbalance:    ${CONFIG.simulation.startingBalance.toFixed(4)} SOL`);
  console.log(`Eindbalance:     ${simulatedBalance.toFixed(4)} SOL`);
  console.log(`Totale P&L:      ${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(4)} SOL`);
  console.log(`Trades:          ${closed.length} (${wins.length}W / ${losses.length}L)`);
  console.log(`Win rate:        ${closed.length > 0 ? ((wins.length / closed.length) * 100).toFixed(0) : 0}%`);

  if (closed.length > 0) {
    console.log('\nTop trades:');
    closed
      .sort((a, b) => (b.pnlSol ?? 0) - (a.pnlSol ?? 0))
      .slice(0, 5)
      .forEach((t) => {
        const pct = ((t.pnlSol ?? 0) / t.solSpent) * 100;
        console.log(`  ${t.symbol}: ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% (${t.closeReason})`);
      });
  }
  console.log('');
}
