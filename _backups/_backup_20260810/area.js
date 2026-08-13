// ============================================================
// js/area.js — 平面节点网络探索区（Fate_echo Phase 4 v2，黑流树海蓝本）
// 参考《明日方舟》集成战略"黑流树海"（PRTS wiki 原文双重核查）：
//   - 平面图式地图：节点散布平面上、通路连成连通图，从初始节点沿通路
//     向四周探索（非线性；不是网格走格子）
//   - 迷雾：未观测节点仅显示大类色（凶戾紫=战斗 / 诡秘青=事件），
//     到达后揭示；可达节点一圈白光
//   - 节点 = 格点、路径 = 连通边；死路（叶子）走到头需原路返回
//   - 完成后普通节点变灰"林间空地"；出口节点出现即揭示
// 用户取舍：不要行动力/追猎战；保留迷雾
// 结构：
//   nodes: [{id, x, y, type, revealed, cleared}]（x/y 为虚拟格点坐标）
//   edges: [[idA, idB]]（无向通路）
//   startId（入口固定地图正中）/ currentId / exitIds（出口固定右缘）
// 每轮 = AREAS_PER_RUN 个区域（普通 → ... → Boss 区），
//   Boss 区出口 = Boss 战（exit_boss），通关 depth+1 新一轮
// 生成保证：连通图（start BFS 覆盖全部节点 + 出口可达）
// ============================================================

import { createEnemy, ENEMIES_DB } from './enemies.js';

export const GRID_W = 8;               // 虚拟网格宽（节点格点分布范围）
export const GRID_H = 5;               // 虚拟网格高
export const AREAS_PER_RUN = 3;        // 每轮区域数（最后一个为 Boss 区）
export const NODE_COUNT_MIN = 13;      // 每区节点数下限
export const NODE_COUNT_MAX = 16;      // 每区节点数上限

// 节点类型（黑流树海节点映射 + Fate_echo 特色"命运抽卡"）：
//   empty 林间空地（途经点）｜combat 作战 ⚔ ｜elite 紧急作战 💀
//   event 不期而遇 ❓ ｜rest 安全的角落 🏕 ｜shop 诡意行商 🏪
//   gacha 命运抽卡 🎰（特色节点）｜exit 险路尽头 🚪（安全出口）
//   exit_rare 险路小径 🌟（稀有出口）｜exit_boss 险路恶敌 👑（领袖战出口）
export const NODE_TYPES = ['combat', 'elite', 'event', 'rest', 'shop', 'gacha', 'empty', 'exit', 'exit_rare', 'exit_boss'];

export const NODE_ICONS = {
  combat: '⚔', elite: '💀', event: '❓', rest: '🏕', shop: '🏪', gacha: '🎰',
  exit: '🚪', exit_rare: '🌟', exit_boss: '👑', empty: '·',
};
export const NODE_NAMES = {
  combat: '作战', elite: '紧急作战', event: '不期而遇', rest: '安全的角落', shop: '诡意行商', gacha: '命运抽卡',
  exit: '险路尽头', exit_rare: '险路小径', exit_boss: '险路恶敌', empty: '林间空地',
};

// 点位类型权重（普通区；黑流树海节点类型简化对应 + 特色抽卡）
export const NODE_WEIGHTS = {
  combat: 30, elite: 12, event: 18, rest: 10, shop: 10, gacha: 5, empty: 15,
};

// 敌人等级缩放（同原 tower：平滑曲线，depth 每轮 +2）
export function enemyLevelFor(floor, depth) {
  return 1 + Math.floor((Math.max(1, floor) - 1) * 0.7) + (Math.max(1, depth) - 1) * 2;
}

export class Area {
  /**
   * @param {object} opts
   * @param {() => number} opts.rng  随机源（测试可注入）
   * @param {number} opts.depth  当前轮次（1 起）
   * @param {number} opts.areaIndex  当前区域索引（0 起；最后一个为 Boss 区）
   */
  constructor({ rng = Math.random, depth = 1, areaIndex = 0 } = {}) {
    this.rng = rng;
    this.depth = Math.max(1, depth);
    this.areaIndex = Math.max(0, areaIndex);
    this.isBossArea = this.areaIndex >= AREAS_PER_RUN - 1;
    this.nodes = [];       // [{id, x, y, type, revealed, cleared}]
    this.edges = [];       // [[idA, idB]] 无向
    this.startId = null;
    this.currentId = null;
    this.exitIds = [];     // 出口节点（普通层 1~2；Boss 层 1 个 exit_boss）
    this.generate();
  }

  // ---- 查询 ----
  nodeById(id) {
    return this.nodes.find((n) => n.id === id) || null;
  }

