/* ═══════════════════════════════════════════
   YUZA POS — PATRON PANELİ QABIĞI (menyu, yerləşdirmə, Zal)
   • Admin panelinin sol menyusunu yeni quruluşla qurur:
       Zal · Hesabatlar · Mühasibat · Banket · Qeydiyyat · Sistem
     (köhnə bölmələrin hamısı qalır, sadəcə məntiqli qruplara yığılıb)
   • Anbar/kassa bölmələrini admin panelində ayrıca bölmə kimi yerləşdirir (sec-inv-<id>)
   • "+ Yeni" menyusu, təsdiq zəngi (🔔), səhifə başlığı
   • Patron "Zal"a girib qarson kimi bütün əməliyyatları edə bilir
   • İşçi ekranında "Anbar" düyməsi (icazəsi olanlara)
   Geri qaytarmaq: index.html-dən yuza-inventory.js sətrini silmək kifayətdir —
   köhnə menyu HTML-də olduğu kimi qalır.
═══════════════════════════════════════════ */
import { db } from './firebase-service.js';
import { state } from './state.js';
import { showScreen } from './theme.js';
import { startInv, onInv, hasAnyInvPerm, watchDocs, pendingDocs, canApprove } from './yuza-inv-core.js';
import { mount, mountSingle, refresh, $ } from './yuza-inv-ui.js';

export const PATRON = 'Patron';
const I = (id) => `<svg class="icon"><use href="#i-${id}"></use></svg>`;

/* ── Menyu quruluşu ──
   v2: yalnız yeni anbar rejimində görünür · legacy: yalnız köhnə rejimdə */
