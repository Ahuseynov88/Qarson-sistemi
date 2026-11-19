/* ═══════════════════════════════════════════
   PRINT AGENT KOMPÜTERLƏRİ (Mərhələ 1d) — Rəhbər paneli → Printerlər
   Kassa kompüterindəki Print Agent restorana kodla qoşulur:
   agentdə «Qoşulma kodu al» → burada «Kompüter qoş» → kodu yaz.
   Siyahı: sys/agents (kim, nə vaxt qoşub, açıq/söndürülüb) + printerAgents (onlayn, versiya).
   İdarə: Rəhbər və "Printerlər" icazəli işçi.
═══════════════════════════════════════════ */
import { db } from './firebase-service.js';
import { state } from './state.js';
import { esc, showToast, confirmAction } from './utils.js';
import { api, apiOn } from './yuza-api.js';

let agents = undefined;   // undefined: yüklənir, null: icazə yoxdur
let presence = {};
let who = null;
let offFns = [];
let formOpen = false;

const pad = (n) => String(n).padStart(2, '0');
const fmtDT = (ts) => { if (!ts) return '—'; const d = new Date(ts); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const ico = (id) => `<svg class="icon"><use href="#i-${id}"></use></svg>`;

function listen() {
  const me = state.user ? (state.user.ownerUid || state.user.id || state.user.role) : null;
  if (me === who) return;
  offFns.forEach(f => { try { f(); } catch (e) { /* */ } });
  offFns = []; who = me; agents = undefined; presence = {};
  if (!me) return;
  const a = db.ref('sys/agents'), p = db.ref('printerAgents');
  const onA = a.on('value', s => { agents = s.val() || {}; draw(); }, () => { agents = null; draw(); });
  const onP = p.on('value', s => { presence = s.val() || {}; draw(); }, () => { /* */ });
  offFns.push(() => a.off('value', onA), () => p.off('value', onP));
}

export function renderPrintAgents() {
  const host = document.getElementById('printAgentsCard');
  if (!host) return;
  if (!apiOn()) { host.style.display = 'none'; return; }   // server qatı olmayan saytda köhnə qayda
  host.style.display = '';
  listen();
  draw();
}

function draw() {
  const host = document.getElementById('printAgentsCard');
  if (!host || host.style.display === 'none') return;
  const head = `<h3 style="margin-bottom:8px;">${ico('printer')} Print Agent kompüterləri</h3>
    <p style="font-size:13px;color:var(--text2);margin-bottom:14px;">Çekləri printerlərə göndərən kompüterlər. Yeni kompüter qoşmaq üçün orada Print Agent-i açın, <b>«Qoşulma kodu al»</b> basın və kodu aşağıda yazın.</p>`;
  if (agents === null) {
    host.innerHTML = head + `<p style="font-size:13px;color:var(--text3);">Bu bölməni yalnız Rəhbər və «Printerlər» icazəsi olan işçi idarə edir.</p>`;
    return;
  }
  const form = formOpen ? `<div style="display:flex;gap:8px;align-items:center;margin-bottom:14px;flex-wrap:wrap;">
      <input type="text" id="paCode" inputmode="numeric" maxlength="7" placeholder="6 rəqəmli kod" autocomplete="off"
        style="flex:1;min-width:160px;font-size:20px;letter-spacing:4px;text-align:center;padding:10px;">
      <button class="btn btn-green" id="paConfirm" style="padding:11px 16px;">${ico('check')} Təsdiqlə</button>
      <button class="btn btn-ghost" id="paCancel" style="padding:11px 14px;">Ləğv</button>
    </div><p id="paErr" style="font-size:12px;color:var(--red);min-height:16px;margin:-8px 0 10px;"></p>`
    : `<button class="btn btn-green" id="paOpen" style="padding:10px 16px;margin-bottom:14px;">${ico('plus')} Kompüter qoş</button>`;

  const list = Object.entries(agents || {}).map(([id, a]) => ({ id, ...a })).sort((x, y) => (y.at || 0) - (x.at || 0));
  const rows = !agents ? `<p style="font-size:13px;color:var(--text3);">Yüklənir…</p>`
    : !list.length ? `<p style="font-size:13px;color:var(--text3);">Hələ heç bir kompüter qoşulmayıb.</p>`
    : list.map(a => {
        const pr = presence[a.id] || {};
        const online = a.on === true && pr.online === true && (Date.now() - (pr.lastSeen || 0) < 3 * 60 * 1000);
        const color = a.on !== true ? 'var(--text3)' : online ? 'var(--green)' : 'var(--orange)';
        const status = a.on !== true ? 'Söndürülüb' : online ? 'Onlayn — işləyir' : 'Oflayn';
        return `<div style="display:flex;gap:12px;align-items:flex-start;padding:12px 0;border-top:1px solid var(--border);" data-pa="${esc(a.id)}">
          <div style="width:10px;height:10px;border-radius:50%;background:${color};margin-top:6px;flex-shrink:0;"></div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;">${esc(pr.name || a.name || 'Kompüter')}</div>
            <div style="font-size:12px;color:var(--text2);">${status}${pr.version ? ' · v' + esc(pr.version) : ''}${pr.hostname ? ' · ' + esc(pr.hostname) : ''}</div>
            <div style="font-size:12px;color:var(--text3);">Son görünmə: ${fmtDT(pr.lastSeen || a.seen)} · Qoşulub: ${fmtDT(a.at)}${a.by ? ' (' + esc(a.by) + ')' : ''}</div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0;">
            <button class="btn btn-ghost" data-pa-toggle style="padding:7px 12px;font-size:12px;">${a.on === true ? 'Söndür' : 'Aç'}</button>
            <button class="btn btn-red yz-icon-only" data-pa-del style="padding:7px 10px;" aria-label="Sil" title="Sil">${ico('trash')}</button>
          </div>
        </div>`;
      }).join('');
  const focus = document.activeElement?.id === 'paCode' ? document.getElementById('paCode').value : null;
  host.innerHTML = head + form + `<div>${rows}</div>`;
  if (focus !== null) { const i = document.getElementById('paCode'); i.value = focus; i.focus(); }
  bind(host);
}

function bind(host) {
  host.querySelector('#paOpen')?.addEventListener('click', () => { formOpen = true; draw(); document.getElementById('paCode')?.focus(); });
  host.querySelector('#paCancel')?.addEventListener('click', () => { formOpen = false; draw(); });
  const go = () => pair();
  host.querySelector('#paConfirm')?.addEventListener('click', go);
  host.querySelector('#paCode')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  host.querySelectorAll('[data-pa]').forEach(row => {
    const id = row.dataset.pa;
    const a = (agents || {})[id] || {};
    const name = (presence[id] || {}).name || a.name || 'Kompüter';
    row.querySelector('[data-pa-toggle]')?.addEventListener('click', () => {
      const on = a.on === true;
      const run = () => db.ref(`sys/agents/${id}/on`).set(!on)
        .then(() => showToast(`${ico('check')} "${esc(name)}" ${on ? 'söndürüldü — çap dayandı' : 'yenidən açıldı'}`))
        .catch(() => showToast(`${ico('error')} Alınmadı: icazəniz yoxdur`));
      if (on) confirmAction(`"${esc(name)}" kompüteri söndürülsün? Bu kompüterdən çap dərhal dayanacaq.`, run, { title: 'Kompüteri söndür', okLabel: 'Söndür' });
      else run();
    });
    row.querySelector('[data-pa-del]')?.addEventListener('click', () => {
      confirmAction(`"${esc(name)}" siyahıdan silinsin? Bu kompüter yenidən çap etmək üçün yeni kodla qoşulmalı olacaq.`, () => {
        Promise.all([db.ref(`sys/agents/${id}`).remove(), db.ref(`printerAgents/${id}`).remove().catch(() => {})])
          .then(() => showToast(`${ico('check')} "${esc(name)}" silindi`))
          .catch(() => showToast(`${ico('error')} Alınmadı: icazəniz yoxdur`));
      }, { title: 'Kompüteri sil', okLabel: 'Sil' });
    });
  });
}

async function pair() {
  const inp = document.getElementById('paCode'), err = document.getElementById('paErr'), btn = document.getElementById('paConfirm');
  const code = String(inp?.value || '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(code)) { if (err) err.textContent = 'Kod 6 rəqəmdən ibarətdir.'; return; }
  if (btn) btn.disabled = true;
  try {
    const r = await api('agentPair', { code }, { owner: !!state.user?.ownerUid });
    formOpen = false;
    showToast(`${ico('check')} "${esc(r.name)}" qoşuldu — bir neçə saniyəyə işə düşəcək`);
    draw();
  } catch (e) {
    if (err) err.textContent = e.message || 'Alınmadı';
    if (btn) btn.disabled = false;
  }
}
