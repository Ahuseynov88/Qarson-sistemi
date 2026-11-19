/* ═══════════════════════════════════════════
   YUZA POS — ADMİN PANELİ: LOYALLIQ MÜŞTƏRİLƏRİ
   Mərhələ 5: admin.js-dən ayrılıb (məntiq dəyişməyib). Ümumi giriş nöqtəsi — admin.js.
═══════════════════════════════════════════ */
import { state } from './state.js';
import { jsId, _toggleSectionBackBtn } from './admin.js';
import { esc, toArr, confirmDelete2x, addLog, showToast } from './utils.js';
import { db } from './firebase-service.js';


/* ═══════════════════════════════════════════
   QEYDİYYAT OLUNANLAR (Müştəri Tanıma & Loyallıq Modulu)
═══════════════════════════════════════════ */

export function renderLoyaltyCustomers() {
  const listEl = document.getElementById('loyaltyCustomersList');
  const detailEl = document.getElementById('lcDetailPanel');
  if (!listEl || !detailEl) return;
  const all = state.loyaltyCustomers || [];

  const q = (document.getElementById('lcSearchInput')?.value || '').trim().toLowerCase();
  const filtered = all.filter(c => {
    if (!q) return true;
    const full = `${c.firstName||''} ${c.lastName||''} ${c.phone||''}`.toLowerCase();
    return full.includes(q);
  });

  state._selectedLoyaltyCustomerIds = (state._selectedLoyaltyCustomerIds||[]).filter(id => filtered.some(c=>c.id===id));
  const delBtn = document.getElementById('lcDeleteSelectedBtn');
  if (delBtn) {
    delBtn.style.display = state._selectedLoyaltyCustomerIds.length ? 'inline-flex' : 'none';
    delBtn.innerHTML = `<svg class="icon"><use href="#i-trash"></use></svg> Seçilənləri Sil (${state._selectedLoyaltyCustomerIds.length})`;
  }
  const selectAllCb = document.getElementById('lcSelectAllCheckbox');
  if (selectAllCb) selectAllCb.checked = filtered.length>0 && filtered.every(c=>state._selectedLoyaltyCustomerIds.includes(c.id));

  if (!filtered.length) {
    listEl.innerHTML = '<p class="ct-list-empty">Qeydiyyatlı müştəri tapılmadı.</p>';
    return;
  }

  listEl.innerHTML = filtered.map(c => `
    <div class="tile-card" onclick="selectLoyaltyCustomer('${jsId(c.id)}')" style="position:relative;">
      <label style="position:absolute;top:8px;left:8px;z-index:1;" onclick="event.stopPropagation()">
        <input type="checkbox" onchange="toggleLoyaltyCustomerSelect('${jsId(c.id)}')" ${state._selectedLoyaltyCustomerIds.includes(c.id)?'checked':''} style="width:17px;height:17px;cursor:pointer;">
      </label>
      <div class="tile-card__icon"><svg class="icon"><use href="#i-users"></use></svg></div>
      <div class="tile-card__name">${esc(c.firstName)} ${esc(c.lastName)}</div>
      <div class="tile-card__meta">${esc(c.phone||'')}</div>
      <span class="status-badge" style="background:rgba(212,175,55,.15);color:var(--gold-dark);" class="tile-card__badge">${c.bonus||0} bal</span>
    </div>
  `).join('');

  if (state._selectedLoyaltyCustomerId) {
    const c = filtered.find(x => x.id === state._selectedLoyaltyCustomerId);
    if (c) renderLoyaltyCustomerDetail(c); else selectLoyaltyCustomer(null);
  }
}

export function selectLoyaltyCustomer(id) {
  state._selectedLoyaltyCustomerId = id;
  const overlay = document.getElementById('lcDetailPanel');
  if (!id) { overlay?.classList.remove('open'); _toggleSectionBackBtn(false); return; }
  const c = (state.loyaltyCustomers||[]).find(x => x.id === id);
  if (!c) { overlay?.classList.remove('open'); _toggleSectionBackBtn(false); return; }
  renderLoyaltyCustomerDetail(c);
  _toggleSectionBackBtn(true);
  overlay?.classList.add('open');
}

