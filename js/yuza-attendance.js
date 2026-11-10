/* ═══════════════════════════════════════════
   YUZA POS — PERSONAL İZLƏMƏ: RƏHBƏR PANELİ
   index.html-də yalnız bu fayl qoşulur. Sol menyuya "Personal" qrupunu,
   admin panelinə "sec-att" bölməsini özü əlavə edir. Mövcud kodu dəyişmir.
   Geri qaytarmaq: index.html-dən bu <script> sətrini silmək kifayətdir.

   Bölmələr: Canlı · Hesabat · Tabel · Telefonlar · Şübhəli cəhdlər · Jurnal · Ayarlar
═══════════════════════════════════════════ */
import { state } from './state.js';
import { modal, confirmBox, ok, fail } from './yuza-inv-ui.js';
import {
  A, TS, withDefaults, now, fmtDT, fmtTime, fmtDate, fmtDur, hoursNum, isStale, getPosition,
  TRUST, METHOD, recomputeStatus, createInvite, cleanupInvites, INVITE_MIN,
  phaseOf, shiftStart, BREAKS, breakLabel, breakList, workedMs
} from './yuza-att-core.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const I = (id) => `<svg class="icon"><use href="#i-${id}"></use></svg>`;
const BASE = location.origin + location.pathname.replace(/[^/]*$/, '');
const IZLE_URL = BASE + 'izle.html';
const KIOSK_URL = IZLE_URL + '?ekran=1';
const DAY = 86400000;
const PATRON = 'Rəhbər';

