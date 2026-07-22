/* ═══════════════════════════════════════════
   MÜŞTƏRİ TANIMA & LOYALLIQ MODULU
   Restoran QR sistemi üçün müştəri tanıma, qeydiyyat, bonus və referral (dostunu
   dəvət et) idarəsi. Bu modul MÖVCUD sistemi (customer.js-dəki menyu/çat/hesab
   funksiyaları) POZMUR, tamamilə ayrıca, müstəqil qat kimi işləyir.

   QEYD: "loyaltyCustomers" node-u MÖVCUD "customers" node-undan (nisyə/kredit
   hesabları üçün istifadə olunan, admin.js-də idarə olunan) BİLƏRƏKDƏN AYRIDIR -
   iki fərqli konsepsiyadır, qarışdırılmamalıdır.
═══════════════════════════════════════════ */
import { R, db } from './firebase-service.js';
import { showToast } from './utils.js';

const TOKEN_KEY = 'qarson_loyalty_token'; // localStorage: { type: 'guest'|'customer', id }
const PENDING_REF_KEY = 'qarson_pending_ref'; // sessionStorage: referral kodu (linklə gələnlər üçün)

let _currentTableId = null;
let _currentCustomer = null; // { id, type: 'guest'|'customer', data }

/* ── Köməkçi funksiyalar ── */

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function generateReferralCode() {
  // Qarışıq oxunan hərf/rəqəmlər (0/O, 1/I) çıxarılıb ki, paylaşılanda səhv oxunmasın
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function getStoredToken() {
  try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null'); } catch (e) { return null; }
}
function storeToken(type, id) {
  try { localStorage.setItem(TOKEN_KEY, JSON.stringify({ type, id })); } catch (e) {}
}

function firstOnly(snapVal) {
  // Firebase query nəticəsindən ilk (və yeganə) uyğun qeydin id/data cütünü çıxarır
  const keys = Object.keys(snapVal || {});
  return keys.length ? { id: keys[0], data: snapVal[keys[0]] } : null;
}

/* ── Giriş nöqtəsi: masa aktivləşəndə customer.js tərəfindən çağırılır ── */

export function initCustomerLoyalty(tableId) {
  _currentTableId = tableId;

  // URL-də "?ref=KOD" varsa (kiminsə paylaşdığı linklə gəlibsə) - qeydiyyat anına qədər saxlanılır
  const params = new URLSearchParams(location.search);
  const refCode = params.get('ref');
  if (refCode) { try { sessionStorage.setItem(PENDING_REF_KEY, refCode.toUpperCase()); } catch (e) {} }

  const token = getStoredToken();
  if (!token) {
    document.getElementById('custWelcomeModal')?.classList.add('open');
    return;
  }
  recognizeExistingToken(token);
}

function recognizeExistingToken(token) {
  const node = token.type === 'customer' ? R.loyaltyCustomers : R.guestTokens;
  node.child(token.id).once('value', snap => {
    const data = snap.val();
    if (!data) {
      // Token Firebase-də tapılmadı (məlumat silinib və s.) - yenidən tanıma prosesi başlasın
      try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
      document.getElementById('custWelcomeModal')?.classList.add('open');
      return;
    }
    _currentCustomer = { id: token.id, type: token.type, data };
    // Ziyarət sayını yeniləyirik (yalnız məlumat üçün, funksionallığa təsir etmir)
    node.child(token.id).update({ lastVisit: Date.now(), visitCount: (data.visitCount || 0) + 1 });
    applyRecognition();
    linkVisitToTable();
  });
}

function applyRecognition() {
  const greetEl = document.getElementById('custGreetingText');
  const cardEl = document.getElementById('custLoyaltyCard');
  if (!greetEl || !cardEl) return;
  if (_currentCustomer?.type === 'customer') {
    greetEl.textContent = `Salam, ${_currentCustomer.data.firstName}!`;
    cardEl.style.display = 'block';
    document.getElementById('custBonusValue').textContent = (_currentCustomer.data.bonus || 0) + ' bal';
  } else if (_currentCustomer?.type === 'guest') {
    greetEl.textContent = 'Sizi yenidən görməyimizə şadıq.';
    cardEl.style.display = 'none';
  }
}

// Bu ziyarəti masaya bağlayır - masa bağlananda (tables.js) referral bonusu
// yoxlamaq üçün "bu masada kim oturub" məlumatı lazımdır
function linkVisitToTable() {
  if (!_currentTableId || !_currentCustomer) return;
  R.tables.child(_currentTableId).update({
    loyaltyCustomerId: _currentCustomer.type === 'customer' ? _currentCustomer.id : null,
    loyaltyGuestId: _currentCustomer.type === 'guest' ? _currentCustomer.id : null
  });
}

/* ── Qeydiyyatsız (Guest) davam etmək ── */

export function chooseGuestMode() {
  const uuid = generateUUID();
  const guestData = { createdAt: Date.now(), lastVisit: Date.now(), visitCount: 1 };
  R.guestTokens.child(uuid).set(guestData);
  storeToken('guest', uuid);
  _currentCustomer = { id: uuid, type: 'guest', data: guestData };
  document.getElementById('custWelcomeModal')?.classList.remove('open');
  applyRecognition();
  linkVisitToTable();
}

/* ── Qeydiyyat forması ── */

export function openLoyaltyRegisterForm() {
  document.getElementById('custWelcomeModal')?.classList.remove('open');
  document.getElementById('custRegisterModal')?.classList.add('open');
}
export function closeLoyaltyRegisterForm() {
  document.getElementById('custRegisterModal')?.classList.remove('open');
  document.getElementById('custWelcomeModal')?.classList.add('open');
}

export function submitLoyaltyRegistration() {
  const firstName = document.getElementById('regFirstName').value.trim();
  const lastName = document.getElementById('regLastName').value.trim();
  const fatherName = document.getElementById('regFatherName').value.trim();
  const phone = document.getElementById('regPhone').value.trim();
  const gender = document.getElementById('regGender').value;
  const birthDate = document.getElementById('regBirthDate').value;
  const errEl = document.getElementById('regErrorMsg');
  errEl.textContent = '';

  if (!firstName || !lastName || !phone) {
    errEl.textContent = 'Ad, soyad və telefon nömrəsi mütləqdir.';
    return;
  }

  // Telefon nömrəsinin unikallığını yoxlayırıq
  R.loyaltyCustomers.orderByChild('phone').equalTo(phone).once('value', snap => {
    if (snap.exists()) {
      errEl.textContent = 'Bu telefon nömrəsi ilə artıq qeydiyyat mövcuddur.';
      return;
    }

    const existingGuestToken = (_currentCustomer?.type === 'guest') ? _currentCustomer.id : null;
    const referralCode = generateReferralCode();
    let pendingRef = null;
    try { pendingRef = sessionStorage.getItem(PENDING_REF_KEY); } catch (e) {}

    const newRef = R.loyaltyCustomers.push();
    const customerData = {
      firstName, lastName, fatherName, phone, gender, birthDate,
      bonus: 0, referralCode, registrationDate: Date.now(),
      firstOrderCompleted: false,
      guestToken: existingGuestToken || null
    };
    newRef.set(customerData).then(() => {
      // Guest -> Customer keçidi: köhnə ziyarətlər (guest token) itməsin, ona işarə qoyulur
      if (existingGuestToken) {
        R.guestTokens.child(existingGuestToken).update({ convertedToCustomerId: newRef.key });
      }
      // Referral əlaqəsi: kimsə öz linki ilə dəvət edibsə, əlaqəni qururuq (bonus İLK
      // SİFARİŞ tamamlananda veriləcək - bax: checkReferralBonusOnClose)
      if (pendingRef) {
        R.loyaltyCustomers.orderByChild('referralCode').equalTo(pendingRef).once('value', refSnap => {
          const referrer = firstOnly(refSnap.val());
          if (referrer && referrer.id !== newRef.key) {
            R.referrals.push({
              referrerCustomerId: referrer.id, referredCustomerId: newRef.key,
              status: 'pending', createdAt: Date.now()
            });
          }
        });
        try { sessionStorage.removeItem(PENDING_REF_KEY); } catch (e) {}
      }
      storeToken('customer', newRef.key);
      _currentCustomer = { id: newRef.key, type: 'customer', data: customerData };
      document.getElementById('custRegisterModal')?.classList.remove('open');
      applyRecognition();
      linkVisitToTable();
      showToast('<svg class="icon"><use href="#i-check"></use></svg> Qeydiyyat tamamlandı, xoş gəlmisiniz!');
    });
  });
}

/* ── Telefon ilə hesab bərpası (brauzer məlumatları silinibsə) ── */

export function openPhoneRecoveryFromWelcome() {
  document.getElementById('custWelcomeModal')?.classList.remove('open');
  document.getElementById('custPhoneRecoveryModal')?.classList.add('open');
}
export function closePhoneRecovery() {
  document.getElementById('custPhoneRecoveryModal')?.classList.remove('open');
  if (!_currentCustomer) document.getElementById('custWelcomeModal')?.classList.add('open');
}

export function submitPhoneRecovery() {
  const phone = document.getElementById('recoveryPhone').value.trim();
  const errEl = document.getElementById('recoveryErrorMsg');
  errEl.textContent = '';
  if (!phone) { errEl.textContent = 'Telefon nömrəsini daxil edin.'; return; }

  R.loyaltyCustomers.orderByChild('phone').equalTo(phone).once('value', snap => {
    const found = firstOnly(snap.val());
    if (!found) { errEl.textContent = 'Bu nömrə ilə hesab tapılmadı.'; return; }
    storeToken('customer', found.id);
    _currentCustomer = { id: found.id, type: 'customer', data: found.data };
    document.getElementById('custPhoneRecoveryModal')?.classList.remove('open');
    document.getElementById('custWelcomeModal')?.classList.remove('open');
    applyRecognition();
    linkVisitToTable();
    showToast('<svg class="icon"><use href="#i-check"></use></svg> Hesabınız tapıldı, xoş gəlmisiniz!');
  });
}

/* ── Referral (Dostunu dəvət et) ── */

export function shareReferralLink() {
  if (!_currentCustomer || _currentCustomer.type !== 'customer') return;
  const code = _currentCustomer.data.referralCode;
  const url = `${location.origin}${location.pathname}?table=${_currentTableId}&ref=${code}`;
  if (navigator.share) {
    navigator.share({ title: 'İpək Yolu Restoranı', text: 'Bu link ilə qeydiyyatdan keç, hər ikimiz bonus qazanaq!', url }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => {
      showToast('<svg class="icon"><use href="#i-check"></use></svg> Dəvət linki kopyalandı!');
    });
  } else {
    showToast('<svg class="icon"><use href="#i-error"></use></svg> Paylaşma bu cihazda dəstəklənmir');
  }
}

/* ── Masa bağlananda referral bonusu yoxlanışı (tables.js tərəfindən çağırılır) ──
   Yeni (referral ilə gəlmiş) müştərinin İLK sifarişi tamamlananda, əgər sifariş
   minimum məbləği ötübsə, DƏVƏT EDƏN şəxsə bonus verilir.
   QEYD: customerId birbaşa çağıran yerdən (yaddaşdakı state-dən) ötürülür,
   Firebase-dən TƏZƏDƏN oxunmur - əks halda masa sıfırlanması ilə yarışma
   (race condition) riski yaranardı. */
export function checkReferralBonusOnClose(customerId, orderTotal) {
  if (!customerId) return;

  R.loyaltyCustomers.child(customerId).once('value', cSnap => {
    const customer = cSnap.val();
    if (!customer || customer.firstOrderCompleted) return; // yalnız İLK sifariş üçün

    R.loyaltyCustomers.child(customerId).update({ firstOrderCompleted: true });

    R.referrals.orderByChild('referredCustomerId').equalTo(customerId).once('value', refSnap => {
      const referral = firstOnly(refSnap.val());
      if (!referral || referral.data.status !== 'pending') return;

      db.ref('settings/loyalty').once('value', settingsSnap => {
        const settings = settingsSnap.val() || {};
        const minAmount = settings.referralMinOrderAmount || 0;
        const bonusAmount = settings.referralBonusAmount || 0;
        if (orderTotal < minAmount || bonusAmount <= 0) return;

        R.referrals.child(referral.id).update({ status: 'completed', completedAt: Date.now() });
        R.loyaltyCustomers.child(referral.data.referrerCustomerId).transaction(cur => {
          if (!cur) return cur;
          return { ...cur, bonus: (cur.bonus || 0) + bonusAmount };
        });
      });
    });
  });
}

// Mövcud HTML-də onclick="..." istifadə olunan funksiyalar qlobal əlçatan olmalıdır
window.chooseGuestMode = chooseGuestMode;
window.openLoyaltyRegisterForm = openLoyaltyRegisterForm;
window.closeLoyaltyRegisterForm = closeLoyaltyRegisterForm;
window.submitLoyaltyRegistration = submitLoyaltyRegistration;
window.openPhoneRecoveryFromWelcome = openPhoneRecoveryFromWelcome;
window.closePhoneRecovery = closePhoneRecovery;
window.submitPhoneRecovery = submitPhoneRecovery;
window.shareReferralLink = shareReferralLink;
