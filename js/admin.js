/* ═══════════════════════════════════════════
   ADMIN PANELİ
   Məntiq orijinaldan dəyişmədən köçürülüb - yalnız modula ayrılıb.
   Mövcud HTML `onclick=""` atributları ilə işlədiyi üçün funksiyalar
   `window`-a təyin edilir (bax: fayl sonu).
═══════════════════════════════════════════ */
import { R, db } from './firebase-service.js';
import { state } from './state.js';
import { esc, toArr, showToast, addLog, formatItemsList, stripTableName, confirmAction, confirmDelete2x } from './utils.js';
import { hasPermission, PERMISSION_PRESETS, ALL_PERMISSIONS } from './permissions.js';

export function renderPermissionCheckboxes(existingPerms = []) {
  return ALL_PERMISSIONS.map(group => `
    <div style="margin-bottom:16px;">
      <div style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid var(--border);">
        ${group.icon} ${group.group}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
        ${group.items.map(item => `
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--text);padding:6px 8px;border-radius:8px;background:var(--bg);border:1px solid var(--border);">
            <input type="checkbox" name="staff_perm" value="${item.key}" ${existingPerms.includes(item.key) ? 'checked' : ''} style="accent-color:var(--green);width:16px;height:16px;flex-shrink:0;">
            ${item.label}
          </label>
        `).join('')}
      </div>
    </div>
  `).join('');
}

export function readPermissionCheckboxes() {
  const checkboxes = document.querySelectorAll('input[name="staff_perm"]:checked');
  return Array.from(checkboxes).map(cb => cb.value);
}

export function applyPermissionPreset(presetKey) {
  const preset = PERMISSION_PRESETS[presetKey];
  if (!preset) return;
  document.querySelectorAll('input[name="staff_perm"]').forEach(cb => {
    cb.checked = preset.perms.includes(cb.value);
  });
}

export function renderAdmin() {
  if (state.adminSection==='dashboard') renderDashboard();
  if (state.adminSection==='staff')     renderStaff();
  if (state.adminSection==='tables')    renderTables();
  if (state.adminSection==='menu')      renderMenuItems();
  if (state.adminSection==='logs')      renderLogs();
  if (state.adminSection==='feedback')  renderFeedbackSection();
  if (state.adminSection==='customers') renderCustomers();
  if (state.adminSection==='paymentMethods') renderPaymentMethods();
  if (state.adminSection==='closedOrders') renderClosedOrders();
}

export function adminTab(sec, el) {
  state.adminSection = sec;
  document.querySelectorAll('.admin-tab').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
  document.querySelectorAll('.admin-section').forEach(s=>s.classList.remove('active'));
  document.getElementById('sec-'+sec).classList.add('active');
  renderAdmin();
  document.getElementById('adminFab').style.display = (sec==='tables'||sec==='menu'||sec==='staff'||sec==='customers'||sec==='paymentMethods') ? 'flex':'none';
  if (sec==='settings') {
    document.getElementById('currentKitchenPin').textContent = state.kitchenPin;
    db.ref('settings/menuUrl').once('value', snap => {
      if (snap.val()) document.getElementById('menuUrlInput').value = snap.val();
    });
  }
}

export function renderDashboard() {
  const activeStaff = state.staff.filter(s=>s.status!=='offline').length;
  const activeTbl = state.tables.filter(t=>t.occupant).length;
  const pendingO  = state.orders.filter(o=>o.status==='pending').length;
  document.getElementById('statsRow').innerHTML = `
    <div class="stat-card"><div class="stat-num">${state.staff.length}</div><div class="stat-label">Cəmi İşçi</div></div>
    <div class="stat-card"><div class="stat-num" style="color:var(--green)">${activeStaff}</div><div class="stat-label">Aktiv İşçi</div></div>
    <div class="stat-card"><div class="stat-num" style="color:var(--blue)">${state.tables.length}</div><div class="stat-label">Cəmi Masa</div></div>
    <div class="stat-card"><div class="stat-num" style="color:var(--orange)">${activeTbl}</div><div class="stat-label">Dolu Masa</div></div>
    <div class="stat-card"><div class="stat-num" style="color:var(--red)">${pendingO}</div><div class="stat-label">Gözləyən Sifariş</div></div>
  `;
}

export function adminEditTableNote(tableId) {
  const t = state.tables.find(x=>x.id===tableId);
  if (!t) return;
  state.noteTableId = tableId;
  document.getElementById('adminNoteTitle').innerHTML = '<svg class="icon"><use href="#i-note"></use></svg> ' + t.name + ' — Qeyd';
  document.getElementById('adminNoteText').value = t.notes || '';
  document.getElementById('adminNoteModal').classList.add('open');
}

export function saveAdminNote() {
  if (!state.noteTableId) return;
  const notes = document.getElementById('adminNoteText').value;
  R.tables.child(state.noteTableId).update({ notes });
  addLog('admin','Admin "' + (state.tables.find(x=>x.id===state.noteTableId)||{name:'?'}).name + '" masasına qeyd əlavə etdi',{});
  closeAdminNoteModal();
  showToast('<svg class="icon"><use href="#i-check"></use></svg> Qeyd saxlanıldı');
}

export function closeAdminNoteModal() {
  document.getElementById('adminNoteModal').classList.remove('open');
  state.noteTableId = null;
}

export function adminCloseTable(tableId) {
  const t = state.tables.find(x=>x.id===tableId);
  if (!t) return;
  state.pendingCloseTableId = tableId;
  addLog('table', `Admin "${t.name}" masasını bağlamaq istədi`, { tableId });
  document.getElementById('confirmCloseTableName').textContent = t.name;
  document.getElementById('confirmCloseTableModal').classList.remove('open');
  void document.getElementById('confirmCloseTableModal').offsetWidth;
  document.getElementById('confirmCloseTableModal').classList.add('open');
}

