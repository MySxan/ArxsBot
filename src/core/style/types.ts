/**
 * Style parameters for prompt building
 */
export interface ModeStyle {
  forbidFormalAI?: boolean;
  allowSlang?: boolean;
  allowIncomplete?: boolean;
  allowTeasing?: boolean;
  maxLength?: number;
  [key: string]: any;
}
/**
 * Types for utterance planning and delivery
 */

/**
 * A segment of utterance to be sent
 */
export interface UtteranceSegment {
  text: string; // Processed text (may have ending punctuation removed)
  delayMs: number; // Wait time before sending this segment (ms)
  importance: 'main' | 'side' | 'extra'; // Can be used to control dropping in the future
}

/**
 * A plan for how to deliver an utterance
 */
export interface UtterancePlan {
  segments: UtteranceSegment[];
}

/**
 * Options for utterance planning
 */
export interface UtterancePlanOptions {
  /** Persona configuration */
  persona: {
    verbosity?: number; // 0-1, how chatty/verbose the bot is
    multiUtterancePreference?: number; // 0-1, preference for splitting messages
  };
  /** Whether this is an @ reply (tends to be more formal) */
  isAtReply: boolean;
}
