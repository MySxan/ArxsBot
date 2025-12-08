/**
 * Split human-like text into natural utterance chunks
 *
 * Splits on sentence boundaries (。！？!?\n) first,
 * then for longer parts, splits on commas (，,)
 *
 * Example:
 * "你好啊！我是机器人。最近天气不错，太阳很充足。"
 * => ["你好啊！", "我是机器人。", "最近天气不错，", "太阳很充足。"]
 */
export function splitHumanLike(text: string): string[] {
  // First split on sentence boundaries (Chinese and English)
  const sentences = text
    .split(/(?<=[。！？!?\n])/u)
    .map((s) => s.trim())
    .filter(Boolean);

  const result: string[] = [];

  for (const sentence of sentences) {
    // If a sentence is too long (>30 chars), split on commas
    if (sentence.length > 30) {
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
 * Get a random delay between min and max milliseconds
 * (for simulating human typing pauses)
 */
export function getRandomDelay(minMs: number = 500, maxMs: number = 1200): number {
  return minMs + Math.random() * (maxMs - minMs);
}
