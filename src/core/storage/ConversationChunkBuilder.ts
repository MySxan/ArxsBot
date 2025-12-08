/**
 * ConversationChunkBuilder: 将连续消息组装成有意义的片段
 *
 * 策略：
 * - 同一个群 + 同一个话题 + 连续若干条
 * - 满足一定长度但不超过上限
 * - 中间没有太多无用水字
 */

import type { ChatMessage, ConversationChunk } from './types.js';
import { config } from '../../infra/config/config.js';
import { createLogger } from '../../infra/logger/logger.js';

const logger = createLogger(config);

export interface ChunkBuilderConfig {
  maxChunkSize: number; // 最多几条消息
  maxChunkDuration: number; // 最长时间跨度（ms）
  maxSummaryLength: number; // 摘要最大长度
  minUsefulRatio: number; // 最小有用消息比例
}

export class ConversationChunkBuilder {
  private config: ChunkBuilderConfig;
  private pendingChunks = new Map<string, ChatMessage[]>(); // key: platform:groupId

  constructor(config?: Partial<ChunkBuilderConfig>) {
    this.config = {
      maxChunkSize: config?.maxChunkSize || 8,
      maxChunkDuration: config?.maxChunkDuration || 5 * 60 * 1000, // 5分钟
      maxSummaryLength: config?.maxSummaryLength || 200,
      minUsefulRatio: config?.minUsefulRatio || 0.4, // 至少40%有用
    };
  }

  /**
   * 添加消息到待处理缓冲区
   * @returns 如果生成了完整 chunk，返回该 chunk
   */
  addMessage(message: ChatMessage): ConversationChunk | null {
    const key = `${message.platform}:${message.groupId}`;

    // 获取或创建缓冲区
    let buffer = this.pendingChunks.get(key);
    if (!buffer) {
      buffer = [];
      this.pendingChunks.set(key, buffer);
    }

    buffer.push(message);

    // 检查是否应该完成当前 chunk
    if (this.shouldFinalize(buffer)) {
      const chunk = this.buildChunk(buffer);
      logger.info(
        'Chunk',
        `Finalized chunk: ${chunk.messages.length} messages from ${chunk.platform}/${chunk.groupId}`,
      );
      this.pendingChunks.set(key, []); // 清空缓冲区
      return chunk;
    }

    return null;
  }

  /**
   * 判断是否应该完成当前 chunk
   */
  private shouldFinalize(buffer: ChatMessage[]): boolean {
    if (buffer.length === 0) return false;

    // 条件 1: 达到最大数量
    if (buffer.length >= this.config.maxChunkSize) return true;

    // 条件 2: 时间跨度过长
    const duration = buffer[buffer.length - 1].timestamp - buffer[0].timestamp;
    if (duration > this.config.maxChunkDuration) return true;

    // 条件 3: 话题明显切换（检测到命令或长时间间隔）
    const latest = buffer[buffer.length - 1];
    if (latest.isCommand) return true;

    if (buffer.length >= 2) {
      const secondLast = buffer[buffer.length - 2];
      const gap = latest.timestamp - secondLast.timestamp;
      if (gap > 2 * 60 * 1000) return true; // 超过2分钟
    }

    return false;
  }

  /**
   * 构建 ConversationChunk
   */
  private buildChunk(messages: ChatMessage[]): ConversationChunk {
    if (messages.length === 0) {
      throw new Error('Cannot build chunk from empty messages');
    }

    // 过滤掉太短或无意义的消息
    const filteredMessages = this.filterUsefulMessages(messages);

    // 收集参与者
    const participantIds = [...new Set(filteredMessages.map((m) => m.userId))];

    return {
      messages: filteredMessages,
      platform: messages[0].platform,
      groupId: messages[0].groupId,
      startTimestamp: filteredMessages[0].timestamp,
      endTimestamp: filteredMessages[filteredMessages.length - 1].timestamp,
      participantIds,
      topicHint: this.extractTopicHint(filteredMessages),
    };
  }

  /**
   * 过滤有用的消息
   */
  private filterUsefulMessages(messages: ChatMessage[]): ChatMessage[] {
    const filtered = messages.filter((msg) => {
      // 保留命令
      if (msg.isCommand) return true;

      // 保留 bot 的回复
      if (msg.fromBot) return true;

      // 过滤太短的消息
      if (msg.rawText.trim().length < 3) return false;

      // 过滤纯 emoji
      const onlyEmoji = /^[\p{Emoji}\s]+$/u.test(msg.rawText);
      if (onlyEmoji) return false;

      return true;
    });

    // 如果过滤后太少，保留原始消息
    if (filtered.length < messages.length * this.config.minUsefulRatio) {
      return messages;
    }

    return filtered;
  }

  /**
   * 提取话题提示（简单启发式）
   */
  private extractTopicHint(messages: ChatMessage[]): string | undefined {
    const allText = messages.map((m) => m.rawText).join(' ');

    // 检测关键词
    const keywords = {
      '作业|deadline|due': '作业相关',
      '考试|midterm|final': '考试相关',
      'cs\\d+|math\\d+': '课程相关',
      'https?://': '资源分享',
      '链接|link|url': '资源分享',
      '问题|help|求助': '求助讨论',
    };

    for (const [pattern, hint] of Object.entries(keywords)) {
      if (new RegExp(pattern, 'i').test(allText)) {
        return hint;
      }
    }

    return undefined;
  }

  /**
   * 强制完成所有待处理的 chunks
   */
  finalizeAll(): ConversationChunk[] {
    const chunks: ConversationChunk[] = [];

    for (const [key, buffer] of this.pendingChunks.entries()) {
      if (buffer.length > 0) {
        chunks.push(this.buildChunk(buffer));
      }
    }

    this.pendingChunks.clear();
    return chunks;
  }

  /**
   * 获取统计信息
   */
  getStats(): { pendingBuffers: number; totalPendingMessages: number } {
    let totalMessages = 0;
    for (const buffer of this.pendingChunks.values()) {
      totalMessages += buffer.length;
    }

    return {
      pendingBuffers: this.pendingChunks.size,
      totalPendingMessages: totalMessages,
    };
  }
}
