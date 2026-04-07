/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║         SOLANA MEMECOIN KILLER BOT                       ║
 * ║                                                          ║
 * ║  Strategieën:                                            ║
 * ║   1. Pump.fun launch sniper  — koopt binnen <1s          ║
 * ║   2. PumpSwap graduation     — koopt bij bonding curve   ║
 * ║      migratie naar eigen AMM                             ║
 * ║   3. Copy trading            — kopieert top wallets      ║
 * ║                                                          ║
 * ║  Sell logica:                                            ║
 * ║   • Hard stop loss  -5%      — rug pull bescherming      ║
 * ║   • Partial sell 1  2x/50%   — inleg altijd terug        ║
 * ║   • Partial sell 2  5x/30%   — grote winst               ║
 * ║   • Trailing stop   -20%ATH  — vangt moonshots           ║
 * ║                                                          ║
 * ║  Snelheid:                                               ║
 * ║   • TX Racer: Jito + NextBlock + BloxRoute race          ║
 * ║   • Rugcheck: 7 checks in parallel                       ║
 * ║   • WebSocket: <500ms detectie                           ║
 * ╚══════════════════════════════════════════════════════════╝
 */

import { checkBalance } from './connection';
import { CONFIG } from './config';
import { log } from './utils/logger';
import { startPumpfunMonitor } from './monitors/pumpfun';
import { startPumpSwapMonitor } from './monitors/pumpswap';
import { startPriceChecker } from './monitors/priceChecker';
import { startCopyTrader } from './copytrader/walletMonitor';
import { sendTelegramAlert } from './notifications/telegram';
import { printDryRunSummary } from './utils/simulation';

async function main(): Promise<void> {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║      SOLANA MEMECOIN KILLER BOT          ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');

  if (CONFIG.dryRun) {
    console.log('⚠️  DRY RUN MODUS — geen echte transacties');
    console.log('');
  }

  // Wallet check
  const balance = await checkBalance();

  // Veiligheidscheck
  if (!CONFIG.dryRun && balance < CONFIG.buyAmountSol * 2) {
    log.error(`Onvoldoende balance (${balance.toFixed(4)} SOL). Minimum: ${(CONFIG.buyAmountSol * 2).toFixed(4)} SOL`);
    process.exit(1);
  }

  console.log('');
  printConfig();
  console.log('');

  // ── Start monitors ───────────────────────────────────────────────────────

  // 1. Pump.fun nieuwe launch sniper
  if (CONFIG.strategy === 'pumpfun' || CONFIG.strategy === 'both') {
    startPumpfunMonitor();
  }

  // 2. PumpSwap graduation monitor (bonding curve → PumpSwap AMM)
  if (CONFIG.strategy === 'pumpswap' || CONFIG.strategy === 'both') {
    startPumpSwapMonitor();
  }

  // 3. Copy trading
  if (CONFIG.strategy === 'copytrading' || CONFIG.strategy === 'both') {
    if (CONFIG.copyTrading.targetWallets.length > 0) {
      startCopyTrader();
    }
  }

  // 4. Price checker — take profit / stop loss / trailing stop
  startPriceChecker();

  // ── Dagelijkse samenvatting ────────────────────────────────────────────
  scheduleDailySummary();

  log.success('Bot actief. Druk Ctrl+C om te stoppen.');

  await sendTelegramAlert(
    `🚀 *Bot gestart*\n` +
    `Modus: ${CONFIG.dryRun ? 'DRY RUN' : 'LIVE'}\n` +
    `Strategie: ${CONFIG.strategy}\n` +
    `Buy bedrag: ${CONFIG.buyAmountSol} SOL\n` +
    `Balance: ${balance.toFixed(4)} SOL`
  );

  // Graceful shutdown
  process.on('SIGINT', async () => {
    log.warn('Bot gestopt door gebruiker.');
    if (CONFIG.dryRun) printDryRunSummary();
    await sendTelegramAlert('⛔ Bot gestopt');
    process.exit(0);
  });

  // Houd process actief
  await new Promise(() => {});
}

function printConfig(): void {
  log.info(`Strategie:     ${CONFIG.strategy}`);
  log.info(`Buy bedrag:    ${CONFIG.buyAmountSol} SOL per trade`);
  log.info(`Max posities:  ${CONFIG.maxOpenPositions}`);
  log.info(`Max dagl. verlies: ${CONFIG.maxDailyLossSol} SOL`);
  log.info('');
  log.info('Sell strategie:');
  log.info(`  Hard stop loss:  -${(CONFIG.stopLossPercent * 100).toFixed(0)}%`);
  log.info(`  Partial sell 1:  ${CONFIG.partialSell1Multiplier}x → verkoop ${(CONFIG.partialSell1Percent * 100).toFixed(0)}%`);
  log.info(`  Partial sell 2:  ${CONFIG.partialSell2Multiplier}x → verkoop ${(CONFIG.partialSell2Percent * 100).toFixed(0)}%`);
  log.info(`  Trailing stop:   -${(CONFIG.trailingStopPercent * 100).toFixed(0)}% van ATH`);
  log.info('');
  log.info('Actieve providers:');
  log.info(`  Jito:      ${CONFIG.providers.jitoEndpoint ? '✓' : '✗'}`);
  log.info(`  NextBlock: ${CONFIG.providers.nextblockApiKey ? '✓' : '✗'}`);
  log.info(`  BloxRoute: ${CONFIG.providers.bloxrouteApiKey ? '✓' : '✗'}`);
  log.info(`  Telegram:  ${CONFIG.telegram.enabled ? '✓' : '✗'}`);

  if (CONFIG.copyTrading.targetWallets.length > 0) {
    log.info(`  Copy wallets: ${CONFIG.copyTrading.targetWallets.length} geconfigureerd`);
  }
}

function scheduleDailySummary(): void {
  // Elke dag om middernacht
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const msUntilMidnight = midnight.getTime() - now.getTime();

  setTimeout(() => {
    // TODO: haal echte stats op uit positions history
    sendTelegramAlert('📊 Dagelijkse samenvatting — zie logs voor details');
    setInterval(() => {
      sendTelegramAlert('📊 Dagelijkse samenvatting — zie logs voor details');
    }, 24 * 60 * 60 * 1000);
  }, msUntilMidnight);
}

main().catch((err) => {
  log.error(`Fatale fout: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
