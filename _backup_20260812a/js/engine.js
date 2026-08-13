// ============================================================
// js/engine.js — 回合制战斗核心（Fate_echo Phase 1）
// NEW_GAME.md §2/§3：
//   回合结构：玩家阶段（选主技能 + 瞬发 → 确认）→ 敌人阶段 → 回合结束
//   行动点（AP）：基础 1/回合，每 10% 急速 +1 上限（上限 3）；主技能消耗 1
//   瞬发槽：每回合 1 个，不占 AP，结算在主技能之后
//   回合制：行动点/瞬发槽 / 持续效果（dot/hot/buff/shield/vuln）回合结束结算
//   领域：每回合 dps 伤害 + 特殊规则（s48-s52），固定 5 回合
//   被动（终焉之力）：伤害 +10%、受伤 -10%（开战自动生效）
// 纯逻辑无 DOM：UI（js/ui.js）通过 on()/emit() 事件订阅渲染
// ============================================================

import { Skill } from './skill.js';
import { CombatUnit } from './unit.js';
import { executeSkillEffects, tickDotsHots, calcDamage } from './effects.js';
import { heuristicDecide, heuristicPickInstant } from './ai.js';

// ---- 战斗常量（NEW_GAME.md §2.2/§2.4/§9）----
export const AP_BASE = 1;                 // 每回合基础行动点
export const AP_MAX = 8;                  // 行动点上限（2026-08-12 用户定案 3→8：min(8, 1+急速/10)，急速 70 触顶）
export const AP_HASTE_STEP = 10;          // 每 10% 急速 +1 AP 上限
export const DEFEND_TAKEN_MULT = 0.7;     // 防御姿态：本回合受击 -30%
export const DEFEND_AP_BONUS = 1;         // 防御姿态：下回合 +1 AP
export const PASSIVE_DMG_UP_PCT = 10;     // 终焉之力：伤害 +10%
export const PASSIVE_DMG_TAKEN_MULT = 0.9; // 终焉之力：受伤 -10%
export const OCEAN_ENEMY_DMG_MULT = 0.8;  // 海洋领域：敌人伤害 -20%
export const OCEAN_HEAL_MULT = 1.2;       // 海洋领域：受疗 +20%
export const VOID_THRESH_HIGH = 0.5;      // 虚空领域：目标 <50% 血 +50%
export const VOID_THRESH_LOW = 0.3;       // 虚空领域：目标 <30% 血 +100%
export const FLAME_STACK_EVERY = 2;       // 烈焰领域：每 2 回合 +10%
export const FLAME_STACK_MAX = 10;        // 烈焰领域：最多 10 层
export const FLAME_STACK_BONUS = 0.1;     // 烈焰领域：每层 +10%
export const DEATH_DEBUFF_BONUS = 0.15;   // 死亡领域：敌人每负面效果 +15%
export const HOLY_LIFESTEAL = 0.05;       // 圣光领域：伤害 5% 吸血
export const HOLY_LIFESTEAL_LOW_MULT = 2; // 圣光领域：<50% 血转化翻倍
export const HOLY_LOW_HP_PCT = 0.5;       // 圣光领域吸血翻倍阈值（<50% 血）
export const ENRAGE_ATK_MULT = 1.3;       // Boss 狂暴：攻击 ×1.3（⚠️ 待平衡）

// 被动技能映射（数据化在 Phase 2：效果表扩展为被动也可携带 effects）
const PASSIVES_DB = {
  s_passive_01: { name: '终焉之力', dmgUpPct: PASSIVE_DMG_UP_PCT, takenMult: PASSIVE_DMG_TAKEN_MULT },
};

