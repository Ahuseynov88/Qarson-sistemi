/* ═══════════════════════════════════════════
   RACİA — "Bas-danış" səsli əlaqə (Zello tipli)
   Ofisiantlar bir-biri ilə, admin isə hamı ilə qısa səsli mesajla danışır.

   • Ad üzərinə basıb saxla → səs yalnız o işçiyə gedir
   • "HAMIYA" düyməsinə basıb saxla → səs hamıya gedir
   • Gələn səs tətbiq açıq olanda avtomatik səslənir
   • Müştərinin masadan göndərdiyi səs masanın ofisiantına burada da gəlir
   • Admin bütün mesajları (şəxsi və müştəri daxil) görür və dinləyə bilir
   • Mesajlar 3 gün saxlanılır, sonra avtomatik silinir
   • Ofisiant girişində ekran sönmür (Wake Lock)

   Səs yazma/səsləndirmə voice-core.js-dədir.
   app.js yalnız raciaStart()/raciaStop() çağırır.
═══════════════════════════════════════════ */
import { db } from './firebase-service.js';
import { state } from './state.js';
import { esc, showToast } from './utils.js';
import {
  initVoiceCore, bindHold, saveVoice, enqueue, dropQueued, clearVoice, playNow,
  cancelHold, isRecording, unlockAudio, ICON, MIC_SVG, PLAY_SVG, KEEP_MS
} from './voice-core.js';

const META = db.ref('raciaMeta');
const LIST_MAX_STAFF = 300;
const LIST_MAX_ADMIN = 1000;

/* ── Vəziyyət ── */
let active = false;
let isAdmin = false;
let myId = null;
let myName = '';
let metaQuery = null;
let initialLoaded = false;
let msgs = [];
let wakeLock = null;
let wakeBusy = false;
let panelOpen = false;
let unread = 0;
let peopleSig = '';
let sigTimer = null;
let adminLiveAll = false;
let adminFilter = '';
let secObserver = null;
let renderTimer = null;

/* ═══════════════ BAŞLAT / DAYANDIR ═══════════════ */

export function raciaStart() {
  const u = state.user;
  if (!u || u.role === 'kitchen') return;
  if (active) raciaStop();

  isAdmin = u.role === 'admin';
  myId = isAdmin ? 'admin' : u.id;
  myName = isAdmin ? 'Admin' : (u.name || 'İşçi');
  if (!myId) return;

  active = true;
  initialLoaded = false;
  msgs = []; unread = 0; peopleSig = '';
  try { adminLiveAll = localStorage.getItem('rc_liveAll') === '1'; } catch (e) { adminLiveAll = false; }

  initVoiceCore();
  ensureDom();

  metaQuery = META.orderByChild('ts').limitToLast(isAdmin ? LIST_MAX_ADMIN : LIST_MAX_STAFF);
  metaQuery.on('child_added', onMetaAdded, onListenError);
  metaQuery.on('child_removed', onMetaRemoved);
  // Eyni sorğuda "value" hadisəsi ilkin child_added-lərdən SONRA gəlir — bundan sonrakılar YENİ mesajdır
  metaQuery.once('value', () => { initialLoaded = true; scheduleRender(); }, () => { initialLoaded = true; });

  ['touchend', 'click', 'pointerup'].forEach(ev => document.addEventListener(ev, onGesture, true));
  document.addEventListener('visibilitychange', onVisibility);

  sigTimer = setInterval(checkPeopleChange, 2000);
  setTimeout(cleanupOld, 5000);

  const fab = document.getElementById('rcFab');
  if (fab) fab.style.display = isAdmin ? 'none' : '';
  updateBadge();

  if (isAdmin) watchAdminSection();
  else requestWake();
}

