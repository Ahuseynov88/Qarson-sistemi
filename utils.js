/* ═══════════════════════════════════════════
   UTILS
   Bütün modullarda istifadə olunan köməkçi funksiyalar.
═══════════════════════════════════════════ */
import { R } from './firebase-service.js';

export function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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
