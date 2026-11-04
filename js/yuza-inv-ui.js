/* ═══════════════════════════════════════════
   YUZA POS — ANBAR: ÜMUMİ EKRAN QABIĞI
   • Admin panelində "Anbar və Məhsullar" bölməsi (sec-inv)
   • İşçilər üçün ayrıca ekran (#invScreen) — qarson ekranında "Anbar" düyməsi
     yalnız anbar icazəsi olan işçiyə görünür (mühasib, anbardar və s.)
   • Ortaq komponentlər: pəncərə (modal), məhsul seçici, sürətli məhsul əlavəsi
═══════════════════════════════════════════ */
import { state } from './state.js';
import { esc, showToast } from './utils.js';
import { showScreen } from './theme.js';
import {
  inv, onInv, startInv, PTYPES, UNITS, product, productList, findSimilar, saveProduct,
  hasAnyInvPerm, can, isV2, fmtQty, totalStock, packsOf, defaultWarehouseId, watchDocs
} from './yuza-inv-core.js';

export { esc };
export const $ = (id) => document.getElementById(id);
export const ok = (m) => showToast('<svg class="icon"><use href="#i-check"></use></svg> ' + esc(m));
export const fail = (m) => showToast('<svg class="icon"><use href="#i-warning"></use></svg> ' + esc(m));

/* ── Bölmə (tab) qeydiyyatı ── */
const tabs = [];
/* tab: { id, label, perm(): bool, render(el), badge?(): number } */
export function registerTab(tab) { tabs.push(tab); tabs.sort((a, b) => (a.order || 50) - (b.order || 50)); }
let current = null;
let hostEl = null;

function visibleTabs() { return tabs.filter(t => { try { return t.perm(); } catch (e) { return false; } }); }

export function mount(host) {
  if (!host) return;
  hostEl = host;
  watchDocs();
  if (!host.querySelector('.yzi')) {
    host.innerHTML = `<div class="yzi">
      <nav class="yzi-nav" role="tablist" aria-label="Anbar bölmələri"></nav>
      <div class="yzi-body" id="yziBody"></div>
    </div>`;
    host.querySelector('.yzi-nav').addEventListener('click', (e) => {
      const b = e.target.closest('[data-yzi-tab]');
      if (b) go(b.dataset.yziTab);
    });
  }
  const vis = visibleTabs();
  if (!current || !vis.some(t => t.id === current)) current = vis[0]?.id || null;
  renderNav(); renderBody();
}
export function go(id) { current = id; renderNav(); renderBody(); hostEl?.querySelector('.yzi-body')?.scrollTo?.(0, 0); }
export function refresh(what) {
  if (!hostEl || !hostEl.isConnected || !isShown()) return;
  renderNav();
  const t = tabs.find(x => x.id === current);
  if (t?.live && (!what || t.live.includes(what))) renderBody(true);
}
function isShown() {
  return !!(hostEl && (hostEl.closest('.admin-section.active') || hostEl.closest('.screen.active')));
}
function renderNav() {
  const nav = hostEl?.querySelector('.yzi-nav'); if (!nav) return;
  nav.innerHTML = visibleTabs().map(t => {
    const n = t.badge ? t.badge() : 0;
    return `<button type="button" role="tab" class="yzi-nav__btn${t.id === current ? ' is-on' : ''}" data-yzi-tab="${t.id}" aria-selected="${t.id === current}">
      ${esc(t.label)}${n ? `<span class="yzi-badge">${n}</span>` : ''}</button>`;
  }).join('');
}
function renderBody(soft) {
  const body = hostEl?.querySelector('.yzi-body'); if (!body) return;
  const t = tabs.find(x => x.id === current);
  if (!t) { body.innerHTML = '<p class="yzi-empty">Bu bölmə üçün icazəniz yoxdur.</p>'; return; }
  if (!isV2() && !t.legacyOk) {
    body.innerHTML = `<div class="yzi-banner">
      <b>Yeni anbar sistemi hələ aktiv deyil.</b>
      <span>Əvvəlcə köhnə məlumatlar köçürülməlidir. ${state.user?.role === 'admin' ? '"Parametrlər" bölməsindən köçürməni başladın.' : 'Admin köçürməni etməlidir.'}</span>
      ${state.user?.role === 'admin' ? '<button type="button" class="yzi-btn yzi-btn--gold" data-yzi-go="settings">Parametrlərə keç</button>' : ''}
    </div>`;
    body.querySelector('[data-yzi-go]')?.addEventListener('click', () => go('settings'));
    return;
  }
  /* Canlı yenilənmə: istifadəçi xanaya yazarkən ekran yenidən çəkilmir */
  const active = document.activeElement;
  if (soft && active && body.contains(active) && /INPUT|TEXTAREA|SELECT/.test(active.tagName)) return;
  blurIn(body);
  t.render(fresh(body));
}
/* Ekran yenidən çəkilməzdən əvvəl fokuslu xana bağlanır — əks halda onun "change"
   hadisəsi çəkiliş zamanı ikinci çəkiliş başladır və brauzer xəta verir */
