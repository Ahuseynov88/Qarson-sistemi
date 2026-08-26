import { R, db } from './firebase-service.js';
import { state } from './state.js';
import { addLog, showToast } from './utils.js';
// getAudioCtx və playBeep — alarm.js ilə circular import olmaması üçün burada birbaşa yazılır
function getAudioCtx() {
  if (!window._sharedAudioCtx || window._sharedAudioCtx.state === 'closed') {
    window._sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (window._sharedAudioCtx.state === 'suspended') window._sharedAudioCtx.resume();
  return window._sharedAudioCtx;
}
function playBeep() {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880; osc.type = 'sine';
    gain.gain.setValueAtTime(0.85, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.5);
  } catch(e) {}
}

export const NOTIF_EVENTS = {
  waiter_kitchen_ready: 'Mətbəxdən hazırdır (ofisianta)',
  waiter_customer_call: 'Müştəri çağırışı (ofisianta)',
  waiter_bill_cash:     'Nağd hesab istəyi (ofisianta)',
  waiter_bill_pos:      'POS hesab istəyi (ofisianta)',
  waiter_message:       'Müştəri mesajı (ofisianta)',

  kitchen_new_order:    'Yeni sifariş (mətbəxə)',
  kitchen_order_changed:'Sifariş dəyişdirildi (mətbəxə)',
  kitchen_order_cancel: 'Sifariş ləğv edildi (mətbəxə)',
  kitchen_note_changed: 'Qeyd dəyişdirildi (mətbəxə)',
};

const _audioCache = {};
let _activeSrc = null;

export async function playNotifSound(eventKey) {
  const map = state.notifSoundMap || {};
  const soundId = map[eventKey];
  if (!soundId) { playBeep(); return; }
  const sound = (state.notifSounds || []).find(s => s.id === soundId);
  if (!sound?.url) { playBeep(); return; }
  try {
    const ctx = getAudioCtx();
    if (!_audioCache[sound.url]) {
      const resp = await fetch(sound.url);
      const arr = await resp.arrayBuffer();
      _audioCache[sound.url] = await ctx.decodeAudioData(arr);
    }
    if (_activeSrc) { try { _activeSrc.stop(); } catch(e){} }
    const src = ctx.createBufferSource();
    src.buffer = _audioCache[sound.url];
    src.connect(ctx.destination);
    src.start(0);
    _activeSrc = src;
  } catch(e) { console.warn('[NotifSounds]', e); playBeep(); }
}

