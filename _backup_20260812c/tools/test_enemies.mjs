// ============================================================
// tools/test_enemies.mjs — 敌方随机生成测试（Fate_echo Phase 5 F3）
// 验证（照抄末光 Monster 类 engine.js:921-947 的融合）：
//   名字池（普通随机怪 ∈ 模板名∪随机池；Boss 守卫者头衔格式）
//   数值缩放（等级递增、±15% 浮动范围、Boss 强度显著高于普通）
//   多样性（LCG 序列多种名字/数值；同种子确定复现）
//   模板保留（createEnemy 12 模板默认行为不变，回归不破）
//   buildEncounters 集成（低 rng 出随机怪 / 高 rng 出模板 / Boss 战随机 Boss）
// 用法: node tools/test_enemies.mjs
// ============================================================

import { createEnemy, createRandomEnemy, ENEMIES_DB, ENEMY_SKILLS, RANDOM_NAMES, bossTitle, allEnemies } from '../js/enemies.js';
import { Area, AREAS_PER_RUN } from '../js/area.js';

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

// 恒定 rng（分支判定确定性）；LCG 序列 rng（图生成/多样性）
const constRng = (v) => () => v;
let seed = 7;
const lcg = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

const TEMPLATE_NAMES = ENEMIES_DB.map((e) => e.name);

console.log('== A. 名字池与头衔 ==');
{
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const e = createRandomEnemy({ rng: lcg, level: 1, depth: 1, tier: 'normal' });
    const base = e.unit.name.replace(/·Lv\d+$/, '');
    t('A1 随机怪名 ∈ 模板名∪随机池', TEMPLATE_NAMES.includes(base) || RANDOM_NAMES.includes(base), e.unit.name);
    seen.add(base);
  }
  t('A2 随机怪名有多样性（≥3 种）', seen.size >= 3, `n=${seen.size}`);
  t('A3 随机池 8 名', RANDOM_NAMES.length === 8);
  const boss = createRandomEnemy({ rng: lcg, level: 3, depth: 2, tier: 'boss' });
  t('A4 Boss 守卫者头衔（第2轮·Lv3）', boss.unit.name === '👿 【领主】第2轮守卫者·Lv3', boss.unit.name);
  t('A5 bossTitle 函数一致', bossTitle(2, 3) === boss.unit.name);
}

console.log('== B. 数值缩放与浮动 ==');
{
  const e1 = createRandomEnemy({ rng: constRng(0.5), level: 1, depth: 1, tier: 'normal' });
  const e2 = createRandomEnemy({ rng: constRng(0.5), level: 2, depth: 1, tier: 'normal' });
  t('B1 等级递增：Lv2 HP > Lv1', e2.unit.hp > e1.unit.hp, `hp1=${e1.unit.hp} hp2=${e2.unit.hp}`);
  // 浮动范围：Lv1 普通模板 45~95 HP × 0.85~1.15
  const min = Math.round(45 * 0.85), max = Math.round(95 * 1.15);
  t('B2 浮动在模板范围（Lv1 普通 38~109）', e1.unit.hp >= min && e1.unit.hp <= max, `hp=${e1.unit.hp}`);
  t('B3 同 rng 复现一致', createRandomEnemy({ rng: constRng(0.5), level: 1, depth: 1, tier: 'normal' }).unit.hp === e1.unit.hp);
  const b = createRandomEnemy({ rng: constRng(0.5), level: 1, depth: 1, tier: 'boss' });
  t('B4 Boss HP 显著高于普通随机怪', b.unit.hp > max, `bossHp=${b.unit.hp}`);
  t('B5 随机怪等级 = 传入等级（enemyLevelFor 语义）', e1.unit.level === 1 && e2.unit.level === 2);
}

console.log('== C. 多样性（LCG 序列） ==');
{
  const names = new Set(), hps = new Set();
  for (let i = 0; i < 30; i++) {
    const e = createRandomEnemy({ rng: lcg, level: 3, depth: 1, tier: 'normal' });
    names.add(e.unit.name);
    hps.add(e.unit.hp);
  }
  t('C1 30 次生成 ≥5 种名字', names.size >= 5, `n=${names.size}`);
  t('C2 30 次生成 HP 有浮动', hps.size >= 2, `n=${hps.size}`);
  // 种子复现：重置 seed 两次序列一致
  seed = 7;
  const seq1 = [];
  for (let i = 0; i < 10; i++) seq1.push(createRandomEnemy({ rng: lcg, level: 3, depth: 1, tier: 'normal' }).unit.hp);
  seed = 7;
  const seq2 = [];
  for (let i = 0; i < 10; i++) seq2.push(createRandomEnemy({ rng: lcg, level: 3, depth: 1, tier: 'normal' }).unit.hp);
  t('C3 同种子序列确定复现', JSON.stringify(seq1) === JSON.stringify(seq2));
}