export function raciaStop() {
  if (!active) return;
  active = false;
  cancelHold();
  if (metaQuery) {
    // Yalnız öz dinləyicilərimiz söndürülür (funksiyasız off() başqa modulların dinləyicilərini də silərdi)
    metaQuery.off('child_added', onMetaAdded);
    metaQuery.off('child_removed', onMetaRemoved);
    metaQuery = null;
  }
  ['touchend', 'click', 'pointerup'].forEach(ev => document.removeEventListener(ev, onGesture, true));
  document.removeEventListener('visibilitychange', onVisibility);
  clearInterval(sigTimer); sigTimer = null;
  clearTimeout(renderTimer); renderTimer = null;
  if (secObserver) { secObserver.disconnect(); secObserver = null; }
  releaseWake();
  clearVoice();
  msgs = []; unread = 0;
  closePanel();
  updateBadge();
  const body = document.getElementById('raciaAdminBody');
  if (body) { body.innerHTML = ''; delete body.dataset.built; }
}

/* ═══════════════ FIREBASE DİNLƏYİCİLƏR ═══════════════ */

function onListenError(err) {
  console.warn('[Racia] Dinləmə xətası:', err);
  if (String(err?.code || err?.message || '').toLowerCase().includes('permission')) {
    showToast(ICON('i-warning') + ' Racia: Firebase icazəsi yoxdur (Rules yoxlanmalıdır)');
  }
}

function visibleToMe(m) {
  if (isAdmin) return true;
  return m.to === 'all' || m.to === myId || m.from === myId;
}

function shouldAutoPlay(m) {
  if (m.from === myId) return false;
  if (isAdmin) return m.to === 'all' || m.to === 'admin' || adminLiveAll;
  return m.to === 'all' || m.to === myId;
}

function toLabel(m) {
  return m.to === 'all' ? 'Hamıya' : (m.to === myId ? 'Sizə' : (m.toName || ''));
}

function onMetaAdded(snap) {
  const v = snap.val();
  if (!v || typeof v !== 'object') return;
  const m = { id: snap.key, ...v };
  if (!visibleToMe(m)) return;
  const last = msgs[msgs.length - 1];
  msgs.push(m);
  if (last && (last.ts || 0) > (m.ts || 0)) msgs.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  if (initialLoaded && shouldAutoPlay(m)) {
    if (!isAdmin && !panelOpen) { unread++; updateBadge(); }
    enqueue({ id: m.id, title: m.fromName || '?', sub: toLabel(m) });
  }
  scheduleRender();
}

function onMetaRemoved(snap) {
  const id = snap.key;
  msgs = msgs.filter(m => m.id !== id);
  dropQueued(q => q.id === id);
  scheduleRender();
}

// 3 gündən köhnə mesajları silir (meta + səs). Hər girişdə bir dəfə, kiçik partiyalarla.
function cleanupOld() {
  if (!active) return;
  const cutoff = Date.now() - KEEP_MS;
  META.orderByChild('ts').endAt(cutoff).limitToFirst(300).once('value').then(snap => {
    const upd = {};
    snap.forEach(c => { upd['raciaMeta/' + c.key] = null; upd['raciaAudio/' + c.key] = null; });
    if (Object.keys(upd).length) return db.ref().update(upd);
  }).catch(err => console.warn('[Racia] Köhnə mesajlar silinmədi:', err));
}

/* ═══════════════ GÖNDƏRMƏ ═══════════════ */

function holdOpts(btn) {
  if (!active) return null;
  const target = targetById(btn.dataset.ptt);
  if (!target) return null;
  return {
    label: target.id === 'all' ? '→ HAMIYA' : '→ ' + target.name,
    onSend: (dataUrl, dur, mime) => {
      if (!active) return;
      saveVoice(dataUrl, dur, mime, { from: myId, fromName: myName, to: target.id, toName: target.name })
        .then(() => showToast(ICON('i-check') + ` Göndərildi → ${esc(target.name)}`))
        .catch(err => {
          console.warn('[Racia] Göndərilmədi:', err);
          showToast(ICON('i-error') + ' Göndərilmədi: ' + esc(err?.message || 'xəta'));
        });
    }
  };
}

/* ═══════════════ EKRAN OYAQ (Wake Lock) ═══════════════ */

