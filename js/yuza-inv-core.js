/* ═══════════════════════════════════════════
   YUZA POS — ANBAR NÜVƏSİ (məlumat + məntiq, ekran yoxdur)

   Vahid məhsul kataloqu: menyu, alış, satış və anbar hamısı buradan qidalanır.
   Firebase node-ları:
     products/{id}        — məhsul kartı (id = menyu malının id-si ilə eynidir)
     warehouses/{id}      — anbarlar (istənilən sayda)
     stock/{anbar}/{məhsul} — qalıq (anbar vahidində, rəqəm)
     stockMoves/{id}      — bütün anbar hərəkətləri (alış, satış, silinmə, transfer, sayım...)
     inv{Növ}/{id}        — sənədlər (qaimə, ödəniş, silinmə, transfer, sayım, hazırlama)
     supplierLedger/{təchizatçı}/{id} — təchizatçı hesabı (borc buradan hesablanır)
     settings/inventory   — anbar parametrləri (rejim, defolt anbar, ƏDV ödəyicisi...)

   menuItems/{id} köhnə kod üçün SATIŞ GÖRÜNÜŞÜ kimi saxlanılır və buradan sinxronlaşır,
   ona görə sifariş ekranı, mətbəx, printer, hesabatlar dəyişmədən işləyir.
═══════════════════════════════════════════ */
import { db, R } from './firebase-service.js';
import { state } from './state.js';
import { addLog, setStockHook } from './utils.js';
import { hasPermission } from './permissions.js';

/* ── Sabitlər ── */
export const PTYPES = {
  raw:     { label: 'Xammal',        buy: true,  stock: true,  menu: false, recipe: false },
  goods:   { label: 'Hazır mal',     buy: true,  stock: true,  menu: true,  recipe: false },
  semi:    { label: 'Yarımfabrikat', buy: true,  stock: true,  menu: false, recipe: true  },
  dish:    { label: 'Yemək',         buy: false, stock: false, menu: true,  recipe: true  },
  service: { label: 'Xidmət',        buy: false, stock: false, menu: true,  recipe: true  }
};
export const UNITS = ['ədəd', 'kq', 'qr', 'litr', 'ml', 'porsiya', 'paket', 'saat'];
export const WRITEOFF_REASONS = ['Xarab olub', 'Son istifadə tarixi keçib', 'İtki / qırılma', 'İşçi yeməyi', 'Qonağa ikram', 'Digər'];

/* Sənəd növləri: node, nömrə prefiksi, icazə kökü */
export const DOCS = {
  purchase:   { node: 'invPurchases',   prefix: 'AL', perm: 'purchase',         storno: 'purchase.storno',         label: 'Alış qaiməsi' },
  preturn:    { node: 'invPurchases',   prefix: 'QT', perm: 'purchase',         storno: 'purchase.storno',         label: 'Təchizatçıya qaytarma' },
  payment:    { node: 'invPayments',    prefix: 'OD', perm: 'supplier.payment', storno: 'supplier.payment.storno', label: 'Təchizatçıya ödəniş' },
  writeoff:   { node: 'invWriteoffs',   prefix: 'SL', perm: 'stock.writeoff',   storno: 'stock.storno',            label: 'Silinmə aktı' },
  transfer:   { node: 'invTransfers',   prefix: 'TR', perm: 'stock.transfer',   storno: 'stock.storno',            label: 'Anbarlararası transfer' },
  count:      { node: 'invCounts',      prefix: 'SY', perm: 'stock.count',      storno: 'stock.storno',            label: 'İnventarizasiya (sayım)' },
  production: { node: 'invProductions', prefix: 'HZ', perm: 'stock.production', storno: 'stock.storno',            label: 'Hazırlama aktı' },
  cash:       { node: 'invCash',        prefix: 'KS', perm: 'cash',             storno: 'cash.storno',             label: 'Kassa sənədi', limit: 3000 },
  cashclose:  { node: 'cashCloses',     prefix: 'GS', perm: 'cash.close',       storno: 'cash.storno',             label: 'Gün sonu bağlanışı', limit: 1500 }
};
export const STATUS = {
  draft:    { label: 'Qaralama',         cls: 'muted' },
  pending:  { label: 'Təsdiq gözləyir',  cls: 'warn' },
  posting:  { label: 'Yazılır…',         cls: 'warn' },
  approved: { label: 'Təsdiqlənib',      cls: 'ok' },
  rejected: { label: 'Rədd edilib',      cls: 'bad' },
  storno:   { label: 'Storno',           cls: 'muted' }
};

