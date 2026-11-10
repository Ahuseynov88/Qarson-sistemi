/* ═══════════════════════════════════════════
   YUZA POS — ADMIN PANELİ: GERİ DÜYMƏSİ + BRAUZER/TELEFON "GERİ"
   Mövcud admin.js-ə TOXUNMUR. Yalnız admin ekranı aktiv olanda işləyir.

   Nə edir:
   1) Admin topbar-da "← Geri" düyməsi göstərir (bölməyə, detala və ya pəncərəyə girəndə).
   2) Kompüterdə brauzerin "Geri" düyməsi və telefonun geri jesti/düyməsi:
        açıq pəncərə (modal) → bağlanır
        açıq mal/işçi/masa profili → bağlanır
        açıq bölmə → əvvəlki bölməyə (telefonda admin ana menyusuna) qayıdır
      Admin ana səhifəsində geri basmaq tətbiqdən çıxarmır.
   3) Qarson/mətbəx ekranlarına təsir etmir (kiosk qorunması olduğu kimi qalır).
═══════════════════════════════════════════ */

const $ = (id) => document.getElementById(id);
const isDesktop = () => window.matchMedia('(min-width:900px)').matches;

let armed = false;      // admin ekranı aktivdir və tarixçə qurulub
let applying = false;   // popstate nəticəsində görünüşü özümüz dəyişirik
let depth = 0;          // bizim əlavə etdiyimiz tarixçə qeydlərinin sayı
let lastKey = '';
let baseView = null;

function adminActive() {
  return !!$('adminScreen')?.classList.contains('active');
}

function currentView() {
  const act = document.querySelector('.admin-section.active');
  let sec = act ? act.id.replace(/^sec-/, '') : null;
  if (!isDesktop() && !$('adminBody')?.classList.contains('admin-section-open')) sec = null;
  return {
    sec,
    detail: !!document.querySelector('.tile-detail-overlay.open'),
    modal: !!document.querySelector('.modal-bg.open')
  };
}
const keyOf = (v) => `${v.sec}|${v.detail ? 1 : 0}|${v.modal ? 1 : 0}`;

/* ── Görünüşü tətbiq et (popstate zamanı) ── */
function closeTopModal() {
  const open = [...document.querySelectorAll('.modal-bg.open')];
  const modal = open[open.length - 1];
  if (!modal) return;
  const ctrl = modal.querySelector('[data-cancel], [data-close-audit], [data-close]')
    || modal.querySelector('button[onclick*="close" i]');
  if (ctrl) ctrl.click();
  else modal.classList.remove('open');
}

function closeDetail() {
  const overlay = document.querySelector('.tile-detail-overlay.open');
  if (!overlay) return;
  const back = overlay.querySelector('.tile-detail-back');
  if (back) back.click();
  else overlay.classList.remove('open');
}

function applyView(v) {
  applying = true;
  try {
    if (!v.modal) closeTopModal();
    if (!v.detail) closeDetail();
    const cur = currentView();
    if (v.sec !== cur.sec) {
      if (v.sec) {
        const btn = document.querySelector(`.admin-tab[data-section="${v.sec}"]`);
        if (typeof window.adminTab === 'function') window.adminTab(v.sec, btn);
      } else if (typeof window.adminGoBack === 'function') {
        window.adminGoBack();
      }
    }
  } finally {
    setTimeout(() => {
      applying = false;
      lastKey = keyOf(currentView());
      updateBackBtn();
    }, 80);
  }
}

/* ── "← Geri" düyməsi ── */
function ensureBackBtn() {
  if ($('yzAdminBack')) return $('yzAdminBack');
  const host = $('adminTopbar')?.firstElementChild;
  if (!host) return null;
  const btn = document.createElement('button');
  btn.id = 'yzAdminBack';
  btn.type = 'button';
  btn.className = 'yz-back-btn';
  btn.setAttribute('aria-label', 'Geri');
  btn.textContent = '← Geri';
  btn.style.display = 'none';
  const ham = host.querySelector('.ap-hamburger');
  if (ham && ham.nextSibling) host.insertBefore(btn, ham.nextSibling);
  else host.appendChild(btn);
  return btn;
}

function updateBackBtn() {
  const btn = ensureBackBtn();
  if (!btn) return;
  btn.style.display = (armed && depth > 0) ? '' : 'none';
}

/* ── Görünüş dəyişikliyini izlə → tarixçəyə yaz ── */
function onChange() {
  if (applying) return;
  const act = adminActive();

  if (!act) {
    if (armed) { armed = false; depth = 0; lastKey = ''; }
    updateBackBtn();
    return;
  }

  if (!armed) {
    armed = true;
    depth = 0;
    baseView = currentView();
    lastKey = keyOf(baseView);
    history.pushState({ yz: 1, n: 0, v: baseView }, '', location.href);
    updateBackBtn();
    return;
  }

  const v = currentView();
  const k = keyOf(v);
  if (k !== lastKey) {
    lastKey = k;
    depth += 1;
    history.pushState({ yz: 1, n: depth, v }, '', location.href);
  }
  updateBackBtn();
}

window.addEventListener('popstate', (e) => {
  if (!armed || !adminActive()) return;
  const s = e.state;
  if (!s || !s.yz) {
    // Admin ana səhifəsindən də geri getdilər — tətbiqdə qal
    depth = 0;
    history.pushState({ yz: 1, n: 0, v: baseView }, '', location.href);
    applyView(baseView || { sec: isDesktop() ? 'dashboard' : null, detail: false, modal: false });
    return;
  }
  depth = s.n;
  applyView(s.v);
});

/* Tətbiqin öz "Geri" düymələri də brauzer tarixçəsi ilə sinxron işləsin */
document.addEventListener('click', (e) => {
  if (applying || !armed) return;
  const b = e.target.closest('.tile-detail-back, #adminBackBtn, #yzAdminBack');
  if (!b) return;
  if (depth > 0) {
    e.preventDefault();
    e.stopImmediatePropagation();
    history.back();
  }
}, true);

function init() {
  ensureBackBtn();
  new MutationObserver(onChange).observe(document.body, {
    attributes: true, attributeFilter: ['class'], subtree: true
  });
  onChange();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
