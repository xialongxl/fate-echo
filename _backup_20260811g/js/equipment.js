// ============================================================
// js/equipment.js — 装备系统 v3（Fate_echo，末光咏叹全量照抄）
// 蓝本：末光咏叹 engine.js（GearGenerator/LootFilter/宝珠/精炼/图鉴/强化/分解/掉落闭环）
//   与 data.js（GEAR_RARITY 含 color、SLOTS、SLOT_NAMES、SLOT_BASE_NAMES、
//   ORBS、MAX_SAME_ORB）——字段/公式/数值/规则逐项照抄，零简化
// Fate_echo 适配：floor = 全局层数（每张探索图 1 层，黑流树海一致：
//   (depth-1)×AREAS_PER_RUN + areaIndex + 1，调用方传入）；floorScale =
//   max(1, √floor×10) 品质强度成长；属性体系 atk/def(防御力)/haste/crit/versa
//   （def 接入战斗减伤公式，与末光一致）
// 红装保底（方案 3）：RED_* 常量 + rollDropChoices（3 件候选 3 选 1）+ 纯函数
//   redChancePctFor/redPityAfter（战斗胜利掉落专用；商店/抽卡保持原品质曲线）
// 装备对象结构（末光 gear 完整字段）：
//   { id, name, slot, rarityIdx, stats{atk,def,haste,crit,versa}, enhanceLv,
//     orbs: [orbId|null], locked, pinned, refineLevels{}, refineInitialValues{},
//     baseScore, score }
// ============================================================

// ---- 槽位（末光 SLOTS/SLOT_NAMES 照抄） ----
export const SLOTS = ['weapon', 'head', 'chest', 'legs', 'feet', 'pendant', 'ring', 'trinket'];
export const SLOT_NAMES = {
  weapon: '武器', head: '帽子', chest: '上衣', legs: '裤子', feet: '鞋子',
  pendant: '吊坠', ring: '戒指', trinket: '遗物',
};
export const GACHA_COST = 100; // 抽卡单抽价格（main.js/ui.js 单一数据源）

// ---- 品质九档（末光 GEAR_RARITY 照抄：名称/倍率/color 品质色类名） ----
export const GEAR_RARITY = [
  { name: '破损', mult: 0.5, color: 'q0' },
  { name: '普通', mult: 1.0, color: 'q1' },
  { name: '精良', mult: 1.5, color: 'q2' },
  { name: '卓越', mult: 2.2, color: 'q3' },
  { name: '史诗', mult: 3.5, color: 'q4' },
  { name: '传说', mult: 6.0, color: 'q5' },
  { name: '神话', mult: 10.0, color: 'q6' },
  { name: '圣物', mult: 15.0, color: 'q7' },
  { name: '终焉', mult: 22.0, color: 'q8' }, // ★ 红装（方案 3）
];

// ---- 红装保底曲线（《战利品拾取方式偏好.md》方案 3，2026-08-10 定案） ----
// 仅战斗胜利掉落应用（商店/抽卡/宝箱保持原品质曲线）：
//   基础 1%；每场未出红 +0.5%（pity 百分点，出红重置回 0）；
//   100 层后基础 1%→3%，未凑齐一套红（finaleCollectionComplete）额外 +2%；
//   "层" = 每张探索图 1 层（黑流树海一致），floorNum = (depth-1)×3+areaIndex+1
export const RED_BASE_PCT = 1;     // 基础红装概率（百分点）
export const RED_PITY_STEP = 0.5;  // 每场未出红 pity 步进（百分点）
export const RED_FLOOR_100 = 3;    // 100 层后基础概率
export const RED_NO_SET_BONUS = 2; // 100 层后未凑齐一套红额外加成

// 词缀池（末光 AFFIXES）
export const AFFIXES = ['haste', 'crit', 'versa'];

