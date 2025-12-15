import type { ChatEvent } from '../../../events/ChatEvent.js';
import type { Logger } from '../../../../infra/logger/logger.js';
import type { MemberStatsStore } from '../../../memory/MemberStatsStore.js';
import type { ConversationStore } from '../../../memory/ConversationStore.js';
import type { LlmReplyGenerator } from '../../../chat/LlmReplyGenerator.js';
import { plan, recordReplyPlan, type PlanDebugInfo } from '../../../planner/ChatPlanner.js';
import { globalEnergyModel } from '../../../planner/EnergyModel.js';
import { PromptBuilder, type DynamicStyleParams } from '../../../style/PromptBuilder.js';
import { ContextBuilder } from '../../../context/ContextBuilder.js';
import type { PlanResult } from '../../../planner/types.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type ReplyResult =
  | { type: 'skip'; reason: string }
  | {
      type: 'reply';
      planMode: string;
      replyText: string;
      planResult: PlanResult;
      persona: { verbosity: number; multiUtterancePreference: number };
      isAtReply: boolean;
    };

export class ReplyPipeline {
  constructor(
    private readonly deps: {
      logger: Logger;
      replyer?: LlmReplyGenerator;
      conversationStore?: ConversationStore;
      memberStats?: MemberStatsStore;
      contextBuilder?: ContextBuilder;
      llmPromptHistory?: string[];
    },
  ) {}

  async run(event: ChatEvent): Promise<ReplyResult> {
    if (!this.deps.replyer || !this.deps.conversationStore || !this.deps.contextBuilder) {
      return { type: 'skip', reason: 'not-configured' };
    }

    const planResult = plan(event, this.deps.memberStats);

    if (!planResult.shouldReply) {
      const reason =
        typeof planResult.meta?.reason === 'string'
          ? planResult.meta.reason
          : planResult.meta
            ? JSON.stringify(planResult.meta)
            : 'skip';
      return { type: 'skip', reason };
    }

    // Command mode should be handled outside this pipeline
    if (planResult.mode === 'command') {
      return { type: 'skip', reason: 'command' };
    }

    this.deps.logger.debug(
      'router',
      `Handling message (mode: ${planResult.mode}, delay: ${planResult.delayMs}ms)`,
    );

    if (planResult.delayMs > 0) {
      await sleep(planResult.delayMs);
    }

    // ContextBuilder 选择上下文
    const replyContext = this.deps.contextBuilder.buildForEvent(event);

    // 行为规划 & 动态风格参数
    const promptBuilder = new PromptBuilder();
    const currentPersona = this.deps.replyer.getPersona();

    // 获取用户亲密度
    const memberKey = this.deps.memberStats?.buildMemberKey(
      event.platform,
      event.groupId,
      event.userId,
    );
    const intimacy =
      memberKey && this.deps.memberStats ? this.deps.memberStats.getIntimacy(memberKey) : 0;
    const botEnergy = globalEnergyModel.getEnergy();

    // 生成风格参数（BehaviorPlanner）
    const dynamicStyle: DynamicStyleParams = (() => {
      switch (planResult.mode) {
        case 'casual':
          return {
            toneMod: intimacy > 0.7 ? 'teasing' : 'casual',
            maxLength: 15,
            slangLevel: 0.7,
            intimacyLevel: intimacy,
            energyLevel: botEnergy,
          };
        case 'fragment':
          return {
            toneMod: 'lazy',
            maxLength: 8,
            slangLevel: 0.5,
            intimacyLevel: intimacy,
            energyLevel: botEnergy,
          };
        case 'directAnswer':
          return {
            toneMod: 'serious',
            maxLength: 20,
            slangLevel: 0.2,
          };
        case 'passiveAcknowledge':
          return {
            toneMod: 'lazy',
            maxLength: 6,
            slangLevel: 0.3,
          };
        case 'playfulTease':
          return {
            toneMod: 'teasing',
            maxLength: 15,
            slangLevel: 0.8,
            intimacyLevel: intimacy,
          };
        case 'empathySupport':
          return {
            toneMod: 'serious',
            maxLength: 20,
            slangLevel: 0.3,
          };
        case 'deflect':
          return {
            toneMod: botEnergy < 0.3 ? 'cold' : 'lazy',
            maxLength: 10,
            slangLevel: 0.4,
          };
        case 'smalltalk':
        default:
          return {
            maxLength: 12,
            slangLevel: 0.5,
            intimacyLevel: intimacy,
            energyLevel: botEnergy,
          };
      }
    })();

    // 构建 System Prompt
    const systemMsg = promptBuilder.buildSystem(currentPersona);

    // 构建 LLM Messages
    const llmMessages = promptBuilder.buildMessages(
      systemMsg,
      replyContext,
      dynamicStyle,
      undefined,
      event.userName || event.userId,
      event.rawText,
    );

    // 记录 prompt（用于 /prompts）
    this.deps.llmPromptHistory?.push(
      llmMessages.map((m: { content: string }) => m.content).join('\n\n'),
    );

    // 生成回复
    const replyText = await this.deps.replyer.replyWithMessages(llmMessages);

    this.deps.logger.info(
      'router',
      `Generated reply (mode: ${planResult.mode}) for ${event.userId}: "${replyText.substring(0, 40)}..."`,
    );

    return {
      type: 'reply',
      planMode: planResult.mode,
      replyText,
      planResult,
      persona: {
        verbosity: currentPersona.verbosity ?? 0.5,
        multiUtterancePreference: currentPersona.multiUtterancePreference ?? 0.3,
      },
      isAtReply: Boolean(event.mentionsBot),
    };
  }

  commitReply(event: ChatEvent, planResult: PlanResult, replyText: string): void {
    if (!this.deps.conversationStore) {
      return;
    }

    const groupKey = `${event.platform}:${event.groupId}`;
    const conversationKey = `${event.platform}:${event.groupId}`;

    // 记录回复 (用于 debug)
    const replyPlanInfo: PlanDebugInfo = {
      event: {
        platform: event.platform,
        groupId: event.groupId,
        userId: event.userId,
        userName: event.userName,
        rawText: event.rawText,
        timestamp: event.timestamp,
        mentionsBot: event.mentionsBot,
      },
      result: planResult,
      timestamp: Date.now(),
    };
    recordReplyPlan(groupKey, replyPlanInfo);

    // 记录回复到 conversation store
    this.deps.conversationStore.appendTurn(conversationKey, {
      role: 'bot',
      content: replyText,
      timestamp: Date.now(),
      userId: 'bot',
    });

    // 更新成员统计
    if (this.deps.memberStats) {
      this.deps.memberStats.onBotReply(event.platform, event.groupId, event.userId, Date.now());
    }

    // 更新能量
    globalEnergyModel.onReplySent();
  }
}
