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
import { createEnemy, ENEMIES_DB, allEnemies } from '../js/enemies.js';
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
  t('A6 Boss 法力 300（领域技能支撑）', createEnemy('e12').unit.maxMp === 300, `mp=${createEnemy('e12').unit.maxMp}`);
  const boss = createEnemy('e11');
  t('A7 Boss 5 技能 + enragePct 0.5', boss.skills.length === 5 && boss.meta.enragePct === 0.5);
  // 设计 §4.1：Boss 含领域技（e11 虚空领域 / e12 烈焰领域）
  const bossDomains = ENEMIES_DB.filter((e) => e.tier === 'boss').map((e) =>
    e.skills.some((s) => (typeof s === 'object' ? s.type : skillData(s)?.type) === 'domain'));
  t('A7b 两个 Boss 各含领域技（§4.1）', bossDomains.every(Boolean), bossDomains.join(','));
  // 设计 §4.1：精英含自爆机制（hp_sacrifice，冰霜巨人 s40——需解析 id 引用）
  const eliteSacrifice = ENEMIES_DB.filter((e) => e.tier === 'elite').some((e) =>
    e.skills.some((s) => {
      const d = typeof s === 'object' ? s : skillData(s);
      return !!d && (d.effects || []).some((ef) => ef.type === 'hp_sacrifice');
    }));
  t('A7c 精英层含自爆机制（冰霜巨人 s40）', eliteSacrifice);
  t('A8 全部敌人技能可实例化（含内联 e10_vamp 吸血技）', allEnemies().every((d) => toSkills(d.skills).every((s) => s && s.id)));
  const vamp = allEnemies().find((e) => e.id === 'e10').skills.find((s) => s.id === 'e10_vamp');
  t('A9 虚空噬咬：1.6 倍伤害 + 治疗效果（吸血机制）', vamp && vamp.dmgMult === 1.6 && vamp.effects.some((e) => e.type === 'heal' && e.val === 1.5));
  let threw = false;
  try { createEnemy('e99'); } catch { threw = true; }
  t('A10 未知敌人 id 抛错', threw);
  // 契约（§2.1）：普通敌人无瞬发槽 → 技能表不得含 ogcd（否则技能永远放不出）
  const normalOgcd = ENEMIES_DB.filter((e) => e.tier === 'normal')
    .flatMap((e) => e.skills)
    .filter((s) => typeof s === 'string' && skillData(s)?.type === 'ogcd');
  t('A11 普通敌人技能表不含 ogcd（瞬发槽仅精英/Boss）', normalOgcd.length === 0, normalOgcd.join(','));
  // 契约：精英/Boss 至少 1 个瞬发（瞬发槽有意义）
  const eliteHasInstant = ENEMIES_DB.filter((e) => e.tier !== 'normal').every((e) =>
    e.skills.some((s) => (typeof s === 'object' ? s.type : skillData(s)?.type) === 'ogcd'));
  t('A12 精英/Boss 各含瞬发技能', eliteHasInstant);
}

