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

export const ENEMIES_DB = [
  // ---- 普通（数值初稿 ⚠️：baseHp 按 Lv1 玩家（100HP/攻10）可单挑下调） ----
  { id: 'e01', name: '史莱姆', tier: 'normal', baseHp: 45, baseAtk: 6, baseDef: 4, skills: ['en_撞击'], desc: '黏糊糊的软体生物，只会弹跳撞击。' },
  { id: 'e02', name: '丛林之狼', tier: 'normal', baseHp: 55, baseAtk: 6, baseDef: 5, skills: ['en_撕裂', 'en_圣击'], desc: '群居的掠食者，利爪撕裂与骸骨圣击。' },
  { id: 'e03', name: '骷髅士兵', tier: 'normal', baseHp: 60, baseAtk: 6, baseDef: 4, skills: ['en_撞击', 'en_圣击'], desc: '不死的骸骨，挥剑时夹杂圣击。' },
  { id: 'e04', name: '哥布林法师', tier: 'normal', baseHp: 45, baseAtk: 6, baseDef: 10, skills: ['en_撕裂', 'en_月灼'], desc: '偷学的法术，利爪撕裂与幽月灼烧。' },
  { id: 'e05', name: '石像鬼', tier: 'normal', baseHp: 95, baseAtk: 6, baseDef: 6, skills: ['en_冰封', 'en_石肤'], desc: '坚硬的雕像守卫，冰霜爪击与硬化石肤护体。' },
  { id: 'e06', name: '腐化树精', tier: 'normal', baseHp: 70, baseAtk: 6, baseDef: 6, skills: ['en_腐毒', 'en_再生'], desc: '被腐蚀的古树，腐化毒液与腐木再生并存。' },
  // ---- 精英（数值初稿 ⚠️） ----
  { id: 'e07', name: '暗影刺客', tier: 'elite', baseHp: 120, baseAtk: 11, baseDef: 8, skills: ['en_混沌箭', 'en_裂隙', 'en_标记'], desc: '来去无踪的杀手：混沌箭雨、暗影裂隙与死亡标记。' },
  { id: 'e08', name: '冰霜巨人', tier: 'elite', baseHp: 190, baseAtk: 12, baseDef: 8, enragePct: 0.5, skills: ['en_冰封', 'en_寒枪', 'en_龙破', 'en_裂隙', 'en_献祭'], desc: '半血狂暴，绝境献祭（自爆）：巨龙斩击与灵魂献祭。' },
  { id: 'e09', name: '瘟疫祭司', tier: 'elite', baseHp: 125, baseAtk: 9, baseDef: 12, dotImmune: true, skills: ['en_腐毒', 'en_灾厄', 'en_再生', 'en_愈合'], desc: '免疫持续伤害：腐化毒液、灾厄降临，靠黑暗愈合续力。' },
  { id: 'e10', name: '虚空猎手', tier: 'elite', baseHp: 135, baseAtk: 10, baseDef: 10, skills: ['en_蚀箭', 'en_血爆', 'en_噬咬', 'en_慰言'], desc: '噬咬吸取生命：虚空蚀箭、血晶爆发与虚空噬咬。' },
  // ---- Boss（数值初稿 ⚠️） ----
  { id: 'e11', name: '深渊领主', tier: 'boss', baseHp: 330, baseAtk: 14, baseDef: 14, enragePct: 0.5, skills: ['en_炎噬', 'en_混沌箭', 'en_献祭', 'en_灭杀', 'en_虚空领域'], desc: '半血狂暴，绝境献祭，展开虚空领域。' },
  { id: 'e12', name: '时空支配者', tier: 'boss', baseHp: 310, baseAtk: 13, baseDef: 16, enragePct: 0.5, skills: ['en_咏叹调', 'en_法则', 'en_魔阵', 'en_慰言', 'en_烈焰领域'], desc: '扭曲时空：终焉咏叹调、法则解构与烈焰领域。' },
];

