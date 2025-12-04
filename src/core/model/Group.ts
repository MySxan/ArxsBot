import type { Platform } from './Event.js';

export interface Group {
  id: string;
  platform: Platform;
  displayName: string;
  avatar?: string;
  description?: string;
  memberCount?: number;
  owner?: string; // user ID of group owner
}
