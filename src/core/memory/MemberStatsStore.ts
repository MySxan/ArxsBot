/**
 * Tracks per-member interaction stats within a group to support intimacy and repetition heuristics.
 */
export interface MemberStats {
  totalMessagesFromUser: number;
  totalRepliesFromBot: number;
  totalMentionsBot: number;
  lastActiveAt: number;
  lastRepliedAt?: number;
  firstSeenAt: number;
  recentMessages: Array<{ text: string; timestamp: number }>;
}

/**
 * Types of rapid messaging behavior
 */
export enum SpamType {
  HELP_SEEKING = 'help_seeking', // Urgent questions/requests → increase probability
  MEME_PLAY = 'meme_play', // Fun repetition/memes → playful response
  NOISE = 'noise', // Meaningless spam → suppress
  NORMAL = 'normal', // Not spamming
}

const RATE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const REPETITION_WINDOW_MS = 2 * 60 * 1000; // 2 minutes
const MAX_RECENT_MESSAGES = 30;
const MAX_GROUP_MESSAGES = 60;

import { config } from '../../infra/config/config.js';
import { createLogger } from '../../infra/logger/logger.js';

const logger = createLogger(config);

export class MemberStatsStore {
  private members = new Map<string, MemberStats>();
  private groupMessages = new Map<
    string,
    Array<{ text: string; userId: string; timestamp: number }>
  >();

  onUserMessage(
    platform: string,
    groupId: string,
    userId: string,
    timestamp: number,
    text: string,
    mentionsBot: boolean = false,
  ): void {
    const memberKey = this.buildMemberKey(platform, groupId, userId);
    const stats = this.members.get(memberKey) ?? {
      totalMessagesFromUser: 0,
      totalRepliesFromBot: 0,
      totalMentionsBot: 0,
      lastActiveAt: timestamp,
      firstSeenAt: timestamp,
      recentMessages: [],
    };

    stats.totalMessagesFromUser += 1;
    if (mentionsBot) stats.totalMentionsBot += 1;
    stats.lastActiveAt = timestamp;
    stats.recentMessages.push({ text, timestamp });
    if (stats.recentMessages.length > MAX_RECENT_MESSAGES) {
      stats.recentMessages.splice(0, stats.recentMessages.length - MAX_RECENT_MESSAGES);
    }
    this.members.set(memberKey, stats);

    // Track group-level text occurrences for meme detection
    const groupKey = this.buildGroupKey(platform, groupId);
    const groupArr = this.groupMessages.get(groupKey) ?? [];
    groupArr.push({ text, userId, timestamp });
    if (groupArr.length > MAX_GROUP_MESSAGES) {
      groupArr.splice(0, groupArr.length - MAX_GROUP_MESSAGES);
    }
    this.groupMessages.set(groupKey, groupArr);
  }

  onBotReply(platform: string, groupId: string, userId: string, timestamp: number): void {
    const memberKey = this.buildMemberKey(platform, groupId, userId);
    const stats = this.members.get(memberKey);
    if (!stats) return;
    stats.totalRepliesFromBot += 1;
    stats.lastRepliedAt = timestamp;
    this.members.set(memberKey, stats);
  }

  getIntimacy(memberKey: string, now: number = Date.now()): number {
    const stats = this.members.get(memberKey);
    if (!stats) return 0;

    const replyRatio = stats.totalRepliesFromBot / Math.max(1, stats.totalMessagesFromUser);
    const mentionRatio = stats.totalMentionsBot / Math.max(1, stats.totalMessagesFromUser);
    const tenureDays = (now - stats.firstSeenAt) / 86_400_000; // ms in a day
    const tenureScore = clamp01(tenureDays / 14); // full score after ~2 weeks

    const intimacy =
      0.15 + 0.4 * clamp01(replyRatio) + 0.2 * clamp01(mentionRatio) + 0.25 * tenureScore;
    return clamp01(intimacy);
  }

  getUserMessageRate(memberKey: string, now: number = Date.now()): number {
    const stats = this.members.get(memberKey);
    if (!stats) return 0;
    const cutoff = now - RATE_WINDOW_MS;
    const count = stats.recentMessages.filter((m) => m.timestamp >= cutoff).length;
    const messagesPerMinute = count / (RATE_WINDOW_MS / 60000);
    // Normalize: assume 10 msgs/min as "very active"
    return clamp01(messagesPerMinute / 10);
  }

  getUserRepetitionScore(memberKey: string, now: number = Date.now()): number {
    const stats = this.members.get(memberKey);
    if (!stats) return 0;
    const cutoff = now - REPETITION_WINDOW_MS;
    const relevant = stats.recentMessages.filter((m) => m.timestamp >= cutoff);
    if (relevant.length <= 1) return 0;

    const counter = new Map<string, number>();
    for (const m of relevant) {
      const key = normalizeText(m.text);
      if (!key) continue;
      counter.set(key, (counter.get(key) ?? 0) + 1);
    }

    let maxCount = 0;
    counter.forEach((v) => {
      if (v > maxCount) maxCount = v;
    });

    if (maxCount <= 1) return 0;
    // 2 repeats -> ~0.33, 3 repeats -> ~0.66, 4+ -> 1
    return clamp01((maxCount - 1) / 3);
  }

  getGroupMemeScore(groupKey: string, text: string, now: number = Date.now()): number {
    const arr = this.groupMessages.get(groupKey);
    if (!arr || arr.length === 0) return 0;
    const cutoff = now - REPETITION_WINDOW_MS;
    const target = normalizeText(text);
    if (!target) return 0;

    const distinctUsers = new Set<string>();
    for (const m of arr) {
      if (m.timestamp < cutoff) continue;
      if (normalizeText(m.text) === target) {
        distinctUsers.add(m.userId);
      }
    }

    if (distinctUsers.size <= 1) return 0;
    // 2 users -> 0.25, 3 -> 0.5, 5 -> 1
    return clamp01((distinctUsers.size - 1) / 4);
  }

