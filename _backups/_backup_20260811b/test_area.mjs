// ============================================================
// tools/test_area.mjs — 平面节点网络探索区测试（Fate_echo Phase 4 v2，黑流树海蓝本）
// 验证：生成（节点网络/连通性/出口可达/死路/类型分布/迷雾）/
//   移动（沿通路/非相邻拒绝/原路返回/揭示）/Boss 区/深度缩放/序列化
// 确定性序列 rng（LCG；避免退化 rng 导致图畸形）
// 用法: node tools/test_area.mjs
// ============================================================

import {
  Area, GRID_W, GRID_H, AREAS_PER_RUN, NODE_TYPES, NODE_WEIGHTS, NODE_COUNT_MIN, NODE_COUNT_MAX, enemyLevelFor,
} from '../js/area.js';

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

// 确定性序列 rng（LCG）
let seed = 42;
const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const mkArea = (o = {}) => new Area({ rng, depth: 1, areaIndex: 0, ...o });

// BFS 可达集合
const reachable = (area, fromId) => {
  const seen = new Set([fromId]);
  const queue = [fromId];
  while (queue.length) {
    const id = queue.shift();
    for (const n of area.neighbors(id)) {
      if (!seen.has(n.id)) { seen.add(n.id); queue.push(n.id); }
    }
  }
  return seen;
};

console.log('== A. 区域生成（平面节点网络） ==');
{
  const area = mkArea();
  t('A1 节点数 13~16', area.nodes.length >= NODE_COUNT_MIN && area.nodes.length <= NODE_COUNT_MAX, `n=${area.nodes.length}`);
  t('A2 入口存在（地图正中）', area.startId && area.nodeById(area.startId).x === Math.floor(GRID_W / 2) && area.nodeById(area.startId).y === Math.floor(GRID_H / 2));
  t('A3 出口存在且位于右缘', area.exitIds.length >= 1 && area.exitIds.every((id) => area.nodeById(id).x === GRID_W - 1));
  t('A4 全图连通（start BFS 覆盖全部节点）', reachable(area, area.startId).size === area.nodes.length);
  t('A5 所有出口可达', area.exitIds.every((id) => reachable(area, area.startId).has(id)));
  t('A6 节点类型合法', area.nodes.every((n) => NODE_TYPES.includes(n.type) || n.type === 'start'));
  const deadEnds = area.nodes.filter((n) => area.neighbors(n.id).length === 1);
  t('A7 死路存在（叶子，走到头需原路返回）', deadEnds.length >= 1, `deadEnds=${deadEnds.length}`);
  // 迷雾：初始仅揭示 入口 + 相邻 + 出口（黑流树海：未知节点隐藏细节）
  const revealed = area.nodes.filter((n) => n.revealed).map((n) => n.id);
  const expected = new Set([area.startId, ...area.neighbors(area.startId).map((n) => n.id), ...area.exitIds]);
  t('A8 初始迷雾：仅揭示入口/相邻/出口', revealed.length === expected.size && revealed.every((id) => expected.has(id)), `revealed=${revealed.length} expected=${expected.size}`);
  t('A9 存在未揭示节点（迷雾生效）', area.nodes.some((n) => !n.revealed));
  t('A10 出口始终揭示', area.exitIds.every((id) => area.nodeById(id).revealed));
  const boss = mkArea({ areaIndex: AREAS_PER_RUN - 1 });
  t('A11 Boss 区：单个 exit_boss 出口', boss.isBossArea && boss.exitIds.length === 1 && boss.nodeById(boss.exitIds[0]).type === 'exit_boss');
  let sawTwo = false;
  for (let i = 0; i < 25; i++) { if (mkArea().exitIds.length === 2) { sawTwo = true; break; } }
  t('A12 普通层可出现双出口（险路小径稀有出口）', sawTwo);
  // 类型分布：多次生成应覆盖战斗/事件/休息/商店（权重驱动）
  const types = new Set();
  for (let i = 0; i < 20; i++) for (const n of mkArea().nodes) types.add(n.type);
  t('A13 类型分布覆盖（作战/紧急/事件/休息/商店/抽卡）', ['combat', 'elite', 'event', 'rest', 'shop', 'gacha'].every((k) => types.has(k)), [...types].join());
}

