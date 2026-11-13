/* ═══════════════════════════════════════════
   YUZA POS — PERSONAL İZLƏMƏ: İŞÇİ TELEFONU VƏ EKRAN REJİMİ
   izle.html?inv=KOD     → Rəhbərin göstərdiyi DƏVƏT QR-ı: telefonu işçiyə bağlayır (bir dəfə)
   izle.html?k=KOD       → davamiyyət ekranındakı dəyişən QR: giriş/çıxış
   izle.html             → bağlı telefonun əsas ekranı
   izle.html?ekran=1     → restoranda sabit ekran: dəyişən QR + telefon aktivləşdirmə (restoran girişi tələb edir)

   Təhlükəsizlik:
   • İşçi telefonuna heç bir PIN və ya işçi siyahısı yüklənmir.
   • Telefon yalnız Rəhbərin verdiyi 10 dəqiqəlik, birdəfəlik dəvətlə işçiyə bağlanır.
   • Saatı server qoyur; dəyişən QR rejimində QR-ı baza özü yoxlayır (evdən qeyd olmur).
═══════════════════════════════════════════ */
import { db } from './firebase-service.js';
import {
  A, TS, withDefaults, now, fmtDT, fmtTime, fmtDate, fmtDur, distanceM, getPosition, clock, logAttempt,
  nextKind, isStale, phaseOf, shiftStart, BREAKS, breakLabel, breakList, workedMs, ACTION_LABEL, TRUST, deviceModel,
  faceIdAvailable, faceIdRegister, faceIdVerify, faceIdError, attUid, bindPhone, newCode, createInvite, INVITE_MIN, adb
} from './yuza-att-core.js';
import { scanQr } from './yuza-qr-scan.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const root = () => $('iz');
const BASE = location.origin + location.pathname.replace(/[^/]*$/, '');
export const IZLE_URL = BASE + 'izle.html';

const ICON = {
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
  face: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V6a2 2 0 012-2h2M16 4h2a2 2 0 012 2v2M20 16v2a2 2 0 01-2 2h-2M8 20H6a2 2 0 01-2-2v-2M9 10v1M15 10v1M12 10v3h-1M9.5 16a4 4 0 005 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0112 2.5a7 7 0 017 7C19 14.8 12 21 12 21z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="9.5" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M11 18.5h2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  cam: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-2.5h6L17 8h3v11H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M11 18l-6-6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  logout: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4H6a2 2 0 00-2 2v12a2 2 0 002 2h4M15 16l4-4-4-4M19 12H9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  qr: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>'
};
const brand = `<div class="iz-brand"><span class="iz-logo">Y</span><span>YuZa <b>POS</b></span><small>Davamiyyət</small></div>`;

function toast(msg) {
  const t = $('izToast'); if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 3200);
}
function setView(html) { root().innerHTML = html; }
const initial = (n) => esc(String(n || '?').trim().slice(0, 1).toUpperCase());

/* ── Ünvandakı kodlar: oxunan kimi ünvandan silinir (yeniləmə / ekran şəkli ilə təkrar istifadə olunmasın) ── */
const params = new URLSearchParams(location.search);
const scan = { code: params.get('k'), at: Date.now() };
const inviteCode = params.get('inv');
if (scan.code || inviteCode) {
  const u = new URL(location.href); u.searchParams.delete('k'); u.searchParams.delete('inv');
  history.replaceState(null, '', u.pathname + u.search);
}
const SCAN_TTL = 110000;   // QR oxunandan sonra ~2 dəqiqə ərzində qeyd edilməlidir (baza da 2 dəq qəbul edir)
const scanFresh = () => !!scan.code && (Date.now() - scan.at) < SCAN_TTL;

/* ── Səhifə içi skaner: yalnız bu saytın izle.html QR-larını qəbul edir ── */
function parseIzleQr(text) {
  let u; try { u = new URL(String(text).trim()); } catch (e) { return null; }
  if (u.origin !== location.origin || !/\/izle\.html$/.test(u.pathname)) return null;
  const ok = (c) => !!c && /^[a-z0-9]{6,40}$/.test(c);
  const k = u.searchParams.get('k'), inv = u.searchParams.get('inv');
  if (ok(inv)) return { inv };
  if (ok(k)) return { k };
  return null;
}
async function inAppScan() {
  const text = await scanQr({
    title: 'QR kodu oxudun',
    hint: 'Kameranı davamiyyət ekranındakı və ya Rəhbərin göstərdiyi QR-a tutun.',
    accept: (t) => parseIzleQr(t) ? true : 'Bu, YuZa davamiyyət QR-ı deyil.'
  });
  const p = text && parseIzleQr(text);
  if (!p) return;
  const uid = attUid();
  if (p.inv) { offAll(); me = null; await handleInvite(p.inv, uid); return; }
  if (!me) {
    logAttempt(null, null, 'Qeydiyyatsız telefon davamiyyət QR-ını oxutdu', { model: deviceModel() });
    toast('Telefonunuz hələ qoşulmayıb. Rəhbərə müraciət edin.');
    return;
  }
  scan.code = p.k; scan.at = Date.now();
  renderHome();
  toast('QR oxundu');
}

/* ── Ayarlar ── */
let S = withDefaults(null);
let onSettings = () => {};
const settingsReady = new Promise(res => A('settings').on('value', s => { S = withDefaults(s.val()); res(); onSettings(); }, () => res()));

/* ═══════════════ İŞÇİ TELEFONU ═══════════════ */
let me = null;        // { id, name, firstname, position }
let myTables = [];    // bu işçinin açıq masalarının adları
let myPhone = null;   // att/phones/{uid}
let myStatus = null;
let unsub = [];
const offAll = () => { unsub.forEach(f => f()); unsub = []; };
const listen = (ref, cb, onCancel) => { const h = ref.on('value', cb, onCancel || (() => {})); unsub.push(() => ref.off('value', h)); };

async function startWorker() {
  const uid = attUid();
  if (!uid) {
    renderInfo(ICON.x, 'bad', 'Səhifə açılmadı', 'Bu səhifə restoran cihazında deyil, işçinin <b>öz telefonunda</b> açılmalıdır. İnternet bağlantısını yoxlayıb yenidən cəhd edin.');
    return;
  }
  await settingsReady;
  onSettings = () => { if (me && !resultOpen()) renderHome(); };
  if (inviteCode) { await handleInvite(inviteCode, uid); return; }
  await openBound(uid);
}