/* ── Canlı məlumat ── */
const D = { settings: withDefaults(null), status: {}, devices: {}, today: [], attemptsToday: 0, started: false };
const staffAll = () => (state.staff || []).filter(s => s && s.name);
const staffById = (id) => staffAll().find(s => s.id === id);
const phoneOf = (sid) => { const a = D.devices[sid]?.approved; return a && a.uid ? a : null; };   // köhnə üsulla (uid-siz) qeydlər sayılmır
const noPhoneCount = () => staffAll().filter(s => !phoneOf(s.id) && !s.attNoPhone).length;
const dayStart = (t = now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

let subs = [];
function start() {
  if (D.started) return;
  D.started = true;
  const on = (ref, cb) => { ref.on('value', cb, () => {}); subs.push(() => ref.off('value', cb)); };
  on(A('settings'), s => { D.settings = withDefaults(s.val()); redraw('settings'); });
  on(A('status'), s => { D.status = s.val() || {}; redraw('live'); });
  on(A('devices'), s => { D.devices = s.val() || {}; redraw('devices'); });
  on(A('sessions').orderByChild('inAt').startAt(dayStart()), s => {
    D.today = []; s.forEach(c => { D.today.push({ id: c.key, ...c.val() }); }); redraw('live');
  });
  on(A('attempts').orderByChild('at').startAt(dayStart()), s => { D.attemptsToday = s.numChildren(); badge(); redraw('live'); });
  cleanupPhotos();
  cleanupInvites();
}
function stop() { subs.forEach(f => f()); subs = []; D.started = false; }

async function cleanupPhotos() {
  try {
    const days = Math.max(7, +D.settings.photoDays || 60);
    const snap = await A('photos').orderByChild('at').endAt(now() - days * DAY).limitToFirst(200).once('value');
    const up = {}; snap.forEach(c => { up[c.key] = null; });
    if (Object.keys(up).length) await A('photos').update(up);
  } catch (e) { /* qayda indeksi yoxdursa sakit keç */ }
}

function audit(action, details = {}) {
  return A('audit').push({ at: TS, by: state.user?.name || PATRON, action, ...details });
}

/* ── Menyu və bölmə ── */
function ensureMenu() {
  const box = $('adminTabsContainer');
  if (!box || $('yzAttTab')) return !!box;
  const grp = document.createElement('div');
  grp.className = 'ap-group'; grp.dataset.group = 'att';
  grp.innerHTML = `<button class="ap-group__header" type="button" onclick="apToggleGroup(this)">
      <svg class="icon ap-group__icon"><use href="#i-clock"></use></svg><span>Personal</span>
      <span class="yz-side-badge" data-att-badge hidden></span>
      <svg class="icon ap-group__arrow"><use href="#i-chevron"></use></svg></button>
    <div class="ap-group__items">
      <button id="yzAttTab" class="admin-tab" type="button" data-section="att" onclick="adminTab('att',this)">${I('users')} <span>Personal izləmə</span><span class="yz-side-badge" data-att-badge hidden></span></button>
    </div>`;
  const sys = box.querySelector('.ap-group[data-group="sys"]');
  box.insertBefore(grp, sys || null);
  return true;
}
function ensureSection() {
  const body = $('adminBody');
  if (!body || $('sec-att')) return;
  const d = document.createElement('div');
  d.className = 'admin-section yz-inv-sec yz-att-sec'; d.id = 'sec-att';
  d.innerHTML = '<div class="yzi yzi--single"><div class="yzi-body" id="yzAttHost"></div></div>';
  body.appendChild(d);
}
function ensureCss() {
  if ($('yzAttCss')) return;
  const l = document.createElement('link');
  l.id = 'yzAttCss'; l.rel = 'stylesheet'; l.href = 'css/yuza-attendance.css';
  document.head.appendChild(l);
}
/* Sol menyudakı nişan: bu gün rədd edilmiş (şübhəli) cəhd sayı */
function badge() {
  const n = D.attemptsToday || 0;
  document.querySelectorAll('[data-att-badge]').forEach(el => { el.hidden = !n; el.textContent = String(n); });
}
let wrapped = false;
function wrapTab() {
  if (wrapped || typeof window.adminTab !== 'function') return wrapped;
  wrapped = true;
  const prev = window.adminTab;
  window.adminTab = function (sec, el) {
    if (sec !== 'att') return prev(sec, el);
    if (!el) el = $('yzAttTab');
    prev(sec, el);
    const t = $('apPageTitle'); if (t) t.textContent = 'Personal izləmə';
    start(); render();
    $('sec-att')?.scrollTo?.(0, 0);
  };
  return true;
}

/* ── Ekran ── */
const TABS = [
  { id: 'live', l: 'Canlı' },
  { id: 'report', l: 'Hesabat' },
  { id: 'tabel', l: 'Tabel' },
  { id: 'devices', l: 'Telefonlar' },
  { id: 'attempts', l: 'Şübhəli cəhdlər', badge: () => D.attemptsToday },
  { id: 'audit', l: 'Jurnal' },
  { id: 'settings', l: 'Ayarlar' }
];
let cur = 'live';
/* Ayarlar mərkəzindən birbaşa lazım olan bölməni açmaq üçün */
window.yzAttOpen = (tab) => { cur = TABS.some(t => t.id === tab) ? tab : 'live'; window.adminTab?.('att'); };
const host = () => $('yzAttHost');
const isOpen = () => $('sec-att')?.classList.contains('active') && $('adminScreen')?.classList.contains('active');

function render() {
  const h = host(); if (!h) return;
  const S = D.settings;
  h.innerHTML = `<div class="yzi-tab">
    <div class="yzi-head"><div><div class="yzi-eyebrow">Personal</div><h1 class="yzi-h1">Personal izləmə</h1></div>
      <div class="yzi-actions">
        ${S.qrMode === 'static' ? `<button type="button" class="yzi-btn yzi-btn--sm" data-act="qr">${I('qr')} Çap üçün QR</button>` : ''}
        <a class="yzi-btn yzi-btn--sm" href="${esc(KIOSK_URL)}" target="_blank" rel="noopener">${I('chair')} Davamiyyət ekranı</a>
      </div></div>
    <nav class="yzi-pills yza-tabs" role="tablist">${TABS.map(t => {
      const n = t.badge ? t.badge() : 0;
      return `<button type="button" role="tab" aria-selected="${t.id === cur}" class="${t.id === cur ? 'is-on' : ''}" data-tab="${t.id}">${t.l}${n ? ` <span class="yzi-badge">${n}</span>` : ''}</button>`;
    }).join('')}</nav>
    <div id="yzAttBody"></div></div>`;
  h.querySelector('.yza-tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) { cur = b.dataset.tab; render(); } });
  h.querySelector('[data-act="qr"]')?.addEventListener('click', showWorkerQr);
  const body = $('yzAttBody');
  ({ live: drawLive, report: drawReport, tabel: drawTabel, devices: drawDevices, attempts: drawAttempts, audit: drawAudit, settings: drawSettings })[cur](body);
}
let rt = null;
function redraw(what) {
  if (!isOpen()) return;
  if (cur === 'report' || cur === 'attempts' || cur === 'audit' || cur === 'tabel') return; // istifadəçi filtr işlədir, öz-özünə yenilənmir
  if (cur === 'settings' && what !== 'settings') return;
  if (cur === 'settings' && document.activeElement && $('yzAttBody')?.contains(document.activeElement)) return;
  clearTimeout(rt); rt = setTimeout(render, 60);
}

const chip = (trust) => { const t = TRUST[trust] || TRUST.medium; return `<span class="yzi-st yzi-st--${t.cls}">${t.label}</span>`; };
const worstTrust = (a, b) => { const o = ['low', 'medium', 'manual', 'high']; if (!a) return b; if (!b) return a; return o.indexOf(a) < o.indexOf(b) ? a : b; };
const ava = (s) => s?.avatar ? `<img class="yza-ava" src="${esc(s.avatar)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : `<span class="yza-ava yza-ava--x">${esc((s?.name || '?').slice(0, 1))}</span>`;

/* ═══ 1) CANLI ═══ */
function drawLive(el) {
  const S = D.settings;
  const staff = staffAll();
  const stOf = (s) => D.status[s.id];
  const phOf = (s) => phaseOf(stOf(s), S);
  const inside = staff.filter(s => phOf(s) === 'in');
  const onBreak = staff.filter(s => phOf(s) === 'break');
  const stale = staff.filter(s => isStale(stOf(s), S));
  const cameToday = new Set(D.today.map(x => x.staffId)).size;
  const lastIn = {}; D.today.forEach(x => { if (!lastIn[x.staffId] || x.inAt > lastIn[x.staffId].inAt) lastIn[x.staffId] = x; });
  const noPhone = noPhoneCount();
  const rank = { in: 0, break: 1, off: 2 };
  const sorted = staff.slice().sort((a, b) => rank[phOf(a)] - rank[phOf(b)] || String(a.name).localeCompare(String(b.name), 'az'));
  el.innerHTML = `
    ${S.gps && (S.lat == null || S.lng == null) ? `<div class="yzi-warnbox"><span>${I('warning')} <b>Restoranın yeri təyin edilməyib</b> — GPS yoxlaması işləmir. <button type="button" class="yzi-link" data-go="settings">Ayarlarda təyin edin</button></span></div>` : ''}
    ${S.qrMode === 'static' ? `<div class="yzi-warnbox"><span>${I('warning')} <b>Çap olunmuş (sabit) QR</b> rejimi işləyir. Daha etibarlı üçün Ayarlarda <b>“Ekranda dəyişən QR”</b> seçin. <button type="button" class="yzi-link" data-go="settings">Ayarlara keç</button></span></div>` : ''}
    <div class="yzi-kpis">
      <div class="yzi-kpi"><small>İndi işdə</small><b>${inside.length} <span>/ ${staff.length}</span></b><span>${fmtDT(now())} vəziyyətinə</span></div>
      <div class="yzi-kpi${onBreak.length ? ' yzi-kpi--warn' : ''}"><small>Müvəqqəti çıxışda</small><b>${onBreak.length}</b><span>restorandan kənarda</span></div>
      <div class="yzi-kpi"><small>Bu gün gələnlər</small><b>${cameToday}</b><span>${fmtDate(now())}</span></div>
      <button type="button" class="yzi-kpi yzi-kpi--btn${noPhone ? ' yzi-kpi--warn' : ''}" data-go="devices"><small>Telefonu qoşulmayan</small><b>${noPhone}</b><span>Telefonlar bölməsinə keç</span></button>
      <button type="button" class="yzi-kpi yzi-kpi--btn${D.attemptsToday ? ' yzi-kpi--bad' : ''}" data-go="attempts"><small>Bu gün rədd edilən cəhd</small><b>${D.attemptsToday}</b><span>Şübhəli cəhdlərə bax</span></button>
      ${stale.length ? `<div class="yzi-kpi yzi-kpi--bad"><small>Çıxışı qeyd edilməyib</small><b>${stale.length}</b><span>${S.maxHours} saatdan çox açıq qalıb</span></div>` : ''}
    </div>
    <div class="yza-grid">${sorted.map(s => {
      const st = stOf(s), ph = phOf(s), old = isStale(st, S);
      const li = lastIn[s.id], tr = li ? worstTrust(li.in?.trust, li.out?.trust) : null;
      const line = ph === 'in' ? `Giriş: ${fmtDT(shiftStart(st))} · ${fmtDur(now() - shiftStart(st))}`
        : ph === 'break' ? `${esc(breakLabel(st.btype))}: ${esc(st.bnote || '')} · ${fmtDT(st.since)}-dən (${fmtDur(now() - st.since)})`
        : old ? `Çıxış qeyd edilməyib · giriş ${fmtDT(shiftStart(st))}`
        : st?.since ? `Son çıxış: ${fmtDT(st.since)}` : 'Hələ qeyd yoxdur';
      const chipTxt = ph === 'in' ? ['ok', 'İşdə'] : ph === 'break' ? ['warn', 'Müvəqqəti çıxışda'] : old ? ['bad', 'Açıq qalıb'] : ['muted', 'Yoxdur'];
      return `<button type="button" class="yza-card${ph === 'in' ? ' is-in' : ''}${ph === 'break' ? ' is-brk' : ''}${old ? ' is-stale' : ''}" data-staff="${esc(s.id)}">
        ${ava(s)}
        <div class="yza-card__main"><b>${esc(s.name)}</b><span>${esc(s.position || '')}</span><small>${line}</small></div>
        <div class="yza-card__side"><span class="yzi-st yzi-st--${chipTxt[0]}">${chipTxt[1]}</span>${tr && ph !== 'off' ? chip(tr) : ''}</div>
      </button>`;
    }).join('') || '<p class="yzi-empty">İşçi yoxdur. Qeydiyyat → İşçilər bölməsindən əlavə edin.</p>'}</div>`;
  el.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { cur = b.dataset.go; render(); });
  el.querySelectorAll('[data-staff]').forEach(b => b.onclick = () => staffActions(staffById(b.dataset.staff)));
}

/* ── İşçi üçün əl ilə qeyd ── */
const toInput = (t) => { const d = new Date(t - new Date(t).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
const fromInput = (v) => v ? new Date(v).getTime() : null;

function staffActions(s) {
  if (!s) return;
  const S = D.settings, st = D.status[s.id];
  const phs = phaseOf(st, S);
  const ph = phoneOf(s.id);
  const acts = phs === 'off' ? [['in', 'Giriş']] : phs === 'in' ? [['break', 'Müvəqqəti çıxış'], ['out', 'Çıxış (günün sonu)']] : [['back', 'Qayıdış'], ['out', 'Çıxış (günün sonu)']];
  modal({
    title: esc(s.name),
    body: `<div class="yzi-mini-kpis">
        <div><small>Vəziyyət</small><b>${phs === 'in' ? 'İşdə' : phs === 'break' ? 'Müvəqqəti çıxışda' : isStale(st, S) ? 'Çıxışı qeyd edilməyib' : 'İşdə deyil'}</b></div>
        <div><small>${phs === 'off' ? 'Son qeyd' : 'Giriş'}</small><b>${fmtDT(phs === 'off' ? st?.since : shiftStart(st))}</b></div>
        <div><small>Telefon</small><b>${ph ? esc(ph.model || 'Qoşulub') : 'Qoşulmayıb'}</b></div></div>
      ${phs === 'break' ? `<p class="yzi-hint">Müvəqqəti çıxış: <b>${esc(breakLabel(st.btype))}</b> — ${esc(st.bnote || '')} · ${fmtDT(st.since)}-dən</p>` : ''}
      <h3 class="yzi-h3">Əl ilə qeyd</h3>
      <p class="yzi-hint">İşçinin telefonu yoxdursa və ya qeyd etməyi unudubsa istifadə edin. Jurnala yazılır və "Əl ilə" kimi işarələnir.</p>
      <div class="yzi-seg" role="radiogroup">${acts.map(([k, l], i) => `<button type="button" data-ma="${k}" class="${i ? '' : 'is-on'}">${l}</button>`).join('')}</div>
      <div class="yzi-grid2">
        <label class="yzi-f"><span>Tarix və saat</span><input type="datetime-local" id="yzaMT" value="${toInput(now())}"></label>
        <label class="yzi-f"><span>Səbəb (məcburi — jurnala yazılır)</span><input type="text" id="yzaMR" placeholder="məs. telefonu evdə qalıb"></label>
      </div>
      <div id="yzaMBrk" class="yzi-grid2"${acts[0][0] === 'break' ? '' : ' hidden'}>
        <label class="yzi-f"><span>Müvəqqəti çıxışın növü</span><select id="yzaMBt">${Object.entries(BREAKS).map(([k, b]) => `<option value="${k}">${esc(b.label)}</option>`).join('')}</select></label>
        <label class="yzi-f"><span>Müvəqqəti çıxışın səbəbi</span><input type="text" id="yzaMBn" maxlength="200" placeholder="məs. bazara getdi"></label>
      </div>`,
    actions: [
      { label: ph ? 'Telefonu dəyiş' : 'Telefon qoş', cls: 'yzi-btn--ghost', onClick: () => { invitePhone(s); } },
      { label: 'Qeydlərinə bax', cls: 'yzi-btn--ghost', onClick: () => { repState.staff = s.id; cur = 'report'; render(); } },
      { label: 'Yaz', cls: 'yzi-btn--gold', onClick: async (b) => {
        const act = b.querySelector('[data-ma].is-on')?.dataset.ma || acts[0][0];
        const t = fromInput(b.querySelector('#yzaMT').value), r = b.querySelector('#yzaMR').value.trim();
        if (!t) { fail('Tarix və saat seçin'); return false; }
        if (!r) { fail('Səbəb yazılmalıdır'); return false; }
        if (t > now() + 60000) { fail('Gələcək vaxt yazmaq olmaz'); return false; }
        if (phs !== 'off' && t < (st.since || 0)) { fail('Bu vaxt son qeyddən (' + fmtDT(st.since) + ') əvvəl ola bilməz'); return false; }
        const openT = (state.tables || []).filter(x => x.occupant === s.id).map(x => x.name);
        if ((act === 'out' || act === 'break') && openT.length) { fail(`${s.name}: ${openT.length} açıq masa var (${openT.join(', ')}). Əvvəlcə masaları başqa ofisianta ötürün.`); return false; }
        const meta = { method: 'manual', trust: 'manual', by: state.user?.name || PATRON, reason: r };
        const sid = st?.sessionId, up = {};
        if (act === 'in') {
          const id = A('sessions').push().key;
          await A('sessions/' + id).set({ staffId: s.id, staffName: s.name, inAt: t, in: meta, manual: true });
          await audit('Əl ilə giriş', { staffId: s.id, staffName: s.name, sessionId: id, after: { inAt: t }, reason: r });
        } else if (act === 'break') {
          const bt = b.querySelector('#yzaMBt').value, bn = b.querySelector('#yzaMBn').value.trim();
          if (!bn) { fail('Müvəqqəti çıxışın səbəbini yazın'); return false; }
          up[`sessions/${sid}/breaks/${A('sessions').push().key}`] = { from: t, type: bt, note: bn.slice(0, 200), method: 'manual', by: meta.by };
          await A().update(up);
          await audit('Əl ilə müvəqqəti çıxış', { staffId: s.id, staffName: s.name, sessionId: sid, after: { model: `${breakLabel(bt)}: ${bn} · ${fmtDT(t)}` }, reason: r });
        } else {
          if (phs === 'break' && st.breakId) up[`sessions/${sid}/breaks/${st.breakId}/to`] = t;
          if (act === 'out') { up[`sessions/${sid}/outAt`] = t; up[`sessions/${sid}/out`] = meta; }
          await A().update(up);
          await audit(act === 'out' ? 'Əl ilə çıxış' : 'Əl ilə qayıdış', { staffId: s.id, staffName: s.name, sessionId: sid, after: act === 'out' ? { outAt: t } : { model: 'qayıdış ' + fmtDT(t) }, reason: r });
        }
        await recomputeStatus(s.id);
        ok('Qeyd edildi');
      } }
    ]
  });
  document.querySelectorAll('[data-ma]').forEach(btn => btn.onclick = () => {
    document.querySelectorAll('[data-ma]').forEach(x => x.classList.toggle('is-on', x === btn));
    const m = document.getElementById('yzaMBrk'); if (m) m.hidden = btn.dataset.ma !== 'break';
  });
}

/* ═══ 2) HESABAT ═══ */
const repState = { period: 'today', from: null, to: null, staff: '', rows: [] };
function periodRange(p) {
  const n = now(), d0 = dayStart(n);
  const d = new Date(n);
  if (p === 'today') return [d0, n];
  if (p === 'yesterday') return [d0 - DAY, d0 - 1];
  if (p === 'week') { const wd = (d.getDay() + 6) % 7; return [d0 - wd * DAY, n]; }
  if (p === 'month') return [new Date(d.getFullYear(), d.getMonth(), 1).getTime(), n];
  if (p === 'lastmonth') return [new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime(), new Date(d.getFullYear(), d.getMonth(), 1).getTime() - 1];
  return [repState.from || d0, repState.to || n];
}
async function drawReport(el) {
  const P = [['today', 'Bu gün'], ['yesterday', 'Dünən'], ['week', 'Bu həftə'], ['month', 'Bu ay'], ['lastmonth', 'Keçən ay'], ['custom', 'Tarix seç']];
  const [from, to] = periodRange(repState.period);
  el.innerHTML = `<div class="yzi-filters">
      <div class="yzi-pills">${P.map(([k, l]) => `<button type="button" class="${repState.period === k ? 'is-on' : ''}" data-p="${k}">${l}</button>`).join('')}</div>
      ${repState.period === 'custom' ? `<label class="yzi-f"><span>Başlanğıc</span><input type="datetime-local" id="yzaFrom" value="${toInput(from)}"></label>
        <label class="yzi-f"><span>Son</span><input type="datetime-local" id="yzaTo" value="${toInput(to)}"></label>` : ''}
      <label class="yzi-f yzi-f--inline"><span>İşçi</span><select id="yzaStaff"><option value="">Hamısı</option>${staffAll().map(s => `<option value="${esc(s.id)}" ${repState.staff === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
      <div class="yzi-actions"><button type="button" class="yzi-btn yzi-btn--sm" id="yzaAdd">${I('plus')} Əl ilə qeyd</button>
        <button type="button" class="yzi-btn yzi-btn--sm" id="yzaCsv">${I('save')} Excel</button></div>
    </div>
    <p class="yzi-hint">Dövr: <b>${fmtDT(from)}</b> — <b>${fmtDT(to)}</b></p>
    <div id="yzaRep"><p class="yzi-empty">Yüklənir…</p></div>`;
  el.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { repState.period = b.dataset.p; drawReport(el); });
  const fr = $('yzaFrom'), tt = $('yzaTo');
  if (fr) fr.onchange = () => { repState.from = fromInput(fr.value); drawReport(el); };
  if (tt) tt.onchange = () => { repState.to = fromInput(tt.value); drawReport(el); };
  $('yzaStaff').onchange = (e) => { repState.staff = e.target.value; drawReport(el); };
  $('yzaAdd').onclick = () => editSession(null, () => drawReport(el));
  $('yzaCsv').onclick = exportCsv;

  let rows = [];
  try {
    const snap = await A('sessions').orderByChild('inAt').startAt(from).endAt(to).once('value');
    snap.forEach(c => { rows.push({ id: c.key, ...c.val() }); });
  } catch (e) { $('yzaRep').innerHTML = `<p class="yzi-empty yzi-bad">Yüklənmədi: ${esc(e.message)}</p>`; return; }
  if (repState.staff) rows = rows.filter(r => r.staffId === repState.staff);
  rows.sort((a, b) => (b.inAt || 0) - (a.inAt || 0));
  repState.rows = rows;
  const isLive = (r) => !r.outAt && !r.forgot && D.status[r.staffId]?.sessionId === r.id && !isStale(D.status[r.staffId], D.settings);
  const dur = (r) => r.outAt ? workedMs(r) : isLive(r) ? workedMs(r, now()) : 0;

  const sum = {};
  rows.forEach(r => {
    const k = r.staffId, o = sum[k] || (sum[k] = { name: r.staffName || staffById(k)?.name || '?', ms: 0, days: new Set(), open: 0, manual: 0, n: 0 });
    o.ms += dur(r); o.days.add(fmtDate(r.inAt)); o.n++;
    if (!r.outAt && (r.forgot || isStale(D.status[k], D.settings) || D.status[k]?.sessionId !== r.id)) o.open++;
    if (r.manual || r.in?.method === 'manual' || r.out?.method === 'manual' || r.editedAt) o.manual++;
  });
  const sumRows = Object.entries(sum).sort((a, b) => b[1].ms - a[1].ms);
  const total = sumRows.reduce((t, [, o]) => t + o.ms, 0);

  $('yzaRep').innerHTML = rows.length ? `
    <div class="yzi-kpis">
      <div class="yzi-kpi"><small>Cəmi işlənmiş vaxt</small><b>${fmtDur(total)}</b><span>${hoursNum(total)} saat</span></div>
      <div class="yzi-kpi"><small>Qeyd sayı</small><b>${rows.length}</b><span>${sumRows.length} işçi</span></div>
    </div>
    <h3 class="yzi-h3">İşçilər üzrə</h3>
    <div class="yzi-table-wrap"><table class="yzi-table">
      <thead><tr><th>İşçi</th><th class="n">İş günü</th><th class="n">Cəmi</th><th class="n">Gündə orta</th><th class="n">Çıxışı yoxdur</th><th class="n">Əl ilə / düzəliş</th></tr></thead>
      <tbody>${sumRows.map(([k, o]) => `<tr data-open="${esc(k)}"><td><b>${esc(o.name)}</b></td><td class="n">${o.days.size}</td><td class="n"><b>${fmtDur(o.ms)}</b></td>
        <td class="n">${fmtDur(o.days.size ? o.ms / o.days.size : 0)}</td><td class="n${o.open ? ' yzi-bad' : ''}">${o.open}</td><td class="n${o.manual ? ' yzi-warn' : ''}">${o.manual}</td></tr>`).join('')}</tbody>
    </table></div>
    <h3 class="yzi-h3">Bütün qeydlər</h3>
    <div class="yzi-table-wrap"><table class="yzi-table">
      <thead><tr><th>İşçi</th><th>Giriş</th><th>Müvəqqəti çıxışlar</th><th>Çıxış</th><th class="n">İşlədi</th><th>Etibar</th><th>Üsul</th><th></th></tr></thead>
      <tbody>${rows.map(r => {
        const open = !r.outAt, live = open && !r.forgot && D.status[r.staffId]?.sessionId === r.id && !isStale(D.status[r.staffId], D.settings);
        const meth = [r.in?.method, r.out?.method].filter(Boolean).map(m => METHOD[m] || m);
        return `<tr>
          <td><b>${esc(r.staffName || staffById(r.staffId)?.name || '?')}</b></td>
          <td>${fmtDT(r.inAt)}${gpsNote(r.in)}</td>
          <td>${brkCell(r)}</td>
          <td>${r.outAt ? fmtDT(r.outAt) + gpsNote(r.out) : live ? '<span class="yzi-st yzi-st--ok">Davam edir</span>' : '<span class="yzi-st yzi-st--bad">Qeyd edilməyib</span>'}</td>
          <td class="n">${live || r.outAt ? fmtDur(dur(r)) : '—'}</td>
          <td>${chip(worstTrust(r.in?.trust, r.out?.trust))}${r.editedAt ? ' <span class="yzi-chip">Düzəliş</span>' : ''}</td>
          <td class="mut">${esc([...new Set(meth)].join(' / '))}</td>
          <td class="n"><span class="yza-rowbtns">${r.in?.photo || r.out?.photo ? `<button type="button" class="yzi-chipbtn" data-photo="${esc(r.id)}">Şəkil</button>` : ''}<button type="button" class="yzi-chipbtn" data-edit="${esc(r.id)}">${I('edit')} Düzəliş</button></span></td>
        </tr>`;
      }).join('')}</tbody></table></div>`
    : '<p class="yzi-empty">Bu dövrdə qeyd yoxdur.</p>';
  $('yzaRep').querySelectorAll('[data-open]').forEach(tr => tr.onclick = () => { repState.staff = tr.dataset.open; drawReport(el); });
  $('yzaRep').querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editSession(rows.find(r => r.id === b.dataset.edit), () => drawReport(el)));
  $('yzaRep').querySelectorAll('[data-photo]').forEach(b => b.onclick = () => showPhotos(rows.find(r => r.id === b.dataset.photo)));
}
function brkCell(r) {
  const br = breakList(r);
  if (!br.length) return '<span class="mut">—</span>';
  return br.map(b => `<div class="yza-brk${BREAKS[b.type]?.paid ? ' is-paid' : ''}"><b>${fmtTime(b.from)}–${b.to ? fmtTime(b.to) : '…'}</b> ${esc(breakLabel(b.type))}${b.to ? ` (${fmtDur(b.to - b.from)})` : ''}<small>${esc(b.note || '')}</small></div>`).join('');
}
function gpsNote(m) {
  if (!m || !m.gps || m.gps.skipped) return '';
  const g = m.gps;
  return `<small class="yza-gps ${g.ok ? '' : 'yzi-bad'}" title="Dəqiqlik ±${esc(g.acc)} m">${g.dist != null ? (g.dist >= 1000 ? (g.dist / 1000).toFixed(1) + ' km' : g.dist + ' m') : ''}</small>`;
}

const brkRow = (b) => `<div class="yza-brow" data-bid="${esc(b.id)}">
    <label class="yzi-f"><span>Çıxdı</span><input type="datetime-local" data-k="from" value="${b.from ? toInput(b.from) : ''}" data-orig="${b.from || ''}"></label>
    <label class="yzi-f"><span>Qayıtdı</span><input type="datetime-local" data-k="to" value="${b.to ? toInput(b.to) : ''}" data-orig="${b.to || ''}"></label>
    <label class="yzi-f"><span>Növ</span><select data-k="type">${Object.entries(BREAKS).map(([k, x]) => `<option value="${k}" ${b.type === k ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></label>
    <label class="yzi-f"><span>Səbəb</span><input type="text" data-k="note" maxlength="200" value="${esc(b.note || '')}"></label>
    <button type="button" class="yzi-chipbtn yzi-bad" data-brm aria-label="Müvəqqəti çıxışı sil">${I('trash')}</button></div>`;
function editSession(r, done) {
  const isNew = !r;
  const m = modal({
    title: isNew ? 'Əl ilə qeyd əlavə et' : 'Qeydə düzəliş',
    body: `${isNew ? `<label class="yzi-f"><span>İşçi</span><select id="yzaES">${staffAll().map(s => `<option value="${esc(s.id)}" ${repState.staff === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>`
        : `<p class="yzi-p"><b>${esc(r.staffName || '')}</b></p>`}
      <div class="yzi-grid2">
        <label class="yzi-f"><span>Giriş (tarix və saat)</span><input type="datetime-local" id="yzaEI" value="${toInput(r?.inAt || now())}"></label>
        <label class="yzi-f"><span>Çıxış (tarix və saat)</span><input type="datetime-local" id="yzaEO" value="${r?.outAt ? toInput(r.outAt) : ''}"></label>
      </div>
      <p class="yzi-hint">Çıxışı boş saxlasanız, işçi hələ işdə sayılır.</p>
      <h3 class="yzi-h3">Müvəqqəti çıxışlar</h3>
      <div id="yzaBrks">${breakList(r).map(brkRow).join('')}</div>
      <button type="button" class="yzi-btn yzi-btn--sm yzi-btn--ghost" id="yzaBAdd">${I('plus')} Müvəqqəti çıxış əlavə et</button>
      <label class="yzi-f"><span>Səbəb (məcburi — jurnala yazılır)</span><input type="text" id="yzaER" placeholder="məs. çıxışı qeyd etməyi unudub"></label>`,
    actions: [
      ...(isNew ? [] : [{ label: `${I('trash')} Sil`, cls: 'yzi-btn--ghost yzi-bad', close: false, onClick: async (b, close) => {
        const reason = b.querySelector('#yzaER').value.trim();
        if (!reason) { fail('Silmək üçün səbəb yazın'); return false; }
        if (!(await confirmBox(`<b>${esc(r.staffName)}</b> — ${fmtDT(r.inAt)} qeydi silinsin?`, { okLabel: 'Sil', okCls: 'yzi-btn--red' }))) return false;
        await A().update({ [`sessions/${r.id}`]: null, [`photos/${r.id}_in`]: null, [`photos/${r.id}_out`]: null });
        await audit('Qeyd silindi', { staffId: r.staffId, staffName: r.staffName, sessionId: r.id, before: { inAt: r.inAt, outAt: r.outAt || null }, reason });
        await recomputeStatus(r.staffId);
        ok('Silindi'); close(); done && done();
      } }]),
      { label: 'Ləğv', cancel: true, cls: 'yzi-btn--ghost' },
      { label: 'Yadda saxla', cls: 'yzi-btn--gold', onClick: async (b) => {
        // Dəyişdirilməyən xana dəqiqəyə yuvarlanmasın deyə əsl dəyər saxlanılır
        const keep = (id, orig) => { const v = b.querySelector(id).value; return orig && v === toInput(orig) ? orig : fromInput(v); };
        const inAt = keep('#yzaEI', r?.inAt), outAt = keep('#yzaEO', r?.outAt);
        const reason = b.querySelector('#yzaER').value.trim();
        if (!inAt) { fail('Giriş vaxtı seçin'); return false; }
        if (outAt && outAt < inAt) { fail('Çıxış girişdən əvvəl ola bilməz'); return false; }
        if (Math.max(inAt, outAt || 0) > now() + 60000) { fail('Gələcək vaxt yazmaq olmaz'); return false; }
        if (outAt && outAt - inAt > 24 * 3600000) { fail('Bir qeyd 24 saatdan uzun ola bilməz'); return false; }
        if (!reason) { fail('Səbəb yazılmalıdır'); return false; }
        // Müvəqqəti çıxışlar
        const brks = {}; let bErr = '';
        const old = r?.breaks || {};
        b.querySelectorAll('.yza-brow').forEach(row => {
          const g = (k) => row.querySelector(`[data-k="${k}"]`);
          const kv = (k) => { const el = g(k); return el.dataset.orig && el.value === toInput(+el.dataset.orig) ? +el.dataset.orig : fromInput(el.value); };
          const from = kv('from'), to = kv('to'), type = g('type').value, note = g('note').value.trim();
          if (!from) { bErr = 'Müvəqqəti çıxışın vaxtını yazın'; return; }
          if (from < inAt || (outAt && from > outAt)) { bErr = 'Müvəqqəti çıxış giriş və çıxış arasında olmalıdır'; return; }
          if (to && to < from) { bErr = 'Qayıdış çıxışdan əvvəl ola bilməz'; return; }
          const prev = old[row.dataset.bid] || {};
          brks[row.dataset.bid.startsWith('n') ? A('sessions').push().key : row.dataset.bid] = { ...prev, from, to: to || null, type, note: note.slice(0, 200), ...(prev.from ? {} : { method: 'manual', by: state.user?.name || PATRON }) };
        });
        if (bErr) { fail(bErr); return false; }
        const brkVal = Object.keys(brks).length ? brks : null;
        const meta = { method: 'manual', trust: 'manual', by: state.user?.name || PATRON, reason };
        if (isNew) {
          const sid = b.querySelector('#yzaES').value, s = staffById(sid);
          const id = A('sessions').push().key;
          const rec = { staffId: sid, staffName: s?.name || '', inAt, in: meta, manual: true };
          if (outAt) { rec.outAt = outAt; rec.out = meta; }
          if (brkVal) rec.breaks = brkVal;
          await A('sessions/' + id).set(rec);
          await audit('Əl ilə qeyd əlavə edildi', { staffId: sid, staffName: s?.name, sessionId: id, after: { inAt, outAt: outAt || null }, reason });
          await recomputeStatus(sid);
        } else {
          const up = { [`sessions/${r.id}/inAt`]: inAt, [`sessions/${r.id}/outAt`]: outAt || null, [`sessions/${r.id}/editedAt`]: TS, [`sessions/${r.id}/forgot`]: null };
          if (outAt && !r.outAt) up[`sessions/${r.id}/out`] = meta;
          if (!outAt) up[`sessions/${r.id}/out`] = null;
          up[`sessions/${r.id}/breaks`] = brkVal;
          await A().update(up);
          await audit('Qeydə düzəliş', { staffId: r.staffId, staffName: r.staffName, sessionId: r.id, before: { inAt: r.inAt, outAt: r.outAt || null }, after: { inAt, outAt: outAt || null }, reason });
          await recomputeStatus(r.staffId);
        }
        ok('Yadda saxlanıldı'); done && done();
      } }
    ]
  });
  const list = m.body.querySelector('#yzaBrks');
  m.body.querySelector('#yzaBAdd').onclick = () => {
    const base = r?.inAt || now();
    list.insertAdjacentHTML('beforeend', brkRow({ id: 'n' + Date.now(), from: Math.min(now(), base + 3600000), type: 'work', note: '' }));
  };
  list.addEventListener('click', e => { const x = e.target.closest('[data-brm]'); if (x) x.closest('.yza-brow').remove(); });
}
async function showPhotos(r) {
  if (!r) return;
  const m = modal({ title: `${esc(r.staffName)} — şəkillər`, body: '<p class="yzi-empty">Yüklənir…</p>' });
  const [a, b] = await Promise.all([A(`photos/${r.id}_in`).once('value'), A(`photos/${r.id}_out`).once('value')]);
  const one = (snap, label, t) => snap.val()?.data ? `<figure class="yza-photo"><img src="${esc(snap.val().data)}" alt="${label}"><figcaption>${label} · ${fmtDT(t)}</figcaption></figure>` : '';
  const inner = one(a, 'Giriş', r.inAt) + one(b, 'Çıxış', r.outAt);
  m.body.innerHTML = inner ? `<div class="yza-photos">${inner}</div>` : '<p class="yzi-empty">Şəkil tapılmadı (müddəti bitib silinib).</p>';
}
function exportCsv() {
  const rows = repState.rows || [];
  if (!rows.length) { fail('İxrac üçün qeyd yoxdur'); return; }
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['İşçi', 'Giriş tarixi', 'Giriş saatı', 'Çıxış tarixi', 'Çıxış saatı', 'Müvəqqəti çıxışlar', 'İşlədi (saat)', 'Etibar', 'Üsul', 'Qeyd'].map(q).join(';')];
  rows.slice().reverse().forEach(r => {
    const tr = TRUST[worstTrust(r.in?.trust, r.out?.trust)]?.label || '';
    lines.push([r.staffName, fmtDate(r.inAt), fmtTime(r.inAt), r.outAt ? fmtDate(r.outAt) : '', r.outAt ? fmtTime(r.outAt) : '',
      breakList(r).map(b => `${fmtTime(b.from)}-${b.to ? fmtTime(b.to) : '?'} ${breakLabel(b.type)}: ${b.note || ''}`).join(' | '),
      r.outAt ? String(hoursNum(workedMs(r))).replace('.', ',') : '', tr,
      [r.in?.method, r.out?.method].filter(Boolean).map(m => METHOD[m] || m).join(' / '),
      r.forgot ? 'Çıxış qeyd edilməyib' : r.editedAt ? 'Düzəliş edilib' : ''].map(q).join(';'));
  });
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  const d = new Date(now());
  a.href = URL.createObjectURL(blob);
  a.download = `davamiyyet_${fmtDate(d).replace(/\./g, '-')}_${fmtTime(d).replace(':', '-')}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ═══ TABEL (aylıq iş vaxtı cədvəli) ═══ */
const MARKS = {
  M: { s: 'M', l: 'Məzuniyyət' }, X: { s: 'X', l: 'Xəstəlik' }, U: { s: 'Ü', l: 'Üzrlü səbəb' },
  Q: { s: 'Q', l: 'Gəlməyib (səbəbsiz)' }, I: { s: 'İ', l: 'İstirahət günü' }
};
const MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'İyun', 'İyul', 'Avqust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr'];
const WD = ['B', 'B.e', 'Ç.a', 'Ç', 'C.a', 'C', 'Ş'];
const tab = { y: new Date().getFullYear(), m: new Date().getMonth(), data: null };
const mKey = (y, m) => `${y}-${String(m + 1).padStart(2, '0')}`;
const hFmt = (ms) => ms ? String(Math.round(ms / 360000) / 10).replace('.', ',') : '';

async function loadTabel() {
  const from = new Date(tab.y, tab.m, 1).getTime(), to = new Date(tab.y, tab.m + 1, 1).getTime() - 1;
  const days = new Date(tab.y, tab.m + 1, 0).getDate();
  const [sSnap, mSnap] = await Promise.all([
    A('sessions').orderByChild('inAt').startAt(from).endAt(to).once('value'),
    A('marks/' + mKey(tab.y, tab.m)).once('value')
  ]);
  const hours = {}, sess = {};
  sSnap.forEach(c => {
    const r = { id: c.key, ...c.val() };
    const live = !r.outAt && !r.forgot && D.status[r.staffId]?.sessionId === r.id && !isStale(D.status[r.staffId], D.settings);
    const ms = r.outAt ? workedMs(r) : live ? workedMs(r, now()) : 0;
    const d = new Date(r.inAt).getDate();
    ((hours[r.staffId] ||= {})[d] = ((hours[r.staffId] || {})[d] || 0) + ms);
    ((sess[r.staffId] ||= {})[d] ||= []).push(r);
  });
  tab.data = { days, hours, sess, marks: mSnap.val() || {} };
}
async function drawTabel(el) {
  el.innerHTML = `<div class="yzi-filters">
      <div class="yzi-actions"><button type="button" class="yzi-btn yzi-btn--sm yzi-btn--ghost" data-mv="-1" aria-label="Əvvəlki ay">‹</button>
        <b class="yza-month">${MONTHS[tab.m]} ${tab.y}</b>
        <button type="button" class="yzi-btn yzi-btn--sm yzi-btn--ghost" data-mv="1" aria-label="Növbəti ay">›</button></div>
      <div class="yzi-actions"><button type="button" class="yzi-btn yzi-btn--sm" id="yzaTCsv">${I('save')} Excel</button></div></div>
    <p class="yzi-hint">Xanada işlənmiş saat görünür. Məzuniyyət, xəstəlik və s. qeyd etmək üçün xanaya basın.
      ${Object.values(MARKS).map(x => `<span class="yza-mk yza-mk--${x.s}">${x.s}</span> ${x.l}`).join(' · ')}</p>
    <div id="yzaTab"><p class="yzi-empty">Yüklənir…</p></div>`;
  el.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => { tab.m += +b.dataset.mv; if (tab.m < 0) { tab.m = 11; tab.y--; } if (tab.m > 11) { tab.m = 0; tab.y++; } drawTabel(el); });
  $('yzaTCsv').onclick = exportTabel;
  try { await loadTabel(); } catch (e) { $('yzaTab').innerHTML = `<p class="yzi-empty yzi-bad">Yüklənmədi: ${esc(e.message)}</p>`; return; }
  const { days, hours, marks } = tab.data;
  const today = new Date(now()); const isCur = today.getFullYear() === tab.y && today.getMonth() === tab.m;
  const dn = Array.from({ length: days }, (_, i) => i + 1);
  const staff = staffAll().slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'az'));
  $('yzaTab').innerHTML = `<div class="yzi-table-wrap yza-tabel-wrap"><table class="yzi-table yza-tabel">
    <thead><tr><th class="yza-tn">İşçi</th>${dn.map(d => { const w = new Date(tab.y, tab.m, d).getDay(); return `<th class="${w === 0 || w === 6 ? 'is-we' : ''}${isCur && d === today.getDate() ? ' is-today' : ''}">${d}<small>${WD[w]}</small></th>`; }).join('')}
      <th class="n">Saat</th><th class="n">Gün</th>${Object.values(MARKS).map(x => `<th class="n">${x.s}</th>`).join('')}</tr></thead>
    <tbody>${staff.map(s => {
      const h = hours[s.id] || {}, mk = marks[s.id] || {};
      const cnt = {}; let tot = 0, wd = 0;
      const cells = dn.map(d => {
        const k = String(d).padStart(2, '0'), mark = mk[k], ms = h[d] || 0;
        if (ms) { tot += ms; wd++; }
        if (mark) cnt[mark.code] = (cnt[mark.code] || 0) + 1;
        return `<td class="yza-tc${mark ? ' yza-mk--' + MARKS[mark.code]?.s : ''}" data-s="${esc(s.id)}" data-d="${d}" title="${esc(mark ? MARKS[mark.code]?.l + (mark.note ? ': ' + mark.note : '') : '')}">${mark ? `<b>${MARKS[mark.code]?.s || '?'}</b>` : ''}${ms ? `<span>${hFmt(ms)}</span>` : ''}</td>`;
      }).join('');
      return `<tr><td class="yza-tn"><b>${esc(s.name)}</b></td>${cells}<td class="n"><b>${hFmt(tot) || 0}</b></td><td class="n">${wd}</td>${Object.keys(MARKS).map(c => `<td class="n">${cnt[c] || ''}</td>`).join('')}</tr>`;
    }).join('') || `<tr><td colspan="${days + 8}" class="yzi-empty">İşçi yoxdur.</td></tr>`}</tbody></table></div>`;
  $('yzaTab').querySelectorAll('[data-d]').forEach(td => td.onclick = () => markDay(staffById(td.dataset.s), +td.dataset.d, () => drawTabel(el)));
}
function markDay(s, d, done) {
  if (!s) return;
  const k = String(d).padStart(2, '0');
  const cur0 = tab.data.marks[s.id]?.[k] || null;
  const list = tab.data.sess[s.id]?.[d] || [];
  const dayT = new Date(tab.y, tab.m, d).getTime();
  const toDate = (t) => { const x = new Date(t); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  modal({
    title: `${esc(s.name)} — ${fmtDate(dayT)}`,
    body: `${list.length ? `<h3 class="yzi-h3">Bu günün qeydləri</h3>${list.map(r => `<p class="yzi-p">${fmtDT(r.inAt)} → ${r.outAt ? fmtDT(r.outAt) : 'çıxış yoxdur'} · <b>${fmtDur(workedMs(r, r.outAt ? 0 : now()))}</b></p>${breakList(r).length ? `<div class="yza-brks">${brkCell(r)}</div>` : ''}`).join('')}` : '<p class="yzi-hint">Bu gün giriş qeydi yoxdur.</p>'}
      <h3 class="yzi-h3">Tabel qeydi</h3>
      <div class="yzi-grid2">
        <label class="yzi-f"><span>Növ</span><select id="yzaMk"><option value="">— Yoxdur —</option>${Object.entries(MARKS).map(([c, x]) => `<option value="${c}" ${cur0?.code === c ? 'selected' : ''}>${x.s} — ${x.l}</option>`).join('')}</select></label>
        <label class="yzi-f"><span>Son gün (bir neçə gün üçün, məs. məzuniyyət)</span><input type="date" id="yzaMkTo" value="${toDate(dayT)}" min="${toDate(dayT)}"></label>
      </div>
      <label class="yzi-f"><span>Qeyd (istəyə görə)</span><input type="text" id="yzaMkN" maxlength="200" value="${esc(cur0?.note || '')}" placeholder="məs. illik məzuniyyət, əmr № 12"></label>
      ${cur0 ? `<p class="yzi-hint">Yazan: ${esc(cur0.by || '')} · ${fmtDT(cur0.at)}</p>` : ''}`,
    actions: [
      { label: 'Ləğv', cancel: true, cls: 'yzi-btn--ghost' },
      { label: 'Yadda saxla', cls: 'yzi-btn--gold', onClick: async (b) => {
        const code = b.querySelector('#yzaMk').value, note = b.querySelector('#yzaMkN').value.trim();
        const endV = b.querySelector('#yzaMkTo').value;
        const end = endV ? new Date(endV + 'T00:00').getTime() : dayT;
        if (end < dayT) { fail('Son gün başlanğıcdan əvvəl ola bilməz'); return false; }
        if (end - dayT > 62 * DAY) { fail('Bir dəfəyə ən çox 2 ay qeyd etmək olar'); return false; }
        const up = {};
        for (let t = dayT; t <= end + 3600000; t += DAY) {
          const x = new Date(t); x.setHours(0, 0, 0, 0);
          const path = `${mKey(x.getFullYear(), x.getMonth())}/${s.id}/${String(x.getDate()).padStart(2, '0')}`;
          up[path] = code ? { code, note: note || null, by: state.user?.name || PATRON, at: TS } : null;
        }
        await A('marks').update(up);
        const n = Object.keys(up).length;
        await audit(code ? 'Tabel qeydi' : 'Tabel qeydi silindi', { staffId: s.id, staffName: s.name, after: { model: `${code ? MARKS[code].l : 'silindi'} · ${fmtDate(dayT)}${n > 1 ? ' — ' + fmtDate(end) + ` (${n} gün)` : ''}` }, reason: note || null });
        ok('Yadda saxlanıldı'); done && done();
      } }
    ]
  });
}
function exportTabel() {
  if (!tab.data) return;
  const { days, hours, marks } = tab.data;
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const dn = Array.from({ length: days }, (_, i) => i + 1);
  const lines = [[`Tabel: ${MONTHS[tab.m]} ${tab.y}`].map(q).join(';'),
    ['İşçi', 'Vəzifə', ...dn.map(String), 'Cəmi saat', 'İş günü', ...Object.values(MARKS).map(x => x.l)].map(q).join(';')];
  staffAll().slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'az')).forEach(s => {
    const h = hours[s.id] || {}, mk = marks[s.id] || {}, cnt = {}; let tot = 0, wd = 0;
    const cells = dn.map(d => {
      const mark = mk[String(d).padStart(2, '0')], ms = h[d] || 0;
      if (ms) { tot += ms; wd++; }
      if (mark) cnt[mark.code] = (cnt[mark.code] || 0) + 1;
      return [mark ? MARKS[mark.code]?.s : '', hFmt(ms)].filter(Boolean).join(' ');
    });
    lines.push([s.name, s.position || '', ...cells, hFmt(tot) || '0', wd, ...Object.keys(MARKS).map(c => cnt[c] || 0)].map(q).join(';'));
  });
  lines.push(q('Çap: ' + fmtDT(now())));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `tabel_${mKey(tab.y, tab.m)}_${fmtTime(now()).replace(':', '-')}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ═══ 3) TELEFONLAR ═══ */
