/* ═══════════════════════════════════════════
   YUZA POS — ANBAR: ÜMUMİ EKRAN QABIĞI
   • Bölmə qeydiyyatı: admin panelində hər bölmə ayrıca, işçi ekranında iki səviyyəli menyu
   • Ortaq komponentlər: pəncərə (modal), məhsul seçici, sürətli məhsul əlavəsi
═══════════════════════════════════════════ */
import { state } from './state.js';
import { esc, showToast } from './utils.js';
import {
  inv, onInv, startInv, PTYPES, UNITS, product, productList, findSimilar, saveProduct,
  hasAnyInvPerm, can, isV2, fmtQty, totalStock, packsOf, defaultWarehouseId, watchDocs
} from './yuza-inv-core.js';

export { esc };
export const $ = (id) => document.getElementById(id);
export const ok = (m) => showToast('<svg class="icon"><use href="#i-check"></use></svg> ' + esc(m));
export const fail = (m) => showToast('<svg class="icon"><use href="#i-warning"></use></svg> ' + esc(m));

/* ── Bölmə (tab) qeydiyyatı ──
   tab: { id, label, group, order, perm(): bool, render(el), live?: [], badge?(): number, legacyOk? }
   Admin panelində hər tab ayrıca bölmədir (sec-inv-<id>), işçi ekranında isə
   iki səviyyəli menyu: əvvəlcə qrup (Mühasibat / Anbar / ...), sonra bölmə. */
export const GROUPS = { acc: 'Mühasibat', stock: 'Anbar', reg: 'Qeydiyyat', rep: 'Hesabatlar', sys: 'Sistem' };
const GROUP_ORDER = ['acc', 'stock', 'reg', 'rep', 'sys'];
const tabs = [];
export function registerTab(tab) { tabs.push(tab); tabs.sort((a, b) => (a.order || 50) - (b.order || 50)); }
export const tabById = (id) => tabs.find(t => t.id === id);
export const tabAllowed = (t) => { try { return !!(t && t.perm()); } catch (e) { return false; } };
export const allTabs = () => tabs.slice();
/* Sənəd növünə görə xüsusi baxış (məs. kassa): { open(id), side(d), amount(d) } */
export const docHooks = {};
const visibleTabs = () => tabs.filter(tabAllowed);

