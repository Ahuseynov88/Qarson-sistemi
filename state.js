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
  waiters: [],
  tables: [],
  orders: [],
  logs: [],
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
  _tableCatFilter: 'all'
};
