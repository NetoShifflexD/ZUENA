// Efectos atados al scroll de un contenedor (paralaje, barras que aparecen, progreso).
// · Nativo cuando hay ScrollTimeline/ViewTimeline: la animación avanza con el scroll en el compositor.
// · Si no, un único listener pasivo con rAF que escribe una variable CSS (--m-scroll, 0 → 1).
import { motionOn } from './core.js';

export const hasScrollTimeline = typeof window.ScrollTimeline === 'function';
const bindings = new Set();
const detached = new MutationObserver(() => {
  for (const binding of bindings) if (!binding.el.isConnected) binding.dispose();
});
function track(el, dispose) {
  const binding = { el, dispose };
  if (!bindings.size) detached.observe(document.documentElement, { childList: true, subtree: true });
  bindings.add(binding);
  return () => {
    bindings.delete(binding);
    if (!bindings.size) detached.disconnect();
  };
}

// progreso 0→1 de `el` entre `start` y `end` px de scroll de `scroller`, en la variable CSS `name`
export function scrollVar(scroller, el, { start = 0, end = 400, name = '--m-scroll' } = {}) {
  if (!scroller || !el) return () => {};
  let raf = 0, last = -1;
  const update = () => {
    raf = 0;
    if (!el.isConnected) { off(); return; }
    const p = motionOn() ? Math.min(1, Math.max(0, (scroller.scrollTop - start) / Math.max(1, end - start))) : 0;
    if (Math.abs(p - last) < 0.003) return;
    last = p;
    el.style.setProperty(name, p.toFixed(3));
  };
  const on = () => { if (!raf) raf = requestAnimationFrame(update); };
  const off = () => { scroller.removeEventListener('scroll', on); document.removeEventListener('prisma-motion-change', on); cancelAnimationFrame(raf); untrack(); };
  const untrack = track(el, off);
  scroller.addEventListener('scroll', on, { passive: true });
  document.addEventListener('prisma-motion-change', on);
  update();
  return off;
}

// paralaje nativo: anima `el` con keyframes según el scroll de `scroller` (sin JS por fotograma)
export function parallax(scroller, el, keyframes, { start = 0, end = 400 } = {}) {
  if (!scroller || !el || !motionOn()) return null;
  if (!hasScrollTimeline) return null; // quien llama usa scrollVar como respaldo
  const timeline = new ScrollTimeline({ source: scroller, axis: 'block' });
  let animation;
  try { animation = el.animate(keyframes, { timeline, rangeStart: `${start}px`, rangeEnd: `${end}px`, fill: 'both', easing: 'linear' }); }
  catch { return null; }
  // El paralaje es decorativo. El movimiento reducido restaura el estilo CSS inicial.
  const stop = () => { if (!motionOn()) animation.cancel(); };
  const cleanup = () => { document.removeEventListener('prisma-motion-change', stop); untrack(); };
  const untrack = track(el, () => { animation.cancel(); cleanup(); });
  document.addEventListener('prisma-motion-change', stop);
  animation.addEventListener('cancel', cleanup, { once: true });
  animation.finished.catch(cleanup);
  return animation;
}
