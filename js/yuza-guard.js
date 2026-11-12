/* ═══════════════════════════════════════════
   YUZA POS — CİHAZ GÖZƏTÇİSİ (v2 · 12.11.2026: cihaz təsdiqi)
   Baza ilə işləməzdən ƏVVƏL cihazın kim olduğunu müəyyən edir:
   • Restoran cihazı (kassa, ofisiant telefonu, mətbəx, davamiyyət ekranı) —
     öz "cihaz kimliyi" ilə işləyir. Cihazı BİR DƏFƏ Rəhbər və ya səlahiyyətli
     şəxs öz istifadəçi adı + parolu ilə təsdiqləyir (parol cihazda qalmır).
     Təsdiqlənmiş cihazlar "Sistem → Cihazlar və girişlər"də görünür, istənilən
     biri ayrıca söndürülə bilər — söndürülən cihaz dərhal işləməz olur.
     Ortaq restoran parolu artıq yoxdur.
   • QR müştəri (?table=... və ya ?ref=...) — avtomatik "qonaq" girişi.
   • İşçinin davamiyyət telefonu (izle.html) — ayrıca "izle" girişi, dəyişmir.
   firebase-service.js bu funksiyanı gözləyir, ona görə heç bir modul
   giriş olmadan bazaya müraciət etmir.
   Config-də apiKey yoxdursa (məs. hələ yenilənməmiş əsas sayt) — heç nə etmir.
═══════════════════════════════════════════ */
import { approverSignIn, apprErr, deviceModel, devCode, fmtDT } from './yuza-approver.js';

const GUEST_MODE = (() => {
  const p = new URLSearchParams(location.search);
  return !!(p.get('table') || p.get('ref'));
})();
const ATT_PHONE = /\/izle(\.html)?\/?$/.test(location.pathname) && new URLSearchParams(location.search).get('ekran') !== '1';
const IS_IZLE = /\/izle(\.html)?\/?$/.test(location.pathname);
export const isGuestMode = () => GUEST_MODE;

const K_OK = 'yzDevOk';          // son təsdiqlənmiş cihaz kimliyi (internet zəif olanda açılış gözləməsin)
const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, String(v)); } catch (e) { /* */ } }
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TS = () => firebase.database.ServerValue.TIMESTAMP;

function firstState(auth) {
  return new Promise(res => { const off = auth.onAuthStateChanged(u => { off(); res(u); }); });
}
const AUTH_WHY = {
  'auth/network-request-failed': 'İnternet bağlantısı yoxdur. İnterneti yoxlayıb səhifəni yeniləyin.',
  'auth/operation-not-allowed': 'Firebase-də adsız giriş (Anonymous) söndürülüb. Rəhbərə müraciət edin.',
  'auth/admin-restricted-operation': 'Firebase-də yeni giriş yaratmaq (sign-up) bağlanıb. Rəhbərə müraciət edin.',
  'auth/too-many-requests': 'Çox sayda cəhd. Bir neçə dəqiqə sonra yenidən yoxlayın.'
};
function fatal(e) {
  const p = document.createElement('div');
  p.style.cssText = 'position:fixed;inset:0;z-index:100001;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center;line-height:1.5;background:#0b0906;color:#fff;font-family:Inter,system-ui,sans-serif';
  p.innerHTML = `<div>${esc(AUTH_WHY[e?.code] || 'Giriş alınmadı. Səhifəni yeniləyin.')}</div>
    <small style="opacity:.6">Kod: ${esc(e?.code || e?.message || 'naməlum')}</small>
    <button type="button" style="margin-top:8px;padding:12px 22px;border:0;border-radius:12px;background:#e8b04b;color:#1a1205;font-weight:800;cursor:pointer">Yenidən yoxla</button>`;
  p.querySelector('button').onclick = () => location.reload();
  document.body.appendChild(p);
}
async function signInAnon(auth) {
  try { return (await auth.signInAnonymously()).user; }
  catch (e) { fatal(e); throw e; }
}

