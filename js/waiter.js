/* ═══════════════════════════════════════════
   WAITER PANEL
   Bu fayl: qarsonun gördüyü masalar siyahısı. Kateqoriyalar
   yuxarıda tab şəklində (Menulux-un BAHÇE/SALON/TERAS tabları
   kimi), yalnız seçilmiş kateqoriyanın masaları göstərilir.
═══════════════════════════════════════════ */
function renderWaiterCatTabs() {
  const tabEl = document.getElementById('waiterCatTabs');
  if (!tabEl) return;
  const cats = ['all', ...new Set(state.tables.map(t => t.category || t.name.replace(/\s+\d+$/, '') || t.name))];

  tabEl.innerHTML = cats.map(c => `
    <button onclick="setWaiterCat('${esc(c)}')"
      style="flex:1;padding:10px 6px;border:none;background:transparent;
             font-size:13px;font-weight:700;cursor:pointer;
             color:${state._waiterCatFilter===c?'var(--red)':'var(--text2)'};
             border-bottom:2px solid ${state._waiterCatFilter===c?'var(--red)':'transparent'};">
      ${c === 'all' ? 'Hamısı' : esc(c).toUpperCase()}
    </button>
  `).join('');
}

function setWaiterCat(cat) {
  state._waiterCatFilter = cat;
  renderWaiterCatTabs();
  renderWaiterTables();
}

function renderWaiterTables() {
  if (!state.user || (state.user.role !== 'staff' && state.user.role !== 'staff')) return;
  renderWaiterCatTabs();
  const el = document.getElementById('waiterTables');
  if (!state.tables.length) {
    el.innerHTML = '<p style="color:var(--text3);">Admin hələ masa əlavə etməyib.</p>';
    return;
  }

  const filtered = state._waiterCatFilter === 'all'
    ? state.tables
    : state.tables.filter(t => (t.category || t.name.replace(/\s+\d+$/, '') || t.name) === state._waiterCatFilter);

  if (!filtered.length) {
    el.innerHTML = '<p style="color:var(--text3);">Bu kateqoriyada masa yoxdur.</p>';
    return;
  }

  const canViewOthers = hasPermission('waiter.view');
  const canCloseTbl   = hasPermission('table.close');

  el.innerHTML = filtered.map(t => {
    const isMine  = t.occupant === state.user.id;
    const isOther = t.occupant && !isMine;
    const otherW  = isOther ? (state.staff.find(w => w.id === t.occupant) || { name: '?' }) : null;
    const tableOrder = state.tableOrders[t.id];

    let cls = '', statusText = 'Boş', clickAttr = '';

    if (isMine) {
      cls = 'mine';
      statusText = 'Aktiv (mənim)';
      clickAttr = `onclick="openNotesModal('${t.id}')"`;
    } else if (isOther) {
      cls = 'other';
      statusText = `${esc(otherW.name)} xidmət edir`;
      // Baş qarson/kassir/müdir başqasının masasını da aça bilər
      if (canViewOthers) {
        cls = 'other-manage';
        clickAttr = `onclick="openNotesModal('${t.id}')"`;
      }
    } else {
      clickAttr = `onclick="activateTable('${t.id}')"`;
    }

    return `<div class="w-table-card ${cls}" ${clickAttr}>
      <div class="w-table-name">${esc(t.name)}</div>
      <div class="w-table-status">${statusText}</div>
      ${(isMine || (isOther && canViewOthers)) && tableOrder?.total
        ? `<div style="font-size:11px;color:var(--orange);font-weight:700;margin-top:4px;">
             🍔 ${(tableOrder.total||0).toFixed(2)} ₼
           </div>`
        : ''}
      ${isMine && t.notes
        ? `<div style="font-size:11px;color:var(--text3);margin-top:6px;">
             ${esc(t.notes.substring(0, 40))}${t.notes.length > 40 ? '…' : ''}
           </div>`
        : ''}
    </div>`;
  }).join('');
}

function activateTable(tableId) {
  const t = state.tables.find(x=>x.id===tableId);
  if (!t||t.occupant) { showToast('❌ Bu masa artıq aktivdir'); return; }
  state.pendingTableId = tableId;
  document.getElementById('confirmTableName').textContent = t.name;
  document.getElementById('confirmTableModal').classList.add('open');
}

function confirmActivateTable() {
  const tableId = state.pendingTableId;
  if (!tableId) return;
  const t = state.tables.find(x=>x.id===tableId);
  if (!t) return;
  R.tables.child(tableId).update({ occupant: state.user.id });
  addLog('table',`${state.user.name} "${t.name}" masasını aktiv etdi`,{ waiterId:state.user.id, tableId });
  showToast(`✅ ${t.name} aktiv edildi`);
  closeConfirmTableModal();
}

function closeConfirmTableModal() {
  document.getElementById('confirmTableModal').classList.remove('open');
  state.pendingTableId = null;
}

