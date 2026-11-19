/* ═══════════════════════════════════════════
   YUZA POS — ADMİN PANELİ: MÜŞTƏRİLƏR (NİSYƏ) VƏ ÖDƏNİŞ NÖVLƏRİ
   Mərhələ 5: admin.js-dən ayrılıb (məntiq dəyişməyib). Ümumi giriş nöqtəsi — admin.js.
═══════════════════════════════════════════ */
import { state } from './state.js';
import { esc, showToast, addLog, confirmAction, serverNow } from './utils.js';
import { R, db } from './firebase-service.js';
import { closeAddModal } from './admin.js';
import { needShift } from './yuza-shift.js';


// Mövcud HTML-də onclick="..."/onchange="..." istifadə olunan funksiyalar qlobal əlçatan olmalıdır
/* ═══════════════════════════════════════════
   MÜŞTƏRİLƏR (NİSYƏ HESABI)
═══════════════════════════════════════════ */
export function renderCustomers() {
  const el = document.getElementById('customersGrid');
  if (!el) return;
  if (!state.customers || !state.customers.length) {
    el.innerHTML = '<p style="color:var(--text3);">Hələ müştəri qeydə alınmayıb.</p>';
    return;
  }
  el.innerHTML = state.customers.slice().sort((a,b)=>(b.balance||0)-(a.balance||0)).map(c => `
    <div class="item-card">
      <div class="item-card-header">
        <div style="width:52px;height:52px;border-radius:50%;background:var(--card2);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <svg class="icon" style="width:24px;height:24px;color:var(--text2);"><use href="#i-user"></use></svg>
        </div>
        <div class="item-info">
          <h3>${esc(c.name)}</h3>
          ${c.phone ? `<small style="color:var(--text3);display:block;"><svg class="icon"><use href="#i-phone"></use></svg> ${esc(c.phone)}</small>` : ''}
        </div>
      </div>
      <span class="status-badge ${(c.balance>0)?'badge-red':'badge-green'}">${(c.balance||0).toFixed(2)} ₼ borc</span>
      <div class="item-actions">
        ${(c.balance>0) ? `<button class="btn btn-green" onclick="openCustomerPaymentModal('${c.id}')"><svg class="icon"><use href="#i-cash"></use></svg> Ödəniş Al</button>` : ''}
        <button class="btn" style="border:1px solid var(--blue);color:var(--blue);" onclick="openCustomerHistoryModal('${c.id}')"><svg class="icon"><use href="#i-clipboard"></use></svg> Tarixçə</button>
        <button class="btn btn-blue" onclick="editCustomer('${c.id}')"><svg class="icon"><use href="#i-edit"></use></svg> Redaktə</button>
        <button class="btn btn-red" onclick="deleteCustomer('${c.id}')"><svg class="icon"><use href="#i-trash"></use></svg> Sil</button>
      </div>
    </div>
  `).join('');
}

export function customerForm(c = {}) {
  return `
    <div class="form-group"><label>Ad Soyad *</label><input type="text" id="cu_name" value="${esc(c.name||'')}" placeholder="Məs: Vüqar Əliyev"></div>
    <div class="form-group"><label>Telefon</label><input type="text" id="cu_phone" value="${esc(c.phone||'')}" placeholder="+994 XX XXX XX XX"></div>
    <input type="hidden" id="cu_balance" value="${c.balance||0}">
  `;
}

export function saveCustomer() {
  const name = (document.getElementById('cu_name')?.value||'').trim();
  const phone = (document.getElementById('cu_phone')?.value||'').trim();
  if (!name) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Ad mütləqdir'); return; }
  const balance = parseFloat(document.getElementById('cu_balance')?.value) || 0;

  if (state.editTarget?.type === 'customer') {
    R.customers.child(state.editTarget.id).update({ name, phone });
    addLog('customer_mgmt', `Müştəri redaktə edildi: ${name}`, {});
  } else {
    R.customers.push({ name, phone, balance, createdAt: Date.now() });
    addLog('customer_mgmt', `Yeni müştəri qeydə alındı: ${name}`, {});
  }
  closeAddModal();
  showToast('<svg class="icon"><use href="#i-check"></use></svg> Müştəri saxlanıldı');
}

