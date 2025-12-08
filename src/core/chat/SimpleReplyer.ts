import type { ChatEvent } from '../../core/model/ChatEvent.js';
import type { LLMClient, LLMMessage } from '../../core/llm/types.js';
import type { Logger } from '../../infra/logger/logger.js';
import type { ConversationStore } from '../memory/ConversationStore.js';

/**
 * Simple chat replyer using LLM with conversation context
 * Maintains short-term conversation history per group to support multi-turn chat
 */
export class SimpleReplyer {
  private personaPrompt = '你是一个普通大学生在一个 QQ 群里聊天，说话自然一点。';
  private historyLimit = 8; // Use last 8 turns for context

  constructor(
    private llm: LLMClient,
    private logger: Logger,
    private conversationStore: ConversationStore,
    // Future extensions:
    // private persona?: PersonaConfig,
  ) {}

  /**
   * Generate a reply for a chat event using conversation history
   */
  async reply(event: ChatEvent): Promise<string> {
    this.logger.debug('replyer', `Generating reply for message from ${event.userId}`);

    // Build messages list with system prompt + history + current message
    const history = this.conversationStore.getRecentTurns(event.groupId, this.historyLimit);

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: this.personaPrompt,
      },
      // Add conversation history
      ...history.map((turn) => ({
        role: turn.role === 'user' ? ('user' as const) : ('assistant' as const),
        content: turn.content,
      })),
      // Current user message
      {
        role: 'user',
        content: event.rawText,
      },
    ];

    try {
      const response = await this.llm.chat(messages);
      this.logger.debug('replyer', `Generated reply: "${response.substring(0, 50)}..."`);
      return response;
    } catch (error) {
      this.logger.error('replyer', `Failed to generate reply: ${error}`);
      // Fallback response
      return `Failed to generate reply: ${error}`;
    }
  }

  // Future methods:
  // async replyWithPersona(event: ChatEvent, persona: PersonaConfig): Promise<string>
  // async replyWithMemory(event: ChatEvent, history: Message[]): Promise<string>
  // async replyWithTools(event: ChatEvent, tools: Tool[]): Promise<string>
}
