// ============================================================
// tools/test_equipment.mjs — 装备系统测试 v3（Fate_echo，末光咏叹全量照抄）
// 验证：生成器（atk/int 属性体系/品质 color/词缀范围/orbSlots/baseScore/score）
//   品质楼层浮动阈值表/评分三公式/强化（费用/成功率/主属性递增+加值/副属性+0.5）
//   精炼（3 精华/15 次曲线/cap/第15次补齐）/宝珠（镶嵌/同类上限3/评分）
//   分解（金币+终焉精华）/掉落闭环（LootFilter→自动熔炼/自动穿/图鉴）/LootFilter 规则
// 确定性序列 rng（LCG）
// 用法: node tools/test_equipment.mjs
// ============================================================

import {
  SLOTS, SLOT_NAMES, GEAR_RARITY, AFFIXES, ORBS, MAX_SAME_ORB, ENHANCE_MAX, REFINE_MAX, REFINE_COST,
  rollRarity, rollEquipment, gearBaseScore, recalcGearScore, enhanceCost, enhanceRate, enhanceGear,
  getAffixCap, getRefineWeight, getRefineTotalWeight, getRefineIncrementDynamic, refineAffix,
  sockOrb, unsocketOrb, calcOrbBonus, getGearOrbBonus, salvageGear, lootGear, LootFilter,
  equipFromInventory, unequip, recordFinaleCollection, finaleCollectionComplete,
} from '../js/equipment.js';

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

let seed = 42;
const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

// localStorage 桩（LootFilter 阈值/规则持久化）
globalThis.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] !== undefined ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};

const mkPlayer = (o = {}) => ({
  level: 10, gold: 100000, inventory: [], equipment: { weapon: null, head: null, chest: null, legs: null, feet: null, pendant: null, ring: null, trinket: null },
  finaleEssence: 10, finaleCollection: { weapon: false, head: false, chest: false, legs: false, feet: false, pendant: false, ring: false, trinket: false },
  ...o,
});

console.log('== A. 生成器（末光 GearGenerator 照抄） ==');
{
  const g = rollEquipment(rng, { floor: 1, forceRarity: 5 });
  t('A1 品质 color 字段（q0~q8）', GEAR_RARITY.every((r, i) => r.color === 'q' + i));
  t('A2 槽位命名（末光：帽子/上衣/裤子/鞋子）', SLOT_NAMES.head === '帽子' && SLOT_NAMES.chest === '上衣' && SLOT_NAMES.legs === '裤子' && SLOT_NAMES.feet === '鞋子');
  t('A3 生成器字段完整（orbs/baseScore/refineLevels/refineInitialValues）', g.orbs && g.baseScore > 0 && g.refineLevels && g.refineInitialValues && g.score === g.baseScore);
  t('A4 主属性按部位（武器 atk 为主、int=0）', (() => {
    const w = rollEquipment(rng, { floor: 1, forceRarity: 3, forceSlot: 'weapon' });
    return w.stats.atk > 0 && w.stats.int === 0;
  })());
  t('A5 防具 int 为主（atk=0）', (() => {
    const a = rollEquipment(rng, { floor: 1, forceRarity: 3, forceSlot: 'chest' });
    return a.stats.int > 0 && a.stats.atk === 0;
  })());
  t('A6 首饰 atk/int 双修', (() => {
    const acc = rollEquipment(rng, { floor: 1, forceRarity: 3, forceSlot: 'ring' });
    return acc.stats.atk > 0 && acc.stats.int > 0;
  })());
  t('A7 orbSlots：终焉3/传说2/精良1/普通0', rollEquipment(rng, { floor: 1, forceRarity: 8 }).orbs.length === 3 && rollEquipment(rng, { floor: 1, forceRarity: 5 }).orbs.length === 2 && rollEquipment(rng, { floor: 1, forceRarity: 2 }).orbs.length === 1 && rollEquipment(rng, { floor: 1, forceRarity: 1 }).orbs.length === 0);
  t('A8 终焉自动 locked', rollEquipment(rng, { floor: 1, forceRarity: 8 }).locked === true);
  t('A9 词缀范围照抄（武器 crit 5~15）', (() => {
    let min = 99, max = 0;
    for (let i = 0; i < 200; i++) {
      const w = rollEquipment(rng, { floor: 1, forceRarity: 5, forceSlot: 'weapon' });
      if (w.stats.crit !== undefined) { min = Math.min(min, w.stats.crit); max = Math.max(max, w.stats.crit); }
    }
    return max <= 50 && min >= 5;
  })());
  t('A10 楼层浮动：高层高品质概率更高', (() => {
    let low = 0, high = 0;
    for (let i = 0; i < 500; i++) { if (rollRarity(rng, 1) >= 5) low++; }
    seed = 42;
    for (let i = 0; i < 500; i++) { if (rollRarity(rng, 60) >= 5) high++; }
    return high > low;
  })());
}

