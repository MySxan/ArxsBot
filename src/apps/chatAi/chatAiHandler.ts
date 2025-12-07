import type { Event } from '../../core/model/Event.js';
import type { Context } from '../../core/model/Context.js';
import type { Intent } from '../../core/model/Intent.js';
import type { Action } from '../../core/model/Action.js';
import { IntentType } from '../../core/model/Intent.js';
import { getPlainText, MessageContentType } from '../../core/model/Message.js';
import { sendMessage } from '../../core/model/Action.js';
import type { IHandler, HandlerMetadata } from '../../core/dispatcher/IHandler.js';

export class ChatAiHandler implements IHandler {
  static readonly metadata: HandlerMetadata = {
    intents: [IntentType.SimpleChat],
    priority: 100,
    description: 'Echo handler for simple chat messages',
  };

  /**
   * Handle chat intents by echoing the message.
   * Later: replace with LLM calls, response post-processing, etc.
   */
  async handle(event: Event, context: Context, intent: Intent | null): Promise<Action[]> {
    if (!intent || intent.type !== IntentType.SimpleChat) {
      return [];
    }

    if (!context.currentMessage) {
      return [];
    }

    const originalText = getPlainText(context.currentMessage);
    const echoText = `${originalText} (echo)`;

    // Build echo response using descriptive action
    const action = sendMessage({
      channelId: context.channelId,
      content: [
        {
          type: MessageContentType.Text,
          data: { text: echoText },
        },
      ],
      replyTo: context.currentMessage.id,
    });

    return [action];
  }
}
