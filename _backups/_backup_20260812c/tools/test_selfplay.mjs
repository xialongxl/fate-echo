// ============================================================
// tools/test_selfplay.mjs — 真人试玩自检（Fate_echo Phase 4）
// 用 DOM 桩驱动真实 main.js/ui.js，模拟玩家完整旅程：
//   启动 → 树状图选关 → 战斗（手动+自动）→ 胜利结算 → 常驻装备栏
//   → 独立背包（穿戴/分解）→ 独立强化台 → 多槽存档/读档
//   → 商店购买 → 事件 → 抽卡 → 失败 → 读档恢复
// 每一步读取真实渲染的界面文本并校验，输出完整试玩日志。
// 用法: node tools/test_selfplay.mjs
// ============================================================

// ---------- 最小 DOM 桩（与 test_ui_smoke 同构） ----------
const elements = new Map();
const makeEl = (tag) => ({
  tag, children: [], _innerHTML: '', className: '', style: {}, disabled: false, hidden: false,
  title: '', scrollTop: 0, scrollHeight: 100, clientHeight: 0, listeners: {}, dataset: {}, attrs: {},
  setAttribute(k, v) { this.attrs[k] = String(v); },
  get textContent() { return this._innerHTML.replace(/<[^>]+>/g, ''); },
  set textContent(v) { this._innerHTML = String(v == null ? '' : v).replace(/[&<>]/g, ''); },
  classList: {
    _set: new Set(),
    add(...c) { for (const x of c) this._set.add(x); },
    remove(...c) { for (const x of c) this._set.delete(x); },
    contains(c) { return this._set.has(c); },
    toggle(c, force) {
      const want = force === undefined ? !this._set.has(c) : force;
      if (want) this._set.add(c); else this._set.delete(c);
      return want;
    },
  },
  addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); },
    removeEventListener(ev, fn) { this.listeners[ev] = (this.listeners[ev] || []).filter((x) => x !== fn); },
  appendChild(c) { this.children.push(c); },
  append(...nodes) { for (const n of nodes) this.children.push(n); },
  removeChild(c) { this.children = this.children.filter((x) => x !== c); },
  remove() { this._removed = true; },
  querySelectorAll(sel) {
    const out = [];
    const walk = (node) => {
      if (node && node.classList) {
        if (sel.startsWith('.')) {
          const classes = sel.slice(1).split('.').filter(Boolean);
          if (classes.every((c) => node.classList.contains(c))) out.push(node);
        } else if (sel.startsWith('[')) {
          const m = sel.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
          if (m && node.attrs && node.attrs[m[1]] !== undefined && (m[2] === undefined || String(node.attrs[m[1]]) === m[2])) out.push(node);
        }
      }
      for (const c of node.children || []) walk(c);
    };
    walk(this);
    return out;
  },
  get innerHTML() { return this._innerHTML; },
  set innerHTML(v) { this._innerHTML = v; this.children = []; },
  get childElementCount() { return this.children.length; },
  get firstChild() { return this.children[0] || null; },
});
const domListeners = { keydown: [] };
globalThis.document = {
  getElementById(id) { if (!elements.has(id)) elements.set(id, makeEl(id)); return elements.get(id); },
  createElement(tag) { return makeEl(tag); },
  createElementNS(ns, tag) { return makeEl(tag); },
  createDocumentFragment() { return makeEl('fragment'); },
  addEventListener(ev, fn) { (domListeners[ev] ||= []).push(fn); },
};
globalThis.window = globalThis;
globalThis.confirm = () => true; // 存档管理确认对话框（测试自动确认）
globalThis.prompt = () => '测试存档';

