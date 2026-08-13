// ============================================================
// tools/_review1_edges.mjs — 审查员 1：功能回归 + 边界用例（常驻回归补测，与 test_* 并列纳入基线）
// 覆盖：msToRounds 边界 / Skill.use·tick·conditionMet /
//       CombatUnit 负值·0·超上限·护盾易伤无敌叠加 /
//       calcDamage 边界（0 倍率、def=0 除零、crit>1）/
//       executeSkillEffects 单次结算·空效果·未知类型容错 /
//       53 技能 vs 末光咏叹 js/data.js 逐字段对照
// 用法: node tools/_review1_edges.mjs
// ============================================================

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { SKILLS_DB } from '../js/data.js';
import { Skill, msToRounds } from '../js/skill.js';
import { CombatUnit } from '../js/unit.js';
import { executeSkillEffects, tickDotsHots, calcDamage } from '../js/effects.js';

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

const mkUnit = (o = {}) => new CombatUnit(Object.assign(
  { name: '源', hp: 500, maxHp: 500, mp: 200, maxMp: 200, atk: 100, def: 10, level: 10, critChance: 0 },
  o,
));
const mkTarget = (o = {}) => mkUnit(Object.assign({ name: '靶', hp: 300 }, o));

const logs = [];
const ctx = {
  log: (m) => logs.push(m),
  resetCooldowns: (u) => { u.cooldowns = 0; },
  openDomain: (d) => { ctx.domain = d; },
  grantAp: (u, n) => { ctx.apGain = (ctx.apGain || 0) + (Number.isFinite(n) ? Math.max(0, n) : 0); },
};

// ---------- A. msToRounds 边界 ----------
console.log('== A. msToRounds 边界 ==');
t('msToRounds(1) = 1（>0 至少 1 回合）', msToRounds(1) === 1);
t('msToRounds(2499) = 1', msToRounds(2499) === 1);
t('msToRounds(2500) = 1（恰好一回合）', msToRounds(2500) === 1);
t('msToRounds(2501) = 1', msToRounds(2501) === 1);
t('msToRounds(3749) = 1（四舍五入下界）', msToRounds(3749) === 1);
t('msToRounds(3750) = 2（0.5 进位）', msToRounds(3750) === 2);
t('msToRounds(6249) = 2', msToRounds(6249) === 2);
t('msToRounds(6250) = 3', msToRounds(6250) === 3);
t('msToRounds(0) = 0', msToRounds(0) === 0);
t('msToRounds(-5) = 0（负值）', msToRounds(-5) === 0);
t('msToRounds(NaN) = 0', Number.isNaN(msToRounds(NaN)) ? false : msToRounds(NaN) === 0);
t('msToRounds(Infinity) = 0', msToRounds(Infinity) === 0);
t('msToRounds(-Infinity) = 0', msToRounds(-Infinity) === 0);
t('msToRounds 拒绝非数字类型（\'2500\' → 0，Number.isFinite 严格类型）', msToRounds('2500') === 0);

// ---------- B. Skill 状态机 ----------
console.log('== B. Skill.use / tick / conditionMet ==');
const s03 = new Skill(SKILLS_DB.find((s) => s.id === 's03'));
t('s03 去 CD 后无冷却（cdRounds 0）', s03.cdRounds === 0);
t('s03 连续 use 恒 true（无冷却）', s03.use() && s03.use() && s03.currentCd === 0);
const s07 = new Skill(SKILLS_DB.find((s) => s.id === 's07')); // 彻底去 CD：无冷却
t('s07 无冷却（cdRounds 0）', s07.cdRounds === 0);
t('s07 连续 use 恒 true', s07.use() && s07.use() && s07.currentCd === 0);
s07.tick();
t('s07 冷却已 0 时 tick 不越界', s07.currentCd === 0);
const s01 = new Skill(SKILLS_DB.find((s) => s.id === 's01'));
t('s01（cd0）连续 use 恒 true', s01.use() && s01.use() && s01.currentCd === 0);
const s45 = new Skill(SKILLS_DB.find((s) => s.id === 's45'));
t('s45 条件：HP 恰好 30% 不满足（严格 <）', !s45.conditionMet({ hpPct: () => 0.3 }));
t('s45 条件：HP 29.9% 满足', s45.conditionMet({ hpPct: () => 0.299 }));
t('s45 条件：HP 30.1% 不满足', !s45.conditionMet({ hpPct: () => 0.301 }));
t('s45 条件：maxHp=0 时 hpPct=0 满足', s45.conditionMet({ hpPct: () => 0 }));
t('s45 canUse 组合（冷却 + 条件）', s45.canUse({ hpPct: () => 0.2 }) && !s45.canUse({ hpPct: () => 0.5 }));

