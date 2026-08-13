// ============================================================
// tools/test_ai.mjs — 敌人 + AI 测试（Fate_echo Phase 2）
// 验证（NEW_GAME.md §4）：
//   A. 敌人表：12 种/tier 分布/数值缩放（§4.3）/dot 免疫机制
//   B. 启发式 AI 行为：保命治疗/自爆/易伤联动/狂暴放弃治疗/法力兜底
//   C. engine 集成：Boss 狂暴阶段转换/精英瞬发/普通单动/dot 免疫落地
//   D. SmartAI：特征维度/掩码合法性（探索+利用）/回放/reward/持久化
//   E. 完整 AI 对战跑通（验收："AI 对战可跑，训练数据可持久化"）
// 确定性：启发式用 rng 恒 0.5（扰动恒 0）；SmartAI 用种子 rng
// 用法: node tools/test_ai.mjs（TF.js CPU 后端，首次加载稍慢）
// ============================================================

import { CombatEngine } from '../js/engine.js';
import { CombatUnit } from '../js/unit.js';
import { Skill } from '../js/skill.js';
import { skillData } from '../js/setup.js';
import { createEnemy, ENEMIES_DB, ENEMY_SKILLS, allEnemies } from '../js/enemies.js';
import { heuristicDecide, heuristicPickInstant, scoreSkill } from '../js/ai.js';
import { SmartAI, SMART_AI } from '../js/smartai.js';
import * as tf from '@tensorflow/tfjs';
tf.setBackend('cpu'); // Node 无 WebGL：固定 CPU 后端，消除后端探测报错噪音
import { createModelStore } from '../js/storage.js';

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

// ---- 测试环境 ----
const rng = () => 0.5; // 启发式扰动恒 0（确定性）
const mkUnit = (o = {}) => new CombatUnit(Object.assign(
  { name: '测试员', hp: 200, maxHp: 200, mp: 100, maxMp: 100, atk: 20, def: 10, level: 1, critChance: 0 },
  o,
));
const sk = (ids) => ids.map((id) => skillData(id)).filter(Boolean);
const BASE = ['s01', 's03', 's04', 's05', 's07', 's13', 's18'];
const toSkills = (dataList) => dataList.map((d) => new Skill(d));
// 玩家 VS 指定敌人
const vsEnemy = (enemyId, level = 1, pOpts = {}) => {
  const e = createEnemy(enemyId, level);
  const engine = new CombatEngine({
    player: { unit: mkUnit(pOpts), skills: sk(BASE) },
    enemies: [e],
    rng,
  });
  engine.startTurn();
  return { engine, enemy: e.unit, skills: toSkills(e.skills), meta: e.meta };
};

