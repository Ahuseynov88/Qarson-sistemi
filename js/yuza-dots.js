/* ═══════════════════════════════════════════
   YUZA POS — "⋮" MENYU və PROQRAMIN NİŞANI (21.11.2026)
   1) Səlahiyyətli işçi (Rəhbər panelində bölməsi və ya kassa növbəsi icazəsi olan) üçün
      hər ekranın SAĞ üst küncündə "⋮" düyməsi. Basanda yalnız onun icazəli bölmələri açılır.
      Əvvəlki "adam" ikonu (Panel) bununla əvəz olunub. Düymə ekran dəyişəndə itmir —
      hər ekranın başlığında eyni yerdə durur.
   2) Hər ekranın SOL üst küncündə kiçik YuzaPOS nişanı. Ayar deyil — kodda sabitdir,
      heç bir müştəri onu dəyişə və ya söndürə bilməz. Restoranın öz loqosu ayrıca yerdədir
      (çek, giriş ekranı).
═══════════════════════════════════════════ */
import { state } from './state.js';
import { hasPermission } from './permissions.js';
import { showScreen } from './theme.js';

const $ = (id) => document.getElementById(id);
const I = (id) => `<svg class="icon"><use href="#i-${id}"></use></svg>`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ICO_DOTS = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="5" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="19" r="2" fill="currentColor"/></svg>';
// Nişanın öz şəkli (giriş ekranındakı simvola bağlı deyil — o ekran gizli olanda keçid rəngi görünmür)
const MARK = '<svg viewBox="0 0 1000 866" aria-hidden="true"><path fill="currentColor" d="M0 0L210.2 364L376.2 364L402.7 410L555.7 675L509.7 675L356.7 410L236.7 410L500 866L643 618.3L286 0L166 0L331.1 286L285.1 286L120 0ZM1000 0L332 0L384 90L828 90L801.5 136L410.5 136L666 578.5L840.7 276L720.7 276L666 370.7L611.3 276L584.8 230L867.2 230Z"/></svg>';

/* Başlıqlar: [başlıq seçicisi, düymələrin yerləşdiyi hissə] */
const HEADERS = [
  ['#waiterScreen .waiter-header', '#waiterScreen .waiter-header'],
  ['#adminTopbar > div:first-child', '#adminTopbar .topbar-right'],
  ['#orderScreen > .topbar', '#orderScreen > .topbar'],
  ['#invScreen > .topbar', '#invScreen > .topbar .topbar-right'],
  ['#kitchenScreen > .topbar', null]
];

const isStaff = () => state.user?.role === 'staff';
const canShift = () => hasPermission('shift.manage');
// Əlavə bəndlər (məs. C14 Elanlar) başqa modullardan gəlir: window.__yzDotsExtra = [() => ({k:'x:..', l, i, run}) | null]
const extras = () => (window.__yzDotsExtra || []).map(f => { try { return f(); } catch (e) { return null; } }).filter(Boolean);
const showDots = () => (isStaff() && (!!window.__yzAccess?.hasPanel?.(state.user) || canShift())) || extras().length > 0;

/* ── 1) Proqramın nişanı (sol üst) ── */
function ensureMarks() {
  HEADERS.forEach(([hs]) => {
    const h = document.querySelector(hs);
    if (!h || h.querySelector(':scope > .yz-appmark')) return;
    const m = document.createElement('span');
    m.className = 'yz-appmark'; m.setAttribute('role', 'img'); m.setAttribute('aria-label', 'YuzaPOS'); m.title = 'YuzaPOS';
    m.innerHTML = MARK;
    h.insertBefore(m, h.firstChild);
  });
}

/* ── 2) "⋮" düyməsi (sağ üst) ── */
function ensureDots() {
  const on = showDots();
  document.body.classList.toggle('yz-dots-on', on);
  HEADERS.forEach(([, ps]) => {
    if (!ps) return;
    const host = document.querySelector(ps);
    if (!host) return;
    let b = host.querySelector(':scope > .yz-dots');
    if (!on) { b?.remove(); return; }
    if (b) { if (host.lastElementChild !== b) host.appendChild(b); return; }
    b = document.createElement('button');
    b.type = 'button'; b.className = 'yz-dots'; b.innerHTML = ICO_DOTS;
    b.setAttribute('aria-label', 'Səlahiyyətlərim — bölmələr'); b.title = 'Bölmələr';
    b.setAttribute('aria-haspopup', 'menu');
    b.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(b); });
    host.appendChild(b);
  });
}

