/* ═══════════════════════════════════════════
   ADMIN PANELİ — ümumi giriş nöqtəsi
   Mərhələ 5 (19.11.2026): bölmələr ayrı fayllara bölünüb, məntiq dəyişməyib:
     admin-reports.js   — hesabatlar            admin-staff.js     — işçilər
     admin-tables.js    — masalar               admin-logs.js      — jurnal, QR, günlük hesabat
     admin-feedback.js  — masa qeydi, rəylər    admin-customers.js — nisyə müştəriləri, ödəniş növləri
     admin-closed.js    — bağlanan masalar      admin-loyalty.js   — loyallıq müştəriləri
     admin-kitchens.js  — mətbəx stansiyaları   admin-danger.js    — məlumatların silinməsi
   Bu fayl: panelin naviqasiyası, icazə seçimi, ümumi "+ Yeni" pəncərəsi, ümumi ayarlar.
   Başqa modullar yalnız admin.js-dən import edir (hamısı buradan yenidən ixrac olunur).
   Mövcud HTML `onclick=""` atributları ilə işlədiyi üçün funksiyalar `window`-a təyin edilir.
═══════════════════════════════════════════ */
import { ALL_PERMISSIONS, PERMISSION_PRESETS } from './permissions.js';
import { state } from './state.js';
import { renderStaff, openAddStaffModal, saveStaff, deleteStaff, editStaff, onStaffPositionChange, previewStaffPhoto, selectStaff, toggleStaff } from './admin-staff.js';
import { renderTables, tableForm, deleteTable, editTable, setTableCat, selectTableMgmt } from './admin-tables.js';
import { renderLogs, clearOldLogs, toggleLogSelect, deleteSelectedLogs, toggleSelectAllLogs, closeQRModal, closeReportModal, generateDailyReport, printQR, printReport, setLogFilter, showQR } from './admin-logs.js';
import { renderFeedbackSection, clearOldFeedbacks, toggleFeedbackSelect, deleteSelectedFeedbacks, toggleSelectAllFeedbacks, toggleRequestSelect, toggleSelectAllRequests, deleteSelectedRequests, closeAdminNoteModal, saveAdminNote } from './admin-feedback.js';
import { renderCustomers, renderPaymentMethods, customerForm, paymentMethodForm, saveCustomer, savePaymentMethod, editCustomer, deleteCustomer, editPaymentMethod, deletePaymentMethod, openCustomerHistoryModal, closeCustomerHistoryModal, openCustomerPaymentModal, toggleChargeSelection, closeCustomerPaymentModal, submitCustomerPayment } from './admin-customers.js';
import { renderClosedOrders, restoreClosedOrder, selectClosedOrder, toggleClosedOrderSelect, toggleSelectAllClosedOrders, deleteSelectedClosedOrders } from './admin-closed.js';
import { renderLoyaltyCustomers, selectLoyaltyCustomer, toggleLoyaltyCustomerSelect, toggleSelectAllLoyaltyCustomers, deleteSelectedLoyaltyCustomers, deleteSingleLoyaltyCustomer, openLoyaltyEditModal, closeLoyaltyEditModal, saveLoyaltyCustomerEdit } from './admin-loyalty.js';
import { renderBanquetDashboard, renderBanquetCalendar, renderBanquetHalls, renderBanquetEventTypes, openBanquetEventTypeModal, openBanquetHallModal } from './banquet.js';
import { renderKitchenStations, openKitchenStationModal } from './admin-kitchens.js';
import { renderNotifSounds } from './notifSounds.js';
import { renderPrinters, openPrinterModal, closePrinterModal, savePrinter, deletePrinter, testPrinter, saveReceiptTemplate, saveKitchenTemplate, uploadReceiptLogo, removeReceiptLogo, _toggleReceiptFields } from './printer-settings.js';
import { renderDangerZone, _ownerMode, openDangerZonePinModal } from './admin-danger.js';
import { db, R } from './firebase-service.js';
import { setReportQuickRange, renderReports, saveBizDayHour, setReportView } from './admin-reports.js';
import { showToast, addLog } from './utils.js';
import { api } from './yuza-api.js';
export * from './admin-reports.js';
export * from './admin-feedback.js';
export * from './admin-staff.js';
export * from './admin-tables.js';
export * from './admin-logs.js';
export * from './admin-customers.js';
export * from './admin-closed.js';
export * from './admin-loyalty.js';
export * from './admin-kitchens.js';
export * from './admin-danger.js';

// Müştəri tərəfindən yaradıla bilən qeydlərin ID-si onclick atributuna yalnız təhlükəsiz simvollarla düşür
export const jsId = (id) => String(id ?? '').replace(/[^-\w]/g, '');
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