// 部位基础名池（末光 SLOT_BASE_NAMES 照抄）
export const SLOT_BASE_NAMES = {
  weapon: ['法杖', '魔杖', '咒刃', '魂弓', '法典', '灵刃', '权杖', '秘典'],
  head: ['法冠', '巫帽', '兜帽', '光环', '灵冠', '面具', '额饰'],
  chest: ['法袍', '轻甲', '长袍', '皮衣', '圣衫', '布衣', '符文衣'],
  legs: ['护腿', '法裤', '长裤', '胫甲', '腿铠'],
  feet: ['战靴', '法靴', '轻靴', '布靴', '灵鞋', '铁履'],
  pendant: ['挂坠', '护符', '圣徽', '颈饰', '魂链'],
  ring: ['魔戒', '指环', '印戒', '暗环', '秘戒'],
  trinket: ['魂匣', '宝珠', '秘符', '圣器', '核心'],
};

// ---- 宝珠（末光 ORBS/MAX_SAME_ORB 照抄） ----
export const ORBS = [
  { id: 'orb_hp', name: '生命宝珠', stat: 'hp_pct', val: 45, desc: '最大生命值+45%' },
  { id: 'orb_atk', name: '攻击宝珠', stat: 'atk_pct', val: 45, desc: '攻击力+45%' },
  { id: 'orb_versa', name: '共鸣宝珠', stat: 'versa', val: 30, desc: '共鸣+30%' },
  { id: 'orb_crit', name: '暴击宝珠', stat: 'crit', val: 20, desc: '暴击率+20%' },
  { id: 'orb_finale', name: '终焉回响', stat: 'finale_cd', val: 20, desc: '终焉回响（2026-08-11 彻底去 CD 后效果已移除）' },
];
export const MAX_SAME_ORB = 3;

// ---- 强化/精炼常量（末光照抄） ----
export const ENHANCE_MAX = 12;
export const REFINE_MAX = 15;
export const REFINE_COST = 3; // 每次精炼消耗终焉精华

const isWeapon = (slot) => slot === 'weapon';
const isArmor = (slot) => slot === 'head' || slot === 'chest' || slot === 'legs' || slot === 'feet';
const isAccessory = (slot) => slot === 'pendant' || slot === 'ring' || slot === 'trinket';
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

// ---- 品质判定（末光楼层浮动阈值表照抄） ----
// rVal = rand×100 - floor(floor/10)（楼层越高高品质越常见）；九档阈值
export function rollRarity(rng = Math.random, floor = 1) {
  let rVal = rng() * 100;
  const bonus = Math.floor(floor / 10);
  rVal = Math.max(0, rVal - bonus);
  if (rVal < 0.1) return 8;      // 终焉
  if (rVal < 0.5) return 7;      // 圣物
  if (rVal < 2) return 6;        // 神话
  if (rVal < 8) return 5;        // 传说
  if (rVal < 20) return 4;       // 史诗
  if (rVal < 45) return 3;       // 卓越
  if (rVal < 75) return 2;       // 精良
  if (rVal < 85) return 0;       // 破损
  return 1;                      // 普通（兜底）
}

