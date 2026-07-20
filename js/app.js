/* ═══════════════════════════════════════════
   APP BOOTSTRAP
   Bütün modulları birləşdirən giriş nöqtəsi: giriş/çıxış, Firebase
   listener idarəsi, ekran keçidi, ilk yükləmə (demo data).
═══════════════════════════════════════════ */
import { R, db } from './firebase-service.js';
import { state, setAdminPin } from './state.js';
import { esc, toArr, showToast, addLog } from './utils.js';
import { staffHasPermission, PERMISSION_PRESETS } from './permissions.js';
import { injectIconSprite } from './icons.js';
import { showScreen, loadSavedTheme } from './theme.js';
import { setRole, numPress, clearPin, showErr } from './auth.js';
import { stopAlarm, checkIncomingOrders } from './alarm.js';
import { StaffApp } from './staff-app.js';
import { renderAdmin, renderLogs, initAdminTabDragDrop } from './admin.js';
import { renderKitchen } from './kitchen.js';
import { checkCustomerMode, initCustomerRequestListener, initWaiterChatListener, closeWaiterChat } from './customer.js';

let ADMIN_PIN = null;
let staffApp = null;

/* ── Giriş / Çıxış ── */

function doLogin() {
  const pin = state.pinBuffer;
  clearPin();

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

  if (state.role === 'kitchen' && String(pin) === String(state.kitchenPin)) {
    state.user = { role: 'kitchen', name: 'Mətbəx' };
    addLog('login', 'Mətbəx sistemə daxil oldu', { type: 'kitchen' });
    initListeners();
    showScreen('kitchenScreen');
    return;
  }

  if (state.role === 'staff') {
    R.staff.once('value', snap => {
      const data = snap.val() || {};
      const list = Object.keys(data).map(k => ({ id: k, ...data[k] }));
      const s = list.find(x => x.pin === pin);
      if (!s) { showErr('PIN kod tapılmadı!'); return; }
      if (s.status === 'offline') { showErr('Hesabınız deaktivdir. Adminə müraciət edin.'); return; }

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
      } else {
        showScreen('adminScreen');
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
    });
    return;
  }

  showErr('PIN kod səhvdir!');
}

