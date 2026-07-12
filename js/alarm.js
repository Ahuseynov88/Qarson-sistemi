/* ═══════════════════════════════════════════
   ALARM SİSTEMİ
   Yeni sifariş / müştəri çağırışı bildirişləri (staff + kitchen + admin ortaq istifadə edir).
═══════════════════════════════════════════ */
import { R, db } from './firebase-service.js';
import { state } from './state.js';
import { addLog, showToast } from './utils.js';

export const ALARM_THEMES = {
  order:     { bg:'rgba(231,76,60,.97)', icon:'<svg class="icon"><use href="#i-utensils"></use></svg>', title:'Sifariş Hazırdır!', btnColor:'#e74c3c' },
  call:      { bg:'rgba(241,196,15,.97)', icon:'<svg class="icon"><use href="#i-bell"></use></svg>', title:'Müştəri Sizi Çağırır!', btnColor:'#f39c12' },
  bill_cash: { bg:'rgba(46,204,113,.97)', icon:'<svg class="icon"><use href="#i-cash"></use></svg>', title:'Hesab İstəyi (Nağd)', btnColor:'#27ae60' },
  bill_pos:  { bg:'rgba(52,152,219,.97)', icon:'<svg class="icon"><use href="#i-card"></use></svg>', title:'Hesab İstəyi (POS)', btnColor:'#2980b9' },
  message:   { bg:'rgba(243,156,18,.97)', icon:'<svg class="icon"><use href="#i-chat"></use></svg>', title:'Yeni Mesaj!', btnColor:'#e67e22' },
  default:   { bg:'rgba(142,68,173,.97)', icon:'<svg class="icon"><use href="#i-megaphone"></use></svg>', title:'Bildiriş!', btnColor:'#8e44ad' }
};

let _audioCtx = null;

export function showAlarmOverlay(type, subText) {
  const theme = ALARM_THEMES[type] || ALARM_THEMES.default;
  const overlay = document.getElementById('alarmOverlay');
  overlay.style.background = theme.bg;
  document.getElementById('alarmIcon').innerHTML = theme.icon;
  document.getElementById('alarmTitle').textContent = theme.title;
  document.getElementById('alarmSub').textContent = subText;
  document.getElementById('alarmAcceptBtn').style.color = theme.btnColor;
  overlay.classList.add('show');
}

export function checkIncomingOrders() {
  const pending = state.orders.filter(o=>o.waiterId===state.user?.id&&o.status==='pending');
  if (pending.length && !state.alarm) triggerOrderAlarm(pending[0]);
}

export function triggerOrderAlarm(order) {
  if (state.alarm) return;
  state.alarm = order.id;
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

export function triggerCustomerAlarm(request) {
  if (state._shownRequests.includes(request.id)) return;
  state._shownRequests.push(request.id);
  if (state.alarm && state.alarmType === 'order') stopAlarm(false);
  if (state.alarm) return;
  state.alarm = request.id;
  state.alarmType = 'customer';
  window._currentRequestId = request.id;
  if (state.alarmInterval) { clearInterval(state.alarmInterval); state.alarmInterval=null; }
  showAlarmOverlay(request.type || 'default', request.message);
  playBeep();
  state.alarmInterval = setInterval(playBeep, 700);
  if ('vibrate' in navigator) navigator.vibrate([600,200,600,200,600]);
  if (request.type === 'message') document.dispatchEvent(new CustomEvent('alarm:open-chat', { detail: { tableId: request.tableId, requestId: request.id } }));
}

export function acceptAlarm() {
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
  showToast('<svg class="icon"><use href="#i-check"></use></svg>Qəbul edildi!');
  setTimeout(()=>{
    const next = state.orders.filter(o=>o.waiterId===state.user.id&&o.status==='pending');
    if (next.length) triggerOrderAlarm(next[0]);
  }, 600);
}

export function stopAlarm(clearAll=true) {
  if (state.alarmInterval) { clearInterval(state.alarmInterval); state.alarmInterval=null; }
  window.speechSynthesis?.cancel();
  if (clearAll) {
    state.alarm = null;
    state.alarmType = null;
    document.getElementById('alarmOverlay').classList.remove('show');
  }
}

export function getAudioCtx() {
  if (!_audioCtx || _audioCtx.state==='closed') _audioCtx = new (window.AudioContext||window.webkitAudioContext)();
  if (_audioCtx.state==='suspended') _audioCtx.resume();
  return _audioCtx;
}

export function playBeep() {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880; osc.type = 'sine';
    gain.gain.setValueAtTime(0.85, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.5);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.connect(gain2); gain2.connect(ctx.destination);
    osc2.frequency.value = 1100; osc2.type = 'sine';
    gain2.gain.setValueAtTime(0.5, ctx.currentTime + 0.05);
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55);
    osc2.start(ctx.currentTime + 0.05); osc2.stop(ctx.currentTime + 0.55);
  } catch(e){}
}

// Mövcud HTML-də onclick="acceptAlarm()" istifadə olunur
window.acceptAlarm = acceptAlarm;
