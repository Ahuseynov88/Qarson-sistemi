/* ═══════════════════════════════════════════
   YUZA POS — XAMMADƏ (Mərhələ 2)
   Admin → Menyu → "🧂 Xammadə" düyməsi: xammadə siyahısı, anbar qalığı, vahid qiyməti,
   minimum qalıq (Mərhələ 3-də bildiriş üçün), alış (qalığı artırma).
   Məlumat bazada: ingredients/{id} = { name, unit, stock, cost, minQty, createdAt }
   Mal reseptləri: menuItems/{malId}/recipe = { xammadəId: 1 porsiyaya sərf olunan miqdar }
   Satış zamanı sərf utils.js → updateStock() içində avtomatik çıxılır/qaytarılır.
═══════════════════════════════════════════ */
import { db } from './firebase-service.js';
import { state } from './state.js';
import { esc, showToast, addLog, confirmAction } from './utils.js';

const $ = (id) => document.getElementById(id);
const isAdmin = () => state.user?.role === 'admin';
const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : NaN; };
const r3 = (n) => Math.round(n * 1000) / 1000;
export const UNITS = ['kq', 'qr', 'litr', 'ml', 'ədəd'];
const ref = () => db.ref('ingredients');

let list = [];                       // [{id, name, unit, stock, cost, minQty}]
const listeners = new Set();
export const getIngredients = () => list;
export const onIngredients = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const fmtQty = (n) => (Math.round(Number(n || 0) * 1000) / 1000).toString();

function startListening() {
  ref().on('value', (snap) => {
    const v = snap.val() || {};
    list = Object.entries(v).map(([id, x]) => ({ id, ...x })).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'az'));
    state.ingredients = list;
    listeners.forEach(fn => { try { fn(list); } catch (e) {} });
    if ($('yzIngModal')?.classList.contains('open')) renderList();
  });
}

const isLow = (g) => g.minQty !== undefined && g.minQty !== null && g.minQty !== '' && Number(g.stock || 0) <= Number(g.minQty);

function rowHTML(g) {
  const low = isLow(g);
  return `<div class="yz-ing${low ? ' yz-ing--low' : ''}" data-id="${esc(g.id)}">
    <div class="yz-ing__top">
      <input class="yz-ing__name" data-f="name" value="${esc(g.name || '')}" aria-label="Ad">
      <select data-f="unit" aria-label="Vahid">${UNITS.map(u => `<option${u === g.unit ? ' selected' : ''}>${u}</option>`).join('')}</select>
      <button type="button" class="yz-qa__item-del" data-yz-ing-del title="Sil" aria-label="Sil">✕</button>
    </div>
    <div class="yz-ing__grid">
      <label><small>Qalıq (${esc(g.unit || '')})${low ? ' ⚠ az' : ''}</small><input data-f="stock" inputmode="decimal" value="${fmtQty(g.stock)}"></label>
      <label><small>Vahid qiyməti (₼/${esc(g.unit || '')})</small><input data-f="cost" inputmode="decimal" value="${g.cost ?? ''}" placeholder="0.00"></label>
      <label><small>Minimum qalıq</small><input data-f="minQty" inputmode="decimal" value="${g.minQty ?? ''}" placeholder="məs: 5"></label>
      <label><small>+ Alış (qalığa əlavə)</small>
        <span class="yz-ing__add"><input data-add inputmode="decimal" placeholder="miqdar"><button type="button" class="btn btn-green" data-yz-ing-add>+</button></span></label>
    </div>
  </div>`;
}

function renderList() {
  const el = $('yzIngList'); if (!el) return;
  const q = ($('yzIngSearch')?.value || '').trim().toLowerCase();
  const items = list.filter(g => !q || String(g.name || '').toLowerCase().includes(q));
  $('yzIngCount').textContent = String(list.length);
  el.innerHTML = items.length ? items.map(rowHTML).join('') : '<div class="yz-qa__empty">Xammadə yoxdur. Yuxarıdan əlavə et.</div>';
}

