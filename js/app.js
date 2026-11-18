/* ═══════════════════════════════════════════
   APP BOOTSTRAP
   Bütün modulları birləşdirən giriş nöqtəsi: giriş/çıxış, Firebase
   listener idarəsi, ekran keçidi, ilk yükləmə (demo data).
═══════════════════════════════════════════ */
import { R, db } from './firebase-service.js';
import { state, setAdminPin } from './state.js';
import { esc, toArr, showToast, addLog, confirmAction } from './utils.js';
import { staffHasPermission, PERMISSION_PRESETS } from './permissions.js';
import { injectIconSprite } from './icons.js';
import { showScreen, loadSavedTheme } from './theme.js';
import { setRole, numPress, clearPin, showErr } from './auth.js';
import { stopAlarm, checkIncomingOrders, checkKitchenReadyOrders, checkKitchenNotifs } from './alarm.js';
import { StaffApp } from './staff-app.js';
import { renderAdmin, renderLogs, initAdminTabDragDrop } from './admin.js';
import { renderKitchen, kitchenAcceptOrder } from './kitchen.js';
import { renderNotifSounds } from './notifSounds.js';
import { checkCustomerMode, initCustomerRequestListener, initWaiterChatListener, closeWaiterChat } from './customer.js';
import { ensureDefaultEventTypes } from './banquet.js';
import { renderPrinters, renderReceiptTemplateSettings } from './printer-settings.js';
import { raciaStart, raciaStop } from './racia.js';
import { api, apiOn } from './yuza-api.js';
import { watchShift, unwatchShift } from './yuza-shift.js';
let ADMIN_PIN = null;
let staffApp = null;

/* Rəhbər hesabı (e-poçt + parol) aktivdirsə Rəhbər PIN-i işlənmir — yuza-owner.js */
const ownerMode = () => window.__yzOwner ? !!window.__yzOwner.available()
  : (typeof firebase !== 'undefined' && typeof firebase.auth === 'function' && !!firebase.app().options.apiKey);
/* Rəhbər paneli açıqdır: Rəhbər və ya paneldə işləyən səlahiyyətli işçi */
const panelOn = () => state.user?.role === 'admin'
  || (state.user?.role === 'staff' && !!document.getElementById('adminScreen')?.classList.contains('active'));
window.__yzPanelOn = panelOn;

/* Rəhbər öz hesabı ilə daxil oldu (yuza-owner.js çağırır) */
async function enterAdmin(owner) {
  state.user = { role: 'admin', name: 'Rəhbər', id: 'admin', ownerUid: owner?.uid || null, email: owner?.email || '' };
  addLog('login', 'Rəhbər sistemə daxil oldu', { type: 'admin', email: owner?.email || '' });
  // Baza qaydaları Rəhbər panelinin məlumatlarını yalnız "Rəhbər sessiyası" olan cihaza açır —
  // sessiya dinləyicilərdən ƏVVƏL yazılmalıdır, yoxsa hesabat və kassa boş görünər
  if (apiOn()) {
    try {
      const deviceToken = await firebase.app().auth().currentUser?.getIdToken();
      await api('ownerSession', { deviceToken }, { owner: true });
    } catch (e) {
      showToast('<svg class="icon"><use href="#i-warning"></use></svg> Server sessiyası açılmadı: ' + (e.message || 'xəta') + ' — bəzi bölmələr boş görünə bilər. Səhifəni yeniləyin.');
    }
  }
  initListeners();
  showScreen('adminScreen');
}

/* ── Giriş / Çıxış ── */