/* Telefonun kimə bağlı olduğunu tapır və bağlantı ləğv ediləndə dərhal bilir */
async function openBound(uid) {
  offAll();
  let ph = null;
  try { ph = (await A('phones/' + uid).once('value')).val(); } catch (e) { ph = null; }
  if (!ph || !ph.staffId) {
    // Qeydiyyatsız telefon davamiyyət QR-ını oxudub → "Şübhəli cəhdlər"
    if (scan.code) logAttempt(null, null, 'Qeydiyyatsız telefon davamiyyət QR-ını oxutdu', { model: deviceModel() });
    renderNotBound(); return;
  }
  myPhone = ph;
  me = { id: ph.staffId, name: ph.staffName || '', firstname: ph.firstname || '', position: ph.position || '' };
  let first = true;
  const lost = () => {
    me = null; offAll();
    renderInfo(ICON.x, 'bad', 'Bu telefon artıq bağlı deyil',
      'Rəhbər bu telefonun bağlantısını ləğv edib və ya sizin hesabınıza başqa telefon qoşulub. Yeni dəvət üçün Rəhbərə müraciət edin.');
  };
  // Bağlantı ləğv edilən kimi baza bu telefona oxumağı da qadağan edir → "lost"
  listen(A('devices/' + ph.staffId + '/approved'), (s) => {
    const a = s.val();
    if (!a || a.uid !== uid) { lost(); return; }
    if (first) { first = false; renderHome(); }
  }, lost);
  // Nəticə ekranı (qeyd edildi / alınmadı) açıqdırsa üstündən yazılmır — istifadəçi bağlayanda əsas ekran yenilənir
  listen(A('status/' + ph.staffId), (s) => { myStatus = s.val(); if (me && !busy && !resultOpen()) renderHome(); });
  // Bu işçinin açıq masaları: masası olan işçi işdən / müvəqqəti çıxa bilməz (əvvəlcə ötürülməlidir)
  listen(adb.ref('tables').orderByChild('occupant').equalTo(ph.staffId), (s) => {
    myTables = []; s.forEach(c => { myTables.push(c.val()?.name || c.key); });
    if (me && !busy && $('izHome')) renderHome();
  });
}

function renderNotBound() {
  setView(`${brand}
    <section class="iz-card">
      <div class="iz-ico iz-ico--gold">${ICON.phone}</div>
      <h1>Telefon qoşulmayıb</h1>
      <p class="iz-p">Davamiyyəti qeyd etmək üçün telefonunuz sizin adınıza <b>bir dəfə</b> qoşulmalıdır.</p>
      <ol class="iz-steps">
        <li>Rəhbərə yaxınlaşın.</li>
        <li>Rəhbər öz panelində: <b>Personal izləmə → Cihazlar → adınızın yanında “Telefon qoş”</b>.</li>
        <li>Aşağıdakı <b>“QR oxu”</b> düyməsini basın və ekranda çıxan QR-a tutun.</li>
      </ol>
      <button id="izScanInv" class="iz-btn iz-btn--gold" type="button">${ICON.qr} QR oxu</button>
      <p class="iz-hint">Dəvət QR-ı 10 dəqiqə etibarlıdır və yalnız bir telefona qoşulur.</p>
    </section>`);
  $('izScanInv').onclick = inAppScan;
}

function renderInfo(icon, tone, title, html, btn) {
  setView(`${brand}
    <section class="iz-card">
      <div class="iz-ico iz-ico--${tone}">${icon}</div>
      <h1>${esc(title)}</h1>
      <p class="iz-p">${html}</p>
      ${btn ? `<button id="izInfoBtn" class="iz-btn iz-btn--gold" type="button">${esc(btn.label)}</button>` : ''}
    </section>`);
  if (btn) $('izInfoBtn').onclick = btn.onClick;
}

/* ── 1) Dəvət: telefonu işçiyə bağlamaq ── */
async function handleInvite(code, uid) {
  setView(`${brand}<section class="iz-card iz-step"><div class="iz-spin"></div><h1>Dəvət yoxlanılır…</h1></section>`);
  let inv = null;
  try { inv = (await A('invites/' + code).once('value')).val(); } catch (e) { inv = null; }
  if (!inv || !inv.staffId) {
    logAttempt(null, null, 'Etibarsız telefon dəvəti ilə cəhd', { model: deviceModel() });
    renderInfo(ICON.x, 'bad', 'Dəvət tapılmadı', 'Bu QR artıq etibarlı deyil. Rəhbərdən yeni dəvət QR-ı istəyin.'); return;
  }
  if (inv.usedBy && inv.usedBy !== uid) {
    logAttempt({ id: inv.staffId, name: inv.staffName }, null, 'Artıq istifadə olunmuş dəvətlə başqa telefondan cəhd', { model: deviceModel() });
    renderInfo(ICON.x, 'bad', 'Dəvət istifadə olunub', 'Bu dəvət QR-ı artıq başqa telefona qoşulub. Rəhbərdən yeni dəvət istəyin.'); return;
  }
  if ((inv.exp || 0) < now()) {
    renderInfo(ICON.clock, 'wait', 'Dəvətin vaxtı bitib', 'Dəvət QR-ı 10 dəqiqə etibarlıdır. Rəhbərdən yeni dəvət istəyin.'); return;
  }
  const can = await faceIdAvailable();
  const needFace = S.faceId && can;
  setView(`${brand}
    <section class="iz-card">
      <div class="iz-ico iz-ico--gold">${needFace ? ICON.face : ICON.phone}</div>
      <h1>Salam, ${esc(inv.firstname || inv.staffName)}!</h1>
      <p class="iz-p">Bu telefon <b>${esc(inv.staffName)}</b> adına davamiyyət telefonu kimi qoşulacaq.${inv.position ? ` <span class="iz-mut">(${esc(inv.position)})</span>` : ''}</p>
      ${needFace ? '<p class="iz-hint">Hər qeyddə telefon sizin <b>Face ID / barmaq izinizi</b> soruşacaq. Üzünüzün və ya barmağınızın məlumatı sistemə <b>göndərilmir</b>, telefonda qalır.</p>'
        : S.faceId ? '<p class="iz-warn"><span>Bu telefonda Face ID / barmaq izi tapılmadı. Qeydləriniz “orta etibarlı” sayılacaq.</span></p>' : ''}
      <p class="iz-hint">Əvvəlki telefonunuz varsa, o avtomatik bağlanacaq.</p>
      <p id="izRegErr" class="iz-err" role="alert"></p>
      <button id="izBind" class="iz-btn iz-btn--gold" type="button">${needFace ? `${ICON.face} Face ID ilə təsdiqlə və qoş` : `${ICON.check} Bu telefonu qoş`}</button>
      <p class="iz-hint iz-c">Bu siz deyilsinizsə, səhifəni bağlayın.</p>
    </section>`);
  $('izBind').onclick = async () => {
    const btn = $('izBind'); btn.disabled = true; $('izRegErr').textContent = '';
    let cred = null;
    try {
      if (needFace) cred = await faceIdRegister({ name: inv.staffName });
    } catch (e) { $('izRegErr').textContent = faceIdError(e); btn.disabled = false; return; }
    try {
      await bindPhone(code, inv, uid, cred, deviceModel());
    } catch (e) {
      btn.disabled = false;
      $('izRegErr').textContent = /permission/i.test(e?.code || e?.message || '')
        ? 'Qoşulmadı: dəvətin vaxtı bitib və ya istifadə olunub. Rəhbərdən yeni dəvət istəyin.'
        : 'Qoşulmadı. İnterneti yoxlayıb yenidən cəhd edin.';
      return;
    }
    if (navigator.vibrate) navigator.vibrate(60);
    renderInfo(ICON.check, 'ok', 'Telefon qoşuldu', `Hazırdır, <b>${esc(inv.firstname || inv.staffName)}</b>. İndi işə gələndə və çıxanda restorandakı QR-ı bu telefonla oxudun.`,
      { label: 'Davam et', onClick: () => openBound(uid) });
  };
}

