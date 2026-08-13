// ============================================================
// tools/test_tower.mjs — 树状塔测试（Fate_echo Phase 4）
// 验证：节点生成/类型权重/Boss 层/推进/通关循环/敌人等级缩放/事件
// 确定性 rng：固定序列
// 用法: node tools/test_tower.mjs
// ============================================================

import { Tower, FLOORS_PER_RUN, BRANCHES, NODE_WEIGHTS, NODE_NAMES, enemyLevelFor } from '../js/tower.js';
import { rollEvent, resolveEvent, EVENT_TYPES } from '../js/events.js';

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

// 固定 rng：0.1 → battle(45)；0.5 → event(70)；0.75 → shop(85)；0.9 → rest(95)；0.97 → gacha
const nodeRng = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };

console.log('== A. 树状节点生成 ==');
{
  const tower = new Tower({ rng: nodeRng([0.1, 0.5, 0.75]) });
  t('A1 整树 10 层 × 3 节点', tower.tree.length === FLOORS_PER_RUN && tower.tree.every((r) => r.length === BRANCHES));
  t('A2 类型按权重（0.1→battle/0.5→event/0.75→shop）', tower.floorNodes().map((n) => n.type).join() === 'battle,event,shop', tower.floorNodes().map((n) => n.type).join());
  const all = [];
  const seq = (() => { let s2 = 7; return () => ((s2 = (s2 * 31 + 7) % 100) / 100); })(); // LCG 覆盖全 [0,1)
  for (let i = 0; i < 30; i++) {
    const t2 = new Tower({ rng: seq });
    all.push(...t2.tree.flat().map((x) => x.type));
  }
  const count = (type) => all.filter((x) => x === type).length;
  t('A3 类型分布与权重一致（battle 最多/gacha 最少）', count('battle') > count('event') && count('event') > count('gacha'), `battle=${count('battle')} gacha=${count('gacha')}`);
  t('A4 节点类型全集合法', all.every((x) => NODE_WEIGHTS[x] !== undefined));
  t('A5 节点名表完整', Object.keys(NODE_NAMES).length === Object.keys(NODE_WEIGHTS).length);
  t('A6 floorNodes 定位当前层', tower.floor === 1 && tower.floorNodes() === tower.tree[0]);
}

console.log('== B. Boss 层 ==');
{
  const tower = new Tower({ rng: nodeRng([0.1, 0.5, 0.75]), floor: FLOORS_PER_RUN });
  t('B1 Boss 层 3 节点全部为战斗', tower.floorNodes().every((n) => n.type === 'battle'), tower.floorNodes().map((n) => n.type).join());
  const enc = tower.buildEncounters(tower.floorNodes()[0]);
  t('B2 Boss 层敌人为 Boss tier', enc.length === 1 && enc[0].meta.tier === 'boss', `${enc[0] && enc[0].meta.tier}`);
}

console.log('== C. 敌人与等级缩放 ==');
{
  const tower = new Tower({ rng: nodeRng([0.5]), depth: 2, floor: 3 });
  const enc = tower.buildEncounters({ type: 'battle', boss: false });
  t('C1 普通层敌人 tier 非 boss', enc.every((e) => e.meta.tier !== 'boss'));
  t('C2 敌人等级按层/深度缩放（§4.3）', enc.every((e) => e.unit.level === enemyLevelFor(3, 2)), `lv=${enc.map((e) => e.unit.level).join()}`);
  t('C3 等级公式：floor1/depth1 = 1（玩家初始可战）；floor10/depth3 = 11', enemyLevelFor(1, 1) === 1 && enemyLevelFor(10, 3) === 11, `${enemyLevelFor(1,1)}/${enemyLevelFor(10,3)}`);
  // 双敌概率：rng 0.1 → 20% 触发（前 2 层强制单敌——玩家 Lv1 平衡）
  // 注意：树生成消费 27 次 rng（Boss 层不生成），buildEncounters 第 28 次调用须 < 0.2
  const t2 = new Tower({ rng: nodeRng([0.1]), floor: 3 });
  const enc2 = t2.buildEncounters({ type: 'battle', boss: false });
  t('C4 双敌节点（floor≥3，20% 概率，rng 0.1 触发）', enc2.length === 2, `n=${enc2.length}`);
  const t3 = new Tower({ rng: nodeRng([0.1, 0.5]), floor: 1 });
  const enc3 = t3.buildEncounters({ type: 'battle', boss: false });
  t('C5 前 2 层强制单敌（Lv1 玩家平衡）', enc3.length === 1, `n=${enc3.length}`);
}

