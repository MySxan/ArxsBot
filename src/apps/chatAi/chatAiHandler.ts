import type { Event } from '../../core/model/Event.js';
import type { Context } from '../../core/model/Context.js';
import type { Intent } from '../../core/model/Intent.js';
import type { Action } from '../../core/model/Action.js';
import { IntentType } from '../../core/model/Intent.js';
import { getPlainText, MessageContentType, type TextSegment } from '../../core/model/Message.js';
import { ActionType } from '../../core/model/Action.js';

export class ChatAiHandler {
	/**
	 * Handle chat intents by echoing the message.
	 * Signature matches Handler type: (event, context, intent?) => Promise<Action[]>
	 * Later: replace with LLM calls, response post-processing, etc.
	 */
	async handle(event: Event, context: Context, intent?: Intent | null): Promise<Action[]> {
		if (!intent || intent.type !== IntentType.SimpleChat) {
			return []; // Only handle SimpleChat for now
		}

		if (!context.currentMessage) {
			return []; // No message to echo
		}

		const originalText = getPlainText(context.currentMessage);
		const echoText = `${originalText} (echo)`;

		// Build echo response
		const echoSegment: TextSegment = {
			type: MessageContentType.Text,
			data: { text: echoText },
		};

		const action: Action = {
			type: ActionType.SendMessage,
			platform: context.platform,
			channelId: context.channelId,
			content: [echoSegment],
			replyTo: context.currentMessage.id,
		};

		return [action];
	}
}
