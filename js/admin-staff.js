/* ═══════════════════════════════════════════
   YUZA POS — ADMİN PANELİ: İŞÇİLƏR
   Mərhələ 5: admin.js-dən ayrılıb (məntiq dəyişməyib). Ümumi giriş nöqtəsi — admin.js.
═══════════════════════════════════════════ */
import { state } from './state.js';
import { esc, addLog, showToast, confirmAction } from './utils.js';
import { _toggleSectionBackBtn, syncPin, applyPermissionPreset, readPermissionCheckboxes, weakPin, closeAddModal, renderPermissionCheckboxes } from './admin.js';
import { db } from './firebase-service.js';
import { apiOn } from './yuza-api.js';


export function renderStaff() {
  const el = document.getElementById('staffGrid');
  if (!el) return;
  if (!state.staff || !state.staff.length) {
    el.innerHTML = '<p style="color:var(--text3);">Hələ işçi əlavə edilməyib.</p>';
    return;
  }

  el.innerHTML = state.staff.map(s => {
    const fallback = window.yzInitials(s.name);
    const st = s.status === 'offline' ? 'Deaktiv' : 'Aktiv';
    const bc = s.status === 'offline' ? 'badge-red' : 'badge-green';
    return `<div class="tile-card" onclick="selectStaff('${s.id}')">
      <div class="tile-card__icon"><img src="${s.avatar || fallback}" alt="" onerror="this.src='${fallback}'"></div>
      <div class="tile-card__name">${esc(s.name)}</div>
      <div class="tile-card__meta">${esc(s.position||'İşçi')}</div>
      <span class="status-badge ${bc} tile-card__badge">${st}</span>
    </div>`;
  }).join('');

  if (state._selectedStaffId) {
    const s = state.staff.find(x => x.id === state._selectedStaffId);
    if (s) renderStaffDetail(s); else selectStaff(null);
  }
}

export function selectStaff(id) {
  state._selectedStaffId = id;
  const overlay = document.getElementById('staffDetailPanel');
  if (!id) { overlay?.classList.remove('open'); _toggleSectionBackBtn(false); return; }
  const s = state.staff.find(x => x.id === id);
  if (!s) { overlay?.classList.remove('open'); _toggleSectionBackBtn(false); return; }
  renderStaffDetail(s);
  _toggleSectionBackBtn(true);
  overlay?.classList.add('open');
}

export function renderStaffDetail(s) {
  const el = document.getElementById('staffDetailBody');
  if (!el || !s) return;
  const fallback = window.yzInitials(s.name);
  const permCount = (s.permissions || []).length;
  const st = s.status === 'offline' ? 'Deaktiv' : 'Aktiv';
  el.innerHTML = `
    <div style="text-align:center;margin-bottom:14px;">
      <img src="${s.avatar || fallback}" alt="" onerror="this.src='${fallback}'" style="width:96px;height:96px;border-radius:50%;object-fit:cover;">
    </div>
    <div class="ct-detail-header" style="justify-content:center;text-align:center;flex-direction:column;gap:6px;">
      <span style="font-size:19px;"><svg class="icon"><use href="#i-staff"></use></svg> ${esc(s.name)}</span>
      <span style="font-size:14px;color:var(--text2);font-weight:600;">${esc(s.position||'İşçi')}</span>
    </div>
    <div class="ct-detail-info-grid">
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Status</div><div class="ct-detail-info-block__value" style="color:${s.status==='offline'?'var(--red)':'var(--green)'};">${st}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Telefon</div><div class="ct-detail-info-block__value">${esc(s.phone||'—')}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">İcazə sayı</div><div class="ct-detail-info-block__value">${permCount}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">FİN</div><div class="ct-detail-info-block__value">${esc(s.fin||'—')}</div></div>
    </div>
    <div class="ct-detail-actions" style="flex-wrap:wrap;">
      <button class="btn ${s.status==='offline'?'btn-green':'btn-red'}" style="flex:1;padding:11px;" onclick="toggleStaff('${s.id}')">${s.status==='offline'?'Aktiv Et':'Deaktiv Et'}</button>
      <button class="btn btn-blue" style="flex:1;padding:11px;" onclick="editStaff('${s.id}')"><svg class="icon"><use href="#i-tag"></use></svg> Redaktə Et</button>
      <button class="btn btn-red" style="flex:1;padding:11px;" onclick="deleteStaff('${s.id}')"><svg class="icon"><use href="#i-trash"></use></svg> Sil</button>
    </div>
  `;
}

