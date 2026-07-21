/* ═══════════════════════════════════════════
   PAYLAŞILAN STATE
   Bütün modullar bu tək state obyektini import edib oxuyur/yazır.
   ES modullarında import edilən obyektlər REFERENCE ilə paylaşılır,
   ona görə burada olan dəyişikliklər hər yerdə görünür (səhifə yenilənmədən).
═══════════════════════════════════════════ */

export let ADMIN_PIN = null;
export function setAdminPin(pin) { ADMIN_PIN = pin; }

export const state = {
  role: 'admin',
  user: null,
  staff: [],
  tables: [],
  orders: [],
  logs: [],
  menuItems: [],
  customers: [],
  paymentMethods: [],
  closedOrders: [],
  customerCharges: [],
  payments: [],
  tableOrders: {},
  logFilter: 'all',
  adminSection: 'dashboard',
  _selectedClosedOrderId: null,
  _reportView: 'summary',
  _bizDayStartHour: 5,
  serviceCharge: { enabled: false, percent: 0 },
  alarm: null,
  alarmType: null,
  alarmInterval: null,
  editTarget: null,
  noteTableId: null,
  pendingTableId: null,
  pendingCloseTableId: null,
  kitchenPin: '9999',
  pinBuffer: '',
  _shownRequests: [],
  activeChatTableId: null,
  activeChatConvId: null,
  _tableCatFilter: 'all',
  _waiterCatFilter: 'all',
  _waiterStaffFilter: null,
  _menuCatFilter: 'all',
  orderTableId: null,
  _orderCatFilter: 'all',
  _orderDraft: {},
  _orderDetailItemId: null,
  _batchSelection: {},
  tableTimerInterval: null
};
