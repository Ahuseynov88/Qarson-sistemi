/* ═══════════════════════════════════════════
   YUZA POS — İŞÇİLƏRƏ ELANLAR (C14 · 21.11.2026)
   Rəhbər və "İşçilərə elan göndərmək" (announce.send) icazəsi olan şəxs
   bütün işçilərə və ya seçilmiş işçilərə qısa elan göndərir.
   • İşçi sistemə girəndə və ya iş vaxtı yeni elan gələndə pəncərə açılır, səs çalınır
     (səs: Ayarlar → Bildiriş səsləri → "Yeni elan (işçilərə)").
   • İşçi "Oxudum" basır — kim, nə vaxt oxuduğu Rəhbərə görünür.
   • "Vacib" elanı oxumadan bağlamaq olmur.
   • Bütün elanlar: ⋮ menyusu → "Elanlar".
   Baza: announcements/{id} = { text, imp, all, to:{staffId:true}, by, byId, createdAt, reads:{staffId: vaxt}, deleted }
═══════════════════════════════════════════ */
import { db } from './firebase-service.js';
import { state } from './state.js';
import { hasPermission } from './permissions.js';
import { addLog } from './utils.js';
import { modal, confirmBox, ok, fail } from './yuza-inv-ui.js';
import { playNotifSound } from './notifSounds.js';

