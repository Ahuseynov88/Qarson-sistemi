/* ═══════════════════════════════════════════
   ADMIN PANELİ
   Məntiq orijinaldan dəyişmədən köçürülüb - yalnız modula ayrılıb.
   Mövcud HTML `onclick=""` atributları ilə işlədiyi üçün funksiyalar
   `window`-a təyin edilir (bax: fayl sonu).
═══════════════════════════════════════════ */
import { R, db } from './firebase-service.js';
import { state } from './state.js';
import { esc, toArr, showToast, addLog, formatItemsList, stripTableName, confirmAction, confirmDelete2x } from './utils.js';
import { hasPermission, PERMISSION_PRESETS, ALL_PERMISSIONS } from './permissions.js';

export function renderPermissionCheckboxes(existingPerms = []) {
  return ALL_PERMISSIONS.map(group => `
    <div style="margin-bottom:16px;">
      <div style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid var(--border);">
        ${group.icon} ${group.group}
      </div>
      <div class="perm-checkbox-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
        ${group.items.map(item => `
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--text);padding:6px 8px;border-radius:8px;background:var(--bg);border:1px solid var(--border);">
            <input type="checkbox" name="staff_perm" value="${item.key}" ${existingPerms.includes(item.key) ? 'checked' : ''} style="accent-color:var(--green);width:16px;height:16px;flex-shrink:0;">
            ${item.label}
          </label>
        `).join('')}
      </div>
    </div>
  `).join('');
}

export function readPermissionCheckboxes() {
  const checkboxes = document.querySelectorAll('input[name="staff_perm"]:checked');
  return Array.from(checkboxes).map(cb => cb.value);
}

export function applyPermissionPreset(presetKey) {
  const preset = PERMISSION_PRESETS[presetKey];
  if (!preset) return;
  document.querySelectorAll('input[name="staff_perm"]').forEach(cb => {
    cb.checked = preset.perms.includes(cb.value);
  });
}

export function renderAdmin() {
  if (state.adminSection==='dashboard') renderDashboard();
  if (state.adminSection==='staff')     renderStaff();
  if (state.adminSection==='tables')    renderTables();
  if (state.adminSection==='menu')      renderMenuItems();
  if (state.adminSection==='logs')      renderLogs();
  if (state.adminSection==='feedback')  renderFeedbackSection();
  if (state.adminSection==='customers') renderCustomers();
  if (state.adminSection==='paymentMethods') renderPaymentMethods();
  if (state.adminSection==='closedOrders') renderClosedOrders();
  if (state.adminSection==='loyaltyCustomers') renderLoyaltyCustomers();
  if (state.adminSection==='suppliers') renderSuppliers();
  if (state.adminSection==='purchases') renderPurchases();
}

export function adminTab(sec, el) {
  state.adminSection = sec;
  document.querySelectorAll('.admin-tab').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
  document.querySelectorAll('.admin-section').forEach(s=>s.classList.remove('active'));
  document.getElementById('sec-'+sec).classList.add('active');
  document.querySelector('.admin-body')?.classList.add('admin-section-open');
  renderAdmin();
  document.getElementById('adminFab').style.display = (sec==='tables'||sec==='menu'||sec==='staff'||sec==='customers'||sec==='paymentMethods'||sec==='suppliers'||sec==='purchases') ? 'flex':'none';
  if (sec==='settings') {
    document.getElementById('currentKitchenPin').textContent = state.kitchenPin;
    db.ref('settings/menuUrl').once('value', snap => {
      if (snap.val()) document.getElementById('menuUrlInput').value = snap.val();
    });
    const sc = state.serviceCharge || {};
    document.getElementById('serviceChargeEnabled').checked = !!sc.enabled;
    document.getElementById('serviceChargePercent').value = sc.percent || '';
    db.ref('settings/loyalty').once('value', snap => {
      const l = snap.val() || {};
      document.getElementById('referralBonusAmount').value = l.referralBonusAmount || '';
      document.getElementById('referralMinOrderAmount').value = l.referralMinOrderAmount || '';
    });
  }
}

// Telefonda "ev ekranı" naviqasiyasında bölmə görünüşündən grid menyusuna qayıdır
export function adminGoBack() {
  document.querySelector('.admin-body')?.classList.remove('admin-section-open');
  document.getElementById('adminFab').style.display = 'none';
}

// ── Kateqoriya (tab) sırasını sürükləyib dəyişmək (məs. "Ayarlar"ı birinci etmək) ──
// Sıra brauzerin öz yaddaşında (localStorage) saxlanılır, hər admin öz sırasını seçə bilər.
const TAB_ORDER_KEY = 'qarson_adminTabOrder';

export function initAdminTabDragDrop() {
  const container = document.getElementById('adminTabsContainer');
  if (!container) return;
  let dragged = null;

  container.querySelectorAll('.admin-tab').forEach(tab => {
    tab.setAttribute('draggable', 'true');
    tab.addEventListener('dragstart', () => { dragged = tab; tab.classList.add('dragging'); });
    tab.addEventListener('dragend', () => {
      tab.classList.remove('dragging');
      container.querySelectorAll('.admin-tab').forEach(t=>t.classList.remove('drag-over'));
      dragged = null;
      saveAdminTabOrder();
    });
    tab.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!dragged || dragged === tab) return;
      container.querySelectorAll('.admin-tab').forEach(t=>t.classList.remove('drag-over'));
      tab.classList.add('drag-over');
      const rect = tab.getBoundingClientRect();
      const before = e.clientX < rect.left + rect.width / 2;
      container.insertBefore(dragged, before ? tab : tab.nextSibling);
    });
  });

  applySavedAdminTabOrder();
}

function saveAdminTabOrder() {
  const container = document.getElementById('adminTabsContainer');
  if (!container) return;
  const order = Array.from(container.querySelectorAll('.admin-tab')).map(t => t.dataset.section).filter(Boolean);
  try { localStorage.setItem(TAB_ORDER_KEY, JSON.stringify(order)); } catch(e) {}
}

function applySavedAdminTabOrder() {
  const container = document.getElementById('adminTabsContainer');
  if (!container) return;
  let saved;
  try { saved = JSON.parse(localStorage.getItem(TAB_ORDER_KEY) || 'null'); } catch(e) { saved = null; }
  if (!saved || !Array.isArray(saved)) return;
  const tabs = Array.from(container.querySelectorAll('.admin-tab'));
  const bySection = {};
  tabs.forEach(t => { if (t.dataset.section) bySection[t.dataset.section] = t; });
  saved.forEach(sectionId => { if (bySection[sectionId]) container.appendChild(bySection[sectionId]); });
  // Yadda saxlanmış sırada olmayan (yeni əlavə olunan) tablar sona əlavə olunur
  tabs.forEach(t => { if (t.dataset.section && !saved.includes(t.dataset.section)) container.appendChild(t); });
}

export function renderDashboard() {
  const activeStaff = state.staff.filter(s=>s.status!=='offline').length;
  const activeTbl = state.tables.filter(t=>t.occupant).length;
  const pendingO  = state.orders.filter(o=>o.status==='pending').length;
  document.getElementById('statsRow').innerHTML = `
    <div class="stat-card"><div class="stat-num">${state.staff.length}</div><div class="stat-label">Cəmi İşçi</div></div>
    <div class="stat-card"><div class="stat-num" style="color:var(--green)">${activeStaff}</div><div class="stat-label">Aktiv İşçi</div></div>
    <div class="stat-card"><div class="stat-num" style="color:var(--blue)">${state.tables.length}</div><div class="stat-label">Cəmi Masa</div></div>
    <div class="stat-card"><div class="stat-num" style="color:var(--orange)">${activeTbl}</div><div class="stat-label">Dolu Masa</div></div>
    <div class="stat-card"><div class="stat-num" style="color:var(--red)">${pendingO}</div><div class="stat-label">Gözləyən Sifariş</div></div>
  `;
  const bizHourEl = document.getElementById('repBizDayHour');
  if (bizHourEl && !bizHourEl.value) bizHourEl.value = String(state._bizDayStartHour||5).padStart(2,'0') + ':00';
  // Filtr sahələri hələ boşdursa (ilk açılış), defolt olaraq "gün sonu" aralığı tətbiq olunur
  const dateFromEl = document.getElementById('repDateFrom');
  if (dateFromEl && !dateFromEl.value) { setReportQuickRange('today'); }
  else { renderReports(); }
}

/* ═══════════════════════════════════════════
   HESABATLAR
═══════════════════════════════════════════ */

