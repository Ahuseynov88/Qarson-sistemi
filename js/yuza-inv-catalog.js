/* ═══════════════════════════════════════════
   YUZA POS — ANBAR: MƏHSUL KATALOQU, ANBARLAR, PARAMETRLƏR
═══════════════════════════════════════════ */
import { db } from './firebase-service.js';
import { state } from './state.js';
import {
  inv, PTYPES, UNITS, product, productList, warehouseList, totalStock, stockIn, isLow, unitCost, recipeCost,
  netOf, marginInfo, saveProduct, findSimilar, can, isAdmin, isV2, fmtQty, fmtMoney, fmtDT, r2, r3, r4, num,
  defaultWarehouseId, migrateToV2, rollbackMode, uname
} from './yuza-inv-core.js';
import {
  registerTab, modal, confirmBox, esc, $, ok, fail, numInput, typeChip, attachPicker, whOptions, go, fresh, blurIn
} from './yuza-inv-ui.js';

const ALLERGENS = ['Qlüten', 'Süd', 'Yumurta', 'Qoz-fındıq', 'Yer fındığı', 'Soya', 'Balıq', 'Dəniz məhsulları', 'Küncüt', 'Xardal', 'Kərəviz'];
const f = { q: '', type: 'all', wh: '', only: '' };

