import type { ChatEvent } from '../../core/events/ChatEvent.js';
import type { MessageSender } from '../../core/messaging/MessageSender.js';
import type { Logger } from '../../infra/logger/logger.js';
import type { OneBot11Message } from './QQEventMapper.js';
import { WebSocket } from 'ws';

/**
 * QQ/NapCat message sender implementation.
 * Converts MessageSender interface to OneBot11 API calls.
 */
export class QQMessageSender implements MessageSender {
  private ws: WebSocket;
  private logger: Logger;

  constructor(ws: WebSocket, logger: Logger) {
    this.ws = ws;
    this.logger = logger;
  }

  async sendText(groupId: string, text: string, replyTo?: string): Promise<void> {
    // Add human-like delay (900-1500ms)
    const delay = 900 + Math.random() * 600;
    this.logger.debug(
      'qq-sender',
      `Queuing message (delay: ${delay.toFixed(0)}ms): "${text.substring(0, 40)}..."`,
    );
    await new Promise((resolve) => setTimeout(resolve, delay));

    // Build OneBot11 message
    const message = {
      action: 'send_group_msg',
      params: {
        group_id: parseInt(groupId, 10),
        message: [
          {
            type: 'text',
            data: { text },
          },
        ],
      },
    };

    try {
      this.logger.info(
        'qq-sender',
        `Sending to group ${groupId}: "${text.substring(0, 40)}..." (${text.length} chars)`,
      );
      this.ws.send(JSON.stringify(message));
    } catch (error) {
      this.logger.error(
        'qq-sender',
        `Failed to send message: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }
}
