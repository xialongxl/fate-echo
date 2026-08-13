// ============================================================
// tools/test_progression.mjs — 成长系统测试（Fate_echo Phase 4）
// 验证（NEW_GAME.md §5/§9）：经验曲线/成长公式/技能解锁边界/升级结算
// 用法: node tools/test_progression.mjs
// ============================================================

import { expToLevel, playerStatsAt, unlockedSkillData, grantExp, makeBattlePlayer, GROWTH, PLAYER_BASE } from '../js/progression.js';
import { SKILLS_DB } from '../js/data.js';

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

console.log('== A. 经验曲线 ==');
{
  t('A1 Lv1 经验 = floor(100×1.15^0) = 100', expToLevel(1) === 100, `v=${expToLevel(1)}`);
  t('A2 Lv2 = floor(100×1.15^1)（3 段式曲线 60 级前；浮点 floor 后为 114）', expToLevel(2) === Math.floor(100 * Math.pow(1.15, 1)));
  t('A3 曲线递增', expToLevel(3) > expToLevel(2) && expToLevel(2) > expToLevel(1));
  t('A4 Lv 非法值容错（0/负数 → 按 1）', expToLevel(0) === 100 && expToLevel(-3) === 100);
}

console.log('== B. 成长公式 ==');
{
  const s1 = playerStatsAt(1);
  t('B1 Lv1 基础属性（§9：HP100/攻10/防0/暴击5%）',
    s1.hp === PLAYER_BASE.hp && s1.atk === PLAYER_BASE.atk && s1.def === PLAYER_BASE.def && s1.critChance === 0.05);
  const s5 = playerStatsAt(5);
  t('B2 Lv5 成长：HP=100+4×35=240、攻=10+32=42、防=0+4×5=20、暴击=9%',
    s5.hp === 240 && s5.atk === 42 && s5.def === 20 && Math.abs(s5.critChance - 0.09) < 1e-12, `hp=${s5.hp} atk=${s5.atk}`);
  t('B3 属性随等级严格递增', playerStatsAt(10).hp > s5.hp && playerStatsAt(10).atk > s5.atk);
  t('B4 int 不成长（减伤公式用）', s1.int === s5.int);
}

console.log('== C. 技能解锁 ==');
{
  const lv1 = unlockedSkillData(1);
  t('C1 Lv1 解锁 2 个（s01 + 被动）', lv1.length === 2 && lv1.some((s) => s.id === 's01') && lv1.some((s) => s.id === 's_passive_01'), `n=${lv1.length}`);
  const lv3 = unlockedSkillData(3);
  t('C2 Lv3 解锁 4 个（+s02/s03）', lv3.length === 4 && lv3.some((s) => s.id === 's03'));
  t('C3 解锁列表全部 reqLv ≤ 等级', unlockedSkillData(40).every((s) => s.reqLv <= 40));
  t('C4 Lv100 全 53 技能', unlockedSkillData(100).length === SKILLS_DB.length, `n=${unlockedSkillData(100).length}`);
  t('C5 解锁随等级单调增长', unlockedSkillData(50).length > unlockedSkillData(20).length);
}

console.log('== D. 升级结算 ==');
{
  const p = { level: 1, exp: 0 };
  let r = grantExp(p, 100);
  t('D1 100 经验 → 升到 Lv2（余 0）', r.leveledUp && r.levelsGained === 1 && p.level === 2 && p.exp === 0, JSON.stringify(r));
  p.level = 1; p.exp = 0;
  // 3 段式曲线（浮点 floor 后 Lv2 需 114）：Lv1→2 + Lv2→3 + 10 → 连升 2 级余 10
  r = grantExp(p, expToLevel(1) + expToLevel(2) + 10);
  t('D2 升 2 级经验 → 连升 2 级（Lv3 余 10）', p.level === 3 && p.exp === 10 && r.levelsGained === 2);
  p.level = 1; p.exp = 0;
  r = grantExp(p, 50);
  t('D3 经验不足不升级', !r.leveledUp && p.level === 1 && p.exp === 50);
  p.exp = 0;
  r = grantExp(p, -10);
  t('D4 负经验容错（0 增益）', p.exp === 0 && !r.leveledUp);
}

console.log('== E. 战斗玩家构建 ==');
{
  // v2 装备对象（末光咏叹生成器结构）
  const mkGear = (slot, stats) => ({ id: 'eq_test_' + slot, name: '测试 ' + slot, slot, rarityIdx: 1, stats, enhanceLv: 0, locked: false, pinned: false, score: 10 });
  const empty = { weapon: null, head: null, chest: null, legs: null, feet: null, pendant: null, ring: null, trinket: null };
  const { unit, skills } = makeBattlePlayer({ player: { level: 1, equipment: { ...empty, weapon: mkGear('weapon', { atk: 3 }) } } });
  t('E1 战斗玩家：等级属性 + 装备加成（武器 atk+3）', unit.atk === PLAYER_BASE.atk + 3 && unit.level === 1, `atk=${unit.atk}`);
  t('E2 技能 = 按级解锁', skills.length === unlockedSkillData(1).length);
  const { unit: u2 } = makeBattlePlayer({ player: { level: 5, equipment: empty } });
  t('E3 装备栏全空 → 无加成', u2.atk === 42 && u2.hp === 240);
  // v3 属性体系（末光照抄：atk/int/crit/haste/versa；int 为防御力）
  const { unit: u3 } = makeBattlePlayer({
    player: { level: 1, equipment: { ...empty, weapon: mkGear('weapon', { atk: 14, crit: 5 }), chest: mkGear('chest', { int: 12 }), ring: mkGear('ring', { crit: 12, versa: 10, haste: 5 }) } },
  });
  t('E4 三槽：atk+14/int+12/crit+17/haste+5/versa+10（装备无 hp/def）', u3.atk === 10 + 14 && u3.int === 10 + 12 && u3.maxHp === 100, `atk=${u3.atk} int=${u3.int} hp=${u3.maxHp}`);
  t('E5 饰品 buff 落地（crit 5+12=17% → 总暴击 22%）', Math.abs(u3.totalCritChance() - 0.22) < 1e-9, `crit=${u3.totalCritChance()}`);
  // 终焉图鉴集齐：HP/ATK+10%（末光 finaleCollection）
  const complete = { weapon: true, head: true, chest: true, legs: true, feet: true, pendant: true, ring: true, trinket: true };
  const { unit: u4 } = makeBattlePlayer({ player: { level: 1, equipment: empty, finaleCollection: complete } });
  t('E6 终焉图鉴集齐：HP 100→110、ATK 10→11（+10%）', u4.maxHp === 110 && u4.atk === 11, `hp=${u4.maxHp} atk=${u4.atk}`);
}

console.log(`\n========== test_progression 结果：${pass} 通过 / ${fail} 失败 ==========`);
if (fail) process.exit(1);