export function renderFeedbackSection() {
  const el = document.getElementById('feedbackList');
  if (!el) return;

  db.ref('customerRequests').orderByChild('status').equalTo('pending').once('value', snap => {
    const reqData = snap.val() || {};
    const reqs = Object.keys(reqData).map(k=>({id:k,...reqData[k]}));
    const reqColors = { call:'#f1c40f', bill_cash:'#2ecc71', bill_pos:'#3498db', message:'#e67e22' };
    const reqIcons  = { call:'<svg class="icon"><use href="#i-bell"></use></svg>', bill_cash:'<svg class="icon"><use href="#i-cash"></use></svg>', bill_pos:'<svg class="icon"><use href="#i-card"></use></svg>', message:'<svg class="icon"><use href="#i-chat"></use></svg>' };

    let html = '';
    state._selectedRequestIds = (state._selectedRequestIds||[]).filter(id => reqs.some(r=>r.id===id));
    if (reqs.length) {
      const allReqChecked = reqs.length>0 && reqs.every(r=>state._selectedRequestIds.includes(r.id));
      html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <label style="display:flex;align-items:center;gap:8px;color:var(--orange);font-size:12px;font-weight:700;text-transform:uppercase;cursor:pointer;">
          <input type="checkbox" onchange="toggleSelectAllRequests(this.checked)" ${allReqChecked?'checked':''} style="width:16px;height:16px;cursor:pointer;">
          <svg class="icon"><use href="#i-bolt"></use></svg> Aktiv Tələblər
        </label>
        <button id="requestDeleteSelectedBtn" class="btn btn-red" style="display:${state._selectedRequestIds.length?'inline-flex':'none'};padding:5px 12px;font-size:11px;" onclick="deleteSelectedRequests()"><svg class="icon"><use href="#i-trash"></use></svg> Seçilənləri Sil (${state._selectedRequestIds.length})</button>
      </div>`;
      html += reqs.map(r=>`
        <div class="log-item" style="border-left:3px solid ${reqColors[r.type]||'#aaa'};margin-bottom:6px;">
          <input type="checkbox" onchange="toggleRequestSelect('${r.id}')" ${state._selectedRequestIds.includes(r.id)?'checked':''} style="width:16px;height:16px;flex-shrink:0;margin-top:2px;cursor:pointer;">
          <span class="log-badge" style="background:${reqColors[r.type]||'#aaa'}22;color:${reqColors[r.type]||'#aaa'}">${reqIcons[r.type]||'<svg class="icon"><use href="#i-clipboard"></use></svg>'} ${esc(r.tableName||'')}</span>
          <span class="log-text">${esc(r.message||'')}</span>
          <span class="log-time">${r.time||''}</span>
        </div>
      `).join('');
    }

    const feedbacks = state._feedbacks || [];
    state._selectedFeedbackIds = (state._selectedFeedbackIds||[]).filter(id => feedbacks.some(f=>f.id===id));
    if (feedbacks.length) {
      const allFbChecked = feedbacks.length>0 && feedbacks.every(f=>state._selectedFeedbackIds.includes(f.id));
      html += `<div style="display:flex;justify-content:space-between;align-items:center;margin:14px 0 8px;">
        <label style="display:flex;align-items:center;gap:8px;color:var(--text2);font-size:12px;font-weight:700;text-transform:uppercase;cursor:pointer;margin:0;">
          <input type="checkbox" onchange="toggleSelectAllFeedbacks(this.checked)" ${allFbChecked?'checked':''} style="width:16px;height:16px;cursor:pointer;">
          <svg class="icon"><use href="#i-note"></use></svg> Şikayət / Təkliflər
        </label>
        <button id="feedbackDeleteSelectedBtn" class="btn btn-red" style="display:${state._selectedFeedbackIds.length?'inline-flex':'none'};padding:5px 12px;font-size:11px;" onclick="deleteSelectedFeedbacks()"><svg class="icon"><use href="#i-trash"></use></svg> Seçilənləri Sil (${state._selectedFeedbackIds.length})</button>
      </div>`;
      html += feedbacks.map(f=>`
        <div class="log-item" style="margin-bottom:6px;">
          <input type="checkbox" onchange="toggleFeedbackSelect('${f.id}')" ${state._selectedFeedbackIds.includes(f.id)?'checked':''} style="width:16px;height:16px;flex-shrink:0;margin-top:2px;cursor:pointer;">
          <span class="log-badge" style="background:#2ecc7122;color:#2ecc71"><svg class="icon"><use href="#i-note"></use></svg> ${esc(f.tableName||'')}</span>
          <span class="log-text">${esc(f.message)}</span>
          <span class="log-time">${f.time} ${f.date||''}</span>
        </div>
      `).join('');
    }

    if (!html) html='<p style="color:var(--text3);padding:16px;">Hələ tələb/şikayət yoxdur.</p>';
    el.innerHTML = html;
  });
}

export function toggleRequestSelect(id) {
  state._selectedRequestIds = state._selectedRequestIds || [];
  const i = state._selectedRequestIds.indexOf(id);
  if (i === -1) state._selectedRequestIds.push(id); else state._selectedRequestIds.splice(i,1);
  const btn = document.getElementById('requestDeleteSelectedBtn');
  if (btn) {
    btn.style.display = state._selectedRequestIds.length ? 'inline-flex' : 'none';
    btn.innerHTML = `<svg class="icon"><use href="#i-trash"></use></svg> Seçilənləri Sil (${state._selectedRequestIds.length})`;
  }
}

export function toggleSelectAllRequests(checked) {
  db.ref('customerRequests').orderByChild('status').equalTo('pending').once('value', snap => {
    const ids = Object.keys(snap.val() || {});
    state._selectedRequestIds = checked ? ids : [];
    renderFeedbackSection();
  });
}

export function deleteSelectedRequests() {
  const ids = state._selectedRequestIds || [];
  if (!ids.length) return;
  confirmDelete2x(ids.length, 'tələb', () => {
    ids.forEach(id => db.ref('customerRequests/' + id).remove());
    addLog('admin', `Admin ${ids.length} müştəri tələbini seçib sildi`, {});
    showToast(`<svg class="icon"><use href="#i-check"></use></svg> ${ids.length} tələb silindi`);
    state._selectedRequestIds = [];
    renderFeedbackSection();
  });
}

export function toggleSelectAllFeedbacks(checked) {
  state._selectedFeedbackIds = checked ? (state._feedbacks||[]).map(f=>f.id) : [];
  renderFeedbackSection();
}

export function toggleFeedbackSelect(id) {
  state._selectedFeedbackIds = state._selectedFeedbackIds || [];
  const i = state._selectedFeedbackIds.indexOf(id);
  if (i === -1) state._selectedFeedbackIds.push(id); else state._selectedFeedbackIds.splice(i,1);
  const btn = document.getElementById('feedbackDeleteSelectedBtn');
  if (btn) {
    btn.style.display = state._selectedFeedbackIds.length ? 'inline-flex' : 'none';
    btn.innerHTML = `<svg class="icon"><use href="#i-trash"></use></svg> Seçilənləri Sil (${state._selectedFeedbackIds.length})`;
  }
}

export function deleteSelectedFeedbacks() {
  const ids = state._selectedFeedbackIds || [];
  if (!ids.length) return;
  confirmDelete2x(ids.length, 'şikayət', () => {
    ids.forEach(id => db.ref('feedbacks/' + id).remove());
    addLog('admin', `Admin ${ids.length} şikayəti seçib sildi`, {});
    showToast(`<svg class="icon"><use href="#i-check"></use></svg> ${ids.length} şikayət silindi`);
    state._selectedFeedbackIds = [];
    renderFeedbackSection();
  });
}

export function clearOldFeedbacks() {
  confirmAction('30 gündən köhnə bütün şikayətlər silinsin?', () => {
    const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
    db.ref('feedbacks').once('value', snap => {
      const data = snap.val() || {};
      let deletedCount = 0;
      Object.keys(data).forEach(key => {
        if (data[key].createdAt < cutoff) {
          db.ref('feedbacks/' + key).remove();
          deletedCount++;
        }
      });
      addLog('admin', `${deletedCount} köhnə şikayət silindi`, {});
      showToast(`<svg class="icon"><use href="#i-check"></use></svg> ${deletedCount} şikayət silindi`);
    });
  });
}

export function renderMenuItems() {
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
      ${c === 'all' ? '<svg class="icon"><use href="#i-food"></use></svg> Hamısı' : esc(c)}
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
    const available = m.available !== false;
    return `<div class="item-card">
      <div class="item-card-header">
        <img class="avatar" src="${m.photo || fallback}" alt="" onerror="this.src='${fallback}'" style="${!available ? 'opacity:.4;' : ''}">
        <div class="item-info">
          <h3>${esc(m.name)}</h3>
          <small style="color:var(--text2);">${esc(m.category || 'Digər')}</small>
          <small style="color:var(--orange);display:block;font-weight:700;">${Number(m.price||0).toFixed(2)} ₼</small>
        </div>
      </div>
      <span class="status-badge ${available?'badge-green':'badge-red'}">${available?'Var':'Tükənib'}</span>
      <div class="item-actions">
        <button class="btn ${available?'btn-red':'btn-green'}" onclick="toggleMenuItemAvailability('${m.id}')">${available?'Tükəndi':'Yenidən Var'}</button>
        <button class="btn btn-ghost" onclick="editMenuItem('${m.id}')"><svg class="icon"><use href="#i-edit"></use></svg></button>
        <button class="btn btn-red" onclick="deleteMenuItem('${m.id}')"><svg class="icon"><use href="#i-trash"></use></svg></button>
      </div>
    </div>`;
  }).join('');
}

export function setMenuCat(cat) {
  state._menuCatFilter = cat;
  renderMenuItems();
}

export function toggleMenuItemAvailability(id) {
  const m = state.menuItems.find(x=>x.id===id);
  if (!m) return;
  const newAvailable = !(m.available !== false);
  R.menuItems.child(id).update({ available: newAvailable });
  addLog('admin', `"${m.name}" ${newAvailable?'yenidən mövcud edildi':'tükəndi olaraq işarələndi'}`, { menuItemId:id });
  showToast(newAvailable?`<svg class="icon"><use href="#i-check"></use></svg> ${m.name} yenidən mövcuddur`:`<svg class="icon"><use href="#i-ban"></use></svg> ${m.name} tükəndi`);
}

export function editMenuItem(id) {
  const m = state.menuItems.find(x=>x.id===id);
  if (!m) return;
  state.editTarget = { type:'menuItem', id };
  document.getElementById('addModalTitle').innerHTML = '<svg class="icon"><use href="#i-edit"></use></svg> Mal Düzəlişi';
  document.getElementById('addModalBody').innerHTML = menuItemForm(m);
  onMenuCategorySelectChange();
  document.getElementById('addModal').classList.add('open');
}

export function deleteMenuItem(id) {
  const m = state.menuItems.find(x=>x.id===id);
  confirmAction(`"${esc(m?.name)}" silinsin?`, () => {
    R.menuItems.child(id).remove();
    addLog('admin', `Mal silindi: ${m?.name}`, { menuItemId:id });
    showToast('<svg class="icon"><use href="#i-trash"></use></svg> Mal silindi');
  });
}

export function menuItemForm(m={}) {
  const existingCats = [...new Set(state.menuItems.map(x => x.category).filter(Boolean))];
  const currentCat = m.category || '';
  const catOptions = currentCat && !existingCats.includes(currentCat) ? [...existingCats, currentCat] : existingCats;

  return `
    <div style="text-align:center;margin-bottom:16px;">
      <img id="fm_preview" class="avatar-preview" src="${esc(m.photo||'')}" style="${m.photo?'display:block':'display:none'}">
      <div class="avatar-upload-area" onclick="document.getElementById('fm_file').click()">
        <div style="font-size:32px;margin-bottom:6px;"><svg class="icon"><use href="#i-utensils"></use></svg></div>
        <div style="font-size:13px;color:var(--text2);">Şəkil yükləmək üçün klikləyin</div>
        <div style="font-size:11px;color:var(--text3);margin-top:4px;">JPG, PNG — maks. 2MB</div>
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
          <option value="__new__" ${catOptions.length===0?'selected':''}><svg class="icon"><use href="#i-plus"></use></svg> Yeni Kateqoriya...</option>
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

export function onMenuCategorySelectChange() {
  const select = document.getElementById('fm_category_select');
  const group  = document.getElementById('fm_new_category_group');
  if (select.value === '__new__') {
    group.style.display = 'block';
    document.getElementById('fm_category_new').focus();
  } else {
    group.style.display = 'none';
  }
}

export function previewMenuItemPhoto(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    showToast('<svg class="icon"><use href="#i-error"></use></svg> Şəkil 2MB-dan böyük olmamalıdır');
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
    showToast('<svg class="icon"><use href="#i-check"></use></svg> Şəkil yükləndi');
  };
  reader.readAsDataURL(file);
}

export function openAddModal() {
  state.editTarget = null;
  if (state.adminSection === 'staff') {
    openAddStaffModal();
    return;
  }
  if (state.adminSection === 'menu') {
    document.getElementById('addModalTitle').innerHTML = '<svg class="icon"><use href="#i-plus"></use></svg> Yeni Mal';
    document.getElementById('addModalBody').innerHTML = menuItemForm({});
    onMenuCategorySelectChange();
  } else if (state.adminSection === 'customers') {
    document.getElementById('addModalTitle').innerHTML = '<svg class="icon"><use href="#i-plus"></use></svg> Yeni Müştəri';
    document.getElementById('addModalBody').innerHTML = customerForm({});
  } else if (state.adminSection === 'paymentMethods') {
    document.getElementById('addModalTitle').innerHTML = '<svg class="icon"><use href="#i-plus"></use></svg> Yeni Ödəniş Növü';
    document.getElementById('addModalBody').innerHTML = paymentMethodForm({});
  } else {
    document.getElementById('addModalTitle').innerHTML = '<svg class="icon"><use href="#i-plus"></use></svg> Yeni Kateqoriya və Masalar';
    document.getElementById('addModalBody').innerHTML = tableForm('', false);
  }
  document.getElementById('addModal').classList.add('open');
}

export function closeAddModal() {
  const modal = document.getElementById('addModal');
  if (modal) {
    modal.classList.remove('open');
    modal.style.display = '';
  }
  state.editTarget = null;
}

export function saveItem() {
  const sec = state.editTarget
    ? state.editTarget.type
    : (state.adminSection === 'menu' ? 'menuItem' : state.adminSection === 'staff' ? 'staff' : state.adminSection === 'customers' ? 'customer' : state.adminSection === 'paymentMethods' ? 'paymentMethod' : 'table');

  if (sec === 'staff') { saveStaff(); return; }
  if (sec === 'customer') { saveCustomer(); return; }
  if (sec === 'paymentMethod') { savePaymentMethod(); return; }

  if (sec === 'menuItem') {
    const name = (document.getElementById('fm_name')?.value||'').trim();
    const categorySelect = document.getElementById('fm_category_select')?.value || '';
    const category = categorySelect === '__new__' ? (document.getElementById('fm_category_new')?.value||'').trim() : categorySelect.trim();
    const priceRaw = (document.getElementById('fm_price')?.value||'').trim();
    const description = (document.getElementById('fm_description')?.value||'').trim();
    const photo = (document.getElementById('fm_photo')?.value||'').trim();

    if (!name) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Mal adı mütləqdir'); return; }
    if (!category) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Kateqoriya mütləqdir'); return; }
    const price = parseFloat(priceRaw);
    if (isNaN(price) || price < 0) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Düzgün qiymət daxil edin'); return; }

    const menuItemData = { name, category, price, description, photo };

    if (state.editTarget) {
      R.menuItems.child(state.editTarget.id).update(menuItemData);
      addLog('admin', `Mal yeniləndi: ${name}`, { menuItemId: state.editTarget.id });
      showToast('<svg class="icon"><use href="#i-check"></use></svg> Mal yeniləndi');
    } else {
      R.menuItems.push({ ...menuItemData, available: true, createdAt: Date.now() });
      addLog('admin', `Yeni mal əlavə edildi: ${name}`, {});
      showToast('<svg class="icon"><use href="#i-check"></use></svg> Mal əlavə edildi');
    }
  } else {
    const prefix = document.getElementById('ft_name').value.trim();
    if (!prefix) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Kateqoriya adı lazımdır'); return; }

    if (state.editTarget) {
      R.tables.child(state.editTarget.id).update({ name: prefix });
      addLog('admin', `Masa adı dəyişdirildi: ${prefix}`, {});
      showToast('<svg class="icon"><use href="#i-check"></use></svg> Masa yeniləndi');
    } else {
      const count = parseInt(document.getElementById('ft_count').value) || 1;
      for (let i = 1; i <= count; i++) {
        const tName = count === 1 ? prefix : `${prefix} ${i}`;
        R.tables.push({ name: tName, category: prefix, occupant: null, notes: '', createdAt: Date.now() + i });
      }
      addLog('admin', `${count} ədəd masa əlavə edildi: ${prefix}`, {});
      showToast(`<svg class="icon"><use href="#i-check"></use></svg> ${count} ədəd masa əlavə edildi`);
    }
  }
  closeAddModal();
}

export function openKitchenPinModal() {
  document.getElementById('newKitchenPin').value = '';
  document.getElementById('kitchenPinModal').classList.add('open');
}

export function closeKitchenPinModal() { document.getElementById('kitchenPinModal').classList.remove('open'); }

export function saveKitchenPin() {
  const pin = document.getElementById('newKitchenPin').value.trim();
  if (pin.length !== 4 || !/^\d{4}$/.test(pin)) { showToast('<svg class="icon"><use href="#i-error"></use></svg> 4 rəqəmli PIN daxil edin'); return; }
  if (String(pin) === String(ADMIN_PIN)) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Admin PIN ilə eyni ola bilməz'); return; }
  db.ref('settings/kitchenPin').set(pin);
  state.kitchenPin = pin;
  addLog('admin','Mətbəx PIN dəyişdirildi',{});
  closeKitchenPinModal();
  showToast('<svg class="icon"><use href="#i-check"></use></svg> Mətbəx PIN dəyişdirildi');
}

export function saveMenuUrl() {
  const url = document.getElementById('menuUrlInput').value.trim();
  if (!url) { showToast('<svg class="icon"><use href="#i-error"></use></svg> URL boş ola bilməz'); return; }
  db.ref('settings/menuUrl').set(url);
  addLog('admin',`Menyu URL dəyişdirildi: ${url}`,{});
  document.getElementById('menuUrlStatus').innerHTML = '<svg class="icon"><use href="#i-check"></use></svg> Yadda saxlanıldı';
  setTimeout(()=>{ document.getElementById('menuUrlStatus').textContent=''; },3000);
  showToast('<svg class="icon"><use href="#i-check"></use></svg> Menyu URL yadda saxlandı');
}

export function renderStaff() {
  const el = document.getElementById('staffGrid');
  if (!el) return;
  if (!state.staff || !state.staff.length) {
    el.innerHTML = '<p style="color:var(--text3);">Hələ işçi əlavə edilməyib.</p>';
    return;
  }

  el.innerHTML = state.staff.map(s => {
    const permCount = (s.permissions || []).length;
    const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(s.name)}&background=8e44ad&color=fff&size=200`;
    const st = s.status === 'offline' ? 'Deaktiv' : 'Aktiv';
    const bc = s.status === 'offline' ? 'badge-red' : 'badge-green';
    return `<div class="item-card">
      <div class="item-card-header">
        <img class="avatar" src="${s.avatar || fallback}" alt="" onerror="this.src='${fallback}'">
        <div class="item-info">
          <h3>${esc(s.name)}</h3>
          <small style="color:var(--text2);">${esc(s.position || 'İşçi')}</small>
          <small style="color:var(--purple);display:block;font-weight:600;"><svg class="icon"><use href="#i-key"></use></svg> ${permCount} icazə</small>
          ${s.phone ? `<small style="color:var(--text3);display:block;"><svg class="icon"><use href="#i-phone"></use></svg> ${esc(s.phone)}</small>` : ''}
        </div>
      </div>
      <span class="status-badge ${bc}">${st}</span>
      <div class="item-actions">
        <button class="btn ${s.status==='offline'?'btn-green':'btn-red'}" onclick="toggleStaff('${s.id}')">${s.status==='offline'?'Aktiv Et':'Deaktiv Et'}</button>
        <button class="btn btn-ghost" onclick="editStaff('${s.id}')"><svg class="icon"><use href="#i-edit"></use></svg></button>
        <button class="btn btn-red" onclick="deleteStaff('${s.id}')"><svg class="icon"><use href="#i-trash"></use></svg></button>
      </div>
    </div>`;
  }).join('');
}

export function toggleStaff(id) {
  const s = state.staff.find(x=>x.id===id);
  if (!s) return;
  const newStatus = s.status === 'offline' ? 'active' : 'offline';
  db.ref('staff').child(id).update({ status: newStatus });
  addLog('admin', `İşçi ${newStatus==='active'?'aktiv':'deaktiv'} edildi: ${s.name}`, { staffId: id });
  showToast(newStatus==='active' ? `<svg class="icon"><use href="#i-check"></use></svg> ${s.name} aktiv edildi` : `<svg class="icon"><use href="#i-ban"></use></svg> ${s.name} deaktiv edildi`);
}

export function editStaff(id) {
  const s = state.staff.find(x=>x.id===id);
  if (!s) return;
  state.editTarget = { type: 'staff', id };
  document.getElementById('addModalTitle').innerHTML = '<svg class="icon"><use href="#i-edit"></use></svg> İşçi Düzəliş';
  document.getElementById('addModalBody').innerHTML = staffForm(s);
  document.getElementById('addModal').classList.add('open');
}

export function deleteStaff(id) {
  const s = state.staff.find(x=>x.id===id);
  const activeTable = state.tables.find(t => t.occupant === id);
  if (activeTable) { showToast(`<svg class="icon"><use href="#i-error"></use></svg> "${s?.name}" adlı işçinin "${activeTable.name}" masası aktivdir! Əvvəlcə masanı bağlayın.`); return; }
  confirmAction(`"${esc(s?.name)}" adlı işçi silinsin?`, () => {
    db.ref('staff').child(id).remove();
    addLog('admin', `İşçi silindi: ${s?.name}`, { staffId: id });
    showToast('<svg class="icon"><use href="#i-trash"></use></svg> İşçi silindi');
  });
}

export function openAddStaffModal() {
  state.editTarget = { type: 'staff' };
  document.getElementById('addModalTitle').innerHTML = '<svg class="icon"><use href="#i-plus"></use></svg> Yeni İşçi';
  document.getElementById('addModalBody').innerHTML = staffForm({});
  document.getElementById('addModal').classList.add('open');
}

export function onStaffPositionChange() {
  const pos = document.getElementById('fs_position').value;
  const map = { 'Qarson': 'waiter', 'Baş Qarson': 'head_waiter', 'Kassir': 'cashier', 'Müdir': 'manager' };
  if (map[pos]) applyPermissionPreset(map[pos]);
}

export function saveStaff() {
  const firstname = (document.getElementById('fs_firstname')?.value||'').trim();
  const lastname = (document.getElementById('fs_lastname')?.value||'').trim();
  const position = (document.getElementById('fs_position')?.value||'').trim();
  const pin = (document.getElementById('fs_pin')?.value||'').trim();
  const phone = (document.getElementById('fs_phone')?.value||'').trim();
  const fin = (document.getElementById('fs_fin')?.value||'').trim();
  const avatarVal = (document.getElementById('fs_avatar')?.value||'').trim();
  const permissions = readPermissionCheckboxes();

  if (!firstname || !lastname) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Ad və Soyad mütləqdir'); return; }
  if (!position) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Vəzifə seçilməlidir'); return; }
  if (pin.length !== 4 || !/^\d{4}$/.test(pin)) { showToast('<svg class="icon"><use href="#i-error"></use></svg> 4 rəqəmli PIN lazımdır'); return; }

  const conflict = state.staff?.find(s => s.pin === pin && (!state.editTarget?.id || s.id !== state.editTarget.id));
  if (conflict) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Bu PIN artıq istifadə olunur'); return; }

  const name = `${firstname} ${lastname}`;
  const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=8e44ad&color=fff&size=200`;
  const avatar = avatarVal || fallback;

  const staffData = { name, firstname, lastname, position, pin, phone, fin, avatar, permissions };

  if (state.editTarget?.id) {
    db.ref('staff').child(state.editTarget.id).update(staffData);
    addLog('admin', `İşçi yeniləndi: ${name}`, { staffId: state.editTarget.id });
    showToast('<svg class="icon"><use href="#i-check"></use></svg> İşçi yeniləndi');
  } else {
    db.ref('staff').push({ ...staffData, status: 'active', createdAt: Date.now() });
    addLog('admin', `Yeni işçi əlavə edildi: ${name}`, {});
    showToast('<svg class="icon"><use href="#i-check"></use></svg> İşçi əlavə edildi');
  }
  closeAddModal();
}

export function staffForm(s = {}) {
  const existingPerms = s.permissions || [];
  const currentPos = s.position || '';
  return `
    <div style="text-align:center;margin-bottom:16px;">
      <img id="fs_preview" class="avatar-preview" src="${esc(s.avatar||'')}" style="${s.avatar?'display:block':'display:none'}">
      <div class="avatar-upload-area" onclick="document.getElementById('fs_file').click()">
        <div style="font-size:32px;margin-bottom:6px;"><svg class="icon"><use href="#i-user"></use></svg></div>
        <div style="font-size:13px;color:var(--text2);">Şəkil yükləmək üçün klikləyin</div>
        <input type="file" id="fs_file" accept="image/*" onchange="previewStaffPhoto(this)">
      </div>
      <input type="hidden" id="fs_avatar" value="${esc(s.avatar||'')}">
    </div>
    <div class="modal-section-title"><svg class="icon"><use href="#i-user"></use></svg> Məlumatlar</div>
    <div class="form-row">
      <div class="form-group"><label>Ad *</label><input type="text" id="fs_firstname" value="${esc(s.firstname||s.name?.split(' ')[0]||'')}" placeholder="Əli"></div>
      <div class="form-group"><label>Soyad *</label><input type="text" id="fs_lastname" value="${esc(s.lastname||s.name?.split(' ')[1]||'')}" placeholder="Məmmədov"></div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Vəzifə *</label>
        <select id="fs_position" onchange="onStaffPositionChange()" style="width:100%;padding:12px 14px;background:var(--bg);border:1px solid var(--border);border-radius:10px;color:var(--text);font-size:15px;">
          <option value="">Seçin...</option>
          <option value="Qarson" ${currentPos==='Qarson'?'selected':''}><svg class="icon"><use href="#i-bowtie"></use></svg> Qarson</option>
          <option value="Baş Qarson" ${currentPos==='Baş Qarson'?'selected':''}><svg class="icon"><use href="#i-star"></use></svg> Baş Qarson</option>
          <option value="Kassir" ${currentPos==='Kassir'?'selected':''}><svg class="icon"><use href="#i-money"></use></svg> Kassir</option>
          <option value="Müdir" ${currentPos==='Müdir'?'selected':''}><svg class="icon"><use href="#i-staff"></use></svg> Müdir</option>
          <option value="Mətbəx" ${currentPos==='Mətbəx'?'selected':''}><svg class="icon"><use href="#i-chef"></use></svg> Mətbəx</option>
          <option value="Digər" ${currentPos==='Digər'?'selected':''}>Digər</option>
        </select>
      </div>
      <div class="form-group"><label>Telefon</label><input type="tel" id="fs_phone" value="${esc(s.phone||'')}" placeholder="+994 50 000 00 00"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>FİN nömrəsi</label><input type="text" id="fs_fin" value="${esc(s.fin||'')}" placeholder="1234ABC"></div>
      <div class="form-group"><label>PIN kod * (4 rəqəm)</label><input type="text" id="fs_pin" value="${esc(s.pin||'')}" maxlength="4" placeholder="1234" style="font-size:22px;letter-spacing:6px;text-align:center;"></div>
    </div>
    <div class="modal-section-title" style="margin-top:8px;display:flex;justify-content:space-between;align-items:center;">
      <span><svg class="icon"><use href="#i-key"></use></svg> İcazələr</span>
      <button type="button" onclick="document.querySelectorAll('[name=staff_perm]').forEach(c=>c.checked=false)" style="padding:5px 10px;border-radius:8px;border:1px solid var(--red);color:var(--red);background:var(--bg);font-size:11px;cursor:pointer;"><svg class="icon"><use href="#i-close"></use></svg> Hamısını Sil</button>
    </div>
    ${renderPermissionCheckboxes(existingPerms)}
  `;
}

export function previewStaffPhoto(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Şəkil 2MB-dan böyük olmamalıdır'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    const preview = document.getElementById('fs_preview');
    if (preview) { preview.src = e.target.result; preview.style.display = 'block'; }
    const field = document.getElementById('fs_avatar');
    if (field) field.value = e.target.result;
  };
  reader.readAsDataURL(file);
}

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

  const cats = ['all', ...new Set(registeredTables.map(t => t.category || t.name.replace(/\s+\d+$/, '') || t.name))];
  tabEl.innerHTML = cats.map(c => `
    <button onclick="setTableCat('${esc(c)}')" style="padding:8px 18px;border-radius:20px;border:1px solid var(--border);background:${state._tableCatFilter===c?'var(--brand-gradient)':'transparent'};color:${state._tableCatFilter===c?'white':'var(--text2)'};font-weight:600;font-size:13px;cursor:pointer;">
      ${c === 'all' ? '<svg class="icon"><use href="#i-chair"></use></svg> Hamısı' : esc(c)}
    </button>
  `).join('');

  const filtered = state._tableCatFilter === 'all' ? registeredTables : registeredTables.filter(t => (t.category || t.name.replace(/\s+\d+$/, '') || t.name) === state._tableCatFilter);
  if (!filtered.length) { el.innerHTML = '<p style="color:var(--text3);">Bu kateqoriyada masa yoxdur.</p>'; return; }

  el.innerHTML = filtered.map(t => {
    const occ = t.occupant ? (state.staff.find(s => s.id === t.occupant) || { name: '?' }).name : null;
    return `<div class="table-card">
      <h3><svg class="icon"><use href="#i-chair"></use></svg> ${esc(t.name)}</h3>
      <div class="meta">${occ ? `İşçi: <strong>${esc(occ)}</strong>` : 'Boş'}</div>
      <div class="item-actions">
        <button class="btn btn-ghost" onclick="editTable('${t.id}')"><svg class="icon"><use href="#i-edit"></use></svg> Düzəliş</button>
        <button class="btn btn-blue" onclick="showQR('${t.id}','${esc(t.name)}')"><svg class="icon"><use href="#i-qr"></use></svg> QR</button>
        <button class="btn btn-red" onclick="deleteTable('${t.id}')"><svg class="icon"><use href="#i-trash"></use></svg> Sil</button>
      </div>
    </div>`;
  }).join('');
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
    addLog('admin',`Masa silindi: ${t?.name}`,{ tableId:id });
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

export function renderLogs() {
  const el = document.getElementById('logList');
  let list = state.logs;
  if (state.logFilter!=='all') list = list.filter(l=>l.type===state.logFilter);
  if (!list.length) { el.innerHTML='<p style="color:var(--text3);padding:16px;">Log tapılmadı.</p>'; return; }
  const colors = { login:'#2ecc71', logout:'#95a5a6', order:'#f39c12', table:'#3498db', admin:'#8e44ad', chat:'#e67e22', customer:'#e74c3c' };
  const labels = { login:'GİRİŞ', logout:'ÇIXIŞ', order:'SİFARİŞ', table:'MASA', admin:'ADMİN', chat:'MESAJ', customer:'MÜŞTƏRİ' };
  const visible = list.slice(0,150);
  state._selectedLogIds = (state._selectedLogIds||[]).filter(id => visible.some(l=>l.id===id));
  const allChecked = visible.length>0 && visible.every(l=>state._selectedLogIds.includes(l.id));
  const barHtml = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
    <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text2);cursor:pointer;">
      <input type="checkbox" onchange="toggleSelectAllLogs(this.checked)" ${allChecked?'checked':''} style="width:16px;height:16px;cursor:pointer;">
      Hamısını seç (${visible.length})
    </label>
    <button id="logDeleteSelectedBtn" class="btn btn-red" style="display:${state._selectedLogIds.length?'inline-flex':'none'};padding:5px 12px;font-size:11px;" onclick="deleteSelectedLogs()"><svg class="icon"><use href="#i-trash"></use></svg> Seçilənləri Sil (${state._selectedLogIds.length})</button>
  </div>`;
  el.innerHTML = barHtml + visible.map(l=>`
    <div class="log-item">
      <input type="checkbox" onchange="toggleLogSelect('${l.id}')" ${state._selectedLogIds.includes(l.id)?'checked':''} style="width:16px;height:16px;flex-shrink:0;margin-top:2px;cursor:pointer;">
      <span class="log-badge" style="background:${colors[l.type]||'#666'}22;color:${colors[l.type]||'#aaa'}">${labels[l.type]||'LOG'}</span>
      <span class="log-text">${esc(l.message)}</span>
      <span class="log-time">${l.time} ${l.date}</span>
    </div>
  `).join('');
}

export function toggleLogSelect(id) {
  state._selectedLogIds = state._selectedLogIds || [];
  const i = state._selectedLogIds.indexOf(id);
  if (i === -1) state._selectedLogIds.push(id); else state._selectedLogIds.splice(i,1);
  const btn = document.getElementById('logDeleteSelectedBtn');
  if (btn) {
    btn.style.display = state._selectedLogIds.length ? 'inline-flex' : 'none';
    btn.innerHTML = `<svg class="icon"><use href="#i-trash"></use></svg> Seçilənləri Sil (${state._selectedLogIds.length})`;
  }
}

export function toggleSelectAllLogs(checked) {
  let list = state.logs;
  if (state.logFilter!=='all') list = list.filter(l=>l.type===state.logFilter);
  state._selectedLogIds = checked ? list.slice(0,150).map(l=>l.id) : [];
  renderLogs();
}

export function deleteSelectedLogs() {
  const ids = state._selectedLogIds || [];
  if (!ids.length) return;
  confirmDelete2x(ids.length, 'tarixçə qeydi', () => {
    ids.forEach(id => R.logs.child(id).remove());
    showToast(`<svg class="icon"><use href="#i-check"></use></svg> ${ids.length} qeyd silindi`);
    state._selectedLogIds = [];
  });
}

export function setLogFilter(f, el) {
  state.logFilter = f;
  document.querySelectorAll('.log-filter').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
  renderLogs();
}

export function clearOldLogs() {
  confirmAction('30 gündən köhnə bütün tarixçə qeydləri silinsin?', () => {
    const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
    R.logs.once('value', snap => {
      const data = snap.val() || {};
      let deletedCount = 0;
      Object.keys(data).forEach(key => { if (data[key].timestamp < cutoff) { R.logs.child(key).remove(); deletedCount++; } });
      showToast(`<svg class="icon"><use href="#i-check"></use></svg> ${deletedCount} köhnə qeyd silindi`);
    });
  });
}

export function showQR(tableId, tableName) {
  const url = location.origin + location.pathname + '?table=' + tableId;
  document.getElementById('qrModalTitle').innerHTML = '<svg class="icon"><use href="#i-qr"></use></svg> ' + tableName;
  document.getElementById('qrLink').textContent = url;
  const canvas = document.getElementById('qrCanvas');
  canvas.innerHTML = '';
  new QRCode(canvas, { text:url, width:200, height:200, colorDark:'#000', colorLight:'#fff' });
  document.getElementById('qrModal').classList.add('open');
}

export function closeQRModal() { document.getElementById('qrModal').classList.remove('open'); }

export function printQR() {
  const title = document.getElementById('qrModalTitle').textContent;
  const canvas = document.querySelector('#qrCanvas canvas');
  if (!canvas) return;
  const img = canvas.toDataURL();
  const w = window.open('','_blank');
  w.document.write(`<html><head><title>${title}</title><style>body{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;}h2{margin-bottom:16px;}p{color:#666;font-size:13px;}</style></head><body><h2>${title}</h2><img src="${img}" width="250"><p>QR kodu oxudun</p><script>window.onload=()=>window.print()<\/script></body></html>`);
}

export function generateDailyReport() {
  if (!hasPermission('report.daily')) { showToast('<svg class="icon"><use href="#i-ban"></use></svg> Hesabat icazəniz yoxdur'); return; }
  const today = new Date().toLocaleDateString('az-AZ');

  // Həm ödənişləri həm bağlanan masaları yüklə
  Promise.all([
    new Promise(res => db.ref('payments').orderByChild('date').equalTo(today).once('value', snap => res(snap.val()||{}))),
    new Promise(res => db.ref('closedOrders').orderByChild('closedDate').equalTo(today).once('value', snap => res(snap.val()||{})))
  ]).then(([paymentsData, closedData]) => {
    const payments = Object.values(paymentsData);
    const closed = Object.values(closedData);

    const typeNames = {cash:'<svg class="icon"><use href="#i-cash"></use></svg> Nağd', pos:'<svg class="icon"><use href="#i-card"></use></svg> POS', credit:'<svg class="icon"><use href="#i-clipboard"></use></svg> Nisyə', split:'<svg class="icon"><use href="#i-scissors"></use></svg> Bölünmüş'};
    const byType = {};
    let totalRevenue = 0, totalDiscount = 0;

    payments.forEach(p => {
      byType[p.type] = (byType[p.type]||0) + (p.finalAmount||0);
      totalRevenue += p.finalAmount||0;
      if (p.discountValue) totalDiscount += (p.originalAmount||0) - (p.finalAmount||0);
    });

    // Ödənişsiz bağlanan masalar (ödəniş sistemi istifadə edilməmiş)
    const unpaidClosed = closed.filter(c => !payments.some(p => p.tableId === c.tableId &&
      Math.abs(p.closedAt - c.closedAt) < 60000));

    const html = `
      <div class="report-section">
        <h4><svg class="icon"><use href="#i-calendar"></use></svg> ${today} — Günlük icmal</h4>
        <div class="report-row"><span>Bağlanan masalar:</span><span>${closed.length}</span></div>
        <div class="report-row"><span>Ödəniş əməliyyatı:</span><span>${payments.length}</span></div>
        <div class="report-row"><span>Verilən endirim:</span><span style="color:var(--orange);">${totalDiscount.toFixed(2)} ₼</span></div>
        <div class="report-row"><span>Ümumi gəlir:</span><span>${totalRevenue.toFixed(2)} ₼</span></div>
      </div>
      ${payments.length ? `
      <div class="report-section">
        <h4><svg class="icon"><use href="#i-money"></use></svg> Ödəniş növlərinə görə</h4>
        ${Object.entries(byType).filter(([,v])=>v>0).map(([type,amount])=>`
          <div class="report-row"><span>${typeNames[type]||type}</span><span>${amount.toFixed(2)} ₼</span></div>
        `).join('')}
      </div>` : ''}
      <div class="report-section">
        <h4><svg class="icon"><use href="#i-chair"></use></svg> Bağlanan masalar</h4>
        ${closed.length ? closed.map(c=>`
          <div class="report-row" style="font-size:13px;">
            <span>${esc(c.tableName||'?')} — ${esc(c.staffName||'?')}</span>
            <span>${(c.total||0).toFixed(2)} ₼ <small style="color:var(--text3);">${c.closedTime||''}</small></span>
          </div>`).join('') : '<div style="color:var(--text3);font-size:13px;">Bu gün bağlanan masa yoxdur</div>'}
      </div>`;

    document.getElementById('reportContent').innerHTML = html;
    document.getElementById('reportModal').classList.add('open');
  });
}

export function closeReportModal() {
  document.getElementById('reportModal').classList.remove('open');
}

export function printReport() {
  const html = document.getElementById('reportContent').innerHTML;
  const w = window.open('','_blank','width=500,height=700');
  if (!w) return;
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Hesabat</title>
    <style>body{font-family:sans-serif;padding:20px;max-width:400px;margin:0 auto;}
    .report-section{margin-bottom:16px;}.report-section h4{font-size:11px;text-transform:uppercase;color:#666;margin-bottom:8px;border-bottom:1px solid #eee;padding-bottom:4px;}
    .report-row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0f0f0;font-size:13px;}
    .report-row:last-child{font-weight:700;font-size:15px;border-bottom:none;}
    @media print{body{padding:0;}}</style></head>
    <body><h2 style="text-align:center;font-size:16px;">Gün Sonu Hesabat<br>
    <small style="font-weight:400;font-size:13px;">${new Date().toLocaleDateString('az-AZ')}</small></h2>
    ${html}<script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}

// Mövcud HTML-də onclick="..."/onchange="..." istifadə olunan funksiyalar qlobal əlçatan olmalıdır
/* ═══════════════════════════════════════════
   MÜŞTƏRİLƏR (NİSYƏ HESABI)
═══════════════════════════════════════════ */
export function renderCustomers() {
  const el = document.getElementById('customersGrid');
  if (!el) return;
  if (!state.customers || !state.customers.length) {
    el.innerHTML = '<p style="color:var(--text3);">Hələ müştəri qeydə alınmayıb.</p>';
    return;
  }
  el.innerHTML = state.customers.slice().sort((a,b)=>(b.balance||0)-(a.balance||0)).map(c => `
    <div class="item-card">
      <div class="item-card-header">
        <div style="width:52px;height:52px;border-radius:50%;background:var(--card2);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <svg class="icon" style="width:24px;height:24px;color:var(--text2);"><use href="#i-user"></use></svg>
        </div>
        <div class="item-info">
          <h3>${esc(c.name)}</h3>
          ${c.phone ? `<small style="color:var(--text3);display:block;"><svg class="icon"><use href="#i-phone"></use></svg> ${esc(c.phone)}</small>` : ''}
        </div>
      </div>
      <span class="status-badge ${(c.balance>0)?'badge-red':'badge-green'}">${(c.balance||0).toFixed(2)} ₼ borc</span>
      <div class="item-actions">
        <button class="btn" style="border:1px solid var(--blue);color:var(--blue);" onclick="openCustomerHistoryModal('${c.id}')"><svg class="icon"><use href="#i-clipboard"></use></svg> Tarixçə</button>
        <button class="btn btn-blue" onclick="editCustomer('${c.id}')"><svg class="icon"><use href="#i-edit"></use></svg> Redaktə</button>
        <button class="btn btn-red" onclick="deleteCustomer('${c.id}')"><svg class="icon"><use href="#i-trash"></use></svg> Sil</button>
      </div>
    </div>
  `).join('');
}

export function customerForm(c = {}) {
  return `
    <div class="form-group"><label>Ad Soyad *</label><input type="text" id="cu_name" value="${esc(c.name||'')}" placeholder="Məs: Vüqar Əliyev"></div>
    <div class="form-group"><label>Telefon</label><input type="text" id="cu_phone" value="${esc(c.phone||'')}" placeholder="+994 XX XXX XX XX"></div>
    <input type="hidden" id="cu_balance" value="${c.balance||0}">
  `;
}

export function saveCustomer() {
  const name = (document.getElementById('cu_name')?.value||'').trim();
  const phone = (document.getElementById('cu_phone')?.value||'').trim();
  if (!name) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Ad mütləqdir'); return; }
  const balance = parseFloat(document.getElementById('cu_balance')?.value) || 0;

  if (state.editTarget?.type === 'customer') {
    R.customers.child(state.editTarget.id).update({ name, phone });
    addLog('admin', `Müştəri redaktə edildi: ${name}`, {});
  } else {
    R.customers.push({ name, phone, balance, createdAt: Date.now() });
    addLog('admin', `Yeni müştəri qeydə alındı: ${name}`, {});
  }
  closeAddModal();
  showToast('<svg class="icon"><use href="#i-check"></use></svg> Müştəri saxlanıldı');
}

export function editCustomer(id) {
  const c = state.customers.find(x=>x.id===id);
  if (!c) return;
  state.editTarget = { type: 'customer', id };
  document.getElementById('addModalTitle').innerHTML = '<svg class="icon"><use href="#i-user"></use></svg> Müştərini Redaktə Et';
  document.getElementById('addModalBody').innerHTML = customerForm(c);
  document.getElementById('addModal').classList.add('open');
}

export function deleteCustomer(id) {
  const c = state.customers.find(x=>x.id===id);
  if (c?.balance > 0) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Bu müştərinin ödənilməmiş borcu var, əvvəlcə sıfırlayın.'); return; }
  confirmAction(`"${esc(c?.name)}" müştərisi silinsin?`, () => {
    R.customers.child(id).remove();
    addLog('admin', `Müştəri silindi: ${c?.name}`, {});
    showToast('<svg class="icon"><use href="#i-trash"></use></svg> Müştəri silindi');
  });
}

export function openCustomerHistoryModal(customerId) {
  const c = state.customers.find(x=>x.id===customerId);
  if (!c) return;
  document.getElementById('customerHistoryTitle').innerHTML = `<svg class="icon"><use href="#i-clipboard"></use></svg> ${esc(c.name)} — Alış Tarixçəsi`;
  document.getElementById('customerHistoryBalance').textContent = `Cari borc: ${(c.balance||0).toFixed(2)} ₼`;

  const charges = (state.customerCharges||[]).filter(ch => ch.customerId === customerId);
  const el = document.getElementById('customerHistoryList');
  if (!charges.length) {
    el.innerHTML = '<p style="color:var(--text3);padding:16px 0;text-align:center;">Hələ heç bir alış qeydə alınmayıb.</p>';
  } else {
    el.innerHTML = charges.map(ch => {
      const itemsStr = (ch.items||[]).map(it => `${it.qty}x ${it.name}`).join(', ');
      return `<div class="audit-timeline-item">
        <div class="audit-timeline-text">
          <strong>${esc(ch.tableName)}</strong> — <strong style="color:var(--red);">${(ch.amount||0).toFixed(2)} ₼</strong><br>
          <span style="color:var(--text2);font-size:12px;">${esc(itemsStr)}</span><br>
          <span style="color:var(--text3);font-size:11px;">${esc(ch.staffName||'')}</span>
        </div>
        <div class="audit-timeline-time">${ch.time||''} — ${ch.date||''}</div>
      </div>`;
    }).join('');
  }
  document.getElementById('customerHistoryModal').classList.add('open');
}

export function closeCustomerHistoryModal() {
  document.getElementById('customerHistoryModal').classList.remove('open');
}

/* ═══════════════════════════════════════════
   ÖDƏNİŞ NÖVLƏRİ (ADMİN TƏRƏFİNDƏN TƏNZİMLƏNİR)
═══════════════════════════════════════════ */
export function renderPaymentMethods() {
  const el = document.getElementById('paymentMethodsGrid');
  if (!el) return;
  if (!state.paymentMethods || !state.paymentMethods.length) {
    el.innerHTML = '<p style="color:var(--text3);">Hələ əlavə ödəniş növü yaradılmayıb. Nağd və Bölünmüş ödəniş hər zaman mövcuddur.</p>';
    return;
  }
  el.innerHTML = state.paymentMethods.map(p => `
    <div class="item-card">
      <div class="item-card-header">
        <div style="width:44px;height:44px;border-radius:10px;background:var(--card2);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <svg class="icon" style="width:20px;height:20px;color:var(--blue);"><use href="#i-card"></use></svg>
        </div>
        <div class="item-info"><h3>${esc(p.name)}</h3></div>
      </div>
      <div class="item-actions">
        <button class="btn btn-blue" onclick="editPaymentMethod('${p.id}')"><svg class="icon"><use href="#i-edit"></use></svg> Redaktə</button>
        <button class="btn btn-red" onclick="deletePaymentMethod('${p.id}')"><svg class="icon"><use href="#i-trash"></use></svg> Sil</button>
      </div>
    </div>
  `).join('');
}

export function paymentMethodForm(p = {}) {
  return `<div class="form-group"><label>Ödəniş növünün adı *</label><input type="text" id="pm_name" value="${esc(p.name||'')}" placeholder="Məs: Bank Köçürməsi"></div>`;
}

export function savePaymentMethod() {
  const name = (document.getElementById('pm_name')?.value||'').trim();
  if (!name) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Ad mütləqdir'); return; }

  if (state.editTarget?.type === 'paymentMethod') {
    R.paymentMethods.child(state.editTarget.id).update({ name });
    addLog('admin', `Ödəniş növü redaktə edildi: ${name}`, {});
  } else {
    R.paymentMethods.push({ name, createdAt: Date.now() });
    addLog('admin', `Yeni ödəniş növü yaradıldı: ${name}`, {});
  }
  closeAddModal();
  showToast('<svg class="icon"><use href="#i-check"></use></svg> Ödəniş növü saxlanıldı');
}

export function editPaymentMethod(id) {
  const p = state.paymentMethods.find(x=>x.id===id);
  if (!p) return;
  state.editTarget = { type: 'paymentMethod', id };
  document.getElementById('addModalTitle').innerHTML = '<svg class="icon"><use href="#i-card"></use></svg> Ödəniş Növünü Redaktə Et';
  document.getElementById('addModalBody').innerHTML = paymentMethodForm(p);
  document.getElementById('addModal').classList.add('open');
}

export function deletePaymentMethod(id) {
  const p = state.paymentMethods.find(x=>x.id===id);
  confirmAction(`"${esc(p?.name)}" ödəniş növü silinsin?`, () => {
    R.paymentMethods.child(id).remove();
    addLog('admin', `Ödəniş növü silindi: ${p?.name}`, {});
    showToast('<svg class="icon"><use href="#i-trash"></use></svg> Ödəniş növü silindi');
  });
}

/* ═══════════════════════════════════════════
   BAĞLANAN MASALAR (TARİXÇƏ + BƏRPA)
═══════════════════════════════════════════ */
// Bağlanmış masaya aid ödəniş qeydlərini tapır (sessionId ilə dəqiq uyğunlaşdırma)
function getOrderPayments(o) {
  if (!o.sessionId) return [];
  return (state.payments || []).filter(p => p.sessionId === o.sessionId);
}

export function renderClosedOrders() {
  const listEl = document.getElementById('closedOrdersList');
  const detailEl = document.getElementById('ctDetailPanel');
  const reportEl = document.getElementById('ctReportSummary');
  if (!listEl || !detailEl) return;
  const all = state.closedOrders || [];

  // Filtr seçimlərini bir dəfə doldur (seçim itməsin deyə)
  const staffSel = document.getElementById('ctStaffFilter');
  const openedSel = document.getElementById('ctOpenedByFilter');
  const payTypeSel = document.getElementById('ctPaymentTypeFilter');
  if (staffSel && staffSel.dataset.filled !== 'true') {
    const names = Array.from(new Set(all.map(o => o.staffName).filter(Boolean))).sort();
    staffSel.innerHTML = '<option value="">Hamısı</option>' + names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    staffSel.dataset.filled = 'true';
  }
  if (openedSel && openedSel.dataset.filled !== 'true') {
    const names = Array.from(new Set(all.map(o => o.openedByName).filter(Boolean))).sort();
    openedSel.innerHTML = '<option value="">Hamısı</option>' + names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    openedSel.dataset.filled = 'true';
  }
  if (payTypeSel && payTypeSel.dataset.filled !== 'true') {
    const built = [['cash','Nağd'],['pos','POS']];
    const custom = (state.paymentMethods||[]).map(pm => [pm.id, pm.name]);
    payTypeSel.innerHTML = '<option value="">Hamısı</option>' + built.concat(custom).map(([id,name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join('');
    payTypeSel.dataset.filled = 'true';
  }

  const q = (document.getElementById('ctSearchInput')?.value || '').trim().toLowerCase();
  const dateFrom = document.getElementById('ctDateFrom')?.value || '';
  const dateTo = document.getElementById('ctDateTo')?.value || '';
  const timeFrom = document.getElementById('ctTimeFrom')?.value || '';
  const timeTo = document.getElementById('ctTimeTo')?.value || '';
  const staffFilter = document.getElementById('ctStaffFilter')?.value || '';
  const openedFilter = document.getElementById('ctOpenedByFilter')?.value || '';
  const payTypeFilter = document.getElementById('ctPaymentTypeFilter')?.value || '';
  const restoredOnly = document.getElementById('ctRestoredOnlyFilter')?.checked || false;
  const sortMode = document.getElementById('ctSortSelect')?.value || 'newest';

  let filtered = all.filter(o => {
    if (q) {
      const nameMatch = (o.tableName||'').toLowerCase().includes(q);
      const itemMatch = Object.values(o.items||{}).some(it => (it.name||'').toLowerCase().includes(q));
      if (!nameMatch && !itemMatch) return false;
    }
    if (staffFilter && o.staffName !== staffFilter) return false;
    if (openedFilter && o.openedByName !== openedFilter) return false;
    if (dateFrom) {
      const b = new Date(dateFrom);
      if (timeFrom) { const [h,m] = timeFrom.split(':'); b.setHours(+h,+m,0,0); } else { b.setHours(0,0,0,0); }
      if (o.closedAt < b.getTime()) return false;
    }
    if (dateTo) {
      const b = new Date(dateTo);
      if (timeTo) { const [h,m] = timeTo.split(':'); b.setHours(+h,+m,59,999); } else { b.setHours(23,59,59,999); }
      if (o.closedAt > b.getTime()) return false;
    }
    if (payTypeFilter) {
      const pays = getOrderPayments(o);
      // Bölünmüş ödənişin daxilində müvafiq növ (nağd/POS/...) varsa da uyğun sayılır,
      // "bölünmüş" adı altında gizlənməsin deyə
      const matches = pays.some(p => p.type === payTypeFilter || (p.type === 'split' && p.splitBreakdown && p.splitBreakdown[payTypeFilter] > 0));
      if (!matches) return false;
    }
    if (restoredOnly && !(o.restoreCount > 0)) return false;
    return true;
  });
  filtered.sort((a,b) => {
    if (sortMode === 'oldest') return (a.closedAt||0) - (b.closedAt||0);
    if (sortMode === 'amount_desc') return (b.total||0) - (a.total||0);
    if (sortMode === 'amount_asc') return (a.total||0) - (b.total||0);
    return (b.closedAt||0) - (a.closedAt||0);
  });

  // ── Hesabat xülasəsi (filtrlənmiş nəticələr üçün) ──
  if (reportEl) {
    const totalRevenue = filtered.reduce((s,o)=>s+(o.total||0),0);
    const typeBreakdown = {};
    const resolveMethodName = (id) => id==='cash'?'Nağd':id==='pos'?'POS':(state.paymentMethods||[]).find(m=>m.id===id)?.name||id;
    filtered.forEach(o => {
      getOrderPayments(o).forEach(p => {
        // Bölünmüş ödəniş öz komponentlərinə (Nağd/POS/...) ayrılaraq hesabata yazılır,
        // "Bölünmüş" adı altında tək məbləğ kimi yox
        if (p.type === 'split' && p.splitBreakdown) {
          Object.entries(p.splitBreakdown).forEach(([methodId, amount]) => {
            const key = resolveMethodName(methodId);
            typeBreakdown[key] = (typeBreakdown[key]||0) + (amount||0);
          });
        } else {
          const key = p.typeLabel || p.type;
          typeBreakdown[key] = (typeBreakdown[key]||0) + (p.thisPay||0);
        }
      });
    });
    const breakdownEntries = Object.entries(typeBreakdown);
    reportEl.innerHTML = `<div class="ct-report">
      <div class="ct-report__stats">
        <div><div class="ct-report__stat-label">Bağlanan masa</div><div class="ct-report__stat-value">${filtered.length}</div></div>
        <div><div class="ct-report__stat-label">Ümumi məbləğ</div><div class="ct-report__stat-value" style="color:var(--green);">${totalRevenue.toFixed(2)} ₼</div></div>
        <div><div class="ct-report__stat-label">Orta çek</div><div class="ct-report__stat-value">${(filtered.length?totalRevenue/filtered.length:0).toFixed(2)} ₼</div></div>
      </div>
      ${breakdownEntries.length ? `<div class="ct-report__breakdown">
        ${breakdownEntries.map(([label,amount]) => `<div class="ct-report__type-chip"><b>${esc(label)}</b> ${amount.toFixed(2)} ₼</div>`).join('')}
      </div>` : ''}
    </div>`;
  }

  if (state._ctSelectAllPending !== undefined) {
    state._selectedClosedOrderIds = state._ctSelectAllPending ? filtered.map(o=>o.id) : [];
    state._ctSelectAllPending = undefined;
  }
  state._selectedClosedOrderIds = (state._selectedClosedOrderIds||[]).filter(id => filtered.some(o=>o.id===id));
  const delBtn = document.getElementById('ctDeleteSelectedBtn');
  if (delBtn) {
    delBtn.style.display = state._selectedClosedOrderIds.length ? 'inline-flex' : 'none';
    delBtn.innerHTML = `<svg class="icon"><use href="#i-trash"></use></svg> Seçilənləri Sil (${state._selectedClosedOrderIds.length})`;
  }
  const selectAllCb = document.getElementById('ctSelectAllCheckbox');
  if (selectAllCb) selectAllCb.checked = filtered.length>0 && filtered.every(o=>state._selectedClosedOrderIds.includes(o.id));

  if (!filtered.length) {
    listEl.innerHTML = '<p class="ct-list-empty">Filtrə uyğun bağlanan masa tapılmadı.</p>';
    detailEl.innerHTML = '<div class="ct-detail-empty"><svg class="icon" style="width:32px;height:32px;"><use href="#i-clipboard"></use></svg><p style="margin-top:10px;">Baxmaq üçün soldan bir masa seçin</p></div>';
    return;
  }

  // Seçili detal qeydi filtrdən sonra da mövcuddursa saxlanılır; YOXSA sıfırlanır -
  // avtomatik olaraq ilk nəticə seçilmir, yalnız üzərinə vuranda açılır.
  if (state._selectedClosedOrderId && !filtered.find(o => o.id === state._selectedClosedOrderId)) {
    state._selectedClosedOrderId = null;
  }

  listEl.innerHTML = `<div class="ct-list-count">${filtered.length} nəticə</div>` + filtered.slice(0,150).map(o => `
    <div class="ct-list-item ${o.id===state._selectedClosedOrderId?'active':''}" onclick="selectClosedOrder('${o.id}')">
      <div class="ct-list-item__top">
        <label style="display:flex;align-items:center;gap:8px;" onclick="event.stopPropagation()">
          <input type="checkbox" onchange="toggleClosedOrderSelect('${o.id}')" ${state._selectedClosedOrderIds.includes(o.id)?'checked':''} style="width:16px;height:16px;cursor:pointer;flex-shrink:0;">
          <span class="ct-list-item__name">${esc(o.tableName)}</span>
          ${o.restoreCount ? `<span style="font-size:10px;font-weight:700;color:var(--orange);background:rgba(243,156,18,.15);border-radius:6px;padding:1px 6px;" title="${o.restoreCount} dəfə bərpa edilib">${o.restoreCount}× bərpa</span>` : ''}
        </label>
        <span class="ct-list-item__amount">${(o.total||0).toFixed(2)} ₼</span>
      </div>
      <div class="ct-list-item__meta">${esc(o.staffName||'')} · ${esc(o.closedDate||'')} ${esc(o.closedTime||'')}</div>
    </div>
  `).join('');

  if (state._selectedClosedOrderId) {
    renderClosedOrderDetail(filtered.find(o => o.id === state._selectedClosedOrderId));
  } else {
    detailEl.innerHTML = '<div class="ct-detail-empty"><svg class="icon" style="width:32px;height:32px;"><use href="#i-clipboard"></use></svg><p style="margin-top:10px;">Baxmaq üçün soldan bir masa seçin</p></div>';
  }
}

export function toggleClosedOrderSelect(id) {
  state._selectedClosedOrderIds = state._selectedClosedOrderIds || [];
  const i = state._selectedClosedOrderIds.indexOf(id);
  if (i === -1) state._selectedClosedOrderIds.push(id); else state._selectedClosedOrderIds.splice(i,1);
  const btn = document.getElementById('ctDeleteSelectedBtn');
  if (btn) {
    btn.style.display = state._selectedClosedOrderIds.length ? 'inline-flex' : 'none';
    btn.innerHTML = `<svg class="icon"><use href="#i-trash"></use></svg> Seçilənləri Sil (${state._selectedClosedOrderIds.length})`;
  }
}

export function toggleSelectAllClosedOrders(checked) {
  state._ctSelectAllPending = checked;
  renderClosedOrders();
}

export function deleteSelectedClosedOrders() {
  const ids = state._selectedClosedOrderIds || [];
  if (!ids.length) return;
  confirmDelete2x(ids.length, 'bağlanmış masa qeydi', () => {
    ids.forEach(id => db.ref('closedOrders/' + id).remove());
    addLog('admin', `Admin ${ids.length} bağlanmış masa qeydini seçib sildi`, {});
    showToast(`<svg class="icon"><use href="#i-check"></use></svg> ${ids.length} qeyd silindi`);
    state._selectedClosedOrderIds = [];
    if (ids.includes(state._selectedClosedOrderId)) state._selectedClosedOrderId = null;
  });
}

export function selectClosedOrder(id) {
  state._selectedClosedOrderId = id;
  renderClosedOrders();
}

function renderClosedOrderDetail(o) {
  const detailEl = document.getElementById('ctDetailPanel');
  if (!detailEl || !o) return;
  const isAdmin = state.user?.role === 'admin';
  const sessionLog = o.sessionLog || [];
  const firstEntry = sessionLog[0];
  const payments = getOrderPayments(o);

  const itemsHtml = Object.values(o.items||{}).map(it => `
    <div class="ct-detail-item-row">
      <span>${it.qty}x ${esc(it.name)}${it.compliment?' <span style="color:var(--green);font-size:11px;">(İKRAM)</span>':''}</span>
      <span style="font-weight:600;">${((it.price||0)*it.qty*(1-((it.discountPercent||0)/100))+(it.extraFee||0)).toFixed(2)} ₼</span>
    </div>
  `).join('') || '<p style="color:var(--text3);font-size:13px;">Mal qeydi yoxdur.</p>';

  const paymentsHtml = payments.length ? payments.map(p => `
    <div class="ct-detail-item-row">
      <span><svg class="icon" style="width:.85em;height:.85em;"><use href="#i-card"></use></svg> ${esc(p.typeLabel||p.type)} — ${esc(p.staffName||'')}${p.splitLabel ? `<br><small style="color:var(--text3);">${esc(p.splitLabel)}</small>` : ''}</span>
      <span style="font-weight:600;color:var(--green);">${(p.thisPay||0).toFixed(2)} ₼</span>
    </div>
  `).join('') : '<p style="color:var(--text3);font-size:13px;">Ödəniş qeydi tapılmadı (köhnə sessiya ola bilər).</p>';

  const historyHtml = sessionLog.length ? sessionLog.map(l => `
    <div class="audit-timeline-item">
      <div class="audit-timeline-time">${esc(l.time||'')}</div>
      <div class="audit-timeline-text">${esc(stripTableName(l.message, o.tableName))}</div>
    </div>
  `).join('') : '<p style="color:var(--text3);font-size:13px;">Tarixçə qeydi yoxdur.</p>';

  detailEl.innerHTML = `
    <div class="ct-detail-header">
      <span><svg class="icon"><use href="#i-clipboard"></use></svg> ${esc(o.tableName)} ${o.restoreCount ? `<span style="font-size:12px;color:var(--orange);font-weight:700;" title="${o.restoreCount} dəfə bərpa edilib">(${o.restoreCount}× bərpa)</span>` : ''}</span>
      <span style="font-size:22px;font-weight:800;color:var(--green);">${(o.total||0).toFixed(2)} ₼</span>
    </div>
    <div class="ct-detail-info-grid">
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Açılış</div><div class="ct-detail-info-block__value">${esc(firstEntry?`${firstEntry.date} ${firstEntry.time}`:'—')}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Bağlanış</div><div class="ct-detail-info-block__value">${esc(o.closedDate||'')} ${esc(o.closedTime||'')}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Açan</div><div class="ct-detail-info-block__value">${esc(o.openedByName||'—')}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Bağlayan</div><div class="ct-detail-info-block__value">${esc(o.staffName||'—')}</div></div>
    </div>
    <div class="ct-detail-section-title"><svg class="icon" style="width:.9em;height:.9em;"><use href="#i-food"></use></svg> Sifariş Edilən Mallar</div>
    ${itemsHtml}
    <div class="ct-detail-section-title"><svg class="icon" style="width:.9em;height:.9em;"><use href="#i-money"></use></svg> Ödəmələr</div>
    ${paymentsHtml}
    <div class="ct-detail-section-title"><svg class="icon" style="width:.9em;height:.9em;"><use href="#i-clipboard"></use></svg> Sessiya Tarixçəsi</div>
    <div class="audit-timeline">${historyHtml}</div>
    <div class="ct-detail-actions" style="flex-direction:column;align-items:stretch;">
      ${isAdmin ? `<button class="btn btn-blue" style="padding:11px;" onclick="restoreClosedOrder('${o.id}')"><svg class="icon"><use href="#i-refresh"></use></svg> Bərpa Et</button>` : ''}
      ${isAdmin ? `<small style="color:var(--text3);text-align:center;margin-top:6px;">"${esc((o.tableName||'').replace(/\s*\*+$/,''))} ${'*'.repeat((o.restoreCount||0)+1)}" adı ilə müvəqqəti masa yaradılacaq, sabit masaya toxunulmayacaq</small>` : ''}
    </div>
  `;
}

export function restoreClosedOrder(id) {
  if (state.user?.role !== 'admin') { showToast('<svg class="icon"><use href="#i-ban"></use></svg> Yalnız admin bərpa edə bilər'); return; }
  const o = state.closedOrders.find(x=>x.id===id);
  if (!o) return;

  // Masa adında əvvəldən "*" varsa təmizləyib əsl adı tapırıq, sonra YENİ bərpa sayına görə
  // düzgün sayda "*" əlavə edirik (məs. 2-ci dəfə bərpa = **). Sabit (qeydiyyatlı) masaya
  // TOXUNULMUR - o boş olsa belə - əvəzinə həmişə müvəqqəti YENİ masa yaradılır.
  const baseName = (o.tableName || '').replace(/\s*\*+$/, '');
  const newRestoreCount = (o.restoreCount || 0) + 1;
  const newName = `${baseName} ${'*'.repeat(newRestoreCount)}`;

  confirmAction(`"${esc(o.tableName)}" masası "${esc(newName)}" adı ilə müvəqqəti masa kimi bərpa edilsin? Sabit "${esc(baseName)}" masasına toxunulmayacaq.`, () => {
    const newRef = R.tables.push({
      name: newName, capacity: 4, occupant: null, notes: '', createdAt: Date.now(),
      restoreCount: newRestoreCount, isRestoredTemp: true, category: 'Bərpa edilmiş masalar'
    });
    const newTableId = newRef.key;
    const sessionId = `${newTableId}_${Date.now()}`;

    R.tableOrders.child(newTableId).set({
      items: o.items, total: o.total || 0,
      waiterId: o.staffId, paidAmount: 0, remainingAmount: o.total || 0,
      updatedAt: Date.now(), billPrintedAt: null
    });
    R.tables.child(newTableId).update({
      occupant: o.staffId, notes: o.notes || '', activatedAt: Date.now(),
      sessionId, openedById: o.openedById || o.staffId, openedByName: o.openedByName || o.staffName
    });
    R.closedOrders.child(id).remove();
    addLog('admin', `Admin "${o.tableName}" masasını "${newName}" adı ilə bərpa etdi: ${formatItemsList(o.items||{})} (${(o.total||0).toFixed(2)} ₼)`, { tableId: newTableId, sessionId });
    showToast(`<svg class="icon"><use href="#i-check"></use></svg> "${newName}" olaraq bərpa edildi`);
  }, { title: 'Masanı bərpa et', okLabel: '<svg class="icon"><use href="#i-refresh"></use></svg> Bərpa Et', okClass: 'btn-blue' });
}

window.adminTab = adminTab;
window.applyPermissionPreset = applyPermissionPreset;
window.clearOldFeedbacks = clearOldFeedbacks;
window.toggleFeedbackSelect = toggleFeedbackSelect;
window.deleteSelectedFeedbacks = deleteSelectedFeedbacks;
window.toggleSelectAllFeedbacks = toggleSelectAllFeedbacks;
window.toggleRequestSelect = toggleRequestSelect;
window.toggleSelectAllRequests = toggleSelectAllRequests;
window.deleteSelectedRequests = deleteSelectedRequests;
window.clearOldLogs = clearOldLogs;
window.toggleLogSelect = toggleLogSelect;
window.deleteSelectedLogs = deleteSelectedLogs;
window.toggleSelectAllLogs = toggleSelectAllLogs;
window.closeAddModal = closeAddModal;
window.closeAdminNoteModal = closeAdminNoteModal;
window.closeKitchenPinModal = closeKitchenPinModal;
window.closeQRModal = closeQRModal;
window.closeReportModal = closeReportModal;
window.deleteMenuItem = deleteMenuItem;
window.deleteStaff = deleteStaff;
window.deleteTable = deleteTable;
window.editMenuItem = editMenuItem;
window.editStaff = editStaff;
window.editTable = editTable;
window.generateDailyReport = generateDailyReport;
window.onMenuCategorySelectChange = onMenuCategorySelectChange;
window.onStaffPositionChange = onStaffPositionChange;
window.openAddModal = openAddModal;
window.openKitchenPinModal = openKitchenPinModal;
window.previewMenuItemPhoto = previewMenuItemPhoto;
window.previewStaffPhoto = previewStaffPhoto;
window.printQR = printQR;
window.printReport = printReport;
window.saveAdminNote = saveAdminNote;
window.saveItem = saveItem;
window.saveKitchenPin = saveKitchenPin;
window.saveMenuUrl = saveMenuUrl;
window.setLogFilter = setLogFilter;
window.setMenuCat = setMenuCat;
window.setTableCat = setTableCat;
window.showQR = showQR;
window.toggleMenuItemAvailability = toggleMenuItemAvailability;
window.toggleStaff = toggleStaff;
window.editCustomer = editCustomer;
window.deleteCustomer = deleteCustomer;
window.editPaymentMethod = editPaymentMethod;
window.deletePaymentMethod = deletePaymentMethod;
window.restoreClosedOrder = restoreClosedOrder;
window.selectClosedOrder = selectClosedOrder;
window.toggleClosedOrderSelect = toggleClosedOrderSelect;
window.toggleSelectAllClosedOrders = toggleSelectAllClosedOrders;
window.deleteSelectedClosedOrders = deleteSelectedClosedOrders;
window.renderClosedOrders = renderClosedOrders;
window.openCustomerHistoryModal = openCustomerHistoryModal;
window.closeCustomerHistoryModal = closeCustomerHistoryModal;
