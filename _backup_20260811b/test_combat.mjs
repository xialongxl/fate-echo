// ============================================================
// tools/test_combat.mjs — 战斗核心测试（Fate_echo Phase 1）
// 验证（NEW_GAME.md §2/§3）：
//   回合流转（玩家阶段→敌人阶段→回合结束）、行动点/瞬发槽、
//   CD 回合化递减、dot/hot/buff/shield/vuln 持续效果结算、
//   防御姿态、自然回蓝、伤害公式边界、领域（5 种特殊规则）、
//   终焉技能集成（献祭/无敌/化身/回溯/命运轮转）、胜负判定、事件、多目标
// 注意：confirm() 是完整循环（施放 → 敌人阶段 → 回合结束 → 下回合），
//       返回时"回合结束的递减/结算"均已发生。
// 确定性：rng 恒 0.5 —— critChance 0 永不暴击 / critChance 1 必暴击
// 用法: node tools/test_combat.mjs
// ============================================================

import { CombatEngine } from '../js/engine.js';
import { CombatUnit } from '../js/unit.js';
import { skillData } from '../js/setup.js';
import { calcDamage } from '../js/effects.js';

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

// ---- 测试环境 ----
const rng = () => 0.5; // 确定性随机源
const mkUnit = (o = {}) => new CombatUnit(Object.assign(
  { name: '测试员', hp: 200, maxHp: 200, mp: 100, maxMp: 100, atk: 20, int: 10, level: 1, critChance: 0 },
  o,
));
const mkEnemy = (o = {}) => new CombatUnit(Object.assign(
  { name: '靶子', hp: 300, maxHp: 300, mp: 100, maxMp: 100, atk: 15, int: 10, level: 5, critChance: 0 },
  o,
));
// 技能数据列表（按 id）
const sk = (ids) => ids.map((id) => skillData(id)).filter(Boolean);
// 默认玩家技能组：无被动（被动单独测试）
const BASE = ['s01', 's03', 's04', 's05', 's07', 's13', 's18'];
const eng = (pOpts = {}, eOpts = {}, eSkills = []) => new CombatEngine({
  player: { unit: mkUnit(pOpts), skills: sk(BASE) },
  enemies: [{ unit: mkEnemy(eOpts), skills: sk(eSkills) }],
  rng,
});
const engCustom = (pSkills, pOpts = {}, eOpts = {}, eSkills = []) => new CombatEngine({
  player: { unit: mkUnit(pOpts), skills: sk(pSkills) },
  enemies: [{ unit: mkEnemy(eOpts), skills: sk(eSkills) }],
  rng,
});
// 空确认：跳过行动，完整走 敌人阶段 → 回合结束 → 下回合
const skip = (e) => { const r = e.confirm(); if (!r) throw new Error('confirm 应返回 true（非 ended）'); };
// 数值预期：玩家 atk20 对 int10/lv5 敌人（减伤 10/210≈4.76%）
const MIT = 1 - 10 / (10 + 5 * 40); // 0.95238…
const expectDmg = (mult) => Math.floor(20 * mult * MIT);

console.log('== A. 构造与被动 ==');
{
  const e = eng();
  t('A1 构造：phase=player、turn=0、待行动', e.phase === 'player' && e.turn === 0 && e.pending.length === 0);
  e.startTurn();
  t('A2 startTurn：turn=1、ap=1、apMax=1', e.turn === 1 && e.ap === 1 && e.apMax === 1);
  const e2 = new CombatEngine({ player: { unit: mkUnit(), skills: [] }, enemies: [], rng });
  t('A3 无敌人 → 立即胜利', e2.phase === 'ended' && e2.result === 'victory');
}
{
  const e = engCustom(['s01', 's_passive_01']);
  t('A4 终焉之力：常驻增伤 buff（∞ 回合）', e.player.buffs.some((b) => b.stat === 'dmg_up_pct' && b.val === 10 && b.turns === Infinity));
  t('A5 终焉之力：受伤 -10%', Math.abs(e.player.damageTakenMult - 0.9) < 1e-12);
  t('A6 终焉之力：增伤 1.1', Math.abs(e.player.dmgMultiplier() - 1.1) < 1e-9);
  e.startTurn();
  t('A7 被动增伤生效：s01 伤害 20（无被动 19）', e.queueMain('s01').ok && e.confirm() && e.enemies[0].hp === 300 - 20, `hp=${e.enemies[0].hp}`);
}

