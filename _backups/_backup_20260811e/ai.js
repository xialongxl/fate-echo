// ============================================================
// js/ai.js — 启发式打分 AI（Fate_echo Phase 2）
// 改造自 永恒回想录 enemyAI.js 打分制（NEW_GAME.md §4.2 兜底 AI）：
//   技能得分 = priority×10 + dmgMult×5 + 情境修正（保命/自爆/联动/狂暴）
//   决策：可施放（冷却/条件/法力）技能中得分最高者；无 → 基础攻击（返回 null）
//   rng 扰动 ±20 提供多样性（对应设计"60% 随机特殊技"的简化——
//     语义为打分抖动而非概率分支；单玩家设定下"目标≥3 用 AOE"与
//     目标打分制天然不适用（敌人唯一目标即玩家），故未实现）
// SmartAI 训练不足时以此兜底——任何时刻敌人都有合理行为
// 接口与 SmartAI 一致（decide / pickInstant），engine 可互换
// ============================================================

// 情境修正权重（常量集中，便于平衡与测试）
export const AI_SCORE = {
  priority: 10,          // priority × 10
  dmgMult: 5,            // dmgMult × 5
  healLow: 150,          // 血 <50% 时治疗技加分
  healWaste: -200,       // 血健康时治疗技减分（不浪费）
  shieldNone: 30,        // 无盾时护盾技加分
  shieldHas: -100,       // 已有盾时护盾技减分
  mpLow: 80,             // 蓝 <40% 时回蓝技加分
  mpHigh: -150,          // 蓝充足时回蓝技减分
  sacrificeLow: 300,     // 献祭后残血区间（hp∈(0.5, 0.65]）→ 绝境搏命加分
  sacrificeMid: -150,    // 血充足（hp > 0.65）轻度减分（绝境技不滥用）
  sacrificeNever: -1000, // hp ≤ 0.5 不可施放（handler 会阻断，重度减分防发呆）
  vulnFresh: 40,         // 玩家无易伤时易伤技加分
  vulnExists: -100,      // 玩家已有易伤时重度减分（不重复标记，换高伤技）
  enrageDmg: 60,         // 狂暴后高伤技加分
  enrageNoHeal: -1000,   // 狂暴后放弃治疗
  dotBonus: 10,          // dot 技基础加分
};

// 效果类型检测（自动循环/启发式共用）
export const hasEffect = (skill, type) => (skill.effectRounds || []).some((e) => e.type === type);

// 单技能打分（确定性部分 + rng 扰动；rng 缺省不扰动——测试可确定性）
export function scoreSkill(engine, enemy, skill, { rng = null } = {}) {
  const p = engine.player;
  let score = skill.priority * AI_SCORE.priority + skill.dmgMult * AI_SCORE.dmgMult;
  const healish = hasEffect(skill, 'heal') || hasEffect(skill, 'hot');
  if (healish) score += enemy.hpPct() < 0.5 ? AI_SCORE.healLow : AI_SCORE.healWaste;
  if (hasEffect(skill, 'shield')) score += enemy.shield ? AI_SCORE.shieldHas : AI_SCORE.shieldNone;
  if (hasEffect(skill, 'mp_recover_pct')) score += enemy.mpPct() < 0.4 ? AI_SCORE.mpLow : AI_SCORE.mpHigh;
  // 自爆：可施放区间（hp > 代价 50%）内绝境搏命加分；hp ≤ 代价会被 handler 阻断 → 重度减分防发呆
  if (hasEffect(skill, 'hp_sacrifice')) {
    if (enemy.hpPct() > 0.5 && enemy.hpPct() <= 0.65) score += AI_SCORE.sacrificeLow;
    else if (enemy.hpPct() > 0.65) score += AI_SCORE.sacrificeMid;
    else score += AI_SCORE.sacrificeNever;
  }
  if (hasEffect(skill, 'vuln')) score += p.vulnTurns > 0 ? AI_SCORE.vulnExists : AI_SCORE.vulnFresh;
  if (hasEffect(skill, 'dot')) score += AI_SCORE.dotBonus;
  if (enemy.enraged) {
    if (skill.dmgMult >= 3) score += AI_SCORE.enrageDmg;
    if (healish) score += AI_SCORE.enrageNoHeal;
  }
  if (rng) score += (rng() - 0.5) * 40; // 随机扰动 ±20
  return score;
}

// 献祭生命门槛（与 effects.js hp_sacrifice handler 一致）：当前 HP 基数 + floor
//   （2026-08-11 统一：此前用 maxHp 基数 + round，敌人半血后 AI 永不自爆，比引擎实际更保守）
export function sacrificeCastable(unit, skill) {
  for (const e of skill.effectRounds) {
    if (e.type !== 'hp_sacrifice') continue;
    const base = Number.isFinite(unit.hp) ? unit.hp : (Number.isFinite(unit.maxHp) ? unit.maxHp : 1);
    const cost = Math.floor(base * (e.costPct || 0));
    if (!Number.isFinite(unit.hp) || unit.hp <= cost) return false;
  }
  return true;
}

// 可施放集合（冷却 + 条件 + 法力 + 献祭生命门槛；被动除外）
function usableSkills(enemy, skills) {
  return skills.filter((s) => !s.isPassive && s.canUse(enemy) && s.cost <= enemy.mp && sacrificeCastable(enemy, s));
}

// 主行动决策：得分最高者；无 → null（engine 走基础攻击）
// §2.1 拆分：主行动只用非瞬发（ogcd 走瞬发槽，见 heuristicPickInstant）
export function heuristicDecide(engine, enemy, skills, rng = null) {
  const usable = usableSkills(enemy, skills).filter((s) => !s.isInstant);
  if (!usable.length) return null;
  let best = null, bestScore = -Infinity;
  for (const s of usable) {
    const sc = scoreSkill(engine, enemy, s, { rng });
    if (sc > bestScore) { bestScore = sc; best = s; }
  }
  return bestScore > 0 ? best : null; // 全负分（如血健康时只剩治疗技）→ 基础攻击
}

// 精英/Boss 瞬发决策（NEW_GAME.md §2.1：0~1 次瞬发）
export function heuristicPickInstant(engine, enemy, skills, rng = null) {
  const usable = usableSkills(enemy, skills).filter((s) => s.isInstant);
  if (!usable.length) return null;
  let best = null, bestScore = -Infinity;
  for (const s of usable) {
    const sc = scoreSkill(engine, enemy, s, { rng });
    if (sc > bestScore) { bestScore = sc; best = s; }
  }
  return bestScore > 0 ? best : null;
}
