/* ═══════════════════════════════════════════
   YUZA POS — PORSİYA SAYĞACI (C21 · 21.11.2026)
   Mövcud anbar sistemi üzərində qurulur, yeni anbar məntiqi yoxdur:
   • "Porsiya" = vahidi "porsiya" olan YARIMFABRİKAT (məs. "Kabab porsiyası", texnoloji kart: 1 porsiya = 0,5 kq mal əti).
   • Menyudakı yeməyin ("Kabab") kartında bu yarımfabrikat 1 porsiya kimi yazılır.
   • Aşpaz "Porsiyalar" bölməsində "Hazırla" basır: porsiya sayını və ya ətin kq-nı yazır — o biri normaya görə hesablanır.
     Bu, adi Hazırlama aktıdır (HZ): xammal (ət) BİR DƏFƏ silinir, porsiyalar anbara girir.
     Real çıxım normadan fərqlidirsə (5 kq-dan 10 yox, 9 porsiya) — ikisi də yazılır, "Çıxım hesabatı"nda görünür.
   • Satış (mətbəxə göndərmə) porsiyanı silir, ləğv qaytarır — mövcud satış qaydası ilə.
   • Menyuda: "7 porsiya" (limitdə narıncı), 0-da "Bitdi" — əlavə etmək olmur. Göndərmə anında yoxlama (C22) da buna baxır.
   • Qalan porsiyalar ertəsi günə keçir (anbar qalığıdır). Xarab olan — "Sil" (Silinmə aktı).
   • Limitə düşəndə və bitəndə: mətbəx ekranına və "Porsiya xəbərdarlığı" icazəsi olanlara bildiriş + səs.
═══════════════════════════════════════════ */
import { db } from './firebase-service.js';
import { state } from './state.js';
import { hasPermission } from './permissions.js';
import { showToast } from './utils.js';
import { playNotifSound } from './notifSounds.js';
import {
  inv, onInv, product, productList, stockIn, saleWarehouseFor, unitCost, r2, r3, r4, num, fmtQty, fmtDT, fmtMoney,
  createDoc, canCreate, canApprove, can, docs, watchDocs, DOCS, WRITEOFF_REASONS, uid
} from './yuza-inv-core.js';
import { registerTab, fresh, modal, ok, fail, esc, numInput, whOptions } from './yuza-inv-ui.js';

export const DEFAULT_LIMIT = 3;
const MASS = ['kq', 'qr', 'litr', 'ml'];

/* ── Porsiya məhsulları ── */
export const isPortion = (p) => !!(p && !p.archived && p.type === 'semi' && p.unit === 'porsiya');
export const portionList = () => productList({ types: ['semi'] }).filter(isPortion).sort((a, b) => String(a.name).localeCompare(String(b.name), 'az'));
export const limitOf = (p) => { const n = Number(p?.portionLimit); return Number.isFinite(n) && n >= 0 ? n : DEFAULT_LIMIT; };
const whOf = (p) => saleWarehouseFor(p);
export const leftOf = (p) => r3(stockIn(whOf(p), p.id));

/* Menyudakı yemək neçə porsiya ilə məhdudlaşır (porsiya yarımfabrikatı yoxdursa — null) */
export function menuPortion(menuItemId) {
  const dish = product(menuItemId);
  if (!dish || !dish.recipe) return null;
  const wh = saleWarehouseFor(dish);
  let best = null;
  for (const [cid, line] of Object.entries(dish.recipe)) {
    const c = product(cid);
    if (!isPortion(c)) continue;
    const gross = Number(line?.gross ?? line) || 0; if (!(gross > 0)) continue;
    const n = Math.max(0, Math.floor(r3(stockIn(wh, cid) / gross) + 1e-9));
    if (!best || n < best.left) best = { left: n, limit: limitOf(c), pid: cid, name: c.name };
  }
  return best;
}
window.__yzPortion = menuPortion;
// C22: göndərmə anında yoxlama porsiya sayına da baxır
window.__yzAvailExtra = (menuItemId) => { const x = menuPortion(menuItemId); return x ? x.left : null; };

