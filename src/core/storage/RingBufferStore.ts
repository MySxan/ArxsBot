/**
 * RingBufferStore: 为每个群/私聊维护一个 ring buffer（最近 N 条消息）
 *
 * 特性：
 * - 内存 + 持久化双存储
 * - 自动淘汰旧消息
 * - 按 key (platform:groupId) 隔离
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { ChatMessage } from './types.js';
import { config } from '../../infra/config/config.js';
import { createLogger } from '../../infra/logger/logger.js';

const logger = createLogger(config);

export interface RingBufferConfig {
  maxSize: number; // 每个 buffer 最多存多少条
  persistDir?: string; // 持久化目录（可选）
}

export class RingBufferStore {
  private buffers = new Map<string, ChatMessage[]>();
  private config: Required<RingBufferConfig>;

  constructor(config: RingBufferConfig = { maxSize: 50 }) {
    this.config = {
      maxSize: config.maxSize,
      persistDir: config.persistDir || './data/ring-buffers',
    };
  }

  /**
   * 初始化存储（加载持久化数据）
   */
  async initialize(): Promise<void> {
    logger.info('Storage', `Initializing ring buffers at ${this.config.persistDir}`);
    await fs.mkdir(this.config.persistDir, { recursive: true });

    // 加载已存在的 buffer 文件
    try {
      const files = await fs.readdir(this.config.persistDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const key = file.replace('.json', '').replace(/_/g, ':');
          const filePath = path.join(this.config.persistDir, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const messages = JSON.parse(content) as ChatMessage[];
          this.buffers.set(key, messages);
        }
      }
      logger.info('Storage', `Loaded ${this.buffers.size} ring buffers`);
    } catch (error) {
      // 目录不存在或读取失败，跳过
      logger.debug('Storage', 'No existing ring buffers found, starting fresh');
    }
  }

  /**
   * 构建存储 key
   */
  private buildKey(platform: string, groupId: string): string {
    return `${platform}:${groupId}`;
  }

  /**
   * 追加消息到 ring buffer
   */
  async append(message: ChatMessage): Promise<void> {
    const key = this.buildKey(message.platform, message.groupId);

    // 获取或创建 buffer
    let buffer = this.buffers.get(key);
    if (!buffer) {
      buffer = [];
      this.buffers.set(key, buffer);
      logger.debug('Storage', `Created new ring buffer for ${key}`);
    }

    // 追加消息
    buffer.push(message);

    // 超过容量时，移除最旧的消息
    if (buffer.length > this.config.maxSize) {
      const removed = buffer.shift();
      logger.debug(
        'Storage',
        `Ring buffer ${key} overflow: removed oldest message (${removed?.userId})`,
      );
    }

    // 持久化（异步，不阻塞）
    this.persist(key, buffer).catch(() => {
      // 持久化失败不影响内存操作
    });
  }

  /**
   * 获取最近 N 条消息
   */
  getRecent(platform: string, groupId: string, limit?: number): ChatMessage[] {
    const key = this.buildKey(platform, groupId);
    const buffer = this.buffers.get(key) || [];

    if (limit === undefined || limit >= buffer.length) {
      return [...buffer]; // 返回副本
    }

    return buffer.slice(-limit);
  }

  /**
   * 获取所有消息
   */
  getAll(platform: string, groupId: string): ChatMessage[] {
    return this.getRecent(platform, groupId);
  }

  /**
   * 清空指定 buffer
   */
  async clear(platform: string, groupId: string): Promise<void> {
    const key = this.buildKey(platform, groupId);
    this.buffers.delete(key);

    // 删除持久化文件
    const fileName = key.replace(/:/g, '_') + '.json';
    const filePath = path.join(this.config.persistDir, fileName);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      // 文件不存在，忽略
    }
  }

  /**
   * 持久化 buffer 到磁盘
   */
  private async persist(key: string, buffer: ChatMessage[]): Promise<void> {
    const fileName = key.replace(/:/g, '_') + '.json';
    const filePath = path.join(this.config.persistDir, fileName);
    const content = JSON.stringify(buffer, null, 2);
    await fs.writeFile(filePath, content, 'utf-8');
  }

  /**
   * 获取统计信息
   */
  getStats(): { totalBuffers: number; totalMessages: number } {
    let totalMessages = 0;
    for (const buffer of this.buffers.values()) {
      totalMessages += buffer.length;
    }
    return {
      totalBuffers: this.buffers.size,
      totalMessages,
    };
  }
}