console.log('== D. 推进与通关 ==');
{
  const tower = new Tower({ rng: nodeRng([0.1]), depth: 1, floor: 1 });
  tower.advance();
  t('D1 普通推进：floor+1', tower.floor === 2 && tower.depth === 1);
  const t2 = new Tower({ rng: nodeRng([0.1]), depth: 1, floor: FLOORS_PER_RUN });
  t2.advance(true);
  t('D2 通关 Boss：depth+1 回第 1 层', t2.depth === 2 && t2.floor === 1);
  const t3 = new Tower({ rng: nodeRng([0.1]), depth: 1, floor: FLOORS_PER_RUN });
  t3.advance(false);
  t('D3 未通关推进：Boss 层停留（clamp）', t3.floor === FLOORS_PER_RUN);
  t('D4 序列化结构', JSON.stringify(tower.toJSON()) === '{"depth":1,"floor":2}');
}

console.log('== E. 随机事件 ==');
{
  const kinds = new Set();
  for (let i = 0; i < 50; i++) kinds.add(rollEvent(() => (i * 0.6180339887) % 1).type); // 黄金分割序列全覆盖
  t('E1 事件类型全集可达', EVENT_TYPES.every((x) => kinds.has(x)), [...kinds].join(','));
  const state = { player: { hp: 50, gold: 10, inventory: [] } };
  const ev = rollEvent(() => 0.1);
  const lines = resolveEvent(state, ev.type, 'leave', { rng: () => 0.5, maxHp: 100 });
  t('E2 离开选项无副作用', lines.length === 1 && state.player.hp === 50 && state.player.gold === 10);
  // 篝火：恢复 40%
  const s2 = { player: { hp: 30, gold: 0, inventory: [] } };
  const lines2 = resolveEvent(s2, 'campfire', 'rest', { rng: () => 0.5, maxHp: 100 });
  t('E3 篝火休息恢复 40%（30 → 70）', s2.player.hp === 70, `hp=${s2.player.hp}`);
  // 宝箱：rng 0.3 < 0.5 → 装备
  const s3 = { player: { hp: 100, gold: 0, inventory: [] } };
  resolveEvent(s3, 'chest', 'open', { rng: () => 0.3, maxHp: 100 });
  t('E4 宝箱开出装备入背包', s3.player.inventory.length === 1);
  // 宝箱：rng 0.8 → 金币
  const s4 = { player: { hp: 100, gold: 0, inventory: [] } };
  resolveEvent(s4, 'chest', 'open', { rng: () => 0.8, maxHp: 100 });
  t('E5 宝箱开出金币', s4.player.gold > 0 && s4.player.inventory.length === 0);
  // 陷阱：rng 0.1 < 0.2 → 受伤
  const s5 = { player: { hp: 100, gold: 0, inventory: [] } };
  resolveEvent(s5, 'trap', 'careful', { rng: () => 0.1, maxHp: 100 });
  t('E6 陷阱小心通过仍可能受伤（10%）', s5.player.hp === 90);
  // 雕像：rng 0.5 → 金币
  const s6 = { player: { hp: 100, gold: 0, inventory: [] } };
  resolveEvent(s6, 'statue', 'pray', { rng: () => 0.5, maxHp: 100 });
  t('E7 雕像祈祷出金币（40-100）', s6.player.gold >= 40 && s6.player.gold <= 100);
  // 雕像：rng 0.9 → 受伤 15%
  const s7 = { player: { hp: 100, gold: 0, inventory: [] } };
  resolveEvent(s7, 'statue', 'pray', { rng: () => 0.9, maxHp: 100 });
  t('E8 雕像诅咒受伤 15%', s7.player.hp === 85);
}

console.log(`\n========== test_tower 结果：${pass} 通过 / ${fail} 失败 ==========`);
if (fail) process.exit(1);
