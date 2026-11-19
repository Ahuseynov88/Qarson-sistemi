/* ═══════════════════════════════════════════
   YUZA POS — RƏHBƏR HESABI (10.11.2026)
   Rəhbər artıq 4 rəqəmli PIN ilə deyil, ÖZ HESABI ilə girir:
   e-poçt + parol. Parolu Firebase serveri yoxlayır (kodda saxlanmır),
   çoxlu səhv cəhddən sonra server girişi müvəqqəti bağlayır.

   • Sessiya ən çox 12 saat davam edir. 15 dəqiqə toxunulmasa panel kilidlənir,
     açmaq üçün parol yenidən yazılır.
   • "Çıxış" sessiyanı bitirir — növbəti girişdə parol yenə soruşulur.
   • Rəhbər hesabı cihaz kimliyindən AYRIDIR (ayrıca "yzOwner" tətbiq nüsxəsi):
     cihazın təsdiqi pozulmur.
   • İlk dəfə daxil olan Rəhbər hesabı bazada "owners" siyahısına yazılır.
     Siyahı doldurulduqdan sonra başqa hesab özünü Rəhbər edə bilməz (qaydalar bağlayır).
   • Konfiqurasiyada apiKey yoxdursa (köhnə əsas sayt) — modul işə düşmür, köhnə PIN qalır.

   Digər modullar üçün:  window.__yzOwner = { available, verify, signOut, email, sendReset, db }
═══════════════════════════════════════════ */
import { state } from './state.js';

const SESSION_MAX = 12 * 3600 * 1000;
const IDLE_MAX = 15 * 60 * 1000;
const K_EMAIL = 'yzOwnerEmail', K_AT = 'yzOwnerAt', K_ACT = 'yzOwnerAct';

const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, String(v)); } catch (e) { /* */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch (e) { /* */ } }
};
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ═══ 1. HESAB ═══ */
export function ownerAvailable() {
  try { return typeof firebase !== 'undefined' && typeof firebase.auth === 'function' && !!firebase.app().options.apiKey; }
  catch (e) { return false; }
}
let _app = null;
function oApp() {
  if (_app) return _app;
  _app = firebase.apps.find(a => a.name === 'yzOwner') || firebase.initializeApp(firebase.app().options, 'yzOwner');
  try { _app.auth().languageCode = 'az'; } catch (e) { /* */ }
  return _app;
}
const oAuth = () => oApp().auth();
function firstUser() {
  return new Promise(res => { const off = oAuth().onAuthStateChanged(u => { off(); res(u); }); });
}
// E-poçt cihazda SAXLANMIR (ortaq ekranda görünməsin). Yalnız açıq Rəhbər sessiyasından götürülür.
export const ownerEmail = () => { try { return (ownerAvailable() && oAuth().currentUser?.email) || ''; } catch (e) { return ''; } };

const ERR = {
  'auth/invalid-credential': 'E-poçt və ya parol səhvdir.',
  'auth/invalid-login-credentials': 'E-poçt və ya parol səhvdir.',
  'auth/wrong-password': 'E-poçt və ya parol səhvdir.',
  'auth/user-not-found': 'E-poçt və ya parol səhvdir.',
  'auth/invalid-email': 'E-poçt ünvanı düzgün yazılmayıb.',
  'auth/missing-password': 'Parolu yazın.',
  'auth/missing-email': 'E-poçtu yazın.',
  'auth/too-many-requests': 'Çox sayda səhv cəhd. Server girişi müvəqqəti bağladı — bir neçə dəqiqə sonra yenidən cəhd edin.',
  'auth/network-request-failed': 'İnternet bağlantısı yoxdur.',
  'auth/user-disabled': 'Bu hesab dayandırılıb.',
  'yz/same': 'Bu hesab Rəhbər hesabı kimi istifadə oluna bilməz.',
  'yz/not-owner': 'Bu hesab Rəhbər hesabı deyil.'
};
export const ownerErr = (e) => ERR[e?.code] || 'Giriş alınmadı. Yenidən cəhd edin.';

