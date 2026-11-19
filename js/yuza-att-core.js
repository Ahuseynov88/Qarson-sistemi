/* ═══════════════════════════════════════════
   YUZA POS — PERSONAL İZLƏMƏ: ORTAQ MƏNTİQ
   Həm işçi telefon səhifəsi (izle.html), həm Rəhbər paneli bunu işlədir.
   Bütün məlumat Firebase-də TƏK "att" bölməsindədir — gələcəkdə ayrıca
   məhsula çevirmək üçün POS məlumatına qarışmır.

   att/settings              — ayarlar
   att/status/{staffId}      — kim indi işdədir / müvəqqəti çıxışdadır (tez oxunsun deyə)
   att/sessions/{id}         — hər iş müddəti: giriş + müvəqqəti çıxışlar (breaks) + çıxış
   att/marks/{YYYY-MM}/{staffId}/{gün} — tabel qeydləri: məzuniyyət, xəstəlik, üzrlü, gəlməyib, istirahət
   att/invites/{kod}         — Rəhbərin verdiyi birdəfəlik telefon dəvəti (10 dəq)
   att/phones/{uid}          — telefon (gizli giriş nişanı) → işçi
   att/devices/{staffId}     — işçinin hazırkı (yeganə) telefonu
   att/attempts/{id}         — rədd edilən cəhdlər (şübhəli hallar)
   att/audit/{id}            — Rəhbərin düzəlişləri (jurnal)
   att/qrs/{kod}             — ekranda göstərilmiş dəyişən QR kodları (2 dəq etibarlı)
   att/photos/{id}           — selfi şəkilləri (ayrıca, siyahılar ağırlaşmasın)

   Təhlükəsizlik: işçi telefonuna heç bir PIN getmir. Telefon yalnız Rəhbərin
   göstərdiyi dəvət QR-ı ilə işçiyə bağlanır; bazanın qaydaları telefona yalnız
   öz sahibinin qeydlərini oxumağa və yazmağa icazə verir, saatı server qoyur.
═══════════════════════════════════════════ */
import { db } from './firebase-service.js';

/* İşçi telefonunda (izle.html) ayrıca "gizli" giriş işlənir (yuza-guard.js → __yzAttApp):
   beləliklə eyni telefonda restoran girişi (qarson rejimi) ilə qarışmır. */
export const adb = window.__yzAttApp ? window.__yzAttApp.database() : db;
export function attUid() {
  if (window.__yzAttApp) return window.__yzAttApp.auth().currentUser?.uid || null;
  // Giriş qatı aktiv olmayan bazada (köhnə əsas sayt) telefonun yerli nişanı işlənir
  try {
    let id = localStorage.getItem('yzAttUid');
    if (!id) { id = 'l' + Array.from(crypto.getRandomValues(new Uint8Array(14)), b => b.toString(16).padStart(2, '0')).join(''); localStorage.setItem('yzAttUid', id); }
    return id;
  } catch (e) { return null; }
}
export const A = (p = '') => adb.ref('att' + (p ? '/' + p : ''));
export const TS = firebase.database.ServerValue.TIMESTAMP;

export const DEFAULTS = {
  qrMode: 'dynamic',    // dynamic = ekranda dəyişən QR (tövsiyə) · static = çap olunmuş QR
  gps: true,            // GPS yoxlaması
  lat: null, lng: null, // restoranın yeri
  radius: 150,          // metr
  faceId: true,         // telefonun öz Face ID / barmaq izi
  selfie: false,        // qeyd zamanı şəkil
  photoDays: 60,        // şəkillər neçə gün saxlansın
  maxHours: 16,         // bundan uzun açıq qalan giriş "çıxış qeyd edilməyib" sayılır
  minGapMin: 1,         // iki qeyd arasında minimum dəqiqə (səhvən iki dəfə basmaq)
  gateLogin: false,     // gəlişini qeyd etməyən işçi POS-a girə bilməsin
  gateExempt: {}        // bu yoxlamadan azad işçilər { staffId: true }
};
export const withDefaults = (s) => ({ ...DEFAULTS, ...(s || {}) });
export const INVITE_MIN = 10;   // dəvət QR-ı neçə dəqiqə etibarlıdır

/* ── Server saatı (telefonun saatına etibar edilmir) ── */
let offset = 0;
adb.ref('.info/serverTimeOffset').on('value', s => { offset = s.val() || 0; });
export const now = () => Date.now() + offset;