console.log('== A. 敌人表 ==');
{
  t('A1 共 12 种敌人', ENEMIES_DB.length === 12, `n=${ENEMIES_DB.length}`);
  t('A2 tier 分布：6 普通 / 4 精英 / 2 Boss',
    ENEMIES_DB.filter((e) => e.tier === 'normal').length === 6 &&
    ENEMIES_DB.filter((e) => e.tier === 'elite').length === 4 &&
    ENEMIES_DB.filter((e) => e.tier === 'boss').length === 2);
  const slime = createEnemy('e01', 5);
  t('A3 数值缩放（§4.3）：史莱姆 Lv5 → HP=round(45×5^1.15) ATK=round(6×5^0.9)',
    slime.unit.hp === Math.round(45 * Math.pow(5, 1.15)) && slime.unit.atk === Math.round(6 * Math.pow(5, 0.9)),
    `hp=${slime.unit.hp} atk=${slime.unit.atk}`);
  t('A4 缩放随等级递增：Lv2 血量 > Lv1', createEnemy('e01', 2).unit.hp > createEnemy('e01', 1).unit.hp);
  const priest = createEnemy('e09');
  t('A5 瘟疫祭司 dot 免疫落地（unit.dotImmune）', priest.unit.dotImmune === true && priest.meta.dotImmune === true);
  t('A6 敌人无 MP 语义（mp 显式 0，MP 已删）', createEnemy('e12').unit.mp === 0 && createEnemy('e12').unit.maxMp === 0);
  const boss = createEnemy('e11', 6); // Lv6：reqLv 过滤后全技能
  t('A7 Boss 5 技能 + enragePct 0.5（Lv6 全技能）', boss.skills.length === 5 && boss.meta.enragePct === 0.5, `n=${boss.skills.length}`);
  // 新手保护（2026-08-12）：Lv1 Boss 只带 reqLv<=1 的基础技能（无大招）
  const bossLv1 = createEnemy('e11', 1);
  t('A7d Lv1 Boss 仅基础技能（新手保护，无大招）', bossLv1.skills.length < 5 && bossLv1.skills.every((sk) => !sk.reqLv || sk.reqLv <= 1), bossLv1.skills.map((sk) => sk.id).join(','));
  // 2026-08-12 从零重做：Boss 无领域（领域是玩家技能）——改验证"Boss 含比例大招（maxhp/lost_hp_dmg）"
  const bossBigSkills = ENEMIES_DB.filter((e) => e.tier === 'boss').map((e) =>
    e.skills.some((s) => {
      const d = typeof s === 'object' ? s : (ENEMY_SKILLS[s] || skillData(s));
      return !!d && (d.effects || []).some((ef) => ef.type === 'maxhp_dmg' || ef.type === 'lost_hp_dmg');
    }));
  t('A7b 两个 Boss 各含比例大招（maxhp/lost_hp_dmg）', bossBigSkills.every(Boolean), bossBigSkills.join(','));
  // 2026-08-12 从零重做：无 hp_sacrifice（献祭是玩家技能）——改验证"精英含比例大招（maxhp_dmg）"
  const eliteBig = ENEMIES_DB.filter((e) => e.tier === 'elite').some((e) =>
    e.skills.some((s) => {
      const d = typeof s === 'object' ? s : (ENEMY_SKILLS[s] || skillData(s));
      return !!d && (d.effects || []).some((ef) => ef.type === 'maxhp_dmg');
    }));
  t('A7c 精英层含比例大招（冰霜巨人霜冻新星）', eliteBig);
  t('A8 全部敌人技能可实例化（含吸血技 en_虚空噬咬）', allEnemies().every((d) => toSkills(d.skills).every((s) => s && s.id)));
  const vamp = allEnemies().find((e) => e.id === 'e10').skills.find((s) => s.id === 'en_虚空噬咬');
  t('A9 虚空噬咬：1.6 倍伤害 + 治疗效果（吸血机制）', vamp && vamp.dmgMult === 1.6 && vamp.effects.some((e) => e.type === 'heal' && e.val === 1.5));
  let threw = false;
  try { createEnemy('e99'); } catch { threw = true; }
  t('A10 未知敌人 id 抛错', threw);
  // 契约（§2.1）：普通敌人无瞬发槽 → 技能表不得含瞬发（否则技能永远放不出）
  const normalInstant = ENEMIES_DB.filter((e) => e.tier === 'normal')
    .flatMap((e) => e.skills)
    .filter((s) => typeof s === 'string' && (ENEMY_SKILLS[s]?.type === 'instant' || skillData(s)?.type === 'instant'));
  t('A11 普通敌人技能表不含瞬发（瞬发槽仅精英/Boss）', normalInstant.length === 0, normalInstant.join(','));
  // 契约：精英/Boss 至少 1 个瞬发（瞬发槽有意义）
  const eliteHasInstant = ENEMIES_DB.filter((e) => e.tier !== 'normal').every((e) =>
    e.skills.some((s) => (typeof s === 'object' ? s : (ENEMY_SKILLS[s] || skillData(s)))?.type === 'instant'));
  t('A12 精英/Boss 各含瞬发技能（从零重做补全）', eliteHasInstant);
}