const resultOpen = () => !!document.querySelector('.iz-done, .iz-fail');
/* ── 2) Əsas ekran ── */
let tick = null, busy = false;
function renderHome() {
  if (busy || !me) return;
  const ph = phaseOf(myStatus, S);
  const stale = isStale(myStatus, S);
  const st = myStatus || {};
  const needScan = S.qrMode === 'dynamic';
  const scanOk = scanFresh();
  const dis = needScan && !scanOk ? 'disabled' : '';
  const stateBox = ph === 'in'
    ? `<div class="iz-state is-in"><span class="iz-dot"></span> İşdəsiniz · ${fmtDT(shiftStart(st))}-dən · <b id="izDur" data-t="${shiftStart(st)}">${fmtDur(now() - shiftStart(st))}</b></div>`
    : ph === 'break'
      ? `<div class="iz-state is-brk"><span class="iz-dot"></span><span>Müvəqqəti çıxışdasınız: <b>${esc(breakLabel(st.btype))}</b><br>${esc(st.bnote || '')}<br><small>${fmtDT(st.since)}-dən · <b id="izDur" data-t="${st.since}">${fmtDur(now() - st.since)}</b></small></span></div>`
      : stale ? `<div class="iz-state"><span class="iz-dot"></span> Son çıxışınız qeyd edilməyib (giriş ${fmtDT(shiftStart(st))}). Rəhbərə bildirin.</div>`
        : `<div class="iz-state"><span class="iz-dot"></span> İşdə deyilsiniz${st.since ? ` · son çıxış ${fmtDT(st.since)}` : ''}</div>`;
  const buttons = ph === 'in'
    ? `<button id="izBrk" class="iz-btn iz-btn--big iz-btn--brk" type="button" ${myTables.length ? 'disabled' : dis}>Müvəqqəti çıxış</button>
       <button id="izOut" class="iz-btn iz-btn--out" type="button" ${myTables.length ? 'disabled' : dis}>İşdən çıxdım (günü bitirdim)</button>`
    : ph === 'break'
      ? `<button id="izBack" class="iz-btn iz-btn--big iz-btn--gold" type="button" ${dis}>Qayıtdım</button>`
      : `<button id="izIn" class="iz-btn iz-btn--big iz-btn--gold" type="button" ${dis}>İşə gəldim</button>`;
  setView(`${brand}
    <section class="iz-card iz-home" id="izHome">
      <div class="iz-who">
        <div class="iz-ava iz-ava--x" aria-hidden="true">${initial(me.firstname || me.name)}</div>
        <div><small>Salam,</small><h1>${esc(me.firstname || me.name)}</h1><span>${esc(me.position || '')}</span></div>
      </div>
      <div class="iz-clock"><b id="izClock">${fmtTime(now())}</b><span id="izDate">${fmtDate(now())}</span></div>
      ${stateBox}
      ${dis ? `<p class="iz-warn">${ICON.qr}<span>Qeyd üçün <b>“QR oxu”</b> basın və restorandakı <b>davamiyyət ekranında</b> görünən QR-a tutun.</span></p>
        <button id="izScan" class="iz-btn iz-btn--big iz-btn--gold" type="button">${ICON.qr} QR oxu</button>` : ''}
      ${ph === 'in' && myTables.length ? `<p class="iz-warn">${ICON.x}<span>Sizdə <b>${myTables.length}</b> açıq masa var (${esc(myTables.join(', '))}). İşdən və ya müvəqqəti çıxmaq üçün əvvəlcə masalar başqa ofisianta ötürülməlidir — Rəhbərə və ya növbə müdirinə müraciət edin.</span></p>` : ''}
      ${buttons}
      <ul class="iz-checks" aria-label="Yoxlamalar">
        ${needScan ? `<li>${ICON.qr} Ekrandakı QR</li>` : ''}
        ${S.faceId && myPhone?.credId ? `<li>${ICON.face} Face ID / barmaq izi</li>` : ''}
        ${S.gps ? `<li>${ICON.pin} Restoranın ərazisi (GPS)</li>` : ''}
        ${S.selfie ? `<li>${ICON.cam} Şəkil</li>` : ''}
      </ul>
    </section>
    <section class="iz-card iz-last"><h2>Son qeydlərim</h2><div id="izLast"><p class="iz-hint">Yüklənir…</p></div></section>`);
  $('izIn') && ($('izIn').onclick = () => go('in'));
  $('izOut') && ($('izOut').onclick = () => go('out'));
  $('izBack') && ($('izBack').onclick = () => go('back'));
  $('izBrk') && ($('izBrk').onclick = renderBreakForm);
  $('izScan') && ($('izScan').onclick = inAppScan);
  clearInterval(tick);
  tick = setInterval(() => {
    const c = $('izClock'); if (!c) { clearInterval(tick); return; }
    c.textContent = fmtTime(now()); $('izDate').textContent = fmtDate(now());
    const d = $('izDur'); if (d) d.textContent = fmtDur(now() - (+d.dataset.t || now()));
    if (S.qrMode === 'dynamic' && scan.code && !scanFresh()) renderHome();
  }, 15000);
  loadLast();
}

/* Müvəqqəti çıxış: növ + səbəb */
let brkDraft = { type: 'work', note: '' };
function renderBreakForm() {
  setView(`${brand}
    <section class="iz-card">
      <h1>Müvəqqəti çıxış</h1>
      <p class="iz-hint iz-c">Restorandan müvəqqəti çıxırsınız (bazar, bank, nahar və s.). Qayıdanda yenə QR-ı oxudub <b>“Qayıtdım”</b> basın.</p>
      <div class="iz-radios" role="radiogroup" aria-label="Çıxışın növü">
        ${Object.entries(BREAKS).map(([k, b]) => `<label class="iz-radio"><input type="radio" name="izBt" value="${k}" ${brkDraft.type === k ? 'checked' : ''}>
          <span><b>${esc(b.label)}</b><small>${esc(b.sub)}</small></span></label>`).join('')}
      </div>
      <label class="iz-f iz-f--txt"><span>Səbəb</span>
        <textarea id="izNote" rows="2" maxlength="200" placeholder="məs. bazara ərzaq almağa">${esc(brkDraft.note)}</textarea></label>
      <p id="izBrkErr" class="iz-err" role="alert"></p>
      <button id="izBrkGo" class="iz-btn iz-btn--gold iz-btn--big" type="button">Çıxışı qeyd et</button>
      <button id="izBrkX" class="iz-btn iz-btn--ghost iz-btn--icon" type="button" aria-label="Geri" title="Geri">${ICON.back}</button>
    </section>`);
  $('izBrkX').onclick = () => renderHome();
  $('izBrkGo').onclick = () => {
    brkDraft = { type: (document.querySelector('input[name="izBt"]:checked') || {}).value || 'work', note: $('izNote').value.trim() };
    if (brkDraft.note.length < 3) { $('izBrkErr').textContent = 'Səbəbi qısaca yazın.'; $('izNote').focus(); return; }
    go('break', brkDraft);
  };
}

