/* ═══════════════════════════════════════════
   YUZA POS — ADMİN PANELİ: MASALAR
   Mərhələ 5: admin.js-dən ayrılıb (məntiq dəyişməyib). Ümumi giriş nöqtəsi — admin.js.
═══════════════════════════════════════════ */
import { state } from './state.js';
import { tableCategoryOf, esc, showToast, confirmAction, addLog } from './utils.js';
import { _toggleSectionBackBtn } from './admin.js';
import { R } from './firebase-service.js';


// Masa kateqoriyasını təhlükəsiz təyin edir - t.name mətn olmaya bilər (köhnə/uyğunsuz
// məlumat üçün), ona görə hər addımda yoxlama edilir ki, TƏK BİR səhv masa BÜTÜN
// siyahını (hətta Firebase-də məlumat düzgün olsa belə) qırmasın.
export function renderTables() {
  const el = document.getElementById('tablesGrid');
  const tabEl = document.getElementById('tableCatTabs');
  // Müvəqqəti bərpa masaları burada göstərilmir - bu bölmə yalnız sabit (qeydiyyatlı)
  // masaların idarəsi üçündür. Onlar qarson panelində (aktiv olduqları müddətdə) görünür.
  const registeredTables = state.tables.filter(t => !t.isRestoredTemp);
  if (!registeredTables.length) {
    el.innerHTML = '<p style="color:var(--text3);">Hələ masa əlavə edilməyib.</p>';
    tabEl.innerHTML = '';
    return;
  }

  const cats = ['all', ...new Set(registeredTables.map(tableCategoryOf))];
  tabEl.innerHTML = cats.map(c => `
    <button onclick="setTableCat('${esc(c)}')" style="padding:8px 18px;border-radius:20px;border:1px solid var(--border);background:${state._tableCatFilter===c?'var(--brand-gradient)':'transparent'};color:${state._tableCatFilter===c?'white':'var(--text2)'};font-weight:600;font-size:13px;cursor:pointer;">
      ${c === 'all' ? '<svg class="icon"><use href="#i-chair"></use></svg> Hamısı' : esc(c)}
    </button>
  `).join('');

  const filtered = state._tableCatFilter === 'all' ? registeredTables : registeredTables.filter(t => tableCategoryOf(t) === state._tableCatFilter);
  if (!filtered.length) {
    el.innerHTML = '<p style="color:var(--text3);">Bu kateqoriyada masa yoxdur.</p>';
    return;
  }

  el.innerHTML = filtered.map(t => {
    const occ = t.occupant ? (state.staff.find(s => s.id === t.occupant) || { name: t.occupant === 'admin' ? 'Rəhbər' : '?' }).name : null;
    return `<div class="tile-card" onclick="selectTableMgmt('${t.id}')">
      <div class="tile-card__icon"><svg class="icon"><use href="#i-chair"></use></svg></div>
      <div class="tile-card__name">${esc(t.name)}</div>
      <div class="tile-card__meta">${occ ? esc(occ) : 'Boş'}</div>
      <span class="status-badge ${occ?'badge-orange':'badge-green'} tile-card__badge">${occ?'Aktiv':'Boş'}</span>
    </div>`;
  }).join('');

  if (state._selectedTableMgmtId) {
    const t = filtered.find(x => x.id === state._selectedTableMgmtId);
    if (t) renderTableMgmtDetail(t); else selectTableMgmt(null);
  }
}

export function selectTableMgmt(id) {
  state._selectedTableMgmtId = id;
  const overlay = document.getElementById('tablesDetailPanel');
  if (!id) { overlay?.classList.remove('open'); _toggleSectionBackBtn(false); return; }
  const t = state.tables.find(x => x.id === id);
  if (!t) { overlay?.classList.remove('open'); _toggleSectionBackBtn(false); return; }
  renderTableMgmtDetail(t);
  _toggleSectionBackBtn(true);
  overlay?.classList.add('open');
}

