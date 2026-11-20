/* ═══════════════════════════════════════════
   YUZA POS — ADMİN PANELİ: JURNAL, QR VƏ GÜNLÜK HESABAT
   Mərhələ 5: admin.js-dən ayrılıb (məntiq dəyişməyib). Ümumi giriş nöqtəsi — admin.js.
═══════════════════════════════════════════ */
import { state } from './state.js';
import { jsId } from './admin.js';
import { esc, confirmDelete2x, showToast, confirmAction } from './utils.js';
import { R, db } from './firebase-service.js';
import { hasPermission } from './permissions.js';


// Tarixçə üçün paylaşılan filtr məntiqi (növ + söz axtarışı + tarix/saat aralığı) -
// həm göstərmə, həm "hamısını seç" EYNİ filtrlənmiş siyahı üzərində işləməlidir.
export function getFilteredLogs() {
  let list = state.logs;
  // state.logFilter indi bir QRUP ID-sidir (məs. 'table_ops'), tək bir tip DEYİL -
  // həmin qrupa aid BÜTÜN tiplər birlikdə göstərilir.
  if (state.logFilter!=='all') list = list.filter(l => LOG_TYPE_INFO[l.type]?.group === state.logFilter);
  const q = (document.getElementById('logSearchInput')?.value || '').trim().toLowerCase();
  if (q) list = list.filter(l => (l.message||'').toLowerCase().includes(q));
  const dateFrom = document.getElementById('logDateFrom')?.value || '';
  const dateTo = document.getElementById('logDateTo')?.value || '';
  const timeFrom = document.getElementById('logTimeFrom')?.value || '';
  const timeTo = document.getElementById('logTimeTo')?.value || '';
  if (dateFrom) {
    const b = new Date(dateFrom);
    if (timeFrom) { const [h,m] = timeFrom.split(':'); b.setHours(+h,+m,0,0); } else b.setHours(0,0,0,0);
    list = list.filter(l => l.timestamp >= b.getTime());
  }
  if (dateTo) {
    const b = new Date(dateTo);
    if (timeTo) { const [h,m] = timeTo.split(':'); b.setHours(+h,+m,59,999); } else b.setHours(23,59,59,999);
    list = list.filter(l => l.timestamp <= b.getTime());
  }
  return list;
}

// Tarixçə üçün tam kateqoriya lüğəti - proqramdakı HƏR əməliyyat növü üçün ayrıca,
// dəqiq kateqoriya (əvvəllər hər şey 7 ümumi tipə yığılmışdı, indi 23 dəqiq tipdir).
// Digər hesabatlarda da (məs. Ləğvetmələr) bu etiket/rəng xəritəsi təkrar istifadə olunur.
// Filtr düymələrini 24 ayrı-ayrı yerinə 7 MƏNTIQI QRUPA bölür - istifadəçi əvvəlcə
// bölmə seçir (məs. "Masaya Aid"), bu bölmədəki BÜTÜN əlaqəli tiplər birlikdə göstərilir.
export const LOG_GROUP_INFO = {
  login_logout:     { label: 'Giriş/Çıxış' },
  table_ops:        { label: 'Masaya Aid Əməliyyatlar' },
  order_ops:        { label: 'Sifarişə Aid Əməliyyatlar' },
  finance:          { label: 'Maliyyə Əməliyyatları' },
  customer_contact: { label: 'Müştəri Əlaqəsi' },
  management:       { label: 'İdarəetmə (Admin)' },
  system:           { label: 'Sistemə Aid Əməliyyatlar' }
};

