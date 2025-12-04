import type { AppConfig } from '../config/config.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  info(context: string, message: string): void;
  debug(context: string, message: string): void;
  warn(context: string, message: string): void;
  error(context: string, message: string): void;
}

function shouldLog(level: LogLevel, current: LogLevel): boolean {
  const order: LogLevel[] = ['debug', 'info', 'warn', 'error'];
  return order.indexOf(level) >= order.indexOf(current);
}

export function createLogger(cfg: AppConfig): Logger {
  const currentLevel = cfg.logger.level ?? 'info';
  const base = (level: LogLevel) => (context: string, message: string) => {
    if (!shouldLog(level, currentLevel)) return;
    const ts = new Date().toISOString();
    const line = `${ts} ${level.toUpperCase()} [${context}] ${message}`;
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
