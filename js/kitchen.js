import { R, db } from './firebase-service.js';
import { state } from './state.js';
import { esc, showToast, addLog } from './utils.js';
import { playNotifSound } from './notifSounds.js';
export function renderKitchen() {  // Qəbul edilməmiş sifarişlər üçün periodik siqnal
  const _alerts = window._kitchenAlerts = window._kitchenAlerts || {};
  const el = document.getElementById('kitchenGrid');
  if (!el) return;
  const kitchen = state._activeKitchen;
  const orders = (state.kitchenOrders || [])
    .filter(ko => {
      if (kitchen && ko.kitchenId !== kitchen.id) return false;
      return !ko.allReady || !ko.waiterAccepted;
    })
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  if (!orders.length) {
      orders.forEach(ko => {
    if (!ko.kitchenAccepted && !_alerts[ko.id]) {
      playNotifSound('kitchen_new_order');
      _alerts[ko.id] = setInterval(() => {
        const live = (state.kitchenOrders||[]).find(x=>x.id===ko.id);
        if (!live || live.kitchenAccepted) { clearInterval(_alerts[ko.id]); delete _alerts[ko.id]; return; }
        playNotifSound('kitchen_new_order');
      }, (state.kitchenAlertIntervalSec||15) * 1000);
    }
    if (ko.kitchenAccepted && _alerts[ko.id]) {
      clearInterval(_alerts[ko.id]); delete _alerts[ko.id];
    }
  });
    el.innerHTML = '<p style="color:var(--text2);text-align:center;padding:40px;grid-column:1/-1;">Aktiv sifariş yoxdur.</p>';
    return;
  }
  el.innerHTML = orders.map(ko => renderKitchenCard(ko)).join('');
}

function itemStatusLabel(item) {
  if (item.waiterAccepted) return { cls: 'ko-item-status--accepted', text: 'Qəbul etdi' };
  if (item.ready)          return { cls: 'ko-item-status--ready',    text: 'Hazırdır ✓' };
  if (item.cooking)        return { cls: 'ko-item-status--cooking',  text: 'Hazırlanır' };
  return                          { cls: 'ko-item-status--new',      text: 'Yeni' };
}

function renderKitchenCard(ko) {
  const items = ko.items || [];
  const allReady = items.length > 0 && items.every(i => i.ready);
  const waiterAccepted = allReady && items.every(i => i.waiterAccepted);

  let cardClass = 'ko-card';
    const kitchenAccepted = !!ko.kitchenAccepted;
  let headerStatus = '';
    if (waiterAccepted) {
    cardClass += ' ko-card--accepted';
    headerStatus = '<span class="ko-badge ko-badge--accepted">Ofisiant qəbul etdi</span>';
  } else if (allReady) {
    cardClass += ' ko-card--ready';
    headerStatus = '<span class="ko-badge ko-badge--ready">Ofisiant gözlənilir...</span>';
  } else if (!kitchenAccepted) {
    cardClass += ' ko-card--pending ko-card--unaccepted';
    headerStatus = '<span class="ko-badge ko-badge--new-pulse">🔔 Yeni sifariş!</span>';
  } else {
    cardClass += ' ko-card--pending';
    headerStatus = '<span class="ko-badge ko-badge--pending">Hazırlanır</span>';
  }

  const changeNotice = ko.changeNote
    ? `<div class="ko-change-notice"><svg class="icon"><use href="#i-warning"></use></svg> ${esc(ko.changeNote)}</div>` : '';

  const orderNote = ko.orderNote
    ? `<div class="ko-order-note"><svg class="icon"><use href="#i-note"></use></svg> <strong>Ümumi qeyd:</strong> ${esc(ko.orderNote)}</div>` : '';

  const elapsed = ko.createdAt ? Math.floor((Date.now() - ko.createdAt) / 60000) : 0;
  const elapsedHtml = `<span class="ko-elapsed ${elapsed > 15 ? 'ko-elapsed--warn' : ''}">${elapsed} dəq</span>`;

  const itemsHtml = items.map((item, idx) => {
    const st = itemStatusLabel(item);
    const cookBtn = (!item.ready && !item.cooking)
      ? `<button class="ko-item-action ko-item-action--cook" onclick="kitchenItemCook('${esc(ko.id)}',${idx})">Hazırlanır</button>` : '';
    const readyBtn = !item.ready
      ? `<button class="ko-item-action ko-item-action--ready" onclick="kitchenItemReady('${esc(ko.id)}',${idx})">Hazırdır</button>` : '';
    let timeLine = '';
    if (item.readyAt && item.addedAt) {
      const mins = Math.round((item.readyAt - item.addedAt) / 60000);
      timeLine = `<span class="ko-item-time">${mins} dəq</span>`;
    }
    return `<div class="ko-item ${item.ready ? 'ko-item--done' : ''}">
      <div class="ko-item-main">
        <span class="ko-item-qty">${item.qty}×</span>
        <div class="ko-item-info">
          <span class="ko-item-name">${esc(item.name)}</span>
          ${item.note ? `<span class="ko-item-note">${esc(item.note)}</span>` : ''}
        </div>
        <span class="ko-item-status ${st.cls}">${st.text}</span>
        ${timeLine}
      </div>
      <div class="ko-item-actions">${cookBtn}${readyBtn}</div>
    </div>`;
  }).join('');

  return `<div class="${cardClass}">
    <div class="ko-card-header">
      <div class="ko-table-name">${esc(ko.tableName || 'Masa')}</div>
      <div style="display:flex;align-items:center;gap:6px;">${elapsedHtml}<div class="ko-time">${esc(ko.time || '')}</div></div>
    </div>
    <div class="ko-waiter-name"><svg class="icon" style="width:.85em;height:.85em;"><use href="#i-user"></use></svg> ${esc(ko.waiterName || '')}</div>
        const acceptBtn = !kitchenAccepted
    ? `<button class="ko-accept-btn" onclick="kitchenAcceptOrder('${esc(ko.id)}')">✓ Qəbul et</button>` : '';
        ${acceptBtn}${headerStatus}${changeNotice}${orderNote}
    <div class="ko-items">${itemsHtml}</div>
  </div>`;
}

