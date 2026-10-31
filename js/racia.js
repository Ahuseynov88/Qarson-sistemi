/* ═══════════════════════════════════════════
   RACİA — "Bas-danış" səsli əlaqə (Zello tipli)
   Ofisiantlar bir-biri ilə, admin isə hamı ilə qısa səsli mesajla danışır.

   • Ad üzərinə basıb saxla → səs yalnız o işçiyə gedir
   • "HAMIYA" düyməsinə basıb saxla → səs hamıya gedir
   • Gələn səs tətbiq açıq olanda avtomatik səslənir
   • Admin bütün mesajları (şəxsi daxil) görür və dinləyə bilir
   • Mesajlar 3 gün saxlanılır, sonra avtomatik silinir
   • Ofisiant girişində ekran sönmür (Wake Lock)

   Firebase strukturu (iki ayrı node — siyahı yüngül qalsın, səs yalnız lazım olanda yüklənsin):
     raciaMeta/{id}  = { from, fromName, to, toName, dur, mime, ts }
     raciaAudio/{id} = "data:audio/...;base64,..."
   Mövcud modullara toxunmur. app.js yalnız raciaStart()/raciaStop() çağırır.
═══════════════════════════════════════════ */
import { db } from './firebase-service.js';
import { state } from './state.js';
import { esc, showToast } from './utils.js';

const META  = db.ref('raciaMeta');
const AUDIO = db.ref('raciaAudio');

const KEEP_MS  = 3 * 24 * 60 * 60 * 1000; // 3 gün
const MAX_SEC  = 15;                      // bir mesajın maksimum uzunluğu
const MIN_MS   = 600;                     // bundan qısa basış "səhvən basma" sayılır
const BITRATE  = 24000;                   // ~3 KB/saniyə — baza yüngül qalsın
const LIST_MAX_STAFF = 300;
const LIST_MAX_ADMIN = 1000;

const ICON = (id) => `<svg class="icon"><use href="#${id}"></use></svg>`;
const MIC_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';
const PLAY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>';

/* ── Vəziyyət ── */
let active = false;
let isAdmin = false;
let myId = null;
let myName = '';
let metaQuery = null;
let initialLoaded = false;
let msgs = [];              // görünən mesajların meta siyahısı
let queue = [];             // avtomatik səslənəcək mesajlar
let playing = false;
let player = null;
let audioUnlocked = false;
let silentUrl = null;
let wakeLock = null;
let wakeBusy = false;
let rec = null;             // aktiv səs yazısı
let pressToken = 0;
let panelOpen = false;
let unread = 0;
let peopleSig = '';
let sigTimer = null;
let adminLiveAll = false;
let adminFilter = '';
let secObserver = null;
let renderTimer = null;
const urlCache = new Map(); // id -> objectURL

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
  msgs = []; queue = []; unread = 0; playing = false; peopleSig = '';
  try { adminLiveAll = localStorage.getItem('rc_liveAll') === '1'; } catch (e) { adminLiveAll = false; }

  ensureDom();
  ensurePlayer();

  metaQuery = META.orderByChild('ts').limitToLast(isAdmin ? LIST_MAX_ADMIN : LIST_MAX_STAFF);
  metaQuery.on('child_added', onMetaAdded, onListenError);
  metaQuery.on('child_removed', onMetaRemoved);
  // Eyni sorğuda "value" hadisəsi ilkin child_added-lərdən SONRA gəlir — bundan sonrakılar YENİ mesajdır
  metaQuery.once('value', () => { initialLoaded = true; scheduleRender(); }, () => { initialLoaded = true; });

  ['touchend', 'click', 'pointerup', 'keydown'].forEach(ev => document.addEventListener(ev, onGesture, true));
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
  cancelRecording();
  if (metaQuery) { metaQuery.off(); metaQuery = null; }
  ['touchend', 'click', 'pointerup', 'keydown'].forEach(ev => document.removeEventListener(ev, onGesture, true));
  document.removeEventListener('visibilitychange', onVisibility);
  clearInterval(sigTimer); sigTimer = null;
  clearTimeout(renderTimer); renderTimer = null;
  if (secObserver) { secObserver.disconnect(); secObserver = null; }
  releaseWake();
  if (player) { try { player.pause(); } catch (e) {} }
  queue = []; playing = false; msgs = []; unread = 0;
  urlCache.forEach(u => URL.revokeObjectURL(u)); urlCache.clear();
  closePanel();
  hideNow();
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