// ---- 生成器（末光 GearGenerator.generate 照抄） ----
// floorScale = max(1, sqrt(floor)×10)；bg = floorScale × 品质倍率
// 主属性：武器 atk=bg×3.0 ｜ 防具 def=bg×2.0 ｜ 首饰 atk=def=bg×0.4
// 词缀：haste/crit/versa 按部位范围随机（保留小数）；单件上限保护
// orbSlots：终焉3 / 传说+2 / 精良+1 / 其他0；终焉自动 locked
export function rollEquipment(rng = Math.random, { floor = 1, depth = 1, forceRarity = null, forceSlot = null, minRarity = null } = {}) {
  // forceRarity 固定品质；minRarity 保底下限（Boss 史诗保底等；二者可共存，forceRarity 优先）
  let rIdx = forceRarity !== null ? forceRarity : rollRarity(rng, floor);
  if (minRarity !== null) rIdx = Math.max(rIdx, minRarity);
  const slot = forceSlot || SLOTS[Math.floor(rng() * SLOTS.length)];
  const baseName = pick(rng, SLOT_BASE_NAMES[slot]);
  const floorScale = Math.max(1, Math.sqrt(floor) * 10);
  const bg = floorScale * GEAR_RARITY[rIdx].mult;
  const orbSlots = rIdx === 8 ? 3 : rIdx >= 5 ? 2 : rIdx >= 2 ? 1 : 0;
  const gear = {
    id: 'g_' + Date.now() + Math.floor(rng() * 1000),
    name: `${GEAR_RARITY[rIdx].name} ${baseName}`,
    slot,
    rarityIdx: rIdx,
    stats: {},
    enhanceLv: 0,
    orbs: new Array(orbSlots).fill(null),
    locked: rIdx === 8,
    pinned: false,
    refineLevels: {},
    refineInitialValues: {},
  };
  // 主属性（末光公式）
  if (isWeapon(slot)) {
    gear.stats.atk = Math.max(1, Math.floor(bg * 3.0));
    gear.stats.def = 0;
  } else if (isArmor(slot)) {
    gear.stats.atk = 0;
    gear.stats.def = Math.max(1, Math.floor(bg * 2.0));
  } else {
    gear.stats.atk = Math.max(1, Math.floor(bg * 0.4));
    gear.stats.def = Math.max(1, Math.floor(bg * 0.4));
  }
  // 词缀（末光范围照抄）
  const accCheck = isAccessory(slot);
  const maxAff = accCheck
    ? Math.min(4, Math.max(1, rIdx - 1))
    : Math.min(2, Math.max(0, rIdx - 2));
  for (let i = 0; i < maxAff; i++) {
    const aff = AFFIXES[Math.floor(rng() * AFFIXES.length)];
    let v = 0;
    if (aff === 'crit') v = isWeapon(slot) ? rng() * 10 + 5 : accCheck ? rng() * 4 + 1 : rng() * 3 + 1;
    else if (aff === 'haste') v = accCheck ? rng() * 8 + 3 : rng() * 4 + 1;
    else v = accCheck ? rng() * 8 + 3 : rng() * 4 + 1;
    gear.stats[aff] = (gear.stats[aff] || 0) + v;
    gear.refineLevels[aff] = 0;
    // 单件上限保护（末光）
    if (aff === 'crit') gear.stats.crit = Math.min(isWeapon(slot) ? 50 : accCheck ? 15 : 12, gear.stats.crit);
    if (aff === 'haste') gear.stats.haste = Math.min(accCheck ? 30 : 15, gear.stats.haste);
    if (aff === 'versa') gear.stats.versa = Math.min(accCheck ? 40 : 15, gear.stats.versa);
  }
  // 评分（baseScore 与 score 双字段；score = baseScore + orbScore）
  gear.baseScore = gearBaseScore(gear);
  gear.score = gear.baseScore;
  return gear;
}

// ---- 评分（末光三套公式照抄） ----
// 武器 atk×10 + 副×0.5 ｜ 防具 def×10 + 副×0.5 ｜ 首饰 (atk+def)×5 + 副×1
export function gearBaseScore(gear) {
  const s = gear.stats || {};
  if (isWeapon(gear.slot)) {
    return Math.floor((s.atk || 0) * 10 + (s.haste || 0) * 0.5 + (s.crit || 0) * 0.5 + (s.versa || 0) * 0.5);
  }
  if (isAccessory(gear.slot)) {
    return Math.floor((s.atk || 0) * 5 + (s.def || 0) * 5 + (s.haste || 0) * 1 + (s.crit || 0) * 1 + (s.versa || 0) * 1);
  }
  return Math.floor((s.def || 0) * 10 + (s.haste || 0) * 0.5 + (s.crit || 0) * 0.5 + (s.versa || 0) * 0.5);
}

// 兼容旧引用（旧 gearScore 语义 → 当前总评分）
export function gearScore(gear) {
  return gear && gear.score != null ? gear.score : gearBaseScore(gear);
}

// ---- 宝珠评分与总评分（末光 calcOrbStatAndScore/recalcGearScore 照抄） ----
export function calcOrbStatAndScore(orb) {
  return { score: orb.val * 10 };
}
export function recalcGearScore(gear) {
  let orbScore = 0;
  if (gear.orbs) {
    for (const oid of gear.orbs) {
      if (oid) {
        const orb = ORBS.find((o) => o.id === oid);
        if (orb) orbScore += calcOrbStatAndScore(orb).score;
      }
    }
  }
  gear.score = (gear.baseScore || 0) + orbScore;
}

