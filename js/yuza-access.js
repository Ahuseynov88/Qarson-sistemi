/* ═══════════════════════════════════════════
   YUZA POS — SƏLAHİYYƏTLİ ŞƏXSLƏR ÜÇÜN RƏHBƏR PANELİ (10.11.2026)
   Rəhbərin icazə verdiyi işçi Rəhbər paneli ilə EYNİ görünüşdə işləyir:
   sol menyu (kompüterdə) / bölmələr siyahısı (telefonda) — yalnız icazəli
   bölmələr görünür. Hansı bölməni görəcəyini və orada nə edəcəyini
   Rəhbər "İşçilər → İcazələr"də təyin edir.

   • Anbar, kassa, alış, rezerv bölmələri MÖVCUD icazələrlə açılır
     (məs. "Kassa qalıqlarını görmək" → Kassa bölməsi).
   • Qalan bölmələr üçün yeni "Rəhbər paneli — bölmələr" icazələri.
   • Ayarlar bölməsi yalnız Rəhbərdədir.
   Qeyd: icazələr hələ cihazda yoxlanır. Hər işçinin öz hesabı olanda
   (SaaS girişi) server tərəfində də yoxlanacaq.
═══════════════════════════════════════════ */
import { state } from './state.js';
import { ALL_PERMISSIONS } from './permissions.js';
import { showScreen } from './theme.js';
import { showToast } from './utils.js';

const $ = (id) => document.getElementById(id);
const I = (id) => `<svg class="icon"><use href="#i-${id}"></use></svg>`;
const isDesktop = () => window.matchMedia('(min-width:900px)').matches;

/* ── Yeni icazələr: bölmələr ── */
const PANEL_PERMS = [
  { key: 'panel.reports',        label: 'Satış hesabatı' },
  { key: 'panel.closedOrders',   label: 'Bağlanan masalar' },
  { key: 'panel.logs',           label: 'Tarixçə (jurnal)' },
  { key: 'panel.feedback',       label: 'Rəylər və şikayətlər' },
  { key: 'panel.customers',      label: 'Nisyə hesabları' },
  { key: 'panel.banquet',        label: 'Banket (panel, təqvim, zallar, tədbir növləri)' },
  { key: 'panel.staff',          label: 'İşçilər (qeydiyyat və icazələr) — diqqət: başqalarına icazə verə bilər' },
  { key: 'panel.tables',         label: 'Masaların qeydiyyatı' },
  { key: 'panel.kitchens',       label: 'Mətbəxlərin qeydiyyatı' },
  { key: 'panel.printers',       label: 'Printerlərin qeydiyyatı' },
  { key: 'panel.paymentMethods', label: 'Ödəniş növləri' },
  { key: 'panel.loyalty',        label: 'Loyallıq üzvləri' },
  { key: 'panel.att',            label: 'Personal izləmə' }
];
if (!ALL_PERMISSIONS.some(g => g.items?.some(i => i.key === 'panel.reports'))) {
  ALL_PERMISSIONS.push({
    group: 'Rəhbər paneli — bölmələr (anbar, kassa, alış və rezerv öz icazələri ilə açılır)',
    icon: I('admin'),
    items: PANEL_PERMS
  });
}

/* ── Bölmə → icazə ── */
const has = (p, k) => k.endsWith('*') ? p.some(x => x.startsWith(k.slice(0, -1))) : p.includes(k);
const any = (...ks) => (p) => ks.some(k => has(p, k));
const APPROVE = ['purchase.approve', 'supplier.payment.approve', 'stock.writeoff.approve', 'stock.transfer.approve', 'stock.count.approve', 'stock.production.approve', 'cash.approve', 'cash.close.approve'];
const ACCESS = {
  zal: any('table.view'),
  reservations: any('reserve.view'),
  dashboard: any('panel.reports', 'report.daily', 'report.weekly'),
  closedOrders: any('panel.closedOrders'),
  'inv-analysis': any('stock.report'),
  'inv-moves': any('stock.report'),
  logs: any('panel.logs'),
  feedback: any('panel.feedback'),
  'inv-approvals': any(...APPROVE),
  'inv-cash': any('cash.*'),
  'inv-purchases': any('purchase.*'),
  purchases: any('purchase.*'),
  'inv-payments': any('supplier.payment.*'),
  customers: any('panel.customers'),
  'inv-balances': any('stock.view'),
  'inv-count': any('stock.count.*'),
  'inv-stockdocs': any('stock.writeoff.*', 'stock.transfer.*'),
  'inv-production': any('stock.production.*'),
  banquetDashboard: any('panel.banquet'),
  banquetCalendar: any('panel.banquet'),
  banquetHalls: any('panel.banquet'),
  banquetEventTypes: any('panel.banquet'),
  staff: any('panel.staff'),
  tables: any('panel.tables'),
  'inv-catalog': any('catalog.*'),
  menu: any('menu.view', 'menu.edit'),
  kitchenStations: any('panel.kitchens'),
  'inv-warehouses': any('warehouse.manage'),
  'inv-suppliers': any('supplier.manage'),
  suppliers: any('supplier.manage'),
  loyaltyCustomers: any('panel.loyalty'),
  paymentMethods: any('panel.paymentMethods'),
  printers: any('panel.printers'),
  att: any('panel.att'),
  dangerZone: any('danger.*')
  // settings, inv-settings, notifSounds — yalnız Rəhbər
};
const perms = (u) => u?.permissions || [];
export function canSee(sec, u = state.user) {
  if (!u) return false;
  if (u.role === 'admin') return true;
  if (u.role !== 'staff') return false;
  const f = ACCESS[sec];
  return !!(f && f(perms(u)));
}
/* İşçinin Rəhbər panelində ən azı bir bölməsi varmı (Zal və rezervlər sayılmır — onlar masalar ekranındadır) */
export function hasPanel(u = state.user) {
  if (!u || u.role === 'admin') return u?.role === 'admin';
  return Object.keys(ACCESS).some(sec => sec !== 'zal' && sec !== 'reservations' && ACCESS[sec](perms(u)));
}