function doLogin() {
  const pin = state.pinBuffer;
  clearPin();

  if (window.__yzPhone) state.role = 'staff';   // işçinin öz telefonu: yalnız işçi girişi
  if (state.role === 'admin' && ownerMode()) { showErr('Rəhbər e-poçt və parolu ilə daxil olur'); return; }
  if (state.role === 'admin') {
    if (ADMIN_PIN === null) { showErr('Sistem hazırlanır, bir saniyə gözləyin...'); return; }
    if (String(pin) === String(ADMIN_PIN)) {
      state.user = { role: 'admin', name: 'Admin' };
      addLog('login', 'Admin sistemə daxil oldu', { type: 'admin' });
      initListeners();
      showScreen('adminScreen');
      return;
    }
  }

        if (state.role === 'kitchen') {
    // Server qatı: PIN serverdə yoxlanır (yuza-api.js)
    if (apiOn()) {
      api('login', { pin, kind: 'kitchen' }).then(({ kitchen }) => enterKitchen(kitchen))
        .catch(e => showErr(e.message || 'Bağlantı xətası, yenidən cəhd edin'));
      return;
    }
    // Hər iki mənbəyi eyni anda Firebase-dən birbaşa oxu (cache-ə arxalanma)
    Promise.all([
      db.ref('settings/kitchenPin').once('value'),
      db.ref('kitchenStations').once('value')
    ]).then(([pinSnap, stationsSnap]) => {
                const legacyPin = pinSnap.val() || null;   // köhnə ümumi mətbəx PIN-i (yalnız bir dəfəlik keçid üçün)
      const liveStations = toArr(stationsSnap.val());

            // Köhnə ümumi mətbəx PIN-i → bir dəfəlik avtomatik "Əsas mətbəx" stansiyasına çevrilir
      // (bütün sifarişləri görür). Bundan sonra mətbəx PIN-i yalnız Mətbəxlər bölməsində idarə olunur.
      if (legacyPin && String(pin) === String(legacyPin) && !liveStations.some(s => String(s.pin) === String(pin))) {
        const ref = R.kitchenStations.push();
        const st = { name: 'Əsas mətbəx', pin: String(legacyPin), responsible: '', active: true, showAll: true, menuItemIds: [], createdAt: Date.now(), updatedAt: Date.now() };
        ref.set(st).then(() => db.ref('settings/kitchenPin').remove());
        liveStations.push({ id: ref.key, ...st });
      }

      // Çoxlu mətbəx stansiyaları
      const matchStation = liveStations.find(s => s.active !== false && String(s.pin) === String(pin));
      if (matchStation) {
        state.kitchenStations = liveStations;
        enterKitchen(matchStation);
        return;
      }

      showErr('PIN kod səhvdir!');
    }).catch(err => {
      console.error('[KitchenLogin] Firebase oxuma xətası:', err);
      showErr('Bağlantı xətası, yenidən cəhd edin');
    });
    return;
  }

  if (state.role === 'staff') {
    // Server qatı: PIN serverdə yoxlanır, PIN-lər cihaza yüklənmir (yuza-api.js)
    if (apiOn()) {
      api('login', { pin, kind: 'staff' }).then(({ staff }) => enterStaff(staff))
        .catch(e => showErr(e.message || 'Bağlantı xətası, yenidən cəhd edin'));
      return;
    }
    R.staff.once('value', async snap => {
      const data = snap.val() || {};
      const list = Object.keys(data).map(k => ({ id: k, ...data[k] }));
      const s = list.find(x => x.pin === pin);
      if (!s) { showErr('PIN kod tapılmadı!'); return; }
      enterStaff(s);
    });
    return;
  }

  showErr('PIN kod səhvdir!');
}

/* Mətbəx girişi (PIN yoxlandıqdan sonra) */
function enterKitchen(st) {
  if (!Array.isArray(state.kitchenStations) || !state.kitchenStations.some(k => k.id === st.id)) state.kitchenStations = [...(state.kitchenStations || []), st];
  state.user = { role: 'kitchen', name: st.name };
  state._activeKitchen = st;
  addLog('login', `"${st.name}" mətbəxi daxil oldu`, { kitchenId: st.id });
  initListeners();
  const ttl = document.getElementById('kitchenPanelTitle');
  if (ttl) ttl.textContent = st.name;
  showScreen('kitchenScreen');
}

