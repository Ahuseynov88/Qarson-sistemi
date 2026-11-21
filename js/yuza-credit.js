/* ═══════════════════════════════════════════
   YUZA POS — PEŞƏKAR NİSYƏ (C17b · 22.11.2026)
   • Limit: hər müştəriyə ayrıca (customers/{id}/limit) və ya standart (settings/credit/defaultLimit; boş = limitsiz).
   • Limiti keçən nisyə yazılmır — Rəhbərə təsdiq sorğusu gedir (creditRequests). Rəhbər və ya
     "Limitdən artıq nisyəni təsdiqləmək" icazəli şəxs təsdiqləyəndə nisyə yazılır, rədd edəndə yazılmır;
     ofisianta nəticə bildirilir.
   • Ödəmə müddəti: hər nisyədə dueAt (standart 30 gün; müştəriyə ayrıca dəyişmək olar). Vaxtı keçmiş borc qırmızı,
     Rəhbərə gündə bir dəfə xatırlatma.
   • Borclular hesabatı: hər nisyə — tarix və saat, masa, qulluq edən ofisiant, nisyəni yazan, mallar, məbləğ,
     ödənilən, qalıq, son ödəmə tarixi; hər ödəniş — tarix və saat, növ, qəbul edən, kassa növbəsi. Çap və Excel.
   • Ödəniş həmin günün kassa növbəsinə düşür (mövcud qayda, Mərhələ 2c).
═══════════════════════════════════════════ */
import { db, R } from './firebase-service.js';
import { state } from './state.js';
import { hasPermission } from './permissions.js';
import { addLog, showToast, toArr } from './utils.js';
import { playNotifSound } from './notifSounds.js';
import { modal, ok, fail, esc, confirmBox } from './yuza-inv-ui.js';

