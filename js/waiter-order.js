/* ═══════════════════════════════════════════
   QARSON — SİFARİŞ GÖTÜRMƏ
   Bu fayl: qarsonun bir masa üçün menyudan mal seçib sifariş
   göndərməsi. Masa qeydlər modalı (notesModal) açıq olanda
   üstünə bu sifariş modalı (orderModal) açılır. Mala toxunanda
   isə üstünə "detal" modalı (orderItemDetailModal) açılır —
   orada say, qeyd, ekstra xərc tənzimlənir.
   Firebase: /tableOrders/{tableId} = { items: {itemId:{...}}, total }
   Hər item: { menuItemId, name, price, qty, note, extraFee }
═══════════════════════════════════════════ */

/* ── Qarson masa qeydlər modalını açanda, cari sifariş xülasəsini göstər ── */
function renderNoteOrderSummary(tableId) {
  const el = document.getElementById('noteOrderSummary');
  if (!el) return;
  const order = state.tableOrders[tableId];
  const items = order?.items ? Object.values(order.items) : [];

  if (!items.length) {
    el.innerHTML = '<p style="color:var(--text3);font-size:13px;">Hələ sifariş yoxdur.</p>';
    return;
  }

  el.innerHTML = `
    <div class="order-summary-box">
      ${items.map(it => {
        const lineTotal = (it.price * it.qty) + (it.extraFee||0);
        return `
        <div class="order-summary-line" style="flex-direction:column;align-items:flex-start;gap:2px;">
          <div style="display:flex;justify-content:space-between;width:100%;">
            <span>${it.qty}x ${esc(it.name)}</span>
            <span>${lineTotal.toFixed(2)} ₼</span>
          </div>
          ${it.note ? `<span style="font-size:11px;color:var(--text3);">📝 ${esc(it.note)}</span>` : ''}
        </div>`;
      }).join('')}
      <div class="order-summary-line" style="border-top:1px solid var(--border);margin-top:6px;padding-top:8px;font-weight:700;color:var(--green);">
        <span>Cəmi</span>
        <span>${(order.total||0).toFixed(2)} ₼</span>
      </div>
    </div>`;
}

/* ── Sifariş modalını aç ── */
function openOrderModal() {
  if (!state.noteTableId) return;
  state.orderTableId = state.noteTableId;
  state._orderCatFilter = 'all';

  // Mövcud sifarişi draft-a yüklə (əlavə etmək üçün, sıfırdan başlamaq əvəzinə)
  const existing = state.tableOrders[state.orderTableId];
  state._orderDraft = {};
  if (existing?.items) {
    Object.values(existing.items).forEach(it => {
      state._orderDraft[it.menuItemId] = { qty: it.qty, note: it.note||'', extraFee: it.extraFee||0 };
    });
  }

  const t = state.tables.find(x=>x.id===state.orderTableId);
  document.getElementById('orderModalTitle').textContent = `🍔 ${t ? t.name : 'Masa'} — Sifariş`;
  renderOrderCatTabs();
  renderOrderItemsList();
  updateOrderDraftTotal();
  document.getElementById('orderModal').classList.add('open');
}

function closeOrderModal() {
  document.getElementById('orderModal').classList.remove('open');
  state.orderTableId = null;
  state._orderDraft = {};
}

function renderOrderCatTabs() {
  const tabEl = document.getElementById('orderCatTabs');
  const availableItems = state.menuItems.filter(m => m.available !== false);
  const cats = ['all', ...new Set(availableItems.map(m => m.category || 'Digər'))];

  tabEl.innerHTML = cats.map(c => `
    <button onclick="setOrderCat('${esc(c)}')"
      style="padding:10px 8px;border-radius:8px;border:none;text-align:left;
             background:${state._orderCatFilter===c?'var(--brand-gradient)':'transparent'};
             color:${state._orderCatFilter===c?'white':'var(--text2)'};
             font-weight:600;font-size:12px;cursor:pointer;width:100%;">
      ${c === 'all' ? 'Hamısı' : esc(c)}
    </button>
  `).join('');
}

function setOrderCat(cat) {
  state._orderCatFilter = cat;
  renderOrderCatTabs();
  renderOrderItemsList();
}

