// Visualizador "seda": un listón de luz a todo el ancho de "Ahora suena". Cian (graves) a la izquierda,
// ámbar (agudos) a la derecha, cresta fina y cuerpo translúcido que se desvanece hacia abajo.
// Sin filtros de canvas (blur): el halo se arma con trazos apilados y degradados, que cuestan poco.
const BANDS = [[30, 120], [120, 400], [400, 1500], [1500, 5000], [5000, 16000]];
const POINTS = 40;
const MAX_W = 1280; // el lienzo nunca pasa de este ancho en píxeles; el navegador lo estira (todo es difuso)

export class Visualizer {
  constructor(canvas, analyser) {
    this.cv = canvas;
    this.cx = canvas.getContext('2d');
    this.an = analyser;
    this.data = new Uint8Array(analyser.frequencyBinCount);
    this.levels = new Float32Array(BANDS.length);
    this.ranges = null;
    this.running = false;
    this.t = 0;
    this.dark = false;
    this.ca = [80, 240, 255];  // color izquierdo (graves)
    this.cb = [255, 205, 130]; // color derecho (agudos)
    this.ys = new Float32Array(POINTS);
    this.frame = null;
    this.last = null;
    this.inView = false;
    this.motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.sync = this.sync.bind(this);
    this.tick = this.tick.bind(this);
    this.observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      this.inView = entry.isIntersecting && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0;
      this.sync();
    }, { threshold: [0, Number.EPSILON] });
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  resize() {
    const r = this.cv.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const k = Math.min(Math.min(2, window.devicePixelRatio || 1), MAX_W / r.width);
    const width = Math.max(2, Math.round(r.width * k));
    const height = Math.max(2, Math.round(r.height * k));
    if (this.cv.width === width && this.cv.height === height) return;
    this.cv.width = width;
    this.cv.height = height;
    this.grads = null;
    this.sync();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.dark = document.documentElement.dataset.scheme === 'dark';
    this.grads = null;
    if (!this.ranges) {
      const hz = this.an.context.sampleRate / 2 / this.data.length;
      this.ranges = BANDS.map(([a, b]) => [Math.max(1, Math.floor(a / hz)), Math.ceil(b / hz)]);
    }
    document.addEventListener('visibilitychange', this.sync);
    this.motion.addEventListener('change', this.sync);
    this.observer.observe(this.cv);
  }

  stop() {
    this.running = false;
    this.observer.disconnect();
    this.inView = false;
    document.removeEventListener('visibilitychange', this.sync);
    this.motion.removeEventListener('change', this.sync);
    this.sync();
  }

  sync() {
    if (!this.running || !this.inView || document.hidden) {
      if (this.frame !== null) cancelAnimationFrame(this.frame);
      this.frame = null;
      this.last = null;
    } else if (this.frame === null) {
      this.frame = requestAnimationFrame(this.tick);
    }
  }

  tick(now) {
    this.frame = null;
    if (!this.running || !this.inView || document.hidden) return;
    const reduced = this.motion.matches;
    if (!reduced && this.last !== null) this.t += Math.min(0.05, (now - this.last) / 1000);
    this.last = reduced ? null : now;
    this.draw();
    // En movimiento reducido queda una muestra del espectro hasta el próximo cambio.
    if (!reduced) this.sync();
  }

  // colores de la carátula (o los iridiscentes por defecto)
  setColors(a, b) {
    this.ca = a || [80, 240, 255];
    this.cb = b || [255, 205, 130];
    this.grads = null;
    this.sync();
  }

  // degradados que no cambian entre fotogramas: se crean una vez por tamaño/colores
  buildGradients(W, H) {
    const { cx } = this;
    const A = this.ca.join(','), B = this.cb.join(',');
    const line = cx.createLinearGradient(0, 0, W, 0);
    line.addColorStop(0, `rgba(${A},0)`);
    line.addColorStop(0.18, `rgba(${A},.95)`);
    line.addColorStop(0.55, 'rgba(196,176,255,.8)');
    line.addColorStop(0.82, `rgba(${B},.95)`);
    line.addColorStop(1, `rgba(${B},0)`);
    const body = cx.createLinearGradient(0, 0, W, 0);
    body.addColorStop(0, `rgba(${A},0)`);
    body.addColorStop(0.25, `rgba(${A},.5)`);
    body.addColorStop(0.55, 'rgba(196,176,255,.32)');
    body.addColorStop(0.78, `rgba(${B},.5)`);
    body.addColorStop(1, `rgba(${B},0)`);
    // máscara vertical: el cuerpo se disuelve hacia abajo
    const fade = cx.createLinearGradient(0, H * 0.45, 0, H);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(1, 'rgba(0,0,0,1)');
    this.grads = { line, body, fade };
  }

  draw() {
    const { cv, cx, an, data, levels, ys } = this;
    const W = cv.width, H = cv.height;
    if (!W || !H) return;
    if (!this.grads) this.buildGradients(W, H);
    const { line, body, fade } = this.grads;
    an.getByteFrequencyData(data);
    this.ranges.forEach(([a, b], i) => {
      let s = 0;
      for (let k = a; k < b; k++) s += data[k];
      const v = Math.min(1, s / (b - a) / 200);
      levels[i] = v > levels[i] ? v * 0.5 + levels[i] * 0.5 : levels[i] * 0.93;
    });
    const [sub, low, mid, hiMid, high] = levels;
    const t = this.t;
    const light = !this.dark;
    cx.clearRect(0, 0, W, H);

    // cresta: curva en "S" suave; cada tramo ondula con la energía de su banda
    for (let i = 0; i < POINTS; i++) {
      const u = i / (POINTS - 1);
      const bp = u * (levels.length - 1);
      const b0 = Math.floor(bp), f = bp - b0;
      const band = levels[b0] * (1 - f) + levels[Math.min(levels.length - 1, b0 + 1)] * f;
      const s = 0.5 - 0.5 * Math.cos(Math.PI * u); // 0→1 suavizado: sube de izquierda a derecha
      const base = H * (0.78 - 0.3 * s);
      const swell = Math.sin(t * 1.1 + u * 5.2) * 0.6 + Math.sin(t * 1.9 - u * 9.5) * 0.4;
      ys[i] = base + swell * H * (0.02 + band * 0.09);
    }
    const trace = (close) => {
      cx.beginPath();
      cx.moveTo(0, ys[0]);
      for (let i = 0; i < POINTS - 1; i++) {
        const x0 = (i / (POINTS - 1)) * W, x1 = ((i + 1) / (POINTS - 1)) * W;
        cx.quadraticCurveTo(x0, ys[i], (x0 + x1) / 2, (ys[i] + ys[i + 1]) / 2);
      }
      cx.lineTo(W, ys[POINTS - 1]);
      if (close) { cx.lineTo(W, H); cx.lineTo(0, H); cx.closePath(); }
    };

    // cuerpo translúcido bajo la cresta (se desvanece hacia abajo)
    cx.save();
    trace(true);
    cx.fillStyle = body;
    cx.globalAlpha = light ? 0.55 : 0.7;
    cx.fill();
    cx.globalCompositeOperation = 'destination-out';
    cx.globalAlpha = 1;
    cx.fillStyle = fade;
    cx.fillRect(0, 0, W, H);
    cx.restore();

    cx.save();
    cx.globalCompositeOperation = 'destination-over';
    // luces grandes y suaves (se pintan DESPUÉS del cuerpo y por detrás): cian con los graves, ámbar con los agudos
    const glow = (x, y, r, rgb, a) => {
      const g = cx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${rgb},${a.toFixed(3)})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      cx.fillStyle = g;
      cx.fillRect(x - r, y - r, r * 2, r * 2);
    };
    const R = Math.max(W, H * 1.6);
    glow(W * (0.2 + Math.sin(t * 0.4) * 0.03), H * 0.7, R * (0.28 + (sub + low) * 0.1), this.ca.join(','), 0.62 + (sub + low) * 0.3);
    glow(W * (0.8 + Math.cos(t * 0.35) * 0.03), H * 0.62, R * (0.25 + (hiMid + high) * 0.12), this.cb.join(','), 0.58 + (hiMid + high) * 0.35);
    glow(W * 0.5, H * 0.66, R * (0.2 + mid * 0.1), '200,180,255', 0.18 + mid * 0.22);
    cx.restore();

    // halo de la cresta: trazos anchos y de poca opacidad apilados (reemplaza al blur)
    cx.lineCap = 'round';
    cx.lineJoin = 'round';
    cx.strokeStyle = line;
    trace(false);
    [[0.05, 0.07], [0.028, 0.1], [0.014, 0.16]].forEach(([w, a]) => {
      cx.lineWidth = H * w;
      cx.globalAlpha = a;
      cx.stroke();
    });
    // filo fino de la cresta
    cx.globalAlpha = 1;
    cx.strokeStyle = light ? 'rgba(30,45,60,.7)' : 'rgba(255,255,255,.85)';
    cx.lineWidth = Math.max(1, H / 260);
    cx.stroke();
  }
}
