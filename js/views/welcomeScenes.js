// Escenas de la landing v4 (2026-11-03) con Prisma Motion · Escena (GSAP + ScrollTrigger + SplitText + Lenis).
// Se montan sobre lo que dibuja welcome.js. Sin movimiento (o si fallan las librerías) no se monta nada y la página
// queda completa: las tres escenas apiladas y las apariciones CSS del motor. stage.destroy() desarma todo al salir.
import { EASES, sec } from '../motion/stage.js';
import { motion } from '../motion/index.js';

export async function mountScenes(root) {
  const st = await motion.stage(root, root);
  if (!st || !root.isConnected) return null;
  const { gsap } = st;
  root.classList.add('ld-staged');
  // la escena reemplaza las apariciones CSS del motor (dos sistemas sobre el mismo elemento se pisan)
  root.querySelectorAll('[data-reveal]').forEach((el) => {
    el.removeAttribute('data-reveal');
    el.classList.remove('m-ready', 'm-native', 'm-wait');
    el.classList.add('m-in');
    [...el.children].forEach((c) => c.getAnimations?.().forEach((a) => a.cancel()));
    el.getAnimations?.().forEach((a) => a.cancel());
  });
  const q = (s) => root.querySelector(s);
  const qa = (s) => [...root.querySelectorAll(s)];
  const wide = matchMedia('(min-width: 861px)').matches;

  st.add(() => {
    // 1 · titular: palabras que suben desde una máscara
    const title = q('.ld-title');
    if (title) gsap.from(st.split(title, 'chars').chars, { yPercent: 110, opacity: 0, duration: sec('slower'), ease: EASES.out, stagger: 0.016, delay: 0.1 });

    // 2 · portada: al bajar, la app en miniatura se acerca y el texto se aleja (sin anclar: lectura continua)
    const hero = q('.ld-hero');
    if (hero) {
      gsap.timeline({ scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: 0.6 } })
        .to('.ld-copy', { yPercent: -10, opacity: 0.2, ease: 'none' }, 0)
        .to('.ld-mini-app', { y: -40, scale: 1.04, ease: 'none' }, 0);
    }

    // 3 · escenas ancladas (PC): Escuchá → Seguí → Apoyá sobre el mismo vidrio; en móvil, cada una entra al llegar
    const scenes = qa('.ld-scene');
    const dots = qa('.ld-scene-dots i');
    const pin = q('.ld-scenes-pin');
    if (scenes.length && pin && wide) {
      root.classList.add('ld-pinned');
      gsap.set(scenes.slice(1), { autoAlpha: 0, y: 40 });
      const tl = gsap.timeline({ scrollTrigger: { trigger: pin, start: 'top top', end: `+=${(scenes.length - 1) * 90}%`, pin: true, scrub: 0.5,
        onUpdate: (self) => { const i = Math.min(scenes.length - 1, Math.round(self.progress * (scenes.length - 1))); dots.forEach((d, k) => d.classList.toggle('on', k === i)); } } });
      scenes.slice(1).forEach((s, k) => {
        tl.to(scenes[k], { autoAlpha: 0, y: -40, ease: EASES.inOut }, k)
          .to(s, { autoAlpha: 1, y: 0, ease: EASES.inOut }, k + 0.15)
          .fromTo(s.querySelector('.ld-scene-visual'), { rotateY: -10, scale: 0.94 }, { rotateY: 0, scale: 1, ease: EASES.soft }, k + 0.15);
      });
      dots[0]?.classList.add('on');
    } else {
      scenes.forEach((s) => gsap.from(s.children, { y: 50, opacity: 0, stagger: 0.12, duration: sec('slower'), ease: EASES.out,
        scrollTrigger: { trigger: s, start: 'top 82%', once: true } }));
    }

    // 4 · títulos de sección: líneas que se revelan al entrar
    qa('.ld-head h2, .ld-close h2').forEach((h) => {
      gsap.from(st.split(h, 'lines').lines, { yPercent: 105, opacity: 0, stagger: 0.1, duration: sec('slower'), ease: EASES.out,
        scrollTrigger: { trigger: h, start: 'top 88%', once: true } });
    });

    // 5 · tarjetas (roles y confianza): suben con leve giro hacia la cámara
    [['.ld-role', '.ld-roles'], ['.ld-trust-item', '.ld-trust']].forEach(([cards, wrap]) => {
      if (!q(wrap)) return;
      gsap.from(cards, { y: 60, rotateX: -12, opacity: 0, transformOrigin: '50% 100%', stagger: 0.12, duration: sec('slower'), ease: EASES.out,
        scrollTrigger: { trigger: wrap, start: 'top 85%', once: true } });
    });

    // 6 · cierre: la isla se estira al llegar, como al abrir la página
    const isl = q('.ld-close-isl');
    if (isl) gsap.from(isl, { scaleX: 0.4, opacity: 0, duration: sec('slower'), ease: EASES.back, scrollTrigger: { trigger: isl, start: 'top 88%', once: true } });
  });

  // los anclas internas usan el desplazamiento suave
  root.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const t = root.querySelector(a.getAttribute('href'));
    if (t) { e.preventDefault(); e.stopImmediatePropagation(); st.scrollTo(t, { offset: -80 }); }
  }, true);
  // con la hoja de acceso abierta, Lenis se detiene (la rueda queda para el formulario)
  const obs = new MutationObserver(() => (root.classList.contains('sheet-open') ? st.lenis.stop() : st.lenis.start()));
  obs.observe(root, { attributes: true, attributeFilter: ['class'] });
  const destroy = st.destroy;
  let dead = false;
  st.destroy = () => { if (dead) return; dead = true; obs.disconnect(); destroy(); root.classList.remove('ld-staged', 'ld-pinned'); };

  // las fuentes cambian medidas: recalcular cuando terminan de cargar
  document.fonts?.ready.then(() => { if (root.isConnected) st.refresh(); });
  return st;
}
