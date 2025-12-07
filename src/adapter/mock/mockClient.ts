import * as readline from 'node:readline';
import type { Dispatcher } from '../../core/dispatcher/dispatcher.js';
import type { Event } from '../../core/model/Event.js';
import type { Message } from '../../core/model/Message.js';
import type { User } from '../../core/model/User.js';
import type { Context } from '../../core/model/Context.js';
import { EventType } from '../../core/model/Event.js';
import { MessageContentType } from '../../core/model/Message.js';
import { createContext } from '../../core/model/Context.js';

export class MockClient {
  private dispatcher: Dispatcher;
  private rl: readline.Interface;
  private mockUser: User;
  private messageCounter = 0;

  constructor(dispatcher: Dispatcher) {
    this.dispatcher = dispatcher;
    this.mockUser = {
      id: 'cli-user',
      platform: 'qq',
      displayName: 'CLI User',
    };

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '> ',
    });
  }

  public start(): void {
    console.log('=== Mock CLI Bot Started ===');
    console.log('Type your message and press Enter. Ctrl+C to exit.\n');

    this.rl.prompt();

    this.rl.on('line', async (input: string) => {
      const text = input.trim();

      if (!text) {
        this.rl.prompt();
        return;
      }

      // Construct a message event
      const messageId = `msg-${++this.messageCounter}`;
      const message: Message = {
        id: messageId,
        channelId: 'cli-channel',
        userId: this.mockUser.id,
        platform: 'qq',
        timestamp: Date.now(),
        content: [
          {
            type: MessageContentType.Text,
            data: { text },
          },
        ],
      };

      // Create context
      const context: Context = createContext('qq', 'cli-channel', this.mockUser, {
        currentMessage: message,
        recentMessages: [message],
      });

      // Create event
      const event: Event = {
        type: EventType.MessageReceived,
        platform: 'qq',
        timestamp: Date.now(),
        message,
      };

      // Dispatch to get actions
      const actions = await this.dispatcher.dispatch(event, context);

      // Filter and output SendMessage actions
      for (const action of actions) {
        if (action.kind === 'send_message') {
          const payload = action.payload as {
            content: Array<{ type: string; data: unknown }>;
          };

          // Extract text from content segments
          const texts = payload.content
            .filter((seg) => seg.type === MessageContentType.Text)
            .map((seg) => (seg.data as { text: string }).text);

          if (texts.length > 0) {
            console.log(`Bot: ${texts.join('')}`);
          }
        }
      }

      this.rl.prompt();
    });

    this.rl.on('close', () => {
      console.log('\nMock client closed .');
      process.exit(0);
    });
  }
}
