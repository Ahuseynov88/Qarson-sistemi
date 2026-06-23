/* ═══════════════════════════════════════════
   İCAZƏ SİSTEMİ
   Bu fayl: rol əsaslı icazə yoxlaması.
   Hər rol üçün sabit icazə dəsti — fərdi tənzimləmə yoxdur.
   hasPermission(action) — true/false qaytarır.
   requirePermission(action) — icazə yoxdursa toast göstərir.
═══════════════════════════════════════════ */

const ROLE_PERMISSIONS = {

  /* ── Adi Qarson ── */
  waiter: [
    'table.view',          // Masaları görmək
    'table.open',          // Masa açmaq (müştəri oturursa)
    'order.create',        // Sifariş yaratmaq
    'order.view',          // Sifarişi görmək
    'order.add_item',      // Sifarişə mal əlavə etmək
    'bill.print',          // Hesab çap etmək
    'customer.respond',    // Müştəri çağırışına cavab vermək
    'kitchen.notify',      // Mətbəxə bildiriş göndərmək
    'chat.send',           // Müştəri ilə yazışmaq
    'note.write',          // Masa qeydi yazmaq
  ],

  /* ── Baş Qarson ── */
  head_waiter: [
    'table.view',
    'table.open',
    'table.close',         // + Masanı bağlamaq
    'table.transfer',      // + Masadan-masaya köçürmə
    'order.create',
    'order.view',
    'order.add_item',
    'order.cancel_item',   // + Sifariş maddəsini ləğv etmək
    'order.discount',      // + Endirim vermək
    'bill.print',
    'bill.credit',         // + Nisyəyə yazmaq
    'customer.respond',
    'kitchen.notify',
    'chat.send',
    'note.write',
    'waiter.view',         // + Digər qarsonların masalarını görmək
  ],

  /* ── Kassir ── */
  cashier: [
    'table.view',
    'table.open',
    'table.close',
    'table.transfer',
    'order.create',
    'order.view',
    'order.add_item',
    'order.cancel_item',
    'order.discount',
    'bill.print',
    'bill.credit',
    'bill.payment_cash',   // + Nağd ödəniş qəbul etmək
    'bill.payment_pos',    // + POS ödəniş qəbul etmək
    'bill.payment_credit', // + Nisyə ödəniş qəbul etmək
    'report.daily',        // + Gün sonu hesabat
    'customer.respond',
    'kitchen.notify',
    'chat.send',
    'note.write',
    'waiter.view',
  ],

  /* ── Müdir ── */
  manager: [
    'table.view',
    'table.open',
    'table.close',
    'table.transfer',
    'order.create',
    'order.view',
    'order.add_item',
    'order.cancel_item',
    'order.cancel_all',    // + Bütün sifarişi ləğv etmək
    'order.discount',
    'order.refund',        // + Geri qaytarma
    'bill.print',
    'bill.credit',
    'bill.payment_cash',
    'bill.payment_pos',
    'bill.payment_credit',
    'report.daily',
    'report.weekly',       // + Həftəlik hesabat
    'customer.respond',
    'kitchen.notify',
    'chat.send',
    'note.write',
    'waiter.view',
    'waiter.manage',       // + Qarson statusunu dəyişmək
    'menu.view',           // + Menyunu görmək (amma dəyişdirə bilməz)
  ],

  /* ── Admin — hər şeyə tam giriş ── */
  admin: ['*']
};

/* ── Cari istifadəçinin rolunu müəyyən et ── */
function getCurrentWaiterRole() {
  if (!state.user) return null;
  if (state.user.role === 'admin') return 'admin';
  // Qarson üçün waiterRole-a bax, yoxdursa default 'waiter'
  return state.user.waiterRole || 'waiter';
}

/* ── İcazə yoxlaması ── */
function hasPermission(action) {
  const user = state.user;
  if (!user) return false;

  // Admin — hər şeyə icazəli
  if (user.role === 'admin') return true;

  // İşçi — fərdi icazə massivindən yoxla
  if (user.role === 'staff') {
    return staffHasPermission(user, action);
  }

  // Qarson — rol əsaslı sabit icazələr
  const role = getCurrentWaiterRole();
  const perms = ROLE_PERMISSIONS[role] || [];
  if (perms.includes('*')) return true;
  return perms.includes(action);
}

/* ── İcazə tələb et — yoxdursa toast göstər, false qaytarır ── */
function requirePermission(action) {
  if (hasPermission(action)) return true;
  const roleNames = {
    waiter: 'Adi Qarson', head_waiter: 'Baş Qarson',
    cashier: 'Kassir', manager: 'Müdir'
  };
  const role = getCurrentWaiterRole();
  showToast(`🚫 Bu əməliyyat üçün icazəniz yoxdur (${roleNames[role]||role})`);
  return false;
}

/* ── Rol adını göstər ── */
function getRoleDisplayName(waiterRole) {
  const names = {
    waiter:      '🤵 Adi Qarson',
    head_waiter: '⭐ Baş Qarson',
    cashier:     '💰 Kassir',
    manager:     '👔 Müdir'
  };
  return names[waiterRole] || '🤵 Adi Qarson';
}
