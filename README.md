<!DOCTYPE html>
<html lang="az">
<head>
<meta charset="UTF-8">
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<meta http-equiv="Pragma" content="no-cache">
<meta http-equiv="Expires" content="0">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="theme-color" content="#1a1a2e">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-fullscreen">
<title>İpək Yolu — Restoran İdarəetmə Sistemi</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent;}

/* ═══ GÜNDÜZ (AĞ) REJİM — DEFAULT ═══ */
:root{
  --green:#1c6b35;--green-dark:#155327;--red:#a32a24;--red-dark:#84211c;
  --blue:#3498db;--orange:#c4b02e;--orange-dark:#a8972a;--purple:#8e44ad;--yellow:#f1c40f;
  --bg:#f4f5f7;--card:#ffffff;--card2:#eef0f3;--border:#dfe2e7;
  --text:#1a1d24;--text2:#5b6573;--text3:#9aa1ad;
  --overlay-strong:rgba(0,0,0,.55);--overlay-soft:rgba(0,0,0,.08);
  --shadow-color:rgba(0,0,0,.12);
  --brand-gradient:linear-gradient(135deg,#a01942 0%,#5c1030 55%,#280a18 100%);
  --brand-glow:radial-gradient(circle at 85% 0%, rgba(255,90,140,.35) 0%, transparent 60%);
}

/* ═══ GECƏ (TÜND) REJİM — body.dark-mode ═══ */
body.dark-mode{
  --green:#2ecc71;--green-dark:#27ae60;--red:#e74c3c;--red-dark:#c0392b;
  --blue:#3498db;--orange:#d4c235;--orange-dark:#bcab2e;--purple:#8e44ad;--yellow:#f1c40f;
  --bg:#0f0f1a;--card:#1a1a2e;--card2:#16213e;--border:#2d2d4e;
  --text:#eee;--text2:#aaa;--text3:#666;
  --overlay-strong:rgba(0,0,0,.75);--overlay-soft:rgba(255,255,255,.04);
  --shadow-color:rgba(0,0,0,.4);
}

body{font-family:'Segoe UI',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;overflow-x:hidden;}

/* ── SCREEN ── */
.screen{display:none;min-height:100vh;}
.screen.active{display:flex;flex-direction:column;}

/* ── LOGIN SCREEN ── */
#loginScreen{align-items:center;justify-content:center;background:var(--brand-gradient);position:relative;overflow:hidden;}
#loginScreen::before{content:'';position:absolute;top:0;right:0;width:60%;height:60%;background:var(--brand-glow);pointer-events:none;}
.login-box{background:var(--card);border:1px solid var(--border);border-radius:20px;padding:40px;width:100%;max-width:380px;text-align:center;position:relative;z-index:2;}
.login-logo{font-size:48px;margin-bottom:10px;}
.login-box h1{font-size:24px;margin-bottom:6px;}
.login-box p{color:var(--text2);margin-bottom:28px;font-size:14px;}
.role-tabs{display:flex;gap:8px;margin-bottom:24px;background:var(--bg);border-radius:12px;padding:4px;}
.role-tab{flex:1;padding:10px 6px;border:none;background:transparent;color:var(--text2);border-radius:9px;cursor:pointer;font-size:13px;font-weight:600;transition:.2s;}
.role-tab.active{background:var(--card2);color:var(--text);box-shadow:0 2px 8px var(--shadow-color);}
.pin-display{display:flex;justify-content:center;gap:12px;margin-bottom:20px;}
.pin-dot{width:16px;height:16px;border-radius:50%;border:2px solid var(--border);background:transparent;transition:.2s;}
.pin-dot.filled{background:var(--green);border-color:var(--green);transform:scale(1.15);}
.numpad{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px;}
.num-btn{padding:18px;background:var(--card2);border:1px solid var(--border);border-radius:12px;color:var(--text);font-size:22px;font-weight:600;cursor:pointer;transition:.15s;}
.num-btn:active{transform:scale(0.93);background:var(--border);}
.login-btn{width:100%;padding:16px;background:var(--green);border:none;border-radius:12px;color:white;font-size:17px;font-weight:700;cursor:pointer;transition:.2s;margin-bottom:10px;}
.login-btn:active{background:var(--green-dark);}
.err-msg{color:var(--red);font-size:13px;min-height:20px;font-weight:600;}

/* ── TOPBAR ── */
.topbar{background:var(--brand-gradient);border-bottom:1px solid var(--border);padding:14px 20px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;position:relative;overflow:hidden;}
.topbar::before{content:'';position:absolute;top:0;right:0;width:200px;height:100%;background:var(--brand-glow);pointer-events:none;}
.topbar h2, .topbar h1{color:#fff;position:relative;z-index:1;}
.topbar .topbar-right{position:relative;z-index:1;display:flex;align-items:center;gap:10px;}
.topbar h2{font-size:18px;font-weight:600;}

.btn{padding:9px 18px;border:none;border-radius:9px;cursor:pointer;font-weight:600;font-size:14px;transition:.15s;display:inline-flex;align-items:center;justify-content:center;gap:6px;}
.btn:active{transform:scale(0.96);}
.btn-red{background:var(--red);color:white;}
.btn-green{background:var(--green);color:white;}
.btn-blue{background:var(--blue);color:white;}
.btn-ghost{background:transparent;border:1px solid var(--border);color:var(--text2);}

/* ── ADMIN MODULE ── */
#adminScreen{background:var(--bg);}
.admin-body{flex:1;overflow-y:auto;padding:20px;}
.admin-tabs{display:flex;gap:8px;margin-bottom:20px;border-bottom:1px solid var(--border);padding-bottom:16px;flex-wrap:wrap;}
.admin-tab{padding:9px 20px;border:1px solid var(--border);border-radius:9px;background:var(--card);color:var(--text2);cursor:pointer;font-weight:600;font-size:14px;transition:.2s;}
.admin-tab.active{background:var(--blue);color:white;border-color:var(--blue);}
.admin-section{display:none;}
.admin-section.active{display:block;}
.stats-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:24px;}
.stat-card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:18px;text-align:center;box-shadow:0 4px 12px var(--shadow-color);}
.stat-num{font-size:28px;font-weight:700;color:var(--green);}
.stat-label{font-size:11px;color:var(--text2);margin-top:4px;text-transform:uppercase;letter-spacing:.05em;}
.grid-2{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;}
.item-card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:18px;position:relative;}
.item-card-header{display:flex;align-items:center;gap:12px;margin-bottom:14px;}
.avatar{width:52px;height:52px;border-radius:50%;object-fit:cover;border:2px solid var(--border);}
.item-info h3{font-size:16px;margin-bottom:3px;}
.item-info small{color:var(--text2);font-size:13px;}
.status-badge{display:inline-block;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;text-transform:uppercase;}
.badge-green{background:rgba(46,204,113,.15);color:var(--green);}
.badge-red{background:rgba(231,76,60,.15);color:var(--red);}
.item-actions{display:flex;gap:8px;margin-top:14px;}
.item-actions .btn{flex:1;padding:10px;}

