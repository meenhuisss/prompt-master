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
  maxSlippage: parseFloat(process.env.MAX_SLIPPAGE ?? '0.3'),
  strategy: (process.env.STRATEGY ?? 'both') as 'pumpfun' | 'raydium' | 'both',
  maxOpenPositions: parseInt(process.env.MAX_OPEN_POSITIONS ?? '3'),

  // Sell strategie (partial sells + trailing stop)
  // Fase 1: verkoop PARTIAL_SELL_1_PERCENT% van je tokens bij 2x → inleg terug + winst
  // Fase 2: verkoop PARTIAL_SELL_2_PERCENT% bij 5x → grote winst
  // Rest: trailing stop van TRAILING_STOP_PERCENT% onder ATH
  partialSell1Multiplier: parseFloat(process.env.PARTIAL_SELL_1_MULTIPLIER ?? '2'),   // 2x
  partialSell1Percent: parseFloat(process.env.PARTIAL_SELL_1_PERCENT ?? '0.50'),      // 50% van tokens
  partialSell2Multiplier: parseFloat(process.env.PARTIAL_SELL_2_MULTIPLIER ?? '5'),   // 5x
  partialSell2Percent: parseFloat(process.env.PARTIAL_SELL_2_PERCENT ?? '0.30'),      // 30% van tokens
  // Resterende 20% loopt door met trailing stop (kan 10x, 50x, 100x worden)
  trailingStopPercent: parseFloat(process.env.TRAILING_STOP_PERCENT ?? '0.20'),       // -20% van peak

  // Rug pull bescherming
  stopLossPercent: parseFloat(process.env.STOP_LOSS_PERCENT ?? '0.05'), // hard stop: -5%

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
