import type { ChatEvent } from '../events/ChatEvent.js';
import type { MessageSender } from '../messaging/MessageSender.js';
import type { Logger } from '../../infra/logger/logger.js';
import type { CommandRouter } from '../command/CommandRouter.js';
import type { LlmReplyGenerator } from '../chat/LlmReplyGenerator.js';
import type { ConversationStore } from '../memory/ConversationStore.js';
import type { MemberStatsStore } from '../memory/MemberStatsStore.js';
import { plan, recordReplyPlan, type PlanDebugInfo } from '../planner/ChatPlanner.js';
import { UtterancePlanner } from '../style/UtterancePlanner.js';
import { globalEnergyModel } from '../planner/EnergyModel.js';
import { PromptBuilder, type DynamicStyleParams } from '../style/PromptBuilder.js';
import { ContextBuilder } from '../context/ContextBuilder.js';

/**
 * Utility function for async sleep
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate typing delay based on character count and randomness
 * Formula: baseTime + (charCount * timePerChar) + randomFactor
 * Simulates human typing: ~50-100ms per character, plus random variation
 */
function calculateTypingDelay(text: string): number {
  const baseTime = 500; // 基础延迟（收到消息后等待时间）
  const timePerChar = 40; // 每个字符平均打字时间（ms）
  const randomFactor = Math.random() * 800; // 随机因素（0-800ms）
  const charCount = text.length;

  return baseTime + charCount * timePerChar + randomFactor;
}

/**
 * Main event router - handles all incoming chat events.
 * Flow: Event → Planner → Command/Chat handler → Response
 */
export class ConversationRouter {
  private logger: Logger;
  private sender: MessageSender;
  private commandRouter?: CommandRouter;
  private replyer?: LlmReplyGenerator;
  private conversationStore?: ConversationStore;
  private memberStats?: MemberStatsStore;
  private utterancePlanner: UtterancePlanner;
  private contextBuilder?: ContextBuilder;
  /** Stores the last used LLM prompts for /prompts command */
  public llmPromptHistory: string[] = [];

  constructor(
    logger: Logger,
    sender: MessageSender,
    commandRouter?: CommandRouter,
    replyer?: LlmReplyGenerator,
    conversationStore?: ConversationStore,
    memberStats?: MemberStatsStore,
  ) {
    this.logger = logger;
    this.sender = sender;
    this.commandRouter = commandRouter;
    this.replyer = replyer;
    this.conversationStore = conversationStore;
    this.memberStats = memberStats;
    this.utterancePlanner = new UtterancePlanner();

    // Initialize ContextBuilder if ConversationStore is available
    if (conversationStore) {
      this.contextBuilder = new ContextBuilder(conversationStore);
    }
  }

