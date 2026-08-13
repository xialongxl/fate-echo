// ============================================================
// js/ui.js — 战斗界面渲染（Fate_echo Phase 1 骨架）
// 事件订阅模式（NEW_GAME.md §6.4）：engine.on('refresh'/'log'/'end')
// 纯渲染无逻辑：所有判定走 engine（queueMain/queueInstant 返回原因，
// 拒绝时 toast 提示）
// ============================================================

const MAIN_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
const INSTANT_KEYS = ['Q', 'E', 'R', 'T'];

// 品质显示（末光 9 档 color：q0~q8 品质色类名）
const rarityName = (idx) => (GEAR_RARITY_REF[idx] && GEAR_RARITY_REF[idx].name) || '未知';
const rarityClass = (idx) => (GEAR_RARITY_REF[idx] && GEAR_RARITY_REF[idx].color) || 'q0';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTurns = (n) => (Number.isFinite(n) ? n : '∞');
// buff 中文名（末光 player-buffs.js STAT_LABELS 照抄：buff 显示真实中文名，不写内部变量名）
const STAT_LABELS = { versa: '共鸣', haste: '急速', crit: '暴击', dmg_up_pct: '增伤', hp_pct: '生命', atk_pct: '攻击' };
const statLabel = (stat) => STAT_LABELS[stat] || stat;
const blockBar = (cur, max, ch = '▮') => {
  const filled = Math.max(0, Math.min(max, Math.round(cur)));
  return ch.repeat(filled) + '▯'.repeat(Math.max(0, max - filled));
};

export class BattleUI {
  constructor(engine, els) {
    this.engine = engine;
    this.els = els; // {phaseEl, enemyPanel, playerPanel, resourceBar, skillBar, toast, logEl, modeEl?}
    this.unsubs = [
      engine.on('refresh', () => this.render()),
      engine.on('log', (e) => this.appendLog(e)),
      engine.on('end', () => this.render()),
    ];
    this._toastTimer = null;
    this._auto = false;
    this.render();
  }

  destroy() {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    clearTimeout(this._toastTimer); // 重开战斗中旧定时器不得隐藏新战斗的 toast
  }

  // 自动循环模式（main.js Tab 切换）：模式指示 + 交互禁用
  setMode(auto) {
    this._auto = auto;
    const el = this.els.modeEl;
    if (el) {
      el.textContent = auto ? '⚡ 自动' : '手动';
      el.classList.toggle('auto', auto);
    }
    this.render();
  }

  toast(text) {
    const el = this.els.toast;
    el.textContent = text;
    el.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { el.hidden = true; }, 1600);
  }

  // ---------- 主渲染 ----------
  render() {
    this._renderPhase();
    this._renderEnemies();
    this._renderPlayer();
    this._renderResources();
    this._renderSkills();
  }

  _renderPhase() {
    const e = this.engine;
    const el = this.els.phaseEl;
    if (e.phase === 'ended') {
      el.textContent = e.result === 'victory' ? '🎉 胜利！' : '💀 失败';
      el.style.color = e.result === 'victory' ? 'var(--ok)' : 'var(--damage)';
    } else {
      el.textContent = `回合 ${e.turn} · 你的行动`;
      el.style.color = 'var(--accent)';
    }
  }

  // ---------- 敌方 ----------
  _renderEnemies() {
    const panel = this.els.enemyPanel;
    panel.innerHTML = '';
    const e = this.engine;
    for (let i = 0; i < e.enemies.length; i++) {
      const u = e.enemies[i];
      const card = document.createElement('div');
      card.className = 'unit-card';
      card.innerHTML = `
        <div class="unit-head">
          <span class="unit-name">${esc(u.name)}</span>
          <span class="unit-lv">${u.name.includes('Lv') ? '' : `Lv.${esc(u.level)}`}${e.targetIndex === i ? ' ←' : ''}</span>
        </div>
        <div class="bar hp"><div class="fill" style="width:${(u.hpPct() * 100).toFixed(1)}%"></div>
          <div class="bar-text">${u.hp}/${u.maxHp}</div></div>
        <div class="unit-stats">
          <span>攻击 <b>${esc(u.atk)}</b></span>
          <span>防御 <b>${esc(u.def)}</b></span>
        </div>
        <div class="status-chips">${this._enemyChips(u)}</div>`;
      card.classList.add('unit-panel', 'enemy', 'selectable');
      if (e.targetIndex === i) card.classList.add('selected');
      if (!u.alive) card.classList.add('dead');
      card.addEventListener('click', () => { if (e.selectTarget(i)) this.toast(`目标：${u.name}`); });
      panel.appendChild(card);
    }
  }

  _enemyChips(u) {
    const chips = [];
    for (const d of u.dots) chips.push(`<span class="chip" title="每回合伤害">☠ ${esc(d.stateName || 'dot')} ${fmtTurns(d.turns)}</span>`);
    if (u.vulnTurns > 0) chips.push(`<span class="chip vuln" title="受击放大">易伤 ×${u.vulnMult} ${fmtTurns(u.vulnTurns)}</span>`);
    if (u.enraged) chips.push('<span class="chip immune" title="Boss 狂暴：攻击提升">狂暴</span>');
    if (u.dotImmune) chips.push('<span class="chip" title="免疫持续伤害">dot 免疫</span>');
    for (const b of u.buffs) chips.push(`<span class="chip" title="增益">${esc(statLabel(b.stat))} +${Number(b.val).toFixed(1)} ${fmtTurns(b.turns)}</span>`);
    if (!u.alive) chips.push('<span class="chip dead">已倒下</span>');
    return chips.join('');
  }

  // ---------- 我方 ----------
  _renderPlayer() {
    const panel = this.els.playerPanel;
    const p = this.engine.player;
    panel.innerHTML = `
      <div class="unit-head">
        <span class="unit-name">${esc(p.name)}</span>
        <span class="unit-lv">Lv.${esc(p.level)}</span>
      </div>
      <div class="bar hp"><div class="fill" style="width:${(p.hpPct() * 100).toFixed(1)}%"></div>
        <div class="bar-text">${p.hp}/${p.maxHp}</div></div>
      <div class="bar mp"><div class="fill" style="width:${(p.mpPct() * 100).toFixed(1)}%"></div>
        <div class="bar-text">${p.mp}/${p.maxMp}</div></div>
      <div class="unit-stats">
        <span>攻击 <b>${esc(p.atk)}</b></span>
        <span>防御 <b>${esc(p.def)}</b></span>
        <span>急速 <b>${esc(p.statBonus('haste').toFixed(1))}</b></span>
        <span>暴击 <b>${(p.totalCritChance() * 100).toFixed(1)}%</b></span>
        <span>共鸣 <b>${esc(p.statBonus('versa').toFixed(1))}</b></span>
        <span>增伤 <b>${esc(p.statBonus('dmg_up_pct').toFixed(1))}%</b></span>
        <span title="全局冷却：急速缩短 GCD（回合制下 AP 上限承担 GCD 限制，每 10% 急速增加 1 点 AP 上限）">GCD <b>${(2.5 / (1 + p.statBonus('haste') / 100)).toFixed(2)}s</b></span>
      </div>
      <div class="status-chips">${this._playerChips(p)}</div>`;
  }

  _playerChips(p) {
    const chips = [];
    if (p.shield) chips.push(`<span class="chip shield" title="吸收护盾">🛡 ${p.shield.hp} ${fmtTurns(p.shield.turns)}</span>`);
    if (p.immuneTurns > 0) chips.push(`<span class="chip immune">无敌 ${fmtTurns(p.immuneTurns)}</span>`);
    if (p.dotEnhanced > 0) chips.push(`<span class="chip" title="dot 每回合双结算">化身 ${fmtTurns(p.dotEnhanced)}</span>`);
    if (p.vulnTurns > 0) chips.push(`<span class="chip vuln">易伤 ×${p.vulnMult} ${fmtTurns(p.vulnTurns)}</span>`);
    for (const h of p.hots) chips.push(`<span class="chip hot">回复 ${Math.round(h.pct * 100)}% ${fmtTurns(h.turns)}</span>`);
    for (const b of p.buffs) {
      // 照抄末光 PlayerBuffs：限时 buff（数字+回合）照常显示，中文名；
      //   永久 buff 仅终焉全套（finale: 前缀）显示——col:/eq:/orb: 装备/宝珠/
      //   收藏品属性已并入属性行 statBonus、passive: 被动常驻有"增伤"行，不重复展示；
      //   永久 buff 写 ∞（临时 buff = 数字+回合，∞ 直观对应永久）；
      //   值 toFixed(1) 去浮点尾差
      if (b.turns === Infinity && !(b.key && b.key.startsWith('finale:'))) continue;
      const label = b.key && b.key.startsWith('finale:') ? '终焉全套' : statLabel(b.stat);
      chips.push(`<span class="chip" title="增益">${esc(label)} ${esc(statLabel(b.stat))} +${Number(b.val).toFixed(1)} ${fmtTurns(b.turns)}</span>`);
    }
    for (const d of this.engine.domains) {
      // §6.3 领域：剩余回合 + 特殊规则生效状态（烈焰层数）
      const rule = d.type === 'flame' && d.stacks > 0 ? ` ×${1 + d.stacks * 0.1}` : '';
      chips.push(`<span class="chip domain" title="领域（每回合伤害）${rule}">${esc(d.stateName || d.type)} ${fmtTurns(d.turns)}${rule}</span>`);
    }
    return chips.join('');
  }

  // ---------- 资源（AP / 瞬发槽） ----------
  _renderResources() {
    const e = this.engine;
    const queuedMains = e.pending.filter((a) => a.kind === 'main').length;
    const remain = Math.max(0, e.ap - queuedMains);
    const instantQueued = e.pending.some((a) => a.kind === 'instant');
    this.els.resourceBar.innerHTML = `
      <span class="resource" title="行动点：主技能消耗 1 点，每 10% 急速 +1 上限">
        AP ${blockBar(remain, e.apMax)} <b>${remain}/${e.apMax}</b>
      </span>
      <span class="resource instant" title="瞬发槽：每回合 1 个，不占行动点">
        瞬发 ${instantQueued ? '● 已用' : '○ 可用'}
      </span>
      <span class="resource" title="每回合自然回复 1% 最大法力">回蓝 +1%/回合</span>`;
  }

  // ---------- 技能按钮 ----------
  _renderSkills() {
    const bar = this.els.skillBar;
    bar.innerHTML = '';
    const e = this.engine;
    const mains = e.playerSkills.filter((s) => !s.isInstant && !s.isPassive);
    const instants = e.playerSkills.filter((s) => s.isInstant);
    const isQueued = (s) => e.pending.some((a) => a.skill === s);
    const target = e.enemies && e.enemies[e.targetIndex] || (e.enemies && e.enemies[0]);

    // 动态数值预览（末光 renderDynamicDesc 照抄：实际伤害/治疗/护盾量，替代纯倍率）
    const preview = (skill) => {
      if (!target) return '';
      const p = e.player;
      const eff = skill.effectRounds && skill.effectRounds[0];
      if (skill.dmgMult > 0) {
        const d = calcDamageRef(p, target, skill.dmgMult, { noCrit: true });
        return `伤害≈${d}`;
      }
      if (eff && eff.type === 'heal') return `治疗≈${Math.round(Math.max(p.atk, p.def) * (eff.val || 0))}`;
      if (eff && eff.type === 'hot') return `恢复≈${Math.round(p.maxHp * (eff.pct || 0))}/回合`;
      if (eff && eff.type === 'shield') return `护盾≈${Math.round(p.maxHp * (eff.hpPct || 0))}`;
      if (eff && eff.type === 'dot') return `dot≈${Math.round(p.atk * (eff.dps || 0))}/回合`;
      return '';
    };

    const mkBtn = (skill, keyLabel, isInstant) => {
      const queued = isQueued(skill);
      const btn = document.createElement('button');
      btn.className = `skill-btn${isInstant ? ' instant' : ''}${queued ? ' queued' : ''}`;
      // 禁用条件（engine 纯校验，无副作用；已入队 → 允许点击取消；自动模式全禁）
      const reason = isInstant ? e.canQueueInstant(skill.id) : e.canQueueMain(skill.id);
      btn.disabled = this._auto || (queued ? false : reason !== '');
      if (reason && !this._auto) btn.title = reason;
      const cd = skill.currentCd > 0 ? `CD ${skill.currentCd}` : '就绪';
      const mp = skill.cost > 0 ? `MP ${skill.cost}` : '无耗';
      // 动态描述（末光照抄）：实际伤害/治疗值优先，倍率兜底
      const dyn = preview(skill);
      const mult = skill.dmgMult > 0 ? `×${skill.dmgMult}` : '';
      const meta = queued ? '✓ 已入队' : [dyn || mult, mp, cd].filter(Boolean).join(' · ');
      btn.innerHTML = `
        <span class="key">[${esc(keyLabel)}]</span><span class="sname">${esc(skill.name)}</span>
        <span class="meta">${meta}</span>
        ${skill.cdRounds > 0 && skill.currentCd > 0 ? `<span class="cd-mask" style="height:${Math.min(100, Math.round((skill.currentCd / skill.cdRounds) * 100))}%"></span>` : ''}`;
      btn.addEventListener('click', () => {
        if (this._auto) return; // 自动模式双保险（按钮已禁用）
        if (queued) {
          e.unqueue(skill.id);
          this.toast(`已取消：${skill.name}`);
        } else {
          const r = isInstant ? e.queueInstant(skill.id) : e.queueMain(skill.id);
          this.toast(r.ok ? `已入队：${skill.name}` : `${skill.name}：${r.reason}`);
        }
      });
      bar.appendChild(btn);
    };

    mains.forEach((s, i) => mkBtn(s, MAIN_KEYS[i] || '·', false));
    instants.forEach((s, i) => mkBtn(s, INSTANT_KEYS[i] || '·', true));
  }

  // ---------- 日志 ----------
  appendLog(entry) {
    const el = this.els.logEl;
    // 用户已向上滚动查看历史时（↑↓）不强制拉回底部；在底部才跟随
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    const line = document.createElement('div');
    line.className = `log-line type-${esc(entry.type)}${entry.side === 'enemy' ? ' side-enemy' : ''}`;
    line.innerHTML = `<span class="rt">[R${entry.turn}]</span>${esc(entry.text)}`;
    el.appendChild(line);
    // 防 DOM 无限膨胀：保留最近 300 条
    while (el.childElementCount > 300) el.removeChild(el.firstChild);
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }
}

