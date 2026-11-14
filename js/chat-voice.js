/* ═══════════════════════════════════════════
   MÜŞTƏRİ ↔ OFİSİANT SƏSLİ MESAJ (Racia müştəri panelində)
   Mövcud "Ofisiantla Əlaqə" söhbətinə mikrofon düyməsi əlavə edir.

   • Müştəri mikrofonu basıb saxlayır → səs masanı açan ofisianta gedir
     (ofisiantda Racia kimi avtomatik səslənir, söhbət pəncərəsi açılır)
   • Ofisiant söhbət pəncərəsində mikrofonla səslə cavab verir → müştəridə avtomatik səslənir
   • Yazılı mesajlar əvvəlki kimi işləyir
   • Rəhbər bütün müştəri səslərini Racia bölməsində görür/dinləyir
   • Müştəri üçün: 20 saniyədə bir mesaj, maks. 15 saniyə; YALNIZ masa aktiv olanda
     (masa bağlananda mikrofon gizlənir; baza qaydaları da masa açıq deyilsə yazmağa icazə vermir)

   Saxlama: səs raciaAudio/{id}, siyahı raciaMeta/{id} (3 gün sonra silinir),
   söhbətdə isə chats/{masa}/messages/{id} = { type:'voice', voiceId, dur, ... } sətri.
═══════════════════════════════════════════ */
import { db } from './firebase-service.js';
import { state } from './state.js';
import { esc, showToast, showCustomerToast, addLog } from './utils.js';
import { initVoiceCore, bindHold, saveVoice, enqueue, playNow, cancelHold, ICON, MIC_SVG, PLAY_SVG } from './voice-core.js';

const CUST_GAP_MS = 20000;     // müştəri iki səsli mesaj arasında gözləməli olduğu vaxt
const GAP_KEY = 'cv_lastSent_';

let custSeen = null;           // müştəri ekranında artıq görülmüş səsli mesajlar
let custLastSent = 0;

const nowTime = () => new Date().toLocaleTimeString('az-AZ');
const fmtDur = (d) => `0:${String(Math.max(1, Math.round(Number(d) || 0))).padStart(2, '0')}`;

/* ── Söhbət balonu (customer.js render edərkən çağırır) ── */
export function voiceBubbleHtml(m) {
  const who = m.sender === 'customer' ? 'Müştəri' : (m.senderName || 'Ofisiant');
  return `<button type="button" class="cv-voice" data-cv-play="${esc(m.voiceId || m.id)}" data-cv-who="${esc(who)}" aria-label="Səsli mesajı dinlə">
    <span class="cv-voice__play">${PLAY_SVG}</span><span class="cv-voice__wave"><i></i><i></i><i></i><i></i><i></i></span><span class="cv-voice__dur">${fmtDur(m.dur)}</span>
  </button>`;
}

// Balondakı "Dinlə" düyməsi — həm müştəri, həm ofisiant ekranında
document.addEventListener('click', (e) => {
  const b = e.target.closest?.('[data-cv-play]');
  if (!b) return;
  e.preventDefault();
  const onCustomer = !!document.getElementById('customerScreen')?.classList.contains('active');
  playNow({ id: b.dataset.cvPlay, title: b.dataset.cvWho || '', sub: 'Səsli mesaj' }, onCustomer ? showCustomerToast : showToast);
});

function addMicButton(row, kind) {
  if (!row || row.querySelector('[data-cv-mic]')) return null;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'cv-mic';
  b.setAttribute('data-cv-mic', kind);
  b.setAttribute('aria-label', 'Səsli mesaj — basıb saxlayın');
  b.title = 'Basıb saxlayın, danışın, buraxın';
  b.innerHTML = MIC_SVG;
  row.insertBefore(b, row.firstChild);
  return b;
}

/* ═══════════════ MÜŞTƏRİ TƏRƏFİ ═══════════════ */

// customer.js → masa aktiv olanda çağırır
export function initCustomerVoice(tableId) {
  initVoiceCore();
  custSeen = null;
  try { custLastSent = Number(sessionStorage.getItem(GAP_KEY + tableId)) || 0; } catch (e) { custLastSent = 0; }
  const row = document.querySelector('#customerScreen .cust-input-row');
  const btn = addMicButton(row, 'cust');
  if (btn) {
    bindHold(row, '[data-cv-mic]', customerOpts);
    const hint = document.createElement('p');
    hint.className = 'cv-hint';
    hint.innerHTML = `${MIC_SVG}<span>Səsli mesaj üçün mikrofonu <b>basıb saxlayın</b>, danışın, buraxın</span>`;
    row.insertAdjacentElement('afterend', hint);
  }
  setCustomerVoiceActive(true);
}

// Masa bağlananda mikrofon gizlənir, yazı varsa dayandırılır
export function setCustomerVoiceActive(on) {
  const row = document.querySelector('#customerScreen .cust-input-row');
  const btn = row?.querySelector('[data-cv-mic]');
  if (btn) btn.hidden = !on;
  const hint = row?.parentElement?.querySelector('.cv-hint');
  if (hint) hint.hidden = !on;
  if (!on) cancelHold();
}

