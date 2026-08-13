// ============================================================
// js/main.js — 游戏主循环（Fate_echo Phase 4 v2，黑流树海式平面节点网络）
// 探索：平面节点网络图（节点+通路边，入口→沿通路探索→出口），迷雾揭示、
//   可达白光圈、点位一次性、死路原路返回；每轮 3 区域（普通→普通→Boss）
// 地图：内嵌小地图组件（AreaMapView，固定视口可平移缩放）；
//   点击当前节点 → 确认层 → 进入（空格直进保留，DESIGN_NOTES 第 1 条）
// 结算（方案 3，DESIGN_NOTES 第 3+5 条）：胜利 → 经验/金币/篝火全选自动入账
//   + 装备 3 件候选手动 3 选 1（红装 1%+大保底，仅战斗掉落）；结算居中
//   overlay（第 2 条）；种子防 SL（battleSeed 战斗前落盘，读档重战斗掉落不变）
// 视图状态机：'overworld'（地图/面板）| 'battle'
//   overworld 下 owMode：'select'（地图）| 'panel'（面板/结算）
// ============================================================

import { CombatEngine } from './engine.js';
import { BattleUI, OverworldUI } from './ui.js';
import { AreaMapView } from './area_map.js';
import { autoLoopTurn } from './autoloop.js';
import { makeBattlePlayer, grantExp, playerStatsAt, unlockedSkillData } from './progression.js';
import { rollDropChoices, rollGacha, lootGear, equipFromInventory, unequip, salvageGear, enhanceGear, rollEquipment, GEAR_RARITY, SLOT_NAMES, GACHA_COST, ENHANCE_MAX, LootFilter, sockOrb, unsocketOrb, refineAffix, redChancePctFor, redPityAfter } from './equipment.js';
import { createSaveStore, sanitizeSave, saveToSlot, loadSlot, listSlots, createAutoSaver, AUTO_SLOT, MANUAL_SLOTS, getStorageInfo, clearAllGameData, requestPersistentStorage, exportAllJSON, importAllJSON, getStatistic, updateStatistic, getSetting, setSetting } from './save.js';
import { Area, AREAS_PER_RUN } from './area.js';
import { rollEvent, resolveEvent } from './events.js';
import { canWithdraw, discountRate, stockCount, goldBonusRate } from './atm.js';
import { COLLECTION_PRICE, collectionBonus, rollCollectionDrop, shopCollectionStock } from './collections.js';

const SETTINGS_KEY = 'fate_echo:settings';
const INSTANT_KEYS = ['q', 'e', 'r', 't'];
// 战斗奖励（§4.3 初稿 ⚠️ 待平衡）：经验 = 100×1.035^敌等级；金币按 tier
const REWARDS = { expBase: 100, goldByTier: { normal: 30, elite: 70, boss: 200 } };
const REST_HEAL_PCT = 0.4;

let rng = Math.random; // 统一随机源（测试可注入 setRng）
let battleRng = null;  // 战斗掉落随机源（种子防 SL：battleSeed 派生，读档重战斗结果不变）
let atmTotalCache = 0; // 历史累计投资额缓存（settings 表全局；战斗/出口结算同步用，启动与 ATM 操作时更新）
let engine = null;
let battleUI = null;
let owUI = null;
let ai = null;
let autoMode = false;
let view = 'overworld';
let owMode = 'select'; // overworld 子状态：'select'（地图）| 'panel'（面板/结算）

// ---- 游戏状态（存档结构，save.js 白名单） ----
let game = null;   // gameState
let area = null;   // Area 实例（网状探索区）
let mapView = null; // AreaMapView（内嵌小地图）
let store = null;
let autoSaver = null;
let gameover = false;

// 设置读写
const settings = {
  aiLearning: true,
  load() {
    try {
      const raw = globalThis.localStorage && localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (typeof data.aiLearning === 'boolean') this.aiLearning = data.aiLearning;
      }
    } catch { /* 损坏设置回默认 */ }
  },
  save() {
    try {
      if (globalThis.localStorage) localStorage.setItem(SETTINGS_KEY, JSON.stringify({ aiLearning: this.aiLearning }));
    } catch { /* 存储不可用忽略 */ }
  },
};

// 加载 SmartAI（TF.js CDN 不可达 → null，回退启发式）
async function loadAI() {
  try {
    const { createSmartAI } = await import('./smartai.js');
    ai = createSmartAI();
    await ai.load();
  } catch (err) {
    console.warn('SmartAI 加载失败，回退启发式 AI:', err);
    ai = null;
  }
}

// ---- 视图切换 ----
function showView(v) {
  view = v;
  const battle = document.getElementById('battle-area');
  const action = document.getElementById('action-area');
  const log = document.getElementById('log-area');
  const ow = document.getElementById('overworld');
  const inBattle = v === 'battle';
  battle.hidden = !inBattle;
  action.hidden = !inBattle;
  log.hidden = !inBattle;
  ow.hidden = inBattle;
  if (inBattle && battleUI) battleUI.render();
}

// ---- 拆除进行中的战斗 ----
function teardownBattle() {
  if (battleUI) { battleUI.destroy(); battleUI = null; }
  engine = null;
  autoMode = false;
  window.engine = null;
  const modeEl = document.getElementById('mode-el');
  if (modeEl) { modeEl.textContent = '手动'; modeEl.classList.remove('auto'); }
}

// ---- 新游戏 / 读档 ----
function newGame() {
  teardownBattle();
  game = sanitizeSave(null);
  game.player.hp = playerStatsAt(1).hp;
  game.player.mp = playerStatsAt(1).mp;
  area = new Area({ rng, depth: 1, areaIndex: 0 });
  gameover = false;
  showView('overworld');
  enterArea();
}

async function continueGame() {
  teardownBattle();
  const saved = await loadSlot(store, AUTO_SLOT);
  if (!saved) { newGame(); return; }
  game = saved;
  area = restoreArea(saved);
  gameover = false;
  showView('overworld');
  enterArea();
}

// 从存档恢复区域（v3 图结构；旧网格档 nodes 为空 → 重建新区，保留 depth/areaIndex）
function restoreArea(saved) {
  const a = (saved && saved.area) || {};
  if (Array.isArray(a.nodes) && a.nodes.length) return Area.fromJSON(a);
  return new Area({ rng, depth: a.depth || (saved && saved.tower && saved.tower.depth) || 1, areaIndex: a.areaIndex || 0 });
}

// 存档点（防抖自动存档；战斗胜利等节点 flush 立即落盘）
function persist() {
  if (game && area && autoSaver) autoSaver.markDirty({ ...game, area: area.toJSON() });
}
// 立即落盘（永恒 saveNow 语义：直接保存当前状态，不依赖脏标记——
//   修复：战斗结束/奖励选择时 dirty 可能为空，旧 flush 会丢失保存）
function persistNow() {
  if (game && area && autoSaver) return autoSaver.flush({ ...game, area: area.toJSON() });
}