/* ── Təsdiq pəncərəsi ── */
const CSS = `
#yzGate{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:20px;overflow:auto;
  background:radial-gradient(circle at 50% 0%,#3a2a0e 0%,#14100a 55%,#0b0906 100%);font-family:Inter,system-ui,sans-serif;color:#f4eee2}
#yzGate .g-card{width:100%;max-width:400px;margin:auto;background:rgba(255,255,255,.05);border:1px solid rgba(232,176,75,.35);border-radius:20px;padding:26px 22px;box-shadow:0 20px 60px rgba(0,0,0,.5)}
#yzGate .g-brand{text-align:center;font:700 28px/1 Poppins,Inter,sans-serif;letter-spacing:.02em}
#yzGate .g-brand b{color:#e8b04b}
#yzGate .g-ico{width:54px;height:54px;border-radius:50%;margin:16px auto 0;display:flex;align-items:center;justify-content:center;background:rgba(232,176,75,.14);color:#e8b04b}
#yzGate .g-ico svg{width:26px;height:26px}
#yzGate h1{font-size:18px;text-align:center;margin:12px 0 6px;font-weight:700}
#yzGate p.g-hint{font-size:13px;color:#c9bfae;text-align:center;margin:0 0 6px;line-height:1.5}
#yzGate .g-code{display:flex;justify-content:center;gap:8px;align-items:center;margin:10px 0 4px;font-size:12px;color:#8f8676}
#yzGate .g-code b{font:700 14px/1 ui-monospace,Menlo,monospace;letter-spacing:.12em;color:#f4eee2;background:rgba(0,0,0,.35);padding:6px 10px;border-radius:8px}
#yzGate .g-warn{font-size:13px;line-height:1.45;color:#ffcf9a;background:rgba(232,120,40,.12);border:1px solid rgba(232,120,40,.35);border-radius:12px;padding:10px 12px;margin:10px 0 0}
#yzGate label{display:block;font-size:12px;font-weight:700;color:#c9bfae;margin:12px 0 6px}
#yzGate input,#yzGate select{width:100%;box-sizing:border-box;padding:13px 14px;border-radius:12px;border:1px solid rgba(232,176,75,.35);background:rgba(0,0,0,.35);color:#fff;font-size:16px;outline:none;font-family:inherit}
#yzGate select option{background:#14110b;color:#fff}
#yzGate input:focus,#yzGate select:focus{border-color:#e8b04b}
#yzGate .g-pw{position:relative}
#yzGate .g-pw input{padding-right:52px}
#yzGate .g-eye{position:absolute;right:6px;top:50%;transform:translateY(-50%);width:40px;height:40px;background:none;border:none;color:#c9bfae;cursor:pointer;display:flex;align-items:center;justify-content:center}
#yzGate .g-eye svg{width:20px;height:20px}
#yzGate .g-kind{display:grid;grid-template-columns:1fr 1fr;gap:8px}
#yzGate .g-kind label{margin:0;display:flex;flex-direction:column;gap:2px;padding:11px 12px;border-radius:12px;border:1px solid rgba(232,176,75,.25);background:rgba(0,0,0,.25);cursor:pointer;font-weight:700;color:#f4eee2;font-size:13.5px}
#yzGate .g-kind label small{font-weight:500;color:#a99f8e;font-size:11.5px;line-height:1.35}
#yzGate .g-kind input{position:absolute;opacity:0;pointer-events:none;width:1px;height:1px}
#yzGate .g-kind label:has(input:checked){border-color:#e8b04b;background:rgba(232,176,75,.14)}
#yzGate .g-btn{width:100%;margin-top:18px;padding:14px;border:none;border-radius:12px;background:linear-gradient(180deg,#f6cf7c,#e1a43e);color:#1a1205;font-weight:800;font-size:15px;cursor:pointer}
#yzGate .g-btn[disabled]{opacity:.6;cursor:wait}
#yzGate .g-ghost{width:100%;margin-top:10px;padding:12px;border-radius:12px;border:1px solid rgba(232,176,75,.35);background:transparent;color:#f4eee2;font-weight:700;font-size:14px;cursor:pointer}
#yzGate .g-err{min-height:18px;margin-top:12px;font-size:13px;color:#ff8a80;text-align:center;line-height:1.4}
#yzGate .g-who{font-size:13px;color:#c9bfae;text-align:center;margin:10px 0 0}
#yzGate .g-who b{color:#e8b04b}
#yzGate .g-lock{text-align:center;font-size:12px;color:#8f8676;margin-top:14px}
#yzGate [hidden]{display:none!important}`;
const ICO_DEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M11 18.5h2"/><path d="M9.5 9.5l1.8 1.8 3.4-3.6"/></svg>';
const ICO_EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';

