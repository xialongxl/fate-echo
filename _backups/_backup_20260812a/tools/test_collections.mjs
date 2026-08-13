// ============================================================
// tools/test_collections.mjs — 收藏品系统测试（Fate_echo 2026-08-11）
// 验证（用户定案）：局内作用域（存档跟随）、8 种收藏品（属性 4 + 功能 4）、
//   战后掉落 15/30/50%（排除已拥有）、商店统一 400 金随机 2 件未拥有、
//   collectionBonus 汇总、效果接入
// 用法: node tools/test_collections.mjs
// ============================================================

import {
  COLLECTIONS, COLLECTION_PRICE, COLLECTION_DROP_RATE, collectionById, collectionBonus,
  rollCollectionDrop, shopCollectionStock, ownedSet,
} from '../js/collections.js';
import { makeBattlePlayer } from '../js/progression.js';
import { goldBonusRate } from '../js/atm.js';

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

const constRng = (v) => () => v;
const mkPlayer = (cols = []) => ({ collections: cols });

console.log('== A. 表完整性 ==');
{
  t('A1 8 种收藏品（属性 4 + 功能 4）', COLLECTIONS.length === 8 && COLLECTIONS.filter((c) => ['atk', 'hp', 'crit', 'versa'].includes(c.type)).length === 4 && COLLECTIONS.filter((c) => ['gold', 'quality', 'shop', 'heal'].includes(c.type)).length === 4);
  t('A2 id 无重复', new Set(COLLECTIONS.map((c) => c.id)).size === COLLECTIONS.length);
  t('A3 名称/描述完整', COLLECTIONS.every((c) => c.name.length > 0 && c.desc.length > 0));
  t('A4 售价统一 400', COLLECTION_PRICE === 400);
  t('A5 掉落概率 15/30/50%', COLLECTION_DROP_RATE.normal === 0.15 && COLLECTION_DROP_RATE.elite === 0.3 && COLLECTION_DROP_RATE.boss === 0.5);
  t('A6 collectionById 查表', collectionById('col_atk').name === '强攻印记' && collectionById('nope') === null);
}

console.log('== B. collectionBonus 汇总 ==');
{
  const b0 = collectionBonus(mkPlayer([]));
  t('B1 无收藏品：全零/无折扣', b0.atk_pct === 0 && b0.hp_pct === 0 && b0.crit === 0 && b0.versa === 0 && b0.gold_pct === 0 && b0.quality === 0 && b0.shop_discount === 1 && b0.heal_pct === 0);
  const all = collectionBonus(mkPlayer(COLLECTIONS.map((c) => c.id)));
  t('B2 全收集：atk+10/hp+20/crit+5/versa+10/gold+25/quality+1/折扣 0.9/治疗+50', all.atk_pct === 10 && all.hp_pct === 20 && all.crit === 5 && all.versa === 10 && all.gold_pct === 25 && all.quality === 1 && Math.abs(all.shop_discount - 0.9) < 1e-9 && all.heal_pct === 50);
  const partial = collectionBonus(mkPlayer(['col_atk', 'col_shop']));
  t('B3 部分收集：atk+10 + 折扣 0.9，其余 0', partial.atk_pct === 10 && partial.gold_pct === 0 && Math.abs(partial.shop_discount - 0.9) < 1e-9 && partial.hp_pct === 0);
  t('B4 畸形 player 容错（null/无 collections）', collectionBonus(null).atk_pct === 0 && collectionBonus({}).gold_pct === 0 && ownedSet(null).size === 0);
}

console.log('== C. rollCollectionDrop（战后掉落） ==');
{
  const p = mkPlayer([]);
  // rng=0：必然命中（< rate）→ 掉落池第 0 件
  const drop = rollCollectionDrop(constRng(0), 'normal', p);
  t('C1 rng=0 必然掉落（普通 15%）', !!drop && COLLECTIONS.includes(drop));
  // rng=0.2：> 0.15 不命中；< 0.3 精英命中
  t('C2 概率边界（普通 0.2 不命中 / 精英 0.2 命中）', rollCollectionDrop(constRng(0.2), 'normal', p) === null && !!rollCollectionDrop(constRng(0.2), 'elite', p));
  // 排除已拥有：全拥有 → null
  const full = mkPlayer(COLLECTIONS.map((c) => c.id));
  t('C3 全拥有不再掉落', rollCollectionDrop(constRng(0), 'boss', full) === null);
  // 排除已拥有：拥有 col_atk 后不会掉 col_atk
  const some = mkPlayer(['col_atk']);
  const seen = new Set();
  for (let i = 0; i < 50; i++) {
    const c = rollCollectionDrop(constRng(0), 'boss', some);
    if (c) seen.add(c.id);
  }
  t('C4 已拥有排除（col_atk 不再出现）', !seen.has('col_atk') && seen.size > 0);
  // 未知 tier 容错（回退 normal 概率）
  t('C5 未知 tier 回退 normal（0.2 不命中）', rollCollectionDrop(constRng(0.2), 'xxx', p) === null);
}

