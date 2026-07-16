/* ═══════════════════════════════════════════
   AUDIT TRAIL
   Masa-spesifik xronoloji tarixçə (Timeline).
═══════════════════════════════════════════ */
import { state } from './state.js';
import { esc, stripTableName } from './utils.js';

export class AuditTrail {
  /** @param {Object} els - { modal, title, list } */
  constructor(els) {
    this.els = els;
  }

  open(tableId) {
    if (!tableId) return;
    const t = state.tables.find(x => x.id === tableId);
    const tableName = t?.name || 'Masa';
    this.els.title.innerHTML = `<svg class="icon"><use href="#i-clipboard"></use></svg> ${esc(tableName)} — Cari Sessiya Tarixçəsi`;

    // Yalnız CARİ aktivləşmədən (sessiyadan) bəri olan qeydlər göstərilir - əvvəlki
    // (artıq bağlanmış) ziyarətlərin tarixçəsi qarışmır. Köhnə ziyarətlərin tarixçəsi
    // "Bağlanan Masalar" bölməsində, həmin ziyarətin öz arxiv qeydi ilə birlikdə saxlanılır.
    const sessionId = t?.sessionId || null;
    const relevant = sessionId
      ? state.logs.filter(l => l.details && l.details.sessionId === sessionId).slice().reverse()
      : [];

    const order = state.tableOrders[tableId];
    const firstEntry = relevant[0];
    const summaryHtml = `<div class="audit-summary-header">
      <div class="audit-summary-header__block">
        <span class="audit-summary-header__label">İlk əməliyyat</span>
        <span class="audit-summary-header__value">${firstEntry ? `${firstEntry.date} ${firstEntry.time}` : '—'}</span>
      </div>
      <div class="audit-summary-header__block" style="align-items:flex-end;">
        <span class="audit-summary-header__label">Cari cəm</span>
        <span class="audit-summary-header__value total">${(order?.total||0).toFixed(2)} ₼</span>
      </div>
    </div>`;

    if (!relevant.length) {
      this.els.list.innerHTML = summaryHtml + '<p style="color:var(--text3);padding:16px 0;text-align:center;">Bu sessiyada hələ qeyd yoxdur.</p>';
    } else {
      const rows = relevant.map(l => `
        <div class="audit-timeline-item">
          <div class="audit-timeline-time">${l.time}</div>
          <div class="audit-timeline-text">${esc(stripTableName(l.message, tableName))}</div>
        </div>
      `).join('');
      this.els.list.innerHTML = summaryHtml +
        `<div class="audit-table-head"><span class="audit-table-head__time">Saat</span><span>Əməliyyat</span></div>` +
        rows;
    }
    this.els.modal.classList.add('open');
  }

  close() {
    this.els.modal.classList.remove('open');
  }
}
