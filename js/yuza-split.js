/* ═══════════════════════════════════════════
   YUZA POS — HESABI QONAQLARA GÖRƏ BÖLMƏK (C18) VƏ MASALARI BİRLƏŞDİRMƏK (C19) · 22.11.2026
   C18:
   • Sifariş ekranı → Digər → "Hesabı böl": masada qonaq rejimi açılır, səbətin üstündə [Ümumi][1][2][+].
   • Seçilmiş qonağa vurulan mal həmin qonağa yazılır; "Ümumi" — ad yazılmır, qonaqlar arasında bərabər bölünür
     (və ya bölgü pəncərəsində bir qonağa verilir). Mətbəx kartında və çekdə qeyd: "Qonaq 1" (və ya adı).
   • "Hesabı böl" pəncərəsi: hər qonağın malları, ümumi payı, borcu, ödədiyi; ayrıca ön hesab (çap) və ödəniş.
     Xidmət haqqı / endirim / ƏDV payla bölünür. Hamı ödəyəndə masa avtomatik bağlanır (icazə varsa).
   C19:
   • Digər → "Masaları birləşdir": başqa açıq masanın sifarişi bu masaya köçür (mallar, ödənişlər, nisyələr,
     mətbəx kartları), o masa boşalır. Endirimli masa birləşdirilmir (əvvəlcə endirimi götürün).
   Baza: tableOrders/{masa}/split = { on, guests: { "1": { name } } }, items/{k}/guest, guestPaid/{n}
═══════════════════════════════════════════ */
import { db, R } from './firebase-service.js';
import { state } from './state.js';
import { hasPermission } from './permissions.js';
import { addLog, showToast, formatItemsList, computeOrderTotals, serverNow } from './utils.js';
import { modal, ok, fail, esc } from './yuza-inv-ui.js';
import { printReceipt } from './printer-service.js';

const m2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const money = (n) => m2(n).toFixed(2) + ' ₼';
const I = (id) => `<svg class="icon"><use href="#i-${id}"></use></svg>`;
const orderOf = (t) => state.tableOrders?.[t] || null;

/* ── Qonaqlar ── */
export const splitOn = (t) => !!orderOf(t)?.split?.on;
export function guestsOf(t) {
  const g = orderOf(t)?.split?.guests || {};
  return Object.keys(g).map(Number).filter(n => n > 0).sort((a, b) => a - b).map(n => ({ n, name: g[n]?.name || '' }));
}
export const guestLabel = (t, n) => { if (!n) return 'Ümumi'; const g = guestsOf(t).find(x => x.n === Number(n)); return g?.name ? g.name : `Qonaq ${n}`; };
export const tag = (t, n) => { if (!n) return ''; const nm = guestsOf(t).find(x => x.n === Number(n))?.name || ''; return `<b class="yz-g-tag" title="${esc(guestLabel(t, n))}">${esc(nm && nm.length <= 10 ? nm : 'Q' + n)}</b>`; };

/* Seçilmiş qonaq (yeni mallar ona yazılır) */
const selKey = '_splitGuest';
export function curGuest(t) {
  if (!splitOn(t)) return 0;
  state[selKey] = state[selKey] || {};
  const v = state[selKey][t];
  const gs = guestsOf(t);
  if (v === 0) return 0;
  if (v && gs.some(g => g.n === v)) return v;
  return gs[0]?.n || 0;
}
const setGuest = (t, n) => { state[selKey] = state[selKey] || {}; state[selKey][t] = n; };

