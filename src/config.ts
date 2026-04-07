import dotenv from 'dotenv';
dotenv.config();

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missende omgevingsvariabele: ${key}`);
  return value;
}

export const CONFIG = {
  // Wallet & RPC
  privateKey: required('PRIVATE_KEY'),
  rpcUrl: required('RPC_URL'),
  wsUrl: required('WS_URL'),

  // Trading
  buyAmountSol: parseFloat(process.env.BUY_AMOUNT_SOL ?? '0.05'),
  takeProfitMultiplier: parseFloat(process.env.TAKE_PROFIT_MULTIPLIER ?? '3'),
  stopLossPercent: parseFloat(process.env.STOP_LOSS_PERCENT ?? '0.5'),
  maxSlippage: parseFloat(process.env.MAX_SLIPPAGE ?? '0.3'),
  strategy: (process.env.STRATEGY ?? 'both') as 'pumpfun' | 'raydium' | 'both',
  maxOpenPositions: parseInt(process.env.MAX_OPEN_POSITIONS ?? '3'),

  // Filters
  minLiquiditySol: parseFloat(process.env.MIN_LIQUIDITY_SOL ?? '10'),
  maxDevWalletPercent: parseFloat(process.env.MAX_DEV_WALLET_PERCENT ?? '0.15'),
  maxTop10Percent: parseFloat(process.env.MAX_TOP10_PERCENT ?? '0.5'),

  // Jito
  useJito: process.env.USE_JITO === 'true',
  jitoTipLamports: parseInt(process.env.JITO_TIP_LAMPORTS ?? '10000'),

  // Solana program IDs
  programs: {
    pumpfun: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
    raydiumAmm: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
    raydiumCpmm: 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C',
    tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    associatedTokenProgram: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1brs',
    systemProgram: '11111111111111111111111111111111',
  },
} as const;
