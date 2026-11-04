/* ═══════════════════════════════════════════
   YUZA POS — ANBAR: QALIQLAR, SƏNƏDLƏR (silinmə, transfer, sayım, hazırlama),
   TƏSDİQ GÖZLƏYƏNLƏR, HƏRƏKƏTLƏR, SƏRF ANALİZİ (gizli itki)
═══════════════════════════════════════════ */
import { db } from './firebase-service.js';
import { state } from './state.js';
import {
  inv, DOCS, STATUS, PTYPES, WRITEOFF_REASONS, product, productList, warehouseList, whName, stockIn, totalStock, isLow,
  unitCost, docList, pendingDocs, suppliers, can, canCreate, canApprove, createDoc, updateDoc, submitDoc, approveDoc, rejectDoc,
  stornoDoc, deleteDraft, registerPoster, postStockEvent, fmtMoney, fmtQty, fmtDT, toLocalInput, fromLocalInput,
  r2, r3, r4, num, uid, isAdmin, defaultWarehouseId, packsOf
} from './yuza-inv-core.js';
import {
  registerTab, modal, confirmBox, esc, $, ok, fail, numInput, typeChip, attachPicker, whOptions, packOptions, fresh, go, blurIn, docHooks
} from './yuza-inv-ui.js';
import { openPurchaseView, openPaymentEditor } from './yuza-inv-purchase.js';

const STOCK_TYPES = Object.keys(PTYPES).filter(t => PTYPES[t].stock);
const MOVE_LBL = {
  opening: 'İlkin qalıq', purchase: 'Alış', purchase_storno: 'Alış storno', purchase_return: 'Təchizatçıya qaytarma', purchase_return_storno: 'Qaytarma storno',
  sale: 'Satış', sale_return: 'Satış ləğvi', writeoff: 'Silinmə', writeoff_storno: 'Silinmə storno',
  transfer_out: 'Transfer (çıxış)', transfer_in: 'Transfer (giriş)', transfer_storno: 'Transfer storno',
  count_adj: 'Sayım fərqi', count_storno: 'Sayım storno', production_use: 'Hazırlama (sərf)', production_out: 'Hazırlama (çıxış)', production_storno: 'Hazırlama storno'
};

/* ═══ YAZILIŞ QAYDALARI ═══ */
const linesOf = (doc) => Object.values(doc.lines || {});
registerPoster('writeoff', {
  async post(doc, id) {
    await postStockEvent({ type: 'writeoff', whId: doc.whId, at: doc.at, note: doc.reason, ref: { docKind: 'writeoff', docId: id, no: doc.no },
      lines: linesOf(doc).map(l => ({ pid: l.pid, qty: -l.qty, cost: unitCost(l.pid) })) });
  },
  async unpost(doc, id) {
    await postStockEvent({ type: 'writeoff_storno', whId: doc.whId, ref: { docKind: 'writeoff', docId: id, no: doc.no },
      lines: linesOf(doc).map(l => ({ pid: l.pid, qty: l.qty })) });
  }
});
registerPoster('transfer', {
  async post(doc, id) {
    if (doc.fromWh === doc.toWh) throw new Error('Eyni anbara transfer olmaz');
    const ref = { docKind: 'transfer', docId: id, no: doc.no };
    await postStockEvent({ type: 'transfer_out', whId: doc.fromWh, at: doc.at, ref, lines: linesOf(doc).map(l => ({ pid: l.pid, qty: -l.qty })) });
    await postStockEvent({ type: 'transfer_in', whId: doc.toWh, at: doc.at, ref, lines: linesOf(doc).map(l => ({ pid: l.pid, qty: l.qty })) });
  },
  async unpost(doc, id) {
    const ref = { docKind: 'transfer', docId: id, no: doc.no };
    await postStockEvent({ type: 'transfer_storno', whId: doc.toWh, ref, lines: linesOf(doc).map(l => ({ pid: l.pid, qty: -l.qty })) });
    await postStockEvent({ type: 'transfer_storno', whId: doc.fromWh, ref, lines: linesOf(doc).map(l => ({ pid: l.pid, qty: l.qty })) });
  }
});
registerPoster('count', {
  async post(doc, id) {
    const diffs = linesOf(doc).filter(l => l.counted !== null && l.counted !== undefined && Math.abs(r3(l.counted - l.expected)) > 0.0001);
    await postStockEvent({ type: 'count_adj', whId: doc.whId, at: doc.at, ref: { docKind: 'count', docId: id, no: doc.no }, note: 'Sayım fərqi',
      lines: diffs.map(l => ({ pid: l.pid, qty: r3(l.counted - l.expected), cost: unitCost(l.pid) })) });
  },
  async unpost(doc, id) {
    const diffs = linesOf(doc).filter(l => l.counted !== null && l.counted !== undefined && Math.abs(r3(l.counted - l.expected)) > 0.0001);
    await postStockEvent({ type: 'count_storno', whId: doc.whId, ref: { docKind: 'count', docId: id, no: doc.no },
      lines: diffs.map(l => ({ pid: l.pid, qty: -r3(l.counted - l.expected) })) });
  }
});
registerPoster('production', {
  async post(doc, id) {
    const ref = { docKind: 'production', docId: id, no: doc.no };
    const use = linesOf(doc);
    const value = use.reduce((s, l) => s + l.qty * unitCost(l.pid), 0);
    await postStockEvent({ type: 'production_use', whId: doc.whId, at: doc.at, ref, lines: use.map(l => ({ pid: l.pid, qty: -l.qty, cost: unitCost(l.pid) })) });
    await postStockEvent({ type: 'production_out', whId: doc.whId, at: doc.at, ref, receipt: true,
      lines: [{ pid: doc.productId, qty: doc.qty, cost: doc.qty > 0 ? r4(value / doc.qty) : 0 }] });
    await db.ref(`${DOCS.production.node}/${id}/value`).set(r2(value));
  },
  async unpost(doc, id) {
    const ref = { docKind: 'production', docId: id, no: doc.no };
    await postStockEvent({ type: 'production_storno', whId: doc.whId, ref, reverseReceipt: true, lines: [{ pid: doc.productId, qty: -doc.qty, cost: doc.qty > 0 ? r4((doc.value || 0) / doc.qty) : 0 }] });
    await postStockEvent({ type: 'production_storno', whId: doc.whId, ref, lines: linesOf(doc).map(l => ({ pid: l.pid, qty: l.qty })) });
  }
});

