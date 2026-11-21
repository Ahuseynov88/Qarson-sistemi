/* ═══════════════════════════════════════════
   YUZA POS — AD GÜNLƏRİ XATIRLATMASI (C13 · 21.11.2026)
   • İşçilər: bu gün ad günü olan işçi hamıya kiçik təbrik lövhəsində göstərilir;
     ad günü olan işçinin özünə "Ad gününüz mübarək!" çıxır. Yalnız gün və ay görünür (il/yaş yox).
   • Rəhbər və "Ad günlərini görmək" (birthday.view) icazəsi olan şəxs: günün ilk girişində
     bu gün + yaxın 7 günün ad günləri (işçilər və loyallıq müştəriləri) pəncərəsi, səs ilə
     (Bildiriş səsləri → "Ad günü xatırlatması"). İstənilən vaxt: ⋮ → "Ad günləri".
   • İşçinin tam doğum tarixi şəxsi bölmədə (staffHR) qalır; staff/{id}/bday = "AA-GG" yalnız
     xatırlatma üçündür. Köhnə qeydlər Rəhbər girəndə avtomatik köçürülür.
   • Müştərinin ad günü hədiyyəsi (endirim) ayrıca: yuza-birthday.js.
═══════════════════════════════════════════ */
import { db } from './firebase-service.js';
import { state } from './state.js';
import { hasPermission } from './permissions.js';
import { modal } from './yuza-inv-ui.js';
import { playNotifSound } from './notifSounds.js';

const AHEAD = 7;
const DAY = 86400000;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const p2 = (n) => String(n).padStart(2, '0');
const I = (id) => `<svg class="icon"><use href="#i-${id}"></use></svg>`;
const WD = ['bazar', 'bazar ertəsi', 'çərşənbə axşamı', 'çərşənbə', 'cümə axşamı', 'cümə', 'şənbə'];

const me = () => state.user || null;
const isAdmin = () => me()?.role === 'admin';
export const canView = () => !!me() && hasPermission('birthday.view');
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };

/* "AA-GG" və ya "İİİİ-AA-GG" → bu gündən neçə gün sonra (0 = bu gün), 0..365 */
export function daysUntil(md, now = Date.now()) {
  const m = /^(?:(\d{4})-)?(\d{2})-(\d{2})$/.exec(String(md || ''));
  if (!m) return null;
  const mon = +m[2] - 1, day = +m[3];
  const t = new Date(now), today = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  for (const y of [t.getFullYear(), t.getFullYear() + 1]) {
    let d = new Date(y, mon, day);
    if (d.getMonth() !== mon) d = new Date(y, mon + 1, 0);        // 29 fevral → 28 fevral
    const diff = Math.round((d.getTime() - today) / DAY);
    if (diff >= 0) return { diff, date: d, year: m[1] ? +m[1] : null };
  }
  return null;
}
const when = (x) => x.diff === 0 ? '<b class="yz-bd-today">Bu gün</b>' : x.diff === 1 ? 'Sabah' : `${x.diff} gün sonra · ${WD[x.date.getDay()]}`;
const dm = (d) => `${p2(d.getDate())}.${p2(d.getMonth() + 1)}`;

/* ── İşçilərin "AA-GG" köçürülməsi (yalnız staffHR-i oxuya bilən: Rəhbər / İşçilər icazəsi) ── */
let mirrorAt = 0;
async function mirror() {
  if (!(isAdmin() || hasPermission('panel.staff')) || Date.now() - mirrorAt < 10 * 60000) return;
  mirrorAt = Date.now();
  try {
    const hr = (await db.ref('staffHR').once('value')).val() || {};
    const up = {};
    (state.staff || []).forEach(s => {
      const b = hr[s.id]?.birthDate, md = /^\d{4}-\d{2}-\d{2}$/.test(b || '') ? b.slice(5) : null;
      if ((s.bday || null) !== md) up[`staff/${s.id}/bday`] = md;
    });
    if (Object.keys(up).length) await db.ref().update(up);
  } catch (e) { /* icazə yoxdursa — keçilir */ }
}

/* ── Siyahı ── */
function staffList() {
  return (state.staff || []).filter(s => s.status !== 'offline' && s.bday)
    .map(s => ({ kind: 'staff', id: s.id, name: s.name || '?', sub: s.position || '', ...daysUntil(s.bday) }))
    .filter(x => x.diff != null);
}
let custCache = { at: 0, list: [], denied: false };
async function custList() {
  if (Date.now() - custCache.at < 5 * 60000) return custCache;
  try {
    const all = (await db.ref('loyaltyCustomers').once('value')).val() || {};
    const list = Object.entries(all).filter(([, c]) => c?.birthDate).map(([id, c]) => {
      const x = daysUntil(c.birthDate);
      return x && { kind: 'cust', id, name: [c.firstName, c.lastName].filter(Boolean).join(' ') || '?', sub: c.phone || '', age: x.year ? x.date.getFullYear() - x.year : null, ...x };
    }).filter(Boolean);
    custCache = { at: Date.now(), list, denied: false };
  } catch (e) { custCache = { at: Date.now(), list: [], denied: true }; }
  return custCache;
}
async function upcoming() {
  const c = await custList();
  const all = [...staffList(), ...c.list].filter(x => x.diff <= AHEAD).sort((a, b) => a.diff - b.diff || a.name.localeCompare(b.name, 'az'));
  return { all, denied: c.denied };
}
export const todayCount = () => staffList().filter(x => x.diff === 0).length + custCache.list.filter(x => x.diff === 0).length;

