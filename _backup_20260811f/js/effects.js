// ============================================================
// js/effects.js — 效果处理器注册表（Fate_echo Phase 0）
// 声明式技能表的执行端（参考 永恒回想录 skillCore EFFECT_HANDLERS 模式）：
//   每个效果类型一个 handler：(ctx, target, source, effect, skill) => void
//   新效果类型 = 加一个 handler，杜绝 if-else 蔓延
// 回合制语义（NEW_GAME.md §3.2）：
//   dot/hot 每回合结算；shield 吸收；buff/debuff 回合递减；
//   vuln 受击放大且回合递减；hp_sacrifice 立即扣血+伤害；domain 基础 dps（特殊规则 Phase 1）
// 目标路由（v2.0 修正）：自增益效果作用于施放者（source），对敌效果作用于目标（target）
// ============================================================

// 效果类型 → 作用目标路由（handler 收到的 target 即此路由结果）
// 自增益：buff/heal/hot/shield/dot强化/无敌/条件回满/领域
// 对敌：dot/易伤；hp_sacrifice 混合（source 扣血、target 出伤，handler 内自行处理）
const SELF_EFFECTS = new Set([
  'buff', 'heal', 'hot', 'shield',
  'dot_enhance', 'channel_immune', 'cond_full_heal', 'domain',
]);

// 伤害计算（NEW_GAME.md §2.3：floor 取整，最低 1）
// opts.rng：随机源注入（测试/演示可确定性；缺省 Math.random）
// opts.critInfo：可选输出对象（{crit: boolean}），回传本次是否暴击（日志标记用）
export function calcDamage(source, target, dmgMult, opts = {}) {
  const { noCrit = false, noMitigation = false, rng = Math.random, critInfo = null } = opts;
  let dmg = source.atk * dmgMult;
  // 暴击（暴击率上限 100%，×1.5）
  const crit = !noCrit && rng() < source.totalCritChance();
  if (critInfo) critInfo.crit = crit;
  if (crit) {
    dmg *= 1.5;
  }
  // 增伤乘区（versa + dmg_up_pct）
  dmg *= source.dmgMultiplier();
  // 敌人减伤（末光照抄 engine.js L1202-1218 增减伤一体）：
  //   防御部分：def / (def + 等级×40)，上限 85%
  //   共鸣部分：versaDR = 共鸣 × 0.0015（versa 增伤 1+versa/100 的同时自带减伤）
  //   总减伤上限 95%
  if (!noMitigation) {
    const denom = target.def + target.level * 40;
    const m = Number.isFinite(target.def) && denom > 0 ? target.def / denom : 0; // 防 0/0 与负分母
    const defMit = Math.min(0.85, Math.max(0, m)); // 负 def 不产生负减伤
    const versa = Number.isFinite(target.statBonus('versa')) ? Math.max(0, target.statBonus('versa')) : 0;
    const versaMit = Math.min(0.85, versa * 0.0015); // 共鸣减伤上限 85%（总上限 95% 兜底）
    const mitigation = Math.min(0.95, defMit + versaMit);
    dmg *= 1 - mitigation;
  }
  const d = Math.max(1, Math.floor(dmg));
  return Number.isFinite(d) ? d : 1; // NaN/Infinity（畸形输入/溢出）回退保底 1，不产生 NaN 伤害
}

