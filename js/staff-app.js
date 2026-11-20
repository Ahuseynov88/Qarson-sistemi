/* ═══════════════════════════════════════════
   STAFF APP
   Qarson ekranının bütün hissələrini (TableBoard, OrderCart,
   ConfirmedOrder, PaymentProcessor, AuditTrail) DOM-a bağlayan controller.
   Bu fayl "Sifariş/Masa/Ödəniş nüvəsi"nin giriş nöqtəsidir.
═══════════════════════════════════════════ */
import { R, db } from './firebase-service.js';
import { state } from './state.js';
import { esc, showToast, addLog, formatItemsList, closeConfirmAction } from './utils.js';
import { printReceipt } from './printer-service.js';
import { hasPermission, requirePermission } from './permissions.js';
import { TableBoard } from './tables.js';
import { OrderCart } from './order-cart.js';
import { ConfirmedOrder, PaymentProcessor } from './billing.js';
import { AuditTrail } from './audit.js';

const $ = (id) => document.getElementById(id);

export class StaffApp {
  constructor() {
    this._transferFromTableId = null;

    this.tableBoard = new TableBoard(
      { grid: $('waiterTables'), catTabs: $('waiterCatTabs'), staffFilter: $('waiterStaffFilterRow') },
      { onTableOpen: (tableId) => this.openTableDetail(tableId) }
    );

    this.orderCart = new OrderCart(
      {
        screen: $('orderScreen'), title: $('orderModalTitle'), catTabs: $('orderCatTabs'),
        itemsList: $('orderItemsList'), draftList: $('orderDraftList'), draftTotal: $('orderDraftTotal'),
        searchInput: $('orderSearchInput')
      },
      { onClosed: () => this.tableBoard.render() }
    );

    this.confirmedOrder = new ConfirmedOrder({
      summaryEl: $('noteOrderSummary'),
      cancelReasonModal: $('cancelReasonModal'), cancelReasonItemName: $('cancelReasonItemName'), cancelReasonSelect: $('cancelReasonSelect'),
      discountModal: $('discountModal'), discountTableInfo: $('discountTableInfo'), discountValue: $('discountValue'),
      discountPreview: $('discountPreview'), discPctBtn: $('disc_pct_btn'), discFixBtn: $('disc_fix_btn'), discountValueLabel: $('discountValueLabel'),
      complimentModal: $('complimentModal'), complimentBatchInfo: $('complimentBatchInfo'),
      itemTransferModal: $('itemTransferModal'), itemTransferInfo: $('itemTransferInfo'), itemTransferBatchInfo: $('itemTransferBatchInfo'),
      itemTransferStage1: $('itemTransferStage1'), itemTransferStage2: $('itemTransferStage2'), itemTransferStage3: $('itemTransferStage3'),
      itemTransferTableGrid: $('itemTransferTableGrid'), itemTransferConfirmText: $('itemTransferConfirmText')
    });

    this.payment = new PaymentProcessor({
      modal: $('paymentModal'), tableName: $('paymentTableName'), totalAmount: $('paymentTotalAmount'),
      discountInfo: $('paymentDiscountInfo'), finalAmount: $('paymentFinalAmount'), discountRow: $('paymentDiscountRow'),
      serviceChargeRow: $('paymentServiceChargeRow'), serviceChargeLabel: $('paymentServiceChargeLabel'), serviceChargeValue: $('paymentServiceChargeValue'),
      cashSection: $('paymentCashSection'), splitSection: $('paymentSplitSection'),
      cashGiven: $('paymentCashGiven'), changeRow: $('paymentChangeRow'), change: $('paymentChange'), changeLabel: $('changeLabel'),
      splitStatus: $('splitStatus'), splitInputsWrap: $('splitInputsWrap'),
      pt_cash: $('pt_cash'), pt_pos: $('pt_pos'), pt_split: $('pt_split'), customMethodsEl: $('paymentCustomMethods')
    });

    this.audit = new AuditTrail({ modal: $('tableAuditModal'), title: $('tableAuditTitle'), list: $('tableAuditList') });

    this._bindGlobalEvents();
    this._bindStaticButtons();
  }