async function loadLast() {
  let list = [];
  try {
    const snap = await A('sessions').orderByChild('staffId').equalTo(me.id).limitToLast(5).once('value');
    snap.forEach(c => { list.push({ id: c.key, ...c.val() }); });
    list.sort((a, b) => (b.inAt || 0) - (a.inAt || 0));
  } catch (e) { list = []; }
  const box = $('izLast'); if (!box) return;
  box.innerHTML = list.length ? `<ul class="iz-list">${list.map(x => {
      const br = breakList(x);
      return `<li><div><b>${fmtDT(x.inAt)}</b><span>→ ${x.outAt ? fmtDT(x.outAt) : x.forgot ? 'çıxış qeyd edilməyib' : 'davam edir'}</span>
        ${br.map(b => `<small class="iz-brk">${esc(breakLabel(b.type))}: ${fmtTime(b.from)}–${b.to ? fmtTime(b.to) : '…'} · ${esc(b.note || '')}</small>`).join('')}</div>
      <em>${x.outAt ? fmtDur(workedMs(x)) : ''}</em></li>`;
    }).join('')}</ul>`
    : '<p class="iz-hint">Hələ qeyd yoxdur.</p>';
}

/* ── 3) Qeyd axını ── */
function step(title, sub = '') {
  setView(`${brand}<section class="iz-card iz-step"><div class="iz-spin"></div><h1>${esc(title)}</h1>${sub ? `<p class="iz-p">${sub}</p>` : ''}</section>`);
}
const DOING = { in: 'Giriş qeyd olunur…', out: 'Çıxış qeyd olunur…', break: 'Müvəqqəti çıxış qeyd olunur…', back: 'Qayıdış qeyd olunur…' };
async function go(action, brk = null) {
  if (busy) return;
  busy = true;
  const meta = { method: 'qr', qr: S.qrMode, qrCode: S.qrMode === 'dynamic' ? scan.code : null, faceId: false, gps: null, model: deviceModel(), photo: false };
  try {
    // 0) Açıq masası olan işçi işdən / müvəqqəti çıxa bilməz
    if ((action === 'out' || action === 'break') && myTables.length) {
      throw new Error(`Sizdə ${myTables.length} açıq masa var (${myTables.join(', ')}). Əvvəlcə masalar başqa ofisianta ötürülməlidir.`);
    }
    // a) Dəyişən QR (son yoxlamanı baza özü edir)
    if (S.qrMode === 'dynamic' && !scanFresh()) {
      throw Object.assign(new Error('QR kodun vaxtı bitib. Ekrandakı QR-ı yenidən oxudun.'), { log: 'QR kodu köhnədir' });
    }
    // b) Face ID — düyməyə basılan anda ilk addım olmalıdır (iPhone bunu tələb edir)
    if (S.faceId && myPhone?.credId) {
      try { await faceIdVerify(myPhone.credId); meta.faceId = true; }
      catch (e) { throw Object.assign(new Error(faceIdError(e)), { log: 'Face ID təsdiqlənmədi' }); }
    }
    // c) GPS
    if (S.gps) {
      if (S.lat == null || S.lng == null) {
        meta.gps = { ok: false, skipped: true };
      } else {
        step('Yeriniz yoxlanılır…', 'Telefon yer icazəsi istəsə, “İcazə ver” basın.');
        let p;
        try { p = await getPosition(); } catch (e) { throw Object.assign(e, { log: 'Yer təyin edilmədi' }); }
        const dist = distanceM(p.lat, p.lng, S.lat, S.lng);
        const ok = dist <= S.radius + Math.min(p.acc, 100);
        meta.gps = { ok, dist, acc: p.acc, lat: +p.lat.toFixed(5), lng: +p.lng.toFixed(5) };
        if (!ok) {
          throw Object.assign(new Error(`Restoranın ərazisində deyilsiniz (məsafə: ${dist >= 1000 ? (dist / 1000).toFixed(1) + ' km' : dist + ' m'}). Restorana çatanda yenidən cəhd edin.`),
            { log: `Ərazidən kənarda: ${dist} m (dəqiqlik ±${p.acc} m)` });
        }
      }
    }
    // d) Selfi (yalnız giriş və çıxışda)
    let photo = null;
    if (S.selfie && (action === 'in' || action === 'out')) {
      photo = await takeSelfie();
      if (!photo) throw Object.assign(new Error('Şəkil çəkilmədi. Kamera icazəsi verib yenidən cəhd edin.'), { log: 'Şəkil çəkilmədi' });
      meta.photo = true;
    }
    // e) Masaları son dəfə yoxla (bu arada masa açılmış ola bilər)
    if (action === 'out' || action === 'break') {
      const open = []; (await adb.ref('tables').orderByChild('occupant').equalTo(me.id).once('value')).forEach(c => { open.push(c.val()?.name || c.key); });
      if (open.length) throw new Error(`Sizdə ${open.length} açıq masa var (${open.join(', ')}). Əvvəlcə masalar başqa ofisianta ötürülməlidir.`);
    }
    // f) Yazılış (saatı server qoyur)
    step(DOING[action]);
    const r = await clock(me, meta, { photo, action, brk });
    scan.code = null; // eyni QR ilə ikinci qeyd olmasın
    if (action === 'break') brkDraft = { type: 'work', note: '' };
    busy = false;
    renderDone(r);
  } catch (e) {
    busy = false;
    if (e.log) logAttempt(me, action, e.log, { gps: meta.gps || null, model: meta.model });
    renderFail(e.message || String(e));
  }
}
const DONE = { in: 'İşə gəldiniz', out: 'İşdən çıxdınız', break: 'Müvəqqəti çıxış qeyd edildi', back: 'Xoş gəldiniz, qayıdış qeyd edildi' };
function renderDone(r) {
  const t = TRUST[r.trust] || TRUST.medium;
  const toPos = r.kind === 'in' || r.kind === 'back';
  let autoPos = false; try { autoPos = toPos && localStorage.getItem('yzPosPhone') === '1'; } catch (e) { /* */ }
  setView(`${brand}
    <section class="iz-card iz-done">
      <div class="iz-ico iz-ico--ok">${ICON.check}</div>
      <h1>${DONE[r.kind] || 'Qeyd edildi'}</h1>
      <p class="iz-big">${fmtTime(now())}</p>
      <p class="iz-p">${fmtDate(now())} · ${esc(me.name)}</p>
      ${r.kind === 'break' ? '<p class="iz-hint iz-c">Qayıdanda ekrandakı QR-ı oxudub <b>“Qayıtdım”</b> basmağı unutmayın.</p>' : ''}
      <span class="iz-chip iz-chip--${t.cls}">${t.label} qeyd</span>
      ${toPos ? `<a id="izPos" class="iz-btn iz-btn--gold" style="text-decoration:none;box-sizing:border-box;margin-top:12px" href="${BASE}index.html">Sistemə daxil ol (PIN)</a>${autoPos ? '<p class="iz-hint iz-c">PIN ekranı açılır…</p>' : ''}` : ''}
      <button id="izOk" class="iz-btn iz-btn--ghost iz-btn--icon" type="button" aria-label="Bağla" title="Bağla">${ICON.x}</button>
    </section>`);
  if (navigator.vibrate) navigator.vibrate(60);
  const back = () => renderHome();
  $('izOk').onclick = back;
  // İşə gəlib / qayıdıb: bu telefonda əvvəl sistemə girilibsə, PIN ekranı özü açılır
  if (autoPos) { setTimeout(() => { if ($('izPos')) location.href = BASE + 'index.html'; }, 2500); return; }
  setTimeout(() => { if ($('izOk')) back(); }, toPos ? 15000 : 6000);
}
function renderFail(msg) {
  setView(`${brand}
    <section class="iz-card iz-fail">
      <div class="iz-ico iz-ico--bad">${ICON.x}</div>
      <h1>Qeyd alınmadı</h1>
      <p class="iz-p">${esc(msg)}</p>
      <button id="izAgain" class="iz-btn iz-btn--gold iz-btn--icon" type="button" aria-label="Geri" title="Geri">${ICON.back}</button>
    </section>`);
  if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
  $('izAgain').onclick = () => renderHome();
}