/* ── Hər qonağın borcu ── */
const sub = (it) => it.compliment ? 0 : (it.price || 0) * (it.qty || 0) * (1 - ((it.discountPercent || 0) / 100)) + (it.extraFee || 0);
export function dues(t) {
  const o = orderOf(t); if (!o) return { list: [], shared: [] };
  const gs = guestsOf(t), ids = new Set(gs.map(g => g.n));
  const own = {}; gs.forEach(g => { own[g.n] = 0; });
  let sharedSum = 0, all = 0;
  const shared = [];
  Object.entries(o.items || {}).forEach(([k, it]) => {
    const s = sub(it); all += s;
    if (it.guest && ids.has(Number(it.guest))) own[it.guest] += s;
    else { sharedSum += s; shared.push({ k, it, s }); }
  });
  const nG = gs.length || 1;
  const total = Number(o.total) || 0;
  let acc = 0;
  const list = gs.map((g, i) => {
    const base = own[g.n] + sharedSum / nG;
    let due = all > 0 ? m2(total * base / all) : 0;
    if (i === gs.length - 1) due = m2(total - acc);     // yuvarlaqlaşdırma qalığı sonuncuya
    acc = m2(acc + due);
    const paid = m2(o.guestPaid?.[g.n] || 0);
    return { ...g, label: guestLabel(t, g.n), own: m2(own[g.n]), shared: m2(sharedSum / nG), due, paid, left: m2(Math.max(0, due - paid)) };
  });
  return { list, shared, sharedSum: m2(sharedSum), nG };
}

/* ── Qonaq rejimini aç / qonaq əlavə et / ad ── */
async function enable(t) {
  await R.tableOrders.child(t).child('split').update({ on: true, guests: orderOf(t)?.split?.guests || { 1: { name: '' }, 2: { name: '' } } });
  addLog('split', `${state.user?.name}: "${tName(t)}" masasında hesab qonaqlara bölündü`, { tableId: t });
}
async function addGuest(t) {
  const gs = guestsOf(t); const n = (gs[gs.length - 1]?.n || 0) + 1;
  await R.tableOrders.child(t).child(`split/guests/${n}`).set({ name: '' });
  setGuest(t, n);
  return n;
}
const tName = (t) => state.tables.find(x => x.id === t)?.name || 'Masa';

/* ═══ Səbətin üstündəki qonaq düymələri ═══ */
function ensureBar() {
  const t = state.orderTableId || state.noteTableId;
  const list = document.getElementById('orderDraftList'); if (!list) return;
  let bar = document.getElementById('yzGuestBar');
  if (!t || !splitOn(t) || !document.getElementById('orderScreen')?.classList.contains('active')) { bar?.remove(); return; }
  if (!bar) {
    bar = document.createElement('div'); bar.id = 'yzGuestBar'; bar.className = 'yz-gbar'; bar.setAttribute('role', 'radiogroup'); bar.setAttribute('aria-label', 'Qonaq');
    list.parentNode.insertBefore(bar, list);
    bar.addEventListener('click', async (e) => {
      const tt = state.orderTableId || state.noteTableId;
      const b = e.target.closest('[data-g]'); if (!b) return;
      if (b.dataset.g === '+') { await addGuest(tt); } else setGuest(tt, Number(b.dataset.g));
      bar.dataset.sig = ''; ensureBar();
    });
  }
  const cur = curGuest(t), gs = guestsOf(t);
  const sig = `${t}:${cur}:${gs.map(g => g.n + g.name).join(',')}`;
  if (bar.dataset.sig === sig) return; bar.dataset.sig = sig;
  bar.innerHTML = `<span class="yz-gbar__l">Kimə:</span>` + [{ n: 0 }, ...gs].map(g => `<button type="button" role="radio" aria-checked="${cur === g.n}" class="yz-gbar__b${cur === g.n ? ' is-on' : ''}" data-g="${g.n}" title="${esc(guestLabel(t, g.n))}">${g.n ? esc(g.name || String(g.n)) : 'Ümumi'}</button>`).join('')
    + `<button type="button" class="yz-gbar__b yz-gbar__add" data-g="+" aria-label="Qonaq əlavə et">+</button>`;
}