// ---- 宝珠镶嵌/卸下（末光：全局同类上限 MAX_SAME_ORB=3） ----
export function sockOrb(player, gear, orbId) {
  const orb = ORBS.find((o) => o.id === orbId);
  if (!orb) return { ok: false, reason: '未知宝珠' };
  if (!gear.orbs) return { ok: false, reason: '该装备没有宝珠槽' };
  const idx = gear.orbs.findIndex((o) => o === null);
  if (idx < 0) return { ok: false, reason: '宝珠槽已满' };
  if (countOrbAcross(player, orbId) >= MAX_SAME_ORB) return { ok: false, reason: `同类宝珠最多镶嵌 ${MAX_SAME_ORB} 个` };
  gear.orbs[idx] = orbId;
  recalcGearScore(gear);
  return { ok: true, idx };
}
export function unsocketOrb(gear, idx) {
  if (!gear.orbs || !gear.orbs[idx]) return { ok: false, reason: '该槽位没有宝珠' };
  gear.orbs[idx] = null;
  recalcGearScore(gear);
  return { ok: true };
}
function countOrbAcross(player, orbId) {
  let n = 0;
  for (const slot of SLOTS) {
    const g = player.equipment && player.equipment[slot];
    if (g && g.orbs) for (const o of g.orbs) if (o === orbId) n++;
  }
  return n;
}
// 单件装备宝珠属性汇总（末光 getGearOrbBonus）
export function getGearOrbBonus(gear) {
  const bonus = {};
  if (gear.orbs) {
    for (const oid of gear.orbs) {
      if (oid) {
        const orb = ORBS.find((o) => o.id === oid);
        if (orb) bonus[orb.stat] = (bonus[orb.stat] || 0) + orb.val;
      }
    }
  }
  return bonus;
}
// 全局宝珠加成（末光 calcOrbBonus：同类宝珠上限 3 个生效）
export function calcOrbBonus(player) {
  const orbBonus = { hp_pct: 0, atk_pct: 0, versa: 0, crit: 0, finale_cd: 0 };
  const counts = {};
  for (const slot of SLOTS) {
    const g = player.equipment && player.equipment[slot];
    if (g && g.orbs) for (const oid of g.orbs) { if (oid) counts[oid] = (counts[oid] || 0) + 1; }
  }
  for (const id in counts) {
    const orb = ORBS.find((o) => o.id === id);
    if (orb) {
      const active = Math.min(counts[id], MAX_SAME_ORB);
      orbBonus[orb.stat] = (orbBonus[orb.stat] || 0) + orb.val * active;
    }
  }
  return orbBonus;
}

// ---- 手动穿戴/卸下（装备栏与背包分离） ----
export function equipFromInventory(player, id) {
  const gear = player.inventory.find((g) => g.id === id);
  if (!gear) return false;
  const slot = gear.slot;
  const old = player.equipment[slot];
  player.equipment[slot] = gear;
  player.inventory = player.inventory.filter((g) => g.id !== id);
  if (old) player.inventory.push(old);
  return true;
}
export function unequip(player, slot) {
  const gear = player.equipment && player.equipment[slot];
  if (!gear) return false;
  player.equipment[slot] = null;
  player.inventory.push(gear);
  return true;
}

// ---- 分解（末光 salvageGear 照抄：金币=(品质+1)×等级×8，终焉额外+1 精华） ----
// 注：locked 装备的分解拦截由 UI 层（锁定按钮禁用）控制，与末光一致
export function salvageGear(player, id) {
  const idx = player.inventory.findIndex((g) => g.id === id);
  if (idx < 0) return null;
  const gear = player.inventory[idx];
  player.inventory.splice(idx, 1);
  const gold = (gear.rarityIdx + 1) * Math.max(1, player.level) * 8;
  player.gold += gold;
  let essence = 0;
  if (gear.rarityIdx === 8) {
    player.finaleEssence = (player.finaleEssence || 0) + 1;
    essence = 1;
  }
  return { gear, gold, essence };
}
// 直接分解（掉落闭环中 LootFilter 过滤不通过时调用；不检查 locked——过滤已判定）
function salvageDirect(player, gear) {
  const gold = (gear.rarityIdx + 1) * Math.max(1, player.level) * 8;
  player.gold += gold;
  if (gear.rarityIdx === 8) player.finaleEssence = (player.finaleEssence || 0) + 1;
  return gold;
}

