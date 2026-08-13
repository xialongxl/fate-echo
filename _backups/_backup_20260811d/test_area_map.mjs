// ============================================================
// tools/test_area_map.mjs — 内嵌小地图组件测试（Fate_echo Phase 4 v2，黑流树海蓝本）
// 验证：节点+连线渲染/迷雾大类色/可达白光圈/点击移动/平移 clamp/缩放 clamp/重置
// 用最小 DOM 桩（无真实布局，clientWidth 由桩提供）
// 用法: node tools/test_area_map.mjs
// ============================================================

import { AreaMapView, MAP_ZOOM_MIN, MAP_ZOOM_MAX } from '../js/area_map.js';
import { Area } from '../js/area.js';

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

// ---- 最小 DOM 桩（视口专用；含 SVG 支持；className 与 classList 双向同步同真实 DOM） ----
const makeEl = (tag) => {
  const el = {
    tag, children: [], _innerHTML: '', style: {}, disabled: false, hidden: false,
    textContent: '', listeners: {}, clientWidth: 380, clientHeight: 280, offsetWidth: 380, offsetHeight: 280,
    dataset: {}, attrs: {},
    setPointerCapture() {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
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
    remove() { this._removed = true; },
    closest(sel) { return this.classList.contains(sel.slice(1)) ? this : null; },
    get childElementCount() { return this.children.length; },
  };
  // className 与 classList 双向同步（真实 DOM 语义）
  Object.defineProperty(el, 'className', {
    get() { return [...el.classList._set].join(' '); },
    set(v) { el.classList._set = new Set(String(v).split(' ').filter(Boolean)); },
  });
  return el;
};
globalThis.document = {
  createElement: (tag) => makeEl(tag),
  createElementNS: (ns, tag) => makeEl(tag),
};
const viewport = makeEl('div');
let moves = [];
const map = new AreaMapView(viewport, { onMove: (id) => moves.push(id) });

// 确定性 rng（LCG，与 test_area 同构）
let seed = 42;
const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const area = new Area({ rng, depth: 1, areaIndex: 0 });

console.log('== A. 渲染（节点 + 连线） ==');
{
  map.render(area);
  const children = map.canvas.children;
  const nodeEls = children.slice(1); // 第一个是 SVG 连线层
  t('A1 画布创建并挂载', !!map.canvas && viewport.children.length === 1);
  t('A2 节点数 = 图中节点数', nodeEls.length === area.nodes.length, `n=${nodeEls.length}`);
  t('A3 SVG 连线层存在且连线数 = 边数', children[0].tag === 'svg' && children[0].children.length === area.edges.length, `edges=${area.edges.length}`);
  const xs = area.nodes.map((n) => n.x);
  const ys = area.nodes.map((n) => n.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  t('A4 画布尺寸按节点分布（跨度×cellSize+边距 120）', map.contentW === (maxX - minX) * 64 + 120 && map.contentH === (maxY - minY) * 64 + 120, `w=${map.contentW} h=${map.contentH}`);
  const curEl = nodeEls.find((e) => e.dataset.id === area.currentId);
  t('A5 当前位置节点高亮', !!curEl && curEl.classList.contains('current'));
  // 出口标记
  const exitEls = nodeEls.filter((e) => area.exitIds.includes(e.dataset.id));
  t('A6 出口节点标记', exitEls.length === area.exitIds.length && exitEls.every((e) => e.classList.contains('exit')));
  // 迷雾：未揭示节点 → 大类色（fog-battle/fog-event/fog）
  const fogEls = nodeEls.filter((e) => !area.nodeById(e.dataset.id).revealed);
  t('A7 未揭示节点带迷雾样式', fogEls.length > 0 && fogEls.every((e) => e.classList.contains('fog-battle') || e.classList.contains('fog-event') || e.classList.contains('fog')), `fog=${fogEls.length}`);
  // 可达节点：白光圈 + 可点击
  const reachable = area.neighbors(area.currentId).map((n) => n.id);
  const walkEls = nodeEls.filter((e) => e.classList.contains('walkable'));
  t('A8 可达节点白光圈（walkable）', walkEls.length === reachable.length, `walk=${walkEls.length} reach=${reachable.length}`);
  t('A9 可达节点无 current', walkEls.every((e) => !e.classList.contains('current')));
  // 点击可达节点 → onMove(nodeId)（pointerdown/up 判定，非 click 事件）
  moves = [];
  const firstWalk = walkEls[0];
  const down = viewport.listeners.pointerdown[0];
  const up = viewport.listeners.pointerup[0];
  down({ target: firstWalk, clientX: 100, clientY: 100, pointerId: 1 });
  up({ clientX: 101, clientY: 100, pointerId: 1 });
  t('A10 点击可达节点触发 onMove(nodeId)', moves.length === 1 && moves[0] === firstWalk.dataset.id, `moved=${moves[0]}`);
  // 位移超过阈值 = 拖拽，不触发移动
  moves = [];
  down({ target: firstWalk, clientX: 100, clientY: 100, pointerId: 2 });
  up({ clientX: 130, clientY: 120, pointerId: 2 });
  t('A10b 拖拽位移大不触发移动', moves.length === 0, `moves=${moves.length}`);
  // 点击非可达节点不触发
  moves = [];
  const nonWalk = nodeEls.find((e) => !e.classList.contains('walkable'));
  down({ target: nonWalk, clientX: 200, clientY: 200, pointerId: 3 });
  up({ clientX: 200, clientY: 200, pointerId: 3 });
  t('A10c 点击非可达节点不触发', moves.length === 0);
  // 已揭示节点显示类型图标
  const revealedEl = nodeEls.find((e) => area.nodeById(e.dataset.id).revealed && e.dataset.id !== area.currentId && !area.exitIds.includes(e.dataset.id));
  t('A11 已揭示节点显示图标', !!revealedEl && revealedEl.textContent !== '·');
}

console.log('== B. 平移 ==');
{
  map.zoom(1.5); // 先放大使内容超出视口（clamp 有意义）
  map.reset();
  map.zoom(1.5);
  const beforePan = map.viewState();
  map.pan(30, 20);
  let st = map.viewState();
  t('B1 平移更新视口偏移', st.tx !== beforePan.tx && st.ty !== beforePan.ty, `${JSON.stringify(beforePan)} → ${JSON.stringify(st)}`);
  // clamp：大幅平移不越界
  map.pan(99999, 99999);
  st = map.viewState();
  t('B2 平移 clamp（画布不脱离视口）', st.tx <= 0 && st.ty <= 0, `tx=${st.tx} ty=${st.ty}`);
  map.reset();
  st = map.viewState();
  t('B3 重置回到玩家居中（scale=1）', st.scale === 1, `tx=${st.tx}`);
}

console.log('== C. 缩放 ==');
{
  map.zoom(1.25);
  t('C1 放大生效', map.viewState().scale === 1.25);
  map.zoom(1.25);
  map.zoom(1.25);
  map.zoom(1.25);
  map.zoom(1.25);
  map.zoom(1.25);
  t('C2 放大 clamp 到上限', map.viewState().scale === MAP_ZOOM_MAX, `s=${map.viewState().scale}`);
  for (let i = 0; i < 10; i++) map.zoom(0.8);
  t('C3 缩小 clamp 到下限', map.viewState().scale === MAP_ZOOM_MIN, `s=${map.viewState().scale}`);
  map.reset();
  t('C4 重置后 scale=1', map.viewState().scale === 1);
}

console.log('== D. 事件（拖拽/滚轮） ==');
{
  // 滚轮放大
  const wheel = viewport.listeners.wheel[0];
  wheel({ deltaY: -100, preventDefault() {} });
  t('D1 滚轮上滚 → 放大', map.viewState().scale > 1);
  map.reset();
  map.zoom(1.5); // 放大后拖拽有空间
  // 拖拽平移
  const down = viewport.listeners.pointerdown[0];
  const move = viewport.listeners.pointermove[0];
  const up = viewport.listeners.pointerup[0];
  const beforeDrag = map.viewState();
  down({ clientX: 100, clientY: 100, pointerId: 1 });
  move({ clientX: 140, clientY: 130 });
  const afterDrag = map.viewState();
  t('D2 拖拽平移生效', afterDrag.tx !== beforeDrag.tx && afterDrag.ty !== beforeDrag.ty, `${JSON.stringify(beforeDrag)} → ${JSON.stringify(afterDrag)}`);
  up();
  const before = map.viewState();
  move({ clientX: 150, clientY: 140 }); // 松手后不应再移动
  t('D3 松手后停止拖拽', map.viewState().tx === before.tx && map.viewState().ty === before.ty);
}

console.log('== E. 跟随玩家（follow） ==');
{
  map.render(area);
  map.reset(); // 归零到 scale=1 起点（render 现在保留缩放，不再强制重置）
  // 玩家在中央区域（start 地图正中）：follow 应精确居中（视口 380×280 → 中心 190,140）
  map.follow();
  let st = map.viewState();
  let cur = area.nodeById(area.currentId);
  let cx = (map.originX + cur.x * map.cellSize + map.nodeSize / 2) * st.scale;
  let cy = (map.originY + cur.y * map.cellSize + map.nodeSize / 2) * st.scale;
  t('E1 跟随：中央玩家位于视口中心', Math.abs(st.tx + cx - 190) < 1 && Math.abs(st.ty + cy - 140) < 1, `tx=${st.tx} cx=${cx}`);
  // 移动到相邻节点后 follow：clamp 保证画布不越界（边缘节点贴边是物理限制）
  const nb = area.neighbors(area.currentId)[0];
  area.moveTo(nb.id);
  map.follow();
  st = map.viewState();
  t('E2 跟随后画布不越界（clamp）', st.tx <= 0 && st.tx >= 380 - map.contentW * st.scale && st.ty <= 0 && st.ty >= 280 - map.contentH * st.scale, `tx=${st.tx}`);
  // 保持缩放
  map.zoom(1.5);
  map.follow();
  st = map.viewState();
  t('E3 跟随保持当前缩放', st.scale === 1.5, `s=${st.scale}`);
  // 拖拽平移后 follow 拉回玩家（玩家在中央则精确居中）
  map.pan(-80, -50);
  map.follow();
  st = map.viewState();
  cur = area.nodeById(area.currentId);
  cx = (map.originX + cur.x * map.cellSize + map.nodeSize / 2) * st.scale;
  cy = (map.originY + cur.y * map.cellSize + map.nodeSize / 2) * st.scale;
  t('E4 平移后跟随拉回玩家（居中或贴边）', Math.abs(st.tx + cx - 190) < 1 || st.tx >= 380 - map.contentW * st.scale - 1, `tx=${st.tx} cx=${cx}`);
  map.reset();
}

console.log('== F. 缩小后内容小于视口 → 居中显示 ==');
{
  map.reset();
  map.zoom(0.6); // 内容 504×0.6=302 < 视口 380 → 应水平居中，不贴左上角
  const st = map.viewState();
  t('F1 缩小后地图水平居中（不偏左）', Math.abs(st.tx - (380 - 504 * 0.6) / 2) < 1, `tx=${st.tx} expect=${(380 - 504 * 0.6) / 2}`);
  map.reset();
  t('F2 重置后恢复（scale=1）', map.viewState().scale === 1);
}

console.log(`\n========== test_area_map 结果：${pass} 通过 / ${fail} 失败 ==========`);
if (fail) process.exit(1);