function openNotesModal(tableId) {
  const t = state.tables.find(x=>x.id===tableId);
  if (!t) return;
  state.noteTableId = tableId;
  document.getElementById('noteTitle').textContent = '📝 ' + t.name + ' — Qeydlər';
  document.getElementById('noteText').value = t.notes || '';
  renderNoteOrderSummary(tableId);

  // Masa bağlama düyməsini rol-a görə göstər/gizlət
  const closeBtn = document.getElementById('notesCloseTableBtn');
  if (closeBtn) closeBtn.style.display = hasPermission('table.close') ? 'block' : 'none';

  document.getElementById('notesModal').classList.add('open');
}

function closeNotesModal() { document.getElementById('notesModal').classList.remove('open'); state.noteTableId=null; }

function saveNote() {
  if (!state.noteTableId) return;
  const notes = document.getElementById('noteText').value;
  const t = state.tables.find(x => x.id === state.noteTableId);
  R.tables.child(state.noteTableId).update({ notes });
  addLog('table', `${state.user.name} "${t?.name}" masasına qeyd yazdı: ${notes.substring(0,40)}`, { waiterId: state.user.id, tableId: state.noteTableId });
  closeNotesModal();
  showToast('✅ Qeyd saxlanıldı');
}

function deactivateTable() {
  if (!requirePermission('table.close')) return;
  if (!state.noteTableId) return;
  const t = state.tables.find(x=>x.id===state.noteTableId);
  if (!t) return;
  state.pendingCloseTableId = state.noteTableId;
  closeNotesModal();
  document.getElementById('confirmCloseTableName').textContent = t.name;
  document.getElementById('confirmCloseTableModal').classList.add('open');
}

function confirmDeactivateTable() {
  const tableId = state.pendingCloseTableId;
  if (!tableId) return;
  const t = state.tables.find(x=>x.id===tableId);

  // Köhnə yazışmaları sil
  db.ref('customerRequests').orderByChild('tableId').equalTo(tableId).once('value', snap => {
    snap.forEach(child => child.ref.remove());
  });
  db.ref('chats/' + tableId).remove();
  R.tableOrders.child(tableId).remove();

  R.tables.child(tableId).update({ occupant: null, notes: '' });
  if (t) addLog('table', `${state.user.name} "${t.name}" masasını bağladı`, { waiterId: state.user.id, tableId });
  showToast(`✅ ${t ? t.name : 'Masa'} bağlandı`);
  closeConfirmCloseModal();
}

function closeConfirmCloseModal() {
  document.getElementById('confirmCloseTableModal').classList.remove('open');
  state.pendingCloseTableId = null;
}

/* ── Hesab çapı ── */
function printBill(tableId) {
  if (!tableId) return;
  const t = state.tables.find(x=>x.id===tableId);
  const order = state.tableOrders[tableId];
  const waiterName = state.user?.name || '—';
  const now = new Date();
  const timeStr = now.toLocaleTimeString('az-AZ', {hour:'2-digit', minute:'2-digit'});
  const dateStr = now.toLocaleDateString('az-AZ');

  const items = order?.items ? Object.values(order.items) : [];
  const total = order?.total || 0;

  const itemRows = items.length
    ? items.map(it => {
        const lineTotal = (it.price * it.qty) + (it.extraFee||0);
        return `<tr>
          <td style="padding:4px 0;">${it.qty}x ${it.name}${it.note?` <em style="font-size:11px;color:#666;">(${it.note})</em>`:''}</td>
          <td style="text-align:right;padding:4px 0;">${lineTotal.toFixed(2)} ₼</td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="2" style="color:#999;font-style:italic;">Sifariş yoxdur</td></tr>';

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <title>Hesab — ${t?.name||'Masa'}</title>
  <style>
    body{font-family:'Courier New',monospace;max-width:300px;margin:0 auto;padding:20px;font-size:14px;}
    h2{text-align:center;font-size:18px;margin:0 0 4px;}
    .center{text-align:center;}
    .line{border-top:1px dashed #000;margin:10px 0;}
    table{width:100%;border-collapse:collapse;}
    .total{font-size:18px;font-weight:bold;}
    @media print{body{padding:0;}}
  </style></head>
  <body>
    <h2>🍽️ Restoran</h2>
    <p class="center" style="margin:0;font-size:12px;">${dateStr} ${timeStr}</p>
    <div class="line"></div>
    <p style="margin:4px 0;"><strong>Masa:</strong> ${t?.name||'—'}</p>
    <p style="margin:4px 0;"><strong>Qarson:</strong> ${waiterName}</p>
    <div class="line"></div>
    <table>${itemRows}</table>
    <div class="line"></div>
    <table>
      <tr class="total">
        <td>CƏMİ:</td>
        <td style="text-align:right;">${total.toFixed(2)} ₼</td>
      </tr>
    </table>
    <div class="line"></div>
    <p class="center" style="font-size:12px;margin-top:10px;">Təşəkkür edirik! 🙏</p>
    <script>window.onload=()=>{window.print();}<\/script>
  </body></html>`;

  const w = window.open('', '_blank', 'width=340,height=600');
  if (w) {
    w.document.write(html);
    w.document.close();
    addLog('order', `${waiterName} "${t?.name}" masası üçün hesab çap etdi`, { tableId, waiterId: state.user?.id });
  } else {
    showToast('❌ Çap pəncərəsi bloklandı. Brauzer icazəsini yoxlayın.');
  }
}