// ---------- C. CombatUnit 边界 ----------
console.log('== C. CombatUnit 受击/治疗/资源 ==');
{
  const u = mkUnit({ hp: 300 });
  const r = u.takeDamage(0);
  t('takeDamage(0) → 0 且不掉血', r === 0 && u.hp === 300);
  const r2 = u.takeDamage(-50);
  t('takeDamage(-50) → 0 且不治疗', r2 === 0 && u.hp === 300, `hp=${u.hp}`);
  const u2 = mkUnit({ hp: 300 });
  u2.shield = { hp: 100, turns: 2 };
  const r3 = u2.takeDamage(-50);
  t('takeDamage(-50) 不回复护盾', r3 === 0 && u2.shield.hp === 100 && u2.hp === 300, `shield=${u2.shield && u2.shield.hp}`);
  const u3 = mkUnit({ hp: 480 });
  const h = u3.heal(1000);
  t('heal(1000) 超上限截断（480→500，返回请求值 1000）', u3.hp === 500 && h === 1000, `hp=${u3.hp}, ret=${h}`);
  const u4 = mkUnit({ hp: 300 });
  t('heal(-10) → 0 不变', u4.heal(-10) === 0 && u4.hp === 300);
  const u5 = mkUnit({ mp: 190 });
  const m = u5.restoreMp(100);
  t('restoreMp(100) 超上限截断（190→200，返回请求值 100）', u5.mp === 200 && m === 100, `mp=${u5.mp}, ret=${m}`);
  const u6 = mkUnit({ mp: 100 });
  t('restoreMp(-10) → 0 不变', u6.restoreMp(-10) === 0 && u6.mp === 100);
  // 易伤 × 护盾叠加顺序：vuln 先放大 raw，再护盾吸收
  const u7 = mkUnit({ hp: 300 });
  u7.vulnMult = 1.5;
  u7.shield = { hp: 100, turns: 2 };
  const r7 = u7.takeDamage(100);
  t('易伤×1.5 + 盾100：先放大 150，盾吸 100，掉血 50', r7 === 50 && u7.hp === 250 && u7.shield === null, `hp=${u7.hp}, ret=${r7}`);
  // 护盾恰好耗尽
  const u8 = mkUnit({ hp: 300 });
  u8.shield = { hp: 100, turns: 2 };
  const r8 = u8.takeDamage(100);
  t('盾恰好 100 吸收 100：不掉血、盾清除', r8 === 0 && u8.hp === 300 && u8.shield === null);
  // 无敌 + 护盾同时
  const u9 = mkUnit({ hp: 300 });
  u9.immuneTurns = 2;
  u9.shield = { hp: 100, turns: 2 };
  const r9 = u9.takeDamage(9999);
  t('无敌+盾：免疫返回 0，盾不受损', r9 === 0 && u9.hp === 300 && u9.shield.hp === 100 && u9.immuneTurns === 2);
  // tickStatus 护盾到期（多盾叠加：直接操作 shields 数组）
  u9.shields[0].turns = 1;
  u9.tickStatus();
  t('tickStatus 护盾到期清除', u9.shield === null && u9.immuneTurns === 1);
}

