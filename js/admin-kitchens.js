/* ═══════════════════════════════════════════
   YUZA POS — ADMİN PANELİ: MƏTBƏX STANSİYALARI
   Mərhələ 5: admin.js-dən ayrılıb (məntiq dəyişməyib). Ümumi giriş nöqtəsi — admin.js.
═══════════════════════════════════════════ */
import { state } from './state.js';
import { esc, showToast, addLog, confirmAction } from './utils.js';
import { apiOn } from './yuza-api.js';
import { weakPin, syncPin } from './admin.js';
import { R } from './firebase-service.js';

/* ═══════════════════════════════════════════
   MƏTBƏX STANSİYALARI
═══════════════════════════════════════════ */
export function renderKitchenStations() {
  const el = document.getElementById('kitchenStationsGrid');
  if (!el) return;
  const list = state.kitchenStations || [];
  if (!list.length) {
    el.innerHTML = '<p style="color:var(--text2);grid-column:1/-1;">Hələ mətbəx yaradılmayıb. "+" düyməsinə basın.</p>';
    return;
  }
  el.innerHTML = list.map(k => `
    <div class="tile-card ${k.active===false?'tile-card--disabled':''}">
      <div class="tile-card__title">${esc(k.name)}</div>
      <div style="font-size:12px;color:var(--text2);margin:4px 0;">
        PIN: <strong style="color:var(--orange);">${k.pin ? esc(k.pin) : (k.hasPin ? 'təyin edilib' : 'yoxdur')}</strong> &nbsp;·&nbsp;
        Məhsul: <strong>${(k.menuItemIds||[]).length}</strong> &nbsp;·&nbsp;
        <span style="color:${k.active===false?'var(--red)':'var(--green)'};">${k.active===false?'Passiv':'Aktiv'}</span>
      </div>
      ${k.responsible?`<div style="font-size:12px;color:var(--text3);">Məsul: ${esc(k.responsible)}</div>`:''}
      <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;">
        <button class="btn btn-blue" style="padding:5px 12px;font-size:12px;" onclick="openKitchenStationModal('${k.id}')"><svg class="icon"><use href="#i-edit"></use></svg> Redaktə</button>
        <button class="btn btn-ghost" style="padding:5px 12px;font-size:12px;" onclick="openKitchenMenuAssign('${k.id}')"><svg class="icon"><use href="#i-food"></use></svg> Məhsullar</button>
        <button class="btn btn-red" style="padding:5px 12px;font-size:12px;" onclick="deleteKitchenStation('${k.id}')"><svg class="icon"><use href="#i-trash"></use></svg></button>
      </div>
    </div>
  `).join('');
}

export function openKitchenStationModal(id) {
  const s = id ? (state.kitchenStations||[]).find(x=>x.id===id) : null;
  const body = document.getElementById('kitchenStationModalBody');
  if (!body) return;
  body.innerHTML = `
    <div class="form-group"><label>Mətbəx adı</label>
      <input type="text" id="ksName" value="${esc(s?.name||'')}" placeholder="məs: Kabab Mətbəxi">
    </div>
    <div class="form-group"><label>Məsul şəxs</label>
      <input type="text" id="ksResponsible" value="${esc(s?.responsible||'')}" placeholder="Ad Soyad">
    </div>
        <div class="form-group"><label>Bu mətbəxin giriş PIN-i (6 rəqəm)</label>
      <input type="password" inputmode="numeric" maxlength="6" autocomplete="new-password" id="ksPin" value="${apiOn() ? '' : esc(s?.pin||'')}" placeholder="${apiOn() && s?.hasPin ? 'Dəyişmək üçün yeni PIN' : '••••••'}" style="letter-spacing:6px;">
      <small style="color:var(--text3);">Hər mətbəxin öz PIN-i olur. Mətbəx ekranına bu PIN ilə girilir.</small>
    </div>
    <label style="display:flex;align-items:center;gap:8px;margin-bottom:10px;cursor:pointer;">
      <input type="checkbox" class="yz-toggle" role="switch" id="ksShowAll" ${s?.showAll?'checked':''} style="width:18px;height:18px;"> Bütün sifarişləri görsün (ümumi mətbəx)
    </label>
    <label style="display:flex;align-items:center;gap:8px;margin-bottom:12px;cursor:pointer;">
      <input type="checkbox" class="yz-toggle" role="switch" id="ksActive" ${s?.active!==false?'checked':''} style="width:18px;height:18px;"> Aktiv
    </label>`;
  document.getElementById('kitchenStationModalId').value = id || '';
  document.getElementById('kitchenStationModal').classList.add('open');
}

export function closeKitchenStationModal() {
  document.getElementById('kitchenStationModal').classList.remove('open');
}

