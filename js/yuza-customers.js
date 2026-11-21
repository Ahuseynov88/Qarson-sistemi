/* ═══════════════════════════════════════════
   YUZA POS — VAHİD MÜŞTƏRİ BAZASI (C17 · 21.11.2026)
   • Bütün müştərilər BİR bazadadır (loyaltyCustomers): QR ilə özü qeydiyyatdan keçsin və ya işçi qeyd etsin —
     sahələr eynidir. Telefon məcburi və unikaldır; şəxsiyyət vəsiqəsinin nömrəsi könüllüdür (açıq saxlanmır,
     yalnız şifrəli izi və son 4 simvolu). Təkrar qeydiyyatı server tutur (yuza-api: custSave / loyRegister).
   • Nisyə hesabı (customers) ayrıca qalır — borc və ödəniş tarixçəsi toxunulmur — amma hər hesab bazadakı
     müştəriyə bağlanır (customers/{id}/baseId). Kartda bonus, nisyə borcu, sifariş tarixçəsi bir yerdədir.
   • Köhnə nisyə hesabları: "Ümumi bazaya bağla" — telefona görə tapılır və ya yaradılır; telefonu olmayan
     hesab qırmızı qalır və ona yeni nisyə yazmaq olmur (telefon doldurulana qədər).
═══════════════════════════════════════════ */
import { db, R } from './firebase-service.js';
import { state } from './state.js';
import { hasPermission } from './permissions.js';
import { addLog, toArr } from './utils.js';
import { api, apiOn } from './yuza-api.js';
import { modal, ok, fail, esc } from './yuza-inv-ui.js';

const p2 = (n) => String(n).padStart(2, '0');
export const fmtDT = (t) => { if (!t) return '—'; const d = new Date(t); return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const money = (n) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2) + ' ₼';
const I = (id) => `<svg class="icon"><use href="#i-${id}"></use></svg>`;

/* Telefon: serverdəki qayda ilə eyni (994XXXXXXXXX) */
export function normPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10 && d[0] === '0') d = '994' + d.slice(1);
  else if (d.length === 9) d = '994' + d;
  return /^\d{9,15}$/.test(d) ? d : '';
}
export const fullName = (c) => [c?.firstName, c?.lastName].filter(Boolean).join(' ') || c?.name || '—';
const isAdmin = () => state.user?.role === 'admin';
export const canManage = () => isAdmin() || hasPermission('panel.customers') || hasPermission('customer.create');

/* ── Baza (ehtiyac olanda yüklənir — ofisiant cihazında panel dinləməsi olmaya bilər) ── */
let baseCache = { at: 0, list: null };
export async function baseList(force = false) {
  if (state.loyaltyCustomers?.length && !force) return state.loyaltyCustomers;
  if (!force && baseCache.list && Date.now() - baseCache.at < 60000) return baseCache.list;
  try { baseCache = { at: Date.now(), list: toArr((await R.loyaltyCustomers.once('value')).val()) }; } catch (e) { baseCache = { at: Date.now(), list: [] }; }
  window.__yzBaseCache = baseCache.list;
  return baseCache.list;
}
const baseById = (id) => (state.loyaltyCustomers || baseCache.list || []).find(c => c.id === id) || null;
export const accountOf = (baseId) => (state.customers || []).find(a => a.baseId === baseId) || null;

/* ── Server: yarat / dəyiş (təkrar yoxlanışı ilə) ── */
export async function saveBase(fields, id = null, extra = {}) {
  if (!apiOn()) throw new Error('Server qatı qoşulmayıb — müştəri qeydiyyatı server vasitəsilə aparılır.');
  try {
    const r = await api('custSave', { id, fields, ...extra });
    baseCache.at = 0;
    return { id: r.id, created: r.created };
  } catch (e) {
    const [msg, dupId] = String(e.message || '').split('|');
    const x = new Error(msg); x.code = e.code; x.dupId = dupId || null;
    throw x;
  }
}