// ---- 区域地图 ----
function enterArea() {
  owMode = 'select'; // 回到地图选关模式（读档/推进后面板状态复位）
  if (owUI) { owUI.closeResultOverlay(); owUI.closeNodeConfirm(); } // 结算/确认层随返回地图关闭
  renderArea();
  persist();
}

// ---- 种子随机源（LCG；种子防 SL：battleSeed 固定 → 读档重战斗掉落结果不变） ----
function seededRng(seed) {
  let s = (Number(seed) >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// 层数（黑流树海一致：每张探索图 = 1 层，全局递增）
function floorNum() {
  return (area.depth - 1) * AREAS_PER_RUN + area.areaIndex + 1;
}

// 红装概率（方案 3）：纯函数 redChancePctFor（equipment.js）——1% 基础、100 层后 3%、
//   未凑齐一套红 +2%、+ pity 累计；层数 = 每张探索图 1 层（黑流树海一致）
function redChanceFor() {
  return redChancePctFor(game.player, floorNum());
}

function renderArea() {
  // 统一关闭结算/确认层/交互面板（覆盖所有"返回地图"直返路径——防止 overlay 残留
  //   遮屏卡死；enterArea/moveTo/onLeave/onDone 都会走到这里）
  if (owUI) { owUI.closeResultOverlay(); owUI.closeNodeConfirm(); owUI.closePanel(); }
  mapView.render(area);
  document.getElementById('phase-el').textContent = gameover
    ? '💀 已倒下'
    : `${area.isBossArea ? '⚔ Boss 区' : `探索区 ${area.areaIndex + 1}/${AREAS_PER_RUN}`} · 第 ${area.depth} 轮`;
  document.getElementById('phase-el').style.color = gameover ? 'var(--damage)' : 'var(--accent)';
  renderOverworldPanels();
}

// 玩家/装备栏/区域信息面板（复用 OverworldUI）
function renderOverworldPanels() {
  owUI.renderTower(game, area);
  // 终焉精炼入口显隐（照抄末光：获得首件终焉装备后显示——finaleCollection 任一槽 true）
  const btnRefine = document.getElementById('btn-refine');
  if (btnRefine) {
    const fc = (game.player && game.player.finaleCollection) || {};
    btnRefine.style.display = Object.values(fc).some(Boolean) ? '' : 'none';
  }
}

// ---- 移动与进入（黑流树海：点击可达节点沿通路移动；移动到节点即须进入） ----
function moveTo(nodeId) {
  if (gameover || owMode !== 'select') return;
  const cur = area.current();
  // 黑流树海机制（PRTS wiki 核实）：到达节点即触发内容——当前节点未结算（未进入）
  //   时不可离开；林间空地（empty，含入口）与出口（exit/exit_rare 为终点选择）豁免
  if (cur && !cur.cleared && !['empty', 'exit', 'exit_rare'].includes(cur.type)) {
    if (owUI) owUI.toast('须先进入当前节点，才能继续探索');
    return;
  }
  if (!area.moveTo(nodeId)) return;
  renderArea();
  if (mapView) mapView.follow(); // 摄像头跟随玩家（保持当前缩放）
  persist();
}

function enterCurrent() {
  if (gameover || owMode !== 'select') return;
  const node = area.current();
  if (!node) return;
  // 黑流树海：节点完成即变"林间空地"——已结算节点不可二次进入（防刷资源）
  if (node.cleared) return;
  if (node.type === 'combat' || node.type === 'elite' || node.type === 'exit_boss') { startBattle(); }
  else if (node.type === 'exit' || node.type === 'exit_rare') openExit();
  else if (node.type === 'event') openEvent();
  else if (node.type === 'rest') doRest();
  else if (node.type === 'shop') openShop();
  else if (node.type === 'gacha') openGacha();
  else if (node.type === 'empty') { /* 林间空地：原地停留 */ }
}

// 节点进入确认层（DESIGN_NOTES 第 1 条：黑流树海式 点击当前节点 → 确认 → 进入；
//   空格仍直接进入）。林间空地无内容，不弹确认层。
function openNodeConfirm() {
  if (gameover || owMode !== 'select') return;
  const node = area.current();
  // 林间空地无内容不弹；已结算节点不可二次进入（黑流树海：完成即变空地）不弹
  if (!node || node.type === 'empty' || node.cleared) return;
  owMode = 'panel';
  owUI.renderNodeConfirm(node, floorNum());
  owUI.handlers.onNodeConfirmEnter = () => {
    owUI.closeNodeConfirm();
    owMode = 'select';
    enterCurrent();
  };
  owUI.handlers.onNodeConfirmCancel = () => {
    owUI.closeNodeConfirm();
    owMode = 'select';
    renderArea();
  };
}

// 掉落入账行（末光 lootItem 闭环：过滤→自动穿→入包→图鉴日志）
function lootLine(gear, r) {
  if (r.action === 'salvaged') {
    return `♻️ 自动熔炼【${gear.name}】（${GEAR_RARITY[gear.rarityIdx].name}）→ +${r.gold} 金${gear.rarityIdx === 8 ? '，+1 终焉精华' : ''}`;
  }
  const base = r.action === 'equipped'
    ? `✨ ${r.replaced ? '自动替换' : '自动穿戴'}【${gear.name}】（${GEAR_RARITY[gear.rarityIdx].name}）评分 ${gear.score}${r.replaced ? '，旧装备回背包' : ''}`
    : `📦 掉落【${gear.name}】（${GEAR_RARITY[gear.rarityIdx].name}）评分 ${gear.score}，已入背包`;
  return r.collection ? `${base} 📖 终焉图鉴更新：收集到【${SLOT_NAMES[gear.slot]}】` : base;
}

// ---- 战斗 ----
function startBattle() {
  if (battleUI) battleUI.destroy();
  // 种子防 SL：battleSeed 已有（读档回战斗前）复用，否则新生成；掉落用派生种子 rng。
  // 生成后立即落盘——否则"读档回战斗前"的存档永远带 battleSeed=null，复用分支
  // 永不命中，SL 可重roll掉落（设计审查发现 1 修复）
  if (!Number.isFinite(game.player.battleSeed) || game.player.battleSeed === null) {
    game.player.battleSeed = Math.floor(Math.random() * 0x7fffffff);
  }
  battleRng = seededRng(game.player.battleSeed);
  persistNow(); // 战斗种子随战斗前存档点落盘（胜利后置 null 再落盘，读档重战斗掉落一致）
  const { unit: playerUnit, skills } = makeBattlePlayer(game);
  const maxHp = playerUnit.maxHp;
  playerUnit.hp = Math.min(maxHp, Math.max(1, game.player.hp));
  playerUnit.mp = Math.min(playerStatsAt(game.player.level).mp, Math.max(0, game.player.mp));
  const cell = area.current();
  const enemies = area.buildEncounters(cell);
  engine = new CombatEngine({
    player: { unit: playerUnit, skills },
    enemies,
    ai: settings.aiLearning ? ai : null,
    rng,
  });
  engine.on('end', (r) => onBattleEnd(r));
  engine.on('turn', () => { if (autoMode && engine.phase === 'player') runAutoTurn(); });
  engine.startTurn();

  battleUI = new BattleUI(engine, {
    phaseEl: document.getElementById('phase-el'),
    enemyPanel: document.getElementById('enemy-panel'),
    playerPanel: document.getElementById('player-panel'),
    resourceBar: document.getElementById('resource-bar'),
    skillBar: document.getElementById('skill-bar'),
    toast: document.getElementById('toast'),
    logEl: document.getElementById('log'),
    modeEl: document.getElementById('mode-el'),
  });
  battleUI.setMode(autoMode);
  document.getElementById('log').innerHTML = '';
  showView('battle');
  window.engine = engine;
}

function eqHpBonus() {
  return 0; // v3 装备无 hp 属性（末光照抄：生命由等级+宝珠+图鉴加成）；保留函数防旧引用
}

// ---- 战斗结算（方案 3：经验/金币/篝火全选自动入账 + 装备 3 件候选手动 3 选 1） ----
function onBattleEnd({ result }) {
  game.player.hp = engine.player.hp;
  game.player.mp = engine.player.mp;
  if (ai && settings.aiLearning) ai.save().catch((err) => console.warn('SmartAI 保存失败:', err));

  // 战斗统计（永恒 statistics 表照抄：战斗/胜负/击杀/金币/掉落）
  updateStatistic(store, 'battles', 1);

  if (result === 'victory') {
    const node = area.current();
    area.clearCurrent();
    // Boss 出口（险路恶敌）胜利 → 结算后推进；普通点位胜利 → 立即落盘
    const isBossExit = node.type === 'exit_boss';
    // 经验/金币全选（自动入账）
    let exp = 0, gold = 0;
    engine.enemies.forEach((e, i) => {
      const tier = (engine.enemyMetas[i] && engine.enemyMetas[i].tier) || 'normal';
      exp += Math.round(REWARDS.expBase * Math.pow(1.035, e.level));
      gold += REWARDS.goldByTier[tier] || 25;
    });
    // 金币加成：金酒之杯（250 投资累计）+10% × 收藏品【金币护符】+25%（乘算）
    const colBonus = collectionBonus(game.player);
    gold = Math.round(gold * goldBonusRate(atmTotalCache) * (1 + colBonus.gold_pct / 100));
    const up = grantExp(game.player, exp);
    game.player.gold += gold;
    // 篝火全选：自动恢复 30% 最大生命（收藏品【治疗之泉】+50% → 45%）
    const maxHp = makeBattlePlayer(game).unit.maxHp;
    const healed = Math.round(maxHp * 0.3 * (1 + colBonus.heal_pct / 100));
    game.player.hp = Math.min(maxHp, game.player.hp + healed);
    // 掉落候选（方案 3：每场 3 件 3 选 1；红装保底曲线；Boss 战史诗保底；
    //   收藏品【寻宝罗盘】品质下限 +1 档）
    const bossTier = engine.enemies.some((e, i) => ((engine.enemyMetas[i] && engine.enemyMetas[i].tier) || 'normal') === 'boss');
    const redChance = redChanceFor();
    const baseMin = bossTier ? 4 : null;
    const minRarity = baseMin === null ? colBonus.quality : baseMin + colBonus.quality;
    const choices = rollDropChoices(battleRng, { floor: floorNum(), depth: area.depth, minRarity, redChancePct: redChance });
    // pity 更新（出红 = 候选含终焉 → 重置；否则每场 +0.5；纯函数 redPityAfter）
    game.player.redPity = redPityAfter(choices, game.player.redPity);
    // 收藏品掉落（局内；按敌人 tier 概率判定，battleRng 种子防 SL；排除已拥有）
    const collected = [];
    engine.enemies.forEach((e, i) => {
      const tier = (engine.enemyMetas[i] && engine.enemyMetas[i].tier) || 'normal';
      const c = rollCollectionDrop(battleRng, tier, game.player);
      if (c) { game.player.collections.push(c.id); collected.push(c); }
    });
    // 种子防 SL：战后清空种子（下一场新种子）；掉落结果随 persistNow 落盘
    game.player.battleSeed = null;
    updateStatistic(store, 'victories', 1);
    updateStatistic(store, 'kills', engine.enemies.filter((e) => !e.alive).length);
    updateStatistic(store, 'gold_earned', gold);
    updateStatistic(store, 'drops', choices.length);
    persistNow();
    const lines = [
      `经验 +${exp}，金币 +${gold}（自动入账）`,
      `🔥 篝火：恢复 ${healed} 生命（自动生效）`,
      `📜 战利品掉落 ${choices.length} 件候选（红装概率 ${redChance}%）——选择 1 件带走`,
    ];
    for (const c of collected) lines.push(`🏆 获得收藏品【${c.name}】：${c.desc}`);
    if (up.leveledUp) {
      lines.push(`🎉 升级！Lv.${game.player.level}（连升 ${up.levelsGained} 级，属性全面提升）`);
      game.player.hp = makeBattlePlayer(game).unit.maxHp;
      game.player.mp = playerStatsAt(game.player.level).mp;
    }
    if (isBossExit) lines.push(`🚪 出口打通！🏆 攻克 Boss 区，进入更深的第 ${area.depth + 1} 轮`);
    // 装备 3 选 1（方案 3：候选展示 + 手动选择）
    owMode = 'panel';
    showView('overworld');
    owUI.renderBattleResult(game, lines, choices);
    owUI.handlers.onReward = (idx) => {
      const c = choices[idx];
      const r = lootGear(game.player, c);
      const got = lootLine(c, r);
      persistNow();
      owUI.renderBattleResult(game, [...lines, `✨ 选择了「${c.name}」（${GEAR_RARITY[c.rarityIdx].name}）：${got}`], null);
    };
    owUI.handlers.onLeave = () => {
      if (isBossExit) { advanceArea(); enterArea(); }
      else { owMode = 'select'; renderArea(); }
    };
  } else {
    updateStatistic(store, 'defeats', 1);
    gameover = true;
    renderArea();
    owUI.renderGameover(game, area);
    showView('overworld');
  }
  window.engine = null;
}

// 区域推进：Boss 区出口通关 → depth+1 回第 1 区；普通区 → 下一区
function advanceArea() {
  if (area.isBossArea) {
    area = new Area({ rng, depth: area.depth + 1, areaIndex: 0 });
  } else {
    area = new Area({ rng, depth: area.depth, areaIndex: area.areaIndex + 1 });
  }
}

// ---- 出口通关结算（黑流树海：险路尽头/险路小径 = 安全出口，走到即通关） ----
// 金币/篝火自动入账 + 装备 3 件候选 3 选 1（方案 3）；险路小径（稀有出口）候选品质下限 4；
// 出口非战斗 → 不应用红装保底 pity（redChancePct=0 保持原品质曲线）
function openExit() {
  const node = area.current();
  const isRare = node.type === 'exit_rare';
  area.clearCurrent();
  const colBonus = collectionBonus(game.player);
  const goldReward = (isRare ? 80 : 40) * area.depth;
  // 金币加成：金酒之杯 × 收藏品【金币护符】（乘算）
  const goldIn = Math.round(goldReward * goldBonusRate(atmTotalCache) * (1 + colBonus.gold_pct / 100));
  game.player.gold += goldIn;
  // 篝火全选：自动恢复 30% 最大生命（收藏品【治疗之泉】+50% → 45%）
  const maxHp = makeBattlePlayer(game).unit.maxHp;
  const healed = Math.round(maxHp * 0.3 * (1 + colBonus.heal_pct / 100));
  game.player.hp = Math.min(maxHp, game.player.hp + healed);
  persistNow(); // 出口入账立即落盘（结算窗口内关页/崩溃不丢进度、不重走出口）
  const lines = [
    `🚪 抵达${isRare ? '险路小径' : '险路尽头'}：金币 +${goldIn}，篝火恢复 ${healed} 生命（自动入账）`,
    `📜 战利品候选 ${isRare ? '（稀有出口：史诗起步）' : ''}——选择 1 件带走`,
  ];
  lines.push(`🚪 出口打通！${area.isBossArea ? '🏆 攻克 Boss 区，进入更深的第 ' + (area.depth + 1) + ' 轮' : `进入探索区 ${area.areaIndex + 2}/${AREAS_PER_RUN}`}`);
  const choices = rollDropChoices(rng, { floor: floorNum(), depth: area.depth, minRarity: isRare ? 4 : null, redChancePct: 0 });
  owMode = 'panel';
  showView('overworld');
  owUI.renderBattleResult(game, lines, choices);
  owUI.handlers.onReward = (idx) => {
    const c = choices[idx];
    const r = lootGear(game.player, c);
    const got = lootLine(c, r);
    persistNow();
    owUI.renderBattleResult(game, [...lines, `✨ 选择了「${c.name}」（${GEAR_RARITY[c.rarityIdx].name}）：${got}`], null);
  };
  owUI.handlers.onLeave = () => { advanceArea(); enterArea(); };
}

// ---- 事件 ----
function openEvent() {
  const ev = rollEvent(rng);
  owMode = 'panel';
  owUI.renderEvent(game, ev);
  document.getElementById('phase-el').textContent = '❓ 事件';
  owUI.handlers.onOption = (optId) => {
    const lines = resolveEvent(game, ev.type, optId, { rng, maxHp: makeBattlePlayer(game).unit.maxHp });
    area.clearCurrent();
    persist();
    owUI.closePanel(); // 事件面板关闭 → 结算弹窗
    owUI.renderResult(game, lines, '返回地图', () => { owMode = 'select'; renderArea(); });
  };
}

// ---- 休息 ----
function doRest() {
  owMode = 'panel';
  const maxHp = makeBattlePlayer(game).unit.maxHp;
  // 收藏品【治疗之泉】：篝火恢复量 +50%（40% → 60%）
  const healed = Math.round(maxHp * REST_HEAL_PCT * (1 + collectionBonus(game.player).heal_pct / 100));
  game.player.hp = Math.min(maxHp, game.player.hp + healed);
  game.player.mp = playerStatsAt(game.player.level).mp;
  area.clearCurrent();
  persist();
  owUI.renderResult(game, [`篝火温暖了身体：恢复 ${healed} 生命，法力回满。`], '返回地图', () => { owMode = 'select'; renderArea(); });
}

// ---- 商店（含前瞻性投资系统 ATM 存款机，黑流树海蓝本） ----
const SHOP_PRICE_BASE = 40;

// 商店价格：基础价 × 投资折扣（50 累计后 9 折）× 收藏品【商人之契】（9 折，乘算）
function shopDiscount(atmTotal, player) {
  return discountRate(atmTotal) * (collectionBonus(player).shop_discount);
}
function shopPriceFor(gear, discount) {
  return Math.round((gear.rarityIdx + 1) * SHOP_PRICE_BASE * discount);
}

// ATM 数据快照（settings 表跨槽全局：余额 + 历史累计投资额）
async function atmSnapshot() {
  const balance = await getSetting(store, 'atm_balance', 0);
  const total = await getSetting(store, 'atm_total_deposited', 0);
  return { balance, total };
}

async function openShop() {
  // 先锁面板（await 窗口内不再响应空格/moveTo——与其余节点进入模式一致，审查 G1）
  owMode = 'panel';
  document.getElementById('phase-el').textContent = '🏪 商店';
  const minRarity = area.isBossArea ? 3 : area.areaIndex >= 1 ? 2 : 1;
  const atm = await atmSnapshot();
  atmTotalCache = atm.total; // 同步缓存（战斗/出口结算用）
  const count = stockCount(atm.total);
  const stock = Array.from({ length: count }, () => rollEquipment(rng, {
    floor: area.areaIndex + 1, depth: area.depth,
    forceRarity: Math.max(minRarity, weightedRarityForShop(rng)),
  }));
  // 价格函数引用可变折扣（存款跨过 9 折门槛后即时生效）——显示/实扣/重渲染共用同一函数
  const priceFn = (gear) => shopPriceFor(gear, shopDiscount(atm.total, game.player));
  // 收藏品售卖区：随机 2 件未拥有的（已全拥有 → 空数组不出售区）；价格统一 400
  let collectionStock = shopCollectionStock(rng, game.player);
  owUI.renderShop(game, stock, priceFn, atm, collectionStock);
  owUI.handlers.onBuy = (id) => {
    const gear = stock.find((g) => g.id === id);
    if (!gear || game.player.gold < priceFn(gear)) return;
    game.player.gold -= priceFn(gear);
    game.player.inventory.push(gear);
    persist();
    owUI.renderShop(game, stock, priceFn, atm, collectionStock);
    owUI.toast(`购入【${gear.name}】（已入背包）`);
  };
  // 收藏品购买（局内；价格统一 400——用户定案；已拥有不重复出售）
  owUI.handlers.onBuyCollection = (id) => {
    const c = collectionStock.find((x) => x.id === id);
    if (!c || game.player.gold < COLLECTION_PRICE) return;
    game.player.gold -= COLLECTION_PRICE;
    game.player.collections.push(c.id);
    persistNow();
    collectionStock = shopCollectionStock(rng, game.player); // 购买后重刷（排除已拥有）
    owUI.renderShop(game, stock, priceFn, atm, collectionStock);
    owUI.toast(`获得收藏品【${c.name}】：${c.desc}`);
  };
  // ATM 存款（前瞻性投资）：金币 → 全局余额；累计投资额只增不减（奖励判定依据）
  owUI.handlers.onDeposit = async (amount) => {
    if (game.player.gold < amount) return;
    game.player.gold -= amount;
    atm.balance += amount;
    atm.total += amount;
    atmTotalCache = atm.total;
    await setSetting(store, 'atm_balance', atm.balance);
    await setSetting(store, 'atm_total_deposited', atm.total);
    persistNow(); // 立即落盘（防 100ms 防抖窗口丢账，审查 S1）
    // 折扣即时生效（9 折存款后立即打折）；商品扩容下次进店生效（本店货架已固定）
    owUI.renderShop(game, stock, priceFn, atm, collectionStock);
    owUI.toast(`存入 ${amount} 金（余额 ${atm.balance}）`);
  };
  // ATM 取款（累计 15 解锁；1:1 无损——以撒捐款机"钱拿回来"语义）
  owUI.handlers.onWithdraw = async (amount) => {
    if (!canWithdraw(atm.total) || atm.balance < amount) return;
    atm.balance -= amount;
    game.player.gold += amount;
    await setSetting(store, 'atm_balance', atm.balance);
    persistNow(); // 立即落盘（审查 S1）
    owUI.renderShop(game, stock, priceFn, atm, collectionStock);
    owUI.toast(`取出 ${amount} 金（余额 ${atm.balance}）`);
  };
  owUI.handlers.onLeave = () => { area.clearCurrent(); persist(); owMode = 'select'; renderArea(); };
}
function weightedRarityForShop(rng) {
  const weights = [8, 20, 24, 18, 12, 8, 5, 3, 2];
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (let i = 0; i < weights.length; i++) { roll -= weights[i]; if (roll <= 0) return i; }
  return 0;
}

// ---- 抽卡节点 ----
function openGacha() {
  owMode = 'panel';
  owUI.renderGacha(game);
  document.getElementById('phase-el').textContent = '🎰 命运抽卡';
  owUI.handlers.onGacha = () => {
    if (game.player.gold < GACHA_COST) return;
    game.player.gold -= GACHA_COST;
    const eq = rollGacha(rng, { floor: area.areaIndex + 1, depth: area.depth });
    game.player.inventory.push(eq);
    persist();
    owUI.closePanel(); // 抽卡面板关闭 → 结果弹窗
    owUI.renderResult(game, [`抽取获得【${eq.name}】（${GEAR_RARITY[eq.rarityIdx].name}）评分 ${eq.score}！已入背包。`], '返回地图', () => { owMode = 'select'; renderArea(); });
  };
  owUI.handlers.onLeave = () => { area.clearCurrent(); persist(); owMode = 'select'; renderArea(); };
}

// ---- 自动循环（Tab） ----
function toggleAuto() {
  autoMode = !autoMode;
  if (battleUI) battleUI.setMode(autoMode);
  if (battleUI) battleUI.toast(autoMode ? '自动循环开启（Tab 切回手动）' : '已切回手动');
  if (autoMode && engine && engine.phase === 'player') runAutoTurn();
}
function runAutoTurn() {
  if (!autoMode || !engine || engine.phase !== 'player') return;
  setTimeout(() => {
    if (!autoMode || !engine || engine.phase !== 'player') return;
    autoLoopTurn(engine);
  }, 0);
}

// ---- 静态控件绑定 ----
document.getElementById('btn-restart').addEventListener('click', () => { newGame(); });
// 面板弹窗统一关闭（S1 修复：帮助等无内容关闭途径的面板不再软锁死）。
// 事件/商店/抽卡节点：关闭 = 放弃节点（结算为空地）——防"取消→重进"无成本
//   重刷事件/库存，与黑流树海"进入节点即触发、完成即变空地"机制一致；
// 存档/帮助（无节点语义）：仅关闭面板。
document.getElementById('panel-close').addEventListener('click', () => {
  const node = area && area.current();
  if (node && !node.cleared && ['event', 'shop', 'gacha'].includes(node.type)) {
    area.clearCurrent();
    persist();
  }
  if (owUI) owUI.closePanel();
  owMode = 'select';
  renderArea();
});
document.getElementById('btn-confirm').addEventListener('click', () => {
  if (engine && engine.phase === 'player') engine.confirm();
});
document.getElementById('btn-defend').addEventListener('click', () => {
  if (engine && engine.phase === 'player') engine.defend();
});
document.getElementById('btn-clear').addEventListener('click', () => {
  if (!engine) return;
  engine.clearPending();
  if (battleUI) battleUI.toast('已清空行动队列');
});
document.getElementById('btn-auto').addEventListener('click', toggleAuto);
document.getElementById('chk-ai').addEventListener('change', (e) => {
  settings.aiLearning = e.target.checked;
  settings.save();
  if (engine) engine.ai = settings.aiLearning ? ai : null;
  if (battleUI) {
    if (settings.aiLearning && !ai) battleUI.toast('SmartAI 不可用（TF.js 加载失败），保持启发式 AI');
    else battleUI.toast(settings.aiLearning ? '敌人 AI 学习已开启' : '敌人 AI 学习已关闭（退回启发式）');
  }
});
document.getElementById('btn-bag').addEventListener('click', () => { if (!gameover) openBag(); });
// 收藏品独立背包（2026-08-11：图鉴式展示 8 种收藏品及效果；战斗掉落/商店购买）
document.getElementById('btn-collections').addEventListener('click', () => { if (!gameover) openCollections(); });
// 局外技能配置（2026-08-11：勾选上阵技能，即时保存到 player.skillLoadout）
document.getElementById('btn-skills').addEventListener('click', () => { if (!gameover) openSkillConfig(); });
// 终焉精炼（背包外独立入口，照抄末光：角色页装备栏底栏按钮；获得首件终焉后显示）
document.getElementById('btn-refine').addEventListener('click', () => { if (!gameover) openRefine(); });
document.getElementById('btn-save').addEventListener('click', () => { if (!gameover) openSlots(); });
document.getElementById('btn-load').addEventListener('click', () => { if (!gameover) openSlots(); });
document.getElementById('btn-glossary').addEventListener('click', () => {
  if (gameover) return;
  openGlossary();
});

// 收藏品独立背包（纯展示：已拥有/未拥有 + 效果说明）
function openCollections() {
  owMode = 'panel';
  owUI.renderCollections(game);
  document.getElementById('phase-el').textContent = '🏺 收藏品';
  owUI.handlers.onLeave = () => { owMode = 'select'; renderArea(); };
}

// 局外技能配置（勾选切换即时保存；主技能 ≥1 守卫；上限 主 9/瞬发 4）
function openSkillConfig() {
  owMode = 'panel';
  owUI.renderSkillConfig(game);
  document.getElementById('phase-el').textContent = '⚙ 技能配置';
  owUI.handlers.onLeave = () => { owMode = 'select'; renderArea(); };
  owUI.handlers.onToggleSkill = (skillId, group) => {
    const p = game.player;
    // null（全部解锁）→ 转为显式全选（主技能可能超 9，与"全部解锁"现状行为一致）
    let lo = p.skillLoadout;
    if (!lo) {
      const unlocked = unlockedSkillData(p.level);
      lo = {
        main: unlocked.filter((s) => s.type !== 'ogcd' && s.type !== 'passive').map((s) => s.id),
        instant: unlocked.filter((s) => s.type === 'ogcd').map((s) => s.id),
      };
    }
    const list = group === 'main' ? lo.main : lo.instant;
    const max = group === 'main' ? 9 : 4;
    const idx = list.indexOf(skillId);
    if (idx >= 0) {
      if (group === 'main' && list.length <= 1) { // 至少保留 1 个主技能（防战斗无输出卡死）
        owUI.toast('至少保留 1 个主技能');
        return;
      }
      list.splice(idx, 1);
    } else {
      if (list.length >= max) { owUI.toast(`${group === 'main' ? '主技能' : '瞬发'}上阵上限 ${max} 个`); return; }
      list.push(skillId);
    }
    p.skillLoadout = { main: lo.main, instant: lo.instant };
    persist();
    owUI.renderSkillConfig(game); // 即时刷新（标题计数 + 行状态）
  };
  owUI.handlers.onResetLoadout = () => {
    game.player.skillLoadout = null; // 恢复默认：全部解锁技能上阵
    persist();
    owUI.toast('已恢复全部解锁（默认）');
    owUI.renderSkillConfig(game);
  };
}

// 术语表 + 游戏统计（永恒 statistics 表：战斗次数/胜利/击杀/金币/掉落）
async function openGlossary() {
  owMode = 'panel';
  const stats = {
    battles: await getStatistic(store, 'battles', 0),
    victories: await getStatistic(store, 'victories', 0),
    defeats: await getStatistic(store, 'defeats', 0),
    kills: await getStatistic(store, 'kills', 0),
    goldEarned: await getStatistic(store, 'gold_earned', 0),
    drops: await getStatistic(store, 'drops', 0),
  };
  owUI.renderGlossary(game, stats);
  document.getElementById('phase-el').textContent = '📖 术语表';
  owUI.handlers.onLeave = () => { owMode = 'select'; renderArea(); };
}
document.getElementById('btn-map-zoom-in').addEventListener('click', () => { if (mapView) mapView.zoom(1.25); });
document.getElementById('btn-map-zoom-out').addEventListener('click', () => { if (mapView) mapView.zoom(0.8); });
document.getElementById('btn-map-reset').addEventListener('click', () => { if (mapView) mapView.reset(); });
document.getElementById('enhance-close').addEventListener('click', () => { owUI.closeEnhanceView(); owMode = 'select'; renderArea(); });
document.getElementById('refine-close').addEventListener('click', () => { owUI.closeRefineView(); owMode = 'select'; renderArea(); });

// ---- 独立背包 Modal（末光咏叹 terminal 照抄） ----
function openBag(filterSlot = null) {
  owMode = 'panel';
  owUI.openBackpack(game, { filterSlot });
  document.getElementById('phase-el').textContent = filterSlot ? `🎒 装备选取` : '🎒 背包';
}

// 查找装备（背包或装备栏）
function findGear(id) {
  return game.player.inventory.find((g) => g.id === id) || Object.values(game.player.equipment || {}).find((g) => g && g.id === id);
}

// 锁定切换（末光 toggleLock：防误卖/分解；批量分解时禁选）
function toggleLock(id) {
  const gear = findGear(id);
  if (!gear) return;
  gear.locked = !gear.locked;
  persist();
  if (owUI.bagState) owUI._renderBackpack();
}
// 防换锁（末光 togglePin：上锁时自动 locked；解锁时终焉装备保持 locked）
function togglePin(id) {
  const gear = findGear(id);
  if (!gear) return;
  gear.pinned = !gear.pinned;
  if (gear.pinned) gear.locked = true;
  else if (gear.rarityIdx !== 8) gear.locked = false;
  persist();
  if (owUI.bagState) owUI._renderBackpack();
}

// ---- 独立强化锻造弹窗（末光 openEnhanceView 照抄） ----
function openEnhance(gearId = null) {
  owMode = 'panel';
  owUI.openEnhanceView(game, gearId);
  document.getElementById('phase-el').textContent = '⚒ 强化锻造台';
}

// 强化（单次/批量 x5/x10/xMAX；末光 doEnhance/batchEnhance 照抄）
function doEnhance(id, x = '1') {
  const gear = findGear(id);
  if (!gear) return;
  const maxTimes = x === 'max' ? ENHANCE_MAX - gear.enhanceLv : Number(x);
  let count = 0, successes = 0;
  for (let i = 0; i < maxTimes; i++) {
    const r = enhanceGear(game.player, id, rng);
    if (!r.ok) break;
    count++;
    if (r.success) successes++;
  }
  persist();
  if (owUI.enhanceState) owUI.openEnhanceView(game, id);
  owUI.toast(count ? (x === '1' ? (successes ? `强化成功！+${gear.enhanceLv}` : '强化失败') : `强化 ×${count}：成功 ${successes} 次`) : '金币不足或已达上限');
}

// ---- 终焉精炼弹窗（末光 refine-overlay 照抄） ----
function openRefine(gearId = null) {
  owMode = 'panel';
  owUI.openRefineView(game);
  document.getElementById('phase-el').textContent = '✨ 终焉精炼';
}

// ---- 批量分解（末光 enterBatchMode/batchDoSalvage 照抄） ----
function batchSalvage() {
  const st = owUI.bagState;
  const items = owUI._backpackItems();
  const selected = [...st.batchChecked].map((i) => items[i]).filter(Boolean);
  if (!selected.length) { owUI.toast('未选择任何装备'); return; }
  if (!confirm(`确定分解选中的 ${selected.length} 件装备吗？此操作不可撤销。`)) return;
  let gold = 0, essence = 0;
  for (const gear of selected) {
    const r = salvageGear(game.player, gear.id);
    if (r) { gold += r.gold; essence += r.essence || 0; }
  }
  persist();
  st.batchMode = false;
  st.batchChecked = new Set();
  owUI._renderBackpack();
  owUI.toast(`♻️ 批量分解了 ${selected.length} 件装备：+${gold} 金${essence ? `，+${essence} 终焉精华` : ''}`);
}

// ---- 存档管理面板（永恒回想录存档管理器照抄：保存/加载/删除/新建/导出/导入/清除/持久化） ----
let currentSlot = AUTO_SLOT; // 当前活跃槽位（读档/手动保存后更新）

async function openSlots() {
  owMode = 'panel';
  const existing = await listSlots(store);
  const slots = [AUTO_SLOT, ...Array.from({ length: MANUAL_SLOTS }, (_, i) => String(i + 1))].map((id) =>
    existing.find((s) => s.id === id) || { id, name: id === AUTO_SLOT ? '自动存档' : `存档 ${id}`, timestamp: 0, level: '-', floor: '-', depth: '-' });
  const storageInfo = await getStorageInfo();
  owUI.renderSlots(game, slots, { mode: 'manage', currentSlot, storageInfo });
  document.getElementById('phase-el').textContent = '💾 存档管理';

  owUI.handlers.onSlotSave = async (slotId) => {
    const existing2 = await loadSlot(store, slotId);
    if (existing2 && !confirm(`确定覆盖「${slotId}」槽位的存档吗？`)) return;
    const clean = await saveToSlot(store, slotId, { ...game, area: area.toJSON() });
    if (!clean) { owUI.toast('❌ 保存失败：浏览器存储不可用（详见控制台）'); return; }
    currentSlot = slotId;
    owUI.toast(`已保存到「${slotId}」`);
    await openSlots();
  };
  owUI.handlers.onSlotLoad = async (slotId) => {
    if (!confirm('确定要加载此存档吗？当前未保存的进度将丢失。')) return;
    const saved = await loadSlot(store, slotId);
    if (saved) {
      teardownBattle();
      game = saved;
      currentSlot = slotId;
      area = restoreArea(saved);
      gameover = false;
      showView('overworld');
      enterArea();
      owUI.toast(`已读取「${slotId}」（Lv.${saved.player.level}）`);
    } else owUI.toast('该槽位没有存档');
  };
  owUI.handlers.onSlotDelete = async (slotId) => {
    if (slotId === currentSlot) { owUI.toast('不能删除当前正在使用的存档'); return; }
    if (!confirm('确定要删除此存档吗？此操作不可恢复。')) return;
    await removeSlot(store, slotId);
    owUI.toast(`已删除「${slotId}」`);
    await openSlots();
  };
  owUI.handlers.onNewSlot = async () => {
    const name = prompt('请输入存档名称:', `存档 ${new Date().toLocaleString()}`);
    if (!name) return;
    const id = 'save_' + Date.now();
    const clean = await saveToSlot(store, id, { ...game, area: area.toJSON() });
    if (!clean) { owUI.toast('❌ 新建失败：浏览器存储不可用（详见控制台）'); return; }
    currentSlot = id;
    owUI.toast(`已新建并保存「${name}」`);
    await openSlots();
  };
  owUI.handlers.onExport = async () => {
    const json = await exportAllJSON(store);
    if (!json) { owUI.toast('导出失败'); return; }
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fate_echo_save_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    owUI.toast('已导出全部存档（JSON 文件）');
  };
  owUI.handlers.onImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const text = await file.text();
      const count = await importAllJSON(store, text);
      if (count === null) owUI.toast('导入失败：文件损坏或格式不对');
      else { owUI.toast(`已导入 ${count} 个存档`); await openSlots(); }
    });
    input.click();
  };
  owUI.handlers.onClearAll = async () => {
    if (!confirm('确定要清除所有存档数据吗？此操作不可恢复。')) return;
    if (!confirm('再次确认：将删除全部存档、设置与统计数据。')) return;
    await clearAllGameData(store);
    atmTotalCache = 0; // 前瞻性投资全局数据已清（审查 G2：缓存同步重置，防金酒之杯残留加成）
    owUI.toast('已清除所有数据');
    newGame();
  };
  owUI.handlers.onPersistRequest = async () => {
    const r = await requestPersistentStorage();
    owUI.toast(r.persisted ? '持久化存储已启用 ✅' : '浏览器拒绝申请（数据可能被自动清除）');
    await openSlots();
  };
  owUI.handlers.onClose = () => { owMode = 'select'; renderArea(); };
}

