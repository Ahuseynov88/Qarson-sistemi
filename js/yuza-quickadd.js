/* ═══════════════════════════════════════════
   YUZA POS — SÜRƏTLİ MAL ƏLAVƏSİ (Admin → Menyu)
   Ad + qiymət + kateqoriya yazıb Enter basırsan, mal dərhal menyuya düşür və
   aşağıdakı siyahıda görünür; sahələr təmizlənir, növbəti malı yazırsan.
   Şəkil, təsvir, stok izləmə kimi digər ayarları sonra malın öz profilində dəyişirsən.

   admin.js-ə toxunmur: eyni verilənlər bazası yolunu (menuItems) və eyni sahələri
   (name, category, price, description, photo, isTrackable, available, createdAt)
   istifadə edir, buna görə əlavə olunan mal adi əlavə edilən mal ilə eynidir.
═══════════════════════════════════════════ */
import { R } from './firebase-service.js';
import { state } from './state.js';
import { esc, showToast, addLog } from './utils.js';

const $ = (id) => document.getElementById(id);
const NEW_CAT = '__new__';
let added = [];            // bu pəncərədə əlavə edilənlər: {id,name,category,price}
let stickyCategory = '';   // son seçilən kateqoriya

const okIcon  = '<svg class="icon"><use href="#i-check"></use></svg>';
const errIcon = '<svg class="icon"><use href="#i-error"></use></svg>';

function existingCategories() {
  return [...new Set((state.menuItems || []).map(m => m.category).filter(Boolean))];
}

