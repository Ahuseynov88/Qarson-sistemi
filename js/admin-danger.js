/* ═══════════════════════════════════════════
   YUZA POS — ADMİN PANELİ: TƏHLÜKƏLİ ƏMƏLİYYATLAR
   Mərhələ 5: admin.js-dən ayrılıb (məntiq dəyişməyib). Ümumi giriş nöqtəsi — admin.js.
═══════════════════════════════════════════ */
import { db } from './firebase-service.js';
import { ALL_PERMISSIONS, hasPermission } from './permissions.js';
import { state } from './state.js';
import { adminTab } from './admin.js';
import { apiOn, api } from './yuza-api.js';
import { showToast, confirmAction, addLog } from './utils.js';

/* ═══════════════════════════════════════════
   TƏHLÜKƏLİ ƏMƏLİYYATLAR
═══════════════════════════════════════════ */

// Yeni anbar sistemi: alış sənədləri silinəndə təchizatçı borcları da sıfırlanır
export async function _zeroSupplierDebts() {
  const snap = await db.ref('suppliers').once('value');
  const up = {};
  snap.forEach(c => { up[c.key + '/totalDebt'] = 0; });
  if (Object.keys(up).length) await db.ref('suppliers').update(up);
}
export const INV_DOC_NODES = ['purchases','invAttach','invPurchases','invPayments','invWriteoffs','invTransfers','invCounts','invProductions','stockMoves','stock','supplierLedger'];
export const CASH_DOC_NODES = ['invCash','cashCloses','shifts','shiftCur','shiftSeq'];

