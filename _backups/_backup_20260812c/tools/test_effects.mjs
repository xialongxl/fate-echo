// ============================================================
// tools/test_effects.mjs — 效果处理器测试（Fate_echo Phase 0）
// 验证：13 种效果类型在回合制语义下正确执行（buff/dot/heal/hot/shield/
//       mp_recover_pct/vuln/hp_sacrifice/dot_enhance/
//       channel_immune/cond_full_heal/domain）+ 伤害公式 + 持续结算
// 用法: node tools/test_effects.mjs
// ============================================================

import { CombatUnit } from '../js/unit.js';
import { SKILLS_DB } from '../js/data.js';
import { Skill } from '../js/skill.js';
import { EFFECT_HANDLERS, executeSkillEffects, tickDotsHots, calcDamage } from '../js/effects.js';

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

// 测试环境
const logs = [];
const ctx = {
  log: (m) => logs.push(m),
  resetCooldowns: (u) => { u.cooldowns = 0; },
  openDomain: (d) => { ctx.domain = d; },
  grantAp: (u, n) => { ctx.apGain = (ctx.apGain || 0) + (Number.isFinite(n) ? Math.max(0, n) : 0); },
};
const mkUnit = (o = {}) => new CombatUnit(Object.assign(
  { name: '测试员', hp: 500, maxHp: 500, mp: 200, maxMp: 200, atk: 100, def: 10, level: 10, critChance: 0 },
  o,
));
const mkTarget = (o = {}) => mkUnit(Object.assign({ name: '靶子', hp: 300 }, o));

console.log('== 处理器覆盖 ==');
const handled = new Set(Object.keys(EFFECT_HANDLERS));
const needed = new Set(SKILLS_DB.flatMap((s) => (s.effects || []).map((e) => e.type)));
const missing = [...needed].filter((t2) => !handled.has(t2));
t(`13 种效果类型全部有处理器（缺失 ${missing.length}）`, missing.length === 0, missing.join(','));

console.log('== 伤害公式 ==');
const u10 = mkUnit({ atk: 100, def: 10, level: 10 });
const e10 = mkTarget({ def: 10, level: 10 });
const d = calcDamage(u10, e10, 1.0);
t(`减伤公式: atk100×1.0 对 def10/lv10 → 约98（减伤 2.4%）`, d >= 90 && d <= 105, `实际 ${d}`);
const e1 = mkTarget({ def: 1, level: 1 });
const d2 = calcDamage(u10, e1, 1.0, { noCrit: true });
t(`低防敌人减伤小: 约98（1/(1+40) 减伤 2.4%）`, d2 >= 96 && d2 <= 100, `实际 ${d2}`);
const e100 = mkTarget({ def: 100, level: 100 });
const d3 = calcDamage(u10, e100, 1.0, { noCrit: true });
t(`高防敌人减伤 2.4%（100/(100+4000)）`, d3 >= 96 && d3 <= 100, `实际 ${d3}`);
const eHuge = mkTarget({ def: 100000, level: 100 });
const d6 = calcDamage(u10, eHuge, 1.0, { noCrit: true });
t(`减伤上限截断 85%（def 极高 → 伤害≥15）`, d6 >= 14 && d6 <= 16, `实际 ${d6}`);
const crit100 = mkUnit({ critChance: 1 });
const d4 = calcDamage(crit100, e1, 1.0, { noMitigation: true });
t(`暴击 100% ×1.5`, d4 === 150, `实际 ${d4}`);
const d5 = calcDamage(u10, e1, 1.0, { noCrit: true, noMitigation: true });
t(`无暴击无减伤 = 100`, d5 === 100, `实际 ${d5}`);

