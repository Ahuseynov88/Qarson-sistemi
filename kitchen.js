/* ═══════════════════════════════════════════
   KİTCHEN (MƏTBƏX) PANELİ
   Məntiq orijinaldan dəyişmədən köçürülüb - yalnız modula ayırılıb.
   Mövcud HTML `onclick=""` atributları ilə işlədiyi üçün funksiyalar
   `window`-a təyin edilir (bax: son sətirlər).
═══════════════════════════════════════════ */
import { R } from './firebase-service.js';
import { state } from './state.js';
import { esc, showToast, addLog } from './utils.js';
import { staffHasPermission } from './permissions.js';

export function renderKitchen() {
  const el = document.getElementById('kitchenGrid');
  const activeWaiters = state.staff.filter(s=> s.status !== 'offline' && staffHasPermission(s, 'table.view'));
  if (!activeWaiters.length) { el.innerHTML='<p style="color:var(--text2);text-align:center;padding:40px;">Aktiv qarson yoxdur.</p>'; return; }
  el.innerHTML = activeWaiters.map(w=>{
    const hasPending = state.orders.some(o=>o.waiterId===w.id&&o.status==='pending');
    const myTables = state.tables.filter(t=>t.occupant===w.id);
    const st = hasPending ? 'called' : 'ready';
    const stLabel = hasPending ? '<span class="dot" style="background:var(--red)"></span> Gözləyir' : (w.status==='online'?'<span class="dot" style="background:var(--green)"></span> Aktiv':'<span class="dot" style="background:var(--green)"></span> Hazır');
    return `<div class="k-card ${st}" ${!hasPending?`onclick="callWaiter('${w.id}')"`:''}>
      ${hasPending?'<div class="k-no-click-overlay"></div>':''}
      <img src="${w.avatar}" alt="${esc(w.name)}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(w.name)}&background=2ecc71&color=fff&size=200'">
      <h3>${esc(w.name)}</h3>
      <div class="k-status">${stLabel}</div>
      <div class="k-tables-under">${myTables.map(t=>`<span class="k-table-chip">${esc(t.name)}</span>`).join('')}</div>
    </div>`;
  }).join('');
}

export function callWaiter(waiterId) {
  const w = state.staff.find(x=>x.id===waiterId);
  if (!w) return;
  const ref = R.orders.push();
  ref.set({ waiterId: w.id, waiterName: w.name, status: 'pending', time: new Date().toLocaleTimeString('az-AZ'), createdAt: Date.now() });
  addLog('order',`Mətbəx ${w.name}-ə sifariş bildirişi göndərdi`,{ waiterId:w.id });
  showToast(`<svg class="icon"><use href="#i-bell"></use></svg> ${w.name}-ə bildiriş göndərildi`);
}

// Mövcud HTML-də onclick="callWaiter(...)" istifadə olunur - qlobal əlçatan olmalıdır
window.callWaiter = callWaiter;