/* ═══ KATALOQ SİYAHISI ═══ */
function renderCatalog(host) {
  const el = fresh(host);
  const again = () => renderCatalog(host);
  const all = productList();
  const counts = {}; all.forEach(p => { counts[p.type] = (counts[p.type] || 0) + 1; });
  const stockVal = all.filter(p => PTYPES[p.type]?.stock).reduce((s, p) => s + totalStock(p.id) * unitCost(p), 0);
  const low = all.filter(isLow);
  const incomplete = all.filter(p => p.incomplete);
  const q = f.q.trim().toLowerCase();
  const rows = all.filter(p => {
    if (f.type !== 'all' && p.type !== f.type) return false;
    if (f.only === 'menu' && !(PTYPES[p.type]?.menu && p.showInMenu !== false)) return false;
    if (f.only === 'low' && !isLow(p)) return false;
    if (f.only === 'inc' && !p.incomplete) return false;
    if (q && !(String(p.name).toLowerCase().includes(q) || String(p.category || '').toLowerCase().includes(q) || String(p.barcode || '') === q)) return false;
    return true;
  });
  const editable = can('catalog.edit');
  const showCost = can('catalog.cost');
  const qtyOf = (p) => f.wh ? stockIn(f.wh, p.id) : totalStock(p.id);
  /* Kataloqda olmayan menyu malları (başqa yerdən əlavə olunub) — satışda anbar izlənmir */
  const orphans = inv.loaded.products ? (state.menuItems || []).filter(mi => mi && mi.id && !inv.products[mi.id]) : [];

  el.innerHTML = `
    <div class="yzi-head">
      <div><div class="yzi-eyebrow">MƏHSULLAR · VAHİD KATALOQ</div><h1 class="yzi-h1">Məhsul kataloqu</h1></div>
      <div class="yzi-actions">
        ${editable ? '<button type="button" class="yzi-btn yzi-btn--gold" data-act="new">+ Yeni məhsul</button>' : ''}
      </div>
    </div>
    ${orphans.length && editable ? `<div class="yzi-warnbox"><b>${orphans.length} menyu malı kataloqda yoxdur:</b> ${orphans.slice(0, 8).map(o => esc(o.name)).join(', ')}${orphans.length > 8 ? '…' : ''}.
      Onların satışında anbar silinmir. <button type="button" class="yzi-btn yzi-btn--sm yzi-btn--gold" data-act="orphans">Kataloqa əlavə et</button></div>` : ''}
    <div class="yzi-kpis">
      <div class="yzi-kpi"><small>Məhsul sayı</small><b>${all.length}</b><span>${Object.keys(PTYPES).map(t => `${counts[t] || 0} ${PTYPES[t].label.toLowerCase()}`).join(' · ')}</span></div>
      ${showCost ? `<div class="yzi-kpi"><small>Anbar dəyəri (maya ilə)</small><b>${fmtMoney(stockVal)}</b><span>${warehouseList().length} anbar üzrə</span></div>` : ''}
      <button type="button" class="yzi-kpi yzi-kpi--btn${f.only === 'low' ? ' is-on' : ''}" data-only="low"><small>Minimumdan az</small><b class="${low.length ? 'yzi-warn' : ''}">${low.length}</b><span>sifariş vermək lazımdır</span></button>
      <button type="button" class="yzi-kpi yzi-kpi--btn${f.only === 'inc' ? ' is-on' : ''}" data-only="inc"><small>Natamam kart</small><b>${incomplete.length}</b><span>alışda qısa əlavə edilib</span></button>
    </div>
    <div class="yzi-filters">
      <label class="yzi-f yzi-f--inline"><span>Axtarış</span><input type="search" id="yziCatQ" placeholder="Ad, kateqoriya, barkod" value="${esc(f.q)}"></label>
      <label class="yzi-f yzi-f--inline"><span>Anbar</span><select id="yziCatWh"><option value="">Bütün anbarlar</option>${whOptions(f.wh, { noDefault: true })}</select></label>
      <div class="yzi-pills" role="group" aria-label="Növ filtri">
        <button type="button" data-type="all" class="${f.type === 'all' ? 'is-on' : ''}">Hamısı</button>
        ${Object.keys(PTYPES).map(t => `<button type="button" data-type="${t}" class="yzi-pill--${t}${f.type === t ? ' is-on' : ''}">${PTYPES[t].label}</button>`).join('')}
        <button type="button" data-only="menu" class="${f.only === 'menu' ? 'is-on' : ''}">Menyuda olanlar</button>
      </div>
    </div>
    <div class="yzi-table-wrap">
      <table class="yzi-table">
        <thead><tr><th>Məhsul</th><th>Növ</th><th>Kateqoriya</th><th>Vahid</th><th class="n">Qalıq</th>${showCost ? '<th class="n">Maya</th>' : ''}<th class="n">Satış</th><th class="c">Menyu</th></tr></thead>
        <tbody>${rows.length ? rows.map(p => {
          const t = PTYPES[p.type] || {};
          const low1 = isLow(p);
          const inMenu = t.menu && p.showInMenu !== false;
          const price = p.pricingMode === 'hourly' ? `${fmtMoney(p.hourlyRate)}/saat` : (t.menu ? fmtMoney(p.price) : '—');
          return `<tr class="${low1 ? 'is-low' : ''}" data-open="${p.id}" tabindex="0">
            <td><b>${esc(p.name)}</b>${p.incomplete ? ' <i class="yzi-tag-inc">Natamam</i>' : ''}${p.isFavorite ? ' <i class="yzi-star" title="Favori">★</i>' : ''}${p.active === false && t.menu ? ' <i class="yzi-tag-off">Tükənib</i>' : ''}</td>
            <td>${typeChip(p.type)}</td>
            <td class="mut">${esc(p.category || '—')}</td>
            <td class="mut">${esc(p.unit || '')}</td>
            <td class="n">${t.stock ? `<span class="${qtyOf(p) < 0 ? 'yzi-bad' : low1 ? 'yzi-warn' : ''}">${fmtQty(qtyOf(p))}</span>${low1 ? ` <small class="mut">min ${fmtQty(p.minQty)}</small>` : ''}` : '<span class="mut">reseptlə</span>'}</td>
            ${showCost ? `<td class="n">${fmtMoney(unitCost(p))}</td>` : ''}
            <td class="n"><b>${price}</b></td>
            <td class="c">${t.menu ? (editable
              ? `<button type="button" class="yzi-switch${inMenu ? ' is-on' : ''}" role="switch" aria-checked="${inMenu}" aria-label="Menyuda göstər: ${esc(p.name)}" data-menu="${p.id}"><span></span></button>`
              : (inMenu ? 'Bəli' : 'Xeyr')) : '<span class="mut">olmaz</span>'}</td>
          </tr>`;
        }).join('') : `<tr><td colspan="8" class="yzi-empty">Filtrə uyğun məhsul yoxdur.</td></tr>`}</tbody>
      </table>
    </div>
    <p class="yzi-hint">Xammal və yarımfabrikat menyuya çıxa bilməz. Hazır malda düymə satış mövqeyini açıb-bağlayır. Yemək öz stoku olmadan, texnoloji kart (resept) üzrə silinir.</p>`;

  el.querySelector('#yziCatQ').addEventListener('input', (e) => { f.q = e.target.value; const pos = e.target.selectionStart; again(); const i = $('yziCatQ'); i.focus(); i.setSelectionRange(pos, pos); });
  el.querySelector('#yziCatWh').addEventListener('change', (e) => { f.wh = e.target.value; again(); });
  el.addEventListener('click', (e) => {
    const t = e.target;
    const sw = t.closest('[data-menu]');
    if (sw) { e.stopPropagation(); toggleMenu(sw.dataset.menu); return; }
    const ty = t.closest('[data-type]'); if (ty) { f.type = ty.dataset.type; again(); return; }
    const on = t.closest('[data-only]'); if (on) { f.only = f.only === on.dataset.only ? '' : on.dataset.only; again(); return; }
    if (t.closest('[data-act="new"]')) { openEditor(null); return; }
    if (t.closest('[data-act="orphans"]')) { adoptOrphans(orphans); return; }
    const row = t.closest('[data-open]'); if (row) openEditor(row.dataset.open);
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('tr[data-open]')) openEditor(e.target.dataset.open); });
}
async function adoptOrphans(list) {
  const c = await confirmBox(`${list.length} menyu malı kataloqa əlavə olunsun? Sayıla bilənlər <b>Hazır mal</b>, qalanları <b>Yemək</b> kimi yaranacaq (sonra dəyişə bilərsiniz).`);
  if (!c) return;
  try {
    for (const mi of list) {
      const goods = !!mi.isTrackable;
      await saveProduct(mi.id, {
        name: mi.name || 'Adsız', type: goods ? 'goods' : 'dish', category: mi.category || 'Digər', unit: goods ? 'ədəd' : 'porsiya',
        price: Number(mi.price) || 0, vatRate: Number(mi.vatRate) || 0, vatIncluded: mi.vatIncluded !== false,
        showInMenu: true, showInQr: mi.showInQr !== false, active: mi.available !== false, isFavorite: !!mi.isFavorite,
        photo: mi.photo || '', description: mi.description || '', kitchenId: mi.kitchenId || null, incomplete: true, createdAt: Date.now()
      }, { log: false });
    }
    ok(`${list.length} mal kataloqa əlavə olundu`);
  } catch (e) { fail(e.message); }
}
async function toggleMenu(id) {
  const p = product(id); if (!p) return;
  const next = p.showInMenu === false;
  if (next && !(Number(p.pricingMode === 'hourly' ? p.hourlyRate : p.price) > 0)) { fail('Menyuya çıxarmaq üçün əvvəlcə satış qiyməti yazın'); openEditor(id); return; }
  try { await saveProduct(id, { showInMenu: next }); ok(next ? `${p.name} menyuda görünür` : `${p.name} menyudan çıxarıldı`); }
  catch (e) { fail(e.message); }
}

/* ═══ MƏHSUL KARTI (redaktor) ═══ */
function compressImage(file) {
  return new Promise((resolve, reject) => {
    if (file.size > 8 * 1024 * 1024) { reject(new Error('Şəkil 8MB-dan böyükdür')); return; }
    const rd = new FileReader();
    rd.onerror = () => reject(new Error('Şəkil oxunmadı'));
    rd.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 640, k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => reject(new Error('Şəkil formatı dəstəklənmir'));
      img.src = rd.result;
    };
    rd.readAsDataURL(file);
  });
}