/* ── Norma: əsas xammal (ən ağır kütlə/həcm sətri) ── */
export function normOf(p) {
  const yieldQty = Number(p.yieldQty) || 1;
  const lines = Object.entries(p.recipe || {}).map(([cid, l]) => {
    const c = product(cid);
    return { pid: cid, name: c?.name || '?', unit: c?.unit || '', per: r4((Number(l?.gross ?? l) || 0) / yieldQty) };
  }).filter(l => l.per > 0);
  const main = lines.filter(l => MASS.includes(l.unit)).sort((a, b) => b.per - a.per)[0] || lines[0] || null;
  return { lines, main };
}
const normText = (p) => { const { lines } = normOf(p); return lines.length ? '1 porsiya = ' + lines.map(l => `${fmtQty(l.per)} ${esc(l.unit)} ${esc(l.name)}`).join(', ') : '<span class="yzi-bad">Texnoloji kart yoxdur</span>'; };

/* ═══ HAZIRLA (Hazırlama aktı) ═══ */
export function openPrepare(pid) {
  const p = product(pid);
  if (!p) return;
  if (!(canCreate('production') || canApprove('production'))) { fail('Hazırlama aktı yaratmaq icazəniz yoxdur'); return; }
  const { lines, main } = normOf(p);
  if (!main) { fail('Bu porsiyanın texnoloji kartı (norması) yoxdur — Kataloqda əlavə edin'); return; }
  const st = { portions: '', mainQty: '', last: null };
  const m = modal({
    title: `Hazırla · ${esc(p.name)}`,
    body: `<div class="yz-pr-form">
      <p class="yzi-p">${normText(p)}</p>
      <div class="yzi-grid2">
        <label class="yzi-f"><span>Alınan porsiya</span>${numInput('id="yzPrN" placeholder="məs. 10"', '')}</label>
        <label class="yzi-f"><span>Sərf olunan ${esc(main.name)} (${esc(main.unit)})</span>${numInput('id="yzPrM" placeholder="məs. 5"', '')}</label>
      </div>
      <p class="yzi-hint" id="yzPrInfo">Birini yazın — o biri normaya görə hesablanacaq. Real nəticə normadan fərqlidirsə, ikisini də yazın.</p>
      <label class="yzi-f"><span>Anbar</span><select id="yzPrWh">${whOptions(whOf(p))}</select></label>
      <label class="yzi-f"><span>Qeyd</span><input type="text" id="yzPrNote" maxlength="200"></label></div>`,
    actions: [
      { label: 'Ləğv et', cancel: true },
      { label: 'Hazırla', cls: 'yzi-btn--gold', onClick: async (b) => {
        const n = num(b.querySelector('#yzPrN').value), mq = num(b.querySelector('#yzPrM').value);
        if (!(n > 0) || !(mq > 0)) throw new Error('Porsiya sayını və ya xammalın miqdarını yazın');
        const normQty = r3(mq / main.per);                  // bu qədər xammaldan normaya görə alınmalı porsiya
        const k = normQty;                                    // bütün xammal sətirləri sərf olunan əsas xammala görə
        const out = {};
        lines.forEach((l, i) => { out[i] = { pid: l.pid, name: l.name, unit: l.unit, qty: r4(l.per * k) }; });
        out[lines.findIndex(l => l.pid === main.pid)].qty = r4(mq);
        const whId = b.querySelector('#yzPrWh').value || whOf(p);
        const data = { at: Date.now(), whId, note: b.querySelector('#yzPrNote').value.trim().slice(0, 200), lines: out,
          productId: p.id, productName: p.name, qty: r3(n), portion: true, normQty, mainPid: main.pid, mainQty: r4(mq) };
        const approveNow = canApprove('production', { createdBy: uid() });   // öz aktını təsdiqləmək: Rəhbər və ya ayarlarda icazə
        await createDoc('production', data, { approveNow });
        const diff = r3(n - normQty);
        ok(approveNow ? `${fmtQty(n)} porsiya əlavə olundu${Math.abs(diff) >= 0.5 ? ` (norma ${fmtQty(normQty)})` : ''}` : 'Akt təsdiqə göndərildi — təsdiqlənəndə porsiyalar əlavə olunacaq');
      } }
    ]
  });
  const box = m.body;
  const iN = box.querySelector('#yzPrN'), iM = box.querySelector('#yzPrM'), info = box.querySelector('#yzPrInfo');
  const paint = () => {
    const n = num(iN.value), mq = num(iM.value);
    if (n > 0 && mq > 0) {
      const norm = r3(mq / main.per), d = r3(n - norm);
      info.innerHTML = `Norma: ${fmtQty(mq)} ${esc(main.unit)} → <b>${fmtQty(norm)}</b> porsiya. Real: <b>${fmtQty(n)}</b>` +
        (Math.abs(d) >= 0.01 ? ` · fərq <b class="${d < 0 ? 'yzi-bad' : 'yzi-ok'}">${d > 0 ? '+' : ''}${fmtQty(d)} (${d > 0 ? '+' : ''}${r2(d / norm * 100)}%)</b>` : ' · normaya uyğun');
    }
  };
  iN.addEventListener('input', () => { st.last = 'n'; if (!st.mTouched) { const n = num(iN.value); iM.value = n > 0 ? String(r4(n * main.per)) : ''; } paint(); });
  iM.addEventListener('input', () => { st.mTouched = true; if (st.last !== 'n' || !iN.value) { const mq = num(iM.value); iN.value = mq > 0 ? String(Math.floor(r3(mq / main.per) + 1e-9)) : ''; } paint(); });
  setTimeout(() => iN.focus(), 50);
}