console.log('== D. 模板保留 ==');
{
  t('D1 12 模板完整', ENEMIES_DB.length === 12);
  t('D1b allEnemies 技能解析无缺失', allEnemies().every((e) => e.skills.length >= 1));
  const slime = createEnemy('e01', 5);
  t('D2 模板 createEnemy 数值不变（史莱姆 Lv5 §4.3）', slime.unit.hp === Math.round(45 * Math.pow(5, 1.15)) && slime.unit.atk === Math.round(6 * Math.pow(5, 0.9)));
  t('D3 模板敌人无 random 标记', !slime.meta.random);
  const rand = createRandomEnemy({ rng: lcg, level: 1, depth: 1, tier: 'normal' });
  t('D4 随机怪有 random 标记', rand.meta.random === true);
  t('D4b 随机怪技能表非空（借用模板）', rand.skills.length >= 1);
  const bad = createRandomEnemy({ rng: lcg, level: 1, depth: 1, tier: 'xxx' });
  t('D5 非法 tier 容错（回退 normal）', bad.meta.tier === 'normal' && bad.unit.mp === 0);
  const b = createRandomEnemy({ rng: lcg, level: 1, depth: 1, tier: 'boss' });
  t('D6 Boss 随机怪继承狂暴机制（enragePct 0.5）', b.meta.enragePct === 0.5, `v=${b.meta.enragePct}`);
  t('D7 Boss 无 MP 语义（MP 已删，mp 显式 0）', b.unit.mp === 0 && b.unit.maxMp === 0);
  // 随机精英机制继承（F3 关键保留点）：恒定 rng 挑中指定模板验证
  //   rng=0.6 → elite pool[floor(0.6×4)]=e09 瘟疫祭司（dotImmune）
  const priest = createRandomEnemy({ rng: constRng(0.6), level: 3, depth: 1, tier: 'elite' });
  t('D8 随机精英继承 dot 免疫（挑中瘟疫祭司）', priest.meta.dotImmune === true && priest.unit.dotImmune === true, priest.unit.name);
  //   rng=0.8 → elite pool[floor(0.8×4)]=e10 虚空猎手（吸血 e10_vamp）
  const hunter = createRandomEnemy({ rng: constRng(0.8), level: 3, depth: 1, tier: 'elite' });
  t('D9 随机精英继承吸血技能（挑中虚空猎手）', hunter.skills.some((s) => s.id === 'en_虚空噬咬'), hunter.skills.map((s) => s.id).join());
}

console.log('== F. 越界 rng 防御（病理注入） ==');
{
  // rng()=1.0：索引 clamp 到池末，不得 undefined/越界
  const hi = createRandomEnemy({ rng: () => 1.0, level: 3, depth: 1, tier: 'normal' });
  t('F1 rng=1.0 名字非 undefined', !hi.unit.name.includes('undefined'), hi.unit.name);
  t('F2 rng=1.0 浮动被 clamp（≤1.15 倍上限）', hi.unit.hp <= Math.round(95 * Math.pow(3, 1.15) * 1.15) + 1, `hp=${hi.unit.hp}`);
  // rng()=5：同样 clamp
  const wild = createRandomEnemy({ rng: () => 5, level: 3, depth: 1, tier: 'normal' });
  t('F3 rng=5 不越界（模板名/随机名均有效）', !wild.unit.name.includes('undefined') && wild.unit.hp > 0, wild.unit.name);
  t('F4 rng=5 Boss 仍是守卫者头衔且数值在 Boss 标尺', (() => {
    const b = createRandomEnemy({ rng: () => 5, level: 1, depth: 1, tier: 'boss' });
    return b.unit.name.includes('守卫者') && b.unit.hp >= 310 * 0.85 && b.unit.hp <= 330 * 1.15;
  })());
}

