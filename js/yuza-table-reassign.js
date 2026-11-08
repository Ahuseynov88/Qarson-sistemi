/* ═══════════════════════════════════════════
   YUZA POS — MASANI BAŞQA OFİSİANTA ÖTÜRMƏK
   Masa ekranında "Ofisiantı dəyiş" düyməsi (yalnız Rəhbər və "Masanı başqa ofisianta
   ötürmək" icazəsi olan şəxs görür).

   Satış ədalətli bölünür: ötürülən ana qədər olan hesab köhnə ofisiantın, sonra vurulan
   mallar yeni ofisiantın adına yazılır. Hər ötürmə tableOrders/{masa}/waiterLog-a yazılır,
   masa bağlananda bölgü "waiterSplit" kimi arxivə düşür və işçi hesabatı onu işlədir.
   index.html-də yalnız bu fayl qoşulur, mövcud kodu dəyişmir.
═══════════════════════════════════════════ */
import { state } from './state.js';
import { db, R } from './firebase-service.js';
import { hasPermission } from './permissions.js';
import { esc, showToast, addLog } from './utils.js';
import { modal } from './yuza-inv-ui.js';
import { A, withDefaults, phaseOf } from './yuza-att-core.js';

const $ = (id) => document.getElementById(id);
const PERM = 'table.reassign';
const ICON = '<svg class="icon"><use href="#i-users"></use></svg>';
const money = (n) => (Math.round((+n || 0) * 100) / 100).toFixed(2) + ' ₼';
const fmtDT = (t) => { const d = new Date(t), p = (n) => String(n).padStart(2, '0'); return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; };

/* ── Düymə: "Masa köçür" düyməsinin yanında ── */
function ensureBtn() {
  const ref = $('notesTransferBtn');
  if (!ref) return null;
  let b = $('notesReassignBtn');
  if (!b) {
    b = document.createElement('button');
    b.id = 'notesReassignBtn'; b.type = 'button'; b.className = 'btn btn-ghost'; b.style.display = 'none';
    b.innerHTML = `${ICON} Ofisiantı dəyiş`;
    b.addEventListener('click', () => openReassign(state.noteTableId));
    ref.insertAdjacentElement('afterend', b);
  }
  return b;
}
function refresh() {
  const b = ensureBtn(); if (!b) return;
  const t = (state.tables || []).find(x => x.id === state.noteTableId);
  const show = !!(t && t.occupant && state.user && hasPermission(PERM));
  b.style.display = show ? '' : 'none';
}

/* ── Pəncərə ── */
async function openReassign(tableId) {
  if (!hasPermission(PERM)) { showToast('<svg class="icon"><use href="#i-ban"></use></svg> Masanı ötürmək icazəniz yoxdur'); return; }
  const t = (state.tables || []).find(x => x.id === tableId);
  if (!t || !t.occupant) { showToast('Masa boşdur'); return; }
  const cur = (state.staff || []).find(s => s.id === t.occupant);
  const total = state.tableOrders?.[tableId]?.total || 0;
  let S = withDefaults(null), status = {};
  try {
    const [a, b] = await Promise.all([A('settings').once('value'), A('status').once('value')]);
    S = withDefaults(a.val()); status = b.val() || {};
  } catch (e) { /* davamiyyət oxunmadısa, hamı göstərilir */ }
  const list = (state.staff || []).filter(s => s && s.name && s.id !== t.occupant && s.status !== 'offline' && s.systemAccess !== false && (s.permissions || []).includes('table.view'))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'az'));
  const canPick = (s) => !S.gateLogin || S.gateExempt?.[s.id] || phaseOf(status[s.id], S) === 'in';
  const m = modal({
    title: `${esc(t.name)} — ofisiantı dəyiş`,
    body: `<p class="yzi-p">İndiki ofisiant: <b>${esc(cur?.name || '?')}</b> · cari hesab: <b>${money(total)}</b></p>
      <p class="yzi-hint">Ötürülənə qədər olan hesab (<b>${money(total)}</b>) <b>${esc(cur?.name || '?')}</b>-in satışına, bundan sonra vurulan mallar yeni ofisiantın satışına yazılır.</p>
      <div class="yzr-list">${list.map(s => {
        const ok = canPick(s);
        return `<button type="button" class="yzr-i" data-to="${esc(s.id)}" ${ok ? '' : 'disabled'}>
          <b>${esc(s.name)}</b><small>${esc(s.position || '')}${ok ? '' : ' · işə gəlişini qeyd etməyib'}</small></button>`;
      }).join('') || '<p class="yzi-empty">Başqa aktiv işçi yoxdur.</p>'}</div>`,
    actions: [{ label: 'Ləğv', cancel: true, cls: 'yzi-btn--ghost' }]
  });
  m.body.querySelectorAll('[data-to]').forEach(btn => btn.onclick = async () => {
    const to = (state.staff || []).find(s => s.id === btn.dataset.to);
    if (!to) return;
    btn.disabled = true;
    try { await reassign(tableId, to); m.close(); }
    catch (e) { btn.disabled = false; showToast('<svg class="icon"><use href="#i-error"></use></svg> Ötürülmədi: ' + esc(e.message || e)); }
  });
}