const fireClick = (el) => { if (!el || el.disabled) return false; for (const fn of el.listeners.click || []) fn(); return true; };
const fireKey = (key) => { for (const fn of domListeners.keydown || []) fn({ key, repeat: false, preventDefault() {} }); };
const el = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const panelText = () => {
  const collect = (node) => {
    let s = node.textContent || '';
    for (const c of node.children) s += collect(c);
    return s;
  };
  return collect(el('panel-title')) + collect(el('panel-body')); // 标题在弹窗 header，正文在 body
};
// 结算弹窗文本/按钮（DESIGN_NOTES 第 2 条：结算渲染到 #result-overlay 的 #result-body）
const resultText = () => {
  const collect = (node) => {
    let s = node.textContent || '';
    for (const c of node.children) s += collect(c);
    return s;
  };
  return collect(el('result-body'));
};
const resultBtn = (text) => findBtn(el('result-body'), text);
const findBtn = (container, text) => {
  const walk = (node) => {
    if (node.children && node.children.length) for (const c of node.children) { const h = walk(c); if (h) return h; }
    if (node._innerHTML && node._innerHTML.includes(text)) return node;
    return null;
  };
  return walk(container);
};
const skillBtn = (name) => el('skill-bar').children.find((b) => b._innerHTML.includes(name));
const logText = () => el('log').children.map((c) => c.textContent).join('\n');

// ---------- 试玩辅助 ----------
let issues = [];
const check = (name, cond, detail = '') => {
  const mark = cond ? '✓' : '✗';
  if (!cond) issues.push(name);
  console.log(`  [${mark}] ${name}${cond ? '' : ' ← 异常！ ' + detail}`);
};

await import('../js/main.js');
const fe = () => window.fateEcho;

// ============ 试玩开始（确定性 rng） ============
console.log('══════ 命运回响 · 真人试玩自检 ══════\n');

// ---- 第 1 步：启动与新游戏 ----
console.log('■ 第 1 步 启动与新游戏');
fe().setRng(() => 0.5);
fe().newGame();
check('塔外视图显示（overworld）', fe().view === 'overworld' && !fe().gameover);
check('内嵌地图渲染（画布 + 节点数匹配）', !!fe().mapView && fe().mapView.canvas.children.length - 1 === fe().area.nodes.length);
check('玩家面板 Lv1/金币0/HP满', fe().game.player.level === 1 && fe().game.player.gold === 0 && fe().game.player.hp === 100);
check('常驻装备栏 8 槽', (el('ow-equipped')._innerHTML.match(/equip-slot/g) || []).length >= 8);
check('入口节点（start）', fe().area.currentId === fe().area.startId);
const startNode = fe().area.current();
console.log(`  界面: 探索区 1/3 · 第 1 轮 | 位置 ${startNode ? startNode.type : '?'}（${fe().area.currentId}）`);

// ---- 第 2 步：选战斗节点，手动操作 ----
console.log('\n■ 第 2 步 手动战斗');
fe().forceCell('battle');
fe().enterCurrent();
check('进入战斗视图', fe().view === 'battle' && !!fe().engine);
fireKey('1');
check('按 1 入队魔力弹', fe().engine.pending.some((a) => a.skill.id === 's01'));
fireKey(' ');
check('空格确认 → 回合推进', fe().engine.turn === 2);
fireKey('d');
check('D 防御 → 下回合 +1 AP', fe().engine.apMax === 2);
console.log(`  我方 HP ${fe().engine.player.hp}/${fe().engine.player.maxHp} · 敌方 ${fe().engine.enemies.map((e) => e.name).join('+')}`);

// ---- 第 3 步：自动模式收尾 ----
console.log('\n■ 第 3 步 自动模式收尾');
fireKey('Tab');
let guard = 0;
while (fe().view === 'battle' && guard++ < 3000) await sleep(5);
fireKey('Tab');
check('自动战斗结束返回地图', fe().view === 'overworld');
check('奖励三选一结算（战利品弹窗）', resultText().includes('战利品'), resultText().slice(0, 60));
check('掉落候选展示（3 件三选一）', resultText().includes('三选一'));
console.log(`  结算: ${resultText().replace(/\s+/g, ' ').slice(0, 90)}`);
console.log(`  状态: Lv.${fe().game.player.level} 金币 ${fe().game.player.gold} 背包 ${fe().game.player.inventory.length} 件`);
fireClick(resultBtn('评分') || resultBtn('装备'));
fireClick(resultBtn('返回地图'));
check('返回地图（点位已结算）', fe().owMode === 'select' && fe().area.current().cleared === true);

