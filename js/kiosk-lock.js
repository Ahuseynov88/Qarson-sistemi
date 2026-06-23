/* ═══════════════════════════════════════════
   KIOSK LOCK
   Bu fayl: qarson ekranını "kiosk" rejimində saxlayan bütün məntiq —
   tam ekran, geri düyməsini bloklamaq, arxa plana keçəndə statusu
   yeniləmək, çıxış üçün PIN təsdiqi.
═══════════════════════════════════════════ */
function lockScreen() {
  if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(()=>{});
  history.pushState(null,'',location.href);
}

function unlockScreen() {
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(()=>{});
}

window.onpopstate = ()=>{
  if (state.user?.role==='staff') history.pushState(null,'',location.href);
};

window.addEventListener('pageshow', (e) => {
  if (!state.user || state.user.role !== 'staff') return;
  if (document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(()=>{});
  }
  R.staff.child(state.user.id).update({ status: 'online' });
});

// Qarson tab-ı gizlədəndə (telefonu kilidləyəndə, başqa tətbiqə keçəndə)
document.addEventListener('visibilitychange', () => {
  if (!state.user || state.user.role !== 'staff') return;

  if (document.hidden) {
    // Arxa plana getdi — Firebase-də qeyd et
    R.staff.child(state.user.id).update({
      status: 'away',
      lastSeen: Date.now()
    });
  } else {
    // Geri qayıtdı — yenidən aktiv et
    R.staff.child(state.user.id).update({
      status: 'online',
      lastSeen: Date.now()
    });
    // Tam ekrana qayıt
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(()=>{});
    }
  }
});

document.addEventListener('keydown', e=>{
  if (state.user?.role!=='staff') return;
  if (['F5','F12','Escape'].includes(e.key)||(e.ctrlKey&&['r','w','t'].includes(e.key))||(e.altKey&&e.key==='F4')) {
    e.preventDefault(); return false;
  }
});

document.addEventListener('contextmenu', e=>{
  if (state.user?.role==='staff') e.preventDefault();
});

window.addEventListener('beforeunload', e=>{
  if (state.user?.role==='staff') { e.preventDefault(); e.returnValue=''; }
});

function showExitModal() { document.getElementById('exitModal').classList.add('open'); }
function closeExitModal() { document.getElementById('exitModal').classList.remove('open'); document.getElementById('exitPin').value=''; }

function confirmExit() {
  const pin = document.getElementById('exitPin').value;
  if (String(pin) === String(ADMIN_PIN) || String(pin) === String(state.kitchenPin)) {
    closeExitModal();
    logout();
  } else {
    showToast('❌ PIN səhvdir!');
  }
}
