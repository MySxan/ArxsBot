import type { ChatEvent } from '../../../events/ChatEvent.js';
import type { Logger } from '../../../../infra/logger/logger.js';
import type { SessionStateStore } from './SessionStateStore.js';

export class TypingInterruption {
  constructor(
    private readonly deps: {
      sessionStore: SessionStateStore;
      logger: Logger;
      cancelThreshold?: number;
    },
  ) {}

  onIncomingUserMessage(sessionKey: string, event: ChatEvent): void {
    const session = this.deps.sessionStore.get(sessionKey);
    const token = session.typingToken;

    if (!token || token.cancelled) {
      return;
    }

    session.incomingWhileTyping += 1;

    const threshold = this.deps.cancelThreshold ?? 3;
    if (session.incomingWhileTyping >= threshold) {
      token.cancelled = true;
      this.deps.logger.debug(
        'router',
        `Typing cancelled due to ${session.incomingWhileTyping} incoming messages (user=${event.userId}, group=${event.groupId})`,
      );
    }
  }
}
