/* ═══════════════════════════════════════════
   KITCHEN PANEL
   Bu fayl: mətbəx panelinin render edilməsi (hər qarson üçün kart)
   və qarsona sifariş bildirişi göndərmək.
═══════════════════════════════════════════ */
function renderKitchen() {
  const el = document.getElementById('kitchenGrid');
  const active = state.waiters.filter(w=>w.status!=='offline');
  if (!active.length) { el.innerHTML='<p style="color:var(--text2);text-align:center;padding:40px;">Aktiv qarson yoxdur.</p>'; return; }
  el.innerHTML = active.map(w=>{
    const hasPending = state.orders.some(o=>o.waiterId===w.id&&o.status==='pending');
    const myTables = state.tables.filter(t=>t.occupant===w.id);
    const st = hasPending ? 'called' : 'ready';
    const stLabel = hasPending ? '🔴 Gözləyir' : (w.status==='online'?'🟢 Aktiv':'🟢 Hazır');
    return `<div class="k-card ${st}" ${!hasPending?`onclick="callWaiter('${w.id}')"`:''}>
      ${hasPending?'<div class="k-no-click-overlay"></div>':''}
      <img src="${w.avatar}" alt="${esc(w.name)}"
           onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(w.name)}&background=2ecc71&color=fff&size=200'">
      <h3>${esc(w.name)}</h3>
      <div class="k-status">${stLabel}</div>
      <div class="k-tables-under">
        ${myTables.map(t=>`<span class="k-table-chip">${esc(t.name)}</span>`).join('')}
      </div>
    </div>`;
  }).join('');
}

function callWaiter(waiterId) {
  const w = state.waiters.find(x=>x.id===waiterId);
  if (!w) return;
  const ref = R.orders.push();
  ref.set({
    waiterId: w.id,
    waiterName: w.name,
    status: 'pending',
    time: new Date().toLocaleTimeString('az-AZ'),
    createdAt: Date.now()
  });
  addLog('order',`Mətbəx ${w.name}-ə sifariş bildirişi göndərdi`,{ waiterId:w.id });
  showToast(`🔔 ${w.name}-ə bildiriş göndərildi`);
}
