/**
 * Rug Pull Safety Module
 *
 * Controleert een token op meerdere risico-indicatoren voordat er gekocht wordt.
 * Elke check geeft een reden terug zodat je in de logs ziet waarom een token geweigerd werd.
 *
 * Checks die uitgevoerd worden:
 *  1. Mint authority niet ingetrokken  → creator kan onbeperkt tokens printen
 *  2. Freeze authority aanwezig        → creator kan jouw tokens bevriezen
 *  3. Bonding curve te ver gevorderd   → te laat, FOMO trap (>80% vol)
 *  4. Bonding curve te leeg            → nep launch, niemand koopt
 *  5. Top-3 wallets hebben >40%        → whale dump risico
 *  6. Dev kocht al >10% supply         → insider dump risico
 *  7. Prijs al >5x gestegen            → te laat, jij bent de exit liquidity
 */

import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getMint } from '@solana/spl-token';
import { connection } from '../connection';
import { CONFIG } from '../config';
import { log } from '../utils/logger';

export interface SafetyResult {
  safe: boolean;
  reason?: string;
  score: number; // 0-100, hoe hoger hoe veiliger
}

// Pump.fun bonding curve layout offsets
const BC_VIRTUAL_TOKEN_RESERVES_OFFSET = 8;
const BC_VIRTUAL_SOL_RESERVES_OFFSET = 16;
const BC_REAL_TOKEN_RESERVES_OFFSET = 24;
const BC_REAL_SOL_RESERVES_OFFSET = 32;
const BC_TOKEN_TOTAL_SUPPLY_OFFSET = 40;
const BC_COMPLETE_OFFSET = 48; // bool: migration naar Raydium voltooid

// Pump.fun start waarden (voor progress berekening)
const INITIAL_VIRTUAL_TOKEN_RESERVES = 1_073_000_000_000_000; // ~1.073B tokens
const INITIAL_VIRTUAL_SOL_RESERVES = 30_000_000_000; // 30 SOL in lamports

export async function runRugcheck(
  mint: PublicKey,
  bondingCurve: PublicKey,
  creatorWallet?: PublicKey,
): Promise<SafetyResult> {
  const checks: string[] = [];
  let score = 100;

  try {
    // ── Check 1: Mint authority ─────────────────────────────────────────
    // Als mint authority NIET null is, kan de creator nieuwe tokens aanmaken.
    // Pump.fun revokes dit automatisch, maar gemanipuleerde tokens soms niet.
    const mintInfo = await getMint(connection, mint);

    if (mintInfo.mintAuthority !== null) {
      log.warn(`[RUGCHECK] ❌ Mint authority NIET ingetrokken: ${mint.toBase58().substring(0, 8)}`);
      return { safe: false, reason: 'Mint authority niet ingetrokken (kan tokens printen)', score: 0 };
    }
    checks.push('✓ Mint authority ingetrokken');

    // ── Check 2: Freeze authority ───────────────────────────────────────
    // Als freeze authority aanwezig is, kan de creator jouw tokens bevriezen.
    if (mintInfo.freezeAuthority !== null) {
      log.warn(`[RUGCHECK] ❌ Freeze authority aanwezig: ${mint.toBase58().substring(0, 8)}`);
      return { safe: false, reason: 'Freeze authority aanwezig (kan tokens bevriezen)', score: 0 };
    }
    checks.push('✓ Freeze authority ingetrokken');

    // ── Check 3: Bonding curve status ───────────────────────────────────
    const bcInfo = await connection.getAccountInfo(bondingCurve);
    if (!bcInfo) {
      return { safe: false, reason: 'Bonding curve bestaat niet', score: 0 };
    }

    const data = bcInfo.data;

    // Check of bonding curve al completed (= al naar Raydium gemigreerd)
    const isComplete = data[BC_COMPLETE_OFFSET] === 1;
    if (isComplete) {
      return { safe: false, reason: 'Token al gemigreerd naar Raydium', score: 0 };
    }

    const virtualTokenReserves = Number(data.readBigUInt64LE(BC_VIRTUAL_TOKEN_RESERVES_OFFSET));
    const virtualSolReserves = Number(data.readBigUInt64LE(BC_VIRTUAL_SOL_RESERVES_OFFSET));
    const realSolReserves = Number(data.readBigUInt64LE(BC_REAL_SOL_RESERVES_OFFSET));

    // ── Check 4: Bonding curve liquiditeit ─────────────────────────────
    const solInCurve = realSolReserves / LAMPORTS_PER_SOL;
    if (solInCurve < CONFIG.minLiquiditySol) {
      return {
        safe: false,
        reason: `Te weinig liquiditeit: ${solInCurve.toFixed(2)} SOL (min: ${CONFIG.minLiquiditySol})`,
        score: 10,
      };
    }
    checks.push(`✓ Liquiditeit: ${solInCurve.toFixed(2)} SOL`);

    // ── Check 5: Bonding curve voortgang ───────────────────────────────
    // Pump.fun heeft ~85 SOL nodig om de curve te voltooien.
    // Als >80% gevuld → te laat, jij bent exit liquidity.
    const TARGET_SOL = 85 * LAMPORTS_PER_SOL;
    const progress = realSolReserves / TARGET_SOL;

    if (progress > 0.80) {
      score -= 30;
      log.warn(`[RUGCHECK] ⚠️  Curve ${(progress * 100).toFixed(0)}% vol — laat instap`);
      checks.push(`⚠️  Curve ${(progress * 100).toFixed(0)}% vol (hoog risico)`);
    } else if (progress > 0.50) {
      score -= 10;
      checks.push(`⚠️  Curve ${(progress * 100).toFixed(0)}% vol (matig)`);
    } else {
      checks.push(`✓ Curve ${(progress * 100).toFixed(0)}% vol (vroeg instap)`);
    }

    // ── Check 6: Prijs stijging ─────────────────────────────────────────
    // Vergelijk huidige prijs met startprijs.
    // Als >5x gestegen → jij bent de FOMO koper, anderen dumpen op jou.
    const currentPrice = virtualSolReserves / virtualTokenReserves;
    const initialPrice = INITIAL_VIRTUAL_SOL_RESERVES / INITIAL_VIRTUAL_TOKEN_RESERVES;
    const priceMultiple = currentPrice / initialPrice;

    if (priceMultiple > 10) {
      score -= 40;
      log.warn(`[RUGCHECK] ⚠️  Prijs al ${priceMultiple.toFixed(1)}x gestegen — zeer laat`);
      checks.push(`⚠️  Prijs ${priceMultiple.toFixed(1)}x gestegen (FOMO risico)`);
    } else if (priceMultiple > 5) {
      score -= 20;
      checks.push(`⚠️  Prijs ${priceMultiple.toFixed(1)}x gestegen`);
    } else {
      checks.push(`✓ Prijs ${priceMultiple.toFixed(1)}x gestegen (acceptabel)`);
    }

    // ── Check 7: Top holder concentratie ───────────────────────────────
    // Haal de 20 grootste token holders op.
    // Als top 3 samen >40% hebben → dump risico.
    const holderCheck = await checkHolderConcentration(mint, mintInfo.supply);
    if (!holderCheck.safe) {
      score -= 30;
      log.warn(`[RUGCHECK] ⚠️  ${holderCheck.reason}`);
      checks.push(`⚠️  ${holderCheck.reason}`);
    } else {
      checks.push(`✓ ${holderCheck.reason}`);
    }

    // ── Check 8: Dev wallet ─────────────────────────────────────────────
    if (creatorWallet) {
      const devCheck = await checkDevWallet(mint, creatorWallet, mintInfo.supply);
      if (!devCheck.safe) {
        score -= 25;
        log.warn(`[RUGCHECK] ⚠️  ${devCheck.reason}`);
        checks.push(`⚠️  ${devCheck.reason}`);
      } else {
        checks.push(`✓ ${devCheck.reason}`);
      }
    }

    // ── Eindoordeel ─────────────────────────────────────────────────────
    const safe = score >= 60;

    log.info(`[RUGCHECK] ${safe ? '✅' : '❌'} Score: ${score}/100 | ${mint.toBase58().substring(0, 8)}`);
    checks.forEach((c) => log.info(`  ${c}`));

    return {
      safe,
      reason: safe ? undefined : `Score te laag (${score}/100): zie logs`,
      score,
    };

  } catch (err) {
    log.error(`Rugcheck fout: ${err instanceof Error ? err.message : String(err)}`);
    return { safe: false, reason: 'Rugcheck mislukt (technische fout)', score: 0 };
  }
}