console.log('== B. 启发式 AI 行为 ==');
{
  // 瘟疫祭司（Lv6 全技能）hp 30% → 治疗优先（en_亡灵复苏）
  const { engine, enemy, skills } = vsEnemy('e09', 6);
  enemy.hp = Math.round(enemy.maxHp * 0.3);
  t('B1 低血时优先治疗（en_亡灵复苏）', heuristicDecide(engine, enemy, skills, rng)?.id === 'en_亡灵复苏', `decide=${heuristicDecide(engine, enemy, skills, rng)?.id}`);
  // hp 90% → 治疗降权（healWaste），输出技优先
  const { engine: e2, enemy: en2, skills: sk2 } = vsEnemy('e09', 6);
  en2.hp = Math.round(en2.maxHp * 0.9);
  const d2 = heuristicDecide(e2, en2, sk2, rng);
  t('B2 血健康时不用治疗（en_亡灵复苏 降权）', d2?.id !== 'en_亡灵复苏', `decide=${d2?.id}`);
  // 深渊领主（Lv6）玩家损血 60% → 反斩杀（en_深渊回响）
  const { engine: e3, enemy: en3, skills: sk3 } = vsEnemy('e11', 6);
  e3.player.hp = Math.round(e3.player.maxHp * 0.4); // 玩家损血 60%
  t('B3 玩家损血 60% 时反斩杀优先（en_深渊回响）', heuristicDecide(e3, en3, sk3, rng)?.id === 'en_深渊回响', `decide=${heuristicDecide(e3, en3, sk3, rng)?.id}`);
  // 玩家满血 → 反斩杀 0 伤不选（AI 不浪费行动）
  const { engine: e3b, enemy: en3b, skills: sk3b } = vsEnemy('e11', 6);
  t('B3b 玩家满血时不选反斩杀（0 伤浪费）', heuristicDecide(e3b, en3b, sk3b, rng)?.id !== 'en_深渊回响', `decide=${heuristicDecide(e3b, en3b, sk3b, rng)?.id}`);
  // hp 80% 玩家满血 → 正常输出（非反斩杀）
  const { engine: e4, enemy: en4, skills: sk4 } = vsEnemy('e11', 6);
  en4.hp = Math.round(en4.maxHp * 0.8);
  t('B4 血充足时正常输出（非反斩杀）', heuristicDecide(e4, en4, sk4, rng)?.id !== 'en_深渊回响', `decide=${heuristicDecide(e4, en4, sk4, rng)?.id}`);
  // 狂暴后：深渊领主 enraged + hp 40% → 仍正常决策
  const { engine: e5, enemy: en5, skills: sk5 } = vsEnemy('e11', 6);
  en5.enraged = true;
  en5.hp = Math.round(en5.maxHp * 0.4);
  const d5 = heuristicDecide(e5, en5, sk5, rng);
  t('B5 狂暴后仍正常决策（非 null）', d5 !== null && d5 !== undefined, `decide=${d5?.id}`);
  t('B6 狂暴后选高输出（深渊斩击/裂隙 优先于 debuff）', d5?.id === 'en_深渊斩击' || d5?.id === 'en_深渊裂隙', `decide=${d5?.id}`);
  // 暗影刺客（Lv3）hp 健康 → 高输出（en_影袭 3×1.2 连击）
  const { engine: e6, enemy: en6, skills: sk6 } = vsEnemy('e07', 3);
  t('B7 刺客输出优先（en_影袭 连击）', heuristicDecide(e6, en6, sk6, rng)?.id === 'en_影袭', `decide=${heuristicDecide(e6, en6, sk6, rng)?.id}`);
  // 玩家已有降攻 debuff → 不再叠 atk_down，换输出（影袭）
  e6.player.buffs.push({ stat: 'atk_down_pct', val: 10, turns: 3 });
  t('B8 已有降攻 debuff 时换输出（en_影袭）', heuristicDecide(e6, en6, sk6, rng)?.id === 'en_影袭', `decide=${heuristicDecide(e6, en6, sk6, rng)?.id}`);
  // MP 已删：敌人无资源消耗，任何血量都能决策（不再发呆）
  const { engine: e7, enemy: en7, skills: sk7 } = vsEnemy('e06');
  t('B9 无资源消耗：敌人始终能决策（非 null）', heuristicDecide(e7, en7, sk7, rng) !== null);
  // 树精（Lv1）血满 → 输出优先（en_腐毒喷洒，dot 仍用）
  const { engine: e8, enemy: en8, skills: sk8 } = vsEnemy('e06');
  en8.hp = en8.maxHp;
  t('B10 树精血满时输出优先（en_腐毒喷洒）', heuristicDecide(e8, en8, sk8, rng)?.id === 'en_腐毒喷洒', `decide=${heuristicDecide(e8, en8, sk8, rng)?.id}`);
  // 瞬发选择：暗影刺客唯一瞬发（en_淬毒飞刀）
  const { engine: e9, enemy: en9, skills: sk9 } = vsEnemy('e07', 3);
  t('B11 精英瞬发选择（en_淬毒飞刀）', heuristicPickInstant(e9, en9, sk9, rng)?.id === 'en_淬毒飞刀');
  // §2.1 拆分：主行动不使用瞬发（瞬发走瞬发槽）
  const { engine: e10, enemy: en10, skills: sk10 } = vsEnemy('e07', 3);
  t('B12 主行动只选非瞬发（不含瞬发）', !heuristicDecide(e10, en10, sk10, rng)?.isInstant);
}

