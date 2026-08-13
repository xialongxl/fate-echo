// ============================================================
// js/main.js — 游戏主循环（Fate_echo Phase 4 v2，黑流树海式平面节点网络）
// 探索：平面节点网络图（节点+通路边，入口→沿通路探索→出口），迷雾揭示、
//   可达白光圈、点位一次性、死路原路返回；每轮 3 区域（普通→普通→Boss）
// 地图：内嵌小地图组件（AreaMapView，固定视口可平移缩放）
// 结算：胜利 → 奖励三选一（装备/金币/篝火，杀戮尖塔式）→ 返回地图；
//   出口通关（险路尽头/小径/恶敌）→ 推进下一区/下一轮
// 视图状态机：'overworld'（地图/面板）| 'battle'
//   overworld 下 owMode：'select'（地图）| 'panel'（面板/结算）
// ============================================================

import { CombatEngine } from './engine.js';
import { BattleUI, OverworldUI } from './ui.js';
import { AreaMapView } from './area_map.js';
import { autoLoopTurn } from './autoloop.js';
import { makeBattlePlayer, grantExp, playerStatsAt } from './progression.js';
import { rollDrop, rollGacha, lootGear, equipFromInventory, unequip, salvageGear, enhanceGear, rollEquipment, GEAR_RARITY, SLOT_NAMES, GACHA_COST, ENHANCE_MAX, LootFilter, sockOrb, unsocketOrb, refineAffix } from './equipment.js';
import { createSaveStore, sanitizeSave, saveToSlot, loadSlot, listSlots, createAutoSaver, AUTO_SLOT, MANUAL_SLOTS, getStorageInfo, clearAllGameData, requestPersistentStorage, exportAllJSON, importAllJSON, getStatistic, updateStatistic } from './save.js';
import { Area, AREAS_PER_RUN } from './area.js';
import { rollEvent, resolveEvent } from './events.js';

const SETTINGS_KEY = 'fate_echo:settings';
const INSTANT_KEYS = ['q', 'e', 'r', 't'];
// 战斗奖励（§4.3 初稿 ⚠️ 待平衡）：经验 = 100×1.035^敌等级；金币按 tier
const REWARDS = { expBase: 100, goldByTier: { normal: 30, elite: 70, boss: 200 } };
const REST_HEAL_PCT = 0.4;

let rng = Math.random; // 统一随机源（测试可注入 setRng）
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
  renderArea();
  persist();
}

function renderArea() {
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
}

// ---- 移动与进入（黑流树海：点击可达节点沿通路移动） ----
function moveTo(nodeId) {
  if (gameover || owMode !== 'select') return;
  if (!area.moveTo(nodeId)) return;
  renderArea();
  if (mapView) mapView.follow(); // 摄像头跟随玩家（保持当前缩放）
  persist();
}

