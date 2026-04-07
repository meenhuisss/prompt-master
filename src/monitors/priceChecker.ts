/**
 * Price Checker — Smart Sell Strategie
 *
 * Waarom deze strategie de beste is voor memecoins:
 *
 * FASE 0 → START
 *   Hard stop loss op -5%: als een token direct dumpt (rug pull signaal),
 *   verlies je maximaal 5% in plaats van alles.
 *
 * FASE 1 → PRIJS BEREIKT 2x
 *   Verkoop 50% van je tokens.
 *   Resultaat: je hebt je inleg al terugverdiend + winst.
 *   Stop loss wordt verplaatst naar breakeven (je kunt nu niet meer verliezen).
 *
 * FASE 2 → PRIJS BEREIKT 5x
 *   Verkoop nog eens 30% van je tokens.
 *   Resultaat: 80% van positie is al verkocht met grote winst.
 *
 * FASE 3 → TRAILING STOP (resterende 20%)
 *   De trailing stop volgt de hoogste prijs die gezien is.
 *   Als prijs -20% daalt van het hoogtepunt → automatisch verkopen.
 *   Dit laat je profiteren van 10x, 50x, zelfs 100x moves.
 *
 * Voorbeeld: je koopt voor 0.05 SOL
 *   - 2x hit: +0.05 SOL (inleg terug)
 *   - 5x hit: +0.075 SOL extra
 *   - Als daarna 20x bereikt en trailing stop triggert: +nog eens 0.04 SOL
 *   Totaal: ~3x op je originele inleg, met bescherming tegen verlies
 */

import { PublicKey } from '@solana/web3.js';
import { connection } from '../connection';
import { CONFIG } from '../config';
import { log } from '../utils/logger';
import { getAllPositions, getPosition, updatePeakPrice, setPhase } from '../positions';
import { sellOnPumpfun } from '../trading/seller';
import { getBondingCurvePDA, getAssociatedBondingCurve } from './pumpfun';

const POLL_INTERVAL_MS = 3_000; // 3 seconden voor snellere reactie