export const _p2 = (n) => String(n).padStart(2, '0');
export const _dt = (ts) => { const d = new Date(ts); return `${_p2(d.getDate())}.${_p2(d.getMonth() + 1)}.${d.getFullYear()} ${_p2(d.getHours())}:${_p2(d.getMinutes())}`; };
export function renderLoyaltyCustomerDetail(c) {
  const el = document.getElementById('lcDetailBody');
  if (!el || !c) return;

  db.ref('referrals').orderByChild('referrerCustomerId').equalTo(c.id).once('value', snap => {
    const referrals = toArr(snap.val());
    const completedCount = referrals.filter(r=>r.status==='completed').length;
    const referralsHtml = referrals.length ? referrals.map(r => {
      const referred = state.loyaltyCustomers.find(x=>x.id===r.referredCustomerId);
      return `<div class="ct-detail-item-row">
        <span>${esc(referred ? referred.firstName+' '+referred.lastName : 'Naməlum')}</span>
        <span style="color:${r.status==='completed'?'var(--green)':'var(--orange)'};font-weight:600;">${r.status==='completed'?'Tamamlandı':'Gözləmədə'}</span>
      </div>`;
    }).join('') : '<p style="color:var(--text3);font-size:13px;">Hələ heç kimi dəvət etməyib.</p>';

    el.innerHTML = `
      <div class="ct-detail-header">
        <span><svg class="icon"><use href="#i-users"></use></svg> ${esc(c.firstName)} ${esc(c.lastName)}</span>
        <span style="font-size:20px;font-weight:800;color:var(--gold-dark);">${c.bonus||0} bal</span>
      </div>
      <div class="ct-detail-info-grid">
        <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Ata adı</div><div class="ct-detail-info-block__value">${esc(c.fatherName||'—')}</div></div>
        <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Telefon</div><div class="ct-detail-info-block__value">${esc(c.phone||'—')}</div></div>
        <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Cins</div><div class="ct-detail-info-block__value">${esc(c.gender||'—')}</div></div>
        <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Doğum tarixi</div><div class="ct-detail-info-block__value">${esc(c.birthDate||'—')}</div></div>
        ${c.bdayGift ? `<div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Ad günü hədiyyələri</div><div class="ct-detail-info-block__value">${Object.entries(c.bdayGift).sort((x, y) => y[0] - x[0]).map(([y, g]) => `${esc(y)}: ${g.pct || 0}%${g.amount ? ' (' + Number(g.amount).toFixed(2) + ' ₼)' : ''} · ${g.at ? _dt(g.at) : ''} · ${esc(g.byName || '')}`).join('<br>')}</div></div>` : ''}
        <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Qeydiyyat tarixi</div><div class="ct-detail-info-block__value">${c.registrationDate ? _dt(c.registrationDate) : '—'}</div></div>
        <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Referral kodu</div><div class="ct-detail-info-block__value">${esc(c.referralCode||'—')}</div></div>
      </div>
      <div class="ct-detail-section-title"><svg class="icon" style="width:.9em;height:.9em;"><use href="#i-users"></use></svg> Dəvət etdiyi şəxslər (${completedCount}/${referrals.length} tamamlanıb)</div>
      ${referralsHtml}
      <div class="ct-detail-actions">
        <button class="btn btn-blue" style="flex:1;padding:11px;" onclick="openLoyaltyEditModal('${jsId(c.id)}')"><svg class="icon"><use href="#i-tag"></use></svg> Redaktə Et</button>
        <button class="btn btn-red" style="flex:1;padding:11px;" onclick="deleteSingleLoyaltyCustomer('${jsId(c.id)}')"><svg class="icon"><use href="#i-trash"></use></svg> Sil</button>
      </div>
    `;
  });
}

export function toggleLoyaltyCustomerSelect(id) {
  state._selectedLoyaltyCustomerIds = state._selectedLoyaltyCustomerIds || [];
  const i = state._selectedLoyaltyCustomerIds.indexOf(id);
  if (i === -1) state._selectedLoyaltyCustomerIds.push(id); else state._selectedLoyaltyCustomerIds.splice(i,1);
  const btn = document.getElementById('lcDeleteSelectedBtn');
  if (btn) {
    btn.style.display = state._selectedLoyaltyCustomerIds.length ? 'inline-flex' : 'none';
    btn.innerHTML = `<svg class="icon"><use href="#i-trash"></use></svg> Seçilənləri Sil (${state._selectedLoyaltyCustomerIds.length})`;
  }
}

