/* ═══════════════════════════════════════════
   FIREBASE KONFİQURASİYA
   Bu fayl: Firebase bağlantısını qurur, R obyekti
   ilə bütün başqa faylların Firebase-ə çata bilməsini təmin edir.
═══════════════════════════════════════════ */
const firebaseConfig = {
  databaseURL: "https://qarsonn-sistemi-default-rtdb.europe-west1.firebasedatabase.app/"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

const R = {
  waiters: db.ref('waiters'),
  tables:  db.ref('tables'),
  orders:  db.ref('orders'),
  logs:    db.ref('logs')
};
