// ============================================================
// js/save.js — 游戏存档系统 v2（Fate_echo Phase 4，永恒回想录蓝本）
// 蓝本：永恒回想录（gacha-RPG）——
//   Dexie(IndexedDB) 多槽位 saves 表（id/name/timestamp/data）、
//   100ms 防抖自动存档 + saveNow 立即存、按时间戳加载最新、
//   旧档迁移钩子、JSON 导出/导入
// Fate_echo 实现：原生 IndexedDB 封装（零依赖，接口与注入 backend 同构
//   供 Node 测试）；多槽位（3 手动槽 + auto 自动槽）；sanitize 白名单 +
//   MIGRATIONS 版本迁移保留（缺字段补默认）；防抖自动存档
// 存档结构（v5）：
//   { version, player: {level, exp, gold, hp, mp, equipment: 8槽对象,
//     inventory: 装备对象数组, finaleEssence, finaleCollection: 8槽bool,
//     redPity（红装保底 0.5 精度）, battleSeed（战斗种子 防 SL）},
//     tower: {depth, floor}, area: 图结构探索区 }
// ============================================================

import { SLOTS, GEAR_RARITY } from './equipment.js';

export const SAVE_VERSION = 5;
export const MANUAL_SLOTS = 3;              // 手动存档槽数量
export const AUTO_SLOT = 'auto';            // 自动存档槽
export const MIGRATIONS = {};               // {1: (v1) => v2, ...}——未来版本升级管线

// ---- 默认存档（缺字段补默认） ----
export function defaultGameState() {
  return {
    version: SAVE_VERSION,
    player: {
      level: 1,
      exp: 0,
      gold: 0,
      hp: 100,
      mp: 100,
      equipment: { weapon: null, head: null, chest: null, legs: null, feet: null, pendant: null, ring: null, trinket: null },
      inventory: [], // 背包（未装备的装备对象数组）
      finaleEssence: 0, // 终焉精华（分解终焉获得；精炼消耗）
      finaleCollection: { weapon: false, head: false, chest: false, legs: false, feet: false, pendant: false, ring: false, trinket: false }, // 终焉图鉴
      redPity: 0, // 红装保底计数（百分点；每场未出红 +0.5，出红重置；方案 3）
      battleSeed: null, // 战斗掉落种子（种子防 SL：读档重战斗结果不变；胜利后清空）
    },
    tower: { depth: 1, floor: 1 },
    area: { depth: 1, areaIndex: 0, nodes: [], edges: [], startId: '', currentId: '', exitIds: [] }, // 平面节点网络探索区（黑流树海蓝本）
  };
}

// v2 → v3 迁移：旧 tower 存档补 area 默认（depth 保留）
MIGRATIONS[2] = (d) => ({ ...d, area: { depth: (d.tower && d.tower.depth) || 1, areaIndex: 0 } });

// v3 → v4 迁移：装备属性体系换血（末光咏叹照抄）——hp/def → int(防御力)、
//   补 orbs/baseScore/精炼字段默认、player 补 finaleEssence/finaleCollection
MIGRATIONS[3] = (d) => {
  const migrateGear = (g) => {
    if (!g || typeof g !== 'object') return g;
    const s = g.stats || {};
    const stats = {};
    for (const k of ['atk', 'int', 'crit', 'haste', 'versa']) {
      if (Number.isFinite(s[k]) && s[k] >= 0) stats[k] = s[k];
    }
    if (stats.int === undefined && Number.isFinite(s.def)) stats.int = s.def; // 旧 def → int（防御力）
    return { ...g, stats, orbs: Array.isArray(g.orbs) ? g.orbs : [], baseScore: g.baseScore, refineLevels: g.refineLevels || {}, refineInitialValues: g.refineInitialValues || {} };
  };
  const player = d.player && typeof d.player === 'object' ? { ...d.player } : {};
  if (player.equipment && typeof player.equipment === 'object') {
    const eq = {};
    for (const k of Object.keys(player.equipment)) eq[k] = migrateGear(player.equipment[k]);
    player.equipment = eq;
  }
  if (Array.isArray(player.inventory)) player.inventory = player.inventory.map(migrateGear);
  if (player.finaleEssence === undefined) player.finaleEssence = 0;
  if (!player.finaleCollection || typeof player.finaleCollection !== 'object') {
    player.finaleCollection = { weapon: false, head: false, chest: false, legs: false, feet: false, pendant: false, ring: false, trinket: false };
  }
  return { ...d, player };
};

