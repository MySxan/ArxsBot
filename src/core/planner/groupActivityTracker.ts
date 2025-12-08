import { config } from '../../infra/config/config.js';
import { createLogger } from '../../infra/logger/logger.js';

/**
 * Tracks recent group activity (messages per group) to estimate how noisy a group is.
 * Activity is measured as messages in the last 5 minutes, normalized to 0~1.
 */
const WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const ACTIVITY_NORMALIZER = 10; // 0~10 messages/min maps to 0~1

const groupBuckets = new Map<string, number[]>();
const logger = createLogger(config);

export function recordGroupMessage(groupKey: string, timestamp: number = Date.now()): void {
  const arr = groupBuckets.get(groupKey) ?? [];
  arr.push(timestamp);
  // prune old
  const cutoff = timestamp - WINDOW_MS;
  while (arr.length && arr[0] < cutoff) arr.shift();
  groupBuckets.set(groupKey, arr);
  logger.debug('activity', `${groupKey}: ${arr.length} messages in window`);
}

export function getGroupActivity(groupKey: string): {
  activity: number; // 0~1
  messagesInWindow: number;
} {
  const now = Date.now();
  const arr = groupBuckets.get(groupKey) ?? [];
  const cutoff = now - WINDOW_MS;
  const filtered = arr.filter((t) => t >= cutoff);
  // overwrite pruned list
  groupBuckets.set(groupKey, filtered);

  const messagesInWindow = filtered.length;
  const messagesPerMinute = messagesInWindow / 5; // 5-minute window
  let activity = messagesPerMinute / ACTIVITY_NORMALIZER;
  activity = Math.max(0, Math.min(1, activity));

  logger.debug(
    'activity',
    `${groupKey}: activity=${(activity * 100).toFixed(0)}% (${messagesInWindow} msgs/5min)`,
  );

  return { activity, messagesInWindow };
}
