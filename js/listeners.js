/* ═══════════════════════════════════════════
   FIREBASE LISTENERS
   Bu fayl: proqram boyu açıq qalan Firebase "dinləyiciləri".
   initListeners() yalnız uğurlu LOGIN-dən sonra çağrılır (bax: auth.js).
   removeListeners() logout()-da çağrılır, hamısını söndürür.
═══════════════════════════════════════════ */
function initListeners() {
  db.ref('settings/kitchenPin').on('value', snap => {
    if (snap.val()) state.kitchenPin = snap.val();
  });

  db.ref('settings/adminPin').on('value', snap => {
    if (snap.val()) ADMIN_PIN = snap.val();
  });

  R.waiters.on('value', snap=>{
    state.waiters = toArr(snap.val());
    onDataChange();
    if (state.user?.role==='waiter') {
      const me = state.waiters.find(w=>w.id===state.user.id);
      if (me && me.status==='offline') {
        document.getElementById('deactivatedOverlay').classList.add('show');
        stopAlarm(); unlockScreen();
        setTimeout(()=>{ document.getElementById('deactivatedOverlay').classList.remove('show'); logout(); },3000);
      }
    }
  });

  R.tables.on('value', snap=>{
    state.tables = toArr(snap.val());
    onDataChange();
  });

  R.menuItems.on('value', snap=>{
    state.menuItems = toArr(snap.val());
    if (state.user?.role==='admin') onDataChange();
  });

  R.tableOrders.on('value', snap=>{
    state.tableOrders = snap.val() || {};
    onDataChange();
  });

  R.orders.on('value', snap=>{
    state.orders = toArr(snap.val());
    onDataChange();
    if (state.user?.role==='waiter') checkIncomingOrders();
  });

  R.staff.on('value', snap=>{
    state.staff = toArr(snap.val());
    if (state.user?.role==='admin') renderAdmin();
  });

  R.logs.limitToLast(300).on('value', snap=>{
    state.logs = toArr(snap.val()).reverse();
    if (state.user?.role==='admin') renderLogs();
  });

  initCustomerRequestListener();

  // Qarson üçün çat mesajlarını dinlə
  if (state.user?.role === 'waiter') {
    initWaiterChatListener();
  }
}

function removeListeners() {
  R.waiters.off();
  R.tables.off();
  R.menuItems.off();
  R.tableOrders.off();
  R.orders.off();
  R.logs.off();
  R.staff.off();
  db.ref('customerRequests').off();
  db.ref('feedbacks').off();
  db.ref('settings/kitchenPin').off();
  db.ref('settings/adminPin').off();
  db.ref('chats').off();
}

function onDataChange() {
  const r = state.user?.role;
  if (r==='admin')   renderAdmin();
  if (r==='kitchen') renderKitchen();
  if (r==='waiter')  renderWaiterTables();
}
