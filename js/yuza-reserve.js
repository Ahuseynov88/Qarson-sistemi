/* ═══════════════════════════════════════════
   YUZA POS — REZERVASİYALAR (Mərhələ 1)
   • Zal və kabinet masaları üçün gündəlik bronlar
   • Status axını: Gözləmədə → Təsdiqlənib → Gəldi → Masada → Bitdi
     (+ Gəlmədi, Ləğv edildi, Rədd edildi). Hər addım tarix+saat+işçi adı ilə yazılır.
   • Masa ekranında: bronlu masanın üstündə "Rezerv 20:00 · 4n" nişanı;
     vaxt yaxınlaşdıqca rəng güclənir, 30 dəq qalmış masa YANIB-SÖNÜR (hamı görür)
   • Bildirişlər: icazəli şəxslərə 60/30/15/0 dəq və 15 dəq gecikmədə (səs + pəncərə)
   • Yeni təsdiq gözləyən bron → təsdiqləyənlərə bildiriş; təsdiqdə WhatsApp mesajı
   • Masa qeydiyyatında tutum və minimum hesab. Minimum hesab seçilibsə masa açılanda
     bildirilir, ödənişdə hesab azdırsa Rəhbər (və ya icazəli şəxs) təsdiqi istənilir
   index.html-də yalnız bu fayl qoşulur, mövcud kodu dəyişmir.
═══════════════════════════════════════════ */
import { state } from './state.js';
import * as ST from './state.js';
import { db, R } from './firebase-service.js';
import { hasPermission, ALL_PERMISSIONS, PERMISSION_PRESETS } from './permissions.js';
import { esc, showToast, addLog } from './utils.js';
import { modal } from './yuza-inv-ui.js';
import * as ADM from './admin.js';

/* ═══ Sabitlər və köməkçilər ═══ */
const RV = db.ref('reservations');
const SETTINGS = db.ref('settings/reservation');
const $ = (id) => document.getElementById(id);
const I = (id) => `<svg class="icon"><use href="#i-${id}"></use></svg>`;
const p2 = (n) => String(n).padStart(2, '0');
const MIN = 60000;

