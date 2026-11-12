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
  { id: 'general',  l: 'Ümumi',                  i: 'home',     d: 'Menyu linki, iş gününün başlama saatı.' },
  { id: 'sales',    l: 'Satış və hesab',         i: 'money',    d: 'Xidmət haqqı, ƏDV və loyallıq bonusları.' },
  { id: 'security', l: 'Giriş və təhlükəsizlik', i: 'lock',     d: 'Rəhbər hesabı, işçilərin girişi, bu cihaz.' },
  { id: 'print',    l: 'Çek və çap',             i: 'printer',  d: 'Hesab çeki və mətbəx çekinin görünüşü.', wide: 1 },
  { id: 'kitchen',  l: 'Mətbəx',                 i: 'chef',     d: 'Hazır sifariş siqnalının təkrarlanması.' },
  { id: 'sounds',   l: 'Bildiriş səsləri',       i: 'bell',     d: 'Hansı hadisədə hansı səs çalınsın.', wide: 1 },
  { id: 'modules',  l: 'Bölmələrin ayarları',    i: 'settings', d: 'Rezerv, kassa, anbar, personal izləmə — hər birinin öz ayarları.' }
];
export let currentPane = 'general';
window.__yzSettingsPane = () => (state.adminSection === 'settings' ? currentPane : null);

/* ── Quruluş ── */
function build() {
  const sec = $('sec-settings');
  if (!sec || sec.dataset.yzHub) return !!sec;
  sec.dataset.yzHub = '1';
  // Köhnə kartlar qabı. "Bu cihaz" kartı (yuza-guard.js) bölmənin əvvəlinə ondan TEZ əlavə oluna bilər —
  // onu qab sanıb silməmək üçün qabı içindəki kartlara görə tapırıq.
  const old = [...sec.children].find(el => el.id !== 'yzDeviceCard' && el.querySelector(':scope > .table-card'));
  const cards = old ? [...old.querySelectorAll(':scope > .table-card')] : [];
  const byTitle = (re) => cards.find(c => re.test(c.querySelector('h3')?.textContent || ''));
  const hub = document.createElement('div');
  hub.className = 'yzs';
  hub.innerHTML = `
    <aside class="yzs-side">
      <div class="yzs-search">${I('search')}<input type="search" id="yzsQ" placeholder="Ayar axtar…" autocomplete="off" aria-label="Ayar axtar"></div>
      <div class="yzs-results" id="yzsRes" hidden></div>
      <nav class="yzs-nav" role="tablist" aria-label="Ayarlar">
        ${PANES.map(p => `<button type="button" class="yzs-nav__b" role="tab" data-pane="${p.id}">${I(p.i)}<span>${p.l}</span></button>`).join('')}
      </nav>
      <p class="yzs-about" id="yzsAbout"></p>
    </aside>
    <div class="yzs-panes">${PANES.map(p => `<section class="yzs-pane${p.wide ? ' yzs-pane--wide' : ''}" data-pane="${p.id}" role="tabpanel" hidden>
      <header class="yzs-ph"><h2 class="yzs-h">${I(p.i)} ${p.l}</h2><p>${p.d}</p></header>
      <div class="yzs-grid"></div></section>`).join('')}</div>`;
  const pane = (id) => hub.querySelector(`.yzs-pane[data-pane="${id}"] .yzs-grid`);
  const put = (id, el) => { if (el) { el.style.marginBottom = ''; el.classList.add('yzs-card'); pane(id).appendChild(el); } };

  // Ümumi: menyu linki, iş günü saatı, sistem məlumatları
  put('general', byTitle(/Menyu URL/));
  const biz = $('repBizDayHour')?.parentElement;
  if (biz) {
    const card = document.createElement('div');
    card.className = 'table-card';
    card.innerHTML = `<h3 style="margin-bottom:8px;">${I('clock')} İş günü başlama saatı</h3>
      <p style="font-size:13px;color:var(--text2);margin-bottom:12px;">Gün sonu və ay sonu hesabatları bu saatdan sayılır (məs. 05:00 — gecə yarısından sonrakı satış əvvəlki günə düşür).</p>`;
    biz.classList.add('yzs-biz');
    card.appendChild(biz);
    put('general', card);
  }
  const about = byTitle(/Sistem Məlumatları/);
  if (about) { hub.querySelector('#yzsAbout').textContent = about.querySelector('p')?.textContent?.trim() || ''; about.remove(); }
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
    tpl.classList.add('yzs-card', 'yzs-tpl');
  }
  // Bildiriş səsləri
  const snd = $('notifSoundsSection');
  if (snd) pane('sounds').appendChild(snd);
  // Giriş və təhlükəsizlik + bölmələrin ayarları — yeni kartlar
  pane('security').insertAdjacentHTML('beforeend', `<div id="yzsOwner"></div><div id="yzsGate"></div><div id="yzsDevice"></div>`);
  pane('modules').insertAdjacentHTML('beforeend', modulesHtml());
  if (snd) snd.classList.add('yzs-card');

  old?.remove();
  sec.appendChild(hub);
  hub.querySelector('.yzs-nav').addEventListener('click', (e) => { const b = e.target.closest('[data-pane]'); if (b) show(b.dataset.pane); });
  initSearch(hub);
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
  return `<div class="yzs-list yzs-card yzs-card--flat">
      <p class="yzs-note" style="grid-column:1/-1">Eyni ayarı bölmənin içindəki ${I('settings')} düyməsi də açır.</p>
      ${row('rsv', 'clock', 'Rezervasiya ayarları', 'Masalar arası hazırlıq, xəbərdarlıq vaxtları, mesaj mətnləri')}
      ${row('cash', 'cash', 'Kassa ayarları', 'Kassa hesabları, ödəniş növü → hesab, kateqoriyalar')}
      ${row('inv', 'box', 'Anbar ayarları', 'Anbar rejimi, standart anbar, minimum qalıq və s.')}
      ${row('att', 'users', 'Personal izləmə və davamiyyət ekranı', 'Davamiyyət ekranını açmaq, QR, GPS, Face ID, iş qaydaları, telefonlar')}
      ${row('kitchens', 'chef', 'Mətbəxlər və onların PIN-ləri', 'Qeydiyyat → Mətbəxlər')}
      ${row('danger', 'trash', 'Məlumatların silinməsi', 'Sistem → Məlumatların silinməsi')}
    </div>`;
}