export function editCustomer(id) {
  const c = state.customers.find(x=>x.id===id);
  if (!c) return;
  state.editTarget = { type: 'customer', id };
  document.getElementById('addModalTitle').innerHTML = '<svg class="icon"><use href="#i-user"></use></svg> Müştərini Redaktə Et';
  document.getElementById('addModalBody').innerHTML = customerForm(c);
  document.getElementById('addModal').classList.add('open');
}

export function deleteCustomer(id) {
  const c = state.customers.find(x=>x.id===id);
  if (c?.balance > 0) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Bu müştərinin ödənilməmiş borcu var, əvvəlcə sıfırlayın.'); return; }
  confirmAction(`"${esc(c?.name)}" müştərisi silinsin?`, () => {
    R.customers.child(id).remove();
    addLog('customer_mgmt', `Müştəri silindi: ${c?.name}`, {});
    showToast('<svg class="icon"><use href="#i-trash"></use></svg> Müştəri silindi');
  });
}

export function openCustomerHistoryModal(customerId) {
  const c = state.customers.find(x=>x.id===customerId);
  if (!c) return;
  document.getElementById('customerHistoryModal').dataset.customerId = customerId;
  document.getElementById('customerHistoryTitle').innerHTML = `<svg class="icon"><use href="#i-clipboard"></use></svg> ${esc(c.name)} — Hesab Tarixçəsi`;
  document.getElementById('customerHistoryBalance').innerHTML = `Cari borc: <span style="color:${(c.balance||0)>0?'var(--red)':'var(--green)'};">${(c.balance||0).toFixed(2)} ₼</span>`;
  // Borcu olmayan müştəri üçün "Ödəniş Al" düyməsi lazımsızdır - gizlədilir
  const payBtn = document.getElementById('customerHistoryPayBtn');
  if (payBtn) payBtn.style.display = (c.balance||0) > 0 ? 'flex' : 'none';

  // Bütöv hesab tarixçəsi: HƏM borc yazılan alışlar (qırmızı), HƏM edilən ödənişlər
  // (yaşıl) XRONOLOJİ ardıcıllıqla göstərilir - əvvəllər yalnız alışlar görünürdü.
  const entries = (state.customerCharges||[]).filter(ch => ch.customerId === customerId)
    .slice().sort((a,b) => (b.createdAt||0) - (a.createdAt||0));
  const el = document.getElementById('customerHistoryList');
  if (!entries.length) {
    el.innerHTML = '<p style="color:var(--text3);padding:16px 0;text-align:center;">Hələ heç bir əməliyyat qeydə alınmayıb.</p>';
  } else {
    el.innerHTML = entries.map(ch => {
      if (ch.type === 'reversal') {
        return `<div class="audit-timeline-item">
          <div class="audit-timeline-text">
            <strong style="color:var(--orange);">Nisyə silindi (masa geri qaytarıldı) — ${(ch.amount||0).toFixed(2)} ₼</strong><br>
            <span style="color:var(--text2);font-size:12px;">${esc(ch.tableName||'')}${ch.reason ? ' · ' + esc(ch.reason) : ''}</span><br>
            <span style="color:var(--text3);font-size:11px;">${esc(ch.staffName||'')}</span>
          </div>
          <div class="audit-timeline-time">${esc(ch.time||'')} — ${esc(ch.date||'')}</div>
        </div>`;
      }
      if (ch.type === 'payment') {
        const typeLabel = ch.paymentType === 'cash' ? 'Nağd' : ch.paymentType === 'pos' ? 'POS'
          : (state.paymentMethods||[]).find(pm => pm.id === ch.paymentType)?.name || ch.paymentType || 'Nağd';
        return `<div class="audit-timeline-item">
          <div class="audit-timeline-text">
            <strong style="color:var(--green);"><svg class="icon" style="width:.9em;height:.9em;"><use href="#i-check"></use></svg> Ödəniş qəbul edildi — ${(ch.amount||0).toFixed(2)} ₼</strong><br>
            ${ch.note ? `<span style="color:var(--text2);font-size:12px;">${esc(ch.note)}</span><br>` : ''}
            <span style="color:var(--text2);font-size:12px;">${typeLabel}</span><br>
            <span style="color:var(--text3);font-size:11px;">${esc(ch.staffName||'')}</span>
          </div>
          <div class="audit-timeline-time">${esc(ch.time||'')} — ${esc(ch.date||'')}</div>
        </div>`;
      }
      const itemsStr = (ch.items||[]).map(it => `${it.qty}x ${it.name}`).join(', ');
      const paidAmount = ch.paidAmount || 0;
      const chargeRemaining = Math.round(((ch.amount||0) - paidAmount) * 100) / 100;
      const statusStr = paidAmount <= 0 ? '' : (chargeRemaining <= 0.01 ? '<span style="color:var(--green);font-size:11px;font-weight:700;"> ✓ Tam ödənilib</span>' : `<span style="color:var(--orange);font-size:11px;font-weight:700;"> (${paidAmount.toFixed(2)} ₼ ödənilib, ${chargeRemaining.toFixed(2)} ₼ qalıb)</span>`);
      return `<div class="audit-timeline-item">
        <div class="audit-timeline-text">
          <strong>${esc(ch.tableName)}</strong> — <strong style="color:var(--red);">${(ch.amount||0).toFixed(2)} ₼</strong>${statusStr}<br>
          <span style="color:var(--text2);font-size:12px;">${esc(itemsStr)}</span><br>
          <span style="color:var(--text3);font-size:11px;">${esc(ch.staffName||'')}</span>
        </div>
        <div class="audit-timeline-time">${esc(ch.time||'')} — ${esc(ch.date||'')}</div>
      </div>`;
    }).join('');
  }
  document.getElementById('customerHistoryModal').classList.add('open');
}

