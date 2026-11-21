/* ═══════════════════════════════════════════
   ORDER CART
   "Sifariş Et / Əlavə Et" ekranı: kateqoriyalar, mal siyahısı,
   draft səbət, sifarişin göndərilməsi (Firebase transaction).
═══════════════════════════════════════════ */
import { R } from './firebase-service.js';
import { state } from './state.js';
import { esc, showToast, addLog, makeLineKey, updateStock, formatItemsList, computeOrderTotals, money2 } from './utils.js';
import { hasPermission } from './permissions.js';
import { showScreen } from './theme.js';
import { printKitchenJobs } from './printer-service.js';
import { modal } from './yuza-inv-ui.js';
import { curGuest, guestLabel, tag as guestTag } from './yuza-split.js';   // C18: hesabı qonaqlara görə bölmək
/* C16: səbət sətrinin adı və qiyməti (şüşə / ml variantı varsa onunku) */
const lineName = (m, l) => l?.vlabel ? `${m.name} (${l.vlabel})` : m.name;
const linePrice = (m, l) => (l && l.vprice !== undefined && l.vprice !== null) ? Number(l.vprice) : (m.price || 0);

export class OrderCart {
  /**
   * @param {Object} els - { screen, title, catTabs, itemsList, draftList, draftTotal }
   * @param {Object} callbacks - { onClosed() }
   */
  constructor(els, callbacks = {}) {
    this.els = els;
    this.onClosed = callbacks.onClosed || (() => {});
    this._noteOpenKeys = new Set();
    this._failedDrafts = {};     // göndərilə bilməyən mallar (masa ID → seçim)
    this._pending = {};          // göndərilməkdə olan mallar (masa ID → seçim) — cavab gələnə qədər
    this._bindEvents();
  }

   
  _bindEvents() {
    if (this.els.searchInput) {
      this.els.searchInput.addEventListener('input', (e) => this.setSearchQuery(e.target.value));
    }
    this.els.catTabs.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cat]');
      if (!btn) return;
      this.setCategory(btn.dataset.cat);
    });
    this.els.itemsList.addEventListener('click', (e) => {
      const card = e.target.closest('[data-menu-item-id]');
      if (!card) return;
      this.addItemDirect(card.dataset.menuItemId);
    });
    this.els.draftList.addEventListener('click', (e) => {
      const qtyBtn = e.target.closest('[data-qty-change]');
      if (qtyBtn) { this.changeDraftQty(qtyBtn.dataset.lineKey, parseInt(qtyBtn.dataset.qtyChange, 10)); return; }
             const qtyInput = e.target.closest('.qty-stepper__input');
      if (qtyInput) { qtyInput.select(); return; }
      const noteToggle = e.target.closest('[data-note-toggle]');
      if (noteToggle) { this.toggleNoteInput(noteToggle.dataset.noteToggle); return; }
      const removeBtn = e.target.closest('[data-remove-line]');
      if (removeBtn) { state._orderDraft[removeBtn.dataset.removeLine] && (delete state._orderDraft[removeBtn.dataset.removeLine], this.renderDraftList()); return; }
    });
             this.els.draftList.addEventListener('change', (e) => {
      const inp = e.target.closest('.qty-stepper__input');
      if (!inp) return;
      const lineKey = inp.dataset.lineKey;
      const newQty = Math.round(parseFloat(String(inp.value).replace(',', '.')) * 2) / 2;
      if (!lineKey || isNaN(newQty) || newQty < 0.5) { this.renderDraftList(); return; }
      const line = state._orderDraft[lineKey];
      if (!line) return;
      line.qty = newQty;
      if (line.qty <= 0) delete state._orderDraft[lineKey];
      this.renderDraftList();
    });
    this.els.draftList.addEventListener('change', (e) => {
      const noteInput = e.target.closest('[data-note-line]');
      if (noteInput) { state._orderDraft[noteInput.dataset.noteLine].note = noteInput.value; return; }
      const feeInput = e.target.closest('[data-fee-line]');
      if (feeInput) {
        const line = state._orderDraft[feeInput.dataset.feeLine];
        if (line) { line.extraFee = parseFloat(feeInput.value) || 0; this.renderDraftList(); }
      }
    });
  }

  open(tableId) {
    state.orderTableId = tableId;
    state._orderDraft = this._failedDrafts[tableId] || {};
    delete this._failedDrafts[tableId];
    state._orderCatFilter = 'all';
    state._orderSearchQuery = '';
    if (this.els.searchInput) this.els.searchInput.value = '';
    const t = state.tables.find(x => x.id === tableId);
    this.els.title.innerHTML = `<svg class="icon"><use href="#i-food"></use></svg> ${esc(t?.name || 'Sifariş')}`;
         const gnEl = document.getElementById('orderGlobalNote');
    if (gnEl) gnEl.value = '';
    this.renderCatTabs();
    this.renderItemsList();
    this.renderDraftList();
    showScreen('orderScreen');
  }

  close() {
    showScreen('waiterScreen');
    state.orderTableId = null;
    this.onClosed();
  }

  getCategories() {
    const cats = new Set();
    state.menuItems.forEach(m => { if (m.available !== false) cats.add(m.category || 'Digər'); });
    return Array.from(cats);
  }

  renderCatTabs() {
       const hasFav = state.menuItems.some(m => m.isFavorite && m.available !== false);
    if (!hasFav && state._orderCatFilter === '__fav__') state._orderCatFilter = 'all';
    const cats = ['all', ...(hasFav ? ['__fav__'] : []), ...this.getCategories()];
    this.els.catTabs.innerHTML = cats.map(c => `
      <button class="category-rail__tab ${state._orderCatFilter===c?'active':''}" data-cat="${esc(c)}">
        <svg class="icon"><use href="#i-${c==='all'?'clipboard':'food'}"></use></svg>
        <span>${c === 'all' ? 'Hamısı' : c === '__fav__' ? '★ Favorilər' : esc(c)}</span>
      </button>
    `).join('');
  }

  setCategory(cat) {
    state._orderCatFilter = cat;
    this.renderCatTabs();
    this.renderItemsList();
  }

  renderItemsList() {
    const q = (state._orderSearchQuery || '').trim().toLowerCase();
    const items = state.menuItems.filter(m => {
      if (m.available === false) return false;
           if (q) return m.name.toLowerCase().includes(q);
      if (state._orderCatFilter === '__fav__') return !!m.isFavorite;
      if (state._orderCatFilter === 'all') return true;
      return (m.category || 'Digər') === state._orderCatFilter;
    });
    if (!items.length) { this.els.itemsList.innerHTML = `<p style="color:var(--text3);grid-column:1/-1;">${q ? 'Axtarışa uyğun mal tapılmadı.' : 'Bu kateqoriyada mal yoxdur.'}</p>`; return; }
    this.els.itemsList.innerHTML = items.map(m => {
      const hasStock = (m.stock !== undefined && m.stock !== null);
      const por = window.__yzPortion?.(m.id) || null;      // C21: porsiya sayğacı
      const outOfStock = (hasStock && m.stock <= 0) || (por && por.left <= 0);
      const lowStock = hasStock && m.stock > 0 && m.stock <= 5;
      const badge = por
        ? (por.left > 0 ? `<div class="product-card__stock product-card__stock--por ${por.left <= por.limit ? 'product-card__stock--low' : ''}">${por.left} porsiya</div>` : '<div class="product-card__stock product-card__stock--out">Bitdi</div>')
        : m.pour?.on && window.__yzPour ? `<div class="product-card__stock ${outOfStock ? 'product-card__stock--out' : ''}">${window.__yzPour.stockText(m)}</div>`
        : (hasStock && !outOfStock ? `<div class="product-card__stock ${lowStock?'product-card__stock--low':''}">${m.stock} qalıb</div>` : '');
      return `<div class="product-card ${m.photo?'':'no-photo'} ${outOfStock?'out-of-stock':''}" data-menu-item-id="${m.id}">
        ${m.photo ? `<img src="${esc(m.photo)}" alt="" loading="lazy">` : ''}
        ${badge}
        <div class="product-card__overlay">
          <div class="product-card__name">${esc(m.name)}</div>
          <div class="product-card__price">${(m.price||0).toFixed(2)} ₼</div>
          ${outOfStock ? '<div class="product-card__oos">Bitib</div>' : ''}
        </div>
      </div>`;
    }).join('');
  }

  setSearchQuery(q) {
    state._orderSearchQuery = q;
    this.renderItemsList();
  }

  addItemDirect(menuItemId) {
    const m = state.menuItems.find(x => x.id === menuItemId);
    if (!m) return;
    // C16: şüşə / ml ilə satılan içki — variant pəncərəsi
    if (m.pour?.on && window.__yzPour) { window.__yzPour.pick(m, (v) => this.addVariant(m, v)); return; }
    const g = curGuest(state.orderTableId);                    // C18: seçilmiş qonaq (0 = ümumi)
    const lineKey = makeLineKey(menuItemId, '', 0) + (g ? '@' + g : '');
    const currentDraftQty = state._orderDraft[lineKey]?.qty || 0;
    // Anbarda stok izlənən maldırsa (stock sahəsi varsa), kifayət qədər olub-olmadığı yoxlanılır
    if (m.stock !== undefined && m.stock !== null && (currentDraftQty + 1) > m.stock) {
      showToast(`<svg class="icon"><use href="#i-warning"></use></svg> "${m.name}" anbarda mövcud deyil`);
      return;
    }
    // C21: porsiya sayğacı — qalan porsiyadan çox əlavə etmək olmur
    const por = window.__yzPortion?.(menuItemId);
    if (por) {
      const inCart = Object.values(state._orderDraft).filter(l => l.menuItemId === menuItemId).reduce((s, l) => s + l.qty, 0);
      if (inCart + 1 > por.left) {
        showToast(`<svg class="icon"><use href="#i-warning"></use></svg> "${esc(m.name)}" ${por.left > 0 ? `— cəmi ${por.left} porsiya qalıb` : 'bitib'}`);
        return;
      }
    }
    if (state._orderDraft[lineKey]) state._orderDraft[lineKey].qty += 1;
    else state._orderDraft[lineKey] = { menuItemId, qty: 1, note: '', extraFee: 0, ...(g ? { guest: g } : {}) };
    this.renderDraftList();
  }

  /* C16: variant sətri — { ml, label, price, bottle } */
  addVariant(m, v) {
    const g = curGuest(state.orderTableId);
    const lineKey = makeLineKey(m.id, '', 0) + '~' + (v.bottle ? 'b' : v.ml) + (g ? '@' + g : '');
    if (state._orderDraft[lineKey]) state._orderDraft[lineKey].qty += 1;
    else state._orderDraft[lineKey] = { menuItemId: m.id, qty: 1, note: '', extraFee: 0, ml: v.ml, vlabel: v.label, vprice: v.price, bottle: !!v.bottle, ...(g ? { guest: g } : {}) };
    this.renderDraftList();
  }

  changeDraftQty(lineKey, delta) {
    const line = state._orderDraft[lineKey];
    if (!line) return;
    line.qty += delta;
    if (line.qty <= 0) delete state._orderDraft[lineKey];
    this.renderDraftList();
  }

  toggleNoteInput(lineKey) {
    if (this._noteOpenKeys.has(lineKey)) this._noteOpenKeys.delete(lineKey);
    else this._noteOpenKeys.add(lineKey);
    this.renderDraftList();
  }

  /* Göndərilməkdə olan mallar (cavab gələnə qədər boz siyahı) */
  _pendingHtml() {
    const pend = this._pending[state.orderTableId];
    if (!pend) return '';
    const rows = Object.values(pend).map(line => {
      const m = state.menuItems.find(x => x.id === line.menuItemId);
      return m ? `<div class="ticket-line ticket-line--pending"><div class="ticket-line__main"><span class="ticket-line__name">${esc(lineName(m, line))}</span><span class="ticket-line__qty">× ${line.qty}</span><span class="ticket-line__price">${(linePrice(m, line) * line.qty + (line.extraFee || 0)).toFixed(2)} ₼</span></div></div>` : '';
    }).join('');
    return `<div class="ticket-sec-title ticket-sec-title--pending"><span class="yz-spin" aria-hidden="true"></span> Göndərilir…</div>${rows}`;
  }

  renderDraftList() {
    document.dispatchEvent(new CustomEvent('order:draft-changed'));
    this._syncSendBtn();
    const lines = Object.entries(state._orderDraft);
    const gn = document.getElementById('orderGlobalNote');
    if (gn) gn.hidden = !lines.length && !gn.value.trim();
    if (!lines.length) {
      this.draftAmount = 0;
      this.els.draftList.innerHTML = this._pendingHtml();
      const tot = ((state.tableOrders[state.orderTableId]?.total)||0).toFixed(2) + ' ₼';
      this.els.draftTotal.textContent = tot;
      this._updateServiceChargeRow(state.serviceCharge?.enabled ? (state.serviceCharge.percent||0) : 0);
      return;
    }
    let draftTotal = 0, draftVat = 0;
    const canFee = hasPermission('order.discount');
    const rows = lines.map(([lineKey, line]) => {
      const m = state.menuItems.find(x => x.id === line.menuItemId);
      if (!m) return '';
           const lineTotal = linePrice(m, line) * line.qty + (line.extraFee||0);   // C16: şüşə / ml variantının qiyməti
      draftTotal += lineTotal;
          if (state.vatMode === 'added' && Number(m.vatRate) > 0) draftVat += lineTotal * Number(m.vatRate) / 100;
      const noteOpen = this._noteOpenKeys.has(lineKey);
      const hasNote = !!(line.note && line.note.trim());
      const hasFee = !!(line.extraFee);
      return `<div class="ticket-line ticket-line--draft">
        <div class="ticket-line__main">
          <span class="ticket-line__name" title="${esc(lineName(m, line))}">${line.guest ? guestTag(state.orderTableId, line.guest) + ' ' : ''}${esc(lineName(m, line))}</span>
          <button class="ticket-line__note-btn ${(hasNote||hasFee)?'has-note':''}" data-note-toggle="${lineKey}" title="Qeyd / əlavə ödəniş" aria-label="Qeyd">
            <svg class="icon"><use href="#i-edit"></use></svg>
          </button>
                   <div class="qty-stepper">
            <button data-qty-change="-1" data-line-key="${lineKey}" aria-label="Azalt">−</button>
            <input class="qty-stepper__val qty-stepper__input" type="text" inputmode="decimal" value="${line.qty}" data-line-key="${lineKey}" aria-label="Miqdar">
            <button data-qty-change="1" data-line-key="${lineKey}" aria-label="Artır">+</button>
          </div>
          <span class="ticket-line__price">${lineTotal.toFixed(2)} ₼</span>
          <button class="ticket-line__remove" data-remove-line="${lineKey}" aria-label="Sil" title="Sil">
            <svg class="icon"><use href="#i-close"></use></svg>
          </button>
        </div>
        ${(hasNote||hasFee) && !noteOpen ? `<div class="ticket-line__tags">
          ${hasNote ? `<span style="font-size:11px;color:var(--text3);"><svg class="icon"><use href="#i-note"></use></svg> ${esc(line.note)}</span>` : ''}
          ${hasFee ? `<span class="discount-badge" style="background:transparent;border-color:var(--border);color:var(--text3);">+${line.extraFee.toFixed(2)} ₼</span>` : ''}
        </div>` : ''}
        ${noteOpen ? `<div style="display:flex;flex-direction:column;gap:6px;margin-top:6px;">
          <input type="text" class="ticket-note-input" style="margin-top:0;" data-note-line="${lineKey}" value="${esc(line.note||'')}" placeholder="Qeyd (məs: soğansız, çox bişmiş)" autofocus>
          ${canFee ? `<div style="display:flex;align-items:center;gap:6px;">
            <label style="font-size:10.5px;color:var(--text3);white-space:nowrap;">Əlavə ödəniş:</label>
            <input type="number" data-fee-line="${lineKey}" value="${line.extraFee||''}" placeholder="0.00" step="0.01"
                   style="width:70px;font-size:11px;padding:4px 6px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);">
            <span style="font-size:10.5px;color:var(--text3);">₼</span>
          </div>` : ''}
        </div>` : ''}
      </div>`;
    }).join('');
    // 21.11: "Yeni (göndərilməmiş)" başlığı yoxdur — göndərilmiş mallar ayrıca (gizli) siyahıdadır, səbətdə yalnız yeni mallar
    this.els.draftList.innerHTML = this._pendingHtml() + rows;
    const sentTotal = (state.tableOrders[state.orderTableId]?.total) || 0;
    const scPct = state.serviceCharge?.enabled ? (state.serviceCharge.percent||0) : 0;
    this.draftAmount = Math.round((draftTotal * (1 + scPct/100) + draftVat) * 100) / 100;   // əsas düymədə göstərilir
    const totText = (sentTotal + this.draftAmount).toFixed(2) + ' ₼';
    this.els.draftTotal.textContent = totText;
    this._updateServiceChargeRow(scPct);
  }

  _updateServiceChargeRow(scPct) {
    const row = document.getElementById('ticketServiceChargeRow');
    if (!row) return;
    const order = state.tableOrders[state.orderTableId];
    const scAmount = order?.serviceChargeAmount || 0;
    if (scPct > 0 && (scAmount > 0 || Object.keys(state._orderDraft||{}).length)) {
      row.style.display = 'flex';
      document.getElementById('ticketServiceChargeLabel').textContent = `Xidmət haqqı (${scPct}%)`;
      document.getElementById('ticketServiceChargeValue').textContent = scAmount.toFixed(2) + ' ₼';
    } else {
      row.style.display = 'none';
    }
  }

  /* Göndərmə vəziyyəti: düymə kilidlənir, seçilmiş mallar "göndərilir" siyahısına keçir.
     Beləliklə ikinci toxunuş heç nə göndərmir (mallar iki dəfə düşmür, stok iki dəfə çıxılmır). */
  _syncSendBtn() {
    const on = !!this._pending[state.orderTableId];
    document.querySelectorAll('[data-send-order]').forEach(b => {
      if (on) { if (!b.dataset.label) b.dataset.label = b.innerHTML; b.disabled = true; b.classList.add('is-busy'); b.innerHTML = '<span class="yz-spin" aria-hidden="true"></span> Göndərilir…'; }
      else { b.disabled = false; b.classList.remove('is-busy'); if (b.dataset.label) b.innerHTML = b.dataset.label; }
    });
  }

  /* ═══ C22 · GÖNDƏRMƏ ANINDA QALIQ YOXLAMASI (21.11.2026) ═══
     Səbətə əlavə edəndə anbardan heç nə silinmir. "Göndər" basılanda hər malın bazadakı ƏN SON vəziyyəti
     oxunur (stop-list / qalıq). Çatmırsa ofisiant seçir: "Olanı göndər" (çatmayan hissə səbətdən çıxır)
     və ya "Geri" (heç nə göndərilmir). Silinmə yalnız sifariş mətbəxə yazılandan sonra olur (aşağıda). */
  async _freshAvail(menuItemId) {
    let v = null;
    try { v = (await R.menuItems.child(menuItemId).once('value')).val(); } catch (e) { v = null; }
    const m = v || state.menuItems.find(x => x.id === menuItemId) || null;
    if (!m) return { gone: true, left: 0 };
    if (m.available === false) return { off: true, left: 0 };
    const extra = window.__yzAvailExtra?.(menuItemId, m);   // C21: porsiya sayğacı buraya qoşulur
    const stock = (m.stock !== undefined && m.stock !== null) ? Number(m.stock) : null;
    const lim = [stock, extra].filter(x => x !== null && x !== undefined && Number.isFinite(Number(x))).map(Number);
    return { left: lim.length ? Math.max(0, Math.floor(Math.min(...lim) * 1000) / 1000) : null, name: m.name };
  }
  async _checkShort(draft) {
    const need = {};
    Object.values(draft).forEach(l => { need[l.menuItemId] = (need[l.menuItemId] || 0) + l.qty; });
    const short = [];
    // C16: şüşə / ml ilə satılan içki — ml və bağlı şüşə sayı ilə yoxlanır
    const pourIds = new Set(Object.values(draft).filter(l => l.ml).map(l => l.menuItemId));
    for (const id of pourIds) {
      delete need[id];
      const m = state.menuItems.find(x => x.id === id);
      const a = await this._freshAvail(id);
      const S = Math.max(0, Number(a.left) || 0), B = Number(m?.pour?.bottleMl) || 0;
      const ls = Object.values(draft).filter(l => l.menuItemId === id);
      const needMl = ls.reduce((s, l) => s + l.qty * l.ml, 0), needB = ls.filter(l => l.bottle).reduce((s, l) => s + l.qty, 0);
      const sealed = B > 0 ? Math.floor((S + 1e-6) / B) : 0;
      if (a.gone || a.off || S < needMl || (needB && sealed < needB)) {
        short.push({ id, name: a.name || m?.name || '?', need: ls.reduce((s, l) => s + l.qty, 0), left: 0, off: !!a.off, gone: !!a.gone,
          txt: a.off || a.gone ? '' : (needB && sealed < needB ? `istənilən ${needB} şüşə, bağlı şüşə ${sealed} (açıq şüşə yalnız ml satılır)` : `istənilən ${needMl} ml, cəmi ${S} ml qalıb`) });
      }
    }
    for (const [id, q] of Object.entries(need)) {
      const a = await this._freshAvail(id);
      if (a.gone || a.off || (a.left !== null && a.left < q)) {
        const m = state.menuItems.find(x => x.id === id);
        short.push({ id, name: a.name || m?.name || '?', need: q, left: a.gone || a.off ? 0 : a.left, off: !!a.off, gone: !!a.gone });
      }
    }
    return short;
  }
  _askShort(short) {
    return new Promise(res => {
      const any = short.some(x => x.left > 0);
      const rows = short.map(x => `<li><b>${esc(x.name)}</b><span>${x.txt ? esc(x.txt) : x.gone ? 'menyuda yoxdur' : x.off ? 'satışda deyil (bitib)' : x.left > 0 ? `istənilən ${x.need}, <b>cəmi ${x.left} qalıb</b>` : `istənilən ${x.need}, <b>bitib</b>`}</span></li>`).join('');
      let done = false;
      const fin = (v) => { if (done) return; done = true; res(v); };
      modal({
        title: '<svg class="icon"><use href="#i-warning"></use></svg> Bəzi mallar çatmır',
        body: `<ul class="yz-short">${rows}</ul><p class="yzi-hint">${any ? '“Olanı göndər” — qalan qədər göndərilir, çatmayan hissə səbətdən çıxır.' : 'Bitmiş mallar səbətdən çıxarılıb qalanı göndərilə bilər.'}</p>`,
        actions: [
          { label: 'Geri', cancel: true },
          { label: any ? 'Olanı göndər' : 'Bitənləri çıxar və göndər', cls: 'yzi-btn--gold', onClick: () => { fin('send'); } }
        ],
        onClose: () => fin('back')
      });
    });
  }

  async send() {
    const tableId = state.orderTableId;
    if (!tableId || this._pending[tableId] || this._checking) return;
    if (!Object.keys(state._orderDraft).length) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Heç mal seçilməyib'); return; }
    // C22: göndərmə anında son qalıq yoxlanır
    this._checking = true;
    let short = [];
    try { short = await this._checkShort(state._orderDraft); } finally { this._checking = false; }
    if (state.orderTableId !== tableId) return;
    if (short.length) {
      if (await this._askShort(short) !== 'send') return;
      // Çatmayan hissə səbətdən çıxır (eyni malın bir neçə sətri varsa — sonuncudan başlayaraq)
      short.forEach(x => {
        let over = x.need - x.left;
        Object.keys(state._orderDraft).reverse().forEach(k => {
          const l = state._orderDraft[k];
          if (over <= 0 || l.menuItemId !== x.id) return;
          const cut = Math.min(l.qty, over);
          l.qty = Math.round((l.qty - cut) * 1000) / 1000; over -= cut;
          if (l.qty <= 0) delete state._orderDraft[k];
        });
      });
      addLog('order_short', `${state.user?.name || ''}: göndərmə anında çatmadı — ${short.map(x => `${x.name}: istənilən ${x.need}, ${x.left > 0 ? 'göndərilən ' + x.left : 'göndərilmədi'}`).join('; ')}`, { tableId, items: short.map(x => ({ id: x.id, need: x.need, left: x.left })) });
      this.renderDraftList();
      if (!Object.keys(state._orderDraft).length) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Göndəriləcək mal qalmadı'); return; }
    }
    if (this._pending[tableId]) return;
    const draftKeys = Object.keys(state._orderDraft);
    const t = state.tables.find(x => x.id === tableId);

    const draftSnapshot = JSON.parse(JSON.stringify(state._orderDraft));
    const waiterId = state.user.id, waiterName = state.user.name;
    // Seçilmiş mallar dərhal "göndərilir" vəziyyətinə keçir; xəta olsa geri qaytarılır
    this._pending[tableId] = draftSnapshot;
    state._orderDraft = {};
    this.renderDraftList();
    const restore = () => {
      // Ofisiant bu arada başqa masaya keçibsə, mallar həmin masa açılanda geri qayıdır
      const target = state.orderTableId === tableId ? state._orderDraft : (this._failedDrafts[tableId] = this._failedDrafts[tableId] || {});
      Object.entries(this._pending[tableId] || {}).forEach(([k, line]) => {
        if (target[k]) target[k].qty += line.qty; else target[k] = line;
      });
      delete this._pending[tableId];
      if (state.orderTableId === tableId) this.renderDraftList();
    };

    R.tableOrders.child(tableId).transaction(current => {
      const items = {};
      if (current && current.items) Object.entries(current.items).forEach(([k, v]) => { items[k] = v; });

      draftKeys.forEach(lineKey => {
        const draft = draftSnapshot[lineKey];
        const m = state.menuItems.find(x => x.id === draft.menuItemId);
        if (!m) return;
        const cleanKey = makeLineKey(draft.menuItemId, draft.note || '', draft.extraFee || 0) + (draft.ml ? '~' + (draft.bottle ? 'b' : draft.ml) : '') + (draft.guest ? '@' + draft.guest : '');
        if (items[cleanKey]) items[cleanKey] = { ...items[cleanKey], qty: items[cleanKey].qty + draft.qty };
        else items[cleanKey] = { menuItemId: draft.menuItemId, name: lineName(m, draft), price: linePrice(m, draft), qty: draft.qty, note: draft.note || '', extraFee: draft.extraFee || 0, vatRate: Number(m.vatRate) || 0, vatIncluded: state.vatMode !== 'added',
          ...(draft.ml ? { ml: draft.ml, bottle: !!draft.bottle } : {}), ...(draft.guest ? { guest: draft.guest } : {}) };
      });

      const _tot = computeOrderTotals(items);
      const total = _tot.total, serviceChargeAmount = _tot.serviceChargeAmount, serviceChargePercent = _tot.serviceChargePercent;
      const paidAmount = (current && current.paidAmount) || 0;

      return {
        ...(current || {}),   // ödənişlər (pays), nisyələr (charges), banket və bərpa məlumatı itməsin
        items, total, serviceChargeAmount, serviceChargePercent,
        waiterId: (current && current.waiterId) || waiterId,
        paidAmount,
        remainingAmount: money2(Math.max(0, total - paidAmount)),
        updatedAt: Date.now(),
        // İlk sifarişin dəqiq vaxtı - hesabatlarda (saatlara/işçi performansına görə) bu
        // istifadə olunur, masa bağlanma vaxtı YOX (saat 6-da açılıb 12-də bağlanan masa
        // hesabatda 12 saatına yox, 6 saatına aid sayılmalıdır)
        firstOrderAt: (current && current.firstOrderAt) || Date.now(),
        billPrintedAt: null
      };
    }, (error, committed, snapshot) => {
      if (error) { restore(); showToast('<svg class="icon"><use href="#i-error"></use></svg> Sifariş göndərilmədi (bağlantı xətası). Mallar yerindədir — yenidən göndərin.'); return; }
      if (!committed) { restore(); return; }
      delete this._pending[tableId];
      draftKeys.forEach(lineKey => {
        const draft = draftSnapshot[lineKey];
        if (draft) updateStock(draft.menuItemId, -draft.qty * (draft.ml || 1), state.menuItems);   // C16: ml satışında ml qədər
      });
      const finalTotal = (snapshot.val() && snapshot.val().total) || 0;
      const sentItemsSummary = draftKeys.map(lineKey => {
        const draft = draftSnapshot[lineKey];
        const m = state.menuItems.find(x => x.id === draft?.menuItemId);
        return m ? { name: lineName(m, draft), qty: draft.qty } : null;
      }).filter(Boolean);
       addLog('order_send', `${waiterName} "${t?.name}" masası üçün sifariş göndərdi: ${formatItemsList(sentItemsSummary)} (${finalTotal.toFixed(2)} ₼)`, { waiterId, tableId });
      showToast('<svg class="icon"><use href="#i-check"></use></svg> Sifariş göndərildi');

      const now = Date.now();
      const timeStr = new Date().toLocaleTimeString('az-AZ');
      const orderNote = (document.getElementById('orderGlobalNote')?.value || '').trim();

      const kitchenGroups = {};
      // Hər səbət sətri ayrıca (C18: qonaq qeydi ilə; C16: variant adı ilə)
      const gl = (d) => d.guest ? guestLabel(tableId, d.guest) : '';
      draftKeys.forEach(lineKey => {
        const d = draftSnapshot[lineKey];
        const menuItem = state.menuItems.find(x => x.id === d?.menuItemId);
        if (!menuItem) return;
        const kitchenId = menuItem.kitchenId || 'default';
        const station = (state.kitchenStations || []).find(k => k.id === kitchenId);
        const kitchenName = station?.name || 'Mətbəx';
        if (!kitchenGroups[kitchenId]) kitchenGroups[kitchenId] = { kitchenId, kitchenName, items: [] };
        kitchenGroups[kitchenId].items.push({
          name: lineName(menuItem, d),
          qty: d.qty,
          note: [gl(d), d.note || ''].filter(Boolean).join(' · '),
          ...(d.guest ? { guest: d.guest } : {}),
          ready: false,
          cooking: false,
          waiterAccepted: false,
          addedAt: now
        });
      });

      /* ── Printer sistemi: kateqoriyaya görə çap işləri yarat ── */
      const printGroups = {};
      printGroups._orderNote = orderNote;
      draftKeys.forEach(lineKey => {
        const draft = draftSnapshot[lineKey];
        const m = state.menuItems.find(x => x.id === draft?.menuItemId);
        if (!m) return;
        const cat = m.category || 'Digər';
        if (!printGroups[cat]) printGroups[cat] = [];
        printGroups[cat].push({ name: lineName(m, draft), qty: draft.qty, note: [draft.guest ? guestLabel(tableId, draft.guest) : '', draft.note || ''].filter(Boolean).join(' · ') });
      });
      printKitchenJobs(tableId, printGroups).catch(() => {});

                  Object.values(kitchenGroups).forEach(group => {
        // Eyni masa + eyni mətbəx üçün hələ aktiv (bütün mallar hazır deyil) kart var mı?
        const existingKo = (state.kitchenOrders || []).find(ko =>
          ko.tableId === tableId &&
          ko.kitchenId === group.kitchenId &&
          !ko.allReady &&
          !ko.waiterAccepted
        );

        if (existingKo) {
          // Mövcud karta yeni malları əlavə et
          const mergedItems = [...(existingKo.items || []), ...group.items];
          R.kitchenOrders.child(existingKo.id).update({
            items: mergedItems,
            allReady: false,
            kitchenAccepted: false,
            changeNote: `Yeni əlavə: ${group.items.map(i => i.qty + '× ' + i.name).join(', ')}`,
            orderNote: orderNote || existingKo.orderNote || ''
          });
                    const addedNames = group.items.map(i => i.qty + 'x ' + i.name).join(', ');
          addLog('kitchen_order_update', 'Masa ' + (t?.name||'') + ' — mövcud mətbəx kartına elave edildi: ' + addedNames, { kitchenOrderId: existingKo.id, tableId });
        } else {
          // Yeni kart yarat
          const koRef = R.kitchenOrders.push();
          koRef.set({
            tableId, tableName: t?.name || 'Masa',
            waiterId, waiterName,
            kitchenId: group.kitchenId,
            kitchenName: group.kitchenName,
            items: group.items,
            orderNote,
            status: 'pending',
            allReady: false,
            waiterAccepted: false,
            createdAt: now,
                        time: timeStr
          });
        }
      });

      // Ekranda qalır: əsas düymə "Ödəniş al" vəziyyətinə keçir
      this.renderDraftList();
    });
  }
}
