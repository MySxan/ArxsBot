/**
 * Storage Layer - 统一入口
 *
 * 提供完整的消息存储 + 记忆管理功能
 */

export * from './types.js';
export * from './AppendOnlyEventLog.js';
export * from './RingBufferStore.js';
export * from './MessageFilter.js';
export * from './MemoryEmbedder.js';
export * from './ConversationChunkBuilder.js';

import { AppendOnlyEventLog } from './AppendOnlyEventLog.js';
import { RingBufferStore } from './RingBufferStore.js';
import { MessageFilter } from './MessageFilter.js';
import { MemoryEmbedder } from './MemoryEmbedder.js';
import { ConversationChunkBuilder } from './ConversationChunkBuilder.js';
import type { ChatMessage, MemorySearchOptions } from './types.js';
import { config } from '../../infra/config/config.js';
import { createLogger } from '../../infra/logger/logger.js';

const logger = createLogger(config);

/**
 * 成本控制配置
 */
export interface RateLimitConfig {
  embedCallsPerMinute: number; // 每分钟最多调用 embed 次数
  enableCircuitBreaker: boolean; // 是否启用熄断器
}

/**
 * StorageManager: 协调所有存储层组件
 */
export class StorageManager {
  private eventLog: AppendOnlyEventLog;
  private ringBuffer: RingBufferStore;
  private filter: MessageFilter;
  private embedder?: MemoryEmbedder;
  private chunkBuilder: ConversationChunkBuilder;

  // 成本控制：限速器
  private rateLimit: RateLimitConfig;
  private embedCalls: number[] = []; // 时间戳数组
  private circuitBreakerOpen = false; // 熔断器状态

  constructor(config?: {
    eventLogDir?: string;
    ringBufferDir?: string;
    ringBufferSize?: number;
    llmEndpoint?: string;
    llmApiKey?: string;
    embeddingEndpoint?: string;
    embeddingApiKey?: string;
    rateLimit?: Partial<RateLimitConfig>;
  }) {
    logger.info('Storage', 'Initializing StorageManager');
    this.eventLog = new AppendOnlyEventLog(config?.eventLogDir);
    this.ringBuffer = new RingBufferStore({
      maxSize: config?.ringBufferSize || 50,
      persistDir: config?.ringBufferDir,
    });
    this.filter = new MessageFilter();
    this.chunkBuilder = new ConversationChunkBuilder();

    // 成本控制配置
    this.rateLimit = {
      embedCallsPerMinute: config?.rateLimit?.embedCallsPerMinute || 20,
      enableCircuitBreaker: config?.rateLimit?.enableCircuitBreaker ?? true,
    };

    // 可选：启用 embedding
    if (
      config?.embeddingEndpoint &&
      config?.embeddingApiKey &&
      config?.llmEndpoint &&
      config?.llmApiKey
    ) {
      logger.info('Storage', 'Embedding enabled with LLM summarization');
      this.embedder = new MemoryEmbedder({
        embeddingEndpoint: config.embeddingEndpoint,
        embeddingApiKey: config.embeddingApiKey,
        llmEndpoint: config.llmEndpoint,
        llmApiKey: config.llmApiKey,
      });
    } else {
      logger.warn('Storage', 'Embedding disabled - no API credentials provided');
    }
  }

