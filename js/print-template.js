/* ═══════════════════════════════════════════
   PRINT TEMPLATE
   Firebase-dən gələn şablon ayarlarına əsasən çek HTML-i qurur.
   Hansı sahənin görünüb-görünməyəcəyini admin idarə edir.
═══════════════════════════════════════════ */

/**
 * @param {Object} opts
 * @param {Object} opts.table         — masa obyekti
 * @param {Object} opts.order         — tableOrders[tableId]
 * @param {string} opts.waiterName
 * @param {Date}   opts.now
 * @param {Object} opts.settings      — Firebase settings/receiptTemplate
 * @param {string} opts.restaurantName
 * @param {string} opts.restaurantAddress
 * @returns {string} tam HTML sənədi
 */
export function buildReceiptHtml({ table, order, waiterName, now, settings = {}, restaurantName, restaurantAddress }) {
  const s = settings; // qısa alias

  const show = (key, def = true) => (s[key] === undefined ? def : !!s[key]);

  const dateStr = now.toLocaleDateString('az-AZ');
  const timeStr = now.toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit' });

  const items  = order?.items ? Object.values(order.items) : [];
  const total  = order?.total || 0;
  const scAmt  = order?.serviceChargeAmount || 0;
  const scPct  = order?.serviceChargePercent || 0;
  const disc   = order?.discountValue || 0;
  const subtotal = total - scAmt;
  const payType = order?.paymentType || '';

  // ── Başlıq bölməsi ──
  let headerHtml = '';
  if (show('logo'))         headerHtml += `<div class="logo-wrap"><div class="logo-placeholder">🍽</div></div>`;
  if (show('restaurantName') && restaurantName) headerHtml += `<h2>${esc(restaurantName)}</h2>`;
  if (show('address') && restaurantAddress)     headerHtml += `<p class="center" style="font-size:11px;color:#555;margin:0 0 2px;">${esc(restaurantAddress)}</p>`;
  if (show('datetime'))     headerHtml += `<p class="center" style="font-size:11px;margin:0;">${dateStr} ${timeStr}</p>`;

  // ── Masa / ofisiant ──
  let infoHtml = '';
  if (show('table'))        infoHtml += `<p style="margin:4px 0;"><strong>Masa:</strong> ${esc(table?.name || '—')}</p>`;
  if (show('waiter'))       infoHtml += `<p style="margin:4px 0;"><strong>Qarson:</strong> ${esc(waiterName)}</p>`;

  // ── Məhsullar ──
  let itemsHtml = '';
  if (show('itemName') || show('itemQty') || show('itemPrice') || show('lineTotal')) {
    const thQty   = show('itemQty')   ? `<th style="text-align:center;padding:2px 4px;">Miq.</th>` : '';
    const thPrice = show('itemPrice') ? `<th style="text-align:right;padding:2px 4px;">Qiym.</th>` : '';
    const thTotal = show('lineTotal') ? `<th style="text-align:right;padding:2px 4px;">Cəm</th>`  : '';

    const rows = items.map(it => {
      const lineTotal = (it.price * it.qty * (1 - ((it.discountPercent || 0) / 100))) + (it.extraFee || 0);
      const tag = it.compliment ? ' [İKRAM]' : (it.discountPercent > 0 ? ` [-${it.discountPercent}%]` : '');
      const tdQty   = show('itemQty')   ? `<td style="text-align:center;padding:3px 4px;">${it.qty}</td>` : '';
      const tdPrice = show('itemPrice') ? `<td style="text-align:right;padding:3px 4px;">${it.price.toFixed(2)}</td>` : '';
      const tdTotal = show('lineTotal') ? `<td style="text-align:right;padding:3px 4px;">${lineTotal.toFixed(2)}</td>` : '';
      const name    = show('itemName')  ? `${esc(it.name)}${tag}${it.note ? ` <em style="font-size:10px;color:#666;">(${esc(it.note)})</em>` : ''}` : '';
      return `<tr><td style="padding:3px 4px;">${name}</td>${tdQty}${tdPrice}${tdTotal}</tr>`;
    }).join('');

    itemsHtml = `<table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr style="border-bottom:1px dashed #000;">
        <th style="text-align:left;padding:2px 4px;">Məhsul</th>${thQty}${thPrice}${thTotal}
      </thead>
      <tbody>${rows || '<tr><td colspan="4" style="color:#999;font-style:italic;padding:4px;">Sifariş yoxdur</td></tr>'}</tbody>
    </table>`;
  }

  // ── Maliyyə cəmləri ──
  let totalsHtml = '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
  if (show('discount') && disc > 0) {
    totalsHtml += `<tr><td style="padding:2px 0;">Endirim:</td><td style="text-align:right;color:#c0392b;">-${disc.toFixed(2)} ₼</td></tr>`;
  }
  if (show('serviceCharge') && scAmt > 0) {
    totalsHtml += `<tr><td style="padding:2px 0;">Ara cəm:</td><td style="text-align:right;">${subtotal.toFixed(2)} ₼</td></tr>`;
    totalsHtml += `<tr><td style="padding:2px 0;">Xidmət haqqı (${scPct}%):</td><td style="text-align:right;">${scAmt.toFixed(2)} ₼</td></tr>`;
  }
  if (show('totalAmount')) {
    totalsHtml += `<tr style="font-size:16px;font-weight:bold;border-top:1px dashed #000;">
      <td style="padding:6px 0 2px;">CƏMİ:</td>
      <td style="text-align:right;padding:6px 0 2px;">${total.toFixed(2)} ₼</td></tr>`;
  }
  if (show('paymentType') && payType) {
    const labels = { cash: 'Nağd', pos: 'POS', credit: 'Nisyə', split: 'Bölünmüş' };
    totalsHtml += `<tr><td style="padding:2px 0;color:#555;font-size:11px;">Ödəniş:</td><td style="text-align:right;color:#555;font-size:11px;">${esc(labels[payType] || payType)}</td></tr>`;
  }
  totalsHtml += '</table>';

  // ── Footer ──
  let footerHtml = '';
  const footerMsg = s.footerMessage || '';
  if (show('footer') && footerMsg) {
    footerHtml = `<p class="center" style="font-size:12px;margin-top:10px;">${esc(footerMsg)}</p>`;
  } else if (show('footer')) {
    footerHtml = `<p class="center" style="font-size:12px;margin-top:10px;">Təşəkkür edirik!</p>`;
  }

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Hesab — ${esc(table?.name || 'Masa')}</title>
<style>
  body{font-family:'Courier New',monospace;max-width:300px;margin:0 auto;padding:20px;font-size:14px;}
  h2{text-align:center;font-size:18px;margin:0 0 2px;}
  .center{text-align:center;}
  .line{border-top:1px dashed #000;margin:10px 0;}
  .logo-wrap{text-align:center;margin-bottom:6px;}
  .logo-placeholder{font-size:32px;}
  @media print{body{padding:0;margin:0;}}
</style>
</head><body>
${headerHtml ? `${headerHtml}<div class="line"></div>` : ''}
${infoHtml   ? `${infoHtml}<div class="line"></div>`   : ''}
${itemsHtml  ? `${itemsHtml}<div class="line"></div>`  : ''}
${totalsHtml}
${footerHtml}
<script>window.onload=()=>{window.print();}<\/script>
</body></html>`;
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
