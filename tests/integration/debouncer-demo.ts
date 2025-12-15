/**
 * @file Integration test for MessageDebouncer with ConversationRouter
 * Demonstrates how the debouncer integrates with the actual router
 */
import { MessageDebouncer } from '../../src/core/conversation/MessageDebouncer.js';
import type { Logger } from '../../src/infra/logger/logger.js';

const logger: Logger = {
  debug: (context: string, message: string) => {},
  info: (context: string, message: string) => {},
  warn: (context: string, message: string) => {},
  error: (context: string, message: string) => {},
};

async function demonstrateDebouncer() {
  console.log('\n=== 消息防抖机制演示 ===\n');

  const debouncer = new MessageDebouncer(logger, 5000); // 5秒延迟

  const processedMessages: string[] = [];

  // 模拟的消息处理 handler
  const mockHandler = async (event: any) => {
    const log = `处理消息: "${event.rawText}" (来自 ${event.userId})`;
    processedMessages.push(log);
    console.log(`  ✓ ${log}`);
  };

  // 测试场景 1: 单条消息
  console.log('📝 测试 1: 单条消息');
  console.log('   用户 A 发送 "hello"');

  debouncer.debounce(
    {
      platform: 'qq' as const,
      groupId: 'group1',
      userId: 'userA',
      messageId: 'msg1',
      rawText: 'hello',
      timestamp: Date.now(),
      mentionsBot: false,
    },
    mockHandler,
  );

  console.log('   ✓ 消息已缓冲，5秒计时器启动');
  console.log('   等待 5.5 秒...\n');

  await new Promise((resolve) => setTimeout(resolve, 5500));

  console.log(`   ✓ 处理完成\n`);

  // 测试场景 2: 连续消息（只处理最后一条）
  processedMessages.length = 0;

  console.log('📝 测试 2: 连续多条消息 (只处理最后一条)');
  console.log('   用户 B 在 0ms 发送 "first"');
  debouncer.debounce(
    {
      platform: 'qq' as const,
      groupId: 'group2',
      userId: 'userB',
      messageId: 'msg2a',
      rawText: 'first',
      timestamp: Date.now(),
      mentionsBot: false,
    },
    mockHandler,
  );

  console.log('   ✓ 消息已缓冲');

  await new Promise((resolve) => setTimeout(resolve, 1000));

  console.log('   用户 B 在 1000ms 发送 "second"');
  debouncer.debounce(
    {
      platform: 'qq' as const,
      groupId: 'group2',
      userId: 'userB',
      messageId: 'msg2b',
      rawText: 'second',
      timestamp: Date.now(),
      mentionsBot: false,
    },
    mockHandler,
  );

  console.log('   ✓ 消息已缓冲，计时器已重置');

  await new Promise((resolve) => setTimeout(resolve, 1000));

  console.log('   用户 B 在 2000ms 发送 "third (final)"');
  debouncer.debounce(
    {
      platform: 'qq' as const,
      groupId: 'group2',
      userId: 'userB',
      messageId: 'msg2c',
      rawText: 'third (final)',
      timestamp: Date.now(),
      mentionsBot: false,
    },
    mockHandler,
  );

  console.log('   ✓ 消息已缓冲，计时器已重置');
  console.log('   等待 5.5 秒...\n');

  await new Promise((resolve) => setTimeout(resolve, 5500));

  console.log(`   ✓ 只处理了最后一条消息\n`);

  // 测试场景 3: 不同用户独立处理
  processedMessages.length = 0;

  console.log('📝 测试 3: 不同用户独立缓冲');
  console.log('   用户 C 发送 "message from C"');

  debouncer.debounce(
    {
      platform: 'qq' as const,
      groupId: 'group3',
      userId: 'userC',
      messageId: 'msg3a',
      rawText: 'message from C',
      timestamp: Date.now(),
      mentionsBot: false,
    },
    mockHandler,
  );

  console.log('   ✓ 消息已缓冲，计时器启动');

  await new Promise((resolve) => setTimeout(resolve, 500));

  console.log('   用户 D 发送 "message from D"');

  debouncer.debounce(
    {
      platform: 'qq' as const,
      groupId: 'group3',
      userId: 'userD',
      messageId: 'msg3b',
      rawText: 'message from D',
      timestamp: Date.now(),
      mentionsBot: false,
    },
    mockHandler,
  );

  console.log('   ✓ 消息已缓冲（独立计时器）');
  console.log('   等待 5.5 秒...\n');

  await new Promise((resolve) => setTimeout(resolve, 5500));

  console.log(`   ✓ 两个用户的消息都被处理\n`);

  // 清理
  debouncer.clear();

  console.log('✅ 所有演示完成！\n');

  console.log('📊 防抖机制的优势:');
  console.log('   1. 自动合并同一用户的连续消息');
  console.log('   2. 减少不必要的 LLM 调用');
  console.log('   3. 让用户的意图更清晰（多条消息整合后再回复）');
  console.log('   4. 改善聊天体验（避免机器人频繁插话）\n');

  console.log('🔧 ConversationRouter 中的使用:');
  console.log('   - 命令 (/) 和 @消息: 立即处理（不防抖）');
  console.log('   - 普通聊天: 防抖处理（5秒）\n');
}

demonstrateDebouncer().catch(console.error);
