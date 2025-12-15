import type { ChatEvent } from '../../../events/ChatEvent.js';
import type { ConversationStore } from '../../../memory/ConversationStore.js';
import type { MemberStatsStore } from '../../../memory/MemberStatsStore.js';
import type { Logger } from '../../../../infra/logger/logger.js';

export interface PreprocessResult {
  timestamp: number;
  conversationKey: string;
  shouldContinue: boolean;
}

export class EventPreprocessor {
  constructor(
    private readonly deps: {
      logger: Logger;
      conversationStore?: ConversationStore;
      memberStats?: MemberStatsStore;
    },
  ) {}

  run(event: ChatEvent): PreprocessResult {
    this.deps.logger.debug(
      'router',
      `Received message from ${event.userId} in ${event.groupId}: "${event.rawText.substring(0, 30)}..."`,
    );

    const timestamp = event.timestamp ?? Date.now();
    const conversationKey = `${event.platform}:${event.groupId}`;

    // 存储消息到 conversation store
    if (this.deps.conversationStore) {
      if (event.fromBot) {
        // 存储 bot 自发消息
        this.deps.conversationStore.appendTurn(conversationKey, {
          role: 'bot',
          content: event.rawText,
          timestamp,
          userId: 'bot',
        });
        this.deps.logger.debug('router', 'Stored bot self-message, skipping processing');
        return { timestamp, conversationKey, shouldContinue: false };
      }

      // 存储用户消息
      this.deps.conversationStore.appendTurn(conversationKey, {
        role: 'user',
        content: event.rawText,
        timestamp,
        userId: event.userId,
        userName: event.userName,
        mentionsBot: event.mentionsBot,
        isCommand: event.rawText.startsWith('/'),
      });
    }

    // 跳过 bot 消息，仅更新用户消息的统计信息
    if (this.deps.memberStats) {
      this.deps.memberStats.onUserMessage(
        event.platform,
        event.groupId,
        event.userId,
        timestamp,
        event.rawText,
        event.mentionsBot,
      );
    }

    return { timestamp, conversationKey, shouldContinue: true };
  }
}
