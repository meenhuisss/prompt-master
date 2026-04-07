import chalk from 'chalk';

type LogLevel = 'info' | 'success' | 'warn' | 'error' | 'trade';

function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

export const log = {
  info: (msg: string) =>
    console.log(`${chalk.gray(timestamp())} ${chalk.blue('[INFO]')} ${msg}`),

  success: (msg: string) =>
    console.log(`${chalk.gray(timestamp())} ${chalk.green('[OK]  ')} ${msg}`),

  warn: (msg: string) =>
    console.log(`${chalk.gray(timestamp())} ${chalk.yellow('[WARN]')} ${msg}`),

  error: (msg: string) =>
    console.log(`${chalk.gray(timestamp())} ${chalk.red('[ERR] ')} ${msg}`),

  trade: (msg: string) =>
    console.log(`${chalk.gray(timestamp())} ${chalk.magenta('[TRADE]')} ${msg}`),
};
