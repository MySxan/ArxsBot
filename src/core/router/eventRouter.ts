import type { Event, EventType } from '../model/Event.js';
import type { Context } from '../model/Context.js';
import { PipelineType, determineRoute } from './routeDefinitions.js';

export { PipelineType };
export type RouteKey = `${PipelineType}` | EventType;

export interface Route {
	key: RouteKey;
	pipelineType: PipelineType;
	eventType?: EventType;
}

export class EventRouter {
	private routes: Map<RouteKey, Route> = new Map();

	constructor() {
		this.initializeDefaultRoutes();
	}

	private initializeDefaultRoutes(): void {
		// All message types can go to their respective pipelines
		this.registerRoute({
			key: PipelineType.DirectMessage,
			pipelineType: PipelineType.DirectMessage,
		});
		this.registerRoute({
			key: PipelineType.GroupChat,
			pipelineType: PipelineType.GroupChat,
		});
		this.registerRoute({
			key: PipelineType.SystemEvent,
			pipelineType: PipelineType.SystemEvent,
		});
	}

	public registerRoute(route: Route): void {
		this.routes.set(route.key, route);
	}

	public route(event: Event, context: Context): PipelineType {
		// Try event type specific route first
		const eventSpecificRoute = this.routes.get(event.type as any);
		if (eventSpecificRoute) {
			return eventSpecificRoute.pipelineType;
		}

		// Fall back to automatic routing based on event type
		return determineRoute(event);
	}

	public getPipeline(pipelineType: PipelineType): PipelineType {
		return pipelineType;
	}
}
