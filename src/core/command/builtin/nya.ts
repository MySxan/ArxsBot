import type { CommandHandler } from '../types.js';
import { DefaultPersona, NyaPersona } from '../../persona/PersonaTypes.js';

/**
 * Nya command - toggle between default and nya persona
 */
export const NyaCommand: CommandHandler = {
  name: 'nya',
  aliases: [],
  description: '切换猫娘模式 (on/off)',

  async run({ event, sender, args, router }) {
    if (!router?.replyer) {
      await sender.sendText(event.groupId, '未配置回复生成器');
      return;
    }

    const action = args[0]?.toLowerCase();

    if (action === 'on') {
      router.replyer.setPersona(NyaPersona);
      router.replyer.switchToNyaModel();
      await sender.sendText(event.groupId, '喵~');
    } else if (action === 'off') {
      router.replyer.setPersona(DefaultPersona);
      router.replyer.switchToDefaultModel();
      await sender.sendText(event.groupId, '已切换回默认模式');
    } else {
      const current = router.replyer.getPersona();
      await sender.sendText(
        event.groupId,
        `当前人格：${current.name}\n使用 /nya on 或 /nya off 切换`,
      );
    }
  },
};