function buildModal() {
  if ($('yzQaModal')) return;
  const wrap = document.createElement('div');
  wrap.className = 'modal-bg';
  wrap.id = 'yzQaModal';
  wrap.innerHTML = `
    <div class="modal yz-qa" role="dialog" aria-modal="true" aria-labelledby="yzQaTitle">
      <h2 id="yzQaTitle">⚡ Sürətli Mal Əlavəsi</h2>
      <p class="yz-qa__hint">Ad və qiyməti yaz, <b>Enter</b> bas — mal dərhal əlavə olunur. Şəkil və digər ayarları sonra malın profilində dəyişə bilərsən.</p>

      <div class="yz-qa__row">
        <div class="form-group yz-qa__name">
          <label for="yzQaName">Mal adı *</label>
          <input type="text" id="yzQaName" placeholder="Məs: Toyuq Şişlik" autocomplete="off">
        </div>
        <div class="form-group yz-qa__price">
          <label for="yzQaPrice">Qiymət (₼) *</label>
          <input type="text" id="yzQaPrice" inputmode="decimal" placeholder="12.50" autocomplete="off">
        </div>
      </div>
      <div class="yz-qa__row">
        <div class="form-group yz-qa__cat">
          <label for="yzQaCat">Kateqoriya *</label>
          <select id="yzQaCat"></select>
        </div>
        <div class="form-group yz-qa__cat" id="yzQaNewCatWrap" style="display:none;">
          <label for="yzQaNewCat">Yeni kateqoriya adı *</label>
          <input type="text" id="yzQaNewCat" placeholder="Məs: Salatlar" autocomplete="off">
        </div>
      </div>

      <button type="button" class="btn btn-green yz-qa__add" id="yzQaAdd">+ Əlavə et</button>
      <p class="yz-qa__msg" id="yzQaMsg" aria-live="polite"></p>

      <div class="yz-qa__listhead"><span>Əlavə edilənlər</span><span id="yzQaCount">0</span></div>
      <div class="yz-qa__list" id="yzQaList"></div>

      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-cancel id="yzQaDone">Bitdi</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  $('yzQaAdd').addEventListener('click', addItem);
  $('yzQaDone').addEventListener('click', closeModal);
  $('yzQaCat').addEventListener('change', onCatChange);
  $('yzQaName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('yzQaPrice').focus(); }
  });
  $('yzQaPrice').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addItem(); }
  });
  $('yzQaNewCat').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('yzQaName').focus(); }
  });
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) closeModal(); });
  $('yzQaList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-yz-remove]');
    if (btn) removeItem(btn.getAttribute('data-yz-remove'));
  });
}

function fillCategories(selectValue) {
  const sel = $('yzQaCat');
  const cats = existingCategories();
  if (selectValue && selectValue !== NEW_CAT && !cats.includes(selectValue)) cats.push(selectValue);
  const wanted = selectValue || stickyCategory || cats[0] || NEW_CAT;
  sel.innerHTML = cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')
    + `<option value="${NEW_CAT}">+ Yeni kateqoriya...</option>`;
  sel.value = cats.includes(wanted) || wanted === NEW_CAT ? wanted : (cats[0] || NEW_CAT);
  onCatChange(false);
}

function onCatChange(focus = true) {
  const isNew = $('yzQaCat').value === NEW_CAT;
  $('yzQaNewCatWrap').style.display = isNew ? '' : 'none';
  if (isNew && focus !== false) $('yzQaNewCat').focus();
}

function setMsg(text, isErr) {
  const el = $('yzQaMsg');
  el.textContent = text || '';
  el.classList.toggle('yz-qa__msg--err', !!isErr);
}

function parsePrice(raw) {
  const n = parseFloat(String(raw || '').trim().replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
}

function addItem() {
  const name = $('yzQaName').value.trim();
  const price = parsePrice($('yzQaPrice').value);
  const sel = $('yzQaCat').value;
  const category = sel === NEW_CAT ? $('yzQaNewCat').value.trim() : sel.trim();

  if (!name)     { setMsg('Mal adı yazılmayıb.', true); $('yzQaName').focus(); return; }
  if (Number.isNaN(price)) { setMsg('Düzgün qiymət yaz (məs: 12.50).', true); $('yzQaPrice').focus(); return; }
  if (!category) { setMsg('Kateqoriya seçilməyib.', true); (sel === NEW_CAT ? $('yzQaNewCat') : $('yzQaCat')).focus(); return; }

  const dup = (state.menuItems || []).some(m =>
    (m.category || '') === category && String(m.name || '').trim().toLowerCase() === name.toLowerCase());
  if (dup) { setMsg(`"${name}" bu kateqoriyada artıq var.`, true); $('yzQaName').select(); return; }

  const data = { name, category, price, description: '', photo: '', isTrackable: false,
                 available: true, createdAt: Date.now() };
  let ref;
  try {
    ref = R.menuItems.push(data);
  } catch (err) {
    setMsg('Əlavə etmək alınmadı. İnternet bağlantısını yoxla.', true);
    return;
  }
  addLog('menu_mgmt', `Yeni mal əlavə edildi (sürətli): ${name}`, {});

  added.unshift({ id: ref && ref.key, name, category, price });
  stickyCategory = category;
  renderList();
  fillCategories(category);   // yeni kateqoriya siyahıya düşsün və seçilmiş qalsın

  $('yzQaName').value = '';
  $('yzQaPrice').value = '';
  setMsg(`"${name}" əlavə olundu.`, false);
  $('yzQaName').focus();
}

function removeItem(id) {
  const it = added.find(x => x.id === id);
  if (!it) return;
  try { R.menuItems.child(id).remove(); } catch (err) { setMsg('Silmək alınmadı.', true); return; }
  addLog('menu_mgmt', `Mal silindi (sürətli əlavədən): ${it.name}`, { menuItemId: id });
  added = added.filter(x => x.id !== id);
  renderList();
  setMsg(`"${it.name}" silindi.`, false);
}

function renderList() {
  $('yzQaCount').textContent = String(added.length);
  $('yzQaList').innerHTML = added.length
    ? added.map(it => `
        <div class="yz-qa__item">
          <div class="yz-qa__item-main">
            <b>${esc(it.name)}</b>
            <small>${esc(it.category)}</small>
          </div>
          <span class="yz-qa__item-price">${it.price.toFixed(2)} ₼</span>
          <button type="button" class="yz-qa__item-del" data-yz-remove="${esc(it.id || '')}" aria-label="Sil" title="Sil">✕</button>
        </div>`).join('')
    : '<div class="yz-qa__empty">Hələ heç nə əlavə edilməyib.</div>';
}

function openModal() {
  buildModal();
  added = [];
  renderList();
  setMsg('');
  $('yzQaName').value = '';
  $('yzQaPrice').value = '';
  $('yzQaNewCat').value = '';
  fillCategories(stickyCategory);
  $('yzQaModal').classList.add('open');
  setTimeout(() => $('yzQaName').focus(), 50);
}

function closeModal() {
  $('yzQaModal')?.classList.remove('open');
}

/* ── "Sürətli əlavə" düyməsini Menyu bölməsinə yerləşdir ── */
function mountButton() {
  const sec = $('sec-menu');
  if (!sec || $('yzQaOpen')) return;
  const bar = document.createElement('div');
  bar.className = 'yz-qa-bar';
  bar.innerHTML = '<button type="button" class="btn btn-green" id="yzQaOpen">⚡ Sürətli əlavə</button>';
  sec.insertBefore(bar, sec.firstChild);
  $('yzQaOpen').addEventListener('click', openModal);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountButton);
else mountButton();
