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
      { key: 'order.discount',       label: 'Endirim vermək (tək mal)' },
      { key: 'order.gift',           label: 'İkram etmək (tək mal)' },
      { key: 'order.batch_ops',      label: 'Toplu əməliyyat (çoxlu mal seçimi)' },
      { key: 'order.refund',         label: 'Geri qaytarma' },
    ]
  },
  {
    group: 'Hesab və Ödəniş',
    icon: '<svg class="icon"><use href="#i-money"></use></svg>',
    items: [
      { key: 'bill.print',          label: 'Hesab çap etmək' },
      { key: 'bill.payment_cash',   label: 'Nağd ödəniş qəbul etmək' },
      { key: 'bill.payment_pos',    label: 'POS ödəniş qəbul etmək' },
      { key: 'bill.credit',         label: 'Nisyəyə yazmaq (tək mal)' },
      { key: 'bill.credit_batch',   label: 'Toplu nisyəyə yazmaq' },
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
  },
  {
    group: 'Məhsul kataloqu',
    icon: '<svg class="icon"><use href="#i-box"></use></svg>',
    items: [
      { key: 'catalog.view',     label: 'Məhsul kataloqunu görmək' },
      { key: 'catalog.edit',     label: 'Məhsul yaratmaq və dəyişmək' },
      { key: 'catalog.quickadd', label: 'Alışda yeni məhsul (qısa kart) yaratmaq' },
      { key: 'catalog.price',    label: 'Satış qiymətini dəyişmək' },
      { key: 'catalog.cost',     label: 'Maya dəyərini və alış qiymətlərini görmək' },
      { key: 'warehouse.manage', label: 'Anbarları idarə etmək' },
    ]
  },
  {
    group: 'Alış və təchizatçılar',
    icon: '<svg class="icon"><use href="#i-cash"></use></svg>',
    items: [
      { key: 'purchase.view',            label: 'Alış qaimələrini görmək' },
      { key: 'purchase.create',          label: 'Qaimə yazmaq (təsdiqə göndərmək)' },
      { key: 'purchase.approve',         label: 'Qaiməni təsdiqləmək (anbara və borca yazır)' },
      { key: 'purchase.storno',          label: 'Təsdiqlənmiş qaiməni storno etmək' },
      { key: 'supplier.manage',          label: 'Təchizatçıları idarə etmək' },
      { key: 'supplier.payment.create',  label: 'Təchizatçıya ödəniş yazmaq' },
      { key: 'supplier.payment.approve', label: 'Ödənişi təsdiqləmək' },
      { key: 'supplier.payment.storno',  label: 'Ödənişi storno etmək' },
    ]
  },
  {
    group: 'Anbar əməliyyatları',
    icon: '<svg class="icon"><use href="#i-clipboard"></use></svg>',
    items: [
      { key: 'stock.view',               label: 'Anbar qalıqlarını və sənədləri görmək' },
      { key: 'stock.writeoff.create',    label: 'Silinmə aktı yazmaq' },
      { key: 'stock.writeoff.approve',   label: 'Silinmə aktını təsdiqləmək' },
      { key: 'stock.transfer.create',    label: 'Anbarlararası transfer yazmaq' },
      { key: 'stock.transfer.approve',   label: 'Transferi təsdiqləmək' },
      { key: 'stock.count.create',       label: 'Sayım (inventarizasiya) aparmaq' },
      { key: 'stock.count.approve',      label: 'Sayım nəticəsini təsdiqləmək' },
      { key: 'stock.production.create',  label: 'Hazırlama aktı yazmaq (yarımfabrikat)' },
      { key: 'stock.production.approve', label: 'Hazırlama aktını təsdiqləmək' },
      { key: 'stock.storno',             label: 'Anbar sənədini storno etmək' },
      { key: 'stock.report',             label: 'Anbar hesabatları (hərəkətlər, sərf analizi)' },
    ]
  },
  {
    group: 'Kassa və pul hesabları',
    icon: '<svg class="icon"><use href="#i-money"></use></svg>',
    items: [
      { key: 'cash.view',          label: 'Kassa qalıqlarını və hərəkətləri görmək' },
      { key: 'cash.create',        label: 'Mədaxil / məxaric / transfer yazmaq (təsdiqə)' },
      { key: 'cash.approve',       label: 'Kassa sənədini təsdiqləmək və kassa parametrləri' },
      { key: 'cash.storno',        label: 'Kassa sənədini storno etmək' },
      { key: 'cash.close.create',  label: 'Gün sonu bağlanışı etmək (pulu saymaq)' },
      { key: 'cash.close.approve', label: 'Gün sonu bağlanışını təsdiqləmək' },
    ]
  }
];

export const PERMISSION_PRESETS = {
  accountant: {
    label: '<svg class="icon"><use href="#i-cash"></use></svg> Mühasib',
    perms: ['catalog.view','catalog.quickadd','catalog.price','catalog.cost','purchase.view','purchase.create','purchase.approve','purchase.storno','supplier.manage','supplier.payment.create','supplier.payment.approve','supplier.payment.storno','stock.view','stock.writeoff.approve','stock.transfer.approve','stock.count.approve','stock.production.approve','stock.storno','stock.report','cash.view','cash.create','cash.approve','cash.storno','cash.close.create','cash.close.approve','report.daily','report.weekly']
  },
  storekeeper: {
    label: '<svg class="icon"><use href="#i-box"></use></svg> Anbardar',
    perms: ['catalog.view','catalog.quickadd','purchase.view','purchase.create','stock.view','stock.writeoff.create','stock.transfer.create','stock.count.create','stock.production.create']
  },
  waiter: {
    label: '<svg class="icon"><use href="#i-bowtie"></use></svg> Adi Qarson',
    perms: ['table.view','table.open','order.create','order.view','order.add_item','bill.print','customer.respond','kitchen.notify','chat.send','note.write']
  },
  head_waiter: {
    label: '<svg class="icon"><use href="#i-star"></use></svg> Baş Qarson',
    perms: ['table.view','table.open','table.close','table.transfer','order.create','order.view','order.add_item','order.cancel_item','order.discount','order.gift','bill.print','bill.credit','customer.respond','kitchen.notify','chat.send','note.write','waiter.view']
  },
  cashier: {
    label: '<svg class="icon"><use href="#i-money"></use></svg> Kassir',
        perms: ['table.view','table.open','table.close','table.transfer','order.create','order.view','order.add_item','order.cancel_item','order.discount','order.gift','order.batch_ops','bill.print','bill.credit','bill.credit_batch','bill.payment_cash','bill.payment_pos','bill.payment_credit','report.daily','customer.respond','kitchen.notify','chat.send','note.write','waiter.view','cash.view','cash.create','cash.close.create']
  },
  manager: {
    label: '<svg class="icon"><use href="#i-staff"></use></svg> Müdir',
        perms: ['table.view','table.open','table.close','table.transfer','order.create','order.view','order.add_item','order.cancel_item','order.cancel_all','order.discount','order.gift','order.batch_ops','order.refund','bill.print','bill.credit','bill.credit_batch','bill.payment_cash','bill.payment_pos','bill.payment_credit','report.daily','report.weekly','customer.respond','kitchen.notify','chat.send','note.write','waiter.view','waiter.manage','menu.view','staff.view']
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