function localDateStr(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function hhmm(h) { return String(h).padStart(2,'0') + ':00'; }

export function setReportQuickRange(type) {
  const now = new Date();
  const bizHour = state._bizDayStartHour || 5;
  let dFrom, dTo;
  const tFrom = hhmm(bizHour), tTo = hhmm(bizHour);

  // Cari an hələ bugünkü "iş günü başlama saatı"na çatmayıbsa, indiki iş günü DÜNƏNDƏN
  // başlayır sayılır (məs. gecə saat 2-də "bugün" hələ DÜNƏNKİ iş günüdür)
  const bizToday = new Date(now);
  if (now.getHours() < bizHour) bizToday.setDate(bizToday.getDate() - 1);
  const bizTodayEnd = new Date(bizToday); bizTodayEnd.setDate(bizTodayEnd.getDate() + 1);

  if (type === 'today' || type === 'dayEnd') {
    dFrom = new Date(bizToday); dTo = new Date(bizTodayEnd);
  } else if (type === 'yesterday') {
    dFrom = new Date(bizToday); dFrom.setDate(dFrom.getDate() - 1);
    dTo = new Date(bizToday);
  } else if (type === 'week') {
    dFrom = new Date(bizToday);
    const day = (dFrom.getDay() + 6) % 7; // Bazar ertəsi = 0
    dFrom.setDate(dFrom.getDate() - day);
    dTo = new Date(bizTodayEnd);
  } else if (type === 'month') {
    dFrom = new Date(bizToday.getFullYear(), bizToday.getMonth(), 1);
    dTo = new Date(bizTodayEnd);
  } else if (type === 'lastMonth') {
    dFrom = new Date(bizToday.getFullYear(), bizToday.getMonth() - 1, 1);
    dTo = new Date(bizToday.getFullYear(), bizToday.getMonth(), 1);
  } else if (type === 'year') {
    dFrom = new Date(bizToday.getFullYear(), 0, 1);
    dTo = new Date(bizTodayEnd);
  } else if (type === 'monthEnd') {
    dFrom = new Date(bizToday.getFullYear(), bizToday.getMonth(), 1);
    dTo = new Date(bizToday.getFullYear(), bizToday.getMonth() + 1, 1);
  } else return;

  document.getElementById('repDateFrom').value = localDateStr(dFrom);
  document.getElementById('repDateTo').value = localDateStr(dTo);
  document.getElementById('repTimeFrom').value = tFrom;
  document.getElementById('repTimeTo').value = tTo;
  renderReports();
}

export function saveBizDayHour() {
  const val = document.getElementById('repBizDayHour')?.value || '05:00';
  const hour = parseInt(val.split(':')[0], 10) || 0;
  db.ref('settings/bizDayStartHour').set(hour);
  state._bizDayStartHour = hour;
  showToast('<svg class="icon"><use href="#i-check"></use></svg> İş günü başlama saatı yadda saxlanıldı');
}

export function setReportView(view) {
  state._reportView = view;
  document.querySelectorAll('.report-subtab').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  renderReports();
}

function getReportFilteredOrders() {
  const dateFrom = document.getElementById('repDateFrom')?.value || '';
  const dateTo = document.getElementById('repDateTo')?.value || '';
  const timeFrom = document.getElementById('repTimeFrom')?.value || '';
  const timeTo = document.getElementById('repTimeTo')?.value || '';
  return (state.closedOrders || []).filter(o => {
    // Hesabatlar SİFARİŞİN VERİLDİYİ vaxta görə aparılır, masanın BAĞLANDIĞI vaxta görə
    // YOX - saat 6-da açılıb 12-də bağlanan masa "12" yox "6" saatına aid sayılmalıdır.
    // Köhnə (bu sahə olmayan) qeydlər üçün closedAt-a geri dönür.
    const refTime = o.firstOrderAt || o.closedAt;
    if (dateFrom) {
      const b = new Date(dateFrom);
      if (timeFrom) { const [h,m] = timeFrom.split(':'); b.setHours(+h,+m,0,0); } else { b.setHours(0,0,0,0); }
      if (refTime < b.getTime()) return false;
    }
    if (dateTo) {
      const b = new Date(dateTo);
      if (timeTo) { const [h,m] = timeTo.split(':'); b.setHours(+h,+m,59,999); } else { b.setHours(23,59,59,999); }
      if (refTime > b.getTime()) return false;
    }
    return true;
  });
}

const resolvePaymentMethodName = (id) => id==='cash'?'Nağd':id==='pos'?'POS':((state.paymentMethods||[]).find(m=>m.id===id)?.name || 'Silinmiş növ');

function buildPaymentTypeBreakdown(orders) {
  const breakdown = {}; // label -> {amount, count}
  orders.forEach(o => {
    getOrderPayments(o).forEach(p => {
      if (p.type === 'split' && p.splitBreakdown) {
        Object.entries(p.splitBreakdown).forEach(([mid, amt]) => {
          const key = p.splitMethodNames?.[mid] || resolvePaymentMethodName(mid);
          if (!breakdown[key]) breakdown[key] = { amount: 0, count: 0 };
          breakdown[key].amount += amt || 0; breakdown[key].count++;
        });
      } else {
        const key = p.typeLabel || p.type;
        if (!breakdown[key]) breakdown[key] = { amount: 0, count: 0 };
        breakdown[key].amount += p.thisPay || 0; breakdown[key].count++;
      }
    });
  });
  return breakdown;
}

export function renderReports() {
  const el = document.getElementById('reportContent');
  if (!el) return;
  const orders = getReportFilteredOrders();
  const summaryEl = document.getElementById('reportRangeSummary');
  if (summaryEl) summaryEl.textContent = `${orders.length} əməliyyat tapıldı`;

  if (!orders.length) { el.innerHTML = '<p class="report-empty"><svg class="icon" style="width:28px;height:28px;"><use href="#i-clipboard"></use></svg><br>Seçilmiş tarix/saat aralığında əməliyyat tapılmadı.</p>'; return; }

  const view = state._reportView || 'summary';
  if (view === 'summary') renderReportSummaryView(orders, el);
  else if (view === 'payments') renderReportPaymentsView(orders, el);
  else if (view === 'staff') renderReportStaffView(orders, el);
  else if (view === 'items') renderReportItemsView(orders, el);
  else if (view === 'tables') renderReportTablesView(orders, el);
  else if (view === 'days') renderReportDaysView(orders, el);
  else if (view === 'hours') renderReportHoursView(orders, el);
  else if (view === 'discounts') renderReportDiscountsView(orders, el);
  else if (view === 'turnover') renderReportTurnoverView(orders, el);
  else if (view === 'loyalty') renderReportLoyaltyView(orders, el);
  else if (view === 'compare') renderReportCompareView(orders, el);
  else renderReportSummaryView(orders, el);
}

function renderReportSummaryView(orders, el) {
  const totalRevenue = orders.reduce((s,o)=>s+(o.total||0),0);
  let totalDiscount = 0, totalCompliment = 0, itemCount = 0;
  orders.forEach(o => {
    Object.values(o.items||{}).forEach(it => {
      itemCount += it.qty || 0;
      if (it.compliment) totalCompliment += (it.originalPrice||0)*it.qty + (it.originalExtraFee||0);
      else if (it.discountPercent > 0) totalDiscount += (it.price||0)*it.qty*(it.discountPercent/100);
    });
  });
  const avgCheck = orders.length ? totalRevenue/orders.length : 0;
  const breakdown = buildPaymentTypeBreakdown(orders);
  const entries = Object.entries(breakdown).sort((a,b)=>b[1].amount-a[1].amount);

  el.innerHTML = `
    <div class="ct-report__stats" style="margin-bottom:22px;">
      <div class="stat-card"><div class="stat-num" style="color:var(--green);">${totalRevenue.toFixed(2)} ₼</div><div class="stat-label">Ümumi dövriyyə</div></div>
      <div class="stat-card"><div class="stat-num">${orders.length}</div><div class="stat-label">Bağlanan masa</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--blue);">${avgCheck.toFixed(2)} ₼</div><div class="stat-label">Orta çek</div></div>
      <div class="stat-card"><div class="stat-num">${itemCount}</div><div class="stat-label">Satılan mal (ədəd)</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--orange);">${totalDiscount.toFixed(2)} ₼</div><div class="stat-label">Verilən endirim</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--purple);">${totalCompliment.toFixed(2)} ₼</div><div class="stat-label">İkram dəyəri</div></div>
    </div>
    <div class="report-section-title"><svg class="icon"><use href="#i-money"></use></svg> Ödəniş növünə görə bölgü</div>
    <table class="report-table">
      <thead><tr><th>Növ</th><th class="num">Məbləğ</th><th class="num">Pay</th></tr></thead>
      <tbody>
        ${entries.length ? entries.map(([label,v]) => `<tr><td>${esc(label)}</td><td class="num">${v.amount.toFixed(2)} ₼</td><td class="num">${totalRevenue?((v.amount/totalRevenue)*100).toFixed(1):0}%</td></tr>`).join('')
          : '<tr><td colspan="3" style="text-align:center;color:var(--text3);">Ödəniş qeydi yoxdur</td></tr>'}
      </tbody>
    </table>
  `;
}

function renderReportPaymentsView(orders, el) {
  const breakdown = buildPaymentTypeBreakdown(orders);
  const entries = Object.entries(breakdown).sort((a,b)=>b[1].amount-a[1].amount);
  if (!entries.length) { el.innerHTML = '<p class="report-empty">Bu aralıqda ödəniş qeydi tapılmadı.</p>'; return; }
  const total = entries.reduce((s,[,v])=>s+v.amount,0);
  const maxAmt = Math.max(...entries.map(([,v])=>v.amount), 1);
  el.innerHTML = `
    <div class="report-bar-chart">
      ${entries.map(([label,v]) => `
        <div class="report-bar-chart__col">
          <span class="report-bar-chart__val">${v.amount.toFixed(0)}₼</span>
          <div class="report-bar-chart__bar" style="height:${Math.max(4,(v.amount/maxAmt)*130)}px;"></div>
          <span class="report-bar-chart__label">${esc(label)}</span>
        </div>`).join('')}
    </div>
    <table class="report-table" style="margin-top:18px;">
      <thead><tr><th>Ödəniş növü</th><th class="num">Sayı</th><th class="num">Məbləğ</th><th class="num">Pay</th></tr></thead>
      <tbody>${entries.map(([label,v]) => `<tr><td>${esc(label)}</td><td class="num">${v.count}</td><td class="num">${v.amount.toFixed(2)} ₼</td><td class="num">${total?((v.amount/total)*100).toFixed(1):0}%</td></tr>`).join('')}</tbody>
    </table>
  `;
}

function renderReportStaffView(orders, el) {
  const byStaff = {};
  orders.forEach(o => {
    // Sifarişi göndərən (satışı edən) işçiyə görə hesablanır - masanı bağlayan işçiyə görə
    // YOX, çünki başqa işçi bağlaya bilər. Köhnə qeydlərdə bu sahə yoxdursa, bağlayan işçiyə düşür.
    const name = o.orderedByName || o.staffName || 'Naməlum';
    if (!byStaff[name]) byStaff[name] = { count: 0, revenue: 0 };
    byStaff[name].count++; byStaff[name].revenue += o.total || 0;
  });
  const entries = Object.entries(byStaff).sort((a,b)=>b[1].revenue-a[1].revenue);
  el.innerHTML = `
    <div class="report-section-title"><svg class="icon"><use href="#i-staff"></use></svg> Sifarişi göndərən işçiyə görə (satış performansı)</div>
    <table class="report-table">
      <thead><tr><th>İşçi</th><th class="num">Sifariş verilən masa</th><th class="num">Dövriyyə</th><th class="num">Orta çek</th></tr></thead>
      <tbody>${entries.map(([name,v],i) => `<tr class="${i===0?'report-table__top':''}"><td>${esc(name)}</td><td class="num">${v.count}</td><td class="num">${v.revenue.toFixed(2)} ₼</td><td class="num">${(v.revenue/v.count).toFixed(2)} ₼</td></tr>`).join('')}</tbody>
    </table>
  `;
}

function renderReportItemsView(orders, el) {
  const byItem = {};
  orders.forEach(o => {
    Object.values(o.items||{}).forEach(it => {
      if (!byItem[it.name]) byItem[it.name] = { qty: 0, revenue: 0 };
      byItem[it.name].qty += it.qty || 0;
      byItem[it.name].revenue += (it.price||0)*it.qty*(1-((it.discountPercent||0)/100)) + (it.extraFee||0);
    });
  });
  const itemEntries = Object.entries(byItem).sort((a,b)=>b[1].revenue-a[1].revenue);
  const byCategory = {};
  itemEntries.forEach(([name,v]) => {
    const cat = state.menuItems.find(m=>m.name===name)?.category || 'Digər';
    if (!byCategory[cat]) byCategory[cat] = { qty: 0, revenue: 0 };
    byCategory[cat].qty += v.qty; byCategory[cat].revenue += v.revenue;
  });
  const catEntries = Object.entries(byCategory).sort((a,b)=>b[1].revenue-a[1].revenue);

  el.innerHTML = `
    <div class="report-section-title"><svg class="icon"><use href="#i-tag"></use></svg> Kateqoriyaya görə satış</div>
    <table class="report-table">
      <thead><tr><th>Kateqoriya</th><th class="num">Ədəd</th><th class="num">Dövriyyə</th></tr></thead>
      <tbody>${catEntries.map(([c,v]) => `<tr><td>${esc(c)}</td><td class="num">${v.qty}</td><td class="num">${v.revenue.toFixed(2)} ₼</td></tr>`).join('')}</tbody>
    </table>
    <div class="report-section-title"><svg class="icon"><use href="#i-food"></use></svg> Ən çox satılan mallar</div>
    <table class="report-table">
      <thead><tr><th>Mal</th><th class="num">Ədəd</th><th class="num">Dövriyyə</th></tr></thead>
      <tbody>${itemEntries.map(([name,v],i) => `<tr class="${i<3?'report-table__top':''}"><td>${esc(name)}</td><td class="num">${v.qty}</td><td class="num">${v.revenue.toFixed(2)} ₼</td></tr>`).join('')}</tbody>
    </table>
  `;
}

function renderReportTablesView(orders, el) {
  const byTable = {};
  orders.forEach(o => {
    const name = (o.tableName || '?').replace(/\s*\*+$/, '');
    if (!byTable[name]) byTable[name] = { count: 0, revenue: 0 };
    byTable[name].count++; byTable[name].revenue += o.total || 0;
  });
  const entries = Object.entries(byTable).sort((a,b)=>b[1].revenue-a[1].revenue);
  el.innerHTML = `
    <div class="report-section-title"><svg class="icon"><use href="#i-chair"></use></svg> Masalara görə dövriyyə</div>
    <table class="report-table">
      <thead><tr><th>Masa</th><th class="num">Neçə dəfə bağlanıb</th><th class="num">Dövriyyə</th><th class="num">Orta</th></tr></thead>
      <tbody>${entries.map(([name,v],i) => `<tr class="${i===0?'report-table__top':''}"><td>${esc(name)}</td><td class="num">${v.count}</td><td class="num">${v.revenue.toFixed(2)} ₼</td><td class="num">${(v.revenue/v.count).toFixed(2)} ₼</td></tr>`).join('')}</tbody>
    </table>
  `;
}

function renderReportDaysView(orders, el) {
  const byDay = {};
  orders.forEach(o => {
    const refTime = o.firstOrderAt || o.closedAt;
    const d = new Date(refTime).toLocaleDateString('az-AZ');
    if (!byDay[d]) byDay[d] = { count: 0, revenue: 0, ts: refTime };
    byDay[d].count++; byDay[d].revenue += o.total || 0;
  });
  const entries = Object.entries(byDay).sort((a,b)=>a[1].ts-b[1].ts);
  const maxRev = Math.max(...entries.map(([,v])=>v.revenue), 1);
  el.innerHTML = `
    <div class="report-section-title"><svg class="icon"><use href="#i-clipboard"></use></svg> Günlərə görə dövriyyə</div>
    <div class="report-bar-chart">
      ${entries.map(([day,v]) => `<div class="report-bar-chart__col"><span class="report-bar-chart__val">${v.revenue.toFixed(0)}₼</span><div class="report-bar-chart__bar" style="height:${Math.max(4,(v.revenue/maxRev)*130)}px;"></div><span class="report-bar-chart__label">${esc(day)}</span></div>`).join('')}
    </div>
    <table class="report-table" style="margin-top:18px;">
      <thead><tr><th>Tarix</th><th class="num">Masa sayı</th><th class="num">Dövriyyə</th><th class="num">Orta çek</th></tr></thead>
      <tbody>${entries.slice().reverse().map(([day,v]) => `<tr><td>${esc(day)}</td><td class="num">${v.count}</td><td class="num">${v.revenue.toFixed(2)} ₼</td><td class="num">${(v.revenue/v.count).toFixed(2)} ₼</td></tr>`).join('')}</tbody>
    </table>
  `;
}

function renderReportHoursView(orders, el) {
  const byHour = {};
  for (let h=0; h<24; h++) byHour[h] = { count: 0, revenue: 0 };
  orders.forEach(o => {
    const h = new Date(o.firstOrderAt || o.closedAt).getHours();
    byHour[h].count++; byHour[h].revenue += o.total || 0;
  });
  const entries = Object.entries(byHour).map(([h,v]) => [parseInt(h,10), v]);
  const maxRev = Math.max(...entries.map(([,v])=>v.revenue), 1);
  el.innerHTML = `
    <div class="report-section-title"><svg class="icon"><use href="#i-clock"></use></svg> Saatlara görə dövriyyə (ən yığcam saatları göstərir)</div>
    <div class="report-bar-chart">
      ${entries.map(([h,v]) => `<div class="report-bar-chart__col"><span class="report-bar-chart__val">${v.revenue>0?v.revenue.toFixed(0)+'₼':''}</span><div class="report-bar-chart__bar" style="height:${Math.max(2,(v.revenue/maxRev)*130)}px;"></div><span class="report-bar-chart__label">${String(h).padStart(2,'0')}</span></div>`).join('')}
    </div>
    <table class="report-table" style="margin-top:18px;">
      <thead><tr><th>Saat aralığı</th><th class="num">Masa sayı</th><th class="num">Dövriyyə</th></tr></thead>
      <tbody>${entries.filter(([,v])=>v.count>0).map(([h,v]) => `<tr><td>${String(h).padStart(2,'0')}:00 – ${String(h).padStart(2,'0')}:59</td><td class="num">${v.count}</td><td class="num">${v.revenue.toFixed(2)} ₼</td></tr>`).join('')}</tbody>
    </table>
  `;
}

function renderReportDiscountsView(orders, el) {
  let totalDiscount = 0, totalCompliment = 0;
  const byStaff = {};
  orders.forEach(o => {
    let orderDiscount = 0, orderCompliment = 0;
    Object.values(o.items||{}).forEach(it => {
      if (it.compliment) orderCompliment += (it.originalPrice||0)*it.qty + (it.originalExtraFee||0);
      else if (it.discountPercent > 0) orderDiscount += (it.price||0)*it.qty*(it.discountPercent/100);
    });
    if (orderDiscount > 0 || orderCompliment > 0) {
      const name = o.staffName || 'Naməlum';
      if (!byStaff[name]) byStaff[name] = { discount: 0, compliment: 0, count: 0 };
      byStaff[name].discount += orderDiscount;
      byStaff[name].compliment += orderCompliment;
      byStaff[name].count++;
    }
    totalDiscount += orderDiscount;
    totalCompliment += orderCompliment;
  });
  const entries = Object.entries(byStaff).sort((a,b)=>(b[1].discount+b[1].compliment)-(a[1].discount+a[1].compliment));
  el.innerHTML = `
    <div class="ct-report__stats" style="margin-bottom:20px;">
      <div class="stat-card"><div class="stat-num" style="color:var(--orange);">${totalDiscount.toFixed(2)} ₼</div><div class="stat-label">Verilən endirim</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--purple);">${totalCompliment.toFixed(2)} ₼</div><div class="stat-label">İkram dəyəri</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--red);">${(totalDiscount+totalCompliment).toFixed(2)} ₼</div><div class="stat-label">Cəmi</div></div>
    </div>
    <p style="font-size:12px;color:var(--text3);margin-bottom:12px;">Bölgü masanı bağlayan işçiyə görədir (təxmini - endirimi başqa işçi tətbiq etmiş ola bilər).</p>
    <div class="report-section-title"><svg class="icon"><use href="#i-tag"></use></svg> İşçiyə görə</div>
    <table class="report-table">
      <thead><tr><th>İşçi</th><th class="num">Endirim</th><th class="num">İkram</th><th class="num">Masa sayı</th></tr></thead>
      <tbody>${entries.length ? entries.map(([name,v]) => `<tr><td>${esc(name)}</td><td class="num">${v.discount.toFixed(2)} ₼</td><td class="num">${v.compliment.toFixed(2)} ₼</td><td class="num">${v.count}</td></tr>`).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--text3);">Bu aralıqda endirim/ikram yoxdur</td></tr>'}</tbody>
    </table>
  `;
}

function renderReportTurnoverView(orders, el) {
  const withDuration = orders.filter(o => o.firstOrderAt && o.closedAt && o.closedAt > o.firstOrderAt).map(o => ({
    ...o, durationMin: (o.closedAt - o.firstOrderAt) / 60000
  }));
  if (!withDuration.length) { el.innerHTML = '<p class="report-empty">Hesablamaq üçün kifayət qədər məlumat yoxdur (köhnə qeydlərdə sifariş vaxtı saxlanılmayıb).</p>'; return; }
  const avgDuration = withDuration.reduce((s,o)=>s+o.durationMin,0) / withDuration.length;
  const byTable = {};
  withDuration.forEach(o => {
    const name = (o.tableName||'?').replace(/\s*\*+$/,'');
    if (!byTable[name]) byTable[name] = { totalMin: 0, count: 0 };
    byTable[name].totalMin += o.durationMin; byTable[name].count++;
  });
  const entries = Object.entries(byTable).map(([name,v]) => [name, v.totalMin/v.count, v.count]).sort((a,b)=>b[1]-a[1]);
  const fmtDuration = (min) => min >= 60 ? `${Math.floor(min/60)} saat ${Math.round(min%60)} dəq` : `${Math.round(min)} dəq`;
  el.innerHTML = `
    <div class="ct-report__stats" style="margin-bottom:20px;">
      <div class="stat-card"><div class="stat-num" style="color:var(--blue);">${fmtDuration(avgDuration)}</div><div class="stat-label">Orta oturma müddəti</div></div>
      <div class="stat-card"><div class="stat-num">${withDuration.length}</div><div class="stat-label">Hesablanan sessiya</div></div>
    </div>
    <div class="report-section-title"><svg class="icon"><use href="#i-chair"></use></svg> Masaya görə orta oturma müddəti</div>
    <table class="report-table">
      <thead><tr><th>Masa</th><th class="num">Orta müddət</th><th class="num">Sessiya sayı</th></tr></thead>
      <tbody>${entries.map(([name,avgMin,count]) => `<tr><td>${esc(name)}</td><td class="num">${fmtDuration(avgMin)}</td><td class="num">${count}</td></tr>`).join('')}</tbody>
    </table>
  `;
}

function renderReportLoyaltyView(orders, el) {
  const dateFrom = document.getElementById('repDateFrom')?.value || '';
  const dateTo = document.getElementById('repDateTo')?.value || '';
  const timeFrom = document.getElementById('repTimeFrom')?.value || '';
  const timeTo = document.getElementById('repTimeTo')?.value || '';
  const inRange = (ts) => {
    if (!ts) return false;
    if (dateFrom) { const b = new Date(dateFrom); if (timeFrom) { const [h,m]=timeFrom.split(':'); b.setHours(+h,+m,0,0);} else b.setHours(0,0,0,0); if (ts < b.getTime()) return false; }
    if (dateTo) { const b = new Date(dateTo); if (timeTo) { const [h,m]=timeTo.split(':'); b.setHours(+h,+m,59,999);} else b.setHours(23,59,59,999); if (ts > b.getTime()) return false; }
    return true;
  };
  const newCustomers = (state.loyaltyCustomers||[]).filter(c => inRange(c.registrationDate));
  const totalCustomers = (state.loyaltyCustomers||[]).length;
  const totalBonusIssued = (state.loyaltyCustomers||[]).reduce((s,c)=>s+(c.bonus||0),0);

  db.ref('referrals').once('value', snap => {
    const allReferrals = toArr(snap.val());
    const referralsInRange = allReferrals.filter(r => inRange(r.createdAt));
    const completedInRange = referralsInRange.filter(r=>r.status==='completed');

    el.innerHTML = `
      <div class="ct-report__stats" style="margin-bottom:20px;">
        <div class="stat-card"><div class="stat-num" style="color:var(--green);">${newCustomers.length}</div><div class="stat-label">Yeni qeydiyyat</div></div>
        <div class="stat-card"><div class="stat-num">${totalCustomers}</div><div class="stat-label">Ümumi qeydiyyatlı</div></div>
        <div class="stat-card"><div class="stat-num" style="color:var(--gold-dark);">${totalBonusIssued}</div><div class="stat-label">Ümumi bonus (bal)</div></div>
        <div class="stat-card"><div class="stat-num" style="color:var(--blue);">${referralsInRange.length}</div><div class="stat-label">Dəvət (bu aralıqda)</div></div>
        <div class="stat-card"><div class="stat-num" style="color:var(--purple);">${completedInRange.length}</div><div class="stat-label">Tamamlanan dəvət</div></div>
      </div>
      <p style="font-size:12px;color:var(--text3);">Qeydiyyat/dəvət sayları seçilmiş tarix aralığına görə hesablanır.</p>
    `;
  });
}

function renderReportCompareView(orders, el) {
  const dateFrom = document.getElementById('repDateFrom')?.value;
  const dateTo = document.getElementById('repDateTo')?.value;
  if (!dateFrom || !dateTo) { el.innerHTML = '<p class="report-empty">Müqayisə üçün tarix aralığı seçin.</p>'; return; }
  const timeFrom = document.getElementById('repTimeFrom')?.value || '';
  const timeTo = document.getElementById('repTimeTo')?.value || '';

  const from = new Date(dateFrom); if(timeFrom){const [h,m]=timeFrom.split(':');from.setHours(+h,+m,0,0);}else from.setHours(0,0,0,0);
  const to = new Date(dateTo); if(timeTo){const [h,m]=timeTo.split(':');to.setHours(+h,+m,59,999);}else to.setHours(23,59,59,999);
  const durationMs = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(from.getTime() - durationMs);

  const prevOrders = (state.closedOrders||[]).filter(o => {
    const refTime = o.firstOrderAt || o.closedAt;
    return refTime >= prevFrom.getTime() && refTime <= prevTo.getTime();
  });

  const curRevenue = orders.reduce((s,o)=>s+(o.total||0),0);
  const prevRevenue = prevOrders.reduce((s,o)=>s+(o.total||0),0);
  const curCount = orders.length, prevCount = prevOrders.length;
  const curAvg = curCount ? curRevenue/curCount : 0, prevAvg = prevCount ? prevRevenue/prevCount : 0;

  const pctChange = (cur, prev) => prev === 0 ? (cur>0?100:0) : ((cur-prev)/prev*100);
  const fmtChange = (pct) => `<span style="color:${pct>=0?'var(--green)':'var(--red)'};font-weight:700;">${pct>=0?'+':''}${pct.toFixed(1)}%</span>`;

  el.innerHTML = `
    <p style="font-size:12.5px;color:var(--text3);margin-bottom:16px;">Cari aralıq eyni uzunluqda, ondan bilavasitə əvvəlki dövrlə müqayisə olunur.</p>
    <table class="report-table">
      <thead><tr><th>Göstərici</th><th class="num">Əvvəlki dövr</th><th class="num">Cari dövr</th><th class="num">Dəyişiklik</th></tr></thead>
      <tbody>
        <tr><td>Dövriyyə</td><td class="num">${prevRevenue.toFixed(2)} ₼</td><td class="num">${curRevenue.toFixed(2)} ₼</td><td class="num">${fmtChange(pctChange(curRevenue,prevRevenue))}</td></tr>
        <tr><td>Bağlanan masa</td><td class="num">${prevCount}</td><td class="num">${curCount}</td><td class="num">${fmtChange(pctChange(curCount,prevCount))}</td></tr>
        <tr><td>Orta çek</td><td class="num">${prevAvg.toFixed(2)} ₼</td><td class="num">${curAvg.toFixed(2)} ₼</td><td class="num">${fmtChange(pctChange(curAvg,prevAvg))}</td></tr>
      </tbody>
    </table>
  `;
}

export function adminEditTableNote(tableId) {
  const t = state.tables.find(x=>x.id===tableId);
  if (!t) return;
  state.noteTableId = tableId;
  document.getElementById('adminNoteTitle').innerHTML = '<svg class="icon"><use href="#i-note"></use></svg> ' + t.name + ' — Qeyd';
  document.getElementById('adminNoteText').value = t.notes || '';
  document.getElementById('adminNoteModal').classList.add('open');
}

export function saveAdminNote() {
  if (!state.noteTableId) return;
  const notes = document.getElementById('adminNoteText').value;
  R.tables.child(state.noteTableId).update({ notes });
  addLog('admin','Admin "' + (state.tables.find(x=>x.id===state.noteTableId)||{name:'?'}).name + '" masasına qeyd əlavə etdi',{});
  closeAdminNoteModal();
  showToast('<svg class="icon"><use href="#i-check"></use></svg> Qeyd saxlanıldı');
}

export function closeAdminNoteModal() {
  document.getElementById('adminNoteModal').classList.remove('open');
  state.noteTableId = null;
}

export function adminCloseTable(tableId) {
  const t = state.tables.find(x=>x.id===tableId);
  if (!t) return;
  state.pendingCloseTableId = tableId;
  addLog('table', `Admin "${t.name}" masasını bağlamaq istədi`, { tableId });
  document.getElementById('confirmCloseTableName').textContent = t.name;
  document.getElementById('confirmCloseTableModal').classList.remove('open');
  void document.getElementById('confirmCloseTableModal').offsetWidth;
  document.getElementById('confirmCloseTableModal').classList.add('open');
}

export function renderFeedbackSection() {
  const el = document.getElementById('feedbackList');
  if (!el) return;

  db.ref('customerRequests').orderByChild('status').equalTo('pending').once('value', snap => {
    const reqData = snap.val() || {};
    const reqs = Object.keys(reqData).map(k=>({id:k,...reqData[k]}));
    const reqColors = { call:'#f1c40f', bill_cash:'#2ecc71', bill_pos:'#3498db', message:'#e67e22' };
    const reqIcons  = { call:'<svg class="icon"><use href="#i-bell"></use></svg>', bill_cash:'<svg class="icon"><use href="#i-cash"></use></svg>', bill_pos:'<svg class="icon"><use href="#i-card"></use></svg>', message:'<svg class="icon"><use href="#i-chat"></use></svg>' };

    let html = '';
    state._selectedRequestIds = (state._selectedRequestIds||[]).filter(id => reqs.some(r=>r.id===id));
    if (reqs.length) {
      const allReqChecked = reqs.length>0 && reqs.every(r=>state._selectedRequestIds.includes(r.id));
      html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <label style="display:flex;align-items:center;gap:8px;color:var(--orange);font-size:12px;font-weight:700;text-transform:uppercase;cursor:pointer;">
          <input type="checkbox" onchange="toggleSelectAllRequests(this.checked)" ${allReqChecked?'checked':''} style="width:16px;height:16px;cursor:pointer;">
          <svg class="icon"><use href="#i-bolt"></use></svg> Aktiv Tələblər
        </label>
        <button id="requestDeleteSelectedBtn" class="btn btn-red" style="display:${state._selectedRequestIds.length?'inline-flex':'none'};padding:5px 12px;font-size:11px;" onclick="deleteSelectedRequests()"><svg class="icon"><use href="#i-trash"></use></svg> Seçilənləri Sil (${state._selectedRequestIds.length})</button>
      </div>`;
      html += reqs.map(r=>`
        <div class="log-item" style="border-left:3px solid ${reqColors[r.type]||'#aaa'};margin-bottom:6px;">
          <input type="checkbox" onchange="toggleRequestSelect('${r.id}')" ${state._selectedRequestIds.includes(r.id)?'checked':''} style="width:16px;height:16px;flex-shrink:0;margin-top:2px;cursor:pointer;">
          <span class="log-badge" style="background:${reqColors[r.type]||'#aaa'}22;color:${reqColors[r.type]||'#aaa'}">${reqIcons[r.type]||'<svg class="icon"><use href="#i-clipboard"></use></svg>'} ${esc(r.tableName||'')}</span>
          <span class="log-text">${esc(r.message||'')}</span>
          <span class="log-time">${r.time||''}</span>
        </div>
      `).join('');
    }

    const feedbacks = state._feedbacks || [];
    state._selectedFeedbackIds = (state._selectedFeedbackIds||[]).filter(id => feedbacks.some(f=>f.id===id));
    if (feedbacks.length) {
      const allFbChecked = feedbacks.length>0 && feedbacks.every(f=>state._selectedFeedbackIds.includes(f.id));
      html += `<div style="display:flex;justify-content:space-between;align-items:center;margin:14px 0 8px;">
        <label style="display:flex;align-items:center;gap:8px;color:var(--text2);font-size:12px;font-weight:700;text-transform:uppercase;cursor:pointer;margin:0;">
          <input type="checkbox" onchange="toggleSelectAllFeedbacks(this.checked)" ${allFbChecked?'checked':''} style="width:16px;height:16px;cursor:pointer;">
          <svg class="icon"><use href="#i-note"></use></svg> Şikayət / Təkliflər
        </label>
        <button id="feedbackDeleteSelectedBtn" class="btn btn-red" style="display:${state._selectedFeedbackIds.length?'inline-flex':'none'};padding:5px 12px;font-size:11px;" onclick="deleteSelectedFeedbacks()"><svg class="icon"><use href="#i-trash"></use></svg> Seçilənləri Sil (${state._selectedFeedbackIds.length})</button>
      </div>`;
      html += feedbacks.map(f=>`
        <div class="log-item" style="margin-bottom:6px;">
          <input type="checkbox" onchange="toggleFeedbackSelect('${f.id}')" ${state._selectedFeedbackIds.includes(f.id)?'checked':''} style="width:16px;height:16px;flex-shrink:0;margin-top:2px;cursor:pointer;">
          <span class="log-badge" style="background:#2ecc7122;color:#2ecc71"><svg class="icon"><use href="#i-note"></use></svg> ${esc(f.tableName||'')}</span>
          <span class="log-text">${esc(f.message)}</span>
          <span class="log-time">${f.time} ${f.date||''}</span>
        </div>
      `).join('');
    }

    if (!html) html='<p style="color:var(--text3);padding:16px;">Hələ tələb/şikayət yoxdur.</p>';
    el.innerHTML = html;
  });
}

export function toggleRequestSelect(id) {
  state._selectedRequestIds = state._selectedRequestIds || [];
  const i = state._selectedRequestIds.indexOf(id);
  if (i === -1) state._selectedRequestIds.push(id); else state._selectedRequestIds.splice(i,1);
  const btn = document.getElementById('requestDeleteSelectedBtn');
  if (btn) {
    btn.style.display = state._selectedRequestIds.length ? 'inline-flex' : 'none';
    btn.innerHTML = `<svg class="icon"><use href="#i-trash"></use></svg> Seçilənləri Sil (${state._selectedRequestIds.length})`;
  }
}

export function toggleSelectAllRequests(checked) {
  db.ref('customerRequests').orderByChild('status').equalTo('pending').once('value', snap => {
    const ids = Object.keys(snap.val() || {});
    state._selectedRequestIds = checked ? ids : [];
    renderFeedbackSection();
  });
}

export function deleteSelectedRequests() {
  const ids = state._selectedRequestIds || [];
  if (!ids.length) return;
  confirmDelete2x(ids.length, 'tələb', () => {
    ids.forEach(id => db.ref('customerRequests/' + id).remove());
    addLog('admin', `Admin ${ids.length} müştəri tələbini seçib sildi`, {});
    showToast(`<svg class="icon"><use href="#i-check"></use></svg> ${ids.length} tələb silindi`);
    state._selectedRequestIds = [];
    renderFeedbackSection();
  });
}

export function toggleSelectAllFeedbacks(checked) {
  state._selectedFeedbackIds = checked ? (state._feedbacks||[]).map(f=>f.id) : [];
  renderFeedbackSection();
}

export function toggleFeedbackSelect(id) {
  state._selectedFeedbackIds = state._selectedFeedbackIds || [];
  const i = state._selectedFeedbackIds.indexOf(id);
  if (i === -1) state._selectedFeedbackIds.push(id); else state._selectedFeedbackIds.splice(i,1);
  const btn = document.getElementById('feedbackDeleteSelectedBtn');
  if (btn) {
    btn.style.display = state._selectedFeedbackIds.length ? 'inline-flex' : 'none';
    btn.innerHTML = `<svg class="icon"><use href="#i-trash"></use></svg> Seçilənləri Sil (${state._selectedFeedbackIds.length})`;
  }
}

export function deleteSelectedFeedbacks() {
  const ids = state._selectedFeedbackIds || [];
  if (!ids.length) return;
  confirmDelete2x(ids.length, 'şikayət', () => {
    ids.forEach(id => db.ref('feedbacks/' + id).remove());
    addLog('admin', `Admin ${ids.length} şikayəti seçib sildi`, {});
    showToast(`<svg class="icon"><use href="#i-check"></use></svg> ${ids.length} şikayət silindi`);
    state._selectedFeedbackIds = [];
    renderFeedbackSection();
  });
}

export function clearOldFeedbacks() {
  confirmAction('30 gündən köhnə bütün şikayətlər silinsin?', () => {
    const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
    db.ref('feedbacks').once('value', snap => {
      const data = snap.val() || {};
      let deletedCount = 0;
      Object.keys(data).forEach(key => {
        if (data[key].createdAt < cutoff) {
          db.ref('feedbacks/' + key).remove();
          deletedCount++;
        }
      });
      addLog('admin', `${deletedCount} köhnə şikayət silindi`, {});
      showToast(`<svg class="icon"><use href="#i-check"></use></svg> ${deletedCount} şikayət silindi`);
    });
  });
}

export function renderMenuItems() {
  const el    = document.getElementById('menuGrid');
  const tabEl = document.getElementById('menuCatTabs');
  if (!state.menuItems.length) {
    el.innerHTML  = '<p style="color:var(--text3);">Hələ mal əlavə edilməyib.</p>';
    tabEl.innerHTML = '';
    return;
  }

  const cats = ['all', ...new Set(state.menuItems.map(m => m.category || 'Digər'))];

  tabEl.innerHTML = cats.map(c => `
    <button onclick="setMenuCat('${esc(c)}')"
      style="padding:8px 18px;border-radius:20px;border:1px solid var(--border);
             background:${state._menuCatFilter===c?'var(--brand-gradient)':'transparent'};
             color:${state._menuCatFilter===c?'white':'var(--text2)'};
             font-weight:600;font-size:13px;cursor:pointer;">
      ${c === 'all' ? '<svg class="icon"><use href="#i-food"></use></svg> Hamısı' : esc(c)}
    </button>
  `).join('');

  const filtered = state._menuCatFilter === 'all'
    ? state.menuItems
    : state.menuItems.filter(m => (m.category || 'Digər') === state._menuCatFilter);

  if (!filtered.length) {
    el.innerHTML = '<p style="color:var(--text3);">Bu kateqoriyada mal yoxdur.</p>';
    return;
  }

  el.innerHTML = filtered.map(m => {
    const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(m.name)}&background=f39c12&color=fff&size=200`;
    const available = m.available !== false;
    return `<div class="tile-card" onclick="selectMenuItem('${m.id}')">
      <div class="tile-card__icon"><img src="${m.photo || fallback}" alt="" onerror="this.src='${fallback}'" style="${!available?'opacity:.4;':''}"></div>
      <div class="tile-card__name">${esc(m.name)}</div>
      <div class="tile-card__meta">${Number(m.price||0).toFixed(2)} ₼</div>
      <span class="status-badge ${available?'badge-green':'badge-red'} tile-card__badge">${available?'Var':'Tükənib'}</span>
    </div>`;
  }).join('');

  if (state._selectedMenuItemId) {
    const m = filtered.find(x => x.id === state._selectedMenuItemId);
    if (m) renderMenuItemDetail(m); else selectMenuItem(null);
  }
}

export function selectMenuItem(id) {
  state._selectedMenuItemId = id;
  const overlay = document.getElementById('menuDetailPanel');
  if (!id) { overlay?.classList.remove('open'); return; }
  const m = state.menuItems.find(x => x.id === id);
  if (!m) { overlay?.classList.remove('open'); return; }
  renderMenuItemDetail(m);
  overlay?.classList.add('open');
}

function renderMenuItemDetail(m) {
  const el = document.getElementById('menuDetailBody');
  if (!el || !m) return;
  const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(m.name)}&background=f39c12&color=fff&size=200`;
  const available = m.available !== false;
  el.innerHTML = `
    <div style="text-align:center;margin-bottom:14px;">
      <img src="${m.photo || fallback}" alt="" onerror="this.src='${fallback}'" style="width:96px;height:96px;border-radius:16px;object-fit:cover;${!available?'opacity:.4;':''}">
    </div>
    <div class="ct-detail-header" style="justify-content:center;text-align:center;flex-direction:column;gap:6px;">
      <span style="font-size:19px;"><svg class="icon"><use href="#i-food"></use></svg> ${esc(m.name)}</span>
      <span style="font-size:22px;font-weight:800;color:var(--orange);">${Number(m.price||0).toFixed(2)} ₼</span>
    </div>
    <div class="ct-detail-info-grid">
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Kateqoriya</div><div class="ct-detail-info-block__value">${esc(m.category||'Digər')}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Status</div><div class="ct-detail-info-block__value" style="color:${available?'var(--green)':'var(--red)'};">${available?'Satışdadır':'Tükənib'}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Sayıla bilən</div><div class="ct-detail-info-block__value">${m.isTrackable?'Bəli':'Xeyr'}</div></div>
      ${(m.stock !== undefined && m.stock !== null) ? `<div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Anbar qalığı</div><div class="ct-detail-info-block__value" style="color:var(--blue);">${m.stock}</div></div>` : ''}
    </div>
    ${m.description ? `<div class="ct-detail-section-title">Təsvir</div><p style="font-size:13px;color:var(--text2);">${esc(m.description)}</p>` : ''}
    <div class="ct-detail-actions" style="flex-wrap:wrap;">
      ${!m.isTrackable ? `<button class="btn" style="flex:1;padding:11px;border:1px solid var(--blue);color:var(--blue);" onclick="openQuickStockModal('${m.id}')"><svg class="icon"><use href="#i-check"></use></svg> Stok Artır</button>` : ''}
      <button class="btn ${available?'btn-red':'btn-green'}" style="flex:1;padding:11px;" onclick="toggleMenuItemAvailability('${m.id}')">${available?'Tükəndi Et':'Yenidən Var Et'}</button>
      <button class="btn btn-blue" style="flex:1;padding:11px;" onclick="editMenuItem('${m.id}')"><svg class="icon"><use href="#i-tag"></use></svg> Redaktə Et</button>
      <button class="btn btn-red" style="flex:1;padding:11px;" onclick="deleteMenuItem('${m.id}')"><svg class="icon"><use href="#i-trash"></use></svg> Sil</button>
    </div>
  `;
}

export function setMenuCat(cat) {
  state._menuCatFilter = cat;
  renderMenuItems();
}

export function openQuickStockModal(id) {
  const m = state.menuItems.find(x=>x.id===id);
  if (!m) return;
  document.getElementById('quickStockModal').dataset.menuItemId = id;
  document.getElementById('quickStockTitle').innerHTML = `<svg class="icon"><use href="#i-tag"></use></svg> ${esc(m.name)}`;
  document.getElementById('quickStockCurrentInfo').textContent = `Hazırkı anbar: ${m.stock||0}`;
  document.getElementById('quickStockAmount').value = '';
  document.getElementById('quickStockModal').classList.add('open');
}
export function closeQuickStockModal() { document.getElementById('quickStockModal').classList.remove('open'); }

export function confirmQuickStock() {
  const id = document.getElementById('quickStockModal').dataset.menuItemId;
  const amount = parseFloat(document.getElementById('quickStockAmount').value);
  if (!amount || amount <= 0) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Düzgün miqdar daxil edin'); return; }
  const m = state.menuItems.find(x=>x.id===id);
  R.menuItems.child(id).child('stock').transaction(cur => (cur||0) + amount);
  addLog('admin', `Anbar əl ilə artırıldı: ${m?.name} (+${amount})`, {});
  closeQuickStockModal();
  showToast(`<svg class="icon"><use href="#i-check"></use></svg> ${amount} ədəd əlavə edildi`);
}

export function toggleMenuItemAvailability(id) {
  const m = state.menuItems.find(x=>x.id===id);
  if (!m) return;
  const newAvailable = !(m.available !== false);
  R.menuItems.child(id).update({ available: newAvailable });
  addLog('admin', `"${m.name}" ${newAvailable?'yenidən mövcud edildi':'tükəndi olaraq işarələndi'}`, { menuItemId:id });
  showToast(newAvailable?`<svg class="icon"><use href="#i-check"></use></svg> ${m.name} yenidən mövcuddur`:`<svg class="icon"><use href="#i-ban"></use></svg> ${m.name} tükəndi`);
}

export function editMenuItem(id) {
  const m = state.menuItems.find(x=>x.id===id);
  if (!m) return;
  state.editTarget = { type:'menuItem', id };
  document.getElementById('addModalTitle').innerHTML = '<svg class="icon"><use href="#i-edit"></use></svg> Mal Düzəlişi';
  document.getElementById('addModalBody').innerHTML = menuItemForm(m);
  onMenuCategorySelectChange();
  document.getElementById('addModal').classList.add('open');
}

export function deleteMenuItem(id) {
  const m = state.menuItems.find(x=>x.id===id);
  confirmAction(`"${esc(m?.name)}" silinsin?`, () => {
    R.menuItems.child(id).remove();
    addLog('admin', `Mal silindi: ${m?.name}`, { menuItemId:id });
    showToast('<svg class="icon"><use href="#i-trash"></use></svg> Mal silindi');
  });
}

export function menuItemForm(m={}) {
  const existingCats = [...new Set(state.menuItems.map(x => x.category).filter(Boolean))];
  const currentCat = m.category || '';
  const catOptions = currentCat && !existingCats.includes(currentCat) ? [...existingCats, currentCat] : existingCats;

  return `
    <div style="text-align:center;margin-bottom:16px;">
      <img id="fm_preview" class="avatar-preview" src="${esc(m.photo||'')}" style="${m.photo?'display:block':'display:none'}">
      <div class="avatar-upload-area" onclick="document.getElementById('fm_file').click()">
        <div style="font-size:32px;margin-bottom:6px;"><svg class="icon"><use href="#i-utensils"></use></svg></div>
        <div style="font-size:13px;color:var(--text2);">Şəkil yükləmək üçün klikləyin</div>
        <div style="font-size:11px;color:var(--text3);margin-top:4px;">JPG, PNG — maks. 2MB</div>
        <input type="file" id="fm_file" accept="image/*" onchange="previewMenuItemPhoto(this)">
      </div>
      <input type="hidden" id="fm_photo" value="${esc(m.photo||'')}">
    </div>
    <div class="form-group">
      <label>Mal Adı *</label>
      <input type="text" id="fm_name" value="${esc(m.name||'')}" placeholder="Toyuq Şişlik">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Kateqoriya *</label>
        <select id="fm_category_select" onchange="onMenuCategorySelectChange()">
          ${catOptions.map(c => `<option value="${esc(c)}" ${c===currentCat?'selected':''}>${esc(c)}</option>`).join('')}
          <option value="__new__" ${catOptions.length===0?'selected':''}><svg class="icon"><use href="#i-plus"></use></svg> Yeni Kateqoriya...</option>
        </select>
      </div>
      <div class="form-group">
        <label>Qiymət (₼) *</label>
        <input type="number" id="fm_price" value="${m.price||''}" min="0" step="0.01" placeholder="12.50">
      </div>
    </div>
    <div class="form-group" id="fm_new_category_group" style="display:none;">
      <label>Yeni Kateqoriya Adı *</label>
      <input type="text" id="fm_category_new" placeholder="Məs: Salatlar, Şirniyyatlar">
    </div>
    <div class="form-group">
      <label>Təsvir (istəyə görə)</label>
      <textarea id="fm_description" rows="2" placeholder="Toyuq döşü, közdə bişmiş...">${esc(m.description||'')}</textarea>
    </div>
    <label style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--card2);border-radius:10px;cursor:pointer;margin-top:4px;">
      <input type="checkbox" id="fm_trackable" ${m.isTrackable?'checked':''} style="width:20px;height:20px;cursor:pointer;flex-shrink:0;">
      <span>
        <span style="font-weight:700;display:block;">Sayıla bilən mal</span>
        <span style="font-size:12px;color:var(--text2);">Anbarda izlənir, "Məhsul Alışı" bölməsində görünür və stoku izlənir</span>
      </span>
    </label>`;
}

export function onMenuCategorySelectChange() {
  const select = document.getElementById('fm_category_select');
  const group  = document.getElementById('fm_new_category_group');
  if (select.value === '__new__') {
    group.style.display = 'block';
    document.getElementById('fm_category_new').focus();
  } else {
    group.style.display = 'none';
  }
}

export function previewMenuItemPhoto(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    showToast('<svg class="icon"><use href="#i-error"></use></svg> Şəkil 2MB-dan böyük olmamalıdır');
    input.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    const base64 = e.target.result;
    const preview = document.getElementById('fm_preview');
    if (preview) { preview.src = base64; preview.style.display = 'block'; }
    const photoField = document.getElementById('fm_photo');
    if (photoField) photoField.value = base64;
    showToast('<svg class="icon"><use href="#i-check"></use></svg> Şəkil yükləndi');
  };
  reader.readAsDataURL(file);
}

export function openAddModal() {
  state.editTarget = null;
  if (state.adminSection === 'staff') {
    openAddStaffModal();
    return;
  }
  if (state.adminSection === 'suppliers') {
    openSupplierModal();
    return;
  }
  if (state.adminSection === 'purchases') {
    openPurchaseModal();
    return;
  }
  if (state.adminSection === 'menu') {
    document.getElementById('addModalTitle').innerHTML = '<svg class="icon"><use href="#i-plus"></use></svg> Yeni Mal';
    document.getElementById('addModalBody').innerHTML = menuItemForm({});
    onMenuCategorySelectChange();
  } else if (state.adminSection === 'customers') {
    document.getElementById('addModalTitle').innerHTML = '<svg class="icon"><use href="#i-plus"></use></svg> Yeni Müştəri';
    document.getElementById('addModalBody').innerHTML = customerForm({});
  } else if (state.adminSection === 'paymentMethods') {
    document.getElementById('addModalTitle').innerHTML = '<svg class="icon"><use href="#i-plus"></use></svg> Yeni Ödəniş Növü';
    document.getElementById('addModalBody').innerHTML = paymentMethodForm({});
  } else {
    document.getElementById('addModalTitle').innerHTML = '<svg class="icon"><use href="#i-plus"></use></svg> Yeni Kateqoriya və Masalar';
    document.getElementById('addModalBody').innerHTML = tableForm('', false);
  }
  document.getElementById('addModal').classList.add('open');
}

export function closeAddModal() {
  const modal = document.getElementById('addModal');
  if (modal) {
    modal.classList.remove('open');
    modal.style.display = '';
  }
  state.editTarget = null;
}

export function saveItem() {
  const sec = state.editTarget
    ? state.editTarget.type
    : (state.adminSection === 'menu' ? 'menuItem' : state.adminSection === 'staff' ? 'staff' : state.adminSection === 'customers' ? 'customer' : state.adminSection === 'paymentMethods' ? 'paymentMethod' : 'table');

  if (sec === 'staff') { saveStaff(); return; }
  if (sec === 'customer') { saveCustomer(); return; }
  if (sec === 'paymentMethod') { savePaymentMethod(); return; }

  if (sec === 'menuItem') {
    const name = (document.getElementById('fm_name')?.value||'').trim();
    const categorySelect = document.getElementById('fm_category_select')?.value || '';
    const category = categorySelect === '__new__' ? (document.getElementById('fm_category_new')?.value||'').trim() : categorySelect.trim();
    const priceRaw = (document.getElementById('fm_price')?.value||'').trim();
    const description = (document.getElementById('fm_description')?.value||'').trim();
    const photo = (document.getElementById('fm_photo')?.value||'').trim();
    const isTrackable = document.getElementById('fm_trackable')?.checked || false;

    if (!name) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Mal adı mütləqdir'); return; }
    if (!category) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Kateqoriya mütləqdir'); return; }
    const price = parseFloat(priceRaw);
    if (isNaN(price) || price < 0) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Düzgün qiymət daxil edin'); return; }

    const menuItemData = { name, category, price, description, photo, isTrackable };

    if (state.editTarget) {
      R.menuItems.child(state.editTarget.id).update(menuItemData);
      addLog('admin', `Mal yeniləndi: ${name}`, { menuItemId: state.editTarget.id });
      showToast('<svg class="icon"><use href="#i-check"></use></svg> Mal yeniləndi');
    } else {
      R.menuItems.push({ ...menuItemData, available: true, createdAt: Date.now() });
      addLog('admin', `Yeni mal əlavə edildi: ${name}`, {});
      showToast('<svg class="icon"><use href="#i-check"></use></svg> Mal əlavə edildi');
    }
  } else {
    const prefix = document.getElementById('ft_name').value.trim();
    if (!prefix) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Kateqoriya adı lazımdır'); return; }

    if (state.editTarget) {
      R.tables.child(state.editTarget.id).update({ name: prefix });
      addLog('admin', `Masa adı dəyişdirildi: ${prefix}`, {});
      showToast('<svg class="icon"><use href="#i-check"></use></svg> Masa yeniləndi');
    } else {
      const count = parseInt(document.getElementById('ft_count').value) || 1;
      for (let i = 1; i <= count; i++) {
        const tName = count === 1 ? prefix : `${prefix} ${i}`;
        R.tables.push({ name: tName, category: prefix, occupant: null, notes: '', createdAt: Date.now() + i });
      }
      addLog('admin', `${count} ədəd masa əlavə edildi: ${prefix}`, {});
      showToast(`<svg class="icon"><use href="#i-check"></use></svg> ${count} ədəd masa əlavə edildi`);
    }
  }
  closeAddModal();
}

export function openKitchenPinModal() {
  document.getElementById('newKitchenPin').value = '';
  document.getElementById('kitchenPinModal').classList.add('open');
}

export function closeKitchenPinModal() { document.getElementById('kitchenPinModal').classList.remove('open'); }

export function saveKitchenPin() {
  const pin = document.getElementById('newKitchenPin').value.trim();
  if (pin.length !== 4 || !/^\d{4}$/.test(pin)) { showToast('<svg class="icon"><use href="#i-error"></use></svg> 4 rəqəmli PIN daxil edin'); return; }
  if (String(pin) === String(ADMIN_PIN)) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Admin PIN ilə eyni ola bilməz'); return; }
  db.ref('settings/kitchenPin').set(pin);
  state.kitchenPin = pin;
  addLog('admin','Mətbəx PIN dəyişdirildi',{});
  closeKitchenPinModal();
  showToast('<svg class="icon"><use href="#i-check"></use></svg> Mətbəx PIN dəyişdirildi');
}

export function saveMenuUrl() {
  const url = document.getElementById('menuUrlInput').value.trim();
  if (!url) { showToast('<svg class="icon"><use href="#i-error"></use></svg> URL boş ola bilməz'); return; }
  db.ref('settings/menuUrl').set(url);
  addLog('admin',`Menyu URL dəyişdirildi: ${url}`,{});
  document.getElementById('menuUrlStatus').innerHTML = '<svg class="icon"><use href="#i-check"></use></svg> Yadda saxlanıldı';
  setTimeout(()=>{ document.getElementById('menuUrlStatus').textContent=''; },3000);
  showToast('<svg class="icon"><use href="#i-check"></use></svg> Menyu URL yadda saxlandı');
}

export function saveServiceCharge() {
  const enabled = document.getElementById('serviceChargeEnabled').checked;
  const percent = parseFloat(document.getElementById('serviceChargePercent').value) || 0;
  if (enabled && percent <= 0) {
    showToast('<svg class="icon"><use href="#i-warning"></use></svg> Faiz dərəcəsi 0-dan böyük olmalıdır');
    document.getElementById('serviceChargeEnabled').checked = false;
    return;
  }
  db.ref('settings/serviceCharge').set({ enabled, percent });
  addLog('admin', `Xidmət haqqı ${enabled?`aktiv edildi (${percent}%)`:'deaktiv edildi'}`, {});
  document.getElementById('serviceChargeStatus').innerHTML = '<svg class="icon"><use href="#i-check"></use></svg> Yadda saxlanıldı';
  setTimeout(()=>{ const el = document.getElementById('serviceChargeStatus'); if (el) el.textContent=''; },3000);
  showToast(`<svg class="icon"><use href="#i-check"></use></svg> Xidmət haqqı ${enabled?'aktivdir':'deaktivdir'}`);
}

export function saveLoyaltySettings() {
  const referralBonusAmount = parseFloat(document.getElementById('referralBonusAmount').value) || 0;
  const referralMinOrderAmount = parseFloat(document.getElementById('referralMinOrderAmount').value) || 0;
  db.ref('settings/loyalty').set({ referralBonusAmount, referralMinOrderAmount });
  addLog('admin', `Referral proqramı yeniləndi: ${referralBonusAmount} bal / minimum ${referralMinOrderAmount} ₼`, {});
  const el = document.getElementById('loyaltySettingsStatus');
  if (el) {
    el.innerHTML = '<svg class="icon"><use href="#i-check"></use></svg> Yadda saxlanıldı';
    setTimeout(()=>{ if (el) el.textContent=''; },3000);
  }
  showToast('<svg class="icon"><use href="#i-check"></use></svg> Referral parametrləri yadda saxlandı');
}

export function renderStaff() {
  const el = document.getElementById('staffGrid');
  if (!el) return;
  if (!state.staff || !state.staff.length) {
    el.innerHTML = '<p style="color:var(--text3);">Hələ işçi əlavə edilməyib.</p>';
    return;
  }

  el.innerHTML = state.staff.map(s => {
    const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(s.name)}&background=8e44ad&color=fff&size=200`;
    const st = s.status === 'offline' ? 'Deaktiv' : 'Aktiv';
    const bc = s.status === 'offline' ? 'badge-red' : 'badge-green';
    return `<div class="tile-card" onclick="selectStaff('${s.id}')">
      <div class="tile-card__icon"><img src="${s.avatar || fallback}" alt="" onerror="this.src='${fallback}'"></div>
      <div class="tile-card__name">${esc(s.name)}</div>
      <div class="tile-card__meta">${esc(s.position||'İşçi')}</div>
      <span class="status-badge ${bc} tile-card__badge">${st}</span>
    </div>`;
  }).join('');

  if (state._selectedStaffId) {
    const s = state.staff.find(x => x.id === state._selectedStaffId);
    if (s) renderStaffDetail(s); else selectStaff(null);
  }
}

