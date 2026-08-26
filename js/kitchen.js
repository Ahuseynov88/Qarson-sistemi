import { R, db } from './firebase-service.js';
import { state } from './state.js';
import { esc, showToast, addLog } from './utils.js';
import { playNotifSound } from './notifSounds.js';

export function renderKitchen() {
  // Qəbul edilməmiş sifarişlər üçün periodik siqnal
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

  // Aktiv sifarişlər üçün alarm sistemini idarə et
  orders.forEach(ko => {
    if (!ko.kitchenAccepted && !_alerts[ko.id]) {
      // İlk dəfə dərhal səs çal
      playNotifSound('kitchen_new_order');

      // Sonra müəyyən interval ilə təkrarla
      _alerts[ko.id] = setInterval(() => {
        const live = (state.kitchenOrders || []).find(
          x => x.id === ko.id
        );

        if (!live || live.kitchenAccepted) {
          clearInterval(_alerts[ko.id]);
          delete _alerts[ko.id];
          return;
        }
        playNotifSound('kitchen_new_order');
      }, (state.kitchenAlertIntervalSec || 15) * 1000);
    }

    // Sifariş qəbul edilibsə alarmı dayandır
    if (ko.kitchenAccepted && _alerts[ko.id]) {
      clearInterval(_alerts[ko.id]);
      delete _alerts[ko.id];
    }
  });

  // Artıq ekranda olmayan sifarişlərin köhnə alarm timer-lərini təmizlə
  Object.keys(_alerts).forEach(orderId => {
    const stillExists = orders.some(ko => ko.id === orderId);

    if (!stillExists) {
      clearInterval(_alerts[orderId]);
      delete _alerts[orderId];
    }
  });

  if (!orders.length) {
    el.innerHTML =
      '<p style="color:var(--text2);text-align:center;padding:40px;grid-column:1/-1;">Aktiv sifariş yoxdur.</p>';

    return;
  }

  el.innerHTML = orders
    .map(ko => renderKitchenCard(ko))
    .join('');
}

function itemStatusLabel(item) {
  if (item.cancelled)      return { cls: 'ko-item-status--cancelled', text: 'Ləğv edildi' };
  if (item.problem)        return { cls: 'ko-item-status--problem',   text: item.problem };
  if (item.waiterAccepted) return { cls: 'ko-item-status--accepted',  text: 'Qəbul etdi' };
  if (item.ready)          return { cls: 'ko-item-status--ready',     text: 'Hazırdır ✓' };
  if (item.cooking)        return { cls: 'ko-item-status--cooking',   text: 'Hazırlanır' };
  return                          { cls: 'ko-item-status--new',       text: 'Yeni' };
}

