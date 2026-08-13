// ============================================================
// js/collections.js — 收藏品系统（Fate_echo）
// 扩展金酒之杯为完整收藏品体系（用户定案 2026-08-11）：
//   - 局内作用域：存档跟随（读档保留），newGame 清空重收集（黑流树海/杀戮尖塔同款）；
//     金酒之杯（投资奖励）保持全局永久不变
//   - 战后掉落：普通 15% / 精英 30% / Boss 50%（每敌判定，battleRng——种子防 SL）；
//     掉落池排除已拥有
//   - 商店购买：统一 400 金，每次进店随机 2 件未拥有的
// 纯逻辑（无 DOM/存储依赖）——测试友好
// ============================================================

// 收藏品表（8 种：属性 4 + 功能 4）
export const COLLECTIONS = [
  { id: 'col_atk', name: '强攻印记', type: 'atk', desc: '攻击力 +10%' },
  { id: 'col_hp', name: '生命之种', type: 'hp', desc: '最大生命 +20%' },
  { id: 'col_crit', name: '锐利之眼', type: 'crit', desc: '暴击率 +5%' },
  { id: 'col_versa', name: '共鸣之石', type: 'versa', desc: '共鸣 +10%（增伤）' },
  { id: 'col_gold', name: '金币护符', type: 'gold', desc: '战斗/出口金币 +25%' },
  { id: 'col_quality', name: '寻宝罗盘', type: 'quality', desc: '装备掉落候选品质下限 +1 档（仅战斗掉落）' },
  { id: 'col_shop', name: '商人之契', type: 'shop', desc: '商店价格 9 折' },
  { id: 'col_heal', name: '治疗之泉', type: 'heal', desc: '篝火恢复量 +50%' },
];

// 商店售价（统一 400，用户定案；装备 40-360 / 抽卡 100 之上）
export const COLLECTION_PRICE = 400;

// 战后掉落概率（按敌人 tier，用户定案）
export const COLLECTION_DROP_RATE = { normal: 0.15, elite: 0.3, boss: 0.5 };

// 收藏品数据查表
export function collectionById(id) {
  return COLLECTIONS.find((c) => c.id === id) || null;
}

// 已拥有集合（player.collections 字符串数组 → Set）
export function ownedSet(player) {
  return new Set(Array.isArray(player && player.collections) ? player.collections : []);
}

// 收藏品加成汇总（纯函数）：
//   { atk_pct, hp_pct, crit, versa, gold_pct, quality, shop_discount, heal_pct }
//   player: { collections: string[] }
export function collectionBonus(player) {
  const owned = ownedSet(player);
  const b = { atk_pct: 0, hp_pct: 0, crit: 0, versa: 0, gold_pct: 0, quality: 0, shop_discount: 1, heal_pct: 0 };
  if (owned.has('col_atk')) b.atk_pct += 10;
  if (owned.has('col_hp')) b.hp_pct += 20;
  if (owned.has('col_crit')) b.crit += 5;
  if (owned.has('col_versa')) b.versa += 10;
  if (owned.has('col_gold')) b.gold_pct += 25;
  if (owned.has('col_quality')) b.quality += 1;
  if (owned.has('col_shop')) b.shop_discount *= 0.9;
  if (owned.has('col_heal')) b.heal_pct += 50;
  return b;
}

// 战后收藏品掉落：按 tier 概率判定；从未拥有池随机挑 1 件；返回收藏品或 null
// rng 可注入（战斗掉落用 battleRng，种子防 SL 一致）
export function rollCollectionDrop(rng = Math.random, tier = 'normal', player = {}) {
  const rate = COLLECTION_DROP_RATE[tier] || 0.15;
  if (rng() >= rate) return null;
  const owned = ownedSet(player);
  const pool = COLLECTIONS.filter((c) => !owned.has(c.id));
  if (!pool.length) return null;
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}

// 商店收藏品供给：随机 2 件未拥有的（已全拥有 → 空数组，不出售区）
export function shopCollectionStock(rng = Math.random, player = {}) {
  const owned = ownedSet(player);
  const pool = COLLECTIONS.filter((c) => !owned.has(c.id));
  const out = [];
  while (pool.length && out.length < 2) {
    const idx = Math.floor(rng() * pool.length);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}