console.log('== B. 品质阈值表（末光楼层浮动照抄） ==');
{
  // rng 值 ×100 = rVal：<0.1 终焉、<0.5 圣物、<2 神话、<8 传说、<20 史诗、<45 卓越、<75 精良、<85 破损、其余普通
  const vals = [[0.0005, 8], [0.001, 7], [0.005, 6], [0.02, 5], [0.08, 4], [0.2, 3], [0.45, 2], [0.75, 0], [0.85, 1]];
  t('B1 阈值表逐档判定', vals.every(([v, expect]) => rollRarity(() => v, 1) === expect), vals.map(([v, e]) => `${v}->${rollRarity(() => v, 1)}(${e})`).join(' '));
  t('B2 楼层减益：floor/10 扣减（floor=50 → rVal 0.03 减 5 → 0 → 终焉）', rollRarity(() => 0.03, 50) === 8);
}

console.log('== C. 评分公式（末光三套） ==');
{
  const weapon = { slot: 'weapon', stats: { atk: 10, haste: 2, crit: 4, versa: 2 } };
  t('C1 武器 atk×10+副×0.5', gearBaseScore(weapon) === Math.floor(10 * 10 + 2 * 0.5 + 4 * 0.5 + 2 * 0.5));
  const armor = { slot: 'chest', stats: { int: 10, haste: 2 } };
  t('C2 防具 int×10+副×0.5', gearBaseScore(armor) === Math.floor(10 * 10 + 2 * 0.5));
  const acc = { slot: 'ring', stats: { atk: 5, int: 5, crit: 2, haste: 2, versa: 2 } };
  t('C3 首饰 (atk+int)×5+副×1', gearBaseScore(acc) === Math.floor(5 * 5 + 5 * 5 + 2 + 2 + 2));
}

console.log('== D. 强化（末光 enhanceGear 照抄） ==');
{
  const p = mkPlayer();
  const gear = rollEquipment(rng, { floor: 1, forceRarity: 3, forceSlot: 'weapon' });
  p.inventory.push(gear);
  t('D1 费用公式 (rIdx+1)×300×1.8^lv', enhanceCost(gear, 0) === (3 + 1) * 300 && enhanceCost(gear, 3) === Math.floor(4 * 300 * Math.pow(1.8, 3)));
  t('D2 成功率 95-7lv 保底 30%', enhanceRate(0) === 0.95 && enhanceRate(12) === 0.3);
  const atkBefore = gear.stats.atk;
  const r = enhanceGear(p, gear.id, () => 0.1); // 必成功
  t('D3 强化成功 +1', r.ok && r.success && gear.enhanceLv === 1);
  t('D4 主属性 ×(1.05+1×0.03)+5', gear.stats.atk === Math.floor(atkBefore * 1.08) + 5, `atk=${gear.stats.atk} expect=${Math.floor(atkBefore * 1.08) + 5}`);
  t('D5 评分重算（score=baseScore+orbScore）', gear.score === gear.baseScore);
  const goldBefore = p.gold;
  const r2 = enhanceGear(p, gear.id, () => 0.99);
  t('D6 失败扣金币不升级', r2.ok && !r2.success && p.gold < goldBefore && gear.enhanceLv === 1);
  const poor = mkPlayer({ gold: 1 });
  poor.inventory.push(rollEquipment(rng, { floor: 1, forceRarity: 1 }));
  const r3 = enhanceGear(poor, poor.inventory[0].id, rng);
  t('D7 金币不足拒绝', !r3.ok && r3.reason === '金币不足');
  // 副属性 +0.5（若存在）
  const g2 = rollEquipment(rng, { floor: 1, forceRarity: 5, forceSlot: 'weapon' });
  if (g2.stats.crit !== undefined) {
    const before = g2.stats.crit;
    p.inventory.push(g2);
    enhanceGear(p, g2.id, () => 0.1);
    t('D8 副属性 +0.5 且受上限保护', g2.stats.crit === Math.min(50, before + 0.5), `crit=${g2.stats.crit}`);
  } else {
    t('D8 副属性 +0.5（无 crit 词缀则跳过）', true);
  }
}

