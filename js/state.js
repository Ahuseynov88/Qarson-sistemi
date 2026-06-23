/* ═══════════════════════════════════════════
   STATE
   Bu fayl: bütün proqramın "yaddaşı". Digər bütün fayllar
   bu state obyektini oxuyub-yazır. Bu fayl ƏN ƏVVƏL yüklənməlidir
   (firebase-config.js-dən sonra), çünki demək olar hər fayl ona ehtiyac duyur.
═══════════════════════════════════════════ */
let ADMIN_PIN = null; // Firebase-dən yüklənəcək (bax: listeners.js və main.js)

let state = {
  role: 'admin',
  user: null,
  staff: [],              // bütün əməkdaşlar (qarson, baş qarson, kassir, müdir...)
  tables: [],
  orders: [],
  logs: [],
  menuItems: [],
  tableOrders: {},        // {tableId: {items:{...}, total}} — Firebase-dən real-time gəlir
  logFilter: 'all',
  adminSection: 'dashboard',
  alarm: null,           // aktiv alarm (order id və ya request id)
  alarmType: null,       // 'order' | 'customer'
  alarmInterval: null,
  editTarget: null,
  noteTableId: null,
  pendingTableId: null,
  pendingCloseTableId: null,
  kitchenPin: '9999',
  pinBuffer: '',
  _shownRequests: [],    // eyni tələbin iki dəfə göstərilməməsi üçün
  activeChatTableId: null,
  activeChatConvId: null,
  _tableCatFilter: 'all',
  _waiterCatFilter: 'all',
  _menuCatFilter: 'all',
  orderTableId: null,      // hazırda sifariş edilən masa
  _orderCatFilter: 'all',  // sifariş modalındaki kateqoriya filtri
  _orderDraft: {},         // {menuItemId: {qty, note, extraFee}} — hələ göndərilməmiş, modal daxilindəki müvəqqəti səbət
  _orderDetailItemId: null // hazırda detal pəncərəsi açıq olan malın id-si
};
/* ═══════════════════════════════════════════
   GECƏ/GÜNDÜZ REJİM KEÇİDİ
   Bu fayl: istifadəçinin ağ (gündüz) və tünd (gecə) rejim
   arasında keçməsi. Seçim brauzerin yaddaşında saxlanılır,
   hər istifadəçi (admin/qarson/mətbəx/müştəri) öz seçimini
   özü saxlayır, bir-birinə təsir etmir.
═══════════════════════════════════════════ */
function applyTheme(isDark) {
  document.body.classList.toggle('dark-mode', isDark);
  const icon = isDark ? '☀️' : '🌙';
  ['themeToggleBtn', 'themeToggleBtnWaiter', 'themeToggleBtnKitchen', 'themeToggleBtnCustomer'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.textContent = icon;
  });
}

function toggleTheme() {
  const isDark = !document.body.classList.contains('dark-mode');
  applyTheme(isDark);
  try { localStorage.setItem('themeMode', isDark ? 'dark' : 'light'); } catch(e) {}
}

function loadSavedTheme() {
  let saved = null;
  try { saved = localStorage.getItem('themeMode'); } catch(e) {}
  applyTheme(saved === 'dark');
}
/* ═══════════════════════════════════════════
   UTILS
   Bu fayl: kiçik, hər yerdə istifadə olunan köməkçi funksiyalar.
   esc() demək olar hər render funksiyasında işlədilir, ona görə
   bu fayl render edən bütün fayllardan ƏVVƏL yüklənməlidir.
═══════════════════════════════════════════ */
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function toArr(obj) {
  if (!obj) return [];
  return Object.keys(obj).map(k=>({id:k,...obj[k]}));
}

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(()=>el.classList.remove('show'),3000);
}

function showCustomerToast(msg) {
  const el = document.getElementById('customerToast');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => el.style.display='none', 3000);
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
