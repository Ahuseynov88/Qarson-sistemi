/* ═══════════════════════════════════════════
   PRINTER SERVICE
   printJobs Firebase node-una yazma məntiqi.
   Electron Agent bu node-u oxuyub fiziki printerə göndərəcək.
   Hazırda (Agent hazır olana qədər): window.open() ilə brauzer çapı.
═══════════════════════════════════════════ */
import { R, db } from './firebase-service.js';
import { state } from './state.js';
import { addLog, showToast } from './utils.js';

/* ─── Şablon ayarlarını hər dəfə fresh oxu ─── */
async function getTemplateSettings() {
  const [tplSnap, nameSnap, addrSnap, phoneSnap] = await Promise.all([
    db.ref('settings/receiptTemplate').once('value'),
    db.ref('settings/restaurantName').once('value'),
    db.ref('settings/restaurantAddress').once('value'),
    db.ref('settings/restaurantPhone').once('value')
  ]);
  return {
    settings:          tplSnap.val()  || {},
    restaurantName:    nameSnap.val() || '',
    restaurantAddress: addrSnap.val() || '',
    restaurantPhone:   phoneSnap.val()|| ''
  };
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

  /* printJob Firebase-ə yaz — şablon ayarları da içindədir */
  if (receiptPrinter) {
    const items = order?.items ? Object.values(order.items) : [];
    const tplSettings = tpl.settings || {};
    R.printJobs.push({
      type:        'receipt',
      printerId:   receiptPrinter.id,
      printerName: receiptPrinter.name,
      printerIp:   receiptPrinter.ip   || '',
      printerPort: receiptPrinter.port || 9100,
      paperWidth:  receiptPrinter.paperWidth || '80mm',
      tableId,
      tableName:   t?.name || '—',
      waiterName,
      items,
      total:                order?.total || 0,
      serviceChargeAmount:  order?.serviceChargeAmount  || 0,
      serviceChargePercent: order?.serviceChargePercent || 0,
      discountValue:        order?.discountValue || 0,
      paymentType:          order?.paymentType  || '',
      status:    'pending',
      createdAt: Date.now(),
      /* ── Şablon ayarları — Agent birbaşa buradan oxuyur ── */
      tplShow: {
        logo:           tplSettings.logo          !== false,
        restaurantName: tplSettings.restaurantName !== false,
        address:        tplSettings.address        !== false,
        phone:          !!tplSettings.phone,
        datetime:       tplSettings.datetime       !== false,
        table:          tplSettings.table          !== false,
        waiter:         tplSettings.waiter         !== false,
        customerName:   !!tplSettings.customerName,
        itemName:       tplSettings.itemName       !== false,
        itemQty:        tplSettings.itemQty        !== false,
        itemPrice:      !!tplSettings.itemPrice,
        lineTotal:      tplSettings.lineTotal      !== false,
        discount:       tplSettings.discount       !== false,
        serviceCharge:  tplSettings.serviceCharge  !== false,
        vat:            !!tplSettings.vat,
        totalAmount:    tplSettings.totalAmount    !== false,
        paymentType:    !!tplSettings.paymentType,
        footer:         tplSettings.footer         !== false,
      },
      tplData: {
        restaurantName:      tpl.restaurantName    || '',
        restaurantAddress:   tpl.restaurantAddress || '',
        restaurantPhone:     tpl.restaurantPhone   || '',
        currency:            tplSettings.currency        || 'AZN',
        dividerType:         tplSettings.dividerType     || 'dash',
        bottomLines:         tplSettings.bottomLines     || 5,
        vatPercent:          tplSettings.vatPercent      || 0,
        footerMessage:       tplSettings.footerMessage   || 'Tesekkur edirik!',
        restaurantNameSize:  tplSettings.restaurantNameSize  || 'large',
        restaurantNameBold:  tplSettings.restaurantNameBold  !== false,
        restaurantNameUpper: !!tplSettings.restaurantNameUpper,
        itemNameBold:        !!tplSettings.itemNameBold,
        totalUpper:          tplSettings.totalUpper !== false,
      }
    });
  }

  /* Log + billPrintedAt yaz */
  const total = order?.total || 0;
  const lbl   = receiptPrinter ? ` [${receiptPrinter.name}]` : ' [Hesab printeri tapılmadı]';
  addLog('bill_print', `${waiterName} "${t?.name||'?'}" masası üçün hesab göndərildi${lbl} (${total.toFixed(2)} ₼)`, { tableId, waiterId: state.user?.id });
  if (order) db.ref('tableOrders').child(tableId).update({ billPrintedAt: Date.now() });

  if (!receiptPrinter) {
    showToast('<svg class="icon"><use href="#i-warning"></use></svg> Aktiv hesab printeri tapılmadı. Admin → Printerlər bölməsini yoxlayın.');
  } else {
    showToast('<svg class="icon"><use href="#i-check"></use></svg> Hesab printerə göndərildi');
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

  }
}

/* ══════════════════════════════════════════
   TEST ÇAP
══════════════════════════════════════════ */
export function testPrintReceipt(printer) {
  if (!printer) {
    showToast('<svg class="icon"><use href="#i-warning"></use></svg> Printer tapılmadı');
    return;
  }

  // Brauzer/Windows çap pəncərəsi AÇILMIR.
  // Test işi də normal hesab/mətbəx çeki kimi Print Agent növbəsinə göndərilir.
  R.printJobs.push({
    type:        'test',
    printerId:   printer.id,
    printerName: printer.name || 'Printer',
    printerIp:   printer.ip || '',
    printerPort: printer.port || 9100,
    paperWidth:  printer.paperWidth || '80mm',
    status:      'pending',
    createdAt:   Date.now()
  }).then(() => {
    showToast('<svg class="icon"><use href="#i-check"></use></svg> Test çapı agentə göndərildi');
  }).catch(err => {
    console.error('[PrinterTest]', err);
    showToast('<svg class="icon"><use href="#i-error"></use></svg> Test çapı göndərilmədi');
  });
}

function _printerTypeLabel(type) {
  const m = { receipt: 'Hesab printeri', kitchen: 'Mətbəx printeri', bar: 'Bar printeri', other: 'Digər' };
  return m[type] || type || '—';
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