export function blurIn(root) {
  const a = document.activeElement;
  if (a && root && root.contains(a) && typeof a.blur === 'function') a.blur();
}
/* Hər çəkilişdə təzə konteyner — köhnə hadisə dinləyiciləri yığılmasın */
export function fresh(host) {
  host.innerHTML = '';
  const d = document.createElement('div');
  d.className = 'yzi-tab';
  host.appendChild(d);
  return d;
}

/* ── Pəncərə (modal) ── */
export function modal({ title, body, wide = false, actions = [], onClose } = {}) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg open yzi-modal-bg';
  bg.innerHTML = `<div class="modal yzi-modal${wide ? ' yzi-modal--wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title || '')}">
    <div class="yzi-modal__head"><h2>${title || ''}</h2>
      <button type="button" class="yzi-x" data-cancel aria-label="Bağla">✕</button></div>
    <div class="yzi-modal__body"></div>
    <div class="yzi-modal__foot"></div>
  </div>`;
  const bodyEl = bg.querySelector('.yzi-modal__body');
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
  const foot = bg.querySelector('.yzi-modal__foot');
  const close = () => { bg.remove(); onClose && onClose(); };
  actions.forEach(a => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'yzi-btn ' + (a.cls || '');
    b.innerHTML = a.label;
    if (a.cancel) b.setAttribute('data-cancel', '');
    b.addEventListener('click', async () => {
      if (a.cancel) { close(); return; }
      if (b.disabled) return;
      b.disabled = true;
      try { const r = await a.onClick?.(bodyEl, close); if (r !== false && a.close !== false) close(); }
      catch (e) { fail(e?.message || String(e)); }
      finally { b.disabled = false; }
    });
    foot.appendChild(b);
  });
  if (!actions.length) foot.remove();
  bg.querySelector('.yzi-x').addEventListener('click', close);
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
  document.body.appendChild(bg);
  setTimeout(() => bodyEl.querySelector('input:not([type=hidden]),select,textarea')?.focus(), 40);
  return { el: bg, body: bodyEl, close };
}
export function confirmBox(message, { title = 'Təsdiq', okLabel = 'Təsdiqlə', okCls = 'yzi-btn--gold', input = null } = {}) {
  return new Promise((resolve) => {
    const m = modal({
      title,
      body: `<p class="yzi-p">${message}</p>${input ? `<label class="yzi-f"><span>${esc(input)}</span><input type="text" id="yziConfirmInput" autocomplete="off"></label>` : ''}`,
      actions: [
        { label: 'Ləğv', cancel: true, cls: 'yzi-btn--ghost' },
        { label: okLabel, cls: okCls, onClick: (b) => {
          const v = input ? b.querySelector('#yziConfirmInput').value.trim() : true;
          if (input && !v) { fail(input + ' yazılmalıdır'); return false; }
          resolve(v);
        } }
      ],
      onClose: () => resolve(null)
    });
    return m;
  });
}