export class CombatEngine {
  /**
   * @param {object} opts
   * @param {{unit: CombatUnit, skills: object[]}} opts.player  玩家（unit + 技能数据）
   * @param {Array<{unit: CombatUnit, skills: object[], meta?: object}>} opts.enemies  敌人列表（meta: enemies.js 的 {tier, enragePct, dotImmune, ...}）
   * @param {() => number} opts.rng  随机源（测试/演示可注入，缺省 Math.random）
   * @param {object|null} opts.ai  AI 实现 {decide, pickInstant, onEnemyStep?, onBattleEnd?}；缺省用启发式打分 AI（js/ai.js）
   */
  constructor({ player, enemies = [], rng = Math.random, ai = null } = {}) {
    if (!player || !player.unit) throw new TypeError('CombatEngine 需要 player.unit（战斗单位）');
    this.player = player.unit;
    this.enemies = enemies.map((e) => e.unit);
    this.enemyMetas = enemies.map((e) => e.meta || null);
    this.rng = rng;
    this.ai = ai;

    this.turn = 0;                // 当前回合（startTurn 后 ≥1）
    this.phase = 'player';        // 'player' | 'enemy' | 'ended'
    this.result = null;           // 'victory' | 'defeat'
    this.log = [];                // [{text, type, side, turn}]

    // 玩家回合状态
    this.ap = 0;
    this.apMax = 0;
    this.defending = false;
    this.defendBonus = 0;         // 防御姿态下回合 +1 AP
    this.pending = [];            // [{kind:'main'|'instant', skill}]
    this.targetIndex = 0;         // 当前选中敌人（死亡自动转移到第一个存活）

    // 技能实例（每单位独立实例）
    this.playerSkills = (player.skills || []).map((d) => new Skill(d));
    this.enemySkillSets = enemies.map((e) => (e.skills || []).map((d) => new Skill(d)));

    this.domains = [];            // {unit, type, dps, turns, stateName, emoji, stacks, elapsed}

    // 效果处理器上下文（effects.js 依赖：log/openDomain/rng/grantAp）
    this._ctx = {
      rng: this.rng,
      log: (text) => this._log(text, 'info'),
      openDomain: (d) => this._openDomain(d),
      grantAp: (unit, n) => this.grantAp(unit, n),
    };

    this._listeners = new Map();
    this._actingSide = null;      // 日志来源方标注（'player' | 'enemy'）
    this._passiveTakenMult = 1;   // 玩家被动受伤乘区（终焉之力 0.9）

    this._applyPassives();
    this._recomputeMods(this.player); // 被动受击乘区落地（终焉之力 -10%）
    if (!this.enemies.length) this._end('victory'); // 无敌人：直接胜利（防御性守卫）
  }

  // ============================================================
  // 事件（UI 订阅）
  // ============================================================
  on(evt, fn) {
    if (!this._listeners.has(evt)) this._listeners.set(evt, new Set());
    this._listeners.get(evt).add(fn);
    return () => this._listeners.get(evt).delete(fn);
  }
  _emit(evt, data) {
    for (const fn of this._listeners.get(evt) || []) fn(data);
  }

  // ============================================================
  // 回合流转
  // ============================================================
  // 进入新回合（玩家阶段）。战斗开始与每次 confirm/defend 结算后自动调用。
  startTurn() {
    if (this.phase === 'ended') return false;
    this.turn++;
    this.phase = 'player';
    this.pending = [];
    this.defending = false;

    // 行动点（2026-08-11 AP 回转体系）：每回合保底补充到 1 点（已有回转收益留存），
    //   不自动回满上限；上限 apMax = min(3, 1+急速/10) + 防御奖励（防御姿态下回合 +1，可超上限）；
    //   额外 AP 靠回转手段（s01 基础攻击 / s07 s34 回 AP 技 / 防御姿态）
    // 急速 - 降急速 debuff（haste_down，2026-08-12 敌人技能从零重做新增；clamp ≥ 0）
    const haste = Math.max(0, this.player.statBonus('haste') - this.player.statBonus('haste_down_pct'));
    this.apMax = Math.min(AP_MAX, AP_BASE + Math.floor(haste / AP_HASTE_STEP)) + this.defendBonus;
    // 保底 1（回转收益留存）+ 防御奖励；收敛到当前上限（急速 buff 收缩时不残留超额 AP）
    this.ap = Math.min(this.apMax, Math.max(AP_BASE, this.ap) + this.defendBonus);
    this.defendBonus = 0;

    this._emit('turn', { turn: this.turn, ap: this.ap, apMax: this.apMax });
    this._emit('refresh');
    return true;
  }