export const LOG_TYPE_INFO = {
  login:                { label: 'GİRİŞ',               color: '#2ecc71', group: 'login_logout' },
  logout:                { label: 'ÇIXIŞ',               color: '#7f8c8d', group: 'login_logout' },
  table_open:            { label: 'MASA AÇILIŞI',         color: '#3498db', group: 'table_ops' },
  table_close:           { label: 'MASA BAĞLANIŞI',       color: '#2c5f8a', group: 'table_ops' },
  table:                 { label: 'MASA',                 color: '#3498db', group: 'table_ops' },
  table_transfer:        { label: 'MASA/MAL KÖÇÜRMƏ',     color: '#16a085', group: 'table_ops' },
  table_restore:         { label: 'MASA GERİ QAYTARILDI', color: '#e67e22', group: 'table_ops' },
  shift:                 { label: 'KASSA NÖVBƏSİ',        color: '#27ae60', group: 'finance' },
  order_send:            { label: 'SİFARİŞ GÖNDƏRMƏ',     color: '#f39c12', group: 'order_ops' },
  order_cancel:          { label: 'SİFARİŞ LƏĞVİ',        color: '#e74c3c', group: 'order_ops' },
  discount:              { label: 'ENDİRİM/İKRAM',        color: '#9b59b6', group: 'finance' },
  payment:               { label: 'ÖDƏNİŞ',               color: '#27ae60', group: 'finance' },
  bill_print:            { label: 'HESAB ÇAPI',           color: '#1abc9c', group: 'finance' },
  credit:                { label: 'NİSYƏ',                color: '#d35400', group: 'finance' },
  credit_payment:        { label: 'NİSYƏ ÖDƏNİŞİ',        color: '#27ae60', group: 'finance' },
  customer_request:      { label: 'MÜŞTƏRİ TƏLƏBİ',       color: '#e74c3c', group: 'customer_contact' },
  chat:                  { label: 'SÖHBƏT',               color: '#e67e22', group: 'customer_contact' },
  feedback:              { label: 'ŞİKAYƏT/TƏKLİF',       color: '#c0392b', group: 'customer_contact' },
  menu_mgmt:             { label: 'MENYU İDARƏSİ',        color: '#8e44ad', group: 'management' },
  staff_mgmt:            { label: 'İŞÇİ İDARƏSİ',         color: '#8e44ad', group: 'management' },
  table_mgmt:            { label: 'MASA İDARƏSİ',         color: '#8e44ad', group: 'management' },
  supplier_mgmt:         { label: 'TƏCHİZATÇI İDARƏSİ',   color: '#8e44ad', group: 'management' },
  purchase_mgmt:         { label: 'MAL ALIŞI İDARƏSİ',    color: '#8e44ad', group: 'management' },
  loyalty_mgmt:          { label: 'LOYALLIQ İDARƏSİ',     color: '#8e44ad', group: 'management' },
  payment_method_mgmt:   { label: 'ÖDƏNİŞ NÖVÜ İDARƏSİ',  color: '#8e44ad', group: 'management' },
  customer_mgmt:         { label: 'NİSYƏ MÜŞTƏRİ İDARƏSİ',color: '#8e44ad', group: 'management' },
  settings:              { label: 'SİSTEM AYARLARI',      color: '#5d6d7e', group: 'system' }
};