const p2 = (n) => String(n).padStart(2, '0');
const fmtDT = (t) => { if (!t) return '—'; const d = new Date(t); return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const fmtD = (t) => { if (!t) return '—'; const d = new Date(t); return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}`; };
const m2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const money = (n) => m2(n).toFixed(2) + ' ₼';
const I = (id) => `<svg class="icon"><use href="#i-${id}"></use></svg>`;
const DAY = 86400000;

/* ── Ayarlar ── */
let S = { defaultLimit: null, dueDays: 30 };
let setOn = false;
function watchSettings() {
  if (setOn || !state.user) return; setOn = true;
  db.ref('settings/credit').on('value', s => { const v = s.val() || {}; S = { defaultLimit: Number.isFinite(Number(v.defaultLimit)) && v.defaultLimit !== null && v.defaultLimit !== '' ? Number(v.defaultLimit) : null, dueDays: Number(v.dueDays) > 0 ? Number(v.dueDays) : 30 }; }, () => { setOn = false; });
}
export const creditSettings = () => S;
export function creditLimitOf(acc) {
  const v = acc?.limit;
  if (v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v))) return Number(v);
  return S.defaultLimit;
}
export const creditDueDaysOf = (acc) => (Number(acc?.dueDays) > 0 ? Number(acc.dueDays) : S.dueDays);
const isCharge = (ch) => ch && ch.type !== 'payment' && ch.type !== 'reversal';
export const dueOf = (ch) => ch.dueAt || ((ch.createdAt || 0) + creditDueDaysOf(state.customers?.find(c => c.id === ch.customerId)) * DAY);
const leftOf = (ch) => m2((ch.amount || 0) - (ch.paidAmount || 0));
export function overdueOf(customerId, now = Date.now()) {
  return m2((state.customerCharges || []).filter(ch => ch.customerId === customerId && isCharge(ch) && leftOf(ch) > 0.01 && dueOf(ch) < now).reduce((s, ch) => s + leftOf(ch), 0));
}
const canApprove = () => state.user?.role === 'admin' || hasPermission('credit.approve');

/* ═══ LİMİT AŞIMI: təsdiq sorğusu ═══ */
export async function requestOverLimit(d) {
  const k = db.ref('creditRequests').push();
  await k.set({ ...d, staffId: state.user?.id || null, staffName: state.user?.name || '', createdAt: Date.now(), status: 'pending' });
  addLog('credit_request', `${state.user?.name}: "${d.customerName}" — nisyə ${money(d.amount)} limiti keçir (borc ${money(d.balance)}, limit ${money(d.limit)}) — Rəhbərə təsdiq göndərildi`, { requestId: k.key, customerId: d.customerId, tableId: d.tableId });
  showToast(`<svg class="icon"><use href="#i-warning"></use></svg> Limit keçir: borc ${money(d.balance)} + ${money(d.amount)} &gt; limit ${money(d.limit)}. Rəhbərə təsdiq göndərildi.`, { ms: 7000 });
  return k.key;
}
let reqs = [];
export const pendingReqs = () => reqs.filter(r => r.status === 'pending');
async function decide(id, approve, reason = '') {
  const r = reqs.find(x => x.id === id); if (!r || r.status !== 'pending') return;
  const lock = await db.ref(`creditRequests/${id}/status`).transaction(s => s === 'pending' ? 'working' : undefined);
  if (!lock.committed) { fail('Sorğu artıq emal olunub'); return; }
  const by = state.user?.name || 'Rəhbər';
  if (!approve) {
    await db.ref('creditRequests/' + id).update({ status: 'rejected', decidedBy: by, decidedAt: Date.now(), reason: reason || null });
    addLog('credit_request', `${by} limiti keçən nisyəni rədd etdi: "${r.customerName}" ${money(r.amount)}${reason ? ' — ' + reason : ''}`, { requestId: id });
    ok('Rədd edildi'); return;
  }
  const co = window.staffApp?.confirmedOrder;
  const res = co ? await co.executeCharge({ tableId: r.tableId, customerId: r.customerId, customerName: r.customerName, selection: r.selection || null, approvedBy: by, requestId: id, writer: { id: r.staffId, name: r.staffName } })
    : { ok: false, reject: 'Proqram tam yüklənməyib' };
  if (res.ok) {
    await db.ref('creditRequests/' + id).update({ status: 'approved', decidedBy: by, decidedAt: Date.now(), chargeId: res.chargeId, amount: res.rec.amount });
    ok(`Təsdiqləndi — ${money(res.rec.amount)} "${r.customerName}" adına yazıldı`);
  } else {
    await db.ref('creditRequests/' + id).update({ status: 'failed', decidedBy: by, decidedAt: Date.now(), reason: res.reject });
    fail('Yazılmadı: ' + res.reject);
  }
}
export function openRequests() {
  const list = pendingReqs();
  const m = modal({
    title: `${I('card')} Nisyə təsdiqi — limit aşımı`,
    wide: true,
    body: list.length ? `<div class="yz-cr-list">${list.map(r => `<article class="yz-cr-item">
        <header><b>${esc(r.customerName)}</b><span>${fmtDT(r.createdAt)}</span></header>
        <p>${esc(r.tableName)} · yazan: <b>${esc(r.staffName)}</b></p>
        <p>Nisyə: <b>${money(r.amount)}</b> · indiki borc: ${money(r.balance)} · limit: ${money(r.limit)} → <b class="yzi-bad">${money(m2(r.balance + r.amount))}</b></p>
        <p class="yz-cr-items">${(r.items || []).map(it => `${esc(it.qty)}× ${esc(it.name)}`).join(', ')}</p>
        <footer><button type="button" class="yzi-btn yzi-btn--gold" data-cr-ok="${esc(r.id)}">${I('check')} Təsdiqlə</button>
          <button type="button" class="yzi-btn yzi-btn--ghost" data-cr-no="${esc(r.id)}">Rədd et</button></footer></article>`).join('')}</div>`
      : '<p class="yzi-empty">Təsdiq gözləyən nisyə yoxdur.</p>',
    actions: [{ label: 'Bağla', cancel: true }]
  });
  m.el.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-cr-ok]'), b = e.target.closest('[data-cr-no]');
    if (!a && !b) return;
    if (!canApprove()) { fail('Təsdiq icazəniz yoxdur'); return; }
    if (a) { a.disabled = true; await decide(a.dataset.crOk, true); }
    else { const why = await confirmBox('Nisyə yazılmayacaq. Səbəb (könüllü):', { title: 'Rədd edilsin?', okLabel: 'Rədd et', okCls: 'yzi-btn--danger', input: 'Səbəb' }); if (why === false || why === null) return; await decide(b.dataset.crNo, false, typeof why === 'string' ? why : ''); }
    m.close(); if (pendingReqs().length) setTimeout(openRequests, 300);
  });
}

/* Sorğuların dinlənməsi: təsdiqləyən — yeni sorğu (səs), ofisiant — öz sorğusunun nəticəsi */
let reqUser = null, reqOff = null;
function watchRequests() {
  const key = state.user ? `${state.user.role}:${state.user.id || 'admin'}` : null;
  if (key === reqUser) return;
  reqUser = key; reqOff?.(); reqOff = null; reqs = [];
  if (!state.user || (state.user.role !== 'admin' && state.user.role !== 'staff')) return;
  const since = Date.now();
  const q = db.ref('creditRequests').orderByKey().limitToLast(100);
  const known = {};
  const h = q.on('value', snap => {
    reqs = toArr(snap.val());
    reqs.forEach(r => {
      const prev = known[r.id]; known[r.id] = r.status;
      if (r.createdAt < since && prev === undefined) return;
      if (r.status === 'pending' && prev === undefined && canApprove()) {
        try { playNotifSound('credit_request'); } catch (e) { /* */ }
        showToast(`<svg class="icon"><use href="#i-warning"></use></svg> Nisyə təsdiqi: "${esc(r.customerName)}" ${money(r.amount)} limiti keçir (${esc(r.staffName)})`, { ms: 8000 });
      }
      if (prev && prev !== r.status && r.staffId === state.user?.id && ['approved', 'rejected', 'failed'].includes(r.status)) {
        showToast(r.status === 'approved' ? `<svg class="icon"><use href="#i-check"></use></svg> Rəhbər təsdiqlədi: ${money(r.amount)} "${esc(r.customerName)}" adına nisyə yazıldı`
          : `<svg class="icon"><use href="#i-error"></use></svg> "${esc(r.customerName)}" nisyəsi ${r.status === 'rejected' ? 'rədd edildi' : 'yazılmadı'}${r.reason ? ': ' + esc(r.reason) : ''}`, { ms: 8000 });
      }
    });
  }, () => {});
  reqOff = () => q.off('value', h);
}

/* ═══ BORCLULAR HESABATI (çıxarış) ═══ */
const ptLabel = (t) => t === 'cash' ? 'Nağd' : t === 'pos' ? 'POS' : ((state.paymentMethods || []).find(pm => pm.id === t)?.name || t || '—');
export function reportData({ customerId = '', from = null, to = null, onlyDebt = true } = {}) {
  const now = Date.now();
  const accs = (state.customers || []).filter(a => (!customerId || a.id === customerId) && (!onlyDebt || (a.balance || 0) > 0.01 || customerId));
  return accs.map(a => {
    const all = (state.customerCharges || []).filter(ch => ch.customerId === a.id).sort((x, y) => (x.createdAt || 0) - (y.createdAt || 0));
    const inRange = (t) => (!from || t >= from) && (!to || t <= to);
    const rows = all.filter(ch => inRange(ch.createdAt || 0));
    const before = all.filter(ch => from && (ch.createdAt || 0) < from);
    const opening = m2(before.reduce((s, ch) => s + (isCharge(ch) ? (ch.amount || 0) : ch.type === 'payment' ? -(ch.amount || 0) : 0), 0));
    const charged = m2(rows.filter(isCharge).reduce((s, ch) => s + (ch.amount || 0), 0));
    const paid = m2(rows.filter(ch => ch.type === 'payment').reduce((s, ch) => s + (ch.amount || 0), 0));
    const overdue = m2(all.filter(ch => isCharge(ch) && leftOf(ch) > 0.01 && dueOf(ch) < now).reduce((s, ch) => s + leftOf(ch), 0));
    return { a, rows, opening, charged, paid, closing: m2(opening + charged - paid), balance: m2(a.balance || 0), overdue, limit: creditLimitOf(a) };
  }).sort((x, y) => y.balance - x.balance);
}
function reportHtml(data, { from, to }) {
  const now = Date.now();
  const tot = data.reduce((s, d) => ({ bal: s.bal + d.balance, od: s.od + d.overdue }), { bal: 0, od: 0 });
  return `<div class="yz-cr-rep" id="yzCrPrint">
    <div class="yz-cr-head"><h2>Borclular hesabatı</h2><span>${from || to ? `${from ? fmtD(from) : '…'} — ${to ? fmtD(to) : '…'}` : 'Bütün dövr'} · çap: ${fmtDT(now)}</span></div>
    <div class="yz-cu-kpis"><div><small>Müştəri</small><b>${data.length}</b></div><div><small>Ümumi borc</small><b>${money(tot.bal)}</b></div>
      <div class="${tot.od > 0.01 ? 'is-debt' : ''}"><small>Vaxtı keçmiş</small><b>${money(tot.od)}</b></div></div>
    ${data.map(d => `<section class="yz-cr-cust">
      <header><div><b>${esc(d.a.name)}</b> <span>${esc(d.a.phone || 'telefon yoxdur')}</span></div>
        <div>Borc: <b class="${d.balance > 0.01 ? 'yzi-bad' : ''}">${money(d.balance)}</b>${d.overdue > 0.01 ? ` · <b class="yzi-bad">vaxtı keçib ${money(d.overdue)}</b>` : ''} · limit: ${d.limit === null ? 'limitsiz' : money(d.limit)}</div></header>
      <div class="yzi-table-wrap"><table class="yzi-table yz-cr-table">
        <thead><tr><th>Tarix və saat</th><th>Əməliyyat</th><th>Masa</th><th>Qulluq edən</th><th>Yazan / qəbul edən</th><th>Mallar</th><th class="n">Məbləğ</th><th class="n">Ödənilib</th><th class="n">Qalıq</th><th>Son ödəmə</th></tr></thead>
        <tbody>${from ? `<tr class="yz-cr-open"><td colspan="6">Dövrün əvvəlinə borc</td><td class="n" colspan="4"><b>${money(d.opening)}</b></td></tr>` : ''}
        ${d.rows.map(ch => ch.type === 'payment'
          ? `<tr class="yz-cr-pay"><td>${fmtDT(ch.createdAt)}</td><td>Ödəniş · ${esc(ptLabel(ch.paymentType))}</td><td>—</td><td>—</td><td>${esc(ch.staffName || '')}</td><td>${esc(ch.note || '')}${ch.shiftId ? ' <small>(kassa növbəsinə düşüb)</small>' : ''}</td><td class="n">−${money(ch.amount)}</td><td class="n"></td><td class="n"></td><td></td></tr>`
          : ch.type === 'reversal' ? `<tr><td>${fmtDT(ch.createdAt)}</td><td>Ləğv / qaytarma</td><td>${esc(ch.tableName || '')}</td><td></td><td>${esc(ch.staffName || '')}</td><td>${esc(ch.note || '')}</td><td class="n">${money(ch.amount)}</td><td></td><td></td><td></td></tr>`
          : (() => { const left = leftOf(ch), od = left > 0.01 && dueOf(ch) < now; return `<tr class="${od ? 'is-od' : ''}"><td>${fmtDT(ch.createdAt)}</td><td>Nisyə${ch.overLimit ? ' <small>(limit aşımı — təsdiq: ' + esc(ch.approvedBy || '') + ')</small>' : ''}</td><td>${esc(ch.tableName || '')}</td><td>${esc(ch.waiterName || '—')}</td><td>${esc(ch.staffName || '')}</td>
            <td class="yz-cr-items">${(ch.items || []).map(it => `${esc(it.qty)}× ${esc(it.name)} <small>${money(it.price)}</small>`).join('<br>')}</td>
            <td class="n">${money(ch.amount)}</td><td class="n">${money(ch.paidAmount || 0)}</td><td class="n"><b>${money(left)}</b></td><td class="${od ? 'yzi-bad' : ''}">${left > 0.01 ? fmtD(dueOf(ch)) + (od ? ' — vaxtı keçib' : '') : 'ödənilib'}</td></tr>`; })()).join('')
          || '<tr><td colspan="10" class="yzi-empty">Bu dövrdə əməliyyat yoxdur.</td></tr>'}</tbody>
        <tfoot><tr><td colspan="6">Dövr üzrə: nisyə ${money(d.charged)} · ödəniş ${money(d.paid)}</td><td class="n" colspan="4">Dövrün sonuna borc: <b>${money(d.closing)}</b></td></tr></tfoot>
      </table></div></section>`).join('') || '<p class="yzi-empty">Borclu müştəri yoxdur.</p>'}</div>`;
}
function toCsv(data) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Müştəri', 'Telefon', 'Tarix və saat', 'Əməliyyat', 'Masa', 'Qulluq edən', 'Yazan/qəbul edən', 'Mallar', 'Məbləğ', 'Ödənilib', 'Qalıq', 'Son ödəmə'].map(q).join(';')];
  data.forEach(d => d.rows.forEach(ch => lines.push([d.a.name, d.a.phone, fmtDT(ch.createdAt), ch.type === 'payment' ? 'Ödəniş ' + ptLabel(ch.paymentType) : ch.type === 'reversal' ? 'Ləğv' : 'Nisyə',
    ch.tableName || '', ch.waiterName || '', ch.staffName || '', (ch.items || []).map(it => `${it.qty}x ${it.name}`).join(', ') || ch.note || '',
    (ch.type === 'payment' ? -1 : 1) * m2(ch.amount), isCharge(ch) ? m2(ch.paidAmount || 0) : '', isCharge(ch) ? leftOf(ch) : '', isCharge(ch) ? fmtD(dueOf(ch)) : ''].map(q).join(';'))));
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `borclular-${fmtD(Date.now())}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export function openReport(customerId = '') {
  const f = { customerId, from: '', to: '', onlyDebt: !customerId };
  const accs = (state.customers || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'az'));
  const m = modal({ title: `${I('clipboard')} Borclular hesabatı`, wide: true, body: '<div id="yzCrRepBox"></div>', actions: [{ label: 'Bağla', cancel: true }] });
  m.el.classList.add('yz-cr-modal');
  const box = m.body.querySelector('#yzCrRepBox');
  const range = () => ({ from: f.from ? new Date(f.from + 'T00:00').getTime() : null, to: f.to ? new Date(f.to + 'T23:59:59').getTime() : null });
  const draw = () => {
    const r = range();
    const data = reportData({ customerId: f.customerId, ...r, onlyDebt: f.onlyDebt });
    box.innerHTML = `<div class="yzi-filters yz-cr-filters">
        <label class="yzi-f yzi-f--inline"><span>Müştəri</span><select data-f="customerId"><option value="">Hamısı</option>${accs.map(a => `<option value="${esc(a.id)}"${a.id === f.customerId ? ' selected' : ''}>${esc(a.name)}${(a.balance || 0) > 0.01 ? ' — ' + money(a.balance) : ''}</option>`).join('')}</select></label>
        <label class="yzi-f yzi-f--inline"><span>Tarixdən</span><input type="date" data-f="from" value="${f.from}"></label>
        <label class="yzi-f yzi-f--inline"><span>Tarixədək</span><input type="date" data-f="to" value="${f.to}"></label>
        <label class="yz-cr-chk"><input type="checkbox" data-f="onlyDebt"${f.onlyDebt ? ' checked' : ''}> Yalnız borcu olanlar</label>
        <button type="button" class="yzi-btn yzi-btn--ghost" data-print>${I('printer')} Çap</button>
        <button type="button" class="yzi-btn yzi-btn--ghost" data-csv>Excel (CSV)</button></div>` + reportHtml(data, r);
    box.querySelector('[data-csv]').onclick = () => toCsv(data);
    box.querySelector('[data-print]').onclick = () => printReport();
  };
  box.addEventListener('change', (e) => { const k = e.target.dataset.f; if (!k) return; f[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; draw(); });
  draw();
}
function printReport() {
  const el = document.getElementById('yzCrPrint'); if (!el) return;
  const w = window.open('', '_blank', 'width=1000,height=800');
  if (!w) { fail('Çap pəncərəsi açılmadı (brauzer bloklayıb)'); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Borclular hesabatı</title><style>
    body{font:12px system-ui,sans-serif;color:#111;margin:16px} h2{margin:0 0 4px} table{width:100%;border-collapse:collapse;margin:6px 0 16px}
    th,td{border:1px solid #bbb;padding:4px 6px;text-align:left;vertical-align:top} .n{text-align:right} .is-od td{background:#fde8e7}
    .yz-cu-kpis{display:flex;gap:16px;margin:8px 0} .yz-cu-kpis div{border:1px solid #bbb;padding:6px 10px} .yz-cu-kpis small{display:block;color:#555}
    .yz-cr-cust header{display:flex;justify-content:space-between;margin-top:12px} .yz-cr-pay td{background:#eaf6ee} small{color:#555}
  </style></head><body>${el.innerHTML}</body></html>`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
}

/* ═══ Nisyə bölməsində: təsdiq zolağı, hesabat və ayarlar düymələri, vaxtı keçmiş borclar ═══ */
function ensureCreditUi() {
  const sec = document.getElementById('sec-customers'); if (!sec) return;
  let bar = sec.querySelector('.yz-cr-bar');
  if (!bar) {
    bar = document.createElement('div'); bar.className = 'yz-cr-bar';
    const grid = document.getElementById('customersGrid'); grid?.parentNode.insertBefore(bar, grid);
    bar.addEventListener('click', (e) => {
      if (e.target.closest('[data-cr-rep]')) openReport();
      if (e.target.closest('[data-cr-req]')) openRequests();
      if (e.target.closest('[data-cr-set]')) openSettings();
    });
  }
  const n = pendingReqs().length, admin = state.user?.role === 'admin';
  const sig = `${n}:${admin}`;
  if (bar.dataset.sig === sig) return; bar.dataset.sig = sig;
  bar.innerHTML = `${n ? `<button type="button" class="yzi-btn yzi-btn--gold" data-cr-req>${I('warning')} Təsdiq gözləyən nisyə (${n})</button>` : ''}
    <button type="button" class="yzi-btn yzi-btn--ghost" data-cr-rep>${I('clipboard')} Borclular hesabatı</button>
    ${admin || hasPermission('panel.settings') ? `<button type="button" class="yzi-btn yzi-btn--ghost" data-cr-set>${I('settings')} Limit və müddət</button>` : ''}`;
}
function annotateCards() {
  const grid = document.getElementById('customersGrid'); if (!grid) return;
  const now = Date.now();
  grid.querySelectorAll('.item-card').forEach(card => {
    const id = card.querySelector('[onclick*="openCustomerHistoryModal"]')?.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
    if (!id || card.dataset.crSig === String(now / 60000 | 0)) return;
    card.dataset.crSig = String(now / 60000 | 0);
    card.querySelector('.yz-cr-info')?.remove();
    const acc = state.customers.find(c => c.id === id); if (!acc) return;
    const od = overdueOf(id), lim = creditLimitOf(acc);
    const el = document.createElement('div'); el.className = 'yz-cr-info';
    el.innerHTML = `<small>Limit: <b>${lim === null ? 'limitsiz' : money(lim)}</b> · müddət: ${creditDueDaysOf(acc)} gün</small>${od > 0.01 ? `<small class="yz-cr-od">${I('warning')} Vaxtı keçib: ${money(od)}</small>` : ''}
      <button type="button" class="yzi-chipbtn" data-cr-one="${esc(id)}">Çıxarış</button>`;
    card.querySelector('.item-actions')?.before(el);
  });
}
document.addEventListener('click', (e) => { const b = e.target.closest('[data-cr-one]'); if (b) openReport(b.dataset.crOne); });

function openSettings() {
  modal({
    title: `${I('settings')} Nisyə: limit və ödəmə müddəti`,
    body: `<div class="yzi-grid2">
      <label class="yzi-f"><span>Standart limit (₼) — boş = limitsiz</span><input type="text" inputmode="decimal" id="yzCrLim" value="${S.defaultLimit ?? ''}"></label>
      <label class="yzi-f"><span>Ödəmə müddəti (gün)</span><input type="text" inputmode="numeric" id="yzCrDue" value="${S.dueDays}"></label></div>
      <p class="yzi-hint">Müştəriyə ayrıca limit və müddət: Nisyə hesabları → müştəri → Redaktə. Limiti keçən nisyə Rəhbərin təsdiqi ilə yazılır.</p>`,
    actions: [{ label: 'Ləğv et', cancel: true }, { label: 'Yadda saxla', cls: 'yzi-btn--gold', onClick: async (b) => {
      const l = b.querySelector('#yzCrLim').value.trim().replace(',', '.'), d = parseInt(b.querySelector('#yzCrDue').value, 10);
      if (l !== '' && !(Number(l) >= 0)) throw new Error('Limit 0 və ya daha böyük olmalıdır');
      if (!(d > 0 && d <= 365)) throw new Error('Müddət 1–365 gün olmalıdır');
      await db.ref('settings/credit').set({ defaultLimit: l === '' ? null : m2(l), dueDays: d });
      addLog('settings', `Nisyə ayarları: standart limit ${l === '' ? 'limitsiz' : money(l)}, müddət ${d} gün`, {});
      ok('Yadda saxlanıldı');
    } }]
  });
}

/* Vaxtı keçmiş borclar: Rəhbərə / təsdiq icazəlisinə gündə bir dəfə */
function remindOverdue() {
  if (!canApprove() || !(state.customerCharges || []).length) return;
  const k = `yzCrOd:${state.user?.id || 'admin'}:${fmtD(Date.now())}`;
  try { if (localStorage.getItem(k)) return; } catch (e) { return; }
  const list = (state.customers || []).map(a => ({ a, od: overdueOf(a.id) })).filter(x => x.od > 0.01);
  if (!list.length) return;
  try { localStorage.setItem(k, '1'); } catch (e) { /* */ }
  showToast(`<svg class="icon"><use href="#i-warning"></use></svg> ${list.length} müştərinin vaxtı keçmiş nisyə borcu var: ${money(list.reduce((s, x) => s + x.od, 0))}. Nisyə hesabları → Borclular hesabatı.`, { ms: 9000 });
}

/* ⋮ menyusu: təsdiq gözləyənlər */
window.__yzDotsExtra = window.__yzDotsExtra || [];
window.__yzDotsExtra.push(() => {
  if (!canApprove()) return null;
  const n = pendingReqs().length;
  return n ? { k: 'x:creditreq', l: `Nisyə təsdiqi (${n})`, i: 'card', run: openRequests } : null;
});

let remT = 0;
setInterval(() => {
  watchSettings(); watchRequests();
  if (!state.user) return;
  if (document.getElementById('sec-customers')?.classList.contains('active')) { ensureCreditUi(); annotateCards(); }
  if (Date.now() - remT > 60000) { remT = Date.now(); remindOverdue(); }
}, 800);

window.__yzCredit = { openReport, openRequests, reportData, creditLimitOf, overdueOf, decide };
