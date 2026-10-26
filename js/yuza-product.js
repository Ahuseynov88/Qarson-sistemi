/* ═══════════════════════════════════════════
   YUZA POS — MƏHSUL PROFİLİ (Mərhələ 1)
   Admin → Menyu → mala toxunanda açılan profilə "Məhsul ayarları" paneli əlavə edir:
     • Sürüşən düymələr: Aktiv (satışda), Favori, QR menyuda göstər, Yeni
     • ƏDV dərəcəsi (qiymətə daxildir), maliyyət (maya dəyəri), xalis qazanc hesabı
     • Yarım porsiya (ayrıca qiymətlə) — avtomatik ayrıca menyu mövqeyi yaradılır
     • Qiymət tarixçəsi (kim, nə vaxt, köhnə → yeni)
   admin.js-ə TOXUNMUR. Yalnız admin sessiyasında işləyir.

   Yarım porsiya: `${malId}_half` açarlı ayrıca menyu mövqeyi (isHalf:true, parentId).
   Sifariş, mətbəx, çek və hesabatlar dəyişmədən işləyir. Ana malın adı/kateqoriyası/
   şəkli/aktivliyi dəyişəndə yarım porsiya avtomatik sinxronlaşır.
═══════════════════════════════════════════ */
import { R } from './firebase-service.js';
import { state } from './state.js';
import { esc, showToast, addLog } from './utils.js';

const $ = (id) => document.getElementById(id);
const isAdmin = () => state.user?.role === 'admin';
const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : NaN; };
const r2 = (n) => Math.round(n * 100) / 100;
const fmt = (n) => (Number.isFinite(n) ? n.toFixed(2) : '—') + ' ₼';
const VAT_RATES = [0, 8, 18];

/* ── Sürüşən düymələr (Aktiv sarı, deaktiv boz) ── */
const FLAGS = [
  { key: 'available',  label: 'Aktiv (satışda)',      hint: 'Söndürəndə mal sifariş siyahısında görünmür', def: true  },
  { key: 'isFavorite', label: 'Favori',               hint: 'Sevimli mallar siyahısında göstər',           def: false },
  { key: 'showInQr',   label: 'QR menyuda göstər',    hint: 'QR / rəqəmsal menyuda görünsün',              def: true  },
  { key: 'isNew',      label: 'Yeni məhsul nişanı',   hint: '"Yeni" işarəsi ilə seçilsin',                 def: false }
];
const flagOn = (m, f) => (m[f.key] === undefined || m[f.key] === null) ? f.def : m[f.key] !== false && !!m[f.key];

function switchHTML(m, f) {
  const on = flagOn(m, f);
  return `<div class="yz-prow">
    <div class="yz-prow__txt"><b>${f.label}</b><small>${f.hint}</small></div>
    <button type="button" class="yz-switch${on ? ' yz-switch--on' : ''}" role="switch" aria-checked="${on}"
      data-yz-flag="${f.key}" aria-label="${f.label}"><span class="yz-switch__knob"></span></button>
  </div>`;
}

function profitHTML(m) {
  const price = Number(m.price || 0), vat = Number(m.vatRate || 0), cost = Number(m.cost);
  const vatAmt = vat > 0 ? price * vat / (100 + vat) : 0;
  const net = price - vatAmt;
  const hasCost = Number.isFinite(cost) && m.cost !== undefined && m.cost !== null && m.cost !== '';
  const profit = hasCost ? net - cost : NaN;
  const pct = hasCost && net > 0 ? (profit / net) * 100 : NaN;
  return `<div class="yz-profit">
    <div><small>Satış qiyməti</small><b>${fmt(price)}</b></div>
    <div><small>ƏDV (${vat}%)</small><b>${fmt(vatAmt)}</b></div>
    <div><small>Maya dəyəri</small><b>${hasCost ? fmt(cost) : '—'}</b></div>
    <div class="yz-profit__net"><small>Xalis qazanc</small><b class="${profit < 0 ? 'yz-neg' : ''}">${fmt(profit)}${Number.isFinite(pct) ? ` <em>(${pct.toFixed(0)}%)</em>` : ''}</b></div>
  </div>`;
}

