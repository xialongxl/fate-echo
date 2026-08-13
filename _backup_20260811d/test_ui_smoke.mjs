// ============================================================
// tools/test_ui_smoke.mjs — 全流程 UI 冒烟测试（Fate_echo Phase 4）
// 背景：真实浏览器验证在本环境不可用（IAB 后端连 example.com 都
//   ERR_FAILED）→ 用最小 DOM 桩在 Node 中执行 js/main.js 全链路。
// 桩忠实模拟真实 DOM 关键语义：innerHTML 清空子节点、disabled 阻止点击、
//   classList.toggle、hidden 属性。
// 覆盖（Phase 0-4）：启动/塔外选关/战斗/键盘/点击/自动模式/胜利结算/
//   事件/商店/抽卡/失败读档/重开/AI 开关。
// 用法: node tools/test_ui_smoke.mjs
// ============================================================

// ---------- 最小 DOM 桩 ----------
const elements = new Map();
const makeEl = (tag) => {
  const el = {
    tag,
    children: [],
    _innerHTML: '',
    style: {},
    disabled: false,
    hidden: false,
    title: '',
    dataset: {},
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    get textContent() { return this._innerHTML.replace(/<[^>]+>/g, ''); },
    set textContent(v) { this._innerHTML = String(v == null ? '' : v).replace(/[&<>]/g, ''); },
    scrollTop: 0,
    scrollHeight: 100,
    clientHeight: 0,
    listeners: {},
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
    // 简易 closest（支持 .class；桩无 parent 链，只查自身——area_map 用它判定节点命中）
    closest(sel) {
      if (sel.startsWith('.')) {
        const classes = sel.slice(1).split('.').filter(Boolean);
        if (classes.every((c) => this.classList.contains(c))) return this;
      }
      return null;
    },
    appendChild(c) { this.children.push(c); },
    append(...nodes) { for (const n of nodes) this.children.push(n); },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); },
    remove() { this._removed = true; },
    // 简易 querySelectorAll（支持 .class 多类 / [attr] / [attr="v"]）
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
    set innerHTML(v) { this._innerHTML = v; this.children = []; }, // 真实 DOM 语义：替换清空子节点
    get childElementCount() { return this.children.length; },
    get firstChild() { return this.children[0] || null; },
  };
  // 真实 DOM 语义：className 赋值 ↔ classList 双向同步（area_map 用 className= 赋值后
  //   再用 classList.contains 判定，桩必须同步否则点击/高亮判定失效）
  Object.defineProperty(el, 'className', {
    get() { return [...el.classList._set].join(' '); },
    set(v) { el.classList._set = new Set(String(v).split(/\s+/).filter(Boolean)); },
  });
  return el;
};

const domListeners = { keydown: [] };
globalThis.document = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, makeEl(id));
    return elements.get(id);
  },
  createElement(tag) { return makeEl(tag); },
  createElementNS(ns, tag) { return makeEl(tag); },
  createDocumentFragment() { return makeEl('fragment'); },
  addEventListener(ev, fn) { (domListeners[ev] ||= []).push(fn); },
};
globalThis.window = globalThis;

// 事件分发辅助
const fireClick = (el) => {
  if (el.disabled) return false; // 真实 DOM：禁用按钮不触发
  for (const fn of el.listeners.click || []) fn();
  return true;
};
const fireKey = (key) => {
  for (const fn of domListeners.keydown || []) fn({ key, repeat: false, preventDefault() {} });
};

// ---------- 断言辅助 ----------
let pass = 0, fail = 0;
const t = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

