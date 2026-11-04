// FLIP (First, Last, Invert, Play): anima cambios de maquetado (listas que se reordenan, elementos que
// entran o salen) sin re-maquetar por fotograma. Uso:
//   const done = flip(lista, '[data-flip]');   // 1) mide antes
//   lista.innerHTML = …;                        // 2) cambia el DOM
//   done();                                     // 3) anima de la posición vieja a la nueva
// Cada elemento necesita un id estable en data-flip.
import { animate, motionOn } from './core.js';

export function flip(container, selector = '[data-flip]', opts = {}) {
  if (!container || !motionOn()) return () => {};
  const before = new Map();
  for (const el of container.querySelectorAll(selector)) before.set(el.dataset.flip, el.getBoundingClientRect());
  return () => {
    const fresh = [];
    for (const el of container.querySelectorAll(selector)) {
      const a = before.get(el.dataset.flip);
      const b = el.getBoundingClientRect();
      if (!a) { fresh.push(el); continue; }
      const dx = a.left - b.left, dy = a.top - b.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      animate(el, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { spring: 'smooth', commit: false });
    }
    if (fresh.length) animate(fresh, [{ opacity: 0, transform: 'translateY(-12px) scale(.98)' }, { opacity: 1, transform: 'none' }], { spring: 'smooth', stagger: 35, ...opts });
  };
}