// ---------- D. calcDamage 边界 ----------
console.log('== D. calcDamage 边界 ==');
{
  const src = mkUnit();
  const tg = mkTarget();
  const d0 = calcDamage(src, tg, 0, { noCrit: true, noMitigation: true });
  t('dmgMult 0 → 保底 1', d0 === 1, `got ${d0}`);
  const dn = calcDamage(src, tg, -3, { noCrit: true, noMitigation: true });
  t('dmgMult -3 → 保底 1（不为负）', dn === 1, `got ${dn}`);
  const zi = calcDamage(src, mkTarget({ def: 0 }), 1.0, { noCrit: true });
  t('target.def=0（lv10）→ 无减伤 100', zi === 100, `got ${zi}`);
  const zz = calcDamage(src, mkTarget({ def: 0, level: 0 }), 1.0, { noCrit: true });
  t('target.def=0 且 level=0 → 100（防 0/0 NaN）', zz === 100 && !Number.isNaN(zz), `got ${zz}`);
  const lv0 = calcDamage(src, mkTarget({ level: 0 }), 1.0, { noCrit: true });
  t('target.level=0（def10）→ 减伤封顶 85% → 15', lv0 === 15, `got ${lv0}`);
  const neg = calcDamage(src, mkTarget({ def: -5 }), 1.0, { noCrit: true });
  t('target.def=-5 → 负减伤夹取 0 → 100', neg === 100, `got ${neg}`);
  const atk0 = calcDamage(mkUnit({ atk: 0 }), tg, 1.0, { noCrit: true, noMitigation: true });
  t('atk=0 → 保底 1', atk0 === 1, `got ${atk0}`);
  const crit2 = mkUnit({ critChance: 2 });
  let all150 = true;
  for (let i = 0; i < 50; i++) {
    if (calcDamage(crit2, mkTarget({ def: 0 }), 1.0, { noMitigation: true }) !== 150) all150 = false;
  }
  t('critChance=2 → 封顶 100% 恒暴击 ×1.5（50 次）', all150);
  const critNeg = calcDamage(mkUnit({ critChance: -1 }), tg, 1.0, { noCrit: false, noMitigation: true });
  t('critChance=-1 → 永不暴击 100', critNeg === 100, `got ${critNeg}`);
}