function historyHTML(m) {
  const list = Object.values(m.priceHistory || {}).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 12);
  if (!list.length) return '<div class="yz-hist__empty">Qiymət hələ dəyişdirilməyib.</div>';
  return list.map(h => {
    const d = new Date(h.at || 0);
    const when = `${d.toLocaleDateString('az-AZ')} ${d.toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit' })}`;
    const up = Number(h.to) > Number(h.from);
    return `<div class="yz-hist__row">
      <span class="yz-hist__when">${esc(when)}<small>${esc(h.by || '')}${h.kind === 'half' ? ' · yarım porsiya' : ''}</small></span>
      <span class="yz-hist__chg">${fmt(Number(h.from))} → <b class="${up ? 'yz-up' : 'yz-down'}">${fmt(Number(h.to))}</b></span>
    </div>`;
  }).join('');
}

function panelHTML(m) {
  const halfOn = !!m.hasHalf;
  const suggest = r2(Number(m.price || 0) / 2);
  return `<div class="yz-prod" id="yzProdPanel" data-id="${esc(m.id)}">
    <div class="ct-detail-section-title">Məhsul ayarları</div>
    <div class="yz-prod__box">${FLAGS.map(f => switchHTML(m, f)).join('')}</div>

    <div class="ct-detail-section-title">Maliyyə və ƏDV</div>
    <div class="yz-prod__box yz-prod__grid">
      <label class="yz-f"><span>ƏDV dərəcəsi (qiymətə daxildir)</span>
        <select id="yzVat">${VAT_RATES.map(v => `<option value="${v}"${Number(m.vatRate || 0) === v ? ' selected' : ''}>${v === 0 ? 'ƏDV yoxdur (0%)' : v + '%'}</option>`).join('')}</select></label>
      <label class="yz-f"><span>Maya dəyəri (₼)</span>
        <input id="yzCost" type="text" inputmode="decimal" placeholder="məs: 4.20" value="${m.cost !== undefined && m.cost !== null && m.cost !== '' ? esc(m.cost) : ''}"></label>
    </div>
    <div id="yzProfit">${profitHTML(m)}</div>

    <div class="ct-detail-section-title">Yarım porsiya</div>
    <div class="yz-prod__box">
      <div class="yz-prow">
        <div class="yz-prow__txt"><b>Yarım porsiya var</b><small>Ayrıca qiymətlə ayrıca mövqe kimi sifariş olunur</small></div>
        <button type="button" class="yz-switch${halfOn ? ' yz-switch--on' : ''}" role="switch" aria-checked="${halfOn}" data-yz-half="1" aria-label="Yarım porsiya"><span class="yz-switch__knob"></span></button>
      </div>
      ${halfOn ? `<label class="yz-f yz-f--half"><span>Yarım porsiya qiyməti (₼) <small>təklif: ${suggest.toFixed(2)}</small></span>
        <input id="yzHalfPrice" type="text" inputmode="decimal" placeholder="${suggest.toFixed(2)}" value="${m.halfPrice !== undefined && m.halfPrice !== null ? esc(m.halfPrice) : ''}"></label>` : ''}
    </div>

    <div class="ct-detail-section-title">Qiymət tarixçəsi</div>
    <div class="yz-prod__box yz-hist" id="yzHist">${historyHTML(m)}</div>
  </div>`;
}

/* ── Paneli profilə yerləşdir ── */
function currentItem() {
  const id = state._selectedMenuItemId;
  return id ? (state.menuItems || []).find(x => x.id === id) : null;
}

function inject() {
  if (!isAdmin()) return;
  const body = $('menuDetailBody');
  if (!body) return;
  const m = currentItem();
  const old = $('yzProdPanel');
  if (!m) { old?.remove(); return; }
  if (m.isHalf) { old?.remove(); return; }
  if (old && old.dataset.id === m.id) return;      // artıq var
  old?.remove();
  const tpl = document.createElement('div');
  tpl.innerHTML = panelHTML(m);
  const actions = body.querySelector('.ct-detail-actions');
  if (actions) body.insertBefore(tpl.firstElementChild, actions); else body.appendChild(tpl.firstElementChild);
}