/* Menyunun bəndləri: Rəhbər panelinin menyusundan, yalnız icazəli bölmələr */
function items() {
  const out = [];
  const u = state.user;
  if (u?.role === 'staff' && (u?.permissions || []).includes('table.view')) out.push({ grp: '', k: 'zal', l: 'Masalar', i: 'chair' });
  extras().forEach(x => out.push({ grp: '', ...x }));
  if (canShift()) out.push({ grp: '', k: 'shift', l: state.shift ? `Kassa növbəsi · №${state.shift.no ?? ''}` : 'Kassa növbəsi (bağlıdır)', i: 'cash' });
  document.querySelectorAll('#adminTabsContainer .ap-group').forEach(g => {
    const grp = g.querySelector('.ap-group__header > span:not(.yz-side-badge)')?.textContent.trim() || '';
    g.querySelectorAll('.admin-tab[data-section]').forEach(t => {
      const sec = t.dataset.section;
      if (sec === 'zal' || t.hidden || t.style.display === 'none' || t.classList.contains('yz-noaccess')) return;
      if (!window.__yzAccess?.canSee?.(sec)) return;
      out.push({ grp, k: 'sec:' + sec, l: (t.querySelector('span')?.textContent || t.textContent).trim(), html: t.querySelector('svg')?.outerHTML || '' });
    });
  });
  return out;
}

let menuEl = null;
function closeMenu() {
  if (!menuEl) return;
  menuEl.remove(); menuEl = null;
  document.querySelectorAll('.yz-dots[aria-expanded="true"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
}
function toggleMenu(btn) {
  if (menuEl) { closeMenu(); return; }
  const list = items();
  menuEl = document.createElement('div');
  menuEl.className = 'yz-dotsmenu'; menuEl.setAttribute('role', 'menu');
  let last = null;
  menuEl.innerHTML = `<div class="yz-dotsmenu__head"><b>${esc(state.user?.name || '')}</b><button type="button" class="yz-dotsmenu__x" data-x aria-label="Bağla" title="Bağla">${I('close')}</button></div>
    <div class="yz-dotsmenu__list">${list.map(x => {
      const h = x.grp !== last ? (last = x.grp, x.grp ? `<div class="yz-dotsmenu__grp">${esc(x.grp)}</div>` : '') : '';
      return `${h}<button type="button" role="menuitem" class="yz-dotsmenu__it" data-k="${esc(x.k)}">${x.html || I(x.i)}<span>${esc(x.l)}</span></button>`;
    }).join('') || '<p class="yz-dotsmenu__empty">Bölmə yoxdur.</p>'}</div>`;
  document.body.appendChild(menuEl);
  btn.setAttribute('aria-expanded', 'true');
  // Kompüterdə düymənin altında açılır, telefonda aşağıdan (yuza-ui.css)
  const r = btn.getBoundingClientRect();
  menuEl.style.setProperty('--dm-top', Math.round(r.bottom + 6) + 'px');
  menuEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-x]') || e.target === menuEl) { closeMenu(); return; }
    const it = e.target.closest('[data-k]'); if (!it) return;
    const k = it.dataset.k;
    closeMenu();
    go(k);
  });
  setTimeout(() => menuEl?.querySelector('.yz-dotsmenu__it')?.focus(), 30);
}
function go(k) {
  if (k.startsWith('x:')) { extras().find(x => x.k === k)?.run?.(); return; }
  if (k === 'zal') {
    if ($('orderScreen')?.classList.contains('active')) { try { window.staffApp?.closeTableDetail?.(); } catch (e) { /* */ } }
    showScreen('waiterScreen'); return;
  }
  if (k === 'shift') { if (state.shift) window.yzShift?.panel?.(); else window.yzShift?.open?.(); return; }
  if (k.startsWith('sec:')) {
    const sec = k.slice(4);
    if ($('orderScreen')?.classList.contains('active')) { try { window.staffApp?.closeTableDetail?.(); } catch (e) { /* */ } }
    showScreen('adminScreen');
    const t = document.querySelector(`#adminTabsContainer .admin-tab[data-section="${CSS.escape(sec)}"]`);
    window.adminTab?.(sec, t);
  }
}
document.addEventListener('click', (e) => { if (menuEl && !e.target.closest('.yz-dotsmenu, .yz-dots')) closeMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menuEl) { e.preventDefault(); e.stopImmediatePropagation(); closeMenu(); } }, true);

/* ── Başlanğıc ── */
let busy = false;
function tick() {
  if (busy) return; busy = true;
  requestAnimationFrame(() => {
    busy = false;
    try { ensureMarks(); ensureDots(); } catch (e) { console.warn('[⋮]', e); }
    if (!state.user) closeMenu();
  });
}
function init() {
  tick();
  new MutationObserver(tick).observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });
  setInterval(tick, 2000);
}
window.__yzDots = { close: closeMenu, items };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
