export enum IntentType {
  SimpleChat = 'simple.chat',
  Command = 'command',
  Question = 'question',
  Feedback = 'feedback',
}

export interface Intent {
  type: IntentType;
  confidence?: number; // 0-1, how confident the recognizer is
  data?: Record<string, unknown>; // arbitrary data associated with intent
}

export function createIntent(
  type: IntentType,
  options?: {
    confidence?: number;
    data?: Record<string, unknown>;
  },
): Intent {
  return {
    type,
    confidence: options?.confidence ?? 1,
    data: options?.data,
  };
}