  buildMemberKey(platform: string, groupId: string, userId: string): string {
    return `${platform}:${groupId}:${userId}`;
  }

  buildGroupKey(platform: string, groupId: string): string {
    return `${platform}:${groupId}`;
  }

  /**
   * Classify the type of rapid messaging behavior
   */
  classifySpamType(memberKey: string, currentText: string, now: number = Date.now()): SpamType {
    const stats = this.members.get(memberKey);
    if (!stats) return SpamType.NORMAL;

    const cutoff = now - REPETITION_WINDOW_MS;
    const recentMsgs = stats.recentMessages.filter((m) => m.timestamp >= cutoff);

    // Not spamming if < 3 messages in 2 minutes
    if (recentMsgs.length < 3) return SpamType.NORMAL;

    const normalized = normalizeText(currentText);

    // Check for NOISE spam (highest priority)
    const noiseScore = this.calculateNoiseScore(currentText, recentMsgs);
    if (noiseScore > 0.6) return SpamType.NOISE;

    // Check for HELP_SEEKING spam
    const helpScore = this.calculateHelpSeekingScore(currentText, recentMsgs);
    if (helpScore > 0.5) return SpamType.HELP_SEEKING;

    // Check for MEME_PLAY spam
    const memeScore = this.calculateMemePlayScore(currentText, recentMsgs);
    if (memeScore > 0.5) return SpamType.MEME_PLAY;

    return SpamType.NORMAL;
  }

  private calculateNoiseScore(
    text: string,
    recentMsgs: Array<{ text: string; timestamp: number }>,
  ): number {
    let score = 0;

    // Very short messages with no meaning
    if (text.length < 3) score += 0.4;

    // Single punctuation or character repetition
    if (/^[.?!。？！]+$/.test(text) || /^(.)\1+$/.test(text)) score += 0.5;

    // Random characters or single emoji spam
    if (/^[a-z]{1,2}$/i.test(text) || /^[\ud83c-\udbff\udc00-\udfff]+$/.test(text)) score += 0.3;

    // All recent messages are also short
    const avgLength = recentMsgs.reduce((sum, m) => sum + m.text.length, 0) / recentMsgs.length;
    if (avgLength < 5) score += 0.2;

    return clamp01(score);
  }

  private calculateHelpSeekingScore(
    text: string,
    recentMsgs: Array<{ text: string; timestamp: number }>,
  ): number {
    let score = 0;

    // Contains question marks or question words
    if (/[?？]/.test(text)) score += 0.3;
    if (/怎么|为什么|为啥|如何|能不能|可以吗|帮|求|急/.test(text)) score += 0.35;

    // Has meaningful length (≥4 chars and semantic)
    if (text.length >= 4 && !/^[.?!。？！]+$/.test(text)) score += 0.2;

    // Repeated similar questions in recent messages
    const questionCount = recentMsgs.filter(
      (m) => /[?？]/.test(m.text) || /怎么|为什么|帮|求/.test(m.text),
    ).length;
    if (questionCount >= 2) score += 0.25;

    // Same question repeated
    const normalizedText = normalizeText(text);
    const sameQuestionRepeats = recentMsgs.filter(
      (m) => normalizeText(m.text) === normalizedText,
    ).length;
    if (sameQuestionRepeats >= 2 && text.length >= 5) score += 0.3;

    return clamp01(score);
  }

  private calculateMemePlayScore(
    text: string,
    recentMsgs: Array<{ text: string; timestamp: number }>,
  ): number {
    let score = 0;

    // Short phrases or single words being repeated
    if (text.length <= 6 && text.length >= 2) score += 0.3;

    // Common meme patterns
    if (/^(哈|笑|草|艹|hhh|aww|awa|6{2,}|nb|绝|强|牛)/i.test(text)) score += 0.4;

    // Emoji or emoticon heavy
    if (/[\ud83c-\udbff][\udc00-\udfff]|[\ud83d][\ude00-\ude4f]/.test(text)) score += 0.2;

    // Many recent messages are similar short phrases
    const shortMsgCount = recentMsgs.filter((m) => m.text.length <= 6).length;
    if (shortMsgCount >= 3) score += 0.25;

    return clamp01(score);
  }

  /**
   * Calculate urgency score for help-seeking behavior
   */
  getUrgencyScore(memberKey: string, spamType: SpamType, now: number = Date.now()): number {
    const stats = this.members.get(memberKey);
    if (!stats) return 0;

    // Only help-seeking spam indicates urgency
    if (spamType !== SpamType.HELP_SEEKING) return 0;

    const cutoff = now - REPETITION_WINDOW_MS;
    const recentMsgs = stats.recentMessages.filter((m) => m.timestamp >= cutoff);

    // Help-seeking intensity (how much they're repeating)
    const helpIntensity = Math.min(recentMsgs.length / 5, 1); // 5+ msgs = max intensity

    // Intimacy factor
    const intimacy = this.getIntimacy(memberKey, now);

    // Historical help ratio (how often bot helped before)
    const helpRatio =
      stats.totalRepliesFromBot > 0 ? stats.totalRepliesFromBot / stats.totalMessagesFromUser : 0.2;

    const urgency = 0.6 * helpIntensity + 0.2 * intimacy + 0.2 * clamp01(helpRatio);
    return clamp01(urgency);
  }
}

export const globalMemberStats = new MemberStatsStore();

function normalizeText(text: string): string {
  return text.trim().toLowerCase();
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
