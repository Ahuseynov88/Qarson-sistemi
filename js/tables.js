/* ═══════════════════════════════════════════════════════════════════════════
   Masa İdarəetmə Paneli (Table Board)
   - Real vaxt rejimində sinxronizasiya, Responsive Grid və Canlı Taymerlər.
   - Ofisiant/Kateqoriya filtri, Masa aktivləşdirmə və Bloklama məntiqi.
   ═══════════════════════════════════════════════════════════════════════════ */

import { R, db } from './firebase-service.js';
import { state } from './state.js';
import { esc, showToast, addLog } from './utils.js';
import { hasPermission, staffHasPermission } from './permissions.js';

// Offline-First işləmək üçün daxili yüngül IndexedDB Meneceri
class TablesOfflineStorage {
  constructor() {
    this.dbName = 'IpekYolu_POS_DB';
    this.dbVersion = 1;
    this.initDB();
  }

  initDB() {
    const request = indexedDB.open(this.dbName, this.dbVersion);
    request.onupgradeneeded = (e) => {
      const dbInstance = e.target.result;
      if (!dbInstance.objectStoreNames.contains('tables_cache')) {
        dbInstance.createObjectStore('tables_cache', { keyPath: 'id' });
      }
    };
  }

  async saveTablesLocally(tables) {
    return new Promise((resolve) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      request.onsuccess = (e) => {
        const dbInstance = e.target.result;
        const tx = dbInstance.transaction('tables_cache', 'readwrite');
        const store = tx.objectStore('tables_cache');
        tables.forEach(t => store.put(t));
        resolve(true);
      };
    });
  }
}

const offlineStorage = new TablesOfflineStorage();

export class TableBoard {
  /**
   * @param {Object} els - DOM Elementləri: { grid, catTabs, staffFilter, modalContainer }
   * @param {Object} callbacks - { onTableOpen(tableId) } -> Masa kliklənəndə işə düşür
   */
  constructor(els, callbacks = {}) {
    this.els = els;
    this.onTableOpen = callbacks.onTableOpen || (() => {});
    this._bindEvents();
  }

