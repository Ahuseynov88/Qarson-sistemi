/* ═══════════════════════════════════════════
   İŞÇİ İCAZƏ SİSTEMİ
   Bu fayl: işçilər üçün tam çevik icazə sistemi.
   Hər icazə ayrıca checkbox — admin istədiyini seçir.
═══════════════════════════════════════════ */

/* ── Bütün mövcud icazələr (qruplara görə) ── */
const ALL_PERMISSIONS = [
  {
    group: 'Masa əməliyyatları',
    icon: '🪑',
    items: [
      { key: 'table.view',     label: 'Masaları görmək' },
      { key: 'table.open',     label: 'Masa açmaq (müştəri oturursa)' },
      { key: 'table.close',    label: 'Masanı bağlamaq' },
      { key: 'table.transfer', label: 'Masadan-masaya köçürmə' },
      { key: 'waiter.view',    label: 'Digər işçilərin masalarını görmək' },
    ]
  },
  {
    group: 'Sifariş',
    icon: '🍔',
    items: [
      { key: 'order.create',      label: 'Sifariş yaratmaq' },
      { key: 'order.view',        label: 'Sifarişi görmək' },
      { key: 'order.add_item',    label: 'Sifarişə mal əlavə etmək' },
      { key: 'order.cancel_item', label: 'Sifarişdən mal silmək' },
      { key: 'order.cancel_all',  label: 'Bütün sifarişi ləğv etmək' },
      { key: 'order.discount',    label: 'Endirim vermək' },
      { key: 'order.refund',      label: 'Geri qaytarma (refund)' },
    ]
  },
  {
    group: 'Hesab və Ödəniş',
    icon: '💰',
    items: [
      { key: 'bill.print',          label: 'Hesab çap etmək' },
      { key: 'bill.payment_cash',   label: 'Nağd ödəniş qəbul etmək' },
      { key: 'bill.payment_pos',    label: 'POS ödəniş qəbul etmək' },
      { key: 'bill.credit',         label: 'Nisyəyə yazmaq' },
      { key: 'bill.payment_credit', label: 'Nisyə ödənişi qəbul etmək' },
    ]
  },
  {
    group: 'Müştəri xidməti',
    icon: '👥',
    items: [
      { key: 'customer.respond', label: 'Müştəri çağırışına cavab vermək' },
      { key: 'kitchen.notify',   label: 'Mətbəxə bildiriş göndərmək' },
      { key: 'chat.send',        label: 'Müştəri ilə yazışmaq' },
      { key: 'note.write',       label: 'Masa qeydi yazmaq' },
    ]
  },
  {
    group: 'Hesabat',
    icon: '📊',
    items: [
      { key: 'report.daily',  label: 'Gün sonu hesabat' },
      { key: 'report.weekly', label: 'Həftəlik hesabat' },
    ]
  },
  {
    group: 'Menyu',
    icon: '🍽️',
    items: [
      { key: 'menu.view',   label: 'Menyunu görmək' },
      { key: 'menu.edit',   label: 'Menyu dəyişdirmək' },
    ]
  },
  {
    group: 'İşçi idarəsi',
    icon: '👔',
    items: [
      { key: 'waiter.manage', label: 'Qarson statusunu dəyişmək' },
      { key: 'staff.view',    label: 'İşçiləri görmək' },
    ]
  }
];

/* ── İşçinin icazəsini yoxla ── */
function staffHasPermission(staffUser, action) {
  if (!staffUser) return false;
  const perms = staffUser.permissions || [];
  return perms.includes(action);
}

/* ── İcazə formasını HTML olaraq render et ── */
function renderPermissionCheckboxes(existingPerms = []) {
  return ALL_PERMISSIONS.map(group => `
    <div style="margin-bottom:16px;">
      <div style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;
                  letter-spacing:.06em;margin-bottom:8px;padding-bottom:4px;
                  border-bottom:1px solid var(--border);">
        ${group.icon} ${group.group}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
        ${group.items.map(item => `
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;
                         font-size:13px;color:var(--text);padding:6px 8px;
                         border-radius:8px;background:var(--bg);border:1px solid var(--border);">
            <input type="checkbox" name="staff_perm" value="${item.key}"
                   ${existingPerms.includes(item.key) ? 'checked' : ''}
                   style="accent-color:var(--green);width:16px;height:16px;flex-shrink:0;">
            ${item.label}
          </label>
        `).join('')}
      </div>
    </div>
  `).join('');
}

/* ── Formadan seçilmiş icazələri oxu ── */
function readPermissionCheckboxes() {
  const checkboxes = document.querySelectorAll('input[name="staff_perm"]:checked');
  return Array.from(checkboxes).map(cb => cb.value);
}

/* ── Sürətli seçim: standart dəstlər ── */
const PERMISSION_PRESETS = {
  waiter: {
    label: '🤵 Adi Qarson kimi',
    perms: ['table.view','table.open','order.create','order.view',
            'order.add_item','bill.print','customer.respond',
            'kitchen.notify','chat.send','note.write']
  },
  head_waiter: {
    label: '⭐ Baş Qarson kimi',
    perms: ['table.view','table.open','table.close','table.transfer',
            'order.create','order.view','order.add_item','order.cancel_item',
            'order.discount','bill.print','bill.credit',
            'customer.respond','kitchen.notify','chat.send',
            'note.write','waiter.view']
  },
  cashier: {
    label: '💰 Kassir kimi',
    perms: ['table.view','table.open','table.close','table.transfer',
            'order.create','order.view','order.add_item','order.cancel_item',
            'order.discount','bill.print','bill.credit',
            'bill.payment_cash','bill.payment_pos','bill.payment_credit',
            'report.daily','customer.respond','kitchen.notify',
            'chat.send','note.write','waiter.view']
  },
  manager: {
    label: '👔 Müdir kimi',
    perms: ['table.view','table.open','table.close','table.transfer',
            'order.create','order.view','order.add_item','order.cancel_item',
            'order.cancel_all','order.discount','order.refund',
            'bill.print','bill.credit','bill.payment_cash',
            'bill.payment_pos','bill.payment_credit',
            'report.daily','report.weekly','customer.respond',
            'kitchen.notify','chat.send','note.write',
            'waiter.view','waiter.manage','menu.view','staff.view']
  }
};

/* ── Sürətli seçim tətbiq et ── */
function applyPermissionPreset(presetKey) {
  const preset = PERMISSION_PRESETS[presetKey];
  if (!preset) return;
  document.querySelectorAll('input[name="staff_perm"]').forEach(cb => {
    cb.checked = preset.perms.includes(cb.value);
  });
}
