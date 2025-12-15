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
  events: ChatEvent[];
  lastEvent: ChatEvent;
  timerId: NodeJS.Timeout;
  firstAt: number;
  lastAt: number;
  lastUpdated: number;
}

export type DebounceSnapshot = {
  userKey: string; // platform:groupId:userId
  events: ChatEvent[];
  lastEvent: ChatEvent;
  count: number;
  firstAt: number;
  lastAt: number;
};

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
  debounce(event: ChatEvent, handler: (snapshot: DebounceSnapshot) => Promise<void>): boolean {
    const key = this.getKey(event);
    const pending = this.pending.get(key);
    const now = Date.now();
    const ingestAt = event.ingestTime ?? now;

    if (pending) {
      // User already has pending message - update it and reset timer
      this.logger.debug(
        'debouncer',
        `Message from ${event.userId} buffered (resetting ${this.delayMs}ms timer)`,
      );

      // Clear old timer
      clearTimeout(pending.timerId);

      // Update buffer
      pending.events.push(event);
      pending.lastEvent = event;
      pending.lastAt = ingestAt;
      pending.lastUpdated = now;

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
      events: [event],
      lastEvent: event,
      timerId,
      firstAt: ingestAt,
      lastAt: ingestAt,
      lastUpdated: now,
    });

    return true; // Message buffered
  }

  /**
   * Fire the pending message handler
   */
  private async firePending(
    key: string,
    handler: (snapshot: DebounceSnapshot) => Promise<void>,
  ): Promise<void> {
    const pending = this.pending.get(key);
    if (!pending) {
      return;
    }

    this.pending.delete(key);

    try {
      const snapshot: DebounceSnapshot = {
        userKey: key,
        events: pending.events,
        lastEvent: pending.lastEvent,
        count: pending.events.length,
        firstAt: pending.firstAt,
        lastAt: pending.lastAt,
      };

      // Lag stats (eventTime vs ingestTime)
      let lagSum = 0;
      let lagCount = 0;
      let lagMax = 0;
      for (const e of pending.events) {
        const ingestAt = e.ingestTime ?? Date.now();
        const eventAt = e.timestamp ?? ingestAt;
        const lag = Math.max(0, ingestAt - eventAt);
        lagSum += lag;
        lagCount += 1;
        if (lag > lagMax) lagMax = lag;
      }
      const lagAvg = lagCount ? Math.round(lagSum / lagCount) : 0;

      this.logger.debug(
        'debouncer',
        `DebounceFlush: userKey=${snapshot.userKey} count=${snapshot.count} firstIngestAt=${snapshot.firstAt} lastIngestAt=${snapshot.lastAt} lagMs(avg=${lagAvg}, max=${lagMax})`,
      );
      await handler(snapshot);
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