let obs;
function startObserver() {
  const body = $('menuDetailBody');
  if (!body || obs) return;
  obs = new MutationObserver(() => { if (!$('yzProdPanel')) inject(); else inject(); });
  obs.observe(body, { childList: true });
  inject();
}

/* ── Yazma əməliyyatları ── */
function update(id, data) {
  return R.menuItems.child(id).update(data);
}

function onFlag(key, id) {
  const m = (state.menuItems || []).find(x => x.id === id); if (!m) return;
  const f = FLAGS.find(x => x.key === key);
  const next = !flagOn(m, f);
  update(id, { [key]: next });
  addLog('menu_mgmt', `"${m.name}" — ${f.label}: ${next ? 'AÇIQ' : 'BAĞLI'}`, { menuItemId: id });
  showToast(`${m.name} — ${f.label}: ${next ? 'açıq' : 'bağlı'}`);
}

function onHalfToggle(id) {
  const m = (state.menuItems || []).find(x => x.id === id); if (!m) return;
  if (!m.hasHalf) {
    const p = r2(Number(m.price || 0) / 2);
    update(id, { hasHalf: true, halfPrice: m.halfPrice ?? p });
    addLog('menu_mgmt', `"${m.name}" üçün yarım porsiya açıldı`, { menuItemId: id });
  } else {
    update(id, { hasHalf: false });
    addLog('menu_mgmt', `"${m.name}" yarım porsiyası söndürüldü`, { menuItemId: id });
  }
}

function pushHistory(id, from, to, kind) {
  R.menuItems.child(id).child('priceHistory').push({
    from, to, kind: kind || 'full', at: Date.now(), by: state.user?.name || 'Admin'
  });
}

function onHalfPrice(id, raw) {
  const m = (state.menuItems || []).find(x => x.id === id); if (!m) return;
  const v = num(raw);
  if (!Number.isFinite(v) || v < 0) { showToast('Düzgün yarım porsiya qiyməti yaz'); return; }
  const price = r2(v);
  if (price === Number(m.halfPrice)) return;
  if (m.halfPrice !== undefined && m.halfPrice !== null) pushHistory(id, Number(m.halfPrice), price, 'half');
  update(id, { halfPrice: price });
  addLog('menu_mgmt', `"${m.name}" yarım porsiya qiyməti: ${price.toFixed(2)} ₼`, { menuItemId: id });
}

function onMoney(id, field, raw, label) {
  const m = (state.menuItems || []).find(x => x.id === id); if (!m) return;
  if (String(raw).trim() === '') { update(id, { [field]: null }); return; }
  const v = num(raw);
  if (!Number.isFinite(v) || v < 0) { showToast(`Düzgün ${label} yaz`); return; }
  update(id, { [field]: r2(v) });
}

function refreshProfit(live) {
  const el = $('yzProfit'); const p = $('yzProdPanel');
  if (!el || !p) return;
  const m = currentItem(); if (!m) return;
  el.innerHTML = profitHTML({ ...m, ...live });
}

document.addEventListener('click', (e) => {
  const p = e.target.closest('#yzProdPanel'); if (!p) return;
  const id = p.dataset.id;
  const fl = e.target.closest('[data-yz-flag]');
  if (fl) { onFlag(fl.dataset.yzFlag, id); return; }
  if (e.target.closest('[data-yz-half]')) onHalfToggle(id);
});
document.addEventListener('change', (e) => {
  const p = e.target.closest('#yzProdPanel'); if (!p) return;
  const id = p.dataset.id;
  if (e.target.id === 'yzVat') update(id, { vatRate: Number(e.target.value) });
  else if (e.target.id === 'yzCost') onMoney(id, 'cost', e.target.value, 'maya dəyəri');
  else if (e.target.id === 'yzHalfPrice') onHalfPrice(id, e.target.value);
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'yzCost') refreshProfit({ cost: num(e.target.value) });
  if (e.target.id === 'yzVat') refreshProfit({ vatRate: Number(e.target.value) });
});

/* ── Canlı sinxronizasiya: qiymət tarixçəsi + yarım porsiya ── */
let priceBase = null;       // id → son bilinən qiymət
let timer = null;

