/* ═══════════════════════════════════════════
   YUZA POS — İÇKİNİN ŞÜŞƏ VƏ ML İLƏ SATIŞI (C16 · 22.11.2026)
   • Qalıq ml ilə saxlanılır (məhsulun vahidi: ml). Alış şüşə ilə (qablaşdırma: "Şüşə = 700 ml") — ml-ə çevrilir.
   • Menyuda bir ad ("Viski X"); basanda pəncərə: Şüşə · 50 ml · 100 ml · 150 ml · başqa miqdar.
   • Qalıq "3 şüşə + 250 ml" kimi göstərilir. Açılmış şüşə ml olaraq qalır və yalnız ml ilə satılır:
     şüşə satışı yalnız bağlı (tam) şüşə varsa mümkündür. Qayda: bağlı şüşə = qalıq ÷ şüşə həcmi (tam hissə),
     açıq şüşədə qalan = qalığın qalığı.
   • Satış qalıqdan ml silir, ləğv ml qaytarır (order-cart.js / billing.js).
   • Ayarlar: Kataloq → məhsul → "Şüşə və ml ilə satış…".
═══════════════════════════════════════════ */
import { db } from './firebase-service.js';
import { state } from './state.js';
import { modal, ok, fail, esc, numInput } from './yuza-inv-ui.js';
import { product, syncMenu, r2, num, can, packsOf } from './yuza-inv-core.js';
import { showToast } from './utils.js';

const money = (n) => r2(n).toFixed(2) + ' ₼';
const fmtMl = (n) => { const v = Math.round((Number(n) || 0) * 10) / 10; return String(v); };

/* Qalıq → "3 şüşə + 250 ml" */
export function split(stockMl, bottleMl) {
  const S = Math.max(0, Number(stockMl) || 0), B = Number(bottleMl) || 0;
  if (!(B > 0)) return { sealed: 0, open: S };
  const sealed = Math.floor((S + 1e-6) / B);
  return { sealed, open: Math.round((S - sealed * B) * 10) / 10 };
}
export function stockText(m) {
  const S = Number(m.stock) || 0;
  if (S <= 0) return 'Bitdi';
  const { sealed, open } = split(S, m.pour.bottleMl);
  return [sealed ? `${sealed} şüşə` : '', open > 0 ? `${fmtMl(open)} ml` : ''].filter(Boolean).join(' + ');
}
export const priceFor = (m, ml) => r2(ml / (m.pour.unitMl || 50) * (m.pour.unitPrice || 0));

/* Səbətdə artıq olan (bu malın) ml və şüşə */
function inCart(id) {
  const ls = Object.values(state._orderDraft || {}).filter(l => l.menuItemId === id && l.ml);
  return { ml: ls.reduce((s, l) => s + l.qty * l.ml, 0), bottles: ls.filter(l => l.bottle).reduce((s, l) => s + l.qty, 0) };
}

/* ═══ Sifariş ekranında variant seçimi ═══ */
export function pick(m, onPick) {
  const P = m.pour, S = Number(m.stock) || 0, c = inCart(m.id);
  const free = S - c.ml;                                   // səbətdəkindən sonra qalan ml
  const { sealed } = split(S, P.bottleMl);
  const bottleOk = P.bottle && sealed - c.bottles >= 1 && free >= P.bottleMl;
  const btn = (v, dis, sub) => `<button type="button" class="yz-pour-btn" data-v='${esc(JSON.stringify(v))}' ${dis ? 'disabled' : ''}>
      <b>${esc(v.label)}</b><span>${money(v.price)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</button>`;
  const presets = P.presets.length ? P.presets : [50, 100, 150];
  const mm = modal({
    title: esc(m.name),
    body: `<div class="yz-pour">
      <p class="yz-pour-stock">Qalıq: <b>${esc(stockText(m))}</b>${c.ml ? ` · səbətdə ${fmtMl(c.ml)} ml` : ''}</p>
      <div class="yz-pour-grid">
        ${P.bottle ? btn({ ml: P.bottleMl, label: `Şüşə ${P.bottleMl} ml`, price: r2(m.price || 0), bottle: true }, !bottleOk, bottleOk ? '' : (sealed - c.bottles < 1 && S > 0 ? 'bağlı şüşə yoxdur — açıq şüşə yalnız ml satılır' : 'qalıq çatmır')) : ''}
        ${presets.map(ml => btn({ ml, label: `${ml} ml`, price: priceFor(m, ml) }, free < ml, free < ml ? `cəmi ${fmtMl(Math.max(0, free))} ml` : '')).join('')}
      </div>
      ${P.free ? `<div class="yz-pour-free"><label class="yzi-f"><span>Başqa miqdar (ml)</span>${numInput('id="yzPourMl" placeholder="məs. 70"', '')}</label>
        <button type="button" class="yzi-btn yzi-btn--gold" data-free>Əlavə et</button><small id="yzPourFreeP"></small></div>` : ''}
    </div>`,
    actions: [{ label: 'Bağla', cancel: true }]
  });
  const el = mm.el;
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (b && !b.disabled) { onPick(JSON.parse(b.dataset.v)); mm.close(); return; }
    if (e.target.closest('[data-free]')) {
      const ml = Math.round(num(el.querySelector('#yzPourMl').value));
      if (!(ml > 0)) { fail('Miqdarı ml ilə yazın'); return; }
      if (ml > free) { fail(`Cəmi ${fmtMl(Math.max(0, free))} ml qalıb`); return; }
      onPick({ ml, label: `${ml} ml`, price: priceFor(m, ml) }); mm.close();
    }
  });
  el.querySelector('#yzPourMl')?.addEventListener('input', (e) => {
    const ml = num(e.target.value); el.querySelector('#yzPourFreeP').textContent = ml > 0 ? money(priceFor(m, ml)) : '';
  });
}