// ============================================================
// OverworldUI — 塔外视图（Phase 4：树状图选关/商店/事件/抽卡/结算）
// 与 BattleUI 同风格：纯渲染，回调注入（onNode/onOption/onBuy/onGacha/onNewGame/onContinue/onLeave）
// ============================================================
export class OverworldUI {
  constructor(els, handlers) {
    this.els = els;           // {owPlayer, owEquipped, owTower, toast?}
    this.handlers = handlers; // {onNode(i), onOption(id), onBuy(id), onSell(id), onGacha(), onNewGame(), onContinue(), onLeave(), onNodeConfirmEnter/Cancel}
    this._toastTimer = null;
  }

  toast(text) {
    const el = this.els.toast;
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { el.hidden = true; }, 1600);
  }

  // 区域主视图：玩家面板 + 常驻装备栏 + 区域信息（黑流树海网状探索）
  renderTower(game, area) {
    // 地图由 AreaMapView（js/area_map.js）在 #area-map 视口内渲染；
    // 此处只更新玩家/装备栏/区域信息面板
    this._renderPlayer(game);
    this._renderEquipped(game);
    this._renderTowerInfo(game, area);
  }

  // 通用交互面板（读档/帮助/商店/事件/抽卡——弹窗形式，用户定案：
  //   与背包同款 modal-overlay；结算类走 #result-overlay）
  renderPanel(title, bodyFn) {
    const overlay = document.getElementById('panel-overlay');
    const titleEl = document.getElementById('panel-title');
    const body = document.getElementById('panel-body');
    if (titleEl) titleEl.textContent = title;
    if (body) { body.innerHTML = ''; bodyFn(body); }
    if (overlay) overlay.style.display = 'flex';
  }
  closePanel() {
    const overlay = document.getElementById('panel-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  renderShop(game, stock, priceFn = priceOf, atm = null, collectionStock = null) {
    this.renderPanel('🏪 商店', (panel) => {
      const gold = document.createElement('div');
      gold.className = 'panel-text gold-line';
      gold.textContent = `金币：${game.player.gold}`;
      panel.appendChild(gold);
      for (const eq of stock) {
        const row = document.createElement('div');
        row.className = 'shop-item';
        const info = document.createElement('span');
        info.innerHTML = `${esc(eq.name)} <span class="rarity ${rarityClass(eq.rarityIdx)}">${rarityName(eq.rarityIdx)}</span> · 评分 ${eq.score} · ${statsText(eq)}`;
        row.appendChild(info);
        const buy = document.createElement('button');
        buy.className = 'opt-btn';
        buy.textContent = `购买 ${priceFn(eq)} 金`;
        buy.disabled = game.player.gold < priceFn(eq);
        buy.addEventListener('click', () => this.handlers.onBuy(eq.id));
        row.appendChild(buy);
        panel.appendChild(row);
      }
      // ---- ATM 存款机（前瞻性投资系统，黑流树海蓝本） ----
      if (atm) {
        const info = atmRewardInfoRef(atm.total);
        const divider = document.createElement('div');
        divider.className = 'panel-text atm-title';
        divider.textContent = '── 前瞻性投资系统 ──';
        panel.appendChild(divider);
        const bal = document.createElement('div');
        bal.className = 'panel-text gold-line';
        bal.textContent = `存款余额：${atm.balance} · 历史累计投资：${atm.total}`;
        panel.appendChild(bal);
        if (info.unlocked.length) {
          const ul = document.createElement('div');
          ul.className = 'panel-text atm-rewards';
          ul.textContent = '已解锁：' + info.unlocked.map((r) => r.desc).join('；');
          panel.appendChild(ul);
        }
        const nx = document.createElement('div');
        nx.className = 'panel-text atm-next';
        nx.textContent = info.next
          ? `下一奖励（累计 ${info.next.threshold}）：${info.next.desc}（还差 ${info.nextGap}）`
          : '🎉 全部投资奖励已解锁！';
        panel.appendChild(nx);
        const note = document.createElement('div');
        note.className = 'panel-text atm-rewards';
        note.textContent = '折扣即时生效；商品扩容于下次进店生效；金酒之杯（250）战斗/出口金币 +10%。';
        panel.appendChild(note);
        // 存款行（金币 → 全局余额）
        const depRow = document.createElement('div');
        depRow.className = 'btn-row';
        for (const d of ATM_DENOMS_REF) {
          const b = document.createElement('button');
          b.className = 'opt-btn';
          b.textContent = `存 ${d}`;
          b.disabled = game.player.gold < d;
          b.addEventListener('click', () => this.handlers.onDeposit(d));
          depRow.appendChild(b);
        }
        panel.appendChild(depRow);
        // 取款行（累计 15 解锁；1:1 无损——以撒捐款机"钱拿回来"语义）
        const witRow = document.createElement('div');
        witRow.className = 'btn-row';
        const wUnlocked = canWithdrawRef(atm.total);
        for (const d of ATM_DENOMS_REF) {
          const b = document.createElement('button');
          b.className = 'opt-btn';
          b.textContent = `取 ${d}`;
          b.disabled = !wUnlocked || atm.balance < d;
          b.title = wUnlocked ? '' : '累计投资 15 后解锁取款';
          b.addEventListener('click', () => this.handlers.onWithdraw(d));
          witRow.appendChild(b);
        }
        panel.appendChild(witRow);
      }
      // ---- 收藏品售卖区（局内：战斗掉落 + 商店购买；价格统一 400，用户定案） ----
      if (collectionStock && collectionStock.length) {
        const collTitle = document.createElement('div');
        collTitle.className = 'panel-text atm-title';
        collTitle.textContent = '── 收藏品 ──';
        panel.appendChild(collTitle);
        // 已拥有列表
        const owned = (game.player.collections || []).map((id) => COLLECTIONS_REF.find((c) => c.id === id)).filter(Boolean);
        if (owned.length) {
          const have = document.createElement('div');
          have.className = 'panel-text atm-rewards';
          have.textContent = '已拥有：' + owned.map((c) => `【${c.name}】`).join(' ');
          panel.appendChild(have);
        }
        for (const c of collectionStock) {
          const row = document.createElement('div');
          row.className = 'shop-item';
          const info = document.createElement('span');
          info.innerHTML = `<b>${esc(c.name)}</b> <span class="node-sub">${esc(c.desc)}</span>`;
          row.appendChild(info);
          const buy = document.createElement('button');
          buy.className = 'opt-btn';
          buy.textContent = `购买 ${COLLECTION_PRICE_REF} 金`;
          buy.disabled = game.player.gold < COLLECTION_PRICE_REF;
          buy.addEventListener('click', () => this.handlers.onBuyCollection(c.id));
          row.appendChild(buy);
          panel.appendChild(row);
        }
      }
      const row = document.createElement('div');
      row.className = 'btn-row';
      const leave = document.createElement('button');
      leave.className = 'opt-btn';
      leave.textContent = '离开商店';
      leave.addEventListener('click', () => this.handlers.onLeave());
      row.appendChild(leave);
      panel.appendChild(row);
    });
  }

  // ============================================================
  // 背包 Modal（末光咏叹 terminal 照抄：标题+排序 / 虚拟滚动物品网格 /
  //   详情面板（锁定/防换/卸下/穿戴/分解/宝珠/精炼入口）/ 底部栏（批量分解）
  // ============================================================
  openBackpack(game, { filterSlot = null } = {}) {
    // 照抄末光 openSlotView（ui.js:385-394）：装备栏槽位点击 → 背包筛选 +
    //   槽位有装备时自动打开该装备详情
    const eqGear = filterSlot ? (game.player.equipment && game.player.equipment[filterSlot]) : null;
    this.bagState = {
      game,
      filterSlot,          // null=全部 | slot=部位筛选
      sortMode: 'default', // 'default' | 'score_desc' | 'score_asc'
      batchMode: false,
      batchChecked: new Set(),
      detail: eqGear ? { gear: eqGear, isEquipped: true } : null, // { gear, isEquipped }
    };
    const overlay = document.getElementById('modal-overlay');
    if (overlay) overlay.style.display = 'flex';
    this._renderBackpack();
  }

  closeBackpack() {
    const overlay = document.getElementById('modal-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  _backpackItems() {
    const st = this.bagState;
    let items = (st.game.player.inventory || []).slice();
    if (st.filterSlot) items = items.filter((g) => g.slot === st.filterSlot);
    if (st.sortMode === 'score_desc') items.sort((a, b) => b.score - a.score);
    else if (st.sortMode === 'score_asc') items.sort((a, b) => a.score - b.score);
    return items;
  }

  _renderBackpack() {
    const st = this.bagState;
    const title = document.getElementById('modal-title');
    if (title) {
      title.textContent = st.filterSlot
        ? `🎒 装备选取 - ${SLOT_NAMES_REF[st.filterSlot] || st.filterSlot}`
        : `🎒 星盘背包 (${(st.game.player.inventory || []).length})`;
    }
    // 排序按钮
    const sortBtn = document.getElementById('btn-sort-backpack');
    if (sortBtn) {
      const label = { default: '默认顺序', score_desc: '评分 ↓', score_asc: '评分 ↑' }[st.sortMode];
      sortBtn.textContent = label;
      sortBtn.onclick = () => this.handlers.onSortCycle();
    }
    // 内容区（虚拟滚动）
    const area = document.getElementById('modal-content-area');
    if (!area) return;
    const items = this._backpackItems();
    area.className = 'scroll-area';
    this._setupVirtualScroll(area, items, (gear, i, ctx) => this._renderEqCard(gear, i, ctx), {
      columns: 4, itemHeight: 66, rowGap: 12, bufferRows: 3,
    });
    // 详情面板
    if (st.detail) {
      this._renderGearDetail(st.detail.gear, st.detail.isEquipped);
    } else {
      const det = document.getElementById('item-details');
      if (det) det.style.display = 'none';
    }
    this._renderModalFoot();
  }

  // 物品卡片（末光 eq-card：名称+品质色+强化+📌/🔒/⚔️ + 评分行）
  _renderEqCard(gear, i, ctx) {
    const card = document.createElement('div');
    card.className = 'eq-card';
    const st = this.bagState;
    const isEquipped = !!st.game.player.equipment[gear.slot] && st.game.player.equipment[gear.slot] === gear;
    if (st.batchMode) {
      card.classList.add('batch');
      const locked = gear.locked || gear.pinned || isEquipped;
      if (locked) card.classList.add('disabled');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'batch-check';
      cb.checked = st.batchChecked.has(i);
      cb.disabled = locked;
      cb.addEventListener('change', () => this.handlers.onBatchToggle(i, cb.checked));
      card.appendChild(cb);
    } else {
      card.addEventListener('click', () => {
        st.detail = { gear, isEquipped: !!isEquipped };
        this._renderBackpack();
      });
    }
    let label = esc(gear.name);
    if (gear.enhanceLv > 0) label += '+' + gear.enhanceLv;
    if (gear.pinned) label += ' 📌';
    else if (gear.locked) label += ' 🔒';
    if (isEquipped) label += ' ⚔️';
    const name = document.createElement('div');
    name.className = `name ${GEAR_RARITY_REF[gear.rarityIdx] ? GEAR_RARITY_REF[gear.rarityIdx].color : 'q0'}`;
    name.textContent = label;
    card.appendChild(name);
    const score = document.createElement('div');
    score.className = 'score';
    score.textContent = `总评分: ${gear.score} | ${SLOT_NAMES_REF[gear.slot] || gear.slot}`;
    card.appendChild(score);
    return card;
  }

  // 虚拟滚动（末光 _setupVirtualScroll 照抄：topSpacer + visibleWrap + bottomSpacer；
  //   补充 teardown——重渲染前移除旧 scroll 监听，防点击详情→整包重渲染后监听累积）
  _setupVirtualScroll(container, items, renderItem, { columns = 4, itemHeight = 66, rowGap = 12, bufferRows = 3 } = {}) {
    if (this._vscrollHandler && this._vscrollContainer === container) {
      container.removeEventListener('scroll', this._vscrollHandler);
    }
    container.innerHTML = '';
    const top = document.createElement('div');
    top.className = 'vscroll-top';
    const wrap = document.createElement('div');
    wrap.className = 'vscroll-wrap grid';
    const bottom = document.createElement('div');
    bottom.className = 'vscroll-bottom';
    container.appendChild(top);
    container.appendChild(wrap);
    container.appendChild(bottom);
    const rows = Math.ceil(items.length / columns);
    const rowH = itemHeight + rowGap;
    const update = () => {
      const viewH = container.clientHeight || container.offsetHeight || 280;
      const scrollTop = container.scrollTop || 0;
      const firstRow = Math.max(0, Math.floor(scrollTop / rowH) - bufferRows);
      const lastRow = Math.min(rows, Math.ceil((scrollTop + viewH) / rowH) + bufferRows);
      top.style.height = `${firstRow * rowH}px`;
      bottom.style.height = `${Math.max(0, (rows - lastRow) * rowH)}px`;
      wrap.innerHTML = '';
      const frag = document.createDocumentFragment();
      for (let r = firstRow; r < lastRow; r++) {
        for (let c = 0; c < columns; c++) {
          const i = r * columns + c;
          if (i >= items.length) break;
          frag.appendChild(renderItem(items[i], i));
        }
      }
      wrap.appendChild(frag);
      // 筛选空态（末光 ui.js:427 照抄：部位筛选无匹配时提示；放在 update 内防 scroll 清空）
      if (!items.length && !this._emptyHintShown) {
        const empty = document.createElement('div');
        empty.className = 'panel-text';
        empty.textContent = '没有找到适合该部位的装备';
        wrap.appendChild(empty);
      }
    };
    this._vscrollHandler = update;
    this._vscrollContainer = container;
    container.addEventListener('scroll', update);
    update();
    this._emptyHintShown = !!items.length;
  }

  // 详情面板（末光 item-details 照抄：名称品质色 / stats-box / 宝珠区 / 操作按钮）
  _renderGearDetail(gear, isEquipped) {
    const det = document.getElementById('item-details');
    if (!det) return;
    det.style.display = 'flex';
    const st = this.bagState;
    const nameEl = document.getElementById('det-name');
    let label = esc(gear.name) + ' ';
    if (gear.enhanceLv > 0) label += '+' + gear.enhanceLv + ' ';
    if (gear.pinned) label += '📌 ';
    else if (gear.locked) label += '🔒 ';
    if (isEquipped) label += '⚔️ ';
    nameEl.innerHTML = `<span class="${GEAR_RARITY_REF[gear.rarityIdx] ? GEAR_RARITY_REF[gear.rarityIdx].color : 'q0'}" style="font-weight:900;font-size:15px;">${label}</span>`;
    const statsEl = document.getElementById('det-stats');
    const s = gear.stats || {};
    const orbBonus = getGearOrbBonusRef(gear);
    const orbLines = Object.keys(orbBonus).map((k) => `<span class="label">${ORB_NAMES_REF[k] || k}</span><b>+${orbBonus[k]}</b>`).join('');
    statsEl.innerHTML = `
      <div class="stats-box">
        <span><span class="label">总评分</span><br><b style="color:#a78bfa">${gear.score}</b></span>
        <span><span class="label">装备评分</span><br><b>${gear.baseScore}</b></span>
        <span><span class="label">部位</span><br><b>${esc(SLOT_NAMES_REF[gear.slot] || gear.slot)}</b></span>
        ${s.atk !== undefined ? `<span><span class="label">攻击力</span><br><b>${fmtNum(s.atk)}</b></span>` : ''}
        ${s.def !== undefined ? `<span><span class="label">防御力</span><br><b>${fmtNum(s.def)}</b></span>` : ''}
        ${s.crit ? `<span><span class="label">暴击率</span><br><b>${s.crit.toFixed(1)}%</b></span>` : ''}
        ${s.haste ? `<span><span class="label">冷却缩减</span><br><b>${s.haste.toFixed(1)}%</b></span>` : ''}
        ${s.versa ? `<span><span class="label">共鸣</span><br><b>${s.versa.toFixed(1)}%</b></span>` : ''}
        ${orbLines}
        <span><span class="label">终焉精华</span><br><b style="color:#ff2d78">${st.game.player.finaleEssence || 0}</b></span>
      </div>
      <div class="gem-system">${this._renderGemSystem(gear)}</div>`;
    // 宝珠镶嵌/卸下事件（末光 gem-chip 照抄）
    statsEl.querySelectorAll('[data-oid]').forEach((b) => {
      b.addEventListener('click', () => this.handlers.onOrbSock(gear.id, b.dataset.oid, Number(b.dataset.idx)));
    });
    statsEl.querySelectorAll('.gem-chip.remove').forEach((b) => {
      b.addEventListener('click', () => this.handlers.onOrbUnsocket(gear.id, Number(b.dataset.idx)));
    });
    const actions = document.getElementById('det-actions');
    actions.innerHTML = '';
    const mkBtn = (text, cls, fn, disabled = false) => {
      const b = document.createElement('button');
      b.className = cls || 'btn';
      b.textContent = text;
      b.disabled = disabled;
      b.addEventListener('click', fn);
      actions.appendChild(b);
    };
    mkBtn(gear.locked ? '🔓 解锁' : '🔒 锁定', 'btn btn-ghost', () => this.handlers.onToggleLock(gear.id));
    mkBtn(gear.pinned ? '📍 解除防换' : '📌 锁定防换', 'btn btn-ghost', () => this.handlers.onTogglePin(gear.id));
    if (isEquipped) {
      mkBtn('👇 卸下放回背包', 'btn btn-ghost', () => this.handlers.onUnequip(gear.slot));
    } else {
      mkBtn('✨ 穿戴 / 替换现装', 'btn', () => this.handlers.onEquip(gear.id));
      mkBtn(`💰 分解获得金币${gear.rarityIdx === 8 ? '与精华' : ''}`, 'btn', () => this.handlers.onSalvage(gear.id), !!gear.locked);
    }
    mkBtn('⚒ 强化', 'btn btn-ghost', () => { this.closeBackpack(); this.handlers.onEnhance(gear.id); });
    // 终焉精炼已移至背包外（顶栏 btn-refine，照抄末光：背包内强化、背包外精炼）
  }

  // 宝珠区（末光 gem-system 照抄：每孔展开可镶嵌/卸下）
  _renderGemSystem(gear) {
    if (!gear.orbs || !gear.orbs.length) return '';
    const st = this.bagState;
    let html = '<div class="label" style="color:var(--mut);font-size:11px;">── 宝珠（同类最多 3 个）──</div>';
    gear.orbs.forEach((oid, idx) => {
      const orb = ORBS_REF.find((o) => o.id === oid);
      html += `<div class="gem-slot-row">
        <span>槽 ${idx + 1}：</span>
        ${orb ? `<span class="${GEAR_RARITY_REF[gear.rarityIdx].color}">${esc(orb.name)}</span>
          <button class="gem-chip remove" data-idx="${idx}">卸下</button>`
        : `<span class="label" style="color:var(--mut)">空</span>
          ${ORBS_REF.map((o) => `<button class="gem-chip" data-oid="${o.id}" data-idx="${idx}">${esc(o.name)}</button>`).join('')}`}
      </div>`;
    });
    return html;
  }

  // 底部栏（末光 modal-foot 照抄：普通/批量两种模式 + 自动分解阈值）
  _renderModalFoot() {
    const st = this.bagState;
    const foot = document.getElementById('modal-foot-bar');
    if (!foot) return;
    foot.innerHTML = '';
    if (st.batchMode) {
      const sel = document.createElement('select');
      sel.className = 'line-input';
      sel.innerHTML = '<option value="-1">全部品质</option>' + GEAR_RARITY_REF.map((r, i) => `<option value="${i}">${r.name}</option>`).join('');
      const selAll = document.createElement('button');
      selAll.className = 'btn btn-ghost';
      selAll.textContent = '全选此品质';
      selAll.addEventListener('click', () => this.handlers.onBatchSelectRarity(Number(sel.value)));
      const all = document.createElement('button');
      all.className = 'btn btn-ghost';
      all.textContent = '全选';
      all.addEventListener('click', () => this.handlers.onBatchSelectAll());
      const doSalvage = document.createElement('button');
      doSalvage.className = 'btn btn-red';
      doSalvage.textContent = `分解所选(${st.batchChecked.size})`;
      doSalvage.addEventListener('click', () => this.handlers.onBatchSalvage());
      const enhance = document.createElement('button');
      enhance.className = 'btn btn-ghost';
      enhance.textContent = '⚒ 强化锻造';
      enhance.addEventListener('click', () => { this.closeBackpack(); this.handlers.onEnhance(null); });
      const cancel = document.createElement('button');
      cancel.className = 'btn btn-ghost';
      cancel.textContent = '取消';
      cancel.addEventListener('click', () => this.handlers.onBatchEnter(false));
      foot.append(sel, selAll, all, doSalvage, enhance, cancel);
    } else {
      const batch = document.createElement('button');
      batch.className = 'btn btn-ghost';
      batch.textContent = '批量分解';
      batch.addEventListener('click', () => this.handlers.onBatchEnter(true));
      const enhance = document.createElement('button');
      enhance.className = 'btn btn-ghost';
      enhance.textContent = '⚒ 强化锻造';
      enhance.addEventListener('click', () => { this.closeBackpack(); this.handlers.onEnhance(null); });
      const close = document.createElement('button');
      close.className = 'btn btn-ghost';
      close.textContent = '关闭终端';
      close.addEventListener('click', () => this.handlers.onCloseBackpack());
      // 自动分解阈值（末光 ui-salvage 照抄）
      const label = document.createElement('span');
      label.className = 'label';
      label.style.cssText = 'color:var(--mut);font-size:11px;margin-left:auto;';
      label.textContent = '自动分解≤';
      const salvageSel = document.createElement('select');
      salvageSel.className = 'line-input';
      salvageSel.innerHTML = '<option value="-1">不自动分解</option>' + GEAR_RARITY_REF.map((r, i) => `<option value="${i}">${r.name}</option>`).join('');
      salvageSel.value = String(this.handlers.onAutoSalvageGet ? this.handlers.onAutoSalvageGet() : -1);
      salvageSel.addEventListener('change', () => this.handlers.onAutoSalvageChange(Number(salvageSel.value)));
      foot.append(batch, enhance, close, label, salvageSel);
    }
  }

  // 排序循环（末光 cycleSortMode 照抄：默认 → 评分↓ → 评分↑；持久化）
  cycleSortMode() {
    const order = ['default', 'score_desc', 'score_asc'];
    const next = order[(order.indexOf(this.bagState.sortMode) + 1) % order.length];
    this.bagState.sortMode = next;
    this.bagState.detail = null;
    try { if (globalThis.localStorage) localStorage.setItem('fate_echo:backpack_sort_mode', next); } catch { /* 忽略 */ }
    this._renderBackpack();
  }

  // ============================================================
  // 强化锻造弹窗（末光 openEnhanceView 照抄：左列表 + 右详情 + x5/x10/xMAX）
  // ============================================================
  openEnhanceView(game, selectedId = null) {
    this.enhanceState = { game, selectedId };
    const overlay = document.getElementById('enhance-overlay');
    if (overlay) overlay.style.display = 'flex';
    this._renderEnhanceList();
  }

  closeEnhanceView() {
    const overlay = document.getElementById('enhance-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  _enhancePool() {
    const g = this.enhanceState.game;
    return [...(g.player.inventory || []), ...Object.values(g.player.equipment || {}).filter(Boolean)];
  }

  _renderEnhanceList() {
    const listEl = document.getElementById('enhance-gear-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    const pool = this._enhancePool();
    for (const gear of pool) {
      const item = document.createElement('div');
      item.className = 'refine-item';
      const equipped = Object.values(this.enhanceState.game.player.equipment || {}).some((g) => g && g.id === gear.id);
      if (equipped) item.classList.add('equipped');
      if (gear.id === this.enhanceState.selectedId) item.classList.add('selected');
      item.innerHTML = `<div class="${GEAR_RARITY_REF[gear.rarityIdx].color}">${esc(gear.name)} ${equipped ? '[装备中]' : ''}</div>
        <div class="node-sub">评分 ${gear.score} · 强化 +${gear.enhanceLv}/${ENHANCE_MAX_REF}</div>`;
      item.addEventListener('click', () => { this.enhanceState.selectedId = gear.id; this._renderEnhanceList(); this._renderEnhanceDetail(gear); });
      listEl.appendChild(item);
    }
    if (!pool.length) {
      const d = document.createElement('div');
      d.className = 'panel-text';
      d.textContent = '没有装备可强化。';
      listEl.appendChild(d);
    }
    const sel = pool.find((g) => g.id === this.enhanceState.selectedId) || pool[0];
    if (sel) this._renderEnhanceDetail(sel);
  }

  _renderEnhanceDetail(gear) {
    const detail = document.getElementById('enhance-details');
    if (!detail) return;
    const g = this.enhanceState.game;
    const rate = enhanceRateRef(gear.enhanceLv);
    const cost = enhanceCostRef(gear, gear.enhanceLv);
    const rateCls = rate >= 0.7 ? 'enhance-rate-ok' : rate >= 0.5 ? 'enhance-rate-mid' : 'enhance-rate-low';
    const equipped = Object.values(g.player.equipment || {}).some((x) => x && x.id === gear.id);
    const s = gear.stats || {};
    const attrs = [
      s.atk !== undefined ? `攻击力 ${fmtNum(s.atk)}` : '',
      s.def !== undefined ? `防御力 ${fmtNum(s.def)}` : '',
      s.crit ? `暴击 ${s.crit.toFixed(1)}%` : '',
      s.haste ? `急速 ${s.haste.toFixed(1)}%` : '',
      s.versa ? `共鸣 ${s.versa.toFixed(1)}%` : '',
    ].filter(Boolean).join(' ｜ ');
    detail.innerHTML = `
      <div class="${GEAR_RARITY_REF[gear.rarityIdx].color}" style="font-weight:900;font-size:15px;">${esc(gear.name)} ${equipped ? '<span class="label">[装备中]</span>' : ''}</div>
      <div class="node-sub">${attrs}</div>
      <div style="margin-top:10px;">强化等级：<b>${gear.enhanceLv} / ${ENHANCE_MAX_REF}</b></div>
      <div style="margin-top:6px;">成功率：<span class="${rateCls}">${Math.round(rate * 100)}%</span></div>
      <div style="margin-top:6px;">费用：<span class="enhance-gold">${cost} 金</span></div>
      <div class="action-buttons" style="margin-top:14px;">
        <button class="btn ${g.player.gold < cost ? 'enhance-disabled' : ''}" data-x="1">强化</button>
        <button class="btn btn-ghost ${g.player.gold < cost * 5 ? 'enhance-disabled' : ''}" data-x="5">x5</button>
        <button class="btn btn-ghost ${g.player.gold < cost * 10 ? 'enhance-disabled' : ''}" data-x="10">x10</button>
        <button class="btn btn-ghost" data-x="max">xMAX</button>
      </div>`;
    detail.querySelectorAll('[data-x]').forEach((b) => {
      b.addEventListener('click', () => this.handlers.onEnhanceX(gear.id, b.dataset.x));
    });
  }

  // 强化结果闪光（末光 flashEnhanceResult 照抄）
  flashEnhance(detailEl, success) {
    if (!detailEl) return;
    detailEl.classList.remove('enhance-flash-success', 'enhance-flash-fail');
    void detailEl.offsetWidth; // 重启动画
    detailEl.classList.add(success ? 'enhance-flash-success' : 'enhance-flash-fail');
  }

  // ============================================================
  // 终焉精炼弹窗（末光 refine-overlay 照抄：终焉装备词缀精炼，消耗 3 精华）
  // ============================================================
  openRefineView(game) {
    this.refineState = { game, selectedId: null };
    const overlay = document.getElementById('refine-overlay');
    if (overlay) overlay.style.display = 'flex';
    this._renderRefineList();
  }

  closeRefineView() {
    const overlay = document.getElementById('refine-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  _refinePool() {
    const g = this.refineState.game;
    return [...(g.player.inventory || []), ...Object.values(g.player.equipment || {}).filter(Boolean)].filter((gear) => gear.rarityIdx === 8);
  }

  _renderRefineList() {
    const listEl = document.getElementById('refine-gear-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    const pool = this._refinePool();
    for (const gear of pool) {
      const item = document.createElement('div');
      item.className = 'refine-item';
      if (gear.id === this.refineState.selectedId) item.classList.add('selected');
      item.innerHTML = `<div class="q8">${esc(gear.name)}</div>
        <div class="node-sub">评分 ${gear.score} · ${esc(SLOT_NAMES_REF[gear.slot] || gear.slot)}</div>`;
      item.addEventListener('click', () => { this.refineState.selectedId = gear.id; this._renderRefineList(); this._renderRefineDetail(gear); });
      listEl.appendChild(item);
    }
    if (!pool.length) {
      const d = document.createElement('div');
      d.className = 'panel-text';
      d.textContent = '没有终焉装备（分解终焉获得精华，集齐 8 槽图鉴解锁 HP/ATK+10%）。';
      listEl.appendChild(d);
    }
    const sel = pool.find((g) => g.id === this.refineState.selectedId) || pool[0];
    if (sel) this._renderRefineDetail(sel);
  }

  _renderRefineDetail(gear) {
    const detail = document.getElementById('refine-details');
    if (!detail) return;
    const g = this.refineState.game;
    let html = `<div class="q8" style="font-weight:900;font-size:15px;margin-bottom:8px;">${esc(gear.name)}（精炼消耗: ${REFINE_COST_REF} 终焉精华/次）</div>
      <div class="node-sub" style="margin-bottom:10px;">终焉精华：<b style="color:#ff2d78">${g.player.finaleEssence || 0}</b></div>`;
    for (const aff of AFFIXES_REF) {
      const val = gear.stats[aff];
      if (val === undefined) continue;
      const cap = getAffixCapRef(gear.slot, aff);
      const lv = (gear.refineLevels && gear.refineLevels[aff]) || 0;
      const initial = (gear.refineInitialValues && gear.refineInitialValues[aff]) !== undefined ? gear.refineInitialValues[aff] : val;
      const pct = cap > 0 ? Math.min(100, Math.round(((val - (initial || 0)) / (cap - (initial || 0))) * 100)) : 100;
      const canRefine = lv < REFINE_MAX_REF && (g.player.finaleEssence || 0) >= REFINE_COST_REF && initial < cap;
      html += `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
        <span style="flex:1">${AFF_NAME_REF[aff] || aff}：<b>${Number(val).toFixed(1)}</b> / ${cap}
          <span class="node-sub">（精炼 ${lv}/${REFINE_MAX_REF}，进度 ${pct}%）</span></span>        <button class="btn btn-ghost ${canRefine ? '' : 'enhance-disabled'}" data-aff="${aff}">精炼</button>
      </div>`;
    }
    detail.innerHTML = html;
    detail.querySelectorAll('[data-aff]').forEach((b) => {
      b.addEventListener('click', () => this.handlers.onRefineAffix(gear.id, b.dataset.aff));
    });
  }

  // 术语表/帮助（永恒回想录 glossary 结构照抄：机制术语 + 说明 + 游戏统计）
  renderGlossary(game, stats = null) {
    this.renderPanel('📖 术语表 · 帮助', (panel) => {
      if (stats) {
        const st = document.createElement('div');
        st.className = 'stats-box';
        st.style.marginBottom = '12px';
        st.innerHTML = `
          <span><span class="label">战斗次数</span><br><b>${stats.battles}</b></span>
          <span><span class="label">胜利</span><br><b style="color:#2ecc71">${stats.victories}</b></span>
          <span><span class="label">失败</span><br><b style="color:#ff6b6b">${stats.defeats}</b></span>
          <span><span class="label">击杀</span><br><b>${stats.kills}</b></span>
          <span><span class="label">金币获取</span><br><b style="color:#fbbf24">${stats.goldEarned}</b></span>
          <span><span class="label">掉落装备</span><br><b>${stats.drops}</b></span>`;
        panel.appendChild(st);
      }
      const terms = [
        ['行动点 AP', '主技能消耗 1 点；每 10% 急速 +1 上限（默认 1，最高 3）'],
        ['瞬发槽', '每回合 1 个瞬发（oGCD）槽位，不占行动点'],
        ['回合制', 'cd/dur 毫秒换算为回合（1 回合 ≈ 2.5 秒）'],
        ['冷却（CD）', '技能使用后进入冷却，回合结束递减；终焉技能（[终焉]标记）不受时间回溯重置'],
        ['领域', '展开后每回合造成伤害，持续 5 回合，同时只能存在 1 个；五种：虚空（低血增伤）/海洋（减伤+增疗）/烈焰（递增）/死亡（负面增伤）/圣光（吸血）'],
        ['易伤', '受击伤害放大；多个易伤乘算叠加'],
        ['护盾', '吸收伤害，可多层叠加'],
        ['防御姿态', '本回合受击 -30%，下回合 +1 行动点'],
        ['狂暴', 'Boss 半血触发：攻击提升'],
        ['品质九档', '破损→普通→精良→卓越→史诗→传说→神话→圣物→终焉；楼层越高高品质越多（每 10 层 +1 浮动）'],
        ['装备属性', '攻击 atk / 防御 def（参与减伤）/ 暴击 / 急速 / 共鸣'],
        ['装备评分', '武器 atk×10、防具 def×10、首饰 (atk+def)×5，副属性加成；score = baseScore + 宝珠分'],
        ['强化', '上限 +12；费用 (品质+1)×300×1.8^等级，成功率 95-7×等级（最低 30%）；成功=主属性递增+副属性+0.5'],
        ['精炼', '终焉装备专属：消耗 3 终焉精华提升词缀（15 次曲线，第 15 次补满上限）'],
        ['宝珠', '5 种：生命/攻击/共鸣/暴击/终焉回响（终焉技能冷却 -20%）；同类最多镶嵌 3 个'],
        ['终焉精华', '分解终焉装备获得；精炼消耗'],
        ['终焉图鉴', '集齐 8 槽终焉装备：最大生命 +10%、攻击 +10%'],
        ['拾取过滤', '部位/品质/词条规则 + 自动分解阈值：不满足的掉落自动熔炼为金币'],
        ['探索节点', '作战⚔/紧急💀/事件❓/休息🏕/商店🏪/抽卡🎰/出口🚪🌟👑；未观测节点显示大类色点，可达节点白光圈'],
        ['出口', '险路尽头🚪（安全）/ 险路小径🌟（稀有奖励）/ 险路恶敌👑（Boss 战）'],
        ['存档', '自动存档（100ms 防抖）+ 多槽位手动存档；支持导出/导入 JSON、删除、新建、持久化申请'],
      ];
      for (const [name, desc] of terms) {
        const row = document.createElement('div');
        row.className = 'panel-text';
        row.innerHTML = `<b style="color:var(--accent)">${esc(name)}</b>：${esc(desc)}`;
        panel.appendChild(row);
      }
    });
  }

  // 存档管理面板（永恒回想录存档管理器照抄：每槽加载/删除 + 当前槽标记 +
  //   新建/导出/导入/清除所有/持久化状态）
  renderSlots(game, slots, { mode = 'manage', currentSlot = null, storageInfo = null } = {}) {
    this.renderPanel('💾 存档管理（多槽位）', (panel) => {
      const hint = document.createElement('div');
      hint.className = 'panel-text';
      hint.textContent = '自动存档（战斗/层推进后）与手动槽位分离；加载前请确认当前进度已保存。';
      panel.appendChild(hint);
      // 持久化状态（永恒：三种颜色提示 + 申请按钮）
      if (storageInfo) {
        const per = document.createElement('div');
        per.className = 'panel-text';
        const persisted = storageInfo.persisted === true;
        per.style.color = persisted ? 'var(--ok)' : 'var(--mut)';
        per.textContent = persisted
          ? `💾 持久化存储已启用（用量 ${Math.round((storageInfo.usage || 0) / 1024)} KB / ${Math.round((storageInfo.quota || 0) / 1048576)} MB）`
          : '⚠️ 浏览器可能自动清除存档数据（未申请持久化存储）';
        panel.appendChild(per);
        if (!persisted && storageInfo.supported) {
          const reqBtn = document.createElement('button');
          reqBtn.className = 'opt-btn';
          reqBtn.textContent = '申请持久化存储';
          reqBtn.addEventListener('click', () => this.handlers.onPersistRequest());
          panel.appendChild(reqBtn);
        }
      }
      const list = document.createElement('div');
      list.className = 'bag-list';
      for (const slot of slots) {
        const row = document.createElement('div');
        row.className = 'bag-item' + (slot.id === currentSlot ? ' selected' : '');
        const time = slot.timestamp ? new Date(slot.timestamp).toLocaleString() : '—';
        const info = document.createElement('span');
        info.innerHTML = `<span>${esc(slot.name)}${slot.id === currentSlot ? ' <span class="rarity q7">[当前]</span>' : ''}</span>
          <span class="node-sub">Lv.${slot.level} · 第 ${slot.depth} 轮 ${slot.floor} 层 · ${time}</span>`;
        row.appendChild(info);
        const actions = document.createElement('span');
        actions.className = 'btn-row';
        const saveBtn = document.createElement('button');
        saveBtn.className = 'opt-btn';
        saveBtn.textContent = '保存';
        saveBtn.addEventListener('click', () => this.handlers.onSlotSave(slot.id));
        actions.appendChild(saveBtn);
        const loadBtn = document.createElement('button');
        loadBtn.className = 'opt-btn';
        loadBtn.textContent = '加载';
        loadBtn.disabled = slot.id === currentSlot;
        loadBtn.addEventListener('click', () => this.handlers.onSlotLoad(slot.id));
        actions.appendChild(loadBtn);
        const delBtn = document.createElement('button');
        delBtn.className = 'opt-btn';
        delBtn.style.color = 'var(--damage)';
        delBtn.textContent = '删除';
        delBtn.disabled = slot.id === currentSlot;
        delBtn.addEventListener('click', () => this.handlers.onSlotDelete(slot.id));
        actions.appendChild(delBtn);
        row.appendChild(actions);
        list.appendChild(row);
      }
      if (!list.childElementCount) {
        const d = document.createElement('div');
        d.className = 'panel-text';
        d.textContent = '没有存档。';
        list.appendChild(d);
      }
      panel.appendChild(list);
      // 底部操作：新建/导出/导入/清除/关闭
      const row = document.createElement('div');
      row.className = 'btn-row';
      const mk = (text, fn, danger = false) => {
        const b = document.createElement('button');
        b.className = 'opt-btn';
        b.textContent = text;
        if (danger) b.style.color = 'var(--damage)';
        b.addEventListener('click', fn);
        row.appendChild(b);
      };
      mk('🆕 新建存档', () => this.handlers.onNewSlot());
      mk('📤 导出存档', () => this.handlers.onExport());
      mk('📥 导入存档', () => this.handlers.onImport());
      mk('🗑 清除所有数据', () => this.handlers.onClearAll(), true);
      mk('关闭', () => this.handlers.onClose());
      panel.appendChild(row);
    });
  }

  // 旧接口保留兼容（委托给独立背包界面）
  renderInventory(game) {
    this.renderPanel('🎒 背包 · 装备栏', (panel) => {
      const gold = document.createElement('div');
      gold.className = 'panel-text gold-line';
      gold.textContent = `金币：${game.player.gold}`;
      panel.appendChild(gold);
      const cols = document.createElement('div');
      cols.className = 'inv-cols';
      // 左栏：装备栏（8 槽）
      const eqCol = document.createElement('div');
      eqCol.className = 'inv-eq-col';
      const eqTitle = document.createElement('div');
      eqTitle.className = 'panel-text';
      eqTitle.textContent = '── 装备栏 ──';
      eqCol.appendChild(eqTitle);
      for (const slot of SLOTS_REF) {
        const gear = game.player.equipment && game.player.equipment[slot];
        const row = document.createElement('div');
        row.className = 'shop-item';
        if (gear) {
          const info = document.createElement('span');
          info.innerHTML = `${esc(SLOT_NAMES_REF[slot])}：${esc(gear.name)} <span class="rarity ${rarityClass(gear.rarityIdx)}">${rarityName(gear.rarityIdx)}</span> ${gear.pinned ? '🔒' : ''}<br><span class="node-sub">${statsText(gear)}</span>`;
          row.appendChild(info);
          const un = document.createElement('button');
          un.className = 'opt-btn';
          un.textContent = '卸下';
          un.addEventListener('click', () => this.handlers.onUnequip(slot));
          row.appendChild(un);
        } else {
          row.innerHTML = `<span class="node-sub">${esc(SLOT_NAMES_REF[slot])}：未装备</span>`;
        }
        eqCol.appendChild(row);
      }
      cols.appendChild(eqCol);
      // 右栏：背包列表（按评分降序）
      const bagCol = document.createElement('div');
      bagCol.className = 'inv-bag-col';
      const bagTitle = document.createElement('div');
      bagTitle.className = 'panel-text';
      bagTitle.textContent = `── 背包（${(game.player.inventory || []).length}）──`;
      bagCol.appendChild(bagTitle);
      const inv = (game.player.inventory || []).slice().sort((a, b) => b.score - a.score);
      if (!inv.length) {
        const d = document.createElement('div');
        d.className = 'panel-text';
        d.textContent = '背包空空如也。';
        bagCol.appendChild(d);
      }
      for (const gear of inv) {
        const row = document.createElement('div');
        row.className = 'shop-item inv-item';
        const info = document.createElement('span');
        info.innerHTML = `${esc(gear.name)} <span class="rarity ${rarityClass(gear.rarityIdx)}">${rarityName(gear.rarityIdx)}</span> · 评分 ${gear.score}<br><span class="node-sub">${esc(SLOT_NAMES_REF[gear.slot] || gear.slot)} · ${statsText(gear)}</span>`;
        row.appendChild(info);
        const btns = document.createElement('span');
        const eqBtn = document.createElement('button');
        eqBtn.className = 'opt-btn';
        eqBtn.textContent = '穿戴';
        eqBtn.addEventListener('click', () => this.handlers.onEquip(gear.id));
        btns.appendChild(eqBtn);
        const enBtn = document.createElement('button');
        enBtn.className = 'opt-btn';
        enBtn.textContent = '强化';
        enBtn.addEventListener('click', () => this.handlers.onEnhance(gear.id));
        btns.appendChild(enBtn);
        const svBtn = document.createElement('button');
        svBtn.className = 'opt-btn';
        svBtn.textContent = '分解';
        svBtn.disabled = gear.locked;
        svBtn.addEventListener('click', () => this.handlers.onSalvage(gear.id));
        btns.appendChild(svBtn);
        row.appendChild(btns);
        bagCol.appendChild(row);
      }
      cols.appendChild(bagCol);
      panel.appendChild(cols);
      const row = document.createElement('div');
      row.className = 'btn-row';
      const back = document.createElement('button');
      back.className = 'opt-btn';
      back.textContent = '返回';
      back.addEventListener('click', () => this.handlers.onLeave());
      row.appendChild(back);
      panel.appendChild(row);
    });
  }

  renderEvent(game, ev) {
    this.renderPanel(ev.title, (panel) => {
      const d = document.createElement('div');
      d.className = 'panel-text';
      d.textContent = ev.desc;
      panel.appendChild(d);
      const row = document.createElement('div');
      row.className = 'btn-row';
      for (const opt of ev.options) {
        const b = document.createElement('button');
        b.className = 'opt-btn';
        b.innerHTML = `${esc(opt.label)}<span class="node-sub">${esc(opt.hint)}</span>`;
        b.addEventListener('click', () => this.handlers.onOption(opt.id));
        row.appendChild(b);
      }
      panel.appendChild(row);
    });
  }

  renderGacha(game) {
    this.renderPanel('🎰 命运抽卡', (panel) => {
      const d = document.createElement('div');
      d.className = 'panel-text';
      d.textContent = `消耗 ${GACHA_COST_REF} 金币抽取一件装备（普通 60% / 稀有 30% / 史诗 10%）。金币：${game.player.gold}`;
      panel.appendChild(d);
      const row = document.createElement('div');
      row.className = 'btn-row';
      const g = document.createElement('button');
      g.className = 'opt-btn';
      g.textContent = `抽取一次（${GACHA_COST_REF} 金）`;
      g.disabled = game.player.gold < GACHA_COST_REF;
      g.addEventListener('click', () => this.handlers.onGacha());
      row.appendChild(g);
      const leave = document.createElement('button');
      leave.className = 'opt-btn';
      leave.textContent = '离开';
      leave.addEventListener('click', () => this.handlers.onLeave());
      row.appendChild(leave);
      panel.appendChild(row);
    });
  }

  // ---- 结算弹窗（DESIGN_NOTES 第 2 条：结算居中 overlay，不沉底 #ow-panel） ----
  _renderResultOverlay(title, bodyFn) {
    const overlay = document.getElementById('result-overlay');
    const titleEl = document.getElementById('result-title');
    const body = document.getElementById('result-body');
    if (titleEl) titleEl.textContent = title;
    if (body) { body.innerHTML = ''; bodyFn(body); }
    if (overlay) overlay.style.display = 'flex';
  }
  closeResultOverlay() {
    const overlay = document.getElementById('result-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  // 通用结算面板（事件/休息/抽卡等）：文本 + 自定义按钮（默认"返回地图"）
  renderResult(game, lines, btnLabel = '返回地图', onDone = null) {
    this._renderResultOverlay('📜 结算', (body) => {
      for (const l of lines) {
        const d = document.createElement('div');
        d.className = 'panel-text';
        d.textContent = l;
        body.appendChild(d);
      }
      const row = document.createElement('div');
      row.className = 'btn-row';
      const cont = document.createElement('button');
      cont.className = 'opt-btn';
      cont.textContent = btnLabel;
      cont.addEventListener('click', () => {
        if (onDone) onDone();
        else this.handlers.onContinue();
      });
      row.appendChild(cont);
      body.appendChild(row);
    });
  }

  // 战斗胜利奖励结算（方案 3：资源全选自动入账 + 装备 3 件候选手动 3 选 1）
  renderBattleResult(game, lines, choices) {
    this._renderResultOverlay('🎁 战利品', (body) => {
      for (const l of lines) {
        const d = document.createElement('div');
        d.className = 'panel-text';
        d.textContent = l;
        body.appendChild(d);
      }
      if (choices && choices.length) {
        const title = document.createElement('div');
        title.className = 'panel-text';
        title.textContent = '—— 战利品三选一：从候选装备中选择 1 件带走 ——';
        body.appendChild(title);
        const row = document.createElement('div');
        row.className = 'btn-row';
        choices.forEach((gear, i) => {
          const b = document.createElement('button');
          b.className = 'opt-btn';
          b.innerHTML = `⚔ <span class="${rarityClass(gear.rarityIdx)}">${esc(gear.name)}</span><br><span class="node-sub">${rarityName(gear.rarityIdx)} · 评分 ${gear.score}</span>`;
          b.addEventListener('click', () => this.handlers.onReward(i));
          row.appendChild(b);
        });
        body.appendChild(row);
      }
      if (!choices) {
        const row = document.createElement('div');
        row.className = 'btn-row';
        const back = document.createElement('button');
        back.className = 'opt-btn';
        back.textContent = '返回地图';
        back.addEventListener('click', () => this.handlers.onLeave());
        row.appendChild(back);
        body.appendChild(row);
      }
    });
  }

  renderGameover(game, area) {
    this._renderResultOverlay('💀 你倒下了', (body) => {
      const d = document.createElement('div');
      d.className = 'panel-text';
      d.textContent = `倒在了第 ${area.depth} 轮 · ${area.isBossArea ? 'Boss 区' : '探索区 ' + (area.areaIndex + 1)}。等级 ${game.player.level}。`;
      body.appendChild(d);
      const row = document.createElement('div');
      row.className = 'btn-row';
      const retry = document.createElement('button');
      retry.className = 'opt-btn';
      retry.textContent = '读取存档（回到上次胜利）';
      retry.addEventListener('click', () => this.handlers.onContinue());
      row.appendChild(retry);
      const fresh = document.createElement('button');
      fresh.className = 'opt-btn';
      fresh.textContent = '重新开始';
      fresh.addEventListener('click', () => this.handlers.onNewGame());
      row.appendChild(fresh);
      body.appendChild(row);
    });
  }

  // 节点进入确认层（DESIGN_NOTES 第 1 条：黑流树海式 点击当前节点 → 确认 → 进入）
  renderNodeConfirm(node, floorNum = null) {
    const overlay = document.getElementById('node-confirm-overlay');
    const titleEl = document.getElementById('node-confirm-title');
    const body = document.getElementById('node-confirm-body');
    if (titleEl) titleEl.textContent = `${NODE_ICONS_REF[node.type] || '·'} ${NODE_NAMES_REF[node.type] || node.type}`;
    if (body) {
      body.innerHTML = '';
      const d = document.createElement('div');
      d.className = 'panel-text';
      d.textContent = (NODE_DESC_REF[node.type] || '') + (floorNum ? `（第 ${floorNum} 层）` : '');
      body.appendChild(d);
      const row = document.createElement('div');
      row.className = 'btn-row';
      const enter = document.createElement('button');
      enter.className = 'opt-btn';
      enter.textContent = '进入';
      enter.addEventListener('click', () => this.handlers.onNodeConfirmEnter());
      row.appendChild(enter);
      const cancel = document.createElement('button');
      cancel.className = 'opt-btn';
      cancel.textContent = '取消';
      cancel.addEventListener('click', () => this.handlers.onNodeConfirmCancel());
      row.appendChild(cancel);
      body.appendChild(row);
    }
    if (overlay) overlay.style.display = 'flex';
  }
  closeNodeConfirm() {
    const overlay = document.getElementById('node-confirm-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  _renderPlayer(game) {
    const p = game.player;
    const totalExp = expToLevelRef(p.level);
    // 末光 stats-grid 属性面板照抄（rework.css .stats-grid/.stat-item 两列卡片）：
    //   完整战斗属性 = 等级基础 + 装备 + 宝珠 + 收藏品 + 终焉图鉴（makeBattlePlayer 同源，
    //   局外/战斗显示一致）；GCD = 2.5/(1+急速/100)（末光 stats-grid.js:32 公式原样）
    const u = makeBattlePlayerRef(game).unit;
    const haste = u.statBonus('haste');
    const gcd = (2.5 / (1 + haste / 100)).toFixed(2) + 's';
    const item = (label, val) => `<div class="stat-item"><span>${label}</span><span>${val}</span></div>`;
    this.els.owPlayer.innerHTML = `
      <div class="ow-row"><span>${esc('旅人')}</span><b>Lv.${p.level}</b></div>
      <div class="exp-bar"><div class="fill" style="width:${Math.min(100, (p.exp / totalExp) * 100).toFixed(1)}%"></div></div>
      <div class="ow-row"><span>经验</span><b>${p.exp}/${totalExp}</b></div>
      <div class="stats-grid">
        ${item('生命', `${p.hp}/${u.maxHp}`)}
        ${item('法力', `${p.mp}/${u.maxMp}`)}
        ${item('攻击力', u.atk)}
        ${item('防御力', u.def)}
        ${item('冷却缩减', haste.toFixed(1))}
        ${item('暴击率', (u.totalCritChance() * 100).toFixed(1) + '%')}
        ${item('共鸣', u.statBonus('versa').toFixed(1))}
        ${item('GCD', gcd)}
      </div>
      <div class="ow-row"><span class="gold-line">金币</span><b class="gold-line">${p.gold}</b></div>`;
  }

  // 常驻装备栏（末光 ui-equips 照抄：8 槽网格，点击槽位 → 部位筛选打开背包）
  _renderEquipped(game) {
    const eq = game.player.equipment || {};
    const el = this.els.owEquipped;
    if (!el) return;
    let html = '<div class="depth-line">共鸣武装 · 终焉图鉴 ' + countFinale(game.player) + '/8</div><div class="equip-grid">';
    for (const slot of SLOTS_REF) {
      const gear = eq[slot];
      if (gear) {
        html += '<div class="equip-slot" data-slot="' + slot + '">'
          + '<div class="equip-name ' + (GEAR_RARITY_REF[gear.rarityIdx] ? GEAR_RARITY_REF[gear.rarityIdx].color : 'q0') + '">' + esc(gear.name) + '</div>'
          + '<div class="equip-stats">装备评分: ' + gear.score + '</div>'
          + (gear.enhanceLv > 0 ? '<div class="enhance-tag">+' + gear.enhanceLv + '</div>' : '')
          + (gear.pinned ? '<div style="position:absolute;top:2px;left:2px;font-size:10px;">📌</div>' : '')
          + '</div>';
      } else {
        html += '<div class="equip-slot" data-slot="' + slot + '">'
          + '<div class="equip-name" style="color:var(--mut)">[点击选取]</div>'
          + '<div class="equip-stats">' + esc(SLOT_NAMES_REF[slot]) + '</div></div>';
      }
    }
    html += '</div>';
    el.innerHTML = html;
    // 点击槽位 → 部位筛选打开背包（末光 openSlotView）
    el.querySelectorAll('.equip-slot').forEach((slotEl) => {
      slotEl.addEventListener('click', () => this.handlers.onSlotView(slotEl.dataset.slot));
    });
  }

  _renderTowerInfo(game, area) {
    const cur = area.current();
    const curName = cur ? (NODE_NAMES_REF[cur.type] || cur.type) : '—';
    this.els.owTower.innerHTML = `
      <div class="depth-line">${area.isBossArea ? '⚔ Boss 区' : '探索区 ' + (area.areaIndex + 1) + '/3'} · <b>第 ${area.depth} 轮</b></div>
      <div class="panel-text">平面节点网络：点击相邻可达节点（白光圈）移动，抵达出口（🚪/🌟/👑）通关。点位一次性，死路需原路返回。</div>
      <div class="eq-slot">背包：${(game.player.inventory || []).length} 件 · 当前位置：${esc(curName)}</div>`;
  }
}

// ---- OverworldUI 辅助（延迟引用，避免循环依赖） ----
import { SLOTS as SLOTS_REF, SLOT_NAMES as SLOT_NAMES_REF, GEAR_RARITY as GEAR_RARITY_REF, GACHA_COST as GACHA_COST_REF } from './equipment.js';
import { playerStatsAt as playerStatsAtRef, expToLevel as expToLevelRef, makeBattlePlayer as makeBattlePlayerRef } from './progression.js';
import { enhanceCost as enhanceCostRef, enhanceRate as enhanceRateRef, ENHANCE_MAX as ENHANCE_MAX_REF, ORBS as ORBS_REF, AFFIXES as AFFIXES_REF, REFINE_MAX as REFINE_MAX_REF, REFINE_COST as REFINE_COST_REF, getAffixCap as getAffixCapRef, getGearOrbBonus as getGearOrbBonusRef, formatNumber as formatNumberRef } from './equipment.js';
import { NODE_NAMES as NODE_NAMES_REF, NODE_ICONS as NODE_ICONS_REF } from './area.js';
import { ATM_DENOMS as ATM_DENOMS_REF, atmRewardInfo as atmRewardInfoRef, canWithdraw as canWithdrawRef } from './atm.js';
import { COLLECTIONS as COLLECTIONS_REF, COLLECTION_PRICE as COLLECTION_PRICE_REF } from './collections.js';
import { calcDamage as calcDamageRef } from './effects.js';

// 节点确认层说明（DESIGN_NOTES 第 1 条：黑流树海式 点击当前节点 → 确认 → 进入）
const NODE_DESC_REF = {
  combat: '作战：击败敌人，获取经验与战利品。',
  elite: '紧急作战：强敌出没，掉落更丰厚。',
  event: '不期而遇：随机事件，机遇与风险并存。',
  rest: '安全的角落：恢复生命与法力。',
  shop: '诡意行商：花费金币购买装备。',
  gacha: '命运抽卡：100 金抽取装备。',
  exit: '险路尽头：安全出口，抵达即通关本层。',
  exit_rare: '险路小径：稀有出口，额外高品质装备。',
  exit_boss: '险路恶敌：Boss 战，通关进入更深的轮。',
  empty: '林间空地：空无一物，途经之处。',
};
const eqText = (g) => (g && g.name) || '—';
const eqStats = (eq) => {
  const s = { atk: 0, hp: 0, def: 0 };
  for (const slot of SLOTS_REF) {
    const g = eq[slot];
    if (g && g.stats) for (const [k, v] of Object.entries(g.stats)) s[k] = (s[k] || 0) + v;
  }
  return s;
};
const statsText = (gear) => {
  const parts = Object.entries(gear.stats || {}).map(([k, v]) => `${k === 'crit' ? '暴击' : k === 'haste' ? '急速' : k === 'versa' ? '共鸣' : k === 'atk' ? '攻击' : k === 'def' ? '防御' : '生命'}+${fmtNum(v)}`);
  if (gear.enhanceLv > 0) parts.push(`强化+${gear.enhanceLv}`);
  return parts.join(' ');
};
const priceOf = (eq) => (eq.rarityIdx + 1) * 40;
// 数值格式化（末光 formatNumber 对齐：最多 2 位小数 + K/M 缩写）
const fmtNum = (n) => formatNumberRef(n);
// 宝珠属性名（详情显示）
const ORB_NAMES_REF = { hp_pct: '生命加成', atk_pct: '攻击加成', versa: '共鸣', crit: '暴击', finale_cd: '终焉冷却' };
// 词缀名（精炼详情显示）
const AFF_NAME_REF = { crit: '暴击率', haste: '冷却缩减', versa: '共鸣' };
// 终焉图鉴收集数
const countFinale = (player) => SLOTS_REF.filter((s) => player.finaleCollection && player.finaleCollection[s]).length;