export const DANGER_OPS = [
  {
    id: 'clearClosedOrders',
    icon: '<svg class="icon"><use href="#i-lock"></use></svg>',
    title: 'Bağlanan Masaları Sil',
    desc: 'Bütün bağlanan masa tarixçəsi, çek məlumatları və ödəniş qeydləri silinir. Hesabatlar bu məlumatlardan qurulandığı üçün keçmiş hesabatlar da boşalır.',
    nodes: ['closedOrders', 'payments'],
    keepLabel: null,
    danger: 1
  },
  {
    id: 'clearOrders',
    icon: '<svg class="icon"><use href="#i-chair"></use></svg>',
    title: 'Aktiv Sifarişləri Sıfırla',
    desc: 'Hal-hazırda açıq olan bütün masa sifarişləri, masa tutanlar və mətbəx sifariş növbəsi silinir. Masalar boş vəziyyətə keçir.',
    nodes: ['orders', 'tableOrders', 'kitchenOrders', 'kitchenNotifs', 'printJobs'],
    keepLabel: null,
    danger: 1
  },
  {
    id: 'clearLogs',
    icon: '<svg class="icon"><use href="#i-clipboard"></use></svg>',
    title: 'Tarixçə Logları Sil',
    desc: 'Bütün sistem jurnal qeydləri (kim nə etdi, nə vaxt) silinir. Əməliyyat məlumatlarına toxunulmur.',
    nodes: ['logs'],
    keepLabel: null,
    danger: 1
  },
  {
    id: 'clearPurchases',
    icon: '<svg class="icon"><use href="#i-box"></use></svg>',
       title: 'Anbar və Alış Sənədlərini Sil',
    desc: 'Bütün alış qaimələri, təchizatçı ödənişləri, silinmə, transfer, sayım və hazırlama aktları, anbar hərəkətləri silinir. Bütün qalıqlar sıfırlanır, təchizatçı borcları sıfırlanır.',
    nodes: INV_DOC_NODES,
    after: _zeroSupplierDebts,
    keepLabel: 'Məhsul kataloqu, anbarlar və təchizatçılar saxlanılır',
    danger: 2
  },
  {
    id: 'clearCashDocs',
    icon: '<svg class="icon"><use href="#i-cash"></use></svg>',
    title: 'Kassa Sənədlərini Sil',
    desc: 'Əl ilə yazılan bütün kassa mədaxil, məxaric, transfer sənədləri, gün sonu bağlanışları və kassa növbələri (X/Z) silinir.',
    nodes: CASH_DOC_NODES,
    keepLabel: 'Kassa hesabları və onların başlanğıc qalıqları saxlanılır',
    danger: 1
  },
  {
    id: 'clearBanquetEvents',
    icon: '<svg class="icon"><use href="#i-calendar"></use></svg>',
    title: 'Banket Tədbirlərini Sil',
    desc: 'Keçmiş və gələcək bütün banket tədbiri qeydləri, rezervasiya slotları silinir. Banket zalları və tədbir növləri saxlanılır.',
    nodes: ['banquetEvents', 'banquetHallBookings'],
    keepLabel: 'Banket zalları və tədbir növləri saxlanılır',
    danger: 1
  },
  {
    id: 'clearCustomerCharges',
    icon: '<svg class="icon"><use href="#i-card"></use></svg>',
    title: 'Nisyə Borclarını Sil',
    desc: 'Bütün müştəri nisyə (kredit hesabı) əməliyyat qeydləri silinir. Müştərilərin özü saxlanılır, yalnız borc tarixçəsi gedir.',
    nodes: ['customerCharges'],
    keepLabel: 'Müştəri qeydiyyatları saxlanılır',
    danger: 1
  },
  {
    id: 'clearLoyaltyData',
    icon: '<svg class="icon"><use href="#i-star"></use></svg>',
    title: 'Loyallıq Məlumatlarını Sil',
    desc: 'Qeydiyyatlı sadiqlik müştəriləri, qonaq tokenləri və referral qeydləri silinir.',
    nodes: ['loyaltyCustomers', 'guestTokens', 'referrals'],
    keepLabel: null,
    danger: 1
  },
  {
    id: 'clearReservations',
    icon: '<svg class="icon"><use href="#i-calendar"></use></svg>',
    title: 'Rezervasiyaları Sil',
    desc: 'Bütün rezerv qeydləri (gələcək və keçmiş) silinir. Masaların tutum və minimum hesab ayarları saxlanılır.',
    nodes: ['reservations'],
    keepLabel: 'Masalar, kabinetlər və rezerv ayarları saxlanılır',
    danger: 1
  },
  {
    id: 'clearAllOperational',
    icon: '<svg class="icon"><use href="#i-trash"></use></svg>',
    title: 'Bütün Əməliyyat Məlumatlarını Sil',
    desc: 'Yuxarıdakı bütün silmə əməliyyatları bir anda icra olunur: bağlanan masalar, sifarişlər, alışlar, banket tədbirləri, rezervasiyalar, loglar, nisyə tarixçəsi, loyallıq məlumatları. Qeydiyyatlar (işçilər, məhsullar, masalar, müştərilər, ayarlar) toxunulmaz qalır.',
        nodes: ['closedOrders','payments','orders','tableOrders','kitchenOrders','kitchenNotifs','printJobs','logs','banquetEvents','banquetHallBookings','customerCharges','loyaltyCustomers','guestTokens','referrals','customerRequests','feedbacks','chats','reservations', ...INV_DOC_NODES, ...CASH_DOC_NODES],
    after: _zeroSupplierDebts,
    keepLabel: 'İşçilər, məhsullar, anbarlar, kassa hesabları, masalar, müştərilər, ayarlar, printerlar, mətbəxlər saxlanılır',
    danger: 2
  },
  {
    id: 'factoryReset',
    icon: '<svg class="icon"><use href="#i-warning"></use></svg>',
    title: 'Sistemi Tam Sıfırla',
    desc: 'PROQRAMDAKİ BÜTÜN MƏLUMATLAR SİLİNİR: işçilər, məhsullar, masalar, rezervasiyalar, sifarişlər, kassa, anbar, davamiyyət, ayarlar — hamısı. Proqram yeni qurulmuş kimi boş başlayır. Yalnız Rəhbər hesabı və təsdiqlənmiş cihazlar saxlanılır. Bu əməliyyat GERİ QAYTARILMAZ.',
    all: true,
       nodes: ['closedOrders','payments','orders','tableOrders','kitchenOrders','kitchenNotifs','printJobs','logs','purchases','banquetEvents','banquetHallBookings','customerCharges','loyaltyCustomers','guestTokens','referrals','staff','tables','menuItems','customers','paymentMethods','suppliers','kitchenStations','banquetHalls','banquetEventTypes','printers','notifSounds','settings',
      'customerRequests','feedbacks','chats','printerAgents','raciaAudio','raciaMeta','att','ingredients','staffHR',
      'products','warehouses','stock','stockMoves','supplierLedger','invCounters','invBackup',
      'invPurchases','invPayments','invWriteoffs','invTransfers','invCounts','invProductions','invCash','cashAccounts','cashCloses','reservations',
      // Düzəliş 21.11: kassa növbələri (açıq növbə daxil), anbar növbəsi, qaimə şəkilləri, paket/çatdırılma da silinir
      'shifts','shiftCur','shiftSeq','stockQueue','invAttach',
      'deliveryOrders','deliveryCustomers','deliveryMeta','deliveryProofs','deliverySettlements'],
    keepLabel: null,
    danger: 3
  }
];

