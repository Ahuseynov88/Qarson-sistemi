/* ═══════════════════════════════════════════
   YUZA POS — İLK QURAŞDIRMA: Rəhbər PIN-i
   Yeni şirkətin bazası boşdur (demo masa, işçi yoxdur). Rəhbər PIN-i də
   yoxdursa, ekranda "Rəhbər PIN-i yaradın" pəncərəsi açılır — standart
   "0000" kimi hamının bildiyi PIN yaradılmır.
   Yazı transaction ilədir: iki cihaz eyni anda açılsa, yalnız birincisi yazır.
═══════════════════════════════════════════ */
import { db } from './firebase-service.js';

const WEAK = new Set(['0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '1234', '4321', '0123', '1212']);

export function askFirstAdminPin() {
  return new Promise(resolve => {
    if (document.getElementById('yzFirstRun')) return;
    const box = document.createElement('div');
    box.id = 'yzFirstRun';
    box.innerHTML = `
      <style>
        #yzFirstRun{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;
          background:rgba(8,6,3,.86);font-family:Inter,system-ui,sans-serif;color:#f4eee2}
        #yzFirstRun form{width:100%;max-width:360px;background:#1b160e;border:1px solid rgba(232,176,75,.4);border-radius:20px;padding:26px 22px;box-shadow:0 20px 60px rgba(0,0,0,.5)}
        #yzFirstRun h1{font-size:19px;margin:0 0 8px;text-align:center}
        #yzFirstRun p{font-size:13px;color:#c9bfae;line-height:1.5;margin:0 0 16px;text-align:center}
        #yzFirstRun label{display:block;font-size:12px;font-weight:700;color:#c9bfae;margin:12px 0 6px}
        #yzFirstRun input{width:100%;box-sizing:border-box;padding:13px;border-radius:12px;border:1px solid rgba(232,176,75,.35);background:rgba(0,0,0,.35);
          color:#fff;font-size:24px;letter-spacing:10px;text-align:center;outline:none}
        #yzFirstRun input:focus{border-color:#e8b04b}
        #yzFirstRun button{width:100%;margin-top:18px;padding:14px;border:none;border-radius:12px;background:linear-gradient(180deg,#f6cf7c,#e1a43e);color:#1a1205;font-weight:800;font-size:15px;cursor:pointer}
        #yzFirstRun button[disabled]{opacity:.6}
        #yzFirstRun .e{min-height:18px;margin-top:10px;font-size:13px;color:#ff8a80;text-align:center}
      </style>
      <form novalidate>
        <h1>🔐 Rəhbər PIN-i yaradın</h1>
        <p>Sistem yenidir. Rəhbər panelinə giriş üçün 4 rəqəmli PIN təyin edin. Bu PIN-i yalnız siz bilməlisiniz.</p>
        <label for="yzFr1">Yeni PIN</label>
        <input id="yzFr1" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password">
        <label for="yzFr2">PIN-i təkrar yazın</label>
        <input id="yzFr2" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password">
        <button type="submit">Yadda saxla</button>
        <div class="e" role="alert"></div>
      </form>`;
    document.body.appendChild(box);
    const $ = (s) => box.querySelector(s);
    const err = (t) => { $('.e').textContent = t; };
    $('#yzFr1').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); });
    $('#yzFr2').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); });
    $('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const a = $('#yzFr1').value, b = $('#yzFr2').value;
      if (!/^\d{4}$/.test(a)) return err('PIN 4 rəqəm olmalıdır.');
      if (WEAK.has(a)) return err('Bu PIN çox asandır. Başqa PIN seçin.');
      if (a !== b) return err('İki PIN eyni deyil.');
      const btn = $('button'); btn.disabled = true; err('');
      try {
        const r = await db.ref('settings/adminPin').transaction(cur => cur || a);
        const saved = String(r.snapshot.val());
        box.remove();
        resolve(saved);
      } catch (ex) { btn.disabled = false; err('Yadda saxlanmadı. İnterneti yoxlayın.'); }
    });
    setTimeout(() => $('#yzFr1').focus(), 50);
  });
}
