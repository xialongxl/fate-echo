// ============================================================
// tools/_fuzz_validate.mjs — 第 6 + 7 + 8 + 9 轮终审：防御层系统化对抗性输入测试
// 目标：validateSkillsDB / Skill 构造 / CombatUnit / calcDamage
//       对任意畸形输入【不崩溃】且【正确报告/安全回退】，并做全 53 技能运行冒烟。
// 用例 A：validateSkillsDB 输入形态（db 本身畸形）
// 用例 B：技能字段值畸形（reqLv/cd/cost/dmgMult/priority/type/id/conditionMaxHPPct）
// 用例 C：effects 畸形（非数组/条目类型/子字段）
// 用例 D：Skill 构造对畸形 data 的容错
// 用例 E：CombatUnit 构造边界 + 状态安全（NaN 不污染 hp/mp）
// 用例 F：calcDamage 极端输入（结果必须有限）
// 用例 G：合法数据回归（53 技能零错误）
// 用例 H：全技能运行冒烟（53 技能逐一施放：构造→use→执行→回合结算）
// 用例 I：回合结算与状态防御（第 7 轮：护盾 NaN / dot 缺 source / 上限异常 / vuln val=0；
//          第 8 轮：vuln dur=0 永久残留 / vulnMult 非有限·负值污染 / tickStatus 残留兜底；
//          第 9 轮：dot/hot dur=0 落地跳伤跳疗 / hp_sacrifice maxHp=NaN 污染 hp /
//                   状态数组畸形条目（null/原始值）tickStatus·statBonus 崩溃）
// 用法: node tools/_fuzz_validate.mjs
// ============================================================

import { SKILLS_DB, validateSkillsDB, EFFECT_TYPES, DOMAIN_TYPES } from '../js/data.js';
import { Skill, DOMAIN_DUR_ROUNDS } from '../js/skill.js';
import { CombatUnit } from '../js/unit.js';
import { executeSkillEffects, tickDotsHots, calcDamage } from '../js/effects.js';

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};
const safe = (fn) => { try { fn(); return null; } catch (e) { return e; } };

const mkUnit = (o = {}) => new CombatUnit(Object.assign(
  { name: '源', hp: 500, maxHp: 500, mp: 200, maxMp: 200, atk: 100, def: 10, level: 10, critChance: 0 },
  o,
));
const mkTarget = (o = {}) => mkUnit(Object.assign({ name: '靶', hp: 300 }, o));

const ctx = {
  log: () => {},
  openDomain: (d) => { ctx.domain = d; },
  grantAp: () => {}, // AP 回转（s01 等）：桩即可（fuzz 不校验 AP）
};

// 单技能畸形 DB 构造器
const mkEntry = (over = {}) => Object.assign(
  { id: 't1', reqLv: 1, dmgMult: 0, type: 'main', priority: 1, effects: [] },
  over,
);
// 校验必须：不崩溃 + 报错
const mustReject = (name, entry) => {
  let out = null, err = null;
  try { out = validateSkillsDB([entry]); } catch (e) { err = e; }
  t(name, err === null && out.errors.length > 0, err ? `抛出异常: ${err.message}` : '');
};
// 校验必须：不崩溃 + 零错误
const mustAccept = (name, entry) => {
  let out = null, err = null;
  try { out = validateSkillsDB([entry]); } catch (e) { err = e; }
  t(name, err === null && out.errors.length === 0, err ? `抛出异常: ${err.message}` : `errors=${out && out.errors}`);
};

// ---------- A. validateSkillsDB 输入形态 ----------
console.log('== A. validateSkillsDB 输入形态（db 本身畸形）==');
{
  let r = null, err = null;
  try { r = validateSkillsDB(null); } catch (e) { err = e; }
  t('A1 db=null 不崩溃且报错', err === null && r.errors.length > 0, err ? err.message : '');
  err = null;
  try { r = validateSkillsDB([null]); } catch (e) { err = e; }
  t('A2 db=[null]（数组含 null 条目）不崩溃且报错', err === null && r.errors.length > 0, err ? err.message : '');
  err = null;
  try { r = validateSkillsDB({}); } catch (e) { err = e; }
  t('A3 db={}（非数组对象）不崩溃且报错', err === null && r.errors.length > 0, err ? err.message : '');
  err = null;
  try { r = validateSkillsDB('abc'); } catch (e) { err = e; }
  t('A4 db=字符串不崩溃且报错', err === null && r.errors.length > 0, err ? err.message : '');
  err = null;
  try { r = validateSkillsDB([['s01']]); } catch (e) { err = e; }
  t('A5 db=嵌套数组条目（数组套数组）不崩溃且报错', err === null && r.errors.length > 0, err ? err.message : '');
  err = null;
  try { r = validateSkillsDB([]); } catch (e) { err = e; }
  t('A6 db=[] 不崩溃、零错误', err === null && r.errors.length === 0 && r.count === 0, err ? err.message : '');
  err = null;
  try { r = validateSkillsDB(); } catch (e) { err = e; }
  t('A7 db 缺省 → 默认 53 技能零错误', err === null && r.errors.length === 0 && r.count === 53, err ? err.message : `errors=${r && r.errors.length}`);
  err = null;
  try { r = validateSkillsDB([() => {}]); } catch (e) { err = e; }
  t('A8 db=[函数] 不崩溃且报错', err === null && r.errors.length > 0, err ? err.message : '');
}