/* ── Pəncərə göstərmək ── */
function show(id, silent, keep) {
  const sec = $('sec-settings'); if (!sec) return;
  currentPane = id;
  try { sessionStorage.setItem(K_PANE, id); } catch (e) { /* */ }
  sec.querySelectorAll('.yzs-nav__b').forEach(b => { const on = b.dataset.pane === id; b.classList.toggle('is-on', on); b.setAttribute('aria-selected', String(on)); });
  sec.querySelectorAll('.yzs-pane').forEach(p => { p.hidden = p.dataset.pane !== id; });
  if (id === 'security') { renderOwner(); renderGate(); moveDeviceCard(); }
  if (id === 'sounds') import('./notifSounds.js').then(m => m.renderNotifSounds?.()).catch(() => {});
  if (id === 'print' && !(keep && $('receiptTemplateSettings')?.querySelector(':scope > .yzs-tabs'))) import('./printer-settings.js').then(m => m.renderReceiptTemplateSettings?.()).then(tidyTemplate).catch(() => {});
  if (!silent) { sec.scrollTo?.(0, 0); window.scrollTo?.(0, 0); }
}

/* ── Çek şablonu: uzun forma → "Hesab çeki | Mətbəx çeki" tabları + açılıb-bağlanan hissələr ── */
let tplTab = 'bill';
function tidyTemplate() {
  const c = $('receiptTemplateSettings'); if (!c || c.querySelector(':scope > .yzs-tabs')) return;   // hər yenidən çəkilişdən sonra bir dəfə
  const kitchenWrap = $('kitchenTemplateSettings')?.parentElement;
  const saveBtn = c.querySelector('button[onclick^="saveReceiptTemplate"]');
  const status = $('tplSaveStatus');
  // Bölmə başlıqları (_section): sol tərəfində rəngli xətt olan div-lər
  const heads = [...c.children].filter(el => el.tagName === 'DIV' && /border-left:\s*3px/.test(el.getAttribute('style') || ''));
  heads.forEach((h, i) => {
    const d = document.createElement('details');
    d.className = 'yzs-acc'; if (i === 0) d.open = true;
    const sm = document.createElement('summary'); sm.textContent = h.textContent.replace(/^[^\wƏəÖöÜüĞğİıŞşÇç]+/, '').trim();
    d.appendChild(sm);
    const body = document.createElement('div'); body.className = 'yzs-acc__b'; d.appendChild(body);
    let n = h.nextElementSibling;
    while (n && !heads.includes(n) && n !== saveBtn && n !== kitchenWrap) { const nx = n.nextElementSibling; body.appendChild(n); n = nx; }
    h.replaceWith(d);
  });
  // Yadda saxla — həmişə görünən alt zolaq
  if (saveBtn) {
    const bar = document.createElement('div'); bar.className = 'yzs-savebar';
    saveBtn.replaceWith(bar); saveBtn.removeAttribute('style'); saveBtn.className = 'btn btn-green';
    bar.append(saveBtn); if (status) bar.append(status);
  }
  // Tablar
  const tabs = document.createElement('div'); tabs.className = 'yzs-tabs'; tabs.setAttribute('role', 'tablist');
  tabs.innerHTML = `<button type="button" data-t="bill">${I('doc')} Hesab çeki</button><button type="button" data-t="kitchen">${I('chef')} Mətbəx / bar çeki</button>`;
  const h3 = c.querySelector(':scope > h3'); if (h3) h3.remove();
  c.prepend(tabs);
  const billPart = [...c.children].filter(el => el !== tabs && el !== kitchenWrap);
  if (kitchenWrap) { kitchenWrap.removeAttribute('style'); kitchenWrap.classList.add('yzs-kt'); kitchenWrap.querySelector(':scope > h3')?.remove(); }
  const setTab = (t) => {
    tplTab = t;
    tabs.querySelectorAll('button').forEach(b => b.classList.toggle('is-on', b.dataset.t === t));
    billPart.forEach(el => { el.hidden = t !== 'bill'; });
    if (kitchenWrap) kitchenWrap.hidden = t !== 'kitchen';
  };
  tabs.addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (b) setTab(b.dataset.t); });
  setTab(tplTab);
}

