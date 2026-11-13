/* ═══════════════════════════════════════════
   YUZA POS — SƏHİFƏ İÇİ QR SKANER
   QR-ı telefonun kamerası yox, səhifənin özü oxuyur: link göstərilmir,
   heç nəyə toxunmadan nəticə dərhal səhifəyə qayıdır.

   İşlətmə:  const text = await scanQr({ title, hint, accept });
             accept(text) → true (qəbul) və ya xəta mətni (oxumağa davam edir)
             nəticə: QR-ın mətni və ya null (ləğv edildi / kamera açılmadı)

   Oxuma üsulu:
   • Android Chrome: brauzerin öz BarcodeDetector-u (sürətli)
   • iPhone Safari və digərləri: jsQR kitabxanası (lazım olanda yüklənir)

   Gələcək tətbiq (Capacitor / APK / App Store): yalnız bu faylın içini
   telefonun öz skaner plaginə dəyişmək kifayətdir — scanQr() eyni qalır.
═══════════════════════════════════════════ */

const JSQR_URL = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
let jsqrP = null;
function loadJsQR() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  if (!jsqrP) jsqrP = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = JSQR_URL; s.async = true;
    s.onload = () => (window.jsQR ? res(window.jsQR) : rej(new Error('jsQR')));
    s.onerror = () => { jsqrP = null; rej(new Error('Skaner yüklənmədi. İnterneti yoxlayın.')); };
    document.head.appendChild(s);
  });
  return jsqrP;
}

/* Kameradan bir kadr götürüb QR axtarır → mətn və ya null */
async function makeReader() {
  if ('BarcodeDetector' in window) {
    try {
      const f = await window.BarcodeDetector.getSupportedFormats();
      if (f.includes('qr_code')) {
        const d = new window.BarcodeDetector({ formats: ['qr_code'] });
        return async (video) => { const r = await d.detect(video); return r[0]?.rawValue || null; };
      }
    } catch (e) { /* jsQR-a keçir */ }
  }
  const jsQR = await loadJsQR();
  const c = document.createElement('canvas');
  const g = c.getContext('2d', { willReadFrequently: true });
  return async (video) => {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    const k = Math.min(1, 720 / Math.max(vw, vh));
    c.width = Math.round(vw * k); c.height = Math.round(vh * k);
    g.drawImage(video, 0, 0, c.width, c.height);
    const img = g.getImageData(0, 0, c.width, c.height);
    const r = jsQR(img.data, c.width, c.height, { inversionAttempts: 'dontInvert' });
    return r?.data || null;
  };
}

function injectCss() {
  if (document.getElementById('yzQrCss')) return;
  const st = document.createElement('style');
  st.id = 'yzQrCss';
  st.textContent = `
.yzqr{position:fixed;inset:0;z-index:9999;background:#06080b;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px 18px calc(24px + env(safe-area-inset-bottom));color:#fff;font-family:Inter,system-ui,sans-serif;text-align:center}
.yzqr h2{margin:0;font:700 20px Poppins,Inter,sans-serif}
.yzqr p{margin:0;font-size:14px;color:#aeb4bd;max-width:340px}
.yzqr__box{position:relative;width:min(82vw,340px);aspect-ratio:1;border-radius:22px;overflow:hidden;background:#000}
.yzqr__box video{width:100%;height:100%;object-fit:cover;display:block}
.yzqr__frame{position:absolute;inset:14%;border:3px solid #d4a64a;border-radius:16px;box-shadow:0 0 0 999px rgba(0,0,0,.35)}
.yzqr__line{position:absolute;left:16%;right:16%;top:16%;height:2px;background:#d4a64a;opacity:.85;animation:yzqrMove 1.8s ease-in-out infinite alternate}
@keyframes yzqrMove{to{top:84%}}
.yzqr__err{color:#ff8a80!important;min-height:20px;font-weight:600}
.yzqr__ok .yzqr__frame{border-color:#3ecf8e}
.yzqr .iz-btn{max-width:340px}`;
  document.head.appendChild(st);
}

export function scanQr({ title = 'QR kodu oxudun', hint = 'Kameranı QR-a tutun', accept = () => true } = {}) {
  return new Promise(async (resolve) => {
    injectCss();
    const wrap = document.createElement('div');
    wrap.className = 'yzqr';
    wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true'); wrap.setAttribute('aria-label', title);
    const h2 = document.createElement('h2'); h2.textContent = title;
    const box = document.createElement('div'); box.className = 'yzqr__box';
    box.innerHTML = '<video playsinline autoplay muted></video><div class="yzqr__frame"></div><div class="yzqr__line"></div>';
    const p = document.createElement('p'); p.textContent = hint;
    const err = document.createElement('p'); err.className = 'yzqr__err'; err.setAttribute('role', 'alert');
    const x = document.createElement('button'); x.type = 'button'; x.className = 'iz-btn iz-btn--ghost'; x.textContent = 'Ləğv et';
    wrap.append(h2, box, p, err, x);
    document.body.appendChild(wrap);
    const video = box.querySelector('video');

    let stream = null, timer = null, done = false;
    const finish = (val) => {
      if (done) return; done = true;
      clearTimeout(timer);
      if (stream) stream.getTracks().forEach(t => t.stop());
      document.removeEventListener('visibilitychange', onHide);
      wrap.remove();
      resolve(val);
    };
    const onHide = () => { if (document.visibilityState === 'hidden') finish(null); };
    document.addEventListener('visibilitychange', onHide);
    x.onclick = () => finish(null);

    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
    } catch (e) {
      const n = e?.name || '';
      err.textContent = n === 'NotAllowedError' || n === 'SecurityError'
        ? 'Kameraya icazə verilmədi. Brauzerin ayarlarında bu sayt üçün kameranı açın və yenidən cəhd edin.'
        : 'Kamera açılmadı. Başqa tətbiq kameranı istifadə edirsə, onu bağlayın.';
      box.style.display = 'none'; p.style.display = 'none';
      x.textContent = 'Bağla';
      return;
    }
    if (done) { stream.getTracks().forEach(t => t.stop()); return; }
    video.srcObject = stream;
    try { await video.play(); } catch (e) { /* autoplay muted ilə işləyir */ }

    let read;
    try { read = await makeReader(); } catch (e) { err.textContent = e.message; return; }

    let lastBad = '';
    const loop = async () => {
      if (done) return;
      let text = null;
      try { text = await read(video); } catch (e) { text = null; }
      if (done) return;
      if (text) {
        const r = accept(text);
        if (r === true) {
          wrap.classList.add('yzqr__ok');
          if (navigator.vibrate) navigator.vibrate(50);
          setTimeout(() => finish(text), 150);
          return;
        }
        if (text !== lastBad) { lastBad = text; err.textContent = r || 'Bu QR uyğun deyil.'; }
      }
      timer = setTimeout(loop, 150);
    };
    loop();
  });
}