export function renderLogs() {
  const el = document.getElementById('logList');
  const filterBarEl = document.getElementById('logFilterBar');
  if (filterBarEl && !filterBarEl.dataset.built) {
    // Filtr düymələri BİR DƏFƏ, ümumi kateqoriya lüğətindən dinamik qurulur - yeni
    // kateqoriya əlavə olunanda burada əl ilə düymə əlavə etməyə ehtiyac qalmır.
    filterBarEl.innerHTML = `<button class="log-filter ${state.logFilter==='all'?'active':''}" onclick="setLogFilter('all',this)">Hamısı</button>` +
      Object.entries(LOG_GROUP_INFO).map(([groupId, info]) =>
        `<button class="log-filter ${state.logFilter===groupId?'active':''}" onclick="setLogFilter('${groupId}',this)">${info.label}</button>`
      ).join('');
    filterBarEl.dataset.built = '1';
  }
  const list = getFilteredLogs();
  if (!list.length) { el.innerHTML='<p style="color:var(--text3);padding:16px;">Log tapılmadı.</p>'; return; }
  // DİQQƏT: "visible" YALNIZ EKRANDA göstəriləni məhdudlaşdırır (performans üçün, çox uzun
  // siyahını render etməmək məqsədilə). SEÇİM (_selectedLogIds) isə BÜTÜN (list) üzərində
  // işləməlidir - əks halda "hamısını seç" yalnız görünən ilk hissəni seçər, qalanları YOX.
  const visible = list.slice(0,150);
  state._selectedLogIds = (state._selectedLogIds||[]).filter(id => list.some(l=>l.id===id));
  const allChecked = list.length>0 && list.every(l=>state._selectedLogIds.includes(l.id));
  const barHtml = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
    <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text2);cursor:pointer;">
      <input type="checkbox" onchange="toggleSelectAllLogs(this.checked)" ${allChecked?'checked':''} style="width:16px;height:16px;cursor:pointer;">
      Hamısını seç (${list.length})
    </label>
    <button id="logDeleteSelectedBtn" class="btn btn-red" style="display:${state._selectedLogIds.length?'inline-flex':'none'};padding:5px 12px;font-size:11px;" onclick="deleteSelectedLogs()"><svg class="icon"><use href="#i-trash"></use></svg> Seçilənləri Sil (${state._selectedLogIds.length})</button>
  </div>`;
  const noticeHtml = list.length > visible.length
    ? `<p style="font-size:11.5px;color:var(--text3);margin-bottom:8px;">Yalnız ilk ${visible.length} qeyd göstərilir (performans üçün), amma "Hamısını seç" bütün ${list.length} qeydi seçir.</p>`
    : '';
  el.innerHTML = barHtml + noticeHtml + visible.map(l=>`
    <div class="log-item">
      <input type="checkbox" onchange="toggleLogSelect('${jsId(l.id)}')" ${state._selectedLogIds.includes(l.id)?'checked':''} style="width:16px;height:16px;flex-shrink:0;margin-top:2px;cursor:pointer;">
      <span class="log-badge" style="background:${(LOG_TYPE_INFO[l.type]?.color||'#666')}22;color:${LOG_TYPE_INFO[l.type]?.color||'#aaa'}">${LOG_TYPE_INFO[l.type]?.label||'LOG'}</span>
      <span class="log-text">${esc(l.message)}</span>
      <span class="log-time">${esc(l.time||'')} ${esc(l.date||'')}</span>
    </div>
  `).join('');
}

export function toggleLogSelect(id) {
  state._selectedLogIds = state._selectedLogIds || [];
  const i = state._selectedLogIds.indexOf(id);
  if (i === -1) state._selectedLogIds.push(id); else state._selectedLogIds.splice(i,1);
  const btn = document.getElementById('logDeleteSelectedBtn');
  if (btn) {
    btn.style.display = state._selectedLogIds.length ? 'inline-flex' : 'none';
    btn.innerHTML = `<svg class="icon"><use href="#i-trash"></use></svg> Seçilənləri Sil (${state._selectedLogIds.length})`;
  }
}

export function toggleSelectAllLogs(checked) {
  const list = getFilteredLogs();
  // BÜTÜN uyğun gələn qeydləri seçir (yalnız ekranda göstərilən ilk 150-ni YOX)
  state._selectedLogIds = checked ? list.map(l=>l.id) : [];
  renderLogs();
}

export function deleteSelectedLogs() {
  const ids = state._selectedLogIds || [];
  if (!ids.length) return;
  confirmDelete2x(ids.length, 'tarixçə qeydi', () => {
    Promise.all(ids.map(id => R.logs.child(id).remove()))
      .then(() => {
        // Passiv real-vaxt dinləyiciyə güvənmirik - uğurlu silinmədən dərhal sonra
        // lokal state-i özümüz təmizləyib ekranı yeniləyirik ki, gecikmə/uyğunsuzluq olmasın
        state.logs = state.logs.filter(l => !ids.includes(l.id));
        state._selectedLogIds = [];
        renderLogs();
        showToast(`<svg class="icon"><use href="#i-check"></use></svg> ${ids.length} qeyd silindi`);
      })
      .catch(err => {
        showToast('<svg class="icon"><use href="#i-error"></use></svg> Silinmədi: ' + (err?.message || 'naməlum xəta'));
      });
  });
}

export function setLogFilter(f, el) {
  state.logFilter = f;
  document.querySelectorAll('.log-filter').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
  renderLogs();
}

export function clearOldLogs() {
  confirmAction('30 gündən köhnə bütün tarixçə qeydləri silinsin?', () => {
    const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
    R.logs.once('value', snap => {
      const data = snap.val() || {};
      const toDelete = Object.keys(data).filter(key => data[key].timestamp < cutoff);
      if (!toDelete.length) { showToast('<svg class="icon"><use href="#i-check"></use></svg> Silinəcək köhnə qeyd yoxdur'); return; }
      Promise.all(toDelete.map(key => R.logs.child(key).remove()))
        .then(() => {
          state.logs = state.logs.filter(l => !toDelete.includes(l.id));
          renderLogs();
          showToast(`<svg class="icon"><use href="#i-check"></use></svg> ${toDelete.length} köhnə qeyd silindi`);
        })
        .catch(err => showToast('<svg class="icon"><use href="#i-error"></use></svg> Silinmədi: ' + (err?.message || 'naməlum xəta')));
    });
  });
}

export function showQR(tableId, tableName) {
  const url = location.origin + location.pathname + '?table=' + tableId;
  document.getElementById('qrModalTitle').innerHTML = '<svg class="icon"><use href="#i-qr"></use></svg> ' + tableName;
  document.getElementById('qrLink').textContent = url;
  const canvas = document.getElementById('qrCanvas');
  canvas.innerHTML = '';
  new QRCode(canvas, { text:url, width:200, height:200, colorDark:'#000', colorLight:'#fff' });
  document.getElementById('qrModal').classList.add('open');
}

export function closeQRModal() { document.getElementById('qrModal').classList.remove('open'); }

export function printQR() {
  const title = document.getElementById('qrModalTitle').textContent;
  const canvas = document.querySelector('#qrCanvas canvas');
  if (!canvas) return;
  const img = canvas.toDataURL();
  const w = window.open('','_blank');
  w.document.write(`<html><head><title>${title}</title><style>body{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;}h2{margin-bottom:16px;}p{color:#666;font-size:13px;}</style></head><body><h2>${title}</h2><img src="${img}" width="250"><p>QR kodu oxudun</p><script>window.onload=()=>window.print()<\/script></body></html>`);
}

