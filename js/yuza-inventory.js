/* ═══════════════════════════════════════════
   YUZA POS — ANBAR VƏ MƏHSUL SİSTEMİ (giriş nöqtəsi)
   index.html-də yalnız bu fayl qoşulur; qalanları buradan yüklənir.
   Geri qaytarmaq: index.html-dən bu <script> sətrini silmək kifayətdir
   (Parametrlərdən rejimi "köhnə"yə qaytardıqdan sonra).
═══════════════════════════════════════════ */
import { initShell } from './yuza-inv-ui.js';
import './yuza-inv-catalog.js';
import './yuza-inv-purchase.js';
import './yuza-inv-stock.js';

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initShell);
else initShell();