/* ── Tarix və saat: hər yerdə ikisi birlikdə ── */
const p2 = (n) => String(n).padStart(2, '0');
export function fmtDate(t) { if (!t) return '—'; const d = new Date(t); return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}`; }
export function fmtTime(t) { if (!t) return '—'; const d = new Date(t); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; }
export function fmtDT(t) { return t ? `${fmtDate(t)} ${fmtTime(t)}` : '—'; }
export function fmtDur(ms) {
  if (!(ms > 0)) return '0 dəq';
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60), r = m % 60;
  return h ? `${h} saat ${r} dəq` : `${r} dəq`;
}
export const hoursNum = (ms) => Math.round((ms / 3600000) * 100) / 100;

/* ── GPS məsafəsi (metr) ── */
export function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000, rad = (x) => x * Math.PI / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}
export function getPosition(timeout = 15000) {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) { rej(new Error('Bu telefon yer təyinini dəstəkləmir')); return; }
    navigator.geolocation.getCurrentPosition(
      p => res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy || 0) }),
      e => rej(new Error(e.code === 1 ? 'Yer icazəsi verilməyib. Telefonun ayarlarında bu sayta yer icazəsi verin.'
        : e.code === 3 ? 'Yer təyin edilmədi (vaxt bitdi). Yenidən cəhd edin.' : 'Yer təyin edilmədi. GPS-i yandırıb yenidən cəhd edin.')),
      { enableHighAccuracy: true, timeout, maximumAge: 0 }
    );
  });
}

/* ── Etibarlılıq balı ──
   high   = ekrandakı dəyişən QR + GPS ərazidədir + Face ID təsdiqləndi
   medium = yoxlamaların bir qismi, və ya davamiyyət ekranında PIN ilə
   manual = Rəhbər əl ilə yazıb */
export function trustOf(m) {
  if (m.method === 'manual' || m.method === 'proxy') return 'manual';
  if (m.method === 'pin') return 'medium';
  const gpsOk = !!(m.gps && m.gps.ok);
  const qrOk = m.qr === 'dynamic' && !!m.qrCode;
  const score = (gpsOk ? 1 : 0) + (m.faceId ? 1 : 0) + (qrOk ? 1 : 0);
  if (score >= 2 && (m.faceId || qrOk)) return 'high';
  if (score >= 1) return 'medium';
  return 'low';
}
export const TRUST = {
  high: { label: 'Etibarlı', cls: 'ok' },
  medium: { label: 'Orta', cls: 'warn' },
  low: { label: 'Zəif', cls: 'bad' },
  manual: { label: 'Əl ilə', cls: 'muted' }
};
export const METHOD = { qr: 'Telefon (QR)', pin: 'Ekranda PIN', manual: 'Rəhbər', proxy: 'Səlahiyyətli şəxs (telefonsuz)' };

/* ── Telefon modeli (yalnız göstərmək üçün) ── */
export function deviceModel() {
  const ua = navigator.userAgent || '';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  const m = ua.match(/Android[^;)]*;\s*([^;)]+?)(?:\s+Build|\))/);
  if (m) return m[1].trim();
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows kompüter';
  if (/Macintosh/.test(ua)) return 'Mac';
  return 'Naməlum cihaz';
}

/* ── Müvəqqəti çıxış növləri ──
   "İş tapşırığı" (bazar, bank) iş vaxtı sayılır; nahar və şəxsi iş iş vaxtından çıxılır. */
export const BREAKS = {
  work: { label: 'İş tapşırığı', sub: 'bazar, bank və s. — iş vaxtı sayılır', paid: true },
  lunch: { label: 'Nahar / fasilə', sub: 'iş vaxtından çıxılır', paid: false },
  personal: { label: 'Şəxsi iş', sub: 'iş vaxtından çıxılır', paid: false }
};
export const breakLabel = (t) => BREAKS[t]?.label || 'Müvəqqəti çıxış';

/* ── Vəziyyət ──
   status: att/status/{staffId} → { state: in | break | out, sessionId, since, start, breakId, btype, bnote }
   off = işdə deyil · in = işdədir · break = müvəqqəti çıxışdadır */
const startOf = (st) => (st && (st.start || st.since)) || 0;
export function isStale(st, s) {
  return !!(st && (st.state === 'in' || st.state === 'break') && startOf(st) && (now() - startOf(st)) > withDefaults(s).maxHours * 3600000);
}
export function phaseOf(st, s) {
  if (!st || isStale(st, s)) return 'off';
  return st.state === 'in' ? 'in' : st.state === 'break' ? 'break' : 'off';
}
export const shiftStart = startOf;
export function nextKind(st, s) { return phaseOf(st, s) === 'off' ? 'in' : 'out'; }
export const ACTION_LABEL = { in: 'İşə gəldi', out: 'İşdən çıxdı', break: 'Müvəqqəti çıxış', back: 'Qayıtdı' };

/* Bir iş müddətində işlənmiş vaxt: (çıxış − giriş) − ödənişsiz müvəqqəti çıxışlar */
export function breakList(r) {
  return Object.entries(r?.breaks || {}).map(([id, b]) => ({ id, ...b })).sort((a, b) => (a.from || 0) - (b.from || 0));
}
export function workedMs(r, endT) {
  const end = r.outAt || endT || 0;
  if (!r.inAt || !end || end < r.inAt) return 0;
  let ms = end - r.inAt;
  breakList(r).forEach(b => {
    if (BREAKS[b.type]?.paid) return;
    const f = Math.max(b.from || 0, r.inAt), t = Math.min(b.to || end, end);
    if (t > f) ms -= (t - f);
  });
  return Math.max(0, ms);
}

/* ── Qeyd: action = in | out | break | back (verilməsə vəziyyətə görə seçilir) ── */
export async function clock(staff, meta, { photo = null, action = null, brk = null } = {}) {
  const sid = staff.id;
  const [stSnap, setSnap] = await Promise.all([A('status/' + sid).once('value'), A('settings').once('value')]);
  const st = stSnap.val(); const s = withDefaults(setSnap.val());
  const ph = phaseOf(st, s);
  const act = action || (ph === 'off' ? 'in' : ph === 'break' ? 'back' : 'out');
  const okFor = { in: ['off'], out: ['in', 'break'], break: ['in'], back: ['break'] };
  if (!okFor[act].includes(ph)) {
    throw Object.assign(new Error(ph === 'off' ? 'Siz hələ işə gəlişinizi qeyd etməmisiniz.' : ph === 'break' ? 'Siz müvəqqəti çıxışdasınız. Əvvəlcə “Qayıtdım” qeyd edin.' : 'Siz artıq işdəsiniz.'), { code: 'state' });
  }
  if (st && st.since && (now() - st.since) < s.minGapMin * 60000 && (ph !== 'off' || st.state === 'out')) {
    throw Object.assign(new Error(`Son qeydiniz ${fmtTime(st.since)}-dədir. Bir neçə dəqiqə gözləyin.`), { code: 'gap' });
  }
  if (act === 'break' && (!brk || !BREAKS[brk.type] || !String(brk.note || '').trim())) {
    throw Object.assign(new Error('Müvəqqəti çıxışın növünü seçin və səbəbini yazın.'), { code: 'brk' });
  }
  meta = { ...meta, trust: trustOf(meta) };
  const up = {};
  let id = st?.sessionId || null;
  const start = startOf(st);
  if (act === 'in') {
    if (isStale(st, s) && st.sessionId) up[`sessions/${st.sessionId}/forgot`] = true;
    id = A('sessions').push().key;
    up[`sessions/${id}`] = { staffId: sid, staffName: staff.name || '', inAt: TS, in: meta };
    up[`status/${sid}`] = { state: 'in', sessionId: id, since: TS, start: TS };
  } else if (act === 'break') {
    const bid = A('sessions/' + id + '/breaks').push().key;
    up[`sessions/${id}/breaks/${bid}`] = { from: TS, type: brk.type, note: String(brk.note).trim().slice(0, 200), qr: meta.qrCode || null, method: meta.method || null };
    up[`status/${sid}`] = { state: 'break', sessionId: id, since: TS, start, breakId: bid, btype: brk.type, bnote: String(brk.note).trim().slice(0, 200) };
  } else if (act === 'back') {
    up[`sessions/${id}/breaks/${st.breakId}/to`] = TS;
    up[`sessions/${id}/breaks/${st.breakId}/qrBack`] = meta.qrCode || null;
    up[`status/${sid}`] = { state: 'in', sessionId: id, since: TS, start };
  } else {
    if (ph === 'break' && st.breakId) {
      up[`sessions/${id}/breaks/${st.breakId}/to`] = TS;
      up[`sessions/${id}/breaks/${st.breakId}/qrBack`] = meta.qrCode || null;
    }
    up[`sessions/${id}/outAt`] = TS;
    up[`sessions/${id}/out`] = meta;
    up[`status/${sid}`] = { state: 'out', sessionId: id, since: TS };
  }
  if (photo && (act === 'in' || act === 'out')) { up[`photos/${id}_${act}`] = { at: TS, data: photo }; }
  try { await A().update(up); }
  catch (e) {
    if (/permission/i.test(e?.code || e?.message || '')) {
      throw Object.assign(new Error(meta.qr === 'dynamic'
        ? 'Qeyd qəbul edilmədi. Ekrandakı QR-ı yenidən oxudun və dərhal təkrar basın.'
        : 'Qeyd qəbul edilmədi. Bu telefonun bağlantısı ləğv edilmiş ola bilər — Rəhbərə müraciət edin.'), { log: 'Baza qeydi rədd etdi' });
    }
    throw e;
  }
  return { kind: act, id, trust: meta.trust };
}
export function logAttempt(staff, kind, reason, extra = {}) {
  return A('attempts').push({
    at: TS, staffId: staff?.id || null, staffName: staff?.name || null, kind: kind || null, reason, ...extra
  }).catch(() => {});
}

/* İşçinin son iş müddətinə görə statusu yenidən hesablayır (Rəhbər düzəlişindən sonra) */
export async function recomputeStatus(staffId) {
  const snap = await A('sessions').orderByChild('staffId').equalTo(staffId).once('value');
  let last = null;
  snap.forEach(c => { const v = c.val(); if (!last || (v.inAt || 0) > (last.inAt || 0)) last = { id: c.key, ...v }; });
  if (!last) { await A('status/' + staffId).remove(); return; }
  const open = !last.outAt && !last.forgot;
  if (!open) { await A('status/' + staffId).set({ state: 'out', sessionId: last.id, since: last.outAt || last.inAt }); return; }
  const ob = breakList(last).filter(b => !b.to).pop();
  await A('status/' + staffId).set(ob
    ? { state: 'break', sessionId: last.id, since: ob.from, start: last.inAt, breakId: ob.id, btype: ob.type || 'personal', bnote: ob.note || '' }
    : { state: 'in', sessionId: last.id, since: Math.max(last.inAt, ...breakList(last).map(b => b.to || 0)), start: last.inAt });
}

/* ═══ TELEFON DƏVƏTİ ═══
   Rəhbər (restoran cihazı) dəvət yaradır → işçi QR-ı öz telefonu ilə oxudur →
   telefon gizli giriş nişanı (uid) ilə işçiyə bağlanır. Köhnə telefon avtomatik bağlanır. */
const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
export function newCode(n = 22) {
  const r = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(r, b => CODE_CHARS[b % CODE_CHARS.length]).join('');
}
export async function createInvite(staff, by) {
  const code = newCode();
  await A('invites/' + code).set({
    staffId: staff.id, staffName: staff.name || '', firstname: staff.firstname || '', position: staff.position || '',
    exp: now() + INVITE_MIN * 60000, createdAt: TS, by: by || 'Rəhbər'
  });
  return code;
}
/* Telefon tərəfi: dəvəti istifadə edib bu telefonu işçiyə bağlayır */
export async function bindPhone(code, inv, uid, credId, model) {
  const up = {
    [`invites/${code}/usedBy`]: uid,
    [`phones/${uid}`]: { staffId: inv.staffId, staffName: inv.staffName || '', firstname: inv.firstname || '', position: inv.position || '', credId: credId || null, model: model || '', invite: code, boundAt: TS },
    [`devices/${inv.staffId}/approved`]: { uid, credId: credId || null, model: model || '', approvedAt: TS, invite: code }
  };
  await A().update(up);
}
/* Köhnə dəvətləri təmizləyir (Rəhbər panelində, arxa planda) */
export async function cleanupInvites() {
  try {
    const snap = await A('invites').once('value');
    const up = {}; const t = now() - 24 * 3600000;
    snap.forEach(c => { const v = c.val() || {}; if ((v.exp || 0) < t) up[c.key] = null; });
    if (Object.keys(up).length) await A('invites').update(up);
  } catch (e) { /* */ }
}

/* ── Face ID / barmaq izi (WebAuthn, telefonun öz kilidi) ── */
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
const rnd = (n) => crypto.getRandomValues(new Uint8Array(n));

export async function faceIdAvailable() {
  try {
    return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch (e) { return false; }
}
/* Qeydiyyat: telefon işçi üçün gizli açar yaradır (açar telefondan çıxmır) */
export async function faceIdRegister(staff) {
  const cred = await navigator.credentials.create({
    publicKey: {
      rp: { name: 'YuZa POS', id: location.hostname },
      user: { id: rnd(16), name: staff.name || 'isci', displayName: staff.name || 'İşçi' },
      challenge: rnd(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000, attestation: 'none'
    }
  });
  return b64u(cred.rawId);
}
/* Hər qeyddə: telefon sahibinin üzünü/barmağını soruşur */
export async function faceIdVerify(credId) {
  const r = await navigator.credentials.get({
    publicKey: {
      challenge: rnd(32), timeout: 60000, userVerification: 'required', rpId: location.hostname,
      allowCredentials: [{ type: 'public-key', id: unb64u(credId), transports: ['internal'] }]
    }
  });
  if (!r || b64u(r.rawId) !== credId) throw new Error('Face ID təsdiqlənmədi');
  return true;
}
export function faceIdError(e) {
  const n = e?.name || '';
  if (n === 'NotAllowedError') return 'Face ID / barmaq izi təsdiqlənmədi və ya ləğv edildi. Yenidən cəhd edin.';
  if (n === 'InvalidStateError') return 'Bu telefonda artıq qeydiyyat var. Rəhbərə müraciət edin.';
  if (n === 'SecurityError') return 'Face ID yalnız rəsmi saytda (https) işləyir.';
  return e?.message || 'Face ID xətası';
}
