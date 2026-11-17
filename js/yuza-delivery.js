/* ═══════════════════════════════════════════
   YUZA POS — PAKET VƏ ÇATDIRILMA (Mərhələ 1) · 15.11.2026
   • Paket sifarişi ayrıca qeydiyyatdır ("Paket" masası açılmır):
     mallar → müştəri (telefon, ad, ünvan) → çatdırılma forması, ödəniş → Təsdiq → mətbəx
   • Statuslar: Planlı → Hazırlanır → Hazırdır → Yoldadır → Çatdırıldı (və ya Ləğv)
     Hər addım tarix + saat + işçi adı ilə yazılır.
   • Mətbəx "Hazırdır" vuranda kuryerə və növbə müdirinə (delivery.manage) bildiriş gedir
   • Kuryer: qəbul etdim → yola çıxdım → təhvil verdim (yer + istəyə görə foto)
   • Kuryerin yığdığı nağd pul "Kassa təhvili" ilə kassaya keçir
   • Müştəri kartı: neçənci sifarişi, VIP, ad günü, bonus, borc, ləğvlər, qara siyahı
   • Qablaşdırma qabı menyudan mal kimi əlavə olunur; "pulsuz" seçiləndə 0 ₼ yazılır,
     amma anbardan yenə silinir
   index.html-də bu fayl və css/yuza-delivery.css qoşulur.
   Baza: deliveryOrders, deliveryCustomers, deliverySettlements, deliveryProofs,
         deliveryMeta/counter, settings/delivery
═══════════════════════════════════════════ */
import { state } from './state.js';
import { db, R } from './firebase-service.js';
import { hasPermission, ALL_PERMISSIONS, PERMISSION_PRESETS } from './permissions.js';
import { esc, showToast, addLog, makeLineKey, updateStock, computeVat } from './utils.js';
import { modal, confirmBox } from './yuza-inv-ui.js';
import { needShift, shiftNow } from './yuza-shift.js';
import { printReceipt, printKitchenJobs } from './printer-service.js';
import * as ADM from './admin.js';
import { NOTIF_EVENTS, playNotifSound } from './notifSounds.js';

/* ═══ 1. Sabitlər və köməkçilər ═══ */
const DO = db.ref('deliveryOrders');
const DC = db.ref('deliveryCustomers');
const DS = db.ref('deliverySettlements');
const DP = db.ref('deliveryProofs');
const DSET = db.ref('settings/delivery');
const COUNTER = db.ref('deliveryMeta/counter');
const MIN = 60000;
const $ = (id) => document.getElementById(id);
const I = (id) => `<svg class="icon"><use href="#i-${id}"></use></svg>`;
const p2 = (n) => String(n).padStart(2, '0');
const r2 = (n) => Math.round((+n || 0) * 100) / 100;
const money = (n) => r2(n).toFixed(2).replace('.', ',') + ' ₼';
const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
export const fmtD = (t) => { const d = new Date(t); return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}`; };
export const fmtT = (t) => { const d = new Date(t); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
export const fmtDT = (t) => (t ? `${fmtD(t)}, ${fmtT(t)}` : '—');
const dayStart = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const mins = (from, to = Date.now()) => Math.max(0, Math.floor((to - from) / MIN));

/* Telefon: müqayisə üçün yalnız rəqəmlər (994XXXXXXXXX) */
export function phoneKey(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('994')) return d;
  if (d.startsWith('0')) d = d.slice(1);
  if (d.length === 9) return '994' + d;
  return d;
}
const phoneOk = (raw) => { const k = phoneKey(raw); return k.length >= 10 && k.length <= 15; };
const phoneNice = (raw) => {
  const k = phoneKey(raw);
  if (k.length === 12 && k.startsWith('994')) return `+994 ${k.slice(3, 5)} ${k.slice(5, 8)} ${k.slice(8, 10)} ${k.slice(10)}`;
  return raw || '';
};
/* Azərbaycan dilində sıra şəkilçisi: 1-ci, 3-cü, 6-cı, 9-cu, 40-cı, 100-cü */
export function ordinal(n) {
  n = Math.floor(+n || 0);
  const last = n % 10, tens = n % 100;
  let s;
  if (n === 0) s = 'cı';
  else if (last !== 0) s = ({ 1: 'ci', 2: 'ci', 3: 'cü', 4: 'cü', 5: 'ci', 6: 'cı', 7: 'ci', 8: 'ci', 9: 'cu' })[last];
  else if (tens !== 0) s = ({ 10: 'cu', 20: 'ci', 30: 'cu', 40: 'cı', 50: 'ci', 60: 'cı', 70: 'ci', 80: 'ci', 90: 'cı' })[tens];
  else s = n % 1000 === 0 ? 'ci' : 'cü';
  return `${n}-${s}`;
}

/* Statuslar */
export const ST = {
  scheduled: { l: 'Planlı', c: 'sch' },
  cooking:   { l: 'Hazırlanır', c: 'cook' },
  ready:     { l: 'Hazırdır', c: 'ready' },
  onway:     { l: 'Yoldadır', c: 'way' },
  delivered: { l: 'Tamamlandı', c: 'done' },
  cancelled: { l: 'Ləğv edildi', c: 'can' }
};
const ACTIVE = ['scheduled', 'sending', 'cooking', 'ready', 'onway'];
const SOURCES = { phone: 'Telefon zəngi', whatsapp: 'WhatsApp', instagram: 'Instagram', walkin: 'Yerində', platform: 'Wolt / Bolt', other: 'Digər' };
const PROBLEMS = { noanswer: 'Müştəri cavab vermir', address: 'Ünvan səhvdir / tapılmır', refused: 'Müştəri sifarişdən imtina etdi', other: 'Digər' };

/* Ayarlar */
const DEF = {
  enabled: true,
  feeMode: 'free',          // free | fixed | zone
  fixedFee: 0,
  zones: {},                // { id: { name, fee, min, eta } }
  freeOver: 0,              // 0 = yoxdur
  packCategory: '',         // menyuda qablaşdırma kateqoriyası
  packFree: true,           // qab standart olaraq pulsuz yazılsın
  dispatch: 'broadcast',    // broadcast (hamıya, ilk qəbul edən) | manual (operator təyin edir)
  acceptTimeoutMin: 3,
  cashLimit: 200,
  prepTarget: 20,
  scheduleLeadMin: 40,
  vipAt: 10,
  autoPrint: true,
  courierCopy: true,
  cancelReasonRequired: true,
  restaurantCity: 'Bakı'
};
let S = { ...DEF };
const zonesList = () => Object.entries(S.zones || {}).map(([id, z]) => ({ id, ...z })).sort((a, b) => String(a.name).localeCompare(String(b.name), 'az'));

/* ═══ 2. İcazələr ═══ */
const PERMS = [
  { key: 'delivery.take',    label: 'Paket sifarişi qəbul etmək (telefon, yerində)' },
  { key: 'delivery.manage',  label: 'Paketləri idarə etmək: kuryer təyin etmək, təhvil vermək, ləğv etmək, qara siyahı; "Hazırdır" bildirişlərini almaq (növbə müdiri)' },
  { key: 'delivery.courier', label: 'Kuryer kimi işləmək (sifarişi qəbul etmək, yola çıxmaq, təhvil vermək)' },
  { key: 'delivery.settle',  label: 'Kuryerdən nağd pulu təhvil almaq (kassa təhvili)' },
  { key: 'delivery.item_cancel', label: 'Təsdiqlənmiş paket sifarişindən mal ləğv etmək (səbəb yazılır). Mal əlavə etməyi sifarişi qəbul edən özü edə bilir' }
];
(function addPerms() {
  if (!ALL_PERMISSIONS.some(g => g.items?.some(i => i.key === 'delivery.take'))) {
    ALL_PERMISSIONS.push({ group: 'Paket və çatdırılma', icon: I('box'), items: PERMS });
  }
  const add = (k, list) => { const p = PERMISSION_PRESETS?.[k]; if (p) list.forEach(x => { if (!p.perms.includes(x)) p.perms.push(x); }); };
  add('manager', PERMS.map(p => p.key));
  add('cashier', ['delivery.take', 'delivery.manage', 'delivery.settle', 'delivery.item_cancel']);
  add('head_waiter', ['delivery.take']);
  if (PERMISSION_PRESETS && !PERMISSION_PRESETS.courier) {
    PERMISSION_PRESETS.courier = { label: `${I('box')} Kuryer`, perms: ['delivery.courier'] };
  }
  // Bildiriş səsləri: Sistem → Bildiriş səsləri bölməsində hər hadisəyə yüklənmiş səs seçilir
  Object.assign(NOTIF_EVENTS, {
    delivery_courier_new:   'Paket: yeni çatdırılma / təyin edildi (kuryerə)',
    delivery_courier_ready: 'Paket: sifariş hazırdır (kuryerə)',
    delivery_changed:       'Paket: sifariş dəyişdirildi (kuryerə)',
    delivery_ready:         'Paket: hazırdır (növbə müdirinə / qəbul edənə)',
    delivery_alert:         'Paket: gecikmə, problem, kuryer qəbul etməyib (növbə müdirinə)'
  });
  if (ADM.LOG_TYPE_INFO && !ADM.LOG_TYPE_INFO.delivery) {
    ADM.LOG_TYPE_INFO.delivery = { label: 'PAKET', color: '#c98d2e', group: 'table_ops' };
  }
})();
const isRehber = () => state.user?.role === 'admin';
const can = (k) => !!state.user && (isRehber() || (state.user.role === 'staff' && hasPermission(k)));
const canBoard = () => can('delivery.take') || can('delivery.manage') || can('delivery.settle');
const isCourier = () => state.user?.role === 'staff' && hasPermission('delivery.courier');
const me = () => ({ id: state.user?.id || (isRehber() ? 'admin' : null), name: state.user?.name || (isRehber() ? 'Rəhbər' : '?') });
const anyAccess = () => canBoard() || isCourier();

/* Kuryer ola bilən işçilər */
const couriers = () => (state.staff || []).filter(s => (s.permissions || []).includes('delivery.courier') && s.status !== 'offline');
const staffName = (id) => (state.staff || []).find(s => s.id === id)?.name || '';

/* Əlavə ikonlar (velosiped, yer nişanı, paket) */
function ensureIcons() {
  if ($('yzpIcons')) return;
  const d = document.createElement('div');
  d.id = 'yzpIcons';
  d.innerHTML = `<svg style="display:none" aria-hidden="true">