/* ═══ Kataloq: ayarlar ═══ */
export function openConfig(pid) {
  const p = product(pid); if (!p) return;
  if (!can('catalog.edit') && state.user?.role !== 'admin') { fail('Kataloqu dəyişmək icazəniz yoxdur'); return; }
  if (p.type !== 'goods') { fail('Yalnız hazır mal (içki) üçün'); return; }
  if (p.unit !== 'ml') { fail('Məhsulun vahidi "ml" olmalıdır — qalıq ml ilə saxlanılır. Vahidi dəyişin (alışda "Şüşə = 700 ml" qablaşdırması əlavə edin).'); return; }
  const packs = (packsOf(p) || []).filter(x => x.key !== '_base');
  const pk = packs.find(x => /şüşə|shushe|butulka/i.test(x.name || '')) || packs[0];
  const c = p.pour || {};
  const d = { on: c.on !== false && !!p.pour, bottleMl: c.bottleMl || pk?.factor || 700, bottle: c.bottle !== false, unitMl: c.unitMl || 50, unitPrice: c.unitPrice ?? '', presets: (c.presets || [50, 100, 150]).join(', '), free: c.free !== false };
  modal({
    title: `Şüşə və ml ilə satış · ${esc(p.name)}`,
    body: `<div class="yz-pour-cfg">
      <label class="yz-cr-chk"><input type="checkbox" id="pcOn" ${d.on ? 'checked' : ''}> <b>Şüşə və ml ilə sat</b></label>
      <div class="yzi-grid2">
        <label class="yzi-f"><span>Şüşənin həcmi (ml)</span>${numInput('id="pcB"', d.bottleMl)}</label>
        <label class="yzi-f"><span>Şüşə qiyməti</span><input type="text" value="${money(p.price || 0)} — məhsulun satış qiyməti" disabled></label>
        <label class="yzi-f"><span>Porsiya ölçüsü (ml)</span>${numInput('id="pcU"', d.unitMl)}</label>
        <label class="yzi-f"><span>Porsiyanın qiyməti (₼)</span>${numInput('id="pcP" placeholder="məs. 9"', d.unitPrice)}</label>
        <label class="yzi-f"><span>Düymələr (ml, vergüllə)</span><input type="text" id="pcPr" value="${esc(d.presets)}"></label>
      </div>
      <label class="yz-cr-chk"><input type="checkbox" id="pcBt" ${d.bottle ? 'checked' : ''}> Bütöv şüşə də satılsın</label>
      <label class="yz-cr-chk"><input type="checkbox" id="pcF" ${d.free ? 'checked' : ''}> İstənilən miqdar yazmaq olsun</label>
      <p class="yzi-hint">Qiymət ml-ə görə hesablanır: məs. porsiya 50 ml = 9 ₼ olsa, 100 ml = 18 ₼, 70 ml = 12.60 ₼.
        Açılmış şüşə ml olaraq qalır — bağlı şüşə qalmayanda şüşə satılmır, yalnız ml.</p></div>`,
    actions: [{ label: 'Ləğv et', cancel: true }, { label: 'Yadda saxla', cls: 'yzi-btn--gold', onClick: async (b) => {
      const on = b.querySelector('#pcOn').checked;
      const bottleMl = Math.round(num(b.querySelector('#pcB').value)), unitMl = Math.round(num(b.querySelector('#pcU').value)), unitPrice = num(b.querySelector('#pcP').value);
      const presets = b.querySelector('#pcPr').value.split(/[,\s]+/).map(x => Math.round(Number(x))).filter(x => x > 0).slice(0, 6);
      if (on && !(bottleMl > 0)) throw new Error('Şüşənin həcmini yazın');
      if (on && !(unitMl > 0 && unitPrice > 0)) throw new Error('Porsiya ölçüsünü və qiymətini yazın');
      await db.ref(`products/${pid}/pour`).set(on ? { on: true, bottleMl, unitMl, unitPrice: r2(unitPrice), presets: presets.length ? presets : [50, 100, 150], bottle: b.querySelector('#pcBt').checked, free: b.querySelector('#pcF').checked } : null);
      await new Promise(r => setTimeout(r, 300));
      await syncMenu(pid).catch(() => {});
      ok(on ? 'Şüşə / ml satışı aktivdir' : 'Söndürüldü');
    } }]
  });
}
document.addEventListener('click', (e) => { const b = e.target.closest('[data-pour-cfg]'); if (b) openConfig(b.dataset.pourCfg); });

window.__yzPour = { pick, stockText, split, priceFor, openConfig };