  // ── TableBoard-dan gələn "aktivləşdirmə/bağlama" tələbləri ──
  _bindGlobalEvents() {
    document.getElementById('confirmActionModal')?.querySelector('[data-confirm-action-cancel]')?.addEventListener('click', () => closeConfirmAction());
    document.addEventListener('table:activate-requested', (e) => {
      const t = state.tables.find(x => x.id === e.detail.tableId);
      $('confirmTableName').textContent = t?.name || '';
      $('confirmTableModal').classList.add('open');
    });
    // OrderCart-da draft (göndərilməmiş) siyahı dəyişəndə bileti yenilə
    // (göndərilmiş mallar bölməsi avtomatik yığılsın/açılsın deyə)
    document.addEventListener('order:draft-changed', () => {
      if (state.noteTableId) this.confirmedOrder.renderSummary(state.noteTableId);
    });
    // ESC: yuza-nav.js idarə edir — həmişə ən üstdəki pəncərəni bağlayır (əvvəl HTML-də birinci gələni bağlayırdı)
  }

  _bindStaticButtons() {
    // Masa aktivləşdirmə təsdiqi
    $('confirmTableModal').querySelector('[data-confirm-activate]')?.addEventListener('click', () => {
      const tableId = state.pendingTableId;
      if (!tableId) return;
      this._closeActivateModal();
      this.tableBoard.confirmActivate(tableId).then(ok => {
        showToast(ok ? '<svg class="icon"><use href="#i-check"></use></svg> Masa aktiv edildi'
          : '<svg class="icon"><use href="#i-warning"></use></svg> Bu masanı artıq başqa ofisiant açıb');
      });
    });
    $('confirmTableModal').querySelector('[data-cancel]')?.addEventListener('click', () => this._closeActivateModal());

    // Masa bağlama təsdiqi
    $('confirmCloseTableModal').querySelector('[data-confirm-close]')?.addEventListener('click', () => this._handleConfirmClose());
    $('confirmCloseTableModal').querySelector('[data-cancel]')?.addEventListener('click', () => this._closeCloseModal());

    // Masa detalı ekranı (kateqoriya+mallar+bilet+idarəetmə - hamısı bir yerdə)
    $('orderScreen').querySelector('[data-open-discount-hub]')?.addEventListener('click', () => this.confirmedOrder.openDiscountModal());
    $('orderScreen').querySelector('[data-open-transfer-hub]')?.addEventListener('click', () => this.openTableTransferModal());
    $('orderScreen').querySelector('[data-open-customer-charge-hub]')?.addEventListener('click', () => this.confirmedOrder.openCustomerChargeModal());
    $('orderScreen').querySelector('[data-open-payment-hub]')?.addEventListener('click', () => this.payment.open(state.noteTableId));
    $('orderScreen').querySelector('[data-close-table-hub]')?.addEventListener('click', () => this.requestCloseTable());
    $('orderScreen').querySelector('[data-print-bill]')?.addEventListener('click', () => this.printBill(state.noteTableId));
    $('orderScreen').querySelector('[data-open-audit]')?.addEventListener('click', () => this.audit.open(state.noteTableId));
    // ── Əsas düymə, zibil qabı, "Digər" menyusu ──
    $('ordMainBtn')?.addEventListener('click', () => this._onMainBtn());
    $('ordTrashBtn')?.addEventListener('click', () => this.confirmedOrder.openBatchCancel());
    $('ordMoreBtn')?.addEventListener('click', () => {
      const m = $('ordMoreMenu'); m.hidden = !m.hidden;
      $('ordMoreBtn').setAttribute('aria-expanded', String(!m.hidden));
    });
    $('ordMoreMenu')?.addEventListener('click', (e) => { if (e.target.closest('button') && !e.target.closest('[data-toggle-table-note]')) { $('ordMoreMenu').hidden = true; $('ordMoreBtn').setAttribute('aria-expanded', 'false'); } });
    $('batchCancelModal')?.querySelector('[data-cancel]')?.addEventListener('click', () => this.confirmedOrder.closeBatchCancel());
    $('batchCancelModal')?.querySelector('[data-confirm-batch-cancel]')?.addEventListener('click', () => this.confirmedOrder.confirmBatchCancel());
    document.addEventListener('order:draft-changed', () => queueMicrotask(() => this._updateMainBtn(state.noteTableId)));
    { const co = this.confirmedOrder, orig = co.renderSummary.bind(co);
      co.renderSummary = (id) => { const r = orig(id); this._updateMainBtn(id); return r; }; }
    $('orderScreen').querySelector('[data-close-order]')?.addEventListener('click', () => this.closeTableDetail());
    $('orderScreen').querySelector('[data-send-order]')?.addEventListener('click', () => this.orderCart.send());
    $('noteText').addEventListener('change', () => this.saveNote());
    // Masa qeydi: boşdursa gizlidir, "Qeyd" düyməsi ilə açılır
    $('orderScreen').querySelector('[data-toggle-table-note]')?.addEventListener('click', (e) => {
      const n = $('noteText'); n.hidden = !n.hidden;
      e.currentTarget.setAttribute('aria-expanded', String(!n.hidden));
      if (!n.hidden) n.focus();
    });

    // İptal səbəbi modalı
    $('cancelReasonModal').querySelector('[data-cancel]')?.addEventListener('click', () => this.confirmedOrder.closeCancelReasonModal());
    $('cancelReasonModal').querySelector('[data-confirm-cancel-reason]')?.addEventListener('click', () => this.confirmedOrder.confirmCancelWithReason());

    // Endirim modalı
    $('discountModal').querySelector('[data-cancel]')?.addEventListener('click', () => this.confirmedOrder.closeDiscountModal());
    $('discountModal').querySelector('[data-apply-discount]')?.addEventListener('click', () => this.confirmedOrder.applyDiscount());
    $('disc_pct_btn').addEventListener('click', () => this.confirmedOrder.setDiscountType('percent'));
    $('disc_fix_btn').addEventListener('click', () => this.confirmedOrder.setDiscountType('fixed'));
    $('discountValue').addEventListener('input', () => this.confirmedOrder.previewDiscount());

    // İkram modalı
    $('complimentModal').querySelector('[data-cancel]')?.addEventListener('click', () => this.confirmedOrder.closeComplimentModal());
    $('complimentModal').querySelector('[data-confirm-compliment]')?.addEventListener('click', () => this.confirmedOrder.confirmCompliment());

    // Nisyə (müştəriyə köçürmə) modalı
    $('customerChargeModal').querySelector('[data-cancel]')?.addEventListener('click', () => this.confirmedOrder.closeCustomerChargeModal());
    $('customerChargeModal').querySelector('[data-confirm-customer-charge]')?.addEventListener('click', () => this.confirmedOrder.confirmCustomerCharge());
    $('customerChargeModal').querySelector('[data-pick-charge-customer]')?.addEventListener('click', () => this.confirmedOrder.pickChargeCustomer());
    $('customerChargeModal').querySelector('[data-back-charge-stage1]')?.addEventListener('click', () => this.confirmedOrder._showChargeStage(1));

    // Mal köçürmə modalı
    $('itemTransferModal').querySelector('[data-cancel]')?.addEventListener('click', () => this.confirmedOrder.closeItemTransferModal());
    $('itemTransferModal').querySelector('[data-confirm-item-transfer]')?.addEventListener('click', () => this.confirmedOrder.confirmItemTransfer());
    $('itemTransferModal').querySelector('[data-pick-transfer-table]')?.addEventListener('click', () => this.confirmedOrder.openTransferTableGrid());
    $('itemTransferModal').querySelector('[data-back-transfer-stage1]')?.addEventListener('click', () => this.confirmedOrder._showTransferStage(1));
    $('itemTransferModal').querySelector('[data-back-transfer-stage2]')?.addEventListener('click', () => this.confirmedOrder._showTransferStage(2));

    // Masa köçürmə modalı
    $('transferModal').querySelector('[data-cancel]')?.addEventListener('click', () => this.closeTableTransferModal());
    $('transferModal').querySelector('[data-confirm-table-transfer]')?.addEventListener('click', () => this._handleConfirmTableTransfer());

    // Tarixçə modalı
    $('tableAuditModal').querySelector('[data-close-audit]')?.addEventListener('click', () => this.audit.close());

    // Ödəniş modalı
    $('paymentModal').querySelectorAll('[data-payment-type]').forEach(btn => {
      btn.addEventListener('click', () => this.payment.selectType(btn.dataset.paymentType));
    });
    $('paymentCashGiven').addEventListener('input', () => this.payment.calcChange());
    $('paymentModal').querySelector('[data-cancel]')?.addEventListener('click', () => this.payment.close());
    $('paymentModal').querySelector('[data-confirm-payment]')?.addEventListener('click', () => {
      // Tam ödənəndə: masanı bağlamaq icazəsi varsa ekranda qalır (əsas düymə "Masanı bağla" olur), yoxdursa masa lövhəsinə qayıdır
      this.payment.confirm((fullyPaid) => {
        if (!fullyPaid) return;
        if (hasPermission('table.close') && state.noteTableId) this._updateMainBtn(state.noteTableId);
        else this.closeTableDetail();
      });
    });
  }