function drawDevices(el) {
  const staff = staffAll().slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'az'));
  el.innerHTML = `
    <div class="yzi-card yza-howto">
      <b>Telefon necə qoşulur?</b>
      <ol><li>İşçinin adının yanında <b>“Telefon qoş”</b> basın — ekranda QR çıxır.</li>
        <li>İşçi bu QR-ı <b>öz telefonunun</b> kamerası ilə oxudur və Face ID ilə təsdiqləyir.</li>
        <li>Hazırdır. QR ${INVITE_MIN} dəqiqə etibarlıdır və yalnız bir telefona qoşulur.</li></ol>
      <p class="yzi-hint">Hər işçinin yalnız <b>bir</b> telefonu olur. Yeni telefon qoşulanda köhnəsi avtomatik bağlanır. İşçiyə heç bir PIN və ya parol lazım deyil.</p>
    </div>
    <div class="yzi-table-wrap"><table class="yzi-table">
      <thead><tr><th>İşçi</th><th>Telefon</th><th>Qoşulub</th><th>Face ID</th><th></th></tr></thead>
      <tbody>${staff.map(s => {
        const a = phoneOf(s.id), legacy = !a && D.devices[s.id]?.approved;
        return `<tr><td><b>${esc(s.name)}</b><br><small class="mut">${esc(s.position || '')}</small></td>
          <td>${a ? esc(a.model || 'Telefon') : legacy ? '<span class="yzi-warn">Köhnə üsulla qoşulub — yenidən qoşun</span>' : s.attNoPhone ? '<span class="mut">Smartfonu yoxdur — səlahiyyətli şəxs qeyd edir</span>' : '<span class="mut">Qoşulmayıb</span>'}</td>
          <td>${a ? fmtDT(a.approvedAt) : '—'}</td>
          <td>${a ? (a.credId ? '<span class="yzi-st yzi-st--ok">Var</span>' : '<span class="yzi-st yzi-st--warn">Yoxdur</span>') : '—'}</td>
          <td class="n"><span class="yza-rowbtns">
            <button type="button" class="yzi-chipbtn${a ? '' : ' yzi-chipbtn--gold'}" data-inv="${esc(s.id)}">${a ? 'Telefonu dəyiş' : 'Telefon qoş'}</button>
            ${a || legacy ? `<button type="button" class="yzi-chipbtn" data-rev="${esc(s.id)}">Ləğv et</button>` : ''}</span></td></tr>`;
      }).join('') || '<tr><td colspan="5" class="yzi-empty">İşçi yoxdur.</td></tr>'}</tbody></table></div>`;
  el.querySelectorAll('[data-inv]').forEach(b => b.onclick = () => invitePhone(staffById(b.dataset.inv)));
  el.querySelectorAll('[data-rev]').forEach(b => b.onclick = () => revoke(b.dataset.rev));
}

