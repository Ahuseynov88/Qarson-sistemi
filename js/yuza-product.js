/* ═══════════════════════════════════════════
   YUZA POS — MƏHSUL PROFİLİ (tam səhifə)
   Admin → Menyu → mala toxunanda bütün məlumat bir səhifədə açılır və BİRBAŞA redaktə olunur
   (ayrıca "Redaktə et" pəncərəsi lazım deyil; hər dəyişiklik xananı tərk edəndə avtomatik saxlanır).

   Səhifədə: şəkil, ad, kateqoriya, qiymət, təsvir • sürüşən düymələr (Aktiv, Favori,
   QR menyuda göstər, Sayıla bilən, ƏDV qiymətə daxildir) • ƏDV faizi və maya dəyəri •
   satış və faktiki qalıq • qiymət tarixçəsi.

   admin.js-ə toxunmur. Yalnız admin sessiyasında işləyir.
═══════════════════════════════════════════ */
import { R } from './firebase-service.js';
import { state } from './state.js';
import { esc, showToast, addLog } from './utils.js';

const $ = (id) => document.getElementById(id);
const isAdmin = () => state.user?.role === 'admin';
const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : NaN; };
const r2 = (n) => Math.round(n * 100) / 100;
const fmt = (n) => (Number.isFinite(n) ? n.toFixed(2) : '—') + ' ₼';
const NEW_CAT = '__new__';

/* ── Sürüşən düymələr ── */
const FLAGS = [
  { key: 'available',   label: 'Aktiv (satışda)',        hint: 'Söndürəndə mal sifariş siyahısında görünmür',                def: true  },
  { key: 'isFavorite',  label: 'Favori',                 hint: 'Sifariş ekranında "★ Favorilər" bölməsində görünür',        def: false },
  { key: 'showInQr',    label: 'QR menyuda göstər',      hint: 'Müştəri menyusunda görünsün (aktiv mallar)',                def: true  },
  { key: 'isTrackable', label: 'Sayıla bilən mal',       hint: 'Anbarda izlənir, "Məhsul Alışı" bölməsində görünür',        def: false },
  { key: 'vatIncluded', label: 'ƏDV qiymətə daxildir',   hint: 'Söndürülsə ƏDV faizi qiymətin üstünə əlavə olunur',         def: true  }
];
const flagOn = (m, f) => (m[f.key] === undefined || m[f.key] === null) ? f.def : !!m[f.key];

function switchHTML(m, f) {
  const on = flagOn(m, f);
  return `<div class="yz-prow">
    <div class="yz-prow__txt"><b>${f.label}</b><small>${f.hint}</small></div>
    <button type="button" class="yz-switch${on ? ' yz-switch--on' : ''}" role="switch" aria-checked="${on}"
      data-yz-flag="${f.key}" aria-label="${f.label}"><span class="yz-switch__knob"></span></button>
  </div>`;
}

/* ── Maliyyə hesabı ── */
function calc(m) {
  const price = Number(m.price || 0), rate = Number(m.vatRate || 0);
  const incl = m.vatIncluded !== false;
  const vatAmt = rate > 0 ? (incl ? price * rate / (100 + rate) : price * rate / 100) : 0;
  const customerPays = incl ? price : price + vatAmt;
  const net = incl ? price - vatAmt : price;
  const hasCost = m.cost !== undefined && m.cost !== null && m.cost !== '' && Number.isFinite(Number(m.cost));
  const profit = hasCost ? net - Number(m.cost) : NaN;
  const pct = hasCost && net > 0 ? profit / net * 100 : NaN;
  return { price, rate, incl, vatAmt, customerPays, net, hasCost, cost: Number(m.cost), profit, pct };
}

function profitHTML(m) {
  const c = calc(m);
  return `<div class="yz-profit">
    <div><small>Qiymət (menyuda)</small><b>${fmt(c.price)}</b></div>
    <div><small>ƏDV ${c.rate}% ${c.rate > 0 ? (c.incl ? '(daxildir)' : '(əlavə olunur)') : ''}</small><b>${fmt(c.vatAmt)}</b></div>
    <div><small>Müştəri ödəyir</small><b>${fmt(c.customerPays)}</b></div>
    <div><small>Maya dəyəri</small><b>${c.hasCost ? fmt(c.cost) : '—'}</b></div>
    <div class="yz-profit__net"><small>Xalis qazanc</small><b class="${c.profit < 0 ? 'yz-neg' : ''}">${fmt(c.profit)}${Number.isFinite(c.pct) ? ` <em>(${c.pct.toFixed(0)}%)</em>` : ''}</b></div>
  </div>`;
}

