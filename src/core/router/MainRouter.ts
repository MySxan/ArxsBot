import type { ChatEvent } from '../model/ChatEvent.js';
import type { MessageSender } from '../messaging/MessageSender.js';
import type { Logger } from '../../infra/logger/logger.js';
import type { CommandRouter } from '../command/CommandRouter.js';
import type { SimpleReplyer } from '../chat/SimpleReplyer.js';
import type { ConversationStore } from '../memory/ConversationStore.js';
import { plan } from '../planner/simplePlanner.js';

/**
 * Utility function for async sleep
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Main event router - handles all incoming chat events.
 * Flow: Event → Planner → Command/Chat handler → Response
 */
export class MainRouter {
  private logger: Logger;
  private sender: MessageSender;
  private commandRouter?: CommandRouter;
  private replyer?: SimpleReplyer;
  private conversationStore?: ConversationStore;

  constructor(
    logger: Logger,
    sender: MessageSender,
    commandRouter?: CommandRouter,
    replyer?: SimpleReplyer,
    conversationStore?: ConversationStore,
  ) {
    this.logger = logger;
    this.sender = sender;
    this.commandRouter = commandRouter;
    this.replyer = replyer;
    this.conversationStore = conversationStore;
  }

  /**
   * Handle incoming chat event.
   */
  async handleEvent(event: ChatEvent): Promise<void> {
    this.logger.debug('router', `Received message from ${event.userId} in ${event.groupId}`);

    // Step 1: Plan how to handle this message
    const planResult = plan(event);

    if (!planResult.shouldReply) {
      this.logger.debug('router', `Ignoring message (mode: ${planResult.mode})`);
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
          if (this.replyer && this.conversationStore) {
            // Step 1: Record user message in conversation history
            this.conversationStore.appendTurn(event.groupId, {
              role: 'user',
              content: event.rawText,
              timestamp: Date.now(),
            });

            // Step 2: Generate reply using LLM with conversation context
            const replyText = await this.replyer.reply(event);

            // Step 3: Record bot reply in conversation history
            this.conversationStore.appendTurn(event.groupId, {
              role: 'bot',
              content: replyText,
              timestamp: Date.now(),
            });

            // Step 4: Send the reply
            await this.sender.sendText(event.groupId, replyText);
          } else {
            // Fallback if LLM or conversation store not configured
            this.logger.warn('router', 'Replyer or conversation store not configured');
            await this.sender.sendText(event.groupId, `收到：${event.rawText}`);
          }
          break;

        case 'echo':
          await this.sender.sendText(event.groupId, event.rawText);
          break;

        default:
          this.logger.warn('router', `Unhandled mode: ${planResult.mode}`);
      }
    } catch (error) {
      this.logger.error('router', `Failed to handle event: ${error}`);
    }
  }
}
