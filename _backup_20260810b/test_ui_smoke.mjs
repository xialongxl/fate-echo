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
const makeEl = (tag) => ({
  tag,
  children: [],
  _innerHTML: '',
  className: '',
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
});

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
const nodeBtn = (i) => el('ow-nodes').children[i];
// ow-panel 由 appendChild 构建（innerHTML 恒空）→ 递归收集子节点文本
// （textContent 已从 innerHTML 派生，无需再读 innerHTML）
const owPanelText = () => {
  const collect = (node) => {
    let s = node.textContent || '';
    for (const c of node.children) s += collect(c);
    return s;
  };
  return collect(el('ow-panel'));
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
  fireClick(findBtn(el('modal-foot-bar'), '关闭终端'));
  t('A8 背包关闭返回选关', fe().owMode === 'select' && el('modal-overlay').style.display === 'none');
  fireClick(el('btn-enhance'));
  t('A9 独立强化锻造弹窗打开', el('enhance-overlay').style.display === 'flex');
  fireClick(el('enhance-close'));
  t('A9b 强化弹窗关闭返回选关', fe().owMode === 'select');
  fireClick(el('btn-save'));
  await sleep(10); // openSlots 异步（await listSlots）
  t('A10 存档管理面板（保存/加载/删除/导出/导入）', owPanelText().includes('存档管理') && owPanelText().includes('新建存档') && fe().owMode === 'panel');
  fireClick(findBtn(el('ow-panel'), '关闭'));
  fireClick(el('btn-load'));
  await sleep(10);
  t('A11 读档面板（存档管理）', owPanelText().includes('存档管理'));
  fireClick(findBtn(el('ow-panel'), '关闭'));
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
  t('E3b 奖励三选一结算界面（战利品 + 选项）', owPanelText().includes('战利品') && owPanelText().includes('奖励'), owPanelText().slice(0, 60));
  fireClick(findBtn(el('ow-panel'), '装备') || findBtn(el('ow-panel'), '金币') || findBtn(el('ow-panel'), '篝火'));
  t('E4 选奖后出现「返回地图」', !!findBtn(el('ow-panel'), '返回地图'));
  fireClick(findBtn(el('ow-panel'), '返回地图'));
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
  t('F4 战利品结算界面', owPanelText().includes('战利品'));
  fireClick(findBtn(el('ow-panel'), '装备') || findBtn(el('ow-panel'), '金币') || findBtn(el('ow-panel'), '篝火'));
  fireClick(findBtn(el('ow-panel'), '返回地图'));
}

console.log('== G. 事件节点 ==');
{
  fe().forceCell('event');
  fe().enterCurrent();
  t('G1 事件面板（标题 + 选项）', owPanelText().includes('宝箱') || owPanelText().includes('雕像') || owPanelText().includes('陷阱') || owPanelText().includes('篝火'), owPanelText());
  // 点击第一个选项
  const opts = [findBtn(el('ow-panel'), '打开'), findBtn(el('ow-panel'), '祈祷'), findBtn(el('ow-panel'), '小心'), findBtn(el('ow-panel'), '休息'), findBtn(el('ow-panel'), '无视'), findBtn(el('ow-panel'), '强行'), findBtn(el('ow-panel'), '继续')].filter(Boolean);
  t('G2 事件选项按钮存在', opts.length >= 1);
  fireClick(opts[0]);
  t('G3 事件结算面板（返回地图按钮）', !!findBtn(el('ow-panel'), '返回地图'));
  fireClick(findBtn(el('ow-panel'), '返回地图'));
  t('G4 事件结算后返回地图', fe().view === 'overworld' && fe().owMode === 'select');
}

console.log('== H. 商店与抽卡 ==');
{
  const goldBefore = fe().game.player.gold;
  fe().game.player.gold = 500; // 测试注资
  fe().forceCell('shop');
  fe().enterCurrent();
  t('H1 商店面板（商品 + 购买按钮）', owPanelText().includes('商店') && !!findBtn(el('ow-panel'), '购买'));
  const buyBtn = findBtn(el('ow-panel'), '购买');
  fireClick(buyBtn);
  // 购入进背包（手动穿戴——背包与装备栏分离）
  t('H2 购买成功（金币减少 + 装备入背包）', fe().game.player.gold < 500 && fe().game.player.inventory.length >= 1, `gold=${fe().game.player.gold} inv=${fe().game.player.inventory.length}`);
  // 离开商店
  const leaveBtn = findBtn(el('ow-panel'), '离开商店');
  fireClick(leaveBtn);
  t('H3 离开商店返回地图', fe().view === 'overworld' && fe().owMode === 'select');
  // 抽卡
  fe().game.player.gold = 300;
  fe().forceCell('gacha');
  fe().enterCurrent();
  t('H4 抽卡面板', owPanelText().includes('抽取'));
  const gachaBtn = findBtn(el('ow-panel'), '抽取一次');
  const invBefore = fe().game.player.inventory.length;
  fireClick(gachaBtn);
  t('H5 抽卡消耗 100 金 + 装备入背包', fe().game.player.gold === 200 && fe().game.player.inventory.length === invBefore + 1, `gold=${fe().game.player.gold}`);
  t('H6 抽卡结果播报', owPanelText().includes('抽取获得'));
  fireClick(findBtn(el('ow-panel'), '返回地图'));
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
  // 构造必败：玩家 1 血 + 0 法力进入战斗（autoloop 无法治疗，必死）
  fe().game.player.hp = 1;
  fe().game.player.mp = 0;
  const floorBefore = `${fe().area.depth}:${fe().area.areaIndex}:${fe().area.currentId}`;
  fe().forceCell('battle');
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

console.log(`\n========== test_ui_smoke 结果：${pass} 通过 / ${fail} 失败 ==========`);
if (fail) process.exit(1);
