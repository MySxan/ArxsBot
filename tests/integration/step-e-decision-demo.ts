import type { ChatEvent } from '../../src/core/events/ChatEvent.js';
import type { DebounceSnapshot } from '../../src/core/conversation/MessageDebouncer.js';
import { ConversationRouter } from '../../src/core/conversation/ConversationRouter.js';
import { SessionStateStore } from '../../src/core/conversation/router/session/SessionStateStore.js';

function makeEvent(partial: Partial<ChatEvent> & Pick<ChatEvent, 'rawText' | 'messageId'>): ChatEvent {
  const now = Date.now();
  return {
    ...partial,
    platform: 'qq',
    groupId: '123',
    userId: 'u1',
    mentionsBot: false,
    timestamp: partial.timestamp ?? now,
    messageId: partial.messageId,
    rawText: partial.rawText,
  };
}

function makeSnapshot(events: ChatEvent[]): DebounceSnapshot {
  const firstAt = events[0]?.timestamp ?? Date.now();
  const lastAt = events[events.length - 1]?.timestamp ?? firstAt;
  return {
    userKey: `${events[0]!.platform}:${events[0]!.groupId}:${events[0]!.userId}`,
    events,
    lastEvent: events[events.length - 1]!,
    count: events.length,
    firstAt,
    lastAt,
  };
}

function printCase(title: string, out: unknown): void {
  // eslint-disable-next-line no-console
  console.log(`\n=== ${title} ===`);
  // eslint-disable-next-line no-console
  console.dir(out, { depth: 5 });
}

/**
 * This script intentionally uses `as any` to call router private helpers.
 * It is a demo for verifying Step E decision logic quickly.
 */
async function main(): Promise<void> {
  // Minimal stubs; we don't actually send anything in this demo.
  const logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  } as any;
  const sender = { sendText: async () => {} } as any;

  const router = new ConversationRouter(logger, sender);

  // We'll inspect Step E helpers via private methods.
  const r = router as any;

  // Use a real SessionStateStore instance to model cooldown/force-quote.
  const sessionStore = new SessionStateStore();
  const sessionKey = 'qq:123';
  const session = sessionStore.get(sessionKey);

  // Case A: normal multi-message burst, no cooldown
  session.lastBotReplyAt = Date.now() - 60_000;
  session.forceQuoteNextFlush = false;
  const snapA = makeSnapshot([
    makeEvent({ messageId: '101', rawText: '你好' }),
    makeEvent({ messageId: '102', rawText: '我想问一下' }),
    makeEvent({ messageId: '103', rawText: '怎么配置？' }),
  ]);
  const mergedTextA = r.buildMergedText(snapA.events, 6);
  const canSpeakA = r.shouldSpeak(sessionKey, session, snapA, mergedTextA);
  const quoteTargetA = r.pickQuoteTarget(snapA.events);
  printCase('A) burst, no cooldown', {
    count: snapA.count,
    mergedText: mergedTextA,
    hasQuestion: r.hasQuestion(mergedTextA),
    canSpeak: canSpeakA,
    shouldQuote: snapA.count >= 3,
    quoteTarget: { messageId: quoteTargetA.messageId, rawText: quoteTargetA.rawText },
  });

  // Case B: cooldown active; single statement => skip
  session.lastBotReplyAt = Date.now() - 1500;
  session.forceQuoteNextFlush = false;
  const snapB = makeSnapshot([makeEvent({ messageId: '201', rawText: '好滴我知道了' })]);
  const mergedTextB = r.buildMergedText(snapB.events, 6);
  const canSpeakB = r.shouldSpeak(sessionKey, session, snapB, mergedTextB);
  printCase('B) cooldown, non-question => skip', {
    sinceLastBotReplyMs: Date.now() - (session.lastBotReplyAt ?? 0),
    count: snapB.count,
    mergedText: mergedTextB,
    hasQuestion: r.hasQuestion(mergedTextB),
    canSpeak: canSpeakB,
  });

  // Case C: cooldown active; follow-up question with count>=2 => allow
  session.lastBotReplyAt = Date.now() - 1200;
  session.forceQuoteNextFlush = false;
  const snapC = makeSnapshot([
    makeEvent({ messageId: '301', rawText: '等等' }),
    makeEvent({ messageId: '302', rawText: '你刚说的是什么？' }),
  ]);
  const mergedTextC = r.buildMergedText(snapC.events, 6);
  const canSpeakC = r.shouldSpeak(sessionKey, session, snapC, mergedTextC);
  printCase('C) cooldown, follow-up question => allow', {
    sinceLastBotReplyMs: Date.now() - (session.lastBotReplyAt ?? 0),
    count: snapC.count,
    mergedText: mergedTextC,
    hasQuestion: r.hasQuestion(mergedTextC),
    canSpeak: canSpeakC,
  });

  // Case D: forceQuoteNextFlush => always allow + shouldQuote
  session.lastBotReplyAt = Date.now();
  session.forceQuoteNextFlush = true;
  const snapD = makeSnapshot([makeEvent({ messageId: '401', rawText: '你刚刚没回我' })]);
  const mergedTextD = r.buildMergedText(snapD.events, 6);
  const canSpeakD = r.shouldSpeak(sessionKey, session, snapD, mergedTextD);
  const quoteTargetD = r.pickQuoteTarget(snapD.events);
  printCase('D) force-quote-next-flush => allow + quote', {
    forceQuoteNextFlush: session.forceQuoteNextFlush,
    count: snapD.count,
    mergedText: mergedTextD,
    canSpeak: canSpeakD,
    shouldQuote: true,
    quoteTarget: { messageId: quoteTargetD.messageId, rawText: quoteTargetD.rawText },
  });

  // Case E: cooldown active; follow-up question without '?'/'？' but with question word => allow
  session.lastBotReplyAt = Date.now() - 1800;
  session.forceQuoteNextFlush = false;
  const snapE = makeSnapshot([
    makeEvent({ messageId: '501', rawText: '等下' }),
    makeEvent({ messageId: '502', rawText: '你刚说的是什么' }),
  ]);
  const mergedTextE = r.buildMergedText(snapE.events, 6);
  const canSpeakE = r.shouldSpeak(sessionKey, session, snapE, mergedTextE);
  printCase('E) cooldown, question word w/o punctuation => allow', {
    sinceLastBotReplyMs: Date.now() - (session.lastBotReplyAt ?? 0),
    count: snapE.count,
    mergedText: mergedTextE,
    hasQuestion: r.hasQuestion(mergedTextE),
    canSpeak: canSpeakE,
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