function onMetaAdded(snap) {
  const v = snap.val();
  if (!v || typeof v !== 'object') return;
  const m = { id: snap.key, ...v };
  if (!visibleToMe(m)) return;
  const last = msgs[msgs.length - 1];
  msgs.push(m);
  if (last && (last.ts || 0) > (m.ts || 0)) msgs.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  if (initialLoaded && shouldAutoPlay(m)) {
    queue.push(m);
    if (!isAdmin && !panelOpen) { unread++; updateBadge(); }
    vibrate([60, 40, 60]);
    playNext();
  }
  scheduleRender();
}

function onMetaRemoved(snap) {
  const id = snap.key;
  msgs = msgs.filter(m => m.id !== id);
  queue = queue.filter(m => m.id !== id);
  const u = urlCache.get(id);
  if (u) { URL.revokeObjectURL(u); urlCache.delete(id); }
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

/* ═══════════════ SƏS YAZMA (bas-danış) ═══════════════ */

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  // AAC/MP4 həm iPhone-da, həm Android-də oxunur — ona görə birinci seçilir
  const list = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  for (const t of list) {
    try { if (MediaRecorder.isTypeSupported(t)) return t; } catch (e) {}
  }
  return '';
}

async function startTalk(target, btn) {
  if (!active || rec) return;
  if (!navigator.mediaDevices?.getUserMedia || pickMime() === null) {
    showToast(ICON('i-error') + ' Bu brauzer səs yazmanı dəstəkləmir');
    return;
  }
  const token = ++pressToken;
  pausePlaybackForTalk();
  rec = { target, btn, starting: true, released: false, cancelled: false, chunks: [], stream: null, recorder: null, startedAt: 0, timer: null };
  btn?.classList.add('rc-pressed');
  showRec(target, true);

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (e) {
    if (rec && token === pressToken) { btn?.classList.remove('rc-pressed'); rec = null; hideRec(); }
    const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    showToast(ICON('i-error') + (denied ? ' Mikrofona icazə verilməyib. Brauzer ayarlarından icazə verin.' : ' Mikrofon açılmadı'));
    resumePlayback();
    return;
  }

  // İcazə gözlənərkən barmaq buraxılıbsa və ya yeni basış başlayıbsa — dayandır
  if (!rec || token !== pressToken || rec.released || rec.cancelled) {
    stream.getTracks().forEach(t => t.stop());
    if (rec && token === pressToken) {
      btn?.classList.remove('rc-pressed'); rec = null; hideRec();
      showToast(ICON('i-warning') + ' Düyməni basıb SAXLAYIN, sonra danışın');
    }
    resumePlayback();
    return;
  }

  const mime = pickMime();
  let recorder;
  try {
    recorder = mime ? new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: BITRATE }) : new MediaRecorder(stream, { audioBitsPerSecond: BITRATE });
  } catch (e) {
    try { recorder = new MediaRecorder(stream); } catch (e2) {
      stream.getTracks().forEach(t => t.stop());
      btn?.classList.remove('rc-pressed'); rec = null; hideRec();
      showToast(ICON('i-error') + ' Səs yazmaq mümkün olmadı');
      resumePlayback();
      return;
    }
  }

  rec.stream = stream;
  rec.recorder = recorder;
  rec.mime = recorder.mimeType || mime || '';
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) rec?.chunks.push(e.data); };
  recorder.onstop = () => finishRecording();
  recorder.start();
  rec.startedAt = Date.now();
  rec.starting = false;
  vibrate(35);
  showRec(target, false);
  rec.timer = setInterval(() => {
    if (!rec || rec.starting) return;
    const sec = (Date.now() - rec.startedAt) / 1000;
    updateRecTime(sec);
    if (sec >= MAX_SEC) releaseTalk();
  }, 200);
}

function releaseTalk() {
  if (!rec) return;
  if (rec.starting) { rec.released = true; return; }
  if (rec.recorder && rec.recorder.state !== 'inactive') {
    try { rec.recorder.stop(); } catch (e) { finishRecording(); }
  }
}

function cancelRecording() {
  if (!rec) return;
  rec.cancelled = true;
  if (rec.starting) { rec.released = true; return; }
  if (rec.recorder && rec.recorder.state !== 'inactive') { try { rec.recorder.stop(); } catch (e) {} }
  else finishRecording();
}

