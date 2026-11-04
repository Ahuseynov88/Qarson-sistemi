/* ═══════════════════════════════════════════
   YUZA POS — ANBAR: ALIŞ QAİMƏLƏRİ, TƏCHİZATÇI HESABI, ÖDƏNİŞLƏR
   Axın: Qaralama → Təsdiq gözləyir → Təsdiqlənib (anbara + borca yazılır) → Storno
   Təsdiq: "purchase.approve" icazəsi olan şəxs (admin / mühasib). Təsdiqsiz heç nə yazılmır.
═══════════════════════════════════════════ */
import { db } from './firebase-service.js';
import { state } from './state.js';
import {
  inv, DOCS, STATUS, PTYPES, product, docList, suppliers, supplierList, packsOf, can, canCreate, canApprove,
  createDoc, updateDoc, submitDoc, approveDoc, rejectDoc, stornoDoc, deleteDraft, registerPoster,
  postStockEvent, ledgerPost, fmtMoney, fmtQty, fmtDT, toLocalInput, fromLocalInput, r2, r3, r4, num, uname, uid, isAdmin,
  defaultWarehouseId, whName, totalStock
} from './yuza-inv-core.js';
import {
  registerTab, modal, confirmBox, esc, $, ok, fail, numInput, attachPicker, whOptions, packOptions, fresh, go, blurIn
} from './yuza-inv-ui.js';

const METHODS = { cash: 'Nağd (kassa)', transfer: 'Bank köçürməsi', card: 'Kart' };
const DAY = 86400000;

/* ── Hesablama ── */
export function calcLine(l, priceMode) {
  const qty = Number(l.qty) || 0, price = Number(l.price) || 0, rate = Number(l.vatRate) || 0;
  const amount = qty * price;
  let net, vat, gross;
  if (priceMode === 'incl') { gross = amount; net = rate ? amount / (1 + rate / 100) : amount; vat = gross - net; }
  else { net = amount; vat = net * rate / 100; gross = net + vat; }
  const factor = Number(l.factor) || 1;
  const baseQty = r3(qty * factor);
  const costBasis = inv.settings.vatPayer ? net : gross;
  return { net: r2(net), vat: r2(vat), gross: r2(gross), baseQty, unitCost: baseQty > 0 ? r4(costBasis / baseQty) : 0 };
}
export function calcTotals(lines, priceMode) {
  const t = { net: 0, vat: 0, gross: 0 };
  lines.forEach(l => { const c = calcLine(l, priceMode); t.net += c.net; t.vat += c.vat; t.gross += c.gross; });
  return { net: r2(t.net), vat: r2(t.vat), gross: r2(t.gross) };
}
const docTotal = (d) => Number(d?.totals?.gross) || 0;
const docPaid = (d) => r2(d?.paidAmount || 0);
const docDue = (d) => r2(docTotal(d) - docPaid(d));
function payState(d) {
  if (d.status !== 'approved') return null;
  const due = docDue(d);
  if (due <= 0.009) return { label: 'Ödənilib', cls: 'ok' };
  if (docPaid(d) > 0) return { label: 'Qismən', cls: 'warn' };
  if (d.dueAt && d.dueAt < Date.now()) return { label: 'Vaxtı keçib', cls: 'bad' };
  return { label: 'Ödənilməyib', cls: 'bad' };
}
const seeMoney = () => can('purchase.approve') || can('supplier.manage') || can('supplier.payment.create') || can('supplier.payment.approve');
export function supplierDebt(id) { return r2(suppliers[id]?.totalDebt || 0); }

/* ═══ YAZILIŞ QAYDALARI (təsdiqdə işləyir) ═══ */
registerPoster('purchase', {
  async post(doc, id) {
    const lines = Object.values(doc.lines || {});
    if (!lines.length) throw new Error('Qaimədə mal yoxdur');
    if (!inv.warehouses[doc.whId]) throw new Error('Anbar tapılmadı');
    await postStockEvent({
      type: 'purchase', whId: doc.whId, at: doc.at, receipt: true,
      lines: lines.map(l => ({ pid: l.pid, qty: l.baseQty, cost: l.unitCost })),
      ref: { docKind: 'purchase', docId: id, no: doc.no, supplier: doc.supplierName }
    });
    for (const l of lines) {
      await db.ref('products/' + l.pid).update({ lastCost: l.unitCost, lastCostAt: doc.at || Date.now(), lastSupplierId: doc.supplierId, incomplete: product(l.pid)?.incomplete || null });
      await db.ref(`products/${l.pid}/supplierPrices/${doc.supplierId}`).set({ price: r4(l.price), pack: l.packName || '', factor: l.factor || 1, priceMode: doc.priceMode, at: doc.at || Date.now() });
    }
    await ledgerPost(doc.supplierId, { type: 'purchase', amount: docTotal(doc), docKind: 'purchase', docId: id, docNo: doc.no, invoiceNo: doc.invoiceNo || '', at: doc.at, note: doc.note || '' });
    /* Qaimə ilə birlikdə ödəniş yazılıbsa — ayrıca, təsdiqlənmiş ödəniş sənədi yaranır */
    const payAmt = r2(doc.pay?.amount || 0);
    if (payAmt > 0) {
      const pk = db.ref('invPayments').push();
      const res = await db.ref('invCounters/payment').transaction(c => (Number(c) || 0) + 1);
      const no = `${DOCS.payment.prefix}-${String(res.snapshot.val() || 1).padStart(5, '0')}`;
      const pdoc = {
        kind: 'payment', no, supplierId: doc.supplierId, supplierName: doc.supplierName, amount: payAmt, method: doc.pay.method || 'cash',
        at: doc.at || Date.now(), allocations: { [id]: payAmt }, note: `${doc.no} qaiməsi ilə birlikdə`,
        status: 'approved', createdBy: doc.createdBy, createdByName: doc.createdByName, createdAt: Date.now(),
        approvedBy: uid(), approvedByName: uname(), approvedAt: Date.now(), linkedPurchase: id
      };
      await pk.set(pdoc);
      await paymentEffects(pdoc, pk.key, 1);
    }
  },
  async unpost(doc, id) {
    const lines = Object.values(doc.lines || {});
    await postStockEvent({
      type: 'purchase_storno', whId: doc.whId, reverseReceipt: true,
      lines: lines.map(l => ({ pid: l.pid, qty: -l.baseQty, cost: l.unitCost })),
      ref: { docKind: 'purchase', docId: id, no: doc.no }, note: 'Storno: ' + (doc.stornoReason || '')
    });
    await ledgerPost(doc.supplierId, { type: 'storno', amount: -docTotal(doc), docKind: 'purchase', docId: id, docNo: doc.no, note: 'Qaimə storno edildi' });
  }
});
registerPoster('preturn', {
  async post(doc, id) {
    const lines = Object.values(doc.lines || {});
    await postStockEvent({
      type: 'purchase_return', whId: doc.whId, at: doc.at, reverseReceipt: true,
      lines: lines.map(l => ({ pid: l.pid, qty: -l.baseQty, cost: l.unitCost })),
      ref: { docKind: 'preturn', docId: id, no: doc.no, purchaseId: doc.purchaseId || null }, note: doc.reason || ''
    });
    await ledgerPost(doc.supplierId, { type: 'return', amount: -docTotal(doc), docKind: 'preturn', docId: id, docNo: doc.no, at: doc.at, note: doc.reason || '' });
  },
  async unpost(doc, id) {
    const lines = Object.values(doc.lines || {});
    await postStockEvent({
      type: 'purchase_return_storno', whId: doc.whId, receipt: true,
      lines: lines.map(l => ({ pid: l.pid, qty: l.baseQty, cost: l.unitCost })),
      ref: { docKind: 'preturn', docId: id, no: doc.no }
    });
    await ledgerPost(doc.supplierId, { type: 'storno', amount: docTotal(doc), docKind: 'preturn', docId: id, docNo: doc.no, note: 'Qaytarma storno edildi' });
  }
});
async function paymentEffects(doc, id, sign) {
  await ledgerPost(doc.supplierId, { type: sign > 0 ? 'payment' : 'storno', amount: -sign * r2(doc.amount), docKind: 'payment', docId: id, docNo: doc.no, method: doc.method, at: doc.at, note: doc.note || '' });
  for (const [pid, amt] of Object.entries(doc.allocations || {})) {
    await db.ref(`invPurchases/${pid}/paidAmount`).transaction(c => r2((Number(c) || 0) + sign * Number(amt)));
  }
}
registerPoster('payment', {
  async post(doc, id) {
    if (!(Number(doc.amount) > 0)) throw new Error('Məbləğ sıfırdır');
    await paymentEffects(doc, id, 1);
  },
  async unpost(doc, id) { await paymentEffects(doc, id, -1); }
});

