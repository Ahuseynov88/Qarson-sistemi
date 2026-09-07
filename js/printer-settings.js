/* ═══════════════════════════════════════════
   PRINTER SETTINGS
   Admin → Printerlər bölməsi
═══════════════════════════════════════════ */
import { R, db } from './firebase-service.js';
import { state } from './state.js';
import { esc, showToast } from './utils.js';
import { testPrintReceipt } from './printer-service.js';

const PRINTER_TYPES = [
  { value: 'receipt', label: '🧾 Hesab printeri' },
  { value: 'kitchen', label: '🍳 Mətbəx / Bar / Digər' }
];

const PAPER_WIDTHS = [
  { value: '58mm', label: '58mm' },
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
  const modal = document.getElementById('printerModal');
  document.getElementById('printerType').innerHTML  = PRINTER_TYPES.map(t => `<option value="${t.value}">${t.label}</option>`).join('');
  document.getElementById('printerPaper').innerHTML = PAPER_WIDTHS.map(w => `<option value="${w.value}">${w.label}</option>`).join('');

  if (printerId) {
    const p = (state.printers || []).find(x => x.id === printerId);
    if (!p) return;
    document.getElementById('printerModalTitle').textContent = 'Printeri Redaktə Et';
    document.getElementById('printerName').value  = p.name       || '';
    document.getElementById('printerType').value  = p.type       || 'kitchen';
    document.getElementById('printerPaper').value = p.paperWidth || '80mm';
    document.getElementById('printerIp').value    = p.ip         || '';
    document.getElementById('printerPort').value  = p.port       || 9100;
    document.getElementById('printerActive').checked = !!p.active;
    modal.dataset.editId = printerId;
  } else {
    document.getElementById('printerModalTitle').textContent = 'Yeni Printer';
    document.getElementById('printerName').value  = '';
    document.getElementById('printerType').value  = 'kitchen';
    document.getElementById('printerPaper').value = '80mm';
    document.getElementById('printerIp').value    = '';
    document.getElementById('printerPort').value  = 9100;
    document.getElementById('printerActive').checked = true;
    delete modal.dataset.editId;
  }

  _updatePrinterModalCats(printerId);
  _toggleReceiptFields();
  modal.classList.add('open');
}

export function _toggleReceiptFields() {
  const type = document.getElementById('printerType')?.value;
  const wrap = document.getElementById('printerCatWrap');
  if (wrap) wrap.style.display = type === 'receipt' ? 'none' : 'block';
}

