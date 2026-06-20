/* ═══════════════════════════════════════════
   MÜŞTƏRİ PANELİ
   Bu fayl: QR oxudan müştərinin gördüyü hər şey — masa izləmə,
   qarson widget-i, menyu düyməsi, çağır/hesab düymələri, çat,
   şikayət/təklif forması.
═══════════════════════════════════════════ */
function checkCustomerMode() {
  const params  = new URLSearchParams(location.search);
  const tableId = params.get('table');
  if (!tableId) return;

  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('customerScreen').classList.add('active');

  R.tables.child(tableId).on('value', snap => {
    const t = snap.val();

    if (!t) {
      showCustomerClosedScreen('❌ Masa tapılmadı');
      return;
    }

    if (t.occupant) {
      document.getElementById('customerInactiveOverlay').classList.remove('show');
      document.getElementById('customerTableName').textContent = t.name || 'Masa';
      showCustomerWaiterCard(t.occupant);
      if (!window._customerTableId) {
        window._customerTableId   = tableId;
        window._customerTableData = t;
        initCustomerChat(tableId);
      }
      return;
    }

    document.getElementById('customerTableName').textContent = t.name || 'Masa';
    document.getElementById('customerInactiveOverlay').classList.add('show');

    if (window._customerTableId) {
      window._customerTableId   = null;
      window._customerTableData = null;
      db.ref('chats/' + tableId).off();
      showCustomerClosedScreen('🙏 Masa bağlandı. Yenidən gəlməyinizi gözləyirik!');
    }
  });
}

function showCustomerWaiterCard(waiterId) {
  if (!waiterId) return;
  R.waiters.child(waiterId).once('value', snap => {
    const w = snap.val();
    if (!w) return;
    const card   = document.getElementById('custWaiterCard');
    const avatar = document.getElementById('custWaiterAvatar');
    const name   = document.getElementById('custWaiterName');
    if (!card) return;
    const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(w.name||'?')}&background=2ecc71&color=fff&size=200`;
    avatar.src = w.avatar || fallback;
    avatar.onerror = () => { avatar.src = fallback; };
    name.textContent = w.name || '—';
    card.style.display = 'flex';
  });
}

function openCustomerPanel(tableId, tableData) {
  window._customerTableId   = tableId;
  window._customerTableData = tableData;
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('customerScreen').classList.add('active');
  document.getElementById('customerTableName').textContent = tableData.name || 'Masa';
}

function showCustomerClosedScreen(msg) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const screen = document.getElementById('customerScreen');
  screen.classList.add('active');
  const wrap = screen.querySelector('div');
  if (wrap) {
    wrap.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;
                  justify-content:center;min-height:100vh;text-align:center;padding:30px;">
        <div style="font-size:72px;margin-bottom:20px;">🙏</div>
        <p style="color:#eee;font-size:20px;font-weight:600;line-height:1.6;">${msg}</p>
      </div>`;
  }
}

function openMenu() {
  db.ref('settings/menuUrl').once('value', snap => {
    const url = snap.val();
    if (!url) {
      showCustomerToast('ℹ️ Menyu hələ əlavə edilməyib');
      return;
    }
    window.open(url, '_blank');
  });
}

function customerAction(type) {
  const tableId = window._customerTableId;
  const t = window._customerTableData;
  if (!tableId || !t) return;

  const currentTable = state.tables.find(x=>x.id===tableId);
  const occupantId = currentTable?.occupant || t.occupant;

  const messages = {
    call:      { text:`${t.name} sizi çağırır! 🔔`,        type:'call' },
    bill_cash: { text:`${t.name} nağd hesab istəyir 💵`,    type:'bill_cash' },
    bill_pos:  { text:`${t.name} POS hesab istəyir 💳`,     type:'bill_pos' }
  };
  const m = messages[type];
  if (!m) return;

  db.ref('customerRequests').push({
    tableId,
    tableName: t.name,
    type: m.type,
    message: m.text,
    waiterId: occupantId || null,
    status: 'pending',
    time: new Date().toLocaleTimeString('az-AZ'),
    createdAt: Date.now()
  });

  addLog('customer',`"${t.name}" masasından "${type}" tələbi`,{ tableId, type });

  const icons = { call:'🔔', bill_cash:'💵', bill_pos:'💳' };
  showCustomerToast(`${icons[type]||'📢'} Bildiriş göndərildi!`);
}

/* ── Müştəri çat ── */
function initCustomerChat(tableId) {
  db.ref(`chats/${tableId}/messages`).on('value', snap => {
    renderCustomerChatMsgs(snap.val() || {});
  });
}

function renderCustomerChatMsgs(msgsObj) {
  const msgs = toArr(msgsObj).sort((a,b)=>a.createdAt-b.createdAt);
  const el   = document.getElementById('custMsgList');
  el.innerHTML = msgs.map(m=>`
    <div class="cust-bubble ${m.sender}">
      ${m.sender==='waiter'?`<span style="font-size:11px;font-weight:700;display:block;margin-bottom:2px;">${esc(m.senderName||'Qarson')}</span>`:''}
      ${esc(m.text)}<span style="font-size:10px;opacity:.6;margin-left:8px;">${m.time||''}</span>
    </div>
  `).join('');
  el.scrollTop = el.scrollHeight;
}

function sendCustomerMsg() {
  const text    = document.getElementById('custMsgInput').value.trim();
  const tableId = window._customerTableId;
  const t       = window._customerTableData;
  if (!text || !tableId) return;

  const ref = db.ref(`chats/${tableId}/messages`).push();
  ref.set({
    sender: 'customer',
    text,
    time: new Date().toLocaleTimeString('az-AZ'),
    createdAt: Date.now(),
    readByWaiter: false
  });

  const currentTable = state.tables.find(x=>x.id===tableId);
  db.ref('customerRequests').push({
    tableId,
    tableName: t.name,
    type: 'message',
    message: `${t.name}: ${text}`,
    waiterId: currentTable?.occupant || t.occupant || null,
    status: 'pending',
    time: new Date().toLocaleTimeString('az-AZ'),
    createdAt: Date.now()
  });

  addLog('chat',`"${t.name}" masasından mesaj: ${text}`,{ tableId });

  document.getElementById('custMsgInput').value = '';
  showCustomerToast('✅ Mesaj göndərildi!');
}

function sendFeedback() {
  const msg     = document.getElementById('feedbackInput').value.trim();
  const tableId = window._customerTableId;
  const t       = window._customerTableData;
  if (!msg) return;

  db.ref('feedbacks').push({
    tableId,
    tableName: t ? t.name : '?',
    message: msg,
    time: new Date().toLocaleTimeString('az-AZ'),
    date: new Date().toLocaleDateString('az-AZ'),
    createdAt: Date.now(),
    status: 'new'
  });

  addLog('customer',`"${t?t.name:'?'}" masasından şikayət/təklif: ${msg}`,{ tableId });

  document.getElementById('feedbackInput').value = '';
  showCustomerToast('✅ Şikayət/təklifiniz qeyd edildi!');
}
