/* ═══════════════════════════════════════════
   PRINTER SERVICE
   Firebase-dən dinamik printer tapma, çap məntiqi.
   Hard-code printer yoxdur — hər şey Firebase-dən oxunur.
═══════════════════════════════════════════ */
import { db } from './firebase-service.js';
import { state } from './state.js';
import { addLog, showToast } from './utils.js';
import { buildReceiptHtml } from './print-template.js';

/**
 * Firebase-dən aktiv "Hesab printeri" tapır.
 * @returns {Promise<Object|null>} printer obyekti və ya null
 */
export async function findReceiptPrinter() {
  const snap = await db.ref('printers').once('value');
  const all = snap.val();
  if (!all) return null;
  const printers = Object.entries(all).map(([id, p]) => ({ id, ...p }));
  return printers.find(p => p.type === 'receipt' && p.active) || null;
}

/**
 * Masa hesabını "Hesab printeri"ndən çap edir.
 * @param {string} tableId
 */
export async function printReceipt(tableId) {
  if (!tableId) return;

  const t = state.tables.find(x => x.id === tableId);
  const order = state.tableOrders[tableId];

  // Printer tap
  let printer = null;
  try { printer = await findReceiptPrinter(); } catch (e) { /* Firebase xətası */ }

  // Şablon ayarlarını yüklə
  let tplSettings = {};
  try {
    const tplSnap = await db.ref('settings/receiptTemplate').once('value');
    tplSettings = tplSnap.val() || {};
  } catch (e) { /* default istifadə et */ }

  // Restoran ayarlarını yüklə
  let restoranAdi = '';
  let restoranUnvan = '';
  try {
    const [nameSnap, addrSnap] = await Promise.all([
      db.ref('settings/restaurantName').once('value'),
      db.ref('settings/restaurantAddress').once('value')
    ]);
    restoranAdi = nameSnap.val() || '';
    restoranUnvan = addrSnap.val() || '';
  } catch (e) { /* skip */ }

  const waiterName = state.user?.name || '—';
  const now = new Date();

  // HTML çeki qur
  const html = buildReceiptHtml({
    table: t,
    order,
    waiterName,
    now,
    settings: tplSettings,
    restaurantName: restoranAdi,
    restaurantAddress: restoranUnvan
  });

  // Çap et
  const w = window.open('', '_blank', 'width=340,height=620');
  if (w) {
    w.document.write(html);
    w.document.close();

    const items = order?.items ? Object.values(order.items) : [];
    const total = order?.total || 0;
    const printerLabel = printer ? ` [${printer.name}]` : ' [Printer tapılmadı]';
    addLog(
      'bill_print',
      `${waiterName} "${t?.name||'?'}" masası üçün hesab çap etdi${printerLabel} (${total.toFixed(2)} ₼)`,
      { tableId, waiterId: state.user?.id }
    );
    if (order) {
      db.ref('tableOrders').child(tableId).update({ billPrintedAt: Date.now() });
    }
  } else {
    showToast('<svg class="icon"><use href="#i-error"></use></svg> Çap pəncərəsi bloklandı. Brauzer icazəsini yoxlayın.');
  }
}

/**
 * Test çap — printer ayarlarından çağırılır.
 * @param {Object} printer — {name, type, active}
 */
export function testPrintReceipt(printer) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('az-AZ');
  const timeStr = now.toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit' });

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <title>Test Çapı</title>
  <style>
    body{font-family:'Courier New',monospace;max-width:300px;margin:0 auto;padding:20px;font-size:14px;}
    h2{text-align:center;font-size:16px;margin:0 0 4px;}
    .center{text-align:center;}
    .line{border-top:1px dashed #000;margin:10px 0;}
    @media print{body{padding:0;}}
  </style>
  </head><body>
  <h2>🖨 TEST ÇAPI</h2>
  <p class="center" style="margin:0;font-size:11px;color:#666;">${dateStr} ${timeStr}</p>
  <div class="line"></div>
  <p style="margin:4px 0;"><strong>Printer:</strong> ${printer?.name || '—'}</p>
  <p style="margin:4px 0;"><strong>Növ:</strong> ${_printerTypeLabel(printer?.type)}</p>
  <p style="margin:4px 0;"><strong>Status:</strong> ${printer?.active ? '✅ Aktiv' : '❌ Passiv'}</p>
  <div class="line"></div>
  <p class="center" style="font-size:12px;margin-top:10px;">Printer işləyir!</p>
  <script>window.onload=()=>{window.print();}<\/script>
  </body></html>`;

  const w = window.open('', '_blank', 'width=340,height=400');
  if (w) { w.document.write(html); w.document.close(); }
  else showToast('<svg class="icon"><use href="#i-error"></use></svg> Çap pəncərəsi bloklandı.');
}

function _printerTypeLabel(type) {
  const m = { receipt: 'Hesab printeri', kitchen: 'Mətbəx printeri', bar: 'Bar printeri', other: 'Digər' };
  return m[type] || type || '—';
}
