/* ═══════════════════════════════════════════
   ADMIN — ƏLAVƏ/DÜZƏLİŞ MODALI, AYARLAR
   Bu fayl: "+" düyməsi ilə açılan ümumi modal (həm qarson, həm masa
   üçün istifadə olunur), saveItem() ikisini ayırd edir, mətbəx PIN
   dəyişdirmə, menyu URL ayarı.
═══════════════════════════════════════════ */
function openAddModal() {
  state.editTarget = null;
  if (state.adminSection === 'waiters') {
    document.getElementById('addModalTitle').textContent = '➕ Yeni Qarson';
    document.getElementById('addModalBody').innerHTML = waiterForm({});
  } else {
    document.getElementById('addModalTitle').textContent = '➕ Yeni Kateqoriya və Masalar';
    document.getElementById('addModalBody').innerHTML = tableForm('', false);
  }
  document.getElementById('addModal').classList.add('open');
}

function closeAddModal() {
  document.getElementById('addModal').classList.remove('open');
  state.editTarget = null;
}

function saveItem() {
  const sec = state.editTarget
    ? state.editTarget.type
    : (state.adminSection === 'waiters' ? 'waiter' : 'table');

  if (sec === 'waiter') {
    const firstname  = (document.getElementById('fw_firstname')?.value||'').trim();
    const lastname   = (document.getElementById('fw_lastname')?.value||'').trim();
    const fathername = (document.getElementById('fw_fathername')?.value||'').trim();
    const birthdate  = (document.getElementById('fw_birthdate')?.value||'').trim();
    const phone      = (document.getElementById('fw_phone')?.value||'').trim();
    const address    = (document.getElementById('fw_address')?.value||'').trim();
    const idcard     = (document.getElementById('fw_idcard')?.value||'').trim();
    const fin        = (document.getElementById('fw_fin')?.value||'').trim();
    const voen       = (document.getElementById('fw_voen')?.value||'').trim();
    const pin        = (document.getElementById('fw_pin')?.value||'').trim();
    const avatarVal  = (document.getElementById('fw_avatar')?.value||'').trim();

    const name = [firstname, lastname].filter(Boolean).join(' ') || firstname || lastname;

    if (!firstname || !lastname) { showToast('❌ Ad və Soyad mütləqdir'); return; }
    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) { showToast('❌ 4 rəqəmli PIN lazımdır'); return; }

    const conflict = state.waiters.find(w => w.pin === pin &&
      (!state.editTarget || w.id !== state.editTarget.id));
    if (conflict) { showToast('❌ Bu PIN artıq istifadə olunur'); return; }

    const avatar = avatarVal ||
      `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=2ecc71&color=fff&size=200`;

    const waiterData = {
      name, firstname, lastname, fathername,
      birthdate, phone, address, idcard, fin, voen,
      pin, avatar
    };

    if (state.editTarget) {
      R.waiters.child(state.editTarget.id).update(waiterData);
      addLog('admin', `Qarson məlumatları yeniləndi: ${name}`, { waiterId: state.editTarget.id });
      showToast('✅ Məlumatlar yeniləndi');
    } else {
      R.waiters.push({ ...waiterData, status: 'ready', createdAt: Date.now() });
      addLog('admin', `Yeni qarson əlavə edildi: ${name}`, {});
      showToast('✅ Qarson əlavə edildi');
    }

  } else {
    const prefix = document.getElementById('ft_name').value.trim();
    if (!prefix) { showToast('❌ Kateqoriya adı lazımdır'); return; }

    if (state.editTarget) {
      R.tables.child(state.editTarget.id).update({ name: prefix });
      addLog('admin', `Masa adı dəyişdirildi: ${prefix}`, {});
      showToast('✅ Masa yeniləndi');
    } else {
      const count = parseInt(document.getElementById('ft_count').value) || 1;
      for (let i = 1; i <= count; i++) {
        const tName = count === 1 ? prefix : `${prefix} ${i}`;
        R.tables.push({
          name: tName,
          category: prefix,
          occupant: null,
          notes: '',
          createdAt: Date.now() + i
        });
      }
      addLog('admin', `${count} ədəd masa əlavə edildi: ${prefix}`, {});
      showToast(`✅ ${count} ədəd masa əlavə edildi`);
    }
  }
  closeAddModal();
}

/* ── Mətbəx PIN ── */
function openKitchenPinModal() {
  document.getElementById('newKitchenPin').value = '';
  document.getElementById('kitchenPinModal').classList.add('open');
}
function closeKitchenPinModal() { document.getElementById('kitchenPinModal').classList.remove('open'); }
function saveKitchenPin() {
  const pin = document.getElementById('newKitchenPin').value.trim();
  if (pin.length !== 4 || !/^\d{4}$/.test(pin)) { showToast('❌ 4 rəqəmli PIN daxil edin'); return; }
  if (String(pin) === String(ADMIN_PIN)) { showToast('❌ Admin PIN ilə eyni ola bilməz'); return; }
  db.ref('settings/kitchenPin').set(pin);
  state.kitchenPin = pin;
  addLog('admin','Mətbəx PIN dəyişdirildi',{});
  closeKitchenPinModal();
  showToast('✅ Mətbəx PIN dəyişdirildi');
}

/* ── Menyu URL ── */
function saveMenuUrl() {
  const url = document.getElementById('menuUrlInput').value.trim();
  if (!url) { showToast('❌ URL boş ola bilməz'); return; }
  db.ref('settings/menuUrl').set(url);
  addLog('admin',`Menyu URL dəyişdirildi: ${url}`,{});
  document.getElementById('menuUrlStatus').textContent = '✅ Yadda saxlanıldı';
  setTimeout(()=>{ document.getElementById('menuUrlStatus').textContent=''; },3000);
  showToast('✅ Menyu URL yadda saxlandı');
}
