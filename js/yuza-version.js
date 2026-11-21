/* ═══════════════════════════════════════════
   YUZA POS — PROQRAMIN VERSİYASI VƏ AVTOMATİK YENİLƏNMƏ (Mərhələ 4.3)
   Hər yeni paketdə APP_VERSION dəyişir. Açıq qalan cihaz bu faylın
   saytdakı nüsxəsini vaxtaşırı yoxlayır; daha yeni versiya görəndə:
   • heç kim daxil olmayıbsa (giriş ekranı, davamiyyət səhifəsi) — boş
     dayananda özü yenilənir;
   • kimsə sistemdədirsə — işi kəsilmir, aşağıda xəbər çıxır; sistemdən
     çıxanda (giriş ekranına qayıdanda) özü yenilənir;
   • müştəri QR ekranı avtomatik yenilənmir (səbəti itməsin).
   Yenilənmə məlumatı silmir: yalnız səhifə yenidən yüklənir.
═══════════════════════════════════════════ */
export const APP_VERSION = '2026-11-21 03:00';

const URL_SELF = new URL(import.meta.url).pathname;     // /js/yuza-version.js
const EVERY = 3 * 60 * 1000;        // 3 dəqiqədən bir yoxla
const IDLE = 45 * 1000;             // bu qədər toxunulmayanda yenilə
const K_TRY = 'yzVerTry';           // eyni versiyaya təkrar-təkrar yenilənməsin

export const fmtVersion = (v = APP_VERSION) => {
  const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d:\d\d)$/.exec(v || '');
  return m ? `${m[3]}.${m[2]}.${m[1]} ${m[4]}` : String(v || '—');
};
window.__yzVersion = { APP_VERSION, fmtVersion };

let latest = null;       // saytda tapılan daha yeni versiya
let lastAct = Date.now();
['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(ev => window.addEventListener(ev, () => { lastAct = Date.now(); }, { passive: true, capture: true }));

async function fetchLatest() {
  try {
    const r = await fetch(URL_SELF + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return null;
    const m = /APP_VERSION\s*=\s*'([^']+)'/.exec(await r.text());
    return m ? m[1] : null;
  } catch (e) { return null; }
}

/* Hazırda harada olduğumuz */
function where() {
  const scr = document.querySelector('.screen.active')?.id;
  if (scr) return scr;
  return document.querySelector('.screen') ? 'none' : 'izle';
}
const FREE = ['loginScreen', 'izle'];                       // heç kim daxil olmayıb
const SKIP = ['customerScreen', 'referralRegisterScreen'];   // müştəri — toxunmuruq

function busy() {
  if ([...document.querySelectorAll('.modal-bg.open, [aria-modal="true"]')].some(el => el.getClientRects().length)) return true;   // görünən pəncərə
  const a = document.activeElement;
  if (a && a.matches?.('input:not([type=checkbox]):not([type=radio]), textarea, select') && String(a.value || '').length) return true;
  if ([...document.querySelectorAll('video')].some(v => !v.paused)) return true;   // kamera (QR, selfi) açıqdır
  return false;
}

function reloadNow() {
  try { sessionStorage.setItem(K_TRY, latest); } catch (e) { /* */ }
  location.reload();
}

function tryApply() {
  if (!latest) return;
  const w = where();
  if (SKIP.includes(w)) { hideBar(); return; }
  if (FREE.includes(w)) {
    hideBar();
    if (!busy() && (document.hidden || Date.now() - lastAct >= IDLE)) reloadNow();
    return;
  }
  showBar(w === 'kitchenScreen');
}

/* ── Xəbər zolağı (daxil olmuş istifadəçi üçün) ── */
let bar = null, closedFor = null;
function showBar(kitchen) {
  if (closedFor === latest) return;
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'yzVerBar';
    bar.setAttribute('role', 'status');
    bar.style.cssText = 'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:9000;display:flex;align-items:center;gap:10px;max-width:calc(100vw - 24px);padding:10px 12px 10px 16px;border-radius:14px;background:var(--card,#1b1b1f);color:var(--text,#fff);border:1px solid var(--gold,#d4a548);box-shadow:0 8px 28px rgba(0,0,0,.35);font-size:13px;line-height:1.35;';
    bar.addEventListener('click', (e) => {
      if (e.target.closest('[data-v-now]')) reloadNow();
      if (e.target.closest('[data-v-x]')) { closedFor = latest; hideBar(); }
    });
    document.body.appendChild(bar);
  }
  bar.innerHTML = `<span>Proqramın yeni versiyası var (${fmtVersion(latest)}). ${kitchen ? 'Yenilədikdən sonra mətbəx PIN-ini yenidən daxil edin.' : 'Sistemdən çıxanda özü yenilənəcək.'}</span>
    <button type="button" data-v-now class="btn btn-green" style="padding:7px 12px;white-space:nowrap;" title="${kitchen ? '' : 'Səhifə yenilənir, yenidən daxil olmaq lazım olacaq'}">İndi yenilə</button>
    <button type="button" data-v-x aria-label="Bağla" title="Bağla" style="background:none;border:0;color:inherit;font-size:18px;cursor:pointer;padding:2px 6px;">✕</button>`;
  bar.hidden = false;
}
function hideBar() { if (bar) bar.hidden = true; }

async function check() {
  const v = await fetchLatest();
  if (!v || v <= APP_VERSION) { latest = null; hideBar(); return; }
  // Artıq bu versiya üçün yeniləmişik, amma köhnə fayl gəlib (keş) — təkrar yeniləmə dövrəsinə düşməyək
  let tried = null; try { tried = sessionStorage.getItem(K_TRY); } catch (e) { /* */ }
  if (tried && tried >= v) { latest = null; return; }
  latest = v;
  tryApply();
}

/* Avtomatik testlər və diaqnostika üçün */
window.__yzVersion.check = check;
window.__yzVersion._t = { tryApply, idle: () => { lastAct = 0; }, latest: () => latest };

function init() {
  setTimeout(check, 20 * 1000);
  setInterval(check, EVERY);
  setInterval(tryApply, 15 * 1000);                    // boş qalma vaxtı dolanda
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); else tryApply(); });
  window.addEventListener('online', check);
  // Sistemdən çıxış: daxil olmuş ekrandan giriş ekranına keçid — gözləmədən yenilə
  let prev = where();
  document.addEventListener('yz:screen', (e) => {
    const was = prev; prev = e.detail;
    if (!latest || !FREE.includes(e.detail) || FREE.includes(was) || SKIP.includes(was) || was === 'none') return;
    setTimeout(() => { if (!busy()) reloadNow(); else tryApply(); }, 300);
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