console.log('== E. 精炼（末光 refineAffix 照抄） ==');
{
  const p = mkPlayer();
  const gear = rollEquipment(rng, { floor: 1, forceRarity: 8, forceSlot: 'weapon' });
  p.inventory.push(gear);
  const aff = Object.keys(gear.stats).find((k) => AFFIXES.includes(k));
  t('E1 终焉装备有词缀可精炼', !!aff);
  const cap = getAffixCap('weapon', aff);
  const initial = gear.stats[aff];
  t('E2 cap：武器 40', cap === 40);
  t('E3 权重曲线 15→1（总和 120）', getRefineWeight(0) === 15 && getRefineWeight(14) === 1 && getRefineTotalWeight() === 120);
  const first = refineAffix(p, gear, aff);
  t('E4 精炼消耗 3 精华', p.finaleEssence === 7 && first && first.newLevel === 1);
  t('E5 首次精炼记录 initialVal', gear.refineInitialValues[aff] === initial);
  t('E6 增量 = (cap-initial)×15/120', Math.abs(first.increment - (cap - initial) * (15 / 120)) < 1e-9, `inc=${first.increment}`);
  const poor = mkPlayer({ finaleEssence: 2 });
  poor.inventory.push(rollEquipment(rng, { floor: 1, forceRarity: 8 }));
  t('E7 精华不足返回 null', refineAffix(poor, poor.inventory[0], aff) === null);
  // 第 15 次补齐
  const p2 = mkPlayer({ finaleEssence: 999 });
  const g2 = rollEquipment(rng, { floor: 1, forceRarity: 8, forceSlot: 'ring' });
  const aff2 = Object.keys(g2.stats).find((k) => AFFIXES.includes(k));
  let last = null;
  for (let i = 0; i < 15; i++) last = refineAffix(p2, g2, aff2);
  t('E8 15 次精炼到 cap', last && last.newLevel === 15 && g2.stats[aff2] === getAffixCap('ring', aff2), `val=${g2.stats[aff2]} cap=${getAffixCap('ring', aff2)}`);
  t('E9 精炼后评分重算', g2.score === g2.baseScore);
}

