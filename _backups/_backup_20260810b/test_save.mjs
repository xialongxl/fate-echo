// ============================================================
// tools/test_save.mjs — 存档系统测试 v2（Fate_echo Phase 4，永恒回想录蓝本）
// 验证：白名单/缺字段补默认/版本迁移/任意畸形输入不崩溃/
//   多槽位（saveToSlot/loadSlot/listSlots/removeSlot）/
//   防抖自动存档/JSON 导出导入/装备对象白名单
// 用法: node tools/test_save.mjs
// ============================================================

import {
  defaultGameState, sanitizeSave, SAVE_VERSION, MIGRATIONS, AUTO_SLOT, MANUAL_SLOTS,
  createSaveStore, saveToSlot, loadSlot, listSlots, removeSlot, createAutoSaver, exportJSON, importJSON,
  getSetting, setSetting, getStatistic, updateStatistic, exportAllJSON, importAllJSON, clearAllGameData,
} from '../js/save.js';
import { rollEquipment } from '../js/equipment.js';

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

const memBackend = () => {
  const map = new Map();
  const kv = { settings: new Map(), statistics: new Map() };
  return {
    async list() { return [...map.values()]; },
    async save(entry) { map.set(entry.id, entry); },
    async load(id) { return map.get(id) || null; },
    async remove(id) { map.delete(id); },
    async kvGet(table, id) { return kv[table] && kv[table].get(id); },
    async kvSet(table, id, value) { if (kv[table]) kv[table].set(id, value); },
    async clearAll() { map.clear(); kv.settings.clear(); kv.statistics.clear(); },
  };
};
const mkState = (o = {}) => {
  const st = defaultGameState();
  st.player.level = 3;
  st.player.gold = 120;
  st.tower.depth = 2;
  st.tower.floor = 5;
  return Object.assign(st, o);
};
// 确定性装备对象（供白名单测试）
const mkGear = (over = {}) => rollEquipment(() => 0.5, { floor: 1, forceRarity: 1 });

console.log('== A. 默认与白名单 ==');
{
  const def = defaultGameState();
  t('A1 默认存档：8 槽装备栏 + 空背包', Object.keys(def.player.equipment).length === 8 && Array.isArray(def.player.inventory));
  t('A2 null 输入 → 默认档', sanitizeSave(null).player.level === 1);
  t('A3 非对象输入 → 默认档', sanitizeSave('垃圾').player.level === 1);
  const s = sanitizeSave({ player: { level: 5, gold: 120, equipment: { weapon: mkGear(), chest: 'zzz', nope: mkGear() }, inventory: [mkGear(), null, 42] } });
  t('A4 合法装备保留 + 畸形置 null + 未知槽忽略', s.player.level === 5 && s.player.equipment.weapon !== null && s.player.equipment.chest === null && s.player.equipment.nope === undefined && s.player.inventory.length === 1);
  const g = mkGear();
  g.stats.atk = NaN;
  g.stats.haste = -5;
  const s2 = sanitizeSave({ player: { equipment: { weapon: g }, inventory: [g] } });
  t('A5 装备属性白名单（NaN/负值剔除）', s2.player.equipment.weapon.stats.atk === undefined && s2.player.equipment.weapon.stats.haste === undefined);
  const s3 = sanitizeSave({ player: { level: NaN, gold: Infinity, hp: 'abc' } });
  t('A6 畸形数值回退默认', s3.player.level === 1 && s3.player.gold === 0 && s3.player.hp === 100);
  const s4 = sanitizeSave({ player: { level: 99999 } });
  t('A7 超范围截断', s4.player.level === 999);
  const s5 = sanitizeSave({ player: { inventory: Array(500).fill(mkGear()) } });
  t('A8 背包上限 200 件', s5.player.inventory.length === 200);
}

