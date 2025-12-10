/**
 * @file ConversationRouter class for handling chat events and routing them to appropriate handlers.
 */
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
 * Sleep for a specified duration.
 * @param ms - The number of milliseconds to sleep.
 * @returns A promise that resolves after the specified duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate the typing delay for a given text.
 * @param text - The text to calculate the delay for.
 * @returns The calculated typing delay in milliseconds.
 */
function calculateTypingDelay(text: string): number {
  const baseTime = 500; // 基础延迟（收到消息后等待时间）
  const timePerChar = 40; // 每个字符平均打字时间
  const randomFactor = Math.random() * 800; // 随机因素
  const charCount = text.length;

  return baseTime + charCount * timePerChar + randomFactor;
}

/**
 * A class for routing chat events to appropriate handlers.
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
  public llmPromptHistory: string[] = [];

  /**
   * Create a new ConversationRouter instance.
   * @param logger - Logger instance for logging.
   * @param sender - MessageSender instance for sending messages.
   * @param commandRouter - CommandRouter instance for handling commands.
   * @param replyer - LlmReplyGenerator instance for generating replies.
   * @param conversationStore - ConversationStore instance for storing conversation history.
   * @param memberStats - MemberStatsStore instance for storing member statistics.
   */
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

    if (conversationStore) {
      this.contextBuilder = new ContextBuilder(conversationStore);
    }
  }

  /**
   * Handle incoming chat events.
   * @param event - The incoming chat event.
   * @returns A promise that resolves when the event is handled.
   */
  async handleEvent(event: ChatEvent): Promise<void> {
    this.logger.debug(
      'router',
      `Received message from ${event.userId} in ${event.groupId}: "${event.rawText.substring(0, 30)}..."`,
    );

    const timestamp = event.timestamp ?? Date.now();
    const conversationKey = `${event.platform}:${event.groupId}`;

    // 存储消息到 conversation store
    if (this.conversationStore) {
      if (event.fromBot) {
        // 存储 bot 自发消息
        this.conversationStore.appendTurn(conversationKey, {
          role: 'bot',
          content: event.rawText,
          timestamp,
          userId: 'bot',
        });
        this.logger.debug('router', 'Stored bot self-message, skipping processing');
        return;
      } else {
        // 存储用户消息
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

    // 跳过 bot 消息，仅更新用户消息的统计信息
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

    // planner 决定是否回复
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

    // 添加延迟
    if (planResult.delayMs > 0) {
      await sleep(planResult.delayMs);
    }

    // 根据模式路由
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
            // ContextBuilder 选择上下文
            const replyContext = this.contextBuilder.buildForEvent(event);

            // 行为规划 & 动态风格参数
            const promptBuilder = new PromptBuilder();
            const currentPersona = this.replyer.getPersona();

            // 获取用户亲密度
            const memberKey = this.memberStats?.buildMemberKey(
              event.platform,
              event.groupId,
              event.userId,
            );
            const intimacy =
              memberKey && this.memberStats ? this.memberStats.getIntimacy(memberKey) : 0;
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
              undefined, // longTermMemory 待接入
              event.userName || event.userId,
              event.rawText,
            );

            // 记录 prompt（用于 /prompts）
            this.llmPromptHistory.push(llmMessages.map((m) => m.content).join('\n\n'));

            // 生成回复
            const replyText = await this.replyer.replyWithMessages(llmMessages);

            this.logger.info(
              'router',
              `Will send reply (mode: ${planResult.mode}) to ${event.userId}: "${replyText.substring(0, 40)}..."`,
            );

            // 记录回复 (用于 debug)
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

            // 记录回复到 conversation store
            this.conversationStore.appendTurn(conversationKey, {
              role: 'bot',
              content: replyText,
              timestamp: Date.now(),
              userId: 'bot',
            });

            // 更新成员统计
            if (this.memberStats) {
              this.memberStats.onBotReply(event.platform, event.groupId, event.userId, Date.now());
            }

            // 规划分段发送
            const utterancePlan = this.utterancePlanner.makePlan(replyText, {
              persona: {
                verbosity: currentPersona.verbosity,
                multiUtterancePreference: currentPersona.multiUtterancePreference,
              },
              isAtReply: event.mentionsBot || false,
            });

            // 模拟输入延迟
            const typingDelay = calculateTypingDelay(replyText);
            this.logger.debug(
              'router',
              `Typing delay: ${typingDelay.toFixed(0)}ms (${replyText.length} chars)`,
            );
            await sleep(typingDelay);

            // 发送分段消息
            const hasBreakMarker = replyText.includes('<brk>');
            const hasNewlines = replyText.includes('\n');

            if (hasBreakMarker || hasNewlines) {
              // 处理 <brk>
              let segments: string[] = [];
              if (hasBreakMarker) {
                segments = replyText.split('<brk>');
              } else {
                segments = [replyText];
              }

              // 按换行符拆分
              const finalSegments = segments
                .flatMap((seg) => seg.split('\n'))
                .map((s) => s.trim())
                .filter((s) => s.length > 0)
                .slice(0, 3);

              this.logger.debug(
                'router',
                `Sending ${finalSegments.length} segments (${hasBreakMarker ? 'brk+' : ''}${hasNewlines ? 'newline' : ''})`,
              );

              for (let i = 0; i < finalSegments.length; i += 1) {
                if (i > 0) {
                  // 根据上一条消息长度动态计算间隔
                  const prevLength = finalSegments[i - 1].length;
                  const baseDelay = 500;
                  const charDelay = prevLength * 40; // 40ms per char
                  const randomDelay = Math.random() * 700;
                  const totalDelay = baseDelay + charDelay + randomDelay;
                  await sleep(Math.min(totalDelay, 3000)); // 最多3秒
                }
                await this.sender.sendText(event.groupId, finalSegments[i]);
              }
            } else {
              // 单条消息使用 utterancePlan 处理分句
              for (const segment of utterancePlan.segments) {
                if (segment.delayMs > 0) {
                  await sleep(segment.delayMs);
                }
                await this.sender.sendText(event.groupId, segment.text);
              }
            }

            // 更新能量
            globalEnergyModel.onReplySent();
          } else {
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
