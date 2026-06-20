/* ═══════════════════════════════════════════
   ADMIN — ŞİKAYƏTLƏR
   Bu fayl: "Şikayətlər" bölməsi — aktiv müştəri tələbləri və
   keçmiş şikayət/təkliflərin göstərilməsi, 30 gündən köhnələrin silinməsi.
═══════════════════════════════════════════ */
function renderFeedbackSection() {
  const el = document.getElementById('feedbackList');
  if (!el) return;

  db.ref('customerRequests').orderByChild('status').equalTo('pending').once('value', snap => {
    const reqData = snap.val() || {};
    const reqs = Object.keys(reqData).map(k=>({id:k,...reqData[k]}));
    const reqColors = { call:'#f1c40f', bill_cash:'#2ecc71', bill_pos:'#3498db', message:'#e67e22' };
    const reqIcons  = { call:'🔔', bill_cash:'💵', bill_pos:'💳', message:'💬' };

    let html = '';
    if (reqs.length) {
      html += `<p style="color:var(--orange);font-size:12px;font-weight:700;margin-bottom:8px;text-transform:uppercase;">⚡ Aktiv Tələblər</p>`;
      html += reqs.map(r=>`
        <div class="log-item" style="border-left:3px solid ${reqColors[r.type]||'#aaa'};margin-bottom:6px;">
          <span class="log-badge" style="background:${reqColors[r.type]||'#aaa'}22;color:${reqColors[r.type]||'#aaa'}">${reqIcons[r.type]||'📋'} ${esc(r.tableName||'')}</span>
          <span class="log-text">${esc(r.message||'')}</span>
          <span class="log-time">${r.time||''}</span>
        </div>
      `).join('');
    }

    const feedbacks = state._feedbacks || [];
    if (feedbacks.length) {
      html += `<p style="color:var(--text2);font-size:12px;font-weight:700;margin:14px 0 8px;text-transform:uppercase;">📝 Şikayət / Təkliflər</p>`;
      html += feedbacks.map(f=>`
        <div class="log-item" style="margin-bottom:6px;">
          <span class="log-badge" style="background:#2ecc7122;color:#2ecc71">📝 ${esc(f.tableName||'')}</span>
          <span class="log-text">${esc(f.message)}</span>
          <span class="log-time">${f.time} ${f.date||''}</span>
        </div>
      `).join('');
    }

    if (!html) html='<p style="color:var(--text3);padding:16px;">Hələ tələb/şikayət yoxdur.</p>';
    el.innerHTML = html;
  });
}

function clearOldFeedbacks() {
  if (!confirm('30 gündən köhnə bütün şikayətlər silinsin?')) return;
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
    showToast(`✅ ${deletedCount} şikayət silindi`);
  });
}
