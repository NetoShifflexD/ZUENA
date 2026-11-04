// Sonidos de interfaz "de vidrio": sintetizados con Web Audio (sin archivos), muy suaves.
// · hover: un "tic" cristalino al pasar el mouse por un control (sólo con mouse, con límite de frecuencia)
// · press: un toque al hacer clic · toggle: dos notas (sube al activar, baja al desactivar)
// Usa su propio AudioContext liviano: no pasa por el ecualizador ni el limitador de la música.
// Se activa/desactiva desde Ajustes → Apariencia ("Sonidos de interfaz").

const TARGETS = 'button, a[href], [role="button"], [role="tab"], .card, .row, .set-cat, .seg-btn, .switch, input[type="range"]';
const HOVER_GAP_MS = 70;

let ctx = null, out = null, enabled = true, lastHover = 0, lastEl = null;

function ensure() {
  if (ctx) return ctx.state === 'running';
  try {
    ctx = new AudioContext({ latencyHint: 'interactive' });
    out = ctx.createGain();
    out.gain.value = 0.5;
    out.connect(ctx.destination);
  } catch { ctx = null; return false; }
  return ctx.state === 'running';
}

// una campanita: seno con un parcial inarmónico y caída exponencial corta
function bell(freq, { gain = 0.05, dur = 0.12, delay = 0, partial = 2.76 } = {}) {
  const t = ctx.currentTime + delay;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(out);
  for (const [mult, amp] of [[1, 1], [partial, 0.28]]) {
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq * mult, t);
    og.gain.value = amp;
    o.connect(og).connect(g);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
}

export const sounds = {
  get enabled() { return enabled; },
  set(on) { enabled = !!on; if (!enabled && ctx?.state === 'running') ctx.suspend(); },
  hover() { if (enabled && ensure()) bell(2350, { gain: 0.018, dur: 0.07 }); },
  press() { if (enabled && ensure()) bell(1180, { gain: 0.05, dur: 0.14, partial: 2.4 }); },
  toggle(on) {
    if (!enabled || !ensure()) return;
    const [a, b] = on ? [880, 1320] : [1320, 880];
    bell(a, { gain: 0.04, dur: 0.1 });
    bell(b, { gain: 0.04, dur: 0.14, delay: 0.06 });
  },
  // sonidos de la landing (más presentes): un acorde de vidrio y un barrido de aire
  chord(base = 523.25, gain = 0.05) {
    if (!enabled || !ensure()) return;
    [1, 1.25, 1.5, 2].forEach((m, i) => bell(base * m, { gain: gain * (1 - i * 0.15), dur: 1.6, delay: i * 0.05, partial: 3.01 }));
  },
  whoosh(dur = 0.6, gain = 0.06) {
    if (!enabled || !ensure()) return;
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.sin((Math.PI * i) / n);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    const t = ctx.currentTime;
    bp.frequency.setValueAtTime(400, t);
    bp.frequency.exponentialRampToValueAtTime(3200, t + dur);
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(bp).connect(g).connect(out);
    src.start(t);
  },
  async resume() { if (enabled && ensure() === false && ctx) { try { await ctx.resume(); } catch { /* sin gesto aún */ } } },
};

// Delegación global: un solo listener para toda la app (barato, sin listeners por elemento).
export function initUiSounds(isOn) {
  sounds.set(isOn);
  // el navegador sólo deja arrancar el audio tras un gesto del usuario
  const unlock = () => { if (enabled) { ensure(); ctx?.resume?.(); } };
  addEventListener('pointerdown', unlock, { capture: true, passive: true });
  addEventListener('keydown', unlock, { capture: true, passive: true });

  document.addEventListener('pointerover', (e) => {
    if (!enabled || e.pointerType !== 'mouse' || ctx?.state !== 'running') return;
    const el = e.target.closest?.(TARGETS);
    if (!el || el === lastEl || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    lastEl = el;
    const now = performance.now();
    if (now - lastHover < HOVER_GAP_MS) return;
    lastHover = now;
    sounds.hover();
  }, { passive: true });
  document.addEventListener('pointerout', (e) => { if (e.target.closest?.(TARGETS) === lastEl && !lastEl?.contains(e.relatedTarget)) lastEl = null; }, { passive: true });

  document.addEventListener('click', (e) => {
    if (!enabled) return;
    const sw = e.target.closest?.('input[type="checkbox"]');
    if (sw) { sounds.toggle(sw.checked); return; }
    const el = e.target.closest?.('button, a[href], [role="button"], [role="tab"], .card, .row');
    if (el && !el.disabled) sounds.press();
  }, { capture: true, passive: true });
}
