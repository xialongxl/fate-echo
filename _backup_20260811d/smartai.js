// ============================================================
// js/smartai.js — SmartAI（Fate_echo Phase 2，TensorFlow.js DQN）
// NEW_GAME.md §4.2 回合制化：
//   决策时机：每个敌人阶段开始时决策一次（engine 的 ai 接口）
//   特征：自身/自身技能槽/玩家/战场快照（固定 30 维，见 buildFeatures）
//   动作空间：该敌人非被动技能 + 基础攻击（动态；掩码屏蔽不可用动作）
//   多敌人：按敌人 id 分模型/分回放（不同敌人 = 不同学习任务；
//     混合战斗不互相干扰，交替行动样本不丢失）
//   训练：ε-greedy（1.0→0.05 每场衰减）+ 经验回放（上限 5000）+ DQN
//        （128-64-32 全连接，adam，MSE：target = r + γ·max Q(s')）
//   reward：对玩家伤害/击杀/生存 − 被伤害；玩家胜利（敌人失败）大负分
//   持久化：权重 [{shape,data}] JSON ↔ storage（与游戏存档分离）
// 启发式兜底在训练不足时仍由 engine 默认提供（js/ai.js）——
// SmartAI 只作为"越打越聪明"的上层，接替同一接口。
// ============================================================

import * as tf from '@tensorflow/tfjs';
import { createModelStore } from './storage.js';
import { sacrificeCastable } from './ai.js';

// 命名空间校验：import map 若被指向 UMD 包（dist/tf.min.js），模块加载不报错但
// 命名空间为空 → tf.sequential 崩溃。此处主动抛错，让 main.js 的 loadAI catch
// 走启发式回退（"CDN 可达但形态错误"与"CDN 不可达"同样降级）
if (typeof tf.sequential !== 'function' || typeof tf.layers === 'undefined') {
  throw new Error('TensorFlow.js 命名空间不可用（import map 可能指向了 UMD 包）');
}

export const SMART_AI = {
  FEATURE_DIM: 30,        // buildFeatures 输出维度
  HIDDEN: [128, 64, 32],  // 全连接隐藏层（§4.2：128-64-32）
  SLOTS: 5,               // 敌人技能特征槽位（Boss 5 技能上限）
  GAMMA: 0.9,             // 折扣因子
  EPS_START: 1.0,
  EPS_MIN: 0.05,
  EPS_DECAY: 0.95,        // 每场衰减（ε 1.0→0.05；实现为每场训练，比设计"每 3 场"更频繁）
  REPLAY_CAP: 5000,       // 经验回放上限（§4.2：5000 条，按敌人分桶）
  BATCH: 32,              // 训练批大小
  LR: 0.001,
  REWARD: { dmg: 0.1, hurt: 0.1, win: 20, survive: 1, lose: -20 }, // 敌人视角
};

// 模型权重序列化（持久化格式：保留 shape）
export function weightsToJson(model) {
  return model.getWeights().map((t) => ({ shape: t.shape, data: Array.from(t.dataSync()) }));
}

export class SmartAI {
  /**
   * @param {object} opts
   * @param {() => number} opts.rng  随机源（可注入种子复现）
   * @param {object|null} opts.store  持久化 store（createModelStore 产物）；null = 不持久化
   * @param {number} opts.epsilon  初始探索率（默认 1.0）
   */
  constructor({ rng = Math.random, store = null, epsilon = SMART_AI.EPS_START } = {}) {
    this.rng = rng;
    this.store = store || null;
    this.epsilon = epsilon;
    this.trainedBattles = 0;
    this._models = new Map();   // enemyKey → {model, nActions}（懒构建）
    this._replays = new Map();  // enemyKey → 经验回放数组
    this._lasts = new Map();    // enemyKey → 上一步学习上下文
  }

  // 敌人学习键（不同 id = 不同学习任务；无 meta 时回退索引）
  _key(engine, enemyIndex) {
    return (engine.enemyMetas && engine.enemyMetas[enemyIndex] && engine.enemyMetas[enemyIndex].id) || `enemy${enemyIndex}`;
  }

