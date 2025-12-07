import type { Event, MessageReceivedEvent, EventType } from '../../model/Event.js';
import type { Action } from '../../model/Action.js';
import type { Context } from '../../model/Context.js';
import type { Logger } from '../../../infra/logger/logger.js';
import { MessageContentType } from '../../model/Message.js';

const maskId = (id: string | number | undefined): string => {
  if (!id) return 'unknown';
  const str = String(id);
  if (str.length <= 4) return str;
  return str.replace(/(\d{3})\d+(\d{2})/, '$1****$2');
};

/**
 * Extract plain text from action payload.
 */
function extractActionText(action: Action): string {
  if (action.kind === 'send_message') {
    const payload = action.payload as {
      content: Array<{ type: string; data: unknown }>;
    };
    const texts = payload.content
      .filter((seg) => seg.type === MessageContentType.Text)
      .map((seg) => (seg.data as { text: string }).text)
      .join('');
    return texts;
  }
  return '';
}

/**
 * Format event for logging.
 */
function formatEvent(event: Event): string {
  switch (event.type) {
    case 'message.received': {
      const msgEvent = event as MessageReceivedEvent;
      const userName =
        msgEvent.message.author?.displayName ?? `User${maskId(msgEvent.message.userId)}`;
      const groupName = msgEvent.group?.displayName ?? `PM-${maskId(msgEvent.message.channelId)}`;
      const text = msgEvent.message.content
        .filter((seg) => seg.type === MessageContentType.Text)
        .map((seg) => (seg.data as { text: string }).text)
        .join('')
        .substring(0, 50);
      return `[${event.platform.toUpperCase()}] ${userName} @ ${groupName}: "${text}"`;
    }
    case 'member.joined': {
      const joinedEvent = event as any;
      const userName = joinedEvent.user?.displayName ?? 'Unknown';
      const groupName = joinedEvent.group?.displayName ?? 'Unknown';
      return `[${event.platform.toUpperCase()}] ${userName} joined ${groupName}`;
    }
    case 'member.left': {
      const leftEvent = event as any;
      const userName = leftEvent.user?.displayName ?? 'Unknown';
      const groupName = leftEvent.group?.displayName ?? 'Unknown';
      return `[${event.platform.toUpperCase()}] ${userName} left ${groupName}`;
    }
    case 'system.notice': {
      const noticeEvent = event as any;
      return `[${event.platform.toUpperCase()}] System: ${noticeEvent.notice}`;
    }
    default:
      return `[${event.platform.toUpperCase()}] ${event.type}`;
  }
}

/**
 * Format actions for logging.
 */
function formatActions(actions: Action[]): string {
  if (actions.length === 0) {
    return '(no actions)';
  }

  return actions
    .map((action) => {
      switch (action.kind) {
        case 'send_message': {
          const payload = action.payload as {
            channelId: string;
            content: Array<{ type: string; data: unknown }>;
          };
          const text = extractActionText(action).substring(0, 50);
          return `send_message(${payload.channelId}): "${text}"`;
        }
        case 'recall_message':
          return 'recall_message';
        case 'edit_message':
          return 'edit_message';
        case 'react_to_message':
          return 'react_to_message';
        case 'kick_member':
          return 'kick_member';
        case 'mute_member':
          return 'mute_member';
        default:
          return action.kind;
      }
    })
    .join(' | ');
}

/**
 * Logging middleware for dispatcher.
 * Logs incoming events and outgoing actions in human-readable format.
 */
export async function loggingMiddleware(
  event: Event,
  context: Context,
  next: () => Promise<Action[]>,
  logger: Logger,
): Promise<Action[]> {
  const incomingLog = `→ [IN] ${formatEvent(event)}`;
  logger.info('dispatcher', incomingLog);

  const actions = await next();

  const outgoingLog = `← [OUT] ${formatActions(actions)}`;
  logger.info('dispatcher', outgoingLog);

  return actions;
}