// ---- 敌人独立技能池（2026-08-11 用户定案：敌人技能 = 敌人技能，不复用玩家技能）----
// 27 个独立技能（en_ 前缀）；效果机制复用 EFFECT_HANDLERS（机制层共享）；
// Boss 大招保留 [终焉] 标记（敌人侧终焉独占 = 主行动后跳过瞬发）；
// desc 简写（isFinale 判定用 [终焉] 标记）
export const ENEMY_SKILLS = {
  // ---- 普通 ----
  en_撞击: { id: 'en_撞击', name: '弹跳撞击', reqLv: 1, type: 'gcd', cd: 0, dmgMult: 1.0, priority: 1, desc: '[主技能] 弹跳撞击，造成{dmgMult}%攻击力伤害。' },
  en_撕裂: { id: 'en_撕裂', name: '利爪撕裂', reqLv: 1, type: 'gcd', cd: 0, dmgMult: 1.8, priority: 5, desc: '[主技能] 利爪撕裂，造成{dmgMult}%攻击力伤害。' },
  en_圣击: { id: 'en_圣击', name: '骸骨圣击', reqLv: 1, type: 'gcd', cd: 0, dmgMult: 1.2, priority: 2, desc: '[主技能] 骸骨圣击，造成{dmgMult}%攻击力伤害。' },
  en_月灼: { id: 'en_月灼', name: '幽月灼烧', reqLv: 1, type: 'dot', cd: 0, dmgMult: 1.0, effects: [{ type: 'dot', dur: 4, dps: 1.0, stateName: '灼烧', stateEmoji: '🔥' }], priority: 8, desc: '[DoT] 造成{dmgMult}%攻击力伤害并灼烧4层。' },
  en_冰封: { id: 'en_冰封', name: '冰霜爪击', reqLv: 1, type: 'gcd', cd: 0, dmgMult: 2.2, priority: 6, desc: '[主技能] 冰霜爪击，造成{dmgMult}%攻击力伤害。' },
  en_石肤: { id: 'en_石肤', name: '硬化石肤', reqLv: 1, type: 'buff', cd: 0, dmgMult: 0, effects: [{ type: 'buff', stat: 'versa', val: 10, dur: 6 }], priority: 9, desc: '[Buff] 提升共鸣10%，持续6层。' },
  en_腐毒: { id: 'en_腐毒', name: '腐化毒液', reqLv: 1, type: 'dot', cd: 0, dmgMult: 0.5, effects: [{ type: 'dot', dur: 5, dps: 0.8, stateName: '恶咒', stateEmoji: '☠️' }], priority: 8, desc: '[DoT] 造成{dmgMult}%攻击力伤害并腐蚀5层。' },
  en_再生: { id: 'en_再生', name: '腐木再生', reqLv: 1, type: 'buff', cd: 0, dmgMult: 0, effects: [{ type: 'hot', pct: 0.03, dur: 6 }], priority: 12, desc: '[治疗] 每层恢复3%最大生命。' }, // hot pct 0.03 = 3%/层（desc 硬编码，不用 {dur} 模板——dur=6 是层数非百分比）
  // ---- 精英 ----
  en_混沌箭: { id: 'en_混沌箭', name: '混沌箭雨', reqLv: 1, type: 'gcd', cd: 0, dmgMult: 6.5, priority: 7, desc: '[主技能] 混沌箭雨，造成{dmgMult}%攻击力伤害。' },
  en_裂隙: { id: 'en_裂隙', name: '暗影裂隙', reqLv: 1, type: 'ogcd', cd: 0, dmgMult: 4.5, priority: 11, desc: '[瞬发] 暗影裂隙，造成{dmgMult}%攻击力伤害。' },
  en_标记: { id: 'en_标记', name: '死亡标记', reqLv: 1, type: 'debuff', cd: 0, dmgMult: 0, effects: [{ type: 'vuln', val: 1.2, dur: 4 }], priority: 15, desc: '[Debuff] 死亡标记：受击伤害提高4层。' },
  en_寒枪: { id: 'en_寒枪', name: '寒冰长枪', reqLv: 1, type: 'gcd', cd: 0, dmgMult: 1.8, priority: 4, desc: '[主技能] 寒冰长枪，造成{dmgMult}%攻击力伤害。' },
  en_龙破: { id: 'en_龙破', name: '巨龙斩击', reqLv: 1, type: 'gcd', cd: 0, dmgMult: 8.0, priority: 7, desc: '[主技能] 巨龙斩击，造成{dmgMult}%攻击力伤害。' },
  en_灾厄: { id: 'en_灾厄', name: '灾厄降临', reqLv: 1, type: 'dot', cd: 0, dmgMult: 0.8, effects: [{ type: 'dot', dur: 4, dps: 1.5, stateName: '灾厄', stateEmoji: '💀' }], priority: 8, desc: '[DoT] 造成{dmgMult}%攻击力伤害并施加灾厄4层。' },
  en_愈合: { id: 'en_愈合', name: '黑暗愈合', reqLv: 1, type: 'ogcd', cd: 0, dmgMult: 0, effects: [{ type: 'heal', val: 2.0 }], priority: 12, desc: '[治疗] 黑暗愈合，恢复自身生命。' },
  en_蚀箭: { id: 'en_蚀箭', name: '虚空蚀箭', reqLv: 1, type: 'gcd', cd: 0, dmgMult: 1.5, priority: 4, desc: '[主技能] 虚空蚀箭，造成{dmgMult}%攻击力伤害。' },
  en_血爆: { id: 'en_血爆', name: '血晶爆发', reqLv: 1, type: 'gcd', cd: 0, dmgMult: 2.8, priority: 5, desc: '[主技能] 血晶爆发，造成{dmgMult}%攻击力伤害。' },
  en_噬咬: { id: 'en_噬咬', name: '虚空噬咬', reqLv: 1, type: 'gcd', cd: 0, dmgMult: 1.6, effects: [{ type: 'heal', val: 1.5 }], priority: 12, desc: '[主技能] 虚空噬咬，造成{dmgMult}%攻击力伤害并吸取生命。' },
  en_慰言: { id: 'en_慰言', name: '虚空慰言', reqLv: 1, type: 'ogcd', cd: 0, dmgMult: 2.0, priority: 11, desc: '[瞬发] 虚空慰言，造成{dmgMult}%攻击力伤害。' },
  // ---- Boss ----
  en_炎噬: { id: 'en_炎噬', name: '烈焰噬咬', reqLv: 1, type: 'gcd', cd: 0, dmgMult: 5.0, priority: 7, desc: '[主技能] 烈焰噬咬，造成{dmgMult}%攻击力伤害。' },
  en_灭杀: { id: 'en_灭杀', name: '湮灭低语', reqLv: 1, type: 'ogcd', cd: 0, dmgMult: 3.5, priority: 11, desc: '[瞬发] 湮灭低语，造成{dmgMult}%攻击力伤害。' },
  en_献祭: { id: 'en_献祭', name: '灵魂献祭', reqLv: 1, type: 'gcd', cd: 0, dmgMult: 0, effects: [{ type: 'hp_sacrifice', costPct: 0.5, dmgMult: 20 }], priority: 17, desc: '[终焉][主技能] 献祭当前生命 50%，对敌人造成巨额伤害。' },
  en_虚空领域: { id: 'en_虚空领域', name: '虚空领域', reqLv: 1, type: 'domain', cd: 0, dmgMult: 0, effects: [{ type: 'domain', dur: 5, dps: 5.0, domainType: 'void', stateName: '虚空领域', stateEmoji: '🌌' }], priority: 18, desc: '[终焉][领域] 展开虚空领域，每层造成500%伤害。' },
  en_咏叹调: { id: 'en_咏叹调', name: '终焉咏叹调', reqLv: 1, type: 'gcd', cd: 0, dmgMult: 6.5, priority: 17, desc: '[终焉][主技能] 终焉咏叹调，造成{dmgMult}%攻击力伤害。' },
  en_法则: { id: 'en_法则', name: '法则解构', reqLv: 1, type: 'debuff', cd: 0, dmgMult: 0, effects: [{ type: 'vuln', val: 1.5, dur: 6 }], priority: 17, desc: '[终焉][Debuff] 法则解构：受击伤害大幅提高6层。' },
  en_魔阵: { id: 'en_魔阵', name: '无限魔阵', reqLv: 1, type: 'buff', cd: 0, dmgMult: 0, effects: [{ type: 'buff', stat: 'versa', val: 50, dur: 8 }], priority: 18, desc: '[终焉][Buff] 无限魔阵：提升共鸣8层。' },
  en_烈焰领域: { id: 'en_烈焰领域', name: '烈焰领域', reqLv: 1, type: 'domain', cd: 0, dmgMult: 0, effects: [{ type: 'domain', dur: 5, dps: 5.0, domainType: 'flame', stateName: '烈焰领域', stateEmoji: '🔥' }], priority: 18, desc: '[终焉][领域] 展开烈焰领域，每层造成500%伤害。' },
};