// Silmə icazələri: Rəhbər hər əməliyyatı ayrıca işçiyə verə bilər. "Sistemi tam sıfırla" yalnız Rəhbərdədir.
if (!ALL_PERMISSIONS.some(g => g.items?.some(i => i.key?.startsWith('danger.')))) {
  ALL_PERMISSIONS.push({
    group: 'Məlumatların silinməsi',
    icon: '<svg class="icon"><use href="#i-trash"></use></svg>',
    items: DANGER_OPS.filter(o => !o.all).map(o => ({ key: 'danger.' + o.id, label: o.title }))
  });
}
export const _ownerMode = () => !!window.__yzOwner?.available?.();
export const _isRehber = () => state.user?.role === 'admin';
export const _canDanger = (op) => _isRehber() || (!op.all && hasPermission('danger.' + op.id));

/* Bazadakı bütün bölmələrin adları (server "shallow" sorğusu) — "Sistemi tam sıfırla" heç nəyi buraxmasın */
export async function _allRootKeys(fallback) {
  try {
    const u = firebase.auth?.().currentUser;
    const base = (firebase.app().options.databaseURL || '').replace(/\/+$/, '');
    if (u && base) {
      const tok = await u.getIdToken();
      const r = await fetch(`${base}/.json?shallow=true&auth=${encodeURIComponent(tok)}`);
      if (r.ok) { const j = await r.json(); if (j && typeof j === 'object') return [...new Set([...Object.keys(j), ...fallback])]; }
    }
  } catch (e) { console.warn('[sıfırla] bölmə siyahısı alınmadı, əvvəlcədən bilinən siyahı işlənir', e); }
  return fallback;
}

// ── Parol modal ──
// opId: null = bölməyə giriş üçün, string = konkret əməliyyat üçün
export let _pendingDangerOpId = null;

export function openDangerZonePinModal(opId) {
  _pendingDangerOpId = opId;
  const el = document.getElementById('dangerZonePinModal');
  if (!el) return;
  document.getElementById('dzPinInput').value = '';
  document.getElementById('dzPinError').textContent = '';
  const isEntry = opId === null;
  const own = state.user?.role === 'staff';
  document.getElementById('dzPinTitle').textContent = isEntry
    ? '🔐 Məlumatların silinməsi'
    : '🔑 Silməni təsdiqləyin';
  document.getElementById('dzPinSubtitle').textContent = isEntry
    ? 'Bu bölməyə giriş üçün Rəhbər PIN kodunu daxil edin.'
    : (own ? 'Silmək üçün ÖZ PIN kodunuzu daxil edin.' : 'Silmə əməliyyatını icra etmək üçün Rəhbər PIN kodunu daxil edin.');
  el.classList.add('open');
  setTimeout(() => document.getElementById('dzPinInput')?.focus(), 100);
}

