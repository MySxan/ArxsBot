import { z } from 'zod';
import type { Event } from '../../core/model/Event.js';
import type { Message } from '../../core/model/Message.js';
import type { User } from '../../core/model/User.js';
import type { Group } from '../../core/model/Group.js';
import { MessageContentType } from '../../core/model/Message.js';
import { EventType as ArxsEventType } from '../../core/model/Event.js';

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
    z.object({
      type: z.literal('text'),
      data: z.object({ text: z.string().max(2000) }),
    }),
  ),
  user_id: z.number(),
  group_id: z.number().optional(),
  message_id: z.number().optional(),
  time: z.number(),
  self_id: z.number(),
  sender: z
    .object({
      user_id: z.number(),
      nickname: z.string().optional(),
      card: z.string().optional(),
    })
    .optional(),
});

/**
 * Map OneBot11 message to ArxsBot MessageReceivedEvent.
 */
export function mapOneBot11ToEvent(raw: unknown): Event | null {
  const parsed = OB11MessageSchema.safeParse(raw);
  if (!parsed.success) {
    return null; // Reject invalid schema
  }

  const msg = parsed.data;

  const textSegments = msg.message.map((seg) => ({
    type: MessageContentType.Text,
    data: { text: seg.data.text ?? '' },
  }));

  // Create user
  const user: User = {
    id: String(msg.user_id),
    platform: 'qq',
    displayName: msg.sender?.nickname ?? msg.sender?.card ?? `User${msg.user_id}`,
    username: msg.sender?.nickname,
  };

  // Create message
  const message: Message = {
    id: String(msg.message_id ?? 0),
    channelId: msg.message_type === 'group' ? String(msg.group_id ?? 0) : String(msg.user_id),
    userId: String(msg.user_id),
    platform: 'qq',
    timestamp: msg.time * 1000, // Convert from seconds to milliseconds
    content: textSegments,
    author: user,
  };

  // Create group if group message
  let group: Group | undefined;
  if (msg.message_type === 'group' && msg.group_id) {
    group = {
      id: String(msg.group_id),
      platform: 'qq',
      displayName: `Group${msg.group_id}`,
    };
  }

  // Create event
  const event: Event = {
    type: ArxsEventType.MessageReceived,
    platform: 'qq',
    timestamp: Date.now(),
    message,
    ...(group && { group }),
  };

  return event;
}
