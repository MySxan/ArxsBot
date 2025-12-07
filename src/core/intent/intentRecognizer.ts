import type { Message } from '../model/Message.js';
import { IntentType, type Intent, createIntent } from '../model/Intent.js';
import { getPlainText } from '../model/Message.js';
import { EventType } from '../model/Event.js';

export class IntentRecognizer {
  /**
   * Recognize intent from a message.
   * For now, very simple: all text messages are SimpleChat.
   * TODO: Add rule-based classification, keyword detection, LLM classification.
   */
  recognize(message: Message): Intent {
    const text = getPlainText(message).trim();

    // Empty message, low confidence
    if (!text) {
      return createIntent(IntentType.SimpleChat, EventType.MessageReceived, { confidence: 0.1 });
    }

    // TODO: Check for commands (prefix-based)
    // if (text.startsWith('/')) return createIntent(IntentType.Command, EventType.MessageReceived);

    // TODO: Check for questions ("?", "what", "how", etc)
    // if (text.includes('?')) return createIntent(IntentType.Question, EventType.MessageReceived);

    // Default: all other messages are simple chat
    return createIntent(IntentType.SimpleChat, EventType.MessageReceived, { confidence: 1 });
  }
}
