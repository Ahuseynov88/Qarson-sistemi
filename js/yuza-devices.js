/* ═══════════════════════════════════════════
   YUZA POS — CİHAZLAR VƏ GİRİŞLƏR (Sistem bölməsi) — 12.11.2026
   • Cihazlar: hər təsdiqlənmiş kompüter / telefon — kim təsdiqləyib, nə vaxt,
     son aktivlik. İstənilən cihaz ayrıca söndürülür — o cihaz dərhal işləməz olur,
     digərlərinə toxunulmur.
   • Səlahiyyətli hesablar (yalnız Rəhbər): işçiyə istifadəçi adı + parol verilir;
     bu hesabla o, yeni cihazları təsdiqləyə bilər. Hesab işçi kartına bağlıdır —
     hesab söndürülüb yenisi yaradılsa da hesabatlar dəyişmir.
   • Bütün dəyişikliklər Rəhbərin və ya səlahiyyətli şəxsin öz parolu ilə edilir:
     təsdiq olunmuş cihaz özü başqa cihazı aça / söndürə bilməz (baza qaydaları).
═══════════════════════════════════════════ */
import { db } from './firebase-service.js';
import { state } from './state.js';
import { showToast, esc } from './utils.js';
import { approverSignIn, apprErr, createLogin, normUser, validUser, devCode, fmtDT } from './yuza-approver.js';

const $ = (id) => document.getElementById(id);
const I = (id) => `<svg class="icon"><use href="#i-${id}"></use></svg>`;
const TS = () => firebase.database.ServerValue.TIMESTAMP;
const isRehber = () => state.user?.role === 'admin';
const active = () => !!$('sec-devices')?.classList.contains('active');

let devices = {}, accounts = {}, devRef = null, accRef = null;

/* ── Təsdiq edən: Rəhbər (açıq sessiya) və ya səlahiyyətli şəxsin öz girişi ── */
async function getApprover(reason) {
  if (isRehber()) {
    const O = window.__yzOwner;
    let odb = O?.db?.();
    if (!odb) {
      const ok = await O?.verify?.({ title: 'Rəhbər təsdiqi', text: reason });
      if (!ok) return null;
      odb = O?.db?.();
    }
    if (!odb) { showToast(`${I('warning')} Rəhbər sessiyası tapılmadı. Çıxıb yenidən daxil olun.`); return null; }
    return { db: odb, name: 'Rəhbər', owner: true, release() {} };
  }
  return approverModal(reason);
}
function approverModal(reason) {
  return new Promise(resolve => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg open yzd-appr';
    bg.innerHTML = `<form class="modal" style="max-width:380px" novalidate autocomplete="off">
      <h2 style="margin-bottom:6px">${I('key')} Təsdiq</h2>
      <p style="font-size:13px;color:var(--text2);margin-bottom:14px;line-height:1.5">${esc(reason)} Öz istifadəçi adınızı və parolunuzu yazın.</p>
      <div class="form-group"><label>İstifadəçi adı</label><input data-l autocapitalize="none" spellcheck="false"></div>
      <div class="form-group"><label>Parol</label><input data-p type="password"></div>
      <p data-e style="font-size:12.5px;color:var(--red);min-height:18px"></p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost yz-icon-only" data-close aria-label="Bağla" title="Bağla">${I('close')}</button>
        <button type="submit" class="btn btn-green">Təsdiqlə</button></div></form>`;
    document.body.appendChild(bg);
    const f = bg.querySelector('form');
    const done = (v) => { bg.remove(); resolve(v); };
    bg.querySelector('[data-close]').onclick = () => done(null);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const b = f.querySelector('[type=submit]'); b.disabled = true; f.querySelector('[data-e]').textContent = '';
      try { done(await approverSignIn(f.querySelector('[data-l]').value, f.querySelector('[data-p]').value)); }
      catch (er) { f.querySelector('[data-e]').textContent = apprErr(er); f.querySelector('[data-p]').value = ''; b.disabled = false; }
    });
    setTimeout(() => f.querySelector('[data-l]').focus(), 50);
  });
}
async function asApprover(reason, fn) {
  const a = await getApprover(reason);
  if (!a) return false;
  try { await fn(a); return true; }
  catch (e) { showToast(`${I('error')} ${esc(apprErr(e))}`); return false; }
  finally { a.release(); }
}