console.log('== B. 行动点 / 瞬发槽 ==');
{
  const e = eng();
  e.startTurn();
  t('B1 基础 apMax=1，第二主技能拒绝', e.queueMain('s03').ok && !e.queueMain('s01').ok);
  t('B2 拒绝原因：行动点不足', e.queueMain('s01').reason === '行动点不足');
}
{
  const e = eng();
  e.player.buffs.push({ stat: 'haste', val: 15, turns: 99 });
  e.startTurn();
  t('B3 haste15 → apMax=2（每 10% +1）', e.apMax === 2);
  t('B4 两个主技能可入队', e.queueMain('s03').ok && e.queueMain('s01').ok);
  t('B5 第三个主技能拒绝', !e.queueMain('s04').ok);
  e.player.buffs.push({ stat: 'haste', val: 30, turns: 99 });
  e.startTurn();
  t('B6 haste30 → 1+3=4 截断至上限 3', e.apMax === 3);
  e.player.buffs.push({ stat: 'haste', val: 50, turns: 99 });
  e.startTurn();
  t('B7 haste50 → 仍为 3（上限）', e.apMax === 3);
}
{
  const e = eng();
  e.startTurn();
  t('B8 主技能 + 瞬发可同时入队（瞬发不占 AP）', e.queueMain('s03').ok && e.queueInstant('s07').ok);
  t('B9 第二瞬发拒绝（每回合 1 槽）', !e.queueInstant('s13').ok && e.queueInstant('s13').reason === '瞬发槽已用');
  t('B10 取消瞬发释放槽位', e.unqueue('s07') && e.queueInstant('s13').ok);
  t('B11 重复入队同一技能拒绝', !e.queueMain('s03').ok && e.queueMain('s03').reason === '已在队列中');
  e.unqueue('s13'); e.unqueue('s03');
  e.defend(); // 完整循环已进入下回合（turn 2，apMax = 1 + 防御加成 1）
  t('B12 防御姿态下回合 +1 AP（apMax=2）', e.turn === 2 && e.apMax === 2, `turn=${e.turn} apMax=${e.apMax}`);
  // 防御加成独立叠加（可超急速上限 3）：haste20 → 急速部分 3 + 防御 +1 = 4
  const e2 = eng();
  e2.player.buffs.push({ stat: 'haste', val: 20, turns: 99 });
  e2.startTurn();
  e2.defend();
  t('B13 防御加成独立于急速上限（3+1=4）', e2.turn === 2 && e2.apMax === 4, `apMax=${e2.apMax}`);
}

console.log('== C. 施放与消耗 ==');
{
  const e = eng();
  e.startTurn();
  e.queueMain('s03');
  e.confirm();
  t('C1 s03：扣 5 法力（回合 2 开始回蓝 +1 → 96）', e.player.mp === 96, `mp=${e.player.mp}`);
  t('C2 s03：伤害 34（1.8×20×减伤，floor）', e.enemies[0].hp === 300 - expectDmg(1.8), `hp=${e.enemies[0].hp}`);
  t('C3 s03 冷却 1 回合，回合结束已归零（turn=2）', e.turn === 2 && e.playerSkills.find((s) => s.id === 's03').currentCd === 0);
  t('C4 s01（cd 0）使用后仍 ready 可连发', e.queueMain('s01').ok && e.confirm() && e.playerSkills.find((s) => s.id === 's01').ready);
}
{
  const e = eng({ mp: 0 });
  e.startTurn();
  t('C5 法力不足拒绝', !e.queueMain('s03').ok && e.queueMain('s03').reason === '法力不足');
}
{
  const e = eng();
  e.startTurn();
  e.queueMain('s04');
  e.confirm(); // s04 cd 4 → 回合结束递减为 3
  t('C6 冷却中再次入队拒绝（s04 cd4 → 剩 3）', !e.queueMain('s04').ok && e.queueMain('s04').reason === '冷却中');
  e.queueMain('s01');
  e.confirm();
  t('C7 冷却逐回合递减（3 → 2）', e.playerSkills.find((s) => s.id === 's04').currentCd === 2, `cd=${e.playerSkills.find((s) => s.id === 's04').currentCd}`);
}
{
  const e = engCustom(BASE.concat(['s45']));
  e.startTurn();
  t('C8 s45 命运轮转：HP 50% 条件未满足拒绝', !e.queueInstant('s45').ok && e.queueInstant('s45').reason === '条件未满足');
  e.player.hp = 50;
  t('C9 s45：HP 25% 可入队（瞬发）', e.queueInstant('s45').ok);
  e.unqueue('s45');
}
{
  const e = engCustom(BASE.concat(['s40']), { hp: 1 }, { hp: 1000, maxHp: 1000 }); // 新语义：代价=floor(当前HP×0.5)=0
  e.startTurn();
  t('C10 s40 献祭：低血量可入队（代价按当前 HP）', e.queueMain('s40').ok);
  const e2 = engCustom(BASE.concat(['s40']), { hp: 150 }, { hp: 1000, maxHp: 1000 });
  e2.startTurn();
  t('C11 s40：HP 高于代价可入队', e2.queueMain('s40').ok);
}

