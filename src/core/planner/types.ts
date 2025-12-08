/**
 * Reply mode types for different message handling strategies
 */
export type ReplyMode = 'ignore' | 'echo' | 'command' | 'smalltalk';

/**
 * Planning result that determines how to handle a message
 */
export interface PlanResult {
  /** Whether the bot should reply to this message */
  shouldReply: boolean;

  /** What mode to use for the reply */
  mode: ReplyMode;

  /** Delay in milliseconds before replying (for simulating thinking time) */
  delayMs: number;

  // Future extensions:
  // targetUserId?: string;
  // useWorkflow?: string;
  // useTool?: string;
  // priority?: number;
}
