// ============================================================
// js/area_map.js — 内嵌小地图组件（Fate_echo Phase 4 v2，黑流树海蓝本）
// 需求：黑流树海式平面节点网络以"内嵌小地图"呈现——固定视口（不撑布局），
//   地图画布可拖拽平移 / 滚轮缩放 / 按钮缩放 / 重置视野
// 渲染：SVG 连线层（通路）+ DOM 节点层（圆形节点）
//   迷雾：未观测节点仅显示大类色点（凶戾紫⚔=战斗 / 诡秘青❓=事件），
//   可达节点白光圈高亮 + 可点击移动
// 交互：
//   拖拽平移（pointerdown/move/up，clamp 边界）
//   滚轮缩放（scale 0.6~2.5，围绕视口中心）+ [＋][－] 按钮
//   [重置] 回到初始视野（玩家位置居中）
//   点击可达节点 = 移动（onMove(nodeId)）；空格进入由 main.js 处理
// ============================================================

export const MAP_ZOOM_MIN = 0.6;
export const MAP_ZOOM_MAX = 2.5;
export const MAP_ZOOM_STEP = 1.25;

// 节点图标（与 area.js NODE_ICONS 一致，避免循环依赖）
const ICONS = {
  combat: '⚔', elite: '💀', event: '❓', rest: '🏕', shop: '🏪', gacha: '🎰',
  exit: '🚪', exit_rare: '🌟', exit_boss: '👑', empty: '·',
};
const NAMES = {
  combat: '作战', elite: '紧急作战', event: '不期而遇', rest: '安全的角落', shop: '诡意行商', gacha: '命运抽卡',
  exit: '险路尽头', exit_rare: '险路小径', exit_boss: '险路恶敌', empty: '林间空地',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

export class AreaMapView {
  /**
   * @param {HTMLElement} viewport  固定尺寸容器（overflow:hidden）
   * @param {object} opts
   * @param {(nodeId: string) => void} opts.onMove  点击可达节点回调
   * @param {number} opts.cellSize  节点间距像素（默认 64）
   */
  constructor(viewport, { onMove = () => {}, cellSize = 64 } = {}) {
    this.viewport = viewport;
    this.onMove = onMove;
    this.cellSize = cellSize;
    this.nodeSize = 36;      // 节点直径 px
    this.scale = 1;
    this.tx = 0;             // 平移 px
    this.ty = 0;
    this.canvas = null;      // 内部画布（渲染后创建）
    this.area = null;
    this._dragging = null;
    this._bindViewport();
  }

  _bindViewport() {
    // 点击移动：pointerdown 记录按下目标；pointerup 时位移小于阈值 → 视为点击。
    // 不用 click 事件——setPointerCapture 会把兼容 mouse 事件（含 click）重定向到
    // viewport，节点 click 永远不触发（真实浏览器实测坑）
    this.viewport.addEventListener('pointerdown', (e) => {
      const nodeEl = e.target && (e.target.closest ? e.target.closest('.area-node') : null);
      this._press = {
        node: nodeEl && nodeEl.classList && nodeEl.classList.contains('walkable') ? nodeEl : null,
        x: e.clientX, y: e.clientY,
      };
      this._dragging = { sx: e.clientX, sy: e.clientY, ox: this.tx, oy: this.ty };
      this.viewport.setPointerCapture && this.viewport.setPointerCapture(e.pointerId);
    });
    this.viewport.addEventListener('pointermove', (e) => {
      if (!this._dragging) return;
      this.tx = this._dragging.ox + (e.clientX - this._dragging.sx);
      this.ty = this._dragging.oy + (e.clientY - this._dragging.sy);
      this._clamp();
      this._apply();
    });
    const endDrag = (e) => {
      const press = this._press;
      this._dragging = null;
      this._press = null;
      // 位移小（未拖拽）且按在可移动节点上 → 点击移动
      if (press && press.node && e && Math.abs(e.clientX - press.x) < 6 && Math.abs(e.clientY - press.y) < 6) {
        this.onMove(press.node.dataset.id);
      }
    };
    const cancelDrag = () => { this._dragging = null; this._press = null; };
    this.viewport.addEventListener('pointerup', endDrag);
    this.viewport.addEventListener('pointercancel', cancelDrag);
    this.viewport.addEventListener('wheel', (e) => {
      e.preventDefault && e.preventDefault();
      this.zoom(e.deltaY < 0 ? MAP_ZOOM_STEP : 1 / MAP_ZOOM_STEP);
    }, { passive: false });
  }

  // ---- 渲染（重绘整张地图） ----
  render(area) {
    this.area = area;
    const xs = area.nodes.map((n) => n.x);
    const ys = area.nodes.map((n) => n.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const pad = 60;
    this.contentW = (maxX - minX) * this.cellSize + pad * 2;
    this.contentH = (maxY - minY) * this.cellSize + pad * 2;
    this.originX = pad - minX * this.cellSize;   // 格点坐标 → 画布像素
    this.originY = pad - minY * this.cellSize;
    if (this.canvas) this.canvas.remove();
    this.canvas = document.createElement('div');
    this.canvas.className = 'area-map-canvas';
    this.canvas.style.width = `${this.contentW}px`;
    this.canvas.style.height = `${this.contentH}px`;
    // 连线层（SVG：通路）
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'area-map-links');
    svg.setAttribute('width', String(this.contentW));
    svg.setAttribute('height', String(this.contentH));
    for (const [aId, bId] of area.edges) {
      const a = area.nodeById(aId);
      const b = area.nodeById(bId);
      if (!a || !b) continue;
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', String(this.originX + a.x * this.cellSize + this.nodeSize / 2));
      line.setAttribute('y1', String(this.originY + a.y * this.cellSize + this.nodeSize / 2));
      line.setAttribute('x2', String(this.originX + b.x * this.cellSize + this.nodeSize / 2));
      line.setAttribute('y2', String(this.originY + b.y * this.cellSize + this.nodeSize / 2));
      svg.appendChild(line);
    }
    this.canvas.appendChild(svg);
    // 节点层（迷雾 + 状态 + 可达高亮）
    for (const n of area.nodes) {
      const node = document.createElement('div');
      node.className = 'area-node';
      node.dataset.id = n.id;
      node.style.left = `${this.originX + n.x * this.cellSize}px`;
      node.style.top = `${this.originY + n.y * this.cellSize}px`;
      node.style.width = `${this.nodeSize}px`;
      node.style.height = `${this.nodeSize}px`;
      const isCurrent = n.id === area.currentId;
      const isExit = area.exitIds.includes(n.id);
      if (isCurrent) node.classList.add('current');
      else if (isExit) node.classList.add('exit');
      if (n.cleared) node.classList.add('cleared');
      // 显示：当前 🧭 / 已揭示类型图标 / 未揭示大类色点（黑流树海迷雾）
      let icon;
      if (isCurrent) icon = '🧭';
      else if (n.revealed || isExit) icon = ICONS[n.type] || '·';
      else {
        icon = { combat: '⚔', elite: '⚔', event: '❓', rest: '❓', shop: '❓', gacha: '❓', empty: '·' }[n.type] || '·';
        node.classList.add(['combat', 'elite'].includes(n.type) ? 'fog-battle'
          : ['event', 'rest', 'shop', 'gacha'].includes(n.type) ? 'fog-event' : 'fog');
      }
      node.textContent = icon;
      node.title = `${isCurrent ? '当前位置 · ' : ''}${NAMES[n.type] || n.type}${isExit ? '（出口）' : ''}`;
      // 可达（有通路相连）：白光圈（点击移动由 viewport pointerup 判定触发）
      const adjacent = area.neighbors(area.currentId).some((nb) => nb.id === n.id);
      if (adjacent && !isCurrent) {
        node.classList.add('walkable');
      }
      this.canvas.appendChild(node);
    }
    this.viewport.appendChild(this.canvas);
    // 重建后跟随玩家（保留当前缩放，不重置回 100%）；首次渲染 scale=1 等同居中
    this.follow();
  }

  // ---- 视口操作 ----
  // 重置视野：玩家位置居中（scale=1）
  reset() {
    if (!this.canvas || !this.area) return;
    const vw = this.viewport.clientWidth || this.viewport.offsetWidth || 380;
    const vh = this.viewport.clientHeight || this.viewport.offsetHeight || 280;
    this.scale = 1;
    this._centerOnPlayer(vw, vh);
  }

  // 跟随玩家：移动后把玩家平移到视口中心（保持当前缩放；边缘处受 clamp 限制）
  follow() {
    if (!this.canvas || !this.area) return;
    const vw = this.viewport.clientWidth || this.viewport.offsetWidth || 380;
    const vh = this.viewport.clientHeight || this.viewport.offsetHeight || 280;
    this._centerOnPlayer(vw, vh);
  }

  _centerOnPlayer(vw, vh) {
    const cur = this.area.nodeById(this.area.currentId) || this.area.nodes[0];
    const cx = (this.originX + cur.x * this.cellSize + this.nodeSize / 2) * this.scale;
    const cy = (this.originY + cur.y * this.cellSize + this.nodeSize / 2) * this.scale;
    this.tx = vw / 2 - cx;
    this.ty = vh / 2 - cy;
    this._clamp();
    this._apply();
  }

  // 缩放（围绕视口中心；clamp 0.6~2.5）
  zoom(factor) {
    const vw = this.viewport.clientWidth || this.viewport.offsetWidth || 380;
    const vh = this.viewport.clientHeight || this.viewport.offsetHeight || 280;
    const old = this.scale;
    const next = Math.min(MAP_ZOOM_MAX, Math.max(MAP_ZOOM_MIN, old * factor));
    const k = next / old;
    // 保持视口中心点不动
    this.tx = vw / 2 - (vw / 2 - this.tx) * k;
    this.ty = vh / 2 - (vh / 2 - this.ty) * k;
    this.scale = next;
    this._clamp();
    this._apply();
  }

  pan(dx, dy) {
    this.tx += dx;
    this.ty += dy;
    this._clamp();
    this._apply();
  }

  // 平移边界 clamp：内容小于视口 → 居中显示（不贴左上角/不偏左）；
  // 内容大于视口 → 画布不脱离视口过多（边缘贴边是物理限制）
  _clamp() {
    if (!this.canvas) return;
    const vw = this.viewport.clientWidth || this.viewport.offsetWidth || 380;
    const vh = this.viewport.clientHeight || this.viewport.offsetHeight || 280;
    const cw = this.contentW * this.scale;
    const ch = this.contentH * this.scale;
    if (cw <= vw) this.tx = (vw - cw) / 2;
    else this.tx = Math.min(0, Math.max(vw - cw, this.tx));
    if (ch <= vh) this.ty = (vh - ch) / 2;
    else this.ty = Math.min(0, Math.max(vh - ch, this.ty));
  }

  _apply() {
    if (this.canvas) {
      this.canvas.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
    }
  }

  // 视口变换状态（测试/调试）
  viewState() {
    return { scale: this.scale, tx: this.tx, ty: this.ty };
  }
}