// ---- 终焉图鉴（末光 finaleCollection 照抄：8 槽收集，集齐 HP/ATK+10%） ----
export function recordFinaleCollection(player, gear) {
  if (gear.rarityIdx !== 8) return false;
  if (!player.finaleCollection) player.finaleCollection = {};
  if (!player.finaleCollection[gear.slot]) {
    player.finaleCollection[gear.slot] = true;
    return true;
  }
  return false;
}
export function finaleCollectionComplete(player) {
  const c = player.finaleCollection || {};
  return SLOTS.every((slot) => c[slot] === true);
}

// ---- 强化（末光 enhanceGear 照抄：费用 300×1.8^lv、成功率 95-7lv 保底 30%、主属性递增乘数+固定加值、副属性 +0.5 受上限） ----
export function enhanceCost(gear, level) {
  return Math.floor((gear.rarityIdx + 1) * 300 * Math.pow(1.8, level));
}
export function enhanceRate(level) {
  return Math.max(30, 95 - level * 7) / 100; // 小数（30%~95%）
}
export function enhanceGear(player, id, rng = Math.random) {
  const gear = player.inventory.find((g) => g.id === id) || Object.values(player.equipment || {}).find((g) => g && g.id === id);
  if (!gear) return { ok: false, reason: '装备不存在' };
  if (gear.enhanceLv >= ENHANCE_MAX) return { ok: false, reason: '已达强化上限(+12)' };
  const cost = enhanceCost(gear, gear.enhanceLv);
  if (player.gold < cost) return { ok: false, reason: '金币不足' };
  const successRate = enhanceRate(gear.enhanceLv);
  const success = rng() * 100 < successRate * 100;
  player.gold -= cost;
  if (success) {
    gear.enhanceLv++;
    // 主属性：×(1.05 + 等级×0.03) + 固定加值（武器 atk+5 / 防具 def+5 / 首饰 atk+2 且 def+2）
    const powerMultiplier = 1.05 + gear.enhanceLv * 0.03;
    if (isWeapon(gear.slot)) {
      gear.stats.atk = Math.floor((gear.stats.atk || 0) * powerMultiplier) + 5;
    } else if (isAccessory(gear.slot)) {
      gear.stats.atk = Math.floor((gear.stats.atk || 0) * powerMultiplier) + 2;
      gear.stats.def = Math.floor((gear.stats.def || 0) * powerMultiplier) + 2;
    } else {
      gear.stats.def = Math.floor((gear.stats.def || 0) * powerMultiplier) + 5;
    }
    // 副属性各 +0.5（受单件上限保护）
    for (const aff of AFFIXES) {
      if (gear.stats[aff]) {
        gear.stats[aff] += 0.5;
        if (aff === 'crit') gear.stats.crit = Math.min(isWeapon(gear.slot) ? 50 : isAccessory(gear.slot) ? 15 : 12, gear.stats.crit);
        if (aff === 'haste') gear.stats.haste = Math.min(isAccessory(gear.slot) ? 30 : 15, gear.stats.haste);
        if (aff === 'versa') gear.stats.versa = Math.min(isAccessory(gear.slot) ? 40 : 15, gear.stats.versa);
      }
    }
    gear.baseScore = gearBaseScore(gear);
    recalcGearScore(gear);
  }
  return { ok: true, success, cost, successRate, level: gear.enhanceLv };
}

