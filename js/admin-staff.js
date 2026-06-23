/* ═══════════════════════════════════════════
   ADMIN — İŞÇİLƏR (STAFF)
   Firebase: /staff/{staffId}
   Hər işçi: ad, soyad, vəzifə, PIN, avatar,
   permissions: [icazə açarları massivi]
═══════════════════════════════════════════ */

function renderStaff() {
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
        <img class="avatar" src="${s.avatar || fallback}" alt=""
             onerror="this.src='${fallback}'">
        <div class="item-info">
          <h3>${esc(s.name)}</h3>
          <small style="color:var(--text2);">${esc(s.position || 'İşçi')}</small>
          <small style="color:var(--purple);display:block;font-weight:600;">
            🔑 ${permCount} icazə
          </small>
          ${s.phone ? `<small style="color:var(--text3);display:block;">📞 ${esc(s.phone)}</small>` : ''}
        </div>
      </div>
      <span class="status-badge ${bc}">${st}</span>
      <div class="item-actions">
        <button class="btn ${s.status==='offline'?'btn-green':'btn-red'}"
                onclick="toggleStaff('${s.id}')">
          ${s.status==='offline'?'Aktiv Et':'Deaktiv Et'}
        </button>
        <button class="btn btn-ghost" onclick="editStaff('${s.id}')">✏️</button>
        <button class="btn btn-red" onclick="deleteStaff('${s.id}')">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

function toggleStaff(id) {
  const s = state.staff.find(x=>x.id===id);
  if (!s) return;
  const newStatus = s.status === 'offline' ? 'active' : 'offline';
  db.ref('staff').child(id).update({ status: newStatus });
  addLog('admin', `İşçi ${newStatus==='active'?'aktiv':'deaktiv'} edildi: ${s.name}`, { staffId: id });
  showToast(newStatus==='active' ? `✅ ${s.name} aktiv edildi` : `🚫 ${s.name} deaktiv edildi`);
}

function editStaff(id) {
  const s = state.staff.find(x=>x.id===id);
  if (!s) return;
  state.editTarget = { type: 'staff', id };
  document.getElementById('addModalTitle').textContent = '✏️ İşçi Düzəliş';
  document.getElementById('addModalBody').innerHTML = staffForm(s);
  document.getElementById('addModal').classList.add('open');
}

function deleteStaff(id) {
  const s = state.staff.find(x=>x.id===id);
  if (!confirm(`"${s?.name}" adlı işçi silinsin?`)) return;
  db.ref('staff').child(id).remove();
  addLog('admin', `İşçi silindi: ${s?.name}`, { staffId: id });
  showToast('🗑️ İşçi silindi');
}

function openAddStaffModal() {
  state.editTarget = { type: 'staff' };
  document.getElementById('addModalTitle').textContent = '➕ Yeni İşçi';
  document.getElementById('addModalBody').innerHTML = staffForm({});
  document.getElementById('addModal').classList.add('open');
}

function saveStaff() {
  const firstname  = (document.getElementById('fs_firstname')?.value||'').trim();
  const lastname   = (document.getElementById('fs_lastname')?.value||'').trim();
  const position   = (document.getElementById('fs_position')?.value||'').trim();
  const pin        = (document.getElementById('fs_pin')?.value||'').trim();
  const phone      = (document.getElementById('fs_phone')?.value||'').trim();
  const fin        = (document.getElementById('fs_fin')?.value||'').trim();
  const avatarVal  = (document.getElementById('fs_avatar')?.value||'').trim();
  const permissions = readPermissionCheckboxes();

  if (!firstname || !lastname) { showToast('❌ Ad və Soyad mütləqdir'); return; }
  if (pin.length !== 4 || !/^\d{4}$/.test(pin)) { showToast('❌ 4 rəqəmli PIN lazımdır'); return; }

  // Eyni PIN yoxlaması (həm qarsonlar, həm işçilər arasında)
  const waiterConflict = state.staff.find(w => w.pin === pin);
  const staffConflict  = state.staff?.find(s => s.pin === pin &&
    (!state.editTarget?.id || s.id !== state.editTarget.id));
  if (waiterConflict || staffConflict) { showToast('❌ Bu PIN artıq istifadə olunur'); return; }

  const name = `${firstname} ${lastname}`;
  const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=8e44ad&color=fff&size=200`;
  const avatar = avatarVal || fallback;

  const staffData = { name, firstname, lastname, position, pin, phone, fin, avatar, permissions };

  if (state.editTarget?.id) {
    db.ref('staff').child(state.editTarget.id).update(staffData);
    addLog('admin', `İşçi yeniləndi: ${name}`, { staffId: state.editTarget.id });
    showToast('✅ İşçi yeniləndi');
  } else {
    db.ref('staff').push({ ...staffData, status: 'active', createdAt: Date.now() });
    addLog('admin', `Yeni işçi əlavə edildi: ${name}`, {});
    showToast('✅ İşçi əlavə edildi');
  }
  document.getElementById('addModal').classList.remove('open');
  state.editTarget = null;
}

function staffForm(s = {}) {
  const existingPerms = s.permissions || [];
  return `
    <!-- Şəkil -->
    <div style="text-align:center;margin-bottom:16px;">
      <img id="fs_preview" class="avatar-preview"
           src="${esc(s.avatar||'')}"
           style="${s.avatar?'display:block':'display:none'}">
      <div class="avatar-upload-area" onclick="document.getElementById('fs_file').click()">
        <div style="font-size:32px;margin-bottom:6px;">👤</div>
        <div style="font-size:13px;color:var(--text2);">Şəkil yükləmək üçün klikləyin</div>
        <input type="file" id="fs_file" accept="image/*" onchange="previewStaffPhoto(this)">
      </div>
      <input type="hidden" id="fs_avatar" value="${esc(s.avatar||'')}">
    </div>

    <!-- Şəxsi məlumatlar -->
    <div class="modal-section-title">👤 Məlumatlar</div>
    <div class="form-row">
      <div class="form-group">
        <label>Ad *</label>
        <input type="text" id="fs_firstname" value="${esc(s.firstname||s.name?.split(' ')[0]||'')}" placeholder="Əli">
      </div>
      <div class="form-group">
        <label>Soyad *</label>
        <input type="text" id="fs_lastname" value="${esc(s.lastname||s.name?.split(' ')[1]||'')}" placeholder="Məmmədov">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Vəzifə</label>
        <input type="text" id="fs_position" value="${esc(s.position||'')}" placeholder="Kassir, Müdir...">
      </div>
      <div class="form-group">
        <label>Telefon</label>
        <input type="tel" id="fs_phone" value="${esc(s.phone||'')}" placeholder="+994 50 000 00 00">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>FİN nömrəsi</label>
        <input type="text" id="fs_fin" value="${esc(s.fin||'')}" placeholder="1234ABC">
      </div>
      <div class="form-group">
        <label>PIN kod * (4 rəqəm)</label>
        <input type="text" id="fs_pin" value="${esc(s.pin||'')}" maxlength="4" placeholder="1234"
               style="font-size:22px;letter-spacing:6px;text-align:center;">
      </div>
    </div>

    <!-- Sürətli seçim -->
    <div class="modal-section-title" style="margin-top:8px;">⚡ Sürətli Seçim</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px;">
      <button type="button" onclick="applyPermissionPreset('waiter')"
        style="padding:6px 12px;border-radius:8px;border:1px solid var(--border);
               background:var(--bg);font-size:12px;cursor:pointer;">🤵 Adi Qarson kimi</button>
      <button type="button" onclick="applyPermissionPreset('head_waiter')"
        style="padding:6px 12px;border-radius:8px;border:1px solid var(--border);
               background:var(--bg);font-size:12px;cursor:pointer;">⭐ Baş Qarson kimi</button>
      <button type="button" onclick="applyPermissionPreset('cashier')"
        style="padding:6px 12px;border-radius:8px;border:1px solid var(--border);
               background:var(--bg);font-size:12px;cursor:pointer;">💰 Kassir kimi</button>
      <button type="button" onclick="applyPermissionPreset('manager')"
        style="padding:6px 12px;border-radius:8px;border:1px solid var(--border);
               background:var(--bg);font-size:12px;cursor:pointer;">👔 Müdir kimi</button>
      <button type="button" onclick="document.querySelectorAll('[name=staff_perm]').forEach(c=>c.checked=false)"
        style="padding:6px 12px;border-radius:8px;border:1px solid var(--red);
               color:var(--red);background:var(--bg);font-size:12px;cursor:pointer;">✕ Hamısını Sil</button>
    </div>

    <!-- İcazələr -->
    <div class="modal-section-title">🔑 İcazələr</div>
    ${renderPermissionCheckboxes(existingPerms)}
  `;
}

function previewStaffPhoto(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { showToast('❌ Şəkil 2MB-dan böyük olmamalıdır'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    const preview = document.getElementById('fs_preview');
    if (preview) { preview.src = e.target.result; preview.style.display = 'block'; }
    const field = document.getElementById('fs_avatar');
    if (field) field.value = e.target.result;
  };
  reader.readAsDataURL(file);
}
