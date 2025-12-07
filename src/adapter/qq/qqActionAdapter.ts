import type { Action } from '../../core/model/Action.js';
import type { Logger } from '../../infra/logger/logger.js';

/**
 * Utility to add human-like delay (900-1500ms).
 */
export async function humanDelay(): Promise<void> {
  const delay = 900 + Math.random() * 600;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Map ArxsBot send_message Action to OneBot11 send_group_msg API call.
 */
export async function qqPerformAction(
  action: Action,
  send: (msg: unknown) => void,
  logger: Logger,
): Promise<void> {
  if (action.kind !== 'send_message') {
    logger.debug('qq-adapter', `Skipping action: ${action.kind}`);
    return;
  }

  const payload = action.payload as {
    channelId: string;
    content: Array<{ type: string; data: unknown }>;
    replyTo?: string;
  };

  // Extract text from content segments
  const texts = payload.content
    .filter((seg) => seg.type === 'text')
    .map((seg) => (seg.data as { text: string }).text);

  if (texts.length === 0) {
    logger.warn('qq-adapter', 'No text content in send_message action');
    return;
  }

  // Apply human delay
  await humanDelay();

  // Map to OneBot11 send_group_msg format
  const onebot11Message = {
    action: 'send_group_msg',
    params: {
      group_id: parseInt(payload.channelId, 10),
      message: [
        {
          type: 'text',
          data: {
            text: texts.join(''),
          },
        },
      ],
    },
  };

  logger.debug('qq-adapter', `Sending message: ${texts.join('')}`);
  send(onebot11Message);
}
