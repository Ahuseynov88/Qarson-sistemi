/* ═══════════════════════════════════════════
   BILLING
   Göndərilmiş sifarişin idarəsi: miqdar dəyişmə, iptal (səbəblə),
   endirim (seçilmişlərə və ya bütün hesaba), ikram, mal/masa köçürmə,
   və ödəniş (nağd/POS/bölünmüş/nisyə).
═══════════════════════════════════════════ */
import { R, db } from './firebase-service.js';
import { state } from './state.js';
import { esc, showToast, addLog, makeLineKey, updateStock, formatItemsList, computeOrderTotals, serverNow, azTime, azDate, money2 } from './utils.js';
import { hasPermission } from './permissions.js';
import { needShift, shiftNow } from './yuza-shift.js';
import { normPhone, fullName, ensureAccount, baseList } from './yuza-customers.js';   // C17
import { creditLimitOf, creditDueDaysOf, requestOverLimit } from './yuza-credit.js';   // C17b
import { tag as guestTag } from './yuza-split.js';   // C18

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
      if (e.target.closest('#sentCollapseBar')) { this._sentExpanded = false; this.renderSummary(state.noteTableId); return; }
      const batchBtn = e.target.closest('[data-batch-qty]');
      if (batchBtn) { this.setBatchQty(batchBtn.dataset.itemKey, parseInt(batchBtn.dataset.batchQty, 10)); return; }
      // Item sətrinə klik — sağ panel aç
      const line = e.target.closest('[data-item-key]');
      if (line) { this.openItemSidePanel(state.noteTableId, line.dataset.itemKey); return; }
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

        const isPaid = (order.remainingAmount !== undefined && order.remainingAmount !== null)
      ? order.remainingAmount <= 0.01
      : false;
    const canEdit  = !isPaid && hasPermission('order.cancel_item');
    const canBatch = !isPaid && (hasPermission('order.batch_ops') || hasPermission('order.discount') || hasPermission('order.gift') || hasPermission('table.transfer') || hasPermission('bill.credit_batch') || hasPermission('order.cancel_item'));
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
                return `<div class="ticket-line sent ${isSelected?'bsel':''}" data-item-key="${itemKey}">
          <div class="ticket-line__main">
            <label class="bsel-check" data-check-key="${itemKey}">
              <div class="bsel-box ${isSelected?'bsel-box--on':''}"></div>
            </label>
            <span class="ticket-line__name" style="flex:1;cursor:pointer;" data-open-panel="${itemKey}">${it.guest ? guestTag(tableId, it.guest) + ' ' : ''}${esc(it.name)}${it.qty>1?` <span style="color:var(--text3);font-weight:400;">×${it.qty}</span>`:''}</span>
            <span class="ticket-line__price">${lineTotal.toFixed(2)} ₼</span>
          </div>
          <div class="ticket-line__tags">
            ${it.note ? `<span class="discount-badge" style="background:transparent;border-color:var(--border);color:var(--text3);"><svg class="icon"><use href="#i-note"></use></svg> ${esc(it.note)}</span>` : ''}
            ${it.compliment ? `<span class="discount-badge" style="background:rgba(28,107,53,.15);color:var(--green);border-color:var(--green);">İKRAM</span>` : ''}
            ${(it.discountPercent>0) ? `<span class="discount-badge">-${it.discountPercent}%</span>` : ''}
          </div>
        </div>`;
       }).join('')}
    `;
    // Checkbox klik
    el.querySelectorAll('[data-check-key]').forEach(lbl => {
      lbl.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = lbl.dataset.checkKey;
        const it = order.items[key];
        if (!it) return;
        const s = { ...(state._batchSelection || {}) };
        if (s[key]) delete s[key]; else s[key] = it.qty;
        state._batchSelection = s;
        this.renderSummary(tableId);
      });
    });

        // Mal adına klik → yalnız batch seçim yoxdursa yan panel aç
    el.querySelectorAll('[data-open-panel]').forEach(span => {
      span.addEventListener('click', () => {
        const hasBatch = Object.keys(state._batchSelection || {}).length > 0;
        if (!hasBatch) {
          this.openItemSidePanel(tableId, span.dataset.openPanel);
        }
        // Batch varsa klik heç nə etmir — istifadəçi checkbox-dan istifadə edir
      });
    });

    // Seçim varsa — action bar göstər
    if (selectedCount > 0) {
      const bar = document.createElement('div');
      bar.className = 'bsel-bar';
      bar.innerHTML = `
        <div class="bsel-bar-info">
          <span>${selectedCount} mal seçilib</span>
          <button class="bsel-clear" data-clear>✕ Sıfırla</button>
        </div>
        <button class="btn btn-blue bsel-action-btn" data-open-batch-modal style="width:100%;margin-top:8px;">
          <svg class="icon"><use href="#i-check"></use></svg> Əməliyyat seç
        </button>`;
      el.appendChild(bar);
      bar.querySelector('[data-clear]').addEventListener('click', () => { this.clearBatchSelection(); this.renderSummary(tableId); });
      bar.querySelector('[data-open-batch-modal]').addEventListener('click', () => this.openBatchActionModal());
    }
  }

  // ── İptal (səbəblə) ──
    openCancelReasonModal(tableId, itemKey) {
    if (!hasPermission('order.cancel_item')) return;
    const order = state.tableOrders[tableId];
    if (!order) return;
    const isPaid = order.remainingAmount !== undefined ? order.remainingAmount <= 0.01 : false;
    if (isPaid) { showToast('<svg class="icon"><use href="#i-ban"></use></svg> Hesab ödənilmiş masada əməliyyat aparılamaz'); return; }
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

  /* ── Toplu silmə: seçilmiş malların hamısı bir pəncərədə, bir səbəblə ──
     Hər mal mövcud tək silmə (cancelItem) ilə ardıcıl silinir: jurnal, stok və mətbəx kartı eyni qayda ilə yenilənir. */
  openBatchCancel() {
    if (!hasPermission('order.cancel_item')) { showToast('<svg class="icon"><use href="#i-ban"></use></svg> Mal silmək icazəniz yoxdur'); return; }
    const tableId = state.noteTableId;
    const order = state.tableOrders[tableId];
    const sel = Object.entries(state._batchSelection || {}).filter(([k, q]) => q > 0 && order?.items?.[k]);
    if (!sel.length) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Silmək üçün mətbəxə göndərilmiş malları işarələyin'); return; }
    const isPaid = order.remainingAmount !== undefined ? order.remainingAmount <= 0.01 : false;
    if (isPaid) { showToast('<svg class="icon"><use href="#i-ban"></use></svg> Hesab ödənilmiş masada əməliyyat aparılamaz'); return; }
    this._bc = { tableId, rows: sel.map(([k, q]) => ({ key: k, qty: Math.min(q, order.items[k].qty), max: order.items[k].qty })) };
    document.getElementById('batchCancelReason').value = 'Səhv sifariş';
    this._renderBatchCancel();
    document.getElementById('batchCancelModal').classList.add('open');
  }

  _renderBatchCancel() {
    const { tableId, rows } = this._bc;
    const order = state.tableOrders[tableId];
    const list = document.getElementById('batchCancelList');
    let sum = 0;
    list.innerHTML = rows.map((r, i) => {
      const it = order.items[r.key];
      const unit = (it.price || 0) * (1 - ((it.discountPercent || 0) / 100));
      sum += unit * r.qty;
      return `<div class="bc-row">
        <div class="bc-row__name"><b>${esc(it.name)}</b><small>Sifarişdə: ${r.max} ədəd</small></div>
        <div class="qty-stepper"><button type="button" data-bc="${i}" data-d="-1" aria-label="Azalt">−</button><span class="qty-stepper__val">${r.qty}</span><button type="button" data-bc="${i}" data-d="1" aria-label="Artır">+</button></div>
        <span class="bc-row__amt">${(unit * r.qty).toFixed(2)} ₼</span>
      </div>`;
    }).join('');
    list.querySelectorAll('[data-bc]').forEach(b => b.addEventListener('click', () => {
      const r = rows[+b.dataset.bc];
      r.qty = Math.min(r.max, Math.max(1, r.qty + Number(b.dataset.d)));
      this._renderBatchCancel();
    }));
    const n = rows.reduce((s, r) => s + r.qty, 0);
    document.getElementById('batchCancelSum').textContent = `Cəmi silinəcək: ${n} ədəd · ${sum.toFixed(2)} ₼`;
  }

  closeBatchCancel() {
    document.getElementById('batchCancelModal').classList.remove('open');
    this._bc = null;
  }

  async confirmBatchCancel() {
    if (!this._bc || this._bcBusy) return;
    const { tableId, rows } = this._bc;
    const reason = document.getElementById('batchCancelReason').value;
    const btn = document.querySelector('#batchCancelModal [data-confirm-batch-cancel]');
    this._bcBusy = true; if (btn) btn.disabled = true;
    let ok = 0;
    for (const r of rows) {
      if (await this.cancelItem(tableId, r.key, reason, r.qty)) ok++;
      await new Promise(res => setTimeout(res, 120));     // mətbəx kartı növbəti silmədən əvvəl yenilənsin
    }
    this._bcBusy = false; if (btn) btn.disabled = false;
    this.closeBatchCancel();
    this.clearBatchSelection();
    this.renderSummary(tableId);
    if (ok === rows.length) showToast(`<svg class="icon"><use href="#i-check"></use></svg> ${ok} mal sifarişdən silindi`);
    else showToast(`<svg class="icon"><use href="#i-error"></use></svg> ${rows.length - ok} mal silinmədi — yenidən yoxlayın`);
  }

  cancelItem(tableId, itemKey, reason, cancelQty, { system = false } = {}) {
    let done; const result = new Promise(r => { done = r; });
    // system: mətbəx "yalnız N hazırlana bilər" bildirişi qəbul ediləndə (C23) — ofisiantın silmə icazəsi tələb olunmur
    if (!system && !hasPermission('order.cancel_item')) { done(false); return result; }
    const order = state.tableOrders[tableId];
    if (!order?.items) { done(false); return result; }
    const it = order.items[itemKey];
    if (!it) { done(false); return result; }
    const fullQty = it.qty;
    const qtyToCancel = Math.min(Math.max(cancelQty || fullQty, 1), fullQty);
    const isPartial = qtyToCancel < fullQty;
    const cancelledName = it.name, cancelledMenuItemId = it.menuItemId;
    const unitMul = Number(it.ml) > 0 ? Number(it.ml) : 1;   // C16: şüşə / ml sətri — anbara ml qaytarılır
    const reasonText = reason || 'Qeyd olunmayıb';
    // Sifarişi ilk göndərən işçi (ləğv edəndən FƏRQLİ ola bilər) - hesabatda hər ikisi görünsün
    const orderOwner = state.staff.find(s => s.id === order.waiterId);
    const orderOwnerName = orderOwner?.name || 'Naməlum';

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
      return { ...current, items, total, serviceChargeAmount, serviceChargePercent, remainingAmount: money2(Math.max(0, total - paidAmount)) };
    }, (error, committed) => {
      if (error) { done(false); showToast('<svg class="icon"><use href="#i-error"></use></svg> Xəta baş verdi, yenidən cəhd edin'); return; }
      if (!committed) { done(false); return; }
      updateStock(cancelledMenuItemId, qtyToCancel * unitMul, state.menuItems);
      const t = state.tables.find(x => x.id === tableId);
      const qtyLabel = isPartial ? `${qtyToCancel} ədəd` : `bütün (${fullQty} ədəd)`;
      // Ləğv edilən məbləğ = (ləğv olunan miqdar / ümumi miqdar) nisbətində qiymətdən pay
      const cancelledAmount = Math.round((it.price||0) * (1-((it.discountPercent||0)/100)) * qtyToCancel * 100) / 100;
      addLog('order_cancel', `${state.user?.name} "${cancelledName}" malından ${qtyLabel} sifarişdən iptal etdi (${cancelledAmount.toFixed(2)} ₼) — Sifarişi vermiş: ${orderOwnerName} — Səbəb: ${reasonText}`,
        { tableId, tableName: t?.name, menuItemId: cancelledMenuItemId, itemName: cancelledName, qty: qtyToCancel, amount: cancelledAmount, reason: reasonText,
          staffId: state.user?.id, staffName: state.user?.name, orderOwnerId: order.waiterId||null, orderOwnerName });
                   // Mətbəx kartını yenilə
            const menuItem = state.menuItems.find(x => x.id === cancelledMenuItemId);
      const kitchenId = menuItem?.kitchenId || 'default';   // göndərəndə də stansiyasız mal 'default' kartına düşür
      if (kitchenId) {
        const activeKo = (state.kitchenOrders || []).find(ko =>
          ko.tableId === tableId && ko.kitchenId === kitchenId &&
          !ko.allReady && (ko.items || []).some(i => i.name === cancelledName && i.qty > 0)
        );
        if (activeKo) {
          // LIFO: eyni adlı item-ləri addedAt-a görə ən yenidən ən köhnəyə sırala
          let remaining = qtyToCancel;
          const koItems = [...(activeKo.items || [])]
            .map((item, idx) => ({ ...item, _idx: idx }))
            .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
            .reduce((acc, item) => {
              if (item.name !== cancelledName || remaining <= 0) {
                acc.push(item); return acc;
              }
              const canCancel = Math.min(item.qty, remaining);
              remaining -= canCancel;
              const newQty = item.qty - canCancel;
              if (newQty > 0) acc.push({ ...item, qty: newQty });
              // newQty === 0 olduqda item siyahıdan çıxır (göstərilmir)
              return acc;
            }, [])
            .sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0)); // orijinal sıraya qayıt

          if (koItems.length === 0) {
            R.kitchenOrders.child(activeKo.id).remove();
          } else {
            const activeItems = koItems.filter(i => !i.cancelled);
            const allReady = activeItems.length > 0 && activeItems.every(i => i.ready);
            R.kitchenOrders.child(activeKo.id).update({
              items: koItems,
              allReady,
              changeNote: 'LƏĞV: ' + cancelledName + ' — ' + qtyToCancel + ' ədəd. Səbəb: ' + reasonText
            });
                   }
        }
      }
      done(true);
    });
    return result;
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
       if (this._discountType==='fixed' && val>subtotal) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Endirim məbləğdən çox ola bilməz'); return; }
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
      return { ...current, items, total, serviceChargeAmount, serviceChargePercent, remainingAmount: money2(Math.max(0, total - paidAmount)) };
    }, (error, committed) => {
      if (error) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Xəta baş verdi, yenidən cəhd edin'); return; }
      if (!committed) return;
      const discStr = this._discountType==='percent' ? `${val}%` : `${val.toFixed(2)} ₼`;
      addLog('discount', isWholeTable
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
    const isPaid = order?.remainingAmount !== undefined ? order.remainingAmount <= 0.01 : false;
    if (isPaid) { showToast('<svg class="icon"><use href="#i-ban"></use></svg> Hesab ödənilmiş masada əməliyyat aparılamaz'); return; }
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

    // C17: siyahı — nisyə hesabları + ümumi bazadakı müştərilər (hesabı yoxdursa təsdiqdə açılır)
    this._fillChargeList();
    const q = document.getElementById('customerChargeQ');
    if (q) { q.value = ''; q.oninput = () => this._fillChargeList(q.value); }
    baseList().then(() => this._fillChargeList(q?.value || '')).catch(() => {});
    this._showChargeStage(1);
    document.getElementById('customerChargeModal').classList.add('open');
  }

  _chargeOptions() {
    const accs = (state.customers || []).map(a => ({ v: a.id, name: a.name || '?', phone: a.phone || '', ok: !!normPhone(a.phone), bal: a.balance || 0, baseId: a.baseId || null }));
    const linked = new Set(accs.map(a => a.baseId).filter(Boolean));
    const base = (state.loyaltyCustomers?.length ? state.loyaltyCustomers : (window.__yzBaseCache || []))
      .filter(c => !linked.has(c.id) && normPhone(c.phone))
      .map(c => ({ v: 'b:' + c.id, name: fullName(c), phone: c.phone || '', ok: true, bal: null }));
    return [...accs, ...base].sort((x, y) => String(x.name).localeCompare(String(y.name), 'az'));
  }
  _fillChargeList(q = '') {
    const sel = document.getElementById('customerChargeSelect'); if (!sel) return;
    const t = String(q).trim().toLowerCase(), qd = t.replace(/\D/g, '');
    const list = this._chargeOptions().filter(o => !t || o.name.toLowerCase().includes(t) || (qd.length >= 3 && String(o.phone).replace(/\D/g, '').includes(qd)));
    const prev = sel.value;
    sel.innerHTML = list.map(o => `<option value="${esc(o.v)}"${o.ok ? '' : ' disabled'}>${esc(o.name)}${o.phone ? ' · ' + esc(o.phone) : ''}${o.ok ? (o.bal ? ` — borc ${Number(o.bal).toFixed(2)} ₼` : (o.bal === null ? ' — yeni hesab' : '')) : ' — telefon yoxdur'}</option>`).join('');
    if (prev && list.some(o => o.v === prev && o.ok)) sel.value = prev;
    else { const f = list.find(o => o.ok); if (f) sel.value = f.v; }
  }
  _chargeCustomerOf(v) {
    if (!v) return null;
    if (v.startsWith('b:')) { const c = (state.loyaltyCustomers?.length ? state.loyaltyCustomers : (window.__yzBaseCache || [])).find(x => x.id === v.slice(2)); return c ? { id: v, name: fullName(c), isNew: true } : null; }
    const a = state.customers.find(c => c.id === v);
    return a && normPhone(a.phone) ? a : null;
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
    const customer = this._chargeCustomerOf(customerId);
    if (!customer) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Müştəri seçin (telefonu olan)'); return; }

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

  async confirmCustomerCharge() {
    const tableId = state.noteTableId;
    const order = state.tableOrders[tableId];
    if (!order) return;
    const t = state.tables.find(x => x.id === tableId);
    let customerId = document.getElementById('customerChargeSelect').value;
    let customer = this._chargeCustomerOf(customerId);
    if (!customer) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Müştəri seçin (telefonu olan)'); return; }
    // C17: bazadakı müştərinin nisyə hesabı yoxdursa — açılır
    if (customer.isNew) {
      if (this._chargeBusy) return;
      try { this._chargeBusy = true; customerId = await ensureAccount(customerId.slice(2)); } catch (e) { this._chargeBusy = false; showToast('<svg class="icon"><use href="#i-error"></use></svg> ' + esc(e.message)); return; }
      this._chargeBusy = false;
      customer = { id: customerId, name: customer.name };
    }

    const selection = this._chargeSelection || {};
    const selKeys = Object.keys(selection).filter(k => order.items?.[k]);
    if (this._chargeBusy) return;
    const remainingNow = money2(Math.max(0, (order.total || 0) - (order.paidAmount || 0)));
    if (!selKeys.length && remainingNow <= 0.01) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Bu hesabda qalıq yoxdur'); this.closeCustomerChargeModal(); return; }

    // C17b: limit — keçirsə nisyə yazılmır, Rəhbərə təsdiq sorğusu gedir
    const amountNow = selKeys.length
      ? money2(selKeys.reduce((sm, k) => { const it = order.items[k], q = selection[k]; return sm + it.price * q * (1 - ((it.discountPercent || 0) / 100)) + (it.extraFee || 0) * (q / it.qty); }, 0))
      : remainingNow;
    const acc = state.customers.find(c => c.id === customerId) || { balance: 0 };
    const lim = creditLimitOf(acc);
    if (lim !== null && money2((acc.balance || 0) + amountNow) > lim + 0.001) {
      this.closeCustomerChargeModal();
      await requestOverLimit({ tableId, tableName: t?.name || '?', customerId, customerName: customer.name, amount: amountNow,
        balance: acc.balance || 0, limit: lim, selection: selKeys.length ? Object.fromEntries(selKeys.map(k => [k, selection[k]])) : null,
        items: selKeys.length ? selKeys.map(k => ({ name: order.items[k].name, qty: selection[k], price: order.items[k].price })) : Object.values(order.items).map(it => ({ name: it.name, qty: it.qty, price: it.price })) });
      if (selKeys.length) this.clearBatchSelection();
      return;
    }
    this._chargeBusy = true;
    const r = await this.executeCharge({ tableId, customerId, customerName: customer.name, selection: selKeys.length ? selection : null });
    this._chargeBusy = false;
    if (!r.ok) showToast(`<svg class="icon"><use href="#i-warning"></use></svg> ${esc(r.reject || 'Nisyə yazılmadı')}`);
    else {
      showToast(`<svg class="icon"><use href="#i-check"></use></svg> ${r.rec.amount.toFixed(2)} ₼ "${esc(customer.name)}" adına yazıldı`);
      if (selKeys.length) this.clearBatchSelection();
      this.renderSummary(tableId);
    }
    this.closeCustomerChargeModal();
  }

  /* Nisyənin özü (həm ofisiantın düyməsi, həm də Rəhbərin limit təsdiqi bunu çağırır).
     Mərhələ 2a: nisyə masanın sifarişinin içinə (tableOrders/{masa}/charges) transaction ilə düşür, sonra
     müştərinin balansı və nisyə jurnalı BİR yazı ilə yenilənir (postCharge). Yarımçıq qalsa, masa bağlananda tamamlanır. */
  executeCharge({ tableId, customerId, customerName, selection = null, approvedBy = null, requestId = null, writer = null }) {
    return new Promise((resolve) => {
      const t = state.tables.find(x => x.id === tableId);
      const ts = serverNow();
      const chargeId = R.customerCharges.push().key;
      const acc = state.customers.find(c => c.id === customerId) || {};
      const dueDays = creditDueDaysOf(acc);
      const base = {
        customerId, customerName, tableId, tableName: t?.name || '?',
        staffId: writer?.id || state.user.id || 'admin', staffName: writer?.name || state.user.name, shiftId: shiftNow()?.id || null,   // təsdiqdə: yazan — sorğunu göndərən ofisiant
        createdAt: ts, time: azTime(ts), date: azDate(ts),
        dueAt: ts + dueDays * 86400000,                         // C17b: ödəmə müddəti
        ...(approvedBy ? { approvedBy, overLimit: true, requestId } : {})
      };
      const selKeys = selection ? Object.keys(selection) : [];
      let rec = null, reject = '';
      R.tableOrders.child(tableId).transaction(current => {
        rec = null; reject = '';
        if (!current || !current.items) { reject = 'Bu masada aktiv sifariş yoxdur'; return; }
        const charges = { ...(current.charges || {}) };
        // C17b: masaya kim qulluq edib (sifarişi açan ofisiant)
        const w = (state.staff || []).find(s => s.id === current.waiterId);
        base.waiterId = current.waiterId || null; base.waiterName = w?.name || null;
        const coversAll = selKeys.length && Object.entries(current.items).every(([k, it]) => (selection[k] || 0) >= (it.qty || 0));
        if (selKeys.length && !coversAll) {
          if (!selKeys.some(k => current.items[k])) { reject = 'Seçilmiş mallar artıq sifarişdə yoxdur'; return; }
          const { items, targetKeys } = this._splitSelectedItems(current.items, selection);
          const amount = money2(targetKeys.reduce((sum, k) => { const it = items[k]; return it ? sum + (it.price * it.qty * (1 - ((it.discountPercent || 0) / 100))) + (it.extraFee || 0) : sum; }, 0));
          const chargedItems = targetKeys.filter(k => items[k]).map(k => ({ name: items[k].name, qty: items[k].qty, price: items[k].price }));
          if (!chargedItems.length) { reject = 'Seçilmiş mallar artıq sifarişdə yoxdur'; return; }
          targetKeys.forEach(k => delete items[k]);
          rec = { ...base, items: chargedItems, amount };
          charges[chargeId] = rec;
          const _tot = computeOrderTotals(items);
          const total = Object.keys(items).length ? _tot.total : 0;
          const paidAmount = current.paidAmount || 0;
          return { ...current, items, charges, total, serviceChargeAmount: Object.keys(items).length ? _tot.serviceChargeAmount : 0, remainingAmount: money2(Math.max(0, total - paidAmount)) };
        }
        const total = current.total || 0;
        const freshRemaining = money2(Math.max(0, total - (current.paidAmount || 0)));
        if (freshRemaining <= 0.01) { reject = 'Bu hesabda qalıq yoxdur'; return; }
        rec = { ...base, items: Object.values(current.items || {}).map(it => ({ name: it.name, qty: it.qty, price: it.price })), amount: freshRemaining };
        charges[chargeId] = rec;
        return { ...current, charges, paidAmount: money2((current.paidAmount || 0) + freshRemaining), remainingAmount: 0 };
      }, (error, committed) => {
        if (error) { resolve({ ok: false, reject: 'Nisyə yazılmadı (bağlantı xətası). Heç nə dəyişməyib, yenidən cəhd edin.' }); return; }
        if (!committed || !rec) { resolve({ ok: false, reject: reject || 'Nisyə yazılmadı' }); return; }
        postCharge(tableId, chargeId, rec).catch(() => { /* masa bağlananda tamamlanacaq */ });
        addLog('credit', `${state.user.name} "${t?.name}" masasından ${formatItemsList(rec.items)} (${rec.amount.toFixed(2)} ₼) "${customerName}" adına nisyə yazdı${approvedBy ? ` — limit aşımı, təsdiqlədi: ${approvedBy}` : ''}`, { tableId, customerId, chargeId });
        resolve({ ok: true, rec, chargeId });
      }, false);
    });
  }

  // ── İkram (seçilmişlərə və ya tək mala) ──
     openComplimentModal() {
    if (!hasPermission('order.gift') && !hasPermission('order.discount')) { showToast('<svg class="icon"><use href="#i-ban"></use></svg> İkram icazəniz yoxdur'); return; }
    const tableId = state.noteTableId;
    if (!tableId) return;
    const order = state.tableOrders[tableId];
    if (!order?.items) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Sifariş yoxdur'); return; }
    const isPaid = order.remainingAmount !== undefined ? order.remainingAmount <= 0.01 : false;
    if (isPaid) { showToast('<svg class="icon"><use href="#i-ban"></use></svg> Hesab ödənilmiş masada əməliyyat aparılamaz'); return; }
    
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
      return { ...current, items, total, serviceChargeAmount, serviceChargePercent, remainingAmount: money2(Math.max(0, total - paidAmount)) };
    }, (error, committed) => {
      if (error) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Xəta baş verdi, yenidən cəhd edin'); return; }
      if (!committed) return;
      addLog('discount', `${state.user?.name} "${t?.name}" masasında ${formatItemsList(appliedItemsList)} ikram etdi`, { tableId });
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
      let items = { ...current.items };

      // 1. Seçilmiş itemləri sıfırla (split etmədən birbaşa)
      Object.keys(selection).forEach(k => {
        if (!items[k]) return;
        const it = items[k];
        items[k] = {
          ...it,
          discountPercent: 0,
          compliment: false,
          price: it.compliment ? (it.originalPrice ?? it.price) : it.price,
          extraFee: it.compliment ? (it.originalExtraFee ?? (it.extraFee||0)) : (it.extraFee||0),
          originalPrice: null,
          originalExtraFee: null
        };
        resetItemsList.push({ name: items[k].name, qty: items[k].qty });
      });

      // 2. Eyni menuItemId + note + extraFee olan itemləri birləşdir
      // (split zamanı yaranmış _x... açarlı itemləri orijinalı ilə birləşdir)
      const merged = {};
      Object.entries(items).forEach(([k, it]) => {
        const baseKey = makeLineKey(it.menuItemId, it.note, it.extraFee);
        if (merged[baseKey]) {
          merged[baseKey] = { ...merged[baseKey], qty: merged[baseKey].qty + it.qty };
        } else {
          merged[baseKey] = { ...it };
        }
      });
      items = merged;

      const _tot = computeOrderTotals(items);
      const total = _tot.total, serviceChargeAmount = _tot.serviceChargeAmount, serviceChargePercent = _tot.serviceChargePercent;
      const paidAmount = current.paidAmount || 0;
      return { ...current, items, total, serviceChargeAmount, serviceChargePercent, remainingAmount: money2(Math.max(0, total - paidAmount)) };
    }, (error, committed) => {
      if (error) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Xəta baş verdi, yenidən cəhd edin'); return; }
      if (!committed) return;
      addLog('discount', `${state.user?.name} "${t?.name}" masasında ${formatItemsList(resetItemsList)} endirim/ikramını sıfırladı`, { tableId });
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
    const isPaid = order.remainingAmount !== undefined ? order.remainingAmount <= 0.01 : false;
    if (isPaid) { showToast('<svg class="icon"><use href="#i-ban"></use></svg> Hesab ödənilmiş masada əməliyyat aparılamaz'); return; }
    

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

  /* Mərhələ 2b: əvvəl mənbə masadan çıxarılır, YALNIZ bu uğurlu olarsa hədəfə əlavə olunur (mal ikiləşmir).
     Mənbədə ödəniş/nisyə varsa, son malı köçürmək olmaz — ödənişlər itməsin (bütöv masanı köçürün). */
  _transferSingleItem(fromTableId, toTableId, itemKey, moveQty, moved) {
    return new Promise((resolve) => {
      let reject = '';
      R.tableOrders.child(fromTableId).transaction(current => {
        reject = '';
        if (!current || !current.items || !current.items[itemKey]) { reject = 'Mal artıq masada yoxdur'; return; }
        const items = { ...current.items };
        const newQty = items[itemKey].qty - moveQty;
        if (newQty < 0) { reject = 'Miqdar dəyişib'; return; }
        if (newQty === 0) delete items[itemKey]; else items[itemKey] = { ...items[itemKey], qty: newQty };
        if (!Object.keys(items).length) {
          if ((current.paidAmount || 0) > 0.001 || current.pays || current.charges) { reject = 'Bu masada ödəniş/nisyə var — son malı köçürmək olmaz. Bütöv masanı köçürün.'; return; }
          return null;
        }
        const _tot = computeOrderTotals(items);
        const total = _tot.total, serviceChargeAmount = _tot.serviceChargeAmount, serviceChargePercent = _tot.serviceChargePercent;
        const paidAmount = current.paidAmount || 0;
        return { ...current, items, total, serviceChargeAmount, serviceChargePercent, remainingAmount: money2(Math.max(0, total - paidAmount)) };
      }, (error, committed) => {
        if (error || !committed) { showToast(`<svg class="icon"><use href="#i-error"></use></svg> ${esc(moved.name)}: ${error ? 'mənbə masa yenilənmədi' : (reject || 'köçürülmədi')}`); resolve(false); return; }
        this.renderSummary(fromTableId);
        // Hədəf masa boşdursa, mal köçürüləndə həmin masa da aktivləşir (yeni sessiya başlayır)
        const toTable = state.tables.find(x => x.id === toTableId);
        const now = serverNow();
        if (toTable && !toTable.occupant) {
          R.tables.child(toTableId).transaction(t => (t && !t.occupant ? { ...t, occupant: state.user.id, activatedAt: now, sessionId: `${toTableId}_${now}` } : t), null, false);
        }
        R.tableOrders.child(toTableId).transaction(current => {
          const items = (current && current.items) ? { ...current.items } : {};
          const key = makeLineKey(moved.menuItemId, moved.note, moved.extraFee);
          if (items[key]) items[key] = { ...items[key], qty: items[key].qty + moveQty };
          else items[key] = { ...moved, qty: moveQty };
          const _tot = computeOrderTotals(items);
          const total = _tot.total, serviceChargeAmount = _tot.serviceChargeAmount, serviceChargePercent = _tot.serviceChargePercent;
          const paidAmount = (current && current.paidAmount) || 0;
          return { ...(current || {}), items, total, serviceChargeAmount, serviceChargePercent, waiterId: (current && current.waiterId) || toTable?.occupant || state.user.id, paidAmount, remainingAmount: money2(Math.max(0, total - paidAmount)), updatedAt: now };
        }, (err2) => {
          if (err2) showToast('<svg class="icon"><use href="#i-error"></use></svg> Xəta: hədəf masa yenilənmədi');
          resolve(!err2);
        }, false);
      }, false);
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

    // Mərhələ 2b: masada ödəniş/nisyə varsa, bütün malları mal-mal köçürmək olmaz (ödənişlər itərdi)
    const movesAll = Object.entries(fromOrderCheck.items || {}).every(([k, it]) => (selection[k] || 0) >= (it.qty || 0));
    if (movesAll && ((fromOrderCheck.paidAmount || 0) > 0.001 || fromOrderCheck.pays || fromOrderCheck.charges)) {
      showToast('<svg class="icon"><use href="#i-warning"></use></svg> Bu masada ödəniş/nisyə var — bütün malları köçürmək olmaz. Bütöv masanı köçürün.');
      return;
    }
    const movedList = [];
    selKeys.forEach(itemKey => {
      const it = fromOrderCheck.items[itemKey];
      if (!it) return;
      const moveQty = Math.min(selection[itemKey], it.qty);
      movedList.push({ name: it.name, qty: moveQty });
     const moved = { menuItemId: it.menuItemId, name: it.name, price: it.price, note: it.note||'', extraFee: it.extraFee||0, vatRate: it.vatRate||0, vatIncluded: it.vatIncluded };
      this._transferSingleItem(fromTableId, toTableId, itemKey, moveQty, moved);
    });

    addLog('table_transfer', `${state.user?.name} "${fromT?.name}"-dən "${toT?.name}"-ə köçürdü: ${formatItemsList(movedList)}`, { tableId: fromTableId, toTableId });
    showToast(`<svg class="icon"><use href="#i-check"></use></svg> ${formatItemsList(movedList)} → "${toT?.name}"`);
    this.clearBatchSelection();
    this.closeItemTransferModal();
  }

  // ── Bütöv masa köçürmə ──
  /* Mərhələ 2a: köçürmə BİR yazı ilə olur. Əvvəl hədəf masa transaction ilə tutulur (boş deyilsə
     köçürmə dayanır və heç nə silinmir); sonra sifariş, ödənişlər və masaların vəziyyəti birlikdə yazılır.
     Əvvəlki versiyada hədəf masa doluydusa, mənbə masanın sifarişi itə bilərdi. */
  async confirmTableTransfer(fromId, toId) {
    if (!fromId || !toId || fromId === toId) return;
    const fromT = state.tables.find(x => x.id === fromId);
    const toT = state.tables.find(x => x.id === toId);
    const originalOccupant = fromT?.occupant || state.user.id;
    const sessionId = fromT?.sessionId || `${fromId}_${serverNow()}`;
    const fail = (m) => showToast(`<svg class="icon"><use href="#i-error"></use></svg> ${m}`);
    let busy = '';
    let claim;
    try {
      claim = await R.tables.child(toId).transaction(cur => {
        busy = '';
        if (!cur) return cur;
        if (cur.occupant && cur.occupant !== '__moving') { busy = `"${cur.name || 'Hədəf'}" masası artıq açıqdır.`; return; }
        return { ...cur, occupant: '__moving', closingAt: serverNow() };
      }, undefined, false);
    } catch (e) { fail('Bağlantı xətası — köçürülmədi.'); return; }
    if (!claim.committed) { fail(busy || 'Köçürülmədi.'); return; }
    if (!claim.snapshot.val()) { fail('Hədəf masa tapılmadı.'); return; }
    const release = () => R.tables.child(toId).update({ occupant: null, closingAt: null }).catch(() => {});
    let order, toOrder;
    try {
      [order, toOrder] = await Promise.all([R.tableOrders.child(fromId).once('value').then(s => s.val()), R.tableOrders.child(toId).once('value').then(s => s.val())]);
    } catch (e) { release(); fail('Bağlantı xətası — köçürülmədi.'); return; }
    if (toOrder && toOrder.items && Object.keys(toOrder.items).length) { release(); fail(`"${toT?.name}" masasında sifariş var — köçürülmədi.`); return; }
    const upd = {
      [`tables/${toId}/occupant`]: originalOccupant, [`tables/${toId}/notes`]: fromT?.notes || '',
      [`tables/${toId}/activatedAt`]: fromT?.activatedAt || serverNow(), [`tables/${toId}/sessionId`]: sessionId,
      [`tables/${toId}/openedById`]: fromT?.openedById || null, [`tables/${toId}/openedByName`]: fromT?.openedByName || null,
      [`tables/${toId}/closingAt`]: null,
      [`tables/${fromId}/occupant`]: null, [`tables/${fromId}/notes`]: '', [`tables/${fromId}/activatedAt`]: null,
      [`tables/${fromId}/sessionId`]: null, [`tables/${fromId}/openedById`]: null, [`tables/${fromId}/openedByName`]: null,
      [`tableOrders/${fromId}`]: null,
      [`tableOrders/${toId}`]: order ? { ...order, updatedAt: serverNow() } : null
    };
    try { await db.ref().update(upd); }
    catch (e) { release(); fail('Köçürülmədi (bağlantı və ya icazə xətası). Heç nə dəyişməyib.'); return; }
    addLog('table_transfer', `${state.user.name} "${fromT?.name}" masasını "${toT?.name}"-ə köçürdü: ${formatItemsList(order?.items||{})}`, { tableId: toId, sessionId, fromTableId: fromId, toTableId: toId });
    showToast(`<svg class="icon"><use href="#i-check"></use></svg> "${fromT?.name}" → "${toT?.name}" köçürüldü`);
  }

  openItemSidePanel(tableId, itemKey) {
    const order = state.tableOrders[tableId];
    const it = order?.items?.[itemKey];
    if (!it) return;
        // Əgər artıq batch seçim varsa — onu qoruy, tək mal paneli üçün selection dəyişmə
         const order2 = state.tableOrders[tableId];
    const isPaid2 = order2 && order2.remainingAmount !== undefined
      ? order2.remainingAmount <= 0.01 : false;
    if (isPaid2) {
      showToast('<svg class="icon"><use href="#i-ban"></use></svg> Hesab ödənilmiş masada əməliyyat aparılamaz');
      return;
    }
    const existingSel = state._batchSelection || {};
    const hasBatchSel = Object.keys(existingSel).length > 0;
    if (!hasBatchSel) {
      state._batchSelection = { [itemKey]: it.qty };
    }
    const panel = document.getElementById('itemSidePanel');
    if (!panel) return;
    if (panel._outsideHandler) { document.removeEventListener('click', panel._outsideHandler); panel._outsideHandler = null; }
    document.getElementById('ispItemName').textContent  = it.name;
    document.getElementById('ispItemQty').textContent   = it.qty + ' ədəd';
    document.getElementById('ispItemPrice').textContent = ((it.price||0)*it.qty).toFixed(2) + ' ₼';
    const badges = document.getElementById('ispBadges');
    if (badges) badges.innerHTML = [
      it.compliment        ? '<span class="discount-badge" style="background:rgba(28,107,53,.15);color:var(--green);border-color:var(--green);">İKRAM</span>' : '',
      it.discountPercent>0 ? `<span class="discount-badge">-${it.discountPercent}%</span>` : '',
      it.note              ? `<span class="discount-badge" style="border-color:var(--border);color:var(--text3);">📝 ${esc(it.note)}</span>` : ''
    ].join('');
    const cancelBtn   = document.getElementById('ispCancelBtn');
    const transferBtn = document.getElementById('ispTransferBtn');
    const giftBtn     = document.getElementById('ispGiftBtn');
    const discountBtn = document.getElementById('ispDiscountBtn');
    const creditBtn   = document.getElementById('ispCreditBtn');
       const resetBtn    = document.getElementById('ispResetBtn');
    const closeBtn    = document.getElementById('ispCloseBtn');
    if (cancelBtn)   { cancelBtn.style.display   = hasPermission('order.cancel_item') ? '' : 'none'; cancelBtn.onclick   = () => { this.closeItemSidePanel(); this.openCancelReasonModal(tableId, itemKey); }; }
            if (transferBtn) {
      transferBtn.style.display = hasPermission('table.transfer') ? '' : 'none';
      transferBtn.onclick = () => {
        this._openIspQtyModal({
          title: 'Köçür',
          desc: it.name,
          max: it.qty,
          onConfirm: (n) => {
            state._batchSelection = { [itemKey]: n };
            this.closeItemSidePanel();
            this.openItemTransferModal();
          }
        });
      };
    }
                if (giftBtn) {
      giftBtn.style.display = hasPermission('order.gift') ? '' : 'none';
      giftBtn.onclick = () => {
        this._openIspQtyModal({
          title: 'İkram et',
          desc: it.name,
          max: it.qty,
          onConfirm: (n) => {
            state._batchSelection = { [itemKey]: n };
            this.closeItemSidePanel();
            this.openComplimentModal();
          }
        });
      };
    }
    if (discountBtn) {
      discountBtn.style.display = hasPermission('order.discount') ? '' : 'none';
      discountBtn.onclick = () => {
        this._openIspQtyModal({
          title: 'Endirim et',
          desc: it.name,
          max: it.qty,
          onConfirm: (n) => {
            state._batchSelection = { [itemKey]: n };
            this.closeItemSidePanel();
            this.openDiscountModal();
          }
        });
      };
    }
         if (creditBtn) {
            creditBtn.style.display = hasPermission('bill.credit') || hasPermission('bill.credit_batch') ? '' : 'none';
      creditBtn.onclick = () => {
        this._openIspQtyModal({
          title: 'Müştəriyə yaz',
          desc: it.name,
          max: it.qty,
          onConfirm: (n) => {
            state._batchSelection = { [itemKey]: n };
            this.closeItemSidePanel();
            this.openCustomerChargeModal();
          }
        });
      };
    }
         if (resetBtn) {
      const hasDiscount = it.discountPercent > 0 || it.compliment;
      resetBtn.style.display = (hasDiscount && !isPaid2 && hasPermission('order.discount')) ? '' : 'none';
      resetBtn.onclick = () => {
        state._batchSelection = { [itemKey]: it.qty };
        this.closeItemSidePanel();
        this.resetDiscount(tableId);
      };
    }
    if (closeBtn)    { closeBtn.onclick = () => this.closeItemSidePanel(); }
    panel.classList.add('open');
  }
     openBatchActionModal() {
    const tableId = state.noteTableId;
    const order = state.tableOrders[tableId];
    if (!order?.items) return;
    const sel = state._batchSelection || {};
    const selEntries = Object.entries(sel).filter(([k,v]) => v > 0 && order.items[k]);
    if (!selEntries.length) return;

    const modal = document.getElementById('batchActionModal');
    if (!modal) return;

    const listEl = document.getElementById('batchActionList');
       listEl.innerHTML = selEntries.map(([key, qty]) => {
      const it = order.items[key];
      return `<div class="bam-item" data-key="${key}">
        <div class="bam-item-header">
          <span class="bam-item-name">${esc(it.name)}</span>
          <span class="bam-item-total">Cəmi: ${it.qty} ədəd</span>
        </div>
        <div class="bam-item-qty-row">
          <button class="bam-qty-btn" data-bam-minus data-key="${key}" data-max="${it.qty}">−</button>
          <input class="bam-qty-input" type="number" min="1" max="${it.qty}" value="${Math.min(qty, it.qty)}" data-key="${key}">
          <button class="bam-qty-btn" data-bam-plus data-key="${key}" data-max="${it.qty}">+</button>
          <span class="bam-qty-max">/ ${it.qty} ədəd</span>
        </div>
      </div>`;
    }).join('');

       document.getElementById('bamTransferBtn').style.display = hasPermission('table.transfer')  ? '' : 'none';
    document.getElementById('bamCreditBtn').style.display   = hasPermission('bill.credit_batch') || hasPermission('bill.credit') ? '' : 'none';
    document.getElementById('bamGiftBtn').style.display     = hasPermission('order.gift')      || hasPermission('order.discount') ? '' : 'none';
    document.getElementById('bamDiscountBtn').style.display = hasPermission('order.batch_ops') || hasPermission('order.discount') ? '' : 'none';
    listEl.querySelectorAll('[data-bam-minus]').forEach(btn => {
      btn.addEventListener('click', () => {
        const inp = listEl.querySelector(`.bam-qty-input[data-key="${btn.dataset.key}"]`);
        inp.value = Math.max(1, parseInt(inp.value) - 1);
      });
    });
    listEl.querySelectorAll('[data-bam-plus]').forEach(btn => {
      btn.addEventListener('click', () => {
        const inp = listEl.querySelector(`.bam-qty-input[data-key="${btn.dataset.key}"]`);
        inp.value = Math.min(parseInt(btn.dataset.max), parseInt(inp.value) + 1);
      });
    });

        // Miqdar input-larını state._batchSelection-a yaz, sonra əməliyyatı aç
    const doAction = (fn) => {
      listEl.querySelectorAll('.bam-qty-input').forEach(inp => {
        const key = inp.dataset.key;
        const v = parseInt(inp.value);
        if (!isNaN(v) && v > 0) state._batchSelection[key] = v;
        else delete state._batchSelection[key];
      });
      // Boş qalan keylər selection-dan çıxarıldı, qalan keylər qorunur
      modal.classList.remove('open');
      fn();
    };

    document.getElementById('bamTransferBtn').onclick = () => doAction(() => this.openItemTransferModal());
    document.getElementById('bamCreditBtn').onclick   = () => doAction(() => this.openCustomerChargeModal());
    document.getElementById('bamGiftBtn').onclick     = () => doAction(() => this.openComplimentModal());
    document.getElementById('bamDiscountBtn').onclick = () => doAction(() => this.openDiscountModal());
    document.getElementById('bamCancelBtn').onclick   = () => modal.classList.remove('open');

        modal.classList.add('open');
  }

  _openIspQtyModal({ title, desc, max, onConfirm }) {
    const modal    = document.getElementById('ispQtyModal');
    const titleEl  = document.getElementById('ispQtyModalTitle');
    const descEl   = document.getElementById('ispQtyModalDesc');
    const input    = document.getElementById('ispQtyModalInput');
    const confirmBtn = document.getElementById('ispQtyModalConfirm');
    if (!modal) return;

    titleEl.textContent = title;
    descEl.textContent  = desc;
    input.max   = max;
    input.min   = 1;
    input.value = max; // default: hamısı

    // Əgər yalnız 1 ədəd varsa modal açmadan birbaşa davam et
    if (max === 1) { onConfirm(1); return; }

    // Köhnə listener-i sil
    const newBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);
    newBtn.addEventListener('click', () => {
      const n = parseInt(input.value);
      if (isNaN(n) || n < 1 || n > max) {
        input.style.borderColor = 'var(--red)';
        return;
      }
      input.style.borderColor = '';
      modal.classList.remove('open');
      onConfirm(n);
    });

    modal.classList.add('open');
    setTimeout(() => input.focus(), 100);
  }
    closeItemSidePanel() {
    const panel = document.getElementById('itemSidePanel');
    if (!panel) return;
    panel.classList.remove('open');
    // clearBatchSelection burada çağırılmır — selection açılan modal üçün lazımdır
    // Modal öz işini bitirəndən sonra clearBatchSelection çağırılır
  }
}

/* Nisyəni müştərinin hesabına keçirir: jurnal + balans + "keçirildi" işarəsi BİR yazı ilə (Mərhələ 2a) */
export function postCharge(tableId, chargeId, rec) {
  return db.ref().update({
    ['customerCharges/' + chargeId]: { ...rec, posted: null },
    [`customers/${rec.customerId}/balance`]: firebase.database.ServerValue.increment(rec.amount),
    [`tableOrders/${tableId}/charges/${chargeId}/posted`]: true
  });
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
    // Sürətli nağd düymələri və Enter = Təsdiqlə
    this.els.cashQuick = document.getElementById('paymentCashQuick');
    this.els.cashQuick?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cash]'); if (!b) return;
      this.els.cashGiven.value = b.dataset.cash;
      this.calcChange();
    });
    this.els.cashGiven?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.els.modal.querySelector('[data-confirm-payment]')?.click(); }
    });
  }

  /* Bu ödənişdə alınmalı məbləğ (qismən ödənişdə — qalan hissə). confirm() ilə eyni qayda. */
  _due() {
    const p = this.payment;
    return p.remainingAmount > 0 ? p.remainingAmount : p.finalTotal;
  }

  _renderCashQuick() {
    if (!this.els.cashQuick) return;
    const due = Math.round(this._due() * 100) / 100;
    const notes = [1, 5, 10, 20, 50, 100, 200].filter(n => n > due + 0.001).slice(0, 4);
    this.els.cashQuick.innerHTML = `<button type="button" class="cash-quick__b cash-quick__b--exact" data-cash="${due.toFixed(2)}">Dəqiq · ${due.toFixed(2)} ₼</button>`
      + notes.map(n => `<button type="button" class="cash-quick__b" data-cash="${n}">${n} ₼</button>`).join('');
  }

  _setBusy(on) {
    const b = this.els.modal.querySelector('[data-confirm-payment]');
    if (!b) return;
    if (on) { if (!b.dataset.label) b.dataset.label = b.innerHTML; b.disabled = true; b.classList.add('is-busy'); b.innerHTML = '<span class="yz-spin" aria-hidden="true"></span> Yazılır…'; }
    else { b.disabled = false; b.classList.remove('is-busy'); if (b.dataset.label) b.innerHTML = b.dataset.label; }
  }

  open(tableId, guestOpt = null) {
    if (!hasPermission('bill.payment_cash') && !hasPermission('bill.payment_pos')) {
      showToast('<svg class="icon"><use href="#i-ban"></use></svg> Ödəniş qəbul etmək icazəniz yoxdur'); return;
    }
    const t = state.tables.find(x => x.id === tableId);
    const order = state.tableOrders[tableId];
    if (!order || !order.total) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Bu masada aktiv sifariş yoxdur'); return; }
    const remainingCheck = (order.remainingAmount !== undefined && order.remainingAmount !== null) ? order.remainingAmount : order.total;
    if (remainingCheck <= 0.01) { showToast('<svg class="icon"><use href="#i-check"></use></svg> Bu hesab artıq tam ödənilib'); return; }
    if (!needShift()) return;   // Mərhələ 2c: açıq kassa növbəsi olmadan ödəniş qəbul edilmir

    const p = this.payment;
    p.tableId = tableId;
    p.originalTotal = order.total || 0;
    p.paidAmount = order.paidAmount || 0;
    p.finalTotal = p.discountValue ? p.finalTotal : p.originalTotal;
    p.remainingAmount = (order.remainingAmount !== undefined) ? order.remainingAmount : (p.finalTotal - p.paidAmount);
    // C18: qonağın ödənişi — məbləğ onun qalığı ilə məhdud
    p.guest = guestOpt?.guest || null;
    if (p.guest) p.remainingAmount = money2(Math.min(p.remainingAmount, Number(guestOpt.cap) || 0));
    p.type = null;

    this.els.tableName.textContent = (t ? t.name : '—') + (p.guest ? ` · ${guestOpt.label || 'Qonaq ' + p.guest}` : '');
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
    if (type === 'cash') { this._renderCashQuick(); setTimeout(() => this.els.cashGiven.focus(), 30); }
  }

  calcChange() {
    const given = parseFloat(String(this.els.cashGiven.value).replace(',', '.')) || 0;
    // Qismən ödənişdə qalan məbləğlə müqayisə olunur (əvvəl ümumi məbləğlə müqayisə edilirdi — səhv "Çatışmır" göstərirdi)
    const change = Math.round((given - this._due()) * 100) / 100;
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
    const shift = needShift();
    if (!shift) return;
    const tableId = p.tableId;
    const t = state.tables.find(x => x.id === tableId);
    const remaining = p.remainingAmount > 0 ? p.remainingAmount : p.finalTotal;

    let thisPay = 0;
    let splitBreakdown = null;
    if (p.type === 'cash') {
      const given = parseFloat(String(this.els.cashGiven.value).replace(',', '.')) || 0;
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
      discountType: p.discountType || null, discountValue: p.discountValue || 0, shiftId: shift.id,
      ...(p.guest ? { guest: p.guest } : {}),
      createdAt: serverNow(), time: azTime(serverNow()), date: azDate(serverNow())
    };
    if (p.type === 'cash') { const given = parseFloat(String(this.els.cashGiven.value).replace(',', '.'))||0; payData.cashGiven = given; payData.change = Math.max(0, given-remaining); }
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

    /* Mərhələ 2a: ödəniş və masanın balansı BİR əməliyyatla yazılır.
       Ödəniş əvvəlcə masanın sifarişinin içinə (tableOrders/{masa}/pays) transaction ilə düşür —
       ya ödəniş də, balans da yazılır, ya heç biri. İki cihaz eyni anda ödəniş alsa, ikincisi
       təzə qalığı görür və artıq ödəniş yazılmır. Sonra eyni ID ilə "payments" jurnalına
       köçürülür; köçürmə yarımçıq qalsa, masa bağlananda təkrar yazılır (eyni ID — ikiqat olmur). */
    if (this._busy) return;
    this._busy = true;
    this._setBusy(true);
    const payId = R.payments.push().key;
    const finalTotalForCalc = p.finalTotal;
    const useDiscountTotal = !!p.discountValue;
    let applied = 0, reject = '';
    R.tableOrders.child(tableId).transaction(current => {
      reject = '';
      if (!current) { reject = 'Bu masada aktiv sifariş yoxdur'; return; }
      const total = useDiscountTotal ? finalTotalForCalc : (current.total || 0);
      const paid = money2(current.paidAmount || 0);
      const freshRemaining = money2(Math.max(0, total - paid));
      if (freshRemaining <= 0.01) { reject = 'Bu hesab artıq tam ödənilib'; return; }
      let amt = money2(thisPay);
      if (amt - freshRemaining > 0.01) {
        if (p.type !== 'cash') { reject = `Qalıq dəyişib: indi ${freshRemaining.toFixed(2)} ₼ qalıb. Ödənişi yenidən açın.`; return; }
        amt = freshRemaining;   // nağd: artığı qaytarılır
      }
      applied = amt;
      const newPaid = money2(paid + amt);
      const pays = { ...(current.pays || {}) };
      pays[payId] = { ...payData, thisPay: amt, paidBefore: paid };
      const guestPaid = p.guest ? { ...(current.guestPaid || {}), [p.guest]: money2((current.guestPaid?.[p.guest] || 0) + amt) } : current.guestPaid;
      return { ...current, pays, paidAmount: newPaid, remainingAmount: money2(Math.max(0, total - newPaid)), ...(guestPaid ? { guestPaid } : {}) };
    }, (error, committed, snapshot) => {
      this._busy = false;
      this._setBusy(false);
      if (error) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Ödəniş yazılmadı (bağlantı xətası). Heç nə dəyişməyib, yenidən cəhd edin.'); return; }
      if (!committed) { showToast(`<svg class="icon"><use href="#i-warning"></use></svg> ${reject || 'Ödəniş yazılmadı'}`); this.close(); return; }
      const finalData = snapshot ? snapshot.val() : null;
      const rec = finalData?.pays?.[payId];
      if (rec) {
        if (p.type === 'cash') rec.change = Math.max(0, money2((rec.cashGiven || 0) - rec.thisPay));
        R.payments.child(payId).set(rec).catch(() => { /* masa bağlananda təkrar yazılacaq */ });
      }
      p.paidAmount = finalData ? (finalData.paidAmount || 0) : (p.paidAmount + applied);
      p.remainingAmount = finalData ? (finalData.remainingAmount || 0) : Math.max(0, finalTotalForCalc - p.paidAmount);

      const logTypeLabel = payData.splitLabel ? `${typeLabel}: ${payData.splitLabel}` : typeLabel;
      addLog('payment', `${state.user.name} ${applied.toFixed(2)} ₼ ödəniş aldı (${logTypeLabel})`, { tableId, paymentId: payId });
      this.close();

      const fullyPaid = p.remainingAmount <= 0.01;
      if (fullyPaid) p.remainingAmount = 0;
      showToast(fullyPaid
        ? `<svg class="icon"><use href="#i-check"></use></svg> Tam ödənildi: ${p.finalTotal.toFixed(2)} ₼`
        : `<svg class="icon"><use href="#i-check"></use></svg> ${applied.toFixed(2)} ₼ ödənildi. Qalan: ${p.remainingAmount.toFixed(2)} ₼`);
      if (onSettled) onSettled(fullyPaid);
    }, false);
  }
} 