/* Dəvət QR-ı: Rəhbərin ekranında göstərilir, işçi öz telefonu ilə oxudur */
async function invitePhone(s) {
  if (!s) return;
  if (!window.QRCode) { fail('QR kitabxanası yüklənməyib. Səhifəni yeniləyin.'); return; }
  let code;
  try { code = await createInvite(s, state.user?.name || PATRON); }
  catch (e) { fail('Dəvət yaradılmadı: ' + (e?.message || e)); return; }
  const url = IZLE_URL + '?inv=' + code;
  const before = D.devices[s.id]?.approved?.uid || null;
  const exp = now() + INVITE_MIN * 60000;
  let timer = null, ref = null, cb = null, done = false;
  const cleanup = () => {
    clearInterval(timer);
    if (ref && cb) ref.off('value', cb);
    if (!done) A('invites/' + code).remove().catch(() => {});   // istifadə olunmayan dəvət dərhal silinir
  };
  const m = modal({
    title: `Telefon qoş — ${esc(s.name)}`,
    body: `<div class="yza-qr">
      <div id="yzaInvBox" class="yza-qrbox"></div>
      <p class="yzi-p"><b>${esc(s.firstname || s.name)}</b>, bu QR-ı <b>öz telefonunuzun</b> kamerası ilə oxudun.</p>
      <p class="yzi-hint">Qalan vaxt: <b id="yzaInvLeft">${INVITE_MIN}:00</b> · yalnız bir telefona qoşulur</p>
      <p class="yzi-hint">Bu QR-ın şəklini çəkib göndərməyin — yalnız işçinin öz telefonu ilə burada oxudulmalıdır.</p></div>`,
    onClose: cleanup
  });
  // eslint-disable-next-line no-undef
  new QRCode(m.body.querySelector('#yzaInvBox'), { text: url, width: 240, height: 240, correctLevel: QRCode.CorrectLevel.M });
  timer = setInterval(() => {
    const left = Math.max(0, exp - now());
    const el = m.body.querySelector('#yzaInvLeft');
    if (el) el.textContent = `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`;
    if (!left) { clearInterval(timer); m.body.innerHTML = '<p class="yzi-empty">Dəvətin vaxtı bitdi. Yenidən “Telefon qoş” basın.</p>'; }
  }, 1000);
  ref = A('devices/' + s.id + '/approved');
  cb = ref.on('value', async (snap) => {
    const a = snap.val();
    if (!a || !a.uid || a.uid === before) return;
    done = true;
    if (before) A('phones/' + before).remove().catch(() => {});      // köhnə telefonun bağlantısı təmizlənir
    await audit(before ? 'Telefon dəyişdirildi' : 'Telefon qoşuldu', { staffId: s.id, staffName: s.name, after: { model: a.model, faceId: !!a.credId } });
    m.close();
    ok(`${s.name}: telefon qoşuldu (${a.model || 'telefon'})`);
  });
}
async function revoke(sid) {
  const a = D.devices[sid]?.approved, s = staffById(sid);
  if (!a) return;
  const r = await confirmBox(`<b>${esc(s?.name)}</b> — ${esc(a.model || 'telefon')} bağlantısı ləğv edilsin? Bu telefonla qeyd etmək mümkün olmayacaq.`, { okLabel: 'Ləğv et', okCls: 'yzi-btn--red', input: 'Səbəb' });
  if (!r) return;
  const up = { [`devices/${sid}/approved`]: null, [`devices/${sid}/pending`]: null };
  if (a.uid) up[`phones/${a.uid}`] = null;
  await A().update(up);
  await audit('Telefon ləğv edildi', { staffId: sid, staffName: s?.name, before: { model: a.model }, reason: r });
  ok('Ləğv edildi');
}