export const fmtD = (t) => { const d = new Date(t); return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}`; };
export const fmtT = (t) => { const d = new Date(t); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
export const fmtDT = (t) => `${fmtD(t)} ${fmtT(t)}`;
export const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
export const toTs = (date, time) => {
  const [y, m, d] = String(date).split('-').map(Number);
  const [h, mi] = String(time).split(':').map(Number);
  return new Date(y, m - 1, d, h || 0, mi || 0, 0, 0).getTime();
};
const shiftDay = (key, n) => { const t = toTs(key, '12:00'); return dayKey(t + n * 86400000); };
const money = (n) => (Math.round((+n || 0) * 100) / 100).toFixed(2) + ' ₼';
const leftText = (m) => m > 0 ? (m >= 60 ? `${Math.floor(m / 60)} saat ${m % 60 ? (m % 60) + ' dəq' : ''}`.trim() : `${m} dəq`) : `${-m} dəq gecikir`;

/* Telefon: müqayisə və WhatsApp üçün yalnız rəqəmlər (994XXXXXXXXX) */
export function phoneKey(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('994')) return d;
  if (d.startsWith('0')) d = d.slice(1);
  if (d.length === 9) return '994' + d;
  return d;
}
export const phoneOk = (raw) => { const k = phoneKey(raw); return k.length >= 10 && k.length <= 15; };

export const STATUS = {
  pending:   { l: 'Gözləmədə',   c: 'pend' },
  confirmed: { l: 'Təsdiqlənib', c: 'conf' },
  arrived:   { l: 'Gəldi',       c: 'arr' },
  seated:    { l: 'Masada',      c: 'seat' },
  done:      { l: 'Bitdi',       c: 'done' },
  noshow:    { l: 'Gəlmədi',     c: 'nos' },
  cancelled: { l: 'Ləğv edildi', c: 'can' },
  rejected:  { l: 'Rədd edildi', c: 'can' }
};
export const UPCOMING = ['pending', 'confirmed', 'arrived'];          // masanı gözləyən bronlar
export const BLOCKING = ['pending', 'confirmed', 'arrived', 'seated']; // üst-üstə düşməyə baxılanlar
const SOURCES = { phone: 'Telefon', whatsapp: 'WhatsApp', instagram: 'Instagram', walkin: 'Yerində', online: 'Onlayn' };
const OCCASIONS = { '': 'Yoxdur', birthday: 'Ad günü', anniversary: 'Yubiley', business: 'İşgüzar görüş', romantic: 'Romantik', other: 'Digər' };

const DEF = {
  buffer: 15, dur2: 90, dur4: 120, durL: 150, restaurantName: '',
  msgConfirm: 'Hörmətli {ad}, {tarix} saat {saat} üçün {nəfər} nəfərlik rezervasiyanız təsdiqləndi. {restoran} sizi gözləyir!',
  msgRemind: 'Hörmətli {ad}, bu gün saat {saat} üçün {nəfər} nəfərlik rezervasiyanızı xatırladırıq. {restoran}'
};
let S = { ...DEF };
export const defaultDuration = (pax, s = S) => (pax <= 2 ? s.dur2 : pax <= 4 ? s.dur4 : s.durL);

/* Eyni masada üst-üstə düşən bron (bufer daxil) */
export function findConflict(list, { id, tableId, at, dur }, buffer = S.buffer) {
  if (!tableId) return null;
  const b = (+buffer || 0) * MIN, s = at, e = at + (+dur || 120) * MIN;
  return list.find(r => r.id !== id && r.tableId === tableId && BLOCKING.includes(r.status)
    && s < r.at + (r.durationMin || 120) * MIN + b && r.at < e + b) || null;
}
/* Masanın ən yaxın gözlənilən bronu (bu gün və ya növbəti 6 saat; 3 saatdan çox gecikən sayılmır) */
export function nextForTable(list, tableId, now) {
  const today = dayKey(now);
  return list.filter(r => r.tableId === tableId && UPCOMING.includes(r.status) && r.at > now - 180 * MIN
      && (dayKey(r.at) === today || r.at - now < 6 * 60 * MIN))
    .sort((a, b) => a.at - b.at)[0] || null;
}
/* Vaxt yaxınlaşdıqca xəbərdarlıq səviyyəsi */
export function stage(r, now) {
  const m = (r.at - now) / MIN;
  if (m > 60) return 'info';
  if (m > 30) return 'warn';
  if (m > 0) return 'blink';
  return 'late';
}
export function fillTemplate(tpl, r, s = S) {
  const map = { ad: r.guestName || '', tarix: fmtD(r.at), saat: fmtT(r.at), 'nəfər': String(r.pax || ''), restoran: s.restaurantName || 'Restoranımız', masa: r.tableName || '' };
  return String(tpl || '').replace(/\{([^}]+)\}/g, (m0, k) => (k in map ? map[k] : m0));
}

/* ═══ İcazələr (İşçi formasında yeni qrup) ═══ */
const PERMS = [
  { key: 'reserve.view',      label: 'Rezervasiyaları görmək' },
  { key: 'reserve.create',    label: 'Rezerv yaratmaq və dəyişmək, qonağı oturtmaq' },
  { key: 'reserve.confirm',   label: 'Rezervi təsdiqləmək / rədd etmək' },
  { key: 'reserve.cancel',    label: 'Rezervi ləğv etmək, "gəlmədi" qeyd etmək' },
  { key: 'reserve.notify',    label: 'Rezerv bildirişlərini almaq' },
  { key: 'table.min_approve', label: 'Minimum hesabdan aşağı ödənişi təsdiqləmək' }
];
(function addPerms() {
  if (!ALL_PERMISSIONS.some(g => g.items?.some(i => i.key === 'reserve.view'))) {
    ALL_PERMISSIONS.push({ group: 'Rezervasiyalar', icon: I('clock'), items: PERMS });
  }
  const add = (k, list) => { const p = PERMISSION_PRESETS?.[k]; if (p) list.forEach(x => { if (!p.perms.includes(x)) p.perms.push(x); }); };
  add('manager', PERMS.map(p => p.key));
  add('head_waiter', ['reserve.view', 'reserve.create', 'reserve.notify']);
  add('cashier', ['reserve.view', 'reserve.notify']);
  if (ADM.LOG_TYPE_INFO && !ADM.LOG_TYPE_INFO.reservation) {
    ADM.LOG_TYPE_INFO.reservation = { label: 'REZERVASİYA', color: '#b8862e', group: 'table_ops' };
  }
})();
const can = (k) => !!state.user && hasPermission(k);
const isRehber = () => state.user?.role === 'admin';
const me = () => ({ id: state.user?.id || (isRehber() ? 'admin' : null), name: state.user?.name || (isRehber() ? 'Rəhbər' : '?') });

/* ═══ Canlı məlumat ═══ */
let LIVE = {};            // son 2 gün + gələcək
let PAST = {};            // köhnə tarixlərə baxanda bir dəfəlik oxunan günlər: { 'YYYY-MM-DD': {id: r} }
let started = false;
const list = () => Object.entries(LIVE).map(([id, r]) => ({ id, ...r })).filter(r => r && r.at);
const liveFrom = () => Date.now() - 2 * 86400000;

function start() {
  if (started || !state.user) return;
  started = true;
  SETTINGS.on('value', s => { S = { ...DEF, ...(s.val() || {}) }; });
  RV.orderByChild('at').startAt(liveFrom()).on('value', s => {
    LIVE = s.val() || {};
    onData();
  }, e => console.warn('[rezerv]', e?.message || e));
}
let dataTimer = null;
function onData() {
  clearTimeout(dataTimer);
  dataTimer = setTimeout(() => { decorate(); refreshViews(); checkAlerts(); updateStaffBtn(); }, 60);
}
const tableOf = (id) => (state.tables || []).find(t => t.id === id) || null;
const minOf = (t) => (t?.minSpend?.on && +t.minSpend.amount > 0 ? +t.minSpend.amount : 0);
const tablesSorted = () => (state.tables || []).filter(t => t && !t.isRestoredTemp)
  .sort((a, b) => String(a.category || '').localeCompare(String(b.category || ''), 'az') || String(a.name).localeCompare(String(b.name), 'az', { numeric: true }));

/* ═══ Tarixçə və status ═══ */
function hist(id, action, note) {
  const u = me();
  return RV.child(id).child('history').push({ at: Date.now(), byId: u.id, byName: u.name, action, note: note || null });
}
async function setStatus(r, status, extra = {}, note) {
  const u = me();
  const upd = { status, updatedAt: Date.now(), ...extra };
  upd[status + 'At'] = Date.now();
  upd[status + 'By'] = u.name;
  await RV.child(r.id).update(upd);
  await hist(r.id, status, note);
  addLog('reservation', `${u.name}: ${r.guestName} (${fmtDT(r.at)}, ${r.pax} nəfər${r.tableName ? ', ' + r.tableName : ''}) — ${STATUS[status]?.l || status}${note ? ' · ' + note : ''}`,
    { reservationId: r.id, tableId: r.tableId || null });
}

/* ═══ 1. MASA EKRANINDA NİŞAN + YANIB-SÖNMƏ ═══ */
function decorate() {
  const grid = $('waiterTables'); if (!grid || !started) return;
  const now = Date.now(), all = list();
  grid.querySelectorAll('.floor-card[data-table-id]').forEach(card => {
    const tid = card.dataset.tableId;
    const t = tableOf(tid);
    const r = nextForTable(all, tid, now);
    const ms = minOf(t);
    card.classList.remove('yzrv-info', 'yzrv-warn', 'yzrv-blink', 'yzrv-late', 'yzrv-busy');
    let tag = card.querySelector('.yzrv-tag');
    if (!r && !ms) { tag?.remove(); return; }
    if (!tag) { tag = document.createElement('div'); tag.className = 'yzrv-tag'; card.appendChild(tag); }
    let html = '';
    if (r) {
      const st = stage(r, now), m = Math.round((r.at - now) / MIN);
      card.classList.add('yzrv-' + st);
      if (t?.occupant && st !== 'info') card.classList.add('yzrv-busy');
      html += `<span class="yzrv-tag__r">${I('clock')} Rezerv ${fmtT(r.at)} · ${r.pax}n</span>`;
      if (st !== 'info') html += `<span class="yzrv-tag__left">${esc(leftText(m))}${t?.occupant && m > 0 ? ' · boşalmalıdır' : ''}</span>`;
    }
    if (ms) html += `<span class="yzrv-tag__min">Min ${money(ms)}</span>`;
    if (tag.innerHTML !== html) tag.innerHTML = html;
  });
}
function watchGrid() {
  const grid = $('waiterTables');
  if (!grid || grid.dataset.yzrv) return;
  grid.dataset.yzrv = '1';
  let raf = 0;
  new MutationObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(decorate); }).observe(grid, { childList: true });
  decorate();
}

/* ═══ 2. MASA AÇILANDA XƏBƏRDARLIQ ═══ */
document.addEventListener('table:activate-requested', (e) => setTimeout(() => activateNote(e.detail?.tableId), 0));
function activateNote(tid) {
  const box = $('confirmTableModal')?.querySelector('.modal'); if (!box) return;
  box.querySelector('.yzrv-act')?.remove();
  const t = tableOf(tid); const ms = minOf(t);
  const r = started ? nextForTable(list(), tid, Date.now()) : null;
  if (!r && !ms) return;
  const d = document.createElement('div');
  d.className = 'yzrv-act';
  let html = '';
  if (r) {
    const m = Math.round((r.at - Date.now()) / MIN), st = stage(r, Date.now());
    html += `<div class="yzrv-act__r yzrv-act--${st}">${I('clock')} <span>Bu masa saat <b>${fmtT(r.at)}</b>-da <b>${esc(r.guestName)}</b> üçün rezervdir (${r.pax} nəfər). <b>${esc(leftText(m))}</b>.</span></div>`;
    if (['confirmed', 'arrived'].includes(r.status) && m <= 90 && (can('reserve.create') || can('reserve.confirm'))) {
      html += `<button type="button" class="yzi-btn yzi-btn--gold yzi-btn--sm yzrv-act__seat">${I('check')} Bron qonağıdır — oturt</button>`;
    }
  }
  if (ms) html += `<div class="yzrv-act__min">${I('money')} <span>Bu masada <b>minimum hesab ${money(ms)}</b>-dır.</span></div>`;
  d.innerHTML = html;
  const rowBtns = [...box.children].reverse().find(el => el.querySelector?.('[data-confirm-activate]'));
  box.insertBefore(d, rowBtns || null);
  d.querySelector('.yzrv-act__seat')?.addEventListener('click', async () => {
    box.querySelector('[data-cancel]')?.click();
    await seat(r);
  });
}

/* ═══ 3. MİNİMUM HESAB — ödəniş, masa ekranı ═══ */
function minNeed(tid) {
  const t = tableOf(tid); const min = minOf(t);
  if (!min) return null;
  const o = state.tableOrders?.[tid]; const total = +o?.total || 0;
  if (total >= min - 0.009) return null;
  const ap = o?.minApproval;
  if (ap && total >= (+ap.total || 0) - 0.009) return null;
  return { t, min, total };
}
let bypassPay = false;
function hookPayment() {
  const pm = $('paymentModal');
  if (!pm || pm.dataset.yzrv) return;
  pm.dataset.yzrv = '1';
  pm.addEventListener('click', (e) => {
    if (!e.target.closest('[data-confirm-payment]')) return;
    if (bypassPay) { bypassPay = false; return; }
    const P = window.staffApp?.payment?.payment;
    if (P && !P.type) return;                         // növ seçilməyib — öz xəbərdarlığı çıxsın
    const tid = P?.tableId || state.noteTableId;
    const need = minNeed(tid);
    if (!need) return;
    e.stopImmediatePropagation(); e.preventDefault();
    const btn = e.target.closest('[data-confirm-payment]');
    approveMin(tid, need).then(ok => { if (ok) { bypassPay = true; btn.click(); } });
  }, true);
}
async function verifyPin(pin) {
  pin = String(pin || '').trim();
  if (!pin) return null;
  const ownerMode = !!window.__yzOwner?.available?.();   // Rəhbər PIN-i yoxdur — Rəhbər parolu ilə təsdiqləyir
  let adminPin = ownerMode ? null : ST.ADMIN_PIN;
  if (adminPin == null && !ownerMode) { try { adminPin = (await db.ref('settings/adminPin').once('value')).val(); } catch (e) { /* */ } }
  if (adminPin != null && String(adminPin) === pin) return { id: 'admin', name: 'Rəhbər' };
  const s = (state.staff || []).find(x => String(x.pin) === pin && x.status !== 'offline' && (x.permissions || []).includes('table.min_approve'));
  return s ? { id: s.id, name: s.name } : null;
}
function approveMin(tid, { t, min, total }) {
  return new Promise(resolve => {
    const self = isRehber() || can('table.min_approve');
    let done = false;
    modal({
      title: `${I('money')} Minimum hesab`,
      body: `<p class="yzi-p"><b>${esc(t?.name || '')}</b> masasında minimum hesab <b>${money(min)}</b>, cari hesab <b>${money(total)}</b>.<br>Çatmır: <b class="yzi-bad">${money(min - total)}</b></p>
        ${self ? '<p class="yzi-hint">Bu hesabla ödəniş qəbul etməyi təsdiqləyirsiniz?</p>'
               : '<label class="yzi-f"><span>' + (window.__yzOwner?.available?.() ? 'Səlahiyyətli şəxsin PIN-i' : 'Rəhbərin və ya səlahiyyətli şəxsin PIN-i') + '</span><input type="password" id="yzrvMinPin" inputmode="numeric" autocomplete="off"></label><p class="yzi-hint">Bu ödənişi yalnız Rəhbər və ya "minimum hesabı təsdiqləmək" icazəsi olan şəxs təsdiqləyə bilər.</p>'}
        <label class="yzi-f"><span>Səbəb (istəyə görə)</span><input type="text" id="yzrvMinWhy" maxlength="120" autocomplete="off"></label>
        <p class="yzrv-err" id="yzrvMinErr"></p>`,
      actions: [
        { label: 'Ləğv', cancel: true, cls: 'yzi-btn--ghost' },
        ...(!self && window.__yzOwner?.available?.() ? [{ label: `${I('key')} Rəhbər parolu ilə`, cls: 'yzi-btn--ghost', close: false, onClick: async (b, close) => {
          if (!(await window.__yzOwner.verify({ title: 'Minimum hesab', text: 'Minimumdan aşağı ödənişi təsdiqləmək üçün Rəhbər parolunu yazın.' }))) return false;
          b.querySelector('#yzrvMinPin').value = '';
          b.dataset.rehber = '1';
          b.closest('.yzi-modal')?.querySelector('.yzi-btn--gold')?.click();
          return false;
        } }] : []),
        { label: 'Təsdiqlə', cls: 'yzi-btn--gold', onClick: async (b) => {
          let by = me();
          if (!self && b.dataset.rehber === '1') by = { id: 'admin', name: 'Rəhbər' };
          else if (!self) {
            by = await verifyPin(b.querySelector('#yzrvMinPin').value);
            if (!by) { b.querySelector('#yzrvMinErr').textContent = 'PIN səhvdir və ya bu şəxsin təsdiq icazəsi yoxdur.'; return false; }
          }
          const why = b.querySelector('#yzrvMinWhy').value.trim();
          const o = state.tableOrders?.[tid];
          await R.tableOrders.child(tid).child('minApproval').set({ total, min, byId: by.id, byName: by.name, at: Date.now(), reason: why || null });
          addLog('payment', `${by.name} "${t?.name}" masasında minimum hesabdan (${money(min)}) aşağı ödənişi təsdiqlədi: ${money(total)}${why ? ' — ' + why : ''}`,
            { tableId: tid, sessionId: t?.sessionId || null, minApproval: true, waiterId: o?.waiterId || null });
          done = true; resolve(true);
        } }
      ],
      onClose: () => { if (!done) resolve(false); }
    });
  });
}
function paymentNote() {
  const pm = $('paymentModal'); if (!pm) return;
  const open = pm.classList.contains('open');
  let n = pm.querySelector('.yzrv-paynote');
  if (!open) { n?.remove(); return; }
  const tid = window.staffApp?.payment?.payment?.tableId || state.noteTableId;
  const t = tableOf(tid), min = minOf(t);
  if (!min) { n?.remove(); return; }
  const total = +state.tableOrders?.[tid]?.total || 0;
  const ok = total >= min - 0.009, ap = state.tableOrders?.[tid]?.minApproval;
  const html = ok ? `${I('check')} Minimum hesab ${money(min)} — ödənilib`
    : ap && total >= (+ap.total || 0) - 0.009 ? `${I('check')} Minimum hesab ${money(min)} — çatmır ${money(min - total)}, <b>${esc(ap.byName)}</b> təsdiqləyib (${fmtDT(ap.at)})`
    : `${I('warning')} Minimum hesab ${money(min)} — çatmır <b>${money(min - total)}</b>. Ödənişdə Rəhbər təsdiqi istəniləcək.`;
  if (!n) { n = document.createElement('div'); n.className = 'yzrv-paynote'; pm.querySelector('.modal h2')?.insertAdjacentElement('afterend', n); }
  n.classList.toggle('is-ok', ok);
  if (n.innerHTML !== html) n.innerHTML = html;
}
function ticketNote() {
  const os = $('orderScreen'); const head = $('ticketTableName')?.parentElement;
  if (!head) return;
  let n = $('yzrvTicket');
  if (!os?.classList.contains('active') || !state.noteTableId) { n?.remove(); return; }
  const tid = state.noteTableId, t = tableOf(tid), min = minOf(t);
  const r = started ? nextForTable(list(), tid, Date.now()) : null;
  const parts = [];
  if (min) {
    const total = +state.tableOrders?.[tid]?.total || 0;
    parts.push(total >= min - 0.009 ? `<span class="yzrv-chip is-ok">Min ${money(min)} ✓</span>` : `<span class="yzrv-chip is-warn">Min ${money(min)} · çatmır ${money(min - total)}</span>`);
  }
  if (r && r.status !== 'seated') {
    const m = Math.round((r.at - Date.now()) / MIN);
    parts.push(`<span class="yzrv-chip yzrv-chip--${stage(r, Date.now())}">${I('clock')} Rezerv ${fmtT(r.at)} · ${esc(leftText(m))}</span>`);
  }
  if (!parts.length) { n?.remove(); return; }
  if (!n) { n = document.createElement('div'); n.id = 'yzrvTicket'; n.className = 'yzrv-ticket'; head.appendChild(n); }
  const html = parts.join('');
  if (n.innerHTML !== html) n.innerHTML = html;
}

/* ═══ 4. MASA QEYDİYYATI: tutum + minimum hesab ═══ */
function tableSettingsBox() {
  const body = $('tablesDetailBody');
  if (!body || !isRehber()) return;
  if (!body.dataset.yzrv) {
    body.dataset.yzrv = '1';
    new MutationObserver(() => setTimeout(tableSettingsBox, 0)).observe(body, { childList: true });
  }
  const tid = state._selectedTableMgmtId; const t = tableOf(tid);
  if (!t || body.querySelector('.yzrv-tset') || !body.children.length) return;
  const min = t.minSpend || {};
  const d = document.createElement('div');
  d.className = 'yzrv-tset';
  d.innerHTML = `<div class="ct-detail-section-title">Rezerv və hesab ayarları</div>
    <div class="yzi-grid2">
      <label class="yzi-f"><span>Tutum (nəfər)</span><input type="number" min="1" max="500" id="yzrvCap" value="${esc(t.capacity || '')}" placeholder="məs: 4"></label>
      <label class="yzi-f"><span>Minimum hesab (₼)</span><input type="number" min="0" step="0.01" id="yzrvMinAmt" value="${esc(min.amount || '')}" placeholder="məs: 300"></label>
    </div>
    <label class="yzi-check yzrv-tset__chk"><input type="checkbox" id="yzrvMinOn" ${min.on ? 'checked' : ''}> Bu masada minimum hesab tətbiq olunsun</label>
    <p class="yzi-hint">Seçilibsə, masa açılanda və bron zamanı bildirilir. Ödəniş zamanı hesab minimumdan azdırsa, Rəhbərin təsdiqi istənilir.</p>
    <p class="yzrv-err" id="yzrvTsetErr"></p>
    <button type="button" class="yzi-btn yzi-btn--gold" id="yzrvTsetSave">${I('save')} Yadda saxla</button>`;
  body.appendChild(d);
  d.querySelector('#yzrvTsetSave').addEventListener('click', async () => {
    const cap = parseInt(d.querySelector('#yzrvCap').value, 10);
    const amt = Math.round((parseFloat(d.querySelector('#yzrvMinAmt').value) || 0) * 100) / 100;
    const on = d.querySelector('#yzrvMinOn').checked;
    const err = d.querySelector('#yzrvTsetErr');
    if (on && !(amt > 0)) { err.textContent = 'Minimum hesab seçilibsə, məbləği yazın.'; return; }
    err.textContent = '';
    await R.tables.child(tid).update({ capacity: cap > 0 ? cap : null, minSpend: on ? { on: true, amount: amt } : null });
    addLog('table_mgmt', `"${t.name}" masası: tutum ${cap > 0 ? cap + ' nəfər' : '—'}, minimum hesab ${on ? money(amt) : 'yoxdur'}`, { tableId: tid });
    showToast(`${I('check')} "${esc(t.name)}" yadda saxlanıldı`);
  });
}

/* ═══ 5. BRON PƏNCƏRƏSİ (yeni / redaktə) ═══ */
async function guestInfo(phone) {
  const k = phoneKey(phone);
  if (k.length < 10) return null;
  let past = [];
  try { past = Object.values((await RV.orderByChild('phoneKey').equalTo(k).once('value')).val() || {}); } catch (e) { past = list().filter(r => r.phoneKey === k); }
  const loyal = (state.loyaltyCustomers || []).find(c => phoneKey(c.phone) === k) || null;
  return {
    visits: past.filter(r => ['seated', 'done'].includes(r.status)).length,
    noshow: past.filter(r => r.status === 'noshow').length,
    rejected: past.filter(r => r.status === 'rejected' && r.rejectReason === 'spam').length,
    open: past.filter(r => ['pending'].includes(r.status) && r.at > Date.now()).length,
    lastName: past.sort((a, b) => b.at - a.at)[0]?.guestName || (loyal ? `${loyal.firstName || ''} ${loyal.lastName || ''}`.trim() : ''),
    loyal
  };
}
function tableOptions(sel, at, dur, id) {
  const all = list();
  const groups = {};
  tablesSorted().forEach(t => { const c = t.category || 'Masalar'; (groups[c] = groups[c] || []).push(t); });
  return `<option value="">— Masa sonra təyin ediləcək —</option>` + Object.entries(groups).map(([g, ts]) =>
    `<optgroup label="${esc(g)}">${ts.map(t => {
      const c = at ? findConflict(all, { id, tableId: t.id, at, dur }) : null;
      const bits = [t.capacity ? `${t.capacity} nəfər` : '', minOf(t) ? `min ${money(minOf(t))}` : '', c ? `⚠ ${fmtT(c.at)}-da bronlu` : ''].filter(Boolean).join(' · ');
      return `<option value="${esc(t.id)}"${t.id === sel ? ' selected' : ''}>${esc(t.name)}${bits ? ' — ' + esc(bits) : ''}</option>`;
    }).join('')}</optgroup>`).join('');
}
export function openForm(r = null, preset = {}) {
  if (!can('reserve.create')) { showToast(`${I('ban')} Rezerv yaratmaq icazəniz yoxdur`); return; }
  const isNew = !r;
  const now = Date.now();
  const startAt = r?.at || preset.at || (Math.ceil((now + 30 * MIN) / (15 * MIN)) * 15 * MIN);
  const v = {
    phone: r?.phone || '', guestName: r?.guestName || '', pax: r?.pax || 2,
    date: dayKey(startAt), time: fmtT(startAt), dur: r?.durationMin || defaultDuration(r?.pax || 2),
    tableId: r?.tableId ?? preset.tableId ?? '', source: r?.source || 'phone', occasion: r?.occasion || '', note: r?.note || ''
  };
  let durTouched = !!r, capOk = false, curSel = v.tableId || '';
  const m = modal({
    title: `${I('clock')} ${isNew ? 'Yeni rezerv' : 'Rezervi dəyiş'}`,
    wide: true,
    body: `<div class="yzrv-form">
      <div class="yzi-grid2">
        <label class="yzi-f"><span>Telefon *</span><input type="tel" id="fPhone" value="${esc(v.phone)}" placeholder="+994 50 123 45 67" autocomplete="off"></label>
        <label class="yzi-f"><span>Ad *</span><input type="text" id="fName" value="${esc(v.guestName)}" maxlength="80" autocomplete="off"></label>
      </div>
      <div id="fGuest" class="yzrv-guest"></div>
      <div class="yzi-grid3 yzrv-grid4">
        <label class="yzi-f"><span>Nəfər *</span><input type="number" id="fPax" min="1" max="500" value="${esc(v.pax)}"></label>
        <label class="yzi-f"><span>Tarix *</span><input type="date" id="fDate" value="${esc(v.date)}"></label>
        <label class="yzi-f"><span>Saat *</span><input type="time" id="fTime" value="${esc(v.time)}" step="300"></label>
        <label class="yzi-f"><span>Müddət (dəq)</span><input type="number" id="fDur" min="15" max="720" step="15" value="${esc(v.dur)}"></label>
      </div>
      <label class="yzi-f"><span>Masa / kabinet</span><select id="fTable"></select></label>
      <div id="fTableInfo" class="yzrv-tinfo"></div>
      <div class="yzi-grid2">
        <label class="yzi-f"><span>Mənbə</span><select id="fSource">${Object.entries(SOURCES).filter(([k]) => k !== 'online' || v.source === 'online').map(([k, l]) => `<option value="${k}"${k === v.source ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="yzi-f"><span>Münasibət</span><select id="fOcc">${Object.entries(OCCASIONS).map(([k, l]) => `<option value="${k}"${k === v.occasion ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <label class="yzi-f"><span>Qeyd</span><textarea id="fNote" rows="2" maxlength="300" placeholder="məs: uşaq oturacağı, pəncərə kənarı, tort gətiriləcək">${esc(v.note)}</textarea></label>
      ${isNew && !can('reserve.confirm') ? '<p class="yzi-hint">Bron "Gözləmədə" statusu ilə yaranır və təsdiqləyən şəxsə bildiriş gedir.</p>' : ''}
      <p class="yzrv-err" id="fErr"></p>
    </div>`,
    actions: [
      { label: 'Ləğv', cancel: true, cls: 'yzi-btn--ghost' },
      { label: `${I('check')} Yadda saxla`, cls: 'yzi-btn--gold', onClick: (b) => save(b) }
    ]
  });
  const B = m.body, q = (s) => B.querySelector(s);
  const read = () => {
    const pax = parseInt(q('#fPax').value, 10) || 0;
    const date = q('#fDate').value, time = q('#fTime').value;
    return { phone: q('#fPhone').value.trim(), guestName: q('#fName').value.trim(), pax, date, time,
      at: date && time ? toTs(date, time) : 0, dur: parseInt(q('#fDur').value, 10) || defaultDuration(pax),
      tableId: q('#fTable').value || null, source: q('#fSource').value, occasion: q('#fOcc').value, note: q('#fNote').value.trim() };
  };
  const fillTables = () => { const x = read(); q('#fTable').innerHTML = tableOptions(curSel, x.at, x.dur, r?.id); info(); };
  const info = () => {
    const x = read(); const t = tableOf(x.tableId); const out = [];
    capOk = false;
    if (t) {
      if (t.capacity && x.pax > t.capacity) out.push(`<div class="yzrv-w">${I('warning')} ${esc(t.name)} ${t.capacity} nəfərlikdir, bron ${x.pax} nəfərlikdir.</div>`);
      if (minOf(t)) out.push(`<div class="yzrv-i">${I('money')} ${esc(t.name)}: minimum hesab <b>${money(minOf(t))}</b>. Qonağa bildirin.</div>`);
      const c = x.at ? findConflict(list(), { id: r?.id, tableId: t.id, at: x.at, dur: x.dur }) : null;
      if (c) out.push(`<div class="yzrv-e">${I('ban')} Bu masa ${fmtT(c.at)}–${fmtT(c.at + (c.durationMin || 120) * MIN)} arası <b>${esc(c.guestName)}</b> üçün bronludur (${S.buffer} dəq hazırlıq daxil).</div>`);
    } else {
      out.push('<div class="yzrv-i">Masa qonaq gələndə təyin ediləcək.</div>');
    }
    q('#fTableInfo').innerHTML = out.join('');
  };
  let gTimer = null;
  const guest = () => {
    clearTimeout(gTimer);
    gTimer = setTimeout(async () => {
      const g = await guestInfo(q('#fPhone').value);
      const el = q('#fGuest'); if (!el) return;
      if (!g) { el.innerHTML = ''; return; }
      if (!q('#fName').value.trim() && g.lastName) q('#fName').value = g.lastName;
      const bits = [];
      if (g.visits || g.noshow) bits.push(`<span class="yzrv-chip">${g.visits} gəliş</span>`);
      if (g.noshow) bits.push(`<span class="yzrv-chip is-bad">${g.noshow} dəfə gəlməyib</span>`);
      if (g.rejected) bits.push(`<span class="yzrv-chip is-bad">saxta bron qeydi var</span>`);
      if (g.open && isNew) bits.push(`<span class="yzrv-chip is-warn">${g.open} gözləyən bronu var</span>`);
      if (g.loyal) bits.push(`<span class="yzrv-chip is-ok">${I('star')} Loyallıq üzvü · ${+g.loyal.bonus || 0} bal</span>`);
      el.innerHTML = bits.length ? bits.join('') : '<span class="yzrv-chip">Yeni qonaq</span>';
    }, 350);
  };
  q('#fPhone').addEventListener('input', guest);
  q('#fPax').addEventListener('input', () => { if (!durTouched) q('#fDur').value = defaultDuration(parseInt(q('#fPax').value, 10) || 2); fillTables(); });
  q('#fDur').addEventListener('input', () => { durTouched = true; fillTables(); });
  ['#fDate', '#fTime'].forEach(s => q(s).addEventListener('change', fillTables));
  q('#fTable').addEventListener('change', () => { curSel = q('#fTable').value; info(); });
  fillTables(); if (v.phone) guest();

  async function save(b) {
    const x = read(); const err = q('#fErr');
    const fail = (t) => { err.textContent = t; return false; };
    if (!phoneOk(x.phone)) return fail('Telefon nömrəsini düzgün yazın (məcburidir).');
    if (!x.guestName) return fail('Qonağın adını yazın.');
    if (!(x.pax > 0)) return fail('Nəfər sayını yazın.');
    if (!x.at) return fail('Tarix və saatı seçin.');
    if (isNew && x.at < Date.now() - 5 * MIN) return fail('Keçmiş vaxta bron yaratmaq olmaz.');
    const t = tableOf(x.tableId);
    if (t) {
      const c = findConflict(list(), { id: r?.id, tableId: t.id, at: x.at, dur: x.dur });
      if (c) return fail(`${t.name} bu vaxtda ${c.guestName} üçün bronludur (${fmtT(c.at)}). Başqa masa və ya saat seçin.`);
      if (t.capacity && x.pax > t.capacity && !capOk) { capOk = true; return fail(`${t.name} ${t.capacity} nəfərlikdir. Yenə də yadda saxlamaq üçün "Yadda saxla"nı təkrar basın.`); }
    }
    if (isNew) {
      const g = await guestInfo(x.phone);
      if (g && g.open >= 2 && !b.dataset.spamOk) { b.dataset.spamOk = '1'; return fail(`Bu nömrənin artıq ${g.open} gözləyən bronu var. Davam etmək üçün təkrar basın.`); }
    }
    const u = me();
    const data = {
      phone: x.phone, phoneKey: phoneKey(x.phone), guestName: x.guestName, pax: x.pax,
      date: x.date, time: x.time, at: x.at, durationMin: x.dur,
      tableId: t?.id || null, tableName: t?.name || null, tableCategory: t?.category || null,
      source: x.source, occasion: x.occasion || null, note: x.note || null, updatedAt: Date.now()
    };
    if (isNew) {
      const status = can('reserve.confirm') ? 'confirmed' : 'pending';
      const ref = RV.push();
      await ref.set({ ...data, status, createdAt: Date.now(), createdById: u.id, createdByName: u.name,
        ...(status === 'confirmed' ? { confirmedAt: Date.now(), confirmedBy: u.name } : {}) });
      await ref.child('history').push({ at: Date.now(), byId: u.id, byName: u.name, action: 'created', note: `${STATUS[status].l} · ${SOURCES[x.source] || x.source}` });
      addLog('reservation', `${u.name} yeni rezerv yaratdı: ${x.guestName} — ${fmtDT(x.at)}, ${x.pax} nəfər${t ? ', ' + t.name : ''} (${STATUS[status].l})`, { reservationId: ref.key, tableId: t?.id || null });
      showToast(`${I('check')} Rezerv yaradıldı: ${fmtDT(x.at)}`);
      view.date = x.date;
    } else {
      const ch = [];
      if (r.at !== x.at) ch.push(`vaxt ${fmtDT(r.at)} → ${fmtDT(x.at)}`);
      if ((r.tableId || null) !== (t?.id || null)) ch.push(`masa ${r.tableName || '—'} → ${t?.name || '—'}`);
      if (r.pax !== x.pax) ch.push(`nəfər ${r.pax} → ${x.pax}`);
      await RV.child(r.id).update(data);
      await hist(r.id, 'edited', ch.join('; ') || 'məlumat yeniləndi');
      addLog('reservation', `${u.name} rezervi dəyişdi: ${x.guestName}${ch.length ? ' — ' + ch.join('; ') : ''}`, { reservationId: r.id, tableId: t?.id || null });
      showToast(`${I('check')} Rezerv yeniləndi`);
    }
  }
}

/* ═══ 6. ƏMƏLİYYATLAR ═══ */
function waLink(r, tpl) {
  const k = phoneKey(r.phone);
  return `https://wa.me/${k}?text=${encodeURIComponent(fillTemplate(tpl, r))}`;
}
function confirmFlow(r) {
  if (!can('reserve.confirm')) { showToast(`${I('ban')} Təsdiq icazəniz yoxdur`); return; }
  const m = modal({
    title: `${I('check')} Rezervi təsdiqlə`,
    body: `<p class="yzi-p"><b>${esc(r.guestName)}</b> · ${fmtDT(r.at)} · ${r.pax} nəfər${r.tableName ? ' · ' + esc(r.tableName) : ''}</p>
      <p class="yzi-hint">Saxta bronların qarşısını almaq üçün təsdiqdən əvvəl qonağa zəng edin.</p>
      <a class="yzi-btn yzrv-call" href="tel:+${esc(phoneKey(r.phone))}">${I('phone')} Zəng et: ${esc(r.phone)}</a>
      <div class="yzrv-confirm-btns">
        <button type="button" class="yzi-btn yzi-btn--gold" data-c="wa">${I('check')} Təsdiqlə və WhatsApp mesajı göndər</button>
        <button type="button" class="yzi-btn" data-c="ok">${I('check')} Yalnız təsdiqlə</button>
        <button type="button" class="yzi-btn" data-c="noanswer">Cavab vermədi</button>
        <button type="button" class="yzi-btn yzi-btn--red" data-c="reject">Rədd et</button>
      </div>`,
    actions: [{ label: 'Bağla', cancel: true, cls: 'yzi-btn--ghost' }]
  });
  m.body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-c]'); if (!b) return;
    const c = b.dataset.c;
    if (c === 'wa') { window.open(waLink(r, S.msgConfirm), '_blank', 'noopener'); }
    if (c === 'wa' || c === 'ok') {
      await setStatus(r, 'confirmed', c === 'wa' ? { confirmMsgAt: Date.now() } : {}, c === 'wa' ? 'WhatsApp mesajı açıldı' : null);
      showToast(`${I('check')} Təsdiqləndi`); m.close();
    } else if (c === 'noanswer') {
      await hist(r.id, 'call', 'Zəng edildi — cavab vermədi');
      await RV.child(r.id).update({ lastCallAt: Date.now(), callTries: (r.callTries || 0) + 1 });
      showToast('Qeyd edildi: cavab vermədi'); m.close();
    } else if (c === 'reject') { m.close(); rejectFlow(r); }
  });
}
function rejectFlow(r) {
  modal({
    title: 'Rezervi rədd et',
    body: `<p class="yzi-p"><b>${esc(r.guestName)}</b> · ${fmtDT(r.at)}</p>
      <label class="yzi-f"><span>Səbəb</span><select id="rjWhy">
        <option value="full">Bu vaxta yer yoxdur</option><option value="spam">Saxta / spam bron</option>
        <option value="noanswer">Əlaqə saxlamaq mümkün olmadı</option><option value="other">Digər</option></select></label>
      <label class="yzi-f"><span>Qeyd</span><input type="text" id="rjNote" maxlength="150"></label>`,
    actions: [{ label: 'Geri', cancel: true, cls: 'yzi-btn--ghost' },
      { label: 'Rədd et', cls: 'yzi-btn--red', onClick: async (b) => {
        const why = b.querySelector('#rjWhy'), note = b.querySelector('#rjNote').value.trim();
        await setStatus(r, 'rejected', { rejectReason: why.value }, [why.options[why.selectedIndex].text, note].filter(Boolean).join(' — '));
        showToast('Rezerv rədd edildi');
      } }]
  });
}
function cancelFlow(r, noshow = false) {
  if (!can('reserve.cancel')) { showToast(`${I('ban')} İcazəniz yoxdur`); return; }
  modal({
    title: noshow ? 'Qonaq gəlmədi' : 'Rezervi ləğv et',
    body: `<p class="yzi-p"><b>${esc(r.guestName)}</b> · ${fmtDT(r.at)} · ${r.pax} nəfər</p>
      ${noshow ? '<p class="yzi-hint">Bu qeyd qonağın kartında saxlanılır. Növbəti bronda xəbərdarlıq çıxacaq.</p>' : ''}
      <label class="yzi-f"><span>Səbəb / qeyd</span><input type="text" id="cnNote" maxlength="150" placeholder="${noshow ? 'məs: zəng edildi, cavab yoxdur' : 'məs: qonaq zəng edib ləğv etdi'}"></label>`,
    actions: [{ label: 'Geri', cancel: true, cls: 'yzi-btn--ghost' },
      { label: noshow ? 'Gəlmədi qeyd et' : 'Ləğv et', cls: 'yzi-btn--red', onClick: async (b) => {
        await setStatus(r, noshow ? 'noshow' : 'cancelled', {}, b.querySelector('#cnNote').value.trim());
        showToast(noshow ? 'Qeyd edildi: gəlmədi' : 'Rezerv ləğv edildi');
      } }]
  });
}
function pickTable(r, title = 'Masa seçin') {
  return new Promise(resolve => {
    const free = tablesSorted().filter(t => !t.occupant);
    if (!free.length) { showToast(`${I('warning')} Boş masa yoxdur`); resolve(null); return; }
    let done = false;
    const fit = (t) => (t.capacity ? (t.capacity >= r.pax ? t.capacity - r.pax : 99) : 50);
    const m = modal({
      title,
      body: `<p class="yzi-hint">${esc(r.guestName)} · ${r.pax} nəfər. Uyğun tutumlu masalar öndədir.</p>
        <div class="yzrv-pick">${free.sort((a, b) => fit(a) - fit(b)).map(t => {
          const c = findConflict(list(), { id: r.id, tableId: t.id, at: Math.max(Date.now(), r.at), dur: r.durationMin || 120 });
          return `<button type="button" class="yzrv-pick__i${c ? ' is-warn' : ''}" data-t="${esc(t.id)}"><b>${esc(t.name)}</b>
            <small>${esc(t.category || '')}${t.capacity ? ' · ' + t.capacity + ' nəfər' : ''}${minOf(t) ? ' · min ' + money(minOf(t)) : ''}${c ? ` · ⚠ ${fmtT(c.at)}-da bronlu` : ''}</small></button>`;
        }).join('')}</div>`,
      actions: [{ label: 'Ləğv', cancel: true, cls: 'yzi-btn--ghost' }],
      onClose: () => { if (!done) resolve(null); }
    });
    m.body.addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (!b) return; done = true; m.close(); resolve(tableOf(b.dataset.t)); });
  });
}
async function assignTable(r) {
  const t = await pickTable(r, 'Masa təyin et'); if (!t) return;
  const c = findConflict(list(), { id: r.id, tableId: t.id, at: r.at, dur: r.durationMin || 120 });
  if (c) { showToast(`${I('ban')} ${esc(t.name)} ${fmtT(c.at)}-da ${esc(c.guestName)} üçün bronludur`); return; }
  await RV.child(r.id).update({ tableId: t.id, tableName: t.name, tableCategory: t.category || null, updatedAt: Date.now() });
  await hist(r.id, 'table', `Masa təyin edildi: ${t.name}`);
  showToast(`${I('check')} ${esc(t.name)} təyin edildi`);
}
/* Qonağı oturtmaq: masanı açır və bronu masaya bağlayır */
export async function seat(r, tOverride = null) {
  if (!(can('reserve.create') || can('reserve.confirm'))) { showToast(`${I('ban')} İcazəniz yoxdur`); return; }
  let t = tOverride || tableOf(r.tableId);
  if (t?.occupant) { showToast(`${I('warning')} ${esc(t.name)} hazırda doludur. Başqa masa seçin.`); t = null; }
  if (!t) t = await pickTable(r, 'Qonağı hansı masaya oturdaq?');
  if (!t) return;
  const fresh = (await R.tables.child(t.id).once('value')).val();
  if (fresh?.occupant) { showToast(`${I('warning')} ${esc(t.name)} artıq doludur`); return; }
  const u = me(); const now = Date.now();
  const sessionId = `${t.id}_${now}`;
  const note = [`Rezerv: ${r.guestName} · ${r.pax} nəfər`, OCCASIONS[r.occasion] && r.occasion ? OCCASIONS[r.occasion] : '', r.note || ''].filter(Boolean).join(' · ');
  await R.tables.child(t.id).update({ occupant: u.id, activatedAt: now, sessionId, openedById: u.id, openedByName: u.name, reservationId: r.id, notes: fresh?.notes ? fresh.notes + ' · ' + note : note });
  addLog('table_open', `${u.name} "${t.name}" masasını rezerv qonağı üçün açdı (${r.guestName}, ${r.pax} nəfər)`, { tableId: t.id, sessionId, waiterId: u.id, reservationId: r.id });
  await setStatus(r, 'seated', { tableId: t.id, tableName: t.name, tableCategory: t.category || null, sessionId }, `Masa: ${t.name}`);
  showToast(`${I('check')} ${esc(r.guestName)} → ${esc(t.name)}`);
}
/* Masada olan bron: masa bağlananda "Bitdi" olur; masa köçürülübsə izlənir */
function syncSeated() {
  list().filter(r => r.status === 'seated' && r.sessionId).forEach(r => {
    const t = (state.tables || []).find(x => x.sessionId === r.sessionId);
    if (t) {
      if (t.id !== r.tableId) RV.child(r.id).update({ tableId: t.id, tableName: t.name });
      return;
    }
    if (!(state.tables || []).length) return;
    RV.child(r.id).child('status').transaction(cur => (cur === 'seated' ? 'done' : undefined), (e, ok) => {
      if (e || !ok) return;
      RV.child(r.id).update({ doneAt: Date.now() });
      RV.child(r.id).child('history').push({ at: Date.now(), byId: 'system', byName: 'Sistem', action: 'done', note: 'Masa bağlandı' });
      const old = tableOf(r.tableId);
      if (old?.reservationId === r.id) R.tables.child(old.id).child('reservationId').remove();
    });
  });
}

