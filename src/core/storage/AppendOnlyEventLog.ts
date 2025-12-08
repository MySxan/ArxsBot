/**
 * AppendOnlyEventLog: 原封不动保存所有事件到本地（用于备份和debug）
 *
 * 特性：
 * - 只追加，不修改
 * - 按日期分文件（便于管理和清理）
 * - JSONL 格式（每行一个JSON对象，便于流式读取）
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { ChatMessage } from './types.js';
import { config } from '../../infra/config/config.js';
import { createLogger } from '../../infra/logger/logger.js';

const logger = createLogger(config);

export class AppendOnlyEventLog {
  private logDir: string;

  constructor(logDir: string = './data/event-logs') {
    this.logDir = logDir;
  }

  /**
   * 初始化日志目录
   */
  async initialize(): Promise<void> {
    logger.info('Storage', `Initializing event log at ${this.logDir}`);
    await fs.mkdir(this.logDir, { recursive: true });
  }

  /**
   * 追加事件到日志文件
   */
  async append(message: ChatMessage): Promise<void> {
    // 按日期分文件：YYYY-MM-DD.jsonl
    const date = new Date(message.timestamp);
    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
    const logFile = path.join(this.logDir, `${dateStr}.jsonl`);

    // JSONL 格式：每行一个 JSON 对象
    const line = JSON.stringify(message) + '\n';

    // 追加写入（性能优化：可以考虑批量写入）
    try {
      await fs.appendFile(logFile, line, 'utf-8');
      logger.debug('Storage', `Appended message to ${dateStr}.jsonl`);
    } catch (error) {
      logger.error(
        'Storage',
        `Failed to append to event log: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }

  /**
   * 读取指定日期的所有事件（用于 debug）
   */
  async readByDate(date: string): Promise<ChatMessage[]> {
    const logFile = path.join(this.logDir, `${date}.jsonl`);

    try {
      const content = await fs.readFile(logFile, 'utf-8');
      const lines = content.trim().split('\n');
      return lines.map((line) => JSON.parse(line) as ChatMessage);
    } catch (error) {
      // 文件不存在或读取失败
      return [];
    }
  }

  /**
   * 列出所有日志文件
   */
  async listLogFiles(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.logDir);
      return files.filter((f) => f.endsWith('.jsonl')).sort();
    } catch (error) {
      return [];
    }
  }

  /**
   * 清理旧日志（保留最近 N 天）
   */
  async cleanup(keepDays: number = 30): Promise<number> {
    const files = await this.listLogFiles();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - keepDays);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    let deletedCount = 0;
    for (const file of files) {
      const dateStr = file.replace('.jsonl', '');
      if (dateStr < cutoffStr) {
        await fs.unlink(path.join(this.logDir, file));
        deletedCount++;
      }
    }

    return deletedCount;
  }
}