/* ── Rəqəm xanası ── */
export const numInput = (attrs, value) => `<input type="text" inputmode="decimal" autocomplete="off" ${attrs} value="${value === undefined || value === null || value === '' || (typeof value === 'number' && !Number.isFinite(value)) ? '' : esc(String(value))}">`;
export const typeChip = (t) => `<span class="yzi-chip yzi-chip--${esc(t)}">${esc(PTYPES[t]?.label || t)}</span>`;

/* ═══ MƏHSUL SEÇİCİ ═══
   input-a yazdıqca kataloqdan axtarır. Tapılmasa "Yeni məhsul yarat" təklif edir. */
export function attachPicker(input, { types, onPick, allowCreate = true, createTypes } = {}) {
  let box = null, items = [], idx = 0;
  const close = () => { box?.remove(); box = null; };
  const open = () => {
    const q = input.value.trim().toLowerCase();
    items = productList({ types }).filter(p => !q || String(p.name).toLowerCase().includes(q) || String(p.barcode || '') === q).slice(0, 12);
    if (!box) {
      box = document.createElement('div');
      box.className = 'yzi-pick';
      box.setAttribute('role', 'listbox');
      document.body.appendChild(box);
      box.addEventListener('mousedown', (e) => e.preventDefault());
      box.addEventListener('click', (e) => {
        const b = e.target.closest('[data-i]'); if (!b) return;
        const i = Number(b.dataset.i);
        if (i === -1) createNew(); else choose(items[i]);
      });
    }
    const r = input.getBoundingClientRect();
    box.style.left = Math.max(8, r.left) + 'px';
    box.style.top = (r.bottom + 4) + 'px';
    box.style.width = Math.max(260, r.width) + 'px';
    idx = 0;
    box.innerHTML = items.map((p, i) => `<button type="button" class="yzi-pick__it${i === idx ? ' is-on' : ''}" data-i="${i}" role="option">
        <span class="yzi-pick__name">${esc(p.name)}${p.incomplete ? ' <i class="yzi-tag-inc">natamam</i>' : ''}</span>
        <span class="yzi-pick__meta">${typeChip(p.type)} ${PTYPES[p.type]?.stock ? fmtQty(totalStock(p.id)) + ' ' + esc(p.unit || '') : ''}</span>
      </button>`).join('')
      + (allowCreate && q ? `<button type="button" class="yzi-pick__it yzi-pick__new" data-i="-1">+ "${esc(input.value.trim())}" — kataloqda yoxdur, qısa kart yarat</button>` : '')
      + (!items.length && !q ? '<div class="yzi-pick__empty">Yazmağa başlayın…</div>' : '');
  };
  const choose = (p) => { if (!p) return; close(); input.value = p.name; onPick && onPick(p); };
  const createNew = () => {
    const name = input.value.trim(); close();
    quickAddProduct(name, { types: createTypes || types }).then(p => { if (p) { input.value = p.name; onPick && onPick(p); } });
  };
  input.setAttribute('autocomplete', 'off');
  input.addEventListener('input', open);
  input.addEventListener('focus', open);
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (e) => {
    if (!box) return;
    const btns = [...box.querySelectorAll('[data-i]')];
    if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(idx + 1, btns.length - 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(idx - 1, 0); }
    else if (e.key === 'Enter') { e.preventDefault(); const b = btns[idx]; if (b) b.click(); return; }
    else if (e.key === 'Escape') { close(); return; }
    else return;
    btns.forEach((b, i) => b.classList.toggle('is-on', i === idx));
  });
}

/* ═══ SÜRƏTLİ MƏHSUL ƏLAVƏSİ ═══
   Alışda kataloqda olmayan mal: yalnız ad, növ, vahid, qablaşma, ƏDV soruşulur.
   Kart "Natamam" işarəsi ilə yaranır, sonra kataloqda tamamlanır. */
