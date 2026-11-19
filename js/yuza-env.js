/* ═══════════════════════════════════════════
   YUZA POS — MÜHİTLƏR (test sayt / əsas sayt) · Mərhələ 8 (19.11.2026)
   Sayt hansı ünvanda açılıbsa, ona uyğun baza və server seçilir.
   Bütün ünvan və açarlar YALNIZ bu fayldadır.

   ƏSAS SAYTI AYARLAMAQ (bir dəfə):
     Firebase → qarsonn-sistemi → ⚙ Project settings → General → "Your apps" → </> Web app
     → "firebaseConfig" içindəki dəyərləri aşağıdakı MAIN bloku ilə əvəz edin.
   Bu dəyərlər gizli deyil (hər brauzer onları görür); qoruma baza qaydaları və serverdədir.
═══════════════════════════════════════════ */
const H = location.hostname;
export const IS_TEST = H.startsWith('test-yuzapos') || H.endsWith('.pages.dev') || H === 'localhost';

const TEST = {
  firebase: {
    apiKey: 'AIzaSyDICGSJrT-ZEwRALnn7rp3Jv_NPouIF4sA',
    authDomain: 'test-yuzapos.firebaseapp.com',
    databaseURL: 'https://test-yuzapos-default-rtdb.europe-west1.firebasedatabase.app',
    projectId: 'test-yuzapos',
    storageBucket: 'test-yuzapos.firebasestorage.app',
    messagingSenderId: '896410036346',
    appId: '1:896410036346:web:095cec7fbc799f13d5b3c3'
  },
  api: 'https://yuza-api-test.huseynov-amal.workers.dev'
};

const MAIN = {
  firebase: {
    apiKey: 'AIzaSyCbtbtIm7SmpNkKAkq6zzZFfLqba7w60Gw',
    authDomain: 'yuzapos-a9e2f.firebaseapp.com',
    databaseURL: 'https://yuzapos-a9e2f-default-rtdb.europe-west1.firebasedatabase.app',
    projectId: 'yuzapos-a9e2f',
    storageBucket: 'yuzapos-a9e2f.firebasestorage.app',
    messagingSenderId: '938524695105',
    appId: '1:938524695105:web:be54abc4c7a7fdf98344c0'
  },
  api: 'https://yuza-api.huseynov-amal.workers.dev'
};

const ENV = IS_TEST ? TEST : MAIN;
/* Əsas sayt ayarlanmayıbsa (apiKey yazılmayıb) sayt QORUMASIZ köhnə rejimdə açılmamalıdır */
export const ENV_READY = !!ENV.firebase.apiKey && !/BURAYA/.test(JSON.stringify(ENV.firebase));
export const FIREBASE_CONFIG = ENV.firebase;
export const API_BASE = ENV.api;
