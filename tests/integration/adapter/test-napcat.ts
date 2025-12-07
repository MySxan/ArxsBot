#!/usr/bin/env node
/**
 * Test script to verify NapCat adapter with mock OneBot11 messages.
 * This connects to the local reverse WS server and sends test messages.
 */

import { WebSocket } from 'ws';

const WS_URL = 'ws://localhost:6090/';

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('Connecting to ArxsBot NapCat adapter...');

  const ws = new WebSocket(WS_URL);

  ws.on('open', async () => {
    console.log('✓ Connected to NapCat server\n');

    // Send a mock OneBot11 message event
    const testMessage = {
      time: Math.floor(Date.now() / 1000),
      self_id: 1000000,
      post_type: 'message',
      message_type: 'group',
      group_id: 123456,
      user_id: 987654,
      message_id: 1,
      message: [
        {
          type: 'text',
          data: { text: 'Hello bot!' },
        },
      ],
      raw_message: 'Hello bot!',
      sender: {
        user_id: 987654,
        nickname: 'TestUser',
        card: 'TestUser',
      },
    };

    console.log('→ Sending test message:', testMessage.message[0].data.text);
    ws.send(JSON.stringify(testMessage));

    // Wait for response
    await sleep(2000);

    console.log('✓ Test complete. Press Ctrl+C to exit.');
  });

  ws.on('message', (data: Buffer) => {
    try {
      const response = JSON.parse(data.toString());
      console.log('\n← Received response from bot:');
      console.log(JSON.stringify(response, null, 2));
    } catch (err) {
      console.error('Failed to parse response:', err);
    }
  });

  ws.on('error', (err) => {
    console.error('✗ Connection error:', err.message);
    console.log('\nMake sure the bot is running: pnpm dev');
    process.exit(1);
  });

  ws.on('close', () => {
    console.log('\nConnection closed.');
    process.exit(0);
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\nShutting down...');
    ws.close();
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