  _model(key, nActions) {
    let entry = this._models.get(key);
    if (!entry || entry.nActions !== nActions) {
      if (entry && entry.model) entry.model.dispose(); // 重建前释放旧模型（防泄漏）
      entry = { model: this._buildModel(nActions), nActions };
      this._models.set(key, entry);
    }
    return entry.model;
  }

  _buildModel(nActions) {
    const model = tf.sequential();
    model.add(tf.layers.dense({ units: SMART_AI.HIDDEN[0], activation: 'relu', inputShape: [SMART_AI.FEATURE_DIM] }));
    for (const u of SMART_AI.HIDDEN.slice(1)) model.add(tf.layers.dense({ units: u, activation: 'relu' }));
    model.add(tf.layers.dense({ units: nActions }));
    model.compile({ optimizer: tf.train.adam(SMART_AI.LR), loss: 'meanSquaredError' });
    return model;
  }

  _replay(key) {
    let r = this._replays.get(key);
    if (!r) { r = []; this._replays.set(key, r); }
    return r;
  }

  get totalReplay() {
    let n = 0;
    for (const r of this._replays.values()) n += r.length;
    return n;
  }

  // ============================================================
  // 特征打包（敌人视角；固定 30 维）
  //   自身 4：hpPct / mpPct / enraged / shieldPct
  //   技能槽 5×3：cdRatio / 可用性(掩码位) / dmgMult/10
  //   玩家 8：hpPct / mpPct / shieldPct / vuln / immune / dotCount/5 / atk/50 / def/50
  //   战场 3：turn/100 / 存活敌人数 / 自身 hpPct
  // 注：设计 §4.2 的"最近施放序列"等信号被降维舍弃（记录在案，Phase 3 可扩展）
  // ============================================================
  buildFeatures(engine, enemyIndex) {
    const enemy = engine.enemies[enemyIndex];
    const player = engine.player;
    const skills = engine.enemySkillSets[enemyIndex].filter((s) => !s.isPassive);
    const f = [];
    f.push(enemy.hpPct(), enemy.mpPct(), enemy.enraged ? 1 : 0, enemy.shield ? enemy.shield.hp / enemy.maxHp : 0);
    for (let i = 0; i < SMART_AI.SLOTS; i++) {
      const s = skills[i];
      if (!s) { f.push(0, 0, 0); continue; }
      f.push(s.cdRounds > 0 ? Math.min(1, s.currentCd / s.cdRounds) : 0,
             s.canUse(enemy) && s.cost <= enemy.mp ? 1 : 0,
             s.dmgMult / 10);
    }
    f.push(player.hpPct(), player.mpPct(), player.shield ? player.shield.hp / player.maxHp : 0,
           player.vulnTurns > 0 ? 1 : 0, player.immuneTurns > 0 ? 1 : 0,
           player.dots.length / 5, player.atk / 50, player.def / 50);
    f.push(engine.turn / 100, engine.enemies.filter((e) => e.alive).length, enemy.hpPct());
    return f;
  }

  // 动作空间 = 非被动技能 + 基础攻击（null）
  _actionList(engine, enemyIndex) {
    return [...engine.enemySkillSets[enemyIndex].filter((s) => !s.isPassive), null];
  }

  // 动作掩码（决策期用引擎实时状态；含献祭生命门槛——与 effects handler 一致）
  _mask(engine, enemyIndex) {
    const enemy = engine.enemies[enemyIndex];
    return this._actionList(engine, enemyIndex).map((a) => a === null || (a.canUse(enemy) && a.cost <= enemy.mp && sacrificeCastable(enemy, a)));
  }
  // 从特征反推掩码（回放训练用：技能槽位"可用性"位 = 特征索引 4 + i*3 + 1；基础攻击恒可用）
  _maskFromFeatures(f, nActions) {
    const mask = [];
    for (let i = 0; i < Math.min(SMART_AI.SLOTS, nActions - 1); i++) mask.push(f[4 + i * 3 + 1] > 0.5);
    mask.push(true); // 基础攻击
    return mask;
  }

