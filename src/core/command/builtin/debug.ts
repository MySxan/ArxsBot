import { getLastPlanDebug, getLastReplyPlanDebug } from '../../planner/ChatPlanner.js';
import type { CommandHandler } from '../types.js';

/**
 * Debug command - show internal state and diagnostics
 */
export const DebugCommand: CommandHandler = {
  name: 'debug',
  aliases: ['状态', 'status'],
  description: '显示机器人内部状态',

  async run({ event, sender, router }) {
    const groupKey = `${event.platform}:${event.groupId}`;
    const lastPlan = getLastPlanDebug(groupKey);
    const conversationStore = (router as any)?.conversationStore;
    const memberStats = (router as any)?.memberStats;

    // Section 1: Last processed message user stats
    const userStatsSection = lastPlan
      ? (() => {
          const memberKey = memberStats?.buildMemberKey(
            lastPlan.event.platform,
            lastPlan.event.groupId,
            lastPlan.event.userId,
          );
          return {
            user: lastPlan.event.userName || lastPlan.event.userId,
            plan: {
              shouldReply: lastPlan.result.shouldReply,
              mode: lastPlan.result.mode,
              probability: lastPlan.result.meta?.replyProbability?.toFixed(2),
            },
            stats:
              memberKey && memberStats
                ? {
                    intimacy: memberStats.getIntimacy(memberKey).toFixed(2),
                    msgRate: memberStats.getUserMessageRate(memberKey).toFixed(2),
                    repetition: memberStats.getUserRepetitionScore(memberKey).toFixed(2),
                    botEnergy: lastPlan.result.meta?.botEnergy?.toFixed(2),
                    groupActivity: lastPlan.result.meta?.groupActivity?.toFixed(2),
                    baseInterest: lastPlan.result.meta?.baseInterest?.toFixed(2),
                    socialAttention: lastPlan.result.meta?.socialAttention?.toFixed(2),
                    talkativeness: lastPlan.result.meta?.personaTalkativeness?.toFixed(2),
                    spamType: lastPlan.result.meta?.spamType,
                    urgency: lastPlan.result.meta?.urgencyScore?.toFixed(2),
                  }
                : 'no stats',
            reason: lastPlan.result.debugReason,
          };
        })()
      : 'no plan yet';

    // Section 2: Recent 10 messages
    const history = conversationStore?.getRecentTurns(groupKey, 10) ?? [];
    const messagesSection = history
      .map((turn: { role: string; userName: any; userId: any; content: any }) => {
        const userId = turn.role === 'bot' ? 'bot' : turn.userName || turn.userId || 'unknown';
        return `${userId}: ${turn.content}`;
      })
      .join('\n');

    const output = `【上次处理】\n${JSON.stringify(userStatsSection, null, 2)}\n\n【最近消息】\n${messagesSection || 'no history'}`;

    await sender.sendText(event.groupId, output);
  },
};