  // 确认：依次结算（主技能按队列顺序 → 瞬发）→ 敌人阶段 → 回合结束 → 下回合
  confirm() {
    if (this.phase !== 'player') return false;
    const actions = this.pending.slice(); // 快照：执行期间 pending 不再被外部改动
    this.pending = [];
    const mains = actions.filter((a) => a.kind === 'main');
    const instants = actions.filter((a) => a.kind === 'instant');
    for (const a of [...mains, ...instants]) {
      if (this.phase === 'ended') break;
      // 终焉主技能消耗全部行动点（2026-08-12 定案：终焉不独占——扣光 AP 后自然无法再排；
      //   效果内 ap_recover（s45/s46 回满）可恢复）；终焉瞬发不吃 AP（普通瞬发规则）
      if (a.kind === 'main' && a.skill.isFinale) this.ap = 0;
      this._cast(this.player, a.skill);
      // 非终焉主技能施放扣 1（s01 等回 AP 技净 0——AP 已满时 grantAp 封顶，净 -1 属封顶自洽）；瞬发不占行动点
      if (a.kind === 'main' && !a.skill.isFinale) this.ap = Math.max(0, this.ap - 1);
    }
    if (this.phase !== 'ended') {
      this.phase = 'enemy';
      this._enemyPhase();
    }
    if (this.phase !== 'ended') this._endTurn();
    this._emit('refresh');
    return true;
  }

  // 防御姿态：跳过行动，本回合受击 -30%，下回合 +1 AP
  defend() {
    if (this.phase !== 'player') return false;
    this.pending = [];
    this.defending = true;
    this.defendBonus = DEFEND_AP_BONUS;
    this._log(`${this.player.name} 摆出防御姿态（本回合受击 -30%，下回合 +1 行动点）`, 'info');
    this._recomputeMods(this.player);
    this.phase = 'enemy';
    this._enemyPhase();
    if (this.phase !== 'ended') this._endTurn();
    this._emit('refresh');
    return true;
  }

  // ============================================================
  // 玩家行动编排
  // ============================================================
  // 主技能入队（消耗行动点；NEW_GAME.md §3.2：除 instant/passive 外的类型（main/buff/dot/debuff/domain）均为主行动）
  // 终焉技能 = 消耗全部 AP（2026-08-11）：独占本回合行动——入队前队列须为空、AP≥1；
  //   入队后其他技能不可再入队（终焉独占 = 大招限制）
  queueMain(id) {
    const c = this._validateQueuable(id);
    if (!c.ok) return c;
    if (c.skill.isInstant || c.skill.isPassive) return { ok: false, reason: '非主技能' };
    if (this.pending.some((p) => p.skill === c.skill)) return { ok: false, reason: '已在队列中' };
    // 终焉无独占（2026-08-12 定案）：与普通主技能同规则入队（终焉主技能施放时扣光 AP 自然限制）
    // 净消耗校验（AP 回转，2026-08-11）：回 AP 主技能（s01 等）净 0 消耗，自身不受限制
    const selfRecover = (c.skill.effectRounds || []).some((e) => e.type === 'ap_recover');
    if (!selfRecover && this._netMainAp() >= this.ap) return { ok: false, reason: '行动点不足' };
    this.pending.push({ kind: 'main', skill: c.skill });
    this._emit('refresh');
    return { ok: true };
  }

  // 瞬发入队（每回合 1 槽，不占行动点）；终焉瞬发同样独占本回合行动
  queueInstant(id) {
    const c = this._validateQueuable(id);
    if (!c.ok) return c;
    if (!c.skill.isInstant) return { ok: false, reason: '非瞬发技能' };
    if (this.pending.some((p) => p.skill === c.skill)) return { ok: false, reason: '已在队列中' };
    // 终焉无独占（2026-08-12 定案）：终焉瞬发 = 普通瞬发规则（占瞬发槽，不吃 AP）
    if (this.pending.some((p) => p.kind === 'instant')) return { ok: false, reason: '瞬发槽已用' };
    this.pending.push({ kind: 'instant', skill: c.skill });
    this._emit('refresh');
    return { ok: true };
  }