// 效果处理器注册表
export const EFFECT_HANDLERS = {
  // 属性增益（versa/haste/crit/dmg_up_pct），层数制（2026-08-11：持续 = 层数，每回合 -1 层）
  // 刷新规则（NEW_GAME.md §2.5"同类刷新取最大值"）：同 stat 且有限层数条目
  //   → val 取最大、层数刷新（不叠加）；永久 buff（turns=Infinity，装备/宝珠/收藏品/终焉）
  //   不受技能 buff 影响（保持加法叠加）
  buff(ctx, target, source, e) {
    const existing = (target.buffs || []).find((b) => b && typeof b === 'object' && b.stat === e.stat && b.turns !== Infinity);
    if (existing) {
      existing.val = Math.max(existing.val, e.val);
      existing.turns = Math.max(existing.turns, e.durRounds); // 层数取 max（短施放不缩短已有 buff）
    } else {
      target.buffs.push({ key: e.stat, stat: e.stat, val: e.val, turns: e.durRounds });
    }
    ctx.log(`${target.name} 获得 ${e.stat} +${e.val}（${e.durRounds} 层）`);
  },

  // DoT：仅挂载每层 dps 伤害（立即伤害由技能 dmgMult 结算，与来源 castSkill 一致）
  // 层数制刷新：同 stateName 条目刷新层数不叠加（否则每回合挂 dot 无限叠）
  dot(ctx, target, source, e) {
    if (e.durRounds <= 0) return; // 0 层 dot 不落地（总伤守恒：0 层 = 0 伤害；与 vuln dur=0 不落地一致）
    if (target.dotImmune) { // 精英机制：dot 免疫（瘟疫祭司，NEW_GAME.md §4.1）
      ctx.log(`${target.name} 免疫了持续伤害！`);
      return;
    }
    const existing = (target.dots || []).find((d) => d && typeof d === 'object' && d.stateName === (e.stateName || 'dot'));
    if (existing) {
      existing.turns = Math.max(existing.turns, e.durRounds);
      existing.dps = Math.max(existing.dps, e.dps || 0); // 更强 dot 覆盖（s21/s43 同 stateName 时取 dps 高者）
    } else {
      target.dots.push({ dps: e.dps || 0, turns: e.durRounds, source, stateName: e.stateName || 'dot' });
    }
    ctx.log(`${source.name} 对 ${target.name} 施放 ${e.stateName || 'dot'}：每层 ${Math.round((e.dps || 0) * 100)}% 攻击力伤害 × ${e.durRounds} 层`);
  },

  // 立即治疗（末光照抄：基数 = max(atk, def)）
  heal(ctx, target, source, e) {
    const before = target.hp;
    target.heal(Math.max(source.atk, source.def) * (e.val || 0));
    const v = target.hp - before; // 实际恢复量（超上限截断后）
    ctx.log(`${target.name} 恢复 ${v} 生命`);
  },

  // Hot：每层恢复 pct × 最大生命（层数制；同 pct 条目刷新不叠加）
  hot(ctx, target, source, e) {
    if (e.durRounds <= 0) return; // 0 层 hot 不落地（0 层 = 0 恢复，与 dot/vuln 一致）
    const existing = (target.hots || []).find((h) => h && typeof h === 'object' && Math.abs(h.pct - (e.pct || 0)) < 1e-9);
    if (existing) {
      existing.turns = Math.max(existing.turns, e.durRounds);
    } else {
      target.hots.push({ pct: e.pct || 0, turns: e.durRounds });
    }
    ctx.log(`${target.name} 获得持续治疗（${Math.round((e.pct || 0) * 100)}% 最大生命/层 × ${e.durRounds} 层）`);
  },

  // 护盾：吸收 hpPct × 最大生命（末光照抄：多护盾叠加吸收，不替换旧盾）；
  //   2026-08-11：同来源（key=skill.id）刷新不叠加（hp/turns 取最大），
  //   不同来源仍叠加（A6 语义保留）
  shield(ctx, target, source, e, skill) {
    const hp = Math.round(target.maxHp * (e.hpPct || 0));
    const key = (skill && skill.id) || 'shield';
    const existing = (target.shields || []).find((s) => s && typeof s === 'object' && s.key === key);
    if (existing) {
      existing.hp = Math.max(existing.hp, Number.isFinite(hp) ? Math.max(0, hp) : 0);
      existing.turns = Math.max(existing.turns, e.durRounds);
    } else {
      target.shields.push({ hp: Number.isFinite(hp) ? Math.max(0, hp) : 0, turns: e.durRounds, key }); // maxHp 异常 → 0 盾（不产生 NaN）
    }
    ctx.log(`${target.name} 获得护盾（${hp} 点，${e.durRounds} 层）`);
  },

  // 回行动点（AP 回转体系，2026-08-11）：恢复 X 行动点（上限 apMax 内）
  //   s01 基础攻击/s07/s30/s34 回 AP 技/s38 时间回溯/s46 无限魔阵
  ap_recover(ctx, target, source, e) {
    ctx.grantAp(source, e.val || 0);
    ctx.log(`${source.name} 恢复 ${Math.round(e.val || 0)} 行动点`);
  },

  // 易伤：目标受击伤害 ×val，回合递减（末光照抄：多个易伤乘算叠加，1.2×1.5=1.8）
  vuln(ctx, target, source, e) {
    const v = Number.isFinite(e.val) && e.val > 0 ? e.val : 0; // val 缺失/0/非法：不产生 ×1.2 陷阱，视为无效易伤
    if (v > 0 && e.durRounds > 0) {
      const base = target.vulnTurns > 0 && Number.isFinite(target.vulnMult) && target.vulnMult > 0 ? target.vulnMult : 1;
      target.vulnMult = base * v; // 乘算叠加（无残留易伤时从 ×1 起乘）
    }
    target.vulnTurns = Math.max(target.vulnTurns, e.durRounds);
    ctx.log(`${target.name} 受到易伤：伤害 ×${target.vulnMult}（${target.vulnTurns} 回合）`);
  },

  // 献祭（末光照抄 engine.js L383-393）：
  //   代价 = 当前 HP × costPct；最低保留 1 HP（不可自杀）；
  //   伤害 = 献祭 HP 量 × dmgMult × (1+versa/100) × (1+dmg_up/100)（HP 基数，随 HP 膨胀）
  hp_sacrifice(ctx, target, source, e) {
    const base = Number.isFinite(source.hp) ? source.hp : (Number.isFinite(source.maxHp) ? source.maxHp : 1);
    const cost = Math.floor(base * (e.costPct || 0));
    if (!Number.isFinite(source.hp) || source.hp <= cost) { // hp 异常（NaN）同样阻断，不执行献祭
      ctx.log(`${source.name} 生命不足，无法献祭`);
      return false; // 阻断信号：整技视为无法施放，后续效果不执行
    }
    source.hp = Math.max(1, source.hp - cost); // 最低保留 1 HP
    const raw = cost * (e.dmgMult || 0) * source.dmgMultiplier(); // HP 基数 × 倍率 × 增伤乘区
    const dmg = Math.max(1, Math.floor(raw));
    const actual = target.takeDamage(dmg); // 易伤/护盾/受击乘区由 takeDamage 应用
    ctx.log(`${source.name} 献祭 ${cost} 生命，对 ${target.name} 造成 ${actual} 伤害`);
  },

  // Dot 强化：剩余回合内 dot 频率×2 且单次伤害×2（末光照抄：等效 4 倍输出）
  dot_enhance(ctx, target, source, e) {
    target.dotEnhanced = Math.max(target.dotEnhanced, e.durRounds);
    ctx.log(`${target.name} 进入虚空化身：dot 强化 ${e.durRounds} 回合（频率×2 且伤害×2）`);
  },

  // 无敌：回合内免疫伤害
  channel_immune(ctx, target, source, e) {
    target.immuneTurns = Math.max(target.immuneTurns, e.durRounds);
    ctx.log(`${target.name} 进入无敌状态（${e.durRounds} 回合）`);
  },

  // 条件回满：HP 低于技能条件时回满（s45 命运轮转：HP+行动点 全恢复；MP 已删）
  cond_full_heal(ctx, target, source, e) {
    if (Number.isFinite(target.maxHp)) target.hp = target.maxHp; // maxHp 异常时不直接赋值（防 NaN 污染）
    ctx.grantAp(target, 99); // 行动点回满（apMax 封顶）
    ctx.log(`${target.name} 命运逆转：恢复全部生命与行动点！`);
  },

  // 领域：基础每回合 dps 伤害（领域特殊规则 Phase 1 数据化）
  domain(ctx, target, source, e) {
    ctx.openDomain({ unit: source, type: e.domainType, dps: e.dps || 0, turns: e.durRounds, stateName: e.stateName, emoji: e.stateEmoji });
    ctx.log(`${source.name} 展开 ${e.stateName || e.domainType}（每回合 ${Math.round((e.dps || 0) * 100)}% 伤害 × ${e.durRounds} 回合）`);
  },
};

