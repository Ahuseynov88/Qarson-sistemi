/* ═══════════════════════════════════════════════════════════════════════════
   Sifariş Modulu & Kompleks Səbət Mexanizmi - Giriş Təhlükəsizlikli Versiya
   ═══════════════════════════════════════════════════════════════════════════ */

import { R, db } from './firebase-service.js';
import { state } from './state.js';
import { esc, showToast, addLog, makeLineKey, updateStock } from './utils.js';
import { hasPermission } from './permissions.js';

class CartOfflineStorage {
  constructor() {
    this.dbName = 'IpekYolu_POS_DB';
    this.dbVersion = 1;
  }

  async savePendingAction(action) {
    return new Promise((resolve) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      request.onsuccess = (e) => {
        const dbInstance = e.target.result;
        if (!dbInstance.objectStoreNames.contains('offline_actions')) {
          resolve(false);
          return;
        }
        const tx = dbInstance.transaction('offline_actions', 'readwrite');
        const store = tx.objectStore('offline_actions');
        store.put({ id: Date.now().toString(), ...action });
        resolve(true);
      };
    });
  }
}

const cartOfflineStorage = new CartOfflineStorage();

export class OrderCart {
  constructor(els, callbacks = {}) {
    this.els = els;
    this.onClosed = callbacks.onClosed || (() => {});
    this.selectedLines = {};
    this._bindEvents();
  }