  // ============================================================
  // engine 接口：主行动决策（ε-greedy + 掩码）
  // ============================================================
  decide(engine, enemy, skills, enemyIndex) {
    const key = this._key(engine, enemyIndex);
    const actions = this._actionList(engine, enemyIndex);
    const mask = this._mask(engine, enemyIndex);
    const model = this._model(key, actions.length);
    const state = this.buildFeatures(engine, enemyIndex);
    let chosen = null;
    if (this.rng() < this.epsilon) {
      // 探索：随机选掩码内动作
      const pool = actions.map((a, i) => (mask[i] ? i : -1)).filter((i) => i >= 0);
      if (pool.length) chosen = actions[pool[Math.floor(this.rng() * pool.length)]];
    } else {
      // 利用：argmax Q（掩码外屏蔽；tidy 释放中间张量）
      const q = tf.tidy(() => Array.from(model.predict(tf.tensor2d([state])).dataSync()));
      let best = -1, bestQ = -Infinity;
      for (let i = 0; i < actions.length; i++) {
        if (!mask[i]) continue;
        if (q[i] > bestQ) { bestQ = q[i]; best = i; }
      }
      if (best >= 0) chosen = actions[best];
    }
    return chosen; // null → engine 走基础攻击
  }

  // 精英/Boss 瞬发：利用期 argmax 掩码内瞬发；探索期随机（无瞬发 → null）
  pickInstant(engine, enemy, skills, enemyIndex) {
    const key = this._key(engine, enemyIndex);
    const actions = this._actionList(engine, enemyIndex);
    const instIds = actions.map((a, i) => (a && a.isInstant ? i : -1)).filter((i) => i >= 0);
    if (!instIds.length) return null;
    const mask = this._mask(engine, enemyIndex);
    const pool = instIds.filter((i) => mask[i]);
    if (!pool.length) return null;
    if (this.rng() < this.epsilon) return actions[pool[Math.floor(this.rng() * pool.length)]];
    // 利用：直接用 Q 值（主行动同网络；tidy 释放中间张量）
    const model = this._model(key, actions.length);
    const q = tf.tidy(() => Array.from(model.predict(tf.tensor2d([this.buildFeatures(engine, enemyIndex)])).dataSync()));
    let best = -1, bestQ = -Infinity;
    for (const i of pool) if (q[i] > bestQ) { bestQ = q[i]; best = i; }
    return best >= 0 ? actions[best] : null;
  }

  // ============================================================
  // 打分反思（永恒回想录 SmartAI.evaluateAction 照抄，适配 Fate_echo 技能体系）
  // 对一次行动给出 { score, stars, comments }：治疗/伤害/buff/领域/击杀分类打分 + 情境评语。
  // "记录 → 评分 → 反思 → 训练"闭环：onEnemyStep 记录上一步结果后调用本方法反思并输出思考过程。
  // ============================================================
  evaluateAction(skill, target, result = {}) {
    let score = 3; // 初始及格分
    const comments = [];
    if (!skill) {
      console.log('🔍 SmartAI 行动反思: 无行动', { score: 3, stars: '⭐⭐⭐', comments: '无行动' });
      return { score: 3, stars: '⭐⭐⭐', comments: '无行动' };
    }
    const e = skill.effectRounds && skill.effectRounds[0];
    const skillType = e ? e.type : 'unknown';
    // 治疗类（heal 立即治疗 / hot 持续治疗）
    if (skillType === 'heal' || skillType === 'hot') {
      const heal = result.totalHeal || 0;
      if (heal > 0) {
        if (target && target.hpPct() < 0.3) { score += 2; comments.push('🚑 关键急救'); }
        else { score += 1; comments.push('💚 有效治疗'); }
      } else { score -= 6; comments.push('🤡 满血强奶'); }
    }
    // 伤害类（技能自带 dmgMult / dot / debuff 易伤）
    if (skill.dmgMult > 0 || skillType === 'dot' || skillType === 'vuln') {
      const dmg = result.totalDamage || 0;
      if (dmg > 0) {
        score += 1;
        if (result.hitShield) comments.push('🛡️ 破盾攻击');
        else if (dmg > 500) { score += 1; comments.push(`💥 爆发伤害(${dmg})`); }
        else comments.push('⚔️ 有效命中');
      } else { score -= 1; comments.push('💨 未命中/无效'); }
    }
    // buff 类（强化/护盾/回蓝/无敌）
    if (['buff', 'shield', 'mp_recover_pct', 'mp_recover', 'channel_immune', 'cd_reset', 'cond_full_heal'].includes(skillType)) {
      score += 1;
      comments.push('💪 强化/防护');
    }
    // 领域
    if (skillType === 'domain') { score += 1; comments.push('🌌 领域展开'); }
    // 击杀
    if (result.deaths && result.deaths.length > 0) { score += 2; comments.push('💀 击杀'); }
    const finalScore = Math.max(0, Math.min(10, Math.round(score)));
    const stars = finalScore >= 7 ? '⭐⭐⭐⭐⭐' : finalScore >= 5 ? '⭐⭐⭐⭐' : finalScore >= 3 ? '⭐⭐⭐' : finalScore >= 1 ? '⭐⭐' : '⭐';
    console.log('🔍 SmartAI 行动反思:', { skill: skill.name, score: finalScore, stars, comments: comments.join(' ') });
    return { score: finalScore, stars, comments: comments.join(' ') || '常规行动' };
  }

