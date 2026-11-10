/* ═══════════════════════════════════════════
   YUZA POS — AYARLAR MƏRKƏZİ (10.11.2026)
   Bütün sistemi əlaqələndirən ayarlar BİR bölmədədir: Sistem → Ayarlar.
   Bölmələrin öz ayarları (Rezerv, Kassa, Anbar, Personal izləmə) burada
   öz adları ilə siyahıdadır və həmin ayar pəncərəsini açır. Bölmə içindəki
   ⚙ düyməsi də eyni ayarı açan qısa yoldur — ayar bir yerdə saxlanılır.

   Mövcud ayar kartları (xidmət haqqı, ƏDV, menyu linki, çek şablonu, səslər...)
   yenidən yazılmır — yalnız yeni yerlərinə köçürülür, öz funksiyaları ilə işləyir.
═══════════════════════════════════════════ */
import { db } from './firebase-service.js';
import { state } from './state.js';
import { showToast, esc } from './utils.js';

const $ = (id) => document.getElementById(id);
const I = (id) => `<svg class="icon"><use href="#i-${id}"></use></svg>`;
const K_PANE = 'yzSetPane';

const PANES = [
  { id: 'general',  l: 'Ümumi',                  i: 'home' },
  { id: 'sales',    l: 'Satış və hesab',         i: 'money' },
  { id: 'security', l: 'Giriş və təhlükəsizlik', i: 'lock' },
  { id: 'print',    l: 'Çek və çap',             i: 'printer' },
  { id: 'kitchen',  l: 'Mətbəx',                 i: 'chef' },
  { id: 'sounds',   l: 'Bildiriş səsləri',       i: 'bell' },
  { id: 'modules',  l: 'Bölmələrin ayarları',    i: 'settings' }
];
export let currentPane = 'general';
window.__yzSettingsPane = () => (state.adminSection === 'settings' ? currentPane : null);

/* ── Quruluş ── */
function build() {
  const sec = $('sec-settings');
  if (!sec || sec.dataset.yzHub) return !!sec;
  sec.dataset.yzHub = '1';
  const old = sec.firstElementChild;                       // köhnə kartlar qabı
  const cards = old ? [...old.querySelectorAll(':scope > .table-card')] : [];
  const byTitle = (re) => cards.find(c => re.test(c.querySelector('h3')?.textContent || ''));
  const hub = document.createElement('div');
  hub.className = 'yzs';
  hub.innerHTML = `
    <nav class="yzs-nav" role="tablist" aria-label="Ayarlar">
      ${PANES.map(p => `<button type="button" class="yzs-nav__b" role="tab" data-pane="${p.id}">${I(p.i)}<span>${p.l}</span></button>`).join('')}
    </nav>
    <div class="yzs-panes">${PANES.map(p => `<section class="yzs-pane" data-pane="${p.id}" role="tabpanel" hidden>
      <h2 class="yzs-h">${I(p.i)} ${p.l}</h2></section>`).join('')}</div>`;
  const pane = (id) => hub.querySelector(`.yzs-pane[data-pane="${id}"]`);
  const put = (id, el) => { if (el) pane(id).appendChild(el); };

  // Ümumi: menyu linki, iş günü saatı, sistem məlumatları
  put('general', byTitle(/Menyu URL/));
  const biz = $('repBizDayHour')?.parentElement;
  if (biz) {
    const card = document.createElement('div');
    card.className = 'table-card'; card.style.marginBottom = '16px';
    card.innerHTML = `<h3 style="margin-bottom:8px;">${I('clock')} İş günü başlama saatı</h3>
      <p style="font-size:13px;color:var(--text2);margin-bottom:12px;">Gün sonu və ay sonu hesabatları bu saatdan sayılır (məs. 05:00 — gecə yarısından sonrakı satış əvvəlki günə düşür).</p>`;
    biz.classList.add('yzs-biz');
    card.appendChild(biz);
    put('general', card);
  }
  put('general', byTitle(/Sistem Məlumatları/));
  // Satış və hesab
  put('sales', byTitle(/Xidmət Haqqı/));
  put('sales', byTitle(/ƏDV/));
  put('sales', byTitle(/Loyallıq/));
  // Mətbəx
  put('kitchen', byTitle(/Mətbəx Siqnal/));
  // Çek və çap: restoran məlumatları + şablonlar (printer cihazları Qeydiyyatdadır)
  const tpl = $('receiptTemplateSettings')?.closest('.table-card');
  if (tpl) {
    const note = document.createElement('p');
    note.className = 'yzs-note';
    note.innerHTML = `Printer cihazlarını əlavə etmək və dəyişmək: <button type="button" class="yzs-link" data-go="printers">${I('printer')} Qeydiyyat → Printerlər</button>`;
    pane('print').append(note, tpl);
  }
  // Bildiriş səsləri
  const snd = $('notifSoundsSection');
  if (snd) pane('sounds').appendChild(snd);
  // Giriş və təhlükəsizlik + bölmələrin ayarları — yeni kartlar
  pane('security').insertAdjacentHTML('beforeend', `<div id="yzsOwner"></div><div id="yzsGate"></div><div id="yzsDevice"></div>`);
  pane('modules').insertAdjacentHTML('beforeend', modulesHtml());

  old?.remove();
  sec.appendChild(hub);
  hub.querySelector('.yzs-nav').addEventListener('click', (e) => { const b = e.target.closest('[data-pane]'); if (b) show(b.dataset.pane); });
  hub.addEventListener('click', onAction);
  moveDeviceCard();
  try { currentPane = sessionStorage.getItem(K_PANE) || 'general'; } catch (e) { /* */ }
  if (!PANES.some(p => p.id === currentPane)) currentPane = 'general';
  show(currentPane, true);
  return true;
}