/* ═══ MÜŞTƏRİ KARTI: yarat / redaktə ═══ */
export function openEditor(id = null, { prefill = {}, onSaved = null } = {}) {
  const c = id ? (baseById(id) || {}) : prefill;
  const v = (k) => esc(c[k] || '');
  const m = modal({
    title: id ? `${I('edit')} Müştəri kartı` : `${I('plus')} Yeni müştəri`,
    wide: true,
    body: `<div class="yz-cu-form">
      <div class="yzi-grid2">
        <label class="yzi-f"><span>Ad *</span><input type="text" id="cuF" maxlength="60" value="${v('firstName')}"></label>
        <label class="yzi-f"><span>Soyad</span><input type="text" id="cuL" maxlength="60" value="${v('lastName')}"></label>
        <label class="yzi-f"><span>Ata adı</span><input type="text" id="cuFa" maxlength="60" value="${v('fatherName')}"></label>
        <label class="yzi-f"><span>Telefon * <small>(unikal — sonra telefonla təsdiq olunacaq)</small></span><input type="tel" id="cuP" maxlength="30" value="${v('phone')}" placeholder="050 123 45 67"></label>
        <label class="yzi-f"><span>Cins</span><select id="cuG"><option value="">—</option>${['Kişi', 'Qadın'].map(g => `<option${c.gender === g ? ' selected' : ''}>${g}</option>`).join('')}</select></label>
        <label class="yzi-f"><span>Doğum tarixi</span><input type="date" id="cuB" value="${v('birthDate')}"></label>
        <label class="yzi-f"><span>Şəxsiyyət vəsiqəsinin nömrəsi <small>(könüllü)</small></span><input type="text" id="cuI" maxlength="20" autocomplete="off" placeholder="${c.idLast4 ? '•••• ' + esc(c.idLast4) + ' — dəyişmək üçün yazın' : 'məs. AA1234567'}"></label>
        <label class="yzi-f"><span>Etiketlər <small>(vergüllə: VIP, daimi)</small></span><input type="text" id="cuT" maxlength="200" value="${v('tags')}"></label>
      </div>
      <label class="yzi-f"><span>Ünvan</span><input type="text" id="cuA" maxlength="200" value="${v('address')}"></label>
      <label class="yzi-f"><span>Qeyd</span><textarea id="cuN" rows="2" maxlength="500">${v('note')}</textarea></label>
      <p class="yzi-hint">Vəsiqə nömrəsi bazaya açıq yazılmır — yalnız təkrar qeydiyyatı tutmaq üçün şifrəli izi və son 4 simvolu saxlanılır.</p>
      <p class="yz-cu-err" id="cuErr" role="alert"></p></div>`,
    actions: [
      { label: 'Ləğv et', cancel: true },
      { label: `${I('check')} Yadda saxla`, cls: 'yzi-btn--gold', onClick: async (b) => {
        const g = (s) => b.querySelector(s).value.trim();
        const fields = { firstName: g('#cuF'), lastName: g('#cuL'), fatherName: g('#cuFa'), phone: g('#cuP'), gender: g('#cuG'),
          birthDate: g('#cuB'), address: g('#cuA'), note: g('#cuN'), tags: g('#cuT'), idNo: g('#cuI') };
        const err = b.querySelector('#cuErr');
        err.innerHTML = '';
        if (!fields.firstName) { err.textContent = 'Ad mütləqdir.'; return false; }
        if (!normPhone(fields.phone)) { err.textContent = 'Telefon nömrəsini düzgün yazın (məs. 050 123 45 67).'; return false; }
        try {
          const r = await saveBase(fields, id);
          addLog('customer_mgmt', `${state.user?.name || 'Rəhbər'} müştəri ${r.created ? 'qeyd etdi' : 'kartını dəyişdi'}: ${fullName(fields)} (${fields.phone})`, { customerId: r.id });
          // Bağlı nisyə hesabında ad və telefon da yenilənir
          const acc = accountOf(r.id);
          if (acc) await R.customers.child(acc.id).update({ name: fullName(fields), phone: fields.phone }).catch(() => {});
          ok(r.created ? 'Müştəri qeyd edildi' : 'Kart yeniləndi');
          onSaved?.(r.id);
        } catch (e) {
          err.innerHTML = esc(e.message) + (e.dupId ? ` <button type="button" class="yzi-chipbtn" data-open-dup="${esc(e.dupId)}">Mövcud kartı aç</button>` : '');
          return false;
        }
      } }
    ]
  });
  m.el.addEventListener('click', (e) => {
    const d = e.target.closest('[data-open-dup]');
    if (d) { m.close(); openCard(d.dataset.openDup); }
  });
  setTimeout(() => m.el.querySelector('#cuF')?.focus(), 50);
  return m;
}

