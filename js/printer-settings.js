/* ═══════════════════════════════════════════
   PRINTER SETTINGS
   Admin → Printerlər bölməsinin render və saxlama funksiyaları.
═══════════════════════════════════════════ */
import { R, db } from './firebase-service.js';
import { state } from './state.js';
import { esc, showToast, toArr } from './utils.js';
import { testPrintReceipt } from './printer-service.js';

const PRINTER_TYPES = [
  { value: 'receipt', label: 'Hesab printeri' },
  { value: 'kitchen', label: 'Mətbəx printeri' },
  { value: 'bar',     label: 'Bar printeri'    },
  { value: 'other',   label: 'Digər'           }
];

// ── Printerlər bölməsini render et ──────────────────────────────────
export function renderPrinters() {
  const el = document.getElementById('printersGrid');
  if (!el) return;

  const printers = state.printers || [];

  if (!printers.length) {
    el.innerHTML = `<div style="grid-column:1/-1;color:var(--text3);padding:16px;text-align:center;">
      Hələ printer əlavə edilməyib. "+" düyməsi ilə yeni printer əlavə edin.
    </div>`;
    return;
  }

  el.innerHTML = printers.map(p => {
    const typeLabel = PRINTER_TYPES.find(t => t.value === p.type)?.label || p.type || '—';
    const statusClass = p.active ? 'status-badge badge-green' : 'status-badge badge-gray';
    const statusLabel = p.active ? 'Aktiv' : 'Passiv';

    return `<div class="item-card">
      <div class="item-card-header">
        <div style="width:44px;height:44px;border-radius:10px;background:var(--card2);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:22px;">🖨</div>
        <div class="item-info">
          <h3>${esc(p.name)}</h3>
          <small style="color:var(--text2);">${typeLabel}</small>
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap;">
        <span class="${statusClass}">${statusLabel}</span>
        <button class="btn btn-ghost" style="padding:5px 10px;font-size:12px;" onclick="openPrinterModal('${p.id}')">
          <svg class="icon"><use href="#i-edit"></use></svg> Redaktə
        </button>
        <button class="btn btn-ghost" style="padding:5px 10px;font-size:12px;" onclick="testPrinter('${p.id}')">
          <svg class="icon"><use href="#i-printer"></use></svg> Test
        </button>
        <button class="btn btn-ghost" style="padding:5px 10px;font-size:12px;color:var(--red);" onclick="deletePrinter('${p.id}','${esc(p.name)}')">
          <svg class="icon"><use href="#i-trash"></use></svg>
        </button>
      </div>
    </div>`;
  }).join('');
}

// ── Printer modal aç ─────────────────────────────────────────────────
export function openPrinterModal(printerId = null) {
  const modal = document.getElementById('printerModal');
  const title = document.getElementById('printerModalTitle');
  const nameEl = document.getElementById('printerName');
  const typeEl = document.getElementById('printerType');
  const activeEl = document.getElementById('printerActive');

  // Növ seçim dropdown-u doldur
  typeEl.innerHTML = PRINTER_TYPES.map(t =>
    `<option value="${t.value}">${t.label}</option>`
  ).join('');

  if (printerId) {
    const p = (state.printers || []).find(x => x.id === printerId);
    if (!p) return;
    title.textContent = 'Printeri Redaktə Et';
    nameEl.value = p.name || '';
    typeEl.value = p.type || 'receipt';
    activeEl.checked = !!p.active;
    modal.dataset.editId = printerId;
  } else {
    title.textContent = 'Yeni Printer';
    nameEl.value = '';
    typeEl.value = 'receipt';
    activeEl.checked = true;
    delete modal.dataset.editId;
  }

  modal.classList.add('open');
}

export function closePrinterModal() {
  document.getElementById('printerModal')?.classList.remove('open');
}

export function savePrinter() {
  const name    = document.getElementById('printerName').value.trim();
  const type    = document.getElementById('printerType').value;
  const active  = document.getElementById('printerActive').checked;
  const modal   = document.getElementById('printerModal');
  const editId  = modal.dataset.editId;

  if (!name) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Printer adı daxil edin'); return; }

  const data = { name, type, active, updatedAt: Date.now() };

  if (editId) {
    R.printers.child(editId).update(data).then(() => {
      showToast('<svg class="icon"><use href="#i-check"></use></svg> Printer yeniləndi');
      closePrinterModal();
    });
  } else {
    data.createdAt = Date.now();
    R.printers.push(data).then(() => {
      showToast('<svg class="icon"><use href="#i-check"></use></svg> Printer əlavə edildi');
      closePrinterModal();
    });
  }
}

export function deletePrinter(id, name) {
  if (!confirm(`"${name}" printerini silmək istəyirsiniz?`)) return;
  R.printers.child(id).remove().then(() => {
    showToast('<svg class="icon"><use href="#i-check"></use></svg> Printer silindi');
  });
}

export function testPrinter(printerId) {
  const p = (state.printers || []).find(x => x.id === printerId);
  if (!p) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Printer tapılmadı'); return; }
  testPrintReceipt(p);
}

// ── Çek Şablonu Ayarları ─────────────────────────────────────────────

