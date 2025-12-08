import type { CommandHandler } from '../types.js';
import type { ConversationStore } from '../../memory/ConversationStore.js';
import type { MemberStatsStore } from '../../memory/MemberStatsStore.js';

/**
 * Context command - show conversation history and member stats
 */
export const ContextCommand: CommandHandler = {
  name: 'context',
  aliases: ['上下文', 'history'],
  description: '显示当前群的对话历史和成员统计',

  async run({ event, sender, router }) {
    const conversationStore = (router as any).conversationStore as ConversationStore | undefined;
    const memberStats = (router as any).memberStats as MemberStatsStore | undefined;

    const conversationKey = `${event.platform}:${event.groupId}`;
    const memberKey = memberStats?.buildMemberKey(event.platform, event.groupId, event.userId);

    // Get conversation history
    const history = conversationStore?.getRecentTurns(conversationKey, 50) ?? [];
    const historySection =
      history.length > 0
        ? history.map((turn, idx) => ({
            index: idx + 1,
            role: turn.role,
            userId: turn.userId,
            userName: turn.userName,
            content: turn.content,
            timestamp: new Date(turn.timestamp).toISOString(),
          }))
        : 'no conversation history';

    // Get member stats
    const memberStatsSection =
      memberKey && memberStats
        ? {
            intimacy: memberStats.getIntimacy(memberKey),
            userMessageRate: memberStats.getUserMessageRate(memberKey),
            userRepetitionScore: memberStats.getUserRepetitionScore(memberKey),
          }
        : 'no member stats available';

    // Get group stats
    const groupKey = memberStats?.buildGroupKey(event.platform, event.groupId);
    const groupMemeScore =
      groupKey && memberStats ? memberStats.getGroupMemeScore(groupKey, event.rawText) : 0;

    const payload = {
      conversationKey,
      memberKey: memberKey || 'n/a',
      history: historySection,
      memberStats: memberStatsSection,
      groupMemeScore,
    };

    await sender.sendText(event.groupId, '```json\n' + JSON.stringify(payload, null, 2) + '\n```');
  },
};