/* ═══ 7. DETAL PƏNCƏRƏSİ ═══ */
function actionsFor(r) {
  const a = [];
  const op = can('reserve.create') || can('reserve.confirm');
  const late = r.at < Date.now();
  if (r.status === 'pending' && can('reserve.confirm')) a.push(['confirm', 'Təsdiqlə', 'gold']);
  if (r.status === 'confirmed' && op) a.push(['arrived', 'Gəldi', 'gold']);
  if (['confirmed', 'arrived'].includes(r.status) && op) a.push(['seat', 'Oturt', r.status === 'arrived' ? 'gold' : '']);
  if (UPCOMING.includes(r.status) && !r.tableId && can('reserve.create')) a.push(['assign', 'Masa təyin et', '']);
  if (r.status === 'confirmed' && late && can('reserve.cancel')) a.push(['noshow', 'Gəlmədi', 'red']);
  return a;
}
async function runAction(r, k) {
  if (k === 'confirm') return confirmFlow(r);
  if (k === 'arrived') { await setStatus(r, 'arrived'); showToast(`${I('check')} ${esc(r.guestName)} gəldi`); return; }
  if (k === 'seat') return seat(r);
  if (k === 'assign') return assignTable(r);
  if (k === 'noshow') return cancelFlow(r, true);
  if (k === 'cancel') return cancelFlow(r, false);
  if (k === 'edit') return openForm(r);
  if (k === 'remind') { window.open(waLink(r, S.msgRemind), '_blank', 'noopener'); await hist(r.id, 'remind', 'WhatsApp xatırlatması açıldı'); await RV.child(r.id).update({ remindAt: Date.now() }); return; }
  if (k === 'reject') return rejectFlow(r);
  if (k === 'detail') return openDetail(r.id);
}
const HACT = { created: 'Yaradıldı', edited: 'Dəyişdirildi', table: 'Masa', call: 'Zəng', remind: 'Xatırlatma', ack: 'Bildiriş görüldü' };
function openDetail(id) {
  const r0 = LIVE[id] ? { id, ...LIVE[id] } : Object.values(PAST).map(d => d[id] && { id, ...d[id] }).find(Boolean);
  if (!r0) return;
  const r = r0;
  const histRows = Object.values(r.history || {}).sort((a, b) => a.at - b.at).map(h =>
    `<div class="audit-timeline-item"><div class="audit-timeline-time">${fmtD(h.at)}<br>${fmtT(h.at)}</div><div class="audit-timeline-text"><b>${esc(STATUS[h.action]?.l || HACT[h.action] || h.action)}</b> — ${esc(h.byName || '')}${h.note ? `<br><small>${esc(h.note)}</small>` : ''}</div></div>`).join('');
  const acts = actionsFor(r);
  const more = [];
  if (UPCOMING.includes(r.status) && can('reserve.create')) more.push(['edit', 'Dəyiş']);
  if (r.status === 'confirmed') more.push(['remind', 'WhatsApp xatırlatma']);
  if (r.status === 'pending' && can('reserve.confirm')) more.push(['reject', 'Rədd et']);
  if (UPCOMING.includes(r.status) && can('reserve.cancel')) more.push(['cancel', 'Ləğv et']);
  const m = modal({
    title: `${esc(r.guestName)} — ${fmtDT(r.at)}`,
    wide: true,
    body: `<div class="yzrv-det">
      <span class="yzrv-pill st-${STATUS[r.status]?.c}">${STATUS[r.status]?.l || r.status}</span>
      <div class="ct-detail-info-grid">
        <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Tarix və saat</div><div class="ct-detail-info-block__value">${fmtDT(r.at)} – ${fmtT(r.at + (r.durationMin || 120) * MIN)}</div></div>
        <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Nəfər</div><div class="ct-detail-info-block__value">${r.pax}</div></div>
        <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Masa</div><div class="ct-detail-info-block__value">${esc(r.tableName || 'Təyin edilməyib')}</div></div>
        <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Telefon</div><div class="ct-detail-info-block__value"><a href="tel:+${esc(phoneKey(r.phone))}">${esc(r.phone)}</a></div></div>
        <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Mənbə</div><div class="ct-detail-info-block__value">${esc(SOURCES[r.source] || r.source || '—')}</div></div>
        <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Qəbul edən</div><div class="ct-detail-info-block__value">${esc(r.createdByName || '—')}<br><small>${r.createdAt ? fmtDT(r.createdAt) : ''}</small></div></div>
      </div>
      ${r.occasion ? `<p class="yzi-p">${I('gift')} ${esc(OCCASIONS[r.occasion] || r.occasion)}</p>` : ''}
      ${r.note ? `<p class="yzi-p">${I('note')} ${esc(r.note)}</p>` : ''}
      ${minOf(tableOf(r.tableId)) ? `<p class="yzi-p">${I('money')} Minimum hesab: <b>${money(minOf(tableOf(r.tableId)))}</b></p>` : ''}
      <div class="yzrv-det__acts">${acts.map(([k, l, c]) => `<button type="button" class="yzi-btn ${c ? 'yzi-btn--' + c : ''}" data-a="${k}">${l}</button>`).join('')}
        ${more.map(([k, l]) => `<button type="button" class="yzi-btn yzi-btn--ghost" data-a="${k}">${l}</button>`).join('')}</div>
      <div class="ct-detail-section-title">Tarixçə</div>
      <div class="audit-timeline">${histRows || '<p class="yzi-hint">Qeyd yoxdur.</p>'}</div>
    </div>`,
    actions: [{ label: 'Bağla', cancel: true, cls: 'yzi-btn--ghost' }]
  });
  m.body.addEventListener('click', (e) => { const b = e.target.closest('[data-a]'); if (!b) return; m.close(); runAction(r, b.dataset.a); });
}

