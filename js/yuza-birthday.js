/* ═══════════════════════════════════════════
   YUZA POS — AD GÜNÜ HƏDİYYƏSİ (Mərhələ 5)
   Ayar: Ayarlar → Satış və hesab → "Ad günü hədiyyəsi"  (settings/bdayGift = { on, pct, days, note })
   • Loyallıq müştərisi masaya bağlıdırsa (QR ilə) və ad günü ±N gün aralığındadırsa,
     ödəniş pəncərəsində xəbərdarlıq çıxır: "Müştərinin ad günüdür — hədiyyə: X% endirim".
   • "Hədiyyəni tətbiq et" bütün hesaba X% endirim verir. Hədiyyə ildə BİR dəfə verilir:
     loyaltyCustomers/{id}/bdayGift/{il} = { at, by, byName, tableId, pct } — eyni anda iki cihaz verə bilməz.
   • Müştəri QR ekranında "Ad günü hədiyyələri" yalnız ayar açıq olanda görünür.
═══════════════════════════════════════════ */
import { R, db } from './firebase-service.js';
import { state } from './state.js';
import { esc, showToast, addLog, computeOrderTotals, money2 } from './utils.js';

const $ = (id) => document.getElementById(id);
const I = (id) => `<svg class="icon"><use href="#i-${id}"></use></svg>`;
const DEF = { on: false, pct: 10, days: 3, note: '' };
let cfg = { ...DEF };
const DAY = 86400000;

export function withDef(v) {
  const o = { ...DEF, ...(v || {}) };
  o.pct = Math.min(100, Math.max(0, Number(o.pct) || 0));
  o.days = Math.min(30, Math.max(0, Math.floor(Number(o.days) || 0)));
  o.on = !!o.on && o.pct > 0;
  return o;
}

/* Ad gününün bu ilki (və ya ilin əvvəli/sonu yaxınlığında qonşu ilin) tarixi ilə bugünün fərqi.
   Qaytarır: { diff (gün; 0 = bu gün, mənfi = keçib), year (hədiyyənin ili) } və ya null */