// Bölmə səviyyəsindəki "Geri" düyməsi (telefonda) mal/işçi/masa detalı AÇIQ olanda
// gizlədilir - əks halda iki "Geri" düyməsi üst-üstə düşür, yalnız yuxarıdakı (bölmə)
// işləyir, mal detalının öz "Geri"si əlçatan olmur. Detal bağlananda yenidən görünür.
export function _toggleSectionBackBtn(hide) {
  const btn = document.getElementById('adminBackBtn');
  if (btn) btn.style.display = hide ? 'none' : '';
}

export function renderAdmin() {
  if (state.adminSection==='dashboard') renderDashboard();
  if (state.adminSection==='staff')     renderStaff();
  if (state.adminSection==='tables')    renderTables();
  if (state.adminSection==='logs')      renderLogs();
  if (state.adminSection==='feedback')  renderFeedbackSection();
  if (state.adminSection==='customers') renderCustomers();
  if (state.adminSection==='paymentMethods') renderPaymentMethods();
  if (state.adminSection==='closedOrders') renderClosedOrders();
  if (state.adminSection==='loyaltyCustomers') renderLoyaltyCustomers();
  if (state.adminSection==='banquetDashboard') renderBanquetDashboard();
  if (state.adminSection==='banquetCalendar') renderBanquetCalendar();
  if (state.adminSection==='banquetHalls') renderBanquetHalls();
  if (state.adminSection==='banquetEventTypes') renderBanquetEventTypes();
     if (state.adminSection==='kitchenStations') renderKitchenStations();
     // Ayarlar mərkəzi (yuza-settings.js): səslər və çek şablonu oradakı pəncərədə göstərilir
     const _hub = state.adminSection === 'settings' && typeof window.__yzSettingsPane === 'function' ? window.__yzSettingsPane() : null;
     if (state.adminSection==='notifSounds' || _hub === 'sounds') renderNotifSounds();
     if (state.adminSection==='printers') renderPrinters();
     // çek şablonu yalnız pəncərə açılanda çəkilir (yuza-settings.js) — yazılan mətn hər məlumat dəyişikliyində silinməsin
     if (state.adminSection==='dangerZone') renderDangerZone();
}

export function adminTab(sec, el) {
  state.adminSection = sec;
  document.querySelectorAll('.admin-tab').forEach(b=>b.classList.remove('active'));
  if (el) el.classList.add('active');
  document.querySelectorAll('.admin-section').forEach(s=>s.classList.remove('active'));
  const secEl = document.getElementById('sec-'+sec);
  if (secEl) secEl.classList.add('active');
  document.querySelector('.admin-body')?.classList.add('admin-section-open');
  _toggleSectionBackBtn(false);
  renderAdmin();

  // Qrup has-active state
  document.querySelectorAll('.ap-group').forEach(g => {
    const hasAct = g.querySelector('.admin-tab.active');
    g.classList.toggle('has-active', !!hasAct);
    if (hasAct && !g.classList.contains('open')) g.classList.add('open');
  });

  document.getElementById('adminFab').style.display = (sec==='tables'||sec==='staff'||sec==='customers'||sec==='paymentMethods'||sec==='banquetHalls'||sec==='kitchenStations'||sec==='banquetEventTypes'||sec==='printers') ? 'flex':'none';
  if (sec==='settings') {
        
    db.ref('settings/menuUrl').once('value', snap => {
      if (snap.val()) document.getElementById('menuUrlInput').value = snap.val();
    });
    const sc = state.serviceCharge || {};
    document.getElementById('serviceChargeEnabled').checked = !!sc.enabled;
        document.getElementById('serviceChargePercent').value = sc.percent || '';
    const vm = state.vatMode === 'added' ? 'added' : 'included';
    document.querySelectorAll('input[name="vatMode"]').forEach(r => { r.checked = r.value === vm; });
    db.ref('settings/loyalty').once('value', snap => {
      const l = snap.val() || {};
      document.getElementById('referralBonusAmount').value = l.referralBonusAmount || '';
      document.getElementById('referralMinOrderAmount').value = l.referralMinOrderAmount || '';
    });
  }
  if (sec==='dangerZone') {
    if (_ownerMode() || state.user?.role === 'staff') renderDangerZone();
    else openDangerZonePinModal(null);
  }
}

// Telefonda "ev ekranı" naviqasiyasında bölmə görünüşündən grid menyusuna qayıdır
export function adminGoBack() {
  document.querySelector('.admin-body')?.classList.remove('admin-section-open');
  document.getElementById('adminFab').style.display = 'none';
  _toggleSectionBackBtn(false);
}

