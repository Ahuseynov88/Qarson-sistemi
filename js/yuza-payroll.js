/* ═══════════════════════════════════════════
   YUZA POS — MAAŞ: İŞLƏNMİŞ SAAT + SATIŞDAN FAİZ (C20 · 22.11.2026)
   • Hər işçi üçün: saatlıq dərəcə (₼/saat) və satışdan faiz (%). Gizli bölmədə saxlanılır (staffHR/{id}/pay).
   • Saat: davamiyyət qeydlərindən (çıxış − giriş − ödənişsiz fasilələr). Çıxışı unudub sistemin avtomatik
     bağladığı qeydlər (C15) ayrıca sayılır və qırmızı göstərilir — Rəhbər lazımdırsa düzəldir.
   • Satış: dövrdə bağlanan masalar, ofisianta görə (masa ötürülübsə — payına görə), geri qaytarılan çeklər xaric.
   • Maaş = saat × dərəcə + satış × faiz. Excel və çap.
   • Görən: Rəhbər və "İşçilər" bölməsinə icazəsi olan şəxs.
═══════════════════════════════════════════ */
import { db, R } from './firebase-service.js';
import { state } from './state.js';
import { hasPermission } from './permissions.js';
import { addLog, toArr } from './utils.js';
import { registerTab, fresh, ok, fail, esc, numInput } from './yuza-inv-ui.js';
import { workedMs, A } from './yuza-att-core.js';

const p2 = (n) => String(n).padStart(2, '0');
const fmtD = (t) => { const d = new Date(t); return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}`; };
const fmtDT = (t) => { const d = new Date(t); return `${fmtD(t)} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const m2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const money = (n) => m2(n).toFixed(2) + ' ₼';
const hrs = (ms) => Math.round(ms / 36000) / 100;
const canSee = () => state.user?.role === 'admin' || hasPermission('panel.staff');
const ymd = (t) => { const d = new Date(t); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };

const F = { from: '', to: '' };
function range() {
  const n = new Date();
  const from = F.from ? new Date(F.from + 'T00:00').getTime() : new Date(n.getFullYear(), n.getMonth(), 1).getTime();
  const to = F.to ? new Date(F.to + 'T23:59:59').getTime() : Date.now();
  return { from, to };
}

/* Hesablama (test və çap üçün ayrıca) */
export async function compute({ from, to }) {
  const [hrSnap, sesSnap, coSnap] = await Promise.all([
    db.ref('staffHR').once('value'),
    A('sessions').orderByChild('inAt').startAt(from).endAt(to).once('value'),
    R.closedOrders.orderByChild('closedAt').startAt(from).endAt(to).once('value')
  ]);
  const hr = hrSnap.val() || {};
  const sessions = toArr(sesSnap.val());
  const orders = toArr(coSnap.val()).filter(o => !o.void);
  const rows = (state.staff || []).map(s => {
    const pay = hr[s.id]?.pay || {};
    const my = sessions.filter(r => r.staffId === s.id && r.inAt);
    const ms = my.reduce((t, r) => t + workedMs(r, r.outAt ? null : Math.min(Date.now(), to)), 0);
    const auto = my.filter(r => r.autoOut).length, open = my.filter(r => !r.outAt).length;
    let sales = 0, tables = 0;
    orders.forEach(o => {
      if (Array.isArray(o.waiterSplit) && o.waiterSplit.length) {
        o.waiterSplit.forEach(w => { if (w.id === s.id || (!w.id && w.name === s.name)) { sales += Number(w.amount) || 0; tables++; } });
        return;
      }
      if ((o.orderedById || o.staffId) === s.id) { sales += Number(o.total) || 0; tables++; }
    });
    const rate = Number(pay.hourly) || 0, pct = Number(pay.pct) || 0, h = hrs(ms);
    const hourPart = m2(h * rate), salesPart = m2(sales * pct / 100);
    return { id: s.id, name: s.name || '?', position: s.position || '', rate, pct, hours: h, days: new Set(my.map(r => ymd(r.inAt))).size, auto, open,
      sales: m2(sales), tables, hourPart, salesPart, total: m2(hourPart + salesPart) };
  }).filter(r => r.hours > 0 || r.sales > 0 || r.rate > 0 || r.pct > 0)
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'az'));
  return rows;
}

