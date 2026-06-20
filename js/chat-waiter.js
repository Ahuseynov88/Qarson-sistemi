/* ═══════════════════════════════════════════
   QARSON ÇAT PANELİ
   Bu fayl: qarsonun müştəri ilə yazışdığı alt panel —
   yeni mesajları dinləmək, paneli açıb-bağlamaq, cavab göndərmək.
   Firebase: /chats/{tableId}/messages/{msgId}
═══════════════════════════════════════════ */
function initWaiterChatListener() {
  db.ref('chats').on('value', snap => {
    const data = snap.val() || {};
    Object.keys(data).forEach(tableId => {
      const msgs = toArr(data[tableId].messages || {});
      const t = state.tables.find(x=>x.id===tableId);
      if (!t || t.occupant !== state.user?.id) return;
      const unread = msgs.filter(m=>m.sender==='customer'&&!m.readByWaiter&&Date.now()-m.createdAt<60000);
      if (unread.length && state.activeChatTableId !== tableId) {
        const lastUnread = unread[unread.length-1];
        if (!state._shownRequests.includes('chat_'+lastUnread.id)) {
          state._shownRequests.push('chat_'+lastUnread.id);
          showToast(`💬 ${t.name}: Yeni mesaj!`);
          openWaiterChatForTable(tableId, null);
        }
      }
    });
    if (state.activeChatTableId) {
      renderWaiterChatMsgs(data[state.activeChatTableId]?.messages || {});
    }
  });
}

function openWaiterChatForTable(tableId, requestId) {
  const t = state.tables.find(x=>x.id===tableId);
  state.activeChatTableId = tableId;
  state.activeChatConvId  = requestId;
  document.getElementById('waiterChatTitle').textContent = `💬 ${t ? t.name : 'Müştəri'} — Mesajlar`;
  document.getElementById('waiterChatPanel').classList.add('show');
  db.ref(`chats/${tableId}/messages`).once('value', snap => {
    renderWaiterChatMsgs(snap.val() || {});
  });
}

function closeWaiterChat() {
  document.getElementById('waiterChatPanel').classList.remove('show');
  state.activeChatTableId = null;
  state.activeChatConvId  = null;
  document.getElementById('waiterChatMsgList').innerHTML = '';
}

function renderWaiterChatMsgs(msgsObj) {
  const msgs = toArr(msgsObj).sort((a,b)=>a.createdAt-b.createdAt);
  const el   = document.getElementById('waiterChatMsgList');
  el.innerHTML = msgs.map(m=>`
    <div class="chat-bubble ${m.sender}">
      ${esc(m.text)}<span style="font-size:10px;opacity:.6;margin-left:8px;">${m.time||''}</span>
    </div>
  `).join('');
  el.scrollTop = el.scrollHeight;
  msgs.filter(m=>m.sender==='customer'&&!m.readByWaiter).forEach(m=>{
    db.ref(`chats/${state.activeChatTableId}/messages/${m.id}`).update({ readByWaiter: true });
  });
}

function sendWaiterReply() {
  const text = document.getElementById('waiterChatInput').value.trim();
  if (!text || !state.activeChatTableId) return;
  const w = state.user;
  const ref = db.ref(`chats/${state.activeChatTableId}/messages`).push();
  ref.set({
    sender: 'waiter',
    senderName: w.name,
    text,
    time: new Date().toLocaleTimeString('az-AZ'),
    createdAt: Date.now()
  });
  const t = state.tables.find(x=>x.id===state.activeChatTableId);
  addLog('chat',`${w.name} "${t?t.name:'masa'}" müştərisinə cavab verdi: ${text}`,{ waiterId:w.id, tableId:state.activeChatTableId });
  document.getElementById('waiterChatInput').value = '';
}