// ---- 塔外 UI 回调 ----
owUI = new OverworldUI({
  owPlayer: document.getElementById('ow-player'),
  owEquipped: document.getElementById('ow-equipped'),
  owTower: document.getElementById('ow-tower'),
  toast: document.getElementById('toast'),
}, {
  onNode: () => {},      // 网格地图已接管（AreaMapView.onMove）
  onOption: () => {},    // openEvent 时覆盖
  onBuy: () => {},       // openShop 时覆盖
  onSlotView: (slot) => { openBag(slot); },        // 点击装备栏槽位 → 部位筛选
  onSortCycle: () => { owUI.cycleSortMode(); },
  onToggleLock: (id) => toggleLock(id),
  onTogglePin: (id) => togglePin(id),
  onEquip: (id) => {
    // 穿戴：背包 → 装备栏（同槽旧装备弹回背包）
    if (equipFromInventory(game.player, id)) {
      persist();
      if (owUI.bagState) { owUI.bagState.detail = null; owUI._renderBackpack(); }
      owUI.toast('已穿戴（旧装备回背包）');
    } else owUI.toast('穿戴失败');
  },
  onUnequip: (slot) => {
    // 卸下：装备栏 → 背包（末光咏叹：装备栏与背包严格分离）
    if (unequip(game.player, slot)) {
      persist();
      if (owUI.bagState) { owUI.bagState.detail = null; owUI._renderBackpack(); }
      owUI.toast('已卸下（装备回背包）');
    } else owUI.toast('卸下失败');
  },
  onSalvage: (id) => {
    // 分解（末光：终焉装备额外 +1 精华；locked 由 UI 禁用控制）
    const r = salvageGear(game.player, id);
    if (r) {
      persist();
      if (owUI.bagState) { owUI.bagState.detail = null; owUI._renderBackpack(); }
      owUI.toast(`分解【${r.gear.name}】+${r.gold} 金${r.essence ? `，+${r.essence} 终焉精华` : ''}`);
    } else owUI.toast('分解失败');
  },
  onRefineAffix: (id, affix) => {
    const gear = findGear(id);
    const r = gear && refineAffix(game.player, gear, affix);
    if (r) {
      persist();
      if (owUI.refineState) { owUI.refineState.selectedId = id; owUI._renderRefineList(); }
      owUI.toast(`精炼 ${affix} +${Math.round(r.increment * 100) / 100}（${r.newLevel}/15）`);
    } else owUI.toast('无法精炼（精华不足或已达上限）');
  },
  onOrbSock: (id, orbId, idx) => {
    const gear = findGear(id);
    const r = gear && sockOrb(game.player, gear, orbId);
    if (r && r.ok) {
      persist();
      if (owUI.bagState) { owUI.bagState.detail = { gear, isEquipped: !!game.player.equipment[gear.slot] }; owUI._renderBackpack(); }
      owUI.toast('宝珠已镶嵌');
    } else owUI.toast((r && r.reason) || '镶嵌失败');
  },
  onOrbUnsocket: (id, idx) => {
    const gear = findGear(id);
    const r = gear && unsocketOrb(gear, idx);
    if (r && r.ok) {
      persist();
      if (owUI.bagState) { owUI.bagState.detail = { gear, isEquipped: !!game.player.equipment[gear.slot] }; owUI._renderBackpack(); }
      owUI.toast('宝珠已卸下');
    } else owUI.toast('卸下失败');
  },
  onBatchEnter: (on) => {
    if (owUI.bagState) {
      owUI.bagState.batchMode = on;
      owUI.bagState.batchChecked = new Set();
      owUI.bagState.detail = null;
      owUI._renderBackpack();
    }
  },
  onBatchToggle: (i, checked) => {
    if (owUI.bagState) {
      if (checked) owUI.bagState.batchChecked.add(i);
      else owUI.bagState.batchChecked.delete(i);
      owUI._renderModalFoot();
    }
  },
  onBatchSelectAll: () => {
    const st = owUI.bagState;
    const items = owUI._backpackItems();
    items.forEach((g, i) => {
      const isEquipped = !!game.player.equipment[g.slot] && game.player.equipment[g.slot] === g;
      if (!g.locked && !g.pinned && !isEquipped) st.batchChecked.add(i);
    });
    owUI._renderBackpack();
  },
  onBatchSelectRarity: (rIdx) => {
    const st = owUI.bagState;
    const items = owUI._backpackItems();
    if (rIdx < 0) { st.batchChecked.clear(); }
    items.forEach((g, i) => {
      if (rIdx < 0 || g.rarityIdx === rIdx) {
        const isEquipped = !!game.player.equipment[g.slot] && game.player.equipment[g.slot] === g;
        if (!g.locked && !g.pinned && !isEquipped) st.batchChecked.add(i);
      }
    });
    owUI._renderBackpack();
  },
  onBatchSalvage: () => batchSalvage(),
  onCloseBackpack: () => { owUI.closeBackpack(); owMode = 'select'; renderArea(); },
  onCloseEnhance: () => { owUI.closeEnhanceView(); owMode = 'select'; renderArea(); },
  onCloseRefine: () => { owUI.closeRefineView(); owMode = 'select'; renderArea(); },
  onEnhanceX: (id, x) => doEnhance(id, x),
  onAutoSalvageGet: () => LootFilter.getAutoSalvageThreshold(),
  onAutoSalvageChange: (v) => {
    LootFilter.setAutoSalvageThreshold(v);
    owUI.toast(v < 0 ? '关闭自动分解' : `自动分解 ≤ ${GEAR_RARITY[v].name}`);
  },
  onEnhance: (gearId) => { openEnhance(gearId); }, // 背包内强化锻造入口（末光照抄：强化在背包内）
  onGacha: () => {},     // openGacha 时覆盖
  onReward: () => {},    // 结算三选一时覆盖
  onSlot: () => {},      // openSlots 时覆盖
  onNewGame: () => newGame(),
  onContinue: () => continueGame(),
  onLeave: () => {},
  onNodeConfirmEnter: () => {},  // openNodeConfirm 时覆盖
  onNodeConfirmCancel: () => {}, // openNodeConfirm 时覆盖
});

