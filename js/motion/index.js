// Motor de animaciones y diseño de ZUENA ("Prisma Motion").
// Una sola puerta de entrada para todo el frontend (Inicio, feed, perfiles, reproductor):
//   import { motion } from './motion/index.js';
//   motion.play('fadeUp', el) · motion.animate(el, keyframes, { spring: 'smooth' }) · motion.reveal(root)
//   motion.flip(lista) · motion.scrollVar(view, el, {…}) · motion.transition(() => render(), { name })
// Tecnología: API de Animaciones Web, animaciones atadas al scroll (CSS animation-timeline / ScrollTimeline),
// View Transitions, @property y resortes convertidos a curvas linear(). Sin compilación ni dependencias.
// Documentación: bóveda de Obsidian, carpeta Motor/.
import { SPRINGS, DUR, EASE, DIST, STAGGER, installTokens } from './tokens.js';
import { springEasing, springValue } from './spring.js';
import { animate, play, sequence, cancel, PRESETS, motionOn, setMotionEnabled } from './core.js';
import { reveal, nativeScroll } from './reveal.js';
import { flip } from './flip.js';
import { scrollVar, parallax, hasScrollTimeline } from './scroll.js';
import { initInteractions } from './interact.js';
// escena (GSAP + Lenis) sólo se descarga al usarla: import dinámico
const stage = (...a) => import('./stage.js').then((m) => m.createStage(...a));

export const MOTION_VERSION = '0.4.0';
let currentTransition = null;

// navegación con View Transitions (con nombre: carátula → pantalla completa, tarjeta → perfil, etc.)
function transition(update, { name } = {}) {
  currentTransition?.skipTransition();
  if (!document.startViewTransition || !motionOn() || document.hidden) { update(); return Promise.resolve(); }
  if (name) document.documentElement.dataset.vt = name;
  let done = false;
  const run = () => { if (!done) { done = true; update(); } };
  try {
    const vt = document.startViewTransition(run);
    currentTransition = vt;
    vt.ready.catch(() => {});
    vt.updateCallbackDone.catch(run);
    return vt.finished.catch(() => {}).finally(() => {
      if (currentTransition !== vt) return;
      currentTransition = null;
      delete document.documentElement.dataset.vt;
    });
  } catch { run(); return Promise.resolve(); }
}
document.addEventListener('prisma-motion-change', () => { if (!motionOn()) currentTransition?.skipTransition(); });

export const motion = {
  version: MOTION_VERSION,
  tokens: { SPRINGS, DUR, EASE, DIST, STAGGER },
  presets: PRESETS,
  animate, play, sequence, cancel, reveal, flip, scrollVar, parallax, transition, springEasing, springValue, stage,
  get enabled() { return motionOn(); },
  setEnabled: setMotionEnabled,
  support: { scrollDriven: nativeScroll, scrollTimeline: hasScrollTimeline, viewTransitions: !!document.startViewTransition, linearEasing: CSS.supports('transition-timing-function', 'linear(0, 1)') },
  init({ enabled = true } = {}) {
    setMotionEnabled(enabled);
    installTokens();
    initInteractions();
    document.documentElement.classList.toggle('m-scroll-native', nativeScroll);
  },
};