<symbol id="i-yzp-bike" viewBox="0 0 24 24"><circle cx="6" cy="17" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="18" cy="17" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 17h6l-3-7H8M14 6h3l3 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="i-yzp-pin" viewBox="0 0 24 24"><path d="M12 22s7-7.5 7-13a7 7 0 0 0-14 0c0 5.5 7 13 7 13z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="9" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/></symbol>
<symbol id="i-yzp-bag" viewBox="0 0 24 24"><path d="M5 8h14l-1 13H6L5 8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 8V6a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></symbol>
<symbol id="i-yzp-mic" viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></symbol>
</svg>`;
  document.body.appendChild(d);
}

/* ═══ 3. Canlı məlumat ═══ */
let ACT = {};      // aktiv sifarişlər (active === true)
let RECENT = {};   // son 2 gündə bağlananlar
let started = false;
let onDataTimer = null;
const all = () => {
  const m = { ...RECENT, ...ACT };
  return Object.entries(m).map(([id, o]) => ({ id, ...o })).filter(o => o && o.code);
};
const activeList = () => all().filter(o => ACTIVE.includes(o.status));
const byId = (id) => { const o = ACT[id] || RECENT[id]; return o ? { id, ...o } : null; };

function start() {
  if (started || !state.user) return;
  started = true;
  ensureIcons();
  DSET.on('value', s => { S = { ...DEF, ...(s.val() || {}) }; onData(); });
  DO.orderByChild('active').equalTo(true).on('value', s => { ACT = s.val() || {}; onData(); }, e => console.warn('[paket]', e?.message || e));
  DO.orderByChild('closedAt').startAt(dayStart() - 86400000).on('value', s => { RECENT = s.val() || {}; onData(); }, e => console.warn('[paket]', e?.message || e));
}
function onData() {
  clearTimeout(onDataTimer);
  onDataTimer = setTimeout(() => { refreshViews(); updateBadges(); checkAlerts(); }, 80);
}

/* ═══ 4. Hesablamalar ═══ */
const menuOk = (m) => m && m.available !== false && m.pricingMode !== 'hourly';
const isPackItem = (m) => !!(S.packCategory && m && (m.category || 'Digər') === S.packCategory);
function calcFee(type, zoneId, subtotal) {
  if (type !== 'delivery') return 0;
  let fee = 0;
  if (S.feeMode === 'fixed') fee = num(S.fixedFee);
  else if (S.feeMode === 'zone') fee = num(S.zones?.[zoneId]?.fee);
  if (num(S.freeOver) > 0 && subtotal >= num(S.freeOver)) fee = 0;
  return r2(fee);
}
function totals(items, fee) {
  let sub = 0;
  Object.values(items || {}).forEach(v => { sub += (v.price || 0) * (v.qty || 0); });
  sub = r2(sub);
  const vatAdded = r2(computeVat(items).added || 0);
  return { subtotal: sub, vatAdded, fee: r2(fee), total: r2(sub + vatAdded + r2(fee)) };
}
const orderLabel = (o) => `PAKET ${o.code}${o.type === 'delivery' ? ' · Kuryer' : ' · Özü aparır'}${o.scheduledAt ? ' · ' + fmtT(o.scheduledAt) : ''}`;
const payLabel = (t) => t === 'cash' ? 'Nağd' : t === 'pos' ? 'Kart' : t === 'prepaid' ? 'Öncədən ödənilib' : ((state.paymentMethods || []).find(p => p.id === t)?.name || 'Digər');
const histPush = (id, text, extra = {}) => { const u = me(); return DO.child(id).child('history').push({ at: Date.now(), byId: u.id, byName: u.name, text, ...extra }); };
const timerOf = (o) => {
  if (o.status === 'scheduled' || o.status === 'sending') return { t: o.scheduledAt ? 'Planlı ' + fmtT(o.scheduledAt) : 'göndərilir…', late: false };
  if (o.status === 'cooking') { const m = mins(o.sentAt || o.createdAt); return { t: m + ' dəq', late: m >= num(S.prepTarget || 20) }; }
  if (o.status === 'ready') { const m = mins(o.readyAt || o.sentAt); return { t: 'hazır ' + m + ' dəq', late: m >= 15 }; }
  if (o.status === 'onway') { const m = mins(o.onwayAt); const eta = num(S.zones?.[o.address?.zoneId]?.eta) || 45; return { t: 'yolda ' + m + ' dəq', late: mins(o.sentAt || o.createdAt) > eta + 15 }; }
  return { t: fmtDT(o.closedAt || o.createdAt), late: false };
};

/* ═══ 5. Müştəri kartı ═══ */
async function loadCustomer(pk) {
  if (!pk) return null;
  try { const s = await DC.child(pk).once('value'); return s.val(); } catch (e) { return null; }
}
function customerExtras(pk) {
  const out = {};
  const lc = (state.loyaltyCustomers || []).find(c => phoneKey(c.phone) === pk);
  if (lc) {
    out.loyalty = lc;
    if (lc.birthDate) {
      const [, mm, dd] = String(lc.birthDate).split('-').map(Number);
      if (mm && dd) {
        const now = new Date(); now.setHours(0, 0, 0, 0);
        let b = new Date(now.getFullYear(), mm - 1, dd);
        if (b < now) b = new Date(now.getFullYear() + 1, mm - 1, dd);
        out.bdayIn = Math.round((b - now) / 86400000);
      }
    }
  }
  const cr = (state.customers || []).find(c => phoneKey(c.phone) === pk);
  if (cr && (cr.balance || 0) > 0.01) out.debt = cr.balance;
  return out;
}
function customerChips(c, pk) {
  const x = customerExtras(pk);
  const n = c?.orders || 0;
  const chips = [];
  chips.push(n === 0 ? `<span class="yzp-chip yzp-chip--new">İlk sifarişi</span>` : `<span class="yzp-chip yzp-chip--gold">${ordinal(n + 1)} sifarişi</span>`);
  if (n >= num(S.vipAt || 10)) chips.push(`<span class="yzp-chip yzp-chip--vip">${I('star')} VIP</span>`);
  if (c?.lastAt) chips.push(`<span class="yzp-chip">Son sifariş: ${fmtDT(c.lastAt)}</span>`);
  if (c?.spent) chips.push(`<span class="yzp-chip">Cəmi: ${money(c.spent)}</span>`);
  if (x.loyalty) chips.push(`<span class="yzp-chip yzp-chip--ok">Bonus: ${money(x.loyalty.bonus || 0)}</span>`);
  if (x.bdayIn !== undefined && x.bdayIn <= 7) chips.push(`<span class="yzp-chip yzp-chip--gold">${I('gift')} ${x.bdayIn === 0 ? 'Bu gün ad günüdür!' : `Ad günü ${x.bdayIn} gün sonra`}</span>`);
  if (x.debt) chips.push(`<span class="yzp-chip yzp-chip--bad">Borcu var: ${money(x.debt)}</span>`);
  if (c?.cancels) chips.push(`<span class="yzp-chip yzp-chip--warn">${c.cancels} dəfə ləğv edib</span>`);
  return chips.join('');
}

/* ═══ 6. Əməliyyatlar ═══ */
async function nextCode() {
  const r = await COUNTER.transaction(c => (c || 0) + 1);
  const n = r.snapshot.val();
  return { no: n, code: 'P-' + String(n).padStart(4, '0') };
}

/* Mətbəxə göndərmə: anbardan silmə + mətbəx kartları + mətbəx çeki */
async function sendToKitchen(id, o) {
  const now = Date.now();
  const u = me();
  const items = o.items || {};
  Object.values(items).forEach(it => { if (it.menuItemId) updateStock(it.menuItemId, -it.qty, state.menuItems); });
  const label = orderLabel(o);
  const kNote = [o.type === 'delivery' ? 'PAKET — KURYER İLƏ' : 'PAKET — ÖZÜ APARIR', o.kitchenNote || ''].filter(Boolean).join(' · ');
  const groups = {}, printGroups = { _orderNote: kNote };
  Object.values(items).forEach(it => {
    if (it.pack) return;                       // qablaşdırma mətbəxə getmir
    const m = state.menuItems.find(x => x.id === it.menuItemId);
    const kitchenId = m?.kitchenId || 'default';
    const kitchenName = (state.kitchenStations || []).find(k => k.id === kitchenId)?.name || 'Mətbəx';
    if (!groups[kitchenId]) groups[kitchenId] = { kitchenId, kitchenName, items: [] };
    groups[kitchenId].items.push({ name: it.name, qty: it.qty, note: it.note || '', ready: false, cooking: false, waiterAccepted: false, addedAt: now });
    const cat = m?.category || 'Digər';
    (printGroups[cat] = printGroups[cat] || []).push({ name: it.name, qty: it.qty, note: it.note || '' });
  });
  const kitchenIds = {};
  Object.values(groups).forEach(g => {
    const ref = R.kitchenOrders.push();
    kitchenIds[ref.key] = true;
    ref.set({
      tableId: 'dlv_' + id, tableName: label, deliveryId: id,
      waiterId: o.createdById || u.id, waiterName: o.createdByName || u.name,
      kitchenId: g.kitchenId, kitchenName: g.kitchenName, items: g.items,
      orderNote: kNote, status: 'pending', allReady: false, waiterAccepted: false,
      createdAt: now, time: new Date(now).toLocaleTimeString('az-AZ')
    });
  });
  printKitchenJobs('dlv_' + id, printGroups, { table: { name: label } }).catch(() => {});
  const noKitchen = !Object.keys(kitchenIds).length;
  await DO.child(id).update({
    status: noKitchen ? 'ready' : 'cooking', sentAt: now, readyAt: noKitchen ? now : null,
    kitchenIds: noKitchen ? null : kitchenIds, stockOut: true
  });
  histPush(id, noKitchen ? 'Mətbəx malı yoxdur — dərhal hazırdır' : 'Mətbəxə göndərildi');
}

/* Planlı sifarişi vaxtı çatanda mətbəxə göndər (bir cihaz götürür — transaction) */
async function sendScheduled(id) {
  const res = await DO.child(id).child('status').transaction(cur => (cur === 'scheduled' ? 'sending' : undefined));
  if (!res.committed) return;
  const snap = await DO.child(id).once('value');
  await sendToKitchen(id, snap.val());
}

/* Hesab çeki (kuryer üçün ikinci nüsxə) */
function printBill(o, copies = 1) {
  const items = {};
  Object.entries(o.items || {}).forEach(([k, v]) => { items[k] = v; });
  if (o.fee > 0) items._fee = { name: 'Çatdırılma haqqı', qty: 1, price: o.fee, note: o.address?.zoneName || '' };
  const custLine = [o.customer?.name, phoneNice(o.customer?.phone), o.type === 'delivery' ? o.address?.text : 'Özü aparır', o.address?.note ? 'Qeyd: ' + o.address.note : '', 'Ödəniş: ' + payLabel(o.payMethod) + (o.cashGiven ? ` (${money(o.cashGiven)} verəcək)` : '')].filter(Boolean).join(' · ');
  const order = { items, total: o.total, customerName: custLine, paymentType: payLabel(o.payMethod) };
  for (let i = 0; i < copies; i++) printReceipt('dlv_' + o.id, { table: { name: orderLabel(o) }, order, forceCustomer: true, noMark: true }).catch(() => {});
}

/* Sifarişi bağla (müştəriyə təhvil verildi) */
async function completeOrder(o, pay) {
  const id = o.id;
  // Mərhələ 2c: kassaya pul düşən bağlanış üçün açıq növbə lazımdır (kuryerdəki nağd — təhvil zamanı yazılır)
  const willPay = !(o.type === 'delivery' && pay.type === 'cash' && pay.byCourier) && (Number(o.total) || 0) > 0;
  const shift = willPay ? needShift() : shiftNow();
  if (willPay && !shift) return false;
  const prevStatus = o.status;
  const res = await DO.child(id).child('status').transaction(cur => (['ready', 'onway', 'cooking'].includes(cur) ? 'delivered' : undefined));
  if (!res.committed) { showToast(`${I('warning')} Sifariş artıq bağlanıb və ya ləğv edilib`); return false; }
  const now = Date.now(), u = me();
  const fresh = (await DO.child(id).once('value')).val() || o;
  /* Mərhələ 2b: ödəniş + arxiv + sifarişin bağlanması BİR yazı ilə (yarımçıq qalmır) */
  const UPD = {};
  const total = r2(fresh.total);
  const courierCash = fresh.type === 'delivery' && pay.type === 'cash' && pay.byCourier;
  const typeLabel = payLabel(pay.type);
  const label = `Paket ${fresh.code}`;
  const upd = {
    status: 'delivered', active: null, closedAt: now, deliveredAt: now,
    deliveredById: u.id, deliveredByName: u.name,
    payment: { type: pay.type, label: typeLabel, amount: total, byId: u.id, byName: u.name, at: now, courierCash: !!courierCash }
  };
  if (pay.proof) upd.proof = pay.proof;
  if (courierCash) { upd.unsettledBy = fresh.courierId || u.id; upd.unsettledName = fresh.courierName || u.name; }
  else if (total > 0) {
    UPD['payments/' + R.payments.push().key] = {
      tableId: 'dlv_' + id, tableName: label, sessionId: null, deliveryId: id, shiftId: shift?.id || null,
      staffId: u.id, staffName: u.name, type: pay.type === 'prepaid' ? (fresh.prepaidMethod || 'pos') : pay.type,
      typeLabel: pay.type === 'prepaid' ? `Öncədən ödənilib (${payLabel(fresh.prepaidMethod || 'pos')})` : typeLabel,
      originalAmount: total, finalAmount: total, thisPay: total, paidBefore: 0,
      discountType: null, discountValue: 0,
      createdAt: now, time: new Date(now).toLocaleTimeString('az-AZ'), date: new Date(now).toLocaleDateString('az-AZ')
    };
  }
  const items = { ...(fresh.items || {}) };
  if (fresh.fee > 0) items._delivery_fee = { menuItemId: '_delivery_fee', name: 'Çatdırılma haqqı', price: fresh.fee, qty: 1, note: fresh.address?.zoneName || '', extraFee: 0, vatRate: 0 };
  const hist = Object.values(fresh.history || {}).sort((a, b) => a.at - b.at)
    .map(h => ({ message: `${h.byName || ''}: ${h.text}`, time: new Date(h.at).toLocaleTimeString('az-AZ'), date: new Date(h.at).toLocaleDateString('az-AZ'), timestamp: h.at }));
  UPD['closedOrders/' + R.closedOrders.push().key] = {
    tableId: 'dlv_' + id, tableName: label, deliveryId: id, orderType: fresh.type, shiftId: shift?.id || null,
    staffId: u.id, staffName: u.name,
    openedById: fresh.createdById || null, openedByName: fresh.createdByName || '?',
    orderedById: fresh.createdById || null, orderedByName: fresh.createdByName || '?', waiterSplit: null,
    items, total, notes: fresh.type === 'delivery' ? `${fresh.customer?.name || ''} · ${fresh.address?.text || ''}` : (fresh.customer?.name || ''),
    customerName: fresh.customer?.name || '', customerPhone: fresh.customer?.phone || '',
    courierId: fresh.courierId || null, courierName: fresh.courierName || null,
    paymentLabel: typeLabel, sessionId: null, sessionLog: hist, restoreCount: 0,
    firstOrderAt: fresh.sentAt || fresh.createdAt || now, closedAt: now,
    closedTime: new Date(now).toLocaleTimeString('az-AZ'), closedDate: new Date(now).toLocaleDateString('az-AZ')
  };
  Object.entries(upd).forEach(([k, v]) => { UPD[`deliveryOrders/${id}/${k}`] = v; });
  try { await db.ref().update(UPD); }
  catch (e) {
    await DO.child(id).child('status').transaction(cur => (cur === 'delivered' ? prevStatus : undefined)).catch(() => {});
    showToast(`${I('error')} Sifariş bağlanmadı (bağlantı və ya icazə xətası). Heç nə dəyişməyib, yenidən cəhd edin.`);
    return false;
  }
  Object.keys(fresh.kitchenIds || {}).forEach(k => R.kitchenOrders.child(k).update({ waiterAccepted: true }));
  const pk = fresh.customer?.phoneKey;
  if (pk) {
    const lastItems = Object.values(fresh.items || {}).filter(v => v.menuItemId).map(v => ({ menuItemId: v.menuItemId, qty: v.qty, note: v.note || '', free: !!v.free }));
    DC.child(pk).transaction(c => {
      c = c || {};
      return { ...c, name: fresh.customer?.name || c.name || '', phone: fresh.customer?.phone || c.phone || '', orders: (c.orders || 0) + 1, spent: r2((c.spent || 0) + total), lastAt: now, lastItems };
    });
  }
  histPush(id, fresh.type === 'delivery' ? `Çatdırıldı · ${typeLabel}${courierCash ? ' (pul kuryerdədir)' : ''}` : `Müştəriyə təhvil verildi · ${typeLabel}`);
  addLog('delivery', `${u.name} "${label}" ${fresh.type === 'delivery' ? 'çatdırıldı' : 'təhvil verildi'} (${money(total)}, ${typeLabel})`, { deliveryId: id });
  return true;
}

/* Ləğv */
async function cancelOrder(o) {
  const sent = !!o.stockOut;
  const body = `<p class="yzi-p"><b>${esc(o.code)}</b> · ${esc(o.customer?.name || '')} · ${money(o.total)}</p>
    <label class="yzi-f"><span>Səbəb${S.cancelReasonRequired ? ' *' : ''}</span><input type="text" id="yzpCanReason" maxlength="200" placeholder="Məs: müştəri imtina etdi"></label>
    ${sent ? `<label class="yzp-check"><input type="checkbox" id="yzpCanStock" ${['cooking'].includes(o.status) ? 'checked' : ''}> Məhsullar anbara qaytarılsın (hazırlanmayıbsa)</label>` : ''}
    ${sent ? `<p class="yzi-hint">Mətbəxə "LƏĞV EDİLDİ" çeki göndəriləcək, mətbəx ekranından kart götürüləcək.</p>` : ''}`;
  modal({
    title: 'Sifarişi ləğv et', body,
    actions: [
      { label: 'Bağla', cancel: true, cls: 'yzi-btn--ghost' },
      { label: 'Ləğv et', cls: 'yzi-btn--red', onClick: async (b) => {
        const reason = b.querySelector('#yzpCanReason').value.trim();
        if (S.cancelReasonRequired && !reason) throw new Error('Səbəb yazılmalıdır');
        const back = !!b.querySelector('#yzpCanStock')?.checked;
        const res = await DO.child(o.id).child('status').transaction(cur => (ACTIVE.includes(cur) ? 'cancelled' : undefined));
        if (!res.committed) throw new Error('Sifariş artıq bağlanıb');
        const now = Date.now(), u = me();
        if (sent && back) Object.values(o.items || {}).forEach(it => { if (it.menuItemId) updateStock(it.menuItemId, it.qty, state.menuItems); });
        if (sent) {
          Object.keys(o.kitchenIds || {}).forEach(k => R.kitchenOrders.child(k).update({ allReady: true, waiterAccepted: true, cancelled: true, changeNote: 'LƏĞV EDİLDİ' }));
          const pg = { _orderNote: `LƏĞV EDİLDİ — HAZIRLAMAYIN${reason ? ' · ' + reason : ''}` };
          Object.values(o.items || {}).forEach(it => {
            if (it.pack) return;
            const m = state.menuItems.find(x => x.id === it.menuItemId);
            const cat = m?.category || 'Digər';
            (pg[cat] = pg[cat] || []).push({ name: 'LƏĞV: ' + it.name, qty: it.qty, note: 'LƏĞV EDİLDİ' });
          });
          printKitchenJobs('dlv_' + o.id, pg, { table: { name: 'LƏĞV · ' + orderLabel(o) } }).catch(() => {});
        }
        await DO.child(o.id).update({ active: null, closedAt: now, cancelledAt: now, cancelledById: u.id, cancelledByName: u.name, cancelReason: reason || '', stockReturned: sent && back });
        histPush(o.id, `Ləğv edildi${reason ? ': ' + reason : ''}${sent && back ? ' · məhsullar anbara qaytarıldı' : ''}`);
        const pk = o.customer?.phoneKey;
        if (pk) DC.child(pk).child('cancels').transaction(c => (c || 0) + 1);
        addLog('delivery', `${u.name} "Paket ${o.code}" sifarişini ləğv etdi${reason ? ': ' + reason : ''}`, { deliveryId: o.id });
        showToast(`${I('check')} Sifariş ləğv edildi`);
      } }
    ]
  });
}

/* Kuryer əməliyyatları */
async function courierAccept(o) {
  const u = me();
  const res = await DO.child(o.id).transaction(cur => {
    if (!cur || !ACTIVE.includes(cur.status) || cur.type !== 'delivery') return undefined;
    if (cur.courierId && cur.courierId !== u.id) return undefined;
    if (cur.courierId === u.id && cur.courierStatus === 'accepted') return undefined;
    return { ...cur, courierId: u.id, courierName: u.name, courierStatus: 'accepted', courierAcceptedAt: Date.now() };
  });
  if (!res.committed) {
    const cur = res.snapshot?.val();
    showToast(cur?.courierId && cur.courierId !== u.id ? `${I('warning')} Bu sifarişi artıq ${esc(cur.courierName || 'başqa kuryer')} götürüb` : `${I('warning')} Sifariş artıq aktiv deyil`);
    return false;
  }
  histPush(o.id, 'Kuryer qəbul etdi');
  addLog('delivery', `${u.name} "Paket ${o.code}" çatdırılmasını qəbul etdi`, { deliveryId: o.id });
  showToast(`${I('check')} Qəbul etdiniz: ${esc(o.code)}`);
  return true;
}
async function courierReject(o) {
  const u = me();
  const res = await DO.child(o.id).transaction(cur => {
    if (!cur || cur.courierId !== u.id || cur.status === 'onway') return undefined;
    const n = { ...cur }; delete n.courierId; delete n.courierName; delete n.courierStatus; delete n.courierAcceptedAt;
    n.rejectedBy = { ...(cur.rejectedBy || {}), [u.id]: Date.now() };
    return n;
  });
  if (res.committed) { histPush(o.id, 'Kuryer imtina etdi'); showToast(`${I('check')} İmtina qeyd edildi`); }
  else { // təklif (heç kimə təyin olunmayıb) — yalnız bu cihazda gizlət
    DO.child(o.id).child('rejectedBy').child(u.id).set(Date.now());
  }
}
async function assignCourier(o) {
  const list = couriers();
  if (!list.length) { showToast(`${I('warning')} Kuryer icazəsi olan aktiv işçi yoxdur (İşçilər → İcazələr → Paket və çatdırılma)`); return; }
  const body = `<div class="yzp-pick">${list.map(c => `<label class="yzp-pick__row"><input type="radio" name="yzpCour" value="${esc(c.id)}" ${o.courierId === c.id ? 'checked' : ''}>
      <span><b>${esc(c.name)}</b><small>${c.status === 'online' ? '<i class="yzp-dot yzp-dot--on"></i>Sistemdə' : '<i class="yzp-dot"></i>Sistemdə deyil'} · ${activeList().filter(x => x.courierId === c.id && x.status !== 'delivered').length} aktiv sifariş · üzərində ${money(cashOf(c.id))}</small></span></label>`).join('')}</div>
    <p class="yzi-hint">Kuryerə bildiriş gedəcək, o "Qəbul etdim" basmalıdır.</p>`;
  modal({
    title: `Kuryer təyin et · ${esc(o.code)}`, body,
    actions: [
      { label: 'Bağla', cancel: true, cls: 'yzi-btn--ghost' },
      ...(o.courierId ? [{ label: 'Kuryeri götür', cls: 'yzi-btn--ghost', onClick: async () => {
        await DO.child(o.id).update({ courierId: null, courierName: null, courierStatus: null, courierAcceptedAt: null });
        histPush(o.id, 'Kuryer götürüldü');
      } }] : []),
      { label: 'Təyin et', cls: 'yzi-btn--gold', onClick: async (b) => {
        const cid = b.querySelector('input[name=yzpCour]:checked')?.value;
        if (!cid) throw new Error('Kuryer seçin');
        const name = staffName(cid);
        await DO.child(o.id).update({ courierId: cid, courierName: name, courierStatus: 'assigned', courierAssignedAt: Date.now(), courierAcceptedAt: null });
        histPush(o.id, `Kuryer təyin edildi: ${name}`);
        showToast(`${I('check')} ${esc(name)} təyin edildi`);
      } }
    ]
  });
}
async function markOnway(o) {
  if (o.status === 'cooking' && !(await confirmBox('Mətbəx hələ "Hazırdır" vurmayıb. Yenə də yola çıxılsın?', { okLabel: 'Bəli, yola çıxdı' }))) return;
  const u = me();
  const res = await DO.child(o.id).transaction(cur => {
    if (!cur || !['ready', 'cooking'].includes(cur.status)) return undefined;
    return { ...cur, status: 'onway', onwayAt: Date.now(), courierId: cur.courierId || u.id, courierName: cur.courierName || u.name, courierStatus: 'accepted', courierAcceptedAt: cur.courierAcceptedAt || Date.now() };
  });
  if (!res.committed) { showToast(`${I('warning')} Status dəyişməyib (sifariş artıq yoldadır və ya bağlanıb)`); return; }
  Object.keys(o.kitchenIds || {}).forEach(k => R.kitchenOrders.child(k).update({ waiterAccepted: true }));
  histPush(o.id, 'Yola çıxdı');
  addLog('delivery', `${res.snapshot.val().courierName} "Paket ${o.code}" ilə yola çıxdı`, { deliveryId: o.id });
}
async function markReady(o) {
  const res = await DO.child(o.id).child('status').transaction(cur => (cur === 'cooking' ? 'ready' : undefined));
  if (!res.committed) return;
  await DO.child(o.id).update({ readyAt: Date.now() });
  Object.keys(o.kitchenIds || {}).forEach(k => R.kitchenOrders.child(k).update({ allReady: true, status: 'ready', readyAt: Date.now() }));
  histPush(o.id, 'Hazır kimi işarələndi');
}
async function reportProblem(o) {
  modal({
    title: `Problem · ${esc(o.code)}`,
    body: `<div class="yzp-pick">${Object.entries(PROBLEMS).map(([k, l], i) => `<label class="yzp-pick__row"><input type="radio" name="yzpPr" value="${k}" ${i === 0 ? 'checked' : ''}><span><b>${l}</b></span></label>`).join('')}</div>
      <label class="yzi-f"><span>Qeyd</span><input type="text" id="yzpPrNote" maxlength="200"></label>
      <p class="yzi-hint">Növbə müdirinə dərhal bildiriş gedəcək.</p>`,
    actions: [
      { label: 'Bağla', cancel: true, cls: 'yzi-btn--ghost' },
      { label: 'Göndər', cls: 'yzi-btn--gold', onClick: async (b) => {
        const k = b.querySelector('input[name=yzpPr]:checked')?.value || 'other';
        const note = b.querySelector('#yzpPrNote').value.trim();
        const u = me();
        await DO.child(o.id).child('problem').set({ kind: k, label: PROBLEMS[k], note, at: Date.now(), byId: u.id, byName: u.name });
        histPush(o.id, `Problem: ${PROBLEMS[k]}${note ? ' · ' + note : ''}`);
        showToast(`${I('check')} Bildiriş göndərildi`);
      } }
    ]
  });
}

/* Kuryerin üzərindəki nağd */
let UNSETTLED = {};
const cashOf = (cid) => r2(Object.values(UNSETTLED).filter(o => o.unsettledBy === cid).reduce((s, o) => s + (o.total || 0), 0)
  + all().filter(o => o.unsettledBy === cid && !UNSETTLED[o.id]).reduce((s, o) => s + (o.total || 0), 0));
function watchUnsettled() {
  DO.orderByChild('unsettledBy').startAt('!').on('value', s => {
    const v = s.val() || {};
    UNSETTLED = {}; Object.entries(v).forEach(([id, o]) => { if (o && o.unsettledBy) UNSETTLED[id] = { id, ...o }; });
    onData();
  }, () => {});
}

/* ═══ 7. Ödəniş / təhvil pəncərəsi ═══ */
function payButtons(sel, { door = false } = {}) {
  const opts = [{ id: 'cash', l: 'Nağd' }, { id: 'pos', l: door ? 'Kart (qapıda)' : 'Kart' }, ...(state.paymentMethods || []).map(p => ({ id: p.id, l: p.name }))];
  return opts.map(p => `<button type="button" class="yzp-seg__b${sel === p.id ? ' is-on' : ''}" data-pay="${esc(p.id)}">${esc(p.l)}</button>`).join('');
}
function openHandover(o, { courier = false } = {}) {
  const prepaid = o.payMethod === 'prepaid';
  let sel = prepaid ? 'prepaid' : (o.payMethod || 'cash');
  let proof = null, photo = null;
  const body = document.createElement('div');
  body.className = 'yzp-form';
  const draw = () => {
    body.innerHTML = `
      <div class="yzp-sum"><span>Alınacaq məbləğ</span><b>${prepaid ? '0,00 ₼' : money(o.total)}</b></div>
      ${prepaid ? `<p class="yzi-hint">Sifariş öncədən ödənilib (${esc(payLabel(o.prepaidMethod || 'pos'))}). Pul alınmır.</p>` : `
      <div class="yzp-seg" role="group" aria-label="Necə ödədi">${payButtons(sel, { door: courier })}</div>
      ${sel === 'cash' && o.type === 'delivery' && o.courierId ? `<p class="yzi-hint">Nağd pul kuryerdə (${esc(o.courierName || '')}) qalır — "Kassa təhvili" ilə kassaya keçəcək.</p>` : ''}
      ${sel === 'cash' ? `<label class="yzi-f"><span>Müştəri verdi (₼)</span><input type="text" inputmode="decimal" id="yzpGiven" value="${o.cashGiven ? esc(String(o.cashGiven)) : ''}" placeholder="${r2(o.total)}"></label><div class="yzp-change" id="yzpChange"></div>` : ''}`}
      ${courier ? `<div class="yzp-proof">
        <button type="button" class="yzi-btn yzi-btn--sm" data-photo>${I('camera')} ${photo ? 'Foto çəkildi ✓' : 'Foto (istəyə görə)'}</button>
        <input type="file" accept="image/*" capture="environment" hidden id="yzpPhoto">
        <small id="yzpGeo">${proof ? `Yer qeyd edildi (±${Math.round(proof.acc || 0)} m)` : 'Yer məlumatı alınır…'}</small></div>` : ''}`;
    body.querySelectorAll('[data-pay]').forEach(b => b.addEventListener('click', () => { sel = b.dataset.pay; draw(); }));
    const g = body.querySelector('#yzpGiven');
    const ch = () => { const v = num(g.value); const c = r2(v - o.total); body.querySelector('#yzpChange').innerHTML = v > 0 ? (c >= 0 ? `Qalıq qaytarılacaq: <b>${money(c)}</b>` : `<span class="yzi-bad">Çatışmır: ${money(-c)}</span>`) : ''; };
    if (g) { g.addEventListener('input', ch); ch(); }
    body.querySelector('[data-photo]')?.addEventListener('click', () => body.querySelector('#yzpPhoto').click());
    body.querySelector('#yzpPhoto')?.addEventListener('change', async (e) => { const f = e.target.files?.[0]; if (f) { photo = await shrinkImage(f); draw(); } });
  };
  draw();
  if (courier && navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(p => { proof = { lat: r6(p.coords.latitude), lng: r6(p.coords.longitude), acc: Math.round(p.coords.accuracy || 0), at: Date.now() }; const el = body.querySelector('#yzpGeo'); if (el) el.textContent = `Yer qeyd edildi (±${proof.acc} m)`; },
      () => { const el = body.querySelector('#yzpGeo'); if (el) el.textContent = 'Yer məlumatı alınmadı (icazə verilməyib)'; }, { enableHighAccuracy: true, timeout: 9000, maximumAge: 60000 });
  }
  modal({
    title: `${courier ? 'Təhvil verdim' : 'Ödəniş al və təhvil ver'} · ${esc(o.code)}`, body,
    actions: [
      { label: 'Bağla', cancel: true, cls: 'yzi-btn--ghost' },
      { label: courier ? 'Təhvil verdim' : 'Təhvil ver', cls: 'yzi-btn--gold', onClick: async () => {
        if (!prepaid && sel === 'cash') { const g = num(body.querySelector('#yzpGiven')?.value); if (g && g + 0.009 < o.total) throw new Error('Verilən məbləğ azdır'); }
        if (!prepaid && sel === 'cash' && !can('delivery.manage') && !courier && !hasPermission('bill.payment_cash') && !isRehber()) throw new Error('Nağd ödəniş qəbul etmək icazəniz yoxdur');
        const pr = proof ? { ...proof, photo: !!photo } : (photo ? { photo: true, at: Date.now() } : null);
        if (photo) DP.child(o.id).set({ data: photo, at: Date.now(), byId: me().id });
        const okk = await completeOrder(o, { type: prepaid ? 'prepaid' : sel, byCourier: courier || (o.type === 'delivery' && !!o.courierId), proof: pr });
        if (okk) { showToast(`${I('check')} ${o.type === 'delivery' ? 'Çatdırıldı' : 'Təhvil verildi'}: ${esc(o.code)}`); closeCourierDetail(); }
        if (okk && courier && !prepaid && sel === 'cash') {
          const c = cashOf(me().id) + o.total;
          if (num(S.cashLimit) > 0 && c > num(S.cashLimit)) showToast(`${I('warning')} Üzərinizdə ${money(c)} nağd var — kassaya təhvil verin`);
        }
      } }
    ]
  });
}
const r6 = (n) => Math.round(n * 1e6) / 1e6;
function shrinkImage(file) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 720 / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      res(c.toDataURL('image/jpeg', 0.6)); URL.revokeObjectURL(img.src);
    };
    img.onerror = () => res(null);
    img.src = URL.createObjectURL(file);
  });
}

/* ═══ 8. YENİ PAKET SİFARİŞİ ═══ */
let draft = null;
let cust = null;          // tapılmış müştəri (deliveryCustomers)
let custLookupTimer = null;
const newDraft = () => ({
  items: {}, type: 'delivery', phone: '', name: '', source: 'phone',
  addrId: '', addrLabel: 'Ev', addrText: '', addrNote: '', zoneId: '', saveAddr: true,
  when: 'now', whenTime: '', courierId: '', pay: 'cash', prepaidMethod: 'pos', cashGiven: '', kitchenNote: '',
  cat: 'all', q: ''
});
function openNew(prefill) {
  if (!(can('delivery.take') || can('delivery.manage'))) { showToast(`${I('ban')} Paket sifarişi qəbul etmək icazəniz yoxdur`); return; }
  if (S.enabled === false) { showToast(`${I('warning')} Paket modulu Ayarlarda söndürülüb`); return; }
  draft = { ...newDraft(), ...(prefill || {}) };
  cust = null;
  let s = $('yzpNew');
  if (!s) {
    s = document.createElement('div');
    s.id = 'yzpNew'; s.className = 'yzrv-screen yzp-screen';
    s.innerHTML = `<div class="yzrv-screen__bar yzp-bar"><b>${I('yzp-bag')} Yeni paket sifarişi</b><span class="yzp-bar__sub" id="yzpNewSub"></span>
      <button type="button" class="btn btn-ghost yz-icon-only" data-close aria-label="Bağla" title="Bağla">${I('close')}</button></div>
      <div class="yzp-new" id="yzpNewHost"></div>`;
    s.querySelector('[data-close]').addEventListener('click', () => closeNew());
    document.body.appendChild(s);
  }
  s.classList.add('is-open');
  $('yzpNewSub').textContent = `Qəbul edən: ${me().name} · ${fmtDT(Date.now())}`;
  renderNew();
  if (draft.phone) lookupCustomer();
}
async function closeNew(force) {
  const s = $('yzpNew'); if (!s) return;
  if (!force && draft && Object.keys(draft.items).length && !(await confirmBox('Sifariş göndərilməyib. Bağlansın?', { okLabel: 'Bəli, bağla', okCls: 'yzi-btn--red' }))) return;
  s.classList.remove('is-open'); draft = null;
}
const draftTotals = () => {
  const items = draftItems();
  const sub = totals(items, 0).subtotal;
  return totals(items, calcFee(draft.type, draft.zoneId, sub));
};
function draftItems() {
  const out = {};
  Object.entries(draft.items).forEach(([k, l]) => {
    const m = state.menuItems.find(x => x.id === l.menuItemId);
    if (!m) return;
    const pack = isPackItem(m);
    out[k] = { menuItemId: m.id, name: m.name, listPrice: r2(m.price), price: pack && l.free ? 0 : r2(m.price), qty: l.qty, note: l.note || '', extraFee: 0, vatRate: Number(m.vatRate) || 0, vatIncluded: state.vatMode !== 'added', pack, free: !!(pack && l.free) };
  });
  return out;
}
function addItem(mid) {
  const m = state.menuItems.find(x => x.id === mid); if (!m) return;
  const k = makeLineKey(mid, '', 0);
  const cur = draft.items[k]?.qty || 0;
  if (m.stock !== undefined && m.stock !== null && cur + 1 > m.stock) { showToast(`${I('warning')} "${esc(m.name)}" anbarda kifayət qədər yoxdur`); return; }
  if (draft.items[k]) draft.items[k].qty += 1;
  else draft.items[k] = { menuItemId: mid, qty: 1, note: '', free: isPackItem(m) ? S.packFree !== false : false };
  renderNewCart(); renderNewSide();
}
function renderNew() {
  const host = $('yzpNewHost'); if (!host || !draft) return;
  host.innerHTML = `
    <section class="yzp-panel yzp-panel--menu" aria-label="Menyu">
      <input type="search" class="yzp-input" id="yzpQ" placeholder="Məhsul axtar…" value="${esc(draft.q)}" aria-label="Məhsul axtar">
      <div class="yzp-cats" id="yzpCats"></div>
      <div class="yzp-prods" id="yzpProds"></div>
    </section>
    <section class="yzp-panel yzp-panel--cart" aria-label="Səbət">
      <h3 class="yzp-h">Səbət</h3>
      <div id="yzpCart"></div>
      <label class="yzi-f"><span>Mətbəx üçün qeyd</span><input type="text" id="yzpKNote" maxlength="200" value="${esc(draft.kitchenNote)}"></label>
      <div class="yzp-totals" id="yzpTotals"></div>
    </section>
    <section class="yzp-panel yzp-panel--side" aria-label="Müştəri və çatdırılma" id="yzpSide"></section>
    <div class="yzp-mbar" id="yzpMBar"></div>`;
  const q = host.querySelector('#yzpQ');
  q.addEventListener('input', () => { draft.q = q.value; renderNewMenu(); });
  host.querySelector('#yzpKNote').addEventListener('input', (e) => { draft.kitchenNote = e.target.value; });
  host.querySelector('#yzpCats').addEventListener('click', (e) => { const b = e.target.closest('[data-cat]'); if (b) { draft.cat = b.dataset.cat; renderNewMenu(); } });
  host.querySelector('#yzpProds').addEventListener('click', (e) => { const b = e.target.closest('[data-mid]'); if (b) addItem(b.dataset.mid); });
  host.querySelector('#yzpCart').addEventListener('click', onCartClick);
  host.querySelector('#yzpCart').addEventListener('change', onCartChange);
  renderNewMenu(); renderNewCart(); renderNewSide();
}
function renderNewMenu() {
  const host = $('yzpNewHost'); if (!host) return;
  const items = (state.menuItems || []).filter(menuOk);
  const cats = [...new Set(items.map(m => m.category || 'Digər'))];
  const hasFav = items.some(m => m.isFavorite);
  const list = ['all', ...(hasFav ? ['__fav__'] : []), ...cats];
  host.querySelector('#yzpCats').innerHTML = list.map(c => `<button type="button" class="yzp-cat${draft.cat === c ? ' is-on' : ''}" data-cat="${esc(c)}">${c === 'all' ? 'Hamısı' : c === '__fav__' ? '★ Favorilər' : esc(c)}${c === S.packCategory ? ' ' + I('yzp-bag') : ''}</button>`).join('');
  const q = draft.q.trim().toLowerCase();
  const shown = items.filter(m => q ? String(m.name).toLowerCase().includes(q) : draft.cat === 'all' ? true : draft.cat === '__fav__' ? m.isFavorite : (m.category || 'Digər') === draft.cat);
  host.querySelector('#yzpProds').innerHTML = shown.length ? shown.map(m => {
    const oos = m.stock !== undefined && m.stock !== null && m.stock <= 0;
    return `<button type="button" class="yzp-prod${oos ? ' is-oos' : ''}" data-mid="${esc(m.id)}" ${oos ? 'disabled' : ''}>
      <span class="yzp-prod__n">${esc(m.name)}</span><span class="yzp-prod__p">${money(m.price)}${oos ? ' · bitib' : ''}</span></button>`;
  }).join('') : `<p class="yzi-empty">Məhsul tapılmadı</p>`;
}
function renderNewCart() {
  const host = $('yzpNewHost'); if (!host) return;
  const items = draftItems();
  const keys = Object.keys(items);
  host.querySelector('#yzpCart').innerHTML = keys.length ? keys.map(k => {
    const it = items[k];
    return `<div class="yzp-line">
      <div class="yzp-line__main">
        <span class="yzp-line__n">${esc(it.name)}${it.pack ? ` <span class="yzp-chip">${I('yzp-bag')} qab</span>` : ''}</span>
        <div class="yzp-qty"><button type="button" data-q="-1" data-k="${esc(k)}" aria-label="Azalt">−</button><b>${it.qty}</b><button type="button" data-q="1" data-k="${esc(k)}" aria-label="Artır">+</button></div>
        <span class="yzp-line__t">${it.free ? '<s>' + money(it.listPrice * it.qty) + '</s> 0,00 ₼' : money(it.price * it.qty)}</span>
      </div>
      <div class="yzp-line__sub">
        <input type="text" class="yzp-line__note" data-note="${esc(k)}" value="${esc(it.note)}" placeholder="Qeyd (məs: soğansız)" maxlength="80" aria-label="${esc(it.name)} üçün qeyd">
        ${it.pack ? `<label class="yzp-check yzp-check--sm"><input type="checkbox" data-free="${esc(k)}" ${it.free ? 'checked' : ''}> Pulsuz</label>` : ''}
      </div></div>`;
  }).join('') : `<p class="yzi-empty">Menyudan məhsul seçin</p>`;
  renderNewTotals();
}
function onCartClick(e) {
  const b = e.target.closest('[data-q]'); if (!b) return;
  const k = b.dataset.k, l = draft.items[k]; if (!l) return;
  const d = +b.dataset.q;
  if (d > 0) { const m = state.menuItems.find(x => x.id === l.menuItemId); if (m?.stock !== undefined && m?.stock !== null && l.qty + 1 > m.stock) { showToast(`${I('warning')} Anbarda kifayət qədər yoxdur`); return; } }
  l.qty += d; if (l.qty <= 0) delete draft.items[k];
  renderNewCart(); renderNewSide();
}
function onCartChange(e) {
  const n = e.target.closest('[data-note]');
  if (n && draft.items[n.dataset.note]) { draft.items[n.dataset.note].note = n.value.trim(); return; }
  const f = e.target.closest('[data-free]');
  if (f && draft.items[f.dataset.free]) { draft.items[f.dataset.free].free = f.checked; renderNewCart(); renderNewSide(); }
}
function renderNewTotals() {
  const host = $('yzpNewHost'); if (!host) return;
  const t = draftTotals();
  const z = S.feeMode === 'zone' ? S.zones?.[draft.zoneId] : null;
  const packs = Object.values(draftItems()).filter(i => i.pack);
  host.querySelector('#yzpTotals').innerHTML = `
    <div><span>Məhsullar</span><b>${money(t.subtotal)}</b></div>
    ${packs.length ? `<div><span>Qablaşdırma · ${packs.reduce((s, i) => s + i.qty, 0)} qab</span><b>${money(packs.reduce((s, i) => s + i.price * i.qty, 0))}</b></div>` : ''}
    ${t.vatAdded ? `<div><span>ƏDV</span><b>${money(t.vatAdded)}</b></div>` : ''}
    ${draft.type === 'delivery' ? `<div><span>Çatdırılma${z ? ' · ' + esc(z.name) : ''}${num(S.freeOver) > 0 && t.subtotal >= num(S.freeOver) ? ' (pulsuz həddi)' : ''}</span><b>${money(t.fee)}</b></div>` : ''}
    <div class="yzp-totals__sum"><span>Cəmi</span><b>${money(t.total)}</b></div>`;
  const mb = host.querySelector('#yzpMBar');
  if (mb) {
    const n = Object.values(draft.items).reduce((s, l) => s + l.qty, 0);
    mb.innerHTML = `<span>${n} məhsul · <b>${money(t.total)}</b></span><button type="button" class="yzi-btn yzi-btn--gold yzi-btn--sm">Müştəri məlumatı ↓</button>`;
    mb.querySelector('button').onclick = () => $('yzpSide')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
function renderNewSide() {
  const host = $('yzpSide'); if (!host || !draft) return;
  const pk = phoneKey(draft.phone);
  const addrs = Object.entries(cust?.addresses || {}).map(([id, a]) => ({ id, ...a }));
  const t = draftTotals();
  const z = S.zones?.[draft.zoneId];
  const black = cust?.blacklist?.on;
  const curs = couriers();
  const prepaidOpts = [{ id: 'pos', l: 'Kart / POS' }, ...(state.paymentMethods || []).map(p => ({ id: p.id, l: p.name }))];
  host.innerHTML = `
    <h3 class="yzp-h">Müştəri və çatdırılma</h3>
    <label class="yzi-f"><span>Telefon *</span><input type="tel" id="yzpPhone" value="${esc(draft.phone)}" placeholder="050 555 41 12" autocomplete="off"></label>
    <div id="yzpCust" class="yzp-cust">${draft.phone && phoneOk(draft.phone) ? (cust === null ? '' : `
      ${black ? `<div class="yzp-black">${I('ban')} <b>Qara siyahıda:</b> ${esc(cust.blacklist.reason || 'səbəb yazılmayıb')}<small>${esc(cust.blacklist.byName || '')} · ${fmtDT(cust.blacklist.at)}</small></div>` : ''}
      <div class="yzp-chips">${customerChips(cust, pk)}</div>
      ${cust?.lastItems?.length ? `<button type="button" class="yzi-btn yzi-btn--sm yzi-btn--ghost" data-repeat>${I('refresh')} Son sifarişi təkrarla</button>` : ''}
      ${can('delivery.manage') ? `<button type="button" class="yzi-btn yzi-btn--sm yzi-btn--ghost" data-black>${I('ban')} ${black ? 'Qara siyahıdan çıxar' : 'Qara siyahıya sal'}</button>` : ''}`) : ''}</div>
    <label class="yzi-f"><span>Ad, soyad *</span><input type="text" id="yzpName" value="${esc(draft.name)}" maxlength="80"></label>
    <div class="yzi-f"><span>Sifariş mənbəyi</span><div class="yzp-pills">${Object.entries(SOURCES).map(([k, l]) => `<button type="button" class="yzp-pill${draft.source === k ? ' is-on' : ''}" data-src="${k}">${l}</button>`).join('')}</div></div>
    <div class="yzp-seg yzp-seg--2" role="group" aria-label="Çatdırılma forması">
      <button type="button" class="yzp-seg__b${draft.type === 'pickup' ? ' is-on' : ''}" data-type="pickup">Özü aparır</button>
      <button type="button" class="yzp-seg__b${draft.type === 'delivery' ? ' is-on' : ''}" data-type="delivery">Kuryer ilə</button>
    </div>
    ${draft.type === 'delivery' ? `
      <div class="yzi-f"><span>Ünvan *</span>
        ${addrs.map(a => `<label class="yzp-addr${draft.addrId === a.id ? ' is-on' : ''}"><input type="radio" name="yzpAddr" value="${esc(a.id)}" ${draft.addrId === a.id ? 'checked' : ''}>
          <span><b>${esc(a.label || 'Ünvan')}</b><small>${esc(a.text)}${a.zoneId && S.zones?.[a.zoneId] ? ' · ' + esc(S.zones[a.zoneId].name) : ''}</small></span></label>`).join('')}
        <label class="yzp-addr${!draft.addrId ? ' is-on' : ''}"><input type="radio" name="yzpAddr" value="" ${!draft.addrId ? 'checked' : ''}><span><b>${addrs.length ? '+ Yeni ünvan' : 'Ünvan'}</b></span></label>
      </div>
      ${!draft.addrId ? `<div class="yzp-grid2">
        <label class="yzi-f"><span>Ad</span><input type="text" id="yzpALabel" value="${esc(draft.addrLabel)}" maxlength="20" placeholder="Ev, İş…"></label>
        ${S.feeMode === 'zone' ? `<label class="yzi-f"><span>Zona *</span><select id="yzpZone"><option value="">— seçin —</option>${zonesList().map(z2 => `<option value="${esc(z2.id)}" ${draft.zoneId === z2.id ? 'selected' : ''}>${esc(z2.name)} · ${money(z2.fee)}</option>`).join('')}</select></label>` : ''}
      </div>
      <label class="yzi-f"><span>Ünvan (küçə, bina, mənzil, mərtəbə) *</span><textarea id="yzpAText" rows="2" maxlength="250">${esc(draft.addrText)}</textarea></label>
      <label class="yzp-check yzp-check--sm"><input type="checkbox" id="yzpASave" ${draft.saveAddr ? 'checked' : ''}> Ünvan müştəri kartında saxlanılsın</label>` : ''}
      ${z && S.feeMode === 'zone' ? `<span class="yzp-chip yzp-chip--blue">${esc(z.name)} · ${money(z.fee)}${num(z.min) ? ' · min. sifariş ' + money(z.min) : ''}${num(z.eta) ? ' · ≈' + num(z.eta) + ' dəq' : ''}</span>` : ''}
      <label class="yzi-f"><span>Kuryer üçün qeyd</span><input type="text" id="yzpANote" value="${esc(draft.addrNote)}" maxlength="150" placeholder="Məs: domofon işləmir, çatanda zəng edin"></label>` : ''}
    <div class="yzp-grid2">
      <label class="yzi-f"><span>Nə vaxt</span><select id="yzpWhen"><option value="now" ${draft.when === 'now' ? 'selected' : ''}>Dərhal</option><option value="at" ${draft.when === 'at' ? 'selected' : ''}>Vaxt təyin et…</option></select></label>
      ${draft.when === 'at' ? `<label class="yzi-f"><span>Tarix və saat</span><input type="datetime-local" id="yzpWhenT" value="${esc(draft.whenTime)}"></label>` : ''}
      ${draft.type === 'delivery' ? `<label class="yzi-f"><span>Kuryer</span><select id="yzpCour">
        <option value="">${S.dispatch === 'manual' ? '— sonra təyin ediləcək —' : 'Hamıya göndər — ilk qəbul edən'}</option>
        ${curs.map(c => `<option value="${esc(c.id)}" ${draft.courierId === c.id ? 'selected' : ''}>${esc(c.name)}${c.status === 'online' ? '' : ' (sistemdə deyil)'}</option>`).join('')}</select></label>` : ''}
    </div>
    <div class="yzi-f"><span>Ödəniş forması</span>
      <div class="yzp-seg yzp-seg--wrap">${payButtons(draft.pay, { door: draft.type === 'delivery' })}<button type="button" class="yzp-seg__b${draft.pay === 'prepaid' ? ' is-on' : ''}" data-pay="prepaid">Öncədən ödənilib</button></div>
    </div>
    ${draft.pay === 'cash' ? `<div class="yzp-grid2"><label class="yzi-f"><span>Müştəri neçə verəcək (₼)</span><input type="text" inputmode="decimal" id="yzpGivenN" value="${esc(draft.cashGiven)}" placeholder="${r2(t.total)}"></label>
      <div class="yzp-change">${num(draft.cashGiven) > 0 ? (num(draft.cashGiven) >= t.total ? `Qalıq: <b>${money(num(draft.cashGiven) - t.total)}</b>${draft.type === 'delivery' ? ' — kuryer aparsın' : ''}` : '<span class="yzi-bad">Məbləğdən azdır</span>') : ''}</div></div>` : ''}
    ${draft.pay === 'prepaid' ? `<label class="yzi-f"><span>Hansı yolla ödənilib</span><select id="yzpPrep">${prepaidOpts.map(p => `<option value="${esc(p.id)}" ${draft.prepaidMethod === p.id ? 'selected' : ''}>${esc(p.l)}</option>`).join('')}</select></label>` : ''}
    <div class="yzp-actions">
      <button type="button" class="yzi-btn yzi-btn--gold yzp-confirm" id="yzpConfirm">${I('check')} Təsdiqlə və mətbəxə göndər · ${money(t.total)}</button>
    </div>`;
  bindSide(host);
}
function bindSide(host) {
  const v = (id) => host.querySelector('#' + id);
  v('yzpPhone').addEventListener('input', (e) => { draft.phone = e.target.value; clearTimeout(custLookupTimer); custLookupTimer = setTimeout(lookupCustomer, 450); });
  v('yzpName').addEventListener('input', (e) => { draft.name = e.target.value; });
  host.querySelectorAll('[data-src]').forEach(b => b.addEventListener('click', () => { draft.source = b.dataset.src; renderNewSide(); }));
  host.querySelectorAll('[data-type]').forEach(b => b.addEventListener('click', () => { draft.type = b.dataset.type; renderNewSide(); renderNewTotals(); }));
  host.querySelectorAll('input[name=yzpAddr]').forEach(r => r.addEventListener('change', () => {
    draft.addrId = r.value;
    const a = cust?.addresses?.[r.value];
    if (a) { draft.zoneId = a.zoneId || ''; }
    renderNewSide(); renderNewTotals();
  }));
  v('yzpALabel')?.addEventListener('input', (e) => { draft.addrLabel = e.target.value; });
  v('yzpAText')?.addEventListener('input', (e) => { draft.addrText = e.target.value; });
  v('yzpANote')?.addEventListener('input', (e) => { draft.addrNote = e.target.value; });
  v('yzpASave')?.addEventListener('change', (e) => { draft.saveAddr = e.target.checked; });
  v('yzpZone')?.addEventListener('change', (e) => { draft.zoneId = e.target.value; renderNewSide(); renderNewTotals(); });
  v('yzpWhen').addEventListener('change', (e) => {
    draft.when = e.target.value;
    if (draft.when === 'at' && !draft.whenTime) { const d = new Date(Date.now() + 60 * MIN); d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0); draft.whenTime = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`; }
    renderNewSide();
  });
  v('yzpWhenT')?.addEventListener('change', (e) => { draft.whenTime = e.target.value; });
  v('yzpCour')?.addEventListener('change', (e) => { draft.courierId = e.target.value; });
  host.querySelectorAll('[data-pay]').forEach(b => b.addEventListener('click', () => { draft.pay = b.dataset.pay; renderNewSide(); }));
  v('yzpGivenN')?.addEventListener('change', (e) => { draft.cashGiven = e.target.value; renderNewSide(); });
  v('yzpPrep')?.addEventListener('change', (e) => { draft.prepaidMethod = e.target.value; });
  host.querySelector('[data-repeat]')?.addEventListener('click', repeatLast);
  host.querySelector('[data-black]')?.addEventListener('click', () => toggleBlacklist(phoneKey(draft.phone), cust, () => lookupCustomer()));
  v('yzpConfirm').addEventListener('click', (e) => submitNew(e.currentTarget));
}
async function lookupCustomer() {
  if (!draft) return;
  const pk = phoneKey(draft.phone);
  if (!phoneOk(draft.phone)) { cust = null; renderNewSide(); return; }
  const c = await loadCustomer(pk);
  if (!draft || phoneKey(draft.phone) !== pk) return;
  cust = c || {};
  if (c?.name && !draft.name) draft.name = c.name;
  if (!draft.name) { const lc = customerExtras(pk).loyalty; if (lc) draft.name = [lc.firstName, lc.lastName].filter(Boolean).join(' '); }
  const addrs = Object.entries(c?.addresses || {});
  if (addrs.length && !draft.addrId && !draft.addrText) {
    const [id, a] = addrs.sort((x, y) => (y[1].usedAt || 0) - (x[1].usedAt || 0))[0];
    draft.addrId = id; draft.zoneId = a.zoneId || ''; if (a.note && !draft.addrNote) draft.addrNote = a.note;
  }
  renderNewSide(); renderNewTotals();
  const pos = $('yzpPhone'); if (pos && document.activeElement !== pos) { /* fokus qalır */ }
}
function repeatLast() {
  (cust?.lastItems || []).forEach(li => {
    const m = state.menuItems.find(x => x.id === li.menuItemId);
    if (!menuOk(m)) return;
    const k = makeLineKey(li.menuItemId, li.note || '', 0);
    if (draft.items[k]) draft.items[k].qty += li.qty;
    else draft.items[k] = { menuItemId: li.menuItemId, qty: li.qty, note: li.note || '', free: isPackItem(m) ? (li.free ?? S.packFree !== false) : false };
  });
  renderNewCart(); renderNewSide();
  showToast(`${I('check')} Son sifariş səbətə əlavə edildi`);
}
function toggleBlacklist(pk, c, after) {
  if (!pk) return;
  if (c?.blacklist?.on) {
    confirmBox('Müştəri qara siyahıdan çıxarılsın?', { okLabel: 'Çıxar' }).then(okk => {
      if (!okk) return;
      DC.child(pk).child('blacklist').set(null).then(after);
      addLog('delivery', `${me().name} ${phoneNice(pk)} nömrəsini qara siyahıdan çıxardı`, {});
    });
    return;
  }
  confirmBox('Bu nömrədən sifariş gələndə hamıya xəbərdarlıq göstəriləcək.', { title: 'Qara siyahıya sal', okLabel: 'Qara siyahıya sal', okCls: 'yzi-btn--red', input: 'Səbəb' }).then(reason => {
    if (!reason) return;
    const u = me();
    DC.child(pk).update({ phone: c?.phone || draft?.phone || pk, name: c?.name || draft?.name || '' });
    DC.child(pk).child('blacklist').set({ on: true, reason, at: Date.now(), byId: u.id, byName: u.name }).then(after);
    addLog('delivery', `${u.name} ${phoneNice(pk)} nömrəsini qara siyahıya saldı: ${reason}`, {});
  });
}
async function submitNew(btn) {
  if (!draft || btn.disabled) return;
  const items = draftItems();
  if (!Object.keys(items).length) { showToast(`${I('warning')} Səbət boşdur`); return; }
  if (!phoneOk(draft.phone)) { showToast(`${I('warning')} Telefon nömrəsini düzgün yazın`); $('yzpPhone')?.focus(); return; }
  if (!draft.name.trim()) { showToast(`${I('warning')} Müştərinin adını yazın`); $('yzpName')?.focus(); return; }
  let address = null;
  if (draft.type === 'delivery') {
    const a = draft.addrId ? cust?.addresses?.[draft.addrId] : null;
    const text = a ? a.text : draft.addrText.trim();
    const zoneId = a ? (a.zoneId || draft.zoneId) : draft.zoneId;
    if (!text) { showToast(`${I('warning')} Ünvanı yazın`); return; }
    if (S.feeMode === 'zone' && !zoneId) { showToast(`${I('warning')} Zonanı seçin`); return; }
    address = { id: draft.addrId || null, label: a ? (a.label || '') : (draft.addrLabel || ''), text, zoneId: zoneId || null, zoneName: S.zones?.[zoneId]?.name || null, note: draft.addrNote.trim() };
  }
  let scheduledAt = null;
  if (draft.when === 'at') {
    scheduledAt = draft.whenTime ? new Date(draft.whenTime).getTime() : 0;
    if (!scheduledAt || scheduledAt < Date.now() + 5 * MIN) { showToast(`${I('warning')} Planlı vaxt ən azı 5 dəqiqə sonra olmalıdır`); return; }
  }
  const t = totals(items, calcFee(draft.type, address?.zoneId, totals(items, 0).subtotal));
  if (draft.pay === 'cash' && num(draft.cashGiven) > 0 && num(draft.cashGiven) + 0.009 < t.total) { showToast(`${I('warning')} Müştərinin verəcəyi məbləğ cəmdən azdır`); return; }
  const z = S.feeMode === 'zone' ? S.zones?.[address?.zoneId] : null;
  if (z && num(z.min) > 0 && t.subtotal < num(z.min) && !(await confirmBox(`${esc(z.name)} üçün minimum sifariş ${money(z.min)}-dır, bu sifariş ${money(t.subtotal)}. Yenə də göndərilsin?`, { okLabel: 'Göndər' }))) return;
  if (cust?.blacklist?.on && !(await confirmBox(`<b>Bu nömrə qara siyahıdadır:</b> ${esc(cust.blacklist.reason || '')}. Sifariş yenə də qəbul edilsin?`, { okLabel: 'Bəli, qəbul et', okCls: 'yzi-btn--red' }))) return;
  btn.disabled = true;
  try {
    const { no, code } = await nextCode();
    const u = me(), now = Date.now();
    const pk = phoneKey(draft.phone);
    const ref = DO.push();
    const cid = draft.type === 'delivery' ? draft.courierId : '';
    const o = {
      no, code, type: draft.type, source: draft.source,
      status: scheduledAt ? 'scheduled' : 'sending', active: true,
      customer: { name: draft.name.trim(), phone: draft.phone.trim(), phoneKey: pk },
      address, items, subtotal: t.subtotal, vatAdded: t.vatAdded, fee: t.fee, total: t.total,
      baseFee: calcFee(draft.type, address?.zoneId, 0),
      payMethod: draft.pay, prepaidMethod: draft.pay === 'prepaid' ? draft.prepaidMethod : null,
      cashGiven: draft.pay === 'cash' && num(draft.cashGiven) > 0 ? r2(num(draft.cashGiven)) : null,
      kitchenNote: draft.kitchenNote.trim(), scheduledAt,
      courierId: cid || null, courierName: cid ? staffName(cid) : null, courierStatus: cid ? 'assigned' : null, courierAssignedAt: cid ? now : null,
      createdAt: now, createdById: u.id, createdByName: u.name,
      custOrderNo: (cust?.orders || 0) + 1
    };
    await ref.set(o);
    histPush(ref.key, `Sifariş qəbul edildi (${SOURCES[draft.source] || ''})${scheduledAt ? ' · planlı: ' + fmtDT(scheduledAt) : ''}${cid ? ' · kuryer: ' + o.courierName : ''}`);
    if (!scheduledAt) await sendToKitchen(ref.key, o);
    // Müştəri kartı və ünvan
    const cu = { name: o.customer.name, phone: o.customer.phone, updatedAt: now };
    if (!cust?.createdAt) cu.createdAt = now;
    await DC.child(pk).update(cu);
    if (address) {
      if (address.id) DC.child(pk).child('addresses').child(address.id).update({ usedAt: now, note: address.note || null, zoneId: address.zoneId || null });
      else if (draft.saveAddr) { const ar = DC.child(pk).child('addresses').push(); ar.set({ label: address.label || 'Ünvan', text: address.text, zoneId: address.zoneId || null, note: address.note || null, usedAt: now }); }
    }
    addLog('delivery', `${u.name} paket sifarişi qəbul etdi: ${code} · ${o.customer.name} · ${money(o.total)}${draft.type === 'delivery' ? ' · kuryer ilə' : ' · özü aparır'}`, { deliveryId: ref.key });
    if (S.autoPrint !== false && !scheduledAt) printBill({ id: ref.key, ...o }, draft.type === 'delivery' && S.courierCopy !== false ? 2 : 1);
    showToast(`${I('check')} ${code} qəbul edildi${scheduledAt ? ' (planlı ' + fmtT(scheduledAt) + ')' : ' və mətbəxə göndərildi'}`);
    closeNew(true);
  } catch (e) {
    console.error('[paket]', e);
    showToast(`${I('error')} Sifariş yazılmadı: ${esc(e?.message || e)}`);
  } finally { btn.disabled = false; }
}

