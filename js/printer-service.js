/* ═══════════════════════════════════════════
   PRINTER SERVICE
   printJobs Firebase node-una yazma məntiqi.
   Electron Agent bu node-u oxuyub fiziki printerə göndərəcək.
   Hazırda (Agent hazır olana qədər): window.open() ilə brauzer çapı.
═══════════════════════════════════════════ */
import { R, db } from './firebase-service.js';
import { state } from './state.js';
import { addLog, showToast } from './utils.js';
import { buildReceiptHtml, buildKitchenHtml } from './print-template.js';

/* ─── Şablon ayarlarını cache-ləyib oxu ─── */
let _tplCache = null;
let _tplCacheTime = 0;
async function getTemplateSettings() {
  if (_tplCache && Date.now() - _tplCacheTime < 30000) return _tplCache;
  const [tplSnap, nameSnap, addrSnap, phoneSnap, logoSnap] = await Promise.all([
    db.ref('settings/receiptTemplate').once('value'),
    db.ref('settings/restaurantName').once('value'),
    db.ref('settings/restaurantAddress').once('value'),
    db.ref('settings/restaurantPhone').once('value'),
    db.ref('settings/restaurantLogo').once('value')
  ]);
  _tplCache = {
    settings:          tplSnap.val()  || {},
    restaurantName:    nameSnap.val() || '',
    restaurantAddress: addrSnap.val() || '',
    restaurantPhone:   phoneSnap.val()|| '',
    restaurantLogo:    logoSnap.val() || ''
  };
  _tplCacheTime = Date.now();
  return _tplCache;
}

/* ─── Mövcud aktiv printerləri tap ─── */
function getActivePrinters() {
  return (state.printers || []).filter(p => p.active);
}

/* ══════════════════════════════════════════
   HESAB ÇEKİ — "Hesab" düyməsi basılanda
══════════════════════════════════════════ */
export async function printReceipt(tableId) {
  if (!tableId) return;
  const t     = state.tables.find(x => x.id === tableId);
  const order = state.tableOrders[tableId];
  const waiterName = state.user?.name || '—';
  const now   = new Date();

  /* Hesab printerini tap */
  const receiptPrinter = getActivePrinters().find(p => p.type === 'receipt');

  /* Şablon ayarlarını yüklə */
  const tpl = await getTemplateSettings();

  /* printJob Firebase-ə yaz (Agent oxuyacaq) */
  if (receiptPrinter) {
    const items = order?.items ? Object.values(order.items) : [];
    R.printJobs.push({
      type:      'receipt',
      printerId: receiptPrinter.id,
      printerName: receiptPrinter.name,
      printerIp:   receiptPrinter.ip   || '',
      printerPort: receiptPrinter.port || 9100,
      paperWidth:  receiptPrinter.paperWidth || '80mm',
      tableId,
      tableName: t?.name || '—',
      waiterName,
      items,
      total:     order?.total || 0,
      serviceChargeAmount:  order?.serviceChargeAmount  || 0,
      serviceChargePercent: order?.serviceChargePercent || 0,
      discountValue: order?.discountValue || 0,
      paymentType:   order?.paymentType  || '',
      status:    'pending',
      createdAt: Date.now()
    });
  }

  /* HTML çeki brauzer pəncərəsində göstər (Agent hazır olana qədər) */
  const html = buildReceiptHtml({
    table: t, order, waiterName, now,
    settings:          { ...tpl.settings, paperWidth: receiptPrinter?.paperWidth || '80mm' },
    restaurantName:    tpl.restaurantName,
    restaurantAddress: tpl.restaurantAddress,
    restaurantPhone:   tpl.restaurantPhone,
    restaurantLogo:    tpl.restaurantLogo
  });

  const w = window.open('', '_blank', 'width=360,height=640');
  if (w) {
    w.document.write(html);
    w.document.close();
    const total = order?.total || 0;
    const lbl   = receiptPrinter ? ` [${receiptPrinter.name}]` : ' [Printer təyin edilməyib]';
    addLog('bill_print', `${waiterName} "${t?.name||'?'}" masası üçün hesab çap etdi${lbl} (${total.toFixed(2)} ₼)`, { tableId, waiterId: state.user?.id });
    if (order) db.ref('tableOrders').child(tableId).update({ billPrintedAt: Date.now() });
  } else {
    showToast('<svg class="icon"><use href="#i-error"></use></svg> Çap pəncərəsi bloklandı. Brauzer icazəsini yoxlayın.');
  }
}