export function closeCustomerHistoryModal() {
  document.getElementById('customerHistoryModal').classList.remove('open');
}

// Ödəniş modalında seçilmiş konkret nisyə qeydlərini izləyir (modul-səviyyəli, çünki
// checkbox-ların onchange-i birbaşa bunu yeniləyir)
export let _selectedChargeIds = [];

export function openCustomerPaymentModal(customerId) {
  customerId = customerId || document.getElementById('customerHistoryModal').dataset.customerId;
  const c = state.customers.find(x=>x.id===customerId);
  if (!c) return;
  document.getElementById('customerPaymentModal').dataset.customerId = customerId;
  document.getElementById('customerPaymentCustomerName').textContent = c.name;
  document.getElementById('customerPaymentCurrentBalance').textContent = `Cari borc: ${(c.balance||0).toFixed(2)} ₼`;
  document.getElementById('customerPaymentAmount').value = '';
  document.getElementById('customerPaymentAmount').max = c.balance||0;
  // Ödəniş növü seçimini dinamik qururuq - sabit "Nağd"/"POS"-dan əlavə, admin
  // "Ödəniş Növləri" bölməsində əlavə etdiyi HƏR bir xüsusi növü də göstərir.
  const typeSel = document.getElementById('customerPaymentType');
  typeSel.innerHTML = '<option value="cash">Nağd</option><option value="pos">POS</option>' +
    (state.paymentMethods||[]).map(pm => `<option value="${esc(pm.id)}">${esc(pm.name)}</option>`).join('');
  typeSel.value = 'cash';
  document.getElementById('customerPaymentError').textContent = '';
  _selectedChargeIds = [];

  // Bu müştəriyə aid, hələ TAM ödənilməmiş nisyə qeydlərini (malları) göstərir - admin
  // konkret birini (məs. yalnız "Tikə Kabab") seçib ONU ödəyə bilər, digərləri qalar.
  const unpaidCharges = (state.customerCharges||[])
    .filter(ch => ch.customerId === customerId && ch.type !== 'payment' && ch.type !== 'reversal' && (((ch.amount||0) - (ch.paidAmount||0)) > 0.01))
    .sort((a,b) => (a.createdAt||0) - (b.createdAt||0));

  const listEl = document.getElementById('customerPaymentChargesList');
  if (!unpaidCharges.length) {
    listEl.innerHTML = '<p style="font-size:12px;color:var(--text3);padding:10px;">Ayrıca nisyə qeydi tapılmadı.</p>';
  } else {
    listEl.innerHTML = unpaidCharges.map(ch => {
      const remaining = Math.round(((ch.amount||0) - (ch.paidAmount||0)) * 100) / 100;
      const itemsStr = (ch.items||[]).map(it => `${it.qty}x ${it.name}`).join(', ') || ch.tableName || 'Nisyə';
      return `<label class="charge-select-row">
        <input type="checkbox" onchange="toggleChargeSelection('${ch.id}', this.checked)" style="width:17px;height:17px;flex-shrink:0;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:12.5px;font-weight:600;">${esc(itemsStr)}</div>
          <div style="font-size:11px;color:var(--text3);">${esc(ch.date||'')}</div>
        </div>
        <div style="font-weight:700;color:var(--red);white-space:nowrap;font-size:13px;">${remaining.toFixed(2)} ₼</div>
      </label>`;
    }).join('');
  }

  document.getElementById('customerPaymentModal').classList.add('open');
}

