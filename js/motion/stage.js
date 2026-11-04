// Prisma Motion · Escena (0.4.0, 2026-11-02): desplazamiento suave y animaciones atadas al scroll para páginas de
// presentación (la landing). Usa GSAP 3.13 (ScrollTrigger, SplitText) y Lenis 1.1, instalados en js/vendor/ (sin CDN:
// funcionan sin conexión y sin abrir la CSP). Se cargan recién al crear una escena, así la app no paga su peso.
//   const st = await motion.stage(scroller, content);   // null con movimiento reducido o "Animaciones" apagado
//   st.add(() => st.gsap.from(...));  st.split(el, 'chars');  st.destroy();
// Las curvas salen de los tokens del motor (EASE / resortes); no se inventan duraciones sueltas.
import { motionOn } from './core.js';
import { DUR } from './tokens.js';

let libs = null;
const script = (src) => new Promise((ok, fail) => {
  const url = new URL(src, import.meta.url).href;
  if ([...document.scripts].some((s) => s.src === url)) { ok(); return; }
  const s = document.createElement('script');
  s.src = url; s.onload = ok; s.onerror = () => fail(new Error(`no se pudo cargar ${src}`));
  document.head.append(s);
});

export function loadStage() {
  libs ||= (async () => {
    await script('../vendor/gsap.min.js');
    await Promise.all([script('../vendor/ScrollTrigger.min.js'), script('../vendor/SplitText.min.js')]);
    const { default: Lenis } = await import('../vendor/lenis.js');
    const { gsap, ScrollTrigger, SplitText } = window;
    gsap.registerPlugin(ScrollTrigger, SplitText);
    return { gsap, ScrollTrigger, SplitText, Lenis };
  })();
  return libs;
}

// segundos a partir de los tokens del motor (GSAP trabaja en segundos)
export const sec = (k = 'slow') => (DUR[k] ?? DUR.slow) / 1000;
export const EASES = { out: 'expo.out', soft: 'power3.out', inOut: 'power2.inOut', back: 'back.out(1.6)' };

export async function createStage(scroller, content = scroller) {
  if (!motionOn() || !scroller) return null;
  let L;
  try { L = await loadStage(); } catch (err) { console.warn('[escena]', err); return null; }
  const { gsap, ScrollTrigger, SplitText, Lenis } = L;
  const lenis = new Lenis({ wrapper: scroller, content, lerp: 0.085, smoothWheel: true, wheelMultiplier: 0.9 });
  lenis.on('scroll', ScrollTrigger.update);
  const tick = (t) => lenis.raf(t * 1000);
  gsap.ticker.add(tick);
  gsap.ticker.lagSmoothing(0);
  ScrollTrigger.defaults({ scroller });
  const ctx = gsap.context(() => {}, scroller);
  const splits = [];
  const stage = {
    gsap, ScrollTrigger, lenis,
    add: (fn) => ctx.add(fn),
    // texto en líneas/palabras/letras con máscara (para revelar sin que se vea el corte)
    split(el, type = 'lines') {
      const s = SplitText.create(el, { type: type === 'chars' ? 'words,chars' : type, mask: type === 'chars' ? 'words' : type, aria: 'auto', charsClass: 'm-ch', wordsClass: 'm-wd', linesClass: 'm-ln' });
      splits.push(s);
      return s;
    },
    scrollTo: (target, opts) => lenis.scrollTo(target, { duration: 1.2, ...opts }),
    refresh: () => ScrollTrigger.refresh(),
    destroy() {
      document.removeEventListener('prisma-motion-change', off);
      ctx.revert();
      splits.forEach((s) => s.revert());
      gsap.ticker.remove(tick);
      lenis.destroy();
    },
  };
  // si el usuario apaga las animaciones (o pide movimiento reducido) la escena se desarma y queda el estado final
  const off = () => { if (!motionOn()) stage.destroy(); };
  document.addEventListener('prisma-motion-change', off);
  return stage;
}