// Controleer top holder concentratie via token largest accounts
async function checkHolderConcentration(
  mint: PublicKey,
  totalSupply: bigint,
): Promise<{ safe: boolean; reason: string }> {
  try {
    const largestAccounts = await connection.getTokenLargestAccounts(mint);
    const accounts = largestAccounts.value.slice(0, 3); // top 3

    if (accounts.length === 0) return { safe: true, reason: 'Geen holder data' };

    const top3Amount = accounts.reduce((sum, a) => sum + BigInt(a.amount), 0n);
    const top3Percent = Number((top3Amount * 10000n) / totalSupply) / 100;

    if (top3Percent > CONFIG.maxTop10Percent * 100 * 0.4) {
      return {
        safe: false,
        reason: `Top 3 wallets bezitten ${top3Percent.toFixed(1)}% (max: ${(CONFIG.maxTop10Percent * 40).toFixed(0)}%)`,
      };
    }

    return { safe: true, reason: `Top 3 wallets: ${top3Percent.toFixed(1)}% (acceptabel)` };
  } catch {
    return { safe: true, reason: 'Holder check overgeslagen (RPC fout)' };
  }
}

// Controleer hoeveel % de dev wallet heeft
async function checkDevWallet(
  mint: PublicKey,
  devWallet: PublicKey,
  totalSupply: bigint,
): Promise<{ safe: boolean; reason: string }> {
  try {
    const devTokenAccounts = await connection.getTokenAccountsByOwner(devWallet, { mint });
    if (devTokenAccounts.value.length === 0) {
      return { safe: true, reason: 'Dev wallet heeft geen tokens' };
    }

    const devBalance = await connection.getTokenAccountBalance(
      devTokenAccounts.value[0].pubkey
    );
    const devAmount = BigInt(devBalance.value.amount);
    const devPercent = Number((devAmount * 10000n) / totalSupply) / 100;

    if (devPercent > CONFIG.maxDevWalletPercent * 100) {
      return {
        safe: false,
        reason: `Dev wallet heeft ${devPercent.toFixed(1)}% (max: ${(CONFIG.maxDevWalletPercent * 100).toFixed(0)}%)`,
      };
    }

    return { safe: true, reason: `Dev wallet: ${devPercent.toFixed(1)}%` };
  } catch {
    return { safe: true, reason: 'Dev check overgeslagen (RPC fout)' };
  }
}