/* ── Köməkçilər ── */
export const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
export const r4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;
export const num = (v) => { const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : NaN; };
const pad = (n) => String(n).padStart(2, '0');
/* Layihə qaydası: tarix olan hər yerdə saat da göstərilir */
export function fmtDT(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function toLocalInput(ts) {
  const d = new Date(ts || Date.now());
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fromLocalInput(v) { const t = new Date(v).getTime(); return Number.isFinite(t) ? t : Date.now(); }
export const fmtMoney = (n) => r2(n).toFixed(2) + ' ₼';
export const fmtQty = (n) => { const v = r3(n); return (Math.abs(v) < 0.0005 ? 0 : v).toString(); };
export const uid = () => state.user?.id || (state.user?.role === 'admin' ? 'admin' : 'anon');
export const uname = () => state.user?.name || 'Admin';
export const isAdmin = () => state.user?.role === 'admin';

/* ── Canlı məlumat ── */
export const inv = {
  products: {}, warehouses: {}, stock: {}, settings: {},
  loaded: { products: false, warehouses: false, stock: false, settings: false }
};
const subs = new Set();
export function onInv(fn) { subs.add(fn); return () => subs.delete(fn); }
function emit(what) { subs.forEach(fn => { try { fn(what); } catch (e) { console.warn('[inv]', e); } }); }

const MODE_KEY = 'yzInvMode';
export function isV2() {
  if (inv.loaded.settings) return inv.settings.mode === 'v2';
  try { return localStorage.getItem(MODE_KEY) === 'v2'; } catch (e) { return false; }
}
const allLoaded = () => inv.loaded.products && inv.loaded.warehouses && inv.loaded.stock && inv.loaded.settings;

let started = false;
export function startInv() {
  if (started) return; started = true;
  db.ref('products').on('value', s => { inv.products = s.val() || {}; inv.loaded.products = true; emit('products'); flushPending(); });
  db.ref('warehouses').on('value', s => { inv.warehouses = s.val() || {}; inv.loaded.warehouses = true; emit('warehouses'); flushPending(); });
  db.ref('stock').on('value', s => { inv.stock = s.val() || {}; inv.loaded.stock = true; emit('stock'); flushPending(); });
  db.ref('settings/inventory').on('value', s => {
    inv.settings = s.val() || {}; inv.loaded.settings = true;
    try { localStorage.setItem(MODE_KEY, inv.settings.mode || ''); } catch (e) {}
    document.body.classList.toggle('yz-inv-v2', inv.settings.mode === 'v2');
    emit('settings'); flushPending();
  });
  /* orderByKey: app.js çıxışda R.menuItems.off() edəndə bu dinləyici silinməsin */
  db.ref('menuItems').orderByKey().on('child_changed', s => reverseSync(s.key, s.val()));
}

/* ── Sənədlər və təchizatçılar: yalnız anbar ekranı açılanda dinlənir ── */
export const docs = {};            // node → { id: doc }
export const suppliers = {};       // id → supplier
export const cashAccounts = {};    // id → { name, kind: cash|bank|pos, order, archived, opening, openingAt }
export const accName = (id) => cashAccounts[id]?.name || '—';
export const accountList = (all = false) => Object.entries(cashAccounts).map(([id, a]) => ({ id, ...a }))
  .filter(a => all || !a.archived).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
let docsStarted = false;
export function watchDocs() {
  if (docsStarted) return; docsStarted = true;
  const nodes = [...new Set(Object.values(DOCS).map(d => d.node))];
  nodes.forEach(node => {
    docs[node] = {};
    const lim = Object.values(DOCS).find(d => d.node === node)?.limit || 600;
    db.ref(node).orderByChild('createdAt').limitToLast(lim).on('value', s => {
      docs[node] = s.val() || {};
      if (node === 'invPayments') {
        state.invPayments = Object.entries(docs[node]).map(([id, p]) => ({ id, ...p })).filter(p => p.status === 'approved');
      }
      emit('docs');
    });
  });
  db.ref('cashAccounts').on('value', s => {
    Object.keys(cashAccounts).forEach(k => delete cashAccounts[k]);
    Object.assign(cashAccounts, s.val() || {});
    emit('cash');
  });
  db.ref('suppliers').on('value', s => {
    Object.keys(suppliers).forEach(k => delete suppliers[k]);
    Object.assign(suppliers, s.val() || {});
    emit('suppliers');
  });
}
export function docList(kind, filter) {
  const node = DOCS[kind].node;
  return Object.entries(docs[node] || {}).map(([id, d]) => ({ id, ...d }))
    .filter(d => (d.kind || kind) === kind)
    .filter(d => !filter || filter(d))
    .sort((a, b) => (b.at || b.createdAt || 0) - (a.at || a.createdAt || 0));
}
export function pendingDocs() {
  const out = [];
  Object.keys(DOCS).forEach(kind => docList(kind, d => d.status === 'pending').forEach(d => out.push({ ...d, kind })));
  return out.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}
export const supplierList = () => Object.entries(suppliers).map(([id, s]) => ({ id, ...s }))
  .filter(s => !s.archived).sort((a, b) => String(a.name).localeCompare(String(b.name), 'az'));

/* ── Məhsul / anbar sorğuları ── */
export const product = (id) => (id && inv.products[id]) ? { id, ...inv.products[id] } : null;
export function productList(filter = {}) {
  return Object.entries(inv.products)
    .map(([id, p]) => ({ id, ...p }))
    .filter(p => (filter.archived ? true : !p.archived))
    .filter(p => !filter.types || filter.types.includes(p.type))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'az'));
}
export function warehouseList(all = false) {
  return Object.entries(inv.warehouses).map(([id, w]) => ({ id, ...w }))
    .filter(w => all || !w.archived)
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || String(a.name).localeCompare(String(b.name), 'az'));
}
export const whName = (id) => inv.warehouses[id]?.name || '—';
export function defaultWarehouseId() {
  const d = inv.settings.defaultWarehouseId;
  if (d && inv.warehouses[d] && !inv.warehouses[d].archived) return d;
  return warehouseList()[0]?.id || null;
}
export function saleWarehouseFor(p) {
  if (p?.saleWarehouseId && inv.warehouses[p.saleWarehouseId] && !inv.warehouses[p.saleWarehouseId].archived) return p.saleWarehouseId;
  return defaultWarehouseId();
}
export const stockIn = (wh, pid) => r3(inv.stock?.[wh]?.[pid] || 0);
export function totalStock(pid) {
  return r3(Object.values(inv.stock || {}).reduce((s, w) => s + (Number(w?.[pid]) || 0), 0));
}
export function isLow(p) {
  if (!p || !PTYPES[p.type]?.stock) return false;
  const min = Number(p.minQty);
  return Number.isFinite(min) && min > 0 && totalStock(p.id) <= min;
}

