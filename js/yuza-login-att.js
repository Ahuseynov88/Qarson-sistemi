/* ═══════════════════════════════════════════
   YUZA POS — PIN EKRANI + DAVAMİYYƏT QR (12.11.2026 · 13.11: işçi telefonunda "Davamiyyət" keçidi)
   Ortaq cihazda (məs. kassa kompüteri) PIN ekranının yanında davamiyyət QR-ı:
   • Geniş ekran: ekran ikiyə bölünür — solda QR + "İndi işdə", sağda PIN.
   • Dar ekran (telefon, şaquli planşet): yuxarıda "Davamiyyət" düyməsi —
     basanda QR paneli açılır.
   • Hər cihazın öz ayarıdır: Ayarlar → Giriş və təhlükəsizlik → Bu cihaz →
     "Giriş ekranında davamiyyət QR-ı". Şəxsi telefonlarda bağlı qalır.
   • QR yalnız PIN ekranı açıq və görünən olanda dəyişir (bazaya boş yazı getmir).
     Kod məntiqi izle.html?ekran=1 ilə eynidir: hər 15 san yeni kod, baza 2 dəq qəbul edir.
═══════════════════════════════════════════ */
import { A, adb, TS, withDefaults, now, fmtDT, fmtTime, fmtDate, phaseOf, shiftStart, newCode } from './yuza-att-core.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KEY = 'yzLoginQr';
const ROTATE = 15000;
const IZLE_URL = location.origin + location.pathname.replace(/[^/]*$/, '') + 'izle.html';
const wideMq = window.matchMedia('(min-width:960px)');
const enabled = () => { if (window.__yzPhone) return false; try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } };
const loginActive = () => !!$('loginScreen')?.classList.contains('active');

const QR_ICO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z"/></svg>';
const X_ICO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';

let S = withDefaults(null), status = {}, staff = [];
let qrTimer = null, clockTimer = null, running = false, sheetOpen = false, lastStatic = '';

function build() {
  const root = $('yzLogin'), stage = root?.querySelector('.yz-stage');
  if (!stage) return false;
  if ($('yzAttP')) return true;
  const p = document.createElement('aside');
  p.id = 'yzAttP'; p.className = 'yz-attp';
  p.setAttribute('aria-label', 'Davamiyyət');
  p.innerHTML = `
    <header class="yz-attp__head"><span class="yz-attp__ic">${QR_ICO}</span>
      <div><b>Davamiyyət</b><small>İşə gəliş və çıxış</small></div>
      <button type="button" class="yz-attp__x" data-close aria-label="Bağla" title="Bağla">${X_ICO}</button></header>
    <div class="yz-attp__clock"><b data-clock></b><span data-date></span></div>
    <div class="yz-attp__qrwrap"><div class="yz-attp__qr" id="yzAttQr" aria-label="Davamiyyət QR kodu"></div>
      <div class="yz-attp__bar" data-bar-wrap><i data-bar></i></div></div>
    <p class="yz-attp__hint">Telefonunuzun kamerası ilə QR-ı oxudun və <b>“İşə gəldim”</b> basın.</p>
    <div class="yz-attp__who"><h4>İndi işdə <span data-cnt>0</span></h4><ul data-list></ul></div>`;
  stage.insertBefore(p, stage.querySelector('.yz-card'));
  const btn = document.createElement('button');
  btn.type = 'button'; btn.id = 'yzAttBtn'; btn.className = 'yz-attbtn';
  btn.setAttribute('aria-label', 'Davamiyyət QR'); btn.title = 'Davamiyyət QR';
  btn.innerHTML = `${QR_ICO}<span>Davamiyyət</span>`;
  root.querySelector('.yz-topbar')?.prepend(btn);
  btn.onclick = () => { sheetOpen = true; sync(); };
  p.querySelector('[data-close]').onclick = () => { sheetOpen = false; sync(); };
  return true;
}

