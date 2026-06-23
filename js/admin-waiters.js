/* ═══════════════════════════════════════════
   ADMIN — QARSONLAR (CRUD)
   Bu fayl: "Qarsonlar" bölməsi — siyahını göstərmək (renderWaiters),
   aktiv/deaktiv etmək, qarson forması (waiterForm), şəkil yükləmə
   (previewWaiterPhoto), və silmə.
═══════════════════════════════════════════ */
function renderWaiters() {
  const el = document.getElementById('waitersGrid');
  if (!state.staff.length) { el.innerHTML='<p style="color:var(--text3);">Hələ qarson əlavə edilməyib.</p>'; return; }
  el.innerHTML = state.staff.map(w=>{
    const st = w.status==='offline'?'Deaktiv':w.status==='online'?'Onlayn':'Hazır';
    const bc = w.status==='offline'?'badge-red':'badge-green';
    return `<div class="item-card">
      <div class="item-card-header">
        <img class="avatar" src="${w.avatar}" alt=""
             onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(w.name)}&background=2ecc71&color=fff&size=200'">
        <div class="item-info">
          <h3>${esc(w.name)}</h3>
          <small style="color:var(--text2);">PIN: ${w.pin}</small>
          ${w.phone ? `<small style="color:var(--text3);display:block;">📞 ${esc(w.phone)}</small>` : ''}
          ${w.fin   ? `<small style="color:var(--text3);display:block;">🪪 FİN: ${esc(w.fin)}</small>` : ''}
        </div>
      </div>
      <span class="status-badge ${bc}">${st}</span>
      <div class="item-actions">
        <button class="btn ${w.status==='offline'?'btn-green':'btn-red'}" onclick="toggleWaiter('${w.id}')">
          ${w.status==='offline'?'Aktiv Et':'Deaktiv Et'}
        </button>
        <button class="btn btn-ghost" onclick="editWaiter('${w.id}')">✏️</button>
        <button class="btn btn-red" onclick="deleteWaiter('${w.id}')">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

function toggleWaiter(id) {
  const w = state.staff.find(x=>x.id===id);
  if (!w) return;
  const newStatus = (w.status==='offline') ? 'ready' : 'offline';
  R.staff.child(id).update({ status: newStatus });
  addLog('admin',`${w.name} ${newStatus==='ready'?'aktiv':'deaktiv'} edildi`,{ waiterId:id });
  showToast(newStatus==='ready'?`✅ ${w.name} aktiv edildi`:`🚫 ${w.name} deaktiv edildi`);
}

function editWaiter(id) {
  const w = state.staff.find(x=>x.id===id);
  if (!w) return;
  state.editTarget = { type:'waiter', id };
  document.getElementById('addModalTitle').textContent = '✏️ Qarson Düzəliş';
  document.getElementById('addModalBody').innerHTML = waiterForm(w);
  document.getElementById('addModal').classList.add('open');
}

function deleteWaiter(id) {
  const w = state.staff.find(x=>x.id===id);
  const activeTables = state.tables.filter(t => t.occupant === id);
  if (activeTables.length > 0) {
    const names = activeTables.map(t=>t.name).join(', ');
    showToast(`❌ ${w?.name} adlı qarsonun aktiv masası var: ${names}. Əvvəlcə masaları bağlayın!`);
    return;
  }
  if (!confirm(`"${w?.name}" adlı qarson silinsin?`)) return;
  R.staff.child(id).remove();
  addLog('admin',`${w?.name} silindi`,{ waiterId:id });
  showToast('🗑️ Qarson silindi');
}

function waiterForm(w={}) {
  return `
    <!-- Şəkil upload -->
    <div style="text-align:center;margin-bottom:16px;">
      <img id="fw_preview" class="avatar-preview"
           src="${esc(w.avatar||'')}"
           style="${w.avatar?'display:block':'display:none'}">
      <div class="avatar-upload-area" onclick="document.getElementById('fw_file').click()">
        <div style="font-size:32px;margin-bottom:6px;">📷</div>
        <div style="font-size:13px;color:var(--text2);">Şəkil yükləmək üçün klikləyin</div>
        <div style="font-size:11px;color:var(--text3);margin-top:4px;">JPG, PNG — maks. 2MB</div>
        <input type="file" id="fw_file" accept="image/*" onchange="previewWaiterPhoto(this)">
      </div>
      <input type="hidden" id="fw_avatar" value="${esc(w.avatar||'')}">
    </div>

    <!-- Şəxsi məlumatlar -->
    <div class="modal-section-title">👤 Şəxsi Məlumatlar</div>
    <div class="form-row">
      <div class="form-group">
        <label>Ad *</label>
        <input type="text" id="fw_firstname" value="${esc(w.firstname||w.name?.split(' ')[0]||'')}" placeholder="Əli">
      </div>
      <div class="form-group">
        <label>Soyad *</label>
        <input type="text" id="fw_lastname" value="${esc(w.lastname||w.name?.split(' ')[1]||'')}" placeholder="Məmmədov">
      </div>
    </div>
    <div class="form-group">
      <label>Ata adı</label>
      <input type="text" id="fw_fathername" value="${esc(w.fathername||'')}" placeholder="Vüsal">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Doğum tarixi</label>
        <input type="date" id="fw_birthdate" value="${esc(w.birthdate||'')}">
      </div>
      <div class="form-group">
        <label>Əlaqə nömrəsi</label>
        <input type="tel" id="fw_phone" value="${esc(w.phone||'')}" placeholder="+994 50 000 00 00">
      </div>
    </div>
    <div class="form-group">
      <label>Ünvan</label>
      <input type="text" id="fw_address" value="${esc(w.address||'')}" placeholder="Bakı, Nərimanov r., ...">
    </div>

    <!-- Sənəd məlumatları -->
    <div class="modal-section-title" style="margin-top:16px;">📋 Sənəd Məlumatları</div>
    <div class="form-row">
      <div class="form-group">
        <label>Ş/V nömrəsi</label>
        <input type="text" id="fw_idcard" value="${esc(w.idcard||'')}" placeholder="AA1234567">
      </div>
      <div class="form-group">
        <label>FİN nömrəsi</label>
        <input type="text" id="fw_fin" value="${esc(w.fin||'')}" placeholder="1234ABC">
      </div>
    </div>
    <div class="form-group">
      <label>VÖEN nömrəsi</label>
      <input type="text" id="fw_voen" value="${esc(w.voen||'')}" placeholder="1234567890">
    </div>

    <!-- Sistem məlumatları -->
    <div class="modal-section-title" style="margin-top:16px;">⚙️ Sistem Məlumatları</div>
    <div class="form-group">
      <label>PIN kod * (4 rəqəm)</label>
      <input type="text" id="fw_pin" value="${esc(w.pin||'')}" maxlength="4" placeholder="1234"
             style="font-size:24px;letter-spacing:8px;text-align:center;">
    </div>`;
}

function previewWaiterPhoto(input) {
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
    const preview = document.getElementById('fw_preview');
    if (preview) { preview.src = base64; preview.style.display = 'block'; }
    const avatarField = document.getElementById('fw_avatar');
    if (avatarField) avatarField.value = base64;
    showToast('✅ Şəkil yükləndi');
  };
  reader.readAsDataURL(file);
}
