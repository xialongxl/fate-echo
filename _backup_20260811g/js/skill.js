// ============================================================
// js/skill.js — Skill 类（Fate_echo Phase 0）
// 回合制改造（NEW_GAME.md §3.3）：
//   cd/dur 毫秒 → 回合：cdRounds = max(1, round(ms / 2500))，cd 0 保持 0
//   领域（domain）持续固定 5 回合（换算特例）
//   gcd → 主技能（消耗行动点）/ ogcd → 瞬发（每回合 1 槽，不占 AP）
//   条件触发保留（conditionMaxHPPct，如 s45 命运轮转 HP<30%）
// 2026-08-11：cd 全部清零（彻底去 CD）、dur 为层数制（每回合 -1 层）；换算全部在本类完成
// ============================================================

export const MS_PER_ROUND = 2500;   // 1 回合 ≈ 2500ms（末光咏叹 GCD 基准）
export const DOMAIN_DUR_ROUNDS = 5; // 领域持续特例（60s 领域 → 5 回合）

// 毫秒 → 回合（>0 时至少 1 回合）
export function msToRounds(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.max(1, Math.round(ms / MS_PER_ROUND));
}

export class Skill {
  constructor(data = {}) {
    if (!data || typeof data !== 'object') data = {}; // null/非对象入参容错（不崩溃，与无参同语义）
    // 原样字段（可追溯来源）
    this.id = data.id;
    this.name = data.name;
    this.reqLv = data.reqLv;
    this.type = data.type;            // gcd/ogcd/buff/dot/debuff/domain/passive
    this.cd = data.cd;                // 毫秒（原始）
    this.cost = data.cost;
    this.dmgMult = data.dmgMult || 0;
    this.priority = data.priority || 0;
    this.desc = data.desc || '';
    this.conditionMaxHPPct = data.conditionMaxHPPct; // 血量条件（可选）
    // effects 非数组（字符串/数字/null 等）一律容错为空列表（畸形输入不崩溃）
    this.rawEffects = Array.isArray(data.effects) ? data.effects : [];

    // 回合制换算字段
    this.cdRounds = msToRounds(data.cd);                    // 冷却（回合）
    this.effectRounds = this.rawEffects.map((e) => ({       // 各效果回合化
      ...e,
      durRounds: this.roundsOf(e),
    }));

    // 运行时状态
    this.currentCd = 0;
  }

  // 效果持续时长（层数制，2026-08-11）：dur 数据直接是层数（每回合 -1 层，减完结束）；
  //   领域固定 5 层特例（DOMAIN_DUR_ROUNDS）；cd 全部为 0（彻底去 CD，msToRounds 保留为通用工具）
  //   dur=0/负/非有限 → 0（handler 侧 durRounds<=0 守卫不落地；不产生 NaN）
  roundsOf(e) {
    if (!e || typeof e !== 'object' || !Number.isFinite(e.dur)) return 0;
    if (e.type === 'domain') return DOMAIN_DUR_ROUNDS;
    return Math.max(0, Math.round(e.dur)); // 层数制：dur 即层数
  }

  // 类型判定
  // 注意：isMain 是"类型类别"判定（type==='gcd'），用于数据统计；
  // 战斗层的"主行动"口径是"非瞬发非被动"（含 buff/dot/debuff/domain，见 engine.queueMain）——两者不同义
  get isMain() { return this.type === 'gcd'; }       // gcd 类别（数据统计用）
  get isInstant() { return this.type === 'ogcd'; }    // 瞬发（不占行动点）
  get isPassive() { return this.type === 'passive'; }
  get isDomain() { return this.type === 'domain'; }
  // 终焉技能（末光照抄：desc 含"[终焉]"标记；时间回溯等 cd_reset 不重置其冷却）
  get isFinale() { return /\[终焉\]/.test(this.desc || ''); }

  // 冷却状态
  get ready() { return this.currentCd <= 0; }

  // 施放：置冷却（返回是否可施放）
  use() {
    if (!this.ready) return false;
    this.currentCd = this.cdRounds;
    return true;
  }

  // 回合结束：冷却递减
  tick() {
    if (this.currentCd > 0) this.currentCd--;
  }

  // 血量条件（s45：HP < 30% 才可释放；conditionMaxHPPct 为百分比整数）
  conditionMet(unit) {
    if (!this.conditionMaxHPPct) return true;
    return unit.hpPct() < this.conditionMaxHPPct / 100;
  }

  // 可施放总判定（冷却 + 条件；法力充足由战斗层校验）
  canUse(unit) {
    return this.ready && this.conditionMet(unit);
  }
}