function _updatePrinterModalCats(printerId = null) {
  const wrap = document.getElementById('printerCatList');
  if (!wrap) return;
  const allCats = [...new Set((state.menuItems || []).map(m => m.category || 'Digər').filter(Boolean))].sort();
  const saved   = printerId ? ((state.printers||[]).find(p=>p.id===printerId)?.categories || []) : [];
  if (!allCats.length) {
    wrap.innerHTML = '<p style="font-size:12px;color:var(--text3);">Menyu kateqoriyası tapılmadı.</p>';
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
   HESAB ÇEKİ ŞABLONU — tam UI
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
  const s   = tplSnap.val() || {};
  const v   = (key, def) => s[key] !== undefined ? s[key] : def;
  const chk = (key, def = true) => v(key, def) ? 'checked' : '';
  const sel = (key, opt, def) => v(key, def) === opt ? 'selected' : '';
  const logoUrl = logoSnap.val() || '';

  // Font sahəsi: siyahıdan seçilə bilər və ya Windows-da quraşdırılmış font adı əl ilə yazıla bilər.
  const fontInput = (id, key, def = 'Arial') => `
    <input type="text" id="${id}" list="receiptFontList" value="${esc(v(key,def))}"
      placeholder="Məs: Cinzel Decorative" autocomplete="off">`;

  const fontList = `
    <datalist id="receiptFontList">
      <option value="Arial"></option>
      <option value="Segoe UI"></option>
      <option value="Georgia"></option>
      <option value="Times New Roman"></option>
      <option value="Courier New"></option>
      <option value="Verdana"></option>
      <option value="Tahoma"></option>
      <option value="Trebuchet MS"></option>
      <option value="Calibri"></option>
      <option value="Cambria"></option>
      <option value="Garamond"></option>
      <option value="Cinzel"></option>
      <option value="Cinzel Decorative"></option>
    </datalist>`;

  container.innerHTML = `
    <h3 style="margin-bottom:20px;font-size:16px;">
      <svg class="icon"><use href="#i-printer"></use></svg> Hesab Çeki Şablonu
    </h3>
    ${fontList}

    <!-- ═══ BÖLMƏ 1: OBYEKTİN MƏLUMATLARI ═══ -->
    ${_section('🏢 1. Obyektin Məlumatları')}
    <div class="form-group">
      <label>Restoran / Obyekt adı</label>
      <input type="text" id="tplRestName" value="${esc(nameSnap.val()||'')}" placeholder="Məs: Ənənə Restoran">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Ad font ölçüsü</label>
        <select id="tplRestNameSize">
          <option value="normal" ${sel('restaurantNameSize','normal','large')}>Normal</option>
          <option value="large"  ${sel('restaurantNameSize','large','large')}>Böyük</option>
          <option value="xlarge" ${sel('restaurantNameSize','xlarge','large')}>Çox böyük</option>
        </select>
      </div>
      <div class="form-group">
        <label>Restoran adı fontu</label>
        ${fontInput('tplRestNameFont','restaurantNameFont','Arial')}
        <small style="color:var(--text3);font-size:11px;">Siyahıdan seçin və ya font adını özünüz yazın.</small>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Hizalanma</label>
        <select id="tplRestNameAlign">
          <option value="left"   ${sel('restaurantNameAlign','left','center')}>Sol</option>
          <option value="center" ${sel('restaurantNameAlign','center','center')}>Mərkəz</option>
          <option value="right"  ${sel('restaurantNameAlign','right','center')}>Sağ</option>
        </select>
      </div>
    </div>
    <div style="display:flex;gap:16px;margin-bottom:14px;flex-wrap:wrap;">
      ${_toggle('tplRestNameBold',  chk('restaurantNameBold',true),  'Qalın (bold)')}
      ${_toggle('tplRestNameUpper', chk('restaurantNameUpper',false), 'Böyük hərf')}
    </div>
    <div class="form-group">
      <label>Ünvan</label>
      <input type="text" id="tplRestAddr" value="${esc(addrSnap.val()||'')}" placeholder="Naxçıvan, Heydər Əliyev pr. 1">
    </div>
    <div class="form-group">
      <label>Əlaqə nömrəsi</label>
      <input type="text" id="tplRestPhone" value="${esc(phoneSnap.val()||'')}" placeholder="+994 XX XXX XX XX">
    </div>

    <!-- Logo -->
    <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;margin:4px 0 8px;">Logo</div>
    ${logoUrl ? `<div style="margin-bottom:10px;"><img src="${esc(logoUrl)}" style="max-height:60px;max-width:160px;object-fit:contain;border-radius:6px;border:1px solid var(--border);padding:6px;background:var(--card2);display:block;"></div>` : ''}
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px;flex-wrap:wrap;">
      <input type="file" id="tplLogoFile" accept="image/png,image/jpeg,image/gif" style="font-size:12px;flex:1;">
      <button class="btn btn-blue" onclick="uploadReceiptLogo()" style="padding:8px 14px;font-size:12px;white-space:nowrap;">Yüklə</button>
      ${logoUrl ? `<button class="btn btn-ghost" onclick="removeReceiptLogo()" style="padding:8px 12px;font-size:12px;color:var(--red);">Sil</button>` : ''}
    </div>
    <p style="font-size:11px;color:var(--text3);margin-bottom:4px;">Maksimum 200KB. PNG və ya JPEG.</p>
    <p id="tplLogoStatus" style="font-size:12px;color:var(--green);min-height:16px;"></p>

    <!-- Çekdə göstərilsin mi? -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0;">
      ${_chkField('logo',          'Logo göstər',    chk('logo'))}
      ${_chkField('restaurantName','Restoran adı',   chk('restaurantName'))}
      ${_chkField('address',       'Ünvan',          chk('address'))}
      ${_chkField('phone',         'Telefon',        chk('phone',false))}
    </div>
    <div class="form-group">
      <label>Ünvan / telefon fontu</label>
      ${fontInput('tplHeaderInfoFont','headerInfoFont','Arial')}
    </div>

    <!-- ═══ BÖLMƏ 2: TARİX / SAAT ═══ -->
    ${_section('🕐 2. Tarix və Saat')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;">
      ${_chkField('datetime','Tarix / Saat göstər', chk('datetime'))}
    </div>

    <!-- ═══ BÖLMƏ 3: MASA / QARSON / MÜŞTƏRİ ═══ -->
    ${_section('👤 3. Masa, Qarson və Müştəri')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;">
      ${_chkField('table',        'Masa adı',        chk('table'))}
      ${_chkField('waiter',       'Qarson adı',      chk('waiter'))}
      ${_chkField('customerName', 'Müştəri adı',     chk('customerName',false))}
    </div>
    <div class="form-group">
      <label>Tarix / Masa / Qarson / Müştəri fontu</label>
      ${fontInput('tplInfoFont','infoFont','Arial')}
    </div>

    <!-- ═══ BÖLMƏ 4: MƏHSULLAR ═══ -->
    ${_section('🍽 4. Məhsul Siyahısı')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;">
      ${_chkField('itemName',  'Məhsul adı',     chk('itemName'))}
      ${_chkField('itemQty',   'Miqdar',         chk('itemQty'))}
      ${_chkField('itemPrice', 'Vahid qiymət',   chk('itemPrice',false))}
      ${_chkField('lineTotal', 'Sətir cəmi',     chk('lineTotal'))}
      ${_chkField('itemNote',  'Məhsul qeydi',    chk('itemNote',true))}
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Məhsul adı yazı fontu</label>
        ${fontInput('tplItemFont','itemFont','Arial')}
      </div>
      <div class="form-group">
        <label>Miqdar / Qiymət / Məbləğ fontu</label>
        ${fontInput('tplNumberFont','numberFont','Arial')}
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Məhsul adı font ölçüsü</label>
        <select id="tplItemFontSize">
          <option value="small"  ${sel('itemFontSize','small','normal')}>Kiçik</option>
          <option value="normal" ${sel('itemFontSize','normal','normal')}>Normal</option>
          <option value="large"  ${sel('itemFontSize','large','normal')}>Böyük</option>
        </select>
      </div>
      <div class="form-group">
        <label>&nbsp;</label>
        ${_toggle('tplItemNameBold', chk('itemNameBold',false), 'Məhsul adı qalın')}
      </div>
    </div>

    <!-- ═══ BÖLMƏ 5: MALİYYƏ ═══ -->
    ${_section('💰 5. Maliyyə Məlumatları')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;">
      ${_chkField('discount',      'Endirim sətri',      chk('discount'))}
      ${_chkField('serviceCharge', 'Xidmət haqqı',       chk('serviceCharge'))}
      ${_chkField('vat',           'ƏDV',                chk('vat',false))}
      ${_chkField('totalAmount',   'Yekun məbləğ',       chk('totalAmount'))}
      ${_chkField('paymentType',   'Ödəniş növü',        chk('paymentType',false))}
    </div>
    <div class="form-group">
      <label>ƏDV faizi (%) — 0 = ƏDV yoxdur</label>
      <input type="number" id="tplVatPercent" value="${v('vatPercent',0)}" min="0" max="100" placeholder="0">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Valyuta</label>
        <select id="tplCurrency">
          <option value="AZN" ${sel('currency','AZN','AZN')}>AZN</option>
          <option value="₼"   ${sel('currency','₼','AZN')}>₼</option>
          <option value="$"   ${sel('currency','$','AZN')}>$</option>
          <option value="€"   ${sel('currency','€','AZN')}>€</option>
        </select>
      </div>
      <div class="form-group">
        <label>Yekun məbləğ font</label>
        <select id="tplTotalFontSize">
          <option value="normal" ${sel('totalFontSize','normal','large')}>Normal</option>
          <option value="large"  ${sel('totalFontSize','large','large')}>Böyük</option>
          <option value="xlarge" ${sel('totalFontSize','xlarge','large')}>Çox böyük</option>
        </select>
      </div>
    </div>
    <div class="form-group">
      <label>Yekun / maliyyə hissəsi fontu</label>
      ${fontInput('tplTotalFont','totalFont','Arial')}
    </div>
    <div style="display:flex;gap:16px;margin-bottom:14px;flex-wrap:wrap;">
      ${_toggle('tplTotalBold',  chk('totalBold',true),  'Yekun qalın')}
      ${_toggle('tplTotalUpper', chk('totalUpper',true), 'Yekun böyük hərf')}
    </div>

    <!-- ═══ BÖLMƏ 6: FOOTER ═══ -->
    ${_section('📝 6. Footer Mesajı')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
      ${_chkField('footer','Footer mesajı göstər', chk('footer'))}
    </div>
    <div class="form-group">
      <label>Footer mətni</label>
      <input type="text" id="tplFooterMessage" value="${esc(v('footerMessage','Təşəkkür edirik!'))}" placeholder="Təşəkkür edirik! Yenidən gəlin.">
    </div>
    <div class="form-group">
      <label>Footer yazı fontu</label>
      ${fontInput('tplFooterFont','footerFont','Arial')}
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Font ölçüsü</label>
        <select id="tplFooterFontSize">
          <option value="small"  ${sel('footerFontSize','small','small')}>Kiçik</option>
          <option value="normal" ${sel('footerFontSize','normal','small')}>Normal</option>
          <option value="large"  ${sel('footerFontSize','large','small')}>Böyük</option>
        </select>
      </div>
      <div class="form-group">
        <label>Hizalanma</label>
        <select id="tplFooterAlign">
          <option value="left"   ${sel('footerAlign','left','center')}>Sol</option>
          <option value="center" ${sel('footerAlign','center','center')}>Mərkəz</option>
          <option value="right"  ${sel('footerAlign','right','center')}>Sağ</option>
        </select>
      </div>
    </div>

    <!-- ═══ FORMAT AYARLARI ═══ -->
    ${_section('⚙️ Format Ayarları')}
    <div class="form-row">
      <div class="form-group">
        <label>Kağız eni</label>
        <select id="tplPaperWidth">
          <option value="58mm" ${sel('paperWidth','58mm','80mm')}>58mm</option>
          <option value="80mm" ${sel('paperWidth','80mm','80mm')}>80mm (standart)</option>
        </select>
      </div>
      <div class="form-group">
        <label>Ayırıcı xətt</label>
        <select id="tplDivider">
          <option value="dash"  ${sel('dividerType','dash','dash')}>Tire  (--------)</option>
          <option value="star"  ${sel('dividerType','star','dash')}>Ulduz (********)</option>
          <option value="equal" ${sel('dividerType','equal','dash')}>Bərabər (========)</option>
          <option value="none"  ${sel('dividerType','none','dash')}>Yoxdur</option>
        </select>
      </div>
    </div>
    <div class="form-group">
      <label>Çek sonunda boş sətir sayı (kağızı kəsmək üçün)</label>
      <input type="number" id="tplBottomLines" value="${v('bottomLines',5)}" min="0" max="15">
    </div>

    <!-- Saxla düyməsi -->
    <button class="btn btn-green" onclick="saveReceiptTemplate()" style="width:100%;padding:14px;margin-top:8px;font-size:15px;">
      <svg class="icon"><use href="#i-save"></use></svg> Hesab Çeki Şablonunu Saxla
    </button>
    <p id="tplSaveStatus" style="font-size:12px;color:var(--green);margin-top:8px;min-height:16px;text-align:center;"></p>

    <!-- ═══ MƏTBƏx ÇEKİ ═══ -->
    <div style="border-top:2px solid var(--border);margin:28px 0 20px;padding-top:20px;">
      <h3 style="margin-bottom:16px;font-size:16px;">
        🍳 Mətbəx / Bar Çeki Şablonu
      </h3>
      <p style="font-size:13px;color:var(--text2);margin-bottom:16px;">
        Sifariş gedəndə mətbəx/bar printerindən çıxan çekin görünüşü.
      </p>
      <div id="kitchenTemplateSettings"></div>
    </div>
  `;

  renderKitchenTemplateSettings();
}

function _section(title) {
  return `<div style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;
    letter-spacing:.04em;margin:20px 0 12px;padding:8px 12px;background:var(--card2);
    border-radius:8px;border-left:3px solid var(--blue);">${title}</div>`;
}

function _chkField(key, label, checkedAttr) {
  return `<label style="display:flex;align-items:center;gap:8px;padding:9px 12px;border-radius:8px;
    background:var(--card2);border:1px solid var(--border);cursor:pointer;font-size:13px;user-select:none;">
    <input type="checkbox" name="tpl_field" value="${key}" ${checkedAttr}
      style="width:17px;height:17px;accent-color:var(--green);flex-shrink:0;cursor:pointer;">
    ${label}
  </label>`;
}

function _toggle(id, checkedAttr, label) {
  return `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;user-select:none;">
    <input type="checkbox" id="${id}" ${checkedAttr}
      style="width:17px;height:17px;accent-color:var(--green);cursor:pointer;">
    ${label}
  </label>`;
}

/* ── Mətbəx çeki şablonu ── */
async function renderKitchenTemplateSettings() {
  const wrap = document.getElementById('kitchenTemplateSettings');
  if (!wrap) return;
  const snap = await db.ref('settings/kitchenTemplate').once('value');
  const s = snap.val() || {};
  const v   = (key, def) => s[key] !== undefined ? s[key] : def;
  const chk = (key, def = true) => v(key, def) ? 'checked' : '';
  const sel = (key, opt, def) => v(key, def) === opt ? 'selected' : '';

  wrap.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;">
      ${_chkField('kitchenStationName','Stansiya / Printer adı', chk('kitchenStationName'))}
      ${_chkField('kitchenTable',      'Masa adı',               chk('kitchenTable'))}
      ${_chkField('kitchenDatetime',   'Tarix / Saat',           chk('kitchenDatetime'))}
      ${_chkField('kitchenWaiter',     'Qarson adı',             chk('kitchenWaiter'))}
      ${_chkField('kitchenNote',       'Ümumi sifariş qeydi',    chk('kitchenNote'))}
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Mal adı font</label>
        <select id="kTplItemSize">
          <option value="normal" ${sel('kitchenItemSize','normal','large')}>Normal</option>
          <option value="large"  ${sel('kitchenItemSize','large','large')}>Böyük</option>
          <option value="xlarge" ${sel('kitchenItemSize','xlarge','large')}>Çox böyük</option>
        </select>
      </div>
      <div class="form-group">
        <label>Çek sonunda boş sətir</label>
        <input type="number" id="kTplBottomLines" value="${v('kitchenBottomLines',5)}" min="0" max="15">
      </div>
    </div>
    <button class="btn btn-green" onclick="saveKitchenTemplate()" style="width:100%;padding:13px;">
      <svg class="icon"><use href="#i-save"></use></svg> Mətbəx Şablonunu Saxla
    </button>
    <p id="kTplSaveStatus" style="font-size:12px;color:var(--green);margin-top:8px;min-height:16px;text-align:center;"></p>
  `;
}

/* ── Saxlama ── */
export function saveReceiptTemplate() {
  const data = {};

  // Bütün checkbox-ları yığ
  document.querySelectorAll('input[name="tpl_field"]').forEach(cb => {
    data[cb.value] = cb.checked;
  });

  // Restoran məlumatları
  const restName  = document.getElementById('tplRestName')?.value.trim()  || '';
  const restAddr  = document.getElementById('tplRestAddr')?.value.trim()  || '';
  const restPhone = document.getElementById('tplRestPhone')?.value.trim() || '';

  // Format
  data.paperWidth         = document.getElementById('tplPaperWidth')?.value    || '80mm';
  data.dividerType        = document.getElementById('tplDivider')?.value       || 'dash';
  data.bottomLines        = parseInt(document.getElementById('tplBottomLines')?.value) || 5;
  data.currency           = document.getElementById('tplCurrency')?.value      || 'AZN';
  data.vatPercent         = parseFloat(document.getElementById('tplVatPercent')?.value) || 0;

  // Stil
  data.restaurantNameSize  = document.getElementById('tplRestNameSize')?.value  || 'large';
  data.restaurantNameFont  = document.getElementById('tplRestNameFont')?.value.trim() || 'Arial';
  data.headerInfoFont      = document.getElementById('tplHeaderInfoFont')?.value.trim() || 'Arial';
  data.infoFont            = document.getElementById('tplInfoFont')?.value.trim() || 'Arial';
  data.restaurantNameAlign = document.getElementById('tplRestNameAlign')?.value || 'center';
  data.restaurantNameBold  = document.getElementById('tplRestNameBold')?.checked  ?? true;
  data.restaurantNameUpper = document.getElementById('tplRestNameUpper')?.checked ?? false;
  data.itemFont            = document.getElementById('tplItemFont')?.value.trim() || 'Arial';
  data.numberFont          = document.getElementById('tplNumberFont')?.value.trim() || 'Arial';
  data.itemFontSize        = document.getElementById('tplItemFontSize')?.value  || 'normal';
  data.itemNameBold        = document.getElementById('tplItemNameBold')?.checked ?? false;
  data.totalFont           = document.getElementById('tplTotalFont')?.value.trim() || 'Arial';
  data.totalFontSize       = document.getElementById('tplTotalFontSize')?.value  || 'large';
  data.totalBold           = document.getElementById('tplTotalBold')?.checked    ?? true;
  data.totalUpper          = document.getElementById('tplTotalUpper')?.checked   ?? true;

  // Footer
  data.footerMessage  = document.getElementById('tplFooterMessage')?.value.trim() || '';
  data.footerFont     = document.getElementById('tplFooterFont')?.value.trim() || 'Arial';
  data.footerFontSize = document.getElementById('tplFooterFontSize')?.value || 'small';
  data.footerAlign    = document.getElementById('tplFooterAlign')?.value    || 'center';

  Promise.all([
    db.ref('settings/receiptTemplate').set(data),
    db.ref('settings/restaurantName').set(restName),
    db.ref('settings/restaurantAddress').set(restAddr),
    db.ref('settings/restaurantPhone').set(restPhone)
  ]).then(() => {
    const el = document.getElementById('tplSaveStatus');
    if (el) { el.textContent = '✓ Şablon saxlanıldı'; setTimeout(() => el.textContent = '', 3000); }
    showToast('<svg class="icon"><use href="#i-check"></use></svg> Hesab çeki şablonu saxlanıldı');
  });
}

export function saveKitchenTemplate() {
  const data = {};
  document.querySelectorAll('input[name="tpl_field"]').forEach(cb => {
    if (cb.value.startsWith('kitchen')) data[cb.value] = cb.checked;
  });
  data.kitchenItemSize    = document.getElementById('kTplItemSize')?.value    || 'large';
  data.kitchenBottomLines = parseInt(document.getElementById('kTplBottomLines')?.value) || 5;

  db.ref('settings/kitchenTemplate').set(data).then(() => {
    const el = document.getElementById('kTplSaveStatus');
    if (el) { el.textContent = '✓ Saxlanıldı'; setTimeout(() => el.textContent = '', 3000); }
    showToast('<svg class="icon"><use href="#i-check"></use></svg> Mətbəx şablonu saxlanıldı');
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
      const el = document.getElementById('tplLogoStatus');
      if (el) { el.textContent = '✓ Logo yükləndi'; setTimeout(() => el.textContent = '', 2000); }
      renderReceiptTemplateSettings();
    });
  };
  reader.readAsDataURL(file);
}

export function removeReceiptLogo() {
  if (!confirm('Loqonu silmək istəyirsiniz?')) return;
  db.ref('settings/restaurantLogo').remove().then(() => renderReceiptTemplateSettings());
}