  // 纯校验（UI 探测按钮可用性，无副作用）；返回原因字符串（'' = 可入队）
  canQueueMain(id) {
    const c = this._validateQueuable(id);
    if (!c.ok) return c.reason;
    if (c.skill.isInstant || c.skill.isPassive) return '非主技能';
    if (this.pending.some((p) => p.skill === c.skill)) return '已入队（点击取消）';
    // 终焉无独占（2026-08-12 定案）
    const selfRecover = (c.skill.effectRounds || []).some((e) => e.type === 'ap_recover');
    if (!selfRecover && this._netMainAp() >= this.ap) return '行动点不足';
    return '';
  }
  canQueueInstant(id) {
    const c = this._validateQueuable(id);
    if (!c.ok) return c.reason;
    if (!c.skill.isInstant) return '非瞬发技能';
    // 终焉无独占（2026-08-12 定案）：终焉瞬发 = 普通瞬发规则
    if (this.pending.some((p) => p.kind === 'instant')) return '瞬发槽已用';
    if (this.pending.some((p) => p.skill === c.skill)) return '已入队（点击取消）';
    return '';
  }

  // 回 AP（AP 回转体系，2026-08-11）：行动点恢复（上限 apMax 内；s01 基础攻击/s07 s34 回 AP 技/终焉技）
  grantAp(unit, n) {
    if (unit !== this.player) return; // 敌人无 AP 概念（回转仅玩家侧）
    const v = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
    this.ap = Math.min(this.apMax, this.ap + v);
    this._emit('refresh');
  }

  // 队列净行动点消耗（AP 回转，2026-08-11）：回 AP 主技能（ap_recover 效果）净 0，
  //   不占行动点槽位——s01 基础攻击白嫖 1 槽（施放时 -1 +1 抵消）
  _netMainAp() {
    return this.pending.filter((p) => p.kind === 'main' &&
      !(p.skill.effectRounds || []).some((e) => e.type === 'ap_recover')).length;
  }

  // 取消入队（释放瞬发槽 / 行动点占位）
  unqueue(id) {
    const i = this.pending.findIndex((p) => p.skill.id === id);
    if (i < 0) return false;
    this.pending.splice(i, 1);
    this._emit('refresh');
    return true;
  }

  clearPending() {
    if (!this.pending.length) return false;
    this.pending = [];
    this._emit('refresh');
    return true;
  }

  // 目标选择（多敌人）
  selectTarget(index) {
    if (!this.enemies[index] || !this.enemies[index].alive) return false;
    this.targetIndex = index;
    this._emit('refresh');
    return true;
  }

  // 当前目标（死亡/无效自动转移到第一个存活；无存活返回 null）
  _currentTarget() {
    if (this.enemies[this.targetIndex] && this.enemies[this.targetIndex].alive) {
      return this.enemies[this.targetIndex];
    }
    return this._firstAliveEnemy();
  }
  _firstAliveEnemy() {
    return this.enemies.find((e) => e.alive) || null;
  }

  // ============================================================
  // 施放核心
  // ============================================================
  // 可施放基础校验（玩家侧：阶段 + 血量条件 + 献祭生命门槛）；返回 {ok, reason, skill?}
  _validateQueuable(id) {
    if (this.phase !== 'player') return { ok: false, reason: '非玩家阶段' };
    const skill = this.playerSkills.find((s) => s.id === id);
    if (!skill) return { ok: false, reason: '技能不存在' };
    if (!skill.canUse(this.player)) return { ok: false, reason: '条件未满足' };
    // 献祭技能：生命须高于代价（末光照抄：代价 = 当前 HP × costPct；处理器内也会阻断，这里提前给玩家反馈）
    for (const e of skill.effectRounds) {
      if (e.type === 'hp_sacrifice') {
        const base = Number.isFinite(this.player.hp) ? this.player.hp : (Number.isFinite(this.player.maxHp) ? this.player.maxHp : 1);
        const cost = Math.floor(base * (e.costPct || 0));
        if (!Number.isFinite(this.player.hp) || this.player.hp <= cost) {
          return { ok: false, reason: '生命不足' };
        }
      }
    }
    return { ok: true, skill };
  }