  /**
   * 处理新消息（简化流程：仅基于规则过滤）
   */
  async processMessage(message: ChatMessage): Promise<void> {
    logger.debug(
      'Storage',
      `Processing message from ${message.userId} in ${message.platform}/${message.groupId}`,
    );

    // 1. 原始事件日志（无条件保存）
    await this.eventLog.append(message);

    // 2. Ring buffer（无条件保存）
    await this.ringBuffer.append(message);

    // 3. Chunk builder（尝试组装对话片段）
    const chunk = this.chunkBuilder.addMessage(message);

    // 4. 过滤 + 打标签（规则决策）
    const filterResult = this.filter.shouldEmbed(message);

    if (!filterResult.shouldEmbed || !this.embedder || this.circuitBreakerOpen) {
      if (this.circuitBreakerOpen) {
        logger.warn('RateLimit', 'Circuit breaker is open, skipping embedding');
      } else if (!this.embedder) {
        logger.debug('Storage', 'Embedder not configured, skipping');
      }
      return; // 不需要 embed 或熔断器打开
    }

    // 5. 检查限速
    if (!this.checkEmbedRateLimit()) {
      logger.warn(
        'RateLimit',
        `Embed rate limit exceeded (${this.embedCalls.length}/${this.rateLimit.embedCallsPerMinute} per minute)`,
      );
      return; // 超过限速，跳过
    }

    // 6. 生成 embedding（根据 needsSummary 决定是否调用 LLM）
    if (filterResult.needsSummary) {
      // 需要摘要：调用 LLM + embedding
      logger.info(
        'Storage',
        `Embedding message with summary (tags: ${filterResult.tags.join(', ')})`,
      );
      await this.embedder.embedMessage(message, filterResult.tags);
    } else {
      // 不需要摘要：直接用原文 + embedding
      logger.info(
        'Storage',
        `Embedding message without summary (tags: ${filterResult.tags.join(', ')})`,
      );
      await this.embedder.embedMessage(message, filterResult.tags);
    }
    this.recordEmbedCall();

    // 7. 如果生成了完整 chunk，进行 chunk 级 embedding（推荐）
    if (chunk && this.checkEmbedRateLimit()) {
      logger.info('Storage', `Embedding conversation chunk (${chunk.messages.length} messages)`);
      await this.embedder.embedConversationChunk(chunk, ['chunk']);
      this.recordEmbedCall();
    }
  }

  /**
   * 获取最近消息
   */
  getRecentMessages(platform: string, groupId: string, limit?: number): ChatMessage[] {
    return this.ringBuffer.getRecent(platform, groupId, limit);
  }

  /**
   * 搜索相似记忆（高级版，支持多条件过滤）
   */
  async searchMemories(options: string | MemorySearchOptions) {
    if (!this.embedder) {
      throw new Error('MemoryEmbedder not initialized');
    }

    // 兼容旧版 API
    if (typeof options === 'string') {
      return this.embedder.searchSimilar(options, 5);
    }

    return this.embedder.searchMemoriesAdvanced(options);
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ringBuffer: this.ringBuffer.getStats(),
      chunkBuilder: this.chunkBuilder.getStats(),
      embedder: this.embedder?.getStats() || {
        totalMessages: 0,
        totalChunks: 0,
        averageEmbeddingDim: 0,
      },
      rateLimit: {
        embedCallsLastMinute: this.embedCalls.length,
        circuitBreakerOpen: this.circuitBreakerOpen,
      },
    };
  }

  /**
   * 检查 embed 调用限速
   */
  private checkEmbedRateLimit(): boolean {
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;

    // 清理过期记录
    this.embedCalls = this.embedCalls.filter((ts) => ts > oneMinuteAgo);

    // 检查是否超限
    if (this.embedCalls.length >= this.rateLimit.embedCallsPerMinute) {
      if (this.rateLimit.enableCircuitBreaker) {
        logger.warn(
          'RateLimit',
          `Circuit breaker triggered: ${this.embedCalls.length}/${this.rateLimit.embedCallsPerMinute} calls, cooling down for 60s`,
        );
        this.circuitBreakerOpen = true;
        setTimeout(() => {
          logger.info('RateLimit', 'Circuit breaker closed, resuming embeddings');
          this.circuitBreakerOpen = false;
        }, 60 * 1000);
      }
      return false;
    }

    return true;
  }

  /**
   * 记录 embed 调用
   */
  private recordEmbedCall(): void {
    this.embedCalls.push(Date.now());
  }
}
