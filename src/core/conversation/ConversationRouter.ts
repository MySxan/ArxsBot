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
import { ContextBuilder } from '../context/ContextBuilder.js';
import { MessageDebouncer, type DebounceSnapshot } from './MessageDebouncer.js';
import { EventPreprocessor } from './router/preprocess/EventPreprocessor.js';
import { EventClassifier } from './router/preprocess/EventClassifier.js';
import { ReplyPipeline } from './router/pipeline/ReplyPipeline.js';
import { SendPipeline } from './router/pipeline/SendPipeline.js';
import { SessionStateStore } from './router/session/SessionStateStore.js';
import { TypingInterruption } from './router/session/TypingInterruption.js';

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
  private contextBuilder?: ContextBuilder;
  private debouncer: MessageDebouncer;
  private preprocessor: EventPreprocessor;
  private classifier: EventClassifier;
  private sessionStore: SessionStateStore;
  private typingInterruption: TypingInterruption;
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
    this.debouncer = new MessageDebouncer(logger, 5000); // 5s debounce for regular messages
    this.preprocessor = new EventPreprocessor({
      logger: this.logger,
      conversationStore: this.conversationStore,
      memberStats: this.memberStats,
    });
    this.classifier = new EventClassifier();
    this.sessionStore = new SessionStateStore();
    this.typingInterruption = new TypingInterruption({
      sessionStore: this.sessionStore,
      logger: this.logger,
      cancelThreshold: 3,
    });

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
    // Ensure local ingest time is present (adapters may backfill history quickly).
    if (event.ingestTime === undefined) {
      event.ingestTime = Date.now();
    }

    const preprocess = this.preprocessor.run(event);
    if (!preprocess.shouldContinue) {
      return;
    }

    // Session-level typing interruption
    const sessionKey = `${event.platform}:${event.groupId}`;

    // Track global message order within this group (covers other users' interleaving)
    const seq = this.sessionStore.nextMessageSeq(sessionKey);
    (event as any).__seq = seq;

    this.typingInterruption.onIncomingUserMessage(sessionKey, event);

    // 检查是否为命令或@机器人 - 这些不使用防抖，立即处理
    const { isCommand, isMention } = this.classifier.classify(event);

    if (isCommand || isMention) {
      // 命令和@消息立即处理，不使用防抖
      await this.sessionStore.runQueued(sessionKey, async () => {
        await this.processEvent(event);
      });
    } else {
      // 普通消息使用防抖机制：等待5秒检查是否有同一人的新消息
      this.debouncer.debounce(event, async (snapshot) => {
        const groupSessionKey = `${snapshot.lastEvent.platform}:${snapshot.lastEvent.groupId}`;
        await this.sessionStore.runQueued(groupSessionKey, async () => {
          await this.handleDebouncedInternal(snapshot);
        });
      });
    }
  }

  private async handleDebouncedInternal(snapshot: DebounceSnapshot): Promise<void> {
    const sessionKey = `${snapshot.lastEvent.platform}:${snapshot.lastEvent.groupId}`;
    const session = this.sessionStore.get(sessionKey);

    const mergedText = this.buildMergedText(snapshot.events, 6);

    const targetEvent =
      snapshot.count >= 3 ? this.pickQuoteTarget(snapshot.events) : snapshot.lastEvent;
    const mergedEvent: ChatEvent = { ...snapshot.lastEvent, rawText: mergedText };
    (mergedEvent as any).__debounce = {
      count: snapshot.count,
      firstAt: snapshot.firstAt,
      lastAt: snapshot.lastAt,
    };

    (mergedEvent as any).__targetText = targetEvent.rawText;

    // Always carry a quote target candidate; SendPipeline will decide whether to reply-to
    // based on the message-gap rule (>=3 messages since the target).
    (mergedEvent as any).__quoteTarget = targetEvent;

    if (!this.shouldSpeak(sessionKey, session, snapshot, mergedText)) {
      return;
    }

    await this.processEvent(mergedEvent);
  }

  private buildMergedText(events: ChatEvent[], max = 6): string {
    return events
      .slice(-max)
      .map((e) => e.rawText.trim())
      .filter(Boolean)
      .join(' ');
  }

  private hasQuestion(text: string): boolean {
    const t = text.trim();
    if (t.length === 0) return false;

    // Punctuation
    if (t.includes('?') || t.includes('？')) return true;

    // Common Chinese question words / patterns
    return /\bwhy\b|\bhow\b|\bwhat\b|吗|么|什么|咋|咋样|咋办|啥|如何|怎么|怎样|为何|为什么|能不能|能否|可不可以|可否|是否|哪里|哪儿|哪个|哪位|谁|多少|几/.test(
      t,
    );
  }

  private shouldSpeak(
    sessionKey: string,
    session: { lastBotReplyAt?: number; forceQuoteNextFlush?: boolean },
    snapshot: DebounceSnapshot,
    mergedText: string,
  ): boolean {
    // If we cancelled mid-typing, prefer replying on next flush.
    if (session.forceQuoteNextFlush) {
      this.logger.debug(
        'router',
        `GroupTurnTakingGuard: decision=allow reason=force-quote sinceLastGroupReplyMs=${
          Date.now() - (session.lastBotReplyAt ?? 0)
        } priority=3 for ${sessionKey}`,
      );
      return true;
    }

    const now = Date.now();
    const cooldownMs = 5000;
    const sinceLastReply = now - (session.lastBotReplyAt ?? 0);

    if (sinceLastReply >= cooldownMs) {
      this.logger.debug(
        'router',
        `GroupTurnTakingGuard: decision=allow reason=cooldown-elapsed sinceLastGroupReplyMs=${sinceLastReply} priority=1 for ${sessionKey}`,
      );
      return true;
    }

    // Cooldown window: only break for follow-up questions / clarifications.
    if (snapshot.count >= 2 && this.hasQuestion(mergedText)) {
      this.logger.debug(
        'router',
        `GroupTurnTakingGuard: decision=allow reason=followup-question sinceLastGroupReplyMs=${sinceLastReply} priority=2 for ${sessionKey}`,
      );
      return true;
    }

    this.logger.debug(
      'router',
      `GroupTurnTakingGuard: decision=skip reason=cooldown sinceLastGroupReplyMs=${sinceLastReply} priority=0 for ${sessionKey}`,
    );
    return false;
  }

  private pickQuoteTarget(events: ChatEvent[]): ChatEvent {
    const scored = events.map((e, idx) => {
      const t = e.rawText.trim();
      let s = 0;
      if (this.hasQuestion(t)) s += 3;
      if (t.length >= 12) s += 2;
      if (!/^[\s\p{P}\p{S}]+$/u.test(t)) s += 1;
      if (idx >= events.length - 2) s += 1;
      return { e, s };
    });
    scored.sort((a, b) => b.s - a.s);
    return scored[0]?.e ?? events[events.length - 1];
  }

  /**
   * Process a single event (actual reply logic)
   * @param event - The chat event to process
   */
  private async processEvent(event: ChatEvent): Promise<void> {
    try {
      // Provide defaults so send-time quote logic can work for non-debounced paths too.
      if ((event as any).__targetText === undefined) {
        (event as any).__targetText = event.rawText;
      }
      if ((event as any).__quoteTarget === undefined) {
        (event as any).__quoteTarget = event;
      }

      const { isCommand } = this.classifier.classify(event);
      if (isCommand) {
        if (this.commandRouter) {
          await this.commandRouter.handle(event);
        } else {
          this.logger.warn('router', 'Command router not configured');
          await this.sender.sendText(event.groupId, '指令系统未启用');
        }
        return;
      }

      // sender/replyer/commandRouter are injected after construction (QQAdapter/bootstrap),
      // so build pipelines using the latest fields each call.
      const replyPipeline = new ReplyPipeline({
        logger: this.logger,
        replyer: this.replyer,
        conversationStore: this.conversationStore,
        memberStats: this.memberStats,
        contextBuilder: this.contextBuilder,
        llmPromptHistory: this.llmPromptHistory,
      });

      const result = await replyPipeline.run(event);
      if (result.type === 'skip') {
        if (result.reason === 'not-configured') {
          this.logger.warn(
            'router',
            'Replyer, conversation store, or context builder not configured',
          );
          await this.sender.sendText(event.groupId, `收到:${event.rawText}`);
          return;
        }

        this.logger.debug('router', `Ignoring message (reason: ${result.reason})`);
        return;
      }

      const sendPipeline = new SendPipeline({
        sender: this.sender,
        logger: this.logger,
        sessionStore: this.sessionStore,
      });
      const sendResult = await sendPipeline.send(event, result.replyText, {
        persona: result.persona,
        isAtReply: result.isAtReply,
      });

      if (!sendResult.sent) {
        this.logger.debug('router', 'Reply generated but cancelled before sending');
        return;
      }

      // Successful send: consume any pending "force quote" flag.
      const sessionKey = `${event.platform}:${event.groupId}`;
      this.sessionStore.clearForceQuoteNextFlush(sessionKey);

      replyPipeline.commitReply(event, result.planResult, result.replyText);
      this.sessionStore.setLastBotReplyAt(sessionKey, Date.now());
    } catch (error) {
      this.logger.error('router', `Failed to handle event: ${error}`);
    }
  }
}