console.log('== D. 持续效果 ==');
{
  const e = eng();
  e.startTurn();
  e.queueMain('s04');
  e.confirm(); // 完整循环：立即伤害 + 回合 1 结束首次结算
  t('D1 s04：立即 9 + dot 5 回合（回合 1 结束已结算 1 次 -15）', e.enemies[0].dots.length === 1 && e.enemies[0].dots[0].turns === 4 && e.enemies[0].hp === 300 - expectDmg(0.5) - expectDmg(0.8), `hp=${e.enemies[0].hp} turns=${e.enemies[0].dots[0] && e.enemies[0].dots[0].turns}`);
  skip(e);
  t('D2 回合 2 结束再结算 1 次（总 2/5）', e.enemies[0].hp === 300 - expectDmg(0.5) - 2 * expectDmg(0.8), `hp=${e.enemies[0].hp}`);
  skip(e); skip(e); skip(e);
  t('D3 共 5 次结算后移除（总伤守恒）', e.enemies[0].dots.length === 0 && e.enemies[0].hp === 300 - expectDmg(0.5) - 5 * expectDmg(0.8), `hp=${e.enemies[0].hp}`);
}
{
  const e = eng();
  e.startTurn();
  e.queueMain('s18');
  e.confirm();
  t('D4 s18 易伤：×1.2 挂载 4 回合（回合 1 结束 → 剩 3）', e.enemies[0].vulnMult === 1.2 && e.enemies[0].vulnTurns === 3, `v=${e.enemies[0].vulnMult}/${e.enemies[0].vulnTurns}`);
  e.queueMain('s01');
  e.confirm();
  t('D5 易伤期间受击放大：round(19×1.2)=23', e.enemies[0].hp === 300 - 23, `hp=${e.enemies[0].hp}`);
  skip(e); skip(e); skip(e);
  t('D6 易伤到期还原 ×1', e.enemies[0].vulnMult === 1 && e.enemies[0].vulnTurns === 0);
}
{
  const e = eng();
  e.startTurn();
  e.queueInstant('s13');
  e.confirm();
  t('D7 s13 护盾：40 点 ×4 回合（回合 1 结束 → 剩 3）', e.player.shield && e.player.shield.hp === 28 && e.player.shield.turns === 3, `shield=${JSON.stringify(e.player.shield)}`);
  t('D8 敌人攻击 12 被护盾吸收（盾 40→28）', e.player.hp === 200 && e.player.shield.hp === 28);
  skip(e); skip(e); skip(e);
  t('D9 护盾 4 回合到期清除', !e.player.shield);
}
{
  const e = engCustom(['s01', 's12', 's15']);
  e.player.hp = 100;
  e.startTurn();
  e.queueMain('s12');
  e.confirm();
  t('D10 s12 生命泉涌：hot 5%/回合 ×4（回合 1 结束 → 剩 3）', e.player.hots.length === 1 && e.player.hots[0].pct === 0.05 && e.player.hots[0].turns === 3, `turns=${e.player.hots[0] && e.player.hots[0].turns}`);
  t('D11 回合 1：受击 12 + hot +10 → 98', e.player.hp === 100 - 12 + 10, `hp=${e.player.hp}`);
  e.queueMain('s15');
  e.confirm();
  t('D12 s15 迅捷微风：haste +15 ×8（回合 2 结束 → 剩 7）', e.player.statBonus('haste') === 15 && e.player.buffs.some((b) => b.stat === 'haste' && b.turns === 7), `buffs=${JSON.stringify(e.player.buffs)}`);
  skip(e); skip(e); skip(e); skip(e); skip(e); skip(e); skip(e);
  t('D13 s15 到期移除', e.player.statBonus('haste') === 0);
}
{
  const e = eng();
  e.player.hp = 100;
  e.startTurn();
  e.queueMain('s05');
  e.confirm();
  t('D14 s05 生命绽放：恢复 5.0×atk=100，随后受击 12 → 188', e.player.hp === 100 + 100 - 12, `hp=${e.player.hp}`);
  const e2 = eng(); // s05 冷却 6 回合，需新战斗
  e2.player.hp = 150;
  e2.startTurn();
  e2.queueMain('s05');
  e2.confirm();
  t('D15 s05 超上限截断（150+100=250 → 封顶 200，受击 12 → 188）', e2.player.hp === 150 + 50 - 12, `hp=${e2.player.hp}`);
}

