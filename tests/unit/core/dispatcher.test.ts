import { describe, it, expect } from 'vitest';
import type { Logger } from '../../../src/infra/logger/logger.js';
import { Dispatcher } from '../../../src/core/dispatcher/dispatcher.js';
import { IntentRecognizer } from '../../../src/core/intent/intentRecognizer.js';
import { ChatAiHandler } from '../../../src/apps/chatAi/chatAiHandler.js';
import { IntentType } from '../../../src/core/model/Intent.js';
import { EventType } from '../../../src/core/model/Event.js';
import { MessageContentType } from '../../../src/core/model/Message.js';
import { ActionType } from '../../../src/core/model/Action.js';
import type { Message } from '../../../src/core/model/Message.js';
import type { User } from '../../../src/core/model/User.js';
import type { Context } from '../../../src/core/model/Context.js';
import type { Event } from '../../../src/core/model/Event.js';

// Mock logger
const mockLogger: Logger = {
  info: () => {},
  debug: () => {},
  warn: () => {},
  error: () => {},
};

describe('Dispatcher', () => {
  it('should dispatch a message event and produce an echo action', async () => {
    // Setup
    const intentRecognizer = new IntentRecognizer();
    const dispatcher = new Dispatcher(mockLogger, intentRecognizer);
    const chatAiHandler = new ChatAiHandler();

    // Register handler
    dispatcher.registerHandler(`intent:${IntentType.SimpleChat}`, (event, context, intent) =>
      chatAiHandler.handle(event, context, intent),
    );

    // Create test data
    const user: User = {
      id: 'user-1',
      platform: 'discord',
      displayName: 'TestUser',
    };

    const message: Message = {
      id: 'msg-1',
      channelId: 'channel-1',
      userId: 'user-1',
      platform: 'discord',
      timestamp: Date.now(),
      content: [
        {
          type: MessageContentType.Text,
          data: { text: 'Hello bot' },
        },
      ],
    };

    const context: Context = {
      platform: 'discord',
      channelId: 'channel-1',
      user,
      currentMessage: message,
      recentMessages: [message],
    };

    const event: Event = {
      type: EventType.MessageReceived,
      platform: 'discord',
      timestamp: Date.now(),
      message,
    };

    // Execute
    const actions = await dispatcher.dispatch(event, context);

    // Verify
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe(ActionType.SendMessage);
    expect(actions[0].platform).toBe('discord');

    // Check that the echo text was added
    const sendAction = actions[0];
    if (sendAction.type === ActionType.SendMessage) {
      expect(sendAction.channelId).toBe('channel-1');
      expect(sendAction.content).toHaveLength(1);
      const textSegment = sendAction.content[0];
      if (textSegment.type === MessageContentType.Text) {
        const data = textSegment.data as { text: string };
        expect(data.text).toBe('Hello bot (echo)');
      }
    }
  });

  it('should return empty actions for non-message events', async () => {
    const intentRecognizer = new IntentRecognizer();
    const dispatcher = new Dispatcher(mockLogger, intentRecognizer);

    const user: User = {
      id: 'user-1',
      platform: 'discord',
      displayName: 'TestUser',
    };

    const context: Context = {
      platform: 'discord',
      channelId: 'channel-1',
      user,
      recentMessages: [],
    };

    const event: Event = {
      type: EventType.MemberJoined,
      platform: 'discord',
      timestamp: Date.now(),
      user,
      group: {
        id: 'group-1',
        platform: 'discord',
        displayName: 'TestGroup',
      },
    };

    const actions = await dispatcher.dispatch(event, context);
    expect(actions).toHaveLength(0);
  });
});
