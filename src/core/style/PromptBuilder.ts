/**
 * PromptBuilder: 负责根据行为规划、个性、记忆等参数生成最终 System Prompt
 * 职责:组装固定约束 + 动态参数 → 结构化 System Prompt
 */
import type { Persona } from '../persona/types.js';
import type { PlanResult } from '../planner/types.js';
import type { ChatTurn } from '../memory/ConversationStore.js';
import type { ReplyContext } from '../context/ContextBuilder.js';
import { config } from '../../infra/config/config.js';
import { createLogger } from '../../infra/logger/logger.js';

const logger = createLogger(config);

/**
 * 动态风格参数（由 BehaviorPlanner 提供）
 */
export interface DynamicStyleParams {
  toneMod?: 'casual' | 'teasing' | 'serious' | 'lazy' | 'cold'; // 语气修饰
  maxLength?: number; // 回复长度上限
  slangLevel?: number; // 网络用语程度 0-1
  intimacyLevel?: number; // 亲密度 0-1（影响是否可以调侃）
  energyLevel?: number; // 精力水平 0-1（影响回复积极性）
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
  /**
   * 构建固定语言约束（写死，不随场景变化）
   */
  private buildLanguageConstraints(personaConstraints?: string): string {
    const baseConstraints = [
      `# 语言约束`,
      `- 禁止AI腔：不能说"作为一个AI"、"我理解你的感受"、"根据你的描述"`,
      `- 禁止讲大道理、不能说教`,
      `- 禁止格式化：不分点列举、不用括号动作描写`,
      `- 必须单句回复：不换行、不分段`,
    ];

    if (personaConstraints) {
      baseConstraints.push(`- 角色约束：${personaConstraints}`);
    }

    return baseConstraints.join('\n');
  }

  /**
   * 构建动态风格提示（根据 Planner 参数生成）
   */
  private buildDynamicStylePrompt(params: DynamicStyleParams): string {
    const parts: string[] = [];

    // 语气修饰
    if (params.toneMod === 'lazy') parts.push('语气敷衍随意');
    else if (params.toneMod === 'teasing') parts.push('带点坏笑调侃');
    else if (params.toneMod === 'serious') parts.push('认真一点');
    else if (params.toneMod === 'cold') parts.push('冷淡简短');

    // 长度限制
    if (params.maxLength) parts.push(`不超过${params.maxLength}字`);

    // 网络用语程度
    if (params.slangLevel && params.slangLevel > 0.5) {
      parts.push('多用网络梗和口语');
    } else if (params.slangLevel && params.slangLevel < 0.3) {
      parts.push('少用网络梗');
    }

    // 亲密度影响
    if (params.intimacyLevel && params.intimacyLevel > 0.7) {
      parts.push('可以随意调侃');
    } else if (params.intimacyLevel && params.intimacyLevel < 0.3) {
      parts.push('保持礼貌距离');
    }

    return parts.length > 0 ? `\n# 当前风格\n${parts.join('，')}` : '';
  }

  /**
   * 构建角色人格提示
   */
  private buildPersonaPrompt(persona: Persona): string {
    return [
      `# 角色设定`,
      `你是 ${persona.name}，${persona.description}`,
      ``,
      `# 基础说话风格`,
      persona.tone,
    ].join('\n');
  }

  /**
   * 构建长期记忆摘要
   */
  private buildLongTermMemory(memory?: LongTermMemory): string {
    if (!memory) return '';

    const parts: string[] = [];
    if (memory.relationship) parts.push(`关系：${memory.relationship}`);
    if (memory.userPreferences?.length) {
      parts.push(`偏好：${memory.userPreferences.join('、')}`);
    }
    if (memory.pastFacts?.length) {
      parts.push(`记得：${memory.pastFacts.join('；')}`);
    }

    return parts.length > 0 ? `\n# 长期记忆\n${parts.join('\n')}` : '';
  }

  /**
   * 组合完整 System Prompt（标准顺序）
   * 注意：不再包含即时上下文，上下文由 buildMessages() 单独处理
   */
  build(
    persona: Persona,
    dynamicStyle: DynamicStyleParams,
    replyContext?: ReplyContext,
    longTermMemory?: LongTermMemory,
  ): string {
    const parts = [
      this.buildPersonaPrompt(persona),
      this.buildLanguageConstraints(persona.constraints),
      this.buildDynamicStylePrompt(dynamicStyle),
    ];

    // 添加话题摘要（如果有）
    if (replyContext?.topicSummary) {
      parts.push(`\n# 最近对话情况\n${replyContext.topicSummary}`);
    }

    // 添加长期记忆（如果有）
    if (longTermMemory) {
      parts.push(this.buildLongTermMemory(longTermMemory));
    }

    return parts.filter(Boolean).join('\n');
  }

  /**
   * 构建完整的 LLM Messages 数组（包含 system + history + current user message）
  /**
   * 构建完整的 LLM Messages 数组（包含 system + history + current user message）
   * 这里是"怎么喂"：上下文在 prompt 里长什么样
   */
  buildMessages(
    systemPrompt: string,
    replyContext: ReplyContext,
    currentUserName: string,
    currentUserMessage: string,
  ): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    return [
      { role: 'system', content: systemPrompt },
      // 上下文部分：使用智能选择的 recentTurns
      ...replyContext.recentTurns.map((turn) => ({
        role: turn.role === 'user' ? ('user' as const) : ('assistant' as const),
        content:
          turn.role === 'user'
            ? `【${turn.userName || turn.userId || '群友'}】${turn.content}`
            : turn.content,
      })),
      // 当前这条
      { role: 'user', content: `【${currentUserName}】${currentUserMessage}` },
    ];
  }
}
