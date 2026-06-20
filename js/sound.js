/* ═══════════════════════════════════════════
   SƏS
   Bu fayl: alarm çalanda eşidilən "beep" səsini yaradır
   (Web Audio API ilə, xarici səs faylı lazım deyil).
═══════════════════════════════════════════ */
let _audioCtx = null;
function getAudioCtx() {
  if (!_audioCtx || _audioCtx.state==='closed') {
    _audioCtx = new (window.AudioContext||window.webkitAudioContext)();
  }
  if (_audioCtx.state==='suspended') _audioCtx.resume();
  return _audioCtx;
}

function playBeep() {
  try {
    const ctx  = getAudioCtx();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.85, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);

    const osc2  = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.frequency.value = 1100;
    osc2.type = 'sine';
    gain2.gain.setValueAtTime(0.5, ctx.currentTime + 0.05);
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55);
    osc2.start(ctx.currentTime + 0.05);
    osc2.stop(ctx.currentTime + 0.55);
  } catch(e){}
}