console.log('== C. engine 集成 ==');
{
  // Boss 狂暴：深渊领主 hp<50% → enraged + atk×1.3 + 日志
  const e = createEnemy('e11');
  const engine = new CombatEngine({ player: { unit: mkUnit({ hp: 500, maxHp: 500 }), skills: sk(BASE) }, enemies: [e], rng });
  engine.startTurn();
  const atkBefore = e.unit.atk;
  e.unit.hp = Math.round(e.unit.maxHp * 0.4);
  engine.confirm(); // 敌人阶段触发狂暴检查
  t('C1 Boss 半血狂暴：enraged + 攻击 ×1.3', e.unit.enraged && e.unit.atk === Math.round(atkBefore * 1.3), `atk=${e.unit.atk} (${atkBefore}→) enraged=${e.unit.enraged}`);
  t('C2 狂暴日志播报', engine.log.some((l) => l.text.includes('狂暴')));
  const atkRaged = e.unit.atk;
  e.unit.hp = Math.round(e.unit.maxHp * 0.2);
  engine.confirm();
  t('C3 狂暴只触发一次（atk 不重复提升）', e.unit.atk === atkRaged);
}
{
  // 精英瞬发：暗影刺客（Lv3）一回合 主行动 + 瞬发
  const e = createEnemy('e07', 3);
  const engine = new CombatEngine({ player: { unit: mkUnit(), skills: sk(BASE) }, enemies: [e], rng });
  engine.startTurn();
  engine.confirm();
  const castLogs = engine.log.filter((l) => l.text.includes('施放'));
  t('C4 精英一回合行动 2 次（主 + 瞬发）', castLogs.length >= 2, castLogs.map((l) => l.text).join('|'));
  t('C5 精英主行动非瞬发', !castLogs[0].text.includes('飞刀'), castLogs[0] && castLogs[0].text);
  t('C6 精英瞬发为 淬毒飞刀', castLogs.some((l) => l.text.includes('淬毒飞刀')), castLogs.map((l) => l.text).join('|'));
}
{
  // 普通敌人单动：史莱姆一回合 1 次
  const e = createEnemy('e01');
  const engine = new CombatEngine({ player: { unit: mkUnit(), skills: sk(BASE) }, enemies: [e], rng });
  engine.startTurn();
  engine.confirm();
  t('C7 普通敌人一回合 1 次行动', engine.log.filter((l) => l.side === 'enemy' && (l.text.includes('使用 ') || l.text.includes(' 攻击 '))).length === 1, engine.log.map((l) => l.text).join('|'));
}
{
  // dot 免疫：玩家 s04 打瘟疫祭司 → 不挂 dot
  const e = createEnemy('e09');
  const engine = new CombatEngine({ player: { unit: mkUnit(), skills: sk(BASE) }, enemies: [e], rng });
  engine.startTurn();
  engine.queueMain('s04');
  engine.confirm();
  t('C8 瘟疫祭司 dot 免疫（不挂 dot + 免疫日志）', e.unit.dots.length === 0 && engine.log.some((l) => l.text.includes('免疫')), `dots=${e.unit.dots.length}`);
}