  render() {
    this.tableBoard.render();
    // Masa detalı ekranı açıqdırsa, canlı sinxronizasiya üçün onu da yenilə
    // (başqa cihazdan gələn dəyişiklik - məs. başqa kassir ödəniş alıbsa - dərhal görünsün)
    if ($('orderScreen').classList.contains('active') && state.noteTableId) {
      this.confirmedOrder.renderSummary(state.noteTableId);
      this.orderCart.renderDraftList();
      this._updatePaymentTrigger(state.noteTableId);
    }
  }

  stop() {
    this.tableBoard.stopTimers();
  }

  /* Əsas düymə vəziyyəti:
     1) seçilmiş (göndərilməmiş) mal var  → "Sifarişi təsdiqlə" + seçilmiş malların məbləği
     2) qalıq var: ödəniş icazəsi varsa  → "Ödəniş al" + qalıq; yoxdursa → "Hesab çap et" + cəmi
     3) tam ödənilib: bağlama icazəsi varsa → "Masanı bağla"; yoxdursa → "Hesab ödənilib" (kilidli) */
  _updateMainBtn(tableId) {
    const btn = $('ordMainBtn');
    if (!btn || !tableId || tableId !== state.noteTableId) return;
    const cart = this.orderCart;
    const order = state.tableOrders[tableId];
    const draftN = Object.keys(state._orderDraft || {}).length;
    const total = order?.total || 0;
    const remaining = total ? ((order.remainingAmount !== undefined && order.remainingAmount !== null) ? order.remainingAmount : total) : 0;
    const canPay = hasPermission('bill.payment_cash') || hasPermission('bill.payment_pos') || hasPermission('bill.credit');
    const m = (n) => (Number(n) || 0).toFixed(2) + ' ₼';
    let act, label, amount, icon, cls = '';
    if (cart._pending?.[tableId]) { act = ''; label = 'Göndərilir…'; amount = ''; icon = 'refresh'; cls = 'is-busy'; }
    else if (draftN) { act = 'send'; label = 'Sifarişi təsdiqlə'; amount = m(cart.draftAmount); icon = 'check'; }
    else if (total > 0 && remaining > 0.01) {
      if (canPay) { act = 'pay'; label = 'Ödəniş al'; amount = m(remaining); icon = 'money'; cls = 'is-pay'; }
      else { act = 'print'; label = 'Hesab çap et'; amount = m(total); icon = 'printer'; cls = 'is-pay'; }
    } else if (total > 0) {
      if (hasPermission('table.close')) { act = 'close'; label = 'Masanı bağla'; amount = ''; icon = 'lock'; cls = 'is-close'; }
      else { act = ''; label = 'Hesab ödənilib'; amount = ''; icon = 'check'; cls = 'is-done'; }
    } else { act = ''; label = 'Sifarişi təsdiqlə'; amount = m(0); icon = 'check'; }
    btn.dataset.action = act;
    btn.disabled = !act;
    btn.className = 'ord-main__btn ' + cls;
    btn.querySelector('.ord-main__lbl').innerHTML = (cls === 'is-busy' ? '<span class="yz-spin" aria-hidden="true"></span>' : `<svg class="icon"><use href="#i-${icon}"></use></svg>`) + ` <span data-main-label>${label}</span>`;
    const amt = btn.querySelector('[data-main-amount]'); amt.textContent = amount; amt.hidden = !amount;
    // Zibil qabı: işarələnmiş malların sayı
    const sel = Object.entries(state._batchSelection || {}).filter(([k, q]) => q > 0 && order?.items?.[k]).length;
    const tr = $('ordTrashBtn');
    if (tr) {
      tr.hidden = !hasPermission('order.cancel_item');
      tr.classList.toggle('has-sel', sel > 0);
      const n = tr.querySelector('.ord-trash__n'); n.textContent = sel; n.hidden = !sel;
    }
  }

