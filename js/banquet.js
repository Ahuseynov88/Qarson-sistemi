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
  confirmDelete2x(1, `"${h.name}" adlı zal`, () => {
    R.banquetHalls.child(id).remove();
    addLog('table_mgmt', `Banket zalı silindi: ${h.name}`, {});
    state.banquetHalls = state.banquetHalls.filter(x => x.id !== id);
    if (state._selectedHallId === id) state._selectedHallId = null;
    renderBanquetHalls();
    showToast('<svg class="icon"><use href="#i-check"></use></svg> Zal silindi');
  });
}

/* ═══ TƏDBİR NÖVLƏRİ ═══ */

const DEFAULT_EVENT_TYPES = ['Toy','Nişan','Xına','Ad günü','Korporativ','İftar','Məzuniyyət','Konfrans','Seminar','Digər'];

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

/* ═══ TƏQVİM (Ay görünüşü) ═══ */

export function renderBanquetCalendar() {
  if (!state._banquetCalendarCursor) state._banquetCalendarCursor = dateStr(new Date());
  const cursor = new Date(state._banquetCalendarCursor);
  const year = cursor.getFullYear(), month = cursor.getMonth();
  const today = dateStr(new Date());

  const headerEl = document.getElementById('banquetCalendarHeader');
  if (headerEl) {
    headerEl.innerHTML = `
      <div class="banquet-status-legend">
        <span><span class="dot" style="background:#2ecc71;"></span> Boş</span>
        <span><span class="dot" style="background:${STATUS_INFO.pending.color};"></span> ${STATUS_INFO.pending.label}</span>
        <span><span class="dot" style="background:${STATUS_INFO.confirmed.color};"></span> ${STATUS_INFO.confirmed.label}</span>
        <span><span class="dot" style="background:${STATUS_INFO.full.color};"></span> ${STATUS_INFO.full.label}</span>
        <span><span class="dot" style="background:${STATUS_INFO.cancelled.color};"></span> ${STATUS_INFO.cancelled.label}</span>
      </div>
      <div style="display:flex;align-items:center;gap:10px;width:100%;justify-content:space-between;">
        <button class="btn btn-ghost" style="padding:8px 14px;" onclick="changeBanquetMonth(-1)">‹</button>
        <span style="font-weight:700;font-size:16px;">${AZ_MONTHS[month]} ${year}</span>
        <button class="btn btn-ghost" style="padding:8px 14px;" onclick="changeBanquetMonth(1)">›</button>
      </div>
    `;
  }

  const gridEl = document.getElementById('banquetCalendarGrid');
  if (!gridEl) return;

  const firstOfMonth = new Date(year, month, 1);
  const startOffset = (firstOfMonth.getDay() + 6) % 7; // Bazar ertəsi = 0 sütun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const cells = [];
  for (let i = startOffset - 1; i >= 0; i--) cells.push({ day: daysInPrevMonth - i, otherMonth: true, d: new Date(year, month - 1, daysInPrevMonth - i) });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, otherMonth: false, d: new Date(year, month, d) });
  while (cells.length % 7 !== 0) { const idx = cells.length - (startOffset + daysInMonth); cells.push({ day: idx+1, otherMonth: true, d: new Date(year, month+1, idx+1) }); }

  gridEl.innerHTML = AZ_WEEKDAYS.map(w => `<div class="banquet-cal-daylabel">${w}</div>`).join('') +
    cells.map(c => {
      const ds = dateStr(c.d);
      const dayEvents = state.banquetEvents.filter(e => e.date === ds);
      const dots = dayEvents.slice(0,4).map(e => `<span class="banquet-cal-dot" style="background:${STATUS_INFO[e.status]?.color||'#999'};"></span>`).join('');
      const classes = ['banquet-cal-day'];
      if (c.otherMonth) classes.push('banquet-cal-day--other-month');
      if (ds === today) classes.push('banquet-cal-day--today');
      if (ds === state._banquetSelectedDay) classes.push('banquet-cal-day--selected');
      return `<div class="${classes.join(' ')}" onclick="selectBanquetDay('${ds}')">
        <span class="banquet-cal-day__num">${c.day}</span>
        <div class="banquet-cal-day__dots">${dots}</div>
      </div>`;
    }).join('');

  if (state._banquetSelectedDay) renderBanquetDayEvents();
}