/* Hesab "owners" siyahısındadır? Siyahı boşdursa — bu hesab ilk Rəhbər olur. */
async function checkOwner(u) {
  const odb = oApp().database();
  try { if ((await odb.ref('owners/' + u.uid).once('value')).val() === true) return true; } catch (e) { /* oxuna bilmədi */ }
  try { await odb.ref('owners/' + u.uid).set(true); return true; }   // qaydalar yalnız siyahı boş olanda icazə verir
  catch (e) { return false; }
}

export async function ownerSignIn(email, pw) {
  email = String(email || '').trim();
  if (!email) throw { code: 'auth/missing-email' };
  if (!pw) throw { code: 'auth/missing-password' };
  const cred = await oAuth().signInWithEmailAndPassword(email, pw);
  const u = cred.user;
  if (firebase.auth().currentUser && firebase.auth().currentUser.uid === u.uid) { await oAuth().signOut(); throw { code: 'yz/same' }; }
  if (!(await checkOwner(u))) { await oAuth().signOut(); throw { code: 'yz/not-owner' }; }
  ls.set(K_AT, Date.now()); ls.set(K_ACT, Date.now());
  return u;
}
export async function ownerSignOut() {
  ls.del(K_AT); ls.del(K_ACT);
  try { await oAuth().signOut(); } catch (e) { /* */ }
}
/* Sessiya hələ etibarlıdır? (12 saat keçməyib, son 15 dəqiqədə istifadə olunub) */
async function sessionAlive() {
  const u = oAuth().currentUser || await firstUser();
  if (!u) return null;
  const at = +ls.get(K_AT) || 0, act = +ls.get(K_ACT) || 0, t = Date.now();
  return (t - at < SESSION_MAX && t - act < IDLE_MAX) ? u : null;
}
/* Rəhbər sessiyası açıqdırsa onun baza bağlantısı (Rəhbərə məxsus yazılar üçün: hesablar, cihazlar) */
export function ownerDbNow() {
  if (!ownerAvailable()) return null;
  const u = oAuth().currentUser;
  if (!u) return null;
  const at = +ls.get(K_AT) || 0, act = +ls.get(K_ACT) || 0, t = Date.now();
  if (t - at >= SESSION_MAX || t - act >= IDLE_MAX) return null;
  return oApp().database();
}
export async function sendReset(email) {
  email = String(email || '').trim();
  if (!email) throw { code: 'auth/missing-email' };
  await oAuth().sendPasswordResetEmail(email);
}

/* ═══ 2. PAROL PƏNCƏRƏSİ (təsdiq / kilid) ═══
   ownerVerify({ title, text, lock }) → true (parol düzdür) | false (ləğv) */
const CSS = `
#yzOwV{position:fixed;inset:0;z-index:99990;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(6,8,11,.86);font-family:Inter,system-ui,sans-serif;color:#f4eee2}
#yzOwV.is-lock{background:radial-gradient(circle at 50% 0%,#3a2a0e 0%,#14100a 55%,#0b0906 100%)}
#yzOwV form{width:100%;max-width:370px;background:#14110b;border:1px solid rgba(232,176,75,.45);border-radius:20px;padding:24px 20px;box-shadow:0 20px 60px rgba(0,0,0,.5)}
#yzOwV .ow-ico{width:54px;height:54px;border-radius:50%;margin:0 auto 10px;display:flex;align-items:center;justify-content:center;background:rgba(232,176,75,.14);color:#e8b04b}
#yzOwV .ow-ico svg{width:26px;height:26px}
#yzOwV h2{margin:0 0 6px;font-size:18px;text-align:center}
#yzOwV p{margin:0 0 14px;font-size:13.5px;line-height:1.5;color:#c9bfae;text-align:center}
#yzOwV label{display:block;font-size:12px;font-weight:700;color:#c9bfae;margin:10px 0 6px}
#yzOwV input{width:100%;box-sizing:border-box;padding:12px 13px;border-radius:12px;border:1px solid rgba(232,176,75,.35);background:rgba(0,0,0,.35);color:#fff;font-size:16px;outline:none}
#yzOwV input:focus{border-color:#e8b04b}
#yzOwV input[readonly]{opacity:.75}
#yzOwV .ow-err{min-height:18px;margin-top:10px;font-size:13px;color:#ff8a80;text-align:center}
#yzOwV .ow-row{display:flex;gap:10px;margin-top:14px}
#yzOwV button{flex:1;padding:13px;border-radius:12px;font-weight:800;font-size:15px;cursor:pointer;border:1px solid rgba(232,176,75,.35);background:transparent;color:#f4eee2;display:inline-flex;align-items:center;justify-content:center;gap:6px}
#yzOwV button.ow-ok{border:0;background:linear-gradient(180deg,#f6cf7c,#e1a43e);color:#1a1205}
#yzOwV button[disabled]{opacity:.6;cursor:wait}
#yzOwV button svg{width:20px;height:20px}
#yzOwV .ow-link{flex:none;display:block;margin:12px auto 0;padding:4px;border:0;background:none;color:#e8b04b;font-size:13px;font-weight:600;text-decoration:underline}
`;
function ensureCss() {
  if ($('yzOwCss')) return;
  const s = document.createElement('style'); s.id = 'yzOwCss'; s.textContent = CSS; document.head.appendChild(s);
}
const ICO_KEY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3 21 2M16 7l3 3M14 9l2 2"/></svg>';
const ICO_LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
const ICO_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const ICO_OUT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 16l4-4-4-4M19 12H9"/></svg>';