/* ═══ 4) ŞÜBHƏLİ CƏHDLƏR ═══ */
let attDays = 7;
async function drawAttempts(el) {
  el.innerHTML = `<div class="yzi-filters"><div class="yzi-pills">${[[1, 'Bu gün'], [7, 'Son 7 gün'], [30, 'Son 30 gün']].map(([d, l]) => `<button type="button" class="${attDays === d ? 'is-on' : ''}" data-d="${d}">${l}</button>`).join('')}</div></div>
    <p class="yzi-hint">Sistemin <b>rədd etdiyi</b> bütün cəhdlər: restorandan uzaqda, Face ID alınmayan, köhnə QR ilə edilən cəhdlər və davamiyyət ekranında səhv PIN-lər.</p>
    <div id="yzaAtt"><p class="yzi-empty">Yüklənir…</p></div>`;
  el.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { attDays = +b.dataset.d; drawAttempts(el); });
  const from = attDays === 1 ? dayStart() : now() - attDays * DAY;
  const rows = [];
  try { (await A('attempts').orderByChild('at').startAt(from).once('value')).forEach(c => { rows.push({ id: c.key, ...c.val() }); }); }
  catch (e) { $('yzaAtt').innerHTML = `<p class="yzi-empty yzi-bad">${esc(e.message)}</p>`; return; }
  rows.sort((a, b) => b.at - a.at);
  $('yzaAtt').innerHTML = rows.length ? `<div class="yzi-table-wrap"><table class="yzi-table">
    <thead><tr><th>Tarix və saat</th><th>İşçi</th><th>Cəhd</th><th>Səbəb</th><th>Yer</th><th>Cihaz</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td>${fmtDT(r.at)}</td><td><b>${esc(r.staffName || 'Naməlum')}</b></td>
      <td>${r.kind === 'in' ? 'Giriş' : r.kind === 'out' ? 'Çıxış' : '—'}</td><td>${esc(r.reason)}</td>
      <td>${r.gps && r.gps.lat != null ? `<a class="yzi-link" href="https://maps.google.com/?q=${encodeURIComponent(r.gps.lat + ',' + r.gps.lng)}" target="_blank" rel="noopener">Xəritədə</a>` : '—'}</td>
      <td class="mut">${esc(r.model || '')}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="yzi-empty">Bu dövrdə rədd edilən cəhd yoxdur.</p>';
}

/* ═══ 5) JURNAL ═══ */
async function drawAudit(el) {
  el.innerHTML = '<p class="yzi-hint">Rəhbərin bütün düzəlişləri, telefon qoşma/ləğvləri və ayar dəyişiklikləri (son 60 gün).</p><div id="yzaAud"><p class="yzi-empty">Yüklənir…</p></div>';
  const rows = [];
  try { (await A('audit').orderByChild('at').startAt(now() - 60 * DAY).once('value')).forEach(c => { rows.push(c.val()); }); }
  catch (e) { $('yzaAud').innerHTML = `<p class="yzi-empty yzi-bad">${esc(e.message)}</p>`; return; }
  rows.sort((a, b) => b.at - a.at);
  const tm = (o) => o ? [o.inAt != null ? 'giriş ' + fmtDT(o.inAt) : '', o.outAt !== undefined ? 'çıxış ' + (o.outAt ? fmtDT(o.outAt) : 'yox') : '', o.model ? esc(o.model) : ''].filter(Boolean).join(', ') : '';
  $('yzaAud').innerHTML = rows.length ? `<div class="yzi-table-wrap"><table class="yzi-table">
    <thead><tr><th>Tarix və saat</th><th>Kim</th><th>Əməliyyat</th><th>İşçi</th><th>Əvvəl</th><th>Sonra</th><th>Səbəb</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td>${fmtDT(r.at)}</td><td>${esc(r.by)}</td><td><b>${esc(r.action)}</b></td><td>${esc(r.staffName || '—')}</td>
      <td class="mut">${tm(r.before)}</td><td>${tm(r.after)}</td><td>${esc(r.reason || '')}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="yzi-empty">Jurnal boşdur.</p>';
}