function showEnroll(uid, prev) {
  return new Promise(resolve => {
    const box = document.createElement('div');
    box.id = 'yzGate';
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
    const off = prev && prev.on === false;
    box.innerHTML = `<style>${CSS}</style>
      <form class="g-card" novalidate autocomplete="off">
        <div class="g-brand">YuZa<b>POS</b></div>
        <div class="g-ico">${ICO_DEV}</div>
        <h1>Bu cihaz təsdiqlənməyib</h1>
        <p class="g-hint">Cihazı <b>bir dəfə</b> Rəhbər və ya səlahiyyətli şəxs öz istifadəçi adı və parolu ilə təsdiqləyir. Parol bu cihazda <b>saxlanmır</b>. Sonra işçilər öz PIN-ləri ilə girir.</p>
        <div class="g-code">Cihaz kodu <b>${devCode(uid)}</b></div>
        ${off ? `<p class="g-warn">Bu cihaz ${prev.offAt ? fmtDT(prev.offAt) + ' tarixində ' : ''}${prev.offBy ? '<b>' + esc(prev.offBy) + '</b> tərəfindən ' : ''}söndürülüb. İşləmək üçün yenidən təsdiq lazımdır.</p>` : ''}
        <div data-step="1">
          <label for="yzGL">İstifadəçi adı və ya Rəhbər e-poçtu</label>
          <input id="yzGL" autocomplete="off" autocapitalize="none" spellcheck="false" inputmode="email">
          <label for="yzGP">Parol</label>
          <div class="g-pw"><input id="yzGP" type="password" autocomplete="off">
            <button type="button" class="g-eye" aria-label="Parolu göstər" title="Parolu göstər">${ICO_EYE}</button></div>
          <button type="submit" class="g-btn">Davam et</button>
        </div>
        <div data-step="2" hidden>
          <p class="g-who">Təsdiq edən: <b></b></p>
          <label>Cihazın növü</label>
          <div class="g-kind">
            <label><input type="radio" name="yzGK" value="shared" checked>Ortaq cihaz<small>Kassa, zal, mətbəx ekranı — hamı PIN ilə girir</small></label>
            <label><input type="radio" name="yzGK" value="personal">İşçinin telefonu<small>Bir işçinin öz telefonu</small></label>
          </div>
          <div data-staff hidden>
            <label for="yzGS">Kimin telefonu?</label>
            <select id="yzGS"><option value="">— seçin —</option></select>
          </div>
          <label for="yzGN">Cihazın adı</label>
          <input id="yzGN" maxlength="40" placeholder="məs. Kassa kompüteri">
          <button type="submit" class="g-btn">Cihazı təsdiqlə</button>
          <button type="button" class="g-ghost" data-back>Başqa hesabla</button>
        </div>
        <div class="g-err" role="alert" aria-live="assertive"></div>
        <div class="g-lock">🔒 Qorunan bağlantı</div>
      </form>`;
    document.body.appendChild(box);
    const $ = (s) => box.querySelector(s);
    const err = (t) => { $('.g-err').textContent = t || ''; };
    const step = (n) => { box.querySelectorAll('[data-step]').forEach(d => { d.hidden = d.dataset.step !== String(n); }); err(''); };
    let appr = null, staff = [];
    const release = () => { const a = appr; appr = null; a?.release(); };
    $('.g-eye').onclick = () => { const i = $('#yzGP'); i.type = i.type === 'password' ? 'text' : 'password'; };
    const kind = () => box.querySelector('input[name="yzGK"]:checked')?.value || 'shared';
    const syncKind = () => {
      const per = kind() === 'personal';
      $('[data-staff]').hidden = !per;
      $('#yzGN').placeholder = per ? 'məs. Əlinin telefonu' : 'məs. Kassa kompüteri';
    };
    box.querySelectorAll('input[name="yzGK"]').forEach(r => { r.onchange = syncKind; });
    $('#yzGS').onchange = () => {
      const s = staff.find(x => x.id === $('#yzGS').value);
      const n = $('#yzGN');
      if (s && (!n.value || n.dataset.auto)) { n.value = `${s.name} — telefon`; n.dataset.auto = '1'; }
    };
    $('#yzGN').oninput = () => { delete $('#yzGN').dataset.auto; };
    $('[data-back]').onclick = () => { release(); $('#yzGP').value = ''; step(1); $('#yzGL').focus(); };

    $('form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const s1 = !box.querySelector('[data-step="1"]').hidden;
      const btn = box.querySelector(`[data-step="${s1 ? 1 : 2}"] .g-btn`);
      btn.disabled = true; err('');
      try {
        if (s1) {
          appr = await approverSignIn($('#yzGL').value, $('#yzGP').value);
          $('#yzGP').value = '';
          $('.g-who b').textContent = appr.name;
          staff = [];
          try {
            const o = (await appr.db.ref('staff').once('value')).val() || {};
            staff = Object.keys(o).map(id => ({ id, name: o[id]?.name || '' })).filter(x => x.name)
              .sort((a, b) => a.name.localeCompare(b.name, 'az'));
          } catch (e) { /* işçi siyahısı oxunmadı — ad əl ilə yazılır */ }
          $('#yzGS').innerHTML = '<option value="">— seçin —</option>' + staff.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
          if (prev?.name && !$('#yzGN').value) $('#yzGN').value = prev.name;
          step(2); syncKind(); $('#yzGN').focus();
        } else {
          if (!appr) { step(1); return; }
          const k = kind();
          const sid = k === 'personal' ? $('#yzGS').value : '';
          const s = staff.find(x => x.id === sid);
          const name = $('#yzGN').value.trim();
          if (k === 'personal' && staff.length && !s) { err('Telefonun kimə aid olduğunu seçin.'); return; }
          if (!name) { err('Cihaza ad verin (siyahıda tanımaq üçün).'); $('#yzGN').focus(); return; }
          const rec = { on: true, name, kind: k, staffId: s?.id || null, staffName: s?.name || null, model: deviceModel(), by: appr.name, byUid: appr.uid, at: TS() };
          await appr.db.ref('sys/devices/' + uid).set(rec);
          release();
          ls.set(K_OK, uid);
          box.remove();
          resolve(rec);
        }
      } catch (e) { err(apprErr(e)); if (s1) { $('#yzGP').value = ''; $('#yzGP').focus(); } }
      finally { btn.disabled = false; }
    });
    setTimeout(() => $('#yzGL').focus(), 50);
  });
}

