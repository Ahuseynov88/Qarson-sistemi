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
  const items = order?.items ? Object.entries(order.items) : [];

  if (!items.length) {
    el.innerHTML = '<p style="color:var(--text3);font-size:13px;">Hələ sifariş yoxdur.</p>';
    return;
  }

  el.innerHTML = `
    <div class="order-summary-box">
      ${items.map(([itemKey, it]) => {
        const lineTotal = (it.price * it.qty) + (it.extraFee||0);
        return `
        <div class="order-summary-line" style="flex-direction:column;align-items:flex-start;gap:2px;">
          <div style="display:flex;justify-content:space-between;align-items:center;width:100%;gap:8px;">
            <span style="flex:1;">${it.qty}x ${esc(it.name)}</span>
            <span>${lineTotal.toFixed(2)} ₼</span>
            ${state.user?.role === 'admin' ? `<button onclick="cancelOrderItem('${tableId}','${itemKey}')"
              style="background:var(--red);color:white;border:none;border-radius:6px;width:22px;height:22px;font-size:13px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-weight:700;">✕</button>` : ''}
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

/* ── Qeydlər modalından artıq göndərilmiş malı iptal et ── */
function cancelOrderItem(tableId, itemKey) {
  const order = state.tableOrders[tableId];
  if (!order?.items) return;
  const it = order.items[itemKey];
  if (!it) return;

  // Həmin sətri Firebase-dən sil
  R.tableOrders.child(tableId).child('items').child(itemKey).remove();

  // Yeni cəmi hesabla (silinəndən sonra)
  const remaining = Object.entries(order.items)
    .filter(([k]) => k !== itemKey)
    .map(([, v]) => v);

  if (!remaining.length) {
    // Sifarişdə mal qalmayıb — node-u tamamilə sil
    R.tableOrders.child(tableId).remove();
  } else {
    const newTotal = remaining.reduce((sum, v) => sum + (v.price * v.qty) + (v.extraFee||0), 0);
    R.tableOrders.child(tableId).child('total').set(newTotal);
  }

  addLog('order', `${state.user?.name} "${it.name}" malını sifarişdən iptal etdi`, { tableId, menuItemId: it.menuItemId });
  showToast(`🗑️ ${it.name} sifarişdən silindi`);
  renderNoteOrderSummary(tableId);
}

/* ── Sifariş modalını aç ── */
function openOrderModal() {
  if (!state.noteTableId) return;
  state.orderTableId = state.noteTableId;
  state._orderCatFilter = 'all';

  // Draft tamamilə boş başlayır — köhnə sifariş görünmür,
  // yalnız yeni seçilən mallar görünür. Təsdiqdə köhnə + yeni birləşir.
  state._orderDraft = {};
  state._orderCancelSelection = {};

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
    // Bu mala aid bütün sətirlərin cəmi (fərqli qeyd/ekstra xərclə bölünmüş ola bilər)
    const totalQty = Object.values(state._orderDraft)
      .filter(d => d.menuItemId === m.id)
      .reduce((sum, d) => sum + d.qty, 0);

    return `<div class="order-item-card ${totalQty>0?'selected':''}" onclick="addOrderItemDirect('${m.id}')">
      ${totalQty>0 ? `<span class="order-item-qty-badge">${totalQty}x</span>` : ''}
      <img src="${m.photo || fallback}" alt="" onerror="this.src='${fallback}'">
      <h4>${esc(m.name)}</h4>
      <span>${Number(m.price||0).toFixed(2)} ₼</span>
    </div>`;
  }).join('');
}

/* ── Mal kartına klik = birbaşa səbətə 1 ədəd əlavə et, pəncərə açmadan ── */
function addOrderItemDirect(menuItemId) {
  const lineKey = makeLineKey(menuItemId, '', 0);
  const existing = state._orderDraft[lineKey];
  if (existing) {
    existing.qty += 1;
  } else {
    state._orderDraft[lineKey] = { menuItemId, qty: 1, note: '', extraFee: 0 };
  }
  renderOrderItemsList();
  renderOrderDraftList();
  updateOrderDraftTotal();
}

/* ── Kompozit açar: eyni mal, eyni qeyd+ekstra xərclə bir sətirdə birləşir;
     fərqli qeyd/ekstra xərclə isə ayrı sətir olur ── */