export function quickAddProduct(name, { types } = {}) {
  return new Promise((resolve) => {
    if (!can('catalog.edit') && !can('catalog.quickadd')) { fail('Yeni məhsul yaratmaq üçün icazəniz yoxdur'); resolve(null); return; }
    const allowed = (types && types.length ? types : ['raw', 'goods', 'semi']).filter(t => PTYPES[t]?.buy);
    let picked = allowed[0];
    const html = `
      <div id="yziQaSim"></div>
      <label class="yzi-f"><span>Ad *</span><input type="text" id="yziQaName" value="${esc(name || '')}" autocomplete="off"></label>
      <div class="yzi-f"><span>Növ *</span>
        <div class="yzi-seg" id="yziQaType">${allowed.map(t => `<button type="button" data-t="${t}" class="${t === picked ? 'is-on' : ''}">${PTYPES[t].label}</button>`).join('')}</div>
        <small class="yzi-hint" id="yziQaTypeHint"></small></div>
      <div class="yzi-grid3">
        <label class="yzi-f"><span>Anbar vahidi *</span><select id="yziQaUnit">${UNITS.map(u => `<option${u === 'kq' ? ' selected' : ''}>${u}</option>`).join('')}</select></label>
        <label class="yzi-f"><span>Alış qablaşması</span><input type="text" id="yziQaPack" placeholder="məs: Qutu" autocomplete="off"></label>
        <label class="yzi-f"><span>Qablaşmada neçə vahid</span>${numInput('id="yziQaFactor" placeholder="məs: 24"')}</label>
      </div>
      <label class="yzi-f"><span>ƏDV dərəcəsi (%)</span>${numInput('id="yziQaVat"', inv.settings.defaultVat ?? 18)}</label>
      <p class="yzi-hint">Kart <b>Natamam</b> nişanı ilə yaranır. Kateqoriya, minimum qalıq, barkod və menyu ayarlarını sonra kataloqda tamamlayın.</p>`;
    const hint = () => {
      const h = { raw: 'Menyuda heç vaxt görünmür, reseptlərdə istifadə olunur.', goods: 'Hazır satılan mal (içki və s.). Menyuya çıxarmaq kataloqdan açılır.', semi: 'Sous, xəmir kimi aralıq məhsul. Menyuda görünmür.' };
      $('yziQaTypeHint').textContent = h[picked] || '';
      $('yziQaUnit').value = picked === 'goods' ? 'ədəd' : ($('yziQaUnit').value || 'kq');
    };
    const sim = () => {
      const list = findSimilar($('yziQaName').value);
      $('yziQaSim').innerHTML = list.length ? `<div class="yzi-warnbox"><b>Oxşar ad tapıldı — eyni mal ola bilər:</b>
        ${list.map(p => `<div class="yzi-row"><span>${esc(p.name)} <small>· ${PTYPES[p.type]?.label} · ${esc(p.unit || '')}</small></span>
        <button type="button" class="yzi-btn yzi-btn--sm" data-use="${p.id}">Bunu seç</button></div>`).join('')}</div>` : '';
    };
    let resolved = false;
    const m = modal({
      title: 'Kataloqda yoxdur — qısa kart yarat',
      body: html,
      actions: [
        { label: 'Ləğv', cancel: true, cls: 'yzi-btn--ghost' },
        { label: 'Yarat və seç', cls: 'yzi-btn--gold', onClick: async () => {
          const nm = $('yziQaName').value.trim();
          if (!nm) throw new Error('Ad yazılmalıdır');
          const factor = Number(String($('yziQaFactor').value).replace(',', '.'));
          const pack = $('yziQaPack').value.trim();
          const data = {
            name: nm, type: picked, unit: $('yziQaUnit').value, category: '',
            vatRate: Number(String($('yziQaVat').value).replace(',', '.')) || 0,
            vatIncluded: true, showInMenu: false, active: true, incomplete: true
          };
          if (pack && factor > 0) data.packs = { p1: { name: pack, factor } };
          const id = await saveProduct(null, data);
          resolved = true; resolve(product(id) || { id, ...data });
        } }
      ],
      onClose: () => { if (!resolved) resolve(null); }
    });
    m.body.querySelector('#yziQaType').addEventListener('click', (e) => {
      const b = e.target.closest('[data-t]'); if (!b) return;
      picked = b.dataset.t;
      m.body.querySelectorAll('#yziQaType button').forEach(x => x.classList.toggle('is-on', x === b));
      hint();
    });
    m.body.addEventListener('click', (e) => {
      const u = e.target.closest('[data-use]'); if (!u) return;
      resolved = true; resolve(product(u.dataset.use)); m.close();
    });
    $('yziQaName').addEventListener('input', sim);
    hint(); sim();
  });
}