// ---- 精炼（末光 refineAffix 照抄：3 终焉精华/次、15 次权重曲线 15→1、cap 表、第 15 次补齐） ----
export function getAffixCap(slot, affix) {
  if (isWeapon(slot)) return 40;
  if (isAccessory(slot)) return affix === 'crit' ? 30 : 36;
  return 24;
}
export function getRefineWeight(currentRefineLv) {
  return REFINE_MAX - currentRefineLv; // 15 → 1
}
export function getRefineTotalWeight() {
  return 120;
}
export function getRefineIncrementDynamic(initialVal, cap, currentRefineLv) {
  if (initialVal >= cap || currentRefineLv >= REFINE_MAX) return 0;
  const totalGap = cap - initialVal;
  const weight = getRefineWeight(currentRefineLv);
  return totalGap * (weight / getRefineTotalWeight());
}
export function refineAffix(player, gear, affixKey) {
  if (!gear.refineLevels) gear.refineLevels = {};
  if (!gear.refineInitialValues) gear.refineInitialValues = {};
  if (gear.refineLevels[affixKey] === undefined) gear.refineLevels[affixKey] = 0;
  const currentLv = gear.refineLevels[affixKey];
  if (currentLv >= REFINE_MAX) return null;
  if ((player.finaleEssence || 0) < REFINE_COST) return null;
  const cap = getAffixCap(gear.slot, affixKey);
  const currentVal = gear.stats[affixKey] || 0;
  if (gear.refineInitialValues[affixKey] === undefined) gear.refineInitialValues[affixKey] = currentVal;
  const initialVal = gear.refineInitialValues[affixKey];
  if (initialVal >= cap) return null;
  if (currentLv + 1 >= REFINE_MAX) {
    // 第 15 次：直接补齐到上限（消除浮点误差）
    const neededToCap = cap - currentVal;
    if (neededToCap <= 0) return null;
    player.finaleEssence -= REFINE_COST;
    gear.stats[affixKey] = cap;
    gear.refineLevels[affixKey] = REFINE_MAX;
    gear.baseScore = gearBaseScore(gear);
    recalcGearScore(gear);
    return { increment: neededToCap, newLevel: REFINE_MAX };
  }
  const increment = getRefineIncrementDynamic(initialVal, cap, currentLv);
  const actualInc = Math.min(increment, Math.max(0, cap - currentVal));
  if (actualInc <= 0) return null;
  player.finaleEssence -= REFINE_COST;
  gear.stats[affixKey] = currentVal + actualInc;
  gear.refineLevels[affixKey] = currentLv + 1;
  gear.baseScore = gearBaseScore(gear);
  recalcGearScore(gear);
  return { increment: actualInc, newLevel: currentLv + 1 };
}