export function selectStaff(id) {
  state._selectedStaffId = id;
  const overlay = document.getElementById('staffDetailPanel');
  if (!id) { overlay?.classList.remove('open'); return; }
  const s = state.staff.find(x => x.id === id);
  if (!s) { overlay?.classList.remove('open'); return; }
  renderStaffDetail(s);
  overlay?.classList.add('open');
}

function renderStaffDetail(s) {
  const el = document.getElementById('staffDetailBody');
  if (!el || !s) return;
  const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(s.name)}&background=8e44ad&color=fff&size=200`;
  const permCount = (s.permissions || []).length;
  const st = s.status === 'offline' ? 'Deaktiv' : 'Aktiv';
  el.innerHTML = `
    <div style="text-align:center;margin-bottom:14px;">
      <img src="${s.avatar || fallback}" alt="" onerror="this.src='${fallback}'" style="width:96px;height:96px;border-radius:50%;object-fit:cover;">
    </div>
    <div class="ct-detail-header" style="justify-content:center;text-align:center;flex-direction:column;gap:6px;">
      <span style="font-size:19px;"><svg class="icon"><use href="#i-staff"></use></svg> ${esc(s.name)}</span>
      <span style="font-size:14px;color:var(--text2);font-weight:600;">${esc(s.position||'İşçi')}</span>
    </div>
    <div class="ct-detail-info-grid">
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Status</div><div class="ct-detail-info-block__value" style="color:${s.status==='offline'?'var(--red)':'var(--green)'};">${st}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Telefon</div><div class="ct-detail-info-block__value">${esc(s.phone||'—')}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">İcazə sayı</div><div class="ct-detail-info-block__value">${permCount}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">FİN</div><div class="ct-detail-info-block__value">${esc(s.fin||'—')}</div></div>
    </div>
    <div class="ct-detail-actions" style="flex-wrap:wrap;">
      <button class="btn ${s.status==='offline'?'btn-green':'btn-red'}" style="flex:1;padding:11px;" onclick="toggleStaff('${s.id}')">${s.status==='offline'?'Aktiv Et':'Deaktiv Et'}</button>
      <button class="btn btn-blue" style="flex:1;padding:11px;" onclick="editStaff('${s.id}')"><svg class="icon"><use href="#i-tag"></use></svg> Redaktə Et</button>
      <button class="btn btn-red" style="flex:1;padding:11px;" onclick="deleteStaff('${s.id}')"><svg class="icon"><use href="#i-trash"></use></svg> Sil</button>
    </div>
  `;
}

export function toggleStaff(id) {
  const s = state.staff.find(x=>x.id===id);
  if (!s) return;
  const newStatus = s.status === 'offline' ? 'active' : 'offline';
  db.ref('staff').child(id).update({ status: newStatus });
  addLog('admin', `İşçi ${newStatus==='active'?'aktiv':'deaktiv'} edildi: ${s.name}`, { staffId: id });
  showToast(newStatus==='active' ? `<svg class="icon"><use href="#i-check"></use></svg> ${s.name} aktiv edildi` : `<svg class="icon"><use href="#i-ban"></use></svg> ${s.name} deaktiv edildi`);
}

export function editStaff(id) {
  const s = state.staff.find(x=>x.id===id);
  if (!s) return;
  state.editTarget = { type: 'staff', id };
  document.getElementById('addModalTitle').innerHTML = '<svg class="icon"><use href="#i-edit"></use></svg> İşçi Düzəliş';
  document.getElementById('addModalBody').innerHTML = staffForm(s);
  document.getElementById('addModal').classList.add('open');
}

export function deleteStaff(id) {
  const s = state.staff.find(x=>x.id===id);
  const activeTable = state.tables.find(t => t.occupant === id);
  if (activeTable) { showToast(`<svg class="icon"><use href="#i-error"></use></svg> "${s?.name}" adlı işçinin "${activeTable.name}" masası aktivdir! Əvvəlcə masanı bağlayın.`); return; }
  confirmAction(`"${esc(s?.name)}" adlı işçi silinsin?`, () => {
    db.ref('staff').child(id).remove();
    addLog('admin', `İşçi silindi: ${s?.name}`, { staffId: id });
    showToast('<svg class="icon"><use href="#i-trash"></use></svg> İşçi silindi');
  });
}

export function openAddStaffModal() {
  state.editTarget = { type: 'staff' };
  document.getElementById('addModalTitle').innerHTML = '<svg class="icon"><use href="#i-plus"></use></svg> Yeni İşçi';
  document.getElementById('addModalBody').innerHTML = staffForm({});
  document.getElementById('addModal').classList.add('open');
}

export function onStaffPositionChange() {
  const pos = document.getElementById('fs_position').value;
  const map = { 'Qarson': 'waiter', 'Baş Qarson': 'head_waiter', 'Kassir': 'cashier', 'Müdir': 'manager' };
  if (map[pos]) applyPermissionPreset(map[pos]);
}

export function saveStaff() {
  const firstname = (document.getElementById('fs_firstname')?.value||'').trim();
  const lastname = (document.getElementById('fs_lastname')?.value||'').trim();
  const position = (document.getElementById('fs_position')?.value||'').trim();
  const pin = (document.getElementById('fs_pin')?.value||'').trim();
  const phone = (document.getElementById('fs_phone')?.value||'').trim();
  const fin = (document.getElementById('fs_fin')?.value||'').trim();
  const avatarVal = (document.getElementById('fs_avatar')?.value||'').trim();
  const permissions = readPermissionCheckboxes();

  if (!firstname || !lastname) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Ad və Soyad mütləqdir'); return; }
  if (!position) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Vəzifə seçilməlidir'); return; }
  if (pin.length !== 4 || !/^\d{4}$/.test(pin)) { showToast('<svg class="icon"><use href="#i-error"></use></svg> 4 rəqəmli PIN lazımdır'); return; }

  const conflict = state.staff?.find(s => s.pin === pin && (!state.editTarget?.id || s.id !== state.editTarget.id));
  if (conflict) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Bu PIN artıq istifadə olunur'); return; }

  const name = `${firstname} ${lastname}`;
  const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=8e44ad&color=fff&size=200`;
  const avatar = avatarVal || fallback;

  const staffData = { name, firstname, lastname, position, pin, phone, fin, avatar, permissions };

  if (state.editTarget?.id) {
    db.ref('staff').child(state.editTarget.id).update(staffData);
    addLog('admin', `İşçi yeniləndi: ${name}`, { staffId: state.editTarget.id });
    showToast('<svg class="icon"><use href="#i-check"></use></svg> İşçi yeniləndi');
  } else {
    db.ref('staff').push({ ...staffData, status: 'active', createdAt: Date.now() });
    addLog('admin', `Yeni işçi əlavə edildi: ${name}`, {});
    showToast('<svg class="icon"><use href="#i-check"></use></svg> İşçi əlavə edildi');
  }
  closeAddModal();
}