/* ── Axtarış: ayarın adını yaz → harada olduğunu göstər ── */
function searchIndex() {
  const out = [];
  document.querySelectorAll('#sec-settings .yzs-pane').forEach(p => {
    const pid = p.dataset.pane, pl = PANES.find(x => x.id === pid)?.l || '';
    p.querySelectorAll('.yzs-grid h3, .yzs-row b, .yzs-acc > summary, .yzs-switch b, .yzs-grid label, .yzs-tabs button').forEach(el => {
      const t = el.textContent.replace(/\s+/g, ' ').trim();
      if (t && t.length > 2 && t.length < 90) out.push({ pid, pl, el, t });
    });
  });
  return out;
}
const norm = (x) => String(x).toLocaleLowerCase('az').replace(/ı/g, 'i').replace(/ə/g, 'e').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g');
function initSearch(hub) {
  const q = hub.querySelector('#yzsQ'), res = hub.querySelector('#yzsRes');
  let hits = [];
  const run = () => {
    const v = norm(q.value.trim());
    if (v.length < 2) { res.hidden = true; res.innerHTML = ''; return; }
    // Çek şablonu hələ çəkilməyibsə, axtarışda görünsün deyə çəkirik
    if (!$('receiptTemplateSettings')?.querySelector(':scope > .yzs-tabs')) import('./printer-settings.js').then(m => m.renderReceiptTemplateSettings?.()).then(() => { tidyTemplate(); run(); }).catch(() => {});
    const seen = new Set();
    hits = searchIndex().filter(x => norm(x.t).includes(v)).filter(x => { const k = x.pid + '|' + x.t; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 10);
    res.hidden = false;
    res.innerHTML = hits.length ? hits.map((h, i) => `<button type="button" data-h="${i}"><b>${esc(h.t)}</b><small>${esc(h.pl)}</small></button>`).join('') : '<p>Tapılmadı</p>';
  };
  q.addEventListener('input', run);
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') res.querySelector('[data-h]')?.click(); if (e.key === 'Escape') { q.value = ''; run(); } });
  res.addEventListener('click', (e) => {
    const b = e.target.closest('[data-h]'); if (!b) return;
    const h = hits[+b.dataset.h]; if (!h) return;
    show(h.pid, false, true);
    const acc = h.el.closest('details'); if (acc) acc.open = true;
    const kt = h.el.closest('.yzs-kt'); if (kt) $('receiptTemplateSettings')?.querySelector('.yzs-tabs [data-t="kitchen"]')?.click();
    else if (h.el.closest('#receiptTemplateSettings')) $('receiptTemplateSettings')?.querySelector('.yzs-tabs [data-t="bill"]')?.click();
    const card = h.el.closest('.yzs-card, .yzs-acc, .yzs-row') || h.el;
    setTimeout(() => { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); card.classList.add('yzs-flash'); setTimeout(() => card.classList.remove('yzs-flash'), 1600); }, 60);
    q.value = ''; res.hidden = true;
  });
}