/* ── Selfi: ön kamera, kiçildilmiş şəkil (~20 KB) ── */
function takeSelfie() {
  return new Promise(async (resolve) => {
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } }, audio: false }); }
    catch (e) { resolve(null); return; }
    setView(`${brand}
      <section class="iz-card iz-cam">
        <h1>Şəkil</h1>
        <div class="iz-cam__box"><video id="izVid" playsinline autoplay muted></video></div>
        <button id="izShot" class="iz-btn iz-btn--gold iz-btn--big" type="button">${ICON.cam} Çək</button>
        <button id="izShotX" class="iz-btn iz-btn--ghost" type="button">Ləğv</button>
      </section>`);
    const v = $('izVid'); v.srcObject = stream;
    const stop = () => stream.getTracks().forEach(t => t.stop());
    $('izShotX').onclick = () => { stop(); resolve(null); };
    $('izShot').onclick = () => {
      const w = 240, h = Math.round(w * ((v.videoHeight || 4) / (v.videoWidth || 3)));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); g.translate(w, 0); g.scale(-1, 1); g.drawImage(v, 0, 0, w, h);
      stop(); resolve(c.toDataURL('image/jpeg', 0.6));
    };
  });
}

/* ═══════════════ EKRAN REJİMİ (?ekran=1) — restoran cihazı ═══════════════ */
const KIOSK_KEY = 'yzAttKiosk';
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* */ } }
async function adminPin() { return String((await db.ref('settings/adminPin').once('value')).val() || ''); }
/* Rəhbər hesabı (e-poçt + parol) aktivdirsə Rəhbər PIN-i burada da işləmir — Rəhbər parolu soruşulur */
const ownerOn = () => { try { return typeof firebase.auth === 'function' && !!firebase.app().options.apiKey; } catch (e) { return false; } };
async function rehberVerify(text) {
  try { const O = await import('./yuza-owner.js'); return await O.ownerVerify({ title: 'Rəhbər təsdiqi', text }); }
  catch (e) { return false; }
}
const isAdminPin = async (v) => !ownerOn() && v === await adminPin();
async function staffList() {
  const snap = await db.ref('staff').once('value');
  const o = snap.val() || {};
  return Object.keys(o).map(id => ({ id, ...o[id] })).filter(x => x && x.name);
}

function pinPad({ title, sub = '', onDone, extra = null }) {
  const wrap = document.createElement('div');
  wrap.className = 'iz-pad-bg';
  wrap.innerHTML = `<div class="iz-pad" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <h2>${esc(title)}</h2>${sub ? `<p class="iz-hint">${esc(sub)}</p>` : ''}
    <div class="iz-dots" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
    <p class="iz-err" role="alert"></p>
    <div class="iz-keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 'C', 0, '⌫'].map(k => `<button type="button" data-k="${k}">${k}</button>`).join('')}</div>
    ${extra ? `<button type="button" class="iz-btn iz-btn--ghost" data-extra>${esc(extra.label)}</button>` : ''}
    <button type="button" class="iz-btn iz-btn--ghost iz-btn--icon" data-x aria-label="Bağla" title="Bağla">${ICON.x}</button></div>`;
  document.body.appendChild(wrap);
  let buf = '', fails = 0, lockUntil = 0;
  const dots = () => wrap.querySelectorAll('.iz-dots i').forEach((d, i) => d.classList.toggle('on', i < buf.length));
  const err = (m) => { wrap.querySelector('.iz-err').textContent = m; buf = ''; dots(); };
  const close = () => { wrap.remove(); document.removeEventListener('keydown', kb); };
  const press = async (k) => {
    if (Date.now() < lockUntil) { err(`Çox səhv cəhd. ${fmtTime(lockUntil)}-dən sonra yoxlayın.`); return; }
    if (k === 'C') { buf = ''; dots(); return; }
    if (k === '⌫') { buf = buf.slice(0, -1); dots(); return; }
    if (buf.length >= 4) return;
    buf += k; dots();
    if (buf.length === 4) {
      const v = buf; const r = await onDone(v, close);
      if (r !== true) {
        fails++;
        if (fails >= 5) { fails = 0; lockUntil = Date.now() + 60000; logAttempt(null, null, 'Davamiyyət ekranında 5 dəfə səhv PIN', { model: 'Restoran ekranı' }); }
        err(r || 'PIN səhvdir');
      }
    }
  };
  const kb = (e) => { if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('⌫'); else if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', kb);
  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]'); if (b) press(b.dataset.k);
    if (e.target.closest('[data-x]')) close();
    if (e.target.closest('[data-extra]') && extra) extra.onClick(close);
  });
  return { close };
}