// ---------- B. 字段值畸形 ----------
console.log('== B. 字段值畸形（Symbol/BigInt/对象/字符串/NaN/Infinity/负值）==');
{
  mustReject('B1 reqLv=字符串', mkEntry({ reqLv: '10' }));
  mustReject('B2 reqLv=NaN', mkEntry({ reqLv: NaN }));
  mustReject('B3 reqLv=Infinity', mkEntry({ reqLv: Infinity }));
  mustReject('B4 reqLv=负值', mkEntry({ reqLv: -1 }));
  mustReject('B5 reqLv=Symbol', mkEntry({ reqLv: Symbol('lv') }));
  mustReject('B6 reqLv=BigInt', mkEntry({ reqLv: 10n }));
  mustReject('B7 reqLv=对象', mkEntry({ reqLv: {} }));
  mustReject('B16 dmgMult=NaN', mkEntry({ dmgMult: NaN }));
  mustReject('B17 dmgMult=Infinity', mkEntry({ dmgMult: Infinity }));
  mustReject('B18 dmgMult=字符串', mkEntry({ dmgMult: '2' }));
  mustReject('B19 dmgMult=负值', mkEntry({ dmgMult: -0.5 }));
  mustReject('B20 dmgMult=Symbol', mkEntry({ dmgMult: Symbol('d') }));
  mustReject('B21 priority=字符串', mkEntry({ priority: 'high' }));
  mustReject('B22 priority=NaN', mkEntry({ priority: NaN }));
  mustReject('B23 priority=Symbol', mkEntry({ priority: Symbol('p') }));
  mustReject('B24 type=未知', mkEntry({ type: 'unknown_zzz' }));
  mustReject('B25 type=null', mkEntry({ type: null }));
  mustReject('B26 type=Symbol', mkEntry({ type: Symbol('t') }));
  {
    let out = null, err = null;
    try { out = validateSkillsDB([mkEntry({ id: 'dup' }), mkEntry({ id: 'dup' })]); } catch (e) { err = e; }
    t('B27 id 重复报错', err === null && out.errors.length > 0, err ? err.message : '');
  }
  mustReject('B28 id=Symbol + 非法字段（错误信息安全拼接）', mkEntry({ id: Symbol('id'), reqLv: -1 }));
  mustAccept('B29 id=Symbol 且其余字段合法 → 不崩溃', mkEntry({ id: Symbol('id') }));
  mustReject('B30 conditionMaxHPPct=字符串', mkEntry({ conditionMaxHPPct: '30' }));
  mustReject('B31 conditionMaxHPPct=NaN', mkEntry({ conditionMaxHPPct: NaN }));
  mustReject('B32 conditionMaxHPPct=Infinity', mkEntry({ conditionMaxHPPct: Infinity }));
  mustReject('B33 conditionMaxHPPct=0', mkEntry({ conditionMaxHPPct: 0 }));
  mustReject('B34 conditionMaxHPPct=101', mkEntry({ conditionMaxHPPct: 101 }));
  mustReject('B35 conditionMaxHPPct=负值', mkEntry({ conditionMaxHPPct: -5 }));
  mustReject('B36 conditionMaxHPPct=Symbol', mkEntry({ conditionMaxHPPct: Symbol('c') }));
}

// ---------- C. effects 畸形 ----------
console.log('== C. effects 畸形（非数组/条目类型/子字段）==');
{
  mustReject('C1 effects=字符串', mkEntry({ effects: 'abc' }));
  mustReject('C2 effects=数字', mkEntry({ effects: 123 }));
  mustReject('C3 effects=null', mkEntry({ effects: null }));
  mustReject('C4 effects=对象（非数组）', mkEntry({ effects: {} }));
  mustReject('C5 effects=[null]（第5轮修复回归）', mkEntry({ effects: [null] }));
  mustReject('C6 effects=[undefined]', mkEntry({ effects: [undefined] }));
  mustReject('C7 effects=[字符串条目]', mkEntry({ effects: ['buff'] }));
  mustReject('C8 effects=[数字条目]', mkEntry({ effects: [123] }));
  mustReject('C9 effects=[函数条目]', mkEntry({ effects: [() => {}] }));
  mustReject('C10 effects=[Symbol 条目]', mkEntry({ effects: [Symbol('e')] }));
  mustReject('C11 effects=[BigInt 条目]', mkEntry({ effects: [10n] }));
  mustReject('C12 effects=[嵌套数组条目]', mkEntry({ effects: [[]] }));
  mustReject('C13 effects=[数组内再套数组对象]', mkEntry({ effects: [[{ type: 'buff' }]] }));
  mustReject('C14 effects 条目类型未知', mkEntry({ effects: [{ type: 'zzz' }] }));
  mustReject('C15 effects 条目 type=Symbol', mkEntry({ effects: [{ type: Symbol('x') }] }));
  mustReject('C16 effects 条目缺 type', mkEntry({ effects: [{}] }));
  mustReject('C17 buff 缺子字段', mkEntry({ effects: [{ type: 'buff' }] }));
  mustReject('C18 buff val 负值', mkEntry({ effects: [{ type: 'buff', stat: 'versa', val: -1, dur: 15000 }] }));
  mustReject('C19 dot dps=NaN', mkEntry({ effects: [{ type: 'dot', dps: NaN, dur: 10000 }] }));
  mustReject('C20 domain 缺 domainType', mkEntry({ effects: [{ type: 'domain', dps: 5, dur: 60000 }] }));
  mustReject('C21 domain domainType=Symbol', mkEntry({ effects: [{ type: 'domain', dps: 5, dur: 60000, domainType: Symbol('v') }] }));
  mustReject('C22 buff dur=字符串', mkEntry({ effects: [{ type: 'buff', stat: 'versa', val: 10, dur: '15000' }] }));
  mustReject('C23 vuln dur=负值', mkEntry({ effects: [{ type: 'vuln', val: 1.2, dur: -3 }] }));
  mustReject('C24 heal val=Infinity', mkEntry({ effects: [{ type: 'heal', val: Infinity }] }));
  mustReject('C25 heal val=BigInt', mkEntry({ effects: [{ type: 'heal', val: 5n }] }));
  mustReject('C26 buff val=字符串（且缺 stat）', mkEntry({ effects: [{ type: 'buff', val: 'x', dur: 15000 }] }));
  mustAccept('C27 domain 合法（含 domainType）', mkEntry({ effects: [{ type: 'domain', dps: 5, dur: 60000, domainType: 'void' }] }));
  mustAccept('C28 hp_sacrifice 合法', mkEntry({ effects: [{ type: 'hp_sacrifice', costPct: 0.5, dmgMult: 20 }] }));
  mustAccept('C30 buff stat=Symbol（stat 非校验字段）不崩溃', mkEntry({ effects: [{ type: 'buff', stat: Symbol('s'), val: 10, dur: 15000 }] }));
}

