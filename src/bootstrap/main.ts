import { config, loadConfig } from '../infra/config/config.js';
import { createLogger } from '../infra/logger/logger.js';
import { Dispatcher } from '../core/dispatcher/dispatcher.js';
import { IntentRecognizer } from '../core/intent/intentRecognizer.js';
import { ChatAiHandler } from '../apps/chatAi/chatAiHandler.js';
import { IntentType } from '../core/model/Intent.js';

let dispatcher: Dispatcher | null = null;

export async function start() {
	const cfg = config || loadConfig();
	const logger = createLogger(cfg);
	logger.info('bootstrap', `Starting ${cfg.app.name} in ${cfg.app.env}`);

	// Initialize intent recognizer and dispatcher
	const intentRecognizer = new IntentRecognizer();
	dispatcher = new Dispatcher(logger, intentRecognizer);

	// Register handlers
	const chatAiHandler = new ChatAiHandler();
	dispatcher.registerHandler(`intent:${IntentType.SimpleChat}`, (event, context, intent) =>
		chatAiHandler.handle(event, context, intent),
	);

	logger.info('bootstrap', 'Handlers registered');
}

export function getDispatcher(): Dispatcher | null {
	return dispatcher;
}