function historyHTML(m) {
  const list = Object.values(m.priceHistory || {}).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 15);
  if (!list.length) return '<div class="yz-hist__empty">Qiymət hələ dəyişdirilməyib.</div>';
  return list.map(h => {
    const d = new Date(h.at || 0);
    const when = `${d.toLocaleDateString('az-AZ')} ${d.toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit' })}`;
    const up = Number(h.to) > Number(h.from);
    return `<div class="yz-hist__row">
      <span class="yz-hist__when">${esc(when)}<small>${esc(h.by || '')}</small></span>
      <span class="yz-hist__chg">${fmt(Number(h.from))} → <b class="${up ? 'yz-up' : 'yz-down'}">${fmt(Number(h.to))}</b></span>
    </div>`;
  }).join('');
}

/* ── Satış statistikası: bağlanmış sifarişlərdən (30 san. keş) ── */
let salesCache = null;   // { at, map: id → {qty, revenue, today, month} }
let salesLoading = false;
function loadSales(cb) {
  if (salesCache && Date.now() - salesCache.at < 30000) { cb(salesCache.map); return; }
  if (salesLoading) return;
  salesLoading = true;
  R.closedOrders.once('value').then((snap) => {
    const map = {};
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const orders = snap.val() || {};
    Object.values(orders).forEach(o => {
      const at = o.firstOrderAt || o.closedAt || 0;
      Object.values(o.items || {}).forEach(it => {
        if (!it.menuItemId) return;
        const q = Number(it.qty) || 0;
        const rev = it.compliment ? 0 : (Number(it.price) || 0) * q * (1 - ((it.discountPercent || 0) / 100)) + (Number(it.extraFee) || 0);
        const e = map[it.menuItemId] = map[it.menuItemId] || { qty: 0, revenue: 0, today: 0, month: 0, orders: 0 };
        e.qty += q; e.revenue += rev; e.orders += 1;
        if (at >= dayStart) e.today += q;
        if (at >= monthStart) e.month += q;
      });
    });
    salesCache = { at: Date.now(), map };
    salesLoading = false;
    cb(map);
  }).catch(() => { salesLoading = false; });
}

function statsHTML(m, s) {
  const stockKnown = m.stock !== undefined && m.stock !== null;
  const q = (n) => (Math.round(n * 100) / 100).toString();
  const e = s || { qty: 0, revenue: 0, today: 0, month: 0 };
  return `<div class="yz-profit yz-stats">
    <div><small>Ümumi satılıb</small><b>${s ? q(e.qty) + ' ədəd' : '…'}</b></div>
    <div><small>Ümumi gəlir</small><b>${s ? fmt(e.revenue) : '…'}</b></div>
    <div><small>Bu gün / bu ay</small><b>${s ? q(e.today) + ' / ' + q(e.month) : '…'}</b></div>
    <div class="yz-profit__net"><small>Faktiki qalıq</small><b class="${stockKnown && m.stock <= 0 ? 'yz-neg' : ''}">${stockKnown ? q(Number(m.stock)) + ' ədəd' : 'izlənmir'}</b></div>
  </div>`;
}

/* ── Səhifənin qurulması ── */
function categories(m) {
  const cats = [...new Set((state.menuItems || []).map(x => x.category).filter(Boolean))];
  if (m.category && !cats.includes(m.category)) cats.push(m.category);
  return cats;
}

