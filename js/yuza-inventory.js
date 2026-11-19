/* ═══════════════════════════════════════════
   YUZA POS — ANBAR, KASSA VƏ PATRON PANELİ (giriş nöqtəsi)
   index.html-də yalnız bu fayl qoşulur; qalanları buradan yüklənir.
   Geri qaytarmaq: index.html-dən bu <script> sətrini silmək kifayətdir
   (Parametrlərdən rejimi "köhnə"yə qaytardıqdan sonra).
═══════════════════════════════════════════ */
import { initShell } from './yuza-shell.js';
import './yuza-inv-catalog.js';
import './yuza-inv-purchase.js';
import './yuza-inv-stock.js';
import './yuza-inv-cash.js';

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initShell);
else initShell();
