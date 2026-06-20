/* ═══════════════════════════════════════════
   LOGIN / PIN / LOGOUT
   Bu fayl: giriş ekranı məntiqi — rol seçimi, PIN daxiletmə,
   doLogin() (3 rolun yoxlanması), logout().
═══════════════════════════════════════════ */
function setRole(r, el) {
  state.role = r;
  document.querySelectorAll('.role-tab').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  clearPin();
}

function numPress(v) {
  if (v === 'clear') { clearPin(); return; }
  if (v === 'back')  { state.pinBuffer = state.pinBuffer.slice(0,-1); updatePinDots(); return; }
  if (state.pinBuffer.length >= 4) return;
  state.pinBuffer += v;
  updatePinDots();
  if (state.pinBuffer.length === 4) setTimeout(doLogin, 200);
}

function updatePinDots() {
  for (let i=0;i<4;i++) {
    document.getElementById('d'+i).classList.toggle('filled', i < state.pinBuffer.length);
  }
}

function clearPin() {
  state.pinBuffer = '';
  updatePinDots();
  document.getElementById('loginErr').textContent = '';
}

function doLogin() {
  const pin = state.pinBuffer;
  clearPin();

  if (state.role === 'admin' && String(pin) === String(ADMIN_PIN)) {
    state.user = { role:'admin', name:'Admin' };
    addLog('login','Admin sistemə daxil oldu',{type:'admin'});
    initListeners();
    showScreen('adminScreen');
    return;
  }

  if (state.role === 'kitchen' && String(pin) === String(state.kitchenPin)) {
    state.user = { role:'kitchen', name:'Mətbəx' };
    addLog('login','Mətbəx sistemə daxil oldu',{type:'kitchen'});
    initListeners();
    showScreen('kitchenScreen');
    return;
  }

  if (state.role === 'waiter') {
    R.waiters.once('value', snap => {
      const data = snap.val() || {};
      const list = Object.keys(data).map(k=>({id:k,...data[k]}));
      const w = list.find(x => x.pin === pin);
      if (!w) { showErr('PIN kod tapılmadı!'); return; }
      if (w.status === 'offline') { showErr('Hesabınız deaktivdir. Adminə müraciət edin.'); return; }
      state.user = { ...w, role:'waiter' };
      R.waiters.child(w.id).update({ status:'online', lastLogin: Date.now() });
      addLog('login', `${w.name} sistemə daxil oldu`, { waiterId: w.id });
      initListeners();
      showScreen('waiterScreen');
      document.getElementById('wName').textContent = w.name;
      document.getElementById('wAvatar').src = w.avatar;
      lockScreen();
      // Qarson istənilən şəkildə çıxsa Firebase-i xəbərdar et
      R.waiters.child(state.user.id).onDisconnect().update({
        status: 'ready',
        lastSeen: Date.now()
      });
      // Qarson bağlantını kəsəndə log yaz
      const disconnectLogRef = R.logs.push();
      disconnectLogRef.onDisconnect().set({
        type: 'logout',
        message: `${state.user.name} sistemdən çıxdı (bağlantı kəsildi)`,
        details: { waiterId: state.user.id, method: 'disconnect' },
        timestamp: Date.now(),
        time: new Date().toLocaleTimeString('az-AZ'),
        date: new Date().toLocaleDateString('az-AZ')
      });
    });
    return;
  }

  showErr('PIN kod səhvdir!');
}

function showErr(msg) {
  document.getElementById('loginErr').textContent = msg;
  setTimeout(()=>document.getElementById('loginErr').textContent='',3000);
}

function logout() {
  if (state.user?.role === 'waiter') {
    R.waiters.child(state.user.id).update({ status:'ready', lastActive: Date.now() });
    addLog('logout', `${state.user.name} sistemdən çıxdı`, { waiterId: state.user.id });
    unlockScreen();
    closeWaiterChat();
  } else if (state.user?.role === 'admin') {
    addLog('logout','Admin sistemdən çıxdı',{type:'admin'});
  } else if (state.user?.role === 'kitchen') {
    addLog('logout','Mətbəx sistemdən çıxdı',{type:'kitchen'});
  }
  stopAlarm();
  removeListeners();
  state.user = null;
  state.waiters = [];
  state.tables  = [];
  state.orders  = [];
  state.logs    = [];
  state._shownRequests = [];
  state.activeChatTableId = null;
  state.activeChatConvId = null;
  showScreen('loginScreen');
}