export function toggleStaff(id) {
  const s = state.staff.find(x=>x.id===id);
  if (!s) return;
  const newStatus = s.status === 'offline' ? 'active' : 'offline';
  db.ref('staff').child(id).update({ status: newStatus });
  addLog('staff_mgmt', `İşçi ${newStatus==='active'?'aktiv':'deaktiv'} edildi: ${s.name}`, { staffId: id });
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
    db.ref('staffHR').child(id).remove();   // şəxsi məlumatlar da silinir
    if (apiOn()) syncPin('s', id, null);
    addLog('staff_mgmt', `İşçi silindi: ${s?.name}`, { staffId: id });
    state.staff = state.staff.filter(x => x.id !== id);
    if (state._selectedStaffId === id) state._selectedStaffId = null;
    renderStaff();
    showToast('<svg class="icon"><use href="#i-trash"></use></svg> İşçi silindi');
  });
}

export function openAddStaffModal() {
  state.editTarget = { type: 'staff' };
  document.getElementById('addModalTitle').innerHTML = '<svg class="icon"><use href="#i-plus"></use></svg> Yeni İşçi';
  document.getElementById('addModalBody').innerHTML = staffForm({});
  document.getElementById('addModal').classList.add('open');
}

// İşçinin vəzifəsinə görə: POS/kassa/anbar ilə işləyən vəzifələr sistemə girişli, qalanları yalnız davamiyyət
export const STAFF_SYSTEM_POS = ['Qarson', 'Baş Qarson', 'Kassir', 'Barmen', 'Müdir', 'Mühasib', 'Anbardar'];
export const STAFF_NOSYS_POS = ['Mətbəx', 'Aşpaz köməkçisi', 'Qabyuyan', 'Xadimə', 'Mühafizəçi', 'Kuryer'];
export function onStaffPositionChange() {
  const pos = document.getElementById('fs_position').value;
  const map = { 'Qarson': 'waiter', 'Baş Qarson': 'head_waiter', 'Kassir': 'cashier', 'Müdir': 'manager', 'Mühasib': 'accountant', 'Anbardar': 'storekeeper' };
  const acc = document.getElementById('fs_access');
  if (acc && STAFF_SYSTEM_POS.includes(pos)) acc.checked = true;
  if (acc && STAFF_NOSYS_POS.includes(pos)) acc.checked = false;
  window.fsToggleAccess?.();
  if (map[pos] && acc?.checked) applyPermissionPreset(map[pos]);
}

// Həssas şəxsi məlumatlar (FİN, şəxsiyyət vəsiqəsi, VÖEN, SSN, IBAN, maaş, ünvan) AYRICA "staffHR"
// bölməsində saxlanılır: POS cihazları işçi siyahısını yükləyəndə bunlar onlara getmir.
export const HR_FIELDS = ['birthDate', 'gender', 'fin', 'idCard', 'idExpiry', 'regAddress', 'address', 'voen', 'ssn',
  'contractType', 'contractNo', 'hireDate', 'contractEnd', 'fireDate', 'salaryType', 'salaryAmount', 'bankName', 'iban',
  'emergencyName', 'emergencyRelation', 'emergencyPhone', 'hrNote'];
export const hv = (id) => (document.getElementById('fs_' + id)?.value || '').trim();