// v4 → v5 迁移：红装保底（方案 3）补默认——redPity 保底计数、battleSeed 战斗种子
MIGRATIONS[4] = (d) => {
  const player = d.player && typeof d.player === 'object' ? { ...d.player } : {};
  if (!Number.isFinite(player.redPity)) player.redPity = 0;
  if (player.battleSeed === undefined) player.battleSeed = null;
  return { ...d, player };
};

const clampInt = (v, min, max, def) => {
  if (!Number.isFinite(v)) return def;
  return Math.min(max, Math.max(min, Math.round(v)));
};

// 装备对象白名单（逐字段校验；畸形/未知槽位 → null）
// v4（末光照抄）：属性 atk/int/haste/crit/versa + baseScore/orbs/精炼字段
function sanitizeGear(g) {
  if (!g || typeof g !== 'object' || !SLOTS.includes(g.slot)) return null;
  const stats = {};
  for (const k of ['atk', 'int', 'crit', 'haste', 'versa']) {
    if (Number.isFinite(g.stats && g.stats[k]) && g.stats[k] >= 0) stats[k] = Math.round(g.stats[k] * 100) / 100; // 词缀保留小数
  }
  return {
    id: typeof g.id === 'string' ? g.id.slice(0, 40) : 'eq_restored',
    name: typeof g.name === 'string' ? g.name.slice(0, 40) : '恢复 装备',
    slot: g.slot,
    rarityIdx: Number.isInteger(g.rarityIdx) && g.rarityIdx >= 0 && g.rarityIdx < GEAR_RARITY.length ? g.rarityIdx : 0,
    stats,
    enhanceLv: clampInt(g.enhanceLv, 0, 12, 0),
    locked: !!g.locked,
    pinned: !!g.pinned,
    score: Number.isFinite(g.score) ? Math.round(g.score) : 0,
    baseScore: Number.isFinite(g.baseScore) ? Math.round(g.baseScore) : 0,
    orbs: Array.isArray(g.orbs) ? g.orbs.slice(0, 3).map((o) => (typeof o === 'string' ? o : null)) : [],
    refineLevels: g.refineLevels && typeof g.refineLevels === 'object' ? g.refineLevels : {},
    refineInitialValues: g.refineInitialValues && typeof g.refineInitialValues === 'object' ? g.refineInitialValues : {},
  };
}