/* ── Rəhbər panelində "Bu cihaz" kartı (Ayarlar → Giriş və təhlükəsizlik) ── */
let devRec = null;
const LOGIN_QR = 'yzLoginQr';
function deviceCard(uid) {
  const put = () => {
    const sec = document.getElementById('sec-settings');
    if (document.getElementById('yzDeviceCard')) return true;
    if (!sec) return false;
    const card = document.createElement('div');
    card.id = 'yzDeviceCard'; card.className = 'table-card'; card.style.cssText = 'margin-bottom:16px;max-width:500px';
    sec.prepend(card);
    renderCard(uid);
    return true;
  };
  if (put()) return;
  const mo = new MutationObserver(() => { if (put()) mo.disconnect(); });
  mo.observe(document.body, { childList: true, subtree: true });
}
function renderCard(uid) {
  const card = document.getElementById('yzDeviceCard'); if (!card) return;
  const d = devRec || {};
  const qrOn = ls.get(LOGIN_QR) === '1';
  card.innerHTML = `<h3 style="margin-bottom:8px;">🔒 Bu cihaz</h3>
    <div class="yzs-kv"><span>Ad</span><b>${esc(d.name || '—')}</b></div>
    <div class="yzs-kv"><span>Növ</span><b>${d.kind === 'personal' ? 'İşçinin telefonu' + (d.staffName ? ' — ' + esc(d.staffName) : '') : 'Ortaq cihaz'}</b></div>
    <div class="yzs-kv"><span>Cihaz kodu</span><b>${devCode(uid)}</b></div>
    <div class="yzs-kv"><span>Təsdiqləyən</span><b>${esc(d.by || '—')} · ${fmtDT(d.at)}</b></div>
    <label class="yzs-switch" style="margin-top:12px"><span><b>Giriş ekranında davamiyyət QR-ı</b>
      <small>PIN ekranının yanında işə gəliş/çıxış QR-ı və "İndi işdə" siyahısı görünür. Kassa kompüteri kimi ortaq cihazda açın, şəxsi telefonlarda bağlı saxlayın.</small></span>
      <input type="checkbox" data-loginqr ${qrOn ? 'checked' : ''}></label>
    <button type="button" class="btn btn-ghost" data-unlink style="width:100%;padding:12px;margin-top:12px;">Bu cihazın təsdiqini ləğv et</button>
    <p style="font-size:12px;color:var(--text3);margin-top:8px;">Cihaz satılanda, itəndə və ya başqasına veriləndə istifadə edin. Yenidən işlətmək üçün Rəhbər və ya səlahiyyətli şəxs təsdiqləməlidir. Bütün cihazlar: <b>Sistem → Cihazlar və girişlər</b>.</p>`;
  card.querySelector('[data-loginqr]').onchange = (e) => {
    ls.set(LOGIN_QR, e.target.checked ? '1' : null);
    window.dispatchEvent(new Event('yz-loginqr'));
  };
  card.querySelector('[data-unlink]').onclick = async () => {
    if (!confirm('Bu cihazın təsdiqi ləğv edilsin? Yenidən işlətmək üçün Rəhbər və ya səlahiyyətli şəxs təsdiqləməlidir.')) return;
    try { await firebase.database().ref('sys/devices/' + uid).remove(); } catch (e) { alert('Alınmadı: ' + (e.message || e)); return; }
    ls.set(K_OK, null);
    location.reload();
  };
}