  _onMainBtn() {
    const act = $('ordMainBtn')?.dataset.action, id = state.noteTableId;
    if (!act || !id) return;
    if (act === 'send') this.orderCart.send();
    else if (act === 'pay') this.payment.open(id);
    else if (act === 'print') this.printBill(id);
    else if (act === 'close') this.requestCloseTable();
  }

  _updatePaymentTrigger(tableId) {
    this._updateMainBtn(tableId);
    const order = state.tableOrders[tableId];
    const canPay = hasPermission('bill.payment_cash') || hasPermission('bill.payment_pos') || hasPermission('bill.credit');
    const payBtn = $('notesPaymentBtn');
    const paid = order?.paidAmount || 0;
    const remaining = order?.total
      ? ((order.remainingAmount !== undefined && order.remainingAmount !== null) ? order.remainingAmount : order.total)
      : 0;
    if (canPay && order?.total > 0) {
      payBtn.style.display = 'flex';
      const subEl = $('notesPaymentSub');
      if (remaining <= 0.01) {
        payBtn.classList.remove('partial');
        payBtn.classList.add('paid');
        $('notesPaymentAmount').innerHTML = '<svg class="icon"><use href="#i-check"></use></svg> Ödənilib';
        subEl.style.display = 'none';
      } else {
        payBtn.classList.remove('paid');
        payBtn.classList.toggle('partial', paid > 0);
        $('notesPaymentAmount').textContent = remaining.toFixed(2) + ' ₼';
        if (paid > 0) {
          subEl.style.display = 'block';
          subEl.textContent = `${paid.toFixed(2)} ₼ ödənilib, cəmi ${order.total.toFixed(2)} ₼`;
        } else {
          subEl.style.display = 'none';
        }
      }
    } else {
      payBtn.style.display = 'none';
    }
  }

