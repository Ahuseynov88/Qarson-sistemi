/* ═══════════════════════════════════════════
   BANKET VƏ TƏDBİRLƏRİN İDARƏ EDİLMƏSİ MODULU
   Toy, nişan, korporativ və digər xüsusi tədbirlərin tam idarə edilməsi.
   "tables" (gündəlik restoran masaları) və "menuItems" (a-la-cart menyu) ilə
   QARIŞDIRILMIR - tamam ayrı, müstəqil bir alt-sistemdir.

   FAZA 1: Zallar, Tədbir Növləri, Təqvim, Tədbir yaratma (konflikt-təhlükəsiz),
   Dashboard, əsas Maliyyə (ümumi məbləğ/avans/qalıq).
   Sonrakı fazalar: Menyu/Xidmət planlaması, Tapşırıqlar, Masa planı (Drag&Drop),
   Sənəd/PDF, Bildirişlər, ayrıca hesabatlar.
═══════════════════════════════════════════ */
import { R, db } from './firebase-service.js';
import { state } from './state.js';
import { esc, showToast, addLog } from './utils.js';
import { confirmDelete2x } from './utils.js';
import { hasPermission } from './permissions.js';
import { serverNow, money2, computeOrderTotals, makeLineKey, updateStock } from './utils.js';
import { modal as yzModal, confirmBox, numInput } from './yuza-inv-ui.js';
import { needShift } from './yuza-shift.js';

const AZ_MONTHS = ['Yanvar','Fevral','Mart','Aprel','May','İyun','İyul','Avqust','Sentyabr','Oktyabr','Noyabr','Dekabr'];
const AZ_WEEKDAYS = ['B.e','Ç.a','Ç','C.a','C','Ş','B'];

