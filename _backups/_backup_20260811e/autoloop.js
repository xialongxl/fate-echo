// ============================================================
// js/autoloop.js — 玩家自动循环辅助（Fate_echo Phase 3）
// NEW_GAME.md §6.2：Tab 切换"手动/自动"，自动用 priority 序列，
//   作为辅助而非默认（玩家随时可切回手动）。
// 决策规则（priority 序列 + 保命修正，比纯 priority 更能打）：
//   瞬发链：命运轮转（HP<30% 绝境，条件由引擎拦截）> 护盾（HP<70% 无盾）
//           > 回蓝（MP<40%）
//   主技能：治疗/持续治疗（HP<50%，血够不用奶）> 其余按 priority 降序
//           循环入队直到 AP 排满
// 注意：queueMain/queueInstant 有入队副作用（pending push + refresh 事件）；
//   只读探测请用 engine.canQueueMain/canQueueInstant（本模块仅在确定入队时
//   调用 queue*，候选过滤一律走 canQueue* 纯校验）
// ============================================================

import { hasEffect } from './ai.js';

// 保命阈值（命名常量，便于平衡）
export const AUTOLOOP = {
  s45Hp: 0.3,     // HP <30% 用命运轮转（与 s45 conditionMaxHPPct 一致）
  shieldHp: 0.7,  // HP <70% 无盾开盾
  manaPct: 0.4,   // MP <40% 回蓝
  healHp: 0.5,    // HP <50% 治疗优先
  healPool: 0.8,  // HP <80% 治疗进常规候选
};

// 自动行动一回合（入队 + 确认）；非玩家阶段返回 false
export function autoLoopTurn(engine) {
  if (engine.phase !== 'player') return false;
  const p = engine.player;
  // 2026-08-11 终焉独占修复（审查严重项）：自动模式排除终焉 spam（终焉 = 手动大招决策）——
  //   唯一例外 s45 命运轮转（HP<30% 绝境保命链，条件触发非 spam）；s40 献祭自残等不再自动施放
  const mains = engine.playerSkills.filter((s) => !s.isInstant && !s.isPassive && !s.isFinale);
  const instants = engine.playerSkills.filter((s) => s.isInstant && (s.id === 's45' || !s.isFinale));

  // 多目标：集火当前血量最少的存活敌人（死敌不参与排序；目标死亡自动转移兜底）
  const alive = engine.enemies.map((en, i) => [en, i]).filter(([en]) => en.alive);
  if (alive.length) {
    alive.sort((a, b) => a[0].hp - b[0].hp);
    engine.selectTarget(alive[0][1]);
  }

  // ---- 瞬发链（每回合 1 槽） ----
  // 命运轮转：HP<30% 绝境翻盘（条件由引擎拦截）。注意：若本回合再排治疗，
  // 主技能先结算会把血奶上来 → s45 条件不满足被跳过 → 绝境翻盘失效
  let usedS45 = false;
  const s45 = instants.find((s) => s.id === 's45');
  if (s45 && p.hpPct() < AUTOLOOP.s45Hp && engine.queueInstant('s45').ok) {
    usedS45 = true;
  } else {
    const shield = instants.find((s) => hasEffect(s, 'shield'));
    if (shield && p.hpPct() < AUTOLOOP.shieldHp && !p.shield && engine.queueInstant(shield.id).ok) {
      // 血少无盾开盾
    } else {
      const mp = instants.find((s) => hasEffect(s, 'mp_recover_pct') && s.id !== 's45');
      if (mp && p.mpPct() < AUTOLOOP.manaPct && engine.queueInstant(mp.id).ok) {
        // 蓝少回蓝
      }
    }
  }

  // ---- 主技能链 ----
  // 保命：HP<50% 时优先治疗/持续治疗（选 priority 最高者；s45 已入队时跳过——s45 将回满）
  const healish = mains
    .filter((s) => (hasEffect(s, 'heal') || hasEffect(s, 'hot')) && !usedS45 && p.hpPct() < AUTOLOOP.healHp)
    .sort((a, b) => b.priority - a.priority);
  if (healish[0] && engine.queueMain(healish[0].id).ok) {
    // 已入队治疗（AP 被占，不再排输出）
  } else {
    // 常规输出：priority 降序，循环入队直到 AP 排满（治疗技仅在 HP<80% 参与，
    // 避免血满浪费法力；s45 已入队时完全排除治疗）
    const usable = mains
      .filter((s) => {
        if (hasEffect(s, 'heal') || hasEffect(s, 'hot')) return !usedS45 && p.hpPct() < AUTOLOOP.healPool;
        return true;
      })
      .filter((s) => engine.canQueueMain(s.id) === '')
      .sort((a, b) => b.priority - a.priority);
    for (const s of usable) {
      if (engine.pending.filter((a) => a.kind === 'main').length >= engine.ap) break;
      if (!engine.queueMain(s.id).ok) break;
    }
  }

  engine.confirm();
  return true;
}
