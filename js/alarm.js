/* ═══════════════════════════════════════════
   ALARM SİSTEMİ
   Bu fayl: qarsona gələn bütün bildirişlərin (sifariş hazırdır,
   müştəri çağırır, hesab istəyi, mesaj) ekrana çıxması və
   "Qəbul Etdim" düyməsinin işləməsi.
═══════════════════════════════════════════ */
const ALARM_THEMES = {
  order:     { bg:'rgba(231,76,60,.97)',     icon:'🍽️',  title:'Sifariş Hazırdır!',     btnColor:'#e74c3c' },
  call:      { bg:'rgba(241,196,15,.97)',    icon:'🔔',  title:'Müştəri Sizi Çağırır!', btnColor:'#f39c12' },
  bill_cash: { bg:'rgba(46,204,113,.97)',    icon:'💵',  title:'Hesab İstəyi (Nağd)',   btnColor:'#27ae60' },
  bill_pos:  { bg:'rgba(52,152,219,.97)',    icon:'💳',  title:'Hesab İstəyi (POS)',    btnColor:'#2980b9' },
  message:   { bg:'rgba(243,156,18,.97)',    icon:'💬',  title:'Yeni Mesaj!',           btnColor:'#e67e22' },
  default:   { bg:'rgba(142,68,173,.97)',    icon:'📢',  title:'Bildiriş!',             btnColor:'#8e44ad' }
};

function showAlarmOverlay(type, subText) {
  const theme = ALARM_THEMES[type] || ALARM_THEMES.default;
  const overlay = document.getElementById('alarmOverlay');
  overlay.style.background = theme.bg;
  document.getElementById('alarmIcon').textContent  = theme.icon;
  document.getElementById('alarmTitle').textContent = theme.title;
  document.getElementById('alarmSub').textContent   = subText;
  document.getElementById('alarmAcceptBtn').style.color = theme.btnColor;
  overlay.classList.add('show');
}

function checkIncomingOrders() {
  const pending = state.orders.filter(o=>o.waiterId===state.user?.id&&o.status==='pending');
  if (pending.length && !state.alarm) {
    triggerOrderAlarm(pending[0]);
  }
}

function triggerOrderAlarm(order) {
  if (state.alarm) return;
  state.alarm     = order.id;
  state.alarmType = 'order';
  if (state.alarmInterval) { clearInterval(state.alarmInterval); state.alarmInterval=null; }
  showAlarmOverlay('order', 'Sifarişiniz hazırdır!');
  playBeep();
  state.alarmInterval = setInterval(playBeep, 700);
  if ('vibrate' in navigator) navigator.vibrate([400,200,400,200,400]);
  if ('speechSynthesis' in window) {
    const u = new SpeechSynthesisUtterance('Sifariş hazırdır');
    u.lang='az-AZ'; window.speechSynthesis.speak(u);
  }
}

function triggerCustomerAlarm(request) {
  if (state._shownRequests.includes(request.id)) return;
  state._shownRequests.push(request.id);

  if (state.alarm && state.alarmType === 'order') {
    stopAlarm(false);
  }
  if (state.alarm) return;

  state.alarm     = request.id;
  state.alarmType = 'customer';
  window._currentRequestId = request.id;

  if (state.alarmInterval) { clearInterval(state.alarmInterval); state.alarmInterval=null; }
  showAlarmOverlay(request.type || 'default', request.message);
  playBeep();
  state.alarmInterval = setInterval(playBeep, 700);
  if ('vibrate' in navigator) navigator.vibrate([600,200,600,200,600]);

  if (request.type === 'message') {
    openWaiterChatForTable(request.tableId, request.id);
  }
}

function acceptAlarm() {
  if (!state.alarm) return;

  if (state.alarmType === 'order') {
    R.orders.child(state.alarm).update({ status:'accepted', acceptedAt:Date.now() });
    addLog('order',`${state.user.name} sifarişi qəbul etdi`,{ orderId:state.alarm, waiterId:state.user.id });
  } else if (state.alarmType === 'customer') {
    const reqType = window._currentRequestId;
    if (reqType) {
      db.ref('customerRequests').child(reqType).update({ status:'accepted', acceptedAt:Date.now() });
      addLog('customer',`${state.user.name} müştəri tələbini qəbul etdi`,{ requestId:reqType, waiterId:state.user.id });
    }
    window._currentRequestId = null;
  }

  stopAlarm(true);
  showToast('✅ Qəbul edildi!');

  setTimeout(()=>{
    const next = state.orders.filter(o=>o.waiterId===state.user.id&&o.status==='pending');
    if (next.length) triggerOrderAlarm(next[0]);
  }, 600);
}

// clearAll=true — hər şeyi sıfırla, false — yalnız interval dayandır
function stopAlarm(clearAll=true) {
  if (state.alarmInterval) { clearInterval(state.alarmInterval); state.alarmInterval=null; }
  window.speechSynthesis?.cancel();
  if (clearAll) {
    state.alarm     = null;
    state.alarmType = null;
    document.getElementById('alarmOverlay').classList.remove('show');
  }
}

/* ═══════════════════════════════════════════
   MÜŞTƏRİ TƏLƏBLƏRİ LİSTENER
   (Bura, alarm-la sıx bağlı olduğu üçün bu faylda saxlanıb)
═══════════════════════════════════════════ */
function initCustomerRequestListener() {
  db.ref('customerRequests').orderByChild('status').equalTo('pending').on('value', snap => {
    const data = snap.val() || {};
    const list = Object.keys(data).map(k=>({id:k,...data[k]}));

    if (state.user?.role === 'staff') {
      list.forEach(r => {
        const t = state.tables.find(x=>x.id===r.tableId);
        if (t && t.occupant === state.user.id) {
          triggerCustomerAlarm(r);
        }
      });
    }

    if (state.user?.role === 'admin') renderFeedbackSection();
  });

  db.ref('feedbacks').orderByChild('createdAt').limitToLast(50).on('value', snap => {
    const data = snap.val() || {};
    const list = Object.keys(data).map(k=>({id:k,...data[k]})).reverse();
    if (state.user?.role === 'admin') state._feedbacks = list;
  });
}