export function saveKitchenStation() {
  const id = document.getElementById('kitchenStationModalId').value;
  const name = document.getElementById('ksName').value.trim();
  const pin  = document.getElementById('ksPin').value.trim();
  const responsible = document.getElementById('ksResponsible').value.trim();
  const active = document.getElementById('ksActive').checked;
  if (!name) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Ad daxil edin'); return; }
   const showAll = !!document.getElementById('ksShowAll')?.checked;
  const useApi = apiOn();
  const cur = id ? (state.kitchenStations||[]).find(s => s.id === id) : null;
  if (!useApi || !cur?.hasPin || pin) {   // server qatında: redaktədə boş sahə = köhnə PIN qalır
    if (!/^\d{6}$/.test(pin)) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> PIN 6 rəqəm olmalıdır'); return; }
    if (weakPin(pin)) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Bu PIN çox asandır'); return; }
  }
  if (!useApi) {
    const dup = (state.kitchenStations||[]).find(s => String(s.pin)===pin && s.id!==id);
    if (dup) { showToast(`<svg class="icon"><use href="#i-warning"></use></svg> Bu PIN "${dup.name}"-ə aiddir`); return; }
    if ((state.staff||[]).some(s => String(s.pin)===pin)) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Bu PIN artıq başqa istifadəçiyə aiddir'); return; }
  }
  const data = { name, pin: useApi ? null : pin, responsible, active, showAll, updatedAt: Date.now() };
  if (id) {
    const w = R.kitchenStations.child(id).update(data);
    const loc = (state.kitchenStations||[]).find(s => s.id === id); if (loc && !useApi) loc.pin = pin; // dublikat PIN qoruması
    if (useApi && pin) w.then(() => syncPin('k', id, pin, () => setTimeout(() => openKitchenStationModal(id), 400)));
  } else {
    data.createdAt = Date.now(); data.menuItemIds = [];
    const nref = R.kitchenStations.push(data);
    if (Array.isArray(state.kitchenStations) && nref?.key && !state.kitchenStations.some(s => s.id === nref.key)) state.kitchenStations.push({ id: nref.key, ...data });
    if (useApi) nref.then(() => syncPin('k', nref.key, pin, () => setTimeout(() => openKitchenStationModal(nref.key), 400)));
  }
  addLog('kitchen_station', `"${name}" mətbəxi ${id?'yeniləndi':'yaradıldı'}`, { id });
  showToast('<svg class="icon"><use href="#i-check"></use></svg> Yadda saxlanıldı');
  closeKitchenStationModal();
}

export function deleteKitchenStation(id) {
  const s = (state.kitchenStations||[]).find(x=>x.id===id);
  if (!s) return;
  confirmAction(`"${esc(s.name)}" mətbəxini silmək istəyirsiniz?`, () => {
    R.kitchenStations.child(id).remove();
    if (apiOn()) syncPin('k', id, null);
    showToast('<svg class="icon"><use href="#i-check"></use></svg> Silindi');
  });
}

export let _ksAssignId = null;
export function openKitchenMenuAssign(kitchenId) {
  _ksAssignId = kitchenId;
  const s = (state.kitchenStations||[]).find(x=>x.id===kitchenId);
  const body = document.getElementById('kitchenMenuAssignBody');
  if (!body) return;
  const assigned = s?.menuItemIds || [];
  const items = state.menuItems.filter(m=>m.available!==false);
  const cats = {};
  items.forEach(m => { const c=m.category||'Digər'; if(!cats[c]) cats[c]=[]; cats[c].push(m); });
  body.innerHTML = `<p style="font-size:12px;color:var(--text2);margin-bottom:12px;">"${esc(s?.name)}" mətbəxinə aid məhsulları seçin.</p>
    ${Object.entries(cats).map(([cat,ms])=>`
      <div style="margin-bottom:12px;">
        <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;margin-bottom:5px;border-bottom:1px solid var(--border);padding-bottom:3px;">${esc(cat)}</div>
        ${ms.map(m=>`<label style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:7px;cursor:pointer;margin-bottom:2px;background:var(--bg);">
          <input type="checkbox" class="km-check" value="${m.id}" ${assigned.includes(m.id)?'checked':''} style="width:16px;height:16px;accent-color:var(--green);">
          <span style="flex:1;font-size:13px;">${esc(m.name)}</span>
          <span style="font-size:12px;color:var(--text3);">${(m.price||0).toFixed(2)} ₼</span>
        </label>`).join('')}
      </div>`).join('')}`;
  document.getElementById('kitchenMenuAssignModal').classList.add('open');
}

export function closeKitchenMenuAssign() {
  document.getElementById('kitchenMenuAssignModal').classList.remove('open');
  _ksAssignId = null;
}

export function saveKitchenMenuAssign() {
  if (!_ksAssignId) return;
  const ids = Array.from(document.querySelectorAll('.km-check:checked')).map(c=>c.value);
  R.kitchenStations.child(_ksAssignId).update({ menuItemIds: ids });
  (state.menuItems||[]).forEach(m => {
    if (ids.includes(m.id) && m.kitchenId !== _ksAssignId) R.menuItems.child(m.id).update({ kitchenId: _ksAssignId });
    else if (!ids.includes(m.id) && m.kitchenId === _ksAssignId) R.menuItems.child(m.id).update({ kitchenId: null });
  });
  const s = (state.kitchenStations||[]).find(x=>x.id===_ksAssignId);
  addLog('kitchen_station', `"${s?.name}" — ${ids.length} məhsul təyin edildi`, { kitchenId: _ksAssignId });
  showToast('<svg class="icon"><use href="#i-check"></use></svg> Məhsullar yadda saxlanıldı');
  closeKitchenMenuAssign();
}

window.renderKitchenStations   = renderKitchenStations;
window.openKitchenStationModal = openKitchenStationModal;
window.closeKitchenStationModal= closeKitchenStationModal;
window.saveKitchenStation      = saveKitchenStation;
window.deleteKitchenStation    = deleteKitchenStation;
window.openKitchenMenuAssign   = openKitchenMenuAssign;
window.closeKitchenMenuAssign  = closeKitchenMenuAssign;
window.saveKitchenMenuAssign   = saveKitchenMenuAssign;
