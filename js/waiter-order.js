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
  document.getElementById('orderModalTitle').textContent = `🍔 ${t ? t.name : 'Masa'}`;
  renderOrderCatTabs();
  renderOrderItemsList();
  renderOrderDraftList();
  updateOrderDraftTotal();

  // notesModal-ı bağla, tam-səhifə sifariş ekranına keç
  document.getElementById('notesModal').classList.remove('open');
  document.getElementById('waiterScreen').classList.remove('active');
  document.getElementById('orderScreen').classList.add('active');
}

function closeOrderModal() {
  document.getElementById('orderScreen').classList.remove('active');
  document.getElementById('waiterScreen').classList.add('active');
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
    el.innerHTML = '<p style="color:var(--text3);padding:10px;grid-column:1/-1;">Bu kateqoriyada mal yoxdur.</p>';
    return;
  }

  el.innerHTML = filtered.map(m => {
    const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(m.name)}&background=f39c12&color=fff&size=200`;
    const draft = state._orderDraft[m.id];
    const qty = draft?.qty || 0;

    return `<div class="order-item-card ${qty>0?'selected':''}" onclick="addOrderItemDirect('${m.id}')">
      ${qty>0 ? `<span class="order-item-qty-badge">${qty}x</span>` : ''}
      <img src="${m.photo || fallback}" alt="" onerror="this.src='${fallback}'">
      <h4>${esc(m.name)}</h4>
      <span>${Number(m.price||0).toFixed(2)} ₼</span>
    </div>`;
  }).join('');
}

/* ── Mal kartına klik = birbaşa səbətə 1 ədəd əlavə et, pəncərə açmadan ── */
function addOrderItemDirect(menuItemId) {
  const existing = state._orderDraft[menuItemId];
  if (existing) {
    existing.qty += 1;
  } else {
    state._orderDraft[menuItemId] = { qty: 1, note: '', extraFee: 0 };
  }
  renderOrderItemsList();
  renderOrderDraftList();
  updateOrderDraftTotal();
}

/* ── Səbətdəki mal sətrindəki −/+ düymələri ── */
function draftChangeQty(menuItemId, delta) {
  const draft = state._orderDraft[menuItemId];
  if (!draft) return;
  draft.qty += delta;
  if (draft.qty <= 0) {
    delete state._orderDraft[menuItemId];
  }
  renderOrderItemsList();
  renderOrderDraftList();
  updateOrderDraftTotal();
}

/* ── Aşağı yarıda seçilmiş malların siyahısı ── */
function renderOrderDraftList() {
  const el = document.getElementById('orderDraftList');
  if (!el) return;
  const keys = Object.keys(state._orderDraft);

  if (!keys.length) {
    el.innerHTML = '<p style="color:var(--text3);font-size:13px;">Hələ mal seçilməyib. Yuxarıdan mal seçin.</p>';
    return;
  }

  el.innerHTML = keys.map(menuItemId => {
    const m = state.menuItems.find(x=>x.id===menuItemId);
    if (!m) return '';
    const draft = state._orderDraft[menuItemId];
    const lineTotal = (m.price||0) * draft.qty + (draft.extraFee||0);
    return `<div class="order-summary-line" style="background:var(--card);border-radius:8px;padding:8px 10px;flex-direction:column;align-items:stretch;gap:6px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span>${esc(m.name)}${draft.note ? ` <span style="color:var(--text3);">📝</span>` : ''}</span>
        <span style="display:flex;align-items:center;gap:8px;">
          <span style="font-weight:700;">${lineTotal.toFixed(2)} ₼</span>
          <button onclick="openOrderItemDetail('${menuItemId}')" style="background:none;border:none;cursor:pointer;font-size:14px;padding:2px 4px;">✏️</button>
        </span>
      </div>
      <div class="order-item-stepper" style="justify-content:flex-start;gap:10px;">
        <button class="order-step-btn" style="width:26px;height:26px;font-size:15px;" onclick="draftChangeQty('${menuItemId}',-1)">−</button>
        <span class="order-step-qty" style="font-size:13px;min-width:18px;">${draft.qty}</span>
        <button class="order-step-btn" style="width:26px;height:26px;font-size:15px;" onclick="draftChangeQty('${menuItemId}',1)">+</button>
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
   MAL DETAL MODALI — yalnız qeyd və ekstra xərc
   (say artıq bu pəncərədən idarə olunmur, səbət sətrindəki
   −/+ düymələri ilə dəyişdirilir)
═══════════════════════════════════════════ */
function openOrderItemDetail(menuItemId) {
  const m = state.menuItems.find(x=>x.id===menuItemId);
  if (!m) return;
  state._orderDetailItemId = menuItemId;

  const draft = state._orderDraft[menuItemId] || { qty: 1, note: '', extraFee: 0 };

  const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(m.name)}&background=f39c12&color=fff&size=200`;
  document.getElementById('oid_photo').src = m.photo || fallback;
  document.getElementById('oid_photo').onerror = function(){ this.src = fallback; };
  document.getElementById('oid_name').textContent = m.name;
  document.getElementById('oid_price').textContent = Number(m.price||0).toFixed(2);
  document.getElementById('oid_note').value = draft.note || '';
  document.getElementById('oid_extraFee').value = draft.extraFee || '';

  document.getElementById('orderItemDetailModal').classList.add('open');
}

function closeOrderItemDetailModal() {
  document.getElementById('orderItemDetailModal').classList.remove('open');
  state._orderDetailItemId = null;
}

function saveOrderItemDetail() {
  const menuItemId = state._orderDetailItemId;
  if (!menuItemId) return;

  const note     = document.getElementById('oid_note').value.trim();
  const extraFee = parseFloat(document.getElementById('oid_extraFee').value) || 0;
  // Say bu pəncərədən dəyişmir — mövcud dəyəri saxlayırıq (yoxdursa, 1 ilə başlayır)
  const existingQty = state._orderDraft[menuItemId]?.qty || 1;

  state._orderDraft[menuItemId] = { qty: existingQty, note, extraFee };

  closeOrderItemDetailModal();
  renderOrderItemsList();
  renderOrderDraftList();
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
