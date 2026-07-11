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
    this.els.title.innerHTML = `<svg class="icon"><use href="#i-clipboard"></use></svg> ${esc(t?.name || 'Masa')} — Tarixçə`;

    // state.logs yenidən-köhnəyə sıralanıb; timeline üçün xronoloji (köhnədən-yeniyə) tərtib edirik.
    // Qeyd: qlobal log yalnız son 300 qeydi saxlayır - çox işlək günlərdə köhnə tarixçə qısala bilər.
    const relevant = state.logs.filter(l => l.details && l.details.tableId === tableId).slice().reverse();

    if (!relevant.length) {
      this.els.list.innerHTML = '<p style="color:var(--text3);padding:16px 0;text-align:center;">Bu masa üçün qeyd tapılmadı.</p>';
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
