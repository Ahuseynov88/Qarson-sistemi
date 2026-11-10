/* ═══════════════════════════════════════════
   YUZA POS — KASSA (pul hesabları)
   • Hesablar: nağd kassa, POS terminal, bank (istənilən sayda) — cashAccounts/{id}
   • Avtomatik hərəkətlər: masa ödənişləri, nisyə ödənişləri, banket ödənişləri,
     təchizatçı ödənişləri (yalnız təsdiqlənmiş)
   • Əl ilə sənədlər (invCash): mədaxil, məxaric, hesablar arası transfer — təsdiqdən sonra yazılır
   • Gün sonu (cashCloses): sistemdə olmalı olan ilə faktiki sayılan pul müqayisə olunur.
     Təsdiqlənmiş bağlanış "lövbər"dir: həmin andan qalıq = sayılan məbləğ.
   • settings/cash: ödəniş növü → hesab xəritəsi, xərc/gəlir kateqoriyaları
═══════════════════════════════════════════ */
import { db } from './firebase-service.js';
import { state } from './state.js';
import { addLog } from './utils.js';
import {
  DOCS, STATUS, docList, can, canCreate, canApprove, createDoc, updateDoc, submitDoc, approveDoc, rejectDoc,
  stornoDoc, deleteDraft, registerPoster, fmtMoney, fmtDT, toLocalInput, fromLocalInput, r2, num, uid, isAdmin,
  cashAccounts, accountList, accName, onInv
} from './yuza-inv-core.js';
import { registerTab, modal, confirmBox, esc, ok, fail, numInput, fresh, docHooks, refresh, blurIn } from './yuza-inv-ui.js';

/* ── Sabitlər ── */
export const ACC_KINDS = { cash: 'Nağd kassa', pos: 'POS terminal', bank: 'Bank hesabı' };
export const DEF_CAT_IN = ['Təsisçi pul qoydu', 'Avans qaytarıldı', 'Depozit', 'İcarə gəliri', 'Digər gəlir'];
export const DEF_CAT_OUT = ['Əmək haqqı', 'İşçiyə avans', 'İcarə', 'Kommunal xərclər', 'Vergi və rüsumlar', 'Bank xidmət haqqı',
  'Nəqliyyat', 'Təsərrüfat malları', 'Təmir və xidmət', 'Reklam', 'Təsisçiyə ödəniş', 'Digər xərc'];
const SRC = {
  sale: 'Masa satışı', credit: 'Nisyə ödənişi', banquet: 'Banket ödənişi', supplier: 'Təchizatçı ödənişi',
  doc: 'Kassa sənədi', transfer: 'Transfer', close: 'Gün sonu fərqi'
};

/* Kassa sənədləri anbara/borca təsir etmir — təsir yalnız hesablamada (statusa görə) */
registerPoster('cash', { post: async () => {}, unpost: async () => {} });
registerPoster('cashclose', { post: async () => {}, unpost: async () => {} });

/* ── Parametrlər ── */
export const cashCfg = { methodMap: {}, catIn: DEF_CAT_IN, catOut: DEF_CAT_OUT };
let cfgOn = false;
function watchCfg() {
  if (cfgOn) return; cfgOn = true;
  db.ref('settings/cash').on('value', s => {
    const v = s.val() || {};
    cashCfg.methodMap = v.methodMap || {};
    cashCfg.catIn = Array.isArray(v.catIn) && v.catIn.length ? v.catIn : DEF_CAT_IN;
    cashCfg.catOut = Array.isArray(v.catOut) && v.catOut.length ? v.catOut : DEF_CAT_OUT;
    refresh('cash');
  });
}
onInv((what) => { if (what === 'cash') cache.at = 0; });

const methodLabel = (m) => m === 'cash' ? 'Nağd' : m === 'pos' ? 'POS' : m === 'card' ? 'Kart' : m === 'transfer' ? 'Köçürmə'
  : ((state.paymentMethods || []).find(x => x.id === m)?.name || m || '—');
/* Ödəniş növü hansı hesaba düşür */
export function accFor(method, explicit) {
  if (explicit && cashAccounts[explicit]) return explicit;
  const m = cashCfg.methodMap?.[method];
  if (m && cashAccounts[m] && !cashAccounts[m].archived) return m;
  const kind = method === 'cash' ? 'cash' : method === 'transfer' ? 'bank' : 'pos';
  const list = accountList();
  return (list.find(a => a.kind === kind) || (kind === 'pos' ? list.find(a => a.kind === 'bank') : null) || list.find(a => a.kind === 'cash') || list[0])?.id || null;
}

/* ═══ HƏRƏKƏTLƏR ═══
   hərəkət: { ts (sənəd tarixi), bt (qalığa düşdüyü an), acc, amt (+ mədaxil / − məxaric),
              src, cat, text, who, ref:{kind,id}, pending } */