function makeLineKey(menuItemId, note, extraFee) {
  const safeNote = (note||'').replace(/[.#$\[\]/\s]+/g, '_');
  let hash = 0;
  for (let i = 0; i < (note||'').length; i++) { hash = ((hash << 5) - hash + note.charCodeAt(i)) | 0; }
  return `${menuItemId}__${safeNote}_${Math.abs(hash)}__${String(extraFee||0).replace('.','_')}`;
}

/* ── Səbətdəki mal sətrindəki −/+ düymələri ── */
function draftChangeQty(lineKey, delta) {
  const draft = state._orderDraft[lineKey];
  if (!draft) return;
  draft.qty += delta;
  if (draft.qty <= 0) {
    delete state._orderDraft[lineKey];
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

  el.innerHTML = keys.map(lineKey => {
    const draft = state._orderDraft[lineKey];
    const m = state.menuItems.find(x=>x.id===draft.menuItemId);
    if (!m) return '';
    const lineTotal = (m.price||0) * draft.qty + (draft.extraFee||0);
    const isChecked = state._orderCancelSelection?.[lineKey] ? 'checked' : '';

    return `<div class="draft-line-card" style="border-left:3px solid var(--green);">
      <div class="draft-line-top">
        <input type="checkbox" class="draft-cancel-box" ${isChecked} onchange="toggleDraftCancelSelect('${lineKey}')">
        <span class="draft-line-name">${esc(m.name)}</span>
        <div class="order-item-stepper" style="gap:6px;flex-shrink:0;display:flex;flex-direction:row;align-items:center;">
          <button class="order-step-btn" style="width:24px;height:24px;font-size:14px;" onclick="draftChangeQty('${lineKey}',-1)">−</button>
          <span class="order-step-qty" style="font-size:13px;min-width:14px;">${draft.qty}</span>
          <button class="order-step-btn" style="width:24px;height:24px;font-size:14px;" onclick="draftChangeQty('${lineKey}',1)">+</button>
        </div>
        <span class="draft-line-price">${lineTotal.toFixed(2)} ₼</span>
        <button onclick="openOrderItemDetail('${lineKey}')" style="background:none;border:none;cursor:pointer;font-size:14px;padding:2px 4px;">✏️</button>
      </div>
      ${draft.note ? `<div class="draft-line-sub">${esc(draft.note)}</div>` : ''}
      ${draft.extraFee ? `<div class="draft-line-sub" style="display:flex;justify-content:space-between;"><span>Ekstra Ücret</span><span>${Number(draft.extraFee).toFixed(2)} ₼</span></div>` : ''}
    </div>`;
  }).join('');
}

/* ── Sifarişi göndərmədən əvvəl seçilmiş sətirləri ləğv etmək üçün checkbox state ── */
function toggleDraftCancelSelect(lineKey) {
  if (!state._orderCancelSelection) state._orderCancelSelection = {};
  state._orderCancelSelection[lineKey] = !state._orderCancelSelection[lineKey];
  const anySelected = Object.values(state._orderCancelSelection).some(v => v);
  const btn = document.getElementById('removeSelectedBtn');
  if (btn) btn.style.display = anySelected ? 'block' : 'none';
}

/* ── İşarələnmiş sətirləri tamamilə səbətdən sil ── */
function removeSelectedDraftLines() {
  const sel = state._orderCancelSelection || {};
  Object.keys(sel).forEach(lineKey => {
    if (sel[lineKey]) delete state._orderDraft[lineKey];
  });
  state._orderCancelSelection = {};
  const btn = document.getElementById('removeSelectedBtn');
  if (btn) btn.style.display = 'none';
  renderOrderItemsList();
  renderOrderDraftList();
  updateOrderDraftTotal();
}

function updateOrderDraftTotal() {
  let total = 0;
  Object.keys(state._orderDraft).forEach(lineKey => {
    const draft = state._orderDraft[lineKey];
    const m = state.menuItems.find(x=>x.id===draft.menuItemId);
    if (m && draft) total += (m.price||0) * draft.qty + (draft.extraFee||0);
  });
  document.getElementById('orderDraftTotal').textContent = total.toFixed(2) + ' ₼';
}

/* ═══════════════════════════════════════════
   MAL DETAL MODALI — yalnız qeyd və ekstra xərc
   (say artıq bu pəncərədən idarə olunmur, səbət sətrindəki
   −/+ düymələri ilə dəyişdirilir)
═══════════════════════════════════════════ */
function openOrderItemDetail(lineKey) {
  const draft = state._orderDraft[lineKey];
  if (!draft) return;
  const m = state.menuItems.find(x=>x.id===draft.menuItemId);
  if (!m) return;
  state._orderDetailLineKey = lineKey;

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
  state._orderDetailLineKey = null;
}

function saveOrderItemDetail() {
  const oldLineKey = state._orderDetailLineKey;
  if (!oldLineKey) return;
  const oldDraft = state._orderDraft[oldLineKey];
  if (!oldDraft) return;

  const note     = document.getElementById('oid_note').value.trim();
  const extraFee = parseFloat(document.getElementById('oid_extraFee').value) || 0;
  const menuItemId = oldDraft.menuItemId;
  const qty = oldDraft.qty; // say bu pəncərədən dəyişmir, mövcud dəyəri saxlayırıq

  // Köhnə sətri sil
  delete state._orderDraft[oldLineKey];

  // Yeni qeyd/ekstra xərcə uyğun açar hesabla
  const newLineKey = makeLineKey(menuItemId, note, extraFee);

  if (state._orderDraft[newLineKey]) {
    // Artıq eyni qeyd+ekstra xərclə bir sətir var — sayları birləşdir
    state._orderDraft[newLineKey].qty += qty;
  } else {
    // Yeni, ayrıca sətir yarat
    state._orderDraft[newLineKey] = { menuItemId, qty, note, extraFee };
  }

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
    showToast('⚠️ Heç mal seçilməyib');
    return;
  }

  // Köhnə (artıq Firebase-dəki) sifarişi götür
  const existing = state.tableOrders[tableId];
  const merged = {};

  // Əvvəlcə köhnə sifariş mallarını əlavə et
  if (existing?.items) {
    Object.entries(existing.items).forEach(([key, it]) => {
      merged[key] = { ...it };
    });
  }

  // Yeni seçilən malları köhnənin üzərinə birləşdir
  draftKeys.forEach(lineKey => {
    const draft = state._orderDraft[lineKey];
    const m = state.menuItems.find(x=>x.id===draft.menuItemId);
    if (!m) return;
    const cleanKey = makeLineKey(draft.menuItemId, draft.note||'', draft.extraFee||0);
    if (merged[cleanKey]) {
      merged[cleanKey].qty += draft.qty;
    } else {
      merged[cleanKey] = {
        menuItemId: draft.menuItemId, name: m.name, price: m.price||0,
        qty: draft.qty, note: draft.note||'', extraFee: draft.extraFee||0
      };
    }
  });

  const items = merged;
  let total = 0;
  Object.values(items).forEach(it => {
    total += (it.price||0) * it.qty + (it.extraFee||0);
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
