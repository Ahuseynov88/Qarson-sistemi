/* ═══════════════════════════════════════════
   YUZA POS — CİHAZ GÖZƏTÇİSİ (Mərhələ 1a)
   Baza ilə işləməzdən ƏVVƏL cihazın kim olduğunu müəyyən edir:
   • Restoran cihazı (kassa, qarson telefonu, mətbəx) — bir dəfə restoran
     e-poçtu və parolu ilə daxil olur, sonra yadda saxlanılır. PIN ekranı
     əvvəlki kimi işləyir.
   • QR müştəri (?table=... və ya ?ref=...) — avtomatik "qonaq" (adsız) girişi.
   • İşçinin davamiyyət telefonu (izle.html) — ayrıca "izle" girişi ilə adsız
     daxil olur. Bu giriş restoran girişindən AYRIDIR: işçi eyni telefonda
     qarson rejimində işləsə də, biri digərini silmir. Davamiyyət ekranı
     (izle.html?ekran=1) isə restoran cihazıdır — restoran girişi tələb edir.
   firebase-service.js bu funksiyanı gözləyir, ona görə heç bir modul
   giriş olmadan bazaya müraciət etmir.
   Config-də apiKey yoxdursa (məs. hələ yenilənməmiş əsas sayt) — heç nə etmir.
═══════════════════════════════════════════ */

const GUEST_MODE = (() => {
  const p = new URLSearchParams(location.search);
  return !!(p.get('table') || p.get('ref'));
})();
const ATT_PHONE = /\/izle(\.html)?\/?$/.test(location.pathname) && new URLSearchParams(location.search).get('ekran') !== '1';
export const isGuestMode = () => GUEST_MODE;

const ERR = {
  'auth/invalid-credential': 'E-poçt və ya parol səhvdir.',
  'auth/invalid-login-credentials': 'E-poçt və ya parol səhvdir.',
  'auth/wrong-password': 'E-poçt və ya parol səhvdir.',
  'auth/user-not-found': 'E-poçt və ya parol səhvdir.',
  'auth/invalid-email': 'E-poçt ünvanı düzgün yazılmayıb.',
  'auth/missing-password': 'Parolu yazın.',
  'auth/too-many-requests': 'Çox sayda səhv cəhd. Bir neçə dəqiqə gözləyin.',
  'auth/network-request-failed': 'İnternet bağlantısı yoxdur.',
  'auth/user-disabled': 'Bu hesab dayandırılıb.'
};
const msg = (e) => ERR[e?.code] || 'Giriş alınmadı. Yenidən cəhd edin.';
const isStaffUser = (u) => !!u && !u.isAnonymous;

function firstState(auth) {
  return new Promise(res => { const off = auth.onAuthStateChanged(u => { off(); res(u); }); });
}

/* ── Restoran girişi pəncərəsi ── */
function showGate(auth) {
  return new Promise(resolve => {
    const box = document.createElement('div');
    box.id = 'yzGate';
    box.innerHTML = `
      <style>
        #yzGate{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:20px;
          background:radial-gradient(circle at 50% 0%,#3a2a0e 0%,#14100a 55%,#0b0906 100%);font-family:Inter,system-ui,sans-serif;color:#f4eee2}
        #yzGate .g-card{width:100%;max-width:380px;background:rgba(255,255,255,.05);border:1px solid rgba(232,176,75,.35);border-radius:20px;padding:28px 24px;box-shadow:0 20px 60px rgba(0,0,0,.5)}
        #yzGate .g-brand{text-align:center;font:700 30px/1 Poppins,Inter,sans-serif;letter-spacing:.02em}
        #yzGate .g-brand b{color:#e8b04b}
        #yzGate h1{font-size:18px;text-align:center;margin:18px 0 6px;font-weight:700}
        #yzGate p.g-hint{font-size:13px;color:#c9bfae;text-align:center;margin:0 0 18px;line-height:1.5}
        #yzGate label{display:block;font-size:12px;font-weight:700;color:#c9bfae;margin:12px 0 6px}
        #yzGate input{width:100%;box-sizing:border-box;padding:13px 14px;border-radius:12px;border:1px solid rgba(232,176,75,.35);background:rgba(0,0,0,.35);color:#fff;font-size:16px;outline:none}
        #yzGate input:focus{border-color:#e8b04b}
        #yzGate .g-pw{position:relative}
        #yzGate .g-eye{position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:#c9bfae;font-size:13px;cursor:pointer;padding:6px}
        #yzGate .g-btn{width:100%;margin-top:20px;padding:14px;border:none;border-radius:12px;background:linear-gradient(180deg,#f6cf7c,#e1a43e);color:#1a1205;font-weight:800;font-size:15px;cursor:pointer}
        #yzGate .g-btn[disabled]{opacity:.6;cursor:wait}
        #yzGate .g-link{display:block;margin:14px auto 0;background:none;border:none;color:#e8b04b;font-size:13px;cursor:pointer;text-decoration:underline}
        #yzGate .g-err{min-height:18px;margin-top:12px;font-size:13px;color:#ff8a80;text-align:center}
        #yzGate .g-ok{color:#8fd19e}
        #yzGate .g-lock{text-align:center;font-size:12px;color:#8f8676;margin-top:16px}
      </style>
      <form class="g-card" autocomplete="on" novalidate>
        <div class="g-brand">YuZa<b>POS</b></div>
        <h1>Restoran girişi</h1>
        <p class="g-hint">Bu cihaz restoranın hesabı ilə <b>bir dəfə</b> daxil olur və yadda saxlanılır. Sonra işçilər PIN ilə girir.</p>
        <label for="yzGateEmail">E-poçt</label>
        <input id="yzGateEmail" type="email" inputmode="email" autocomplete="username" required>
        <label for="yzGatePw">Parol</label>
        <div class="g-pw"><input id="yzGatePw" type="password" autocomplete="current-password" required>
          <button type="button" class="g-eye" aria-label="Parolu göstər">Göstər</button></div>
        <button type="submit" class="g-btn">Daxil ol</button>
        <button type="button" class="g-link" data-reset>Parolu unutmusunuz?</button>
        <div class="g-err" role="alert" aria-live="assertive"></div>
        <div class="g-lock">🔒 Qorunan bağlantı</div>
      </form>`;
    document.body.appendChild(box);
    const $ = (s) => box.querySelector(s);
    const err = $('.g-err');
    const setErr = (t, good) => { err.textContent = t || ''; err.classList.toggle('g-ok', !!good); };
    $('.g-eye').addEventListener('click', () => {
      const i = $('#yzGatePw'); const show = i.type === 'password';
      i.type = show ? 'text' : 'password'; $('.g-eye').textContent = show ? 'Gizlət' : 'Göstər';
    });
    $('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = $('#yzGateEmail').value.trim(), pw = $('#yzGatePw').value;
      if (!email || !pw) { setErr('E-poçtu və parolu yazın.'); return; }
      const b = $('.g-btn'); b.disabled = true; b.textContent = 'Yoxlanılır…'; setErr('');
      try {
        const cred = await auth.signInWithEmailAndPassword(email, pw);
        box.remove();
        resolve(cred.user);
      } catch (ex) { setErr(msg(ex)); b.disabled = false; b.textContent = 'Daxil ol'; }
    });
    $('[data-reset]').addEventListener('click', async () => {
      const email = $('#yzGateEmail').value.trim();
      if (!email) { setErr('Əvvəlcə e-poçt ünvanını yazın.'); return; }
      try { await auth.sendPasswordResetEmail(email); setErr('Parolu yeniləmək üçün link e-poçtunuza göndərildi.', true); }
      catch (ex) { setErr(msg(ex)); }
    });
    setTimeout(() => $('#yzGateEmail').focus(), 50);
  });
}