// ---------- E. executeSkillEffects 结算语义 ----------
console.log('== E. executeSkillEffects 单次结算 / 空效果 / 容错 ==');
{
  // s04：dmgMult 0.5 立即伤害 + dot 仅挂载，不重复结算
  const u = mkUnit(); const e = mkTarget({ hp: 300 });
  logs.length = 0;
  executeSkillEffects(ctx, new Skill(SKILLS_DB.find((s) => s.id === 's04')), u, e);
  const dmgLines = logs.filter((m) => m.includes('点伤害')).length;
  t('s04 立即伤害恰好一次（dmgLines=1）', dmgLines === 1, `lines=${dmgLines}`);
  t('s04 立即伤害 = dmgMult 0.5 走公式 floor → 48（非 dps 80）', e.hp === 252, `hp=${e.hp}`);
  t('s04 dot 已挂载 0.8×5（无第二次伤害）', e.dots.length === 1 && e.dots[0].dps === 0.8 && e.dots[0].turns === 5);
  const dl = tickDotsHots(ctx, e);
  t('s04 回合结算走公式带减伤 floor → 78（252→174）', e.hp === 174 && dl.length === 1, `hp=${e.hp}`);
  // s43：dmgMult 0 → 无立即伤害，dot + 无敌
  const u2 = mkUnit(); const e2 = mkTarget({ hp: 300 });
  logs.length = 0;
  executeSkillEffects(ctx, new Skill(SKILLS_DB.find((s) => s.id === 's43')), u2, e2);
  t('s43 目标不受立即伤害（dmgMult 0）', e2.hp === 300, `hp=${e2.hp}`);
  t('s43 目标挂 dot 4.0×3', e2.dots.length === 1 && e2.dots[0].dps === 4.0 && e2.dots[0].turns === 3);
  // s30：dmgMult 2.0 + 回 1 行动点（AP 回转改造：回蓝已删，回 AP 作用于施放者）
  const u3 = mkUnit({ mp: 150 }); const e3 = mkTarget({ hp: 300, mp: 150 });
  logs.length = 0; ctx.apGain = 0;
  executeSkillEffects(ctx, new Skill(SKILLS_DB.find((s) => s.id === 's30')), u3, e3);
  t('s30 伤害 195 + 回 1 行动点（target 不受影响）', e3.hp === 105 && ctx.apGain === 1 && u3.mp === 150 && e3.mp === 150, `e3=${e3.hp}/${e3.mp} apGain=${ctx.apGain}`);
  // 被动技能（无 effects、dmgMult 0）：无副作用不崩
  const u4 = mkUnit(); const e4 = mkTarget({ hp: 300 });
  logs.length = 0;
  executeSkillEffects(ctx, new Skill(SKILLS_DB.find((s) => s.id === 's_passive_01')), u4, e4);
  t('s_passive_01（effectRounds 空）无任何伤害/状态', e4.hp === 300 && e4.buffs.length === 0 && e4.dots.length === 0);
  // 手造：dmgMult>0 且 effects 空 → 仅 dmgMult 伤害
  const fake1 = new Skill({ id: 'x01', name: '测试打击', reqLv: 1, type: 'gcd', cd: 0, cost: 0, dmgMult: 1.0, effects: [] });
  const u5 = mkUnit(); const e5 = mkTarget({ hp: 300 });
  logs.length = 0;
  executeSkillEffects(ctx, fake1, u5, e5);
  t('dmgMult 1.0 + 空 effects → 97 伤害（floor）', e5.hp === 203, `hp=${e5.hp}`);
  // 未知效果类型容错：告警 + 后续效果继续执行
  const fake2 = new Skill({ id: 'x02', name: '未知效果', reqLv: 1, type: 'gcd', cd: 0, cost: 0, dmgMult: 0, effects: [
    { type: 'zzz_unknown' },
    { type: 'buff', stat: 'versa', val: 10, dur: 15000 },
  ] });
  const u6 = mkUnit();
  logs.length = 0;
  let threw = false;
  try { executeSkillEffects(ctx, fake2, u6, u6); } catch (err) { threw = true; }
  t('未知效果类型不抛异常', !threw);
  t('未知效果类型记录告警', logs.some((m) => m.includes('zzz_unknown')));
  t('未知效果后继续执行 buff', u6.statBonus('versa') === 10);
  // s38 无 dur 效果 durRounds=0
  const s38 = new Skill(SKILLS_DB.find((s) => s.id === 's38'));
  t('s38 cd_reset 效果 durRounds=0（无 dur）', s38.effectRounds[0].durRounds === 0);
  // s40 新语义（末光照抄）：代价 = 当前 HP×50%、最低保留 1 HP、伤害 = 献祭 HP×20
  // 低血量可献祭（hp=100 → 献祭 50 → 50，伤害 50×20=1000）
  const u7 = mkUnit({ hp: 100 }); const e7 = mkTarget({ hp: 9999 });
  logs.length = 0;
  executeSkillEffects(ctx, new Skill(SKILLS_DB.find((s) => s.id === 's40')), u7, e7);
  t('s40 低血量可献祭（100 → 献祭 50 → 50）', u7.hp === 50 && e7.hp === 9999 - 1000, `u=${u7.hp}, e=${e7.hp}`);
  t('s40 献祭后 buff 生效（+30% 增伤）', u7.statBonus('dmg_up_pct') === 30, `buff=${u7.statBonus('dmg_up_pct')}`);
  t('s40 献祭日志记录实际伤害', logs.some((m) => m.includes('献祭 50 生命')), logs.join(' | '));
  // 最低保留 1 HP（不可自杀）：hp=2 → 献祭 1 → 1
  const u8 = mkUnit({ hp: 2 }); const e8 = mkTarget({ hp: 9999 });
  executeSkillEffects(ctx, new Skill(SKILLS_DB.find((s) => s.id === 's40')), u8, e8);
  t('s40 最低保留 1 HP（hp2 → 献祭 1 → 1）', u8.hp === 1 && e8.hp === 9999 - 20, `u=${u8.hp}, e=${e8.hp}`);
  // hp=0 才阻断（hp <= cost 即 hp<=0）
  const u8b = mkUnit({ hp: 0 }); const e8b = mkTarget({ hp: 9999 });
  executeSkillEffects(ctx, new Skill(SKILLS_DB.find((s) => s.id === 's40')), u8b, e8b);
  t('s40 hp=0 阻断（生命不足）', logs.some((m) => m.includes('生命不足')), logs.join(' | '));
}