console.log('== B. 移动（沿通路/迷雾揭示/原路返回） ==');
{
  const area = mkArea();
  const start = area.startId;
  const nb = area.neighbors(start)[0];
  t('B1 相邻节点可移动', !!nb && area.moveTo(nb.id) && area.currentId === nb.id);
  const nbNode = area.nodeById(nb.id);
  t('B2 到达即揭示自身', nbNode.revealed === true);
  t('B3 到达后揭示相邻节点', area.neighbors(nb.id).every((n) => n.revealed));
  // 非相邻拒绝
  const far = area.nodes.find((n) => n.id !== area.currentId && !area.neighbors(area.currentId).some((x) => x.id === n.id));
  t('B4 非相邻节点移动失败', !!far && !area.moveTo(far.id));
  t('B5 移动失败位置不变', area.currentId === nb.id);
  t('B6 移动到不存在的节点失败', !area.moveTo('nope'));
  // 死路检测
  const dead = area.nodes.find((n) => area.neighbors(n.id).length === 1);
  t('B7 isDeadEnd 判定（叶子）', !!dead && area.isDeadEnd(dead.id));
  t('B8 isDeadEnd 非叶子为 false', area.neighbors(area.currentId).length > 1 && !area.isDeadEnd(area.currentId));
  // 原路返回：已结算节点可再进入
  area.clearCurrent();
  t('B9 已结算节点可原路返回', area.moveTo(start) && area.currentId === start);
  // 出口
  let reachedExit = false;
  for (const id of area.exitIds) {
    // 从 start 沿图走到出口（BFS 路径简化：直接相邻则一步，否则走 neighbors 链）
    const path = bfsPath(area, start, id);
    if (path.length >= 2) {
      for (let i = 1; i < path.length; i++) {
        if (!area.moveTo(path[i])) break;
      }
      if (area.currentId === id) { reachedExit = true; break; }
    }
  }
  t('B10 可沿通路走到出口（atExit）', reachedExit && area.atExit());
}

// BFS 最短路径（节点 id 数组）
function bfsPath(area, fromId, toId) {
  const prev = new Map([[fromId, null]]);
  const queue = [fromId];
  while (queue.length) {
    const id = queue.shift();
    if (id === toId) {
      const path = [];
      let cur = id;
      while (cur !== null) { path.unshift(cur); cur = prev.get(cur); }
      return path;
    }
    for (const n of area.neighbors(id)) {
      if (!prev.has(n.id)) { prev.set(n.id, id); queue.push(n.id); }
    }
  }
  return [];
}

console.log('== C. 敌人与深度 ==');
{
  const area = mkArea();
  const combat = area.buildEncounters({ type: 'combat' });
  t('C1 作战敌人非 boss', combat.every((e) => e.meta.tier !== 'boss'));
  t('C2 作战敌人等级按深度缩放', combat.every((e) => e.unit.level === enemyLevelFor(1, 1)));
  const elite = area.buildEncounters({ type: 'elite' });
  t('C3 紧急作战为精英', elite.every((e) => e.meta.tier === 'elite'), `tier=${elite.map((e) => e.meta.tier).join()}`);
  const bossArea = mkArea({ areaIndex: AREAS_PER_RUN - 1 });
  const bossEnc = bossArea.buildEncounters({ type: 'exit_boss' });
  t('C4 险路恶敌（出口）为 Boss', bossEnc.length === 1 && bossEnc[0].meta.tier === 'boss');
  const deep = mkArea({ depth: 2, areaIndex: 2 });
  t('C5 等级公式：第1区/depth1=1；第3区/depth3=6', enemyLevelFor(1, 1) === 1 && enemyLevelFor(3, 3) === 6);
  t('C6 深区敌人等级更高', deep.buildEncounters({ type: 'combat' }).every((e) => e.unit.level === enemyLevelFor(3, 2)));
}

console.log('== D. 序列化 ==');
{
  const area = mkArea();
  area.moveTo(area.neighbors(area.startId)[0].id);
  const json = area.toJSON();
  t('D1 序列化字段完整（图结构）', json.depth === 1 && json.areaIndex === 0 && json.nodes.length === area.nodes.length && json.edges.length === area.edges.length && json.currentId === area.currentId && json.exitIds.length === area.exitIds.length);
  const restored = Area.fromJSON(json);
  t('D2 恢复：节点/边/位置/出口一致', restored.nodes.length === area.nodes.length && restored.edges.length === area.edges.length && restored.currentId === area.currentId && restored.exitIds.join() === area.exitIds.join());
  t('D3 恢复后移动可用', restored.moveTo(area.neighbors(area.currentId)[0].id) && restored.currentId !== area.currentId);
  t('D4 恢复后迷雾状态保留', restored.nodes.filter((n) => n.revealed).length === area.nodes.filter((n) => n.revealed).length);
  t('D5 空档回退默认', Area.fromJSON({}).nodes.length === 0 && Area.fromJSON({}).startId === null);
}

console.log(`\n========== test_area 结果：${pass} 通过 / ${fail} 失败 ==========`);
if (fail) process.exit(1);