const ref = db.ref('announcements');
const TS = firebase.database.ServerValue.TIMESTAMP;
const KEEP_DAYS = 30;                 // 30 gündən köhnə elan "oxunmamış" kimi göstərilmir
const MAX_LEN = 1000;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const p2 = (n) => String(n).padStart(2, '0');
const fmtDT = (t) => { if (!t) return '—'; const d = new Date(t); return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const I = (id) => `<svg class="icon"><use href="#i-${id}"></use></svg>`;

const me = () => state.user || null;
const myId = () => (me()?.role === 'admin' ? 'admin' : me()?.id) || null;
const isAdmin = () => me()?.role === 'admin';
export const canSend = () => !!me() && hasPermission('announce.send');

let list = [];            // son elanlar (yenidən köhnəyə)
let userKey = null, off = null, firstLoad = true, showing = false;
const seenNotified = new Set();

const visibleToMe = (a) => {
  const sid = myId();
  if (!a || a.deleted || !sid) return false;
  if (isAdmin() || a.byId === sid) return true;
  return !!(a.all || a.to?.[sid]);
};
const unreadForMe = (a) => {
  const sid = myId();
  if (!visibleToMe(a) || isAdmin() || a.byId === sid) return false;
  if (a.reads?.[sid]) return false;
  return (Number(a.createdAt) || 0) > Date.now() - KEEP_DAYS * 86400000;
};
export const unreadCount = () => list.filter(unreadForMe).length;

/* ── Abunə: istifadəçi dəyişəndə yenidən qurulur ── */
function subscribe() {
  const u = me();
  const key = u ? (u.role + ':' + (u.id || 'admin')) : null;
  if (key === userKey) return;
  userKey = key;
  off?.(); off = null; list = []; firstLoad = true; seenNotified.clear();
  document.querySelector('.yz-ann-pop')?.remove(); showing = false;
  if (!u || (u.role !== 'staff' && u.role !== 'admin')) return;
  const q = ref.orderByKey().limitToLast(60);
  const h = q.on('value', (snap) => {
    const arr = [];
    snap.forEach(c => { arr.push({ id: c.key, ...c.val() }); });
    list = arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const fresh = list.filter(unreadForMe).filter(a => !seenNotified.has(a.id));
    if (fresh.length) { fresh.forEach(a => seenNotified.add(a.id)); try { playNotifSound('staff_announcement'); } catch (e) { /* */ } }
    firstLoad = false;
    paintBadge();
    showNext();
  }, (e) => console.warn('[elan]', e?.message));
  off = () => q.off('value', h);
}

/* ── Oxunmamış elanın pəncərəsi (bir-bir) ── */
function showNext() {
  if (showing) return;
  const a = list.filter(unreadForMe).sort((x, y) => (x.createdAt || 0) - (y.createdAt || 0))[0];
  if (!a) return;
  // Giriş ekranında və ya PIN pəncərəsi açıqkən gözləyir
  if (document.getElementById('loginScreen')?.classList.contains('active')) { setTimeout(showNext, 1500); return; }
  showing = true;
  const left = unreadCount();
  const m = modal({
    title: `${I('bell')} ${a.imp ? 'Vacib elan' : 'Elan'}${left > 1 ? ` <small class="yz-ann-left">1 / ${left}</small>` : ''}`,
    body: `<div class="yz-ann-pop__body${a.imp ? ' is-imp' : ''}">
        <p class="yz-ann-text">${esc(a.text).replace(/\n/g, '<br>')}</p>
        <p class="yz-ann-meta">${esc(a.by || 'Rəhbər')} · ${fmtDT(a.createdAt)}</p></div>`,
    actions: [{ label: `${I('check')} Oxudum`, cls: 'yzi-btn--gold', onClick: async () => { await markRead(a); } }],
    // Vacib elan oxunmadan bağlanmır (✕, fon, Esc, Geri işləmir); adi elanı hər hansı yolla bağlamaq "oxundu" sayılır
    lock: !!a.imp,
    onClose: () => { if (!a.imp && !a.reads?.[myId()]) markRead(a); showing = false; setTimeout(showNext, 300); }
  });
  m.el.classList.add('yz-ann-pop');
  if (a.imp) m.el.classList.add('is-imp');
}
async function markRead(a) {
  const sid = myId(); if (!sid) return;
  a.reads = { ...(a.reads || {}), [sid]: Date.now() };
  try { await ref.child(a.id + '/reads/' + sid).set(TS); } catch (e) { fail('Qeyd edilmədi: ' + (e?.message || e)); }
  paintBadge();
}

/* ── ⋮ menyusunda nişan (oxunmamış sayı) ── */
function paintBadge() {
  const n = unreadCount();
  document.querySelectorAll('.yz-dots').forEach(b => {
    let s = b.querySelector('.yz-dots__badge');
    if (!n) { s?.remove(); return; }
    if (!s) { s = document.createElement('span'); s.className = 'yz-dots__badge'; b.appendChild(s); }
    s.textContent = n > 9 ? '9+' : String(n);
  });
}

/* ── Elanlar siyahısı ── */
export function openList() {
  const mine = list.filter(visibleToMe);
  const staffN = (a) => Object.keys(a.to || {}).length;
  const readN = (a) => Object.keys(a.reads || {}).filter(k => a.to?.[k]).length;
  const canSee = (a) => isAdmin() || a.byId === myId() || canSend();
  const body = document.createElement('div');
  body.className = 'yz-ann-list';
  body.innerHTML = `${canSend() ? `<div class="yzi-actions"><button type="button" class="yzi-btn yzi-btn--gold" data-new>${I('plus')} Yeni elan</button></div>` : ''}
    ${mine.length ? mine.map(a => `<article class="yz-ann-item${a.imp ? ' is-imp' : ''}${unreadForMe(a) ? ' is-new' : ''}">
        <header><b>${esc(a.by || 'Rəhbər')}</b><span>${fmtDT(a.createdAt)}</span>${a.imp ? '<em class="yzi-st yzi-st--bad">Vacib</em>' : ''}</header>
        <p>${esc(a.text).replace(/\n/g, '<br>')}</p>
        <footer>${canSee(a) ? `<button type="button" class="yzi-chipbtn" data-reads="${esc(a.id)}">Oxudu: <b>${readN(a)} / ${staffN(a)}</b> · ${a.all ? 'hamıya' : 'seçilmiş işçilərə'}</button>` : ''}
          ${unreadForMe(a) ? `<button type="button" class="yzi-chipbtn" data-read="${esc(a.id)}">${I('check')} Oxudum</button>` : ''}
          ${(isAdmin() || a.byId === myId()) ? `<button type="button" class="yzi-chipbtn yzi-bad" data-del="${esc(a.id)}" aria-label="Elanı sil">${I('trash')}</button>` : ''}</footer>
      </article>`).join('') : '<p class="yzi-empty">Hələ elan yoxdur.</p>'}`;
  const m = modal({ title: `${I('bell')} Elanlar`, body, wide: true, actions: [{ label: 'Bağla', cancel: true }] });
  const close = () => m.close();
  body.addEventListener('click', async (e) => {
    if (e.target.closest('[data-new]')) { close(); compose(); return; }
    const r = e.target.closest('[data-reads]'); if (r) { showReads(list.find(x => x.id === r.dataset.reads)); return; }
    const rd = e.target.closest('[data-read]'); if (rd) { await markRead(list.find(x => x.id === rd.dataset.read)); close(); openList(); return; }
    const d = e.target.closest('[data-del]');
    if (d) {
      if (!await confirmBox('Elan işçilərin siyahısından silinəcək.', { title: 'Elan silinsin?', okLabel: 'Sil', okCls: 'yzi-btn--danger' })) return;
      try {
        await ref.child(d.dataset.del).update({ deleted: true, deletedBy: me()?.name || 'Rəhbər', deletedAt: TS });
        addLog('announce', `Elan silindi (${me()?.name || 'Rəhbər'})`, { id: d.dataset.del });
        ok('Elan silindi'); close(); setTimeout(openList, 200);
      } catch (x) { fail(x?.message || String(x)); }
    }
  });
  return m;
}
function showReads(a) {
  if (!a) return;
  const ids = Object.keys(a.to || {});
  const nm = (id) => state.staff.find(s => s.id === id)?.name || 'Silinmiş işçi';
  const read = ids.filter(id => a.reads?.[id]).sort((x, y) => a.reads[x] - a.reads[y]);
  const not = ids.filter(id => !a.reads?.[id]).sort((x, y) => nm(x).localeCompare(nm(y), 'az'));
  modal({
    title: 'Kim oxudu',
    body: `<div class="yz-ann-reads">
      <h3 class="yzi-h3">Oxuyub (${read.length})</h3>
      ${read.length ? `<ul>${read.map(id => `<li><b>${esc(nm(id))}</b><span>${fmtDT(a.reads[id])}</span></li>`).join('')}</ul>` : '<p class="yzi-empty">Hələ heç kim.</p>'}
      <h3 class="yzi-h3">Oxumayıb (${not.length})</h3>
      ${not.length ? `<ul class="is-not">${not.map(id => `<li><b>${esc(nm(id))}</b></li>`).join('')}</ul>` : '<p class="yzi-empty">Hamı oxuyub.</p>'}</div>`,
    actions: [{ label: 'Bağla', cancel: true }]
  });
}

/* ── Yeni elan ── */
const eligible = () => state.staff
  .filter(s => s.status !== 'offline' && s.systemAccess !== false && s.id !== myId())
  .sort((a, b) => String(a.name).localeCompare(String(b.name), 'az'));
export function compose() {
  if (!canSend()) { fail('Elan göndərmək icazəniz yoxdur'); return; }
  const people = eligible();
  const mm = modal({
    title: `${I('bell')} Yeni elan`,
    wide: true,
    body: `<div class="yz-ann-form">
      <label class="yzi-f"><span>Mətn</span><textarea id="yzAnnText" rows="4" maxlength="${MAX_LEN}" placeholder="Məsələn: Sabah saat 10:00-da iclas var."></textarea></label>
      <label class="yz-ann-chk"><input type="checkbox" id="yzAnnImp"> <span><b>Vacib</b> — işçi “Oxudum” basmadan pəncərəni bağlaya bilmir</span></label>
      <div class="yz-ann-to" role="radiogroup" aria-label="Kimə">
        <label><input type="radio" name="yzAnnTo" value="all" checked> Bütün işçilərə (${people.length})</label>
        <label><input type="radio" name="yzAnnTo" value="sel"> Seçilmiş işçilərə</label>
      </div>
      <div class="yz-ann-people" id="yzAnnPeople" hidden>
        ${people.length > 8 ? '<input type="search" class="yz-ann-q" placeholder="Ad axtar..." aria-label="İşçi axtar">' : ''}
        ${people.map(s => `<label class="yz-ann-p" data-n="${esc(String(s.name).toLowerCase())}"><input type="checkbox" value="${esc(s.id)}"> <span>${esc(s.name)}</span><small>${esc(s.position || '')}</small></label>`).join('') || '<p class="yzi-empty">İşçi yoxdur.</p>'}
      </div>
      <p class="yzi-hint">Elanı işçi sistemə (PIN ilə) girəndə görür. Sistemə girişi olmayan işçilər (məs. yalnız mətbəx ekranı) siyahıda yoxdur.</p></div>`,
    actions: [
      { label: 'Ləğv et', cancel: true },
      { label: `${I('check')} Göndər`, cls: 'yzi-btn--gold', onClick: async (b) => {
        const text = b.querySelector('#yzAnnText').value.trim();
        if (text.length < 2) { fail('Elanın mətnini yazın'); return false; }
        const all = b.querySelector('input[name="yzAnnTo"]:checked').value === 'all';
        const ids = all ? people.map(s => s.id) : [...b.querySelectorAll('#yzAnnPeople input[type="checkbox"]:checked')].map(x => x.value);
        if (!ids.length) { fail('Ən azı bir işçi seçin'); return false; }
        const to = {}; ids.forEach(id => { to[id] = true; });
        const imp = b.querySelector('#yzAnnImp').checked;
        await ref.push({ text: text.slice(0, MAX_LEN), imp, all, to, by: me()?.name || 'Rəhbər', byId: myId(), createdAt: TS });
        addLog('announce', `Elan göndərildi (${all ? 'bütün işçilərə' : ids.length + ' işçiyə'}${imp ? ', vacib' : ''}): ${text.slice(0, 80)}`, { count: ids.length });
        ok(`Elan göndərildi · ${ids.length} işçi`);
      } }
    ]
  });
  const bg = mm.el;
  const peopleEl = bg?.querySelector('#yzAnnPeople');
  bg?.querySelectorAll('input[name="yzAnnTo"]').forEach(r => r.addEventListener('change', () => { peopleEl.hidden = r.value === 'all' ? r.checked : !r.checked; }));
  const q = bg?.querySelector('.yz-ann-q');
  q?.addEventListener('input', () => { const v = q.value.trim().toLowerCase(); peopleEl.querySelectorAll('.yz-ann-p').forEach(l => { l.hidden = !!v && !l.dataset.n.includes(v); }); });
  setTimeout(() => bg?.querySelector('#yzAnnText')?.focus(), 50);
}

/* ⋮ menyusu üçün bənd */
window.__yzDotsExtra = window.__yzDotsExtra || [];
window.__yzDotsExtra.push(() => {
  const u = me();
  if (!u || (u.role !== 'staff' && u.role !== 'admin')) return null;
  const n = unreadCount();
  return { k: 'x:announce', l: n ? `Elanlar (${n} yeni)` : 'Elanlar', i: 'bell', run: openList };
});

setInterval(() => { subscribe(); paintBadge(); }, 1000);
subscribe();
window.__yzAnnounce = { openList, compose, unreadCount };
