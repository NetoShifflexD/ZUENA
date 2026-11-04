// Entradas al desplazar, declarativas: <div data-reveal="fadeUp" data-reveal-stagger="40">.
// · Con soporte de animaciones atadas al scroll (CSS `animation-timeline: view()`), las hace el navegador
//   en el compositor: cero JS. Ver css/motion.css ([data-reveal] en @supports).
// · Si no hay soporte (Safari viejo), un único IntersectionObserver para toda la app reproduce el preset.
// · Los hijos de un [data-reveal-children] entran escalonados.
import { play, motionOn } from './core.js';

export const nativeScroll = CSS.supports('animation-timeline: view()');
let io = null;
const waiting = new Set();
document.addEventListener('prisma-motion-change', () => {
  if (motionOn()) return;
  io?.disconnect();
  waiting.clear();
  document.querySelectorAll('.m-wait').forEach((el) => {
    el.classList.remove('m-wait');
    el.classList.add('m-in');
  });
});

function observer() {
  io ||= new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      waiting.delete(e.target);
      const el = e.target;
      el.classList.remove('m-wait');
      const name = el.dataset.reveal || 'fadeUp';
      const kids = el.hasAttribute('data-reveal-children') ? [...el.children] : [el];
      el.classList.add('m-in');
      play(name, kids, { stagger: +el.dataset.revealStagger || (kids.length > 1 ? 40 : 0) });
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
  return io;
}

// prepara todo [data-reveal] dentro de root (se llama después de cada render)
export function reveal(root = document) {
  for (const el of waiting) {
    if (!el.isConnected) {
      io?.unobserve(el);
      waiting.delete(el);
      el.classList.remove('m-wait');
      el.classList.add('m-in');
    }
  }
  const els = root.querySelectorAll('[data-reveal]:not(.m-ready)');
  if (!els.length) return;
  for (const el of els) {
    el.classList.add('m-ready');
    if (!motionOn()) { el.classList.add('m-in'); continue; }
    if (nativeScroll && !el.hasAttribute('data-reveal-js')) { el.classList.add('m-native'); continue; }
    el.classList.add('m-wait');
    waiting.add(el);
    observer().observe(el);
  }
}
