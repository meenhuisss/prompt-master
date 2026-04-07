import { CONFIG } from './config';
import { log } from './utils/logger';

export interface Position {
  mint: string;
  symbol: string;
  source: 'pumpfun' | 'raydium';
  buyPrice: number;           // SOL per token bij aankoop
  buySolAmount: number;       // hoeveel SOL betaald
  tokenAmount: number;        // totale tokens gekocht
  remainingTokens: number;    // tokens nog over (na partial sells)
  peakPrice: number;          // hoogste prijs ooit gezien (voor trailing stop)
  takeProfitPrice: number;    // 1e partial sell target
  stopLossPrice: number;      // hard stop loss (initieel)
  trailingStopPrice: number;  // beweegt mee met peak price
  phase: 0 | 1 | 2;          // 0=open, 1=eerste partial verkocht, 2=tweede partial verkocht
  openedAt: number;           // unix timestamp
  txBuy: string;
}

// In-memory positiebeheer (geen database nodig)
const openPositions = new Map<string, Position>();

export function addPosition(pos: Position): void {
  openPositions.set(pos.mint, pos);
  log.trade(
    `Positie geopend: ${pos.symbol} | ` +
    `Betaald: ${pos.buySolAmount} SOL | ` +
    `TP1 (2x): ${pos.takeProfitPrice.toExponential(4)} | ` +
    `SL (-5%): ${pos.stopLossPrice.toExponential(4)}`
  );
}

export function updatePeakPrice(mint: string, newPrice: number): void {
  const pos = openPositions.get(mint);
  if (!pos) return;
  if (newPrice > pos.peakPrice) {
    pos.peakPrice = newPrice;
    // Trailing stop volgt de peak: als prijs daalt met TRAILING_STOP_PERCENT van peak → verkopen
    const trailingPercent = parseFloat(process.env.TRAILING_STOP_PERCENT ?? '0.20');
    pos.trailingStopPrice = newPrice * (1 - trailingPercent);
  }
}

export function setPhase(mint: string, phase: 0 | 1 | 2, remainingTokens: number): void {
  const pos = openPositions.get(mint);
  if (!pos) return;
  pos.phase = phase;
  pos.remainingTokens = remainingTokens;
  // Na fase 1 (2x hit): zet harde stop loss op breakeven
  if (phase === 1) {
    pos.stopLossPrice = pos.buyPrice * 1.0; // breakeven
    log.info(`${pos.symbol} | Stop loss verplaatst naar breakeven`);
  }
}

export function removePosition(mint: string): void {
  openPositions.delete(mint);
}

export function getPosition(mint: string): Position | undefined {
  return openPositions.get(mint);
}

export function getAllPositions(): Position[] {
  return Array.from(openPositions.values());
}

export function hasCapacity(): boolean {
  return openPositions.size < CONFIG.maxOpenPositions;
}

export function positionCount(): number {
  return openPositions.size;
}