export function closeDangerZonePinModal() {
  document.getElementById('dangerZonePinModal')?.classList.remove('open');
  _pendingDangerOpId = null;
  // əgər bölməyə giriş üçün istənilmiş parol ləğv edildisə — dashboard-a qayıt
  if (state.adminSection === 'dangerZone') {
    const dashTab = document.querySelector('.admin-tab[data-section="dashboard"]');
    if (dashTab) adminTab('dashboard', dashTab);
  }
}

export async function confirmDangerZonePin() {
  const entered = document.getElementById('dzPinInput').value.trim();
  let okPin;
  if (state.user?.role === 'staff' && apiOn()) {
    // İşçinin öz PIN-i serverdə yoxlanır
    try { await api('verify', { pin: entered, self: state.user.id }); okPin = true; }
    catch (e) { okPin = false; if (e.code === 'locked' || e.code === 'net') { document.getElementById('dzPinError').textContent = '❌ ' + e.message; return; } }
  } else {
    const current = state.user?.role === 'staff' ? String(state.user.pin || '') : '';
    okPin = String(entered) === current;
  }
  if (!okPin) {
    document.getElementById('dzPinError').textContent = '❌ PIN yanlışdır. Yenidən cəhd edin.';
    document.getElementById('dzPinInput').value = '';
    document.getElementById('dzPinInput').focus();
    return;
  }
  document.getElementById('dangerZonePinModal').classList.remove('open');
  if (_pendingDangerOpId === null) {
    // bölməyə giriş — bölməni render et
    renderDangerZone();
  } else {
    // konkret əməliyyat — icra et
    _runDangerOp(_pendingDangerOpId);
  }
  _pendingDangerOpId = null;
}