/* ═══ MÜŞTƏRİ KARTI: baxış (bonus + nisyə + statistika + sifariş tarixçəsi) ═══ */
export async function cardStats(id) {
  // Rəhbər panelində bağlanan hesablar onsuz da yaddaşdadır — bazadan ayrıca sorğu getmir
  let orders = (state.closedOrders || []).filter(o => o.loyaltyCustomerId === id);
  orders = orders.filter(o => !o.void).sort((a, b) => (b.closedAt || b.createdAt || 0) - (a.closedAt || a.createdAt || 0));
  const spent = orders.reduce((s, o) => s + (Number(o.total) || 0), 0);
  return { orders, count: orders.length, spent, last: orders[0] ? (orders[0].closedAt || orders[0].createdAt) : null };
}
export function cardExtraHtml(c, st) {
  const acc = accountOf(c.id);
  const tags = String(c.tags || '').split(',').map(t => t.trim()).filter(Boolean);
  return `<div class="yz-cu-extra" data-cu-extra="${esc(c.id)}">
    <div class="ct-detail-info-grid">
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Ünvan</div><div class="ct-detail-info-block__value">${esc(c.address || '—')}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Vəsiqə</div><div class="ct-detail-info-block__value">${c.idLast4 ? '•••• ' + esc(c.idLast4) : '—'}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Kim qeyd edib</div><div class="ct-detail-info-block__value">${c.createdVia === 'staff' ? 'İşçi: ' + esc(c.createdBy || '') : 'QR (özü)'}</div></div>
      <div class="ct-detail-info-block"><div class="ct-detail-info-block__label">Etiketlər</div><div class="ct-detail-info-block__value">${tags.length ? tags.map(t => `<span class="yz-cu-tag">${esc(t)}</span>`).join(' ') : '—'}</div></div>
    </div>
    ${c.note ? `<p class="yz-cu-note">${I('clipboard')} ${esc(c.note)}</p>` : ''}
    <div class="yz-cu-kpis">
      <div><small>Gəliş (bağlanan hesab)</small><b>${st.count}</b></div>
      <div><small>Ümumi xərc</small><b>${money(st.spent)}</b></div>
      <div><small>Son gəliş</small><b>${fmtDT(st.last)}</b></div>
      <div class="${acc && (acc.balance || 0) > 0.01 ? 'is-debt' : ''}"><small>Nisyə borcu</small><b>${acc ? money(acc.balance) : 'hesab yoxdur'}</b></div>
    </div>
    <div class="yz-cu-actions">
      ${acc ? `<button type="button" class="btn" data-cu-hist="${esc(acc.id)}">${I('clipboard')} Nisyə tarixçəsi</button>` : (canManage() ? `<button type="button" class="btn" data-cu-openacc="${esc(c.id)}">${I('card')} Nisyə hesabı aç</button>` : '')}
    </div>
    <div class="ct-detail-section-title">${I('clipboard')} Sifariş tarixçəsi (${st.count})</div>
    ${st.orders.length ? `<div class="yz-cu-orders">${st.orders.slice(0, 30).map(o => `<div class="ct-detail-item-row"><span>${fmtDT(o.closedAt || o.createdAt)} · ${esc(o.tableName || '')}</span><b>${money(o.total)}</b></div>`).join('')}</div>`
      : '<p style="color:var(--text3);font-size:13px;">Hələ bağlanmış hesab yoxdur.</p>'}
  </div>`;
}
/* Kartı aç (Müştərilər bölməsində) */
export function openCard(id) {
  if (typeof window.adminTab === 'function' && !document.getElementById('sec-loyaltyCustomers')?.classList.contains('active')) window.adminTab('loyaltyCustomers');
  setTimeout(() => window.selectLoyaltyCustomer?.(id), 150);
}