console.log('== E. 伤害公式边界 ==');
{
  const e = eng({ critChance: 1 });
  e.startTurn();
  e.queueMain('s01');
  e.confirm();
  t('E1 必暴击 ×1.5：floor(20×1.5×0.95238)=28', e.enemies[0].hp === 300 - 28, `hp=${e.enemies[0].hp}`);
  t('E1b 暴击日志带（暴击!）标记且分类为 crit（§6.1 示例语义）', e.log.some((l) => l.text.includes('暴击') && l.type === 'crit'), e.log.map((l) => l.text).join('|'));
  const u2 = mkUnit({ critChance: 2 });
  t('E2 暴击率硬上限 100%', u2.totalCritChance() === 1);
  const huge = mkEnemy({ int: 100000, level: 100 });
  const d = calcDamage(mkUnit(), huge, 1.0, { noCrit: true, rng });
  t('E3 减伤上限 85%：伤害 = 3', d === 3, `d=${d}`);
}
{
  const e = eng();
  e.startTurn();
  e.player.damageTakenMult = 0.01; // 外部注入非法值 → 受击乘区下限 0.05（总减伤上限 95%）
  e.confirm();
  t('E4 受击乘区下限 0.05：round(12×0.05)=1', e.player.hp === 200 - Math.round(12 * 0.05), `hp=${e.player.hp}`);
}

console.log('== F. 防御姿态 ==');
{
  const e = eng();
  e.startTurn();
  e.queueMain('s03');
  e.defend(); // 防御清空队列
  t('F1 defend 清空待行动（s03 未施放）', e.player.mp === 100 && e.playerSkills.find((s) => s.id === 's03').currentCd === 0, `mp=${e.player.mp}`);
  t('F2 防御受击 ×0.7：round(12×0.7)=8', e.player.hp === 200 - 8, `hp=${e.player.hp}`);
  t('F3 敌人阶段结束乘区还原', e.player.damageTakenMult === 1);
  t('F4 防御下回合 +1 AP（apMax=2）', e.turn === 2 && e.apMax === 2);
  skip(e);
  t('F5 下一回合受击恢复正常 12', e.player.hp === 192 - 12, `hp=${e.player.hp}`);
}

console.log('== G. 自然回蓝 ==');
{
  const e = eng();
  e.startTurn();
  e.player.mp = 50;
  skip(e);
  t('G1 每回合回 1% 最大法力（100 → +1）', e.player.mp === 51, `mp=${e.player.mp}`);
}