const MENU = [
  { g: 'rep', label: 'Hesabatlar', icon: 'chart', items: [
    { s: 'dashboard', l: 'Satış hesabatı', i: 'chart' },
    { s: 'closedOrders', l: 'Bağlanan masalar', i: 'lock' },
    { s: 'inv-analysis', l: 'Sərf və itki analizi', i: 'warning', v2: 1 },
    { s: 'inv-moves', l: 'Anbar hərəkətləri', i: 'refresh', v2: 1 },
    { s: 'logs', l: 'Tarixçə (jurnal)', i: 'clipboard' },
    { s: 'feedback', l: 'Rəylər və şikayətlər', i: 'chat' }
  ] },
  { g: 'acc', label: 'Mühasibat', icon: 'money', items: [
    { sub: 'Pul' },
    { s: 'inv-approvals', l: 'Təsdiq gözləyənlər', i: 'check', badge: 'approvals' },
    { s: 'inv-cash', l: 'Kassa', i: 'cash' },
    { s: 'inv-purchases', l: 'Alış qaimələri', i: 'clipboard', v2: 1 },
    { s: 'purchases', l: 'Məhsul alışları', i: 'cash', legacy: 1 },
    { s: 'inv-payments', l: 'Təchizatçı ödənişləri', i: 'money', v2: 1 },
    { s: 'customers', l: 'Nisyə hesabları', i: 'card' },
    { sub: 'Anbar', v2: 1 },
    { s: 'inv-balances', l: 'Qalıqlar', i: 'box', v2: 1 },
    { s: 'inv-count', l: 'Sayım', i: 'clipboard', v2: 1 },
    { s: 'inv-stockdocs', l: 'Silinmə və transfer', i: 'shuffle', v2: 1 },
    { s: 'inv-production', l: 'Hazırlama', i: 'chef', v2: 1 }
  ] },
  { g: 'banq', label: 'Banket', icon: 'clock', items: [
    { s: 'banquetDashboard', l: 'Banket paneli', i: 'chart' },
    { s: 'banquetCalendar', l: 'Təqvim', i: 'clock' }
  ] },
  { g: 'reg', label: 'Qeydiyyat', icon: 'folder', items: [
    { s: 'staff', l: 'İşçilər', i: 'staff' },
    { s: 'tables', l: 'Masalar', i: 'chair' },
    { s: 'inv-catalog', l: 'Məhsullar (kataloq)', i: 'food', v2: 1 },
    { s: 'menu', l: 'Menyu', i: 'food', legacy: 1 },
    { s: 'kitchenStations', l: 'Mətbəxlər', i: 'chef' },
    { s: 'inv-warehouses', l: 'Anbarlar', i: 'box', v2: 1 },
    { s: 'inv-suppliers', l: 'Təchizatçılar', i: 'users', v2: 1 },
    { s: 'suppliers', l: 'Təchizatçılar', i: 'users', legacy: 1 },
    { s: 'loyaltyCustomers', l: 'Loyallıq üzvləri', i: 'star' },
    { s: 'paymentMethods', l: 'Ödəniş növləri', i: 'card' },
    { s: 'banquetHalls', l: 'Banket zalları', i: 'chair' },
    { s: 'banquetEventTypes', l: 'Tədbir növləri', i: 'tag' }
  ] },
  { g: 'sys', label: 'Sistem', icon: 'settings', items: [
    { s: 'settings', l: 'Ümumi ayarlar', i: 'settings' },
    { s: 'inv-settings', l: 'Anbar parametrləri', i: 'box' },
    { s: 'printers', l: 'Printerlər', i: 'printer' },
    { s: 'notifSounds', l: 'Bildiriş səsləri', i: 'bell' },
    { s: 'dangerZone', l: 'Təhlükəli əməliyyatlar', i: 'warning', danger: 1 }
  ] }
];
const NEW_MENU = [
  { sec: 'Qeydiyyat' },
  { k: 'staff', l: 'İşçi', i: 'staff' },
  { k: 'tables', l: 'Masa', i: 'chair' },
  { k: 'inv:product', l: 'Məhsul', i: 'food', v2: 1 },
  { k: 'menu', l: 'Məhsul', i: 'food', legacy: 1 },
  { k: 'inv:supplier', l: 'Təchizatçı', i: 'users', v2: 1 },
  { k: 'suppliers', l: 'Təchizatçı', i: 'users', legacy: 1 },
  { k: 'inv:warehouse', l: 'Anbar', i: 'box', v2: 1 },
  { k: 'customers', l: 'Nisyə müştəri', i: 'card' },
  { k: 'paymentMethods', l: 'Ödəniş növü', i: 'card' },
  { k: 'kitchenStations', l: 'Mətbəx', i: 'chef' },
  { k: 'banquetHalls', l: 'Banket zalı', i: 'chair' },
  { k: 'printers', l: 'Printer', i: 'printer' },
  { sep: 1 }, { sec: 'Mühasibat' },
  { k: 'inv:purchase', l: 'Alış qaiməsi', i: 'clipboard', v2: 1 },
  { k: 'purchases', l: 'Məhsul alışı', i: 'cash', legacy: 1 },
  { k: 'inv:payment', l: 'Təchizatçıya ödəniş', i: 'money', v2: 1 },
  { k: 'inv:cash-in', l: 'Kassa mədaxili', i: 'cash' },
  { k: 'inv:cash-out', l: 'Kassa məxarici', i: 'cash' },
  { k: 'inv:cash-transfer', l: 'Kassa transferi', i: 'shuffle' },
  { sep: 1, v2: 1 }, { sec: 'Anbar', v2: 1 },
  { k: 'inv:writeoff', l: 'Silinmə aktı', i: 'trash', v2: 1 },
  { k: 'inv:transfer', l: 'Anbar transferi', i: 'shuffle', v2: 1 },
  { k: 'inv:count', l: 'Sayım', i: 'clipboard', v2: 1 },
  { k: 'inv:production', l: 'Hazırlama aktı', i: 'chef', v2: 1 }
];
const modeCls = (o) => o.v2 ? ' yz-only-v2' : o.legacy ? ' yz-only-legacy' : '';
const allItems = () => MENU.flatMap(g => g.items.filter(x => x.s));