/* ── Pəncərə: bu gün + yaxın 7 gün ── */
export async function openList() {
  const { all, denied } = await upcoming();
  const row = (x) => `<li class="yz-bd-row${x.diff === 0 ? ' is-today' : ''}">
      <span class="yz-bd-ico" aria-hidden="true">${x.kind === 'staff' ? I('user') : I('users')}</span>
      <span class="yz-bd-main"><b>${esc(x.name)}</b><small>${x.kind === 'staff' ? 'İşçi' : 'Müştəri'}${x.sub ? ' · ' + esc(x.sub) : ''}${x.age ? ` · ${x.age} yaşı tamam olur` : ''}</small></span>
      <span class="yz-bd-when"><b>${dm(x.date)}</b><small>${when(x)}</small></span></li>`;
  modal({
    title: `${I('star')} Ad günləri`,
    body: `<div class="yz-bd">
      ${all.length ? `<ul class="yz-bd-list">${all.map(row).join('')}</ul>` : `<p class="yzi-empty">Bu gün və yaxın ${AHEAD} gündə ad günü yoxdur.</p>`}
      <p class="yzi-hint">Bu gün və yaxın ${AHEAD} gün. İşçinin doğum tarixi: Qeydiyyat → İşçilər → işçi → Şəxsi məlumatlar. Müştərininki: Loyallıq.
        ${denied ? '<br><b>Müştərilərin ad günü sizə görünmür</b> — müştəri bazasına baxmaq icazəniz yoxdur.' : ''}</p></div>`,
    actions: [{ label: 'Bağla', cancel: true }]
  });
}

/* ── Bu gün ad günü olan işçilər: hamıya kiçik təbrik lövhəsi (gündə bir dəfə) ── */
function greet() {
  const u = me(); if (!u) return;
  const today = staffList().filter(x => x.diff === 0);
  if (!today.length) return;
  const k = `yzBdGreet:${u.role}:${u.id || 'admin'}:${todayKey()}`;
  try { if (localStorage.getItem(k)) return; localStorage.setItem(k, '1'); } catch (e) { /* */ }
  const mine = today.find(x => x.id === u.id);
  const others = today.filter(x => x.id !== u.id);
  const box = document.createElement('div');
  box.className = 'yz-bd-greet'; box.setAttribute('role', 'status');
  box.innerHTML = `<span class="yz-bd-greet__ico" aria-hidden="true">🎂</span><div>
      ${mine ? `<b>Ad gününüz mübarək, ${esc(u.firstname || u.name)}!</b>` : ''}
      ${others.length ? `<span>Bu gün ad günü: <b>${others.map(x => esc(x.name)).join(', ')}</b>. Təbrik etməyi unutmayın!</span>` : ''}</div>
    <button type="button" aria-label="Bağla" title="Bağla">${I('close')}</button>`;
  document.body.appendChild(box);
  const close = () => box.remove();
  box.querySelector('button').onclick = close;
  setTimeout(close, 20000);
}

/* ── Günün ilk girişi: icazəli şəxsə siyahı + səs ── */
async function remind() {
  const u = me(); if (!u || !canView()) return;
  const k = `yzBdList:${u.role}:${u.id || 'admin'}:${todayKey()}`;
  try { if (localStorage.getItem(k)) return; } catch (e) { /* */ }
  const { all } = await upcoming();
  if (!all.some(x => x.diff === 0)) return;          // bu gün heç kimin ad günü yoxdursa narahat etmir
  try { localStorage.setItem(k, '1'); } catch (e) { /* */ }
  try { playNotifSound('birthday_reminder'); } catch (e) { /* */ }
  openList();
}

/* ⋮ menyusu */
window.__yzDotsExtra = window.__yzDotsExtra || [];
window.__yzDotsExtra.push(() => {
  if (!canView()) return null;
  const n = todayCount();
  return { k: 'x:bdays', l: n ? `Ad günləri (${n} bu gün)` : 'Ad günləri', i: 'star', run: openList };
});

/* İstifadəçi dəyişəndə (giriş) — işçi siyahısı yüklənəndən sonra */
let userKey = null, pending = null;
setInterval(() => {
  const u = me();
  const key = u ? `${u.role}:${u.id || 'admin'}` : null;
  if (key !== userKey) {
    userKey = key; clearTimeout(pending);
    document.querySelector('.yz-bd-greet')?.remove();
    custCache = { at: 0, list: [], denied: false };
    if (!u) return;
    pending = setTimeout(async () => {
      if (document.getElementById('loginScreen')?.classList.contains('active')) return;
      await mirror();
      greet();
      if (canView()) { await custList(); remind(); }
    }, 2500);
  }
}, 1000);
window.__yzBdays = { openList, daysUntil };
