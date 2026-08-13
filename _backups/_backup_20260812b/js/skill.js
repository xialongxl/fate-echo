// ============================================================
// js/skill.js — Skill 类（Fate_echo Phase 0）
// 回合制改造（NEW_GAME.md §3.3）：
//   领域（domain）持续固定 5 层（换算特例）
//   main → 主技能（消耗行动点）/ instant → 瞬发（每回合 1 槽，不占 AP）
//   条件触发保留（conditionMaxHPPct，如 s45 命运轮转 HP<30%）
// 2026-08-11：技能使用限制概念全删（含字段/类型标记）、dur 为层数制（每回合 -1 层）
// ============================================================

export const DOMAIN_DUR_ROUNDS = 5; // 领域持续特例（60s 领域 → 5 回合）

export class Skill {
  constructor(data = {}) {
    if (!data || typeof data !== 'object') data = {}; // null/非对象入参容错（不崩溃，与无参同语义）
    // 原样字段（可追溯来源）
    this.id = data.id;
    this.name = data.name;
    this.reqLv = data.reqLv;
    this.type = data.type;            // main/instant/buff/dot/debuff/domain/passive
    this.cost = data.cost;
    this.dmgMult = data.dmgMult || 0;
    this.priority = data.priority || 0;
    this.desc = data.desc || '';
    this.conditionMaxHPPct = data.conditionMaxHPPct; // 血量条件（可选）
    // effects 非数组（字符串/数字/null 等）一律容错为空列表（畸形输入不崩溃）
    this.rawEffects = Array.isArray(data.effects) ? data.effects : [];

    // 效果回合化（层数制）：dur 即层数，领域固定 5 层特例
    this.effectRounds = this.rawEffects.map((e) => ({
      ...e,
      durRounds: this.roundsOf(e),
    }));
  }

  // 效果持续时长（层数制，2026-08-11）：dur 数据直接是层数（每回合 -1 层，减完结束）；
  //   领域固定 5 层特例（DOMAIN_DUR_ROUNDS）
  //   dur=0/负/非有限 → 0（handler 侧 durRounds<=0 守卫不落地；不产生 NaN）
  roundsOf(e) {
    if (!e || typeof e !== 'object' || !Number.isFinite(e.dur)) return 0;
    if (e.type === 'domain') return DOMAIN_DUR_ROUNDS;
    return Math.max(0, Math.round(e.dur)); // 层数制：dur 即层数
  }

  // 类型判定
  // 注意：isMain 是"类型类别"判定（type==='main'），用于数据统计；
  // 战斗层的"主行动"口径是"非瞬发非被动"（含 buff/dot/debuff/domain，见 engine.queueMain）——两者不同义
  get isMain() { return this.type === 'main'; }       // 主技能类别（数据统计用）
  get isInstant() { return this.type === 'instant'; }  // 瞬发（不占行动点）
  get isPassive() { return this.type === 'passive'; }
  get isDomain() { return this.type === 'domain'; }
  // 终焉技能（desc 含"[终焉]"标记）
  get isFinale() { return /\[终焉\]/.test(this.desc || ''); }

  // 施放（无使用限制：恒可施放；返回是否可施放）
  use() {
    return true;
  }

  // 血量条件（s45：HP < 30% 才可释放；conditionMaxHPPct 为百分比整数）
  conditionMet(unit) {
    if (!this.conditionMaxHPPct) return true;
    return unit.hpPct() < this.conditionMaxHPPct / 100;
  }

  // 可施放总判定（条件触发；资源由战斗层校验）
  canUse(unit) {
    return this.conditionMet(unit);
  }
}
