// ============================================================
// js/enemies.js — 敌人表 + 随机怪生成（Fate_echo Phase 2 + Phase 5 F3）
// NEW_GAME.md §4.1 初稿 12 种：
//   普通（6）：1-2 技能、低血低伤
//   精英（4）：3~5 技能、含瞬发、有机制（dot 免疫/狂暴+自爆/吸血）
//   Boss（2）：5 技能、阶段转换（enragePct 半血狂暴）、领域技
// 技能定义：'s01' 等 id 从 SKILLS_DB 原样取；内联对象为"效果数据同源"
//   （复用 EFFECT_TYPES）的定制技能（如吸血：伤害 + 治疗效果）
// 数值缩放（§4.3 初稿 ⚠️）：HP = baseHp × 等级^1.15；ATK = baseAtk × 等级^0.9
// 契约：普通敌人技能表不含 ogcd（§2.1 瞬发槽仅精英/Boss 有，ogcd 会浪费）
// ---- Phase 5 F3：敌方随机生成（照抄末光 Monster 类 engine.js:921-947）----
//   随机名字池（普通怪 8 名池）、Boss 守卫者头衔（"第N层守卫者"→轮次语义）、
//   数值随机浮动（±15%，对应末光"等级±5 波动"的肉鸽起伏）、随机怪
//   createRandomEnemy 从同 tier 12 模板借用技能/机制（增强不简化）；
//   模板 createEnemy 默认行为不变（回归精确断言依赖）
// ============================================================

import { CombatUnit } from './unit.js';
import { skillData } from './setup.js';

// 等级缩放指数（§4.3 初稿 ⚠️ 待平衡）
export const HP_EXP = 1.15;
export const ATK_EXP = 0.9;

// 精英/Boss 基础法力（技能 cost 支撑）
const TIER_MP = { normal: 100, elite: 150, boss: 300 };

export const ENEMIES_DB = [
  // ---- 普通（数值初稿 ⚠️：baseHp 按 Lv1 玩家（100HP/攻10）可单挑下调） ----
  { id: 'e01', name: '史莱姆', tier: 'normal', baseHp: 45, baseAtk: 6, baseInt: 4, skills: ['s01'], desc: '黏糊糊的软体生物，只会弹跳撞击。' },
  { id: 'e02', name: '丛林之狼', tier: 'normal', baseHp: 55, baseAtk: 6, baseInt: 5, skills: ['s03', 's17'], desc: '群居的掠食者，星尘咏叹与神圣惩击。' },
  { id: 'e03', name: '骷髅士兵', tier: 'normal', baseHp: 60, baseAtk: 6, baseInt: 4, skills: ['s01', 's17'], desc: '不死的骸骨，挥剑时夹杂神圣惩击。' },
  { id: 'e04', name: '哥布林法师', tier: 'normal', baseHp: 45, baseAtk: 6, baseInt: 10, skills: ['s03', 's10'], desc: '偷学的法术，星尘咏叹与月火术。' },
  { id: 'e05', name: '石像鬼', tier: 'normal', baseHp: 95, baseAtk: 6, baseInt: 6, skills: ['s06', 's02'], desc: '坚硬的雕像守卫，冰霜与光辉护甲护体。' },
  { id: 'e06', name: '腐化树精', tier: 'normal', baseHp: 70, baseAtk: 6, baseInt: 6, skills: ['s04', 's19'], desc: '被腐蚀的古树，诅咒与再生并存。' },
  // ---- 精英（数值初稿 ⚠️） ----
  { id: 'e07', name: '暗影刺客', tier: 'elite', baseHp: 120, baseAtk: 11, baseInt: 8, skills: ['s25', 's26', 's18'], desc: '来去无踪的杀手：混沌箭、暗影裂隙与死亡标记。' },
  { id: 'e08', name: '冰霜巨人', tier: 'elite', baseHp: 190, baseAtk: 12, baseInt: 8, enragePct: 0.5, skills: ['s06', 's27', 's32', 's26', 's40'], desc: '半血狂暴，绝境献祭（自爆）：龙破斩与灵魂献祭。' },
  { id: 'e09', name: '瘟疫祭司', tier: 'elite', baseHp: 125, baseAtk: 9, baseInt: 12, dotImmune: true, skills: ['s04', 's36', 's19', 's07'], desc: '免疫持续伤害：痛苦诅咒、灾厄降临，靠黑暗契约续力。' },
  { id: 'e10', name: '虚空猎手', tier: 'elite', baseHp: 135, baseAtk: 10, baseInt: 10, skills: ['s08', 's20', 'e10_vamp', 's30'], desc: '噬咬吸取生命：虚空箭、血晶爆发与虚空噬咬。' },
  // ---- Boss（数值初稿 ⚠️） ----
  { id: 'e11', name: '深渊领主', tier: 'boss', baseHp: 330, baseAtk: 14, baseInt: 14, enragePct: 0.5, skills: ['s09', 's25', 's40', 's16', 's48'], desc: '半血狂暴，绝境献祭，展开虚空领域。' },
  { id: 'e12', name: '时空支配者', tier: 'boss', baseHp: 310, baseAtk: 13, baseInt: 16, enragePct: 0.5, skills: ['s39', 's44', 's46', 's30', 's50'], desc: '扭曲时空：终焉咏叹调、法则解构与烈焰领域。' },
];

