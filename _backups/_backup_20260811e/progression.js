// ============================================================
// js/progression.js — 玩家成长系统（Fate_echo Phase 4）
// NEW_GAME.md §5/§9：
//   经验曲线：末光 3 段式（<60 级 100×1.15^(lv-1)；61-100 级 100×100×1.20^(lv-60)；
//     >100 级 100×5000×1.15^(lv-100)；base=100，浮点 floor）
//   每级成长：HP +35 / 攻击 +8 / 防御 +5 / 暴击 +1%（初值 HP100/攻10/防10/
//     暴击5%/急速0/共鸣0；def 参与减伤公式，不成长——末光统一"防御力"）
//   技能解锁：reqLv ≤ 等级（SKILLS_DB 全表）
// 玩家战斗单位由 makeBattlePlayer 构建（等级属性 + 装备 + 解锁技能）
// ============================================================

import { SKILLS_DB } from './data.js';
import { CombatUnit } from './unit.js';
import { applyEquipmentToUnit, calcOrbBonus, finaleCollectionComplete } from './equipment.js';
import { collectionBonus } from './collections.js';

// 每级成长（§9 初稿 ⚠️ 待平衡）
export const GROWTH = { hp: 35, atk: 8, def: 5, crit: 1 }; // crit 单位：百分点

// 玩家基础属性（Level 1，§9；def 含原 int 初值 10，统一为防御力）
export const PLAYER_BASE = { hp: 100, mp: 100, atk: 10, def: 10, critChance: 0.05 };

// 经验曲线（末光咏叹 getExpReq 照抄：三段式——60 级前 1.15、61-100 级 1.20、100 级后 1.15，
//   防止高等级升级绝对停滞；base=100）
export function expToLevel(level) {
  const lv = Math.max(1, level);
  const base = 100;
  if (lv < 60) return Math.floor(base * Math.pow(1.15, lv - 1));
  if (lv < 100) return Math.floor(base * 100 * Math.pow(1.20, lv - 60));
  return Math.floor(base * 5000 * Math.pow(1.15, lv - 100));
}

// 公式化属性（单一数据源：等级 → 基础属性；HP 可加点体系未来在此扩展 🔲）
export function playerStatsAt(level) {
  const lv = Math.max(1, Math.floor(level) || 1);
  const n = lv - 1; // 成长级数
  return {
    hp: PLAYER_BASE.hp + n * GROWTH.hp,
    mp: PLAYER_BASE.mp,
    atk: PLAYER_BASE.atk + n * GROWTH.atk,
    def: PLAYER_BASE.def + n * GROWTH.def,
    critChance: PLAYER_BASE.critChance + n * (GROWTH.crit / 100), // 每级 +1 百分点
  };
}

// 按等级解锁的技能数据（reqLv ≤ level；含被动）
export function unlockedSkillData(level) {
  return SKILLS_DB.filter((s) => s.reqLv <= Math.max(1, level));
}

// 技能配置（局外技能配置面板，2026-08-11）：
//   loadout = { regular: [skillId ≤5], finale: [skillId ≤3] } ｜ null = 全部解锁（默认）
//   常规组 = 非终焉技能（gcd/buff/dot/debuff/domain/ogcd 混合）；终焉组 = 终焉 15 个
//   （desc 含 [终焉]）；被动始终保留（不参与配置）；id 不存在自动忽略，乱序无碍
//   5/3 上限由配置面板 UI 守卫（添加时拒绝），本函数不截断（null→全选路径可超限，
//   与"全部解锁"现状行为一致）
export function applySkillLoadout(skills, loadout) {
  if (!loadout || !Array.isArray(loadout.regular) && !Array.isArray(loadout.finale)) return skills;
  const selectedRegular = new Set(Array.isArray(loadout.regular) ? loadout.regular : []);
  const selectedFinale = new Set(Array.isArray(loadout.finale) ? loadout.finale : []);
  return skills.filter((s) => {
    if (s && s.type === 'passive') return true;                     // 被动常驻（终焉之力）
    if (s && /\[终焉\]/.test(s.desc || '')) return selectedFinale.has(s.id); // 终焉组
    return selectedRegular.has(s.id);                               // 常规组
  });
}