// 内嵌小地图组件（单例：仅创建一次，render 重建画布——避免旧地图残留在视口）
// onMove：点击可达节点移动；onEnter：点击当前节点 → 确认层（DESIGN_NOTES 第 1 条）
mapView = new AreaMapView(document.getElementById('area-map'), {
  onMove: (nodeId) => moveTo(nodeId),
  onEnter: () => openNodeConfirm(),
});

// ---- 键盘 ----
document.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();

  if (e.key === 'Tab') { e.preventDefault(); toggleAuto(); return; }

  if (view === 'battle') {
    if (k === 'arrowup' || k === 'arrowdown') {
      const logEl = document.getElementById('log');
      logEl.scrollTop += k === 'arrowup' ? -120 : 120;
      e.preventDefault();
      return;
    }
    if (autoMode) return;
    if (!engine || engine.phase !== 'player') return;
    const mains = engine.playerSkills.filter((s) => !s.isInstant && !s.isPassive);
    const instants = engine.playerSkills.filter((s) => s.isInstant);
    if (k >= '1' && k <= '9') {
      const idx = Number(k) - 1;
      if (idx < mains.length) toggleQueue(mains[idx], false);
    } else if (INSTANT_KEYS.includes(k)) {
      const idx = INSTANT_KEYS.indexOf(k);
      if (idx < instants.length) toggleQueue(instants[idx], true);
    } else if (k === ' ') { e.preventDefault(); engine.confirm(); }
    else if (k === 'd') engine.defend();
    else if (k === 'escape') engine.clearPending();
    return;
  }

  if (gameover && (k === ' ' || k === 'enter')) { e.preventDefault(); continueGame(); return; }
  if (owMode !== 'select') return; // 面板打开时不响应地图操作

  // 地图操作：空格进入当前节点（移动 = 点击地图上的可达节点，白光圈高亮）
  if (k === ' ') { e.preventDefault(); enterCurrent(); }
});