  /**
   * Handle incoming chat event.
   */
  async handleEvent(event: ChatEvent): Promise<void> {
    this.logger.debug(
      'router',
      `Received message from ${event.userId} in ${event.groupId}: "${event.rawText.substring(0, 30)}..."`,
    );

    const timestamp = event.timestamp ?? Date.now();
    const conversationKey = `${event.platform}:${event.groupId}`;

    // Layer A: Storage - ALWAYS record all messages for memory/context
    if (this.conversationStore) {
      if (event.fromBot) {
        // Store bot's own messages as assistant turns
        this.conversationStore.appendTurn(conversationKey, {
          role: 'bot',
          content: event.rawText,
          timestamp,
          userId: 'bot',
        });
        this.logger.debug('router', 'Stored bot self-message, skipping processing');
        return; // Don't process bot's own messages
      } else {
        // Store user messages with derived fields
        this.conversationStore.appendTurn(conversationKey, {
          role: 'user',
          content: event.rawText,
          timestamp,
          userId: event.userId,
          userName: event.userName,
          mentionsBot: event.mentionsBot,
          isCommand: event.rawText.startsWith('/'),
        });
      }
    }

    // Layer B: Processing filter - skip bot messages and update stats only for user messages

    if (this.memberStats) {
      this.memberStats.onUserMessage(
        event.platform,
        event.groupId,
        event.userId,
        timestamp,
        event.rawText,
        event.mentionsBot,
      );
    }

    // Layer C: Planner decision - decide whether to reply based on context/energy/rules
    const planResult = plan(event, this.memberStats);

    if (!planResult.shouldReply) {
      if (planResult.meta) {
        this.logger.debug(
          'router',
          `Ignoring message (mode: ${planResult.mode}) meta=${JSON.stringify(planResult.meta)}`,
        );
      } else {
        this.logger.debug('router', `Ignoring message (mode: ${planResult.mode})`);
      }
      return;
    }

    this.logger.debug(
      'router',
      `Handling message (mode: ${planResult.mode}, delay: ${planResult.delayMs}ms)`,
    );

    // Step 2: Apply thinking delay if needed
    if (planResult.delayMs > 0) {
      await sleep(planResult.delayMs);
    }

    // Step 3: Route based on mode
    try {
      switch (planResult.mode) {
        case 'command':
          if (this.commandRouter) {
            await this.commandRouter.handle(event);
          } else {
            this.logger.warn('router', 'Command router not configured');
            await this.sender.sendText(event.groupId, '指令系统未启用');
          }
          break;

        case 'smalltalk':
        case 'casual':
        case 'fragment':
        case 'directAnswer':
        case 'playfulTease':
        case 'passiveAcknowledge':
        case 'empathySupport':
        case 'deflect':
          if (this.replyer && this.conversationStore && this.contextBuilder) {
            // 新架构：三层分离
            // 1. 怎么选：ContextBuilder 智能选择上下文
            const replyContext = this.contextBuilder.buildForEvent(event);

            // 2. 组装参数：行为规划 → 动态风格参数
            const promptBuilder = new PromptBuilder();
            const currentPersona = this.replyer.getPersona();

            // 获取用户亲密度（用于动态参数）
            const memberKey = this.memberStats?.buildMemberKey(
              event.platform,
              event.groupId,
              event.userId,
            );
            const intimacy =
              memberKey && this.memberStats ? this.memberStats.getIntimacy(memberKey) : 0;
            const botEnergy = globalEnergyModel.getEnergy();

            // 动态生成风格参数（由 BehaviorPlanner 提供）
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

            // 3. 怎么喂：生成 System Prompt + LLM Messages
            // System Prompt 现在只包含：角色设定 + 固定约束
            const systemMsg = promptBuilder.buildSystem(currentPersona);

            // 构建完整的 LLM Messages（包含动态风格、记忆、上下文等）
            const llmMessages = promptBuilder.buildMessages(
              systemMsg,
              replyContext,
              dynamicStyle,
              undefined, // longTermMemory - 暂时为空，未来可接入
              event.userName || event.userId,
              event.rawText,
            );

            // 记录完整 prompt（用于 /prompts 指令查看）
            this.llmPromptHistory.push(
              llmMessages
                .map((m) => m.content) // 保留所有内容，只去掉 role 标签
                .join('\n\n'),
            );

            // 生成回复
            const replyText = await this.replyer.replyWithMessages(llmMessages);

            this.logger.info(
              'router',
              `Will send reply (mode: ${planResult.mode}) to ${event.userId}: "${replyText.substring(0, 40)}..."`,
            );

            // Record that we actually replied (for debug tracking)
            const groupKey = `${event.platform}:${event.groupId}`;
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

            // Step 3: Record bot reply in conversation history
            this.conversationStore.appendTurn(conversationKey, {
              role: 'bot',
              content: replyText,
              timestamp: Date.now(),
              userId: 'bot',
            });

            // Update member stats with a directed reply
            if (this.memberStats) {
              this.memberStats.onBotReply(event.platform, event.groupId, event.userId, Date.now());
            }

            // Step 4: Plan how to deliver the utterance
            const utterancePlan = this.utterancePlanner.makePlan(replyText, {
              persona: {
                verbosity: currentPersona.verbosity,
                multiUtterancePreference: currentPersona.multiUtterancePreference,
              },
              isAtReply: event.mentionsBot || false,
            });

            // Step 5: Calculate typing delay before sending
            const typingDelay = calculateTypingDelay(replyText);
            this.logger.debug(
              'router',
              `Typing delay: ${typingDelay.toFixed(0)}ms (${replyText.length} chars)`,
            );
            await sleep(typingDelay);

            // Step 6: Send segments with planned delays
            // 检查是否包含 <brk> 分隔符（多条消息）
            if (replyText.includes('<brk>')) {
              const segments = replyText
                .split('<brk>')
                .map((s) => s.trim())
                .filter((s) => s.length > 0);
              for (let i = 0; i < segments.length; i += 1) {
                if (i > 0) {
                  // 分条消息间隔 500~1200ms
                  await sleep(500 + Math.random() * 700);
                }
                await this.sender.sendText(event.groupId, segments[i]);
              }
            } else {
              // 单条消息：使用 utterancePlan 来处理分句
              for (const segment of utterancePlan.segments) {
                if (segment.delayMs > 0) {
                  await sleep(segment.delayMs);
                }
                await this.sender.sendText(event.groupId, segment.text);
              }
            }

            // Update bot energy after sending a reply
            globalEnergyModel.onReplySent();
          } else {
            // Fallback if LLM, conversation store, or context builder not configured
            this.logger.warn(
              'router',
              'Replyer, conversation store, or context builder not configured',
            );
            await this.sender.sendText(event.groupId, `收到:${event.rawText}`);
          }
          break;

        default:
          this.logger.warn('router', `Unhandled mode: ${planResult.mode}`);
      }
    } catch (error) {
      this.logger.error('router', `Failed to handle event: ${error}`);
    }
  }
}