console.log('== 共鸣增减伤一体（末光 engine.js L1202-1218 照抄：versa 增伤同时减伤 versa×0.0015）==');
const eVersa = mkTarget({ def: 0, level: 1 });
eVersa.buffs.push({ key: 't:versa', stat: 'versa', val: 20, turns: Infinity });
const dv = calcDamage(mkUnit({ atk: 100, def: 0, level: 1 }), eVersa, 1.0, { noCrit: true });
t(`versa 20 → 减伤 3%（20×0.0015）→ 97`, dv === 97, `实际 ${dv}`);
const eVersaHigh = mkTarget({ def: 0, level: 1 });
eVersaHigh.buffs.push({ key: 't:versa', stat: 'versa', val: 700, turns: Infinity });
const dvh = calcDamage(mkUnit({ atk: 100, def: 0, level: 1 }), eVersaHigh, 1.0, { noCrit: true });
t(`versa 700 → 减伤 105% → 单段上限 85% → 15`, dvh === 15, `实际 ${dvh}`);
const eTotal = mkTarget({ def: 100000, level: 100 });
eTotal.buffs.push({ key: 't:versa', stat: 'versa', val: 700, turns: Infinity });
const dt = calcDamage(mkUnit({ atk: 100, def: 0, level: 1 }), eTotal, 1.0, { noCrit: true });
t(`def 85% + versa 85% → 总减伤上限 95% → 5`, dt === 5, `实际 ${dt}`);
const eVersaNeg = mkTarget({ def: 0, level: 1 });
eVersaNeg.buffs.push({ key: 't:versa', stat: 'versa', val: -50, turns: Infinity });
const dvn = calcDamage(mkUnit({ atk: 100, def: 0, level: 1 }), eVersaNeg, 1.0, { noCrit: true });
t(`versa 负值 → 减伤夹取 0 → 100`, dvn === 100, `实际 ${dvn}`);

console.log('== 纯伤害主技能（s01 魔力弹）==');
let u = mkUnit(); let e = mkTarget();
logs.length = 0;
executeSkillEffects(ctx, new Skill(SKILLS_DB[0]), u, e);
t('s01 造成约 97 伤害（floor 取整，300→203）', e.hp === 203, `hp=${e.hp}`);

console.log('== buff（s02 光辉护甲 versa+10）==');
u = mkUnit(); logs.length = 0;
executeSkillEffects(ctx, new Skill(SKILLS_DB[1]), u, u);
t('s02 versa+10 → 增伤 1.1', u.statBonus('versa') === 10 && Math.abs(u.dmgMultiplier() - 1.1) < 1e-9);
t('s02 buff 6 回合（15000ms→6）', u.buffs[0] && u.buffs[0].turns === 6, `turns=${u.buffs[0] && u.buffs[0].turns}`);

console.log('== DoT（s04 痛苦诅咒）==');
u = mkUnit(); e = mkTarget({ hp: 300 });
logs.length = 0;
executeSkillEffects(ctx, new Skill(SKILLS_DB[3]), u, e);
t('s04 立即伤害（dmgMult 0.5 有减伤 → 48）', e.hp === 252, `hp=${e.hp}`);
t('s04 挂 dot：0.8 倍/回合 ×5', e.dots.length === 1 && e.dots[0].dps === 0.8 && e.dots[0].turns === 5);
const dotLines = tickDotsHots(ctx, e);
t('s04 回合结算扣血（floor ≈78）', e.hp === 174 && dotLines.length === 1, `hp=${e.hp}`);

console.log('== 治疗（s05 生命绽放）==');
u = mkUnit({ hp: 200 }); logs.length = 0;
executeSkillEffects(ctx, new Skill(SKILLS_DB[4]), u, u);
t('s05 恢复 500% 攻击力 → 满血', u.hp === 500);

console.log('== Hot（s12 生命泉涌）==');
u = mkUnit({ hp: 300 }); logs.length = 0;
executeSkillEffects(ctx, new Skill(SKILLS_DB[11]), u, u);
t('s12 hot: 5% 最大生命/回合', u.hots.length === 1 && u.hots[0].pct === 0.05);
const hotLines = tickDotsHots(ctx, u);
t('s12 回合结算 +25（500×5%）', u.hp === 325 && hotLines.length === 1, `hp=${u.hp}`);

console.log('== 护盾（s13 魔力护盾）==');
u = mkUnit(); logs.length = 0;
executeSkillEffects(ctx, new Skill(SKILLS_DB[12]), u, u);
t('s13 护盾 100 点（20%×500）', u.shield && u.shield.hp === 100 && u.shield.turns === 4);
const hpBefore = u.hp;
u.takeDamage(60);
t('s13 护盾吸收 60', u.hp === hpBefore && u.shield.hp === 40);
u.takeDamage(60);
t('s13 护盾耗尽后溢出 20', u.hp === hpBefore - 20 && u.shield === null, `hp=${u.hp}`);

console.log('== 回 AP（s07 黑暗契约 +1 行动点）==');
u = mkUnit(); logs.length = 0; ctx.apGain = 0;
executeSkillEffects(ctx, new Skill(SKILLS_DB[6]), u, u);
t('s07 回 1 行动点（AP 回转）', ctx.apGain === 1 && logs.some((m) => m.includes('恢复 1 行动点')), `apGain=${ctx.apGain} ${logs.join('|')}`);