  // 施放一个技能（执行效果）。player 侧在 confirm 内调用，敌人侧在敌人阶段调用。
  _cast(unit, skill) {
    const side = unit === this.player ? 'player' : 'enemy';
    if (!skill.canUse(unit)) { this._log(`${unit.name} 的 ${skill.name} 无法施放（条件未满足）`, 'system'); return; }
    skill.use();
    // 施放播报（2026-08-11 删 MP 后无"消耗法力"概念，统一播报施放）
    this._log(`${unit.name} 施放 ${skill.name}`, 'info');
    // 目标按施放方路由：玩家打敌人（当前目标），敌人打玩家
    const target = side === 'player' ? this._currentTarget() : this.player;
    this._actingSide = side;
    if (target) executeSkillEffects(this._ctx, skill, unit, target);
    this._actingSide = null;
    this._checkEnd(); // 击杀判定（玩家施放击杀 → 胜利；敌人施放击杀 → 失败）
  }

  // 基础攻击（敌人无可用技能时的兜底；玩家无基础攻击——s01 魔力弹即免费平砍）
  _basicAttack(source, target) {
    this._actingSide = source === this.player ? 'player' : 'enemy';
    const critInfo = {};
    const dmg = calcDamage(source, target, 1.0, { rng: this.rng, critInfo });
    const actual = target.takeDamage(dmg);
    this._log(`${source.name} 攻击 ${target.name} → 造成 ${actual} 点伤害${critInfo.crit ? '（暴击!）' : ''}`, 'damage');
    this._actingSide = null;
    this._checkEnd();
  }

  // ============================================================
  // 敌人阶段（AI 决策：启发式打分制兜底 / SmartAI 可替换，NEW_GAME.md §4.2）
  // ============================================================
  _enemyPhase() {
    this._actingSide = 'enemy';
    for (let i = 0; i < this.enemies.length; i++) {
      if (this.phase === 'ended') break;
      const enemy = this.enemies[i];
      if (!enemy.alive) continue;
      const meta = this.enemyMetas[i];
      this._maybeEnrage(enemy, meta); // Boss 阶段转换（半血狂暴）
      const skills = this.enemySkillSets[i];
      let action = this._decideAction(i, enemy, skills);  // 主行动
      if (action) this._cast(enemy, action);
      else this._basicAttack(enemy, this.player);
      // 精英/Boss：主行动后 0~1 次瞬发（NEW_GAME.md §2.1；终焉不独占——2026-08-12 定案）
      let instant = null;
      if (meta && meta.tier !== 'normal' && this.player.alive && this.phase !== 'ended') {
        instant = this._decideInstant(i, enemy, skills);
        if (instant) this._cast(enemy, instant);
      }
      // AI 学习钩子：该敌人一步（主行动+瞬发）完成。战斗已结束（击杀）时也调用——
      //   R2-B：击杀动作本身必须入回放（首击秒杀场景否则整场 0 样本）；smartai 侧负责
      //   在 ended 时安全构建特征（hp 0 不崩）并避免与 onBattleEnd 终局奖励信号错位
      if (this.ai && this.ai.onEnemyStep) this.ai.onEnemyStep(this, i, action || instant);
      if (!this.player.alive) break; // 玩家已死：不再让后续敌人行动
    }
    this._actingSide = null;
    this.defending = false;                        // 防御姿态只覆盖敌人阶段
    this._recomputeMods(this.player);              // 还原受击乘区（dot/领域结算不受防御减免）
  }