export function saveStaff() {
  const firstname = hv('firstname'), lastname = hv('lastname'), position = hv('position');
  const phone = hv('phone'), avatarVal = hv('avatar');
  const systemAccess = !!document.getElementById('fs_access')?.checked;
  const attNoPhone = !!document.getElementById('fs_nophone')?.checked;
  const pin = systemAccess ? hv('pin') : '';
  const permissions = systemAccess ? readPermissionCheckboxes() : [];
  const err = (m) => showToast('<svg class="icon"><use href="#i-error"></use></svg> ' + m);

  if (!firstname || !lastname) { err('Ad və Soyad mütləqdir'); return; }
  if (!position) { err('Vəzifə seçilməlidir'); return; }
  const useApi = apiOn();
  const editing = state.editTarget?.id ? state.staff?.find(s => s.id === state.editTarget.id) : null;
  if (systemAccess) {
    // Server qatında PIN bazada saxlanmır: redaktədə sahə boş qalıbsa köhnə PIN dəyişmir
    const needPin = !useApi || !editing || !editing.hasPin || !!pin;
    if (needPin) {
      if (!/^\d{6}$/.test(pin)) { err('Sistemə girişi olan işçi üçün 6 rəqəmli PIN lazımdır'); return; }
      if (weakPin(pin)) { err('Bu PIN çox asandır (məs. 111111, 123456). Başqa PIN seçin'); return; }
    }
    if (!useApi) {
      const conflict = state.staff?.find(s => String(s.pin || '') === pin && (!state.editTarget?.id || s.id !== state.editTarget.id));
      if (conflict) { err('Bu PIN artıq istifadə olunur'); return; }
      if ((state.kitchenStations || []).some(k => String(k.pin) === pin)) { err('Bu PIN artıq başqa istifadəçiyə aiddir'); return; }
    }
    if (!permissions.length) { err('Sistemə girişi olan işçiyə ən azı bir icazə verin'); return; }
  }
  const hr = {}; HR_FIELDS.forEach(k => { hr[k] = hv(k) || null; });
  if (hr.fin) hr.fin = hr.fin.toUpperCase();
  if (hr.fin && !/^[0-9A-Z]{7}$/.test(hr.fin)) { err('FİN 7 simvol olmalıdır (rəqəm və latın hərfləri)'); return; }
  if (hr.voen && !/^\d{10}$/.test(hr.voen)) { err('VÖEN 10 rəqəm olmalıdır'); return; }
  if (hr.iban) { hr.iban = hr.iban.replace(/\s+/g, '').toUpperCase(); if (!/^AZ\d{2}[A-Z0-9]{24}$/.test(hr.iban)) { err('IBAN AZ ilə başlamalı və 28 simvol olmalıdır'); return; } }
  if (hr.salaryAmount != null) { const a = +String(hr.salaryAmount).replace(',', '.'); if (!(a >= 0)) { err('Əmək haqqı məbləği düzgün deyil'); return; } hr.salaryAmount = a; }
  if (hr.contractEnd && hr.hireDate && hr.contractEnd < hr.hireDate) { err('Müqavilənin bitmə tarixi işə qəbul tarixindən əvvəl ola bilməz'); return; }
  hr.updatedAt = Date.now();

  const name = `${firstname} ${lastname}`;
  const fallback = window.yzInitials(name);
  const avatar = avatarVal || fallback;
  // fin artıq staffHR-dədir; köhnə qeyddə qalıbsa silinir
  const staffData = { name, firstname, lastname, position, pin: useApi ? null : pin, phone, avatar, permissions, systemAccess, attNoPhone,
    contractType: hr.contractType || null, hireDate: hr.hireDate || null, fin: null };

  if (state.editTarget?.id) {
    const id = state.editTarget.id;
    const w = db.ref().update({ ...Object.fromEntries(Object.entries(staffData).map(([k, v]) => ['staff/' + id + '/' + k, v])), ['staffHR/' + id]: hr });
    const loc = state.staff?.find(s => s.id === id); if (loc) Object.assign(loc, staffData); // siyahı gecikməsində dublikat PIN-in qarşısı
    if (useApi && (pin || (!systemAccess && editing?.hasPin))) w.then(() => syncPin('s', id, systemAccess ? pin : null, () => setTimeout(() => editStaff(id), 400)));
    addLog('staff_mgmt', `İşçi yeniləndi: ${name}`, { staffId: id });
    showToast('<svg class="icon"><use href="#i-check"></use></svg> İşçi yeniləndi');
  } else {
    const ref = db.ref('staff').push();
    const w = db.ref().update({ ['staff/' + ref.key]: { ...staffData, status: 'active', createdAt: Date.now() }, ['staffHR/' + ref.key]: hr });
    if (useApi && systemAccess && pin) w.then(() => syncPin('s', ref.key, pin, () => setTimeout(() => editStaff(ref.key), 400)));
    if (Array.isArray(state.staff) && !state.staff.some(s => s.id === ref.key)) state.staff.push({ id: ref.key, ...staffData, status: 'active' }); // dublikat PIN qoruması
    addLog('staff_mgmt', `Yeni işçi əlavə edildi: ${name}`, { staffId: ref.key });
    showToast('<svg class="icon"><use href="#i-check"></use></svg> İşçi əlavə edildi');
  }
  closeAddModal();
}

