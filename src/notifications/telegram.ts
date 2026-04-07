/**
 * Telegram Notificaties
 *
 * Stuur real-time alerts naar je Telegram op:
 *  - Nieuwe buy uitgevoerd
 *  - Take profit / stop loss geraakt
 *  - Graduation (bonding curve → PumpSwap)
 *  - Copy trade gedetecteerd
 *  - Dagelijkse samenvatting
 *
 * Setup:
 *  1. Maak een bot via @BotFather op Telegram
 *  2. Stuur een bericht naar je bot
 *  3. Haal je chat_id op: https://api.telegram.org/bot<TOKEN>/getUpdates
 *  4. Vul TELEGRAM_BOT_TOKEN en TELEGRAM_CHAT_ID in in .env
 */

import axios from 'axios';
import { CONFIG } from '../config';
import { log } from '../utils/logger';

let lastAlertTime = 0;
const MIN_ALERT_INTERVAL_MS = 1000; // max 1 alert per seconde (Telegram rate limit)

export async function sendTelegramAlert(message: string): Promise<void> {
  if (!CONFIG.telegram.enabled) return;

  // Rate limiting
  const now = Date.now();
  if (now - lastAlertTime < MIN_ALERT_INTERVAL_MS) {
    await sleep(MIN_ALERT_INTERVAL_MS);
  }
  lastAlertTime = Date.now();

  try {
    await axios.post(
      `https://api.telegram.org/bot${CONFIG.telegram.botToken}/sendMessage`,
      {
        chat_id: CONFIG.telegram.chatId,
        text: message,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      },
      { timeout: 5000 }
    );
  } catch (err) {
    // Stil falen — Telegram is niet kritiek
    log.warn(`Telegram alert mislukt: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function sendTradeAlert(params: {
  type: 'BUY' | 'SELL' | 'STOP_LOSS' | 'TAKE_PROFIT' | 'TRAILING_STOP';
  symbol: string;
  mint: string;
  solAmount: number;
  pnlPercent?: number;
  txSignature?: string;
}): Promise<void> {
  const emoji = {
    BUY: '🟢',
    SELL: '🔵',
    STOP_LOSS: '🔴',
    TAKE_PROFIT: '✅',
    TRAILING_STOP: '📉',
  }[params.type];

  const pnlStr = params.pnlPercent !== undefined
    ? `\nP&L: ${params.pnlPercent >= 0 ? '+' : ''}${params.pnlPercent.toFixed(1)}%`
    : '';

  const txStr = params.txSignature
    ? `\n[Bekijk TX](https://solscan.io/tx/${params.txSignature})`
    : '';

  const message =
    `${emoji} *${params.type}*\n` +
    `Token: \`${params.symbol}\`\n` +
    `Mint: \`${params.mint.substring(0, 8)}...\`\n` +
    `Bedrag: ${params.solAmount.toFixed(4)} SOL` +
    pnlStr +
    txStr;

  await sendTelegramAlert(message);
}

export async function sendDailySummary(stats: {
  totalTrades: number;
  wins: number;
  losses: number;
  totalPnlSol: number;
  startBalance: number;
  currentBalance: number;
}): Promise<void> {
  const winRate = stats.totalTrades > 0
    ? ((stats.wins / stats.totalTrades) * 100).toFixed(0)
    : '0';

  const message =
    `📊 *DAGELIJKSE SAMENVATTING*\n` +
    `───────────────────\n` +
    `Trades: ${stats.totalTrades} (${stats.wins}W / ${stats.losses}L)\n` +
    `Win rate: ${winRate}%\n` +
    `P&L: ${stats.totalPnlSol >= 0 ? '+' : ''}${stats.totalPnlSol.toFixed(4)} SOL\n` +
    `Balance: ${stats.startBalance.toFixed(3)} → ${stats.currentBalance.toFixed(3)} SOL`;

  await sendTelegramAlert(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