/* ═══ QALIQLAR ═══ */
const bf = { q: '', wh: '', type: 'all', low: false };
function renderBalances(host) {
  const el = fresh(host); const again = () => renderBalances(host);
  const whs = warehouseList();
  const showCost = can('catalog.cost');
  const q = bf.q.trim().toLowerCase();
  const list = productList({ types: STOCK_TYPES }).filter(p =>
    (bf.type === 'all' || p.type === bf.type) && (!bf.low || isLow(p)) && (!q || String(p.name).toLowerCase().includes(q)));
  const cols = bf.wh ? whs.filter(w => w.id === bf.wh) : whs;
  const total = list.reduce((s, p) => s + (bf.wh ? stockIn(bf.wh, p.id) : totalStock(p.id)) * unitCost(p), 0);
  const low = productList({ types: STOCK_TYPES }).filter(isLow);
  el.innerHTML = `
    <div class="yzi-head"><div><div class="yzi-eyebrow">ANBAR</div><h1 class="yzi-h1">Qalıqlar</h1></div>
      <div class="yzi-actions">
        <button type="button" class="yzi-btn yzi-btn--ghost" data-csv>Excel (CSV) çıxar</button>
        ${low.length ? `<button type="button" class="yzi-btn yzi-btn--ghost" data-order>Sifariş siyahısı (${low.length})</button>` : ''}
      </div></div>
    <div class="yzi-filters">
      <label class="yzi-f yzi-f--inline"><span>Axtarış</span><input type="search" id="yziBQ" value="${esc(bf.q)}" placeholder="Məhsul adı"></label>
      <label class="yzi-f yzi-f--inline"><span>Anbar</span><select id="yziBWh"><option value="">Hamısı (sütun-sütun)</option>${whOptions(bf.wh, { noDefault: true })}</select></label>
      <div class="yzi-pills">${[['all', 'Hamısı'], ...STOCK_TYPES.map(t => [t, PTYPES[t].label])].map(([k, v]) => `<button type="button" data-t="${k}" class="${bf.type === k ? 'is-on' : ''}">${v}</button>`).join('')}
        <button type="button" data-low class="${bf.low ? 'is-on' : ''}">Minimumdan az</button></div>
    </div>
    ${showCost ? `<p class="yzi-p">Göstərilən qalığın maya dəyəri: <b class="yzi-gold">${fmtMoney(total)}</b></p>` : ''}
    <div class="yzi-table-wrap"><table class="yzi-table">
      <thead><tr><th>Məhsul</th><th>Növ</th>${cols.map(w => `<th class="n">${esc(w.name)}</th>`).join('')}${!bf.wh && cols.length > 1 ? '<th class="n">Cəmi</th>' : ''}<th class="n">Min</th>${showCost ? '<th class="n">Maya</th><th class="n">Dəyər</th>' : ''}</tr></thead>
      <tbody>${list.map(p => {
        const tq = bf.wh ? stockIn(bf.wh, p.id) : totalStock(p.id);
        return `<tr class="${isLow(p) ? 'is-low' : ''}"><td><b>${esc(p.name)}</b> <small class="mut">${esc(p.unit || '')}</small></td><td>${typeChip(p.type)}</td>
          ${cols.map(w => { const v = stockIn(w.id, p.id); return `<td class="n ${v < 0 ? 'yzi-bad' : ''}">${fmtQty(v)}</td>`; }).join('')}
          ${!bf.wh && cols.length > 1 ? `<td class="n"><b class="${tq < 0 ? 'yzi-bad' : ''}">${fmtQty(tq)}</b></td>` : ''}
          <td class="n mut">${p.minQty ? fmtQty(p.minQty) : '—'}</td>
          ${showCost ? `<td class="n mut">${fmtMoney(unitCost(p))}</td><td class="n">${fmtMoney(tq * unitCost(p))}</td>` : ''}</tr>`;
      }).join('') || `<tr><td colspan="9" class="yzi-empty">Məhsul tapılmadı.</td></tr>`}</tbody></table></div>`;
  el.querySelector('#yziBQ').addEventListener('input', (e) => { bf.q = e.target.value; const p = e.target.selectionStart; again(); const i = $('yziBQ'); i.focus(); i.setSelectionRange(p, p); });
  el.querySelector('#yziBWh').addEventListener('change', (e) => { bf.wh = e.target.value; again(); });
  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-t]'); if (t) { bf.type = t.dataset.t; again(); return; }
    if (e.target.closest('[data-low]')) { bf.low = !bf.low; again(); return; }
    if (e.target.closest('[data-csv]')) { exportCsv(list, cols, showCost); return; }
    if (e.target.closest('[data-order]')) orderList(low);
  });
}
function exportCsv(list, cols, showCost) {
  const head = ['Məhsul', 'Növ', 'Vahid', ...cols.map(w => w.name), 'Cəmi', ...(showCost ? ['Maya', 'Dəyər'] : [])];
  const rows = list.map(p => [p.name, PTYPES[p.type]?.label, p.unit, ...cols.map(w => fmtQty(stockIn(w.id, p.id))), fmtQty(totalStock(p.id)),
    ...(showCost ? [r2(unitCost(p)), r2(totalStock(p.id) * unitCost(p))] : [])]);
  const csv = '﻿' + [head, ...rows].map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `qaliqlar-${fmtDT(Date.now()).replace(/[ :.]/g, '-')}.csv`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function orderList(low) {
  const bySup = {};
  low.forEach(p => {
    const need = Math.max(Number(p.reorderQty) || 0, (Number(p.minQty) || 0) * 2 - totalStock(p.id));
    const sid = p.lastSupplierId || '_';
    (bySup[sid] = bySup[sid] || []).push({ p, need: r3(need) });
  });
  const supName = (sid) => sid === '_' ? 'Təchizatçı məlum deyil' : suppliers[sid]?.name || 'Təchizatçı';
  const text = Object.entries(bySup).map(([sid, arr]) => `${supName(sid)}:\n` + arr.map(x => `- ${x.p.name}: ${fmtQty(x.need)} ${x.p.unit || ''}`).join('\n')).join('\n\n');
  modal({ title: 'Sifariş siyahısı (minimumdan az olanlar)', body: `
    ${Object.entries(bySup).map(([sid, arr]) => `<h3 class="yzi-h3">${esc(supName(sid))}</h3>${arr.map(x => `<div class="yzi-row"><span>${esc(x.p.name)} <small class="mut">qalıq ${fmtQty(totalStock(x.p.id))} · min ${fmtQty(x.p.minQty)}</small></span><b>${fmtQty(x.need)} ${esc(x.p.unit || '')}</b></div>`).join('')}`).join('')}
    <p class="yzi-hint">Miqdar: kartdakı "sifariş miqdarı" və ya minimumun iki qatına çatdıran miqdar. Mətni kopyalayıb WhatsApp ilə göndərə bilərsiniz.</p>`,
    actions: [{ label: 'Bağla', cancel: true, cls: 'yzi-btn--ghost' }, { label: 'Mətni kopyala', cls: 'yzi-btn--gold', close: false, onClick: async () => { await navigator.clipboard.writeText(text); ok('Kopyalandı'); } }] });
}

/* ═══ SƏNƏD SİYAHILARI ═══
   Eyni siyahı komponenti bir neçə bölmədə istifadə olunur:
   Sayım · Silinmə və transfer · Hazırlama · Təchizatçı ödənişləri */
const KINDS_STOCK = ['writeoff', 'transfer', 'count', 'production', 'payment', 'preturn', 'cash'];
const LISTS = {
  count:      { kinds: ['count'],                eyebrow: 'MÜHASİBAT · ANBAR', title: 'Sayım (inventarizasiya)', news: [['count', 'Yeni sayım', true]] },
  stockdocs:  { kinds: ['writeoff', 'transfer'], eyebrow: 'MÜHASİBAT · ANBAR', title: 'Silinmə və transfer',     news: [['writeoff', 'Silinmə aktı', true], ['transfer', 'Transfer', false]] },
  production: { kinds: ['production'],           eyebrow: 'MÜHASİBAT · ANBAR', title: 'Hazırlama aktları',       news: [['production', 'Hazırlama aktı', true]] },
  payments:   { kinds: ['payment'],              eyebrow: 'MÜHASİBAT · PUL',   title: 'Təchizatçı ödənişləri',   news: [['payment', 'Ödəniş et', true]] }
};
const sfs = {};
function renderDocList(host, key) {
  const cfg = LISTS[key];
  const sf = sfs[key] = sfs[key] || { kind: 'all', st: 'all' };
  const el = fresh(host); const again = () => renderDocList(host, key);
  const kinds = cfg.kinds;
  const all = kinds.flatMap(k => docList(k).map(d => ({ ...d, kind: k })))
    .filter(d => (sf.kind === 'all' || d.kind === sf.kind) && (sf.st === 'all' || d.status === sf.st))
    .sort((a, b) => (b.at || b.createdAt || 0) - (a.at || a.createdAt || 0));
  const newBtns = cfg.news.filter(([k]) => canCreate(k) || canApprove(k));
  el.innerHTML = `
    <div class="yzi-head"><div><div class="yzi-eyebrow">${cfg.eyebrow}</div><h1 class="yzi-h1">${cfg.title}</h1></div>
      <div class="yzi-actions">${newBtns.map(([k, v, main]) => `<button type="button" class="yzi-btn ${main ? 'yzi-btn--gold' : 'yzi-btn--ghost'}" data-new="${k}">+ ${v}</button>`).join('')}</div></div>
    <div class="yzi-filters">
      ${kinds.length > 1 ? `<div class="yzi-pills"><button type="button" data-k="all" class="${sf.kind === 'all' ? 'is-on' : ''}">Hamısı</button>
        ${kinds.map(k => `<button type="button" data-k="${k}" class="${sf.kind === k ? 'is-on' : ''}">${DOCS[k].label}</button>`).join('')}</div>` : ''}
      <div class="yzi-pills">${['all', 'draft', 'pending', 'approved', 'rejected', 'storno'].filter(s => s !== 'draft' || kinds.includes('count')).map(s => `<button type="button" data-s="${s}" class="${sf.st === s ? 'is-on' : ''}">${s === 'all' ? 'Bütün statuslar' : STATUS[s].label}</button>`).join('')}</div></div>
    <div class="yzi-table-wrap"><table class="yzi-table">
      <thead><tr><th>Tarix</th><th>Sənəd</th>${kinds.length > 1 ? '<th>Növ</th>' : ''}<th>${key === 'payments' ? 'Təchizatçı' : 'Anbar / izah'}</th><th class="n">${key === 'count' ? 'Fərq' : 'Məbləğ'}</th><th>Yazan</th><th>Status</th></tr></thead>
      <tbody>${all.map(d => `<tr data-open="${d.id}" data-kind="${d.kind}" tabindex="0" class="${d.status === 'storno' ? 'is-void' : ''}">
        <td>${fmtDT(d.at || d.createdAt)}</td><td><b class="yzi-mono">${esc(d.no)}</b></td>${kinds.length > 1 ? `<td>${DOCS[d.kind].label}</td>` : ''}
        <td class="mut">${esc(sideOf(d))}</td><td class="n">${docAmount(d)}</td><td class="mut">${esc(d.createdByName || '')}</td>
        <td><span class="yzi-st yzi-st--${STATUS[d.status]?.cls}">${STATUS[d.status]?.label || d.status}</span></td></tr>`).join('') || `<tr><td colspan="7" class="yzi-empty">Sənəd yoxdur.</td></tr>`}</tbody></table></div>`;
  el.addEventListener('click', (e) => {
    const k = e.target.closest('[data-k]'); if (k) { sf.kind = k.dataset.k; again(); return; }
    const s = e.target.closest('[data-s]'); if (s) { sf.st = s.dataset.s; again(); return; }
    const n = e.target.closest('[data-new]'); if (n) { n.dataset.new === 'payment' ? openPaymentEditor(null, {}) : openEditor(n.dataset.new); return; }
    const r = e.target.closest('[data-open]'); if (r) openDoc(r.dataset.kind, r.dataset.open);
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('[data-open]')) openDoc(e.target.dataset.kind, e.target.dataset.open); });
}
function sideOf(d) {
  if (docHooks[d.kind]?.side) return docHooks[d.kind].side(d);
  if (d.kind === 'transfer') return `${whName(d.fromWh)} → ${whName(d.toWh)}`;
  if (d.kind === 'payment' || d.kind === 'preturn') return d.supplierName || '';
  if (d.kind === 'production') return `${whName(d.whId)} · ${d.productName || ''}`;
  return whName(d.whId) + (d.reason ? ' · ' + d.reason : '');
}
function docAmount(d) {
  if (docHooks[d.kind]?.amount) return docHooks[d.kind].amount(d);
  if (d.kind === 'payment') return fmtMoney(d.amount);
  if (d.kind === 'preturn') return fmtMoney(d.totals?.gross);
  if (d.kind === 'count') { const v = countValue(d); return d.status === 'approved' || can('stock.count.approve') ? `<span class="${v < 0 ? 'yzi-bad' : v > 0 ? 'yzi-ok' : ''}">${v > 0 ? '+' : ''}${fmtMoney(v)}</span>` : '—'; }
  if (d.kind === 'production') return d.value ? fmtMoney(d.value) : '—';
  const v = linesOf(d).reduce((s, l) => s + l.qty * unitCost(l.pid), 0);
  return can('catalog.cost') ? fmtMoney(v) : '—';
}
const countValue = (d) => r2(linesOf(d).reduce((s, l) => s + ((l.counted ?? l.expected) - l.expected) * unitCost(l.pid), 0));

