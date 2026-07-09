/* ═══════════════════════════════════════════
   STAFF APP
   Qarson ekranının bütün hissələrini (TableBoard, OrderCart,
   ConfirmedOrder, PaymentProcessor, AuditTrail) DOM-a bağlayan controller.
   Bu fayl "Sifariş/Masa/Ödəniş nüvəsi"nin giriş nöqtəsidir.
═══════════════════════════════════════════ */
import { R, db } from './firebase-service.js';
import { state } from './state.js';
import { esc, showToast, addLog } from './utils.js';
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
      { onTableOpen: (tableId) => this.openNotesHub(tableId) }
    );

    this.orderCart = new OrderCart(
      {
        screen: $('orderScreen'), title: $('orderModalTitle'), catTabs: $('orderCatTabs'),
        itemsList: $('orderItemsList'), draftList: $('orderDraftList'), draftTotal: $('orderDraftTotal'),
        removeSelectedBtn: $('removeSelectedBtn')
      },
      { onClosed: () => this.tableBoard.render() }
    );

    this.confirmedOrder = new ConfirmedOrder({
      summaryEl: $('noteOrderSummary'),
      cancelReasonModal: $('cancelReasonModal'), cancelReasonItemName: $('cancelReasonItemName'), cancelReasonSelect: $('cancelReasonSelect'),
      discountModal: $('discountModal'), discountTableInfo: $('discountTableInfo'), discountValue: $('discountValue'),
      discountPreview: $('discountPreview'), discPctBtn: $('disc_pct_btn'), discFixBtn: $('disc_fix_btn'), discountValueLabel: $('discountValueLabel'),
      complimentModal: $('complimentModal'), complimentPickWrap: $('complimentPickWrap'), complimentItem: $('complimentItem'), complimentBatchInfo: $('complimentBatchInfo'),
      itemTransferModal: $('itemTransferModal'), itemTransferInfo: $('itemTransferInfo'), itemTransferPickWrap: $('itemTransferPickWrap'),
      itemTransferItem: $('itemTransferItem'), itemTransferBatchInfo: $('itemTransferBatchInfo'), itemTransferQtyWrap: $('itemTransferQtyWrap'),
      itemTransferQty: $('itemTransferQty'), itemTransferToTable: $('itemTransferToTable')
    });

    this.payment = new PaymentProcessor({
      modal: $('paymentModal'), tableName: $('paymentTableName'), totalAmount: $('paymentTotalAmount'),
      discountInfo: $('paymentDiscountInfo'), finalAmount: $('paymentFinalAmount'), discountRow: $('paymentDiscountRow'),
      cashSection: $('paymentCashSection'), splitSection: $('paymentSplitSection'), creditSection: $('paymentCreditSection'),
      cashGiven: $('paymentCashGiven'), changeRow: $('paymentChangeRow'), change: $('paymentChange'), changeLabel: $('changeLabel'),
      splitCash: $('splitCash'), splitPos: $('splitPos'), splitStatus: $('splitStatus'), creditName: $('creditName'),
      pt_cash: $('pt_cash'), pt_pos: $('pt_pos'), pt_credit: $('pt_credit'), pt_split: $('pt_split')
    });

    this.audit = new AuditTrail({ modal: $('tableAuditModal'), title: $('tableAuditTitle'), list: $('tableAuditList') });

    this._bindGlobalEvents();
    this._bindStaticButtons();
  }

  // ── TableBoard-dan gələn "aktivləşdirmə/bağlama" tələbləri ──
  _bindGlobalEvents() {
    document.addEventListener('table:activate-requested', (e) => {
      const t = state.tables.find(x => x.id === e.detail.tableId);
      $('confirmTableName').textContent = t?.name || '';
      $('confirmTableModal').classList.add('open');
    });
  }

  _bindStaticButtons() {
    // Masa aktivləşdirmə təsdiqi
    $('confirmTableModal').querySelector('[data-confirm-activate]')?.addEventListener('click', () => {
      const tableId = state.pendingTableId;
      if (!tableId) return;
      this.tableBoard.confirmActivate(tableId);
      showToast('<svg class="icon"><use href="#i-check"></use></svg> Masa aktiv edildi');
      this._closeActivateModal();
    });
    $('confirmTableModal').querySelector('[data-cancel]')?.addEventListener('click', () => this._closeActivateModal());

    // Masa bağlama təsdiqi
    $('confirmCloseTableModal').querySelector('[data-confirm-close]')?.addEventListener('click', () => this._handleConfirmClose());
    $('confirmCloseTableModal').querySelector('[data-cancel]')?.addEventListener('click', () => this._closeCloseModal());

    // Qeydlər (notes) hub-u
    $('notesModal').querySelector('[data-close-notes]')?.addEventListener('click', () => this.closeNotesHub());
    $('notesModal').querySelector('[data-save-note]')?.addEventListener('click', () => this.saveNote());
    $('notesModal').querySelector('[data-open-order]')?.addEventListener('click', () => this.orderCart.open(state.noteTableId));
    $('notesModal').querySelector('[data-open-discount-hub]')?.addEventListener('click', () => this.confirmedOrder.openDiscountModal());
    $('notesModal').querySelector('[data-open-transfer-hub]')?.addEventListener('click', () => this.openTableTransferModal());
    $('notesModal').querySelector('[data-open-item-transfer-hub]')?.addEventListener('click', () => this.confirmedOrder.openItemTransferModal());
    $('notesModal').querySelector('[data-open-compliment-hub]')?.addEventListener('click', () => this.confirmedOrder.openComplimentModal());
    $('notesModal').querySelector('[data-open-payment-hub]')?.addEventListener('click', () => this.payment.open(state.noteTableId));
    $('notesModal').querySelector('[data-close-table-hub]')?.addEventListener('click', () => this.requestCloseTable());
    $('notesModal').querySelector('[data-print-bill]')?.addEventListener('click', () => this.printBill(state.noteTableId));
    $('notesModal').querySelector('[data-open-audit]')?.addEventListener('click', () => this.audit.open(state.noteTableId));

    // Sifariş ekranı
    $('orderScreen').querySelector('[data-close-order]')?.addEventListener('click', () => this.orderCart.close());
    $('orderScreen').querySelector('[data-send-order]')?.addEventListener('click', () => this.orderCart.send());

    // İptal səbəbi modalı
    $('cancelReasonModal').querySelector('[data-cancel]')?.addEventListener('click', () => this.confirmedOrder.closeCancelReasonModal());
    $('cancelReasonModal').querySelector('[data-confirm-cancel-reason]')?.addEventListener('click', () => this.confirmedOrder.confirmCancelWithReason());

    // Endirim modalı
    $('discountModal').querySelector('[data-cancel]')?.addEventListener('click', () => this.confirmedOrder.closeDiscountModal());
    $('discountModal').querySelector('[data-apply-discount]')?.addEventListener('click', () => this.confirmedOrder.applyDiscount(this.payment.payment));
    $('disc_pct_btn').addEventListener('click', () => this.confirmedOrder.setDiscountType('percent'));
    $('disc_fix_btn').addEventListener('click', () => this.confirmedOrder.setDiscountType('fixed'));
    $('discountValue').addEventListener('input', () => this.confirmedOrder.previewDiscount());

    // İkram modalı
    $('complimentModal').querySelector('[data-cancel]')?.addEventListener('click', () => this.confirmedOrder.closeComplimentModal());
    $('complimentModal').querySelector('[data-confirm-compliment]')?.addEventListener('click', () => this.confirmedOrder.confirmCompliment());

    // Mal köçürmə modalı
    $('itemTransferModal').querySelector('[data-cancel]')?.addEventListener('click', () => this.confirmedOrder.closeItemTransferModal());
    $('itemTransferModal').querySelector('[data-confirm-item-transfer]')?.addEventListener('click', () => this.confirmedOrder.confirmItemTransfer());

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
    $('splitCash').addEventListener('input', () => this.payment.calcSplit());
    $('splitPos').addEventListener('input', () => this.payment.calcSplit());
    $('paymentModal').querySelector('[data-cancel]')?.addEventListener('click', () => this.payment.close());
    $('paymentModal').querySelector('[data-confirm-payment]')?.addEventListener('click', () => {
      this.payment.confirm((fullyPaid) => { if (fullyPaid) this.closeNotesHub(); });
    });
  }

  render() {
    this.tableBoard.render();
  }

  stop() {
    this.tableBoard.stopTimers();
  }

  // ── Aktivləşdirmə axını ──
  _closeActivateModal() {
    $('confirmTableModal').classList.remove('open');
    state.pendingTableId = null;
    this.tableBoard.render();
  }

  // ── Qeydlər (Notes) Hub ──
  openNotesHub(tableId) {
    const t = state.tables.find(x => x.id === tableId);
    if (!t) return;
    if (state.noteTableId !== tableId) this.confirmedOrder.clearBatchSelection();
    state.noteTableId = tableId;
    $('noteTitle').innerHTML = '<svg class="icon"><use href="#i-note"></use></svg> ' + esc(t.name) + ' — Qeydlər';
    $('noteText').value = t.notes || '';
    this.confirmedOrder.renderSummary(tableId);

    const setVis = (id, cond) => { const el = $(id); if (el) el.style.display = cond ? '' : 'none'; };
    setVis('notesCloseTableBtn', hasPermission('table.close'));
    setVis('notesDiscountBtn', hasPermission('order.discount'));
    setVis('notesTransferBtn', hasPermission('table.transfer'));
    setVis('notesItemTransferBtn', hasPermission('table.transfer'));
    setVis('notesPaymentBtn', hasPermission('bill.payment_cash') || hasPermission('bill.payment_pos') || hasPermission('bill.credit'));
    setVis('notesComplimentBtn', hasPermission('order.discount'));

    $('notesModal').classList.add('open');
  }

  closeNotesHub() {
    $('notesModal').classList.remove('open');
    state.noteTableId = null;
    this.tableBoard.render();
  }

  saveNote() {
    if (!state.noteTableId) return;
    const notes = $('noteText').value;
    const t = state.tables.find(x => x.id === state.noteTableId);
    R.tables.child(state.noteTableId).update({ notes });
    addLog('table', `${state.user.name} "${t?.name}" masasına qeyd yazdı: ${notes.substring(0,40)}`, { waiterId: state.user.id, tableId: state.noteTableId });
    this.closeNotesHub();
    showToast('<svg class="icon"><use href="#i-check"></use></svg> Qeyd saxlanıldı');
  }

  // ── Masa bağlama axını (balans + arxiv + müştəri chat/tələb təmizliyi) ──
  requestCloseTable() {
    if (!requirePermission('table.close')) return;
    if (!state.noteTableId) return;
    const t = state.tables.find(x => x.id === state.noteTableId);
    if (!t) return;
    state.pendingCloseTableId = state.noteTableId;
    this.closeNotesHub();
    $('confirmCloseTableName').textContent = t.name;
    $('confirmCloseTableModal').classList.add('open');
  }

  _handleConfirmClose() {
    const tableId = state.pendingCloseTableId;
    if (!tableId) return;
    const ok = this.tableBoard.confirmDeactivate(tableId);
    if (!ok) {
      showToast('<svg class="icon"><use href="#i-error"></use></svg> Hesab tam ödənilməyib! Əvvəlcə ödəniş alın.');
      this._closeCloseModal();
      return;
    }
    // Müştəri tələblərini və söhbəti təmizlə (chat/customerRequests bu nüvənin hissəsi deyil,
    // amma orfan məlumat qalmasın deyə burada təmizlənir)
    db.ref('customerRequests').orderByChild('tableId').equalTo(tableId).once('value', snap => { snap.forEach(child => child.ref.remove()); });
    db.ref('chats/' + tableId).remove();
    if (this.payment.payment.tableId === tableId) {
      this.payment.payment.paidAmount = 0;
      this.payment.payment.remainingAmount = 0;
      this.payment.payment.tableId = null;
    }
    showToast('<svg class="icon"><use href="#i-check"></use></svg> Masa bağlandı');
    this._closeCloseModal();
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
    this.closeNotesHub();
  }

  // ── Hesab çapı ──
  printBill(tableId) {
    if (!tableId) return;
    const t = state.tables.find(x => x.id === tableId);
    const order = state.tableOrders[tableId];
    const waiterName = state.user?.name || '—';
    const now = new Date();
    const timeStr = now.toLocaleTimeString('az-AZ', {hour:'2-digit', minute:'2-digit'});
    const dateStr = now.toLocaleDateString('az-AZ');
    const items = order?.items ? Object.values(order.items) : [];
    const total = order?.total || 0;
    const itemRows = items.length ? items.map(it => {
      const lineTotal = (it.price * it.qty * (1-((it.discountPercent||0)/100))) + (it.extraFee||0);
      const tag = it.compliment ? ' [İKRAM]' : (it.discountPercent>0 ? ` [-${it.discountPercent}%]` : '');
      return `<tr><td style="padding:4px 0;">${it.qty}x ${it.name}${tag}${it.note?` <em style="font-size:11px;color:#666;">(${it.note})</em>`:''}</td><td style="text-align:right;padding:4px 0;">${lineTotal.toFixed(2)} ₼</td></tr>`;
    }).join('') : '<tr><td colspan="2" style="color:#999;font-style:italic;">Sifariş yoxdur</td></tr>';

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Hesab — ${t?.name||'Masa'}</title><style>body{font-family:'Courier New',monospace;max-width:300px;margin:0 auto;padding:20px;font-size:14px;}h2{text-align:center;font-size:18px;margin:0 0 4px;}.center{text-align:center;}.line{border-top:1px dashed #000;margin:10px 0;}table{width:100%;border-collapse:collapse;}.total{font-size:18px;font-weight:bold;}@media print{body{padding:0;}}</style></head><body><h2>Restoran</h2><p class="center" style="margin:0;font-size:12px;">${dateStr} ${timeStr}</p><div class="line"></div><p style="margin:4px 0;"><strong>Masa:</strong> ${t?.name||'—'}</p><p style="margin:4px 0;"><strong>Qarson:</strong> ${waiterName}</p><div class="line"></div><table>${itemRows}</table><div class="line"></div><table><tr class="total"><td>CƏMİ:</td><td style="text-align:right;">${total.toFixed(2)} ₼</td></tr></table><div class="line"></div><p class="center" style="font-size:12px;margin-top:10px;">Təşəkkür edirik!</p><script>window.onload=()=>{window.print();}<\/script></body></html>`;

    const w = window.open('', '_blank', 'width=340,height=600');
    if (w) {
      w.document.write(html); w.document.close();
      addLog('order', `${waiterName} "${t?.name}" masası üçün hesab çap etdi`, { tableId, waiterId: state.user?.id });
    } else {
      showToast('<svg class="icon"><use href="#i-error"></use></svg> Çap pəncərəsi bloklandı. Brauzer icazəsini yoxlayın.');
    }
  }
}
