import type { Event, MessageReceivedEvent, EventType } from '../../model/Event.js';
import type { Action } from '../../model/Action.js';
import type { Context } from '../../model/Context.js';
import type { Logger } from '../../../infra/logger/logger.js';
import { MessageContentType } from '../../model/Message.js';

/**
 * Truncate text to max length, show truncation indicator
 */
function truncateText(text: string, maxLen: number = 20): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen) + '…(' + (text.length - maxLen) + ' more)';
}

/**
 * Format event for logging with structured fields.
 * IN format: [IN] [PLATFORM] [CHANNEL_TYPE] from="..." group=xxx text="..."
 */
function formatIncomingLog(event: Event): string {
  switch (event.type) {
    case 'message.received': {
      const msgEvent = event as MessageReceivedEvent;
      const platform = msgEvent.platform.toUpperCase();
      const channelType = msgEvent.group ? 'GROUP' : 'PRIVATE';
      const from = msgEvent.message.author?.displayName ?? msgEvent.message.userId;
      const groupId = msgEvent.group?.id ?? '';
      const text = msgEvent.message.content
        .filter((seg) => seg.type === MessageContentType.Text)
        .map((seg) => (seg.data as { text: string }).text)
        .join('');

      const fields = [`[IN]`, `[${platform}]`, `[${channelType}]`, `from="${from}"`];
      if (groupId) fields.push(`group=${groupId}`);
      fields.push(`text="${truncateText(text)}"`);
      return fields.join(' ');
    }
    case 'member.joined': {
      const joinedEvent = event as any;
      const userName = joinedEvent.user?.displayName ?? 'Unknown';
      const groupName = joinedEvent.group?.displayName ?? 'Unknown';
      return `[IN] [${joinedEvent.platform.toUpperCase()}] [GROUP] from="${userName}" group="${groupName}" action="joined"`;
    }
    case 'member.left': {
      const leftEvent = event as any;
      const userName = leftEvent.user?.displayName ?? 'Unknown';
      const groupName = leftEvent.group?.displayName ?? 'Unknown';
      return `[IN] [${leftEvent.platform.toUpperCase()}] [GROUP] from="${userName}" group="${groupName}" action="left"`;
    }
    case 'system.notice': {
      const noticeEvent = event as any;
      return `[IN] [${noticeEvent.platform.toUpperCase()}] [SYSTEM] message="${noticeEvent.notice}"`;
    }
    default:
      return `[IN] [${event.platform.toUpperCase()}] type="${event.type}"`;
  }
}

/**
 * Format actions for logging with structured fields.
 * OUT format: [OUT] [PLATFORM] [CHANNEL_TYPE] to=xxx action="..." text="..." model=none tokens=0 risk=0 persona=none
 */
function formatOutgoingLog(actions: Action[], event: Event): string {
  if (actions.length === 0) {
    return '[OUT] (no actions)';
  }

  const msgEvent = event.type === 'message.received' ? (event as MessageReceivedEvent) : null;
  const platform = event.platform.toUpperCase();
  const channelType = msgEvent?.group ? 'GROUP' : 'PRIVATE';
  const to = msgEvent?.message.channelId ?? 'unknown';

  return actions
    .map((action) => {
      const fields = [
        `[OUT]`,
        `[${platform}]`,
        `[${channelType}]`,
        `to=${to}`,
        `action="${action.kind}"`,
      ];

      if (action.kind === 'send_message') {
        const payload = action.payload as {
          content: Array<{ type: string; data: unknown }>;
        };
        const text = extractActionText(action);
        fields.push(`text="${truncateText(text)}"`);
      }

      // 固定添加这些字段（用于成本/风控追踪）
      fields.push('model=none');
      fields.push('tokens=0');
      fields.push('risk=0');
      fields.push('persona=none');

      return fields.join(' ');
    })
    .join(' ');
}

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
 * Logging middleware for dispatcher.
 * Logs incoming events and outgoing actions with structured fields.
 */
export async function loggingMiddleware(
  event: Event,
  context: Context,
  next: () => Promise<Action[]>,
  logger: Logger,
): Promise<Action[]> {
  const incomingLog = formatIncomingLog(event);
  logger.info('dispatcher', incomingLog);

  const actions = await next();

  const outgoingLog = formatOutgoingLog(actions, event);
  logger.info('dispatcher', outgoingLog);

  return actions;
}
