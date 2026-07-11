/* ═══════════════════════════════════════════
   ORDER CART
   "Sifariş Et / Əlavə Et" ekranı: kateqoriyalar, mal siyahısı,
   draft səbət, sifarişin göndərilməsi (Firebase transaction).
═══════════════════════════════════════════ */
import { R } from './firebase-service.js';
import { state } from './state.js';
import { esc, showToast, addLog, makeLineKey, updateStock } from './utils.js';
import { hasPermission } from './permissions.js';
import { showScreen } from './theme.js';

export class OrderCart {
  /**
   * @param {Object} els - { screen, title, catTabs, itemsList, draftList, draftTotal }
   * @param {Object} callbacks - { onClosed() }
   */
  constructor(els, callbacks = {}) {
    this.els = els;
    this.onClosed = callbacks.onClosed || (() => {});
    this._noteOpenKeys = new Set();
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
      const noteToggle = e.target.closest('[data-note-toggle]');
      if (noteToggle) { this.toggleNoteInput(noteToggle.dataset.noteToggle); return; }
      const removeBtn = e.target.closest('[data-remove-line]');
      if (removeBtn) { state._orderDraft[removeBtn.dataset.removeLine] && (delete state._orderDraft[removeBtn.dataset.removeLine], this.renderDraftList()); return; }
    });
    this.els.draftList.addEventListener('change', (e) => {
      const noteInput = e.target.closest('[data-note-line]');
      if (noteInput) { state._orderDraft[noteInput.dataset.noteLine].note = noteInput.value; return; }
      const feeInput = e.target.closest('[data-fee-line]');
      if (feeInput) {
        const line = state._orderDraft[feeInput.dataset.feeLine];
        if (line) { line.extraFee = parseFloat(feeInput.value) || 0; this.renderDraftList(); }
      }
    });
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
    showScreen('orderScreen');
  }

  close() {
    showScreen('waiterScreen');
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
      <button class="category-rail__tab ${state._orderCatFilter===c?'active':''}" data-cat="${esc(c)}">
        <svg class="icon"><use href="#i-${c==='all'?'clipboard':'food'}"></use></svg>
        <span>${c === 'all' ? 'Hamısı' : esc(c)}</span>
      </button>
    `).join('');
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
      return `<div class="product-card ${outOfStock?'out-of-stock':''}" data-menu-item-id="${m.id}">
        <div class="product-card__name">${esc(m.name)}</div>
        <div class="product-card__price">${(m.price||0).toFixed(2)} ₼</div>
        ${outOfStock ? '<div class="product-card__oos">Bitib</div>' : ''}
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

  toggleNoteInput(lineKey) {
    if (this._noteOpenKeys.has(lineKey)) this._noteOpenKeys.delete(lineKey);
    else this._noteOpenKeys.add(lineKey);
    this.renderDraftList();
  }

  renderDraftList() {
    document.dispatchEvent(new CustomEvent('order:draft-changed'));
    const lines = Object.entries(state._orderDraft);
    if (!lines.length) {
      this.els.draftList.innerHTML = '';
      this.els.draftTotal.textContent = ((state.tableOrders[state.orderTableId]?.total)||0).toFixed(2) + ' ₼';
      return;
    }
    let draftTotal = 0;
    const rows = lines.map(([lineKey, line]) => {
      const m = state.menuItems.find(x => x.id === line.menuItemId);
      if (!m) return '';
      const lineTotal = (m.price||0) * line.qty + (line.extraFee||0);
      draftTotal += lineTotal;
      const noteOpen = this._noteOpenKeys.has(lineKey);
      const hasNote = !!(line.note && line.note.trim());
      return `<div class="ticket-line">
        <div class="ticket-line__main">
          <span class="ticket-line__name">${esc(m.name)}</span>
          <button class="ticket-line__note-btn ${hasNote?'has-note':''}" data-note-toggle="${lineKey}" title="Qeyd əlavə et">
            <svg class="icon"><use href="#i-edit"></use></svg>
          </button>
          <div class="qty-stepper">
            <button data-qty-change="-1" data-line-key="${lineKey}">−</button>
            <span class="qty-stepper__val">${line.qty}</span>
            <button data-qty-change="1" data-line-key="${lineKey}">+</button>
          </div>
          <span class="ticket-line__price">${lineTotal.toFixed(2)} ₼</span>
          <button data-remove-line="${lineKey}" style="background:none;border:none;color:var(--text3);cursor:pointer;padding:2px;flex-shrink:0;">
            <svg class="icon"><use href="#i-close"></use></svg>
          </button>
        </div>
        ${hasNote && !noteOpen ? `<div class="ticket-line__tags"><span style="font-size:11px;color:var(--text3);"><svg class="icon"><use href="#i-note"></use></svg> ${esc(line.note)}</span></div>` : ''}
        ${noteOpen ? `<input type="text" class="ticket-note-input" data-note-line="${lineKey}" value="${esc(line.note||'')}" placeholder="Qeyd (məs: soğansız, çox bişmiş)" autofocus>` : ''}
        ${hasPermission('order.discount') ? `<div style="display:flex;align-items:center;gap:6px;margin-top:7px;">
          <label style="font-size:10.5px;color:var(--text3);white-space:nowrap;">Əlavə ödəniş:</label>
          <input type="number" data-fee-line="${lineKey}" value="${line.extraFee||''}" placeholder="0.00" step="0.01"
                 style="width:70px;font-size:11px;padding:4px 6px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);">
          <span style="font-size:10.5px;color:var(--text3);">₼</span>
        </div>` : ''}
      </div>`;
    }).join('');
    this.els.draftList.innerHTML = `<div style="font-size:11px;font-weight:700;color:var(--blue);text-transform:uppercase;letter-spacing:.04em;margin:10px 0 4px;">
      <svg class="icon" style="width:.9em;height:.9em;"><use href="#i-plus"></use></svg> Yeni (göndərilməmiş)
    </div>${rows}`;
    const sentTotal = (state.tableOrders[state.orderTableId]?.total) || 0;
    this.els.draftTotal.textContent = (sentTotal + draftTotal).toFixed(2) + ' ₼';
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