console.log('== 易伤（s18 死亡标记，回合递减）==');
u = mkUnit(); e = mkTarget();
executeSkillEffects(ctx, new Skill(SKILLS_DB[17]), u, e);
t('s18 vuln ×1.2 且 4 回合', e.vulnMult === 1.2 && e.vulnTurns === 4);
for (let i = 0; i < 4; i++) e.tickStatus();
t('s18 第 4 回合到期还原 ×1', e.vulnMult === 1 && e.vulnTurns === 0, `mult=${e.vulnMult}`);
e.tickStatus();
t('s18 还原后不再递减', e.vulnMult === 1 && e.vulnTurns === 0);
// 同类刷新乘算叠加（先 ×1.2 再 ×1.5 → 1.8，末光照抄）
executeSkillEffects(ctx, new Skill(SKILLS_DB[17]), u, e);
const s44 = new Skill(SKILLS_DB[43]);
executeSkillEffects(ctx, s44, u, e);
t('s44 刷新乘算叠加 ×1.8（1.2×1.5）', Math.abs(e.vulnMult - 1.8) < 1e-9, `mult=${e.vulnMult}`);

console.log('== 聚力共鸣（s38 回 2 AP + 急速 50）==');
u = mkUnit(); logs.length = 0; ctx.apGain = 0;
executeSkillEffects(ctx, new Skill(SKILLS_DB[37]), u, u);
t('s38 回 2 行动点 + 急速 50 层', ctx.apGain === 2 && u.buffs.some((b) => b.stat === 'haste' && b.val === 50), `apGain=${ctx.apGain}`);

console.log('== 献祭（s40 灵魂献祭，末光照抄：代价=当前HP×50%、最低留1、伤害=献祭HP×20）==');
u = mkUnit({ hp: 500 }); e = mkTarget({ hp: 9999, def: 10 });
logs.length = 0;
executeSkillEffects(ctx, new Skill(SKILLS_DB[39]), u, e);
t('s40 献祭 50% 当前生命（500→250）', u.hp === 250, `hp=${u.hp}`);
t('s40 造成巨额伤害（献祭 250×20 倍 = 5000）', e.hp === 9999 - 5000, `hp=${e.hp}`);
// 最低保留 1 HP（不可自杀）
const u2 = mkUnit({ hp: 2 });
const e2 = mkTarget({ hp: 9999 });
executeSkillEffects(ctx, new Skill(SKILLS_DB[39]), u2, e2);
t('s40 最低保留 1 HP（hp2 → 1）', u2.hp === 1, `hp=${u2.hp}`);
t('s40 伤害按当前 HP（献祭 1×20=20）', e2.hp === 9999 - 20, `hp=${e2.hp}`);

console.log('== dot 强化（s41 虚空化身：频率×2 且伤害×2 = 4 倍，末光照抄）==');
u = mkUnit(); e = mkTarget({ hp: 300 });
executeSkillEffects(ctx, new Skill(SKILLS_DB[40]), u, u);
t('s41 dotEnhanced 6 回合', u.dotEnhanced === 6);
executeSkillEffects(ctx, new Skill(SKILLS_DB[3]), u, e); // 先挂 dot（立即伤 48：300→252）
tickDotsHots(ctx, e); // 强化期间：结算两次 × 单次伤害×2（252−156−156→0）；返回行数不在此断言
t('s41 强化期间 dot 4 倍（立即伤后 252→0）', e.hp === 0, `hp=${e.hp}`);

console.log('== 无敌（s43 星辰坠落）==');
u = mkUnit(); logs.length = 0;
const hpB = u.hp; // 施放前血量：dmgMult=0 → 自身不应受任何立即伤害
executeSkillEffects(ctx, new Skill(SKILLS_DB[42]), u, u);
t('s43 无立即伤害（dmgMult 0）', u.hp === hpB, `hp=${u.hp}`);
t('s43 挂 dot：4.0 倍/回合 ×3', u.dots.length === 1 && u.dots[0].dps === 4.0 && u.dots[0].turns === 3);
u.takeDamage(9999);
t('s43 无敌免疫 9999', u.hp === hpB && u.immuneTurns === 3);
u.tickStatus();
t('s43 无敌回合递减', u.immuneTurns === 2);

console.log('== 条件回满（s45 命运轮转）==');
u = mkUnit({ hp: 100 }); logs.length = 0;
const s45 = new Skill(SKILLS_DB[44]);
t('s45 条件满足（HP20%<30%）', s45.conditionMet(u));
executeSkillEffects(ctx, s45, u, u);
t('s45 回满 + 增伤 50%', u.hp === 500 && u.statBonus('dmg_up_pct') === 50);

