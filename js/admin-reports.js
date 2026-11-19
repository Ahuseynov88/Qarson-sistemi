/* ═══════════════════════════════════════════
   YUZA POS — ADMİN PANELİ: HESABATLAR
   Mərhələ 5: admin.js-dən ayrılıb (məntiq dəyişməyib). Ümumi giriş nöqtəsi — admin.js.
═══════════════════════════════════════════ */
import { state } from './state.js';
import { db, R } from './firebase-service.js';
import { showToast, serverNow, esc, computeVat, toArr } from './utils.js';
import { getOrderPayments } from './admin-closed.js';
import { renderShiftsReport } from './yuza-shift.js';
import { computeTotal as bqTotal, depositsOf as bqDeposits } from './banquet.js';


/* ═══════════════════════════════════════════
   HESABATLAR
═══════════════════════════════════════════ */

export function localDateStr(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
export function hhmm(h) { return String(h).padStart(2,'0') + ':00'; }

export function setReportQuickRange(type) {
  const now = new Date();
  const bizHour = state._bizDayStartHour || 5;
  let dFrom, dTo;
  const tFrom = hhmm(bizHour), tTo = hhmm(bizHour);

  // Cari an hələ bugünkü "iş günü başlama saatı"na çatmayıbsa, indiki iş günü DÜNƏNDƏN
  // başlayır sayılır (məs. gecə saat 2-də "bugün" hələ DÜNƏNKİ iş günüdür)
  const bizToday = new Date(now);
  if (now.getHours() < bizHour) bizToday.setDate(bizToday.getDate() - 1);
  const bizTodayEnd = new Date(bizToday); bizTodayEnd.setDate(bizTodayEnd.getDate() + 1);

  if (type === 'today' || type === 'dayEnd') {
    dFrom = new Date(bizToday); dTo = new Date(bizTodayEnd);
  } else if (type === 'yesterday') {
    dFrom = new Date(bizToday); dFrom.setDate(dFrom.getDate() - 1);
    dTo = new Date(bizToday);
  } else if (type === 'week') {
    dFrom = new Date(bizToday);
    const day = (dFrom.getDay() + 6) % 7; // Bazar ertəsi = 0
    dFrom.setDate(dFrom.getDate() - day);
    // TAM 7 gün (Bazar ertəsi - Bazar) göstərilir, "bu günə qədər" YOX - bu gün
    // çərşənbə axşamı olsa belə, bütün həftə (gələcək günlər daxil) görünməlidir.
    dTo = new Date(dFrom);
    dTo.setDate(dTo.getDate() + 7);
  } else if (type === 'month') {
    dFrom = new Date(bizToday.getFullYear(), bizToday.getMonth(), 1);
    dTo = new Date(bizTodayEnd);
  } else if (type === 'lastMonth') {
    dFrom = new Date(bizToday.getFullYear(), bizToday.getMonth() - 1, 1);
    dTo = new Date(bizToday.getFullYear(), bizToday.getMonth(), 1);
  } else if (type === 'year') {
    dFrom = new Date(bizToday.getFullYear(), 0, 1);
    dTo = new Date(bizTodayEnd);
  } else if (type === 'monthEnd') {
    dFrom = new Date(bizToday.getFullYear(), bizToday.getMonth(), 1);
    dTo = new Date(bizToday.getFullYear(), bizToday.getMonth() + 1, 1);
  } else return;

  document.getElementById('repDateFrom').value = localDateStr(dFrom);
  document.getElementById('repDateTo').value = localDateStr(dTo);
  document.getElementById('repTimeFrom').value = tFrom;
  document.getElementById('repTimeTo').value = tTo;
  renderReports();
}

export function saveBizDayHour() {
  const val = document.getElementById('repBizDayHour')?.value || '05:00';
  const hour = parseInt(val.split(':')[0], 10) || 0;
  db.ref('settings/bizDayStartHour').set(hour);
  state._bizDayStartHour = hour;
  showToast('<svg class="icon"><use href="#i-check"></use></svg> İş günü başlama saatı yadda saxlanıldı');
}

export function setReportView(view) {
  state._reportView = view;
  document.querySelectorAll('.report-subtab').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  renderReports();
}

/* ═══ Mərhələ 2d: hesabat məlumatı seçilmiş aralığa görə BAZADAN oxunur (200/500 limiti yoxdur) ═══
   • closedOrders — bağlanma vaxtına görə (aralıq ± 3 gün, sonra sifariş vaxtına görə süzülür)
   • payments — eyni aralıqda, sessiyaya görə indekslənir
   • logs — aralıq üzrə (ləğvetmələr)
   Canlı dinləyicinin son qeydləri üstünə əlavə olunur ki, yeni bağlanan masa dərhal görünsün. */
export const REP_MARGIN = 3 * 86400000;
export const REP = { lo: null, hi: null, closed: new Map(), logs: new Map(), loading: null, loadKey: '', err: null };
export const PAYIDX = new Map();   // sessiya açarı → Map(ödəniş id → ödəniş)
export let _lastPayArr = null;
export const payKey = (x) => x?.sessionId || (x?.deliveryId ? 'dlv:' + x.deliveryId : null);
export function indexPays(arr) {
  (arr || []).forEach(p => {
    const k = payKey(p); if (!k || !p.id) return;
    let m = PAYIDX.get(k); if (!m) { m = new Map(); PAYIDX.set(k, m); }
    m.set(p.id, p);
  });
}
export function syncLivePays() { if (state.payments !== _lastPayArr) { _lastPayArr = state.payments; indexPays(state.payments); } }
export function rangeMs(df, tf, dt, tt) {
  let lo = 0, hi = serverNow() + 86400000;
  if (df) { const b = new Date(df); if (tf) { const [h, m] = tf.split(':'); b.setHours(+h, +m, 0, 0); } else b.setHours(0, 0, 0, 0); lo = b.getTime(); }
  if (dt) { const b = new Date(dt); if (tt) { const [h, m] = tt.split(':'); b.setHours(+h, +m, 59, 999); } else b.setHours(23, 59, 59, 999); hi = b.getTime(); }
  return { lo, hi };
}
export function reportBounds() {
  return rangeMs(document.getElementById('repDateFrom')?.value || '', document.getElementById('repTimeFrom')?.value || '',
    document.getElementById('repDateTo')?.value || '', document.getElementById('repTimeTo')?.value || '');
}
export const repCovers = (lo, hi) => REP.lo !== null && lo >= REP.lo && hi <= REP.hi;
export async function ensureReport(lo, hi) {
  if (repCovers(lo, hi)) return;
  const key = lo + ':' + hi;
  if (REP.loading && REP.loadKey === key) return REP.loading;
  REP.loadKey = key;
  REP.loading = (async () => {
    const qlo = lo - REP_MARGIN, qhi = hi + REP_MARGIN;
    const [c, p, l] = await Promise.all([
      R.closedOrders.orderByChild('closedAt').startAt(qlo).endAt(qhi).once('value'),
      R.payments.orderByChild('createdAt').startAt(qlo).endAt(qhi).once('value'),
      R.logs.orderByChild('timestamp').startAt(lo).endAt(hi).once('value')
    ]);
    REP.closed = new Map(Object.entries(c.val() || {}).map(([id, v]) => [id, { id, ...v }]));
    REP.logs = new Map(Object.entries(l.val() || {}).map(([id, v]) => [id, { id, ...v }]));
    indexPays(Object.entries(p.val() || {}).map(([id, v]) => ({ id, ...v })));
    REP.lo = lo; REP.hi = hi; REP.err = null;
  })();
  try { await REP.loading; } catch (e) { REP.err = e; throw e; } finally { if (REP.loadKey === key) REP.loading = null; }
}
// Aralıqdakı bütün bağlanmış masalar (canlı yenilikləri ilə birlikdə)
export function reportPool() {
  if (REP.lo === null) return (state.closedOrders || []);
  (state.closedOrders || []).forEach(o => { const t = o.closedAt || 0; if (t >= REP.lo - REP_MARGIN && t <= REP.hi + REP_MARGIN) REP.closed.set(o.id, o); });
  return [...REP.closed.values()];
}
export function reportLogs() {
  if (REP.lo === null) return (state.logs || []);
  (state.logs || []).forEach(l => { if ((l.timestamp || 0) >= REP.lo && (l.timestamp || 0) <= REP.hi) REP.logs.set(l.id, l); });
  return [...REP.logs.values()].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}
// "Bağlanan masalar" bölməsi üçün ayrıca keş (tarix aralığı seçiləndə)
export const CO = { lo: null, hi: null, map: new Map(), loading: null, key: '' };
export async function ensureClosedList(lo, hi) {
  const key = lo + ':' + hi;
  if (CO.loading && CO.key === key) return CO.loading;
  CO.key = key;
  CO.loading = (async () => {
    const [c, p] = await Promise.all([
      R.closedOrders.orderByChild('closedAt').startAt(lo).endAt(hi).once('value'),
      R.payments.orderByChild('createdAt').startAt(lo - REP_MARGIN).endAt(hi + REP_MARGIN).once('value')
    ]);
    CO.map = new Map(Object.entries(c.val() || {}).map(([id, v]) => [id, { id, ...v }]));
    indexPays(Object.entries(p.val() || {}).map(([id, v]) => ({ id, ...v })));
    CO.lo = lo; CO.hi = hi;
  })();
  try { await CO.loading; } finally { if (CO.key === key) CO.loading = null; }
}
export function closedById(id) {
  return (state.closedOrders || []).find(x => x.id === id) || CO.map.get(id) || REP.closed.get(id) || null;
}

export function getReportFilteredOrders() {
  const dateFrom = document.getElementById('repDateFrom')?.value || '';
  const dateTo = document.getElementById('repDateTo')?.value || '';
  const timeFrom = document.getElementById('repTimeFrom')?.value || '';
  const timeTo = document.getElementById('repTimeTo')?.value || '';
  return reportPool().filter(o => {
    if (o.void) return false;   // geri qaytarılmış (ləğv edilmiş) çek hesabata düşmür
    // Hesabatlar SİFARİŞİN VERİLDİYİ vaxta görə aparılır, masanın BAĞLANDIĞI vaxta görə
    // YOX - saat 6-da açılıb 12-də bağlanan masa "12" yox "6" saatına aid sayılmalıdır.
    // Köhnə (bu sahə olmayan) qeydlər üçün closedAt-a geri dönür.
    const refTime = o.firstOrderAt || o.closedAt;
    if (dateFrom) {
      const b = new Date(dateFrom);
      if (timeFrom) { const [h,m] = timeFrom.split(':'); b.setHours(+h,+m,0,0); } else { b.setHours(0,0,0,0); }
      if (refTime < b.getTime()) return false;
    }
    if (dateTo) {
      const b = new Date(dateTo);
      if (timeTo) { const [h,m] = timeTo.split(':'); b.setHours(+h,+m,59,999); } else { b.setHours(23,59,59,999); }
      if (refTime > b.getTime()) return false;
    }
    return true;
  });
}

export const resolvePaymentMethodName = (id) => id==='cash'?'Nağd':id==='pos'?'POS':((state.paymentMethods||[]).find(m=>m.id===id)?.name || 'Silinmiş növ');

export function buildPaymentTypeBreakdown(orders) {
  const breakdown = {}; // label -> {amount, count}
  orders.forEach(o => {
    getOrderPayments(o).forEach(p => {
      if (p.type === 'split' && p.splitBreakdown) {
        Object.entries(p.splitBreakdown).forEach(([mid, amt]) => {
          const key = p.splitMethodNames?.[mid] || resolvePaymentMethodName(mid);
          if (!breakdown[key]) breakdown[key] = { amount: 0, count: 0 };
          breakdown[key].amount += amt || 0; breakdown[key].count++;
        });
      } else {
        const key = p.typeLabel || p.type;
        if (!breakdown[key]) breakdown[key] = { amount: 0, count: 0 };
        breakdown[key].amount += p.thisPay || 0; breakdown[key].count++;
      }
    });
    // Banket masası: beh əvvəlcədən alınıb (kassaya alındığı gün düşüb) — burada yalnız məbləğin bölgüsü üçün göstərilir
    if (o.banquet && Number(o.banquet.depositTotal) > 0) {
      const key = 'Banket behi (əvvəlcədən)';
      if (!breakdown[key]) breakdown[key] = { amount: 0, count: 0 };
      breakdown[key].amount += Math.min(Number(o.banquet.depositTotal) || 0, Number(o.total) || 0); breakdown[key].count++;
    }
  });
  return breakdown;
}

export function renderReports() {
  const el = document.getElementById('reportContent');
  if (!el) return;
  const view = state._reportView || 'summary';

  // "Hazırda Açıq Masalar" hesabatı canlı vəziyyəti göstərir - tarix filtri ilə
  // ƏLAQƏLİ DEYİL, ona görə aşağıdakı "bağlanan masa yoxdursa boş göstər" yoxlamasından
  // TAMAMİLƏ keçib bunu birbaşa göstəririk.
  if (view === 'openTables') { renderReportOpenTablesView(el); return; }
  if (view === 'credit') { renderReportCreditView(el); return; }
  const { lo, hi } = reportBounds();
  if (view === 'shifts') { const se = document.getElementById('reportRangeSummary'); if (se) se.textContent = ''; renderShiftsReport(el, lo, hi); return; }

  // Mərhələ 2d: aralığın məlumatı hələ yüklənməyibsə — bazadan oxunur, sonra hesabat çəkilir
  const loadLo = view === 'compare' ? lo - Math.max(0, hi - lo) : lo;
  if (!repCovers(loadLo, hi)) {
    el.innerHTML = '<p class="report-empty">Seçilmiş aralığın məlumatı yüklənir…</p>';
    ensureReport(loadLo, hi).then(() => renderReports())
      .catch(e => { el.innerHTML = `<p class="report-empty">Məlumat oxunmadı: ${esc(e?.message || 'bağlantı xətası')}. Yenidən cəhd edin.</p>`; });
    return;
  }
  syncLivePays();

  const orders = getReportFilteredOrders();
  const summaryEl = document.getElementById('reportRangeSummary');
  if (summaryEl) summaryEl.textContent = `${orders.length} əməliyyat tapıldı`;

  // "Ləğvetmələr" hesabatı "logs" mənbəyindən qurulur, "closedOrders"dan ASILI DEYİL -
  // ona görə bağlanan masa olmasa belə (yalnız ləğvetmə olsa) düzgün göstərilməlidir.
  if (view === 'cancellations') { renderReportCancellationsView(el); return; }

  if (!orders.length) { el.innerHTML = '<p class="report-empty"><svg class="icon" style="width:28px;height:28px;"><use href="#i-clipboard"></use></svg><br>Seçilmiş tarix/saat aralığında əməliyyat tapılmadı.</p>'; return; }

  if (view === 'summary') renderReportSummaryView(orders, el);
  else if (view === 'payments') renderReportPaymentsView(orders, el);
  else if (view === 'staff') renderReportStaffView(orders, el);
  else if (view === 'items') renderReportItemsView(orders, el);
  else if (view === 'tables') renderReportTablesView(orders, el);
  else if (view === 'days') renderReportDaysView(orders, el);
  else if (view === 'hours') renderReportHoursView(orders, el);
  else if (view === 'discounts') renderReportDiscountsView(orders, el);
  else if (view === 'turnover') renderReportTurnoverView(orders, el);
  else if (view === 'loyalty') renderReportLoyaltyView(orders, el);
  else if (view === 'compare') renderReportCompareView(orders, el);
  else renderReportSummaryView(orders, el);
}

export function renderReportSummaryView(orders, el) {
  const totalRevenue = orders.reduce((s,o)=>s+(o.total||0),0);
  let totalDiscount = 0, totalCompliment = 0, itemCount = 0;
  orders.forEach(o => {
    Object.values(o.items||{}).forEach(it => {
      itemCount += it.qty || 0;
      if (it.compliment) totalCompliment += (it.originalPrice||0)*it.qty + (it.originalExtraFee||0);
      else if (it.discountPercent > 0) totalDiscount += (it.price||0)*it.qty*(it.discountPercent/100);
    });
  });
  const avgCheck = orders.length ? totalRevenue/orders.length : 0;
  const breakdown = buildPaymentTypeBreakdown(orders);
    const entries = Object.entries(breakdown).sort((a,b)=>b[1].amount-a[1].amount);

  // ƏDV — bağlanmış masaların mallarındakı faizə görə (mal sifarişə düşən anda saxlanılan faiz)
  const vatByRate = {};
  let vatTotal = 0;
  orders.forEach(o => {
    computeVat(o.items).rows.forEach(r => {
      const k = r.rate + (r.included ? 'i' : 'a');
      vatByRate[k] = vatByRate[k] || { rate: r.rate, included: r.included, amount: 0 };
      vatByRate[k].amount += r.amount;
      vatTotal += r.amount;
    });
  });
  const vatRowsRep = Object.values(vatByRate).filter(r => r.amount > 0).sort((a,b)=>b.rate-a.rate);
  const vatHtml = `<div class="report-section-title" style="margin-top:22px;"><svg class="icon"><use href="#i-tag"></use></svg> ƏDV bölgüsü</div>
    <table class="report-table">
      <thead><tr><th>Faiz</th><th>Növ</th><th class="num">ƏDV məbləği</th></tr></thead>
      <tbody>
        ${vatRowsRep.length ? vatRowsRep.map(r => `<tr><td>${r.rate}%</td><td>${r.included ? 'Qiymətə daxil' : 'Üstünə əlavə'}</td><td class="num">${r.amount.toFixed(2)} ₼</td></tr>`).join('')
          + `<tr class="report-table__top"><td colspan="2">Cəmi ƏDV</td><td class="num">${vatTotal.toFixed(2)} ₼</td></tr>`
          : '<tr><td colspan="3" style="text-align:center;color:var(--text3);">Bu aralıqda ƏDV-li satış yoxdur</td></tr>'}
      </tbody>
    </table>`;

  el.innerHTML = `
    <div class="ct-report__stats" style="margin-bottom:22px;">
      <div class="stat-card"><div class="stat-num" style="color:var(--green);">${totalRevenue.toFixed(2)} ₼</div><div class="stat-label">Ümumi dövriyyə</div></div>
      <div class="stat-card"><div class="stat-num">${orders.length}</div><div class="stat-label">Bağlanan masa</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--blue);">${avgCheck.toFixed(2)} ₼</div><div class="stat-label">Orta çek</div></div>
      <div class="stat-card"><div class="stat-num">${itemCount}</div><div class="stat-label">Satılan mal (ədəd)</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--orange);">${totalDiscount.toFixed(2)} ₼</div><div class="stat-label">Verilən endirim</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--purple);">${totalCompliment.toFixed(2)} ₼</div><div class="stat-label">İkram dəyəri</div></div>
    </div>
    <div class="report-section-title"><svg class="icon"><use href="#i-money"></use></svg> Ödəniş növünə görə bölgü</div>
    <table class="report-table">
      <thead><tr><th>Növ</th><th class="num">Məbləğ</th><th class="num">Pay</th></tr></thead>
      <tbody>
        ${entries.length ? entries.map(([label,v]) => `<tr><td>${esc(label)}</td><td class="num">${v.amount.toFixed(2)} ₼</td><td class="num">${totalRevenue?((v.amount/totalRevenue)*100).toFixed(1):0}%</td></tr>`).join('')
                    : '<tr><td colspan="3" style="text-align:center;color:var(--text3);">Ödəniş qeydi yoxdur</td></tr>'}
      </tbody>
    </table>
    ${vatHtml}
  `;
}

// KASSA ƏMƏLİYYATLARI - proqramdakı BÜTÜN pul hərəkətini (mədaxil + məxaric) bir yerə
// toplayır: masa ödənişləri, nisyə ödənişləri, banket ödənişləri (mədaxil) və
// təchizatçı ödənişləri (məxaric). Seçilmiş tarix/saat aralığına görə filtrlənir.
export function buildKassaLedger(orders) {
  const dateFrom = document.getElementById('repDateFrom')?.value || '';
  const dateTo = document.getElementById('repDateTo')?.value || '';
  const timeFrom = document.getElementById('repTimeFrom')?.value || '';
  const timeTo = document.getElementById('repTimeTo')?.value || '';
  const inRange = (ts) => {
    if (dateFrom) { const b = new Date(dateFrom); if (timeFrom) { const [h,m]=timeFrom.split(':'); b.setHours(+h,+m,0,0);} else b.setHours(0,0,0,0); if (ts < b.getTime()) return false; }
    if (dateTo) { const b = new Date(dateTo); if (timeTo) { const [h,m]=timeTo.split(':'); b.setHours(+h,+m,59,999);} else b.setHours(23,59,59,999); if (ts > b.getTime()) return false; }
    return true;
  };

  const income = [];
  const expense = [];

  // 1) Masa ödənişləri
  orders.forEach(o => {
    getOrderPayments(o).forEach(p => {
      const ts = o.firstOrderAt || o.closedAt || 0;
      if (p.type === 'split' && p.splitBreakdown) {
        Object.entries(p.splitBreakdown).forEach(([mid, amt]) => {
          income.push({ ts, category: 'Masa Ödənişi', method: p.splitMethodNames?.[mid] || resolvePaymentMethodName(mid), amount: amt||0, source: o.tableName||'Masa', who: o.staffName||o.orderedByName||'?' });
        });
      } else {
        income.push({ ts, category: 'Masa Ödənişi', method: p.typeLabel || resolvePaymentMethodName(p.type), amount: p.thisPay||0, source: o.tableName||'Masa', who: o.staffName||o.orderedByName||'?' });
      }
    });
  });

  // 2) Nisyə (kredit) ödənişləri
  (state.customerCharges||[]).filter(ch => ch.type === 'payment' && inRange(ch.createdAt||0)).forEach(ch => {
    income.push({ ts: ch.createdAt||0, category: 'Nisyə Ödənişi', method: ch.paymentType==='pos'?'POS':(ch.paymentType==='cash'?'Nağd':(state.paymentMethods||[]).find(pm=>pm.id===ch.paymentType)?.name||ch.paymentType), amount: ch.amount||0, source: state.customers.find(c=>c.id===ch.customerId)?.name || 'Müştəri', who: ch.staffName||'?' });
  });

  // 3) Banket ödənişləri: köhnə avans qeydləri + yeni beh (alındığı anda kassaya düşür; masa bağlananda təkrar sayılmır)
  (state.banquetEvents||[]).forEach(ev => {
    (ev.paymentHistory||[]).forEach(p => {
      if (!inRange(p.date||0)) return;
      income.push({ ts: p.date||0, category: 'Banket Ödənişi', method: p.method==='cash'?'Nağd':p.method==='card'?'Kart':p.method==='transfer'?'Köçürmə':p.method, amount: p.amount||0, source: ev.clientName||'Tədbir', who: ev.staffName||'?' });
    });
    Object.values(ev.deposits||{}).forEach(d => {
      if (!inRange(d.at||0)) return;
      income.push({ ts: d.at||0, category: 'Banket Behi', method: d.method==='cash'?'Nağd':d.method==='pos'?'POS':(d.methodLabel||resolvePaymentMethodName(d.method)), amount: Number(d.amount)||0, source: ev.clientName||'Tədbir', who: d.byName||'?' });
    });
  });

  // 4) Anbar sistemindən təchizatçı ödənişləri (yalnız təsdiqlənmiş)
  (state.invPayments||[]).filter(p => inRange(p.at||0)).forEach(p => {
    expense.push({ ts: p.at||0, category: 'Təchizatçı Ödənişi', method: p.method==='cash'?'Nağd':p.method==='transfer'?'Köçürmə':p.method==='card'?'Kart':p.method, amount: p.amount||0, source: p.supplierName||'Təchizatçı', who: p.approvedByName||p.createdByName||'?' });
  });

  income.sort((a,b) => b.ts - a.ts);
  expense.sort((a,b) => b.ts - a.ts);
  return { income, expense };
}

export function renderReportPaymentsView(orders, el) {
  const { income, expense } = buildKassaLedger(orders);
  const totalIncome = income.reduce((s,e) => s+e.amount, 0);
  const totalExpense = expense.reduce((s,e) => s+e.amount, 0);
  const net = Math.round((totalIncome - totalExpense)*100)/100;

  // Mədaxili növünə görə cəmləyir (Masa/Nisyə/Banket)
  const incomeByCategory = {};
  income.forEach(e => { incomeByCategory[e.category] = (incomeByCategory[e.category]||0) + e.amount; });
  // Məxaric mənbəyinə görə cəmləyir
  const expenseByCategory = {};
  expense.forEach(e => { expenseByCategory[e.category] = (expenseByCategory[e.category]||0) + e.amount; });

  // Nağd üzrə gün sonu hesablaması (kassada faktiki olmalı olan pul)
  const cashIncome = income.filter(e => e.method==='Nağd').reduce((s,e)=>s+e.amount,0);
  const cashExpense = expense.filter(e => e.method==='Nağd').reduce((s,e)=>s+e.amount,0);
  const cashNet = Math.round((cashIncome-cashExpense)*100)/100;

  // Gözlənilən daxilolmalar - tarix filtrindən ASILI DEYİL, HAZIRKI ümumi borc vəziyyəti
  const pendingCredit = (state.customers||[]).reduce((s,c) => s + (c.balance||0), 0);
  const pendingBanquet = (state.banquetEvents||[]).filter(e=>!['cancelled','done','seated'].includes(e.status)).reduce((s,e) => s + Math.max(0, bqTotal(e) - bqDeposits(e)), 0);
  const totalPending = Math.round((pendingCredit+pendingBanquet)*100)/100;

  const fmtTime = (ts) => ts ? new Date(ts).toLocaleString('az-AZ', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—';

  el.innerHTML = `
    <div class="ct-report__stats" style="margin-bottom:20px;">
      <div class="stat-card"><div class="stat-num" style="color:var(--green);">${totalIncome.toFixed(2)} ₼</div><div class="stat-label">Ümumi Mədaxil</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--red);">${totalExpense.toFixed(2)} ₼</div><div class="stat-label">Ümumi Məxaric</div></div>
      <div class="stat-card"><div class="stat-num" style="color:${net>=0?'var(--green)':'var(--red)'};">${net.toFixed(2)} ₼</div><div class="stat-label">Xalis Fərq</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--orange);">${totalPending.toFixed(2)} ₼</div><div class="stat-label">Gözlənilən Daxilolma (nisyə+banket)</div></div>
    </div>

    <div class="report-section-title"><svg class="icon" style="width:.9em;height:.9em;"><use href="#i-cash"></use></svg> Gün Sonu — Nağd Kassa Hesablaması</div>
    <div class="ct-report__stats" style="margin-bottom:20px;">
      <div class="stat-card"><div class="stat-num" style="color:var(--green);font-size:20px;">${cashIncome.toFixed(2)} ₼</div><div class="stat-label">Nağd Mədaxil</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--red);font-size:20px;">${cashExpense.toFixed(2)} ₼</div><div class="stat-label">Nağd Məxaric</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--blue);font-size:20px;">${cashNet.toFixed(2)} ₼</div><div class="stat-label">Kassada Olmalı Nağd</div></div>
    </div>

    <div class="report-section-title"><svg class="icon" style="width:.9em;height:.9em;"><use href="#i-check"></use></svg> Mədaxil növünə görə</div>
    <table class="report-table" style="margin-bottom:18px;">
      <thead><tr><th>Növ</th><th class="num">Məbləğ</th><th class="num">Pay</th></tr></thead>
      <tbody>${Object.entries(incomeByCategory).sort((a,b)=>b[1]-a[1]).map(([cat,amt]) => `<tr><td>${esc(cat)}</td><td class="num">${amt.toFixed(2)} ₼</td><td class="num">${totalIncome?((amt/totalIncome)*100).toFixed(1):0}%</td></tr>`).join('') || '<tr><td colspan="3" style="text-align:center;color:var(--text3);">Bu aralıqda mədaxil yoxdur</td></tr>'}</tbody>
    </table>

    <div class="report-section-title"><svg class="icon" style="width:.9em;height:.9em;"><use href="#i-cash"></use></svg> Məxaric mənbəyinə görə</div>
    <table class="report-table" style="margin-bottom:18px;">
      <thead><tr><th>Növ</th><th class="num">Məbləğ</th><th class="num">Pay</th></tr></thead>
      <tbody>${Object.entries(expenseByCategory).sort((a,b)=>b[1]-a[1]).map(([cat,amt]) => `<tr><td>${esc(cat)}</td><td class="num">${amt.toFixed(2)} ₼</td><td class="num">${totalExpense?((amt/totalExpense)*100).toFixed(1):0}%</td></tr>`).join('') || '<tr><td colspan="3" style="text-align:center;color:var(--text3);">Bu aralıqda məxaric yoxdur</td></tr>'}</tbody>
    </table>

    <div class="report-section-title"><svg class="icon" style="width:.9em;height:.9em;"><use href="#i-clipboard"></use></svg> Ətraflı Mədaxil Siyahısı</div>
    <table class="report-table" style="margin-bottom:18px;">
      <thead><tr><th>Tarix/Saat</th><th>Növ</th><th>Ödəniş üsulu</th><th>Haradan/Kimdən</th><th>İşçi</th><th class="num">Məbləğ</th></tr></thead>
      <tbody>${income.slice(0,300).map(e => `<tr><td>${fmtTime(e.ts)}</td><td>${esc(e.category)}</td><td>${esc(e.method)}</td><td>${esc(e.source)}</td><td>${esc(e.who)}</td><td class="num" style="color:var(--green);">+${e.amount.toFixed(2)} ₼</td></tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--text3);">Bu aralıqda mədaxil yoxdur</td></tr>'}</tbody>
    </table>

    <div class="report-section-title"><svg class="icon" style="width:.9em;height:.9em;"><use href="#i-clipboard"></use></svg> Ətraflı Məxaric Siyahısı</div>
    <table class="report-table">
      <thead><tr><th>Tarix/Saat</th><th>Növ</th><th>Ödəniş üsulu</th><th>Haraya/Kimə</th><th>İşçi</th><th class="num">Məbləğ</th></tr></thead>
      <tbody>${expense.slice(0,300).map(e => `<tr><td>${fmtTime(e.ts)}</td><td>${esc(e.category)}</td><td>${esc(e.method)}</td><td>${esc(e.source)}</td><td>${esc(e.who)}</td><td class="num" style="color:var(--red);">-${e.amount.toFixed(2)} ₼</td></tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--text3);">Bu aralıqda məxaric yoxdur</td></tr>'}</tbody>
    </table>
  `;
}

export function renderReportStaffView(orders, el) {
  const byStaff = {};
  orders.forEach(o => {
    // Masa başqa ofisianta ötürülübsə: hər ofisiant öz payını alır (ötürülənə qədər köhnə, sonra yeni)
    if (Array.isArray(o.waiterSplit) && o.waiterSplit.length) {
      o.waiterSplit.forEach(w => {
        const nm = w.name || 'Naməlum';
        if (!byStaff[nm]) byStaff[nm] = { count: 0, revenue: 0 };
        byStaff[nm].count++; byStaff[nm].revenue += w.amount || 0;
      });
      return;
    }
    // Sifarişi göndərən (satışı edən) işçiyə görə hesablanır - masanı bağlayan işçiyə görə
    // YOX, çünki başqa işçi bağlaya bilər. Köhnə qeydlərdə bu sahə yoxdursa, bağlayan işçiyə düşür.
    const name = o.orderedByName || o.staffName || 'Naməlum';
    if (!byStaff[name]) byStaff[name] = { count: 0, revenue: 0 };
    byStaff[name].count++; byStaff[name].revenue += o.total || 0;
  });
  const entries = Object.entries(byStaff).sort((a,b)=>b[1].revenue-a[1].revenue);
  el.innerHTML = `
    <div class="report-section-title"><svg class="icon"><use href="#i-staff"></use></svg> Sifarişi göndərən işçiyə görə (satış performansı)</div>
    <table class="report-table">
      <thead><tr><th>İşçi</th><th class="num">Sifariş verilən masa</th><th class="num">Dövriyyə</th><th class="num">Orta çek</th></tr></thead>
      <tbody>${entries.map(([name,v],i) => `<tr class="${i===0?'report-table__top':''}"><td>${esc(name)}</td><td class="num">${v.count}</td><td class="num">${v.revenue.toFixed(2)} ₼</td><td class="num">${(v.revenue/v.count).toFixed(2)} ₼</td></tr>`).join('')}</tbody>
    </table>
  `;
}

export function renderReportItemsView(orders, el) {
  const byItem = {};
  let totalQty = 0, totalRevenue = 0;
  orders.forEach(o => {
    Object.values(o.items||{}).forEach(it => {
      if (!byItem[it.name]) byItem[it.name] = { qty: 0, revenue: 0, discountAmt: 0, discountQty: 0, complimentAmt: 0, complimentQty: 0 };
      const rev = (it.price||0)*it.qty*(1-((it.discountPercent||0)/100)) + (it.extraFee||0);
      byItem[it.name].qty += it.qty || 0;
      byItem[it.name].revenue += rev;
      totalQty += it.qty || 0; totalRevenue += rev;
      if (it.compliment) { byItem[it.name].complimentAmt += (it.originalPrice||0)*it.qty + (it.originalExtraFee||0); byItem[it.name].complimentQty += it.qty||0; }
      else if (it.discountPercent > 0) { byItem[it.name].discountAmt += (it.price||0)*it.qty*(it.discountPercent/100); byItem[it.name].discountQty += it.qty||0; }
    });
  });
  const itemEntries = Object.entries(byItem);
  const byQtySorted = [...itemEntries].sort((a,b)=>b[1].qty-a[1].qty);
  const byRevenueSorted = [...itemEntries].sort((a,b)=>b[1].revenue-a[1].revenue);
  const topByQty = byQtySorted[0];
  const topByRevenue = byRevenueSorted[0];

  // Kateqoriya üzrə: hər kateqoriyanın cəmi + o kateqoriyadakı malların tək-tək bölgüsü
  const byCategory = {};
  itemEntries.forEach(([name,v]) => {
    const cat = state.menuItems.find(m=>m.name===name)?.category || 'Digər';
    if (!byCategory[cat]) byCategory[cat] = { qty: 0, revenue: 0, items: [] };
    byCategory[cat].qty += v.qty; byCategory[cat].revenue += v.revenue;
    byCategory[cat].items.push([name, v]);
  });
  const catEntries = Object.entries(byCategory).sort((a,b)=>b[1].revenue-a[1].revenue);

  // Ləğv olunmuş mallar - "logs"dan (order_cancel tipli), mala görə cəmlənir
  const cancelledByItem = {};
  reportLogs().filter(l => l.type === 'order_cancel').forEach(l => {
    const name = l.details?.itemName || 'Naməlum';
    if (!cancelledByItem[name]) cancelledByItem[name] = { qty: 0, amount: 0 };
    cancelledByItem[name].qty += l.details?.qty || 0;
    cancelledByItem[name].amount += l.details?.amount || 0;
  });
  const cancelledEntries = Object.entries(cancelledByItem).sort((a,b)=>b[1].amount-a[1].amount);

  const discountedEntries = itemEntries.filter(([,v]) => v.discountQty > 0).sort((a,b)=>b[1].discountAmt-a[1].discountAmt);
  const complimentedEntries = itemEntries.filter(([,v]) => v.complimentQty > 0).sort((a,b)=>b[1].complimentAmt-a[1].complimentAmt);

  el.innerHTML = `
    <div class="ct-report__stats" style="margin-bottom:20px;">
      <div class="stat-card"><div class="stat-num" style="color:var(--blue);">${totalQty}</div><div class="stat-label">Ümumi Satış (ədəd)</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--green);">${totalRevenue.toFixed(2)} ₼</div><div class="stat-label">Ümumi Gəlir</div></div>
    </div>
    <div class="ct-report__stats" style="margin-bottom:20px;">
      <div class="stat-card"><div class="stat-num" style="color:var(--purple);font-size:16px;">${topByQty?esc(topByQty[0]):'—'}</div><div class="stat-label">Ən Çox Satılan (${topByQty?topByQty[1].qty:0} ədəd)</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--purple);font-size:16px;">${topByRevenue?esc(topByRevenue[0]):'—'}</div><div class="stat-label">Ən Yüksək Gəlir (${topByRevenue?topByRevenue[1].revenue.toFixed(2):0} ₼)</div></div>
    </div>

    <div class="report-section-title"><svg class="icon"><use href="#i-tag"></use></svg> Kateqoriya üzrə bölgü (hər kateqoriyanın öz malları ilə)</div>
    ${catEntries.map(([cat,v]) => `
      <table class="report-table" style="margin-bottom:10px;">
        <thead><tr><th style="background:var(--card2);">${esc(cat)} — ${v.qty} ədəd, ${v.revenue.toFixed(2)} ₼</th><th class="num" style="background:var(--card2);">Ədəd</th><th class="num" style="background:var(--card2);">Gəlir</th></tr></thead>
        <tbody>${v.items.sort((a,b)=>b[1].revenue-a[1].revenue).map(([name,iv]) => `<tr><td style="padding-left:20px;color:var(--text2);">${esc(name)}</td><td class="num">${iv.qty}</td><td class="num">${iv.revenue.toFixed(2)} ₼</td></tr>`).join('')}</tbody>
      </table>
    `).join('') || '<p class="report-empty">Bu aralıqda satış yoxdur.</p>'}

    <div class="report-section-title"><svg class="icon"><use href="#i-trash"></use></svg> Ləğv olunmuş mallar</div>
    <table class="report-table" style="margin-bottom:18px;">
      <thead><tr><th>Mal</th><th class="num">Ədəd</th><th class="num">Məbləğ</th></tr></thead>
      <tbody>${cancelledEntries.length ? cancelledEntries.map(([name,v]) => `<tr><td>${esc(name)}</td><td class="num">${v.qty}</td><td class="num" style="color:var(--red);">${v.amount.toFixed(2)} ₼</td></tr>`).join('') : '<tr><td colspan="3" style="text-align:center;color:var(--text3);">Bu aralıqda ləğv olunmuş mal yoxdur</td></tr>'}</tbody>
    </table>

    <div class="report-section-title"><svg class="icon"><use href="#i-tag"></use></svg> Endirim olunmuş mallar</div>
    <table class="report-table" style="margin-bottom:18px;">
      <thead><tr><th>Mal</th><th class="num">Ədəd</th><th class="num">Endirim Məbləği</th></tr></thead>
      <tbody>${discountedEntries.length ? discountedEntries.map(([name,v]) => `<tr><td>${esc(name)}</td><td class="num">${v.discountQty}</td><td class="num" style="color:var(--orange);">${v.discountAmt.toFixed(2)} ₼</td></tr>`).join('') : '<tr><td colspan="3" style="text-align:center;color:var(--text3);">Bu aralıqda endirim olunmuş mal yoxdur</td></tr>'}</tbody>
    </table>

    <div class="report-section-title"><svg class="icon"><use href="#i-tag"></use></svg> İkram olunmuş mallar</div>
    <table class="report-table" style="margin-bottom:18px;">
      <thead><tr><th>Mal</th><th class="num">Ədəd</th><th class="num">İkram Dəyəri</th></tr></thead>
      <tbody>${complimentedEntries.length ? complimentedEntries.map(([name,v]) => `<tr><td>${esc(name)}</td><td class="num">${v.complimentQty}</td><td class="num" style="color:var(--purple);">${v.complimentAmt.toFixed(2)} ₼</td></tr>`).join('') : '<tr><td colspan="3" style="text-align:center;color:var(--text3);">Bu aralıqda ikram olunmuş mal yoxdur</td></tr>'}</tbody>
    </table>

    <div class="report-section-title"><svg class="icon"><use href="#i-food"></use></svg> Bütün mallar (gəlirə görə sıralanıb)</div>
    <table class="report-table">
      <thead><tr><th>Mal</th><th class="num">Ədəd</th><th class="num">Gəlir</th></tr></thead>
      <tbody>${byRevenueSorted.map(([name,v],i) => `<tr class="${i<3?'report-table__top':''}"><td>${esc(name)}</td><td class="num">${v.qty}</td><td class="num">${v.revenue.toFixed(2)} ₼</td></tr>`).join('') || '<tr><td colspan="3" style="text-align:center;color:var(--text3);">—</td></tr>'}</tbody>
    </table>
  `;
}

export function renderReportTablesView(orders, el) {
  const byTable = {};
  orders.forEach(o => {
    const name = (o.tableName || '?').replace(/\s*\*+$/, '');
    if (!byTable[name]) byTable[name] = { count: 0, revenue: 0 };
    byTable[name].count++; byTable[name].revenue += o.total || 0;
  });
  const entries = Object.entries(byTable).sort((a,b)=>b[1].revenue-a[1].revenue);
  el.innerHTML = `
    <div class="report-section-title"><svg class="icon"><use href="#i-chair"></use></svg> Masalara görə dövriyyə</div>
    <table class="report-table">
      <thead><tr><th>Masa</th><th class="num">Neçə dəfə bağlanıb</th><th class="num">Dövriyyə</th><th class="num">Orta</th></tr></thead>
      <tbody>${entries.map(([name,v],i) => `<tr class="${i===0?'report-table__top':''}"><td>${esc(name)}</td><td class="num">${v.count}</td><td class="num">${v.revenue.toFixed(2)} ₼</td><td class="num">${(v.revenue/v.count).toFixed(2)} ₼</td></tr>`).join('')}</tbody>
    </table>
  `;
}

export function renderReportDaysView(orders, el) {
  const byDay = {};
  orders.forEach(o => {
    const refTime = o.firstOrderAt || o.closedAt;
    const d = new Date(refTime).toLocaleDateString('az-AZ');
    if (!byDay[d]) byDay[d] = { count: 0, revenue: 0, ts: refTime };
    byDay[d].count++; byDay[d].revenue += o.total || 0;
  });
  const entries = Object.entries(byDay).sort((a,b)=>a[1].ts-b[1].ts);
  const maxRev = Math.max(...entries.map(([,v])=>v.revenue), 1);
  el.innerHTML = `
    <div class="report-section-title"><svg class="icon"><use href="#i-clipboard"></use></svg> Günlərə görə dövriyyə</div>
    <div class="report-bar-chart">
      ${entries.map(([day,v]) => `<div class="report-bar-chart__col"><span class="report-bar-chart__val">${v.revenue.toFixed(0)}₼</span><div class="report-bar-chart__bar" style="height:${Math.max(4,(v.revenue/maxRev)*130)}px;"></div><span class="report-bar-chart__label">${esc(day)}</span></div>`).join('')}
    </div>
    <table class="report-table" style="margin-top:18px;">
      <thead><tr><th>Tarix</th><th class="num">Masa sayı</th><th class="num">Dövriyyə</th><th class="num">Orta çek</th></tr></thead>
      <tbody>${entries.slice().reverse().map(([day,v]) => `<tr><td>${esc(day)}</td><td class="num">${v.count}</td><td class="num">${v.revenue.toFixed(2)} ₼</td><td class="num">${(v.revenue/v.count).toFixed(2)} ₼</td></tr>`).join('')}</tbody>
    </table>
  `;
}

export function renderReportHoursView(orders, el) {
  const byHour = {};
  for (let h=0; h<24; h++) byHour[h] = { count: 0, revenue: 0 };
  orders.forEach(o => {
    const h = new Date(o.firstOrderAt || o.closedAt).getHours();
    byHour[h].count++; byHour[h].revenue += o.total || 0;
  });
  const entries = Object.entries(byHour).map(([h,v]) => [parseInt(h,10), v]);
  const maxRev = Math.max(...entries.map(([,v])=>v.revenue), 1);
  el.innerHTML = `
    <div class="report-section-title"><svg class="icon"><use href="#i-clock"></use></svg> Saatlara görə dövriyyə (ən yığcam saatları göstərir)</div>
    <div class="report-bar-chart">
      ${entries.map(([h,v]) => `<div class="report-bar-chart__col"><span class="report-bar-chart__val">${v.revenue>0?v.revenue.toFixed(0)+'₼':''}</span><div class="report-bar-chart__bar" style="height:${Math.max(2,(v.revenue/maxRev)*130)}px;"></div><span class="report-bar-chart__label">${String(h).padStart(2,'0')}</span></div>`).join('')}
    </div>
    <table class="report-table" style="margin-top:18px;">
      <thead><tr><th>Saat aralığı</th><th class="num">Masa sayı</th><th class="num">Dövriyyə</th></tr></thead>
      <tbody>${entries.filter(([,v])=>v.count>0).map(([h,v]) => `<tr><td>${String(h).padStart(2,'0')}:00 – ${String(h).padStart(2,'0')}:59</td><td class="num">${v.count}</td><td class="num">${v.revenue.toFixed(2)} ₼</td></tr>`).join('')}</tbody>
    </table>
  `;
}

export function renderReportDiscountsView(orders, el) {
  let totalDiscount = 0, totalCompliment = 0;
  const byStaff = {};
  orders.forEach(o => {
    let orderDiscount = 0, orderCompliment = 0;
    Object.values(o.items||{}).forEach(it => {
      if (it.compliment) orderCompliment += (it.originalPrice||0)*it.qty + (it.originalExtraFee||0);
      else if (it.discountPercent > 0) orderDiscount += (it.price||0)*it.qty*(it.discountPercent/100);
    });
    if (orderDiscount > 0 || orderCompliment > 0) {
      const name = o.staffName || 'Naməlum';
      if (!byStaff[name]) byStaff[name] = { discount: 0, compliment: 0, count: 0 };
      byStaff[name].discount += orderDiscount;
      byStaff[name].compliment += orderCompliment;
      byStaff[name].count++;
    }
    totalDiscount += orderDiscount;
    totalCompliment += orderCompliment;
  });
  const entries = Object.entries(byStaff).sort((a,b)=>(b[1].discount+b[1].compliment)-(a[1].discount+a[1].compliment));
  el.innerHTML = `
    <div class="ct-report__stats" style="margin-bottom:20px;">
      <div class="stat-card"><div class="stat-num" style="color:var(--orange);">${totalDiscount.toFixed(2)} ₼</div><div class="stat-label">Verilən endirim</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--purple);">${totalCompliment.toFixed(2)} ₼</div><div class="stat-label">İkram dəyəri</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--red);">${(totalDiscount+totalCompliment).toFixed(2)} ₼</div><div class="stat-label">Cəmi</div></div>
    </div>
    <p style="font-size:12px;color:var(--text3);margin-bottom:12px;">Bölgü masanı bağlayan işçiyə görədir (təxmini - endirimi başqa işçi tətbiq etmiş ola bilər).</p>
    <div class="report-section-title"><svg class="icon"><use href="#i-tag"></use></svg> İşçiyə görə</div>
    <table class="report-table">
      <thead><tr><th>İşçi</th><th class="num">Endirim</th><th class="num">İkram</th><th class="num">Masa sayı</th></tr></thead>
      <tbody>${entries.length ? entries.map(([name,v]) => `<tr><td>${esc(name)}</td><td class="num">${v.discount.toFixed(2)} ₼</td><td class="num">${v.compliment.toFixed(2)} ₼</td><td class="num">${v.count}</td></tr>`).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--text3);">Bu aralıqda endirim/ikram yoxdur</td></tr>'}</tbody>
    </table>
  `;
}

export function renderReportTurnoverView(orders, el) {
  const withDuration = orders.filter(o => o.firstOrderAt && o.closedAt && o.closedAt > o.firstOrderAt).map(o => ({
    ...o, durationMin: (o.closedAt - o.firstOrderAt) / 60000
  }));
  if (!withDuration.length) { el.innerHTML = '<p class="report-empty">Hesablamaq üçün kifayət qədər məlumat yoxdur (köhnə qeydlərdə sifariş vaxtı saxlanılmayıb).</p>'; return; }
  const avgDuration = withDuration.reduce((s,o)=>s+o.durationMin,0) / withDuration.length;
  const byTable = {};
  withDuration.forEach(o => {
    const name = (o.tableName||'?').replace(/\s*\*+$/,'');
    if (!byTable[name]) byTable[name] = { totalMin: 0, count: 0 };
    byTable[name].totalMin += o.durationMin; byTable[name].count++;
  });
  const entries = Object.entries(byTable).map(([name,v]) => [name, v.totalMin/v.count, v.count]).sort((a,b)=>b[1]-a[1]);
  const fmtDuration = (min) => min >= 60 ? `${Math.floor(min/60)} saat ${Math.round(min%60)} dəq` : `${Math.round(min)} dəq`;
  el.innerHTML = `
    <div class="ct-report__stats" style="margin-bottom:20px;">
      <div class="stat-card"><div class="stat-num" style="color:var(--blue);">${fmtDuration(avgDuration)}</div><div class="stat-label">Orta oturma müddəti</div></div>
      <div class="stat-card"><div class="stat-num">${withDuration.length}</div><div class="stat-label">Hesablanan sessiya</div></div>
    </div>
    <div class="report-section-title"><svg class="icon"><use href="#i-chair"></use></svg> Masaya görə orta oturma müddəti</div>
    <table class="report-table">
      <thead><tr><th>Masa</th><th class="num">Orta müddət</th><th class="num">Sessiya sayı</th></tr></thead>
      <tbody>${entries.map(([name,avgMin,count]) => `<tr><td>${esc(name)}</td><td class="num">${fmtDuration(avgMin)}</td><td class="num">${count}</td></tr>`).join('')}</tbody>
    </table>
  `;
}

export function renderReportLoyaltyView(orders, el) {
  const dateFrom = document.getElementById('repDateFrom')?.value || '';
  const dateTo = document.getElementById('repDateTo')?.value || '';
  const timeFrom = document.getElementById('repTimeFrom')?.value || '';
  const timeTo = document.getElementById('repTimeTo')?.value || '';
  const inRange = (ts) => {
    if (!ts) return false;
    if (dateFrom) { const b = new Date(dateFrom); if (timeFrom) { const [h,m]=timeFrom.split(':'); b.setHours(+h,+m,0,0);} else b.setHours(0,0,0,0); if (ts < b.getTime()) return false; }
    if (dateTo) { const b = new Date(dateTo); if (timeTo) { const [h,m]=timeTo.split(':'); b.setHours(+h,+m,59,999);} else b.setHours(23,59,59,999); if (ts > b.getTime()) return false; }
    return true;
  };
  const newCustomers = (state.loyaltyCustomers||[]).filter(c => inRange(c.registrationDate));
  const totalCustomers = (state.loyaltyCustomers||[]).length;
  const totalBonusIssued = (state.loyaltyCustomers||[]).reduce((s,c)=>s+(c.bonus||0),0);

  db.ref('referrals').once('value', snap => {
    const allReferrals = toArr(snap.val());
    const referralsInRange = allReferrals.filter(r => inRange(r.createdAt));
    const completedInRange = referralsInRange.filter(r=>r.status==='completed');

    el.innerHTML = `
      <div class="ct-report__stats" style="margin-bottom:20px;">
        <div class="stat-card"><div class="stat-num" style="color:var(--green);">${newCustomers.length}</div><div class="stat-label">Yeni qeydiyyat</div></div>
        <div class="stat-card"><div class="stat-num">${totalCustomers}</div><div class="stat-label">Ümumi qeydiyyatlı</div></div>
        <div class="stat-card"><div class="stat-num" style="color:var(--gold-dark);">${totalBonusIssued}</div><div class="stat-label">Ümumi bonus (bal)</div></div>
        <div class="stat-card"><div class="stat-num" style="color:var(--blue);">${referralsInRange.length}</div><div class="stat-label">Dəvət (bu aralıqda)</div></div>
        <div class="stat-card"><div class="stat-num" style="color:var(--purple);">${completedInRange.length}</div><div class="stat-label">Tamamlanan dəvət</div></div>
      </div>
      <p style="font-size:12px;color:var(--text3);">Qeydiyyat/dəvət sayları seçilmiş tarix aralığına görə hesablanır.</p>
    `;
  });
}

export function renderReportCompareView(orders, el) {
  const dateFrom = document.getElementById('repDateFrom')?.value;
  const dateTo = document.getElementById('repDateTo')?.value;
  if (!dateFrom || !dateTo) { el.innerHTML = '<p class="report-empty">Müqayisə üçün tarix aralığı seçin.</p>'; return; }
  const timeFrom = document.getElementById('repTimeFrom')?.value || '';
  const timeTo = document.getElementById('repTimeTo')?.value || '';

  const from = new Date(dateFrom); if(timeFrom){const [h,m]=timeFrom.split(':');from.setHours(+h,+m,0,0);}else from.setHours(0,0,0,0);
  const to = new Date(dateTo); if(timeTo){const [h,m]=timeTo.split(':');to.setHours(+h,+m,59,999);}else to.setHours(23,59,59,999);
  const durationMs = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(from.getTime() - durationMs);

  const prevOrders = reportPool().filter(o => {
    if (o.void) return false;
    const refTime = o.firstOrderAt || o.closedAt;
    return refTime >= prevFrom.getTime() && refTime <= prevTo.getTime();
  });

  const curRevenue = orders.reduce((s,o)=>s+(o.total||0),0);
  const prevRevenue = prevOrders.reduce((s,o)=>s+(o.total||0),0);
  const curCount = orders.length, prevCount = prevOrders.length;
  const curAvg = curCount ? curRevenue/curCount : 0, prevAvg = prevCount ? prevRevenue/prevCount : 0;

  const pctChange = (cur, prev) => prev === 0 ? (cur>0?100:0) : ((cur-prev)/prev*100);
  const fmtChange = (pct) => `<span style="color:${pct>=0?'var(--green)':'var(--red)'};font-weight:700;">${pct>=0?'+':''}${pct.toFixed(1)}%</span>`;

  el.innerHTML = `
    <p style="font-size:12.5px;color:var(--text3);margin-bottom:16px;">Cari aralıq eyni uzunluqda, ondan bilavasitə əvvəlki dövrlə müqayisə olunur.</p>
    <table class="report-table">
      <thead><tr><th>Göstərici</th><th class="num">Əvvəlki dövr</th><th class="num">Cari dövr</th><th class="num">Dəyişiklik</th></tr></thead>
      <tbody>
        <tr><td>Dövriyyə</td><td class="num">${prevRevenue.toFixed(2)} ₼</td><td class="num">${curRevenue.toFixed(2)} ₼</td><td class="num">${fmtChange(pctChange(curRevenue,prevRevenue))}</td></tr>
        <tr><td>Bağlanan masa</td><td class="num">${prevCount}</td><td class="num">${curCount}</td><td class="num">${fmtChange(pctChange(curCount,prevCount))}</td></tr>
        <tr><td>Orta çek</td><td class="num">${prevAvg.toFixed(2)} ₼</td><td class="num">${curAvg.toFixed(2)} ₼</td><td class="num">${fmtChange(pctChange(curAvg,prevAvg))}</td></tr>
      </tbody>
    </table>
  `;
}

// Ləğvetmə hesabatı - "sifariş ləğvi" (order_cancel) tipli tarixçə qeydlərindən qurulur.
// Hər ləğvin: vaxtı, masası, malı, miqdarı, məbləği, səbəbi, kim etdiyi görünür.
export function renderReportCancellationsView(el) {
  const dateFrom = document.getElementById('repDateFrom')?.value || '';
  const dateTo = document.getElementById('repDateTo')?.value || '';
  const timeFrom = document.getElementById('repTimeFrom')?.value || '';
  const timeTo = document.getElementById('repTimeTo')?.value || '';
  let cancellations = reportLogs().filter(l => l.type === 'order_cancel');
  if (dateFrom) {
    const b = new Date(dateFrom); if (timeFrom) { const [h,m]=timeFrom.split(':'); b.setHours(+h,+m,0,0);} else b.setHours(0,0,0,0);
    cancellations = cancellations.filter(l => l.timestamp >= b.getTime());
  }
  if (dateTo) {
    const b = new Date(dateTo); if (timeTo) { const [h,m]=timeTo.split(':'); b.setHours(+h,+m,59,999);} else b.setHours(23,59,59,999);
    cancellations = cancellations.filter(l => l.timestamp <= b.getTime());
  }

  const totalAmount = cancellations.reduce((s,l) => s + (l.details?.amount||0), 0);

  const byStaff = {};
  cancellations.forEach(l => {
    const name = l.details?.staffName || 'Naməlum';
    if (!byStaff[name]) byStaff[name] = { count: 0, amount: 0 };
    byStaff[name].count++; byStaff[name].amount += l.details?.amount||0;
  });
  const staffEntries = Object.entries(byStaff).sort((a,b)=>b[1].amount-a[1].amount);

  const byReason = {};
  cancellations.forEach(l => {
    const reason = l.details?.reason || 'Qeyd olunmayıb';
    byReason[reason] = (byReason[reason]||0) + 1;
  });
  const reasonEntries = Object.entries(byReason).sort((a,b)=>b[1]-a[1]);

  el.innerHTML = `
    <div class="ct-report__stats" style="margin-bottom:20px;">
      <div class="stat-card"><div class="stat-num" style="color:var(--red);">${cancellations.length}</div><div class="stat-label">Ləğv sayı</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--red);">${totalAmount.toFixed(2)} ₼</div><div class="stat-label">Ləğv olunan məbləğ</div></div>
    </div>
    <div class="report-section-title"><svg class="icon"><use href="#i-staff"></use></svg> İşçiyə görə</div>
    <table class="report-table">
      <thead><tr><th>İşçi</th><th class="num">Ləğv sayı</th><th class="num">Məbləğ</th></tr></thead>
      <tbody>${staffEntries.length ? staffEntries.map(([name,v]) => `<tr><td>${esc(name)}</td><td class="num">${v.count}</td><td class="num">${v.amount.toFixed(2)} ₼</td></tr>`).join('') : '<tr><td colspan="3" style="text-align:center;color:var(--text3);">Bu aralıqda ləğvetmə yoxdur</td></tr>'}</tbody>
    </table>
    <div class="report-section-title"><svg class="icon" style="width:.9em;height:.9em;"><use href="#i-warning"></use></svg> Səbəbə görə</div>
    <table class="report-table">
      <thead><tr><th>Səbəb</th><th class="num">Sayı</th></tr></thead>
      <tbody>${reasonEntries.length ? reasonEntries.map(([reason,count]) => `<tr><td>${esc(reason)}</td><td class="num">${count}</td></tr>`).join('') : '<tr><td colspan="2" style="text-align:center;color:var(--text3);">—</td></tr>'}</tbody>
    </table>
    <div class="report-section-title"><svg class="icon" style="width:.9em;height:.9em;"><use href="#i-clipboard"></use></svg> Ətraflı siyahı</div>
    <table class="report-table">
      <thead><tr><th>Tarix/Saat</th><th>Masa</th><th>Mal</th><th class="num">Miqdar</th><th class="num">Məbləğ</th><th>Səbəb</th><th>Sifarişi verən</th><th>Ləğv edən</th></tr></thead>
      <tbody>${cancellations.length ? cancellations.slice(0,200).map(l => `<tr>
        <td>${esc(l.date)} ${esc(l.time)}</td>
        <td>${esc(l.details?.tableName||'—')}</td>
        <td>${esc(l.details?.itemName||'—')}</td>
        <td class="num">${l.details?.qty??'—'}</td>
        <td class="num">${(l.details?.amount||0).toFixed(2)} ₼</td>
        <td>${esc(l.details?.reason||'—')}</td>
        <td>${esc(l.details?.orderOwnerName||'—')}</td>
        <td>${esc(l.details?.staffName||'—')}</td>
      </tr>`).join('') : '<tr><td colspan="8" style="text-align:center;color:var(--text3);">Bu aralıqda ləğvetmə yoxdur</td></tr>'}</tbody>
    </table>
  `;
}

// Hazırda açıq olan masaların hesabatı - tarix filtrindən ASILI DEYİL, HAZIRKI anın
// vəziyyətini göstərir (neçə masa açıqdır, üzərlərində nə qədər məbləğ var).
export function renderReportOpenTablesView(el) {
  const openTables = (state.tables || []).filter(t => t.occupant);
  const rows = openTables.map(t => {
    const order = state.tableOrders[t.id];
    const total = order?.total || 0;
    const paid = order?.paidAmount || 0;
    const remaining = Math.max(0, total - paid);
    const waiter = state.staff.find(s => s.id === t.occupant);
    const startTime = order?.firstOrderAt || t.activatedAt;
    const durationMin = startTime ? Math.round((Date.now() - startTime) / 60000) : 0;
    return { name: t.name, waiter: waiter?.name || '?', total, remaining, durationMin };
  }).sort((a,b) => b.total - a.total);

  const totalOpenAmount = rows.reduce((s,r) => s + r.total, 0);
  const totalRemaining = rows.reduce((s,r) => s + r.remaining, 0);
  const fmtDuration = (min) => min >= 60 ? `${Math.floor(min/60)} saat ${min%60} dəq` : `${min} dəq`;

  el.innerHTML = `
    <div class="ct-report__stats" style="margin-bottom:20px;">
      <div class="stat-card"><div class="stat-num" style="color:var(--orange);">${rows.length}</div><div class="stat-label">Hazırda açıq masa</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--green);">${totalOpenAmount.toFixed(2)} ₼</div><div class="stat-label">Ümumi dövriyyə (açıq masalarda)</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--orange);">${totalRemaining.toFixed(2)} ₼</div><div class="stat-label">Hələ ödənilməmiş qalıq</div></div>
    </div>
    <p style="font-size:12px;color:var(--text3);margin-bottom:12px;">Bu hesabat tarix filtrindən asılı deyil - hazırkı anın vəziyyətini göstərir.</p>
    <table class="report-table">
      <thead><tr><th>Masa</th><th>İşçi</th><th class="num">Cəmi</th><th class="num">Qalıq</th><th class="num">Neçə vaxtdır açıqdır</th></tr></thead>
      <tbody>${rows.length ? rows.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.waiter)}</td><td class="num">${r.total.toFixed(2)} ₼</td><td class="num" style="color:${r.remaining>0?'var(--orange)':'var(--green)'};">${r.remaining.toFixed(2)} ₼</td><td class="num">${fmtDuration(r.durationMin)}</td></tr>`).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--text3);">Hazırda açıq masa yoxdur</td></tr>'}</tbody>
    </table>
  `;
}

// NİSYƏ VƏZİYYƏTİ - tarix filtrindən ASILI DEYİL, HAZIRKI borc vəziyyətini göstərir.
// Hansı müştəri nə qədər borcludur, ən uzun müddət ödənilməmiş kim - "aging" məntiqi.
export function renderReportCreditView(el) {
  const debtors = (state.customers||[]).filter(c => (c.balance||0) > 0.01);
  const totalDebt = debtors.reduce((s,c) => s+(c.balance||0), 0);

  const rows = debtors.map(c => {
    const charges = (state.customerCharges||[]).filter(ch => ch.customerId === c.id && ch.type !== 'payment' && ch.type !== 'reversal').sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
    const oldestUnpaid = charges.find(ch => ((ch.amount||0)-(ch.paidAmount||0)) > 0.01);
    const daysSince = oldestUnpaid ? Math.floor((Date.now()-(oldestUnpaid.createdAt||Date.now()))/86400000) : 0;
    return { name: c.name, phone: c.phone||'—', balance: c.balance||0, daysSince };
  }).sort((a,b) => b.daysSince - a.daysSince);

  const overdue7 = rows.filter(r => r.daysSince >= 7).length;
  const overdue30 = rows.filter(r => r.daysSince >= 30).length;

  el.innerHTML = `
    <div class="ct-report__stats" style="margin-bottom:20px;">
      <div class="stat-card"><div class="stat-num" style="color:var(--red);">${totalDebt.toFixed(2)} ₼</div><div class="stat-label">Ümumi Nisyə Borcu</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--orange);">${debtors.length}</div><div class="stat-label">Borclu Müştəri</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--orange);">${overdue7}</div><div class="stat-label">7+ gündür gözləyən</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--red);">${overdue30}</div><div class="stat-label">30+ gündür gözləyən</div></div>
    </div>
    <p style="font-size:12px;color:var(--text3);margin-bottom:12px;">Bu hesabat tarix filtrindən asılı deyil - hazırkı borc vəziyyətini göstərir. Ən uzun gözləyənlər öndədir.</p>
    <table class="report-table">
      <thead><tr><th>Müştəri</th><th>Telefon</th><th class="num">Borc</th><th class="num">Neçə gündür</th></tr></thead>
      <tbody>${rows.length ? rows.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.phone)}</td><td class="num" style="color:var(--red);">${r.balance.toFixed(2)} ₼</td><td class="num" style="color:${r.daysSince>=30?'var(--red)':r.daysSince>=7?'var(--orange)':'var(--text2)'};font-weight:${r.daysSince>=7?'700':'400'};">${r.daysSince} gün</td></tr>`).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--text3);">Hazırda borclu müştəri yoxdur</td></tr>'}</tbody>
    </table>
  `;
}