console.log('== F. 宝珠（末光 ORBS/MAX_SAME_ORB 照抄） ==');
{
  const p = mkPlayer();
  const gear = rollEquipment(rng, { floor: 1, forceRarity: 8, forceSlot: 'chest' });
  p.equipment.chest = gear;
  t('F1 宝珠 5 种', ORBS.length === 5 && ORBS[0].id === 'orb_hp' && ORBS[4].id === 'orb_finale');
  t('F2 同类上限 3', MAX_SAME_ORB === 3);
  const r1 = sockOrb(p, gear, 'orb_hp');
  t('F3 镶嵌成功（评分 +450）', r1.ok && gear.score === gear.baseScore + 45 * 10);
  sockOrb(p, gear, 'orb_hp');
  sockOrb(p, gear, 'orb_hp');
  const r4 = sockOrb(p, gear, 'orb_hp'); // 第 4 个同类 → 拒绝
  t('F4 同类上限 3 拒绝第 4 个', r4 && !r4.ok && gear.orbs.filter((o) => o === 'orb_hp').length === 3);
  t('F5 槽满拒绝', sockOrb(p, gear, 'orb_atk').ok === false);
  const r5 = unsocketOrb(gear, 0);
  t('F6 卸下宝珠（评分回落）', r5.ok && gear.orbs[0] === null && gear.score === gear.baseScore + 2 * 45 * 10);
  // 全局宝珠加成（同类上限 3）
  const p2 = mkPlayer();
  const g1 = rollEquipment(rng, { floor: 1, forceRarity: 8, forceSlot: 'weapon' });
  const g2 = rollEquipment(rng, { floor: 1, forceRarity: 8, forceSlot: 'head' });
  const g3 = rollEquipment(rng, { floor: 1, forceRarity: 8, forceSlot: 'chest' });
  const g4 = rollEquipment(rng, { floor: 1, forceRarity: 8, forceSlot: 'legs' });
  p2.equipment.weapon = g1; p2.equipment.head = g2; p2.equipment.chest = g3; p2.equipment.legs = g4;
  sockOrb(p2, g1, 'orb_crit'); sockOrb(p2, g2, 'orb_crit'); sockOrb(p2, g3, 'orb_crit'); sockOrb(p2, g4, 'orb_crit');
  const bonus = calcOrbBonus(p2);
  t('F7 全局同类上限 3（4 颗只算 3 颗）', bonus.crit === 20 * 3, `crit=${bonus.crit}`);
  t('F8 单件宝珠加成', getGearOrbBonus(g1).crit === 20);
}

console.log('== G. 分解（末光 salvageGear 照抄） ==');
{
  const p = mkPlayer({ gold: 0, finaleEssence: 0 });
  const g1 = rollEquipment(rng, { floor: 1, forceRarity: 3 });
  p.inventory.push(g1);
  const r1 = salvageGear(p, g1.id);
  t('G1 金币 = (品质+1)×等级×8', r1 && r1.gold === (3 + 1) * 10 * 8, `gold=${r1 && r1.gold}`);
  const g2 = rollEquipment(rng, { floor: 1, forceRarity: 8 });
  p.inventory.push(g2);
  const r2 = salvageGear(p, g2.id);
  t('G2 终焉分解 +1 精华', r2 && r2.essence === 1 && p.finaleEssence === 1, `essence=${r2 && r2.essence}`);
}

console.log('== H. 掉落闭环（末光 lootItem 照抄） ==');
{
  const p = mkPlayer();
  const weak = rollEquipment(rng, { floor: 1, forceRarity: 1, forceSlot: 'weapon' });
  p.equipment.weapon = weak;
  const strong = rollEquipment(rng, { floor: 1, forceRarity: 6, forceSlot: 'weapon' });
  const r1 = lootGear(p, strong);
  t('H1 更强自动穿（旧装备回背包）', r1.action === 'equipped' && r1.replaced && p.equipment.weapon === strong && p.inventory.includes(weak));
  const r2 = lootGear(p, weak);
  t('H2 更弱入包', r2.action === 'bagged' && p.inventory.includes(weak));
  const p2 = mkPlayer();
  const pinned = rollEquipment(rng, { floor: 1, forceRarity: 5, forceSlot: 'chest' });
  pinned.pinned = true;
  p2.equipment.chest = pinned;
  const strong2 = rollEquipment(rng, { floor: 1, forceRarity: 8, forceSlot: 'chest' });
  const r3 = lootGear(p2, strong2);
  t('H3 pinned 守护：更强也不替换', r3.action === 'bagged' && p2.equipment.chest === pinned);
  const p3 = mkPlayer();
  const finale = rollEquipment(rng, { floor: 1, forceRarity: 8, forceSlot: 'ring' });
  const r4 = lootGear(p3, finale);
  t('H4 终焉掉落记录图鉴 + 自动锁定', r4.collection === true && p3.finaleCollection.ring === true && finale.locked === true);
  t('H5 图鉴集齐判定', finaleCollectionComplete(p3) === false && finaleCollectionComplete(mkPlayer({ finaleCollection: { weapon: true, head: true, chest: true, legs: true, feet: true, pendant: true, ring: true, trinket: true } })) === true);
  t('H6 recordFinaleCollection 幂等（重复收集 false）', recordFinaleCollection(p3, finale) === false);
}