function pageHTML(m) {
  const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(m.name || '?')}&background=e8b04b&color=1a1205&size=200`;
  const stockKnown = m.stock !== undefined && m.stock !== null;
  return `<div class="yz-prod" id="yzProdPanel" data-id="${esc(m.id)}">
    <div class="yz-prod__head">
      <label class="yz-photo" title="Şəkli dəyiş">
        <img id="yzPhotoImg" src="${esc(m.photo || fallback)}" alt="" onerror="this.src='${fallback}'">
        <span>Şəkli dəyiş</span>
        <input type="file" id="yzPhotoFile" accept="image/*" hidden>
      </label>
      <div class="yz-prod__basic">
        <label class="yz-f"><span>Mal adı</span><input id="yzName" type="text" value="${esc(m.name || '')}" data-save="name"></label>
        <div class="yz-prod__grid">
          <label class="yz-f"><span>Kateqoriya</span>
            <select id="yzCat">${categories(m).map(c => `<option value="${esc(c)}"${c === m.category ? ' selected' : ''}>${esc(c)}</option>`).join('')}<option value="${NEW_CAT}">+ Yeni kateqoriya...</option></select></label>
          <label class="yz-f"><span>Qiymət (₼)</span><input id="yzPrice" type="text" inputmode="decimal" value="${m.price ?? ''}"></label>
        </div>
        <label class="yz-f" id="yzNewCatWrap" style="display:none;"><span>Yeni kateqoriya adı</span><input id="yzNewCat" type="text" placeholder="Məs: Salatlar"></label>
      </div>
    </div>
    <label class="yz-f"><span>Təsvir (istəyə görə)</span><textarea id="yzDesc" rows="2">${esc(m.description || '')}</textarea></label>

    <div class="ct-detail-section-title">Məhsul ayarları</div>
    <div class="yz-prod__box">${FLAGS.map(f => switchHTML(m, f)).join('')}</div>

    <div class="ct-detail-section-title">ƏDV və maliyyət</div>
    <div class="yz-prod__box yz-prod__grid">
      <div class="yz-f"><span>ƏDV faizi (%) — istənilən rəqəm</span>
        <div class="yz-vatrow">
          <input id="yzVat" type="text" inputmode="decimal" value="${Number(m.vatRate || 0)}" aria-label="ƏDV faizi">
          <div class="yz-chips">${[0, 8, 18].map(v => `<button type="button" class="yz-chip" data-yz-vat="${v}">${v}%</button>`).join('')}</div>
        </div></div>
      <label class="yz-f"><span>Maya dəyəri (₼)</span>
        <input id="yzCost" type="text" inputmode="decimal" placeholder="məs: 4.20" value="${m.cost !== undefined && m.cost !== null && m.cost !== '' ? esc(m.cost) : ''}"></label>
    </div>
    <div id="yzProfit">${profitHTML(m)}</div>

    <div class="ct-detail-section-title">Satış və qalıq</div>
    <div id="yzStats">${statsHTML(m, salesCache && salesCache.map[m.id] ? salesCache.map[m.id] : (salesCache ? {} : null))}</div>
    <div class="yz-stockrow">
      <input id="yzStockSet" type="text" inputmode="decimal" placeholder="${stockKnown ? 'Qalığı dəqiqləşdir (məs: ' + m.stock + ')' : 'Anbar qalığı təyin et'}" aria-label="Qalıq">
      <button type="button" class="btn btn-green" data-yz-act="stockset">Təyin et</button>
      <button type="button" class="btn btn-ghost" data-yz-act="stockadd">+ Stok artır</button>
    </div>

    <div class="ct-detail-section-title">Qiymət tarixçəsi</div>
    <div class="yz-prod__box yz-hist" id="yzHist">${historyHTML(m)}</div>

    <div class="yz-prod__danger"><button type="button" class="btn btn-red" data-yz-act="delete"><svg class="icon"><use href="#i-trash"></use></svg> Malı sil</button></div>
  </div>`;
}

function currentItem() {
  const id = state._selectedMenuItemId;
  return id ? (state.menuItems || []).find(x => x.id === id) : null;
}

/* Yazı yazarkən canlı yenilənmə fokusu aparmasın */
let typing = null;
document.addEventListener('focusin', (e) => {
  const t = e.target;
  if (t.closest && t.closest('#yzProdPanel') && /INPUT|TEXTAREA/.test(t.tagName) && t.id) typing = { id: t.id, v: t.value, t: Date.now() };
});
document.addEventListener('input', (e) => { if (typing && e.target.id === typing.id) { typing.v = e.target.value; typing.t = Date.now(); } });
document.addEventListener('focusout', (e) => { if (typing && e.target.id === typing.id) typing = null; });

function render() {
  if (!isAdmin()) return;
  const body = $('menuDetailBody');
  if (!body) return;
  const m = currentItem();
  const panel = $('yzProdPanel');
  if (!m) return;
  if (panel && panel.dataset.id === m.id && body.firstElementChild === panel) return;
  body.innerHTML = pageHTML(m);
  if (typing && Date.now() - typing.t < 4000) {
    const el = $(typing.id);
    if (el) { el.value = typing.v; el.focus(); }
  }
  loadSales((map) => { const el = $('yzStats'); const cur = currentItem(); if (el && cur) el.innerHTML = statsHTML(cur, map[cur.id] || {}); });
}

let obs;
function startObserver() {
  const body = $('menuDetailBody');
  if (!body || obs) return;
  obs = new MutationObserver(render);
  obs.observe(body, { childList: true });
  render();
}

/* ── Yazma əməliyyatları ── */
const update = (id, data) => R.menuItems.child(id).update(data);
const itemById = (id) => (state.menuItems || []).find(x => x.id === id);

function pushHistory(id, from, to) {
  R.menuItems.child(id).child('priceHistory').push({ from, to, at: Date.now(), by: state.user?.name || 'Admin' });
}

function toggleFlag(key, id) {
  const m = itemById(id); if (!m) return;
  const f = FLAGS.find(x => x.key === key);
  const next = !flagOn(m, f);
  update(id, { [key]: next });
  addLog('menu_mgmt', `"${m.name}" — ${f.label}: ${next ? 'AÇIQ' : 'BAĞLI'}`, { menuItemId: id });
}

function saveName(id, v) {
  const m = itemById(id); const name = v.trim();
  if (!m || name === m.name) return;
  if (!name) { showToast('Mal adı boş ola bilməz'); $('yzName').value = m.name; return; }
  update(id, { name }); addLog('menu_mgmt', `Mal adı dəyişdi: ${m.name} → ${name}`, { menuItemId: id });
}

function savePrice(id, raw) {
  const m = itemById(id); if (!m) return;
  const v = num(raw);
  if (!Number.isFinite(v) || v < 0) { showToast('Düzgün qiymət yaz'); $('yzPrice').value = m.price ?? ''; return; }
  const price = r2(v);
  if (price === Number(m.price)) return;
  /* tarixçə ilk növbədə burada yazılır; canlı izləmə eyni dəyişikliyi təkrar yazmasın deyə baza yenilənir */
  pushHistory(id, Number(m.price || 0), price);
  if (priceBase) priceBase[id] = price;
  update(id, { price });
  addLog('menu_mgmt', `"${m.name}" qiyməti: ${Number(m.price || 0).toFixed(2)} → ${price.toFixed(2)} ₼`, { menuItemId: id });
}

function saveCategory(id, sel) {
  const m = itemById(id); if (!m) return;
  if (sel.value === NEW_CAT) { $('yzNewCatWrap').style.display = ''; $('yzNewCat').focus(); return; }
  if (sel.value !== m.category) update(id, { category: sel.value });
}
function saveNewCategory(id, v) {
  const c = v.trim(); if (!c) return;
  update(id, { category: c });
}

function saveMoney(id, field, raw, label) {
  const m = itemById(id); if (!m) return;
  if (String(raw).trim() === '') { update(id, { [field]: null }); return; }
  const v = num(raw);
  if (!Number.isFinite(v) || v < 0) { showToast(`Düzgün ${label} yaz`); return; }
  update(id, { [field]: r2(v) });
}

function setStock(id, raw) {
  const m = itemById(id); const v = num(raw);
  if (!m) return;
  if (!Number.isFinite(v) || v < 0) { showToast('Düzgün qalıq yaz'); return; }
  update(id, { stock: v });
  addLog('menu_mgmt', `Anbar qalığı təyin edildi: ${m.name} (${m.stock ?? '—'} → ${v})`, { menuItemId: id });
  showToast(`${m.name} — qalıq: ${v}`);
}

function livePreview() {
  const m = currentItem(); const el = $('yzProfit'); if (!m || !el) return;
  el.innerHTML = profitHTML({ ...m, price: num($('yzPrice')?.value), vatRate: num($('yzVat')?.value) || 0, cost: $('yzCost')?.value === '' ? null : num($('yzCost')?.value) });
}

document.addEventListener('click', (e) => {
  const p = e.target.closest('#yzProdPanel'); if (!p) return;
  const id = p.dataset.id;
  const fl = e.target.closest('[data-yz-flag]');
  if (fl) { toggleFlag(fl.dataset.yzFlag, id); return; }
  const chip = e.target.closest('[data-yz-vat]');
  if (chip) { $('yzVat').value = chip.dataset.yzVat; saveMoney(id, 'vatRate', chip.dataset.yzVat, 'ƏDV'); livePreview(); return; }
  const act = e.target.closest('[data-yz-act]');
  if (!act) return;
  if (act.dataset.yzAct === 'stockset') { setStock(id, $('yzStockSet').value); $('yzStockSet').value = ''; }
  else if (act.dataset.yzAct === 'stockadd') { if (typeof window.openQuickStockModal === 'function') window.openQuickStockModal(id); }
  else if (act.dataset.yzAct === 'delete') { if (typeof window.deleteMenuItem === 'function') window.deleteMenuItem(id); }
});

document.addEventListener('change', (e) => {
  const p = e.target.closest('#yzProdPanel'); if (!p) return;
  const id = p.dataset.id, t = e.target;
  if (t.id === 'yzName') saveName(id, t.value);
  else if (t.id === 'yzPrice') savePrice(id, t.value);
  else if (t.id === 'yzCat') saveCategory(id, t);
  else if (t.id === 'yzNewCat') saveNewCategory(id, t.value);
  else if (t.id === 'yzDesc') update(id, { description: t.value.trim() });
  else if (t.id === 'yzVat') saveMoney(id, 'vatRate', t.value || '0', 'ƏDV faizi');
  else if (t.id === 'yzCost') saveMoney(id, 'cost', t.value, 'maya dəyəri');
  else if (t.id === 'yzPhotoFile') {
    const file = t.files[0]; if (!file) return;
    if (file.size > 2 * 1024 * 1024) { showToast('Şəkil 2MB-dan böyük olmamalıdır'); t.value = ''; return; }
    const rd = new FileReader();
    rd.onload = (ev) => { update(id, { photo: ev.target.result }); showToast('Şəkil yeniləndi'); };
    rd.readAsDataURL(file);
  }
});
document.addEventListener('input', (e) => {
  if (['yzPrice', 'yzVat', 'yzCost'].includes(e.target.id)) livePreview();
});

/* ── Canlı izləmə: qiymət tarixçəsi (başqa yoldan dəyişsə də) + köhnə yarım porsiya təmizliyi ── */
let priceBase = null;
let cleaned = false;
let lastRaw = null;
function sync(raw) {
  lastRaw = raw;
  const items = Object.entries(raw || {}).map(([id, v]) => ({ id, ...v }));

  if (priceBase === null) {
    priceBase = {};
    items.forEach(m => { priceBase[m.id] = Number(m.price || 0); });
  } else if (isAdmin()) {
    items.forEach(m => {
      const cur = Number(m.price || 0), prev = priceBase[m.id];
      if (prev !== undefined && prev !== cur) {
        const last = Object.values(m.priceHistory || {}).sort((a, b) => (b.at || 0) - (a.at || 0))[0];
        const dup = last && Number(last.to) === cur && Date.now() - (last.at || 0) < 60000;
        if (!dup) pushHistory(m.id, prev, cur);
      }
      priceBase[m.id] = cur;
    });
  }

  /* əvvəlki versiyada yaradılmış yarım porsiya mövqelərini bir dəfə təmizlə */
  if (!cleaned && isAdmin()) {
    cleaned = true;
    items.forEach(m => {
      if (m.isHalf) R.menuItems.child(m.id).remove();
      else if (m.hasHalf !== undefined || m.halfPrice !== undefined) R.menuItems.child(m.id).update({ hasHalf: null, halfPrice: null });
    });
  }
}

let timer = null;
function boot() {
  startObserver();
  setInterval(() => { if (isAdmin() && !cleaned && lastRaw) { try { sync(lastRaw); } catch (e) {} } }, 2000);
  R.menuItems.on('value', (snap) => {
    const raw = snap.val();
    clearTimeout(timer);
    timer = setTimeout(() => { try { sync(raw); } catch (err) { console.warn('yuza-product sync', err); } render(); }, 400);
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

/* ── Menyu kartlarına nişanlar (★, qeyri-aktiv) ── */
function decorateCards() {
  document.querySelectorAll('#sec-menu .tile-card').forEach(card => {
    if (card.dataset.yzDeco) return;
    const m = (state.menuItems || []).find(x => card.getAttribute('onclick')?.includes(`'${x.id}'`));
    if (!m) return;
    card.dataset.yzDeco = '1';
    const nameEl = card.querySelector('.tile-card__name');
    if (nameEl && m.isFavorite) nameEl.insertAdjacentHTML('beforeend', ' <i class="yz-tag yz-tag--fav">★</i>');
  });
}
new MutationObserver(() => { if (isAdmin()) decorateCards(); }).observe(document.body, { childList: true, subtree: true });