export function staffForm(s = {}) {
  const existingPerms = s.permissions || [];
  const currentPos = s.position || '';
  return `
    <div style="text-align:center;margin-bottom:16px;">
      <img id="fs_preview" class="avatar-preview" src="${esc(s.avatar||'')}" style="${s.avatar?'display:block':'display:none'}">
      <div class="avatar-upload-area" onclick="document.getElementById('fs_file').click()">
        <div style="font-size:32px;margin-bottom:6px;"><svg class="icon"><use href="#i-user"></use></svg></div>
        <div style="font-size:13px;color:var(--text2);">Şəkil yükləmək üçün klikləyin</div>
        <input type="file" id="fs_file" accept="image/*" onchange="previewStaffPhoto(this)">
      </div>
      <input type="hidden" id="fs_avatar" value="${esc(s.avatar||'')}">
    </div>
    <div class="modal-section-title"><svg class="icon"><use href="#i-user"></use></svg> Məlumatlar</div>
    <div class="form-row">
      <div class="form-group"><label>Ad *</label><input type="text" id="fs_firstname" value="${esc(s.firstname||s.name?.split(' ')[0]||'')}" placeholder="Əli"></div>
      <div class="form-group"><label>Soyad *</label><input type="text" id="fs_lastname" value="${esc(s.lastname||s.name?.split(' ')[1]||'')}" placeholder="Məmmədov"></div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Vəzifə *</label>
        <select id="fs_position" onchange="onStaffPositionChange()" style="width:100%;padding:12px 14px;background:var(--bg);border:1px solid var(--border);border-radius:10px;color:var(--text);font-size:15px;">
          <option value="">Seçin...</option>
          <option value="Qarson" ${currentPos==='Qarson'?'selected':''}><svg class="icon"><use href="#i-bowtie"></use></svg> Qarson</option>
          <option value="Baş Qarson" ${currentPos==='Baş Qarson'?'selected':''}><svg class="icon"><use href="#i-star"></use></svg> Baş Qarson</option>
          <option value="Kassir" ${currentPos==='Kassir'?'selected':''}><svg class="icon"><use href="#i-money"></use></svg> Kassir</option>
          <option value="Müdir" ${currentPos==='Müdir'?'selected':''}><svg class="icon"><use href="#i-staff"></use></svg> Müdir</option>
          <option value="Mətbəx" ${currentPos==='Mətbəx'?'selected':''}><svg class="icon"><use href="#i-chef"></use></svg> Mətbəx</option>
          <option value="Digər" ${currentPos==='Digər'?'selected':''}>Digər</option>
        </select>
      </div>
      <div class="form-group"><label>Telefon</label><input type="tel" id="fs_phone" value="${esc(s.phone||'')}" placeholder="+994 50 000 00 00"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>FİN nömrəsi</label><input type="text" id="fs_fin" value="${esc(s.fin||'')}" placeholder="1234ABC"></div>
      <div class="form-group"><label>PIN kod * (4 rəqəm)</label><input type="text" id="fs_pin" value="${esc(s.pin||'')}" maxlength="4" placeholder="1234" style="font-size:22px;letter-spacing:6px;text-align:center;"></div>
    </div>
    <div class="modal-section-title" style="margin-top:8px;display:flex;justify-content:space-between;align-items:center;">
      <span><svg class="icon"><use href="#i-key"></use></svg> İcazələr</span>
      <button type="button" onclick="document.querySelectorAll('[name=staff_perm]').forEach(c=>c.checked=false)" style="padding:5px 10px;border-radius:8px;border:1px solid var(--red);color:var(--red);background:var(--bg);font-size:11px;cursor:pointer;"><svg class="icon"><use href="#i-close"></use></svg> Hamısını Sil</button>
    </div>
    ${renderPermissionCheckboxes(existingPerms)}
  `;
}

export function previewStaffPhoto(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Şəkil 2MB-dan böyük olmamalıdır'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    const preview = document.getElementById('fs_preview');
    if (preview) { preview.src = e.target.result; preview.style.display = 'block'; }
    const field = document.getElementById('fs_avatar');
    if (field) field.value = e.target.result;
  };
  reader.readAsDataURL(file);
}

export function renderTables() {
  const el = document.getElementById('tablesGrid');
  const tabEl = document.getElementById('tableCatTabs');
  // Müvəqqəti bərpa masaları burada göstərilmir - bu bölmə yalnız sabit (qeydiyyatlı)
  // masaların idarəsi üçündür. Onlar qarson panelində (aktiv olduqları müddətdə) görünür.
  const registeredTables = state.tables.filter(t => !t.isRestoredTemp);
  if (!registeredTables.length) {
    el.innerHTML = '<p style="color:var(--text3);">Hələ masa əlavə edilməyib.</p>';
    tabEl.innerHTML = '';
    return;
  }

  const cats = ['all', ...new Set(registeredTables.map(t => t.category || t.name.replace(/\s+\d+$/, '') || t.name))];
  tabEl.innerHTML = cats.map(c => `
    <button onclick="setTableCat('${esc(c)}')" style="padding:8px 18px;border-radius:20px;border:1px solid var(--border);background:${state._tableCatFilter===c?'var(--brand-gradient)':'transparent'};color:${state._tableCatFilter===c?'white':'var(--text2)'};font-weight:600;font-size:13px;cursor:pointer;">
      ${c === 'all' ? '<svg class="icon"><use href="#i-chair"></use></svg> Hamısı' : esc(c)}
    </button>
  `).join('');

  const filtered = state._tableCatFilter === 'all' ? registeredTables : registeredTables.filter(t => (t.category || t.name.replace(/\s+\d+$/, '') || t.name) === state._tableCatFilter);
  if (!filtered.length) {
    el.innerHTML = '<p style="color:var(--text3);">Bu kateqoriyada masa yoxdur.</p>';
    return;
  }

  el.innerHTML = filtered.map(t => {
    const occ = t.occupant ? (state.staff.find(s => s.id === t.occupant) || { name: '?' }).name : null;
    return `<div class="tile-card" onclick="selectTableMgmt('${t.id}')">
      <div class="tile-card__icon"><svg class="icon"><use href="#i-chair"></use></svg></div>
      <div class="tile-card__name">${esc(t.name)}</div>
      <div class="tile-card__meta">${occ ? esc(occ) : 'Boş'}</div>
      <span class="status-badge ${occ?'badge-orange':'badge-green'} tile-card__badge">${occ?'Aktiv':'Boş'}</span>
    </div>`;
  }).join('');

  if (state._selectedTableMgmtId) {
    const t = filtered.find(x => x.id === state._selectedTableMgmtId);
    if (t) renderTableMgmtDetail(t); else selectTableMgmt(null);
  }
}

export function selectTableMgmt(id) {
  state._selectedTableMgmtId = id;
  const overlay = document.getElementById('tablesDetailPanel');
  if (!id) { overlay?.classList.remove('open'); return; }
  const t = state.tables.find(x => x.id === id);
  if (!t) { overlay?.classList.remove('open'); return; }
  renderTableMgmtDetail(t);
  overlay?.classList.add('open');
}

function renderTableMgmtDetail(t) {
  const el = document.getElementById('tablesDetailBody');
  if (!el || !t) return;
  const occ = t.occupant ? (state.staff.find(s => s.id === t.occupant) || { name: '?' }).name : null;
  el.innerHTML = `
    <div class="ct-detail-header" style="justify-content:center;text-align:center;">
      <span style="font-size:19px;"><svg class="icon"><use href="#i-chair"></use></svg> ${esc(t.name)}</span>
    </div>
    <div class="ct-detail-info-grid">
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Status</div><div class="ct-detail-info-block__value" style="color:${occ?'var(--orange)':'var(--green)'};">${occ?'Aktiv':'Boş'}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">İşçi</div><div class="ct-detail-info-block__value">${occ?esc(occ):'—'}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Kateqoriya</div><div class="ct-detail-info-block__value">${esc(t.category || t.name.replace(/\s+\d+$/, '') || t.name)}</div></div>
    </div>
    <div class="ct-detail-actions" style="flex-wrap:wrap;">
      <button class="btn btn-blue" style="flex:1;padding:11px;" onclick="editTable('${t.id}')"><svg class="icon"><use href="#i-tag"></use></svg> Adını Dəyiş</button>
      <button class="btn" style="flex:1;padding:11px;border:1px solid var(--border);" onclick="showQR('${t.id}','${esc(t.name)}')"><svg class="icon"><use href="#i-qr"></use></svg> QR Kod</button>
      <button class="btn btn-red" style="flex:1;padding:11px;" onclick="deleteTable('${t.id}')"><svg class="icon"><use href="#i-trash"></use></svg> Sil</button>
    </div>
  `;
}

