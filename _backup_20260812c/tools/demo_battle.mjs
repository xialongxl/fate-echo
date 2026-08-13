// ============================================================
// tools/demo_battle.mjs — 命令行完整战斗演示（Fate_echo Phase 3）
// 验收：可命令行跑完整战斗；玩家自动循环（js/autoloop.js，与浏览器
//   Tab 自动模式同一模块）驱动 + 启发式敌人 AI
// 场景：1v2（丛林之狼 + 史莱姆）。种子随机源（可复现）。
// 用法: node tools/demo_battle.mjs
// ============================================================

import { CombatEngine } from '../js/engine.js';
import { makePlayer, starterSkillData } from '../js/setup.js';
import { createEnemy } from '../js/enemies.js';
import { autoLoopTurn } from '../js/autoloop.js';

// 种子 LCG（确定性暴击/扰动）
let seed = 42;
const rng = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

const player = makePlayer();
const enemies = [createEnemy('e02', 1), createEnemy('e01', 1)]; // 丛林之狼 + 史莱姆
const engine = new CombatEngine({
  player: { unit: player, skills: starterSkillData() },
  enemies,
  rng,
});

engine.startTurn();

console.log('══════════ 命运回响 · 命令行战斗演示 ══════════');
console.log(`你（Lv1 旅人）  VS  ${enemies.map((e) => `${e.unit.name}（Lv${e.unit.level}）`).join(' + ')}\n`);

let guard = 0;
while (engine.phase !== 'ended' && guard++ < 200) {
  autoLoopTurn(engine);
}

console.log('── 战斗日志 ──');
for (const l of engine.log) {
  const tag = l.side === 'player' ? '你' : l.side === 'enemy' ? '敌' : '·';
  console.log(`[R${l.turn}][${tag}] ${l.text}`);
}

console.log('\n── 战果 ──');
console.log(`回合数: ${engine.turn} | 结果: ${engine.result === 'victory' ? '🎉 胜利' : '💀 失败'}`);
console.log(`玩家: HP ${engine.player.hp}/${engine.player.maxHp}  AP ${engine.ap}/${engine.apMax}`);
for (const e of enemies) console.log(`${e.unit.name}: HP ${e.unit.hp}/${e.unit.maxHp}`);
if (!engine.result) { console.error('❌ 战斗未正常结束（死循环守卫触发）'); process.exit(1); }
