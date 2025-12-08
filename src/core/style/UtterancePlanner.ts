import type { UtterancePlan, UtteranceSegment, UtterancePlanOptions } from './types.js';
import { config } from '../../infra/config/config.js';
import { createLogger } from '../../infra/logger/logger.js';

const logger = createLogger(config);

/**
 * Utterance planner - decides how to split and deliver a raw reply
 *
 * This module asks three questions before splitting:
 * 1. Should we split at all?
 * 2. If yes, how many segments?
 * 3. How should each segment be formatted and timed?
 */
export class UtterancePlanner {
  /**
   * Create a delivery plan for a raw LLM reply
   */
  makePlan(rawReply: string, options: UtterancePlanOptions): UtterancePlan {
    const trimmed = rawReply.trim();
    const length = trimmed.length;
    logger.debug(
      'utterance',
      `Planning delivery: ${length} chars, verbosity=${options.persona.verbosity ?? 0.5}`,
    );

    // Get persona preferences with defaults
    const verbosity = options.persona.verbosity ?? 0.5;
    const multiPref = options.persona.multiUtterancePreference ?? 0.3;

    // Step 1: Decide if we should split at all
    if (this.shouldSendAsSingle(length, verbosity, multiPref, options.isAtReply)) {
      logger.debug('utterance', 'Sending as single message');
      return {
        segments: [
          {
            text: trimmed,
            delayMs: 0,
            importance: 'main',
          },
        ],
      };
    }

    // Step 2: Split into sentences (keeping punctuation for now)
    const sentences = this.splitIntoSentences(trimmed);

    // Step 3: Decide how many segments to send (2-4 typically)
    const targetSegments = this.decideSegmentCount(sentences, length, verbosity, multiPref);
    logger.debug(
      'utterance',
      `Splitting into ${targetSegments} segments (${sentences.length} sentences)`,
    );

    // Step 4: Group sentences into segments
    const groupedSegments = this.groupSentences(sentences, targetSegments);

    // Step 5: Create final segments with humanized text and delays
    const segments: UtteranceSegment[] = groupedSegments.map((group, idx, arr) => ({
      text: this.humanizeSegmentText(group, idx === arr.length - 1),
      delayMs: this.getSegmentDelay(idx, arr.length, verbosity),
      importance: idx === 0 ? 'main' : idx === arr.length - 1 ? 'side' : 'extra',
    }));

    logger.info(
      'utterance',
      `Plan ready: ${segments.length} segments, total delay: ${segments.reduce((s, u) => s + u.delayMs, 0)}ms`,
    );
    return { segments };
  }

  /**
   * Decide if we should send as a single message
   */
  private shouldSendAsSingle(
    length: number,
    verbosity: number,
    multiPref: number,
    isAtReply: boolean,
  ): boolean {
    // Very short: always single
    if (length <= 40) return true;

    // Short-medium: send as single if low verbosity
    if (length <= 80 && verbosity < 0.5) return true;

    // Medium: send as single if very low verbosity or low multi-preference
    if (length <= 150 && (verbosity < 0.2 || multiPref < 0.2)) return true;

    // @ replies can be slightly longer before splitting
    if (isAtReply && length <= 120 && verbosity < 0.6) return true;

    // Otherwise consider splitting
    return false;
  }

  /**
   * Split text into sentences (keeping punctuation)
   */
  private splitIntoSentences(text: string): string[] {
    // First split on major sentence boundaries
    const sentences = text
      .split(/(?<=[。！？!?\n])/u)
      .map((s) => s.trim())
      .filter(Boolean);

    // Second pass: split long sentences on commas
    const result: string[] = [];
    for (const sentence of sentences) {
      if (sentence.length > 40) {
        // Split on commas for long sentences
        const subParts = sentence
          .split(/(?<=[，,])/u)
          .map((s) => s.trim())
          .filter(Boolean);
        result.push(...subParts);
      } else {
        result.push(sentence);
      }
    }

    return result;
  }

  /**
   * Decide how many segments to create (2-4 typically)
   */
  private decideSegmentCount(
    sentences: string[],
    totalLength: number,
    verbosity: number,
    multiPref: number,
  ): number {
    // If only 1-2 sentences, don't over-split
    if (sentences.length <= 2) return sentences.length;

    // Base decision on length and preferences
    if (totalLength < 150) {
      return Math.min(2, sentences.length);
    }

    if (totalLength < 250) {
      return multiPref > 0.5 ? Math.min(3, sentences.length) : Math.min(2, sentences.length);
    }

    // Long replies: up to 4 segments if highly verbose
    if (verbosity > 0.7 && multiPref > 0.6) {
      return Math.min(4, sentences.length);
    }

    return Math.min(3, sentences.length);
  }

  /**
   * Group sentences into N segments
   */
  private groupSentences(sentences: string[], targetCount: number): string[] {
    if (sentences.length <= targetCount) {
      return sentences;
    }

    // Simple grouping: distribute sentences evenly
    const groups: string[] = [];
    const sentencesPerGroup = Math.ceil(sentences.length / targetCount);

    for (let i = 0; i < targetCount; i++) {
      const start = i * sentencesPerGroup;
      const end = Math.min(start + sentencesPerGroup, sentences.length);
      const group = sentences.slice(start, end).join('');
      if (group) groups.push(group);
    }

    return groups;
  }

  /**
   * Humanize segment text - remove ending punctuation for non-last segments
   */
  private humanizeSegmentText(text: string, isLast: boolean): string {
    const trimmed = text.trim();

    if (isLast) {
      // Last segment: keep ending punctuation (looks more formal/complete)
      return trimmed;
    }

    // Non-last segments: remove ending sentence punctuation
    // This makes it feel more like casual chat
    return trimmed.replace(/[。！？!?]+$/u, '');
  }

  /**
   * Get delay for a segment (in milliseconds)
   */
  private getSegmentDelay(index: number, totalSegments: number, verbosity: number): number {
    // First segment: no delay (sent immediately after LLM response)
    if (index === 0) return 0;

    // Base delay: 400-900ms
    const baseMin = 400;
    const baseMax = 900;

    // More verbose personas take slightly longer pauses
    const verbosityFactor = 1 + verbosity * 0.3;

    // Add some randomness
    const randomDelay = baseMin + Math.random() * (baseMax - baseMin);

    return Math.floor(randomDelay * verbosityFactor);
  }
}
