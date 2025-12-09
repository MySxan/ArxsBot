import type { ChatEvent } from '../events/ChatEvent.js';
import type { PlanResult, ReplyMode } from './types.js';
import type { MemberStatsStore } from '../memory/MemberStatsStore.js';
import { SpamType } from '../memory/MemberStatsStore.js';
import { globalEnergyModel } from './EnergyModel.js';
import { getGroupActivity, recordGroupMessage } from './GroupActivityTracker.js';

export interface PlanDebugInfo {
  event: Pick<
    ChatEvent,
    'platform' | 'groupId' | 'userId' | 'userName' | 'rawText' | 'timestamp' | 'mentionsBot'
  >;
  result: PlanResult;
  timestamp: number;
}

const planDebugHistory = new Map<string, PlanDebugInfo>();
const replyPlanHistory = new Map<string, PlanDebugInfo>();

export function getLastPlanDebug(groupKey: string): PlanDebugInfo | null {
  return planDebugHistory.get(groupKey) ?? null;
}

export function getLastReplyPlanDebug(groupKey: string): PlanDebugInfo | null {
  return replyPlanHistory.get(groupKey) ?? null;
}

export function recordReplyPlan(groupKey: string, info: PlanDebugInfo): void {
  replyPlanHistory.set(groupKey, info);
}

/**
 * Planner that decides whether and how to respond to messages.
 *
 * Rules (hard + soft):
 * 1) Commands → 100% reply
 * 2) @ 机器人 → 100% reply (smalltalk)
 * 3) 普通消息 → 掷骰子决定，概率受：energy / 群活跃度 / 兴趣度 影响
 */