async function startKiosk() {
  await settingsReady;
  if (lsGet(KIOSK_KEY) !== '1') {
    setView(`${brand}<section class="iz-card"><div class="iz-ico iz-ico--gold">${ICON.clock}</div>
      <h1>Davamiyyət ekranı</h1><p class="iz-p">Bu cihazı restoranın davamiyyət ekranı etmək üçün <b>${ownerOn() ? 'Rəhbər parolu' : 'Rəhbər PIN'}</b>-i lazımdır.</p>
      <button id="izKAuth" class="iz-btn iz-btn--gold" type="button">${ownerOn() ? 'Rəhbər parolunu daxil et' : 'Rəhbər PIN-i daxil et'}</button></section>`);
    if (ownerOn()) {
      $('izKAuth').onclick = async () => { if (await rehberVerify('Bu cihazı davamiyyət ekranı etmək üçün Rəhbər parolunu yazın.')) { lsSet(KIOSK_KEY, '1'); startKiosk(); } };
      return;
    }
    $('izKAuth').onclick = () => pinPad({ title: 'Rəhbər PIN', onDone: async (v, close) => {
      if (v !== await adminPin()) return 'PIN səhvdir';
      lsSet(KIOSK_KEY, '1'); close(); startKiosk(); return true;
    } });
    return;
  }
  renderKiosk();
  onSettings = () => renderKiosk();
  keepAwake();
}

