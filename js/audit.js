/* ═══════════════════════════════════════════
   AUDIT TRAIL
   Masa-spesifik xronoloji tarixçə (Timeline).
═══════════════════════════════════════════ */
import { state } from './state.js';
import { esc } from './utils.js';

export class AuditTrail {
  /** @param {Object} els - { modal, title, list } */
  constructor(els) {
    this.els = els;
  }

  open(tableId) {
    if (!tableId) return;
    const t = state.tables.find(x => x.id === tableId);
    this.els.title.innerHTML = `<svg class="icon"><use href="#i-clipboard"></use></svg> ${esc(t?.name || 'Masa')} — Cari Sessiya Tarixçəsi`;

    // Yalnız CARİ aktivləşmədən (sessiyadan) bəri olan qeydlər göstərilir - əvvəlki
    // (artıq bağlanmış) ziyarətlərin tarixçəsi qarışmır. Köhnə ziyarətlərin tarixçəsi
    // "Bağlanan Masalar" bölməsində, həmin ziyarətin öz arxiv qeydi ilə birlikdə saxlanılır.
    const sessionId = t?.sessionId || null;
    const relevant = sessionId
      ? state.logs.filter(l => l.details && l.details.sessionId === sessionId).slice().reverse()
      : [];

    if (!relevant.length) {
      this.els.list.innerHTML = '<p style="color:var(--text3);padding:16px 0;text-align:center;">Bu sessiyada hələ qeyd yoxdur.</p>';
    } else {
      this.els.list.innerHTML = relevant.map(l => `
        <div class="audit-timeline-item">
          <div class="audit-timeline-text">${esc(l.message)}</div>
          <div class="audit-timeline-time">${l.time} — ${l.date}</div>
        </div>
      `).join('');
    }
    this.els.modal.classList.add('open');
  }

  close() {
    this.els.modal.classList.remove('open');
  }
}
