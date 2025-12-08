import type { ChatEvent } from '../model/ChatEvent.js';
import type { MessageSender } from '../messaging/MessageSender.js';

/**
 * Context passed to command handlers
 */
export interface CommandContext {
  /** The original chat event */
  event: ChatEvent;

  /** Command arguments (split by whitespace) */
  args: string[];

  /** Message sender for replying */
  sender: MessageSender;
}

/**
 * Interface for command handlers
 */
export interface CommandHandler {
  /** Primary command name (e.g., "ping") */
  name: string;

  /** Alternative names (e.g., ["pong"]) */
  aliases?: string[];

  /** Description for help text */
  description?: string;

  /** Execute the command */
  run(ctx: CommandContext): Promise<void>;
}
