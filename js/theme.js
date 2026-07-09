/* ═══════════════════════════════════════════
   THEME & SCREEN UTİLS
   Ekran keçidi (showScreen) və işıq/qaranlıq rejim.
═══════════════════════════════════════════ */

export function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

export function applyTheme(isDark) {
  document.body.classList.toggle('dark-mode', isDark);
  const icon = isDark ? '<svg class="icon"><use href="#i-sun"></use></svg>' : '<svg class="icon"><use href="#i-moon"></use></svg>';
  ['themeToggleBtn', 'themeToggleBtnWaiter', 'themeToggleBtnKitchen', 'themeToggleBtnCustomer'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.textContent = icon;
  });
}

export function toggleTheme() {
  const isDark = !document.body.classList.contains('dark-mode');
  applyTheme(isDark);
  try { localStorage.setItem('themeMode', isDark ? 'dark' : 'light'); } catch(e) {}
}

export function loadSavedTheme() {
  let saved = null;
  try { saved = localStorage.getItem('themeMode'); } catch(e) {}
  applyTheme(saved === 'dark');
}

// Mövcud HTML-də onclick="toggleTheme()" bir neçə ekranda istifadə olunur
window.toggleTheme = toggleTheme;
