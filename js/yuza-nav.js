/* ═══════════════════════════════════════════
   YUZA POS — PƏNCƏRƏ QATLARI + "GERİ" İDARƏSİ (v2, 10.11.2026)
   Mövcud modullara TOXUNMUR, yalnız DOM-u izləyir.

   1) QATLAR: hansı pəncərə SONUNCU açılıbsa, o həmişə ən üstdə görünür.
      Köhnə pəncərələr (.modal-bg), yeni Yuza pəncərələri (modal()),
      Rezervlər ekranı, mal yan paneli və Racia paneli eyni növbəyə düşür.
   2) GERİ: hər "Geri" (telefonun geri düyməsi/jesti, brauzerin geri düyməsi,
      paneldəki ← düyməsi) BİR addım geri aparır:
        ən üstdəki pəncərə → detal → sifariş ekranı → Zal → əvvəlki bölmə.
      Pəncərə X / Bağla ilə bağlananda tarixçə də özü geri çəkilir — buna görə
      "Geri" heç vaxt boş basılmır. Ana ekranda geri basmaq proqramdan çıxarmır.
═══════════════════════════════════════════ */

const $ = (id) => document.getElementById(id);
const isDesktop = () => window.matchMedia('(min-width:900px)').matches;

/* ═══ 1. QATLAR ═══ */
const LAYER_SEL = '.modal-bg.open, .yzrv-screen.is-open, .item-side-panel.open, .rc-sheet-bg.open';
const Z_BASE = 2000, Z_STEP = 2, Z_MAX = 2440;   // 2450+ : bildirişlər, seçici siyahılar, toast, alarm
let uid = 0;

function setZ(el, z) {
  el.dataset.yzZ = String(z);
  el.style.zIndex = String(z);
  if (!el.dataset.yzId) el.dataset.yzId = String(++uid);
  if (el.id === 'itemSidePanel') { const bg = $('itemSidePanelBg'); if (bg) bg.style.zIndex = String(z - 1); }
}
function clearZ(el) {
  el.style.zIndex = '';
  delete el.dataset.yzZ;
  delete el.dataset.yzId;
  if (el.id === 'itemSidePanel') { const bg = $('itemSidePanelBg'); if (bg) bg.style.zIndex = ''; }
}
function openLayers() {
  return [...document.querySelectorAll(LAYER_SEL)];
}
function stackLayers() {
  document.querySelectorAll('[data-yz-z]').forEach(el => { if (!el.isConnected || !el.matches(LAYER_SEL)) clearZ(el); });
  const open = openLayers();
  let max = Z_BASE;
  open.forEach(el => { if (el.dataset.yzZ) max = Math.max(max, +el.dataset.yzZ); });
  open.forEach(el => { if (!el.dataset.yzZ) { max += Z_STEP; setZ(el, max); } });
  if (max > Z_MAX) {
    let z = Z_BASE;
    open.sort((a, b) => (+a.dataset.yzZ) - (+b.dataset.yzZ)).forEach(el => { z += Z_STEP; setZ(el, z); });
  }
}
/* Ən üstdəki açıq qat (pəncərə/panel) və ya admin detalı */
function topLayer() {
  const open = openLayers().sort((a, b) => (+b.dataset.yzZ || 0) - (+a.dataset.yzZ || 0));
  if (open[0]) return open[0];
  const det = [...document.querySelectorAll('#adminScreen.active .admin-section.active .tile-detail-overlay.open')];
  return det[det.length - 1] || null;
}

/* Qatı öz düyməsi ilə bağlayır (təmizləmə məntiqi işə düşsün deyə) */
const CLOSE_SEL = '.yzi-x, [data-cancel], [data-close-audit], [data-close], [data-confirm-action-cancel], [data-rc-close], #bamCancelBtn, #ispCloseBtn';
function closeLayer(el) {
  let ctrl = null;
  if (el.classList.contains('tile-detail-overlay')) ctrl = el.querySelector('.tile-detail-back');
  else ctrl = el.querySelector(CLOSE_SEL)
    || el.querySelector('button[onclick*="close" i]')
    || el.querySelector('button[onclick*="remove(\'open\')"]');
  if (ctrl) ctrl.click();
  else el.classList.remove('open', 'is-open');
}

