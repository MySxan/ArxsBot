import type { CommandHandler } from '../types.js';
import type { ConversationStore } from '../../memory/ConversationStore.js';

/**
 * Prompts command - show last used prompts for LLM generation
 */
export const PromptsCommand: CommandHandler = {
  name: 'prompts',
  aliases: ['/prompts'],
  description: '查看上一次生成时使用的最终拼接prompts',

  async run({ event, sender, router }) {
    // Assume router.llmPromptHistory stores the last used prompt string
    const promptHistory = (router as any).llmPromptHistory as string[] | undefined;
    if (!promptHistory || promptHistory.length === 0) {
      await sender.sendText(event.groupId, '没有找到最近的 prompts 记录。');
      return;
    }
    // Show the last prompt (or all if needed)
    const lastPrompt = promptHistory[promptHistory.length - 1];
    await sender.sendText(event.groupId, `\n${lastPrompt}`);
  },
};
