/* ═══════════════════════════════════════════
   CUSTOMER (MÜŞTƏRİ) PANELİ + QARSON-MÜŞTƏRİ SÖHBƏTİ
   Məntiq orijinaldan dəyişmədən köçürülüb - yalnız modula ayrılıb.
   Mövcud HTML `onclick=""` atributları ilə işlədiyi üçün funksiyalar
   `window`-a təyin edilir (bax: son sətirlər).
═══════════════════════════════════════════ */
import { R, db } from './firebase-service.js';
import { state } from './state.js';
import { esc, toArr, showToast, showCustomerToast, addLog } from './utils.js';
import { triggerCustomerAlarm } from './alarm.js';
import { renderFeedbackSection } from './admin.js';

export function initCustomerRequestListener() {
  db.ref('customerRequests').orderByChild('status').equalTo('pending').on('value', snap => {
    const data = snap.val() || {};
    const list = Object.keys(data).map(k=>({id:k,...data[k]}));
    if (state.user?.role === 'staff') {
      list.forEach(r => {
        const t = state.tables.find(x=>x.id===r.tableId);
        if (t && t.occupant === state.user.id) triggerCustomerAlarm(r);
      });
    }
    if (state.user?.role === 'admin') renderFeedbackSection();
  });

  db.ref('feedbacks').orderByChild('createdAt').limitToLast(50).on('value', snap => {
    const data = snap.val() || {};
    const list = Object.keys(data).map(k=>({id:k,...data[k]})).reverse();
    if (state.user?.role === 'admin') state._feedbacks = list;
  });
}

export function checkCustomerMode() {
  const params = new URLSearchParams(location.search);
  const tableId = params.get('table');
  if (!tableId) return;

  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('customerScreen').classList.add('active');

  R.tables.child(tableId).on('value', snap => {
    const t = snap.val();
    if (!t) { showCustomerClosedScreen('<svg class="icon"><use href="#i-error"></use></svg> Masa tapılmadı'); return; }
    if (t.occupant) {
      document.getElementById('customerInactiveOverlay').classList.remove('show');
      document.getElementById('customerTableName').textContent = t.name || 'Masa';
      showCustomerWaiterCard(t.occupant);
      if (!window._customerTableId) {
        window._customerTableId = tableId;
        window._customerTableData = t;
        initCustomerChat(tableId);
        R.tableOrders.child(tableId).on('value', s => renderCustomerOrder(s.val()));
      }
      return;
    }
    document.getElementById('customerTableName').textContent = t.name || 'Masa';
    document.getElementById('customerInactiveOverlay').classList.add('show');
    if (window._customerTableId) {
      window._customerTableId = null;
      window._customerTableData = null;
      db.ref('chats/' + tableId).off();
      R.tableOrders.child(tableId).off();
      showCustomerClosedScreen('<svg class="icon"><use href="#i-thanks"></use></svg> Masa bağlandı. Yenidən gəlməyinizi gözləyirik!');
    }
  });
}

