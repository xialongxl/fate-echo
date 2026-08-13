// ============================================================
// js/unit.js — CombatUnit（Fate_echo Phase 0 最小战斗单位）
// 效果处理器（effects.js）的执行支撑；Phase 1 战斗核心会扩展。
// 属性：hp/mp/atk/def（def 参与减伤公式，NEW_GAME.md §2.3；末光统一"防御力"，
//       内部字段 def 与 UI 全称"防御"对应）
// 状态：buffs / dots / hots / shield / immune / vulnMult+vulnTurns / dotEnhanced
// ============================================================

export class CombatUnit {
  constructor({ name = '单位', hp = 100, maxHp = 100, mp = 50, maxMp = 50, atk = 10, def = 10, level = 1, critChance = 0.05, dotImmune = false, enraged = false } = {}) {
    this.name = name;
    this.hp = hp;
    this.maxHp = maxHp;
    this.mp = mp;
    this.maxMp = maxMp;
    this.atk = atk;
    this.def = def;
    this.level = level;
    this.critChance = critChance;

    // 持续状态（回合制）
    this.buffs = [];        // { key, stat, val, turns }（stat: versa/haste/crit/dmg_up_pct/hp_pct/atk_pct；
                            //   hp_pct/atk_pct 供 makeBattlePlayer 乘算读取，statBonus 不处理）
    this.dots = [];         // { dps, turns, source, stateName }（每回合 dps×atk 伤害）
    this.hots = [];         // { pct, turns }（每回合 pct×maxHp 治疗）
    this.shields = [];      // [{ hp, turns }]（末光照抄：多护盾叠加吸收）
    this.immuneTurns = 0;   // 无敌（星辰坠落）
    this.vulnMult = 1;      // 易伤（受击伤害 ×vulnMult，回合递减；末光照抄：多易伤乘算叠加）
    this.vulnTurns = 0;     // 易伤剩余回合（归零还原 ×1）
    this.dotEnhanced = 0;   // 虚空化身剩余回合（dot 强化：频率×2 且单次伤害×2 = 4 倍，末光照抄）
    this.damageTakenMult = 1; // 受击倍率（被动终焉之力 -10%/海洋领域 -20%/防御姿态 -30% 由战斗层叠加；总减伤上限 95%）
    this.healingMult = 1;   // 受疗倍率（海洋领域 +20%）
    this.dotImmune = dotImmune; // dot 免疫（精英机制，Phase 2：瘟疫祭司）
    this.enraged = enraged;   // 狂暴状态（Boss 机制：半血触发，atk 提升，由战斗层标记）
  }

  // 兼容旧引用（UI 显示/测试）：总护盾量（叠加合计）
  get shield() {
    const total = (this.shields || []).reduce((a, s) => a + (Number.isFinite(s.hp) ? Math.max(0, s.hp) : 0), 0);
    const turns = (this.shields || []).reduce((a, s) => Math.max(a, Number.isFinite(s.turns) ? s.turns : 0), 0);
    return total > 0 ? { hp: total, turns } : null;
  }
  set shield(v) {
    this.shields = v && typeof v === 'object' && Number.isFinite(v.hp) ? [{ hp: v.hp, turns: v.turns }] : [];
  }

  get alive() { return this.hp > 0; }
  hpPct() { return this.maxHp > 0 ? this.hp / this.maxHp : 0; }
  mpPct() { return this.maxMp > 0 ? this.mp / this.maxMp : 0; }

  // 属性加成（buff 简单加法叠加；stack/刷新规则 待定 🔲 NEW_GAME.md §2.5）
  statBonus(stat) {
    return this.buffs.filter((b) => b && typeof b === 'object' && b.stat === stat).reduce((a, b) => a + b.val, 0);
  }
  totalCritChance() {
    return Math.min(1, this.critChance + this.statBonus('crit') / 100);
  }
  dmgMultiplier() {
    return 1 + this.statBonus('versa') / 100 + this.statBonus('dmg_up_pct') / 100;
  }

