import type { ChatEvent } from '../../../events/ChatEvent.js';
import type { MessageSender } from '../../../messaging/MessageSender.js';
import type { Logger } from '../../../../infra/logger/logger.js';
import { UtterancePlanner } from '../../../style/UtterancePlanner.js';
import type { SessionStateStore, TypingToken } from '../session/SessionStateStore.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateTypingDelay(text: string): number {
  // More human-like pacing:
  // - small replies still take a moment (min clamp)
  // - long replies don't stall forever (max clamp)
  const baseTime = 1000;
  const timePerChar = 60;
  const randomFactor = Math.random() * 1500;
  const raw = baseTime + text.length * timePerChar + randomFactor;
  // For ~10 chars, this yields ~2.6-4.1s with min around ~2.8s.
  const minDelay = 2800;
  const maxDelay = 8000;
  return Math.max(minDelay, Math.min(raw, maxDelay));
}

export interface SendPersonaParams {
  verbosity: number;
  multiUtterancePreference: number;
}

export class SendPipeline {
  private utterancePlanner: UtterancePlanner;

  constructor(
    private readonly deps: {
      sender: MessageSender;
      logger: Logger;
      utterancePlanner?: UtterancePlanner;
      sessionStore?: SessionStateStore;
    },
  ) {
    this.utterancePlanner = deps.utterancePlanner ?? new UtterancePlanner();
  }

  private isCancelled(token?: TypingToken): boolean {
    return Boolean(token?.cancelled);
  }

  async send(
    event: ChatEvent,
    replyText: string,
    options: {
      persona: SendPersonaParams;
      isAtReply: boolean;
    },
  ): Promise<{ sent: boolean; cancelled: boolean }> {
    const sessionKey = `${event.platform}:${event.groupId}`;
    const token = this.deps.sessionStore?.startTyping(sessionKey);

    const quoteTarget = (event as any).__quoteTarget as ChatEvent | undefined;
    const replyTo =
      quoteTarget && quoteTarget.messageId && quoteTarget.messageId !== '0'
        ? quoteTarget.messageId
        : undefined;

    const quoteTargetSeq = quoteTarget ? ((quoteTarget as any).__seq as number | undefined) : undefined;
    const session = this.deps.sessionStore?.get(sessionKey);
    const currentSeq = session?.messageSeq;
    const gap =
      typeof currentSeq === 'number' && typeof quoteTargetSeq === 'number'
        ? currentSeq - quoteTargetSeq
        : undefined;
    const forceQuote = Boolean(session?.forceQuoteNextFlush);
    const shouldReplyTo = Boolean(replyTo && (forceQuote || (typeof gap === 'number' && gap >= 3)));

    // 规划分段发送
    const utterancePlan = this.utterancePlanner.makePlan(replyText, {
      persona: {
        verbosity: options.persona.verbosity,
        multiUtterancePreference: options.persona.multiUtterancePreference,
      },
      isAtReply: options.isAtReply,
    });

    // 模拟输入延迟
    const typingDelay = calculateTypingDelay(replyText);
    this.deps.logger.debug(
      'router',
      `Typing delay: ${typingDelay.toFixed(0)}ms (${replyText.length} chars)`,
    );
    await sleep(typingDelay);

    if (this.isCancelled(token)) {
      this.deps.logger.debug('router', `Send cancelled after typing delay (${sessionKey})`);
      if (token && this.deps.sessionStore) {
        this.deps.sessionStore.endTyping(sessionKey, token);
      }
      return { sent: false, cancelled: true };
    }

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

      this.deps.logger.debug(
        'router',
        `Sending ${finalSegments.length} segments (${hasBreakMarker ? 'brk+' : ''}${hasNewlines ? 'newline' : ''})`,
      );

      for (let i = 0; i < finalSegments.length; i += 1) {
        if (this.isCancelled(token)) {
          this.deps.logger.debug('router', `Send cancelled mid-segments (${sessionKey})`);
          if (token && this.deps.sessionStore) {
            this.deps.sessionStore.endTyping(sessionKey, token);
          }
          return { sent: false, cancelled: true };
        }

        if (i > 0) {
          // 根据上一条消息长度动态计算间隔
          const prevLength = finalSegments[i - 1].length;
          const baseDelay = 500;
          const charDelay = prevLength * 40;
          const randomDelay = Math.random() * 700;
          const totalDelay = baseDelay + charDelay + randomDelay;
          await sleep(Math.min(totalDelay, 3000));

          if (this.isCancelled(token)) {
            this.deps.logger.debug(
              'router',
              `Send cancelled during inter-segment delay (${sessionKey})`,
            );
            if (token && this.deps.sessionStore) {
              this.deps.sessionStore.endTyping(sessionKey, token);
            }
            return { sent: false, cancelled: true };
          }
        }
        await this.deps.sender.sendText(
          event.groupId,
          finalSegments[i],
          i === 0 && shouldReplyTo ? replyTo : undefined,
        );
      }

      if (token && this.deps.sessionStore) {
        this.deps.sessionStore.endTyping(sessionKey, token);
      }
      return { sent: true, cancelled: false };
    }

    // 单条消息使用 utterancePlan 处理分句
    let sentAny = false;
    for (const segment of utterancePlan.segments) {
      if (this.isCancelled(token)) {
        this.deps.logger.debug('router', `Send cancelled mid-utterance (${sessionKey})`);
        if (token && this.deps.sessionStore) {
          this.deps.sessionStore.endTyping(sessionKey, token);
        }
        return { sent: false, cancelled: true };
      }

      if (segment.delayMs > 0) {
        await sleep(segment.delayMs);

        if (this.isCancelled(token)) {
          this.deps.logger.debug('router', `Send cancelled during utterance delay (${sessionKey})`);
          if (token && this.deps.sessionStore) {
            this.deps.sessionStore.endTyping(sessionKey, token);
          }
          return { sent: false, cancelled: true };
        }
      }

      await this.deps.sender.sendText(
        event.groupId,
        segment.text,
        sentAny ? undefined : shouldReplyTo ? replyTo : undefined,
      );
      sentAny = true;
    }

    if (token && this.deps.sessionStore) {
      this.deps.sessionStore.endTyping(sessionKey, token);
    }
    return { sent: true, cancelled: false };
  }
}
