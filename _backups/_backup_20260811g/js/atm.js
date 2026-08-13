// ============================================================
// js/atm.js — 前瞻性投资系统（商店 ATM 存款机，Fate_echo）
// 蓝本：黑流树海"前瞻性投资系统"（PRTS wiki 核实）——
//   商店投资，余额 + 历史累计投资额跨局全局保留；奖励按历史累计解锁；
//   取款功能（15 累计后解锁，1:1 无损——以撒捐款机"钱拿回来"语义）
// 用户定案（2026-08-10）奖励阶梯：
//   15  → 解锁取款功能
//   50  → 商店永久 9 折
//   125 → 商店 3→4 件商品
//   250 → 收藏品【金酒之杯】：战斗/出口金币获取 +10%
//   500 → 商店 4→5 件商品
// 纯逻辑（无 DOM/存储依赖）——测试友好；存储走 save.js settings 表
//   （IndexedDB 独立 objectStore，跨存档槽共享 = 唯一的全局变量）
// ============================================================

// 奖励阶梯表（按历史累计投资额 atm_total_deposited，只增不减）
export const ATM_REWARDS = [
  { threshold: 15, desc: '解锁取款功能' },
  { threshold: 50, desc: '商店永久 9 折' },
  { threshold: 125, desc: '商店额外出售 1 件商品' },
  { threshold: 250, desc: '收藏品【金酒之杯】：战斗/出口金币 +10%' },
  { threshold: 500, desc: '商店额外出售 1 件商品' },
];

// 存款档位（单次投入/取出额度）
export const ATM_DENOMS = [10, 50, 100];

// 奖励信息：{ unlocked: [{threshold, desc}], next: {threshold, desc}|null, nextGap }
// total = 历史累计投资额（黑流树海：按历史累计判定，非当前余额）
export function atmRewardInfo(total) {
  const t = Math.max(0, Math.floor(total) || 0);
  const unlocked = ATM_REWARDS.filter((r) => t >= r.threshold);
  const next = ATM_REWARDS.find((r) => t < r.threshold) || null;
  return { unlocked, next, nextGap: next ? next.threshold - t : 0 };
}

// 取款解锁：累计投资 ≥ 15
export function canWithdraw(total) {
  return Math.max(0, Math.floor(total) || 0) >= 15;
}

// 商店折扣率（50 后 9 折）
export function discountRate(total) {
  return Math.max(0, Math.floor(total) || 0) >= 50 ? 0.9 : 1;
}

// 商店商品数（125→4，500→5，默认 3）
export function stockCount(total) {
  const t = Math.max(0, Math.floor(total) || 0);
  return t >= 500 ? 5 : t >= 125 ? 4 : 3;
}

// 金酒之杯（250）：战斗/出口金币获取 +10%
export function goldBonusRate(total) {
  return Math.max(0, Math.floor(total) || 0) >= 250 ? 1.1 : 1;
}