function customerOpts() {
  const tableId = window._customerTableId;
  const t = window._customerTableData;
  if (!tableId || !t) { showCustomerToast(ICON('i-warning') + ' Masa aktiv deyil'); return null; }
  const wait = CUST_GAP_MS - (Date.now() - custLastSent);
  if (wait > 0) {
    showCustomerToast(`${ICON('i-clock')} ${Math.ceil(wait / 1000)} saniyə sonra yenidən göndərə bilərsiniz`);
    return null;
  }
  const waiterName = document.getElementById('custWaiterName')?.textContent?.trim();
  return {
    label: '→ ' + (waiterName && waiterName !== '—' ? waiterName : 'Ofisiant'),
    toast: showCustomerToast,
    onSend: (dataUrl, dur, mime) => sendFromCustomer(tableId, t, dataUrl, dur, mime)
  };
}

async function sendFromCustomer(tableId, t, dataUrl, dur, mime) {
  custLastSent = Date.now();
  try { sessionStorage.setItem(GAP_KEY + tableId, String(custLastSent)); } catch (e) {}
  try {
    // Masanın ofisiantını göndərmə anında yoxlayırıq (masa bu arada bağlana bilər)
    const occ = (await db.ref(`tables/${tableId}/occupant`).once('value')).val();
    if (!occ || window._customerTableId !== tableId) { custLastSent = 0; showCustomerToast(ICON('i-warning') + ' Masa artıq bağlanıb'); return; }
    const waiterName = document.getElementById('custWaiterName')?.textContent?.trim() || 'Ofisiant';
    const createdAt = Date.now();
    await saveVoice(dataUrl, dur, mime,
      { from: 't:' + tableId, fromName: `${t.name} · müştəri`, to: occ, toName: waiterName, tableId, sid: t.sessionId || null },
      (key, meta) => ({
        [`chats/${tableId}/messages/${key}`]: {
          sender: 'customer', type: 'voice', voiceId: key, dur: meta.dur, text: '🎤 Səsli mesaj',
          time: nowTime(), createdAt, readByWaiter: false, sessionId: t.sessionId || null
        }
      }));
    addLog('chat', `"${t.name}" masasından səsli mesaj (${Math.round(dur)} san)`, { tableId });
    showCustomerToast(ICON('i-check') + ' Səsli mesaj göndərildi!');
  } catch (err) {
    console.warn('[Səsli söhbət] Göndərilmədi:', err);
    custLastSent = 0;
    try { sessionStorage.removeItem(GAP_KEY + tableId); } catch (e) {}
    showCustomerToast(ICON('i-error') + ' Göndərilmədi, yenidən cəhd edin');
  }
}

// customer.js → renderCustomerChatMsgs() hər yeniləmədə çağırır (cari sessiyanın mesajları)
export function onCustomerChatMsgs(msgs) {
  const voices = msgs.filter(m => m.type === 'voice');
  if (!custSeen) { custSeen = new Set(voices.map(m => m.id)); return; } // ilk yükləmə — köhnələr səslənmir
  voices.forEach(m => {
    if (custSeen.has(m.id)) return;
    custSeen.add(m.id);
    if (m.sender === 'waiter') enqueue({ id: m.voiceId || m.id, title: m.senderName || 'Ofisiant', sub: 'Sizə' });
  });
}

/* ═══════════════ OFİSİANT TƏRƏFİ ═══════════════ */

// customer.js → initWaiterChatListener() içindən çağırılır (yalnız işçi girişində)
export function initWaiterVoice() {
  initVoiceCore();
  const row = document.querySelector('#waiterChatPanel .chat-input-row');
  if (!addMicButton(row, 'waiter')) return;
  bindHold(row, '[data-cv-mic]', waiterOpts);
}

function waiterOpts() {
  const tableId = state.activeChatTableId;
  const t = state.tables.find(x => x.id === tableId);
  const w = state.user;
  if (!tableId || !t || !w) return null;
  if (!t.occupant) { showToast(ICON('i-warning') + ' Masa bağlıdır'); return null; }
  return {
    label: '→ ' + t.name + ' (müştəri)',
    onSend: (dataUrl, dur, mime) => {
      const createdAt = Date.now();
      saveVoice(dataUrl, dur, mime,
        { from: w.id || 'admin', fromName: w.name || 'İşçi', to: 't:' + tableId, toName: `${t.name} · müştəri`, tableId, sid: t.sessionId || null },
        (key, meta) => ({
          [`chats/${tableId}/messages/${key}`]: {
            sender: 'waiter', senderName: w.name || 'İşçi', type: 'voice', voiceId: key, dur: meta.dur,
            text: '🎤 Səsli mesaj', time: nowTime(), createdAt, sessionId: t.sessionId || null
          }
        }))
        .then(() => {
          addLog('chat', `${w.name} "${t.name}" müştərisinə səsli cavab verdi (${Math.round(dur)} san)`, { waiterId: w.id, tableId });
          showToast(ICON('i-check') + ` Səsli cavab göndərildi → ${esc(t.name)}`);
        })
        .catch(err => {
          console.warn('[Səsli söhbət] Göndərilmədi:', err);
          showToast(ICON('i-error') + ' Göndərilmədi: ' + esc(err?.message || 'xəta'));
        });
    }
  };
}