async function render(host) {
  const el = fresh(host);
  if (!canSee()) { el.innerHTML = '<p class="yzi-empty">Bu bölmə üçün icazəniz yoxdur.</p>'; return; }
  const r = range();
  el.innerHTML = '<p class="yzi-empty">Hesablanır…</p>';
  let rows = [];
  try { rows = await compute(r); } catch (e) { el.innerHTML = `<p class="yzi-empty">Məlumat oxunmadı: ${esc(e.message || e)}</p>`; return; }
  const tot = rows.reduce((a, x) => ({ h: a.h + x.hours, s: a.s + x.sales, p: a.p + x.total }), { h: 0, s: 0, p: 0 });
  el.innerHTML = `
    <div class="yzi-head"><div><div class="yzi-eyebrow">HESABATLAR</div><h1 class="yzi-h1">Maaş hesabatı</h1></div>
      <div class="yzi-actions"><button type="button" class="yzi-btn yzi-btn--ghost" data-csv>Excel (CSV)</button><button type="button" class="yzi-btn yzi-btn--ghost" data-print>Çap</button></div></div>
    <div class="yzi-filters">
      <label class="yzi-f yzi-f--inline"><span>Tarixdən</span><input type="date" data-f="from" value="${F.from || ymd(r.from)}"></label>
      <label class="yzi-f yzi-f--inline"><span>Tarixədək</span><input type="date" data-f="to" value="${F.to || ymd(r.to)}"></label>
    </div>
    <p class="yzi-p">Maaş = <b>işlənmiş saat × saatlıq dərəcə</b> + <b>satış × faiz</b>. Dərəcə və faizi cədvəldə dəyişin (yadda saxlanır). Dövr: ${fmtDT(r.from)} — ${fmtDT(r.to)}.</p>
    <div class="yz-cu-kpis"><div><small>İşlənmiş saat</small><b>${m2(tot.h)}</b></div><div><small>Satış</small><b>${money(tot.s)}</b></div><div><small>Ümumi maaş</small><b>${money(tot.p)}</b></div></div>
    <div class="yzi-table-wrap" id="yzPayPrint"><table class="yzi-table yz-pay-table">
      <thead><tr><th>İşçi</th><th class="n">Gün</th><th class="n">Saat</th><th class="n">₼ / saat</th><th class="n">Saat üzrə</th><th class="n">Satış</th><th class="n">Faiz %</th><th class="n">Satışdan</th><th class="n">Maaş</th></tr></thead>
      <tbody>${rows.map(x => `<tr>
        <td><b>${esc(x.name)}</b>${x.position ? `<br><small>${esc(x.position)}</small>` : ''}${x.auto ? `<br><small class="yzi-bad">${x.auto} gün çıxışı unudub (avtomatik) — saatı yoxlayın</small>` : ''}${x.open ? `<br><small class="yzi-warn">${x.open} qeyd hələ açıqdır</small>` : ''}</td>
        <td class="n">${x.days}</td><td class="n">${x.hours}</td>
        <td class="n">${numInput(`class="yzi-n" data-rate="${esc(x.id)}" aria-label="Saatlıq dərəcə"`, x.rate || '')}</td>
        <td class="n">${money(x.hourPart)}</td><td class="n">${money(x.sales)}<br><small>${x.tables} masa</small></td>
        <td class="n">${numInput(`class="yzi-n" data-pct="${esc(x.id)}" aria-label="Satışdan faiz"`, x.pct || '')}</td>
        <td class="n">${money(x.salesPart)}</td><td class="n"><b>${money(x.total)}</b></td></tr>`).join('') || '<tr><td colspan="9" class="yzi-empty">Bu dövrdə məlumat yoxdur. İşçinin dərəcəsini yazmaq üçün “İşçi əlavə et” düyməsindən istifadə edin.</td></tr>'}</tbody>
      <tfoot><tr><td>Cəmi</td><td></td><td class="n">${m2(tot.h)}</td><td></td><td></td><td class="n">${money(tot.s)}</td><td></td><td></td><td class="n"><b>${money(tot.p)}</b></td></tr></tfoot>
    </table></div>
    <div class="yz-pay-add"><label class="yzi-f yzi-f--inline"><span>İşçi əlavə et</span><select data-addst><option value="">— seçin —</option>${(state.staff || []).filter(s => !rows.some(x => x.id === s.id)).map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select></label></div>`;
  el.addEventListener('change', async (e) => {
    const f = e.target.dataset.f;
    if (f) { F[f] = e.target.value; render(host); return; }
    const rid = e.target.dataset.rate || e.target.dataset.pct;
    if (rid) {
      const v = Number(String(e.target.value).replace(',', '.'));
      if (e.target.value !== '' && !(v >= 0)) { fail('Rəqəm yazın'); return; }
      if (e.target.dataset.pct && v > 100) { fail('Faiz 100-dən çox ola bilməz'); return; }
      const key = e.target.dataset.rate ? 'hourly' : 'pct';
      try {
        await db.ref(`staffHR/${rid}/pay/${key}`).set(e.target.value === '' ? null : m2(v));
        const s = state.staff.find(x => x.id === rid);
        addLog('staff_mgmt', `${state.user?.name || 'Rəhbər'}: ${s?.name} — ${key === 'hourly' ? 'saatlıq dərəcə' : 'satışdan faiz'} ${e.target.value === '' ? 'silindi' : m2(v) + (key === 'hourly' ? ' ₼' : '%')}`, { staffId: rid });
        ok('Yadda saxlanıldı'); render(host);
      } catch (x) { fail(x.message || String(x)); }
      return;
    }
    if (e.target.dataset.addst !== undefined && e.target.value) { await db.ref(`staffHR/${e.target.value}/pay/hourly`).set(0); render(host); }
  });
  el.querySelector('[data-csv]').onclick = () => {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['İşçi', 'Vəzifə', 'Gün', 'Saat', '₼/saat', 'Saat üzrə', 'Satış', 'Masa', 'Faiz %', 'Satışdan', 'Maaş', 'Avtomatik çıxış'].map(q).join(';'),
      ...rows.map(x => [x.name, x.position, x.days, x.hours, x.rate, x.hourPart, x.sales, x.tables, x.pct, x.salesPart, x.total, x.auto].map(q).join(';'))];
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = `maas-${fmtD(r.from)}-${fmtD(r.to)}.csv`; a.click();
  };
  el.querySelector('[data-print]').onclick = () => {
    const w = window.open('', '_blank', 'width=1000,height=800'); if (!w) { fail('Çap pəncərəsi açılmadı'); return; }
    const tb = el.querySelector('#yzPayPrint').cloneNode(true);
    tb.querySelectorAll('input').forEach(i => { i.replaceWith(document.createTextNode(i.value || '0')); });
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Maaş hesabatı</title><style>body{font:12px system-ui;margin:16px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #bbb;padding:4px 6px}.n{text-align:right}small{color:#555}</style></head><body><h2>Maaş hesabatı</h2><p>${fmtDT(r.from)} — ${fmtDT(r.to)} · çap: ${fmtDT(Date.now())}</p>${tb.innerHTML}</body></html>`);
    w.document.close(); setTimeout(() => w.print(), 300);
  };
}
registerTab({ id: 'payroll', group: 'rep', label: 'Maaş hesabatı', order: 62, perm: canSee, render });
window.__yzPayroll = { compute };