/* Qablaşma: { key: {name, factor} } — factor = neçə anbar vahidi */
export function packsOf(p) {
  const list = [{ key: '_base', name: p?.unit || 'ədəd', factor: 1 }];
  Object.entries(p?.packs || {}).forEach(([key, pk]) => {
    const f = Number(pk?.factor);
    if (pk?.name && f > 0) list.push({ key, name: pk.name, factor: f });
  });
  return list;
}

/* Maya dəyəri (1 anbar vahidi üçün). Yemək/xidmət üçün reseptdən hesablanır. */
export function unitCost(pOrId, depth = 0) {
  const p = typeof pOrId === 'string' ? product(pOrId) : pOrId;
  if (!p || depth > 6) return 0;
  if (PTYPES[p.type]?.stock) {
    const c = Number(p.avgCost);
    if (Number.isFinite(c) && c > 0) return c;
    const l = Number(p.lastCost);
    if (Number.isFinite(l) && l > 0) return l;
    if (p.type === 'semi' && p.recipe) return recipeCost(p, depth + 1) / (Number(p.yieldQty) || 1);
    return 0;
  }
  return recipeCost(p, depth + 1);
}
export function recipeCost(p, depth = 0) {
  return Object.entries(p?.recipe || {}).reduce((s, [cid, line]) => {
    const gross = Number(line?.gross ?? line) || 0;
    return s + gross * unitCost(cid, depth);
  }, 0);
}
export const netOf = (line) => r4((Number(line?.gross ?? line) || 0) * (1 - (Number(line?.waste) || 0) / 100));

/* Satış qiyməti ƏDV-siz və maya faizi */
export function marginInfo(p) {
  const price = Number(p.pricingMode === 'hourly' ? p.hourlyRate : p.price) || 0;
  const rate = Number(p.vatRate) || 0;
  const incl = p.vatIncluded !== false;
  const net = rate > 0 ? (incl ? price / (1 + rate / 100) : price) : price;
  const cost = unitCost(p);
  const profit = net - cost;
  return { price, net: r2(net), vat: r2(incl ? price - net : net * rate / 100), cost: r2(cost), profit: r2(profit), pct: net > 0 ? r2(cost / net * 100) : null };
}

