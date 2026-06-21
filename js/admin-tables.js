/* ═══════════════════════════════════════════
   ADMIN — MASALAR (CRUD)
   Bu fayl: "Masalar" bölməsi — kateqoriya filtri, masa siyahısı,
   masa forması (toplu əlavə), düzəliş, silmə.
═══════════════════════════════════════════ */
function renderTables() {
  const el    = document.getElementById('tablesGrid');
  const tabEl = document.getElementById('tableCatTabs');
  if (!state.tables.length) {
    el.innerHTML  = '<p style="color:var(--text3);">Hələ masa əlavə edilməyib.</p>';
    tabEl.innerHTML = '';
    return;
  }

  const cats = ['all', ...new Set(state.tables.map(t =>
    t.category || t.name.replace(/\s+\d+$/, '') || t.name
  ))];

  tabEl.innerHTML = cats.map(c => `
    <button onclick="setTableCat('${esc(c)}')"
      style="padding:8px 18px;border-radius:20px;border:1px solid var(--border);
             background:${state._tableCatFilter===c?'var(--brand-gradient)':'transparent'};
             color:${state._tableCatFilter===c?'white':'var(--text2)'};
             font-weight:600;font-size:13px;cursor:pointer;">
      ${c === 'all' ? '🪑 Hamısı' : esc(c)}
    </button>
  `).join('');

  const filtered = state._tableCatFilter === 'all'
    ? state.tables
    : state.tables.filter(t =>
        (t.category || t.name.replace(/\s+\d+$/, '') || t.name) === state._tableCatFilter
      );

  if (!filtered.length) {
    el.innerHTML = '<p style="color:var(--text3);">Bu kateqoriyada masa yoxdur.</p>';
    return;
  }

  el.innerHTML = filtered.map(t => {
    const occ = t.occupant
      ? (state.waiters.find(w => w.id === t.occupant) || { name: '?' }).name
      : null;
    return `<div class="table-card">
      <h3>🪑 ${esc(t.name)}</h3>
      <div class="meta">${occ ? `Qarson: <strong>${esc(occ)}</strong>` : 'Boş'}</div>
      <div class="item-actions">
        <button class="btn btn-ghost" onclick="editTable('${t.id}')">✏️ Düzəliş</button>
        <button class="btn btn-blue"  onclick="showQR('${t.id}','${esc(t.name)}')">📱 QR</button>
        <button class="btn btn-red"   onclick="deleteTable('${t.id}')">🗑️ Sil</button>
      </div>
    </div>`;
  }).join('');
}

function setTableCat(cat) {
  state._tableCatFilter = cat;
  renderTables();
}

function editTable(id) {
  const t = state.tables.find(x=>x.id===id);
  if (!t) return;
  state.editTarget = { type:'table', id };
  document.getElementById('addModalTitle').textContent = '✏️ Masa Adını Dəyiş';
  document.getElementById('addModalBody').innerHTML = tableForm(t.name, true);
  document.getElementById('addModal').classList.add('open');
}

function deleteTable(id) {
  const t = state.tables.find(x=>x.id===id);
  if (t?.occupant) {
    showToast(`❌ "${t?.name}" masası hal-hazırda aktivdir! Əvvəlcə masanı bağlayın.`);
    return;
  }
  if (!confirm(`"${t?.name}" masası silinsin?`)) return;
  R.tables.child(id).remove();
  addLog('admin',`Masa silindi: ${t?.name}`,{ tableId:id });
  showToast('🗑️ Masa silindi');
}

function tableForm(name='', isEdit=false) {
  return `
    <div class="form-group">
      <label>Kateqoriya Adı</label>
      <input type="text" id="ft_name" value="${esc(name)}"
        placeholder="Məs: Masa, VIP, Terras, Bar"
        style="font-size:16px;">
      <small style="color:var(--text2);font-size:12px;margin-top:5px;display:block;">
        Bu ad həm kateqoriya, həm də prefiks kimi istifadə olunur.
      </small>
    </div>
    ${!isEdit ? `
    <div class="form-group">
      <label>Neçə ədəd masa yaransın?</label>
      <input type="number" id="ft_count" value="1" min="1" max="99"
        style="font-size:18px;text-align:center;">
      <small style="color:var(--text2);font-size:12px;margin-top:5px;display:block;">
        Məs: "Masa" + 6 → Masa 1, Masa 2 ... Masa 6
      </small>
    </div>` : ''}
  `;
}