console.log('== H. 敌人阶段 ==');
{
  const e = eng({}, {}, ['s03', 's01']);
  e.startTurn();
  e.confirm(); // 空确认 → 敌人行动
  t('H1 敌人选技按 priority：s03(5) > s01(1)，伤害 21', e.player.hp === 200 - 21, `hp=${e.player.hp}`);
}
{
  const e = eng();
  e.startTurn();
  e.confirm();
  t('H2 敌人无技能 → 基础攻击 12', e.player.hp === 200 - 12, `hp=${e.player.hp}`);
}
{
  const e = eng({}, { mp: 0 }, ['s03']);
  e.startTurn();
  e.confirm();
  t('H3 敌人法力不足 → 基础攻击兜底', e.player.hp === 200 - 12, `hp=${e.player.hp}`);
}
{
  const e = eng({ hp: 10 }, {}, ['s03']);
  e.startTurn();
  e.confirm();
  t('H4 敌人击杀玩家 → 失败', e.phase === 'ended' && e.result === 'defeat' && e.player.hp === 0);
}

console.log('== I. 胜负判定 ==');
{
  const e = eng({}, { hp: 30 });
  e.startTurn();
  e.queueMain('s03'); // 34 伤害
  e.confirm();
  t('I1 击杀敌人 → 胜利', e.phase === 'ended' && e.result === 'victory');
  t('I2 胜利后 confirm 拒绝', !e.confirm());
}
{
  const e = eng();
  e.startTurn();
  e.player.mp = 50;
  skip(e);
  t('I3 空确认 = 跳过行动，正常流转', e.turn === 2 && e.phase === 'player' && e.player.mp === 51);
}
{
  // 回合结束结算击杀：dot 把敌人跳死 → 回合结束判定胜利
  const e = eng({}, { hp: 20 });
  e.startTurn();
  e.queueMain('s04'); // 立即 9 → 敌人 11；回合 1 结束 dot 15 → 死
  e.confirm();
  t('I4 敌人被 dot 跳死 → 回合结束判定胜利', e.phase === 'ended' && e.result === 'victory' && e.enemies[0].hp === 0);
}
{
  // 互杀：同回合结束双方同时被 dot 跳死 → 玩家优先判负（_checkEnd 先判玩家）
  // 敌 dot：立即 6（15×0.5×0.8）+ 每回合 9（15×0.8×0.8）→ 玩家 10-6=4，回合结束 4-9 → 死
  // 玩 dot：立即 9 + 每回合 15 → 敌人 20-9=11，回合结束 11-15 → 死
  const e = new CombatEngine({
    player: { unit: mkUnit({ hp: 10 }), skills: sk(['s04']) },
    enemies: [{ unit: mkEnemy({ hp: 20 }), skills: sk(['s04']) }],
    rng,
  });
  e.startTurn();
  e.queueMain('s04'); // 双方各挂 dot：立即 9 → 各剩 11；回合结束 dot 15 → 双死
  e.confirm();
  t('I5 互杀判定：玩家先判负（defeat）', e.phase === 'ended' && e.result === 'defeat' && e.player.hp === 0 && e.enemies[0].hp === 0, `result=${e.result} pHP=${e.player.hp} eHP=${e.enemies[0].hp}`);
}
{
  // 死亡不可被同回合 hot 复活：玩家挂 50% hot，被敌 dot 跳死 → 保持死亡（defeat）
  const e = new CombatEngine({
    player: { unit: mkUnit({ hp: 10 }), skills: [] },
    enemies: [{ unit: mkEnemy({ hp: 100 }), skills: sk(['s04']) }],
    rng,
  });
  e.player.hots.push({ pct: 0.5, turns: 3 }); // 50%×200=100 治疗（若复活则 hp 100）
  e.startTurn();
  e.confirm(); // 敌 s04：立即 6 → 4；回合结束 dot 9 → 死；hot 不得结算
  t('I6 被 dot 打死的单位不结算 hot（不可复活）', e.phase === 'ended' && e.result === 'defeat' && e.player.hp === 0, `result=${e.result} pHP=${e.player.hp}`);
}

