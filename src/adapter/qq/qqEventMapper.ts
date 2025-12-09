import { z } from 'zod';
import type { ChatEvent } from '../../core/events/ChatEvent.js';

/**
 * OneBot11 message format:
 * https://onebot.dev/spec/
 * We focus on text messages in group/private chats.
 */
export interface OneBot11Message {
  time: number;
  self_id: number;
  post_type: 'message' | 'notice' | 'request' | 'meta_event';
  message_type: 'private' | 'group';
  sub_type?: string;
  message_id?: number;
  group_id?: number;
  user_id: number;
  anonymous?: unknown;
  message: Array<{
    type: string;
    data: Record<string, unknown>;
  }>;
  raw_message?: string;
  font?: number;
  sender?: {
    user_id: number;
    nickname?: string;
    card?: string;
    sex?: string;
    age?: number;
    area?: string;
    level?: number;
    role?: string;
    title?: string;
  };
}

// OneBot11 message schema
const OB11MessageSchema = z.object({
  post_type: z.literal('message'),
  message_type: z.enum(['group', 'private']),
  message: z.array(
    z.union([
      z.object({
        type: z.literal('text'),
        data: z.object({ text: z.string().max(2000) }),
      }),
      z.object({
        type: z.literal('at'),
        data: z.object({ qq: z.string() }),
      }),
      z.object({
        type: z.string(),
        data: z.record(z.unknown()),
      }),
    ]),
  ),
  user_id: z.number(),
  group_id: z.number().optional(),
  message_id: z.number().optional(),
  time: z.number(),
  self_id: z.number().optional(),
  sender: z
    .object({
      user_id: z.number(),
      nickname: z.string().optional(),
      card: z.string().optional(),
    })
    .optional(),
});

/**
 * Map OneBot11 message to simplified ChatEvent.
 * This is the clean interface for event handling.
 */
export function mapToChatEvent(
  raw: unknown,
  logger?: { debug: (tag: string, msg: string) => void },
): ChatEvent | null {
  const parsed = OB11MessageSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }

  const msg = parsed.data;

  // Drop messages sent by the bot itself to avoid self-trigger loops
  if (msg.self_id && msg.user_id === msg.self_id) {
    logger?.debug('qq-mapper', `Filtered self message from bot ${msg.self_id}`);
    return null;
  }

  // Extract plain text
  const rawText = msg.message
    .map((seg) => {
      if (seg.type === 'text' && typeof seg.data.text === 'string') {
        return seg.data.text;
      }
      return '';
    })
    .join('');

  // Check if bot is mentioned by checking if any 'at' segment targets the bot itself
  const mentionsBot = msg.message.some((seg) => {
    if (seg.type === 'at' && typeof seg.data.qq === 'string') {
      // At消息格式：qq字段包含被@的QQ号
      // 检查是否@的是bot自己
      const atQQ = String(seg.data.qq);
      const botQQ = String(msg.self_id);
      const matches = atQQ === botQQ;
      logger?.debug(
        'qq-mapper',
        `At segment detected: qq=${atQQ}, botId=${botQQ}, matches=${matches}`,
      );
      return matches;
    }
    return false;
  });

  const chatEvent: ChatEvent = {
    platform: 'qq',
    groupId: msg.message_type === 'group' ? String(msg.group_id ?? 0) : String(msg.user_id),
    userId: String(msg.user_id),
    messageId: String(msg.message_id ?? 0),
    rawText,
    timestamp: msg.time * 1000,
    mentionsBot,
    userName: msg.sender?.nickname ?? msg.sender?.card ?? `User${msg.user_id}`,
    groupName: msg.message_type === 'group' ? `Group${msg.group_id}` : undefined,
    isPrivate: msg.message_type === 'private',
  };

  return chatEvent;
}
