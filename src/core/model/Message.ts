import type { Platform } from './Event.js';
import type { User } from './User.js';

export enum MessageContentType {
	Text = 'text',
	Image = 'image',
	Audio = 'audio',
	Video = 'video',
	File = 'file',
	Sticker = 'sticker',
	Mixed = 'mixed', // multiple content types
}

export interface MessageSegment {
	type: MessageContentType;
	data: unknown;
}

export interface TextSegment extends MessageSegment {
	type: MessageContentType.Text;
	data: {
		text: string;
	};
}

export interface ImageSegment extends MessageSegment {
	type: MessageContentType.Image;
	data: {
		url: string;
		width?: number;
		height?: number;
	};
}

export interface AudioSegment extends MessageSegment {
	type: MessageContentType.Audio;
	data: {
		url: string;
		duration?: number;
	};
}

export interface VideoSegment extends MessageSegment {
	type: MessageContentType.Video;
	data: {
		url: string;
		duration?: number;
		thumbnail?: string;
	};
}

export interface FileSegment extends MessageSegment {
	type: MessageContentType.File;
	data: {
		url: string;
		filename: string;
		size?: number;
	};
}

export interface StickerSegment extends MessageSegment {
	type: MessageContentType.Sticker;
	data: {
		id: string;
		url?: string;
	};
}

export interface Message {
	id: string;
	channelId: string; // group ID or DM channel
	userId: string;
	platform: Platform;
	timestamp: number;
	content: MessageSegment[];
	author?: User; // optional populated user
	replyTo?: string; // message ID being replied to
	mentions?: string[]; // user IDs mentioned
	rawMessage?: unknown; // original platform message
}

// Helper to get plain text from message
export function getPlainText(message: Message): string {
	return message.content
		.filter((seg): seg is TextSegment => seg.type === MessageContentType.Text)
		.map((seg) => seg.data.text)
		.join('');
}

// Helper to check if message contains images
export function hasImages(message: Message): boolean {
	return message.content.some((seg) => seg.type === MessageContentType.Image);
}
