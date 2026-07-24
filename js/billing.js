/* ═══════════════════════════════════════════
   BILLING
   Göndərilmiş sifarişin idarəsi: miqdar dəyişmə, iptal (səbəblə),
   endirim (seçilmişlərə və ya bütün hesaba), ikram, mal/masa köçürmə,
   və ödəniş (nağd/POS/bölünmüş/nisyə).
═══════════════════════════════════════════ */
import { R } from './firebase-service.js';
import { state } from './state.js';
import { esc, showToast, addLog, makeLineKey, updateStock, formatItemsList, computeOrderTotals } from './utils.js';
import { hasPermission } from './permissions.js';

/* ───────────────────────── CONFIRMED ORDER ───────────────────────── */

export class ConfirmedOrder {
  /**
   * @param {Object} els - { summaryEl, cancelReasonModal, cancelReasonItemName, cancelReasonSelect,
   *                          discountModal, discountTableInfo, discountValue, discountPreview, discPctBtn, discFixBtn, discountValueLabel,
   *                          complimentModal, complimentPickWrap, complimentItem, complimentBatchInfo,
   *                          itemTransferModal, itemTransferInfo, itemTransferPickWrap, itemTransferItem,
   *                          itemTransferBatchInfo, itemTransferQtyWrap, itemTransferQty, itemTransferToTable }
   */
  constructor(els) {
    this.els = els;
    this._cancelCtx = null;
    this._discountType = 'percent';
    this._discountSelection = {};
    this._sentExpanded = false;
    this._bindEvents();
  }

  _bindEvents() {
    this.els.summaryEl.addEventListener('click', (e) => {
      const qtyBtn = e.target.closest('[data-qty-change]');
      if (qtyBtn) { return; } // göndərilmiş mallarda artıq +/- düyməsi yoxdur (yalnız iptal, səbəblə)
      const cancelBtn = e.target.closest('[data-cancel-item]');
      if (cancelBtn) { this.openCancelReasonModal(state.noteTableId, cancelBtn.dataset.cancelItem); return; }
      const batchBtn = e.target.closest('[data-batch-qty]');
      if (batchBtn) { this.setBatchQty(batchBtn.dataset.itemKey, parseInt(batchBtn.dataset.batchQty, 10)); return; }
      if (e.target.closest('#sentCollapseBar')) { this._sentExpanded = false; this.renderSummary(state.noteTableId); return; }
    });
    this.els.itemTransferTableGrid.addEventListener('click', (e) => {
      const card = e.target.closest('[data-transfer-target]');
      if (card) this.selectTransferTarget(card.dataset.transferTarget);
    });
  }

  clearBatchSelection() { state._batchSelection = {}; this._sentExpanded = false; }

  /** Seçilmiş malın miqdarını dəyişir (0..qty aralığında) - qismən seçimə imkan verir */
  setBatchQty(itemKey, delta) {
    const order = state.tableOrders[state.noteTableId];
    const it = order?.items?.[itemKey];
    if (!it) return;
    if (!state._batchSelection) state._batchSelection = {};
    const cur = state._batchSelection[itemKey] || 0;
    const next = Math.max(0, Math.min(it.qty, cur + delta));
    if (next === 0) delete state._batchSelection[itemKey];
    else state._batchSelection[itemKey] = next;
    this.renderSummary(state.noteTableId);
  }

  /**
   * Firebase transaction daxilində istifadə üçün: qismən seçilmiş sətirləri iki yerə bölür
   * (seçilmiş miqdar + qalan miqdar), tam seçilmiş sətirlərə toxunmur.
   * Qaytarır: items (yenilənmiş obyekt) və targetKeys (təsir olunacaq açarların siyahısı)
   */
  _splitSelectedItems(items, selectionMap) {
    const newItems = { ...items };
    const targetKeys = [];
    Object.entries(selectionMap).forEach(([itemKey, selQty]) => {
      const orig = items[itemKey];
      if (!orig || selQty <= 0) return;
      const qty = Math.min(selQty, orig.qty);
      if (qty >= orig.qty) {
        targetKeys.push(itemKey);
      } else {
        const splitKey = `${itemKey}_x${Date.now()}`;
        newItems[splitKey] = { ...orig, qty };
        newItems[itemKey] = { ...orig, qty: orig.qty - qty };
        targetKeys.push(splitKey);
      }
    });
    return { items: newItems, targetKeys };
  }