// ---- 拾取过滤（末光 LootFilter 照抄：部位规则 > 全局规则 > auto_salvage_threshold；3 预设） ----
export const LootFilter = {
  RULES_KEY: 'fate_echo:loot_filter_rules',
  THRESHOLD_KEY: 'fate_echo:auto_salvage_threshold',
  _defaultRule() {
    return { minRarity: -1, requiredAffixes: [], minAffixValues: {} };
  },
  loadRules() {
    try {
      const raw = globalThis.localStorage && localStorage.getItem(this.RULES_KEY);
      if (raw) {
        const rules = JSON.parse(raw);
        if (rules && typeof rules === 'object') return this._normalize(rules);
      }
    } catch { /* 损坏规则回默认 */ }
    return { global: this._defaultRule(), slots: {} };
  },
  _normalize(rules) {
    const def = this._defaultRule();
    const out = { global: { ...def }, slots: {} };
    const r = rules.global && typeof rules.global === 'object' ? rules.global : {};
    out.global.minRarity = Number.isFinite(r.minRarity) ? r.minRarity : def.minRarity;
    out.global.requiredAffixes = Array.isArray(r.requiredAffixes) ? r.requiredAffixes.filter((a) => typeof a === 'string').slice(0, 10) : [];
    out.global.minAffixValues = r.minAffixValues && typeof r.minAffixValues === 'object' ? r.minAffixValues : {};
    if (rules.slots && typeof rules.slots === 'object') {
      for (const slot of SLOTS) {
        const sr = rules.slots[slot];
        if (sr && typeof sr === 'object') {
          out.slots[slot] = {
            minRarity: Number.isFinite(sr.minRarity) ? sr.minRarity : -1,
            requiredAffixes: Array.isArray(sr.requiredAffixes) ? sr.requiredAffixes.filter((a) => typeof a === 'string').slice(0, 10) : [],
            minAffixValues: sr.minAffixValues && typeof sr.minAffixValues === 'object' ? sr.minAffixValues : {},
          };
        }
      }
    }
    return out;
  },
  saveRules(rules) {
    try { if (globalThis.localStorage) localStorage.setItem(this.RULES_KEY, JSON.stringify(rules)); } catch { /* 存储不可用忽略 */ }
  },
  resetRules() {
    this.saveRules({ global: this._defaultRule(), slots: {} });
  },
  applyPreset(presetId) {
    const rules = { global: this._defaultRule(), slots: {} };
    if (presetId === 'finale_only') {
      rules.global.minRarity = 8;
    } else if (presetId === 'high_crit_accessory') {
      rules.global.minRarity = 5;
      for (const slot of ['pendant', 'ring', 'trinket']) {
        rules.slots[slot] = { minRarity: 5, requiredAffixes: ['crit'], minAffixValues: { crit: 5 } };
      }
    } else if (presetId === 'mythic_above') {
      rules.global.minRarity = 6;
    }
    this.saveRules(rules);
    return rules;
  },
  getAutoSalvageThreshold() {
    try {
      const v = globalThis.localStorage && localStorage.getItem(this.THRESHOLD_KEY);
      const n = Number(v);
      return Number.isFinite(n) ? n : -1;
    } catch { return -1; }
  },
  setAutoSalvageThreshold(v) {
    try { if (globalThis.localStorage) localStorage.setItem(this.THRESHOLD_KEY, String(v)); } catch { /* 忽略 */ }
  },
  shouldKeep(gear) {
    const rules = this.loadRules();
    const rule = rules.slots[gear.slot] || rules.global;
    if (rule.minRarity === -1 && rule.requiredAffixes.length === 0 && Object.keys(rule.minAffixValues).length === 0) {
      const autoThreshold = this.getAutoSalvageThreshold();
      if (autoThreshold > -1 && gear.rarityIdx <= autoThreshold) return false;
      return true;
    }
    if (rule.minRarity > -1 && gear.rarityIdx < rule.minRarity) return false;
    for (const aff of rule.requiredAffixes) {
      if (!gear.stats[aff] || gear.stats[aff] <= 0) return false;
    }
    for (const aff in rule.minAffixValues) {
      if (!gear.stats[aff] || gear.stats[aff] < rule.minAffixValues[aff]) return false;
    }
    return true;
  },
};

// ---- 掉落闭环（末光 lootItem 照抄：过滤→自动穿（终焉锁定+图鉴）→否则入包） ----
// 返回 { action: 'equipped'|'bagged'|'salvaged', gear, replaced?, gold?, collection? }
export function lootGear(player, gear) {
  // 进阶拾取过滤：不通过 → 自动分解（金币/精华）
  if (!LootFilter.shouldKeep(gear)) {
    const gold = salvageDirect(player, gear);
    return { action: 'salvaged', gear, gold };
  }
  const current = player.equipment[gear.slot];
  if (!current || (gear.score > (current.score || 0) && !current.pinned)) {
    const old = player.equipment[gear.slot];
    player.equipment[gear.slot] = gear;
    if (gear.rarityIdx === 8) gear.locked = true; // 终焉自动锁定（防出售/分解）
    const collection = recordFinaleCollection(player, gear);
    if (old) player.inventory.push(old);
    return { action: 'equipped', gear, replaced: !!old, collection };
  }
  player.inventory.push(gear);
  if (gear.rarityIdx === 8) gear.locked = true;
  const collection = recordFinaleCollection(player, gear);
  return { action: 'bagged', gear, collection };
}

// ---- 掉落/抽卡入口（单一产出路径汇聚） ----
export function rollDrop(tier, rng = Math.random, opts = {}) {
  // 掉落概率：普通 30% / 精英 60% / Boss 100%；Boss 保底史诗(4)
  const chance = { normal: 0.3, elite: 0.6, boss: 1.0 }[tier] || 0.3;
  if (rng() >= chance) return null;
  return rollEquipment(rng, { ...opts, forceRarity: tier === 'boss' ? 4 : null });
}
export function rollGacha(rng = Math.random, opts = {}) {
  return rollEquipment(rng, opts); // 楼层浮动品质
}