/* ── LOGS & LOG FILTERS ── */
.log-filter-bar{display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;}
.log-filter{padding:6px 14px;border-radius:20px;border:1px solid var(--border);background:var(--card);color:var(--text2);font-size:12px;font-weight:600;cursor:pointer;transition:.15s;}
.log-filter.active{background:var(--blue);color:white;border-color:var(--blue);}
.log-list{display:flex;flex-direction:column;gap:6px;}
.log-item{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:12px 16px;display:flex;justify-content:space-between;align-items:flex-start;gap:10px;}
.log-badge{font-size:10px;font-weight:700;padding:3px 9px;border-radius:10px;white-space:nowrap;}
.log-text{font-size:13px;color:var(--text2);flex:1;}
.log-time{font-size:11px;color:var(--text3);text-align:right;}

/* ── REPORT AND PAYMENTS SECTION ── */
.report-section{background:var(--card2);border-radius:12px;padding:14px;margin-bottom:12px;}
.report-section h4{font-size:12px;text-transform:uppercase;color:var(--text2);letter-spacing:.06em;margin-bottom:10px;}

/* ── KITCHEN SCREEN ── */
#kitchenScreen{background:var(--bg);}
.kitchen-body{flex:1;padding:20px;overflow-y:auto;}
.kitchen-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;}
.k-card{background:var(--card);border-radius:18px;padding:20px;text-align:center;cursor:pointer;transition:.2s;position:relative;border:3px solid transparent;box-shadow:0 4px 12px var(--shadow-color);}
.k-card.ready{background:rgba(46,204,113,.1);border-color:var(--green);}
.k-card.called{background:rgba(231,76,60,.12);border-color:var(--red);animation:pulse-border 1.2s infinite;}
.k-card.offline{background:var(--card);border-color:var(--border);opacity:.5;cursor:default;}
@keyframes pulse-border{0%,100%{border-color:var(--red);box-shadow:0 0 12px rgba(231,76,60,0.4);}50%{border-color:transparent;box-shadow:none;}}
.k-card img{width:88px;height:88px;border-radius:50%;object-fit:cover;margin-bottom:12px;border:3px solid var(--border);}
.k-card.ready img{border-color:var(--green);}
.k-card.called img{border-color:var(--red);}
.k-card h3{font-size:17px;margin-bottom:6px;}
.k-status{font-size:13px;font-weight:700;}
.k-card.ready .k-status{color:var(--green);}
.k-card.called .k-status{color:var(--red);}
.k-tables-under{display:flex;flex-wrap:wrap;justify-content:center;gap:4px;margin-top:8px;min-height:24px;}
.k-table-chip{background:rgba(52,152,219,.15);border:1px solid rgba(52,152,219,.3);border-radius:10px;padding:2px 8px;font-size:11px;color:var(--blue);font-weight:600;}

/* ── WAITER SCREEN ── */
#waiterScreen{background:var(--bg);}
.waiter-header{background:var(--brand-gradient);border-bottom:1px solid var(--border);padding:14px 20px;display:flex;justify-content:space-between;align-items:center;position:relative;overflow:hidden;}
.waiter-header::before{content:'';position:absolute;top:0;right:0;width:180px;height:100%;background:var(--brand-glow);pointer-events:none;}
.waiter-header *{position:relative;z-index:1;}
.waiter-info{display:flex;align-items:center;gap:12px;color:white;}
.waiter-info img{width:44px;height:44px;border-radius:50%;object-fit:cover;border:2px solid var(--green);}
.waiter-body{flex:1;padding:16px;overflow-y:auto;display:flex;flex-direction:column;}
.waiter-body h3{font-size:14px;color:var(--text2);margin-bottom:12px;text-transform:uppercase;letter-spacing:.06em;}
.tables-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:10px;margin-bottom:20px;}
.w-table-card{border-radius:14px;padding:16px 8px;border:2px solid var(--border);background:var(--card);cursor:pointer;transition:.2s;text-align:center;min-height:85px;display:flex;flex-direction:column;justify-content:center;box-shadow:0 3px 8px var(--shadow-color);}
.w-table-card.mine{background:var(--brand-gradient);border-color:transparent;color:white;}
.w-table-card.other{background:rgba(52,152,219,.03);border-color:rgba(52,152,219,.2);cursor:not-allowed;opacity:.6;}
.w-table-card.other-manage{background:rgba(243,156,18,.08);border-color:rgba(243,156,18,.4);}
.w-table-name{font-size:16px;font-weight:700;margin-bottom:4px;}
.w-table-status{font-size:11px;color:var(--text2);}
.w-table-card.mine .w-table-status{color:rgba(255,255,255,0.75);}
.w-table-card.other .w-table-status{color:var(--blue);}
.w-table-card.other-manage .w-table-status{color:var(--orange-dark);}
.notes-area{width:100%;margin-top:10px;padding:10px;background:var(--card);border:1px solid var(--border);border-radius:10px;color:var(--text);font-size:13px;resize:none;min-height:70px;outline:none;}

