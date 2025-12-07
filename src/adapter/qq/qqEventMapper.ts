import type { Event, EventType } from '../../core/model/Event.js';
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

/**
 * Map OneBot11 message to ArxsBot MessageReceivedEvent.
 */
export function mapOneBot11ToEvent(raw: OneBot11Message): Event | null {
	if (raw.post_type !== 'message') {
		return null; // Only handle message events
	}

	if (!raw.message || raw.message.length === 0) {
		return null;
	}

	// Extract text from message segments
	const content = raw.message.map((seg) => {
		if (seg.type === 'text') {
			return {
				type: MessageContentType.Text,
				data: { text: seg.data.text ?? '' },
			};
		}
		// Skip other types for now
		return null;
	});

	const textSegments = content.filter((seg) => seg !== null) as Array<{
		type: MessageContentType;
		data: unknown;
	}>;

	if (textSegments.length === 0) {
		return null; // No text segments
	}

	// Create user
	const user: User = {
		id: String(raw.user_id),
		platform: 'qq',
		displayName: raw.sender?.nickname ?? raw.sender?.card ?? `User${raw.user_id}`,
		username: raw.sender?.nickname,
	};

	// Create message
	const message: Message = {
		id: String(raw.message_id ?? 0),
		channelId: raw.message_type === 'group' ? String(raw.group_id ?? 0) : String(raw.user_id),
		userId: String(raw.user_id),
		platform: 'qq',
		timestamp: raw.time * 1000, // Convert from seconds to milliseconds
		content: textSegments,
		author: user,
	};

	// Create group if group message
	let group: Group | undefined;
	if (raw.message_type === 'group' && raw.group_id) {
		group = {
			id: String(raw.group_id),
			platform: 'qq',
			displayName: `Group${raw.group_id}`,
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