function onGesture() {
  if (active && !isAdmin && !wakeLock) requestWake();
}

async function requestWake() {
  if (!active || isAdmin || wakeLock || wakeBusy) return;
  if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  wakeBusy = true;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (!active) { try { lock.release(); } catch (e) {} return; }
    wakeLock = lock;
    lock.addEventListener?.('release', () => { if (wakeLock === lock) wakeLock = null; });
  } catch (e) { wakeLock = null; }
  finally { wakeBusy = false; }
}

function releaseWake() {
  if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
}

function onVisibility() {
  if (document.visibilityState === 'visible') requestWake();
}

/* ═══════════════ İŞÇİ SİYAHISI ═══════════════ */

function targetsList() {
  const list = (state.staff || [])
    .filter(s => s && s.id && s.id !== myId && s.status !== 'offline' && (s.permissions || []).includes('table.view'))
    .map(s => ({ id: s.id, name: s.name || 'İşçi', avatar: s.avatar || '', online: s.status === 'online', position: s.position || '' }))
    .sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name, 'az'));
  if (!isAdmin) list.push({ id: 'admin', name: 'Admin', avatar: '', online: null, position: 'Rəhbərlik' });
  return list;
}

function targetById(id) {
  if (id === 'all') return { id: 'all', name: 'Hamı' };
  return targetsList().find(t => t.id === id) || null;
}

function checkPeopleChange() {
  if (!active || isRecording()) return;
  const sig = targetsList().map(t => `${t.id}:${t.online}:${t.name}`).join('|');
  if (sig === peopleSig) return;
  peopleSig = sig;
  if (panelOpen) renderPeople(document.getElementById('rcPeople'));
  if (isAdmin && adminSectionVisible()) renderPeople(document.getElementById('rcAdminPeople'));
}

/* ═══════════════ DOM ═══════════════ */

function ensureDom() {
  if (!document.getElementById('rcFab')) {
    const host = document.getElementById('waiterScreen');
    if (host) {
      const fab = document.createElement('button');
      fab.type = 'button';
      fab.id = 'rcFab';
      fab.className = 'rc-fab';
      fab.setAttribute('aria-label', 'Racia — səsli əlaqə');
      fab.innerHTML = `${MIC_SVG}<span class="rc-fab__badge" id="rcFabBadge" hidden>0</span>`;
      fab.addEventListener('click', openPanel);
      host.appendChild(fab);
    }
  }

  if (!document.getElementById('rcPanel')) {
    const bg = document.createElement('div');
    bg.id = 'rcPanel';
    bg.className = 'rc-sheet-bg';
    bg.innerHTML = `
      <div class="rc-sheet" role="dialog" aria-label="Racia">
        <div class="rc-sheet__head">
          <div class="rc-sheet__title">${MIC_SVG}<span>Racia</span></div>
          <button type="button" class="rc-x" data-rc-close aria-label="Bağla">${ICON('i-close')}</button>
        </div>
        <button type="button" class="rc-all" data-ptt="all">
          <span class="rc-all__mic">${MIC_SVG}</span>
          <span><b>HAMIYA DANIŞ</b><small>Basıb saxlayın, danışın, buraxın</small></span>
        </button>
        <div class="rc-sec">Şəxsi — ada basıb saxlayın</div>
        <div class="rc-people" id="rcPeople"></div>
        <div class="rc-sec">Son mesajlar</div>
        <div class="rc-hist" id="rcHist"></div>
      </div>`;
    bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-rc-close]')) closePanel(); });
    bindHold(bg, '[data-ptt]', holdOpts);
    bindPlay(bg);
    document.body.appendChild(bg);
  }
}

function bindPlay(root) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rc-play]');
    if (!b || !root.contains(b)) return;
    e.preventDefault();
    const m = msgs.find(x => x.id === b.dataset.rcPlay);
    if (m) playNow({ id: m.id, title: m.fromName || '?', sub: toLabel(m) });
  });
}