export function renderTableMgmtDetail(t) {
  const el = document.getElementById('tablesDetailBody');
  if (!el || !t) return;
 const occ = t.occupant ? (state.staff.find(s => s.id === t.occupant) || { name: t.occupant === 'admin' ? 'Rəhbər' : '?' }).name : null;
  el.innerHTML = `
    <div class="ct-detail-header" style="justify-content:center;text-align:center;">
      <span style="font-size:19px;"><svg class="icon"><use href="#i-chair"></use></svg> ${esc(t.name)}</span>
    </div>
    <div class="ct-detail-info-grid">
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Status</div><div class="ct-detail-info-block__value" style="color:${occ?'var(--orange)':'var(--green)'};">${occ?'Aktiv':'Boş'}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">İşçi</div><div class="ct-detail-info-block__value">${occ?esc(occ):'—'}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Kateqoriya</div><div class="ct-detail-info-block__value">${esc(tableCategoryOf(t))}</div></div>
    </div>
    <div class="ct-detail-actions" style="flex-wrap:wrap;">
      <button class="btn btn-blue" style="flex:1;padding:11px;" onclick="editTable('${t.id}')"><svg class="icon"><use href="#i-tag"></use></svg> Adını Dəyiş</button>
      <button class="btn" style="flex:1;padding:11px;border:1px solid var(--border);" onclick="showQR('${t.id}','${esc(t.name)}')"><svg class="icon"><use href="#i-qr"></use></svg> QR Kod</button>
      <button class="btn btn-red" style="flex:1;padding:11px;" onclick="deleteTable('${t.id}')"><svg class="icon"><use href="#i-trash"></use></svg> Sil</button>
    </div>
  `;
}

export function setTableCat(cat) { state._tableCatFilter = cat; renderTables(); }

export function editTable(id) {
  const t = state.tables.find(x=>x.id===id);
  if (!t) return;
  state.editTarget = { type:'table', id };
  document.getElementById('addModalTitle').innerHTML = '<svg class="icon"><use href="#i-edit"></use></svg> Masa Adını Dəyiş';
  document.getElementById('addModalBody').innerHTML = tableForm(t.name, true);
  document.getElementById('addModal').classList.add('open');
}

export function deleteTable(id) {
  const t = state.tables.find(x=>x.id===id);
  if (t?.occupant) { showToast(`<svg class="icon"><use href="#i-error"></use></svg> "${t?.name}" masası aktivdir! Əvvəlcə bağlayın.`); return; }
  confirmAction(`"${esc(t?.name)}" masası silinsin?`, () => {
    R.tables.child(id).remove();
    addLog('table_mgmt',`Masa silindi: ${t?.name}`,{ tableId:id });
    state.tables = state.tables.filter(x => x.id !== id);
    if (state._selectedTableMgmtId === id) state._selectedTableMgmtId = null;
    renderTables();
    showToast('<svg class="icon"><use href="#i-trash"></use></svg> Masa silindi');
  });
}

export function tableForm(name='', isEdit=false) {
  return `
    <div class="form-group">
      <label>Kateqoriya Adı</label>
      <input type="text" id="ft_name" value="${esc(name)}" placeholder="Məs: Masa, VIP, Terras, Bar" style="font-size:16px;">
      <small style="color:var(--text2);font-size:12px;margin-top:5px;display:block;">Bu ad həm kateqoriya, həm də prefiks kimi istifadə olunur.</small>
    </div>
    ${!isEdit ? `
    <div class="form-group">
      <label>Neçə ədəd masa yaransın?</label>
      <input type="number" id="ft_count" value="1" min="1" max="99" style="font-size:18px;text-align:center;">
      <small style="color:var(--text2);font-size:12px;margin-top:5px;display:block;">Məs: "Masa" + 6 → Masa 1, Masa 2 ... Masa 6</small>
    </div>` : ''}
  `;
}
