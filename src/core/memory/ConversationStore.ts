/**
 * Conversation turn - represents one message in a conversation
 */
export interface ChatTurn {
  role: 'user' | 'bot';
  content: string;
  timestamp: number;
}

/**
 * Conversation store interface
 */
export interface ConversationStore {
  appendTurn(key: string, turn: ChatTurn): void;
  getRecentTurns(key: string, limit: number): ChatTurn[];
  clear(key: string): void;
}

/**
 * In-memory implementation of conversation store
 * Stores conversation history per group/user combination
 * Automatically trims history to last 50 turns per key
 */
export class InMemoryConversationStore implements ConversationStore {
  private store = new Map<string, ChatTurn[]>();
  private maxTurnsPerKey = 50;

  /**
   * Add a turn to the conversation
   */
  appendTurn(key: string, turn: ChatTurn): void {
    const arr = this.store.get(key) ?? [];
    arr.push(turn);

    // Keep only the most recent turns
    if (arr.length > this.maxTurnsPerKey) {
      arr.splice(0, arr.length - this.maxTurnsPerKey);
    }

    this.store.set(key, arr);
  }

  /**
   * Get the most recent turns (up to limit)
   */
  getRecentTurns(key: string, limit: number): ChatTurn[] {
    const arr = this.store.get(key) ?? [];
    return arr.slice(-limit);
  }

  /**
   * Clear conversation history for a key
   */
  clear(key: string): void {
    this.store.delete(key);
  }

  /**
   * Get statistics (for debugging)
   */
  getStats(key: string): { totalTurns: number; recentTurns: ChatTurn[] } {
    const arr = this.store.get(key) ?? [];
    return {
      totalTurns: arr.length,
      recentTurns: arr.slice(-5),
    };
  }
}