// ---------- 导入被测试代码（main.js 顶层启动：continueGame → newGame） ----------
await import('../js/main.js');
const fe = () => window.fateEcho;
const el = (id) => document.getElementById(id);
const skillBtn = (name) => el('skill-bar').children.find((b) => b._innerHTML.includes(name));
// ow-panel 由 appendChild 构建（innerHTML 恒空）→ 递归收集子节点文本
// （textContent 已从 innerHTML 派生，无需再读 innerHTML）
const owPanelText = () => {
  const collect = (node) => {
    let s = node.textContent || '';
    for (const c of node.children) s += collect(c);
    return s;
  };
  return collect(el('panel-title')) + collect(el('panel-body')); // 标题在弹窗 header，正文在 body
};
// 结算弹窗文本（DESIGN_NOTES 第 2 条：结算渲染到 #result-overlay 的 #result-body）
// 注：DOM 桩为扁平结构（getElementById 各自独立），直接查渲染目标 #result-body
const resultText = () => {
  const collect = (node) => {
    let s = node.textContent || '';
    for (const c of node.children) s += collect(c);
    return s;
  };
  return collect(el('result-body'));
};
// 结算弹窗内按钮查找（战利品三选一/返回地图/读档重开）
const resultBtn = (text) => findBtn(el('result-body'), text);
// 地图 pointer 事件分发（area_map 用 pointerdown/up 判定点击，非 click）
const firePointer = (target, type, x, y) => {
  for (const fn of el('area-map').listeners[type] || []) fn({ target, clientX: x, clientY: y, pointerId: 1 });
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 深度查找容器内按钮（桩无 querySelector；按钮可能嵌套在 .btn-row 内）
const findBtn = (container, text) => {
  const walk = (node) => {
    if (node.children && node.children.length) {
      for (const c of node.children) {
        const hit = walk(c);
        if (hit) return hit;
      }
    }
    if (node._innerHTML && node._innerHTML.includes(text)) return node;
    return null;
  };
  return walk(container);
};

console.log('== A. 启动与区域地图 ==');
{
  t('A1 游戏状态就绪（overworld）', fe().game && fe().view === 'overworld' && !fe().gameover);
  t('A2 玩家默认档：Lv1/金币 0/入口节点', fe().game.player.level === 1 && fe().game.player.gold === 0 && fe().area.currentId === fe().area.startId);
  t('A3 内嵌地图渲染（画布 + 节点数匹配）', !!fe().mapView && !!fe().mapView.canvas && fe().mapView.canvas.children.length - 1 === fe().area.nodes.length, `n=${fe().mapView && fe().mapView.canvas && fe().mapView.canvas.children.length - 1}`);
  t('A4 玩家面板渲染（等级/经验/金币）', el('ow-player')._innerHTML.includes('Lv.1') && el('ow-player')._innerHTML.includes('金币'));
  t('A4b 局外属性面板 = 末光 stats-grid UI 形式（stat-item 卡片六项 + GCD）', (() => {
    const h = el('ow-player')._innerHTML;
    return h.includes('stat-item') && h.includes('攻击力') && h.includes('防御力') && h.includes('冷却缩减') && h.includes('暴击率') && h.includes('共鸣') && h.includes('GCD') && h.includes('2.50s') && !h.includes('eq-slot');
  })(), el('ow-player')._innerHTML.slice(0, 300));
  t('A5 战斗视图隐藏', el('battle-area').hidden === true);
  // 确定性 rng（0.5 → 单敌、掉落普通不掉、事件=陷阱、抽卡=普通）——消除随机失败
  fe().setRng(() => 0.5);
  // 测试注资：升级到 Lv5 满血（后续所有战斗用 Lv5 玩家，稳赢 Lv1 敌人）
  fe().game.player.level = 5;
  fe().game.player.hp = 240;
  fe().game.player.mp = 100;
}

console.log('== A2. 背包/强化/存档（Modal + 多槽位） ==');
{
  t('A6 常驻装备栏渲染（8 槽）', el('ow-equipped')._innerHTML.includes('共鸣武装') && (el('ow-equipped')._innerHTML.match(/equip-slot/g) || []).length >= 8);
  fireClick(el('btn-bag'));
  t('A7 独立背包 Modal 打开', el('modal-overlay').style.display === 'flex' && el('modal-title').textContent.includes('背包') && fe().owMode === 'panel');
  // 强化锻造在背包内（末光照抄：背包底栏入口；顶栏无独立按钮）
  fireClick(findBtn(el('modal-foot-bar'), '强化锻造'));
  t('A9 背包内强化锻造弹窗打开', el('enhance-overlay').style.display === 'flex');
  fireClick(el('enhance-close'));
  t('A9b 强化弹窗关闭返回选关', fe().owMode === 'select' && el('enhance-overlay').style.display === 'none');
  fireClick(el('btn-bag'));
  fireClick(findBtn(el('modal-foot-bar'), '关闭终端'));
  t('A8 背包关闭返回选关', fe().owMode === 'select' && el('modal-overlay').style.display === 'none');
  fireClick(el('btn-save'));
  await sleep(10); // openSlots 异步（await listSlots）
  t('A10 存档管理面板（保存/加载/删除/导出/导入）', owPanelText().includes('存档管理') && owPanelText().includes('新建存档') && fe().owMode === 'panel');
  fireClick(findBtn(el('panel-body'), '关闭'));
  fireClick(el('btn-load'));
  await sleep(10);
  t('A11 读档面板（存档管理）', owPanelText().includes('存档管理'));
  fireClick(findBtn(el('panel-body'), '关闭'));
  t('A12 存档面板返回选关', fe().owMode === 'select');
}

console.log('== B. 进入战斗 ==');
{
  fe().forceCell('battle');
  fe().enterCurrent();
  t('B1 战斗视图切换', fe().view === 'battle' && el('battle-area').hidden === false);
  t('B2 引擎构建（Lv5 解锁 6 技能）', fe().engine && fe().engine.playerSkills.length === 6, `n=${fe().engine && fe().engine.playerSkills.length}`);
  t('B3 技能按钮渲染', el('skill-bar').childElementCount >= 1);
  t('B4 敌方面板渲染', el('enemy-panel').children.length >= 1);
}

console.log('== C. 键盘操作 ==');
{
  const e = fe().engine;
  fireKey('1'); // 第一个主技能 = 魔力弹
  t('C1 数字键 1 入队 魔力弹', e.pending.some((a) => a.skill.id === 's01'));
  fireKey('Escape');
  t('C2 Esc 清空队列', e.pending.length === 0);
  fireKey(' ');
  t('C3 空格确认 → 回合推进', e.turn === 2 && e.phase === 'player');
  fireKey('d');
  t('C4 D 防御 → 下回合 +1 AP', e.turn === 3 && e.apMax === 2, `turn=${e.turn} apMax=${e.apMax}`);
  t('C5 日志已产生', el('log').childElementCount > 0);
}

console.log('== D. 点击操作 ==');
{
  const e = fe().engine;
  t('D1 点击技能入队（魔力弹）', fireClick(skillBtn('魔力弹')) && e.pending.some((a) => a.skill.id === 's01'));
  fireClick(el('btn-confirm'));
  t('D2 确认按钮 → 回合推进', e.phase === 'player');
  fireClick(el('btn-clear'));
  t('D3 清空按钮无异常', e.pending.length === 0);
}

console.log('== E. 自动模式 ==');
{
  t('E1 初始手动模式', el('mode-el').textContent.includes('手动'));
  fireKey('Tab');
  t('E2 Tab 切换自动', el('mode-el').textContent.includes('自动'));
  // 异步让步：等待自动战斗打完（胜利或失败）
  let guard = 0;
  while (fe().view === 'battle' && guard++ < 2000) await sleep(5);
  t('E3 自动战斗结束并返回地图', fe().view === 'overworld' && guard < 2000, `view=${fe().view} guard=${guard}`);
  t('E3b 战利品结算弹窗（居中 overlay + 装备三选一）', resultText().includes('战利品') && resultText().includes('三选一'), resultText().slice(0, 80));
  t('E3c 三个装备候选按钮', el('result-body').querySelectorAll('.opt-btn').length >= 3, `n=${el('result-body').querySelectorAll('.opt-btn').length}`);
  fireClick(resultBtn('评分') || resultBtn('装备'));
  t('E4 选奖后出现「返回地图」', !!resultBtn('返回地图'));
  fireClick(resultBtn('返回地图'));
  t('E5 返回地图（点位已结算）', fe().owMode === 'select' && fe().area.current().cleared === true);
  fireKey('Tab');
  t('E6 Tab 切回手动', el('mode-el').textContent.includes('手动'));
}

console.log('== F. 胜利结算 ==');
{
  t('F1 战斗胜利（Lv1 敌人等级低）', fe().gameover === false, `gameover=${fe().gameover}`);
  // 手动模式可继续操作
  fe().forceCell('battle');
  fe().enterCurrent();
  t('F2 再次进入战斗正常', fe().view === 'battle');
  fireKey('Tab');
  let guard = 0;
  while (fe().view === 'battle' && guard++ < 2000) await sleep(5);
  fireKey('Tab');
  t('F3 战斗结束返回地图', fe().view === 'overworld');
  t('F4 战利品结算弹窗（三选一候选）', resultText().includes('战利品') && resultText().includes('三选一'));
  fireClick(resultBtn('评分') || resultBtn('装备'));
  fireClick(resultBtn('返回地图'));
}

console.log('== G. 事件节点 ==');
{
  fe().forceCell('event');
  fe().enterCurrent();
  t('G1 事件面板（标题 + 选项）', owPanelText().includes('宝箱') || owPanelText().includes('雕像') || owPanelText().includes('陷阱') || owPanelText().includes('篝火'), owPanelText());
  // 点击第一个选项
  const opts = [findBtn(el('panel-body'), '打开'), findBtn(el('panel-body'), '祈祷'), findBtn(el('panel-body'), '小心'), findBtn(el('panel-body'), '休息'), findBtn(el('panel-body'), '无视'), findBtn(el('panel-body'), '强行'), findBtn(el('panel-body'), '继续')].filter(Boolean);
  t('G2 事件选项按钮存在', opts.length >= 1);
  fireClick(opts[0]);
  t('G3 事件结算弹窗（返回地图按钮）', !!resultBtn('返回地图'));
  fireClick(resultBtn('返回地图'));
  t('G4 事件结算后返回地图', fe().view === 'overworld' && fe().owMode === 'select');
}

console.log('== H. 商店（含 ATM 存款机）与抽卡 ==');
{
  const goldBefore = fe().game.player.gold;
  fe().game.player.gold = 500; // 测试注资
  fe().forceCell('shop');
  fe().enterCurrent();
  await sleep(10); // openShop 异步（await atmSnapshot）
  t('H1 商店面板（商品 + 购买按钮）', owPanelText().includes('商店') && !!findBtn(el('panel-body'), '购买'));
  // ---- ATM 存款机（前瞻性投资系统） ----
  t('H1b ATM 区块（余额/累计/存款按钮）', owPanelText().includes('前瞻性投资') && owPanelText().includes('存款余额'), owPanelText().slice(0, 60));
  const dep10 = findBtn(el('panel-body'), '存 10');
  fireClick(dep10);
  await sleep(10); // onDeposit 异步（setSetting）
  t('H1c 存款 10：金币 -10、累计 10（取款未解锁）', fe().game.player.gold === 490 && owPanelText().includes('历史累计投资：10'), owPanelText().slice(0, 80));
  const dep50 = findBtn(el('panel-body'), '存 50');
  fireClick(dep50);
  await sleep(10);
  t('H1d 存款 50：累计 60（≥15 取款解锁）', owPanelText().includes('历史累计投资：60') && owPanelText().includes('已解锁'), owPanelText().slice(0, 80));
  // 取款（15 解锁，1:1 无损）
  const wit10 = findBtn(el('panel-body'), '取 10');
  t('H1e 取款按钮可用（累计 ≥15）', !!wit10 && !wit10.disabled);
  fireClick(wit10);
  await sleep(10);
  t('H1f 取款 10：金币回账 +10（1:1 无损）', fe().game.player.gold === 450 && owPanelText().includes('存款余额：50'), `gold=${fe().game.player.gold}`);
  // 购买（金币 450；存款后累计 60 ≥ 50 → 9 折即时生效：实扣 == 显示价）
  const buyBtn = findBtn(el('panel-body'), '购买');
  const shown = parseInt((buyBtn._innerHTML.match(/购买 (\d+) 金/) || [])[1] || '0', 10);
  const goldAtBuy = fe().game.player.gold;
  fireClick(buyBtn);
  t('H2 购买成功（实扣=显示价，9 折即时生效）', fe().game.player.gold === goldAtBuy - shown && fe().game.player.inventory.length >= 1, `gold=${fe().game.player.gold} shown=${shown}`);
  // 离开商店
  const leaveBtn = findBtn(el('panel-body'), '离开商店');
  fireClick(leaveBtn);
  t('H3 离开商店返回地图', fe().view === 'overworld' && fe().owMode === 'select');
  // 抽卡
  fe().game.player.gold = 300;
  fe().forceCell('gacha');
  fe().enterCurrent();
  t('H4 抽卡面板', owPanelText().includes('抽取'));
  const gachaBtn = findBtn(el('panel-body'), '抽取一次');
  const invBefore = fe().game.player.inventory.length;
  fireClick(gachaBtn);
  t('H5 抽卡消耗 100 金 + 装备入背包', fe().game.player.gold === 200 && fe().game.player.inventory.length === invBefore + 1, `gold=${fe().game.player.gold}`);
  t('H6 抽卡结果播报（结算弹窗）', resultText().includes('抽取获得'), resultText().slice(0, 60));
  fireClick(resultBtn('返回地图'));
}

console.log('== I. AI 学习开关 ==');
{
  t('I1 AI 学习开关控件存在且默认勾选', el('chk-ai').checked === true);
  const chk = el('chk-ai');
  chk.checked = false;
  for (const fn of chk.listeners.change || []) fn({ target: chk });
  t('I2 关闭开关安全（当前引擎置 null）', fe().engine === null || fe().engine.ai === null);
  chk.checked = true;
  for (const fn of chk.listeners.change || []) fn({ target: chk });
}

console.log('== J. 失败与读档 ==');
{
  // 复位到选关模式（H 组抽卡后面板打开；continueGame 从存档重载并 enterFloor）
  await fe().continueGame();
  // 构造必败：玩家 1 血 + 0 法力进 Boss 战（autoloop 无法治疗，Boss 310+ HP 不可能被秒 → 必死）
  fe().game.player.hp = 1;
  fe().game.player.mp = 0;
  fe().area.rng = () => 0.5; // 读档后 area.rng 为真实随机 → 固定，保证敌人/Boss 确定性
  const floorBefore = `${fe().area.depth}:${fe().area.areaIndex}:${fe().area.currentId}`;
  fe().forceCell('battle', true); // 强制 Boss 出口战（1 血必胜场景不可能出现）
  fe().enterCurrent();
  fireKey('Tab');
  let guard = 0;
  while (fe().view === 'battle' && guard++ < 2000) await sleep(5);
  fireKey('Tab');
  t('J1 失败 → gameover 视图', fe().gameover === true, `gameover=${fe().gameover}`);
  t('J2 失败不推进探索（存档点保留）', `${fe().area.depth}:${fe().area.areaIndex}:${fe().area.currentId}` === floorBefore);
  // 读档（continueGame 从存档恢复——存档是"进入本层前"状态）
  await fe().continueGame();
  t('J3 读档恢复正常（非 gameover）', fe().gameover === false && fe().view === 'overworld');
  t('J4 读档后状态合法（hp ≥ 1）', fe().game.player.hp >= 1);
}

console.log('== K. 重开新游戏 ==');
{
  const oldGame = fe().game;
  fe().newGame();
  t('K1 新游戏：新状态 Lv1 入口节点', fe().game !== oldGame && fe().game.player.level === 1 && fe().area.areaIndex === 0 && fe().area.currentId === fe().area.startId && fe().gameover === false);
  t('K2 地图渲染正常（节点数匹配）', fe().mapView.canvas.children.length - 1 === fe().area.nodes.length);
}

console.log('== L. 节点进入确认层（黑流树海式：点击当前节点 → 确认 → 进入） ==');
{
  fe().newGame();
  fe().setRng(() => 0.5);
  // 当前节点改为事件（非 empty，确认层才弹出）
  fe().forceCell('event');
  const curId = fe().area.currentId;
  const curEl = fe().mapView.canvas.querySelectorAll('.area-node').find((n) => n.dataset.id === curId);
  t('L1 当前节点元素存在', !!curEl);
  // 点击当前节点（pointerdown/up 位移 <6）→ onEnter → 确认层
  firePointer(curEl, 'pointerdown', 100, 100);
  firePointer(curEl, 'pointerup', 101, 101);
  const nodeText = () => {
    const collect = (n) => { let s = n.textContent || ''; for (const c of n.children) s += collect(c); return s; };
    return collect(el('node-confirm-body'));
  };
  t('L2 确认层弹出（居中 overlay + 节点名/说明）', el('node-confirm-overlay').style.display === 'flex' && nodeText().includes('不期而遇'), nodeText().slice(0, 50));
  t('L3 确认层锁地图操作（owMode=panel）', fe().owMode === 'panel');
  // 取消
  fireClick(findBtn(el('node-confirm-body'), '取消'));
  t('L4 取消关闭确认层返回选关', el('node-confirm-overlay').style.display === 'none' && fe().owMode === 'select');
  // 再次打开 → 进入 → 事件面板打开
  firePointer(curEl, 'pointerdown', 100, 100);
  firePointer(curEl, 'pointerup', 101, 101);
  fireClick(findBtn(el('node-confirm-body'), '进入'));
  t('L5 确认进入 → 事件面板打开', fe().owMode === 'panel' && (owPanelText().includes('宝箱') || owPanelText().includes('雕像') || owPanelText().includes('陷阱') || owPanelText().includes('篝火')), owPanelText().slice(0, 50));
  // 走完事件流程收尾
  const opts = [findBtn(el('panel-body'), '打开'), findBtn(el('panel-body'), '祈祷'), findBtn(el('panel-body'), '小心'), findBtn(el('panel-body'), '休息'), findBtn(el('panel-body'), '无视'), findBtn(el('panel-body'), '强行'), findBtn(el('panel-body'), '继续')].filter(Boolean);
  if (opts[0]) fireClick(opts[0]);
  fireClick(resultBtn('返回地图') || findBtn(el('panel-body'), '返回地图'));
  t('L6 事件结算后返回地图', fe().owMode === 'select' && fe().view === 'overworld');
}

console.log('== M. 种子防 SL（失败重试复用战斗种子） ==');
{
  fe().newGame();
  fe().setRng(() => 0.5);
  fe().game.player.level = 5;
  fe().game.player.hp = 240;
  fe().game.player.mp = 100;
  // 构造必败：1 血 Boss 战（auto 槽保留 startBattle 时的战斗前状态含 seed）
  fe().game.player.hp = 1;
  fe().game.player.mp = 0;
  fe().area.rng = () => 0.5;
  fe().forceCell('battle', true);
  fe().enterCurrent();
  const seed1 = fe().game.player.battleSeed;
  t('M1 战斗开始后 battleSeed 已生成并落盘（非 null）', Number.isFinite(seed1) && seed1 !== null, `seed=${seed1}`);
  fireKey('Tab');
  let guard = 0;
  while (fe().view === 'battle' && guard++ < 2000) await sleep(5);
  t('M2 1 血 Boss 战失败（gameover）', fe().gameover === true);
  // 读档回战斗前（auto 槽 = startBattle 时的状态，含 seed）
  await fe().continueGame();
  t('M3 读档后 battleSeed 恢复为战斗前种子', fe().game.player.battleSeed === seed1, `seed=${fe().game.player.battleSeed}`);
  // 重战斗：复用同一种子（SL 无法改变掉落）
  fe().game.player.hp = 1;
  fe().game.player.mp = 0;
  fe().area.rng = () => 0.5;
  fe().forceCell('battle', true);
  fe().enterCurrent();
  t('M4 重战斗复用同一 battleSeed（防 SL）', fe().game.player.battleSeed === seed1, `seed=${fe().game.player.battleSeed}`);
  fireKey('Tab'); // 开自动打（teardownBattle 已复位 autoMode）
  guard = 0;
  while (fe().view === 'battle' && guard++ < 2000) await sleep(5);
  t('M5 重战斗同样失败（同种子同结果）', fe().gameover === true);
  await fe().continueGame();
  t('M6 恢复非 gameover', fe().gameover === false);
}

console.log('== N. 节点机制（黑流树海：未进入不可离开 / 已结算不可二次进入） ==');
{
  fe().newGame();
  fe().setRng(() => 0.5);
  // 入口（empty 豁免）→ 移动到可达非空节点（未进入）
  const startId = fe().area.startId;
  const nb = fe().area.neighbors(startId).find((n) => n.type !== 'empty');
  t('N1 入口有可达非空节点（前置）', !!nb);
  fe().moveTo(nb.id);
  t('N2 移动到节点成功（未进入状态）', fe().area.currentId === nb.id && nb.cleared === false);
  // 未进入 → 尝试移回入口 → 被拒（黑流树海：到达节点即须进入）
  fe().moveTo(startId);
  t('N3 未进入节点不可离开（moveTo 被拒）', fe().area.currentId === nb.id);
  // 进入该节点（固定为事件，走完流程 → 结算）
  fe().forceCell('event');
  fe().enterCurrent();
  t('N4 未进入节点可正常进入（事件面板打开）', fe().owMode === 'panel' && (owPanelText().includes('宝箱') || owPanelText().includes('雕像') || owPanelText().includes('陷阱') || owPanelText().includes('篝火')), owPanelText().slice(0, 40));
  const opts = [findBtn(el('panel-body'), '打开'), findBtn(el('panel-body'), '祈祷'), findBtn(el('panel-body'), '小心'), findBtn(el('panel-body'), '休息'), findBtn(el('panel-body'), '无视'), findBtn(el('panel-body'), '强行'), findBtn(el('panel-body'), '继续')].filter(Boolean);
  if (opts[0]) fireClick(opts[0]);
  fireClick(resultBtn('返回地图'));
  t('N5 结算后返回地图（节点已结算）', fe().owMode === 'select' && nb.cleared === true);
  // 已结算 → 不可二次进入（enterCurrent 守卫）
  fe().enterCurrent();
  t('N6 已结算节点不可二次进入', fe().owMode === 'select' && fe().view === 'overworld');
  // 已结算 → 可移动离开（死路原路返回语义）
  fe().moveTo(startId);
  t('N7 已结算节点可移动离开', fe().area.currentId === startId);
  // 回到已结算节点 → 确认层不弹（openNodeConfirm 守卫）
  fe().moveTo(nb.id);
  const nbEl = fe().mapView.canvas.querySelectorAll('.area-node').find((n) => n.dataset.id === nb.id);
  firePointer(nbEl, 'pointerdown', 50, 50);
  firePointer(nbEl, 'pointerup', 51, 51);
  t('N8 已结算节点点击不弹确认层', el('node-confirm-overlay').style.display !== 'flex' && fe().owMode === 'select');
}

console.log('== O. 面板弹窗 header 关闭（X = 放弃节点，防取消重刷） ==');
{
  fe().newGame();
  fe().setRng(() => 0.5);
  fe().forceCell('event');
  fe().enterCurrent();
  t('O1 事件面板打开', el('panel-overlay').style.display === 'flex' && owPanelText().includes('宝箱') || owPanelText().includes('雕像') || owPanelText().includes('陷阱') || owPanelText().includes('篝火'));
  // header X 关闭 → 事件节点被结算（放弃，不可重进）
  fireClick(el('panel-close'));
  t('O2 X 关闭事件面板返回地图', el('panel-overlay').style.display === 'none' && fe().owMode === 'select');
  t('O3 事件节点被结算（防取消重刷）', fe().area.current().cleared === true);
  // 已结算 → 不可再进（重刷途径堵死）
  fe().enterCurrent();
  t('O4 放弃后节点不可再进', fe().owMode === 'select' && fe().view === 'overworld');
  // 帮助面板：X 关闭（无节点语义，仅关面板；openGlossary 异步 await 统计表）
  fe().forceCell('event'); // 重置当前节点（帮助面板不需要节点，但确保 select 状态可点）
  fireClick(el('btn-glossary'));
  await sleep(10);
  t('O5 帮助面板弹窗打开', el('panel-overlay').style.display === 'flex' && owPanelText().includes('术语'), owPanelText().slice(0, 40));
  fireClick(el('panel-close'));
  t('O6 X 关闭帮助面板返回地图', el('panel-overlay').style.display === 'none' && fe().owMode === 'select');
}

console.log('== P. 终焉精炼入口（背包外顶栏，照抄末光） ==');
{
  fe().newGame();
  fe().setRng(() => 0.5);
  t('P1 初始无终焉：btn-refine 隐藏', el('btn-refine').style.display === 'none');
  // 注资一件终焉装备 + 图鉴记录（末光显隐条件：finaleCollection 任一槽 true）
  fe().game.player.inventory.push({ id: 'g_finale', name: '终焉 灵刃', slot: 'weapon', rarityIdx: 8, stats: { atk: 100 }, enhanceLv: 0, locked: true, pinned: false, score: 500, baseScore: 500, orbs: [], refineLevels: {}, refineInitialValues: {} });
  fe().game.player.finaleCollection.weapon = true;
  // 触发 renderArea（moveTo 空地方向）→ 显隐更新
  const nb = fe().area.neighbors(fe().area.startId).find((n) => n.type === 'empty') || fe().area.neighbors(fe().area.startId)[0];
  fe().moveTo(nb.id);
  t('P2 获得终焉后 btn-refine 显示', el('btn-refine').style.display !== 'none');
  fireClick(el('btn-refine'));
  // 注：桩不解析 index.html 静态文本 → 不查 refine-title，改查列表渲染（动态内容）
  t('P3 精炼弹窗打开（背包外入口）', el('refine-overlay').style.display === 'flex' && el('refine-gear-list').childElementCount >= 1, `n=${el('refine-gear-list').childElementCount}`);
  fireClick(el('refine-close'));
  t('P4 精炼关闭返回选关', fe().owMode === 'select' && el('refine-overlay').style.display === 'none');
}

console.log('== Q. 收藏品系统（局内：战斗掉落 / 商店购买 / newGame 清空） ==');
{
  fe().newGame();
  fe().setRng(() => 0.5);
  t('Q1 newGame 后无收藏品', (fe().game.player.collections || []).length === 0);
  // 战斗胜利 → 收藏品掉落判定（battleRng 种子随机——可能掉也可能不掉，条件断言）
  fe().game.player.level = 5;
  fe().game.player.hp = 240;
  fe().game.player.mp = 100;
  fe().forceCell('battle');
  fe().enterCurrent();
  fireKey('Tab');
  let guard = 0;
  while (fe().view === 'battle' && guard++ < 2000) await sleep(5);
  t('Q2 战斗结束返回结算', fe().view === 'overworld');
  const hasDrop = (fe().game.player.collections || []).length > 0;
  t('Q3 收藏品掉落判定' + (hasDrop ? '（本场命中，结算行显示）' : '（本场未命中）'), hasDrop ? resultText().includes('收藏品') : true, resultText().slice(0, 50));
  // 收尾结算（选装备 + 返回地图，解锁 owMode）
  fireClick(resultBtn('评分') || resultBtn('装备'));
  fireClick(resultBtn('返回地图'));
  t('Q3b 结算收尾返回地图', fe().owMode === 'select');
  // 商店购买收藏品（统一 400 金）
  fe().game.player.gold = 1000;
  fe().forceCell('shop');
  fe().enterCurrent();
  await sleep(10); // openShop 异步
  t('Q4 商店显示收藏品售卖区', owPanelText().includes('收藏品') && !!findBtn(el('panel-body'), '购买 400 金'));
  const colBtn = findBtn(el('panel-body'), '购买 400 金');
  const colsBefore = fe().game.player.collections.length;
  fireClick(colBtn);
  t('Q5 购买收藏品：金币 -400 + 入 collections', fe().game.player.gold === 600 && fe().game.player.collections.length === colsBefore + 1, `gold=${fe().game.player.gold} cols=${fe().game.player.collections.length}`);
  // 收藏品不重复获得（掉落池/商店供给均排除已拥有）
  const boughtId = fe().game.player.collections[fe().game.player.collections.length - 1];
  t('Q6 收藏品不重复获得（collections 唯一）', fe().game.player.collections.filter((x) => x === boughtId).length === 1);
  fireClick(findBtn(el('panel-body'), '离开商店'));
  t('Q7 离开商店返回地图', fe().owMode === 'select');
  // newGame 清空收藏品（局内作用域）
  const colsBeforeNew = fe().game.player.collections.length;
  fe().newGame();
  t('Q8 newGame 清空收藏品（局内）', (fe().game.player.collections || []).length === 0 && colsBeforeNew > 0, `before=${colsBeforeNew}`);
}

console.log('== R. 背包详情 + 属性显示（对齐末光） ==');
{
  fe().newGame();
  fe().setRng(() => 0.5);
  // 注资一件带浮点尾差词缀的装备（haste 9.940000000000001 模拟强化累积误差）
  const gear = { id: 'g_det', name: '测试 法袍', slot: 'chest', rarityIdx: 2, stats: { def: 20, haste: 9.940000000000001, crit: 7.5 }, enhanceLv: 0, locked: false, pinned: false, score: 88, baseScore: 88, orbs: [], refineLevels: {}, refineInitialValues: {} };
  fe().game.player.inventory.push(gear);
  fe().game.player.equipment.chest = gear;
  // 装备栏槽位点击 → 背包筛选 + 自动打开详情（照抄末光 openSlotView；
  //   桩无法解析 innerHTML 字符串子元素，用 fateEcho.openBag 等效调用槽位 handler）
  fe().openBag('chest');
  t('R1 槽位筛选打开背包', el('modal-overlay').style.display === 'flex' && fe().owMode === 'panel');
  t('R2 槽位装备自动打开详情（照抄末光）', el('item-details').style.display === 'flex' && el('det-stats').textContent.length > 0);
  // 详情属性 toFixed(1) 无浮点尾差（精确匹配 >9.9%<，防 fmtNum 2 位回退误过）
  const detHtml = el('det-stats')._innerHTML;
  t('R3 详情属性 toFixed(1)（9.94…→9.9，无尾差）', !detHtml.includes('9.940000000000001') && detHtml.includes('>9.9%<'), detHtml.slice(0, 100));
  fireClick(findBtn(el('modal-foot-bar'), '关闭终端'));
  t('R3b 关闭背包返回选关', fe().owMode === 'select');
  // 背包内 eq-card 点击 → 详情（虚拟滚动三段式：需递归定位实际 eq-card 元素）
  fireClick(el('btn-bag'));
  const cardText = (node) => { let s = node.textContent || ''; for (const c of node.children) s += cardText(c); return s; };
  const findCard = (node) => {
    if (node.classList && node.classList.contains('eq-card') && cardText(node).includes('测试 法袍')) return node;
    for (const c of node.children || []) { const h = findCard(c); if (h) return h; }
    return null;
  };
  const card = findCard(el('modal-content-area'));
  t('R4 背包装备卡片存在', !!card);
  fireClick(card);
  t('R5 背包卡片点击打开详情', el('item-details').style.display === 'flex');
  fireClick(findBtn(el('modal-foot-bar'), '关闭终端'));
  // 战斗玩家面板：属性行 toFixed(1) + 永久 buff 不进 chips（照抄末光 PlayerBuffs）
  fe().game.player.level = 1;
  fe().game.player.hp = 100;
  fe().game.player.mp = 100;
  fe().forceCell('battle');
  fe().enterCurrent();
  const playerHtml = el('player-panel')._innerHTML;
  t('R6 属性行无浮点尾差（急速 toFixed(1)）', !playerHtml.includes('9.940000000000001') && playerHtml.includes('急速'), playerHtml.slice(0, 150));
  t('R7 永久装备/被动 buff 不进 chips（无中文名 ∞ 行：急速/共鸣/增伤）', !playerHtml.includes('急速 +') && !playerHtml.includes('共鸣 +') && !playerHtml.includes('增伤 +'), playerHtml.slice(0, 200));
  t('R8 属性行显示急速/共鸣数值（属性全称"攻击/防御"+ GCD 项照抄末光 stats-grid）', playerHtml.includes('急速') && playerHtml.includes('共鸣') && playerHtml.includes('攻击') && playerHtml.includes('防御') && playerHtml.includes('GCD') && playerHtml.includes('2.27s'), playerHtml.slice(0, 200));
  // 终焉全套：永久 buff 显示"终焉全套 生命/攻击 +10 ∞"（用户定案：永久写 ∞）
  fe().game.player.finaleCollection = { weapon: true, head: true, chest: true, legs: true, feet: true, pendant: true, ring: true, trinket: true };
  fe().forceCell('battle');
  fe().enterCurrent();
  const playerHtml2 = el('player-panel')._innerHTML;
  t('R9 终焉全套永久 buff chip（终焉全套 生命 +10.0 ∞）', playerHtml2.includes('终焉全套') && playerHtml2.includes('生命 +10.0') && playerHtml2.includes('∞'), playerHtml2.slice(0, 250));
  // 敌方面板是 appendChild 模式填充（桩 innerHTML 记录为空串），递归收集文本断言
  const collectText = (node) => { let s = node.textContent || ''; for (const c of node.children) s += collectText(c); return s; };
  t('R10 敌方属性全称（攻击/防御）', collectText(el('enemy-panel')).includes('攻击') && collectText(el('enemy-panel')).includes('防御'), collectText(el('enemy-panel')).slice(0, 120));
  fe().newGame(); // 收尾
}

console.log('== S. 收藏品独立背包（图鉴式展示效果） ==');
{
  fe().newGame();
  fe().setRng(() => 0.5);
  // panel-body 用 appendChild 填充（桩 innerHTML 记录为空串）→ 递归收集节点与文本
  const allNodes = (n) => [n, ...[...(n.children || [])].flatMap(allNodes)];
  const collText = (node) => { let s = node.textContent || ''; for (const c of node.children) s += collText(c); return s; };
  fireClick(el('btn-collections'));
  t('S1 收藏品面板打开（panel-overlay 弹窗）', el('panel-overlay').style.display === 'flex' && fe().owMode === 'panel');
  t('S2 标题 0/8（新游戏无收藏品）', el('panel-title').textContent.includes('0/8'), el('panel-title').textContent);
  const collCards = () => allNodes(el('panel-body')).filter((n) => n.classList && n.classList.contains('coll-item'));
  t('S3 8 种收藏品卡片齐全（coll-item）', collCards().length === 8, `n=${collCards().length}`);
  t('S4 未拥有显示 + 效果说明（攻击力 +10%）', collText(el('panel-body')).includes('未拥有') && collText(el('panel-body')).includes('攻击力 +10%') && collText(el('panel-body')).includes('治疗之泉'), collText(el('panel-body')).slice(0, 160));
  fireClick(el('panel-close'));
  // 注资后重开：已拥有标记 + 标题计数
  fe().game.player.collections = ['col_atk', 'col_heal'];
  fireClick(el('btn-collections'));
  t('S5 已拥有标记（✔ 强攻印记/治疗之泉 + 已拥有）', collText(el('panel-body')).includes('✔ 强攻印记') && collText(el('panel-body')).includes('✔ 治疗之泉') && collText(el('panel-body')).includes('已拥有'), collText(el('panel-body')).slice(0, 200));
  t('S6 标题更新 2/8', el('panel-title').textContent.includes('2/8'), el('panel-title').textContent);
  fireClick(el('panel-close'));
  t('S7 关闭返回地图', fe().owMode === 'select');
}

console.log('== T. 局外技能配置（即时保存 + 战斗生效 + 主技能守卫） ==');
{
  fe().newGame();
  fe().setRng(() => 0.5);
  fe().game.player.level = 5;
  fe().game.player.hp = 100;
  fe().game.player.mp = 100;
  fireClick(el('btn-skills'));
  t('T1 技能配置面板打开', el('panel-overlay').style.display === 'flex' && el('panel-title').textContent.includes('技能配置'));
  const countMain = (t2) => { const m = (t2 || '').match(/主技能 (\d+)/); return m ? +m[1] : -1; };
  const c1 = countMain(el('panel-title').textContent);
  t('T2 默认未配置 = 全部解锁上阵（计数>0）', c1 > 0, `c1=${c1}`);
  const rows = () => [...(el('panel-body').children || [])].filter((n) => n.classList && n.classList.contains('skill-config-item'));
  // 注意：'skill-config-item' 含子串 'on'（config），必须用 classList.contains 判定上阵态
  const firstOn = () => rows().find((r) => r.classList.contains('on'));
  const row1 = firstOn();
  const btn1 = row1 && row1.children[1];
  t('T3 主技能行有上阵按钮（点击切换）', !!btn1 && btn1.listeners && btn1.listeners.click && btn1.listeners.click.length > 0);
  fireClick(btn1);
  const c2 = countMain(el('panel-title').textContent);
  t('T4 取消后计数 -1 且即时保存（skillLoadout.main）', c2 === c1 - 1 && fe().game.player.skillLoadout && fe().game.player.skillLoadout.main.length === c2, `${c1}→${c2}`);
  t('T5 重渲染后第一行（魔力弹）已未上阵', !!rows()[0] && !rows()[0].classList.contains('on'), rows()[0] && rows()[0].className);
  fireClick(el('panel-close'));
  // 战斗生效：技能栏 = 配置后技能组（被动不渲染按钮）
  fe().forceCell('battle');
  fe().enterCurrent();
  const skillBtns = [...(el('skill-bar').children || [])].filter((n) => n.className && n.className.includes('skill-btn'));
  t('T6 战斗技能栏 = 配置后技能组', skillBtns.length === c2, `n=${skillBtns.length}`);
  // 守卫：最后 1 个主技能拒绝取消（防战斗无技能卡死）
  fe().newGame();
  fe().setRng(() => 0.5);
  fe().game.player.level = 5;
  fireClick(el('btn-skills'));
  const c3 = countMain(el('panel-title').textContent);
  for (let i = 0; i < c3 - 1; i++) { // 取消到只剩 1 个主技能
    const onRow = firstOn();
    if (!onRow) break;
    fireClick(onRow.children[1]);
  }
  const c4 = countMain(el('panel-title').textContent);
  t('T7 取消到只剩 1 个主技能', c4 === 1, `c4=${c4}`);
  fireClick(firstOn().children[1]); // 再取消 → 守卫拒绝
  t('T8 最后 1 个主技能拒绝取消（计数仍 1）', countMain(el('panel-title').textContent) === 1 && fe().game.player.skillLoadout.main.length === 1, el('panel-title').textContent);
  // 恢复全部解锁（配置不可逆闭环）
  const resetBtn = findBtn(el('panel-body'), '恢复全部解锁');
  t('T9 配置态显示「恢复全部解锁」按钮', !!resetBtn);
  fireClick(resetBtn);
  t('T10 恢复后 skillLoadout=null 且标题回到全部解锁', fe().game.player.skillLoadout === null && countMain(el('panel-title').textContent) > 1, el('panel-title').textContent);
  t('T11 恢复后按钮消失（null 态无恢复入口）', findBtn(el('panel-body'), '恢复全部解锁') === null);
  // 技能描述模板填充：desc 占位符全部替换（含 {dps}），摘要行保留（倍率/MP/CD回合）
  const descText = (node) => { let s = node.textContent || ''; for (const c of node.children) s += descText(c); return s; };
  t('T12 技能行显示填充后的具体描述（约X伤害 + 无 {dps} 残留）', descText(el('panel-body')).includes('攻击力伤害') && /约\d+）/.test(descText(el('panel-body'))) && !descText(el('panel-body')).includes('{dps}'), descText(el('panel-body')).slice(0, 250));
  t('T13 摘要行保留（倍率 × + MP + CD 回合）', descText(el('panel-body')).includes('倍率 ×1') && descText(el('panel-body')).includes('MP') && descText(el('panel-body')).includes('CD'), descText(el('panel-body')).slice(0, 200));
  fireClick(el('panel-close'));
}

console.log(`\n========== test_ui_smoke 结果：${pass} 通过 / ${fail} 失败 ==========`);
if (fail) process.exit(1);