/* ── ALARM OVERLAY ── */
#alarmOverlay{display:none;position:fixed;inset:0;z-index:9000;background:rgba(163,42,36,0.95);flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:20px;color:white;}
#alarmOverlay.show{display:flex;}
.alarm-icon{font-size:90px;animation:ring .4s infinite;margin-bottom:15px;}
@keyframes ring{0%,100%{transform:rotate(0);}25%{transform:rotate(12deg);}75%{transform:rotate(-12deg);}}
.alarm-title{font-size:36px;font-weight:800;margin-bottom:8px;letter-spacing:.5px;}
.alarm-sub{font-size:24px;font-weight:600;margin-bottom:40px;line-height:1.4;max-width:400px;}
.alarm-btn{padding:18px 50px;background:white;border:none;border-radius:50px;font-size:20px;font-weight:800;cursor:pointer;color:#a32a24;box-shadow:0 6px 25px rgba(0,0,0,0.3);transition:.15s;}
.alarm-btn:active{transform:scale(0.95);}

/* ── WAITER CHAT PANEL ── */
#waiterChatPanel{display:none;position:fixed;bottom:0;left:0;right:0;background:var(--card);border-top:2px solid var(--border);z-index:600;padding:14px 16px;box-shadow:0 -4px 25px var(--shadow-color);border-radius:16px 16px 0 0;}
#waiterChatPanel.show{display:block;}
.chat-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;border-bottom:1px solid var(--border);padding-bottom:8px;}
.chat-header span{font-size:14px;font-weight:700;color:var(--orange);}
.chat-msg-list{max-height:150px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;margin-bottom:10px;padding:4px;}
.chat-bubble{padding:8px 12px;border-radius:12px;font-size:14px;max-width:80%;line-height:1.3;}
.chat-bubble.customer{background:rgba(52,152,219,.15);color:var(--text);align-self:flex-start;border-bottom-left-radius:2px;}
.chat-bubble.waiter{background:rgba(46,204,113,.15);color:var(--text);align-self:flex-end;border-bottom-right-radius:2px;}
.chat-input-row{display:flex;gap:8px;}
.chat-input-row textarea{flex:1;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:10px;color:var(--text);font-size:14px;resize:none;min-height:42px;outline:none;}
.chat-input-row button{padding:0 20px;background:var(--green);border:none;border-radius:10px;color:white;font-weight:700;cursor:pointer;}

/* ── CUSTOMER SCREEN ── */
#customerScreen{background:var(--brand-gradient);overflow-y:auto;position:relative;}
#customerScreen::before{content:'';position:fixed;top:0;right:0;width:50%;height:40%;background:var(--brand-glow);pointer-events:none;z-index:0;}
.cust-wrap{width:100%;max-width:440px;margin:0 auto;padding:20px;position:relative;z-index:1;}
.cust-header{text-align:center;padding:24px 0 16px;}
.cust-header .icon{font-size:52px;margin-bottom:6px;}
.cust-header h1{font-size:26px;color:white;font-weight:800;}
.cust-header p{color:rgba(255,255,255,0.7);font-size:14px;margin-top:4px;}

