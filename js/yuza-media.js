/* ═══════════════════════════════════════════
   YUZA POS — ŞƏKİLLƏR (Cloudflare R2) · Mərhələ 3b (19.11.2026)
   Məhsul şəkli bazaya base64 kimi YAZILMIR: serverə (R2) yüklənir, bazaya yalnız qısa ünvan düşür.
   Server əlçatmazdırsa (və ya R2 qoşulmayıbsa) köhnə qayda ilə base64 saxlanılır — iş dayanmır,
   sonra "Şəkilləri serverə köçür" düyməsi onları köçürür.
═══════════════════════════════════════════ */
import { api, apiOn } from './yuza-api.js';

export const isDataImg = (s) => typeof s === 'string' && s.startsWith('data:image/');

/* Şəkli kiçildir (ən çox 640 px, JPEG) — faylı və ya data: mətnini qəbul edir */
export function compressImage(src, { max = 640, q = 0.82 } = {}) {
  return new Promise((resolve, reject) => {
    const go = (url) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', q));
      };
      img.onerror = () => reject(new Error('Şəkil formatı dəstəklənmir'));
      img.src = url;
    };
    if (typeof src === 'string') { go(src); return; }
    if (src.size > 8 * 1024 * 1024) { reject(new Error('Şəkil 8MB-dan böyükdür')); return; }
    const rd = new FileReader();
    rd.onerror = () => reject(new Error('Şəkil oxunmadı'));
    rd.onload = () => go(rd.result);
    rd.readAsDataURL(src);
  });
}

/* data: şəkli serverə yükləyir və ünvanını qaytarır. Alınmasa — eyni data: mətnini (köhnə qayda). */
export async function uploadImage(dataUrl, { strict = false } = {}) {
  if (!isDataImg(dataUrl) || !apiOn()) { if (strict) throw new Error('Server qatı qoşulmayıb'); return dataUrl; }
  try {
    const r = await api('mediaPut', { data: dataUrl });
    return r.url || dataUrl;
  } catch (e) {
    if (strict) throw e;
    console.warn('[media] şəkil serverə yüklənmədi, bazada saxlanılır:', e.message);
    return dataUrl;
  }
}

/* Fayl → kiçilt → serverə yüklə → ünvan */
export async function fileToPhoto(file) {
  return uploadImage(await compressImage(file));
}

window.__yzMedia = { uploadImage, compressImage, fileToPhoto, isDataImg };