function finishRecording() {
  const r = rec;
  if (!r) return;
  rec = null;
  clearInterval(r.timer);
  r.stream?.getTracks().forEach(t => t.stop());
  r.btn?.classList.remove('rc-pressed');
  hideRec();
  resumePlayback();
  if (r.cancelled) return;

  const ms = Date.now() - r.startedAt;
  if (ms < MIN_MS) { showToast(ICON('i-warning') + ' Çox qısa idi — düyməni basıb saxlayaraq danışın'); return; }
  const type = (r.mime || r.chunks[0]?.type || 'audio/mp4');
  const blob = new Blob(r.chunks, { type });
  if (blob.size < 300) { showToast(ICON('i-warning') + ' Səs yazılmadı, yenidən cəhd edin'); return; }

  const reader = new FileReader();
  reader.onload = () => sendVoice(r.target, String(reader.result || ''), Math.min(MAX_SEC, ms / 1000), type);
  reader.onerror = () => showToast(ICON('i-error') + ' Səs hazırlana bilmədi');
  reader.readAsDataURL(blob);
}

function sendVoice(target, dataUrl, durSec, mime) {
  if (!active || !dataUrl.startsWith('data:')) return;
  const key = META.push().key;
  const meta = {
    from: myId, fromName: myName,
    to: target.id, toName: target.name,
    dur: Math.round(durSec * 10) / 10,
    mime: String(mime || '').split(';')[0],
    ts: firebase.database.ServerValue.TIMESTAMP
  };
  // Səs + meta EYNİ anda yazılır (atomik) — qəbul edən meta-nı görəndə səs artıq hazır olur
  db.ref().update({ ['raciaAudio/' + key]: dataUrl, ['raciaMeta/' + key]: meta })
    .then(() => showToast(ICON('i-check') + ` Göndərildi → ${esc(target.name)}`))
    .catch(err => {
      console.warn('[Racia] Göndərilmədi:', err);
      showToast(ICON('i-error') + ' Göndərilmədi: ' + esc(err?.message || 'xəta'));
    });
}

/* ═══════════════ SƏSLƏNDİRMƏ ═══════════════ */

function ensurePlayer() {
  if (player) return;
  player = new Audio();
  player.preload = 'auto';
  player.setAttribute('playsinline', '');
  player.addEventListener('ended', onPlayDone);
  player.addEventListener('error', () => { if (playing) onPlayDone(); });
}

function makeSilentWav() {
  const n = 800;
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  w(36, 'data'); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

// iPhone və Android brauzerləri səsi yalnız istifadəçi ekrana toxunduqdan sonra
// buraxır. İlk toxunuşda səssiz qısa səs çalıb "kilidi açırıq".
function onGesture() {
  if (!active) return;
  if (!isAdmin && !wakeLock) requestWake();
  if (audioUnlocked || playing) return;
  ensurePlayer();
  if (!silentUrl) silentUrl = makeSilentWav();
  player.src = silentUrl;
  const p = player.play();
  if (p && p.then) {
    p.then(() => {
      // Bu arada əsl səs başlayıbsa onu dayandırmırıq — yalnız səssiz "açar" səsini
      if (player.src === silentUrl) { try { player.pause(); } catch (e) {} }
      audioUnlocked = true;
      if (queue.length) setTimeout(playNext, 50);
    }).catch(() => {});
  }
}

function urlFromDataUrl(dataUrl) {
  const comma = dataUrl.indexOf(',');
  const head = dataUrl.slice(0, comma);
  const mime = (head.match(/^data:([^;,]+)/) || [])[1] || 'audio/mp4';
  const bin = atob(dataUrl.slice(comma + 1));
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([arr], { type: mime }));
}

async function getAudioUrl(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  const snap = await AUDIO.child(id).once('value');
  const d = snap.val();
  if (typeof d !== 'string' || !d.startsWith('data:')) return null;
  const url = urlFromDataUrl(d);
  urlCache.set(id, url);
  if (urlCache.size > 40) {
    const [oldId, oldUrl] = urlCache.entries().next().value;
    URL.revokeObjectURL(oldUrl); urlCache.delete(oldId);
  }
  return url;
}

async function playNext() {
  if (!active || playing || rec || !queue.length) return;
  const item = queue[0];
  playing = true;
  try {
    const url = await getAudioUrl(item.id);
    if (!active) return;
    if (!url) { queue.shift(); playing = false; playNext(); return; }
    showNow(item, false);
    player.src = url;
    await player.play();
    queue.shift();
    if (!isAdmin && panelOpen) { unread = 0; updateBadge(); }
  } catch (e) {
    playing = false;
    if (e && e.name === 'NotAllowedError') {
      audioUnlocked = false;
      showNow(item, true); // "dinləmək üçün toxunun"
      return;
    }
    console.warn('[Racia] Səsləndirilmədi:', e);
    queue.shift();
    hideNow();
    setTimeout(playNext, 200);
  }
}

