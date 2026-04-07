/**
 * Price checker — pollt elke 5 seconden de huidige prijs
 * en triggert take-profit of stop-loss verkopen.
 */

import { PublicKey } from '@solana/web3.js';
import { connection } from '../connection';
import { log } from '../utils/logger';
import { getAllPositions, getPosition } from '../positions';
import { sellOnPumpfun } from '../trading/seller';
import { getBondingCurvePDA, getAssociatedBondingCurve } from './pumpfun';

const POLL_INTERVAL_MS = 5_000; // 5 seconden

export function startPriceChecker(): void {
  log.info('Price checker gestart (interval: 5s)');
  setInterval(checkAllPositions, POLL_INTERVAL_MS);
}

async function checkAllPositions(): Promise<void> {
  const positions = getAllPositions();
  if (positions.length === 0) return;

  for (const position of positions) {
    try {
      const mint = new PublicKey(position.mint);
      const bondingCurve = getBondingCurvePDA(mint);
      const currentPrice = await getCurrentPrice(bondingCurve);

      if (currentPrice === null) continue;

      const pos = getPosition(position.mint);
      if (!pos) continue;

      const pnlPct = ((currentPrice - pos.buyPrice) / pos.buyPrice) * 100;

      // Log huidige status
      log.info(
        `${pos.symbol} | Prijs: ${currentPrice.toExponential(4)} | ` +
        `P&L: ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%`
      );

      const assocBondingCurve = getAssociatedBondingCurve(mint, bondingCurve);

      // Take profit
      if (currentPrice >= pos.takeProfitPrice) {
        log.trade(`TAKE PROFIT voor ${pos.symbol} (+${pnlPct.toFixed(1)}%)`);
        await sellOnPumpfun(pos, bondingCurve, assocBondingCurve, 'take_profit');
        continue;
      }

      // Stop loss
      if (currentPrice <= pos.stopLossPrice) {
        log.trade(`STOP LOSS voor ${pos.symbol} (${pnlPct.toFixed(1)}%)`);
        await sellOnPumpfun(pos, bondingCurve, assocBondingCurve, 'stop_loss');
        continue;
      }

      // Timeout: forceer verkoop na 30 minuten
      const ageMs = Date.now() - pos.openedAt;
      if (ageMs > 30 * 60 * 1000) {
        log.warn(`Timeout voor ${pos.symbol} — forceer verkoop na 30 min`);
        await sellOnPumpfun(pos, bondingCurve, assocBondingCurve, 'manual');
      }

    } catch (err) {
      log.error(`Price check fout voor ${position.symbol}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

async function getCurrentPrice(bondingCurve: PublicKey): Promise<number | null> {
  try {
    const info = await connection.getAccountInfo(bondingCurve);
    if (!info) return null;

    const data = info.data;
    const virtualTokenReserves = Number(data.readBigUInt64LE(8));
    const virtualSolReserves = Number(data.readBigUInt64LE(16));

    if (virtualTokenReserves === 0) return null;

    // Prijs in SOL per token (inclusief LAMPORTS_PER_SOL factor)
    return virtualSolReserves / virtualTokenReserves;
  } catch {
    return null;
  }
}
