// ============================================================
// tools/test_atm.mjs — 前瞻性投资系统测试（Fate_echo，黑流树海蓝本）
// 验证（用户定案 2026-08-10）：奖励阶梯按历史累计投资额（15/50/125/250/500）、
//   取款 15 解锁 1:1 无损、商店 9 折（50）、商品数 3→4→5（125/500）、
//   金酒之杯金币 +10%（250）
// 用法: node tools/test_atm.mjs
// ============================================================

import {
  ATM_REWARDS, ATM_DENOMS, atmRewardInfo, canWithdraw, discountRate, stockCount, goldBonusRate,
} from '../js/atm.js';

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

console.log('== A. 奖励阶梯表 ==');
{
  t('A1 五档奖励（15/50/125/250/500）', ATM_REWARDS.map((r) => r.threshold).join() === '15,50,125,250,500');
  t('A2 存款档位（10/50/100）', ATM_DENOMS.join() === '10,50,100');
  t('A3 奖励描述完整', ATM_REWARDS.every((r) => r.desc.length > 0));
}

console.log('== B. atmRewardInfo 边界 ==');
{
  const r0 = atmRewardInfo(0);
  t('B1 0 累计：无解锁、下一档 15 还差 15', r0.unlocked.length === 0 && r0.next.threshold === 15 && r0.nextGap === 15);
  const r14 = atmRewardInfo(14);
  t('B2 14：未解锁取款', r14.unlocked.length === 0 && r14.nextGap === 1);
  const r15 = atmRewardInfo(15);
  t('B3 15：解锁取款', r15.unlocked.length === 1 && r15.unlocked[0].threshold === 15 && r15.next.threshold === 50);
  const r49 = atmRewardInfo(49);
  t('B4 49：仅取款', r49.unlocked.length === 1 && r49.nextGap === 1);
  const r50 = atmRewardInfo(50);
  t('B5 50：+商店 9 折', r50.unlocked.length === 2 && r50.next.threshold === 125);
  const r124 = atmRewardInfo(124);
  t('B6 124：两档，下一档还差 1', r124.unlocked.length === 2 && r124.nextGap === 1);
  const r125 = atmRewardInfo(125);
  t('B7 125：+1 商品', r125.unlocked.length === 3 && r125.next.threshold === 250);
  const r249 = atmRewardInfo(249);
  t('B8 249：三档，金酒之杯还差 1', r249.unlocked.length === 3 && r249.nextGap === 1);
  const r250 = atmRewardInfo(250);
  t('B9 250：+金酒之杯', r250.unlocked.length === 4 && r250.next.threshold === 500);
  const r499 = atmRewardInfo(499);
  t('B10 499：四档，最后一档还差 1', r499.unlocked.length === 4 && r499.nextGap === 1);
  const r500 = atmRewardInfo(500);
  t('B11 500：全部解锁', r500.unlocked.length === 5 && r500.next === null);
  const rBig = atmRewardInfo(9999);
  t('B12 9999：全部解锁', rBig.unlocked.length === 5 && rBig.next === null);
  const rNeg = atmRewardInfo(-5);
  t('B13 负值容错（按 0）', rNeg.unlocked.length === 0);
  const rFloat = atmRewardInfo(14.9);
  t('B14 小数取整（14.9 → 14）', rFloat.unlocked.length === 0);
}

console.log('== C. 功能判定函数 ==');
{
  t('C1 canWithdraw：14 否 / 15 是', canWithdraw(14) === false && canWithdraw(15) === true && canWithdraw(999) === true);
  t('C2 discountRate：49 原价 / 50 九折', discountRate(49) === 1 && discountRate(50) === 0.9 && discountRate(999) === 0.9);
  t('C3 stockCount：3 / 125→4 / 500→5', stockCount(0) === 3 && stockCount(124) === 3 && stockCount(125) === 4 && stockCount(499) === 4 && stockCount(500) === 5);
  t('C4 goldBonusRate：249 无加成 / 250 +10%', goldBonusRate(249) === 1 && goldBonusRate(250) === 1.1 && goldBonusRate(999) === 1.1);
}

console.log(`\n========== test_atm 结果：${pass} 通过 / ${fail} 失败 ==========`);
if (fail) process.exit(1);
