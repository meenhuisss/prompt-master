import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { CONFIG } from './config';
import { log } from './utils/logger';

export const connection = new Connection(CONFIG.rpcUrl, {
  commitment: 'confirmed',
  wsEndpoint: CONFIG.wsUrl,
});

export const wallet: Keypair = Keypair.fromSecretKey(
  bs58.decode(CONFIG.privateKey)
);

export async function checkBalance(): Promise<number> {
  const lamports = await connection.getBalance(wallet.publicKey);
  const sol = lamports / LAMPORTS_PER_SOL;
  log.info(`Wallet: ${wallet.publicKey.toBase58()}`);
  log.info(`Balance: ${sol.toFixed(4)} SOL`);
  if (sol < CONFIG.buyAmountSol * 2) {
    log.warn(`Lage balance! Minimaal ${CONFIG.buyAmountSol * 2} SOL aanbevolen.`);
  }
  return sol;
}

export function pubkey(address: string): PublicKey {
  return new PublicKey(address);
}
