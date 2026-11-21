/* ═══════════════════════════════════════════
   YUZA POS — KASSA NÖVBƏSİ (Mərhələ 2c)
   • Bir kassa: eyni anda yalnız BİR açıq növbə olur (shiftCur).
   • Növbə başlanğıc nağd (sayılan) ilə açılır; açıq növbə olmadan ödəniş qəbul edilmir.
   • Hər ödəniş / geri qaytarma / nisyə ödənişi shiftId ilə yazılır.
   • X hesabatı — istənilən an baxılır, növbəni bağlamır.
   • Z hesabatı — kassada sayılan pul yazılır, fərq hesablanır, növbə bağlanır (nömrəli, dəyişməz).
   • Bazada: shiftCur (açıq növbə), shifts/{id} (bütün növbələr), shiftSeq (Z nömrəsi)
═══════════════════════════════════════════ */
import { db } from './firebase-service.js';
import { state } from './state.js';
import { esc, showToast, addLog, serverNow, money2 } from './utils.js';
import { hasPermission } from './permissions.js';
import { modal, numInput } from './yuza-inv-ui.js';

const CUR = db.ref('shiftCur');
const SH = db.ref('shifts');
const SEQ = db.ref('shiftSeq');
const I = (n) => `<svg class="icon"><use href="#i-${n}"></use></svg>`;
const money = (n) => (Number(n) || 0).toFixed(2) + ' ₼';
const num = (v) => { const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : NaN; };
const dt = (ts) => ts ? new Date(ts).toLocaleString('az-AZ', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

export const canShift = () => hasPermission('shift.manage');
export const shiftNow = () => state.shift || null;

/* ── Canlı izləmə ── */
let watching = false;
export function watchShift() {
  if (watching) return; watching = true;
  CUR.on('value', s => {
    const v = s.val();
    state.shift = v && v.id ? v : null;
    paintButtons();
  }, () => { state.shift = null; paintButtons(); });
  ensureButtons();
}
export function unwatchShift() { CUR.off(); watching = false; state.shift = null; }

/* Ödənişdən əvvəl çağırılır: açıq növbə varsa onu qaytarır, yoxdursa açmağı təklif edir */
export function needShift() {
  if (state.shift) return state.shift;
  if (canShift()) {
    showToast(`${I('warning')} Kassa növbəsi açıq deyil — əvvəlcə növbəni açın`);
    openShiftDialog();
  } else {
    showToast(`${I('ban')} Kassa növbəsi açıq deyil. Ödəniş üçün kassirə müraciət edin`);
  }
  return null;
}

/* ── Növbəni aç ── */
export function openShiftDialog() {
  if (!canShift()) { showToast(`${I('ban')} Növbə açmaq icazəniz yoxdur`); return; }
  if (state.shift) { openShiftPanel(); return; }
  modal({
    title: `${I('cash')} Kassa növbəsini aç`,
    body: `<p class="yzi-p">Kassada hazırda olan nağd pulu (xırda pul daxil) sayıb yazın.</p>
      <label class="yzi-f"><span>Başlanğıc nağd (₼) *</span>${numInput('id="yzShOpen" class="yzi-big" placeholder="0.00"', '')}</label>
      <label class="yzi-f"><span>Qeyd</span><input type="text" id="yzShOpenNote" maxlength="200"></label>`,
    actions: [
      { label: 'Ləğv', cancel: true, cls: 'yzi-btn--ghost' },
      { label: 'Növbəni aç', cls: 'yzi-btn--gold', onClick: async (b) => {
        const cash = num(b.querySelector('#yzShOpen').value);
        if (!Number.isFinite(cash) || cash < 0) throw new Error('Başlanğıc nağdı yazın (0 da ola bilər)');
        const note = b.querySelector('#yzShOpenNote').value.trim();
        await openShift(money2(cash), note);
      } }
    ]
  });
}

export async function openShift(openingCash, note = '') {
  const u = state.user || {};
  const id = SH.push().key;
  const at = serverNow();
  const rec = { id, openedAt: at, openedById: u.id || 'admin', openedByName: u.name || 'Rəhbər', openingCash };
  const tx = await CUR.transaction(c => (c && c.id ? undefined : rec));
  if (!tx.committed) throw new Error('Növbə artıq açıqdır');
  try {
    const seq = await SEQ.transaction(n => (Number(n) || 0) + 1);
    const no = seq.snapshot.val();
    await db.ref().update({
      ['shifts/' + id]: { ...rec, no, status: 'open', openNote: note || null, openedTime: new Date(at).toLocaleTimeString('az-AZ'), openedDate: new Date(at).toLocaleDateString('az-AZ') },
      'shiftCur/no': no
    });
    addLog('shift', `${rec.openedByName} kassa növbəsini açdı (№${no}, başlanğıc nağd ${money(openingCash)})`, { shiftId: id });
    showToast(`${I('check')} Növbə №${no} açıldı`);
  } catch (e) {
    await CUR.transaction(c => (c && c.id === id ? null : undefined)).catch(() => {});
    throw e;
  }
}

/* ── Hesablama (X və Z üçün eyni) ── */
const PM_NAME = (id, p) => id === 'cash' ? 'Nağd' : id === 'pos' ? 'POS'
  : (p?.splitMethodNames?.[id] || (state.paymentMethods || []).find(m => m.id === id)?.name || (id === p?.type ? p?.typeLabel : null) || 'Digər');

async function cashAccountId() {
  try {
    const [cfg, accs] = await Promise.all([db.ref('settings/cash/methodMap/cash').once('value'), db.ref('cashAccounts').once('value')]);
    const all = accs.val() || {};
    const m = cfg.val();
    if (m && all[m] && !all[m].archived) return m;
    const list = Object.entries(all).filter(([, a]) => !a.archived).sort((a, b) => (a[1].order ?? 99) - (b[1].order ?? 99));
    return (list.find(([, a]) => a.kind === 'cash') || [])[0] || null;
  } catch (e) { return null; }
}

export async function computeShift(sh, until = serverNow()) {
  const from = sh.openedAt;
  const q = (ref) => ref.once('value').then(s => s.val() || {}).catch(() => ({}));
  const [pays, chs, closed, logs, docs, accId] = await Promise.all([
    q(db.ref('payments').orderByChild('shiftId').equalTo(sh.id)),
    q(db.ref('customerCharges').orderByChild('shiftId').equalTo(sh.id)),
    q(db.ref('closedOrders').orderByChild('closedAt').startAt(from).endAt(until)),
    q(db.ref('logs').orderByChild('timestamp').startAt(from).endAt(until)),
    q(db.ref('invCash').orderByChild('createdAt').startAt(from - 86400000)),
    cashAccountId()
  ]);
  const sales = {}, refunds = {}, credit = {}, deposits = {};
  let salesCount = 0, refundCount = 0;
  const add = (map, name, v) => { map[name] = money2((map[name] || 0) + v); };
  let cashSales = 0, cashRefunds = 0, cashCredit = 0, cashDeposit = 0, depositCount = 0;
  Object.values(pays).forEach(p => {
    if (p.kind === 'deposit') {   // banket behi — satış deyil, ayrıca sətir; nağddırsa kassada olmalıdır
      const v = Number(p.thisPay) || 0; depositCount++;
      add(deposits, PM_NAME(p.type, { ...p, typeLabel: String(p.typeLabel || '').replace(/^Banket behi · /, '') }), v);
      if (p.type === 'cash') cashDeposit += v;
      return;
    }
    const parts = (p.type === 'split' && p.splitBreakdown) ? Object.entries(p.splitBreakdown) : [[p.type, p.thisPay]];
    const rev = !!p.reversalOf || (Number(p.thisPay) || 0) < 0;
    if (rev) refundCount++; else salesCount++;
    parts.forEach(([mid, v]) => {
      v = Number(v) || 0;
      const name = PM_NAME(mid, p);
      add(rev ? refunds : sales, name, v);
      if (mid === 'cash') { if (rev) cashRefunds += v; else cashSales += v; }
    });
  });
  let creditWritten = 0, creditReversed = 0;
  Object.values(chs).forEach(c => {
    if (c.type === 'payment') {
      add(credit, PM_NAME(c.paymentType || 'cash', c), Number(c.amount) || 0);
      if ((c.paymentType || 'cash') === 'cash') cashCredit += Number(c.amount) || 0;
    } else if (c.type === 'reversal') creditReversed += Number(c.amount) || 0;
    else creditWritten += Number(c.amount) || 0;
  });
  // Kassa sənədləri (təsdiqlənmiş, nağd kassa hesabı üzrə, növbə müddətində)
  let docsIn = 0, docsOut = 0;
  if (accId) Object.values(docs).forEach(d => {
    if (d.status !== 'approved') return;
    const t = d.at || d.createdAt || 0; if (t < from || t > until) return;
    const a = Number(d.amount) || 0;
    if (d.dir === 'in' && d.accountId === accId) docsIn += a;
    else if (d.dir === 'out' && d.accountId === accId) docsOut += a;
    else if (d.dir === 'transfer') { if (d.accountId === accId) docsOut += a; if (d.toAccountId === accId) docsIn += a; }
  });
  // Bağlanan masalar (geri qaytarılanlar xaric), endirim, ikram
  let tables = 0, turnover = 0, disc = 0, gift = 0, voided = 0;
  Object.values(closed).forEach(o => {
    if (o.void) { voided++; return; }
    tables++; turnover += Number(o.total) || 0;
    Object.values(o.items || {}).forEach(it => {
      if (it.compliment) gift += (it.originalPrice || 0) * it.qty + (it.originalExtraFee || 0);
      else if (it.discountPercent > 0) disc += (it.price || 0) * it.qty * (it.discountPercent / 100);
    });
  });
  let cancelCount = 0, cancelAmt = 0;
  Object.values(logs).forEach(l => { if (l.type === 'order_cancel') { cancelCount++; cancelAmt += Number(l.details?.amount) || 0; } });
  const open = (state.tables || []).filter(t => t.occupant);
  const openRemaining = open.reduce((s, t) => { const o = (state.tableOrders || {})[t.id]; return s + Math.max(0, (o?.total || 0) - (o?.paidAmount || 0)); }, 0);
  const expected = money2((sh.openingCash || 0) + cashSales + cashRefunds + cashCredit + cashDeposit + docsIn - docsOut);
  const sum = (m) => money2(Object.values(m).reduce((s, v) => s + v, 0));
  return {
    from, until, opening: money2(sh.openingCash || 0),
    sales, refunds, credit, salesTotal: sum(sales), refundsTotal: sum(refunds), creditTotal: sum(credit),
    salesCount, refundCount, deposits, depositTotal: sum(deposits), depositCount, cashDeposit: money2(cashDeposit),
    cashSales: money2(cashSales), cashRefunds: money2(cashRefunds), cashCredit: money2(cashCredit),
    docsIn: money2(docsIn), docsOut: money2(docsOut), cashAccount: !!accId,
    creditWritten: money2(creditWritten), creditReversed: money2(creditReversed),
    tables, turnover: money2(turnover), voided, discount: money2(disc), compliment: money2(gift),
    cancelCount, cancelAmount: money2(cancelAmt),
    openTables: open.length, openRemaining: money2(openRemaining),
    expected
  };
}

/* ── Hesabatın HTML-i (ekran və çap üçün) ── */
export function reportHtml(sh, z, kind) {
  const rows = (map, sign = '') => Object.entries(map).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n">${sign}${money(Math.abs(v))}</td></tr>`).join('') || '<tr><td colspan="2" class="yz-sh-muted">—</td></tr>';
  const closedPart = kind === 'Z' && sh.closedAt ? `
    <tr><td>Kassada sayılan</td><td class="n"><b>${money(sh.counted)}</b></td></tr>
    <tr><td>Fərq</td><td class="n"><b class="${Math.abs(sh.diff || 0) < 0.01 ? 'yz-sh-ok' : 'yz-sh-bad'}">${(sh.diff > 0 ? '+' : '') + money(sh.diff)}${Math.abs(sh.diff || 0) < 0.01 ? ' ✓' : (sh.diff < 0 ? ' (kəsir)' : ' (artıq)')}</b></td></tr>
    ${sh.note ? `<tr><td colspan="2">Qeyd: ${esc(sh.note)}</td></tr>` : ''}` : '';
  return `<div class="yz-sh-rep">
    <div class="yz-sh-head"><b>${kind} hesabatı · Növbə №${esc(String(sh.no ?? '—'))}</b>
      <span>Açılış: ${dt(sh.openedAt)} · ${esc(sh.openedByName || '')}</span>
      <span>${kind === 'Z' && sh.closedAt ? `Bağlanış: ${dt(sh.closedAt)} · ${esc(sh.closedByName || '')}` : `Hesabat anı: ${dt(z.until)}`}</span></div>
    <table class="yz-sh-t"><tbody>
      <tr class="yz-sh-sec"><td colspan="2">Satış ödənişləri (${z.salesCount})</td></tr>${rows(z.sales)}
      <tr class="yz-sh-sum"><td>Cəmi satış</td><td class="n">${money(z.salesTotal)}</td></tr>
      <tr class="yz-sh-sec"><td colspan="2">Geri qaytarılan (${z.refundCount})</td></tr>${rows(z.refunds, '−')}
      <tr class="yz-sh-sec"><td colspan="2">Nisyə ödənişləri (müştəridən alınan)</td></tr>${rows(z.credit)}
      ${z.depositCount ? `<tr class="yz-sh-sec"><td colspan="2">Banket behi (${z.depositCount})</td></tr>${rows(z.deposits || {})}` : ''}
      <tr class="yz-sh-sec"><td colspan="2">Nağd kassa</td></tr>
      <tr><td>Başlanğıc nağd</td><td class="n">${money(z.opening)}</td></tr>
      <tr><td>+ Nağd satış</td><td class="n">${money(z.cashSales)}</td></tr>
      <tr><td>− Nağd geri qaytarma</td><td class="n">${money(Math.abs(z.cashRefunds))}</td></tr>
      <tr><td>+ Nağd nisyə ödənişi</td><td class="n">${money(z.cashCredit)}</td></tr>
      ${z.cashDeposit ? `<tr><td>+ Nağd banket behi</td><td class="n">${money(z.cashDeposit)}</td></tr>` : ''}
      ${z.cashAccount ? `<tr><td>+ Kassa mədaxil sənədləri</td><td class="n">${money(z.docsIn)}</td></tr>
      <tr><td>− Kassa məxaric / təhvil sənədləri</td><td class="n">${money(z.docsOut)}</td></tr>` : ''}
      <tr class="yz-sh-sum"><td>Kassada olmalıdır</td><td class="n">${money(z.expected)}</td></tr>
      ${closedPart}
      <tr class="yz-sh-sec"><td colspan="2">Məlumat</td></tr>
      <tr><td>Bağlanan masa / dövriyyə</td><td class="n">${z.tables} · ${money(z.turnover)}</td></tr>
      <tr><td>Geri qaytarılan masa</td><td class="n">${z.voided}</td></tr>
      <tr><td>Endirim / İkram</td><td class="n">${money(z.discount)} · ${money(z.compliment)}</td></tr>
      <tr><td>Ləğv olunan mal</td><td class="n">${z.cancelCount} · ${money(z.cancelAmount)}</td></tr>
      <tr><td>Nisyəyə yazılan / geri alınan</td><td class="n">${money(z.creditWritten)} · ${money(z.creditReversed)}</td></tr>
      <tr><td>${kind === 'Z' ? 'Bağlanış anında açıq masa' : 'Hazırda açıq masa'} (ödənilməmiş)</td><td class="n">${z.openTables} · ${money(z.openRemaining)}</td></tr>
    </tbody></table></div>`;
}

const CSS = `<style id="yzShCss">
.yz-sh-btn{display:inline-flex;align-items:center;gap:6px;padding:7px 11px;border-radius:9px;border:1px solid var(--border);background:var(--card2,transparent);color:var(--text);font-size:12.5px;font-weight:700;cursor:pointer;white-space:nowrap}
.yz-sh-btn--on{border-color:var(--green);color:var(--green)}.yz-sh-btn--off{border-color:var(--red);color:var(--red)}
.yz-sh-rep{font-size:13px}.yz-sh-head{display:flex;flex-direction:column;gap:2px;margin-bottom:10px}.yz-sh-head span{color:var(--text2);font-size:12px}
.yz-sh-t{width:100%;border-collapse:collapse}.yz-sh-t td{padding:5px 4px;border-bottom:1px solid var(--border)}.yz-sh-t .n{text-align:right;white-space:nowrap}
.yz-sh-sec td{font-weight:800;color:var(--text2);text-transform:uppercase;font-size:11px;padding-top:12px}.yz-sh-sum td{font-weight:800}
.yz-sh-ok{color:var(--green)}.yz-sh-bad{color:var(--red)}.yz-sh-muted{color:var(--text3)}
</style>`;

function printHtml(title, html) {
  const w = window.open('', '_blank', 'width=480,height=720');
  if (!w) { showToast(`${I('warning')} Çap pəncərəsi bloklandı`); return; }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(title)}</title><style>
    body{font-family:sans-serif;padding:14px;max-width:380px;margin:0 auto;color:#000}
    .yz-sh-head{display:flex;flex-direction:column;gap:2px;margin-bottom:8px;font-size:12px}.yz-sh-head b{font-size:15px}
    table{width:100%;border-collapse:collapse;font-size:12px}td{padding:3px 2px;border-bottom:1px dashed #bbb}.n{text-align:right;white-space:nowrap}
    .yz-sh-sec td{font-weight:700;padding-top:10px;border-bottom:1px solid #000}.yz-sh-sum td{font-weight:700}
  </style></head><body>${html}<script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}

/* ── Növbə paneli: X hesabatı + bağlamaq (Z) ── */
export async function openShiftPanel() {
  const sh = state.shift;
  if (!sh) { openShiftDialog(); return; }
  if (!canShift()) { showToast(`${I('ban')} Növbə hesabatı üçün icazəniz yoxdur`); return; }
  let z;
  try { z = await computeShift(sh); } catch (e) { showToast(`${I('error')} Hesabat alınmadı: ${esc(e.message || e)}`); return; }
  const m = modal({
    title: `${I('cash')} Kassa növbəsi №${esc(String(sh.no ?? ''))}`, wide: true,
    body: CSS + reportHtml(sh, z, 'X'),
    actions: [
      { label: 'Bağla', cancel: true, cls: 'yzi-btn--ghost' },
      { label: `${I('printer')} X çap et`, cls: 'yzi-btn--ghost', close: false, onClick: () => { printHtml('X hesabatı', reportHtml(sh, z, 'X')); return false; } },
      { label: `${I('lock')} Növbəni bağla (Z)`, cls: 'yzi-btn--red', onClick: () => { setTimeout(() => closeShiftDialog(), 50); } }
    ]
  });
  return m;
}

export async function closeShiftDialog() {
  const sh = state.shift;
  if (!sh || !canShift()) return;
  let z;
  try { z = await computeShift(sh); } catch (e) { showToast(`${I('error')} ${esc(e.message || e)}`); return; }
  const warnOpen = z.openTables ? `<p class="yzi-warnbox">${z.openTables} masa hələ açıqdır (ödənilməmiş ${money(z.openRemaining)}). Bu masaların sonrakı ödənişləri növbəti növbəyə yazılacaq.</p>` : '';
  const m = modal({
    title: `${I('lock')} Növbə №${esc(String(sh.no ?? ''))} — Z hesabatı`, wide: true,
    body: `${CSS}${warnOpen}
      <div class="yzi-grid2">
        <div class="yzi-f"><span>Kassada olmalıdır</span><b class="yzi-big">${money(z.expected)}</b></div>
        <label class="yzi-f"><span>Kassada faktiki sayılan nağd (₼) *</span>${numInput('id="yzShCnt" class="yzi-big" placeholder="0.00"', '')}</label>
        <div class="yzi-f"><span>Fərq</span><b id="yzShDiff" class="yzi-big">—</b></div>
        <label class="yzi-f"><span>Qeyd (fərq varsa mütləqdir)</span><input type="text" id="yzShNote" maxlength="300"></label>
      </div>
      <details style="margin-top:10px"><summary style="cursor:pointer;font-weight:700">Hesabatın detalları</summary>${reportHtml(sh, z, 'X')}</details>`,
    actions: [
      { label: 'Ləğv', cancel: true, cls: 'yzi-btn--ghost' },
      { label: 'Z — növbəni bağla', cls: 'yzi-btn--red', onClick: async (b) => {
        const cnt = num(b.querySelector('#yzShCnt').value);
        if (!Number.isFinite(cnt) || cnt < 0) throw new Error('Sayılan nağdı yazın');
        const note = b.querySelector('#yzShNote').value.trim();
        const at = serverNow();
        const zf = await computeShift(sh, at);            // son anın dəqiq rəqəmləri
        const diff = money2(cnt - zf.expected);
        if (Math.abs(diff) >= 0.01 && !note) throw new Error('Fərq var — səbəbi qeyddə yazın');
        const u = state.user || {};
        const tx = await CUR.transaction(c => (c && c.id === sh.id ? null : undefined));
        if (!tx.committed) throw new Error('Növbə artıq bağlanıb');
        const closedRec = { status: 'closed', closedAt: at, closedById: u.id || 'admin', closedByName: u.name || 'Rəhbər',
          closedTime: new Date(at).toLocaleTimeString('az-AZ'), closedDate: new Date(at).toLocaleDateString('az-AZ'),
          counted: money2(cnt), expected: zf.expected, diff, note: note || null, z: zf };
        try { await SH.child(sh.id).update(closedRec); }
        catch (e) { await CUR.transaction(c => (c ? undefined : sh)).catch(() => {}); throw e; }
        addLog('shift', `${closedRec.closedByName} növbə №${sh.no} bağladı (Z): olmalı ${money(zf.expected)}, sayılan ${money(cnt)}, fərq ${money(diff)}`, { shiftId: sh.id });
        showToast(`${I('check')} Növbə №${sh.no} bağlandı`);
        const full = { ...sh, ...closedRec };
        setTimeout(() => showZ(full), 60);
      } }
    ]
  });
  m.body.querySelector('#yzShCnt').addEventListener('input', (e) => {
    const v = num(e.target.value); const el = m.body.querySelector('#yzShDiff');
    if (!Number.isFinite(v)) { el.textContent = '—'; el.className = 'yzi-big'; return; }
    const df = money2(v - z.expected);
    el.textContent = (df > 0 ? '+' : '') + money(df) + (Math.abs(df) < 0.01 ? ' ✓' : df < 0 ? ' (kəsir)' : ' (artıq)');
    el.className = 'yzi-big ' + (Math.abs(df) < 0.01 ? 'yz-sh-ok' : 'yz-sh-bad');
  });
}

/* Bağlanmış növbənin Z hesabatı (yadda saxlanılmış rəqəmlərdən) */
export function showZ(sh) {
  if (!sh?.z) { showToast(`${I('warning')} Bu növbənin Z hesabatı yoxdur`); return; }
  modal({
    title: `${I('clipboard')} Z hesabatı · Növbə №${esc(String(sh.no ?? ''))}`, wide: true,
    body: CSS + reportHtml(sh, sh.z, 'Z'),
    actions: [
      { label: 'Bağla', cancel: true, cls: 'yzi-btn--ghost' },
      { label: `${I('printer')} Çap et`, cls: 'yzi-btn--gold', close: false, onClick: () => { printHtml('Z hesabatı', reportHtml(sh, sh.z, 'Z')); return false; } }
    ]
  });
}

/* Hesabatlar → "Kassa növbələri": seçilmiş aralıqda açılmış bütün növbələr (limitsiz) */
export async function renderShiftsReport(el, from, to) {
  el.innerHTML = '<p class="report-empty">Yüklənir…</p>';
  let list = [];
  try {
    const s = await SH.orderByChild('openedAt').startAt(from || 0).endAt(to || serverNow()).once('value');
    list = Object.entries(s.val() || {}).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.openedAt - a.openedAt);
  } catch (e) { el.innerHTML = `<p class="report-empty">Növbələr oxunmadı: ${esc(e.message || e)}</p>`; return; }
  const closed = list.filter(s => s.status === 'closed');
  const sumDiff = money2(closed.reduce((s, x) => s + (x.diff || 0), 0));
  const sumSales = money2(closed.reduce((s, x) => s + (x.z?.salesTotal || 0), 0));
  el.innerHTML = `${CSS}
    <div class="ct-report__stats" style="margin-bottom:18px;">
      <div class="stat-card"><div class="stat-num">${list.length}</div><div class="stat-label">Növbə</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--green);">${money(sumSales)}</div><div class="stat-label">Satış (bağlanmış növbələr)</div></div>
      <div class="stat-card"><div class="stat-num" style="color:${Math.abs(sumDiff) < 0.01 ? 'var(--green)' : 'var(--red)'};">${(sumDiff > 0 ? '+' : '') + money(sumDiff)}</div><div class="stat-label">Kassa fərqi (cəmi)</div></div>
    </div>
    <table class="report-table">
      <thead><tr><th>№</th><th>Açılış</th><th>Bağlanış</th><th class="num">Satış</th><th class="num">Olmalı</th><th class="num">Sayılan</th><th class="num">Fərq</th><th></th></tr></thead>
      <tbody>${list.length ? list.map(s => `<tr>
        <td>${esc(String(s.no ?? '—'))}</td>
        <td>${dt(s.openedAt)}<br><small>${esc(s.openedByName || '')}</small></td>
        <td>${s.status === 'closed' ? `${dt(s.closedAt)}<br><small>${esc(s.closedByName || '')}</small>` : '<b style="color:var(--green)">Açıqdır</b>'}</td>
        <td class="num">${s.z ? money(s.z.salesTotal) : '—'}</td>
        <td class="num">${s.status === 'closed' ? money(s.expected) : '—'}</td>
        <td class="num">${s.status === 'closed' ? money(s.counted) : '—'}</td>
        <td class="num" style="color:${Math.abs(s.diff || 0) < 0.01 ? 'var(--green)' : 'var(--red)'};">${s.status === 'closed' ? (s.diff > 0 ? '+' : '') + money(s.diff) : '—'}</td>
        <td>${s.status === 'closed' ? `<button class="btn btn-ghost" style="padding:4px 10px;font-size:12px;" data-z="${esc(s.id)}">Z</button>` : ''}</td>
      </tr>`).join('') : '<tr><td colspan="8" style="text-align:center;color:var(--text3);">Bu aralıqda növbə yoxdur</td></tr>'}</tbody>
    </table>`;
  el.querySelectorAll('[data-z]').forEach(b => b.addEventListener('click', () => showZ(list.find(x => x.id === b.dataset.z))));
}

/* ── Başlıqdakı düymə (işçi ekranı və admin paneli) ── */
function ensureButtons() {
  if (!document.getElementById('yzShCss')) document.head.insertAdjacentHTML('beforeend', CSS);
  // 21.11: növbənin nömrəsi və saatı hər ekranın başlığında göstərilmir — yalnız Mühasibat → Kassa bölməsində
  // (yuza-inv-cash.js). İşçi ekranında növbə "⋮" menyusundan (yuza-dots.js) idarə olunur.
  const spots = [];
  ['yzShBtnW', 'yzShBtnA'].forEach(id => document.getElementById(id)?.remove());
  spots.forEach(([id, host, before]) => {
    if (!host || document.getElementById(id)) return;
    const b = document.createElement('button');
    b.type = 'button'; b.id = id; b.className = 'yz-sh-btn';
    b.addEventListener('click', () => (state.shift ? openShiftPanel() : openShiftDialog()));
    const ref = host.querySelector(before);
    if (ref) host.insertBefore(b, ref); else host.appendChild(b);
  });
  paintButtons();
}
function paintButtons() {
  try { document.dispatchEvent(new CustomEvent('yz:shift-changed')); } catch (e) { /* */ }
  ['yzShBtnW', 'yzShBtnA'].forEach(id => {
    const b = document.getElementById(id); if (!b) return;
    const show = !!state.user && canShift();
    b.style.display = show ? '' : 'none';
    if (!show) return;
    const sh = state.shift;
    b.className = 'yz-sh-btn ' + (sh ? 'yz-sh-btn--on' : 'yz-sh-btn--off');
    b.innerHTML = sh ? `${I('cash')} Növbə №${esc(String(sh.no ?? ''))} · ${new Date(sh.openedAt).toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit' })}` : `${I('cash')} Növbə bağlıdır`;
    b.title = sh ? `Açılış: ${dt(sh.openedAt)} · ${sh.openedByName || ''}` : 'Kassa növbəsini açın';
  });
}
// İstifadəçi dəyişəndə (giriş/çıxış) düymənin görünməsi yenilənir
setInterval(() => { try { ensureButtons(); } catch (e) { /* */ } }, 3000);

window.yzShift = { open: openShiftDialog, panel: openShiftPanel, close: closeShiftDialog };