let _pending = null;
export function ownerVerify({ title = 'Rəhbər təsdiqi', text = 'Davam etmək üçün Rəhbər parolunu yazın.', lock = false, okLabel = 'Təsdiqlə' } = {}) {
  if (!ownerAvailable()) return Promise.resolve(false);
  if (_pending) return _pending;
  ensureCss();
  _pending = new Promise(resolve => {
    const em = '';   // e-poçt hər dəfə yazılır — ekranda göstərilmir
    const box = document.createElement('div');
    box.id = 'yzOwV'; box.className = lock ? 'is-lock' : '';
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
    box.innerHTML = `<form novalidate autocomplete="off">
      <div class="ow-ico">${lock ? ICO_LOCK : ICO_KEY}</div>
      <h2>${esc(title)}</h2><p>${text}</p>
      <label for="yzOwVE">E-poçt</label>
      <input id="yzOwVE" type="email" autocomplete="off" autocapitalize="none" spellcheck="false" data-lpignore="true">
      <label for="yzOwVP">Parol</label>
      <input id="yzOwVP" type="password" autocomplete="new-password" data-lpignore="true">
      <div class="ow-err" role="alert"></div>
      <div class="ow-row">
        <button type="button" class="ow-no" aria-label="${lock ? 'Çıxış' : 'Bağla'}" title="${lock ? 'Çıxış' : 'Bağla'}">${lock ? ICO_OUT : ICO_X}</button>
        <button type="submit" class="ow-ok">${esc(okLabel)}</button>
      </div>
    </form>`;
    document.body.appendChild(box);
    const f = box.querySelector('form'), errEl = box.querySelector('.ow-err'), okB = box.querySelector('.ow-ok');
    const done = (v) => { box.remove(); _pending = null; resolve(v); };
    box.querySelector('.ow-no').onclick = () => done(false);
    box.querySelector('[data-other]')?.addEventListener('click', () => { const e = $('yzOwVE'); e.readOnly = false; e.value = ''; e.focus(); });
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      okB.disabled = true; errEl.textContent = '';
      try {
        await ownerSignIn($('yzOwVE').value, $('yzOwVP').value);
        // Rəhbər panelində deyilsə (məs. qarson cihazında təsdiq) — sessiya bu cihazda QALMIR
        if (!(state.user?.role === 'admin' && state.user?.ownerUid)) await ownerSignOut();
        done(true);
      }
      catch (e) { errEl.textContent = ownerErr(e); $('yzOwVP').value = ''; $('yzOwVP').focus(); okB.disabled = false; }
    });
    setTimeout(() => (em ? $('yzOwVP') : $('yzOwVE'))?.focus(), 60);
  });
  return _pending;
}