  // ── Aktivləşdirmə axını ──
  _closeActivateModal() {
    $('confirmTableModal').classList.remove('open');
    state.pendingTableId = null;
    this.tableBoard.render();
  }

  // ── Masa Detalı (kateqoriya + mallar + bilet — TƏK ekran) ──
  openTableDetail(tableId) {
    const t = state.tables.find(x => x.id === tableId);
    if (!t) return;
    if (state.noteTableId !== tableId) this.confirmedOrder.clearBatchSelection();
    state.noteTableId = tableId;

    this.orderCart.open(tableId); // title, kateqoriya tabları, mal grid-i, draft siyahısı, ekranı göstərir
    $('ticketTableName').textContent = t.name;
    $('noteText').value = t.notes || '';
    $('noteText').hidden = !(t.notes || '').trim();
    $('orderScreen').querySelector('[data-toggle-table-note]')?.setAttribute('aria-expanded', String(!$('noteText').hidden));
    this.confirmedOrder.renderSummary(tableId);

    const setVis = (id, cond) => { const el = $(id); if (el) el.style.display = cond ? '' : 'none'; };
    setVis('notesCloseTableBtn', hasPermission('table.close'));
    setVis('notesDiscountBtn', hasPermission('order.discount'));
    setVis('notesTransferBtn', hasPermission('table.transfer'));
    setVis('notesCustomerChargeBtn', hasPermission('bill.credit'));

    this._updatePaymentTrigger(tableId);
  }