export function openEditor(id) {
  const old = id ? product(id) : null;
  const canEdit = can('catalog.edit');
  const canPrice = can('catalog.price') || canEdit;
  const showCost = can('catalog.cost');
  /* İşçi nüsxəsi — yadda saxlayana qədər bazaya yazılmır */
  const d = old ? JSON.parse(JSON.stringify(old)) : { type: 'goods', unit: 'ədəd', vatRate: inv.settings.defaultVat ?? 18, vatIncluded: true, showInMenu: false, active: true, showInQr: true };
  d.packs = d.packs || {}; d.recipe = d.recipe || {}; d.allergens = d.allergens || {};
  const cats = [...new Set(productList().map(p => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'az'));
  const stations = (state.kitchenStations || []);

  const m = modal({ title: old ? esc(old.name) : 'Yeni məhsul', wide: true, body: '<div id="yziEd"></div>', actions: canEdit || canPrice ? [
    ...(old && canEdit ? [{ label: old.archived ? 'Arxivdən çıxar' : 'Arxivlə', cls: 'yzi-btn--ghost yzi-btn--left', onClick: async () => {
      if (!old.archived && totalStock(id) > 0.0001) throw new Error('Qalığı olan məhsul arxivlənə bilməz (əvvəlcə silinmə aktı və ya transfer)');
      const okk = await confirmBox(old.archived ? `"${esc(old.name)}" yenidən aktiv olsun?` : `"${esc(old.name)}" arxivlənsin? Menyudan çıxarılacaq, tarixçə qalacaq.`);
      if (!okk) return false;
      await saveProduct(id, { archived: !old.archived }); ok(old.archived ? 'Aktivləşdirildi' : 'Arxivləndi');
    } }] : []),
    { label: 'Ləğv', cancel: true, cls: 'yzi-btn--ghost' },
    { label: 'Yadda saxla', cls: 'yzi-btn--gold', onClick: async () => { await save(); } }
  ] : [{ label: 'Bağla', cancel: true, cls: 'yzi-btn--ghost' }] });
  const root = m.body.querySelector('#yziEd');

  const T = () => PTYPES[d.type] || PTYPES.goods;
  const dis = canEdit ? '' : 'disabled';

  function draw() {
    blurIn(root);
    const t = T();
    const mi = marginInfo({ ...d, id: id || '_new' });
    const rc = recipeCost(d);
    root.innerHTML = `
      <div class="yzi-ed">
        <section class="yzi-card">
          <h3>Əsas məlumat</h3>
          <div class="yzi-ed__top">
            <label class="yzi-photo" title="Şəkli dəyiş">
              ${d.photo ? `<img src="${esc(d.photo)}" alt="">` : '<span>Şəkil</span>'}
              ${canEdit ? '<input type="file" accept="image/*" id="yziEdPhoto" hidden>' : ''}
            </label>
            <div class="yzi-grid2 yzi-grow">
              <label class="yzi-f yzi-span2"><span>Ad *</span><input type="text" id="yziEdName" value="${esc(d.name || '')}" ${dis} autocomplete="off"></label>
              <label class="yzi-f"><span>Kateqoriya</span><input type="text" id="yziEdCat" list="yziCatList" value="${esc(d.category || '')}" ${dis} placeholder="məs: İçkilər"></label>
              <label class="yzi-f"><span>Barkod</span><input type="text" id="yziEdBar" value="${esc(d.barcode || '')}" ${dis} inputmode="numeric"></label>
            </div>
          </div>
          <datalist id="yziCatList">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
          <div id="yziEdSim"></div>
          <div class="yzi-f"><span>Növ — sistemin davranışını bu təyin edir</span>
            <div class="yzi-seg yzi-seg--5" id="yziEdType">${Object.entries(PTYPES).map(([k, v]) => `<button type="button" data-t="${k}" class="${k === d.type ? 'is-on' : ''}" ${dis}>${v.label}</button>`).join('')}</div>
            <small class="yzi-hint">${typeHint(d.type)}</small></div>
          <label class="yzi-f"><span>Təsvir (QR menyuda görünür)</span><textarea id="yziEdDesc" rows="2" ${dis}>${esc(d.description || '')}</textarea></label>
        </section>

        <section class="yzi-card">
          <h3>Vahid və qablaşma</h3>
          <div class="yzi-grid2">
            <label class="yzi-f"><span>${t.stock ? 'Anbar vahidi (qalıq bu vahiddə)' : 'Satış vahidi'}</span><select id="yziEdUnit" ${dis}>${UNITS.map(u => `<option${u === d.unit ? ' selected' : ''}>${u}</option>`).join('')}</select></label>
            <label class="yzi-f"><span>ƏDV dərəcəsi (%)</span>
              <span class="yzi-inline">${numInput(`id="yziEdVat" ${canPrice ? '' : 'disabled'}`, d.vatRate ?? 0)}
              ${[0, 8, 18].map(v => `<button type="button" class="yzi-chipbtn" data-vat="${v}" ${canPrice ? '' : 'disabled'}>${v}%</button>`).join('')}</span></label>
          </div>
          ${t.buy ? `<table class="yzi-table yzi-table--mini"><thead><tr><th>Qablaşma (alışda)</th><th>Neçə ${esc(d.unit || 'vahid')}</th><th></th></tr></thead><tbody>
            ${Object.entries(d.packs).map(([k, pk]) => `<tr><td><input type="text" data-pk="${k}" data-f="name" value="${esc(pk.name)}" ${dis}></td><td>${numInput(`data-pk="${k}" data-f="factor" ${dis}`, pk.factor)}</td><td>${canEdit ? `<button type="button" class="yzi-x" data-pkdel="${k}" aria-label="Sil">✕</button>` : ''}</td></tr>`).join('')}
            </tbody></table>
            ${canEdit ? '<button type="button" class="yzi-btn yzi-btn--sm yzi-btn--ghost" data-act="addpack">+ Qablaşma əlavə et</button>' : ''}
            <small class="yzi-hint">Məs: Qutu = 24 ədəd. Alışda "2 qutu" yazılsa anbara 48 ədəd mədaxil olur.</small>` : ''}
        </section>

        ${t.stock ? `<section class="yzi-card">
          <h3>Anbar</h3>
          <div class="yzi-stocklist">${warehouseList().map(w => `<div class="yzi-row"><span>${esc(w.name)}</span><b>${id ? fmtQty(stockIn(w.id, id)) : 0} ${esc(d.unit || '')}</b></div>`).join('')}
            <div class="yzi-row yzi-row--total"><span>Cəmi</span><b>${id ? fmtQty(totalStock(id)) : 0} ${esc(d.unit || '')}</b></div></div>
          <div class="yzi-grid3">
            <label class="yzi-f"><span>Minimum qalıq</span>${numInput(`id="yziEdMin" ${dis}`, d.minQty)}</label>
            <label class="yzi-f"><span>Sifariş miqdarı</span>${numInput(`id="yziEdReorder" ${dis}`, d.reorderQty)}</label>
            <label class="yzi-f"><span>Son istifadə izlənsin</span><select id="yziEdExp" ${dis}><option value="">Xeyr</option><option value="1"${d.trackExpiry ? ' selected' : ''}>Bəli</option></select></label>
          </div>
          ${showCost ? `<div class="yzi-mini-kpis"><div><small>Orta çəkili maya</small><b>${fmtMoney(d.avgCost)}</b></div><div><small>Son alış qiyməti</small><b>${fmtMoney(d.lastCost)}${d.lastCostAt ? ` <small>· ${fmtDT(d.lastCostAt)}</small>` : ''}</b></div></div>` : ''}
        </section>` : ''}

        ${t.recipe ? `<section class="yzi-card yzi-card--wide">
          <h3>${d.type === 'semi' ? 'Hazırlama resepti' : 'Texnoloji kart'} · ${d.type === 'semi' ? `çıxış` : '1 porsiya'}</h3>
          ${d.type === 'semi' ? `<label class="yzi-f yzi-f--inline"><span>Reseptdən çıxan miqdar (${esc(d.unit || '')})</span>${numInput(`id="yziEdYield" ${dis}`, d.yieldQty ?? 1)}</label>` : ''}
          <table class="yzi-table yzi-table--mini"><thead><tr><th>Tərkib</th><th class="n">Brutto</th><th class="n">İtki %</th><th class="n">Netto</th>${showCost ? '<th class="n">Qiymət</th><th class="n">Maya</th>' : ''}<th></th></tr></thead><tbody>
            ${Object.entries(d.recipe).map(([cid, line]) => {
              const c = product(cid);
              return `<tr><td>${c ? `<b>${esc(c.name)}</b> <small class="mut">${esc(c.unit || '')}</small> ${c.type === 'semi' ? typeChip('semi') : ''}` : '<i class="yzi-bad">silinmiş məhsul</i>'}</td>
                <td class="n">${numInput(`data-rc="${cid}" data-f="gross" class="yzi-n" ${dis}`, line.gross)}</td>
                <td class="n">${numInput(`data-rc="${cid}" data-f="waste" class="yzi-n" ${dis}`, line.waste || 0)}</td>
                <td class="n">${fmtQty(netOf(line))}</td>
                ${showCost ? `<td class="n mut">${fmtMoney(unitCost(cid))}</td><td class="n"><b>${fmtMoney((Number(line.gross) || 0) * unitCost(cid))}</b></td>` : ''}
                <td>${canEdit ? `<button type="button" class="yzi-x" data-rcdel="${cid}" aria-label="Çıxar">✕</button>` : ''}</td></tr>`;
            }).join('')}
            ${canEdit ? `<tr><td colspan="${showCost ? 7 : 5}"><input type="text" id="yziEdRcAdd" placeholder="+ Tərkib əlavə et (kataloqdan axtar)…" class="yzi-dashed"></td></tr>` : ''}
          </tbody>${showCost ? `<tfoot><tr><td colspan="5">${d.type === 'semi' ? 'Reseptin mayası' : 'Porsiyanın mayası'}</td><td class="n"><b class="yzi-gold">${fmtMoney(rc)}</b></td><td></td></tr></tfoot>` : ''}</table>
          <small class="yzi-hint">Satışda anbardan <b>brutto</b> miqdar silinir. Netto yalnız məlumat üçündür (təmizləmə itkisindən sonra).</small>
        </section>` : ''}

        ${t.menu ? `<section class="yzi-card">
          <h3>Satış və menyu</h3>
          ${sw('showInMenu', 'Menyuda göstər', 'Sifariş ekranında satış mövqeyi kimi görünür', d.showInMenu !== false, canEdit)}
          ${sw('active', 'Satışda (tükənməyib)', 'Söndürəndə sifariş ekranında görünmür', d.active !== false, canEdit)}
          ${sw('isFavorite', 'Favori', 'Sifariş ekranında "★ Favorilər" bölməsində', !!d.isFavorite, canEdit)}
          ${sw('showInQr', 'QR menyuda göstər', 'Müştəri menyusunda görünür', d.showInQr !== false, canEdit)}
          ${sw('vatIncluded', 'ƏDV qiymətə daxildir', 'Söndürülsə ƏDV qiymətin üstünə əlavə olunur', d.vatIncluded !== false, canPrice)}
          <div class="yzi-f"><span>Qiymət növü</span>
            <div class="yzi-seg" id="yziEdPm"><button type="button" data-pm="fixed" class="${d.pricingMode !== 'hourly' ? 'is-on' : ''}" ${canPrice ? '' : 'disabled'}>Sabit qiymət</button><button type="button" data-pm="hourly" class="${d.pricingMode === 'hourly' ? 'is-on' : ''}" ${canPrice ? '' : 'disabled'}>Saatlıq ödəniş</button></div></div>
          <div class="yzi-grid3">
            ${d.pricingMode === 'hourly'
              ? `<label class="yzi-f"><span>1 saatın qiyməti (₼)</span>${numInput(`id="yziEdHour" ${canPrice ? '' : 'disabled'}`, d.hourlyRate)}</label>`
              : `<label class="yzi-f"><span>Satış qiyməti (₼)</span>${numInput(`id="yziEdPrice" ${canPrice ? '' : 'disabled'}`, d.price)}</label>`}
            <label class="yzi-f"><span>Mətbəx stansiyası</span><select id="yziEdKitchen" ${dis}><option value="">— Defolt —</option>${stations.map(k => `<option value="${k.id}"${k.id === d.kitchenId ? ' selected' : ''}>${esc(k.name)}</option>`).join('')}</select></label>
            ${d.type !== 'service' || Object.keys(d.recipe).length ? `<label class="yzi-f"><span>Satışda silinən anbar</span><select id="yziEdSaleWh" ${dis}><option value="">Defolt anbar</option>${whOptions(d.saleWarehouseId, { noDefault: true })}</select></label>` : ''}
          </div>
          ${d.pricingMode === 'hourly' ? '<small class="yzi-hint">Sifarişdə miqdar = saat sayı (0.5 addımla). Məs: 1.5 saat × qiymət.</small>' : ''}
          ${showCost ? `<div class="yzi-profit">
            <div><small>Satış (ƏDV-siz)</small><b>${fmtMoney(mi.net)}</b></div>
            <div><small>ƏDV</small><b>${fmtMoney(mi.vat)}</b></div>
            <div><small>Maya</small><b>${fmtMoney(mi.cost)}</b></div>
            <div><small>Qazanc</small><b class="${mi.profit < 0 ? 'yzi-bad' : 'yzi-ok'}">${fmtMoney(mi.profit)}</b></div>
            <div><small>Maya faizi</small><b class="${mi.pct !== null && mi.pct > (Number(inv.settings.foodCostTarget) || 35) ? 'yzi-warn' : ''}">${mi.pct === null ? '—' : mi.pct + '%'}</b></div>
          </div>` : ''}
        </section>` : ''}

        ${t.menu ? `<section class="yzi-card">
          <h3>Allergenlər (QR menyu üçün)</h3>
          <div class="yzi-checks">${ALLERGENS.map(a => `<label><input type="checkbox" data-alg="${esc(a)}" ${d.allergens[a] ? 'checked' : ''} ${dis}> ${esc(a)}</label>`).join('')}</div>
        </section>` : ''}

        ${old && (old.priceHistory) ? `<section class="yzi-card">
          <h3>Qiymət tarixçəsi</h3>
          ${Object.values(old.priceHistory).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 12).map(h => `<div class="yzi-row"><span class="mut">${fmtDT(h.at)} · ${esc(h.by || '')}</span><span>${fmtMoney(h.from)} → <b>${fmtMoney(h.to)}</b></span></div>`).join('')}
        </section>` : ''}
      </div>`;
    bind();
  }
  function sw(key, label, hint, on, enabled) {
    return `<div class="yzi-swrow"><div><b>${label}</b><small>${hint}</small></div>
      <button type="button" class="yzi-switch${on ? ' is-on' : ''}" role="switch" aria-checked="${on}" aria-label="${label}" data-sw="${key}" ${enabled ? '' : 'disabled'}><span></span></button></div>`;
  }
  function collect() {
    const g = (sel) => root.querySelector(sel);
    if (g('#yziEdName')) d.name = g('#yziEdName').value.trim();
    if (g('#yziEdCat')) d.category = g('#yziEdCat').value.trim();
    if (g('#yziEdBar')) d.barcode = g('#yziEdBar').value.trim();
    if (g('#yziEdDesc')) d.description = g('#yziEdDesc').value.trim();
    if (g('#yziEdUnit')) d.unit = g('#yziEdUnit').value;
    if (g('#yziEdVat')) d.vatRate = Number.isFinite(num(g('#yziEdVat').value)) ? num(g('#yziEdVat').value) : 0;
    if (g('#yziEdMin')) d.minQty = Number.isFinite(num(g('#yziEdMin').value)) ? num(g('#yziEdMin').value) : null;
    if (g('#yziEdReorder')) d.reorderQty = Number.isFinite(num(g('#yziEdReorder').value)) ? num(g('#yziEdReorder').value) : null;
    if (g('#yziEdExp')) d.trackExpiry = g('#yziEdExp').value === '1';
    if (g('#yziEdYield')) d.yieldQty = num(g('#yziEdYield').value) > 0 ? num(g('#yziEdYield').value) : 1;
    if (g('#yziEdPrice')) d.price = Number.isFinite(num(g('#yziEdPrice').value)) ? r2(num(g('#yziEdPrice').value)) : 0;
    if (g('#yziEdHour')) d.hourlyRate = Number.isFinite(num(g('#yziEdHour').value)) ? r2(num(g('#yziEdHour').value)) : 0;
    if (g('#yziEdKitchen')) d.kitchenId = g('#yziEdKitchen').value || null;
    if (g('#yziEdSaleWh')) d.saleWarehouseId = g('#yziEdSaleWh').value || null;
    root.querySelectorAll('[data-pk]').forEach(i => { const pk = d.packs[i.dataset.pk]; if (!pk) return; pk[i.dataset.f] = i.dataset.f === 'factor' ? num(i.value) : i.value.trim(); });
    root.querySelectorAll('[data-rc]').forEach(i => { const l = d.recipe[i.dataset.rc]; if (!l) return; const v = num(i.value); l[i.dataset.f] = Number.isFinite(v) ? r4(v) : 0; });
    root.querySelectorAll('[data-alg]').forEach(i => { if (i.checked) d.allergens[i.dataset.alg] = true; else delete d.allergens[i.dataset.alg]; });
  }
  function bind() {
    root.querySelector('#yziEdType')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-t]'); if (!b || !canEdit) return;
      collect();
      const nt = b.dataset.t;
      if (old && PTYPES[old.type]?.stock && !PTYPES[nt].stock && totalStock(id) > 0.0001) { fail('Qalığı olan məhsulun növü stoksuz növə dəyişə bilməz'); return; }
      d.type = nt;
      if (nt === 'goods' && !d.unit) d.unit = 'ədəd';
      if ((nt === 'dish' || nt === 'service') && (!d.unit || ['kq', 'qr', 'litr', 'ml'].includes(d.unit))) d.unit = 'porsiya';
      if (!PTYPES[nt].menu) d.showInMenu = false;
      draw();
    });
    root.querySelector('#yziEdPm')?.addEventListener('click', (e) => { const b = e.target.closest('[data-pm]'); if (!b) return; collect(); d.pricingMode = b.dataset.pm; draw(); });
    root.querySelectorAll('[data-sw]').forEach(b => b.addEventListener('click', () => {
      collect(); const k = b.dataset.sw;
      const cur = (k === 'isFavorite') ? !!d[k] : d[k] !== false;
      d[k] = !cur; draw();
    }));
    root.querySelectorAll('[data-vat]').forEach(b => b.addEventListener('click', () => { collect(); d.vatRate = Number(b.dataset.vat); draw(); }));
    root.querySelector('[data-act="addpack"]')?.addEventListener('click', () => { collect(); d.packs['p' + Date.now().toString(36)] = { name: '', factor: '' }; draw(); });
    root.querySelectorAll('[data-pkdel]').forEach(b => b.addEventListener('click', () => { collect(); delete d.packs[b.dataset.pkdel]; draw(); }));
    root.querySelectorAll('[data-rcdel]').forEach(b => b.addEventListener('click', () => { collect(); delete d.recipe[b.dataset.rcdel]; draw(); }));
    root.querySelectorAll('[data-rc]').forEach(i => i.addEventListener('change', () => { collect(); draw(); }));
    ['#yziEdPrice', '#yziEdHour', '#yziEdVat'].forEach(s => root.querySelector(s)?.addEventListener('change', () => { collect(); draw(); }));
    const rcAdd = root.querySelector('#yziEdRcAdd');
    if (rcAdd) attachPicker(rcAdd, {
      types: ['raw', 'semi', 'goods', ...(d.type === 'dish' || d.type === 'service' ? ['dish'] : [])],
      createTypes: ['raw', 'semi', 'goods'],
      onPick: (c) => {
        collect();
        if (c.id === id) { fail('Məhsul özünün tərkibi ola bilməz'); return; }
        if (!d.recipe[c.id]) d.recipe[c.id] = { gross: c.unit === 'ədəd' ? 1 : 0.1, waste: 0 };
        draw();
        setTimeout(() => root.querySelector(`[data-rc="${c.id}"][data-f="gross"]`)?.select(), 30);
      }
    });
    const nameI = root.querySelector('#yziEdName');
    if (nameI && !old) nameI.addEventListener('input', () => {
      const s = findSimilar(nameI.value, id);
      root.querySelector('#yziEdSim').innerHTML = s.length ? `<div class="yzi-warnbox"><b>Oxşar məhsul artıq var:</b> ${s.map(p => esc(p.name)).join(', ')}. Təkrar kart yaratmayın.</div>` : '';
    });
    root.querySelector('#yziEdPhoto')?.addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try { collect(); d.photo = await compressImage(file); draw(); } catch (er) { fail(er.message); }
    });
  }
  async function save() {
    collect();
    const t = T();
    if (!d.name) throw new Error('Ad yazılmalıdır');
    if (t.menu && d.showInMenu !== false && !(Number(d.pricingMode === 'hourly' ? d.hourlyRate : d.price) > 0)) throw new Error('Menyuda görünən məhsulun satış qiyməti olmalıdır');
    if (t.recipe && d.type === 'dish' && !Object.keys(d.recipe).length && !old) {
      const go1 = await confirmBox('Texnoloji kart (resept) boşdur. Satışda anbardan heç nə silinməyəcək. Davam edilsin?');
      if (!go1) throw new Error('Reseptə tərkib əlavə edin');
    }
    const packs = {};
    Object.entries(d.packs).forEach(([k, pk]) => { if (pk.name && Number(pk.factor) > 0) packs[k] = { name: pk.name, factor: Number(pk.factor) }; });
    const recipe = {};
    Object.entries(d.recipe).forEach(([k, l]) => { if (Number(l.gross) > 0) recipe[k] = { gross: r4(l.gross), waste: r2(l.waste || 0) }; });
    const data = {
      name: d.name, type: d.type, category: d.category || '', barcode: d.barcode || '', description: d.description || '',
      unit: d.unit || 'ədəd', vatRate: Number(d.vatRate) || 0, vatIncluded: d.vatIncluded !== false,
      packs: t.buy && Object.keys(packs).length ? packs : null,
      recipe: t.recipe && Object.keys(recipe).length ? recipe : null,
      yieldQty: d.type === 'semi' ? (Number(d.yieldQty) || 1) : null,
      minQty: t.stock && Number.isFinite(Number(d.minQty)) && d.minQty !== null ? Number(d.minQty) : null,
      reorderQty: t.stock && Number.isFinite(Number(d.reorderQty)) && d.reorderQty !== null ? Number(d.reorderQty) : null,
      trackExpiry: t.stock ? !!d.trackExpiry : null,
      showInMenu: t.menu ? d.showInMenu !== false : false,
      active: d.active !== false, isFavorite: t.menu ? !!d.isFavorite : false, showInQr: d.showInQr !== false,
      pricingMode: t.menu && d.pricingMode === 'hourly' ? 'hourly' : 'fixed',
      price: t.menu && d.pricingMode !== 'hourly' ? r2(d.price) : (t.menu ? null : null),
      hourlyRate: t.menu && d.pricingMode === 'hourly' ? r2(d.hourlyRate) : null,
      kitchenId: t.menu ? (d.kitchenId || null) : null,
      saleWarehouseId: d.saleWarehouseId || null,
      allergens: Object.keys(d.allergens).length ? d.allergens : null,
      photo: d.photo || '',
      incomplete: null
    };
    if (data.pricingMode === 'fixed' && t.menu && old && Number(old.price) !== Number(data.price)) { /* tarixçə saveProduct-da yazılır */ }
    const pid = await saveProduct(id, data);
    ok(old ? 'Məhsul yeniləndi' : 'Məhsul yaradıldı');
    return pid;
  }
  function typeHint(t) {
    return {
      raw: 'Alınır, anbarda saxlanır, reseptlərdə istifadə olunur. Menyuda heç vaxt görünmür.',
      goods: 'Alınır və olduğu kimi satılır (içki, su). Menyuya çıxarmaq düymə ilə idarə olunur.',
      semi: 'Öz mətbəxinizdə hazırlanan aralıq məhsul (sous, xəmir). Anbarda saxlanır, menyuda görünmür.',
      dish: 'Menyuda satılır, öz qalığı yoxdur. Satışda texnoloji karta görə xammal silinir.',
      service: 'Menyuda satılan xidmət (qəlyan, bilyard, otaq). İstəyə görə saatlıq qiymət və resept.'
    }[t] || '';
  }
  draw();
}