// 构建玩家战斗单位（等级属性 + 装备加成 + 宝珠加成 + 终焉图鉴集齐加成 + 满状态）
// 返回 { unit, skills }（与 engine 构造格式一致）
export function makeBattlePlayer(state) {
  const lv = Math.max(1, Math.floor(state.player.level) || 1);
  const stats = playerStatsAt(lv);
  const unit = new CombatUnit({
    name: '旅人',
    level: lv,
    hp: stats.hp, maxHp: stats.hp,
    mp: stats.mp, maxMp: stats.mp,
    atk: stats.atk,
    def: stats.def,
    critChance: stats.critChance,
  });
  applyEquipmentToUnit(unit, state.player.equipment);
  // 宝珠加成（末光 calcOrbBonus：同类上限 3；hp_pct/atk_pct 乘算、versa/crit 加算）
  const orb = calcOrbBonus(state.player);
  if (orb.hp_pct > 0) {
    unit.maxHp = Math.floor(unit.maxHp * (1 + orb.hp_pct / 100));
    unit.hp = Math.min(unit.maxHp, unit.hp);
  }
  if (orb.atk_pct > 0) unit.atk = Math.floor(unit.atk * (1 + orb.atk_pct / 100));
  if (orb.versa > 0) unit.buffs.push({ key: 'orb:versa', stat: 'versa', val: orb.versa, turns: Infinity });
  if (orb.crit > 0) unit.critChance = Math.min(1, unit.critChance + orb.crit / 100);
  unit.finaleCdReduction = orb.finale_cd; // 终焉回响：终焉技能冷却缩减 %（engine 施放时应用）
  // 收藏品 + 终焉图鉴：统一挂永久 buff（机制统一，2026-08-11）
  //   来源分别挂载（col:/finale:），乘算按旧顺序逐项 floor——数值逐位不变；
  //   buffs 中 hp_pct/atk_pct 仅供 makeBattlePlayer 乘算读取与 UI 展示，statBonus 不处理
  const col = collectionBonus(state.player);
  const finaleComplete = finaleCollectionComplete(state.player);
  const hpBuffs = [
    ...(col.hp_pct > 0 ? [{ key: 'col:hp', stat: 'hp_pct', val: col.hp_pct }] : []),
    ...(finaleComplete ? [{ key: 'finale:hp', stat: 'hp_pct', val: 10 }] : []), // 终焉全套：最大生命 +10%
  ];
  const atkBuffs = [
    ...(col.atk_pct > 0 ? [{ key: 'col:atk', stat: 'atk_pct', val: col.atk_pct }] : []),
    ...(finaleComplete ? [{ key: 'finale:atk', stat: 'atk_pct', val: 10 }] : []), // 终焉全套：攻击 +10%
  ];
  for (const b of hpBuffs) {
    unit.buffs.push({ ...b, turns: Infinity });
    unit.maxHp = Math.floor(unit.maxHp * (1 + b.val / 100));
    unit.hp = Math.min(unit.maxHp, unit.hp);
  }
  for (const b of atkBuffs) {
    unit.buffs.push({ ...b, turns: Infinity });
    unit.atk = Math.floor(unit.atk * (1 + b.val / 100));
  }
  if (col.crit > 0) unit.critChance = Math.min(1, unit.critChance + col.crit / 100);
  if (col.versa > 0) unit.buffs.push({ key: 'col:versa', stat: 'versa', val: col.versa, turns: Infinity }); // 共鸣之石：永久增伤
  return { unit, skills: applySkillLoadout(unlockedSkillData(lv), state.player.skillLoadout) };
}

// 结算经验：返回 { leveledUp, levelsGained, expLeft }
// state.player: { level, exp }（exp 为当前等级内累计）
export function grantExp(player, exp) {
  const gain = Math.max(0, Math.floor(exp) || 0);
  player.exp = (player.exp || 0) + gain;
  let levelsGained = 0;
  while (player.exp >= expToLevel(player.level)) {
    player.exp -= expToLevel(player.level);
    player.level++;
    levelsGained++;
  }
  return { leveledUp: levelsGained > 0, levelsGained, expLeft: player.exp };
}