/* Orta çəkili maya: köhnə qalıq və yeni daxilolma */
export function weightedAvg(oldQty, oldCost, inQty, inCost) {
  oldQty = Number(oldQty) || 0; oldCost = Number(oldCost) || 0; inQty = Number(inQty) || 0; inCost = Number(inCost) || 0;
  if (inQty <= 0) return oldCost;
  if (oldQty <= 0 || oldCost <= 0) return r4(inCost);
  return r4((oldQty * oldCost + inQty * inCost) / (oldQty + inQty));
}
/* Daxilolmanın geri alınması (storno) zamanı mayanın bərpası */
export function reverseAvg(totalQty, avg, outQty, outCost) {
  const rest = (Number(totalQty) || 0) - (Number(outQty) || 0);
  if (rest <= 0.0001) return Number(avg) || 0;
  const v = ((Number(totalQty) || 0) * (Number(avg) || 0) - (Number(outQty) || 0) * (Number(outCost) || 0)) / rest;
  return v > 0 ? r4(v) : (Number(avg) || 0);
}

/* ═══ ANBAR HƏRƏKƏTİ ═══
   lines: [{ pid, qty (işarəli, anbar vahidində), cost? (1 vahid üçün) }]
   receipt=true olan sətirlər orta mayanı yeniləyir (alış, ilkin qalıq, hazırlama çıxışı). */
export async function postStockEvent({ type, whId, lines, ref = null, note = '', at = Date.now(), receipt = false, reverseReceipt = false }) {
  if (!whId) throw new Error('Anbar seçilməyib');
  const clean = (lines || []).filter(l => l && l.pid && Math.abs(Number(l.qty) || 0) > 0.00001);
  if (!clean.length) return null;
  const recLines = {};
  for (const l of clean) {
    const qty = r3(l.qty);
    const p = product(l.pid);
    const before = totalStock(l.pid);
    if (receipt && qty > 0 && Number.isFinite(Number(l.cost))) {
      const inCost = Number(l.cost);
      await db.ref(`products/${l.pid}/avgCost`).transaction(cur => weightedAvg(before, cur ?? p?.avgCost ?? 0, qty, inCost));
    } else if (reverseReceipt && qty < 0 && Number.isFinite(Number(l.cost))) {
      await db.ref(`products/${l.pid}/avgCost`).transaction(cur => reverseAvg(before, cur ?? p?.avgCost ?? 0, -qty, Number(l.cost)));
    }
    const res = await db.ref(`stock/${whId}/${l.pid}`).transaction(cur => r3((Number(cur) || 0) + qty));
    const after = res?.snapshot?.val();
    if (inv.stock[whId]) inv.stock[whId][l.pid] = after; else inv.stock[whId] = { [l.pid]: after };
    mirrorMenuStock(l.pid);
    recLines[Object.keys(recLines).length] = {
      pid: l.pid, name: p?.name || l.name || '?', unit: p?.unit || '',
      qty, cost: r4(Number.isFinite(Number(l.cost)) ? Number(l.cost) : unitCost(p))
    };
  }
  const ev = { at, type, whId, lines: recLines, ref, note: note || '', by: uid(), byName: uname(), createdAt: Date.now() };
  const k = db.ref('stockMoves').push();
  await k.set(ev);
  return k.key;
}

/* ═══ SATIŞ (utils.js → updateStock buraya yönləndirilir) ═══ */
const pendingSales = [];
function flushPending() {
  if (!allLoaded() || !pendingSales.length) return;
  const list = pendingSales.splice(0);
  if (!isV2()) { list.forEach(x => x.fallback && x.fallback()); return; }
  list.forEach(x => applySale(x.menuItemId, x.delta));
}
export function saleHook(menuItemId, delta) {
  if (!isV2()) return false;              // köhnə sistem işləsin
  if (!allLoaded()) { pendingSales.push({ menuItemId, delta }); return true; }
  applySale(menuItemId, delta);
  return true;
}
function saleLines(p, qty, depth = 0) {
  if (!p || depth > 4) return [];
  if (PTYPES[p.type]?.stock) return [{ pid: p.id, qty }];
  const out = [];
  Object.entries(p.recipe || {}).forEach(([cid, line]) => {
    const c = product(cid); if (!c) return;
    const gross = Number(line?.gross ?? line) || 0;
    if (!gross) return;
    if (PTYPES[c.type]?.stock) out.push({ pid: cid, qty: r4(gross * qty) });
    else out.push(...saleLines(c, r4(gross * qty), depth + 1));   // yemək içində yemək (dəst/kombo)
  });
  return out;
}
async function applySale(menuItemId, delta) {
  const p = product(menuItemId);
  if (!p) return;
  const lines = saleLines(p, delta);
  if (!lines.length) return;
  const wh = saleWarehouseFor(p);
  try {
    await postStockEvent({ type: delta < 0 ? 'sale' : 'sale_return', whId: wh, lines, ref: { menuItemId, product: p.name, qty: Math.abs(delta) } });
  } catch (e) { console.warn('[inv] satış silinmədi', e); }
}
setStockHook(saleHook);