/* ── Sol menyu ── */
function buildSidebar() {
  const box = $('adminTabsContainer');
  if (!box || box.dataset.yzShell) return !!box;
  box.dataset.yzShell = '1';
  box.innerHTML = `
    <button type="button" class="admin-tab yz-zal-tab" data-section="zal" onclick="adminTab('zal',this)">${I('chair')} <span>Zal — canlı masalar</span></button>
    ${MENU.map(g => `<div class="ap-group" data-group="${g.g}">
      <button class="ap-group__header" type="button" onclick="apToggleGroup(this)">
        <svg class="icon ap-group__icon"><use href="#i-${g.icon}"></use></svg><span>${g.label}</span>
        <span class="yz-side-badge" data-badge-group="${g.g}" hidden></span>
        <svg class="icon ap-group__arrow"><use href="#i-chevron"></use></svg>
      </button>
      <div class="ap-group__items">${g.items.map(x => x.sub
        ? `<div class="ap-sub${modeCls(x)}">${x.sub}</div>`
        : `<button class="admin-tab${modeCls(x)}" type="button" data-section="${x.s}" onclick="adminTab('${x.s}',this)"${x.danger ? ' style="color:var(--red);"' : ''}>${I(x.i)} <span>${x.l}</span>${x.badge ? `<span class="yz-side-badge" data-badge="${x.badge}" hidden></span>` : ''}</button>`).join('')}
      </div></div>`).join('')}`;
  return true;
}
function buildNewMenu() {
  const dd = $('apNewMenu');
  if (!dd || dd.dataset.yzShell) return;
  dd.dataset.yzShell = '1';
  dd.innerHTML = NEW_MENU.map(x => x.sep ? `<div class="ap-new-dropdown__sep${modeCls(x)}"></div>`
    : x.sec ? `<div class="ap-new-dropdown__section${modeCls(x)}">${x.sec}</div>`
    : `<button type="button" class="ap-new-dropdown__item${modeCls(x)}" onclick="apNewItem('${x.k}')">${I(x.i)} ${x.l}</button>`).join('');
}

/* ── Anbar/kassa bölmələri (admin) ── */
function ensureSections() {
  const body = $('adminBody'); if (!body) return;
  $('sec-inv')?.remove();               // əvvəlki versiyanın tək bölməsi
  allItems().filter(x => x.s.startsWith('inv-')).forEach(x => {
    if ($('sec-' + x.s)) return;
    const d = document.createElement('div');
    d.className = 'admin-section yz-inv-sec'; d.id = 'sec-' + x.s;
    d.innerHTML = '<div class="yz-inv-host"></div>';
    body.appendChild(d);
  });
}

/* ── adminTab / adminGoBack / apNewItem bükmələri ── */
function setTitle(sec) {
  const t = $('apPageTitle'); if (!t) return;
  const it = allItems().find(x => x.s === sec);
  t.textContent = it ? it.l : 'Patron Paneli';
}
function wrapGlobals() {
  if (typeof window.adminTab !== 'function' || typeof window.apNewItem !== 'function') return false;
  if (window.__yzShellWrapped) return true;
  window.__yzShellWrapped = true;
  const origTab = window.adminTab;
  window.adminTab = function (sec, el) {
    if (sec === 'zal') { enterZal(); return; }
    if (!el) el = document.querySelector(`#adminTabsContainer .admin-tab[data-section="${sec}"]`);
    origTab(sec, el);
    setTitle(sec);
    if (String(sec).startsWith('inv-')) {
      startInv(); watchDocs();
      mountSingle($('sec-' + sec)?.querySelector('.yz-inv-host'), sec.slice(4));
      $('sec-' + sec)?.scrollTo?.(0, 0);
    }
  };
  const origBack = window.adminGoBack;
  if (typeof origBack === 'function') window.adminGoBack = function () { origBack(); setTitle(null); };
  const origNew = window.apNewItem;
  window.apNewItem = function (k) {
    if (!String(k).startsWith('inv:')) return origNew(k);
    $('apNewMenu')?.classList.remove('open');
    newInv(k.slice(4));
  };
  return true;
}
async function newInv(k) {
  startInv(); watchDocs();
  try {
    if (k === 'product') { const m = await import('./yuza-inv-catalog.js'); m.openEditor(null); }
    else if (k === 'warehouse') { const m = await import('./yuza-inv-catalog.js'); m.whEditor(null); }
    else if (k === 'supplier') { const m = await import('./yuza-inv-purchase.js'); m.supplierEditor(null); }
    else if (k === 'purchase') { const m = await import('./yuza-inv-purchase.js'); m.openPurchaseEditor(null); }
    else if (k === 'payment') { const m = await import('./yuza-inv-purchase.js'); m.openPaymentEditor(null, {}); }
    else if (k.startsWith('cash-')) { const m = await import('./yuza-inv-cash.js'); m.openCashEditor(null, { dir: k.slice(5) }); }
    else { const m = await import('./yuza-inv-stock.js'); m.openEditor(k, null); }
  } catch (e) { console.warn('[shell]', e); }
}