/* ═══ SƏNƏD BAXIŞI (ümumi) ═══ */
export function openDoc(kind, id) {
  if (docHooks[kind]?.open) { docHooks[kind].open(id); return; }
  if (kind === 'purchase' || kind === 'preturn') { openPurchaseView(id, kind); return; }
  const d = docList(kind).find(x => x.id === id); if (!d) return;
  const mine = d.createdBy === uid() || isAdmin();
  if (['draft', 'rejected'].includes(d.status) && mine) { openEditor(kind, id); return; }
  if (kind === 'count' && d.status === 'draft') { openEditor(kind, id); return; }
  const st = STATUS[d.status] || {};
  const acts = [{ label: 'Bağla', cancel: true, cls: 'yzi-btn--ghost' }];
  if (['pending', 'rejected', 'draft'].includes(d.status) && mine) acts.push({ label: 'Sil', cls: 'yzi-btn--ghost yzi-btn--left', onClick: async () => { if (!await confirmBox(`${esc(d.no)} silinsin?`, { okLabel: 'Sil', okCls: 'yzi-btn--red' })) return false; await deleteDraft(kind, id); ok('Silindi'); } });
  if (d.status === 'pending' && mine && kind !== 'payment') acts.push({ label: 'Redaktə', cls: 'yzi-btn--ghost', onClick: () => { setTimeout(() => openEditor(kind, id), 10); } });
  if (d.status === 'pending' && canApprove(kind, d)) {
    acts.push({ label: 'Rədd et', cls: 'yzi-btn--ghost', onClick: async () => { const r = await confirmBox('Rədd səbəbi?', { input: 'Səbəb', okLabel: 'Rədd et', okCls: 'yzi-btn--red' }); if (!r) return false; await rejectDoc(kind, id, r); ok('Rədd edildi'); } });
    acts.push({ label: 'Təsdiqlə', cls: 'yzi-btn--gold', onClick: async () => { await approveDoc(kind, id); ok('Təsdiqləndi'); } });
  }
  if (d.status === 'approved' && (can(DOCS[kind].storno) || isAdmin())) acts.push({ label: 'Storno', cls: 'yzi-btn--red', onClick: async () => {
    const r = await confirmBox(`${esc(d.no)} storno edilsin? Bütün təsiri geri alınacaq.`, { input: 'Storno səbəbi', okLabel: 'Storno et', okCls: 'yzi-btn--red' });
    if (!r) return false; await stornoDoc(kind, id, r); ok('Storno edildi');
  } });
  const showCost = can('catalog.cost');
  const approverView = canApprove(kind, d) || d.status !== 'pending' || isAdmin();
  let table = '';
  if (kind === 'count') {
    table = `<table class="yzi-table yzi-table--mini"><thead><tr><th>Məhsul</th>${approverView ? '<th class="n">Sistemdə</th>' : ''}<th class="n">Sayıldı</th>${approverView ? `<th class="n">Fərq</th>${showCost ? '<th class="n">Məbləğ</th>' : ''}` : ''}</tr></thead><tbody>
      ${linesOf(d).filter(l => !approverView || l.counted !== null).map(l => { const df = r3((l.counted ?? l.expected) - l.expected); return `<tr class="${Math.abs(df) > 0.0001 ? (df < 0 ? 'is-low' : 'is-plus') : ''}"><td><b>${esc(l.name)}</b> <small class="mut">${esc(l.unit || '')}</small></td>${approverView ? `<td class="n">${fmtQty(l.expected)}</td>` : ''}<td class="n">${l.counted === null || l.counted === undefined ? '—' : fmtQty(l.counted)}</td>
        ${approverView ? `<td class="n"><b class="${df < 0 ? 'yzi-bad' : df > 0 ? 'yzi-ok' : 'mut'}">${df > 0 ? '+' : ''}${fmtQty(df)}</b></td>${showCost ? `<td class="n">${fmtMoney(df * unitCost(l.pid))}</td>` : ''}` : ''}</tr>`; }).join('')}
      </tbody>${approverView && showCost ? `<tfoot><tr><td colspan="4">Yekun fərq (çatışmazlıq − / artıq +)</td><td class="n"><b>${fmtMoney(countValue(d))}</b></td></tr></tfoot>` : ''}</table>
      ${linesOf(d).some(l => l.counted === null || l.counted === undefined) ? `<p class="yzi-hint">${linesOf(d).filter(l => l.counted === null || l.counted === undefined).length} məhsul sayılmayıb — onların qalığı dəyişməyəcək.</p>` : ''}`;
  } else if (kind === 'payment') {
    table = `<div class="yzi-row"><span>Təchizatçı</span><b>${esc(d.supplierName)}</b></div><div class="yzi-row"><span>Məbləğ</span><b class="yzi-gold">${fmtMoney(d.amount)}</b></div>
      <div class="yzi-row"><span>Üsul</span><b>${esc({ cash: 'Nağd (kassa)', transfer: 'Bank köçürməsi', card: 'Kart' }[d.method] || d.method)}</b></div>
      ${Object.entries(d.allocations || {}).map(([pid, a]) => `<div class="yzi-row"><span class="mut">Qaimə ${esc(docList('purchase').find(x => x.id === pid)?.no || pid)}</span><b>${fmtMoney(a)}</b></div>`).join('')}`;
  } else {
    table = `<table class="yzi-table yzi-table--mini"><thead><tr><th>Məhsul</th><th class="n">Miqdar</th>${showCost ? '<th class="n">Maya</th><th class="n">Dəyər</th>' : ''}</tr></thead><tbody>
      ${linesOf(d).map(l => `<tr><td><b>${esc(l.name)}</b></td><td class="n">${fmtQty(l.qty)} ${esc(l.unit || '')}</td>${showCost ? `<td class="n mut">${fmtMoney(unitCost(l.pid))}</td><td class="n">${fmtMoney(l.qty * unitCost(l.pid))}</td>` : ''}</tr>`).join('')}
      </tbody></table>`;
  }
  modal({ title: `${DOCS[kind].label} ${esc(d.no)}`, wide: true, actions: acts, body: `
    <div class="yzi-docmeta">
      <div><small>Status</small><b><span class="yzi-st yzi-st--${st.cls}">${st.label}</span></b></div>
      <div><small>Tarix</small><b>${fmtDT(d.at)}</b></div>
      <div><small>Anbar</small><b>${esc(sideOf(d))}</b></div>
      ${kind === 'production' ? `<div><small>Hazırlanan</small><b>${fmtQty(d.qty)} ${esc(product(d.productId)?.unit || '')} ${esc(d.productName)}</b></div>` : ''}
      <div><small>Yazan</small><b>${esc(d.createdByName || '—')}</b><small>${fmtDT(d.createdAt)}</small></div>
      ${d.approvedAt ? `<div><small>Təsdiq edən</small><b>${esc(d.approvedByName)}</b><small>${fmtDT(d.approvedAt)}</small></div>` : ''}
      ${d.rejectReason ? `<div><small>Rədd səbəbi</small><b>${esc(d.rejectReason)}</b></div>` : ''}
      ${d.stornoAt ? `<div><small>Storno</small><b>${esc(d.stornoBy)}</b><small>${fmtDT(d.stornoAt)} · ${esc(d.stornoReason)}</small></div>` : ''}
    </div>
    ${d.postError ? `<p class="yzi-warnbox"><b>Yazılış xətası:</b> ${esc(d.postError)}</p>` : ''}
    <div class="yzi-table-wrap">${table}</div>${d.note ? `<p class="yzi-p"><b>Qeyd:</b> ${esc(d.note)}</p>` : ''}` });
}

