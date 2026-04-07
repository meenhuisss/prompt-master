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
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { connection, wallet } from '../connection';
import { CONFIG } from '../config';
import { log } from '../utils/logger';
import { addPosition } from '../positions';
import BN from 'bn.js';

// Pump.fun buy instruction discriminator
const PUMPFUN_BUY_DISCRIMINATOR = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);

// Pump.fun fixed accounts
const PUMPFUN_GLOBAL = new PublicKey('4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5zP9QkDJnFUB3Z4');
const PUMPFUN_FEE_RECIPIENT = new PublicKey('CebN5WGQ4jvEPvsVU4EoHEpgznyQHebiR3xg7gH3brBS');
const PUMPFUN_EVENT_AUTHORITY = new PublicKey('Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1');
const PUMPFUN_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

interface BuyResult {
  success: boolean;
  txSignature?: string;
  tokenAmount?: number;
  pricePerToken?: number;
  error?: string;
}

export async function buyOnPumpfun(
  mint: PublicKey,
  symbol: string,
  bondingCurve: PublicKey,
  associatedBondingCurve: PublicKey,
): Promise<BuyResult> {
  try {
    const solAmount = CONFIG.buyAmountSol * LAMPORTS_PER_SOL;
    const maxSolCost = Math.floor(solAmount * (1 + CONFIG.maxSlippage));

    // Haal bonding curve info op om token amount te berekenen
    const bondingCurveInfo = await connection.getAccountInfo(bondingCurve);
    if (!bondingCurveInfo) return { success: false, error: 'Bonding curve niet gevonden' };

    // Bereken geschatte tokens (simplified price curve)
    const estimatedTokens = await estimatePumpfunTokenAmount(bondingCurve, solAmount);

    log.trade(`Kopen op Pump.fun: ${symbol} | ${CONFIG.buyAmountSol} SOL | ~${estimatedTokens.toLocaleString()} tokens`);

    const buyerAta = await getAssociatedTokenAddress(mint, wallet.publicKey);

    const instructions: TransactionInstruction[] = [
      // Prioriteitsfee voor snelheid
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 500_000 }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
    ];

    // Maak ATA aan als die niet bestaat
    const ataInfo = await connection.getAccountInfo(buyerAta);
    if (!ataInfo) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          buyerAta,
          wallet.publicKey,
          mint,
        )
      );
    }

    // Pump.fun buy instructie
    const buyData = Buffer.alloc(24);
    PUMPFUN_BUY_DISCRIMINATOR.copy(buyData, 0);
    // token amount (u64) — minimale tokens accepteren
    new BN(Math.floor(estimatedTokens * 0.7)).toBuffer('le', 8).copy(buyData, 8);
    // max sol cost (u64)
    new BN(maxSolCost).toBuffer('le', 8).copy(buyData, 16);

    const buyIx = new TransactionInstruction({
      programId: PUMPFUN_PROGRAM,
      keys: [
        { pubkey: PUMPFUN_GLOBAL, isSigner: false, isWritable: false },
        { pubkey: PUMPFUN_FEE_RECIPIENT, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: bondingCurve, isSigner: false, isWritable: true },
        { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
        { pubkey: buyerAta, isSigner: false, isWritable: true },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: PUMPFUN_EVENT_AUTHORITY, isSigner: false, isWritable: false },
        { pubkey: PUMPFUN_PROGRAM, isSigner: false, isWritable: false },
      ],
      data: buyData,
    });

    instructions.push(buyIx);

    const tx = new Transaction().add(...instructions);
    const { blockhash } = await connection.getLatestBlockhash('finalized');
    tx.recentBlockhash = blockhash;
    tx.feePayer = wallet.publicKey;

    const sig = await sendAndConfirmTransaction(connection, tx, [wallet], {
      skipPreflight: true,
      commitment: 'confirmed',
    });

    const pricePerToken = CONFIG.buyAmountSol / estimatedTokens;

    addPosition({
      mint: mint.toBase58(),
      symbol,
      source: 'pumpfun',
      buyPrice: pricePerToken,
      buySolAmount: CONFIG.buyAmountSol,
      tokenAmount: estimatedTokens,
      takeProfitPrice: pricePerToken * CONFIG.takeProfitMultiplier,
      stopLossPrice: pricePerToken * (1 - CONFIG.stopLossPercent),
      openedAt: Date.now(),
      txBuy: sig,
    });

    log.success(`Pump.fun buy geslaagd! TX: ${sig}`);
    return { success: true, txSignature: sig, tokenAmount: estimatedTokens, pricePerToken };

  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error(`Pump.fun buy mislukt: ${error}`);
    return { success: false, error };
  }
}

// Schat token amount op basis van bonding curve state
async function estimatePumpfunTokenAmount(
  bondingCurve: PublicKey,
  solLamports: number,
): Promise<number> {
  const info = await connection.getAccountInfo(bondingCurve);
  if (!info) return 0;

  // Pump.fun bonding curve layout (na discriminator van 8 bytes):
  // virtualTokenReserves: u64 (offset 8)
  // virtualSolReserves:   u64 (offset 16)
  const data = info.data;
  const virtualTokenReserves = Number(data.readBigUInt64LE(8));
  const virtualSolReserves = Number(data.readBigUInt64LE(16));

  if (virtualSolReserves === 0) return 0;

  // k = virtualTokenReserves * virtualSolReserves (constant product)
  const k = virtualTokenReserves * virtualSolReserves;
  const newSolReserves = virtualSolReserves + solLamports;
  const newTokenReserves = k / newSolReserves;
  return virtualTokenReserves - newTokenReserves;
}