export function startPriceChecker(): void {
  log.info('Price checker gestart (interval: 3s) | Strategie: Partial sells + Trailing stop');
  log.info(`  TP1: ${CONFIG.partialSell1Multiplier}x → verkoop ${(CONFIG.partialSell1Percent * 100).toFixed(0)}%`);
  log.info(`  TP2: ${CONFIG.partialSell2Multiplier}x → verkoop ${(CONFIG.partialSell2Percent * 100).toFixed(0)}%`);
  log.info(`  Trailing stop: -${(CONFIG.trailingStopPercent * 100).toFixed(0)}% van ATH`);
  log.info(`  Hard stop loss: -${(CONFIG.stopLossPercent * 100).toFixed(0)}%`);
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

      // Haal de meest recente positie op (kan geüpdatet zijn door andere operaties)
      const pos = getPosition(position.mint);
      if (!pos) continue;

      // Update peak price en trailing stop
      updatePeakPrice(pos.mint, currentPrice);

      const pnlPct = ((currentPrice - pos.buyPrice) / pos.buyPrice) * 100;
      const multiple = currentPrice / pos.buyPrice;

      // Log huidige status
      log.info(
        `[${pos.symbol}] ${multiple.toFixed(2)}x | ` +
        `P&L: ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}% | ` +
        `ATH: ${(pos.peakPrice / pos.buyPrice).toFixed(2)}x | ` +
        `Fase: ${pos.phase} | ` +
        `Tokens over: ${pos.remainingTokens.toLocaleString()}`
      );

      const assocBondingCurve = getAssociatedBondingCurve(mint, bondingCurve);

      // ── HARD STOP LOSS (-5%) ────────────────────────────────────────────
      // Alleen actief in fase 0. Na fase 1 is stop loss op breakeven.
      if (currentPrice <= pos.stopLossPrice && pos.phase === 0) {
        log.trade(`🛑 HARD STOP LOSS ${pos.symbol} | ${pnlPct.toFixed(1)}% | Verkoop ALLES`);
        await sellOnPumpfun(pos, bondingCurve, assocBondingCurve, 'stop_loss', pos.remainingTokens);
        continue;
      }

      // ── BREAKEVEN STOP (na fase 1) ──────────────────────────────────────
      // Als prijs na fase 1 terugzakt tot breakeven → verkoop alles
      if (pos.phase >= 1 && currentPrice <= pos.buyPrice * 1.01) {
        log.trade(`🛑 BREAKEVEN STOP ${pos.symbol} | Verkoop resterende ${pos.remainingTokens.toLocaleString()} tokens`);
        await sellOnPumpfun(pos, bondingCurve, assocBondingCurve, 'stop_loss', pos.remainingTokens);
        continue;
      }

      // ── FASE 1: PARTIAL SELL bij 2x ────────────────────────────────────
      if (pos.phase === 0 && currentPrice >= pos.buyPrice * CONFIG.partialSell1Multiplier) {
        const sellAmount = Math.floor(pos.tokenAmount * CONFIG.partialSell1Percent);
        const remaining = pos.tokenAmount - sellAmount;

        log.trade(
          `✅ PARTIAL SELL 1 (${CONFIG.partialSell1Multiplier}x) | ` +
          `${pos.symbol} | Verkoop ${sellAmount.toLocaleString()} tokens (${(CONFIG.partialSell1Percent * 100).toFixed(0)}%)`
        );

        const result = await sellOnPumpfun(pos, bondingCurve, assocBondingCurve, 'take_profit', sellAmount);
        if (result.success) {
          setPhase(pos.mint, 1, remaining);
          log.success(`${pos.symbol} | Stop loss verplaatst naar breakeven | ${remaining.toLocaleString()} tokens lopen door`);
        }
        continue;
      }

      // ── FASE 2: PARTIAL SELL bij 5x ────────────────────────────────────
      if (pos.phase === 1 && currentPrice >= pos.buyPrice * CONFIG.partialSell2Multiplier) {
        const sellAmount = Math.floor(pos.tokenAmount * CONFIG.partialSell2Percent);
        const remaining = pos.remainingTokens - sellAmount;

        log.trade(
          `✅ PARTIAL SELL 2 (${CONFIG.partialSell2Multiplier}x) | ` +
          `${pos.symbol} | Verkoop ${sellAmount.toLocaleString()} tokens (${(CONFIG.partialSell2Percent * 100).toFixed(0)}%)`
        );

        const result = await sellOnPumpfun(pos, bondingCurve, assocBondingCurve, 'take_profit', sellAmount);
        if (result.success) {
          setPhase(pos.mint, 2, remaining);
          log.success(`${pos.symbol} | ${remaining.toLocaleString()} tokens lopen door met trailing stop`);
        }
        continue;
      }

      // ── TRAILING STOP (fase 2+) ─────────────────────────────────────────
      // Als prijs daalt met X% van het hoogste punt → verkoop alles wat over is
      if (pos.phase >= 1 && currentPrice <= pos.trailingStopPrice) {
        const dropFromPeak = ((pos.peakPrice - currentPrice) / pos.peakPrice) * 100;
        log.trade(
          `📉 TRAILING STOP ${pos.symbol} | ` +
          `${dropFromPeak.toFixed(1)}% gedaald van ATH (${(pos.peakPrice / pos.buyPrice).toFixed(1)}x) | ` +
          `Verkoop ${pos.remainingTokens.toLocaleString()} tokens`
        );
        await sellOnPumpfun(pos, bondingCurve, assocBondingCurve, 'take_profit', pos.remainingTokens);
        continue;
      }

      // ── TIMEOUT: forceer verkoop na 1 uur ──────────────────────────────
      const ageMs = Date.now() - pos.openedAt;
      if (ageMs > 60 * 60 * 1000) {
        log.warn(`⏰ TIMEOUT ${pos.symbol} — verkoop na 1 uur | ${pos.remainingTokens.toLocaleString()} tokens`);
        await sellOnPumpfun(pos, bondingCurve, assocBondingCurve, 'manual', pos.remainingTokens);
      }

    } catch (err) {
      log.error(`Price check fout [${position.symbol}]: ${err instanceof Error ? err.message : String(err)}`);
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

    return virtualSolReserves / virtualTokenReserves;
  } catch {
    return null;
  }
}
