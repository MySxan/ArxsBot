import { config, loadConfig } from '../infra/config/config.js';
import { createLogger } from '../infra/logger/logger.js';
import { Dispatcher } from '../core/dispatcher/dispatcher.js';
import { IntentRecognizer } from '../core/intent/intentRecognizer.js';
import { ChatAiHandler } from '../apps/chatAi/chatAiHandler.js';
import { startMockAdapter } from '../adapter/index.js';
import { NapcatClient } from '../adapter/qq/napcatClient.js';
import { loggingMiddleware } from '../core/dispatcher/middleware/loggingMiddleware.js';

let dispatcher: Dispatcher | null = null;

export async function start() {
  // Load/create config and create logger
  const cfg = config || loadConfig();
  const logger = createLogger(cfg);
  logger.info('bootstrap', `Starting ${cfg.app.name} in ${cfg.app.env}`);

  // Initialize intent recognizer and dispatcher
  const intentRecognizer = new IntentRecognizer();
  dispatcher = new Dispatcher(logger, intentRecognizer);

  // Register logging middleware for visibility
  dispatcher.useBefore((event, context, next) => loggingMiddleware(event, context, next, logger));

  // Register handlers using metadata auto-registration
  dispatcher.registerHandlerClass(ChatAiHandler);

  logger.info('bootstrap', 'Handlers registered');

  // Start QQ/NapCat adapter if enabled
  if (cfg.adapters?.qq?.enabled) {
    const napcatClient = new NapcatClient(dispatcher, logger, cfg.adapters.qq.wsPort);
    napcatClient.start();
  }

  // Start mock CLI adapter for development
  startMockAdapter(dispatcher);
}

export function getDispatcher(): Dispatcher | null {
  return dispatcher;
}
