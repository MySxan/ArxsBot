import type { ChatEvent } from '../events/ChatEvent.js';
import type { MessageSender } from '../messaging/MessageSender.js';
import type { CommandHandler } from './types.js';
import type { Logger } from '../../infra/logger/logger.js';

/**
 * Routes command messages to appropriate handlers
 */
export class CommandRouter {
  private commandMap: Map<string, CommandHandler> = new Map();
  private router?: any;

  isRegistered(name: string): boolean {
    return this.commandMap.has(name.toLowerCase());
  }

  tryParse(rawText: string): { name: string; args: string[]; prefix: '/' | '!' } | null {
    const text = rawText.trim();
    if (!text) return null;

    const first = text[0];
    if (first !== '/' && first !== '!' && first !== '！') return null;

    const prefix: '/' | '!' = first === '/' ? '/' : '!';

    const body = text.slice(1).trim();
    if (!body) return null;

    const parts = body.split(/\s+/);
    const name = parts[0].toLowerCase();
    const args = parts.slice(1);

    if (!this.isRegistered(name)) return null;
    return { name, args, prefix };
  }

  constructor(
    private sender: MessageSender,
    private logger: Logger,
    commands: CommandHandler[],
    router?: any,
  ) {
    this.router = router;
    // Register all commands and their aliases
    for (const cmd of commands) {
      this.commandMap.set(cmd.name, cmd);
      if (cmd.aliases) {
        for (const alias of cmd.aliases) {
          this.commandMap.set(alias, cmd);
        }
      }
    }

    this.logger.info('command-router', `Registered ${commands.length} commands`);
  }

  /**
   * Handle a command event
   */
  async handle(event: ChatEvent): Promise<void> {
    const text = event.rawText.trim();

    // Parse command: "/ping arg1 arg2" → name="ping", args=["arg1", "arg2"]
    const [cmdToken, ...args] = text.split(/\s+/);
    const name = cmdToken.replace(/^[/！]/, ''); // Remove / or ！ prefix

    // Find handler
    const handler = this.commandMap.get(name);
    if (!handler) {
      this.logger.warn('command-router', `Unknown command: ${name}`);
      await this.sender.sendText(event.groupId, `未知指令：${name}\n使用 /help 查看可用命令`);
      return;
    }

    // Execute command
    try {
      this.logger.info(
        'command-router',
        `Executing command: /${name} (args: ${args.length}, from ${event.userId})`,
      );
      await handler.run({
        event,
        args,
        sender: this.sender,
        router: this.router,
      });
      this.logger.debug('command-router', `Command /${name} completed`);
    } catch (error) {
      this.logger.error(
        'command-router',
        `Command ${name} failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      await this.sender.sendText(event.groupId, `指令执行失败：${name}`);
    }
  }

  /**
   * Get all registered command names
   */
  getCommandNames(): string[] {
    const names = new Set<string>();
    for (const cmd of this.commandMap.values()) {
      names.add(cmd.name);
    }
    return Array.from(names);
  }
}