function modulesHtml() {
  const row = (act, ico, title, sub) => `<button type="button" class="yzs-row" data-act="${act}">
      <span class="yzs-row__i">${I(ico)}</span><span class="yzs-row__t"><b>${title}</b><small>${sub}</small></span>${I('chevron')}</button>`;
  return `<p class="yzs-note">Hər bölmənin öz ayarları. Eyni ayarı bölmənin içindəki ${I('settings')} düyməsi də açır.</p>
    <div class="yzs-list">
      ${row('rsv', 'clock', 'Rezervasiya ayarları', 'Masalar arası hazırlıq, xəbərdarlıq vaxtları, mesaj mətnləri')}
      ${row('cash', 'cash', 'Kassa ayarları', 'Kassa hesabları, ödəniş növü → hesab, kateqoriyalar')}
      ${row('inv', 'box', 'Anbar ayarları', 'Anbar rejimi, standart anbar, minimum qalıq və s.')}
      ${row('att', 'users', 'Personal izləmə ayarları', 'QR, GPS, Face ID, iş müddəti qaydaları')}
      ${row('kitchens', 'chef', 'Mətbəxlər və onların PIN-ləri', 'Qeydiyyat → Mətbəxlər')}
      ${row('danger', 'trash', 'Məlumatların silinməsi', 'Sistem → Məlumatların silinməsi')}
    </div>`;
}

/* ── Pəncərə göstərmək ── */
function show(id, silent) {
  const sec = $('sec-settings'); if (!sec) return;
  currentPane = id;
  try { sessionStorage.setItem(K_PANE, id); } catch (e) { /* */ }
  sec.querySelectorAll('.yzs-nav__b').forEach(b => { const on = b.dataset.pane === id; b.classList.toggle('is-on', on); b.setAttribute('aria-selected', String(on)); });
  sec.querySelectorAll('.yzs-pane').forEach(p => { p.hidden = p.dataset.pane !== id; });
  if (id === 'security') { renderOwner(); renderGate(); moveDeviceCard(); }
  if (id === 'sounds') import('./notifSounds.js').then(m => m.renderNotifSounds?.()).catch(() => {});
  if (id === 'print') import('./printer-settings.js').then(m => m.renderReceiptTemplateSettings?.()).catch(() => {});
  if (!silent) sec.scrollTo?.(0, 0);
}

/* ── Rəhbər hesabı ── */
function renderOwner() {
  const box = $('yzsOwner'); if (!box) return;
  const O = window.__yzOwner;
  if (!O?.available?.()) {
    box.innerHTML = `<div class="table-card" style="margin-bottom:16px;"><h3 style="margin-bottom:8px;">${I('key')} Rəhbər girişi</h3>
      <p style="font-size:13px;color:var(--text2);">Bu saytda Rəhbər hələ PIN ilə girir. E-poçt + parol girişi Firebase giriş qatı qoşulan saytda işləyir.</p></div>`;
    return;
  }
  const em = state.user?.email || O.email() || '—';
  box.innerHTML = `<div class="table-card" style="margin-bottom:16px;"><h3 style="margin-bottom:8px;">${I('key')} Rəhbər hesabı</h3>
    <p style="font-size:13px;color:var(--text2);margin-bottom:10px;">Rəhbər e-poçt və parolla daxil olur. Parolu Firebase serveri yoxlayır, çoxlu səhv cəhddən sonra girişi müvəqqəti bağlayır.</p>
    <div class="yzs-kv"><span>E-poçt</span><b>${esc(em)}</b></div>
    <div class="yzs-kv"><span>Sessiya</span><b>ən çox 12 saat</b></div>
    <div class="yzs-kv"><span>Avtomatik kilid</span><b>15 dəqiqə istifadə olunmasa</b></div>
    <button type="button" class="btn btn-ghost" data-act="pw" style="width:100%;padding:12px;margin-top:12px;">${I('key')} Parolu dəyiş (e-poçta link göndərilir)</button>
    <p style="font-size:12px;color:var(--text3);margin-top:8px;">İşçilərə hansı bölməni görüb nə edəcəklərini <b>Qeydiyyat → İşçilər → İcazələr</b>də verirsiniz.</p></div>`;
}