export function plan(event: ChatEvent, memberStats?: MemberStatsStore): PlanResult {
  const text = event.rawText.trim();
  const groupKey = `${event.platform}:${event.groupId}`;
  const memberKey = memberStats?.buildMemberKey(event.platform, event.groupId, event.userId);

  // Record activity for this group (skip bot's own messages to avoid stat pollution)
  if (!event.fromBot) {
    recordGroupMessage(groupKey, event.timestamp ?? Date.now());
  }

  // 1. Command mode: starts with / or ！
  if (text.startsWith('/') || text.startsWith('！')) {
    // Don't store debug info for commands to avoid overwriting with /debug itself
    return {
      shouldReply: true,
      mode: 'command',
      delayMs: 0, // Commands execute immediately
      meta: { reason: 'command' },
    };
  }

  // 2. Bot is mentioned: engage in conversation (hard rule)
  if (event.mentionsBot) {
    return {
      shouldReply: true,
      mode: 'smalltalk',
      delayMs: 600,
      meta: {
        reason: 'mention',
        socialAttention: 1.0,
        baseInterest: calculateBaseInterest(text),
      },
    };
  }

  // 3. Layered probability model for normal messages
  const botEnergy = globalEnergyModel.getEnergy();
  const { activity: groupActivity, messagesInWindow } = getGroupActivity(groupKey);

  const intimacy = memberKey && memberStats ? memberStats.getIntimacy(memberKey) : 0;
  const userMessageRate = memberKey && memberStats ? memberStats.getUserMessageRate(memberKey) : 0;
  const userRepetitionScore =
    memberKey && memberStats ? memberStats.getUserRepetitionScore(memberKey) : 0;
  const groupMemeScore = memberStats ? memberStats.getGroupMemeScore(groupKey, text) : 0;

  // Classify spam type instead of simple rate check
  const spamType =
    memberKey && memberStats ? memberStats.classifySpamType(memberKey, text) : SpamType.NORMAL;
  const urgencyScore =
    memberKey && memberStats ? memberStats.getUrgencyScore(memberKey, spamType) : 0;

  // Layer 1: Base interest from content (30% weight)
  const baseInterest = calculateBaseInterest(text);

  // Layer 2: Social attention - user expectation (40% weight)
  // Combines intimacy with implicit mentions (e.g., "bot你觉得呢")
  const socialAttention = clamp01(0.6 * intimacy + 0.4 * (event.mentionsBot ? 1 : 0));

  // Layer 3: Persona talkativeness (20% weight) - from persona config
  // TODO: get from persona.talkativeness, default 0.5
  const personaTalkativeness = 0.5;

  // Layer 4: Bot energy (10% weight)
  const energyFactor = botEnergy;

  // Combined probability
  let p =
    0.3 * baseInterest + 0.4 * socialAttention + 0.2 * personaTalkativeness + 0.1 * energyFactor;

  // Negative modifiers (spam/noise dampening)
  if (groupActivity > 0.8) {
    p *= 0.5; // very noisy group → cut probability in half
  }

  // Spam type modifiers (replace simple userMessageRate penalty)
  switch (spamType) {
    case SpamType.HELP_SEEKING:
      p *= 1.3; // User is urgently seeking help → increase priority
      if (urgencyScore > 0.65) {
        p = Math.max(p, 0.7); // High urgency → ensure response even if cold persona
      }
      break;
    case SpamType.MEME_PLAY:
      p *= 0.8; // User playing memes → optional response
      break;
    case SpamType.NOISE:
      p *= 0.4; // Meaningless spam → suppress heavily
      break;
    case SpamType.NORMAL:
      // No modifier for normal messaging
      break;
  }

  // Only apply repetition penalty for meaningless repetition
  if (userRepetitionScore > 0.5 && spamType !== SpamType.HELP_SEEKING) {
    p *= 0.7; // user repeating themselves (non-urgent) → reduce engagement
  }

  // Positive modifiers
  if (groupMemeScore > 0.4) {
    p += 0.1; // group meme in progress → join in
  }

  p = clamp01(p);

  const shouldReply = Math.random() < p;

  if (!shouldReply) {
    const result: PlanResult = {
      shouldReply: false,
      mode: 'ignore',
      delayMs: 0,
      meta: {
        replyProbability: p,
        botEnergy,
        groupActivity,
        messagesInWindow,
        intimacy,
        userMessageRate,
        userRepetitionScore,
        groupMemeScore,
        baseInterest,
        socialAttention,
        personaTalkativeness,
        interestScore: baseInterest, // legacy compatibility
        spamType,
        urgencyScore,
        reason: 'dice',
      },
      debugReason: buildDebugReason(false, {
        intimacy,
        userMessageRate,
        userRepetitionScore,
        groupMemeScore,
        groupActivity,
        interestScore: baseInterest,
        botEnergy,
        baseInterest,
        socialAttention,
        spamType,
        urgencyScore,
      }),
    };

    planDebugHistory.set(groupKey, {
      event: {
        platform: event.platform,
        groupId: event.groupId,
        userId: event.userId,
        userName: event.userName,
        rawText: event.rawText,
        timestamp: event.timestamp,
        mentionsBot: event.mentionsBot,
      },
      result,
      timestamp: Date.now(),
    });

    return result;
  }

  // Select reply mode (更人性化：优先使用 casual/fragment)
  let replyMode: ReplyMode = 'smalltalk';
  if (spamType === SpamType.HELP_SEEKING && urgencyScore > 0.7) {
    replyMode = 'directAnswer'; // 高紧急度才直接回答
  } else if (intimacy < 0.3) {
    // 陌生人：50% fragment（冷淡/随意），30% passiveAcknowledge，20% casual
    const r = Math.random();
    if (r < 0.5) replyMode = 'fragment';
    else if (r < 0.8) replyMode = 'passiveAcknowledge';
    else replyMode = 'casual';
  } else if (intimacy > 0.7 && Math.random() < 0.25) {
    replyMode = 'playfulTease'; // 高亲密度25%调戏
  } else {
    // 正常亲密度：70% casual（口语化），20% fragment（偶尔跳跃），10% smalltalk
    const r = Math.random();
    if (r < 0.7) replyMode = 'casual';
    else if (r < 0.9) replyMode = 'fragment';
    else replyMode = 'smalltalk';
  }

  const result: PlanResult = {
    shouldReply: true,
    mode: replyMode,
    delayMs: 500 + Math.floor(Math.random() * 300), // 0.5~0.8s thinking
    meta: {
      replyProbability: p,
      botEnergy,
      groupActivity,
      messagesInWindow,
      intimacy,
      userMessageRate,
      userRepetitionScore,
      groupMemeScore,
      baseInterest,
      socialAttention,
      personaTalkativeness,
      interestScore: baseInterest,
      spamType,
      urgencyScore,
      reason: 'soft-rule',
    },
    debugReason: buildDebugReason(true, {
      intimacy,
      userMessageRate,
      userRepetitionScore,
      groupMemeScore,
      groupActivity,
      interestScore: baseInterest,
      botEnergy,
      baseInterest,
      socialAttention,
      spamType,
      urgencyScore,
    }),
  };

  planDebugHistory.set(groupKey, {
    event: {
      platform: event.platform,
      groupId: event.groupId,
      userId: event.userId,
      userName: event.userName,
      rawText: event.rawText,
      timestamp: event.timestamp,
      mentionsBot: event.mentionsBot,
    },
    result,
    timestamp: Date.now(),
  });

  return result;
}