/* ═══ 8. ƏSAS PANEL (Rəhbər bölməsi və işçi ekranı eyni görünüşü işlədir) ═══ */
const view = { date: dayKey(Date.now()), mode: 'list', allTables: false };
const hosts = new Set();
function dayList(key) {
  if (toTs(key, '00:00') >= liveFrom()) return list().filter(r => dayKey(r.at) === key).sort((a, b) => a.at - b.at);
  return Object.entries(PAST[key] || {}).map(([id, r]) => ({ id, ...r })).sort((a, b) => a.at - b.at);
}
async function loadPast(key) {
  if (toTs(key, '00:00') >= liveFrom() || PAST[key]) return;
  PAST[key] = {};
  const s = await RV.orderByChild('at').startAt(toTs(key, '00:00')).endAt(toTs(key, '23:59') + 59999).once('value');
  PAST[key] = s.val() || {};
  refreshViews();
}
function itemHtml(r) {
  const now = Date.now(), m = Math.round((r.at - now) / MIN);
  const st = STATUS[r.status] || { l: r.status, c: '' };
  const acts = actionsFor(r).slice(0, 2);
  const hot = UPCOMING.includes(r.status) && dayKey(r.at) === dayKey(now) ? stage(r, now) : '';
  return `<div class="yzrv-item st-${st.c}${hot ? ' yzrv-item--' + hot : ''}" data-open="${esc(r.id)}">
    <div class="yzrv-item__time"><b>${fmtT(r.at)}</b><small>${UPCOMING.includes(r.status) && Math.abs(m) < 24 * 60 ? esc(leftText(m)) : fmtT(r.at + (r.durationMin || 120) * MIN)}</small></div>
    <div class="yzrv-item__main">
      <div class="yzrv-item__name">${esc(r.guestName)}${r.occasion ? ` <span class="yzrv-chip">${esc(OCCASIONS[r.occasion] || '')}</span>` : ''}${r.source === 'online' ? ' <span class="yzrv-chip is-warn">Onlayn</span>' : ''}</div>
      <div class="yzrv-item__meta">${r.pax} nəfər · ${r.tableName ? esc(r.tableName) : '<i>masa təyin edilməyib</i>'} · ${esc(r.phone)}</div>
      ${r.note ? `<div class="yzrv-item__note">${esc(r.note)}</div>` : ''}
    </div>
    <div class="yzrv-item__side"><span class="yzrv-pill st-${st.c}">${st.l}</span>
      <div class="yzrv-item__acts">${acts.map(([k, l, c]) => `<button type="button" class="yzi-btn yzi-btn--sm ${c ? 'yzi-btn--' + c : ''}" data-act="${k}" data-id="${esc(r.id)}">${l}</button>`).join('')}</div>
    </div></div>`;
}
function timelineHtml(rows) {
  const tl = rows.filter(r => !['cancelled', 'rejected'].includes(r.status));
  let h0 = 12, h1 = 24;
  tl.forEach(r => { const d = new Date(r.at); h0 = Math.min(h0, d.getHours()); h1 = Math.max(h1, Math.ceil(d.getHours() + d.getMinutes() / 60 + (r.durationMin || 120) / 60)); });
  h1 = Math.min(h1, 30);
  const base = toTs(view.date, '00:00'), span = (h1 - h0) * 60;
  const pos = (t) => ((t - base) / MIN - h0 * 60) / span * 100;
  const used = new Set(tl.map(r => r.tableId || '_'));
  const tables = tablesSorted().filter(t => view.allTables || used.has(t.id));
  const rowsDef = [...tables.map(t => ({ id: t.id, name: t.name, cap: t.capacity })), ...(used.has('_') ? [{ id: '_', name: 'Masasız' }] : [])];
  const nowP = dayKey(Date.now()) === view.date ? pos(Date.now()) : -1;
  const hours = []; for (let h = h0; h < h1; h++) hours.push(h % 24);
  return `<div class="yzrv-tl"><div class="yzrv-tl__inner" style="--cols:${h1 - h0}">
    <div class="yzrv-tl__head"><span></span><div class="yzrv-tl__hours">${hours.map(h => `<i>${p2(h)}</i>`).join('')}</div></div>
    ${rowsDef.map(row => `<div class="yzrv-tl__row"><span class="yzrv-tl__lbl">${esc(row.name)}${row.cap ? `<small>${row.cap}n</small>` : ''}</span>
      <div class="yzrv-tl__track">${tl.filter(r => (r.tableId || '_') === row.id).map(r => {
        const l = Math.max(0, pos(r.at)), w = Math.min(100 - l, ((r.durationMin || 120) / span) * 100);
        return `<button type="button" class="yzrv-tl__blk st-${STATUS[r.status]?.c}" style="left:${l}%;width:${w}%" data-open="${esc(r.id)}" title="${esc(r.guestName)} · ${fmtT(r.at)}">${fmtT(r.at)} ${esc(r.guestName)} · ${r.pax}n</button>`;
      }).join('')}${nowP >= 0 && nowP <= 100 ? `<b class="yzrv-tl__now" style="left:${nowP}%"></b>` : ''}</div></div>`).join('') || '<p class="yzi-hint">Bu gün üçün bron yoxdur.</p>'}
  </div></div>`;
}
function render(host) {
  if (!host) return;
  hosts.add(host);
  loadPast(view.date);
  const rows = dayList(view.date);
  const act = rows.filter(r => !['cancelled', 'rejected'].includes(r.status));
  const pend = list().filter(r => r.status === 'pending' && r.at > Date.now() - 2 * 60 * MIN).sort((a, b) => a.at - b.at);
  const today = dayKey(Date.now());
  const wd = ['Bazar', 'Bazar ertəsi', 'Çərşənbə axşamı', 'Çərşənbə', 'Cümə axşamı', 'Cümə', 'Şənbə'][new Date(toTs(view.date, '12:00')).getDay()];
  const focus = document.activeElement && host.contains(document.activeElement) ? document.activeElement.id : null;
  host.innerHTML = `<div class="yzrv">
    <div class="yzrv-top">
      <div class="yzrv-date">
        <button type="button" class="yzi-btn yzi-btn--sm" data-nav="-1" aria-label="Əvvəlki gün">‹</button>
        <input type="date" id="yzrvDate" value="${esc(view.date)}" aria-label="Tarix">
        <button type="button" class="yzi-btn yzi-btn--sm" data-nav="1" aria-label="Növbəti gün">›</button>
        ${view.date !== today ? '<button type="button" class="yzi-btn yzi-btn--sm yzi-btn--ghost" data-nav="0">Bu gün</button>' : ''}
        <span class="yzrv-wd">${wd}</span>
      </div>
      <div class="yzrv-seg" role="tablist">
        <button type="button" class="${view.mode === 'list' ? 'is-on' : ''}" data-mode="list">Siyahı</button>
        <button type="button" class="${view.mode === 'tl' ? 'is-on' : ''}" data-mode="tl">Zaman cədvəli</button>
      </div>
      <div class="yzrv-topbtns">
        ${can('reserve.create') ? `<button type="button" class="yzi-btn yzi-btn--gold" data-new>${I('plus')} Yeni rezerv</button>` : ''}
        ${isRehber() ? `<button type="button" class="yzi-btn yzi-btn--ghost" data-settings aria-label="Ayarlar">${I('settings')}</button>` : ''}
      </div>
    </div>
    <div class="yzrv-kpis">
      <div><small>Rezerv</small><b>${act.length}</b></div>
      <div><small>Qonaq</small><b>${act.reduce((s, r) => s + (+r.pax || 0), 0)}</b></div>
      <div><small>Gözləyən təsdiq</small><b class="${pend.length ? 'yzi-warn' : ''}">${pend.length}</b></div>
      <div><small>Gəlmədi</small><b class="${rows.some(r => r.status === 'noshow') ? 'yzi-bad' : ''}">${rows.filter(r => r.status === 'noshow').length}</b></div>
    </div>
    ${pend.length ? `<div class="yzrv-pend"><div class="yzrv-pend__h">${I('bell')} Təsdiq gözləyənlər (${pend.length})</div>${pend.map(r => itemHtml(r).replace('<b>' + fmtT(r.at) + '</b>', `<b>${fmtT(r.at)}</b><small>${fmtD(r.at)}</small>`)).join('')}</div>` : ''}
    ${view.mode === 'tl' ? `<label class="yzi-check yzrv-all"><input type="checkbox" data-all ${view.allTables ? 'checked' : ''}> Bütün masaları göstər</label>${timelineHtml(rows)}`
      : `<div class="yzrv-list">${rows.length ? rows.map(itemHtml).join('') : `<div class="yzrv-empty">${I('clock')}<b>${fmtD(toTs(view.date, '12:00'))} üçün rezerv yoxdur</b>${can('reserve.create') ? '<span>"Yeni rezerv" ilə əlavə edin.</span>' : ''}</div>`}</div>`}
  </div>`;
  if (focus) host.querySelector('#' + focus)?.focus?.();
  if (!host.dataset.yzrvBound) {
    host.dataset.yzrvBound = '1';
    host.addEventListener('click', (e) => {
      const t = e.target;
      const act = t.closest('[data-act]');
      if (act) { e.stopPropagation(); const r = list().find(x => x.id === act.dataset.id); if (r) runAction(r, act.dataset.act); return; }
      const nav = t.closest('[data-nav]');
      if (nav) { view.date = nav.dataset.nav === '0' ? dayKey(Date.now()) : shiftDay(view.date, +nav.dataset.nav); refreshViews(); return; }
      const md = t.closest('[data-mode]'); if (md) { view.mode = md.dataset.mode; refreshViews(); return; }
      if (t.closest('[data-new]')) { openForm(null, { at: view.date !== dayKey(Date.now()) ? toTs(view.date, '19:00') : undefined }); return; }
      if (t.closest('[data-settings]')) { openSettings(); return; }
      const op = t.closest('[data-open]'); if (op) openDetail(op.dataset.open);
    });
    host.addEventListener('change', (e) => {
      if (e.target.id === 'yzrvDate' && e.target.value) { view.date = e.target.value; refreshViews(); }
      if (e.target.matches('[data-all]')) { view.allTables = e.target.checked; refreshViews(); }
    });
  }
}
function refreshViews() {
  hosts.forEach(h => {
    if (!h.isConnected) { hosts.delete(h); return; }
    const visible = h.closest('.admin-section.active') || h.closest('.yzrv-screen.is-open');
    if (visible) render(h);
  });
}
/* Ayarlar mərkəzindən də açılır (Sistem → Ayarlar → Bölmələrin ayarları) */
window.yzRsvSettings = () => openSettings();
function openSettings() {
  modal({
    title: `${I('settings')} Rezerv ayarları`,
    wide: true,
    body: `<div class="yzi-grid2">
        <label class="yzi-f"><span>Restoranın adı (mesajlarda)</span><input type="text" id="sName" value="${esc(S.restaurantName)}" maxlength="80"></label>
        <label class="yzi-f"><span>Masalar arası hazırlıq (dəq)</span><input type="number" id="sBuf" min="0" max="120" value="${esc(S.buffer)}"></label>
      </div>
      <div class="yzi-grid3">
        <label class="yzi-f"><span>1–2 nəfər (dəq)</span><input type="number" id="sD2" min="15" value="${esc(S.dur2)}"></label>
        <label class="yzi-f"><span>3–4 nəfər (dəq)</span><input type="number" id="sD4" min="15" value="${esc(S.dur4)}"></label>
        <label class="yzi-f"><span>5+ nəfər (dəq)</span><input type="number" id="sDL" min="15" value="${esc(S.durL)}"></label>
      </div>
      <label class="yzi-f"><span>Təsdiq mesajı</span><textarea id="sMC" rows="3">${esc(S.msgConfirm)}</textarea></label>
      <label class="yzi-f"><span>Xatırlatma mesajı</span><textarea id="sMR" rows="3">${esc(S.msgRemind)}</textarea></label>
      <p class="yzi-hint">Mesajda istifadə olunanlar: {ad} {tarix} {saat} {nəfər} {masa} {restoran}</p>`,
    actions: [{ label: 'Ləğv', cancel: true, cls: 'yzi-btn--ghost' },
      { label: 'Yadda saxla', cls: 'yzi-btn--gold', onClick: async (b) => {
        const n = (id, d) => { const v = parseInt(b.querySelector(id).value, 10); return v >= 0 ? v : d; };
        await SETTINGS.set({ restaurantName: b.querySelector('#sName').value.trim(), buffer: n('#sBuf', 15), dur2: n('#sD2', 90), dur4: n('#sD4', 120), durL: n('#sDL', 150),
          msgConfirm: b.querySelector('#sMC').value.trim() || DEF.msgConfirm, msgRemind: b.querySelector('#sMR').value.trim() || DEF.msgRemind });
        addLog('settings', 'Rezerv ayarları dəyişdirildi', {});
        showToast(`${I('check')} Yadda saxlanıldı`);
      } }]
  });
}