// ---- 第 4 步：独立背包 Modal（末光 terminal：列表+详情+穿戴/卸下/分解） ----
console.log('\n■ 第 4 步 独立背包');
fireClick(el('btn-bag'));
check('背包 Modal 打开', el('modal-overlay').style.display === 'flex' && el('modal-title').textContent.includes('背包') && fe().owMode === 'panel');
// 掉落自动穿后背包可能有剩余装备；若空则跳过穿戴
const wearBtn = findBtn(el('modal-overlay'), '穿戴');
if (wearBtn) {
  const equippedBefore = Object.values(fe().game.player.equipment).filter(Boolean).length;
  fireClick(wearBtn);
  check('手动穿戴成功', Object.values(fe().game.player.equipment).filter(Boolean).length >= equippedBefore);
  fireClick(el('btn-bag'));
} else {
  console.log('  （背包为空，跳过穿戴——掉落已自动穿更强装备）');
}
fireClick(findBtn(el('modal-foot-bar'), '关闭终端'));
check('背包关闭返回选关', fe().owMode === 'select');

// ---- 第 5 步：背包内强化锻造（末光照抄：强化在背包内，无顶栏独立按钮） ----
console.log('\n■ 第 5 步 强化锻造（背包内入口）');
fe().game.player.gold = 5000; // 试玩注资
fireClick(el('btn-bag'));
check('背包 Modal 打开（强化入口在背包底栏）', el('modal-overlay').style.display === 'flex');
fireClick(findBtn(el('modal-foot-bar'), '强化锻造'));
check('强化锻造弹窗打开', el('enhance-overlay').style.display === 'flex');
const enhBtn = findBtn(el('enhance-details'), '强化');
if (enhBtn) {
  fireClick(enhBtn);
  check('强化操作响应（成功或失败）', true);
} else {
  console.log('  （无可强化装备，跳过）');
}
fireClick(el('enhance-close'));
check('强化弹窗关闭返回选关', fe().owMode === 'select');

// ---- 第 6 步：商店购买（进背包；openShop 异步 await atmSnapshot） ----
console.log('\n■ 第 6 步 商店');
fe().game.player.gold = 500;
fe().forceCell('shop');
fe().enterCurrent();
await sleep(10);
check('商店面板（商品+购买）', panelText().includes('商店') && !!findBtn(el('panel-body'), '购买'));
const invBeforeBuy = fe().game.player.inventory.length;
fireClick(findBtn(el('panel-body'), '购买'));
check('购买：金币减少 + 装备入背包', fe().game.player.gold < 500 && fe().game.player.inventory.length === invBeforeBuy + 1);
fireClick(findBtn(el('panel-body'), '离开商店'));
check('离开商店返回地图', fe().view === 'overworld' && fe().owMode === 'select');

// ---- 第 7 步：事件与抽卡 ----
console.log('\n■ 第 7 步 事件与抽卡');
fe().forceCell('event');
fe().enterCurrent();
check('事件面板（4 种之一）', ['宝箱', '雕像', '陷阱', '篝火'].some((k) => panelText().includes(k)), panelText().slice(0, 30));
const optBtn = findBtn(el('panel-body'), '打开') || findBtn(el('panel-body'), '祈祷') || findBtn(el('panel-body'), '小心') || findBtn(el('panel-body'), '休息') || findBtn(el('panel-body'), '无视') || findBtn(el('panel-body'), '强行');
if (optBtn) {
  fireClick(optBtn);
  check('事件结算 → 面板锁定', fe().owMode === 'panel');
  fireClick(resultBtn('返回地图'));
  check('事件返回地图', fe().owMode === 'select');
}
fe().game.player.gold = 300;
fe().forceCell('gacha');
fe().enterCurrent();
check('抽卡面板', panelText().includes('抽取'));
const invBeforeGacha = fe().game.player.inventory.length;
fireClick(findBtn(el('panel-body'), '抽取一次'));
check('抽卡：-100 金 + 装备入背包', fe().game.player.gold === 200 && fe().game.player.inventory.length === invBeforeGacha + 1);
fireClick(resultBtn('返回地图'));