/* ═══ SİL (xarab) — Silinmə aktı ═══ */
export function openSpoil(pid) {
  const p = product(pid); if (!p) return;
  if (!(canCreate('writeoff') || canApprove('writeoff'))) { fail('Silinmə aktı yaratmaq icazəniz yoxdur'); return; }
  modal({
    title: `Sil · ${esc(p.name)}`,
    body: `<p class="yzi-p">Qalıq: <b>${fmtQty(leftOf(p))}</b> porsiya</p>
      <div class="yzi-grid2"><label class="yzi-f"><span>Neçə porsiya</span>${numInput('id="yzSpN"', '')}</label>
      <label class="yzi-f"><span>Səbəb</span><select id="yzSpR">${WRITEOFF_REASONS.map(r => `<option>${esc(r)}</option>`).join('')}</select></label></div>`,
    actions: [{ label: 'Ləğv et', cancel: true }, { label: 'Sil', cls: 'yzi-btn--danger', onClick: async (b) => {
      const n = num(b.querySelector('#yzSpN').value);
      if (!(n > 0)) throw new Error('Porsiya sayını yazın');
      const approveNow = canApprove('writeoff', { createdBy: uid() });
      await createDoc('writeoff', { at: Date.now(), whId: whOf(p), reason: b.querySelector('#yzSpR').value, note: 'Porsiya',
        lines: { 0: { pid: p.id, name: p.name, unit: 'porsiya', qty: r4(n) } } }, { approveNow });
      ok(approveNow ? `${fmtQty(n)} porsiya silindi` : 'Silinmə aktı təsdiqə göndərildi');
    } }]
  });
}

