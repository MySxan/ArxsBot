/**
 * LLM message format (OpenAI-compatible)
 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * LLM client interface for chat completion
 */
export interface LLMClient {
  /**
   * Send messages to LLM and get a response
   * @param messages - Conversation history
   * @returns LLM response text
   */
  chat(messages: LLMMessage[]): Promise<string>;
}

/**
 * LLM configuration
 */
export interface LLMConfig {
  /** API base URL */
  baseUrl: string;

  /** API key */
  apiKey: string;

  /** Model name */
  model: string;

  /** Temperature (0-2, default 1) */
  temperature?: number;

  /** Max tokens to generate */
  maxTokens?: number;

  /** Thinking budget for DeepSeek Reasoner (max tokens for thinking process) */
  thinkingBudget?: number;
}