// ── Kateqoriya (tab) sırasını sürükləyib dəyişmək (məs. "Ayarlar"ı birinci etmək) ──
// Sıra brauzerin öz yaddaşında (localStorage) saxlanılır, hər admin öz sırasını seçə bilər.
export const TAB_ORDER_KEY = 'qarson_adminTabOrder';

export function initAdminTabDragDrop() {
  // Qrup/accordion sistemi drag-drop əvəz etdi.
  // app.js bu funksiyanı çağırır — boş saxlanılır.
  try { localStorage.removeItem('qarson_adminTabOrder'); } catch(e) {}
  // İlk qrupu avtomatik aç
  const firstGroup = document.querySelector('.ap-group');
  if (firstGroup) firstGroup.classList.add('open');
}

export function renderDashboard() {
  const activeStaff = state.staff.filter(s=>s.status!=='offline').length;
  const activeTbl = state.tables.filter(t=>t.occupant).length;
  document.getElementById('statsRow').innerHTML = `
    <div class="stat-card"><div class="stat-num">${state.staff.length}</div><div class="stat-label">Cəmi İşçi</div></div>
    <div class="stat-card"><div class="stat-num" style="color:var(--green)">${activeStaff}</div><div class="stat-label">Aktiv İşçi</div></div>
    <div class="stat-card"><div class="stat-num" style="color:var(--blue)">${state.tables.length}</div><div class="stat-label">Cəmi Masa</div></div>
    <div class="stat-card"><div class="stat-num" style="color:var(--orange)">${activeTbl}</div><div class="stat-label">Dolu Masa</div></div>
  `;
  const bizHourEl = document.getElementById('repBizDayHour');
  if (bizHourEl && !bizHourEl.value) bizHourEl.value = String(state._bizDayStartHour||5).padStart(2,'0') + ':00';
  // Filtr sahələri hələ boşdursa (ilk açılış), defolt olaraq "gün sonu" aralığı tətbiq olunur
  const dateFromEl = document.getElementById('repDateFrom');
  if (dateFromEl && !dateFromEl.value) { setReportQuickRange('today'); }
  else { renderReports(); }
}













export function openAddModal() {
  apNewItem(state.adminSection);
}

// ── Yeni element əlavəsi — bütün bölmələr üçün ──
export function apNewItem(section) {
  document.getElementById('apNewMenu')?.classList.remove('open');
  state.editTarget = null;
  switch(section) {
    case 'staff':             openAddStaffModal(); return;
    case 'banquetEventTypes': openBanquetEventTypeModal(); return;
    case 'kitchenStations':   openKitchenStationModal(); return;
    case 'printers':          openPrinterModal(); return;
    case 'banquetHalls':      openBanquetHallModal(); return;
  }
  // addModal-a ehtiyac olan bölmələr
  let title = '', body = '';
  if (section === 'customers') {
    title = '<svg class="icon"><use href="#i-plus"></use></svg> Yeni Müştəri';
    body = customerForm({});
  } else if (section === 'paymentMethods') {
    title = '<svg class="icon"><use href="#i-plus"></use></svg> Yeni Ödəniş Növü';
    body = paymentMethodForm({});
  } else if (section === 'tables') {
    title = '<svg class="icon"><use href="#i-plus"></use></svg> Yeni Kateqoriya və Masalar';
    body = tableForm('', false);
  } else { return; }
  document.getElementById('addModalTitle').innerHTML = title;
  document.getElementById('addModalBody').innerHTML = body;
  document.getElementById('addModal').classList.add('open');
}
window.apNewItem = apNewItem;

// ── + Yeni dropdown toggle ──
export function apToggleNewMenu(e) {
  if (e) e.stopPropagation();
  const dd = document.getElementById('apNewMenu');
  if (!dd) return;
  dd.classList.toggle('open');
  if (dd.classList.contains('open')) {
    const close = (ev) => {
      if (!dd.contains(ev.target)) {
        dd.classList.remove('open');
        document.removeEventListener('click', close);
      }
    };
    setTimeout(() => document.addEventListener('click', close), 10);
  }
}
window.apToggleNewMenu = apToggleNewMenu;

// ── Sidebar toggle (hamburger) ──
export function apToggleSidebar() {
  const tabs = document.getElementById('adminTabsContainer');
  const body = document.getElementById('adminBody');
  if (!tabs) return;
  // Desktop: sidebar dar/geniş toggle (ileridə)
  // Telefon: body açıq/bağlı
  if (window.innerWidth < 768) {
    body?.classList.toggle('admin-section-open');
  }
}
window.apToggleSidebar = apToggleSidebar;