const STATUS_INFO = {
  pending:   { label: 'İlkin rezerv',   color: '#f1c40f' },
  confirmed: { label: 'Təsdiqlənmiş',   color: '#3498db' },
  full:      { label: 'Tam dolu',       color: '#e74c3c' },
  cancelled: { label: 'Ləğv edilmiş',   color: '#7f8c8d' }
};
function dateStr(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function fmtMoney(n) { return (n||0).toFixed(2) + ' ₼'; }

/* ═══ ZALLAR (Hallar) ═══ */

export function renderBanquetHalls() {
  const el = document.getElementById('banquetHallsGrid');
  if (!el) return;
  if (!state.banquetHalls.length) {
    el.innerHTML = '<p style="color:var(--text3);">Hələ zal əlavə edilməyib. Sağ alt küncdəki "+" düyməsi ilə əlavə edin.</p>';
    return;
  }
  el.innerHTML = state.banquetHalls.map(h => `
    <div class="tile-card" onclick="selectBanquetHall('${h.id}')">
      <div class="tile-card__icon"><svg class="icon"><use href="#i-chair"></use></svg></div>
      <div class="tile-card__name">${esc(h.name)}</div>
      <div class="tile-card__meta">${h.capacity||0} nəfər</div>
      <div class="tile-card__meta">${fmtMoney(h.price)}</div>
    </div>
  `).join('');
}

export function selectBanquetHall(id) {
  state._selectedHallId = id;
  const overlay = document.getElementById('banquetHallDetailPanel');
  if (!id) { overlay?.classList.remove('open'); return; }
  const h = state.banquetHalls.find(x => x.id === id);
  if (!h) { overlay?.classList.remove('open'); return; }
  const upcomingEvents = state.banquetEvents.filter(e => e.hallId === id && e.date >= dateStr(new Date()) && e.status !== 'cancelled')
    .sort((a,b) => a.date.localeCompare(b.date)).slice(0, 5);
  document.getElementById('banquetHallDetailBody').innerHTML = `
    <div class="ct-detail-header" style="justify-content:center;text-align:center;flex-direction:column;gap:6px;">
      <span style="font-size:19px;"><svg class="icon"><use href="#i-chair"></use></svg> ${esc(h.name)}</span>
    </div>
    <div class="ct-detail-info-grid">
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Tutum</div><div class="ct-detail-info-block__value">${h.capacity||0} nəfər</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Qiymət</div><div class="ct-detail-info-block__value">${fmtMoney(h.price)}</div></div>
    </div>
    ${h.notes ? `<div class="ct-detail-section-title">Qeyd</div><p style="font-size:13px;color:var(--text2);">${esc(h.notes)}</p>` : ''}
    <div class="ct-detail-section-title"><svg class="icon" style="width:.9em;height:.9em;"><use href="#i-clock"></use></svg> Yaxın tədbirlər</div>
    ${upcomingEvents.length ? upcomingEvents.map(e => `<div class="ct-detail-item-row"><span>${esc(e.date)} — ${esc(e.clientName)}</span><span style="color:${STATUS_INFO[e.status]?.color};font-weight:600;">${STATUS_INFO[e.status]?.label||''}</span></div>`).join('') : '<p style="font-size:13px;color:var(--text3);">Yaxın tədbir yoxdur.</p>'}
    <div class="ct-detail-actions">
      <button class="btn btn-blue" style="flex:1;padding:11px;" onclick="openBanquetHallModal('${h.id}')"><svg class="icon"><use href="#i-tag"></use></svg> Redaktə Et</button>
      <button class="btn btn-red" style="flex:1;padding:11px;" onclick="deleteBanquetHall('${h.id}')"><svg class="icon"><use href="#i-trash"></use></svg> Sil</button>
    </div>
  `;
  overlay?.classList.add('open');
}

export function openBanquetHallModal(id) {
  const h = id ? state.banquetHalls.find(x => x.id === id) : null;
  document.getElementById('banquetHallModal').dataset.editId = id || '';
  document.getElementById('banquetHallModalTitle').innerHTML = `<svg class="icon"><use href="#i-chair"></use></svg> ${id?'Zalı Redaktə Et':'Yeni Zal'}`;
  document.getElementById('bh_name').value = h?.name || '';
  document.getElementById('bh_capacity').value = h?.capacity || '';
  document.getElementById('bh_price').value = h?.price || '';
  document.getElementById('bh_notes').value = h?.notes || '';
  document.getElementById('banquetHallModal').classList.add('open');
}
export function closeBanquetHallModal() { document.getElementById('banquetHallModal').classList.remove('open'); }

export function saveBanquetHall() {
  const name = document.getElementById('bh_name').value.trim();
  if (!name) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Zalın adı mütləqdir'); return; }
  const data = {
    name, capacity: parseInt(document.getElementById('bh_capacity').value) || 0,
    price: parseFloat(document.getElementById('bh_price').value) || 0,
    notes: document.getElementById('bh_notes').value.trim()
  };
  const editId = document.getElementById('banquetHallModal').dataset.editId;
  if (editId) { R.banquetHalls.child(editId).update(data); addLog('table_mgmt', `Banket zalı redaktə edildi: ${name}`, {}); }
  else { data.createdAt = Date.now(); R.banquetHalls.push(data); addLog('table_mgmt', `Yeni banket zalı əlavə edildi: ${name}`, {}); }
  closeBanquetHallModal();
  showToast('<svg class="icon"><use href="#i-check"></use></svg> Yadda saxlanıldı');
}

export function deleteBanquetHall(id) {
  const h = state.banquetHalls.find(x => x.id === id);
  if (!h) return;
  const hasEvents = state.banquetEvents.some(e => e.hallId === id && e.status !== 'cancelled');
  if (hasEvents) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Bu zalda aktiv tədbirlər var, əvvəlcə onları ləğv edin'); return; }
  confirmDelete2x(1, `"${esc(h.name)}" adlı zal`, () => {
    R.banquetHalls.child(id).remove();
    addLog('table_mgmt', `Banket zalı silindi: ${h.name}`, {});
    state.banquetHalls = state.banquetHalls.filter(x => x.id !== id);
    if (state._selectedHallId === id) state._selectedHallId = null;
    renderBanquetHalls();
    showToast('<svg class="icon"><use href="#i-check"></use></svg> Zal silindi');
  });
}

/* ═══ TƏDBİR NÖVLƏRİ ═══ */

const DEFAULT_EVENT_TYPES = ['Toy','Nişan','Xınayaxdı','Ad günü','Korporativ','Yas mərasimi','İftar','Məzuniyyət','Konfrans'];

export function ensureDefaultEventTypes() {
  // İlk dəfə işə düşəndə standart tədbir növlərini yaradır (yalnız heç biri yoxdursa)
  R.banquetEventTypes.once('value', snap => {
    if (snap.val()) return;
    DEFAULT_EVENT_TYPES.forEach(name => R.banquetEventTypes.push({ name, createdAt: Date.now() }));
  });
}

export function renderBanquetEventTypes() {
  const el = document.getElementById('banquetEventTypesGrid');
  if (!el) return;
  if (!state.banquetEventTypes.length) { el.innerHTML = '<p style="color:var(--text3);">Hələ tədbir növü yoxdur.</p>'; return; }
  el.innerHTML = state.banquetEventTypes.map(t => `
    <div class="tile-card" onclick="openBanquetEventTypeModal('${t.id}')" style="position:relative;">
      <button class="purchase-line__remove" style="position:absolute;top:8px;right:8px;" onclick="event.stopPropagation();deleteBanquetEventType('${t.id}')">×</button>
      <div class="tile-card__icon"><svg class="icon"><use href="#i-tag"></use></svg></div>
      <div class="tile-card__name">${esc(t.name)}</div>
    </div>
  `).join('');
}

export function openBanquetEventTypeModal(id) {
  const t = id ? state.banquetEventTypes.find(x => x.id === id) : null;
  document.getElementById('banquetEventTypeModal').dataset.editId = id || '';
  document.getElementById('bet_name').value = t?.name || '';
  document.getElementById('banquetEventTypeModal').classList.add('open');
}
export function closeBanquetEventTypeModal() { document.getElementById('banquetEventTypeModal').classList.remove('open'); }

export function saveBanquetEventType() {
  const name = document.getElementById('bet_name').value.trim();
  if (!name) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Ad mütləqdir'); return; }
  const editId = document.getElementById('banquetEventTypeModal').dataset.editId;
  if (editId) R.banquetEventTypes.child(editId).update({ name });
  else R.banquetEventTypes.push({ name, createdAt: Date.now() });
  closeBanquetEventTypeModal();
  showToast('<svg class="icon"><use href="#i-check"></use></svg> Yadda saxlanıldı');
}

export function deleteBanquetEventType(id) {
  confirmDelete2x(1, 'tədbir növü', () => {
    R.banquetEventTypes.child(id).remove();
    showToast('<svg class="icon"><use href="#i-check"></use></svg> Silindi');
  });
}

/* ═══════════════════════════════════════════
   BANKET 2.0 (17.11.2026)
   • Bir qeydiyyat pəncərəsi: müştəri, tədbir, zal, vaxt, qonaqlar, qeydlər (zal və tədbir növü burada seçilir)
   • "Menyunu tərtib et": adi menyudan mallar; qiymət — mallar × miqdar və ya adambaşı qiymət (seçimlə).
     Qiymət həmişə CARİ menyu qiymətidir; banket masaya oturulanda masada sabitləşir.
   • Beh: alınan beh kassa növbəsinə yazılır (payments, kind: 'deposit'); beh geri qaytarılmır.
     Qeydiyyat və menyu anbara/kassaya heç nə yazmır.
   • Tədbir günü "Masaya oturt": seçilmiş masaya və ya "Banket · Ad" adlı yeni masaya menyu yazılır,
     mallar anbardan silinir (mətbəxə çek getmir), beh ödənilmiş kimi çıxılır. Əlavə sifarişlər adi qaydada.
   • Bildiriş: 3 gün və 1 gün qalmış (ciddi), tədbir günü. Müştərinin köhnə banketləri telefonla tapılır.
═══════════════════════════════════════════ */

const I = (n) => `<svg class="icon"><use href="#i-${n}"></use></svg>`;
const p2 = (n) => String(n).padStart(2, '0');
const fmtDT = (t) => { if (!t) return '—'; const d = new Date(t); return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const fmtDay = (ds) => { if (!ds) return '—'; const [y, m, d] = String(ds).split('-'); return `${d}.${m}.${y}`; };
const num = (v) => { const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const isRehber = () => state.user?.role === 'admin';
const canBq = () => isRehber() || hasPermission('panel.banquet');
const me = () => ({ id: state.user?.id || 'admin', name: state.user?.name || 'Rəhbər' });
export function phoneKey(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('994')) return d;
  if (d.startsWith('0')) d = d.slice(1);
  if (d.length === 9) return '994' + d;
  return d;
}

/* Statuslar (köhnə "full" də göstərilir) */
const ST = {
  approval:  { label: 'Təsdiq gözləyir (behsiz)', color: '#e67e22' },
  pending:   { label: 'İlkin rezerv',  color: '#f1c40f' },
  confirmed: { label: 'Təsdiqlənib',   color: '#3498db' },
  seated:    { label: 'Masada (gedir)', color: '#27ae60' },
  done:      { label: 'Bitib',         color: '#2c5f8a' },
  full:      { label: 'Tam dolu',      color: '#e74c3c' },
  cancelled: { label: 'Ləğv edilib',   color: '#7f8c8d' }
};
const ACTIVE = (e) => !['cancelled', 'done'].includes(e.status);
const startTs = (e) => { if (!e?.date) return 0; const [y, m, d] = e.date.split('-').map(Number); const [h, mi] = String(e.startTime || '00:00').split(':').map(Number); return new Date(y, m - 1, d, h || 0, mi || 0).getTime(); };

/* ── Hesablamalar ── */
const guestsOf = (e) => (Number(e.adultsCount) || 0) + (Number(e.childrenCount) || 0);
const curPrice = (l) => { const m = (state.menuItems || []).find(x => x.id === l.menuItemId); return m ? Number(m.price) || 0 : Number(l.price) || 0; };
const effQty = (l, e) => money2((Number(l.qty) || 0) * (l.perGuest ? guestsOf(e) : 1));
export function menuLines(e) { return Object.entries(e.menu || {}).map(([k, l]) => ({ k, ...l })); }
export function computeTotal(e) {
  if (e.priceMode === 'perPerson') {
    const ad = Number(e.adultsCount) || 0, ch = Number(e.childrenCount) || 0;
    const pp = Number(e.perPersonPrice) || 0;
    const cp = e.childPrice === '' || e.childPrice === null || e.childPrice === undefined ? pp : Number(e.childPrice) || 0;
    return money2(pp * ad + cp * ch);
  }
  if (!menuLines(e).length) return money2(Number(e.totalAmount) || 0);   // köhnə qeyd: menyusuz, əl ilə yazılmış məbləğ
  return money2(menuLines(e).reduce((s, l) => s + curPrice(l) * effQty(l, e), 0));
}
export function depositsOf(e) {
  const d = Object.values(e.deposits || {}).reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const legacy = (e.paymentHistory || []).reduce((s, x) => s + (Number(x.amount) || 0), 0);   // köhnə "avans" qeydləri
  return money2(d + legacy);
}
const depositList = (e) => [
  ...(e.paymentHistory || []).map(p => ({ amount: p.amount, at: p.date, methodLabel: { cash: 'Nağd', card: 'Kart', transfer: 'Köçürmə' }[p.method] || p.method, byName: '', note: p.note || 'Avans' })),
  ...Object.values(e.deposits || {})
].sort((a, b) => (a.at || 0) - (b.at || 0));

/* ═══ TƏQVİM ═══ */
export function renderBanquetCalendar() {
  if (!state._banquetCalendarCursor) state._banquetCalendarCursor = dateStr(new Date());
  const cursor = new Date(state._banquetCalendarCursor);
  const year = cursor.getFullYear(), month = cursor.getMonth();
  const today = dateStr(new Date());
  const headerEl = document.getElementById('banquetCalendarHeader');
  if (headerEl) {
    headerEl.innerHTML = `
      <div class="banquet-status-legend">
        ${['approval', 'confirmed', 'seated', 'done', 'cancelled'].map(k => `<span><span class="dot" style="background:${ST[k].color};"></span> ${ST[k].label}</span>`).join('')}
      </div>
      <div style="display:flex;align-items:center;gap:10px;width:100%;justify-content:space-between;">
        <button class="btn btn-ghost" style="padding:8px 14px;" onclick="changeBanquetMonth(-1)" aria-label="Əvvəlki ay">‹</button>
        <span style="font-weight:700;font-size:16px;">${AZ_MONTHS[month]} ${year}</span>
        <button class="btn btn-ghost" style="padding:8px 14px;" onclick="changeBanquetMonth(1)" aria-label="Növbəti ay">›</button>
      </div>`;
  }
  const gridEl = document.getElementById('banquetCalendarGrid');
  if (!gridEl) return;
  const firstOfMonth = new Date(year, month, 1);
  const startOffset = (firstOfMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const cells = [];
  for (let i = startOffset - 1; i >= 0; i--) cells.push({ day: daysInPrevMonth - i, otherMonth: true, d: new Date(year, month - 1, daysInPrevMonth - i) });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, otherMonth: false, d: new Date(year, month, d) });
  while (cells.length % 7 !== 0) { const idx = cells.length - (startOffset + daysInMonth); cells.push({ day: idx + 1, otherMonth: true, d: new Date(year, month + 1, idx + 1) }); }
  gridEl.innerHTML = AZ_WEEKDAYS.map(w => `<div class="banquet-cal-daylabel">${w}</div>`).join('') +
    cells.map(c => {
      const ds = dateStr(c.d);
      const dayEvents = (state.banquetEvents || []).filter(e => e.date === ds);
      const dots = dayEvents.slice(0, 4).map(e => `<span class="banquet-cal-dot" style="background:${ST[e.status]?.color || '#999'};"></span>`).join('');
      const cls = ['banquet-cal-day'];
      if (c.otherMonth) cls.push('banquet-cal-day--other-month');
      if (ds === today) cls.push('banquet-cal-day--today');
      if (ds === state._banquetSelectedDay) cls.push('banquet-cal-day--selected');
      return `<div class="${cls.join(' ')}" onclick="selectBanquetDay('${ds}')"><span class="banquet-cal-day__num">${c.day}</span><div class="banquet-cal-day__dots">${dots}</div></div>`;
    }).join('');
  if (state._banquetSelectedDay) renderBanquetDayEvents();
}
export function changeBanquetMonth(delta) {
  const cursor = new Date(state._banquetCalendarCursor || new Date());
  cursor.setMonth(cursor.getMonth() + delta, 1);
  state._banquetCalendarCursor = dateStr(cursor);
  renderBanquetCalendar();
}
export function selectBanquetDay(ds) { state._banquetSelectedDay = ds; renderBanquetCalendar(); renderBanquetDayEvents(); }
function eventCard(e) {
  const total = computeTotal(e), dep = depositsOf(e);
  return `<div class="banquet-event-card" style="border-left-color:${ST[e.status]?.color || '#999'};cursor:pointer;" onclick="selectBanquetEvent('${e.id}')">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <strong>${esc(e.clientName)}</strong>
      <span style="font-size:12px;font-weight:700;color:${ST[e.status]?.color};">${ST[e.status]?.label || ''}</span>
    </div>
    <div style="font-size:12.5px;color:var(--text2);margin-top:4px;">${fmtDay(e.date)} · ${esc(e.startTime || '')}-${esc(e.endTime || '')} · ${esc(e.eventTypeName || '')}${e.hallName ? ' · ' + esc(e.hallName) : ''} · ${guestsOf(e)} nəfər</div>
    <div style="font-size:12.5px;margin-top:2px;">Cəmi <b>${fmtMoney(total)}</b> · beh <b style="color:var(--green)">${fmtMoney(dep)}</b> · qalıq <b style="color:${total - dep > 0.01 ? 'var(--red)' : 'var(--green)'}">${fmtMoney(Math.max(0, total - dep))}</b></div>
  </div>`;
}
function renderBanquetDayEvents() {
  const el = document.getElementById('banquetDayEventsSection');
  if (!el) return;
  const ds = state._banquetSelectedDay;
  const dayEvents = (state.banquetEvents || []).filter(e => e.date === ds).sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:8px;flex-wrap:wrap;">
      <div style="font-weight:700;font-size:15px;">${fmtDay(ds)} tədbirləri</div>
      ${canBq() ? `<button class="btn btn-green" style="padding:8px 16px;font-size:12.5px;" onclick="openBanquetEventModal(null,'${ds}')">${I('plus')} Yeni banket</button>` : ''}
    </div>
    ${dayEvents.length ? dayEvents.map(eventCard).join('') : '<p style="color:var(--text3);font-size:13px;">Bu tarixdə tədbir yoxdur.</p>'}`;
}

function timeRangesOverlap(s1, e1, s2, e2) { if (!s1 || !e1 || !s2 || !e2) return false; return s1 < e2 && s2 < e1; }

/* ═══ QEYDİYYAT PƏNCƏRƏSİ ═══ */
const LAYOUTS = ['Dairəvi', 'Uzun masa', 'Teatr', 'Kokteyl (ayaqüstü)', 'Qarışıq'];
const SERVICES = ['Tam menyu', 'Bufet', 'Kokteyl', 'Yalnız içki', 'Qarışıq'];
async function pastBanquets(pk, exceptId) {
  if (!pk || pk.length < 10) return [];
  let rows = [];
  try { rows = Object.entries((await R.banquetEvents.orderByChild('phoneKey').equalTo(pk).once('value')).val() || {}).map(([id, v]) => ({ id, ...v })); }
  catch (e) { rows = (state.banquetEvents || []).filter(x => x.phoneKey === pk); }
  return rows.filter(x => x.id !== exceptId).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}
function historyHtml(rows) {
  if (!rows.length) return '<p class="yzi-hint">Bu nömrə ilə əvvəlki banket yoxdur — yeni müştəri.</p>';
  return `<p class="yzi-hint"><b>Bu müştərinin əvvəlki banketləri (${rows.length}):</b></p>` + rows.slice(0, 10).map(x =>
    `<div class="yzi-row" style="font-size:12.5px;"><span>${fmtDay(x.date)} · ${esc(x.eventTypeName || '')} · ${guestsOf(x)} nəfər${x.hallName ? ' · ' + esc(x.hallName) : ''}</span><b style="color:${ST[x.status]?.color || 'inherit'}">${fmtMoney(computeTotal(x))} · ${ST[x.status]?.label || ''}</b></div>`).join('');
}

export function openBanquetEventModal(id, prefilledDate) {
  if (!canBq()) { showToast(`${I('ban')} Banket icazəniz yoxdur`); return; }
  const old = id ? (state.banquetEvents || []).find(x => x.id === id) : null;
  if (old && ['done', 'seated'].includes(old.status) && !isRehber()) { showToast(`${I('warning')} Masaya oturulmuş banketin qeydiyyatı dəyişdirilmir`); return; }
  const d = old ? JSON.parse(JSON.stringify(old)) : { date: prefilledDate || dateStr(new Date()), status: 'pending', priceMode: 'items', menu: {}, tableLayout: 'Dairəvi', serviceType: 'Tam menyu' };
  const typeNames = [...new Set([...DEFAULT_EVENT_TYPES, ...(state.banquetEventTypes || []).map(t => t.name).filter(n => n && n !== 'Digər')])];
  const typeIsOther = !!d.eventTypeName && !typeNames.includes(d.eventTypeName);
  const methods = [['cash', 'Nağd'], ['pos', 'POS / Kart'], ...(state.paymentMethods || []).map(pm => [pm.id, pm.name])];
  const halls = state.banquetHalls || [];
  const v = (x) => esc(x === undefined || x === null ? '' : String(x));
  const m = yzModal({
    title: `${I('calendar')} ${old ? 'Banketi redaktə et' : 'Yeni banket qeydiyyatı'}`, wide: true,
    body: `
      <h3 class="yzi-h3">Müştəri</h3>
      <div class="yzi-grid3">
        <label class="yzi-f"><span>Telefon *</span><input type="tel" id="bqPhone" value="${v(d.phone)}" placeholder="050 555 41 12" autocomplete="off"></label>
        <label class="yzi-f"><span>Ad, soyad *</span><input type="text" id="bqName" value="${v(d.clientName)}" maxlength="80"></label>
        <label class="yzi-f"><span>WhatsApp</span><input type="tel" id="bqWa" value="${v(d.whatsapp)}" placeholder="eyni nömrədirsə boş qoyun"></label>
      </div>
      <div id="bqHist"></div>
      <h3 class="yzi-h3">Tədbir</h3>
      <div class="yzi-grid3">
        <label class="yzi-f"><span>Tədbirin növü *</span><select id="bqTypeSel"><option value="">— seçin —</option>${typeNames.map(t => `<option${t === d.eventTypeName ? ' selected' : ''}>${esc(t)}</option>`).join('')}<option value="__other"${typeIsOther ? ' selected' : ''}>Digər…</option></select>
          <input type="text" id="bqTypeOther" maxlength="60" placeholder="Tədbirin növünü yazın" value="${typeIsOther ? v(d.eventTypeName) : ''}" style="margin-top:6px;${typeIsOther ? '' : 'display:none;'}"></label>
        <label class="yzi-f"><span>Zal *</span><span style="display:flex;gap:6px;"><select id="bqHall" style="flex:1"><option value="">— zal seçin —</option>${halls.map(h => `<option value="${esc(h.id)}"${h.id === d.hallId ? ' selected' : ''}>${esc(h.name)}${h.capacity ? ` (${h.capacity} nəfər)` : ''}</option>`).join('')}</select>
          <button type="button" class="yzi-btn yzi-btn--ghost yzi-btn--sm" id="bqHallAdd" title="Yeni zal əlavə et" aria-label="Yeni zal əlavə et">${I('plus')}</button></span></label>
        <div class="yzi-f"><span>Status</span><b style="padding:10px 0;color:${ST[d.status]?.color || 'inherit'}">${old ? (ST[d.status]?.label || d.status) : 'Beh alınanda təsdiqlənir'}</b></div>
        <label class="yzi-f"><span>Tarix *</span><input type="date" id="bqDate" value="${v(d.date)}"></label>
        <label class="yzi-f"><span>Başlama saatı *</span><input type="time" id="bqStart" value="${v(d.startTime)}"></label>
        <label class="yzi-f"><span>Bitmə saatı *</span><input type="time" id="bqEnd" value="${v(d.endTime)}"></label>
      </div>
      <p id="bqConflict" class="yzi-bad" style="min-height:16px;font-size:12.5px;font-weight:600;margin:0 0 6px;"></p>
      <p id="bqGap" class="yzi-warn" style="min-height:0;font-size:12.5px;font-weight:600;margin:0 0 6px;"></p>
      <h3 class="yzi-h3">Qonaqlar və düzülüş</h3>
      <div class="yzi-grid3">
        <label class="yzi-f"><span>Böyük *</span>${numInput('id="bqAd"', d.adultsCount)}</label>
        <label class="yzi-f"><span>Uşaq</span>${numInput('id="bqCh"', d.childrenCount)}</label>
        <label class="yzi-f"><span>VIP (daxilində)</span>${numInput('id="bqVip"', d.vipCount)}</label>
        <label class="yzi-f"><span>Masa sayı</span>${numInput('id="bqTables"', d.tableCount)}</label>
        <label class="yzi-f"><span>Masa düzülüşü</span><select id="bqLayout">${LAYOUTS.map(x => `<option${x === d.tableLayout ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
        <label class="yzi-f"><span>Xidmət növü</span><select id="bqService">${SERVICES.map(x => `<option${x === d.serviceType ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
      </div>
      <h3 class="yzi-h3">Qeydlər</h3>
      <div class="yzi-grid2">
        <label class="yzi-f"><span>Xüsusi istəklər (allergiya, vegetarian, uşaq menyusu)</span><textarea id="bqWish" rows="2" maxlength="500">${v(d.wishes)}</textarea></label>
        <label class="yzi-f"><span>Dekor, musiqi, aparıcı, tort, foto</span><textarea id="bqExtra" rows="2" maxlength="500">${v(d.extras)}</textarea></label>
      </div>
      <label class="yzi-f"><span>Ümumi qeyd</span><textarea id="bqNotes" rows="2" maxlength="1000">${v(d.notes)}</textarea></label>
      <h3 class="yzi-h3">Menyu və məbləğ</h3>
      <div id="bqMenuSum"></div>
      <button type="button" class="yzi-btn yzi-btn--ghost" id="bqMenuBtn">${I('food')} Menyunu tərtib et</button>
      ${old ? '<p class="yzi-hint">Qeydiyyat və menyu anbara və kassaya heç nə yazmır. Əlavə beh "Beh al" düyməsi ilə alınır.</p>' : `
      <h3 class="yzi-h3">${I('cash')} Beh</h3>
      <div class="yzi-grid3">
        <label class="yzi-f"><span>Beh məbləği (₼)</span>${numInput('id="bqDepA" class="yzi-big"', '')}</label>
        <label class="yzi-f"><span>Ödəniş üsulu</span><select id="bqDepM">${methods.map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join('')}</select></label>
        <label class="yzi-f"><span>Qeyd</span><input type="text" id="bqDepN" maxlength="200"></label>
      </div>
      <p class="yzi-hint">Beh bu günün kassa növbəsinə yazılır və <b>geri qaytarılmır</b>. Tədbir bitəndə ümumi məbləğdən çıxılır. Menyu və qeydiyyat anbara və kassaya heç nə yazmır.
        ${isRehber() ? 'Behsiz qeydiyyat sizin (Rəhbər) adınıza təsdiqlənir.' : '<b>Behsiz qeydiyyat Rəhbərin təsdiqinə göndərilir.</b>'}</p>`}`,
    actions: [
      { label: 'Ləğv', cancel: true, cls: 'yzi-btn--ghost' },
      { label: old ? 'Yadda saxla' : 'Qeydiyyatı tamamla', cls: 'yzi-btn--gold', onClick: async (b) => { const r = await saveForm(b, d, old, methods); if (r === false) return false; } }
    ]
  });
  const b = m.body;
  const collectGuests = () => { d.adultsCount = Math.max(0, Math.round(num(b.querySelector('#bqAd').value))); d.childrenCount = Math.max(0, Math.round(num(b.querySelector('#bqCh').value))); };
  const paintSum = () => {
    collectGuests();
    const lines = menuLines(d);
    const total = computeTotal(d);
    b.querySelector('#bqMenuSum').innerHTML = `
      <div class="yzi-row"><span>Hesablama</span><b>${d.priceMode === 'perPerson' ? `Adambaşı: ${fmtMoney(d.perPersonPrice)} × ${d.adultsCount || 0} böyük${d.childrenCount ? ` + ${fmtMoney(d.childPrice ?? d.perPersonPrice)} × ${d.childrenCount} uşaq` : ''}` : 'Mallar × miqdar'}</b></div>
      <div class="yzi-row"><span>Menyuda</span><b>${lines.length ? `${lines.length} mal` : 'hələ mal seçilməyib'}</b></div>
      <div class="yzi-row"><span>Ümumi məbləğ</span><b class="yzi-gold">${fmtMoney(total)}</b></div>
      ${old ? `<div class="yzi-row"><span>Alınmış beh</span><b style="color:var(--green)">${fmtMoney(depositsOf(old))}</b></div><div class="yzi-row"><span>Qalıq</span><b>${fmtMoney(Math.max(0, total - depositsOf(old)))}</b></div>` : ''}`;
  };
  const checkConflict = () => {
    const hallId = b.querySelector('#bqHall').value, date = b.querySelector('#bqDate').value, s = b.querySelector('#bqStart').value, e = b.querySelector('#bqEnd').value;
    const c = hallId && date && s && e ? (state.banquetEvents || []).find(x => x.id !== old?.id && x.hallId === hallId && x.date === date && ACTIVE(x) && timeRangesOverlap(s, e, x.startTime, x.endTime)) : null;
    b.querySelector('#bqConflict').textContent = c ? `⚠ Bu zal həmin vaxt "${c.clientName}" banketi üçün artıq rezervdir (${c.startTime}-${c.endTime})` : '';
    const g = !c && hallId && date && s && e ? gapIssue(old?.id, hallId, date, s, e) : null;
    b.querySelector('#bqGap').textContent = g ? `Diqqət: eyni zalda "${g.x.clientName}" banketi (${g.x.startTime}-${g.x.endTime}) ilə aralıq cəmi ${g.gap} dəqiqədir (tövsiyə: ən azı ${minGap} dəq).` : '';
  };
  b.querySelector('#bqTypeSel').addEventListener('change', (ev) => { const o = b.querySelector('#bqTypeOther'); o.style.display = ev.target.value === '__other' ? '' : 'none'; if (ev.target.value === '__other') o.focus(); });
  let hTimer = null;
  const loadHist = async () => {
    const pk = phoneKey(b.querySelector('#bqPhone').value);
    const rows = await pastBanquets(pk, old?.id);
    if (!b.isConnected) return;
    b.querySelector('#bqHist').innerHTML = pk.length >= 10 ? historyHtml(rows) : '';
    const nm = b.querySelector('#bqName');
    if (!nm.value.trim() && rows[0]?.clientName) nm.value = rows[0].clientName;
  };
  b.querySelector('#bqPhone').addEventListener('input', () => { clearTimeout(hTimer); hTimer = setTimeout(loadHist, 400); });
  ['#bqHall', '#bqDate', '#bqStart', '#bqEnd'].forEach(s => b.querySelector(s).addEventListener('change', checkConflict));
  ['#bqAd', '#bqCh'].forEach(s => b.querySelector(s).addEventListener('input', paintSum));
  b.querySelector('#bqMenuBtn').addEventListener('click', () => { collectGuests(); openMenuEditor(d, () => paintSum()); });
  b.querySelector('#bqHallAdd').addEventListener('click', async () => {
    const name = await confirmBox('Zalın adını yazın (məs. Böyük zal).', { title: 'Yeni zal', okLabel: 'Əlavə et', input: 'Zalın adı' });
    if (!name || !String(name).trim()) return;
    const ref = R.banquetHalls.push();
    await ref.set({ name: String(name).trim(), capacity: 0, price: 0, notes: '', createdAt: serverNow() });
    const sel = b.querySelector('#bqHall');
    sel.insertAdjacentHTML('beforeend', `<option value="${esc(ref.key)}">${esc(String(name).trim())}</option>`);
    sel.value = ref.key; checkConflict();
  });
  paintSum(); checkConflict();
  loadMinGap().then(() => { if (b.isConnected) checkConflict(); });
  if (d.phone) loadHist();
}

/* Eyni zalda iki tədbir arasındakı minimum aralıq (dəqiqə) — Rəhbər dəyişir (settings/banquet/minGapMin) */
let minGap = 60;
async function loadMinGap() { try { const v = (await db.ref('settings/banquet/minGapMin').once('value')).val(); if (Number.isFinite(Number(v)) && v !== null) minGap = Number(v); } catch (er) { /* */ } }
const toMin = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
function gapIssue(exceptId, hallId, date, s, e) {
  let worst = null;
  (state.banquetEvents || []).forEach(x => {
    if (x.id === exceptId || x.hallId !== hallId || x.date !== date || !ACTIVE(x) || !x.startTime || !x.endTime) return;
    if (timeRangesOverlap(s, e, x.startTime, x.endTime)) return;
    const gap = toMin(s) >= toMin(x.endTime) ? toMin(s) - toMin(x.endTime) : toMin(x.startTime) - toMin(e);
    if (gap < minGap && (!worst || gap < worst.gap)) worst = { x, gap };
  });
  return worst;
}
export async function openBanquetSettings() {
  if (!isRehber()) { showToast(`${I('ban')} Banket ayarlarını yalnız Rəhbər dəyişir`); return; }
  await loadMinGap();
  yzModal({
    title: `${I('settings')} Banket ayarları`,
    body: `<label class="yzi-f"><span>Eyni zalda iki tədbir arasında minimum aralıq (dəqiqə)</span>${numInput('id="bqGapIn"', minGap)}</label>
      <p class="yzi-hint">Aralıq bundan qısa olanda qeydiyyatda xəbərdarlıq çıxır (məs. 13:00–17:00 və 18:00–22:00 arasında 60 dəqiqə var). Saatlar üst-üstə düşəndə isə qeydiyyat qəbul edilmir.</p>`,
    actions: [{ label: 'Ləğv', cancel: true, cls: 'yzi-btn--ghost' }, { label: 'Yadda saxla', cls: 'yzi-btn--gold', onClick: async (b) => {
      const v = Math.max(0, Math.round(num(b.querySelector('#bqGapIn').value)));
      await db.ref('settings/banquet/minGapMin').set(v); minGap = v;
      addLog('settings', `Banket: zalda tədbirlər arası minimum aralıq ${v} dəqiqə edildi`, {});
      showToast(`${I('check')} Yadda saxlanıldı`);
    } }]
  });
}

async function saveForm(b, d, old, methods = []) {
  const g = (s) => b.querySelector(s);
  const phone = g('#bqPhone').value.trim(), clientName = g('#bqName').value.trim();
  const tsel = g('#bqTypeSel').value;
  const eventTypeName = tsel === '__other' ? g('#bqTypeOther').value.trim() : tsel;
  const hallId = g('#bqHall').value, date = g('#bqDate').value, startTime = g('#bqStart').value, endTime = g('#bqEnd').value;
  const adults = Math.max(0, Math.round(num(g('#bqAd').value))), children = Math.max(0, Math.round(num(g('#bqCh').value)));
  if (phoneKey(phone).length < 10) throw new Error('Telefon nömrəsini düzgün yazın');
  if (!clientName) throw new Error('Müştərinin adını yazın');
  if (!eventTypeName) throw new Error('Tədbirin növünü seçin');
  if (!hallId) throw new Error('Zalı seçin');
  if (!date || !startTime || !endTime) throw new Error('Tarix, başlama və bitmə saatı mütləqdir');
  if (startTime >= endTime) throw new Error('Bitmə saatı başlama saatından sonra olmalıdır');
  if (!adults) throw new Error('Böyük qonaq sayını yazın');
  const gap = gapIssue(old?.id, hallId, date, startTime, endTime);
  if (gap && !(await confirmBox(`Eyni zalda <b>${esc(gap.x.clientName)}</b> banketi (${esc(gap.x.startTime)}-${esc(gap.x.endTime)}) ilə aralıq cəmi <b>${gap.gap} dəqiqədir</b> (tövsiyə: ən azı ${minGap} dəq). Yenə də yazılsın?`, { title: 'Qısa aralıq', okLabel: 'Bəli, yaz' }))) return false;
  // Beh (yalnız yeni qeydiyyatda formada)
  const depAmount = old ? 0 : money2(num(g('#bqDepA')?.value));
  const depMethod = g('#bqDepM')?.value || 'cash';
  const depLabel = methods.find(([k]) => k === depMethod)?.[1] || depMethod;
  const depNote = g('#bqDepN')?.value.trim() || '';
  let shift = null;
  if (!old && depAmount > 0) { shift = needShift(); if (!shift) throw new Error('Beh kassaya düşür — əvvəlcə kassa növbəsini açın'); }
  if (!old && !(depAmount > 0) && isRehber() && !(await confirmBox('Beh alınmadan qeydiyyat edilsin? Sizin (Rəhbər) adınıza təsdiqlənəcək.', { title: 'Behsiz qeydiyyat', okLabel: 'Bəli, təsdiqlə' }))) return false;
  const u = me(), now = serverNow();
  const rec = {
    clientName, phone, phoneKey: phoneKey(phone), whatsapp: g('#bqWa').value.trim(),
    eventTypeName, hallId, hallName: (state.banquetHalls || []).find(h => h.id === hallId)?.name || '',
    date, startTime, endTime,
    adultsCount: adults, childrenCount: children, vipCount: Math.max(0, Math.round(num(g('#bqVip').value))), tableCount: Math.max(0, Math.round(num(g('#bqTables').value))),
    tableLayout: g('#bqLayout').value, serviceType: g('#bqService').value,
    wishes: g('#bqWish').value.trim(), extras: g('#bqExtra').value.trim(), notes: g('#bqNotes').value.trim(),
    priceMode: d.priceMode || 'items', perPersonPrice: d.perPersonPrice ?? null, childPrice: d.childPrice ?? null,
    menu: d.menu && Object.keys(d.menu).length ? d.menu : null,
    updatedAt: now, updatedByName: u.name
  };
  rec.totalAmount = computeTotal({ ...rec });
  const id = old?.id || R.banquetEvents.push().key;
  // Zal + vaxt: iki nəfər eyni zalı eyni vaxta yaza bilməz (transaction)
  const tx = await db.ref(`banquetHallBookings/${hallId}/${date}`).transaction(cur => {
    const bk = cur || {};
    for (const [eid, slot] of Object.entries(bk)) { if (eid !== id && timeRangesOverlap(startTime, endTime, slot.start, slot.end)) return; }
    return { ...bk, [id]: { start: startTime, end: endTime, clientName } };
  });
  if (!tx.committed) throw new Error('Bu zal həmin vaxt aralığında artıq rezervdir. Başqa vaxt və ya zal seçin.');
  const releaseNew = () => db.ref(`banquetHallBookings/${hallId}/${date}/${id}`).remove().catch(() => {});
  if (old) {
    if (old.hallId && (old.hallId !== hallId || old.date !== date)) db.ref(`banquetHallBookings/${old.hallId}/${old.date}/${id}`).remove().catch(() => {});
    await R.banquetEvents.child(id).update(rec);
    await R.banquetEvents.child(id).child('history').push({ at: now, byName: u.name, text: 'Qeydiyyat dəyişdirildi' });
    addLog('banquet', `${u.name} "${clientName}" banketini redaktə etdi (${fmtDay(date)} ${startTime})`, { banquetId: id });
    showToast(`${I('check')} Banket yadda saxlanıldı`);
    return id;
  }
  // Yeni qeydiyyat: banket + beh + kassa ödənişi BİR yazı ilə
  const status = depAmount > 0 ? 'confirmed' : (isRehber() ? 'confirmed' : 'approval');
  const upd = {};
  const hist = { h0: { at: now, byName: u.name, text: `Qeydiyyat: ${eventTypeName}, ${fmtDay(date)} ${startTime}-${endTime}, ${adults + children} nəfər` } };
  const full = { ...rec, status, createdAt: now, createdById: u.id, createdByName: u.name, staffName: u.name };
  if (depAmount > 0) {
    const payId = R.payments.push().key, depId = R.banquetEvents.push().key;
    upd['payments/' + payId] = {
      kind: 'deposit', banquetId: id, tableId: 'bq_' + id, tableName: `Banket behi · ${clientName}`, sessionId: null,
      staffId: u.id, staffName: u.name, type: depMethod, typeLabel: `Banket behi · ${depLabel}`,
      originalAmount: depAmount, finalAmount: depAmount, thisPay: depAmount, paidBefore: 0,
      discountType: null, discountValue: 0, shiftId: shift.id,
      createdAt: now, time: new Date(now).toLocaleTimeString('az-AZ'), date: new Date(now).toLocaleDateString('az-AZ')
    };
    full.deposits = { [depId]: { amount: depAmount, method: depMethod, methodLabel: depLabel, note: depNote || null, at: now, byId: u.id, byName: u.name, paymentId: payId, shiftId: shift.id } };
    hist.h1 = { at: now, byName: u.name, text: `Beh alındı: ${fmtMoney(depAmount)} (${depLabel})${depNote ? ' · ' + depNote : ''}` };
  } else if (isRehber()) {
    full.approvedAt = now; full.approvedByName = u.name;
    hist.h1 = { at: now, byName: u.name, text: 'Behsiz qeydiyyat — Rəhbər təsdiqlədi' };
  } else {
    hist.h1 = { at: now, byName: u.name, text: 'Beh alınmayıb — Rəhbərin təsdiqinə göndərildi' };
  }
  full.history = hist;
  upd['banquetEvents/' + id] = full;
  try { await db.ref().update(upd); }
  catch (er) { await releaseNew(); throw new Error('Qeydiyyat yazılmadı (bağlantı və ya icazə xətası). Heç nə dəyişməyib.'); }
  addLog('banquet', `${u.name} yeni banket qeydiyyatı etdi: ${clientName} · ${eventTypeName} · ${fmtDay(date)} ${startTime} · ${adults + children} nəfər${depAmount > 0 ? ` · beh ${fmtMoney(depAmount)} (${depLabel})` : status === 'approval' ? ' · behsiz, Rəhbər təsdiqi gözləyir' : ' · behsiz (Rəhbər)'}`, { banquetId: id });
  if (depAmount > 0) addLog('payment', `${u.name} "${clientName}" banketi üçün ${fmtMoney(depAmount)} beh aldı (${depLabel})`, { banquetId: id, shiftId: shift.id });
  showToast(status === 'approval' ? `${I('warning')} Qeydiyyat Rəhbərin təsdiqinə göndərildi` : `${I('check')} Banket qeydiyyatı tamamlandı`);
  return id;
}

/* Rəhbər: behsiz qeydiyyatı təsdiqlə / rədd et */
async function approveBanquet(e) {
  if (!isRehber()) return;
  if (!(await confirmBox(`<b>${esc(e.clientName)}</b> (${fmtDay(e.date)}) behsiz qeydiyyatı təsdiqlənsin?`, { title: 'Təsdiq', okLabel: 'Təsdiqlə' }))) return;
  const u = me(), now = serverNow();
  await db.ref().update({
    [`banquetEvents/${e.id}/approvedAt`]: now, [`banquetEvents/${e.id}/approvedByName`]: u.name, [`banquetEvents/${e.id}/status`]: 'confirmed',
    [`banquetEvents/${e.id}/history/${R.banquetEvents.push().key}`]: { at: now, byName: u.name, text: 'Behsiz qeydiyyat Rəhbər tərəfindən təsdiqləndi' }
  });
  addLog('banquet', `Rəhbər "${e.clientName}" banketinin behsiz qeydiyyatını təsdiqlədi`, { banquetId: e.id });
  showToast(`${I('check')} Təsdiqləndi`);
}


/* ═══ MENYU TƏRTİBİ ═══ */
function openMenuEditor(d, onDone, { saveTo = null } = {}) {
  const draft = { priceMode: d.priceMode || 'items', perPersonPrice: d.perPersonPrice ?? '', childPrice: d.childPrice ?? '', menu: JSON.parse(JSON.stringify(d.menu || {})) };
  const guestsCtx = () => ({ adultsCount: d.adultsCount, childrenCount: d.childrenCount });
  let cat = 'all', q = '';
  const body = document.createElement('div');
  const menuOk = (mi) => mi && mi.available !== false && mi.pricingMode !== 'hourly';
  const draw = () => {
    const items = (state.menuItems || []).filter(menuOk);
    const cats = ['all', ...new Set(items.map(x => x.category || 'Digər'))];
    const ql = q.trim().toLowerCase();
    const shown = items.filter(x => ql ? String(x.name).toLowerCase().includes(ql) : cat === 'all' || (x.category || 'Digər') === cat);
    const ctx = { ...draft, ...guestsCtx() };
    const lines = menuLines(ctx);
    const itemsSum = money2(lines.reduce((s, l) => s + curPrice(l) * effQty(l, ctx), 0));
    const total = computeTotal(ctx);
    body.innerHTML = `
      <div class="yzi-seg" role="radiogroup" aria-label="Qiymət necə hesablansın" style="margin-bottom:8px;">
        <button type="button" data-mode="items" class="${draft.priceMode !== 'perPerson' ? 'is-on' : ''}">Mallar × miqdar</button>
        <button type="button" data-mode="perPerson" class="${draft.priceMode === 'perPerson' ? 'is-on' : ''}">Adambaşı qiymət</button>
      </div>
      ${draft.priceMode === 'perPerson' ? `<div class="yzi-grid3">
        <label class="yzi-f"><span>Adambaşı qiymət — böyük (₼)</span>${numInput('id="bqPP"', draft.perPersonPrice)}</label>
        <label class="yzi-f"><span>Adambaşı qiymət — uşaq (₼, boş = eyni)</span>${numInput('id="bqCP"', draft.childPrice)}</label>
        <div class="yzi-f"><span>Qonaq</span><b>${d.adultsCount || 0} böyük · ${d.childrenCount || 0} uşaq</b></div></div>
        <p class="yzi-hint">Mallar bu rejimdə yalnız mətbəx hazırlığı və anbar üçündür; məbləğ adambaşı qiymətdən hesablanır.</p>` : ''}
      <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:12px;">
        <section>
          <input type="search" id="bqMQ" class="yzi-big" placeholder="Menyuda axtar…" value="${esc(q)}" aria-label="Menyuda axtar">
          <div class="yzi-pills" style="margin:6px 0;">${cats.map(c => `<button type="button" data-cat="${esc(c)}" class="${cat === c ? 'is-on' : ''}">${c === 'all' ? 'Hamısı' : esc(c)}</button>`).join('')}</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:6px;max-height:46vh;overflow:auto;">
            ${shown.map(x => `<button type="button" class="yzi-btn yzi-btn--ghost" data-add="${esc(x.id)}" style="flex-direction:column;align-items:flex-start;min-height:54px;text-align:left;"><b style="font-size:12.5px;">${esc(x.name)}</b><small>${fmtMoney(x.price)}</small></button>`).join('') || '<p class="yzi-empty">Mal tapılmadı</p>'}
          </div>
        </section>
        <section>
          <div class="yzi-table-wrap" style="max-height:46vh;overflow:auto;"><table class="yzi-table yzi-table--mini">
            <thead><tr><th>Mal</th><th class="n">Miqdar</th><th>Adambaşı</th><th class="n">Cəmi say</th><th class="n">Məbləğ</th><th></th></tr></thead>
            <tbody>${lines.map(l => `<tr><td><b>${esc(l.name)}</b><br><small class="mut">${fmtMoney(curPrice(l))}</small></td>
              <td class="n">${numInput(`data-q="${esc(l.k)}" class="yzi-n" style="width:70px" aria-label="${esc(l.name)} miqdarı"`, l.qty)}</td>
              <td><label style="display:flex;gap:4px;align-items:center;font-size:12px;"><input type="checkbox" data-pg="${esc(l.k)}" ${l.perGuest ? 'checked' : ''}> hər qonağa</label></td>
              <td class="n">${effQty(l, ctx)}</td><td class="n">${fmtMoney(curPrice(l) * effQty(l, ctx))}</td>
              <td><button type="button" class="yzi-x" data-del="${esc(l.k)}" aria-label="${esc(l.name)} sil">✕</button></td></tr>`).join('') || '<tr><td colspan="6" class="yzi-empty">Soldan mal seçin</td></tr>'}</tbody>
          </table></div>
          <div class="yzi-row"><span>Malların cəmi</span><b>${fmtMoney(itemsSum)}</b></div>
          <div class="yzi-row"><span><b>Banketin məbləği</b></span><b class="yzi-gold">${fmtMoney(total)}</b></div>
          <p class="yzi-hint">"Hər qonağa" işarələnəndə miqdar qonaq sayına vurulur (məs. 1 × ${guestsOf(ctx)} nəfər). Qiymət cari menyu qiymətidir.</p>
        </section>
      </div>`;
    body.querySelector('#bqMQ').addEventListener('input', (e) => { q = e.target.value; const p = e.target.selectionStart; draw(); const i = body.querySelector('#bqMQ'); i.focus(); i.setSelectionRange(p, p); });
    body.querySelectorAll('[data-mode]').forEach(x => x.addEventListener('click', () => { collect(); draft.priceMode = x.dataset.mode; draw(); }));
    body.querySelectorAll('[data-cat]').forEach(x => x.addEventListener('click', () => { collect(); cat = x.dataset.cat; draw(); }));
    body.querySelectorAll('[data-add]').forEach(x => x.addEventListener('click', () => {
      collect();
      const mi = (state.menuItems || []).find(y => y.id === x.dataset.add); if (!mi) return;
      const k = 'm_' + mi.id;
      if (draft.menu[k]) draft.menu[k].qty = money2((Number(draft.menu[k].qty) || 0) + 1);
      else draft.menu[k] = { menuItemId: mi.id, name: mi.name, price: Number(mi.price) || 0, qty: 1, perGuest: false };
      draw();
    }));
    body.querySelectorAll('[data-del]').forEach(x => x.addEventListener('click', () => { collect(); delete draft.menu[x.dataset.del]; draw(); }));
    body.querySelectorAll('[data-q],[data-pg],#bqPP,#bqCP').forEach(x => x.addEventListener('change', () => { collect(); draw(); }));
  };
  const collect = () => {
    body.querySelectorAll('[data-q]').forEach(i => { const l = draft.menu[i.dataset.q]; if (l) l.qty = Math.max(0, money2(num(i.value))); });
    body.querySelectorAll('[data-pg]').forEach(i => { const l = draft.menu[i.dataset.pg]; if (l) l.perGuest = i.checked; });
    const pp = body.querySelector('#bqPP'), cp = body.querySelector('#bqCP');
    if (pp) draft.perPersonPrice = pp.value.trim() === '' ? '' : money2(num(pp.value));
    if (cp) draft.childPrice = cp.value.trim() === '' ? '' : money2(num(cp.value));
  };
  draw();
  yzModal({
    title: `${I('food')} Banket menyusu`, wide: true, body,
    actions: [
      { label: 'Ləğv', cancel: true, cls: 'yzi-btn--ghost' },
      { label: 'Təsdiqlə', cls: 'yzi-btn--gold', onClick: async () => {
        collect();
        Object.keys(draft.menu).forEach(k => { if (!(Number(draft.menu[k].qty) > 0)) delete draft.menu[k]; });
        if (draft.priceMode === 'perPerson' && !(Number(draft.perPersonPrice) > 0)) throw new Error('Adambaşı qiyməti yazın');
        d.priceMode = draft.priceMode;
        d.perPersonPrice = draft.priceMode === 'perPerson' ? Number(draft.perPersonPrice) : null;
        d.childPrice = draft.priceMode === 'perPerson' && draft.childPrice !== '' ? Number(draft.childPrice) : null;
        d.menu = draft.menu;
        if (saveTo) {
          const u = me();
          const upd = { priceMode: d.priceMode, perPersonPrice: d.perPersonPrice, childPrice: d.childPrice, menu: Object.keys(d.menu).length ? d.menu : null, updatedAt: serverNow(), updatedByName: u.name };
          upd.totalAmount = computeTotal({ ...saveTo, ...upd });
          await R.banquetEvents.child(saveTo.id).update(upd);
          await R.banquetEvents.child(saveTo.id).child('history').push({ at: serverNow(), byName: u.name, text: `Menyu dəyişdirildi · məbləğ ${fmtMoney(upd.totalAmount)}` });
          addLog('banquet', `${u.name} "${saveTo.clientName}" banketinin menyusunu dəyişdi (${fmtMoney(upd.totalAmount)})`, { banquetId: saveTo.id });
          showToast(`${I('check')} Menyu yadda saxlanıldı`);
        }
        onDone && onDone();
      } }
    ]
  });
}

/* ═══ BEH ═══ */
export function openDeposit(e) {
  if (!canBq()) { showToast(`${I('ban')} Banket icazəniz yoxdur`); return; }
  if (!ACTIVE(e) || e.status === 'seated') { showToast(`${I('warning')} Bu banket üçün beh alınmır (${ST[e.status]?.label || e.status})`); return; }
  const shift = needShift();   // beh kassaya düşür — açıq növbə lazımdır
  if (!shift) return;
  const total = computeTotal(e), dep = depositsOf(e);
  const methods = [['cash', 'Nağd'], ['pos', 'POS / Kart'], ...(state.paymentMethods || []).map(pm => [pm.id, pm.name])];
  yzModal({
    title: `${I('cash')} Beh al · ${esc(e.clientName)}`,
    body: `
      <div class="yzi-row"><span>Banketin məbləği</span><b>${fmtMoney(total)}</b></div>
      <div class="yzi-row"><span>Əvvəl alınmış beh</span><b>${fmtMoney(dep)}</b></div>
      <div class="yzi-row"><span>Qalıq</span><b>${fmtMoney(Math.max(0, total - dep))}</b></div>
      <div class="yzi-grid2" style="margin-top:8px;">
        <label class="yzi-f"><span>Beh məbləği (₼) *</span>${numInput('id="bqDepA" class="yzi-big"', '')}</label>
        <label class="yzi-f"><span>Ödəniş üsulu</span><select id="bqDepM">${methods.map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join('')}</select></label>
      </div>
      <label class="yzi-f"><span>Qeyd</span><input type="text" id="bqDepN" maxlength="200"></label>
      <p class="yzi-hint">Beh kassa növbəsinə (№${esc(String(shift.no ?? ''))}) yazılır və <b>geri qaytarılmır</b>. Tədbir bitəndə ümumi məbləğdən çıxılır.</p>`,
    actions: [
      { label: 'Ləğv', cancel: true, cls: 'yzi-btn--ghost' },
      { label: 'Behi qəbul et', cls: 'yzi-btn--gold', onClick: async (b) => {
        const amount = money2(num(b.querySelector('#bqDepA').value));
        if (!(amount > 0)) throw new Error('Məbləği yazın');
        const sh = needShift(); if (!sh) throw new Error('Kassa növbəsi açıq deyil');
        const method = b.querySelector('#bqDepM').value;
        const methodLabel = methods.find(([k]) => k === method)?.[1] || method;
        const note = b.querySelector('#bqDepN').value.trim();
        const u = me(), now = serverNow();
        const payId = R.payments.push().key;
        const depId = R.banquetEvents.child(e.id).child('deposits').push().key;
        const upd = {
          ['payments/' + payId]: {
            kind: 'deposit', banquetId: e.id, tableId: 'bq_' + e.id, tableName: `Banket behi · ${e.clientName}`, sessionId: null,
            staffId: u.id, staffName: u.name, type: method, typeLabel: `Banket behi · ${methodLabel}`,
            originalAmount: amount, finalAmount: amount, thisPay: amount, paidBefore: dep,
            discountType: null, discountValue: 0, shiftId: sh.id,
            createdAt: now, time: new Date(now).toLocaleTimeString('az-AZ'), date: new Date(now).toLocaleDateString('az-AZ')
          },
          [`banquetEvents/${e.id}/deposits/${depId}`]: { amount, method, methodLabel, note: note || null, at: now, byId: u.id, byName: u.name, paymentId: payId, shiftId: sh.id },
          [`banquetEvents/${e.id}/history/${R.banquetEvents.push().key}`]: { at: now, byName: u.name, text: `Beh alındı: ${fmtMoney(amount)} (${methodLabel})${note ? ' · ' + note : ''}` }
        };
        if (e.status === 'pending' || e.status === 'approval') upd[`banquetEvents/${e.id}/status`] = 'confirmed';   // beh alınıbsa — təsdiqlənmiş sayılır
        try { await db.ref().update(upd); } catch (er) { throw new Error('Beh yazılmadı (bağlantı və ya icazə xətası). Heç nə dəyişməyib.'); }
        addLog('payment', `${u.name} "${e.clientName}" banketi üçün ${fmtMoney(amount)} beh aldı (${methodLabel})`, { banquetId: e.id, paymentId: payId, shiftId: sh.id });
        showToast(`${I('check')} ${fmtMoney(amount)} beh qəbul edildi`);
      } }
    ]
  });
}

/* ═══ MASAYA OTURTMA (tədbir günü) ═══ */
function buildTableItems(e) {
  const items = {};
  menuLines(e).forEach(l => {
    const q = effQty(l, e); if (!(q > 0)) return;
    const mi = (state.menuItems || []).find(x => x.id === l.menuItemId);
    const price = e.priceMode === 'perPerson' ? 0 : curPrice(l);
    const k = makeLineKey(l.menuItemId, 'Banket', 0);
    items[k] = { menuItemId: l.menuItemId, name: l.name, price, qty: q, note: 'Banket', extraFee: 0, vatRate: Number(mi?.vatRate) || 0, vatIncluded: state.vatMode !== 'added', banquet: true, ...(e.priceMode === 'perPerson' ? { listPrice: curPrice(l) } : {}) };
  });
  if (e.priceMode === 'perPerson') {
    const ad = Number(e.adultsCount) || 0, ch = Number(e.childrenCount) || 0;
    const pp = Number(e.perPersonPrice) || 0, cp = e.childPrice === null || e.childPrice === undefined || e.childPrice === '' ? pp : Number(e.childPrice) || 0;
    if (ad > 0) items._bq_pp_ad = { menuItemId: '_banquet_pp', name: 'Banket menyusu (adambaşı, böyük)', price: pp, qty: ad, note: '', extraFee: 0, vatRate: 0, banquet: true };
    if (ch > 0) items._bq_pp_ch = { menuItemId: '_banquet_pp_ch', name: 'Banket menyusu (adambaşı, uşaq)', price: cp, qty: ch, note: '', extraFee: 0, vatRate: 0, banquet: true };
  }
  return items;
}
function pickTableFor(e) {
  return new Promise((resolve) => {
    const free = (state.tables || []).filter(t => !t.occupant && !t.isRestoredTemp).sort((a, b) => String(a.name).localeCompare(String(b.name), 'az', { numeric: true }));
    let picked = null;
    yzModal({
      title: `${I('chair')} Banketi masaya oturt · ${esc(e.clientName)}`,
      body: `<p class="yzi-p">Menyu masaya yazılacaq, mallar <b>anbardan silinəcək</b> (mətbəxə çek getmir). Alınmış beh (${fmtMoney(depositsOf(e))}) ödənilmiş kimi çıxılacaq.</p>
        ${e.date !== dateStr(new Date()) ? `<p class="yzi-warnbox">Diqqət: banketin tarixi ${fmtDay(e.date)}-dir, bu gün deyil.</p>` : ''}
        <label class="yzp-check" style="display:flex;gap:8px;align-items:center;margin:6px 0;"><input type="radio" name="bqSeat" value="__new" checked> <b>Yeni masa aç: "Banket · ${esc(e.clientName)}"</b></label>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:6px;max-height:40vh;overflow:auto;">
          ${free.map(t => `<label class="yzi-btn yzi-btn--ghost" style="justify-content:flex-start;gap:6px;"><input type="radio" name="bqSeat" value="${esc(t.id)}"> ${esc(t.name)}</label>`).join('') || '<p class="yzi-hint">Boş masa yoxdur</p>'}
        </div>`,
      onClose: () => resolve(picked),
      actions: [
        { label: 'Ləğv', cancel: true, cls: 'yzi-btn--ghost' },
        { label: 'Oturt', cls: 'yzi-btn--gold', onClick: async (b) => { picked = b.querySelector('input[name=bqSeat]:checked')?.value || '__new'; } }
      ]
    });
  });
}
export async function seatBanquet(e) {
  if (!canBq()) { showToast(`${I('ban')} Banket icazəniz yoxdur`); return; }
  const fresh = { id: e.id, ...((await R.banquetEvents.child(e.id).once('value')).val() || {}) };
  if (!fresh.clientName) return;
  if (fresh.seated || ['seated', 'done'].includes(fresh.status)) { showToast(`${I('warning')} Bu banket artıq masaya oturulub`); return; }
  if (fresh.status === 'cancelled') { showToast(`${I('warning')} Ləğv edilmiş banket masaya oturulmur`); return; }
  if (fresh.status === 'approval') { showToast(`${I('warning')} Banket hələ təsdiqlənməyib: beh alın və ya Rəhbərin təsdiqini gözləyin`); return; }
  const items = buildTableItems(fresh);
  if (!Object.keys(items).length) { showToast(`${I('warning')} Əvvəlcə "Menyunu tərtib et" ilə menyunu yazın`); return; }
  const choice = await pickTableFor(fresh);
  if (!choice) return;
  const u = me(), now = serverNow();
  let tableId = choice, tableName;
  const tableRec = { occupant: u.id, activatedAt: now, openedById: u.id, openedByName: u.name, banquetId: fresh.id };
  if (choice === '__new') {
    tableId = R.tables.push().key;
    tableName = `Banket · ${fresh.clientName}`;
  } else {
    // Masa boşdursa tutulur (iki nəfər eyni masanı eyni anda tuta bilməz)
    const tx = await R.tables.child(tableId).transaction(t => (t && !t.occupant ? { ...t, ...tableRec, sessionId: `${tableId}_${now}`, notes: `Banket: ${fresh.clientName} · ${guestsOf(fresh)} nəfər` } : undefined), null, false);
    if (!tx.committed || !tx.snapshot.val()) { showToast(`${I('warning')} Masa artıq doludur — başqa masa seçin`); return; }
    tableName = tx.snapshot.val().name;
  }
  const sessionId = choice === '__new' ? `${tableId}_${now}` : (await R.tables.child(tableId).child('sessionId').once('value')).val();
  const tot = computeOrderTotals(items);
  const dep = depositsOf(fresh);
  const depByMethod = {};
  depositList(fresh).forEach(x => { const k = x.methodLabel || 'Beh'; depByMethod[k] = money2((depByMethod[k] || 0) + (Number(x.amount) || 0)); });
  const order = {
    items, total: tot.total, serviceChargeAmount: tot.serviceChargeAmount || 0, serviceChargePercent: tot.serviceChargePercent || 0,
    waiterId: u.id, paidAmount: money2(dep), remainingAmount: money2(Math.max(0, tot.total - dep)),   // beh tam sayılır: sonradan əlavə edilən mallar da behdən çıxılır
    firstOrderAt: now, updatedAt: now,
    banquet: { id: fresh.id, name: fresh.clientName, depositTotal: dep, depositByMethod: Object.keys(depByMethod).length ? depByMethod : null },
    pays: dep > 0 ? { _banquetDeposit: { type: 'deposit', typeLabel: 'Banket behi (əvvəlcədən alınıb)', thisPay: dep, banquetId: fresh.id, staffId: u.id, staffName: u.name, createdAt: now } } : null
  };
  const upd = {
    ['tableOrders/' + tableId]: order,
    [`banquetEvents/${fresh.id}/seated`]: { tableId, tableName, sessionId, at: now, byId: u.id, byName: u.name, stockOut: true },
    [`banquetEvents/${fresh.id}/status`]: 'seated',
    [`banquetEvents/${fresh.id}/history/${R.banquetEvents.push().key}`]: { at: now, byName: u.name, text: `Masaya oturuldu: ${tableName} · menyu ${fmtMoney(tot.total)}, beh ${fmtMoney(dep)}` }
  };
  if (choice === '__new') upd['tables/' + tableId] = { name: tableName, category: 'Banket', isRestoredTemp: true, createdAt: now, ...tableRec, sessionId, notes: `Banket: ${fresh.clientName} · ${guestsOf(fresh)} nəfər` };
  try { await db.ref().update(upd); }
  catch (er) {
    if (choice !== '__new') await R.tables.child(tableId).update({ occupant: null, activatedAt: null, sessionId: null, openedById: null, openedByName: null, banquetId: null, notes: '' }).catch(() => {});
    showToast(`${I('error')} Banket masaya yazılmadı (bağlantı və ya icazə xətası). Heç nə dəyişməyib.`);
    return;
  }
  // Anbardan silinmə (mətbəxə çek getmir). Mal masada ləğv edilsə, adi qaydada anbara qayıdır.
  Object.values(items).forEach(it => { if (it.menuItemId && !String(it.menuItemId).startsWith('_')) updateStock(it.menuItemId, -it.qty, state.menuItems); });
  addLog('table_open', `${u.name} "${fresh.clientName}" banketini "${tableName}" masasına oturtdu: ${Object.values(items).length} sətir, ${fmtMoney(tot.total)}, beh ${fmtMoney(dep)}`, { tableId, sessionId, banquetId: fresh.id });
  showToast(`${I('check')} Banket "${tableName}" masasına yazıldı`);
}

/* Masa bağlananda banket "Bitib" olur (hər hansı panel cihazı yazır, təkrar yazmaq zərərsizdir) */
function syncSeated() {
  if (!state.user || !canBq() || !state.tableOrders || !(state.tables || []).length) return;
  (state.banquetEvents || []).filter(e => e.status === 'seated' && e.seated?.tableId).forEach(e => {
    if (serverNow() - (e.seated.at || 0) < 5 * 60000) return;   // yenicə oturulub — məlumat hələ gəlməmiş ola bilər
    const o = state.tableOrders[e.seated.tableId];
    const t = (state.tables || []).find(x => x.id === e.seated.tableId);
    if (o?.banquet?.id === e.id) return;                    // hələ masadadır
    if (t && t.sessionId === e.seated.sessionId && t.occupant) return;   // masa açıqdır, sifariş hələ yüklənməyib
    R.banquetEvents.child(e.id).update({ status: 'done', closedAt: serverNow() }).catch(() => {});
  });
}

/* ═══ LƏĞV / SİL ═══ */
async function cancelBanquet(e) {
  const dep = depositsOf(e);
  const reason = await confirmBox(`<b>${esc(e.clientName)}</b> (${fmtDay(e.date)}) banketi ləğv edilsin?${dep > 0 ? `<br><br>Alınmış beh <b>${fmtMoney(dep)}</b> geri qaytarılmır, kassada qalır.` : ''}`, { title: 'Banketi ləğv et', okLabel: 'Ləğv et', okCls: 'yzi-btn--red', input: 'Səbəb' });
  if (!reason) return;
  const u = me(), now = serverNow();
  await R.banquetEvents.child(e.id).update({ status: 'cancelled', cancelledAt: now, cancelledByName: u.name, cancelReason: String(reason) });
  await R.banquetEvents.child(e.id).child('history').push({ at: now, byName: u.name, text: `Ləğv edildi: ${reason}${dep > 0 ? ` · beh ${fmtMoney(dep)} qaytarılmadı` : ''}` });
  if (e.hallId) db.ref(`banquetHallBookings/${e.hallId}/${e.date}/${e.id}`).remove().catch(() => {});
  addLog('banquet', `${u.name} "${e.clientName}" banketini ləğv etdi: ${reason}${dep > 0 ? ` (beh ${fmtMoney(dep)} qaytarılmadı)` : ''}`, { banquetId: e.id });
  showToast(`${I('check')} Banket ləğv edildi`);
}
export function deleteBanquetEvent(id) {
  const e = (state.banquetEvents || []).find(x => x.id === id);
  if (!e) return;
  if (!isRehber()) { showToast(`${I('ban')} Banketi yalnız Rəhbər silə bilər. Lazım olsa "Ləğv et" istifadə edin.`); return; }
  if (e.status === 'seated') { showToast(`${I('warning')} Masada olan banket silinmir`); return; }
  const dep = depositsOf(e);
  confirmDelete2x(1, `"${esc(e.clientName)}" banketi${dep > 0 ? ` (alınmış beh ${fmtMoney(dep)} kassa qeydlərində qalır)` : ''}`, () => {
    R.banquetEvents.child(id).remove();
    if (e.hallId) db.ref(`banquetHallBookings/${e.hallId}/${e.date}/${id}`).remove();
    addLog('banquet', `Rəhbər "${e.clientName}" banketini sildi (${fmtDay(e.date)})`, { banquetId: id });
    state.banquetEvents = state.banquetEvents.filter(x => x.id !== id);
    selectBanquetEvent(null); renderBanquetCalendar();
    showToast(`${I('check')} Banket silindi`);
  });
}

/* ═══ HAZIRLIQ VƏRƏQİ (mətbəx üçün çap) ═══ */
function printPrep(e) {
  const rows = menuLines(e).map(l => `<tr><td>${esc(l.name)}</td><td style="text-align:right">${effQty(l, e)}</td><td>${l.perGuest ? `${l.qty} × ${guestsOf(e)} qonaq` : ''}</td></tr>`).join('');
  const w = window.open('', '_blank', 'width=620,height=800');
  if (!w) { showToast(`${I('warning')} Çap pəncərəsi bloklandı`); return; }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Hazırlıq vərəqi</title><style>body{font-family:sans-serif;padding:16px;max-width:560px;margin:0 auto}table{width:100%;border-collapse:collapse;font-size:13px}td,th{border-bottom:1px solid #ccc;padding:5px;text-align:left}h2{margin:0 0 6px}p{margin:3px 0;font-size:13px}</style></head><body>
    <h2>Banket hazırlıq vərəqi</h2>
    <p><b>${esc(e.clientName)}</b> · ${esc(e.eventTypeName || '')}</p>
    <p>${fmtDay(e.date)} · ${esc(e.startTime || '')}-${esc(e.endTime || '')}${e.hallName ? ' · ' + esc(e.hallName) : ''}</p>
    <p>Qonaq: ${e.adultsCount || 0} böyük, ${e.childrenCount || 0} uşaq, ${e.vipCount || 0} VIP · Masa: ${e.tableCount || '—'} · ${esc(e.tableLayout || '')} · ${esc(e.serviceType || '')}</p>
    ${e.wishes ? `<p><b>Xüsusi istəklər:</b> ${esc(e.wishes)}</p>` : ''}
    <table><thead><tr><th>Mal</th><th style="text-align:right">Miqdar</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="3">Menyu yazılmayıb</td></tr>'}</tbody></table>
    <p style="margin-top:10px;font-size:11px;color:#666">Çap: ${fmtDT(Date.now())}</p>
    <script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}

/* ═══ DETAL ═══ */
export function selectBanquetEvent(id) {
  state._selectedEventId = id;
  const overlay = document.getElementById('banquetEventDetailPanel');
  if (!id) { overlay?.classList.remove('open'); return; }
  const e = (state.banquetEvents || []).find(x => x.id === id);
  if (!e) { overlay?.classList.remove('open'); return; }
  renderBanquetEventDetail(e);
  overlay?.classList.add('open');
}
export function closeBanquetEventDetail() { selectBanquetEvent(null); }
function renderBanquetEventDetail(e) {
  const el = document.getElementById('banquetEventDetailBody');
  if (!el) return;
  const total = computeTotal(e), dep = depositsOf(e), rem = Math.max(0, money2(total - dep));
  const lines = menuLines(e);
  const hist = Object.values(e.history || {}).sort((a, b) => (a.at || 0) - (b.at || 0));
  const act = ACTIVE(e) && e.status !== 'seated';
  el.innerHTML = `
    <div class="ct-detail-header">
      <span>${I('calendar')} ${esc(e.clientName)}</span>
      <span style="font-size:13px;font-weight:700;color:${ST[e.status]?.color};">${ST[e.status]?.label || ''}</span>
    </div>
    <div class="ct-detail-info-grid">
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Telefon</div><div class="ct-detail-info-block__value">${e.phone ? `<a href="tel:+${esc(phoneKey(e.phone))}">${esc(e.phone)}</a>` : '—'}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">WhatsApp</div><div class="ct-detail-info-block__value">${e.whatsapp || e.phone ? `<a href="https://wa.me/${esc(phoneKey(e.whatsapp || e.phone))}" target="_blank" rel="noopener">${esc(e.whatsapp || e.phone)}</a>` : '—'}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Tədbir</div><div class="ct-detail-info-block__value">${esc(e.eventTypeName || '—')}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Zal</div><div class="ct-detail-info-block__value">${esc(e.hallName || '—')}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Tarix / saat</div><div class="ct-detail-info-block__value">${fmtDay(e.date)} · ${esc(e.startTime || '')}-${esc(e.endTime || '')}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Qonaqlar</div><div class="ct-detail-info-block__value">${e.adultsCount || 0} böyük, ${e.childrenCount || 0} uşaq${e.vipCount ? `, ${e.vipCount} VIP` : ''}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Masa</div><div class="ct-detail-info-block__value">${e.tableCount || '—'} · ${esc(e.tableLayout || '—')}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Xidmət</div><div class="ct-detail-info-block__value">${esc(e.serviceType || '—')}</div></div>
    </div>
    ${e.wishes ? `<div class="ct-detail-section-title">Xüsusi istəklər</div><p style="font-size:13px;color:var(--text2);">${esc(e.wishes)}</p>` : ''}
    ${e.extras ? `<div class="ct-detail-section-title">Dekor, musiqi, tort</div><p style="font-size:13px;color:var(--text2);">${esc(e.extras)}</p>` : ''}
    ${e.notes ? `<div class="ct-detail-section-title">Qeyd</div><p style="font-size:13px;color:var(--text2);">${esc(e.notes)}</p>` : ''}
    <div class="ct-detail-section-title">${I('food')} Menyu (${e.priceMode === 'perPerson' ? `adambaşı ${fmtMoney(e.perPersonPrice)}${e.childrenCount ? `, uşaq ${fmtMoney(e.childPrice ?? e.perPersonPrice)}` : ''}` : 'mallar × miqdar'})</div>
    ${lines.length ? lines.map(l => `<div class="ct-detail-item-row"><span>${effQty(l, e)} × ${esc(l.name)}${l.perGuest ? ` <small style="color:var(--text3)">(${l.qty} hər qonağa)</small>` : ''}</span><span>${e.priceMode === 'perPerson' ? '' : fmtMoney(curPrice(l) * effQty(l, e))}</span></div>`).join('') : '<p style="font-size:13px;color:var(--text3);">Menyu hələ tərtib edilməyib.</p>'}
    <div class="ct-detail-section-title">${I('cash')} Hesab</div>
    <div class="ct-detail-info-grid">
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Ümumi məbləğ</div><div class="ct-detail-info-block__value">${fmtMoney(total)}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Beh</div><div class="ct-detail-info-block__value" style="color:var(--green);">${fmtMoney(dep)}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Qalıq</div><div class="ct-detail-info-block__value" style="color:${rem > 0 ? 'var(--red)' : 'var(--green)'};">${fmtMoney(rem)}</div></div>
    </div>
    ${depositList(e).map(x => `<div class="ct-detail-item-row"><span>${fmtDT(x.at)} — beh (${esc(x.methodLabel || '')})${x.byName ? ' · ' + esc(x.byName) : ''}${x.note ? ' · ' + esc(x.note) : ''}</span><span style="font-weight:600;color:var(--green);">${fmtMoney(x.amount)}</span></div>`).join('')}
    ${e.seated ? `<p class="yzi-hint">Masa: <b>${esc(e.seated.tableName || '')}</b> · ${fmtDT(e.seated.at)} · ${esc(e.seated.byName || '')}</p>` : ''}
    ${e.cancelReason ? `<p class="yzi-bad" style="font-size:13px;">Ləğv səbəbi: ${esc(e.cancelReason)} · ${fmtDT(e.cancelledAt)}</p>` : ''}
    ${hist.length ? `<div class="ct-detail-section-title">${I('clipboard')} Tarixçə</div>${hist.map(h => `<div class="audit-timeline-item"><div class="audit-timeline-time">${fmtDT(h.at)}</div><div class="audit-timeline-text">${esc(h.text)}${h.byName ? ` <small style="color:var(--text3)">· ${esc(h.byName)}</small>` : ''}</div></div>`).join('')}` : ''}
    ${e.status === 'approval' ? `<p class="yzi-warnbox">Beh alınmayıb — qeydiyyat ${isRehber() ? 'sizin təsdiqinizi' : 'Rəhbərin təsdiqini'} gözləyir. Beh alınanda avtomatik təsdiqlənir.</p>` : ''}
    ${e.approvedAt ? `<p class="yzi-hint">Behsiz təsdiq: ${esc(e.approvedByName || '')} · ${fmtDT(e.approvedAt)}</p>` : ''}
    <div class="ct-detail-actions" style="flex-wrap:wrap;">
      ${isRehber() && e.status === 'approval' ? `<button class="btn btn-green" style="flex:1;padding:11px;" data-bq="approve">${I('check')} Behsiz təsdiqlə</button>
        <button class="btn btn-red" style="flex:1;padding:11px;" data-bq="cancel">${I('close')} Rədd et</button>` : ''}
      ${canBq() && act ? `<button class="btn btn-blue" style="flex:1;padding:11px;" data-bq="edit">${I('edit')} Redaktə et</button>
        <button class="btn btn-ghost" style="flex:1;padding:11px;" data-bq="menu">${I('food')} Menyunu tərtib et</button>
        <button class="btn btn-green" style="flex:1;padding:11px;" data-bq="dep">${I('cash')} Beh al</button>
        ${e.status !== 'approval' ? `<button class="btn btn-blue" style="flex:1;padding:11px;" data-bq="seat">${I('chair')} Masaya oturt</button>` : ''}` : ''}
      ${lines.length ? `<button class="btn btn-ghost" style="flex:1;padding:11px;" data-bq="prep">${I('printer')} Hazırlıq vərəqi</button>` : ''}
      ${canBq() && act && !(isRehber() && e.status === 'approval') ? `<button class="btn btn-red" style="flex:1;padding:11px;" data-bq="cancel">${I('close')} Ləğv et</button>` : ''}
      ${isRehber() && e.status !== 'seated' ? `<button class="btn btn-red" style="flex:1;padding:11px;" data-bq="del">${I('trash')} Sil</button>` : ''}
    </div>`;
  el.querySelectorAll('[data-bq]').forEach(btn => btn.addEventListener('click', () => {
    const cur = (state.banquetEvents || []).find(x => x.id === e.id) || e;
    const k = btn.dataset.bq;
    if (k === 'edit') openBanquetEventModal(cur.id);
    else if (k === 'menu') { const d = JSON.parse(JSON.stringify(cur)); openMenuEditor(d, null, { saveTo: cur }); }
    else if (k === 'dep') openDeposit(cur);
    else if (k === 'seat') seatBanquet(cur);
    else if (k === 'prep') printPrep(cur);
    else if (k === 'cancel') cancelBanquet(cur);
    else if (k === 'del') deleteBanquetEvent(cur.id);
    else if (k === 'approve') approveBanquet(cur);
  }));
}

/* ═══ PANEL ═══ */
export function renderBanquetDashboard() {
  const el = document.getElementById('banquetDashboardBody');
  if (!el) return;
  const today = dateStr(new Date());
  const in7 = dateStr(new Date(Date.now() + 7 * 86400000));
  const monthPrefix = today.slice(0, 7);
  const all = state.banquetEvents || [];
  const active = all.filter(ACTIVE);
  const todayEvents = active.filter(e => e.date === today);
  const week = active.filter(e => e.date > today && e.date <= in7).sort((a, b) => startTs(a) - startTs(b));
  const thisMonth = all.filter(e => e.status !== 'cancelled' && String(e.date).startsWith(monthPrefix));
  const expected = thisMonth.reduce((s, e) => s + computeTotal(e), 0);
  const deps = active.reduce((s, e) => s + depositsOf(e), 0);
  const remaining = active.reduce((s, e) => s + Math.max(0, computeTotal(e) - depositsOf(e)), 0);
  const noMenu = active.filter(e => !menuLines(e).length && e.priceMode !== 'perPerson' && e.date >= today);
  const approvals = active.filter(e => e.status === 'approval').sort((a, b) => startTs(a) - startTs(b));
  el.innerHTML = `
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:12px;">${isRehber() ? `<button class="btn btn-ghost" style="padding:9px 14px;" onclick="yzBanquet.settings()">${I('settings')} Ayarlar</button>` : ''}${canBq() ? `<button class="btn btn-green" style="padding:9px 16px;" onclick="openBanquetEventModal(null)">${I('plus')} Yeni banket qeydiyyatı</button>` : ''}</div>
    ${approvals.length ? `<div class="report-section-title" style="color:var(--orange);">${I('warning')} Rəhbər təsdiqi gözləyən (behsiz) qeydiyyatlar</div>${approvals.map(eventCard).join('')}` : ''}
    <div class="ct-report__stats" style="margin-bottom:20px;">
      <div class="stat-card"><div class="stat-num" style="color:var(--blue);">${todayEvents.length}</div><div class="stat-label">Bu gün</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--blue);">${week.length}</div><div class="stat-label">Növbəti 7 gün</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--purple);">${thisMonth.length}</div><div class="stat-label">Bu ay banket</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--green);">${fmtMoney(expected)}</div><div class="stat-label">Bu ay ümumi məbləğ</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--green);">${fmtMoney(deps)}</div><div class="stat-label">Gələcək banketlərin behi</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--orange);">${fmtMoney(remaining)}</div><div class="stat-label">Alınacaq qalıq</div></div>
    </div>
    ${todayEvents.length ? `<div class="report-section-title">${I('clock')} Bu günkü banketlər</div>${todayEvents.map(eventCard).join('')}` : ''}
    ${week.length ? `<div class="report-section-title">${I('calendar')} Növbəti 7 gün</div>${week.map(eventCard).join('')}` : ''}
    ${noMenu.length ? `<div class="report-section-title" style="color:var(--orange);">${I('warning')} Menyusu tərtib edilməyən banketlər</div>${noMenu.map(eventCard).join('')}` : ''}`;
}

/* ═══ BİLDİRİŞLƏR: 3 gün, 1 gün (ciddi), tədbir günü ═══ */
const LEVELS = [
  { k: 'd3', ms: 3 * 86400000, lvl: 'warn', t: 'Banketə 3 gün qalıb' },
  { k: 'd1', ms: 86400000, lvl: 'alert', t: 'Banketə 1 gün qalıb — hazırlığı yoxlayın' },
  { k: 'd0', ms: 4 * 3600000, lvl: 'alert', t: 'Banket bu gündür — 4 saatdan az qalıb' }
];
const FKEY = 'yzbq_fired';
const fired = (() => { try { return JSON.parse(localStorage.getItem(FKEY) || '{}'); } catch (er) { return {}; } })();
const saveFired = () => { try { const cut = Date.now() - 10 * 86400000; Object.keys(fired).forEach(k => { if ((fired[k] || 0) < cut) delete fired[k]; }); localStorage.setItem(FKEY, JSON.stringify(fired)); } catch (er) { /* */ } };
let actx = null;
function beep(lvl) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const n = lvl === 'alert' ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = lvl === 'alert' ? 880 : 660; o.connect(g); g.connect(actx.destination);
      const t0 = actx.currentTime + i * 0.32;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.24);
      o.start(t0); o.stop(t0 + 0.26);
    }
    navigator.vibrate?.(lvl === 'alert' ? [250, 120, 250, 120, 250] : [200, 100, 200]);
  } catch (er) { /* səs bloklanıb */ }
}
function alertBox() {
  let b = document.getElementById('yzbqAlerts');
  if (!b) { b = document.createElement('div'); b.id = 'yzbqAlerts'; b.className = 'yzrv-alerts'; b.setAttribute('aria-live', 'assertive'); b.style.bottom = '96px'; document.body.appendChild(b); }
  return b;
}
function showAlert(key, e, lv) {
  const box = alertBox();
  if (box.querySelector(`[data-k="${CSS.escape(key)}"]`)) return;
  box.querySelectorAll(`.yzrv-alert[data-id="${CSS.escape(e.id)}"]`).forEach(x => { clearInterval(x._rep); x.remove(); });
  const total = computeTotal(e), dep = depositsOf(e);
  const d = document.createElement('div');
  d.className = `yzrv-alert yzrv-alert--${lv.lvl}`; d.dataset.k = key; d.dataset.id = e.id;
  d.innerHTML = `<div class="yzrv-alert__h">${I(lv.lvl === 'alert' ? 'warning' : 'calendar')} <b>${esc(lv.t)}</b><small>${fmtDT(Date.now())}</small></div>
    <div class="yzrv-alert__b"><b>${fmtDay(e.date)} ${esc(e.startTime || '')}</b> · ${esc(e.clientName)} · ${esc(e.eventTypeName || '')} · ${guestsOf(e)} nəfər${e.hallName ? ' · ' + esc(e.hallName) : ''}
      ${!menuLines(e).length && e.priceMode !== 'perPerson' ? '<br><span class="yzi-bad">Menyu hələ tərtib edilməyib!</span>' : ''}
      ${total - dep > 0.01 ? `<br>Qalıq: <b>${fmtMoney(total - dep)}</b>` : ''}</div>
    <div class="yzrv-alert__f"><button type="button" class="yzi-btn yzi-btn--sm" data-see>Bax</button><button type="button" class="yzi-btn yzi-btn--sm yzi-btn--gold" data-ok>Gördüm</button></div>`;
  d.querySelector('[data-ok]').addEventListener('click', () => {
    clearInterval(d._rep); d.remove();
    if (lv.noAck) return;
    const u = me();
    R.banquetEvents.child(e.id).child('acks').child(lv.k).set({ byId: u.id, byName: u.name, at: serverNow() }).catch(() => {});
    R.banquetEvents.child(e.id).child('history').push({ at: serverNow(), byName: u.name, text: `Bildiriş görüldü: ${lv.t}` }).catch(() => {});
  });
  d.querySelector('[data-see]').addEventListener('click', () => {
    if (typeof window.adminTab === 'function' && document.getElementById('adminScreen')?.classList.contains('active')) {
      window.adminTab('banquetCalendar', document.querySelector('.admin-tab[data-section="banquetCalendar"]'));
      state._banquetSelectedDay = e.date; state._banquetCalendarCursor = e.date; renderBanquetCalendar();
    }
    selectBanquetEvent(e.id);
  });
  box.prepend(d);
  beep(lv.lvl);
  if (lv.lvl === 'alert') d._rep = setInterval(() => { if (d.isConnected) beep('alert'); else clearInterval(d._rep); }, 120000);
}
function checkAlerts() {
  if (!state.user || state.user.role === 'kitchen' || !canBq()) { document.getElementById('yzbqAlerts')?.replaceChildren(); return; }
  const now = Date.now();
  const box = document.getElementById('yzbqAlerts');
  box?.querySelectorAll('.yzrv-alert').forEach(x => {
    const e = (state.banquetEvents || []).find(y => y.id === x.dataset.id);
    const lv = x.dataset.k.split(':')[1];
    if (!e || !ACTIVE(e) || e.status === 'seated' || e.acks?.[lv] || (lv === 'apr' && e.status !== 'approval')) { clearInterval(x._rep); x.remove(); }
  });
  if (isRehber()) (state.banquetEvents || []).filter(e => e.status === 'approval').forEach(e => {
    const key = `${e.id}:apr`;
    showAlert(key, e, { k: 'apr', lvl: 'warn', t: 'Behsiz banket qeydiyyatı təsdiq gözləyir', noAck: true });
  });
  (state.banquetEvents || []).forEach(e => {
    if (!ACTIVE(e) || e.status === 'seated') return;
    const left = startTs(e) - now;
    if (left < -2 * 3600000 || left > LEVELS[0].ms) return;
    const lv = LEVELS.filter(l => left <= l.ms).pop();
    if (!lv || e.acks?.[lv.k]) return;
    const key = `${e.id}:${lv.k}`;
    if (!fired[key]) { fired[key] = now; saveFired(); }
    showAlert(key, e, lv);
  });
}
setInterval(() => { try { checkAlerts(); syncSeated(); } catch (er) { console.warn('[banket]', er); } }, 30000);
setTimeout(() => { try { checkAlerts(); } catch (er) { /* */ } }, 8000);

// Mövcud HTML-də onclick="..." istifadə olunan funksiyalar qlobal əlçatan olmalıdır
window.selectBanquetHall = selectBanquetHall;
window.openBanquetHallModal = openBanquetHallModal;
window.closeBanquetHallModal = closeBanquetHallModal;
window.saveBanquetHall = saveBanquetHall;
window.deleteBanquetHall = deleteBanquetHall;
window.openBanquetEventTypeModal = openBanquetEventTypeModal;
window.closeBanquetEventTypeModal = closeBanquetEventTypeModal;
window.saveBanquetEventType = saveBanquetEventType;
window.deleteBanquetEventType = deleteBanquetEventType;
window.changeBanquetMonth = changeBanquetMonth;
window.selectBanquetDay = selectBanquetDay;
window.openBanquetEventModal = openBanquetEventModal;
window.closeBanquetEventModal = () => document.getElementById('banquetEventModal')?.classList.remove('open');
window.checkBanquetConflict = () => {};
window.saveBanquetEvent = () => {};
window.selectBanquetEvent = selectBanquetEvent;
window.closeBanquetEventDetail = closeBanquetEventDetail;
window.addBanquetPayment = () => {};
window.deleteBanquetEvent = deleteBanquetEvent;
window.yzBanquet = { openForm: openBanquetEventModal, openDeposit, seatBanquet, computeTotal, depositsOf, settings: openBanquetSettings, approve: approveBanquet };
