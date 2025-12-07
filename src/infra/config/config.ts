import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

export type AppConfig = {
  app: {
    name: string;
    env: 'development' | 'production' | 'test';
  };
  logger: {
    level: 'debug' | 'info' | 'warn' | 'error';
    transport: 'console';
  };
  adapters?: {
    qq?: {
      enabled?: boolean;
      wsPort?: number;
    };
  };
};

let cachedConfig: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;
  const filePath = resolve(process.cwd(), 'config', 'default.yaml');
  const raw = readFileSync(filePath, 'utf-8');
  const cfg = parse(raw) as Partial<AppConfig>;
  const env = (process.env.NODE_ENV as AppConfig['app']['env']) || cfg?.app?.env || 'development';
  cachedConfig = {
    app: {
      name: cfg?.app?.name ?? 'ArxsBot',
      env,
    },
    logger: {
      level: (cfg?.logger?.level as AppConfig['logger']['level']) ?? 'info',
      transport: 'console',
    },
    adapters: {
      qq: {
        enabled: cfg?.adapters?.qq?.enabled ?? true,
        wsPort: cfg?.adapters?.qq?.wsPort ?? 6090,
      },
    },
  };
  return cachedConfig;
}

// console.log(loadConfig());

export const config: AppConfig = loadConfig();