/* ═══ MENYU SİNXRONU (products → menuItems) ═══ */
export function shouldBeInMenu(p) {
  return !!(p && !p.archived && PTYPES[p.type]?.menu && p.showInMenu !== false);
}
export function menuProjection(p) {
  const hourly = p.pricingMode === 'hourly';
  const out = {
    name: p.name || '', category: p.category || 'Digər',
    price: r2(hourly ? p.hourlyRate : p.price),
    available: p.active !== false,
    isFavorite: !!p.isFavorite,
    showInQr: p.showInQr !== false,
    vatRate: Number(p.vatRate) || 0,
    vatIncluded: p.vatIncluded !== false,
    photo: p.photo || '', description: p.description || '',
    kitchenId: p.kitchenId || null,
    productId: p.id, productType: p.type,
    pricingMode: hourly ? 'hourly' : 'fixed',
    unitLabel: hourly ? 'saat' : (p.type === 'goods' ? (p.unit || 'ədəd') : 'porsiya'),
    isTrackable: p.type === 'goods'
  };
  out.stock = p.type === 'goods' ? stockIn(saleWarehouseFor(p), p.id) : null;
  return out;
}
export async function syncMenu(pid) {
  const p = product(pid);
  const exists = (state.menuItems || []).some(m => m.id === pid);
  if (!shouldBeInMenu(p)) { if (exists) await R.menuItems.child(pid).remove(); return; }
  const data = menuProjection(p);
  if (!exists) data.createdAt = p.createdAt || Date.now();
  await R.menuItems.child(pid).update(data);
}
function mirrorMenuStock(pid) {
  const p = product(pid);
  if (!p || p.type !== 'goods' || !shouldBeInMenu(p)) return;
  if (!(state.menuItems || []).some(m => m.id === pid)) return;
  R.menuItems.child(pid).update({ stock: stockIn(saleWarehouseFor(p), pid) });
}
/* Başqa yerdən (mətbəx "bitib", stansiya təyinatı) dəyişən sahələr məhsula qaytarılır */
function reverseSync(id, mi) {
  if (!isV2() || !state.user || !mi || !inv.products[id]) return;
  const p = inv.products[id]; const upd = {};
  if ((mi.available !== false) !== (p.active !== false)) upd.active = mi.available !== false;
  if ((mi.kitchenId || null) !== (p.kitchenId || null)) upd.kitchenId = mi.kitchenId || null;
  if (Object.keys(upd).length) db.ref('products/' + id).update(upd);
}

/* ═══ MƏHSUL YAZMA ═══ */
export async function saveProduct(id, data, { log = true } = {}) {
  const now = Date.now();
  let pid = id;
  const old = id ? product(id) : null;
  if (old && data.price !== undefined && data.price !== null && Number(data.price) !== Number(old.price)) {
    db.ref(`products/${id}/priceHistory`).push({ from: Number(old.price) || 0, to: Number(data.price) || 0, at: now, by: uname() });
  }
  if (id) await db.ref('products/' + id).update({ ...data, updatedAt: now, updatedBy: uname() });
  else { const k = db.ref('products').push(); pid = k.key; await k.set({ ...data, createdAt: now, createdBy: uname(), updatedAt: now }); }
  inv.products[pid] = { ...(inv.products[pid] || {}), ...data };
  await syncMenu(pid);
  if (log) addLog('inventory', `${old ? 'Məhsul yeniləndi' : 'Yeni məhsul'}: ${data.name || old?.name}`, { productId: pid });
  return pid;
}
export function findSimilar(name, exceptId) {
  const n = norm(name);
  if (n.length < 3) return [];
  return productList().filter(p => p.id !== exceptId && (norm(p.name) === n || norm(p.name).includes(n) || n.includes(norm(p.name)) || lev(norm(p.name), n) <= 2)).slice(0, 4);
}
const norm = (s) => String(s || '').toLowerCase().replace(/[\s.,\-_/()]+/g, ' ').replace(/ı/g, 'i').replace(/ə/g, 'e').trim();
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

