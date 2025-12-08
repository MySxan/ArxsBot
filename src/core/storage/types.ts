/**
 * Storage layer types for message persistence and memory
 */

/**
 * Raw chat message for storage
 */
export interface ChatMessage {
  // Event identifiers
  platform: string;
  groupId: string;
  userId: string;
  userName?: string;

  // Message content
  rawText: string;
  timestamp: number;

  // Message metadata
  fromBot: boolean;
  mentionsBot?: boolean;
  isCommand?: boolean;

  // Original event data (for debugging)
  rawEvent?: unknown;
}

/**
 * Conversation chunk - 几条连续消息组成的片段
 */
export interface ConversationChunk {
  messages: ChatMessage[];
  platform: string;
  groupId: string;
  startTimestamp: number;
  endTimestamp: number;
  participantIds: string[];
  topicHint?: string; // 话题提示
}

/**
 * Message with embedding metadata
 */
export interface EmbeddedMessage {
  message: ChatMessage;
  summary: string; // LLM-generated summary for memory
  embedding: number[]; // Vector embedding
  tags: string[]; // Auto-generated tags

  // Metadata
  embeddedAt: number;
  weight: number; // 权重（用于淘汰策略）
  accessCount?: number; // 访问次数（影响权重）
  lastAccessTime?: number; // 最后访问时间
}

/**
 * Chunk with embedding metadata (推荐用于记忆存储)
 */
export interface EmbeddedChunk {
  chunk: ConversationChunk;
  summary: string; // LLM-generated summary for memory
  embedding: number[]; // Vector embedding
  tags: string[]; // Auto-generated tags

  // Metadata
  embeddedAt: number;
  weight: number; // 权重（用于淘汰策略）
  accessCount?: number; // 访问次数（影响权重）
  lastAccessTime?: number; // 最后访问时间
}

/**
 * Tags that can be applied to messages for filtering
 * 新的 7 类标签系统
 */
export type MessageTag =
  | 'q.ask' // 问题
  | 'resource.link' // 资源链接
  | 'event.time' // 时间事件
  | 'fact.numeric' // 数字事实
  | 'emotion' // 情绪表达
  | 'bot.related' // @机器人
  | 'self.disclosure' // 人设信息
  | 'general' // 普通消息
  | 'chunk'; // chunk 标签

/**
 * Result from message filtering
 */
export interface FilterResult {
  shouldEmbed: boolean;
  tags: string[]; // 改为 string[] 以支持自定义标签
  reason?: string;
  confidence: number; // 规则判断的置信度
  needsSummary: boolean; // 是否需要 LLM 摘要
}

/**
 * Search query options for memory retrieval
 */
export interface MemorySearchOptions {
  queryText: string;
  limit?: number;
  groupId?: string; // 优先本群的记忆
  userId?: string; // 优先某用户相关记忆
  tags?: string[]; // 只要包含特定标签的
  since?: number; // 最近 N 天的记忆（时间戳）
  minScore?: number; // 最小相似度分数
}
