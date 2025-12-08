import { config, loadConfig } from '../infra/config/config.js';
import { createLogger } from '../infra/logger/logger.js';
import { MainRouter } from '../core/router/MainRouter.js';
import { CommandRouter } from '../core/command/CommandRouter.js';
import { PingCommand, HelpCommand, DebugCommand } from '../core/command/builtin/index.js';
import { OpenAICompatibleClient } from '../core/llm/openaiClient.js';
import { SimpleReplyer } from '../core/chat/SimpleReplyer.js';
import { InMemoryConversationStore } from '../core/memory/ConversationStore.js';
import { QQAdapter } from '../adapter/qq/QQAdapter.js';

let qqAdapter: QQAdapter | null = null;

export async function start() {
  // Load config and create logger
  const cfg = config || loadConfig();
  const logger = createLogger(cfg);
  logger.info(
    'bootstrap',
    `Starting ${cfg.app.name} in ${cfg.app.env} (with Planner + Commands + LLM)`,
  );

  // Create a dummy sender for router initialization
  // This will be replaced per-connection in QQAdapter
  const dummySender: any = {
    sendText: async () => {
      throw new Error('Sender not initialized');
    },
  };

  // Initialize conversation store for multi-turn conversations
  const conversationStore = new InMemoryConversationStore();

  // Initialize command router with builtin commands
  const commandRouter = new CommandRouter(dummySender, logger, [
    PingCommand,
    HelpCommand,
    DebugCommand,
  ]);

  // Initialize LLM client and replyer if enabled
  let replyer: SimpleReplyer | undefined;
  if (cfg.llm?.enabled && cfg.llm.apiKey) {
    logger.info('bootstrap', `Initializing LLM (${cfg.llm.model})...`);
    const llmClient = new OpenAICompatibleClient(logger, {
      baseUrl: cfg.llm.baseUrl!,
      apiKey: cfg.llm.apiKey,
      model: cfg.llm.model!,
      temperature: cfg.llm.temperature,
      maxTokens: cfg.llm.maxTokens,
    });
    replyer = new SimpleReplyer(llmClient, logger, conversationStore);
  } else {
    logger.warn('bootstrap', 'LLM not configured - smalltalk will use simple echo fallback');
  }

  // Initialize main router with command router, replyer, and conversation store
  const router = new MainRouter(logger, dummySender, commandRouter, replyer, conversationStore);

  // Start QQ adapter if enabled
  if (cfg.adapters?.qq?.enabled) {
    logger.info('bootstrap', 'Starting QQ adapter...');
    qqAdapter = new QQAdapter(router, logger, cfg.adapters.qq.wsPort, cfg.adapters.qq.token);
    qqAdapter.start();
  } else if (cfg.adapters?.qq) {
    logger.warn('bootstrap', 'QQ adapter disabled (missing token or config)');
  }
}

export function getQQAdapter(): QQAdapter | null {
  return qqAdapter;
}