/* ═══ İCAZƏLƏR VƏ TƏSDİQ ═══ */
export const can = (perm) => hasPermission(perm);
export function canCreate(kind) { return can(DOCS[kind].perm + '.create'); }
export function canApprove(kind, doc) {
  if (!can(DOCS[kind].perm + '.approve')) return false;
  if (isAdmin() || inv.settings.allowSelfApprove) return true;
  return !doc || doc.createdBy !== uid();
}
export function hasAnyInvPerm() {
  if (isAdmin()) return true;
  const ps = state.user?.permissions || [];
  return ps.some(k => /^(catalog|warehouse|purchase|supplier|stock|cash)\./.test(k));
}

export async function nextNo(kind) {
  const d = DOCS[kind];
  const res = await db.ref('invCounters/' + kind).transaction(c => (Number(c) || 0) + 1);
  const n = res?.snapshot?.val() || 1;
  return `${d.prefix}-${String(n).padStart(5, '0')}`;
}

const posters = {};
/* poster: { post(doc,id) → Promise, unpost(doc,id) → Promise } */
export function registerPoster(kind, poster) { posters[kind] = poster; }

/* Yeni sənəd: həmişə "pending" (təsdiq gözləyir) yaranır. approveNow=true və icazə varsa dərhal təsdiqlənir. */
export async function createDoc(kind, data, { approveNow = false, asDraft = false } = {}) {
  if (!canCreate(kind) && !canApprove(kind)) throw new Error('Bu sənədi yaratmaq üçün icazəniz yoxdur');
  const d = DOCS[kind];
  const no = data.no || await nextNo(kind);
  const k = db.ref(d.node).push();
  const doc = { ...data, kind, no, status: asDraft ? 'draft' : 'pending', createdBy: uid(), createdByName: uname(), createdAt: Date.now() };
  await k.set(doc);
  addLog('inventory', `${d.label} ${no} yaradıldı${asDraft ? ' (qaralama)' : ' — təsdiq gözləyir'}`, { docKind: kind, docId: k.key });
  if (approveNow && !asDraft && canApprove(kind, doc)) await approveDoc(kind, k.key);
  return k.key;
}
export async function updateDoc(kind, id, data) {
  const d = DOCS[kind];
  const snap = await db.ref(`${d.node}/${id}/status`).once('value');
  if (!['draft', 'pending', 'rejected'].includes(snap.val())) throw new Error('Təsdiqlənmiş sənəd dəyişdirilə bilməz (storno edin)');
  await db.ref(`${d.node}/${id}`).update({ ...data, updatedAt: Date.now(), updatedBy: uname() });
}
export async function submitDoc(kind, id) {
  const d = DOCS[kind];
  await db.ref(`${d.node}/${id}`).update({ status: 'pending', submittedAt: Date.now(), rejectReason: null });
}
export async function approveDoc(kind, id) {
  const d = DOCS[kind];
  const docSnap = await db.ref(`${d.node}/${id}`).once('value');
  const doc = docSnap.val();
  if (!doc) throw new Error('Sənəd tapılmadı');
  if (!canApprove(kind, doc)) throw new Error(doc.createdBy === uid() ? 'Öz sənədinizi təsdiqləyə bilməzsiniz' : 'Təsdiq üçün icazəniz yoxdur');
  /* Kilid: iki nəfər eyni anda təsdiqləyə bilməsin */
  const lock = await db.ref(`${d.node}/${id}/status`).transaction(s => (s === 'pending' || s === 'draft') ? 'posting' : undefined);
  if (!lock.committed) throw new Error('Sənəd artıq emal olunub');
  try {
    if (posters[kind]?.post) await posters[kind].post({ ...doc, id }, id);
    await db.ref(`${d.node}/${id}`).update({ status: 'approved', approvedBy: uid(), approvedByName: uname(), approvedAt: Date.now(), postError: null });
    addLog('inventory', `${d.label} ${doc.no} təsdiqləndi`, { docKind: kind, docId: id });
  } catch (e) {
    await db.ref(`${d.node}/${id}`).update({ status: 'pending', postError: String(e?.message || e) });
    throw e;
  }
}
export async function rejectDoc(kind, id, reason) {
  const d = DOCS[kind];
  const doc = (await db.ref(`${d.node}/${id}`).once('value')).val();
  if (!doc || !canApprove(kind, doc)) throw new Error('İcazəniz yoxdur');
  await db.ref(`${d.node}/${id}`).update({ status: 'rejected', rejectReason: reason || '', rejectedBy: uname(), rejectedAt: Date.now() });
  addLog('inventory', `${d.label} ${doc.no} rədd edildi: ${reason || ''}`, { docKind: kind, docId: id });
}
export async function stornoDoc(kind, id, reason) {
  const d = DOCS[kind];
  if (!can(DOCS[kind].storno) && !isAdmin()) throw new Error('Storno üçün icazəniz yoxdur');
  if (!reason) throw new Error('Storno səbəbi yazılmalıdır');
  const lock = await db.ref(`${d.node}/${id}/status`).transaction(s => s === 'approved' ? 'posting' : undefined);
  if (!lock.committed) throw new Error('Yalnız təsdiqlənmiş sənəd storno edilə bilər');
  const doc = (await db.ref(`${d.node}/${id}`).once('value')).val();
  try {
    if (posters[kind]?.unpost) await posters[kind].unpost({ ...doc, id }, id);
    await db.ref(`${d.node}/${id}`).update({ status: 'storno', stornoReason: reason, stornoBy: uname(), stornoAt: Date.now() });
    addLog('inventory', `${d.label} ${doc.no} storno edildi: ${reason}`, { docKind: kind, docId: id });
  } catch (e) {
    await db.ref(`${d.node}/${id}/status`).set('approved');
    throw e;
  }
}
export async function deleteDraft(kind, id) {
  const d = DOCS[kind];
  const doc = (await db.ref(`${d.node}/${id}`).once('value')).val();
  if (!doc || !['draft', 'rejected', 'pending'].includes(doc.status)) throw new Error('Yalnız təsdiqlənməmiş sənəd silinə bilər');
  if (doc.createdBy !== uid() && !isAdmin()) throw new Error('Yalnız sənədi yaradan və ya admin silə bilər');
  await db.ref(`${d.node}/${id}`).remove();
  addLog('inventory', `${d.label} ${doc.no} silindi (təsdiqlənməmiş)`, { docKind: kind });
}

