/* ═══════════════════════════════════════════
   QR KOD
   Bu fayl: hər masa üçün QR kod yaratmaq, göstərmək, çap etmək.
═══════════════════════════════════════════ */
function showQR(tableId, tableName) {
  const url = location.origin + location.pathname + '?table=' + tableId;
  document.getElementById('qrModalTitle').textContent = '📱 ' + tableName;
  document.getElementById('qrLink').textContent = url;
  const canvas = document.getElementById('qrCanvas');
  canvas.innerHTML = '';
  new QRCode(canvas, { text:url, width:200, height:200, colorDark:'#000', colorLight:'#fff' });
  document.getElementById('qrModal').classList.add('open');
}

function closeQRModal() { document.getElementById('qrModal').classList.remove('open'); }

function printQR() {
  const title  = document.getElementById('qrModalTitle').textContent;
  const canvas = document.querySelector('#qrCanvas canvas');
  if (!canvas) return;
  const img = canvas.toDataURL();
  const w   = window.open('','_blank');
  w.document.write(`<html><head><title>${title}</title>
    <style>body{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;}
    h2{margin-bottom:16px;}p{color:#666;font-size:13px;}</style></head>
    <body><h2>${title}</h2><img src="${img}" width="250"><p>QR kodu oxudun</p>
    <script>window.onload=()=>window.print()<\/script></body></html>`);
}