.cust-actions{display:flex;flex-direction:column;gap:12px;margin-bottom:20px;margin-top:20px;}
.cust-btn{display:flex;align-items:center;gap:14px;width:100%;padding:18px;border-radius:16px;font-size:17px;font-weight:700;cursor:pointer;border:2px solid;transition:.2s;}
.cust-btn:active{transform:scale(0.97);}
.cust-btn .cust-icon{font-size:30px;flex-shrink:0;}
.cust-btn.call-btn{background:rgba(241,196,15,.15);border-color:#f1c40f;color:#f1c40f;}
.cust-btn.cash-btn{background:rgba(46,204,113,.15);border-color:#2ecc71;color:#2ecc71;}
.cust-btn.pos-btn{background:rgba(52,152,219,.15);border-color:#3498db;color:#3498db;}

.cust-chat-section, .cust-feedback{background:var(--card);border-radius:16px;padding:16px;border:1px solid var(--border);margin-bottom:20px;box-shadow:0 4px 15px rgba(0,0,0,0.15);}
.cust-chat-section h3, .cust-feedback h3{font-size:15px;margin-bottom:12px;color:var(--text);font-weight:700;display:flex;align-items:center;gap:6px;}
.cust-msg-list{max-height:180px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;margin-bottom:10px;padding:2px;}
.cust-bubble{padding:10px 14px;border-radius:14px;font-size:14px;max-width:80%;line-height:1.4;}
.cust-bubble.customer{background:rgba(243,156,18,.15);color:var(--text);align-self:flex-end;border-bottom-right-radius:2px;}
.cust-bubble.waiter{background:rgba(46,204,113,.15);color:var(--text);align-self:flex-start;border-bottom-left-radius:2px;}
.cust-input-row textarea, .cust-feedback textarea{width:100%;padding:12px;background:var(--bg);border:1px solid var(--border);border-radius:10px;color:var(--text);font-size:14px;resize:none;outline:none;}
.cust-input-row button{padding:0 18px;background:var(--orange);border:none;border-radius:10px;color:white;font-weight:700;cursor:pointer;}
.cust-feedback button{width:100%;margin-top:8px;padding:12px;background:var(--green);border:none;border-radius:10px;color:white;font-weight:700;cursor:pointer;font-size:15px;}

/* ── ASSIGNED WAITER CARD OVERLAY ── */
#custWaiterCard{position:fixed;top:16px;right:16px;display:none;flex-direction:column;align-items:center;gap:4px;z-index:200;background:rgba(0,0,0,0.6);padding:8px;border-radius:12px;backdrop-filter:blur(5px);border:1px solid rgba(255,255,255,0.1);}
#custWaiterCard img{width:64px;height:64px;border-radius:50%;object-fit:cover;border:2px solid var(--green);box-shadow:0 4px 10px rgba(0,0,0,0.3);}
#custWaiterCard .cw-label{font-size:9px;color:#bbb;font-weight:600;text-transform:uppercase;letter-spacing:.05em;}
#custWaiterCard .cw-name{font-size:13px;font-weight:700;color:white;text-align:center;}

.theme-toggle-btn{width:38px;height:38px;border-radius:9px;border:1px solid var(--border);background:var(--card2);font-size:17px;cursor:pointer;display:flex;align-items:center;justify-content:center;}
.cust-theme-toggle{position:fixed;top:16px;left:16px;z-index:200;background:var(--card);border-radius:10px;box-shadow:0 4px 12px var(--shadow-color);}

/* ── MODALS & FLOATING SYSTEM ── */
.modal-bg{display:none;position:fixed;inset:0;background:var(--overlay-strong);z-index:2000;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(3px);}
.modal-bg.open{display:flex;}
.modal{background:var(--card);border:1px solid var(--border);border-radius:20px;padding:24px;width:100%;max-width:360px;box-shadow:0 10px 30px rgba(0,0,0,0.3);text-align:center;}
.modal h2{font-size:20px;margin-bottom:12px;}
.form-group{margin-bottom:14px;text-align:left;}
.form-group label{display:block;font-size:13px;color:var(--text2);margin-bottom:4px;font-weight:600;}
.form-group input{width:100%;padding:11px 14px;background:var(--bg);border:1px solid var(--border);border-radius:10px;color:var(--text);font-size:15px;outline:none;}

/* ── TOAST MESSAGES ── */
#toast, #customerToast{position:fixed;top:20px;left:50%;transform:translateX(-50%);background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 24px;font-size:14px;font-weight:600;z-index:8500;display:none;box-shadow:0 6px 20px var(--shadow-color);text-align:center;}

/* ── DEACTIVATED & INACTIVE OVERLAYS ── */
#deactivatedOverlay, #customerInactiveOverlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:white;padding:24px;}
#deactivatedOverlay.show, #customerInactiveOverlay.show{display:flex;}
#deactivatedOverlay h2, #customerInactiveOverlay h2{color:var(--red);font-size:26px;margin-bottom:10px;}

</style>
</head>
<body>

<div class="screen active" id="loginScreen">
  <div class="login-box">
    <div class="login-logo">🍽️</div>
    <h1>İpək Yolu</h1>
    <p>Rol seçin və PIN daxil edin</p>
    <div class="role-tabs">
      <button class="role-tab active" id="tab-admin" onclick="setRole('admin',this)">👨‍💼 Admin</button>
      <button class="role-tab" id="tab-staff" onclick="setRole('staff',this)">👤 Əməkdaş</button>
      <button class="role-tab" id="tab-kitchen" onclick="setRole('kitchen',this)">👨‍🍳 Mətbəx</button>
    </div>
    <div class="pin-display" id="pinDots">
      <div class="pin-dot" id="d0"></div>
      <div class="pin-dot" id="d1"></div>
      <div class="pin-dot" id="d2"></div>
      <div class="pin-dot" id="d3"></div>
    </div>
    <div class="numpad">
      <button class="num-btn" onclick="numPress('1')">1</button>
      <button class="num-btn" onclick="numPress('2')">2</button>
      <button class="num-btn" onclick="numPress('3')">3</button>
      <button class="num-btn" onclick="numPress('4')">4</button>
      <button class="num-btn" onclick="numPress('5')">5</button>
      <button class="num-btn" onclick="numPress('6')">6</button>
      <button class="num-btn" onclick="numPress('7')">7</button>
      <button class="num-btn" onclick="numPress('8')">8</button>
      <button class="num-btn" onclick="numPress('9')">9</button>
      <button class="num-btn" onclick="numPress('clear')" style="font-size:13px;color:var(--text2);">SİL</button>
      <button class="num-btn" onclick="numPress('0')">0</button>
      <button class="num-btn" onclick="numPress('back')" style="font-size:20px;">⌫</button>
    </div>
    <button class="login-btn" onclick="doLogin()">Daxil Ol</button>
    <div class="err-msg" id="loginErr"></div>
  </div>
</div>

<div class="screen" id="adminScreen">
  <div class="topbar">
    <h2>👨‍💼 Admin Paneli</h2>
    <div class="topbar-right">
      <button class="theme-toggle-btn" onclick="toggleTheme()">🌙</button>
      <button class="btn btn-red" onclick="triggerExitModal('loginScreen')">Çıxış</button>
    </div>
  </div>
  <div class="admin-body">
    <div class="admin-tabs">
      <button class="admin-tab active" onclick="adminTab('dashboard',this)">📊 İcmal</button>
      <button class="admin-tab" onclick="adminTab('staff',this)">👔 İşçilər</button>
      <button class="admin-tab" onclick="adminTab('tables',this)">🪑 Masalar</button>
      <button class="admin-tab" onclick="adminTab('logs',this)">📋 Tarixçə</button>
      <button class="admin-tab" onclick="adminTab('feedback',this)">💬 Şikayətlər</button>
      <button class="admin-tab" onclick="adminTab('payments',this)">💰 Ödənişlər</button>
    </div>

    <div class="admin-section active" id="sec-dashboard">
      <div class="stats-row">
        <div class="stat-card"><div class="stat-num" id="stat-sales">485.50 ₼</div><div class="stat-label">Bugünkü Satış</div></div>
        <div class="stat-card"><div class="stat-num" id="stat-tables">3 / 12</div><div class="stat-label">Aktiv Masalar</div></div>
        <div class="stat-card"><div class="stat-num" id="stat-alerts" style="color:var(--red)">1</div><div class="stat-label">Gözləyən Çağırış</div></div>
      </div>
    </div>
    
    <div class="admin-section" id="sec-staff">
      <div class="grid-2" id="staffGrid"></div>
    </div>
    
    <div class="admin-section" id="sec-tables">
      <div class="grid-2" id="tablesGrid"></div>
    </div>
    
    <div class="admin-section" id="sec-logs">
      <div class="log-filter-bar">
        <button class="log-filter active" onclick="filterLogs('all',this)">Hamısı</button>
        <button class="log-filter" onclick="filterLogs('call',this)">🚨 Çağırışlar</button>
        <button class="log-filter" onclick="filterLogs('system',this)">⚙️ Sistem</button>
      </div>
      <div class="log-list" id="logList"></div>
    </div>

    <div class="admin-section" id="sec-feedback">
      <div class="log-list" id="feedbackList"></div>
    </div>

    <div class="admin-section" id="sec-payments">
      <div class="report-section">
        <h4>💰 Son Kassa Əməliyyatları</h4>
        <div class="log-list" id="paymentsList"></div>
      </div>
    </div>
  </div>
</div>

<div class="screen" id="waiterScreen">
  <div class="waiter-header">
    <div class="waiter-info">
      <img src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120" id="waiterAvatar" alt="waiter">
      <div>
        <h2 id="waiterName">Zaur Məmmədov</h2>
        <small style="color:rgba(255,255,255,0.7)">Xidmət Sahəsi: Restoran / Bağça</small>
      </div>
    </div>
    <button class="btn btn-red" onclick="triggerExitModal('loginScreen')">Kilidlə</button>
  </div>
  <div class="waiter-body">
    <h3>🪑 Masaların Vəziyyəti</h3>
    <div class="tables-grid" id="waiterTablesGrid"></div>
    
    <h3 style="margin-top:20px;">📝 Masa Qeydləri</h3>
    <textarea class="notes-area" placeholder="Seçilmiş masaya aid xüsusi sifariş qeydləri bura yazılır..." id="tableNotesInput" oninput="saveTableNotes()"></textarea>
  </div>

  <div id="waiterChatPanel">
    <div class="chat-header">
      <span id="chatTargetTitle">💬 Masa 4 ilə Canlı Çat</span>
      <button class="btn btn-ghost" style="padding:2px 8px;font-size:11px;" onclick="closeWaiterChat()">Bağla</button>
    </div>
    <div class="chat-msg-list" id="waiterChatMsgs"></div>
    <div class="chat-input-row">
      <textarea id="waiterChatInput" placeholder="Mesajınızı yazın..."></textarea>
      <button onclick="sendWaiterMessage()">Göndər</button>
    </div>
  </div>
</div>

<div class="screen" id="kitchenScreen">
  <div class="topbar">
    <h2>👨‍🍳 Mətbəx Monitoru</h2>
    <button class="btn btn-red" onclick="triggerExitModal('loginScreen')">Çıxış</button>
  </div>
  <div class="kitchen-body">
    <div class="kitchen-grid" id="kitchenGrid"></div>
  </div>
</div>

<div class="screen" id="customerScreen">
  <div class="cust-theme-toggle">
    <button class="theme-toggle-btn" onclick="toggleTheme()">🌙</button>
  </div>
  
  <div id="custWaiterCard">
    <img src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120" alt="waiter">
    <div class="cw-info">
      <div class="cw-label">Sizin Ofisiant</div>
      <div class="cw-name">Zaur M.</div>
    </div>
  </div>

  <div class="cust-wrap">
    <div class="cust-header">
      <div class="icon">✨</div>
      <h1>İpək Yolu</h1>
      <p id="custTableTitle">Masa 4 — Xoş gəlmisiniz</p>
    </div>

    <button class="menu-btn">
      <span class="menu-icon">📖</span> Rəqəmsal Menyuya Bax
    </button>

    <div class="cust-actions">
      <button class="cust-btn call-btn" onclick="customerAction('call')">
        <span class="cust-icon">🚨</span> <span>Ofisiantı Çağır</span>
      </button>
      <button class="cust-btn cash-btn" onclick="customerAction('cash')">
        <span class="cust-icon">💵</span> <span>Nağd Ödəniş İstə</span>
      </button>
      <button class="cust-btn pos-btn" onclick="customerAction('pos')">
        <span class="cust-icon">💳</span> <span>POS Terminal İstə</span>
      </button>
    </div>

    <div class="cust-chat-section">
      <h3>💬 Ofisiant ilə Canlı Mesajlaşma</h3>
      <div class="cust-msg-list" id="customerChatMsgs"></div>
      <div class="cust-input-row">
        <textarea id="customerChatInput" placeholder="Ofisianta mesaj yazın (məs: ketçup gətirin)..."></textarea>
        <button onclick="sendCustomerMessage()">Göndər</button>
      </div>
    </div>

    <div class="cust-feedback">
      <h3>⭐ Rəy və Şikayətlər</h3>
      <textarea id="custFeedbackInput" placeholder="Xidmət və ya yeməklər haqqında təklif və şikayətlərinizi birbaşa rəhbərliyə göndərin..."></textarea>
      <button onclick="sendCustomerFeedback()">Rəyi Adminə Göndər</button>
    </div>
  </div>
</div>

<div id="alarmOverlay">
  <div class="alarm-icon">🔔</div>
  <div class="alarm-title" id="alarmTitle">YENİ ÇAĞIRIŞ!</div>
  <div class="alarm-sub" id="alarmSub">Masa 4 ofisiantı çağırır!</div>
  <button class="alarm-btn" onclick="muteAlarm()">Səsi Kəs</button>
</div>

<div class="modal-bg" id="exitModal">
  <div class="modal">
    <h2 style="color:var(--red)">🔒 Təhlükəsizlik Çıxışı</h2>
    <p style="font-size:13px;color:var(--text2);margin-bottom:16px;">Davam etmək üçün PIN kodunuzu daxil edin</p>
    <div class="form-group">
      <input type="password" id="exitPinInput" placeholder="••••" style="text-align:center;letter-spacing:6px;font-size:20px;" maxlength="4">
    </div>
    <div style="display:flex;gap:10px;margin-top:16px;">
      <button class="btn btn-ghost" style="flex:1;" onclick="closeExitModal()">Ləğv Et</button>
      <button class="btn btn-red" style="flex:1;" onclick="confirmExit()">Təsdiqlə</button>
    </div>
  </div>
</div>

<div id="deactivatedOverlay">
  <h2>🚫 Sistem Deaktivdir</h2>
  <p>Bu cihazın admin tərəfindən istifadəsi müvəqqəti dayandırılıb.</p>
</div>

<div id="customerInactiveOverlay">
  <h2>⏳ Masa Sessiyası Qapalıdır</h2>
  <p>Bu masa hal-hazırda aktiv deyil və ya hesabı bağlanıb.</p>
</div>

<div id="toast"></div>
<div id="customerToast"></div>

<script>
// Mock Verilənlər Bazası (State Management)
let state = {
  currentRole: 'admin',
  enteredPin: '',
  selectedTableId: 4,
  targetExitScreen: 'loginScreen',
  
  staff: [
    { id: 1, name: 'Zaur Məmmədov', role: 'waiter', pin: '1111', status: 'active', avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120' },
    { id: 2, name: 'Aysel Əliyeva', role: 'waiter', pin: '2222', status: 'active', avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=120' },
    { id: 3, name: 'Məmməd Aşpaz', role: 'kitchen', pin: '3333', status: 'active', avatar: 'https://images.unsplash.com/photo-1577219491135-ce391730fb2c?w=120' }
  ],
  
  tables: [
    { id: 1, name: 'Masa 1', status: 'empty', waiterId: 1, category: 'Restoran', notes: '' },
    { id: 2, name: 'Masa 2', status: 'empty', waiterId: 2, category: 'Restoran', notes: '' },
    { id: 3, name: 'Masa 3', status: 'empty', waiterId: 2, category: 'Restoran', notes: '' },
    { id: 4, name: 'Masa 4', status: 'occupied', waiterId: 1, category: 'Bağça', notes: 'Manqalüstü kabab üçün az duzlu olsun deyildi.' },
    { id: 5, name: 'Masa 5', status: 'empty', waiterId: 1, category: 'Bağça', notes: '' },
    { id: 6, name: 'Kabinet 1', status: 'empty', waiterId: null, category: 'VIP', notes: '' }
  ],
  
  logs: [
    { type: 'system', text: 'Sistem uğurla başladıldı.', time: '21:00' },
    { type: 'call', text: 'Masa 4: Ofisiant çağırışı göndərildi.', time: '21:40' }
  ],
  
  feedbacks: [
    { text: 'Kabablar çox dadlı idi, təşəkkürlər!', time: '21:15' }
  ],
  
  payments: [
    { id: 101, table: 'Masa 2', amount: 45.00, method: 'Nağd', time: '19:30' },
    { id: 102, table: 'Kabinet 1', amount: 120.50, method: 'Kart', time: '20:15' }
  ],
  
  chats: {
    4: [
      { sender: 'customer', text: 'Zəhmət olmasa bizə 1 ədəd mineral su gətirin.', time: '21:42' },
      { sender: 'waiter', text: 'Bəli dostum, dərhal çatdırıram.', time: '21:43' }
    ]
  }
};

// ── SCREEN NAVIGATION & LOGIN SYSTEM ──
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(screenId);
  if (target) target.classList.add('active');
  
  // URL Parametrinə görə simulyasiya (Müştəri QR yoxlanışı)
  if(screenId === 'customerScreen') {
    document.getElementById('custWaiterCard').style.display = 'flex';
    renderCustomerChat();
  } else {
    document.getElementById('custWaiterCard').style.display = 'none';
  }
}

function setRole(role, btn) {
  state.currentRole = role;
  document.querySelectorAll('.role-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  state.enteredPin = '';
  updatePinDots();
}

function numPress(num) {
  if (num === 'clear') {
    state.enteredPin = '';
  } else if (num === 'back') {
    state.enteredPin = state.enteredPin.slice(0, -1);
  } else {
    if (state.enteredPin.length < 4) {
      state.enteredPin += num;
    }
  }
  updatePinDots();
  
  if (state.enteredPin.length === 4) {
    // Avtomatik daxil olma cəhdi edilə bilər
  }
}

function updatePinDots() {
  for (let i = 0; i < 4; i++) {
    const dot = document.getElementById(`d${i}`);
    if (i < state.enteredPin.length) {
      dot.classList.add('filled');
    } else {
      dot.classList.remove('filled');
    }
  }
}

function doLogin() {
  const errEl = document.getElementById('loginErr');
  errEl.innerText = '';
  
  if (state.currentRole === 'admin') {
    if (state.enteredPin === '0000') {
      showScreen('adminScreen');
      initAdminPanel();
      showToast('Xoş gəldiniz, Admin!');
    } else {
      errEl.innerText = 'Yanlış Admin PIN kodu!';
    }
  } else {
    const user = state.staff.find(s => s.pin === state.enteredPin && s.status === 'active');
    if (user) {
      if (state.currentRole === 'staff' && user.role === 'waiter') {
        showScreen('waiterScreen');
        initWaiterScreen(user);
      } else if (state.currentRole === 'kitchen' && user.role === 'kitchen') {
        showScreen('kitchenScreen');
        initKitchenScreen();
      } else {
        errEl.innerText = 'Seçilən rol bu əməkdaşa uyğun deyil!';
      }
    } else {
      errEl.innerText = 'İstifadəçi tapılmadı və ya bloklanıb!';
    }
  }
  state.enteredPin = '';
  updatePinDots();
}

// ── TOAST ALERTS ──
function showToast(msg) {
  const t = document.getElementById('toast');
  t.innerText = msg;
  t.style.display = 'block';
  setTimeout(() => t.style.display = 'none', 3000);
}

function showCustomerToast(msg) {
  const t = document.getElementById('customerToast');
  t.innerText = msg;
  t.style.display = 'block';
  setTimeout(() => t.style.display = 'none', 3500);
}

// ── EXIT LOCK PIN SYSTEM ──
function triggerExitModal(targetScreen) {
  state.targetExitScreen = targetScreen;
  document.getElementById('exitPinInput').value = '';
  document.getElementById('exitModal').classList.add('open');
}

function closeExitModal() {
  document.getElementById('exitModal').classList.remove('open');
}

function confirmExit() {
  const pin = document.getElementById('exitPinInput').value;
  if(pin === '0000' || state.staff.some(s => s.pin === pin)) {
    closeExitModal();
    showScreen(state.targetExitScreen);
  } else {
    alert('Yanlış PIN Təhlükəsizlik kodu!');
  }
}

// ── THEME SWITCHER (Dark/Light Mode) ──
function toggleTheme() {
  document.body.classList.toggle('dark-mode');
  showToast(document.body.classList.contains('dark-mode') ? 'Tünd rejim aktiv edildi' : 'İşıqlı rejim aktiv edildi');
}

// ── CUSTOMER FUNCTIONS ──
function customerAction(type) {
  let logText = `Masa ${state.selectedTableId}: `;
  if (type === 'call') {
    logText += "🚨 Ofisiant çağırışı göndərdi.";
    showCustomerToast("Ofisiant çağırıldı! Tezliklə yaxınlaşacaq.");
    triggerAlarm("MASA ÇAĞIRIŞI!", `Masa ${state.selectedTableId} ofisiantı gözləyir.`);
  } else if (type === 'cash') {
    logText += "💵 Nağd ödəniş tələb etdi.";
    showCustomerToast("Nağd ödəniş istəyi admin panelinə ötürüldü.");
  } else if (type === 'pos') {
    logText += "💳 POS Terminal tələb etdi.";
    showCustomerToast("POS Terminal istəyi qəbul olundu.");
  }
  
  state.logs.unshift({ type: 'call', text: logText, time: new Date().toLocaleTimeString().slice(0,5) });
}

function renderCustomerChat() {
  const listEl = document.getElementById('customerChatMsgs');
  if(!listEl) return;
  const msgs = state.chats[state.selectedTableId] || [];
  listEl.innerHTML = msgs.map(m => `
    <div class="cust-bubble ${m.sender === 'customer' ? 'customer' : 'waiter'}">
      ${m.text} <span style="font-size:9px;opacity:0.6;display:block;margin-top:2px;">${m.time}</span>
    </div>
  `).join('');
  listEl.scrollTop = listEl.scrollHeight;
}

function sendCustomerMessage() {
  const input = document.getElementById('customerChatInput');
  if(!input.value.trim()) return;
  
  if(!state.chats[state.selectedTableId]) state.chats[state.selectedTableId] = [];
  state.chats[state.selectedTableId].push({
    sender: 'customer',
    text: input.value,
    time: new Date().toLocaleTimeString().slice(0,5)
  });
  
  input.value = '';
  renderCustomerChat();
  renderWaiterChat();
}

function sendCustomerFeedback() {
  const input = document.getElementById('custFeedbackInput');
  if(!input.value.trim()) return;
  
  state.feedbacks.unshift({
    text: `Masa ${state.selectedTableId}: ${input.value}`,
    time: new Date().toLocaleTimeString().slice(0,5)
  });
  input.value = '';
  showCustomerToast("Rəyiniz üçün təşəkkür edirik! Rəhbərliyə çatdırıldı.");
}

// ── EMERGENCY ALARM MEXANİZMİ ──
function triggerAlarm(title, sub) {
  document.getElementById('alarmTitle').innerText = title;
  document.getElementById('alarmSub').innerText = sub;
  document.getElementById('alarmOverlay').classList.add('show');
}

function muteAlarm() {
  document.getElementById('alarmOverlay').classList.remove('show');
}

// ── WAITER MODULU MEXANİZMİ ──
let currentWaiter = null;
function initWaiterScreen(waiter) {
  currentWaiter = waiter;
  document.getElementById('waiterName').innerText = waiter.name;
  if(waiter.avatar) document.getElementById('waiterAvatar').src = waiter.avatar;
  renderWaiterTables();
}

function renderWaiterTables() {
  const grid = document.getElementById('waiterTablesGrid');
  grid.innerHTML = state.tables.map(t => {
    let cls = '';
    let statusText = 'Boş';
    
    if (t.waiterId === currentWaiter.id) {
      cls = 'mine';
      statusText = t.status === 'occupied' ? 'Aktiv Masa' : 'Sənə aid boş';
    } else if (t.waiterId === null) {
      cls = 'other-manage';
      statusText = 'Ofisiant yoxdur';
    } else {
      cls = 'other';
      statusText = 'Digər Ofisiant';
    }
    
    return `
      <div class="w-table-card ${cls}" onclick="selectWaiterTable(${t.id}, '${cls}')">
        <div class="w-table-name">${t.name}</div>
        <div class="w-table-status">${statusText}</div>
      </div>
    `;
  }).join('');
}

function selectWaiterTable(id, cls) {
  if (cls === 'other') {
    showToast('Bu masaya baxmaq icazəniz yoxdur!');
    return;
  }
  state.selectedTableId = id;
  const table = state.tables.find(t => t.id === id);
  document.getElementById('tableNotesInput').value = table.notes || '';
  
  // Çat panelini aç
  document.getElementById('chatTargetTitle').innerText = `💬 ${table.name} ilə Canlı Çat`;
  document.getElementById('waiterChatPanel').classList.add('show');
  renderWaiterChat();
}

function saveTableNotes() {
  const table = state.tables.find(t => t.id === state.selectedTableId);
  if(table) {
    table.notes = document.getElementById('tableNotesInput').value;
  }
}

function closeWaiterChat() {
  document.getElementById('waiterChatPanel').classList.remove('show');
}

function renderWaiterChat() {
  const listEl = document.getElementById('waiterChatMsgs');
  if(!listEl) return;
  const msgs = state.chats[state.selectedTableId] || [];
  listEl.innerHTML = msgs.map(m => `
    <div class="chat-bubble ${m.sender === 'customer' ? 'customer' : 'waiter'}">
      ${m.text} <span style="font-size:9px;opacity:0.5;display:block;margin-top:2px;">${m.time}</span>
    </div>
  `).join('');
  listEl.scrollTop = listEl.scrollHeight;
}

function sendWaiterMessage() {
  const input = document.getElementById('waiterChatInput');
  if(!input.value.trim()) return;
  
  if(!state.chats[state.selectedTableId]) state.chats[state.selectedTableId] = [];
  state.chats[state.selectedTableId].push({
    sender: 'waiter',
    text: input.value,
    time: new Date().toLocaleTimeString().slice(0,5)
  });
  
  input.value = '';
  renderWaiterChat();
  renderCustomerChat();
}

// ── KITCHEN SCREEN MEXANİZMİ ──
function initKitchenScreen() {
  renderKitchenGrid();
}

function renderKitchenGrid() {
  const grid = document.getElementById('kitchenGrid');
  // Mətbəx üçün aşpaz statusunu və ya yemək siyahılarını simulyasiya edirik
  grid.innerHTML = `
    <div class="k-card ready" onclick="showToast('Sifariş hazır olaraq qeyd edildi')">
      <img src="https://images.unsplash.com/photo-1544025162-d76694265947?w=150" alt="food">
      <h3>🥩 Quzu Antrikot</h3>
      <div class="k-status">HAZIRDIR</div>
      <div class="k-tables-under"><div class="k-table-chip">Masa 4</div></div>
    </div>
    <div class="k-card called" onclick="showToast('Mətbəx xəbərdar edildi')">
      <img src="https://images.unsplash.com/photo-1606755962773-d324e0a13086?w=150" alt="food">
      <h3>🍔 İpək Yolu Burger</h3>
      <div class="k-status">YENİ SİFARİŞ</div>
      <div class="k-tables-under"><div class="k-table-chip">Masa 1</div></div>
    </div>
  `;
}

// ── ADMIN PANEL TAB CONTROL & RENDERING ──
function adminTab(tabName, btn) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(`sec-${tabName}`).classList.add('active');
}

function initAdminPanel() {
  renderAdminStaff();
  renderAdminTables();
  renderAdminLogs();
  renderAdminFeedbacks();
  renderAdminPayments();
}

function renderAdminStaff() {
  const grid = document.getElementById('staffGrid');
  grid.innerHTML = state.staff.map(s => `
    <div class="item-card">
      <div class="item-card-header">
        <img src="${s.avatar}" class="avatar" alt="avatar">
        <div class="item-info">
          <h3>${s.name}</h3>
          <small>Rol: ${s.role === 'waiter' ? 'Ofisiant' : 'Mətbəx'} | PIN: ${s.pin}</small>
        </div>
      </div>
      <span class="status-badge ${s.status === 'active' ? 'badge-green' : 'badge-red'}">${s.status}</span>
    </div>
  `).join('');
}

function renderAdminTables() {
  const grid = document.getElementById('tablesGrid');
  grid.innerHTML = state.tables.map(t => `
    <div class="item-card">
      <h3>${t.name}</h3>
      <div style="font-size:13px;color:var(--text2);margin:4px 0 10px;">Kateqoriya: ${t.category}</div>
      <span class="status-badge ${t.status === 'occupied' ? 'badge-red' : 'badge-green'}">
        ${t.status === 'occupied' ? 'Dolu' : 'Boş'}
      </span>
    </div>
  `).join('');
}

function renderAdminLogs() {
  const list = document.getElementById('logList');
  list.innerHTML = state.logs.map(l => `
    <div class="log-item">
      <span class="log-badge" style="background:rgba(52,152,219,0.15);color:var(--blue)">${l.type.toUpperCase()}</span>
      <span class="log-text">${l.text}</span>
      <span class="log-time">${l.time}</span>
    </div>
  `).join('');
}

function renderAdminFeedbacks() {
  const list = document.getElementById('feedbackList');
  list.innerHTML = state.feedbacks.map(f => `
    <div class="log-item">
      <span class="log-badge" style="background:rgba(241,196,15,0.2);color:var(--orange-dark)">MÜŞTƏRİ RƏYİ</span>
      <span class="log-text">${f.text}</span>
      <span class="log-time">${f.time}</span>
    </div>
  `).join('');
}

function renderAdminPayments() {
  const list = document.getElementById('paymentsList');
  list.innerHTML = state.payments.map(p => `
    <div class="log-item">
      <span class="log-badge" style="background:rgba(46,204,113,0.15);color:var(--green)">KASSA</span>
      <span class="log-text">${p.table} — ${p.method} Ödəniş</span>
      <span class="log-time"><strong>${p.amount.toFixed(2)} ₼</strong><br><small>${p.time}</small></span>
    </div>
  `).join('');
}

function filterLogs(type, btn) {
  document.querySelectorAll('.log-filter').forEach(f => f.classList.remove('active'));
  btn.classList.add('active');
  const filtered = type === 'all' ? state.logs : state.logs.filter(l => l.type === type);
  const list = document.getElementById('logList');
  list.innerHTML = filtered.map(l => `
    <div class="log-item">
      <span class="log-badge" style="background:rgba(52,152,219,0.15);color:var(--blue)">${l.type.toUpperCase()}</span>
      <span class="log-text">${l.text}</span>
      <span class="log-time">${l.time}</span>
    </div>
  `).join('');
}

// ── DEMO REJİMİ ÜÇÜN HƏR İKİ EKRANI EYNİ ANDA SINAQDAN KEÇİRMƏK ──
// QR kodla daxil olan müştərini simulyasiya etmək üçün bu funksiyanı konsoldan və ya birbaşa çağırmaq olar:
// showScreen('customerScreen'); 
</script>
</body>
</html>