export function changeBanquetMonth(delta) {
  const cursor = new Date(state._banquetCalendarCursor || new Date());
  cursor.setMonth(cursor.getMonth() + delta, 1);
  state._banquetCalendarCursor = dateStr(cursor);
  renderBanquetCalendar();
}

export function selectBanquetDay(ds) {
  state._banquetSelectedDay = ds;
  renderBanquetCalendar();
  renderBanquetDayEvents();
}

function renderBanquetDayEvents() {
  const el = document.getElementById('banquetDayEventsSection');
  if (!el) return;
  const ds = state._banquetSelectedDay;
  const dayEvents = state.banquetEvents.filter(e => e.date === ds).sort((a,b) => (a.startTime||'').localeCompare(b.startTime||''));
  const [y,m,d] = ds.split('-');
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <div style="font-weight:700;font-size:15px;">${d}.${m}.${y} tədbirləri</div>
      <button class="btn btn-green" style="padding:8px 16px;font-size:12.5px;" onclick="openBanquetEventModal(null,'${ds}')"><svg class="icon"><use href="#i-check"></use></svg> Yeni Tədbir</button>
    </div>
    ${dayEvents.length ? dayEvents.map(e => {
      const hall = state.banquetHalls.find(h => h.id === e.hallId);
      return `<div class="banquet-event-card" style="border-left-color:${STATUS_INFO[e.status]?.color||'#999'};" onclick="selectBanquetEvent('${e.id}')">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong>${esc(e.clientName)}</strong>
          <span style="font-size:12px;font-weight:700;color:${STATUS_INFO[e.status]?.color};">${STATUS_INFO[e.status]?.label||''}</span>
        </div>
        <div style="font-size:12.5px;color:var(--text2);margin-top:4px;">${esc(e.eventTypeName||'')} · ${esc(hall?.name||'?')} · ${esc(e.startTime||'')}-${esc(e.endTime||'')}</div>
      </div>`;
    }).join('') : '<p style="color:var(--text3);font-size:13px;">Bu tarixdə tədbir yoxdur.</p>'}
  `;
}

/* ═══ TƏDBİR YARATMA/REDAKTƏ (konflikt-təhlükəsiz) ═══ */

function timeRangesOverlap(s1, e1, s2, e2) {
  // İki vaxt aralığı üst-üstə düşürmü? (HH:MM mətn kimi müqayisə - sıfır-doldurulmuş
  // formatda ədədi müqayisə ilə eynidir)
  if (!s1 || !e1 || !s2 || !e2) return false;
  return s1 < e2 && s2 < e1;
}

export function openBanquetEventModal(id, prefilledDate) {
  const e = id ? state.banquetEvents.find(x => x.id === id) : null;
  document.getElementById('banquetEventModal').dataset.editId = id || '';
  document.getElementById('banquetEventModalTitle').innerHTML = `<svg class="icon"><use href="#i-clock"></use></svg> ${id?'Tədbiri Redaktə Et':'Yeni Tədbir'}`;

  const typeSel = document.getElementById('be_eventType');
  typeSel.innerHTML = state.banquetEventTypes.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
  const hallSel = document.getElementById('be_hallId');
  hallSel.innerHTML = state.banquetHalls.map(h => `<option value="${h.id}">${esc(h.name)} (${h.capacity||0} nəfər)</option>`).join('');

  document.getElementById('be_clientName').value = e?.clientName || '';
  document.getElementById('be_phone').value = e?.phone || '';
  document.getElementById('be_whatsapp').value = e?.whatsapp || '';
  if (e?.eventTypeId) typeSel.value = e.eventTypeId;
  if (e?.hallId) hallSel.value = e.hallId;
  document.getElementById('be_date').value = e?.date || prefilledDate || dateStr(new Date());
  document.getElementById('be_status').value = e?.status || 'pending';
  document.getElementById('be_startTime').value = e?.startTime || '';
  document.getElementById('be_endTime').value = e?.endTime || '';
  document.getElementById('be_adultsCount').value = e?.adultsCount || '';
  document.getElementById('be_childrenCount').value = e?.childrenCount || '';
  document.getElementById('be_vipCount').value = e?.vipCount || '';
  document.getElementById('be_tableLayout').value = e?.tableLayout || 'Dairəvi';
  document.getElementById('be_serviceType').value = e?.serviceType || 'Tam menyu';
  document.getElementById('be_notes').value = e?.notes || '';
  document.getElementById('be_totalAmount').value = e?.totalAmount || '';
  document.getElementById('be_advanceAmount').value = e?.advanceAmount || '';
  document.getElementById('banquetConflictWarning').textContent = '';

  document.getElementById('banquetEventModal').classList.add('open');
  checkBanquetConflict();
}
export function closeBanquetEventModal() { document.getElementById('banquetEventModal').classList.remove('open'); }

export function checkBanquetConflict() {
  // Canlı xəbərdarlıq (yaddan çıxarma üçün) - HƏQİQİ qarşısıalma isə saxlama anında
  // transaction ilə edilir (bax: saveBanquetEvent). Bu, sadəcə istifadəçini əvvəlcədən xəbərdar edir.
  const hallId = document.getElementById('be_hallId').value;
  const date = document.getElementById('be_date').value;
  const startTime = document.getElementById('be_startTime').value;
  const endTime = document.getElementById('be_endTime').value;
  const editId = document.getElementById('banquetEventModal').dataset.editId;
  const warnEl = document.getElementById('banquetConflictWarning');
  if (!hallId || !date || !startTime || !endTime) { warnEl.textContent = ''; return; }

  const conflict = state.banquetEvents.find(ev =>
    ev.id !== editId && ev.hallId === hallId && ev.date === date && ev.status !== 'cancelled' &&
    timeRangesOverlap(startTime, endTime, ev.startTime, ev.endTime)
  );
  warnEl.textContent = conflict ? `⚠ Bu zal həmin vaxt aralığında artıq "${conflict.clientName}" tədbiri üçün rezervdir!` : '';
}

export function saveBanquetEvent() {
  const clientName = document.getElementById('be_clientName').value.trim();
  const hallId = document.getElementById('be_hallId').value;
  const date = document.getElementById('be_date').value;
  const startTime = document.getElementById('be_startTime').value;
  const endTime = document.getElementById('be_endTime').value;
  if (!clientName) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Müştərinin adı mütləqdir'); return; }
  if (!hallId) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Zal seçin'); return; }
  if (!date || !startTime || !endTime) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Tarix, başlama və bitmə saatı mütləqdir'); return; }
  if (startTime >= endTime) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Bitmə saatı başlama saatından sonra olmalıdır'); return; }

  const editId = document.getElementById('banquetEventModal').dataset.editId || null;
  const eventTypeSel = document.getElementById('be_eventType');
  const eventTypeName = eventTypeSel.options[eventTypeSel.selectedIndex]?.text || '';

  const totalAmount = parseFloat(document.getElementById('be_totalAmount').value) || 0;
  const advanceAmount = Math.min(parseFloat(document.getElementById('be_advanceAmount').value) || 0, totalAmount);

  const eventData = {
    clientName, phone: document.getElementById('be_phone').value.trim(), whatsapp: document.getElementById('be_whatsapp').value.trim(),
    eventTypeId: eventTypeSel.value, eventTypeName,
    hallId, hallName: state.banquetHalls.find(h=>h.id===hallId)?.name || '',
    date, startTime, endTime,
    status: document.getElementById('be_status').value,
    adultsCount: parseInt(document.getElementById('be_adultsCount').value) || 0,
    childrenCount: parseInt(document.getElementById('be_childrenCount').value) || 0,
    vipCount: parseInt(document.getElementById('be_vipCount').value) || 0,
    tableLayout: document.getElementById('be_tableLayout').value,
    serviceType: document.getElementById('be_serviceType').value,
    notes: document.getElementById('be_notes').value.trim(),
    totalAmount, advanceAmount, remainingAmount: Math.round((totalAmount - advanceAmount)*100)/100,
    paymentHistory: editId ? (state.banquetEvents.find(e=>e.id===editId)?.paymentHistory || []) : (advanceAmount>0 ? [{amount:advanceAmount, method:'cash', date:Date.now(), note:'Avans'}] : []),
    staffId: state.user?.id || null, staffName: state.user?.name || '?',
    createdAt: editId ? (state.banquetEvents.find(e=>e.id===editId)?.createdAt || Date.now()) : Date.now()
  };

  const eventId = editId || R.banquetEvents.push().key;

  // KONFLİKT-TƏHLÜKƏSİZ REZERVASİYA: bu zal+tarix üçün "slot reyestri" üzərində
  // Firebase TRANSACTION işlədirik - iki admin EYNİ ANDA eyni zalı eyni vaxta
  // təsdiqləməyə çalışsa belə, YALNIZ BİRİ uğurlu olacaq (server-tərəfli atomik yoxlama).
  db.ref(`banquetHallBookings/${hallId}/${date}`).transaction(current => {
    const bookings = current || {};
    for (const [existingEventId, slot] of Object.entries(bookings)) {
      if (existingEventId === eventId) continue; // özünü redaktə edərkən özü ilə toqquşma sayılmır
      if (timeRangesOverlap(startTime, endTime, slot.start, slot.end)) {
        return; // undefined qaytarmaq TRANSACTION-u LƏĞV EDİR (heç nə yazılmır)
      }
    }
    return { ...bookings, [eventId]: { start: startTime, end: endTime, clientName } };
  }, (error, committed) => {
    if (error) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Xəta baş verdi, yenidən cəhd edin'); return; }
    if (!committed) {
      showToast('<svg class="icon"><use href="#i-error"></use></svg> Bu zal həmin vaxt aralığında ARTIQ REZERVDİR! Başqa vaxt və ya zal seçin.');
      return;
    }
    // Köhnə vaxt aralığı (redaktə zamanı dəyişmiş ola bilər) reyestrdən təmizlənməlidir -
    // əgər tarix/zal dəyişibsə, KÖHNƏ yeri boşaldırıq.
    if (editId) {
      const oldEvent = state.banquetEvents.find(x => x.id === editId);
      if (oldEvent && (oldEvent.hallId !== hallId || oldEvent.date !== date)) {
        db.ref(`banquetHallBookings/${oldEvent.hallId}/${oldEvent.date}/${editId}`).remove();
      }
    }
    if (editId) {
      R.banquetEvents.child(editId).update(eventData);
      addLog('table_mgmt', `Banket tədbiri redaktə edildi: ${clientName} (${date})`, {});
    } else {
      R.banquetEvents.child(eventId).set(eventData);
      addLog('table_mgmt', `Yeni banket tədbiri yaradıldı: ${clientName} (${date}, ${eventTypeName})`, {});
    }
    closeBanquetEventModal();
    showToast('<svg class="icon"><use href="#i-check"></use></svg> Tədbir yadda saxlanıldı');
  });
}

/* ═══ TƏDBİR DETALI (tam ekran) ═══ */

export function selectBanquetEvent(id) {
  state._selectedEventId = id;
  const overlay = document.getElementById('banquetEventDetailPanel');
  if (!id) { overlay?.classList.remove('open'); return; }
  const e = state.banquetEvents.find(x => x.id === id);
  if (!e) { overlay?.classList.remove('open'); return; }
  renderBanquetEventDetail(e);
  overlay?.classList.add('open');
}
export function closeBanquetEventDetail() { selectBanquetEvent(null); }

function renderBanquetEventDetail(e) {
  const el = document.getElementById('banquetEventDetailBody');
  if (!el) return;
  const paid = (e.paymentHistory||[]).reduce((s,p) => s+p.amount, 0);
  const remaining = Math.max(0, Math.round(((e.totalAmount||0) - paid) * 100) / 100);
  const methodLabel = { cash: 'Nağd', card: 'Kart', transfer: 'Köçürmə' };
  el.innerHTML = `
    <div class="ct-detail-header">
      <span><svg class="icon"><use href="#i-clock"></use></svg> ${esc(e.clientName)}</span>
      <span style="font-size:13px;font-weight:700;color:${STATUS_INFO[e.status]?.color};">${STATUS_INFO[e.status]?.label||''}</span>
    </div>
    <div class="ct-detail-info-grid">
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Telefon</div><div class="ct-detail-info-block__value">${esc(e.phone||'—')}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">WhatsApp</div><div class="ct-detail-info-block__value">${esc(e.whatsapp||'—')}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Tədbir növü</div><div class="ct-detail-info-block__value">${esc(e.eventTypeName||'—')}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Zal</div><div class="ct-detail-info-block__value">${esc(e.hallName||'—')}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Tarix / Saat</div><div class="ct-detail-info-block__value">${esc(e.date)} · ${esc(e.startTime)}-${esc(e.endTime)}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Qonaq sayı</div><div class="ct-detail-info-block__value">${e.adultsCount||0} böyük, ${e.childrenCount||0} uşaq, ${e.vipCount||0} VIP</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Masa düzülüşü</div><div class="ct-detail-info-block__value">${esc(e.tableLayout||'—')}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Xidmət növü</div><div class="ct-detail-info-block__value">${esc(e.serviceType||'—')}</div></div>
    </div>
    ${e.notes ? `<div class="ct-detail-section-title">Qeyd</div><p style="font-size:13px;color:var(--text2);">${esc(e.notes)}</p>` : ''}

    <div class="ct-detail-section-title"><svg class="icon" style="width:.9em;height:.9em;"><use href="#i-cash"></use></svg> Maliyyə</div>
    <div class="ct-detail-info-grid">
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Ümumi məbləğ</div><div class="ct-detail-info-block__value">${fmtMoney(e.totalAmount)}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Ödənilib</div><div class="ct-detail-info-block__value" style="color:var(--green);">${fmtMoney(paid)}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Qalıq</div><div class="ct-detail-info-block__value" style="color:${remaining>0?'var(--red)':'var(--green)'};">${fmtMoney(remaining)}</div></div>
    </div>
    ${(e.paymentHistory||[]).length ? `
      <div style="margin-bottom:10px;">
        ${e.paymentHistory.map(p => `<div class="ct-detail-item-row"><span>${new Date(p.date).toLocaleDateString('az-AZ')} — ${esc(p.note||'')} (${methodLabel[p.method]||p.method})</span><span style="font-weight:600;color:var(--green);">${fmtMoney(p.amount)}</span></div>`).join('')}
      </div>` : ''}
    ${remaining > 0 ? `
      <div style="display:flex;gap:8px;margin-bottom:14px;">
        <input type="number" id="banquetPaymentAmountInput" min="0" max="${remaining}" step="1" placeholder="Məbləğ" style="flex:1;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);">
        <select id="banquetPaymentMethodInput" style="padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);"><option value="cash">Nağd</option><option value="card">Kart</option><option value="transfer">Köçürmə</option></select>
        <button class="btn btn-green" style="padding:10px 16px;white-space:nowrap;" onclick="addBanquetPayment('${e.id}')">Ödəniş Əlavə Et</button>
      </div>` : ''}

    <div class="ct-detail-actions" style="flex-wrap:wrap;">
      <button class="btn btn-blue" style="flex:1;padding:11px;" onclick="openBanquetEventModal('${e.id}')"><svg class="icon"><use href="#i-tag"></use></svg> Redaktə Et</button>
      <button class="btn btn-red" style="flex:1;padding:11px;" onclick="deleteBanquetEvent('${e.id}')"><svg class="icon"><use href="#i-trash"></use></svg> Sil</button>
    </div>
  `;
}

export function addBanquetPayment(eventId) {
  const e = state.banquetEvents.find(x => x.id === eventId);
  if (!e) return;
  const amount = parseFloat(document.getElementById('banquetPaymentAmountInput').value) || 0;
  const method = document.getElementById('banquetPaymentMethodInput').value;
  const paid = (e.paymentHistory||[]).reduce((s,p) => s+p.amount, 0);
  const remaining = (e.totalAmount||0) - paid;
  if (amount <= 0) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Məbləğ 0-dan böyük olmalıdır'); return; }
  if (amount > remaining) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Ödəniş qalıqdan çox ola bilməz'); return; }
  const newHistory = [...(e.paymentHistory||[]), { amount, method, date: Date.now(), note: 'Ödəniş' }];
  R.banquetEvents.child(eventId).update({ paymentHistory: newHistory });
  addLog('payment', `${state.user?.name} "${e.clientName}" banket tədbirinə ${amount.toFixed(2)} ₼ ödəniş qeyd etdi`, { eventId, amount, method });
  showToast('<svg class="icon"><use href="#i-check"></use></svg> Ödəniş qeydə alındı');
  setTimeout(() => { e.paymentHistory = newHistory; renderBanquetEventDetail(e); }, 100);
}

export function deleteBanquetEvent(id) {
  const e = state.banquetEvents.find(x => x.id === id);
  if (!e) return;
  confirmDelete2x(1, `"${e.clientName}" tədbiri`, () => {
    R.banquetEvents.child(id).remove();
    db.ref(`banquetHallBookings/${e.hallId}/${e.date}/${id}`).remove();
    addLog('table_mgmt', `Banket tədbiri silindi: ${e.clientName} (${e.date})`, {});
    state.banquetEvents = state.banquetEvents.filter(x => x.id !== id);
    selectBanquetEvent(null);
    renderBanquetCalendar();
    showToast('<svg class="icon"><use href="#i-check"></use></svg> Tədbir silindi');
  });
}

/* ═══ BANKET DASHBOARD ═══ */

export function renderBanquetDashboard() {
  const el = document.getElementById('banquetDashboardBody');
  if (!el) return;
  const today = dateStr(new Date());
  const tomorrow = dateStr(new Date(Date.now() + 86400000));
  const monthPrefix = today.slice(0,7); // YYYY-MM

  const active = state.banquetEvents.filter(e => e.status !== 'cancelled');
  const todayEvents = active.filter(e => e.date === today);
  const tomorrowEvents = active.filter(e => e.date === tomorrow);
  const thisMonthEvents = active.filter(e => e.date.startsWith(monthPrefix));

  const expectedRevenue = thisMonthEvents.reduce((s,e) => s + (e.totalAmount||0), 0);
  const totalAdvances = active.reduce((s,e) => s + (e.paymentHistory||[]).reduce((s2,p)=>s2+p.amount,0), 0);
  const totalRemaining = active.reduce((s,e) => {
    const paid = (e.paymentHistory||[]).reduce((s2,p)=>s2+p.amount,0);
    return s + Math.max(0, (e.totalAmount||0) - paid);
  }, 0);
  const overdue = active.filter(e => {
    const paid = (e.paymentHistory||[]).reduce((s2,p)=>s2+p.amount,0);
    return e.date < today && (e.totalAmount||0) - paid > 0.01;
  });

  el.innerHTML = `
    <div class="ct-report__stats" style="margin-bottom:20px;">
      <div class="stat-card"><div class="stat-num" style="color:var(--blue);">${todayEvents.length}</div><div class="stat-label">Bugünkü tədbir</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--blue);">${tomorrowEvents.length}</div><div class="stat-label">Sabahkı tədbir</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--purple);">${thisMonthEvents.length}</div><div class="stat-label">Bu ay tədbir</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--green);">${fmtMoney(expectedRevenue)}</div><div class="stat-label">Bu ay gözlənilən gəlir</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--green);">${fmtMoney(totalAdvances)}</div><div class="stat-label">Alınmış avanslar (cəmi)</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--orange);">${fmtMoney(totalRemaining)}</div><div class="stat-label">Qalan ödənişlər (cəmi)</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--red);">${overdue.length}</div><div class="stat-label">Gecikmiş ödəniş</div></div>
    </div>
    ${todayEvents.length ? `
      <div class="report-section-title"><svg class="icon" style="width:.9em;height:.9em;"><use href="#i-clock"></use></svg> Bugünkü tədbirlər</div>
      ${todayEvents.map(e => `<div class="banquet-event-card" style="border-left-color:${STATUS_INFO[e.status]?.color};">
        <strong>${esc(e.clientName)}</strong> — ${esc(e.hallName)} · ${esc(e.startTime)}-${esc(e.endTime)}
      </div>`).join('')}
    ` : ''}
    ${overdue.length ? `
      <div class="report-section-title" style="color:var(--red);"><svg class="icon" style="width:.9em;height:.9em;"><use href="#i-warning"></use></svg> Gecikmiş ödənişi olan tədbirlər</div>
      ${overdue.map(e => {
        const paid = (e.paymentHistory||[]).reduce((s,p)=>s+p.amount,0);
        return `<div class="ct-detail-item-row"><span>${esc(e.clientName)} (${esc(e.date)})</span><span style="color:var(--red);font-weight:600;">${fmtMoney((e.totalAmount||0)-paid)} qalıb</span></div>`;
      }).join('')}
    ` : ''}
  `;
}

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
window.closeBanquetEventModal = closeBanquetEventModal;
window.checkBanquetConflict = checkBanquetConflict;
window.saveBanquetEvent = saveBanquetEvent;
window.selectBanquetEvent = selectBanquetEvent;
window.closeBanquetEventDetail = closeBanquetEventDetail;
window.addBanquetPayment = addBanquetPayment;
window.deleteBanquetEvent = deleteBanquetEvent;