const TEMPLATE_FIELDS = [
  { key: 'logo',          label: 'Logo' },
  { key: 'restaurantName',label: 'Restoran adı' },
  { key: 'address',       label: 'Ünvan' },
  { key: 'datetime',      label: 'Tarix / Saat' },
  { key: 'table',         label: 'Masa' },
  { key: 'waiter',        label: 'Ofisiant' },
  { key: 'itemName',      label: 'Məhsul adı' },
  { key: 'itemQty',       label: 'Miqdar' },
  { key: 'itemPrice',     label: 'Qiymət' },
  { key: 'lineTotal',     label: 'Sətir cəmi' },
  { key: 'discount',      label: 'Endirim' },
  { key: 'serviceCharge', label: 'Xidmət haqqı' },
  { key: 'totalAmount',   label: 'Ümumi məbləğ' },
  { key: 'paymentType',   label: 'Ödəniş növü' },
  { key: 'footer',        label: 'Footer mesajı' }
];

export async function renderReceiptTemplateSettings() {
  const container = document.getElementById('receiptTemplateSettings');
  if (!container) return;

  const snap = await db.ref('settings/receiptTemplate').once('value');
  const saved = snap.val() || {};

  const checkboxes = TEMPLATE_FIELDS.map(f => {
    const checked = saved[f.key] === undefined ? true : !!saved[f.key];
    return `<label style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;background:var(--card2);border:1px solid var(--border);cursor:pointer;font-size:13px;">
      <input type="checkbox" name="tpl_field" value="${f.key}" ${checked ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--green);flex-shrink:0;">
      ${f.label}
    </label>`;
  }).join('');

  const footerVal = saved.footerMessage || '';

  container.innerHTML = `
    <h3 style="margin-bottom:12px;"><svg class="icon"><use href="#i-clipboard"></use></svg> Çek Şablonu</h3>
    <p style="font-size:13px;color:var(--text2);margin-bottom:14px;">Çekdə hansı məlumatların görünəcəyini seçin:</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;">
      ${checkboxes}
    </div>
    <div class="form-group">
      <label>Footer mesajı</label>
      <input type="text" id="tplFooterMessage" value="${esc(footerVal)}" placeholder="Məs: Təşəkkür edirik! Yenidən gəlin." style="font-size:14px;">
    </div>
    <button class="btn btn-green" onclick="saveReceiptTemplate()" style="width:100%;padding:13px;margin-top:4px;">
      <svg class="icon"><use href="#i-save"></use></svg> Şablonu Saxla
    </button>
    <p id="tplSaveStatus" style="font-size:12px;color:var(--green);margin-top:8px;min-height:14px;"></p>

    <div class="form-group" style="margin-top:24px;">
      <label>Restoran adı (çekdə)</label>
      <input type="text" id="restaurantNameInput" placeholder="Məs: Ənənə Restoran" style="font-size:14px;">
    </div>
    <div class="form-group">
      <label>Ünvan (çekdə)</label>
      <input type="text" id="restaurantAddressInput" placeholder="Məs: Naxçıvan, Heydər Əliyev pr. 1" style="font-size:14px;">
    </div>
    <button class="btn btn-blue" onclick="saveRestaurantInfo()" style="width:100%;padding:13px;">
      <svg class="icon"><use href="#i-save"></use></svg> Restoran Məlumatını Saxla
    </button>
    <p id="restaurantInfoStatus" style="font-size:12px;color:var(--green);margin-top:8px;min-height:14px;"></p>
  `;

  // Mövcud restoran məlumatını yüklə
  const [nameSnap, addrSnap] = await Promise.all([
    db.ref('settings/restaurantName').once('value'),
    db.ref('settings/restaurantAddress').once('value')
  ]);
  const nameEl = document.getElementById('restaurantNameInput');
  const addrEl = document.getElementById('restaurantAddressInput');
  if (nameEl && nameSnap.val()) nameEl.value = nameSnap.val();
  if (addrEl && addrSnap.val()) addrEl.value = addrSnap.val();
}

export function saveReceiptTemplate() {
  const data = {};
  document.querySelectorAll('input[name="tpl_field"]').forEach(cb => {
    data[cb.value] = cb.checked;
  });
  const footerMsg = document.getElementById('tplFooterMessage')?.value?.trim() || '';
  data.footerMessage = footerMsg;

  db.ref('settings/receiptTemplate').set(data).then(() => {
    const el = document.getElementById('tplSaveStatus');
    if (el) { el.textContent = '✓ Saxlanıldı'; setTimeout(() => { el.textContent = ''; }, 2000); }
  });
}

export function saveRestaurantInfo() {
  const name = document.getElementById('restaurantNameInput')?.value?.trim() || '';
  const addr = document.getElementById('restaurantAddressInput')?.value?.trim() || '';
  Promise.all([
    db.ref('settings/restaurantName').set(name),
    db.ref('settings/restaurantAddress').set(addr)
  ]).then(() => {
    const el = document.getElementById('restaurantInfoStatus');
    if (el) { el.textContent = '✓ Saxlanıldı'; setTimeout(() => { el.textContent = ''; }, 2000); }
  });
}
