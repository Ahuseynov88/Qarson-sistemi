/* ═══════════════════════════════════════════
   TABLE BOARD
   Qarson ekranındakı masa grid-i: kateqoriya/işçi filtri,
   masa aktivləşdirmə/bağlama, canlı taymer.
   Hadisələr addEventListener ilə bağlanır (inline onclick yoxdur).
═══════════════════════════════════════════ */
import { R, db } from './firebase-service.js';
import { state } from './state.js';
import { esc, showToast, addLog, tableCategoryOf, serverNow, azTime, azDate, money2 } from './utils.js';
import { hasPermission, staffHasPermission } from './permissions.js';
import { checkReferralBonusOnClose } from './loyalty.js';
import { shiftNow } from './yuza-shift.js';

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
    // 21.11: filtr sətri — [Açıq (N)] + [👤 Ofisiant ▾]
    this.staffFilterEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-waiter-clear]')) { e.stopPropagation(); this.setStaffFilter(null); return; }
      if (e.target.closest('[data-open-toggle]')) { state._waiterOpenOnly = !state._waiterOpenOnly; this.render(); return; }
      const pick = e.target.closest('[data-waiter-pick]');
      if (pick) this.openWaiterPicker(pick);
    });
  }

  _handleCardClick(tableId) {
    const t = state.tables.find(x => x.id === tableId);
    if (!t) return;
    const isMine = t.occupant === state.user.id;
    const isOther = t.occupant && !isMine;
    if (!t.occupant) {
      if (!hasPermission('table.open')) { showToast('<svg class="icon"><use href="#i-ban"></use></svg> Masa açmaq icazəniz yoxdur'); return; }
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
    state.tables.forEach(t => cats.add(tableCategoryOf(t)));
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

  /* Kateqoriya filtrinə uyğun masalar (Açıq/Ofisiant sayları bunun üzərindən hesablanır) */
  _catTables() {
    return state._waiterCatFilter === 'all' || !state._waiterCatFilter
      ? state.tables
      : state.tables.filter(t => tableCategoryOf(t) === state._waiterCatFilter);
  }

  renderStaffFilter() {
    const canOthers = hasPermission('waiter.view');
    if (!canOthers) state._waiterStaffFilter = null;   // başqasının masalarına baxa bilməyən üçün ofisiant seçimi yoxdur
    if (!state.tables.length) { this.staffFilterEl.style.display = 'none'; return; }
    const openN = this._catTables().filter(t => t.occupant).length;
    const sel = state._waiterStaffFilter;
    const selName = !sel ? '' : sel === state.user?.id ? 'Mənim masalarım'
      : (state.staff.find(x => x.id === sel)?.name || (sel === 'admin' ? 'Patron' : '?'));
    this.staffFilterEl.style.display = 'flex';
    this.staffFilterEl.classList.add('yz-tfilter');
    this.staffFilterEl.innerHTML =
      `<button type="button" class="log-filter yz-tf-open${state._waiterOpenOnly ? ' active' : ''}" data-open-toggle aria-pressed="${state._waiterOpenOnly ? 'true' : 'false'}">Açıq <b>(${openN})</b></button>`
      + (canOthers ? `<button type="button" class="log-filter yz-tf-waiter${sel ? ' active' : ''}" data-waiter-pick aria-haspopup="dialog">
          <svg class="icon"><use href="#i-user"></use></svg><span class="yz-tf-waiter__lbl">${sel ? esc(selName) : 'Ofisiant'}</span>
          ${sel ? '<span class="yz-tf-x" data-waiter-clear role="button" aria-label="Seçimi sil" title="Seçimi sil">✕</span>' : '<span class="yz-tf-caret" aria-hidden="true">▾</span>'}
        </button>` : '');
  }

  /* Ofisiant seçimi: telefonda aşağıdan açılan panel, kompüterdə düymənin altında siyahı.
     .modal-bg qatı kimi açılır — Geri / Esc onu bir addımda bağlayır. */
  async openWaiterPicker(anchor) {
    document.querySelector('.yz-wpick')?.remove();
    const tabs = this._catTables();
    const openOf = (id) => tabs.filter(t => t.occupant === id).length;
    const me = state.user?.id;
    let st = {};
    try { st = (await db.ref('att/status').once('value')).val() || {}; } catch (e) { st = {}; }
    const isIn = (id) => ['in', 'break'].includes(st[id]?.state);
    const list = state.staff.filter(x => x.id !== me && staffHasPermission(x, 'table.view'))
      .map(x => ({ id: x.id, name: x.name || '?', n: openOf(x.id), on: isIn(x.id) }))
      .sort((a, b) => (b.on - a.on) || (b.n - a.n) || a.name.localeCompare(b.name, 'az', { numeric: true }));
    const row = (id, name, n, dim, extra = '') => `<button type="button" class="yz-wpick__row${dim ? ' is-dim' : ''}${state._waiterStaffFilter === id ? ' is-sel' : ''}" data-wid="${esc(id)}" data-wname="${esc(name.toLowerCase())}">
        <span class="yz-wpick__name">${esc(name)}${extra}</span><span class="yz-wpick__n">${n}</span></button>`;
    const bg = document.createElement('div');
    bg.className = 'modal-bg yz-wpick';
    bg.innerHTML = `<div class="yz-wpick__box" role="dialog" aria-label="Ofisiant seçimi">
        <div class="yz-wpick__head"><b>Ofisiant</b><span class="yz-wpick__hint">açıq masa sayı</span><button type="button" class="yz-wpick__close" data-close aria-label="Bağla">✕</button></div>
        ${list.length > 7 ? '<input type="search" class="yz-wpick__q" placeholder="Ad axtar..." aria-label="Ofisiant axtar" data-no-dirty>' : ''}
        <div class="yz-wpick__list">
          ${me ? row(me, 'Mənim masalarım', openOf(me), false) : ''}
          ${row('_all', 'Hamısı', tabs.filter(t => t.occupant).length, false)}
          ${list.length ? '<div class="yz-wpick__sep"></div>' : ''}
          ${list.map(x => row(x.id, x.name, x.n, !x.on && !x.n, x.on ? ' <i class="yz-wpick__on" title="İşdədir"></i>' : '')).join('')}
        </div></div>`;
    document.body.appendChild(bg);
    const close = () => { bg.classList.remove('open'); setTimeout(() => bg.remove(), 0); };
    if (window.matchMedia('(min-width:900px)').matches && anchor) {
      const r = anchor.getBoundingClientRect(), box = bg.querySelector('.yz-wpick__box');
      box.style.top = Math.round(r.bottom + 6) + 'px';
      box.style.left = Math.round(Math.min(r.left, window.innerWidth - 300)) + 'px';
    }
    bg.addEventListener('click', (e) => {
      if (e.target === bg || e.target.closest('[data-close]')) { close(); return; }
      const b = e.target.closest('[data-wid]');
      if (!b) return;
      close();
      this.setStaffFilter(b.dataset.wid === '_all' ? null : b.dataset.wid);
    });
    const q = bg.querySelector('.yz-wpick__q');
    if (q) q.addEventListener('input', () => {
      const v = q.value.trim().toLowerCase();
      bg.querySelectorAll('.yz-wpick__row').forEach(r => { r.hidden = !!v && !(r.dataset.wname || '').includes(v); });
    });
    requestAnimationFrame(() => bg.classList.add('open'));
  }

  setStaffFilter(staffId) {
    state._waiterStaffFilter = staffId;
    this.render();
  }

  render() {
        if (!state.user || (state.user.role !== 'staff' && state.user.role !== 'admin')) return;
    this.renderCatTabs();
    this.renderStaffFilter();

    if (!state.tables.length) {
      this.el.innerHTML = '<div class="yz-empty"><svg class="icon"><use href="#i-chair"></use></svg><b>Hələ masa yoxdur</b><span>Masaları Rəhbər «Qeydiyyat → Masalar» bölməsindən əlavə edir.</span></div>';
      return;
    }

    let filtered = state._waiterCatFilter === 'all'
      ? state.tables
      : state.tables.filter(t => tableCategoryOf(t) === state._waiterCatFilter);
    if (!filtered.length) { this.el.innerHTML = '<p style="color:var(--text3);">Bu kateqoriyada masa yoxdur.</p>'; return; }

    if (state._waiterOpenOnly) {
      filtered = filtered.filter(t => t.occupant);
      if (!filtered.length) { this.el.innerHTML = '<p style="color:var(--text3);">Hazırda açıq masa yoxdur.</p>'; return; }
    }
    if (state._waiterStaffFilter) {
      filtered = filtered.filter(t => t.occupant === state._waiterStaffFilter);
      if (!filtered.length) { this.el.innerHTML = '<p style="color:var(--text3);">' + (state._waiterStaffFilter === state.user.id ? 'Sizin açıq masanız yoxdur.' : 'Bu işçinin xidmət etdiyi masa yoxdur.') + '</p>'; return; }
    }

    const canViewOthers = hasPermission('waiter.view');

    this.el.innerHTML = filtered.map(t => {
      const isMine = t.occupant === state.user.id;
      const isOther = t.occupant && !isMine;
       const otherW = isOther ? (state.staff.find(s => s.id === t.occupant) || { name: t.occupant === 'admin' ? 'Patron' : '?' }) : null;
      const tableOrder = state.tableOrders[t.id];
      let cls = '', statusText = 'Boş masa';
      if (isMine) { cls = 'mine'; statusText = 'Sizin masanız'; }
      else if (isOther) {
        // Xidmət edən işçinin ADI HƏR KƏSƏ göstərilir (kim harada işlədiyini bilmək
        // faydalıdır) - AMMA masaya DAXİL OLMA hüququ yalnız "waiter.view" icazəsi
        // olanlara aiddir (bax: _handleCardClick). Bunlar İKİ AYRI şeydir - görmə vs giriş.
        cls = canViewOthers ? 'other-manage' : 'other';
        statusText = esc(otherW.name);
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

  /* Mərhələ 2a: masa transaction ilə açılır — iki ofisiant eyni anda eyni masanı aça bilməz.
     @returns {Promise<boolean>} false = masa artıq başqası tərəfindən açılıb */
  confirmActivate(tableId) {
    if (!hasPermission('table.open')) return Promise.resolve(false);   // "Masa açmaq" icazəsi yoxdursa masa açılmır
    const now = serverNow();
    const sessionId = `${tableId}_${now}`;
    const me = { id: state.user.id, name: state.user.name };
    return R.tables.child(tableId).transaction(cur => {
      if (!cur) return cur;                 // keş boşdursa server dəyəri ilə təkrarlanır
      if (cur.occupant) return;             // artıq açılıb → imtina
      return { ...cur, occupant: me.id, activatedAt: now, sessionId, openedById: me.id, openedByName: me.name, closingAt: null, closingBy: null };
    }, undefined, false).then(res => {
      if (!res.committed || res.snapshot.val()?.sessionId !== sessionId) return false;
      const t = state.tables.find(x => x.id === tableId);
      addLog('table_open', `${me.name} "${t?.name}" masasını açdı`, { tableId, sessionId, waiterId: me.id });
      return true;
    }).catch(() => false);
  }

  openDeactivateConfirm(tableId) {
    const order = state.tableOrders[tableId];
    document.dispatchEvent(new CustomEvent('table:close-requested', { detail: { tableId, order } }));
  }

  /* Mərhələ 2a: masanın bağlanması BİR yazı ilə olur — satış arxivi, masanın boşaldılması,
     ödənişlərin və nisyələrin jurnala köçürülməsi ya hamısı birlikdə yazılır, ya heç biri.
     Əvvəl masa "bağlanır" kimi işarələnir (transaction): iki cihaz eyni masanı eyni anda bağlasa,
     satış iki dəfə arxivə düşmür.
     @returns {Promise<{ok:boolean, msg?:string}>} */
  async confirmDeactivate(tableId) {
    const local = state.tableOrders[tableId];
    if (local?.total > 0) {
      const rem = (local.remainingAmount !== undefined && local.remainingAmount !== null) ? local.remainingAmount : local.total;
      if (rem > 0.01) return { ok: false, msg: 'Hesab tam ödənilməyib! Əvvəlcə ödəniş alın.' };
    }
    const t0 = state.tables.find(x => x.id === tableId);
    const sessionId = t0?.sessionId || null;
    const me = { id: state.user?.id || null, name: state.user?.name || '?' };

    /* 1) Masanı "bağlanır" kimi işarələ */
    let why = '';
    const claimAt = serverNow();
    const claimId = me.id + ':' + Math.random().toString(36).slice(2, 10);   // hər cəhd üçün ayrıca
    let claim;
    try {
      claim = await R.tables.child(tableId).transaction(cur => {
        why = '';
        if (!cur) return cur;
        if (!cur.occupant || (sessionId && cur.sessionId !== sessionId)) { why = 'Bu masa artıq bağlanıb.'; return; }
        if (cur.closingAt && claimAt - cur.closingAt < 60000) { why = 'Bu masa hazırda bağlanır — bir az gözləyin.'; return; }
        return { ...cur, closingAt: claimAt, closingBy: claimId };
      }, undefined, false);
    } catch (e) { return { ok: false, msg: 'Bağlantı xətası — masa bağlanmadı. Yenidən cəhd edin.' }; }
    if (!claim.committed) return { ok: false, msg: why || 'Masa bağlanmadı.' };
    if (!claim.snapshot.val()) return { ok: false, msg: 'Masa tapılmadı.' };
    const t = { id: tableId, ...claim.snapshot.val() };
    const release = () => R.tables.child(tableId).update({ closingAt: null, closingBy: null }).catch(() => {});

    /* 2) Sifarişin ən son vəziyyəti (başqa cihazın son ödənişi də daxil) */
    let order;
    try { order = (await R.tableOrders.child(tableId).once('value')).val(); }
    catch (e) { release(); return { ok: false, msg: 'Bağlantı xətası — masa bağlanmadı. Yenidən cəhd edin.' }; }
    if (order?.total > 0) {
      const rem = money2(Math.max(0, (order.total || 0) - (order.paidAmount || 0)));
      if (rem > 0.01) { release(); return { ok: false, msg: `Hesab tam ödənilməyib (${rem.toFixed(2)} ₼ qalıb). Əvvəlcə ödəniş alın.` }; }
    }

    const closedAtNow = serverNow();
    const closeMsg = `${me.name} "${t.name}" masasını bağladı (${(order?.total || 0).toFixed(2)} ₼)`;
    // Bu sessiyaya aid bütün tarixçəni topla (aktivləşmədən bağlanmaya qədər) və arxivə bük
    // Mərhələ 3a: ofisiant cihazı logları yükləmir — bu masanın açıldığı andan bəri loglar bazadan oxunur
    let logSrc = state.logs || [];
    if (sessionId) {
      try {
        const from = Number(t.activatedAt || order?.firstOrderAt || 0) || (closedAtNow - 24 * 3600000);
        logSrc = Object.values((await R.logs.orderByChild('timestamp').startAt(from - 60000).once('value')).val() || {});
      } catch (e) { /* oxunmasa yaddaşdakı loglarla davam */ }
    }
    const sessionLog = sessionId
      ? logSrc.filter(l => l.details?.sessionId === sessionId).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
          .map(l => ({ message: l.message, time: l.time, date: l.date, timestamp: l.timestamp }))
      : [];
    sessionLog.push({ message: closeMsg, time: azTime(closedAtNow), date: azDate(closedAtNow), timestamp: closedAtNow });

    // Sifarişi göndərən (satışı edən) işçi - masanı bağlayan işçidən FƏRQLİ ola bilər.
    const orderedById = (order && order.waiterId) || t.openedById || me.id;
    const orderedByStaff = state.staff.find(s => s.id === orderedById);
    const orderedByName = orderedByStaff?.name || t.openedByName || me.name;
    // Masa başqa ofisianta ötürülübsə, satış ötürmə anına görə bölünür (yuza-table-reassign.js)
    const waiterSplit = window.__yzSplitByWaiter ? window.__yzSplitByWaiter(order, orderedById, orderedByName) : null;
    const pays = order?.pays || {}, charges = order?.charges || {};

    const archiveData = {
      tableId, tableName: t.name || '?',
      staffId: me.id, staffName: me.name,
      openedById: t.openedById || null, openedByName: t.openedByName || '?',
      orderedById, orderedByName, waiterSplit,
      items: (order && order.items) || {}, total: (order && order.total) || 0, notes: t.notes || '',
      paidAmount: money2(order?.paidAmount || 0),
      paymentIds: Object.keys(pays).length ? Object.fromEntries(Object.keys(pays).map(k => [k, true])) : null,
      charges: Object.keys(charges).length ? Object.fromEntries(Object.entries(charges).map(([k, c]) => [k, { customerId: c.customerId, customerName: c.customerName, amount: c.amount, items: c.items || null }])) : null,
      sessionId,
      sessionLog,
      restoreCount: t.restoreCount || 0,
      restoredFrom: order?.restoredFrom || null,
      banquet: order?.banquet || null,             // banket masasıdırsa: banketin ID-si və alınmış beh   // geri qaytarılmış çekdən yaranıbsa — köhnə çekin ID-si
      shiftId: shiftNow()?.id || null,               // hansı kassa növbəsində bağlanıb
      // Hesabatlar bu vaxta görə aparılır (masa bağlanma vaxtına görə YOX)
      firstOrderAt: (order && order.firstOrderAt) || t.activatedAt || closedAtNow,
      closedAt: closedAtNow,
      closedTime: azTime(closedAtNow),
      closedDate: azDate(closedAtNow)
    };

    const closedKey = R.closedOrders.push().key;
    const upd = { ['closedOrders/' + closedKey]: archiveData, ['tableOrders/' + tableId]: null };
    if (t.isRestoredTemp) {
      // Müvəqqəti bərpa masası bağlananda tamamilə silinir (tarixçəsi artıq arxivdədir)
      upd['tables/' + tableId] = null;
    } else {
      for (const k of ['occupant', 'notes', 'activatedAt', 'sessionId', 'openedById', 'openedByName', 'loyaltyCustomerId', 'loyaltyGuestId', 'closingAt', 'closingBy'])
        upd[`tables/${tableId}/${k}`] = k === 'notes' ? '' : null;
    }
    // Jurnala köçürülməmiş qalmış ödəniş və nisyələr (eyni ID — ikiqat yazılmır)
    // (jurnal qeydləri yalnız yaradıla bilir — artıq yazılmış ödəniş yenidən yazılmır)
    try {
      // Banket behi (type 'deposit') kassaya beh alınanda yazılıb — burada təkrar yazılmır
      const payList = Object.entries(pays).filter(([, rec]) => rec?.type !== 'deposit');
      const have = await Promise.all(payList.map(([pid]) => R.payments.child(pid).once('value').then(x => x.exists())));
      payList.forEach(([pid, rec], i) => { if (!have[i]) upd['payments/' + pid] = rec; });
    } catch (e) { release(); return { ok: false, msg: 'Bağlantı xətası — masa bağlanmadı. Yenidən cəhd edin.' }; }
    for (const [cid, c] of Object.entries(charges)) {
      if (c.posted) continue;
      upd['customerCharges/' + cid] = { ...c, posted: null };
      upd[`customers/${c.customerId}/balance`] = firebase.database.ServerValue.increment(c.amount);
    }
    try { await db.ref().update(upd); }
    catch (e) { release(); return { ok: false, msg: 'Masa bağlanmadı (bağlantı və ya icazə xətası). Heç nə dəyişməyib, yenidən cəhd edin.' }; }

    checkReferralBonusOnClose(t.loyaltyCustomerId, archiveData.total);
    addLog('table_close', closeMsg, { tableId, sessionId, staffId: me.id });
    return { ok: true };
  }
}