/* ═══ 2. GÖRÜNÜŞ ═══ */
const ARMED = ['adminScreen', 'waiterScreen', 'orderScreen', 'kitchenScreen', 'invScreen'];

function view() {
  const scr = document.querySelector('.screen.active')?.id || null;
  if (!ARMED.includes(scr)) return null;
  let sec = null;
  if (scr === 'adminScreen') {
    const act = document.querySelector('#adminScreen .admin-section.active');
    sec = act ? act.id.replace(/^sec-/, '') : null;
    if (!isDesktop() && !$('adminBody')?.classList.contains('admin-section-open')) sec = null;
  }
  const zal = scr === 'waiterScreen' && document.body.classList.contains('yz-patron-zal');
  const det = scr === 'adminScreen'
    ? [...document.querySelectorAll('#adminScreen .admin-section.active .tile-detail-overlay.open')].map(el => {
        if (!el.dataset.yzId) el.dataset.yzId = String(++uid);
        return 'd' + el.dataset.yzId;
      })
    : [];
  const lay = openLayers().sort((a, b) => (+a.dataset.yzZ || 0) - (+b.dataset.yzZ || 0)).map(el => el.dataset.yzId || '?');
  return { scr, sec, zal, layers: det.concat(lay) };
}
const sigOf = (v) => `${v.scr}|${v.zal ? 1 : 0}|${v.sec || ''}|${v.layers.join(',')}`;

/* ═══ 3. TARİXÇƏ ═══ */
let stack = [];     // [{ s: imza, v: görünüş }] — bizim tarixçə qeydlərimiz
let depth = -1;     // -1 = izləmə yoxdur (giriş və ya müştəri ekranı)
let expect = 0;     // özümüz etdiyimiz history.back() sayı — onların popstate-i nəzərə alınmır
let busy = false;   // "Geri" icra olunur — dəyişikliklər tarixçəyə yazılmır

function push(v) {
  depth += 1;
  stack.length = depth;
  stack.push({ s: sigOf(v), v });
  history.pushState({ yz: 1, n: depth }, '', location.href);
}

function record() {
  if (busy) return;
  const v = view();
  if (!v) { stack = []; depth = -1; updateBackBtn(); return; }
  const s = sigOf(v);
  if (depth < 0) { depth = -1; push(v); updateBackBtn(); return; }
  if (s === stack[depth].s) { stack[depth].v = v; return; }
  // Əvvəlki vəziyyətə qayıdılıb (X, Bağla, Ləğv, öz Geri düyməsi) → tarixçəni də geri çək
  let j = -1;
  for (let i = depth - 1; i >= 0; i--) { if (stack[i].s === s) { j = i; break; } }
  if (j >= 0) {
    expect += 1;
    history.go(j - depth);
    depth = j;
    stack.length = depth + 1;
    updateBackBtn();
    return;
  }
  push(v);
  updateBackBtn();
}

/* Bir addım geri: ən üstdəki qat → sifariş ekranı → Anbar → Zal → bölmə */
function performBack() {
  const v = view();
  if (!v) return false;
  const top = topLayer();
  if (top) { closeLayer(top); return true; }
  if (v.scr === 'orderScreen') {
    const b = document.querySelector('#orderScreen [data-close-order]');
    if (b) { b.click(); return true; }
    return false;
  }
  if (v.scr === 'invScreen') {
    const b = $('yzInvStaffBack');
    if (b && b.dataset.mode !== 'logout') { b.click(); return true; }
    return false;
  }
  if (v.zal) { const b = $('yzZalBack'); if (b) { b.click(); return true; } return false; }
  if (v.scr === 'adminScreen') {
    if (!isDesktop()) {
      if ($('adminBody')?.classList.contains('admin-section-open') && typeof window.adminGoBack === 'function') { window.adminGoBack(); return true; }
      return false;
    }
    for (let i = depth - 1; i >= 0; i--) {
      const p = stack[i].v;
      if (p.scr !== 'adminScreen') break;
      if (p.sec && p.sec !== v.sec && typeof window.adminTab === 'function') {
        window.adminTab(p.sec, document.querySelector(`.admin-tab[data-section="${p.sec}"]`));
        return true;
      }
    }
  }
  return false;
}