function openPanel() {
  if (!active) return;
  unlockAudio();
  panelOpen = true;
  unread = 0; updateBadge();
  peopleSig = '';
  renderPeople(document.getElementById('rcPeople'));
  renderHistStaff();
  document.getElementById('rcPanel')?.classList.add('open');
}

function closePanel() {
  if (isRecording() && panelOpen) cancelHold();
  panelOpen = false;
  document.getElementById('rcPanel')?.classList.remove('open');
}

function updateBadge() {
  const b = document.getElementById('rcFabBadge');
  if (!b) return;
  b.hidden = !(unread > 0);
  b.textContent = unread > 9 ? '9+' : String(unread);
}

/* ═══════════════ RENDER ═══════════════ */

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    if (!active) return;
    if (panelOpen) renderHistStaff();
    if (isAdmin && adminSectionVisible()) renderAdminHist();
  }, 120);
}

function avatarHtml(t) {
  if (t.id === 'admin') return `<span class="rc-ava rc-ava--icon">${ICON('i-admin')}</span>`;
  const fb = `https://ui-avatars.com/api/?name=${encodeURIComponent(t.name)}&background=8e44ad&color=fff&size=96`;
  return `<img class="rc-ava" src="${esc(t.avatar || fb)}" alt="" onerror="this.src='${fb}'">`;
}

function renderPeople(el) {
  if (!el || isRecording()) return;
  const list = targetsList();
  if (!list.length) { el.innerHTML = '<p class="rc-empty">Qeydiyyatda başqa aktiv işçi yoxdur.</p>'; return; }
  el.innerHTML = list.map(t => `
    <button type="button" class="rc-person" data-ptt="${esc(t.id)}">
      ${avatarHtml(t)}
      <span class="rc-person__txt">
        <b>${esc(t.name)}</b>
        <small>${t.online === null ? esc(t.position) : (t.online ? '<i class="rc-dot rc-dot--on"></i>Onlayn' : '<i class="rc-dot"></i>Oflayn')}</small>
      </span>
      <span class="rc-person__mic">${MIC_SVG}</span>
    </button>`).join('');
}

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const hm = d.toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return hm;
  return d.toLocaleDateString('az-AZ', { day: '2-digit', month: '2-digit' }) + ' ' + hm;
}

function histRow(m, adminView) {
  const fromMe = m.from === myId;
  const from = fromMe ? 'Siz' : esc(m.fromName || '?');
  const to = m.to === 'all' ? 'Hamıya' : (m.to === myId ? 'Sizə' : esc(m.toName || '?'));
  const tag = m.tableId ? '<span class="rc-tag rc-tag--cust">Müştəri</span>'
    : (m.to !== 'all' && adminView ? '<span class="rc-tag">Şəxsi</span>' : '');
  return `
    <div class="rc-row${fromMe ? ' rc-row--me' : ''}">
      <button type="button" class="rc-play" data-rc-play="${esc(m.id)}" aria-label="Dinlə">${PLAY_SVG}</button>
      <div class="rc-row__txt">
        <b>${from} → ${to}</b>
        <small>${fmtTime(m.ts)} · ${Number(m.dur || 0).toFixed(0)} san${tag ? ' · ' + tag : ''}</small>
      </div>
    </div>`;
}

function renderHistStaff() {
  const el = document.getElementById('rcHist');
  if (!el) return;
  const list = msgs.slice(-40).reverse();
  el.innerHTML = list.length ? list.map(m => histRow(m, false)).join('') : '<p class="rc-empty">Hələ mesaj yoxdur.</p>';
}

/* ── Admin bölməsi ── */

function adminSectionVisible() {
  return !!document.getElementById('sec-racia')?.classList.contains('active');
}

function watchAdminSection() {
  const sec = document.getElementById('sec-racia');
  if (!sec) return;
  if (secObserver) secObserver.disconnect();
  secObserver = new MutationObserver(() => { if (adminSectionVisible()) renderRaciaAdmin(); });
  secObserver.observe(sec, { attributes: true, attributeFilter: ['class'] });
  if (adminSectionVisible()) renderRaciaAdmin();
}

