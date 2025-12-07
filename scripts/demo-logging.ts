#!/usr/bin/env node
/**
 * Demo script: Send a test message and show logging middleware output.
 * Run with: node scripts/demo-logging.ts
 */

import { WebSocket } from 'ws';

const WS_URL = 'ws://localhost:6090/';

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('Connecting to NapCat adapter...');

  const ws = new WebSocket(WS_URL);

  ws.on('open', async () => {
    console.log('✓ Connected to NapCat server\n');

    // Send test messages to see logging
    const messages = ['Hello bot!', 'How are you?', '测试一下中文'];

    for (const text of messages) {
      const testMessage = {
        time: Math.floor(Date.now() / 1000),
        self_id: 1000000,
        post_type: 'message',
        message_type: 'group',
        group_id: 123456,
        user_id: 987654,
        message_id: Math.floor(Math.random() * 10000),
        message: [
          {
            type: 'text',
            data: { text },
          },
        ],
        raw_message: text,
        sender: {
          user_id: 987654,
          nickname: 'TestUser',
          card: 'TestUser',
        },
      };

      console.log(`\n💬 Sending: "${text}"`);
      ws.send(JSON.stringify(testMessage));

      await sleep(1500);
    }

    console.log('\n✓ All test messages sent!');
    ws.close();
  });

  ws.on('message', (data: Buffer) => {
    try {
      const response = JSON.parse(data.toString());
      const text = response.params?.message?.[0]?.data?.text ?? '(no text)';
      console.log(`   🤖 Bot responds: "${text}"`);
    } catch (err) {
      console.error('Failed to parse response:', err);
    }
  });

  ws.on('error', (err) => {
    console.error('Connection error:', err.message);
    console.log('\nMake sure the bot is running: pnpm dev');
    process.exit(1);
  });

  ws.on('close', () => {
    console.log('\nDemo complete!');
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