// ---------- F. 与来源对照（53 技能逐字段） ----------
console.log('== F. 与来源对照（末光咏叹 js/data.js 逐字段）==');
let origText = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'Idle_Game_ui_zero', 'js', 'data.js'), 'utf-8').replace(/^\uFEFF/, '');
origText = origText.replace(/export\s+/g, '');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(origText + '\n;this.SKILLS_DB = SKILLS_DB;', sandbox);
const orig = sandbox.SKILLS_DB;
t('来源技能数 = 53', Array.isArray(orig) && orig.length === 53, `got ${orig && orig.length}`);
// 2026-08-11 用户定案的有意改造（与末光源差异）：cd 全部清零（仅回蓝技 s07/s34 保留）、
//   dur 毫秒→层数、desc 文案（秒→层/每层、冷却/无冷却、终焉标注）——对照排除这些字段
// 2026-08-11 删 MP/去 CD/AP 回转改造的技能（与源有意不同，effects 对照豁免）
const REWORKED = new Set(['s01', 's07', 's30', 's34', 's38', 's46']);
const FIELDS = ['id', 'name', 'reqLv', 'type', 'dmgMult', 'priority', 'conditionMaxHPPct']; // cost 已删（有意改造排除）
const norm = (v) => JSON.stringify(v, Object.keys(v || {}).sort());
let fieldMismatch = 0, effMismatch = 0;
const mismatches = [];
for (let i = 0; i < Math.max(orig.length, SKILLS_DB.length); i++) {
  const o = orig[i], n = SKILLS_DB[i];
  if (!o || !n) { mismatches.push(`${i}: 数量不齐`); fieldMismatch++; continue; }
  for (const f of FIELDS) {
    if (f === 'name' && REWORKED.has(n.id)) continue; // s34 改名（有意改造）
    if (JSON.stringify(o[f]) !== JSON.stringify(n[f])) {
      fieldMismatch++;
      mismatches.push(`${n.id}.${f}: 源=${JSON.stringify(o[f])} 现=${JSON.stringify(n[f])}`);
    }
  }
  // effects 对照：排除 dur（层数制改造）后逐效果字段一致；REWORKED 技能豁免（体系改造）
  const normEff = (effs) => JSON.stringify((effs || []).map((e) => { const { dur, ...rest } = e || {}; return rest; }));
  if (!REWORKED.has(n.id) && normEff(o.effects) !== normEff(n.effects)) {
    effMismatch++;
    mismatches.push(`${n.id}.effects: 源=${JSON.stringify(o.effects)} 现=${JSON.stringify(n.effects)}`);
  }
}
t('逐字段对照无差异（移植完整性，cd/dur/desc 为有意改造排除）', fieldMismatch === 0 && effMismatch === 0, mismatches.slice(0, 5).join(' | '));
t('技能顺序一致（按索引逐位对照）', orig.length === SKILLS_DB.length && orig.every((o, i) => o.id === SKILLS_DB[i].id));

console.log(`\n========== 边界补测：${pass} PASS / ${fail} FAIL ==========`);
process.exit(fail ? 1 : 0);
