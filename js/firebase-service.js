/* ═══════════════════════════════════════════
   FIREBASE SERVICE
   Firebase Realtime Database qoşulması və ref-lər.
   Qeyd: layihə Firebase Compat SDK istifadə edir (index.html-də <script> ilə
   yüklənir), ona görə qlobal `firebase` obyektindən istifadə edirik və
   nəticəni digər modulların import edə biləcəyi kimi ixrac edirik.
═══════════════════════════════════════════ */

const firebaseConfig = {
  databaseURL: "https://qarsonn-sistemi-default-rtdb.europe-west1.firebasedatabase.app/"
};

firebase.initializeApp(firebaseConfig);

export const db = firebase.database();

export const R = {
  payments:    db.ref('payments'),
  staff:       db.ref('staff'),
  tables:      db.ref('tables'),
  orders:      db.ref('orders'),
  logs:        db.ref('logs'),
  menuItems:   db.ref('menuItems'),
  tableOrders: db.ref('tableOrders'),
  customers:      db.ref('customers'),
  paymentMethods: db.ref('paymentMethods')
};