// ---------- D. Skill 构造容错 ----------
console.log('== D. Skill 构造对畸形 data 的容错 ==');
{
  let s = null, err = null;
  err = safe(() => { s = new Skill({}); });
  t('D1 new Skill({}) 不崩溃', err === null && s.rawEffects.length === 0 && s.effectRounds.length === 0, err ? err.message : '');
  err = safe(() => { s = new Skill(); });
  t('D2 new Skill()（无参数）不崩溃', err === null, err ? err.message : '');
  err = safe(() => { s = new Skill({ effects: 'abc' }); });
  t('D3 effects=字符串 → 容错为空效果列表', err === null && s.effectRounds.length === 0, err ? err.message : '');
  err = safe(() => { s = new Skill({ effects: 123 }); });
  t('D4 effects=数字 → 容错为空效果列表', err === null && s.effectRounds.length === 0, err ? err.message : '');
  err = safe(() => { s = new Skill({ effects: null }); });
  t('D5 effects=null → 容错', err === null && s.effectRounds.length === 0, err ? err.message : '');
  err = safe(() => { s = new Skill({ effects: [null] }); });
  t('D6 effects=[null] 条目 → 构造不崩溃且 durRounds=0', err === null && s.effectRounds[0].durRounds === 0, err ? err.message : '');
  err = safe(() => { s = new Skill({ effects: [undefined] }); });
  t('D7 effects=[undefined] 条目 → 构造不崩溃', err === null && s.effectRounds[0].durRounds === 0, err ? err.message : '');
  err = safe(() => { s = new Skill({ effects: [5] }); });
  t('D8 effects=[数字条目] → 构造不崩溃', err === null, err ? err.message : '');
  err = safe(() => { s = new Skill({ effects: [{ type: 'buff', dur: 'abc' }] }); });
  t('D9 e.dur=字符串 → durRounds=0', err === null && s.effectRounds[0].durRounds === 0, err ? err.message : `durRounds=${s.effectRounds[0].durRounds}`);
  err = safe(() => { s = new Skill({ effects: [{ type: 'buff', dur: Symbol() }] }); });
  t('D10 e.dur=Symbol → durRounds=0', err === null && s.effectRounds[0].durRounds === 0, err ? err.message : '');
  err = safe(() => { s = new Skill({ effects: [{ type: 'buff', dur: NaN }] }); });
  t('D11 e.dur=NaN → durRounds=0', err === null && s.effectRounds[0].durRounds === 0, err ? err.message : '');
  err = safe(() => { s = new Skill({ effects: [{ type: 'domain', dur: 60000 }] }); });
  t('D12 domain dur → 特例 5 回合', err === null && s.effectRounds[0].durRounds === DOMAIN_DUR_ROUNDS, err ? err.message : '');
  err = safe(() => { s = new Skill({ conditionMaxHPPct: 'x' }); });
  t('D15 conditionMaxHPPct=字符串 → 构造不崩溃', err === null, err ? err.message : '');
  err = safe(() => { s = new Skill({ dmgMult: 'x' }); });
  t('D16 dmgMult=字符串 → 构造不崩溃', err === null, err ? err.message : '');
  // 畸形构造后执行不崩（防御纵深）
  const u = mkUnit(); const tg = mkTarget();
  err = safe(() => executeSkillEffects(ctx, new Skill({ effects: 'abc' }), u, tg));
  t('D17 effects=字符串 的技能执行不崩溃', err === null, err ? err.message : '');
  err = safe(() => executeSkillEffects(ctx, new Skill({ effects: [null, undefined, 'buff'] }), u, tg));
  t('D18 effects=[null,undefined,字符串] 的技能执行不崩溃', err === null, err ? err.message : '');
  // 构造出的畸形效果列表长度正确（null 条目保留为对象）
  const s6 = new Skill({ effects: [null] });
  t('D19 畸形条目不改变 effectRounds 结构', s6.effectRounds.length === 1);
  err = safe(() => { s = new Skill(null); });
  t('D20 data=null → 构造不崩溃（与无参同语义）', err === null && s.effectRounds.length === 0, err ? err.message : '');
  err = safe(() => { s = new Skill(42); });
  t('D21 data=非对象原始值 → 构造不崩溃', err === null && s.effectRounds.length === 0, err ? err.message : '');
}