console.log('== A2. 探索区图结构白名单（黑流树海节点网络） ==');
{
  const g = defaultGameState();
  g.area.nodes = [
    { id: 'n0', x: 0, y: 2, type: 'empty', revealed: true, cleared: false },
    { id: 'n1', x: 1, y: 2, type: 'combat', revealed: false, cleared: false },
    { id: 'bad', x: 'x', y: -3, type: 'hack', revealed: 'yes' },
    null,
    42,
  ];
  g.area.edges = [['n0', 'n1'], ['n0'], ['n9', 'n10'], null];
  g.area.startId = 'n0';
  g.area.currentId = 'n1';
  g.area.exitIds = ['n9', 'n1', 'n0', 'n7', 'n2'];
  const s = sanitizeSave(g);
  t('A2a 合法节点保留 + 畸形/未知类型丢弃', s.area.nodes.length === 2 && s.area.nodes[1].type === 'combat', `n=${s.area.nodes.length}`);
  t('A2b 边白名单（仅二元组，逐字段清洗）', s.area.edges.length === 2 && s.area.edges[0][0] === 'n0' && s.area.edges[0][1] === 'n1', JSON.stringify(s.area.edges));
  t('A2c startId/currentId/exitIds 保留（exitIds 上限 4）', s.area.startId === 'n0' && s.area.currentId === 'n1' && s.area.exitIds.length === 4 && s.area.exitIds[0] === 'n9');
  const s2 = sanitizeSave({ area: { depth: 2, areaIndex: 1 } });
  t('A2d 缺图字段补默认（空图，main.js 将重建新区）', s2.area.depth === 2 && s2.area.areaIndex === 1 && s2.area.nodes.length === 0);
  const s3 = sanitizeSave({ area: { nodes: Array(100).fill({ id: 'n', x: 1, y: 1, type: 'empty', revealed: false, cleared: false }) } });
  t('A2e 节点上限 64', s3.area.nodes.length === 64);
}

console.log('== B. 版本迁移 ==');
{
  t('B1 v3→v4 迁移存在（旧 tower 存档 → area 默认）', MIGRATIONS[2] && MIGRATIONS[3] && typeof MIGRATIONS[2] === 'function' && typeof MIGRATIONS[3] === 'function');
  const old = { version: 2, player: { level: 4 }, tower: { depth: 2, floor: 3 } };
  const migrated = sanitizeSave(old);
  t('B1b 旧档迁移：area 补默认且 depth 保留', migrated.area.depth === 2 && migrated.area.areaIndex === 0 && migrated.player.level === 4);
  // v3 → v4：旧装备 def→int、hp 丢弃
  const oldGear = { id: 'g1', name: '旧甲', slot: 'chest', rarityIdx: 3, stats: { atk: 5, def: 12, hp: 60, crit: 3 }, enhanceLv: 1, locked: false, pinned: false, score: 20 };
  const migrated4 = sanitizeSave({ version: 3, player: { level: 5, equipment: { chest: oldGear }, inventory: [oldGear] } });
  t('B1c v3→v4 迁移：def→int、hp 丢弃、新字段补默认', migrated4.player.equipment.chest.stats.int === 12 && migrated4.player.equipment.chest.stats.hp === undefined && migrated4.player.equipment.chest.stats.def === undefined && migrated4.player.equipment.chest.orbs.length === 0 && migrated4.player.finaleEssence === 0 && migrated4.player.finaleCollection.weapon === false);
  const s = sanitizeSave({ version: 99, player: { level: 3 } });
  t('B2 高版本存档：数据保留 + version clamp', s.version === SAVE_VERSION && s.player.level === 3);
  const s2 = sanitizeSave({ player: { level: 4 } });
  t('B3 缺 version 补默认', s2.version === SAVE_VERSION && s2.player.level === 4);
}

console.log('== C. 多槽位 round-trip（永恒回想录 saves 表模型） ==');
{
  const store = createSaveStore({ backend: memBackend() });
  const st1 = mkState();
  await saveToSlot(store, 'slot1', st1);
  const st2 = mkState();
  st2.player.level = 7;
  await saveToSlot(store, 'slot2', st2);
  await saveToSlot(store, AUTO_SLOT, mkState());
  const slots = await listSlots(store);
  t('C1 多槽位共存（3 个）', slots.length === 3, `n=${slots.length}`);
  t('C2 槽位元信息（id/name/timestamp/level/floor/depth）', slots.every((s) => s.id && s.name && s.timestamp && s.level && s.floor && s.depth));
  t('C3 列表按时间戳降序（最新在前）', slots[0].timestamp >= slots[1].timestamp && slots[1].timestamp >= slots[2].timestamp);
  const loaded = await loadSlot(store, 'slot2');
  t('C4 按槽位读取数据完整（含装备对象）', loaded.player.level === 7 && loaded.tower.floor === 5 && Array.isArray(loaded.player.inventory));
  t('C5 读取不存在槽位 → null', await loadSlot(store, 'nope') === null);
  await removeSlot(store, 'slot2');
  t('C6 删除槽位', (await listSlots(store)).length === 2 && (await loadSlot(store, 'slot2')) === null);
}

