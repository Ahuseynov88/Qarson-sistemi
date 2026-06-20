/* ═══════════════════════════════════════════
   LOG
   Bu fayl: hər əməliyyatın Firebase-ə qeyd edilməsi (addLog),
   admin paneldəki "Tarixçə" bölməsinin render edilməsi və
   30 gündən köhnə logların silinməsi.
═══════════════════════════════════════════ */
function addLog(type, message, details={}) {
  R.logs.push({
    type, message, details,
    timestamp: Date.now(),
    time: new Date().toLocaleTimeString('az-AZ'),
    date: new Date().toLocaleDateString('az-AZ')
  });
}

function renderLogs() {
  const el = document.getElementById('logList');
  let list = state.logs;
  if (state.logFilter!=='all') list = list.filter(l=>l.type===state.logFilter);
  if (!list.length) { el.innerHTML='<p style="color:var(--text3);padding:16px;">Log tapılmadı.</p>'; return; }
  const colors = {
    login:'#2ecc71', logout:'#95a5a6', order:'#f39c12',
    table:'#3498db', admin:'#8e44ad',
    chat:'#e67e22',
    customer:'#e74c3c'
  };
  const labels = {
    login:'GİRİŞ', logout:'ÇIXIŞ', order:'SİFARİŞ',
    table:'MASA', admin:'ADMİN',
    chat:'MESAJ', customer:'MÜŞTƏRİ'
  };
  el.innerHTML = list.slice(0,150).map(l=>`
    <div class="log-item">
      <span class="log-badge" style="background:${colors[l.type]||'#666'}22;color:${colors[l.type]||'#aaa'}">${labels[l.type]||'LOG'}</span>
      <span class="log-text">${esc(l.message)}</span>
      <span class="log-time">${l.time} ${l.date}</span>
    </div>
  `).join('');
}

function setLogFilter(f, el) {
  state.logFilter = f;
  document.querySelectorAll('.log-filter').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
  renderLogs();
}

function clearOldLogs() {
  if (!confirm('30 gündən köhnə bütün tarixçə qeydləri silinsin?')) return;
  const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
  R.logs.once('value', snap => {
    const data = snap.val() || {};
    let deletedCount = 0;
    Object.keys(data).forEach(key => {
      if (data[key].timestamp < cutoff) {
        R.logs.child(key).remove();
        deletedCount++;
      }
    });
    showToast(`✅ ${deletedCount} köhnə qeyd silindi`);
  });
}
