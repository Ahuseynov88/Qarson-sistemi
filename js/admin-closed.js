/* ═══════════════════════════════════════════
   YUZA POS — ADMİN PANELİ: BAĞLANAN MASALAR (TARİXÇƏ, GERİ QAYTARMA)
   Mərhələ 5: admin.js-dən ayrılıb (məntiq dəyişməyib). Ümumi giriş nöqtəsi — admin.js.
═══════════════════════════════════════════ */
import { syncLivePays, payKey, PAYIDX, rangeMs, CO, ensureClosedList, closedById } from './admin-reports.js';
import { esc, confirmDelete2x, addLog, showToast, stripTableName, money2, serverNow, formatItemsList } from './utils.js';
import { state } from './state.js';
import { db, R } from './firebase-service.js';
import { _toggleSectionBackBtn, jsId } from './admin.js';
import { hasPermission } from './permissions.js';
import { needShift } from './yuza-shift.js';
import { modal as yzModal } from './yuza-inv-ui.js';


/* ═══════════════════════════════════════════
   BAĞLANAN MASALAR (TARİXÇƏ + BƏRPA)
═══════════════════════════════════════════ */
// Bağlanmış masaya aid ödəniş qeydlərini tapır (sessionId ilə dəqiq uyğunlaşdırma)
export function getOrderPayments(o) {
  syncLivePays();
  const k = payKey(o);
  return k ? [...(PAYIDX.get(k)?.values() || [])] : [];
}