/* ═══ ANBARLAR ═══ */
function renderWarehouses(el) {
  const list = warehouseList(true);
  const showCost = can('catalog.cost');
  const defId = defaultWarehouseId();
  el.innerHTML = `
    <div class="yzi-head"><div><div class="yzi-eyebrow">ANBARLAR</div><h1 class="yzi-h1">Anbarlar</h1></div>
      <div class="yzi-actions"><button type="button" class="yzi-btn yzi-btn--gold" data-wh-new>+ Yeni anbar</button></div></div>
    <div class="yzi-cards">${list.map(w => {
      const items = Object.entries(inv.stock[w.id] || {}).filter(([pid, q]) => Math.abs(q) > 0.0001 && inv.products[pid]);
      const val = items.reduce((s, [pid, q]) => s + q * unitCost(pid), 0);
      return `<div class="yzi-whcard${w.archived ? ' is-off' : ''}">
        <div class="yzi-row"><b class="yzi-whcard__name">${esc(w.name)}</b>${w.id === defId ? '<span class="yzi-chip yzi-chip--gold">alış defoltu</span>' : ''}${w.archived ? '<span class="yzi-chip">arxiv</span>' : ''}</div>
        <div class="mut">${esc(w.responsible ? 'Məsul: ' + w.responsible : 'Məsul təyin olunmayıb')}</div>
        <div class="yzi-row"><span class="mut">Məhsul</span><b>${items.length}</b></div>
        ${showCost ? `<div class="yzi-row"><span class="mut">Dəyər</span><b>${fmtMoney(val)}</b></div>` : ''}
        <div class="yzi-row yzi-row--btns">
          <button type="button" class="yzi-btn yzi-btn--sm yzi-btn--ghost" data-wh-edit="${w.id}">Redaktə</button>
          ${w.id !== defId && !w.archived ? `<button type="button" class="yzi-btn yzi-btn--sm yzi-btn--ghost" data-wh-def="${w.id}">Defolt et</button>` : ''}
        </div>
      </div>`;
    }).join('') || '<p class="yzi-empty">Hələ anbar yoxdur.</p>'}</div>
    <div class="yzi-card yzi-rules">
      <h3>Qaydalar</h3>
      <p><b>Alış</b> — qaimədə anbar seçilir, defolt "alış defoltu" olan anbardır.</p>
      <p><b>Satış</b> — hər məhsulun kartında "satışda silinən anbar" seçilə bilər; boşdursa defolt anbardan silinir.</p>
      <p><b>Qalıq mənfiyə düşsə</b> — satış dayanmır, amma qalıq qırmızı görünür. Bu, alışın və ya sayımın yazılmadığını göstərir.</p>
      <p><b>Anbar silinmir</b> — qalığı olan anbar yalnız boşaldıqdan sonra arxivə köçürülür.</p>
    </div>`;
  el.querySelector('[data-wh-new]').addEventListener('click', () => whEditor(null));
  el.querySelectorAll('[data-wh-edit]').forEach(b => b.addEventListener('click', () => whEditor(b.dataset.whEdit)));
  el.querySelectorAll('[data-wh-def]').forEach(b => b.addEventListener('click', async () => {
    await db.ref('settings/inventory/defaultWarehouseId').set(b.dataset.whDef); ok('Defolt anbar dəyişdi');
  }));
}
export function whEditor(id) {
  const w = id ? { id, ...inv.warehouses[id] } : {};
  const staffOpts = (state.staff || []).map(s => `<option value="${esc(s.name)}"${s.name === w.responsible ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
  modal({
    title: id ? 'Anbarı redaktə et' : 'Yeni anbar',
    body: `<label class="yzi-f"><span>Ad *</span><input type="text" id="yziWhName" value="${esc(w.name || '')}" placeholder="məs: Bar, Soyuducu, Mətbəx"></label>
      <label class="yzi-f"><span>Məsul şəxs</span><select id="yziWhResp"><option value="">—</option>${staffOpts}</select></label>
      <label class="yzi-f"><span>Sıra</span>${numInput('id="yziWhOrder"', w.order ?? '')}</label>
      ${id ? `<label class="yzi-check"><input type="checkbox" id="yziWhArch" ${w.archived ? 'checked' : ''}> Arxivdədir (yeni sənədlərdə görünmür)</label>` : ''}`,
    actions: [{ label: 'Ləğv', cancel: true, cls: 'yzi-btn--ghost' }, { label: 'Yadda saxla', cls: 'yzi-btn--gold', onClick: async () => {
      const name = $('yziWhName').value.trim(); if (!name) throw new Error('Ad yazılmalıdır');
      const arch = !!$('yziWhArch')?.checked;
      if (arch && Object.values(inv.stock[id] || {}).some(q => Math.abs(q) > 0.0001)) throw new Error('Qalığı olan anbar arxivlənə bilməz');
      if (arch && id === defaultWarehouseId()) throw new Error('Defolt anbar arxivlənə bilməz');
      const data = { name, responsible: $('yziWhResp').value || '', order: Number(num($('yziWhOrder').value)) || 99, archived: arch };
      if (id) await db.ref('warehouses/' + id).update(data); else await db.ref('warehouses').push({ ...data, createdAt: Date.now() });
      ok('Yadda saxlanıldı');
    } }]
  });
}

/* ═══ PARAMETRLƏR (yalnız admin) ═══ */
function renderSettings(el) {
  const s = inv.settings;
  const v2 = isV2();
  el.innerHTML = `
    <div class="yzi-head"><div><div class="yzi-eyebrow">ANBAR</div><h1 class="yzi-h1">Parametrlər</h1></div></div>
    <section class="yzi-card">
      <h3>Sistem rejimi</h3>
      <p class="yzi-p">Hazırkı rejim: <b class="${v2 ? 'yzi-ok' : 'yzi-warn'}">${v2 ? 'Yeni anbar sistemi (aktiv)' : 'Köhnə sistem'}</b>${s.migratedAt ? ` · köçürmə: ${fmtDT(s.migratedAt)} (${esc(s.migratedBy || '')})` : ''}</p>
      ${v2 ? `<p class="yzi-hint">Geri qaytarmaq lazım olsa, rejimi köhnəyə çevirə bilərsiniz. Heç bir məlumat silinmir, amma köhnə rejimdə yeni kataloqdakı qalıqlar yenilənməyəcək.</p>
        <button type="button" class="yzi-btn yzi-btn--ghost" data-rollback>Köhnə rejimə qaytar</button>`
      : `<p class="yzi-p">Köçürmə zamanı: menyu malları → kataloq (sayıla bilən → <b>Hazır mal</b>, qalanı → <b>Yemək</b>), xammadə → <b>Xammal</b>, reseptlər → texnoloji kart, qalıqlar → "Əsas anbar", təchizatçı borcları → ilkin qalıq. Əvvəlcə bütün köhnə məlumatın ehtiyat nüsxəsi götürülür.</p>
        <p class="yzi-warnbox"><b>Vacib:</b> köçürməni əvvəlcə TEST Firebase-də yoxlayın.</p>
        <button type="button" class="yzi-btn yzi-btn--ghost" data-dry>1) Nə köçürüləcəyini göstər</button>
        <div id="yziDry"></div>`}
    </section>
    <section class="yzi-card">
      <h3>Mühasibat parametrləri</h3>
      <div class="yzi-swrow"><div><b>ƏDV ödəyicisiyik</b><small>Bəli olsa, alışdakı ƏDV mayaya daxil edilmir (əvəzləşdirilir). Xeyr olsa, maya ƏDV ilə hesablanır.</small></div>
        <button type="button" class="yzi-switch${s.vatPayer ? ' is-on' : ''}" role="switch" aria-checked="${!!s.vatPayer}" aria-label="ƏDV ödəyicisi" data-set="vatPayer"><span></span></button></div>
      <div class="yzi-swrow"><div><b>İşçi öz sənədini təsdiqləyə bilsin</b><small>Söndürülü olanda sənədi yazan işçi onu özü təsdiqləyə bilməz — ikinci şəxs (admin/mühasib) lazımdır. Admin həmişə təsdiqləyə bilər.</small></div>
        <button type="button" class="yzi-switch${s.allowSelfApprove ? ' is-on' : ''}" role="switch" aria-checked="${!!s.allowSelfApprove}" aria-label="Öz sənədini təsdiq" data-set="allowSelfApprove"><span></span></button></div>
      <div class="yzi-grid3">
        <label class="yzi-f"><span>Defolt ƏDV (%)</span>${numInput('data-num="defaultVat"', s.defaultVat ?? 18)}</label>
        <label class="yzi-f"><span>Hədəf maya faizi (%)</span>${numInput('data-num="foodCostTarget"', s.foodCostTarget ?? 35)}</label>
        <label class="yzi-f"><span>Qiymət sıçrayışı xəbərdarlığı (%)</span>${numInput('data-num="priceJumpPct"', s.priceJumpPct ?? 15)}</label>
      </div>
    </section>`;
  el.querySelectorAll('[data-set]').forEach(b => b.addEventListener('click', async () => {
    const k = b.dataset.set; await db.ref('settings/inventory/' + k).set(!s[k]); ok('Yadda saxlanıldı');
  }));
  el.querySelectorAll('[data-num]').forEach(i => i.addEventListener('change', async () => {
    const v = num(i.value); if (!Number.isFinite(v) || v < 0) { fail('Düzgün rəqəm yazın'); return; }
    await db.ref('settings/inventory/' + i.dataset.num).set(v); ok('Yadda saxlanıldı');
  }));
  el.querySelector('[data-rollback]')?.addEventListener('click', async () => {
    const c = await confirmBox('Rejim köhnəyə qaytarılsın? Satışda stok yenidən köhnə üsulla silinəcək.', { okCls: 'yzi-btn--red' });
    if (c) { await rollbackMode(); ok('Köhnə rejim'); }
  });
  el.querySelector('[data-dry]')?.addEventListener('click', async () => {
    try {
      const plan = await migrateToV2({ dryRun: true });
      const box = el.querySelector('#yziDry');
      box.innerHTML = `<div class="yzi-mini-kpis">
          <div><small>Hazır mal</small><b>${plan.counts.goods}</b></div><div><small>Yemək</small><b>${plan.counts.dish}</b></div>
          <div><small>Xammal</small><b>${plan.counts.raw}</b></div><div><small>Qalığı olan</small><b>${plan.counts.withStock}</b></div>
          <div><small>Borclu təchizatçı</small><b>${plan.counts.suppliers}</b></div></div>
        ${plan.newWarehouse ? '<p class="yzi-hint">"Əsas anbar" yaradılacaq, bütün qalıqlar ora yazılacaq.</p>' : ''}
        ${plan.warnings.length ? `<div class="yzi-warnbox"><b>Diqqət:</b><ul>${plan.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
        <table class="yzi-table yzi-table--mini"><thead><tr><th>Məhsul</th><th>Yeni növ</th><th class="n">Qalıq</th></tr></thead><tbody>
        ${Object.entries(plan.products).slice(0, 300).map(([pid, p]) => `<tr><td>${esc(p.name)}</td><td>${typeChip(p.type)}</td><td class="n">${plan.stock[pid] !== undefined ? fmtQty(plan.stock[pid]) + ' ' + esc(p.unit) : '—'}</td></tr>`).join('')}
        </tbody></table>
        <p class="yzi-hint">Yemək kimi götürülən, amma əslində hazır mal olanları köçürmədən sonra kataloqda düzəldə bilərsiniz.</p>
        <button type="button" class="yzi-btn yzi-btn--gold" data-run>2) Köçürməni başlat</button>`;
      box.querySelector('[data-run]').addEventListener('click', async () => {
        const v = await confirmBox('Köçürmə başlasın? Davam etmək üçün aşağıya <b>KÖÇÜR</b> yazın.', { input: 'Təsdiq sözü', okLabel: 'Köçür', okCls: 'yzi-btn--red' });
        if (v === null) return;
        if (String(v).toUpperCase() !== 'KÖÇÜR') { fail('Təsdiq sözü düz deyil'); return; }
        try { await migrateToV2({ dryRun: false }); ok('Köçürmə tamamlandı. Yeni anbar sistemi aktivdir.'); go('catalog'); }
        catch (e) { fail(e.message); }
      });
    } catch (e) { fail(e.message); }
  });
}

/* ═══ QEYDİYYAT ═══ */
registerTab({ id: 'catalog', group: 'reg', label: 'Məhsullar', order: 40, perm: () => can('catalog.view') || can('catalog.edit'), render: renderCatalog, live: ['products', 'stock', 'warehouses'] });
registerTab({ id: 'warehouses', group: 'reg', label: 'Anbarlar', order: 41, perm: () => can('warehouse.manage'), render: renderWarehouses, live: ['warehouses', 'stock', 'settings'] });
registerTab({ id: 'settings', group: 'sys', label: 'Anbar parametrləri', order: 90, perm: () => isAdmin(), render: renderSettings, live: ['settings'], legacyOk: true });
