/* ═══════════════════════════════════════════
   İLK YÜKLƏMƏ
   Bu fayl: HƏMİŞƏ ən sonda yüklənməlidir, çünki burada olan kod
   səhifə açılan kimi DƏRHAL icra olunur (demo data, admin pin,
   checkCustomerMode). Bütün digər fayllardakı funksiyalar
   artıq mövcud olmalıdır ki, bu kod onlara güvənə bilsin.
═══════════════════════════════════════════ */

/* ── Demo data: yalnız Firebase boşdursa yaranır ── */
R.waiters.once('value', snap=>{
  if (snap.val()) return;
  [
    {name:'Əli Məmmədov',  pin:'1111', avatar:'https://ui-avatars.com/api/?name=Ali+Mammadov&background=2ecc71&color=fff&size=200',  status:'ready',   createdAt:Date.now()},
    {name:'Leyla Həsənli', pin:'2222', avatar:'https://ui-avatars.com/api/?name=Leyla+Hasanli&background=3498db&color=fff&size=200', status:'ready',   createdAt:Date.now()},
    {name:'Orxan Əliyev', pin:'3333', avatar:'https://ui-avatars.com/api/?name=Orxan+Aliyev&background=8e44ad&color=fff&size=200',  status:'offline',  createdAt:Date.now()}
  ].forEach(w=>R.waiters.push(w));
});

R.tables.once('value', snap=>{
  if (snap.val()) return;
  ['Masa 1','Masa 2','Masa 3','VIP Otaq','Terras','Bar'].forEach(name=>{
    R.tables.push({name, capacity:4, occupant:null, notes:'', createdAt:Date.now()});
  });
});

/* ── Admin PIN-i Firebase-dən əvvəlcədən yüklə ── */
db.ref('settings/adminPin').once('value', snap => {
  if (snap.val()) ADMIN_PIN = snap.val();
});

/* ── Müştəri rejimi yoxlanışı (?table=... varsa) ── */
checkCustomerMode();

/* ── Saxlanılmış gecə/gündüz seçimini tətbiq et ── */
loadSavedTheme();

/* ── Başlanğıcda "+" düyməsi gizli olsun ── */
document.getElementById('adminFab').style.display='none';
