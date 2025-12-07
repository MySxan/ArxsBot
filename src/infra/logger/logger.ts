import chalk from 'chalk';
import type { AppConfig } from '../config/config.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  info(context: string, message: string): void;
  debug(context: string, message: string): void;
  warn(context: string, message: string): void;
  error(context: string, message: string): void;
}

// Level 颜色映射
const LEVEL_COLORS = {
  debug: chalk.bgBlue.black,
  info: chalk.bgGreen.black,
  warn: chalk.bgYellow.black,
  error: chalk.bgRed.white,
};

// 模块名颜色（稳定但区分）
const MODULE_COLORS = [chalk.cyan, chalk.magenta, chalk.blue, chalk.green, chalk.yellow];

// 模块名缓存
const moduleColorMap = new Map<string, (text: string) => string>();

function getModuleColor(context: string): (text: string) => string {
  if (!moduleColorMap.has(context)) {
    const hash = context.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const color = MODULE_COLORS[hash % MODULE_COLORS.length];
    moduleColorMap.set(context, color);
  }
  return moduleColorMap.get(context)!;
}

// check if a message at 'level' should be logged given the current log level
function shouldLog(level: LogLevel, current: LogLevel): boolean {
  const order: LogLevel[] = ['debug', 'info', 'warn', 'error'];
  return order.indexOf(level) >= order.indexOf(current);
}

function formatTimestamp(): string {
  const d = new Date();
  return d.toISOString().replace('T', ' ').replace('Z', '').slice(0, -1);
}

export function createLogger(cfg: AppConfig): Logger {
  const currentLevel = cfg.logging?.level ?? cfg.logger.level ?? 'info';
  const colorEnabled = cfg.logging?.color ?? true;

  const base = (level: LogLevel) => (context: string, message: string) => {
    if (!shouldLog(level, currentLevel)) return;

    const ts = colorEnabled ? chalk.gray(formatTimestamp()) : formatTimestamp();
    const levelTag = LEVEL_COLORS[level](` ${level.toUpperCase()} `);
    const moduleTag = colorEnabled ? getModuleColor(context)(`[${context}]`) : `[${context}]`;

    const line = `${ts} ${levelTag} ${moduleTag} ${message}`;
    switch (level) {
      case 'debug':
      case 'info':
        console.log(line);
        break;
      case 'warn':
        console.warn(line);
        break;
      case 'error':
        console.error(line);
        break;
    }
  };
  return {
    info: base('info'),
    debug: base('debug'),
    warn: base('warn'),
    error: base('error'),
  };
}
