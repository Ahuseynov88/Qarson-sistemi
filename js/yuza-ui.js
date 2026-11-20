/* ═══════════════════════════════════════════
   YUZA POS — ÜMUMİ İNTERFEYS KÖMƏKÇİLƏRİ (UI auditi, 20.11.2026)
   Məlumat və iş məntiqinə toxunmur — yalnız görünüş və rahatlıq.
   1) Mətbəx ekranında yazı ölçüsü (A+): 100% → 120% → 140% (cihazda yadda qalır)
   2) Oflayn zolağı: açıq olanda ekranlar aşağı sürüşür (düymələri örtmür) +
      göndərilməyi gözləyən sifarişlərin sayı
   3) Masa lövhəsinin rəng izahı (rəngi ayırmayan işçi üçün də aydın olsun)
═══════════════════════════════════════════ */
const $ = (id) => document.getElementById(id);
const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} }
};

/* ── 1) Mətbəx: yazı ölçüsü ── */
const KDS_STEPS = [1, 1.2, 1.4];
function applyKdsZoom(z) {
  document.documentElement.style.setProperty('--kds-zoom', String(z));
  const b = $('kdsZoomBtn');
  if (b) { b.dataset.level = String(KDS_STEPS.indexOf(z)); b.title = `Yazı ölçüsü: ${Math.round(z * 100)}%`; b.setAttribute('aria-label', b.title); }
}
function initKdsZoom() {
  const saved = Number(ls.get('yzKdsZoom'));
  applyKdsZoom(KDS_STEPS.includes(saved) ? saved : 1);
  $('kdsZoomBtn')?.addEventListener('click', () => {
    const cur = Number(ls.get('yzKdsZoom')) || 1;
    const next = KDS_STEPS[(Math.max(0, KDS_STEPS.indexOf(cur)) + 1) % KDS_STEPS.length];
    ls.set('yzKdsZoom', String(next));
    applyKdsZoom(next);
  });
}

/* ── 2) Oflayn zolağı ── */
function initOffline() {
  const banner = $('connectionStatusBanner');
  if (!banner) return;
  const txt = banner.querySelector('span');
  const base = txt ? txt.textContent : '';
  const sync = () => {
    const on = banner.classList.contains('show');
    document.body.classList.toggle('yz-offline', on);
    if (!txt) return;
    const n = Object.keys(window.staffApp?.orderCart?._pending || {}).length;
    txt.textContent = on && n ? `${base} · ${n} masanın sifarişi göndərilməyi gözləyir` : base;
  };
  new MutationObserver(sync).observe(banner, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('order:draft-changed', sync);
  sync();
}

/* ── 3) Masa lövhəsinin izahı ── */
function initTableLegend() {
  const grid = $('waiterTables');
  if (!grid || $('yzTableLegend')) return;
  const lg = document.createElement('div');
  lg.id = 'yzTableLegend';
  lg.className = 'yz-legend';
  lg.setAttribute('aria-label', 'Rənglərin mənası');
  lg.innerHTML = `<span><i class="yz-legend__d yz-legend__d--fresh"></i>30 dəq-dən az</span>
    <span><i class="yz-legend__d yz-legend__d--warn"></i>30–60 dəq</span>
    <span><i class="yz-legend__d yz-legend__d--danger"></i>60 dəq-dən çox</span>
    <span><i class="yz-legend__d yz-legend__d--billed"></i>Hesab verilib</span>`;
  grid.parentNode.insertBefore(lg, grid);
}

/* ── 4) Cədvəllər telefonda kart görünüşündə ──
   Hər xanaya sütun başlığı "data-label" kimi yazılır; CSS telefonda sətri karta çevirir. */
function labelTables(root) {
  root.querySelectorAll('table.report-table').forEach(tb => {
    const heads = [...tb.querySelectorAll('thead th')].map(th => th.textContent.trim());
    if (!heads.length) return;
    tb.classList.add('yz-cardable');
    tb.querySelectorAll('tbody tr').forEach(tr => {
      let col = 0;
      [...tr.children].forEach(td => {
        const span = Number(td.getAttribute('colspan')) || 1;
        if (span === 1 && !td.hasAttribute('data-label')) td.setAttribute('data-label', heads[col] || '');
        col += span;
      });
    });
  });
}

/* ── 5) Filtr panelləri: telefonda yığılır (axtarış görünür, qalanı "Filtr" düyməsi arxasında) ── */
function collapsibleFilters(box, label) {
  if (!box || box.dataset.yzColl) return;
  box.dataset.yzColl = '1';
  const keep = box.querySelector(':scope > input[type=text]');
  const wrap = document.createElement('div');
  wrap.className = 'yz-filter-more';
  [...box.children].filter(c => c !== keep).forEach(c => wrap.appendChild(c));
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'yz-filter-toggle';
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = `<svg class="icon"><use href="#i-settings"></use></svg> <span>${label}</span><b class="yz-filter-count" hidden></b>`;
  box.appendChild(btn);
  box.appendChild(wrap);
  // Seçilmiş dövrün qısa yazısı yığılı vəziyyətdə də görünsün
  const sum = wrap.querySelector('#reportRangeSummary');
  if (sum) { sum.classList.add('yz-filter-sum'); box.insertBefore(sum, wrap); }
  const count = () => {
    const n = [...wrap.querySelectorAll('input,select')].filter(i => i.type === 'checkbox' ? i.checked : (i.value && !(i.tagName === 'SELECT' && i.selectedIndex === 0) && i.id !== 'repBizDayHour')).length;
    const c = btn.querySelector('.yz-filter-count'); c.textContent = n; c.hidden = !n;
  };
  btn.addEventListener('click', () => { const o = box.classList.toggle('is-open'); btn.setAttribute('aria-expanded', String(o)); });
  wrap.addEventListener('change', count);
  count();
}

function initReports() {
  const host = document.getElementById('adminBody');
  if (!host) return;
  let q = 0;
  const run = () => { q = 0; labelTables(host);
    const act = host.querySelector('.report-subtab.active'); if (act && act.dataset.yzSeen !== '1') { act.dataset.yzSeen = '1'; act.scrollIntoView?.({ block: 'nearest', inline: 'center' }); }
    host.querySelectorAll('.report-subtab:not(.active)').forEach(b => { b.dataset.yzSeen = ''; });
  };
  new MutationObserver(() => { if (!q) q = requestAnimationFrame(run); }).observe(host, { childList: true, subtree: true });
  run();
  collapsibleFilters(document.querySelector('#sec-dashboard > .closed-tables-filters'), 'Tarix və saat');
  collapsibleFilters(document.querySelector('#sec-closedOrders > .closed-tables-filters'), 'Filtr');
}

/* ── 6) Telefon: bölmənin adı "←" zolağında görünür (başlıqda yer azdır) ── */
function initBackTitle() {
  const t = document.getElementById('apPageTitle'), b = document.getElementById('adminBackBtn');
  if (!t || !b) return;
  let span = b.querySelector('.yz-back-title');
  if (!span) { span = document.createElement('span'); span.className = 'yz-back-title'; b.appendChild(span); }
  const sync = () => { span.textContent = t.textContent.trim(); };
  new MutationObserver(sync).observe(t, { childList: true, characterData: true, subtree: true });
  sync();
}

function init() { initKdsZoom(); initOffline(); initTableLegend(); initReports(); initBackTitle(); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