  _bindEvents() {
    this.els.grid.addEventListener('click', (e) => {
      const card = e.target.closest('[data-table-id]');
      if (!card) return;
      this._handleCardClick(card.dataset.tableId);
    });

    this.els.catTabs.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cat]');
      if (!btn) return;
      this.setCategory(btn.dataset.cat);
    });

    if (this.els.staffFilter) {
      this.els.staffFilter.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-staff-filter]');
        if (!btn) return;
        const val = btn.dataset.staffFilter;
        this.setStaffFilter(val === '_all' ? null : val);
      });
    }
  }

  _handleCardClick(tableId) {
    const t = state.tables.find(x => x.id === tableId);
    if (!t) return;

    const isMine = t.occupant === state.user.id;
    const isOther = t.occupant && !isMine;

    if (!t.occupant) {
      // Masa boşdursa təsdiq modali açılır
      this.openActivateConfirm(tableId);
    } else if (isOther && !hasPermission('waiter.view')) {
      showToast('<svg class="icon"><use href="#i-ban"></use></svg> Bu masa digər işçiyə aiddir və baxış icazəniz yoxdur!');
    } else {
      // Masa aktivdirsə Sifariş Ekranına yönləndirilir
      this.onTableOpen(tableId);
    }
  }

  getCategories() {
    const cats = new Set();
    state.tables.forEach(t => {
      if (t.category) cats.add(t.category);
    });
    return ['all', 'Aktiv Masalar', ...Array.from(cats)];
  }

  renderCatTabs() {
    const cats = this.getCategories();
    this.els.catTabs.innerHTML = cats.map(c => {
      const isActive = state._waiterCatFilter === c || (!state._waiterCatFilter && c === 'all');
      let title = c;
      if (c === 'all') title = 'Hamısı';
      return `
        <button class="admin-tab ${isActive ? 'active' : ''}" data-cat="${esc(c)}">
          ${esc(title)}
        </button>
      `;
    }).join('');
  }

  setCategory(cat) {
    state._waiterCatFilter = cat;
    this.render();
  }

  renderStaffFilter() {
    if (!this.els.staffFilter) return;
    
    if (!hasPermission('waiter.view')) {
      this.els.staffFilter.style.display = 'none';
      state._waiterStaffFilter = null;
      return;
    }

    const activeStaffList = state.staff.filter(s => staffHasPermission(s, 'table.view'));
    if (!activeStaffList.length) {
      this.els.staffFilter.style.display = 'none';
      return;
    }

    this.els.staffFilter.style.display = 'flex';
    this.els.staffFilter.innerHTML = [
      `<button class="log-filter ${!state._waiterStaffFilter ? 'active' : ''}" data-staff-filter="_all">Hamısı</button>`
    ].concat(activeStaffList.map(s =>
      `<button class="log-filter ${state._waiterStaffFilter === s.id ? 'active' : ''}" data-staff-filter="${s.id}">${esc(s.name)}</button>`
    )).join('');
  }

  setStaffFilter(staffId) {
    state._waiterStaffFilter = staffId;
    this.render();
  }

  render() {
    if (!state.user) return;
    
    this.renderCatTabs();
    this.renderStaffFilter();

    if (!state.tables || !state.tables.length) {
      this.els.grid.innerHTML = '<p style="color:var(--text3); padding: 20px;">Sistemdə göstəriləcək masa tapılmadı.</p>';
      return;
    }

    // Kateqoriyaya görə süzgəc
    let filtered = state.tables;
    if (state._waiterCatFilter && state._waiterCatFilter !== 'all') {
      if (state._waiterCatFilter === 'Aktiv Masalar') {
        filtered = state.tables.filter(t => t.occupant);
      } else {
        filtered = state.tables.filter(t => t.category === state._waiterCatFilter);
      }
    }

    // İşçiyə görə süzgəc
    if (state._waiterStaffFilter) {
      filtered = filtered.filter(t => t.occupant === state._waiterStaffFilter);
    }

    // Məlumatları lokal keşə yazırıq (Offline-First yanaşması üçün)
    offlineStorage.saveTablesLocally(state.tables);

    const canViewOthers = hasPermission('waiter.view');

    this.els.grid.innerHTML = filtered.map(t => {
      const isMine = t.occupant === state.user.id;
      const isOther = t.occupant && !isMine;
      const waiterInfo = isOther ? (state.staff.find(s => s.id === t.occupant) || { name: 'Naməlum' }) : null;
      const tableOrder = state.tableOrders ? state.tableOrders[t.id] : null;
      
      let statusClass = 'empty';
      let statusText = 'Boş Masa';

      if (isMine) {
        statusClass = 'mine';
        statusText = 'Sizin Masanız';
      } else if (isOther) {
        statusClass = canViewOthers ? 'other' : 'other locked';
        statusText = canViewOthers ? esc(waiterInfo.name) : 'Dolu Masa';
      }

      const totalAmount = tableOrder ? (tableOrder.total || 0) : 0;
      const remainingAmount = tableOrder && tableOrder.remainingAmount !== undefined ? tableOrder.remainingAmount : totalAmount;

      return `
        <div class="w-table-card ${statusClass}" data-table-id="${t.id}" style="position: relative; overflow: hidden;">
          <div class="w-table-name" style="font-size: 18px; font-weight: 700;">${esc(t.name)}</div>
          <div class="w-table-status" style="margin-top: 4px; font-size: 12px; opacity: 0.9;">${statusText}</div>
          
          ${t.occupant ? `
            <div style="font-size: 12px; color: var(--text2); margin-top: 8px; display: flex; align-items: center; gap: 4px; justify-content: center;">
              <svg class="icon" style="width:1.1em; height:1.1em;"><use href="#i-clock"></use></svg>
              <span class="w-table-timer" data-since="${t.activatedAt || ''}">--:--</span>
            </div>
          ` : ''}

          ${totalAmount > 0 ? `
            <div style="font-size: 13px; color: var(--orange); font-weight: 700; margin-top: 8px; background: rgba(0,0,0,0.05); padding: 4px; border-radius: 6px;">
              <svg class="icon" style="width:1em;height:1em; vertical-align:middle;"><use href="#i-food"></use></svg> 
              Balans: ${totalAmount.toFixed(2)} ₼
              ${remainingAmount !== totalAmount ? `<br><span style="font-size:10px; color:var(--red);">Qalan: ${remainingAmount.toFixed(2)} ₼</span>` : ''}
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    this.startTimers();
  }

  startTimers() {
    this.updateTimers();
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => this.updateTimers(), 1000);
  }

  updateTimers() {
    document.querySelectorAll('.w-table-timer').forEach(el => {
      const since = parseInt(el.dataset.since, 10);
      if (!since) { el.textContent = '--:--'; return; }
      
      const diffSec = Math.max(0, Math.floor((Date.now() - since) / 1000));
      const h = Math.floor(diffSec / 3600);
      const m = Math.floor((diffSec % 3600) / 60);
      const s = diffSec % 60;

      el.textContent = h > 0 
        ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
        : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    });
  }

  openActivateConfirm(tableId) {
    const t = state.tables.find(x => x.id === tableId);
    if (!t) return;

    const modalHtml = `
      <div class="custom-modal-backdrop" id="activate-modal" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:9999;">
        <div class="custom-modal-content" style="background:var(--card); padding:24px; border-radius:12px; max-width:400px; width:90%; text-align:center; border:1px solid var(--border);">
          <h3 style="margin-bottom:12px;">Masanı Aktivləşdir</h3>
          <p style="color:var(--text2); font-size:14px; margin-bottom:20px;">"${esc(t.name)}" masasını öz adınıza aktivləşdirmək və yeni sifariş açmaq istəyirsiniz?</p>
          <div style="display:flex; gap:10px; justify-content:center;">
            <button id="btn-activate-cancel" style="background:var(--border); color:var(--text); padding:10px 16px; border:none; border-radius:8px; cursor:pointer;">İmtina</button>
            <button id="btn-activate-confirm" style="background:var(--green); color:white; padding:10px 16px; border:none; border-radius:8px; cursor:pointer; font-weight:600;">Təsdiqlə</button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    document.getElementById('btn-activate-cancel').addEventListener('click', () => {
      document.getElementById('activate-modal').remove();
    });

    document.getElementById('btn-activate-confirm').addEventListener('click', async () => {
      try {
        await R.tables.child(tableId).update({
          occupant: state.user.id,
          activatedAt: Date.now()
        });
        
        // Audit Trail bazasına qeyd yazırıq
        await addLog('table', `${state.user.name} "${t.name}" masasını açdı.`, { tableId, waiterId: state.user.id });
        
        showToast(`<svg class="icon"><use href="#i-check"></use></svg> "${t.name}" uğurla aktivləşdirildi.`);
        document.getElementById('activate-modal').remove();
      } catch (err) {
        showToast('<svg class="icon"><use href="#i-error"></use></svg> Şəbəkə xətası! Masa aktivləşdirilə bilmədi.');
      }
    });
  }

  destroy() {
    if (this.timerInterval) clearInterval(this.timerInterval);
  }
}
