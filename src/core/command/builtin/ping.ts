import type { CommandHandler } from '../types.js';

/**
 * Ping command - simple health check
 */
export const PingCommand: CommandHandler = {
  name: 'ping',
  aliases: ['pong'],
  description: '测试机器人是否在线',

  async run({ event, sender }) {
    const latency = Date.now() - event.timestamp;
    await sender.sendText(event.groupId, `pong! ${latency}ms`);
  },
};
