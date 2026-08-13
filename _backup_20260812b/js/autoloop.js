// ============================================================
// js/autoloop.js — 玩家自动循环辅助（Fate_echo Phase 3）
// NEW_GAME.md §6.2：Tab 切换"手动/自动"，自动用 priority 序列，
//   作为辅助而非默认（玩家随时可切回手动）。
// 决策规则（priority 序列 + 保命修正，比纯 priority 更能打）：
//   瞬发链：护盾（HP<70% 无盾）> 回 AP（AP<上限，s07/s30/s34 回转）
//   （终焉一律不自动：s45 命运轮转等手动使用，2026-08-11）
//   主技能：治疗/持续治疗（HP<50%，血够不用奶）> 其余按 priority 降序
//           循环入队直到净消耗排满（s01 基础攻击净 0 白嫖 1 槽）
// 注意：queueMain/queueInstant 有入队副作用（pending push + refresh 事件）；
//   只读探测请用 engine.canQueueMain/canQueueInstant（本模块仅在确定入队时
//   调用 queue*，候选过滤一律走 canQueue* 纯校验）
// ============================================================

import { hasEffect } from './ai.js';

// 保命阈值（命名常量，便于平衡）
export const AUTOLOOP = {
  shieldHp: 0.7,  // HP <70% 无盾开盾
  healHp: 0.5,    // HP <50% 治疗优先
  healPool: 0.8,  // HP <80% 治疗进常规候选
};

// 自动行动一回合（入队 + 确认）；非玩家阶段返回 false
export function autoLoopTurn(engine) {
  if (engine.phase !== 'player') return false;
  const p = engine.player;
  // 2026-08-11 终焉独占修复（审查严重项）：自动模式排除全部终焉（终焉 = 手动大招决策）——
  //   s45 命运轮转不例外：s45 无代价每回合触发 = 无敌循环（2026-08-11 用户定案）
  const mains = engine.playerSkills.filter((s) => !s.isInstant && !s.isPassive && !s.isFinale);
  const instants = engine.playerSkills.filter((s) => s.isInstant && !s.isFinale);

  // 多目标：集火当前血量最少的存活敌人（死敌不参与排序；目标死亡自动转移兜底）
  const alive = engine.enemies.map((en, i) => [en, i]).filter(([en]) => en.alive);
  if (alive.length) {
    alive.sort((a, b) => a[0].hp - b[0].hp);
    engine.selectTarget(alive[0][1]);
  }

  // ---- 瞬发链（每回合 1 槽） ----
  // 护盾：HP<70% 无盾开盾 > 回 AP：AP 未满上限时用回 AP 技（s07/s30/s34/s38）
  // （s45 命运轮转已随终焉排除——自动模式不使用终焉，2026-08-11）
  const shield = instants.find((s) => hasEffect(s, 'shield'));
  if (shield && p.hpPct() < AUTOLOOP.shieldHp && !p.shield && engine.queueInstant(shield.id).ok) {
    // 血少无盾开盾
  } else {
    const apGain = instants.find((s) => hasEffect(s, 'ap_recover'));
    if (apGain && engine.ap < engine.apMax && engine.queueInstant(apGain.id).ok) {
      // AP 未满回 AP（回转）
    }
  }

  // ---- 主技能链 ----
  // 保命：HP<50% 时优先治疗/持续治疗（选 priority 最高者）
  const healish = mains
    .filter((s) => (hasEffect(s, 'heal') || hasEffect(s, 'hot')) && p.hpPct() < AUTOLOOP.healHp)
    .sort((a, b) => b.priority - a.priority);
  if (healish[0] && engine.queueMain(healish[0].id).ok) {
    // 已入队治疗（AP 被占，不再排输出）
  } else {
    // 常规输出：priority 降序，循环入队直到净消耗排满（治疗技仅在 HP<80% 参与，
    // 避免血满浪费输出）。回 AP 技（s01 基础攻击）净 0 消耗，
    // 白嫖 1 槽——AP 回转体系下每回合可免费平砍（稳定伤害源兜底）
    const usable = mains
      .filter((s) => {
        if (hasEffect(s, 'heal') || hasEffect(s, 'hot')) return p.hpPct() < AUTOLOOP.healPool;
        return true;
      })
      .sort((a, b) => b.priority - a.priority);
    for (const s of usable) {
      if (engine.canQueueMain(s.id) !== '') continue; // 条件/行动点不足 → 试下一个
      const netMains = engine.pending.filter((a) => a.kind === 'main' && !hasEffect(a.skill, 'ap_recover')).length;
      if (!hasEffect(s, 'ap_recover') && netMains >= engine.ap) break;
      if (!engine.queueMain(s.id).ok) continue;
    }
  }

  engine.confirm();
  return true;
}
