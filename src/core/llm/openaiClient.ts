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

  constructor(
    private logger: Logger,
    config: LLMConfig,
  ) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.temperature = config.temperature ?? 1;
    this.maxTokens = config.maxTokens ?? 2000;

    this.logger.info('llm-client', `Initialized ${this.model} at ${this.baseUrl}`);
  }

  async chat(messages: LLMMessage[]): Promise<string> {
    const startTime = Date.now();

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: this.temperature,
          max_tokens: this.maxTokens,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LLM API error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error('No content in LLM response');
      }

      const latency = Date.now() - startTime;
      this.logger.debug('llm-client', `Chat completed in ${latency}ms`);

      return content.trim();
    } catch (error) {
      this.logger.error('llm-client', `Chat failed: ${error}`);
      throw error;
    }
  }
}