let qrTimer = null, kTick = null, kStaff = [], kStatus = {}, statusRef = null;
const ROTATE = 15000;
async function renderKiosk() {
  try { kStaff = await staffList(); } catch (e) { kStaff = []; }
  const dyn = S.qrMode === 'dynamic';
  setView(`<div class="iz-kiosk">
    <header class="iz-k-head">${brand}<button id="izKExit" class="iz-btn iz-btn--ghost iz-btn--sm iz-btn--icon" type="button" aria-label="Ekrandan çıx" title="Ekrandan çıx">${ICON.logout}</button></header>
    <div class="iz-k-main">
      <section class="iz-k-qr">
        <div class="iz-k-clock"><b id="izKClock">${fmtTime(now())}</b><span id="izKDate">${fmtDate(now())}</span></div>
        <div id="izQrBox" class="iz-qrbox" aria-label="Davamiyyət QR kodu"></div>
        ${dyn ? '<div class="iz-bar"><i id="izBar"></i></div>' : ''}
        <p class="iz-p">Telefonunuzda YuZa davamiyyət səhifəsini açın, <b>“QR oxu”</b> basıb bu QR-a tutun və <b>“İşə gəldim”</b> basın.</p>
        <div class="iz-k-btns"><button id="izKProxy" class="iz-btn iz-btn--ghost" type="button">Smartfonu olmayan işçinin qeydi</button>
          <button id="izKBind" class="iz-btn iz-btn--ghost" type="button">Telefon aktivləşdir (Rəhbər / səlahiyyətli)</button></div>
      </section>
      <section class="iz-k-list"><h2>İndi işdə <span id="izKCount">0</span></h2><ul id="izKWho" class="iz-list"></ul>
        <h2 class="iz-k-sub">Müvəqqəti çıxışda <span id="izKBCount">0</span></h2><ul id="izKBrk" class="iz-list"></ul></section>
    </div></div>`);
  const leaveKiosk = () => { lsSet(KIOSK_KEY, null); clearInterval(qrTimer); clearInterval(kTick); location.href = BASE + 'index.html'; };
  if (ownerOn()) $('izKExit').onclick = async () => { if (await rehberVerify('Ekran rejimindən çıxmaq üçün Rəhbər parolunu yazın.')) leaveKiosk(); };
  else $('izKExit').onclick = () => pinPad({ title: 'Rəhbər PIN', sub: 'Ekran rejimindən çıxmaq üçün', onDone: async (v, close) => {
    if (v !== await adminPin()) return 'PIN səhvdir';
    lsSet(KIOSK_KEY, null); close(); clearInterval(qrTimer); clearInterval(kTick); location.href = BASE + 'index.html'; return true;
  } });
  $('izKBind').onclick = kioskActivate;
  $('izKProxy').onclick = kioskProxy;
  clearInterval(qrTimer); clearInterval(kTick);
  if (dyn) { rotateQr(); qrTimer = setInterval(rotateQr, ROTATE); }
  else drawQr(IZLE_URL);
  kTick = setInterval(() => {
    const c = $('izKClock'); if (!c) return;
    c.textContent = fmtTime(now()); $('izKDate').textContent = fmtDate(now()); renderWho();
  }, 20000);
  if (!statusRef) { statusRef = A('status'); statusRef.on('value', s => { kStatus = s.val() || {}; renderWho(); }); }
  renderWho();
}
function drawQr(text) {
  const box = $('izQrBox'); if (!box) return;
  box.innerHTML = '';
  // eslint-disable-next-line no-undef
  new QRCode(box, { text, width: 260, height: 260, colorDark: '#0b0d10', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
}
/* Hər 15 saniyədə yeni kod: baza onu "att/qrs"-də 2 dəqiqə saxlayır.
   İşçinin qeydi yalnız bu siyahıdakı təzə kodla qəbul olunur — QR-ın şəkli evdə işləmir. */
async function rotateQr() {
  const code = newCode(12);
  try {
    await A('qrs/' + code).set(TS);
    const snap = await A('qrs').once('value');
    const up = {}; const old = now() - 5 * 60000;
    snap.forEach(c => { if ((c.val() || 0) < old) up[c.key] = null; });
    if (Object.keys(up).length) A('qrs').update(up).catch(() => {});
  } catch (e) { return; /* internet yoxdursa köhnə QR qalır */ }
  drawQr(IZLE_URL + '?k=' + code);
  const bar = $('izBar');
  if (bar) { bar.style.transition = 'none'; bar.style.width = '100%'; void bar.offsetWidth; bar.style.transition = `width ${ROTATE}ms linear`; bar.style.width = '0%'; }
}
function renderWho() {
  const ul = $('izKWho'); if (!ul) return;
  const ph = (s) => phaseOf(kStatus[s.id], S);
  const ins = kStaff.filter(s => ph(s) === 'in').sort((a, b) => shiftStart(kStatus[a.id]) - shiftStart(kStatus[b.id]));
  const brs = kStaff.filter(s => ph(s) === 'break').sort((a, b) => (kStatus[a.id].since || 0) - (kStatus[b.id].since || 0));
  $('izKCount').textContent = ins.length;
  ul.innerHTML = ins.length ? ins.map(s => `<li><div><b>${esc(s.name)}</b><span>${esc(s.position || '')}</span></div><em>${fmtDT(shiftStart(kStatus[s.id]))}</em></li>`).join('')
    : '<li class="iz-hint">Hələ heç kim qeyd etməyib.</li>';
  $('izKBCount').textContent = brs.length;
  $('izKBrk').innerHTML = brs.length ? brs.map(s => { const st = kStatus[s.id]; return `<li><div><b>${esc(s.name)}</b><span>${esc(breakLabel(st.btype))} · ${esc(st.bnote || '')}</span></div><em>${fmtDT(st.since)}</em></li>`; }).join('')
    : '<li class="iz-hint">Yoxdur.</li>';
}
/* ═══ Telefon aktivləşdirmə: yalnız Rəhbər və ya "İşçi telefonunu aktivləşdirmək" icazəsi olan şəxs ═══
   Telefonsuz (PIN ilə) davamiyyət qeydi YOXDUR: PIN-i bilən başqası işçinin əvəzinə qeyd edə bilərdi. */
function kioskActivate() {
  pinPad({ title: 'Telefon aktivləşdir', sub: ownerOn() ? 'Səlahiyyətli şəxsin öz PIN-i' : 'Rəhbərin və ya səlahiyyətli şəxsin öz PIN-i',
    extra: ownerOn() ? { label: 'Rəhbər parolu ilə', onClick: async (close) => { close(); if (await rehberVerify('Telefonu aktivləşdirmək üçün Rəhbər parolunu yazın.')) pickWorker({ id: 'admin', name: 'Rəhbər' }); } } : null,
    onDone: async (v, close) => {
    let actor = null;
    if (await isAdminPin(v)) actor = { id: 'admin', name: 'Rəhbər' };
    else {
      const s = kStaff.find(x => String(x.pin) === v && x.status !== 'offline');
      if (s && (s.permissions || []).includes('att.bind')) actor = { id: s.id, name: s.name };
    }
    if (!actor) return 'PIN səhvdir və ya bu şəxsin icazəsi yoxdur';
    close();
    pickWorker(actor);
    return true;
  } });
}
/* ═══ Smartfonu olmayan işçi: yalnız Rəhbər və ya "att.manual" icazəli şəxs, ÖZ PIN-i ilə, səbəb yazaraq.
   Yalnız işçi kartında "Smartfonu yoxdur" işarələnmiş işçilər üçün. Qeyd "Səlahiyyətli şəxs — Ad" kimi düşür. */
function kioskProxy() {
  pinPad({ title: 'Telefonsuz işçi qeydi', sub: ownerOn() ? 'Səlahiyyətli şəxsin öz PIN-i' : 'Rəhbərin və ya səlahiyyətli şəxsin öz PIN-i',
    extra: ownerOn() ? { label: 'Rəhbər parolu ilə', onClick: async (close) => { close(); if (await rehberVerify('Telefonsuz işçinin qeydi üçün Rəhbər parolunu yazın.')) proxyPick({ id: 'admin', name: 'Rəhbər' }); } } : null,
    onDone: async (v, close) => {
    let actor = null;
    if (await isAdminPin(v)) actor = { id: 'admin', name: 'Rəhbər' };
    else {
      const s = kStaff.find(x => String(x.pin) === v && x.status !== 'offline');
      if (s && (s.permissions || []).includes('att.manual')) actor = { id: s.id, name: s.name };
    }
    if (!actor) return 'PIN səhvdir və ya bu şəxsin icazəsi yoxdur';
    close();
    proxyPick(actor);
    return true;
  } });
}
/* Telefonsuz işçinin seçimi (PIN və ya Rəhbər parolu ilə təsdiqdən sonra) */
function proxyPick(actor) {
    const list = kStaff.filter(x => x.attNoPhone && x.status !== 'offline').sort((a, b) => String(a.name).localeCompare(String(b.name), 'az'));
    const box = document.createElement('div');
    box.className = 'iz-pad-bg';
    box.innerHTML = `<div class="iz-pad iz-pad--wide" role="dialog" aria-modal="true" aria-label="İşçini seçin">
      <h2>Kimi qeyd edirsiniz?</h2><p class="iz-hint">Qeyd edən: <b>${esc(actor.name)}</b>. Siyahıda yalnız “Smartfonu yoxdur” işarələnmiş işçilər var.</p>
      <div class="iz-pick">${list.map(x => { const ph = phaseOf(kStatus[x.id], S); return `<button type="button" class="iz-pick__i" data-sid="${esc(x.id)}">
        <b>${esc(x.name)}</b><small>${esc(x.position || '')} · ${ph === 'in' ? 'işdədir' : ph === 'break' ? 'müvəqqəti çıxışdadır' : 'işdə deyil'}</small></button>`; }).join('') || '<p class="iz-hint">Belə işçi yoxdur. Rəhbər işçi kartında “Smartfonu yoxdur” seçimini işarələməlidir.</p>'}</div>
      <button type="button" class="iz-btn iz-btn--ghost iz-btn--icon" data-x aria-label="Bağla" title="Bağla">${ICON.x}</button></div>`;
    document.body.appendChild(box);
    const t = setTimeout(() => box.remove(), 120000);
    box.addEventListener('click', (e) => {
      if (e.target.closest('[data-x]')) { clearTimeout(t); box.remove(); return; }
      const b = e.target.closest('[data-sid]'); if (!b) return;
      clearTimeout(t); box.remove();
      proxyActions(kStaff.find(x => x.id === b.dataset.sid), actor);
    });
}
async function proxyActions(s, actor) {
  if (!s) return;
  let st = null;
  try { st = (await A('status/' + s.id).once('value')).val(); } catch (e) { /* */ }
  const ph = phaseOf(st, S);
  const box = document.createElement('div');
  box.className = 'iz-pad-bg';
  box.innerHTML = `<div class="iz-pad iz-pad--wide" role="dialog" aria-modal="true" aria-label="${esc(s.name)}">
    <h2>${esc(s.name)}</h2>
    <p class="iz-hint">${ph === 'in' ? `İşdədir · ${fmtDT(shiftStart(st))}-dən` : ph === 'break' ? `Müvəqqəti çıxışdadır: ${esc(breakLabel(st.btype))} · ${fmtDT(st.since)}-dən` : 'İşdə deyil'}</p>
    ${ph === 'off' ? '<button type="button" class="iz-btn iz-btn--gold iz-btn--big" data-a="in">İşə gəldi</button>' : ''}
    ${ph === 'break' ? '<button type="button" class="iz-btn iz-btn--gold iz-btn--big" data-a="back">Qayıtdı</button>' : ''}
    ${ph === 'in' ? `<div class="iz-radios">${Object.entries(BREAKS).map(([k, b], i) => `<label class="iz-radio"><input type="radio" name="izPBt" value="${k}" ${i ? '' : 'checked'}><span><b>${esc(b.label)}</b><small>${esc(b.sub)}</small></span></label>`).join('')}</div>
      <label class="iz-f iz-f--txt"><span>Müvəqqəti çıxışın səbəbi</span><textarea id="izPNote" rows="2" maxlength="200" placeholder="məs. bazara getdi"></textarea></label>
      <button type="button" class="iz-btn iz-btn--brk" data-a="break">Müvəqqəti çıxdı</button>
      <button type="button" class="iz-btn iz-btn--out" data-a="out">İşdən çıxdı (günün sonu)</button>` : ''}
    <p class="iz-err" role="alert"></p>
    <button type="button" class="iz-btn iz-btn--ghost iz-btn--icon" data-x aria-label="Bağla" title="Bağla">${ICON.x}</button></div>`;
  document.body.appendChild(box);
  const errEl = box.querySelector('.iz-err');
  box.addEventListener('click', async (e) => {
    if (e.target.closest('[data-x]')) { box.remove(); return; }
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a;
    let brk = null;
    if (a === 'break') {
      const note = box.querySelector('#izPNote').value.trim();
      if (note.length < 3) { errEl.textContent = 'Səbəbi qısaca yazın.'; return; }
      brk = { type: box.querySelector('input[name="izPBt"]:checked').value, note };
    }
    if (a === 'out' || a === 'break') {
      const open = []; try { (await db.ref('tables').orderByChild('occupant').equalTo(s.id).once('value')).forEach(c => { open.push(c.val()?.name || c.key); }); } catch (x) { /* */ }
      if (open.length) { errEl.textContent = `${open.length} açıq masa var (${open.join(', ')}). Əvvəlcə masalar ötürülməlidir.`; return; }
    }
    b.disabled = true;
    try {
      const r = await clock(s, { method: 'proxy', by: actor.name, byId: actor.id, qr: null, faceId: false, gps: null, model: 'Davamiyyət ekranı' }, { action: a, brk });
      A('audit').push({ at: TS, by: actor.name + ' (davamiyyət ekranı)', action: 'Telefonsuz qeyd: ' + ACTION_LABEL[r.kind], staffId: s.id, staffName: s.name, after: brk ? { model: `${breakLabel(brk.type)}: ${brk.note}` } : {} }).catch(() => {});
      box.remove(); flash(s.name, ACTION_LABEL[r.kind] + ' · qeyd edən: ' + actor.name);
    } catch (x) { b.disabled = false; errEl.textContent = x.message; }
  });
  setTimeout(() => { if (box.isConnected) box.remove(); }, 120000);
}

async function pickWorker(actor) {
  let dev = {};
  try { dev = (await A('devices').once('value')).val() || {}; } catch (e) { /* */ }
  const list = kStaff.filter(x => x.status !== 'offline').sort((a, b) => String(a.name).localeCompare(String(b.name), 'az'));
  const box = document.createElement('div');
  box.className = 'iz-pad-bg';
  box.innerHTML = `<div class="iz-pad iz-pad--wide" role="dialog" aria-modal="true" aria-label="İşçini seçin">
    <h2>Kimin telefonu?</h2><p class="iz-hint">Aktivləşdirən: <b>${esc(actor.name)}</b></p>
    <div class="iz-pick">${list.map(x => { const a = dev[x.id]?.approved; return `<button type="button" class="iz-pick__i" data-sid="${esc(x.id)}">
      <b>${esc(x.name)}</b><small>${esc(x.position || '')}${a?.uid ? ' · telefon: ' + esc(a.model || 'var') + ' (dəyişəcək)' : ' · telefon yoxdur'}</small></button>`; }).join('') || '<p class="iz-hint">İşçi yoxdur.</p>'}</div>
    <button type="button" class="iz-btn iz-btn--ghost iz-btn--icon" data-x aria-label="Bağla" title="Bağla">${ICON.x}</button></div>`;
  document.body.appendChild(box);
  const t = setTimeout(() => box.remove(), 120000);
  box.addEventListener('click', (e) => {
    if (e.target.closest('[data-x]')) { clearTimeout(t); box.remove(); return; }
    const b = e.target.closest('[data-sid]'); if (!b) return;
    clearTimeout(t); box.remove();
    showInvite(kStaff.find(x => x.id === b.dataset.sid), actor);
  });
}
async function showInvite(s, actor) {
  if (!s) return;
  let code;
  try { code = await createInvite(s, actor.name); } catch (e) { toast('Alınmadı, yenidən cəhd edin'); return; }
  let before = null;
  try { before = (await A('devices/' + s.id + '/approved/uid').once('value')).val(); } catch (e) { /* */ }
  const exp = now() + INVITE_MIN * 60000;
  const box = document.createElement('div');
  box.className = 'iz-pad-bg';
  box.innerHTML = `<div class="iz-pad iz-pad--wide" role="dialog" aria-modal="true" aria-label="Telefon aktivləşdir">
    <h2>${esc(s.name)}</h2>
    <p class="iz-hint">Bu QR-ı <b>${esc(s.firstname || s.name)}</b> öz telefonunun kamerası ilə oxutsun. ${before ? 'Köhnə telefon avtomatik bağlanacaq.' : ''}</p>
    <div class="iz-qrbox iz-qrbox--c" id="izInvBox"></div>
    <p class="iz-hint">Qalan vaxt: <b id="izInvLeft">${INVITE_MIN}:00</b> · aktivləşdirən: ${esc(actor.name)}</p>
    <button type="button" class="iz-btn iz-btn--ghost iz-btn--icon" data-x aria-label="Bağla" title="Bağla">${ICON.x}</button></div>`;
  document.body.appendChild(box);
  // eslint-disable-next-line no-undef
  new QRCode(box.querySelector('#izInvBox'), { text: IZLE_URL + '?inv=' + code, width: 240, height: 240, colorDark: '#0b0d10', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
  const ref = A('devices/' + s.id + '/approved');
  let done = false, t = null, cb = null;
  const end = () => { clearInterval(t); if (cb) ref.off('value', cb); box.remove(); if (!done) A('invites/' + code).remove().catch(() => {}); };
  cb = ref.on('value', (snap) => {
    const a = snap.val();
    if (!a || !a.uid || a.uid === before) return;
    done = true;
    if (before) A('phones/' + before).remove().catch(() => {});
    A('audit').push({ at: TS, by: actor.name + ' (davamiyyət ekranı)', action: before ? 'Telefon dəyişdirildi' : 'Telefon aktivləşdirildi', staffId: s.id, staffName: s.name, after: { model: a.model || '', faceId: !!a.credId } }).catch(() => {});
    setTimeout(() => { end(); flash(s.name, 'Telefon aktivləşdirildi'); }, 0);
  });
  t = setInterval(() => {
    const left = Math.max(0, exp - now());
    const el = box.querySelector('#izInvLeft'); if (el) el.textContent = `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`;
    if (!left) end();
  }, 1000);
  box.querySelector('[data-x]').onclick = end;
}
function flash(name, what) {
  const d = document.createElement('div');
  d.className = 'iz-flash';
  d.innerHTML = `<div class="iz-ico iz-ico--ok">${ICON.check}</div><h1>${esc(name)}</h1><p>${esc(what)} · ${fmtDT(now())}</p>`;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 3500);
}
async function keepAwake() {
  try {
    let lock = await navigator.wakeLock?.request('screen');
    document.addEventListener('visibilitychange', async () => { if (document.visibilityState === 'visible') lock = await navigator.wakeLock?.request('screen'); });
  } catch (e) { /* dəstəklənmir */ }
}

/* ── Başlanğıc ── */
window.addEventListener('error', (e) => toast('Xəta: ' + (e.message || '')));
if (params.get('ekran') === '1') startKiosk(); else startWorker();