export function toggleChargeSelection(chargeId, checked) {
  if (checked) {
    if (!_selectedChargeIds.includes(chargeId)) _selectedChargeIds.push(chargeId);
  } else {
    _selectedChargeIds = _selectedChargeIds.filter(id => id !== chargeId);
  }
  // Seçilənlərin cəmini avtomatik məbləğ sahəsinə yazır - istifadəçi hələ də əl ilə
  // dəyişdirə bilər (məs. seçilən 20 ₼-dən yalnız 10 ₼ ödəmək istəsə)
  const total = _selectedChargeIds.reduce((sum, id) => {
    const ch = state.customerCharges.find(c => c.id === id);
    return sum + (ch ? Math.round(((ch.amount||0)-(ch.paidAmount||0))*100)/100 : 0);
  }, 0);
  document.getElementById('customerPaymentAmount').value = total > 0 ? total.toFixed(2) : '';
}

export function closeCustomerPaymentModal() {
  document.getElementById('customerPaymentModal').classList.remove('open');
  document.getElementById('customerPaymentAmount').value = '';
}

export function submitCustomerPayment() {
  const customerId = document.getElementById('customerPaymentModal').dataset.customerId;
  const c = state.customers.find(x=>x.id===customerId);
  const errEl = document.getElementById('customerPaymentError');
  errEl.textContent = '';
  if (!c) return;
  const amount = Math.round((parseFloat(document.getElementById('customerPaymentAmount').value) || 0) * 100) / 100;
  const paymentType = document.getElementById('customerPaymentType').value;
  const balance = c.balance || 0;

  if (amount <= 0) { errEl.textContent = 'Məbləğ 0-dan böyük olmalıdır.'; return; }
  if (amount > balance) { errEl.textContent = `Ödəniş cari borcdan (${balance.toFixed(2)} ₼) çox ola bilməz.`; return; }
  const shift = needShift();   // Mərhələ 2c: nisyə ödənişi də kassaya düşür — açıq növbə lazımdır
  if (!shift) { errEl.textContent = 'Kassa növbəsi açıq deyil.'; return; }

  // Ödənişi konkret nisyə qeydlərinə bölüşdürür: ƏVVƏLCƏ seçilmiş qeydlərə (tam
  // qalıqları qədər), sonra QALAN məbləği (əgər varsa, istifadəçi seçilən cəmdən çox
  // yazıbsa) digər ödənilməmiş qeydlərə ən köhnədən başlayaraq (FIFO) bölüşdürür -
  // beləliklə "yalnız kababın pulunu ödə, qalanı qalsın" TAM işləyir, eyni zamanda
  // sərbəst/ümumi məbləğ daxil etmək imkanı da itmir.
  const allUnpaidSorted = (state.customerCharges||[])
    .filter(ch => ch.customerId === customerId && ch.type !== 'payment' && ch.type !== 'reversal' && (((ch.amount||0)-(ch.paidAmount||0)) > 0.01))
    .sort((a,b) => (a.createdAt||0) - (b.createdAt||0));

  const orderedIds = [..._selectedChargeIds, ...allUnpaidSorted.map(ch=>ch.id).filter(id => !_selectedChargeIds.includes(id))];
  let remainingToAllocate = amount;
  const chargeUpdates = {};
  orderedIds.forEach(chargeId => {
    if (remainingToAllocate <= 0.001) return;
    const ch = allUnpaidSorted.find(x => x.id === chargeId);
    if (!ch) return;
    const chargeRemaining = Math.round(((ch.amount||0)-(ch.paidAmount||0))*100)/100;
    const applyAmount = Math.min(chargeRemaining, remainingToAllocate);
    chargeUpdates[chargeId] = Math.round(((ch.paidAmount||0) + applyAmount)*100)/100;
    remainingToAllocate = Math.round((remainingToAllocate - applyAmount)*100)/100;
  });
  // Mərhələ 2b: bölüşdürmə + borcun azalması + ödəniş qeydi BİR yazı ilə (yarımçıq qalmır)
  const upd = {};
  Object.entries(chargeUpdates).forEach(([chargeId, newPaidAmount]) => { upd['customerCharges/' + chargeId + '/paidAmount'] = newPaidAmount; });
  upd[`customers/${customerId}/balance`] = firebase.database.ServerValue.increment(-amount);

  const paidItemsDesc = _selectedChargeIds.length
    ? _selectedChargeIds.map(id => { const ch = state.customerCharges.find(x=>x.id===id); return ch ? (ch.items||[]).map(it=>it.name).join(', ') : ''; }).filter(Boolean).join(' + ')
    : '';

  // Ödənişi HƏM ayrıca "customerCharges" jurnalına (ledger) əlavə edirik ki, tarixçədə
  // görünsün, HƏM DƏ ümumi tarixçəyə (Loglar) qeyd edirik.
  const _ts = serverNow();
  upd['customerCharges/' + R.customerCharges.push().key] = {
    customerId, type: 'payment', amount, paymentType, note: paidItemsDesc || null,
    staffId: state.user?.id || null, staffName: state.user?.name || '?', shiftId: shift.id,
    createdAt: _ts, time: new Date(_ts).toLocaleTimeString('az-AZ'), date: new Date(_ts).toLocaleDateString('az-AZ')
  };
  const btnEl = document.querySelector('#customerPaymentModal .btn-green');
  if (btnEl) btnEl.disabled = true;
  db.ref().update(upd).then(() => {
    if (btnEl) btnEl.disabled = false;
    _afterCustomerPayment(c, amount, paymentType, paidItemsDesc, customerId);
  }).catch(() => {
    if (btnEl) btnEl.disabled = false;
    errEl.textContent = 'Ödəniş yazılmadı (bağlantı və ya icazə xətası). Heç nə dəyişməyib.';
  });
}
export function _afterCustomerPayment(c, amount, paymentType, paidItemsDesc, customerId) {
  // Ödəniş növünün oxunaqlı adını tapır - sabit (Nağd/POS) və ya admin-in əlavə
  // etdiyi xüsusi növ ola bilər
  const paymentTypeLabel = paymentType === 'cash' ? 'Nağd' : paymentType === 'pos' ? 'POS'
    : (state.paymentMethods||[]).find(pm => pm.id === paymentType)?.name || paymentType;

  addLog('credit_payment', `${state.user?.name} "${c.name}" adlı müştərinin nisyə borcundan ${amount.toFixed(2)} ₼ ödəniş qəbul etdi${paidItemsDesc ? ' ('+paidItemsDesc+')' : ''} (${paymentTypeLabel})`,
    { customerId, customerName: c.name, amount, paymentType, staffId: state.user?.id, staffName: state.user?.name });

  closeCustomerPaymentModal();
  showToast(`<svg class="icon"><use href="#i-check"></use></svg> ${amount.toFixed(2)} ₼ ödəniş qəbul edildi`);
  // Tarixçə pəncərəsi bu ödənişdən ƏVVƏL açıq idisə, onu da bağlayırıq - ödəniş
  // təsdiqlənəndən sonra bütün pəncərələr bağlanıb əsas müştəri siyahısına qayıdılır.
  closeCustomerHistoryModal();
}
/* ═══════════════════════════════════════════
   ÖDƏNİŞ NÖVLƏRİ (ADMİN TƏRƏFİNDƏN TƏNZİMLƏNİR)
═══════════════════════════════════════════ */
export function renderPaymentMethods() {
  const el = document.getElementById('paymentMethodsGrid');
  if (!el) return;
  if (!state.paymentMethods || !state.paymentMethods.length) {
    el.innerHTML = '<p style="color:var(--text3);">Hələ əlavə ödəniş növü yaradılmayıb. Nağd və Bölünmüş ödəniş hər zaman mövcuddur.</p>';
    return;
  }
  el.innerHTML = state.paymentMethods.map(p => `
    <div class="item-card">
      <div class="item-card-header">
        <div style="width:44px;height:44px;border-radius:10px;background:var(--card2);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <svg class="icon" style="width:20px;height:20px;color:var(--blue);"><use href="#i-card"></use></svg>
        </div>
        <div class="item-info"><h3>${esc(p.name)}</h3></div>
      </div>
      <div class="item-actions">
        <button class="btn btn-blue" onclick="editPaymentMethod('${p.id}')"><svg class="icon"><use href="#i-edit"></use></svg> Redaktə</button>
        <button class="btn btn-red" onclick="deletePaymentMethod('${p.id}')"><svg class="icon"><use href="#i-trash"></use></svg> Sil</button>
      </div>
    </div>
  `).join('');
}