/* Rəhbər paneli: menyuda "Rezervasiyalar" bölməsi */
const T0 = Date.now();
function ensureAdminSection() {
  const box = $('adminTabsContainer'), body = $('adminBody');
  if (!box || !body) return;
  if (!$('sec-reservations')) {
    const s = document.createElement('div');
    s.className = 'admin-section'; s.id = 'sec-reservations';
    s.innerHTML = '<div class="yzrv-host"></div>';
    body.appendChild(s);
  }
  const shellReady = box.dataset.yzShell || Date.now() - T0 > 5000;
  let b = $('yzrvAdminTab');
  if (b && !b.isConnected) b = null;
  if (!b && shellReady && can('reserve.view')) {
    b = document.createElement('button');
    b.type = 'button'; b.id = 'yzrvAdminTab'; b.className = 'admin-tab yzrv-admin-tab'; b.dataset.section = 'reservations';
    b.innerHTML = `${I('clock')} <span>Rezervasiyalar</span><span class="yz-side-badge" data-yzrv-badge hidden></span>`;
    b.addEventListener('click', () => window.adminTab('reservations', b));
    const zal = box.querySelector('.yz-zal-tab');
    if (zal) zal.insertAdjacentElement('afterend', b); else box.prepend(b);
  }
}
function wrapAdminTab() {
  if (window.__yzrvWrapped) return;
  if (typeof window.adminTab !== 'function') return;
  if (!window.__yzShellWrapped && Date.now() - T0 < 5000) return;   // əvvəl Rəhbər paneli qabığı öz bükməsini etsin
  window.__yzrvWrapped = true;
  const orig = window.adminTab;
  window.adminTab = function (sec, el) {
    if (sec !== 'reservations') return orig(sec, el);
    orig(sec, el || $('yzrvAdminTab'));
    const t = $('apPageTitle'); if (t) t.textContent = 'Rezervasiyalar';
    render($('sec-reservations')?.querySelector('.yzrv-host'));
  };
}

