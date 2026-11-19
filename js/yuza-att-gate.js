/* ═══════════════════════════════════════════
   YUZA POS — POS GİRİŞİ ÜÇÜN DAVAMİYYƏT YOXLAMASI
   Ayarlarda "Gəlişini qeyd etməyən işçi POS-a girə bilməsin" açıqdırsa:
   • işçi PIN ilə POS-a girməzdən əvvəl telefonu ilə QR-ı oxudub "İşə gəldim" etməlidir;
   • işçi "İşdən çıxdım" və ya "Müvəqqəti çıxış" edən kimi POS-dakı girişi avtomatik bağlanır.
   Rəhbər (admin) və "azad" seçilmiş işçilər yoxlanmır.
   Baza oxunmasa (internet problemi) giriş BLOKLANMIR — restoranın işi dayanmasın.
═══════════════════════════════════════════ */
import { state } from './state.js';
import { A, withDefaults, phaseOf, fmtDT } from './yuza-att-core.js';

function notice(title, text) {
  document.getElementById('yzAttGate')?.remove();
  const d = document.createElement('div');
  d.id = 'yzAttGate';
  d.setAttribute('role', 'alertdialog');
  d.innerHTML = `<div style="position:fixed;inset:0;z-index:99998;background:rgba(6,8,11,.82);display:flex;align-items:center;justify-content:center;padding:20px;font-family:Inter,system-ui,sans-serif">
    <div style="max-width:380px;width:100%;background:#14110b;border:1px solid rgba(232,176,75,.45);border-radius:20px;padding:24px 20px;color:#f4eee2;text-align:center">
      <div style="font-size:40px;line-height:1;margin-bottom:10px">🕘</div>
      <h2 style="margin:0 0 8px;font-size:19px">${title}</h2>
      <p style="margin:0 0 18px;color:#c9bfae;font-size:14.5px;line-height:1.55">${text}</p>
      <button type="button" style="width:100%;padding:13px;border:0;border-radius:12px;background:linear-gradient(180deg,#f6cf7c,#e1a43e);color:#1a1205;font-weight:800;font-size:15px;cursor:pointer">Başa düşdüm</button>
    </div></div>`;
  document.body.appendChild(d);
  const close = () => d.remove();
  d.querySelector('button').onclick = close;
  setTimeout(close, 15000);
}

/* ── Giriş yoxlaması: true → girə bilər · false → əvvəlcə gəlişini qeyd etməlidir ── */
export async function attGate(staff) {
  try {
    const S = withDefaults((await A('settings').once('value')).val());
    if (!S.gateLogin || S.gateExempt?.[staff.id]) return true;
    const st = (await A('status/' + staff.id).once('value')).val();
    const ph = phaseOf(st, S);
    if (ph === 'in') { watch(staff); return true; }
    if (ph === 'break') {
      notice('Siz müvəqqəti çıxışdasınız', `Müvəqqəti çıxışınız ${fmtDT(st.since)}-dən qeyd olunub. Sistemə girmək üçün əvvəlcə davamiyyət ekranındakı QR-ı telefonunuzla oxudub <b>“Qayıtdım”</b> basın.`);
    } else {
      notice('Əvvəlcə işə gəlişinizi qeyd edin', 'Sistemə girmək üçün davamiyyət ekranındakı QR-ı telefonunuzla oxudub <b>“İşə gəldim”</b> basın. Telefonunuz aktiv deyilsə, Rəhbərə və ya növbə müdirinə müraciət edin.');
    }
    return false;
  } catch (e) {
    console.warn('[att] giriş yoxlaması alınmadı, giriş bloklanmadı', e);
    return true;
  }
}

/* ── Qoruma: işçi heç vaxt Rəhbər panelində qalmamalıdır (anbar/kassa icazəsi olan öz ekranına keçir) ── */
setInterval(() => {
  const u = state.user;
  if (u?.role !== 'staff' || !document.getElementById('adminScreen')?.classList.contains('active')) return;
  if (window.__yzAccess?.hasPanel(u)) return;   // Rəhbər panelində icazəli bölməsi var
  try { window.logout?.(); } catch (e) { /* */ }
  notice('Giriş icazəsi yoxdur', 'Bu bölmə yalnız Rəhbər üçündür.');
}, 1000);

/* ── İşçi işdən / müvəqqəti çıxan kimi POS girişini bağlayır ── */
let stopWatch = null;
function watch(staff) {
  stopWatch?.();
  const sid = staff.id;
  const ref = A('status/' + sid), sref = A('settings');
  let S = null, st = null, gotSt = false, gotS = false, seen = false;
  // Giriş hələ tamamlanmayıbsa gözləyir; işçi özü çıxıbsa və ya başqası giribsə, izləmə dayanır
  const sameUser = () => {
    if (state.user?.id === sid && state.user?.role === 'staff') { seen = true; return true; }
    if (!seen && !state.user) return null;
    stopWatch?.(); return false;
  };
  const check = () => {
    if (!gotSt || !gotS) return;              // ilk dəyərlər gəlməmiş yoxlama yoxdur
    if (sameUser() !== true) return;
    const s = withDefaults(S);
    if (!s.gateLogin || s.gateExempt?.[sid]) return;
    const ph = phaseOf(st, s);
    if (ph === 'in') return;
    stopWatch?.();
    try { window.logout?.(); } catch (e) { /* */ }
    notice(ph === 'break' ? 'Müvəqqəti çıxış qeyd edildi' : 'İşdən çıxışınız qeyd edildi',
      ph === 'break' ? 'Sistemdən avtomatik çıxdınız. Qayıdanda QR-ı oxudub <b>“Qayıtdım”</b> basın, sonra PIN ilə yenidən girin.' : 'Sistemdən avtomatik çıxdınız. Sağ olun!');
  };
  const h1 = ref.on('value', (snap) => { st = snap.val(); gotSt = true; check(); }, () => {});
  const h2 = sref.on('value', (snap) => { S = snap.val() || {}; gotS = true; check(); }, () => {});
  const timer = setInterval(check, 5000);
  stopWatch = () => { ref.off('value', h1); sref.off('value', h2); clearInterval(timer); stopWatch = null; };
}
