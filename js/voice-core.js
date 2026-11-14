/* ═══════════════════════════════════════════
   SƏS NÜVƏSİ — bas-danış yazma + növbə ilə səsləndirmə
   Həm Racia (işçilər arası), həm də Müştəri ↔ Ofisiant söhbəti bunu istifadə edir.
   Bütün səslər eyni yerdə saxlanılır:
     raciaMeta/{id}  = { from, fromName, to, toName, dur, mime, ts, ... }
     raciaAudio/{id} = "data:audio/...;base64,..."
═══════════════════════════════════════════ */
import { db } from './firebase-service.js';
import { showToast } from './utils.js';

export const KEEP_MS = 3 * 24 * 60 * 60 * 1000; // 3 gün
export const MAX_SEC = 15;                      // bir mesajın maksimum uzunluğu
const MIN_MS  = 600;                            // bundan qısa basış "səhvən basma" sayılır
const BITRATE = 24000;                          // ~3 KB/saniyə — baza yüngül qalsın

export const ICON = (id) => `<svg class="icon"><use href="#${id}"></use></svg>`;
export const MIC_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';
export const PLAY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>';

const AUDIO = db.ref('raciaAudio');

let inited = false;
let player = null;
let playing = false;
let current = null;       // hazırda səslənən element
let queue = [];           // { id, title, sub }
let audioUnlocked = false;
let silentUrl = null;
let rec = null;           // aktiv səs yazısı
let pressToken = 0;
const urlCache = new Map();

/* ═══════════════ BAŞLATMA ═══════════════ */

export function initVoiceCore() {
  if (inited) return;
  inited = true;
  ensureDom();
  ensurePlayer();
  ['touchend', 'click', 'pointerup', 'keydown'].forEach(ev => document.addEventListener(ev, unlockAudio, true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') setTimeout(playNext, 300);
  });
}

export function vibrate(p) {
  try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {}
}

/* ═══════════════ SAXLAMA ═══════════════ */

