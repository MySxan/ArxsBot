import type { ChatEvent } from '../../../events/ChatEvent.js';

export interface EventClassification {
  isCommand: boolean;
  isMention: boolean;
}

export class EventClassifier {
  isCommandText(text: string): boolean {
    const t = text.trim();
    return t.startsWith('/') || t.startsWith('！');
  }

  isMention(event: ChatEvent): boolean {
    return Boolean(event.mentionsBot);
  }

  classify(event: ChatEvent): EventClassification {
    return {
      isCommand: this.isCommandText(event.rawText),
      isMention: this.isMention(event),
    };
  }
}
