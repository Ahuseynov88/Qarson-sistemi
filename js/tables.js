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
import { checkReferralBonusOnClose } from './loyalty.js';

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
      <button class="category-rail__tab" style="white-space:nowrap;width:auto;${state._waiterCatFilter === c ? '' : ''}" data-cat="${esc(c)}">
        ${c === 'all' ? 'Hamısı' : esc(c)}
      </button>
    `).join('');
    this.catTabsEl.querySelectorAll('[data-cat]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.cat === state._waiterCatFilter);
    });
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
      let cls = '', statusText = 'Boş masa';
      if (isMine) { cls = 'mine'; statusText = 'Sizin masanız'; }
      else if (isOther) {
        cls = canViewOthers ? 'other-manage' : 'other';
        statusText = canViewOthers ? esc(otherW.name) : 'Dolu';
      } else { cls = 'empty'; }

      const showTotal = (isMine || (isOther && canViewOthers)) && tableOrder?.total;
      const showRemaining = showTotal && tableOrder.remainingAmount !== undefined && tableOrder.paidAmount > 0;

      return `<div class="floor-card ${cls}" data-table-id="${t.id}">
        <div class="floor-card__name">${esc(t.name)}</div>
        <div class="floor-card__status">${statusText}</div>
        ${t.occupant ? `<div class="floor-card__row"><svg class="icon"><use href="#i-clock"></use></svg><span class="floor-card__timer w-table-timer" data-since="${t.activatedAt||''}">--:--</span></div>` : ''}
        ${showTotal ? `<div class="floor-card__total">${showRemaining ? tableOrder.remainingAmount.toFixed(2) : tableOrder.total.toFixed(2)} ₼${showRemaining ? ' <span style="font-size:10px;opacity:.7;">qalıq</span>' : ''}</div>` : ''}
        ${isMine && t.notes ? `<div class="floor-card__note">${esc(t.notes.substring(0, 40))}${t.notes.length > 40 ? '…' : ''}</div>` : ''}
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
    this.updateColors();
  }

  // Dolu masaların rəngini son sifariş əməliyyatından keçən vaxta görə yeniləyir:
  // <30 dəq yaşıl, 30-60 dəq narıncı, 60+ dəq qırmızı; hesab çap olunubsa tünd göy (üstün gəlir).
  updateColors() {
    document.querySelectorAll('.floor-card[data-table-id]').forEach(card => {
      const tableId = card.dataset.tableId;
      const t = state.tables.find(x => x.id === tableId);
      card.classList.remove('floor-card--fresh','floor-card--warning','floor-card--danger','floor-card--billed');
      if (!t || !t.occupant) return;
      const order = state.tableOrders[tableId];
      if (order?.billPrintedAt) { card.classList.add('floor-card--billed'); return; }
      const ref = order?.updatedAt || t.activatedAt || Date.now();
      const mins = (Date.now() - ref) / 60000;
      if (mins < 30) card.classList.add('floor-card--fresh');
      else if (mins < 60) card.classList.add('floor-card--warning');
      else card.classList.add('floor-card--danger');
    });
  }

  // ── Aktivləşdirmə / bağlama (çağıran tərəf - staff-app.js - konfirmasiya modal-larını göstərir) ──
  openActivateConfirm(tableId) {
    state.pendingTableId = tableId;
    document.dispatchEvent(new CustomEvent('table:activate-requested', { detail: { tableId } }));
  }

  confirmActivate(tableId) {
    const sessionId = `${tableId}_${Date.now()}`;
    R.tables.child(tableId).update({ occupant: state.user.id, activatedAt: Date.now(), sessionId, openedById: state.user.id, openedByName: state.user.name });
    const t = state.tables.find(x => x.id === tableId);
    addLog('table', `${state.user.name} "${t?.name}" masasını açdı`, { tableId, sessionId, waiterId: state.user.id });
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
    const sessionId = t?.sessionId || null;
    const closeMsg = `${state.user?.name} "${t?.name}" masasını bağladı (${(order?.total||0).toFixed(2)} ₼)`;

    // Bu sessiyaya aid bütün tarixçəni topla (aktivləşmədən bağlanmaya qədər) və arxivə bük -
    // masa bağlandıqdan sonra da bu qeydlər itmir, bağlanmış masa qeydi ilə birlikdə qalır.
    const sessionLog = sessionId
      ? state.logs.filter(l => l.details?.sessionId === sessionId).slice().reverse()
          .map(l => ({ message: l.message, time: l.time, date: l.date, timestamp: l.timestamp }))
      : [];
    sessionLog.push({ message: closeMsg, time: new Date().toLocaleTimeString('az-AZ'), date: new Date().toLocaleDateString('az-AZ'), timestamp: Date.now() });

    const closedAtNow = Date.now();
    const archiveData = {
      tableId, tableName: t?.name || '?',
      staffId: state.user?.id || null, staffName: state.user?.name || '?',
      openedById: t?.openedById || null, openedByName: t?.openedByName || '?',
      items: (order && order.items) || {}, total: (order && order.total) || 0, notes: t?.notes || '',
      sessionId,
      sessionLog,
      restoreCount: t?.restoreCount || 0,
      // Hesabatlar bu vaxta görə aparılır (masa bağlanma vaxtına görə YOX) - saat 6-da
      // açılıb 12-də bağlanan masa "6" saatına aid sayılsın deyə. Sifariş heç olmayıbsa,
      // masanın açılma vaxtına düşür.
      firstOrderAt: (order && order.firstOrderAt) || t?.activatedAt || closedAtNow,
      closedAt: closedAtNow,
      closedTime: new Date(closedAtNow).toLocaleTimeString('az-AZ'),
      closedDate: new Date(closedAtNow).toLocaleDateString('az-AZ')
    };
    db.ref('closedOrders').push(archiveData);
    checkReferralBonusOnClose(t?.loyaltyCustomerId, archiveData.total);

    if (order) R.tableOrders.child(tableId).remove();
    if (t?.isRestoredTemp) {
      // Müvəqqəti bərpa masası: bağlananda tamamilə silinir - "Masalar" panelində
      // boş xəyal masa kimi qalmasın. Tarixçəsi artıq yuxarıda arxivə köçürülüb.
      R.tables.child(tableId).remove();
    } else {
      R.tables.child(tableId).update({ occupant: null, notes: '', activatedAt: null, sessionId: null, openedById: null, openedByName: null, loyaltyCustomerId: null, loyaltyGuestId: null });
    }
    addLog('table', closeMsg, { tableId, sessionId, staffId: state.user?.id });
    return true;
  }
}
