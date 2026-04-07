import dotenv from 'dotenv';
dotenv.config();

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missende omgevingsvariabele: ${key}`);
  return value;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const CONFIG = {
  // ── Wallet & RPC ────────────────────────────────────────────────────────
  privateKey: required('PRIVATE_KEY'),
  rpcUrl: required('RPC_URL'),
  wsUrl: required('WS_URL'),

  // ── Modus ───────────────────────────────────────────────────────────────
  dryRun: process.env.DRY_RUN === 'true',   // simuleer zonder echt geld
  strategy: (optional('STRATEGY', 'both')) as 'pumpfun' | 'pumpswap' | 'copytrading' | 'both',

  // ── Trading ─────────────────────────────────────────────────────────────
  buyAmountSol: parseFloat(optional('BUY_AMOUNT_SOL', '0.05')),
  maxSlippage: parseFloat(optional('MAX_SLIPPAGE', '0.3')),
  maxOpenPositions: parseInt(optional('MAX_OPEN_POSITIONS', '3')),

  // Dagelijks verlies limiet: stop bot als dit bedrag verloren is
  maxDailyLossSol: parseFloat(optional('MAX_DAILY_LOSS_SOL', '0.5')),

  // ── Sell strategie ───────────────────────────────────────────────────────
  partialSell1Multiplier: parseFloat(optional('PARTIAL_SELL_1_MULTIPLIER', '2')),
  partialSell1Percent: parseFloat(optional('PARTIAL_SELL_1_PERCENT', '0.50')),
  partialSell2Multiplier: parseFloat(optional('PARTIAL_SELL_2_MULTIPLIER', '5')),
  partialSell2Percent: parseFloat(optional('PARTIAL_SELL_2_PERCENT', '0.30')),
  trailingStopPercent: parseFloat(optional('TRAILING_STOP_PERCENT', '0.20')),
  stopLossPercent: parseFloat(optional('STOP_LOSS_PERCENT', '0.05')),

  // ── Filters ─────────────────────────────────────────────────────────────
  minLiquiditySol: parseFloat(optional('MIN_LIQUIDITY_SOL', '10')),
  maxDevWalletPercent: parseFloat(optional('MAX_DEV_WALLET_PERCENT', '0.15')),
  maxTop10Percent: parseFloat(optional('MAX_TOP10_PERCENT', '0.50')),

  // ── Copy Trading ─────────────────────────────────────────────────────────
  copyTrading: {
    // Komma-gescheiden lijst van wallet adressen om te kopiëren
    targetWallets: optional('COPY_WALLETS', '').split(',').filter(Boolean),
    copyBuys: process.env.COPY_BUYS !== 'false',
    copySells: process.env.COPY_SELLS === 'true',
    minTargetBuySol: parseFloat(optional('MIN_TARGET_BUY_SOL', '0.1')),
  },

  // ── Transaction Providers ───────────────────────────────────────────────
  providers: {
    // Jito: MEV-bescherming + snelle bevestiging
    jitoEndpoint: optional('JITO_ENDPOINT', 'https://mainnet.block-engine.jito.wtf'),
    jitoTipLamports: parseInt(optional('JITO_TIP_LAMPORTS', '10000')),

    // NextBlock: snel voor EU regio
    nextblockEndpoint: optional('NEXTBLOCK_ENDPOINT', ''),
    nextblockApiKey: optional('NEXTBLOCK_API_KEY', ''),

    // BloxRoute: groot relay netwerk
    bloxrouteEndpoint: optional('BLOXROUTE_ENDPOINT', ''),
    bloxrouteApiKey: optional('BLOXROUTE_API_KEY', ''),
  },

  // ── Telegram ─────────────────────────────────────────────────────────────
  telegram: {
    enabled: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
    botToken: optional('TELEGRAM_BOT_TOKEN', ''),
    chatId: optional('TELEGRAM_CHAT_ID', ''),
  },

  // ── Simulatie ────────────────────────────────────────────────────────────
  simulation: {
    startingBalance: parseFloat(optional('SIM_STARTING_BALANCE', '1.0')),
  },

  // ── Solana program IDs ───────────────────────────────────────────────────
  programs: {
    pumpfun: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
    pumpswap: 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
    raydiumAmm: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
    tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    associatedTokenProgram: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1brs',
    systemProgram: '11111111111111111111111111111111',
  },
} as const;
