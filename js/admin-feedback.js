/* ═══════════════════════════════════════════
   YUZA POS — ADMİN PANELİ: MASA QEYDLƏRİ, MÜŞTƏRİ TƏLƏBLƏRİ VƏ RƏYLƏR
   Mərhələ 5: admin.js-dən ayrılıb (məntiq dəyişməyib). Ümumi giriş nöqtəsi — admin.js.
═══════════════════════════════════════════ */
import { state } from './state.js';
import { R, db } from './firebase-service.js';
import { addLog, showToast, esc, confirmDelete2x, confirmAction } from './utils.js';
import { jsId } from './admin.js';


// ANBAR/STOK - tarix filtrindən ASILI DEYİL, HAZIRKI stok vəziyyətini göstərir.
// Azalan mallar (≤5) xəbərdarlıq rəngi ilə önə çıxarılır.

// TƏCHİZATÇI/ALIŞ - borc vəziyyəti HAZIRKI anı göstərir (tarix filtrindən asılı deyil),
// alış fəaliyyəti isə seçilmiş tarix aralığına görə filtrlənir.

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
  addLog('table','Admin "' + (state.tables.find(x=>x.id===state.noteTableId)||{name:'?'}).name + '" masasına qeyd əlavə etdi',{});
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
          <input type="checkbox" onchange="toggleRequestSelect('${jsId(r.id)}')" ${state._selectedRequestIds.includes(r.id)?'checked':''} style="width:16px;height:16px;flex-shrink:0;margin-top:2px;cursor:pointer;">
          <span class="log-badge" style="background:${reqColors[r.type]||'#aaa'}22;color:${reqColors[r.type]||'#aaa'}">${reqIcons[r.type]||'<svg class="icon"><use href="#i-clipboard"></use></svg>'} ${esc(r.tableName||'')}</span>
          <span class="log-text">${esc(r.message||'')}</span>
          <span class="log-time">${esc(r.time||'')}</span>
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
          <input type="checkbox" onchange="toggleFeedbackSelect('${jsId(f.id)}')" ${state._selectedFeedbackIds.includes(f.id)?'checked':''} style="width:16px;height:16px;flex-shrink:0;margin-top:2px;cursor:pointer;">
          <span class="log-badge" style="background:#2ecc7122;color:#2ecc71"><svg class="icon"><use href="#i-note"></use></svg> ${esc(f.tableName||'')}</span>
          <span class="log-text">${esc(f.message)}</span>
          <span class="log-time">${esc(f.time||'')} ${esc(f.date||'')}</span>
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
    addLog('customer_request', `Admin ${ids.length} müştəri tələbini seçib sildi`, {});
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
    addLog('feedback', `Admin ${ids.length} şikayəti seçib sildi`, {});
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
      addLog('feedback', `${deletedCount} köhnə şikayət silindi`, {});
      showToast(`<svg class="icon"><use href="#i-check"></use></svg> ${deletedCount} şikayət silindi`);
    });
  });
}