  _bindEvents() {
    // TƏHLÜKƏSİZLİK QORUYUCUSU: Giriş ekranında elementlər olmadıqda kodun qəzaya uğramasını əngəlləyir
    if (!this.els || !this.els.catTabs || !this.els.itemsList || !this.els.draftList) {
      console.warn("OrderCart: Sifariş paneli elementləri tapılmadı. İnstansiya qorunma rejimindədir.");
      return;
    }

    this.els.catTabs.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cat]');
      if (!btn) return;
      this.setCategory(btn.dataset.cat);
    });

    this.els.itemsList.addEventListener('click', (e) => {
      const card = e.target.closest('[data-menu-item-id]');
      if (!card) return;
      this.addItemToDraft(card.dataset.menuItemId);
    });

    this.els.draftList.addEventListener('click', (e) => {
      const qtyBtn = e.target.closest('[data-qty-change]');
      if (qtyBtn) {
        this.changeDraftQty(qtyBtn.dataset.lineKey, parseInt(qtyBtn.dataset.qtyChange, 10));
        return;
      }
      
      const noteBtn = e.target.closest('[data-note-trigger]');
      if (noteBtn) {
        this.toggleNoteInput(noteBtn.dataset.lineKey);
        return;
      }
    });

    this.els.draftList.addEventListener('change', (e) => {
      const checkbox = e.target.closest('[data-select-line]');
      if (checkbox) {
        this.selectedLines[checkbox.dataset.selectLine] = checkbox.checked;
        this.renderBatchPanel();
        return;
      }

      const noteInput = e.target.closest('[data-note-input]');
      if (noteInput) {
        this.updateLineNote(noteInput.dataset.lineKey, noteInput.value);
        return;
      }
    });

    if (this.els.btnSubmit) this.els.btnSubmit.addEventListener('click', () => this.submitOrderToServer());
    if (this.els.btnPayment) this.els.btnPayment.addEventListener('click', () => this.openPaymentModal());
    if (this.els.btnAuditLog) this.els.btnAuditLog.addEventListener('click', () => this.openAuditLogModal());
  }

  open(tableId) {
    state.orderTableId = tableId;
    state._orderCatFilter = 'all';
    this.selectedLines = {};
    
    const existingOrder = state.tableOrders ? state.tableOrders[tableId] : null;
    state._orderDraft = existingOrder && existingOrder.items ? JSON.parse(JSON.stringify(existingOrder.items)) : {};
    
    const t = state.tables?.find(x => x.id === tableId);
    if (this.els.title) this.els.title.innerHTML = `<svg class="icon"><use href="#i-food"></use></svg> ${esc(t?.name || 'Sifariş Paneli')}`;
    
    if (this.els.screen) this.els.screen.classList.add('active');
    this.renderAllPanes();
  }

  close() {
    if (this.els.screen) this.els.screen.classList.remove('active');
    state.orderTableId = null;
    this.onClosed();
  }

  renderAllPanes() {
    this.renderCategoryPane();
    this.renderProductsPane();
    this.renderCartPane();
  }

  getMenuCategories() {
    if (!state.menuItems) return ['all'];
    const cats = new Set();
    state.menuItems.forEach(m => {
      if (m.available !== false && m.category) cats.add(m.category);
    });
    return ['all', ...Array.from(cats)];
  }

  renderCategoryPane() {
    if (!this.els.catTabs) return;
    const cats = this.getMenuCategories();
    this.els.catTabs.innerHTML = cats.map(c => `
      <button class="menu-cat-btn ${state._orderCatFilter === c ? 'active' : ''}" data-cat="${esc(c)}" style="width:100%; text-align:left; padding:12px; margin-bottom:6px; border-radius:8px; border:none; font-weight:600; cursor:pointer;">
        ${c === 'all' ? '🍽️ Hamısı' : esc(c)}
      </button>
    `).join('');
  }

  setCategory(cat) {
    state._orderCatFilter = cat;
    this.renderCategoryPane();
    this.renderProductsPane();
  }

  renderProductsPane() {
    if (!this.els.itemsList || !state.menuItems) return;
    const items = state.menuItems.filter(m => {
      if (m.available === false) return false;
      if (state._orderCatFilter === 'all') return true;
      return m.category === state._orderCatFilter;
    });

    if (!items.length) {
      this.els.itemsList.innerHTML = '<p style="color:var(--text3); grid-column:1/-1; padding:20px;">Bu kateqoriyada məhsul tapılmadı.</p>';
      return;
    }

    this.els.itemsList.innerHTML = items.map(m => {
      const outOfStock = (m.stock !== undefined && m.stock !== null && m.stock <= 0);
      return `
        <div class="product-card" data-menu-item-id="${m.id}" style="padding:14px; background:var(--card); border:1px solid var(--border); border-radius:10px; text-align:center; cursor:pointer; ${outOfStock ? 'opacity:0.4; pointer-events:none;' : ''}">
          <div style="font-weight:700; font-size:14px; color:var(--text);">${esc(m.name)}</div>
          <div style="color:var(--green); font-weight:700; margin-top:6px; font-size:15px;">${(m.price || 0).toFixed(2)} ₼</div>
          ${outOfStock ? '<div style="font-size:11px; color:var(--red); font-weight:600; margin-top:4px;">Tükənib</div>' : ''}
        </div>
      `;
    }).join('');
  }

  addItemToDraft(menuItemId) {
    if (this.isOrderLocked()) {
      showToast('<svg class="icon"><use href="#i-ban"></use></svg> Sifariş təsdiqlənib və kilidlənib! Yeni məhsul üçün Admin icazəsi lazımdır.');
      return;
    }

    const m = state.menuItems.find(x => x.id === menuItemId);
    if (!m) return;

    const lineKey = makeLineKey(menuItemId, '', 0);

    if (state._orderDraft[lineKey]) {
      state._orderDraft[lineKey].qty += 1;
    } else {
      state._orderDraft[lineKey] = {
        lineKey,
        menuItemId,
        name: m.name,
        price: m.price || 0,
        qty: 1,
        note: '',
        discountPercent: 0,
        isGift: false,
        status: 'draft',
        updatedBy: state.user?.id || 'unknown'
      };
    }
    this.renderCartPane();
  }

  changeDraftQty(lineKey, delta) {
    const line = state._orderDraft[lineKey];
    if (!line) return;

    if (line.status === 'confirmed' && !hasPermission('order.edit')) {
      showToast('<svg class="icon"><use href="#i-ban"></use></svg> Təsdiqlənmiş məhsulun miqdarını dəyişmək üçün Admin hüququ mütləqdir!');
      return;
    }

    line.qty += delta;
    if (line.qty <= 0) {
      delete state._orderDraft[lineKey];
      delete this.selectedLines[lineKey];
    }
    this.renderCartPane();
  }

  toggleNoteInput(lineKey) {
    const container = document.getElementById(`note-box-${lineKey}`);
    if (container) {
      container.style.display = container.style.display === 'none' ? 'block' : 'none';
    }
  }

  updateLineNote(lineKey, val) {
    if (state._orderDraft[lineKey]) {
      state._orderDraft[lineKey].note = val;
    }
  }

  isOrderLocked() {
    if (!state._orderDraft) return false;
    const lines = Object.values(state._orderDraft);
    const hasConfirmed = lines.some(l => l.status === 'confirmed');
    return hasConfirmed && !hasPermission('order.edit');
  }

  renderCartPane() {
    if (!this.els.draftList) return;
    const lines = Object.entries(state._orderDraft || {});
    if (!lines.length) {
      this.els.draftList.innerHTML = '<p style="color:var(--text3); text-align:center; padding:30px;">Səbət boşdur. Məhsul əlavə edin.</p>';
      if (this.els.draftTotal) this.els.draftTotal.textContent = '0.00 ₼';
      if (this.els.btnSubmit) this.els.btnSubmit.style.display = 'block';
      if (this.els.btnPayment) this.els.btnPayment.style.display = 'none';
      this.renderBatchPanel();
      return;
    }

    let subTotal = 0;
    let totalDiscount = 0;
    let finalTotal = 0;

    const hasConfirmedItem = lines.some(([_, l]) => l.status === 'confirmed');

    this.els.draftList.innerHTML = lines.map(([lineKey, line]) => {
      let linePrice = line.price || 0;
      let originalLineTotal = linePrice * line.qty;
      
      if (line.isGift) {
        linePrice = 0;
      } else if (line.discountPercent > 0) {
        linePrice = linePrice * (1 - line.discountPercent / 100);
      }

      const currentLineTotal = linePrice * line.qty;
      subTotal += originalLineTotal;
      totalDiscount += (originalLineTotal - currentLineTotal);
      finalTotal += currentLineTotal;

      const isChecked = !!this.selectedLines[lineKey];

      return `
        <div class="cart-item-row" style="background:var(--card); border:1px solid var(--border); border-radius:8px; padding:12px; margin-bottom:8px; ${line.status === 'confirmed' ? 'border-left:4px solid var(--orange);' : ''}">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
            <input type="checkbox" data-select-line="${lineKey}" ${isChecked ? 'checked' : ''} style="width:18px; height:18px; accent-color:var(--orange);">
            
            <div style="flex:1;">
              <span style="font-size:14px; font-weight:600; display:block;">
                ${esc(line.name)} 
                ${line.status === 'confirmed' ? '<span style="font-size:10px; color:white; background:var(--orange); padding:2px 6px; border-radius:4px; margin-left:4px;">Təsdiqli</span>' : ''}
              </span>
              <span style="font-size:11px; color:var(--text3);">
                ${line.isGift ? '<span style="color:var(--green); font-weight:700;">🎁 İkram</span>' : `${line.price.toFixed(2)} ₼`}
                ${line.discountPercent > 0 ? `(-${line.discountPercent}%)` : ''}
              </span>
            </div>

            <div style="display:flex; align-items:center; gap:6px;">
              <button data-qty-change="-1" data-line-key="${lineKey}" style="width:26px; height:26px; font-weight:700; background:var(--border); border:none; border-radius:4px; cursor:pointer;">-</button>
              <span style="font-weight:700; min-width:22px; text-align:center;">${line.qty}</span>
              <button data-qty-change="1" data-line-key="${lineKey}" style="width:26px; height:26px; font-weight:700; background:var(--border); border:none; border-radius:4px; cursor:pointer;">+</button>
            </div>

            <div style="font-weight:700; min-width:60px; text-align:right; font-size:14px;">
              ${currentLineTotal.toFixed(2)} ₼
            </div>

            <button data-note-trigger="${lineKey}" style="background:none; border:none; cursor:pointer; color:var(--text2); font-size:16px;">📝</button>
          </div>

          <div id="note-box-${lineKey}" style="display:${line.note ? 'block' : 'none'}; margin-top:8px;">
            <input type="text" data-note-input data-line-key="${lineKey}" value="${esc(line.note)}" placeholder="Mətbəx üçün xüsusi qeyd..." style="width:100%; padding:6px; font-size:12px; border:1px solid var(--border); border-radius:4px; background:var(--bg); color:var(--text);">
          </div>
        </div>
      `;
    }).join('');

    const tableOrder = state.tableOrders ? state.tableOrders[state.orderTableId] : null;
    const paidAmount = tableOrder ? (tableOrder.paidAmount || 0) : 0;
    const remainingAmount = hasConfirmedItem ? (finalTotal - paidAmount) : finalTotal;

    if (this.els.draftTotal) {
      this.els.draftTotal.innerHTML = `
        <div style="font-size:13px; color:var(--text2); font-weight:normal;">Cəmi: ${subTotal.toFixed(2)} ₼ | Endirim: ${totalDiscount.toFixed(2)} ₼</div>
        <div style="font-size:20px; font-weight:800; color:var(--green); margin-top:4px;">Yekun: ${finalTotal.toFixed(2)} ₼</div>
        ${paidAmount > 0 ? `<div style="font-size:12px; color:var(--blue); font-weight:700;">Ödənilən: ${paidAmount.toFixed(2)} ₼ | Qalan: ${remainingAmount.toFixed(2)} ₼</div>` : ''}
      `;
    }

    if (hasConfirmedItem) {
      if (this.els.btnSubmit) this.els.btnSubmit.textContent = 'Yeni Sifarişləri Göndər';
      if (this.els.btnPayment) {
        this.els.btnPayment.style.display = 'block';
        this.els.btnPayment.innerHTML = `💳 Ödəniş Al (${remainingAmount.toFixed(2)} ₼)`;
      }
    } else {
      if (this.els.btnSubmit) this.els.btnSubmit.textContent = 'Sifarişi Təsdiqlə';
      if (this.els.btnPayment) this.els.btnPayment.style.display = 'none';
    }

    this.renderBatchPanel();
  }

  renderBatchPanel() {
    if (!this.els.draftList) return;
    const selectedKeys = Object.keys(this.selectedLines).filter(k => this.selectedLines[k]);
    let panel = document.getElementById('batch-actions-panel');
    
    if (!selectedKeys.length) {
      if (panel) panel.remove();
      return;
    }

    if (!panel) {
      const html = `<div id="batch-actions-panel" style="background:var(--card); border:2px solid var(--orange); padding:12px; border-radius:10px; margin-top:12px; display:grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap:8px;"></div>`;
      this.els.draftList.insertAdjacentHTML('afterend', html);
      panel = document.getElementById('batch-actions-panel');
    }

    panel.innerHTML = `
      <button id="batch-gift" style="background:var(--green); color:white; border:none; padding:8px; border-radius:6px; cursor:pointer; font-size:11px; font-weight:600;">🎁 İkram Et</button>
      <button id="batch-discount" style="background:var(--blue); color:white; border:none; padding:8px; border-radius:6px; cursor:pointer; font-size:11px; font-weight:600;">📉 Endirim Et</button>
      <button id="batch-debt" style="background:var(--purple); color:white; border:none; padding:8px; border-radius:6px; cursor:pointer; font-size:11px; font-weight:600;">📒 Nisyə Yaz</button>
      <button id="batch-move" style="background:var(--orange); color:white; border:none; padding:8px; border-radius:6px; cursor:pointer; font-size:11px; font-weight:600;">🔄 Masaya Köçür</button>
      <button id="batch-cancel" style="background:var(--red); color:white; border:none; padding:8px; border-radius:6px; cursor:pointer; font-size:11px; font-weight:600;">❌ İptal Et</button>
    `;

    document.getElementById('batch-gift').addEventListener('click', () => this.handleBatchExecution('gift'));
    document.getElementById('batch-discount').addEventListener('click', () => this.handleBatchExecution('discount'));
    document.getElementById('batch-debt').addEventListener('click', () => this.handleBatchExecution('debt'));
    document.getElementById('batch-move').addEventListener('click', () => this.handleBatchExecution('move'));
    document.getElementById('batch-cancel').addEventListener('click', () => this.handleBatchExecution('cancel'));
  }

  async handleBatchExecution(actionType) {
    const selectedKeys = Object.keys(this.selectedLines).filter(k => this.selectedLines[k]);
    if (!selectedKeys.length) return;

    const hasConfirmedSelected = selectedKeys.some(k => state._orderDraft[k] && state._orderDraft[k].status === 'confirmed');
    if (hasConfirmedSelected && !hasPermission('order.edit')) {
      showToast('<svg class="icon"><use href="#i-ban"></use></svg> Seçilmiş təsdiqli məhsullar üzərində toplu əməliyyat üçün Admin icazəniz yoxdur!');
      return;
    }

    if (actionType === 'discount') {
      const pct = prompt(`Seçilmiş məhsullar üçün endirim faizini daxil edin (1-100):`, '10');
      if (!pct || isNaN(pct) || pct <= 0 || pct > 100) return;
      selectedKeys.forEach(k => { if (state._orderDraft[k]) state._orderDraft[k].discountPercent = parseInt(pct, 10); });
    } 
    else if (actionType === 'gift') {
      selectedKeys.forEach(k => { if (state._orderDraft[k]) state._orderDraft[k].isGift = true; });
    } 
    else if (actionType === 'cancel') {
      const reason = prompt('İptal edilmə səbəbini yazın:');
      if (!reason) return;
      selectedKeys.forEach(k => { delete state._orderDraft[k]; delete this.selectedLines[k]; });
    } 
    else if (actionType === 'move') {
      const destTable = prompt('Köçürüləcək hədəf masanın adını yazın:');
      if (!destTable) return;
      selectedKeys.forEach(k => { delete state._orderDraft[k]; delete this.selectedLines[k]; });
    }
    else if (actionType === 'debt') {
      const client = prompt('Müştərinin adını qeyd edin:');
      if (!client) return;
      selectedKeys.forEach(k => { if (state._orderDraft[k]) state._orderDraft[k].note += ` [Nisyə: ${client}]`; });
    }

    this.renderCartPane();
  }

  async submitOrderToServer() {
    const tableId = state.orderTableId;
    if (!tableId) return;

    const draftLines = Object.values(state._orderDraft || {});
    if (!draftLines.length) return;

    draftLines.forEach(l => { l.status = 'confirmed'; });
    const draftSnapshot = JSON.parse(JSON.stringify(state._orderDraft));
    const waiterId = state.user?.id || 'unknown';

    R.tableOrders.child(tableId).transaction((currentData) => {
      const items = (currentData && currentData.items) ? currentData.items : {};
      Object.entries(draftSnapshot).forEach(([k, v]) => { items[k] = v; });

      let calculatedTotal = 0;
      Object.values(items).forEach(it => {
        let price = it.price || 0;
        if (it.isGift) price = 0;
        else if (it.discountPercent > 0) price = price * (1 - it.discountPercent / 100);
        calculatedTotal += price * it.qty;
      });

      const currentPaid = (currentData && currentData.paidAmount) || 0;
      return {
        items,
        total: calculatedTotal,
        waiterId: (currentData && currentData.waiterId) || waiterId,
        paidAmount: currentPaid,
        remainingAmount: calculatedTotal - currentPaid,
        updatedAt: Date.now()
      };
    }, async (error, committed, snapshot) => {
      if (error) {
        await cartOfflineStorage.savePendingAction({ type: 'SUBMIT_ORDER', tableId, data: draftSnapshot });
        showToast('⚠️ İnternet kəsildi! Sifariş lokal yaddaşa qeyd olundu.');
        return;
      }
      if (committed) {
        draftLines.forEach(l => updateStock(l.menuItemId, -l.qty, state.menuItems));
        await addLog('order', `${state.user?.name} sifarişi təsdiqlədi. Cəmi: ${snapshot.val().total.toFixed(2)} ₼`, { waiterId, tableId });
        showToast('<svg class="icon"><use href="#i-check"></use></svg> Sifariş göndərildi.');
        this.close();
      }
    });
  }

  openPaymentModal() {
    const tableId = state.orderTableId;
    const order = state.tableOrders ? state.tableOrders[tableId] : null;
    if (!order) return;

    const remaining = order.remainingAmount !== undefined ? order.remainingAmount : order.total;

    const modalHtml = `
      <div class="custom-modal-backdrop" id="payment-modal" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); display:flex; align-items:center; justify-content:center; z-index:9999;">
        <div class="custom-modal-content" style="background:var(--card); padding:24px; border-radius:12px; max-width:450px; width:95%; border:1px solid var(--border);">
          <h3 style="margin-bottom:6px;">💳 Kompleks Ödəniş Modulu</h3>
          <div style="background:var(--bg); padding:12px; border-radius:8px; margin-bottom:16px; text-align:center;">
            <div style="font-size:18px; font-weight:800; color:var(--red);">Qalan Hesab: <span>${remaining.toFixed(2)}</span> ₼</div>
          </div>
          <div style="margin-bottom:12px;">
            <label style="font-size:12px; display:block; margin-bottom:4px;">Məbləğ:</label>
            <input type="number" id="pay-amount-input" value="${remaining.toFixed(2)}" step="0.01" style="width:100%; padding:10px; background:var(--bg); color:var(--text); border:1px solid var(--border); border-radius:6px;">
          </div>
          <div style="margin-bottom:20px;">
            <label style="font-size:12px; display:block; margin-bottom:4px;">Metod:</label>
            <select id="pay-method-select" style="width:100%; padding:10px; background:var(--bg); color:var(--text); border:1px solid var(--border); border-radius:6px;">
              <option value="Nağd">💵 Nağd</option>
              <option value="Kart">💳 Bank Kartı</option>
              <option value="POS">📱 POS Terminal</option>
              <option value="Nisyə">📒 Nisyə Dəftəri</option>
            </select>
          </div>
          <div style="display:flex; gap:10px; justify-content:flex-end;">
            <button id="btn-pay-close" style="background:var(--border); padding:10px 16px; border:none; border-radius:8px;">Bağla</button>
            <button id="btn-pay-execute" style="background:var(--green); color:white; padding:10px 20px; border:none; border-radius:8px; font-weight:600;">Təsdiqlə</button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    document.getElementById('btn-pay-close').addEventListener('click', () => document.getElementById('payment-modal').remove());
    document.getElementById('btn-pay-execute').addEventListener('click', () => {
      const amt = parseFloat(document.getElementById('pay-amount-input').value);
      const method = document.getElementById('pay-method-select').value;
      if (isNaN(amt) || amt <= 0) return;
      this.executePartialPayment(tableId, amt, method);
    });
  }

  executePartialPayment(tableId, amount, method) {
    R.tableOrders.child(tableId).transaction((current) => {
      if (!current) return current;
      const currentPaid = current.paidAmount || 0;
      const newPaid = currentPaid + amount;
      const newRemaining = Math.max(0, current.total - newPaid);

      if (!current.payments) current.payments = [];
      current.payments.push({ amount, method, time: Date.now(), staffId: state.user?.id || 'system' });

      current.paidAmount = newPaid;
      current.remainingAmount = newRemaining;
      return current;
    }, async (error, committed, snapshot) => {
      if (committed && !error) {
        document.getElementById('payment-modal')?.remove();
        const val = snapshot.val();
        await addLog('payment', `${state.user?.name} ${amount.toFixed(2)} ₼ Hissəvi ödəniş aldı.`, { tableId });
        if (val.remainingAmount <= 0.01) {
          this.archiveAndCloseTable(tableId, val);
        } else {
          this.renderCartPane();
        }
      }
    });
  }

  async archiveAndCloseTable(tableId, finalOrderData) {
    const t = state.tables?.find(x => x.id === tableId);
    const archiveData = {
      tableId,
      tableName: t?.name || 'Masa',
      staffId: state.user?.id || 'unknown',
      staffName: state.user?.name || 'Sistem',
      items: finalOrderData.items,
      total: finalOrderData.total,
      payments: finalOrderData.payments,
      closedAt: Date.now()
    };

    await db.ref('closedOrders').push(archiveData);
    await R.tableOrders.child(tableId).remove();
    await R.tables.child(tableId).update({ occupant: null, activatedAt: null });
    this.close();
  }

  async openAuditLogModal() {
    const tableId = state.orderTableId;
    if (!tableId) return;

    const snap = await db.ref('systemLogs').orderByChild('meta/tableId').equalTo(tableId).limitToLast(30).once('value');
    const logsObj = snap.val() || {};
    const logsArray = Object.values(logsObj).sort((a, b) => b.timestamp - a.timestamp);

    const logRowsHtml = logsArray.map(l => `
      <div style="padding:8px 0; border-bottom:1px dashed var(--border); font-size:13px;">
        <span style="color:var(--orange);">[${new Date(l.timestamp).toLocaleTimeString('az-AZ')}]</span> ${esc(l.message)}
      </div>
    `).join('');

    const modalHtml = `
      <div class="custom-modal-backdrop" id="audit-modal" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:99999;">
        <div class="custom-modal-content" style="background:var(--card); padding:24px; border-radius:12px; max-width:450px; width:90%; border:1px solid var(--border);">
          <h3>🕒 Masa Tarixçəsi</h3>
          <div style="max-height:40vh; overflow-y:auto; margin:15px 0;">${logRowsHtml || 'Qeyd tapılmadı.'}</div>
          <button id="btn-audit-close" style="background:var(--orange); color:white; padding:8px 16px; border:none; border-radius:6px;">Bağla</button>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    document.getElementById('btn-audit-close').addEventListener('click', () => document.getElementById('audit-modal').remove());
  }
}
