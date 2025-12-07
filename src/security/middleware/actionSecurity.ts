import type { Action } from '../../core/model/Action.js';
import type { Event } from '../../core/model/Event.js';
import type { Context } from '../../core/model/Context.js';
import type { Logger } from '../../infra/logger/logger.js';

const MAX_TEXT_LENGTH = 1000;

export const createActionSecurityMiddleware =
  (logger: Logger) =>
  async (_event: Event, _context: Context, next: () => Promise<Action[]>): Promise<Action[]> => {
    const actions = await next();

    const sanitized = actions.map((action) => {
      if (action.kind === 'send_message') {
        const payload = action.payload as {
          channelId: string;
          content: Array<{ type: string; data: unknown }>;
        };

        const trimmedContent = payload.content.map((seg) => {
          if (seg.type === 'text') {
            const text = String((seg.data as { text: string }).text ?? '');
            if (text.length > MAX_TEXT_LENGTH) {
              logger.warn(
                'security',
                `send_message text truncated from ${text.length} to ${MAX_TEXT_LENGTH}`,
              );
              return { ...seg, data: { text: text.slice(0, MAX_TEXT_LENGTH) } };
            }
          }
          return seg;
        });

        return {
          ...action,
          payload: {
            ...payload,
            content: trimmedContent,
          },
        };
      }
      return action;
    });

    return sanitized;
  };