// 内联定制技能（效果数据同源：复用 EFFECT_TYPES，validateSkillsDB 契约约束）
const CUSTOM_SKILLS = {
  // 虚空噬咬：1.6 倍伤害 + 恢复 150% 攻击力生命（吸血机制）
  e10_vamp: { id: 'e10_vamp', name: '虚空噬咬', reqLv: 1, type: 'gcd', cd: 8000, cost: 15, dmgMult: 1.6, priority: 12, effects: [{ type: 'heal', val: 1.5 }] },
};

// 敌人数据解析：技能 id → SKILLS_DB 数据；未知 id → 内联表
function resolveSkill(skillRef) {
  if (skillRef && typeof skillRef === 'object') return skillRef;
  return skillData(skillRef) || CUSTOM_SKILLS[skillRef] || null;
}

// 按等级创建敌人（§4.3 缩放）
export function createEnemy(enemyId, level = 1, opts = {}) {
  const def = ENEMIES_DB.find((e) => e.id === enemyId);
  if (!def) throw new TypeError(`未知敌人 id: ${enemyId}`);
  const lv = Math.max(1, Number(level) || 1);
  const hp = Math.round(def.baseHp * Math.pow(lv, HP_EXP));
  const atk = Math.round(def.baseAtk * Math.pow(lv, ATK_EXP));
  const mp = (opts.mp !== undefined ? opts.mp : TIER_MP[def.tier]);
  const unit = new CombatUnit({
    name: opts.name || def.name,
    hp, maxHp: hp,
    mp, maxMp: mp,
    atk, def: 0,
    int: def.baseInt,
    level: lv,
    critChance: 0.05,
    dotImmune: !!def.dotImmune,
  });
  const skills = def.skills.map(resolveSkill).filter(Boolean);
  return { unit, skills, meta: { id: def.id, tier: def.tier, enragePct: def.enragePct, dotImmune: !!def.dotImmune, desc: def.desc } };
}

// 全部敌人定义（遍历/校验用）
export function allEnemies() {
  return ENEMIES_DB.map((d) => ({ ...d, skills: d.skills.map(resolveSkill).filter(Boolean) }));
}

// ---- Phase 5 F3：随机怪生成（照抄末光 Monster 类 engine.js:921-947）----

// 普通/精英随机名池（末光 4 名池原样 + 扩展 4 个；精英 50% 保留模板名维持威压感）
export const RANDOM_NAMES = ['异界聚合体', '深空魔晶', '虚空猎犬', '暗影游荡者', '噬魂蝠', '岩甲兽', '迷雾幽影', '青铜魔偶'];

// Boss 守卫者头衔（照抄末光 `👿 【领主】第N层守卫者·LvX`；N 映射 Fate_echo 轮次 depth）
export function bossTitle(depth, level) {
  return `👿 【领主】第${Math.max(1, depth)}轮守卫者·Lv${Math.max(1, level)}`;
}

// 随机浮动系数（0.85 ~ 1.15；对应末光"等级±5 波动"的肉鸽起伏——
//   Fate_echo 等级由 enemyLevelFor 公式化，波动改在数值层，保留 §4.3 缩放；
//   clamp 防越界 rng（病理注入 rng()≥1 时 mult 不超 1.15））
export function randomMult(rng) {
  const v = Math.min(1, Math.max(0, rng()));
  return 0.85 + v * 0.3;
}

// 随机怪：同 tier 12 模板借用技能/机制（技能体系/AI 打分保留），
//   名字随机（普通/精英随机池 or 模板名）、数值 ±15% 浮动；
//   Boss 套守卫者头衔（照抄末光 Boss 规则）。rng 可注入（测试确定性）。
//   索引一律 clamp：越界 rng（≥1 或 <0）不产生 undefined 名/越界模板。
export function createRandomEnemy({ rng = Math.random, level = 1, depth = 1, tier = 'normal' } = {}) {
  // 非法 tier 容错（回退 normal；与 createEnemy 未知 id 抛错不同——随机层应更宽容）
  const safeTier = ENEMIES_DB.some((e) => e.tier === tier) ? tier : 'normal';
  const pool = ENEMIES_DB.filter((e) => e.tier === safeTier);
  const base = pool[Math.min(pool.length - 1, Math.floor(Math.min(1, Math.max(0, rng())) * pool.length))] || ENEMIES_DB[0];
  const lv = Math.max(1, Number(level) || 1);
  const mult = randomMult(rng);
  const hp = Math.round(base.baseHp * Math.pow(lv, HP_EXP) * mult);
  const atk = Math.round(base.baseAtk * Math.pow(lv, ATK_EXP) * mult);
  const mp = TIER_MP[safeTier] || 100;
  const isBoss = tier === 'boss';
  // 名字：Boss → 守卫者头衔（含 Lv）；普通/精英 → 随机池 or 模板名（末光格式 名字·LvX）
  const rawName = isBoss
    ? bossTitle(depth, lv)
    : (rng() < 0.5 ? base.name : RANDOM_NAMES[Math.min(RANDOM_NAMES.length - 1, Math.floor(Math.min(1, Math.max(0, rng())) * RANDOM_NAMES.length))]);
  const name = isBoss ? rawName : `${rawName}·Lv${lv}`;
  const unit = new CombatUnit({
    name,
    hp, maxHp: hp,
    mp, maxMp: mp,
    atk, def: 0,
    int: base.baseInt,
    level: lv,
    critChance: 0.05,
    dotImmune: !!base.dotImmune,
  });
  const skills = base.skills.map(resolveSkill).filter(Boolean);
  return {
    unit,
    skills,
    meta: { id: base.id, tier: safeTier, enragePct: base.enragePct, dotImmune: !!base.dotImmune, desc: base.desc, random: true },
  };
}