// 执行技能全部效果（伤害 + 效果列表；效果按目标路由分发）
export function executeSkillEffects(ctx, skill, source, target) {
  // 技能自带立即伤害（dmgMult > 0；dot 型技能同样结算——desc"立即 dmgMult% + 后续 dps%"）
  if (skill.dmgMult > 0) {
    const critInfo = {};
    const dmg = calcDamage(source, target, skill.dmgMult, { rng: ctx && ctx.rng, critInfo });
    const actual = target.takeDamage(dmg);
    ctx.log(`${source.name} 使用 ${skill.name} → 对 ${target.name} 造成 ${actual} 点伤害${critInfo.crit ? '（暴击!）' : ''}`);
  }
  // 逐个效果处理器（自增益 → source，对敌 → target）
  for (const e of skill.effectRounds) {
    const handler = EFFECT_HANDLERS[e.type];
    if (!handler) {
      ctx.log(`⚠️ 未知效果类型: ${e.type}（${skill.id}）`);
      continue;
    }
    const effTarget = SELF_EFFECTS.has(e.type) ? source : target;
    if (handler(ctx, effTarget, source, e, skill) === false) break; // 效果阻断（如献祭 HP 不足）→ 后续效果不执行
  }
}

// 回合结束：dot/hot 结算（每回合调用；dot 走统一伤害公式；
// 施放者处于虚空化身（dotEnhanced）时频率×2 且单次伤害×2 = 4 倍，末光照抄）
export function tickDotsHots(ctx, unit) {
  const lines = [];
  const settleDot = (d) => {
    if (!d || !d.source || d.turns <= 0) return; // 畸形/到期 dot 条目守卫（缺 source 或 0 回合不结算、不崩溃）
    const enhanced = d.source.dotEnhanced > 0;
    const dmg = calcDamage(d.source, unit, d.dps * (enhanced ? 2 : 1), { noCrit: true, rng: ctx && ctx.rng }); // 虚空化身：单次伤害×2
    const actual = unit.takeDamage(dmg);
    if (actual > 0) lines.push(`${unit.name} 受 ${d.stateName || 'dot'} 影响：-${actual}`);
  };
  for (const d of unit.dots) {
    settleDot(d);
    if (d && d.source && d.source.dotEnhanced > 0) settleDot(d); // 虚空化身（施放者状态）：频率×2
  }
  for (const h of unit.hots) {
    if (!h || typeof h !== 'object' || h.turns <= 0) continue; // 畸形/到期 hot 条目跳过（不崩溃、不产生 0 回合恢复）
    if (!unit.alive) break; // 已被 dot/领域打死的单位不结算治疗（同回合不可复活，死亡判定在治疗段之前）
    const before = unit.hp;
    unit.heal(unit.maxHp * h.pct);
    const v = unit.hp - before; // 实际恢复量（超上限截断后；heal 返回请求量）
    if (v > 0) lines.push(`${unit.name} 持续恢复：+${v}`);
  }
  return lines;
}