function onPlayDone() {
  playing = false;
  hideNow();
  setTimeout(playNext, 250);
}

async function playManual(id) {
  const m = msgs.find(x => x.id === id);
  if (!m) return;
  if (rec) return;
  try { player.pause(); } catch (e) {}
  playing = true;
  queue = queue.filter(x => x.id !== id);
  try {
    const url = await getAudioUrl(id);
    if (!url) { playing = false; showToast(ICON('i-warning') + ' Bu səs artıq silinib'); return; }
    showNow(m, false);
    player.src = url;
    await player.play();
    audioUnlocked = true;
  } catch (e) {
    playing = false;
    hideNow();
    showToast(ICON('i-error') + ' Səsləndirilmədi');
  }
}

function pausePlaybackForTalk() {
  if (playing) { try { player.pause(); } catch (e) {} playing = false; hideNow(); }
}

function resumePlayback() {
  setTimeout(playNext, 300);
}

function stopCurrent() {
  try { player.pause(); } catch (e) {}
  playing = false;
  hideNow();
  setTimeout(playNext, 200);
}

/* ═══════════════ EKRAN OYAQ (Wake Lock) ═══════════════ */

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
  if (document.visibilityState === 'visible') {
    requestWake();
    setTimeout(playNext, 300);
  }
}

function vibrate(p) {
  try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {}
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
  if (!active || rec) return;
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
    bindPtt(bg);
    bindPlay(bg);
    document.body.appendChild(bg);
  }

  if (!document.getElementById('rcRec')) {
    const r = document.createElement('div');
    r.id = 'rcRec';
    r.className = 'rc-rec';
    r.innerHTML = `
      <div class="rc-rec__card">
        <div class="rc-rec__mic">${MIC_SVG}</div>
        <div class="rc-rec__to" id="rcRecTo"></div>
        <div class="rc-rec__time" id="rcRecTime">0:00 / 0:${MAX_SEC}</div>
        <div class="rc-rec__bar"><i id="rcRecBar"></i></div>
        <div class="rc-rec__hint" id="rcRecHint">Buraxın — göndərilsin</div>
      </div>`;
    document.body.appendChild(r);
  }

  if (!document.getElementById('rcNow')) {
    const n = document.createElement('button');
    n.type = 'button';
    n.id = 'rcNow';
    n.className = 'rc-now';
    n.addEventListener('click', () => {
      if (n.classList.contains('rc-now--tap')) { onGesture(); setTimeout(playNext, 120); }
      else stopCurrent();
    });
    document.body.appendChild(n);
  }
}

// Bas-saxla düymələri (panel və admin bölməsi üçün ümumi)
function bindPtt(root) {
  root.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('[data-ptt]');
    if (!btn || !root.contains(btn)) return;
    if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    const target = targetById(btn.dataset.ptt);
    if (!target) return;
    try { btn.setPointerCapture(e.pointerId); } catch (err) {}
    onGesture();
    startTalk(target, btn);
  });
  const up = (e) => { if (e.target.closest?.('[data-ptt]') && rec) releaseTalk(); };
  root.addEventListener('pointerup', up);
  root.addEventListener('pointercancel', up);
  root.addEventListener('lostpointercapture', up);
  root.addEventListener('contextmenu', (e) => { if (e.target.closest('[data-ptt]')) e.preventDefault(); });
}

function bindPlay(root) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rc-play]');
    if (!b || !root.contains(b)) return;
    e.preventDefault();
    playManual(b.dataset.rcPlay);
  });
}

function openPanel() {
  if (!active) return;
  onGesture();
  panelOpen = true;
  unread = 0; updateBadge();
  peopleSig = '';
  renderPeople(document.getElementById('rcPeople'));
  renderHistStaff();
  document.getElementById('rcPanel')?.classList.add('open');
}

function closePanel() {
  if (rec) cancelRecording();
  panelOpen = false;
  document.getElementById('rcPanel')?.classList.remove('open');
}

function updateBadge() {
  const b = document.getElementById('rcFabBadge');
  if (!b) return;
  b.hidden = !(unread > 0);
  b.textContent = unread > 9 ? '9+' : String(unread);
}