/* ═══ 6) AYARLAR ═══ */
function drawSettings(el) {
  const S = D.settings;
  const sw = (k, title, sub) => `<div class="yzi-swrow"><div><b>${title}</b><small>${sub}</small></div>
    <button type="button" class="yzi-switch${S[k] ? ' is-on' : ''}" role="switch" aria-checked="${!!S[k]}" data-sw="${k}" aria-label="${esc(title)}"><span></span></button></div>`;
  el.innerHTML = `<div class="yzi-grid2 yza-set">
    <div class="yzi-card"><h3 class="yzi-h3">QR kod</h3>
      <div class="yzi-seg" role="radiogroup">
        <button type="button" data-qr="dynamic" class="${S.qrMode === 'dynamic' ? 'is-on' : ''}">Ekranda dəyişən (tövsiyə)</button>
        <button type="button" data-qr="static" class="${S.qrMode === 'static' ? 'is-on' : ''}">Çap olunmuş (sabit)</button></div>
      <p class="yzi-hint" id="yzaQrHint"></p>
      <div class="yzi-actions"><a class="yzi-btn yzi-btn--sm" href="${esc(KIOSK_URL)}" target="_blank" rel="noopener">${I('chair')} Davamiyyət ekranını aç</a>
        <button type="button" class="yzi-btn yzi-btn--sm" data-act="qr"${S.qrMode === 'static' ? '' : ' hidden'}>${I('qr')} Çap üçün QR</button></div>
      <p class="yzi-hint">Telefonu olmayan və ya telefonu işləməyən işçinin girişini/çıxışını yalnız Rəhbər burada, <b>Canlı</b> bölməsində işçinin kartına basıb əl ilə yazır (jurnala düşür).</p>
    </div>
    <div class="yzi-card"><h3 class="yzi-h3">Restoranın yeri (GPS)</h3>
      ${sw('gps', 'GPS yoxlaması', 'İşçi restoranın ərazisində olmalıdır')}
      <label class="yzi-f"><span>Koordinatlar (en, uzunluq)</span><input type="text" id="yzaLL" inputmode="decimal" placeholder="40.40926, 49.86709" value="${S.lat != null ? esc(S.lat + ', ' + S.lng) : ''}"></label>
      <div class="yzi-actions"><button type="button" class="yzi-btn yzi-btn--sm yzi-btn--gold" id="yzaHere">${I('home')} İndi olduğum yeri götür</button>
        ${S.lat != null ? `<a class="yzi-btn yzi-btn--sm" href="https://maps.google.com/?q=${encodeURIComponent(S.lat + ',' + S.lng)}" target="_blank" rel="noopener">Xəritədə yoxla</a>` : ''}</div>
      <p class="yzi-hint">Ən asan yol: restoranın içində bu səhifəni açıb <b>“İndi olduğum yeri götür”</b> basın.</p>
      <label class="yzi-f"><span>İcazə verilən radius (metr)</span><input type="number" id="yzaRad" min="30" max="2000" step="10" value="${esc(S.radius)}"></label>
      <p class="yzi-hint">Bina içində GPS 20–100 m səhv edə bilər. 100–200 m tövsiyə olunur.</p>
    </div>
    <div class="yzi-card"><h3 class="yzi-h3">Şəxsin yoxlanması</h3>
      ${sw('faceId', 'Face ID / barmaq izi', 'Hər qeyddə telefon sahibinin üzünü/barmağını soruşur')}
      ${sw('selfie', 'Selfi şəkli', 'Hər qeyddə ön kameradan şəkil çəkilir (işçinin razılığı lazımdır)')}
      <label class="yzi-f"><span>Şəkillər neçə gün saxlansın</span><input type="number" id="yzaPD" min="7" max="365" value="${esc(S.photoDays)}"></label>
    </div>
    <div class="yzi-card"><h3 class="yzi-h3">POS girişi və telefonlar</h3>
      <p class="yzi-p">“Gəlişini qeyd etməyən işçi sistemə girə bilməsin” ayarı bütün sistemə aid olduğu üçün <b>Sistem → Ayarlar → Giriş və təhlükəsizlik</b> bölməsindədir.
        Hazırda: <b>${S.gateLogin ? 'açıq' : 'sönük'}</b>.</p>
      <div class="yzi-actions"><button type="button" class="yzi-btn yzi-btn--sm" id="yzaGoGate">${I('settings')} Ayara keç</button></div>
      <p class="yzi-hint">Telefonu Rəhbər (burada, “Telefonlar” bölməsində) və ya <b>“İşçi telefonunu aktivləşdirmək”</b> icazəsi olan şəxs (davamiyyət ekranında) aktivləşdirir. İcazə: Qeydiyyat → İşçilər → İcazələr.</p>
    </div>
    <div class="yzi-card"><h3 class="yzi-h3">Qaydalar</h3>
      <label class="yzi-f"><span>Maksimum iş müddəti (saat)</span><input type="number" id="yzaMH" min="4" max="24" value="${esc(S.maxHours)}"></label>
      <p class="yzi-hint">Bundan uzun açıq qalan giriş “çıxış qeyd edilməyib” sayılır və işçi növbəti dəfə yenidən giriş edir.</p>
      <label class="yzi-f"><span>İki qeyd arası minimum (dəqiqə)</span><input type="number" id="yzaMG" min="0" max="30" value="${esc(S.minGapMin)}"></label>
      <p class="yzi-hint">Səhvən iki dəfə basmağın qarşısını alır.</p>
    </div></div>
    <div class="yzi-actions"><button type="button" class="yzi-btn yzi-btn--gold" id="yzaSave">${I('save')} Yadda saxla</button></div>`;
  const draft = { ...S };
  const qrHint = () => {
    $('yzaQrHint').innerHTML = draft.qrMode === 'static'
      ? '<b class="yzi-warn">Daha zəif qoruma.</b> QR çap olunub girişə yapışdırılır. QR-ın şəkli hər yerdə işləyir, qorumanı yalnız GPS və Face ID edir.'
      : 'QR hər 15 saniyədən bir dəyişir və <b>baza özü</b> yoxlayır: QR-ın şəkli evdə işləmir. Restoranda bir planşet/monitorda <b>Davamiyyət ekranı</b> daim açıq qalmalıdır.';
    el.querySelector('[data-act="qr"]').hidden = draft.qrMode !== 'static';
  };
  qrHint();
  el.querySelectorAll('[data-sw]').forEach(b => b.onclick = () => { const k = b.dataset.sw; draft[k] = !draft[k]; b.classList.toggle('is-on', draft[k]); b.setAttribute('aria-checked', String(draft[k])); });
  el.querySelectorAll('[data-qr]').forEach(b => b.onclick = () => { draft.qrMode = b.dataset.qr; el.querySelectorAll('[data-qr]').forEach(x => x.classList.toggle('is-on', x === b)); qrHint(); });
  el.querySelector('[data-act="qr"]').addEventListener('click', showWorkerQr);
  $('yzaGoGate')?.addEventListener('click', () => { try { sessionStorage.setItem('yzSetPane', 'security'); } catch (e) { /* */ } window.adminTab?.('settings'); });
  $('yzaHere').onclick = async () => {
    const b = $('yzaHere'); b.disabled = true; b.textContent = 'Yer təyin edilir…';
    try { const p = await getPosition(20000); $('yzaLL').value = `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`; ok(`Yer götürüldü (dəqiqlik ±${p.acc} m). İndi “Yadda saxla” basın.`); }
    catch (e) { fail(e.message); }
    finally { b.disabled = false; b.innerHTML = `${I('home')} İndi olduğum yeri götür`; }
  };
  $('yzaSave').onclick = async () => {
    const ll = $('yzaLL').value.trim();
    let lat = null, lng = null;
    if (ll) {
      const m = ll.replace(/\s+/g, ' ').match(/^(-?\d+(?:[.,]\d+)?)\s*[,; ]\s*(-?\d+(?:[.,]\d+)?)$/);
      if (!m) { fail('Koordinatları belə yazın: 40.40926, 49.86709'); return; }
      lat = +m[1].replace(',', '.'); lng = +m[2].replace(',', '.');
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) { fail('Koordinatlar səhvdir'); return; }
    }
    const num = (id, min, max, def) => { const v = Math.round(+$(id).value); return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def; };
    const next = {
      qrMode: draft.qrMode === 'static' ? 'static' : 'dynamic', gps: !!draft.gps, faceId: !!draft.faceId, selfie: !!draft.selfie,
      lat, lng, radius: num('yzaRad', 30, 2000, 150), photoDays: num('yzaPD', 7, 365, 60), maxHours: num('yzaMH', 4, 24, 16), minGapMin: num('yzaMG', 0, 30, 1),
      // POS girişi ayarı Ayarlar mərkəzindədir — burada olduğu kimi saxlanılır
      gateLogin: !!S.gateLogin, gateExempt: (S.gateExempt && Object.keys(S.gateExempt).length) ? S.gateExempt : null
    };
    if (next.gps && lat == null) { if (!(await confirmBox('GPS yoxlaması açıqdır, amma restoranın yeri yazılmayıb. Yer olmadan GPS yoxlanmayacaq. Davam edilsin?'))) return; }
    const changed = Object.keys(next).filter(k => JSON.stringify(next[k] || null) !== JSON.stringify((k === 'gateExempt' && S[k] && !Object.keys(S[k]).length) ? null : (S[k] ?? null)));
    if (!changed.length) { ok('Dəyişiklik yoxdur'); return; }
    await A('settings').set(next);
    await audit('Ayarlar dəyişdi', { after: { model: changed.join(', ') } });
    ok('Ayarlar yadda saxlanıldı');
  };
}

