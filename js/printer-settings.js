/* ═══════════════════════════════════════════
   PRINTER SETTINGS
   Admin → Printerlər bölməsi: printer idarəsi + şablon ayarları.
═══════════════════════════════════════════ */
import { R, db } from './firebase-service.js';
import { state } from './state.js';
import { esc, showToast, toArr } from './utils.js';
import { testPrintReceipt } from './printer-service.js';

const PRINTER_TYPES = [
  { value: 'receipt', label: '🧾 Hesab printeri' },
  { value: 'kitchen', label: '🍳 Mətbəx / Bar / Digər' }
];

const PAPER_WIDTHS = [
  { value: '58mm', label: '58mm (kiçik)' },
  { value: '80mm', label: '80mm (standart)' }
];

/* ══════════════════════════════════════════
   PRİNTER SİYAHISI
══════════════════════════════════════════ */
export function renderPrinters() {
  const el = document.getElementById('printersGrid');
  if (!el) return;
  const printers = state.printers || [];

  if (!printers.length) {
    el.innerHTML = `<div style="grid-column:1/-1;color:var(--text3);padding:24px;text-align:center;">
      <div style="font-size:32px;margin-bottom:8px;">🖨</div>
      Hələ printer əlavə edilməyib.<br>
      <span style="font-size:13px;">«+» düyməsi ilə yeni printer əlavə edin.</span>
    </div>`;
    return;
  }

  el.innerHTML = printers.map(p => {
    const typeLabel  = PRINTER_TYPES.find(t => t.value === p.type)?.label || p.type || '—';
    const paperLabel = PAPER_WIDTHS.find(w => w.value === p.paperWidth)?.label || p.paperWidth || '80mm';
    const cats       = (p.categories || []).join(', ') || '—';
    const ipLabel    = p.ip ? `${p.ip}:${p.port || 9100}` : 'USB';
    const statusColor = p.active ? 'var(--green)' : 'var(--text3)';

    return `<div class="item-card">
      <div class="item-card-header">
        <div style="width:44px;height:44px;border-radius:10px;background:var(--card2);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:22px;">🖨</div>
        <div class="item-info">
          <h3>${esc(p.name)}</h3>
          <small style="color:var(--text2);">${typeLabel} · ${paperLabel}</small>
        </div>
        <div style="width:10px;height:10px;border-radius:50%;background:${statusColor};flex-shrink:0;margin-top:4px;"></div>
      </div>
      <div style="font-size:12px;color:var(--text2);margin-top:8px;">
        <div>📡 ${ipLabel}</div>
        ${p.type !== 'receipt' ? `<div style="margin-top:3px;">📂 ${esc(cats)}</div>` : '<div style="margin-top:3px;color:var(--blue);">Müştəri hesabı üçün</div>'}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;">
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

/* ══════════════════════════════════════════
   PRİNTER MODAL
══════════════════════════════════════════ */
export function openPrinterModal(printerId = null) {
  const modal   = document.getElementById('printerModal');
  const nameEl  = document.getElementById('printerName');
  const typeEl  = document.getElementById('printerType');
  const paperEl = document.getElementById('printerPaper');
  const ipEl    = document.getElementById('printerIp');
  const portEl  = document.getElementById('printerPort');
  const activeEl= document.getElementById('printerActive');

  /* Dropdown-ları doldur */
  typeEl.innerHTML  = PRINTER_TYPES.map(t => `<option value="${t.value}">${t.label}</option>`).join('');
  paperEl.innerHTML = PAPER_WIDTHS.map(w => `<option value="${w.value}">${w.label}</option>`).join('');

  if (printerId) {
    const p = (state.printers || []).find(x => x.id === printerId);
    if (!p) return;
    document.getElementById('printerModalTitle').textContent = 'Printeri Redaktə Et';
    nameEl.value  = p.name       || '';
    typeEl.value  = p.type       || 'kitchen';
    paperEl.value = p.paperWidth || '80mm';
    ipEl.value    = p.ip         || '';
    portEl.value  = p.port       || 9100;
    activeEl.checked = !!p.active;
    modal.dataset.editId = printerId;
  } else {
    document.getElementById('printerModalTitle').textContent = 'Yeni Printer';
    nameEl.value  = '';
    typeEl.value  = 'kitchen';
    paperEl.value = '80mm';
    ipEl.value    = '';
    portEl.value  = 9100;
    activeEl.checked = true;
    delete modal.dataset.editId;
  }

  _updatePrinterModalCats(printerId);
  _toggleReceiptFields();
  modal.classList.add('open');
}

/* Printer növü dəyişəndə kateqoriya bölməsini göstər/gizlə */
export function _toggleReceiptFields() {
  const type    = document.getElementById('printerType')?.value;
  const catWrap = document.getElementById('printerCatWrap');
  if (catWrap) catWrap.style.display = type === 'receipt' ? 'none' : 'block';
}

/* Kateqoriya checkboxlarını doldur */
function _updatePrinterModalCats(printerId = null) {
  const wrap = document.getElementById('printerCatList');
  if (!wrap) return;

  const allCats = [...new Set((state.menuItems || []).map(m => m.category || 'Digər').filter(Boolean))].sort();
  const saved   = printerId ? ((state.printers||[]).find(p=>p.id===printerId)?.categories || []) : [];

  if (!allCats.length) {
    wrap.innerHTML = '<p style="font-size:12px;color:var(--text3);">Menyu kateqoriyası tapılmadı. Əvvəlcə menyu malı əlavə edin.</p>';
    return;
  }

  wrap.innerHTML = allCats.map(cat => `
    <label style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;background:var(--bg);border:1px solid var(--border);cursor:pointer;font-size:13px;">
      <input type="checkbox" name="printer_cat" value="${esc(cat)}" ${saved.includes(cat)?'checked':''} style="width:16px;height:16px;accent-color:var(--green);">
      ${esc(cat)}
    </label>`).join('');
}

export function closePrinterModal() {
  document.getElementById('printerModal')?.classList.remove('open');
}

export function savePrinter() {
  const name   = document.getElementById('printerName').value.trim();
  const type   = document.getElementById('printerType').value;
  const paper  = document.getElementById('printerPaper').value;
  const ip     = document.getElementById('printerIp').value.trim();
  const port   = parseInt(document.getElementById('printerPort').value) || 9100;
  const active = document.getElementById('printerActive').checked;
  const modal  = document.getElementById('printerModal');
  const editId = modal.dataset.editId;

  if (!name) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Printer adı daxil edin'); return; }

  /* Kateqoriyaları yalnız mətbəx/bar printerindən al */
  const categories = type !== 'receipt'
    ? Array.from(document.querySelectorAll('input[name="printer_cat"]:checked')).map(cb => cb.value)
    : [];

  const data = { name, type, paperWidth: paper, ip, port, active, categories, updatedAt: Date.now() };

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

/* ══════════════════════════════════════════
   HESAB ÇEKİ ŞABLONU
══════════════════════════════════════════ */
export async function renderReceiptTemplateSettings() {
  const container = document.getElementById('receiptTemplateSettings');
  if (!container) return;

  const [tplSnap, nameSnap, addrSnap, phoneSnap, logoSnap] = await Promise.all([
    db.ref('settings/receiptTemplate').once('value'),
    db.ref('settings/restaurantName').once('value'),
    db.ref('settings/restaurantAddress').once('value'),
    db.ref('settings/restaurantPhone').once('value'),
    db.ref('settings/restaurantLogo').once('value')
  ]);
  const s    = tplSnap.val()  || {};
  const val  = (key, def) => s[key] !== undefined ? s[key] : def;
  const chk  = (key, def=true) => val(key, def) ? 'checked' : '';

  const logoUrl = logoSnap.val() || '';

  container.innerHTML = `
    <h3 style="margin-bottom:16px;"><svg class="icon"><use href="#i-printer"></use></svg> Hesab Çeki Şablonu</h3>

    <!-- Restoran məlumatı -->
    <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;margin-bottom:8px;">Restoran məlumatı</div>
    <div class="form-group">
      <label>Restoran adı</label>
      <input type="text" id="tplRestName" value="${esc(nameSnap.val()||'')}" placeholder="Ənənə Restoran">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Ad font ölçüsü</label>
        <select id="tplRestNameSize">
          <option value="normal" ${val('restaurantNameSize','large')==='normal'?'selected':''}>Normal</option>
          <option value="large"  ${val('restaurantNameSize','large')==='large' ?'selected':''}>Böyük</option>
          <option value="xlarge" ${val('restaurantNameSize','large')==='xlarge'?'selected':''}>Çox böyük</option>
        </select>
      </div>
      <div class="form-group">
        <label>Hizalanma</label>
        <select id="tplRestNameAlign">
          <option value="left"   ${val('restaurantNameAlign','center')==='left'  ?'selected':''}>Sol</option>
          <option value="center" ${val('restaurantNameAlign','center')==='center'?'selected':''}>Mərkəz</option>
          <option value="right"  ${val('restaurantNameAlign','center')==='right' ?'selected':''}>Sağ</option>
        </select>
      </div>
    </div>
    <div style="display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap;">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;">
        <input type="checkbox" id="tplRestNameBold"  ${chk('restaurantNameBold',true)}  style="width:16px;height:16px;accent-color:var(--green);"> Qalın (bold)
      </label>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;">
        <input type="checkbox" id="tplRestNameUpper" ${chk('restaurantNameUpper',false)} style="width:16px;height:16px;accent-color:var(--green);"> Böyük hərf (uppercase)
      </label>
    </div>
    <div class="form-group">
      <label>Ünvan</label>
      <input type="text" id="tplRestAddr" value="${esc(addrSnap.val()||'')}" placeholder="Naxçıvan, Heydər Əliyev pr. 1">
    </div>
    <div class="form-group">
      <label>Telefon</label>
      <input type="text" id="tplRestPhone" value="${esc(phoneSnap.val()||'')}" placeholder="+994 XX XXX XX XX">
    </div>

    <!-- Logo -->
    <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;margin:16px 0 8px;">Logo</div>
    ${logoUrl ? `<img src="${esc(logoUrl)}" style="max-height:60px;max-width:160px;object-fit:contain;border-radius:6px;margin-bottom:8px;display:block;">` : ''}
    <input type="file" id="tplLogoFile" accept="image/*" style="font-size:13px;margin-bottom:8px;">
    <button class="btn btn-blue" onclick="uploadReceiptLogo()" style="padding:8px 16px;font-size:13px;">
      <svg class="icon"><use href="#i-save"></use></svg> Loqo Yüklə
    </button>
    ${logoUrl ? `<button class="btn btn-ghost" onclick="removeReceiptLogo()" style="padding:8px 12px;font-size:13px;color:var(--red);margin-left:8px;">Sil</button>` : ''}
    <p id="tplLogoStatus" style="font-size:12px;color:var(--green);min-height:14px;margin-top:6px;"></p>

    <!-- Kağız eni -->
    <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;margin:16px 0 8px;">Kağız / Format</div>
    <div class="form-group">
      <label>Kağız eni</label>
      <select id="tplPaperWidth">
        <option value="58mm" ${val('paperWidth','80mm')==='58mm'?'selected':''}>58mm</option>
        <option value="80mm" ${val('paperWidth','80mm')==='80mm'?'selected':''}>80mm</option>
      </select>
    </div>
    <div class="form-group">
      <label>Ayırıcı xətt növü</label>
      <select id="tplDivider">
        <option value="dash"  ${val('dividerType','dash')==='dash' ?'selected':''}>Tire (--------)</option>
        <option value="star"  ${val('dividerType','dash')==='star' ?'selected':''}>Ulduz (********)</option>
        <option value="equal" ${val('dividerType','dash')==='equal'?'selected':''}>Xətt (========)</option>
        <option value="none"  ${val('dividerType','dash')==='none' ?'selected':''}>Yoxdur</option>
      </select>
    </div>
    <div class="form-group">
      <label>Çek sonunda boş sətir sayı (kəsmək üçün)</label>
      <input type="number" id="tplBottomLines" value="${val('bottomLines',3)}" min="0" max="10">
    </div>
    <div class="form-group">
      <label>Valyuta simvolu</label>
      <select id="tplCurrency">
        <option value="₼"   ${val('currency','₼')==='₼'  ?'selected':''}>₼ (manat)</option>
        <option value="AZN" ${val('currency','₼')==='AZN'?'selected':''}>AZN</option>
        <option value="$"   ${val('currency','₼')==='$'  ?'selected':''}>$</option>
        <option value="€"   ${val('currency','₼')==='€'  ?'selected':''}>€</option>
      </select>
    </div>

    <!-- Göstəriləcək sahələr -->
    <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;margin:16px 0 8px;">Çekdə görünən sahələr</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;">
      ${_tplCheckbox('logo',          'Logo',          chk('logo'))}
      ${_tplCheckbox('restaurantName','Restoran adı',  chk('restaurantName'))}
      ${_tplCheckbox('address',       'Ünvan',         chk('address'))}
      ${_tplCheckbox('phone',         'Telefon',       chk('phone',false))}
      ${_tplCheckbox('datetime',      'Tarix / Saat',  chk('datetime'))}
      ${_tplCheckbox('table',         'Masa',          chk('table'))}
      ${_tplCheckbox('waiter',        'Ofisiant',      chk('waiter'))}
      ${_tplCheckbox('itemName',      'Məhsul adı',    chk('itemName'))}
      ${_tplCheckbox('itemQty',       'Miqdar',        chk('itemQty'))}
      ${_tplCheckbox('itemPrice',     'Vahid qiymət',  chk('itemPrice'))}
      ${_tplCheckbox('lineTotal',     'Sətir cəmi',    chk('lineTotal'))}
      ${_tplCheckbox('discount',      'Endirim',       chk('discount'))}
      ${_tplCheckbox('serviceCharge', 'Xidmət haqqı',  chk('serviceCharge'))}
      ${_tplCheckbox('totalAmount',   'Ümumi məbləğ',  chk('totalAmount'))}
      ${_tplCheckbox('paymentType',   'Ödəniş növü',   chk('paymentType'))}
      ${_tplCheckbox('footer',        'Footer mesajı', chk('footer'))}
    </div>

    <!-- Məhsul + cəm font -->
    <div class="form-row">
      <div class="form-group">
        <label>Məhsul adı font</label>
        <select id="tplItemFontSize">
          <option value="small"  ${val('itemFontSize','normal')==='small' ?'selected':''}>Kiçik</option>
          <option value="normal" ${val('itemFontSize','normal')==='normal'?'selected':''}>Normal</option>
          <option value="large"  ${val('itemFontSize','normal')==='large' ?'selected':''}>Böyük</option>
        </select>
      </div>
      <div class="form-group">
        <label>Ümumi məbləğ font</label>
        <select id="tplTotalFontSize">
          <option value="normal" ${val('totalFontSize','large')==='normal'?'selected':''}>Normal</option>
          <option value="large"  ${val('totalFontSize','large')==='large' ?'selected':''}>Böyük</option>
          <option value="xlarge" ${val('totalFontSize','large')==='xlarge'?'selected':''}>Çox böyük</option>
        </select>
      </div>
    </div>
    <div style="display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap;">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;">
        <input type="checkbox" id="tplItemNameBold" ${chk('itemNameBold',false)} style="width:16px;height:16px;accent-color:var(--green);"> Məhsul adı qalın
      </label>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;">
        <input type="checkbox" id="tplTotalBold" ${chk('totalBold',true)} style="width:16px;height:16px;accent-color:var(--green);"> Cəmi qalın
      </label>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;">
        <input type="checkbox" id="tplTotalUpper" ${chk('totalUpper',true)} style="width:16px;height:16px;accent-color:var(--green);"> Cəmi böyük hərf
      </label>
    </div>

    <!-- Footer -->
    <div class="form-group">
      <label>Footer mesajı</label>
      <input type="text" id="tplFooterMessage" value="${esc(val('footerMessage','Təşəkkür edirik!'))}" placeholder="Təşəkkür edirik!">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Footer font</label>
        <select id="tplFooterFontSize">
          <option value="small"  ${val('footerFontSize','small')==='small' ?'selected':''}>Kiçik</option>
          <option value="normal" ${val('footerFontSize','small')==='normal'?'selected':''}>Normal</option>
          <option value="large"  ${val('footerFontSize','small')==='large' ?'selected':''}>Böyük</option>
        </select>
      </div>
      <div class="form-group">
        <label>Footer hizalanma</label>
        <select id="tplFooterAlign">
          <option value="left"   ${val('footerAlign','center')==='left'  ?'selected':''}>Sol</option>
          <option value="center" ${val('footerAlign','center')==='center'?'selected':''}>Mərkəz</option>
          <option value="right"  ${val('footerAlign','center')==='right' ?'selected':''}>Sağ</option>
        </select>
      </div>
    </div>

    <button class="btn btn-green" onclick="saveReceiptTemplate()" style="width:100%;padding:13px;margin-top:8px;">
      <svg class="icon"><use href="#i-save"></use></svg> Şablonu Saxla
    </button>
    <p id="tplSaveStatus" style="font-size:12px;color:var(--green);margin-top:8px;min-height:14px;"></p>

    <!-- Mətbəx çeki şablonu -->
    <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;margin:24px 0 8px;border-top:1px solid var(--border);padding-top:16px;">
      Mətbəx / Bar çeki şablonu
    </div>
    <p style="font-size:13px;color:var(--text2);margin-bottom:14px;">Sifarişlər gedəndə mətbəx/bar printerindən çıxan çekin görünüşü.</p>
    <div id="kitchenTemplateSettings"></div>
  `;

  renderKitchenTemplateSettings();
}

function _tplCheckbox(key, label, checkedAttr) {
  return `<label style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;background:var(--card2);border:1px solid var(--border);cursor:pointer;font-size:13px;">
    <input type="checkbox" name="tpl_field" value="${key}" ${checkedAttr} style="width:16px;height:16px;accent-color:var(--green);flex-shrink:0;">
    ${label}
  </label>`;
}

/* ── Mətbəx çeki şablonu ── */
async function renderKitchenTemplateSettings() {
  const wrap = document.getElementById('kitchenTemplateSettings');
  if (!wrap) return;

  const snap = await db.ref('settings/kitchenTemplate').once('value');
  const s    = snap.val() || {};
  const val  = (key, def) => s[key] !== undefined ? s[key] : def;
  const chk  = (key, def=true) => val(key, def) ? 'checked' : '';

  wrap.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;">
      ${_tplCheckbox('kitchenStationName','Printer/Stansiya adı', chk('kitchenStationName'))}
      ${_tplCheckbox('kitchenTable',      'Masa adı',             chk('kitchenTable'))}
      ${_tplCheckbox('kitchenDatetime',   'Tarix / Saat',         chk('kitchenDatetime'))}
      ${_tplCheckbox('kitchenWaiter',     'Ofisiant',             chk('kitchenWaiter'))}
      ${_tplCheckbox('kitchenNote',       'Ümumi qeyd',           chk('kitchenNote'))}
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Stansiya adı font</label>
        <select id="kTplStationSize">
          <option value="large"  ${val('kitchenStationSize','xlarge')==='large' ?'selected':''}>Böyük</option>
          <option value="xlarge" ${val('kitchenStationSize','xlarge')==='xlarge'?'selected':''}>Çox böyük</option>
        </select>
      </div>
      <div class="form-group">
        <label>Masa adı font</label>
        <select id="kTplTableSize">
          <option value="large"  ${val('kitchenTableSize','xlarge')==='large' ?'selected':''}>Böyük</option>
          <option value="xlarge" ${val('kitchenTableSize','xlarge')==='xlarge'?'selected':''}>Çox böyük</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Mal adı font</label>
        <select id="kTplItemSize">
          <option value="normal" ${val('kitchenItemSize','large')==='normal'?'selected':''}>Normal</option>
          <option value="large"  ${val('kitchenItemSize','large')==='large' ?'selected':''}>Böyük</option>
          <option value="xlarge" ${val('kitchenItemSize','large')==='xlarge'?'selected':''}>Çox böyük</option>
        </select>
      </div>
      <div class="form-group">
        <label>Miqdar font</label>
        <select id="kTplQtySize">
          <option value="large"  ${val('kitchenQtySize','xlarge')==='large' ?'selected':''}>Böyük</option>
          <option value="xlarge" ${val('kitchenQtySize','xlarge')==='xlarge'?'selected':''}>Çox böyük</option>
        </select>
      </div>
    </div>
    <div class="form-group">
      <label>Çek sonunda boş sətir sayı</label>
      <input type="number" id="kTplBottomLines" value="${val('kitchenBottomLines',4)}" min="0" max="10">
    </div>
    <button class="btn btn-green" onclick="saveKitchenTemplate()" style="width:100%;padding:13px;margin-top:4px;">
      <svg class="icon"><use href="#i-save"></use></svg> Mətbəx Şablonunu Saxla
    </button>
    <p id="kTplSaveStatus" style="font-size:12px;color:var(--green);margin-top:8px;min-height:14px;"></p>
  `;
}

/* ── Saxlama funksiyaları ── */
export function saveReceiptTemplate() {
  const data = {};
  document.querySelectorAll('input[name="tpl_field"]').forEach(cb => { data[cb.value] = cb.checked; });

  /* Restoran məlumatı */
  const name  = document.getElementById('tplRestName')?.value.trim()  || '';
  const addr  = document.getElementById('tplRestAddr')?.value.trim()  || '';
  const phone = document.getElementById('tplRestPhone')?.value.trim() || '';

  /* Format */
  data.paperWidth         = document.getElementById('tplPaperWidth')?.value    || '80mm';
  data.dividerType        = document.getElementById('tplDivider')?.value       || 'dash';
  data.bottomLines        = parseInt(document.getElementById('tplBottomLines')?.value) || 3;
  data.currency           = document.getElementById('tplCurrency')?.value      || '₼';

  /* Restoran adı stili */
  data.restaurantNameSize  = document.getElementById('tplRestNameSize')?.value  || 'large';
  data.restaurantNameAlign = document.getElementById('tplRestNameAlign')?.value || 'center';
  data.restaurantNameBold  = document.getElementById('tplRestNameBold')?.checked ?? true;
  data.restaurantNameUpper = document.getElementById('tplRestNameUpper')?.checked ?? false;

  /* Məhsul / Cəm */
  data.itemFontSize  = document.getElementById('tplItemFontSize')?.value  || 'normal';
  data.itemNameBold  = document.getElementById('tplItemNameBold')?.checked ?? false;
  data.totalFontSize = document.getElementById('tplTotalFontSize')?.value  || 'large';
  data.totalBold     = document.getElementById('tplTotalBold')?.checked    ?? true;
  data.totalUpper    = document.getElementById('tplTotalUpper')?.checked   ?? true;

  /* Footer */
  data.footerMessage  = document.getElementById('tplFooterMessage')?.value.trim() || '';
  data.footerFontSize = document.getElementById('tplFooterFontSize')?.value || 'small';
  data.footerAlign    = document.getElementById('tplFooterAlign')?.value    || 'center';

  Promise.all([
    db.ref('settings/receiptTemplate').set(data),
    db.ref('settings/restaurantName').set(name),
    db.ref('settings/restaurantAddress').set(addr),
    db.ref('settings/restaurantPhone').set(phone)
  ]).then(() => {
    _tplCacheInvalidate();
    const el = document.getElementById('tplSaveStatus');
    if (el) { el.textContent = '✓ Saxlanıldı'; setTimeout(() => el.textContent = '', 2000); }
  });
}

export function saveKitchenTemplate() {
  const data = {};
  document.querySelectorAll('input[name="tpl_field"]').forEach(cb => {
    if (cb.value.startsWith('kitchen')) data[cb.value] = cb.checked;
  });
  data.kitchenStationSize = document.getElementById('kTplStationSize')?.value || 'xlarge';
  data.kitchenTableSize   = document.getElementById('kTplTableSize')?.value   || 'xlarge';
  data.kitchenItemSize    = document.getElementById('kTplItemSize')?.value    || 'large';
  data.kitchenQtySize     = document.getElementById('kTplQtySize')?.value     || 'xlarge';
  data.kitchenBottomLines = parseInt(document.getElementById('kTplBottomLines')?.value) || 4;

  db.ref('settings/kitchenTemplate').set(data).then(() => {
    const el = document.getElementById('kTplSaveStatus');
    if (el) { el.textContent = '✓ Saxlanıldı'; setTimeout(() => el.textContent = '', 2000); }
  });
}

/* ── Logo upload ── */
export function uploadReceiptLogo() {
  const file = document.getElementById('tplLogoFile')?.files[0];
  if (!file) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Fayl seçin'); return; }
  if (file.size > 200 * 1024) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Logo 200KB-dan kiçik olmalıdır'); return; }

  const reader = new FileReader();
  reader.onload = e => {
    db.ref('settings/restaurantLogo').set(e.target.result).then(() => {
      _tplCacheInvalidate();
      const el = document.getElementById('tplLogoStatus');
      if (el) { el.textContent = '✓ Logo yükləndi'; setTimeout(() => el.textContent = '', 2000); }
      renderReceiptTemplateSettings(); /* Refresh to show new logo */
    });
  };
  reader.readAsDataURL(file);
}

export function removeReceiptLogo() {
  if (!confirm('Loqonu silmək istəyirsiniz?')) return;
  db.ref('settings/restaurantLogo').remove().then(() => {
    _tplCacheInvalidate();
    renderReceiptTemplateSettings();
  });
}

/* Cache-i sıfırla (printer-service.js-dəki cache) */
function _tplCacheInvalidate() {
  /* printer-service.js öz cache-ini 30 san sonra yeniləyir, bu kifayətdir */
}