async function reassign(tableId, to) {
  const t = (state.tables || []).find(x => x.id === tableId);
  const fromId = t?.occupant || null;
  const from = (state.staff || []).find(s => s.id === fromId);
  const by = { id: state.user?.id || 'admin', name: state.user?.name || 'Rəhbər' };
  const at = Date.now();
  let totalBefore = 0;
  // Hesabdakı ötürmə anını atomik yazırıq (eyni anda mal vurulsa da məbləğ düz qalır)
  await R.tableOrders.child(tableId).transaction(cur => {
    if (!cur) return cur;                 // hələ sifariş yoxdur — yalnız masa sahibi dəyişir
    totalBefore = cur.total || 0;
    const log = { ...(cur.waiterLog || {}) };
    log['w' + at] = { at, fromId, fromName: from?.name || t?.openedByName || '?', toId: to.id, toName: to.name, totalBefore, byId: by.id, byName: by.name };
    return { ...cur, waiterLog: log };
  });
  await R.tables.child(tableId).update({ occupant: to.id });
  addLog('table_transfer', `${by.name} "${t?.name}" masasını ${from?.name || '?'}-dən ${to.name}-ə ötürdü (ötürülənə qədər hesab: ${money(totalBefore)})`,
    { tableId, sessionId: t?.sessionId || null, fromStaffId: fromId, toStaffId: to.id, reassign: true });
  showToast(`<svg class="icon"><use href="#i-check"></use></svg> "${esc(t?.name)}" → ${esc(to.name)} · ${fmtDT(at)}`);
}

/* ── Masa bağlananda satışın bölgüsü (tables.js çağırır) ──
   order.waiterLog → [{ id, name, amount }]; ötürmə yoxdursa null */
export function splitByWaiter(order, firstId, firstName) {
  const log = Object.values(order?.waiterLog || {}).sort((a, b) => (a.at || 0) - (b.at || 0));
  if (!log.length) return null;
  const final = +order.total || 0;
  const out = [];
  let done = 0;
  const add = (id, name, amt) => {
    amt = Math.round(Math.max(0, amt) * 100) / 100;
    const ex = out.find(x => x.id === id);
    if (ex) ex.amount = Math.round((ex.amount + amt) * 100) / 100; else out.push({ id: id || null, name: name || '?', amount: amt });
  };
  log.forEach((w, i) => {
    const upto = Math.min(+w.totalBefore || 0, final);
    add(w.fromId || (i === 0 ? firstId : null), w.fromName || (i === 0 ? firstName : '?'), upto - done);
    done = Math.max(done, upto);
  });
  const last = log[log.length - 1];
  add(last.toId, last.toName, final - done);
  return out;
}
window.__yzSplitByWaiter = splitByWaiter;

/* ── Başlanğıc ── */
function init() {
  const css = document.createElement('style');
  css.textContent = `.yzr-list{display:flex;flex-direction:column;gap:8px;max-height:52vh;overflow:auto;margin-top:10px}
    .yzr-i{display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:12px 14px;border-radius:12px;border:1px solid var(--border);background:var(--card);color:var(--text);font:inherit;text-align:left;cursor:pointer}
    .yzr-i:hover:not(:disabled){border-color:var(--gold)}
    .yzr-i small{color:var(--text3);font-size:12px}
    .yzr-i:disabled{opacity:.5;cursor:not-allowed}`;
  document.head.appendChild(css);
  setInterval(refresh, 700);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