/* ═══ TƏCHİZATÇI HESABI ═══
   amount > 0 → bizim borcumuz artır (alış), amount < 0 → azalır (ödəniş, qaytarma) */
export async function ledgerPost(supplierId, entry) {
  const amount = r2(entry.amount);
  if (!supplierId || !amount) return;
  await db.ref(`supplierLedger/${supplierId}`).push({ ...entry, amount, at: entry.at || Date.now(), by: uname(), createdAt: Date.now() });
  /* köhnə hesabatlar üçün suppliers/{id}/totalDebt də yenilənir */
  await db.ref(`suppliers/${supplierId}/totalDebt`).transaction(c => r2((Number(c) || 0) + amount));
}

/* ═══ KÖÇÜRMƏ (köhnə sistemdən) ═══
   dryRun=true → heç nə yazmır, yalnız nə ediləcəyini qaytarır. */
export async function migrateToV2({ dryRun = true } = {}) {
  if (!isAdmin()) throw new Error('Köçürməni yalnız admin edə bilər');
  const [miSnap, ingSnap, whSnap, supSnap, setSnap] = await Promise.all([
    db.ref('menuItems').once('value'), db.ref('ingredients').once('value'),
    db.ref('warehouses').once('value'), db.ref('suppliers').once('value'), db.ref('settings/inventory').once('value')
  ]);
  const menuItems = miSnap.val() || {}, ingredients = ingSnap.val() || {}, sups = supSnap.val() || {};
  const settings = setSnap.val() || {};
  if (settings.mode === 'v2') throw new Error('Köçürmə artıq edilib');
  const plan = { products: {}, stock: {}, warnings: [], counts: { goods: 0, dish: 0, raw: 0, withStock: 0, suppliers: 0 } };
  let whId = Object.keys(whSnap.val() || {})[0] || null;
  const newWh = !whId;
  if (newWh) whId = db.ref('warehouses').push().key;

  Object.entries(ingredients).forEach(([id, g]) => {
    plan.products[id] = {
      name: g.name || 'Adsız', type: 'raw', unit: g.unit || 'kq', category: 'Xammal',
      avgCost: Number(g.cost) || 0, lastCost: Number(g.cost) || 0,
      minQty: Number.isFinite(Number(g.minQty)) ? Number(g.minQty) : null,
      vatRate: 0, showInMenu: false, active: true, migratedFrom: 'ingredients', createdAt: g.createdAt || Date.now()
    };
    plan.counts.raw++;
    if (Number(g.stock)) { plan.stock[id] = r3(g.stock); plan.counts.withStock++; }
  });
  Object.entries(menuItems).forEach(([id, m]) => {
    if (plan.products[id]) { plan.warnings.push(`ID toqquşması: ${m.name}`); return; }
    const isGoods = !!m.isTrackable || (m.stock !== undefined && m.stock !== null && !m.recipe);
    const recipe = {};
    Object.entries(m.recipe || {}).forEach(([cid, q]) => {
      if (!ingredients[cid]) { plan.warnings.push(`"${m.name}" reseptində silinmiş xammal var — atlandı`); return; }
      recipe[cid] = { gross: r4(q), waste: 0 };
    });
    const hist = {};
    Object.entries(m.priceHistory || {}).forEach(([k, h]) => { hist[k] = h; });
    plan.products[id] = {
      name: m.name || 'Adsız', type: isGoods ? 'goods' : 'dish', category: m.category || 'Digər',
      unit: isGoods ? 'ədəd' : 'porsiya', price: Number(m.price) || 0,
      vatRate: Number(m.vatRate) || 0, vatIncluded: m.vatIncluded !== false,
      showInMenu: true, showInQr: m.showInQr !== false, active: m.available !== false, isFavorite: !!m.isFavorite,
      photo: m.photo || '', description: m.description || '', kitchenId: m.kitchenId || null,
      recipe: isGoods ? null : (Object.keys(recipe).length ? recipe : null),
      avgCost: isGoods ? (Number(m.cost) || 0) : null, lastCost: isGoods ? (Number(m.cost) || 0) : null,
      priceHistory: Object.keys(hist).length ? hist : null,
      migratedFrom: 'menuItems', createdAt: m.createdAt || Date.now()
    };
    if (isGoods) { plan.counts.goods++; if (Number(m.stock)) { plan.stock[id] = r3(m.stock); plan.counts.withStock++; } }
    else plan.counts.dish++;
    if (isGoods && m.recipe) plan.warnings.push(`"${m.name}" həm sayıla bilən, həm reseptli idi — hazır mal kimi götürüldü`);
  });
  const supplierDebts = Object.entries(sups).filter(([, s]) => Math.abs(Number(s.totalDebt) || 0) > 0.009)
    .map(([id, s]) => ({ id, name: s.name, debt: r2(s.totalDebt) }));
  plan.counts.suppliers = supplierDebts.length;
  plan.supplierDebts = supplierDebts;
  plan.warehouseId = whId; plan.newWarehouse = newWh;
  if (dryRun) return plan;

  /* 1) Ehtiyat nüsxə */
  const ts = Date.now();
  await db.ref('invBackup/' + ts).set({ menuItems, ingredients, suppliers: sups, at: ts, by: uname() });
  /* 2) Anbar */
  if (newWh) await db.ref('warehouses/' + whId).set({ name: 'Əsas anbar', order: 1, createdAt: ts });
  /* 3) Məhsullar və qalıqlar */
  const upd = {};
  Object.entries(plan.products).forEach(([id, p]) => {
    Object.keys(p).forEach(k => { if (p[k] === null || p[k] === undefined) delete p[k]; });
    upd['products/' + id] = p;
  });
  Object.entries(plan.stock).forEach(([id, q]) => { upd[`stock/${whId}/${id}`] = q; });
  await db.ref().update(upd);
  const lines = {};
  Object.entries(plan.stock).forEach(([id, q], i) => {
    lines[i] = { pid: id, name: plan.products[id].name, unit: plan.products[id].unit, qty: q, cost: r4(plan.products[id].avgCost || 0) };
  });
  if (Object.keys(lines).length) await db.ref('stockMoves').push({ at: ts, type: 'opening', whId, lines, note: 'Köhnə sistemdən köçürülən ilkin qalıq', by: uid(), byName: uname(), createdAt: ts });
  /* 4) Təchizatçı borcları → ilkin qalıq (totalDebt artıq doğrudur, yalnız jurnal yazılır) */
  for (const s of supplierDebts) {
    await db.ref(`supplierLedger/${s.id}`).push({ type: 'opening', amount: s.debt, at: ts, note: 'Köhnə sistemdən ilkin borc', by: uname(), createdAt: ts });
  }
  /* 5) Rejimi aç */
  await db.ref('settings/inventory').update({ mode: 'v2', migratedAt: ts, migratedBy: uname(), defaultWarehouseId: whId, backupKey: String(ts) });
  addLog('inventory', `Anbar sistemi yeni rejimə köçürüldü: ${plan.counts.goods} hazır mal, ${plan.counts.dish} yemək, ${plan.counts.raw} xammal`, {});
  return plan;
}

/* Geri qaytarma: rejimi köhnəyə çevirir (məlumat silinmir) */
export async function rollbackMode() {
  if (!isAdmin()) throw new Error('Yalnız admin');
  await db.ref('settings/inventory/mode').set('legacy');
  addLog('inventory', 'Anbar sistemi köhnə rejimə qaytarıldı', {});
}