/* ── Rəhbər panelində "Bu cihaz" kartı (Ümumi ayarlar bölməsində) ── */
function deviceCard(auth) {
  const put = () => {
    const sec = document.getElementById('sec-settings');
    const u = auth.currentUser;
    if (document.getElementById('yzDeviceCard')) return true;
    if (!sec || !isStaffUser(u)) return false;
    const card = document.createElement('div');
    card.id = 'yzDeviceCard'; card.className = 'table-card'; card.style.cssText = 'margin-bottom:16px;max-width:500px';
    card.innerHTML = `<h3 style="margin-bottom:8px;">🔒 Bu cihaz</h3>
      <p style="font-size:13px;color:var(--text2);margin-bottom:12px;">Restoran hesabı: <b></b></p>
      <button type="button" class="btn btn-ghost" style="width:100%;padding:12px;">Bu cihazı hesabdan ayır</button>
      <p style="font-size:12px;color:var(--text3);margin-top:8px;">Cihaz satılanda, itəndə və ya başqasına veriləndə istifadə edin. Yenidən işlətmək üçün restoran parolu lazım olacaq.</p>`;
    card.querySelector('b').textContent = u.email || '—';
    card.querySelector('button').addEventListener('click', async () => {
      if (!confirm('Bu cihaz restoran hesabından ayrılsın? Yenidən girmək üçün e-poçt və parol lazım olacaq.')) return;
      await auth.signOut();
      location.reload();
    });
    sec.prepend(card);
    return true;
  };
  if (put()) return;
  const mo = new MutationObserver(() => { if (put()) mo.disconnect(); });
  mo.observe(document.body, { childList: true, subtree: true });
}

/* ── Əsas funksiya: firebase-service.js bunu gözləyir ── */
export async function guardDevice(config) {
  if (!config?.apiKey || typeof firebase.auth !== 'function') return null;   // giriş qatı aktiv deyil
  if (ATT_PHONE) {
    // İşçi telefonu: ayrıca tətbiq nüsxəsi, öz adsız girişi (telefon → işçi bağlantısı bu girişə bağlıdır)
    const app = firebase.apps.find(a => a.name === 'yzIzle') || firebase.initializeApp(config, 'yzIzle');
    const a2 = app.auth();
    a2.languageCode = 'az';
    let u2 = await firstState(a2);
    if (!u2) {
      try { u2 = (await a2.signInAnonymously()).user; }
      catch (e) { document.body.insertAdjacentHTML('beforeend', '<p style="color:#fff;padding:24px;text-align:center">İnternet bağlantısı yoxdur. Səhifəni yeniləyin.</p>'); throw e; }
    }
    window.__yzAttApp = app;
    return u2;
  }
  const auth = firebase.auth();
  auth.languageCode = 'az';
  let user = await firstState(auth);

  if (GUEST_MODE) {
    if (!user) user = (await auth.signInAnonymously()).user;
    return user;
  }
  if (!isStaffUser(user)) {
    if (user) await auth.signOut();            // köhnə qonaq girişi restoran cihazı deyil
    user = await showGate(auth);
  }
  /* Hesab başqa cihazdan ayrılarsa və ya parol dəyişərsə — yenidən giriş */
  auth.onAuthStateChanged(u => { if (!u && !GUEST_MODE) location.reload(); });
  deviceCard(auth);
  return user;
}
