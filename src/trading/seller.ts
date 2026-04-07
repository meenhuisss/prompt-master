import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { connection, wallet } from '../connection';
import { CONFIG } from '../config';
import { log } from '../utils/logger';
import { Position, removePosition } from '../positions';
import BN from 'bn.js';

// Pump.fun sell instruction discriminator
const PUMPFUN_SELL_DISCRIMINATOR = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);

const PUMPFUN_GLOBAL = new PublicKey('4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5zP9QkDJnFUB3Z4');
const PUMPFUN_FEE_RECIPIENT = new PublicKey('CebN5WGQ4jvEPvsVU4EoHEpgznyQHebiR3xg7gH3brBS');
const PUMPFUN_EVENT_AUTHORITY = new PublicKey('Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1');
const PUMPFUN_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

export type SellReason = 'take_profit' | 'stop_loss' | 'manual';

interface SellResult {
  success: boolean;
  txSignature?: string;
  solReceived?: number;
  pnlPercent?: number;
  error?: string;
}

export async function sellOnPumpfun(
  position: Position,
  bondingCurve: PublicKey,
  associatedBondingCurve: PublicKey,
  reason: SellReason,
  // Optioneel: verkoop slechts een deel van de tokens (voor partial sells)
  tokensToSell?: number,
): Promise<SellResult> {
  const mint = new PublicKey(position.mint);

  try {
    const tokenAmountRaw = Math.floor(tokensToSell ?? position.remainingTokens);
    const minSolOutput = await estimateSolOutput(bondingCurve, tokenAmountRaw);
    const minSolWithSlippage = Math.floor(minSolOutput * (1 - CONFIG.maxSlippage));

    log.trade(
      `Verkopen (${reason}): ${position.symbol} | ` +
      `${tokenAmountRaw.toLocaleString()} tokens | ` +
      `Verwacht: ~${(minSolOutput / LAMPORTS_PER_SOL).toFixed(4)} SOL`
    );

    const sellerAta = await getAssociatedTokenAddress(mint, wallet.publicKey);

    const sellData = Buffer.alloc(24);
    PUMPFUN_SELL_DISCRIMINATOR.copy(sellData, 0);
    new BN(tokenAmountRaw).toBuffer('le', 8).copy(sellData, 8);
    new BN(minSolWithSlippage).toBuffer('le', 8).copy(sellData, 16);

    const sellIx = new TransactionInstruction({
      programId: PUMPFUN_PROGRAM,
      keys: [
        { pubkey: PUMPFUN_GLOBAL, isSigner: false, isWritable: false },
        { pubkey: PUMPFUN_FEE_RECIPIENT, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: bondingCurve, isSigner: false, isWritable: true },
        { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
        { pubkey: sellerAta, isSigner: false, isWritable: true },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID_PLACEHOLDER, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: PUMPFUN_EVENT_AUTHORITY, isSigner: false, isWritable: false },
        { pubkey: PUMPFUN_PROGRAM, isSigner: false, isWritable: false },
      ],
      data: sellData,
    });

    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 500_000 }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
      sellIx,
    );

    const { blockhash } = await connection.getLatestBlockhash('finalized');
    tx.recentBlockhash = blockhash;
    tx.feePayer = wallet.publicKey;

    const sig = await sendAndConfirmTransaction(connection, tx, [wallet], {
      skipPreflight: true,
      commitment: 'confirmed',
    });

    const solReceived = minSolOutput / LAMPORTS_PER_SOL;
    const pnlPercent = ((solReceived - position.buySolAmount) / position.buySolAmount) * 100;

    const emoji = pnlPercent >= 0 ? '✅' : '❌';
    log.success(
      `${emoji} Verkoop geslaagd (${reason}) | ` +
      `${position.symbol} | ` +
      `P&L: ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(1)}% | ` +
      `TX: ${sig}`
    );

    removePosition(position.mint);
    return { success: true, txSignature: sig, solReceived, pnlPercent };

  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error(`Verkoop mislukt voor ${position.symbol}: ${error}`);
    return { success: false, error };
  }
}

const ASSOCIATED_TOKEN_PROGRAM_ID_PLACEHOLDER = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1brs'
);

async function estimateSolOutput(bondingCurve: PublicKey, tokenAmount: number): Promise<number> {
  const info = await connection.getAccountInfo(bondingCurve);
  if (!info) return 0;

  const data = info.data;
  const virtualTokenReserves = Number(data.readBigUInt64LE(8));
  const virtualSolReserves = Number(data.readBigUInt64LE(16));

  if (virtualTokenReserves === 0) return 0;

  const k = virtualTokenReserves * virtualSolReserves;
  const newTokenReserves = virtualTokenReserves + tokenAmount;
  const newSolReserves = k / newTokenReserves;
  return virtualSolReserves - newSolReserves;
}