/* İşçi girişi (PIN yoxlandıqdan sonra) */
async function enterStaff(s) {
      // İşçinin öz telefonu: yalnız telefonun sahibi girə bilər
      const _ph = window.__yzPhone;
      if (_ph && s.id !== _ph.staffId) { showErr(`Bu telefonla yalnız ${_ph.name || 'telefonun sahibi'} daxil ola bilər`); return; }
      if (s.status === 'offline') { showErr('Hesabınız deaktivdir. Adminə müraciət edin.'); return; }
      // Sistemə girişi olmayan işçi (aşpaz, qabyuyan, mühafizə...) və ya açılacaq bölməsi olmayan işçi girə bilməz.
      // İşçi yalnız masalar ekranına (table.view) və ya anbar/kassa ekranına girir — Rəhbər panelinə YOX.
      const _p = s.permissions || [];
      const _panel = !!window.__yzAccess?.hasPanel({ ...s, role: 'staff', permissions: _p });
      if (s.systemAccess === false || !(_p.includes('table.view') || _panel || _p.includes('delivery.courier'))) {
        showErr('Sizin sistemə giriş icazəniz yoxdur'); return;
      }
      // Davamiyyət: ayarlarda açıqdırsa, QR ilə "İşə gəldim" etməyən işçi sistemə girə bilməz
      const { attGate } = await import('./yuza-att-gate.js');
      if (!(await attGate(s))) { if (apiOn()) api('logout').catch(() => {}); return; }

      state.user = { ...s, role: 'staff', permissions: s.permissions || [] };
      R.staff.child(s.id).update({ status: 'online', lastLogin: Date.now() });
      addLog('login', `"${s.name}" sistemə daxil oldu`, { staffId: s.id });
      initListeners();

      if (staffHasPermission(state.user, 'table.view')) {
        showScreen('waiterScreen');
        document.getElementById('wName').textContent = s.name;
        document.getElementById('wAvatar').src = s.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(s.name)}&background=8e44ad&color=fff&size=200`;
        const roleBadge = document.getElementById('wRoleBadge');
        if (roleBadge) roleBadge.textContent = esc(s.position || '');
        lockScreen();
      } else if (!_panel && _p.includes('delivery.courier')) {
        // Yalnız kuryer: masalar və panel yoxdur → kuryer ekranı (yuza-delivery.js)
        window.__yzDelivery?.openCourierHome?.();
      } else {
        // Masa icazəsi yoxdur → Rəhbər paneli görünüşündə yalnız icazəli bölmələr
        showScreen('adminScreen');
        window.__yzAccess?.openFirst?.();
        showToast('<svg class="icon"><use href="#i-check"></use></svg> Xoş gəldiniz, ' + s.name);
      }

      R.staff.child(state.user.id).onDisconnect().update({ status: 'ready', lastSeen: Date.now() });
      const disconnectLogRef = R.logs.push();
      disconnectLogRef.onDisconnect().set({
        type: 'logout', message: `"${s.name}" sistemdən çıxdı (bağlantı kəsildi)`,
        details: { staffId: s.id, method: 'disconnect' },
        timestamp: Date.now(), time: new Date().toLocaleTimeString('az-AZ'),
        date: new Date().toLocaleDateString('az-AZ')
      });
}

// Ofisiantın ÖZ hesabından çıxması üçün - PIN TƏLƏB OLUNMUR (kiosk-dan çıxış ilə
// QARIŞDIRILMIR). Bu, ortaq cihazda bir ofisiant sifarişini bitirib başqa ofisiantın
// öz PIN-i ilə daxil ola bilməsi üçündür - tez-tez baş verən, normal bir əməliyyatdır.
// DİQQƏT: logout() adi halda fullscreen-dən çıxarır (admin/mətbəx üçün doğru davranış),
// AMMA istifadəçi DƏYİŞMƏ zamanı bunu İSTƏMİRİK - kiosk qorunması davam etməlidir,
// ona görə logout()-dan DƏRHAL sonra fullscreen-i özümüz bərpa edirik.
function confirmLogoutSelf() {
  confirmAction('Hesabınızdan çıxmaq istəyirsiniz? Başqa işçi öz PIN-i ilə daxil ola biləcək.', () => {
    logout();
    lockScreen();
  });
}

function logout(opts = {}) {
  // Serverdəki cihaz sessiyası bağlanır (bu cihazda daha heç kim işləmir)
  if (apiOn() && (state.user?.role === 'staff' || state.user?.role === 'kitchen' || state.user?.role === 'admin')) api('logout').catch(() => {});
  if (state.user?.role === 'staff') {
    R.staff.child(state.user.id).update({ status: 'ready', lastActive: Date.now() });
    addLog('logout', `"${state.user.name}" sistemdən çıxdı`, { staffId: state.user.id });
    if (!opts.keepKiosk) unlockScreen();
    closeWaiterChat();
  } else if (state.user?.role === 'admin') {
    addLog('logout', 'Rəhbər sistemdən çıxdı', { type: 'admin' });
    if (state.user.ownerUid) window.__yzOwner?.signOut?.();
  } else if (state.user?.role === 'kitchen') {
    addLog('logout', 'Mətbəx sistemdən çıxdı', { type: 'kitchen' });
  }
  stopAlarm();
  raciaStop();
  if (staffApp) staffApp.stop();
  removeListeners();
  state.user = null;
  state.staff = [];
  state.tables = [];
  state.orders = [];
  state.logs = [];
  state._shownRequests = [];
     state._activeKitchen = null;
  state._shownKitchenOrders = [];
  state.activeChatTableId = null;
  state.activeChatConvId = null;
  state._batchSelection = {};
  state._waiterStaffFilter = null;
  showScreen('loginScreen');
}

function lockScreen() {
  if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  history.pushState(null, '', location.href);
}

function unlockScreen() {
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
}

/* Ofisiantın çıxışı: parolsuz, dərhal ümumi PIN ekranına. Kiosk (tam ekran) rejimi davam edir —
   növbəti işçi öz PIN-i ilə girir. Rəhbər üçün (Zal rejimi) köhnə qayda: Rəhbər parolu. */
function staffExit() {
  if (state.user?.role === 'staff') { logout({ keepKiosk: true }); lockScreen(); return; }
  showExitModal();
}

function showExitModal() {
  if (ownerMode()) {
    window.__yzOwner.verify({ title: 'Kioskdan çıxış', text: 'Kiosk rejimindən çıxmaq üçün Rəhbər parolunu yazın.', okLabel: 'Çıx' })
      .then(ok => { if (ok) logout(); });
    return;
  }
  document.getElementById('exitModal').classList.add('open');
}
function closeExitModal() { document.getElementById('exitModal').classList.remove('open'); document.getElementById('exitPin').value = ''; }
function confirmExit() {
  const pin = document.getElementById('exitPin').value;
    if (String(pin) === String(ADMIN_PIN)) {
    closeExitModal();
    logout();
  } else {
    showToast('<svg class="icon"><use href="#i-error"></use></svg> PIN səhvdir!');
  }
}

/* ── Firebase Listener İdarəsi ── */

function initListeners() {
  db.ref('settings/kitchenPin').on('value', snap => { if (snap.val()) state.kitchenPin = snap.val(); });
  db.ref('settings/adminPin').on('value', snap => { if (snap.val()) { ADMIN_PIN = snap.val(); setAdminPin(snap.val()); } });
  db.ref('settings/bizDayStartHour').on('value', snap => {
    if (snap.val() !== null && snap.val() !== undefined) {
      state._bizDayStartHour = snap.val();
      const el = document.getElementById('repBizDayHour');
      if (el && document.activeElement !== el) el.value = String(snap.val()).padStart(2,'0') + ':00';
    }
  });
    db.ref('settings/vatMode').on('value', snap => {
    state.vatMode = snap.val() === 'added' ? 'added' : 'included';
  });
  db.ref('settings/serviceCharge').on('value', snap => {
    state.serviceCharge = snap.val() || { enabled: false, percent: 0 };
    if (panelOn()) onDataChange();
  });

  R.staff.on('value', snap => {
    state.staff = toArr(snap.val());
    onDataChange();
    if (panelOn()) renderAdmin();
    if (state.user?.role === 'staff') {
      const me = state.staff.find(w => w.id === state.user.id);
      if (me && me.status === 'offline') {
        document.getElementById('deactivatedOverlay').classList.add('show');
        stopAlarm(); unlockScreen();
        setTimeout(() => { document.getElementById('deactivatedOverlay').classList.remove('show'); logout(); }, 3000);
      }
    }
  });

  R.tables.on('value', snap => { state.tables = toArr(snap.val()); onDataChange(); });
  R.menuItems.on('value', snap => { state.menuItems = toArr(snap.val()); if (panelOn()) onDataChange(); });
  R.paymentMethods.on('value', snap => { state.paymentMethods = toArr(snap.val()); onDataChange(); });
  R.tableOrders.on('value', snap => { state.tableOrders = snap.val() || {}; onDataChange(); });
  // Mərhələ 3a: hər rol yalnız özünə lazım olanı yükləyir (mətbəx — maliyyə, müştəri, banket və s. yükləmir)
  const r = state.user?.role;
  if (r === 'staff') {
    needData('staff');
    if (staffHasPermission(state.user, 'panel.banquet')) needData('banquet');   // banket xəbərdarlıqları
  }
  if (r === 'admin') needData('panel');
     R.kitchenStations.on('value', snap => {
    state.kitchenStations = toArr(snap.val());
    if (panelOn()) renderAdmin();
  });
     R.kitchenOrders.limitToLast(50).on('value', snap => {
    state.kitchenOrders = toArr(snap.val());
    if (state.user?.role === 'kitchen') renderKitchen();
    if (state.user?.role === 'staff') checkKitchenReadyOrders();
  });
     R.notifSounds.on('value', snap => {
    state.notifSounds = toArr(snap.val());
    if (panelOn()) renderAdmin();
  });
  db.ref('settings/notifSoundMap').on('value', snap => {
    state.notifSoundMap = snap.val() || {};
  });
  db.ref('settings/kitchenAlertIntervalSec').on('value', snap => {
    if (snap.val()) state.kitchenAlertIntervalSec = snap.val();
  });

  R.printers.on('value', snap => {
    state.printers = toArr(snap.val());
    if (panelOn() && state.adminSection === 'printers') renderPrinters();
  });

  watchShift();   // Mərhələ 2c: açıq kassa növbəsi
  initCustomerRequestListener();
  if (state.user?.role === 'staff') initWaiterChatListener();
  raciaStart();
}

/* ── Mərhələ 3a: məlumat qrupları — yalnız lazım olanda yüklənir ──
   staff   — ofisiant ekranı: ofisiant çağırışları, mətbəx bildirişləri, nisyə müştəriləri
   banquet — banket zalları, növləri, banketlər
   loyalty — loyallıq müştəriləri (paket / bron pəncərəsində telefonla tanıma)
   panel   — Rəhbər paneli: hesabat, kassa, anbar, loglar (+ banquet, loyalty, staff-ın müştəriləri) */
const _groups = new Set();
const _groupWait = {};
function onPanel(fn) { return snap => { fn(snap); if (panelOn()) onDataChange(); }; }
function needData(g) {
  if (!state.user) return Promise.resolve();
  if (_groups.has(g)) return _groupWait[g] || Promise.resolve();
  _groups.add(g);
  const first = [];
  const on = (ref, fn) => first.push(new Promise(res => { let done = false; ref.on('value', snap => { fn(snap); if (!done) { done = true; res(); } }, () => res()); }));
  if (g === 'staff') {
    on(R.customers, onPanel(snap => { state.customers = toArr(snap.val()); }));
    on(R.orders, snap => { state.orders = toArr(snap.val()); onDataChange(); if (state.user?.role === 'staff') checkIncomingOrders(); });
    on(R.kitchenNotifs, snap => { state.kitchenNotifs = toArr(snap.val()); if (state.user?.role === 'staff') checkKitchenNotifs(); });
  } else if (g === 'banquet') {
    on(R.banquetHalls, onPanel(snap => { state.banquetHalls = toArr(snap.val()); }));
    on(R.banquetEventTypes, onPanel(snap => { state.banquetEventTypes = toArr(snap.val()); }));
    on(R.banquetEvents, onPanel(snap => { state.banquetEvents = toArr(snap.val()); }));
  } else if (g === 'loyalty') {
    on(R.loyaltyCustomers, onPanel(snap => { state.loyaltyCustomers = toArr(snap.val()).reverse(); }));
  } else if (g === 'panel') {
    if (!_groups.has('staff')) { _groups.add('cust'); on(R.customers, onPanel(snap => { state.customers = toArr(snap.val()); })); }
    needData('banquet'); needData('loyalty');
    on(R.closedOrders.limitToLast(200), onPanel(snap => { state.closedOrders = toArr(snap.val()).reverse(); }));
    on(R.suppliers, onPanel(snap => { state.suppliers = toArr(snap.val()); }));
    on(R.purchases, onPanel(snap => { state.purchases = toArr(snap.val()).reverse(); }));
    on(R.payments.limitToLast(500), onPanel(snap => { state.payments = toArr(snap.val()); }));
    on(R.customerCharges, onPanel(snap => { state.customerCharges = toArr(snap.val()).reverse(); }));
    on(R.logs.limitToLast(300), snap => { state.logs = toArr(snap.val()).reverse(); if (panelOn()) renderLogs(); });
  }
  _groupWait[g] = Promise.all(first);
  return _groupWait[g];
}
window.yzNeedData = needData;
// Səlahiyyətli işçi Rəhbər panelinə keçəndə panel məlumatları həmin an yüklənir
document.addEventListener('yz:screen', (ev) => { if (ev.detail === 'adminScreen' && state.user) needData('panel').then(() => { if (panelOn()) renderAdmin(); }); });

function removeListeners() {
  _groups.clear(); for (const k of Object.keys(_groupWait)) delete _groupWait[k];
  for (const k of ['customers', 'closedOrders', 'loyaltyCustomers', 'suppliers', 'purchases', 'payments', 'customerCharges', 'banquetHalls', 'banquetEventTypes', 'banquetEvents', 'kitchenNotifs']) state[k] = [];
  unwatchShift();
  R.staff.off(); R.tables.off(); R.menuItems.off(); R.tableOrders.off(); R.orders.off(); R.logs.off();
  R.customers.off(); R.paymentMethods.off(); R.closedOrders.off(); R.customerCharges.off(); R.payments.off(); R.loyaltyCustomers.off(); R.suppliers.off(); R.purchases.off(); R.banquetHalls.off(); R.banquetEventTypes.off(); R.banquetEvents.off();   R.kitchenOrders.off(); R.kitchenStations.off(); R.kitchenNotifs.off(); R.notifSounds.off(); R.printers.off();
  db.ref('customerRequests').off(); db.ref('feedbacks').off();
   db.ref('settings/notifSoundMap').off(); db.ref('settings/kitchenAlertIntervalSec').off();
  db.ref('settings/kitchenPin').off(); db.ref('settings/adminPin').off(); db.ref('settings/bizDayStartHour').off(); db.ref('settings/serviceCharge').off(); db.ref('settings/vatMode').off(); db.ref('chats').off();
}

function onDataChange() {
  const r = state.user?.role;
  if (panelOn()) renderAdmin();
  if (r === 'kitchen') renderKitchen();
  if (r === 'staff' && staffApp) staffApp.render();
}

/* ── İlk Yükləmə / Demo Data ── */

function seedDemoData() {
  // Yeni şirkət BOŞ başlayır: demo masa, işçi yaradılmır — hamısını Rəhbər özü qeyd edir.
  // Rəhbər PIN-i yoxdursa, standart "0000" yox, ekranda PIN yaratmaq pəncərəsi açılır.
  db.ref('settings/adminPin').once('value', snap => {
    if (snap.val()) { ADMIN_PIN = snap.val(); setAdminPin(snap.val()); return; }
    if (ownerMode()) return;   // Rəhbər e-poçt + parolla girir — PIN lazım deyil
    import('./yuza-firstrun.js').then(m => m.askFirstAdminPin()).then(pin => { ADMIN_PIN = pin; setAdminPin(pin); });
  });
}

/* ── Bootstrap ── */

// Bağlantı vəziyyətini izləyir - Firebase-in xüsusi ".info/connected" yolu HƏQİQİ
// server bağlantısını göstərir (sadəcə navigator.onLine-dan daha etibarlıdır, çünki
// WiFi ola bilər amma Firebase-ə çatmaya bilər). Oflayn olanda banner göstərir,
// bərpa olananda bildiriş verir. QEYD: səhifə açıq qaldığı müddətdə Firebase SDK-nın
// öz oflayn növbəsi artıq işləyir (yazılar avtomatik saxlanılıb sonra göndərilir) -
// bu, sadəcə istifadəçiyə vəziyyəti GÖRSƏDİR.
// QEYD: bu, YALNIZ istifadəçi ÖZÜ səhifəni bağlamaq/tərk etmək istəyəndə işə düşür
// (brauzerin "beforeunload" hadisəsi). Telefonda başqa proqrama keçəndə (tab arxa
// fonda qalır, BAĞLANMIR) bu, İŞƏ DÜŞMÜR - əməliyyat sistemi yaddaş azlığından
// arxa fondakı vərəqi SONRADAN, JS-in heç bir müdaxilə imkanı olmadan söndürə bilər.
// Bu barədə ən yaxşı qorunma - oflayn bannerini diqqətçəkən etməkdir (aşağıda).
let _isCurrentlyOffline = false;
let _wasOffline = false;

function initConnectionMonitor() {
  db.ref('.info/connected').on('value', snap => {
    const connected = snap.val() === true;
    _isCurrentlyOffline = !connected;
    const banner = document.getElementById('connectionStatusBanner');
    if (banner) banner.classList.toggle('show', !connected);
    if (!connected) {
      _wasOffline = true;
    } else if (_wasOffline) {
      _wasOffline = false;
      showToast('<svg class="icon"><use href="#i-check"></use></svg> Bağlantı bərpa olundu, dəyişikliklər sinxronlaşdırıldı');
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (_isCurrentlyOffline) {
      e.preventDefault();
      e.returnValue = 'İnternet bağlantısı yoxdur! Bu səhifəni tərk etsəniz, göndərilməmiş dəyişikliklər itə bilər.';
      return e.returnValue;
    }
  });
}

function bootstrap() {
  injectIconSprite();
  initAdminTabDragDrop();
  initConnectionMonitor();

  staffApp = new StaffApp();
  window.staffApp = staffApp; // debug/konsol üçün əlçatan

  document.addEventListener('auth:pin-complete', doLogin);

    const _guest = /[?&](table|ref)=/.test(location.search);
    if (!_guest) seedDemoData();
  checkCustomerMode();
  loadSavedTheme();
  const fab = document.getElementById('adminFab');
  if (fab) fab.style.display = 'none';

  // Mövcud statik HTML `onclick="..."` atributları ilə işlədiyi üçün
  // bu funksiyalar qlobal əlçatan olmalıdır.
  window.doLogin = doLogin;
  window.__yzEnterAdmin = enterAdmin;
  window.logout = logout;
  window.confirmLogoutSelf = confirmLogoutSelf;
  window.setRole = setRole;
  window.numPress = numPress;
  window.showExitModal = showExitModal;
  window.staffExit = staffExit;
  window.closeExitModal = closeExitModal;
  window.confirmExit = confirmExit;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