/* ═══ 8b. TƏSDİQDƏN SONRA DƏYİŞİKLİK (15.11.2026) ═══
   • Mal əlavə etmək: sifarişi qəbul edən işçi, delivery.manage və ya Rəhbər.
     Kuryer yoldadırsa əlavə olunmur.
   • Mal ləğv etmək: yalnız delivery.item_cancel icazəsi (və Rəhbər), səbəb məcburidir.
   • Mətbəxə "ƏLAVƏ" / "LƏĞV" çeki və kart gedir, anbar düzəlir, cəm yenidən hesablanır,
     kuryer varsa ona bildiriş gedir. Ləğvlər "Ləğvetmələr" hesabatına düşür. */
const canAddTo = (o) => !!o && ['scheduled', 'sending', 'cooking', 'ready'].includes(o.status)
  && (isRehber() || can('delivery.manage') || (o.createdById && o.createdById === me().id));
const canCancelItem = (o) => !!o && ACTIVE.includes(o.status) && can('delivery.item_cancel');
function recalc(o, items) {
  const t0 = totals(items, 0);
  const base = o.baseFee ?? o.fee ?? 0;
  const fee = o.type === 'delivery' ? (num(S.freeOver) > 0 && t0.subtotal >= num(S.freeOver) ? 0 : r2(base)) : 0;
  return totals(items, fee);
}
function notifyCourierChange(o, text) {
  if (o.type === 'delivery' && o.courierId) DO.child(o.id).child('changeSeq').transaction(c => (c || 0) + 1);
  histPush(o.id, text);
}