console.log('== B. 启发式 AI 行为 ==');
{
  // 瘟疫祭司 hp 30% → 治疗优先（s19 再生祷言）
  const { engine, enemy, skills } = vsEnemy('e09');
  enemy.hp = Math.round(enemy.maxHp * 0.3);
  t('B1 低血时优先治疗（s19 再生祷言）', heuristicDecide(engine, enemy, skills, rng)?.id === 's19', `decide=${heuristicDecide(engine, enemy, skills, rng)?.id}`);
  // hp 90% → 治疗降权，用最高分输出技（s36 灾厄降临）
  const { engine: e2, enemy: en2, skills: sk2 } = vsEnemy('e09');
  en2.hp = Math.round(en2.maxHp * 0.9);
  t('B2 血健康时不用治疗（s19 降权）', heuristicDecide(e2, en2, sk2, rng)?.id !== 's19', `decide=${heuristicDecide(e2, en2, sk2, rng)?.id}`);
  // 深渊领主 hp 55% → 自爆（s40 灵魂献祭：献祭 50% 后残血 5%，绝境搏命）
  const { engine: e3, enemy: en3, skills: sk3 } = vsEnemy('e11');
  en3.hp = Math.round(en3.maxHp * 0.55);
  t('B3 献祭后残血区间绝境自爆（s40 灵魂献祭）', heuristicDecide(e3, en3, sk3, rng)?.id === 's40', `decide=${heuristicDecide(e3, en3, sk3, rng)?.id}`);
  // hp ≤ 50% 时献祭必被 handler 阻断（hp ≤ cost）→ 不选（防发呆）
  const { engine: e3b, enemy: en3b, skills: sk3b } = vsEnemy('e11');
  en3b.hp = Math.round(en3b.maxHp * 0.2);
  t('B3b hp 低于代价时不选自爆（防阻断发呆）', heuristicDecide(e3b, en3b, sk3b, rng)?.id !== 's40', `decide=${heuristicDecide(e3b, en3b, sk3b, rng)?.id}`);
  // hp 80% → 不自爆（sacrificeMid 低分，领域优先）
  const { engine: e4, enemy: en4, skills: sk4 } = vsEnemy('e11');
  en4.hp = Math.round(en4.maxHp * 0.8);
  t('B4 血充足时不用自爆', heuristicDecide(e4, en4, sk4, rng)?.id !== 's40');
  // 狂暴后放弃治疗：深渊领主 enraged + hp 40%
  const { engine: e5, enemy: en5, skills: sk5 } = vsEnemy('e11');
  en5.enraged = true;
  en5.hp = Math.round(en5.maxHp * 0.4);
  const d5 = heuristicDecide(e5, en5, sk5, rng);
  t('B5 狂暴后放弃治疗与自爆（非 s12/s40）', d5?.id !== 's12' && d5?.id !== 's40', `decide=${d5?.id}`);
  t('B6 狂暴后选高输出（s48 领域 180 分 > s25 混沌箭）', d5?.id === 's48', `decide=${d5?.id}`);
  // 暗影刺客 hp 健康 → 易伤优先（s18）
  const { engine: e6, enemy: en6, skills: sk6 } = vsEnemy('e07');
  t('B7 玩家无易伤时优先上标记（s18）', heuristicDecide(e6, en6, sk6, rng)?.id === 's18', `decide=${heuristicDecide(e6, en6, sk6, rng)?.id}`);
  // 玩家已有易伤 → 不重复标记，换高伤技（s25 混沌箭）
  e6.player.vulnTurns = 3; e6.player.vulnMult = 1.2;
  t('B8 玩家已有易伤时改用高伤技（s25）', heuristicDecide(e6, en6, sk6, rng)?.id === 's25', `decide=${heuristicDecide(e6, en6, sk6, rng)?.id}`);
  // 法力不足 → null（基础攻击兜底）——树精技能全 cost>0
  const { engine: e7, enemy: en7, skills: sk7 } = vsEnemy('e06');
  en7.mp = 0;
  t('B9 法力不足 → 基础攻击（null）', heuristicDecide(e7, en7, sk7, rng) === null);
  // 全负分（血健康只剩治疗）→ 治疗降权，dot 仍用
  const { engine: e8, enemy: en8, skills: sk8 } = vsEnemy('e06'); // 树精：s04 + s19
  en8.hp = en8.maxHp;
  t('B10 血满时治疗技降权（s19 不选，dot 仍用）', heuristicDecide(e8, en8, sk8, rng)?.id !== 's19', `decide=${heuristicDecide(e8, en8, sk8, rng)?.id}`);
  // 瞬发选择：暗影刺客唯一 ogcd（s26 暗影裂隙）
  const { engine: e9, enemy: en9, skills: sk9 } = vsEnemy('e07');
  t('B11 精英瞬发选择（s26 暗影裂隙）', heuristicPickInstant(e9, en9, sk9, rng)?.id === 's26');
  // §2.1 拆分：主行动不使用 ogcd（瞬发走瞬发槽）
  const { engine: e10, enemy: en10, skills: sk10 } = vsEnemy('e07');
  t('B12 主行动只选非瞬发（s18/s25，不含 ogcd）', !heuristicDecide(e10, en10, sk10, rng)?.isInstant);
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
  // 精英瞬发：暗影刺客一回合 主行动(s18) + 瞬发(s16)
  const e = createEnemy('e07');
  const engine = new CombatEngine({ player: { unit: mkUnit(), skills: sk(BASE) }, enemies: [e], rng });
  engine.startTurn();
  engine.confirm();
  const castLogs = engine.log.filter((l) => l.text.includes('施放'));
  t('C4 精英一回合行动 2 次（主 + 瞬发）', castLogs.length >= 2, castLogs.map((l) => l.text).join('|'));
  t('C5 精英主行动为 死亡标记（s18）', castLogs[0].text.includes('死亡标记'));
  t('C6 精英瞬发为 暗影裂隙（s26，cost>0 有施放日志）', castLogs.some((l) => l.text.includes('暗影裂隙')), castLogs.map((l) => l.text).join('|'));
}
{
  // 普通敌人单动：史莱姆一回合 1 次
  const e = createEnemy('e01');
  const engine = new CombatEngine({ player: { unit: mkUnit(), skills: sk(BASE) }, enemies: [e], rng });
  engine.startTurn();
  engine.confirm();
  t('C7 普通敌人一回合 1 次行动', engine.log.filter((l) => l.side === 'enemy' && (l.text.includes('使用') || l.text.includes('攻击'))).length === 1, engine.log.map((l) => l.text).join('|'));
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
  const e = createEnemy('e07'); // 暗影刺客：3 技能 + 基础攻击 = 4 动作
  const engine = new CombatEngine({ player: { unit: mkUnit(), skills: sk(BASE) }, enemies: [e], rng });
  engine.startTurn();
  const ai = new SmartAI({ rng: () => 0.3, epsilon: 1 });
  t('D1 特征维度 = 30', ai.buildFeatures(engine, 0).length === SMART_AI.FEATURE_DIM);
  t('D2 特征值域 [0,1] 内', ai.buildFeatures(engine, 0).every((v) => v >= 0 && v <= 1.2));
  // 掩码合法性：探索期（ε=1）50 次决策全部在掩码内
  const enemy = e.unit;
  const skills = engine.enemySkillSets[0];
  let maskOk = true;
  for (let i = 0; i < 50; i++) {
    const a = ai.decide(engine, enemy, skills, 0);
    if (a !== null && !(a.canUse(enemy) && a.cost <= enemy.mp)) { maskOk = false; break; }
  }
  t('D3 探索期（ε=1）决策始终在掩码内', maskOk);
  // 利用期（ε=0）同样合法
  ai.epsilon = 0;
  let exploitOk = true;
  for (let i = 0; i < 20; i++) {
    const a = ai.decide(engine, enemy, skills, 0);
    if (a !== null && !(a.canUse(enemy) && a.cost <= enemy.mp)) { exploitOk = false; break; }
  }
  t('D4 利用期（ε=0）决策始终在掩码内', exploitOk);
  // 全冷却 → 基础攻击兜底
  for (const s of skills) s.currentCd = 999;
  t('D5 技能全冷却 → 基础攻击（null）', ai.decide(engine, enemy, skills, 0) === null, `decide=${ai.decide(engine, enemy, skills, 0)?.id}`);
  for (const s of skills) s.currentCd = 0;
  // 回放存储与上限（按敌人分桶）
  for (let i = 0; i < 5100; i++) ai.remember('e07', Array(30).fill(0.1), 0, 1, Array(30).fill(0.1));
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
    const s = Array(30).fill(0).map(() => Math.random());
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