/* ── Bölmə ── */
function ensureSection() {
  if ($('sec-devices')) return true;
  const body = $('adminBody'); if (!body) return false;
  const d = document.createElement('div');
  d.className = 'admin-section'; d.id = 'sec-devices';
  d.innerHTML = '<div class="yzd"></div>';
  body.appendChild(d);
  new MutationObserver(() => { if (active()) start(); else stop(); }).observe(d, { attributes: true, attributeFilter: ['class'] });
  return true;
}
function start() {
  if (!devRef) {
    devRef = db.ref('sys/devices');
    devRef.on('value', s => { devices = s.val() || {}; render(); }, (e) => { devices = {}; render(e); });
  }
  if (isRehber() && !accRef) {
    accRef = db.ref('sys/accounts');
    accRef.on('value', s => { accounts = s.val() || {}; render(); }, () => { accounts = {}; render(); });
  }
  render();
}
function stop() {
  devRef?.off(); devRef = null;
  accRef?.off(); accRef = null;
}

function render(err) {
  const host = $('sec-devices')?.querySelector('.yzd'); if (!host) return;
  if (!window.__yzDevice) {
    host.innerHTML = `<div class="table-card yzs-card"><h3>${I('lock')} Cihazlar və girişlər</h3>
      <p style="font-size:13px;color:var(--text2)">Bu saytda cihaz təsdiqi hələ aktiv deyil (Firebase giriş qatı qoşulmayıb).</p></div>`;
    return;
  }
  // Skelet bir dəfə qurulur; canlı yeniləmələr yalnız siyahıları dəyişir (yazılan forma pozulmur)
  const owner = isRehber();
  if (host.dataset.built !== (owner ? 'o' : 's')) {
    host.dataset.built = owner ? 'o' : 's';
    host.innerHTML = `
      <header class="yzd-head"><h2>${I('lock')} Cihazlar və girişlər</h2>
        <p>Hər kompüter və telefon bir dəfə təsdiqlənir. İstənilən cihazı ayrıca söndürə bilərsiniz — o cihaz dərhal işləməz olur.</p></header>
      <p class="yzd-err" id="yzdErr" hidden></p>
      <section class="table-card yzs-card">
        <h3>${I('phone')} Cihazlar <span class="yzd-cnt" id="yzdDevCnt"></span></h3>
        <p class="yzd-note">Burada <b>ortaq cihazlar</b> var (kassa, mətbəx, zal planşeti). Yeni cihaz: həmin cihazda saytı açın — Rəhbər və ya səlahiyyətli şəxs öz girişi ilə təsdiqləyir. İşçilərin öz telefonları ayrıca təsdiq olunmur: davamiyyətə qoşulmuş telefon (Personal izləmə → Telefonlar) işçi işdə olanda avtomatik açılır.</p>
        <div class="yzd-list" id="yzdDevList"></div>
      </section>
      ${owner ? accountsHtml() : `<p class="yzd-note">${I('key')} Səlahiyyətli hesabları yalnız Rəhbər idarə edir.</p>`}`;
  }
  const me = window.__yzDevice.uid;
  const list = Object.entries(devices).map(([uid, d]) => ({ uid, ...d }))
    .sort((a, b) => (b.on === true) - (a.on === true) || (b.seen || b.at || 0) - (a.seen || a.at || 0));
  const e = $('yzdErr');
  if (e) { e.hidden = !err; e.innerHTML = err ? `${I('warning')} Siyahı oxunmadı: ${esc(err.message || err)}` : ''; }
  $('yzdDevCnt').textContent = `${list.filter(d => d.on === true).length} aktiv · ${list.length} cəmi`;
  $('yzdDevList').innerHTML = list.map(d => devRow(d, me)).join('') || '<p class="yzd-note">Hələ cihaz yoxdur.</p>';
  if (owner) renderAccounts();
}
function devRow(d, me) {
  const off = d.on !== true;
  return `<div class="yzd-row${off ? ' is-off' : ''}">
    <span class="yzd-ico">${I(d.kind === 'personal' ? 'phone' : 'home')}</span>
    <div class="yzd-main">
      <b>${esc(d.name || 'Adsız cihaz')}${d.uid === me ? ' <em class="yzd-me">bu cihaz</em>' : ''}</b>
      <small>${d.kind === 'personal' ? 'İşçinin telefonu' + (d.staffName ? ' — ' + esc(d.staffName) : '') : 'Ortaq cihaz'} · ${esc(d.model || '')} · kod ${devCode(d.uid)}</small>
      <small>Təsdiqləyən: ${esc(d.by || '—')} · ${fmtDT(d.at)}${d.seen ? ` · son aktivlik: ${fmtDT(d.seen)}` : ''}</small>
      ${d.kind === 'personal' ? '<small class="yzd-offtxt">Keçərsizdir: işçi telefonları artıq davamiyyət qeydiyyatı ilə tanınır (Personal izləmə → Telefonlar). Siyahıdan silə bilərsiniz.</small>' : ''}
      ${off ? `<small class="yzd-offtxt">Söndürülüb${d.offBy ? ': ' + esc(d.offBy) : ''}${d.offAt ? ' · ' + fmtDT(d.offAt) : ''}</small>` : ''}
    </div>
    <div class="yzd-acts">
      ${off ? `<button type="button" class="btn btn-ghost btn-sm" data-dev-on="${esc(d.uid)}">${I('check')} Aktiv et</button>
               <button type="button" class="btn btn-ghost btn-sm yz-icon-only" data-dev-del="${esc(d.uid)}" aria-label="Siyahıdan sil" title="Siyahıdan sil">${I('trash')}</button>`
        : `<button type="button" class="btn btn-ghost btn-sm yzd-danger" data-dev-off="${esc(d.uid)}">${I('lock')} Söndür</button>`}
    </div></div>`;
}
function accountsHtml() {
  return `<section class="table-card yzs-card">
    <h3>${I('key')} Səlahiyyətli hesablar <span class="yzd-cnt" id="yzdAccCnt"></span></h3>
    <p class="yzd-note">Bu hesabla işçi (məs. növbə müdiri) yeni cihazları təsdiqləyir və cihazları söndürə bilir. Rəhbər bölmələrinə giriş vermir — sistemdə o, PIN ilə öz icazələri daxilində işləyir.</p>
    <div class="yzd-list" id="yzdAccList"></div>
    <details class="yzd-new" id="yzdNew"><summary>${I('plus')} Yeni hesab</summary>
      <form class="yzd-form" novalidate autocomplete="off">
        <div class="form-group"><label>İşçi</label><select data-f="staff"></select></div>
        <div class="form-group"><label>İstifadəçi adı</label><input data-f="user" autocapitalize="none" spellcheck="false" placeholder="məs. kamran" maxlength="24">
          <small class="yzd-hint">Kiçik latın hərfləri, rəqəm, nöqtə, tire (3–24 simvol).</small></div>
        <div class="form-row">
          <div class="form-group"><label>Parol</label><input data-f="pw" type="password" autocomplete="new-password"></div>
          <div class="form-group"><label>Parolun təkrarı</label><input data-f="pw2" type="password" autocomplete="new-password"></div>
        </div>
        <p class="yzd-err" data-f="err"></p>
        <button type="submit" class="btn btn-green">${I('check')} Hesabı yarat</button>
        <p class="yzd-note" style="margin-top:10px">Parol unudulsa: köhnə hesabı <b>söndürün</b> və eyni istifadəçi adı ilə yenisini yaradın — işçinin məlumatları və hesabatlar dəyişmir.</p>
      </form></details>
  </section>`;
}
function renderAccounts() {
  const box = $('yzdAccList'); if (!box) return;
  const list = Object.entries(accounts).map(([uid, a]) => ({ uid, ...a }))
    .sort((a, b) => (b.on === true) - (a.on === true) || String(a.staffName || '').localeCompare(String(b.staffName || ''), 'az'));
  $('yzdAccCnt').textContent = `${list.filter(a => a.on === true).length} aktiv`;
  box.innerHTML = list.map(a => `<div class="yzd-row${a.on !== true ? ' is-off' : ''}">
      <span class="yzd-ico">${I('staff')}</span>
      <div class="yzd-main"><b>${esc(a.staffName || '—')}</b>
        <small>İstifadəçi adı: <code>${esc(a.username || '')}</code> · yaradılıb: ${fmtDT(a.at)}</small>
        ${a.on !== true ? `<small class="yzd-offtxt">Söndürülüb${a.offAt ? ' · ' + fmtDT(a.offAt) : ''}</small>` : ''}</div>
      <div class="yzd-acts">${a.on === true
        ? `<button type="button" class="btn btn-ghost btn-sm yzd-danger" data-acc-off="${esc(a.uid)}">${I('lock')} Söndür</button>`
        : `<button type="button" class="btn btn-ghost btn-sm" data-acc-on="${esc(a.uid)}">${I('check')} Aktiv et</button>`}</div></div>`).join('') || '<p class="yzd-note">Hələ hesab yoxdur.</p>';
  const sel = document.querySelector('#yzdNew [data-f="staff"]');
  if (sel && document.activeElement !== sel) {
    const cur = sel.value;
    const staff = (state.staff || []).filter(s => s && s.name).sort((a, b) => String(a.name).localeCompare(String(b.name), 'az'));
    sel.innerHTML = '<option value="">— seçin —</option>' + staff.map(s => `<option value="${esc(s.id)}">${esc(s.name)}${s.position ? ' — ' + esc(s.position) : ''}</option>`).join('');
    sel.value = cur;
  }
}