function renderKitchenCard(ko) {
  const items = ko.items || [];

  const allReady =
    items.length > 0 &&
    items.every(i => i.ready);

  const waiterAccepted =
    allReady &&
    items.every(i => i.waiterAccepted);

  const kitchenAccepted = !!ko.kitchenAccepted;

  let cardClass = 'ko-card';
  let headerStatus = '';

  if (waiterAccepted) {
    cardClass += ' ko-card--accepted';

    headerStatus =
      '<span class="ko-badge ko-badge--accepted">Ofisiant qəbul etdi</span>';
  } else if (allReady) {
    cardClass += ' ko-card--ready';

    headerStatus =
      '<span class="ko-badge ko-badge--ready">Ofisiant gözlənilir...</span>';
  } else if (!kitchenAccepted) {
    cardClass += ' ko-card--pending ko-card--unaccepted';

    headerStatus =
      '<span class="ko-badge ko-badge--new-pulse">🔔 Yeni sifariş!</span>';
  } else {
    cardClass += ' ko-card--pending';

    headerStatus =
      '<span class="ko-badge ko-badge--pending">Hazırlanır</span>';
  }

  const changeNotice = ko.changeNote
    ? `
      <div class="ko-change-notice">
        <svg class="icon">
          <use href="#i-warning"></use>
        </svg>
        ${esc(ko.changeNote)}
      </div>
    `
    : '';

  const orderNote = ko.orderNote
    ? `
      <div class="ko-order-note">
        <svg class="icon">
          <use href="#i-note"></use>
        </svg>
        <strong>Ümumi qeyd:</strong>
        ${esc(ko.orderNote)}
      </div>
    `
    : '';

  const elapsed = ko.createdAt
    ? Math.floor((Date.now() - ko.createdAt) / 60000)
    : 0;

  const elapsedHtml = `
    <span class="ko-elapsed ${
      elapsed > 15 ? 'ko-elapsed--warn' : ''
    }">
      ${elapsed} dəq
    </span>
  `;

  const acceptBtn = !kitchenAccepted
    ? `
      <button
        class="ko-accept-btn"
        onclick="kitchenAcceptOrder('${esc(ko.id)}')"
      >
        ✓ Qəbul et
      </button>
    `
    : '';

  const itemsHtml = items
    .map((item, idx) => {
      const st = itemStatusLabel(item);

            const cookBtn = (!item.cancelled && !item.ready && !item.cooking)
        ? `<button class="ko-item-action ko-item-action--cook" onclick="kitchenItemCook('${esc(ko.id)}',${idx})">Hazırlanır</button>`
        : '';
      const readyBtn = (!item.cancelled && !item.ready)
        ? `<button class="ko-item-action ko-item-action--ready" onclick="kitchenItemReady('${esc(ko.id)}',${idx})">Hazırdır</button>`
        : '';
      const problemBtn = (!item.cancelled && !item.ready)
        ? `<button class="ko-item-action ko-item-action--problem" onclick="kitchenItemProblem('${esc(ko.id)}',${idx})">⚠ Problem</button>`
        : '';

      let timeLine = '';

      if (item.readyAt && item.addedAt) {
        const mins = Math.round(
          (item.readyAt - item.addedAt) / 60000
        );

        timeLine = `
          <span class="ko-item-time">
            ${mins} dəq
          </span>
        `;
      }

           // Ləğv edilmiş mal — üstü xəttli
      if (item.cancelled) {
        return `<div class="ko-item ko-item--cancelled">
          <div class="ko-item-main">
            <span class="ko-item-qty" style="text-decoration:line-through;opacity:.5;">${item.qty}×</span>
            <div class="ko-item-info">
              <span class="ko-item-name" style="text-decoration:line-through;opacity:.5;">${esc(item.name)}</span>
              <span class="ko-item-note" style="color:var(--red);">❌ Ləğv: ${esc(item.cancelReason||'')}</span>
            </div>
            <span class="ko-item-status ko-item-status--cancelled">Ləğv edildi</span>
          </div>
        </div>`;
      }
      // Qismən ləğv varsa miqdar göstər
      const cancelledQtyNote = item.cancelledQty
        ? `<span class="ko-item-note" style="color:var(--red);">~~${item.cancelledQty}× ləğv~~</span>` : '';

            return `
        <div class="ko-item ${item.ready ? 'ko-item--done' : ''}">
          <div class="ko-item-main">
            <span class="ko-item-qty">${item.qty}×</span>
            <div class="ko-item-info">
              <span class="ko-item-name">${esc(item.name)}</span>
              ${item.note ? `<span class="ko-item-note">${esc(item.note)}</span>` : ''}
              ${cancelledQtyNote}
            </div>
            <span class="ko-item-status ${st.cls}">${st.text}</span>
            ${timeLine}
          </div>
          <div class="ko-item-actions">
            ${cookBtn}
            ${readyBtn}
            ${problemBtn}
          </div>
        </div>
      `;
  return `
    <div class="${cardClass}">

      <div class="ko-card-header">

        <div class="ko-table-name">
          ${esc(ko.tableName || 'Masa')}
        </div>

        <div style="display:flex;align-items:center;gap:6px;">
          ${elapsedHtml}

          <div class="ko-time">
            ${esc(ko.time || '')}
          </div>
        </div>

      </div>

      <div class="ko-waiter-name">

        <svg
          class="icon"
          style="width:.85em;height:.85em;"
        >
          <use href="#i-user"></use>
        </svg>

        ${esc(ko.waiterName || '')}

      </div>

      ${acceptBtn}

      ${headerStatus}

      ${changeNotice}

      ${orderNote}

      <div class="ko-items">
        ${itemsHtml}
      </div>

    </div>
  `;
}

export function kitchenItemCook(
  kitchenOrderId,
  itemIdx
) {
  const ko = (state.kitchenOrders || []).find(
    x => x.id === kitchenOrderId
  );

  if (!ko) return;

  const now = Date.now();

  const items = (ko.items || []).map(
    (item, i) =>
      i === itemIdx
        ? {
            ...item,
            cooking: true,
            cookingAt:
              item.cookingAt || now
          }
        : item
  );

  R.kitchenOrders
    .child(kitchenOrderId)
    .update({
      items
    });

  addLog(
    'kitchen_cooking',
    `"${ko.tableName}" — "${
      ko.items[itemIdx]?.name || ''
    }" hazırlanmağa başladı`,
    {
      kitchenOrderId,
      itemIdx
    }
  );

  showToast(
    '<svg class="icon"><use href="#i-chef"></use></svg> "Hazırlanır" işarələndi'
  );
}

window.kitchenItemCook = kitchenItemCook;

export function kitchenItemReady(
  kitchenOrderId,
  itemIdx
) {
  const ko = (state.kitchenOrders || []).find(
    x => x.id === kitchenOrderId
  );

  if (!ko) return;

  const now = Date.now();

  const items = (ko.items || []).map(
    (item, i) =>
      i === itemIdx
        ? {
            ...item,
            ready: true,
            cooking: true,
            cookingAt:
              item.cookingAt || now,
            readyAt: now
          }
        : item
  );

  const allReady =
    items.length > 0 &&
    items.every(i => i.ready);

  const update = {
    items,
    allReady
  };

  if (allReady && !ko.allReady) {
    update.status = 'ready';
    update.readyAt = now;
    update.readyItems = items;
  }

  const readyItem = items[itemIdx];

  if (!readyItem) return;

  const notifRef =
    R.kitchenNotifs.push();

  notifRef.set({
    waiterId: ko.waiterId,
    waiterName: ko.waiterName,

    kitchenOrderId,
    kitchenId: ko.kitchenId,

    kitchenName:
      ko.kitchenName ||
      state._activeKitchen?.name ||
      'Mətbəx',

    tableName: ko.tableName,
    tableId: ko.tableId,

    itemName: readyItem.name,
    itemQty: readyItem.qty,
    itemIdx,

    allReady,
    status: 'pending',

    createdAt: now,

    time:
      new Date().toLocaleTimeString(
        'az-AZ'
      )
  });

  addLog(
    'kitchen_ready',
    `"${ko.tableName}" — "${readyItem.name}" hazırdır`,
    {
      kitchenOrderId,
      itemIdx,
      waiterId: ko.waiterId
    }
  );

  R.kitchenOrders
    .child(kitchenOrderId)
    .update(update);

  showToast(
    `<svg class="icon"><use href="#i-check"></use></svg> "${readyItem.name}" hazırdır — ofisianta bildiriş göndərildi`
  );
}

window.kitchenItemReady =
  kitchenItemReady;

export function kitchenMarkItemReady(
  id,
  idx
) {
  kitchenItemReady(id, idx);
}

window.kitchenMarkItemReady =
  kitchenMarkItemReady;

export function callWaiter(waiterId) {
  const w = state.staff.find(
    x => x.id === waiterId
  );

  if (!w) return;

  const ref = R.orders.push();

  ref.set({
    waiterId: w.id,
    waiterName: w.name,

    status: 'pending',

    time:
      new Date().toLocaleTimeString(
        'az-AZ'
      ),

    createdAt: Date.now()
  });

  addLog(
    'order_send',
    `Mətbəx ${w.name}-ə bildiriş göndərdi`,
    {
      waiterId: w.id
    }
  );

  showToast(
    `<svg class="icon"><use href="#i-bell"></use></svg> ${w.name}-ə bildiriş göndərildi`
  );
}

window.callWaiter = callWaiter;

export function kitchenAcceptOrder(
  kitchenOrderId
) {
  const ko = (
    state.kitchenOrders || []
  ).find(
    x => x.id === kitchenOrderId
  );

  if (!ko) return;

  const now = Date.now();

  const waitSec = ko.createdAt
    ? Math.round(
        (now - ko.createdAt) / 1000
      )
    : 0;

  const kitchenName =
    state._activeKitchen?.name ||
    ko.kitchenName ||
    'Mətbəx';

  R.kitchenOrders
    .child(kitchenOrderId)
    .update({
      kitchenAccepted: true,
      kitchenAcceptedAt: now,
      kitchenAcceptedBy:
        kitchenName,
      kitchenWaitSec: waitSec
    });

  const _alerts =
    window._kitchenAlerts || {};

  if (_alerts[kitchenOrderId]) {
    clearInterval(
      _alerts[kitchenOrderId]
    );

    delete _alerts[
      kitchenOrderId
    ];
  }

  addLog(
    'kitchen_accept',
    `"${kitchenName}" sifarişi qəbul etdi — ${
      ko.tableName
    } (${
      waitSec < 60
        ? waitSec + ' san'
        : Math.floor(
            waitSec / 60
          ) + ' dəq'
    } sonra)`,
    {
      kitchenOrderId,
      waitSec
    }
  );

  showToast(
    '✓ Sifariş qəbul edildi'
  );
}

window.kitchenAcceptOrder =
  kitchenAcceptOrder;
// Problem bildirişi
const _problemLabels = {
  out_of_stock:   'Məhsul bitib',
  not_enough:     'Miqdar kifayət etmir',
  cannot_prepare: 'Hazırlamaq mümkün deyil',
  other:          'Digər səbəb'
};

export function kitchenItemProblem(kitchenOrderId, itemIdx) {
  const ko = (state.kitchenOrders || []).find(x => x.id === kitchenOrderId);
  if (!ko) return;
  const item = (ko.items || [])[itemIdx];
  if (!item) return;

  // Sadə seçim dialoqunu göstər
  const modal = document.getElementById('kitchenProblemModal');
  if (!modal) {
    // Modal yoxdursa inline prompt istifadə et
    const keys = Object.keys(_problemLabels);
    const choice = prompt(
      `Problem növü seçin:\n${keys.map((k,i)=>`${i+1}. ${_problemLabels[k]}`).join('\n')}\n\nNömrəni daxil edin:`
    );
    const idx2 = parseInt(choice) - 1;
    const problemKey = keys[idx2];
    if (!problemKey) return;
    let availQty = null;
    if (problemKey === 'not_enough') {
      availQty = parseInt(prompt(`Mövcud miqdar (sifariş: ${item.qty}):`));
      if (isNaN(availQty) || availQty < 0) return;
    }
    _sendKitchenProblem(ko, itemIdx, problemKey, availQty);
    return;
  }

  // Modal varsa onu aç
  document.getElementById('kpModalKoId').value = kitchenOrderId;
  document.getElementById('kpModalItemIdx').value = itemIdx;
  document.getElementById('kpModalItemName').textContent = `${item.qty}× ${item.name}`;
  document.getElementById('kpModalAvailQtyRow').style.display = 'none';
  modal.classList.add('open');
}
window.kitchenItemProblem = kitchenItemProblem;

export function kitchenProblemTypeChanged(val) {
  const row = document.getElementById('kpModalAvailQtyRow');
  if (row) row.style.display = val === 'not_enough' ? 'block' : 'none';
}
window.kitchenProblemTypeChanged = kitchenProblemTypeChanged;

export function confirmKitchenProblem() {
  const koId = document.getElementById('kpModalKoId').value;
  const itemIdx = parseInt(document.getElementById('kpModalItemIdx').value);
  const problemKey = document.getElementById('kpModalProblemType').value;
  const availQty = problemKey === 'not_enough'
    ? parseInt(document.getElementById('kpModalAvailQty').value) : null;
  const ko = (state.kitchenOrders || []).find(x => x.id === koId);
  if (!ko) return;
  _sendKitchenProblem(ko, itemIdx, problemKey, availQty);
  document.getElementById('kitchenProblemModal').classList.remove('open');
}
window.confirmKitchenProblem = confirmKitchenProblem;

function _sendKitchenProblem(ko, itemIdx, problemKey, availQty) {
  const item = (ko.items || [])[itemIdx];
  if (!item) return;
  const now = Date.now();
  const label = _problemLabels[problemKey] || problemKey;
  const kitchenName = state._activeKitchen?.name || ko.kitchenName || 'Mətbəx';

  let notifText = '';
  if (problemKey === 'not_enough' && availQty !== null) {
    notifText = `${ko.tableName} — ${item.qty}× ${item.name} sifariş edilib, mətbəxdə yalnız ${availQty} ədəd var.`;
  } else {
    notifText = `${ko.tableName} — ${item.name}: ${label}.`;
  }

  // Ofisianta bildiriş göndər
  const notifRef = R.kitchenNotifs.push();
  notifRef.set({
    type: 'kitchen_problem',
    waiterId: ko.waiterId,
    waiterName: ko.waiterName,
    kitchenOrderId: ko.id,
    kitchenId: ko.kitchenId,
    kitchenName,
    tableName: ko.tableName,
    tableId: ko.tableId,
    itemName: item.name,
    itemQty: item.qty,
    availQty: availQty ?? null,
    problemKey,
    problemLabel: label,
    itemIdx,
    allReady: false,
    status: 'pending',
    createdAt: now,
    time: new Date().toLocaleTimeString('az-AZ')
  });

  // Mətbəx kartındakı item-ə problem statusu yaz
  const items = (ko.items || []).map((it, i) =>
    i === itemIdx ? { ...it, problem: label, problemKey, availQty: availQty ?? undefined } : it
  );
  R.kitchenOrders.child(ko.id).update({ items });

  addLog('kitchen_problem',
    `"${kitchenName}" — ${ko.tableName}: "${item.name}" — ${label}${availQty!==null?' (mövcud: '+availQty+')':''}`,
    { kitchenOrderId: ko.id, itemIdx, itemName: item.name, itemQty: item.qty, availQty, problemKey, kitchenName, waiterId: ko.waiterId }
  );

  showToast(`⚠ Problem bildirişi ofisianta göndərildi`);
}
