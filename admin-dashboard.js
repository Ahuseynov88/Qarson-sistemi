/* ═══════════════════════════════════════════
   ADMIN — DASHBOARD VƏ TAB İDARƏSİ
   Bu fayl: admin panelin yuxarı tab-larını idarə edir (adminTab),
   hansı bölmənin render olunacağına qərar verir (renderAdmin),
   və "İcmal" (dashboard) bölməsini göstərir.
═══════════════════════════════════════════ */
function renderAdmin() {
  if (state.adminSection==='dashboard') renderDashboard();
  if (state.adminSection==='waiters')   renderWaiters();
  if (state.adminSection==='tables')    renderTables();
  if (state.adminSection==='feedback')  renderFeedbackSection();
}

function adminTab(sec, el) {
  state.adminSection = sec;
  document.querySelectorAll('.admin-tab').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
  document.querySelectorAll('.admin-section').forEach(s=>s.classList.remove('active'));
  document.getElementById('sec-'+sec).classList.add('active');
  renderAdmin();
  document.getElementById('adminFab').style.display = (sec==='waiters'||sec==='tables') ? 'flex':'none';
  if (sec==='settings') {
    document.getElementById('currentKitchenPin').textContent = state.kitchenPin;
    db.ref('settings/menuUrl').once('value', snap => {
      if (snap.val()) document.getElementById('menuUrlInput').value = snap.val();
    });
  }
}

function renderDashboard() {
  const activeW   = state.waiters.filter(w=>w.status!=='offline').length;
  const activeTbl = state.tables.filter(t=>t.occupant).length;
  const pendingO  = state.orders.filter(o=>o.status==='pending').length;
  document.getElementById('statsRow').innerHTML = `
    <div class="stat-card"><div class="stat-num">${state.waiters.length}</div><div class="stat-label">Cəmi Qarson</div></div>
    <div class="stat-card"><div class="stat-num" style="color:var(--green)">${activeW}</div><div class="stat-label">Aktiv Qarson</div></div>
    <div class="stat-card"><div class="stat-num" style="color:var(--blue)">${state.tables.length}</div><div class="stat-label">Cəmi Masa</div></div>
    <div class="stat-card"><div class="stat-num" style="color:var(--orange)">${activeTbl}</div><div class="stat-label">Dolu Masa</div></div>
    <div class="stat-card"><div class="stat-num" style="color:var(--red)">${pendingO}</div><div class="stat-label">Gözləyən Sifariş</div></div>
  `;
  const actTbls = state.tables.filter(t=>t.occupant);
  const el = document.getElementById('activeTables');
  if (!actTbls.length) { el.innerHTML='<p style="color:var(--text3);font-size:14px;">Hal-hazırda aktiv masa yoxdur.</p>'; return; }
  el.innerHTML = actTbls.map(t=>{
    const w = state.waiters.find(x=>x.id===t.occupant)||{name:'?'};
    return `<div class="table-card">
      <h3>🪑 ${esc(t.name)}</h3>
      <div class="meta">Qarson: <strong>${esc(w.name)}</strong></div>
      ${t.notes?`<div style="font-size:13px;color:var(--text2);background:rgba(255,255,255,.04);border-radius:8px;padding:8px;margin-bottom:10px;">${esc(t.notes)}</div>`:''}
      <div style="display:flex;gap:8px;">
        <button class="btn btn-ghost" style="flex:1;padding:10px;font-size:13px;" onclick="adminEditTableNote('${t.id}')">📝 Qeyd</button>
        <button class="btn btn-red" style="flex:1;padding:10px;font-size:13px;" onclick="adminCloseTable('${t.id}')">🔒 Bağla</button>
      </div>
    </div>`;
  }).join('');
}

function adminEditTableNote(tableId) {
  const t = state.tables.find(x=>x.id===tableId);
  if (!t) return;
  state.noteTableId = tableId;
  document.getElementById('adminNoteTitle').textContent = '📝 ' + t.name + ' — Qeyd';
  document.getElementById('adminNoteText').value = t.notes || '';
  document.getElementById('adminNoteModal').classList.add('open');
}

function saveAdminNote() {
  if (!state.noteTableId) return;
  const notes = document.getElementById('adminNoteText').value;
  R.tables.child(state.noteTableId).update({ notes });
  addLog('admin','Admin "' + (state.tables.find(x=>x.id===state.noteTableId)||{name:'?'}).name + '" masasına qeyd əlavə etdi',{});
  closeAdminNoteModal();
  showToast('✅ Qeyd saxlanıldı');
}

function closeAdminNoteModal() {
  document.getElementById('adminNoteModal').classList.remove('open');
  state.noteTableId = null;
}

function adminCloseTable(tableId) {
  const t = state.tables.find(x=>x.id===tableId);
  if (!t) return;
  state.pendingCloseTableId = tableId;
  addLog('table', `Admin "${t.name}" masasını bağlamaq istədi`, { tableId });
  document.getElementById('confirmCloseTableName').textContent = t.name;
  document.getElementById('confirmCloseTableModal').classList.remove('open');
  void document.getElementById('confirmCloseTableModal').offsetWidth;
  document.getElementById('confirmCloseTableModal').classList.add('open');
}