// ---------- E. CombatUnit 构造边界 + NaN 安全 ----------
console.log('== E. CombatUnit 构造边界（负 hp/负 maxHp/负 atk/NaN）==');
{
  const u1 = new CombatUnit({ hp: -10, maxHp: 100 });
  t('E1 负 hp：alive=false 且 hpPct 有限', !u1.alive && Number.isFinite(u1.hpPct()) && u1.hpPct() === -0.1, `hpPct=${u1.hpPct()}`);
  const u2 = new CombatUnit({ hp: 50, maxHp: -100 });
  t('E2 负 maxHp：hpPct()=0（防除零/NaN）', u2.hpPct() === 0 && Number.isFinite(u2.hpPct()));
  const u3 = new CombatUnit({ atk: -5 });
  t('E3 负 atk：calcDamage 不崩溃且有限', Number.isFinite(calcDamage(u3, mkTarget(), 1.0, { noCrit: true, noMitigation: true })));
  const u4 = new CombatUnit({ hp: NaN, maxHp: NaN });
  t('E4 hp/maxHp=NaN：hpPct()=0 不 NaN', u4.hpPct() === 0 && !u4.alive);
  const u5 = new CombatUnit({ maxHp: 0 });
  t('E5 maxHp=0：hpPct()=0 不 NaN', u5.hpPct() === 0);
  const u6 = mkUnit({ hp: 300 });
  const r6 = u6.takeDamage(NaN);
  t('E6 takeDamage(NaN) → 0 且 hp 不污染为 NaN', r6 === 0 && u6.hp === 300 && Number.isFinite(u6.hp), `ret=${r6}, hp=${u6.hp}`);
  const u7 = mkUnit({ hp: 300 });
  const r7 = u7.heal(NaN);
  t('E7 heal(NaN) → 0 且 hp 不污染为 NaN', r7 === 0 && u7.hp === 300 && Number.isFinite(u7.hp), `ret=${r7}, hp=${u7.hp}`);
  const u8 = mkUnit({ mp: 150 });
  const r8 = u8.restoreMp(NaN);
  t('E8 restoreMp(NaN) → 0 且 mp 不污染为 NaN', r8 === 0 && u8.mp === 150 && Number.isFinite(u8.mp), `ret=${r8}, mp=${u8.mp}`);
  const u9 = mkUnit({ hp: 300 });
  const r9 = u9.takeDamage(Infinity);
  t('E9 takeDamage(Infinity) → 0 且 hp 不变不 NaN', r9 === 0 && u9.hp === 300 && Number.isFinite(u9.hp), `ret=${r9}, hp=${u9.hp}`);
  const u10 = mkUnit({ hp: 100 });
  const r10 = u10.heal(Infinity);
  t('E10 heal(Infinity) → hp 不污染为 NaN', Number.isFinite(u10.hp) && u10.hp >= 100, `hp=${u10.hp}`);
  const u11 = mkUnit({ hp: 300 });
  u11.shield = { hp: 100, turns: 2 };
  const r11 = u11.takeDamage(NaN);
  t('E11 takeDamage(NaN) 不损坏护盾状态', r11 === 0 && u11.shield.hp === 100 && u11.hp === 300, `ret=${r11}, shield=${u11.shield.hp}`);
}

// ---------- F. calcDamage 极端输入 ----------
console.log('== F. calcDamage 极端输入（结果必须有限）==');
{
  const src = mkUnit();
  const tg = mkTarget();
  const f1 = calcDamage(src, tg, Infinity, { noCrit: true, noMitigation: true });
  t('F1 dmgMult=Infinity → 有限回退（不产生 Infinity 伤害）', Number.isFinite(f1), `got=${f1}`);
  const f2 = calcDamage(src, tg, NaN, { noCrit: true, noMitigation: true });
  t('F2 dmgMult=NaN → 有限回退', Number.isFinite(f2), `got=${f2}`);
  const f3 = calcDamage(src, tg, -Infinity, { noCrit: true, noMitigation: true });
  t('F3 dmgMult=-Infinity → 保底 1', f3 === 1, `got=${f3}`);
  const f4 = calcDamage(mkUnit({ atk: 0 }), tg, 1.0, { noCrit: true, noMitigation: true });
  t('F4 atk=0 → 保底 1', f4 === 1, `got=${f4}`);
  const f5 = calcDamage(mkUnit({ atk: NaN }), tg, 1.0, { noCrit: true, noMitigation: true });
  t('F5 atk=NaN → 有限回退', Number.isFinite(f5), `got=${f5}`);
  const f6 = calcDamage(mkUnit({ atk: Infinity }), tg, 1.0, { noCrit: true, noMitigation: true });
  t('F6 atk=Infinity → 有限回退', Number.isFinite(f6), `got=${f6}`);
  const f7 = calcDamage(mkUnit({ atk: 1e308 }), tg, 1e308, { noCrit: true, noMitigation: true });
  t('F7 巨大有限乘积溢出 → 有限回退（不 NaN/Infinity）', Number.isFinite(f7), `got=${f7}`);
  const f8 = calcDamage(src, mkTarget({ def: NaN }), 1.0, { noCrit: true });
  t('F8 target.def=NaN → 无减伤且有限', Number.isFinite(f8) && f8 > 0, `got=${f8}`);
  const f9 = calcDamage(src, mkTarget({ def: Infinity }), 1.0, { noCrit: true });
  t('F9 target.def=Infinity → 无减伤且有限', Number.isFinite(f9) && f9 > 0, `got=${f9}`);
  const f10 = calcDamage(src, mkTarget({ def: NaN, level: NaN }), 1.0, { noCrit: true });
  t('F10 target.def/level 均 NaN → 防 0/0，有限', Number.isFinite(f10) && f10 > 0, `got=${f10}`);
  const f11 = calcDamage(src, mkTarget({ level: NaN }), 1.0, { noCrit: true });
  t('F11 target.level=NaN → 有限', Number.isFinite(f11), `got=${f11}`);
  const f12 = calcDamage(src, mkTarget({ def: -10 }), 1.0, { noCrit: true });
  t('F12 target.def 负值 → 减伤夹取 0，有限', Number.isFinite(f12) && f12 > 0, `got=${f12}`);
  // 走完整管线：calcDamage → takeDamage 不产生 NaN 状态
  const srcN = mkUnit({ atk: NaN });
  const tgN = mkTarget();
  tgN.takeDamage(calcDamage(srcN, tgN, 1.0, { noCrit: true, noMitigation: true }));
  t('F13 atk=NaN 全管线 → 目标 hp 不 NaN', Number.isFinite(tgN.hp), `hp=${tgN.hp}`);
  // 护盾下 Infinity 伤害
  const tgS = mkTarget();
  tgS.shield = { hp: 100, turns: 2 };
  const f14 = calcDamage(mkUnit({ atk: Infinity }), tgS, 1.0, { noCrit: true, noMitigation: true });
  t('F14 Infinity 伤害+护盾 → 盾/hp 不 NaN', Number.isFinite(f14) && Number.isFinite(tgS.hp) && (tgS.shield === null || Number.isFinite(tgS.shield.hp)), `dmg=${f14}, hp=${tgS.hp}`);
}