console.log('== 领域（s48 虚空领域）==');
u = mkUnit(); logs.length = 0;
ctx.domain = null;
executeSkillEffects(ctx, new Skill(SKILLS_DB[47]), u, u);
t('s48 领域登记（void/5 回合/5.0 dps）', ctx.domain && ctx.domain.type === 'void' && ctx.domain.turns === 5 && ctx.domain.dps === 5.0);

console.log('== 目标路由（自增益 → source，对敌 → target）==');
u = mkUnit(); e = mkTarget({ hp: 300 });
// 护盾（自增益）对敌施放 → 盾应在自己身上
executeSkillEffects(ctx, new Skill(SKILLS_DB[12]), u, e);
t('s13 对敌施放：护盾在施放者', u.shield !== null && e.shield === null);
// 治疗（自增益）
u.hp = 100;
executeSkillEffects(ctx, new Skill(SKILLS_DB[4]), u, e);
t('s05 对敌施放：治疗施放者', u.hp > 100 && e.hp === 300, `u=${u.hp}`);
// dot（对敌）
executeSkillEffects(ctx, new Skill(SKILLS_DB[3]), u, e);
t('s04 对敌施放：dot 在目标', e.dots.length === 1 && u.dots.length === 0);
// 易伤（对敌）
executeSkillEffects(ctx, new Skill(SKILLS_DB[17]), u, e);
t('s18 对敌施放：易伤在目标', e.vulnTurns === 4 && u.vulnTurns === 0);
// 无敌（自增益）
executeSkillEffects(ctx, new Skill(SKILLS_DB[42]), u, e);
t('s43 对敌施放：无敌在施放者', u.immuneTurns === 3 && e.immuneTurns === 0);

console.log('== 持续状态递减（tickStatus）==');
u = mkUnit();
u.buffs.push({ key: 'x', stat: 'versa', val: 10, turns: 1 });
u.dots.push({ dps: 1, turns: 1, source: u, stateName: 'x' });
u.hots.push({ pct: 0.05, turns: 1 });
u.tickStatus();
t('tickStatus 清除到期 buff/dot/hot', u.buffs.length === 0 && u.dots.length === 0 && u.hots.length === 0);

console.log('== 容错 ==');
u = mkUnit(); e = mkTarget({ hp: 300 });
logs.length = 0;
const unknownSkill = new Skill({ id: 'x01', name: '未知技能', reqLv: 1, type: 'main', dmgMult: 1.0, effects: [{ type: 'not_a_real_type', val: 1 }] });
executeSkillEffects(ctx, unknownSkill, u, e);
t('未知效果类型：告警且不中断', logs.some((m) => m.includes('未知效果类型')) && e.hp < 300);

console.log('== 日志实际量（heal/回蓝/hot/献祭，超上限截断与护盾吸收）==');
u = mkUnit(); logs.length = 0;
executeSkillEffects(ctx, new Skill(SKILLS_DB[4]), u, u); // 满血 heal，请求 500 → 实际 0
t('满血 heal 日志显示实际恢复 0（非请求 500）', logs.some((m) => m.includes('恢复 0 生命')), logs.join('|'));
u = mkUnit({ hp: 480 }); logs.length = 0;
executeSkillEffects(ctx, new Skill(SKILLS_DB[4]), u, u); // 请求 500 → 上限截断实际 20
t('部分血量 heal 日志显示实际恢复 20（截断后）', logs.some((m) => m.includes('恢复 20 生命')), logs.join('|'));
u = mkUnit(); logs.length = 0; ctx.apGain = 0;
executeSkillEffects(ctx, new Skill(SKILLS_DB[6]), u, u); // 回 AP 技连续使用
executeSkillEffects(ctx, new Skill(SKILLS_DB[6]), u, u);
t('回 AP 技连续使用 → ctx.grantAp 累积 2', ctx.apGain === 2, `apGain=${ctx.apGain}`);
u = mkUnit({ hp: 500 }); u.hots.push({ pct: 0.05, turns: 3 });
const hotFull = tickDotsHots(ctx, u); // 满血 hot：请求 25 → 实际 0
t('满血 hot 结算不产生恢复行（实际 0）', hotFull.length === 0, hotFull.join('|'));
u = mkUnit({ hp: 480 }); u.hots.push({ pct: 0.05, turns: 3 });
const hotPart = tickDotsHots(ctx, u); // 请求 25 → 截断实际 20
t('部分血量 hot 行显示实际恢复 20', hotPart.length === 1 && hotPart[0].includes('+20'), hotPart.join('|'));
u = mkUnit({ hp: 500 }); e = mkTarget({ hp: 9999 });
e.shield = { hp: 100, turns: 2 };
logs.length = 0;
executeSkillEffects(ctx, new Skill(SKILLS_DB[39]), u, e); // 献祭：护盾吸收 100 后为实际伤害
const sacActual = 9999 - e.hp;
t('s40 目标带护盾：日志显示实际伤害（吸收后）', logs.some((m) => m.includes(`造成 ${sacActual} 伤害`)), `${logs.join('|')} 实际=${sacActual}`);

