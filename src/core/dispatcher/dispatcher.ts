import type { Event, EventType } from '../model/Event.js';
import type { Action } from '../model/Action.js';
import type { Context } from '../model/Context.js';
import type { Logger } from '../../infra/logger/logger.js';
import { HandlerRegistry } from './handlerRegistry.js';
import { EventRouter, PipelineType } from '../router/eventRouter.js';

export type MiddlewareFunc = (
	event: Event,
	context: Context,
	next: () => Promise<Action[]>,
) => Promise<Action[]>;

export class Dispatcher {
	private router: EventRouter;
	private registry: HandlerRegistry;
	private beforeMiddleware: MiddlewareFunc[] = [];
	private afterMiddleware: MiddlewareFunc[] = [];
	private logger: Logger;

	constructor(logger: Logger) {
		this.router = new EventRouter();
		this.registry = new HandlerRegistry();
		this.logger = logger;
	}

	public registerHandler(
		key: string,
		handler: (event: Event, context: Context) => Promise<Action[]>,
	): void {
		this.registry.register(key, handler);
	}

	public useBefore(middleware: MiddlewareFunc): void {
		this.beforeMiddleware.push(middleware);
	}

	public useAfter(middleware: MiddlewareFunc): void {
		this.afterMiddleware.push(middleware);
	}

	public async dispatch(event: Event, context: Context): Promise<Action[]> {
		try {
			const pipeline = this.router.route(event, context);
			const handlerKey = this.getHandlerKey(event, pipeline);

			this.logger.debug('dispatcher', `Routing event ${event.type} to pipeline ${pipeline}`);

			// Run before middleware chain
			let actions = await this.runMiddlewareChain(
				this.beforeMiddleware,
				event,
				context,
				() => this.executeHandler(event, context, handlerKey),
			);

			// Run after middleware chain
			actions = await this.runMiddlewareChain(
				this.afterMiddleware,
				event,
				context,
				async () => actions,
			);

			this.logger.debug('dispatcher', `Dispatched ${actions.length} action(s)`);
			return actions;
		} catch (err) {
			this.logger.error('dispatcher', `Dispatch failed: ${err instanceof Error ? err.message : String(err)}`);
			return [];
		}
	}

	private async executeHandler(
		event: Event,
		context: Context,
		handlerKey: string,
	): Promise<Action[]> {
		const handler = this.registry.get(handlerKey);
		if (!handler) {
			this.logger.warn('dispatcher', `No handler found for key: ${handlerKey}`);
			return [];
		}
		return handler(event, context);
	}

	private async runMiddlewareChain(
		middleware: MiddlewareFunc[],
		event: Event,
		context: Context,
		final: () => Promise<Action[]>,
	): Promise<Action[]> {
		if (middleware.length === 0) return final();

		let index = -1;
		const dispatch = async (i: number): Promise<Action[]> => {
			if (i <= index) {
				throw new Error('next() called multiple times');
			}
			index = i;

			let fn: () => Promise<Action[]>;
			if (i === middleware.length) {
				fn = final;
			} else {
				fn = () => dispatch(i + 1);
			}

			try {
				return await middleware[i](event, context, fn);
			} catch (err) {
				this.logger.error('dispatcher', `Middleware error: ${err instanceof Error ? err.message : String(err)}`);
				throw err;
			}
		};

		return dispatch(0);
	}

	private getHandlerKey(event: Event, pipeline: PipelineType): string {
		return `${pipeline}:${event.type}`;
	}
}
