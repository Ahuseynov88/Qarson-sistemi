import { R } from './firebase-service.js';
import { state } from './state.js';
import { esc, showToast, addLog } from './utils.js';

export function renderKitchen() {
  const el = document.getElementById('kitchenGrid');
  if (!el) return;
  const orders = (state.kitchenOrders || [])
    .filter(ko => !ko.allReady || !ko.waiterAccepted)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  if (!orders.length) {
    el.innerHTML = '<p style="color:var(--text2);text-align:center;padding:40px;grid-column:1/-1;">Aktiv sifariş yoxdur.</p>';
    return;
  }
  el.innerHTML = orders.map(ko => renderKitchenCard(ko)).join('');
}

function renderKitchenCard(ko) {
  const items = ko.items || [];
  const allReady = items.length > 0 && items.every(i => i.ready);
  const waiterAccepted = ko.waiterAccepted;
  let cardClass = 'ko-card';
  let statusHtml = '';
  if (waiterAccepted && allReady) {
    cardClass += ' ko-card--accepted';
    statusHtml = '<div class="ko-status ko-status--accepted"><span class="dot" style="background:var(--green)"></span> Ofisiant qəbul etdi</div>';
  } else if (allReady) {
    cardClass += ' ko-card--ready';
    statusHtml = '<div class="ko-status ko-status--ready"><span class="dot" style="background:var(--orange)"></span> Ofisiant gözlənilir...</div>';
  } else {
    cardClass += ' ko-card--pending';
    statusHtml = '<div class="ko-status ko-status--pending"><span class="dot" style="background:var(--red)"></span> Hazırlanır</div>';
  }
  const itemsHtml = items.map((item, idx) => {
    const readyClass = item.ready ? 'ko-item--ready' : '';
    const btn = item.ready
      ? `<span class="ko-item-done"><svg class="icon"><use href="#i-check"></use></svg></span>`
      : `<button class="ko-item-btn" onclick="kitchenMarkItemReady('${esc(ko.id)}',${idx})">Hazırdır</button>`;
    return `<div class="ko-item ${readyClass}">
      <span class="ko-item-qty">${item.qty}×</span>
      <span class="ko-item-name">${esc(item.name)}</span>
      ${btn}
    </div>`;
  }).join('');
  return `<div class="${cardClass}">
    <div class="ko-card-header">
      <div class="ko-table-name">${esc(ko.tableName || 'Masa')}</div>
      <div class="ko-time">${esc(ko.time || '')}</div>
    </div>
    <div class="ko-waiter-name"><svg class="icon" style="width:.85em;height:.85em;"><use href="#i-user"></use></svg> ${esc(ko.waiterName || '')}</div>
    ${statusHtml}
    <div class="ko-items">${itemsHtml}</div>
  </div>`;
}

export function kitchenMarkItemReady(kitchenOrderId, itemIdx) {
  const ko = (state.kitchenOrders || []).find(x => x.id === kitchenOrderId);
  if (!ko) return;
  const items = (ko.items || []).map((item, i) =>
    i === itemIdx ? { ...item, ready: true } : item
  );
  const allReady = items.every(i => i.ready);
  const update = { items, allReady };
  if (allReady && !ko.allReady) {
    update.status = 'ready';
    update.readyAt = Date.now();
    update.readyItems = items;
    addLog('kitchen_ready', `Mətbəx "${ko.tableName}" masası üçün sifarişi hazırladı`, { kitchenOrderId, waiterId: ko.waiterId });
    showToast('<svg class="icon"><use href="#i-check"></use></svg> Sifariş tam hazırdır! Ofisianta bildiriş göndərildi.');
  } else {
    showToast('<svg class="icon"><use href="#i-check"></use></svg> Mal hazır edildi');
  }
  R.kitchenOrders.child(kitchenOrderId).update(update);
}

window.kitchenMarkItemReady = kitchenMarkItemReady;

export function callWaiter(waiterId) {
  const w = state.staff.find(x => x.id === waiterId);
  if (!w) return;
  const ref = R.orders.push();
  ref.set({ waiterId: w.id, waiterName: w.name, status: 'pending', time: new Date().toLocaleTimeString('az-AZ'), createdAt: Date.now() });
  addLog('order_send', `Mətbəx ${w.name}-ə sifariş bildirişi göndərdi`, { waiterId: w.id });
  showToast(`<svg class="icon"><use href="#i-bell"></use></svg> ${w.name}-ə bildiriş göndərildi`);
}
window.callWaiter = callWaiter;
