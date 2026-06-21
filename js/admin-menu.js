/* ═══════════════════════════════════════════
   ADMIN — MENYU (MALLAR) CRUD
   Bu fayl: "Menyu" bölməsi — yemək/içki siyahısı, kateqoriya filtri,
   şəkil yükləmə (qarson şəkli ilə eyni məntiq), qiymət, "var/tükənib"
   açar düyməsi, düzəliş, silmə.
   Firebase: /menuItems/{itemId}
═══════════════════════════════════════════ */
function renderMenuItems() {
  const el    = document.getElementById('menuGrid');
  const tabEl = document.getElementById('menuCatTabs');
  if (!state.menuItems.length) {
    el.innerHTML  = '<p style="color:var(--text3);">Hələ mal əlavə edilməyib.</p>';
    tabEl.innerHTML = '';
    return;
  }

  const cats = ['all', ...new Set(state.menuItems.map(m => m.category || 'Digər'))];

  tabEl.innerHTML = cats.map(c => `
    <button onclick="setMenuCat('${esc(c)}')"
      style="padding:8px 18px;border-radius:20px;border:1px solid var(--border);
             background:${state._menuCatFilter===c?'var(--brand-gradient)':'transparent'};
             color:${state._menuCatFilter===c?'white':'var(--text2)'};
             font-weight:600;font-size:13px;cursor:pointer;">
      ${c === 'all' ? '🍔 Hamısı' : esc(c)}
    </button>
  `).join('');

  const filtered = state._menuCatFilter === 'all'
    ? state.menuItems
    : state.menuItems.filter(m => (m.category || 'Digər') === state._menuCatFilter);

  if (!filtered.length) {
    el.innerHTML = '<p style="color:var(--text3);">Bu kateqoriyada mal yoxdur.</p>';
    return;
  }

  el.innerHTML = filtered.map(m => {
    const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(m.name)}&background=f39c12&color=fff&size=200`;
    const available = m.available !== false; // default: var
    return `<div class="item-card">
      <div class="item-card-header">
        <img class="avatar" src="${m.photo || fallback}" alt=""
             onerror="this.src='${fallback}'"
             style="${!available ? 'opacity:.4;' : ''}">
        <div class="item-info">
          <h3>${esc(m.name)}</h3>
          <small style="color:var(--text2);">${esc(m.category || 'Digər')}</small>
          <small style="color:var(--orange);display:block;font-weight:700;">${Number(m.price||0).toFixed(2)} ₼</small>
        </div>
      </div>
      <span class="status-badge ${available?'badge-green':'badge-red'}">${available?'Var':'Tükənib'}</span>
      <div class="item-actions">
        <button class="btn ${available?'btn-red':'btn-green'}" onclick="toggleMenuItemAvailability('${m.id}')">
          ${available?'Tükəndi':'Yenidən Var'}
        </button>
        <button class="btn btn-ghost" onclick="editMenuItem('${m.id}')">✏️</button>
        <button class="btn btn-red" onclick="deleteMenuItem('${m.id}')">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

function setMenuCat(cat) {
  state._menuCatFilter = cat;
  renderMenuItems();
}

function toggleMenuItemAvailability(id) {
  const m = state.menuItems.find(x=>x.id===id);
  if (!m) return;
  const newAvailable = !(m.available !== false);
  R.menuItems.child(id).update({ available: newAvailable });
  addLog('admin', `"${m.name}" ${newAvailable?'yenidən mövcud edildi':'tükəndi olaraq işarələndi'}`, { menuItemId:id });
  showToast(newAvailable?`✅ ${m.name} yenidən mövcuddur`:`🚫 ${m.name} tükəndi`);
}

function editMenuItem(id) {
  const m = state.menuItems.find(x=>x.id===id);
  if (!m) return;
  state.editTarget = { type:'menuItem', id };
  document.getElementById('addModalTitle').textContent = '✏️ Mal Düzəlişi';
  document.getElementById('addModalBody').innerHTML = menuItemForm(m);
  onMenuCategorySelectChange();
  document.getElementById('addModal').classList.add('open');
}

function deleteMenuItem(id) {
  const m = state.menuItems.find(x=>x.id===id);
  if (!confirm(`"${m?.name}" silinsin?`)) return;
  R.menuItems.child(id).remove();
  addLog('admin', `Mal silindi: ${m?.name}`, { menuItemId:id });
  showToast('🗑️ Mal silindi');
}

function menuItemForm(m={}) {
  // Mövcud kateqoriyaları topla (təkrarsız)
  const existingCats = [...new Set(state.menuItems.map(x => x.category).filter(Boolean))];
  const currentCat = m.category || '';
  // Düzəliş zamanı, əgər mövcud kateqoriya siyahısında olmayan bir ad gəlsə (nadir hal), onu da siyahıya əlavə et
  const catOptions = currentCat && !existingCats.includes(currentCat)
    ? [...existingCats, currentCat]
    : existingCats;

  return `
    <!-- Şəkil upload -->
    <div style="text-align:center;margin-bottom:16px;">
      <img id="fm_preview" class="avatar-preview"
           src="${esc(m.photo||'')}"
           style="${m.photo?'display:block':'display:none'}">
      <div class="avatar-upload-area" onclick="document.getElementById('fm_file').click()">
        <div style="font-size:32px;margin-bottom:6px;">🍽️</div>
        <div style="font-size:13px;color:var(--text2);">Şəkil yükləmək üçün klikləyin</div>
        <div style="font-size:11px;color:var(--text3);margin-top:4px;">JPG, PNG — maks. 2MB (istəyə görə)</div>
        <input type="file" id="fm_file" accept="image/*" onchange="previewMenuItemPhoto(this)">
      </div>
      <input type="hidden" id="fm_photo" value="${esc(m.photo||'')}">
    </div>

    <div class="form-group">
      <label>Mal Adı *</label>
      <input type="text" id="fm_name" value="${esc(m.name||'')}" placeholder="Toyuq Şişlik">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Kateqoriya *</label>
        <select id="fm_category_select" onchange="onMenuCategorySelectChange()">
          ${catOptions.map(c => `<option value="${esc(c)}" ${c===currentCat?'selected':''}>${esc(c)}</option>`).join('')}
          <option value="__new__" ${catOptions.length===0?'selected':''}>➕ Yeni Kateqoriya...</option>
        </select>
      </div>
      <div class="form-group">
        <label>Qiymət (₼) *</label>
        <input type="number" id="fm_price" value="${m.price||''}" min="0" step="0.01" placeholder="12.50">
      </div>
    </div>
    <div class="form-group" id="fm_new_category_group" style="display:none;">
      <label>Yeni Kateqoriya Adı *</label>
      <input type="text" id="fm_category_new" placeholder="Məs: Salatlar, Şirniyyatlar">
    </div>
    <div class="form-group">
      <label>Təsvir (istəyə görə)</label>
      <textarea id="fm_description" rows="2" placeholder="Toyuq döşü, közdə bişmiş...">${esc(m.description||'')}</textarea>
    </div>`;
}

function onMenuCategorySelectChange() {
  const select = document.getElementById('fm_category_select');
  const group  = document.getElementById('fm_new_category_group');
  if (select.value === '__new__') {
    group.style.display = 'block';
    document.getElementById('fm_category_new').focus();
  } else {
    group.style.display = 'none';
  }
}

function previewMenuItemPhoto(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    showToast('❌ Şəkil 2MB-dan böyük olmamalıdır');
    input.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    const base64 = e.target.result;
    const preview = document.getElementById('fm_preview');
    if (preview) { preview.src = base64; preview.style.display = 'block'; }
    const photoField = document.getElementById('fm_photo');
    if (photoField) photoField.value = base64;
    showToast('✅ Şəkil yükləndi');
  };
  reader.readAsDataURL(file);
}