console.log('== E. buildEncounters 集成 ==');
{
  // 图生成用 LCG（正常），buildEncounters 前替换为恒定 rng 控制分支
  const area = new Area({ rng: lcg, depth: 1, areaIndex: 0 });
  area.rng = constRng(0.1); // 低值 → 随机怪分支（rng<0.3）
  const combat = area.buildEncounters({ type: 'combat' });
  t('E1 低 rng 出随机怪（meta.random）', combat[0].meta.random === true, combat[0].unit.name);
  const area2 = new Area({ rng: lcg, depth: 1, areaIndex: 0 });
  area2.rng = constRng(0.9); // 高值 → 模板分支
  const combat2 = area2.buildEncounters({ type: 'combat' });
  t('E2 高 rng 出模板怪（无 random 标记）', !combat2[0].meta.random, combat2[0].unit.name);
  // 精英节点：高 rng 出模板精英
  const area3 = new Area({ rng: lcg, depth: 1, areaIndex: 0 });
  area3.rng = constRng(0.9);
  const elite = area3.buildEncounters({ type: 'elite' });
  t('E3 高 rng 精英节点出模板精英', elite[0].meta.tier === 'elite' && !elite[0].meta.random);
  // Boss 出口：随机 Boss + 守卫者头衔
  const bossArea = new Area({ rng: lcg, depth: 2, areaIndex: AREAS_PER_RUN - 1 });
  bossArea.rng = constRng(0.1);
  const bossEnc = bossArea.buildEncounters({ type: 'exit_boss' });
  t('E4 险路恶敌为随机 Boss（守卫者头衔）', bossEnc.length === 1 && bossEnc[0].meta.tier === 'boss' && bossEnc[0].unit.name.includes('守卫者'), bossEnc[0].unit.name);
}

console.log('== G. ENEMY_SKILLS 数据校验（终检 F19：数据层唯一无护栏点）==');
{
  const ids = new Set();
  const names = new Set();
  let bad = 0;
  for (const [id, sk] of Object.entries(ENEMY_SKILLS)) {
    if (id !== sk.id) bad++;
    if (ids.has(id)) bad++;
    ids.add(id);
    if (names.has(sk.name)) bad++;
    names.add(sk.name);
    if (![1, 3, 6].includes(sk.reqLv)) bad++; // reqLv 门槛仅 1/3/6
    if (!['main', 'instant', 'buff', 'dot', 'debuff'].includes(sk.type)) bad++;
    if (!Number.isFinite(sk.dmgMult) || sk.dmgMult < 0) bad++;
    if (!Number.isFinite(sk.priority)) bad++;
    for (const e of sk.effects || []) {
      if (!e || typeof e !== 'object' || typeof e.type !== 'string') { bad++; continue; }
      const known = ['dot', 'buff', 'heal', 'vuln', 'multi_hit', 'maxhp_dmg', 'lost_hp_dmg', 'atk_down', 'haste_down', 'heal_cut'];
      if (!known.includes(e.type)) bad++;
    }
  }
  t('G1 ENEMY_SKILLS 40 个：id/名字唯一、reqLv∈{1,3,6}、类型/效果类型合法', ids.size === 40 && bad === 0, `n=${ids.size} bad=${bad}`);
  // reqLv 分界（终检 F17）：Lv2 无 reqLv3、Lv3 有 reqLv3、Lv5 无 reqLv6、Lv6 有 reqLv6
  const lv2 = createEnemy('e11', 2).skills;
  const lv3 = createEnemy('e11', 3).skills;
  const lv5 = createEnemy('e11', 5).skills;
  const lv6 = createEnemy('e11', 6).skills;
  t('G2 reqLv 分界：Lv2 无 reqLv3 / Lv3 含 reqLv3 / Lv5 无 reqLv6 / Lv6 含 reqLv6',
    lv2.every((x) => x.reqLv <= 1) && lv3.some((x) => x.reqLv === 3) && lv5.every((x) => x.reqLv <= 3) && lv6.some((x) => x.reqLv === 6),
    `lv2=${lv2.length} lv3=${lv3.length} lv5=${lv5.length} lv6=${lv6.length}`);
}


console.log(`\n========== test_enemies 结果：${pass} 通过 / ${fail} 失败 ==========`);
if (fail) process.exit(1);