  renderSummary(tableId) {
    const el = this.els.summaryEl;
    const order = state.tableOrders[tableId];
    const items = order?.items ? Object.entries(order.items) : [];
    if (!items.length) { el.innerHTML = ''; return; }

    const hasDraft = Object.keys(state._orderDraft || {}).length > 0;
    if (hasDraft && !this._sentExpanded) {
      const totalQty = items.reduce((s,[,it])=>s+it.qty,0);
      el.innerHTML = `<button id="sentCollapsedBar" style="width:100%;display:flex;justify-content:space-between;align-items:center;
        background:var(--overlay-soft);border:1px solid var(--border);border-radius:8px;padding:9px 12px;cursor:pointer;margin-bottom:4px;">
        <span style="font-size:12px;color:var(--text2);display:flex;align-items:center;gap:6px;">
          <svg class="icon"><use href="#i-check"></use></svg> ${totalQty} mal mətbəxdə — göstər
        </span>
        <span style="font-size:12.5px;font-weight:700;">${(order.total||0).toFixed(2)} ₼</span>
      </button>`;
      el.querySelector('#sentCollapsedBar')?.addEventListener('click', () => { this._sentExpanded = true; this.renderSummary(tableId); });
      return;
    }

    const canEdit = hasPermission('order.cancel_item');
    const canBatch = hasPermission('order.discount') || hasPermission('table.transfer');
    const sel = state._batchSelection || {};
    const selectedEntries = Object.entries(sel).filter(([k,v]) => v > 0 && order.items[k]);
    const selectedCount = selectedEntries.length;

    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.04em;">
          <svg class="icon" style="width:.9em;height:.9em;"><use href="#i-check"></use></svg> Mətbəxə göndərilib
        </div>
        ${hasDraft ? `<button id="sentCollapseBar" style="background:none;border:none;color:var(--text3);font-size:11px;cursor:pointer;">Gizlət</button>` : ''}
      </div>
      ${items.map(([itemKey, it]) => {
        const lineTotal = (it.price * it.qty * (1-((it.discountPercent||0)/100))) + (it.extraFee||0);
        const selQty = sel[itemKey] || 0;
        const isSelected = selQty > 0;
        return `<div class="ticket-line sent ${isSelected?'selected':''}">
          <div class="ticket-line__main">
            ${canBatch ? `<div class="qty-stepper batch-select" style="margin-right:2px;">
              <button data-batch-qty="-1" data-item-key="${itemKey}">−</button>
              <span class="qty-stepper__val">${selQty}</span>
              <button data-batch-qty="1" data-item-key="${itemKey}">+</button>
            </div>` : ''}
            <span class="ticket-line__name">${esc(it.name)}${it.qty>1?` <span style="color:var(--text3);font-weight:400;">×${it.qty}</span>`:''}</span>
            <span class="ticket-line__price">${lineTotal.toFixed(2)} ₼</span>
            ${canEdit ? `<button data-cancel-item="${itemKey}" style="background:none;border:none;color:var(--text3);cursor:pointer;padding:2px;flex-shrink:0;"><svg class="icon"><use href="#i-close"></use></svg></button>` : ''}
          </div>
          <div class="ticket-line__tags" style="${canBatch?'padding-left:56px;':''}">
            ${it.note ? `<span class="discount-badge" style="background:transparent;border-color:var(--border);color:var(--text3);"><svg class="icon"><use href="#i-note"></use></svg> ${esc(it.note)}</span>` : ''}
            ${it.compliment ? `<span class="discount-badge" style="background:rgba(28,107,53,.15);color:var(--green);border-color:var(--green);">İKRAM</span>` : ''}
            ${(it.discountPercent>0) ? `<span class="discount-badge">-${it.discountPercent}%</span>` : ''}
            ${isSelected ? `<span class="discount-badge" style="background:rgba(52,152,219,.15);color:var(--blue);border-color:var(--blue);">${selQty}/${it.qty} seçili</span>` : ''}
          </div>
        </div>`;
      }).join('')}
      ${canBatch ? `
      <div id="batchActionBar" class="batch-bar" style="display:${selectedCount?'flex':'none'};">
        <span class="batch-bar__count">${selectedCount} mal seçildi (${selectedEntries.reduce((s,[,q])=>s+q,0)} ədəd)</span>
        ${hasPermission('order.discount') ? `<button class="batch-chip batch-chip--discount" data-open-discount><svg class="icon"><use href="#i-tag"></use></svg> Endirim</button>` : ''}
        ${hasPermission('order.discount') ? `<button class="batch-chip batch-chip--gift" data-open-compliment><svg class="icon"><use href="#i-gift"></use></svg> İkram</button>` : ''}
        ${hasPermission('table.transfer') ? `<button class="batch-chip batch-chip--transfer" data-open-item-transfer><svg class="icon"><use href="#i-shuffle"></use></svg> Köçür</button>` : ''}
        ${hasPermission('bill.credit') ? `<button class="batch-chip" style="border-color:var(--blue);color:var(--blue);" data-open-customer-charge><svg class="icon"><use href="#i-user"></use></svg> Nisyə</button>` : ''}
        ${hasPermission('order.discount') && selectedEntries.some(([k])=>order.items[k]?.discountPercent>0||order.items[k]?.compliment)
          ? `<button class="batch-chip" style="border-color:var(--red);color:var(--red);" data-reset-discount><svg class="icon"><use href="#i-refresh"></use></svg> Sıfırla</button>` : ''}
        <button class="batch-chip batch-chip--clear" data-clear-selection>Ləğv et</button>
      </div>` : ''}
    `;

    // batch bar düymələri (dinamik yaradıldığı üçün burada bağlanır)
    el.querySelector('[data-open-discount]')?.addEventListener('click', () => this.openDiscountModal());
    el.querySelector('[data-open-compliment]')?.addEventListener('click', () => this.openComplimentModal());
    el.querySelector('[data-open-item-transfer]')?.addEventListener('click', () => this.openItemTransferModal());
    el.querySelector('[data-open-customer-charge]')?.addEventListener('click', () => this.openCustomerChargeModal());
    el.querySelector('[data-reset-discount]')?.addEventListener('click', () => this.resetDiscount(state.noteTableId));
    el.querySelector('[data-clear-selection]')?.addEventListener('click', () => { this.clearBatchSelection(); this.renderSummary(tableId); });
  }

  // ── İptal (səbəblə) ──
  openCancelReasonModal(tableId, itemKey) {
    if (!hasPermission('order.cancel_item')) return;
    const order = state.tableOrders[tableId];
    const it = order?.items?.[itemKey];
    if (!it) return;
    this._cancelCtx = { tableId, itemKey };
    this.els.cancelReasonItemName.textContent = `${it.name} (${it.qty} ədəd)`;
    this.els.cancelReasonSelect.value = 'Səhv sifariş';
    const qtyGroup = document.getElementById('cancelReasonQtyGroup');
    const qtyInput = document.getElementById('cancelReasonQty');
    if (it.qty > 1) {
      qtyGroup.style.display = 'block';
      qtyInput.max = it.qty;
      qtyInput.value = it.qty;
    } else {
      qtyGroup.style.display = 'none';
      qtyInput.value = 1;
    }
    this.els.cancelReasonModal.classList.add('open');
  }

  closeCancelReasonModal() {
    this.els.cancelReasonModal.classList.remove('open');
    this._cancelCtx = null;
  }

  confirmCancelWithReason() {
    if (!this._cancelCtx) return;
    const { tableId, itemKey } = this._cancelCtx;
    const reason = this.els.cancelReasonSelect.value;
    const order = state.tableOrders[tableId];
    const it = order?.items?.[itemKey];
    const maxQty = it?.qty || 1;
    let cancelQty = parseInt(document.getElementById('cancelReasonQty').value, 10) || maxQty;
    cancelQty = Math.min(Math.max(cancelQty, 1), maxQty);
    this.closeCancelReasonModal();
    this.cancelItem(tableId, itemKey, reason, cancelQty);
  }

  cancelItem(tableId, itemKey, reason, cancelQty) {
    if (!hasPermission('order.cancel_item')) return;
    const order = state.tableOrders[tableId];
    if (!order?.items) return;
    const it = order.items[itemKey];
    if (!it) return;
    const fullQty = it.qty;
    const qtyToCancel = Math.min(Math.max(cancelQty || fullQty, 1), fullQty);
    const isPartial = qtyToCancel < fullQty;
    const cancelledName = it.name, cancelledMenuItemId = it.menuItemId;
    const reasonText = reason || 'Qeyd olunmayıb';

    R.tableOrders.child(tableId).transaction(current => {
      if (!current || !current.items || !current.items[itemKey]) return current;
      const items = { ...current.items };
      if (isPartial) {
        // Yalnız QİSMƏN ləğv olunur - sətir qalır, miqdarı azalır
        items[itemKey] = { ...items[itemKey], qty: items[itemKey].qty - qtyToCancel };
      } else {
        delete items[itemKey];
      }
      if (!Object.keys(items).length) return null;
      const _tot = computeOrderTotals(items);

      const total = _tot.total, serviceChargeAmount = _tot.serviceChargeAmount, serviceChargePercent = _tot.serviceChargePercent;
      const paidAmount = current.paidAmount || 0;
      return { ...current, items, total, serviceChargeAmount, serviceChargePercent, remainingAmount: total - paidAmount };
    }, (error, committed) => {
      if (error) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Xəta baş verdi, yenidən cəhd edin'); return; }
      if (!committed) return;
      updateStock(cancelledMenuItemId, qtyToCancel, state.menuItems);
      const t = state.tables.find(x => x.id === tableId);
      const qtyLabel = isPartial ? `${qtyToCancel} ədəd` : `bütün (${fullQty} ədəd)`;
      addLog('order', `${state.user?.name} "${cancelledName}" malından ${qtyLabel} sifarişdən iptal etdi — Səbəb: ${reasonText}`, { tableId, menuItemId: cancelledMenuItemId, reason: reasonText });
      showToast(`<svg class="icon"><use href="#i-trash"></use></svg> ${cancelledName} (${qtyToCancel} ədəd) sifarişdən silindi`);
      this.renderSummary(tableId);
    });
  }

  // ── Endirim (seçilmişlərə və ya bütün hesaba) ──
  openDiscountModal() {
    if (!hasPermission('order.discount')) { showToast('<svg class="icon"><use href="#i-ban"></use></svg> Endirim icazəniz yoxdur'); return; }
    const tableId = state.noteTableId;
    if (!tableId) return;
    const order = state.tableOrders[tableId];
    if (!order?.total) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Sifariş yoxdur'); return; }
    const remainingCheck = (order.remainingAmount !== undefined && order.remainingAmount !== null) ? order.remainingAmount : order.total;
    if (remainingCheck <= 0.01) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Bu hesab artıq tam ödənilib, endirim edilə bilməz'); return; }
    this._discountTableId = tableId;
    this._discountType = 'percent';
    const t = state.tables.find(x => x.id === tableId);

    const sel0 = state._batchSelection || {};
    this._discountSelection = {};
    Object.entries(sel0).forEach(([k, q]) => { if (q > 0 && order.items[k]) this._discountSelection[k] = q; });
    const selKeys = Object.keys(this._discountSelection);

    if (selKeys.length) {
      const totalQty = Object.values(this._discountSelection).reduce((s,q)=>s+q,0);
      const subtotal = selKeys.reduce((s,k)=>{ const it=order.items[k]; const q=this._discountSelection[k]; return s+(it.price*q)+(it.extraFee||0)*(q/it.qty); },0);
      this.els.discountTableInfo.innerHTML = `${esc(t?.name||'Masa')} — <strong>${totalQty} ədəd seçilib</strong>, Cəmi: ${subtotal.toFixed(2)} ₼`;
    } else {
      this.els.discountTableInfo.textContent = `${t?.name||'Masa'} — Bütün hesab, Cəmi: ${order.total.toFixed(2)} ₼`;
    }
    this.els.discountValue.value = '';
    this.els.discountPreview.innerHTML = '';
    this.setDiscountType('percent');
    this.els.discountModal.classList.add('open');
  }

  closeDiscountModal() { this.els.discountModal.classList.remove('open'); }

  setDiscountType(type) {
    this._discountType = type;
    this.els.discPctBtn.style.cssText = type==='percent'
      ? 'flex:1;padding:12px;border:2px solid var(--orange);color:var(--orange);background:rgba(196,176,46,.15);font-weight:700;border-radius:9px;cursor:pointer;'
      : 'flex:1;padding:12px;border:1px solid var(--border);color:var(--text2);background:transparent;font-weight:600;border-radius:9px;cursor:pointer;';
    this.els.discFixBtn.style.cssText = type==='fixed'
      ? 'flex:1;padding:12px;border:2px solid var(--orange);color:var(--orange);background:rgba(196,176,46,.15);font-weight:700;border-radius:9px;cursor:pointer;'
      : 'flex:1;padding:12px;border:1px solid var(--border);color:var(--text2);background:transparent;font-weight:600;border-radius:9px;cursor:pointer;';
    this.els.discountValueLabel.textContent = type==='percent' ? 'Faiz (0-100)' : 'Məbləğ (₼)';
    this.previewDiscount();
  }

  previewDiscount() {
    const val = parseFloat(this.els.discountValue.value) || 0;
    const order = state.tableOrders[this._discountTableId];
    if (!order || !val) { this.els.discountPreview.innerHTML = ''; return; }
    const selKeys = Object.keys(this._discountSelection);
    const orig = selKeys.length
      ? selKeys.reduce((s,k)=>{ const it=order.items[k]; const q=this._discountSelection[k]; return it ? s+(it.price*q)+(it.extraFee||0)*(q/it.qty) : s; },0)
      : order.total;
    const final = this._discountType==='percent' ? orig*(1-val/100) : Math.max(0,orig-val);
    this.els.discountPreview.innerHTML = `
      <div style="display:flex;justify-content:space-between;font-size:14px;">
        <span style="color:var(--text2);">Əvvəlki məbləğ:</span>
        <span style="text-decoration:line-through;color:var(--text3);">${orig.toFixed(2)} ₼</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:16px;font-weight:700;color:var(--green);margin-top:4px;">
        <span>Endirimli məbləğ:</span><span>${final.toFixed(2)} ₼</span>
      </div>`;
  }

  applyDiscount() {
    const val = parseFloat(this.els.discountValue.value) || 0;
    if (!val) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Endirim dəyəri daxil edin'); return; }
    const tableId = this._discountTableId;
    const order = state.tableOrders[tableId];
    const t = state.tables.find(x => x.id === tableId);
    if (!order || !order.items) return;

    // Seçim yoxdursa - BÜTÜN mallar seçilmiş kimi qəbul olunur, eyni etibarlı (Firebase transaction)
    // yolla tətbiq edilir ki, endirim REAL olaraq hesabı azaltsın, sadəcə ödəniş pəncərəsində görünməsin.
    const selKeys0 = Object.keys(this._discountSelection);
    const isWholeTable = !selKeys0.length;
    const selection = isWholeTable
      ? Object.fromEntries(Object.entries(order.items).map(([k, it]) => [k, it.qty]))
      : this._discountSelection;
    const selKeys = Object.keys(selection);
    if (!selKeys.length) return;

    const subtotal = selKeys.reduce((s,k)=>{ const it=order.items[k]; const q=selection[k]; return it ? s+(it.price*q)+(it.extraFee||0)*(q/it.qty) : s; },0);
    if (this._discountType==='percent' && val>100) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Faiz 100-dən çox ola bilməz'); return; }
    if (this._discountType==='fixed' && val>=subtotal) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Endirim məbləğdən çox ola bilməz'); return; }
    const equivPercent = this._discountType==='percent' ? val : (val/subtotal*100);
    let appliedQty = 0;
    let appliedItemsList = [];

    R.tableOrders.child(tableId).transaction(current => {
      if (!current || !current.items) return current;
      const { items, targetKeys } = this._splitSelectedItems(current.items, selection);
      targetKeys.forEach(k => { if (items[k]) items[k] = { ...items[k], discountPercent: Math.round(equivPercent*100)/100 }; });
      const _tot = computeOrderTotals(items);

      const total = _tot.total, serviceChargeAmount = _tot.serviceChargeAmount, serviceChargePercent = _tot.serviceChargePercent;
      const paidAmount = current.paidAmount || 0;
      appliedQty = targetKeys.reduce((s,k)=>s+(items[k]?.qty||0),0);
      appliedItemsList = targetKeys.filter(k=>items[k]).map(k => ({ name: items[k].name, qty: items[k].qty }));
      return { ...current, items, total, serviceChargeAmount, serviceChargePercent, remainingAmount: total - paidAmount };
    }, (error, committed) => {
      if (error) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Xəta baş verdi, yenidən cəhd edin'); return; }
      if (!committed) return;
      const discStr = this._discountType==='percent' ? `${val}%` : `${val.toFixed(2)} ₼`;
      addLog('order', isWholeTable
        ? `${state.user.name} "${t?.name}" masasına ${discStr} endirim verdi (bütün hesab)`
        : `${state.user.name} "${t?.name}" masasında ${formatItemsList(appliedItemsList)} mallarına ${discStr} endirim verdi`, { tableId });
      showToast(`<svg class="icon"><use href="#i-check"></use></svg> Endirim tətbiq edildi: ${discStr}`);
      this.clearBatchSelection();
      this.renderSummary(tableId);
    });
    this.closeDiscountModal();
  }

  // ── Nisyəyə köçürmə (seçilmiş mallar və ya bütün masa) ──
  openCustomerChargeModal() {
    if (!hasPermission('bill.credit')) { showToast('<svg class="icon"><use href="#i-ban"></use></svg> Nisyə icazəniz yoxdur'); return; }
    const tableId = state.noteTableId;
    if (!tableId) return;
    const order = state.tableOrders[tableId];
    if (!order?.items || !order.total) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Sifariş yoxdur'); return; }
    if (!state.customers || !state.customers.length) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Əvvəlcə admin paneldə müştəri qeydə alın'); return; }

    const t = state.tables.find(x => x.id === tableId);
    const sel0 = state._batchSelection || {};
    const selection = {};
    Object.entries(sel0).forEach(([k, q]) => { if (q > 0 && order.items[k]) selection[k] = q; });
    this._chargeSelection = selection;
    const selKeys = Object.keys(selection);

    if (selKeys.length) {
      const subtotal = selKeys.reduce((s,k)=>{ const it=order.items[k]; const q=selection[k]; return s+(it.price*q)+(it.extraFee||0)*(q/it.qty); },0);
      document.getElementById('customerChargeInfo').textContent = `${t?.name||'Masa'} — ${formatItemsList(selKeys.map(k=>({name:order.items[k]?.name, qty:selection[k]})))}`;
      document.getElementById('customerChargeAmount').textContent = subtotal.toFixed(2) + ' ₼';
    } else {
      const remaining = (order.remainingAmount !== undefined && order.remainingAmount !== null) ? order.remainingAmount : order.total;
      if (remaining <= 0.01) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Bu hesabda qalıq yoxdur'); return; }
      document.getElementById('customerChargeInfo').textContent = `${t?.name||'Masa'} — bütün hesab (${formatItemsList(order.items)})`;
      document.getElementById('customerChargeAmount').textContent = remaining.toFixed(2) + ' ₼';
    }

    document.getElementById('customerChargeSelect').innerHTML = state.customers.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    this._showChargeStage(1);
    document.getElementById('customerChargeModal').classList.add('open');
  }

  _showChargeStage(n) {
    document.getElementById('customerChargeStage1').style.display = n===1 ? 'block' : 'none';
    document.getElementById('customerChargeStage2').style.display = n===2 ? 'block' : 'none';
  }

  pickChargeCustomer() {
    const tableId = state.noteTableId;
    const t = state.tables.find(x => x.id === tableId);
    const order = state.tableOrders[tableId];
    const customerId = document.getElementById('customerChargeSelect').value;
    const customer = state.customers.find(c => c.id === customerId);
    if (!customer) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Müştəri seçin'); return; }

    const selection = this._chargeSelection || {};
    const selKeys = Object.keys(selection).filter(k => order?.items?.[k]);
    const itemsStr = selKeys.length
      ? formatItemsList(selKeys.map(k=>({name:order.items[k]?.name, qty:selection[k]})))
      : formatItemsList(order?.items || {});
    const amount = document.getElementById('customerChargeAmount').textContent;

    document.getElementById('customerChargeConfirmText').innerHTML =
      `<strong>${esc(itemsStr)}</strong> (${amount})<br>"${esc(t?.name||'')}" masasından<br><strong>${esc(customer.name)}</strong> adlı müştəriyə nisyə yazılır.<br>Təsdiqləyirsiniz?`;
    this._showChargeStage(2);
  }

  closeCustomerChargeModal() {
    document.getElementById('customerChargeModal').classList.remove('open');
    this._showChargeStage(1);
  }

  confirmCustomerCharge() {
    const tableId = state.noteTableId;
    const order = state.tableOrders[tableId];
    if (!order) return;
    const t = state.tables.find(x => x.id === tableId);
    const customerId = document.getElementById('customerChargeSelect').value;
    const customer = state.customers.find(c => c.id === customerId);
    if (!customer) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Müştəri seçin'); return; }

    const selection = this._chargeSelection || {};
    const selKeys = Object.keys(selection).filter(k => order.items?.[k]);

    if (selKeys.length) {
      let chargedAmount = 0;
      let chargedItems = [];
      R.tableOrders.child(tableId).transaction(current => {
        if (!current || !current.items) return current;
        const { items, targetKeys } = this._splitSelectedItems(current.items, selection);
        chargedAmount = targetKeys.reduce((s,k)=>{ const it=items[k]; return it ? s+(it.price*it.qty*(1-((it.discountPercent||0)/100)))+(it.extraFee||0) : s; },0);
        chargedItems = targetKeys.filter(k=>items[k]).map(k => ({ name: items[k].name, qty: items[k].qty, price: items[k].price }));
        targetKeys.forEach(k => delete items[k]);
        if (!Object.keys(items).length) return null;
        const _tot = computeOrderTotals(items);

        const total = _tot.total, serviceChargeAmount = _tot.serviceChargeAmount, serviceChargePercent = _tot.serviceChargePercent;
        const paidAmount = current.paidAmount || 0;
        return { ...current, items, total, remainingAmount: Math.max(0, total - paidAmount) };
      }, (error, committed) => {
        if (error) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Xəta baş verdi, yenidən cəhd edin'); return; }
        if (!committed) return;
        R.customers.child(customerId).child('balance').transaction(bal => (bal||0) + chargedAmount);
        R.customerCharges.push({
          customerId, customerName: customer.name, tableId, tableName: t?.name||'?',
          items: chargedItems, amount: chargedAmount,
          staffId: state.user.id, staffName: state.user.name,
          createdAt: Date.now(), time: new Date().toLocaleTimeString('az-AZ'), date: new Date().toLocaleDateString('az-AZ')
        });
        addLog('order', `${state.user.name} "${t?.name}" masasından ${formatItemsList(chargedItems)} (${chargedAmount.toFixed(2)} ₼) "${customer.name}" adına nisyə yazdı`, { tableId, customerId });
        showToast(`<svg class="icon"><use href="#i-check"></use></svg> ${chargedAmount.toFixed(2)} ₼ "${customer.name}" adına yazıldı`);
        this.clearBatchSelection();
        this.renderSummary(tableId);
      });
      this.closeCustomerChargeModal();
      return;
    }

    const remaining = (order.remainingAmount !== undefined && order.remainingAmount !== null) ? order.remainingAmount : order.total;
    if (remaining <= 0.01) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Bu hesabda qalıq yoxdur'); this.closeCustomerChargeModal(); return; }
    const wholeTableItems = Object.values(order.items||{}).map(it => ({ name: it.name, qty: it.qty, price: it.price }));

    R.tableOrders.child(tableId).transaction(current => {
      if (!current) return current;
      const paidAmount = (current.paidAmount||0) + remaining;
      return { ...current, paidAmount, remainingAmount: 0 };
    }, (error, committed) => {
      if (error) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Xəta baş verdi, yenidən cəhd edin'); return; }
      if (!committed) return;
      R.customers.child(customerId).child('balance').transaction(bal => (bal||0) + remaining);
      R.customerCharges.push({
        customerId, customerName: customer.name, tableId, tableName: t?.name||'?',
        items: wholeTableItems, amount: remaining,
        staffId: state.user.id, staffName: state.user.name,
        createdAt: Date.now(), time: new Date().toLocaleTimeString('az-AZ'), date: new Date().toLocaleDateString('az-AZ')
      });
      addLog('order', `${state.user.name} "${t?.name}" masasının hesabı: ${formatItemsList(wholeTableItems)} (${remaining.toFixed(2)} ₼) "${customer.name}" adına nisyə yazdı`, { tableId, customerId });
      showToast(`<svg class="icon"><use href="#i-check"></use></svg> ${remaining.toFixed(2)} ₼ "${customer.name}" adına yazıldı`);
      this.renderSummary(tableId);
    });
    this.closeCustomerChargeModal();
  }

  // ── İkram (seçilmişlərə və ya tək mala) ──
  openComplimentModal() {
    if (!hasPermission('order.discount')) { showToast('<svg class="icon"><use href="#i-ban"></use></svg> İkram icazəniz yoxdur'); return; }
    const tableId = state.noteTableId;
    if (!tableId) return;
    const order = state.tableOrders[tableId];
    if (!order?.items) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Sifariş yoxdur'); return; }

    const sel0 = state._batchSelection || {};
    const selection = {};
    Object.entries(sel0).forEach(([k, q]) => { if (q > 0 && order.items[k]) selection[k] = q; });
    if (!Object.keys(selection).length) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Əvvəlcə ikram ediləcək malları işarələyin'); return; }
    this._complimentSelection = selection;

    this.els.complimentBatchInfo.textContent = formatItemsList(Object.keys(selection).map(k=>({name:order.items[k]?.name, qty:selection[k]})));
    this.els.complimentModal.classList.add('open');
  }

  closeComplimentModal() { this.els.complimentModal.classList.remove('open'); }

  confirmCompliment() {
    const tableId = state.noteTableId;
    const order = state.tableOrders[tableId];
    if (!order?.items) return;
    const t = state.tables.find(x => x.id === tableId);

    const selection = this._complimentSelection || {};
    if (!Object.keys(selection).length) { this.closeComplimentModal(); return; }
    let appliedItemsList = [];

    R.tableOrders.child(tableId).transaction(current => {
      if (!current || !current.items) return current;
      const { items, targetKeys } = this._splitSelectedItems(current.items, selection);
      targetKeys.forEach(k => { if (items[k]) items[k] = { ...items[k], originalPrice: items[k].originalPrice ?? items[k].price, originalExtraFee: items[k].originalExtraFee ?? (items[k].extraFee||0), price: 0, extraFee: 0, compliment: true }; });
      const _tot = computeOrderTotals(items);

      const total = _tot.total, serviceChargeAmount = _tot.serviceChargeAmount, serviceChargePercent = _tot.serviceChargePercent;
      const paidAmount = current.paidAmount || 0;
      appliedItemsList = targetKeys.filter(k=>items[k]).map(k => ({ name: items[k].name, qty: items[k].qty }));
      return { ...current, items, total, serviceChargeAmount, serviceChargePercent, remainingAmount: total - paidAmount };
    }, (error, committed) => {
      if (error) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Xəta baş verdi, yenidən cəhd edin'); return; }
      if (!committed) return;
      addLog('order', `${state.user?.name} "${t?.name}" masasında ${formatItemsList(appliedItemsList)} ikram etdi`, { tableId });
      showToast(`<svg class="icon"><use href="#i-gift"></use></svg> ${formatItemsList(appliedItemsList)} ikram edildi`);
      this.clearBatchSelection();
      this.renderSummary(tableId);
    });
    this.closeComplimentModal();
  }

  // ── Endirim/İkramı geri qaytarma (səhvən tətbiq olunubsa) ──
  resetDiscount(tableId) {
    if (!hasPermission('order.discount')) { showToast('<svg class="icon"><use href="#i-ban"></use></svg> İcazəniz yoxdur'); return; }
    const order = state.tableOrders[tableId];
    if (!order?.items) return;
    const t = state.tables.find(x => x.id === tableId);
    const sel = state._batchSelection || {};
    const selection = {};
    Object.entries(sel).forEach(([k, q]) => { if (q > 0 && order.items[k]) selection[k] = q; });
    if (!Object.keys(selection).length) return;

    let resetItemsList = [];
    R.tableOrders.child(tableId).transaction(current => {
      if (!current || !current.items) return current;
      const { items, targetKeys } = this._splitSelectedItems(current.items, selection);
      targetKeys.forEach(k => {
        if (!items[k]) return;
        const it = items[k];
        items[k] = {
          ...it,
          discountPercent: 0,
          compliment: false,
          price: it.compliment ? (it.originalPrice ?? it.price) : it.price,
          extraFee: it.compliment ? (it.originalExtraFee ?? it.extraFee) : it.extraFee,
          originalPrice: null, originalExtraFee: null
        };
      });
      const _tot = computeOrderTotals(items);

      const total = _tot.total, serviceChargeAmount = _tot.serviceChargeAmount, serviceChargePercent = _tot.serviceChargePercent;
      const paidAmount = current.paidAmount || 0;
      resetItemsList = targetKeys.filter(k=>items[k]).map(k => ({ name: items[k].name, qty: items[k].qty }));
      return { ...current, items, total, serviceChargeAmount, serviceChargePercent, remainingAmount: total - paidAmount };
    }, (error, committed) => {
      if (error) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Xəta baş verdi, yenidən cəhd edin'); return; }
      if (!committed) return;
      addLog('order', `${state.user?.name} "${t?.name}" masasında ${formatItemsList(resetItemsList)} endirim/ikramını sıfırladı`, { tableId });
      showToast(`<svg class="icon"><use href="#i-check"></use></svg> Endirim/ikram sıfırlandı`);
      this.clearBatchSelection();
      this.renderSummary(tableId);
    });
  }

  // ── Mal köçürmə (seçilmişlərə və ya tək mala, 2 masa arasında) ──
  openItemTransferModal() {
    if (!hasPermission('table.transfer')) { showToast('<svg class="icon"><use href="#i-ban"></use></svg> İcazəniz yoxdur'); return; }
    const tableId = state.noteTableId;
    if (!tableId) return;
    const order = state.tableOrders[tableId];
    if (!order?.items) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Bu masada sifariş yoxdur'); return; }

    const sel0 = state._batchSelection || {};
    const selection = {};
    Object.entries(sel0).forEach(([k, q]) => { if (q > 0 && order.items[k]) selection[k] = q; });
    if (!Object.keys(selection).length) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Əvvəlcə köçürüləcək malları işarələyin'); return; }
    this._transferSelection = selection;
    this._transferTarget = null;

    const t = state.tables.find(x => x.id === tableId);
    this.els.itemTransferInfo.textContent = `"${t?.name}" masasından köçürülür:`;
    const itemsStr = formatItemsList(Object.keys(selection).map(k => ({ name: order.items[k]?.name, qty: selection[k] })));
    this.els.itemTransferBatchInfo.textContent = itemsStr;

    this._showTransferStage(1);
    this.els.itemTransferModal.classList.add('open');
  }

  _showTransferStage(n) {
    this.els.itemTransferStage1.style.display = n===1 ? 'block' : 'none';
    this.els.itemTransferStage2.style.display = n===2 ? 'block' : 'none';
    this.els.itemTransferStage3.style.display = n===3 ? 'block' : 'none';
  }

  openTransferTableGrid() {
    const tableId = state.noteTableId;
    const otherTables = state.tables.filter(x => x.id !== tableId);
    if (!otherTables.length) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Başqa masa yoxdur'); return; }
    this.els.itemTransferTableGrid.innerHTML = otherTables.map(m => {
      const isEmpty = !m.occupant;
      const occupantName = isEmpty ? '' : (state.staff.find(s=>s.id===m.occupant)?.name || '?');
      return `<div class="floor-card ${isEmpty?'empty':'other-manage'}" style="cursor:pointer;min-height:64px;" data-transfer-target="${m.id}">
        <div class="floor-card__name">${esc(m.name)}</div>
        <div class="floor-card__status">${isEmpty ? 'Boş' : esc(occupantName)}</div>
      </div>`;
    }).join('');
    this._showTransferStage(2);
  }

  selectTransferTarget(toTableId) {
    const fromTableId = state.noteTableId;
    const fromT = state.tables.find(x => x.id === fromTableId);
    const toT = state.tables.find(x => x.id === toTableId);
    this._transferTarget = toTableId;
    const order = state.tableOrders[fromTableId];
    const selection = this._transferSelection || {};
    const itemsStr = formatItemsList(Object.keys(selection).map(k => ({ name: order?.items?.[k]?.name||'?', qty: selection[k] })));
    this.els.itemTransferConfirmText.innerHTML = `<strong>${esc(itemsStr)}</strong><br>"${esc(fromT?.name||'')}" → "${esc(toT?.name||'')}"<br>köçürülür. Təsdiqləyirsiniz?`;
    this._showTransferStage(3);
  }

  closeItemTransferModal() {
    this.els.itemTransferModal.classList.remove('open');
    this._showTransferStage(1);
  }

  _transferSingleItem(fromTableId, toTableId, itemKey, moveQty, moved) {
    // Qeyd: Firebase JS SDK transaction-ları tək node üzərində işləyir; iki masa arasında
    // tam atomik köçürmə üçün server-tərəfli Cloud Function lazımdır. Hər tərəf ayrı-ayrı
    // transaction ilə qorunur ki, paralel yazılar bir-birini əzməsin.
    R.tableOrders.child(fromTableId).transaction(current => {
      if (!current || !current.items || !current.items[itemKey]) return current;
      const items = { ...current.items };
      const newQty = items[itemKey].qty - moveQty;
      if (newQty <= 0) delete items[itemKey]; else items[itemKey] = { ...items[itemKey], qty: newQty };
      if (!Object.keys(items).length) return null;
      const _tot = computeOrderTotals(items);

      const total = _tot.total, serviceChargeAmount = _tot.serviceChargeAmount, serviceChargePercent = _tot.serviceChargePercent;
      const paidAmount = current.paidAmount || 0;
      return { ...current, items, total, serviceChargeAmount, serviceChargePercent, remainingAmount: total - paidAmount };
    }, (error, committed) => {
      if (error) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Xəta: mənbə masa yenilənmədi'); return; }
      if (committed) this.renderSummary(fromTableId);
    });

    // Hədəf masa hazırda boşdursa, mal köçürüldükdə həmin masa da aktivləşir (yeni sessiya başlayır)
    const toTable = state.tables.find(x => x.id === toTableId);
    if (toTable && !toTable.occupant) {
      R.tables.child(toTableId).update({ occupant: state.user.id, activatedAt: Date.now(), sessionId: `${toTableId}_${Date.now()}` });
    }

    R.tableOrders.child(toTableId).transaction(current => {
      const items = (current && current.items) ? { ...current.items } : {};
      const key = makeLineKey(moved.menuItemId, moved.note, moved.extraFee);
      if (items[key]) items[key] = { ...items[key], qty: items[key].qty + moveQty };
      else items[key] = { ...moved, qty: moveQty };
      const _tot = computeOrderTotals(items);

      const total = _tot.total, serviceChargeAmount = _tot.serviceChargeAmount, serviceChargePercent = _tot.serviceChargePercent;
      const paidAmount = (current && current.paidAmount) || 0;
      return { items, total, serviceChargeAmount, serviceChargePercent, waiterId: (current && current.waiterId) || toTable?.occupant || state.user.id, paidAmount, remainingAmount: total - paidAmount, updatedAt: Date.now() };
    }, (error) => {
      if (error) showToast('<svg class="icon"><use href="#i-error"></use></svg> Xəta: hədəf masa yenilənmədi');
    });
  }

  confirmItemTransfer() {
    const fromTableId = state.noteTableId;
    const toTableId = this._transferTarget;
    if (!fromTableId || !toTableId) return;

    const fromOrderCheck = state.tableOrders[fromTableId];
    const fromT = state.tables.find(x => x.id === fromTableId);
    const toT = state.tables.find(x => x.id === toTableId);

    const selection = this._transferSelection || {};
    const selKeys = Object.keys(selection).filter(k => fromOrderCheck?.items?.[k]);
    if (!selKeys.length) { this.closeItemTransferModal(); return; }

    const movedList = [];
    selKeys.forEach(itemKey => {
      const it = fromOrderCheck.items[itemKey];
      if (!it) return;
      const moveQty = Math.min(selection[itemKey], it.qty);
      movedList.push({ name: it.name, qty: moveQty });
      const moved = { menuItemId: it.menuItemId, name: it.name, price: it.price, note: it.note||'', extraFee: it.extraFee||0 };
      this._transferSingleItem(fromTableId, toTableId, itemKey, moveQty, moved);
    });

    addLog('table', `${state.user?.name} "${fromT?.name}"-dən "${toT?.name}"-ə köçürdü: ${formatItemsList(movedList)}`, { tableId: fromTableId, toTableId });
    showToast(`<svg class="icon"><use href="#i-check"></use></svg> ${formatItemsList(movedList)} → "${toT?.name}"`);
    this.clearBatchSelection();
    this.closeItemTransferModal();
  }

  // ── Bütöv masa köçürmə ──
  confirmTableTransfer(fromId, toId) {
    if (!fromId || !toId) return;
    const fromT = state.tables.find(x => x.id === fromId);
    const toT = state.tables.find(x => x.id === toId);
    const order = state.tableOrders[fromId];
    const originalOccupant = fromT?.occupant || state.user.id;
    const sessionId = fromT?.sessionId || `${fromId}_${Date.now()}`;
    if (order) {
      R.tableOrders.child(toId).transaction(current => {
        if (current && current.items && Object.keys(current.items).length) return; // hədəf artıq boş deyil - abort
        return { ...order, updatedAt: Date.now() };
      });
      R.tableOrders.child(fromId).remove();
    }
    R.tables.child(toId).update({ occupant: originalOccupant, notes: fromT?.notes||'', activatedAt: fromT?.activatedAt || Date.now(), sessionId, openedById: fromT?.openedById||null, openedByName: fromT?.openedByName||null });
    R.tables.child(fromId).update({ occupant: null, notes: '', activatedAt: null, sessionId: null, openedById: null, openedByName: null });
    addLog('table', `${state.user.name} "${fromT?.name}" masasını "${toT?.name}"-ə köçürdü: ${formatItemsList(order?.items||{})}`, { tableId: toId, sessionId, fromTableId: fromId, toTableId: toId });
    showToast(`<svg class="icon"><use href="#i-check"></use></svg> "${fromT?.name}" → "${toT?.name}" köçürüldü`);
  }
}

/* ───────────────────────── PAYMENT PROCESSOR ───────────────────────── */

export class PaymentProcessor {
  /**
   * @param {Object} els - { modal, tableName, totalAmount, discountInfo, finalAmount, discountRow,
   *                          cashSection, splitSection, cashGiven, changeRow, change, changeLabel,
   *                          splitCash, splitPos, splitStatus, pt_cash, pt_pos, pt_split, customMethodsEl }
   */
  constructor(els) {
    this.els = els;
    this.payment = { tableId: null, type: null, discountType: null, discountValue: 0, originalTotal: 0, finalTotal: 0, paidAmount: 0, remainingAmount: 0 };
  }

  open(tableId) {
    if (!hasPermission('bill.payment_cash') && !hasPermission('bill.payment_pos')) {
      showToast('<svg class="icon"><use href="#i-ban"></use></svg> Ödəniş qəbul etmək icazəniz yoxdur'); return;
    }
    const t = state.tables.find(x => x.id === tableId);
    const order = state.tableOrders[tableId];
    if (!order || !order.total) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Bu masada aktiv sifariş yoxdur'); return; }
    const remainingCheck = (order.remainingAmount !== undefined && order.remainingAmount !== null) ? order.remainingAmount : order.total;
    if (remainingCheck <= 0.01) { showToast('<svg class="icon"><use href="#i-check"></use></svg> Bu hesab artıq tam ödənilib'); return; }

    const p = this.payment;
    p.tableId = tableId;
    p.originalTotal = order.total || 0;
    p.paidAmount = order.paidAmount || 0;
    p.finalTotal = p.discountValue ? p.finalTotal : p.originalTotal;
    p.remainingAmount = (order.remainingAmount !== undefined) ? order.remainingAmount : (p.finalTotal - p.paidAmount);
    p.type = null;

    this.els.tableName.textContent = t ? t.name : '—';
    if (p.paidAmount > 0) {
      this.els.totalAmount.textContent = `${p.remainingAmount.toFixed(2)} ₼ qalan (${p.paidAmount.toFixed(2)} ₼ ödənilib)`;
      this.els.totalAmount.style.color = 'var(--orange)';
    } else {
      this.els.totalAmount.textContent = p.originalTotal.toFixed(2) + ' ₼';
      this.els.totalAmount.style.color = 'var(--green)';
    }

    if (order.serviceChargeAmount > 0) {
      this.els.serviceChargeRow.style.display = 'flex';
      this.els.serviceChargeLabel.textContent = `Xidmət haqqı (${order.serviceChargePercent||0}%) daxildir`;
      this.els.serviceChargeValue.textContent = order.serviceChargeAmount.toFixed(2) + ' ₼';
    } else {
      this.els.serviceChargeRow.style.display = 'none';
    }

    if (p.discountValue > 0) {
      this.els.discountInfo.textContent = p.discountType==='percent' ? p.discountValue+'%' : p.discountValue.toFixed(2)+' ₼';
      this.els.finalAmount.textContent = p.finalTotal.toFixed(2) + ' ₼';
      this.els.discountRow.style.display = 'block';
      this.els.totalAmount.innerHTML = `<span style="text-decoration:line-through;color:var(--text3);font-size:16px;">${p.originalTotal.toFixed(2)} ₼</span>`;
    } else {
      this.els.discountRow.style.display = 'none';
      p.finalTotal = p.originalTotal;
    }

    this.els.cashSection.style.display = 'none';
    this.els.splitSection.style.display = 'none';
    this.els.cashGiven.value = '';
    this.els.changeRow.style.display = 'none';
    document.querySelectorAll('.payment-type-btn').forEach(b => b.classList.remove('selected'));

    this.els.pt_cash.style.display = hasPermission('bill.payment_cash') ? '' : 'none';
    this.els.pt_pos.style.display = hasPermission('bill.payment_pos') ? '' : 'none';
    this.els.pt_split.style.display = (hasPermission('bill.payment_cash') || hasPermission('bill.payment_pos')) ? '' : 'none';

    // Bölünmüş ödəniş üçün mövcud BÜTÜN ödəniş növləri (Nağd + POS + admin tərəfindən yaradılmış əlavələr)
    this._splitMethods = [];
    if (hasPermission('bill.payment_cash')) this._splitMethods.push({ id: 'cash', name: 'Nağd' });
    if (hasPermission('bill.payment_pos')) {
      this._splitMethods.push({ id: 'pos', name: 'POS' });
      (state.paymentMethods||[]).forEach(pm => this._splitMethods.push({ id: pm.id, name: pm.name }));
    }
    this.els.splitInputsWrap.innerHTML = this._splitMethods.map(m => `
      <div class="form-group">
        <label>${esc(m.name)} (₼)</label>
        <input type="number" class="split-method-input" data-split-method="${m.id}" min="0" step="0.01" placeholder="0.00">
      </div>
    `).join('');
    this.els.splitInputsWrap.querySelectorAll('.split-method-input').forEach(inp => {
      inp.addEventListener('input', () => this.calcSplit());
    });

    // Admin panelində yaradılmış əlavə ödəniş növləri (adi POS kimi - tam məbləğ, xüsusi sahə yoxdur)
    if (this.els.customMethodsEl) {
      const canCustom = hasPermission('bill.payment_pos');
      this.els.customMethodsEl.innerHTML = (canCustom ? (state.paymentMethods||[]) : []).map(pm =>
        `<button class="payment-type-btn" data-payment-type="${pm.id}"><svg class="icon"><use href="#i-card"></use></svg> ${esc(pm.name)}</button>`
      ).join('');
      this.els.customMethodsEl.querySelectorAll('[data-payment-type]').forEach(btn => {
        btn.addEventListener('click', () => this.selectType(btn.dataset.paymentType));
      });
    }

    this.els.modal.classList.add('open');
  }

  close() { this.els.modal.classList.remove('open'); }

  selectType(type) {
    this.payment.type = type;
    document.querySelectorAll('.payment-type-btn').forEach(b => b.classList.toggle('selected', b.dataset.paymentType === type));
    this.els.cashSection.style.display = type==='cash' ? 'block' : 'none';
    this.els.splitSection.style.display = type==='split' ? 'block' : 'none';
    if (type === 'split') this.calcSplit();
  }

  calcChange() {
    const given = parseFloat(this.els.cashGiven.value) || 0;
    const change = given - this.payment.finalTotal;
    if (given > 0) {
      this.els.changeRow.style.display = 'block';
      this.els.change.textContent = Math.abs(change).toFixed(2) + ' ₼';
      this.els.change.style.color = change >= 0 ? 'var(--blue)' : 'var(--red)';
      this.els.changeLabel.textContent = change >= 0 ? 'Qaytarılacaq:' : 'Çatışmır:';
    } else {
      this.els.changeRow.style.display = 'none';
    }
  }

  _splitTotal() {
    let sum = 0;
    this.els.splitInputsWrap.querySelectorAll('.split-method-input').forEach(inp => { sum += parseFloat(inp.value) || 0; });
    return Math.round(sum * 100) / 100;
  }

  calcSplit() {
    const sum = this._splitTotal();
    const remaining = this.payment.remainingAmount > 0 ? this.payment.remainingAmount : this.payment.finalTotal;
    const diff = sum - remaining;
    if (Math.abs(diff) < 0.01) { this.els.splitStatus.innerHTML = '<svg class="icon"><use href="#i-check"></use></svg> Düzgündür'; this.els.splitStatus.style.color = 'var(--green)'; }
    else if (diff > 0) { this.els.splitStatus.innerHTML = `<svg class="icon"><use href="#i-warning"></use></svg> ${diff.toFixed(2)} ₼ artıqdır (qalıqdan çoxdur)`; this.els.splitStatus.style.color = 'var(--red)'; }
    else { this.els.splitStatus.innerHTML = `<svg class="icon"><use href="#i-warning"></use></svg> ${Math.abs(diff).toFixed(2)} ₼ çatışmır`; this.els.splitStatus.style.color = 'var(--orange)'; }
  }

  confirm(onSettled) {
    const p = this.payment;
    if (!p.type) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Ödəniş növü seçin'); return; }
    const tableId = p.tableId;
    const t = state.tables.find(x => x.id === tableId);
    const remaining = p.remainingAmount > 0 ? p.remainingAmount : p.finalTotal;

    let thisPay = 0;
    let splitBreakdown = null;
    if (p.type === 'cash') {
      const given = parseFloat(this.els.cashGiven.value) || 0;
      if (given <= 0) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Məbləğ daxil edin'); return; }
      thisPay = Math.min(given, remaining); // nağdda artıq məbləğ normaldır - qalıq geri qaytarılır (bax: calcChange)
    } else if (p.type === 'split') {
      const sum = this._splitTotal();
      if (sum <= 0) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Məbləğ daxil edin'); return; }
      if (sum - remaining > 0.01) { showToast(`<svg class="icon"><use href="#i-error"></use></svg> Ödəyəcəyiniz məbləğ (${sum.toFixed(2)} ₼) qalıq məbləğdən (${remaining.toFixed(2)} ₼) çoxdur!`); return; }
      thisPay = sum;
      splitBreakdown = {};
      this.els.splitInputsWrap.querySelectorAll('.split-method-input').forEach(inp => {
        const v = parseFloat(inp.value) || 0;
        if (v > 0) splitBreakdown[inp.dataset.splitMethod] = v;
      });
    } else {
      // 'pos' və ya admin tərəfindən yaradılmış əlavə ödəniş növü - tam məbləğ
      thisPay = remaining;
    }

    const customMethod = state.paymentMethods?.find(pm => pm.id === p.type);
    const typeLabel = p.type === 'cash' ? 'Nağd' : p.type === 'pos' ? 'POS' : p.type === 'split' ? 'Bölünmüş' : (customMethod?.name || 'Silinmiş növ');
    const sessionId = t?.sessionId || null;

    const payData = {
      tableId, tableName: t?.name || '?', sessionId,
      staffId: state.user.id, staffName: state.user.name,
      type: p.type, typeLabel,
      originalAmount: p.originalTotal, finalAmount: p.finalTotal, thisPay,
      paidBefore: p.paidAmount,
      discountType: p.discountType || null, discountValue: p.discountValue || 0,
      createdAt: Date.now(), time: new Date().toLocaleTimeString('az-AZ'), date: new Date().toLocaleDateString('az-AZ')
    };
    if (p.type === 'cash') { const given = parseFloat(this.els.cashGiven.value)||0; payData.cashGiven = given; payData.change = Math.max(0, given-remaining); }
    if (p.type === 'split' && splitBreakdown) {
      payData.splitBreakdown = splitBreakdown;
      const methodNames = this._splitMethods || [];
      // Növ adlarını HƏMİN AN üçün "dondurub" saxlayırıq - admin sonradan bu ödəniş növünü
      // silsə belə, köhnə hesabatlar xam ID yox, düzgün adı göstərməyə davam etsin
      payData.splitMethodNames = {};
      Object.keys(splitBreakdown).forEach(id => {
        payData.splitMethodNames[id] = id==='cash'?'Nağd':id==='pos'?'POS':(methodNames.find(m=>m.id===id)?.name||'Silinmiş növ');
      });
      payData.splitLabel = Object.entries(splitBreakdown).map(([id,v]) => `${payData.splitMethodNames[id]}: ${v.toFixed(2)} ₼`).join(', ');
    }

    R.payments.push(payData);

    const finalTotalForCalc = p.finalTotal;
    R.tableOrders.child(tableId).transaction(current => {
      if (!current) return current;
      const newPaid = (current.paidAmount || 0) + thisPay;
      return { ...current, paidAmount: newPaid, remainingAmount: Math.max(0, finalTotalForCalc - newPaid) };
    }, (error, committed, snapshot) => {
      if (error) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Ödəniş qeydə alındı, amma balans yenilənərkən xəta oldu'); return; }
      const finalData = snapshot ? snapshot.val() : null;
      p.paidAmount = finalData ? (finalData.paidAmount||0) : (p.paidAmount + thisPay);
      p.remainingAmount = finalData ? (finalData.remainingAmount||0) : Math.max(0, finalTotalForCalc - p.paidAmount);

      const logTypeLabel = payData.splitLabel ? `${typeLabel}: ${payData.splitLabel}` : typeLabel;
      addLog('order', `${state.user.name} ${thisPay.toFixed(2)} ₼ ödəniş aldı (${logTypeLabel})`, { tableId });
      this.close();

      const fullyPaid = p.remainingAmount <= 0.01;
      if (fullyPaid) p.remainingAmount = 0;
      showToast(fullyPaid
        ? `<svg class="icon"><use href="#i-check"></use></svg> Tam ödənildi: ${p.finalTotal.toFixed(2)} ₼`
        : `<svg class="icon"><use href="#i-check"></use></svg> ${thisPay.toFixed(2)} ₼ ödənildi. Qalan: ${p.remainingAmount.toFixed(2)} ₼`);
      if (onSettled) onSettled(fullyPaid);
    });
  }
}
