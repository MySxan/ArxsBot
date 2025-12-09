import type { LLMClient, LLMMessage, LLMConfig } from './types.js';
import type { Logger } from '../../infra/logger/logger.js';

/**
 * OpenAI-compatible LLM client (works with DeepSeek, OpenAI, etc.)
 */
export class OpenAICompatibleClient implements LLMClient {
  private baseUrl: string;
  private apiKey: string;
  private currentConfig: import('./types.js').ModelConfig;
  private defaultConfig: import('./types.js').ModelConfig;
  private nyaConfig?: import('./types.js').ModelConfig;
  private isReasonerModel: boolean;

  constructor(
    private logger: Logger,
    config: LLMConfig,
  ) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.defaultConfig = config.default;
    this.nyaConfig = config.nya;
    this.currentConfig = this.defaultConfig;
    this.isReasonerModel = this.currentConfig.model.includes('reasoner');

    this.logger.info(
      'llm-client',
      `Initialized ${this.currentConfig.model} at ${this.baseUrl}${this.isReasonerModel ? ' (with thinking mode)' : ''}`,
    );
  }

  /**
   * Switch to nya persona model
   */
  switchToNya(): void {
    if (this.nyaConfig) {
      this.currentConfig = this.nyaConfig;
      this.isReasonerModel = this.currentConfig.model.includes('reasoner');
      this.logger.info('llm-client', `Switched to nya model: ${this.currentConfig.model}`);
    } else {
      this.logger.warn('llm-client', 'Nya model config not found, using default');
    }
  }

  /**
   * Switch to default persona model
   */
  switchToDefault(): void {
    this.currentConfig = this.defaultConfig;
    this.isReasonerModel = this.currentConfig.model.includes('reasoner');
    this.logger.info('llm-client', `Switched to default model: ${this.currentConfig.model}`);
  }

  async chat(messages: LLMMessage[]): Promise<string> {
    const startTime = Date.now();
    this.logger.debug(
      'llm-client',
      `Chat request: ${messages.length} messages, model=${this.currentConfig.model}, temp=${this.currentConfig.temperature ?? 1}`,
    );

    try {
      const requestBody: any = {
        model: this.currentConfig.model,
        messages,
        temperature: this.currentConfig.temperature ?? 1,
        max_tokens: this.currentConfig.maxTokens ?? 2000,
      };

      // Add thinking budget for DeepSeek Reasoner model
      if (this.isReasonerModel && this.currentConfig.thinkingBudget) {
        requestBody.thinking = {
          type: 'enabled',
          budget_tokens: this.currentConfig.thinkingBudget,
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