/* Sifarişi dəyiş pəncərəsi */
function openEdit(id) {
  const o0 = byId(id); if (!o0) return;
  if (!canAddTo(o0) && !canCancelItem(o0)) {
    showToast(`${I('ban')} ${o0.status === 'onway' ? 'Kuryer yoldadır — mal əlavə olunmur. Ləğv üçün "Mal ləğv etmək" icazəsi lazımdır' : 'Bu sifarişi dəyişmək icazəniz yoxdur'}`);
    return;
  }
  const add = {};   // { lineKey: { menuItemId, qty, note, free } }
  let cat = 'all', q = '';
  const body = document.createElement('div');
  body.className = 'yzp-edit';
  const draw = () => {
    const o = byId(id); if (!o) return;
    const cur = Object.entries(o.items || {});
    const canAdd = canAddTo(o), canCan = canCancelItem(o);
    const menu = (state.menuItems || []).filter(menuOk);
    const cats = ['all', ...new Set(menu.map(m => m.category || 'Digər'))];
    const shown = menu.filter(m => q ? String(m.name).toLowerCase().includes(q.toLowerCase()) : cat === 'all' || (m.category || 'Digər') === cat);
    const addItems = {};
    Object.entries(add).forEach(([k, l]) => { const m = state.menuItems.find(x => x.id === l.menuItemId); if (m) { const pack = isPackItem(m); addItems['n_' + k] = { menuItemId: m.id, name: m.name, price: pack && l.free ? 0 : r2(m.price), qty: l.qty, note: l.note, vatRate: Number(m.vatRate) || 0, vatIncluded: state.vatMode !== 'added', pack, free: !!(pack && l.free), listPrice: r2(m.price) }; } });
    const merged = { ...(o.items || {}), ...addItems };
    const t = recalc(o, merged);
    body.innerHTML = `
      <p class="yzi-hint"><b>${esc(o.code)}</b> · ${esc(o.customer?.name || '')} · <span class="yzp-st yzp-st--${ST[o.status]?.c}">${ST[o.status]?.l || ''}</span>${o.status === 'onway' ? ' · kuryer yoldadır, yalnız ləğv mümkündür' : ''}</p>
      <h4 class="yzp-h">Sifarişdəki mallar</h4>
      <div class="yzp-edit__cur">${cur.map(([k, i]) => `<div class="yzp-edit__row"><span><b>${i.qty} ×</b> ${esc(i.name)}${i.note ? ` <small>(${esc(i.note)})</small>` : ''}${i.free ? ' <span class="yzp-chip">pulsuz qab</span>' : ''}</span><b>${money(i.price * i.qty)}</b>
        ${canCan ? `<button type="button" class="yzi-btn yzi-btn--sm yzi-btn--ghost yzp-btn-red" data-cancel-line="${esc(k)}">Ləğv</button>` : ''}</div>`).join('')}</div>
      ${!canCan ? `<p class="yzi-hint">Mal ləğv etmək üçün "Paket: təsdiqlənmiş sifarişdən mal ləğv etmək" icazəsi lazımdır.</p>` : ''}
      ${canAdd ? `<h4 class="yzp-h">Mal əlavə et</h4>
        <input type="search" class="yzp-input" id="yzpEQ" placeholder="Məhsul axtar…" value="${esc(q)}" aria-label="Məhsul axtar">
        <div class="yzp-cats">${cats.map(c => `<button type="button" class="yzp-cat${cat === c ? ' is-on' : ''}" data-ecat="${esc(c)}">${c === 'all' ? 'Hamısı' : esc(c)}</button>`).join('')}</div>
        <div class="yzp-prods yzp-prods--sm">${shown.map(m => { const oos = m.stock !== undefined && m.stock !== null && m.stock <= 0; return `<button type="button" class="yzp-prod${oos ? ' is-oos' : ''}" data-emid="${esc(m.id)}" ${oos ? 'disabled' : ''}><span class="yzp-prod__n">${esc(m.name)}</span><span class="yzp-prod__p">${money(m.price)}</span></button>`; }).join('') || '<p class="yzi-empty">Məhsul tapılmadı</p>'}</div>
        ${Object.keys(addItems).length ? `<h4 class="yzp-h">Əlavə olunacaq</h4><div class="yzp-edit__cur">${Object.entries(add).map(([k, l]) => { const it = addItems['n_' + k]; if (!it) return ''; return `<div class="yzp-edit__row yzp-edit__row--new">
          <span>${esc(it.name)}${it.pack ? ` <label class="yzp-check yzp-check--sm"><input type="checkbox" data-efree="${esc(k)}" ${it.free ? 'checked' : ''}> Pulsuz</label>` : ''}</span>
          <div class="yzp-qty"><button type="button" data-eq="-1" data-k="${esc(k)}" aria-label="Azalt">−</button><b>${it.qty}</b><button type="button" data-eq="1" data-k="${esc(k)}" aria-label="Artır">+</button></div>
          <input type="text" class="yzp-line__note" data-enote="${esc(k)}" value="${esc(l.note)}" placeholder="Qeyd" maxlength="80" aria-label="${esc(it.name)} üçün qeyd"></div>`; }).join('')}</div>` : ''}` : ''}
      <div class="yzp-totals">
        <div><span>Əvvəlki cəm</span><b>${money(o.total)}</b></div>
        <div class="yzp-totals__sum"><span>Yeni cəm</span><b>${money(t.total)}</b></div>
      </div>`;
    body.querySelector('#yzpEQ')?.addEventListener('input', (e) => { q = e.target.value; const pos = e.target.selectionStart; draw(); const n = body.querySelector('#yzpEQ'); n.focus(); n.setSelectionRange(pos, pos); });
    body.querySelectorAll('[data-ecat]').forEach(b => b.addEventListener('click', () => { cat = b.dataset.ecat; draw(); }));
    body.querySelectorAll('[data-emid]').forEach(b => b.addEventListener('click', () => {
      const m = state.menuItems.find(x => x.id === b.dataset.emid); if (!m) return;
      const k = makeLineKey(m.id, '', 0);
      if (add[k]) add[k].qty += 1; else add[k] = { menuItemId: m.id, qty: 1, note: '', free: isPackItem(m) ? S.packFree !== false : false };
      draw();
    }));
    body.querySelectorAll('[data-eq]').forEach(b => b.addEventListener('click', () => { const l = add[b.dataset.k]; if (!l) return; l.qty += +b.dataset.eq; if (l.qty <= 0) delete add[b.dataset.k]; draw(); }));
    body.querySelectorAll('[data-efree]').forEach(c => c.addEventListener('change', () => { if (add[c.dataset.efree]) { add[c.dataset.efree].free = c.checked; draw(); } }));
    body.querySelectorAll('[data-enote]').forEach(i => i.addEventListener('change', () => { if (add[i.dataset.enote]) add[i.dataset.enote].note = i.value.trim(); }));
    body.querySelectorAll('[data-cancel-line]').forEach(b => b.addEventListener('click', () => openCancelItem(byId(id), b.dataset.cancelLine, draw)));
  };
  draw();
  const off = setInterval(() => { if (!body.isConnected) clearInterval(off); }, 2000);
  modal({
    title: `Sifarişi dəyiş · ${esc(o0.code)}`, body, wide: true,
    actions: [
      { label: 'Bağla', cancel: true, cls: 'yzi-btn--ghost' },
      ...(canAddTo(o0) ? [{ label: 'Əlavələri təsdiqlə', cls: 'yzi-btn--gold', onClick: async () => {
        if (!Object.keys(add).length) throw new Error('Əlavə ediləcək mal seçin');
        await addItemsToOrder(id, add);
      } }] : [])
    ]
  });
}