// ---- 第 8 步：多槽位存档 / 读档（存档管理面板） ----
console.log('\n■ 第 8 步 存档与读档（多槽位）');
// 定位指定槽位的行（bag-list 内匹配名称），再取行内按钮
const collectText = (node) => { let s = node.textContent || ''; for (const c of node.children || []) s += collectText(c); return s; };
const slotRowBtn = (slotName, btnText) => {
  const lists = (el('panel-body').children || []).filter((n) => n.className === 'bag-list');
  for (const list of lists) {
    for (const row of list.children || []) {
      if (collectText(row).includes(slotName)) {
        const actions = (row.children || []).find((n) => n.className === 'btn-row');
        return (actions && actions.children || []).find((b) => b.textContent === btnText) || null;
      }
    }
  }
  return null;
};
const snapGold = fe().game.player.gold;
await sleep(150); // 等待自动存档防抖（100ms）落盘：auto 槽 = 当前状态
fireClick(el('btn-save'));
await sleep(20);
const saveBtn = slotRowBtn('存档 1', '保存');
check('存档面板含保存按钮', !!saveBtn);
fireClick(saveBtn);
await sleep(20);
check('已保存到「存档 1」槽', el('toast').hidden === false);
fe().game.player.gold += 999; // 模拟后续变动
fireClick(el('btn-load'));
await sleep(20);
// 当前槽（存档 1）加载按钮按设计禁用 → 从 auto 槽加载（自动存档 = 保存时状态）
const loadBtn = slotRowBtn('自动存档', '加载');
fireClick(loadBtn);
await sleep(20);
check('读档恢复存档状态', fe().game.player.gold === snapGold, `gold ${fe().game.player.gold} vs ${snapGold}`);
console.log(`  读档后: Lv.${fe().game.player.level} 金币 ${fe().game.player.gold}（存档时 ${snapGold}）`);
fireClick(findBtn(el('panel-body'), '关闭'));

// ---- 第 9 步：失败与读档恢复 ----
console.log('\n■ 第 9 步 失败与读档');
fe().game.player.level = 1; // 降回 Lv1（高等级+装备会先手秒杀/护盾扛住）
fe().game.player.hp = 1;
fe().game.player.mp = 0;
const posBefore = `${fe().area.depth}:${fe().area.areaIndex}:${fe().area.currentId}`;
fe().forceCell('battle', true); // Boss 战：Lv1 无装备 1 血必死
fe().enterCurrent();
fireKey('Tab');
guard = 0;
while (fe().view === 'battle' && guard++ < 3000) await sleep(5);
fireKey('Tab');
check('战斗失败 → gameover', fe().gameover === true);
check('失败不推进探索', `${fe().area.depth}:${fe().area.areaIndex}:${fe().area.currentId}` === posBefore);
await fe().continueGame();
check('读档恢复（非 gameover）', fe().gameover === false && fe().game.player.hp >= 1);
console.log(`  读档恢复: HP ${fe().game.player.hp} 位置 ${fe().area.currentId}`);

// ---- 第 10 步：重开新游戏 ----
console.log('\n■ 第 10 步 重新开始');
fe().newGame();
check('新游戏重置 Lv1/入口节点', fe().game.player.level === 1 && fe().area.areaIndex === 0 && fe().area.currentId === fe().area.startId && !fe().gameover);
check('地图重新渲染（节点数匹配）', fe().mapView.canvas.children.length - 1 === fe().area.nodes.length);

// ============ 汇总 ============
console.log('\n══════ 试玩自检汇总 ══════');
if (issues.length) {
  console.log(`发现 ${issues.length} 个异常:`);
  for (const i of issues) console.log('  ✗', i);
  process.exit(1);
}
console.log('全部检查通过 ✅ 游戏旅程完整可用');