function showRec(target, starting) {
  const el = document.getElementById('rcRec');
  if (!el) return;
  document.getElementById('rcRecTo').textContent = target.id === 'all' ? '→ HAMIYA' : '→ ' + target.name;
  document.getElementById('rcRecHint').textContent = starting ? 'Mikrofon açılır…' : 'Danışın. Buraxanda göndəriləcək';
  updateRecTime(0);
  el.classList.toggle('rc-rec--live', !starting);
  el.classList.add('open');
}

function updateRecTime(sec) {
  const t = document.getElementById('rcRecTime');
  const bar = document.getElementById('rcRecBar');
  const s = Math.floor(sec);
  if (t) t.textContent = `0:${String(s).padStart(2, '0')} / 0:${MAX_SEC}`;
  if (bar) bar.style.width = Math.min(100, (sec / MAX_SEC) * 100) + '%';
}

function hideRec() {
  document.getElementById('rcRec')?.classList.remove('open', 'rc-rec--live');
}

function showNow(m, needTap) {
  const el = document.getElementById('rcNow');
  if (!el) return;
  const to = m.to === 'all' ? 'Hamıya' : (m.to === myId ? 'Sizə' : esc(m.toName || ''));
  el.innerHTML = needTap
    ? `${PLAY_SVG}<span><b>Yeni səsli mesaj</b> — ${esc(m.fromName || '')}. Dinləmək üçün toxunun</span>`
    : `<span class="rc-now__wave"><i></i><i></i><i></i><i></i></span><span><b>${esc(m.fromName || '')}</b> → ${to}</span><small>Dayandır</small>`;
  el.classList.toggle('rc-now--tap', !!needTap);
  el.classList.add('open');
}

function hideNow() {
  document.getElementById('rcNow')?.classList.remove('open', 'rc-now--tap');
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
  if (!el || rec) return;
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
  const priv = m.to !== 'all';
  return `
    <div class="rc-row${fromMe ? ' rc-row--me' : ''}">
      <button type="button" class="rc-play" data-rc-play="${esc(m.id)}" aria-label="Dinlə">${PLAY_SVG}</button>
      <div class="rc-row__txt">
        <b>${from} → ${to}</b>
        <small>${fmtTime(m.ts)} · ${Number(m.dur || 0).toFixed(0)} san${priv && adminView ? ' · <span class="rc-tag">Şəxsi</span>' : ''}</small>
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
            <span><b>Bütün danışıqları canlı dinlə</b><small>Açıq olanda işçilərin bir-birinə göndərdiyi şəxsi mesajlar da bu cihazda avtomatik səslənir</small></span>
            <input type="checkbox" id="rcLiveAll">
          </label>
        </div>
        <div class="table-card rc-admin__card">
          <div class="rc-admin__histhead">
            <h3>${ICON('i-clipboard')} Danışıq tarixçəsi</h3>
            <select id="rcAdminFilter"></select>
          </div>
          <div class="rc-hist rc-hist--admin" id="rcAdminHist"></div>
          <p class="rc-note">Mesajlar 3 gün saxlanılır, sonra avtomatik silinir.</p>
        </div>
      </div>`;
    body.dataset.built = '1';
    // Dinləyicilər element üzərində qalır — təkrar girişdə ikiqat bağlanmasın
    if (!body.dataset.rcBound) { bindPtt(body); bindPlay(body); body.dataset.rcBound = '1'; }
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
    const opts = [['', 'Hamısı'], ['all', 'Yalnız "Hamıya" mesajları'], ...[...names.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'az'))];
    const sig = opts.map(o => o[0]).join(',');
    if (sel.dataset.sig !== sig) {
      sel.innerHTML = opts.map(([v, n]) => `<option value="${esc(v)}">${esc(n)}</option>`).join('');
      sel.dataset.sig = sig;
    }
    sel.value = adminFilter;
    if (sel.value !== adminFilter) { adminFilter = ''; sel.value = ''; }
  }
  let list = msgs;
  if (adminFilter === 'all') list = list.filter(m => m.to === 'all');
  else if (adminFilter) list = list.filter(m => m.from === adminFilter || m.to === adminFilter);
  list = list.slice().reverse().slice(0, 300);
  el.innerHTML = list.length ? list.map(m => histRow(m, true)).join('') : '<p class="rc-empty">Bu filtrə uyğun mesaj yoxdur.</p>';
}

window.renderRaciaAdmin = renderRaciaAdmin;