/* ═══ 3. GİRİŞ EKRANI: Rəhbər → e-poçt + parol ═══ */
function enterAdmin(u) {
  if (typeof window.__yzEnterAdmin === 'function') window.__yzEnterAdmin({ uid: u.uid, email: u.email || ownerEmail() });
}
/* Rəhbər girişi giriş ekranında açıq görünmür: yuxarı küncdəki kiçik açar ikonu
   ayrıca pəncərə açır. E-poçt və parol hər dəfə boş açılır, brauzer yadda saxlamır. */
const ICO_KEYBTN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="M10.8 12.2 20 3M17 6l3 3M14.5 8.5l2 2"/></svg>';
function buildLoginForm() {
  const root = $('yzLogin');
  if (!root || $('yzOwnerForm')) return;
  // Açar düyməsi (dil / tema düymələrinin yanında, yazısız)
  const top = root.querySelector('.yz-topbar');
  if (top && !$('yzKeyBtn')) {
    const k = document.createElement('button');
    k.type = 'button'; k.id = 'yzKeyBtn'; k.className = 'yz-keybtn';
    k.setAttribute('aria-label', 'Rəhbər girişi'); k.title = 'Rəhbər girişi';
    k.innerHTML = ICO_KEYBTN;
    top.appendChild(k);
    k.onclick = () => openBox();
  }
  const box = document.createElement('div');
  box.id = 'yzOwnerBox'; box.className = 'yz-ownbox'; box.hidden = true;
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Rəhbər girişi');
  box.innerHTML = `<div class="yz-ownbox__card">
      <button type="button" class="yz-ownbox__x" data-close aria-label="Bağla" title="Bağla">${ICO_X}</button>
      <div class="yz-ownbox__ico">${ICO_KEY}</div>
      <h2 class="yz-ownbox__t">Rəhbər girişi</h2>
      <form id="yzOwnerForm" class="yz-owner" novalidate autocomplete="off">
        <label class="yz-owner__lbl" for="yzOwEmail">E-poçt</label>
        <input class="yz-owner__in" id="yzOwEmail" name="yz-o1" type="email" autocomplete="off" autocapitalize="none" spellcheck="false" inputmode="email" data-lpignore="true">
        <label class="yz-owner__lbl" for="yzOwPw">Parol</label>
        <div class="yz-owner__pw">
          <input class="yz-owner__in" id="yzOwPw" name="yz-o2" type="password" autocomplete="new-password" data-lpignore="true">
          <button type="button" class="yz-owner__eye" aria-label="Parolu göstər" title="Parolu göstər"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg></button>
        </div>
        <div class="yz-owner__err" role="alert" aria-live="assertive"></div>
        <button type="submit" class="yz-owner__btn">Daxil ol</button>
        <button type="button" class="yz-owner__link" data-forgot>Parolu unutmusunuz?</button>
      </form></div>`;
  root.appendChild(box);
  const f = $('yzOwnerForm');
  const errEl = f.querySelector('.yz-owner__err');
  const setErr = (m, okMsg) => { errEl.textContent = m || ''; errEl.classList.toggle('is-ok', !!okMsg); };
  f.querySelector('.yz-owner__eye').onclick = () => { const p = $('yzOwPw'); p.type = p.type === 'password' ? 'text' : 'password'; };
  box.querySelector('[data-close]').onclick = () => closeBox();
  box.addEventListener('mousedown', (e) => { if (e.target === box) closeBox(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !box.hidden) closeBox(); });
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const b = f.querySelector('button[type="submit"]'); b.disabled = true; setErr('');
    signingIn = true;
    try { const u = await ownerSignIn($('yzOwEmail').value, $('yzOwPw').value); closeBox(); enterAdmin(u); }
    catch (e) { setErr(ownerErr(e)); $('yzOwPw').value = ''; }
    finally { b.disabled = false; signingIn = false; }
  });
  f.querySelector('[data-forgot]').onclick = async () => {
    try { await sendReset($('yzOwEmail').value); setErr('Parolu yeniləmək üçün link e-poçtunuza göndərildi.', true); }
    catch (e) { setErr(ownerErr(e)); }
  };
}
function clearBox() {
  ['yzOwEmail', 'yzOwPw'].forEach(id => { const i = $(id); if (i) i.value = ''; });
  const p = $('yzOwPw'); if (p) p.type = 'password';
  const e = document.querySelector('#yzOwnerForm .yz-owner__err'); if (e) { e.textContent = ''; e.classList.remove('is-ok'); }
}
function openBox() {
  const box = $('yzOwnerBox'); if (!box) return;
  clearBox(); box.hidden = false;
  setTimeout(() => $('yzOwEmail')?.focus(), 60);
}
function closeBox() {
  const box = $('yzOwnerBox'); if (!box) return;
  box.hidden = true; clearBox();
}
let signingIn = false;
/* Giriş ekranı: Rəhbər rolu düyməsi gizlidir → həmişə işçi/mətbəx PIN-i; açıq qalmış Rəhbər sessiyası bağlanır */
async function syncLoginForm() {
  const root = $('yzLogin');
  if (!root || !$('yzOwnerForm')) return;
  root.classList.remove('yz-owner-mode');
  if (state.role === 'admin' || !state.role) {
    const st = root.querySelector('.yz-role--staff');
    if (st && typeof window.setRole === 'function') window.setRole('staff', st);
  }
  const hint = root.querySelector('.yz-card__hint');
  if (hint && !root.classList.contains('yz-phone-mode')) hint.textContent = 'Zəhmət olmasa, rolunuzu seçin və PIN kodunuzu daxil edin.';
  if (!$('loginScreen')?.classList.contains('active')) return;
  closeBox();
  // Hər girişdə parol tələb olunur: giriş ekranına qayıdanda (çıxış, səhifənin yenilənməsi, brauzerin bağlanması)
  // açıq qalmış Rəhbər sessiyası bağlanır.
  const open = oAuth().currentUser || await firstUser();
  if (open && !signingIn && !state.user && $('loginScreen')?.classList.contains('active')) await ownerSignOut();
}
function wrapSetRole() { return typeof window.setRole === 'function'; }

