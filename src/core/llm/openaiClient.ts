import type { LLMClient, LLMMessage, LLMConfig } from './types.js';
import type { Logger } from '../../infra/logger/logger.js';

/**
 * OpenAI-compatible LLM client (works with DeepSeek, OpenAI, etc.)
 */
export class OpenAICompatibleClient implements LLMClient {
  private baseUrl: string;
  private apiKey: string;
  private model: string;
  private temperature: number;
  private maxTokens: number;
  private thinkingBudget?: number;
  private isReasonerModel: boolean;

  constructor(
    private logger: Logger,
    config: LLMConfig,
  ) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.temperature = config.temperature ?? 1;
    this.maxTokens = config.maxTokens ?? 2000;
    this.thinkingBudget = config.thinkingBudget;
    this.isReasonerModel = this.model.includes('reasoner');

    this.logger.info(
      'llm-client',
      `Initialized ${this.model} at ${this.baseUrl}${this.isReasonerModel ? ' (with thinking mode)' : ''}`,
    );
  }

  async chat(messages: LLMMessage[]): Promise<string> {
    const startTime = Date.now();
    this.logger.debug(
      'llm-client',
      `Chat request: ${messages.length} messages, model=${this.model}, temp=${this.temperature}`,
    );

    try {
      const requestBody: any = {
        model: this.model,
        messages,
        temperature: this.temperature,
        max_tokens: this.maxTokens,
      };

      // Add thinking budget for DeepSeek Reasoner model
      if (this.isReasonerModel && this.thinkingBudget) {
        requestBody.thinking = {
          type: 'enabled',
          budget_tokens: this.thinkingBudget,
        };
      }

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(
          'llm-client',
          `LLM API error (${response.status}): ${errorText.substring(0, 100)}`,
        );
        throw new Error(`LLM API error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      const message = data.choices?.[0]?.message;
      const content = message?.content;

      if (!content) {
        throw new Error('No content in LLM response');
      }

      const latency = Date.now() - startTime;
      const thinkingContent = message?.thinking
        ? ` (thinking: ${message.thinking.length} chars)`
        : '';
      this.logger.debug('llm-client', `Chat completed in ${latency}ms${thinkingContent}`);

      // For reasoner models, return only the response, not the thinking process
      return content.trim();
    } catch (error) {
      this.logger.error('llm-client', `Chat failed: ${error}`);
      throw error;
    }
  }
}