/* ══════════════════════════════════════════
   MƏTBƏx ÇEKİ — sifariş gedəndə
   order-cart.js-dən çağırılır
   items: [{name, qty, note}]
   categoryName: bu qrupun kateqoriyası
══════════════════════════════════════════ */
export async function printKitchenJobs(tableId, kitchenGroups) {
  /*
    kitchenGroups: { [categoryName]: [{name, qty, note}] }
    Printer tap: hər printerın categories[] siyahısına bax,
    həmin kateqoriya varsa — o printerə çap işi yaz.
  */
  if (!tableId || !kitchenGroups) return;
  const t          = state.tables.find(x => x.id === tableId);
  const waiterName = state.user?.name || '—';
  const now        = new Date();
  const activePrinters = getActivePrinters().filter(p => p.type !== 'receipt');

  /* Şablon ayarlarını yüklə */
  const tplSnap = await db.ref('settings/kitchenTemplate').once('value');
  const kTpl    = tplSnap.val() || {};

  /* Hər printer üçün hansı mallar var — müəyyən et */
  const jobsByPrinter = {}; // { printerId: { printer, items[] } }

  Object.entries(kitchenGroups).forEach(([category, items]) => {
    /* Bu kateqoriyanı alan printerleri tap */
    const matched = activePrinters.filter(p => {
      const cats = p.categories || [];
      return cats.includes(category);
    });

    if (!matched.length) return; /* Bu kateqoriya heç bir printerə təyin edilməyib */

    matched.forEach(p => {
      if (!jobsByPrinter[p.id]) jobsByPrinter[p.id] = { printer: p, items: [] };
      jobsByPrinter[p.id].items.push(...items);
    });
  });

  /* Hər printer üçün job yaz + brauzer çapı */
  for (const [printerId, job] of Object.entries(jobsByPrinter)) {
    const { printer, items } = job;

    /* Firebase printJob */
    R.printJobs.push({
      type:      'kitchen',
      printerId,
      printerName: printer.name,
      printerIp:   printer.ip   || '',
      printerPort: printer.port || 9100,
      paperWidth:  printer.paperWidth || '80mm',
      tableId,
      tableName:   t?.name || '—',
      waiterName,
      items,
      orderNote:   kitchenGroups._orderNote || '',
      status:      'pending',
      createdAt:   Date.now()
    });

    /* Brauzer çapı (Agent hazır olana qədər) */
    const html = buildKitchenHtml({
      printerName: printer.name,
      tableName:   t?.name || '—',
      waiterName,
      items,
      orderNote: kitchenGroups._orderNote || '',
      now,
      settings: { ...kTpl, paperWidth: printer.paperWidth || '80mm' }
    });

    const w = window.open('', '_blank', 'width=360,height=500');
    if (w) { w.document.write(html); w.document.close(); }
  }
}

/* ══════════════════════════════════════════
   TEST ÇAP
══════════════════════════════════════════ */
export function testPrintReceipt(printer) {
  const now     = new Date();
  const dateStr = now.toLocaleDateString('az-AZ');
  const timeStr = now.toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit' });
  const maxW    = printer?.paperWidth === '58mm' ? '220px' : '300px';

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Test Çapı</title>
<style>
  body{font-family:'Courier New',monospace;width:${maxW};margin:0 auto;padding:12px 8px;font-size:13px;}
  @media print{body{padding:4px 2px;width:100%;}}
</style></head><body>
<div style="text-align:center;font-size:18px;font-weight:bold;">🖨 TEST ÇAPI</div>
<div style="text-align:center;font-size:11px;color:#666;">${dateStr} ${timeStr}</div>
<div style="border-top:1px dashed #000;margin:8px 0;"></div>
<div><b>Printer:</b> ${esc(printer?.name || '—')}</div>
<div><b>Növ:</b> ${_printerTypeLabel(printer?.type)}</div>
<div><b>Kağız:</b> ${printer?.paperWidth || '80mm'}</div>
<div><b>IP:</b> ${esc(printer?.ip || 'USB')}</div>
<div><b>Status:</b> ${printer?.active ? '✅ Aktiv' : '❌ Passiv'}</div>
<div style="border-top:1px dashed #000;margin:8px 0;"></div>
<div style="text-align:center;font-size:13px;">Printer işləyir!</div>
<br><br><br>
<script>window.onload=()=>{window.print();}<\/script>
</body></html>`;

  const w = window.open('', '_blank', 'width=360,height=420');
  if (w) { w.document.write(html); w.document.close(); }
  else showToast('<svg class="icon"><use href="#i-error"></use></svg> Çap pəncərəsi bloklandı.');
}

function _printerTypeLabel(type) {
  const m = { receipt: 'Hesab printeri', kitchen: 'Mətbəx printeri', bar: 'Bar printeri', other: 'Digər' };
  return m[type] || type || '—';
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