export function toggleSelectAllLoyaltyCustomers(checked) {
  const q = (document.getElementById('lcSearchInput')?.value || '').trim().toLowerCase();
  const filtered = (state.loyaltyCustomers||[]).filter(c => {
    if (!q) return true;
    return `${c.firstName||''} ${c.lastName||''} ${c.phone||''}`.toLowerCase().includes(q);
  });
  state._selectedLoyaltyCustomerIds = checked ? filtered.map(c=>c.id) : [];
  renderLoyaltyCustomers();
}

export function deleteSelectedLoyaltyCustomers() {
  const ids = state._selectedLoyaltyCustomerIds || [];
  if (!ids.length) return;
  confirmDelete2x(ids.length, 'qeydiyyatlı müştəri', () => {
    ids.forEach(id => db.ref('loyaltyCustomers/' + id).remove());
    addLog('loyalty_mgmt', `Admin ${ids.length} qeydiyyatlı müştərini seçib sildi`, {});
    state.loyaltyCustomers = state.loyaltyCustomers.filter(c => !ids.includes(c.id));
    state._selectedLoyaltyCustomerIds = [];
    if (ids.includes(state._selectedLoyaltyCustomerId)) state._selectedLoyaltyCustomerId = null;
    renderLoyaltyCustomers();
    showToast(`<svg class="icon"><use href="#i-check"></use></svg> ${ids.length} müştəri silindi`);
  });
}

export function deleteSingleLoyaltyCustomer(id) {
  const c = state.loyaltyCustomers.find(x=>x.id===id);
  if (!c) return;
  confirmDelete2x(1, `"${esc(c.firstName||'')} ${esc(c.lastName||'')}" adlı müştəri`, () => {
    db.ref('loyaltyCustomers/' + id).remove();
    addLog('loyalty_mgmt', `Admin qeydiyyatlı müştərini sildi: ${c.firstName} ${c.lastName}`, {});
    state.loyaltyCustomers = state.loyaltyCustomers.filter(x => x.id !== id);
    if (state._selectedLoyaltyCustomerId === id) state._selectedLoyaltyCustomerId = null;
    renderLoyaltyCustomers();
    showToast('<svg class="icon"><use href="#i-check"></use></svg> Müştəri silindi');
  });
}

export function openLoyaltyEditModal(id) {
  const c = state.loyaltyCustomers.find(x=>x.id===id);
  if (!c) return;
  document.getElementById('lcEditModal').dataset.editId = id;
  document.getElementById('lcEditFirstName').value = c.firstName || '';
  document.getElementById('lcEditLastName').value = c.lastName || '';
  document.getElementById('lcEditFatherName').value = c.fatherName || '';
  document.getElementById('lcEditPhone').value = c.phone || '';
  document.getElementById('lcEditGender').value = c.gender || '';
  document.getElementById('lcEditBirthDate').value = c.birthDate || '';
  document.getElementById('lcEditBonus').value = c.bonus || 0;
  document.getElementById('lcEditModal').classList.add('open');
}
export function closeLoyaltyEditModal() {
  document.getElementById('lcEditModal').classList.remove('open');
}
export function saveLoyaltyCustomerEdit() {
  const id = document.getElementById('lcEditModal').dataset.editId;
  if (!id) return;
  const updated = {
    firstName: document.getElementById('lcEditFirstName').value.trim(),
    lastName: document.getElementById('lcEditLastName').value.trim(),
    fatherName: document.getElementById('lcEditFatherName').value.trim(),
    phone: document.getElementById('lcEditPhone').value.trim(),
    gender: document.getElementById('lcEditGender').value,
    birthDate: document.getElementById('lcEditBirthDate').value,
    bonus: parseFloat(document.getElementById('lcEditBonus').value) || 0
  };
  if (!updated.firstName || !updated.lastName || !updated.phone) {
    showToast('<svg class="icon"><use href="#i-warning"></use></svg> Ad, soyad və telefon mütləqdir');
    return;
  }
  db.ref('loyaltyCustomers/' + id).update(updated);
  addLog('loyalty_mgmt', `Admin qeydiyyatlı müştərini redaktə etdi: ${updated.firstName} ${updated.lastName}`, {});
  closeLoyaltyEditModal();
  showToast('<svg class="icon"><use href="#i-check"></use></svg> Məlumatlar yeniləndi');
}
