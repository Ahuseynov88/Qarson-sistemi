/* ═══════════════════════════════════════════
   İCAZƏ SİSTEMİ (RBAC)
   Rol-əsaslı və fərdi checkbox-əsaslı icazə idarəetməsi.
═══════════════════════════════════════════ */
import { state } from './state.js';
import { showToast } from './utils.js';

export const ALL_PERMISSIONS = [
  {
    group: 'Masa əməliyyatları',
    icon: '<svg class="icon"><use href="#i-chair"></use></svg>',
    items: [
      { key: 'table.view',     label: 'Masaları görmək' },
      { key: 'table.open',     label: 'Masa açmaq' },
      { key: 'table.close',    label: 'Masanı bağlamaq' },
      { key: 'table.transfer', label: 'Masadan-masaya köçürmə' },
      { key: 'waiter.view',    label: 'Digər işçilərin masalarını görmək' },
    ]
  },
  {
    group: 'Sifariş',
    icon: '<svg class="icon"><use href="#i-food"></use></svg>',
    items: [
      { key: 'order.create',      label: 'Sifariş yaratmaq' },
      { key: 'order.view',        label: 'Sifarişi görmək' },
      { key: 'order.add_item',    label: 'Sifarişə mal əlavə etmək' },
      { key: 'order.cancel_item', label: 'Sifarişdən mal silmək' },
      { key: 'order.cancel_all',  label: 'Bütün sifarişi ləğv etmək' },
      { key: 'order.discount',    label: 'Endirim vermək' },
      { key: 'order.refund',      label: 'Geri qaytarma' },
    ]
  },
  {
    group: 'Hesab və Ödəniş',
    icon: '<svg class="icon"><use href="#i-money"></use></svg>',
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
    icon: '<svg class="icon"><use href="#i-users"></use></svg>',
    items: [
      { key: 'customer.respond', label: 'Müştəri çağırışına cavab vermək' },
      { key: 'kitchen.notify',   label: 'Mətbəxə bildiriş göndərmək' },
      { key: 'chat.send',        label: 'Müştəri ilə yazışmaq' },
      { key: 'note.write',       label: 'Masa qeydi yazmaq' },
    ]
  },
  {
    group: 'Hesabat',
    icon: '<svg class="icon"><use href="#i-chart"></use></svg>',
    items: [
      { key: 'report.daily',  label: 'Gün sonu hesabat' },
      { key: 'report.weekly', label: 'Həftəlik hesabat' },
    ]
  },
  {
    group: 'Menyu',
    icon: '<svg class="icon"><use href="#i-utensils"></use></svg>',
    items: [
      { key: 'menu.view',   label: 'Menyunu görmək' },
      { key: 'menu.edit',   label: 'Menyu dəyişdirmək' },
    ]
  },
  {
    group: 'İşçi idarəsi',
    icon: '<svg class="icon"><use href="#i-staff"></use></svg>',
    items: [
      { key: 'waiter.manage', label: 'Qarson statusunu dəyişmək' },
      { key: 'staff.view',    label: 'İşçiləri görmək' },
    ]
  }
];

export const PERMISSION_PRESETS = {
  waiter: {
    label: '<svg class="icon"><use href="#i-bowtie"></use></svg> Adi Qarson',
    perms: ['table.view','table.open','order.create','order.view','order.add_item','bill.print','customer.respond','kitchen.notify','chat.send','note.write']
  },
  head_waiter: {
    label: '<svg class="icon"><use href="#i-star"></use></svg> Baş Qarson',
    perms: ['table.view','table.open','table.transfer','order.create','order.view','order.add_item','bill.print','customer.respond','kitchen.notify','chat.send','note.write','waiter.view']
  },
  cashier: {
    label: '<svg class="icon"><use href="#i-money"></use></svg> Kassir',
    perms: ['table.view','table.close','table.transfer','order.view','bill.print','bill.credit','bill.payment_cash','bill.payment_pos','bill.payment_credit','customer.respond','kitchen.notify','chat.send','note.write','waiter.view']
  },
  manager: {
    label: '<svg class="icon"><use href="#i-staff"></use></svg> Müdir',
    perms: ['table.view','table.open','table.close','table.transfer','order.create','order.view','order.add_item','order.cancel_item','order.cancel_all','order.discount','order.refund','bill.print','bill.credit','bill.payment_cash','bill.payment_pos','bill.payment_credit','report.daily','report.weekly','customer.respond','kitchen.notify','chat.send','note.write','waiter.view','waiter.manage','menu.view','staff.view']
  }
};

export function staffHasPermission(staffUser, action) {
  if (!staffUser) return false;
  const perms = staffUser.permissions || [];
  return perms.includes(action);
}

export function hasPermission(action) {
  if (!state.user) return false;
  // Admin hər şeyə icazəlidir
  if (state.user.role === 'admin') return true;
  // İşçi — fərdi icazə massivindən yoxla
  return staffHasPermission(state.user, action);
}

export function requirePermission(action) {
  if (!hasPermission(action)) {
    showToast('<svg class="icon"><use href="#i-error"></use></svg> Bu əməliyyat üçün icazəniz yoxdur');
    return false;
  }
  return true;
}