export function paymentMethodForm(p = {}) {
  return `<div class="form-group"><label>Ödəniş növünün adı *</label><input type="text" id="pm_name" value="${esc(p.name||'')}" placeholder="Məs: Bank Köçürməsi"></div>`;
}

export function savePaymentMethod() {
  const name = (document.getElementById('pm_name')?.value||'').trim();
  if (!name) { showToast('<svg class="icon"><use href="#i-error"></use></svg> Ad mütləqdir'); return; }

  if (state.editTarget?.type === 'paymentMethod') {
    R.paymentMethods.child(state.editTarget.id).update({ name });
    addLog('payment_method_mgmt', `Ödəniş növü redaktə edildi: ${name}`, {});
  } else {
    R.paymentMethods.push({ name, createdAt: Date.now() });
    addLog('payment_method_mgmt', `Yeni ödəniş növü yaradıldı: ${name}`, {});
  }
  closeAddModal();
  showToast('<svg class="icon"><use href="#i-check"></use></svg> Ödəniş növü saxlanıldı');
}

export function editPaymentMethod(id) {
  const p = state.paymentMethods.find(x=>x.id===id);
  if (!p) return;
  state.editTarget = { type: 'paymentMethod', id };
  document.getElementById('addModalTitle').innerHTML = '<svg class="icon"><use href="#i-card"></use></svg> Ödəniş Növünü Redaktə Et';
  document.getElementById('addModalBody').innerHTML = paymentMethodForm(p);
  document.getElementById('addModal').classList.add('open');
}

export function deletePaymentMethod(id) {
  const p = state.paymentMethods.find(x=>x.id===id);
  confirmAction(`"${esc(p?.name)}" ödəniş növü silinsin?`, () => {
    R.paymentMethods.child(id).remove();
    addLog('payment_method_mgmt', `Ödəniş növü silindi: ${p?.name}`, {});
    showToast('<svg class="icon"><use href="#i-trash"></use></svg> Ödəniş növü silindi');
  });
}
