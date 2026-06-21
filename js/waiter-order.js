/* ═══════════════════════════════════════════
   QARSON — SİFARİŞ GÖTÜRMƏ
   Bu fayl: qarsonun bir masa üçün menyudan mal seçib sifariş
   göndərməsi. Masa qeydlər modalı (notesModal) açıq olanda
   üstünə bu sifariş modalı (orderModal) açılır.
   Firebase: /tableOrders/{tableId} = { items: {itemId:{...}}, total }
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
      ${items.map(it => `
        <div class="order-summary-line">
          <span>${it.qty}x ${esc(it.name)}</span>
          <span>${(it.price * it.qty).toFixed(2)} ₼</span>
        </div>
      `).join('')}
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
      state._orderDraft[it.menuItemId] = it.qty;
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
      style="padding:7px 14px;border-radius:18px;border:1px solid var(--border);
             background:${state._orderCatFilter===c?'var(--blue)':'transparent'};
             color:${state._orderCatFilter===c?'white':'var(--text2)'};
             font-weight:600;font-size:12px;cursor:pointer;">
      ${c === 'all' ? '🍔 Hamısı' : esc(c)}
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
    const qty = state._orderDraft[m.id] || 0;

    if (qty === 0) {
      // Hələ seçilməyib — bütün sətir klik olunabiləndir, klik = 1 ədəd əlavə et
      return `<div class="order-item-row" onclick="addOrderItem('${m.id}')">
        <img src="${m.photo || fallback}" alt="" onerror="this.src='${fallback}'">
        <div class="order-item-info">
          <h4>${esc(m.name)}</h4>
          <span>${Number(m.price||0).toFixed(2)} ₼</span>
        </div>
      </div>`;
    }

    // Seçilib — stepper göstər
    return `<div class="order-item-row" style="cursor:default;">
      <img src="${m.photo || fallback}" alt="" onerror="this.src='${fallback}'">
      <div class="order-item-info">
        <h4>${esc(m.name)}</h4>
        <span>${Number(m.price||0).toFixed(2)} ₼</span>
      </div>
      <div class="order-item-stepper">
        <button class="order-step-btn" onclick="decOrderItem('${m.id}')">−</button>
        <span class="order-step-qty">${qty}</span>
        <button class="order-step-btn" onclick="incOrderItem('${m.id}')">+</button>
      </div>
    </div>`;
  }).join('');
}

function addOrderItem(menuItemId) {
  state._orderDraft[menuItemId] = (state._orderDraft[menuItemId] || 0) + 1;
  renderOrderItemsList();
  updateOrderDraftTotal();
}

function incOrderItem(menuItemId) {
  state._orderDraft[menuItemId] = (state._orderDraft[menuItemId] || 0) + 1;
  renderOrderItemsList();
  updateOrderDraftTotal();
}

function decOrderItem(menuItemId) {
  const current = state._orderDraft[menuItemId] || 0;
  if (current <= 1) {
    delete state._orderDraft[menuItemId];
  } else {
    state._orderDraft[menuItemId] = current - 1;
  }
  renderOrderItemsList();
  updateOrderDraftTotal();
}

function updateOrderDraftTotal() {
  let total = 0;
  Object.keys(state._orderDraft).forEach(menuItemId => {
    const m = state.menuItems.find(x=>x.id===menuItemId);
    if (m) total += (m.price||0) * state._orderDraft[menuItemId];
  });
  document.getElementById('orderDraftTotal').textContent = total.toFixed(2) + ' ₼';
}

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
    const qty = state._orderDraft[menuItemId];
    const lineTotal = (m.price||0) * qty;
    total += lineTotal;
    items[menuItemId] = { menuItemId, name: m.name, price: m.price||0, qty };
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
