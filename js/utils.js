/* ═══════════════════════════════════════════
   UTILS
   Bu fayl: kiçik, hər yerdə istifadə olunan köməkçi funksiyalar.
   esc() demək olar hər render funksiyasında işlədilir, ona görə
   bu fayl render edən bütün fayllardan ƏVVƏL yüklənməlidir.
═══════════════════════════════════════════ */
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function toArr(obj) {
  if (!obj) return [];
  return Object.keys(obj).map(k=>({id:k,...obj[k]}));
}

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(()=>el.classList.remove('show'),3000);
}

function showCustomerToast(msg) {
  const el = document.getElementById('customerToast');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => el.style.display='none', 3000);
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