export function renderRaciaAdmin() {
  const body = document.getElementById('raciaAdminBody');
  if (!body || !active || !isAdmin) return;
  if (!body.dataset.built) {
    body.innerHTML = `
      <div class="rc-admin">
        <div class="table-card rc-admin__card">
          <button type="button" class="rc-all" data-ptt="all">
            <span class="rc-all__mic">${MIC_SVG}</span>
            <span><b>HAMIYA DANIŞ</b><small>Basıb saxlayın, danışın, buraxın</small></span>
          </button>
          <div class="rc-sec">Şəxsi — ada basıb saxlayın</div>
          <div class="rc-people" id="rcAdminPeople"></div>
        </div>
        <div class="table-card rc-admin__card">
          <label class="rc-switchrow">
            <span><b>Bütün danışıqları canlı dinlə</b><small>Açıq olanda işçilərin bir-birinə və müştərilərə göndərdiyi səslər də bu cihazda avtomatik səslənir</small></span>
            <input type="checkbox" id="rcLiveAll">
          </label>
        </div>
        <div class="table-card rc-admin__card">
          <div class="rc-admin__histhead">
            <h3>${ICON('i-clipboard')} Danışıq tarixçəsi</h3>
            <select id="rcAdminFilter"></select>
          </div>
          <div class="rc-hist rc-hist--admin" id="rcAdminHist"></div>
          <p class="rc-note">Səslər 3 gün saxlanılır, sonra avtomatik silinir.</p>
        </div>
      </div>`;
    body.dataset.built = '1';
    // Dinləyicilər element üzərində qalır — təkrar girişdə ikiqat bağlanmasın
    if (!body.dataset.rcBound) { bindHold(body, '[data-ptt]', holdOpts); bindPlay(body); body.dataset.rcBound = '1'; }
    body.querySelector('#rcLiveAll').addEventListener('change', (e) => {
      adminLiveAll = e.target.checked;
      try { localStorage.setItem('rc_liveAll', adminLiveAll ? '1' : '0'); } catch (err) {}
    });
    body.querySelector('#rcAdminFilter').addEventListener('change', (e) => { adminFilter = e.target.value; renderAdminHist(); });
  }
  const live = body.querySelector('#rcLiveAll');
  if (live) live.checked = adminLiveAll;
  peopleSig = '';
  renderPeople(body.querySelector('#rcAdminPeople'));
  renderAdminHist();
}

function renderAdminHist() {
  const el = document.getElementById('rcAdminHist');
  const sel = document.getElementById('rcAdminFilter');
  if (!el) return;
  if (sel) {
    const names = new Map();
    msgs.forEach(m => {
      if (m.from) names.set(m.from, m.fromName || m.from);
      if (m.to && m.to !== 'all') names.set(m.to, m.toName || m.to);
    });
    const opts = [['', 'Hamısı'], ['all', 'Yalnız "Hamıya" mesajları'], ['cust', 'Yalnız müştəri danışıqları'],
      ...[...names.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'az'))];
    const sig = opts.map(o => o[0] + o[1]).join(',');
    if (sel.dataset.sig !== sig) {
      sel.innerHTML = opts.map(([v, n]) => `<option value="${esc(v)}">${esc(n)}</option>`).join('');
      sel.dataset.sig = sig;
    }
    sel.value = adminFilter;
    if (sel.value !== adminFilter) { adminFilter = ''; sel.value = ''; }
  }
  let list = msgs;
  if (adminFilter === 'all') list = list.filter(m => m.to === 'all');
  else if (adminFilter === 'cust') list = list.filter(m => m.tableId);
  else if (adminFilter) list = list.filter(m => m.from === adminFilter || m.to === adminFilter);
  list = list.slice().reverse().slice(0, 300);
  el.innerHTML = list.length ? list.map(m => histRow(m, true)).join('') : '<p class="rc-empty">Bu filtrə uyğun mesaj yoxdur.</p>';
}

window.renderRaciaAdmin = renderRaciaAdmin;
