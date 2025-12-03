import type { Message } from './Message.js';
import type { User } from './User.js';
import type { Group } from './Group.js';

export type Platform = 'qq' | 'discord' | 'telegram';

export enum EventType {
	MessageReceived = 'message.received',
	MemberJoined = 'member.joined',
	MemberLeft = 'member.left',
	GroupInvite = 'group.invite',
	SystemNotice = 'system.notice',
	ReactionAdded = 'reaction.added',
	ReactionRemoved = 'reaction.removed',
	MessageEdited = 'message.edited',
	MessageDeleted = 'message.deleted',
}

export interface BaseEvent {
	type: EventType;
	platform: Platform;
	timestamp: number;
	rawEvent?: unknown; // original platform event for debugging
}

export interface MessageReceivedEvent extends BaseEvent {
	type: EventType.MessageReceived;
	message: Message;
}

export interface MemberJoinedEvent extends BaseEvent {
	type: EventType.MemberJoined;
	user: User;
	group: Group;
}

export interface MemberLeftEvent extends BaseEvent {
	type: EventType.MemberLeft;
	user: User;
	group: Group;
}

export interface GroupInviteEvent extends BaseEvent {
	type: EventType.GroupInvite;
	group: Group;
	inviter?: User;
}

export interface SystemNoticeEvent extends BaseEvent {
	type: EventType.SystemNotice;
	notice: string;
	metadata?: Record<string, unknown>;
}

export interface ReactionEvent extends BaseEvent {
	type: EventType.ReactionAdded | EventType.ReactionRemoved;
	messageId: string;
	user: User;
	emoji: string;
}

export interface MessageEditedEvent extends BaseEvent {
	type: EventType.MessageEdited;
	message: Message;
	oldContent?: string;
}

export interface MessageDeletedEvent extends BaseEvent {
	type: EventType.MessageDeleted;
	messageId: string;
	channelId: string;
}

export type Event =
	| MessageReceivedEvent
	| MemberJoinedEvent
	| MemberLeftEvent
	| GroupInviteEvent
	| SystemNoticeEvent
	| ReactionEvent
	| MessageEditedEvent
	| MessageDeletedEvent;
