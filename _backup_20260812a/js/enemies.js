// ============================================================
// js/enemies.js — 敌人表 + 随机怪生成（Fate_echo Phase 2 + Phase 5 F3）
// NEW_GAME.md §4.1 初稿 12 种：
//   普通（6）：1-2 技能、低血低伤
//   精英（4）：3~5 技能、含瞬发、有机制（dot 免疫/狂暴+自爆/吸血）
//   Boss（2）：5 技能、阶段转换（enragePct 半血狂暴）、领域技
// 技能定义：'s01' 等 id 从 SKILLS_DB 原样取；内联对象为"效果数据同源"
//   （复用 EFFECT_TYPES）的定制技能（如吸血：伤害 + 治疗效果）
// 数值缩放（§4.3 初稿 ⚠️）：HP = baseHp × 等级^1.15；ATK = baseAtk × 等级^0.9
// 契约：普通敌人技能表不含瞬发（§2.1 瞬发槽仅精英/Boss 有，瞬发会浪费）
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
  { id: 'e01', name: '史莱姆', tier: 'normal', baseHp: 45, baseAtk: 6, baseDef: 4, skills: ['en_弹跳撞击', 'en_粘液腐蚀'], desc: '黏糊糊的软体生物，弹跳撞击并喷洒腐蚀粘液。' },
  { id: 'e02', name: '丛林之狼', tier: 'normal', baseHp: 55, baseAtk: 6, baseDef: 5, skills: ['en_狼爪连袭', 'en_野性嚎叫'], desc: '群居的掠食者，利爪连袭与野性嚎叫。' },
  { id: 'e03', name: '骷髅士兵', tier: 'normal', baseHp: 60, baseAtk: 6, baseDef: 4, skills: ['en_骸骨劈砍', 'en_死灵汲取'], desc: '不死的骸骨，劈砍并汲取生者生命。' },
  { id: 'e04', name: '哥布林法师', tier: 'normal', baseHp: 45, baseAtk: 6, baseDef: 10, skills: ['en_火球术', 'en_奥术脉冲'], desc: '偷学的法术：火球术与奥术脉冲。' },
  { id: 'e05', name: '石像鬼', tier: 'normal', baseHp: 95, baseAtk: 6, baseDef: 6, skills: ['en_石拳重击', 'en_石化凝视'], desc: '坚硬的雕像守卫：石拳重击与石化凝视。' },
  { id: 'e06', name: '腐化树精', tier: 'normal', baseHp: 70, baseAtk: 6, baseDef: 6, skills: ['en_腐毒喷洒', 'en_藤蔓缠绕'], desc: '被腐蚀的古树：喷洒腐毒并缠绕猎物。' },
  // ---- 精英（数值初稿 ⚠️） ----
  { id: 'e07', name: '暗影刺客', tier: 'elite', baseHp: 120, baseAtk: 11, baseDef: 8, skills: ['en_影袭', 'en_淬毒飞刀', 'en_致命背刺'], desc: '来去无踪的杀手：影袭、淬毒飞刀与致命背刺。' },
  { id: 'e08', name: '冰霜巨人', tier: 'elite', baseHp: 190, baseAtk: 12, baseDef: 8, enragePct: 0.5, skills: ['en_冰霜重爪', 'en_寒冰吐息', 'en_寒冰碎片', 'en_碎裂连击', 'en_霜冻新星'], desc: '半血狂暴的冰霜巨人：寒冰吐息与霜冻新星。' },
  { id: 'e09', name: '瘟疫祭司', tier: 'elite', baseHp: 125, baseAtk: 9, baseDef: 12, dotImmune: true, skills: ['en_亡灵复苏', 'en_疫病散布', 'en_腐化飞沫', 'en_腐化诅咒', 'en_瘟疫爆发'], desc: '免疫持续伤害的瘟疫祭司：疫病散布与瘟疫爆发。' },
  { id: 'e10', name: '虚空猎手', tier: 'elite', baseHp: 135, baseAtk: 10, baseDef: 10, skills: ['en_虚空蚀弹', 'en_虚空之刃', 'en_虚空噬咬', 'en_虚空脉冲', 'en_虚空侵蚀'], desc: '虚空猎手：蚀弹、噬咬吸取生命与虚空侵蚀。' },
  // ---- Boss（数值初稿 ⚠️） ----
  { id: 'e11', name: '深渊领主', tier: 'boss', baseHp: 330, baseAtk: 14, baseDef: 14, enragePct: 0.5, skills: ['en_深渊斩击', 'en_深渊之息', 'en_深渊威压', 'en_深渊裂隙', 'en_深渊回响'], desc: '半血狂暴的深渊领主：威压、裂隙与深渊回响。' },
  { id: 'e12', name: '时空支配者', tier: 'boss', baseHp: 310, baseAtk: 13, baseDef: 16, enragePct: 0.5, skills: ['en_时空弹', 'en_时空闪击', 'en_时滞凝结', 'en_时空裂隙斩', 'en_时光腐蚀'], desc: '扭曲时空的支配者：时滞凝结与时光腐蚀。' },
];