/* Nisyə hesabını bazadakı müştəri üçün aç (yoxdursa) */
export async function ensureAccount(baseId) {
  const ex = accountOf(baseId) || toArr((await R.customers.orderByChild('baseId').equalTo(baseId).once('value').catch(() => null))?.val?.() || {})[0];
  if (ex) return ex.id;
  const c = baseById(baseId) || (await baseList(true)).find(x => x.id === baseId);
  if (!c) throw new Error('Müştəri bazada tapılmadı');
  const k = R.customers.push();
  await k.set({ name: fullName(c), phone: c.phone || '', baseId, balance: 0, createdAt: Date.now(), createdBy: state.user?.name || 'Rəhbər' });
  addLog('customer_mgmt', `${state.user?.name || 'Rəhbər'} "${fullName(c)}" üçün nisyə hesabı açdı`, { customerId: k.key, baseId });
  return k.key;
}

/* ═══ KÖHNƏ NİSYƏ HESABLARINI BAZAYA BAĞLAMAQ ═══ */
export const unlinked = () => (state.customers || []).filter(a => !a.baseId);
export async function linkAll() {
  const list = unlinked();
  const base = await baseList(true);
  const byPhone = {};
  base.forEach(c => { const n = normPhone(c.phone); if (n && !byPhone[n]) byPhone[n] = c.id; });
  let linked = 0, created = 0, noPhone = 0, failed = 0;
  for (const a of list) {
    const n = normPhone(a.phone);
    if (!n) { noPhone++; continue; }
    let id = byPhone[n];
    if (!id) {
      const [first, ...rest] = String(a.name || '').trim().split(/\s+/);
      try { const r = await saveBase({ firstName: first || 'Müştəri', lastName: rest.join(' '), phone: a.phone }); id = r.id; created++; }
      catch (e) { if (e.dupId) id = e.dupId; else { failed++; continue; } }
      byPhone[n] = id;
    }
    try { await R.customers.child(a.id).update({ baseId: id }); linked++; } catch (e) { failed++; }
  }
  addLog('customer_mgmt', `Nisyə hesabları ümumi bazaya bağlandı: ${linked} bağlandı (${created} yeni kart), ${noPhone} telefonsuz, ${failed} alınmadı`, { linked, created, noPhone, failed });
  return { linked, created, noPhone, failed };
}

/* ═══ Admin bölmələrinə əlavələr ═══ */
// 1) Müştərilər (baza): "Yeni müştəri" düyməsi; redaktə yeni karta yönləndirilir
function ensureBaseUi() {
  const sec = document.getElementById('sec-loyaltyCustomers');
  if (!sec || sec.querySelector('[data-cu-new]')) return;
  const bar = document.createElement('div');
  bar.className = 'yz-cu-bar';
  bar.innerHTML = `<p class="yzi-hint">Bütün müştərilər bir bazadadır: QR ilə özü qeydiyyatdan keçən də, işçinin qeyd etdiyi də. Telefon təkrarlana bilməz.</p>
    ${canManage() ? `<button type="button" class="yzi-btn yzi-btn--gold" data-cu-new>${I('plus')} Yeni müştəri</button>` : ''}`;
  sec.prepend(bar);
  bar.addEventListener('click', (e) => { if (e.target.closest('[data-cu-new]')) openEditor(null, { onSaved: (id) => setTimeout(() => openCard(id), 600) }); });
}
const editHook = (id) => openEditor(id);
window.openLoyaltyEditModal = editHook;