function sync(raw) {
  if (!isAdmin()) return;
  const items = Object.entries(raw || {}).map(([id, v]) => ({ id, ...v }));

  /* 1) Qiymət tarixçəsi — ilk yükləmə baza kimi saxlanır, sonrakı dəyişikliklər yazılır */
  if (priceBase === null) {
    priceBase = {};
    items.forEach(m => { priceBase[m.id] = Number(m.price || 0); });
  } else {
    items.forEach(m => {
      if (m.isHalf) return;
      const cur = Number(m.price || 0), prev = priceBase[m.id];
      if (prev !== undefined && prev !== cur) {
        const last = Object.values(m.priceHistory || {}).sort((a, b) => (b.at || 0) - (a.at || 0))[0];
        const dup = last && last.kind !== 'half' && Number(last.to) === cur && Date.now() - (last.at || 0) < 60000;
        if (!dup) pushHistory(m.id, prev, cur, 'full');
      }
      priceBase[m.id] = cur;
    });
  }

  /* 2) Yarım porsiya mövqelərini sinxronlaşdır */
  const byId = Object.fromEntries(items.map(m => [m.id, m]));
  items.forEach(m => {
    if (m.isHalf) return;
    const hid = `${m.id}_half`;
    const half = byId[hid];
    if (m.hasHalf) {
      const wanted = {
        name: `${m.name} (yarım)`, category: m.category || 'Digər',
        price: Number.isFinite(Number(m.halfPrice)) && m.halfPrice !== null && m.halfPrice !== undefined ? Number(m.halfPrice) : r2(Number(m.price || 0) / 2),
        description: m.description || '', photo: m.photo || '',
        available: m.available !== false, isHalf: true, parentId: m.id,
        kitchenId: m.kitchenId ?? null, showInQr: m.showInQr ?? true,
        vatRate: Number(m.vatRate || 0)
      };
      if (!half) {
        R.menuItems.child(hid).set({ ...wanted, isTrackable: false, createdAt: Date.now() });
      } else {
        const diff = {};
        Object.keys(wanted).forEach(k => { if ((half[k] ?? null) !== (wanted[k] ?? null)) diff[k] = wanted[k]; });
        if (Object.keys(diff).length) R.menuItems.child(hid).update(diff);
      }
    } else if (half) {
      R.menuItems.child(hid).remove();
    }
  });
  /* ana mal silinibsə yarımı da sil */
  items.forEach(m => { if (m.isHalf && m.parentId && !byId[m.parentId]) R.menuItems.child(m.id).remove(); });
}

function boot() {
  startObserver();
  R.menuItems.on('value', (snap) => {
    const raw = snap.val();
    clearTimeout(timer);
    timer = setTimeout(() => { try { sync(raw); } catch (err) { console.warn('yuza-product sync', err); } inject(); }, 400);
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

/* ── Menyu kartlarına nişanlar (½, ★, Yeni) ── */
function decorateCards() {
  const grid = document.querySelector('#sec-menu .tile-grid, #menuList, #menuItemsList');
  /* kartların siyahısı tətbiqin öz render-ində qurulur; nişanları adın yanına əlavə edirik */
  document.querySelectorAll('#sec-menu .tile-card').forEach(card => {
    if (card.dataset.yzDeco) return;
    const m = (state.menuItems || []).find(x => card.getAttribute('onclick')?.includes(`'${x.id}'`));
    if (!m) return;
    card.dataset.yzDeco = '1';
    const nameEl = card.querySelector('.tile-card__name');
    if (!nameEl) return;
    const tags = [];
    if (m.isHalf) tags.push('<i class="yz-tag yz-tag--half">½</i>');
    if (m.isFavorite) tags.push('<i class="yz-tag yz-tag--fav">★</i>');
    if (m.isNew) tags.push('<i class="yz-tag yz-tag--new">Yeni</i>');
    if (tags.length) nameEl.insertAdjacentHTML('beforeend', ' ' + tags.join(''));
  });
}
new MutationObserver(() => { if (isAdmin()) decorateCards(); }).observe(document.body, { childList: true, subtree: true });