console.log('== 敌人技能新效果类型（2026-08-12 从零重做）==');
{
  // 反斩杀 lost_hp_dmg：伤害 = 目标已损失 HP × pct（noCrit 稳定）
  u = mkUnit(); e = mkTarget({ hp: 300, maxHp: 500 }); // 目标（玩家）损血 200
  logs.length = 0;
  executeSkillEffects(ctx, new Skill({ id: 'x_lost', name: '深渊回响', dmgMult: 0, effects: [{ type: 'lost_hp_dmg', pct: 0.5 }] }), u, e);
  const expLost = Math.max(1, Math.floor(100 * (1 - 10 / (10 + 10 * 40))));
  t('lost_hp_dmg 反斩杀：损血 200×50% 减伤后', e.hp === 300 - expLost, `hp=${e.hp} exp=${expLost}`);
  const e2b = mkTarget({ hp: 9999 });
  executeSkillEffects(ctx, new Skill({ id: 'x_lost2', name: '回响', dmgMult: 0, effects: [{ type: 'lost_hp_dmg', pct: 0.5 }] }), u, e2b);
  t('lost_hp_dmg 满血目标 0 伤害', e2b.hp === 9999);
  e = mkTarget({ hp: 400, maxHp: 400 });
  executeSkillEffects(ctx, new Skill({ id: 'x_max', name: '霜冻新星', dmgMult: 0, effects: [{ type: 'maxhp_dmg', pct: 0.15 }] }), u, e);
  const expMax = Math.max(1, Math.floor(400 * 0.15 * (1 - 10 / (10 + 10 * 40))));
  t('maxhp_dmg 比例伤害：maxHp 400×15% 减伤后', e.hp === 400 - expMax, `hp=${e.hp} exp=${expMax}`);
  u = mkUnit({ atk: 100 }); e = mkTarget({ hp: 9999, def: 0 });
  executeSkillEffects(ctx, new Skill({ id: 'x_atkd', name: '威压', dmgMult: 0, effects: [{ type: 'atk_down', val: 30, dur: 3 }] }), u, e);
  t('atk_down 降攻 30% 落地（debuff 层数）', e.buffs.some((b) => b.stat === 'atk_down_pct' && b.val === 30 && b.turns === 3));
  const dmgDown = calcDamage(e, u, 1.0, { noMitigation: true }); // 被降攻的 e 攻击 u → 70
  t('atk_down 生效：100×70%=70 伤害', dmgDown === 70, `dmg=${dmgDown}`);
  e = mkTarget({ hp: 9999, maxHp: 9999 });
  executeSkillEffects(ctx, new Skill({ id: 'x_hast', name: '时滞', dmgMult: 0, effects: [{ type: 'haste_down', val: 50, dur: 4 }] }), u, e);
  t('haste_down 降急速 50% 落地', e.buffs.some((b) => b.stat === 'haste_down_pct' && b.val === 50 && b.turns === 4));
  e = mkTarget({ hp: 50, maxHp: 100 });
  executeSkillEffects(ctx, new Skill({ id: 'x_cut', name: '疫病', dmgMult: 0, effects: [{ type: 'heal_cut', val: 30, dur: 3 }] }), u, e);
  const before = e.hp;
  e.heal(50); // 请求 50 → 30% 受疗降低 → 35
  t('heal_cut 受疗 -30%：50 → 35', e.hp - before === 35, `healed=${e.hp - before}`);
  u = mkUnit({ atk: 100 }); e = mkTarget({ hp: 9999, def: 0 });
  logs.length = 0;
  executeSkillEffects(ctx, new Skill({ id: 'x_multi', name: '狼爪连袭', dmgMult: 0, effects: [{ type: 'multi_hit', hits: 3, dmgMult: 0.9 }] }), u, e);
  t('multi_hit 连击 3 段：3×90=270', 9999 - e.hp === 270, `dmg=${9999 - e.hp}`);
  t('multi_hit 日志合并（连击 3 次共）', logs.some((m) => m.includes('连击 3 次共 270')), logs.join('|'));
}


console.log(`\n========== 效果测试：${pass} PASS / ${fail} FAIL ==========`);

process.exit(fail ? 1 : 0);