console.log('== D. shopCollectionStock（商店供给） ==');
{
  const p = mkPlayer([]);
  // rng=0 → 池前 2 件
  const st = shopCollectionStock(constRng(0), p);
  t('D1 随机 2 件未拥有', st.length === 2 && COLLECTIONS.includes(st[0]) && st[0].id !== st[1].id);
  const full = mkPlayer(COLLECTIONS.map((c) => c.id));
  t('D2 全拥有 → 空（不出售区）', shopCollectionStock(constRng(0), full).length === 0);
  const some = mkPlayer(['col_atk']);
  const st2 = shopCollectionStock(constRng(0), some);
  t('D3 排除已拥有（col_atk 不在售）', st2.every((c) => c.id !== 'col_atk'));
  // 多件时仍 2 件
  const st3 = shopCollectionStock(constRng(0.5), mkPlayer(['col_atk', 'col_hp', 'col_crit', 'col_versa', 'col_gold']));
  t('D4 剩余 3 件时出 2 件且不重复', st3.length === 2 && new Set(st3.map((c) => c.id)).size === 2);
}

console.log('== E. 集成：makeBattlePlayer 加成 / 种子确定性 / 金币乘算 ==');
{
  const empty = { weapon: null, head: null, chest: null, legs: null, feet: null, pendant: null, ring: null, trinket: null };
  const base = makeBattlePlayer({ player: { level: 1, equipment: empty, collections: [] } });
  const buffed = makeBattlePlayer({ player: { level: 1, equipment: empty, collections: ['col_atk', 'col_hp', 'col_crit', 'col_versa'] } });
  t('E1 强攻印记：攻击 +10%（10→11）', buffed.unit.atk === 11, `atk=${buffed.unit.atk}`);
  t('E2 生命之种：最大生命 +20%（100→120）', buffed.unit.maxHp === 120);
  t('E3 锐利之眼：暴击 +5%（5%→10%）', Math.abs(buffed.unit.totalCritChance() - 0.1) < 1e-9);
  t('E4 共鸣之石：共鸣 +10% 永久增伤', Math.abs(buffed.unit.dmgMultiplier() - 1.1) < 1e-9);
  t('E5 无收藏品无加成', base.unit.atk === 10 && base.unit.maxHp === 100);
  // 金币乘算（金酒之杯 1.1 × 金币护符 1.25）
  const goldCalc = Math.round(30 * goldBonusRate(250) * (1 + collectionBonus(mkPlayer(['col_gold'])).gold_pct / 100));
  t('E6 金币乘算：30 × 1.1 × 1.25 = 41', goldCalc === 41, `v=${goldCalc}`);
  // 种子确定性（同 seed 的 battleRng 序列一致——种子防 SL 基础；与 main.js seededRng 同 LCG）
  const seeded = (seed) => { let s = (seed >>> 0) || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
  const seqA = [], seqB = [];
  const rngA = seeded(42), rngB = seeded(42);
  for (let i = 0; i < 6; i++) { seqA.push(rngA()); seqB.push(rngB()); }
  t('E7 同种子 rng 序列一致（读档重战斗掉落不变）', JSON.stringify(seqA) === JSON.stringify(seqB));
  // 同场多敌收藏品掉落不重复（后判定排除前者；模拟 main.js：掉落即 push）
  const p = mkPlayer([]);
  const drops = new Set();
  for (let i = 0; i < 20; i++) {
    const c = rollCollectionDrop(constRng(0), 'boss', p);
    if (c) { drops.add(c.id); p.collections.push(c.id); }
  }
  t('E8 20 次掉落不重复（每判定排除已拥有，8 种收齐后不再掉）', drops.size === 8, `n=${drops.size}`);
}

console.log(`\n========== test_collections 结果：${pass} 通过 / ${fail} 失败 ==========`);
if (fail) process.exit(1);