console.log('== J. 领域 ==');
{
  const e = engCustom(['s48'], { mp: 500, maxMp: 500 }, { hp: 1000, maxHp: 1000 });
  e.startTurn();
  e.queueMain('s48');
  e.confirm();
  t('J1 s48 虚空领域展开：5 回合（回合 1 结束 → 剩 4）', e.domains.length === 1 && e.domains[0].type === 'void' && e.domains[0].turns === 4, `turns=${e.domains[0] && e.domains[0].turns}`);
  t('J2 展开回合结束即结算：95（5.0×20×减伤）', e.enemies[0].hp === 1000 - 95, `hp=${e.enemies[0].hp}`);
  skip(e); skip(e); skip(e); skip(e);
  t('J3 共 5 次结算后领域移除', e.domains.length === 0 && e.enemies[0].hp === 1000 - 475, `hp=${e.enemies[0].hp}`);
}
{
  const e = engCustom(['s48'], { mp: 500, maxMp: 500 }, { hp: 400, maxHp: 1000 }); // 40%
  e.startTurn();
  e.queueMain('s48');
  e.confirm();
  t('J4 虚空领域：目标 40% → ×1.5（142）', e.enemies[0].hp === 400 - 142, `hp=${e.enemies[0].hp}`);
  const e2 = engCustom(['s48'], { mp: 500, maxMp: 500 }, { hp: 200, maxHp: 1000 });
  e2.startTurn();
  e2.queueMain('s48');
  e2.confirm();
  t('J5 虚空领域：目标 20% → ×2（190）', e2.enemies[0].hp === 200 - 190, `hp=${e2.enemies[0].hp}`);
}
{
  const e = engCustom(['s49'], { mp: 500, maxMp: 500 }, { hp: 1000, maxHp: 1000 });
  e.player.hp = 100;
  e.startTurn();
  e.queueMain('s49');
  e.confirm();
  t('J6 海洋领域：受击 ×0.8 → round(12×0.8)=10', e.player.hp === 100 - Math.round(12 * 0.8), `hp=${e.player.hp}`);
  t('J7 海洋领域：受疗 ×1.2', e.player.healingMult === 1.2);
  const before = e.player.hp;
  e.player.heal(50);
  t('J8 受疗 50 → 实际 60', e.player.hp - before === 60, `heal=+${e.player.hp - before}`);
  skip(e); skip(e); skip(e); skip(e);
  t('J9 海洋领域到期：乘区还原', e.domains.length === 0 && e.player.damageTakenMult === 1 && e.player.healingMult === 1);
}
{
  const e = engCustom(['s51'], { mp: 500, maxMp: 500 }, { hp: 1000, maxHp: 1000 });
  e.startTurn();
  e.queueMain('s51');
  e.confirm();
  t('J10 死亡领域：无负面效果 → ×1.0（95）', e.enemies[0].hp === 1000 - 95, `hp=${e.enemies[0].hp}`);
  const e2 = engCustom(['s04', 's51'], { mp: 500, maxMp: 500 }, { hp: 1000, maxHp: 1000 });
  e2.player.buffs.push({ stat: 'haste', val: 15, turns: 99 });
  e2.startTurn();
  e2.queueMain('s04');
  e2.queueMain('s51');
  e2.confirm();
  t('J11 死亡领域：敌人带 dot → ×1.15（立即 9 + dot 15 + 领域 109）', e2.enemies[0].hp === 1000 - expectDmg(0.5) - expectDmg(0.8) - Math.floor(95 * 1.15), `hp=${e2.enemies[0].hp}`);
}
{
  const e = engCustom(['s52'], { mp: 500, maxMp: 500 }, { hp: 1000, maxHp: 1000 });
  e.player.hp = 100;
  e.startTurn();
  e.queueMain('s52');
  e.confirm();
  t('J12 圣光领域：吸血 5%（受击后 hp 88/200=44% → 转化翻倍 +10 → 98）', e.player.hp === 100 - 12 + Math.round(95 * 0.1), `hp=${e.player.hp}`);
  e.player.hp = 80; // <50%
  skip(e);
  t('J13 圣光领域：<50% 血转化翻倍（80 受击 12 后 +round(95×0.1)=10）', e.player.hp === 80 - 12 + Math.round(95 * 0.1), `hp=${e.player.hp}`);
}
{
  const e = engCustom(['s50'], { mp: 500, maxMp: 500 }, { hp: 1000, maxHp: 1000 });
  e.startTurn();
  e.queueMain('s50');
  e.confirm();
  // ticks: 95 / 104(×1.1) / 104 / 114(×1.2) / 114
  skip(e); skip(e); skip(e); skip(e);
  const hp = 1000 - (95 + Math.floor(95 * 1.1) + Math.floor(95 * 1.1) + Math.floor(95 * 1.2) + Math.floor(95 * 1.2));
  t('J14 烈焰领域：每 2 回合 +10%（5 回合 → ×1.2 顶）', e.enemies[0].hp === hp, `hp=${e.enemies[0].hp}`);
}