function renderOrderItemsList() {
  const el = document.getElementById('orderItemsList');
  const availableItems = state.menuItems.filter(m => m.available !== false);

  const filtered = state._orderCatFilter === 'all'
    ? availableItems
    : availableItems.filter(m => (m.category || 'Digər') === state._orderCatFilter);

  if (!filtered.length) {
    el.innerHTML = '<p style="color:var(--text3);padding:10px;">Bu kateqoriyada mal yoxdur.</p>';
    return;
  }

  el.innerHTML = filtered.map(m => {
    const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(m.name)}&background=f39c12&color=fff&size=200`;
    const draft = state._orderDraft[m.id];
    const qty = draft?.qty || 0;

    if (qty === 0) {
      // Hələ seçilməyib — bütün sətir klik olunabiləndir, klik detal modalını açır
      return `<div class="order-item-row" onclick="openOrderItemDetail('${m.id}')">
        <img src="${m.photo || fallback}" alt="" onerror="this.src='${fallback}'">
        <div class="order-item-info">
          <h4>${esc(m.name)}</h4>
          <span>${Number(m.price||0).toFixed(2)} ₼</span>
        </div>
      </div>`;
    }

    // Seçilib — say, qeyd işarəsi göstər, sətrə yenidən klik = detalı redaktə et
    return `<div class="order-item-row" onclick="openOrderItemDetail('${m.id}')">
      <img src="${m.photo || fallback}" alt="" onerror="this.src='${fallback}'">
      <div class="order-item-info">
        <h4>${esc(m.name)}</h4>
        <span>${Number(m.price||0).toFixed(2)} ₼</span>
        ${draft.note ? `<div style="font-size:11px;color:var(--text3);margin-top:2px;">📝 ${esc(draft.note.substring(0,30))}${draft.note.length>30?'…':''}</div>` : ''}
      </div>
      <div class="order-item-stepper">
        <span class="order-step-qty" style="background:var(--green);color:white;border-radius:8px;padding:4px 10px;">${qty}x</span>
      </div>
    </div>`;
  }).join('');
}

function updateOrderDraftTotal() {
  let total = 0;
  Object.keys(state._orderDraft).forEach(menuItemId => {
    const m = state.menuItems.find(x=>x.id===menuItemId);
    const draft = state._orderDraft[menuItemId];
    if (m && draft) total += (m.price||0) * draft.qty + (draft.extraFee||0);
  });
  document.getElementById('orderDraftTotal').textContent = total.toFixed(2) + ' ₼';
}

/* ═══════════════════════════════════════════
   MAL DETAL MODALI — say, qeyd, ekstra xərc
═══════════════════════════════════════════ */
function openOrderItemDetail(menuItemId) {
  const m = state.menuItems.find(x=>x.id===menuItemId);
  if (!m) return;
  state._orderDetailItemId = menuItemId;

  const draft = state._orderDraft[menuItemId] || { qty: 1, note: '', extraFee: 0 };
  // Yeni mal seçilirsə, default say 1-dir (RestoMenum-dakı kimi)
  const startQty = state._orderDraft[menuItemId] ? draft.qty : 1;

  const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(m.name)}&background=f39c12&color=fff&size=200`;
  document.getElementById('oid_photo').src = m.photo || fallback;
  document.getElementById('oid_photo').onerror = function(){ this.src = fallback; };
  document.getElementById('oid_name').textContent = m.name;
  document.getElementById('oid_price').textContent = Number(m.price||0).toFixed(2);
  document.getElementById('oid_qty').textContent = startQty;
  document.getElementById('oid_note').value = draft.note || '';
  document.getElementById('oid_extraFee').value = draft.extraFee || '';

  // Sürətli rəqəm düymələri (1-5)
  document.getElementById('oid_quickQty').innerHTML = [1,2,3,4,5].map(n => `
    <button class="order-step-btn" style="width:38px;height:38px;" onclick="oidSetQty(${n})">${n}</button>
  `).join('');

  document.getElementById('orderItemDetailModal').classList.add('open');
}

function closeOrderItemDetailModal() {
  document.getElementById('orderItemDetailModal').classList.remove('open');
  state._orderDetailItemId = null;
}

function oidChangeQty(delta) {
  const el = document.getElementById('oid_qty');
  const current = parseInt(el.textContent) || 1;
  const next = Math.max(1, current + delta);
  el.textContent = next;
}

function oidSetQty(n) {
  document.getElementById('oid_qty').textContent = n;
}

function saveOrderItemDetail() {
  const menuItemId = state._orderDetailItemId;
  if (!menuItemId) return;

  const qty      = parseInt(document.getElementById('oid_qty').textContent) || 1;
  const note     = document.getElementById('oid_note').value.trim();
  const extraFee = parseFloat(document.getElementById('oid_extraFee').value) || 0;

  state._orderDraft[menuItemId] = { qty, note, extraFee };

  closeOrderItemDetailModal();
  renderOrderItemsList();
  updateOrderDraftTotal();
}

/* ── Sifarişi Firebase-ə göndər ── */
function confirmSendOrder() {
  const tableId = state.orderTableId;
  if (!tableId) return;

  const draftKeys = Object.keys(state._orderDraft);
  const t = state.tables.find(x=>x.id===tableId);

  if (!draftKeys.length) {
    // Səbət boşdur — mövcud sifarişi tamamilə sil
    R.tableOrders.child(tableId).remove();
    addLog('order', `${state.user.name} "${t?.name}" masasının sifarişini sildi`, { waiterId: state.user.id, tableId });
    showToast('🗑️ Sifariş silindi');
    closeOrderModal();
    return;
  }

  const items = {};
  let total = 0;
  draftKeys.forEach(menuItemId => {
    const m = state.menuItems.find(x=>x.id===menuItemId);
    if (!m) return; // mal silinmiş ola bilər
    const draft = state._orderDraft[menuItemId];
    const lineTotal = (m.price||0) * draft.qty + (draft.extraFee||0);
    total += lineTotal;
    items[menuItemId] = {
      menuItemId, name: m.name, price: m.price||0,
      qty: draft.qty, note: draft.note||'', extraFee: draft.extraFee||0
    };
  });

  R.tableOrders.child(tableId).set({
    items,
    total,
    waiterId: state.user.id,
    updatedAt: Date.now()
  });

  addLog('order', `${state.user.name} "${t?.name}" masası üçün sifariş göndərdi (${total.toFixed(2)} ₼)`, { waiterId: state.user.id, tableId });
  showToast('✅ Sifariş göndərildi');
  closeOrderModal();
}
