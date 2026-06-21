function openAddModal() {
  const sec = state.adminSection;
  state.editTarget = null;
  document.getElementById('addModal').classList.add('open');

  if (sec === 'waiters') {
    document.getElementById('addModalTitle').textContent = '➕ Yeni Qarson';
    document.getElementById('addModalBody').innerHTML = waiterForm();
  } else if (sec === 'tables') {
    document.getElementById('addModalTitle').textContent = '➕ Yeni Masa';
    document.getElementById('addModalBody').innerHTML = tableForm();
  } else if (sec === 'menu') {
    document.getElementById('addModalTitle').textContent = '➕ Yeni Mal';
    document.getElementById('addModalBody').innerHTML = menuItemForm();
    onMenuCategorySelectChange();
  }
}

function saveItem() {
  const sec = state.adminSection;
  if (sec === 'waiters') saveWaiter();
  else if (sec === 'tables') saveTable();
  else if (sec === 'menu') saveMenuItem();
}

// ── QARSON YADDA SAXLA ──
function saveWaiter() {
  const firstname = document.getElementById('fw_firstname').value.trim();
  const lastname  = document.getElementById('fw_lastname').value.trim();
  const pin       = document.getElementById('fw_pin').value.trim();
  const avatar    = document.getElementById('fw_avatar').value;
  const phone     = document.getElementById('fw_phone').value.trim();
  const fin       = document.getElementById('fw_fin').value.trim();
  const fathername= document.getElementById('fw_fathername').value.trim();
  const birthdate = document.getElementById('fw_birthdate').value;
  const address   = document.getElementById('fw_address').value.trim();
  const idcard    = document.getElementById('fw_idcard').value.trim();
  const voen      = document.getElementById('fw_voen').value.trim();

  if (!firstname || !lastname || !pin) {
    showToast('❌ Ad, soyad və PIN mütləqdir!'); return;
  }
  if (!/^\d{4}$/.test(pin)) {
    showToast('❌ PIN 4 rəqəm olmalıdır!'); return;
  }
  const name = firstname + ' ' + lastname;

  const data = {
    name, firstname, lastname, pin, phone, fin, fathername,
    birthdate, address, idcard, voen,
    avatar: avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=2ecc71&color=fff&size=200`,
    status: 'ready', createdAt: Date.now()
  };

  if (state.editTarget?.type === 'waiter') {
    R.waiters.child(state.editTarget.id).update(data);
    addLog('admin', `Qarson yeniləndi: ${name}`, { waiterId: state.editTarget.id });
  } else {
    const newRef = R.waiters.push();
    newRef.set(data);
    addLog('admin', `Yeni qarson əlavə edildi: ${name}`, { waiterId: newRef.key });
  }
  closeAddModal();
  showToast('✅ Qarson saxlanıldı');
}

// ── MASA YADDA SAXLA ──
function saveTable() {
  const prefix = document.getElementById('ft_name').value.trim();
  const count  = parseInt(document.getElementById('ft_count')?.value || '1');

  if (!prefix) { showToast('❌ Masa adı/prefiks mütləqdir!'); return; }

  if (state.editTarget?.type === 'table') {
    R.tables.child(state.editTarget.id).update({ name: prefix });
    addLog('admin', `Masa adı yeniləndi: ${prefix}`, { tableId: state.editTarget.id });
  } else {
    for (let i = 1; i <= count; i++) {
      const newRef = R.tables.push();
      newRef.set({
        name: prefix + ' ' + i,
        category: prefix,
        occupant: null,
        notes: '',
        createdAt: Date.now()
      });
    }
    addLog('admin', `${count} ədəd "${prefix}" masası yaradıldı`, {});
  }
  closeAddModal();
  showToast('✅ Masa saxlanıldı');
}

// ── MENYU MALI YADDA SAXLA ──
function saveMenuItem() {
  const name  = document.getElementById('fm_name').value.trim();
  const price = parseFloat(document.getElementById('fm_price').value);
  const photo = document.getElementById('fm_photo').value;
  const desc  = document.getElementById('fm_description').value.trim();
  const selectCat = document.getElementById('fm_category_select').value;
  const newCat    = document.getElementById('fm_category_new').value.trim();
  const category  = selectCat === '__new__' ? newCat : selectCat;

  if (!name || !price || !category) {
    showToast('❌ Ad, qiymət və kateqoriya mütləqdir!'); return;
  }
  if (selectCat === '__new__' && !newCat) {
    showToast('❌ Yeni kateqoriya adı daxil edin!'); return;
  }

  const data = {
    name, price, category, description: desc,
    photo: photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=f39c12&color=fff&size=200`,
    available: true, createdAt: Date.now()
  };

  if (state.editTarget?.type === 'menuItem') {
    R.menuItems.child(state.editTarget.id).update(data);
    addLog('admin', `Mal yeniləndi: ${name}`, { menuItemId: state.editTarget.id });
  } else {
    const newRef = R.menuItems.push();
    newRef.set(data);
    addLog('admin', `Yeni mal əlavə edildi: ${name}`, { menuItemId: newRef.key });
  }
  closeAddModal();
  showToast('✅ Mal saxlanıldı');
}

function closeAddModal() {
  document.getElementById('addModal').classList.remove('open');
  state.editTarget = null;
}