export function generateDailyReport() {
  if (!hasPermission('report.daily')) { showToast('<svg class="icon"><use href="#i-ban"></use></svg> Hesabat icazəniz yoxdur'); return; }
  const today = new Date().toLocaleDateString('az-AZ');

  // Həm ödənişləri həm bağlanan masaları yüklə
  Promise.all([
    new Promise(res => db.ref('payments').orderByChild('date').equalTo(today).once('value', snap => res(snap.val()||{}))),
    new Promise(res => db.ref('closedOrders').orderByChild('closedDate').equalTo(today).once('value', snap => res(snap.val()||{})))
  ]).then(([paymentsData, closedData]) => {
    const payments = Object.values(paymentsData);
    const closed = Object.values(closedData).filter(c => !c.void);   // geri qaytarılmış çeklər sayılmır

    const typeNames = {cash:'<svg class="icon"><use href="#i-cash"></use></svg> Nağd', pos:'<svg class="icon"><use href="#i-card"></use></svg> POS', credit:'<svg class="icon"><use href="#i-clipboard"></use></svg> Nisyə', split:'<svg class="icon"><use href="#i-scissors"></use></svg> Bölünmüş'};
    const byType = {};
    let totalRevenue = 0, totalDiscount = 0;

    payments.forEach(p => {
      byType[p.type] = (byType[p.type]||0) + (p.finalAmount||0);
      totalRevenue += p.finalAmount||0;
      if (p.discountValue) totalDiscount += (p.originalAmount||0) - (p.finalAmount||0);
    });

    // Ödənişsiz bağlanan masalar (ödəniş sistemi istifadə edilməmiş)
    const unpaidClosed = closed.filter(c => !payments.some(p => p.tableId === c.tableId &&
      Math.abs(p.closedAt - c.closedAt) < 60000));

    const html = `
      <div class="report-section">
        <h4><svg class="icon"><use href="#i-calendar"></use></svg> ${today} — Günlük icmal</h4>
        <div class="report-row"><span>Bağlanan masalar:</span><span>${closed.length}</span></div>
        <div class="report-row"><span>Ödəniş əməliyyatı:</span><span>${payments.length}</span></div>
        <div class="report-row"><span>Verilən endirim:</span><span style="color:var(--orange);">${totalDiscount.toFixed(2)} ₼</span></div>
        <div class="report-row"><span>Ümumi gəlir:</span><span>${totalRevenue.toFixed(2)} ₼</span></div>
      </div>
      ${payments.length ? `
      <div class="report-section">
        <h4><svg class="icon"><use href="#i-money"></use></svg> Ödəniş növlərinə görə</h4>
        ${Object.entries(byType).filter(([,v])=>v>0).map(([type,amount])=>`
          <div class="report-row"><span>${typeNames[type]||type}</span><span>${amount.toFixed(2)} ₼</span></div>
        `).join('')}
      </div>` : ''}
      <div class="report-section">
        <h4><svg class="icon"><use href="#i-chair"></use></svg> Bağlanan masalar</h4>
        ${closed.length ? closed.map(c=>`
          <div class="report-row" style="font-size:13px;">
            <span>${esc(c.tableName||'?')} — ${esc(c.staffName||'?')}</span>
            <span>${(c.total||0).toFixed(2)} ₼ <small style="color:var(--text3);">${c.closedTime||''}</small></span>
          </div>`).join('') : '<div style="color:var(--text3);font-size:13px;">Bu gün bağlanan masa yoxdur</div>'}
      </div>`;

    document.getElementById('reportContent').innerHTML = html;
    document.getElementById('reportModal').classList.add('open');
  });
}

export function closeReportModal() {
  document.getElementById('reportModal').classList.remove('open');
}

export function printReport() {
  const html = document.getElementById('reportContent').innerHTML;
  const w = window.open('','_blank','width=500,height=700');
  if (!w) return;
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Hesabat</title>
    <style>body{font-family:sans-serif;padding:20px;max-width:400px;margin:0 auto;}
    .report-section{margin-bottom:16px;}.report-section h4{font-size:11px;text-transform:uppercase;color:#666;margin-bottom:8px;border-bottom:1px solid #eee;padding-bottom:4px;}
    .report-row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0f0f0;font-size:13px;}
    .report-row:last-child{font-weight:700;font-size:15px;border-bottom:none;}
    @media print{body{padding:0;}}</style></head>
    <body><h2 style="text-align:center;font-size:16px;">Gün Sonu Hesabat<br>
    <small style="font-weight:400;font-size:13px;">Çap: ${new Date().toLocaleDateString('az-AZ')} ${new Date().toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit' })}</small></h2>
    ${html}<script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}
