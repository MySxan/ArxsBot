import type { CommandHandler } from '../types.js';

/**
 * Debug command - show internal state and diagnostics
 */
export const DebugCommand: CommandHandler = {
  name: 'debug',
  aliases: ['状态', 'status'],
  description: '显示机器人内部状态',

  async run({ event, sender }) {
    const now = new Date();
    const uptime = process.uptime();
    const memUsage = process.memoryUsage();

    const debugInfo = `🔧 调试信息

⏰ 时间：${now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
📊 运行时长：${Math.floor(uptime / 60)}分${Math.floor(uptime % 60)}秒
💾 内存使用：${Math.round(memUsage.heapUsed / 1024 / 1024)}MB / ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB

📨 消息信息：
- 平台：${event.platform}
- 群组：${event.groupId}
- 用户：${event.userId}
- 消息ID：${event.messageId}
- @机器人：${event.mentionsBot ? '是' : '否'}

📝 消息内容：
${event.rawText.substring(0, 100)}${event.rawText.length > 100 ? '...' : ''}`;

    await sender.sendText(event.groupId, debugInfo);
  },
};
