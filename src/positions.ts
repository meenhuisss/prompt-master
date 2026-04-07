import { CONFIG } from './config';
import { log } from './utils/logger';

export interface Position {
  mint: string;
  symbol: string;
  source: 'pumpfun' | 'raydium';
  buyPrice: number;       // SOL per token bij aankoop
  buySolAmount: number;   // hoeveel SOL betaald
  tokenAmount: number;    // hoeveel tokens gekocht
  takeProfitPrice: number;
  stopLossPrice: number;
  openedAt: number;       // unix timestamp
  txBuy: string;
}

// In-memory positiebeheer (geen database nodig)
const openPositions = new Map<string, Position>();

export function addPosition(pos: Position): void {
  openPositions.set(pos.mint, pos);
  log.trade(
    `Positie geopend: ${pos.symbol} | ` +
    `Betaald: ${pos.buySolAmount} SOL | ` +
    `TP: ${pos.takeProfitPrice.toFixed(8)} | ` +
    `SL: ${pos.stopLossPrice.toFixed(8)}`
  );
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