// ---- 战斗掉落候选（方案 3：每场 3 件候选手动 3 选 1） ----
// 每件先按红装概率判定（redChancePct 百分点）：命中 → 终焉(8)；否则正常品质曲线
// （minRarity 保底下限）。count 可配（默认 3，杀戮尖塔式三选一）。
// 注意：调用方负责 pity 更新（候选含终焉 → 重置；否则 +RED_PITY_STEP）。
export function rollDropChoices(rng = Math.random, { count = 3, floor = 1, depth = 1, minRarity = null, redChancePct = 0 } = {}) {
  return Array.from({ length: Math.max(1, count) }, () => {
    if (redChancePct > 0 && rng() * 100 < redChancePct) return rollEquipment(rng, { floor, depth, forceRarity: 8 });
    return rollEquipment(rng, { floor, depth, minRarity });
  });
}

// 红装概率（方案 3 纯函数）：基础 1%；100 层后 3%（未凑齐一套红额外 +2%）；+ pity 累计。
// floorNum = 全局层数（每张探索图 1 层，(depth-1)×AREAS_PER_RUN+areaIndex+1）
export function redChancePctFor(player, floorNum) {
  const fn = Math.max(1, Math.floor(floorNum) || 1);
  let base = fn >= 100 ? RED_FLOOR_100 : RED_BASE_PCT;
  if (fn >= 100 && !finaleCollectionComplete(player)) base += RED_NO_SET_BONUS;
  return base + (player.redPity || 0);
}

// pity 更新（纯函数）：候选含终焉 → 重置 0；否则 +RED_PITY_STEP（百分点）
export function redPityAfter(choices, pity = 0) {
  return choices.some((g) => g.rarityIdx === 8) ? 0 : (pity || 0) + RED_PITY_STEP;
}

// ---- 装备属性汇总（玩家结算用；含宝珠加成由调用方叠加） ----
// 末光 recalcStats 对应：装备 stats 按槽位汇总（属性体系 atk/def/haste/crit/versa）
export function totalEquipmentStats(equipment = {}) {
  const sum = { atk: 0, def: 0, crit: 0, haste: 0, versa: 0 };
  for (const slot of SLOTS) {
    const gear = equipment[slot];
    if (!gear || !gear.stats) continue;
    for (const [k, v] of Object.entries(gear.stats)) {
      if (k in sum && Number.isFinite(v)) sum[k] += v;
    }
  }
  // 全局分部位汇总上限（末光 recalcStats 防崩）
  sum.crit = Math.min(50, sum.crit);
  sum.haste = Math.min(80, sum.haste);
  sum.versa = Math.min(150, sum.versa);
  return sum;
}
export function applyEquipmentToUnit(unit, equipment = {}) {
  const stats = totalEquipmentStats(equipment);
  unit.atk += stats.atk;
  unit.def += stats.def;
  unit.critChance = Math.min(1, unit.critChance + stats.crit / 100);
  if (stats.haste) unit.buffs.push({ key: 'eq:haste', stat: 'haste', val: stats.haste, turns: Infinity });
  if (stats.versa) unit.buffs.push({ key: 'eq:versa', stat: 'versa', val: stats.versa, turns: Infinity });
  return unit;
}

// ---- 数值显示（末光 formatNumber 对齐：千/百万缩写 + 最多 2 位小数） ----
export function formatNumber(n) {
  if (!Number.isFinite(n)) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e8) return (n / 1e8).toFixed(1) + '亿';
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (abs >= 1e4) return (n / 1e3).toFixed(1) + 'K';
  const r = Math.round(n * 100) / 100;
  return String(r);
}

// 装备价值（兼容旧引用：按评分）
export const equipmentValue = gearScore;

// 出售价（分解已取代出售；保留兼容引用）
export function sellPrice(gear) {
  return (gear.rarityIdx + 1) * 30;
}