/* ── Menyunu süzmək ── */
const panelStaff = () => state.user?.role === 'staff';
function filterMenu() {
  const box = $('adminTabsContainer'); if (!box) return;
  const staff = panelStaff();
  box.querySelectorAll('.admin-tab[data-section]').forEach(b => {
    b.classList.toggle('yz-noaccess', staff && !canSee(b.dataset.section));
  });
  box.querySelectorAll('.ap-group').forEach(g => {
    const vis = [...g.querySelectorAll('.admin-tab[data-section]')].some(b => !b.classList.contains('yz-noaccess'));
    g.classList.toggle('yz-noaccess', staff && !vis);
    // alt başlıqlar (məs. "Pul", "Anbar") — altında görünən bölmə yoxdursa gizlədilir
    g.querySelectorAll('.ap-sub').forEach(sub => {
      let n = sub.nextElementSibling, seen = false;
      while (n && !n.classList.contains('ap-sub')) { if (n.matches('.admin-tab') && !n.classList.contains('yz-noaccess')) seen = true; n = n.nextElementSibling; }
      sub.classList.toggle('yz-noaccess', staff && !seen);
    });
  });
  // "+ Yeni" menyusu
  const NEW_SEC = {
    staff: 'staff', tables: 'tables', menu: 'menu', suppliers: 'suppliers', customers: 'customers', paymentMethods: 'paymentMethods',
    kitchenStations: 'kitchenStations', banquetHalls: 'banquetHalls', printers: 'printers', purchases: 'purchases',
    'inv:product': 'inv-catalog', 'inv:supplier': 'inv-suppliers', 'inv:warehouse': 'inv-warehouses', 'inv:purchase': 'inv-purchases',
    'inv:payment': 'inv-payments', 'inv:cash-in': 'inv-cash', 'inv:cash-out': 'inv-cash', 'inv:cash-transfer': 'inv-cash',
    'inv:writeoff': 'inv-stockdocs', 'inv:transfer': 'inv-stockdocs', 'inv:count': 'inv-count', 'inv:production': 'inv-production'
  };
  const dd = $('apNewMenu');
  if (dd) {
    dd.querySelectorAll('.ap-new-dropdown__item').forEach(it => {
      const k = (it.getAttribute('onclick') || '').match(/apNewItem\('([^']+)'\)/)?.[1];
      it.classList.toggle('yz-noaccess', staff && !(k && canSee(NEW_SEC[k] || k)));
    });
    let anyItem = false;
    dd.querySelectorAll('.ap-new-dropdown__item').forEach(it => { if (!it.classList.contains('yz-noaccess')) anyItem = true; });
    $('apNewBtn')?.classList.toggle('yz-noaccess', staff && !anyItem);
  }
  const title = $('apPageTitle');
  if (staff && title && /Rəhbər Paneli|Admin Paneli/.test(title.textContent)) title.textContent = state.user.name || 'Panel';
}

/* İlk icazəli bölmə (kompüterdə). Telefonda Rəhbərdə olduğu kimi bölmələr siyahısı açılır. */
export function openFirst() {
  filterMenu();
  if (!isDesktop()) { window.adminGoBack?.(); return; }
  const first = [...document.querySelectorAll('#adminTabsContainer .admin-tab[data-section]')]
    .find(b => !b.classList.contains('yz-noaccess') && b.dataset.section !== 'zal');
  if (first) window.adminTab?.(first.dataset.section, first);
}

/* ── adminTab qoruması: icazəsi olmayan bölmə açılmır ── */
function guardTab() {
  const cur = window.adminTab;
  if (typeof cur !== 'function' || cur.__yzAcc) return;
  const w = function (sec, el) {
    if (panelStaff()) {
      if (sec === 'zal') { if (canSee('zal')) showScreen('waiterScreen'); return; }   // işçinin öz masalar ekranı
      if (!canSee(sec)) { showToast(`${I('ban')} Bu bölmə üçün icazəniz yoxdur`); return; }
    }
    return cur(sec, el);
  };
  w.__yzAcc = true;
  window.adminTab = w;
}

/* ── Başlanğıc ── */
let mo = null;
function tick() {
  guardTab();
  if (panelStaff() && $('adminScreen')?.classList.contains('active')) filterMenu();
  else if (state.user?.role === 'admin') filterMenu();
}
function init() {
  tick();
  const box = $('adminTabsContainer');
  if (box && !mo) { mo = new MutationObserver(() => { if (!box.__yzBusy) { box.__yzBusy = 1; requestAnimationFrame(() => { box.__yzBusy = 0; tick(); }); } }); mo.observe(box, { childList: true, subtree: true }); }
  new MutationObserver(tick).observe($('adminScreen') || document.body, { attributes: true, attributeFilter: ['class'] });
  // Digər modullar adminTab-ı sonradan da bükə bilər (rezerv, davamiyyət) — qoruma ən üstdə qalsın
  const t = setInterval(tick, 500); setTimeout(() => clearInterval(t), 30000);
}

window.__yzAccess = { canSee, hasPanel, openFirst };

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