const views = new Set();      // { host, single?, current?, group? }
function viewOf(host, init) {
  if (!host._yziView) { host._yziView = { host, ...init }; views.add(host._yziView); }
  return host._yziView;
}
/* Admin: tək bölmə, menyusuz */
export function mountSingle(host, id) {
  if (!host) return;
  watchDocs();
  const v = viewOf(host, {});
  v.single = id;
  if (!host.querySelector('.yzi')) host.innerHTML = '<div class="yzi yzi--single"><div class="yzi-body"></div></div>';
  renderBody(v);
}
/* İşçi ekranı: iki səviyyəli menyu */
export function mount(host) {
  if (!host) return;
  watchDocs();
  const v = viewOf(host, { nav: true });
  if (!host.querySelector('.yzi-nav')) {
    host.innerHTML = `<div class="yzi">
      <nav class="yzi-nav" aria-label="Bölmələr"><div class="yzi-nav__groups" role="tablist"></div><div class="yzi-nav__tabs" role="tablist"></div></nav>
      <div class="yzi-body"></div></div>`;
    host.querySelector('.yzi-nav').addEventListener('click', (e) => {
      const g = e.target.closest('[data-yzi-group]');
      if (g) { v.group = g.dataset.yziGroup; v.current = visibleTabs().find(t => t.group === v.group)?.id; renderNav(v); renderBody(v); return; }
      const b = e.target.closest('[data-yzi-tab]');
      if (b) { v.current = b.dataset.yziTab; renderNav(v); renderBody(v); host.querySelector('.yzi-body')?.scrollTo?.(0, 0); }
    });
  }
  const vis = visibleTabs();
  if (!v.current || !vis.some(t => t.id === v.current)) v.current = vis[0]?.id || null;
  v.group = tabById(v.current)?.group || null;
  renderNav(v); renderBody(v);
}
/* Bölmədən bölməyə keçid (kodun içindən) */
export function go(id) {
  if ($('adminScreen')?.classList.contains('active') && typeof window.adminTab === 'function') {
    const btn = document.querySelector(`.admin-tab[data-section="inv-${id}"]`);
    window.adminTab('inv-' + id, btn);
    return;
  }
  views.forEach(v => { if (v.nav && isShown(v)) { v.current = id; v.group = tabById(id)?.group; renderNav(v); renderBody(v); } });
}
export function refresh(what) {
  views.forEach(v => {
    if (!v.host.isConnected || !isShown(v)) return;
    if (v.nav) renderNav(v);
    const t = tabById(v.single || v.current);
    if (t?.live && (!what || t.live.includes(what))) renderBody(v, true);
  });
}
function isShown(v) {
  return !!(v.host.closest('.admin-section.active') || (v.host.closest('.screen.active') && !v.host.closest('.admin-section')));
}
function renderNav(v) {
  const g = v.host.querySelector('.yzi-nav__groups'), tb = v.host.querySelector('.yzi-nav__tabs');
  if (!g || !tb) return;
  const vis = visibleTabs();
  const groups = GROUP_ORDER.filter(k => vis.some(t => t.group === k));
  const badgeOf = (list) => list.reduce((s, t) => s + (t.badge ? (Number(t.badge()) || 0) : 0), 0);
  g.innerHTML = groups.map(k => { const n = badgeOf(vis.filter(t => t.group === k)); return `<button type="button" role="tab" class="yzi-nav__grp${k === v.group ? ' is-on' : ''}" data-yzi-group="${k}" aria-selected="${k === v.group}">${GROUPS[k]}${n ? `<span class="yzi-badge">${n}</span>` : ''}</button>`; }).join('');
  tb.innerHTML = vis.filter(t => t.group === v.group).map(t => {
    const n = t.badge ? t.badge() : 0;
    return `<button type="button" role="tab" class="yzi-nav__btn${t.id === v.current ? ' is-on' : ''}" data-yzi-tab="${t.id}" aria-selected="${t.id === v.current}">${esc(t.label)}${n ? `<span class="yzi-badge">${n}</span>` : ''}</button>`;
  }).join('');
}
function renderBody(v, soft) {
  const body = v.host.querySelector('.yzi-body'); if (!body) return;
  const t = tabById(v.single || v.current);
  if (!t || !tabAllowed(t)) { body.innerHTML = '<p class="yzi-empty">Bu bölmə üçün icazəniz yoxdur.</p>'; return; }
  if (!isV2() && !t.legacyOk) {
    const admin = state.user?.role === 'admin';
    body.innerHTML = `<div class="yzi-banner">
      <b>Yeni anbar sistemi hələ aktiv deyil.</b>
      <span>Əvvəlcə köhnə məlumatlar köçürülməlidir. ${admin ? '"Sistem → Anbar parametrləri" bölməsindən köçürməni başladın.' : 'Rəhbər köçürməni etməlidir.'}</span>
      ${admin ? '<button type="button" class="yzi-btn yzi-btn--gold" data-yzi-go="settings">Parametrlərə keç</button>' : ''}
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
/* Pəncərənin alt hissəsində yalnız naviqasiya düymələri ikonla göstərilir (Ləğv/Təsdiqlə kimi qərar düymələri mətnli qalır) */
const NAV_ICONS = { 'Bağla': 'close', 'Geri': 'back' };
export function modal({ title, body, wide = false, actions = [], onClose } = {}) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg open yzi-modal-bg';
  bg.innerHTML = `<div class="modal yzi-modal${wide ? ' yzi-modal--wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title || '')}">
    <div class="yzi-modal__head"><h2>${title || ''}</h2>
      <button type="button" class="yzi-x" data-cancel aria-label="Bağla" title="Bağla"><svg class="icon"><use href="#i-close"></use></svg></button></div>
    <div class="yzi-modal__body"></div>
    <div class="yzi-modal__foot"></div>
  </div>`;
  const bodyEl = bg.querySelector('.yzi-modal__body');
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
  const foot = bg.querySelector('.yzi-modal__foot');
  const close = () => { bg.remove(); onClose && onClose(); };
  actions.forEach(a => {
    if (a.cancel && NAV_ICONS[String(a.label || '').trim()] === 'close') return;   // yuxarıdakı ✕ eyni işi görür — iki dəfə göstərilmir
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'yzi-btn ' + (a.cls || '');
    const navIco = a.cancel && NAV_ICONS[String(a.label || '').trim()];
    if (navIco) {
      b.classList.add('yz-icon-only');
      b.innerHTML = `<svg class="icon"><use href="#i-${navIco}"></use></svg>`;
      b.setAttribute('aria-label', a.label); b.title = a.label;
    } else b.innerHTML = a.label;
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
  if (!foot.children.length) foot.remove();
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
