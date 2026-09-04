/* ═══════════════════════════════════════════
   PRINT TEMPLATE
   Hesab çeki və mətbəx çeki HTML şablonları.
   Bütün format ayarları Firebase-dən gəlir — heç nə hard-code deyil.
═══════════════════════════════════════════ */

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ─── Font ölçüsü çevirmə ─── */
const FONT_SIZE = { small: '11px', normal: '13px', large: '16px', xlarge: '20px' };
const TOTAL_FONT = { small: '14px', normal: '17px', large: '22px', xlarge: '28px' };

function fs(key, map = FONT_SIZE) { return map[key] || map.normal; }

/* ─── Ayırıcı xətt ─── */
function divider(type, paperWidth) {
  const w = paperWidth === '58mm' ? 32 : 48;
  const chars = { dash: '-', star: '*', equal: '=', none: '' };
  const ch = chars[type] || '-';
  if (!ch) return '<div style="margin:8px 0;"></div>';
  return `<div style="font-family:monospace;color:#aaa;margin:6px 0;letter-spacing:1px;">${ch.repeat(w)}</div>`;
}

/* ══════════════════════════════════════════
   MÜŞTƏRİ HESAB ÇEKİ
══════════════════════════════════════════ */
export function buildReceiptHtml({ table, order, waiterName, now, settings = {}, restaurantName, restaurantAddress, restaurantPhone, restaurantLogo }) {
  const s = settings;
  const show  = (key, def = true) => (s[key] === undefined ? def : !!s[key]);
  const val   = (key, def = '')   => (s[key] !== undefined ? s[key] : def);
  const paper = val('paperWidth', '80mm');
  const maxW  = paper === '58mm' ? '220px' : '300px';

  const dateStr = now.toLocaleDateString('az-AZ');
  const timeStr = now.toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit' });
  const items   = order?.items ? Object.values(order.items) : [];
  const total   = order?.total || 0;
  const scAmt   = order?.serviceChargeAmount || 0;
  const scPct   = order?.serviceChargePercent || 0;
  const disc    = order?.discountValue || 0;
  const subtotal = total - scAmt;
  const payType  = order?.paymentType || '';
  const currency = val('currency', '₼');
  const divType  = val('dividerType', 'dash');

  /* ── Başlıq ── */
  let header = '';
  if (show('logo') && restaurantLogo) {
    header += `<div style="text-align:center;margin-bottom:6px;">
      <img src="${esc(restaurantLogo)}" style="max-width:${paper==='58mm'?'80px':'110px'};max-height:70px;object-fit:contain;">
    </div>`;
  }
  if (show('restaurantName') && restaurantName) {
    const rFontSize = fs(val('restaurantNameSize', 'large'));
    const rBold     = val('restaurantNameBold', true)  ? 'bold' : 'normal';
    const rUpper    = val('restaurantNameUpper', false) ? 'uppercase' : 'none';
    const rAlign    = val('restaurantNameAlign', 'center');
    header += `<div style="font-size:${rFontSize};font-weight:${rBold};text-transform:${rUpper};text-align:${rAlign};margin-bottom:3px;">${esc(restaurantName)}</div>`;
  }
  if (show('address') && restaurantAddress) {
    header += `<div style="text-align:center;font-size:10px;color:#555;margin-bottom:2px;">${esc(restaurantAddress)}</div>`;
  }
  if (show('phone') && restaurantPhone) {
    header += `<div style="text-align:center;font-size:10px;color:#555;margin-bottom:2px;">${esc(restaurantPhone)}</div>`;
  }
  if (show('datetime')) {
    header += `<div style="text-align:center;font-size:10px;margin-top:2px;">${dateStr} ${timeStr}</div>`;
  }

  /* ── Masa / Ofisiant ── */
  let info = '';
  if (show('table'))  info += `<div style="font-size:${fs(val('infoSize','normal'))};margin:3px 0;"><b>Masa:</b> ${esc(table?.name || '—')}</div>`;
  if (show('waiter')) info += `<div style="font-size:${fs(val('infoSize','normal'))};margin:3px 0;"><b>Qarson:</b> ${esc(waiterName)}</div>`;

  /* ── Məhsullar ── */
  const itemFontSize = fs(val('itemFontSize', 'normal'));
  const itemBold     = val('itemNameBold', false) ? 'bold' : 'normal';
  const showQty      = show('itemQty');
  const showPrice    = show('itemPrice');
  const showTotal    = show('lineTotal');

  let itemsHtml = '';
  if (items.length) {
    const rows = items.map(it => {
      const lineTotal = (it.price * it.qty * (1 - ((it.discountPercent || 0) / 100))) + (it.extraFee || 0);
      const tag = it.compliment ? ' [İKRAM]' : (it.discountPercent > 0 ? ` [-${it.discountPercent}%]` : '');
      const noteStr = it.note ? `<div style="font-size:9px;color:#777;margin-left:4px;">↳ ${esc(it.note)}</div>` : '';
      let row = `<tr>
        <td style="padding:3px 2px;font-size:${itemFontSize};font-weight:${itemBold};">${esc(it.name)}${tag}</td>`;
      if (showQty)   row += `<td style="text-align:center;padding:3px 2px;font-size:${itemFontSize};">${it.qty}</td>`;
      if (showPrice) row += `<td style="text-align:right;padding:3px 2px;font-size:${itemFontSize};">${it.price.toFixed(2)}</td>`;
      if (showTotal) row += `<td style="text-align:right;padding:3px 2px;font-size:${itemFontSize};font-weight:bold;">${lineTotal.toFixed(2)}</td>`;
      row += `</tr>`;
      if (noteStr) row += `<tr><td colspan="4">${noteStr}</td></tr>`;
      return row;
    }).join('');

    const thQty   = showQty   ? `<th style="text-align:center;padding:2px;">Miq</th>` : '';
    const thPrice = showPrice ? `<th style="text-align:right;padding:2px;">Qiy</th>`  : '';
    const thTotal = showTotal ? `<th style="text-align:right;padding:2px;">Cəm</th>`  : '';
    itemsHtml = `<table style="width:100%;border-collapse:collapse;">
      <tr style="border-bottom:1px dashed #ccc;font-size:10px;color:#666;">
        <th style="text-align:left;padding:2px;">Məhsul</th>${thQty}${thPrice}${thTotal}
      </tr>${rows}
    </table>`;
  }

  /* ── Cəmlər ── */
  const totalFontSize = fs(val('totalFontSize', 'large'), TOTAL_FONT);
  const totalBold     = val('totalBold', true) ? 'bold' : 'normal';
  const totalUpper    = val('totalUpper', true) ? 'uppercase' : 'none';

  let totals = '';
  if (show('discount') && disc > 0) {
    totals += `<div style="display:flex;justify-content:space-between;font-size:11px;margin:2px 0;">
      <span>Endirim:</span><span style="color:#c0392b;">-${disc.toFixed(2)} ${currency}</span></div>`;
  }
  if (show('serviceCharge') && scAmt > 0) {
    totals += `<div style="display:flex;justify-content:space-between;font-size:11px;margin:2px 0;">
      <span>Ara cəm:</span><span>${subtotal.toFixed(2)} ${currency}</span></div>`;
    totals += `<div style="display:flex;justify-content:space-between;font-size:11px;margin:2px 0;">
      <span>Xidmət haqqı (${scPct}%):</span><span>${scAmt.toFixed(2)} ${currency}</span></div>`;
  }
  if (show('totalAmount')) {
    totals += `<div style="display:flex;justify-content:space-between;font-size:${totalFontSize};font-weight:${totalBold};text-transform:${totalUpper};margin-top:6px;padding-top:4px;border-top:2px solid #000;">
      <span>CƏMİ:</span><span>${total.toFixed(2)} ${currency}</span></div>`;
  }
  if (show('paymentType') && payType) {
    const labels = { cash: 'Nağd', pos: 'POS', credit: 'Nisyə', split: 'Bölünmüş' };
    totals += `<div style="display:flex;justify-content:space-between;font-size:10px;color:#666;margin-top:3px;">
      <span>Ödəniş növü:</span><span>${esc(labels[payType] || payType)}</span></div>`;
  }

  /* ── Footer ── */
  let footer = '';
  const footerMsg  = val('footerMessage', 'Təşəkkür edirik!');
  const footerSize = fs(val('footerFontSize', 'small'));
  const footerAlign = val('footerAlign', 'center');
  if (show('footer') && footerMsg) {
    footer = `<div style="text-align:${footerAlign};font-size:${footerSize};margin-top:8px;">${esc(footerMsg)}</div>`;
  }

  /* ── Boş sətir ── */
  const bottomLines = parseInt(val('bottomLines', 3));
  const bottomSpace = '<br>'.repeat(Math.max(0, bottomLines));

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Hesab — ${esc(table?.name || 'Masa')}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'Courier New',monospace;width:${maxW};margin:0 auto;padding:12px 8px;font-size:13px;color:#000;background:#fff;}
  @media print{body{padding:4px 2px;width:100%;}}
</style>
</head><body>
${header}
${header && (info || itemsHtml) ? divider(divType, paper) : ''}
${info}
${info && itemsHtml ? divider(divType, paper) : ''}
${itemsHtml}
${itemsHtml && totals ? divider(divType, paper) : ''}
${totals}
${footer ? divider(divType, paper) : ''}
${footer}
${bottomSpace}
<script>window.onload=()=>{window.print();}<\/script>
</body></html>`;
}

/* ══════════════════════════════════════════
   MƏTBƏx ÇEKİ (sifariş gedəndə)
══════════════════════════════════════════ */
export function buildKitchenHtml({ printerName, tableName, waiterName, items, orderNote, now, settings = {} }) {
  const s       = settings;
  const val     = (key, def) => (s[key] !== undefined ? s[key] : def);
  const show    = (key, def = true) => (s[key] === undefined ? def : !!s[key]);
  const paper   = val('paperWidth', '80mm');
  const maxW    = paper === '58mm' ? '220px' : '300px';
  const divType = val('dividerType', 'dash');

  const dateStr = now.toLocaleDateString('az-AZ');
  const timeStr = now.toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit' });

  /* Başlıq */
  const stationFontSize = fs(val('kitchenStationSize', 'xlarge'), TOTAL_FONT);
  let header = '';
  if (show('kitchenStationName', true)) {
    header += `<div style="text-align:center;font-size:${stationFontSize};font-weight:bold;text-transform:uppercase;letter-spacing:2px;">${esc(printerName)}</div>`;
  }

  /* Masa */
  const tableFontSize = fs(val('kitchenTableSize', 'xlarge'), TOTAL_FONT);
  let tableHtml = '';
  if (show('kitchenTable', true)) {
    tableHtml = `<div style="text-align:center;font-size:${tableFontSize};font-weight:bold;">MASA: ${esc(tableName)}</div>`;
  }

  /* Tarix / Ofisiant */
  let meta = '';
  if (show('kitchenDatetime', true)) meta += `<div style="font-size:11px;color:#555;">${dateStr} ${timeStr}</div>`;
  if (show('kitchenWaiter', true))   meta += `<div style="font-size:11px;color:#555;">Qarson: ${esc(waiterName)}</div>`;

  /* Mallar */
  const itemFontSize = fs(val('kitchenItemSize', 'large'), TOTAL_FONT);
  const qtyFontSize  = fs(val('kitchenQtySize',  'xlarge'), TOTAL_FONT);
  const rows = (items || []).map(it => `
    <tr style="border-bottom:1px dashed #ddd;">
      <td style="padding:6px 2px;font-size:${qtyFontSize};font-weight:bold;width:36px;text-align:center;">${it.qty}</td>
      <td style="padding:6px 4px;">
        <div style="font-size:${itemFontSize};font-weight:bold;">${esc(it.name)}</div>
        ${it.note ? `<div style="font-size:11px;color:#c0392b;font-weight:bold;">⚠ ${esc(it.note)}</div>` : ''}
      </td>
    </tr>`).join('');

  const itemsHtml = `<table style="width:100%;border-collapse:collapse;">${rows}</table>`;

  /* Ümumi qeyd */
  let noteHtml = '';
  if (show('kitchenNote', true) && orderNote) {
    noteHtml = `<div style="margin-top:6px;padding:6px 8px;border:2px dashed #e74c3c;border-radius:4px;">
      <div style="font-size:10px;color:#e74c3c;font-weight:bold;margin-bottom:2px;">QEYD:</div>
      <div style="font-size:13px;font-weight:bold;">${esc(orderNote)}</div>
    </div>`;
  }

  const bottomLines = parseInt(val('kitchenBottomLines', 4));
  const bottomSpace = '<br>'.repeat(Math.max(0, bottomLines));

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Sifariş — ${esc(tableName)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'Courier New',monospace;width:${maxW};margin:0 auto;padding:12px 8px;color:#000;background:#fff;}
  @media print{body{padding:4px 2px;width:100%;}}
</style>
</head><body>
${header}
${divider(divType, paper)}
${tableHtml}
${divider(divType, paper)}
${meta}
${meta ? divider(divType, paper) : ''}
${itemsHtml}
${noteHtml}
${bottomSpace}
<script>window.onload=()=>{window.print();}<\/script>
</body></html>`;
}
