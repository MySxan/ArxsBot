export interface TypingToken {
  cancelled: boolean;
  startedAt: number;
}

export interface SessionState {
  lastBotReplyAt?: number;
  typingToken?: TypingToken;
  incomingWhileTyping: number;
  forceQuoteNextFlush?: boolean;
  messageSeq: number;
}

export class SessionStateStore {
  private sessions = new Map<string, SessionState>();

  get(sessionKey: string): SessionState {
    const existing = this.sessions.get(sessionKey);
    if (existing) return existing;

    const created: SessionState = {
      incomingWhileTyping: 0,
      forceQuoteNextFlush: false,
      messageSeq: 0,
    };
    this.sessions.set(sessionKey, created);
    return created;
  }

  nextMessageSeq(sessionKey: string): number {
    const session = this.get(sessionKey);
    session.messageSeq += 1;
    return session.messageSeq;
  }

  startTyping(sessionKey: string): TypingToken {
    const session = this.get(sessionKey);
    const token: TypingToken = { cancelled: false, startedAt: Date.now() };
    session.typingToken = token;
    session.incomingWhileTyping = 0;
    return token;
  }

  endTyping(sessionKey: string, token: TypingToken): void {
    const session = this.get(sessionKey);
    if (session.typingToken === token) {
      session.typingToken = undefined;
      session.incomingWhileTyping = 0;
    }
  }

  setLastBotReplyAt(sessionKey: string, timestamp: number): void {
    const session = this.get(sessionKey);
    session.lastBotReplyAt = timestamp;
  }

  markForceQuoteNextFlush(sessionKey: string): void {
    const session = this.get(sessionKey);
    session.forceQuoteNextFlush = true;
  }

  clearForceQuoteNextFlush(sessionKey: string): void {
    const session = this.get(sessionKey);
    session.forceQuoteNextFlush = false;
  }
}