/* ═══ "Hesabı böl" pəncərəsi ═══ */
export async function openSplit(t = state.noteTableId) {
  const o = orderOf(t);
  if (!o || !Object.keys(o.items || {}).length) { if (!splitOn(t)) { await enable(t); ok('Qonaq rejimi açıldı — malları qonaqlara vurun'); } return; }
  if (!splitOn(t)) await enable(t);
  const m = modal({ title: `${I('users')} Hesabı böl · ${esc(tName(t))}`, wide: true, body: '<div id="yzSplitBox"></div>', actions: [{ label: 'Bağla', cancel: true }] });
  const box = m.body.querySelector('#yzSplitBox');
  const draw = () => {
    const o2 = orderOf(t); if (!o2) { m.close(); return; }
    const d = dues(t), gs = guestsOf(t);
    const itemsOf = (n) => Object.entries(o2.items || {}).filter(([, it]) => Number(it.guest) === n);
    const canPay = hasPermission('bill.payment_cash') || hasPermission('bill.payment_pos');
    box.innerHTML = `
      ${d.shared.length ? `<section class="yz-sp-shared"><h3>Ümumi mallar <small>(${money(d.sharedSum)} — ${d.nG} qonağa bərabər bölünür)</small></h3>
        ${d.shared.map(({ k, it, s }) => `<div class="yz-sp-row"><span>${esc(it.qty)}× ${esc(it.name)}</span><b>${money(s)}</b>
          <select data-assign="${esc(k)}" aria-label="Kimə"><option value="0">Bərabər böl</option>${gs.map(g => `<option value="${g.n}">${esc(guestLabel(t, g.n))}</option>`).join('')}</select></div>`).join('')}</section>` : ''}
      <div class="yz-sp-grid">${d.list.map(g => `<section class="yz-sp-g${g.left <= 0.01 && g.due > 0 ? ' is-paid' : ''}">
        <header><input type="text" value="${esc(g.name)}" placeholder="Qonaq ${g.n}" maxlength="20" data-gname="${g.n}" aria-label="Qonağın adı"><span>${g.left <= 0.01 && g.due > 0 ? '✓ ödəyib' : ''}</span></header>
        <div class="yz-sp-items">${itemsOf(g.n).map(([k, it]) => `<div class="yz-sp-row"><span>${esc(it.qty)}× ${esc(it.name)}</span><b>${money(sub(it))}</b>
            <select data-assign="${esc(k)}" aria-label="Kimə"><option value="${g.n}">${esc(guestLabel(t, g.n))}</option><option value="0">Ümumiyə</option>${gs.filter(x => x.n !== g.n).map(x => `<option value="${x.n}">${esc(guestLabel(t, x.n))}</option>`).join('')}</select></div>`).join('') || '<p class="yzi-empty">Malı yoxdur</p>'}
          ${d.shared.length ? `<div class="yz-sp-row yz-sp-sh"><span>Ümumi pay</span><b>${money(g.shared)}</b></div>` : ''}</div>
        <footer><div><small>Hesab</small><b>${money(g.due)}</b></div><div><small>Ödəyib</small><b>${money(g.paid)}</b></div><div><small>Qalıq</small><b class="${g.left > 0.01 ? 'yzi-bad' : 'yzi-ok'}">${money(g.left)}</b></div></footer>
        <div class="yz-sp-act"><button type="button" class="yzi-btn yzi-btn--ghost" data-pre="${g.n}">${I('printer')} Ön hesab</button>
          ${canPay && g.left > 0.01 ? `<button type="button" class="yzi-btn yzi-btn--gold" data-pay="${g.n}">${I('cash')} Ödə</button>` : ''}</div>
      </section>`).join('')}</div>
      <div class="yz-sp-foot"><button type="button" class="yzi-btn yzi-btn--ghost" data-addg>+ Qonaq</button>
        <span>Masanın hesabı: <b>${money(o2.total)}</b> · ödənilib: <b>${money(o2.paidAmount || 0)}</b> · qalıq: <b>${money(o2.remainingAmount ?? o2.total)}</b></span></div>`;
  };
  box.addEventListener('change', async (e) => {
    const a = e.target.closest('[data-assign]');
    if (a) { await R.tableOrders.child(t).child(`items/${a.dataset.assign}/guest`).set(Number(a.value) || null); setTimeout(draw, 200); return; }
    const nm = e.target.closest('[data-gname]');
    if (nm) { await R.tableOrders.child(t).child(`split/guests/${nm.dataset.gname}/name`).set(nm.value.trim().slice(0, 20).replace(/[<>"'`&]/g, '')); setTimeout(draw, 200); }
  });
  box.addEventListener('click', async (e) => {
    if (e.target.closest('[data-addg]')) { await addGuest(t); setTimeout(draw, 200); return; }
    const pr = e.target.closest('[data-pre]'); if (pr) { printGuest(t, Number(pr.dataset.pre)); return; }
    const py = e.target.closest('[data-pay]');
    if (py) { m.close(); payGuest(t, Number(py.dataset.pay)); }
  });
  draw();
}

/* Qonağın ön hesabı (çek) */
export function printGuest(t, n) {
  const o = orderOf(t); if (!o) return;
  const d = dues(t), g = d.list.find(x => x.n === n); if (!g) return;
  const items = [];
  Object.values(o.items || {}).forEach(it => {
    if (Number(it.guest) === n) items.push(it);
    else if (!it.guest || !guestsOf(t).some(x => x.n === Number(it.guest))) items.push({ ...it, name: `${it.name} (ümumi 1/${d.nG})`, qty: m2(it.qty / d.nG) });
  });
  printReceipt(t, { table: { name: `${tName(t)} · ${g.label}` }, order: { ...o, items: Object.fromEntries(items.map((it, i) => [i, it])), total: g.left > 0 ? g.left : g.due, serviceChargeAmount: 0, discountValue: 0 }, noMark: true });
  addLog('bill_print', `${state.user?.name}: "${tName(t)}" — ${g.label} üçün ön hesab (${money(g.due)})`, { tableId: t, guest: n });
  ok(`${g.label}: ön hesab çapa göndərildi`);
}
/* Qonağın ödənişi — mövcud ödəniş pəncərəsi, məbləğ qonağın qalığı ilə məhdud */
export function payGuest(t, n) {
  const g = dues(t).list.find(x => x.n === n); if (!g) return;
  window.staffApp?.payment?.open(t, { guest: n, cap: g.left, label: g.label });
}

/* Ödənişdən sonra: hamı ödəyibsə masa avtomatik bağlanır */
export async function afterPay(t) {
  const o = orderOf(t);
  if (!o || !splitOn(t) || (o.remainingAmount ?? 1) > 0.01) return false;
  if (!hasPermission('table.close')) return false;
  const res = await window.staffApp?.tableBoard?.confirmDeactivate(t);
  if (res?.ok) { showToast(`${I('check')} Bütün qonaqlar ödədi — masa bağlandı`); window.staffApp?.closeTableDetail?.(); return true; }
  return false;
}

/* ═══ C19 · MASALARI BİRLƏŞDİR ═══ */
export function openMerge(t = state.noteTableId) {
  if (!(hasPermission('table.merge') || hasPermission('table.transfer'))) { fail('Masaları birləşdirmək icazəniz yoxdur'); return; }
  const others = state.tables.filter(x => x.id !== t && x.occupant && x.occupant !== '__moving' && orderOf(x.id)?.items);
  if (!others.length) { fail('Birləşdiriləcək başqa açıq masa yoxdur'); return; }
  const m = modal({
    title: `${I('chair')} Masaları birləşdir`,
    body: `<p class="yzi-p">Seçilən masanın sifarişi <b>${esc(tName(t))}</b> masasına köçəcək, o masa boşalacaq. Ödənişlər, nisyələr və mətbəx kartları da köçür.</p>
      <div class="yz-mg-list">${others.map(x => { const o = orderOf(x.id); return `<label class="yz-mg-row"><input type="radio" name="yzMg" value="${esc(x.id)}">
        <span><b>${esc(x.name)}</b><small>${esc(formatItemsList(o.items))}</small></span><b>${money(o.total)}</b></label>`; }).join('')}</div>`,
    actions: [{ label: 'Ləğv et', cancel: true }, { label: 'Birləşdir', cls: 'yzi-btn--gold', onClick: async (b) => {
      const from = b.querySelector('input[name="yzMg"]:checked')?.value;
      if (!from) throw new Error('Masa seçin');
      await mergeInto(from, t);
    } }]
  });
  return m;
}
export async function mergeInto(fromId, toId) {
  const [a, b] = await Promise.all([R.tableOrders.child(toId).once('value').then(s => s.val()), R.tableOrders.child(fromId).once('value').then(s => s.val())]);
  if (!a || !b) throw new Error('Masalardan birində sifariş yoxdur');
  if ((a.discountValue || 0) > 0 || (b.discountValue || 0) > 0) throw new Error('Endirimli masa birləşdirilmir — əvvəlcə endirimi götürün');
  const items = { ...(a.items || {}) };
  const sfx = '_m' + Date.now().toString(36);
  Object.entries(b.items || {}).forEach(([k, it]) => { items[items[k] ? k + sfx : k] = { ...it, guest: null }; });
  const tot = computeOrderTotals(items);
  const paid = m2((a.paidAmount || 0) + (b.paidAmount || 0));
  const fromT = state.tables.find(x => x.id === fromId), toT = state.tables.find(x => x.id === toId);
  const merged = {
    ...a, items, total: tot.total, serviceChargeAmount: tot.serviceChargeAmount, serviceChargePercent: tot.serviceChargePercent,
    paidAmount: paid, remainingAmount: m2(Math.max(0, tot.total - paid)),
    pays: { ...(a.pays || {}), ...(b.pays || {}) }, charges: { ...(a.charges || {}), ...(b.charges || {}) },
    firstOrderAt: Math.min(a.firstOrderAt || Infinity, b.firstOrderAt || Infinity) === Infinity ? (a.firstOrderAt || null) : Math.min(a.firstOrderAt || Infinity, b.firstOrderAt || Infinity),
    mergedFrom: { ...(a.mergedFrom || {}), [fromId]: { name: fromT?.name || '', at: serverNow(), by: state.user?.name || '' } },
    updatedAt: serverNow(), billPrintedAt: null
  };
  const upd = {
    [`tableOrders/${toId}`]: merged, [`tableOrders/${fromId}`]: null,
    [`tables/${fromId}/occupant`]: null, [`tables/${fromId}/notes`]: '', [`tables/${fromId}/activatedAt`]: null, [`tables/${fromId}/sessionId`]: null,
    [`tables/${fromId}/openedById`]: null, [`tables/${fromId}/openedByName`]: null
  };
  if (fromT?.notes) upd[`tables/${toId}/notes`] = [toT?.notes, fromT.notes].filter(Boolean).join(' · ');
  (state.kitchenOrders || []).filter(ko => ko.tableId === fromId).forEach(ko => { upd[`kitchenOrders/${ko.id}/tableId`] = toId; upd[`kitchenOrders/${ko.id}/tableName`] = toT?.name || ''; });
  Object.keys(b.charges || {}).forEach(cid => { upd[`customerCharges/${cid}/tableId`] = toId; upd[`customerCharges/${cid}/tableName`] = toT?.name || ''; });
  // ödəniş jurnalında masa adı yenilənmir (keçmiş fakt) — birləşmə jurnalda qeyd olunur
  await db.ref().update(upd);
  addLog('table_merge', `${state.user?.name} "${fromT?.name}" masasını "${toT?.name}" ilə birləşdirdi: ${formatItemsList(b.items || {})} (${money(b.total)})`, { tableId: toId, fromTableId: fromId, toTableId: toId });
  ok(`"${fromT?.name}" → "${toT?.name}" birləşdirildi`);
}

/* Digər menyusuna düymələr */
function ensureMoreButtons() {
  const menu = document.getElementById('ordMoreMenu'); if (!menu || menu.querySelector('[data-split-open]')) return;
  menu.insertAdjacentHTML('afterbegin', `<button type="button" class="btn" style="border:1px solid var(--border);color:var(--text2);" data-split-open>${I('users')} Hesabı böl</button>
    <button type="button" class="btn" style="border:1px solid var(--border);color:var(--text2);" data-merge-open>${I('chair')} Masaları birləşdir</button>`);
  menu.addEventListener('click', (e) => {
    if (e.target.closest('[data-split-open]')) openSplit(state.noteTableId);
    if (e.target.closest('[data-merge-open]')) openMerge(state.noteTableId);
  });
}

setInterval(() => { ensureMoreButtons(); ensureBar(); }, 500);
window.__yzSplit = { splitOn, curGuest, guestLabel, tag, dues, openSplit, payGuest, printGuest, afterPay, openMerge, mergeInto, guestsOf };