// ── Qrup accordion toggle ──
export function apToggleGroup(headerEl) {
  const group = headerEl?.closest('.ap-group');
  if (!group) return;
  group.classList.toggle('open');
}
window.apToggleGroup = apToggleGroup;

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
    : (state.adminSection === 'staff' ? 'staff' : state.adminSection === 'customers' ? 'customer' : state.adminSection === 'paymentMethods' ? 'paymentMethod' : 'table');

  if (sec === 'staff') { saveStaff(); return; }
  if (sec === 'customer') { saveCustomer(); return; }
  if (sec === 'paymentMethod') { savePaymentMethod(); return; }

  {
    const prefix = document.getElementById('ft_name').value.trim();
    if (!prefix) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Kateqoriya adı lazımdır'); return; }

    if (state.editTarget) {
      R.tables.child(state.editTarget.id).update({ name: prefix });
      addLog('table_mgmt', `Masa adı dəyişdirildi: ${prefix}`, {});
      showToast('<svg class="icon"><use href="#i-check"></use></svg> Masa yeniləndi');
    } else {
      const count = parseInt(document.getElementById('ft_count').value) || 1;
      for (let i = 1; i <= count; i++) {
        const tName = count === 1 ? prefix : `${prefix} ${i}`;
        R.tables.push({ name: tName, category: prefix, occupant: null, notes: '', createdAt: Date.now() + i });
      }
      addLog('table_mgmt', `${count} ədəd masa əlavə edildi: ${prefix}`, {});
      showToast(`<svg class="icon"><use href="#i-check"></use></svg> ${count} ədəd masa əlavə edildi`);
    }
  }
  closeAddModal();
}

/* 6 rəqəmli PIN: təxmin edilməsi asan olanlar qəbul edilmir */
export function weakPin(pin) {
  if (/^(\d)\1{5}$/.test(pin)) return true;                       // 111111
  if ('0123456789012'.includes(pin) || '9876543210987'.includes(pin)) return true;   // 123456, 654321
  if (/^(\d\d)\1\1$/.test(pin) || /^(\d{3})\1$/.test(pin)) return true;   // 121212, 123123
  return false;
}

/* Server qatı: işçi / mətbəx PIN-i serverdə saxlanır (yuza-api.js). pin=null → PIN silinir.
   Rəhbər öz hesabının adından, səlahiyyətli işçi öz sessiyası ilə təyin edir. */
export function syncPin(type, id, pin, onFail) {
  return api('setPin', { type, id, pin }, { owner: !!state.user?.ownerUid })
    .catch(e => { showToast('<svg class="icon"><use href="#i-error"></use></svg> PIN yadda saxlanmadı: ' + (e.message || 'xəta')); if (onFail) onFail(e); });
}

export function openKitchenPinModal() {
  document.getElementById('newKitchenPin').value = '';
  document.getElementById('kitchenPinModal').classList.add('open');
}

export function closeKitchenPinModal() { document.getElementById('kitchenPinModal').classList.remove('open'); }

export function saveKitchenPin() {
  const pin = document.getElementById('newKitchenPin').value.trim();
  if (!/^\d{6}$/.test(pin)) { showToast('<svg class="icon"><use href="#i-error"></use></svg> 6 rəqəmli PIN daxil edin'); return; }
  if (weakPin(pin)) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Bu PIN çox asandır'); return; }
  db.ref('settings/kitchenPin').set(pin);
  state.kitchenPin = pin;
  addLog('settings','Mətbəx PIN dəyişdirildi',{});
  closeKitchenPinModal();
  showToast('<svg class="icon"><use href="#i-check"></use></svg> Mətbəx PIN dəyişdirildi');
}

export function saveMenuUrl() {
  const url = document.getElementById('menuUrlInput').value.trim();
  if (!url) { showToast('<svg class="icon"><use href="#i-error"></use></svg> URL boş ola bilməz'); return; }
  db.ref('settings/menuUrl').set(url);
  addLog('settings',`Menyu URL dəyişdirildi: ${url}`,{});
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
  addLog('settings', `Xidmət haqqı ${enabled?`aktiv edildi (${percent}%)`:'deaktiv edildi'}`, {});
  document.getElementById('serviceChargeStatus').innerHTML = '<svg class="icon"><use href="#i-check"></use></svg> Yadda saxlanıldı';
  setTimeout(()=>{ const el = document.getElementById('serviceChargeStatus'); if (el) el.textContent=''; },3000);
  showToast(`<svg class="icon"><use href="#i-check"></use></svg> Xidmət haqqı ${enabled?'aktivdir':'deaktivdir'}`);
}