/* ═══ REDAKTORLAR ═══ */
export function openEditor(kind, id) {
  if (kind === 'count') { openCount(id); return; }
  const old = id ? docList(kind).find(x => x.id === id) : null;
  const d = old ? JSON.parse(JSON.stringify(old)) : { at: Date.now(), whId: defaultWarehouseId(), fromWh: defaultWarehouseId(), toWh: '', reason: WRITEOFF_REASONS[0], note: '', lines: {}, productId: '', qty: '' };
  let lines = linesOf(d).map(l => ({ ...l, _k: Math.random().toString(36).slice(2) }));
  const canAp = canApprove(kind, old || { createdBy: uid() });
  const m = modal({ title: (old ? esc(old.no) + ' — ' : 'Yeni ') + DOCS[kind].label.toLowerCase(), wide: true, body: '<div id="yziSE"></div>', actions: [
    { label: 'Ləğv', cancel: true, cls: 'yzi-btn--ghost' },
    { label: 'Təsdiqə göndər', cls: canAp ? 'yzi-btn--ghost' : 'yzi-btn--gold', onClick: () => save(false) },
    ...(canAp ? [{ label: 'Təsdiqlə', cls: 'yzi-btn--gold', onClick: () => save(true) }] : [])
  ] });
  const root = m.body.querySelector('#yziSE');
  const showCost = can('catalog.cost');
  function srcWh() { return kind === 'transfer' ? d.fromWh : d.whId; }
  function recalcProduction() {
    const p = product(d.productId); const q = Number(d.qty) || 0;
    if (!p) { lines = []; return; }
    const k = q / (Number(p.yieldQty) || 1);
    lines = Object.entries(p.recipe || {}).map(([cid, l]) => ({ _k: cid, pid: cid, name: product(cid)?.name || '?', unit: product(cid)?.unit || '', qty: r4((Number(l.gross) || 0) * k) }));
  }
  function draw() {
    blurIn(root);
    const value = lines.reduce((s, l) => s + (Number(l.qty) || 0) * unitCost(l.pid), 0);
    root.innerHTML = `
      <section class="yzi-card yzi-grid3">
        <label class="yzi-f"><span>Tarix və saat</span><input type="datetime-local" id="yziSeAt" value="${toLocalInput(d.at)}"></label>
        ${kind === 'transfer'
          ? `<label class="yzi-f"><span>Haradan</span><select id="yziSeFrom">${whOptions(d.fromWh)}</select></label><label class="yzi-f"><span>Haraya</span><select id="yziSeTo"><option value="">— seçin —</option>${whOptions(d.toWh, { noDefault: true })}</select></label>`
          : `<label class="yzi-f"><span>Anbar</span><select id="yziSeWh">${whOptions(d.whId)}</select></label>`}
        ${kind === 'writeoff' ? `<label class="yzi-f"><span>Səbəb *</span><select id="yziSeReason">${WRITEOFF_REASONS.map(r => `<option${r === d.reason ? ' selected' : ''}>${esc(r)}</option>`).join('')}</select></label>` : ''}
        ${kind === 'production' ? `<label class="yzi-f"><span>Hazırlanan yarımfabrikat *</span><select id="yziSeProd"><option value="">— seçin —</option>${productList({ types: ['semi'] }).filter(p => p.recipe).map(p => `<option value="${p.id}"${p.id === d.productId ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
          <label class="yzi-f"><span>Miqdar (${esc(product(d.productId)?.unit || '')})</span>${numInput('id="yziSeQty"', d.qty)}</label>` : ''}
      </section>
      <div class="yzi-table-wrap"><table class="yzi-table yzi-table--lines"><thead><tr><th>Məhsul</th><th class="n">Qalıq (${esc(whName(srcWh()))})</th><th class="n">Miqdar</th>${showCost ? '<th class="n">Maya</th><th class="n">Dəyər</th>' : ''}<th></th></tr></thead><tbody>
        ${lines.map(l => { const st = stockIn(srcWh(), l.pid); const over = Number(l.qty) > st + 0.0001; return `<tr class="${over ? 'is-jump' : ''}"><td><b>${esc(l.name)}</b> <small class="mut">${esc(l.unit || '')}</small>${over ? '<br><small class="yzi-warn">Qalıqdan çoxdur — qalıq mənfiyə düşəcək</small>' : ''}</td>
          <td class="n mut">${fmtQty(st)}</td>
          <td class="n">${kind === 'production' ? fmtQty(l.qty) : numInput(`data-l="${l._k}" class="yzi-n"`, l.qty)}</td>
          ${showCost ? `<td class="n mut">${fmtMoney(unitCost(l.pid))}</td><td class="n">${fmtMoney((Number(l.qty) || 0) * unitCost(l.pid))}</td>` : ''}
          <td>${kind === 'production' ? '' : `<button type="button" class="yzi-x" data-del="${l._k}" aria-label="Sil">✕</button>`}</td></tr>`; }).join('')}
        ${kind === 'production' ? '' : `<tr><td colspan="6"><input type="text" id="yziSeAdd" class="yzi-dashed" placeholder="+ Məhsul əlavə et (ad və ya barkod)…"></td></tr>`}
      </tbody>${showCost ? `<tfoot><tr><td colspan="4">${kind === 'production' ? 'Sərf olunan xammalın dəyəri' : 'Cəmi dəyər'}</td><td class="n"><b class="yzi-gold">${fmtMoney(value)}</b></td><td></td></tr></tfoot>` : ''}</table></div>
      ${kind === 'production' && d.productId && Number(d.qty) > 0 && showCost ? `<p class="yzi-p">Hazırlanan 1 ${esc(product(d.productId)?.unit || '')} mayası: <b>${fmtMoney(value / Number(d.qty))}</b></p>` : ''}
      <label class="yzi-f"><span>Qeyd</span><input type="text" id="yziSeNote" value="${esc(d.note || '')}"></label>`;
    bind();
  }
  function collect() {
    const g = (s) => root.querySelector(s);
    d.at = fromLocalInput(g('#yziSeAt')?.value);
    if (g('#yziSeWh')) d.whId = g('#yziSeWh').value;
    if (g('#yziSeFrom')) d.fromWh = g('#yziSeFrom').value;
    if (g('#yziSeTo')) d.toWh = g('#yziSeTo').value;
    if (g('#yziSeReason')) d.reason = g('#yziSeReason').value;
    if (g('#yziSeProd')) d.productId = g('#yziSeProd').value;
    if (g('#yziSeQty')) d.qty = num(g('#yziSeQty').value) || 0;
    d.note = g('#yziSeNote')?.value.trim() || '';
    root.querySelectorAll('[data-l]').forEach(i => { const l = lines.find(x => x._k === i.dataset.l); if (l) { const v = num(i.value); l.qty = Number.isFinite(v) ? r4(v) : 0; } });
    if (kind === 'production') recalcProduction();
  }
  function bind() {
    root.querySelectorAll('select,#yziSeQty').forEach(s => s.addEventListener('change', () => { collect(); draw(); }));
    root.querySelectorAll('[data-l]').forEach(i => i.addEventListener('change', () => { collect(); draw(); }));
    root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { collect(); lines = lines.filter(l => l._k !== b.dataset.del); draw(); }));
    const add = root.querySelector('#yziSeAdd');
    if (add) attachPicker(add, { types: STOCK_TYPES, allowCreate: false, onPick: (p) => {
      collect();
      if (!lines.some(l => l.pid === p.id)) lines.push({ _k: Math.random().toString(36).slice(2), pid: p.id, name: p.name, unit: p.unit, qty: 1 });
      draw(); setTimeout(() => { const i = root.querySelector(`[data-l="${lines[lines.length - 1]._k}"]`); i?.focus(); i?.select(); }, 30);
    } });
  }
  async function save(approve) {
    collect();
    if (kind === 'transfer' && (!d.toWh || d.toWh === d.fromWh)) throw new Error('Fərqli "haraya" anbarı seçin');
    if (kind === 'production' && (!d.productId || !(d.qty > 0))) throw new Error('Yarımfabrikat və miqdar seçin');
    const valid = lines.filter(l => l.pid && Number(l.qty) > 0);
    if (!valid.length) throw new Error('Ən azı bir məhsul sətri olmalıdır');
    const out = {}; valid.forEach((l, i) => { out[i] = { pid: l.pid, name: l.name, unit: product(l.pid)?.unit || l.unit || '', qty: r4(l.qty) }; });
    const data = { at: d.at, note: d.note, lines: out };
    if (kind === 'transfer') { data.fromWh = d.fromWh; data.toWh = d.toWh; }
    else data.whId = d.whId;
    if (kind === 'writeoff') data.reason = d.reason;
    if (kind === 'production') { data.productId = d.productId; data.productName = product(d.productId)?.name || ''; data.qty = r3(d.qty); }
    if (old) { await updateDoc(kind, id, data); await submitDoc(kind, id); if (approve) await approveDoc(kind, id); }
    else await createDoc(kind, data, { approveNow: approve });
    ok(approve ? 'Təsdiqləndi' : 'Təsdiqə göndərildi');
  }
  if (kind === 'production') recalcProduction();
  draw();
}

/* ═══ SAYIM (telefonla, kor sayım) ═══ */
export function openCount(id) {
  if (!id) {
    const m = modal({ title: 'Yeni sayım (inventarizasiya)', body: `
      <label class="yzi-f"><span>Anbar</span><select id="yziCnWh">${whOptions()}</select></label>
      <div class="yzi-f"><span>Nə sayılacaq</span><div class="yzi-seg" id="yziCnScope"><button type="button" data-s="all" class="is-on">Anbardakı bütün mallar</button><button type="button" data-s="cat">Kateqoriya</button></div></div>
      <label class="yzi-f" id="yziCnCatW" hidden><span>Kateqoriya</span><select id="yziCnCat">${[...new Set(productList({ types: STOCK_TYPES }).map(p => p.category).filter(Boolean))].map(c => `<option>${esc(c)}</option>`).join('')}</select></label>
      <p class="yzi-hint">Sayım başlayan an sistemdəki qalıq "gözlənilən" kimi qeyd olunur. Sayan işçi bu rəqəmi görmür (kor sayım). Fərq təsdiqdən sonra qalığa yazılır, sayım zamanı edilən satışlar nəzərə alınır.</p>`,
      actions: [{ label: 'Ləğv', cancel: true, cls: 'yzi-btn--ghost' }, { label: 'Sayımı başlat', cls: 'yzi-btn--gold', onClick: async (b) => {
        const wh = b.querySelector('#yziCnWh').value;
        const scope = b.querySelector('#yziCnScope .is-on').dataset.s;
        const cat = b.querySelector('#yziCnCat').value;
        const list = productList({ types: STOCK_TYPES }).filter(p => scope === 'all' || p.category === cat);
        if (!list.length) throw new Error('Sayılacaq məhsul yoxdur');
        const lines = {}; list.forEach((p, i) => { lines[i] = { pid: p.id, name: p.name, unit: p.unit || '', category: p.category || '', expected: stockIn(wh, p.id), counted: null }; });
        const nid = await createDoc('count', { whId: wh, at: Date.now(), lines, scope: scope === 'all' ? 'Bütün mallar' : cat }, { asDraft: true });
        setTimeout(() => openCount(nid), 50);
      } }] });
    m.body.querySelector('#yziCnScope').addEventListener('click', (e) => { const b = e.target.closest('[data-s]'); if (!b) return; m.body.querySelectorAll('#yziCnScope button').forEach(x => x.classList.toggle('is-on', x === b)); m.body.querySelector('#yziCnCatW').hidden = b.dataset.s !== 'cat'; });
    return;
  }
  const d = docList('count').find(x => x.id === id); if (!d) { setTimeout(() => openCount(id), 400); return; }
  if (d.status !== 'draft') { openDoc('count', id); return; }
  const lines = linesOf(d);
  const blind = !canApprove('count', d);
  let q = '';
  const m = modal({ title: `Sayım ${esc(d.no)} · ${esc(whName(d.whId))}`, wide: true, body: '<div id="yziCn"></div>', actions: [
    { label: 'Bağla', cancel: true, cls: 'yzi-btn--ghost' },
    { label: 'Saxla', cls: 'yzi-btn--ghost', close: false, onClick: async () => { await persist(); ok('Saxlanıldı'); } },
    { label: 'Sayımı bitir → təsdiqə göndər', cls: 'yzi-btn--gold', onClick: async () => {
      await persist();
      const left = lines.filter(l => l.counted === null || l.counted === undefined).length;
      if (left && !await confirmBox(`${left} məhsul sayılmayıb. Onların qalığı dəyişməyəcək. Davam edilsin?`)) return false;
      await submitDoc('count', id); ok('Sayım təsdiqə göndərildi');
    } }
  ] });
  const root = m.body.querySelector('#yziCn');
  async function persist() {
    const upd = {};
    lines.forEach((l, i) => { upd[`lines/${i}/counted`] = l.counted === null || l.counted === undefined ? null : r3(l.counted); });
    await db.ref(`${DOCS.count.node}/${id}`).update({ ...upd, updatedAt: Date.now() });
  }
  function draw() {
    blurIn(root);
    const done = lines.filter(l => l.counted !== null && l.counted !== undefined).length;
    const ql = q.trim().toLowerCase();
    root.innerHTML = `
      <div class="yzi-count-top"><div class="yzi-progress"><div style="width:${lines.length ? Math.round(done / lines.length * 100) : 0}%"></div></div>
        <b>${done} / ${lines.length} sayılıb</b></div>
      <input type="search" id="yziCnQ" class="yzi-big" placeholder="Axtar və ya barkod oxut…" value="${esc(q)}">
      <div class="yzi-count-list">${lines.map((l, i) => ({ l, i })).filter(({ l }) => !ql || l.name.toLowerCase().includes(ql) || String(product(l.pid)?.barcode || '') === ql).map(({ l, i }) => `
        <div class="yzi-count-it${l.counted !== null && l.counted !== undefined ? ' is-done' : ''}">
          <div><b>${esc(l.name)}</b><small class="mut">${esc(l.category || '')}${blind ? '' : ` · sistemdə ${fmtQty(l.expected)}`}</small></div>
          <label class="yzi-count-in"><span class="yzi-sr">${esc(l.name)} sayılan miqdar</span>${numInput(`data-c="${i}" class="yzi-big"`, l.counted)}<span>${esc(l.unit)}</span></label>
        </div>`).join('')}</div>`;
    root.querySelector('#yziCnQ').addEventListener('input', (e) => { q = e.target.value; const p = e.target.selectionStart; draw(); const i = root.querySelector('#yziCnQ'); i.focus(); i.setSelectionRange(p, p); });
    root.querySelectorAll('[data-c]').forEach(i => {
      i.addEventListener('change', () => { const v = num(i.value); lines[i.dataset.c].counted = Number.isFinite(v) && i.value.trim() !== '' ? v : null; i.closest('.yzi-count-it').classList.toggle('is-done', lines[i.dataset.c].counted !== null); updTop(); });
      i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const all = [...root.querySelectorAll('[data-c]')]; const nx = all[all.indexOf(i) + 1]; i.dispatchEvent(new Event('change')); nx?.focus(); nx?.select(); } });
    });
  }
  function updTop() {
    const done = lines.filter(l => l.counted !== null && l.counted !== undefined).length;
    root.querySelector('.yzi-count-top b').textContent = `${done} / ${lines.length} sayılıb`;
    root.querySelector('.yzi-progress div').style.width = (lines.length ? Math.round(done / lines.length * 100) : 0) + '%';
  }
  draw();
}

/* ═══ TƏSDİQ GÖZLƏYƏNLƏR ═══ */
function myPending() { return pendingDocs().filter(d => canApprove(d.kind, d)); }
function renderApprovals(host) {
  const el = fresh(host);
  const list = myPending();
  const mine = pendingDocs().filter(d => d.createdBy === uid());
  el.innerHTML = `
    <div class="yzi-head"><div><div class="yzi-eyebrow">NƏZARƏT</div><h1 class="yzi-h1">Təsdiq gözləyənlər</h1></div></div>
    <p class="yzi-hint">Təsdiqlənməyən sənəd anbara, borca və kassaya <b>yazılmır</b>. Hər sənədə baxıb təsdiqləyin və ya səbəb yazıb rədd edin.</p>
    <div class="yzi-cards">${list.map(d => `<div class="yzi-apcard">
      <div class="yzi-row"><b>${DOCS[d.kind].label}</b><span class="yzi-mono mut">${esc(d.no)}</span></div>
      <div class="mut">${esc(sideOf(d))}</div>
      <div class="yzi-row"><span class="mut">${esc(d.createdByName || '')} · ${fmtDT(d.createdAt)}</span><b>${d.kind === 'purchase' ? fmtMoney(d.totals?.gross) : docAmount(d)}</b></div>
      ${d.postError ? `<div class="yzi-bad"><small>${esc(d.postError)}</small></div>` : ''}
      <div class="yzi-row yzi-row--btns"><button type="button" class="yzi-btn yzi-btn--sm yzi-btn--ghost" data-view="${d.kind}|${d.id}">Bax</button>
        <button type="button" class="yzi-btn yzi-btn--sm yzi-btn--gold" data-ap="${d.kind}|${d.id}">Təsdiqlə</button></div>
    </div>`).join('') || '<p class="yzi-empty">Təsdiq gözləyən sənəd yoxdur.</p>'}</div>
    ${mine.length ? `<h3 class="yzi-h3">Mənim göndərdiklərim (gözləyir)</h3>${mine.map(d => `<div class="yzi-row"><span>${DOCS[d.kind].label} <b class="yzi-mono">${esc(d.no)}</b></span><span class="mut">${fmtDT(d.createdAt)}</span></div>`).join('')}` : ''}`;
  el.addEventListener('click', async (e) => {
    const v = e.target.closest('[data-view]'); if (v) { const [k, id] = v.dataset.view.split('|'); openDoc(k, id); return; }
    const a = e.target.closest('[data-ap]');
    if (a) { const [k, id] = a.dataset.ap.split('|'); a.disabled = true; try { await approveDoc(k, id); ok('Təsdiqləndi'); } catch (er) { fail(er.message); a.disabled = false; } }
  });
}

/* ═══ HƏRƏKƏTLƏR ═══ */
const mf = { from: Date.now() - 7 * 86400000, to: Date.now(), pid: '', type: '', wh: '' };
async function renderMoves(host) {
  const el = fresh(host);
  el.innerHTML = '<p class="yzi-empty">Yüklənir…</p>';
  const snap = await db.ref('stockMoves').orderByChild('at').startAt(mf.from).endAt(mf.to).limitToLast(1500).once('value');
  const evs = Object.entries(snap.val() || {}).map(([id, e]) => ({ id, ...e })).sort((a, b) => (b.at || 0) - (a.at || 0));
  const rows = [];
  evs.forEach(e => Object.values(e.lines || {}).forEach(l => {
    if (mf.pid && l.pid !== mf.pid) return;
    if (mf.type && !String(e.type).startsWith(mf.type)) return;
    if (mf.wh && e.whId !== mf.wh) return;
    rows.push({ e, l });
  }));
  const showCost = can('catalog.cost');
  el.innerHTML = `
    <div class="yzi-head"><div><div class="yzi-eyebrow">ANBAR</div><h1 class="yzi-h1">Hərəkətlər jurnalı</h1></div></div>
    <div class="yzi-filters">
      <label class="yzi-f yzi-f--inline"><span>Başlanğıc</span><input type="datetime-local" id="yziMvFrom" value="${toLocalInput(mf.from)}"></label>
      <label class="yzi-f yzi-f--inline"><span>Son</span><input type="datetime-local" id="yziMvTo" value="${toLocalInput(mf.to)}"></label>
      <label class="yzi-f yzi-f--inline"><span>Anbar</span><select id="yziMvWh"><option value="">Hamısı</option>${whOptions(mf.wh, { noDefault: true })}</select></label>
      <label class="yzi-f yzi-f--inline"><span>Növ</span><select id="yziMvType"><option value="">Hamısı</option>${[['purchase', 'Alış'], ['sale', 'Satış'], ['writeoff', 'Silinmə'], ['transfer', 'Transfer'], ['count', 'Sayım'], ['production', 'Hazırlama'], ['opening', 'İlkin qalıq']].map(([k, v]) => `<option value="${k}"${mf.type === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="yzi-f yzi-f--inline"><span>Məhsul</span><select id="yziMvP"><option value="">Hamısı</option>${productList({ types: STOCK_TYPES }).map(p => `<option value="${p.id}"${p.id === mf.pid ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
    </div>
    <div class="yzi-table-wrap"><table class="yzi-table yzi-table--mini">
      <thead><tr><th>Tarix</th><th>Növ</th><th>Anbar</th><th>Məhsul</th><th class="n">Miqdar</th>${showCost ? '<th class="n">Dəyər</th>' : ''}<th>Sənəd / izah</th><th>Kim</th></tr></thead>
      <tbody>${rows.slice(0, 800).map(({ e, l }) => `<tr><td>${fmtDT(e.at)}</td><td>${MOVE_LBL[e.type] || e.type}</td><td class="mut">${esc(whName(e.whId))}</td><td><b>${esc(l.name)}</b></td>
        <td class="n ${l.qty < 0 ? 'yzi-bad' : 'yzi-ok'}">${l.qty > 0 ? '+' : ''}${fmtQty(l.qty)} ${esc(l.unit || '')}</td>${showCost ? `<td class="n">${fmtMoney(l.qty * (l.cost || 0))}</td>` : ''}
        <td class="mut">${esc(e.ref?.no || e.ref?.product || '')}${e.note ? ' · ' + esc(e.note) : ''}</td><td class="mut">${esc(e.byName || '')}</td></tr>`).join('') || `<tr><td colspan="8" class="yzi-empty">Bu aralıqda hərəkət yoxdur.</td></tr>`}</tbody></table></div>
    ${rows.length > 800 ? '<p class="yzi-hint">Yalnız ilk 800 sətir göstərilir — aralığı daraldın.</p>' : ''}`;
  const re = () => renderMoves(host);
  el.querySelector('#yziMvFrom').addEventListener('change', (e) => { mf.from = fromLocalInput(e.target.value); re(); });
  el.querySelector('#yziMvTo').addEventListener('change', (e) => { mf.to = fromLocalInput(e.target.value); re(); });
  el.querySelector('#yziMvWh').addEventListener('change', (e) => { mf.wh = e.target.value; re(); });
  el.querySelector('#yziMvType').addEventListener('change', (e) => { mf.type = e.target.value; re(); });
  el.querySelector('#yziMvP').addEventListener('change', (e) => { mf.pid = e.target.value; re(); });
}

/* ═══ SƏRF ANALİZİ (gizli itki) ═══
   Seçilmiş dövrdə hər məhsul üzrə: alış, satışa görə nəzəri sərf, silinmə, sayım fərqi.
   Sayım çatışmazlığı = heç bir sənədlə izah olunmayan itki (porsiya, oğurluq, qeydsiz xarab). */
const af = { from: new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime(), to: Date.now(), wh: '' };
async function renderAnalysis(host) {
  const el = fresh(host);
  el.innerHTML = '<p class="yzi-empty">Hesablanır…</p>';
  const snap = await db.ref('stockMoves').orderByChild('at').startAt(af.from).endAt(af.to).once('value');
  const by = {};
  const g = (pid, l) => (by[pid] = by[pid] || { pid, name: l.name, unit: l.unit, purchase: 0, sale: 0, writeoff: 0, count: 0, other: 0, saleCost: 0, lossCost: 0, woCost: 0 });
  Object.values(snap.val() || {}).forEach(e => {
    if (af.wh && e.whId !== af.wh) return;
    Object.values(e.lines || {}).forEach(l => {
      const r = g(l.pid, l); const c = (Number(l.cost) || unitCost(l.pid)) * l.qty;
      if (e.type === 'purchase' || e.type === 'purchase_storno' || e.type.startsWith('purchase_return')) r.purchase += l.qty;
      else if (e.type === 'sale' || e.type === 'sale_return') { r.sale += -l.qty; r.saleCost += -c; }
      else if (e.type.startsWith('writeoff')) { r.writeoff += -l.qty; r.woCost += -c; }
      else if (e.type.startsWith('count')) { r.count += l.qty; r.lossCost += c; }
      else r.other += l.qty;
    });
  });
  const rows = Object.values(by).sort((a, b) => a.lossCost - b.lossCost);
  const totalLoss = r2(rows.reduce((s, r) => s + Math.min(0, r.lossCost), 0));
  const totalSurplus = r2(rows.reduce((s, r) => s + Math.max(0, r.lossCost), 0));
  const saleCost = r2(rows.reduce((s, r) => s + r.saleCost, 0));
  const woCost = r2(rows.reduce((s, r) => s + r.woCost, 0));
  const revenue = r2((state.closedOrders || []).filter(o => { const t = o.firstOrderAt || o.closedAt || 0; return t >= af.from && t <= af.to; }).reduce((s, o) => s + (o.total || 0), 0));
  el.innerHTML = `
    <div class="yzi-head"><div><div class="yzi-eyebrow">NƏZARƏT</div><h1 class="yzi-h1">Sərf analizi və gizli itki</h1></div></div>
    <div class="yzi-filters">
      <label class="yzi-f yzi-f--inline"><span>Başlanğıc</span><input type="datetime-local" id="yziAnFrom" value="${toLocalInput(af.from)}"></label>
      <label class="yzi-f yzi-f--inline"><span>Son</span><input type="datetime-local" id="yziAnTo" value="${toLocalInput(af.to)}"></label>
      <label class="yzi-f yzi-f--inline"><span>Anbar</span><select id="yziAnWh"><option value="">Hamısı</option>${whOptions(af.wh, { noDefault: true })}</select></label>
    </div>
    <div class="yzi-kpis">
      <div class="yzi-kpi"><small>Satışın mayası (nəzəri sərf)</small><b>${fmtMoney(saleCost)}</b>${revenue ? `<span>Dövriyyə ${fmtMoney(revenue)} · food cost ${r2(saleCost / revenue * 100)}%</span>` : '<span>dövriyyə məlumatı yalnız admin-də</span>'}</div>
      <div class="yzi-kpi"><small>Sənədli silinmə</small><b class="yzi-warn">${fmtMoney(woCost)}</b><span>xarab, işçi yeməyi və s.</span></div>
      <div class="yzi-kpi yzi-kpi--bad"><small>İzahsız itki (sayım çatışmazlığı)</small><b>${fmtMoney(-totalLoss)}</b><span>porsiya, qeydsiz xarab, oğurluq</span></div>
      <div class="yzi-kpi"><small>Sayım artığı</small><b class="yzi-ok">${fmtMoney(totalSurplus)}</b><span>qeydsiz alış və ya səhv resept</span></div>
    </div>
    <p class="yzi-hint">Hesabatın düzgün olması üçün dövrün sonunda sayım aparılmalı və yeməklərin texnoloji kartı dolu olmalıdır. Ən çox pul itirilən mallar yuxarıdadır.</p>
    <div class="yzi-table-wrap"><table class="yzi-table yzi-table--mini">
      <thead><tr><th>Məhsul</th><th class="n">Alınıb</th><th class="n">Satışa görə sərf</th><th class="n">Silinib</th><th class="n">Sayım fərqi</th><th class="n">İtki ₼</th></tr></thead>
      <tbody>${rows.map(r => `<tr class="${r.lossCost < -0.009 ? 'is-low' : ''}"><td><b>${esc(r.name)}</b> <small class="mut">${esc(r.unit || '')}</small></td>
        <td class="n">${fmtQty(r.purchase)}</td><td class="n">${fmtQty(r.sale)}</td><td class="n">${fmtQty(r.writeoff)}</td>
        <td class="n ${r.count < 0 ? 'yzi-bad' : r.count > 0 ? 'yzi-ok' : 'mut'}">${r.count > 0 ? '+' : ''}${fmtQty(r.count)}</td>
        <td class="n"><b class="${r.lossCost < 0 ? 'yzi-bad' : ''}">${fmtMoney(r.lossCost)}</b></td></tr>`).join('') || '<tr><td colspan="6" class="yzi-empty">Bu dövrdə hərəkət yoxdur.</td></tr>'}</tbody></table></div>`;
  const re = () => renderAnalysis(host);
  el.querySelector('#yziAnFrom').addEventListener('change', (e) => { af.from = fromLocalInput(e.target.value); re(); });
  el.querySelector('#yziAnTo').addEventListener('change', (e) => { af.to = fromLocalInput(e.target.value); re(); });
  el.querySelector('#yziAnWh').addEventListener('change', (e) => { af.wh = e.target.value; re(); });
}

/* ═══ QEYDİYYAT ═══ */
const anyApprove = () => Object.keys(DOCS).some(k => can(DOCS[k].perm + '.approve'));
const kindPerm = (k) => can(DOCS[k].perm + '.create') || can(DOCS[k].perm + '.approve');
const payPerm = () => can('supplier.payment.create') || can('supplier.payment.approve') || can('purchase.approve');
export const myPendingCount = () => myPending().length;
registerTab({ id: 'approvals', group: 'acc', label: 'Təsdiq gözləyənlər', order: 1, perm: anyApprove, render: renderApprovals, live: ['docs'], badge: () => myPending().length });
registerTab({ id: 'payments', group: 'acc', label: 'Təchizatçı ödənişləri', order: 4, perm: payPerm, render: (h) => renderDocList(h, 'payments'), live: ['docs'] });
registerTab({ id: 'balances', group: 'stock', label: 'Qalıqlar', order: 20, perm: () => can('stock.view') || can('catalog.view') || ['writeoff', 'transfer', 'count', 'production'].some(kindPerm), render: renderBalances, live: ['stock', 'products'] });
registerTab({ id: 'count', group: 'stock', label: 'Sayım', order: 21, perm: () => can('stock.view') || kindPerm('count'), render: (h) => renderDocList(h, 'count'), live: ['docs'] });
registerTab({ id: 'stockdocs', group: 'stock', label: 'Silinmə və transfer', order: 22, perm: () => can('stock.view') || kindPerm('writeoff') || kindPerm('transfer'), render: (h) => renderDocList(h, 'stockdocs'), live: ['docs'] });
registerTab({ id: 'production', group: 'stock', label: 'Hazırlama', order: 23, perm: () => can('stock.view') || kindPerm('production'), render: (h) => renderDocList(h, 'production'), live: ['docs'] });
registerTab({ id: 'analysis', group: 'rep', label: 'Sərf analizi', order: 60, perm: () => can('stock.report'), render: renderAnalysis });
registerTab({ id: 'moves', group: 'rep', label: 'Anbar hərəkətləri', order: 61, perm: () => can('stock.report'), render: renderMoves });
