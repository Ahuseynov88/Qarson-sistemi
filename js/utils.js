/* ═══════════════════════════════════════════
   UTILS
   Bütün modullarda istifadə olunan köməkçi funksiyalar.
═══════════════════════════════════════════ */
import { R, db } from './firebase-service.js';
import { state } from './state.js';

/* ── Server vaxtı (Mərhələ 2a) ──
   Pul və satış qeydlərinin vaxtı cihazın saatından yox, Firebase serverinin saatından götürülür:
   kassa kompüterinin saatı səhv olsa da hesabatlar düzgün günə düşür. */
let _srvOffset = 0;
try { db.ref('.info/serverTimeOffset').on('value', s => { _srvOffset = Number(s.val()) || 0; }); } catch (e) { /* */ }
export const serverNow = () => Date.now() + _srvOffset;
export const azTime = (ts) => new Date(ts).toLocaleTimeString('az-AZ');
export const azDate = (ts) => new Date(ts).toLocaleDateString('az-AZ');
/* Tarix həmişə saatla birlikdə göstərilir (iş prinsipi №8): 20.11.2026 14:05 */
export const azDateTime = (ts) => { const d = new Date(ts); const p = (x) => String(x).padStart(2, '0'); return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; };
/* Pul məbləğləri qəpiyə qədər yuvarlaqlaşdırılır (0.1+0.2 kimi xətalar toplanmasın) */
export const money2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/* İşçi şəkli yoxdursa: adın baş hərfləri ilə yerli şəkil (əvvəl xarici saytdan — ui-avatars.com — yüklənirdi:
   internetsiz işləmirdi və işçi adları kənar sayta gedirdi) */
