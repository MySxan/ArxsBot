/**
 * MessageFilter: 规则过滤器 + 标签打标
 *
 * 功能：
 * 1. 垃圾过滤（短文本、纯表情等）
 * 2. 智能标签打标（7 种标签）
 * 3. 决定是否需要摘要 + embedding
 */

import type { ChatMessage, FilterResult } from './types.js';
import { config } from '../../infra/config/config.js';
import { createLogger } from '../../infra/logger/logger.js';

const logger = createLogger(config);

/**
 * 标签权重配置（用于后续淘汰策略）
 */
export const TAG_WEIGHTS: Record<string, number> = {
  'q.ask': 0.8, // 问题
  'resource.link': 1.0, // 资源链接（最高价值）
  'event.time': 0.9, // 时间事件
  'fact.numeric': 0.7, // 数字事实
  emotion: 0.3, // 情绪表达
  'bot.related': 0.6, // @机器人
  'self.disclosure': 0.8, // 人设信息
  general: 0.5, // 普通消息
};

export class MessageFilter {
  /**
   * 判断消息是否值得 embedding + 打标签
   */
  shouldEmbed(message: ChatMessage): FilterResult {
    const text = message.rawText.trim();
    const tags: string[] = [];

    logger.debug(
      'Filter',
      `Filtering message from ${message.userId}: "${text.length > 30 ? text.substring(0, 30) + '...' : text}"`,
    );

    // === 垃圾过滤 ===

    // 规则 1: 过短的消息（<3 字符）
    if (text.length < 3) {
      return {
        shouldEmbed: false,
        reason: 'Too short',
        tags: [],
        confidence: 0.95,
        needsSummary: false,
      };
    }

    // 规则 2: 纯表情或符号
    if (
      /^[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\s!！?？。.,，]+$/u.test(text)
    ) {
      return {
        shouldEmbed: false,
        reason: 'Only emoji/punctuation',
        tags: [],
        confidence: 0.95,
        needsSummary: false,
      };
    }

    // 规则 3: 重复文本（"哈哈哈", "啊啊啊"）
    if (/^(.)\1{4,}$/.test(text) || /^([\u4e00-\u9fa5]{1,2})\1{3,}$/.test(text)) {
      tags.push('emotion');
      return {
        shouldEmbed: false,
        reason: 'Repetitive emotion',
        tags,
        confidence: 0.9,
        needsSummary: false,
      };
    }

    // === 标签检测（7 种） ===

    // 1. q.ask - 问题
    if (/[？?]/.test(text) || /(怎么|为什么|为啥|咋|谁知道|有人有|有没有|求|帮忙)/.test(text)) {
      tags.push('q.ask');
    }

    // 2. resource.link - 资源链接
    if (/https?:\/\//.test(text) || /(视频|文件|PDF|链接|网址|网站|repo|github)/.test(text)) {
      tags.push('resource.link');
    }

    // 3. event.time - 时间事件
    if (
      /(今天|明天|昨天|下周|上午|下午|晚上|\d{1,2}[点:]\d{0,2}|周[一二三四五六日])/.test(text) ||
      /\d{4}[-/年]\d{1,2}[-/月]\d{1,2}[日号]?/.test(text)
    ) {
      tags.push('event.time');
    }

    // 4. fact.numeric - 数字事实（>3 位、金额、分数）
    if (/\d{3,}/.test(text) || /(\d+(\.\d+)?[元块分¥$])|(\d+分|\d+\.\d+分|GPA|绩点)/.test(text)) {
      tags.push('fact.numeric');
    }

    // 5. emotion - 情绪（重复字符、哭笑表情）
    if (/[哈嘿嘻呜哇啊]{3,}/.test(text) || /[😭😂🤣😢😅😆🥺😨😱]{2,}/.test(text)) {
      tags.push('emotion');
    }

    // 6. bot.related - 真实@事件（@bot自己）
    if (message.mentionsBot) {
      tags.push('bot.related');
    }

    // 7. self.disclosure - 人设信息
    if (/(我|俺|本人).*(挂科|过了|拿到|录取|offer|实习|工作|辞职|分手|恋爱)/.test(text)) {
      tags.push('self.disclosure');
    }

    // === 决策逻辑 ===

    // 高价值标签：直接存储 + 需要摘要
    if (
      tags.includes('resource.link') ||
      tags.includes('event.time') ||
      tags.includes('self.disclosure')
    ) {
      logger.info('Filter', `Accepted (HIGH): ${tags.join(', ')} - summary needed`);
      return {
        shouldEmbed: true,
        reason: `High-value tags: ${tags.join(', ')}`,
        tags,
        confidence: 0.9,
        needsSummary: true, // 高价值内容需要摘要
      };
    }

    // 中等价值标签：存储 + 可选摘要
    if (tags.includes('q.ask') || tags.includes('fact.numeric') || tags.includes('bot.related')) {
      logger.info('Filter', `Accepted (MED): ${tags.join(', ')} - summary: ${text.length > 20}`);
      return {
        shouldEmbed: true,
        reason: `Medium-value tags: ${tags.join(', ')}`,
        tags,
        confidence: 0.7,
        needsSummary: text.length > 20, // 长文本才摘要
      };
    }

    // 仅情绪标签：不存储
    if (tags.includes('emotion') && tags.length === 1) {
      logger.debug('Filter', 'Rejected: Only emotion, no content');
      return {
        shouldEmbed: false,
        reason: 'Only emotion, no content',
        tags,
        confidence: 0.8,
        needsSummary: false,
      };
    }

    // 普通消息（>15 字）：存储但不摘要
    if (text.length >= 15) {
      logger.info(
        'Filter',
        `Accepted (LOW): ${tags.length > 0 ? tags.join(', ') : 'general'} - no summary`,
      );
      return {
        shouldEmbed: true,
        reason: 'Normal message with sufficient length',
        tags: tags.length > 0 ? tags : ['general'],
        confidence: 0.6,
        needsSummary: false, // 普通消息直接用原文
      };
    }

    // 其他：不存储
    logger.debug('Filter', `Rejected: Low value (${text.length} chars, tags: ${tags.join(', ')})`);
    return {
      shouldEmbed: false,
      reason: 'Low value: short and no special tags',
      tags,
      confidence: 0.7,
      needsSummary: false,
    };
  }

  /**
   * 获取标签权重（用于后续淘汰策略）
   */
  getTagWeight(tags: string[]): number {
    if (tags.length === 0) return 0.5; // 默认权重

    const weights = tags.map((tag) => TAG_WEIGHTS[tag] || 0.5);
    return Math.max(...weights); // 取最高权重
  }
}