  // ============================================================
  // 学习钩子（engine 调用）
  // ============================================================
  // 敌人一步完成：把上一步 (state, action) 与当前状态对比求 reward 并入回放；
  // 并对上一步行动做打分反思（记录→评分→反思→训练闭环）
  onEnemyStep(engine, enemyIndex, skill) {
    if (engine.phase === 'ended') return; // 战斗已结束：击杀动作的终局奖励由 onBattleEnd 记（防信号错位/跨战斗泄漏）
    const key = this._key(engine, enemyIndex);
    const enemy = engine.enemies[enemyIndex];
    const state = this.buildFeatures(engine, enemyIndex);
    const last = this._lasts.get(key);
    if (last) {
      const r = this._reward(engine, enemyIndex, last);
      this.remember(key, last.state, last.action, r, state);
      // 打分反思：目标（玩家）状态变化 = 上一步行动效果
      this.evaluateAction(last.skill, engine.player, {
        totalDamage: last.playerHp - engine.player.hp,
        totalHeal: 0,
        hitShield: false,
        deaths: engine.player.hp <= 0 ? [engine.player] : [],
      });
    }
    this._lasts.set(key, { state, action: this._actionId(engine, enemyIndex, skill), skill, playerHp: engine.player.hp, enemyHp: enemy.hp });
  }

  // 战斗结束：各敌人终局 reward（玩家胜 = 敌人大负分）→ ε 衰减 → 增量训练
  onBattleEnd(engine, result) {
    const finalR = result === 'victory' ? SMART_AI.REWARD.lose : SMART_AI.REWARD.win;
    for (const [key, last] of this._lasts) {
      this.remember(key, last.state, last.action, finalR, last.state, true);
    }
    this._lasts.clear(); // 防跨战斗泄漏
    this.epsilon = Math.max(SMART_AI.EPS_MIN, this.epsilon * SMART_AI.EPS_DECAY);
    this.trainedBattles++;
    this._training = this.trainAll(); // 保存在途训练句柄（save() 会先等它完成，防权重快照竞态）
    this._training.catch((err) => console.warn('SmartAI 训练失败:', err));
  }

  // reward：对玩家伤害 − 被伤害 + 生存（敌人视角；击杀走 onBattleEnd 终局奖励）
  _reward(engine, enemyIndex, last) {
    const enemy = engine.enemies[enemyIndex];
    let r = SMART_AI.REWARD.survive;
    r += (last.playerHp - engine.player.hp) * SMART_AI.REWARD.dmg;
    r -= (last.enemyHp - enemy.hp) * SMART_AI.REWARD.hurt;
    return r;
  }

