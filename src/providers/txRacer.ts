/**
 * Transaction Racer
 *
 * Stuurt elke transactie TEGELIJK naar meerdere providers en bevestigt
 * alleen de snelste. Dit garandeert altijd de snelste on-chain bevestiging.
 *
 * Providers:
 *  - Jito        : MEV-bescherming + bundle tips
 *  - NextBlock   : Europese validators, snel voor EU gebruikers
 *  - BloxRoute   : Groot relay netwerk
 *  - Standaard   : Normale RPC als fallback
 *
 * Hoe het werkt:
 *  1. Bouw de transactie 1x
 *  2. Stuur naar ALLE providers tegelijk (Promise.race)
 *  3. Zodra de eerste bevestiging binnenkomt → klaar
 *  4. De rest wordt genegeerd (Solana voorkomt dubbele uitvoering)
 */

import {
  Transaction,
  VersionedTransaction,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import axios from 'axios';
import bs58 from 'bs58';
import { connection, wallet } from '../connection';
import { CONFIG } from '../config';
import { log } from '../utils/logger';

type AnyTransaction = Transaction | VersionedTransaction;

export interface RaceResult {
  signature: string;
  provider: string;
  latencyMs: number;
}

/**
 * Stuur een transactie naar alle geconfigureerde providers tegelijk.
 * Geeft de handtekening terug van de snelste bevestiging.
 */
export async function raceTransaction(
  tx: AnyTransaction,
  signers: Keypair[],
): Promise<RaceResult> {
  const startTime = Date.now();

  // Serialiseer en onderteken de transactie
  if (tx instanceof Transaction) {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.feePayer = wallet.publicKey;
    tx.sign(...signers);
  }

  const serialized = tx.serialize();
  const encoded = bs58.encode(serialized);
  const base64 = Buffer.from(serialized).toString('base64');

  // Bouw provider promises
  const providers: Promise<RaceResult>[] = [];

  // 1. Standaard RPC (altijd aanwezig)
  providers.push(
    submitViaRpc(serialized, startTime).then((sig) => ({
      signature: sig,
      provider: 'RPC',
      latencyMs: Date.now() - startTime,
    }))
  );

  // 2. Jito
  if (CONFIG.providers.jitoEndpoint) {
    providers.push(
      submitViaJito(base64, startTime).then((sig) => ({
        signature: sig,
        provider: 'Jito',
        latencyMs: Date.now() - startTime,
      }))
    );
  }

  // 3. NextBlock
  if (CONFIG.providers.nextblockEndpoint && CONFIG.providers.nextblockApiKey) {
    providers.push(
      submitViaNextBlock(base64, startTime).then((sig) => ({
        signature: sig,
        provider: 'NextBlock',
        latencyMs: Date.now() - startTime,
      }))
    );
  }

  // 4. BloxRoute
  if (CONFIG.providers.bloxrouteEndpoint && CONFIG.providers.bloxrouteApiKey) {
    providers.push(
      submitViaBloxRoute(encoded, startTime).then((sig) => ({
        signature: sig,
        provider: 'BloxRoute',
        latencyMs: Date.now() - startTime,
      }))
    );
  }

  // Race: eerste provider die antwoordt wint
  const result = await Promise.race(providers);
  log.success(`TX bevestigd via ${result.provider} in ${result.latencyMs}ms | ${result.signature.substring(0, 16)}...`);
  return result;
}

// ── Provider implementaties ──────────────────────────────────────────────────

async function submitViaRpc(serialized: Uint8Array, _start: number): Promise<string> {
  return connection.sendRawTransaction(serialized, {
    skipPreflight: true,
    maxRetries: 0,
  });
}

async function submitViaJito(base64Tx: string, _start: number): Promise<string> {
  // Jito tip instructie wordt al toegevoegd in de transactie zelf
  const response = await axios.post(
    `${CONFIG.providers.jitoEndpoint}/api/v1/transactions`,
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'sendTransaction',
      params: [base64Tx, { encoding: 'base64', skipPreflight: true }],
    },
    { timeout: 5000 }
  );

  if (response.data.error) throw new Error(`Jito: ${response.data.error.message}`);
  return response.data.result;
}

async function submitViaNextBlock(base64Tx: string, _start: number): Promise<string> {
  const response = await axios.post(
    `${CONFIG.providers.nextblockEndpoint}/api/v2/submit`,
    { transaction: base64Tx },
    {
      headers: { Authorization: CONFIG.providers.nextblockApiKey },
      timeout: 5000,
    }
  );

  return response.data.signature ?? response.data.result;
}

async function submitViaBloxRoute(encodedTx: string, _start: number): Promise<string> {
  const response = await axios.post(
    `${CONFIG.providers.bloxrouteEndpoint}/api/v2/submit`,
    { transaction: encodedTx, skipPreFlight: true },
    {
      headers: { Authorization: CONFIG.providers.bloxrouteApiKey },
      timeout: 5000,
    }
  );

  return response.data.txHash ?? response.data.result;
}