// Səs + meta (+ istəyə görə əlavə yollar) EYNİ anda, atomik yazılır.
// extraFn(key, meta) → { 'yol': dəyər } — məs. müştəri söhbətinə mesaj sətri.
export function saveVoice(dataUrl, durSec, mime, fields, extraFn) {
  if (!String(dataUrl).startsWith('data:')) return Promise.reject(new Error('Səs boşdur'));
  const key = db.ref('raciaMeta').push().key;
  const meta = {
    ...fields,
    dur: Math.round(durSec * 10) / 10,
    mime: String(mime || '').split(';')[0],
    ts: firebase.database.ServerValue.TIMESTAMP
  };
  const upd = { ['raciaAudio/' + key]: dataUrl, ['raciaMeta/' + key]: meta };
  if (extraFn) Object.assign(upd, extraFn(key, meta));
  return db.ref().update(upd).then(() => key);
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

export function isRecording() { return !!rec; }

/* opts = { label: '→ Əli', onSend(dataUrl, durSec, mime), toast?: fn } */
export async function startHold(btn, opts) {
  if (rec) return;
  const toast = opts.toast || showToast;
  if (!navigator.mediaDevices?.getUserMedia || pickMime() === null) {
    toast(ICON('i-error') + ' Bu brauzer səs yazmanı dəstəkləmir');
    return;
  }
  initVoiceCore();
  const token = ++pressToken;
  pauseForTalk();
  rec = { opts, btn, toast, starting: true, released: false, cancelled: false, chunks: [], stream: null, recorder: null, startedAt: 0, timer: null };
  btn?.classList.add('rc-pressed');
  showRec(opts.label, true);

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (e) {
    if (rec && token === pressToken) { btn?.classList.remove('rc-pressed'); rec = null; hideRec(); }
    const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    toast(ICON('i-error') + (denied ? ' Mikrofona icazə verilməyib. Brauzer ayarlarından icazə verin.' : ' Mikrofon açılmadı'));
    resumeLater();
    return;
  }

  // İcazə gözlənərkən barmaq buraxılıbsa və ya yeni basış başlayıbsa — dayandır
  if (!rec || token !== pressToken || rec.released || rec.cancelled) {
    stream.getTracks().forEach(t => t.stop());
    if (rec && token === pressToken) {
      const cancelled = rec.cancelled;
      btn?.classList.remove('rc-pressed'); rec = null; hideRec();
      if (!cancelled) toast(ICON('i-warning') + ' Düyməni basıb SAXLAYIN, sonra danışın');
    }
    resumeLater();
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
      toast(ICON('i-error') + ' Səs yazmaq mümkün olmadı');
      resumeLater();
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
  showRec(opts.label, false);
  rec.timer = setInterval(() => {
    if (!rec || rec.starting) return;
    const sec = (Date.now() - rec.startedAt) / 1000;
    updateRecTime(sec);
    if (sec >= MAX_SEC) releaseHold();
  }, 200);
}

export function releaseHold() {
  if (!rec) return;
  if (rec.starting) { rec.released = true; return; }
  if (rec.recorder && rec.recorder.state !== 'inactive') {
    try { rec.recorder.stop(); } catch (e) { finishRecording(); }
  }
}

export function cancelHold() {
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
  resumeLater();
  if (r.cancelled) return;

  const ms = Date.now() - r.startedAt;
  if (ms < MIN_MS) { r.toast(ICON('i-warning') + ' Çox qısa idi — düyməni basıb saxlayaraq danışın'); return; }
  const type = (r.mime || r.chunks[0]?.type || 'audio/mp4');
  const blob = new Blob(r.chunks, { type });
  if (blob.size < 300) { r.toast(ICON('i-warning') + ' Səs yazılmadı, yenidən cəhd edin'); return; }

  const reader = new FileReader();
  reader.onload = () => {
    try { r.opts.onSend(String(reader.result || ''), Math.min(MAX_SEC, ms / 1000), type); }
    catch (e) { console.warn('[Səs] Göndərilmədi:', e); r.toast(ICON('i-error') + ' Göndərilmədi'); }
  };
  reader.onerror = () => r.toast(ICON('i-error') + ' Səs hazırlana bilmədi');
  reader.readAsDataURL(blob);
}

// Basıb-saxlama düymələrini bağlayır. resolve(btn) → opts və ya null (bloklanıb).
export function bindHold(root, selector, resolve) {
  root.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest(selector);
    if (!btn || !root.contains(btn)) return;
    if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    const opts = resolve(btn);
    if (!opts) return;
    try { btn.setPointerCapture(e.pointerId); } catch (err) {}
    unlockAudio();
    startHold(btn, opts);
  });
  const up = (e) => { if (rec && e.target.closest?.(selector)) releaseHold(); };
  root.addEventListener('pointerup', up);
  root.addEventListener('pointercancel', up);
  root.addEventListener('lostpointercapture', up);
  root.addEventListener('contextmenu', (e) => { if (e.target.closest(selector)) e.preventDefault(); });
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
export function unlockAudio() {
  if (!inited || audioUnlocked || playing) return;
  ensurePlayer();
  if (!silentUrl) silentUrl = makeSilentWav();
  player.src = silentUrl;
  const p = player.play();
  if (p && p.then) {
    p.then(() => {
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

async function audioUrl(id) {
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

// Avtomatik səslənəcək mesajı növbəyə qoyur (eyni mesaj iki dəfə düşmür)
export function enqueue(item) {
  initVoiceCore();
  if (current?.id === item.id || queue.some(q => q.id === item.id)) return;
  queue.push(item);
  vibrate([60, 40, 60]);
  playNext();
}

export function dropQueued(pred) { queue = queue.filter(q => !pred(q)); }

export function clearVoice() {
  queue = [];
  if (playing) { try { player.pause(); } catch (e) {} }
  playing = false; current = null;
  hideNow();
}

async function playNext() {
  if (!inited || playing || rec || !queue.length) return;
  const item = queue[0];
  playing = true; current = item;
  try {
    const url = await audioUrl(item.id);
    if (!playing || current !== item) return;
    if (!url) { queue.shift(); playing = false; current = null; playNext(); return; }
    showNow(item, false);
    player.src = url;
    await player.play();
    if (queue[0] === item) queue.shift();
  } catch (e) {
    if (current !== item) return;
    playing = false; current = null;
    if (e && e.name === 'NotAllowedError') {
      audioUnlocked = false;
      showNow(item, true); // "dinləmək üçün toxunun"
      return;
    }
    console.warn('[Səs] Səsləndirilmədi:', e);
    if (queue[0] === item) queue.shift();
    hideNow();
    setTimeout(playNext, 200);
  }
}

function onPlayDone() {
  playing = false; current = null;
  hideNow();
  setTimeout(playNext, 250);
}

// İstifadəçi "Dinlə" düyməsinə basanda — dərhal səsləndirir
export async function playNow(item, toast = showToast) {
  initVoiceCore();
  if (rec) return;
  try { player.pause(); } catch (e) {}
  playing = true; current = item;
  dropQueued(q => q.id === item.id);
  try {
    const url = await audioUrl(item.id);
    if (current !== item) return;
    if (!url) { playing = false; current = null; toast(ICON('i-warning') + ' Bu səs artıq silinib (3 gündən köhnədir)'); return; }
    showNow(item, false);
    player.src = url;
    await player.play();
    audioUnlocked = true;
  } catch (e) {
    if (current !== item) return;
    playing = false; current = null;
    hideNow();
    toast(ICON('i-error') + ' Səsləndirilmədi');
  }
}

function pauseForTalk() {
  if (playing) { try { player.pause(); } catch (e) {} playing = false; current = null; hideNow(); }
}

function resumeLater() { setTimeout(playNext, 300); }

function stopCurrent() {
  try { player.pause(); } catch (e) {}
  playing = false; current = null;
  hideNow();
  setTimeout(playNext, 200);
}

/* ═══════════════ EKRAN ELEMENTLƏRİ ═══════════════ */

function ensureDom() {
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
      if (n.classList.contains('rc-now--tap')) { unlockAudio(); setTimeout(playNext, 120); }
      else stopCurrent();
    });
    document.body.appendChild(n);
  }
}

function showRec(label, starting) {
  const el = document.getElementById('rcRec');
  if (!el) return;
  document.getElementById('rcRecTo').textContent = label || '';
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

const escH = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function showNow(item, needTap) {
  const el = document.getElementById('rcNow');
  if (!el) return;
  el.innerHTML = needTap
    ? `${PLAY_SVG}<span><b>Yeni səsli mesaj</b> — ${escH(item.title)}. Dinləmək üçün toxunun</span>`
    : `<span class="rc-now__wave"><i></i><i></i><i></i><i></i></span><span><b>${escH(item.title)}</b>${item.sub ? ' → ' + escH(item.sub) : ''}</span><small>Dayandır</small>`;
  el.classList.toggle('rc-now--tap', !!needTap);
  el.classList.add('open');
}

function hideNow() {
  document.getElementById('rcNow')?.classList.remove('open', 'rc-now--tap');
}
