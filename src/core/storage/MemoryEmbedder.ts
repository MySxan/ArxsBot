/**
 * MemoryEmbedder: 生成摘要 + embedding + 存储到向量数据库
 *
 * 当消息通过过滤器和判定器后，进行：
 * 1. LLM 生成记忆摘要
 * 2. Embedding 模型生成向量
 * 3. 存储到向量数据库
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  ChatMessage,
  EmbeddedMessage,
  ConversationChunk,
  EmbeddedChunk,
  MemorySearchOptions,
} from './types.js';
import { TAG_WEIGHTS } from './MessageFilter.js';
import { config } from '../../infra/config/config.js';
import { createLogger } from '../../infra/logger/logger.js';

const logger = createLogger(config);

export interface MemoryEmbedderConfig {
  // LLM 配置（用于生成摘要）
  llmEndpoint: string;
  llmApiKey: string;
  llmModel?: string;

  // Embedding 配置
  embeddingEndpoint: string;
  embeddingApiKey: string;
  embeddingModel?: string;

  // 向量存储配置
  vectorStoreDir?: string;

  // 淘汰策略配置
  maxStoreSize?: number; // 最大存储数量（超过后淘汰）
  decayDays?: number; // 时间衰减周期（天）

  // 懒写配置
  flushIntervalSeconds?: number; // 脏数据刷新间隔（秒），默认 60
}

/**
 * 摘要生成配置
 */
const SUMMARY_MAX_LEN = 1200; // 最大字符数，避免 LLM 吃垃圾 token

/**
 * 文本归一化（用于稳定的向量检索）
 */
function normalize(str: string): string {
  return str.toLowerCase().replace(/\s+/g, ' ').trim();
}

export class MemoryEmbedder {
  private config: Required<MemoryEmbedderConfig>;
  private vectorStore: EmbeddedMessage[] = []; // 单条消息存储
  private chunkStore: EmbeddedChunk[] = []; // chunk 级别存储

  // 懒写机制：标记脏数据
  private dirtyMessages = new Set<number>(); // 使用 timestamp 作为 ID
  private dirtyChunks = new Set<number>(); // 使用 startTimestamp 作为 ID
  private flushTimer?: NodeJS.Timeout;

  constructor(config: MemoryEmbedderConfig) {
    this.config = {
      llmEndpoint: config.llmEndpoint,
      llmApiKey: config.llmApiKey,
      llmModel: config.llmModel || 'deepseek-chat',
      embeddingEndpoint: config.embeddingEndpoint,
      embeddingApiKey: config.embeddingApiKey,
      embeddingModel: config.embeddingModel || 'text-embedding-3-small',
      vectorStoreDir: config.vectorStoreDir || './data/vector-store',
      maxStoreSize: config.maxStoreSize || 1000, // 默认最多 1000 条
      decayDays: config.decayDays || 30, // 默认 30 天衰减周期
      flushIntervalSeconds: config.flushIntervalSeconds || 60, // 默认 60 秒刷新
    };

    // 启动懒写定时器
    this.startFlushTimer();
  }

  /**
   * 启动懒写定时器
   */
  private startFlushTimer(): void {
    logger.info(
      'Storage',
      `Lazy flush timer started (interval: ${this.config.flushIntervalSeconds}s)`,
    );
    this.flushTimer = setInterval(() => {
      this.flushDirtyWeights().catch((err) => {
        logger.error('Storage', `Failed to flush dirty weights: ${err.message}`);
      });
    }, this.config.flushIntervalSeconds * 1000);
  }

  /**
   * 停止懒写定时器
   */
  destroy(): void {
    logger.info('Storage', 'Destroying MemoryEmbedder and flushing final state');
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    // 最后一次刷新
    this.flushDirtyWeights().catch((err) => {
      logger.error('Storage', `Failed to flush on destroy: ${err.message}`);
    });
  }