export function kitchenItemCook(kitchenOrderId, itemIdx) {
  const ko = (state.kitchenOrders || []).find(x => x.id === kitchenOrderId);
  if (!ko) return;
  const items = (ko.items || []).map((item, i) =>
    i === itemIdx ? { ...item, cooking: true, cookingAt: Date.now() } : item
  );
  R.kitchenOrders.child(kitchenOrderId).update({ items });
  addLog('kitchen_cooking', `"${ko.tableName}" — "${ko.items[itemIdx]?.name}" hazırlanmağa başladı`, { kitchenOrderId });
  showToast('<svg class="icon"><use href="#i-chef"></use></svg> "Hazırlanır" işarələndi');
}
window.kitchenItemCook = kitchenItemCook;

export function kitchenItemReady(kitchenOrderId, itemIdx) {
  const ko = (state.kitchenOrders || []).find(x => x.id === kitchenOrderId);
  if (!ko) return;
  const now = Date.now();
  const items = (ko.items || []).map((item, i) =>
    i === itemIdx ? { ...item, ready: true, cooking: true, readyAt: now } : item
  );
  const allReady = items.every(i => i.ready);
  const update = { items, allReady };
  if (allReady && !ko.allReady) { update.status = 'ready'; update.readyAt = now; update.readyItems = items; }

  const readyItem = items[itemIdx];
  const notifRef = R.kitchenNotifs.push();
  notifRef.set({
    waiterId: ko.waiterId, waiterName: ko.waiterName,
    kitchenOrderId, kitchenId: ko.kitchenId,
    kitchenName: ko.kitchenName || state._activeKitchen?.name || 'Mətbəx',
    tableName: ko.tableName, tableId: ko.tableId,
    itemName: readyItem.name, itemQty: readyItem.qty, itemIdx,
    allReady, status: 'pending',
    createdAt: now, time: new Date().toLocaleTimeString('az-AZ')
  });

  addLog('kitchen_ready', `"${ko.tableName}" — "${readyItem.name}" hazırdır`, { kitchenOrderId, itemIdx, waiterId: ko.waiterId });
  R.kitchenOrders.child(kitchenOrderId).update(update);
  showToast(`<svg class="icon"><use href="#i-check"></use></svg> "${readyItem.name}" hazırdır — ofisianta bildiriş göndərildi`);
}
window.kitchenItemReady = kitchenItemReady;

export function kitchenMarkItemReady(id, idx) { kitchenItemReady(id, idx); }
window.kitchenMarkItemReady = kitchenMarkItemReady;

export function callWaiter(waiterId) {
  const w = state.staff.find(x => x.id === waiterId);
  if (!w) return;
  const ref = R.orders.push();
  ref.set({ waiterId: w.id, waiterName: w.name, status: 'pending', time: new Date().toLocaleTimeString('az-AZ'), createdAt: Date.now() });
  addLog('order_send', `Mətbəx ${w.name}-ə bildiriş göndərdi`, { waiterId: w.id });
  showToast(`<svg class="icon"><use href="#i-bell"></use></svg> ${w.name}-ə bildiriş göndərildi`);
}
window.callWaiter = callWaiter;
export function kitchenAcceptOrder(kitchenOrderId) {
  const ko = (state.kitchenOrders||[]).find(x=>x.id===kitchenOrderId);
  if (!ko) return;
  const now = Date.now();
  const waitSec = ko.createdAt ? Math.round((now - ko.createdAt)/1000) : 0;
  const kitchenName = state._activeKitchen?.name || ko.kitchenName || 'Mətbəx';
  R.kitchenOrders.child(kitchenOrderId).update({ kitchenAccepted:true, kitchenAcceptedAt:now, kitchenAcceptedBy:kitchenName, kitchenWaitSec:waitSec });
  const _alerts = window._kitchenAlerts || {};
  if (_alerts[kitchenOrderId]) { clearInterval(_alerts[kitchenOrderId]); delete _alerts[kitchenOrderId]; }
  addLog('kitchen_accept', `"${kitchenName}" sifarişi qəbul etdi — ${ko.tableName} (${waitSec<60?waitSec+' san':Math.floor(waitSec/60)+' dəq'} sonra)`, { kitchenOrderId, waitSec });
  showToast('✓ Sifariş qəbul edildi');
}
window.kitchenAcceptOrder = kitchenAcceptOrder;
