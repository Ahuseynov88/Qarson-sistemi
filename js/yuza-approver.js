/* ═══════════════════════════════════════════
   YUZA POS — TƏSDİQ EDƏN ŞƏXS (Rəhbər və ya səlahiyyətli hesab) — 12.11.2026
   Cihazı Rəhbər və ya Rəhbərin hesab verdiyi səlahiyyətli şəxs (məs. növbə müdiri)
   öz istifadəçi adı + parolu ilə təsdiqləyir.

   • Giriş AYRICA, müvəqqəti tətbiq nüsxəsində olur və iş bitən kimi silinir —
     təsdiq edənin hesabı/açarı cihazda QALMIR.
   • İstifadəçi adı → e-poçt: sys/logins/{ad}. Rəhbər öz e-poçtunu yazır.
   • Hesab yaratmaq yalnız Rəhbərdədir (baza qaydaları bağlayır).
   Bu modul firebase-service.js-dən ASILI DEYİL (yuza-guard.js ondan əvvəl işləyir).
═══════════════════════════════════════════ */

const DOMAIN = 'staff.yuzapos.com';
export const normUser = (s) => String(s || '').trim().toLowerCase();
export const validUser = (u) => /^[a-z0-9][a-z0-9._-]{2,23}$/.test(u);

const ERR = {
  'auth/invalid-credential': 'İstifadəçi adı və ya parol səhvdir.',
  'auth/invalid-login-credentials': 'İstifadəçi adı və ya parol səhvdir.',
  'auth/wrong-password': 'İstifadəçi adı və ya parol səhvdir.',
  'auth/user-not-found': 'İstifadəçi adı və ya parol səhvdir.',
  'auth/invalid-email': 'E-poçt ünvanı düzgün yazılmayıb.',
  'auth/missing-password': 'Parolu yazın.',
  'auth/weak-password': 'Parol ən azı 6 simvol olmalıdır.',
  'auth/email-already-in-use': 'Bu giriş artıq mövcuddur. Yenidən cəhd edin.',
  'auth/too-many-requests': 'Çox sayda səhv cəhd. Server girişi müvəqqəti bağladı — bir neçə dəqiqə gözləyin.',
  'auth/network-request-failed': 'İnternet bağlantısı yoxdur.',
  'auth/user-disabled': 'Bu hesab dayandırılıb.',
  'auth/operation-not-allowed': 'Firebase-də e-poçt/parol girişi söndürülüb.',
  'auth/admin-restricted-operation': 'Firebase-də yeni hesab yaratmaq (sign-up) bağlanıb.',
  'yz/missing-login': 'İstifadəçi adını yazın.',
  'yz/bad-user': 'İstifadəçi adı 3–24 simvol: kiçik latın hərfləri, rəqəm, nöqtə, tire.',
  'yz/acc-off': 'Bu hesab Rəhbər tərəfindən söndürülüb.',
  'yz/not-approver': 'Bu hesabın cihaz təsdiqləmək səlahiyyəti yoxdur.',
  'yz/taken': 'Bu istifadəçi adı artıq istifadə olunur. Əvvəlcə köhnə hesabı söndürün.',
  'PERMISSION_DENIED': 'İcazə yoxdur (baza qaydaları).'
};
export const apprErr = (e) => ERR[e?.code] || (/permission/i.test(e?.code || e?.message || '') ? ERR.PERMISSION_DENIED : 'Alınmadı. Yenidən cəhd edin.' + (e?.code ? ` (${e.code})` : ''));

let seq = 0;
const tempApp = (tag) => firebase.initializeApp(firebase.app().options, `yz${tag}-${Date.now()}-${++seq}`);
async function drop(app) {
  try { await app.auth().signOut(); } catch (e) { /* */ }
  try { await app.delete(); } catch (e) { /* */ }
}

/* İstifadəçi adı və ya e-poçt → e-poçt */
export async function loginEmail(login) {
  login = String(login || '').trim();
  if (!login) throw { code: 'yz/missing-login' };
  if (login.includes('@')) return login;
  const u = normUser(login);
  if (!validUser(u)) throw { code: 'yz/bad-user' };
  const v = (await firebase.database().ref('sys/logins/' + u).once('value')).val();
  if (!v?.email) throw { code: 'auth/invalid-credential' };
  return v.email;
}

/* Təsdiq edən daxil olur → { db, uid, owner, name, staffId, release() }
   Mütləq release() çağırılmalıdır (giriş cihazda qalmasın). */
export async function approverSignIn(login, pw) {
  if (!pw) throw { code: 'auth/missing-password' };
  const email = await loginEmail(login);
  const app = tempApp('Ap');
  try {
    const a = app.auth(); a.languageCode = 'az';
    const u = (await a.signInWithEmailAndPassword(email, pw)).user;
    const adb = app.database();
    let owner = false, acc = null;
    try { owner = (await adb.ref('owners/' + u.uid).once('value')).val() === true; } catch (e) { /* */ }
    if (!owner) { try { acc = (await adb.ref('sys/accounts/' + u.uid).once('value')).val(); } catch (e) { /* */ } }
    // Yeni qurulan sistem: Rəhbər siyahısı boşdursa, e-poçtla girən ilk hesab Rəhbər olur (qaydalar yalnız bu halda icazə verir)
    if (!owner && !acc && String(login).includes('@')) {
      try { await adb.ref('owners/' + u.uid).set(true); owner = true; } catch (e) { /* siyahı boş deyil */ }
    }
    if (!owner) {
      if (!acc) throw { code: 'yz/not-approver' };
      if (acc.on !== true) throw { code: 'yz/acc-off' };
      if (acc.enroll !== true) throw { code: 'yz/not-approver' };
    }
    return { app, db: adb, uid: u.uid, owner, name: owner ? 'Rəhbər' : (acc.staffName || acc.username || 'Səlahiyyətli şəxs'), staffId: acc?.staffId || null, release: () => drop(app) };
  } catch (e) { await drop(app); throw e; }
}

/* Rəhbər üçün: yeni giriş hesabı (Firebase) yaradır → { uid, email }.
   E-poçt uydurmadır (göndərilmir); eyni ad yenidən yaradılanda toqquşmasın deyə sonuna təsadüfi hissə əlavə olunur. */
export async function createLogin(username, pw) {
  const rnd = Array.from(crypto.getRandomValues(new Uint8Array(3)), b => b.toString(16).padStart(2, '0')).join('');
  const email = `${username}.${rnd}@${DOMAIN}`;
  const app = tempApp('Mk');
  try {
    const u = (await app.auth().createUserWithEmailAndPassword(email, pw)).user;
    return { uid: u.uid, email };
  } finally { await drop(app); }
}

export function deviceModel() {
  const ua = navigator.userAgent || '';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Cihaz';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return br ? `${os} · ${br}` : os;
}
export const devCode = (uid) => String(uid || '').slice(-6).toUpperCase();
export function fmtDT(t) {
  if (!t) return '—';
  const d = new Date(t), p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