  /**
   * 初始化（加载已有的向量数据）
   */
  async initialize(): Promise<void> {
    logger.info('Storage', `Initializing vector store at ${this.config.vectorStoreDir}`);
    await fs.mkdir(this.config.vectorStoreDir, { recursive: true });

    // 加载单条消息的向量数据
    const indexFile = path.join(this.config.vectorStoreDir, 'index.json');
    try {
      const content = await fs.readFile(indexFile, 'utf-8');
      this.vectorStore = JSON.parse(content);
      logger.info('Storage', `Loaded ${this.vectorStore.length} messages from index`);
    } catch (error) {
      // 文件不存在，使用空数组
      logger.debug('Storage', 'No existing message index found, starting fresh');
      this.vectorStore = [];
    }

    // 加载 chunk 级别的向量数据
    const chunkFile = path.join(this.config.vectorStoreDir, 'chunks.json');
    try {
      const content = await fs.readFile(chunkFile, 'utf-8');
      this.chunkStore = JSON.parse(content);
      logger.info('Storage', `Loaded ${this.chunkStore.length} chunks from store`);
    } catch (error) {
      // 文件不存在，使用空数组
      logger.debug('Storage', 'No existing chunk store found, starting fresh');
      this.chunkStore = [];
    }
  }

  /**
   * 处理消息：生成摘要 → embedding → 存储
   */
  async embedMessage(message: ChatMessage, tags: string[]): Promise<EmbeddedMessage> {
    logger.debug(
      'Embedding',
      `Embedding message from ${message.userId} (tags: ${tags.join(', ')})`,
    );
    // 1. 生成记忆摘要
    const summary = await this.summarizeForMemory(message);

    // 2. 生成 embedding
    const embedding = await this.generateEmbedding(summary);

    // 3. 计算初始权重
    const weight = this.calculateInitialWeight(tags);

    // 4. 创建 EmbeddedMessage
    const embeddedMessage: EmbeddedMessage = {
      message,
      summary,
      embedding,
      tags,
      embeddedAt: Date.now(),
      weight,
      accessCount: 0,
      lastAccessTime: Date.now(),
    };

    // 5. 存储到向量数据库
    await this.saveToVectorStore(embeddedMessage);

    // 6. 检查是否需要淘汰
    await this.pruneIfNeeded();

    logger.info(
      'Embedding',
      `Embedded message (weight: ${weight.toFixed(2)}, dim: ${embedding.length})`,
    );
    return embeddedMessage;
  }

  /**
   * 处理对话片段：生成摘要 → embedding → 存储（推荐使用）
   */
  async embedConversationChunk(chunk: ConversationChunk, tags: string[]): Promise<EmbeddedChunk> {
    logger.debug(
      'Embedding',
      `Embedding chunk with ${chunk.messages.length} messages (tags: ${tags.join(', ')})`,
    );
    // 1. 生成 chunk 摘要
    const summary = await this.summarizeChunkForMemory(chunk);

    // 2. 生成 embedding
    const embedding = await this.generateEmbedding(summary);

    // 3. 计算初始权重（chunk 通常权重更高）
    const weight = this.calculateInitialWeight(tags) * 1.2; // chunk 加权 20%

    // 4. 创建 EmbeddedChunk
    const embeddedChunk: EmbeddedChunk = {
      chunk,
      summary,
      embedding,
      tags,
      embeddedAt: Date.now(),
      weight,
      accessCount: 0,
      lastAccessTime: Date.now(),
    };

    // 5. 存储到向量数据库
    await this.saveChunkToVectorStore(embeddedChunk);

    // 6. 检查是否需要淘汰
    await this.pruneIfNeeded();

    logger.info(
      'Embedding',
      `Embedded chunk (weight: ${weight.toFixed(2)}, messages: ${chunk.messages.length}, dim: ${embedding.length})`,
    );
    return embeddedChunk;
  }