export function renderCustomerOrder(order) {
  const section = document.getElementById('custOrderSection');
  const list = document.getElementById('custOrderList');
  if (!section || !list) return;

  const items = order?.items ? Object.values(order.items) : [];
  if (!items.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';

  list.innerHTML = items.map(it => {
    const lineTotal = (it.price||0) * it.qty * (1-((it.discountPercent||0)/100)) + (it.extraFee||0);
    return `<div class="cust-order-line">
      <div class="cust-order-line__row">
        <span class="cust-order-line__name">${esc(it.name)} <span class="cust-order-line__qty">×${it.qty}</span></span>
        <span class="cust-order-line__price">${lineTotal.toFixed(2)} ₼</span>
      </div>
      ${(it.note || it.compliment || it.discountPercent>0) ? `<div class="cust-order-line__tags">
        ${it.note ? `<span class="discount-badge" style="background:transparent;border-color:var(--border);color:var(--text3);"><svg class="icon"><use href="#i-note"></use></svg> ${esc(it.note)}</span>` : ''}
        ${it.compliment ? `<span class="discount-badge" style="background:rgba(28,107,53,.15);color:var(--green);border-color:var(--green);">İKRAM</span>` : ''}
        ${(it.discountPercent>0) ? `<span class="discount-badge">-${it.discountPercent}%</span>` : ''}
      </div>` : ''}
    </div>`;
  }).join('');

  const total = order.total || 0;
  const paid = order.paidAmount || 0;
  const scAmount = order.serviceChargeAmount || 0;
  const scPercent = order.serviceChargePercent || 0;
  list.innerHTML += `${scAmount > 0 ? `<div class="cust-order-line">
    <div class="cust-order-line__row">
      <span class="cust-order-line__qty">Xidmət haqqı (${scPercent}%)</span>
      <span class="cust-order-line__price">${scAmount.toFixed(2)} ₼</span>
    </div>
  </div>` : ''}
  <div class="cust-order-total">
    <span class="cust-order-total__label">Cəmi</span>
    <span class="cust-order-total__value">${total.toFixed(2)} ₼</span>
  </div>
  ${paid > 0 ? `<div class="cust-order-paid-row"><span>Ödənilib: ${paid.toFixed(2)} ₼</span><span>Qalıq: ${Math.max(0,total-paid).toFixed(2)} ₼</span></div>` : ''}`;
}

export function showCustomerWaiterCard(waiterId) {
  if (!waiterId) return;
  R.staff.child(waiterId).once('value', snap => {
    const w = snap.val();
    if (!w) return;
    const card = document.getElementById('custWaiterCard');
    const avatar = document.getElementById('custWaiterAvatar');
    const name = document.getElementById('custWaiterName');
    if (!card) return;
    const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(w.name||'?')}&background=2ecc71&color=fff&size=200`;
    avatar.src = w.avatar || fallback;
    avatar.onerror = () => { avatar.src = fallback; };
    name.textContent = w.name || '—';
    card.style.display = 'flex';
  });
}

export function openCustomerPanel(tableId, tableData) {
  window._customerTableId = tableId;
  window._customerTableData = tableData;
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('customerScreen').classList.add('active');
  document.getElementById('customerTableName').textContent = tableData.name || 'Masa';
}

export function showCustomerClosedScreen(msg) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const screen = document.getElementById('customerScreen');
  screen.classList.add('active');
  const wrap = screen.querySelector('div');
  if (wrap) {
    wrap.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:30px;"><div style="font-size:72px;margin-bottom:20px;"><svg class="icon"><use href="#i-thanks"></use></svg></div><p style="color:#eee;font-size:20px;font-weight:600;line-height:1.6;">${msg}</p></div>`;
  }
}

export function openMenu() {
  db.ref('settings/menuUrl').once('value', snap => {
    const url = snap.val();
    if (!url) { showCustomerToast('<svg class="icon"><use href="#i-warning"></use></svg> Menyu hələ əlavə edilməyib'); return; }
    window.open(url, '_blank');
  });
}

export function customerAction(type) {
  const tableId = window._customerTableId;
  const t = window._customerTableData;
  if (!tableId || !t) return;
  const currentTable = state.tables.find(x=>x.id===tableId);
  const occupantId = currentTable?.occupant || t.occupant;
  const messages = {
    call: { text:`${t.name} sizi çağırır!`, type:'call' },
    bill_cash: { text:`${t.name} nağd hesab istəyir`, type:'bill_cash' },
    bill_pos: { text:`${t.name} POS hesab istəyir`, type:'bill_pos' }
  };
  const m = messages[type];
  if (!m) return;
  db.ref('customerRequests').push({
    tableId, tableName: t.name, type: m.type, message: m.text, waiterId: occupantId || null,
    status: 'pending', time: new Date().toLocaleTimeString('az-AZ'), createdAt: Date.now()
  });
  const typeLabels = { call: 'çağırış', bill_cash: 'nağd ödəniş istəyi', bill_pos: 'POS ilə ödəniş istəyi' };
  addLog('customer',`"${t.name}" masasından ${typeLabels[type]||type} tələbi`,{ tableId, type });
  const icons = { call:'<svg class="icon"><use href="#i-bell"></use></svg>', bill_cash:'<svg class="icon"><use href="#i-cash"></use></svg>', bill_pos:'<svg class="icon"><use href="#i-card"></use></svg>' };
  showCustomerToast(`${icons[type]||'<svg class="icon"><use href="#i-megaphone"></use></svg>'} Bildiriş göndərildi!`);
}

export function initCustomerChat(tableId) {
  db.ref(`chats/${tableId}/messages`).on('value', snap => { renderCustomerChatMsgs(snap.val() || {}); });
}

export function renderCustomerChatMsgs(msgsObj) {
  const currentSessionId = window._customerTableData?.sessionId || null;
  // Yalnız CARİ sessiyaya aid mesajlar göstərilir - masa bağlanıb yeni müştəri
  // oturanda köhnə söhbət görünməsin deyə (qeyd Firebase-də qalır, sadəcə gizlədilir)
  const msgs = toArr(msgsObj).filter(m => !currentSessionId || m.sessionId === currentSessionId).sort((a,b)=>a.createdAt-b.createdAt);
  const el = document.getElementById('custMsgList');
  el.innerHTML = msgs.map(m=>`
    <div class="cust-bubble ${m.sender}">
      ${m.sender==='waiter'?`<span style="font-size:11px;font-weight:700;display:block;margin-bottom:2px;">${esc(m.senderName||'Qarson')}</span>`:''}
      ${esc(m.text)}<span style="font-size:10px;opacity:.6;margin-left:8px;">${m.time||''}</span>
    </div>
  `).join('');
  el.scrollTop = el.scrollHeight;
}

export function sendCustomerMsg() {
  const text = document.getElementById('custMsgInput').value.trim();
  const tableId = window._customerTableId;
  const t = window._customerTableData;
  if (!text || !tableId) return;
  const ref = db.ref(`chats/${tableId}/messages`).push();
  ref.set({ sender: 'customer', text, time: new Date().toLocaleTimeString('az-AZ'), createdAt: Date.now(), readByWaiter: false, sessionId: t.sessionId || null });
  const currentTable = state.tables.find(x=>x.id===tableId);
  db.ref('customerRequests').push({
    tableId, tableName: t.name, type: 'message', message: `${t.name}: ${text}`,
    waiterId: currentTable?.occupant || t.occupant || null, status: 'pending',
    time: new Date().toLocaleTimeString('az-AZ'), createdAt: Date.now()
  });
  addLog('chat',`"${t.name}" masasından mesaj: ${text}`,{ tableId });
  document.getElementById('custMsgInput').value = '';
  showCustomerToast('<svg class="icon"><use href="#i-check"></use></svg> Mesaj göndərildi!');
}

export function sendFeedback() {
  const msg = document.getElementById('feedbackInput').value.trim();
  const tableId = window._customerTableId;
  const t = window._customerTableData;
  if (!msg) return;
  db.ref('feedbacks').push({
    tableId, tableName: t ? t.name : '?', message: msg,
    time: new Date().toLocaleTimeString('az-AZ'), date: new Date().toLocaleDateString('az-AZ'),
    createdAt: Date.now(), status: 'new'
  });
  addLog('customer',`"${t?t.name:'?'}" masasından şikayət/təklif: ${msg}`,{ tableId });
  document.getElementById('feedbackInput').value = '';
  showCustomerToast('<svg class="icon"><use href="#i-check"></use></svg> Şikayət/təklifiniz qeyd edildi!');
}

export function initWaiterChatListener() {
  db.ref('chats').on('value', snap => {
    const data = snap.val() || {};
    Object.keys(data).forEach(tableId => {
      const msgs = toArr(data[tableId].messages || {});
      const t = state.tables.find(x=>x.id===tableId);
      if (!t || t.occupant !== state.user?.id) return;
      const unread = msgs.filter(m=>m.sender==='customer'&&!m.readByWaiter&&Date.now()-m.createdAt<60000);
      if (unread.length && state.activeChatTableId !== tableId) {
        const lastUnread = unread[unread.length-1];
        if (!state._shownRequests.includes('chat_'+lastUnread.id)) {
          state._shownRequests.push('chat_'+lastUnread.id);
          showToast(`<svg class="icon"><use href="#i-chat"></use></svg> ${t.name}: Yeni mesaj!`);
          openWaiterChatForTable(tableId, null);
        }
      }
    });
    if (state.activeChatTableId) renderWaiterChatMsgs(data[state.activeChatTableId]?.messages || {});
  });
}

export function openWaiterChatForTable(tableId, requestId) {
  const t = state.tables.find(x=>x.id===tableId);
  state.activeChatTableId = tableId;
  state.activeChatConvId = requestId;
  document.getElementById('waiterChatTitle').innerHTML = `<svg class="icon"><use href="#i-chat"></use></svg> ${t ? t.name : 'Müştəri'} — Mesajlar`;
  document.getElementById('waiterChatPanel').classList.add('show');
  db.ref(`chats/${tableId}/messages`).once('value', snap => { renderWaiterChatMsgs(snap.val() || {}); });
}

export function closeWaiterChat() {
  document.getElementById('waiterChatPanel').classList.remove('show');
  state.activeChatTableId = null;
  state.activeChatConvId = null;
  document.getElementById('waiterChatMsgList').innerHTML = '';
}

export function renderWaiterChatMsgs(msgsObj) {
  const t = state.tables.find(x=>x.id===state.activeChatTableId);
  const currentSessionId = t?.sessionId || null;
  const msgs = toArr(msgsObj).filter(m => !currentSessionId || m.sessionId === currentSessionId).sort((a,b)=>a.createdAt-b.createdAt);
  const el = document.getElementById('waiterChatMsgList');
  el.innerHTML = msgs.map(m=>`<div class="chat-bubble ${m.sender}">${esc(m.text)}<span style="font-size:10px;opacity:.6;margin-left:8px;">${m.time||''}</span></div>`).join('');
  el.scrollTop = el.scrollHeight;
  msgs.filter(m=>m.sender==='customer'&&!m.readByWaiter).forEach(m=>{
    db.ref(`chats/${state.activeChatTableId}/messages/${m.id}`).update({ readByWaiter: true });
  });
}

export function sendWaiterReply() {
  const text = document.getElementById('waiterChatInput').value.trim();
  if (!text || !state.activeChatTableId) return;
  const w = state.user;
  const t = state.tables.find(x=>x.id===state.activeChatTableId);
  const ref = db.ref(`chats/${state.activeChatTableId}/messages`).push();
  ref.set({ sender: 'waiter', senderName: w.name, text, time: new Date().toLocaleTimeString('az-AZ'), createdAt: Date.now(), sessionId: t?.sessionId || null });
  addLog('chat',`${w.name} "${t?t.name:'masa'}" müştərisinə cavab verdi: ${text}`,{ waiterId:w.id, tableId:state.activeChatTableId });
  document.getElementById('waiterChatInput').value = '';
}

// Mövcud HTML-də onclick="..." istifadə olunan funksiyalar qlobal əlçatan olmalıdır
window.openMenu = openMenu;
window.customerAction = customerAction;
window.sendCustomerMsg = sendCustomerMsg;
window.sendFeedback = sendFeedback;
window.sendWaiterReply = sendWaiterReply;
window.closeWaiterChat = closeWaiterChat;

// alarm.js "mesaj" tipli bildirişdə söhbəti açmaq istəyəndə bu hadisəni göndərir
// (dövri import (alarm.js <-> customer.js) olmasın deyə birbaşa çağırış əvəzinə hadisə istifadə olunur)
document.addEventListener('alarm:open-chat', (e) => {
  openWaiterChatForTable(e.detail.tableId, e.detail.requestId);
});