  _actionId(engine, enemyIndex, skill) {
    const actions = this._actionList(engine, enemyIndex);
    const i = actions.indexOf(skill);
    return i >= 0 ? i : actions.length - 1; // null → 基础攻击
  }

  remember(key, state, action, reward, nextState, done = false) {
    const replay = this._replay(key);
    replay.push({ state: state.slice(), action, reward, nextState: nextState.slice(), done });
    if (replay.length > SMART_AI.REPLAY_CAP) replay.shift();
  }

  // ============================================================
  // DQN 训练（各敌人分桶；MSE：target = r + γ·max Q(s')，next 掩码从特征反推）
  // ============================================================
  async trainAll() {
    const results = [];
    for (const [key, replay] of this._replays) {
      const entry = this._models.get(key);
      if (!entry) continue;
      results.push(await this._train(key, entry.model, entry.nActions, replay));
    }
    return results;
  }

  async _train(key, model, nActions, replay) {
    if (replay.length < SMART_AI.BATCH) return null;
    const nA = nActions;
    const batch = [];
    for (let i = 0; i < SMART_AI.BATCH; i++) batch.push(replay[Math.floor(this.rng() * replay.length)]);
    // 计算 target（tidy 内读取后自动释放中间张量）
    const { states, targets } = tf.tidy(() => {
      const statesArr = batch.map((e) => e.state);
      const qCur = Array.from(model.predict(tf.tensor2d(statesArr)).dataSync());
      const qNext = Array.from(model.predict(tf.tensor2d(batch.map((e) => e.nextState))).dataSync());
      const targets = [];
      for (let i = 0; i < batch.length; i++) {
        const e = batch[i];
        const row = qCur.slice(i * nA, (i + 1) * nA).slice();
        if (e.done) {
          row[e.action] = e.reward;
        } else {
          const mask = this._maskFromFeatures(e.nextState, nA);
          let best = -Infinity;
          for (let a = 0; a < nA; a++) if (mask[a] && qNext[i * nA + a] > best) best = qNext[i * nA + a];
          row[e.action] = e.reward + SMART_AI.GAMMA * (Number.isFinite(best) ? best : 0);
        }
        targets.push(row);
      }
      return { states: statesArr, targets };
    });
    const xs = tf.tensor2d(states);
    const ys = tf.tensor2d(targets);
    const hist = await model.fit(xs, ys, { epochs: 1, batchSize: SMART_AI.BATCH, verbose: 0 });
    xs.dispose(); ys.dispose();
    return hist;
  }

  // ============================================================
  // 持久化（按敌人分模型：权重 JSON + 元信息 ↔ store）
  // ============================================================
  async save() {
    if (!this.store || !this._models.size) return false;
    if (this._training) { const t = this._training; this._training = null; await t; } // 等在途训练完成再快照权重（防最后一场梯度不落盘）
    const models = {};
    for (const [key, entry] of this._models) {
      models[key] = { weights: weightsToJson(entry.model), nActions: entry.nActions };
    }
    await this.store.save({ models, meta: { trainedBattles: this.trainedBattles } });
    return true;
  }

  async load() {
    if (!this.store) return false;
    const data = await this.store.load();
    if (!data || !data.models) return false;
    try {
      for (const [key, m] of Object.entries(data.models)) {
        const old = this._models.get(key);
        if (old && old.model) old.model.dispose(); // 替换前释放旧模型（防张量泄漏）
        const model = this._buildModel(m.nActions);
        model.setWeights(m.weights.map((w) => tf.tensor(w.data, w.shape)));
        this._models.set(key, { model, nActions: m.nActions });
      }
    } catch { return false; } // 损坏/形状不符权重 → 从零训练（不崩溃）
    this.trainedBattles = data.meta && data.meta.trainedBattles || 0;
    return true;
  }
}

// 便捷工厂：SmartAI + 默认 store
export function createSmartAI(opts = {}) {
  const store = opts.store === undefined ? createModelStore() : opts.store;
  return new SmartAI({ ...opts, store });
}