// 2) Kartın detal panelinə əlavə blok
let extraBusy = null;
function ensureCardExtra() {
  const body = document.getElementById('lcDetailBody');
  const id = state._selectedLoyaltyCustomerId;
  if (!body || !id || !body.querySelector('.ct-detail-header')) return;
  if (body.querySelector(`[data-cu-extra="${CSS.escape(id)}"]`) || extraBusy === id) return;
  const c = baseById(id); if (!c) return;
  extraBusy = id;
  cardStats(id).then(st => {
    extraBusy = null;
    if (state._selectedLoyaltyCustomerId !== id || body.querySelector('[data-cu-extra]')) return;
    const anchor = body.querySelector('.ct-detail-actions');
    anchor ? anchor.insertAdjacentHTML('beforebegin', cardExtraHtml(c, st)) : body.insertAdjacentHTML('beforeend', cardExtraHtml(c, st));
  }).catch(() => { extraBusy = null; });
}
document.addEventListener('click', async (e) => {
  const h = e.target.closest('[data-cu-hist]'); if (h) { window.openCustomerHistoryModal?.(h.dataset.cuHist); return; }
  const o = e.target.closest('[data-cu-openacc]');
  if (o) { try { await ensureAccount(o.dataset.cuOpenacc); ok('Nisyə hesabı açıldı'); document.querySelector('[data-cu-extra]')?.remove(); } catch (x) { fail(x.message); } }
});

// 3) Nisyə hesabları: bağlanmamış hesablar üçün zolaq
function ensureCreditBanner() {
  const sec = document.getElementById('sec-customers'); if (!sec) return;
  let b = sec.querySelector('.yz-cu-link');
  const list = unlinked();
  const noPhone = list.filter(a => !normPhone(a.phone)).length;
  if (!list.length || !canManage()) { b?.remove(); return; }
  if (!b) { b = document.createElement('div'); b.className = 'yz-cu-link'; sec.prepend(b); }
  const sig = `${list.length}:${noPhone}`;
  if (b.dataset.sig === sig) return;
  b.dataset.sig = sig;
  b.innerHTML = `<div><b>${list.length} nisyə hesabı ümumi müştəri bazasına bağlanmayıb.</b>
      <small>Bağlananda telefona görə bazadakı kart tapılır, yoxdursa yaradılır. Borclar və tarixçə dəyişmir.${noPhone ? ` <b class="yzi-bad">${noPhone} hesabın telefonu yoxdur</b> — redaktə edib telefon yazın, yoxsa ona yeni nisyə yazmaq olmur.` : ''}</small></div>
    <button type="button" class="yzi-btn yzi-btn--gold" data-cu-linkall>Ümumi bazaya bağla</button>`;
  b.querySelector('[data-cu-linkall]').onclick = async (ev) => {
    const btn = ev.currentTarget; btn.disabled = true; btn.textContent = 'Bağlanır…';
    try {
      const r = await linkAll();
      ok(`${r.linked} hesab bağlandı (${r.created} yeni kart)${r.noPhone ? `, ${r.noPhone} telefonsuz` : ''}${r.failed ? `, ${r.failed} alınmadı` : ''}`);
    } catch (x) { fail(x.message); }
    btn.disabled = false; btn.textContent = 'Ümumi bazaya bağla'; b.dataset.sig = '';
  };
}

setInterval(() => {
  if (window.openLoyaltyEditModal !== editHook) window.openLoyaltyEditModal = editHook;   // köhnə redaktə pəncərəsi əvəzinə vahid kart
  if (!state.user) return;
  if (document.getElementById('sec-loyaltyCustomers')?.classList.contains('active')) { ensureBaseUi(); ensureCardExtra(); }
  if (document.getElementById('sec-customers')?.classList.contains('active')) ensureCreditBanner();
}, 700);

window.__yzCustomers = { openEditor, openCard, ensureAccount, linkAll, baseList, normPhone, saveBase };
