/**
 * Solana Memecoin Sniper Bot
 * Ondersteunt: Pump.fun nieuwe launches + Raydium migration sniping
 */

import { checkBalance } from './connection';
import { CONFIG } from './config';
import { log } from './utils/logger';
import { startPumpfunMonitor } from './monitors/pumpfun';
import { startRaydiumMonitor } from './monitors/raydium';
import { startPriceChecker } from './monitors/priceChecker';

async function main(): Promise<void> {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║      SOLANA MEMECOIN SNIPER BOT          ║');
  console.log('║   Pump.fun  +  Raydium Migration         ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');

  // Wallet check
  await checkBalance();

  console.log('');
  log.info(`Strategie: ${CONFIG.strategy}`);
  log.info(`Buy bedrag: ${CONFIG.buyAmountSol} SOL per trade`);
  log.info(`Take profit: ${CONFIG.takeProfitMultiplier}x (${((CONFIG.takeProfitMultiplier - 1) * 100).toFixed(0)}%)`);
  log.info(`Stop loss: -${(CONFIG.stopLossPercent * 100).toFixed(0)}%`);
  log.info(`Max posities: ${CONFIG.maxOpenPositions}`);
  log.info(`Min liquiditeit: ${CONFIG.minLiquiditySol} SOL`);
  console.log('');

  // Start monitors op basis van gekozen strategie
  if (CONFIG.strategy === 'pumpfun' || CONFIG.strategy === 'both') {
    startPumpfunMonitor();
  }

  if (CONFIG.strategy === 'raydium' || CONFIG.strategy === 'both') {
    startRaydiumMonitor();
  }

  // Start price checker voor take-profit / stop-loss
  startPriceChecker();

  log.success('Bot is actief. Druk Ctrl+C om te stoppen.');
  console.log('');

  // Graceful shutdown
  process.on('SIGINT', () => {
    log.warn('Bot gestopt door gebruiker.');
    process.exit(0);
  });

  // Houd process actief
  await new Promise(() => {});
}

main().catch((err) => {
  log.error(`Fatale fout: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