async function addItemsToOrder(id, add) {
  const o = byId(id);
  if (!canAddTo(o)) throw new Error(o?.status === 'onway' ? 'Kuryer yoldadır — mal əlavə olunmur' : 'Bu sifarişə mal əlavə etmək icazəniz yoxdur');
  for (const l of Object.values(add)) {
    const m = state.menuItems.find(x => x.id === l.menuItemId);
    if (m && m.stock !== undefined && m.stock !== null && l.qty > m.stock) throw new Error(`"${m.name}" anbarda kifayət qədər yoxdur`);
  }
  const u = me(), now = Date.now();
  const lines = {};
  Object.values(add).forEach(l => {
    const m = state.menuItems.find(x => x.id === l.menuItemId); if (!m) return;
    const pack = isPackItem(m), free = !!(pack && l.free);
    const k = makeLineKey(m.id, l.note || '', 0) + (free ? '_f' : '');
    lines[k] = { menuItemId: m.id, name: m.name, listPrice: r2(m.price), price: free ? 0 : r2(m.price), qty: l.qty, note: l.note || '', extraFee: 0, vatRate: Number(m.vatRate) || 0, vatIncluded: state.vatMode !== 'added', pack, free };
  });
  let before = null;
  const res = await DO.child(id).transaction(cur => {
    if (!cur || !['scheduled', 'sending', 'cooking', 'ready'].includes(cur.status)) return undefined;
    before = cur.status;
    const items = { ...(cur.items || {}) };
    Object.entries(lines).forEach(([k, l]) => { items[k] = items[k] ? { ...items[k], qty: items[k].qty + l.qty } : l; });
    const t = recalc({ id, ...cur }, items);
    return { ...cur, items, subtotal: t.subtotal, vatAdded: t.vatAdded, fee: t.fee, total: t.total, editedAt: now };
  });
  if (!res.committed) throw new Error('Sifariş artıq dəyişdirilə bilməz (yola çıxıb və ya bağlanıb)');
  const fresh = { id, ...res.snapshot.val() };
  const txt = Object.values(lines).map(l => `${l.qty}× ${l.name}${l.free ? ' (pulsuz)' : ''}`).join(', ');
  if (fresh.stockOut) {
    Object.values(lines).forEach(l => updateStock(l.menuItemId, -l.qty, state.menuItems));
    const label = orderLabel(fresh) + ' · ƏLAVƏ';
    const groups = {}, pg = { _orderNote: `ƏLAVƏ — ${fresh.type === 'delivery' ? 'PAKET, KURYER İLƏ' : 'PAKET, ÖZÜ APARIR'}` };
    Object.values(lines).forEach(l => {
      if (l.pack) return;
      const m = state.menuItems.find(x => x.id === l.menuItemId);
      const kid = m?.kitchenId || 'default';
      if (!groups[kid]) groups[kid] = { kitchenId: kid, kitchenName: (state.kitchenStations || []).find(k => k.id === kid)?.name || 'Mətbəx', items: [] };
      groups[kid].items.push({ name: l.name, qty: l.qty, note: l.note || '', ready: false, cooking: false, waiterAccepted: false, addedAt: now });
      const c = m?.category || 'Digər'; (pg[c] = pg[c] || []).push({ name: l.name, qty: l.qty, note: l.note || '' });
    });
    const kids = {};
    Object.values(groups).forEach(g => {
      const ref = R.kitchenOrders.push(); kids[ref.key] = true;
      ref.set({ tableId: 'dlv_' + id, tableName: label, deliveryId: id, waiterId: u.id, waiterName: u.name,
        kitchenId: g.kitchenId, kitchenName: g.kitchenName, items: g.items, orderNote: pg._orderNote,
        changeNote: `Yeni əlavə: ${g.items.map(i => i.qty + '× ' + i.name).join(', ')}`,
        status: 'pending', allReady: false, waiterAccepted: false, createdAt: now, time: new Date(now).toLocaleTimeString('az-AZ') });
    });
    if (Object.keys(kids).length) {
      printKitchenJobs('dlv_' + id, pg, { table: { name: label } }).catch(() => {});
      const upd = {}; Object.keys(kids).forEach(k => { upd['kitchenIds/' + k] = true; });
      if (fresh.status === 'ready') { upd.status = 'cooking'; upd.readyAt = null; }
      await DO.child(id).update(upd);
    }
  }
  notifyCourierChange(fresh, `Əlavə edildi: ${txt} · yeni cəm ${money(fresh.total)}${before === 'ready' && fresh.stockOut ? ' · yenidən mətbəxdə' : ''}`);
  addLog('delivery', `${u.name} "Paket ${fresh.code}" sifarişinə əlavə etdi: ${txt} (yeni cəm ${money(fresh.total)})`, { deliveryId: id });
  if (S.autoPrint !== false && fresh.stockOut) printBill(fresh, 1);
  showToast(`${I('check')} Əlavə edildi · yeni cəm ${money(fresh.total)}`);
}

function openCancelItem(o, key, after) {
  if (!canCancelItem(o)) { showToast(`${I('ban')} Mal ləğv etmək icazəniz yoxdur`); return; }
  const it = o.items?.[key]; if (!it) return;
  if (Object.keys(o.items).length === 1 && !(it.qty > 1)) { showToast(`${I('warning')} Bu, sifarişdəki yeganə maldır — bütöv sifarişi "Ləğv et" ilə ləğv edin`); return; }
  const sent = !!o.stockOut;
  modal({
    title: `Mal ləğvi · ${esc(o.code)}`,
    body: `<p class="yzi-p"><b>${esc(it.name)}</b> · sifarişdə ${it.qty} ədəd · ${money(it.price)}</p>
      ${it.qty > 1 ? `<label class="yzi-f"><span>Neçə ədəd ləğv edilsin</span><input type="number" id="yzpCiQ" min="1" max="${it.qty}" value="${it.qty}"></label>` : ''}
      <label class="yzi-f"><span>Səbəb *</span><select id="yzpCiR"><option>Müştəri fikrini dəyişdi</option><option>Səhv sifariş</option><option>Məhsul bitib</option><option>Zayolma</option><option value="__other">Digər…</option></select></label>
      <label class="yzi-f" id="yzpCiOW" hidden><span>Səbəbi yazın *</span><input type="text" id="yzpCiO" maxlength="150"></label>
      ${sent ? `<label class="yzp-check"><input type="checkbox" id="yzpCiB" ${['cooking', 'scheduled', 'sending'].includes(o.status) ? 'checked' : ''}> Anbara qaytarılsın (hazırlanmayıbsa)</label>` : ''}
      ${sent && !it.pack ? `<p class="yzi-hint">Mətbəxə "LƏĞV" çeki gedəcək və mətbəx kartı yenilənəcək.</p>` : ''}`,
    actions: [
      { label: 'Bağla', cancel: true, cls: 'yzi-btn--ghost' },
      { label: 'Ləğv et', cls: 'yzi-btn--red', onClick: async (b) => {
        const qn = Math.min(it.qty, Math.max(1, Math.round(num(b.querySelector('#yzpCiQ')?.value || it.qty))));
        let reason = b.querySelector('#yzpCiR').value;
        if (reason === '__other') { reason = b.querySelector('#yzpCiO').value.trim(); if (!reason) throw new Error('Səbəbi yazın'); }
        await cancelItem(o.id, key, qn, reason, !!b.querySelector('#yzpCiB')?.checked);
        after && after();
      } }
    ]
  }).body.querySelector('#yzpCiR').addEventListener('change', (e) => { const w = e.target.closest('.yzi-modal__body').querySelector('#yzpCiOW'); w.hidden = e.target.value !== '__other'; });
}

async function cancelItem(id, key, qn, reason, back) {
  const o = byId(id);
  if (!canCancelItem(o)) throw new Error('Mal ləğv etmək icazəniz yoxdur');
  const u = me(), now = Date.now();
  let it = null;
  const res = await DO.child(id).transaction(cur => {
    if (!cur || !ACTIVE.includes(cur.status) || !cur.items?.[key]) return undefined;
    it = cur.items[key];
    const items = { ...cur.items };
    const q = Math.min(qn, it.qty);
    if (q >= it.qty) delete items[key]; else items[key] = { ...it, qty: it.qty - q };
    if (!Object.keys(items).length) return undefined;
    const t = recalc({ id, ...cur }, items);
    return { ...cur, items, subtotal: t.subtotal, vatAdded: t.vatAdded, fee: t.fee, total: t.total, editedAt: now };
  });
  if (!res.committed) throw new Error('Ləğv alınmadı (sifariş dəyişib və ya bağlanıb)');
  const fresh = { id, ...res.snapshot.val() };
  const q = Math.min(qn, it.qty);
  if (fresh.stockOut && back && it.menuItemId) updateStock(it.menuItemId, q, state.menuItems);
  // Mətbəx kartı: ən yeni sətirdən başlayaraq miqdarı azalt (masalardakı qayda ilə eyni)
  if (fresh.stockOut && !it.pack) {
    let remaining = q;
    const kos = Object.keys(fresh.kitchenIds || {}).map(k => (state.kitchenOrders || []).find(x => x.id === k)).filter(Boolean)
      .filter(ko => !ko.cancelled).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    for (const ko of kos) {
      if (remaining <= 0) break;
      const items = [...(ko.items || [])];
      let touched = false;
      for (let i = items.length - 1; i >= 0 && remaining > 0; i--) {
        if (items[i].name !== it.name || items[i].cancelled || !(items[i].qty > 0)) continue;
        const c = Math.min(items[i].qty, remaining); remaining -= c; touched = true;
        if (items[i].qty - c > 0) items[i] = { ...items[i], qty: items[i].qty - c }; else items.splice(i, 1);
      }
      if (!touched) continue;
      const note = `LƏĞV: ${it.name} — ${q} ədəd. Səbəb: ${reason}`;
      if (!items.length) R.kitchenOrders.child(ko.id).update({ items: [], allReady: true, waiterAccepted: true, cancelled: true, changeNote: note });
      else R.kitchenOrders.child(ko.id).update({ items, allReady: items.every(x => x.ready || x.cancelled), changeNote: note });
    }
    const m = state.menuItems.find(x => x.id === it.menuItemId);
    printKitchenJobs('dlv_' + id, { _orderNote: `LƏĞV — ${reason}`, [m?.category || 'Digər']: [{ name: 'LƏĞV: ' + it.name, qty: q, note: 'LƏĞV EDİLDİ' }] }, { table: { name: 'LƏĞV · ' + orderLabel(fresh) } }).catch(() => {});
  }
  const amount = r2(it.price * q);
  notifyCourierChange(fresh, `Ləğv edildi: ${q}× ${it.name} · səbəb: ${reason}${fresh.stockOut && back ? ' · anbara qaytarıldı' : ''} · yeni cəm ${money(fresh.total)}`);
  addLog('order_cancel', `${u.name} "Paket ${fresh.code}" sifarişindən "${it.name}" malından ${q} ədəd ləğv etdi (${amount.toFixed(2)} ₼) — Sifarişi vermiş: ${fresh.createdByName || '?'} — Səbəb: ${reason}`,
    { tableId: 'dlv_' + id, tableName: `Paket ${fresh.code}`, deliveryId: id, menuItemId: it.menuItemId, itemName: it.name, qty: q, amount, reason,
      staffId: u.id, staffName: u.name, orderOwnerId: fresh.createdById || null, orderOwnerName: fresh.createdByName || '?' });
  showToast(`${I('check')} Ləğv edildi · yeni cəm ${money(fresh.total)}`);
}