  // 敌人主行动决策（注入 AI 或启发式兜底）
  _decideAction(i, enemy, skills) {
    if (this.ai && this.ai.decide) return this.ai.decide(this, enemy, skills, i);
    return heuristicDecide(this, enemy, skills, this.rng);
  }
  // 精英/Boss 瞬发决策
  _decideInstant(i, enemy, skills) {
    if (this.ai && this.ai.pickInstant) return this.ai.pickInstant(this, enemy, skills, i);
    return heuristicPickInstant(this, enemy, skills, this.rng);
  }

  // Boss 阶段转换：首次半血进入狂暴（攻击提升，日志播报）
  _maybeEnrage(enemy, meta) {
    if (!meta || !meta.enragePct || enemy.enraged) return;
    if (enemy.hpPct() >= meta.enragePct) return;
    enemy.enraged = true;
    enemy.atk = Math.round(enemy.atk * ENRAGE_ATK_MULT);
    this._log(`${enemy.name} 进入狂暴状态！（攻击 ×${ENRAGE_ATK_MULT}）`, 'buff');
  }

  // ============================================================
  // 回合结束：领域伤害 → dot/hot 结算 → 状态递减 → 领域到期 → 胜负
  // ============================================================
  _endTurn() {
    this._tickDomains();
    this._tickDotsHots();
    for (const u of [this.player, ...this.enemies]) u.tickStatus();
    this._tickDomainTurns();
    this._checkEnd();
    if (this.phase !== 'ended') this.startTurn();
  }

  _allSkills() {
    return [...this.playerSkills, ...this.enemySkillSets.flat()];
  }

  // ---- 领域 ----
  // 每回合造成 dps × atk 伤害（无暴击，与 dot 一致）+ 特殊规则（NEW_GAME.md §3.1 领域表）
  _tickDomains() {
    for (const dom of this.domains) {
      if (dom.turns <= 0) continue;
      const target = dom.unit === this.player ? this._firstAliveEnemy() : this.player;
      if (!target || !target.alive) continue;
      dom.elapsed++;
      // 烈焰领域：每 2 回合伤害 +10%（最多 10 层）
      if (dom.type === 'flame' && dom.elapsed % FLAME_STACK_EVERY === 0) {
        dom.stacks = Math.min(FLAME_STACK_MAX, dom.stacks + 1);
      }
      const mult = this._domainMult(dom, target);
      const dmg = calcDamage(dom.unit, target, dom.dps * mult, { noCrit: true, rng: this.rng });
      const actual = target.takeDamage(dmg);
      if (actual > 0) {
        this._log(`${dom.stateName || dom.type} 对 ${target.name} 造成 ${actual} 点伤害`, 'damage');
        // 圣光领域：伤害 5% 吸血，<50% 血转化翻倍
        if (dom.type === 'holy' && dom.unit.alive) {
          const pct = HOLY_LIFESTEAL * (dom.unit.hpPct() < HOLY_LOW_HP_PCT ? HOLY_LIFESTEAL_LOW_MULT : 1);
          const healed = dom.unit.heal(actual * pct);
          if (healed > 0) this._log(`${dom.unit.name} 圣光领域吸取 ${healed} 生命`, 'heal');
        }
      }
    }
  }

  // 领域特殊规则伤害倍率
  _domainMult(dom, target) {
    switch (dom.type) {
      case 'void': {
        const p = target.hpPct();
        if (p < VOID_THRESH_LOW) return 2;       // <30% +100%
        if (p < VOID_THRESH_HIGH) return 1.5;    // <50% +50%
        return 1;
      }
      case 'flame': return 1 + dom.stacks * FLAME_STACK_BONUS;
      case 'death': { // 敌人每负面效果（dot + 易伤）+15%
        const debuffs = target.dots.length + (target.vulnTurns > 0 ? 1 : 0);
        return 1 + debuffs * DEATH_DEBUFF_BONUS;
      }
      case 'ocean':
      case 'holy':
      default: return 1;
    }
  }