/* ═══ ALIŞLAR SİYAHISI ═══ */
const pf = { q: '', st: 'all', sup: '' };
function renderPurchases(host) {
  const el = fresh(host);
  const again = () => renderPurchases(host);
  const all = docList('purchase').concat(docList('preturn'));
  const now = new Date(); const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const approved = all.filter(d => d.kind === 'purchase' && d.status === 'approved');
  const monthSum = approved.filter(d => (d.at || 0) >= monthStart).reduce((s, d) => s + docTotal(d), 0);
  const debt = supplierList().reduce((s, x) => s + Math.max(0, supplierDebt(x.id)), 0);
  const overdue = approved.filter(d => d.dueAt && d.dueAt < Date.now() && docDue(d) > 0.009);
  const pending = all.filter(d => d.status === 'pending' || d.status === 'draft');
  const q = pf.q.trim().toLowerCase();
  const rows = all.filter(d => {
    if (pf.sup && d.supplierId !== pf.sup) return false;
    if (pf.st === 'draft' && !['draft', 'pending', 'rejected'].includes(d.status)) return false;
    if (pf.st === 'unpaid' && !(d.kind === 'purchase' && d.status === 'approved' && docDue(d) > 0.009)) return false;
    if (pf.st === 'overdue' && !overdue.includes(d)) return false;
    if (pf.st === 'storno' && d.status !== 'storno') return false;
    if (q && !`${d.no} ${d.invoiceNo || ''} ${d.supplierName || ''} ${Object.values(d.lines || {}).map(l => l.name).join(' ')}`.toLowerCase().includes(q)) return false;
    return true;
  });
  el.innerHTML = `
    <div class="yzi-head"><div><div class="yzi-eyebrow">ANBAR · MAL ALIŞI</div><h1 class="yzi-h1">Alış qaimələri</h1></div>
      <div class="yzi-actions">
        ${can('supplier.payment.create') || can('supplier.payment.approve') ? '<button type="button" class="yzi-btn yzi-btn--ghost" data-act="pay">Ödəniş et</button>' : ''}
        ${canCreate('purchase') || canApprove('purchase') ? '<button type="button" class="yzi-btn yzi-btn--gold" data-act="new">+ Yeni qaimə</button>' : ''}
      </div></div>
    <div class="yzi-kpis">
      <div class="yzi-kpi"><small>Bu ay alış</small><b>${fmtMoney(monthSum)}</b><span>${approved.filter(d => (d.at || 0) >= monthStart).length} qaimə</span></div>
      ${seeMoney() ? '' : '<!--'}<div class="yzi-kpi"><small>Təchizatçılara borc</small><b class="yzi-bad">${fmtMoney(debt)}</b><span>${supplierList().filter(s => supplierDebt(s.id) > 0.009).length} təchizatçı</span></div>${seeMoney() ? '' : '-->'}
      <button type="button" class="yzi-kpi yzi-kpi--btn${pf.st === 'overdue' ? ' is-on' : ''}" data-st="overdue"><small>Ödəniş vaxtı keçib</small><b class="${overdue.length ? 'yzi-warn' : ''}">${fmtMoney(overdue.reduce((s, d) => s + docDue(d), 0))}</b><span>${overdue.length} qaimə</span></button>
      <button type="button" class="yzi-kpi yzi-kpi--btn${pf.st === 'draft' ? ' is-on' : ''}" data-st="draft"><small>Təsdiq gözləyən / qaralama</small><b>${pending.length}</b><span>anbara hələ yazılmayıb</span></button>
    </div>
    <div class="yzi-filters">
      <label class="yzi-f yzi-f--inline"><span>Axtarış</span><input type="search" id="yziPQ" placeholder="Qaimə №, təchizatçı, mal" value="${esc(pf.q)}"></label>
      <label class="yzi-f yzi-f--inline"><span>Təchizatçı</span><select id="yziPSup"><option value="">Hamısı</option>${supplierList().map(s => `<option value="${s.id}"${s.id === pf.sup ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
      <div class="yzi-pills">
        ${[['all', 'Hamısı'], ['draft', 'Təsdiqsiz'], ['unpaid', 'Ödənilməyib'], ['overdue', 'Vaxtı keçib'], ['storno', 'Storno']].map(([k, v]) => `<button type="button" data-st="${k}" class="${pf.st === k ? 'is-on' : ''}">${v}</button>`).join('')}
        <button type="button" data-act="legacy">Köhnə alışlar (arxiv)</button>
      </div>
    </div>
    <div class="yzi-table-wrap"><table class="yzi-table">
      <thead><tr><th>Tarix</th><th>Sənəd</th><th>Təchizatçı</th><th>Anbar</th><th class="n">Yekun</th><th class="n">Qalıq borc</th><th>Son tarix</th><th>Status</th></tr></thead>
      <tbody>${rows.length ? rows.map(d => {
        const ps = payState(d); const st = STATUS[d.status] || {};
        const ret = d.kind === 'preturn';
        return `<tr data-open="${d.id}" data-kind="${d.kind}" tabindex="0" class="${d.status === 'storno' ? 'is-void' : ''}">
          <td>${fmtDT(d.at)}</td>
          <td><b class="yzi-mono">${esc(d.no)}</b>${d.invoiceNo ? `<br><small class="mut">e-qaimə ${esc(d.invoiceNo)}</small>` : ''}${ret ? '<br><small class="yzi-warn">Qaytarma</small>' : ''}</td>
          <td><b>${esc(d.supplierName || '—')}</b></td>
          <td class="mut">${esc(whName(d.whId))}</td>
          <td class="n"><b>${ret ? '−' : ''}${fmtMoney(docTotal(d))}</b></td>
          <td class="n">${!ret && d.status === 'approved' ? `<span class="${docDue(d) > 0.009 ? 'yzi-bad' : 'mut'}">${fmtMoney(docDue(d))}</span>` : '<span class="mut">—</span>'}</td>
          <td class="${ps?.cls === 'bad' && d.dueAt < Date.now() ? 'yzi-warn' : 'mut'}">${d.dueAt && !ret ? fmtDT(d.dueAt) : '—'}</td>
          <td><span class="yzi-st yzi-st--${st.cls}">${st.label || d.status}</span>${ps ? ` <span class="yzi-st yzi-st--${ps.cls}">${ps.label}</span>` : ''}</td></tr>`;
      }).join('') : '<tr><td colspan="8" class="yzi-empty">Qaimə tapılmadı.</td></tr>'}</tbody>
    </table></div>`;
  el.querySelector('#yziPQ').addEventListener('input', (e) => { pf.q = e.target.value; const p = e.target.selectionStart; again(); const i = $('yziPQ'); i.focus(); i.setSelectionRange(p, p); });
  el.querySelector('#yziPSup').addEventListener('change', (e) => { pf.sup = e.target.value; again(); });
  el.addEventListener('click', (e) => {
    const s = e.target.closest('[data-st]'); if (s) { pf.st = pf.st === s.dataset.st && s.dataset.st !== 'all' ? 'all' : s.dataset.st; again(); return; }
    const a = e.target.closest('[data-act]');
    if (a?.dataset.act === 'new') { openPurchaseEditor(null); return; }
    if (a?.dataset.act === 'pay') { openPaymentEditor(null, {}); return; }
    if (a?.dataset.act === 'legacy') { openLegacy(); return; }
    const r = e.target.closest('[data-open]'); if (r) openPurchaseView(r.dataset.open, r.dataset.kind);
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('tr[data-open]')) openPurchaseView(e.target.dataset.open, e.target.dataset.kind); });
}

/* ═══ QAİMƏ REDAKTORU ═══ */
export function openPurchaseEditor(id, preset = {}) {
  const old = id ? docList('purchase').find(d => d.id === id) : null;
  if (old && !['draft', 'pending', 'rejected'].includes(old.status)) { openPurchaseView(id, 'purchase'); return; }
  if (!supplierList().length && !old) { fail('Əvvəlcə "Təchizatçılar" bölməsində təchizatçı əlavə edin'); go('suppliers'); return; }
  const d = old ? JSON.parse(JSON.stringify(old)) : {
    supplierId: preset.supplierId || '', invoiceNo: '', at: Date.now(), whId: defaultWarehouseId(), priceMode: 'excl',
    lines: {}, pay: { mode: 'none', amount: 0, method: 'cash' }, note: ''
  };
  let lines = Object.values(d.lines || {}).map(l => ({ ...l, _k: Math.random().toString(36).slice(2) }));
  const jump = Number(inv.settings.priceJumpPct ?? 15);
  const m = modal({ title: old ? `Qaimə ${esc(old.no)}` : 'Yeni alış qaiməsi', wide: true, body: '<div id="yziPE"></div>', actions: [
    { label: 'Ləğv', cancel: true, cls: 'yzi-btn--ghost' },
    { label: 'Qaralama saxla', cls: 'yzi-btn--ghost', onClick: () => save('draft') },
    { label: 'Təsdiqə göndər', cls: 'yzi-btn--ghost', onClick: () => save('pending') },
    ...(canApprove('purchase', old || { createdBy: uid() }) ? [{ label: 'Təsdiqlə və anbara yaz', cls: 'yzi-btn--gold', onClick: () => save('approve') }] : [])
  ] });
  const root = m.body.querySelector('#yziPE');
  function sup() { return suppliers[d.supplierId] || null; }
  function draw() {
    blurIn(root);
    const tot = calcTotals(lines, d.priceMode);
    const s = sup();
    const payAmt = d.pay.mode === 'full' ? tot.gross : d.pay.mode === 'partial' ? r2(d.pay.amount) : 0;
    const dupe = d.invoiceNo && docList('purchase').some(x => x.id !== id && x.status !== 'storno' && x.supplierId === d.supplierId && String(x.invoiceNo || '').trim().toLowerCase() === d.invoiceNo.trim().toLowerCase());
    root.innerHTML = `<div class="yzi-pe">
      <div class="yzi-pe__main">
        <section class="yzi-card yzi-grid4">
          <label class="yzi-f yzi-span2"><span>Təchizatçı *</span><select id="yziPeSup"><option value="">— seçin —</option>${supplierList().map(x => `<option value="${x.id}"${x.id === d.supplierId ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
            ${s ? `<small class="yzi-hint">${s.voen ? 'VÖEN ' + esc(s.voen) + ' · ' : ''}Ödəniş müddəti ${Number(s.paymentTermDays) || 0} gün${seeMoney() ? ` · Cari borc <b>${fmtMoney(supplierDebt(d.supplierId))}</b>` : ''}</small>` : ''}</label>
          <label class="yzi-f"><span>E-qaimə / faktura №</span><input type="text" id="yziPeInv" value="${esc(d.invoiceNo || '')}" autocomplete="off"></label>
          <label class="yzi-f"><span>Qaimə tarixi və saatı</span><input type="datetime-local" id="yziPeAt" value="${toLocalInput(d.at)}"></label>
          <label class="yzi-f"><span>Anbar *</span><select id="yziPeWh">${whOptions(d.whId)}</select></label>
          <label class="yzi-f"><span>Ödəniş son tarixi</span><input type="datetime-local" id="yziPeDue" value="${d.dueAt ? toLocalInput(d.dueAt) : (s ? toLocalInput((d.at || Date.now()) + (Number(s.paymentTermDays) || 0) * DAY) : '')}"></label>
          <div class="yzi-f yzi-span2"><span>Qiymətlər</span><div class="yzi-seg" id="yziPeMode"><button type="button" data-pm="excl" class="${d.priceMode !== 'incl' ? 'is-on' : ''}">ƏDV xaric</button><button type="button" data-pm="incl" class="${d.priceMode === 'incl' ? 'is-on' : ''}">ƏDV daxil</button></div></div>
          ${dupe ? '<p class="yzi-warnbox yzi-span4"><b>Diqqət:</b> bu təchizatçıdan eyni nömrəli qaimə artıq var. Təkrar daxil etmədiyinizə əmin olun.</p>' : ''}
          ${old?.rejectReason ? `<p class="yzi-warnbox yzi-span4"><b>Rədd səbəbi:</b> ${esc(old.rejectReason)}</p>` : ''}
          ${old?.postError ? `<p class="yzi-warnbox yzi-span4"><b>Yazılış xətası:</b> ${esc(old.postError)}</p>` : ''}
        </section>
        <div class="yzi-table-wrap"><table class="yzi-table yzi-table--lines">
          <thead><tr><th>№</th><th>Mal (kataloqdan)</th><th>Qablaşma</th><th class="n">Miqdar</th><th class="n">Qiymət</th><th class="n">ƏDV %</th><th class="n">ƏDV ₼</th><th class="n">Cəmi</th><th></th></tr></thead>
          <tbody>${lines.map((l, i) => {
            const p = product(l.pid); const c = calcLine(l, d.priceMode);
            const last = Number(p?.lastCost) || 0;
            const isJump = last > 0 && c.unitCost > 0 && Math.abs(c.unitCost - last) / last * 100 >= jump;
            return `<tr class="${isJump ? 'is-jump' : ''}">
              <td class="mut">${i + 1}</td>
              <td><b>${esc(l.name)}</b>${p?.incomplete ? ' <i class="yzi-tag-inc">natamam</i>' : ''}
                ${isJump ? `<br><small class="yzi-warn">Son alış ${fmtMoney(last)}/${esc(p.unit)} idi · ${c.unitCost > last ? '+' : ''}${r2((c.unitCost - last) / last * 100)}%</small>` : ''}
                <br><small class="mut">= ${fmtQty(c.baseQty)} ${esc(p?.unit || '')}${c.unitCost ? ` · maya ${fmtMoney(c.unitCost)}/${esc(p?.unit || '')}` : ''}</small></td>
              <td><select data-l="${l._k}" data-f="packKey">${packOptions(p, l.packKey)}</select></td>
              <td class="n">${numInput(`data-l="${l._k}" data-f="qty" class="yzi-n"`, l.qty)}</td>
              <td class="n">${numInput(`data-l="${l._k}" data-f="price" class="yzi-n"`, l.price)}</td>
              <td class="n">${numInput(`data-l="${l._k}" data-f="vatRate" class="yzi-n yzi-n--s"`, l.vatRate)}</td>
              <td class="n mut">${c.vat.toFixed(2)}</td>
              <td class="n"><b>${c.gross.toFixed(2)}</b></td>
              <td><button type="button" class="yzi-x" data-del="${l._k}" aria-label="Sətri sil">✕</button></td></tr>`;
          }).join('')}
          <tr><td class="mut">${lines.length + 1}</td><td colspan="8"><input type="text" id="yziPeAdd" class="yzi-dashed" placeholder="Mal adı yazın və ya barkod oxudun…"></td></tr></tbody>
        </table></div>
        <p class="yzi-hint">Klaviatura: yazıb <b>Enter</b> — mal seçilir. Kataloqda olmayan mal üçün "qısa kart yarat" təklif olunur.</p>
        <label class="yzi-f"><span>Qeyd</span><input type="text" id="yziPeNote" value="${esc(d.note || '')}" placeholder="məs: 2 kq ət xarab gəldi, qaytarılacaq"></label>
      </div>
      <aside class="yzi-card yzi-pe__side">
        <div class="yzi-eyebrow">XÜLASƏ</div>
        <div class="yzi-row"><span class="mut">Sətir sayı</span><b>${lines.length}</b></div>
        <div class="yzi-row"><span class="mut">ƏDV-siz məbləğ</span><b>${fmtMoney(tot.net)}</b></div>
        <div class="yzi-row"><span class="mut">ƏDV</span><b>${fmtMoney(tot.vat)}</b></div>
        <div class="yzi-row yzi-row--big"><span>Yekun</span><b class="yzi-gold">${fmtMoney(tot.gross)}</b></div>
        <div class="yzi-f"><span>İndi ödənilən</span><div class="yzi-seg" id="yziPePay">
          ${[['none', 'Nisyə'], ['partial', 'Qismən'], ['full', 'Tam']].map(([k, v]) => `<button type="button" data-pay="${k}" class="${d.pay.mode === k ? 'is-on' : ''}">${v}</button>`).join('')}</div></div>
        ${d.pay.mode === 'partial' ? `<label class="yzi-f"><span>Ödənilən məbləğ</span>${numInput('id="yziPePayAmt"', d.pay.amount || '')}</label>` : ''}
        ${d.pay.mode !== 'none' ? `<label class="yzi-f"><span>Ödəniş üsulu</span><select id="yziPePayM">${Object.entries(METHODS).map(([k, v]) => `<option value="${k}"${d.pay.method === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>` : ''}
        <div class="yzi-row"><span class="mut">Borca yazılacaq</span><b class="yzi-bad">${fmtMoney(tot.gross - payAmt)}</b></div>
        ${s && seeMoney() ? `<div class="yzi-row"><span class="mut">Təchizatçının yeni borcu</span><b>${fmtMoney(supplierDebt(d.supplierId) + tot.gross - payAmt)}</b></div>` : ''}
        <div class="yzi-okbox">Təsdiqlənəndə: ${lines.length} mal <b>${esc(whName(d.whId))}</b> anbarına mədaxil olunacaq, orta maya yenilənəcək, təchizatçı hesabına ${fmtMoney(tot.gross)} borc yazılacaq${payAmt ? `, ${fmtMoney(payAmt)} ödəniş qeydə alınacaq` : ''}.</div>
        <p class="yzi-hint">${inv.settings.vatPayer ? 'ƏDV ödəyicisi: maya ƏDV-siz hesablanır.' : 'ƏDV ödəyicisi deyil: maya ƏDV ilə hesablanır.'}</p>
      </aside></div>`;
    bind();
  }
  function collect() {
    const g = (s) => root.querySelector(s);
    d.supplierId = g('#yziPeSup')?.value || '';
    d.invoiceNo = g('#yziPeInv')?.value.trim() || '';
    d.at = fromLocalInput(g('#yziPeAt')?.value);
    d.whId = g('#yziPeWh')?.value || d.whId;
    d.dueAt = g('#yziPeDue')?.value ? fromLocalInput(g('#yziPeDue').value) : null;
    d.note = g('#yziPeNote')?.value.trim() || '';
    if (g('#yziPePayAmt')) d.pay.amount = r2(num(g('#yziPePayAmt').value) || 0);
    if (g('#yziPePayM')) d.pay.method = g('#yziPePayM').value;
    root.querySelectorAll('[data-l]').forEach(i => {
      const l = lines.find(x => x._k === i.dataset.l); if (!l) return;
      if (i.dataset.f === 'packKey') {
        l.packKey = i.value; const pk = packsOf(product(l.pid)).find(x => x.key === i.value);
        l.factor = pk?.factor || 1; l.packName = pk?.name || '';
      } else { const v = num(i.value); l[i.dataset.f] = Number.isFinite(v) ? v : 0; }
    });
  }
  function addProduct(p) {
    collect();
    const ex = lines.find(l => l.pid === p.id);
    if (ex) { ex.qty = (Number(ex.qty) || 0) + 1; draw(); return; }
    const packs = packsOf(p); const pk = packs[packs.length > 1 ? 1 : 0];
    const sp = p.supplierPrices?.[d.supplierId];
    const lastPrice = sp && sp.factor === pk.factor ? sp.price : (Number(p.lastCost) || 0) * pk.factor;
    lines.push({ _k: Math.random().toString(36).slice(2), pid: p.id, name: p.name, unit: p.unit, packKey: pk.key, packName: pk.name, factor: pk.factor, qty: 1, price: r2(lastPrice) || '', vatRate: Number(p.vatRate) || 0 });
    draw();
    setTimeout(() => { const i = root.querySelector(`[data-l="${lines[lines.length - 1]._k}"][data-f="qty"]`); i?.focus(); i?.select(); }, 30);
  }
  function bind() {
    root.querySelector('#yziPeSup').addEventListener('change', () => { collect(); d.dueAt = null; draw(); });
    root.querySelector('#yziPeAt').addEventListener('change', () => { collect(); d.dueAt = null; draw(); });
    root.querySelector('#yziPeInv').addEventListener('change', () => { collect(); draw(); });
    root.querySelector('#yziPeWh').addEventListener('change', () => { collect(); draw(); });
    root.querySelector('#yziPeMode').addEventListener('click', (e) => { const b = e.target.closest('[data-pm]'); if (!b) return; collect(); d.priceMode = b.dataset.pm; draw(); });
    root.querySelector('#yziPePay').addEventListener('click', (e) => { const b = e.target.closest('[data-pay]'); if (!b) return; collect(); d.pay.mode = b.dataset.pay; draw(); });
    root.querySelector('#yziPePayAmt')?.addEventListener('change', () => { collect(); draw(); });
    root.querySelectorAll('[data-l]').forEach(i => i.addEventListener('change', () => { collect(); draw(); }));
    root.querySelectorAll('input[data-l]').forEach(i => i.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); collect(); draw(); setTimeout(() => root.querySelector('#yziPeAdd')?.focus(), 30); }
    }));
    root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { collect(); lines = lines.filter(l => l._k !== b.dataset.del); draw(); }));
    attachPicker(root.querySelector('#yziPeAdd'), { types: Object.keys(PTYPES).filter(t => PTYPES[t].buy), onPick: addProduct });
  }
  async function save(mode) {
    collect();
    if (!d.supplierId) throw new Error('Təchizatçı seçin');
    if (!d.whId) throw new Error('Anbar seçin');
    const valid = lines.filter(l => l.pid && Number(l.qty) > 0);
    if (!valid.length) throw new Error('Ən azı bir mal sətri doldurun');
    const noPrice = valid.find(l => !(Number(l.price) > 0));
    if (noPrice) throw new Error(`"${noPrice.name}" sətrində qiymət yazılmayıb`);
    const tot = calcTotals(valid, d.priceMode);
    const payAmt = d.pay.mode === 'full' ? tot.gross : d.pay.mode === 'partial' ? r2(d.pay.amount) : 0;
    if (payAmt > tot.gross + 0.009) throw new Error('Ödəniş qaimə məbləğindən çox ola bilməz');
    if (d.pay.mode === 'partial' && !(payAmt > 0)) throw new Error('Ödənilən məbləği yazın');
    const outLines = {};
    valid.forEach((l, i) => {
      const c = calcLine(l, d.priceMode);
      outLines[i] = { pid: l.pid, name: l.name, unit: product(l.pid)?.unit || l.unit || '', packKey: l.packKey || '_base', packName: l.packName || '', factor: Number(l.factor) || 1,
        qty: r3(l.qty), price: r4(l.price), vatRate: Number(l.vatRate) || 0, net: c.net, vat: c.vat, gross: c.gross, baseQty: c.baseQty, unitCost: c.unitCost };
    });
    const data = {
      supplierId: d.supplierId, supplierName: suppliers[d.supplierId]?.name || '', invoiceNo: d.invoiceNo, at: d.at, dueAt: d.dueAt || null,
      whId: d.whId, priceMode: d.priceMode, lines: outLines, totals: tot,
      pay: { mode: d.pay.mode, amount: payAmt, method: d.pay.method || 'cash' }, note: d.note, paidAmount: 0
    };
    if (old) {
      await updateDoc('purchase', id, data);
      if (mode === 'pending' || mode === 'approve') await submitDoc('purchase', id);
      if (mode === 'approve') await approveDoc('purchase', id);
    } else {
      await createDoc('purchase', data, { asDraft: mode === 'draft', approveNow: mode === 'approve' });
    }
    ok(mode === 'approve' ? 'Qaimə təsdiqləndi və anbara yazıldı' : mode === 'pending' ? 'Təsdiqə göndərildi' : 'Qaralama saxlanıldı');
  }
  draw();
}

/* ═══ QAİMƏ BAXIŞI ═══ */
export function openPurchaseView(id, kind = 'purchase') {
  const d = docList(kind).find(x => x.id === id);
  if (!d) return;
  if (kind === 'purchase' && ['draft', 'rejected'].includes(d.status) && (d.createdBy === uid() || isAdmin())) { openPurchaseEditor(id); return; }
  const st = STATUS[d.status] || {};
  const ps = payState(d);
  const lines = Object.values(d.lines || {});
  const pays = docList('payment', p => p.allocations && p.allocations[id] !== undefined);
  const acts = [{ label: 'Bağla', cancel: true, cls: 'yzi-btn--ghost' }];
  if (d.status === 'pending' && canApprove(kind, d)) {
    acts.push({ label: 'Rədd et', cls: 'yzi-btn--ghost', onClick: async () => { const r = await confirmBox('Rədd səbəbi?', { input: 'Səbəb', okLabel: 'Rədd et', okCls: 'yzi-btn--red' }); if (!r) return false; await rejectDoc(kind, id, r); ok('Rədd edildi'); } });
    acts.push({ label: 'Təsdiqlə', cls: 'yzi-btn--gold', onClick: async () => { await approveDoc(kind, id); ok('Təsdiqləndi və anbara yazıldı'); } });
  }
  if (d.status === 'pending' && (d.createdBy === uid() || isAdmin()) && kind === 'purchase') acts.push({ label: 'Redaktə', cls: 'yzi-btn--ghost', onClick: () => { setTimeout(() => openPurchaseEditor(id), 10); } });
  if (d.status === 'approved' && kind === 'purchase') {
    if (docDue(d) > 0.009 && (can('supplier.payment.create') || can('supplier.payment.approve'))) acts.push({ label: 'Ödəniş et', cls: 'yzi-btn--ghost', onClick: () => { setTimeout(() => openPaymentEditor(null, { supplierId: d.supplierId, purchaseId: id }), 10); } });
    if (canCreate('preturn') || canApprove('preturn')) acts.push({ label: 'Qaytarma', cls: 'yzi-btn--ghost', onClick: () => { setTimeout(() => openReturnEditor(d), 10); } });
  }
  if (d.status === 'approved' && (can(DOCS[kind].storno) || isAdmin())) acts.push({ label: 'Storno', cls: 'yzi-btn--red', onClick: async () => {
    const lowStock = lines.filter(l => totalStock(l.pid) < l.baseQty - 0.0001);
    const warn = lowStock.length ? `<br><br><b class="yzi-warn">Diqqət:</b> ${lowStock.map(l => esc(l.name)).join(', ')} artıq qismən satılıb — storno qalığı mənfiyə sala bilər.` : '';
    const paid = docPaid(d) > 0 ? `<br><b>${fmtMoney(docPaid(d))}</b> ödəniş qalır — təchizatçıda avans kimi görünəcək.` : '';
    const r = await confirmBox(`${esc(d.no)} storno edilsin? Anbardan və borcdan geri alınacaq.${warn}${paid}`, { input: 'Storno səbəbi', okLabel: 'Storno et', okCls: 'yzi-btn--red' });
    if (!r) return false; await stornoDoc(kind, id, r); ok('Storno edildi');
  } });
  if (['pending', 'rejected', 'draft'].includes(d.status) && (d.createdBy === uid() || isAdmin())) acts.splice(1, 0, { label: 'Sil', cls: 'yzi-btn--ghost yzi-btn--left', onClick: async () => { const c = await confirmBox(`${esc(d.no)} silinsin?`, { okCls: 'yzi-btn--red', okLabel: 'Sil' }); if (!c) return false; await deleteDraft(kind, id); ok('Silindi'); } });

  modal({ title: `${DOCS[kind].label} ${esc(d.no)}`, wide: true, actions: acts, body: `
    <div class="yzi-docmeta">
      <div><small>Status</small><b><span class="yzi-st yzi-st--${st.cls}">${st.label}</span>${ps ? ` <span class="yzi-st yzi-st--${ps.cls}">${ps.label}</span>` : ''}</b></div>
      <div><small>Təchizatçı</small><b>${esc(d.supplierName)}</b></div>
      <div><small>Tarix</small><b>${fmtDT(d.at)}</b></div>
      <div><small>Anbar</small><b>${esc(whName(d.whId))}</b></div>
      ${d.invoiceNo ? `<div><small>E-qaimə №</small><b>${esc(d.invoiceNo)}</b></div>` : ''}
      ${d.dueAt ? `<div><small>Ödəniş son tarixi</small><b>${fmtDT(d.dueAt)}</b></div>` : ''}
      <div><small>Yazan</small><b>${esc(d.createdByName || '—')}</b><small>${fmtDT(d.createdAt)}</small></div>
      ${d.approvedAt ? `<div><small>Təsdiq edən</small><b>${esc(d.approvedByName || '—')}</b><small>${fmtDT(d.approvedAt)}</small></div>` : ''}
      ${d.stornoAt ? `<div><small>Storno</small><b>${esc(d.stornoBy)}</b><small>${fmtDT(d.stornoAt)} · ${esc(d.stornoReason)}</small></div>` : ''}
      ${d.rejectReason ? `<div><small>Rədd səbəbi</small><b>${esc(d.rejectReason)}</b></div>` : ''}
      ${d.reason ? `<div><small>Səbəb</small><b>${esc(d.reason)}</b></div>` : ''}
    </div>
    ${d.postError ? `<p class="yzi-warnbox"><b>Son yazılış xətası:</b> ${esc(d.postError)}</p>` : ''}
    <div class="yzi-table-wrap"><table class="yzi-table yzi-table--mini">
      <thead><tr><th>Mal</th><th class="n">Miqdar</th><th class="n">Qiymət</th><th class="n">ƏDV</th><th class="n">Cəmi</th><th class="n">Anbara</th></tr></thead>
      <tbody>${lines.map(l => `<tr><td><b>${esc(l.name)}</b></td><td class="n">${fmtQty(l.qty)} ${esc(l.packName || l.unit || '')}</td><td class="n">${l.price !== undefined ? fmtMoney(l.price) : '—'}</td><td class="n">${l.vat !== undefined ? fmtMoney(l.vat) : '—'}</td><td class="n"><b>${fmtMoney(l.gross)}</b></td><td class="n mut">${fmtQty(l.baseQty)} ${esc(l.unit || '')}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="3">ƏDV-siz ${fmtMoney(d.totals?.net)} · ƏDV ${fmtMoney(d.totals?.vat)}</td><td></td><td class="n"><b class="yzi-gold">${fmtMoney(d.totals?.gross)}</b></td><td></td></tr></tfoot>
    </table></div>
    ${kind === 'purchase' && d.status === 'approved' ? `<h3 class="yzi-h3">Ödənişlər · qalıq ${fmtMoney(docDue(d))}</h3>
      ${pays.length ? pays.map(p => `<div class="yzi-row"><span>${fmtDT(p.at)} · <b class="yzi-mono">${esc(p.no)}</b> · ${esc(METHODS[p.method] || p.method)} <span class="yzi-st yzi-st--${STATUS[p.status]?.cls}">${STATUS[p.status]?.label}</span></span><b>${fmtMoney(p.allocations[id])}</b></div>`).join('') : '<p class="yzi-hint">Ödəniş yoxdur.</p>'}` : ''}
    ${d.note ? `<p class="yzi-p"><b>Qeyd:</b> ${esc(d.note)}</p>` : ''}` });
}

/* ═══ TƏCHİZATÇIYA QAYTARMA ═══ */
function openReturnEditor(pdoc) {
  const lines = Object.values(pdoc.lines || {});
  modal({ title: `Qaytarma — ${esc(pdoc.no)}`, wide: true, body: `
    <p class="yzi-p">Qaytarılan miqdarı anbar vahidində yazın. Anbardan çıxılacaq və təchizatçı borcundan azalacaq (təsdiqdən sonra).</p>
    <table class="yzi-table yzi-table--mini"><thead><tr><th>Mal</th><th class="n">Alınıb</th><th class="n">Qalıq (anbarda)</th><th class="n">Qaytarılır</th><th class="n">Məbləğ</th></tr></thead><tbody>
    ${lines.map((l, i) => `<tr><td><b>${esc(l.name)}</b></td><td class="n">${fmtQty(l.baseQty)} ${esc(l.unit)}</td><td class="n mut">${fmtQty(totalStock(l.pid))}</td>
      <td class="n">${numInput(`data-ri="${i}" class="yzi-n"`, '')}</td><td class="n" data-ra="${i}">0.00</td></tr>`).join('')}</tbody></table>
    <label class="yzi-f"><span>Səbəb *</span><input type="text" id="yziRetReason" placeholder="məs: xarab gəldi, keyfiyyətsiz"></label>`,
    actions: [{ label: 'Ləğv', cancel: true, cls: 'yzi-btn--ghost' }, { label: canApprove('preturn') ? 'Yarat və təsdiqlə' : 'Təsdiqə göndər', cls: 'yzi-btn--gold', onClick: async (b) => {
      const reason = b.querySelector('#yziRetReason').value.trim(); if (!reason) throw new Error('Səbəb yazılmalıdır');
      const out = {}; let gross = 0, net = 0, vat = 0;
      lines.forEach((l, i) => {
        const q = num(b.querySelector(`[data-ri="${i}"]`).value);
        if (!(q > 0)) return;
        if (q > l.baseQty + 0.0001) throw new Error(`${l.name}: alınandan çox qaytarıla bilməz`);
        const k = q / l.baseQty;
        out[Object.keys(out).length] = { pid: l.pid, name: l.name, unit: l.unit, baseQty: r3(q), qty: r3(q), unitCost: l.unitCost, gross: r2(l.gross * k), net: r2(l.net * k), vat: r2(l.vat * k) };
        gross += l.gross * k; net += l.net * k; vat += l.vat * k;
      });
      if (!Object.keys(out).length) throw new Error('Qaytarılan miqdar yazın');
      await createDoc('preturn', { supplierId: pdoc.supplierId, supplierName: pdoc.supplierName, purchaseId: pdoc.id, purchaseNo: pdoc.no, whId: pdoc.whId, at: Date.now(), lines: out, totals: { gross: r2(gross), net: r2(net), vat: r2(vat) }, reason }, { approveNow: true });
      ok('Qaytarma yaradıldı');
    } }]
  }).body.addEventListener('input', (e) => {
    const i = e.target.dataset.ri; if (i === undefined) return;
    const l = lines[i]; const q = num(e.target.value) || 0;
    e.target.closest('tr').querySelector(`[data-ra="${i}"]`).textContent = r2(l.gross * q / (l.baseQty || 1)).toFixed(2);
  });
}

/* ═══ ÖDƏNİŞ ═══ */
export function openPaymentEditor(id, { supplierId = '', purchaseId = null } = {}) {
  const canPay = can('supplier.payment.create') || can('supplier.payment.approve');
  if (!canPay) { fail('Ödəniş üçün icazəniz yoxdur'); return; }
  const d = { supplierId, amount: purchaseId ? docDue(docList('purchase').find(x => x.id === purchaseId)) : 0, method: 'cash', at: Date.now(), note: '', alloc: {} };
  let manual = false;
  const m = modal({ title: 'Təchizatçıya ödəniş', wide: true, body: '<div id="yziPay"></div>', actions: [
    { label: 'Ləğv', cancel: true, cls: 'yzi-btn--ghost' },
    { label: 'Təsdiqə göndər', cls: 'yzi-btn--ghost', onClick: () => save(false) },
    ...(canApprove('payment', { createdBy: uid() }) ? [{ label: 'Ödənişi təsdiqlə', cls: 'yzi-btn--gold', onClick: () => save(true) }] : [])
  ] });
  const root = m.body.querySelector('#yziPay');
  const unpaid = () => docList('purchase', x => x.status === 'approved' && x.supplierId === d.supplierId && docDue(x) > 0.009).sort((a, b) => (a.at || 0) - (b.at || 0));
  function autoAlloc() {
    d.alloc = {}; let rest = r2(d.amount);
    const list = unpaid();
    if (purchaseId) { const p = list.find(x => x.id === purchaseId); if (p) { const a = Math.min(rest, docDue(p)); if (a > 0) { d.alloc[p.id] = r2(a); rest = r2(rest - a); } } }
    list.forEach(p => { if (rest <= 0.009 || d.alloc[p.id]) return; const a = Math.min(rest, docDue(p)); d.alloc[p.id] = r2(a); rest = r2(rest - a); });
  }
  function draw() {
    blurIn(root);
    if (!manual) autoAlloc();
    const debt = supplierDebt(d.supplierId);
    const allocSum = r2(Object.values(d.alloc).reduce((s, v) => s + (Number(v) || 0), 0));
    const list = unpaid();
    root.innerHTML = `<div class="yzi-pe"><div class="yzi-pe__main">
      <section class="yzi-card yzi-grid3">
        <label class="yzi-f"><span>Təchizatçı *</span><select id="yziPaySup"><option value="">— seçin —</option>${supplierList().map(s => `<option value="${s.id}"${s.id === d.supplierId ? ' selected' : ''}>${esc(s.name)} · ${fmtMoney(supplierDebt(s.id))}</option>`).join('')}</select></label>
        <label class="yzi-f"><span>Məbləğ (₼) *</span>${numInput('id="yziPayAmt" class="yzi-big"', d.amount || '')}</label>
        <label class="yzi-f"><span>Tarix və saat</span><input type="datetime-local" id="yziPayAt" value="${toLocalInput(d.at)}"></label>
        <div class="yzi-f yzi-span3"><span>Üsul</span><div class="yzi-seg" id="yziPayM">${Object.entries(METHODS).map(([k, v]) => `<button type="button" data-m="${k}" class="${d.method === k ? 'is-on' : ''}">${v}</button>`).join('')}</div></div>
      </section>
      <div class="yzi-row"><h3 class="yzi-h3">Hansı qaimələri bağlayır</h3><small class="mut">${manual ? 'Əl ilə bölüşdürmə' : 'Avtomatik: ən köhnə qaimədən başlayır'} ${manual ? '<button type="button" class="yzi-link" data-auto>avtomatik et</button>' : ''}</small></div>
      <div class="yzi-table-wrap"><table class="yzi-table yzi-table--mini"><thead><tr><th>Qaimə</th><th>Tarix</th><th class="n">Qalıq borc</th><th class="n">Bu ödənişdən</th><th class="n">Sonra qalır</th></tr></thead>
        <tbody>${list.length ? list.map(p => { const a = Number(d.alloc[p.id]) || 0; return `<tr><td><b class="yzi-mono">${esc(p.no)}</b>${p.invoiceNo ? ` <small class="mut">${esc(p.invoiceNo)}</small>` : ''}</td><td>${fmtDT(p.at)}</td><td class="n">${fmtMoney(docDue(p))}</td>
          <td class="n">${numInput(`data-al="${p.id}" class="yzi-n"`, a || '')}</td><td class="n">${fmtMoney(docDue(p) - a)}</td></tr>`; }).join('') : `<tr><td colspan="5" class="yzi-empty">${d.supplierId ? 'Ödənilməmiş qaimə yoxdur — ödəniş avans kimi yazılacaq.' : 'Təchizatçı seçin.'}</td></tr>`}</tbody></table></div>
      <label class="yzi-f"><span>Qeyd</span><input type="text" id="yziPayNote" value="${esc(d.note)}" placeholder="məs: sürücüyə nağd verildi, qəbz №…"></label>
    </div>
    <aside class="yzi-card yzi-pe__side">
      <div class="yzi-eyebrow">NƏTİCƏ</div>
      <div class="yzi-row"><span class="mut">Hazırkı borc</span><b>${fmtMoney(debt)}</b></div>
      <div class="yzi-row"><span class="mut">Ödəniş</span><b class="yzi-ok">− ${fmtMoney(d.amount)}</b></div>
      <div class="yzi-row yzi-row--big"><span>Qalan borc</span><b class="yzi-gold">${fmtMoney(debt - (Number(d.amount) || 0))}</b></div>
      ${allocSum < (Number(d.amount) || 0) - 0.009 ? `<p class="yzi-warnbox">${fmtMoney((Number(d.amount) || 0) - allocSum)} heç bir qaiməyə bağlanmayıb — avans kimi qalacaq.</p>` : ''}
      ${allocSum > (Number(d.amount) || 0) + 0.009 ? '<p class="yzi-warnbox yzi-bad">Bölüşdürülən məbləğ ödənişdən çoxdur.</p>' : ''}
      <div class="yzi-okbox">Təsdiqlənəndə: təchizatçı hesabına −${fmtMoney(d.amount)} yazılacaq, ${METHODS[d.method]} məxaric kimi kassa hesabatında görünəcək.</div>
    </aside></div>`;
    root.querySelector('#yziPaySup').addEventListener('change', (e) => { d.supplierId = e.target.value; manual = false; draw(); });
    root.querySelector('#yziPayAmt').addEventListener('change', (e) => { d.amount = r2(num(e.target.value) || 0); manual = false; draw(); });
    root.querySelector('#yziPayAt').addEventListener('change', (e) => { d.at = fromLocalInput(e.target.value); });
    root.querySelector('#yziPayNote').addEventListener('change', (e) => { d.note = e.target.value.trim(); });
    root.querySelector('#yziPayM').addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (!b) return; d.method = b.dataset.m; draw(); });
    root.querySelectorAll('[data-al]').forEach(i => i.addEventListener('change', () => { manual = true; const v = num(i.value); d.alloc[i.dataset.al] = Number.isFinite(v) && v > 0 ? r2(v) : 0; draw(); }));
    root.querySelector('[data-auto]')?.addEventListener('click', () => { manual = false; draw(); });
  }
  async function save(approve) {
    d.note = root.querySelector('#yziPayNote')?.value.trim() || d.note;
    if (!d.supplierId) throw new Error('Təchizatçı seçin');
    if (!(d.amount > 0)) throw new Error('Məbləğ yazın');
    const alloc = {}; let sum = 0;
    for (const [k, v] of Object.entries(d.alloc)) {
      if (!(v > 0)) continue;
      const p = docList('purchase').find(x => x.id === k);
      if (p && v > docDue(p) + 0.009) throw new Error(`${p.no}: qalıq borcdan çox bağlana bilməz`);
      alloc[k] = r2(v); sum += v;
    }
    if (sum > d.amount + 0.009) throw new Error('Bölüşdürülən məbləğ ödənişdən çoxdur');
    await createDoc('payment', { supplierId: d.supplierId, supplierName: suppliers[d.supplierId]?.name || '', amount: r2(d.amount), method: d.method, at: d.at, allocations: Object.keys(alloc).length ? alloc : null, note: d.note }, { approveNow: approve });
    ok(approve ? 'Ödəniş təsdiqləndi' : 'Ödəniş təsdiqə göndərildi');
  }
  draw();
}

/* ═══ TƏCHİZATÇILAR ═══ */
function renderSuppliers(host) {
  const el = fresh(host);
  const list = supplierList();
  const canEdit = can('supplier.manage');
  el.innerHTML = `
    <div class="yzi-head"><div><div class="yzi-eyebrow">ANBAR · TƏCHİZAT</div><h1 class="yzi-h1">Təchizatçılar</h1></div>
      <div class="yzi-actions">${canEdit ? '<button type="button" class="yzi-btn yzi-btn--gold" data-new>+ Yeni təchizatçı</button>' : ''}</div></div>
    <div class="yzi-table-wrap"><table class="yzi-table">
      <thead><tr><th>Təchizatçı</th><th>VÖEN</th><th>Telefon</th><th class="n">Ödəniş müddəti</th><th class="n">Vaxtı keçən</th><th class="n">Borcumuz</th></tr></thead>
      <tbody>${list.length ? list.map(s => {
        const od = docList('purchase', d => d.supplierId === s.id && d.status === 'approved' && d.dueAt && d.dueAt < Date.now() && docDue(d) > 0.009).reduce((a, d) => a + docDue(d), 0);
        const debt = supplierDebt(s.id);
        return `<tr data-sup="${s.id}" tabindex="0"><td><b>${esc(s.name)}</b>${s.category ? `<br><small class="mut">${esc(s.category)}</small>` : ''}</td><td class="mut yzi-mono">${esc(s.voen || '—')}</td><td class="mut">${esc(s.phone || '—')}</td>
          <td class="n">${Number(s.paymentTermDays) || 0} gün</td><td class="n ${od > 0 ? 'yzi-warn' : 'mut'}">${od > 0 ? fmtMoney(od) : '—'}</td>
          <td class="n"><b class="${debt > 0.009 ? 'yzi-bad' : debt < -0.009 ? 'yzi-ok' : 'mut'}">${debt < -0.009 ? 'avans ' + fmtMoney(-debt) : fmtMoney(debt)}</b></td></tr>`;
      }).join('') : '<tr><td colspan="6" class="yzi-empty">Təchizatçı yoxdur.</td></tr>'}</tbody></table></div>`;
  el.querySelector('[data-new]')?.addEventListener('click', () => supplierEditor(null));
  el.addEventListener('click', (e) => { const r = e.target.closest('[data-sup]'); if (r) openSupplierAccount(r.dataset.sup); });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('[data-sup]')) openSupplierAccount(e.target.dataset.sup); });
}
export function supplierEditor(id) {
  const s = id ? { id, ...suppliers[id] } : {};
  modal({ title: id ? 'Təchizatçını redaktə et' : 'Yeni təchizatçı', body: `
    <label class="yzi-f"><span>Ad *</span><input type="text" id="yziSuName" value="${esc(s.name || '')}" placeholder="Şirkət və ya şəxs"></label>
    <div class="yzi-grid2">
      <label class="yzi-f"><span>VÖEN</span><input type="text" id="yziSuVoen" value="${esc(s.voen || '')}" inputmode="numeric"></label>
      <label class="yzi-f"><span>Telefon</span><input type="tel" id="yziSuPhone" value="${esc(s.phone || '')}"></label>
      <label class="yzi-f"><span>Ödəniş müddəti (gün)</span>${numInput('id="yziSuTerm"', s.paymentTermDays ?? 0)}</label>
      <label class="yzi-f"><span>Mal kateqoriyası</span><input type="text" id="yziSuCat" value="${esc(s.category || '')}" placeholder="Ət, tərəvəz, içki"></label>
    </div>
    <label class="yzi-f"><span>Ünvan</span><input type="text" id="yziSuAddr" value="${esc(s.address || '')}"></label>
    <label class="yzi-f"><span>Bank rekvizitləri / qeyd</span><textarea id="yziSuNotes" rows="2">${esc(s.notes || '')}</textarea></label>`,
    actions: [{ label: 'Ləğv', cancel: true, cls: 'yzi-btn--ghost' }, { label: 'Yadda saxla', cls: 'yzi-btn--gold', onClick: async () => {
      const name = $('yziSuName').value.trim(); if (!name) throw new Error('Ad yazılmalıdır');
      const data = { name, voen: $('yziSuVoen').value.trim(), phone: $('yziSuPhone').value.trim(), paymentTermDays: Math.max(0, Math.round(num($('yziSuTerm').value) || 0)),
        category: $('yziSuCat').value.trim(), address: $('yziSuAddr').value.trim(), notes: $('yziSuNotes').value.trim() };
      if (id) await db.ref('suppliers/' + id).update(data); else await db.ref('suppliers').push({ ...data, totalDebt: 0, createdAt: Date.now() });
      ok('Yadda saxlanıldı');
    } }] });
}
async function openSupplierAccount(id) {
  const s = { id, ...suppliers[id] };
  const snap = await db.ref('supplierLedger/' + id).once('value');
  const all = Object.entries(snap.val() || {}).map(([k, e]) => ({ k, ...e })).sort((a, b) => (a.at || 0) - (b.at || 0) || (a.createdAt || 0) - (b.createdAt || 0));
  const now = new Date();
  let from = new Date(now.getFullYear(), now.getMonth(), 1).getTime(), to = Date.now();
  const typeLbl = { opening: 'İlkin qalıq', purchase: 'Alış', payment: 'Ödəniş', return: 'Qaytarma', storno: 'Storno' };
  const m = modal({ title: esc(s.name), wide: true, body: '<div id="yziAcc"></div>', actions: [
    { label: 'Bağla', cancel: true, cls: 'yzi-btn--ghost' },
    ...(can('supplier.manage') ? [{ label: 'Redaktə', cls: 'yzi-btn--ghost', close: false, onClick: () => supplierEditor(id) }] : []),
    { label: 'Üzləşmə aktı (çap)', cls: 'yzi-btn--ghost', close: false, onClick: () => printAct(s, all, from, to) },
    ...(can('supplier.payment.create') || can('supplier.payment.approve') ? [{ label: 'Ödəniş et', cls: 'yzi-btn--gold', onClick: () => { setTimeout(() => openPaymentEditor(null, { supplierId: id }), 10); } }] : [])
  ] });
  const root = m.body.querySelector('#yziAcc');
  function draw() {
    blurIn(root);
    const opening = r2(all.filter(e => (e.at || 0) < from).reduce((x, e) => x + e.amount, 0));
    const rows = all.filter(e => (e.at || 0) >= from && (e.at || 0) <= to);
    const plus = r2(rows.filter(e => e.amount > 0).reduce((x, e) => x + e.amount, 0));
    const minus = r2(rows.filter(e => e.amount < 0).reduce((x, e) => x - e.amount, 0));
    let bal = opening;
    root.innerHTML = `
      <p class="mut">${s.voen ? 'VÖEN ' + esc(s.voen) + ' · ' : ''}${esc(s.phone || '')}${s.paymentTermDays ? ' · Ödəniş müddəti ' + s.paymentTermDays + ' gün' : ''}</p>
      <div class="yzi-filters"><label class="yzi-f yzi-f--inline"><span>Başlanğıc</span><input type="datetime-local" id="yziAccFrom" value="${toLocalInput(from)}"></label>
        <label class="yzi-f yzi-f--inline"><span>Son</span><input type="datetime-local" id="yziAccTo" value="${toLocalInput(to)}"></label></div>
      <div class="yzi-kpis">
        <div class="yzi-kpi"><small>Dövrün əvvəlinə qalıq</small><b>${fmtMoney(opening)}</b></div>
        <div class="yzi-kpi"><small>Alınıb (borc artıb)</small><b>${fmtMoney(plus)}</b></div>
        <div class="yzi-kpi"><small>Ödənilib + qaytarılıb</small><b>${fmtMoney(minus)}</b></div>
        <div class="yzi-kpi yzi-kpi--bad"><small>Son qalıq — bizim borcumuz</small><b>${fmtMoney(opening + plus - minus)}</b></div>
      </div>
      <div class="yzi-table-wrap"><table class="yzi-table yzi-table--mini">
        <thead><tr><th>Tarix</th><th>Növ</th><th>Sənəd</th><th>İzah</th><th class="n">Borc +</th><th class="n">Ödəniş −</th><th class="n">Qalıq</th></tr></thead>
        <tbody><tr class="mut"><td colspan="6">Dövrün əvvəlinə qalıq</td><td class="n">${fmtMoney(opening)}</td></tr>
        ${rows.map(e => { bal = r2(bal + e.amount); return `<tr><td>${fmtDT(e.at)}</td><td>${typeLbl[e.type] || e.type}</td><td class="yzi-mono">${esc(e.docNo || '—')}</td><td class="mut">${esc(e.invoiceNo ? 'e-qaimə ' + e.invoiceNo + ' ' : '')}${esc(e.note || '')}${e.method ? ' · ' + esc(METHODS[e.method] || e.method) : ''}</td>
          <td class="n">${e.amount > 0 ? fmtMoney(e.amount) : ''}</td><td class="n">${e.amount < 0 ? fmtMoney(-e.amount) : ''}</td><td class="n"><b>${fmtMoney(bal)}</b></td></tr>`; }).join('')}
        </tbody></table></div>
      <p class="yzi-hint">Borc bu jurnaldan hesablanır. Üzləşmə aktı seçilmiş dövr üçün imza yerləri ilə çap olunur.</p>`;
    root.querySelector('#yziAccFrom').addEventListener('change', (e) => { from = fromLocalInput(e.target.value); draw(); });
    root.querySelector('#yziAccTo').addEventListener('change', (e) => { to = fromLocalInput(e.target.value); draw(); });
  }
  draw();
}
function printAct(s, all, from, to) {
  const opening = r2(all.filter(e => (e.at || 0) < from).reduce((x, e) => x + e.amount, 0));
  const rows = all.filter(e => (e.at || 0) >= from && (e.at || 0) <= to);
  let bal = opening;
  const typeLbl = { opening: 'İlkin qalıq', purchase: 'Alış', payment: 'Ödəniş', return: 'Qaytarma', storno: 'Storno' };
  const company = (state.settings && state.settings.companyName) || 'YuZa POS';
  const w = window.open('', '_blank');
  if (!w) { fail('Çap pəncərəsi bloklandı'); return; }
  w.document.write(`<!doctype html><html lang="az"><head><meta charset="utf-8"><title>Üzləşmə aktı — ${esc(s.name)}</title>
  <style>body{font-family:Arial,sans-serif;font-size:12px;color:#111;margin:24px}h1{font-size:16px;text-align:center;margin:0 0 4px}p{margin:2px 0}
  table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #999;padding:5px 6px;text-align:left}td.n,th.n{text-align:right}
  .sig{display:flex;justify-content:space-between;margin-top:40px}.sig div{width:45%;border-top:1px solid #333;padding-top:4px}</style></head><body>
  <h1>QARŞILIQLI HESABLAŞMALARIN ÜZLƏŞMƏ AKTI</h1>
  <p style="text-align:center">${fmtDT(from)} — ${fmtDT(to)}</p>
  <p><b>${esc(company)}</b> və <b>${esc(s.name)}</b>${s.voen ? ' (VÖEN ' + esc(s.voen) + ')' : ''} arasında</p>
  <table><thead><tr><th>Tarix</th><th>Əməliyyat</th><th>Sənəd</th><th class="n">Borc artımı</th><th class="n">Ödəniş / azalma</th><th class="n">Qalıq</th></tr></thead><tbody>
  <tr><td colspan="5"><b>Dövrün əvvəlinə qalıq</b></td><td class="n"><b>${r2(opening).toFixed(2)}</b></td></tr>
  ${rows.map(e => { bal = r2(bal + e.amount); return `<tr><td>${fmtDT(e.at)}</td><td>${typeLbl[e.type] || e.type}</td><td>${esc(e.docNo || '')} ${esc(e.invoiceNo || '')}</td><td class="n">${e.amount > 0 ? e.amount.toFixed(2) : ''}</td><td class="n">${e.amount < 0 ? (-e.amount).toFixed(2) : ''}</td><td class="n">${bal.toFixed(2)}</td></tr>`; }).join('')}
  <tr><td colspan="5"><b>Dövrün sonuna qalıq (${bal >= 0 ? 'bizim borcumuz' : 'təchizatçının borcu'})</b></td><td class="n"><b>${Math.abs(bal).toFixed(2)} ₼</b></td></tr>
  </tbody></table>
  <div class="sig"><div>${esc(company)}<br><br>İmza: ____________</div><div>${esc(s.name)}<br><br>İmza: ____________</div></div>
  <script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}

/* ═══ KÖHNƏ ALIŞLAR (yalnız oxunur) ═══ */
async function openLegacy() {
  const snap = await db.ref('purchases').once('value');
  const list = Object.entries(snap.val() || {}).map(([id, p]) => ({ id, ...p })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  modal({ title: 'Köhnə alışlar (arxiv, yalnız baxış)', wide: true, body: `
    <p class="yzi-hint">Bunlar köhnə sistemdə yazılmış alışlardır. Onların anbar və borc təsiri köçürmə zamanı ilkin qalıq kimi götürülüb.</p>
    <div class="yzi-table-wrap"><table class="yzi-table yzi-table--mini"><thead><tr><th>Tarix</th><th>Təchizatçı</th><th>Faktura</th><th>Mallar</th><th class="n">Məbləğ</th><th class="n">Ödənilib</th></tr></thead><tbody>
    ${list.map(p => `<tr><td>${p.createdAt ? fmtDT(p.createdAt) : esc(p.date || '')}</td><td>${esc(p.supplierName || '')}</td><td>${esc(p.invoiceNumber || '')}</td><td class="mut">${esc((p.items || []).map(i => `${i.qty} ${i.unit || ''} ${i.name}`).join(', '))}</td><td class="n">${fmtMoney(p.totalAmount)}</td><td class="n">${fmtMoney(p.paidAmount)}</td></tr>`).join('') || '<tr><td colspan="6" class="yzi-empty">Köhnə alış yoxdur.</td></tr>'}
    </tbody></table></div>`, actions: [{ label: 'Bağla', cancel: true, cls: 'yzi-btn--ghost' }] });
}

/* ═══ QEYDİYYAT ═══ */
const anyPurchasePerm = () => ['purchase.view', 'purchase.create', 'purchase.approve'].some(can);
registerTab({ id: 'purchases', group: 'acc', label: 'Alış qaimələri', order: 3, perm: anyPurchasePerm, render: renderPurchases, live: ['docs', 'suppliers'] });
registerTab({ id: 'suppliers', group: 'reg', label: 'Təchizatçılar', order: 42, perm: () => can('purchase.approve') || can('supplier.manage') || can('supplier.payment.create') || can('supplier.payment.approve'), render: renderSuppliers, live: ['suppliers', 'docs'] });