// ---------- G. 合法数据回归 ----------
console.log('== G. 合法数据回归（53 技能）==');
{
  const v = validateSkillsDB(SKILLS_DB);
  t('G1 validateSkillsDB(SKILLS_DB) 零错误', v.errors.length === 0, v.errors.slice(0, 3).join(' | '));
  t('G2 技能数 = 53', v.count === 53, `count=${v.count}`);
  t('G3 效果类型全集 = 12 种（含 ap_recover；mp_recover/重置类已删）', EFFECT_TYPES.length === 12 && EFFECT_TYPES.includes('ap_recover') && !EFFECT_TYPES.includes('mp_recover') && DOMAIN_TYPES.length === 5);
}

// ---------- H. 全技能运行冒烟（53 技能逐一施放） ----------
console.log('== H. 全技能运行冒烟（53 技能：构造→use→执行→回合结算）==');
{
  let constructOk = 0, useOk = 0, execOk = 0, tickOk = 0;
  const ctx2 = {
    log: () => {},
      openDomain: (d) => { ctx2.domain = d; },
    grantAp: (u, n) => { ctx2.apGain = (ctx2.apGain || 0) + (Number.isFinite(n) ? Math.max(0, n) : 0); },
  };
  for (const entry of SKILLS_DB) {
    const tag = `[${entry.id}]`;
    let skill = null, err = null;
    err = safe(() => { skill = new Skill(entry); });
    if (err === null) constructOk++; else console.log(`    ✗ ${tag} 构造失败: ${err.message}`);
    if (!skill) continue;
    err = safe(() => { if (!skill.use()) throw new Error('use 返回 false'); });
    if (err === null) useOk++;
    // 源单位压低 hp/mp 以验证治疗/回蓝实际生效；hp 400 > s40 献祭代价 250（成功分支）
    const src = mkUnit({ hp: 400, maxHp: 500, mp: 100, maxMp: 200 });
    const tg = mkTarget();
    const srcHp0 = src.hp, srcMp0 = src.mp, tgHp0 = tg.hp;
    ctx2.apGain = 0; // 每技能重置（回 AP 量按单技能计）
    err = safe(() => executeSkillEffects(ctx2, skill, src, tg));
    if (err === null) execOk++; else console.log(`    ✗ ${tag} 执行失败: ${err.message}`);
    // 立即伤害
    if (err === null && entry.dmgMult > 0) {
      t(`${tag} 立即伤害生效（dmgMult=${entry.dmgMult}）`, tg.hp < tgHp0, `hp=${tg.hp}`);
    }
    // 效果落位（自增益→施放者 / 对敌→目标）
    for (const e of entry.effects || []) {
      switch (e.type) {
        case 'buff':
          t(`${tag} buff 落位（${e.stat}+${e.val}）`, src.buffs.some((b) => b.stat === e.stat && b.val === e.val));
          break;
        case 'dot':
          t(`${tag} dot 落位（dps=${e.dps}）`, tg.dots.some((d) => d.dps === e.dps && d.turns > 0));
          break;
        case 'heal':
          t(`${tag} 治疗生效（实际恢复量）`, src.hp > srcHp0, `hp=${src.hp}`);
          break;
        case 'hot':
          t(`${tag} hot 落位`, src.hots.length > 0 && src.hots[0].turns > 0);
          break;
        case 'shield':
          t(`${tag} 护盾落位`, src.shield !== null && src.shield.hp > 0 && src.shield.turns > 0);
          break;
        case 'vuln':
          t(`${tag} 易伤落位（×${e.val}）`, tg.vulnTurns > 0 && tg.vulnMult === e.val);
          break;
        case 'ap_recover':
          t(`${tag} 回行动点（${e.val}）`, (ctx2.apGain || 0) >= 1, `apGain=${ctx2.apGain}`);
          break;
        case 'hp_sacrifice':
          t(`${tag} 献祭：扣血+出伤 或 血量不足阻断`, (src.hp < srcHp0 && tg.hp < tgHp0) || (src.hp === srcHp0 && tg.hp === tgHp0 && src.statBonus('dmg_up_pct') === 0), `src=${src.hp}/${srcHp0}, tg=${tg.hp}/${tgHp0}`);
          break;
        case 'dot_enhance':
          t(`${tag} dot 强化落位`, src.dotEnhanced > 0);
          break;
        case 'channel_immune':
          t(`${tag} 无敌落位`, src.immuneTurns > 0);
          break;
        case 'cond_full_heal':
          t(`${tag} 条件回满（HP/AP 全恢复）`, src.hp === src.maxHp && ctx2.apGain === 99, `hp=${src.hp}, apGain=${ctx2.apGain}`);
          break;
        case 'domain':
          t(`${tag} 领域展开（${e.domainType}）`, ctx2.domain !== undefined && ctx2.domain.type === e.domainType && ctx2.domain.turns === DOMAIN_DUR_ROUNDS, ctx2.domain ? `type=${ctx2.domain.type}` : 'domain 未展开');
          break;
      }
    }
    // 回合结算（tickStatus + dot/hot）不崩
    err = safe(() => { src.tickStatus(); tg.tickStatus(); tickDotsHots(ctx2, tg); });
    if (err === null) { /* 已覆盖 */ } else console.log(`    ✗ ${tag} 回合结算失败: ${err.message}`);
  }
  t('H0 53 技能全部构造成功', constructOk === 53, `${constructOk}/53`);
  t('H1 53 技能首次 use 均成功', useOk === 53, `${useOk}/53`);
  t('H2 53 技能执行均不崩溃', execOk === 53, `${execOk}/53`);
  // 全技能 canUse/conditionMet 不崩
  let condOk = 0;
  for (const entry of SKILLS_DB) {
    const skill = new Skill(entry);
    const err = safe(() => { skill.canUse({ hpPct: () => 0.2 }); skill.conditionMet({ hpPct: () => 0.2 }); });
    if (err === null) condOk++;
  }
  t('H4 53 技能 canUse/conditionMet 不崩溃', condOk === 53, `${condOk}/53`);
  // s41→s04 联动：dot 强化双倍结算
  {
    const src = mkUnit(); const tg = mkTarget();
    executeSkillEffects(ctx2, new Skill(SKILLS_DB.find((s) => s.id === 's41')), src, src); // dot_enhance 自增益
    executeSkillEffects(ctx2, new Skill(SKILLS_DB.find((s) => s.id === 's04')), src, tg);
    const hpBefore = tg.hp;
    tickDotsHots(ctx2, tg);
    t('H5 dot 强化下每回合结算两次（等效翻倍）', tg.hp < hpBefore - 0 && hpBefore - tg.hp >= 150, `drop=${hpBefore - tg.hp}`);
  }
}