export function saveVatMode() {
  const sel = document.querySelector('input[name="vatMode"]:checked');
  const mode = sel?.value === 'added' ? 'added' : 'included';
  db.ref('settings/vatMode').set(mode);
  state.vatMode = mode;
  addLog('settings', `ƏDV hesablama üsulu: ${mode === 'added' ? 'qiymətin üstünə əlavə olunur' : 'qiymətə daxildir'}`, {});
  const el = document.getElementById('vatModeStatus');
  if (el) { el.innerHTML = '<svg class="icon"><use href="#i-check"></use></svg> Yadda saxlanıldı — yeni sifarişlərə tətbiq olunur'; setTimeout(() => { el.textContent = ''; }, 3000); }
  showToast('<svg class="icon"><use href="#i-check"></use></svg> ƏDV hesablama üsulu yadda saxlandı');
}

export function saveLoyaltySettings() {
  const referralBonusAmount = parseFloat(document.getElementById('referralBonusAmount').value) || 0;
  const referralMinOrderAmount = parseFloat(document.getElementById('referralMinOrderAmount').value) || 0;
  db.ref('settings/loyalty').set({ referralBonusAmount, referralMinOrderAmount });
  addLog('settings', `Referral proqramı yeniləndi: ${referralBonusAmount} bal / minimum ${referralMinOrderAmount} ₼`, {});
  const el = document.getElementById('loyaltySettingsStatus');
  if (el) {
    el.innerHTML = '<svg class="icon"><use href="#i-check"></use></svg> Yadda saxlanıldı';
    setTimeout(()=>{ if (el) el.textContent=''; },3000);
  }
  showToast('<svg class="icon"><use href="#i-check"></use></svg> Referral parametrləri yadda saxlandı');
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
window.deleteStaff = deleteStaff;
window.deleteTable = deleteTable;
window.editStaff = editStaff;
window.editTable = editTable;
window.generateDailyReport = generateDailyReport;
window.onStaffPositionChange = () => { onStaffPositionChange(); window.fsPermCount?.(); };
window.openAddModal = openAddModal;
window.openKitchenPinModal = openKitchenPinModal;
window.previewStaffPhoto = previewStaffPhoto;
window.printQR = printQR;
window.printReport = printReport;
window.saveAdminNote = saveAdminNote;
window.saveItem = saveItem;
window.saveKitchenPin = saveKitchenPin;
window.saveMenuUrl = saveMenuUrl;
window.saveServiceCharge = saveServiceCharge;
window.saveVatMode = saveVatMode;
window.saveLoyaltySettings = saveLoyaltySettings;
window.setLogFilter = setLogFilter;
window.renderLogs = renderLogs;
window.setTableCat = setTableCat;
window.selectTableMgmt = selectTableMgmt;
window.showQR = showQR;
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
window.selectClosedOrder = selectClosedOrder;
window.toggleClosedOrderSelect = toggleClosedOrderSelect;
window.toggleSelectAllClosedOrders = toggleSelectAllClosedOrders;
window.deleteSelectedClosedOrders = deleteSelectedClosedOrders;
window.renderClosedOrders = renderClosedOrders;
window.openCustomerHistoryModal = openCustomerHistoryModal;
window.closeCustomerHistoryModal = closeCustomerHistoryModal;
window.openCustomerPaymentModal = openCustomerPaymentModal;
window.toggleChargeSelection = toggleChargeSelection;
window.closeCustomerPaymentModal = closeCustomerPaymentModal;
window.submitCustomerPayment = submitCustomerPayment;

export function saveKitchenAlertInterval(val) {
  const n = parseInt(val);
  if (isNaN(n) || n < 5) return;
  db.ref('settings/kitchenAlertIntervalSec').set(n);
  const el = document.getElementById('kitchenAlertStatus');
  if (el) { el.textContent = 'Yadda saxlanıldı ✓'; setTimeout(()=>el.textContent='', 2000); }
}
window.saveKitchenAlertInterval = saveKitchenAlertInterval;

// Printer idarəsi
window.openPrinterModal      = openPrinterModal;
window.closePrinterModal     = closePrinterModal;
window.savePrinter           = savePrinter;
window.deletePrinter         = deletePrinter;
window.testPrinter           = testPrinter;
window.saveReceiptTemplate   = saveReceiptTemplate;
window.saveKitchenTemplate   = saveKitchenTemplate;
window.uploadReceiptLogo     = uploadReceiptLogo;
window.removeReceiptLogo     = removeReceiptLogo;
window._toggleReceiptFields  = _toggleReceiptFields;
