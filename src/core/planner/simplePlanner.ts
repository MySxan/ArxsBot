import type { ChatEvent } from '../model/ChatEvent.js';
import type { PlanResult } from './types.js';

/**
 * Simple rule-based planner that decides whether and how to respond to messages.
 *
 * Rules:
 * 1. Commands (starting with / or ！) → always reply immediately
 * 2. Messages that mention the bot → reply with small delay (simulate thinking)
 * 3. Everything else → ignore
 *
 * Future: Can be replaced with LLM-based planner or multi-mode planner
 */
export function plan(event: ChatEvent): PlanResult {
  const text = event.rawText.trim();

  // 1. Command mode: starts with / or ！
  if (text.startsWith('/') || text.startsWith('！')) {
    return {
      shouldReply: true,
      mode: 'command',
      delayMs: 0, // Commands execute immediately
    };
  }

  // 2. Bot is mentioned: engage in conversation
  if (event.mentionsBot) {
    return {
      shouldReply: true,
      mode: 'smalltalk',
      delayMs: 600, // 0.6s to simulate thinking time
    };
  }

  // 3. Default: ignore (passive listening mode)
  // Future: Can add sentiment detection, keyword triggers, etc.
  return {
    shouldReply: false,
    mode: 'ignore',
    delayMs: 0,
  };
}