export async function uploadNotifSound(file, name) {
  return new Promise((resolve, reject) => {
    if (!file || !name.trim()) { reject('Ad və fayl tələb olunur'); return; }
    if (file.size > 2 * 1024 * 1024) { reject('Fayl 2MB-dan böyük ola bilməz'); return; }
    const reader = new FileReader();
    reader.onload = e => {
      const ref = R.notifSounds.push();
      ref.set({ name: name.trim(), url: e.target.result, type: file.type, createdAt: Date.now() }, err => {
        if (err) reject(err); else resolve(ref.key);
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function deleteNotifSound(id) {
  R.notifSounds.child(id).remove();
  const map = state.notifSoundMap || {};
  const updates = {};
  Object.entries(map).forEach(([k, v]) => { if (v === id) updates[k] = null; });
  if (Object.keys(updates).length) db.ref('settings/notifSoundMap').update(updates);
}

export function setNotifSoundMap(eventKey, soundId) {
  db.ref('settings/notifSoundMap').update({ [eventKey]: soundId || null });
}

export async function previewSound(soundId) {
  const sound = (state.notifSounds || []).find(s => s.id === soundId);
  if (!sound?.url) { playBeep(); return; }
  try {
    const ctx = getAudioCtx();
    if (!_audioCache[sound.url]) {
      const resp = await fetch(sound.url);
      const arr = await resp.arrayBuffer();
      _audioCache[sound.url] = await ctx.decodeAudioData(arr);
    }
    if (_activeSrc) { try { _activeSrc.stop(); } catch(e){} }
    const src = ctx.createBufferSource();
    src.buffer = _audioCache[sound.url];
    src.connect(ctx.destination);
    src.start(0);
    _activeSrc = src;
  } catch(e) { playBeep(); }
}

export function renderNotifSounds() {
  const el = document.getElementById('notifSoundsSection');
  if (!el) return;
  const sounds = state.notifSounds || [];
  const map = state.notifSoundMap || {};

  const libHtml = sounds.length ? sounds.map(s => `
    <div class="nsound-lib-item">
      <span class="nsound-lib-name">${s.name}</span>
      <div style="display:flex;gap:4px;">
        <button class="btn btn-ghost" style="padding:4px 10px;font-size:11px;" onclick="previewSound('${s.id}')">▶ Dinlə</button>
        <button class="btn btn-red" style="padding:4px 10px;font-size:11px;" onclick="deleteNotifSoundUI('${s.id}')">Sil</button>
      </div>
    </div>`).join('') : '<p style="color:var(--text3);font-size:13px;">Hələ səs əlavə edilməyib.</p>';

  const eventsHtml = Object.entries(NOTIF_EVENTS).map(([key, label]) => `
    <div class="nsound-event-row">
      <span class="nsound-event-label">${label}</span>
      <select class="nsound-select" onchange="setNotifSoundMap('${key}', this.value)">
        <option value="">— Standart bip —</option>
        ${sounds.map(s => `<option value="${s.id}" ${map[key]===s.id?'selected':''}>${s.name}</option>`).join('')}
      </select>
      ${map[key] ? `<button class="btn btn-ghost" style="padding:3px 8px;font-size:11px;" onclick="previewSound('${map[key]}')">▶</button>` : ''}
    </div>`).join('');

  el.innerHTML = `
    <div class="table-card" style="margin-bottom:16px;">
      <h3 style="margin-bottom:12px;">Səs Kitabxanası</h3>
      <div>${libHtml}</div>
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
        <div class="form-group" style="margin:0;flex:1;min-width:150px;">
          <label>Səs adı</label>
          <input type="text" id="nsoundName" placeholder="məs: Zəng">
        </div>
        <div class="form-group" style="margin:0;">
          <label>Audio fayl (mp3/wav, maks 2MB)</label>
          <input type="file" id="nsoundFile" accept="audio/*">
        </div>
        <button class="btn btn-green" onclick="addNotifSoundUI()">Əlavə et</button>
      </div>
      <p id="nsoundStatus" style="font-size:12px;color:var(--green);margin-top:6px;min-height:14px;"></p>
    </div>
    <div class="table-card">
      <h3 style="margin-bottom:12px;">Hadisə → Səs Bağlantısı</h3>
      <p style="font-size:12px;color:var(--text2);margin-bottom:10px;">Seçilməyəndə standart bip çalır.</p>
      <div class="nsound-events-list">${eventsHtml}</div>
    </div>`;
}

window.setNotifSoundMap = setNotifSoundMap;
window.previewSound = previewSound;
window.addNotifSoundUI = async function() {
  const name = document.getElementById('nsoundName')?.value || '';
  const file = document.getElementById('nsoundFile')?.files?.[0];
  const status = document.getElementById('nsoundStatus');
  if (!name.trim() || !file) { if(status) status.textContent = 'Ad və fayl seçin'; return; }
  if (status) status.textContent = 'Yüklənir...';
  try {
    await uploadNotifSound(file, name);
    if (status) status.textContent = 'Əlavə olundu ✓';
    document.getElementById('nsoundName').value = '';
    document.getElementById('nsoundFile').value = '';
  } catch(e) { if(status) status.textContent = 'Xəta: ' + e; }
};
window.deleteNotifSoundUI = function(id) {
  const s = (state.notifSounds||[]).find(x=>x.id===id);
  if (!s || !confirm(`"${s.name}" silinsin?`)) return;
  deleteNotifSound(id);
  showToast('Silindi');
};
