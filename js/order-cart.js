/* ═══════════════════════════════════════════
   ORDER CART
   "Sifariş Et / Əlavə Et" ekranı: kateqoriyalar, mal siyahısı,
   draft səbət, sifarişin göndərilməsi (Firebase transaction).
═══════════════════════════════════════════ */
import { R } from './firebase-service.js';
import { state } from './state.js';
import { esc, showToast, addLog, makeLineKey, updateStock } from './utils.js';
import { hasPermission } from './permissions.js';

export class OrderCart {
  /**
   * @param {Object} els - { screen, title, catTabs, itemsList, draftList, draftTotal, removeSelectedBtn }
   * @param {Object} callbacks - { onClosed() }
   */
  constructor(els, callbacks = {}) {
    this.els = els;
    this.onClosed = callbacks.onClosed || (() => {});
    this._bindEvents();
  }

  _bindEvents() {
    this.els.catTabs.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cat]');
      if (!btn) return;
      this.setCategory(btn.dataset.cat);
    });
    this.els.itemsList.addEventListener('click', (e) => {
      const card = e.target.closest('[data-menu-item-id]');
      if (!card) return;
      this.addItemDirect(card.dataset.menuItemId);
    });
    this.els.draftList.addEventListener('click', (e) => {
      const qtyBtn = e.target.closest('[data-qty-change]');
      if (qtyBtn) { this.changeDraftQty(qtyBtn.dataset.lineKey, parseInt(qtyBtn.dataset.qtyChange, 10)); return; }
      const noteInput = e.target.closest('[data-note-line]');
      if (noteInput) return; // input dəyişikliyi 'change' hadisəsi ilə tutulur (aşağıda)
    });
    this.els.draftList.addEventListener('change', (e) => {
      const checkbox = e.target.closest('[data-cancel-select]');
      if (checkbox) { this.toggleCancelSelect(checkbox.dataset.cancelSelect); return; }
      const noteInput = e.target.closest('[data-note-line]');
      if (noteInput) { state._orderDraft[noteInput.dataset.noteLine].note = noteInput.value; return; }
      const feeInput = e.target.closest('[data-fee-line]');
      if (feeInput) {
        const line = state._orderDraft[feeInput.dataset.feeLine];
        if (line) { line.extraFee = parseFloat(feeInput.value) || 0; this.renderDraftList(); }
      }
    });
    this.els.removeSelectedBtn.addEventListener('click', () => this.removeSelectedDraftLines());
  }

  open(tableId) {
    state.orderTableId = tableId;
    state._orderDraft = {};
    state._orderCatFilter = 'all';
    const t = state.tables.find(x => x.id === tableId);
    this.els.title.innerHTML = `<svg class="icon"><use href="#i-food"></use></svg> ${esc(t?.name || 'Sifariş')}`;
    this.renderCatTabs();
    this.renderItemsList();
    this.renderDraftList();
    this.els.screen.classList.add('active');
  }

  close() {
    this.els.screen.classList.remove('active');
    state.orderTableId = null;
    this.onClosed();
  }

  getCategories() {
    const cats = new Set();
    state.menuItems.forEach(m => { if (m.available !== false) cats.add(m.category || 'Digər'); });
    return Array.from(cats);
  }

  renderCatTabs() {
    const cats = ['all', ...this.getCategories()];
    this.els.catTabs.innerHTML = cats.map(c => `
      <button class="admin-tab" style="width:100%;justify-content:flex-start;${state._orderCatFilter===c?'':''}" data-cat="${esc(c)}">
        ${c === 'all' ? 'Hamısı' : esc(c)}
      </button>
    `).join('');
    this.els.catTabs.querySelectorAll('[data-cat]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.cat === state._orderCatFilter);
    });
  }

  setCategory(cat) {
    state._orderCatFilter = cat;
    this.renderCatTabs();
    this.renderItemsList();
  }

  renderItemsList() {
    const items = state.menuItems.filter(m => {
      if (m.available === false) return false;
      if (state._orderCatFilter === 'all') return true;
      return (m.category || 'Digər') === state._orderCatFilter;
    });
    if (!items.length) { this.els.itemsList.innerHTML = '<p style="color:var(--text3);grid-column:1/-1;">Bu kateqoriyada mal yoxdur.</p>'; return; }
    this.els.itemsList.innerHTML = items.map(m => {
      const outOfStock = (m.stock !== undefined && m.stock !== null && m.stock <= 0);
      return `<div class="item-card" data-menu-item-id="${m.id}" style="cursor:pointer;text-align:center;padding:10px;${outOfStock?'opacity:.4;pointer-events:none;':''}">
        <div style="font-weight:700;font-size:13px;">${esc(m.name)}</div>
        <div style="color:var(--green);font-weight:700;margin-top:4px;">${(m.price||0).toFixed(2)} ₼</div>
        ${outOfStock ? '<div style="font-size:11px;color:var(--red);margin-top:2px;">Bitib</div>' : ''}
      </div>`;
    }).join('');
  }

  addItemDirect(menuItemId) {
    const m = state.menuItems.find(x => x.id === menuItemId);
    if (!m) return;
    const lineKey = makeLineKey(menuItemId, '', 0);
    if (state._orderDraft[lineKey]) state._orderDraft[lineKey].qty += 1;
    else state._orderDraft[lineKey] = { menuItemId, qty: 1, note: '', extraFee: 0 };
    this.renderDraftList();
  }

  changeDraftQty(lineKey, delta) {
    const line = state._orderDraft[lineKey];
    if (!line) return;
    line.qty += delta;
    if (line.qty <= 0) delete state._orderDraft[lineKey];
    this.renderDraftList();
  }

  toggleCancelSelect(lineKey) {
    if (!state._orderCancelSelection) state._orderCancelSelection = {};
    state._orderCancelSelection[lineKey] = !state._orderCancelSelection[lineKey];
    this.els.removeSelectedBtn.style.display = Object.values(state._orderCancelSelection).some(Boolean) ? '' : 'none';
  }

  removeSelectedDraftLines() {
    const sel = state._orderCancelSelection || {};
    Object.keys(sel).forEach(k => { if (sel[k]) delete state._orderDraft[k]; });
    state._orderCancelSelection = {};
    this.renderDraftList();
  }

  renderDraftList() {
    const lines = Object.entries(state._orderDraft);
    if (!lines.length) {
      this.els.draftList.innerHTML = '<p style="color:var(--text3);text-align:center;padding:20px;">Səbət boşdur. Yuxarıdan mal seçin.</p>';
      this.els.draftTotal.textContent = '0.00 ₼';
      this.els.removeSelectedBtn.style.display = 'none';
      return;
    }
    let total = 0;
    this.els.draftList.innerHTML = lines.map(([lineKey, line]) => {
      const m = state.menuItems.find(x => x.id === line.menuItemId);
      if (!m) return '';
      const lineTotal = (m.price||0) * line.qty + (line.extraFee||0);
      total += lineTotal;
      const checked = !!(state._orderCancelSelection && state._orderCancelSelection[lineKey]);
      return `<div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
          <input type="checkbox" data-cancel-select="${lineKey}" ${checked?'checked':''} style="width:16px;height:16px;accent-color:var(--red);">
          <span style="flex:1;font-size:13px;font-weight:600;">${esc(m.name)}</span>
          <button data-qty-change="-1" data-line-key="${lineKey}" style="background:var(--border);border:none;border-radius:6px;width:24px;height:24px;font-weight:700;cursor:pointer;">−</button>
          <span style="font-weight:700;min-width:20px;text-align:center;">${line.qty}</span>
          <button data-qty-change="1" data-line-key="${lineKey}" style="background:var(--border);border:none;border-radius:6px;width:24px;height:24px;font-weight:700;cursor:pointer;">+</button>
          <span style="font-weight:700;">${lineTotal.toFixed(2)} ₼</span>
        </div>
        <input type="text" data-note-line="${lineKey}" value="${esc(line.note||'')}" placeholder="Qeyd (məs: soğansız)"
               style="width:100%;margin-top:6px;font-size:12px;padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);">
        ${hasPermission('order.discount') ? `<div style="display:flex;align-items:center;gap:6px;margin-top:6px;">
          <label style="font-size:11px;color:var(--text2);white-space:nowrap;">Əlavə ödəniş:</label>
          <input type="number" data-fee-line="${lineKey}" value="${line.extraFee||''}" placeholder="0.00" step="0.01"
                 style="width:80px;font-size:12px;padding:4px 6px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);">
          <span style="font-size:11px;color:var(--text3);">₼</span>
        </div>` : ''}
      </div>`;
    }).join('');
    this.els.draftTotal.textContent = total.toFixed(2) + ' ₼';
    this.els.removeSelectedBtn.style.display = Object.values(state._orderCancelSelection||{}).some(Boolean) ? '' : 'none';
  }

  send() {
    const tableId = state.orderTableId;
    if (!tableId) return;
    const draftKeys = Object.keys(state._orderDraft);
    const t = state.tables.find(x => x.id === tableId);
    if (!draftKeys.length) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Heç mal seçilməyib'); return; }

    const draftSnapshot = JSON.parse(JSON.stringify(state._orderDraft));
    const waiterId = state.user.id, waiterName = state.user.name;

    R.tableOrders.child(tableId).transaction(current => {
      const items = {};
      if (current && current.items) Object.entries(current.items).forEach(([k, v]) => { items[k] = v; });

      draftKeys.forEach(lineKey => {
        const draft = draftSnapshot[lineKey];
        const m = state.menuItems.find(x => x.id === draft.menuItemId);
        if (!m) return;
        const cleanKey = makeLineKey(draft.menuItemId, draft.note || '', draft.extraFee || 0);
        if (items[cleanKey]) items[cleanKey] = { ...items[cleanKey], qty: items[cleanKey].qty + draft.qty };
        else items[cleanKey] = { menuItemId: draft.menuItemId, name: m.name, price: m.price || 0, qty: draft.qty, note: draft.note || '', extraFee: draft.extraFee || 0 };
      });

      let total = 0;
      Object.values(items).forEach(it => { total += (it.price || 0) * it.qty * (1 - ((it.discountPercent||0)/100)) + (it.extraFee || 0); });
      const paidAmount = (current && current.paidAmount) || 0;

      return {
        items, total,
        waiterId: (current && current.waiterId) || waiterId,
        paidAmount,
        remainingAmount: total - paidAmount,
        updatedAt: Date.now()
      };
    }, (error, committed, snapshot) => {
      if (error) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Xəta baş verdi, yenidən cəhd edin'); return; }
      if (!committed) return;
      draftKeys.forEach(lineKey => {
        const draft = draftSnapshot[lineKey];
        if (draft) updateStock(draft.menuItemId, -draft.qty, state.menuItems);
      });
      const finalTotal = (snapshot.val() && snapshot.val().total) || 0;
      addLog('order', `${waiterName} "${t?.name}" masası üçün sifariş göndərdi (${finalTotal.toFixed(2)} ₼)`, { waiterId, tableId });
      showToast('<svg class="icon"><use href="#i-check"></use></svg> Sifariş göndərildi');
    });

    this.close();
  }
}
