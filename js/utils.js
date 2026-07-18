/* ═══════════════════════════════════════════
   UTILS
   Bütün modullarda istifadə olunan köməkçi funksiyalar.
═══════════════════════════════════════════ */
import { R } from './firebase-service.js';
import { state } from './state.js';

export function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Log mesajları üçün mal siyahısını qısa formatda birləşdirir: "2x Kabab, 1x Salat"
export function formatItemsList(items) {
  const arr = Array.isArray(items) ? items : Object.values(items || {});
  return arr.map(it => `${it.qty}x ${it.name}`).join(', ');
}

// Masaya aid tarixçə görünüşündə eyni masanın adının təkrarlanmasının qarşısını alır
// (məs. "Admin Əli "Kabinet 2" masası üçün hesab çap etdi" → "Admin Əli hesab çap etdi",
// çünki artıq "Kabinet 2"-nin öz tarixçəsinə baxırıq, təkrar yazmağa ehtiyac yoxdur).
export function stripTableName(message, tableName) {
  if (!tableName) return message;
  const q = `"${tableName}"`;
  const patterns = [
    `${q} masası üçün `, `${q} masasında `, `${q} masasından `, `${q} masasının `,
    `${q} masasını açdı`, `${q} masasını bağladı`,
  ];
  for (const p of patterns) {
    if (message.includes(p)) {
      const verb = p.endsWith('açdı') ? 'açdı' : p.endsWith('bağladı') ? 'bağladı' : null;
      return (verb ? message.replace(p, verb) : message.replace(p, '')).trim();
    }
  }
  return message;
}

export function toArr(obj) {
  if (!obj) return [];
  return Object.keys(obj).map(k => ({ id: k, ...obj[k] }));
}

// DİQQƏT: mesaj SVG ikon markup-u ehtiva edə bilər (məs. '<svg class="icon">...'),
// ona görə innerHTML istifadə olunur - textContent ikonu çılpaq mətn kimi göstərərdi.
export function showToast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.innerHTML = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3000);
}

export function showCustomerToast(msg) {
  const el = document.getElementById('customerToast');
  if (!el) return;
  el.innerHTML = msg;
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => el.style.display = 'none', 3000);
}

export function makeLineKey(menuItemId, note, extraFee) {
  const safeNote = (note||'').replace(/[.#$\[\]/\s]+/g, '_');
  let hash = 0;
  for (let i = 0; i < (note||'').length; i++) hash = ((hash << 5) - hash + note.charCodeAt(i)) | 0;
  return `${menuItemId}__${safeNote}_${Math.abs(hash)}__${String(extraFee||0).replace('.','_')}`;
}

export function addLog(type, message, details = {}) {
  // Masaya aid qeydsə və sessionId göstərilməyibsə, masanın CARİ sessiyasını avtomatik tap.
  // Bu, "Tarixçə" düyməsinin yalnız hazırkı aktivləşmədən sonrakı əməliyyatları göstərməsini təmin edir.
  if (details.tableId && !details.sessionId) {
    const t = state.tables.find(x => x.id === details.tableId);
    if (t?.sessionId) details = { ...details, sessionId: t.sessionId };
  }
  R.logs.push({
    type, message, details,
    timestamp: Date.now(),
    time: new Date().toLocaleTimeString('az-AZ'),
    date: new Date().toLocaleDateString('az-AZ')
  });
}

// stok Firebase transaction ilə dəyişdirilir ki, iki paralel sifariş eyni malı
// azaldanda bir-birini əzməsin (race condition qorunması)
export function updateStock(menuItemId, delta, menuItems) {
  if (!menuItemId) return;
  const item = menuItems.find(x => x.id === menuItemId);
  if (!item || item.stock === undefined || item.stock === null) return;
  R.menuItems.child(menuItemId).child('stock').transaction(current => Math.max(0, (current || 0) + delta));
}