const cache = { since: Infinity, at: 0, ext: null };
async function loadExternal(since, force) {
  if (!force && cache.ext && since >= cache.since && Date.now() - cache.at < 30000) return cache.ext;
  const from = Math.max(0, Math.floor(since));
  const [pay, ch, bq] = await Promise.all([
    db.ref('payments').orderByChild('createdAt').startAt(from).once('value'),
    db.ref('customerCharges').orderByChild('createdAt').startAt(from).once('value'),
    db.ref('banquetEvents').once('value')
  ]);
  const out = [];
  const add = (ts, method, amt, src, text, who, ref) => {
    const a = r2(amt); if (!a) return;
    out.push({ ts, bt: ts, method, acc: null, amt: a, src, cat: SRC[src], text, who, ref });
  };
  Object.entries(pay.val() || {}).forEach(([id, p]) => {
    const ts = p.createdAt || 0; const ref = { kind: 'sale', id };
    const text = (p.tableName || 'Masa') + (p.type === 'split' ? ' · bölünmüş' : '');
    if (p.type === 'split' && p.splitBreakdown) Object.entries(p.splitBreakdown).forEach(([mid, v]) => add(ts, mid, v, 'sale', text, p.staffName || '', ref));
    else add(ts, p.type, p.thisPay, 'sale', text, p.staffName || '', ref);
  });
  Object.entries(ch.val() || {}).forEach(([id, c]) => {
    if (c.type !== 'payment') return;
    const name = (state.customers || []).find(x => x.id === c.customerId)?.name || 'Müştəri';
    add(c.createdAt || 0, c.paymentType || 'cash', c.amount, 'credit', name, c.staffName || '', { kind: 'credit', id });
  });
  Object.entries(bq.val() || {}).forEach(([id, ev]) => {
    const hist = Array.isArray(ev.paymentHistory) ? ev.paymentHistory : Object.values(ev.paymentHistory || {});
    hist.forEach(p => { if ((p?.date || 0) >= from) add(p.date || 0, p.method || 'cash', p.amount, 'banquet', (ev.clientName || 'Tədbir') + (p.note ? ' · ' + p.note : ''), ev.staffName || '', { kind: 'banquet', id }); });
  });
  cache.ext = out; cache.since = from; cache.at = Date.now();
  return out;
}
/* Sistem daxili sənədlərdən hərəkətlər (həmişə canlı) */
function internalMoves() {
  const out = [];
  docList('payment').forEach(d => {
    if (!['approved', 'storno'].includes(d.status) && d.status !== 'pending') return;
    const acc = accFor(d.method || 'cash', d.accountId);
    const base = { ts: d.at || d.createdAt, acc, src: 'supplier', cat: SRC.supplier, text: d.supplierName || 'Təchizatçı', who: d.approvedByName || d.createdByName || '', ref: { kind: 'payment', id: d.id }, no: d.no };
    if (d.status === 'pending') { out.push({ ...base, bt: d.at || d.createdAt, amt: -r2(d.amount), pending: true }); return; }
    out.push({ ...base, bt: Math.max(d.approvedAt || 0, 0) || base.ts, amt: -r2(d.amount) });
    if (d.status === 'storno') out.push({ ...base, ts: d.stornoAt, bt: d.stornoAt, amt: r2(d.amount), cat: 'Storno', text: `${d.no} storno · ${d.supplierName || ''}` });
  });
  docList('cash').forEach(d => {
    if (['draft', 'rejected'].includes(d.status)) return;
    const pending = d.status === 'pending' || d.status === 'posting';
    const ts = d.at || d.createdAt; const bt = pending ? ts : (d.approvedAt || ts);
    const ref = { kind: 'cash', id: d.id };
    const who = d.approvedByName || d.createdByName || '';
    const text = [d.counterparty, d.note].filter(Boolean).join(' · ');
    const legs = d.dir === 'transfer'
      ? [{ acc: d.accountId, amt: -r2(d.amount), cat: 'Transfer → ' + accName(d.toAccountId) }, { acc: d.toAccountId, amt: r2(d.amount), cat: 'Transfer ← ' + accName(d.accountId) }]
      : [{ acc: d.accountId, amt: d.dir === 'out' ? -r2(d.amount) : r2(d.amount), cat: d.category || (d.dir === 'out' ? 'Məxaric' : 'Mədaxil') }];
    legs.forEach(l => {
      out.push({ ts, bt, ...l, src: d.dir === 'transfer' ? 'transfer' : 'doc', text, who, ref, no: d.no, pending });
      if (d.status === 'storno') out.push({ ts: d.stornoAt, bt: d.stornoAt, acc: l.acc, amt: -l.amt, src: 'doc', cat: 'Storno', text: `${d.no} storno: ${d.stornoReason || ''}`, who: d.stornoBy || '', ref, no: d.no });
    });
  });
  docList('cashclose').forEach(c => {
    if (c.status !== 'approved' || Math.abs(c.diff || 0) < 0.005) return;
    out.push({ ts: c.at, bt: c.at, acc: c.accountId, amt: r2(c.diff), src: 'close', cat: c.diff < 0 ? 'Gün sonu kəsiri' : 'Gün sonu artığı', text: c.note || '', who: c.approvedByName || c.createdByName || '', ref: { kind: 'cashclose', id: c.id }, no: c.no, noBal: true });
  });
  return out;
}
/* Təsdiqlənmiş gün sonu bağlanışları — lövbər */
const closesOf = (acc) => docList('cashclose').filter(c => c.accountId === acc && c.status === 'approved').sort((a, b) => (b.at || 0) - (a.at || 0));
function anchorOf(acc, T = Date.now()) {
  const a = cashAccounts[acc] || {};
  const c = closesOf(acc).find(x => (x.at || 0) <= T);
  if (c && (c.at || 0) >= (a.openingAt || 0)) return { base: r2(c.counted), from: c.at, close: c };
  return { base: r2(a.opening || 0), from: a.openingAt || 0, close: null };
}
async function allMoves(since, force) {
  const ext = await loadExternal(since, force);
  ext.forEach(m => { m.acc = accFor(m.method); });
  return [...ext, ...internalMoves()].filter(m => m.acc && cashAccounts[m.acc]);
}
function balanceFrom(moves, acc, T = Date.now()) {
  const an = anchorOf(acc, T);
  const ms = moves.filter(m => m.acc === acc && !m.pending && !m.noBal && m.bt > an.from && m.bt <= T);
  const inn = r2(ms.filter(m => m.amt > 0).reduce((s, m) => s + m.amt, 0));
  const outt = r2(ms.filter(m => m.amt < 0).reduce((s, m) => s - m.amt, 0));
  return { ...an, inn, out: outt, bal: r2(an.base + inn - outt), moves: ms };
}
const sinceFor = (T) => Math.min(...accountList(true).map(a => anchorOf(a.id, T).from), T);

/* ═══ EKRAN ═══ */
const pf = { range: 'today', from: null, to: null, acc: '', dir: '', src: '' };
const dayStart = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
function rangeOf() {
  const now = Date.now(); const t0 = dayStart();
  switch (pf.range) {
    case 'today': return [t0, now];
    case 'yesterday': return [t0 - 86400000, t0 - 1];
    case 'week': { const d = new Date(); const wd = (d.getDay() + 6) % 7; return [t0 - wd * 86400000, now]; }
    case 'month': { const d = new Date(); return [new Date(d.getFullYear(), d.getMonth(), 1).getTime(), now]; }
    default: return [pf.from || t0, pf.to || now];
  }
}
const seeCash = () => can('cash.view') || can('cash.create') || can('cash.approve') || can('cash.close.create') || can('cash.close.approve');
const manage = () => isAdmin() || can('cash.approve');

