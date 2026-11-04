// Núcleo del motor: animar con la API de Animaciones Web (compositor, sin JS por fotograma), presets
// con nombre, escalonado y secuencias. Respeta "Animaciones" de Ajustes y prefers-reduced-motion:
// sin movimiento, cada animación salta a su estado final (nunca deja elementos invisibles).
import { SPRINGS, DUR, EASE, DIST } from './tokens.js';
import { springEasing } from './spring.js';

const reduceMq = matchMedia('(prefers-reduced-motion: reduce)');
let userOff = false;
const active = new Map();
function notifyMotion() {
  if (!motionOn()) {
    for (const animation of active.values()) {
      try { animation.finish(); } catch { animation.cancel(); }
    }
  }
  document.dispatchEvent(new CustomEvent('prisma-motion-change', { detail: { enabled: motionOn() } }));
}
export const setMotionEnabled = (on) => {
  const next = !on;
  if (next === userOff) return;
  userOff = next;
  notifyMotion();
};
export const motionOn = () => !userOff && !reduceMq.matches;
reduceMq.addEventListener('change', notifyMotion);

function finalStyles(keyframes) {
  const frame = Array.isArray(keyframes) ? keyframes.at(-1) || {} : keyframes;
  return Object.fromEntries(Object.entries(frame).filter(([key]) => !['offset', 'easing', 'composite'].includes(key))
    .map(([key, value]) => [key, Array.isArray(value) ? value.at(-1) : value]));
}

export function cancel(target, { finish = false } = {}) {
  for (const el of toList(target)) {
    const animation = active.get(el);
    if (!animation) continue;
    if (finish) { try { animation.finish(); } catch { animation.cancel(); } }
    else animation.cancel();
  }
}

// opciones: { spring: 'smooth' | {stiffness…}, duration, easing, delay, fill }
function timing(opts = {}) {
  let { duration, easing } = opts;
  if (opts.spring) {
    const s = springEasing(typeof opts.spring === 'string' ? SPRINGS[opts.spring] : opts.spring);
    easing ||= s.easing;
    duration ??= s.duration;
  }
  if (easing?.startsWith('linear(') && !CSS.supports('animation-timing-function', easing)) easing = EASE.out;
  return { duration: duration ?? DUR.base, easing: easing || EASE.out, delay: opts.delay || 0, fill: opts.fill || 'both', ...(opts.composite ? { composite: opts.composite } : {}) };
}

// animate(elementos, keyframes, opciones) → Promise (se resuelve al terminar; nunca rechaza)
export function animate(target, keyframes, opts = {}) {
  const els = toList(target);
  if (!els.length) return Promise.resolve();
  cancel(els);
  if (!motionOn()) {
    if (opts.commit !== false) els.forEach((el) => Object.assign(el.style, finalStyles(keyframes)));
    return Promise.resolve();
  }
  const t = timing(opts);
  return Promise.all(els.map((el, i) => {
    if (typeof el.animate !== 'function') {
      if (opts.commit !== false) Object.assign(el.style, finalStyles(keyframes));
      return Promise.resolve();
    }
    let a;
    try { a = el.animate(keyframes, { ...t, delay: t.delay + (opts.stagger ? i * opts.stagger : 0) }); }
    catch {
      if (opts.commit !== false) Object.assign(el.style, finalStyles(keyframes));
      return Promise.resolve();
    }
    active.set(el, a);
    return a.finished.then(() => {
      if (active.get(el) !== a || opts.commit === false) return;
      try { a.commitStyles(); }
      catch { Object.assign(el.style, finalStyles(keyframes)); }
    }).catch(() => {}).finally(() => {
      if (active.get(el) === a) active.delete(el);
      a.cancel();
    });
  }));
}

const toList = (t) => (!t ? [] : typeof t === 'string' ? [...document.querySelectorAll(t)] : t instanceof Element ? [t] : [...t]);

// presets con nombre (keyframes + timing por defecto)
export const PRESETS = {
  fadeUp: () => [[{ opacity: 0, transform: `translateY(${DIST.lg}px)` }, { opacity: 1, transform: 'none' }], { spring: 'gentle' }],
  fadeIn: () => [[{ opacity: 0 }, { opacity: 1 }], { duration: DUR.slow }],
  scaleIn: () => [[{ opacity: 0, transform: 'scale(.92)' }, { opacity: 1, transform: 'none' }], { spring: 'smooth' }],
  blurIn: () => [[{ opacity: 0, filter: 'blur(12px)', transform: 'scale(1.04)' }, { opacity: 1, filter: 'blur(0)', transform: 'none' }], { duration: DUR.slower, easing: EASE.emphasized }],
  slideLeft: () => [[{ opacity: 0, transform: `translateX(${DIST.xl}px)` }, { opacity: 1, transform: 'none' }], { spring: 'smooth' }],
  pop: () => [[{ scale: '1' }, { scale: '1.28', offset: 0.4 }, { scale: '1' }], { spring: 'bouncy', commit: false }],
  press: () => [[{ scale: '1' }, { scale: '.94', offset: 0.35 }, { scale: '1' }], { spring: 'snappy', commit: false }],
  shake: () => [[{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }], { duration: DUR.slow, commit: false }],
  exitDown: () => [[{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateY(${DIST.md}px) scale(.98)` }], { duration: DUR.base, easing: EASE.in }],
};

// play('fadeUp', elementos, { stagger: 40, delay… })
export function play(name, target, opts = {}) {
  if (!PRESETS[name]) return Promise.resolve();
  const [frames, base] = PRESETS[name]();
  return animate(target, frames, { ...base, ...opts });
}

// secuencia: pasos [[preset|keyframes, elementos, opciones], …] uno detrás de otro (o con `at` en ms)
export async function sequence(steps) {
  const runs = steps.map(([what, target, opts = {}]) => {
    const go = () => (typeof what === 'string' ? play(what, target, opts) : animate(target, what, opts));
    if (opts.at == null) return null;
    if (!motionOn()) return go();
    return new Promise((resolve) => {
      const run = () => {
        clearTimeout(timer);
        document.removeEventListener('prisma-motion-change', changed);
        go().then(resolve);
      };
      const changed = () => { if (!motionOn()) run(); };
      const timer = setTimeout(run, opts.at);
      document.addEventListener('prisma-motion-change', changed);
    });
  });
  for (let i = 0; i < steps.length; i++) {
    if (runs[i]) continue;
    const [what, target, opts = {}] = steps[i];
    await (typeof what === 'string' ? play(what, target, opts) : animate(target, what, opts));
  }
  await Promise.all(runs.filter(Boolean));
}