/* ═══ 4. KİLİD: 15 dəqiqə toxunulmasa · 12 saatdan sonra ═══ */
let lastWrite = 0;
function touch() {
  const t = Date.now();
  if (t - lastWrite < 15000) return;
  lastWrite = t; ls.set(K_ACT, t);
}
let locking = false;
async function lockCheck() {
  if (locking || state.user?.role !== 'admin' || !state.user?.ownerUid) return;
  const t = Date.now(), at = +ls.get(K_AT) || 0, act = +ls.get(K_ACT) || 0;
  const expired = t - at >= SESSION_MAX, idle = t - act >= IDLE_MAX;
  if (!expired && !idle) return;
  locking = true;
  const ok = await ownerVerify({
    lock: true,
    title: 'Panel kilidləndi',
    text: expired ? '12 saatlıq sessiya bitdi. Davam etmək üçün parolu yenidən yazın.' : '15 dəqiqə istifadə olunmadığı üçün panel kilidləndi.',
    okLabel: 'Kilidi aç'
  });
  locking = false;
  if (!ok) { try { window.logout?.(); } catch (e) { /* */ } }
}

/* ═══ 5. BAŞLANĞIC ═══ */
function init() {
  if (!ownerAvailable()) return;
  document.documentElement.classList.add('yz-owner-on');
  ensureCss();
  buildLoginForm();
  ls.del(K_EMAIL);   // əvvəlki versiyanın yadda saxladığı e-poçt silinir
  if (!wrapSetRole()) { const t = setInterval(() => { if (wrapSetRole()) { clearInterval(t); syncLoginForm(); } }, 150); setTimeout(() => clearInterval(t), 15000); }
  syncLoginForm();
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { if (state.user?.role === 'admin') touch(); }, { passive: true, capture: true }));
  setInterval(lockCheck, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) lockCheck(); });
  // Çıxışdan sonra giriş ekranı yenilənsin
  new MutationObserver(() => { if ($('loginScreen')?.classList.contains('active')) syncLoginForm(); })
    .observe($('loginScreen') || document.body, { attributes: true, attributeFilter: ['class'] });
}

window.__yzOwner = {
  available: ownerAvailable,
  verify: ownerVerify,
  signOut: ownerSignOut,
  email: ownerEmail,
  sendReset,
  db: ownerDbNow
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
