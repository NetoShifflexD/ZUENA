// Barra de progreso con forma de onda real de la pista. Arrastrable, con vista previa al pasar el mouse.
import { fmtTime } from './format.js';

let colors = { accent: '#fff', text: '#fff', at: 0 };
function themeColors() {
  const now = performance.now();
  if (now - colors.at > 400) {
    const cs = getComputedStyle(document.documentElement);
    colors = { accent: cs.getPropertyValue('--accent').trim(), text: cs.getPropertyValue('--text').trim(), at: now };
  }
  return colors;
}

export class Scrubber {
  constructor(canvas, { onSeek, barWidth = 3, gap = 2 }) {
    this.cv = canvas;
    this.cx = canvas.getContext('2d');
    this.onSeek = onSeek;
    this.barWidth = barWidth;
    this.gap = gap;
    this.wave = null;
    this.pos = 0;
    this.dur = 0;
    this.hover = -1;
    this.drag = -1;
    this.dirty = true;
    this.px = -1;
    this.sec = -1;
    // control deslizante accesible: las flechas del teclado adelantan/atrasan (atajos globales)
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'slider');
    canvas.setAttribute('aria-label', 'Progreso de la reproducción');
    canvas.setAttribute('aria-valuemin', '0');
    this.tip = document.createElement('div');
    this.tip.className = 'scrub-tip';
    canvas.after(this.tip);

    const frac = (e) => {
      const r = canvas.getBoundingClientRect();
      return r.width > 0 ? Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) : 0;
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.dur || canvas.getAttribute('aria-disabled') === 'true' || (e.pointerType === 'mouse' && e.button !== 0)) return;
      try { canvas.setPointerCapture(e.pointerId); } catch {}
      this.hover = this.drag = frac(e);
      this.showTip(e);
      this.dirty = true;
      this.draw();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch' && this.drag < 0) return;
      this.hover = frac(e);
      if (this.drag >= 0) this.drag = this.hover;
      this.showTip(e);
      this.dirty = true;
      this.draw();
    });
    canvas.addEventListener('pointerup', (e) => {
      if (this.drag < 0) return;
      const f = frac(e);
      this.drag = -1;
      if (e.pointerType !== 'mouse') {
        this.hover = -1;
        this.tip.classList.remove('show');
      }
      this.onSeek?.(f * this.dur);
      this.dirty = true;
      this.draw();
    });
    canvas.addEventListener('pointerleave', (e) => {
      if (this.drag >= 0) return;
      this.hover = -1;
      this.tip.classList.remove('show');
      this.dirty = true;
      this.draw();
    });
    const cancelDrag = () => {
      if (this.drag < 0 && this.hover < 0) return;
      this.drag = -1;
      this.hover = -1;
      this.tip.classList.remove('show');
      this.dirty = true;
      this.draw();
    };
    canvas.addEventListener('pointercancel', cancelDrag);
    canvas.addEventListener('lostpointercapture', cancelDrag);
    canvas.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      if (!this.dur || canvas.getAttribute('aria-disabled') === 'true') return;
      const step = e.shiftKey ? 15 : 5;
      const t = e.key === 'Home' ? 0 : e.key === 'End' ? this.dur : this.pos + (['ArrowLeft', 'ArrowDown'].includes(e.key) ? -step : step);
      this.onSeek?.(Math.max(0, Math.min(this.dur, t)));
    });
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  showTip(e) {
    if (!this.dur) return;
    const r = this.cv.getBoundingClientRect();
    const x = Math.min(Math.max(20, e.clientX - r.left), Math.max(20, r.width - 20));
    this.tip.textContent = fmtTime(this.hover * this.dur);
    this.tip.style.left = `${this.cv.offsetLeft + x}px`;
    this.tip.classList.add('show');
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = this.cv.getBoundingClientRect();
    this.cv.width = Math.max(1, Math.round(width * dpr));
    this.cv.height = Math.max(1, Math.round(height * dpr));
    this.dirty = true;
    this.draw();
  }

  setWave(w) { this.wave = w || null; this.dirty = true; }

  set(pos, dur) {
    this.pos = pos;
    if (dur !== this.dur) { this.dur = dur; this.dirty = true; this.cv.setAttribute('aria-valuemax', String(Math.round(dur))); }
    // redibujar sólo cuando el progreso avanza al menos un píxel
    const px = dur ? Math.round((pos / dur) * this.cv.width) : 0;
    if (px !== this.px) { this.px = px; this.dirty = true; }
    const s = Math.floor(pos);
    if (s !== this.sec) { this.sec = s; this.cv.setAttribute('aria-valuenow', String(s)); this.cv.setAttribute('aria-valuetext', `${fmtTime(pos)} de ${fmtTime(dur)}`); }
    if (this.dirty) this.draw();
  }

  draw() {
    this.dirty = false;
    const { cv, cx } = this;
    const W = cv.width, H = cv.height;
    if (!W || !H) return;
    const dpr = window.devicePixelRatio || 1;
    const { accent, text } = themeColors();
    cx.clearRect(0, 0, W, H);
    const prog = this.drag >= 0 ? this.drag : this.dur ? this.pos / this.dur : 0;
    const px = prog * W;
    const hx = this.hover >= 0 ? this.hover * W : -1;

    if (!this.wave) {
      const h = Math.round((this.drag >= 0 ? 6 : 4) * dpr), y = (H - h) / 2;
      cx.globalAlpha = 0.22; cx.fillStyle = text; round(cx, 0, y, W, h, h / 2);
      if (hx >= 0) { cx.globalAlpha = 0.18; round(cx, 0, y, hx, h, h / 2); }
      cx.globalAlpha = 1; cx.fillStyle = accent; round(cx, 0, y, px, h, h / 2);
      if (this.dur > 0) {
        const rad = (this.drag >= 0 ? 7 : 5) * dpr;
        const cxPos = Math.min(W - rad, Math.max(rad, px));
        cx.beginPath();
        cx.arc(cxPos, H / 2, rad, 0, Math.PI * 2);
        cx.fill();
      }
      return;
    }

    const bw = this.barWidth * dpr, step = (this.barWidth + this.gap) * dpr;
    const n = Math.floor(W / step);
    const wave = this.wave;
    for (let i = 0; i < n; i++) {
      const a = Math.floor((i / n) * wave.length), b = Math.max(a + 1, Math.floor(((i + 1) / n) * wave.length));
      let v = 0;
      for (let k = a; k < b; k++) v = Math.max(v, wave[k] || 0);
      const h = Math.max(2 * dpr, v * H * 0.92);
      const x = i * step;
      const played = x + bw <= px;
      cx.fillStyle = played ? accent : text;
      cx.globalAlpha = played ? 1 : hx >= 0 && x < hx ? 0.45 : 0.24;
      round(cx, x, (H - h) / 2, bw, h, bw / 2);
    }
    cx.globalAlpha = 1;
  }
}

function round(cx, x, y, w, h, r) {
  if (w <= 0) return;
  cx.beginPath();
  cx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
  cx.fill();
}