// 白名单清洗：任意输入 → 合法存档（畸形/缺字段一律回退默认，不崩溃）
export function sanitizeSave(raw) {
  const def = defaultGameState();
  if (!raw || typeof raw !== 'object') return def;
  // 版本迁移（逐版升级；未来 MIGRATIONS 增补）
  let data = { ...raw };
  const version = Number.isFinite(data.version) ? Math.round(data.version) : SAVE_VERSION;
  let v = Math.min(version, SAVE_VERSION);
  while (v < SAVE_VERSION) {
    const next = MIGRATIONS[v];
    if (!next) { v++; continue; } // 缺迁移函数：跳过（数据保持，靠 sanitize 兜底）
    data = next(data);
    v++;
  }
  // 玩家
  const p = data.player && typeof data.player === 'object' ? data.player : {};
  const player = {
    level: clampInt(p.level, 1, 999, def.player.level),
    exp: clampInt(p.exp, 0, 1e9, 0),
    gold: clampInt(p.gold, 0, 1e9, 0),
    hp: clampInt(p.hp, 1, 999999, def.player.hp),
    mp: clampInt(p.mp, 0, 999999, def.player.mp),
    equipment: { weapon: null, head: null, chest: null, legs: null, feet: null, pendant: null, ring: null, trinket: null },
    inventory: [],
    finaleEssence: clampInt(p.finaleEssence, 0, 99999, 0),
    finaleCollection: { weapon: false, head: false, chest: false, legs: false, feet: false, pendant: false, ring: false, trinket: false },
    redPity: Number.isFinite(p.redPity) ? Math.min(1000, Math.max(0, Math.round(p.redPity * 2) / 2)) : 0, // 红装保底（0.5 精度，防存档-读档四舍五入漂移）
    battleSeed: Number.isFinite(p.battleSeed) ? Math.round(p.battleSeed) : null, // 战斗种子（防 SL）
  };
  // 终焉图鉴（8 槽 bool；畸形字段回 false）
  const fc = p.finaleCollection && typeof p.finaleCollection === 'object' ? p.finaleCollection : {};
  for (const slot of SLOTS) player.finaleCollection[slot] = fc[slot] === true;
  // 装备栏白名单：8 槽装备对象（畸形 → null）
  const eq = p.equipment && typeof p.equipment === 'object' ? p.equipment : {};
  for (const slot of SLOTS) {
    player.equipment[slot] = sanitizeGear(eq[slot]);
  }
  // 背包白名单：装备对象数组，逐字段校验，上限 200 件
  player.inventory = Array.isArray(p.inventory)
    ? p.inventory.map(sanitizeGear).filter(Boolean).slice(0, 200)
    : [];
  // 塔
  const t = data.tower && typeof data.tower === 'object' ? data.tower : {};
  const tower = {
    depth: clampInt(t.depth, 1, 999, def.tower.depth),
    floor: clampInt(t.floor, 1, 999, def.tower.floor),
  };
  // 网状探索区白名单（图结构：节点/通路/出入口；畸形节点丢弃）
  const a = data.area && typeof data.area === 'object' ? data.area : {};
  const TYPES = ['combat', 'elite', 'event', 'rest', 'shop', 'gacha', 'empty', 'exit', 'exit_rare', 'exit_boss'];
  const area = {
    depth: clampInt(a.depth, 1, 999, 1),
    areaIndex: clampInt(a.areaIndex, 0, 99, 0),
    nodes: Array.isArray(a.nodes)
      ? a.nodes.slice(0, 64).map((n) => (n && typeof n === 'object' && TYPES.includes(n.type)
          ? { id: String(n.id).slice(0, 16) || 'n0', x: clampInt(n.x, 0, 31, 0), y: clampInt(n.y, 0, 31, 0), type: n.type, revealed: !!n.revealed, cleared: !!n.cleared }
          : null)).filter(Boolean)
      : [],
    edges: Array.isArray(a.edges)
      ? a.edges.slice(0, 200).map((e) => (Array.isArray(e) && e.length === 2
          ? [String(e[0]).slice(0, 16), String(e[1]).slice(0, 16)]
          : null)).filter(Boolean)
      : [],
    startId: typeof a.startId === 'string' ? a.startId.slice(0, 16) : '',
    currentId: typeof a.currentId === 'string' ? a.currentId.slice(0, 16) : '',
    exitIds: Array.isArray(a.exitIds) ? a.exitIds.slice(0, 4).map((id) => String(id).slice(0, 16)) : [],
  };
  return { version: SAVE_VERSION, player, tower, area };
}

// ============================================================
// 存储层（永恒回想录 3 表模型：saves/settings/statistics）
// 浏览器：原生 IndexedDB（DB 'fate_echo' v2：saves 多槽位 + settings + statistics）
// Node/测试：注入 backend（同构接口：list/save/load/remove + kvGet/kvSet + clearAll）
// ============================================================
export function createSaveStore({ backend = null } = {}) {
  if (backend) return backend; // 注入后端直接使用（测试/演示）
  if (typeof indexedDB !== 'undefined') return createIndexedDBStore();
  // Node 兜底：内存（跨进程持久化由调用方注入 fs backend）
  const mem = new Map();
  const kv = { settings: new Map(), statistics: new Map() };
  return {
    async list() { return [...mem.values()]; },
    async save(entry) { mem.set(entry.id, entry); },
    async load(id) { return mem.get(id) || null; },
    async remove(id) { mem.delete(id); },
    async kvGet(table, id) { return kv[table] && kv[table].get(id); },
    async kvSet(table, id, value) { if (kv[table]) kv[table].set(id, value); },
    async clearAll() { mem.clear(); kv.settings.clear(); kv.statistics.clear(); },
  };
}