console.log('== D. 防抖自动存档 ==');
{
  const store = createSaveStore({ backend: memBackend() });
  const saver = createAutoSaver(store, { delay: 20 });
  const st = mkState();
  saver.markDirty(st);
  saver.markDirty(st); // 多次变更合并
  t('D1 防抖期内未落盘', (await listSlots(store)).length === 0);
  await new Promise((r) => setTimeout(r, 60));
  t('D2 防抖后自动落盘（auto 槽）', (await loadSlot(store, AUTO_SLOT)) !== null);
  const st2 = mkState();
  st2.player.level = 9;
  saver.markDirty(st2);
  await saver.flush(); // 立即落盘
  t('D3 flush 立即落盘（保存最新状态）', (await loadSlot(store, AUTO_SLOT)).player.level === 9);
  saver.markDirty(st);
  await saver.flush();
  t('D4 flush 清空脏标记（不重复写）', (await loadSlot(store, AUTO_SLOT)).player.level === 3);
}

console.log('== E. JSON 导出/导入（永恒回想录备份迁移） ==');
{
  const st = mkState();
  st.player.equipment.weapon = mkGear();
  const json = exportJSON(st);
  t('E1 导出含版本与导出时间', json.includes('"version":' + SAVE_VERSION) && json.includes('exportedAt'));
  const back = importJSON(json);
  t('E2 导入还原（含装备）', back.player.level === 3 && back.tower.floor === 5 && back.player.equipment.weapon !== null);
  t('E3 损坏 JSON → null', importJSON('{{{not json') === null);
  const bare = importJSON(JSON.stringify({ player: { level: 6 } }));
  t('E4 无 data 包裹的裸状态也可导入', bare.player.level === 6);
}

console.log('== F. 存储隔离 ==');
{
  const store = createSaveStore({ backend: memBackend() });
  await saveToSlot(store, 'slot1', mkState());
  // 存档多槽与 SmartAI 模型（storage.js 单 key）互不干扰——不同存储接口
  t('F1 手动槽常量（3 + auto）', MANUAL_SLOTS === 3 && AUTO_SLOT === 'auto');
  t('F2 存档版本号 v4（含 area/finaleEssence/finaleCollection）', SAVE_VERSION === 4 && defaultGameState().area !== undefined && defaultGameState().player.finaleEssence === 0);
}

console.log('== G. settings/statistics 表 + 全量导出导入 + 清除（永恒回想录照抄） ==');
{
  const store = createSaveStore({ backend: memBackend() });
  await setSetting(store, 'speed', 2);
  t('G1 settings 表读写', (await getSetting(store, 'speed', 1)) === 2 && (await getSetting(store, 'nope', 'def')) === 'def');
  const v = await updateStatistic(store, 'battles', 1);
  await updateStatistic(store, 'battles', 2);
  t('G2 statistics 表累加', (await getStatistic(store, 'battles', 0)) === 3 && v === 1);
  await setSetting(store, 'migrated', true);
  t('G3 settings 覆盖写', (await getSetting(store, 'migrated', false)) === true);
  // 全量导出（含 data）
  const st1 = mkState(); st1.player.level = 5;
  await saveToSlot(store, 'slot1', st1);
  await saveToSlot(store, 'slot2', mkState());
  const json = await exportAllJSON(store);
  t('G4 全量导出含全部槽位与数据', json !== null && JSON.parse(json).saves.length === 2 && JSON.parse(json).saves.every((s) => s.data && s.data.player));
  // 全量导入到新库
  const store2 = createSaveStore({ backend: memBackend() });
  const count = await importAllJSON(store2, json);
  t('G5 全量导入恢复槽位', count === 2 && (await loadSlot(store2, 'slot1')).player.level === 5);
  t('G6 损坏 JSON 导入 → null', (await importAllJSON(store2, '{{{bad')) === null);
  // 清除所有数据（三表）
  await clearAllGameData(store);
  t('G7 清除所有数据（saves/settings/statistics）', (await listSlots(store)).length === 0 && (await getSetting(store, 'speed', 1)) === 1 && (await getStatistic(store, 'battles', 0)) === 0);
  // try/catch：存储失败不抛异常（saveToSlot 内部捕获）
  const broken = { list: async () => { throw new Error('boom'); }, save: async () => { throw new Error('boom'); }, load: async () => { throw new Error('boom'); }, remove: async () => { throw new Error('boom'); }, kvGet: async () => { throw new Error('boom'); }, kvSet: async () => { throw new Error('boom'); }, clearAll: async () => { throw new Error('boom'); } };
  t('G8 存储异常优雅降级（save/load/list 不抛）', (await saveToSlot(broken, 'x', mkState())) === null && (await loadSlot(broken, 'x')) === null && (await listSlots(broken)).length === 0 && (await removeSlot(broken, 'x')) === false && (await getSetting(broken, 'k', 1)) === 1);
}

console.log(`\n========== test_save 结果：${pass} 通过 / ${fail} 失败 ==========`);
if (fail) process.exit(1);
