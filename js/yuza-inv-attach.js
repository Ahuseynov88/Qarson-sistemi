/* ═══════════════════════════════════════════
   YUZA POS — ALIŞ QAİMƏSİNİN ŞƏKLİ / FAYLI (11.11.2026)
   Elektron qaiməsi olmayan alışda (məs. bazardan) kağız qaimənin və ya
   çekin şəkli, yaxud PDF faylı alış sənədinə əlavə olunur.

   • Telefonda kamera ilə birbaşa çəkmək olur. Şəkil göndərilməzdən əvvəl
     kiçildilir (≈1600 px, JPEG) — baza ağırlaşmasın.
   • PDF ən çox 2 MB.
   • Saxlanma: invAttach/{qaiməId}/{faylId} — qaimələr siyahısı ağırlaşmasın deyə ayrıca.
     (Firebase Storage pulsuz planda yeni layihələr üçün açıq deyil — ona görə bazada.)
   • Görmək: Rəhbər və "Alış qaimələrinin şəkillərini görmək" icazəsi olanlar.
     Qaiməni yazan şəxs öz qaiməsi təsdiqlənənədək şəkilləri görür və silə bilir.
═══════════════════════════════════════════ */
import { db } from './firebase-service.js';
import { uid, uname, isAdmin, can, fmtDT, DOCS } from './yuza-inv-core.js';
import { esc, ok, fail } from './yuza-inv-ui.js';

const MAX_PDF = 2 * 1024 * 1024;
const MAX_SIDE = 1600, JPEG_Q = 0.72;
const NODE = 'invAttach';
const I = (id) => `<svg class="icon"><use href="#i-${id}"></use></svg>`;

export const canSeeAttach = (doc) => isAdmin() || can('purchase.attach.view')
  || (!!doc && doc.createdBy === uid() && ['draft', 'pending', 'rejected'].includes(doc.status || 'draft'));
export const canAddAttach = (doc) => isAdmin() || (!!doc && doc.createdBy === uid()) || can('purchase.create');
const canDelAttach = (doc) => isAdmin() || (!!doc && doc.createdBy === uid() && ['draft', 'pending', 'rejected'].includes(doc.status));

