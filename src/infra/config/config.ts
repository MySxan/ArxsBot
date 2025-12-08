import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

export type AppConfig = {
  app: {
    name: string;
    env: 'dev' | 'prod' | 'test';
  };
  logger: {
    level: 'debug' | 'info' | 'warn' | 'error';
    transport: 'console';
  };
  logging?: {
    color?: boolean;
    level?: 'debug' | 'info' | 'warn' | 'error';
  };
  adapters?: {
    qq?: {
      enabled?: boolean;
      wsPort?: number;
      token?: string;
    };
  };
  llm?: {
    enabled?: boolean;
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  };
};

let cachedConfig: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;
  const filePath = resolve(process.cwd(), 'config', 'default.yaml');
  const raw = readFileSync(filePath, 'utf-8');
  const cfg = parse(raw) as Partial<AppConfig>;
  const env = (process.env.NODE_ENV as AppConfig['app']['env']) || cfg?.app?.env || 'prod';
  cachedConfig = {
    app: {
      name: cfg?.app?.name ?? 'ArxsBot',
      env,
    },
    logger: {
      level: (cfg?.logger?.level as AppConfig['logger']['level']) ?? 'info',
      transport: 'console',
    },
    logging: {
      color: cfg?.logging?.color ?? true,
      level: (cfg?.logging?.level as AppConfig['logger']['level']) ?? cfg?.logger?.level ?? 'info',
    },
    adapters: {
      qq: {
        enabled: cfg?.adapters?.qq?.enabled ?? true,
        wsPort: cfg?.adapters?.qq?.wsPort ?? 6090,
        token: cfg?.adapters?.qq?.token
          ? String(cfg.adapters.qq.token)
          : process.env.QQ_ADAPTER_TOKEN,
      },
    },
    llm: {
      enabled: cfg?.llm?.enabled ?? false,
      baseUrl: cfg?.llm?.baseUrl ?? process.env.LLM_BASE_URL ?? 'https://api.deepseek.com/v1',
      apiKey: cfg?.llm?.apiKey ?? process.env.LLM_API_KEY,
      model: cfg?.llm?.model ?? process.env.LLM_MODEL ?? 'deepseek-chat',
      temperature: cfg?.llm?.temperature ?? 1,
      maxTokens: cfg?.llm?.maxTokens ?? 2000,
    },
  };

  // Auto-disable QQ adapter if token is missing in prod (warn instead of fail)
  if (cachedConfig.adapters?.qq?.enabled && cachedConfig.app.env === 'prod') {
    if (!cachedConfig.adapters.qq.token) {
      console.warn(
        '[CONFIG] QQ adapter enabled in prod but no token configured. Disabling adapter. Set adapters.qq.token or QQ_ADAPTER_TOKEN to enable.',
      );
      cachedConfig.adapters.qq.enabled = false;
    }
  }
  return cachedConfig;
}

// console.log(loadConfig());

export const config: AppConfig = loadConfig();
