// Intro de ZUENA (estilo Hulu): aurora iridiscente, letras que emergen desde la línea base con
// desenfoque de movimiento, un barrido de luz y, al salir, un zoom a través de la palabra mientras
// la app aparece detrás. Primera vez: con eslogan y "Comenzar". Siguientes: versión breve.
import { icon } from './icons.js';

export function playIntro({ first }) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const el = document.createElement('div');
  el.className = `intro ${first ? 'intro-first' : 'intro-quick'}`; // prefijo: .quick ya es la grilla de accesos rápidos
  el.setAttribute('role', 'presentation');
  el.innerHTML = `
    <div class="intro-aura" aria-hidden="true"><i></i><i></i><i></i></div>
    <div class="intro-center">
      <h1 class="intro-word" aria-label="ZUENA">${[...'ZUENA'].map((c, i) => `<span class="l" aria-hidden="true"><span style="--i:${i}">${c}</span></span>`).join('')}</h1>
      ${first ? `<div class="intro-foot">
        <p class="intro-tag">Tu música. Tu sonido. Tu escena.</p>
        <button class="btn-primary lit intro-cta">Comenzar ${icon('arrowRight')}</button>
      </div>` : ''}
    </div>`;
  document.body.appendChild(el);
  document.getElementById('boot-cover')?.remove(); // la intro ya tapa la app: se retira la cubierta de index.html
  // doble rAF: garantiza que el estado inicial se pinte antes de animar (si no, las letras "saltan")
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('run')));

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.classList.add('out');
      document.body.classList.add('app-in');
      setTimeout(() => el.remove(), reduce ? 50 : 1000);
      resolve();
    };
    if (first) {
      const cta = el.querySelector('.intro-cta');
      cta.addEventListener('click', finish, { once: true });
      setTimeout(() => cta.focus({ preventScroll: true }), reduce ? 0 : 1900);
      // Enter o Espacio también arrancan, aunque el botón todavía esté apareciendo
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); finish(); } });
    } else {
      setTimeout(finish, reduce ? 0 : 1250);
    }
  });
}