// ---------- I. 回合结算与状态防御（第 7+8 轮终审：护盾 NaN / dot 条目守卫 / 上限异常 / vuln 残留） ----------
console.log('== I. 回合结算与状态防御（护盾 NaN / dot 缺 source / maxHp·maxMp 异常 / vuln val=0）==');
{
  // 护盾 hp=NaN（畸形状态）：takeDamage 不污染 hp
  const s1 = mkTarget();
  s1.shield = { hp: NaN, turns: 2 };
  const r1 = s1.takeDamage(100);
  t('I1 盾 hp=NaN → 伤害照常、hp 不 NaN、畸形盾清除', r1 === 100 && s1.hp === 200 && s1.shield === null, `ret=${r1}, hp=${s1.hp}`);
  const s2 = mkTarget();
  s2.shield = { hp: Infinity, turns: 2 };
  const r2 = s2.takeDamage(50);
  t('I2 盾 hp=Infinity → 视为无盾、hp 不 NaN', r2 === 50 && s2.hp === 250, `ret=${r2}, hp=${s2.hp}`);
  // dot 条目缺 source：不崩溃，其他正常 dot 照常结算
  const s3 = mkTarget({ hp: 300 });
  s3.dots.push({ dps: 9, turns: 5, source: undefined, stateName: '畸形' }); // 畸形条目（无 source）
  s3.dots.push({ dps: 0.8, turns: 5, source: mkUnit({ atk: 100 }), stateName: '恶咒' });
  let threwI = false;
  let linesI = [];
  try { linesI = tickDotsHots({ log: () => {} }, s3); } catch (e) { threwI = true; }
  t('I3 dot 缺 source 不崩溃（畸形条目跳过）', !threwI && s3.hp === 300 - 78, `threw=${threwI}, hp=${s3.hp}`);
  t('I4 畸形 dot 不影响正常 dot 结算行', !threwI && linesI.length === 1, `lines=${linesI.length}`);
  // maxHp/maxMp 异常：heal/restoreMp 不污染
  const s5 = new CombatUnit({ name: 'i5', hp: 100, maxHp: NaN, mp: 50, maxMp: 50 });
  s5.heal(50);
  t('I5 maxHp=NaN heal → hp 不 NaN（以当前 hp 为上限）', s5.hp === 100 && Number.isFinite(s5.hp), `hp=${s5.hp}`);
  const s6 = new CombatUnit({ name: 'i6', hp: 100, maxHp: 100, mp: 50, maxMp: NaN });
  s6.restoreMp(50);
  t('I6 maxMp=NaN restoreMp → mp 不 NaN', s6.mp === 50 && Number.isFinite(s6.mp), `mp=${s6.mp}`);
  // 链路：maxHp=NaN 单位施放护盾 → 0 盾（不产生 NaN），受击不污染
  const s7 = new CombatUnit({ name: 'i7', hp: 300, maxHp: NaN, atk: 100, def: 10, level: 10 });
  executeSkillEffects(ctx, new Skill(SKILLS_DB.find((s) => s.id === 's13')), s7, s7);
  t('I7 maxHp=NaN 施放护盾 → 盾有限（0 盾视为无盾）', s7.shield === null || (Number.isFinite(s7.shield.hp) && s7.shield.hp === 0), `shield=${s7.shield && s7.shield.hp}`);
  const r7 = s7.takeDamage(100);
  t('I8 NaN 盾链路受击 → hp 不 NaN', Number.isFinite(s7.hp) && s7.hp === 200 && r7 === 100, `hp=${s7.hp}, ret=${r7}`);
  // maxHp=NaN 单位施放条件回满（s45）→ hp 不污染
  const s8 = new CombatUnit({ name: 'i8', hp: 100, maxHp: NaN, mp: 50, maxMp: NaN });
  executeSkillEffects(ctx, new Skill(SKILLS_DB.find((s) => s.id === 's45')), s8, s8);
  t('I9 maxHp/maxMp=NaN 条件回满 → hp/mp 不 NaN', Number.isFinite(s8.hp) && Number.isFinite(s8.mp), `hp=${s8.hp}, mp=${s8.mp}`);
  // vuln val=0（校验器允许）→ 不落入 ×1.2 陷阱
  const s9 = mkUnit(); const t9 = mkTarget();
  executeSkillEffects(ctx, new Skill({ id: 'i9', name: '无效易伤', reqLv: 1, type: 'debuff', dmgMult: 0, effects: [{ type: 'vuln', val: 0, dur: 4 }] }), s9, t9);
  t('I10 vuln val=0 → 无易伤（vulnMult 保持 1）', t9.vulnMult === 1 && t9.vulnTurns === 4, `mult=${t9.vulnMult}`);
  // vuln val=NaN（防御纵深）→ 同样不产生 ×1.2
  const s10 = mkUnit(); const t10 = mkTarget();
  executeSkillEffects(ctx, new Skill({ id: 'i10', name: 'NaN 易伤', reqLv: 1, type: 'debuff', dmgMult: 0, effects: [{ type: 'vuln', val: NaN, dur: 4 }] }), s10, t10);
  t('I11 vuln val=NaN → vulnMult 有限且为 1', t10.vulnMult === 1 && Number.isFinite(t10.vulnMult), `mult=${t10.vulnMult}`);
  // tickStatus：shield.turns 非有限 → 畸形盾清除（不残留永不失效盾）
  const s12 = mkTarget();
  s12.shield = { hp: 50, turns: NaN };
  s12.tickStatus();
  t('I12 盾 turns=NaN → tickStatus 清除盾', s12.shield === null, `shield=${JSON.stringify(s12.shield)}`);
  // 第 8 轮：vuln dur=0（校验器允许 0）→ 0 回合易伤不落地，多回合后仍 ×1（防永久 ×1.2 残留）
  const s13 = mkUnit(); const t13 = mkTarget();
  executeSkillEffects(ctx, new Skill({ id: 'i13', name: '零时易伤', reqLv: 1, type: 'debuff', dmgMult: 0, effects: [{ type: 'vuln', val: 1.2, dur: 0 }] }), s13, t13);
  for (let i = 0; i < 3; i++) t13.tickStatus();
  t('I13 vuln dur=0 → 不落地永久易伤（tick×3 后仍 ×1）', t13.vulnMult === 1 && t13.vulnTurns === 0, `mult=${t13.vulnMult}, turns=${t13.vulnTurns}`);
  // 第 8 轮：vulnMult 被外部注入 NaN/Infinity/负值 → takeDamage 不污染 hp、不产生负伤回血
  const t14 = mkTarget({ hp: 300 });
  t14.vulnMult = NaN;
  const r14 = t14.takeDamage(100);
  t('I14 vulnMult=NaN 受击 → hp 不 NaN 且返回有限', Number.isFinite(r14) && t14.hp === 200 && Number.isFinite(t14.hp), `ret=${r14}, hp=${t14.hp}`);
  const t15 = mkTarget({ hp: 300 });
  t15.vulnMult = Infinity;
  const r15 = t15.takeDamage(100);
  t('I15 vulnMult=Infinity 受击 → 视为无易伤', r15 === 100 && t15.hp === 200, `ret=${r15}, hp=${t15.hp}`);
  const t16 = mkTarget({ hp: 300 });
  t16.vulnMult = -2;
  const r16 = t16.takeDamage(100);
  t('I16 vulnMult=负值 受击 → 不产生负伤回血', r16 === 100 && t16.hp === 200, `ret=${r16}, hp=${t16.hp}`);
  // 第 8 轮：tickStatus 对 0 回合残留 vulnMult 兜底还原（防御纵深）
  const t17 = mkTarget();
  t17.vulnMult = 1.5; // 外部注入（无回合）
  t17.tickStatus();
  t('I17 无回合残留 vulnMult → tickStatus 兜底还原 ×1', t17.vulnMult === 1 && t17.vulnTurns === 0, `mult=${t17.vulnMult}`);
  // 第 9 轮：dot dur=0（校验器允许 0）→ 不落地（0 回合 = 0 伤害，总伤守恒；防"0 回合还跳 1 次全额伤害"）
  const s18 = mkUnit(); const t18 = mkTarget({ hp: 300 });
  executeSkillEffects(ctx, new Skill({ id: 'i18', name: '零时dot', reqLv: 1, type: 'dot', dmgMult: 0, effects: [{ type: 'dot', dps: 5, dur: 0 }] }), s18, t18);
  const lines18 = tickDotsHots(ctx, t18);
  t('I18 dot dur=0 → 不落地且不跳伤害', t18.dots.length === 0 && t18.hp === 300 && lines18.length === 0, `dots=${t18.dots.length}, hp=${t18.hp}`);
  // 第 9 轮：hot dur=0 → 不落地（0 回合 = 0 恢复）
  const s19 = mkUnit({ hp: 300 });
  executeSkillEffects(ctx, new Skill({ id: 'i19', name: '零时hot', reqLv: 1, type: 'buff', dmgMult: 0, effects: [{ type: 'hot', pct: 0.05, dur: 0 }] }), s19, s19);
  const lines19 = tickDotsHots(ctx, s19);
  t('I19 hot dur=0 → 不落地且不产生治疗', s19.hots.length === 0 && s19.hp === 300 && lines19.length === 0, `hots=${s19.hots.length}, hp=${s19.hp}`);
  // 第 9 轮：外部注入 turns=0 的 dot/hot 条目 → 结算跳过（防御纵深）
  const t20 = mkTarget({ hp: 300 });
  t20.dots.push({ dps: 9, turns: 0, source: mkUnit({ atk: 100 }), stateName: '注入' });
  const lines20 = tickDotsHots(ctx, t20);
  t('I20 注入 turns=0 dot → 结算跳过', t20.hp === 300 && lines20.length === 0, `hp=${t20.hp}`);
  const u21 = mkUnit({ hp: 300 });
  u21.hots.push({ pct: 0.05, turns: 0 });
  u21.hots.push(null);
  const lines21 = tickDotsHots(ctx, u21);
  t('I21 注入 turns=0 hot + null 条目 → 跳过不崩', u21.hp === 300 && lines21.length === 0, `hp=${u21.hp}`);
  // 第 9 轮：hp_sacrifice maxHp=NaN → 代价以当前 hp 为基数，hp 不被污染为 NaN
  const s22 = new CombatUnit({ name: 'i22', hp: 400, maxHp: NaN, atk: 100, def: 10, level: 10 });
  const t22 = mkTarget({ hp: 9999 });
  executeSkillEffects(ctx, new Skill({ id: 'i22', name: 'NaN献祭', reqLv: 1, type: 'main', dmgMult: 0, effects: [{ type: 'hp_sacrifice', costPct: 0.5, dmgMult: 1 }] }), s22, t22);
  t('I22 献祭 maxHp=NaN → 以当前 hp 为基数扣血（400→200），伤害=献祭HP×1', s22.hp === 200 && Number.isFinite(s22.hp) && t22.hp === 9999 - 200, `hp=${s22.hp}, t22=${t22.hp}`);
  // 第 9 轮：hp_sacrifice 施放者 hp 本身 NaN → 阻断（不执行献祭、不出伤）
  const s23 = new CombatUnit({ name: 'i23', hp: NaN, maxHp: 500, atk: 100, def: 10, level: 10 });
  const t23 = mkTarget({ hp: 9999 });
  executeSkillEffects(ctx, new Skill({ id: 'i23', name: 'NaN生命献祭', reqLv: 1, type: 'main', dmgMult: 0, effects: [{ type: 'hp_sacrifice', costPct: 0.5, dmgMult: 20 }] }), s23, t23);
  t('I23 献祭施放者 hp=NaN → 阻断不出伤', t23.hp === 9999, `t23=${t23.hp}`);
  // 第 9 轮：tickStatus 状态数组含 null/原始值条目（外部注入）→ 不崩溃、正常条目照常递减
  const u24 = mkTarget();
  u24.buffs.push(null, 5, { key: 'v', stat: 'versa', val: 10, turns: 1 });
  u24.dots.push(null, { dps: 1, turns: 1, source: u24, stateName: 'x' }, 'bad');
  u24.hots.push(undefined, { pct: 0.05, turns: 1 });
  let threw24 = false;
  try { u24.tickStatus(); } catch (e) { threw24 = true; }
  t('I24 tickStatus 畸形条目不崩溃且正常条目递减清除', !threw24 && u24.buffs.length === 0 && u24.dots.length === 0 && u24.hots.length === 0, `threw=${threw24}, b=${u24.buffs.length}, d=${u24.dots.length}, h=${u24.hots.length}`);
  // 第 9 轮：statBonus 遇 null/原始值条目（外部注入）→ 不崩溃
  const u25 = mkTarget();
  u25.buffs.push(null, 'zz', { key: 'v', stat: 'versa', val: 10, turns: 2 });
  let threw25 = false;
  let bonus25 = null;
  try { bonus25 = u25.statBonus('versa'); } catch (e) { threw25 = true; }
  t('I25 statBonus 畸形条目不崩溃且正常条目计入', !threw25 && bonus25 === 10 && Number.isFinite(u25.dmgMultiplier()) && Number.isFinite(u25.totalCritChance()), `threw=${threw25}, bonus=${bonus25}`);
}

console.log(`\n========== 对抗性输入测试 + 全技能冒烟：${pass} PASS / ${fail} FAIL ==========`);
process.exit(fail ? 1 : 0);
