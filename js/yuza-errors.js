/* ═══════════════════════════════════════════
   YUZA POS — PROQRAM XƏTALARININ TOPLANMASI (Mərhələ 4.2)
   Hər cihazda (kassa, ofisiant, mətbəx, davamiyyət, müştəri QR) baş verən proqram xətası
   serverə göndərilir və Rəhbər onu Ayarlar → Giriş və təhlükəsizlik → "Proqram xətaları"nda görür.
   • eyni xəta bir dəfə göndərilir, təkrarı yalnız sayını artırır;
   • bir səhifə açılışında ən çox 30 xəta, 5 saniyədən bir paketlə;
   • server əlçatmazdırsa iş dayanmır — xəta sadəcə göndərilmir.
   Şəxsi məlumat (PIN, parol, müştəri məlumatı) göndərilmir: yalnız xəta mətni, fayl/sətir, ekran.
═══════════════════════════════════════════ */
import { APP_VERSION } from './yuza-version.js';
import { state } from './state.js';

const MAX = 30;                       // bir açılışda ən çox
const IGNORE = [/^Script error\.?$/i, /ResizeObserver loop/i, /Loading chunk/i, /AbortError/i, /The play\(\) request was interrupted/i, /NotAllowedError: play\(\)/i];
const seen = new Map();               // açar → növbədəki qeyd
let queue = [], timer = null, total = 0, busy = false;

const scr = () => {
  const id = document.querySelector('.screen.active')?.id || (document.querySelector('.screen') ? '' : 'izle');
  const sec = state.adminSection ? '/' + state.adminSection : '';
  return (id || '—') + (id === 'adminScreen' ? sec : '');
};
const cleanSrc = (s) => String(s || '').replace(location.origin, '').replace(/\?.*$/, '');

function push(e) {
  const msg = String(e.msg || '').trim();
  if (!msg || IGNORE.some(r => r.test(msg))) return;
  const key = msg + '|' + cleanSrc(e.src) + '|' + (e.line || 0);
  const cur = seen.get(key);
  if (cur) { cur.n++; if (!queue.includes(cur)) queue.push(cur); schedule(); return; }
  if (total >= MAX) return;
  total++;
  const rec = {
    msg: msg.slice(0, 300), src: cleanSrc(e.src).slice(0, 200), line: e.line || 0, col: e.col || 0,
    stack: String(e.stack || '').replace(new RegExp(location.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '').slice(0, 1500),
    ver: APP_VERSION, scr: scr(), role: state.user?.role || (document.getElementById('customerScreen')?.classList.contains('active') ? 'customer' : ''),
    who: state.user?.name || '', ua: navigator.userAgent.slice(0, 160), n: 1
  };
  seen.set(key, rec); queue.push(rec); schedule();
}
function schedule() { if (!timer) timer = setTimeout(flush, 5000); }

async function flush() {
  timer = null;
  if (busy || !queue.length) return;
  busy = true;
  const batch = queue.splice(0, 10);
  const send = batch.map(r => ({ ...r }));
  batch.forEach(r => { r.n = 0; });          // göndərilən say sıfırlanır, sonrakı təkrarlar yenidən sayılır
  try {
    const A = await import('./yuza-api.js');
    if (!A.apiOn()) return;
    await A.api('errReport', { list: send });
  } catch (er) {
    // giriş hələ yoxdursa/internet yoxdursa — bir dəfə sonra yenidən cəhd et
    if (er && (er.code === 'auth' || er.code === 'net')) send.forEach((r, i) => { batch[i].n += r.n; if (!queue.includes(batch[i])) queue.push(batch[i]); });
  } finally {
    busy = false;
    if (queue.length) setTimeout(schedule, 30000);
  }
}

window.addEventListener('error', (ev) => {
  if (ev.target && ev.target !== window) return;   // şəkil/fayl yüklənməməsi — xəta deyil
  push({ msg: ev.message || ev.error?.message, src: ev.filename, line: ev.lineno, col: ev.colno, stack: ev.error?.stack });
});
window.addEventListener('unhandledrejection', (ev) => {
  const r = ev.reason;
  const msg = r && (r.message || r.code) ? `${r.name && r.name !== 'Error' ? r.name + ': ' : ''}${r.message || r.code}` : String(r);
  const m = /\((?:https?:\/\/[^/]+)?([^:()]+):(\d+):(\d+)\)/.exec(r?.stack || '') || /@(?:https?:\/\/[^/]+)?([^:@]+):(\d+):(\d+)/.exec(r?.stack || '');
  push({ msg: 'Promise: ' + msg, src: m ? m[1] : '', line: m ? +m[2] : 0, col: m ? +m[3] : 0, stack: r?.stack });
});
document.addEventListener('visibilitychange', () => { if (document.hidden && queue.length) flush(); });

/* Avtomatik testlər üçün */
window.__yzErrors = { push, flush, _q: () => queue };