/* ═══ YERLƏŞDİRMƏ ═══ */
function adminHost() { return $('yzInvAdminHost'); }
function staffHost() { return $('yzInvStaffHost'); }

function wrapAdminTab() {
  if (window.__yzInvWrapped || typeof window.adminTab !== 'function') return !!window.__yzInvWrapped;
  const orig = window.adminTab;
  window.adminTab = function (sec, el) {
    orig(sec, el);
    if (sec === 'inv' && adminHost()) mount(adminHost());
  };
  window.__yzInvWrapped = true;
  return true;
}

/* Qarson ekranında "Anbar" düyməsi — yalnız icazəsi olan işçiyə */
function ensureStaffButton() {
  /* Məlumat yalnız işçi/admin girişindən sonra yüklənir (müştəri QR ekranında yox) */
  if (state.user) startInv();
  /* Admin girişi: ödənişlər kassa hesabatında görünsün deyə sənədlər yüklənir */
  if (state.user?.role === 'admin' && $('adminScreen')?.classList.contains('active')) watchDocs();
  const head = document.querySelector('#waiterScreen .waiter-header');
  if (!head) return;
  let b = $('yzInvStaffBtn');
  const show = !!state.user && state.user.role !== 'admin' && hasAnyInvPerm();
  if (!show) { b?.remove(); return; }
  if (b) return;
  b = document.createElement('button');
  b.id = 'yzInvStaffBtn'; b.type = 'button'; b.className = 'btn btn-ghost yzi-staff-btn';
  b.innerHTML = '<svg class="icon"><use href="#i-box"></use></svg> Anbar';
  b.addEventListener('click', () => { showScreen('invScreen'); mount(staffHost()); });
  const theme = $('themeToggleBtnWaiter');
  head.insertBefore(b, theme || null);
}

export function initShell() {
  if (!wrapAdminTab()) { const t = setInterval(() => { if (wrapAdminTab()) clearInterval(t); }, 300); }
  $('yzInvStaffBack')?.addEventListener('click', () => showScreen('waiterScreen'));
  new MutationObserver(ensureStaffButton).observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });
  ensureStaffButton();
  onInv((what) => refresh(what));
}

/* Ortaq: anbar seçimi */
export function whOptions(selected, { all = false, includeEmpty = false, noDefault = false } = {}) {
  const list = Object.entries(inv.warehouses).map(([id, w]) => ({ id, ...w })).filter(w => all || !w.archived)
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  const sel = selected || (noDefault ? null : defaultWarehouseId());
  return (includeEmpty ? '<option value="">— seçin —</option>' : '') + list.map(w => `<option value="${w.id}"${w.id === sel ? ' selected' : ''}>${esc(w.name)}</option>`).join('');
}
export function packOptions(p, selectedKey) {
  return packsOf(p).map(pk => `<option value="${pk.key}" data-f="${pk.factor}"${pk.key === selectedKey ? ' selected' : ''}>${esc(pk.name)}${pk.factor !== 1 ? ` (${fmtQty(pk.factor)} ${esc(p?.unit || '')})` : ''}</option>`).join('');
}