/* ═══ 9. LÖVHƏ ═══ */
const view = { tab: 'active', filter: 'all', q: '' };
const COLS = [
  { k: 'scheduled', t: 'Planlı', dot: 'var(--blue)', st: ['scheduled', 'sending'] },
  { k: 'cooking', t: 'Hazırlanır', dot: 'var(--gold)', st: ['cooking'] },
  { k: 'ready', t: 'Hazırdır', dot: 'var(--green)', st: ['ready'] },
  { k: 'onway', t: 'Yoldadır', dot: 'var(--purple, #6d3fa0)', st: ['onway'] }
];
const filterOk = (o) => {
  if (view.filter === 'pickup' && o.type !== 'pickup') return false;
  if (view.filter === 'delivery' && o.type !== 'delivery') return false;
  if (view.filter === 'late' && !timerOf(o).late) return false;
  const q = view.q.trim().toLowerCase();
  if (q) {
    const hay = `${o.code} ${o.customer?.name || ''} ${o.customer?.phone || ''} ${phoneKey(o.customer?.phone)} ${o.address?.text || ''}`.toLowerCase();
    if (!hay.includes(q) && !hay.includes(phoneKey(q))) return false;
  }
  return true;
};
function render(host) {
  if (!host) return;
  const ae = document.activeElement;
  const keep = ae && host.contains(ae) && ae.id ? { id: ae.id, s: ae.selectionStart, e: ae.selectionEnd } : null;
  renderInner(host);
  if (keep) { const n = host.querySelector('#' + keep.id); if (n) { n.focus(); try { n.setSelectionRange(keep.s, keep.e); } catch (er) { /* */ } } }
}
function renderInner(host) {
  host.classList.add('yzp');
  if (!anyAccess()) { host.innerHTML = `<p class="yzi-empty">Bu bölmə üçün icazəniz yoxdur.</p>`; return; }
  if (!canBoard() || view.tab === 'mine') { renderCourier(host); return; }
  const act = activeList();
  const today = all().filter(o => (o.closedAt || 0) >= dayStart());
  const done = today.filter(o => o.status === 'delivered');
  const canc = today.filter(o => o.status === 'cancelled');
  const late = act.filter(o => timerOf(o).late).length;
  const avgPrep = (() => { const xs = done.filter(o => o.readyAt && o.sentAt).map(o => (o.readyAt - o.sentAt) / MIN); return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null; })();
  const avgDel = (() => { const xs = done.filter(o => o.type === 'delivery' && o.deliveredAt && o.sentAt).map(o => (o.deliveredAt - o.sentAt) / MIN); return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null; })();
  const unsettledTotal = r2(Object.values(UNSETTLED).reduce((s, o) => s + (o.total || 0), 0));
  host.innerHTML = `
    <div class="yzp-top">
      <div class="yzp-top__t"><h2 class="yzp-h1">Paket və çatdırılma</h2><small>${fmtDT(Date.now())}</small></div>
      <div class="yzp-pills" role="group" aria-label="Filtr">
        ${[['all', 'Hamısı', act.length], ['pickup', 'Özü aparır', act.filter(o => o.type === 'pickup').length], ['delivery', 'Kuryer', act.filter(o => o.type === 'delivery').length], ['late', 'Gecikən', late]]
          .map(([k, l, n]) => `<button type="button" class="yzp-pill${view.filter === k ? ' is-on' : ''}" data-f="${k}">${l} · ${n}</button>`).join('')}
      </div>
      <input type="search" class="yzp-input yzp-search" id="yzpSearch" placeholder="Telefon, ad və ya № ilə axtar" value="${esc(view.q)}" aria-label="Axtar">
      <div class="yzp-top__btns">
        ${can('delivery.settle') ? `<button type="button" class="yzi-btn yzi-btn--ghost" data-settle>${I('cash')} Kassa təhvili${unsettledTotal ? ` <span class="yzp-chip yzp-chip--gold">${money(unsettledTotal)}</span>` : ''}</button>` : ''}
        ${isRehber() ? `<button type="button" class="yzi-btn yzi-btn--ghost yz-icon-only" data-settings aria-label="Paket ayarları" title="Paket ayarları">${I('settings')}</button>` : ''}
        ${can('delivery.take') || can('delivery.manage') ? `<button type="button" class="yzi-btn yzi-btn--gold" data-new>${I('plus')} Yeni paket</button>` : ''}
      </div>
    </div>
    <div class="yzp-kpis">
      <div class="yzi-kpi"><small>Aktiv sifariş</small><b class="yzp-gold">${act.length}</b></div>
      <div class="yzi-kpi"><small>Orta hazırlanma / çatdırılma (bu gün)</small><b>${avgPrep ?? '—'} / ${avgDel ?? '—'} dəq</b></div>
      <div class="yzi-kpi${late ? ' yzi-kpi--bad' : ''}"><small>Gecikən</small><b>${late}</b></div>
      <div class="yzi-kpi"><small>Bu gün tamamlanıb</small><b class="yzp-green">${done.length} · ${money(done.reduce((s, o) => s + (o.total || 0), 0))}</b></div>
    </div>
    <div class="yzp-tabs" role="tablist">
      <button type="button" class="yzp-tab${view.tab === 'active' ? ' is-on' : ''}" data-tab="active">Aktiv</button>
      <button type="button" class="yzp-tab${view.tab === 'done' ? ' is-on' : ''}" data-tab="done">Tamamlanan · ${done.length}</button>
      <button type="button" class="yzp-tab${view.tab === 'cancelled' ? ' is-on' : ''}" data-tab="cancelled">Ləğv edilən · ${canc.length}</button>
      ${isCourier() ? `<button type="button" class="yzp-tab" data-tab="mine">${I('yzp-bike')} Mənim çatdırılmalarım</button>` : ''}
    </div>
    ${view.tab === 'active' ? `<div class="yzp-cols">${COLS.map(c => {
      const list = act.filter(o => c.st.includes(o.status) && filterOk(o)).sort((a, b) => (a.scheduledAt || a.sentAt || a.createdAt) - (b.scheduledAt || b.sentAt || b.createdAt));
      return `<section class="yzp-col"><header class="yzp-col__h"><i style="background:${c.dot}"></i><h3>${c.t}</h3><span>${list.length}</span></header>
        ${list.map(cardHtml).join('') || '<p class="yzp-col__empty">Boşdur</p>'}</section>`;
    }).join('')}</div>`
    : `<div class="yzp-hist">${(view.tab === 'done' ? done : canc).filter(filterOk).sort((a, b) => b.closedAt - a.closedAt).map(histRow).join('') || '<p class="yzi-empty">Bu gün yoxdur</p>'}</div>`}`;
  host.querySelectorAll('[data-f]').forEach(b => b.addEventListener('click', () => { view.filter = b.dataset.f; refreshViews(); }));
  host.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { view.tab = b.dataset.tab; refreshViews(); }));
  const sr = host.querySelector('#yzpSearch');
  sr.addEventListener('input', () => { view.q = sr.value; clearTimeout(sr._t); sr._t = setTimeout(() => { refreshViews(); const n = host.querySelector('#yzpSearch'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 250); });
  host.querySelector('[data-new]')?.addEventListener('click', () => openNew());
  host.querySelector('[data-settings]')?.addEventListener('click', openSettings);
  host.querySelector('[data-settle]')?.addEventListener('click', () => openSettlement());
  host.querySelectorAll('[data-open]').forEach(el => el.addEventListener('click', (e) => { if (e.target.closest('[data-act]')) return; openDetail(el.dataset.open); }));
  host.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => doAction(b.dataset.act, byId(b.dataset.id))));
}
function primaryAction(o) {
  const mg = can('delivery.manage'), tk = can('delivery.take');
  if (o.status === 'scheduled' && (mg || tk)) return ['sendnow', 'İndi mətbəxə göndər'];
  if (o.status === 'cooking' && mg) return ['ready', 'Hazırdır (əl ilə)'];
  if (o.status === 'ready' && o.type === 'pickup' && (mg || tk)) return ['handover', 'Ödəniş al · təhvil ver'];
  if (o.status === 'ready' && o.type === 'delivery' && !o.courierId && mg) return ['assign', 'Kuryer təyin et'];
  if (o.status === 'ready' && o.type === 'delivery' && o.courierId && mg) return ['onway', 'Yola çıxdı'];
  if (o.status === 'onway' && mg) return ['deliver', 'Çatdırıldı'];
  return ['detail', 'Ətraflı'];
}
function cardHtml(o) {
  const tm = timerOf(o);
  const [act, lbl] = primaryAction(o);
  const courier = o.type === 'delivery'
    ? (o.courierId ? `${esc(o.courierName || '')}${o.courierStatus === 'assigned' ? ' · qəbul gözlənilir' : ''}` : 'Kuryer təyin edilməyib')
    : 'Özü gəlib götürəcək';
  return `<article class="yzp-card${tm.late ? ' is-late' : ''}${o.problem ? ' is-problem' : ''}" data-open="${esc(o.id)}" tabindex="0">
    <div class="yzp-card__h"><b class="yzp-gold">${esc(o.code)}</b><span class="yzp-type yzp-type--${o.type}">${o.type === 'delivery' ? 'Kuryer' : 'Özü aparır'}</span><span class="yzp-card__tm${tm.late ? ' is-late' : ''}">${esc(tm.t)}</span></div>
    <div class="yzp-card__c"><div class="yzp-card__nm"><b>${esc(o.customer?.name || '')}</b>${o.custOrderNo === 1 ? '<span class="yzp-chip yzp-chip--new">İlk</span>' : o.custOrderNo >= num(S.vipAt || 10) ? `<span class="yzp-chip yzp-chip--vip">VIP</span>` : o.custOrderNo > 1 ? `<span class="yzp-chip">${ordinal(o.custOrderNo)}</span>` : ''}</div><small>${esc(phoneNice(o.customer?.phone))}</small>
      ${o.type === 'delivery' ? `<small>${esc(o.address?.text || '')}${o.address?.zoneName ? ' · ' + esc(o.address.zoneName) : ''}</small>` : ''}</div>
    ${o.problem ? `<div class="yzp-card__pr">${I('warning')} ${esc(o.problem.label)}</div>` : ''}
    <div class="yzp-card__f"><small>${Object.values(o.items || {}).reduce((s, i) => s + (i.qty || 0), 0)} məhsul</small><span class="yzp-chip">${esc(payLabel(o.payMethod))}</span><b>${money(o.total)}</b></div>
    <div class="yzp-card__cr${o.type === 'delivery' && !o.courierId ? ' is-warn' : ''}">${I('yzp-bike')} ${courier}</div>
    <button type="button" class="yzi-btn yzi-btn--sm ${['sendnow', 'handover', 'assign', 'onway', 'deliver'].includes(act) ? 'yzi-btn--gold' : 'yzi-btn--ghost'}" data-act="${act}" data-id="${esc(o.id)}">${lbl}</button>
  </article>`;
}
function histRow(o) {
  return `<button type="button" class="yzp-hrow" data-open="${esc(o.id)}">
    <b class="yzp-gold">${esc(o.code)}</b><span>${esc(o.customer?.name || '')} · ${esc(phoneNice(o.customer?.phone))}</span>
    <span>${o.type === 'delivery' ? 'Kuryer' + (o.courierName ? ': ' + esc(o.courierName) : '') : 'Özü aparır'}</span>
    <span>${o.status === 'cancelled' ? '<span class="yzi-bad">' + esc(o.cancelReason || 'Ləğv') + '</span>' : esc(o.payment?.label || '')}${o.unsettledBy ? ' · <span class="yzp-chip yzp-chip--gold">kuryerdə</span>' : ''}</span>
    <span>${fmtDT(o.closedAt)}</span><b>${money(o.total)}</b></button>`;
}
function doAction(act, o) {
  if (!o) return;
  if (act === 'detail') return openDetail(o.id);
  if (act === 'sendnow') return sendScheduledNow(o);
  if (act === 'ready') return markReady(o);
  if (act === 'handover') return openHandover(o);
  if (act === 'assign') return assignCourier(o);
  if (act === 'onway') return markOnway(o);
  if (act === 'deliver') return openHandover(o, { courier: false });
}
async function sendScheduledNow(o) {
  if (!(await confirmBox(`${esc(o.code)} planlı vaxtdan (${fmtDT(o.scheduledAt)}) əvvəl mətbəxə göndərilsin?`, { okLabel: 'Göndər' }))) return;
  await sendScheduled(o.id);
  if (S.autoPrint !== false) printBill(o, o.type === 'delivery' && S.courierCopy !== false ? 2 : 1);
}

/* Sifarişin detalları */
function openDetail(id) {
  const o = byId(id); if (!o) return;
  const hist = Object.values(o.history || {}).sort((a, b) => a.at - b.at);
  const mg = can('delivery.manage');
  const activeO = ACTIVE.includes(o.status);
  const items = Object.values(o.items || {});
  const tel = phoneKey(o.customer?.phone);
  const body = `
    <div class="yzp-det">
      <div class="yzp-det__row"><span class="yzp-st yzp-st--${ST[o.status]?.c || 'cook'}">${ST[o.status]?.l || o.status}</span><span class="yzp-type yzp-type--${o.type}">${o.type === 'delivery' ? 'Kuryer ilə' : 'Özü aparır'}</span>
        ${o.scheduledAt ? `<span class="yzp-chip yzp-chip--blue">Planlı: ${fmtDT(o.scheduledAt)}</span>` : ''}<span class="yzp-chip">${esc(SOURCES[o.source] || '')}</span></div>
      <div class="yzp-det__cust"><b>${esc(o.customer?.name || '')}</b>${o.custOrderNo ? ` <span class="yzp-chip yzp-chip--gold">${ordinal(o.custOrderNo)} sifarişi</span>` : ''}
        <div class="yzp-det__links"><a class="yzi-btn yzi-btn--sm yzi-btn--ghost" href="tel:+${esc(tel)}">${I('phone')} ${esc(phoneNice(o.customer?.phone))}</a>
        <a class="yzi-btn yzi-btn--sm yzi-btn--ghost" href="https://wa.me/${esc(tel)}" target="_blank" rel="noopener">${I('chat')} WhatsApp</a></div>
        ${o.type === 'delivery' ? `<p class="yzp-det__addr">${I('yzp-pin')} ${esc(o.address?.text || '')}${o.address?.zoneName ? ' · ' + esc(o.address.zoneName) : ''}</p>${o.address?.note ? `<p class="yzp-det__note">Kuryer üçün: ${esc(o.address.note)}</p>` : ''}` : ''}</div>
      ${o.problem ? `<div class="yzp-black">${I('warning')} <b>${esc(o.problem.label)}</b> ${esc(o.problem.note || '')}<small>${esc(o.problem.byName || '')} · ${fmtDT(o.problem.at)}</small></div>` : ''}
      <div class="yzp-det__items">${items.map(i => `<div><span>${i.qty} × ${esc(i.name)}${i.note ? ` <small>(${esc(i.note)})</small>` : ''}${i.free ? ' <span class="yzp-chip">pulsuz qab</span>' : ''}</span><b>${money(i.price * i.qty)}</b></div>`).join('')}
        ${o.fee ? `<div><span>Çatdırılma haqqı</span><b>${money(o.fee)}</b></div>` : ''}${o.vatAdded ? `<div><span>ƏDV</span><b>${money(o.vatAdded)}</b></div>` : ''}
        <div class="yzp-det__sum"><span>Cəmi</span><b>${money(o.total)}</b></div></div>
      <p class="yzi-hint">Ödəniş: <b>${esc(payLabel(o.payMethod))}</b>${o.payMethod === 'prepaid' ? ' (' + esc(payLabel(o.prepaidMethod || 'pos')) + ')' : ''}${o.cashGiven ? ` · müştəri ${money(o.cashGiven)} verəcək, qalıq ${money(o.cashGiven - o.total)}` : ''}${o.payment ? ` · alındı: ${esc(o.payment.label)} (${esc(o.payment.byName || '')}, ${fmtDT(o.payment.at)})` : ''}${o.unsettledBy ? ' · <b>pul kuryerdədir</b>' : ''}</p>
      ${o.kitchenNote ? `<p class="yzi-hint">Mətbəx qeydi: ${esc(o.kitchenNote)}</p>` : ''}
      ${o.type === 'delivery' ? `<p class="yzi-hint">${I('yzp-bike')} Kuryer: <b>${esc(o.courierName || 'təyin edilməyib')}</b>${o.courierStatus === 'assigned' ? ' (qəbul gözlənilir)' : ''}</p>` : ''}
      ${o.proof ? `<p class="yzi-hint">Təhvil yeri: ${o.proof.lat ? `<a href="https://www.google.com/maps?q=${o.proof.lat},${o.proof.lng}" target="_blank" rel="noopener">xəritədə bax</a> (±${o.proof.acc || 0} m)` : 'qeyd edilməyib'}${o.proof.photo ? ' · <button type="button" class="yzp-linkbtn" data-photo>foto</button>' : ''}</p>` : ''}
      <h4 class="yzp-h">Tarixçə</h4>
      <ol class="yzp-tl">${hist.map(h => `<li><b>${fmtDT(h.at)}</b> · ${esc(h.text)} <small>${esc(h.byName || '')}</small></li>`).join('')}</ol>
    </div>`;
  const acts = [{ label: 'Bağla', cancel: true, cls: 'yzi-btn--ghost' }];
  acts.push({ label: `${I('printer')} Çek`, cls: 'yzi-btn--ghost', close: false, onClick: () => { printBill(o, 1); showToast(`${I('check')} Çek printerə göndərildi`); } });
  if (activeO && mg) acts.push({ label: 'Ləğv et', cls: 'yzi-btn--red', onClick: () => cancelOrder(o) });
  else if (activeO && o.status === 'scheduled' && o.createdById === me().id) acts.push({ label: 'Ləğv et', cls: 'yzi-btn--red', onClick: () => cancelOrder(o) });
  if (activeO && o.type === 'delivery' && mg && o.status !== 'onway') acts.push({ label: 'Kuryer', cls: 'yzi-btn--ghost', onClick: () => assignCourier(o) });
  if (canAddTo(o) || canCancelItem(o)) acts.push({ label: `${I('edit')} Dəyiş`, cls: 'yzi-btn--ghost', onClick: () => openEdit(o.id) });
  if (o.problem && activeO && mg) acts.push({ label: 'Problemi bağla', cls: 'yzi-btn--ghost', onClick: async () => { await DO.child(o.id).child('problem').set(null); histPush(o.id, 'Problem həll edildi'); } });
  const [pa, pl] = primaryAction(o);
  if (activeO && pa !== 'detail') acts.push({ label: pl, cls: 'yzi-btn--gold', onClick: () => doAction(pa, o) });
  const m = modal({ title: `${esc(o.code)} · ${fmtDT(o.createdAt)}`, body, wide: true, actions: acts });
  m.body.querySelector('[data-photo]')?.addEventListener('click', async () => {
    const s = await DP.child(o.id).once('value'); const d = s.val();
    if (d?.data) modal({ title: 'Təhvil fotosu', body: `<img src="${esc(d.data)}" alt="Təhvil fotosu" style="max-width:100%;border-radius:10px">` });
  });
}

