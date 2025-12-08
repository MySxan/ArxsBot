/**
 * Platform-agnostic chat event structure.
 * All platform adapters should normalize their events to this format.
 */
export interface ChatEvent {
  /** Platform identifier */
  platform: 'qq' | 'discord' | 'telegram';

  /** Group/channel ID */
  groupId: string;

  /** User ID */
  userId: string;

  /** Message ID (for reply reference) */
  messageId: string;

  /** Plain text content */
  rawText: string;

  /** Timestamp (milliseconds) */
  timestamp: number;

  /** Whether this message mentions/at the bot */
  mentionsBot: boolean;

  /** Optional: User display name */
  userName?: string;

  /** Optional: Group name */
  groupName?: string;

  /** Optional: Is private message (DM) */
  isPrivate?: boolean;

  // Future extensions:
  // attachments?: Attachment[];
  // replyTo?: string;
  // reactions?: Reaction[];
}