function build() {
  if ($('yzIngModal')) return;
  const w = document.createElement('div');
  w.className = 'modal-bg'; w.id = 'yzIngModal';
  w.innerHTML = `<div class="modal yz-qa yz-ingmodal" role="dialog" aria-modal="true">
    <h2>🧂 Xammadə (anbar)</h2>
    <p class="yz-qa__hint">Xammadəni burada qeyd et, sonra malın profilində <b>Resept</b> bölməsində hər porsiyaya nə qədər sərf olunduğunu yaz. Satış olduqca xammadə qalığı <b>avtomatik azalır</b>, sifariş ləğv olunanda qaytarılır.</p>
    <div class="yz-qa__row">
      <div class="form-group yz-qa__name"><label for="yzIngName">Ad *</label><input id="yzIngName" autocomplete="off" placeholder="Məs: Toyuq döşü"></div>
      <div class="form-group yz-qa__price"><label for="yzIngUnit">Vahid</label><select id="yzIngUnit">${UNITS.map(u => `<option>${u}</option>`).join('')}</select></div>
    </div>
    <div class="yz-qa__row">
      <div class="form-group yz-qa__price"><label for="yzIngStock">Qalıq</label><input id="yzIngStock" inputmode="decimal" placeholder="0"></div>
      <div class="form-group yz-qa__price"><label for="yzIngCost">Vahid qiyməti ₼</label><input id="yzIngCost" inputmode="decimal" placeholder="0.00"></div>
      <div class="form-group yz-qa__price"><label for="yzIngMin">Minimum qalıq</label><input id="yzIngMin" inputmode="decimal" placeholder="istəyə görə"></div>
    </div>
    <button type="button" class="btn btn-green yz-qa__add" id="yzIngAdd">+ Xammadə əlavə et</button>
    <p class="yz-qa__msg" id="yzIngMsg" aria-live="polite"></p>
    <div class="yz-qa__listhead"><span>Siyahı</span><span id="yzIngCount">0</span></div>
    <input id="yzIngSearch" class="yz-ing__search" placeholder="Axtar..." autocomplete="off">
    <div class="yz-qa__list yz-ing__list" id="yzIngList"></div>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" data-cancel id="yzIngDone">Bağla</button></div>
  </div>`;
  document.body.appendChild(w);
  $('yzIngDone').addEventListener('click', close);
  w.addEventListener('mousedown', (e) => { if (e.target === w) close(); });
  $('yzIngAdd').addEventListener('click', addNew);
  $('yzIngName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addNew(); } });
  $('yzIngSearch').addEventListener('input', renderList);
  $('yzIngList').addEventListener('change', onEdit);
  $('yzIngList').addEventListener('click', onClick);
}

function msg(t, err) { const e = $('yzIngMsg'); e.textContent = t || ''; e.classList.toggle('yz-qa__msg--err', !!err); }

function addNew() {
  const name = $('yzIngName').value.trim();
  if (!name) { msg('Ad yazılmayıb.', true); $('yzIngName').focus(); return; }
  if (list.some(g => String(g.name).trim().toLowerCase() === name.toLowerCase())) { msg(`"${name}" artıq var.`, true); return; }
  const stock = num($('yzIngStock').value), cost = num($('yzIngCost').value), minQ = num($('yzIngMin').value);
  const data = { name, unit: $('yzIngUnit').value, stock: Number.isFinite(stock) ? r3(stock) : 0, createdAt: Date.now() };
  if (Number.isFinite(cost)) data.cost = r3(cost);
  if (Number.isFinite(minQ)) data.minQty = r3(minQ);
  ref().push(data);
  addLog('ingredient', `Xammadə əlavə edildi: ${name}`, {});
  ['yzIngName', 'yzIngStock', 'yzIngCost', 'yzIngMin'].forEach(i => { $(i).value = ''; });
  msg(`"${name}" əlavə olundu.`); $('yzIngName').focus();
}

function onEdit(e) {
  const row = e.target.closest('.yz-ing'); const f = e.target.dataset.f;
  if (!row || !f) return;
  const id = row.dataset.id, g = list.find(x => x.id === id); if (!g) return;
  let v = e.target.value;
  if (f === 'name') {
    v = v.trim(); if (!v) { e.target.value = g.name; return; }
  } else if (f === 'unit') {
    /* vahid dəyişir */
  } else {
    if (String(v).trim() === '') v = null;
    else { const n = num(v); if (!Number.isFinite(n) || n < 0) { showToast('Düzgün rəqəm yaz'); e.target.value = g[f] ?? ''; return; } v = r3(n); }
    if (f === 'stock' && v === null) v = 0;
  }
  ref().child(id).update({ [f]: v });
  if (f === 'stock') addLog('ingredient', `Xammadə qalığı təyin edildi: ${g.name} (${fmtQty(g.stock)} → ${v})`, {});
}

function onClick(e) {
  const row = e.target.closest('.yz-ing'); if (!row) return;
  const id = row.dataset.id, g = list.find(x => x.id === id); if (!g) return;
  if (e.target.closest('[data-yz-ing-add]')) {
    const inp = row.querySelector('[data-add]'); const n = num(inp.value);
    if (!Number.isFinite(n) || n <= 0) { showToast('Düzgün miqdar yaz'); return; }
    ref().child(id).child('stock').transaction(c => r3((c || 0) + n));
    addLog('ingredient', `Xammadə alışı: ${g.name} +${n} ${g.unit}`, {});
    inp.value = ''; showToast(`${g.name} +${n} ${g.unit}`);
  } else if (e.target.closest('[data-yz-ing-del]')) {
    const used = (state.menuItems || []).filter(m => m.recipe && m.recipe[id] !== undefined).length;
    confirmAction(`"${esc(g.name)}" silinsin?${used ? `<br><b>${used} malın reseptində istifadə olunur</b> — o reseptlərdən də çıxarılacaq.` : ''}`, () => {
      (state.menuItems || []).forEach(m => { if (m.recipe && m.recipe[id] !== undefined) db.ref('menuItems/' + m.id + '/recipe/' + id).remove(); });
      ref().child(id).remove();
      addLog('ingredient', `Xammadə silindi: ${g.name}`, {});
    });
  }
}

function open() { build(); msg(''); renderList(); $('yzIngModal').classList.add('open'); setTimeout(() => $('yzIngName').focus(), 50); }
function close() { $('yzIngModal')?.classList.remove('open'); }

function mount() {
  const sec = $('sec-menu');
  if (!sec || $('yzIngOpen')) return;
  let bar = sec.querySelector('.yz-qa-bar');
  if (!bar) { bar = document.createElement('div'); bar.className = 'yz-qa-bar'; sec.insertBefore(bar, sec.firstChild); }
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'btn btn-ghost'; b.id = 'yzIngOpen'; b.textContent = '🧂 Xammadə';
  b.addEventListener('click', open);
  bar.insertBefore(b, bar.firstChild);
}

function boot() { startListening(); mount(); setTimeout(mount, 600); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