/* ── Rəhbər hesabı ── */
function renderOwner() {
  const box = $('yzsOwner'); if (!box) return;
  const O = window.__yzOwner;
  if (!O?.available?.()) {
    box.innerHTML = `<div class="table-card yzs-card"><h3 style="margin-bottom:8px;">${I('key')} Rəhbər girişi</h3>
      <p style="font-size:13px;color:var(--text2);">Bu saytda Rəhbər hələ PIN ilə girir. E-poçt + parol girişi Firebase giriş qatı qoşulan saytda işləyir.</p></div>`;
    return;
  }
  const em = state.user?.email || O.email() || '—';
  box.innerHTML = `<div class="table-card yzs-card"><h3 style="margin-bottom:8px;">${I('key')} Rəhbər hesabı</h3>
    <p style="font-size:13px;color:var(--text2);margin-bottom:10px;">Rəhbər e-poçt və parolla daxil olur. Parolu Firebase serveri yoxlayır, çoxlu səhv cəhddən sonra girişi müvəqqəti bağlayır.</p>
    <div class="yzs-kv"><span>E-poçt</span><b>${esc(em)}</b></div>
    <div class="yzs-kv"><span>Sessiya</span><b>ən çox 12 saat</b></div>
    <div class="yzs-kv"><span>Avtomatik kilid</span><b>15 dəqiqə istifadə olunmasa</b></div>
    <button type="button" class="btn btn-ghost" data-act="pw" style="margin-top:12px;">${I('key')} Parolu dəyiş (e-poçta link göndərilir)</button>
    <p style="font-size:12px;color:var(--text3);margin-top:8px;">İşçilərə hansı bölməni görüb nə edəcəklərini <b>Qeydiyyat → İşçilər → İcazələr</b>də verirsiniz.</p></div>`;
}

/* ── POS girişi: davamiyyət yoxlaması (Personal izləmə ayarlarından buraya köçürülüb) ── */
let gateS = null;
async function renderGate() {
  const box = $('yzsGate'); if (!box) return;
  try { gateS = (await db.ref('att/settings').once('value')).val() || {}; } catch (e) { gateS = {}; }
  const on = !!gateS.gateLogin, ex = gateS.gateExempt || {};
  const staff = (state.staff || []).filter(s => s.systemAccess !== false).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'az'));
  box.innerHTML = `<div class="table-card yzs-card"><h3 style="margin-bottom:8px;">${I('clock')} İşə gəlişi qeyd etməyən işçi</h3>
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
  if (!c || !host || c.parentElement === host) return;
  c.classList.add('yzs-card'); c.style.maxWidth = '';
  const h = c.querySelector('h3'); if (h) h.innerHTML = `${I('lock')} Bu cihaz — ortaq restoran girişi`;
  host.appendChild(c);
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
