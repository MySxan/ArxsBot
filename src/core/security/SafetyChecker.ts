import type { ChatEvent } from '../events/ChatEvent.js';
import type { Logger } from '../../infra/logger/logger.js';

/**
 * Safety check result
 */
export interface SafetyCheckResult {
  /** Whether the message passed safety check */
  safe: boolean;
  /** Reason if unsafe */
  reason?: string;
  /** Suggested rewrite if needed */
  rewrite?: string;
}

/**
 * Message safety checker: performs keyword filtering, policy checks, and small model evaluation
 * Currently a placeholder for future compliance/safety features
 */
export class SafetyChecker {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Check if a message is safe to process/respond to
   * @param event Chat event to check
   * @returns Safety check result
   */
  async check(event: ChatEvent): Promise<SafetyCheckResult> {
    try {
      // TODO: Implement actual safety checks
      // - Keyword filtering (sensitive topics, abuse, etc.)
      // - Policy compliance checks
      // - Small model evaluation (if enabled)
      // - Content rewriting if needed

      // For now, all messages are considered safe
      return {
        safe: true,
      };
    } catch (error) {
      this.logger.error('safety', `Error checking message safety: ${error}`);
      // Default to allowing message on error, but log it
      return {
        safe: true,
      };
    }
  }

  /**
   * Rewrite message content for safety/compliance if needed
   * @param content Original message content
   * @returns Rewritten content or original if no changes needed
   */
  async rewrite(content: string): Promise<string> {
    try {
      // TODO: Implement actual rewriting logic
      // - Replace sensitive terms
      // - Tone adjustment
      // - Length reduction for compliance

      // For now, return content as-is
      return content;
    } catch (error) {
      this.logger.error('safety', `Error rewriting message: ${error}`);
      return content;
    }
  }

  /**
   * Check if a reply is safe before sending
   * @param reply Reply content to check
   * @returns Safety check result
   */
  async checkReply(reply: string): Promise<SafetyCheckResult> {
    try {
      // TODO: Implement reply-specific safety checks
      // - Length validation
      // - Tone/style compliance
      // - Embedded instructions/prompt injection detection

      return {
        safe: true,
      };
    } catch (error) {
      this.logger.error('safety', `Error checking reply safety: ${error}`);
      return {
        safe: true,
      };
    }
  }
}

/**
 * Create a new SafetyChecker instance
 */
export function createSafetyChecker(logger: Logger): SafetyChecker {
  return new SafetyChecker(logger);
}