export function staffForm(s = {}) {
  const existingPerms = s.permissions || [];
  const currentPos = s.position || '';
  // Köhnə işçilər üçün: sahə yoxdursa, PIN-i varsa sistemə girişli sayılır
  const access = s.systemAccess != null ? !!s.systemAccess : (s.id ? !!(s.pin || s.hasPin) : true);
  const POS = ['Qarson', 'Baş Qarson', 'Kassir', 'Barmen', 'Müdir', 'Mühasib', 'Anbardar', 'Mətbəx', 'Aşpaz köməkçisi', 'Qabyuyan', 'Xadimə', 'Mühafizəçi', 'Kuryer', 'Digər'];
  const inp = (id, label, type = 'text', ph = '', extra = '') => `<div class="form-group"><label>${label}</label><input type="${type}" id="fs_${id}" placeholder="${ph}" ${extra}></div>`;
  const sel = (id, label, opts) => `<div class="form-group"><label>${label}</label><select id="fs_${id}" class="fs-sel">${opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>`;
  const sec = (title, inner, open = false) => `<details class="fs-sec"${open ? ' open' : ''}><summary>${title}</summary><div class="fs-sec__b">${inner}</div></details>`;
  if (s.id) setTimeout(() => fillStaffHR(s), 0);
  else setTimeout(() => window.fsToggleAccess?.(), 0);
  setTimeout(() => {
    window.fsPermCount = () => {
      const el = document.getElementById('fs_permCnt'); if (!el) return;
      const n = document.querySelectorAll('[name=staff_perm]:checked').length;
      el.textContent = n ? `· ${n} seçilib` : '· seçilməyib';
    };
    document.getElementById('fs_permSec')?.addEventListener('change', window.fsPermCount);
    window.fsPermCount();
  }, 0);
  return `
    <style>
      .fs-sel{width:100%;padding:12px 14px;background:var(--bg);border:1px solid var(--border);border-radius:10px;color:var(--text);font-size:15px}
      .fs-sec{border:1px solid var(--border);border-radius:12px;margin:10px 0;background:var(--card)}
      .fs-sec>summary{cursor:pointer;padding:12px 14px;font-weight:700;list-style:none;display:flex;justify-content:space-between;align-items:center}
      .fs-sec>summary::after{content:'▾';color:var(--text3)}
      .fs-sec[open]>summary::after{content:'▴'}
      .fs-sec__b{padding:0 14px 6px}
      .fs-switch{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid var(--border);border-radius:12px;margin:8px 0;cursor:pointer}
      .fs-switch input{width:20px;height:20px;margin-top:2px;flex-shrink:0}
      .fs-switch small{display:block;color:var(--text3);font-size:12px;font-weight:500}
      .fs-hint{font-size:12px;color:var(--text3);margin:-4px 0 10px}
    </style>
    <div style="text-align:center;margin-bottom:16px;">
      <img id="fs_preview" class="avatar-preview" src="${esc(s.avatar||'')}" style="${s.avatar?'display:block':'display:none'}">
      <div class="avatar-upload-area" onclick="document.getElementById('fs_file').click()">
        <div style="font-size:32px;margin-bottom:6px;"><svg class="icon"><use href="#i-user"></use></svg></div>
        <div style="font-size:13px;color:var(--text2);">Şəkil yükləmək üçün klikləyin</div>
        <input type="file" id="fs_file" accept="image/*" onchange="previewStaffPhoto(this)">
      </div>
      <input type="hidden" id="fs_avatar" value="${esc(s.avatar||'')}">
    </div>
    <div class="modal-section-title"><svg class="icon"><use href="#i-user"></use></svg> Əsas məlumatlar</div>
    <div class="form-row">
      <div class="form-group"><label>Ad *</label><input type="text" id="fs_firstname" value="${esc(s.firstname||s.name?.split(' ')[0]||'')}" placeholder="Əli"></div>
      <div class="form-group"><label>Soyad *</label><input type="text" id="fs_lastname" value="${esc(s.lastname||s.name?.split(' ')[1]||'')}" placeholder="Məmmədov"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Vəzifə *</label>
        <select id="fs_position" class="fs-sel" onchange="onStaffPositionChange()">
          <option value="">Seçin...</option>
          ${POS.map(p => `<option value="${p}" ${currentPos === p ? 'selected' : ''}>${p === 'Mətbəx' ? 'Mətbəx (aşpaz)' : p}</option>`).join('')}
          ${currentPos && !POS.includes(currentPos) ? `<option value="${esc(currentPos)}" selected>${esc(currentPos)}</option>` : ''}
        </select></div>
      <div class="form-group"><label>Telefon</label><input type="tel" id="fs_phone" value="${esc(s.phone||'')}" placeholder="+994 50 000 00 00"></div>
    </div>

    <label class="fs-switch"><input type="checkbox" class="yz-toggle" role="switch" id="fs_access" ${access ? 'checked' : ''} onchange="fsToggleAccess()">
      <span><b>Sistemə girişi var</b><small>Ofisiant, kassir, müdir, mühasib, anbardar. Söndürülübsə, işçi POS-a girə bilməz — yalnız davamiyyətdə (QR) iştirak edir.</small></span></label>
    <label class="fs-switch"><input type="checkbox" class="yz-toggle" role="switch" id="fs_nophone" ${s.attNoPhone ? 'checked' : ''}>
      <span><b>Smartfonu yoxdur</b><small>Davamiyyəti davamiyyət ekranında səlahiyyətli şəxs (öz PIN-i ilə) qeyd edir.</small></span></label>

    <div id="fs_accessBox">
      <div class="form-row">
        <div class="form-group"><label>PIN kod * (6 rəqəm)</label><input type="text" id="fs_pin" value="${apiOn() ? '' : esc(s.pin||'')}" maxlength="6" inputmode="numeric" placeholder="${apiOn() && s.hasPin ? 'Dəyişmək üçün yeni PIN' : '6 rəqəm'}" style="font-size:22px;letter-spacing:6px;text-align:center;"></div>
      </div>
      <details class="fs-sec" id="fs_permSec">
        <summary><span><svg class="icon"><use href="#i-key"></use></svg> İcazələr <small id="fs_permCnt" style="font-weight:600;color:var(--text3)"></small></span></summary>
        <div class="fs-sec__b">
          <div style="display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin:2px 0 8px;">
            <button type="button" title="Məlumatların silinməsi icazələri istisnadır — onları ayrıca işarələyin" onclick="document.querySelectorAll('[name=staff_perm]').forEach(c=>{if(!String(c.value).startsWith('danger.'))c.checked=true;});window.fsPermCount?.()" style="padding:5px 10px;border-radius:8px;border:1px solid var(--green);color:var(--green);background:var(--bg);font-size:11px;cursor:pointer;"><svg class="icon"><use href="#i-check"></use></svg> Hamısını Seç</button>
            <button type="button" onclick="document.querySelectorAll('[name=staff_perm]').forEach(c=>c.checked=false);window.fsPermCount?.()" style="padding:5px 10px;border-radius:8px;border:1px solid var(--red);color:var(--red);background:var(--bg);font-size:11px;cursor:pointer;"><svg class="icon"><use href="#i-close"></use></svg> Hamısını Sil</button>
          </div>
          ${renderPermissionCheckboxes(existingPerms)}
        </div>
      </details>
    </div>

    ${sec('İş və müqavilə', `
      <div class="form-row">${sel('contractType', 'Müqavilə növü', [['', 'Seçin...'], ['labor', 'Əmək müqaviləsi'], ['civil', 'Mülki-hüquqi müqavilə'], ['trial', 'Sınaq müddəti'], ['none', 'Müqaviləsiz']])}
        ${inp('contractNo', 'Müqavilə nömrəsi', 'text', 'məs. 12/2026')}</div>
      <div class="form-row">${inp('hireDate', 'İşə qəbul tarixi', 'date')}${inp('contractEnd', 'Müqavilənin bitmə tarixi', 'date')}</div>
      <div class="form-row">${inp('fireDate', 'İşdən çıxma tarixi', 'date')}<div class="form-group"></div></div>`, true)}
    ${sec('Şəxsi məlumatlar', `
      <div class="form-row">${inp('birthDate', 'Doğum tarixi', 'date')}${sel('gender', 'Cins', [['', 'Seçin...'], ['m', 'Kişi'], ['f', 'Qadın']])}</div>
      <div class="form-row">${inp('fin', 'FİN', 'text', '1AB2C3D', 'maxlength="7" style="text-transform:uppercase"')}${inp('idCard', 'Şəxsiyyət vəsiqəsi (seriya və nömrə)', 'text', 'AA 1234567')}</div>
      <div class="form-row">${inp('idExpiry', 'Vəsiqənin etibarlılıq tarixi', 'date')}<div class="form-group"></div></div>
      ${inp('regAddress', 'Qeydiyyat ünvanı', 'text', 'Vəsiqədəki ünvan')}
      ${inp('address', 'Faktiki yaşayış ünvanı', 'text', 'Hazırda yaşadığı ünvan')}`)}
    ${sec('Vergi və sığorta', `
      <div class="form-row">${inp('voen', 'VÖEN (10 rəqəm)', 'text', 'Mülki-hüquqi müqavilə üçün', 'inputmode="numeric" maxlength="10"')}${inp('ssn', 'SSN (sosial sığorta nömrəsi)', 'text', '')}</div>`)}
    ${sec('Əmək haqqı (gələcək hesablamalar üçün)', `
      <div class="form-row">${sel('salaryType', 'Əmək haqqı növü', [['', 'Seçin...'], ['monthly', 'Aylıq'], ['daily', 'Günlük'], ['hourly', 'Saatlıq']])}
        ${inp('salaryAmount', 'Məbləğ (₼)', 'text', '0.00', 'inputmode="decimal"')}</div>
      <div class="form-row">${inp('bankName', 'Bank', 'text', 'məs. Kapital Bank')}${inp('iban', 'IBAN (hesab nömrəsi)', 'text', 'AZ00XXXX0000000000000000000', 'maxlength="34"')}</div>`)}
    ${sec('Təcili əlaqə və qeyd', `
      <div class="form-row">${inp('emergencyName', 'Əlaqə şəxsi', 'text', 'Ad Soyad')}${inp('emergencyRelation', 'Qohumluq', 'text', 'məs. həyat yoldaşı')}</div>
      <div class="form-row">${inp('emergencyPhone', 'Telefon', 'tel', '+994 50 000 00 00')}<div class="form-group"></div></div>
      <div class="form-group"><label>Qeyd</label><textarea id="fs_hrNote" rows="2" style="width:100%;padding:10px;border-radius:10px;border:1px solid var(--border);background:var(--bg);color:var(--text)"></textarea></div>`)}
    <p class="fs-hint">Şəxsi məlumatlar ayrıca, qorunan bölmədə saxlanılır və POS cihazlarına yüklənmir.</p>
  `;
}
export async function fillStaffHR(s) {
  window.fsToggleAccess?.();
  let hr = {};
  try { hr = (await db.ref('staffHR/' + s.id).once('value')).val() || {}; } catch (e) { /* */ }
  if (!hr.fin && s.fin) hr.fin = s.fin;   // köhnə qeyddən
  HR_FIELDS.forEach(k => { const el = document.getElementById('fs_' + k); if (el && hr[k] != null) el.value = hr[k]; });
}
window.fsToggleAccess = () => {
  const on = !!document.getElementById('fs_access')?.checked;
  const box = document.getElementById('fs_accessBox'); if (box) box.style.display = on ? '' : 'none';
};

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