/* ═══ 10. KURYER EKRANI ═══ */
let courierOpenId = null;
function renderCourier(host) {
  const u = me();
  if (courierOpenId) {
    const o = byId(courierOpenId);
    // qəbul yeni edilibsə, baza yenilənməsi bir an gecikə bilər — sifariş başqasına keçməyibsə detal açıq qalır
    if (o && ACTIVE.includes(o.status) && (!o.courierId || o.courierId === u.id)) { renderCourierDetail(host, o); return; }
    courierOpenId = null;
  }
  const act = activeList().filter(o => o.type === 'delivery');
  const offers = act.filter(o => (!o.courierId && S.dispatch !== 'manual' && !o.rejectedBy?.[u.id]) || (o.courierId === u.id && o.courierStatus === 'assigned'));
  const mine = act.filter(o => o.courierId === u.id && o.courierStatus === 'accepted');
  const todayDone = all().filter(o => o.status === 'delivered' && o.courierId === u.id && (o.closedAt || 0) >= dayStart()).length;
  host.innerHTML = `
    <div class="yzp-cr">
      ${canBoard() ? `<button type="button" class="yzi-btn yzi-btn--sm yzi-btn--ghost" data-back>${I('back')} Lövhəyə qayıt</button>` : ''}
      <div class="yzp-cr__kpis">
        <div class="yzi-kpi"><small>Üzərimdəki nağd</small><b class="yzp-gold">${money(cashOf(u.id))}</b></div>
        <div class="yzi-kpi"><small>Bu gün çatdırdım</small><b>${todayDone}</b></div>
      </div>
      ${offers.length ? `<h3 class="yzp-h">Yeni çatdırılmalar</h3>${offers.map(o => `
        <div class="yzp-offer">
          <div class="yzp-offer__h">${I('bell')} <b>${o.courierId === u.id ? 'Sizə təyin edildi' : 'Yeni çatdırılma'}</b><span class="yzp-st yzp-st--${ST[o.status]?.c}">${ST[o.status]?.l || ''}</span></div>
          <div class="yzp-offer__no"><b>${esc(o.code)}</b><small>${Object.values(o.items || {}).reduce((s, i) => s + i.qty, 0)} məhsul${o.scheduledAt ? ' · planlı ' + fmtT(o.scheduledAt) : ''}</small></div>
          <p>${I('yzp-pin')} <b>${esc(o.address?.text || '')}</b><small>${esc(o.address?.zoneName || '')} · ${esc(o.customer?.name || '')}</small></p>
          <div class="yzp-sum"><span>${o.payMethod === 'prepaid' ? 'Öncədən ödənilib' : 'Müştəridən al (' + esc(payLabel(o.payMethod)) + ')'}</span><b>${o.payMethod === 'prepaid' ? '0,00 ₼' : money(o.total)}</b></div>
          <div class="yzp-offer__b"><button type="button" class="yzi-btn yzi-btn--ghost yzp-btn-red" data-rej="${esc(o.id)}">İmtina</button><button type="button" class="yzi-btn yzi-btn--gold" data-acc="${esc(o.id)}">Qəbul etdim</button></div>
        </div>`).join('')}` : ''}
      <h3 class="yzp-h">Mənim sifarişlərim</h3>
      ${mine.length ? mine.map(o => `<button type="button" class="yzp-mine" data-mine="${esc(o.id)}"><i class="yzp-dot yzp-dot--${ST[o.status]?.c}"></i>
        <span><b>${esc(o.code)} · ${ST[o.status]?.l || ''}</b><small>${esc(o.address?.text || '')} · ${esc(timerOf(o).t)}</small></span><b>${money(o.total)}</b></button>`).join('') : '<p class="yzi-empty">Aktiv çatdırılmanız yoxdur</p>'}
    </div>`;
  host.querySelector('[data-back]')?.addEventListener('click', () => { view.tab = 'active'; refreshViews(); });
  host.querySelectorAll('[data-acc]').forEach(b => b.addEventListener('click', async () => { b.disabled = true; const o = byId(b.dataset.acc); if (o && await courierAccept(o)) { courierOpenId = o.id; } refreshViews(); }));
  host.querySelectorAll('[data-rej]').forEach(b => b.addEventListener('click', async () => { const o = byId(b.dataset.rej); if (o && await confirmBox(`${esc(o.code)} — imtina edilsin?`, { okLabel: 'İmtina', okCls: 'yzi-btn--red' })) { await courierReject(o); refreshViews(); } }));
  host.querySelectorAll('[data-mine]').forEach(b => b.addEventListener('click', () => { courierOpenId = b.dataset.mine; refreshViews(); }));
}
function renderCourierDetail(host, o) {
  const step = (done, cur, l, t) => `<li class="${done ? 'is-done' : cur ? 'is-cur' : ''}"><span>${done ? '✓' : ''}</span><b>${l}</b><small>${t ? fmtT(t) : '—'}</small></li>`;
  const tel = phoneKey(o.customer?.phone);
  const q = encodeURIComponent(`${o.address?.text || ''}${S.restaurantCity ? ', ' + S.restaurantCity : ''}`);
  host.innerHTML = `
    <div class="yzp-cr">
      <div class="yzp-cr__top"><button type="button" class="yzi-btn yzi-btn--ghost yz-icon-only" data-back aria-label="Geri" title="Geri">${I('back')}</button>
        <div><b class="yzp-h1">${esc(o.code)}</b><small class="yzp-st yzp-st--${ST[o.status]?.c}">${ST[o.status]?.l} · ${esc(timerOf(o).t)}</small></div>
        <button type="button" class="yzp-ptt" data-ptt aria-label="Ratsiya" title="Ratsiya">${I('yzp-mic')}</button></div>
      <ol class="yzp-steps">${step(true, false, 'Qəbul etdim', o.courierAcceptedAt)}${step(o.status === 'onway', o.status !== 'onway', 'Yola çıxdım', o.onwayAt)}${step(false, o.status === 'onway', 'Təhvil verdim', null)}</ol>
      ${o.status === 'cooking' ? `<p class="yzp-wait">${I('clock')} Mətbəxdə hazırlanır — "Hazırdır" olanda bildiriş gələcək</p>` : ''}
      ${o.status === 'ready' ? `<p class="yzp-wait yzp-wait--ok">${I('check')} Hazırdır — götürüb yola çıxın</p>` : ''}
      <div class="yzp-panel">
        <b>${esc(o.customer?.name || '')}</b>
        <p class="yzp-det__addr">${I('yzp-pin')} ${esc(o.address?.text || '')}${o.address?.zoneName ? ' · ' + esc(o.address.zoneName) : ''}</p>
        ${o.address?.note ? `<p class="yzp-det__note">Qeyd: ${esc(o.address.note)}</p>` : ''}
        <div class="yzp-grid3"><a class="yzi-btn yzi-btn--sm yzp-btn-green" href="tel:+${esc(tel)}">${I('phone')} Zəng et</a>
          <a class="yzi-btn yzi-btn--sm yzp-btn-blue" href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener">Google Maps</a>
          <a class="yzi-btn yzi-btn--sm yzp-btn-blue" href="https://waze.com/ul?q=${q}&navigate=yes" target="_blank" rel="noopener">Waze</a></div>
      </div>
      <div class="yzp-panel"><small class="yzp-muted">Paketdə olmalıdır</small>
        ${Object.values(o.items || {}).map(i => `<div class="yzp-row"><span>${i.qty} × ${esc(i.name)}</span><small>${esc(i.note || '')}</small></div>`).join('')}</div>
      <div class="yzp-sum yzp-sum--big"><span>${o.payMethod === 'prepaid' ? 'Öncədən ödənilib' : 'Alınacaq məbləğ (' + esc(payLabel(o.payMethod)) + ')'}</span><b>${o.payMethod === 'prepaid' ? '0,00 ₼' : money(o.total)}</b></div>
      ${o.cashGiven ? `<p class="yzi-hint">Müştəri ${money(o.cashGiven)} verəcək → qalıq <b>${money(o.cashGiven - o.total)}</b> aparın</p>` : ''}
      <div class="yzp-cr__acts">
        ${o.status === 'onway' ? `<button type="button" class="yzi-btn yzp-btn-red" data-prob>Problem var</button><button type="button" class="yzi-btn yzp-btn-ok" data-done>Təhvil verdim</button>`
          : `<button type="button" class="yzi-btn yzi-btn--ghost yzp-btn-red" data-rej>İmtina</button><button type="button" class="yzi-btn yzi-btn--gold" data-go>Yola çıxdım</button>`}
      </div>
    </div>`;
  host.querySelector('[data-back]').addEventListener('click', () => { courierOpenId = null; refreshViews(); });
  host.querySelector('[data-ptt]').addEventListener('click', openRacia);
  host.querySelector('[data-go]')?.addEventListener('click', async () => { await markOnway(o); refreshViews(); });
  host.querySelector('[data-done]')?.addEventListener('click', () => openHandover(byId(o.id), { courier: true }));
  host.querySelector('[data-prob]')?.addEventListener('click', () => reportProblem(o));
  host.querySelector('[data-rej]')?.addEventListener('click', async () => { if (await confirmBox(`${esc(o.code)} — imtina edilsin? Sifariş başqa kuryerə veriləcək.`, { okLabel: 'İmtina', okCls: 'yzi-btn--red' })) { await courierReject(o); courierOpenId = null; refreshViews(); } });
}
function closeCourierDetail() { courierOpenId = null; refreshViews(); }
function openRacia() {
  const fab = $('rcFab');
  if (fab) fab.click(); else showToast(`${I('warning')} Ratsiya bu cihazda aktiv deyil`);
}

/* ═══ 11. KASSA TƏHVİLİ ═══ */
async function openSettlement(cid) {
  if (!can('delivery.settle')) { showToast(`${I('ban')} Kassa təhvili icazəniz yoxdur`); return; }
  const snap = await DO.orderByChild('unsettledBy').startAt('!').once('value');
  const rows = Object.entries(snap.val() || {}).map(([id, o]) => ({ id, ...o })).filter(o => o.unsettledBy);
  const by = {};
  rows.forEach(o => { (by[o.unsettledBy] = by[o.unsettledBy] || { id: o.unsettledBy, name: o.unsettledName || o.courierName || staffName(o.unsettledBy) || '?', list: [] }).list.push(o); });
  const cs = Object.values(by);
  if (!cs.length) { showToast(`${I('check')} Kuryerlərin üzərində təhvil veriləcək nağd yoxdur`); return; }
  let sel = cid && by[cid] ? cid : cs[0].id;
  const body = document.createElement('div');
  const draw = () => {
    const c = by[sel];
    const exp = r2(c.list.reduce((s, o) => s + (o.total || 0), 0));
    body.innerHTML = `
      <label class="yzi-f"><span>Kuryer</span><select id="yzpSetC">${cs.map(x => `<option value="${esc(x.id)}" ${x.id === sel ? 'selected' : ''}>${esc(x.name)} · ${money(x.list.reduce((s, o) => s + (o.total || 0), 0))}</option>`).join('')}</select></label>
      <div class="yzp-settle">
        ${c.list.sort((a, b) => a.closedAt - b.closedAt).map(o => `<div><b>${esc(o.code)}</b><span>${fmtDT(o.closedAt)}</span><span>${esc(o.customer?.name || '')}</span><b>${money(o.total)}</b></div>`).join('')}
      </div>
      <div class="yzp-sum yzp-sum--big"><span>Təhvil verməlidir (${c.list.length} sifariş)</span><b>${money(exp)}</b></div>
      <label class="yzi-f"><span>Faktiki təhvil alınan (₼)</span><input type="text" inputmode="decimal" id="yzpSetA" value="${exp.toFixed(2)}"></label>
      <div id="yzpSetD"></div>
      <label class="yzi-f"><span>Qeyd (fərq varsa məcburi)</span><input type="text" id="yzpSetN" maxlength="200"></label>
      <p class="yzi-hint">Təsdiqdə hər sifarişin nağd ödənişi kassaya yazılır (Mühasibat → Kassa).</p>`;
    body.querySelector('#yzpSetC').addEventListener('change', (e) => { sel = e.target.value; draw(); });
    const a = body.querySelector('#yzpSetA');
    const d = () => { const diff = r2(num(a.value) - exp); body.querySelector('#yzpSetD').innerHTML = Math.abs(diff) < 0.01 ? `<div class="yzp-diff yzp-diff--ok">Fərq yoxdur</div>` : `<div class="yzp-diff ${diff < 0 ? 'yzp-diff--bad' : ''}">${diff < 0 ? 'Kəsir' : 'Artıq'}: ${money(Math.abs(diff))}</div>`; };
    a.addEventListener('input', d); d();
  };
  draw();
  modal({
    title: 'Kuryer kassa təhvili', body, wide: true,
    actions: [
      { label: 'Bağla', cancel: true, cls: 'yzi-btn--ghost' },
      { label: 'Təhvili təsdiqlə', cls: 'yzi-btn--gold', onClick: async (b) => {
        const c = by[sel];
        const exp = r2(c.list.reduce((s, o) => s + (o.total || 0), 0));
        const act = r2(num(b.querySelector('#yzpSetA').value));
        const note = b.querySelector('#yzpSetN').value.trim();
        const diff = r2(act - exp);
        if (Math.abs(diff) >= 0.01 && !note) throw new Error('Fərq var — qeyd yazın');
        const shift = needShift();   // Mərhələ 2c: nağd kassaya düşür — açıq növbə lazımdır
        if (!shift) throw new Error('Kassa növbəsi açıq deyil');
        const u = me(), now = Date.now();
        const sref = DS.push();
        for (const o of c.list) {
          const res = await DO.child(o.id).child('unsettledBy').transaction(cur => (cur === c.id ? null : undefined));
          if (!res.committed) continue;
          R.payments.push({
            tableId: 'dlv_' + o.id, tableName: `Paket ${o.code} · ${c.name}`, sessionId: null, deliveryId: o.id, settlementId: sref.key, shiftId: shift.id,
            staffId: c.id, staffName: c.name, type: 'cash', typeLabel: 'Nağd (kuryer)',
            originalAmount: o.total, finalAmount: o.total, thisPay: o.total, paidBefore: 0, discountType: null, discountValue: 0,
            createdAt: now, time: new Date(now).toLocaleTimeString('az-AZ'), date: new Date(now).toLocaleDateString('az-AZ')
          });
          DO.child(o.id).update({ unsettledName: null, settledAt: now, settlementId: sref.key });
          histPush(o.id, `Nağd kassaya təhvil verildi (${u.name})`);
        }
        await sref.set({ courierId: c.id, courierName: c.name, orders: c.list.map(o => o.id), codes: c.list.map(o => o.code), expected: exp, actual: act, diff, note, at: now, byId: u.id, byName: u.name });
        addLog('delivery', `${u.name} kuryer ${c.name}-dən ${money(act)} nağd təhvil aldı (gözlənilən ${money(exp)}${Math.abs(diff) >= 0.01 ? ', fərq ' + money(diff) : ''})`, { settlementId: sref.key });
        showToast(`${I('check')} Təhvil qeyd edildi`);
      } }
    ]
  });
}