export function setTableCat(cat) { state._tableCatFilter = cat; renderTables(); }

export function editTable(id) {
  const t = state.tables.find(x=>x.id===id);
  if (!t) return;
  state.editTarget = { type:'table', id };
  document.getElementById('addModalTitle').innerHTML = '<svg class="icon"><use href="#i-edit"></use></svg> Masa Adını Dəyiş';
  document.getElementById('addModalBody').innerHTML = tableForm(t.name, true);
  document.getElementById('addModal').classList.add('open');
}

export function deleteTable(id) {
  const t = state.tables.find(x=>x.id===id);
  if (t?.occupant) { showToast(`<svg class="icon"><use href="#i-error"></use></svg> "${t?.name}" masası aktivdir! Əvvəlcə bağlayın.`); return; }
  confirmAction(`"${esc(t?.name)}" masası silinsin?`, () => {
    R.tables.child(id).remove();
    addLog('admin',`Masa silindi: ${t?.name}`,{ tableId:id });
    showToast('<svg class="icon"><use href="#i-trash"></use></svg> Masa silindi');
  });
}

export function tableForm(name='', isEdit=false) {
  return `
    <div class="form-group">
      <label>Kateqoriya Adı</label>
      <input type="text" id="ft_name" value="${esc(name)}" placeholder="Məs: Masa, VIP, Terras, Bar" style="font-size:16px;">
      <small style="color:var(--text2);font-size:12px;margin-top:5px;display:block;">Bu ad həm kateqoriya, həm də prefiks kimi istifadə olunur.</small>
    </div>
    ${!isEdit ? `
    <div class="form-group">
      <label>Neçə ədəd masa yaransın?</label>
      <input type="number" id="ft_count" value="1" min="1" max="99" style="font-size:18px;text-align:center;">
      <small style="color:var(--text2);font-size:12px;margin-top:5px;display:block;">Məs: "Masa" + 6 → Masa 1, Masa 2 ... Masa 6</small>
    </div>` : ''}
  `;
}

export function renderLogs() {
  const el = document.getElementById('logList');
  let list = state.logs;
  if (state.logFilter!=='all') list = list.filter(l=>l.type===state.logFilter);
  if (!list.length) { el.innerHTML='<p style="color:var(--text3);padding:16px;">Log tapılmadı.</p>'; return; }
  const colors = { login:'#2ecc71', logout:'#95a5a6', order:'#f39c12', table:'#3498db', admin:'#8e44ad', chat:'#e67e22', customer:'#e74c3c' };
  const labels = { login:'GİRİŞ', logout:'ÇIXIŞ', order:'SİFARİŞ', table:'MASA', admin:'ADMİN', chat:'MESAJ', customer:'MÜŞTƏRİ' };
  const visible = list.slice(0,150);
  state._selectedLogIds = (state._selectedLogIds||[]).filter(id => visible.some(l=>l.id===id));
  const allChecked = visible.length>0 && visible.every(l=>state._selectedLogIds.includes(l.id));
  const barHtml = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
    <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text2);cursor:pointer;">
      <input type="checkbox" onchange="toggleSelectAllLogs(this.checked)" ${allChecked?'checked':''} style="width:16px;height:16px;cursor:pointer;">
      Hamısını seç (${visible.length})
    </label>
    <button id="logDeleteSelectedBtn" class="btn btn-red" style="display:${state._selectedLogIds.length?'inline-flex':'none'};padding:5px 12px;font-size:11px;" onclick="deleteSelectedLogs()"><svg class="icon"><use href="#i-trash"></use></svg> Seçilənləri Sil (${state._selectedLogIds.length})</button>
  </div>`;
  el.innerHTML = barHtml + visible.map(l=>`
    <div class="log-item">
      <input type="checkbox" onchange="toggleLogSelect('${l.id}')" ${state._selectedLogIds.includes(l.id)?'checked':''} style="width:16px;height:16px;flex-shrink:0;margin-top:2px;cursor:pointer;">
      <span class="log-badge" style="background:${colors[l.type]||'#666'}22;color:${colors[l.type]||'#aaa'}">${labels[l.type]||'LOG'}</span>
      <span class="log-text">${esc(l.message)}</span>
      <span class="log-time">${l.time} ${l.date}</span>
    </div>
  `).join('');
}

export function toggleLogSelect(id) {
  state._selectedLogIds = state._selectedLogIds || [];
  const i = state._selectedLogIds.indexOf(id);
  if (i === -1) state._selectedLogIds.push(id); else state._selectedLogIds.splice(i,1);
  const btn = document.getElementById('logDeleteSelectedBtn');
  if (btn) {
    btn.style.display = state._selectedLogIds.length ? 'inline-flex' : 'none';
    btn.innerHTML = `<svg class="icon"><use href="#i-trash"></use></svg> Seçilənləri Sil (${state._selectedLogIds.length})`;
  }
}

export function toggleSelectAllLogs(checked) {
  let list = state.logs;
  if (state.logFilter!=='all') list = list.filter(l=>l.type===state.logFilter);
  state._selectedLogIds = checked ? list.slice(0,150).map(l=>l.id) : [];
  renderLogs();
}

export function deleteSelectedLogs() {
  const ids = state._selectedLogIds || [];
  if (!ids.length) return;
  confirmDelete2x(ids.length, 'tarixçə qeydi', () => {
    ids.forEach(id => R.logs.child(id).remove());
    showToast(`<svg class="icon"><use href="#i-check"></use></svg> ${ids.length} qeyd silindi`);
    state._selectedLogIds = [];
  });
}

export function setLogFilter(f, el) {
  state.logFilter = f;
  document.querySelectorAll('.log-filter').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
  renderLogs();
}

export function clearOldLogs() {
  confirmAction('30 gündən köhnə bütün tarixçə qeydləri silinsin?', () => {
    const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
    R.logs.once('value', snap => {
      const data = snap.val() || {};
      let deletedCount = 0;
      Object.keys(data).forEach(key => { if (data[key].timestamp < cutoff) { R.logs.child(key).remove(); deletedCount++; } });
      showToast(`<svg class="icon"><use href="#i-check"></use></svg> ${deletedCount} köhnə qeyd silindi`);
    });
  });
}

export function showQR(tableId, tableName) {
  const url = location.origin + location.pathname + '?table=' + tableId;
  document.getElementById('qrModalTitle').innerHTML = '<svg class="icon"><use href="#i-qr"></use></svg> ' + tableName;
  document.getElementById('qrLink').textContent = url;
  const canvas = document.getElementById('qrCanvas');
  canvas.innerHTML = '';
  new QRCode(canvas, { text:url, width:200, height:200, colorDark:'#000', colorLight:'#fff' });
  document.getElementById('qrModal').classList.add('open');
}

export function closeQRModal() { document.getElementById('qrModal').classList.remove('open'); }

export function printQR() {
  const title = document.getElementById('qrModalTitle').textContent;
  const canvas = document.querySelector('#qrCanvas canvas');
  if (!canvas) return;
  const img = canvas.toDataURL();
  const w = window.open('','_blank');
  w.document.write(`<html><head><title>${title}</title><style>body{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;}h2{margin-bottom:16px;}p{color:#666;font-size:13px;}</style></head><body><h2>${title}</h2><img src="${img}" width="250"><p>QR kodu oxudun</p><script>window.onload=()=>window.print()<\/script></body></html>`);
}

export function generateDailyReport() {
  if (!hasPermission('report.daily')) { showToast('<svg class="icon"><use href="#i-ban"></use></svg> Hesabat icazəniz yoxdur'); return; }
  const today = new Date().toLocaleDateString('az-AZ');

  // Həm ödənişləri həm bağlanan masaları yüklə
  Promise.all([
    new Promise(res => db.ref('payments').orderByChild('date').equalTo(today).once('value', snap => res(snap.val()||{}))),
    new Promise(res => db.ref('closedOrders').orderByChild('closedDate').equalTo(today).once('value', snap => res(snap.val()||{})))
  ]).then(([paymentsData, closedData]) => {
    const payments = Object.values(paymentsData);
    const closed = Object.values(closedData);

    const typeNames = {cash:'<svg class="icon"><use href="#i-cash"></use></svg> Nağd', pos:'<svg class="icon"><use href="#i-card"></use></svg> POS', credit:'<svg class="icon"><use href="#i-clipboard"></use></svg> Nisyə', split:'<svg class="icon"><use href="#i-scissors"></use></svg> Bölünmüş'};
    const byType = {};
    let totalRevenue = 0, totalDiscount = 0;

    payments.forEach(p => {
      byType[p.type] = (byType[p.type]||0) + (p.finalAmount||0);
      totalRevenue += p.finalAmount||0;
      if (p.discountValue) totalDiscount += (p.originalAmount||0) - (p.finalAmount||0);
    });

    // Ödənişsiz bağlanan masalar (ödəniş sistemi istifadə edilməmiş)
    const unpaidClosed = closed.filter(c => !payments.some(p => p.tableId === c.tableId &&
      Math.abs(p.closedAt - c.closedAt) < 60000));

    const html = `
      <div class="report-section">
        <h4><svg class="icon"><use href="#i-calendar"></use></svg> ${today} — Günlük icmal</h4>
        <div class="report-row"><span>Bağlanan masalar:</span><span>${closed.length}</span></div>
        <div class="report-row"><span>Ödəniş əməliyyatı:</span><span>${payments.length}</span></div>
        <div class="report-row"><span>Verilən endirim:</span><span style="color:var(--orange);">${totalDiscount.toFixed(2)} ₼</span></div>
        <div class="report-row"><span>Ümumi gəlir:</span><span>${totalRevenue.toFixed(2)} ₼</span></div>
      </div>
      ${payments.length ? `
      <div class="report-section">
        <h4><svg class="icon"><use href="#i-money"></use></svg> Ödəniş növlərinə görə</h4>
        ${Object.entries(byType).filter(([,v])=>v>0).map(([type,amount])=>`
          <div class="report-row"><span>${typeNames[type]||type}</span><span>${amount.toFixed(2)} ₼</span></div>
        `).join('')}
      </div>` : ''}
      <div class="report-section">
        <h4><svg class="icon"><use href="#i-chair"></use></svg> Bağlanan masalar</h4>
        ${closed.length ? closed.map(c=>`
          <div class="report-row" style="font-size:13px;">
            <span>${esc(c.tableName||'?')} — ${esc(c.staffName||'?')}</span>
            <span>${(c.total||0).toFixed(2)} ₼ <small style="color:var(--text3);">${c.closedTime||''}</small></span>
          </div>`).join('') : '<div style="color:var(--text3);font-size:13px;">Bu gün bağlanan masa yoxdur</div>'}
      </div>`;

    document.getElementById('reportContent').innerHTML = html;
    document.getElementById('reportModal').classList.add('open');
  });
}

export function closeReportModal() {
  document.getElementById('reportModal').classList.remove('open');
}

export function printReport() {
  const html = document.getElementById('reportContent').innerHTML;
  const w = window.open('','_blank','width=500,height=700');
  if (!w) return;
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Hesabat</title>
    <style>body{font-family:sans-serif;padding:20px;max-width:400px;margin:0 auto;}
    .report-section{margin-bottom:16px;}.report-section h4{font-size:11px;text-transform:uppercase;color:#666;margin-bottom:8px;border-bottom:1px solid #eee;padding-bottom:4px;}
    .report-row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0f0f0;font-size:13px;}
    .report-row:last-child{font-weight:700;font-size:15px;border-bottom:none;}
    @media print{body{padding:0;}}</style></head>
    <body><h2 style="text-align:center;font-size:16px;">Gün Sonu Hesabat<br>
    <small style="font-weight:400;font-size:13px;">${new Date().toLocaleDateString('az-AZ')}</small></h2>
    ${html}<script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}

// Mövcud HTML-də onclick="..."/onchange="..." istifadə olunan funksiyalar qlobal əlçatan olmalıdır
/* ═══════════════════════════════════════════
   MÜŞTƏRİLƏR (NİSYƏ HESABI)
═══════════════════════════════════════════ */
export function renderCustomers() {
  const el = document.getElementById('customersGrid');
  if (!el) return;
  if (!state.customers || !state.customers.length) {
    el.innerHTML = '<p style="color:var(--text3);">Hələ müştəri qeydə alınmayıb.</p>';
    return;
  }
  el.innerHTML = state.customers.slice().sort((a,b)=>(b.balance||0)-(a.balance||0)).map(c => `
    <div class="item-card">
      <div class="item-card-header">
        <div style="width:52px;height:52px;border-radius:50%;background:var(--card2);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <svg class="icon" style="width:24px;height:24px;color:var(--text2);"><use href="#i-user"></use></svg>
        </div>
        <div class="item-info">
          <h3>${esc(c.name)}</h3>
          ${c.phone ? `<small style="color:var(--text3);display:block;"><svg class="icon"><use href="#i-phone"></use></svg> ${esc(c.phone)}</small>` : ''}
        </div>
      </div>
      <span class="status-badge ${(c.balance>0)?'badge-red':'badge-green'}">${(c.balance||0).toFixed(2)} ₼ borc</span>
      <div class="item-actions">
        <button class="btn" style="border:1px solid var(--blue);color:var(--blue);" onclick="openCustomerHistoryModal('${c.id}')"><svg class="icon"><use href="#i-clipboard"></use></svg> Tarixçə</button>
        <button class="btn btn-blue" onclick="editCustomer('${c.id}')"><svg class="icon"><use href="#i-edit"></use></svg> Redaktə</button>
        <button class="btn btn-red" onclick="deleteCustomer('${c.id}')"><svg class="icon"><use href="#i-trash"></use></svg> Sil</button>
      </div>
    </div>
  `).join('');
}

export function customerForm(c = {}) {
  return `
    <div class="form-group"><label>Ad Soyad *</label><input type="text" id="cu_name" value="${esc(c.name||'')}" placeholder="Məs: Vüqar Əliyev"></div>
    <div class="form-group"><label>Telefon</label><input type="text" id="cu_phone" value="${esc(c.phone||'')}" placeholder="+994 XX XXX XX XX"></div>
    <input type="hidden" id="cu_balance" value="${c.balance||0}">
  `;
}

export function saveCustomer() {
  const name = (document.getElementById('cu_name')?.value||'').trim();
  const phone = (document.getElementById('cu_phone')?.value||'').trim();
  if (!name) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Ad mütləqdir'); return; }
  const balance = parseFloat(document.getElementById('cu_balance')?.value) || 0;

  if (state.editTarget?.type === 'customer') {
    R.customers.child(state.editTarget.id).update({ name, phone });
    addLog('admin', `Müştəri redaktə edildi: ${name}`, {});
  } else {
    R.customers.push({ name, phone, balance, createdAt: Date.now() });
    addLog('admin', `Yeni müştəri qeydə alındı: ${name}`, {});
  }
  closeAddModal();
  showToast('<svg class="icon"><use href="#i-check"></use></svg> Müştəri saxlanıldı');
}

export function editCustomer(id) {
  const c = state.customers.find(x=>x.id===id);
  if (!c) return;
  state.editTarget = { type: 'customer', id };
  document.getElementById('addModalTitle').innerHTML = '<svg class="icon"><use href="#i-user"></use></svg> Müştərini Redaktə Et';
  document.getElementById('addModalBody').innerHTML = customerForm(c);
  document.getElementById('addModal').classList.add('open');
}

export function deleteCustomer(id) {
  const c = state.customers.find(x=>x.id===id);
  if (c?.balance > 0) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Bu müştərinin ödənilməmiş borcu var, əvvəlcə sıfırlayın.'); return; }
  confirmAction(`"${esc(c?.name)}" müştərisi silinsin?`, () => {
    R.customers.child(id).remove();
    addLog('admin', `Müştəri silindi: ${c?.name}`, {});
    showToast('<svg class="icon"><use href="#i-trash"></use></svg> Müştəri silindi');
  });
}

export function openCustomerHistoryModal(customerId) {
  const c = state.customers.find(x=>x.id===customerId);
  if (!c) return;
  document.getElementById('customerHistoryTitle').innerHTML = `<svg class="icon"><use href="#i-clipboard"></use></svg> ${esc(c.name)} — Alış Tarixçəsi`;
  document.getElementById('customerHistoryBalance').textContent = `Cari borc: ${(c.balance||0).toFixed(2)} ₼`;

  const charges = (state.customerCharges||[]).filter(ch => ch.customerId === customerId);
  const el = document.getElementById('customerHistoryList');
  if (!charges.length) {
    el.innerHTML = '<p style="color:var(--text3);padding:16px 0;text-align:center;">Hələ heç bir alış qeydə alınmayıb.</p>';
  } else {
    el.innerHTML = charges.map(ch => {
      const itemsStr = (ch.items||[]).map(it => `${it.qty}x ${it.name}`).join(', ');
      return `<div class="audit-timeline-item">
        <div class="audit-timeline-text">
          <strong>${esc(ch.tableName)}</strong> — <strong style="color:var(--red);">${(ch.amount||0).toFixed(2)} ₼</strong><br>
          <span style="color:var(--text2);font-size:12px;">${esc(itemsStr)}</span><br>
          <span style="color:var(--text3);font-size:11px;">${esc(ch.staffName||'')}</span>
        </div>
        <div class="audit-timeline-time">${ch.time||''} — ${ch.date||''}</div>
      </div>`;
    }).join('');
  }
  document.getElementById('customerHistoryModal').classList.add('open');
}

export function closeCustomerHistoryModal() {
  document.getElementById('customerHistoryModal').classList.remove('open');
}

/* ═══════════════════════════════════════════
   ÖDƏNİŞ NÖVLƏRİ (ADMİN TƏRƏFİNDƏN TƏNZİMLƏNİR)
═══════════════════════════════════════════ */
export function renderPaymentMethods() {
  const el = document.getElementById('paymentMethodsGrid');
  if (!el) return;
  if (!state.paymentMethods || !state.paymentMethods.length) {
    el.innerHTML = '<p style="color:var(--text3);">Hələ əlavə ödəniş növü yaradılmayıb. Nağd və Bölünmüş ödəniş hər zaman mövcuddur.</p>';
    return;
  }
  el.innerHTML = state.paymentMethods.map(p => `
    <div class="item-card">
      <div class="item-card-header">
        <div style="width:44px;height:44px;border-radius:10px;background:var(--card2);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <svg class="icon" style="width:20px;height:20px;color:var(--blue);"><use href="#i-card"></use></svg>
        </div>
        <div class="item-info"><h3>${esc(p.name)}</h3></div>
      </div>
      <div class="item-actions">
        <button class="btn btn-blue" onclick="editPaymentMethod('${p.id}')"><svg class="icon"><use href="#i-edit"></use></svg> Redaktə</button>
        <button class="btn btn-red" onclick="deletePaymentMethod('${p.id}')"><svg class="icon"><use href="#i-trash"></use></svg> Sil</button>
      </div>
    </div>
  `).join('');
}

export function paymentMethodForm(p = {}) {
  return `<div class="form-group"><label>Ödəniş növünün adı *</label><input type="text" id="pm_name" value="${esc(p.name||'')}" placeholder="Məs: Bank Köçürməsi"></div>`;
}

export function savePaymentMethod() {
  const name = (document.getElementById('pm_name')?.value||'').trim();
  if (!name) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Ad mütləqdir'); return; }

  if (state.editTarget?.type === 'paymentMethod') {
    R.paymentMethods.child(state.editTarget.id).update({ name });
    addLog('admin', `Ödəniş növü redaktə edildi: ${name}`, {});
  } else {
    R.paymentMethods.push({ name, createdAt: Date.now() });
    addLog('admin', `Yeni ödəniş növü yaradıldı: ${name}`, {});
  }
  closeAddModal();
  showToast('<svg class="icon"><use href="#i-check"></use></svg> Ödəniş növü saxlanıldı');
}

export function editPaymentMethod(id) {
  const p = state.paymentMethods.find(x=>x.id===id);
  if (!p) return;
  state.editTarget = { type: 'paymentMethod', id };
  document.getElementById('addModalTitle').innerHTML = '<svg class="icon"><use href="#i-card"></use></svg> Ödəniş Növünü Redaktə Et';
  document.getElementById('addModalBody').innerHTML = paymentMethodForm(p);
  document.getElementById('addModal').classList.add('open');
}

export function deletePaymentMethod(id) {
  const p = state.paymentMethods.find(x=>x.id===id);
  confirmAction(`"${esc(p?.name)}" ödəniş növü silinsin?`, () => {
    R.paymentMethods.child(id).remove();
    addLog('admin', `Ödəniş növü silindi: ${p?.name}`, {});
    showToast('<svg class="icon"><use href="#i-trash"></use></svg> Ödəniş növü silindi');
  });
}