/* İşçi ekranı: "Rezervlər" düyməsi və tam ekran pəncərə */
function ensureStaffBtn() {
  const head = document.querySelector('#waiterScreen .waiter-header');
  if (!head) return;
  let b = $('yzrvStaffBtn');
  if (!can('reserve.view')) { b?.remove(); return; }
  if (b) return;
  b = document.createElement('button');
  b.id = 'yzrvStaffBtn'; b.type = 'button'; b.className = 'btn btn-ghost yzrv-staff-btn';
  b.innerHTML = `${I('clock')} <span>Rezervlər</span><span class="yzrv-badge" hidden></span>`;
  b.addEventListener('click', openScreen);
  head.insertBefore(b, $('themeToggleBtnWaiter') || null);
}
function updateStaffBtn() {
  const now = Date.now(), today = dayKey(now);
  const n = list().filter(r => UPCOMING.includes(r.status) && dayKey(r.at) === today && r.at > now - 60 * MIN).length;
  const p = list().filter(r => r.status === 'pending' && r.at > now).length;
  const set = (el, v, warn) => { if (!el) return; el.hidden = !v; el.textContent = v > 99 ? '99+' : String(v); el.classList.toggle('is-warn', !!warn); };
  set($('yzrvStaffBtn')?.querySelector('.yzrv-badge'), p || n, p > 0);
  set(document.querySelector('[data-yzrv-badge]'), p, true);
}
function openScreen() {
  let s = $('yzrvScreen');
  if (!s) {
    s = document.createElement('div');
    s.id = 'yzrvScreen'; s.className = 'yzrv-screen';
    s.innerHTML = `<div class="yzrv-screen__bar"><b>${I('clock')} Rezervasiyalar</b><button type="button" class="btn btn-ghost yz-icon-only" data-close aria-label="Bağla" title="Bağla">${I('close')}</button></div><div class="yzrv-host"></div>`;
    s.querySelector('[data-close]').addEventListener('click', () => s.classList.remove('is-open'));
    document.body.appendChild(s);
  }
  view.date = dayKey(Date.now());
  s.classList.add('is-open');
  render(s.querySelector('.yzrv-host'));
}

