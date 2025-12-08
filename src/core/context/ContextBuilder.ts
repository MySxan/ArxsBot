/**
 * ContextBuilder: 负责智能选择上下文
 * 拆分成三块：
 * 1. 存什么：原始消息流 & 衣生信息（ConversationStore）
 * 2. 怎么选：这一条消息要回复时，要带哪一小段上下文给 LLM（本模块）
 * 3. 怎么営：上下文在 prompt 里长什么样（PromptBuilder）
 */

import type { ChatEvent } from '../model/ChatEvent.js';
import type { ConversationStore, ChatTurn } from '../memory/ConversationStore.js';
import { config } from '../../infra/config/config.js';
import { createLogger } from '../../infra/logger/logger.js';

const logger = createLogger(config);

/**
 * 回复上下文 - 包含三层信息：
 * - Raw turns: 最近几条对话（短期）
 * - Context summary: 这一小段对话在聊啥、气氛如何（微型摘要）
 * - Behavior signals: 活跃度/亲密度/复读情况（meta信息）
 */
export interface ReplyContext {
  recentTurns: ChatTurn[]; // 给 LLM 用的原始上下文（3-6条）
  topicSummary?: string; // "他们刚刚在讨论…" 这样的短句
  meta: {
    sinceLastBotMs: number; // 距离上次 bot 回复的时间
    messagesInWindow: number; // 这一轮对话有几条消息
    isSameTopic: boolean; // 是否还在同一话题
  };
}

export class ContextBuilder {
  constructor(private conversationStore: ConversationStore) {}

  /**
   * 为当前事件构建智能上下文
   */
  buildForEvent(event: ChatEvent): ReplyContext {
    const key = `${event.platform}:${event.groupId}`;
    const now = event.timestamp ?? Date.now();

    // 1) 找到上一次 bot 说话的时间
    // 注意：recent 包含了当前消息，需要排除
    const allRecent = this.conversationStore.getRecentTurns(key, 40);
    const recent = allRecent.slice(0, -1); // 排除最后一条（当前消息）

    const lastBotIndex = [...recent].reverse().findIndex((t) => t.role === 'bot');
    const lastBotTurn = lastBotIndex === -1 ? undefined : recent[recent.length - 1 - lastBotIndex];

    const sinceLastBotMs = lastBotTurn ? now - lastBotTurn.timestamp : Infinity;

    // 2) 决定"这一轮上下文"的候选区间
    let candidate: ChatTurn[];
    if (sinceLastBotMs < 2 * 60 * 1000) {
      // 2 分钟内，按"这一轮对话"来取（从上次 bot 回复到现在）
      const lastBotTs = lastBotTurn!.timestamp;
      candidate = recent.filter((t) => t.timestamp >= lastBotTs);
    } else {
      // 很久没说话了，只取最近几条
      candidate = recent.slice(-6);
    }

    // 3) 从候选里再抽 3～6 条给 LLM
    const recentTurns = this.pickForLLM(candidate);

    // 4) 做一个很短的 topicSummary（可选，先简单写死规则）
    const topicSummary = this.buildTopicSummary(recentTurns);

    return {
      recentTurns,
      topicSummary,
      meta: {
        sinceLastBotMs,
        messagesInWindow: candidate.length,
        isSameTopic: sinceLastBotMs < 2 * 60 * 1000 && candidate.length > 1,
      },
    };
  }

  /**
   * 从候选上下文中挑选最多 5 条给 LLM（模拟人类短期记忆）
   */
  private pickForLLM(candidate: ChatTurn[]): ChatTurn[] {
    // 简单版：最多 5 条，保证包含当前 user 前面的几条
    const max = 5;
    return candidate.slice(-max);
  }

  /**
   * 构建话题摘要（超简单启发式）
   */
  private buildTopicSummary(turns: ChatTurn[]): string | undefined {
    if (turns.length === 0) return undefined;

    const text = turns.map((t) => t.content).join('\n');

    // 简单启发式规则
    if (/[?？]/.test(text)) return '刚刚在问问题或讨论某个疑问';
    if (/颜文字|表情|😊|😂|🤔/.test(text)) return '刚刚在玩表情/颜文字';
    if (/@/.test(text)) return '刚刚在反复 @ 你，像是在调戏';
    if (/(哈哈|笑死|草|ww)/.test(text)) return '氛围很轻松欢乐';

    return undefined;
  }
}