/* ── Fayl → saxlanacaq obyekt ── */
function readAsDataURL(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
}
async function compressImage(file) {
  const src = await readAsDataURL(file);
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
  return c.toDataURL('image/jpeg', JPEG_Q);
}
export async function prepareFiles(fileList) {
  const out = [];
  for (const f of [...fileList]) {
    const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
    if (!isPdf && !/^image\//.test(f.type)) { fail(`"${f.name}" — yalnız şəkil və PDF qəbul olunur`); continue; }
    if (isPdf && f.size > MAX_PDF) { fail(`"${f.name}" çox böyükdür (PDF ən çox 2 MB). Şəklini çəkib əlavə edin.`); continue; }
    try {
      const data = isPdf ? await readAsDataURL(f) : await compressImage(f);
      out.push({ name: f.name || (isPdf ? 'qaime.pdf' : 'qaime.jpg'), type: isPdf ? 'application/pdf' : 'image/jpeg', size: Math.round(data.length * 0.75), data });
    } catch (e) { fail(`"${f.name}" oxunmadı`); }
  }
  return out;
}

/* ── Baza ── */
export async function uploadAttachments(docId, items) {
  if (!docId || !items?.length) return 0;
  const up = {};
  items.forEach(it => {
    const k = db.ref(`${NODE}/${docId}`).push().key;
    up[`${NODE}/${docId}/${k}`] = { name: it.name, type: it.type, size: it.size, data: it.data, at: Date.now(), byId: uid(), byName: uname() };
  });
  await db.ref().update(up);
  await syncCount(docId);
  return items.length;
}
async function syncCount(docId) {
  try {
    const n = (await db.ref(`${NODE}/${docId}`).once('value')).numChildren?.() ?? 0;
    await db.ref(`${DOCS.purchase.node}/${docId}/attachN`).set(n || null);
  } catch (e) { /* sayğac vacib deyil */ }
}
export async function loadAttachments(docId) {
  const v = (await db.ref(`${NODE}/${docId}`).once('value')).val() || {};
  return Object.entries(v).map(([id, a]) => ({ id, ...a })).sort((a, b) => (a.at || 0) - (b.at || 0));
}
async function removeAttachment(docId, attId) {
  await db.ref(`${NODE}/${docId}/${attId}`).remove();
  await syncCount(docId);
}

/* ── Göstərmək ── */
function thumb(a, i, canDel) {
  const pdf = a.type === 'application/pdf';
  return `<div class="yzi-att">
    <button type="button" class="yzi-att__open" data-att-open="${i}" title="${esc(a.name)}" aria-label="Aç: ${esc(a.name)}">
      ${pdf ? `<span class="yzi-att__pdf">${I('doc')}<b>PDF</b></span>` : `<img src="${a.data}" alt="${esc(a.name)}" loading="lazy">`}
    </button>
    <small>${fmtDT(a.at)}${a.byName ? ' · ' + esc(a.byName) : ''}</small>
    ${canDel ? `<button type="button" class="yzi-att__del" data-att-del="${i}" aria-label="Sil" title="Sil">${I('trash')}</button>` : ''}
  </div>`;
}
function openViewer(a) {
  if (a.type === 'application/pdf') {
    try {
      const bin = atob(a.data.split(',')[1]); const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([u8], { type: 'application/pdf' }));
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { fail('PDF açılmadı'); }
    return;
  }
  const v = document.createElement('div');
  v.className = 'yzi-attv modal-bg open';
  v.innerHTML = `<button type="button" class="yzi-attv__x" data-close aria-label="Bağla" title="Bağla">${I('close')}</button>
    <img src="${a.data}" alt="${esc(a.name)}"><a class="yzi-attv__dl" href="${a.data}" download="${esc(a.name)}">${I('download')} Yüklə</a>`;
  const close = () => v.remove();
  v.addEventListener('click', (e) => { if (e.target === v || e.target.closest('[data-close]')) close(); });
  document.body.appendChild(v);
}

/* Qaimə baxışında / redaktorunda qalereya.
   host — boş element; doc — qaimə (id olmadan da ola bilər: yeni qaimə);
   pending — hələ yüklənməmiş fayllar massivi (yeni qaimə üçün, saxlananda yüklənir) */
export async function mountGallery(host, { doc = null, pending = null, onChange = null } = {}) {
  if (!host) return;
  const docId = doc?.id || null;
  if (docId && !canSeeAttach(doc)) {
    host.innerHTML = doc.attachN ? `<p class="yzi-hint">${I('clip')} Bu qaiməyə ${doc.attachN} fayl əlavə olunub. Görmək üçün icazə lazımdır.</p>` : '';
    return;
  }
  let saved = docId ? await loadAttachments(docId).catch(() => []) : [];
  const draw = () => {
    const all = saved.map(a => ({ ...a, _s: 1 })).concat((pending || []).map(a => ({ ...a, _s: 0 })));
    const add = !docId || canAddAttach(doc);
    host.innerHTML = `<div class="yzi-atts">
      <div class="yzi-atts__head"><b>${I('clip')} Qaimənin şəkli / faylı</b>${all.length ? ` <span class="mut">(${all.length})</span>` : ''}</div>
      ${all.length ? `<div class="yzi-atts__grid">${all.map((a, i) => thumb(a, i, a._s ? canDelAttach(doc) : true)).join('')}</div>`
        : '<p class="yzi-hint">Elektron qaimə yoxdursa (məs. bazardan alış), kağız qaimənin və ya çekin şəklini əlavə edin.</p>'}
      ${add ? `<label class="yzi-btn yzi-btn--ghost yzi-btn--sm yzi-atts__add">${I('camera')} Şəkil çək / fayl seç
        <input type="file" accept="image/*,application/pdf" multiple hidden></label>` : ''}
    </div>`;
    const inp = host.querySelector('input[type=file]');
    inp?.addEventListener('change', async () => {
      const items = await prepareFiles(inp.files); inp.value = '';
      if (!items.length) return;
      if (docId) {
        try { await uploadAttachments(docId, items); saved = await loadAttachments(docId); ok(`${items.length} fayl əlavə olundu`); }
        catch (e) { fail('Fayl yüklənmədi: ' + (e.message || e)); }
      } else if (pending) { pending.push(...items); }
      draw(); onChange?.();
    });
    host.querySelectorAll('[data-att-open]').forEach(b => b.addEventListener('click', () => openViewer(all[+b.dataset.attOpen])));
    host.querySelectorAll('[data-att-del]').forEach(b => b.addEventListener('click', async () => {
      const a = all[+b.dataset.attDel];
      if (!confirm('Bu fayl silinsin?')) return;
      if (a._s) { try { await removeAttachment(docId, a.id); saved = saved.filter(x => x.id !== a.id); } catch (e) { fail('Silinmədi'); } }
      else if (pending) { const k = pending.indexOf(pending.find(x => x.data === a.data)); if (k >= 0) pending.splice(k, 1); }
      draw(); onChange?.();
    }));
  };
  draw();
}