// 原生 IndexedDB 封装（零依赖；Promise 化；DB v2：saves + settings + statistics 三表）
function createIndexedDBStore() {
  const DB_NAME = 'fate_echo';
  const DB_VERSION = 2;
  const STORE = 'saves';
  const SETTINGS = 'settings';
  const STATISTICS = 'statistics';
  const dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' });
      }
      if (!req.result.objectStoreNames.contains(SETTINGS)) {
        req.result.createObjectStore(SETTINGS, { keyPath: 'id' });
      }
      if (!req.result.objectStoreNames.contains(STATISTICS)) {
        req.result.createObjectStore(STATISTICS, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const tx = async (mode, table, fn) => {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
      const t = db.transaction(table, mode);
      const store = t.objectStore(table);
      const req = fn(store);
      t.oncomplete = () => resolve(req && req.result);
      t.onerror = () => reject(t.error);
    });
  };
  const getOne = (table, id) => tx('readonly', table, (s) => s.get(id));
  return {
    async list() {
      const db = await dbPromise;
      return new Promise((resolve, reject) => {
        const t = db.transaction(STORE, 'readonly');
        const req = t.objectStore(STORE).getAll();
        t.oncomplete = () => resolve(req.result || []);
        t.onerror = () => reject(t.error);
      });
    },
    async save(entry) { await tx('readwrite', STORE, (s) => s.put(entry)); },
    async load(id) { return (await getOne(STORE, id)) || null; },
    async remove(id) { await tx('readwrite', STORE, (s) => s.delete(id)); },
    async kvGet(table, id) { const v = await getOne(table, id); return v ? v.value : undefined; },
    async kvSet(table, id, value) { await tx('readwrite', table, (s) => s.put({ id, value })); },
    async clearAll() {
      const db = await dbPromise;
      await Promise.all([STORE, SETTINGS, STATISTICS].map((table) => new Promise((resolve, reject) => {
        const t = db.transaction(table, 'readwrite');
        t.objectStore(table).clear();
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      })));
    },
  };
}

// ============================================================
// 存档操作（多槽位 + 元信息；try/catch 错误捕获 + 优雅降级，永恒回想录照抄）
// ============================================================
// 槽位元信息：{id, name, timestamp, level, floor, depth}
function metaOf(id, state) {
  return {
    id,
    name: id === AUTO_SLOT ? '自动存档' : `存档 ${id}`,
    timestamp: Date.now(),
    level: state.player.level,
    floor: state.tower.floor,
    depth: state.tower.depth,
  };
}

export async function saveToSlot(store, id, state) {
  try {
    const clean = sanitizeSave(state);
    await store.save({ ...metaOf(id, clean), data: clean });
    return clean;
  } catch (err) {
    console.error('❌ 保存存档失败:', err);
    return null;
  }
}

export async function loadSlot(store, id) {
  try {
    const entry = await store.load(id);
    return entry && entry.data ? sanitizeSave(entry.data) : null;
  } catch (err) {
    console.error('❌ 读取存档失败:', err);
    return null;
  }
}

export async function listSlots(store) {
  try {
    return (await store.list()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)); // 最新在前
  } catch (err) {
    console.error('❌ 读取存档列表失败:', err);
    return [];
  }
}

export async function removeSlot(store, id) {
  try {
    await store.remove(id);
    return true;
  } catch (err) {
    console.error('❌ 删除存档失败:', err);
    return false;
  }
}

