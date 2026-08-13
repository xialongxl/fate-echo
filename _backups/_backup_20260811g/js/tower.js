// ============================================================
// js/tower.js — 树状塔（Fate_echo Phase 4）
// 用户定案：永恒回想录模式 × roguelike —— 树状图选择关卡
//   整棵树 = FLOORS_PER_RUN 层 × 每层 3 节点（战斗/事件/休息/商店/抽卡），
//   纵向路线图展示；玩家在每层选 1 个节点进入，逐层推进；
//   第 FLOORS_PER_RUN 层为 Boss 层（3 个 Boss 战斗节点）；
//   通关 Boss → depth+1 新一轮（敌人等级随深度提升，§4.3 难度曲线）
// 跨层保留 HP/MP（roguelike 资源管理）；休息/事件节点提供恢复
// 数值初稿 ⚠️ 待平衡
// ============================================================

import { createEnemy, ENEMIES_DB } from './enemies.js';

export const FLOORS_PER_RUN = 10;       // 9 普通层 + Boss 层
export const BRANCHES = 3;              // 每层可选节点数（树状分支）

// 节点类型权重（普通层）
export const NODE_WEIGHTS = {
  battle: 45,
  event: 25,
  shop: 15,
  rest: 10,
  gacha: 5,
};

export const NODE_NAMES = {
  battle: '⚔ 战斗',
  event: '❓ 事件',
  shop: '🏪 商店',
  rest: '🏕 休息',
  gacha: '🎰 抽卡',
};

// 敌人等级缩放（§4.3：基础等级 × 深度系数；初稿 ⚠️）
// 平滑曲线：1 层 → Lv1（玩家初始可战），每 2 层 +1，depth 每轮 +2
export function enemyLevelFor(floor, depth) {
  return 1 + Math.floor((Math.max(1, floor) - 1) * 0.7) + (Math.max(1, depth) - 1) * 2;
}

// 普通层敌人池：普通 + 精英（Boss 专属 Boss 层）
function poolFor(floor, depth) {
  const isBossFloor = floor >= FLOORS_PER_RUN;
  const pool = isBossFloor
    ? ENEMIES_DB.filter((e) => e.tier === 'boss')
    : ENEMIES_DB.filter((e) => e.tier !== 'boss');
  // 深度越高，精英比例越大（层数 >= 4 且 roll 加权）
  // 前 3 层无精英（新手期保护）；floor ≥ 4 起按深度加权
  const eliteWeight = isBossFloor || floor < 4 ? 0 : Math.min(0.6, 0.15 + (depth - 1) * 0.1 + 0.1);
  return { pool, eliteWeight };
}

export class Tower {
  /**
   * @param {object} opts
   * @param {() => number} opts.rng  随机源（测试可注入）
   * @param {number} opts.depth  当前轮次（1 起）
   * @param {number} opts.floor  当前层（1 起）
   */
  constructor({ rng = Math.random, depth = 1, floor = 1 } = {}) {
    this.rng = rng;
    this.depth = Math.max(1, depth);
    this.floor = Math.min(Math.max(1, floor), FLOORS_PER_RUN); // 指针定位到当前层
    this.tree = this._generateTree(); // 整棵树（10 层 × 3 节点）
  }

  // 生成整棵树：Boss 层固定 3 个 Boss 战斗节点
  _generateTree() {
    return Array.from({ length: FLOORS_PER_RUN }, (_, i) => {
      const isBoss = i + 1 >= FLOORS_PER_RUN;
      return Array.from({ length: BRANCHES }, () => (isBoss ? { type: 'battle', boss: true } : this._randomNode()));
    });
  }

  _randomNode() {
    const roll = this.rng() * 100;
    let acc = 0;
    for (const [type, w] of Object.entries(NODE_WEIGHTS)) {
      acc += w;
      if (roll < acc) return { type, boss: false };
    }
    return { type: 'battle', boss: false };
  }

  // 当前层节点（树状图当前行）
  floorNodes() {
    return this.tree[this.floor - 1] || [];
  }

  // 已通过的历史层（第 1 层到当前层-1）
  pastNodes() {
    return this.tree.slice(0, Math.max(0, this.floor - 1));
  }

  // 节点战斗敌人（按当前层/深度缩放；battle 节点 1-2 个，Boss 节点 1 个 Boss）
  buildEncounters(node) {
    const level = enemyLevelFor(this.floor, this.depth);
    if (node.boss) {
      return [createEnemy(this._pickEnemy(true), level)];
    }
    const { pool, eliteWeight } = poolFor(this.floor, this.depth);
    // 双敌：前 2 层强制单敌（玩家 Lv1 打不过双敌，平衡初稿 ⚠️），之后 20% 概率
    const count = this.floor > 2 && this.rng() < 0.2 ? 2 : 1;
    const picks = [];
    for (let i = 0; i < count; i++) {
      picks.push(createEnemy(this._pickEnemy(false, pool, eliteWeight), level));
    }
    return picks;
  }

  _pickEnemy(bossOnly, pool = [], eliteWeight = 0) {
    if (bossOnly) {
      const bosses = ENEMIES_DB.filter((e) => e.tier === 'boss');
      return bosses[Math.floor(this.rng() * bosses.length)].id || 'e11';
    }
    // 普通/精英分池：普通分支只从 normal 池选（避免 Lv1 层随机到精英秒杀新手）
    const normals = pool.filter((e) => e.tier === 'normal');
    const elites = pool.filter((e) => e.tier === 'elite');
    if (elites.length && this.rng() < eliteWeight) {
      return elites[Math.floor(this.rng() * elites.length)].id;
    }
    return normals.length ? normals[Math.floor(this.rng() * normals.length)].id : 'e01';
  }

  // 进入节点后推进到下一层；通关（Boss 层胜利）→ depth+1 回到第 1 层
  advance(clearedBoss = false) {
    if (clearedBoss) {
      this.depth++;
      this.floor = 1;
      this.tree = this._generateTree(); // 新一轮重新生成树
    } else {
      this.floor = Math.min(this.floor + 1, FLOORS_PER_RUN);
    }
    return { depth: this.depth, floor: this.floor };
  }

  // 序列化（存档）
  toJSON() {
    return { depth: this.depth, floor: this.floor };
  }
}
