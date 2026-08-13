// ============================================================
// tools/test_autoloop.mjs — 玩家自动循环测试（Fate_echo Phase 3）
// 验证（NEW_GAME.md §6.2 自动循环辅助）：
//   保命链（绝境 s45 / 护盾 / 回蓝）、治疗优先（HP<50%）、
//   priority 序列输出、AP 排满、血满不用治疗、完整战斗跑通
// 注意：autoLoopTurn 是完整循环（入队 → confirm → 敌人阶段 → 回合结束），
//   断言基于战斗结果与日志（返回后 pending 已清空）
// 用法: node tools/test_autoloop.mjs
// ============================================================

import { CombatEngine } from '../js/engine.js';
import { CombatUnit } from '../js/unit.js';
import { skillData } from '../js/setup.js';
import { autoLoopTurn } from '../js/autoloop.js';

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

const rng = () => 0.5;
const mkUnit = (o = {}) => new CombatUnit(Object.assign(
  { name: '测试员', hp: 200, maxHp: 200, mp: 100, maxMp: 100, atk: 20, def: 10, level: 1, critChance: 0 },
  o,
));
const mkEnemy = (o = {}) => new CombatUnit(Object.assign(
  { name: '靶子', hp: 300, maxHp: 300, mp: 100, maxMp: 100, atk: 12, def: 10, level: 5, critChance: 0 },
  o,
));
const sk = (ids) => ids.map((id) => skillData(id)).filter(Boolean);
const BASE = ['s01', 's03', 's04', 's05', 's07', 's13', 's18', 's45', 's_passive_01'];
const eng = (pOpts = {}, eOpts = {}, pSkills = BASE) => {
  const e = new CombatEngine({
    player: { unit: mkUnit(pOpts), skills: sk(pSkills) },
    enemies: [{ unit: mkEnemy(eOpts), skills: [] }],
    rng,
  });
  e.startTurn();
  return e;
};
// 玩家受击 12×0.8×0.9(被动) = 8.64 → round 9
const PLAYER_HIT = Math.round(Math.floor(12 * 0.8) * 0.9); // calcDamage floor 后 ×被动 0.9 再 round = 8

console.log('== A. 保命链 ==');
{
  // 绝境：HP<30%（s45 命运轮转已随终焉排除——自动模式不用终焉，2026-08-11 彻底去 CD 后）
  // → 治疗优先（s05 生命绽放 +100，护盾吸收受击 → 190）
  const e = eng({ hp: 50 });
  autoLoopTurn(e);
  t('A1 HP 25% 时自动模式不用终焉，走保命链（护盾吸收受击 + s05 治疗 → 150）', e.player.hp === 150 && !e.log.some((l) => l.text.includes('命运逆转')), `hp=${e.player.hp}`);
  t('A1b 回合已推进（confirm 执行）', e.turn === 2 && e.phase === 'player');
}
{
  // 血少无盾 → 护盾（40 点被吸收 9 → 31）
  const e = eng({ hp: 120 });
  autoLoopTurn(e);
  t('A2 HP 60% 无盾时自动开 魔力护盾', e.player.shield && e.player.shield.hp === 40 - PLAYER_HIT, `shield=${e.player.shield && e.player.shield.hp}`);
}
{
  // AP 未满（ap < apMax）→ 瞬发链回 AP（黑暗契约 +1 行动点）
  const e = eng();
  e.player.buffs.push({ stat: 'haste', val: 15, turns: 99 }); // apMax 2，保底 1 → 未满
  e.startTurn();
  autoLoopTurn(e);
  t('A3 AP 未满时自动 黑暗契约（恢复 1 行动点）', e.log.some((l) => l.text.includes('行动点')), e.log.map((l) => l.text).join('|'));
}
{
  // 满血满蓝无盾 → 不用任何瞬发
  const e = eng();
  autoLoopTurn(e);
  t('A4 状态健康时瞬发槽空置（无护盾/回 AP 技日志）', !e.log.some((l) => l.text.includes('护盾') || l.text.includes('黑暗契约')));
}

console.log('== B. 主技能链 ==');
{
  // HP 40% → 治疗优先（s05 生命绽放 +100）
  const e = eng({ hp: 80 });
  autoLoopTurn(e);
  t('B1 HP 40% 时治疗优先（s05 +100，护盾吸收受击 → 180）', e.player.hp === 180, `hp=${e.player.hp}`);
  t('B1b 治疗占 AP → 未排输出', !e.log.some((l) => l.text.includes('施放 死亡标记')));
}
{
  // 满血 → priority 序列（s18 死亡标记 15 最高）
  const e = eng();
  autoLoopTurn(e);
  t('B2 满血按 priority 输出（s18 死亡标记）', e.log.some((l) => l.text.includes('施放 死亡标记')), e.log.map((l) => l.text).join('|'));
}
{
  // 防御姿态 +1（ap=2）：s18 + s04 按 priority 排满（AP 回转体系下多打需回 AP/防御 +1）
  const e = eng();
  e.player.buffs.push({ stat: 'haste', val: 15, turns: 99 }); // apMax 2
  e.defendBonus = 1; // 防御姿态下回合 +1 AP
  e.startTurn();
  autoLoopTurn(e);
  const i18 = e.log.findIndex((l) => l.text.includes('施放 死亡标记'));
  const i04 = e.log.findIndex((l) => l.text.includes('痛苦诅咒'));
  t('B3 AP 排满：s18 与 s04 都施放', i18 >= 0 && i04 >= 0);
  t('B3b 顺序按 priority 降序（s18 先于 s04）', i18 < i04, `${i18} vs ${i04}`);
}
{
  // HP 70% + AP 2：治疗进常规候选（s18 → s05）
  const e = eng({ hp: 140 });
  e.player.buffs.push({ stat: 'haste', val: 15, turns: 99 });
  e.startTurn();
  autoLoopTurn(e);
  t('B4 HP 70% 时治疗进常规候选（s18 后 s05）', e.log.some((l) => l.text.includes('施放 死亡标记')) && e.log.some((l) => l.text.includes('恢复')), e.log.map((l) => l.text).join('|'));
}

console.log('== C. 完整自动战斗 ==');
{
  const e = eng();
  let guard = 0;
  while (e.phase !== 'ended' && guard++ < 80) {
    if (!autoLoopTurn(e)) break;
  }
  t('C1 自动打完整场战斗（正常结束）', e.phase === 'ended' && (e.result === 'victory' || e.result === 'defeat'), `result=${e.result} guard=${guard}`);
  t('C2 自动循环无死循环', guard < 80);
}

console.log(`\n========== test_autoloop 结果：${pass} 通过 / ${fail} 失败 ==========`);
if (fail) process.exit(1);