/* ═══ PORSİYALAR bölməsi ═══ */
const canSeeTab = () => can('stock.view') || can('stock.production.create') || can('stock.production.approve');
function renderBoard(host) {
  watchDocs();
  const el = fresh(host); const again = () => renderBoard(host);
  const list = portionList();
  const prods = Object.entries(docs[DOCS.production.node] || {}).map(([id, d]) => ({ id, ...d }))
    .filter(d => d.portion && d.status === 'approved' && (d.at || 0) > Date.now() - 30 * 86400000).sort((a, b) => (b.at || 0) - (a.at || 0));
  const canLimit = can('catalog.edit') || state.user?.role === 'admin';
  el.innerHTML = `
    <div class="yzi-head"><div><div class="yzi-eyebrow">ANBAR</div><h1 class="yzi-h1">Porsiyalar</h1></div></div>
    <p class="yzi-p">Hazırlanmış porsiyaların qalığı. Satış (mətbəxə göndərmə) porsiyanı silir, ləğv qaytarır. Qalan porsiya ertəsi günə keçir.</p>
    ${list.length ? `<div class="yzi-table-wrap"><table class="yzi-table yz-pr-table">
      <thead><tr><th>Porsiya</th><th class="n">Qalıq</th><th class="n">Limit</th><th>Norma</th><th></th></tr></thead>
      <tbody>${list.map(p => {
        const left = leftOf(p), lim = limitOf(p), cls = left <= 0 ? 'is-out' : left <= lim ? 'is-low' : 'is-ok';
        return `<tr class="${cls}"><td><b>${esc(p.name)}</b></td>
          <td class="n"><span class="yz-pr-left ${cls}">${left <= 0 ? 'Bitdi' : fmtQty(left)}</span></td>
          <td class="n">${canLimit ? numInput(`class="yzi-n yz-pr-lim" data-lim="${esc(p.id)}" aria-label="Limit"`, lim) : lim}</td>
          <td class="yz-pr-norm">${normText(p)}</td>
          <td class="yz-pr-act"><button type="button" class="yzi-btn yzi-btn--gold yzi-btn--sm" data-prep="${esc(p.id)}">+ Hazırla</button>
            <button type="button" class="yzi-btn yzi-btn--ghost yzi-btn--sm" data-spoil="${esc(p.id)}">Sil (xarab)</button></td></tr>`;
      }).join('')}</tbody></table></div>`
    : `<div class="yzi-empty"><p>Hələ porsiya yoxdur.</p><p class="yzi-hint">Necə qurulur: Kataloq → yeni <b>Yarımfabrikat</b>, vahid <b>porsiya</b>, texnoloji kart: 1 porsiyaya düşən xammal (məs. 0,5 kq mal əti).
      Sonra menyudakı yeməyin (məs. “Kabab”) texnoloji kartına bu yarımfabrikatdan 1 porsiya əlavə edin.</p></div>`}
    <h2 class="yzi-h2">Çıxım hesabatı · son 30 gün</h2>
    ${prods.length ? `<div class="yzi-table-wrap"><table class="yzi-table">
      <thead><tr><th>Tarix və saat</th><th>Porsiya</th><th class="n">Sərf</th><th class="n">Norma</th><th class="n">Real</th><th class="n">Fərq</th><th>Kim</th></tr></thead>
      <tbody>${prods.map(d => {
        const mp = product(d.mainPid), diff = r3((d.qty || 0) - (d.normQty || 0)), pct = d.normQty ? r2(diff / d.normQty * 100) : 0;
        return `<tr><td>${fmtDT(d.at)}</td><td>${esc(d.productName || '')}</td><td class="n">${fmtQty(d.mainQty)} ${esc(mp?.unit || '')} ${esc(mp?.name || '')}</td>
          <td class="n">${fmtQty(d.normQty)}</td><td class="n"><b>${fmtQty(d.qty)}</b></td>
          <td class="n ${diff < -0.01 ? 'yzi-bad' : diff > 0.01 ? 'yzi-ok' : ''}">${Math.abs(diff) < 0.01 ? '—' : `${diff > 0 ? '+' : ''}${fmtQty(diff)} (${pct > 0 ? '+' : ''}${pct}%)`}</td>
          <td>${esc(d.createdByName || '')}</td></tr>`;
      }).join('')}</tbody></table></div>` : '<p class="yzi-empty">Bu dövrdə porsiya hazırlanmayıb.</p>'}`;
  el.addEventListener('click', (e) => {
    const a = e.target.closest('[data-prep]'); if (a) { openPrepare(a.dataset.prep); return; }
    const s = e.target.closest('[data-spoil]'); if (s) openSpoil(s.dataset.spoil);
  });
  el.querySelectorAll('[data-lim]').forEach(i => i.addEventListener('change', async () => {
    const v = num(i.value);
    if (!(v >= 0)) { fail('Limit 0 və ya daha böyük olmalıdır'); again(); return; }
    try { await db.ref(`products/${i.dataset.lim}/portionLimit`).set(Math.round(v)); ok('Limit yadda saxlanıldı'); } catch (x) { fail(x?.message || String(x)); }
  }));
}
registerTab({ id: 'portions', group: 'stock', label: 'Porsiyalar', order: 19, perm: canSeeTab, render: renderBoard, live: ['stock', 'products', 'docs'] });