/* ═══ 12. AYARLAR (yalnız Rəhbər) ═══ */
function openSettings() {
  if (!isRehber()) { showToast(`${I('ban')} Paket ayarlarını yalnız Rəhbər dəyişir`); return; }
  const z = JSON.parse(JSON.stringify(S.zones || {}));
  const cats = [...new Set((state.menuItems || []).map(m => m.category || 'Digər'))];
  const body = document.createElement('div');
  body.className = 'yzp-set';
  const draw = (v) => {
    body.innerHTML = `
      <label class="yzp-check"><input type="checkbox" id="ysEn" ${v.enabled !== false ? 'checked' : ''}> Paket və çatdırılma modulu aktivdir</label>
      <h4 class="yzp-h">Çatdırılma haqqı</h4>
      <div class="yzp-seg yzp-seg--3" role="radiogroup" aria-label="Haqq növü">${[['free', 'Pulsuz'], ['fixed', 'Sabit məbləğ'], ['zone', 'Zonalara görə']].map(([k, l]) => `<button type="button" class="yzp-seg__b${v.feeMode === k ? ' is-on' : ''}" data-fm="${k}">${l}</button>`).join('')}</div>
      ${v.feeMode === 'fixed' ? `<label class="yzi-f"><span>Sabit haqq (₼)</span><input type="text" inputmode="decimal" id="ysFix" value="${esc(String(v.fixedFee || ''))}"></label>` : ''}
      ${v.feeMode === 'zone' ? `<div class="yzp-zones"><div class="yzp-zones__h"><span>Zona</span><span>Haqq ₼</span><span>Min. sifariş ₼</span><span>Təxmini vaxt, dəq</span><span></span></div>
        ${Object.entries(z).map(([id, x]) => `<div class="yzp-zones__r" data-zid="${esc(id)}"><input type="text" data-zf="name" value="${esc(x.name || '')}" aria-label="Zona adı" placeholder="Zona 1 · Mərkəz"><input type="text" inputmode="decimal" data-zf="fee" value="${esc(String(x.fee ?? ''))}" aria-label="Haqq"><input type="text" inputmode="decimal" data-zf="min" value="${esc(String(x.min ?? ''))}" aria-label="Minimum sifariş"><input type="text" inputmode="numeric" data-zf="eta" value="${esc(String(x.eta ?? ''))}" aria-label="Təxmini vaxt"><button type="button" class="yzi-btn yzi-btn--sm yzi-btn--ghost yz-icon-only" data-zdel="${esc(id)}" aria-label="Zonanı sil">${I('trash')}</button></div>`).join('')}
        <button type="button" class="yzi-btn yzi-btn--sm yzi-btn--ghost" data-zadd>${I('plus')} Zona əlavə et</button></div>` : ''}
      ${v.feeMode !== 'free' ? `<label class="yzi-f"><span>Sifariş bu məbləğdən yuxarı olanda çatdırılma pulsuz (₼, 0 = yoxdur)</span><input type="text" inputmode="decimal" id="ysFree" value="${esc(String(v.freeOver || 0))}"></label>` : ''}
      <h4 class="yzp-h">Qablaşdırma</h4>
      <label class="yzi-f"><span>Menyuda qablaşdırma kateqoriyası</span><select id="ysPack"><option value="">— yoxdur —</option>${cats.map(c => `<option value="${esc(c)}" ${v.packCategory === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <p class="yzi-hint">Qabları Məhsullar (kataloq) bölməsində bu kateqoriyada "mal" kimi yaradın. Paket sifarişində qab əlavə olunanda anbardan silinir, mətbəxə getmir.</p>
      <label class="yzp-check"><input type="checkbox" id="ysPackFree" ${v.packFree !== false ? 'checked' : ''}> Qab standart olaraq pulsuz yazılsın (0 ₼) — operator sifarişdə dəyişə bilər</label>
      <h4 class="yzp-h">Kuryerlər</h4>
      <label class="yzi-f"><span>Sifarişin paylanması</span><select id="ysDisp"><option value="broadcast" ${v.dispatch !== 'manual' ? 'selected' : ''}>Bütün kuryerlərə — ilk qəbul edən götürür</option><option value="manual" ${v.dispatch === 'manual' ? 'selected' : ''}>Operator özü təyin edir</option></select></label>
      <div class="yzp-grid2"><label class="yzi-f"><span>Hazır sifarişi kuryer neçə dəq qəbul etməsə növbə müdirinə xəbərdarlıq</span><input type="text" inputmode="numeric" id="ysAcc" value="${esc(String(v.acceptTimeoutMin))}"></label>
      <label class="yzi-f"><span>Kuryerin üzərində nağd bu məbləğdən çox olanda xəbərdarlıq (₼)</span><input type="text" inputmode="decimal" id="ysCash" value="${esc(String(v.cashLimit))}"></label></div>
      <p class="yzi-hint">Kuryer olmaq məcburi deyil: İşçilər → İcazələr → "Paket və çatdırılma" bölməsində istənilən işçiyə "Kuryer kimi işləmək" icazəsi verilir (ya da "Kuryer" hazır rolu seçilir).</p>
      <h4 class="yzp-h">Vaxt, çek və digər</h4>
      <div class="yzp-grid2"><label class="yzi-f"><span>Hazırlanma hədəfi (dəq) — keçəndə kart qırmızı yanır</span><input type="text" inputmode="numeric" id="ysPrep" value="${esc(String(v.prepTarget))}"></label>
      <label class="yzi-f"><span>Planlı sifariş vaxtına neçə dəq qalmış mətbəxə düşsün</span><input type="text" inputmode="numeric" id="ysLead" value="${esc(String(v.scheduleLeadMin))}"></label>
      <label class="yzi-f"><span>Neçənci sifarişdən müştəri VIP sayılsın</span><input type="text" inputmode="numeric" id="ysVip" value="${esc(String(v.vipAt))}"></label>
      <label class="yzi-f"><span>Şəhər (xəritədə axtarış üçün)</span><input type="text" id="ysCity" value="${esc(v.restaurantCity || '')}" maxlength="40"></label></div>
      <label class="yzp-check"><input type="checkbox" id="ysAuto" ${v.autoPrint !== false ? 'checked' : ''}> Təsdiqdə hesab çeki avtomatik çap olunsun (çekdə ad, telefon, ünvan, ödəniş)</label>
      <label class="yzp-check"><input type="checkbox" id="ysCopy" ${v.courierCopy !== false ? 'checked' : ''}> Kuryer üçün ikinci nüsxə çap olunsun</label>
      <label class="yzp-check"><input type="checkbox" id="ysCan" ${v.cancelReasonRequired !== false ? 'checked' : ''}> Ləğv səbəbi məcburi olsun</label>
      <div class="yzp-soon">Müştəriyə WhatsApp ilə avtomatik status mesajı ("Sifarişiniz yoldadır") <span class="yzp-chip yzp-chip--gold">2-ci mərhələ</span></div>`;
    body.querySelectorAll('[data-fm]').forEach(b => b.addEventListener('click', () => { const cur = collect(); cur.feeMode = b.dataset.fm; draw(cur); }));
    body.querySelector('[data-zadd]')?.addEventListener('click', () => { const cur = collect(); z['z' + Date.now().toString(36)] = { name: '', fee: '', min: '', eta: '' }; draw(cur); });
    body.querySelectorAll('[data-zdel]').forEach(b => b.addEventListener('click', () => { const cur = collect(); delete z[b.dataset.zdel]; draw(cur); }));
  };
  const val = (id, d) => { const el = body.querySelector('#' + id); return el ? el.value : d; };
  const chk = (id, d) => { const el = body.querySelector('#' + id); return el ? el.checked : d; };
  let cur = { ...S };
  const collect = () => {
    body.querySelectorAll('[data-zid]').forEach(r => { const id = r.dataset.zid; if (!z[id]) return; r.querySelectorAll('[data-zf]').forEach(inp => { z[id][inp.dataset.zf] = inp.value; }); });
    cur = {
      ...cur, enabled: chk('ysEn', cur.enabled), feeMode: cur.feeMode,
      fixedFee: r2(num(val('ysFix', cur.fixedFee))), freeOver: r2(num(val('ysFree', cur.freeOver))),
      packCategory: val('ysPack', cur.packCategory), packFree: chk('ysPackFree', cur.packFree),
      dispatch: val('ysDisp', cur.dispatch), acceptTimeoutMin: Math.max(1, Math.round(num(val('ysAcc', cur.acceptTimeoutMin)))),
      cashLimit: r2(num(val('ysCash', cur.cashLimit))), prepTarget: Math.max(1, Math.round(num(val('ysPrep', cur.prepTarget)))),
      scheduleLeadMin: Math.max(5, Math.round(num(val('ysLead', cur.scheduleLeadMin)))), vipAt: Math.max(2, Math.round(num(val('ysVip', cur.vipAt)))),
      restaurantCity: val('ysCity', cur.restaurantCity).trim(),
      autoPrint: chk('ysAuto', cur.autoPrint), courierCopy: chk('ysCopy', cur.courierCopy), cancelReasonRequired: chk('ysCan', cur.cancelReasonRequired)
    };
    return cur;
  };
  draw(cur);
  modal({
    title: 'Paket və çatdırılma ayarları', body, wide: true,
    actions: [
      { label: 'Bağla', cancel: true, cls: 'yzi-btn--ghost' },
      { label: 'Yadda saxla', cls: 'yzi-btn--gold', onClick: async () => {
        const v = collect();
        const zones = {};
        Object.entries(z).forEach(([id, x]) => { if (String(x.name || '').trim()) zones[id] = { name: String(x.name).trim(), fee: r2(num(x.fee)), min: r2(num(x.min)), eta: Math.round(num(x.eta)) }; });
        if (v.feeMode === 'zone' && !Object.keys(zones).length) throw new Error('Ən azı bir zona əlavə edin');
        await DSET.set({ ...v, zones, updatedAt: Date.now() });
        addLog('delivery', 'Rəhbər paket və çatdırılma ayarlarını dəyişdi', {});
        showToast(`${I('check')} Ayarlar saxlanıldı`);
      } }
    ]
  });
}

/* ═══ 13. BİLDİRİŞLƏR ═══ */
let fired = {};
const firedKey = () => 'yzp_fired_' + (me().id || 'x');
function loadFired() { try { fired = JSON.parse(localStorage.getItem(firedKey()) || '{}'); } catch (e) { fired = {}; } }
function saveFired() {
  const cut = Date.now() - 2 * 86400000;
  Object.keys(fired).forEach(k => { if (fired[k] < cut) delete fired[k]; });
  try { localStorage.setItem(firedKey(), JSON.stringify(fired)); } catch (e) { /* */ }
}
let firedFor = null;
function beep(strong) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return;
    const ctx = beep.ctx || (beep.ctx = new Ctx());
    const t0 = ctx.currentTime;
    [0, 0.3, strong ? 0.6 : null].filter(x => x !== null).forEach((dt, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = i % 2 ? 1046 : 784;
      g.gain.setValueAtTime(0.0001, t0 + dt); g.gain.exponentialRampToValueAtTime(0.35, t0 + dt + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.25);
      o.connect(g); g.connect(ctx.destination); o.start(t0 + dt); o.stop(t0 + dt + 0.26);
    });
    navigator.vibrate?.(strong ? [250, 120, 250, 120, 250] : [200, 100, 200]);
  } catch (e) { /* səs bloklanıb */ }
}
function alertBox() {
  let b = $('yzpAlerts');
  if (!b) { b = document.createElement('div'); b.id = 'yzpAlerts'; b.className = 'yzp-alerts'; b.setAttribute('aria-live', 'assertive'); document.body.appendChild(b); }
  return b;
}
function showAlert(key, o, lvl, text, { accept = false, sound = 'delivery_alert' } = {}) {
  const box = alertBox();
  if (box.querySelector(`[data-k="${CSS.escape(key)}"]`)) return;
  box.querySelectorAll(`.yzp-alert[data-id="${CSS.escape(o.id)}"]`).forEach(el => el.remove());
  const d = document.createElement('div');
  d.className = `yzp-alert yzp-alert--${lvl}`; d.dataset.k = key; d.dataset.id = o.id;
  d.innerHTML = `<div class="yzp-alert__h">${I(lvl === 'alert' ? 'warning' : 'bell')} <b>${esc(text)}</b><small>${fmtDT(Date.now())}</small></div>
    <div class="yzp-alert__b"><b>${esc(o.code)}</b> · ${o.type === 'delivery' ? esc(o.address?.text || '') : 'Özü aparır'} · ${esc(o.customer?.name || '')} · ${money(o.total)}</div>
    <div class="yzp-alert__f"><button type="button" class="yzi-btn yzi-btn--sm" data-see>Bax</button>${accept ? `<button type="button" class="yzi-btn yzi-btn--sm yzi-btn--gold" data-acc>Qəbul etdim</button>` : `<button type="button" class="yzi-btn yzi-btn--sm yzi-btn--gold" data-ok>Gördüm</button>`}</div>`;
  d.querySelector('[data-ok]')?.addEventListener('click', () => { d.remove(); });
  d.querySelector('[data-acc]')?.addEventListener('click', async () => { const cur = byId(o.id); if (cur && await courierAccept(cur)) { courierOpenId = o.id; } d.remove(); openScreen(); });
  d.querySelector('[data-see]').addEventListener('click', () => { d.remove(); if (canBoard()) openDetail(o.id); else { courierOpenId = (byId(o.id)?.courierId === me().id) ? o.id : null; openScreen(); } });
  box.prepend(d);
  if ((state.notifSoundMap || {})[sound]) { playNotifSound(sound); navigator.vibrate?.([200, 100, 200]); }
  else beep(lvl === 'alert');
}
const fire = (key, fn) => { if (fired[key]) return; fired[key] = Date.now(); saveFired(); fn(); };
function checkAlerts() {
  if (!started) return;
  const box = $('yzpAlerts');
  if (!state.user || state.user.role === 'kitchen') { if (box) box.innerHTML = ''; return; }
  if (firedFor !== me().id) { firedFor = me().id; loadFired(); }
  const u = me();
  const mg = can('delivery.manage'), cr = isCourier();
  const now = Date.now();
  // köhnəlmiş pəncərələr
  box?.querySelectorAll('.yzp-alert').forEach(el => {
    const o = byId(el.dataset.id);
    const k = el.dataset.k || '';
    if (!o || !ACTIVE.includes(o.status)) el.remove();
    else if ((k.endsWith(':offer') || k.endsWith(':ready')) && o.courierId && o.courierId !== u.id) el.remove();
    else if (k.endsWith(':asg') && o.courierStatus === 'accepted') el.remove();
    else if (k.endsWith(':noacc') && o.courierStatus === 'accepted') el.remove();
  });
  activeList().forEach(o => {
    const isMine = o.courierId === u.id;
    if (cr && o.type === 'delivery') {
      if (!o.courierId && S.dispatch !== 'manual' && !o.rejectedBy?.[u.id] && o.status !== 'scheduled')
        fire(`${o.id}:offer`, () => showAlert(`${o.id}:offer`, o, 'warn', 'Yeni çatdırılma — qəbul edirsiniz?', { accept: true, sound: 'delivery_courier_new' }));
      if (isMine && o.courierStatus === 'assigned')
        fire(`${o.id}:asg:${o.courierAssignedAt || 0}`, () => showAlert(`${o.id}:asg`, o, 'warn', 'Sizə çatdırılma təyin edildi', { accept: true, sound: 'delivery_courier_new' }));
      if (isMine && o.changeSeq)
        fire(`${o.id}:chg:${o.changeSeq}`, () => showAlert(`${o.id}:chg`, o, 'alert', `Sifariş dəyişdi — yeni cəm ${money(o.total)}`, { sound: 'delivery_changed' }));
      if (o.status === 'ready' && (isMine || (!o.courierId && S.dispatch !== 'manual')))
        fire(`${o.id}:ready:c`, () => showAlert(`${o.id}:ready`, o, 'alert', isMine ? 'Sifarişiniz hazırdır — götürün' : 'Hazır çatdırılma — kuryer gözlənilir', { accept: !isMine, sound: 'delivery_courier_ready' }));
    }
    if (mg || isRehber()) {
      if (o.status === 'ready')
        fire(`${o.id}:ready:m`, () => showAlert(`${o.id}:ready:m`, o, 'warn', o.type === 'pickup' ? 'Hazırdır — müştəri götürə bilər' : (o.courierId ? `Hazırdır — kuryer: ${o.courierName || ''}` : 'Hazırdır — kuryer təyin edilməyib'), { sound: 'delivery_ready' }));
      if (o.status === 'ready' && o.type === 'delivery' && o.courierStatus !== 'accepted' && mins(o.readyAt || now) >= num(S.acceptTimeoutMin || 3))
        fire(`${o.id}:noacc`, () => showAlert(`${o.id}:noacc`, o, 'alert', `Kuryer ${num(S.acceptTimeoutMin)} dəqiqədir qəbul etməyib`));
      if (o.status === 'cooking' && mins(o.sentAt || now) >= num(S.prepTarget || 20))
        fire(`${o.id}:late`, () => showAlert(`${o.id}:late`, o, 'warn', `Hazırlanma ${num(S.prepTarget)} dəqiqəni keçdi`));
      if (o.problem)
        fire(`${o.id}:prob:${o.problem.at}`, () => showAlert(`${o.id}:prob`, o, 'alert', `Kuryerin problemi: ${o.problem.label}`));
      if (o.rejectedBy && o.type === 'delivery' && !o.courierId && S.dispatch === 'manual')
        fire(`${o.id}:rej:${Object.keys(o.rejectedBy).length}`, () => showAlert(`${o.id}:rej`, o, 'warn', 'Kuryer imtina etdi — başqasını təyin edin'));
    }
    if (o.createdById === u.id && o.type === 'pickup' && o.status === 'ready' && !mg)
      fire(`${o.id}:ready:own`, () => showAlert(`${o.id}:ready:own`, o, 'warn', 'Paket hazırdır — müştəri götürə bilər', { sound: 'delivery_ready' }));
  });
  if (cr && num(S.cashLimit) > 0) {
    const c = cashOf(u.id);
    if (c > num(S.cashLimit)) fire(`cash:${u.id}:${dayStart()}:${Math.floor(c / num(S.cashLimit))}`, () => showToast(`${I('warning')} Üzərinizdə ${money(c)} nağd var — kassaya təhvil verin`));
  }
  if ((mg || can('delivery.settle')) && num(S.cashLimit) > 0) {
    const sums = {}; Object.values(UNSETTLED).forEach(o => { sums[o.unsettledBy] = (sums[o.unsettledBy] || 0) + (o.total || 0); });
    Object.entries(sums).forEach(([cid, v]) => { if (v > num(S.cashLimit)) fire(`cashm:${cid}:${dayStart()}`, () => showToast(`${I('warning')} ${esc(staffName(cid) || 'Kuryer')}-in üzərində ${money(v)} nağd var — kassa təhvili lazımdır`)); });
  }
}

/* ═══ 14. Mətbəx "Hazırdır" → paket statusu; planlı sifarişlər ═══ */
const koCache = {};
async function syncKitchen() {
  if (!started || !state.user) return;
  const now = Date.now();
  for (const o of activeList()) {
    if (o.status === 'cooking' && o.kitchenIds) {
      const ids = Object.keys(o.kitchenIds);
      let allReady = ids.length > 0;
      for (const k of ids) {
        let ko = (state.kitchenOrders || []).find(x => x.id === k);
        if (!ko) {
          const c = koCache[k];
          if (!c || now - c.at > 15000) { try { const s = await R.kitchenOrders.child(k).child('allReady').once('value'); koCache[k] = { at: now, v: !!s.val() }; } catch (e) { koCache[k] = { at: now, v: false }; } }
          ko = { allReady: koCache[k].v };
        }
        if (!ko.allReady) { allReady = false; break; }
      }
      if (allReady) {
        const res = await DO.child(o.id).child('status').transaction(cur => (cur === 'cooking' ? 'ready' : undefined));
        if (res.committed) { await DO.child(o.id).update({ readyAt: now }); histPush(o.id, 'Mətbəx: hazırdır'); }
      }
    }
    // Planlı sifariş — vaxtına "lead" dəqiqə qalmış mətbəxə (yalnız sifariş qəbul edən/idarə edən cihazlar)
    if (o.status === 'scheduled' && o.scheduledAt && o.scheduledAt - num(S.scheduleLeadMin || 40) * MIN <= now && (can('delivery.take') || can('delivery.manage'))) {
      try { await sendScheduled(o.id); if (S.autoPrint !== false) printBill(o, o.type === 'delivery' && S.courierCopy !== false ? 2 : 1); } catch (e) { console.warn('[paket] planlı', e); }
    }
    // "sending" vəziyyətində qalıb (göndərən cihaz bağlanıb) — 2 dəq sonra təkrar
    if (o.status === 'sending' && !o.sentAt && now - (o.createdAt || now) > 2 * MIN && (can('delivery.take') || can('delivery.manage'))) {
      const res = await DO.child(o.id).child('sendClaim').transaction(cur => (!cur || now - cur > 2 * MIN ? now : undefined));
      if (res.committed) {
        const fresh = (await DO.child(o.id).once('value')).val();
        if (fresh && fresh.status === 'sending' && !fresh.sentAt) { try { await sendToKitchen(o.id, fresh); } catch (e) { /* */ } }
      }
    }
  }
}

/* ═══ 15. Ekranlar və düymələr ═══ */
function refreshViews() {
  const a = $('sec-delivery');
  if (a?.classList.contains('active')) render(a.querySelector('.yzp-host'));
  const s = $('yzpScreen');
  if (s?.classList.contains('is-open')) render(s.querySelector('.yzp-host'));
  if ($('yzpNew')?.classList.contains('is-open') && draft) { renderNewTotals(); }
}
function openScreen() {
  if (!anyAccess()) return;
  let s = $('yzpScreen');
  if (!s) {
    s = document.createElement('div');
    s.id = 'yzpScreen'; s.className = 'yzrv-screen yzp-screen';
    s.innerHTML = `<div class="yzrv-screen__bar yzp-bar"><b>${I('yzp-bag')} <span id="yzpScrTitle">Paketlər</span></b>
      <span class="yzp-bar__btns"><button type="button" class="btn btn-ghost yz-icon-only" data-exit aria-label="Çıxış — PIN ekranına" title="Çıxış — PIN ekranına">${I('logout')}</button>
      <button type="button" class="btn btn-ghost yz-icon-only" data-close aria-label="Bağla" title="Bağla">${I('close')}</button></span></div><div class="yzp-host yzp-host--screen"></div>`;
    s.querySelector('[data-close]').addEventListener('click', () => s.classList.remove('is-open'));
    s.querySelector('[data-exit]').addEventListener('click', () => { s.classList.remove('is-open'); if (typeof window.staffExit === 'function') window.staffExit(); });
    document.body.appendChild(s);
  }
  const home = courierHome();
  s.querySelector('[data-close]').style.display = home ? 'none' : '';
  s.querySelector('[data-exit]').style.display = home ? '' : 'none';
  $('yzpScrTitle').textContent = canBoard() ? 'Paket və çatdırılma' : `Kuryer · ${me().name}`;
  s.classList.add('is-open');
  render(s.querySelector('.yzp-host'));
}
/* Yalnız kuryer olan işçi (masalar və panel yoxdur): girişdən sonra birbaşa kuryer ekranı */
const courierHome = () => state.user?.role === 'staff' && isCourier() && !hasPermission('table.view') && !(window.__yzAccess?.hasPanel?.(state.user));
let T0 = Date.now();
function ensureAdminSection() {
  const box = $('adminTabsContainer'), body = $('adminBody');
  if (!box || !body) return;
  if (!$('sec-delivery')) {
    const s = document.createElement('div');
    s.className = 'admin-section'; s.id = 'sec-delivery';
    s.innerHTML = '<div class="yzp-host"></div>';
    body.appendChild(s);
  }
  const shellReady = box.dataset.yzShell || Date.now() - T0 > 5000;
  let b = $('yzpAdminTab');
  if (b && !b.isConnected) b = null;
  if (b && !canBoard()) { b.remove(); return; }
  if (!b && shellReady && canBoard()) {
    b = document.createElement('button');
    b.type = 'button'; b.id = 'yzpAdminTab'; b.className = 'admin-tab yzp-admin-tab'; b.dataset.section = 'delivery';
    b.innerHTML = `${I('yzp-bag')} <span>Paket və çatdırılma</span><span class="yz-side-badge" data-yzp-badge hidden></span>`;
    b.addEventListener('click', () => window.adminTab('delivery', b));
    const after = $('yzrvAdminTab') || box.querySelector('.yz-zal-tab');
    if (after) after.insertAdjacentElement('afterend', b); else box.prepend(b);
  }
}
function wrapAdminTab() {
  if (window.__yzpWrapped) return;
  if (typeof window.adminTab !== 'function') return;
  if (!window.__yzrvWrapped && Date.now() - T0 < 6000) return;   // əvvəl qabıq və rezerv öz bükməsini etsin
  window.__yzpWrapped = true;
  const orig = window.adminTab;
  window.adminTab = function (sec, el) {
    if (sec !== 'delivery') return orig(sec, el);
    orig(sec, el || $('yzpAdminTab'));
    const t = $('apPageTitle'); if (t) t.textContent = 'Paket və çatdırılma';
    render($('sec-delivery')?.querySelector('.yzp-host'));
  };
}
function ensureStaffBtn() {
  const head = document.querySelector('#waiterScreen .waiter-header');
  if (!head) return;
  let b = $('yzpStaffBtn');
  if (!state.user || state.user.role !== 'staff' || !anyAccess() || S.enabled === false) { b?.remove(); return; }
  if (b) return;
  b = document.createElement('button');
  b.id = 'yzpStaffBtn'; b.type = 'button'; b.className = 'btn btn-ghost yzp-staff-btn';
  b.innerHTML = `${I('yzp-bag')} <span>Paketlər</span><span class="yzp-badge" hidden></span>`;
  b.addEventListener('click', openScreen);
  head.insertBefore(b, $('yzrvStaffBtn') || $('themeToggleBtnWaiter') || null);
}
function updateBadges() {
  if (!state.user) return;
  const u = me();
  const act = activeList();
  let n = 0, warn = false;
  if (canBoard()) {
    n = act.filter(o => o.status === 'ready' || o.problem || timerOf(o).late).length;
    warn = act.some(o => o.problem || timerOf(o).late);
  }
  if (isCourier()) {
    const c = act.filter(o => o.type === 'delivery' && ((o.courierId === u.id) || (!o.courierId && S.dispatch !== 'manual' && !o.rejectedBy?.[u.id] && o.status !== 'scheduled'))).length;
    n = Math.max(n, c);
  }
  const set = (el) => { if (!el) return; el.hidden = !n; el.textContent = n > 99 ? '99+' : String(n); el.classList.toggle('is-warn', warn); };
  set($('yzpStaffBtn')?.querySelector('.yzp-badge'));
  set(document.querySelector('[data-yzp-badge]'));
}
let wasUser = null;
function tick() {
  if (state.user) start();
  ensureAdminSection(); wrapAdminTab(); ensureStaffBtn();
  const uid = state.user ? (state.user.id || state.user.role) : null;
  if (uid !== wasUser) {           // istifadəçi dəyişdi / çıxış
    wasUser = uid; courierOpenId = null; view.tab = 'active';
    $('yzpScreen')?.classList.remove('is-open'); $('yzpNew')?.classList.remove('is-open'); draft = null;
    const box = $('yzpAlerts'); if (box) box.innerHTML = '';
    if (uid) setTimeout(() => { checkAlerts(); if (courierHome()) openScreen(); }, 600);
  }
}
let slowBusy = false;
async function slowTick() {
  if (!started || !state.user || slowBusy) return;
  slowBusy = true;
  try { await syncKitchen(); refreshViews(); updateBadges(); checkAlerts(); } catch (e) { console.warn('[paket]', e); }
  finally { slowBusy = false; }
}
let unsettledOn = false;
function init() {
  setInterval(() => { tick(); if (started && !unsettledOn) { unsettledOn = true; watchUnsettled(); } }, 1000);
  setInterval(slowTick, 5000);
  tick();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

window.yzDeliverySettings = openSettings;
window.__yzDelivery = { openScreen, openNew, openDetail, openEdit, openSettlement, courierHome, openCourierHome: openScreen };
