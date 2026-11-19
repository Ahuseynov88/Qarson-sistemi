/* ═══════════════════════════════════════════
   FIREBASE SERVICE
   Firebase Realtime Database qoşulması və ref-lər.
   Qeyd: layihə Firebase Compat SDK istifadə edir (index.html-də <script> ilə
   yüklənir), ona görə qlobal `firebase` obyektindən istifadə edirik və
   nəticəni digər modulların import edə biləcəyi kimi ixrac edirik.
═══════════════════════════════════════════ */
// Mühit (test / əsas) və onun baza ayarları yuza-env.js-dədir (Mərhələ 8)
import { IS_TEST, FIREBASE_CONFIG, ENV_READY } from './yuza-env.js';
const firebaseConfig = FIREBASE_CONFIG;
if (!ENV_READY) {
  // Əsas saytın ayarları yazılmayıb: qorumasız rejimdə açılmırıq
  const msg = 'Sayt hələ ayarlanmayıb: js/yuza-env.js faylında əsas bazanın ayarlarını (apiKey, appId) yazın.';
  const show = () => { document.body.innerHTML = `<div style="max-width:560px;margin:15vh auto;padding:24px;font:16px/1.5 sans-serif;border:2px solid #b3261e;border-radius:14px;color:#b3261e">${msg}</div>`; };
  if (document.body) show(); else window.addEventListener('DOMContentLoaded', show);
  throw new Error(msg);
}
if (IS_TEST) {
  document.title = 'TEST · ' + document.title;
  window.addEventListener('DOMContentLoaded', () => {
    const b = document.createElement('div');
    b.textContent = 'TEST SAYTI — test bazası';
    b.style.cssText = 'position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:99999;background:#b3261e;color:#fff;font:700 11px sans-serif;padding:3px 12px;border-radius:0 0 8px 8px;pointer-events:none';
    document.body.appendChild(b);
  });
}
firebase.initializeApp(firebaseConfig);
// Cihaz gözətçisi: giriş olmadan heç bir modul bazaya müraciət etmir (yuza-guard.js)
import { guardDevice } from './yuza-guard.js';
await guardDevice(firebaseConfig);

// İşçinin öz telefonunda (davamiyyətə qoşulmuş telefon) baza həmin telefonun girişi ilə işləyir (yuza-guard.js)
export const db = (window.__yzDbApp || firebase.app()).database();
export const R = {
  payments:    db.ref('payments'),
  staff:       db.ref('staff'),
  tables:      db.ref('tables'),
  orders:      db.ref('orders'),
  logs:        db.ref('logs'),
  menuItems:   db.ref('menuItems'),
  tableOrders: db.ref('tableOrders'),
  customers:      db.ref('customers'),
  paymentMethods: db.ref('paymentMethods'),
  closedOrders:   db.ref('closedOrders'),
  customerCharges: db.ref('customerCharges'),
  // Müştəri Tanıma & Loyallıq modulu üçün AYRICA node-lar - "customers" node-u
  // (nisyə/kredit hesabları) ilə QARIŞDIRILMIR, tamam fərqli konsepsiyadır.
  loyaltyCustomers: db.ref('loyaltyCustomers'),
  guestTokens:      db.ref('guestTokens'),
  referrals:        db.ref('referrals'),
  // Təchizatçılar & Məhsul Alışları modulu
  suppliers: db.ref('suppliers'),
  purchases: db.ref('purchases'),
  // Banket və Tədbirlərin İdarə Edilməsi modulu - "tables" (gündəlik restoran
  // masaları) və "menuItems" (a-la-cart menyu) ilə QARIŞDIRILMIR, tamam ayrıdır.
  banquetHalls: db.ref('banquetHalls'),
  banquetEventTypes: db.ref('banquetEventTypes'),
  banquetEvents: db.ref('banquetEvents'),
  // Zal+tarix üzrə rezervasiya "slot reyestri" - konflikt-təhlükəsiz yoxlama üçün
  // (bax: banquet.js -> saveBanquetEvent)
    banquetHallBookings: db.ref('banquetHallBookings'),
    kitchenOrders:   db.ref('kitchenOrders'),
  kitchenStations: db.ref('kitchenStations'),
   kitchenNotifs:   db.ref('kitchenNotifs'),
  notifSounds:     db.ref('notifSounds'),
  printers:        db.ref('printers'),
  printJobs:       db.ref('printJobs')
};
