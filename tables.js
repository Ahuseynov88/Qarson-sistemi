/* ═══════════════════════════════════════════
   TABLE BOARD
   Qarson ekranındakı masa grid-i: kateqoriya/işçi filtri,
   masa aktivləşdirmə/bağlama, canlı taymer.
   Hadisələr addEventListener ilə bağlanır (inline onclick yoxdur).
═══════════════════════════════════════════ */
import { R, db } from './firebase-service.js';
import { state } from './state.js';
import { esc, showToast, addLog } from './utils.js';
import { hasPermission, staffHasPermission } from './permissions.js';

export class TableBoard {
  /**
   * @param {Object} els - { grid, catTabs, staffFilter }  DOM elementləri
   * @param {Object} callbacks - { onTableOpen(tableId) }  masa üstünə klik ediləndə çağırılır
   */
  constructor(els, callbacks = {}) {
    this.el = els.grid;
    this.catTabsEl = els.catTabs;
    this.staffFilterEl = els.staffFilter;
    this.onTableOpen = callbacks.onTableOpen || (() => {});
    this._bindEvents();
  }

  _bindEvents() {
    this.el.addEventListener('click', (e) => {
      const card = e.target.closest('[data-table-id]');
      if (!card) return;
      this._handleCardClick(card.dataset.tableId);
    });
    this.catTabsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cat]');
      if (!btn) return;
      this.setCategory(btn.dataset.cat);
    });
    this.staffFilterEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-staff-filter]');
      if (!btn) return;
      const val = btn.dataset.staffFilter;
      this.setStaffFilter(val === '_all' ? null : val);
    });
  }

  _handleCardClick(tableId) {
    const t = state.tables.find(x => x.id === tableId);
    if (!t) return;
    const isMine = t.occupant === state.user.id;
    const isOther = t.occupant && !isMine;
    if (!t.occupant) {
      this.openActivateConfirm(tableId);
    } else if (isOther && !hasPermission('waiter.view')) {
      showToast('<svg class="icon"><use href="#i-ban"></use></svg> Bu masa başqa işçiyə aiddir');
    } else {
      // Aktiv masa - sifariş/qeydlər hub-unu aç (staff-app.js bunu billing.js ilə əlaqələndirir)
      this.onTableOpen(tableId);
    }
  }

  getCategories() {
    const cats = new Set();
    state.tables.forEach(t => cats.add(t.category || t.name.replace(/\s+\d+$/, '') || t.name));
    return Array.from(cats);
  }

  renderCatTabs() {
    const cats = this.getCategories();
    const tabs = ['all', ...cats];
    this.catTabsEl.innerHTML = tabs.map(c => `
      <button class="admin-tab ${state._waiterCatFilter === c ? 'active' : ''}" data-cat="${esc(c)}">
        ${c === 'all' ? 'Hamısı' : esc(c)}
      </button>
    `).join('');
  }

  setCategory(cat) {
    state._waiterCatFilter = cat;
    this.render();
  }

  renderStaffFilter() {
    if (!hasPermission('waiter.view')) {
      this.staffFilterEl.style.display = 'none';
      state._waiterStaffFilter = null;
      return;
    }
    const activeStaffList = state.staff.filter(s => staffHasPermission(s, 'table.view'));
    if (!activeStaffList.length) { this.staffFilterEl.style.display = 'none'; return; }
    this.staffFilterEl.style.display = 'flex';
    this.staffFilterEl.innerHTML = [
      `<button class="log-filter ${!state._waiterStaffFilter ? 'active' : ''}" data-staff-filter="_all">Hamısı</button>`
    ].concat(activeStaffList.map(s =>
      `<button class="log-filter ${state._waiterStaffFilter === s.id ? 'active' : ''}" data-staff-filter="${s.id}">${esc(s.name)}</button>`
    )).join('');
  }

  setStaffFilter(staffId) {
    state._waiterStaffFilter = staffId;
    this.render();
  }

  render() {
    if (!state.user || state.user.role !== 'staff') return;
    this.renderCatTabs();
    this.renderStaffFilter();

    if (!state.tables.length) {
      this.el.innerHTML = '<p style="color:var(--text3);">Admin hələ masa əlavə etməyib.</p>';
      return;
    }

    let filtered = state._waiterCatFilter === 'all'
      ? state.tables
      : state.tables.filter(t => (t.category || t.name.replace(/\s+\d+$/, '') || t.name) === state._waiterCatFilter);
    if (!filtered.length) { this.el.innerHTML = '<p style="color:var(--text3);">Bu kateqoriyada masa yoxdur.</p>'; return; }

    if (state._waiterStaffFilter) {
      filtered = filtered.filter(t => t.occupant === state._waiterStaffFilter);
      if (!filtered.length) { this.el.innerHTML = '<p style="color:var(--text3);">Bu işçinin xidmət etdiyi masa yoxdur.</p>'; return; }
    }

    const canViewOthers = hasPermission('waiter.view');

    this.el.innerHTML = filtered.map(t => {
      const isMine = t.occupant === state.user.id;
      const isOther = t.occupant && !isMine;
      const otherW = isOther ? (state.staff.find(s => s.id === t.occupant) || { name: '?' }) : null;
      const tableOrder = state.tableOrders[t.id];
      let cls = '', statusText = 'Boş';
      if (isMine) { cls = 'mine'; statusText = 'Sizin masanız'; }
      else if (isOther) {
        cls = canViewOthers ? 'other' : 'other locked';
        statusText = canViewOthers ? esc(otherW.name) : 'Dolu';
      } else { cls = 'empty'; }

      return `<div class="w-table-card ${cls}" data-table-id="${t.id}">
        <div class="w-table-name">${esc(t.name)}</div>
        <div class="w-table-status">${statusText}</div>
        ${t.occupant ? `<div style="font-size:11px;color:var(--text2);margin-top:4px;display:flex;align-items:center;gap:4px;"><svg class="icon" style="width:.9em;height:.9em;"><use href="#i-clock"></use></svg><span class="w-table-timer" data-since="${t.activatedAt||''}">--:--</span></div>` : ''}
        ${(isMine || (isOther && canViewOthers)) && tableOrder?.total ? `<div style="font-size:11px;color:var(--orange);font-weight:700;margin-top:4px;"><svg class="icon"><use href="#i-food"></use></svg> ${(tableOrder.total||0).toFixed(2)} ₼</div>` : ''}
        ${isMine && t.notes ? `<div style="font-size:11px;color:var(--text3);margin-top:6px;">${esc(t.notes.substring(0, 40))}${t.notes.length > 40 ? '…' : ''}</div>` : ''}
      </div>`;
    }).join('');

    this.startTimers();
  }

  // ── Canlı taymer (yalnız təyin olunmuş .w-table-timer mətnini yeniləyir, tam render etmir) ──
  startTimers() {
    this.updateTimers();
    if (state.tableTimerInterval) return;
    state.tableTimerInterval = setInterval(() => this.updateTimers(), 1000);
  }

  stopTimers() {
    if (state.tableTimerInterval) { clearInterval(state.tableTimerInterval); state.tableTimerInterval = null; }
  }

  updateTimers() {
    document.querySelectorAll('.w-table-timer').forEach(elx => {
      const since = parseInt(elx.dataset.since, 10);
      if (!since) { elx.textContent = '--:--'; return; }
      const totalSec = Math.max(0, Math.floor((Date.now() - since) / 1000));
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      elx.textContent = h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`;
    });
  }

  // ── Aktivləşdirmə / bağlama (çağıran tərəf - staff-app.js - konfirmasiya modal-larını göstərir) ──
  openActivateConfirm(tableId) {
    state.pendingTableId = tableId;
    document.dispatchEvent(new CustomEvent('table:activate-requested', { detail: { tableId } }));
  }

  confirmActivate(tableId) {
    R.tables.child(tableId).update({ occupant: state.user.id, activatedAt: Date.now() });
    const t = state.tables.find(x => x.id === tableId);
    addLog('table', `${state.user.name} "${t?.name}" masasını açdı`, { tableId, waiterId: state.user.id });
  }

  openDeactivateConfirm(tableId) {
    const order = state.tableOrders[tableId];
    document.dispatchEvent(new CustomEvent('table:close-requested', { detail: { tableId, order } }));
  }

  /** @returns {boolean} true = bağlandı, false = balans qapatmadı (çağıran tərəf toast göstərməlidir) */
  confirmDeactivate(tableId) {
    const order = state.tableOrders[tableId];
    if (order?.total > 0) {
      const remaining = (order.remainingAmount !== undefined && order.remainingAmount !== null)
        ? order.remainingAmount
        : order.total;
      if (remaining > 0.01) return false;
    }
    const t = state.tables.find(x => x.id === tableId);

    // Sifarişi arxivə köçür (hesabatlarda görünsün)
    if (order && order.items) {
      const archiveData = {
        tableId, tableName: t?.name || '?',
        staffId: state.user?.id || null, staffName: state.user?.name || '?',
        items: order.items, total: order.total || 0, notes: t?.notes || '',
        closedAt: Date.now(),
        closedTime: new Date().toLocaleTimeString('az-AZ'),
        closedDate: new Date().toLocaleDateString('az-AZ')
      };
      db.ref('closedOrders').push(archiveData);
    }

    R.tableOrders.child(tableId).remove();
    R.tables.child(tableId).update({ occupant: null, notes: '', activatedAt: null });
    addLog('table', `${state.user?.name} "${t?.name}" masasını bağladı (${(order?.total||0).toFixed(2)} ₼)`, { staffId: state.user?.id, tableId });
    return true;
  }
}