async function renderCash(host) {
  watchCfg();
  const el = fresh(host);
  const accs = accountList();
  if (!accs.length) { renderSetup(el, host); return; }
  el.innerHTML = '<p class="yzi-empty">Yüklənir…</p>';
  const [from, to] = rangeOf();
  let moves;
  try { moves = await allMoves(Math.min(sinceFor(from), from)); }
  catch (e) { el.innerHTML = `<p class="yzi-warnbox">Məlumat oxunmadı: ${esc(e.message || e)}</p>`; return; }
  if (!el.isConnected) return;
  const bals = accs.map(a => ({ a, b: balanceFrom(moves, a.id) }));
  const list = moves.filter(m => m.ts >= from && m.ts <= to)
    .filter(m => (!pf.acc || m.acc === pf.acc) && (!pf.dir || (pf.dir === 'in' ? m.amt > 0 : m.amt < 0)) && (!pf.src || m.src === pf.src))
    .sort((a, b) => b.ts - a.ts);
  const done = list.filter(m => !m.pending);
  const sumIn = r2(done.filter(m => m.amt > 0).reduce((s, m) => s + m.amt, 0));
  const sumOut = r2(done.filter(m => m.amt < 0).reduce((s, m) => s - m.amt, 0));
  const pendN = list.filter(m => m.pending).length;
  const single = pf.acc ? { open: balanceFrom(moves, pf.acc, from - 1).bal, end: balanceFrom(moves, pf.acc, to).bal } : null;
  const canNew = canCreate('cash') || canApprove('cash');
  const canClose = canCreate('cashclose') || canApprove('cashclose');
  const closes = docList('cashclose').slice(0, 8);
  el.innerHTML = `
    <div class="yzi-head"><div><div class="yzi-eyebrow">MÜHASİBAT</div><h1 class="yzi-h1">Kassa və hesablar</h1></div>
      <div class="yzi-actions">
        ${canNew ? `<button type="button" class="yzi-btn yzi-btn--gold" data-new="in">+ Mədaxil</button>
        <button type="button" class="yzi-btn yzi-btn--ghost" data-new="out">− Məxaric</button>
        <button type="button" class="yzi-btn yzi-btn--ghost" data-new="transfer">⇄ Transfer</button>` : ''}
        ${manage() ? '<button type="button" class="yzi-btn yzi-btn--ghost" data-cfg>Parametrlər</button>' : ''}
      </div></div>
    <div class="yzi-kpis yzi-acc-cards">${bals.map(({ a, b }) => `<div class="yzi-kpi yzi-acc yzi-acc--${a.kind}">
      <small>${esc(ACC_KINDS[a.kind] || '')}</small><b class="${b.bal < 0 ? 'yzi-bad' : ''}">${fmtMoney(b.bal)}</b>
      <span class="yzi-acc__name">${esc(a.name)}</span>
      <span class="mut">${b.close ? 'Son bağlanış: ' + fmtDT(b.close.at) : 'Başlanğıc: ' + fmtDT(b.from)}</span>
      ${canClose ? `<button type="button" class="yzi-btn yzi-btn--sm ${a.kind === 'cash' ? 'yzi-btn--gold' : 'yzi-btn--ghost'}" data-close="${a.id}">${a.kind === 'cash' ? 'Gün sonu' : 'Üzləşmə'}</button>` : ''}
    </div>`).join('')}</div>
    <div class="yzi-filters yzi-filters--cash">
      <div class="yzi-pills">${[['today', 'Bu gün'], ['yesterday', 'Dünən'], ['week', 'Bu həftə'], ['month', 'Bu ay'], ['custom', 'Seçilmiş']].map(([k, v]) => `<button type="button" data-r="${k}" class="${pf.range === k ? 'is-on' : ''}">${v}</button>`).join('')}</div>
      ${pf.range === 'custom' ? `<label class="yzi-f yzi-f--inline"><span>Başlanğıc</span><input type="datetime-local" id="yziCsFrom" value="${toLocalInput(from)}"></label>
        <label class="yzi-f yzi-f--inline"><span>Son</span><input type="datetime-local" id="yziCsTo" value="${toLocalInput(to)}"></label>` : ''}
      <label class="yzi-f yzi-f--inline"><span>Hesab</span><select id="yziCsAcc"><option value="">Hamısı</option>${accs.map(a => `<option value="${a.id}"${a.id === pf.acc ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
      <label class="yzi-f yzi-f--inline"><span>Növ</span><select id="yziCsDir"><option value="">Hamısı</option><option value="in"${pf.dir === 'in' ? ' selected' : ''}>Mədaxil</option><option value="out"${pf.dir === 'out' ? ' selected' : ''}>Məxaric</option></select></label>
      <label class="yzi-f yzi-f--inline"><span>Mənbə</span><select id="yziCsSrc"><option value="">Hamısı</option>${Object.entries(SRC).map(([k, v]) => `<option value="${k}"${k === pf.src ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      <button type="button" class="yzi-btn yzi-btn--ghost yzi-btn--sm" data-reload>Yenilə</button>
      <button type="button" class="yzi-btn yzi-btn--ghost yzi-btn--sm" data-csv>CSV</button>
    </div>
    <div class="yzi-mini-kpis">
      ${single ? `<div><small>Dövrün əvvəlinə qalıq</small><b>${fmtMoney(single.open)}</b></div>` : ''}
      <div><small>Mədaxil</small><b class="yzi-ok">${sumIn ? '+' : ''}${fmtMoney(sumIn)}</b></div>
      <div><small>Məxaric</small><b class="yzi-bad">${sumOut ? '−' : ''}${fmtMoney(sumOut)}</b></div>
      <div><small>Fərq</small><b>${fmtMoney(sumIn - sumOut)}</b></div>
      ${single ? `<div><small>Dövrün sonuna qalıq</small><b>${fmtMoney(single.end)}</b></div>` : ''}
      ${pendN ? `<div><small>Təsdiq gözləyir</small><b class="yzi-warn">${pendN}</b></div>` : ''}
    </div>
    <div class="yzi-table-wrap"><table class="yzi-table">
      <thead><tr><th>Tarix</th><th>Hesab</th><th>Maddə</th><th>İzah</th><th class="n">Mədaxil</th><th class="n">Məxaric</th><th>Kim</th></tr></thead>
      <tbody>${list.slice(0, 800).map(m => `<tr ${m.ref && ['cash', 'payment', 'cashclose'].includes(m.ref.kind) ? `data-open="${m.ref.kind}|${m.ref.id}" tabindex="0"` : ''} class="${m.pending ? 'is-pending' : ''}">
        <td>${fmtDT(m.ts)}</td><td>${esc(accName(m.acc))}</td>
        <td>${esc(m.cat || '')}${m.no ? ` <small class="yzi-mono mut">${esc(m.no)}</small>` : ''}${m.pending ? ' <span class="yzi-st yzi-st--warn">Gözləyir</span>' : ''}</td>
        <td class="mut">${esc(m.text || '')}${m.method ? ` <small>(${esc(methodLabel(m.method))})</small>` : ''}</td>
        <td class="n">${m.amt > 0 ? fmtMoney(m.amt) : ''}</td><td class="n">${m.amt < 0 ? fmtMoney(-m.amt) : ''}</td><td class="mut">${esc(m.who || '')}</td></tr>`).join('') || '<tr><td colspan="7" class="yzi-empty">Bu dövrdə hərəkət yoxdur.</td></tr>'}</tbody>
    </table></div>
    ${list.length > 800 ? `<p class="yzi-hint">İlk 800 sətir göstərilir. Hamısı üçün CSV yükləyin.</p>` : ''}
    <h3 class="yzi-h3">Gün sonu bağlanışları</h3>
    <div class="yzi-table-wrap"><table class="yzi-table yzi-table--mini">
      <thead><tr><th>Tarix</th><th>Sənəd</th><th>Hesab</th><th class="n">Olmalı</th><th class="n">Sayıldı</th><th class="n">Fərq</th><th>Status</th></tr></thead>
      <tbody>${closes.map(c => `<tr data-open="cashclose|${c.id}" tabindex="0" class="${c.status === 'storno' ? 'is-void' : ''}"><td>${fmtDT(c.at)}</td><td class="yzi-mono">${esc(c.no)}</td><td>${esc(accName(c.accountId))}</td>
        <td class="n">${fmtMoney(c.expected)}</td><td class="n">${fmtMoney(c.counted)}</td><td class="n"><b class="${c.diff < 0 ? 'yzi-bad' : c.diff > 0 ? 'yzi-ok' : 'mut'}">${c.diff > 0 ? '+' : ''}${fmtMoney(c.diff)}</b></td>
        <td><span class="yzi-st yzi-st--${STATUS[c.status]?.cls}">${STATUS[c.status]?.label || c.status}</span></td></tr>`).join('') || '<tr><td colspan="7" class="yzi-empty">Hələ bağlanış yoxdur.</td></tr>'}</tbody>
    </table></div>`;
  const again = () => renderCash(host);
  el.addEventListener('click', (e) => {
    const r = e.target.closest('[data-r]'); if (r) { pf.range = r.dataset.r; if (pf.range === 'custom') { [pf.from, pf.to] = [from, to]; } again(); return; }
    const n = e.target.closest('[data-new]'); if (n) { openCashEditor(null, { dir: n.dataset.new }); return; }
    const c = e.target.closest('[data-close]'); if (c) { openClose(c.dataset.close); return; }
    if (e.target.closest('[data-cfg]')) { openSettings(); return; }
    if (e.target.closest('[data-reload]')) { cache.at = 0; again(); return; }
    if (e.target.closest('[data-csv]')) { exportCsv(list); return; }
    const o = e.target.closest('[data-open]'); if (o) { const [k, id] = o.dataset.open.split('|'); openAny(k, id); }
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('[data-open]')) { const [k, id] = e.target.dataset.open.split('|'); openAny(k, id); } });
  el.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'yziCsAcc') pf.acc = t.value;
    else if (t.id === 'yziCsDir') pf.dir = t.value;
    else if (t.id === 'yziCsSrc') pf.src = t.value;
    else if (t.id === 'yziCsFrom') pf.from = fromLocalInput(t.value);
    else if (t.id === 'yziCsTo') pf.to = fromLocalInput(t.value);
    else return;
    blurIn(el); again();
  });
}
async function openAny(kind, id) {
  if (kind === 'cash') return openCashDoc(id);
  if (kind === 'cashclose') return openCloseDoc(id);
  const { openDoc } = await import('./yuza-inv-stock.js');
  openDoc(kind, id);
}
function exportCsv(list) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Tarix', 'Hesab', 'Maddə', 'Sənəd', 'İzah', 'Üsul', 'Mədaxil', 'Məxaric', 'Kim', 'Status']]
    .concat(list.map(m => [fmtDT(m.ts), accName(m.acc), m.cat, m.no || '', m.text, m.method ? methodLabel(m.method) : '', m.amt > 0 ? m.amt.toFixed(2) : '', m.amt < 0 ? (-m.amt).toFixed(2) : '', m.who, m.pending ? 'Gözləyir' : 'Yazılıb']));
  const blob = new Blob(['﻿' + rows.map(r => r.map(q).join(';')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `kassa-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ── İlk quraşdırma ── */
function renderSetup(el, host) {
  if (!manage()) { el.innerHTML = '<div class="yzi-head"><div><div class="yzi-eyebrow">MÜHASİBAT</div><h1 class="yzi-h1">Kassa</h1></div></div><p class="yzi-banner">Kassa hesabları hələ yaradılmayıb. Rəhbər və ya mühasib əvvəlcə hesabları qurmalıdır.</p>'; return; }
  const rows = [['cash', 'Əsas kassa', true], ['pos', 'POS terminal', true], ['bank', 'Bank hesabı', false]];
  el.innerHTML = `<div class="yzi-head"><div><div class="yzi-eyebrow">MÜHASİBAT</div><h1 class="yzi-h1">Kassanı quraq</h1></div></div>
    <div class="yzi-card">
      <p class="yzi-p">Pulun saxlandığı yerləri seçin və <b>bu anda</b> orada olan məbləği yazın. Bundan sonrakı bütün satış, ödəniş və xərclər avtomatik bu hesablara yazılacaq.</p>
      <div class="yzi-setup">${rows.map(([k, n, on], i) => `<div class="yzi-setup__row">
        <label class="yzi-check"><input type="checkbox" data-i="${i}" ${on ? 'checked' : ''}> ${ACC_KINDS[k]}</label>
        <label class="yzi-f"><span>Ad</span><input type="text" id="yziSuN${i}" value="${esc(n)}"></label>
        <label class="yzi-f"><span>İndiki qalıq (₼)</span>${numInput(`id="yziSuO${i}" placeholder="0.00"`, '')}</label></div>`).join('')}</div>
      <label class="yzi-f"><span>Başlanğıc anı</span><input type="datetime-local" id="yziSuAt" value="${toLocalInput(Date.now())}"></label>
      <p class="yzi-hint">Bu andan əvvəlki köhnə satışlar kassa qalığına təsir etməyəcək (hesabatlarda qalır).</p>
      <div class="yzi-row yzi-row--btns"><button type="button" class="yzi-btn yzi-btn--gold" id="yziSuGo">Kassanı yarat</button></div>
    </div>`;
  el.querySelector('#yziSuGo').addEventListener('click', async (ev) => {
    const b = ev.currentTarget; b.disabled = true;
    try {
      const at = fromLocalInput(el.querySelector('#yziSuAt').value);
      const ids = {}; let order = 0;
      for (const [i, [k]] of rows.entries()) {
        if (!el.querySelector(`[data-i="${i}"]`).checked) continue;
        const name = el.querySelector('#yziSuN' + i).value.trim() || ACC_KINDS[k];
        const o = num(el.querySelector('#yziSuO' + i).value);
        const ref = db.ref('cashAccounts').push();
        await ref.set({ name, kind: k, order: order++, opening: Number.isFinite(o) ? r2(o) : 0, openingAt: at, createdAt: Date.now(), createdBy: state.user?.name || 'Rəhbər' });
        ids[k] = ref.key;
      }
      if (!Object.keys(ids).length) { fail('Ən azı bir hesab seçin'); b.disabled = false; return; }
      const map = { cash: ids.cash, pos: ids.pos || ids.bank, card: ids.pos || ids.bank, transfer: ids.bank || ids.pos };
      (state.paymentMethods || []).forEach(pm => { map[pm.id] = ids.pos || ids.bank || ids.cash; });
      Object.keys(map).forEach(k => { if (!map[k]) delete map[k]; });
      await db.ref('settings/cash').update({ methodMap: map });
      addLog('inventory', 'Kassa hesabları yaradıldı', {});
      ok('Kassa quruldu');
      host.closest('.admin-section, #yzInvStaffHost, .yzi-body')?.scrollTo?.(0, 0);
    } catch (e) { fail(e.message || e); b.disabled = false; }
  });
}

/* ── Parametrlər: hesablar, xəritə, kateqoriyalar ──
   Ayarlar mərkəzindən də açılır (Sistem → Ayarlar → Bölmələrin ayarları) */
window.yzCashSettings = () => openSettings();
function openSettings() {
  watchCfg();
  const accs = accountList(true);
  const methods = [['cash', 'Nağd'], ['pos', 'POS'], ['card', 'Kart (banket)'], ['transfer', 'Köçürmə (banket, təchizatçı)'], ...(state.paymentMethods || []).map(p => [p.id, p.name])];
  const accSel = (m) => `<select data-map="${esc(m)}">${accountList().map(a => `<option value="${a.id}"${accFor(m) === a.id ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}</select>`;
  const m = modal({ title: 'Kassa parametrləri', wide: true, body: `
    <h3 class="yzi-h3">Hesablar</h3>
    <div class="yzi-table-wrap"><table class="yzi-table yzi-table--mini"><thead><tr><th>Ad</th><th>Növ</th><th class="n">Başlanğıc</th><th>Tarix</th><th></th></tr></thead><tbody>
      ${accs.map(a => `<tr class="${a.archived ? 'is-void' : ''}"><td><b>${esc(a.name)}</b></td><td>${ACC_KINDS[a.kind] || a.kind}</td><td class="n">${fmtMoney(a.opening)}</td><td>${fmtDT(a.openingAt)}</td>
        <td><button type="button" class="yzi-btn yzi-btn--sm yzi-btn--ghost" data-edit="${a.id}">Düzəlt</button></td></tr>`).join('')}
    </tbody></table></div>
    <button type="button" class="yzi-btn yzi-btn--ghost yzi-btn--sm" data-add>+ Yeni hesab</button>
    <h3 class="yzi-h3">Ödəniş növü hansı hesaba düşsün</h3>
    <div class="yzi-grid2">${methods.map(([k, n]) => `<label class="yzi-f"><span>${esc(n)}</span>${accSel(k)}</label>`).join('')}</div>
    <h3 class="yzi-h3">Maddələr (hər sətirdə bir)</h3>
    <div class="yzi-grid2">
      <label class="yzi-f"><span>Mədaxil maddələri</span><textarea id="yziCfIn" rows="7">${esc(cashCfg.catIn.join('\n'))}</textarea></label>
      <label class="yzi-f"><span>Məxaric maddələri</span><textarea id="yziCfOut" rows="7">${esc(cashCfg.catOut.join('\n'))}</textarea></label>
    </div>`,
    actions: [{ label: 'Bağla', cancel: true, cls: 'yzi-btn--ghost' }, { label: 'Yadda saxla', cls: 'yzi-btn--gold', onClick: async (b) => {
      const map = {}; b.querySelectorAll('[data-map]').forEach(s => { map[s.dataset.map] = s.value; });
      const lines = (id) => b.querySelector(id).value.split('\n').map(x => x.trim()).filter(Boolean);
      await db.ref('settings/cash').update({ methodMap: map, catIn: lines('#yziCfIn'), catOut: lines('#yziCfOut') });
      ok('Yadda saxlandı');
    } }] });
  m.body.addEventListener('click', (e) => {
    const ed = e.target.closest('[data-edit]'); if (ed) { m.close(); accountEditor(ed.dataset.edit); return; }
    if (e.target.closest('[data-add]')) { m.close(); accountEditor(null); }
  });
}
function accountEditor(id) {
  const a = id ? cashAccounts[id] : { kind: 'cash', opening: 0, openingAt: Date.now() };
  modal({ title: id ? 'Hesab' : 'Yeni hesab', body: `
    <label class="yzi-f"><span>Ad *</span><input type="text" id="yziAcN" value="${esc(a.name || '')}"></label>
    <label class="yzi-f"><span>Növ</span><select id="yziAcK">${Object.entries(ACC_KINDS).map(([k, v]) => `<option value="${k}"${k === a.kind ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
    <div class="yzi-grid2"><label class="yzi-f"><span>Başlanğıc qalıq (₼)</span>${numInput('id="yziAcO"', a.opening ?? 0)}</label>
      <label class="yzi-f"><span>Başlanğıc anı</span><input type="datetime-local" id="yziAcAt" value="${toLocalInput(a.openingAt || Date.now())}"></label></div>
    ${id ? `<p class="yzi-hint">Başlanğıc qalığı dəyişsəniz, son gün sonu bağlanışına qədər olan qalıq yenidən hesablanır.</p>
      <label class="yzi-check"><input type="checkbox" id="yziAcAr" ${a.archived ? 'checked' : ''}> Arxivə at (yeni əməliyyatlarda görünməsin)</label>` : ''}`,
  actions: [{ label: 'Ləğv', cancel: true, cls: 'yzi-btn--ghost' }, { label: 'Yadda saxla', cls: 'yzi-btn--gold', onClick: async (b) => {
    const name = b.querySelector('#yziAcN').value.trim(); if (!name) { fail('Ad yazılmalıdır'); return false; }
    const o = num(b.querySelector('#yziAcO').value);
    const data = { name, kind: b.querySelector('#yziAcK').value, opening: Number.isFinite(o) ? r2(o) : 0, openingAt: fromLocalInput(b.querySelector('#yziAcAt').value), archived: !!b.querySelector('#yziAcAr')?.checked, updatedAt: Date.now() };
    if (id) await db.ref('cashAccounts/' + id).update(data);
    else await db.ref('cashAccounts').push({ ...data, order: accountList(true).length, createdAt: Date.now() });
    addLog('inventory', `Kassa hesabı ${id ? 'dəyişdirildi' : 'yaradıldı'}: ${name}`, {});
    ok('Yadda saxlandı');
  } }] });
}

/* ═══ KASSA SƏNƏDİ (mədaxil / məxaric / transfer) ═══ */
export function openCashEditor(id, preset = {}) {
  watchCfg();
  const old = id ? docList('cash').find(x => x.id === id) : null;
  const d = old ? { ...old } : { dir: preset.dir || 'in', at: Date.now(), accountId: preset.accountId || accountList().find(a => a.kind === 'cash')?.id || accountList()[0]?.id, toAccountId: '', amount: '', category: '', counterparty: '', note: '' };
  const accs = accountList();
  if (!accs.length) { fail('Əvvəlcə kassa hesabı yaradın'); return; }
  const cats = () => d.dir === 'out' ? cashCfg.catOut : cashCfg.catIn;
  const accOpts = (sel, skip) => accs.filter(a => a.id !== skip).map(a => `<option value="${a.id}"${a.id === sel ? ' selected' : ''}>${esc(a.name)}</option>`).join('');
  const body = document.createElement('div');
  const draw = () => {
    blurIn(body);
    body.innerHTML = `
      <div class="yzi-seg" id="yziCdDir">${[['in', 'Mədaxil'], ['out', 'Məxaric'], ['transfer', 'Transfer']].map(([k, v]) => `<button type="button" data-dir="${k}" class="${d.dir === k ? 'is-on' : ''}">${v}</button>`).join('')}</div>
      <div class="yzi-grid2">
        <label class="yzi-f"><span>Tarix və saat</span><input type="datetime-local" id="yziCdAt" value="${toLocalInput(d.at)}"></label>
        <label class="yzi-f"><span>Məbləğ (₼) *</span>${numInput('id="yziCdAm" class="yzi-big" placeholder="0.00"', d.amount)}</label>
        <label class="yzi-f"><span>${d.dir === 'transfer' ? 'Haradan *' : 'Hesab *'}</span><select id="yziCdAcc">${accOpts(d.accountId)}</select></label>
        ${d.dir === 'transfer' ? `<label class="yzi-f"><span>Haraya *</span><select id="yziCdTo"><option value="">— seçin —</option>${accOpts(d.toAccountId, d.accountId)}</select></label>`
          : `<label class="yzi-f"><span>Maddə *</span><select id="yziCdCat"><option value="">— seçin —</option>${cats().map(c => `<option${c === d.category ? ' selected' : ''}>${esc(c)}</option>`).join('')}${d.category && !cats().includes(d.category) ? `<option selected>${esc(d.category)}</option>` : ''}</select></label>`}
        ${d.dir !== 'transfer' ? `<label class="yzi-f yzi-span2"><span>${d.dir === 'out' ? 'Kimə ödənildi' : 'Kimdən alındı'}</span><input type="text" id="yziCdCp" value="${esc(d.counterparty || '')}" placeholder="Ad, şirkət və ya işçi"></label>` : ''}
        <label class="yzi-f yzi-span2"><span>Qeyd</span><textarea id="yziCdNote" rows="2">${esc(d.note || '')}</textarea></label>
      </div>
      <p class="yzi-hint">Sənəd təsdiqlənəndən sonra kassaya yazılır. ${canApprove('cash', old || { createdBy: uid() }) ? '' : 'Sizin göndərdiyiniz sənədi mühasib və ya patron təsdiqləyəcək.'}</p>`;
  };
  const read = () => {
    const g = (s) => body.querySelector(s);
    d.at = fromLocalInput(g('#yziCdAt').value);
    d.amount = num(g('#yziCdAm').value);
    d.accountId = g('#yziCdAcc').value;
    if (d.dir === 'transfer') d.toAccountId = g('#yziCdTo')?.value || '';
    else { d.category = g('#yziCdCat')?.value || ''; d.counterparty = g('#yziCdCp')?.value.trim() || ''; }
    d.note = g('#yziCdNote').value.trim();
  };
  body.addEventListener('click', (e) => { const b = e.target.closest('[data-dir]'); if (!b) return; read(); d.dir = b.dataset.dir; d.category = ''; draw(); });
  body.addEventListener('change', (e) => { if (e.target.id === 'yziCdAcc' && d.dir === 'transfer') { read(); if (d.toAccountId === d.accountId) d.toAccountId = ''; draw(); } });
  draw();
  const save = async (approve) => {
    read();
    if (!(d.amount > 0)) throw new Error('Məbləğ sıfırdan böyük olmalıdır');
    if (!d.accountId) throw new Error('Hesab seçin');
    if (d.dir === 'transfer' && (!d.toAccountId || d.toAccountId === d.accountId)) throw new Error('Transfer üçün fərqli hesab seçin');
    if (d.dir !== 'transfer' && !d.category) throw new Error('Maddə seçin');
    if (d.dir !== 'in' && cashAccounts[d.accountId]?.kind === 'cash') {
      const ms = await allMoves(sinceFor(Date.now()));
      const bal = balanceFrom(ms, d.accountId).bal;
      if (d.amount - bal > 0.009 && !await confirmBox(`"${esc(accName(d.accountId))}" hesabında ${fmtMoney(bal)} var, siz ${fmtMoney(d.amount)} çıxarırsınız. Qalıq mənfi olacaq. Davam edilsin?`, { okLabel: 'Davam et' })) return false;
    }
    const data = { dir: d.dir, at: d.at, accountId: d.accountId, toAccountId: d.dir === 'transfer' ? d.toAccountId : null, amount: r2(d.amount),
      category: d.dir === 'transfer' ? null : d.category, counterparty: d.dir === 'transfer' ? null : (d.counterparty || null), note: d.note || null,
      accountName: accName(d.accountId), toAccountName: d.dir === 'transfer' ? accName(d.toAccountId) : null };
    if (old) { await updateDoc('cash', id, data); if (old.status !== 'pending') await submitDoc('cash', id); if (approve) await approveDoc('cash', id); }
    else await createDoc('cash', data, { approveNow: approve });
    ok(approve ? 'Kassaya yazıldı' : 'Təsdiqə göndərildi');
  };
  const acts = [{ label: 'Ləğv', cancel: true, cls: 'yzi-btn--ghost' }];
  if (canCreate('cash') || canApprove('cash')) acts.push({ label: 'Təsdiqə göndər', cls: 'yzi-btn--ghost', onClick: () => save(false) });
  if (canApprove('cash', old || { createdBy: '__new' })) acts.push({ label: 'Təsdiqlə və yaz', cls: 'yzi-btn--gold', onClick: () => save(true) });
  modal({ title: old ? `Kassa sənədi ${esc(old.no)}` : 'Yeni kassa sənədi', body, actions: acts });
}

function docActions(kind, d, editFn) {
  const mine = d.createdBy === uid() || isAdmin();
  const acts = [{ label: 'Bağla', cancel: true, cls: 'yzi-btn--ghost' }];
  if (['pending', 'rejected', 'draft'].includes(d.status) && mine) acts.push({ label: 'Sil', cls: 'yzi-btn--ghost yzi-btn--left', onClick: async () => { if (!await confirmBox(`${esc(d.no)} silinsin?`, { okLabel: 'Sil', okCls: 'yzi-btn--red' })) return false; await deleteDraft(kind, d.id); ok('Silindi'); } });
  if (editFn && ['pending', 'rejected'].includes(d.status) && mine) acts.push({ label: 'Redaktə', cls: 'yzi-btn--ghost', onClick: () => { setTimeout(editFn, 10); } });
  if (d.status === 'pending' && canApprove(kind, d)) {
    acts.push({ label: 'Rədd et', cls: 'yzi-btn--ghost', onClick: async () => { const r = await confirmBox('Rədd səbəbi?', { input: 'Səbəb', okLabel: 'Rədd et', okCls: 'yzi-btn--red' }); if (!r) return false; await rejectDoc(kind, d.id, r); ok('Rədd edildi'); } });
    acts.push({ label: 'Təsdiqlə', cls: 'yzi-btn--gold', onClick: async () => { await approveDoc(kind, d.id); ok('Təsdiqləndi'); } });
  }
  if (d.status === 'approved' && (can(DOCS[kind].storno) || isAdmin())) acts.push({ label: 'Storno', cls: 'yzi-btn--red', onClick: async () => {
    const r = await confirmBox(`${esc(d.no)} storno edilsin?`, { input: 'Storno səbəbi', okLabel: 'Storno et', okCls: 'yzi-btn--red' });
    if (!r) return false; await stornoDoc(kind, d.id, r); ok('Storno edildi');
  } });
  return acts;
}
const metaBlock = (d) => `
  <div><small>Status</small><b><span class="yzi-st yzi-st--${STATUS[d.status]?.cls}">${STATUS[d.status]?.label || d.status}</span></b></div>
  <div><small>Yazan</small><b>${esc(d.createdByName || '—')}</b><small>${fmtDT(d.createdAt)}</small></div>
  ${d.approvedAt ? `<div><small>Təsdiq edən</small><b>${esc(d.approvedByName)}</b><small>${fmtDT(d.approvedAt)}</small></div>` : ''}
  ${d.rejectReason ? `<div><small>Rədd səbəbi</small><b>${esc(d.rejectReason)}</b></div>` : ''}
  ${d.stornoAt ? `<div><small>Storno</small><b>${esc(d.stornoBy)}</b><small>${fmtDT(d.stornoAt)} · ${esc(d.stornoReason)}</small></div>` : ''}`;

export function openCashDoc(id) {
  const d = docList('cash').find(x => x.id === id); if (!d) return;
  const mine = d.createdBy === uid() || isAdmin();
  if (d.status === 'rejected' && mine) { openCashEditor(id); return; }
  const dirL = { in: 'Mədaxil', out: 'Məxaric', transfer: 'Transfer' }[d.dir];
  modal({ title: `${dirL} ${esc(d.no)}`, actions: docActions('cash', d, () => openCashEditor(id)), body: `
    <div class="yzi-docmeta">
      <div><small>Tarix</small><b>${fmtDT(d.at)}</b></div>
      <div><small>Məbləğ</small><b class="${d.dir === 'out' ? 'yzi-bad' : 'yzi-ok'}">${fmtMoney(d.amount)}</b></div>
      <div><small>${d.dir === 'transfer' ? 'Haradan → haraya' : 'Hesab'}</small><b>${esc(accName(d.accountId))}${d.dir === 'transfer' ? ' → ' + esc(accName(d.toAccountId)) : ''}</b></div>
      ${d.category ? `<div><small>Maddə</small><b>${esc(d.category)}</b></div>` : ''}
      ${d.counterparty ? `<div><small>${d.dir === 'out' ? 'Kimə' : 'Kimdən'}</small><b>${esc(d.counterparty)}</b></div>` : ''}
      ${metaBlock(d)}
    </div>${d.note ? `<p class="yzi-p"><b>Qeyd:</b> ${esc(d.note)}</p>` : ''}
    ${d.postError ? `<p class="yzi-warnbox">${esc(d.postError)}</p>` : ''}` });
}

/* ═══ GÜN SONU / ÜZLƏŞMƏ ═══ */
export async function openClose(accId) {
  const a = cashAccounts[accId]; if (!a) return;
  const C = Date.now();
  let ms;
  try { ms = await allMoves(sinceFor(C), true); } catch (e) { fail(e.message || e); return; }
  const b = balanceFrom(ms, accId, C);
  const groups = {};
  b.moves.forEach(m => { const k = (m.amt > 0 ? '+' : '−') + (m.src === 'doc' ? m.cat : SRC[m.src]); groups[k] = r2((groups[k] || 0) + Math.abs(m.amt)); });
  const pend = ms.filter(m => m.acc === accId && m.pending);
  const others = accountList().filter(x => x.id !== accId);
  const isCash = a.kind === 'cash';
  const body = `
    <div class="yzi-docmeta">
      <div><small>Hesab</small><b>${esc(a.name)}</b></div>
      <div><small>Dövr</small><b>${fmtDT(b.from)} — ${fmtDT(C)}</b></div>
    </div>
    <div class="yzi-table-wrap"><table class="yzi-table yzi-table--mini"><tbody>
      <tr><td>${b.close ? 'Əvvəlki bağlanışda sayılan' : 'Başlanğıc qalıq'}</td><td class="n">${fmtMoney(b.base)}</td></tr>
      ${Object.entries(groups).sort().map(([k, v]) => `<tr><td>${k[0] === '+' ? 'Mədaxil' : 'Məxaric'}: ${esc(k.slice(1))}</td><td class="n ${k[0] === '+' ? 'yzi-ok' : 'yzi-bad'}">${k[0]}${fmtMoney(v)}</td></tr>`).join('')}
    </tbody><tfoot><tr><td><b>Sistemə görə olmalıdır</b></td><td class="n"><b class="yzi-gold">${fmtMoney(b.bal)}</b></td></tr></tfoot></table></div>
    ${pend.length ? `<p class="yzi-warnbox">${pend.length} kassa sənədi hələ təsdiqlənməyib — onlar bu hesablamaya daxil deyil.</p>` : ''}
    <div class="yzi-grid2">
      <label class="yzi-f"><span>${isCash ? 'Kassada faktiki sayılan (₼) *' : 'Bank/terminal çıxarışına görə (₼) *'}</span>${numInput('id="yziClCnt" class="yzi-big" placeholder="0.00"', '')}</label>
      <div class="yzi-f"><span>Fərq</span><b id="yziClDiff" class="yzi-big">—</b></div>
      <label class="yzi-f yzi-span2"><span>Qeyd (fərq varsa mütləqdir)</span><textarea id="yziClNote" rows="2"></textarea></label>
      ${isCash && others.length ? `<label class="yzi-f"><span>Təhvil (seyfə / banka), ₼</span>${numInput('id="yziClHo" placeholder="0.00"', '')}</label>
        <label class="yzi-f"><span>Təhvil hesabı</span><select id="yziClHoTo">${others.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select></label>` : ''}
    </div>`;
  const m = modal({ title: isCash ? 'Gün sonu bağlanışı' : 'Hesab üzləşməsi', wide: true, body, actions: [
    { label: 'Ləğv', cancel: true, cls: 'yzi-btn--ghost' },
    { label: 'Bağlanışı yaz', cls: 'yzi-btn--gold', onClick: async (bd) => {
      const cnt = num(bd.querySelector('#yziClCnt').value);
      if (!Number.isFinite(cnt) || cnt < 0) throw new Error('Sayılan məbləği yazın');
      const diff = r2(cnt - b.bal);
      const note = bd.querySelector('#yziClNote').value.trim();
      if (Math.abs(diff) > 0.009 && !note) throw new Error('Fərq var — səbəbi qeyddə yazın');
      const ho = num(bd.querySelector('#yziClHo')?.value || '');
      if (Number.isFinite(ho) && ho > 0 && ho - cnt > 0.009) throw new Error('Təhvil sayılan puldan çox ola bilməz');
      const approve = canApprove('cashclose', { createdBy: '__new' });
      await createDoc('cashclose', { accountId: accId, accountName: a.name, at: C, from: b.from, base: b.base, inSum: b.inn, outSum: b.out, expected: b.bal, counted: r2(cnt), diff, note: note || null, groups }, { approveNow: approve });
      if (Number.isFinite(ho) && ho > 0) {
        const to = bd.querySelector('#yziClHoTo').value;
        await createDoc('cash', { dir: 'transfer', at: C + 1000, accountId: accId, toAccountId: to, amount: r2(ho), accountName: a.name, toAccountName: accName(to), note: 'Gün sonu təhvili' }, { approveNow: canApprove('cash', { createdBy: '__new' }) });
      }
      cache.at = 0;
      ok(approve ? 'Bağlanış yazıldı' : 'Bağlanış təsdiqə göndərildi');
    } }] });
  m.body.querySelector('#yziClCnt').addEventListener('input', (e) => {
    const v = num(e.target.value); const el = m.body.querySelector('#yziClDiff');
    if (!Number.isFinite(v)) { el.textContent = '—'; el.className = 'yzi-big'; return; }
    const df = r2(v - b.bal);
    el.textContent = (df > 0 ? '+' : '') + fmtMoney(df) + (Math.abs(df) < 0.01 ? ' ✓' : df < 0 ? ' (kəsir)' : ' (artıq)');
    el.className = 'yzi-big ' + (Math.abs(df) < 0.01 ? 'yzi-ok' : 'yzi-bad');
  });
}
export function openCloseDoc(id) {
  const d = docList('cashclose').find(x => x.id === id); if (!d) return;
  modal({ title: `Gün sonu ${esc(d.no)}`, wide: true, actions: docActions('cashclose', d, null), body: `
    <div class="yzi-docmeta">
      <div><small>Hesab</small><b>${esc(accName(d.accountId))}</b></div>
      <div><small>Bağlanış anı</small><b>${fmtDT(d.at)}</b></div>
      <div><small>Dövr başı</small><b>${fmtDT(d.from)}</b></div>
      ${metaBlock(d)}
    </div>
    <div class="yzi-table-wrap"><table class="yzi-table yzi-table--mini"><tbody>
      <tr><td>Dövr başına qalıq</td><td class="n">${fmtMoney(d.base)}</td></tr>
      ${Object.entries(d.groups || {}).sort().map(([k, v]) => `<tr><td>${k[0] === '+' ? 'Mədaxil' : 'Məxaric'}: ${esc(k.slice(1))}</td><td class="n">${k[0]}${fmtMoney(v)}</td></tr>`).join('')}
      <tr><td><b>Olmalı idi</b></td><td class="n"><b>${fmtMoney(d.expected)}</b></td></tr>
      <tr><td><b>Sayıldı</b></td><td class="n"><b>${fmtMoney(d.counted)}</b></td></tr>
      <tr><td><b>Fərq</b></td><td class="n"><b class="${d.diff < 0 ? 'yzi-bad' : d.diff > 0 ? 'yzi-ok' : ''}">${d.diff > 0 ? '+' : ''}${fmtMoney(d.diff)}</b></td></tr>
    </tbody></table></div>${d.note ? `<p class="yzi-p"><b>Qeyd:</b> ${esc(d.note)}</p>` : ''}` });
}

/* Təsdiq siyahısı və ümumi sənəd baxışı üçün */
docHooks.cash = {
  open: openCashDoc,
  side: (d) => d.dir === 'transfer' ? `${accName(d.accountId)} → ${accName(d.toAccountId)}` : `${accName(d.accountId)} · ${d.category || ''}${d.counterparty ? ' · ' + d.counterparty : ''}`,
  amount: (d) => `<span class="${d.dir === 'out' ? 'yzi-bad' : d.dir === 'in' ? 'yzi-ok' : ''}">${d.dir === 'out' ? '−' : d.dir === 'in' ? '+' : ''}${fmtMoney(d.amount)}</span>`
};
docHooks.cashclose = {
  open: openCloseDoc,
  side: (d) => `${accName(d.accountId)} · sayıldı ${fmtMoney(d.counted)}`,
  amount: (d) => `<span class="${d.diff < 0 ? 'yzi-bad' : d.diff > 0 ? 'yzi-ok' : ''}">fərq ${d.diff > 0 ? '+' : ''}${fmtMoney(d.diff)}</span>`
};

/* Test və hesabatlar üçün */
export const _cash = { allMoves, balanceFrom, anchorOf, sinceFor, loadExternal, cache };

registerTab({ id: 'cash', group: 'acc', label: 'Kassa', order: 2, perm: seeCash, render: renderCash, live: ['docs', 'cash'], legacyOk: true });
