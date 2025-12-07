import type { Event } from '../model/Event.js';
import type { Action } from '../model/Action.js';
import type { Context } from '../model/Context.js';
import type { Intent, IntentType } from '../model/Intent.js';

/**
 * Handler interface with metadata for auto-registration.
 * Handlers declare which intents they can handle via static metadata.
 */
export interface IHandler {
  /**
   * Handle an intent and produce actions.
   * @param event - The original event that triggered this
   * @param context - The conversation context
   * @param intent - The recognized intent (may be null for non-message events)
   * @returns Array of actions to execute
   */
  handle(event: Event, context: Context, intent: Intent | null): Promise<Action[]>;
}

/**
 * Metadata for handler registration.
 * Handlers export this as a static property.
 */
export interface HandlerMetadata {
  /**
   * List of intent types this handler can process.
   */
  intents: IntentType[];

  /**
   * Priority for this handler (higher = earlier).
   * When multiple handlers claim the same intent, priority determines order.
   */
  priority?: number;

  /**
   * Human-readable description of what this handler does.
   */
  description?: string;
}

/**
 * Handler class constructor with metadata.
 */
export interface HandlerClass {
  new (): IHandler;
  readonly metadata: HandlerMetadata;
}