  // 回合结束：持续状态递减（dot/hot 结算由战斗层执行后调本方法）
  tickStatus() {
    for (const b of this.buffs) { if (b && typeof b === 'object') b.turns--; }
    this.buffs = this.buffs.filter((b) => b && typeof b === 'object' && b.turns > 0); // 畸形条目（null/原始值/NaN turns）一并清除
    for (const d of this.dots) { if (d && typeof d === 'object') d.turns--; }
    this.dots = this.dots.filter((d) => d && typeof d === 'object' && d.turns > 0);
    for (const h of this.hots) { if (h && typeof h === 'object') h.turns--; }
    this.hots = this.hots.filter((h) => h && typeof h === 'object' && h.turns > 0);
    // 多护盾叠加：逐层递减，turns 归零或 hp 耗尽的盾清除
    for (const s of this.shields) { if (s && typeof s === 'object' && Number.isFinite(s.turns)) s.turns--; }
    this.shields = this.shields.filter((s) => s && typeof s === 'object' && s.turns > 0 && Number.isFinite(s.hp) && s.hp > 0);
    if (this.immuneTurns > 0) this.immuneTurns--;
    if (this.dotEnhanced > 0) this.dotEnhanced--;
    if (this.vulnTurns > 0) {
      this.vulnTurns--;
      if (this.vulnTurns <= 0) this.vulnMult = 1; // 易伤到期还原
    } else if (this.vulnMult !== 1) {
      this.vulnMult = 1; // 无剩余回合的残留易伤兜底还原（防 0 回合/外部注入残留）
    }
  }

  // 受击（返回实际伤害；护盾先吸收、无敌免伤、易伤放大）
  takeDamage(raw) {
    if (this.immuneTurns > 0) return 0;
    if (!Number.isFinite(raw) || raw <= 0) return 0; // NaN/Infinity 与 0/负值：不产生伤害，也不允许回血/护盾回充
    const vMult = Number.isFinite(this.vulnMult) && this.vulnMult > 0 ? this.vulnMult : 1; // vulnMult 非有限/非正（外部注入）：视为无易伤，不产生 NaN/负伤回血
    // 受击乘区（被动/领域/防御姿态叠加结果；非有限视为 1，下限 0.05 = 总减伤上限 95%，NEW_GAME.md §2.3）
    const takenMult = Number.isFinite(this.damageTakenMult) ? Math.max(0.05, this.damageTakenMult) : 1;
    let dmg = Math.round(raw * vMult * takenMult);
    // 多护盾叠加吸收（末光照抄：逐个盾依次吸收，全部耗尽后溢出为真实伤害）
    if (this.shields && this.shields.length) {
      for (const s of this.shields) {
        if (!Number.isFinite(s.hp) || s.hp <= 0) continue; // 畸形/空盾跳过（不产生 NaN）
        const absorbed = Math.min(s.hp, dmg);
        s.hp -= absorbed;
        dmg -= absorbed;
        if (dmg <= 0) break;
      }
      this.shields = this.shields.filter((s) => Number.isFinite(s.hp) && s.hp > 0);
    }
    this.hp = Math.max(0, this.hp - dmg);
    return dmg;
  }

  heal(amount) {
    if (!Number.isFinite(amount)) return 0; // NaN/Infinity 不污染 hp
    // 受疗乘区（海洋领域 +20%）；非有限视为 1，负值视为 0（不产生负治疗/治疗转伤害）
    const hMult = Number.isFinite(this.healingMult) ? Math.max(0, this.healingMult) : 1;
    const v = Math.max(0, Math.round(amount * hMult));
    const cap = Number.isFinite(this.maxHp) ? this.maxHp : this.hp; // maxHp 异常时以当前 hp 为上限（不污染为 NaN）
    this.hp = Math.min(cap, this.hp + v);
    return v;
  }

  restoreMp(amount) {
    if (!Number.isFinite(amount)) return 0; // NaN/Infinity 不污染 mp
    const v = Math.max(0, Math.round(amount));
    const cap = Number.isFinite(this.maxMp) ? this.maxMp : this.mp; // maxMp 异常时以当前 mp 为上限（不污染为 NaN）
    this.mp = Math.min(cap, this.mp + v);
    return v;
  }
}