/* ═══ LİMİT XƏBƏRDARLIĞI ═══
   Hər cihaz qalığı görür; vəziyyət dəyişəndə (ok → az → bitdi) portionAlerts/{pid} bir dəfə yazılır (tranzaksiya — təkrar olmur).
   Bildirişi mətbəx ekranı və "Porsiya xəbərdarlığı" icazəsi olanlar görür. */
const levelOf = (left, lim) => left <= 0 ? 'out' : left <= lim ? 'low' : 'ok';
let seen = null;
function checkLevels() {
  if (!inv.loaded.products || !inv.loaded.stock || !state.user) return;
  const now = {};
  portionList().forEach(p => { now[p.id] = { lv: levelOf(leftOf(p), limitOf(p)), left: leftOf(p), name: p.name }; });
  if (!seen) { seen = now; return; }       // ilk yüklənmə — yalnız sonrakı dəyişikliklər
  for (const [pid, x] of Object.entries(now)) {
    if (seen[pid]?.lv === x.lv) continue;
    db.ref('portionAlerts/' + pid).transaction(cur => {
      if (cur && cur.lv === x.lv) return;                 // başqa cihaz artıq yazıb
      return { lv: x.lv, left: x.left, name: x.name, at: Date.now() };
    }).catch(() => {});
  }
  seen = now;
}
onInv((what) => { if (what === 'stock' || what === 'products') checkLevels(); });

const wantsAlerts = () => state.user?.role === 'kitchen' || hasPermission('portion.alert');
let alertsOff = null, alertsUser = null;
function watchAlerts() {
  const key = state.user ? `${state.user.role}:${state.user.id || state.user.name}` : null;
  if (key === alertsUser) return;
  alertsUser = key; alertsOff?.(); alertsOff = null;
  if (!state.user || !wantsAlerts()) return;
  const since = Date.now();
  const ref = db.ref('portionAlerts');
  const h = (s) => {
    const a = s.val(); if (!a || !(a.at > since) || a.lv === 'ok') return;
    // bir az gec — eyni anda çıxan "yadda saxlanıldı" kimi bildiriş onu örtməsin
    setTimeout(() => {
    try { playNotifSound('portion_low'); } catch (e) { /* */ }
    showToast(a.lv === 'out'
      ? `<svg class="icon"><use href="#i-warning"></use></svg> <b>${esc(a.name)}</b> bitdi — menyuda “Bitdi” göstərilir. Yenisini hazırlayın.`
      : `<svg class="icon"><use href="#i-warning"></use></svg> <b>${esc(a.name)}</b>: cəmi ${fmtQty(a.left)} porsiya qalıb — ərzaq alın / sabah üçün hazırlayın.`, { ms: 9000 });
    }, 1500);
  };
  ref.on('child_added', h); ref.on('child_changed', h);
  alertsOff = () => { ref.off('child_added', h); ref.off('child_changed', h); };
}
setInterval(watchAlerts, 1500);

/* Menyu kartları porsiya dəyişəndə yenilənsin */
let rt = null;
onInv((what) => {
  if (what !== 'stock' && what !== 'products') return;
  clearTimeout(rt);
  rt = setTimeout(() => { if (document.getElementById('orderScreen')?.classList.contains('active')) window.staffApp?.orderCart?.renderItemsList?.(); }, 250);
});

window.__yzPortions = { menuPortion, openPrepare, openSpoil, portionList, leftOf };