/* Geri əməliyyatından sonra cari vəziyyəti tarixçənin göstərilən yerinə yazır */
function settle(n) {
  setTimeout(() => {
    busy = false;
    stackLayers();
    const v = view();
    if (!v) { stack = []; depth = -1; updateBackBtn(); return; }
    depth = Math.max(0, n);
    stack.length = depth;
    stack.push({ s: sigOf(v), v });
    updateBackBtn();
  }, 90);
}

window.addEventListener('popstate', (e) => {
  if (expect > 0) { expect -= 1; return; }
  if (depth < 0) return;
  const st = e.state;
  if (!st || !st.yz) {
    // Ən başdan da geri basıldı → proqramda qal
    history.pushState({ yz: 1, n: 0 }, '', location.href);
    busy = true;
    for (let i = 0; i < depth; i++) { if (!performBack()) break; }
    settle(0);
    return;
  }
  const steps = depth - st.n;
  if (steps <= 0) {
    // "İrəli" basılıb — POS-da mənası yoxdur, geri qaytarırıq
    if (steps < 0) { expect += 1; history.go(steps); }
    return;
  }
  busy = true;
  for (let i = 0; i < steps; i++) { if (!performBack()) break; }
  settle(st.n);
});

/* ═══ 4. PANELDƏKİ "←" DÜYMƏSİ (Rəhbər paneli) ═══ */
function ensureBackBtn() {
  if ($('yzAdminBack')) return $('yzAdminBack');
  const host = $('adminTopbar')?.firstElementChild;
  if (!host) return null;
  const btn = document.createElement('button');
  btn.id = 'yzAdminBack';
  btn.type = 'button';
  btn.className = 'yz-back-btn yz-icon-only';
  btn.setAttribute('aria-label', 'Geri');
  btn.title = 'Geri';
  btn.innerHTML = '<svg class="icon"><use href="#i-back"></use></svg>';
  btn.style.display = 'none';
  btn.addEventListener('click', () => {
    if (depth > 0) history.back();   // popstate → performBack
    else performBack();
  });
  const ham = host.querySelector('.ap-hamburger');
  if (ham && ham.nextSibling) host.insertBefore(btn, ham.nextSibling);
  else host.appendChild(btn);
  return btn;
}
function updateBackBtn() {
  const btn = ensureBackBtn();
  if (!btn) return;
  const onAdmin = $('adminScreen')?.classList.contains('active');
  btn.style.display = (onAdmin && depth > 0) ? '' : 'none';
}

/* ═══ 5. TELEFONDA DETAL PANELİ (masa, işçi, mal kartı...) ═══
   Panel bölmənin içində olduğu üçün yuxarı hissəsi (← zolağı) başlıq zolağının altında qalırdı.
   Telefonda paneli başlıq zolağının altından başladırıq ki, ← həmişə görünsün. */
function fitDetails() {
  const open = document.querySelectorAll('#adminScreen .tile-detail-overlay.open');
  if (!open.length) return;
  const top = isDesktop() ? 0 : Math.max(0, Math.round($('adminTopbar')?.getBoundingClientRect().bottom || 0));
  open.forEach(el => { const v = top ? top + 'px' : ''; if (el.style.top !== v) el.style.top = v; });
}
window.addEventListener('resize', fitDetails);

/* ═══ 6. BAŞLANĞIC ═══ */
function onMutate() {
  stackLayers();
  fitDetails();
  record();
}
function init() {
  ensureBackBtn();
  // İki ayrı izləyici: eyni elementə ikinci observe() birincinin ayarlarını əvəz edir
  new MutationObserver(onMutate).observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });
  new MutationObserver(onMutate).observe(document.body, { childList: true });
  onMutate();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