function logout() {
  if (state.user?.role === 'staff') {
    R.staff.child(state.user.id).update({ status: 'ready', lastActive: Date.now() });
    addLog('logout', `"${state.user.name}" sistemdən çıxdı`, { staffId: state.user.id });
    unlockScreen();
    closeWaiterChat();
  } else if (state.user?.role === 'admin') {
    addLog('logout', 'Admin sistemdən çıxdı', { type: 'admin' });
  } else if (state.user?.role === 'kitchen') {
    addLog('logout', 'Mətbəx sistemdən çıxdı', { type: 'kitchen' });
  }
  stopAlarm();
  if (staffApp) staffApp.stop();
  removeListeners();
  state.user = null;
  state.staff = [];
  state.tables = [];
  state.orders = [];
  state.logs = [];
  state._shownRequests = [];
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

function showExitModal() { document.getElementById('exitModal').classList.add('open'); }
function closeExitModal() { document.getElementById('exitModal').classList.remove('open'); document.getElementById('exitPin').value = ''; }
function confirmExit() {
  const pin = document.getElementById('exitPin').value;
  if (String(pin) === String(ADMIN_PIN) || String(pin) === String(state.kitchenPin)) {
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

  R.staff.on('value', snap => {
    state.staff = toArr(snap.val());
    onDataChange();
    if (state.user?.role === 'admin') renderAdmin();
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
  R.menuItems.on('value', snap => { state.menuItems = toArr(snap.val()); if (state.user?.role === 'admin') onDataChange(); });
  R.customers.on('value', snap => { state.customers = toArr(snap.val()); if (state.user?.role === 'admin') onDataChange(); });
  R.paymentMethods.on('value', snap => { state.paymentMethods = toArr(snap.val()); onDataChange(); });
  R.closedOrders.limitToLast(200).on('value', snap => { state.closedOrders = toArr(snap.val()).reverse(); if (state.user?.role === 'admin') onDataChange(); });
  R.payments.limitToLast(500).on('value', snap => { state.payments = toArr(snap.val()); if (state.user?.role === 'admin') onDataChange(); });
  R.customerCharges.on('value', snap => { state.customerCharges = toArr(snap.val()).reverse(); if (state.user?.role === 'admin') onDataChange(); });
  R.tableOrders.on('value', snap => { state.tableOrders = snap.val() || {}; onDataChange(); });
  R.orders.on('value', snap => {
    state.orders = toArr(snap.val());
    onDataChange();
    if (state.user?.role === 'staff') checkIncomingOrders();
  });
  R.logs.limitToLast(300).on('value', snap => {
    state.logs = toArr(snap.val()).reverse();
    if (state.user?.role === 'admin') renderLogs();
  });

  initCustomerRequestListener();
  if (state.user?.role === 'staff') initWaiterChatListener();
}

function removeListeners() {
  R.staff.off(); R.tables.off(); R.menuItems.off(); R.tableOrders.off(); R.orders.off(); R.logs.off();
  R.customers.off(); R.paymentMethods.off(); R.closedOrders.off(); R.customerCharges.off(); R.payments.off();
  db.ref('customerRequests').off(); db.ref('feedbacks').off();
  db.ref('settings/kitchenPin').off(); db.ref('settings/adminPin').off(); db.ref('settings/bizDayStartHour').off(); db.ref('chats').off();
}

function onDataChange() {
  const r = state.user?.role;
  if (r === 'admin') renderAdmin();
  if (r === 'kitchen') renderKitchen();
  if (r === 'staff' && staffApp) staffApp.render();
}

/* ── İlk Yükləmə / Demo Data ── */

function seedDemoData() {
  R.tables.once('value', snap => {
    if (snap.val()) return;
    ['Masa 1', 'Masa 2', 'Masa 3', 'VIP Otaq', 'Terras', 'Bar'].forEach(name => {
      R.tables.push({ name, capacity: 4, occupant: null, notes: '', createdAt: Date.now() });
    });
  });

  db.ref('settings/adminPin').once('value', snap => {
    if (snap.val()) {
      ADMIN_PIN = snap.val();
      setAdminPin(snap.val());
    } else {
      ADMIN_PIN = '0000';
      setAdminPin('0000');
      db.ref('settings/adminPin').set('0000');
      console.log('İlk admin PIN yaradıldı: 0000');
    }
  });

  R.staff.once('value', snap => {
    if (snap.val()) return;
    [
      { name:'Əli Məmmədov', firstname:'Əli', lastname:'Məmmədov', position:'Qarson', pin:'1111', avatar:'https://ui-avatars.com/api/?name=Ali+Mammadov&background=2ecc71&color=fff&size=200', status:'active', createdAt:Date.now(), permissions: PERMISSION_PRESETS.waiter.perms },
      { name:'Leyla Həsənli', firstname:'Leyla', lastname:'Həsənli', position:'Qarson', pin:'2222', avatar:'https://ui-avatars.com/api/?name=Leyla+Hasanli&background=3498db&color=fff&size=200', status:'active', createdAt:Date.now(), permissions: PERMISSION_PRESETS.waiter.perms },
      { name:'Orxan Əliyev', firstname:'Orxan', lastname:'Əliyev', position:'Kassir', pin:'3333', avatar:'https://ui-avatars.com/api/?name=Orxan+Aliyev&background=8e44ad&color=fff&size=200', status:'offline', createdAt:Date.now(), permissions: PERMISSION_PRESETS.cashier.perms }
    ].forEach(w => R.staff.push(w));
  });
}

/* ── Bootstrap ── */

function bootstrap() {
  injectIconSprite();
  initAdminTabDragDrop();

  staffApp = new StaffApp();
  window.staffApp = staffApp; // debug/konsol üçün əlçatan

  document.addEventListener('auth:pin-complete', doLogin);

  seedDemoData();
  checkCustomerMode();
  loadSavedTheme();
  const fab = document.getElementById('adminFab');
  if (fab) fab.style.display = 'none';

  // Mövcud statik HTML `onclick="..."` atributları ilə işlədiyi üçün
  // bu funksiyalar qlobal əlçatan olmalıdır.
  window.doLogin = doLogin;
  window.logout = logout;
  window.setRole = setRole;
  window.numPress = numPress;
  window.showExitModal = showExitModal;
  window.closeExitModal = closeExitModal;
  window.confirmExit = confirmExit;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
