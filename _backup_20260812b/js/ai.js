// ============================================================
// js/ai.js — 启发式打分 AI（Fate_echo Phase 2）
// 改造自 永恒回想录 enemyAI.js 打分制（NEW_GAME.md §4.2 兜底 AI）：
//   技能得分 = priority×10 + dmgMult×5 + 情境修正（保命/自爆/联动/狂暴）
//   决策：可施放（条件/献祭生命门槛）技能中得分最高者；无 → 基础攻击（返回 null）
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
  sacrificeLow: 300,     // 献祭后残血区间（hp∈(0.5, 0.65]）→ 绝境搏命加分
  sacrificeMid: -150,    // 血充足（hp > 0.65）轻度减分（绝境技不滥用）
  sacrificeNever: -1000, // hp ≤ 0.5 不可施放（handler 会阻断，重度减分防发呆）
  vulnFresh: 40,         // 玩家无易伤时易伤技加分
  vulnExists: -100,      // 玩家已有易伤时重度减分（不重复标记，换高伤技）
  enrageDmg: 60,         // 狂暴后高伤技加分
  enrageNoHeal: -1000,   // 狂暴后放弃治疗
  dotBonus: 10,          // dot 技基础加分
  buffFresh: 30,         // 无同类 buff 时 buff 技加分
  buffHas: -150,         // 已有同类 buff 时重度减分（不无限重放）
  domainFresh: 100,      // 无领域时领域技加分（Boss 大招优先级）
  domainHas: -200,       // 已有领域时重度减分（不无限重放替换）
  lostHpScale: 300,      // 反斩杀：玩家损血比例 × 300（损血 50% → +150）
  lostHpBase: 100,       // 反斩杀基础扣分（玩家满血时 -100 不选，避免 0 伤浪费行动）
  maxHpDmg: 60,          // 比例伤害固定加分（稳定重创）
  debuffFresh: 30,       // 无同类 debuff（降攻/降急速/受疗）时加分
  debuffExists: -100,    // 已有同类 debuff 时减分（不重复叠加）
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
  // 自爆：可施放区间（hp > 代价 50%）内绝境搏命加分；hp ≤ 代价会被 handler 阻断 → 重度减分防发呆
  if (hasEffect(skill, 'hp_sacrifice')) {
    if (enemy.hpPct() > 0.5 && enemy.hpPct() <= 0.65) score += AI_SCORE.sacrificeLow;
    else if (enemy.hpPct() > 0.65) score += AI_SCORE.sacrificeMid;
    else score += AI_SCORE.sacrificeNever;
  }
  if (hasEffect(skill, 'vuln')) score += p.vulnTurns > 0 ? AI_SCORE.vulnExists : AI_SCORE.vulnFresh;
  if (hasEffect(skill, 'dot')) score += AI_SCORE.dotBonus;
  // 增益/领域重复抑制（2026-08-11 审查 B 中项）：已有同类 buff/领域时重度减分，
  //   否则高优先 buff/领域被无限重放（e05 只会石肤/e11 领域永续——机制技能形同虚设）
  if (hasEffect(skill, 'buff')) {
    const stat = (skill.effectRounds && skill.effectRounds[0] || {}).stat;
    score += enemy.buffs.some((b) => b.stat === stat) ? AI_SCORE.buffHas : AI_SCORE.buffFresh;
  }
  if (hasEffect(skill, 'domain')) {
    const dtype = (skill.effectRounds && skill.effectRounds[0] || {}).domainType;
    score += engine.domains.some((d) => d.unit === enemy && d.type === dtype) ? AI_SCORE.domainHas : AI_SCORE.domainFresh;
  }
  // 2026-08-12 敌人技能从零重做新增打分：反斩杀（按玩家损血比例递增）/比例伤害（固定加分）/
  //   降攻/降急速/受疗降低（已有同类 debuff 减分——仿 vuln 模式防重复）
  if (hasEffect(skill, 'lost_hp_dmg')) {
    const lostPct = p.maxHp > 0 ? Math.min(1, Math.max(0, 1 - p.hp / p.maxHp)) : 0;
    // 玩家血越少越优先（反斩杀）；减 base 项防"玩家满血时回响 0 伤仍被选"（AI 不浪费行动）
    score += lostPct * AI_SCORE.lostHpScale - AI_SCORE.lostHpBase;
  }
  if (hasEffect(skill, 'maxhp_dmg')) score += AI_SCORE.maxHpDmg;
  for (const [effType, stat] of [['atk_down', 'atk_down_pct'], ['haste_down', 'haste_down_pct'], ['heal_cut', 'heal_cut_pct']]) {
    if (hasEffect(skill, effType)) {
      score += p.statBonus(stat) > 0 ? AI_SCORE.debuffExists : AI_SCORE.debuffFresh;
    }
  }
  if (hasEffect(skill, 'multi_hit')) {
    const e0 = (skill.effectRounds && skill.effectRounds[0]) || {};
    score += (e0.dmgMult || 0) * (e0.hits || 1) * AI_SCORE.dmgMult; // 按总伤害计分
  }
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

// 可施放集合（条件 + 献祭生命门槛；被动除外）
function usableSkills(enemy, skills) {
  return skills.filter((s) => !s.isPassive && s.canUse(enemy) && sacrificeCastable(enemy, s)); // MP 已删（2026-08-11）
}

// 主行动决策：得分最高者；无 → null（engine 走基础攻击）
// §2.1 拆分：主行动只用非瞬发（瞬发走瞬发槽，见 heuristicPickInstant）
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
