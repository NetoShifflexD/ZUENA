export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function fmtTime(s) {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  if (m >= 60) return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${m}:${String(r).padStart(2, '0')}`;
}

export const fmtRate = (r) => (r ? `${+(r / 1000).toFixed(1)} kHz` : '');
export const fmtDb = (v, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)} dB`;
export const fmtHz = (f) => (f >= 1000 ? `${f / 1000}k` : `${f}`);

export function quality(t) {
  if (!t) return null;
  if (t.lossless) {
    const bits = t.bitDepth || 16, rate = t.sampleRate || 44100;
    const hi = bits > 16 || rate > 48000;
    return { label: hi ? 'Hi-Res Lossless' : 'Lossless', hi, detail: `${t.codec} · ${bits}-bit / ${fmtRate(rate)}` };
  }
  return { label: t.codec || 'Audio', hi: false, detail: [t.codec, fmtRate(t.sampleRate)].filter(Boolean).join(' · ') };
}

export function hueOf(s) {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.codePointAt(0)) % 360;
  return h;
}

export function greeting() {
  const h = new Date().getHours();
  return h < 6 ? 'Buenas noches' : h < 13 ? 'Buen día' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
}
