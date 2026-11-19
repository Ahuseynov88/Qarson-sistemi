/* ═══════════════════════════════════════════
   YUZA POS — GİRİŞ SƏHİFƏSİ ÜÇÜN KÖMƏKÇİ SKRİPT
   Giriş məntiqinə (PIN yoxlaması, doLogin, Firebase) TOXUNMUR.
   Yalnız 3 şey edir:
     1) İşıqlı/qaranlıq görünüş düymələri (yalnız giriş ekranı, localStorage-da saxlanır)
     2) Fiziki klaviaturadan PIN daxil etmə (0-9, Backspace, Esc)
     3) Yanlış PIN-də PIN xanasının titrəməsi
   Mövcud qlobal funksiyalardan (window.numPress) istifadə edir — app.js onları təyin edir.
═══════════════════════════════════════════ */

const THEME_KEY = 'yuzaLoginTheme';

function root() { return document.getElementById('yzLogin'); }

/* ── 1) Görünüş rejimi ── */
function applyLoginTheme(mode) {
  const el = root();
  if (!el) return;
  const theme = mode === 'light' ? 'light' : 'dark';
  el.setAttribute('data-yz-theme', theme);
  el.querySelectorAll('[data-yz-theme-set]').forEach(btn => {
    btn.setAttribute('aria-pressed', String(btn.getAttribute('data-yz-theme-set') === theme));
  });
}

function initTheme() {
  let saved = 'dark';
  try { saved = localStorage.getItem(THEME_KEY) || 'dark'; } catch (e) {}
  applyLoginTheme(saved);

  root()?.addEventListener('click', e => {
    const btn = e.target.closest('[data-yz-theme-set]');
    if (!btn) return;
    const mode = btn.getAttribute('data-yz-theme-set');
    applyLoginTheme(mode);
    try { localStorage.setItem(THEME_KEY, mode); } catch (err) {}
  });
}

/* ── 2) Fiziki klaviatura ── */
function loginIsActive() {
  return document.getElementById('loginScreen')?.classList.contains('active');
}

function flashKey(selectorValue) {
  const btn = root()?.querySelector('.yz-key[onclick="numPress(\'' + selectorValue + '\')"]');
  if (!btn) return;
  btn.classList.add('yz-pressed');
  setTimeout(() => btn.classList.remove('yz-pressed'), 140);
}

function initKeyboard() {
  document.addEventListener('keydown', e => {
    if (!loginIsActive()) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (typeof window.numPress !== 'function') return;

    let key = null;
    if (/^[0-9]$/.test(e.key)) key = e.key;
    else if (e.key === 'Backspace') key = 'back';
    else if (e.key === 'Escape' || e.key === 'Delete') key = 'clear';
    if (key === null) return;

    e.preventDefault();
    flashKey(key);
    window.numPress(key);
  });
}

/* ── 3) Yanlış PIN-də titrəmə ── */
function initErrorShake() {
  const err = document.getElementById('loginErr');
  const wrap = root()?.querySelector('.yz-pinwrap');
  if (!err || !wrap) return;
  new MutationObserver(() => {
    if (!err.textContent.trim()) return;
    wrap.classList.remove('yz-shake');
    void wrap.offsetWidth; // animasiyanı yenidən başlat
    wrap.classList.add('yz-shake');
  }).observe(err, { childList: true, characterData: true, subtree: true });
}

function init() {
  if (!root()) return;
  initTheme();
  initKeyboard();
  initErrorShake();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