  // 有通路相连的节点（当前移动方式 = 相邻可达）
  neighbors(id = this.currentId) {
    return this.edges
      .filter(([a, b]) => a === id || b === id)
      .map(([a, b]) => this.nodeById(a === id ? b : a))
      .filter(Boolean);
  }

  current() {
    return this.nodeById(this.currentId);
  }

  // 死路（叶子：仅一条通路，走到头需原路返回）
  isDeadEnd(id = this.currentId) {
    return this.neighbors(id).length === 1;
  }

  atExit() {
    return this.exitIds.includes(this.currentId);
  }

  // ---- 移动 ----
  // 仅允许沿通路（边）移动一格；无行动力限制；
  // 已结算（cleared）节点可再次进入 —— 死路原路返回
  moveTo(id) {
    const target = this.nodeById(id);
    if (!target) return false;
    if (!this.edges.some(([a, b]) => (a === this.currentId && b === id) || (a === id && b === this.currentId))) return false;
    this.currentId = id;
    this.revealCurrent();
    return true;
  }

  // 到达即观测：揭示自身 + 相邻节点（黑流树海：未知节点到达后揭示）
  revealCurrent() {
    const c = this.current();
    if (!c) return;
    c.revealed = true;
    for (const n of this.neighbors(this.currentId)) n.revealed = true;
  }

  // 标记当前点位已结算（完成后变灰"林间空地"）
  clearCurrent() {
    const c = this.current();
    if (c) { c.revealed = true; c.cleared = true; }
  }

  // ---- 生成（随机节点网络 + 连通性保证） ----
  generate() {
    for (let attempt = 0; attempt < 30; attempt++) {
      this._generateOnce();
      if (this._validate()) return;
    }
    this._generateOnce(); // 兜底（重试耗尽仍保持最后一次结果）
  }