export function renderClosedOrders() {
  const listEl = document.getElementById('closedOrdersList');
  const detailEl = document.getElementById('ctDetailPanel');
  const reportEl = document.getElementById('ctReportSummary');
  if (!listEl || !detailEl) return;
  // Mərhələ 2d: tarix seçilibsə — həmin aralığın BÜTÜN bağlanmış masaları bazadan oxunur; seçilməyibsə son 200
  const _cdf = document.getElementById('ctDateFrom')?.value || '', _cdt = document.getElementById('ctDateTo')?.value || '';
  let all;
  if (_cdf || _cdt) {
    const { lo, hi } = rangeMs(_cdf, document.getElementById('ctTimeFrom')?.value || '', _cdt, document.getElementById('ctTimeTo')?.value || '');
    if (!(CO.lo !== null && lo >= CO.lo && hi <= CO.hi)) {
      listEl.innerHTML = '<p class="ct-list-empty">Seçilmiş aralıq yüklənir…</p>';
      ensureClosedList(lo, hi).then(() => renderClosedOrders())
        .catch(e => { listEl.innerHTML = `<p class="ct-list-empty">Oxunmadı: ${esc(e?.message || 'bağlantı xətası')}</p>`; });
      return;
    }
    (state.closedOrders || []).forEach(o => { if ((o.closedAt || 0) >= CO.lo && (o.closedAt || 0) <= CO.hi) CO.map.set(o.id, o); });
    all = [...CO.map.values()];
  } else {
    all = state.closedOrders || [];
  }

  // Filtr seçimlərini bir dəfə doldur (seçim itməsin deyə)
  const staffSel = document.getElementById('ctStaffFilter');
  const openedSel = document.getElementById('ctOpenedByFilter');
  const payTypeSel = document.getElementById('ctPaymentTypeFilter');
  if (staffSel && staffSel.dataset.filled !== 'true') {
    const names = Array.from(new Set(all.map(o => o.staffName).filter(Boolean))).sort();
    staffSel.innerHTML = '<option value="">Hamısı</option>' + names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    staffSel.dataset.filled = 'true';
  }
  if (openedSel && openedSel.dataset.filled !== 'true') {
    const names = Array.from(new Set(all.map(o => o.openedByName).filter(Boolean))).sort();
    openedSel.innerHTML = '<option value="">Hamısı</option>' + names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    openedSel.dataset.filled = 'true';
  }
  if (payTypeSel) {
    // Ödəniş növləri əlavə/silinəndə seçim siyahısı yenilənsin (köhnə, silinmiş növ seçili qalmasın)
    const custom = (state.paymentMethods||[]).map(pm => [pm.id, pm.name]);
    const signature = custom.map(([id]) => id).join(',');
    if (payTypeSel.dataset.signature !== signature) {
      const built = [['cash','Nağd'],['pos','POS']];
      const currentVal = payTypeSel.value;
      payTypeSel.innerHTML = '<option value="">Hamısı</option>' + built.concat(custom).map(([id,name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join('');
      // Seçim hələ mövcuddursa saxlanılır, silinibsə "Hamısı"na qayıdır
      if (built.concat(custom).some(([id]) => id === currentVal)) payTypeSel.value = currentVal;
      payTypeSel.dataset.signature = signature;
    }
  }

  const q = (document.getElementById('ctSearchInput')?.value || '').trim().toLowerCase();
  const dateFrom = document.getElementById('ctDateFrom')?.value || '';
  const dateTo = document.getElementById('ctDateTo')?.value || '';
  const timeFrom = document.getElementById('ctTimeFrom')?.value || '';
  const timeTo = document.getElementById('ctTimeTo')?.value || '';
  const staffFilter = document.getElementById('ctStaffFilter')?.value || '';
  const openedFilter = document.getElementById('ctOpenedByFilter')?.value || '';
  const payTypeFilter = document.getElementById('ctPaymentTypeFilter')?.value || '';
  const restoredOnly = document.getElementById('ctRestoredOnlyFilter')?.checked || false;
  const sortMode = document.getElementById('ctSortSelect')?.value || 'newest';

  let filtered = all.filter(o => {
    if (q) {
      const nameMatch = (o.tableName||'').toLowerCase().includes(q);
      const itemMatch = Object.values(o.items||{}).some(it => (it.name||'').toLowerCase().includes(q));
      if (!nameMatch && !itemMatch) return false;
    }
    if (staffFilter && o.staffName !== staffFilter) return false;
    if (openedFilter && o.openedByName !== openedFilter) return false;
    if (dateFrom) {
      const b = new Date(dateFrom);
      if (timeFrom) { const [h,m] = timeFrom.split(':'); b.setHours(+h,+m,0,0); } else { b.setHours(0,0,0,0); }
      if (o.closedAt < b.getTime()) return false;
    }
    if (dateTo) {
      const b = new Date(dateTo);
      if (timeTo) { const [h,m] = timeTo.split(':'); b.setHours(+h,+m,59,999); } else { b.setHours(23,59,59,999); }
      if (o.closedAt > b.getTime()) return false;
    }
    if (payTypeFilter) {
      const pays = getOrderPayments(o);
      // Bölünmüş ödənişin daxilində müvafiq növ (nağd/POS/...) varsa da uyğun sayılır,
      // "bölünmüş" adı altında gizlənməsin deyə
      const matches = pays.some(p => p.type === payTypeFilter || (p.type === 'split' && p.splitBreakdown && p.splitBreakdown[payTypeFilter] > 0));
      if (!matches) return false;
    }
    if (restoredOnly && !(o.restoreCount > 0)) return false;
    return true;
  });
  filtered.sort((a,b) => {
    if (sortMode === 'oldest') return (a.closedAt||0) - (b.closedAt||0);
    if (sortMode === 'amount_desc') return (b.total||0) - (a.total||0);
    if (sortMode === 'amount_asc') return (a.total||0) - (b.total||0);
    return (b.closedAt||0) - (a.closedAt||0);
  });

  // ── Hesabat xülasəsi (filtrlənmiş nəticələr üçün) ──
  if (reportEl) {
    const typeBreakdown = {};
    // Canlı siyahıdan tapmağa çalışır, tapılmasa (növ silinibsə) "Silinmiş növ" yazır -
    // heç vaxt xam Firebase ID-si göstərilmir.
    const resolveMethodName = (id) => id==='cash'?'Nağd':id==='pos'?'POS':((state.paymentMethods||[]).find(m=>m.id===id)?.name || 'Silinmiş növ');
    filtered.filter(o => !o.void).forEach(o => {
      getOrderPayments(o).forEach(p => {
        // Bölünmüş ödəniş öz komponentlərinə (Nağd/POS/...) ayrılaraq hesabata yazılır,
        // "Bölünmüş" adı altında tək məbləğ kimi yox. Ödənişin öz üzərində "dondurulmuş"
        // adı varsa (splitMethodNames) ONU üstün tuturuq - növ sonradan silinsə belə düzgün görünsün.
        if (p.type === 'split' && p.splitBreakdown) {
          Object.entries(p.splitBreakdown).forEach(([methodId, amount]) => {
            const key = p.splitMethodNames?.[methodId] || resolveMethodName(methodId);
            typeBreakdown[key] = (typeBreakdown[key]||0) + (amount||0);
          });
        } else {
          const key = p.typeLabel || p.type;
          typeBreakdown[key] = (typeBreakdown[key]||0) + (p.thisPay||0);
        }
      });
    });
    // Ödəniş növü filtrlənibsə, yekun məbləğ MASALARIN TAM cəmi yox, YALNIZ o növün payı olur
    // (məs. "Nağd" filtrində, kart+nağd bölünmüş ödənişi olan masanın yalnız nağd hissəsi sayılır)
    const liveOnes = filtered.filter(o => !o.void);
    const totalRevenue = payTypeFilter
      ? (typeBreakdown[resolveMethodName(payTypeFilter)] || 0)
      : liveOnes.reduce((s,o)=>s+(o.total||0),0);
    const breakdownEntries = Object.entries(typeBreakdown)
      .filter(([label]) => !payTypeFilter || label === resolveMethodName(payTypeFilter));
    reportEl.innerHTML = `<div class="ct-report">
      <div class="ct-report__stats">
        <div><div class="ct-report__stat-label">Bağlanan masa</div><div class="ct-report__stat-value">${liveOnes.length}${filtered.length > liveOnes.length ? ` <small style="font-size:12px;color:var(--text3);">(+${filtered.length - liveOnes.length} geri qaytarılıb)</small>` : ''}</div></div>
        <div><div class="ct-report__stat-label">${payTypeFilter ? esc(resolveMethodName(payTypeFilter)) + ' ilə ödənilmiş məbləğ' : 'Ümumi məbləğ'}</div><div class="ct-report__stat-value" style="color:var(--green);">${totalRevenue.toFixed(2)} ₼</div></div>
        <div><div class="ct-report__stat-label">Orta çek</div><div class="ct-report__stat-value">${(liveOnes.length?totalRevenue/liveOnes.length:0).toFixed(2)} ₼</div></div>
      </div>
      ${breakdownEntries.length ? `<div class="ct-report__breakdown">
        ${breakdownEntries.map(([label,amount]) => `<div class="ct-report__type-chip"><b>${esc(label)}</b> ${amount.toFixed(2)} ₼</div>`).join('')}
      </div>` : ''}
    </div>`;
  }

  if (state._ctSelectAllPending !== undefined) {
    state._selectedClosedOrderIds = state._ctSelectAllPending ? filtered.map(o=>o.id) : [];
    state._ctSelectAllPending = undefined;
  }
  state._selectedClosedOrderIds = (state._selectedClosedOrderIds||[]).filter(id => filtered.some(o=>o.id===id));
  const delBtn = document.getElementById('ctDeleteSelectedBtn');
  if (delBtn) {
    delBtn.style.display = state._selectedClosedOrderIds.length ? 'inline-flex' : 'none';
    delBtn.innerHTML = `<svg class="icon"><use href="#i-trash"></use></svg> Seçilənləri Sil (${state._selectedClosedOrderIds.length})`;
  }
  const selectAllCb = document.getElementById('ctSelectAllCheckbox');
  if (selectAllCb) selectAllCb.checked = filtered.length>0 && filtered.every(o=>state._selectedClosedOrderIds.includes(o.id));

  if (!filtered.length) {
    listEl.innerHTML = '<p class="ct-list-empty">Filtrə uyğun bağlanan masa tapılmadı.</p>';
    return;
  }

  const _note = (!_cdf && !_cdt) ? `<p class="ct-list-empty" style="grid-column:1/-1;padding:4px 0;">Son ${all.length} bağlanmış masa göstərilir. Daha köhnələri üçün tarix aralığı seçin.</p>` : '';
  listEl.innerHTML = _note + filtered.map(o => `
    <div class="tile-card" onclick="selectClosedOrder('${o.id}')" style="position:relative;">
      <label style="position:absolute;top:8px;left:8px;z-index:1;" onclick="event.stopPropagation()">
        <input type="checkbox" onchange="toggleClosedOrderSelect('${o.id}')" ${state._selectedClosedOrderIds.includes(o.id)?'checked':''} style="width:17px;height:17px;cursor:pointer;">
      </label>
      <div class="tile-card__icon"><svg class="icon"><use href="#i-clipboard"></use></svg></div>
      <div class="tile-card__name">${esc(o.tableName)}</div>
      <div class="tile-card__meta">${(o.total||0).toFixed(2)} ₼</div>
      <div class="tile-card__meta">${esc(o.closedDate||'')}</div>
      ${o.void ? `<span class="status-badge badge-red tile-card__badge" title="Geri qaytarılıb">Geri qaytarılıb</span>` : (o.restoreCount ? `<span class="status-badge badge-orange tile-card__badge" title="${o.restoreCount} dəfə bərpa edilib">${o.restoreCount}× bərpa</span>` : '')}
    </div>
  `).join('');

  if (state._selectedClosedOrderId) {
    const o = filtered.find(x => x.id === state._selectedClosedOrderId);
    if (o) renderClosedOrderDetail(o); else selectClosedOrder(null);
  }
}

export function toggleClosedOrderSelect(id) {
  state._selectedClosedOrderIds = state._selectedClosedOrderIds || [];
  const i = state._selectedClosedOrderIds.indexOf(id);
  if (i === -1) state._selectedClosedOrderIds.push(id); else state._selectedClosedOrderIds.splice(i,1);
  const btn = document.getElementById('ctDeleteSelectedBtn');
  if (btn) {
    btn.style.display = state._selectedClosedOrderIds.length ? 'inline-flex' : 'none';
    btn.innerHTML = `<svg class="icon"><use href="#i-trash"></use></svg> Seçilənləri Sil (${state._selectedClosedOrderIds.length})`;
  }
}

export function toggleSelectAllClosedOrders(checked) {
  state._ctSelectAllPending = checked;
  renderClosedOrders();
}

export function deleteSelectedClosedOrders() {
  const ids = state._selectedClosedOrderIds || [];
  if (!ids.length) return;
  confirmDelete2x(ids.length, 'bağlanmış masa qeydi', () => {
    ids.forEach(id => db.ref('closedOrders/' + id).remove());
    addLog('table_close', `Admin ${ids.length} bağlanmış masa qeydini seçib sildi`, {});
    state.closedOrders = state.closedOrders.filter(o => !ids.includes(o.id));
    state._selectedClosedOrderIds = [];
    if (ids.includes(state._selectedClosedOrderId)) state._selectedClosedOrderId = null;
    renderClosedOrders();
    showToast(`<svg class="icon"><use href="#i-check"></use></svg> ${ids.length} qeyd silindi`);
  });
}

export function selectClosedOrder(id) {
  state._selectedClosedOrderId = id;
  const overlay = document.getElementById('ctDetailPanel');
  if (!id) { overlay?.classList.remove('open'); _toggleSectionBackBtn(false); return; }
  const o = closedById(id);
  if (!o) { overlay?.classList.remove('open'); _toggleSectionBackBtn(false); return; }
  renderClosedOrderDetail(o);
  _toggleSectionBackBtn(true);
  overlay?.classList.add('open');
}

export function renderClosedOrderDetail(o) {
  const detailEl = document.getElementById('ctDetailBody');
  if (!detailEl || !o) return;
  const canRestore = hasPermission('table.restore') && !o.void && !o.deliveryId;
  const sessionLog = o.sessionLog || [];
  const firstEntry = sessionLog[0];
  const payments = getOrderPayments(o);

  const itemsHtml = Object.values(o.items||{}).map(it => `
    <div class="ct-detail-item-row">
      <span>${it.qty}x ${esc(it.name)}${it.compliment?' <span style="color:var(--green);font-size:11px;">(İKRAM)</span>':''}</span>
      <span style="font-weight:600;">${((it.price||0)*it.qty*(1-((it.discountPercent||0)/100))+(it.extraFee||0)).toFixed(2)} ₼</span>
    </div>
  `).join('') || '<p style="color:var(--text3);font-size:13px;">Mal qeydi yoxdur.</p>';

  const paymentsHtml = payments.length ? payments.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).map(p => `
    <div class="ct-detail-item-row">
      <span><svg class="icon" style="width:.85em;height:.85em;"><use href="#i-card"></use></svg> ${esc(p.typeLabel||p.type)} — ${esc(p.staffName||'')} <small style="color:var(--text3);">${esc(p.date||'')} ${esc(p.time||'')}</small>${p.splitLabel ? `<br><small style="color:var(--text3);">${esc(p.splitLabel)}</small>` : ''}</span>
      <span style="font-weight:600;color:${(p.thisPay||0) < 0 ? 'var(--red)' : 'var(--green)'};">${(p.thisPay||0).toFixed(2)} ₼</span>
    </div>
  `).join('') : '<p style="color:var(--text3);font-size:13px;">Ödəniş qeydi tapılmadı (köhnə sessiya ola bilər).</p>';

  const historyHtml = sessionLog.length ? sessionLog.map(l => `
    <div class="audit-timeline-item">
      <div class="audit-timeline-time">${esc(l.time||'')}</div>
      <div class="audit-timeline-text">${esc(stripTableName(l.message, o.tableName))}</div>
    </div>
  `).join('') : '<p style="color:var(--text3);font-size:13px;">Tarixçə qeydi yoxdur.</p>';

  detailEl.innerHTML = `
    <div class="ct-detail-header">
      <span><svg class="icon"><use href="#i-clipboard"></use></svg> ${esc(o.tableName)} ${o.restoreCount ? `<span style="font-size:12px;color:var(--orange);font-weight:700;" title="${o.restoreCount} dəfə bərpa edilib">(${o.restoreCount}× bərpa)</span>` : ''}</span>
      <span style="font-size:22px;font-weight:800;color:var(--green);">${(o.total||0).toFixed(2)} ₼</span>
    </div>
    ${o.void ? `<div style="background:rgba(220,53,69,.08);border:1px solid var(--red);border-radius:10px;padding:10px 12px;margin:8px 0;font-size:13px;">
      <b style="color:var(--red);">Geri qaytarılıb</b> — ${esc(o.void.byName || '')}, ${esc(new Date(o.void.at || 0).toLocaleString('az-AZ'))}<br>
      Səbəb: ${esc(o.void.reason || '—')}${o.void.newTableName ? `<br>Yeni masa: ${esc(o.void.newTableName)}` : ''}<br>
      <small style="color:var(--text3);">Bu çek hesabatlara daxil edilmir. Ödənişləri geri qaytarılıb.</small></div>` : ''}
    <div class="ct-detail-info-grid">
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Açılış</div><div class="ct-detail-info-block__value">${esc(firstEntry?`${firstEntry.date} ${firstEntry.time}`:'—')}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Bağlanış</div><div class="ct-detail-info-block__value">${esc(o.closedDate||'')} ${esc(o.closedTime||'')}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Açan</div><div class="ct-detail-info-block__value">${esc(o.openedByName||'—')}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Bağlayan</div><div class="ct-detail-info-block__value">${esc(o.staffName||'—')}</div></div>
    </div>
    <div class="ct-detail-section-title"><svg class="icon" style="width:.9em;height:.9em;"><use href="#i-food"></use></svg> Sifariş Edilən Mallar</div>
    ${itemsHtml}
    <div class="ct-detail-section-title"><svg class="icon" style="width:.9em;height:.9em;"><use href="#i-money"></use></svg> Ödəmələr</div>
    ${paymentsHtml}
    <div class="ct-detail-section-title"><svg class="icon" style="width:.9em;height:.9em;"><use href="#i-clipboard"></use></svg> Sessiya Tarixçəsi</div>
    <div class="audit-timeline">${historyHtml}</div>
    <div class="ct-detail-actions" style="flex-direction:column;align-items:stretch;">
      ${canRestore ? `<button class="btn btn-blue" style="padding:11px;" onclick="restoreClosedOrder('${jsId(o.id)}')"><svg class="icon"><use href="#i-refresh"></use></svg> Masanı geri qaytar</button>` : ''}
      ${canRestore ? `<small style="color:var(--text3);text-align:center;margin-top:6px;">"${esc((o.tableName||'').replace(/\s*\*+$/,''))} ${'*'.repeat((o.restoreCount||0)+1)}" adı ilə masa yenidən açılacaq, ödənişlər kassadan geri çıxacaq. Sabit masaya toxunulmur.</small>` : ''}
    </div>
  `;
}
























/* ═══ Mərhələ 2b: "Masanı geri qaytar" (storno əvəzi) ═══
   • Köhnə çek SİLİNMİR — üzərinə "void" (kim, nə vaxt, səbəb) yazılır və hesabatlardan çıxır.
   • Çekin bütün ödənişləri CARİ növbədə mənfi yazı ilə kassadan geri çıxır.
   • Nisyəsi müştərinin borcundan silinir (müştəri o nisyədən nəsə ödəyibsə — geri qaytarmaq olmur).
   • Mallar "*" işarəli yeni masaya keçir, ödənilməmiş kimi. Masa dəyişdirilib yenidən ödənilir və bağlanır.
   • Anbar: mallar artıq anbardan silinib; masada mal ləğv edilsə, anbar adi qaydada geri qayıdır.
   Hamısı BİR yazı ilə olur — ya tam, ya heç nə. */
export function restoreClosedOrder(id) {
  if (!hasPermission('table.restore')) { showToast('<svg class="icon"><use href="#i-ban"></use></svg> Masanı geri qaytarmaq icazəniz yoxdur'); return; }
  const o = closedById(id);
  if (!o) return;
  if (o.void) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Bu çek artıq geri qaytarılıb'); return; }
  if (o.deliveryId) { showToast('<svg class="icon"><use href="#i-warning"></use></svg> Paket sifarişi bu yolla geri qaytarılmır'); return; }
  const shift = needShift();
  if (!shift) return;

  const baseName = (o.tableName || '').replace(/\s*\*+$/, '');
  const newRestoreCount = (o.restoreCount || 0) + 1;
  const newName = `${baseName} ${'*'.repeat(newRestoreCount)}`;
  const chargeSum = money2(Object.values(o.charges || {}).reduce((sum, c) => sum + (Number(c.amount) || 0), 0));

  yzModal({
    title: '<svg class="icon"><use href="#i-refresh"></use></svg> Masanı geri qaytar',
    body: `<p class="yzi-p"><b>${esc(o.tableName)}</b> · ${(o.total || 0).toFixed(2)} ₼ · bağlanıb: ${esc(o.closedDate || '')} ${esc(o.closedTime || '')}</p>
      <ul style="margin:6px 0 10px 18px;font-size:13px;line-height:1.6;">
        <li>Masa <b>"${esc(newName)}"</b> adı ilə yenidən açılacaq.</li>
        <li>Bu çekin ödənişləri (${(o.paidAmount || 0).toFixed(2)} ₼) növbə №${esc(String(shift.no ?? ''))}-də <b>kassadan geri çıxacaq</b>.</li>
        ${chargeSum > 0 ? `<li>${chargeSum.toFixed(2)} ₼ nisyə müştərinin borcundan silinəcək.</li>` : ''}
        <li>Masa yenidən ödənilib bağlanmalıdır. Köhnə çek silinmir, "geri qaytarılıb" kimi qalır.</li>
      </ul>
      <label class="yzi-f"><span>Səbəb *</span><input type="text" id="yzRsReason" maxlength="200" placeholder="Məs: ödəniş növü səhv seçilib"></label>`,
    actions: [
      { label: 'Ləğv', cancel: true, cls: 'yzi-btn--ghost' },
      { label: 'Geri qaytar', cls: 'yzi-btn--gold', onClick: async (b) => {
        const reason = b.querySelector('#yzRsReason').value.trim();
        if (!reason) throw new Error('Səbəbi yazın');
        const sh = needShift(); if (!sh) throw new Error('Kassa növbəsi açıq deyil');
        const fresh = (await R.closedOrders.child(id).once('value')).val();
        if (!fresh) throw new Error('Çek tapılmadı');
        if (fresh.void) throw new Error('Bu çek artıq geri qaytarılıb');
        const now = serverNow();
        // Bu çekin ödənişləri (sessiyaya görə + arxivdəki siyahı)
        const pays = {};
        if (fresh.sessionId) Object.assign(pays, (await R.payments.orderByChild('sessionId').equalTo(fresh.sessionId).once('value')).val() || {});
        for (const pid of Object.keys(fresh.paymentIds || {})) {
          if (!pays[pid]) { const v = (await R.payments.child(pid).once('value')).val(); if (v) pays[pid] = v; }
        }
        const reversed = new Set(Object.values(pays).filter(x => x.reversalOf).map(x => x.reversalOf));
        const originals = Object.entries(pays).filter(([pid, x]) => !x.reversalOf && (Number(x.thisPay) || 0) > 0 && !reversed.has(pid));
        // Nisyələr: müştəri bir hissəsini ödəyibsə — geri qaytarmaq olmaz
        const chs = [];
        for (const [cid, c] of Object.entries(fresh.charges || {})) {
          const cur = (await R.customerCharges.child(cid).once('value')).val();
          if (!cur) continue;
          if ((Number(cur.paidAmount) || 0) > 0.001) throw new Error(`"${cur.customerName || c.customerName || 'Müştəri'}" bu nisyənin bir hissəsini artıq ödəyib — masa geri qaytarıla bilməz`);
          chs.push([cid, cur]);
        }
        const me = state.user || {};
        const newTableId = R.tables.push().key;
        const sessionId = `${newTableId}_${now}`;
        const total = money2(fresh.total || 0);
        const upd = {
          ['tables/' + newTableId]: {
            name: newName, capacity: 4, notes: fresh.notes || '', createdAt: now,
            restoreCount: newRestoreCount, isRestoredTemp: true, category: 'Bərpa edilmiş masalar',
            occupant: fresh.staffId || me.id || 'admin', activatedAt: now, sessionId,
            openedById: fresh.openedById || fresh.staffId || null, openedByName: fresh.openedByName || fresh.staffName || null
          },
          ['tableOrders/' + newTableId]: {
            items: fresh.items || {}, total, waiterId: fresh.staffId || me.id || 'admin',
            paidAmount: 0, remainingAmount: total, firstOrderAt: fresh.firstOrderAt || now,
            restoredFrom: id, updatedAt: now, billPrintedAt: null,
            // Banket masasıdırsa: əvvəlcədən alınmış beh (kassaya alındığı gün yazılıb) yeni masada da çıxılır
            ...(fresh.banquet?.id && Number(fresh.banquet.depositTotal) > 0 ? {
              banquet: fresh.banquet, paidAmount: money2(fresh.banquet.depositTotal), remainingAmount: money2(Math.max(0, total - Number(fresh.banquet.depositTotal))),
              pays: { _banquetDeposit: { type: 'deposit', typeLabel: 'Banket behi (əvvəlcədən alınıb)', thisPay: money2(fresh.banquet.depositTotal), banquetId: fresh.banquet.id, createdAt: now } }
            } : (fresh.banquet?.id ? { banquet: fresh.banquet } : {}))
          },
          ...(fresh.banquet?.id ? { [`banquetEvents/${fresh.banquet.id}/status`]: 'seated', [`banquetEvents/${fresh.banquet.id}/seated/tableId`]: newTableId, [`banquetEvents/${fresh.banquet.id}/seated/tableName`]: newName, [`banquetEvents/${fresh.banquet.id}/seated/sessionId`]: sessionId } : {}),
          ['closedOrders/' + id + '/void']: { at: now, byId: me.id || 'admin', byName: me.name || 'Rəhbər', reason, newTableId, newTableName: newName, shiftId: sh.id }
        };
        let refund = 0;
        for (const [pid, x] of originals) {
          const rk = R.payments.push().key;
          const neg = (v) => money2(-(Number(v) || 0));
          refund += Number(x.thisPay) || 0;
          upd['payments/' + rk] = {
            tableId: fresh.tableId || null, tableName: fresh.tableName || '?', sessionId: fresh.sessionId || null,
            staffId: me.id || 'admin', staffName: me.name || 'Rəhbər',
            type: x.type, typeLabel: 'Geri qaytarma · ' + (x.typeLabel || x.type),
            originalAmount: x.originalAmount || 0, finalAmount: x.finalAmount || 0, thisPay: neg(x.thisPay), paidBefore: 0,
            splitBreakdown: x.splitBreakdown ? Object.fromEntries(Object.entries(x.splitBreakdown).map(([k, v]) => [k, neg(v)])) : null,
            splitMethodNames: x.splitMethodNames || null, splitLabel: x.splitLabel ? 'Geri: ' + x.splitLabel : null,
            discountType: null, discountValue: 0,
            reversalOf: pid, restoreOf: id, reason, shiftId: sh.id,
            createdAt: now, time: new Date(now).toLocaleTimeString('az-AZ'), date: new Date(now).toLocaleDateString('az-AZ')
          };
        }
        for (const [cid, c] of chs) {
          const rk = R.customerCharges.push().key;
          upd['customerCharges/' + rk] = {
            type: 'reversal', customerId: c.customerId, customerName: c.customerName || '', amount: money2(c.amount),
            reversalOf: cid, restoreOf: id, reason, tableName: fresh.tableName || '?', items: c.items || null,
            staffId: me.id || 'admin', staffName: me.name || 'Rəhbər', shiftId: sh.id,
            createdAt: now, time: new Date(now).toLocaleTimeString('az-AZ'), date: new Date(now).toLocaleDateString('az-AZ')
          };
          upd[`customerCharges/${cid}/paidAmount`] = money2(c.amount);
          upd[`customers/${c.customerId}/balance`] = firebase.database.ServerValue.increment(-money2(c.amount));
        }
        try { await db.ref().update(upd); }
        catch (e) { throw new Error('Geri qaytarma alınmadı (bağlantı və ya icazə xətası). Heç nə dəyişməyib.'); }
        addLog('table_restore', `${me.name || 'Rəhbər'} "${fresh.tableName}" masasını "${newName}" adı ilə geri qaytardı: ${formatItemsList(fresh.items || {})} (${total.toFixed(2)} ₼). Kassadan geri: ${money2(refund).toFixed(2)} ₼${chs.length ? `, nisyə silindi: ${chs.reduce((s2, [, c]) => s2 + (Number(c.amount) || 0), 0).toFixed(2)} ₼` : ''}. Səbəb: ${reason}`,
          { tableId: newTableId, sessionId, closedOrderId: id, shiftId: sh.id, reason });
        if (state._selectedClosedOrderId === id) selectClosedOrder(id);
        showToast(`<svg class="icon"><use href="#i-check"></use></svg> "${newName}" yenidən açıldı`);
      } }
    ]
  });
}
