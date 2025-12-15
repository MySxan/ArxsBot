/**
 * @file Test debouncer functionality
 * 
 * This test demonstrates the MessageDebouncer in action
 */
import { MessageDebouncer } from '../../src/core/conversation/MessageDebouncer.js';
import type { Logger } from '../../src/infra/logger/logger.js';

const logger: Logger = {
  debug: (context: string, message: string) => {},
  info: (context: string, message: string) => {},
  warn: (context: string, message: string) => {},
  error: (context: string, message: string) => {},
};

async function testDebouncer() {
  console.log('=== MessageDebouncer Test ===\n');

  const debouncer = new MessageDebouncer(logger, 2000); // 2s for testing
  const results: string[] = [];

  const handler = async (bufferedEvent: any) => {
    const msg = `Handler called for: ${bufferedEvent.rawText}`;
    results.push(msg);
    console.log(`✓ ${msg}`);
  };

  // Scenario 1: Single message
  console.log('📝 Scenario 1: Single message');
  const event1 = {
    platform: 'qq' as const,
    groupId: 'group1',
    userId: 'user1',
    messageId: 'msg1',
    rawText: 'Hello world',
    timestamp: Date.now(),
    mentionsBot: false,
  };

  debouncer.debounce(event1, handler);
  console.log('  ✓ Message buffered, waiting 2s...');

  await new Promise((resolve) => setTimeout(resolve, 2500));
  console.log(`  Results so far: ${results.length} handler calls\n`);

  // Scenario 2: Multiple messages within debounce window
  console.log('📝 Scenario 2: Multiple messages in quick succession (should only process the last one)');
  results.length = 0;

  const event2a = {
    platform: 'qq' as const,
    groupId: 'group2',
    userId: 'user2',
    messageId: 'msg2a',
    rawText: 'First message',
    timestamp: Date.now(),
    mentionsBot: false,
  };

  const event2b = {
    platform: 'qq' as const,
    groupId: 'group2',
    userId: 'user2',
    messageId: 'msg2b',
    rawText: 'Second message',
    timestamp: Date.now(),
    mentionsBot: false,
  };

  const event2c = {
    platform: 'qq' as const,
    groupId: 'group2',
    userId: 'user2',
    messageId: 'msg2c',
    rawText: 'Third message (final)',
    timestamp: Date.now(),
    mentionsBot: false,
  };

  debouncer.debounce(event2a, handler);
  console.log('  ✓ First message buffered');

  await new Promise((resolve) => setTimeout(resolve, 500));
  debouncer.debounce(event2b, handler);
  console.log('  ✓ Second message buffered (timer reset)');

  await new Promise((resolve) => setTimeout(resolve, 500));
  debouncer.debounce(event2c, handler);
  console.log('  ✓ Third message buffered (timer reset)');

  console.log('  Waiting 2.5s for final handler call...');
  await new Promise((resolve) => setTimeout(resolve, 2500));

  console.log(`  Results: ${results.length} handler call(s)`);
  console.log(`  Expected: 1 call (the last message only)\n`);

  // Scenario 3: Different users should use separate buffers
  console.log('📝 Scenario 3: Different users in same group (separate debounce per user)');
  results.length = 0;

  const event3a = {
    platform: 'qq' as const,
    groupId: 'group3',
    userId: 'user3a',
    messageId: 'msg3a',
    rawText: 'Message from user A',
    timestamp: Date.now(),
    mentionsBot: false,
  };

  const event3b = {
    platform: 'qq' as const,
    groupId: 'group3',
    userId: 'user3b',
    messageId: 'msg3b',
    rawText: 'Message from user B',
    timestamp: Date.now(),
    mentionsBot: false,
  };

  debouncer.debounce(event3a, handler);
  console.log('  ✓ User A message buffered');

  debouncer.debounce(event3b, handler);
  console.log('  ✓ User B message buffered (separate buffer)');

  console.log('  Waiting 2.5s for both handler calls...');
  await new Promise((resolve) => setTimeout(resolve, 2500));

  console.log(`  Results: ${results.length} handler call(s)`);
  console.log(`  Expected: 2 calls (one per user)\n`);

  debouncer.clear();
  console.log('✅ All tests completed!');
}

testDebouncer().catch(console.error);