console.log('== K. 终焉技能集成 ==');
{
  // 新语义（末光照抄）：代价=当前HP×50%、最低留1、伤害=献祭HP×20（无减伤）
  const e = engCustom(BASE.concat(['s40']), { hp: 200 }, { hp: 100000, maxHp: 100000 });
  e.startTurn();
  e.queueMain('s40');
  e.confirm();
  t('K1 s40 献祭 50% 当前生命（200→100，随后受击 12 → 88）', e.player.hp === 100 - 12, `hp=${e.player.hp}`);
  t('K2 s40 伤害 2000（献祭 100×20 倍）', e.enemies[0].hp === 100000 - 2000, `hp=${e.enemies[0].hp}`);
  t('K3 s40 增伤 buff +30% ×4（回合 1 结束 → 剩 3）', e.player.buffs.some((b) => b.stat === 'dmg_up_pct' && b.val === 30 && b.turns === 3));
}
{
  // 最低保留 1 HP（不可自杀）：hp2 → 献祭 1 → 1（无敌隔离敌人攻击）
  const e = engCustom(BASE.concat(['s40']), { hp: 2 }, { hp: 100000, maxHp: 100000 });
  e.startTurn();
  e.player.immuneTurns = 3;
  e.queueMain('s40');
  e.confirm();
  t('K4 s40 最低保留 1 HP（hp2 → 献祭 1 → 1）', e.player.hp === 1, `hp=${e.player.hp}`);
  t('K4b s40 伤害按当前 HP（献祭 1×20=20）', e.enemies[0].hp === 100000 - 20, `hp=${e.enemies[0].hp}`);
}
{
  const e = engCustom(['s43'], { mp: 200, maxMp: 200 }, { hp: 1000, maxHp: 1000 }, ['s01']);
  e.startTurn();
  e.queueMain('s43');
  e.confirm();
  t('K5 s43 星辰坠落：无敌 3 回合（回合 1 结束 → 剩 2）', e.player.immuneTurns === 2, `immune=${e.player.immuneTurns}`);
  t('K6 s43 期间敌人攻击 0 伤害', e.player.hp === 200, `hp=${e.player.hp}`);
  t('K7 s43 dot 挂载 4.0×3 回合（回合 1 结束 -76）', e.enemies[0].dots.length === 1 && e.enemies[0].hp === 1000 - 76, `hp=${e.enemies[0].hp}`);
  skip(e); skip(e);
  t('K8 无敌到期（3 回合后归零）', e.player.immuneTurns === 0);
}
{
  const e = engCustom(['s04', 's41'], { mp: 200, maxMp: 200 });
  e.player.buffs.push({ stat: 'haste', val: 15, turns: 99 });
  e.startTurn();
  e.queueMain('s41');
  e.queueMain('s04');
  e.confirm();
  t('K9 s41 虚空化身：dot 强化 6 回合（回合 1 结束 → 剩 5）', e.player.dotEnhanced === 5, `dotEnhanced=${e.player.dotEnhanced}`);
  t('K10 dot 4 倍（频率×2 且伤害×2：立即 9 + 2×30=60）', e.enemies[0].hp === 300 - expectDmg(0.5) - 2 * expectDmg(1.6), `hp=${e.enemies[0].hp}`);
}
{
  const e = engCustom(['s04', 's38'], { mp: 200, maxMp: 200 });
  e.startTurn();
  e.queueMain('s04');
  e.confirm(); // s04 cd 4 → 回合结束递减为 3
  const cdBefore = e.playerSkills.find((s) => s.id === 's04').currentCd;
  e.queueInstant('s38');
  e.confirm();
  t('K11 s38 时间回溯：重置冷却（3 → 0）', cdBefore === 3 && e.playerSkills.find((s) => s.id === 's04').currentCd === 0, `cd=${e.playerSkills.find((s) => s.id === 's04').currentCd}`);
  t('K12 s38 急速 +50 ×2 回合（回合 2 结束 → 剩 1）', e.player.buffs.some((b) => b.stat === 'haste' && b.val === 50 && b.turns === 1));
}
{
  // 末光照抄：时间回溯不重置终焉技能（s40 冷却保持，回合结束递减 1）
  const e = engCustom(['s04', 's38', 's40'], { mp: 200, maxMp: 200 });
  e.startTurn();
  e.playerSkills.find((s) => s.id === 's04').currentCd = 5;
  e.playerSkills.find((s) => s.id === 's40').currentCd = 10;
  e.queueInstant('s38');
  e.confirm();
  t('K12b s38 重置非终焉（s04 5→0）', e.playerSkills.find((s) => s.id === 's04').currentCd === 0, `cd=${e.playerSkills.find((s) => s.id === 's04').currentCd}`);
  t('K12c s38 不重置终焉（s40 10 → 回合结束 9）', e.playerSkills.find((s) => s.id === 's40').currentCd === 9, `cd=${e.playerSkills.find((s) => s.id === 's40').currentCd}`);
}
{
  const e = engCustom(BASE.concat(['s45']), { mp: 200, maxMp: 200 });
  e.player.hp = 50;
  e.player.mp = 30;
  e.startTurn();
  e.queueInstant('s45');
  e.confirm();
  t('K13 s45 命运轮转：回满 HP/MP（随后受击 12 → 188）', e.player.hp === 200 - 12 && e.player.mp === 200, `hp=${e.player.hp} mp=${e.player.mp}`);
  t('K14 s45 增伤 +50% ×6 回合（回合 1 结束 → 剩 5）', e.player.buffs.some((b) => b.stat === 'dmg_up_pct' && b.val === 50 && b.turns === 5));
}