console.log('== I. LootFilter（末光照抄：部位规则 > 全局 > 自动分解阈值） ==');
{
  LootFilter.resetRules();
  LootFilter.setAutoSalvageThreshold(-1);
  const g1 = rollEquipment(rng, { floor: 1, forceRarity: 1 });
  t('I1 默认全保留', LootFilter.shouldKeep(g1) === true);
  LootFilter.setAutoSalvageThreshold(1); // ≤精良自动分解
  t('I2 自动分解阈值（≤品质 1 拒绝）', LootFilter.shouldKeep(g1) === false);
  const g5 = rollEquipment(rng, { floor: 1, forceRarity: 5 });
  t('I3 高于阈值保留', LootFilter.shouldKeep(g5) === true);
  LootFilter.setAutoSalvageThreshold(-1);
  LootFilter.applyPreset('finale_only');
  t('I4 预设 finale_only：仅终焉', LootFilter.shouldKeep(g1) === false && LootFilter.shouldKeep(rollEquipment(rng, { floor: 1, forceRarity: 8 })) === true);
  LootFilter.applyPreset('high_crit_accessory');
  const ring = rollEquipment(rng, { floor: 1, forceRarity: 6, forceSlot: 'ring' });
  t('I5 预设 high_crit_accessory：首饰需 crit≥5', LootFilter.shouldKeep(ring) === (ring.stats.crit !== undefined && ring.stats.crit >= 5));
  LootFilter.applyPreset('mythic_above');
  t('I6 预设 mythic_above：仅神话+', LootFilter.shouldKeep(rollEquipment(rng, { floor: 1, forceRarity: 7 })) === true);
  LootFilter.resetRules();
  // 掉落闭环前置过滤 → 自动熔炼
  const p = mkPlayer({ gold: 0 });
  LootFilter.setAutoSalvageThreshold(3); // ≤卓越自动熔炼
  const junk = rollEquipment(rng, { floor: 1, forceRarity: 2 });
  const r = lootGear(p, junk);
  t('I7 过滤不通过 → 自动熔炼（+金币，不入包不穿戴）', r.action === 'salvaged' && p.gold > 0 && !p.inventory.includes(junk) && !p.equipment[junk.slot]);
  LootFilter.setAutoSalvageThreshold(-1);
}

console.log('== J. 穿戴/卸下（装备栏与背包分离） ==');
{
  const p = mkPlayer();
  const w = rollEquipment(rng, { floor: 1, forceRarity: 3, forceSlot: 'weapon' });
  p.inventory.push(w);
  t('J1 穿戴成功（背包→装备栏）', equipFromInventory(p, w.id) && p.equipment.weapon === w && !p.inventory.includes(w));
  t('J2 卸下（装备栏→背包）', unequip(p, 'weapon') && p.equipment.weapon === null && p.inventory.includes(w));
  const w2 = rollEquipment(rng, { floor: 1, forceRarity: 5, forceSlot: 'weapon' });
  p.inventory.push(w2);
  equipFromInventory(p, w2.id);
  t('J3 同槽替换：旧装备回背包', p.equipment.weapon === w2 && p.inventory.includes(w));
}

console.log(`\n========== test_equipment 结果：${pass} 通过 / ${fail} 失败 ==========`);
if (fail) process.exit(1);