// 敌人数据解析：优先查 ENEMY_SKILLS（敌人独立技能池）；对象内联直接返回；
// 回退 SKILLS_DB（测试用玩家技能验证敌人逻辑的兼容路径）
function resolveSkill(skillRef) {
  if (skillRef && typeof skillRef === 'object') return skillRef;
  return ENEMY_SKILLS[skillRef] || skillData(skillRef) || null;
}

// 按等级创建敌人（§4.3 缩放）
export function createEnemy(enemyId, level = 1, opts = {}) {
  const def = ENEMIES_DB.find((e) => e.id === enemyId);
  if (!def) throw new TypeError(`未知敌人 id: ${enemyId}`);
  const lv = Math.max(1, Number(level) || 1);
  const hp = Math.round(def.baseHp * Math.pow(lv, HP_EXP));
  const atk = Math.round(def.baseAtk * Math.pow(lv, ATK_EXP));
  const unit = new CombatUnit({
    name: opts.name || def.name,
    hp, maxHp: hp,
    mp: 0, maxMp: 0, // MP 已删（2026-08-11）：敌人无 MP 语义
    atk, def: def.baseDef,
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
  const isBoss = tier === 'boss';
  // 名字：Boss → 守卫者头衔（含 Lv）；普通/精英 → 随机池 or 模板名（末光格式 名字·LvX）
  const rawName = isBoss
    ? bossTitle(depth, lv)
    : (rng() < 0.5 ? base.name : RANDOM_NAMES[Math.min(RANDOM_NAMES.length - 1, Math.floor(Math.min(1, Math.max(0, rng())) * RANDOM_NAMES.length))]);
  const name = isBoss ? rawName : `${rawName}·Lv${lv}`;
  const unit = new CombatUnit({
    name,
    hp, maxHp: hp,
    mp: 0, maxMp: 0, // MP 已删（2026-08-11）：敌人无 MP 语义
    atk, def: base.baseDef,
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