/* ═══ 9. BİLDİRİŞLƏR (artan xəbərdarlıq) ═══ */
const LEVELS = [
  { k: '60', m: 60, lvl: 'info', t: '1 saat qalıb' },
  { k: '30', m: 30, lvl: 'warn', t: '30 dəq qalıb — masanı hazırlayın' },
  { k: '15', m: 15, lvl: 'warn', t: '15 dəq qalıb' },
  { k: '0', m: 0, lvl: 'alert', t: 'Qonağın gəlmə vaxtıdır' },
  { k: 'late', m: -15, lvl: 'alert', t: '15 dəq gecikir — zəng edin' }
];
const FKEY = 'yzrv_fired';
const fired = (() => { try { return JSON.parse(localStorage.getItem(FKEY) || '{}'); } catch (e) { return {}; } })();
const saveFired = () => { try { const cut = Date.now() - 3 * 86400000; Object.keys(fired).forEach(k => { if ((fired[k]?.t || 0) < cut) delete fired[k]; }); localStorage.setItem(FKEY, JSON.stringify(fired)); } catch (e) { /* */ } };
let actx = null;
function beep(lvl) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const n = lvl === 'alert' ? 3 : lvl === 'warn' ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = lvl === 'alert' ? 880 : 660;
      o.connect(g); g.connect(actx.destination);
      const t0 = actx.currentTime + i * 0.32;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.24);
      o.start(t0); o.stop(t0 + 0.26);
    }
    if (lvl !== 'info') navigator.vibrate?.(lvl === 'alert' ? [250, 120, 250, 120, 250] : [200, 100, 200]);
  } catch (e) { /* səs bloklanıb */ }
}
function alertBox() {
  let b = $('yzrvAlerts');
  if (!b) { b = document.createElement('div'); b.id = 'yzrvAlerts'; b.className = 'yzrv-alerts'; b.setAttribute('aria-live', 'assertive'); document.body.appendChild(b); }
  return b;
}
function showAlert(key, r, lvl, text) {
  const box = alertBox();
  if (box.querySelector(`[data-k="${CSS.escape(key)}"]`)) return;
  if (!key.endsWith(':p')) box.querySelectorAll(`.yzrv-alert[data-id="${CSS.escape(r.id)}"]`).forEach(el => {
    if (!el.dataset.k.endsWith(':p')) { clearInterval(el._rep); el.remove(); }   // köhnə səviyyə yenisi ilə əvəz olunur
  });
  const t = tableOf(r.tableId);
  const d = document.createElement('div');
  d.className = `yzrv-alert yzrv-alert--${lvl}`; d.dataset.k = key; d.dataset.id = r.id;
  d.innerHTML = `<div class="yzrv-alert__h">${I(lvl === 'alert' ? 'warning' : 'clock')} <b>${esc(text)}</b><small>${fmtDT(Date.now())}</small></div>
    <div class="yzrv-alert__b"><b>${fmtT(r.at)}</b> · ${esc(r.guestName)} · ${r.pax} nəfər · ${esc(r.tableName || 'masa təyin edilməyib')}
      ${t?.occupant && r.at > Date.now() && key.indexOf('p_') !== 0 ? '<br><span class="yzi-bad">Masa hazırda doludur — boşaldılmalıdır</span>' : ''}</div>
    <div class="yzrv-alert__f"><button type="button" class="yzi-btn yzi-btn--sm" data-see>Bax</button><button type="button" class="yzi-btn yzi-btn--sm yzi-btn--gold" data-ok>Gördüm</button></div>`;
  d.querySelector('[data-ok]').addEventListener('click', () => ackAlert(key, r, d));
  d.querySelector('[data-see]').addEventListener('click', () => { openDetail(r.id); });
  box.prepend(d);
  beep(lvl);
  if (lvl === 'alert') d._rep = setInterval(() => { if (d.isConnected) beep('alert'); else clearInterval(d._rep); }, 60000);
}
function ackAlert(key, r, el) {
  clearInterval(el?._rep); el?.remove();
  const u = me();
  const lv = key.split(':')[1] || 'p';
  RV.child(r.id).child('acks').child(lv).set({ byId: u.id, byName: u.name, at: Date.now() });
  hist(r.id, 'ack', `${LEVELS.find(l => l.k === lv)?.t || 'Yeni bron bildirişi'}`);
}
function checkAlerts() {
  if (!started || !state.user) return;
  const notify = isRehber() || can('reserve.notify');
  const confirmer = isRehber() || can('reserve.confirm');
  const now = Date.now();
  const box = $('yzrvAlerts');
  // artıq aktual olmayan pəncərələri sil
  box?.querySelectorAll('.yzrv-alert').forEach(el => {
    const r = LIVE[el.dataset.id]; const lv = el.dataset.k.split(':')[1] || 'p';
    const stale = !r || (lv === 'p' ? r.status !== 'pending' : !UPCOMING.includes(r.status)) || r.acks?.[lv];
    if (stale) { clearInterval(el._rep); el.remove(); }
  });
  list().forEach(r => {
    if (confirmer && r.status === 'pending' && r.at > now - 60 * MIN && r.createdById !== me().id && !r.acks?.p) {
      const key = `${r.id}:p`;
      if (!fired[key]) { fired[key] = { t: now }; saveFired(); }
      showAlert(key, r, 'warn', r.source === 'online' ? 'Yeni onlayn bron — təsdiq gözləyir' : 'Yeni bron — təsdiq gözləyir');
    }
    if (!notify || !UPCOMING.includes(r.status)) return;
    const m = (r.at - now) / MIN;
    if (m > 60 || m < -60) return;
    const cur = LEVELS.filter(l => m <= l.m).pop();
    if (!cur) return;
    const key = `${r.id}:${cur.k}`;
    if (r.acks?.[cur.k]) return;
    if (!fired[key]) { fired[key] = { t: now }; saveFired(); if (cur.lvl === 'info') { showToast(`${I('clock')} Rezerv ${fmtT(r.at)} — ${esc(r.guestName)} · ${esc(r.tableName || 'masasız')} · ${cur.t}`); beep('info'); return; } }
    if (cur.lvl !== 'info') showAlert(key, r, cur.lvl, cur.t);
  });
}

/* ═══ BAŞLANĞIC ═══ */
function tick() {
  if (state.user) start();
  watchGrid(); hookPayment(); paymentNote(); ticketNote(); tableSettingsBox();
  ensureAdminSection(); wrapAdminTab(); ensureStaffBtn();
}
function slowTick() { if (!started) return; decorate(); checkAlerts(); syncSeated(); updateStaffBtn(); refreshViews(); }
function init() {
  setInterval(tick, 1000);
  setInterval(slowTick, 20000);
  tick();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
window.yzReserve = { openForm, openScreen, seat };
