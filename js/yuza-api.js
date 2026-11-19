/* ═══════════════════════════════════════════
   YUZA POS — SERVER QATI (Cloudflare Worker) ilə əlaqə · Mərhələ 1a (16.11.2026)
   PIN-lər brauzerdə yoxlanmır və bazada açıq saxlanmır — yalnız serverdə.
   api('login' | 'verify' | 'setPin' | 'logout', {...}, { owner })
     owner: true → sorğu Rəhbər hesabının adından gedir (Rəhbər panelində işçi/mətbəx PIN-i təyini)
   Server ünvanı olmayan saytda (hələ yenilənməmiş əsas sayt) apiOn() = false və köhnə qayda işləyir.
═══════════════════════════════════════════ */
import { API_BASE, ENV_READY } from './yuza-env.js';
export const API_URL = ENV_READY ? API_BASE : '';

export function apiOn() {
  try { return !!API_URL && typeof firebase !== 'undefined' && !!firebase.app().options.apiKey; } catch (e) { return false; }
}

function currentUser(owner) {
  if (owner) {
    const a = firebase.apps.find(x => x.name === 'yzOwner');
    return a ? a.auth().currentUser : null;
  }
  // İşçinin öz telefonu ayrıca tətbiq nüsxəsi ilə işləyir (yuza-guard.js)
  const app = window.__yzDbApp || firebase.app();
  return app.auth().currentUser;
}

const err = (code, msg) => Object.assign(new Error(msg), { code });

export async function api(action, body = {}, { owner = false } = {}) {
  if (!apiOn()) throw err('off', 'Server qatı bu saytda qoşulmayıb.');
  const u = currentUser(owner);
  if (!u) throw err('auth', owner ? 'Rəhbər sessiyası bağlanıb. Yenidən daxil olun.' : 'Cihaz girişi tapılmadı. Səhifəni yeniləyin.');
  const tok = await u.getIdToken();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  let r;
  try {
    r = await fetch(API_URL + '/pin', {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
      body: JSON.stringify({ ...body, action })
    });
  } catch (e) {
    throw err('net', 'Serverə qoşulmaq alınmadı. İnterneti yoxlayın.');
  } finally { clearTimeout(timer); }
  let j = {};
  try { j = await r.json(); } catch (e) { /* */ }
  if (!r.ok || !j.ok) throw err(j.code || 'http' + r.status, j.msg || `Server xətası (${r.status}).`);
  return j;
}

/* Xam cavab (fayl yükləmək üçün, məs. ehtiyat nüsxə) — JSON açılmır */
export async function apiRaw(action, body = {}, { owner = false } = {}) {
  if (!apiOn()) throw err('off', 'Server qatı bu saytda qoşulmayıb.');
  const u = currentUser(owner);
  if (!u) throw err('auth', 'Sessiya bağlanıb. Yenidən daxil olun.');
  const tok = await u.getIdToken();
  let r;
  try {
    r = await fetch(API_URL + '/pin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ ...body, action }) });
  } catch (e) { throw err('net', 'Serverə qoşulmaq alınmadı. İnterneti yoxlayın.'); }
  if (!r.ok) { let j = {}; try { j = await r.json(); } catch (e) { /* */ } throw err(j.code || 'http' + r.status, j.msg || `Server xətası (${r.status}).`); }
  return r;
}

window.__yzApi = { api, apiOn };