/* ═══════════════════════════════════════════
   BAĞLANAN MASALAR (TARİXÇƏ + BƏRPA)
═══════════════════════════════════════════ */
// Bağlanmış masaya aid ödəniş qeydlərini tapır (sessionId ilə dəqiq uyğunlaşdırma)
function getOrderPayments(o) {
  if (!o.sessionId) return [];
  return (state.payments || []).filter(p => p.sessionId === o.sessionId);
}

export function renderClosedOrders() {
  const listEl = document.getElementById('closedOrdersList');
  const detailEl = document.getElementById('ctDetailPanel');
  const reportEl = document.getElementById('ctReportSummary');
  if (!listEl || !detailEl) return;
  const all = state.closedOrders || [];

  // Filtr seçimlərini bir dəfə doldur (seçim itməsin deyə)
  const staffSel = document.getElementById('ctStaffFilter');
  const openedSel = document.getElementById('ctOpenedByFilter');
  const payTypeSel = document.getElementById('ctPaymentTypeFilter');
  if (staffSel && staffSel.dataset.filled !== 'true') {
    const names = Array.from(new Set(all.map(o => o.staffName).filter(Boolean))).sort();
    staffSel.innerHTML = '<option value="">Hamısı</option>' + names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    staffSel.dataset.filled = 'true';
  }
  if (openedSel && openedSel.dataset.filled !== 'true') {
    const names = Array.from(new Set(all.map(o => o.openedByName).filter(Boolean))).sort();
    openedSel.innerHTML = '<option value="">Hamısı</option>' + names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    openedSel.dataset.filled = 'true';
  }
  if (payTypeSel) {
    // Ödəniş növləri əlavə/silinəndə seçim siyahısı yenilənsin (köhnə, silinmiş növ seçili qalmasın)
    const custom = (state.paymentMethods||[]).map(pm => [pm.id, pm.name]);
    const signature = custom.map(([id]) => id).join(',');
    if (payTypeSel.dataset.signature !== signature) {
      const built = [['cash','Nağd'],['pos','POS']];
      const currentVal = payTypeSel.value;
      payTypeSel.innerHTML = '<option value="">Hamısı</option>' + built.concat(custom).map(([id,name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join('');
      // Seçim hələ mövcuddursa saxlanılır, silinibsə "Hamısı"na qayıdır
      if (built.concat(custom).some(([id]) => id === currentVal)) payTypeSel.value = currentVal;
      payTypeSel.dataset.signature = signature;
    }
  }

  const q = (document.getElementById('ctSearchInput')?.value || '').trim().toLowerCase();
  const dateFrom = document.getElementById('ctDateFrom')?.value || '';
  const dateTo = document.getElementById('ctDateTo')?.value || '';
  const timeFrom = document.getElementById('ctTimeFrom')?.value || '';
  const timeTo = document.getElementById('ctTimeTo')?.value || '';
  const staffFilter = document.getElementById('ctStaffFilter')?.value || '';
  const openedFilter = document.getElementById('ctOpenedByFilter')?.value || '';
  const payTypeFilter = document.getElementById('ctPaymentTypeFilter')?.value || '';
  const restoredOnly = document.getElementById('ctRestoredOnlyFilter')?.checked || false;
  const sortMode = document.getElementById('ctSortSelect')?.value || 'newest';

  let filtered = all.filter(o => {
    if (q) {
      const nameMatch = (o.tableName||'').toLowerCase().includes(q);
      const itemMatch = Object.values(o.items||{}).some(it => (it.name||'').toLowerCase().includes(q));
      if (!nameMatch && !itemMatch) return false;
    }
    if (staffFilter && o.staffName !== staffFilter) return false;
    if (openedFilter && o.openedByName !== openedFilter) return false;
    if (dateFrom) {
      const b = new Date(dateFrom);
      if (timeFrom) { const [h,m] = timeFrom.split(':'); b.setHours(+h,+m,0,0); } else { b.setHours(0,0,0,0); }
      if (o.closedAt < b.getTime()) return false;
    }
    if (dateTo) {
      const b = new Date(dateTo);
      if (timeTo) { const [h,m] = timeTo.split(':'); b.setHours(+h,+m,59,999); } else { b.setHours(23,59,59,999); }
      if (o.closedAt > b.getTime()) return false;
    }
    if (payTypeFilter) {
      const pays = getOrderPayments(o);
      // Bölünmüş ödənişin daxilində müvafiq növ (nağd/POS/...) varsa da uyğun sayılır,
      // "bölünmüş" adı altında gizlənməsin deyə
      const matches = pays.some(p => p.type === payTypeFilter || (p.type === 'split' && p.splitBreakdown && p.splitBreakdown[payTypeFilter] > 0));
      if (!matches) return false;
    }
    if (restoredOnly && !(o.restoreCount > 0)) return false;
    return true;
  });
  filtered.sort((a,b) => {
    if (sortMode === 'oldest') return (a.closedAt||0) - (b.closedAt||0);
    if (sortMode === 'amount_desc') return (b.total||0) - (a.total||0);
    if (sortMode === 'amount_asc') return (a.total||0) - (b.total||0);
    return (b.closedAt||0) - (a.closedAt||0);
  });

  // ── Hesabat xülasəsi (filtrlənmiş nəticələr üçün) ──
  if (reportEl) {
    const typeBreakdown = {};
    // Canlı siyahıdan tapmağa çalışır, tapılmasa (növ silinibsə) "Silinmiş növ" yazır -
    // heç vaxt xam Firebase ID-si göstərilmir.
    const resolveMethodName = (id) => id==='cash'?'Nağd':id==='pos'?'POS':((state.paymentMethods||[]).find(m=>m.id===id)?.name || 'Silinmiş növ');
    filtered.forEach(o => {
      getOrderPayments(o).forEach(p => {
        // Bölünmüş ödəniş öz komponentlərinə (Nağd/POS/...) ayrılaraq hesabata yazılır,
        // "Bölünmüş" adı altında tək məbləğ kimi yox. Ödənişin öz üzərində "dondurulmuş"
        // adı varsa (splitMethodNames) ONU üstün tuturuq - növ sonradan silinsə belə düzgün görünsün.
        if (p.type === 'split' && p.splitBreakdown) {
          Object.entries(p.splitBreakdown).forEach(([methodId, amount]) => {
            const key = p.splitMethodNames?.[methodId] || resolveMethodName(methodId);
            typeBreakdown[key] = (typeBreakdown[key]||0) + (amount||0);
          });
        } else {
          const key = p.typeLabel || p.type;
          typeBreakdown[key] = (typeBreakdown[key]||0) + (p.thisPay||0);
        }
      });
    });
    // Ödəniş növü filtrlənibsə, yekun məbləğ MASALARIN TAM cəmi yox, YALNIZ o növün payı olur
    // (məs. "Nağd" filtrində, kart+nağd bölünmüş ödənişi olan masanın yalnız nağd hissəsi sayılır)
    const totalRevenue = payTypeFilter
      ? (typeBreakdown[resolveMethodName(payTypeFilter)] || 0)
      : filtered.reduce((s,o)=>s+(o.total||0),0);
    const breakdownEntries = Object.entries(typeBreakdown)
      .filter(([label]) => !payTypeFilter || label === resolveMethodName(payTypeFilter));
    reportEl.innerHTML = `<div class="ct-report">
      <div class="ct-report__stats">
        <div><div class="ct-report__stat-label">Bağlanan masa</div><div class="ct-report__stat-value">${filtered.length}</div></div>
        <div><div class="ct-report__stat-label">${payTypeFilter ? esc(resolveMethodName(payTypeFilter)) + ' ilə ödənilmiş məbləğ' : 'Ümumi məbləğ'}</div><div class="ct-report__stat-value" style="color:var(--green);">${totalRevenue.toFixed(2)} ₼</div></div>
        <div><div class="ct-report__stat-label">Orta çek</div><div class="ct-report__stat-value">${(filtered.length?totalRevenue/filtered.length:0).toFixed(2)} ₼</div></div>
      </div>
      ${breakdownEntries.length ? `<div class="ct-report__breakdown">
        ${breakdownEntries.map(([label,amount]) => `<div class="ct-report__type-chip"><b>${esc(label)}</b> ${amount.toFixed(2)} ₼</div>`).join('')}
      </div>` : ''}
    </div>`;
  }

  if (state._ctSelectAllPending !== undefined) {
    state._selectedClosedOrderIds = state._ctSelectAllPending ? filtered.map(o=>o.id) : [];
    state._ctSelectAllPending = undefined;
  }
  state._selectedClosedOrderIds = (state._selectedClosedOrderIds||[]).filter(id => filtered.some(o=>o.id===id));
  const delBtn = document.getElementById('ctDeleteSelectedBtn');
  if (delBtn) {
    delBtn.style.display = state._selectedClosedOrderIds.length ? 'inline-flex' : 'none';
    delBtn.innerHTML = `<svg class="icon"><use href="#i-trash"></use></svg> Seçilənləri Sil (${state._selectedClosedOrderIds.length})`;
  }
  const selectAllCb = document.getElementById('ctSelectAllCheckbox');
  if (selectAllCb) selectAllCb.checked = filtered.length>0 && filtered.every(o=>state._selectedClosedOrderIds.includes(o.id));

  if (!filtered.length) {
    listEl.innerHTML = '<p class="ct-list-empty">Filtrə uyğun bağlanan masa tapılmadı.</p>';
    detailEl.innerHTML = '<div class="ct-detail-empty"><svg class="icon" style="width:32px;height:32px;"><use href="#i-clipboard"></use></svg><p style="margin-top:10px;">Baxmaq üçün soldan bir masa seçin</p></div>';
    return;
  }

  // Seçili detal qeydi filtrdən sonra da mövcuddursa saxlanılır; YOXSA sıfırlanır -
  // avtomatik olaraq ilk nəticə seçilmir, yalnız üzərinə vuranda açılır.
  if (state._selectedClosedOrderId && !filtered.find(o => o.id === state._selectedClosedOrderId)) {
    state._selectedClosedOrderId = null;
  }

  listEl.innerHTML = `<div class="ct-list-count">${filtered.length} nəticə</div>` + filtered.slice(0,150).map(o => `
    <div class="ct-list-item ${o.id===state._selectedClosedOrderId?'active':''}" onclick="selectClosedOrder('${o.id}')">
      <div class="ct-list-item__top">
        <label style="display:flex;align-items:center;gap:8px;" onclick="event.stopPropagation()">
          <input type="checkbox" onchange="toggleClosedOrderSelect('${o.id}')" ${state._selectedClosedOrderIds.includes(o.id)?'checked':''} style="width:16px;height:16px;cursor:pointer;flex-shrink:0;">
          <span class="ct-list-item__name">${esc(o.tableName)}</span>
          ${o.restoreCount ? `<span style="font-size:10px;font-weight:700;color:var(--orange);background:rgba(243,156,18,.15);border-radius:6px;padding:1px 6px;" title="${o.restoreCount} dəfə bərpa edilib">${o.restoreCount}× bərpa</span>` : ''}
        </label>
        <span class="ct-list-item__amount">${(o.total||0).toFixed(2)} ₼</span>
      </div>
      <div class="ct-list-item__meta">${esc(o.staffName||'')} · ${esc(o.closedDate||'')} ${esc(o.closedTime||'')}</div>
    </div>
  `).join('');

  if (state._selectedClosedOrderId) {
    renderClosedOrderDetail(filtered.find(o => o.id === state._selectedClosedOrderId));
  } else {
    detailEl.innerHTML = '<div class="ct-detail-empty"><svg class="icon" style="width:32px;height:32px;"><use href="#i-clipboard"></use></svg><p style="margin-top:10px;">Baxmaq üçün soldan bir masa seçin</p></div>';
  }
}

export function toggleClosedOrderSelect(id) {
  state._selectedClosedOrderIds = state._selectedClosedOrderIds || [];
  const i = state._selectedClosedOrderIds.indexOf(id);
  if (i === -1) state._selectedClosedOrderIds.push(id); else state._selectedClosedOrderIds.splice(i,1);
  const btn = document.getElementById('ctDeleteSelectedBtn');
  if (btn) {
    btn.style.display = state._selectedClosedOrderIds.length ? 'inline-flex' : 'none';
    btn.innerHTML = `<svg class="icon"><use href="#i-trash"></use></svg> Seçilənləri Sil (${state._selectedClosedOrderIds.length})`;
  }
}

export function toggleSelectAllClosedOrders(checked) {
  state._ctSelectAllPending = checked;
  renderClosedOrders();
}

export function deleteSelectedClosedOrders() {
  const ids = state._selectedClosedOrderIds || [];
  if (!ids.length) return;
  confirmDelete2x(ids.length, 'bağlanmış masa qeydi', () => {
    ids.forEach(id => db.ref('closedOrders/' + id).remove());
    addLog('admin', `Admin ${ids.length} bağlanmış masa qeydini seçib sildi`, {});
    showToast(`<svg class="icon"><use href="#i-check"></use></svg> ${ids.length} qeyd silindi`);
    state._selectedClosedOrderIds = [];
    if (ids.includes(state._selectedClosedOrderId)) state._selectedClosedOrderId = null;
  });
}

export function selectClosedOrder(id) {
  state._selectedClosedOrderId = id;
  renderClosedOrders();
}

function renderClosedOrderDetail(o) {
  const detailEl = document.getElementById('ctDetailPanel');
  if (!detailEl || !o) return;
  const isAdmin = state.user?.role === 'admin';
  const sessionLog = o.sessionLog || [];
  const firstEntry = sessionLog[0];
  const payments = getOrderPayments(o);

  const itemsHtml = Object.values(o.items||{}).map(it => `
    <div class="ct-detail-item-row">
      <span>${it.qty}x ${esc(it.name)}${it.compliment?' <span style="color:var(--green);font-size:11px;">(İKRAM)</span>':''}</span>
      <span style="font-weight:600;">${((it.price||0)*it.qty*(1-((it.discountPercent||0)/100))+(it.extraFee||0)).toFixed(2)} ₼</span>
    </div>
  `).join('') || '<p style="color:var(--text3);font-size:13px;">Mal qeydi yoxdur.</p>';

  const paymentsHtml = payments.length ? payments.map(p => `
    <div class="ct-detail-item-row">
      <span><svg class="icon" style="width:.85em;height:.85em;"><use href="#i-card"></use></svg> ${esc(p.typeLabel||p.type)} — ${esc(p.staffName||'')}${p.splitLabel ? `<br><small style="color:var(--text3);">${esc(p.splitLabel)}</small>` : ''}</span>
      <span style="font-weight:600;color:var(--green);">${(p.thisPay||0).toFixed(2)} ₼</span>
    </div>
  `).join('') : '<p style="color:var(--text3);font-size:13px;">Ödəniş qeydi tapılmadı (köhnə sessiya ola bilər).</p>';

  const historyHtml = sessionLog.length ? sessionLog.map(l => `
    <div class="audit-timeline-item">
      <div class="audit-timeline-time">${esc(l.time||'')}</div>
      <div class="audit-timeline-text">${esc(stripTableName(l.message, o.tableName))}</div>
    </div>
  `).join('') : '<p style="color:var(--text3);font-size:13px;">Tarixçə qeydi yoxdur.</p>';

  detailEl.innerHTML = `
    <div class="ct-detail-header">
      <span><svg class="icon"><use href="#i-clipboard"></use></svg> ${esc(o.tableName)} ${o.restoreCount ? `<span style="font-size:12px;color:var(--orange);font-weight:700;" title="${o.restoreCount} dəfə bərpa edilib">(${o.restoreCount}× bərpa)</span>` : ''}</span>
      <span style="font-size:22px;font-weight:800;color:var(--green);">${(o.total||0).toFixed(2)} ₼</span>
    </div>
    <div class="ct-detail-info-grid">
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Açılış</div><div class="ct-detail-info-block__value">${esc(firstEntry?`${firstEntry.date} ${firstEntry.time}`:'—')}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Bağlanış</div><div class="ct-detail-info-block__value">${esc(o.closedDate||'')} ${esc(o.closedTime||'')}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Açan</div><div class="ct-detail-info-block__value">${esc(o.openedByName||'—')}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Bağlayan</div><div class="ct-detail-info-block__value">${esc(o.staffName||'—')}</div></div>
    </div>
    <div class="ct-detail-section-title"><svg class="icon" style="width:.9em;height:.9em;"><use href="#i-food"></use></svg> Sifariş Edilən Mallar</div>
    ${itemsHtml}
    <div class="ct-detail-section-title"><svg class="icon" style="width:.9em;height:.9em;"><use href="#i-money"></use></svg> Ödəmələr</div>
    ${paymentsHtml}
    <div class="ct-detail-section-title"><svg class="icon" style="width:.9em;height:.9em;"><use href="#i-clipboard"></use></svg> Sessiya Tarixçəsi</div>
    <div class="audit-timeline">${historyHtml}</div>
    <div class="ct-detail-actions" style="flex-direction:column;align-items:stretch;">
      ${isAdmin ? `<button class="btn btn-blue" style="padding:11px;" onclick="restoreClosedOrder('${o.id}')"><svg class="icon"><use href="#i-refresh"></use></svg> Bərpa Et</button>` : ''}
      ${isAdmin ? `<small style="color:var(--text3);text-align:center;margin-top:6px;">"${esc((o.tableName||'').replace(/\s*\*+$/,''))} ${'*'.repeat((o.restoreCount||0)+1)}" adı ilə müvəqqəti masa yaradılacaq, sabit masaya toxunulmayacaq</small>` : ''}
    </div>
  `;
}

/* ═══════════════════════════════════════════
   QEYDİYYAT OLUNANLAR (Müştəri Tanıma & Loyallıq Modulu)
═══════════════════════════════════════════ */

export function renderLoyaltyCustomers() {
  const listEl = document.getElementById('loyaltyCustomersList');
  const detailEl = document.getElementById('lcDetailPanel');
  if (!listEl || !detailEl) return;
  const all = state.loyaltyCustomers || [];

  const q = (document.getElementById('lcSearchInput')?.value || '').trim().toLowerCase();
  const filtered = all.filter(c => {
    if (!q) return true;
    const full = `${c.firstName||''} ${c.lastName||''} ${c.phone||''}`.toLowerCase();
    return full.includes(q);
  });

  state._selectedLoyaltyCustomerIds = (state._selectedLoyaltyCustomerIds||[]).filter(id => filtered.some(c=>c.id===id));
  const delBtn = document.getElementById('lcDeleteSelectedBtn');
  if (delBtn) {
    delBtn.style.display = state._selectedLoyaltyCustomerIds.length ? 'inline-flex' : 'none';
    delBtn.innerHTML = `<svg class="icon"><use href="#i-trash"></use></svg> Seçilənləri Sil (${state._selectedLoyaltyCustomerIds.length})`;
  }
  const selectAllCb = document.getElementById('lcSelectAllCheckbox');
  if (selectAllCb) selectAllCb.checked = filtered.length>0 && filtered.every(c=>state._selectedLoyaltyCustomerIds.includes(c.id));

  if (!filtered.length) {
    listEl.innerHTML = '<p class="ct-list-empty">Qeydiyyatlı müştəri tapılmadı.</p>';
    detailEl.innerHTML = '<div class="ct-detail-empty"><svg class="icon" style="width:32px;height:32px;"><use href="#i-users"></use></svg><p style="margin-top:10px;">Baxmaq üçün soldan bir müştəri seçin</p></div>';
    return;
  }
  if (state._selectedLoyaltyCustomerId && !filtered.find(c => c.id === state._selectedLoyaltyCustomerId)) {
    state._selectedLoyaltyCustomerId = null;
  }

  listEl.innerHTML = `<div class="ct-list-count">${filtered.length} nəticə</div>` + filtered.map(c => `
    <div class="ct-list-item ${c.id===state._selectedLoyaltyCustomerId?'active':''}" onclick="selectLoyaltyCustomer('${c.id}')">
      <div class="ct-list-item__top">
        <label style="display:flex;align-items:center;gap:8px;" onclick="event.stopPropagation()">
          <input type="checkbox" onchange="toggleLoyaltyCustomerSelect('${c.id}')" ${state._selectedLoyaltyCustomerIds.includes(c.id)?'checked':''} style="width:16px;height:16px;cursor:pointer;flex-shrink:0;">
          <span class="ct-list-item__name">${esc(c.firstName)} ${esc(c.lastName)}</span>
        </label>
        <span class="ct-list-item__amount" style="color:var(--gold-dark);">${c.bonus||0} bal</span>
      </div>
      <div class="ct-list-item__meta">${esc(c.phone||'')}</div>
    </div>
  `).join('');

  if (state._selectedLoyaltyCustomerId) {
    renderLoyaltyCustomerDetail(filtered.find(c => c.id === state._selectedLoyaltyCustomerId));
  } else {
    detailEl.innerHTML = '<div class="ct-detail-empty"><svg class="icon" style="width:32px;height:32px;"><use href="#i-users"></use></svg><p style="margin-top:10px;">Baxmaq üçün soldan bir müştəri seçin</p></div>';
  }
}

export function selectLoyaltyCustomer(id) {
  state._selectedLoyaltyCustomerId = id;
  renderLoyaltyCustomers();
}

function renderLoyaltyCustomerDetail(c) {
  const el = document.getElementById('lcDetailPanel');
  if (!el || !c) return;

  db.ref('referrals').orderByChild('referrerCustomerId').equalTo(c.id).once('value', snap => {
    const referrals = toArr(snap.val());
    const completedCount = referrals.filter(r=>r.status==='completed').length;
    const referralsHtml = referrals.length ? referrals.map(r => {
      const referred = state.loyaltyCustomers.find(x=>x.id===r.referredCustomerId);
      return `<div class="ct-detail-item-row">
        <span>${esc(referred ? referred.firstName+' '+referred.lastName : 'Naməlum')}</span>
        <span style="color:${r.status==='completed'?'var(--green)':'var(--orange)'};font-weight:600;">${r.status==='completed'?'Tamamlandı':'Gözləmədə'}</span>
      </div>`;
    }).join('') : '<p style="color:var(--text3);font-size:13px;">Hələ heç kimi dəvət etməyib.</p>';

    el.innerHTML = `
      <div class="ct-detail-header">
        <span><svg class="icon"><use href="#i-users"></use></svg> ${esc(c.firstName)} ${esc(c.lastName)}</span>
        <span style="font-size:20px;font-weight:800;color:var(--gold-dark);">${c.bonus||0} bal</span>
      </div>
      <div class="ct-detail-info-grid">
        <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Ata adı</div><div class="ct-detail-info-block__value">${esc(c.fatherName||'—')}</div></div>
        <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Telefon</div><div class="ct-detail-info-block__value">${esc(c.phone||'—')}</div></div>
        <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Cins</div><div class="ct-detail-info-block__value">${esc(c.gender||'—')}</div></div>
        <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Doğum tarixi</div><div class="ct-detail-info-block__value">${esc(c.birthDate||'—')}</div></div>
        <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Qeydiyyat tarixi</div><div class="ct-detail-info-block__value">${c.registrationDate ? new Date(c.registrationDate).toLocaleDateString('az-AZ') : '—'}</div></div>
        <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Referral kodu</div><div class="ct-detail-info-block__value">${esc(c.referralCode||'—')}</div></div>
      </div>
      <div class="ct-detail-section-title"><svg class="icon" style="width:.9em;height:.9em;"><use href="#i-users"></use></svg> Dəvət etdiyi şəxslər (${completedCount}/${referrals.length} tamamlanıb)</div>
      ${referralsHtml}
      <div class="ct-detail-actions">
        <button class="btn btn-blue" style="flex:1;padding:11px;" onclick="openLoyaltyEditModal('${c.id}')"><svg class="icon"><use href="#i-tag"></use></svg> Redaktə Et</button>
        <button class="btn btn-red" style="flex:1;padding:11px;" onclick="deleteSingleLoyaltyCustomer('${c.id}')"><svg class="icon"><use href="#i-trash"></use></svg> Sil</button>
      </div>
    `;
  });
}

export function toggleLoyaltyCustomerSelect(id) {
  state._selectedLoyaltyCustomerIds = state._selectedLoyaltyCustomerIds || [];
  const i = state._selectedLoyaltyCustomerIds.indexOf(id);
  if (i === -1) state._selectedLoyaltyCustomerIds.push(id); else state._selectedLoyaltyCustomerIds.splice(i,1);
  const btn = document.getElementById('lcDeleteSelectedBtn');
  if (btn) {
    btn.style.display = state._selectedLoyaltyCustomerIds.length ? 'inline-flex' : 'none';
    btn.innerHTML = `<svg class="icon"><use href="#i-trash"></use></svg> Seçilənləri Sil (${state._selectedLoyaltyCustomerIds.length})`;
  }
}

export function toggleSelectAllLoyaltyCustomers(checked) {
  const q = (document.getElementById('lcSearchInput')?.value || '').trim().toLowerCase();
  const filtered = (state.loyaltyCustomers||[]).filter(c => {
    if (!q) return true;
    return `${c.firstName||''} ${c.lastName||''} ${c.phone||''}`.toLowerCase().includes(q);
  });
  state._selectedLoyaltyCustomerIds = checked ? filtered.map(c=>c.id) : [];
  renderLoyaltyCustomers();
}

export function deleteSelectedLoyaltyCustomers() {
  const ids = state._selectedLoyaltyCustomerIds || [];
  if (!ids.length) return;
  confirmDelete2x(ids.length, 'qeydiyyatlı müştəri', () => {
    ids.forEach(id => db.ref('loyaltyCustomers/' + id).remove());
    addLog('admin', `Admin ${ids.length} qeydiyyatlı müştərini seçib sildi`, {});
    showToast(`<svg class="icon"><use href="#i-check"></use></svg> ${ids.length} müştəri silindi`);
    state._selectedLoyaltyCustomerIds = [];
    if (ids.includes(state._selectedLoyaltyCustomerId)) state._selectedLoyaltyCustomerId = null;
  });
}

export function deleteSingleLoyaltyCustomer(id) {
  const c = state.loyaltyCustomers.find(x=>x.id===id);
  if (!c) return;
  confirmDelete2x(1, `"${c.firstName} ${c.lastName}" adlı müştəri`, () => {
    db.ref('loyaltyCustomers/' + id).remove();
    addLog('admin', `Admin qeydiyyatlı müştərini sildi: ${c.firstName} ${c.lastName}`, {});
    showToast('<svg class="icon"><use href="#i-check"></use></svg> Müştəri silindi');
    if (state._selectedLoyaltyCustomerId === id) state._selectedLoyaltyCustomerId = null;
  });
}

export function openLoyaltyEditModal(id) {
  const c = state.loyaltyCustomers.find(x=>x.id===id);
  if (!c) return;
  document.getElementById('lcEditModal').dataset.editId = id;
  document.getElementById('lcEditFirstName').value = c.firstName || '';
  document.getElementById('lcEditLastName').value = c.lastName || '';
  document.getElementById('lcEditFatherName').value = c.fatherName || '';
  document.getElementById('lcEditPhone').value = c.phone || '';
  document.getElementById('lcEditGender').value = c.gender || '';
  document.getElementById('lcEditBirthDate').value = c.birthDate || '';
  document.getElementById('lcEditBonus').value = c.bonus || 0;
  document.getElementById('lcEditModal').classList.add('open');
}
export function closeLoyaltyEditModal() {
  document.getElementById('lcEditModal').classList.remove('open');
}
export function saveLoyaltyCustomerEdit() {
  const id = document.getElementById('lcEditModal').dataset.editId;
  if (!id) return;
  const updated = {
    firstName: document.getElementById('lcEditFirstName').value.trim(),
    lastName: document.getElementById('lcEditLastName').value.trim(),
    fatherName: document.getElementById('lcEditFatherName').value.trim(),
    phone: document.getElementById('lcEditPhone').value.trim(),
    gender: document.getElementById('lcEditGender').value,
    birthDate: document.getElementById('lcEditBirthDate').value,
    bonus: parseFloat(document.getElementById('lcEditBonus').value) || 0
  };
  if (!updated.firstName || !updated.lastName || !updated.phone) {
    showToast('<svg class="icon"><use href="#i-warning"></use></svg> Ad, soyad və telefon mütləqdir');
    return;
  }
  db.ref('loyaltyCustomers/' + id).update(updated);
  addLog('admin', `Admin qeydiyyatlı müştərini redaktə etdi: ${updated.firstName} ${updated.lastName}`, {});
  closeLoyaltyEditModal();
  showToast('<svg class="icon"><use href="#i-check"></use></svg> Məlumatlar yeniləndi');
}

/* ═══════════════════════════════════════════
   TƏCHİZATÇILAR & MƏHSUL ALIŞLARI
═══════════════════════════════════════════ */

export function renderSuppliers() {
  const el = document.getElementById('suppliersGrid');
  if (!el) return;
  if (!state.suppliers.length) {
    el.innerHTML = '<p style="color:var(--text3);">Hələ təchizatçı əlavə edilməyib. Sağ alt küncdəki "+" düyməsi ilə əlavə edin.</p>';
    return;
  }

  el.innerHTML = state.suppliers.map(s => {
    const debt = s.totalDebt || 0;
    return `<div class="tile-card" onclick="selectSupplierMgmt('${s.id}')">
      <div class="tile-card__icon"><svg class="icon"><use href="#i-users"></use></svg></div>
      <div class="tile-card__name">${esc(s.name)}</div>
      <div class="tile-card__meta">${esc(s.category||'')}</div>
      <span class="supplier-debt-badge ${debt>0?'supplier-debt-badge--owed':'supplier-debt-badge--clear'} tile-card__badge">${debt>0?debt.toFixed(2)+' ₼':'Təmiz'}</span>
    </div>`;
  }).join('');

  if (state._selectedSupplierMgmtId) {
    const s = state.suppliers.find(x => x.id === state._selectedSupplierMgmtId);
    if (s) renderSupplierMgmtDetail(s); else selectSupplierMgmt(null);
  }
}

export function selectSupplierMgmt(id) {
  state._selectedSupplierMgmtId = id;
  const overlay = document.getElementById('suppliersDetailPanel');
  if (!id) { overlay?.classList.remove('open'); return; }
  const s = state.suppliers.find(x => x.id === id);
  if (!s) { overlay?.classList.remove('open'); return; }
  renderSupplierMgmtDetail(s);
  overlay?.classList.add('open');
}

function renderSupplierMgmtDetail(s) {
  const el = document.getElementById('suppliersDetailBody');
  if (!el || !s) return;
  const debt = s.totalDebt || 0;
  const recentPurchases = state.purchases.filter(p => p.supplierId === s.id).slice(0, 5);
  el.innerHTML = `
    <div class="ct-detail-header">
      <span><svg class="icon"><use href="#i-users"></use></svg> ${esc(s.name)}</span>
      <span class="supplier-debt-badge ${debt>0?'supplier-debt-badge--owed':'supplier-debt-badge--clear'}" style="font-size:14px;">${debt>0?debt.toFixed(2)+' ₼ borc':'Borc yoxdur'}</span>
    </div>
    <div class="ct-detail-info-grid">
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Telefon</div><div class="ct-detail-info-block__value">${esc(s.phone||'—')}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Kateqoriya</div><div class="ct-detail-info-block__value">${esc(s.category||'—')}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Ünvan</div><div class="ct-detail-info-block__value">${esc(s.address||'—')}</div></div>
    </div>
    ${s.notes ? `<div class="ct-detail-section-title">Qeyd</div><p style="font-size:13px;color:var(--text2);">${esc(s.notes)}</p>` : ''}
    ${recentPurchases.length ? `
      <div class="ct-detail-section-title"><svg class="icon" style="width:.9em;height:.9em;"><use href="#i-cash"></use></svg> Son alışlar</div>
      ${recentPurchases.map(p => `<div class="ct-detail-item-row"><span>№${esc(p.invoiceNumber||'—')} · ${esc(p.date||'')}</span><span style="font-weight:600;">${(p.totalAmount||0).toFixed(2)} ₼</span></div>`).join('')}
    ` : ''}
    <div class="ct-detail-actions">
      <button class="btn btn-blue" style="flex:1;padding:11px;" onclick="openSupplierModal('${s.id}')"><svg class="icon"><use href="#i-tag"></use></svg> Redaktə Et</button>
      <button class="btn btn-red" style="flex:1;padding:11px;" onclick="deleteSupplier('${s.id}')"><svg class="icon"><use href="#i-trash"></use></svg> Sil</button>
    </div>
  `;
}

export function openSupplierModal(id) {
  document.getElementById('supplierModal').dataset.editId = id || '';
  const s = id ? state.suppliers.find(x=>x.id===id) : null;
  document.getElementById('supplierModalTitle').innerHTML = `<svg class="icon"><use href="#i-users"></use></svg> ${id?'Təchizatçını Redaktə Et':'Yeni Təchizatçı'}`;
  document.getElementById('supName').value = s?.name || '';
  document.getElementById('supPhone').value = s?.phone || '';
  document.getElementById('supAddress').value = s?.address || '';
  document.getElementById('supCategory').value = s?.category || '';
  document.getElementById('supNotes').value = s?.notes || '';
  document.getElementById('supplierModal').classList.add('open');
}
export function closeSupplierModal() { document.getElementById('supplierModal').classList.remove('open'); }

export function saveSupplier() {
  const name = document.getElementById('supName').value.trim();
  if (!name) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Ad mütləqdir'); return; }
  const data = {
    name, phone: document.getElementById('supPhone').value.trim(),
    address: document.getElementById('supAddress').value.trim(),
    category: document.getElementById('supCategory').value.trim(),
    notes: document.getElementById('supNotes').value.trim()
  };
  const editId = document.getElementById('supplierModal').dataset.editId;
  if (editId) {
    db.ref('suppliers/'+editId).update(data);
    addLog('admin', `Təchizatçı redaktə edildi: ${name}`, {});
  } else {
    data.totalDebt = 0; data.createdAt = Date.now();
    db.ref('suppliers').push(data);
    addLog('admin', `Yeni təchizatçı əlavə edildi: ${name}`, {});
  }
  closeSupplierModal();
  showToast('<svg class="icon"><use href="#i-check"></use></svg> Yadda saxlanıldı');
}

export function deleteSupplier(id) {
  const s = state.suppliers.find(x=>x.id===id);
  if (!s) return;
  if ((s.totalDebt||0) > 0) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Borcu olan təchizatçı silinə bilməz, əvvəlcə borcu sıfırlayın'); return; }
  confirmDelete2x(1, `"${s.name}" adlı təchizatçı`, () => {
    db.ref('suppliers/'+id).remove();
    addLog('admin', `Təchizatçı silindi: ${s.name}`, {});
    showToast('<svg class="icon"><use href="#i-check"></use></svg> Təchizatçı silindi');
  });
}

export function renderPurchases() {
  const listEl = document.getElementById('purchasesList');
  const detailEl = document.getElementById('purDetailPanel');
  if (!listEl || !detailEl) return;
  const q = (document.getElementById('purSearchInput')?.value || '').trim().toLowerCase();
  const filtered = state.purchases.filter(p => {
    if (!q) return true;
    return `${p.supplierName||''} ${p.invoiceNumber||''}`.toLowerCase().includes(q);
  });
  if (!filtered.length) {
    listEl.innerHTML = '<p class="ct-list-empty">Alış qeydi tapılmadı. Sağ alt küncdəki "+" düyməsi ilə əlavə edin.</p>';
    detailEl.innerHTML = '<div class="ct-detail-empty"><svg class="icon" style="width:32px;height:32px;"><use href="#i-cash"></use></svg><p style="margin-top:10px;">Baxmaq üçün soldan bir alış seçin</p></div>';
    return;
  }
  if (state._selectedPurchaseId && !filtered.find(p=>p.id===state._selectedPurchaseId)) state._selectedPurchaseId = null;

  listEl.innerHTML = `<div class="ct-list-count">${filtered.length} nəticə</div>` + filtered.map(p => `
    <div class="ct-list-item ${p.id===state._selectedPurchaseId?'active':''}" onclick="selectPurchase('${p.id}')">
      <div class="ct-list-item__top">
        <span class="ct-list-item__name">${esc(p.supplierName)}</span>
        <span class="ct-list-item__amount">${(p.totalAmount||0).toFixed(2)} ₼</span>
      </div>
      <div class="ct-list-item__meta">№${esc(p.invoiceNumber||'—')} · ${esc(p.date||'')} · ${p.paymentStatus==='paid'?'Tam ödənilib':p.paymentStatus==='partial'?'Qismən ödənilib':'Nisyə'}</div>
    </div>
  `).join('');

  if (state._selectedPurchaseId) renderPurchaseDetail(filtered.find(p=>p.id===state._selectedPurchaseId));
  else detailEl.innerHTML = '<div class="ct-detail-empty"><svg class="icon" style="width:32px;height:32px;"><use href="#i-cash"></use></svg><p style="margin-top:10px;">Baxmaq üçün soldan bir alış seçin</p></div>';
}

export function selectPurchase(id) { state._selectedPurchaseId = id; renderPurchases(); }

function renderPurchaseDetail(p) {
  const el = document.getElementById('purDetailPanel');
  if (!el || !p) return;
  const statusLabel = p.paymentStatus==='paid'?'Tam ödənilib':p.paymentStatus==='partial'?'Qismən ödənilib':'Nisyə (borc)';
  const typeLabel = {cash:'Nağd',transfer:'Köçürmə',card:'Kart'}[p.paymentType] || p.paymentType;
  el.innerHTML = `
    <div class="ct-detail-header">
      <span><svg class="icon"><use href="#i-cash"></use></svg> ${esc(p.supplierName)}</span>
      <span style="font-size:20px;font-weight:800;color:var(--green);">${(p.totalAmount||0).toFixed(2)} ₼</span>
    </div>
    <div class="ct-detail-info-grid">
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Faktura №</div><div class="ct-detail-info-block__value">${esc(p.invoiceNumber||'—')}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Tarix</div><div class="ct-detail-info-block__value">${esc(p.date||'—')}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Ödəniş növü</div><div class="ct-detail-info-block__value">${esc(typeLabel)}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Status</div><div class="ct-detail-info-block__value" style="color:${p.paymentStatus==='paid'?'var(--green)':'var(--orange)'};">${statusLabel}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Qəbul edən</div><div class="ct-detail-info-block__value">${esc(p.staffName||'—')}</div></div>
    </div>
    <div class="ct-detail-section-title"><svg class="icon" style="width:.9em;height:.9em;"><use href="#i-food"></use></svg> Mallar</div>
    ${(p.items||[]).map(it => `
      <div class="ct-detail-item-row">
        <span>${it.qty} ${esc(it.unit||'')} × ${esc(it.name)}${it.isTrackable?' <span style="color:var(--blue);font-size:11px;">(anbarda izlənir)</span>':''}</span>
        <span style="font-weight:600;">${(it.total||0).toFixed(2)} ₼</span>
      </div>
    `).join('')}
    ${p.notes ? `<div class="ct-detail-section-title">Qeyd</div><p style="font-size:13px;color:var(--text2);">${esc(p.notes)}</p>` : ''}
    <div class="ct-detail-actions">
      <button class="btn btn-blue" style="flex:1;padding:11px;" onclick="openPurchaseModal('${p.id}')"><svg class="icon"><use href="#i-tag"></use></svg> Redaktə Et</button>
      <button class="btn btn-red" style="flex:1;padding:11px;" onclick="deletePurchase('${p.id}')"><svg class="icon"><use href="#i-trash"></use></svg> Sil</button>
    </div>
  `;
}

export function deletePurchase(id) {
  const p = state.purchases.find(x=>x.id===id);
  if (!p) return;
  confirmDelete2x(1, `"${p.supplierName}" təchizatçısından alış qeydi`, () => {
    // Silinəndə əvvəlcə bu alışın borc/stok təsiri geri alınır - əks halda təchizatçının
    // borcu və mal stoku bu alışın hesabına yanlış qalardı.
    const debtDelta = Math.round(((p.totalAmount||0) - (p.paidAmount||0)) * 100) / 100;
    if (debtDelta !== 0) {
      db.ref('suppliers/'+p.supplierId+'/totalDebt').transaction(cur => Math.max(0, Math.round(((cur||0) - debtDelta)*100)/100));
    }
    (p.items||[]).filter(it => it.isTrackable).forEach(it => {
      const existing = state.menuItems.find(m => m.isTrackable && m.name.trim().toLowerCase() === it.name.trim().toLowerCase());
      if (existing) {
        R.menuItems.child(existing.id).child('stock').transaction(cur => Math.max(0, (cur||0) - it.qty));
      }
    });
    db.ref('purchases/'+id).remove();
    addLog('admin', `Alış qeydi silindi: ${p.supplierName} - №${p.invoiceNumber}`, {});
    showToast('<svg class="icon"><use href="#i-check"></use></svg> Alış qeydi silindi');
    if (state._selectedPurchaseId === id) state._selectedPurchaseId = null;
  });
}

export function openPurchaseModal(editId) {
  if (!state.suppliers.length) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Əvvəlcə "Təchizatçılar" bölməsindən təchizatçı əlavə edin'); return; }
  const existing = editId ? state.purchases.find(p => p.id === editId) : null;
  document.getElementById('purchaseModal').dataset.editId = editId || '';
  document.getElementById('purchaseModalTitle').innerHTML = existing
    ? '<svg class="icon"><use href="#i-cash"></use></svg> Alışı Redaktə Et'
    : '<svg class="icon"><use href="#i-cash"></use></svg> Yeni Alış';

  state._purchaseDraftLines = existing
    ? existing.items.map((it, i) => ({ id: 'l'+Date.now()+i, name: it.name, category: it.category||'', qty: it.qty, unit: it.unit||'ədəd', unitPrice: it.unitPrice, isTrackable: !!it.isTrackable, newSalePrice: 0 }))
    : [{ id: 'l'+Date.now(), name:'', category:'', qty:1, unit:'ədəd', unitPrice:0, isTrackable:false, newSalePrice:0 }];

  const supSel = document.getElementById('purSupplier');
  supSel.innerHTML = state.suppliers.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  if (existing) supSel.value = existing.supplierId;
  document.getElementById('purInvoiceNumber').value = existing?.invoiceNumber || '';
  document.getElementById('purDate').value = existing?.date || new Date().toISOString().split('T')[0];
  document.getElementById('purPaymentType').value = existing?.paymentType || 'cash';
  document.getElementById('purPaymentStatus').value = existing?.paymentStatus || 'paid';
  document.getElementById('purPaidAmount').value = existing?.paidAmount || '';
  document.getElementById('purNotes').value = existing?.notes || '';
  togglePurPaidAmountField();
  const datalist = document.getElementById('menuItemsDatalist');
  if (datalist) datalist.innerHTML = state.menuItems.filter(m => m.isTrackable).map(m => `<option value="${esc(m.name)}">`).join('');
  renderPurchaseLines();
  document.getElementById('purchaseModal').classList.add('open');
}
export function closePurchaseModal() { document.getElementById('purchaseModal').classList.remove('open'); }

export function togglePurPaidAmountField() {
  const status = document.getElementById('purPaymentStatus')?.value;
  const group = document.getElementById('purPaidAmountGroup');
  if (group) group.style.display = status === 'partial' ? 'block' : 'none';
}

export function addPurchaseLine() {
  state._purchaseDraftLines.push({ id: 'l'+Date.now()+Math.random().toString(36).slice(2,6), name:'', category:'', qty:1, unit:'ədəd', unitPrice:0, isTrackable:false, newSalePrice:0 });
  renderPurchaseLines();
}
export function removePurchaseLine(id) {
  state._purchaseDraftLines = state._purchaseDraftLines.filter(l => l.id !== id);
  if (!state._purchaseDraftLines.length) state._purchaseDraftLines.push({ id: 'l'+Date.now(), name:'', category:'', qty:1, unit:'ədəd', unitPrice:0, isTrackable:false, newSalePrice:0 });
  renderPurchaseLines();
}
export function updatePurchaseLine(id, field, value) {
  const line = state._purchaseDraftLines.find(l => l.id === id);
  if (!line) return;

  if (field === 'qty' || field === 'unitPrice' || field === 'newSalePrice') line[field] = parseFloat(value) || 0;
  else line[field] = value;

  // VACİB: miqdar/qiymət/ad dəyişəndə BÜTÜN sətri yenidən qurmuruq (bu, inputun
  // fokusunu itirməsinə səbəb olurdu - bir hərf yazanda kursor sıçrayırdı). Əvəzinə
  // yalnız lazım olan RƏQƏM/MƏTN hissəsini nöqtəvi şəkildə yeniləyirik.
  if (field === 'qty' || field === 'unitPrice') {
    const lineTotal = (line.qty||0) * (line.unitPrice||0);
    const totalEl = document.getElementById('purLineTotal_' + id);
    if (totalEl) totalEl.textContent = lineTotal.toFixed(2) + ' ₼';
    _updatePurchaseGrandTotal();
    return;
  }
  if (field === 'name') {
    if (line.isTrackable) _updatePurchaseLineHint(line);
    return;
  }
  if (field === 'category' || field === 'unit' || field === 'newSalePrice') {
    return; // yalnız state yenilənir, ekranda dərhal görünməsi lazım deyil
  }
  if (field === 'isTrackable') {
    // Checkbox olduğu üçün "yazma fokusu" problemi yoxdur - struktur dəyişdiyi üçün
    // (yeni sahə görünür/gizlənir) bu sətri tam yenidən qurmaq təhlükəsizdir
    _renderSinglePurchaseLine(line);
  }
}

function _updatePurchaseGrandTotal() {
  const grandTotal = state._purchaseDraftLines.reduce((s,l) => s + (l.qty||0)*(l.unitPrice||0), 0);
  const totalEl = document.getElementById('purchaseGrandTotal');
  if (totalEl) totalEl.textContent = grandTotal.toFixed(2) + ' ₼';
}

function _buildPurchaseLineHintHtml(line) {
  if (!line.isTrackable || !line.name.trim()) return '';
  const existsInMenu = state.menuItems.some(m => m.isTrackable && m.name.trim().toLowerCase() === line.name.trim().toLowerCase());
  if (existsInMenu) {
    return `<div class="purchase-line__hint-linked"><svg class="icon" style="width:1em;height:1em;"><use href="#i-check"></use></svg> Mövcud menyu malına bağlanacaq, anbar stoku artacaq</div>`;
  }
  return `<div class="purchase-line__hint-new">
    <small>"${esc(line.name)}" menyuda yoxdur — yeni mal kimi yaradılacaq. Satış qiyməti:</small>
    <input type="number" placeholder="Satış qiyməti" min="0" step="0.01" value="${line.newSalePrice||''}" oninput="updatePurchaseLine('${line.id}','newSalePrice',this.value)">
  </div>`;
}

function _updatePurchaseLineHint(line) {
  const hintEl = document.getElementById('purLineHint_' + line.id);
  if (hintEl) hintEl.innerHTML = _buildPurchaseLineHintHtml(line);
}

function _buildPurchaseLineHtml(line, index) {
  const lineTotal = (line.qty||0) * (line.unitPrice||0);
  return `<div class="purchase-line" id="purLine_${line.id}">
    <div class="purchase-line__header">
      <span class="purchase-line__index">${index+1}</span>
      <button class="purchase-line__remove" onclick="removePurchaseLine('${line.id}')" title="Sətri sil"><svg class="icon"><use href="#i-trash"></use></svg></button>
    </div>
    <div class="purchase-line__grid">
      <div class="purchase-line__field">
        <label>Mal adı</label>
        <input type="text" placeholder="Məs: Coca-Cola 0.5L" value="${esc(line.name)}" list="menuItemsDatalist" oninput="updatePurchaseLine('${line.id}','name',this.value)">
      </div>
      <div class="purchase-line__field">
        <label>Kateqoriya</label>
        <input type="text" placeholder="Məs: İçki" value="${esc(line.category)}" oninput="updatePurchaseLine('${line.id}','category',this.value)">
      </div>
    </div>
    <div class="purchase-line__grid purchase-line__grid--three">
      <div class="purchase-line__field">
        <label>Miqdar</label>
        <input type="number" min="0" step="0.01" value="${line.qty}" oninput="updatePurchaseLine('${line.id}','qty',this.value)">
      </div>
      <div class="purchase-line__field">
        <label>Vahid</label>
        <input type="text" placeholder="kq/əd/litr" value="${esc(line.unit)}" oninput="updatePurchaseLine('${line.id}','unit',this.value)">
      </div>
      <div class="purchase-line__field">
        <label>Vahid qiymət (₼)</label>
        <input type="number" min="0" step="0.01" value="${line.unitPrice}" oninput="updatePurchaseLine('${line.id}','unitPrice',this.value)">
      </div>
    </div>
    <div class="purchase-line__field" style="margin-bottom:10px;">
      <label>Sətir cəmi</label>
      <div class="purchase-line__total-display" id="purLineTotal_${line.id}">${lineTotal.toFixed(2)} ₼</div>
    </div>
    <label class="purchase-line__trackable">
      <input type="checkbox" ${line.isTrackable?'checked':''} onchange="updatePurchaseLine('${line.id}','isTrackable',this.checked)">
      <svg class="icon" style="width:14px;height:14px;"><use href="#i-tag"></use></svg> Anbarda izlə (menyu malına bağla)
    </label>
    <div class="purchase-line__hint" id="purLineHint_${line.id}">${_buildPurchaseLineHintHtml(line)}</div>
  </div>`;
}

function _renderSinglePurchaseLine(line) {
  const el = document.getElementById('purLine_' + line.id);
  const index = state._purchaseDraftLines.findIndex(l => l.id === line.id);
  if (el) el.outerHTML = _buildPurchaseLineHtml(line, index);
}

function renderPurchaseLines() {
  const container = document.getElementById('purchaseLinesContainer');
  if (!container) return;
  container.innerHTML = state._purchaseDraftLines.map((line, i) => _buildPurchaseLineHtml(line, i)).join('');
  _updatePurchaseGrandTotal();
}

export function savePurchase() {
  const editId = document.getElementById('purchaseModal').dataset.editId || null;
  const oldPurchase = editId ? state.purchases.find(p => p.id === editId) : null;

  const supplierId = document.getElementById('purSupplier').value;
  const supplier = state.suppliers.find(s => s.id === supplierId);
  if (!supplier) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Təchizatçı seçin'); return; }
  const invoiceNumber = document.getElementById('purInvoiceNumber').value.trim();
  const date = document.getElementById('purDate').value || new Date().toISOString().split('T')[0];
  const validLines = state._purchaseDraftLines.filter(l => l.name.trim() && l.qty > 0);
  if (!validLines.length) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Ən azı bir mal sətri doldurun'); return; }

  const paymentType = document.getElementById('purPaymentType').value;
  const paymentStatus = document.getElementById('purPaymentStatus').value;

  const items = validLines.map(l => ({
    name: l.name.trim(), category: l.category.trim(), qty: l.qty, unit: l.unit, unitPrice: l.unitPrice,
    total: Math.round(l.qty * l.unitPrice * 100) / 100, isTrackable: !!l.isTrackable
  }));
  const totalAmount = Math.round(items.reduce((s,it) => s + it.total, 0) * 100) / 100;

  let paidAmount = 0;
  if (paymentStatus === 'paid') paidAmount = totalAmount;
  else if (paymentStatus === 'partial') paidAmount = parseFloat(document.getElementById('purPaidAmount').value) || 0;

  // REDAKTƏ rejimindədirsə, ƏVVƏLCƏ köhnə qeydin borc/stok təsirini GERİ ALIRIQ, sonra
  // yeni dəyərləri tətbiq edirik - bu, istənilən dəyişikliyi (miqdar, qiymət, təchizatçı
  // dəyişməsi belə) riyazi cəhətdən düzgün əks etdirir.
  if (oldPurchase) {
    const oldDebtDelta = Math.round(((oldPurchase.totalAmount||0) - (oldPurchase.paidAmount||0)) * 100) / 100;
    if (oldDebtDelta !== 0) {
      db.ref('suppliers/'+oldPurchase.supplierId+'/totalDebt').transaction(cur => Math.max(0, Math.round(((cur||0) - oldDebtDelta)*100)/100));
    }
    (oldPurchase.items||[]).filter(it => it.isTrackable).forEach(it => {
      const existing = state.menuItems.find(m => m.isTrackable && m.name.trim().toLowerCase() === it.name.trim().toLowerCase());
      if (existing) {
        R.menuItems.child(existing.id).child('stock').transaction(cur => Math.max(0, (cur||0) - it.qty));
      }
    });
  }

  const debtIncrease = Math.round((totalAmount - paidAmount) * 100) / 100;

  const purchaseData = {
    date, supplierId, supplierName: supplier.name, invoiceNumber, items, totalAmount,
    paymentType, paymentStatus, paidAmount,
    staffId: state.user?.id || null, staffName: state.user?.name || '?',
    notes: document.getElementById('purNotes').value.trim(),
    createdAt: oldPurchase?.createdAt || Date.now()
  };
  if (editId) {
    db.ref('purchases/'+editId).set(purchaseData);
  } else {
    db.ref('purchases').push(purchaseData);
  }

  // Təchizatçının borcunu yeniləyirik (ödənilməmiş hissə qədər)
  if (debtIncrease !== 0) {
    db.ref('suppliers/'+supplierId+'/totalDebt').transaction(cur => Math.max(0, Math.round(((cur||0) + debtIncrease)*100)/100));
  }

  // Anbarda izlənən mallar üçün mövcud menyu malını tapır (stokunu artırır) və ya
  // yeni menyu malı yaradır (verilmiş satış qiyməti ilə)
  validLines.filter(l => l.isTrackable && l.name.trim()).forEach(l => {
    const existing = state.menuItems.find(m => m.isTrackable && m.name.trim().toLowerCase() === l.name.trim().toLowerCase());
    if (existing) {
      R.menuItems.child(existing.id).child('stock').transaction(cur => (cur||0) + l.qty);
    } else {
      R.menuItems.push({
        name: l.name.trim(), category: l.category.trim() || 'Digər',
        price: l.newSalePrice || 0, stock: l.qty, isTrackable: true, createdAt: Date.now()
      });
    }
  });

  addLog('admin', `${editId?'Alış qeydi redaktə edildi':'Yeni alış qeydə alındı'}: ${supplier.name} - №${invoiceNumber||'?'} (${totalAmount.toFixed(2)} ₼)`, {});
  closePurchaseModal();
  showToast(`<svg class="icon"><use href="#i-check"></use></svg> Alış ${editId?'yeniləndi':'qeydə alındı'}`);
}



export function restoreClosedOrder(id) {
  if (state.user?.role !== 'admin') { showToast('<svg class="icon"><use href="#i-ban"></use></svg> Yalnız admin bərpa edə bilər'); return; }
  const o = state.closedOrders.find(x=>x.id===id);
  if (!o) return;

  // Masa adında əvvəldən "*" varsa təmizləyib əsl adı tapırıq, sonra YENİ bərpa sayına görə
  // düzgün sayda "*" əlavə edirik (məs. 2-ci dəfə bərpa = **). Sabit (qeydiyyatlı) masaya
  // TOXUNULMUR - o boş olsa belə - əvəzinə həmişə müvəqqəti YENİ masa yaradılır.
  const baseName = (o.tableName || '').replace(/\s*\*+$/, '');
  const newRestoreCount = (o.restoreCount || 0) + 1;
  const newName = `${baseName} ${'*'.repeat(newRestoreCount)}`;

  confirmAction(`"${esc(o.tableName)}" masası "${esc(newName)}" adı ilə müvəqqəti masa kimi bərpa edilsin? Sabit "${esc(baseName)}" masasına toxunulmayacaq.`, () => {
    const newRef = R.tables.push({
      name: newName, capacity: 4, occupant: null, notes: '', createdAt: Date.now(),
      restoreCount: newRestoreCount, isRestoredTemp: true, category: 'Bərpa edilmiş masalar'
    });
    const newTableId = newRef.key;
    const sessionId = `${newTableId}_${Date.now()}`;

    R.tableOrders.child(newTableId).set({
      items: o.items, total: o.total || 0,
      waiterId: o.staffId, paidAmount: 0, remainingAmount: o.total || 0,
      updatedAt: Date.now(), billPrintedAt: null
    });
    R.tables.child(newTableId).update({
      occupant: o.staffId, notes: o.notes || '', activatedAt: Date.now(),
      sessionId, openedById: o.openedById || o.staffId, openedByName: o.openedByName || o.staffName
    });
    R.closedOrders.child(id).remove();
    addLog('admin', `Admin "${o.tableName}" masasını "${newName}" adı ilə bərpa etdi: ${formatItemsList(o.items||{})} (${(o.total||0).toFixed(2)} ₼)`, { tableId: newTableId, sessionId });
    showToast(`<svg class="icon"><use href="#i-check"></use></svg> "${newName}" olaraq bərpa edildi`);
  }, { title: 'Masanı bərpa et', okLabel: '<svg class="icon"><use href="#i-refresh"></use></svg> Bərpa Et', okClass: 'btn-blue' });
}

window.adminTab = adminTab;
window.adminGoBack = adminGoBack;
window.setReportQuickRange = setReportQuickRange;
window.saveBizDayHour = saveBizDayHour;
window.setReportView = setReportView;
window.renderReports = renderReports;
window.applyPermissionPreset = applyPermissionPreset;
window.clearOldFeedbacks = clearOldFeedbacks;
window.toggleFeedbackSelect = toggleFeedbackSelect;
window.deleteSelectedFeedbacks = deleteSelectedFeedbacks;
window.toggleSelectAllFeedbacks = toggleSelectAllFeedbacks;
window.toggleRequestSelect = toggleRequestSelect;
window.toggleSelectAllRequests = toggleSelectAllRequests;
window.deleteSelectedRequests = deleteSelectedRequests;
window.clearOldLogs = clearOldLogs;
window.toggleLogSelect = toggleLogSelect;
window.deleteSelectedLogs = deleteSelectedLogs;
window.toggleSelectAllLogs = toggleSelectAllLogs;
window.closeAddModal = closeAddModal;
window.closeAdminNoteModal = closeAdminNoteModal;
window.closeKitchenPinModal = closeKitchenPinModal;
window.closeQRModal = closeQRModal;
window.closeReportModal = closeReportModal;
window.deleteMenuItem = deleteMenuItem;
window.deleteStaff = deleteStaff;
window.deleteTable = deleteTable;
window.editMenuItem = editMenuItem;
window.editStaff = editStaff;
window.editTable = editTable;
window.generateDailyReport = generateDailyReport;
window.onMenuCategorySelectChange = onMenuCategorySelectChange;
window.onStaffPositionChange = onStaffPositionChange;
window.openAddModal = openAddModal;
window.openKitchenPinModal = openKitchenPinModal;
window.previewMenuItemPhoto = previewMenuItemPhoto;
window.previewStaffPhoto = previewStaffPhoto;
window.printQR = printQR;
window.printReport = printReport;
window.saveAdminNote = saveAdminNote;
window.saveItem = saveItem;
window.saveKitchenPin = saveKitchenPin;
window.saveMenuUrl = saveMenuUrl;
window.saveServiceCharge = saveServiceCharge;
window.saveLoyaltySettings = saveLoyaltySettings;
window.setLogFilter = setLogFilter;
window.setMenuCat = setMenuCat;
window.selectMenuItem = selectMenuItem;
window.setTableCat = setTableCat;
window.selectTableMgmt = selectTableMgmt;
window.showQR = showQR;
window.toggleMenuItemAvailability = toggleMenuItemAvailability;
window.selectStaff = selectStaff;
window.toggleStaff = toggleStaff;
window.editCustomer = editCustomer;
window.deleteCustomer = deleteCustomer;
window.editPaymentMethod = editPaymentMethod;
window.deletePaymentMethod = deletePaymentMethod;
window.restoreClosedOrder = restoreClosedOrder;
window.renderLoyaltyCustomers = renderLoyaltyCustomers;
window.selectLoyaltyCustomer = selectLoyaltyCustomer;
window.toggleLoyaltyCustomerSelect = toggleLoyaltyCustomerSelect;
window.toggleSelectAllLoyaltyCustomers = toggleSelectAllLoyaltyCustomers;
window.deleteSelectedLoyaltyCustomers = deleteSelectedLoyaltyCustomers;
window.deleteSingleLoyaltyCustomer = deleteSingleLoyaltyCustomer;
window.openLoyaltyEditModal = openLoyaltyEditModal;
window.closeLoyaltyEditModal = closeLoyaltyEditModal;
window.saveLoyaltyCustomerEdit = saveLoyaltyCustomerEdit;
window.renderSuppliers = renderSuppliers;
window.selectSupplierMgmt = selectSupplierMgmt;
window.openSupplierModal = openSupplierModal;
window.closeSupplierModal = closeSupplierModal;
window.saveSupplier = saveSupplier;
window.deleteSupplier = deleteSupplier;
window.renderPurchases = renderPurchases;
window.selectPurchase = selectPurchase;
window.deletePurchase = deletePurchase;
window.openPurchaseModal = openPurchaseModal;
window.closePurchaseModal = closePurchaseModal;
window.togglePurPaidAmountField = togglePurPaidAmountField;
window.addPurchaseLine = addPurchaseLine;
window.removePurchaseLine = removePurchaseLine;
window.updatePurchaseLine = updatePurchaseLine;
window.savePurchase = savePurchase;
window.openQuickStockModal = openQuickStockModal;
window.closeQuickStockModal = closeQuickStockModal;
window.confirmQuickStock = confirmQuickStock;
window.selectClosedOrder = selectClosedOrder;
window.toggleClosedOrderSelect = toggleClosedOrderSelect;
window.toggleSelectAllClosedOrders = toggleSelectAllClosedOrders;
window.deleteSelectedClosedOrders = deleteSelectedClosedOrders;
window.renderClosedOrders = renderClosedOrders;
window.openCustomerHistoryModal = openCustomerHistoryModal;
window.closeCustomerHistoryModal = closeCustomerHistoryModal;