/** Calculate base interest from content (length, questions, topics) */
function calculateBaseInterest(text: string): number {
  // Random "lurking" - 10% chance to just not feel like talking
  if (Math.random() < 0.1) {
    return 0.05; // 潜水状态
  }

  let score = 0;

  // Questions are inherently more engaging (但降低权重)
  if (/[?？]/u.test(text)) score += 0.25; // 降低：0.35 → 0.25

  // Help-seeking language
  if (/帮忙|怎么|如何|为啥|为什么|请教|求助|能不能|可以吗/.test(text)) score += 0.25; // 降低：0.3 → 0.25

  // Length indicates substance (normalized, 降低权重)
  const lengthScore = Math.min(text.length / 100, 0.2); // 降低：0.3 → 0.2
  score += lengthScore;

  // Topic keywords (降低权重)
  if (/问题|想法|建议|计划|讨论/.test(text)) score += 0.1; // 降低：0.15 → 0.1

  return clamp01(score);
}

/** Legacy interest score for backward compatibility */
function estimateInterestScore(text: string): number {
  return calculateBaseInterest(text);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function buildDebugReason(
  shouldReply: boolean,
  factors: {
    intimacy: number;
    userMessageRate: number;
    userRepetitionScore: number;
    groupMemeScore: number;
    groupActivity: number;
    interestScore: number;
    botEnergy: number;
    baseInterest?: number;
    socialAttention?: number;
    spamType?: SpamType;
    urgencyScore?: number;
  },
): string {
  const parts: string[] = [];

  // Positive factors
  if ((factors.baseInterest ?? factors.interestScore) > 0.4) parts.push('high_interest');
  if ((factors.socialAttention ?? factors.intimacy) > 0.6) parts.push('high_attention');
  if (factors.groupMemeScore > 0.4) parts.push('group_meme');
  if (factors.urgencyScore && factors.urgencyScore > 0.65) parts.push('urgent_help');

  // Spam type indicators
  if (factors.spamType === SpamType.HELP_SEEKING) parts.push('help_seeking');
  if (factors.spamType === SpamType.MEME_PLAY) parts.push('meme_play');
  if (factors.spamType === SpamType.NOISE) parts.push('noise_spam');

  // Negative factors
  if (factors.botEnergy < 0.3) parts.push('low_energy');
  if (factors.groupActivity > 0.8) parts.push('group_noisy');
  if (factors.userMessageRate > 0.7 && factors.spamType === SpamType.NOISE)
    parts.push('user_spammy');
  if (factors.userRepetitionScore > 0.5 && factors.spamType !== SpamType.HELP_SEEKING)
    parts.push('user_repetition');

  const tag = shouldReply ? 'reply' : 'ignore';
  return `${tag}:${parts.join(',') || 'neutral'}`;
}