/* ── Təsdiq zəngi və nişanlar ── */
function myPendingN() { try { return pendingDocs().filter(d => canApprove(d.kind, d)).length; } catch (e) { return 0; } }
function ensureBell() {
  const right = document.querySelector('#adminTopbar .topbar-right');
  if (!right || $('yzBell')) return;
  const b = document.createElement('button');
  b.id = 'yzBell'; b.type = 'button'; b.className = 'yz-bell'; b.title = 'Təsdiq gözləyən sənədlər'; b.setAttribute('aria-label', 'Təsdiq gözləyənlər');
  b.innerHTML = `${I('bell')}<span class="yz-bell__n" hidden></span>`;
  b.addEventListener('click', () => window.adminTab('inv-approvals'));
  right.insertBefore(b, $('themeToggleBtn') || right.firstChild);
}
function updateBadges() {
  const n = state.user?.role === 'admin' ? myPendingN() : 0;
  const set = (el) => { if (!el) return; el.hidden = !n; el.textContent = n > 99 ? '99+' : String(n); };
  document.querySelectorAll('[data-badge="approvals"], [data-badge-group="acc"]').forEach(set);
  set(document.querySelector('#yzBell .yz-bell__n'));
}

/* ═══ ZAL — Patron qarson ekranında ═══ */
let zalSubs = null, zalTimer = null;
function zalRender() {
  clearTimeout(zalTimer);
  zalTimer = setTimeout(() => { try { window.staffApp?.render(); } catch (e) { console.warn('[zal]', e); } }, 30);
}
function enterZal() {
  if (state.user?.role !== 'admin') return;
  patronize();
  document.body.classList.add('yz-patron-zal');
  const nm = $('wName'); if (nm) nm.textContent = PATRON;
  const rb = $('wRoleBadge'); if (rb) rb.textContent = 'Bütün masalar';
  const av = $('wAvatar'); if (av && !av.dataset.yzPatron) { av.dataset.yzPatron = '1'; av.src = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" rx="40" fill="#8a5a0b"/><text x="40" y="53" font-family="Arial" font-size="38" font-weight="700" fill="#fff" text-anchor="middle">P</text></svg>'); }
  ensureZalBack();
  showScreen('waiterScreen');
  if (!zalSubs) {
    zalSubs = ['tables', 'tableOrders', 'staff', 'menuItems'].map(p => { const r = db.ref(p); const cb = () => zalRender(); r.on('value', cb); return () => r.off('value', cb); });
  }
  zalRender();
}
function exitZal() {
  try { if ($('orderScreen')?.classList.contains('active')) window.staffApp?.closeTableDetail(); } catch (e) { /* */ }
  zalSubs?.forEach(off => off()); zalSubs = null;
  document.body.classList.remove('yz-patron-zal');
  showScreen('adminScreen');
}
function ensureZalBack() {
  const head = document.querySelector('#waiterScreen .waiter-header');
  if (!head || $('yzZalBack')) return;
  const b = document.createElement('button');
  b.id = 'yzZalBack'; b.type = 'button'; b.className = 'btn btn-ghost yz-zal-back';
  b.innerHTML = '← Panelə qayıt';
  b.addEventListener('click', exitZal);
  head.insertBefore(b, $('themeToggleBtnWaiter') || null);
}
/* Admin = Patron: ad və sabit id (masa sahibi, sənəd müəllifi kimi görünsün) */
function patronize() {
  if (state.user?.role !== 'admin') return;
  if (!state.user.id) state.user.id = 'admin';
  if (!state.user.name || state.user.name === 'Admin') state.user.name = PATRON;
}

/* ═══ İŞÇİ: "Anbar" ekranı ═══ */
function staffHost() { return $('yzInvStaffHost'); }
function openStaffInv() { startInv(); showScreen('invScreen'); mount(staffHost()); syncStaffBack(); }
function syncStaffBack() {
  const b = $('yzInvStaffBack'); if (!b) return;
  const noFloor = state.user?.role === 'staff' && !(state.user.permissions || []).includes('table.view');
  b.innerHTML = noFloor ? `${I('lock')} Çıxış` : `${I('close')} Geri`;
  b.dataset.mode = noFloor ? 'logout' : 'back';
}
function ensureStaffButton() {
  const head = document.querySelector('#waiterScreen .waiter-header');
  if (!head) return;
  let b = $('yzInvStaffBtn');
  const show = state.user?.role === 'staff' && hasAnyInvPerm();
  if (!show) { b?.remove(); return; }
  if (b) return;
  b = document.createElement('button');
  b.id = 'yzInvStaffBtn'; b.type = 'button'; b.className = 'btn btn-ghost yzi-staff-btn';
  b.innerHTML = `${I('box')} Anbar`;
  b.addEventListener('click', openStaffInv);
  head.insertBefore(b, $('themeToggleBtnWaiter') || null);
}

/* ── Ekran dəyişikliklərini izləyən ümumi yoxlama ── */
let lastUser = null, lastAdminOn = false;
function tick() {
  const u = state.user;
  if (u) startInv();
  if (u !== lastUser) { lastUser = u; if (!u) { zalSubs?.forEach(off => off()); zalSubs = null; document.body.classList.remove('yz-patron-zal'); } }
  const adminOn = $('adminScreen')?.classList.contains('active');
  if (u?.role === 'admin') {
    patronize();
    if (adminOn && !lastAdminOn) { watchDocs(); ensureBell(); updateBadges(); }
  }
  lastAdminOn = !!adminOn;
  /* Masa icazəsi olmayan işçi (mühasib, anbardar) admin ekranına düşürsə → öz anbar ekranına */
  if (u?.role === 'staff' && adminOn && hasAnyInvPerm()) openStaffInv();
  ensureStaffButton();
}
function measureTopbar() {
  const tb = $('adminTopbar'); if (!tb) return;
  const set = () => { const h = tb.getBoundingClientRect().height; if (h > 0) document.documentElement.style.setProperty('--yz-tb', Math.round(h) + 'px'); };
  set();
  if (window.ResizeObserver) new ResizeObserver(set).observe(tb);
  window.addEventListener('resize', set);
}

export function initShell() {
  document.body.classList.add('yz-shell');
  const rl = document.querySelector('.yz-role--admin span'); if (rl) rl.textContent = PATRON;
  const pt = $('apPageTitle'); if (pt && /Admin/.test(pt.textContent)) pt.textContent = 'Patron Paneli';
  buildSidebar(); buildNewMenu(); ensureSections();
  if (!wrapGlobals()) { const t = setInterval(() => { if (wrapGlobals()) clearInterval(t); }, 200); setTimeout(() => clearInterval(t), 15000); }
  $('yzInvStaffBack')?.addEventListener('click', () => {
    if ($('yzInvStaffBack').dataset.mode === 'logout') { window.logout?.(); return; }
    showScreen('waiterScreen');
  });
  measureTopbar();
  new MutationObserver(tick).observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });
  tick();
  onInv((what) => { refresh(what); if (what === 'docs' || what === 'settings') updateBadges(); });
}