/* ── Çap üçün sabit QR (yalnız "çap olunmuş" rejimdə) ── */
function showWorkerQr() {
  const m = modal({
    title: 'Çap üçün davamiyyət QR-ı',
    body: `<div class="yza-qr"><div id="yzaQrBox" class="yza-qrbox"></div>
      <p class="yzi-p"><b>Telefonla oxudun → “İşə gəldim”</b></p>
      <p class="yzi-hint yzi-mono">${esc(IZLE_URL)}</p>
      <p class="yzi-hint">Çap edib girişə yapışdırın. Bu QR yalnız <b>qoşulmuş</b> telefonlarda işləyir. Telefonu qoşmaq üçün: <b>Telefonlar → Telefon qoş</b>.</p></div>`,
    actions: [
      { label: 'Linki kopyala', cls: 'yzi-btn--ghost', close: false, onClick: async () => { try { await navigator.clipboard.writeText(IZLE_URL); ok('Link kopyalandı'); } catch (e) { fail('Kopyalanmadı'); } } },
      { label: `${I('printer')} Çap et`, cls: 'yzi-btn--gold', close: false, onClick: () => printQr() }
    ]
  });
  // eslint-disable-next-line no-undef
  if (window.QRCode) new QRCode(m.body.querySelector('#yzaQrBox'), { text: IZLE_URL, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
}
function printQr() {
  const box = document.createElement('div');
  // eslint-disable-next-line no-undef
  new QRCode(box, { text: IZLE_URL, width: 520, height: 520, correctLevel: QRCode.CorrectLevel.M });
  setTimeout(() => {
    const src = box.querySelector('canvas')?.toDataURL() || box.querySelector('img')?.src;
    const w = window.open('', '_blank');
    if (!w) { fail('Çap pəncərəsi açılmadı (brauzer bloklayıb)'); return; }
    w.document.write(`<!doctype html><html lang="az"><head><meta charset="utf-8"><title>Davamiyyət QR</title>
      <style>body{font-family:Arial,sans-serif;text-align:center;padding:40px;color:#111}h1{font-size:34px;margin:0 0 6px}p{font-size:20px;margin:6px 0}img{width:520px;height:520px;margin:24px auto;display:block}small{color:#555;font-size:13px}</style></head>
      <body><h1>YuZa POS · Davamiyyət</h1><p>Telefonun kamerası ilə oxudun və <b>“İşə gəldim”</b> basın</p>
      <img src="${src}" alt="QR"><p>İşdən çıxanda da eyni QR-ı oxudun</p><small>${esc(IZLE_URL)} · çap: ${fmtDT(now())}</small>
      <script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body></html>`);
    w.document.close();
  }, 150);
}

/* ── Başlanğıc ── */
function init() {
  ensureCss();
  let tries = 0;
  const t = setInterval(() => {
    tries++;
    const shellReady = !!$('adminTabsContainer')?.dataset.yzShell || window.__yzShellWrapped || tries > 15;
    if (!shellReady) return;
    if (ensureMenu()) ensureSection();
    if (window.__yzShellWrapped || tries > 15) wrapTab();
    if (wrapped && $('yzAttTab')) clearInterval(t);
    if (tries > 75) clearInterval(t);
  }, 200);
  // Rəhbər daxil olanda canlı məlumatı başlat (nişan üçün), çıxanda dayandır
  setInterval(() => {
    const isAdmin = state.user?.role === 'admin';
    if (isAdmin && !D.started) start();
    if (!isAdmin && D.started) stop();
  }, 2000);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
