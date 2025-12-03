import type { Platform } from './Event.js';

export interface User {
	id: string;
	platform: Platform;
	displayName: string;
	avatar?: string;
	username?: string; // handle/username if different from display name
	isBot?: boolean;
	roles?: string[]; // platform-specific roles
}