export function initialsAvatar(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  const ini = ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toLocaleUpperCase('az');
  const safe = ini.replace(/[<>&"']/g, '');
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c98d2e"/><stop offset="1" stop-color="#7a5110"/></linearGradient></defs><rect width="80" height="80" rx="40" fill="url(#g)"/><text x="40" y="51" font-family="Inter,Arial,sans-serif" font-size="${safe.length > 1 ? 30 : 36}" font-weight="700" fill="#fff" text-anchor="middle">${safe}</text></svg>`);
}
window.yzInitials = initialsAvatar;

export function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Masa kateqoriyasını təhlükəsiz təyin edir - t.name mətn olmaya bilər (köhnə/uyğunsuz
// məlumat üçün), ona görə hər addımda yoxlama edilir ki, TƏK BİR səhv masa BÜTÜN
// siyahını (həm admin, həm qarson tərəfdə) qırmasın. HƏM admin.js, HƏM tables.js
// bunu istifadə edir - iki ayrı yerdə eyni riskli kodun təkrarlanmasının qarşısını alır.
export function tableCategoryOf(t) {
  if (t.category) return t.category;
  const name = typeof t.name === 'string' ? t.name : String(t.name ?? 'Masa');
  return name.replace(/\s+\d+$/, '') || name;
}

// Log mesajları üçün mal siyahısını qısa formatda birləşdirir: "2x Kabab, 1x Salat"
export function formatItemsList(items) {
  const arr = Array.isArray(items) ? items : Object.values(items || {});
  return arr.map(it => `${it.qty}x ${it.name}`).join(', ');
}

// Malların cəmini hesablayır və (aktivdirsə) xidmət haqqını əlavə edir.
// BÜTÜN yerlərdə order.total hesablanarkən İSTİFADƏ OLUNMALIDIR ki, xidmət
// haqqı hər zaman tutarlı tətbiq olunsun (mal əlavəsi, endirim, köçürmə və s.).
// ƏDV: sətirdə vatRate (faiz) və vatIncluded (false = qiymətə əlavə olunur) saxlanılır.
// vatIncluded !== false  → ƏDV qiymətin içindədir (yalnız məlumat üçün)
// vatIncluded === false  → ƏDV qiymətin üstünə əlavə olunur
export function computeVat(items) {
  let added = 0, included = 0;
  const byRate = {};
  Object.values(items || {}).forEach(v => {
    const r = Number(v.vatRate) || 0;
    if (r <= 0) return;
    const line = (v.price||0) * v.qty * (1 - ((v.discountPercent||0)/100)) + (v.extraFee||0);
    const inc = v.vatIncluded !== false;
    const amt = inc ? line * r / (100 + r) : line * r / 100;
    if (inc) included += amt; else added += amt;
    const k = r + (inc ? 'i' : 'a');
    byRate[k] = byRate[k] || { rate: r, included: inc, amount: 0 };
    byRate[k].amount += amt;
  });
  const rd = n => Math.round(n * 100) / 100;
  return { added: rd(added), included: rd(included), rows: Object.values(byRate).map(x => ({ ...x, amount: rd(x.amount) })) };
}

export function computeOrderTotals(items) {
  let itemsSubtotal = 0;
  Object.values(items || {}).forEach(v => {
    itemsSubtotal += (v.price||0) * v.qty * (1 - ((v.discountPercent||0)/100)) + (v.extraFee||0);
  });
  itemsSubtotal = Math.round(itemsSubtotal * 100) / 100;
  const sc = state.serviceCharge || {};
  const scPercent = sc.enabled ? (sc.percent || 0) : 0;
  const serviceChargeAmount = Math.round(itemsSubtotal * scPercent / 100 * 100) / 100;
  const vatAdded = computeVat(items).added;
  const total = Math.round((itemsSubtotal + serviceChargeAmount + vatAdded) * 100) / 100;
  return { itemsSubtotal, serviceChargeAmount, serviceChargePercent: scPercent, vatAdded, total };
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
/* Bildiriş: növü ikondan müəyyən olunur (uğur / xəbərdarlıq / xəta / məlumat).
   Xəta mesajı daha uzun qalır və bağlama düyməsi olur — oxumağa vaxt çatsın. */
export function showToast(msg, opts = {}) {
  const el = document.getElementById('toast');
  if (!el) return;
  const m = String(msg);
  const type = opts.type || (/#i-(error|ban)\b/.test(m) ? 'error' : /#i-warning\b/.test(m) ? 'warn' : /#i-check\b/.test(m) ? 'ok' : 'info');
  if (!el.dataset.a11y) { el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); el.dataset.a11y = '1'; }
  el.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
  el.className = 'show is-' + type;
  el.innerHTML = `<span class="yz-toast__msg">${m}</span>` + (type === 'error'
    ? '<button type="button" class="yz-toast__x" aria-label="Bağla" title="Bağla"><svg class="icon"><use href="#i-close"></use></svg></button>' : '');
  el.querySelector('.yz-toast__x')?.addEventListener('click', () => el.classList.remove('show'));
  clearTimeout(el._t);
  const ms = opts.ms || (type === 'error' ? 7000 : type === 'warn' ? 4500 : 3500);
  el._t = setTimeout(() => el.classList.remove('show'), ms);
}

// Brauzerin çirkin confirm() pəncərəsi əvəzinə proqramın öz dizaynında təsdiq pəncərəsi.
// İstifadə: confirmAction('Silinsin?', () => { ...əməliyyat... });
export function confirmAction(message, onConfirm, options = {}) {
  const modal = document.getElementById('confirmActionModal');
  if (!modal) { if (onConfirm) onConfirm(); return; }
  document.getElementById('confirmActionTitle').textContent = options.title || 'Əminsiniz?';
  document.getElementById('confirmActionMessage').innerHTML = message;
  const okBtn = document.getElementById('confirmActionOkBtn');
  okBtn.innerHTML = options.okLabel || 'Təsdiqlə';
  okBtn.className = 'btn ' + (options.okClass || 'btn-red');
  // Köhnə listener-lər yığılmasın deyə düyməni klonlayıb təzədən qururuq
  const freshBtn = okBtn.cloneNode(true);
  okBtn.parentNode.replaceChild(freshBtn, okBtn);
  freshBtn.addEventListener('click', () => {
    modal.classList.remove('open');
    if (onConfirm) onConfirm();
  }, { once: true });
  modal.classList.add('open');
}

/* Brauzerin confirm() əvəzi — Promise qaytarır: true (təsdiq) / false (Ləğv, Esc, Geri).
   İstifadə: if (!await askConfirm('Silinsin?', { okLabel: 'Sil' })) return; */
export function askConfirm(message, options = {}) {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirmActionModal');
    if (!modal) { resolve(window.confirm(String(message).replace(/<[^>]+>/g, ''))); return; }
    let done = false;
    const finish = (v) => { if (done) return; done = true; obs.disconnect(); resolve(v); };
    const obs = new MutationObserver(() => { if (!modal.classList.contains('open')) finish(false); });
    confirmAction(message, () => finish(true), options);
    obs.observe(modal, { attributes: true, attributeFilter: ['class'] });
  });
}
window.yzAsk = askConfirm;

/* Brauzerin alert() əvəzi — xəta mesajı bildiriş kimi göstərilir */
export function showError(message) {
  showToast('<svg class="icon"><use href="#i-error"></use></svg> ' + esc(String(message)));
}

export function closeConfirmAction() {
  document.getElementById('confirmActionModal')?.classList.remove('open');
}

// Təhlükəli (geri qaytarıla bilməyən) toplu silmə əməliyyatları üçün 2 dəfə ardıcıl xəbərdarlıq.
// Səhvən silinmənin qarşısını almaq üçün ikinci addımda mesaj ciddiləşir.
export function confirmDelete2x(count, itemLabel, onFinalConfirm) {
  confirmAction(`${count} ${itemLabel} silmək istədiyinizə əminsiniz?`, () => {
    confirmAction(`Son dəfə soruşuram: <strong>${count} ${itemLabel} həmişəlik silinəcək və geri qaytarıla bilməz.</strong> Tam əminsinizmi?`, () => {
      onFinalConfirm();
    }, { title: 'Son xəbərdarlıq!', okLabel: '<svg class="icon"><use href="#i-trash"></use></svg> Bəli, Həmişəlik Sil', okClass: 'btn-red' });
  }, { title: 'Silmək istəyirsiniz?', okLabel: 'Bəli, davam et', okClass: 'btn-red' });
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
  const ts = serverNow();
  R.logs.push({
    type, message, details,
    timestamp: ts,
    time: azTime(ts),
    date: azDate(ts)
  });
}

// stok Firebase transaction ilə dəyişdirilir ki, iki paralel sifariş eyni malı
// azaldanda bir-birini əzməsin (race condition qorunması)
// Satışda anbardan silinmə yalnız anbar sistemində (yuza-inv-core.js → saleHook) aparılır.
// Mərhələ 5: köhnə anbar (menuItems.stock, ingredients) məntiqi silinib. Modul hələ yüklənməyibsə satış gözləyir.
let _stockHook = null;
const _early = [];
export function setStockHook(fn) { _stockHook = fn; _early.splice(0).forEach(([id, d]) => { try { fn(id, d); } catch (e) { console.warn('[stock]', e); } }); }

export function updateStock(menuItemId, delta) {
  if (!menuItemId) return;
  if (_stockHook) _stockHook(menuItemId, delta); else _early.push([menuItemId, delta]);
}
