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

  const [tplSnap, nameSnap, addrSnap, phoneSnap, logoSnap, agentsSnap] = await Promise.all([
    db.ref('settings/receiptTemplate').once('value'),
    db.ref('settings/restaurantName').once('value'),
    db.ref('settings/restaurantAddress').once('value'),
    db.ref('settings/restaurantPhone').once('value'),
    db.ref('settings/restaurantLogo').once('value'),
    db.ref('printerAgents').once('value')
  ]);
  const s = tplSnap.val() || {};
  const v=(k,d)=>s[k]!==undefined?s[k]:d;
  const chk=(k,d=true)=>v(k,d)?'checked':'';
  const sel=(k,o,d)=>v(k,d)===o?'selected':'';
  const logoUrl=logoSnap.val()||'';

  const defaults=['Arial','Calibri','Cambria','Cinzel','Cinzel Decorative','Courier New','Garamond','Georgia','Segoe UI','Tahoma','Times New Roman','Trebuchet MS','Verdana'];
  const agentData=agentsSnap.val()||{};
  const detected=[];
  Object.values(agentData).forEach(a=>{ if(Array.isArray(a?.fonts)) detected.push(...a.fonts); });
  const fonts=[...new Set([...defaults,...detected].map(x=>String(x||'').trim()).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b,'az',{sensitivity:'base'}));
  const fontList=`<datalist id="receiptFontList">${fonts.map(f=>`<option value="${esc(f)}"></option>`).join('')}</datalist>`;
  const fontInput=(id,key,def='Arial')=>`<input type="text" id="${id}" list="receiptFontList" value="${esc(v(key,def))}" placeholder="Windows font adı" autocomplete="off">`;
  const sizeSel=(id,key,def='normal')=>`<select id="${id}">
    <option value="small" ${sel(key,'small',def)}>Kiçik</option><option value="normal" ${sel(key,'normal',def)}>Normal</option>
    <option value="large" ${sel(key,'large',def)}>Böyük</option><option value="xlarge" ${sel(key,'xlarge',def)}>Çox böyük</option></select>`;
  const alignSel=(id,key,def='left')=>`<select id="${id}"><option value="left" ${sel(key,'left',def)}>Sol</option><option value="center" ${sel(key,'center',def)}>Mərkəz</option><option value="right" ${sel(key,'right',def)}>Sağ</option></select>`;

  container.innerHTML=`
  <h3 style="margin-bottom:16px;font-size:16px;"><svg class="icon"><use href="#i-printer"></use></svg> Hesab Çeki Şablonu</h3>
  ${fontList}
  <p style="font-size:12px;color:var(--text2);margin-bottom:14px;">Font siyahısı Print Agent-in Windows-da aşkarladığı fontlardan gəlir və əlifba sırası ilə göstərilir. Yeni font quraşdırdıqdan sonra agent açıqdırsa siyahı avtomatik yenilənəcək.</p>

  ${_section('🏢 1. BAŞLIQ — Obyekt məlumatları')}
  <div class="form-group"><label>Restoran / Obyekt adı</label><input id="tplRestName" value="${esc(nameSnap.val()||'')}"></div>
  <div class="form-group"><label>Ünvan</label><input id="tplRestAddr" value="${esc(addrSnap.val()||'')}"></div>
  <div class="form-group"><label>Telefon</label><input id="tplRestPhone" value="${esc(phoneSnap.val()||'')}"></div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0;">
    ${_chkField('logo','Logo göstər',chk('logo'))}${_chkField('restaurantName','Restoran adı',chk('restaurantName'))}
    ${_chkField('address','Ünvan',chk('address'))}${_chkField('phone','Telefon',chk('phone',false))}
  </div>
  ${logoUrl?`<img src="${esc(logoUrl)}" style="max-height:55px;max-width:150px;margin:6px 0;">`:''}
  <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap;"><input type="file" id="tplLogoFile" accept="image/png,image/jpeg"><button class="btn btn-blue" onclick="uploadReceiptLogo()">Logo yüklə</button>${logoUrl?`<button class="btn btn-ghost" onclick="removeReceiptLogo()">Sil</button>`:''}</div>
  <div class="form-row"><div class="form-group"><label>Yalnız obyekt adının fontu</label>${fontInput('tplRestNameFont','restaurantNameFont',v('headerFont','Arial'))}</div><div class="form-group"><label>Yalnız obyekt adının ölçüsü</label>${sizeSel('tplRestNameSize','restaurantNameFontSize',v('headerFontSize','large'))}</div></div>
  <div class="form-row"><div class="form-group"><label>Obyekt adının hizalanması</label>${alignSel('tplRestNameAlign','restaurantNameAlign',v('headerAlign','center'))}</div><div class="form-group"><label>&nbsp;</label>${_toggle('tplRestNameBold',chk('restaurantNameBold',v('headerBold',true)),'Obyekt adı qalın')}</div></div>
  <p style="font-size:11px;color:var(--text3);margin:-4px 0 8px;">Ünvan və telefon aşağıdakı “Hesab məlumatları” bölməsinin font, ölçü və qalınlığını istifadə edir. Hizalanması isə ayrıca seçilir.</p>
  <div class="form-row"><div class="form-group"><label>Ünvan / telefon hizalanması</label>${alignSel('tplContactAlign','contactAlign','center')}</div><div class="form-group"><label>&nbsp;</label>${_toggle('tplRestNameUpper',chk('restaurantNameUpper',false),'Restoran adını böyük hərflə')}</div></div>

  ${_section('👤 2. HESAB MƏLUMATLARI — Tarix, saat, masa, ofisiant, müştəri')}
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
    ${_chkField('datetime','Tarix / Saat',chk('datetime'))}${_chkField('table','Masa',chk('table'))}
    ${_chkField('waiter','Ofisiant',chk('waiter'))}${_chkField('customerName','Müştəri',chk('customerName',false))}
  </div>
  <div class="form-row"><div class="form-group"><label>Bölmə fontu</label>${fontInput('tplInfoFont','infoFont','Arial')}</div><div class="form-group"><label>Bölmə ölçüsü</label>${sizeSel('tplInfoSize','infoFontSize','normal')}</div></div>
  <div class="form-row"><div class="form-group"><label>Hizalanma</label>${alignSel('tplInfoAlign','infoAlign','left')}</div><div class="form-group"><label>&nbsp;</label>${_toggle('tplInfoBold',chk('infoBold',false),'Məlumatlar qalın')}</div></div>

  ${_section('🍽 3. MƏHSULLAR VƏ YEKUN')}
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
    ${_chkField('itemName','Məhsul adı',chk('itemName'))}${_chkField('itemQty','Miqdar',chk('itemQty'))}
    ${_chkField('itemPrice','Vahid qiymət',chk('itemPrice',false))}${_chkField('lineTotal','Məbləğ',chk('lineTotal'))}
    ${_chkField('itemNote','Məhsul qeydi',chk('itemNote',true))}${_chkField('discount','Endirim',chk('discount'))}
    ${_chkField('serviceCharge','Xidmət haqqı',chk('serviceCharge'))}${_chkField('vat','ƏDV',chk('vat',false))}
    ${_chkField('totalAmount','Yekun məbləğ',chk('totalAmount'))}${_chkField('paymentType','Ödəniş növü',chk('paymentType',false))}
  </div>
  <div class="form-row"><div class="form-group"><label>Məhsul bölməsi fontu</label>${fontInput('tplProductFont','productFont',v('itemFont','Arial'))}</div><div class="form-group"><label>Məhsul bölməsi ölçüsü</label>${sizeSel('tplProductSize','productFontSize',v('itemFontSize','normal'))}</div></div>
  <div class="form-row"><div class="form-group"><label>Məhsul hizalanması</label>${alignSel('tplProductAlign','productAlign','left')}</div><div class="form-group"><label>&nbsp;</label>${_toggle('tplProductBold',chk('productBold',false),'Məhsul yazıları qalın')}</div></div>
  <div class="form-row"><div class="form-group"><label>Yekun məbləğ ölçüsü</label>${sizeSel('tplTotalFontSize','totalFontSize','large')}</div><div class="form-group"><label>Valyuta</label><select id="tplCurrency"><option value="AZN" ${sel('currency','AZN','AZN')}>AZN</option><option value="₼" ${sel('currency','₼','AZN')}>₼</option><option value="$" ${sel('currency','$','AZN')}>$</option><option value="€" ${sel('currency','€','AZN')}>€</option></select></div></div>
  <div class="form-group"><label>ƏDV faizi (%)</label><input type="number" id="tplVatPercent" value="${v('vatPercent',0)}" min="0" max="100"></div>
  <div style="display:flex;gap:16px;margin-bottom:12px;">${_toggle('tplTotalBold',chk('totalBold',true),'Yekun qalın')}${_toggle('tplTotalUpper',chk('totalUpper',true),'Yekun böyük hərf')}</div>

  ${_section('📝 4. FOOTER')}
  <div style="margin-bottom:10px;">${_chkField('footer','Footer göstər',chk('footer'))}</div>
  <div class="form-group"><label>Footer mətni — Enter ilə yeni sətir yarada bilərsiniz</label><textarea id="tplFooterMessage" rows="4" style="width:100%;resize:vertical;">${esc(v('footerMessage','Təşəkkür edirik!'))}</textarea></div>
  <div class="form-row"><div class="form-group"><label>Footer fontu</label>${fontInput('tplFooterFont','footerFont','Arial')}</div><div class="form-group"><label>Footer ölçüsü</label>${sizeSel('tplFooterSize','footerFontSize','small')}</div></div>
  <div class="form-row"><div class="form-group"><label>Footer hizalanması</label>${alignSel('tplFooterAlign','footerAlign','center')}</div><div class="form-group"><label>&nbsp;</label>${_toggle('tplFooterBold',chk('footerBold',false),'Footer qalın')}</div></div>

  ${_section('⚙️ Ümumi çap ayarları')}
  <div class="form-row"><div class="form-group"><label>Kağız eni</label><select id="tplPaperWidth"><option value="58mm" ${sel('paperWidth','58mm','80mm')}>58mm</option><option value="80mm" ${sel('paperWidth','80mm','80mm')}>80mm</option></select></div><div class="form-group"><label>Ayırıcı xətt</label><select id="tplDivider"><option value="dash" ${sel('dividerType','dash','dash')}>--------</option><option value="equal" ${sel('dividerType','equal','dash')}>========</option><option value="star" ${sel('dividerType','star','dash')}>********</option><option value="none" ${sel('dividerType','none','dash')}>Yoxdur</option></select></div></div>
  <div class="form-group"><label>Sonda boş sətir sayı</label><input type="number" id="tplBottomLines" value="${v('bottomLines',5)}" min="0" max="15"></div>
  <button class="btn btn-green" onclick="saveReceiptTemplate()" style="width:100%;padding:14px;margin-top:8px;">Hesab Çeki Şablonunu Saxla</button>
  <p id="tplSaveStatus" style="font-size:12px;color:var(--green);margin-top:8px;text-align:center;min-height:16px;"></p>

  <div style="border-top:2px solid var(--border);margin:28px 0 20px;padding-top:20px;"><h3>Mətbəx / Bar Çeki Şablonu</h3><div id="kitchenTemplateSettings"></div></div>`;
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
  const data={};
  document.querySelectorAll('input[name="tpl_field"]').forEach(cb=>{ data[cb.value]=cb.checked; });
  const restName=document.getElementById('tplRestName')?.value.trim()||'';
  const restAddr=document.getElementById('tplRestAddr')?.value.trim()||'';
  const restPhone=document.getElementById('tplRestPhone')?.value.trim()||'';
  data.paperWidth=document.getElementById('tplPaperWidth')?.value||'80mm';
  data.dividerType=document.getElementById('tplDivider')?.value||'dash';
  data.bottomLines=parseInt(document.getElementById('tplBottomLines')?.value)||5;
  data.currency=document.getElementById('tplCurrency')?.value||'AZN';
  data.vatPercent=parseFloat(document.getElementById('tplVatPercent')?.value)||0;

  // Obyekt adı tam ayrıca stil saxlayır. Ünvan/telefon info* ayarlarını istifadə edir.
  data.restaurantNameFont=document.getElementById('tplRestNameFont')?.value.trim()||'Arial';
  data.restaurantNameFontSize=document.getElementById('tplRestNameSize')?.value||'large';
  data.restaurantNameAlign=document.getElementById('tplRestNameAlign')?.value||'center';
  data.restaurantNameBold=document.getElementById('tplRestNameBold')?.checked??true;
  data.restaurantNameUpper=document.getElementById('tplRestNameUpper')?.checked??false;
  data.contactAlign=document.getElementById('tplContactAlign')?.value||'center';

  data.infoFont=document.getElementById('tplInfoFont')?.value.trim()||'Arial';
  data.infoFontSize=document.getElementById('tplInfoSize')?.value||'normal';
  data.infoAlign=document.getElementById('tplInfoAlign')?.value||'left';
  data.infoBold=document.getElementById('tplInfoBold')?.checked??false;

  data.productFont=document.getElementById('tplProductFont')?.value.trim()||'Arial';
  data.productFontSize=document.getElementById('tplProductSize')?.value||'normal';
  data.productAlign=document.getElementById('tplProductAlign')?.value||'left';
  data.productBold=document.getElementById('tplProductBold')?.checked??false;
  data.totalFontSize=document.getElementById('tplTotalFontSize')?.value||'large';
  data.totalBold=document.getElementById('tplTotalBold')?.checked??true;
  data.totalUpper=document.getElementById('tplTotalUpper')?.checked??true;

  data.footerMessage=document.getElementById('tplFooterMessage')?.value||'';
  data.footerFont=document.getElementById('tplFooterFont')?.value.trim()||'Arial';
  data.footerFontSize=document.getElementById('tplFooterSize')?.value||'small';
  data.footerAlign=document.getElementById('tplFooterAlign')?.value||'center';
  data.footerBold=document.getElementById('tplFooterBold')?.checked??false;

  Promise.all([
    db.ref('settings/receiptTemplate').set(data),
    db.ref('settings/restaurantName').set(restName),
    db.ref('settings/restaurantAddress').set(restAddr),
    db.ref('settings/restaurantPhone').set(restPhone)
  ]).then(()=>{
    const el=document.getElementById('tplSaveStatus'); if(el){el.textContent='✓ Şablon saxlanıldı';setTimeout(()=>el.textContent='',3000);}
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