  _generateOnce() {
    this.nodes = [];
    this.edges = [];
    this.exitIds = [];
    const taken = new Set();
    const push = (x, y) => {
      const id = `n${this.nodes.length}`;
      taken.add(`${x},${y}`);
      this.nodes.push({ id, x, y, type: 'empty', revealed: false, cleared: false });
      return id;
    };
    // 1. 入口固定地图正中（黑流树海：从中央初始节点沿通路向四周探索）；
    //    出口固定右缘（普通层 1~2 个，Boss 层 1 个）
    const startX = Math.floor(GRID_W / 2);
    const startY = Math.floor(GRID_H / 2);
    this.startId = push(startX, startY);
    const exitCount = this.isBossArea ? 1 : (this.rng() < 0.3 ? 2 : 1);
    const usedY = new Set([startY]);
    for (let i = 0; i < exitCount; i++) {
      // 出口行采样（有限尝试 + 扫描兜底，防退化 rng 恒值时 do/while 死循环）
      let ey = Math.floor(this.rng() * GRID_H);
      for (let tries = 0; tries < 20 && usedY.has(ey); tries++) ey = Math.floor(this.rng() * GRID_H);
      if (usedY.has(ey)) {
        for (let y2 = 0; y2 < GRID_H; y2++) {
          if (!usedY.has(y2)) { ey = y2; break; }
        }
      }
      usedY.add(ey);
      const id = push(GRID_W - 1, ey);
      this.exitIds.push(id);
      this.nodeById(id).type = this.isBossArea ? 'exit_boss' : (i === 0 ? 'exit' : 'exit_rare');
    }
    // 2. 其余节点随机撒在中间列（不重复格点；随机失效时按扫描补位，防退化 rng 死循环）
    const nCount = NODE_COUNT_MIN + Math.floor(this.rng() * (NODE_COUNT_MAX - NODE_COUNT_MIN + 1));
    let guard = 0;
    while (this.nodes.length < nCount && guard++ < 500) {
      const x = 1 + Math.floor(this.rng() * (GRID_W - 2));
      const y = Math.floor(this.rng() * GRID_H);
      if (taken.has(`${x},${y}`)) continue;
      push(x, y);
    }
    for (let y = 0; y < GRID_H && this.nodes.length < nCount; y++) {
      for (let x = 1; x < GRID_W - 1 && this.nodes.length < nCount; x++) {
        if (!taken.has(`${x},${y}`)) push(x, y);
      }
    }
    // 3. 建边：八方向邻近格点按概率连接
    const conn = (a, b) => {
      if (!this.edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) this.edges.push([a, b]);
    };
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const a = this.nodes[i];
        const b = this.nodes[j];
        if (Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) === 1 && this.rng() < 0.65) conn(a.id, b.id);
      }
    }
    // 4. 连通性修复：BFS from start，未达节点连向最近可达节点（保证全连通 + 出口可达）
    const reach = this._reachableSet(this.startId);
    for (const n of this.nodes) {
      if (reach.has(n.id)) continue;
      let best = null;
      let bestD = Infinity;
      for (const r of reach) {
        const rn = this.nodeById(r);
        const d = Math.abs(n.x - rn.x) + Math.abs(n.y - rn.y);
        if (d < bestD) { bestD = d; best = r; }
      }
      if (best) { conn(best, n.id); reach.add(n.id); }
    }
    // 5. 类型分配（入口/出口保持；其余按权重）
    for (const n of this.nodes) {
      if (n.id === this.startId || this.exitIds.includes(n.id)) continue;
      n.type = this._rollType();
    }
    // 6. 初始迷雾：揭示入口及其相邻；出口节点出现即揭示（黑流树海）
    this.currentId = this.startId;
    this.nodeById(this.startId).revealed = true;
    for (const nb of this.neighbors(this.startId)) nb.revealed = true;
    for (const id of this.exitIds) this.nodeById(id).revealed = true;
  }

  // BFS 可达集合（沿 edges）
  _reachableSet(fromId) {
    const seen = new Set([fromId]);
    const queue = [fromId];
    while (queue.length) {
      const id = queue.shift();
      for (const n of this.neighbors(id)) {
        if (!seen.has(n.id)) { seen.add(n.id); queue.push(n.id); }
      }
    }
    return seen;
  }

  // 生成校验：全图连通 + 所有出口可达
  _validate() {
    if (!this.nodes.length || !this.exitIds.length) return false;
    const reach = this._reachableSet(this.startId);
    if (reach.size !== this.nodes.length) return false;
    return this.exitIds.every((id) => reach.has(id));
  }

  _rollType() {
    const roll = this.rng() * 100;
    let acc = 0;
    for (const [type, w] of Object.entries(NODE_WEIGHTS)) {
      acc += w;
      if (roll < acc) return type;
    }
    return 'empty';
  }

  // ---- 敌人 ----
  // 节点战斗敌人：exit_boss → Boss 战；elite → 紧急作战（精英/双敌）
  buildEncounters(node = this.current()) {
    const level = enemyLevelFor(this.areaIndex + 1, this.depth);
    if (node.type === 'exit_boss') {
      const bosses = ENEMIES_DB.filter((e) => e.tier === 'boss');
      return [createEnemy(bosses[Math.floor(this.rng() * bosses.length)].id || 'e11', level)];
    }
    const pool = ENEMIES_DB.filter((e) => e.tier !== 'boss');
    const normals = pool.filter((e) => e.tier === 'normal');
    const elites = pool.filter((e) => e.tier === 'elite');
    if (node.type === 'elite') {
      // 紧急作战：精英怪（后期 30% 双敌）
      const count = this.areaIndex >= 1 && this.rng() < 0.3 ? 2 : 1;
      const pick = () => (elites.length
        ? elites[Math.floor(this.rng() * elites.length)].id
        : normals[Math.floor(this.rng() * normals.length)].id);
      return Array.from({ length: count }, () => createEnemy(pick(), level));
    }
    // 普通区：前 2 区域单敌，第 3 区域起 20% 双敌；前 2 区域无精英
    const eliteWeight = this.areaIndex >= 1 ? 0.15 + (this.depth - 1) * 0.1 : 0;
    const count = this.areaIndex >= 1 && this.rng() < 0.2 ? 2 : 1;
    const pick = () => (elites.length && this.rng() < eliteWeight)
      ? elites[Math.floor(this.rng() * elites.length)].id
      : normals[Math.floor(this.rng() * normals.length)].id;
    return Array.from({ length: count }, () => createEnemy(pick(), level));
  }

  // ---- 序列化（存档 v3） ----
  toJSON() {
    return {
      depth: this.depth,
      areaIndex: this.areaIndex,
      nodes: this.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, type: n.type, revealed: n.revealed, cleared: n.cleared })),
      edges: this.edges.map(([a, b]) => [a, b]),
      startId: this.startId,
      currentId: this.currentId,
      exitIds: [...this.exitIds],
    };
  }

  // 从存档恢复（不重新生成；字段缺失回退默认）
  static fromJSON(json = {}) {
    const area = Object.create(Area.prototype);
    area.rng = Math.random;
    area.depth = Math.max(1, json.depth || 1);
    area.areaIndex = Math.max(0, json.areaIndex || 0);
    area.isBossArea = area.areaIndex >= AREAS_PER_RUN - 1;
    area.nodes = (Array.isArray(json.nodes) ? json.nodes : []).map((n) => ({
      id: n.id, x: n.x, y: n.y, type: n.type, revealed: !!n.revealed, cleared: !!n.cleared,
    }));
    area.edges = (Array.isArray(json.edges) ? json.edges : []).map(([a, b]) => [a, b]);
    area.startId = json.startId || null;
    area.currentId = json.currentId || area.startId;
    area.exitIds = Array.isArray(json.exitIds) ? [...json.exitIds] : [];
    return area;
  }
}
