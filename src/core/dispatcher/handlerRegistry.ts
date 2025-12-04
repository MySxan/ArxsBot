import type { Event } from '../model/Event.js';
import type { Action } from '../model/Action.js';
import type { Context } from '../model/Context.js';

export type Handler = (event: Event, context: Context) => Promise<Action[]>;

export class HandlerRegistry {
	private handlers: Map<string, Handler> = new Map();

	public register(key: string, handler: Handler): void {
		if (this.handlers.has(key)) {
			console.warn(`Handler key already registered: ${key}, overwriting`);
		}
		this.handlers.set(key, handler);
	}

	public get(key: string): Handler | undefined {
		return this.handlers.get(key);
	}

	public has(key: string): boolean {
		return this.handlers.has(key);
	}

	public getAll(): Map<string, Handler> {
		return new Map(this.handlers);
	}

	public clear(): void {
		this.handlers.clear();
	}

	public deregister(key: string): boolean {
		return this.handlers.delete(key);
	}
}