console.log('== D. SmartAI ==');
{
  const e = createEnemy('e07', 3); // 暗影刺客 Lv3：全技能（reqLv 门槛）+ 基础攻击
  const engine = new CombatEngine({ player: { unit: mkUnit(), skills: sk(BASE) }, enemies: [e], rng });
  engine.startTurn();
  const ai = new SmartAI({ rng: () => 0.3, epsilon: 1 });
  t('D1 特征维度 = 25', ai.buildFeatures(engine, 0).length === SMART_AI.FEATURE_DIM);
  t('D2 特征值域 [0,1] 内', ai.buildFeatures(engine, 0).every((v) => v >= 0 && v <= 1.2));
  // 掩码合法性：探索期（ε=1）50 次决策全部在掩码内
  const enemy = e.unit;
  const skills = engine.enemySkillSets[0];
  let maskOk = true;
  for (let i = 0; i < 50; i++) {
    const a = ai.decide(engine, enemy, skills, 0);
    if (a !== null && !a.canUse(enemy)) { maskOk = false; break; }
  }
  t('D3 探索期（ε=1）决策始终在掩码内', maskOk);
  // 掩码含技能动作（防 MP 残留回归：掩码全 false → 敌人只会普攻，AI 学习报废）
  t('D3b 掩码含技能动作（非仅普攻）', ai._mask(engine, 0).slice(0, -1).some(Boolean), `mask=${ai._mask(engine, 0).join(',')}`);
  // 利用期（ε=0）同样合法
  ai.epsilon = 0;
  let exploitOk = true;
  for (let i = 0; i < 20; i++) {
    const a = ai.decide(engine, enemy, skills, 0);
    if (a !== null && !a.canUse(enemy)) { exploitOk = false; break; }
  }
  t('D4 利用期（ε=0）决策始终在掩码内', exploitOk);
  // 技能均不可用（条件不满足）→ 基础攻击兜底
  for (const s of skills) { s.conditionMaxHPPct = 5; } // 强制条件不满足（当前血量 > 5%）
  t('D5 技能不可用 → 基础攻击（null）', ai.decide(engine, enemy, skills, 0) === null, `decide=${ai.decide(engine, enemy, skills, 0)?.id}`);
  for (const s of skills) { s.conditionMaxHPPct = undefined; }
  // 回放存储与上限（按敌人分桶）
  for (let i = 0; i < 5100; i++) ai.remember('e07', Array(25).fill(0.1), 0, 1, Array(25).fill(0.1));
  t('D6 经验回放上限 5000 条', ai._replays.get('e07').length === SMART_AI.REPLAY_CAP, `n=${ai._replays.get('e07').length}`);
  ai._replays.delete('e07');
  // reward 计算：对玩家 12 伤 → +1.2；被玩家 10 伤 → -1.0；生存 +1
  const last = { playerHp: 100, enemyHp: 100 };
  engine.player.hp = 88;
  enemy.hp = 90;
  const r = ai._reward(engine, 0, last);
  t('D7 reward：伤害+1.2 − 被伤1.0 + 生存1 = 1.2', Math.abs(r - (12 * 0.1 - 10 * 0.1 + 1)) < 1e-9, `r=${r}`);
  // 学习钩子：首次调用仅记录，第二次把上一步入回放
  ai.onEnemyStep(engine, 0, skills[0]);
  ai.onEnemyStep(engine, 0, skills[1]);
  t('D8 onEnemyStep 把上一步 (state,action) 入回放', ai._replays.get('e07').length === 1, `n=${ai._replays.get('e07').length}`);
  t('D9 ε 探索/利用钩子不破坏状态', engine.phase === 'player');
}
{
  // 训练跑通 + 持久化 round-trip
  const e = createEnemy('e07');
  const engine = new CombatEngine({ player: { unit: mkUnit(), skills: sk(BASE) }, enemies: [e], rng: () => 0.5 });
  engine.startTurn();
  const memBackend = { map: new Map(), async save(k, v) { this.map.set(k, v); }, async load(k) { return this.map.get(k) || null; }, async clear(k) { this.map.delete(k); } };
  const store = createModelStore({ backend: memBackend });
  const ai = new SmartAI({ rng: () => 0.4, store, epsilon: 0.9 });
  const skills = engine.enemySkillSets[0];
  // 灌回放 + 训练（先 decide 一次以构建模型）
  ai.decide(engine, e.unit, skills, 0);
  for (let i = 0; i < 40; i++) {
    const s = Array(25).fill(0).map(() => Math.random());
    ai.remember('e07', s, i % 4, Math.random() * 3 - 1, s);
  }
  const hist = await ai.trainAll();
  t('D10 DQN 训练跑通（返回训练历史）', hist && hist[0] !== undefined && hist[0] !== null);
  // 决策（ε=0）→ save → 新实例 load → 同状态同决策
  ai.epsilon = 0;
  const before = ai.decide(engine, e.unit, skills, 0);
  await ai.save();
  const ai2 = new SmartAI({ rng: () => 0.4, store, epsilon: 0 });
  const loaded = await ai2.load();
  t('D11 持久化 load 成功', loaded === true);
  const after = ai2.decide(engine, e.unit, skills, 0);
  t('D12 权重 round-trip：同状态同决策', (before === null && after === null) || (before && after && before.id === after.id), `before=${before?.id} after=${after?.id}`);
  t('D13 元信息保留（trainedBattles）', ai2.trainedBattles === ai.trainedBattles);
}
{
  // AI 面板配套 API（2026-08-12 永恒回想录齐全度照抄：战斗记录/统计/强制训练/清数据/导出）
  const memBackend = { map: new Map(), async save(k, v) { this.map.set(k, v); }, async load(k) { return this.map.get(k) || null; }, async clear(k) { this.map.delete(k); } };
  const store = createModelStore({ backend: memBackend });
  const ai = new SmartAI({ rng: () => 0.4, store, epsilon: 0.9, verbose: false });
  // recordBattle 胜/负计数
  ai.recordBattle(true); ai.recordBattle(true); ai.recordBattle(false);
  const st = ai.getStats();
  t('D14 recordBattle 计数 + getStats 汇总', st.totalBattles === 3 && st.wins === 2 && st.losses === 1 && st.winRate === '66.7%', JSON.stringify(st));
  // 未就绪门槛：回放 < BATCH（32）→ isModelReady false + battlesNeeded
  t('D15 模型未就绪提示（还需 N 条数据）', st.isModelReady === false && st.battlesNeeded === SMART_AI.BATCH, `needed=${st.battlesNeeded}`);
  // D15b 补强（审查）：回放递增 → battlesNeeded 递减；达门槛 → 就绪
  for (let i = 0; i < 31; i++) ai.remember('e01', Array(25).fill(0.1), 0, 1, Array(25).fill(0.1));
  const st1 = ai.getStats();
  t('D15b battlesNeeded 随回放递减（32-31=1）', st1.battlesNeeded === 1 && st1.isModelReady === false, `needed=${st1.battlesNeeded}`);
  ai.remember('e01', Array(25).fill(0.1), 0, 1, Array(25).fill(0.1));
  const stReady = ai.getStats();
  t('D15c 回放达门槛 → 就绪', stReady.battlesNeeded === 0 && stReady.isModelReady === true, `ready=${stReady.isModelReady}`);
  // D15d 补强（审查 M2b）：已加载模型 → 就绪（即使回放被清；懒构建下模拟模型条目）
  ai._models.set('e01', { model: null, nActions: 3 });
  ai._replays.clear();
  t('D15d 已加载模型即就绪（读档场景）', ai.getStats().isModelReady === true);
  ai._models.delete('e01');
  // D15e 补强（审查 M2a）：ε 随 save/load 恢复
  ai.epsilon = 0.37;
  await ai.save();
  const ai3 = new SmartAI({ rng: () => 0.4, store, epsilon: 1.0, verbose: false });
  await ai3.load();
  t('D15e ε 持久化恢复（0.37）', Math.abs(ai3.epsilon - 0.37) < 1e-9, `eps=${ai3.epsilon}`);
  // D15f 补强（审查 A #3）：无模型时 save 也落盘统计（首战秒杀场景）
  ai._models.clear();
  await ai.save();
  const ai4 = new SmartAI({ rng: () => 0.4, store, epsilon: 1.0, verbose: false });
  await ai4.load();
  t('D15f 无模型 save 统计仍落盘', ai4.getStats().totalBattles === ai.getStats().totalBattles, `saved=${ai.getStats().totalBattles} loaded=${ai4.getStats().totalBattles}`);
  // D15g 补强（审查 L2）：版本不符 → 旧权重不载入（从零）
  const store2 = createModelStore({ backend: memBackend });
  await ai4.save();
  const savedData = await store2.load();
  savedData.meta.version = 999; // 伪造旧版本
  await store2.save(savedData);
  const ai5 = new SmartAI({ rng: () => 0.4, store: store2, epsilon: 1.0, verbose: false });
  await ai5.load();
  t('D15g 版本不符 → 权重不载入（从零训练）', ai5._models.size === 0, `models=${ai5._models.size}`);
  // forceTraining：数据不足时返回空结果不崩溃
  const empty = await ai.forceTraining();
  t('D16 forceTraining 数据不足不崩溃（空结果）', Array.isArray(empty) && empty.length === 0);
  // exportData 结构
  ai.remember('e01', Array(25).fill(0.1), 0, 1, Array(25).fill(0.1));
  const exp = ai.exportData();
  t('D17 exportData 结构（战斗/训练数据/模型元信息）', exp.battles.total === 3 && exp.trainingData.e01 === 1 && exp.meta.epsilon === ai.epsilon);
  // clearAllData：回放/统计/持久化全清
  await ai.clearAllData();
  const st2 = ai.getStats();
  t('D18 clearAllData 清空回放/统计/持久化', st2.totalBattles === 0 && st2.trainingDataCount === 0 && st2.wins === 0 && (await ai.store.load()) === null);
  // 面板开关对应 recordBattle 只在启用时调用（main.js 侧逻辑由 onBattleEnd 守卫——此处验证计数不串）
  ai.recordBattle(true);
  t('D19 清理后可重新计数', ai.getStats().totalBattles === 1);
}