/* Hansı vəziyyətdə nə görünür və QR dəyişirmi */
function sync() {
  const root = $('yzLogin'); if (!root || !build()) return;
  const on = enabled();
  root.classList.toggle('yz-att-on', on);
  if (!on || !loginActive()) sheetOpen = false;
  root.classList.toggle('yz-att-sheet', on && !wideMq.matches && sheetOpen);
  const shouldRun = on && loginActive() && !document.hidden && (wideMq.matches || sheetOpen);
  if (shouldRun && !running) startRun();
  else if (!shouldRun && running) stopRun();
}

/* Dinləyicilər öz funksiyası ilə qoşulur və YALNIZ özləri söndürülür.
   Diqqət: ref.off() (funksiyasız) həmin yoldakı BÜTÜN dinləyiciləri silir — məs. app.js-in
   işçi siyahısı dinləyicisini də. Ona görə həmişə off('value', fn) işlədilir. */
const subs = [];
function sub(ref, fn) { ref.on('value', fn, () => {}); subs.push(() => ref.off('value', fn)); }
function startRun() {
  running = true;
  if (!subs.length) {
    sub(A('settings'), s => { S = withDefaults(s.val()); if (running) { restartQr(); renderWho(); } });
    sub(A('status'), s => { status = s.val() || {}; renderWho(); });
    // PIN ekranında işçi siyahısı hələ yüklənməyib (state.staff girişdən sonra dolur) — adları özümüz oxuyuruq
    sub(adb.ref('staff'), s => { const o = s.val() || {}; staff = Object.keys(o).map(id => ({ id, name: o[id]?.name || '', position: o[id]?.position || '' })).filter(x => x.name); renderWho(); });
  }
  tickClock(); clockTimer = setInterval(() => { tickClock(); renderWho(); }, 20000);
  restartQr();
}
function stopRun() {
  running = false;
  clearInterval(qrTimer); qrTimer = null;
  clearInterval(clockTimer); clockTimer = null;
  subs.splice(0).forEach(off => off());
  lastStatic = '';
}
function restartQr() {
  clearInterval(qrTimer); qrTimer = null;
  const dyn = S.qrMode !== 'static';
  const wrap = document.querySelector('#yzAttP [data-bar-wrap]');
  if (wrap) wrap.hidden = !dyn;
  if (dyn) { lastStatic = ''; rotate(); qrTimer = setInterval(rotate, ROTATE); }
  else if (lastStatic !== IZLE_URL) { lastStatic = IZLE_URL; draw(IZLE_URL); }
}
async function rotate() {
  const code = newCode(12);
  try {
    await A('qrs/' + code).set(TS);
    // 5 dəqiqədən köhnə kodlar silinir
    const snap = await A('qrs').once('value');
    const up = {}; const old = now() - 5 * 60000;
    snap.forEach(c => { if ((c.val() || 0) < old) up[c.key] = null; });
    if (Object.keys(up).length) A('qrs').update(up).catch(() => {});
  } catch (e) { return; /* internet yoxdursa köhnə QR qalır */ }
  if (!running) return;
  draw(IZLE_URL + '?k=' + code);
  const bar = document.querySelector('#yzAttP [data-bar]');
  if (bar) { bar.style.transition = 'none'; bar.style.width = '100%'; void bar.offsetWidth; bar.style.transition = `width ${ROTATE}ms linear`; bar.style.width = '0%'; }
}
function draw(text) {
  const box = $('yzAttQr'); if (!box || typeof QRCode === 'undefined') return;
  box.innerHTML = '';
  // eslint-disable-next-line no-undef
  new QRCode(box, { text, width: 220, height: 220, colorDark: '#0b0d10', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
}
function tickClock() {
  const p = $('yzAttP'); if (!p) return;
  p.querySelector('[data-clock]').textContent = fmtTime(now());
  p.querySelector('[data-date]').textContent = fmtDate(now());
}
function renderWho() {
  const p = $('yzAttP'); if (!p || !running) return;
  const ins = staff.filter(s => phaseOf(status[s.id], S) === 'in')
    .sort((a, b) => shiftStart(status[a.id]) - shiftStart(status[b.id]));
  const brk = staff.filter(s => phaseOf(status[s.id], S) === 'break');
  p.querySelector('[data-cnt]').textContent = ins.length;
  p.querySelector('[data-list]').innerHTML = (ins.map(s => `<li><span class="yz-attp__av">${esc(String(s.name).trim().slice(0, 1).toUpperCase())}</span>
      <div><b>${esc(s.name)}</b><small>${esc(s.position || '')}</small></div><em>${fmtDT(shiftStart(status[s.id]))}</em></li>`).join('')
    + brk.map(s => `<li class="is-brk"><span class="yz-attp__av">${esc(String(s.name).trim().slice(0, 1).toUpperCase())}</span>
      <div><b>${esc(s.name)}</b><small>Müvəqqəti çıxışda</small></div><em>${fmtDT(status[s.id]?.since)}</em></li>`).join(''))
    || '<li class="yz-attp__empty">Hələ heç kim qeyd etməyib.</li>';
}

/* İşçinin öz telefonu: yalnız ofisiant/işçi girişi, rol seçimi gizlənir, salamlama göstərilir */
function phoneMode() {
  const ph = window.__yzPhone; const root = $('yzLogin');
  if (!ph || !root) return;
  root.classList.add('yz-phone-mode');
  const card = root.querySelector('.yz-card');
  if (card && !$('yzPhoneHi')) {
    const hi = document.createElement('p');
    hi.id = 'yzPhoneHi'; hi.className = 'yz-phone-hi';
    hi.innerHTML = `Salam, <b>${esc(ph.firstname || ph.name)}</b>!<br><span>PIN kodunuzu daxil edin</span>`;
    card.insertBefore(hi, card.querySelector('.yz-pad'));
  }
  // Davamiyyət səhifəsinə keçid: müvəqqəti çıxış / işdən çıxış üçün işçi əvvəlcə sistemdən çıxır, sonra buradan keçir
  if (card && !$('yzPhoneAtt')) {
    const a = document.createElement('a');
    a.id = 'yzPhoneAtt'; a.href = IZLE_URL;
    a.setAttribute('style', 'display:flex;align-items:center;justify-content:center;gap:8px;width:100%;box-sizing:border-box;margin-top:14px;padding:13px 14px;border-radius:12px;border:1px solid rgba(232,176,75,.55);background:rgba(232,176,75,.12);color:#e8b04b;font-weight:700;font-size:15px;line-height:1.2;text-decoration:none;cursor:pointer');
    a.innerHTML = `${QR_ICO.replace('<svg ', '<svg width="20" height="20" style="flex-shrink:0" ')}<span>Davamiyyət (müvəqqəti çıxış / işdən çıxış)</span>`;
    card.insertBefore(a, card.querySelector('.yz-secure'));
  }
  const pick = () => {
    const btn = root.querySelector('.yz-role--staff');
    if (typeof window.setRole !== 'function' || !btn) return false;
    if (!btn.classList.contains('active')) window.setRole('staff', btn);
    return true;
  };
  if (!pick()) { const t = setInterval(() => { if (pick()) clearInterval(t); }, 150); setTimeout(() => clearInterval(t), 15000); }
  // Çıxışdan sonra da işçi rolu seçili qalsın
  new MutationObserver(() => { if (loginActive()) pick(); }).observe($('loginScreen') || document.body, { attributes: true, attributeFilter: ['class'] });
}

function init() {
  phoneMode();
  if (!build()) { const t = setInterval(() => { if (build()) { clearInterval(t); init(); } }, 200); setTimeout(() => clearInterval(t), 15000); return; }
  const ls = $('loginScreen');
  if (ls) new MutationObserver(sync).observe(ls, { attributes: true, attributeFilter: ['class'] });
  wideMq.addEventListener?.('change', sync);
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('yz-loginqr', sync);
  window.addEventListener('storage', (e) => { if (e.key === KEY) sync(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheetOpen) { sheetOpen = false; sync(); } });
  sync();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