  closeTableDetail() {
    this.orderCart.close(); // ekranı gizlədir, orderTableId-i sıfırlayır, masa lövhəsini yeniləyir
    state.noteTableId = null;
    this.confirmedOrder.clearBatchSelection();
  }

  saveNote() {
    if (!state.noteTableId) return;
    const notes = $('noteText').value;
    const t = state.tables.find(x => x.id === state.noteTableId);
    R.tables.child(state.noteTableId).update({ notes });
    addLog('table', `${state.user.name} "${t?.name}" masasına qeyd yazdı: ${notes.substring(0,40)}`, { waiterId: state.user.id, tableId: state.noteTableId });
    showToast('<svg class="icon"><use href="#i-check"></use></svg> Qeyd saxlanıldı');
  }

  // ── Masa bağlama axını (balans + arxiv + müştəri chat/tələb təmizliyi) ──
  requestCloseTable() {
    if (!requirePermission('table.close')) return;
    if (!state.noteTableId) return;
    const t = state.tables.find(x => x.id === state.noteTableId);
    if (!t) return;
    state.pendingCloseTableId = state.noteTableId;
    $('confirmCloseTableName').textContent = t.name;
    $('confirmCloseTableModal').classList.add('open');
  }

  async _handleConfirmClose() {
    const tableId = state.pendingCloseTableId;
    if (!tableId || this._closing) return;
    this._closing = true;
    const btn = $('confirmCloseTableModal').querySelector('[data-confirm-close]');
    if (btn) btn.disabled = true;
    const res = await this.tableBoard.confirmDeactivate(tableId);
    this._closing = false;
    if (btn) btn.disabled = false;
    if (!res.ok) {
      showToast(`<svg class="icon"><use href="#i-error"></use></svg> ${res.msg}`);
      this._closeCloseModal();
      return;
    }
    // Qeyd: masa bağlananda HEÇ BİR qeyd (müştəri tələbləri, söhbət tarixçəsi) silinmir -
    // hamısı tarixi məlumat kimi qalır. Aktiv "gözləyən" siqnallar artıq status dəyişdirilərək
    // (accept/resolve) söndürülür, ona görə köhnə masa açılanda yenidən görünmür.
    if (this.payment.payment.tableId === tableId) {
      this.payment.payment.paidAmount = 0;
      this.payment.payment.remainingAmount = 0;
      this.payment.payment.tableId = null;
    }
    showToast('<svg class="icon"><use href="#i-check"></use></svg> Masa bağlandı');
    this._closeCloseModal();
    this.closeTableDetail();
  }

  _closeCloseModal() {
    $('confirmCloseTableModal').classList.remove('open');
    state.pendingCloseTableId = null;
    this.tableBoard.render();
  }

  // ── Bütöv masa köçürmə ──
  openTableTransferModal() {
    if (!hasPermission('table.transfer')) { showToast('<svg class="icon"><use href="#i-ban"></use></svg> Masa köçürmə icazəniz yoxdur'); return; }
    const tableId = state.noteTableId;
    if (!tableId) return;
    const t = state.tables.find(x => x.id === tableId);
    this._transferFromTableId = tableId;
    const emptyTables = state.tables.filter(x => x.id !== tableId && !x.occupant);
    if (!emptyTables.length) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Köçürüləcək boş masa yoxdur'); return; }
    $('transferFromInfo').textContent = `"${t?.name||'Masa'}" masasından köçürülür`;
    $('transferToTable').innerHTML = emptyTables.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
    $('transferModal').classList.add('open');
  }

  closeTableTransferModal() { $('transferModal').classList.remove('open'); }

  _handleConfirmTableTransfer() {
    const toId = $('transferToTable').value;
    this.confirmedOrder.confirmTableTransfer(this._transferFromTableId, toId);
    this.closeTableTransferModal();
    this.closeTableDetail();
  }

  // ── Hesab çapı — printer-service.js vasitəsilə dinamik printer ──
  printBill(tableId) {
    printReceipt(tableId);
  }
}
