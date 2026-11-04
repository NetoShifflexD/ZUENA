// Tokens del motor: la única fuente de duraciones, curvas, resortes y distancias de ZUENA.
// Se exponen también como variables CSS (--m-*) en installTokens(), así CSS y JS usan lo mismo.
import { springEasing } from './spring.js';

export const SPRINGS = {
  snappy: { stiffness: 420, damping: 32 },   // botones, toques
  ui: { stiffness: 300, damping: 21 },       // curva general de la interfaz (--spring): leve rebote
  smooth: { stiffness: 190, damping: 26 },   // tarjetas, paneles
  gentle: { stiffness: 110, damping: 20 },   // entradas de sección
  bouncy: { stiffness: 260, damping: 14 },   // me gusta, celebraciones
  heavy: { stiffness: 90, damping: 22, mass: 1.6 }, // portadas, pantallas completas
};

export const DUR = { instant: 90, fast: 160, base: 260, slow: 420, slower: 700, scene: 1200 };

export const EASE = {
  out: 'cubic-bezier(.2, .8, .2, 1)',
  inOut: 'cubic-bezier(.65, 0, .35, 1)',
  in: 'cubic-bezier(.5, 0, .75, 0)',
  emphasized: 'cubic-bezier(.2, 0, 0, 1)',
};

export const DIST = { xs: 4, sm: 8, md: 16, lg: 28, xl: 48 };
export const STAGGER = { tight: 24, base: 40, loose: 70 };

// variables CSS: --m-spring-<nombre> (curva linear()), --m-spring-<nombre>-dur, --m-dur-*, --m-ease-*
export function installTokens(root = document.documentElement) {
  const s = root.style;
  for (const [name, cfg] of Object.entries(SPRINGS)) {
    const { easing, duration } = springEasing(cfg);
    s.setProperty(`--m-spring-${name}`, CSS.supports('animation-timing-function', easing) ? easing : EASE.out);
    s.setProperty(`--m-spring-${name}-dur`, `${duration}ms`);
  }
  for (const [k, v] of Object.entries(DUR)) s.setProperty(`--m-dur-${k}`, `${v}ms`);
  for (const [k, v] of Object.entries(EASE)) s.setProperty(`--m-ease-${k}`, v);
}