export function bdayInfo(birthDate, now = Date.now()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(birthDate || ''));
  if (!m) return null;
  const mon = +m[2] - 1, day = +m[3];
  const t = new Date(now); const today = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  let best = null;
  for (const y of [t.getFullYear() - 1, t.getFullYear(), t.getFullYear() + 1]) {
    let d = new Date(y, mon, day);
    if (d.getMonth() !== mon) d = new Date(y, mon + 1, 0);   // 29 fevral → uzun olmayan ildə 28 fevral
    const diff = Math.round((d.getTime() - today) / DAY);
    if (!best || Math.abs(diff) < Math.abs(best.diff)) best = { diff, year: y, date: d };
  }
  return best;
}
const fmtD = (d) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
const pad2 = (n) => String(n).padStart(2, '0');
const fmtDT = (ts) => { const d = new Date(ts); return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

/* ── Ödəniş pəncərəsində xəbərdarlıq ── */
let shownFor = null;
async function onPaymentOpen() {
  const modal = $('paymentModal'); if (!modal) return;
  modal.querySelector('#yzBday')?.remove();
  if (!cfg.on || !state.user) return;
  const tid = window.staffApp?.payment?.payment?.tableId || state.noteTableId;
  const t = (state.tables || []).find(x => x.id === tid);
  const cid = t?.loyaltyCustomerId; if (!cid) return;
  const order = state.tableOrders?.[tid]; if (!order?.items) return;
  shownFor = tid;
  let c = null;
  try { c = (await R.loyaltyCustomers.child(cid).once('value')).val(); } catch (e) { return; }
  if (!c || shownFor !== tid || !modal.classList.contains('open')) return;
  const b = bdayInfo(c.birthDate);
  if (!b || Math.abs(b.diff) > cfg.days) return;
  const used = c.bdayGift?.[b.year];
  const when = b.diff === 0 ? 'bu gün' : b.diff > 0 ? `${b.diff} gün sonra (${fmtD(b.date)})` : `${-b.diff} gün əvvəl (${fmtD(b.date)})`;
  const box = document.createElement('div');
  box.id = 'yzBday';
  box.setAttribute('role', 'status');
  box.style.cssText = 'margin:0 0 14px;padding:12px 14px;border-radius:12px;border:1px solid var(--gold,#d4a548);background:rgba(212,165,72,.12);font-size:13.5px;line-height:1.5;';
  box.innerHTML = `<div style="display:flex;gap:10px;align-items:flex-start;">
      <span style="color:var(--gold,#d4a548);font-size:20px;line-height:1;">${I('gift')}</span>
      <div style="flex:1;"><b>${esc(c.firstName || 'Müştəri')}</b> — ad günü ${when}.
        ${used ? `<br><span style="color:var(--text2);">Bu ilin hədiyyəsi artıq verilib: ${fmtDT(used.at)} · ${esc(used.byName || '')} (${used.pct}%)</span>`
          : `<br>Hədiyyə: <b>${cfg.pct}% endirim</b>${cfg.note ? ' + ' + esc(cfg.note) : ''}.`}</div></div>
    ${used ? '' : `<button type="button" class="btn btn-green" data-bday-apply style="width:100%;margin-top:10px;padding:10px;">${I('gift')} Hədiyyəni tətbiq et</button>`}`;
  const host = modal.querySelector('.modal') || modal;
  const h2 = host.querySelector('h2');
  if (h2) h2.after(box); else host.prepend(box);
  box.querySelector('[data-bday-apply]')?.addEventListener('click', (e) => apply(e.currentTarget, tid, cid, c, b.year));
}

async function apply(btn, tid, cid, c, year) {
  btn.disabled = true;
  const by = state.user?.id || '', byName = state.user?.name || '';
  const pct = cfg.pct;
  try {
    // 1) Hədiyyəni "tut": ildə bir dəfə, iki cihaz eyni anda verə bilməz
    const claim = await R.loyaltyCustomers.child(cid).child('bdayGift').child(String(year))
      .transaction(cur => (cur ? undefined : { at: firebase.database.ServerValue.TIMESTAMP, by, byName, tableId: tid, pct }));
    if (!claim.committed) { showToast(`${I('warning')} Bu ilin ad günü hədiyyəsi artıq verilib`); onPaymentOpen(); return; }
    // 2) Bütün hesaba endirim (hədiyyə olan və artıq daha böyük endirimi olan mallara toxunulmur)
    let before = 0, after = 0;
    const r = await R.tableOrders.child(tid).transaction(cur => {
      if (!cur || !cur.items) return cur;
      const items = { ...cur.items };
      before = Number(cur.total) || 0;
      Object.keys(items).forEach(k => {
        const it = items[k];
        if (it && !it.compliment && !((Number(it.discountPercent) || 0) >= pct)) items[k] = { ...it, discountPercent: pct };
      });
      const tot = computeOrderTotals(items);
      after = tot.total;
      return { ...cur, items, total: tot.total, serviceChargeAmount: tot.serviceChargeAmount, serviceChargePercent: tot.serviceChargePercent,
        remainingAmount: money2(Math.max(0, tot.total - (cur.paidAmount || 0))), bdayGift: { cid, year, pct } };
    });
    if (!r.committed) {   // hesab tapılmadı — hədiyyə geri qaytarılır
      await R.loyaltyCustomers.child(cid).child('bdayGift').child(String(year)).remove().catch(() => {});
      showToast(`${I('error')} Hesab tapılmadı`); return;
    }
    await R.loyaltyCustomers.child(cid).child('bdayGift').child(String(year)).update({ amount: money2(before - after) }).catch(() => {});
    const t = (state.tables || []).find(x => x.id === tid);
    addLog('discount', `${byName} "${t?.name || 'Masa'}" masasında ${c.firstName || 'müştəri'} üçün ad günü hədiyyəsi verdi: ${pct}% endirim (${money2(before - after).toFixed(2)} ₼)`,
      { tableId: tid, loyaltyCustomerId: cid, bday: true, pct });
    showToast(`${I('check')} Ad günü hədiyyəsi tətbiq olundu: ${pct}% endirim`);
    // Ödəniş pəncərəsi yeni məbləğlə yenidən açılır
    const P = window.staffApp?.payment;
    if (P) { P.close(); setTimeout(() => P.open(tid), 150); }
  } catch (e) {
    btn.disabled = false;
    showToast(`${I('error')} Hədiyyə tətbiq olunmadı: ${esc(e.message || e)}`);
  }
}

/* ── Ayarlar → Satış və hesab ── */
export function renderSettings(box) {
  if (!box) return;
  const c = cfg;
  box.innerHTML = `<div class="table-card yzs-card"><h3 style="margin-bottom:8px;">${I('gift')} Ad günü hədiyyəsi</h3>
    <p style="font-size:13px;color:var(--text2);margin-bottom:10px;">Loyallıq üzvü olan müştəri (QR ilə masaya qoşulub) ad günü ərəfəsində gələndə ödəniş pəncərəsində xəbərdarlıq çıxır və işçi bir düymə ilə endirimi tətbiq edir. Hədiyyə ildə bir dəfə verilir, kim və nə vaxt verdiyi jurnala yazılır.</p>
    <label class="yzs-switch"><span><b>Ad günü hədiyyəsi verilsin</b><small>Söndürüləndə müştəri ekranında da "Ad günü hədiyyələri" yazısı görünmür.</small></span>
      <input type="checkbox" class="yz-toggle" role="switch" id="yzBdOn" ${c.on ? 'checked' : ''}></label>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;">
      <label class="form-group" style="margin:0;"><span style="font-size:12px;color:var(--text2);">Endirim (%)</span><input type="number" id="yzBdPct" min="1" max="100" step="1" value="${c.pct}"></label>
      <label class="form-group" style="margin:0;"><span style="font-size:12px;color:var(--text2);">Ad günündən ± neçə gün</span><input type="number" id="yzBdDays" min="0" max="30" step="1" value="${c.days}"></label>
    </div>
    <label class="form-group" style="margin:10px 0 0;display:block;"><span style="font-size:12px;color:var(--text2);">Əlavə hədiyyə (istəyə görə, məs. pulsuz desert)</span><input type="text" id="yzBdNote" maxlength="120" value="${esc(c.note || '')}"></label>
    <button type="button" class="btn btn-green" id="yzBdSave" style="margin-top:12px;">${I('check')} Yadda saxla</button></div>`;
  box.querySelector('#yzBdSave').onclick = async () => {
    const pct = Number(box.querySelector('#yzBdPct').value), days = Number(box.querySelector('#yzBdDays').value);
    if (!(pct >= 1 && pct <= 100)) { showToast(`${I('error')} Endirim 1–100% olmalıdır`); return; }
    if (!(days >= 0 && days <= 30)) { showToast(`${I('error')} Gün sayı 0–30 olmalıdır`); return; }
    const v = { on: box.querySelector('#yzBdOn').checked, pct: Math.round(pct), days: Math.floor(days), note: box.querySelector('#yzBdNote').value.trim().slice(0, 120) };
    try { await db.ref('settings/bdayGift').set(v); addLog('settings', `Ad günü hədiyyəsi: ${v.on ? `açıq, ${v.pct}%, ±${v.days} gün` : 'söndürüldü'}`, {}); showToast(`${I('check')} Yadda saxlanıldı`); }
    catch (e) { showToast(`${I('error')} Yadda saxlanılmadı: ${esc(e.message || e)}`); }
  };
}

/* ── Başlanğıc ── */
function init() {
  db.ref('settings/bdayGift').on('value', (s) => {
    cfg = withDef(s.val());
    const li = $('custBdayPerk'); if (li) li.hidden = !cfg.on;
  }, () => { const li = $('custBdayPerk'); if (li) li.hidden = true; });
  const modal = $('paymentModal');
  if (modal) new MutationObserver(() => { if (modal.classList.contains('open')) onPaymentOpen(); else { shownFor = null; modal.querySelector('#yzBday')?.remove(); } })
    .observe(modal, { attributes: true, attributeFilter: ['class'] });
}
window.__yzBday = { renderSettings, bdayInfo, withDef, _cfg: () => cfg };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