function toggleQueue(skill, isInstant) {
  const queued = engine.pending.some((a) => a.skill === skill);
  if (queued) {
    engine.unqueue(skill.id);
  } else {
    const r = isInstant ? engine.queueInstant(skill.id) : engine.queueMain(skill.id);
    if (!r.ok) battleUI.toast(`${skill.name}：${r.reason}`);
  }
}

// ---- 启动 ----
settings.load();
document.getElementById('chk-ai').checked = settings.aiLearning;
store = createSaveStore();
autoSaver = createAutoSaver(store);
// 前瞻性投资：启动加载历史累计投资额缓存（战斗/出口结算同步用；ATM 操作时同步更新）
getSetting(store, 'atm_total_deposited', 0).then((v) => { atmTotalCache = v || 0; }).catch(() => { /* 存储不可用忽略 */ });
await loadAI();
await continueGame(); // 有存档继续，无存档新游戏

// 调试/测试便利
window.fateEcho = {
  get game() { return game; },
  get area() { return area; },
  get view() { return view; },
  get engine() { return engine; },
  get gameover() { return gameover; },
  get owMode() { return owMode; },
  get mapView() { return mapView; },
  enterCurrent,
  moveTo,
  newGame,
  continueGame,
  openBag: (filterSlot = null) => openBag(filterSlot), // 调试/测试：背包（槽位筛选+自动详情）
  setRng(fn) { rng = fn; },
  // 测试辅助：将当前节点改为指定类型（模拟刷点）；boss=true 强制 Boss 出口战；
  // 顺带重置 cleared——调试钩子语义 = 重新生成一个未结算节点
  forceCell(type, boss = false) {
    const c = area.current();
    if (c) { c.type = boss ? 'exit_boss' : (type === 'battle' ? 'combat' : type); c.cleared = false; }
  },
};
