/* ═══════════════════════════════════════════
   GECƏ/GÜNDÜZ REJİM KEÇİDİ
   Bu fayl: istifadəçinin ağ (gündüz) və tünd (gecə) rejim
   arasında keçməsi. Seçim brauzerin yaddaşında saxlanılır,
   hər istifadəçi (admin/qarson/mətbəx/müştəri) öz seçimini
   özü saxlayır, bir-birinə təsir etmir.
═══════════════════════════════════════════ */
function applyTheme(isDark) {
  document.body.classList.toggle('dark-mode', isDark);
  const icon = isDark ? '☀️' : '🌙';
  ['themeToggleBtn', 'themeToggleBtnWaiter', 'themeToggleBtnKitchen', 'themeToggleBtnCustomer'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.textContent = icon;
  });
}

function toggleTheme() {
  const isDark = !document.body.classList.contains('dark-mode');
  applyTheme(isDark);
  try { localStorage.setItem('themeMode', isDark ? 'dark' : 'light'); } catch(e) {}
}

function loadSavedTheme() {
  let saved = null;
  try { saved = localStorage.getItem('themeMode'); } catch(e) {}
  applyTheme(saved === 'dark');
}
