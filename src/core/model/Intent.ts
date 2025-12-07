import type { EventType } from './Event.js';

export enum IntentType {
  SimpleChat = 'simple.chat',
  Command = 'command',
  Question = 'question',
  Feedback = 'feedback',
  AskForHomework = 'ask.homework',
  MemberConflictEscalation = 'member.conflict',
  UserJoiningGroup = 'user.joining',
}

export interface Intent {
  type: IntentType;
  sourceEventType: EventType; // What event triggered this intent
  confidence?: number; // 0-1, how confident the recognizer is
  data?: Record<string, unknown>; // arbitrary data associated with intent
}

export function createIntent(
  type: IntentType,
  sourceEventType: EventType,
  options?: {
    confidence?: number;
    data?: Record<string, unknown>;
  },
): Intent {
  return {
    type,
    sourceEventType,
    confidence: options?.confidence ?? 1,
    data: options?.data,
  };
}
