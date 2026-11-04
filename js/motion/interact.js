// Microinteracciones con resorte, por delegación (un listener para toda la app):
// · [data-press]   el elemento se hunde al presionar y rebota al soltar (también todos los botones de la app)
// · [data-magnet]  el elemento sigue un poco al puntero (botones principales, carátulas)
// · [data-tilt]    inclinación 3D sutil siguiendo al puntero (tarjetas destacadas)
// Sólo con mouse/lápiz para imán e inclinación; el toque táctil usa sólo [data-press].
import { play, motionOn } from './core.js';
import { springValue } from './spring.js';

// selectores: además de los atributos, los controles de la app que siempre tienen esta respuesta
const PRESS = '[data-press], .btn-primary, .btn-glass, .btn-icon, .pa, .seg-btn, .chip, .fx-tab, .np-tab, .quick-tile';
const MAGNET = '[data-magnet], .btn-play, .controls.big .btn-play, .hc .btn-primary';
const TILT = '[data-tilt], .hc-stack';
const FOLLOW = `${MAGNET}, ${TILT}`;

const instances = new WeakMap();
const BLOCKED = ':disabled, [disabled], [aria-disabled="true"], [inert], .scrolling';

export function initInteractions(root = document) {
  if (instances.has(root)) return instances.get(root);
  const doc = root.ownerDocument || root;
  const win = doc.defaultView;
  const reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
  const listeners = new AbortController();
  const live = new Map();
  const presses = new Set();
  let active = null, rect = null, pending = null, raf = 0, scrollTimer = 0;
  let disposed = false;
  const allowed = (el) => !disposed && !doc.hidden && !scrollTimer && motionOn()
    && el.isConnected && !el.closest(BLOCKED);
  const closest = (target, selector) => {
    const el = target?.closest?.(selector);
    return el && root.contains(el) ? el : null;
  };
  const restore = (el, f) => {
    f.sx.stop(); f.sy.stop();
    for (const [name, value, priority] of f.saved) {
      if (value) el.style.setProperty(name, value, priority);
      else el.style.removeProperty(name);
    }
    live.delete(el);
    if (active === el) { active = null; rect = null; }
  };
  const reset = () => {
    win.cancelAnimationFrame(raf);
    raf = 0; pending = null; active = null; rect = null;
    for (const [el, f] of live) restore(el, f);
    for (const animation of presses) animation.cancel();
    presses.clear();
  };
  const leave = () => {
    const f = live.get(active);
    if (f) { f.returning = true; f.sx.set(0); f.sy.set(0); }
    active = null; rect = null;
  };
  const follower = (el) => {
    if (live.has(el)) return live.get(el);
    const tilt = el.matches(TILT);
    const saved = ['transform', '--m-light-x', '--m-light-y'].map((name) =>
      [name, el.style.getPropertyValue(name), el.style.getPropertyPriority(name)]);
    const f = { saved, returning: false };
    const paint = () => {
      if (!allowed(el) || (f.returning && f.sx.value === 0 && f.sy.value === 0)) {
        // stop() durante onUpdate no impide que tick agende su próximo frame.
        queueMicrotask(() => { if (live.get(el) === f) restore(el, f); });
        return;
      }
      const base = saved[0][1] && saved[0][1] !== 'none' ? saved[0][1] + ' ' : '';
      el.style.transform = base + (tilt
        ? `perspective(800px) rotateX(${(-f.sy.value * 6).toFixed(2)}deg) rotateY(${(f.sx.value * 6).toFixed(2)}deg)`
        : `translate(${(f.sx.value * 6).toFixed(2)}px, ${(f.sy.value * 6).toFixed(2)}px)`);
    };
    f.sx = springValue(0, { stiffness: 220, damping: 20, onUpdate: paint });
    f.sy = springValue(0, { stiffness: 220, damping: 20, onUpdate: paint });
    live.set(el, f);
    return f;
  };
  const follow = () => {
    raf = 0;
    const sample = pending;
    pending = null;
    if (!sample) return;
    const el = closest(sample.target, FOLLOW);
    if (!el || !allowed(el) || sample.target.closest?.(BLOCKED)) {
      reset();
      return;
    }
    if (active !== el) { leave(); active = el; }
    // Una lectura por entrada; scroll/resize invalidan la geometría.
    rect ||= el.getBoundingClientRect();
    if (!rect.width || !rect.height) { reset(); return; }
    const nx = Math.max(-1, Math.min(1, ((sample.x - rect.left) / rect.width - 0.5) * 2));
    const ny = Math.max(-1, Math.min(1, ((sample.y - rect.top) / rect.height - 0.5) * 2));
    const f = follower(el);
    f.returning = false;
    f.sx.set(nx); f.sy.set(ny);
    el.style.setProperty('--m-light-x', `${((nx + 1) * 50).toFixed(1)}%`);
    el.style.setProperty('--m-light-y', `${((ny + 1) * 50).toFixed(1)}%`);
  };
  const listen = (target, type, handler, capture = false) =>
    target.addEventListener(type, handler, { passive: true, capture, signal: listeners.signal });
  listen(root, 'pointerdown', (e) => {
    const el = closest(e.target, PRESS);
    if (!el || !allowed(el) || e.target.closest?.(BLOCKED)) return;
    // Sólo cancelar las animaciones creadas por esta interacción.
    const before = new Set(el.getAnimations());
    play('press', el);
    for (const animation of el.getAnimations()) {
      if (before.has(animation)) continue;
      presses.add(animation);
      animation.finished.then(() => presses.delete(animation), () => presses.delete(animation));
    }
  });
  listen(root, 'pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    if (!motionOn() || scrollTimer || doc.hidden) { reset(); return; }
    pending = { target: e.target, x: e.clientX, y: e.clientY };
    if (!raf) raf = win.requestAnimationFrame(follow);
  });
  listen(root, 'pointerout', (e) => {
    if (pending && !closest(e.relatedTarget, FOLLOW)?.contains(pending.target)) {
      pending = null;
    }
    if (active && !active.contains(e.relatedTarget)) leave();
  });
  const scroll = () => {
    reset();
    win.clearTimeout(scrollTimer);
    scrollTimer = win.setTimeout(() => { scrollTimer = 0; }, 140);
  };
  listen(doc, 'scroll', scroll, true);
  listen(win, 'resize', reset);
  listen(root, 'pointercancel', reset);
  listen(win, 'blur', reset);
  listen(doc, 'visibilitychange', reset);
  const motionChanged = () => { if (!motionOn() || reduced.matches) reset(); };
  listen(doc, 'prisma-motion-change', motionChanged);
  listen(reduced, 'change', motionChanged);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    listeners.abort();
    win.clearTimeout(scrollTimer);
    scrollTimer = 0;
    reset();
    instances.delete(root);
  };
  instances.set(root, dispose);
  return dispose;
}