console.log('== L. 事件与多目标 ==');
{
  const e = eng();
  const ev = { logs: [], turns: [], ends: [] };
  e.on('log', (x) => ev.logs.push(x));
  e.on('turn', (x) => ev.turns.push(x));
  e.on('end', (x) => ev.ends.push(x));
  e.startTurn();
  t('L1 turn 事件携带回合信息', ev.turns.length === 1 && ev.turns[0].turn === 1);
  e.queueMain('s03');
  e.confirm();
  t('L2 log 事件带分类/来源/回合', ev.logs.some((l) => l.type === 'damage' && l.side === 'player' && l.turn === 1), JSON.stringify(ev.logs.slice(0, 2)));
  t('L3 turn 事件回合递增', ev.turns.length === 2 && ev.turns[1].turn === 2);
  const e2 = eng({}, { hp: 30 });
  e2.on('end', (x) => ev.ends.push(x));
  e2.startTurn();
  e2.queueMain('s03');
  e2.confirm();
  t('L4 胜利触发 end 事件', ev.ends.length === 1 && ev.ends[0].result === 'victory');
}
{
  const e = new CombatEngine({
    player: { unit: mkUnit(), skills: sk(['s01', 's03']) },
    enemies: [{ unit: mkEnemy({ name: '甲', hp: 300 }), skills: [] }, { unit: mkEnemy({ name: '乙', hp: 30 }), skills: [] }],
    rng,
  });
  e.startTurn();
  t('L5 默认目标为第一个敌人', e.targetIndex === 0);
  e.selectTarget(1);
  t('L6 selectTarget 切换目标', e.targetIndex === 1);
  e.queueMain('s03');
  e.confirm();
  t('L7 命中指定目标（乙 30-34 → 死亡）', e.enemies[1].hp === 0);
  t('L8 目标死亡后不误伤存活目标', e.enemies[0].hp === 300);
  t('L9 存活敌人继续行动（战斗未结束）', e.phase === 'player');
}

console.log(`\n========== test_combat 结果：${pass} 通过 / ${fail} 失败 ==========`);
if (fail) process.exit(1);