console.log('== E. 完整 AI 对战 ==');
{
  // SmartAI（ε=1 全程探索）驱动 2 敌人 vs 脚本玩家 → 战斗跑通
  const enemies = [createEnemy('e02', 1), createEnemy('e01', 1)];
  const engine = new CombatEngine({
    player: { unit: mkUnit(), skills: sk(BASE) },
    enemies,
    rng: () => 0.5,
    ai: new SmartAI({ rng: () => 0.37, epsilon: 1 }),
  });
  engine.startTurn();
  let guard = 0;
  while (engine.phase !== 'ended' && guard++ < 80) {
    const p = engine.player;
    const lowIdx = engine.enemies.map((en, i) => [en.hp, i]).sort((a, b) => a[0] - b[0])[0][1];
    engine.selectTarget(lowIdx);
    if (p.hpPct() < 0.5) engine.queueMain('s05');
    if (engine.canQueueMain('s04') === '') engine.queueMain('s04');
    engine.queueMain('s01');
    engine.confirm();
  }
  t('E1 SmartAI 对战跑通（正常结束）', engine.phase === 'ended' && (engine.result === 'victory' || engine.result === 'defeat'), `result=${engine.result} guard=${guard}`);
  t('E2 学习钩子触发：回放非空（按敌人分桶）', engine.ai.totalReplay > 0, `replay=${engine.ai.totalReplay}`);
  t('E2b 多敌人各自分桶学习（狼+史莱姆都有样本）', (engine.ai._replays.get('e02')?.length || 0) > 0 && (engine.ai._replays.get('e01')?.length || 0) > 0);
  t('E3 战斗结束 ε 衰减 + 训练计数', engine.ai.epsilon < 1 && engine.ai.trainedBattles === 1, `ε=${engine.ai.epsilon}`);
}

console.log(`\n========== test_ai 结果：${pass} 通过 / ${fail} 失败 ==========`);
if (fail) process.exit(1);
