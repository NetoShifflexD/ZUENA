// Colores de la carátula para teñir "Ahora suena" y el listón: el tono vivo dominante de cada mitad.
const cache = new Map();

export function artColors(url) {
  if (!url) return Promise.resolve(null);
  if (cache.has(url)) return cache.get(url);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      try {
        const S = 24, cv = document.createElement('canvas');
        cv.width = cv.height = S;
        const cx = cv.getContext('2d', { willReadFrequently: true });
        cx.drawImage(img, 0, 0, S, S);
        const d = cx.getImageData(0, 0, S, S).data; // falla si la imagen no permite CORS → sin colores
        const pick = (x0, x1) => {
          let best = null, bestScore = -1;
          for (let y = 0; y < S; y++) for (let x = x0; x < x1; x++) {
            const i = (y * S + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
            const max = Math.max(r, g, b), min = Math.min(r, g, b);
            const sat = max ? (max - min) / max : 0, lum = (max + min) / 510;
            const score = sat * (1 - Math.abs(lum - 0.55));
            if (score > bestScore) { bestScore = score; best = [r, g, b]; }
          }
          return bestScore > 0.12 ? best : null;
        };
        resolve({ a: pick(0, S / 2), b: pick(S / 2, S) });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
  cache.set(url, p);
  return p;
}
