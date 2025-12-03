import type { Message } from './Message.js';
import type { User } from './User.js';
import type { Group } from './Group.js';
import type { Platform } from './Event.js';

export interface Context {
	platform: Platform;
	channelId: string; // group or DM channel ID
	user: User; // current user who triggered this context
	group?: Group; // if in group chat
	recentMessages: Message[]; // recent message history
	currentMessage?: Message; // the message that triggered this context
	metadata?: Record<string, unknown>; // extra context data
}

export function createContext(
	platform: Platform,
	channelId: string,
	user: User,
	options?: {
		group?: Group;
		recentMessages?: Message[];
		currentMessage?: Message;
		metadata?: Record<string, unknown>;
	},
): Context {
	return {
		platform,
		channelId,
		user,
		group: options?.group,
		recentMessages: options?.recentMessages ?? [],
		currentMessage: options?.currentMessage,
		metadata: options?.metadata,
	};
}