/* ── POS girişi: davamiyyət yoxlaması (Personal izləmə ayarlarından buraya köçürülüb) ── */
let gateS = null;
async function renderGate() {
  const box = $('yzsGate'); if (!box) return;
  try { gateS = (await db.ref('att/settings').once('value')).val() || {}; } catch (e) { gateS = {}; }
  const on = !!gateS.gateLogin, ex = gateS.gateExempt || {};
  const staff = (state.staff || []).filter(s => s.systemAccess !== false).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'az'));
  box.innerHTML = `<div class="table-card" style="margin-bottom:16px;"><h3 style="margin-bottom:8px;">${I('clock')} İşə gəlişi qeyd etməyən işçi</h3>
    <label class="yzs-switch"><span><b>Gəlişini qeyd etməyən işçi sistemə girə bilməsin</b>
      <small>İşçi PIN ilə girməzdən əvvəl telefonu ilə QR-ı oxudub "İşə gəldim" etməlidir. Müvəqqəti çıxışda olan da girə bilmir. İşçi işdən çıxanda sistemdən avtomatik çıxarılır.</small></span>
      <input type="checkbox" id="yzsGateOn" ${on ? 'checked' : ''}></label>
    <div class="yzs-ex"${on ? '' : ' hidden'}><small>Bu işçilər yoxlanmasın (məs. mühasib, menecer):</small>
      ${staff.map(s => `<label><input type="checkbox" data-ex="${esc(s.id)}" ${ex[s.id] ? 'checked' : ''}> ${esc(s.name || '')}</label>`).join('') || '<span style="color:var(--text3)">İşçi yoxdur</span>'}</div>
    <p style="font-size:12px;color:var(--text3);margin-top:8px;">Rəhbər yoxlanmır. İnternet olmayanda giriş bloklanmır ki, restoranın işi dayanmasın.</p></div>`;
  const save = async () => {
    const gateExempt = {};
    box.querySelectorAll('[data-ex]').forEach(c => { if (c.checked) gateExempt[c.dataset.ex] = true; });
    const gateLogin = $('yzsGateOn').checked;
    box.querySelector('.yzs-ex').hidden = !gateLogin;
    try {
      await db.ref('att/settings').update({ gateLogin, gateExempt: Object.keys(gateExempt).length ? gateExempt : null });
      showToast(`${I('check')} Yadda saxlanıldı`);
    } catch (e) { showToast(`${I('error')} Yadda saxlanılmadı: ${esc(e.message || e)}`); }
  };
  $('yzsGateOn').onchange = save;
  box.querySelectorAll('[data-ex]').forEach(c => { c.onchange = save; });
}

/* "Bu cihaz" kartı (yuza-guard.js yaradır) → Giriş və təhlükəsizlik */
function moveDeviceCard() {
  const c = $('yzDeviceCard'), host = $('yzsDevice');
  if (c && host && c.parentElement !== host) host.appendChild(c);
}

/* ── Düymələr ── */
async function onAction(e) {
  const go = e.target.closest('[data-go]');
  if (go) { window.adminTab?.(go.dataset.go); return; }
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act;
  if (act === 'pw') {
    try { await window.__yzOwner.sendReset(state.user?.email || window.__yzOwner.email()); showToast(`${I('check')} Parolu dəyişmək üçün link e-poçtunuza göndərildi`); }
    catch (er) { showToast(`${I('error')} Link göndərilmədi`); }
    return;
  }
  if (act === 'rsv') { if (window.yzRsvSettings) window.yzRsvSettings(); else showToast(`${I('warning')} Rezervasiya modulu yüklənməyib`); return; }
  if (act === 'cash') { if (window.yzCashSettings) window.yzCashSettings(); else showToast(`${I('warning')} Kassa modulu yüklənməyib`); return; }
  if (act === 'inv') { window.adminTab?.('inv-settings'); return; }
  if (act === 'att') { if (window.yzAttOpen) window.yzAttOpen('settings'); else window.adminTab?.('att'); return; }
  if (act === 'kitchens') { window.adminTab?.('kitchenStations'); return; }
  if (act === 'danger') { window.adminTab?.('dangerZone'); return; }
}

/* ── Başlanğıc ── */
function init() {
  if (!build()) { const t = setInterval(() => { if (build()) clearInterval(t); }, 200); setTimeout(() => clearInterval(t), 15000); }
  // "Bu cihaz" kartı sonradan yaranır
  new MutationObserver(moveDeviceCard).observe($('sec-settings') || document.body, { childList: true });
  // Ayarlar açılanda cari pəncərə yenilənir
  new MutationObserver(() => {
    if (!$('sec-settings')?.classList.contains('active')) return;
    try { const p = sessionStorage.getItem(K_PANE); if (p && PANES.some(x => x.id === p)) currentPane = p; } catch (e) { /* */ }
    show(currentPane, true);
  })
    .observe($('sec-settings') || document.body, { attributes: true, attributeFilter: ['class'] });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
