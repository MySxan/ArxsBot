/**
 * @file MessageDebouncer - manages message buffering and prevents rapid successive replies
 * 
 * Strategy:
 * - When a message arrives, check if same user has pending messages
 * - If no pending: buffer the message and set 5s delay timer
 * - If pending: update buffer and reset timer
 * - When timer fires: process only if no new messages arrived
 * - This prevents replying to every message in a burst
 */
import type { ChatEvent } from '../events/ChatEvent.js';
import type { Logger } from '../../infra/logger/logger.js';

interface PendingMessage {
  event: ChatEvent;
  timerId: NodeJS.Timeout;
  lastUpdated: number;
}

/**
 * MessageDebouncer provides debouncing for message handling
 * to avoid replying to every message when user sends multiple messages in quick succession
 */
export class MessageDebouncer {
  private pending = new Map<string, PendingMessage>();
  private readonly delayMs: number;
  private logger: Logger;

  constructor(logger: Logger, delayMs: number = 5000) {
    this.logger = logger;
    this.delayMs = delayMs;
  }

  /**
   * Get the debounce key for a user in a group
   */
  private getKey(event: ChatEvent): string {
    return `${event.platform}:${event.groupId}:${event.userId}`;
  }

  /**
   * Process a message with debouncing
   * @param event - The chat event to process
   * @param handler - The handler to call when debounce timer fires
   * @returns true if message was buffered (will be processed later), false if should process immediately
   */
  debounce(
    event: ChatEvent,
    handler: (bufferedEvent: ChatEvent) => Promise<void>,
  ): boolean {
    const key = this.getKey(event);
    const pending = this.pending.get(key);

    if (pending) {
      // User already has pending message - update it and reset timer
      this.logger.debug(
        'debouncer',
        `Message from ${event.userId} buffered (resetting ${this.delayMs}ms timer)`,
      );

      // Clear old timer
      clearTimeout(pending.timerId);

      // Update the buffered event
      pending.event = event;
      pending.lastUpdated = Date.now();

      // Set new timer
      pending.timerId = setTimeout(() => {
        this.firePending(key, handler);
      }, this.delayMs);

      return true; // Message buffered
    }

    // No pending message - create new buffer
    this.logger.debug(
      'debouncer',
      `First message from ${event.userId} buffered (${this.delayMs}ms timer started)`,
    );

    const timerId = setTimeout(() => {
      this.firePending(key, handler);
    }, this.delayMs);

    this.pending.set(key, {
      event,
      timerId,
      lastUpdated: Date.now(),
    });

    return true; // Message buffered
  }

  /**
   * Fire the pending message handler
   */
  private async firePending(
    key: string,
    handler: (bufferedEvent: ChatEvent) => Promise<void>,
  ): Promise<void> {
    const pending = this.pending.get(key);
    if (!pending) {
      return;
    }

    this.pending.delete(key);

    try {
      this.logger.debug(
        'debouncer',
        `Processing buffered message from ${pending.event.userId} (waited ${Date.now() - pending.lastUpdated + this.delayMs}ms)`,
      );
      await handler(pending.event);
    } catch (error) {
      this.logger.error(
        'debouncer',
        `Error processing buffered message: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Clear pending messages (used for cleanup)
   */
  clear(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timerId);
    }
    this.pending.clear();
  }

  /**
   * Get number of pending messages (for debugging)
   */
  getPendingCount(): number {
    return this.pending.size;
  }
}