/* ── Əsas funksiya: firebase-service.js bunu gözləyir ── */
export async function guardDevice(config) {
  if (!config?.apiKey || typeof firebase.auth !== 'function') return null;   // giriş qatı aktiv deyil
  if (ATT_PHONE) {
    // İşçi telefonu: ayrıca tətbiq nüsxəsi, öz adsız girişi (telefon → işçi bağlantısı bu girişə bağlıdır)
    const app = firebase.apps.find(a => a.name === 'yzIzle') || firebase.initializeApp(config, 'yzIzle');
    const a2 = app.auth();
    a2.languageCode = 'az';
    let u2 = await firstState(a2);
    if (!u2) u2 = await signInAnon(a2);
    window.__yzAttApp = app;
    return u2;
  }
  const auth = firebase.auth();
  auth.languageCode = 'az';
  let user = await firstState(auth);

  if (GUEST_MODE) {
    if (!user) user = await signInAnon(auth);
    return user;
  }
  // Köhnə "ortaq restoran hesabı" girişi → cihaz öz kimliyinə keçir (təsdiq bir dəfə soruşulacaq)
  if (user && !user.isAnonymous) { try { await auth.signOut(); } catch (e) { /* */ } user = null; }
  if (!user) user = await signInAnon(auth);
  const uid = user.uid;
  const ref = firebase.database().ref('sys/devices/' + uid);

  const fetchRec = () => ref.once('value').then(s => s.val()).catch(() => null);
  if (ls.get(K_OK) === uid) {
    // Əvvəl təsdiqlənib: açılış gözləmir, yoxlama arxada gedir (söndürülübsə aşağıdakı izləmə yenidən yükləyir)
    fetchRec().then(r => { if (r) { devRec = r; renderCard(uid); } });
  } else {
    const rec = await fetchRec();
    devRec = (rec && rec.on === true) ? rec : await showEnroll(uid, rec);
    ls.set(K_OK, uid);
  }
  window.__yzDevice = { uid, rec: () => devRec, code: devCode(uid) };
  // Söndürüləndə / silinəndə dərhal təsdiq ekranına qayıdır
  ref.on('value', (s) => {
    const r = s.val();
    if (r && r.on === true) { devRec = r; renderCard(uid); return; }
    ls.set(K_OK, null);
    location.reload();
  }, () => {});
  ref.child('seen').set(TS()).catch(() => {});
  /* Cihaz kimliyi itərsə (brauzer məlumatı silinib) — yenidən başla */
  auth.onAuthStateChanged(u => { if (!u || u.uid !== uid) location.reload(); });
  if (!IS_IZLE) deviceCard(uid);
  return user;
}
