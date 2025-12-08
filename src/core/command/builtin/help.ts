import type { CommandHandler } from '../types.js';

/**
 * Help command - show available commands
 */
export const HelpCommand: CommandHandler = {
  name: 'help',
  aliases: ['h', '帮助'],
  description: '显示所有可用命令',

  async run({ event, sender }) {
    const helpText = `可用命令：
  /ping - 测试机器人是否在线
  /help - 显示此帮助信息
  /debug - 显示调试信息
  /context - 显示当前群的对话历史和成员统计
  /prompts - 查看上一次生成时使用的最终拼接prompts

  提示：
  - 使用 @ 提及我来聊天
  - 命令可以用 / 或 ！ 开头`;

    await sender.sendText(event.groupId, helpText);
  },
};
