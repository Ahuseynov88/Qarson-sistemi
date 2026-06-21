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
  if (!state.user || state.user.role !== 'waiter') return;
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

  el.innerHTML = filtered.map(t => {
    const isMine  = t.occupant === state.user.id;
    const isOther = t.occupant && !isMine;
    const otherW  = isOther ? (state.waiters.find(w => w.id === t.occupant) || { name: '?' }) : null;
    const tableOrder = state.tableOrders[t.id];
    let cls = '', statusText = 'Boş', clickAttr = '';
    if (isMine)       { cls = 'mine';  statusText = 'Aktiv (mənim)'; clickAttr = `onclick="openNotesModal('${t.id}')"`;  }
    else if (isOther) { cls = 'other'; statusText = `${esc(otherW.name)} xidmət edir`; }
    else              { clickAttr = `onclick="activateTable('${t.id}')"`;  }
    return `<div class="w-table-card ${cls}" ${clickAttr}>
      <div class="w-table-name">${esc(t.name)}</div>
      <div class="w-table-status">${statusText}</div>
      ${isMine && tableOrder?.total
        ? `<div style="font-size:12px;color:var(--orange);font-weight:700;margin-top:6px;">
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
