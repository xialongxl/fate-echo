// ============================================================
// js/events.js — 塔内随机事件（Fate_echo Phase 4）
// 纯函数 + rng：文字描述 + 选项，选项副作用由调用方（main.js）执行
// 事件类型：宝箱（装备/金币）、神秘雕像（祈祷：回满/金币/受伤）、
//   陷阱房（小心通过/强行突破）、篝火（休息恢复）
// 数值初稿 ⚠️ 待平衡
// ============================================================

import { rollEquipment, GEAR_RARITY } from './equipment.js';

export const EVENT_TYPES = ['chest', 'statue', 'trap', 'campfire'];

// 随机事件生成：{ type, title, desc, options: [{id, label, hint}] }
// 选项结果由 resolveEvent(state, type, optionId, rng) 计算（可测试）
export function rollEvent(rng = Math.random) {
  const type = EVENT_TYPES[Math.floor(rng() * EVENT_TYPES.length)];
  switch (type) {
    case 'chest':
      return {
        type,
        title: '🪙 尘封宝箱',
        desc: '角落里的宝箱散发着微光……打开它？',
        options: [
          { id: 'open', label: '打开宝箱', hint: '获得装备或金币' },
          { id: 'leave', label: '离开', hint: '什么也不发生' },
        ],
      };
    case 'statue':
      return {
        type,
        title: '🗿 神秘雕像',
        desc: '一座古老的雕像注视着你的方向。向它祈祷？',
        options: [
          { id: 'pray', label: '祈祷', hint: '命运眷顾或捉弄' },
          { id: 'leave', label: '无视离开', hint: '什么也不发生' },
        ],
      };
    case 'trap':
      return {
        type,
        title: '⚠ 陷阱走廊',
        desc: '地板上布满机关痕迹。如何通过？',
        options: [
          { id: 'careful', label: '小心通过', hint: '低概率受伤，可能发现金币' },
          { id: 'rush', label: '强行突破', hint: '高概率受伤，但可能获得更多金币' },
        ],
      };
    case 'campfire':
    default:
      return {
        type,
        title: '🔥 静谧篝火',
        desc: '一团篝火安静地燃烧，正好歇歇脚。',
        options: [
          { id: 'rest', label: '休息', hint: '恢复 40% 生命' },
          { id: 'leave', label: '继续赶路', hint: '什么也不发生' },
        ],
      };
  }
}

// 事件结算：返回 { text, state 变更建议 }——直接修改 state（player），
// 返回给 UI 的播报文本数组
// state: { player: {hp, mp, gold, inventory, ...} }（与存档结构一致）
// maxHp：由玩家等级派生（存档不存 maxHp），调用方传入
export function resolveEvent(state, type, optionId, { rng = Math.random, maxHp = 100 } = {}) {
  const p = state.player;
  const lines = [];
  switch (type) {
    case 'chest': {
      if (optionId !== 'open') return ['你绕开了宝箱。'];
      if (rng() < 0.5) {
        // 装备按塔层生成（v2 生成器；进背包由调用方/玩家手动穿戴）
        const eq = rollEquipment(rng, { floor: (state.tower && state.tower.floor) || 1, depth: (state.tower && state.tower.depth) || 1 });
        if (p.inventory) p.inventory.push(eq);
        else { p.inventory = [eq]; }
        lines.push(`宝箱里是【${eq.name}】（${GEAR_RARITY[eq.rarityIdx].name}）评分 ${eq.score}！已收入背包。`);
      } else {
        const gold = 30 + Math.floor(rng() * 40);
        p.gold += gold;
        lines.push(`宝箱里是 ${gold} 金币！`);
      }
      return lines;
    }
    case 'statue': {
      if (optionId !== 'pray') return ['雕像沉默不语，你离开了。'];
      const roll = rng();
      if (roll < 0.4) {
        p.hp = Math.min(maxHp, p.hp + Math.round(maxHp * 0.5));
        lines.push('雕像泛起柔光：恢复 50% 生命。');
      } else if (roll < 0.7) {
        const gold = 40 + Math.floor(rng() * 60);
        p.gold += gold;
        lines.push(`雕像的基座裂开：${gold} 金币滚落而出！`);
      } else {
        p.hp = Math.max(1, p.hp - Math.round(maxHp * 0.15));
        lines.push('雕像发出尖啸：你受到 15% 生命的伤害！');
      }
      return lines;
    }
    case 'trap': {
      const careful = optionId === 'careful';
      const hurtChance = careful ? 0.2 : 0.5;
      if (rng() < hurtChance) {
        const dmg = Math.round(maxHp * (careful ? 0.1 : 0.2));
        p.hp = Math.max(1, p.hp - dmg);
        lines.push(`机关触发！你受到 ${dmg} 点伤害。`);
      } else {
        const gold = careful ? 20 + Math.floor(rng() * 20) : 40 + Math.floor(rng() * 40);
        p.gold += gold;
        lines.push(`你安全穿过，捡到 ${gold} 金币！`);
      }
      return lines;
    }
    case 'campfire':
    default: {
      if (optionId !== 'rest') return ['你继续赶路。'];
      const heal = Math.round(maxHp * 0.4);
      p.hp = Math.min(maxHp, p.hp + heal);
      lines.push(`篝火温暖了身体：恢复 ${heal} 生命。`);
      return lines;
    }
  }
}
