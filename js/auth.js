/* ═══════════════════════════════════════════
   AUTH UI HELPERS
   PIN pad görüntüsü. Faktiki giriş məntiqi (doLogin) app.js-dədir;
   bura ilə oradan arasında dövri import olmasın deyə hadisə (event) istifadə olunur.
═══════════════════════════════════════════ */
import { state } from './state.js';

export function setRole(r, el) {
  state.role = r;
  document.querySelectorAll('.role-tab').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  clearPin();
}

export function numPress(v) {
  if (v === 'clear') { clearPin(); return; }
  if (v === 'back') { state.pinBuffer = state.pinBuffer.slice(0,-1); updatePinDots(); return; }
  if (state.pinBuffer.length >= 4) return;
  state.pinBuffer += v;
  updatePinDots();
  if (state.pinBuffer.length === 4) {
    setTimeout(() => document.dispatchEvent(new CustomEvent('auth:pin-complete')), 200);
  }
}

export function updatePinDots() {
  for (let i=0;i<4;i++) document.getElementById('d'+i).classList.toggle('filled', i < state.pinBuffer.length);
}

export function clearPin() {
  state.pinBuffer = '';
  updatePinDots();
  document.getElementById('loginErr').textContent = '';
}

export function showErr(msg) {
  document.getElementById('loginErr').textContent = msg;
  setTimeout(() => document.getElementById('loginErr').textContent = '', 3000);
}