// ---- 敌人独立技能池（2026-08-11 用户定案：敌人技能 = 敌人技能，不复用玩家技能）----
// 27 个独立技能（en_ 前缀）；效果机制复用 EFFECT_HANDLERS（机制层共享）；
// Boss 大招保留 [终焉] 标记（敌人侧终焉独占 = 主行动后跳过瞬发）；
// desc 简写（isFinale 判定用 [终焉] 标记）
export const ENEMY_SKILLS = {
  // ---- 2026-08-12 从零重做（用户定案：机制全新/名字不撞玩家/数值不秒杀/reqLv 等级门槛新手保护）----
  // reqLv = 敌人等级门槛（基础 1 / 中级 3 / 高级 6；敌人等级低于 reqLv 时不带该技能）
  // 伤害基数一律 atk 或玩家 maxHp（不随敌人 HP 膨胀 → 任何等级不秒杀）
  // ---- 普通（史莱姆/丛林之狼/骷髅士兵/哥布林法师/石像鬼/腐化树精）----
  en_弹跳撞击: { id: 'en_弹跳撞击', name: '弹跳撞击', reqLv: 1, type: 'main', dmgMult: 1.0, priority: 1, desc: '[主技能] 弹跳撞击，造成{dmgMult}%攻击力伤害。' },
  en_粘液腐蚀: { id: 'en_粘液腐蚀', name: '粘液腐蚀', reqLv: 1, type: 'dot', dmgMult: 0.5, effects: [{ type: 'dot', dur: 4, dps: 0.6, stateName: '腐蚀', stateEmoji: '🧪' }], priority: 8, desc: '[DoT] 造成{dmgMult}%攻击力伤害并腐蚀4层。' },
  en_狼爪连袭: { id: 'en_狼爪连袭', name: '狼爪连袭', reqLv: 1, type: 'main', dmgMult: 0, effects: [{ type: 'multi_hit', hits: 2, dmgMult: 0.9 }], priority: 5, desc: '[主技能] 利爪连击 2 段，每段 90% 攻击力伤害。' },
  en_野性嚎叫: { id: 'en_野性嚎叫', name: '野性嚎叫', reqLv: 3, type: 'buff', dmgMult: 0, effects: [{ type: 'buff', stat: 'dmg_up_pct', val: 25, dur: 2 }], priority: 9, desc: '[Buff] 野性嚎叫：自身增伤25%，持续2层。' },
  en_骸骨劈砍: { id: 'en_骸骨劈砍', name: '骸骨劈砍', reqLv: 1, type: 'main', dmgMult: 1.3, priority: 2, desc: '[主技能] 骸骨劈砍，造成{dmgMult}%攻击力伤害。' },
  en_死灵汲取: { id: 'en_死灵汲取', name: '死灵汲取', reqLv: 3, type: 'main', dmgMult: 1.5, effects: [{ type: 'heal', val: 1.2 }], priority: 12, desc: '[主技能] 造成{dmgMult}%攻击力伤害并汲取生命。' },
  en_火球术: { id: 'en_火球术', name: '火球术', reqLv: 1, type: 'main', dmgMult: 2.0, priority: 4, desc: '[主技能] 火球术，造成{dmgMult}%攻击力伤害。' },
  en_奥术脉冲: { id: 'en_奥术脉冲', name: '奥术脉冲', reqLv: 3, type: 'dot', dmgMult: 0.6, effects: [{ type: 'dot', dur: 3, dps: 0.8, stateName: '脉冲', stateEmoji: '🔮' }], priority: 8, desc: '[DoT] 造成{dmgMult}%攻击力伤害并脉冲3层。' },
  en_石拳重击: { id: 'en_石拳重击', name: '石拳重击', reqLv: 1, type: 'main', dmgMult: 2.2, priority: 6, desc: '[主技能] 石拳重击，造成{dmgMult}%攻击力伤害。' },
  en_石化凝视: { id: 'en_石化凝视', name: '石化凝视', reqLv: 3, type: 'debuff', dmgMult: 0, effects: [{ type: 'haste_down', val: 30, dur: 3 }], priority: 9, desc: '[Debuff] 石化凝视：玩家急速-30%，持续3层。' },
  en_腐毒喷洒: { id: 'en_腐毒喷洒', name: '腐毒喷洒', reqLv: 1, type: 'dot', dmgMult: 0.5, effects: [{ type: 'dot', dur: 5, dps: 0.8, stateName: '恶咒', stateEmoji: '☠️' }, { type: 'heal_cut', val: 25, dur: 3 }], priority: 8, desc: '[DoT] 腐蚀5层并降低受疗25%（3层）。' },
  en_藤蔓缠绕: { id: 'en_藤蔓缠绕', name: '藤蔓缠绕', reqLv: 3, type: 'debuff', dmgMult: 0, effects: [{ type: 'haste_down', val: 25, dur: 4 }], priority: 9, desc: '[Debuff] 藤蔓缠绕：玩家急速-25%，持续4层。' },
  // ---- 精英（暗影刺客/冰霜巨人/瘟疫祭司/虚空猎手）----
  en_影袭: { id: 'en_影袭', name: '影袭', reqLv: 3, type: 'main', dmgMult: 0, effects: [{ type: 'multi_hit', hits: 3, dmgMult: 1.2 }], priority: 11, desc: '[主技能] 影袭连击 3 段，每段 120% 攻击力伤害。' },
  en_淬毒飞刀: { id: 'en_淬毒飞刀', name: '淬毒飞刀', reqLv: 3, type: 'instant', dmgMult: 0.8, effects: [{ type: 'dot', dur: 3, dps: 0.8, stateName: '剧毒', stateEmoji: '💉' }, { type: 'atk_down', val: 10, dur: 2 }], priority: 11, desc: '[瞬发] 淬毒飞刀：伤害并剧毒3层、降攻10%。' },
  en_淬毒匕首: { id: 'en_淬毒匕首', name: '淬毒匕首', reqLv: 3, type: 'dot', dmgMult: 0.4, effects: [{ type: 'dot', dur: 3, dps: 1.0, stateName: '剧毒', stateEmoji: '💉' }, { type: 'atk_down', val: 10, dur: 3 }], priority: 8, desc: '[DoT] 剧毒3层并降低玩家攻击10%（3层）。' },
  en_致命背刺: { id: 'en_致命背刺', name: '致命背刺', reqLv: 3, type: 'main', dmgMult: 4.5, priority: 7, desc: '[主技能] 致命背刺，造成{dmgMult}%攻击力伤害。' },
  en_冰霜重爪: { id: 'en_冰霜重爪', name: '冰霜重爪', reqLv: 1, type: 'main', dmgMult: 2.2, priority: 6, desc: '[主技能] 冰霜重爪，造成{dmgMult}%攻击力伤害。' },
  en_寒冰吐息: { id: 'en_寒冰吐息', name: '寒冰吐息', reqLv: 3, type: 'debuff', dmgMult: 0, effects: [{ type: 'haste_down', val: 40, dur: 4 }], priority: 9, desc: '[Debuff] 寒冰吐息：玩家急速-40%，持续4层。' },
  en_寒冰碎片: { id: 'en_寒冰碎片', name: '寒冰碎片', reqLv: 3, type: 'instant', dmgMult: 1.8, priority: 11, desc: '[瞬发] 寒冰碎片，造成{dmgMult}%攻击力伤害。' },
  en_碎裂连击: { id: 'en_碎裂连击', name: '碎裂连击', reqLv: 3, type: 'main', dmgMult: 0, effects: [{ type: 'multi_hit', hits: 2, dmgMult: 1.8 }], priority: 7, desc: '[主技能] 碎裂连击 2 段，每段 180% 攻击力伤害。' },
  en_霜冻新星: { id: 'en_霜冻新星', name: '霜冻新星', reqLv: 6, type: 'main', dmgMult: 0, effects: [{ type: 'maxhp_dmg', pct: 0.15 }], priority: 17, desc: '[大招] 霜冻新星：对玩家造成最大生命15%的伤害。' },
  en_亡灵复苏: { id: 'en_亡灵复苏', name: '亡灵复苏', reqLv: 1, type: 'buff', dmgMult: 0, effects: [{ type: 'heal', val: 2.5 }], priority: 12, desc: '[治疗] 亡灵复苏：恢复自身生命。' },
  en_腐化飞沫: { id: 'en_腐化飞沫', name: '腐化飞沫', reqLv: 3, type: 'instant', dmgMult: 1.5, effects: [{ type: 'heal_cut', val: 20, dur: 2 }], priority: 11, desc: '[瞬发] 腐化飞沫：伤害并降低受疗20%。' },
  en_疫病散布: { id: 'en_疫病散布', name: '疫病散布', reqLv: 3, type: 'dot', dmgMult: 0.6, effects: [{ type: 'dot', dur: 4, dps: 1.2, stateName: '疫病', stateEmoji: '🦠' }, { type: 'heal_cut', val: 30, dur: 3 }], priority: 8, desc: '[DoT] 疫病4层并降低受疗30%（3层）。' },
  en_腐化诅咒: { id: 'en_腐化诅咒', name: '腐化诅咒', reqLv: 3, type: 'debuff', dmgMult: 0, effects: [{ type: 'atk_down', val: 25, dur: 4 }], priority: 9, desc: '[Debuff] 腐化诅咒：玩家攻击-25%，持续4层。' },
  en_瘟疫爆发: { id: 'en_瘟疫爆发', name: '瘟疫爆发', reqLv: 6, type: 'main', dmgMult: 0, effects: [{ type: 'maxhp_dmg', pct: 0.12 }, { type: 'vuln', val: 1.2, dur: 2 }], priority: 17, desc: '[大招] 瘟疫爆发：最大生命12%伤害并易伤2层。' },
  en_虚空蚀弹: { id: 'en_虚空蚀弹', name: '虚空蚀弹', reqLv: 1, type: 'main', dmgMult: 1.5, priority: 4, desc: '[主技能] 虚空蚀弹，造成{dmgMult}%攻击力伤害。' },
  en_虚空之刃: { id: 'en_虚空之刃', name: '虚空之刃', reqLv: 1, type: 'instant', dmgMult: 1.8, priority: 11, desc: '[瞬发] 虚空之刃，造成{dmgMult}%攻击力伤害。' },
  en_虚空噬咬: { id: 'en_虚空噬咬', name: '虚空噬咬', reqLv: 1, type: 'main', dmgMult: 1.6, effects: [{ type: 'heal', val: 1.5 }], priority: 12, desc: '[主技能] 虚空噬咬，造成{dmgMult}%攻击力伤害并汲取生命。' },
  en_虚空脉冲: { id: 'en_虚空脉冲', name: '虚空脉冲', reqLv: 3, type: 'main', dmgMult: 2.8, priority: 5, desc: '[主技能] 虚空脉冲，造成{dmgMult}%攻击力伤害。' },
  en_虚空侵蚀: { id: 'en_虚空侵蚀', name: '虚空侵蚀', reqLv: 6, type: 'main', dmgMult: 0, effects: [{ type: 'maxhp_dmg', pct: 0.12 }], priority: 17, desc: '[大招] 虚空侵蚀：对玩家造成最大生命12%的伤害。' },
  // ---- Boss（深渊领主/时空支配者）----
  en_深渊斩击: { id: 'en_深渊斩击', name: '深渊斩击', reqLv: 1, type: 'main', dmgMult: 5.0, priority: 7, desc: '[主技能] 深渊斩击，造成{dmgMult}%攻击力伤害。' },
  en_深渊之息: { id: 'en_深渊之息', name: '深渊之息', reqLv: 3, type: 'instant', dmgMult: 2.0, priority: 11, desc: '[瞬发] 深渊之息，造成{dmgMult}%攻击力伤害。' },
  en_深渊威压: { id: 'en_深渊威压', name: '深渊威压', reqLv: 3, type: 'debuff', dmgMult: 0, effects: [{ type: 'atk_down', val: 30, dur: 5 }], priority: 9, desc: '[Debuff] 深渊威压：玩家攻击-30%，持续5层。' },
  en_深渊裂隙: { id: 'en_深渊裂隙', name: '深渊裂隙', reqLv: 3, type: 'main', dmgMult: 0, effects: [{ type: 'multi_hit', hits: 2, dmgMult: 2.5 }], priority: 7, desc: '[主技能] 深渊裂隙连击 2 段，每段 250% 攻击力伤害。' },
  en_深渊回响: { id: 'en_深渊回响', name: '深渊回响', reqLv: 6, type: 'main', dmgMult: 0, effects: [{ type: 'lost_hp_dmg', pct: 0.5 }], priority: 17, desc: '[大招] 深渊回响：对玩家造成已损失生命50%的伤害（血越少越痛）。' },
  en_暗蚀深渊: { id: 'en_暗蚀深渊', name: '暗蚀深渊', reqLv: 6, type: 'dot', dmgMult: 0.8, effects: [{ type: 'dot', dur: 3, dps: 1.5, stateName: '暗蚀', stateEmoji: '🌑' }, { type: 'heal_cut', val: 30, dur: 3 }], priority: 8, desc: '[DoT] 暗蚀3层并降低受疗30%。' },
  en_时空弹: { id: 'en_时空弹', name: '时空弹', reqLv: 1, type: 'main', dmgMult: 2.5, priority: 4, desc: '[主技能] 时空弹，造成{dmgMult}%攻击力伤害。' },
  en_时空闪击: { id: 'en_时空闪击', name: '时空闪击', reqLv: 1, type: 'instant', dmgMult: 2.0, priority: 11, desc: '[瞬发] 时空闪击，造成{dmgMult}%攻击力伤害。' },
  en_时滞凝结: { id: 'en_时滞凝结', name: '时滞凝结', reqLv: 3, type: 'debuff', dmgMult: 0, effects: [{ type: 'haste_down', val: 50, dur: 5 }], priority: 9, desc: '[Debuff] 时滞凝结：玩家急速-50%，持续5层。' },
  en_时空裂隙斩: { id: 'en_时空裂隙斩', name: '时空裂隙斩', reqLv: 6, type: 'main', dmgMult: 0, effects: [{ type: 'multi_hit', hits: 3, dmgMult: 1.5 }], priority: 7, desc: '[主技能] 时空裂隙斩连击 3 段，每段 150% 攻击力伤害。' },
  en_熵增威压: { id: 'en_熵增威压', name: '熵增威压', reqLv: 6, type: 'debuff', dmgMult: 0, effects: [{ type: 'atk_down', val: 35, dur: 4 }], priority: 9, desc: '[Debuff] 熵增威压：玩家攻击-35%，持续4层。' },
  en_时光腐蚀: { id: 'en_时光腐蚀', name: '时光腐蚀', reqLv: 6, type: 'main', dmgMult: 0, effects: [{ type: 'maxhp_dmg', pct: 0.2 }], priority: 17, desc: '[大招] 时光腐蚀：对玩家造成最大生命20%的伤害。' },
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
  // reqLv 门槛（2026-08-12 新手保护）：敌人等级低于技能 reqLv 时不带该技能（前期精英/Boss 低配）
  const skills = def.skills.map(resolveSkill).filter((sk) => sk && (!sk.reqLv || lv >= sk.reqLv));
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
  // reqLv 门槛（2026-08-12 新手保护）：同 createEnemy
  const skills = base.skills.map(resolveSkill).filter((sk) => sk && (!sk.reqLv || lv >= sk.reqLv));
  return {
    unit,
    skills,
    meta: { id: base.id, tier: safeTier, enragePct: base.enragePct, dotImmune: !!base.dotImmune, desc: base.desc, random: true },
  };
}
