// ============================================================
// tools/test_skills.mjs — 技能表与 Skill 类测试（Fate_echo Phase 0）
// 验证：53 技能完整、字段合法、与来源对照、回合制换算、状态机
// 用法: node tools/test_skills.mjs
// ============================================================

import { SKILLS_DB, validateSkillsDB, EFFECT_TYPES, DOMAIN_TYPES } from '../js/data.js';
import { Skill, msToRounds, DOMAIN_DUR_ROUNDS } from '../js/skill.js';

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

console.log('== 技能表完整性 ==');
const v = validateSkillsDB();
t(`53 技能（52+1 被动）: ${v.count}`, v.count === 53);
t('字段校验无错误', v.errors.length === 0, v.errors.join('; '));

console.log('== 校验器健壮性（validateSkillsDB 子字段/类型/范围）==');
const bad1 = validateSkillsDB([{ id: 'x1', reqLv: 1, cd: 0, cost: 0, dmgMult: 1, type: 'gcd', effects: {} }]);
t('effects 非数组 → 报告错误而非抛异常', bad1.errors.some((m) => m.includes('effects 非法')));
const bad2 = validateSkillsDB([
  { id: 'x2', reqLv: 1, cd: 0, cost: 0, dmgMult: 1, type: 'buff', effects: [{ type: 'buff', stat: 'versa', val: 'abc', dur: 15000 }] },
  { id: 'x3', reqLv: 1, cd: 0, cost: 0, dmgMult: 1, type: 'dot', effects: [{ type: 'dot', dps: NaN, dur: -5000 }] },
  { id: 'x9', reqLv: 1, cd: 0, cost: 0, dmgMult: 1, type: 'buff', effects: [{ type: 'hot', pct: 'bad', dur: 10000 }] },
  { id: 'x10', reqLv: 1, cd: 0, cost: 0, dmgMult: 1, type: 'ogcd', effects: [{ type: 'shield', hpPct: NaN, dur: 10000 }] },
  { id: 'x11', reqLv: 1, cd: 0, cost: 0, dmgMult: 1, type: 'gcd', effects: [{ type: 'hp_sacrifice', costPct: -0.5, dmgMult: 20 }] },
  { id: 'x12', reqLv: 1, cd: 0, cost: 0, dmgMult: 1, type: 'gcd', effects: [{ type: 'hp_sacrifice', costPct: 0.5, dmgMult: NaN }] },
]);
t('数值子字段全 7 项（val/dps/dur/pct/hpPct/costPct/dmgMult）拒绝字符串/NaN/负数',
  ['val', 'dps', 'dur', 'pct', 'hpPct', 'costPct', 'dmgMult'].every((f) => bad2.errors.some((m) => m.includes(`${f} 非法`))),
  bad2.errors.join('; '));
const bad3 = validateSkillsDB([
  { id: 'x4', reqLv: 1, cd: 0, cost: 0, dmgMult: 1, type: 'ogcd', conditionMaxHPPct: 150, effects: [] },
  { id: 'x6', reqLv: 1, cd: 0, cost: 0, dmgMult: 1, type: 'gcd', conditionMaxHPPct: 0, effects: [] },
  { id: 'x7', reqLv: 1, cd: 0, cost: 0, dmgMult: 1, type: 'gcd', conditionMaxHPPct: -5, effects: [] },
]);
t('conditionMaxHPPct 越界（>100/≤0）被拒绝', bad3.errors.length === 3 && bad3.errors.every((m) => m.includes('conditionMaxHPPct 非法')), bad3.errors.join('; '));
const bad4 = validateSkillsDB([{ id: 'x5', reqLv: 1, cd: 0, cost: 0, dmgMult: 1, type: 'gcd', priority: NaN, effects: [] }]);
t('priority 非数值被拒', bad4.errors.some((m) => m.includes('priority 非法')));
const bad5 = validateSkillsDB([{ id: 'x8', reqLv: 1, cd: 0, cost: 0, dmgMult: 1, type: 'gcd', effects: [null] }]);
t('effects 数组含非对象条目（null）→ 报告错误而非崩溃', bad5.errors.some((m) => m.includes('效果条目非法')), bad5.errors.join('; '));
const good = validateSkillsDB([
  { id: 'g1', reqLv: 1, cd: 0, cost: 0, dmgMult: 1, type: 'gcd', conditionMaxHPPct: 100, effects: [] },
  { id: 'g2', reqLv: 1, cd: 0, cost: 0, dmgMult: 1, type: 'dot', effects: [{ type: 'dot', dps: 0, dur: 1000 }] },
]);
t('边界合法值（conditionMaxHPPct=100、dps=0）不误报', good.errors.length === 0, good.errors.join('; '));
t('健壮性用例不含有效技能误报', bad1.count === 1 && bad2.count === 6 && bad3.count === 3 && bad4.count === 1 && bad5.count === 1 && good.count === 2);