/* ── Əməliyyatlar ── */
async function setDevice(uid, on) {
  const d = devices[uid] || {};
  if (!on && uid === window.__yzDevice?.uid && !confirm('Bu, hazırda işlədiyiniz cihazdır. Söndürülsün? Cihaz dərhal kilidlənəcək.')) return;
  if (!on && uid !== window.__yzDevice?.uid && !confirm(`"${d.name || 'Cihaz'}" söndürülsün? Həmin cihaz dərhal işləməz olacaq.`)) return;
  await asApprover(on ? 'Cihazı yenidən aktiv etmək üçün.' : 'Cihazı söndürmək üçün.', async (a) => {
    await a.db.ref('sys/devices/' + uid).update(on
      ? { on: true, offAt: null, offBy: null, by: a.name, at: TS() }
      : { on: false, offAt: TS(), offBy: a.name });
    showToast(`${I('check')} ${on ? 'Cihaz aktiv edildi' : 'Cihaz söndürüldü'}`);
  });
}
async function delDevice(uid) {
  if (!confirm('Cihaz siyahıdan silinsin? (Söndürülmüş cihazdır — yenidən işlətmək üçün təsdiq lazım olacaq.)')) return;
  await asApprover('Cihazı siyahıdan silmək üçün.', async (a) => {
    await a.db.ref('sys/devices/' + uid).remove();
    showToast(`${I('check')} Silindi`);
  });
}
async function setAccount(uid, on) {
  const a0 = accounts[uid] || {};
  if (!on && !confirm(`"${a0.staffName || a0.username}" hesabı söndürülsün? Bu hesabla artıq cihaz təsdiqlənə bilməyəcək.`)) return;
  await asApprover('Hesabı dəyişmək üçün.', async (a) => {
    if (on && a0.username) {
      // Eyni adla başqa aktiv hesab varsa, köhnəni aktiv etmək olmaz
      const l = (await a.db.ref('sys/logins/' + a0.username).once('value')).val();
      if (l?.uid && l.uid !== uid && accounts[l.uid]?.on === true) throw { code: 'yz/taken' };
      await a.db.ref('sys').update({ [`accounts/${uid}/on`]: true, [`accounts/${uid}/offAt`]: null, [`logins/${a0.username}`]: { email: a0.email, uid } });
    } else {
      await a.db.ref('sys/accounts/' + uid).update(on ? { on: true, offAt: null } : { on: false, offAt: TS() });
    }
    showToast(`${I('check')} ${on ? 'Hesab aktiv edildi' : 'Hesab söndürüldü'}`);
  });
}
async function newAccount(form) {
  const v = (k) => form.querySelector(`[data-f="${k}"]`);
  const err = (m) => { v('err').textContent = m || ''; };
  err('');
  const sid = v('staff').value, user = normUser(v('user').value), pw = v('pw').value, pw2 = v('pw2').value;
  const s = (state.staff || []).find(x => x.id === sid);
  if (!s) return err('İşçini seçin.');
  if (!validUser(user)) return err('İstifadəçi adı 3–24 simvol: kiçik latın hərfləri, rəqəm, nöqtə, tire.');
  if (pw.length < 6) return err('Parol ən azı 6 simvol olmalıdır.');
  if (pw !== pw2) return err('Parollar eyni deyil.');
  const btn = form.querySelector('[type=submit]'); btn.disabled = true;
  try {
    await asApprover('Yeni hesab yaratmaq üçün.', async (a) => {
      const l = (await a.db.ref('sys/logins/' + user).once('value')).val();
      if (l?.uid && accounts[l.uid]?.on === true) throw { code: 'yz/taken' };
      const { uid, email } = await createLogin(user, pw);
      await a.db.ref('sys').update({
        [`accounts/${uid}`]: { on: true, enroll: true, staffId: s.id, staffName: s.name, username: user, email, at: TS(), by: a.name },
        [`logins/${user}`]: { email, uid }
      });
      form.reset();
      showToast(`${I('check')} Hesab yaradıldı: ${esc(user)}`);
    });
  } finally { btn.disabled = false; }
}

function onClick(e) {
  const t = (k) => e.target.closest(`[${k}]`)?.getAttribute(k);
  let id;
  if ((id = t('data-dev-off'))) return setDevice(id, false);
  if ((id = t('data-dev-on'))) return setDevice(id, true);
  if ((id = t('data-dev-del'))) return delDevice(id);
  if ((id = t('data-acc-off'))) return setAccount(id, false);
  if ((id = t('data-acc-on'))) return setAccount(id, true);
}

function init() {
  if (!ensureSection()) { const t = setInterval(() => { if (ensureSection()) { clearInterval(t); bind(); } }, 200); setTimeout(() => clearInterval(t), 15000); return; }
  bind();
}
function bind() {
  const sec = $('sec-devices'); if (!sec || sec.dataset.yzd) return;
  sec.dataset.yzd = '1';
  sec.addEventListener('click', onClick);
  sec.addEventListener('submit', (e) => { const f = e.target.closest('.yzd-form'); if (!f) return; e.preventDefault(); newAccount(f); });
  if (active()) start();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