function enterCurrent() {
  if (gameover || owMode !== 'select') return;
  const node = area.current();
  if (!node) return;
  if (node.type === 'combat' || node.type === 'elite' || node.type === 'exit_boss') { startBattle(); }
  else if (node.type === 'exit' || node.type === 'exit_rare') openExit();
  else if (node.type === 'event') openEvent();
  else if (node.type === 'rest') doRest();
  else if (node.type === 'shop') openShop();
  else if (node.type === 'gacha') openGacha();
  else if (node.type === 'empty') { /* 林间空地：原地停留 */ }
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

// ---- 战斗结算：奖励三选一（杀戮尖塔式）→ 返回地图 ----
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
    persistNow();
    // 奖励计算
    let exp = 0, gold = 0;
    const drops = [];
    engine.enemies.forEach((e, i) => {
      const tier = (engine.enemyMetas[i] && engine.enemyMetas[i].tier) || 'normal';
      exp += Math.round(REWARDS.expBase * Math.pow(1.035, e.level));
      gold += REWARDS.goldByTier[tier] || 25;
      const drop = rollDrop(tier, rng, { floor: area.areaIndex + 1, depth: area.depth });
      if (drop) drops.push(drop);
    });
    const up = grantExp(game.player, exp);
    game.player.gold += gold;
    updateStatistic(store, 'victories', 1);
    updateStatistic(store, 'kills', engine.enemies.filter((e) => !e.alive).length);
    updateStatistic(store, 'gold_earned', gold);
    updateStatistic(store, 'drops', drops.length);
    const lines = [`经验 +${exp}，金币 +${gold}`];
    if (up.leveledUp) {
      lines.push(`🎉 升级！Lv.${game.player.level}（连升 ${up.levelsGained} 级，属性全面提升）`);
      game.player.hp = makeBattlePlayer(game).unit.maxHp;
      game.player.mp = playerStatsAt(game.player.level).mp;
    }
    // 掉落闭环（末光 lootItem：过滤→自动穿/入包/自动熔炼 + 终焉图鉴）
    for (const d of drops) {
      const r = lootGear(game.player, d);
      lines.push(lootLine(d, r));
    }
    if (isBossExit) lines.push(`🚪 出口打通！🏆 攻克 Boss 区，进入更深的第 ${area.depth + 1} 轮`);
    // 奖励三选一
    const choices = rollRewardChoices();
    owMode = 'panel';
    showView('overworld');
    owUI.renderBattleResult(game, lines, choices);
    owUI.handlers.onReward = (idx) => {
      const c = choices[idx];
      const got = applyReward(c);
      persistNow();
      owUI.renderBattleResult(game, [...lines, `✨ 选择了「${c.label}」：${got}`], null);
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

// 奖励三选一（装备/金币/篝火）
function rollRewardChoices() {
  const maxHp = makeBattlePlayer(game).unit.maxHp;
  return [
    { kind: 'gear', label: '装备', gear: rollEquipment(rng, { floor: area.areaIndex + 1, depth: area.depth, forceRarity: 2 + Math.floor(rng() * 4) }) },
    { kind: 'gold', label: '金币', amount: 40 + Math.floor(rng() * 41) },
    { kind: 'heal', label: '篝火', amount: Math.round(maxHp * 0.3) },
  ];
}
function applyReward(c) {
  if (c.kind === 'gear') {
    const r = lootGear(game.player, c.gear);
    return lootLine(c.gear, r);
  }
  if (c.kind === 'gold') { game.player.gold += c.amount; return `${c.amount} 金`; }
  if (c.kind === 'heal') {
    const maxHp = makeBattlePlayer(game).unit.maxHp;
    game.player.hp = Math.min(maxHp, game.player.hp + c.amount);
    return `+${c.amount} 生命`;
  }
  return '';
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
// 险路尽头：金币补给 + 奖励三选一；险路小径（稀有出口）：额外一件高品质装备
function openExit() {
  const node = area.current();
  const isRare = node.type === 'exit_rare';
  area.clearCurrent();
  const goldReward = (isRare ? 80 : 40) * area.depth;
  game.player.gold += goldReward;
  const lines = [`🚪 抵达${isRare ? '险路小径' : '险路尽头'}，探索成果兑换为补给：金币 +${goldReward}`];
  if (isRare) {
    // 稀有出口：额外高品质装备（险路小径的"较稀有加工品"）
    const rare = rollEquipment(rng, { floor: area.areaIndex + 1, depth: area.depth, forceRarity: 4 + Math.floor(rng() * 4) });
    const r = lootGear(game.player, rare);
    lines.push(lootLine(rare, r));
  }
  lines.push(`🚪 出口打通！${area.isBossArea ? '🏆 攻克 Boss 区，进入更深的第 ' + (area.depth + 1) + ' 轮' : `进入探索区 ${area.areaIndex + 2}/${AREAS_PER_RUN}`}`);
  const choices = rollRewardChoices();
  owMode = 'panel';
  showView('overworld');
  owUI.renderBattleResult(game, lines, choices);
  owUI.handlers.onReward = (idx) => {
    const c = choices[idx];
    const got = applyReward(c);
    persistNow();
    owUI.renderBattleResult(game, [...lines, `✨ 选择了「${c.label}」：${got}`], null);
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
    owUI.renderResult(game, lines, '返回地图', () => { owMode = 'select'; renderArea(); });
  };
}

// ---- 休息 ----
function doRest() {
  owMode = 'panel';
  const maxHp = makeBattlePlayer(game).unit.maxHp;
  const healed = Math.round(maxHp * REST_HEAL_PCT);
  game.player.hp = Math.min(maxHp, game.player.hp + healed);
  game.player.mp = playerStatsAt(game.player.level).mp;
  area.clearCurrent();
  persist();
  owUI.renderResult(game, [`篝火温暖了身体：恢复 ${healed} 生命，法力回满。`], '返回地图', () => { owMode = 'select'; renderArea(); });
}

// ---- 商店 ----
const SHOP_PRICE_BASE = 40;
const shopPrice = (gear) => (gear.rarityIdx + 1) * SHOP_PRICE_BASE;

function openShop() {
  const minRarity = area.isBossArea ? 3 : area.areaIndex >= 1 ? 2 : 1;
  const stock = Array.from({ length: 3 }, () => rollEquipment(rng, {
    floor: area.areaIndex + 1, depth: area.depth,
    forceRarity: Math.max(minRarity, weightedRarityForShop(rng)),
  }));
  owMode = 'panel';
  owUI.renderShop(game, stock, shopPrice);
  document.getElementById('phase-el').textContent = '🏪 商店';
  owUI.handlers.onBuy = (id) => {
    const gear = stock.find((g) => g.id === id);
    if (!gear || game.player.gold < shopPrice(gear)) return;
    game.player.gold -= shopPrice(gear);
    game.player.inventory.push(gear);
    persist();
    owUI.renderShop(game, stock, shopPrice);
    owUI.toast(`购入【${gear.name}】（已入背包）`);
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
    owUI.renderGacha(game);
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
document.getElementById('btn-enhance').addEventListener('click', () => { if (!gameover) openEnhance(); });
document.getElementById('btn-save').addEventListener('click', () => { if (!gameover) openSlots(); });
document.getElementById('btn-load').addEventListener('click', () => { if (!gameover) openSlots(); });
document.getElementById('btn-glossary').addEventListener('click', () => {
  if (gameover) return;
  openGlossary();
});

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
    await saveToSlot(store, slotId, { ...game, area: area.toJSON() });
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
    await saveToSlot(store, id, { ...game, area: area.toJSON() });
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
  owNodes: document.getElementById('ow-nodes'),
  owPanel: document.getElementById('ow-panel'),
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
  onRefine: (gearId) => { openRefine(gearId); },
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
  onEnhance: () => {},   // 兼容旧引用
  onGacha: () => {},     // openGacha 时覆盖
  onReward: () => {},    // 结算三选一时覆盖
  onSlot: () => {},      // openSlots 时覆盖
  onNewGame: () => newGame(),
  onContinue: () => continueGame(),
  onLeave: () => {},
});

// 内嵌小地图组件（单例：仅创建一次，render 重建画布——避免旧地图残留在视口）
mapView = new AreaMapView(document.getElementById('area-map'), { onMove: (nodeId) => moveTo(nodeId) });

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
  setRng(fn) { rng = fn; },
  // 测试辅助：将当前节点改为指定类型（模拟刷点）；boss=true 强制 Boss 出口战
  forceCell(type, boss = false) {
    const c = area.current();
    if (c) { c.type = boss ? 'exit_boss' : (type === 'battle' ? 'combat' : type); }
  },
};
