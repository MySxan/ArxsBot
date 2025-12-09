/**
 * Reply mode types for different message handling strategies
 */
export type ReplyMode =
  | 'ignore' // Don't reply at all
  | 'command' // Execute command
  | 'directAnswer' // Direct factual answer
  | 'passiveAcknowledge' // Simple acknowledgment (嗯、好、笑死)
  | 'playfulTease' // Playful banter/teasing
  | 'empathySupport' // Empathy/emotional support
  | 'deflect' // Change topic/deflect
  | 'casual' // 口语化：语气词+废话+省略（"哈哈哈"、"确实"、"有一说一"）
  | 'fragment' // 片段化：跳跃思维/答非所问/只说半句
  | 'smalltalk'; // General conversation (legacy)

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

  /** Optional diagnostics for debugging planner decisions */
  meta?: {
    replyProbability?: number;
    botEnergy?: number;
    groupActivity?: number;
    messagesInWindow?: number;
    intimacy?: number;
    userMessageRate?: number;
    userRepetitionScore?: number;
    groupMemeScore?: number;
    interestScore?: number;
    // New layered model factors
    baseInterest?: number; // Content quality: length/question/topic
    socialAttention?: number; // User expectation: mentions + intimacy
    personaTalkativeness?: number; // Bot personality chattiness
    spamType?: string; // Spam classification: help_seeking/meme_play/noise/normal
    urgencyScore?: number; // Urgency for help-seeking spam (0-1)
    reason?: string;
    // Cooldown factors
    sinceLastBotMs?: number; // Time since last bot reply
    cooldownMs?: number; // Cooldown threshold
    skipProb?: number; // Probability of skipping in soft window
  };

  /** Optional high-level reason string for debug output */
  debugReason?: string;

  // Future extensions:
  // targetUserId?: string;
  // useWorkflow?: string;
  // useTool?: string;
  // priority?: number;
}
