/**
 * @file PromptBuilder 类用于构建对话中的各种提示和约束
 */
import type { Persona } from '../persona/PersonaTypes.js';
import type { PlanResult } from '../planner/types.js';
import type { ChatTurn } from '../memory/ConversationStore.js';
import type { ReplyContext } from '../context/ContextBuilder.js';
import { config } from '../../infra/config/config.js';
import { createLogger } from '../../infra/logger/logger.js';

const logger = createLogger(config);

/**
 * 动态风格参数（BehaviorPlanner）
 */
export interface DynamicStyleParams {
  toneMod?: 'casual' | 'teasing' | 'serious' | 'lazy' | 'cold'; // 语气修饰
  maxLength?: number; // 回复长度上限
  slangLevel?: number; // 网络用语程度 0-1
  intimacyLevel?: number; // 亲密度 0-1
  energyLevel?: number; // 精力水平 0-1
}

/**
 * 长期记忆摘要
 */
export interface LongTermMemory {
  userPreferences?: string[]; // 用户偏好/习惯
  pastFacts?: string[]; // 用户提到过的事实
  relationship?: string; // 关系描述
}

export class PromptBuilder {
  private escapeNewlines(text: string): string {
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\\n');
  }

  private ensureAtYouPrefix(text: string, enabled: boolean): string {
    if (!enabled) return text;
    const t = text.trimStart();
    if (t.startsWith('@你')) return text;
    return `@你 ${text}`;
  }

  private formatTurnLine(turn: ChatTurn): string {
    const name = turn.role === 'bot' ? '你' : turn.userName || turn.userId || '某人';
    const content = this.ensureAtYouPrefix(this.escapeNewlines(turn.content), Boolean(turn.mentionsBot));
    return `${name}: ${content}`;
  }

  /**
   * 构建固定语言约束
   */
  private buildLanguageConstraints(personaConstraints?: string): string {
    const lines = ['语言约束：禁止AI腔/讲大道理/格式化/分点/括号动作'];
    if (personaConstraints) {
      lines.push(`角色约束：${personaConstraints}`);
    }
    return lines.join('\n');
  }

  /**
   * 构建动态风格提示
   */
  private buildDynamicStylePrompt(params: DynamicStyleParams): string {
    const tags: string[] = [];
    if (params.toneMod) tags.push(`tone=${params.toneMod}`);
    if (params.slangLevel != null) tags.push(`slang=${params.slangLevel.toFixed(2)}`);
    if (params.intimacyLevel != null) tags.push(`intimacy=${params.intimacyLevel.toFixed(2)}`);
    return tags.length ? `[STYLE] ${tags.join('; ')}` : '';
  }

  /**
   * 构建角色人格提示
   */
  private buildPersonaPrompt(persona: Persona): string {
    return [
      `你是 ${persona.name}，${persona.description}`,
      `\n`,
      `人设风格：`,
      persona.tone,
    ].join();
  }

  /**
   * 构建长期记忆摘要（压缩标签格式）
   */
  private buildLongTermMemory(memory?: LongTermMemory): string {
    if (!memory) return '';

    const facts: string[] = [];
    if (memory.relationship) facts.push(`rel=${memory.relationship}`);
    if (memory.userPreferences?.length) {
      facts.push(`likes=${memory.userPreferences.join('/')}`);
    }
    if (memory.pastFacts?.length) {
      facts.push(`facts=${memory.pastFacts.join('；')}`);
    }

    return facts.length > 0 ? `[MEMORY] ${facts.join(';')}` : '';
  }

  /**
   * 构建 System Prompt
   */
  buildSystem(persona: Persona): string {
    const lines = [
      `你是 ${persona.name}${persona.description ? '，' + persona.description : ''}`,
      `人设风格：${persona.tone}`,
      `语言约束：禁止AI腔、讲大道理、格式化、分点、括号动作`,
    ];

    // 添加 persona 额外约束
    if (persona.constraints) {
      lines.push(`角色约束：${persona.constraints}`);
    }

    return lines.join('\n');
  }

  /**
   * 构建最终 prompts
   */
  buildMessages(
    systemPrompt: string,
    replyContext: ReplyContext,
    dynamicStyle: DynamicStyleParams,
    longTermMemory: LongTermMemory | undefined,
    currentUserName: string,
    currentUserMessage: string,
  ): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    const targetName = replyContext.targetTurn?.userName || currentUserName;
    const targetMessage = replyContext.targetTurn?.content || currentUserMessage;
    const allTurns = replyContext.recentTurns;

    // 最后一次 bot 回复的位置
    let lastBotIndex = -1;
    for (let i = allTurns.length - 1; i >= 0; i -= 1) {
      if (allTurns[i].role === 'bot') {
        lastBotIndex = i;
        break;
      }
    }

    // 上下文 [HISTORICAL]/[NEW_WINDOW]
    const contextLines: string[] = [];

    if (lastBotIndex === -1) {
      // 没有bot说过话，全部为 NEW_WINDOW
      contextLines.push('[NEW_WINDOW]');
      for (const turn of allTurns) {
        contextLines.push(this.formatTurnLine(turn));
      }
    } else {
      // 有bot说过话，分两个区间
      const historicalStartIndex = Math.max(0, lastBotIndex - 5);

      // [HISTORICAL]
      // We intentionally take the 5 turns BEFORE the last bot message (exclude bot turn itself).
      contextLines.push('[HISTORICAL]');
      for (let i = historicalStartIndex; i < lastBotIndex; i += 1) {
        const turn = allTurns[i];
        contextLines.push(this.formatTurnLine(turn));
      }

      // [NEW_WINDOW]
      if (lastBotIndex + 1 < allTurns.length) {
        contextLines.push('[NEW_WINDOW]');
        for (let i = lastBotIndex + 1; i < allTurns.length; i += 1) {
          const turn = allTurns[i];
          contextLines.push(this.formatTurnLine(turn));
        }
      }
    }

    const contextBlock = contextLines.join('\n');

    // [TARGET]
    const targetMentions = Boolean(replyContext.targetTurn?.mentionsBot);
    const safeTargetMessage = this.ensureAtYouPrefix(
      this.escapeNewlines(targetMessage),
      targetMentions,
    );
    const targetBlock = `[TARGET]\n${targetName || '对方'}: ${safeTargetMessage}`;

    // 组装 user message
    const sections: string[] = [];

    // 动态风格
    const styleLine = this.buildDynamicStylePrompt(dynamicStyle);
    if (styleLine) sections.push(styleLine);

    // 话题摘要
    if (replyContext.topicSummary) {
      sections.push(`[SUMMARY] ${replyContext.topicSummary}`);
    }

    // 长期记忆
    const memoryLine = this.buildLongTermMemory(longTermMemory);
    if (memoryLine) sections.push(memoryLine);

    // 上下文（无历史时不添加标签）
    if (contextBlock) {
      sections.push(contextBlock);
    }

    // 目标消息
    sections.push(targetBlock);

    // 明确指令
    sections.unshift(
      `[INSTRUCTION]
- 只针对 [TARGET] 生成回复
- 可以参考 [HISTORICAL] 和 [NEW_WINDOW] 理解背景，其中的昵称只应用于识别用户身份
- 优先遵守 [STYLE] 中的风格
- 如果多条 [NEW_WINDOW] 是连续话题，可以在一条回复里同时回应多个点，不必一句对一句
- 如果觉得这一轮适合分成多条消息发，可以用 <brk> 作为分条分隔符（最多3条）
- 只输出要发到群里的内容，不要换行/分段`,
    );

    const fullUserMessage = sections.join('\n\n');

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: fullUserMessage },
    ];
  }
}