// ---- settings / statistics 表（永恒回想录照抄：设置与统计数据持久化） ----
export async function getSetting(store, key, def = null) {
  try { const v = await store.kvGet('settings', key); return v !== undefined ? v : def; } catch { return def; }
}
export async function setSetting(store, key, value) {
  try { await store.kvSet('settings', key, value); return true; } catch { return false; }
}
export async function getStatistic(store, key, def = 0) {
  try { const v = await store.kvGet('statistics', key); return Number.isFinite(v) ? v : def; } catch { return def; }
}
export async function updateStatistic(store, key, delta) {
  try {
    const cur = await getStatistic(store, key, 0);
    const next = Number.isFinite(delta) ? cur + delta : cur;
    await store.kvSet('statistics', key, next);
    return next;
  } catch { return null; }
}

// ---- 持久化存储申请与用量（永恒回想录 requestPersistentStorage 照抄） ----
export async function requestPersistentStorage() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return { supported: false, persisted: false };
    const persisted = await navigator.storage.persisted();
    if (persisted) return { supported: true, persisted: true };
    const granted = await navigator.storage.persist();
    return { supported: true, persisted: granted };
  } catch { return { supported: false, persisted: false }; }
}
export async function getStorageInfo() {
  try {
    if (!navigator.storage || !navigator.storage.estimate) return { supported: false };
    const est = await navigator.storage.estimate();
    return { supported: true, usage: est.usage || 0, quota: est.quota || 0, persisted: (await (navigator.storage.persisted ? navigator.storage.persisted() : Promise.resolve(false))) };
  } catch { return { supported: false }; }
}

// ---- 清除所有数据（永恒回想录 clearAllGameData 照抄：双重确认由 UI 层） ----
export async function clearAllGameData(store) {
  try {
    await store.clearAll();
    return true;
  } catch (err) {
    console.error('❌ 清除数据失败:', err);
    return false;
  }
}

// ---- 自动存档防抖（永恒回想录：100ms 防抖 + saveNow 立即存当前状态） ----
export function createAutoSaver(store, { delay = 100, slot = AUTO_SLOT } = {}) {
  let timer = null;
  let dirty = null;
  return {
    // 标记需要保存（防抖合并多次变更）
    markDirty(state) {
      dirty = state;
      if (timer) return;
      timer = setTimeout(async () => {
        timer = null;
        if (dirty) { const s = dirty; dirty = null; await saveToSlot(store, slot, s); }
      }, delay);
    },
    // 立即落盘（永恒 saveNow 语义：直接保存传入状态；不传则保存脏标记——
    //   战斗结束/层推进等重要节点必须传当前状态，防止 dirty 为空时丢失保存）
    async flush(state) {
      if (timer) { clearTimeout(timer); timer = null; }
      const s = state || dirty;
      if (s) { dirty = null; await saveToSlot(store, slot, s); }
    },
  };
}

// ---- JSON 导出/导入（永恒回想录：备份与迁移；含全量导出所有槽位） ----
export function exportJSON(state) {
  return JSON.stringify({ exportedAt: Date.now(), version: SAVE_VERSION, data: sanitizeSave(state) });
}
export function importJSON(json) {
  try {
    const parsed = JSON.parse(json);
    return parsed && parsed.data ? sanitizeSave(parsed.data) : sanitizeSave(parsed);
  } catch { return null; } // 损坏 JSON → null（调用方提示）
}

// 全量导出（所有槽位含 data；永恒回想录 exportAllSaves 照抄）
export async function exportAllJSON(store) {
  try {
    const entries = await store.list();
    return JSON.stringify({
      version: SAVE_VERSION,
      exportTime: Date.now(),
      saves: entries.map((s) => ({ id: s.id, name: s.name, timestamp: s.timestamp, data: sanitizeSave(s.data) })),
    });
  } catch { return null; }
}
// 全量导入（恢复所有槽位；返回恢复数量，失败/损坏返回 null）
export async function importAllJSON(store, json) {
  try {
    const parsed = JSON.parse(json);
    if (!parsed || !Array.isArray(parsed.saves)) return null;
    let count = 0;
    for (const s of parsed.saves) {
      if (s && s.id && s.data) {
        const ok = await saveToSlot(store, String(s.id).slice(0, 32), s.data);
        if (ok) count++;
      }
    }
    return count;
  } catch { return null; }
}