  /**
   * 使用 LLM 生成记忆摘要（单条消息）
   */
  private async summarizeForMemory(message: ChatMessage): Promise<string> {
    // 截断长文本，避免 LLM 吃垃圾 token
    const truncatedText = message.rawText.slice(0, SUMMARY_MAX_LEN);
    if (message.rawText.length > SUMMARY_MAX_LEN) {
      logger.debug(
        'LLM',
        `Truncated message from ${message.rawText.length} to ${SUMMARY_MAX_LEN} chars`,
      );
    }
    const prompt = this.buildSummaryPrompt({ ...message, rawText: truncatedText });

    try {
      const response = await this.callLLM(prompt);
      // 归一化摘要
      const summary = normalize(response.trim());
      logger.debug(
        'LLM',
        `Generated summary: "${summary.length > 50 ? summary.substring(0, 50) + '...' : summary}"`,
      );
      return summary;
    } catch (error) {
      logger.warn(
        'LLM',
        `Summary generation failed, using raw text: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      // LLM 调用失败，使用原始文本（归一化）
      return normalize(`${message.userName || message.userId}: ${truncatedText}`);
    }
  }

  /**
   * 使用 LLM 生成 chunk 摘要
   */
  private async summarizeChunkForMemory(chunk: ConversationChunk): Promise<string> {
    // 截断长对话，避免 LLM 吃垃圾 token
    const truncatedChunk = {
      ...chunk,
      messages: chunk.messages.map((m) => ({
        ...m,
        rawText: m.rawText.slice(0, SUMMARY_MAX_LEN / chunk.messages.length),
      })),
    };

    const prompt = this.buildChunkSummaryPrompt(truncatedChunk);

    try {
      const response = await this.callLLM(prompt);
      // 归一化摘要
      return normalize(response.trim());
    } catch (error) {
      // LLM 调用失败，使用简单拼接（归一化）
      const participants = [...new Set(chunk.messages.map((m) => m.userName || m.userId))];
      const content = chunk.messages.map((m) => m.rawText).join(' ');
      return normalize(`${participants.join('、')} 等人讨论：${content.substring(0, 100)}...`);
    }
  }

  /**
   * 构建摘要 prompt（单条消息）
   */
  private buildSummaryPrompt(message: ChatMessage): string {
    return `你在观察一群朋友聊天，请用简短自然口语记录一条有用记忆

# 要求
- 保留人名、时间、地点、事件等关键信息
- 简化口语化表达为标准描述
- 如果有链接，保留完整链接
- 控制在 5~20 字，口语，但含信息点。

# 消息
用户: ${message.userName || message.userId}
内容: ${message.rawText}

# 摘要
直接输出摘要，不要其他内容。`;
  }

  /**
   * 构建 chunk 摘要 prompt
   */
  private buildChunkSummaryPrompt(chunk: ConversationChunk): string {
    const conversation = chunk.messages
      .map((m) => `${m.userName || m.userId}: ${m.rawText}`)
      .join('\n');

    const topicHint = chunk.topicHint ? `\n话题提示: ${chunk.topicHint}` : '';

    return `你在观察一群朋友聊天，请用简短自然口语记录一条有用记忆

# 要求
- 抓住对话的核心内容和上下文
- 保留人名、时间、地点、事件等关键信息
- 如果是问答，说明谁问了什么、谁回答了什么
- 如果有资源分享，保留完整链接
- 控制在 2-3 句话
${topicHint}

# 对话片段
${conversation}

# 摘要
直接输出摘要，不要其他内容。`;
  }

  /**
   * 调用 LLM 生成摘要
   */
  private async callLLM(prompt: string): Promise<string> {
    const response = await fetch(`${this.config.llmEndpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.llmApiKey}`,
      },
      body: JSON.stringify({
        model: this.config.llmModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 150,
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }

  /**
   * 生成 embedding 向量
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    // 归一化文本，确保向量检索稳定
    const normalizedText = normalize(text);

    const response = await fetch(`${this.config.embeddingEndpoint}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.embeddingApiKey}`,
      },
      body: JSON.stringify({
        model: this.config.embeddingModel,
        input: normalizedText,
      }),
    });

    if (!response.ok) {
      throw new Error(`Embedding API error: ${response.status}`);
    }

    const data = await response.json();
    return data.data[0].embedding;
  }

  /**
   * 保存到向量数据库（单条消息）
   */
  private async saveToVectorStore(embeddedMessage: EmbeddedMessage): Promise<void> {
    // 添加到内存
    this.vectorStore.push(embeddedMessage);

    // 持久化到磁盘（异步）
    const indexFile = path.join(this.config.vectorStoreDir, 'index.json');
    const content = JSON.stringify(this.vectorStore, null, 2);
    await fs.writeFile(indexFile, content, 'utf-8');
  }

  /**
   * 保存 chunk 到向量数据库
   */
  private async saveChunkToVectorStore(embeddedChunk: EmbeddedChunk): Promise<void> {
    // 添加到内存
    this.chunkStore.push(embeddedChunk);

    // 持久化到磁盘（异步）
    const chunkFile = path.join(this.config.vectorStoreDir, 'chunks.json');
    const content = JSON.stringify(this.chunkStore, null, 2);
    await fs.writeFile(chunkFile, content, 'utf-8');
  }

  /**
   * 高级搜索相似记忆（支持多条件过滤）
   */
  async searchMemoriesAdvanced(
    options: MemorySearchOptions,
  ): Promise<Array<EmbeddedMessage | EmbeddedChunk>> {
    logger.debug(
      'Search',
      `Searching memories: "${options.queryText.substring(0, 30)}..." (limit: ${options.limit || 5})`,
    );
    // 1. 生成查询的 embedding
    const queryEmbedding = await this.generateEmbedding(options.queryText);

    // 2. 过滤并计算单条消息的相似度
    const messageSimilarities = this.vectorStore
      .filter((item) => this.matchesFilters(item, options))
      .map((item) => ({
        item,
        similarity: this.cosineSimilarity(queryEmbedding, item.embedding),
        type: 'message' as const,
      }));

    // 3. 过滤并计算 chunks 的相似度
    const chunkSimilarities = this.chunkStore
      .filter((item) => this.matchesChunkFilters(item, options))
      .map((item) => ({
        item,
        similarity: this.cosineSimilarity(queryEmbedding, item.embedding),
        type: 'chunk' as const,
      }));

    // 4. 合并并排序
    const allSimilarities = [...messageSimilarities, ...chunkSimilarities];

    // 5. 过滤最小相似度
    const filtered = options.minScore
      ? allSimilarities.filter((s) => s.similarity >= options.minScore!)
      : allSimilarities;

    filtered.sort((a, b) => b.similarity - a.similarity);

    // 6. 返回 top K
    const limit = options.limit || 5;
    const results = filtered.slice(0, limit).map((s) => s.item);

    logger.info(
      'Search',
      `Found ${results.length} results (${results.filter((r) => 'chunk' in r).length} chunks, ${results.filter((r) => 'message' in r).length} messages)`,
    );
    return results;
  }

  /**
   * 检查单条消息是否匹配过滤条件
   */
  private matchesFilters(item: EmbeddedMessage, options: MemorySearchOptions): boolean {
    // 过滤 groupId
    if (options.groupId && item.message.groupId !== options.groupId) {
      return false;
    }

    // 过滤 userId
    if (options.userId && item.message.userId !== options.userId) {
      return false;
    }

    // 过滤 tags
    if (options.tags && options.tags.length > 0) {
      const hasMatchingTag = options.tags.some((tag) => item.tags.includes(tag));
      if (!hasMatchingTag) return false;
    }

    // 过滤时间
    if (options.since && item.embeddedAt < options.since) {
      return false;
    }

    return true;
  }

  /**
   * 检查 chunk 是否匹配过滤条件
   */
  private matchesChunkFilters(item: EmbeddedChunk, options: MemorySearchOptions): boolean {
    // 过滤 groupId
    if (options.groupId && item.chunk.groupId !== options.groupId) {
      return false;
    }

    // 过滤 userId（chunk 中是否包含该用户）
    if (options.userId && !item.chunk.participantIds.includes(options.userId)) {
      return false;
    }

    // 过滤 tags
    if (options.tags && options.tags.length > 0) {
      const hasMatchingTag = options.tags.some((tag) => item.tags.includes(tag));
      if (!hasMatchingTag) return false;
    }

    // 过滤时间
    if (options.since && item.embeddedAt < options.since) {
      return false;
    }

    return true;
  }

  /**
   * 搜索相似记忆（同时搜索单条消息和 chunks）
   */
  async searchSimilar(
    query: string,
    topK: number = 5,
  ): Promise<Array<EmbeddedMessage | EmbeddedChunk>> {
    return this.searchMemoriesAdvanced({ queryText: query, limit: topK });
  }

  /**
   * 计算余弦相似度
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) return 0;

    return dotProduct / (normA * normB);
  }

  /**
   * 计算初始权重（基于标签）
   */
  private calculateInitialWeight(tags: string[]): number {
    if (tags.length === 0) return 0.5; // 默认权重

    const weights = tags.map((tag) => TAG_WEIGHTS[tag] || 0.5);
    return Math.max(...weights); // 取最高权重
  }

  /**
   * 计算时间衰减后的权重
   * 公式: weight * exp(-age / decayDays)
   */
  private calculateDecayedWeight(item: EmbeddedMessage | EmbeddedChunk): number {
    const now = Date.now();
    const ageInDays = (now - item.embeddedAt) / (24 * 60 * 60 * 1000);
    const decayFactor = Math.exp(-ageInDays / this.config.decayDays);

    // 访问次数加成（每次访问 +5% 权重）
    const accessBonus = 1 + (item.accessCount || 0) * 0.05;

    return item.weight * decayFactor * accessBonus;
  }

  /**
   * 检查并淘汰低权重记忆
   */
  private async pruneIfNeeded(): Promise<void> {
    const totalCount = this.vectorStore.length + this.chunkStore.length;

    if (totalCount <= this.config.maxStoreSize) {
      return; // 未超限，不需要淘汰
    }

    logger.info('Storage', `Pruning memories: ${totalCount} > ${this.config.maxStoreSize}`);

    // 合并所有记忆并计算衰减后权重
    const allMemories = [
      ...this.vectorStore.map((item) => ({
        item,
        type: 'message' as const,
        decayedWeight: this.calculateDecayedWeight(item),
      })),
      ...this.chunkStore.map((item) => ({
        item,
        type: 'chunk' as const,
        decayedWeight: this.calculateDecayedWeight(item),
      })),
    ];

    // 按权重排序（从低到高）
    allMemories.sort((a, b) => a.decayedWeight - b.decayedWeight);

    // 计算需要删除的数量
    const toDelete = totalCount - this.config.maxStoreSize;
    const toDeleteItems = allMemories.slice(0, toDelete);

    // 分别从 vectorStore 和 chunkStore 中删除
    const deleteMessageIds = new Set(
      toDeleteItems
        .filter((m) => m.type === 'message')
        .map((m) => (m.item as EmbeddedMessage).message.timestamp),
    );
    const deleteChunkIds = new Set(
      toDeleteItems
        .filter((m) => m.type === 'chunk')
        .map((m) => (m.item as EmbeddedChunk).chunk.startTimestamp),
    );

    this.vectorStore = this.vectorStore.filter(
      (item) => !deleteMessageIds.has(item.message.timestamp),
    );
    this.chunkStore = this.chunkStore.filter(
      (item) => !deleteChunkIds.has(item.chunk.startTimestamp),
    );

    logger.info(
      'Storage',
      `Pruned ${toDelete} memories (messages: ${deleteMessageIds.size}, chunks: ${deleteChunkIds.size})`,
    );

    // 持久化更新
    await this.persistAllStores();
  }

  /**
   * 持久化所有存储
   */
  private async persistAllStores(): Promise<void> {
    const indexFile = path.join(this.config.vectorStoreDir, 'index.json');
    const chunkFile = path.join(this.config.vectorStoreDir, 'chunks.json');

    await Promise.all([
      fs.writeFile(indexFile, JSON.stringify(this.vectorStore, null, 2), 'utf-8'),
      fs.writeFile(chunkFile, JSON.stringify(this.chunkStore, null, 2), 'utf-8'),
    ]);
  }

  /**
   * 更新访问统计（用于增强权重）- 懒写模式
   */
  updateAccessStats(item: EmbeddedMessage | EmbeddedChunk): void {
    item.accessCount = (item.accessCount || 0) + 1;
    item.lastAccessTime = Date.now();

    // 标记为脏数据，等待定时刷新
    if ('message' in item) {
      this.dirtyMessages.add(item.message.timestamp);
    } else {
      this.dirtyChunks.add(item.chunk.startTimestamp);
    }
  }

  /**
   * 批量刷新脏数据到磁盘（懒写）
   */
  private async flushDirtyWeights(): Promise<void> {
    if (this.dirtyMessages.size === 0 && this.dirtyChunks.size === 0) {
      return; // 无脏数据，跳过
    }

    logger.debug(
      'Storage',
      `Flushing dirty weights (messages: ${this.dirtyMessages.size}, chunks: ${this.dirtyChunks.size})`,
    );

    // 持久化到磁盘
    await this.persistAllStores();

    logger.info(
      'Storage',
      `Flushed ${this.dirtyMessages.size + this.dirtyChunks.size} dirty items to disk`,
    );

    // 清空脏标记
    this.dirtyMessages.clear();
    this.dirtyChunks.clear();
  }

  /**
   * 获取统计信息
   */
  getStats(): { totalMessages: number; totalChunks: number; averageEmbeddingDim: number } {
    const sampleEmbedding =
      this.vectorStore.length > 0
        ? this.vectorStore[0].embedding
        : this.chunkStore.length > 0
          ? this.chunkStore[0].embedding
          : [];

    return {
      totalMessages: this.vectorStore.length,
      totalChunks: this.chunkStore.length,
      averageEmbeddingDim: sampleEmbedding.length,
    };
  }
}