export function renderDangerZone() {
  const body = document.getElementById('dangerZoneBody');
  if (!body) return;

  body.innerHTML = `
    <div style="max-width:620px;">
      <div style="background:rgba(220,53,69,.08);border:1.5px solid var(--red);border-radius:14px;padding:16px 18px;margin-bottom:20px;display:flex;gap:12px;align-items:flex-start;">
        <svg class="icon" style="width:22px;height:22px;color:var(--red);flex-shrink:0;margin-top:1px;"><use href="#i-warning"></use></svg>
        <div>
          <div style="font-weight:700;color:var(--red);margin-bottom:4px;">Diqqət! Bu bölmədəki əməliyyatlar GERİ QAYTARILMAZ.</div>
          <div style="font-size:13px;color:var(--text2);line-height:1.6;">Bazadan məlumatlar tam olaraq silinir. Hər əməliyyatdan əvvəl ${_isRehber() && _ownerMode() ? 'Rəhbər parolu' : (_isRehber() ? 'Rəhbər PIN-i' : 'öz PIN kodunuz')} + 2 dəfə təsdiq tələb olunur. Əmin olmadığınız heç bir əməliyyatı icra etməyin.${_isRehber() ? ' İşçiyə ayrı-ayrı silmə icazəsini <b>İşçilər → İcazələr → Məlumatların silinməsi</b> bölməsindən verə bilərsiniz.' : ''}</div>
        </div>
      </div>

      ${_isRehber() && apiOn() ? `
        <div class="table-card" style="margin-bottom:16px;border:1.5px solid rgba(46,204,113,.5);">
          <div style="display:flex;align-items:flex-start;gap:12px;">
            <div style="font-size:26px;line-height:1;flex-shrink:0;">🧹</div>
            <div style="flex:1;">
              <div style="font-weight:700;font-size:15px;margin-bottom:4px;">Köhnə müvəqqəti qeydlərin təmizlənməsi (hər gecə avtomatik)</div>
              <div style="font-size:13px;color:var(--text2);line-height:1.55;margin-bottom:6px;">Server hər gecə silir: çap işləri (2 gün), mətbəx bildirişləri, müştəri çağırışları və masa çatları (7 gün), rasiya səsləri (3 gün), ofisiant çağırışları (30 gün). Nəticə Loglara yazılır.</div>
              <div style="font-size:12px;color:var(--green);font-weight:600;margin-bottom:10px;">✓ Satış arxivi, ödənişlər, nisyə, kassa, loglar, anbar, banket və bronlara toxunulmur</div>
              <button class="btn btn-green" id="yzCleanupNow" style="padding:9px 18px;font-size:13px;">İndi təmizlə</button>
            </div>
          </div>
        </div>` : ''}
      ${DANGER_OPS.filter(_canDanger).map(op => `
        <div class="table-card" style="margin-bottom:12px;${op.danger===3?'border:2px solid var(--red);background:rgba(220,53,69,.07);':op.danger===2?'border:1.5px solid rgba(220,53,69,.5);':''}">
          <div style="display:flex;align-items:flex-start;gap:12px;">
            <div class="yz-dz-ico">${op.icon}</div>
            <div style="flex:1;">
              <div style="font-weight:700;font-size:15px;margin-bottom:4px;${op.danger===3?'color:var(--red);':''}">${op.title}</div>
              <div style="font-size:13px;color:var(--text2);line-height:1.55;margin-bottom:${op.keepLabel?'6px':'10px'};">${op.desc}</div>
              ${op.keepLabel ? `<div style="font-size:12px;color:var(--green);font-weight:600;margin-bottom:10px;">✓ ${op.keepLabel}</div>` : ''}
              <button class="btn btn-red" onclick="executeDangerOp('${op.id}')"
                style="padding:9px 18px;font-size:13px;${op.danger===3?'width:100%;padding:13px;font-size:15px;font-weight:700;':''}">
                <svg class="icon"><use href="#i-trash"></use></svg>
                ${op.danger===3?'⚠️ '+op.title+' — hər şey silinir':op.title}
              </button>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

document.addEventListener('click', async (ev) => {
  const b = ev.target.closest?.('#yzCleanupNow'); if (!b || b.disabled) return;
  b.disabled = true; const t0 = b.textContent; b.textContent = 'Təmizlənir…';
  try {
    const r = await api('cleanupNow', {}, { owner: true });
    const n = r.counts || {};
    showToast(`<svg class="icon"><use href="#i-check"></use></svg> Təmizləndi: ${r.total || 0} qeyd${r.total ? ' (' + Object.entries(n).map(([k, v]) => k + ' ' + v).join(', ') + ')' : ''}`);
  } catch (e) { showToast('<svg class="icon"><use href="#i-error"></use></svg> ' + (e.message || 'Təmizlənmədi')); }
  finally { b.disabled = false; b.textContent = t0; }
});

export async function executeDangerOp(opId) {
  const op = DANGER_OPS.find(o => o.id === opId);
  if (!op || !_canDanger(op)) { showToast('<svg class="icon"><use href="#i-ban"></use></svg> Bu əməliyyat üçün icazəniz yoxdur'); return; }
  // Rəhbər: parol (Firebase serveri yoxlayır) · işçi: öz PIN-i · köhnə rejim: Rəhbər PIN-i
  if (_isRehber() && _ownerMode()) {
    const ok = await window.__yzOwner.verify({ title: 'Silməni təsdiqləyin', text: `<b>${op.title}</b> — davam etmək üçün Rəhbər parolunu yazın.`, okLabel: 'Davam et' });
    if (ok) _runDangerOp(opId);
    return;
  }
  openDangerZonePinModal(opId);
}

export function _runDangerOp(opId) {
  const op = DANGER_OPS.find(o => o.id === opId);
  if (!op) return;

  const isFabrika = op.danger === 3;
  const nodeCount = op.nodes.length;

  confirmAction(
    `<strong>${op.icon} ${op.title}</strong><br><br>${op.desc}${op.keepLabel ? `<br><br><span style="color:var(--green);">✓ ${op.keepLabel}</span>` : ''}<br><br>Bu əməliyyat <strong style="color:var(--red);">GERİ QAYTARILMAZ</strong>. Davam etmək istəyirsiniz?`,
    () => {
      const secondMsg = isFabrika
        ? `<span style="color:var(--red);font-size:15px;font-weight:700;">☢️ SON XƏBƏRDARLIQ!</span><br><br>PROQRAMDAKİ <strong>BÜTÜN MƏLUMATLAR</strong> silinəcək. Proqram yeni qurulmuş kimi boş başlayacaq.<br><br>Bu əməliyyatı TƏSDİQLƏYİRSİNİZ?`
        : `Son dəfə soruşuram: <strong>${op.title}</strong> əməliyyatı <strong>${nodeCount} verilənlər qrupunu</strong> həmişəlik siləcək.<br><br>Tam əminsinizmi?`;

      confirmAction(
        secondMsg,
        async () => {
          try {
            if (op.all) {
              // Bütün bölmələr bir yazıda silinir; Rəhbər hesabı (owners) və cihaz təsdiqləri (sys) saxlanılır —
              // əks halda bütün cihazlar o an kilidlənərdi. Səlahiyyətli hesablar (işçilərə bağlıdır) ayrıca silinir.
              // Bazanın bölmə siyahısını cihaz oxuya bilmir (qaydalar kökü bağlayır) — ona görə bilinən BÜTÜN bölmələr silinir
              const known = [...new Set([...op.nodes, ...DANGER_OPS.flatMap(o => o.nodes)])];
              const keys = (await _allRootKeys(known)).filter(k => k !== 'owners' && k !== 'sys');
              // İşçi və mətbəx PIN-ləri serverdən də silinir — əks halda eyni PIN yeni işçiyə verilə bilməz ("artıq başqasına aiddir")
              if (apiOn()) {
                const own = { owner: true };
                const [st, ks] = await Promise.all([db.ref('staff').once('value'), db.ref('kitchenStations').once('value')]);
                const jobs = [...Object.keys(st.val() || {}).map(id => ['s', id]), ...Object.keys(ks.val() || {}).map(id => ['k', id])];
                for (const [type, id] of jobs) { try { await api('setPin', { type, id, pin: null }, own); } catch (e) { console.warn('[sıfırla] PIN silinmədi', type, id, e); } }
              }
              await db.ref().update(Object.fromEntries(keys.map(k => [k, null])));
              try {
                const odb = window.__yzOwner?.db?.();
                if (odb) {
                  const up = {};
                  for (const n of ['accounts', 'logins']) Object.keys((await odb.ref('sys/' + n).once('value')).val() || {}).forEach(k => { up[n + '/' + k] = null; });
                  if (Object.keys(up).length) await odb.ref('sys').update(up);
                }
              } catch (e) { console.warn('[sıfırla] səlahiyyətli hesablar silinmədi', e); }
              showToast(`<svg class="icon"><use href="#i-check"></use></svg> Sistem tam sıfırlandı. Proqram yenidən açılır…`);
              setTimeout(() => { try { window.logout?.(); } catch (e) { /* */ } location.reload(); }, 1500);
              return;
            }
            await Promise.all(op.nodes.map(node => db.ref(node).remove()));
            if (op.after) await op.after();
            addLog('danger_op', `"${op.title}" əməliyyatı icra edildi`, { nodes: op.nodes, by: state.user?.name || 'Rəhbər' });
            showToast(`<svg class="icon"><use href="#i-check"></use></svg> "${op.title}" uğurla tamamlandı`);
          } catch (e) {
            showToast(`<svg class="icon"><use href="#i-warning"></use></svg> Xəta: ${e.message}`);
          }
        },
        {
          title: isFabrika ? '☢️ Sistemi tam sıfırla' : 'Son Təsdiq',
          okLabel: `<svg class="icon"><use href="#i-trash"></use></svg> Bəli, Sil`,
          okClass: 'btn-red'
        }
      );
    },
    {
      title: `${op.icon} ${op.title}`,
      okLabel: `<svg class="icon"><use href="#i-trash"></use></svg> Davam Et`,
      okClass: 'btn-red'
    }
  );
}

window.renderDangerZone = renderDangerZone;
window.executeDangerOp = executeDangerOp;
window.openDangerZonePinModal = openDangerZonePinModal;
window.closeDangerZonePinModal = closeDangerZonePinModal;
window.confirmDangerZonePin = confirmDangerZonePin;