  _tickDomainTurns() {
    let oceanExpired = false;
    for (const dom of this.domains) {
      dom.turns--;
      if (dom.turns <= 0) oceanExpired = oceanExpired || dom.type === 'ocean';
    }
    this.domains = this.domains.filter((d) => d.turns > 0);
    if (oceanExpired) this._recomputeMods(this.player);
  }

  _openDomain(d) {
    // 末光照抄：同一单位同时只能展开 1 个领域（展开新领域清除旧领域）
    this.domains = this.domains.filter((dom) => dom.unit !== d.unit);
    this.domains.push({ ...d, stacks: 0, elapsed: 0 });
    // 展开日志由 effects.js domain handler 记录（ctx.openDomain 不重复记）
    if (d.type === 'ocean' && d.unit === this.player) this._recomputeMods(this.player);
  }

  // ---- dot/hot 结算（effects.js tickDotsHots）----
  _tickDotsHots() {
    for (const line of tickDotsHots(this._ctx, this.player)) this._log(line, 'dot');
    for (const e of this.enemies) {
      if (!e.alive) continue;
      for (const line of tickDotsHots(this._ctx, e)) this._log(line, 'dot');
    }
  }

  // ---- 被动（开战生效）----
  // 以"永久 buff"表达常驻增伤（turns=Infinity 不会被回合递减移除）
  _applyPassives() {
    this._applyPassiveById(this.player, this.playerSkills, true);
    this.enemySkillSets.forEach((set, i) => this._applyPassiveById(this.enemies[i], set, false));
  }

  _applyPassiveById(unit, skillInstances, isPlayer) {
    for (const s of skillInstances) {
      const p = s && PASSIVES_DB[s.id];
      if (!p) continue;
      if (p.dmgUpPct) {
        unit.buffs.push({ key: `passive:${s.id}`, stat: 'dmg_up_pct', val: p.dmgUpPct, turns: Infinity });
      }
      if (p.takenMult !== undefined && p.takenMult !== 1) {
        if (isPlayer) this._passiveTakenMult = p.takenMult;
        else unit.damageTakenMult = Math.max(0.05, unit.damageTakenMult * p.takenMult);
      }
    }
  }

  // ---- 常驻乘区重算（被动 + 领域 + 防御姿态；从来源重算，避免增量乘除的浮点漂移）----
  _recomputeMods(unit) {
    if (unit !== this.player) return;
    let taken = this._passiveTakenMult;
    let heal = 1;
    const ocean = this.domains.some((d) => d.type === 'ocean' && d.unit === this.player);
    if (ocean) { taken *= OCEAN_ENEMY_DMG_MULT; heal *= OCEAN_HEAL_MULT; }
    if (this.defending) taken *= DEFEND_TAKEN_MULT;
    unit.damageTakenMult = taken;
    unit.healingMult = heal;
  }

  // ============================================================
  // 胜负判定 / 日志
  // ============================================================
  _checkEnd() {
    if (this.phase === 'ended') return;
    if (!this.player.alive) { this._end('defeat'); return; }
    if (!this.enemies.some((e) => e.alive)) { this._end('victory'); return; }
  }

  _end(result) {
    this.phase = 'ended';
    this.result = result;
    this._log(result === 'victory' ? '🎉 胜利！所有敌人被消灭' : '💀 你被击败了…', 'system');
    if (this.ai && this.ai.onBattleEnd) this.ai.onBattleEnd(this, result); // AI 学习钩子
    this._emit('end', { result });
  }

  // 日志（带类型分类：crit/heal/buff/damage/system/info + 来源方）
  _log(text, type = 'info') {
    const entry = { text, type: this._classify(text, type), side: this._actingSide || null, turn: this.turn };
    this.log.push(entry);
    this._emit('log', entry);
  }

  _classify(text, fallback) {
    if (/暴击/.test(text)) return 'crit';
    if (/恢复|持续恢复|吸取/.test(text)) return 'heal';
    if (/获得|进入|展开|易伤|护盾|化身|强化/.test(text)) return 'buff';
    if (/造成|伤害|攻击|献祭/.test(text)) return 'damage';
    return fallback;
  }
}