console.log('== 与来源对照（末光咏叹 js/data.js）==');
// 文本级对照：id 全集一致（排除来源的词缀/宝珠 id）；路径相对本仓库（来源项目只读）
const { readFileSync } = await import('node:fs');
const { join, dirname } = await import('node:path');
const { fileURLToPath } = await import('node:url');
const origPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'Idle_Game_ui_zero', 'js', 'data.js');
const origText = readFileSync(origPath, 'utf-8');
const origIds = new Set([...origText.matchAll(/id: '([a-z0-9_]+)'/g)].map((m) => m[1]).filter((id) => id.startsWith('s')));
const ourIds = new Set(SKILLS_DB.map((s) => s.id));
const missing = [...origIds].filter((id) => !ourIds.has(id));
const extra = [...ourIds].filter((id) => !origIds.has(id));
t(`来源 53 个技能 id 全部移植（缺失 ${missing.length}）`, missing.length === 0, missing.join(','));
t(`无多余技能 id（多余 ${extra.length}）`, extra.length === 0, extra.join(','));

console.log('== 回合制换算（2026-08-11 彻底去 CD：全部技能无冷却） ==');
const skills = SKILLS_DB.map((d) => new Skill(d));
t('53 个 Skill 全部可实例化', skills.length === 53);
const expect = { s01: 0, s03: 0, s06: 0, s09: 0, s14: 0, s32: 0, s39: 0, s38: 0, s40: 0, s47: 0, s07: 0, s30: 0, s34: 0, s45: 0 };
for (const [id, cd] of Object.entries(expect)) {
  const s = skills.find((x) => x.id === id);
  t(`${id} ${s.name} 冷却 ${s.cd}ms → ${s.cdRounds} 回合`, s.cdRounds === cd);
}
t('msToRounds 基础：2500→1 / 0→0', msToRounds(2500) === 1 && msToRounds(0) === 0 && msToRounds(100) === 1);
for (const id of ['s48', 's49', 's50', 's51', 's52']) {
  const s = skills.find((x) => x.id === id);
  t(`${id} ${s.name} 领域持续 ${s.effectRounds[0].durRounds} 回合（特例 5）`, s.effectRounds[0].durRounds === DOMAIN_DUR_ROUNDS);
}
const dotChecks = { s04: 5, s42: 6 };
for (const [id, exp] of Object.entries(dotChecks)) {
  const s = skills.find((x) => x.id === id);
  t(`${id} dot 持续 ${s.effectRounds[0].durRounds} 层（层数制）`, s.effectRounds[0].durRounds === exp);
}
// 层数制：buff/hot/shield 的 dur 直接为层数（每回合 -1 层）
const layerChecks = { s02: 6, s12: 4, s13: 4, s15: 8 };
for (const [id, exp] of Object.entries(layerChecks)) {
  const s = skills.find((x) => x.id === id);
  t(`${id} 持续 ${s.effectRounds[0].durRounds} 层（层数制，非秒换算）`, s.effectRounds[0].durRounds === exp);
}

console.log('== Skill 状态机 ==');
const s01 = skills[0]; // cd 0
t('s01 use 不置冷却（cd0）', s01.use() && s01.currentCd === 0 && s01.ready);
const s07 = skills.find((s) => s.id === 's07'); // 彻底去 CD：无冷却
t('s07 use 不置冷却（cd0）', s07.use() && s07.currentCd === 0 && s07.ready);
t('s07 连续 use 恒 true', s07.use() && s07.use());
s07.tick();
t('s07 tick 后仍 0', s07.currentCd === 0);

console.log('== 类型与条件 ==');
t('主技能(gcd) 20 个', skills.filter((s) => s.isMain).length === 20);
t('瞬发(ogcd) 9 个', skills.filter((s) => s.isInstant).length === 9);
t('领域 5 个', skills.filter((s) => s.isDomain).length === 5);
t('被动 1 个', skills.filter((s) => s.isPassive).length === 1);
const s45 = skills.find((s) => s.id === 's45');
t('s45 有血量条件（HP<30%）', s45.conditionMaxHPPct === 30);
const mock = { hpPct: () => 0.5 };
t('s45 HP50% 不满足条件', !s45.conditionMet(mock));
const mock2 = { hpPct: () => 0.2 };
t('s45 HP20% 满足条件', s45.conditionMet(mock2));
const s01n = skills[0];
t('s01 无条件（恒满足）', s01n.conditionMet({ hpPct: () => 0.9 }));
t('效果类型全集 13 种（含 ap_recover 回行动点；mp_recover 已删）', EFFECT_TYPES.length === 13 && EFFECT_TYPES.includes('ap_recover') && !EFFECT_TYPES.includes('mp_recover'));
t('领域类型 5 种', DOMAIN_TYPES.length === 5);

console.log(`\n========== 技能测试：${pass} PASS / ${fail} FAIL ==========`);
process.exit(fail ? 1 : 0);
