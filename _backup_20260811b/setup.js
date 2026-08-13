// ============================================================
// js/setup.js — 演示/测试配置（Fate_echo）
// 玩家初始属性（NEW_GAME.md §9：HP 100/攻击 10/防御 0/暴击 5%/急速 0/共鸣 0；
// 法力未定 → 100 ⚠️ 待平衡）与新手技能组。
// 注意：正式玩家构建走 js/progression.js makeBattlePlayer（等级+装备+按级解锁）；
//       本文件仅供 demo_battle 与旧测试使用（Phase 4 后保持兼容）。
// ============================================================

import { SKILLS_DB } from './data.js';
import { CombatUnit } from './unit.js';

// 新手技能组：覆盖 主技能/瞬发/dot/治疗/易伤/条件终焉/被动 全部机制
export const STARTER_SKILLS = ['s01', 's03', 's04', 's05', 's07', 's13', 's18', 's45', 's_passive_01'];

export function starterSkillData() {
  return STARTER_SKILLS.map((id) => SKILLS_DB.find((s) => s.id === id)).filter(Boolean);
}

export function makePlayer(opts = {}) {
  return new CombatUnit({
    name: '旅人',
    hp: 100, maxHp: 100,
    mp: 100, maxMp: 100, // ⚠️ 最大法力初值待平衡
    atk: 10, def: 0, int: 10,
    level: 1, critChance: 0.05,
    ...opts,
  });
}

// 按 id 取技能数据（测试/UI 用）
export function skillData(id) {
  return SKILLS_DB.find((s) => s.id === id);
}
