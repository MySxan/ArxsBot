import { config, loadConfig } from '../infra/config/config.js';
import { createLogger } from '../infra/logger/logger.js';

export async function start() {
	const cfg = config || loadConfig();
	const logger = createLogger(cfg);
	logger.info('bootstrap', `Starting ${cfg.app.name} in ${cfg.app.env}`);
}
