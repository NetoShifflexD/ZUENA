// Landing editorial de marca: punto, escucha, Prisma y entrada. Tema del usuario y vidrio de
// glass.css, luz iridiscente sólo como luz y la isla como hilo conductor: abre la página como la píldora de la app,
// se estira hasta ser la navegación y se compacta al bajar. Requisito: bóveda, Salida/Requisitos/Landing v4 y acceso.
// Se dibuja fuera de #app y se retira al entrar. Movimiento con Prisma Motion; las escenas ancladas (GSAP + Lenis)
// están en welcomeScenes.js y sin movimiento la página queda quieta y completa.
import { icon, logo } from '../ui/icons.js';
import { esc } from '../ui/format.js';
import { motion } from '../motion/index.js';
import { mountAuthForm } from './auth.js';

// rol que la persona eligió en la landing; lo lee la creación de perfil para preseleccionarlo
export const INTENDED_ROLE_KEY = 'zuena:intendedRole';
const rememberRole = (role) => { try { sessionStorage.setItem(INTENDED_ROLE_KEY, role); } catch {} };

export const ROLES = {
  listener: {
    ic: 'headphones', title: 'Oyente', cta: 'Entrar como oyente',
    lead: 'Escuchá con sonido de estudio y seguí de cerca a quienes hacen la música.',
    items: ['Sin publicidad y con volumen parejo', 'Tus archivos en una biblioteca privada', 'Estrenos con cuenta regresiva'],
    art: ['Escuchá como se merece.', 'Sin publicidad, con volumen parejo y tus artistas a un toque.'],
  },
  artist: {
    ic: 'mic', title: 'Artista', cta: 'Entrar como artista',
    lead: 'Publicá gratis, estrená con cuenta regresiva y armá tu comunidad desde tu perfil.',
    items: ['Perfil con portada, lanzamientos y feed', 'Estrenos programados', 'Si ya existe tu perfil, podés reclamarlo'],
    art: ['Tu música, tu comunidad.', 'Publicá gratis, estrená con cuenta regresiva y hablale directo a quien te escucha.'],
  },
};
const DEFAULT_ART = ['La música que se siente.', 'Sonido de estudio, artistas cerca y una comunidad que se arma escuchando.'];
export const roleArt = (role) => ROLES[role]?.art || DEFAULT_ART;

// estado de la isla según el desplazamiento: abierta en la portada, compacta al bajar
export const navMode = (scrollTop, viewport) => (scrollTop > Math.max(80, viewport * 0.5) ? 'compact' : 'open');

// escenas: Escuchá · Seguí · Apoyá (las membresías siguen apagadas: "Próximamente")
const SCENES = [
  ['wave', 'Escuchá', 'Sonido de estudio, sin publicidad y con el volumen parejo entre canciones. Lo técnico queda a mano sólo si lo pedís.'],
  ['feed', 'Seguí', 'Estrenos con cuenta regresiva y las publicaciones de tus artistas, en un solo lugar.'],
  ['heart', 'Apoyá', 'Membresías para apoyar a quien elijas. Llegan cuando se habiliten los pagos; hasta entonces no se cobra nada.'],
];

const TRUST = [
  ['shield', 'Sin publicidad', 'Nada interrumpe la música ni se vende tu atención.'],
  ['lock', 'Tus archivos son privados', 'Lo que sumás desde tu equipo queda en tu cuenta. Nadie más lo ve.'],
  ['heart', '88 % para el artista', 'De cada membresía, cuando existan pagos. Hoy no se procesa ningún cobro.'],
];

// enlaces legales (abren la hoja de js/legal/view.js)
const FOOT_LEGAL = [['terminos', 'Términos'], ['privacidad', 'Privacidad'], ['cookies', 'Cookies'], ['normas', 'Normas'], ['copyright', 'Copyright'], ['aviso', 'Aviso legal'], ['contacto', 'Contacto']];

const BARS = 22;
const COUNT_FROM = 2 * 3600 + 14 * 60 + 9;
const fmtCount = (s) => [s / 3600, (s % 3600) / 60, s % 60].map((n) => String(Math.floor(n)).padStart(2, '0')).join(':');

export function showWelcome({ mode = 'signup' } = {}) {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'welcome ld';
    root.innerHTML = `
      <div class="ld-light" aria-hidden="true"><i class="b1"></i><i class="b2"></i></div>
      <header class="ld-nav is-pill" aria-label="ZUENA">
        <a class="ld-brand" href="#top" aria-label="ZUENA, inicio"><span class="ld-mark">${logo()}</span><span class="ld-word">ZUENA</span></a>
        <nav class="ld-fold ld-links" aria-label="Secciones"><a href="#escenas">Cómo funciona</a><a href="#elegir">Oyentes y artistas</a><a href="#confianza">Confianza</a></nav>
        <div class="ld-fold ld-nav-cta">
          <button type="button" class="btn-glass lit" data-wl="signin"><span class="ld-long">Iniciar sesión</span><span class="ld-short">Entrar</span></button>
          <button type="button" class="btn-primary lit" data-wl="signup">Crear cuenta</button>
        </div>
      </header>

      <main class="ld-main">
        <section class="ld-hero" id="top" aria-labelledby="ld-h1">
          <div class="ld-copy">
            <h1 id="ld-h1" class="ld-title" aria-label="La música que se siente. ZUENA"><span class="ld-title-copy">La música<br>que se siente</span><span class="ld-title-point" role="img" aria-label="ZUENA">${logo()}</span></h1>
            <p class="ld-sub ld-in">Sonido de estudio para quienes escuchan y un lugar propio para quienes crean. Gratis y sin publicidad.</p>
            <div class="ld-cta ld-in">
              <button type="button" class="btn-primary lit ld-big" data-wl="signup">Crear cuenta gratis</button>
              <button type="button" class="btn-glass lit ld-big" data-wl="signin">Ya tengo cuenta</button>
            </div>
          </div>
          <a class="ld-scroll" href="#escenas">Todo empieza al escuchar ${icon('arrowRight')}</a>
        </section>

        <div class="ld-point-passage" aria-hidden="true"><span class="ld-mark">${logo()}</span><span>Un punto de encuentro.</span></div>
        ${scenesHtml()}

        <section class="ld-sec" id="elegir" aria-labelledby="ld-el">
          <header class="ld-head" data-reveal="fadeUp"><p>Tu lugar en ZUENA</p><h2 id="ld-el">De este lado,<br>la música es tuya.</h2></header>
          <div class="ld-roles" data-reveal="fadeUp" data-reveal-children data-reveal-stagger="70">${Object.entries(ROLES).map(([k, r]) => roleCard(k, r)).join('')}</div>
          <p class="hint center ld-note">Podés empezar como oyente y pedir tu perfil de artista cuando quieras.</p>
        </section>

        <section class="ld-sec" id="confianza" aria-labelledby="ld-co">
          <header class="ld-head" data-reveal="fadeUp"><p class="eyebrow">Confianza</p><h2 id="ld-co">Claro desde el principio.</h2></header>
          <div class="ld-trust" data-reveal="fadeUp" data-reveal-children data-reveal-stagger="40">${TRUST.map(([ic, t, d]) => `<article class="ld-trust-item glass-soft"><span class="ld-ico">${icon(ic)}</span><h3>${t}</h3><p>${d}</p></article>`).join('')}</div>
          <p class="ld-legal-row">Leé las reglas antes de entrar:
            <button type="button" class="link-inline" data-legal="terminos">Términos</button>
            <button type="button" class="link-inline" data-legal="privacidad">Privacidad</button>
            <button type="button" class="link-inline" data-legal="normas">Normas de la comunidad</button>
            <span class="lg-muted">Textos en borrador</span></p>
        </section>

        <section class="ld-close" aria-labelledby="ld-fin" data-reveal="scaleIn">
          <div class="ld-close-isl" aria-hidden="true"><span class="ld-mark">${logo()}</span><span class="ld-word">ZUENA</span></div>
          <h2 id="ld-fin">Ahora, a escuchar<span class="ld-title-point" role="img" aria-label="ZUENA">${logo()}</span></h2>
          <p>Creá tu cuenta gratis o probá ZUENA como invitado durante siete días.</p>
          <div class="ld-cta center"><button type="button" class="btn-primary lit ld-big" data-wl="signup">Crear cuenta gratis</button><button type="button" class="btn-glass lit ld-big" data-wl="signin">Iniciar sesión</button></div>
        </section>
      </main>

      <footer class="ld-foot">
        <span class="ld-brand sm"><span class="ld-mark">${logo()}</span><span class="ld-word">ZUENA</span></span>
        <nav class="ld-foot-legal" aria-label="Legal">${FOOT_LEGAL.map(([id, t]) => `<button type="button" class="link-inline" data-legal="${id}">${t}</button>`).join('')}<button type="button" class="link-inline" data-cookie-settings>Configurar cookies</button></nav>
        <span class="ld-copy-note">© ${new Date().getFullYear()} ZUENA · Música independiente</span>
      </footer>

      <div class="ld-sheet" hidden>
        <div class="ld-dialog" role="dialog" aria-modal="true" aria-label="Acceso a ZUENA" tabindex="-1" data-lenis-prevent>
          <aside class="ld-auth-side" aria-hidden="true">
            <div class="ld-auth-light"><i></i><i></i></div>
            <div class="ld-auth-isl"><span class="ld-mark">${logo()}</span><span class="ld-word">ZUENA</span></div>
            <div class="ld-auth-quote"><b data-art-title></b><p data-art-text></p></div>
            <ul class="ld-auth-points"><li>${icon('shield')}Sin publicidad</li><li>${icon('lock')}Tus archivos, privados</li><li>${icon('clock')}Invitado por siete días</li></ul>
          </aside>
          <div class="ld-auth-panel">
            <div class="ld-auth-card glass">
              <button type="button" class="btn-icon ld-x" data-close aria-label="Cerrar">${icon('close')}</button>
              <p class="ld-role-note" hidden></p>
              <div class="ld-auth"></div>
              <p class="ld-auth-legal"><button type="button" class="link-inline" data-legal="terminos">Términos</button><button type="button" class="link-inline" data-legal="privacidad">Privacidad</button><button type="button" class="link-inline" data-legal="cookies">Cookies</button><button type="button" class="link-inline" data-legal="contacto">Contacto</button><span class="lg-muted">Textos en borrador</span></p>
            </div>
          </div>
        </div>
      </div>`;

    document.body.append(root);
    document.body.classList.add('welcome-open');
    const shellState = [document.getElementById('app'), document.getElementById('floatbar')].filter(Boolean).map((node) => ({ node, inert: node.inert }));
    shellState.forEach(({ node }) => { node.inert = true; });

    const nav = root.querySelector('.ld-nav');
    const sheet = root.querySelector('.ld-sheet');
    const dialog = sheet.querySelector('.ld-dialog');
    const note = root.querySelector('.ld-role-note');
    let timer = 0;
    let pushed = false; // entrada del historial para que "atrás" cierre la hoja

    const form = mountAuthForm(root.querySelector('.ld-auth'), {
      mode,
      brand: false,
      autofocus: false,
      onUser: (user) => {
        shellState.forEach(({ node, inert }) => { node.inert = inert; });
        root.dispatchEvent(new Event('zuena-welcome-out'));
        clearInterval(timer);
        removeEventListener('popstate', onPop);
        if (pushed) { pushed = false; history.back(); }
        root.classList.add('out');
        document.body.classList.remove('welcome-open');
        setTimeout(() => root.remove(), 600);
        resolve(user);
      },
    });

    // ---------- hoja de acceso ----------
    let lastFocus = null;
    const mobileSheet = () => matchMedia('(max-width: 760px)').matches;
    const openSheet = (tab, role) => {
      if (role) rememberRole(role);
      note.hidden = !ROLES[role];
      if (ROLES[role]) note.innerHTML = `${icon(ROLES[role].ic)}<span>Vas a entrar como <b>${esc(ROLES[role].title.toLowerCase())}</b>. Podés cambiarlo después.</span>`;
      const [title, text] = roleArt(role);
      sheet.querySelector('[data-art-title]').textContent = title;
      sheet.querySelector('[data-art-text]').textContent = text;
      sheet.dataset.role = ROLES[role] ? role : '';
      lastFocus = document.activeElement;
      sheet.hidden = false;
      root.classList.add('sheet-open');
      if (!pushed) { try { history.pushState({ zuenaAuth: 1 }, '', location.href); pushed = true; } catch {} }
      // táctil: el foco entra por el título (sin abrir el teclado de iOS); con teclado físico, al correo
      form.setTab(tab, { focus: matchMedia('(pointer: coarse)').matches ? 'title' : 'email' });
      if (!dialog.contains(document.activeElement)) dialog.focus({ preventScroll: true });
      if (mobileSheet()) motion.animate(dialog, [{ transform: 'translateY(100%)' }, { transform: 'none' }], { spring: 'smooth' });
      else {
        motion.play('fadeIn', dialog);
        motion.play('fadeUp', sheet.querySelector('.ld-auth-quote'), { delay: 60 });
        motion.play('slideLeft', sheet.querySelector('.ld-auth-card'), { delay: 40 });
      }
    };
    const closeSheet = async ({ fromHistory = false } = {}) => {
      if (sheet.hidden) return;
      if (pushed && !fromHistory) { pushed = false; history.back(); }
      if (fromHistory) pushed = false;
      await (mobileSheet()
        ? motion.animate(dialog, [{ transform: 'none' }, { transform: 'translateY(100%)' }], { duration: motion.tokens.DUR.base, easing: motion.tokens.EASE.in })
        : motion.play('exitDown', dialog));
      sheet.hidden = true;
      dialog.style.cssText = '';
      root.classList.remove('sheet-open');
      lastFocus?.focus?.({ preventScroll: true });
    };
    const onPop = () => { if (!sheet.hidden) closeSheet({ fromHistory: true }); };
    addEventListener('popstate', onPop);

    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) { closeSheet(); return; }
      const b = e.target.closest('[data-wl]');
      if (b) { openSheet(b.dataset.wl, b.dataset.role); return; }
      const a = e.target.closest('a[href^="#"]');
      if (a) {
        e.preventDefault();
        root.querySelector(a.getAttribute('href'))?.scrollIntoView({ behavior: motion.enabled ? 'smooth' : 'auto', block: 'start' });
      }
    });
    root.addEventListener('keydown', (e) => {
      if (sheet.hidden) return;
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); closeSheet(); return; }
      if (e.key !== 'Tab') return;
      const items = [...dialog.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select, textarea')]
        .filter((node) => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
      const first = items[0], last = items.at(-1);
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { e.preventDefault(); first?.focus(); }
    });

    // ---------- la isla: píldora → navegación → compacta al bajar ----------
    const setNav = (m) => { if (nav.dataset.mode !== m) { nav.dataset.mode = m; nav.classList.toggle('is-compact', m === 'compact'); } };
    if (motion.enabled) setTimeout(() => nav.classList.remove('is-pill'), 200);
    else nav.classList.remove('is-pill');
    lightAndScroll(root, setNav);

    // entrada de la portada y apariciones al desplazar (motor)
    motion.play('fadeUp', root.querySelectorAll('.ld-in'), { stagger: 70, delay: 200 });
    motion.reveal(root);
    if (document.documentElement.dataset.design !== 'point' && !matchMedia('(pointer: coarse)').matches) {
      import('./welcomeScenes.js').then((m) => m.mountScenes(root)).then((st) => { if (st) root.addEventListener('zuena-welcome-out', () => st.destroy(), { once: true }); }).catch((err) => console.warn('[landing]', err));
    }

    // cuenta regresiva decorativa de la maqueta; se detiene al salir
    const counters = root.querySelectorAll('[data-ld-count]');
    let left = COUNT_FROM;
    const tick = () => {
      if (!root.isConnected) { clearInterval(timer); return; }
      left = left > 0 ? left - 1 : COUNT_FROM;
      const t = fmtCount(left);
      counters.forEach((c) => { c.textContent = t; });
    };
    if (counters.length) timer = setInterval(tick, 1000);
  });
}

// luz que refracta con el puntero (sólo mouse) y con el desplazamiento; estado de la isla. Todo por rAF y en
// variables del propio elemento de luz (no invalida el estilo del resto de la página).
function lightAndScroll(root, setNav) {
  const light = root.querySelector('.ld-light');
  let raf = 0, px = 0.5, py = 0.3;
  const frame = () => {
    raf = 0;
    if (!root.isConnected || document.hidden) return;
    const h = root.clientHeight || innerHeight;
    setNav(navMode(root.scrollTop, h));
    if (document.documentElement.dataset.design === 'point' || !motion.enabled || root.classList.contains('sheet-open')) return;
    const s = Math.min(1, root.scrollTop / Math.max(1, root.scrollHeight - h));
    light.style.setProperty('--lx', px.toFixed(3));
    light.style.setProperty('--ly', py.toFixed(3));
    light.style.setProperty('--ls', s.toFixed(3));
  };
  const queue = () => { if (!raf) raf = requestAnimationFrame(frame); };
  root.addEventListener('scroll', queue, { passive: true });
  if (document.documentElement.dataset.design !== 'point' && matchMedia('(pointer: fine)').matches) {
    root.addEventListener('pointermove', (e) => { px = e.clientX / innerWidth; py = e.clientY / innerHeight; queue(); }, { passive: true });
  }
  frame();
}

// app real en miniatura: la isla con actividad en vivo (componentes de island.css) y la tarjeta de Ahora suena.
// Personajes y pistas ficticios; carátulas dibujadas con degradados (nada de imágenes de terceros).
function miniAppHtml() {
  const bars = Array.from({ length: BARS }, (_, i) => `<i style="--i:${i};--h:${(0.3 + 0.7 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6))).toFixed(2)}"></i>`).join('');
  return `
    <div class="ld-mini-app" data-tilt>
      <div class="island-live ld-mini-isl"><span class="il-art"><span class="ld-cover c1"></span></span>
        <span class="il-text"><small>Vista previa · Ahora suena</small><b>Marea alta</b><span>Ciudad Satélite</span></span>
        <span class="il-bars"><i></i><i></i><i></i><i></i></span></div>
      <div class="ld-np glass">
        <div class="ld-cover c1 lg"></div>
        <div class="ld-np-meta"><b>Marea alta</b><span>Ciudad Satélite · Noches largas</span></div>
        <div class="ld-spectrum">${bars}</div>
        <div class="ld-progress"><i></i></div>
        <div class="ld-np-ctl"><span>${icon('shuffle')}</span><span>${icon('prev')}</span><span class="ld-play">${icon('pause')}</span><span>${icon('next')}</span><span>${icon('repeat')}</span></div>
      </div>
      <div class="island-live ld-mini-isl ld-mini-isl2"><span class="il-ico">${icon('clock')}</span>
        <span class="il-text"><small>Vista previa · Estreno</small><b>Bruma Norte</b><span data-ld-count>${fmtCount(COUNT_FROM)}</span></span></div>
    </div>`;
}

function scenesHtml() {
  const visual = [
    `<div class="ld-np glass sm"><span class="ld-preview-label">Vista previa</span><div class="ld-cover c2 lg"></div><div class="ld-np-meta"><b>Luz de faro</b><span>Bruma Norte</span></div>
      <div class="ld-spectrum">${Array.from({ length: 16 }, (_, i) => `<i style="--i:${i};--h:${(0.3 + 0.7 * Math.abs(Math.sin(i * 1.3))).toFixed(2)}"></i>`).join('')}</div>
      <div class="ld-chips"><span>Sin pérdida</span><span>Volumen parejo</span></div></div>`,
    `<div class="ld-mini ld-in-mini"><span class="ld-preview-label">Prisma · Vista previa de la interfaz</span>${miniAppHtml()}</div>`,
    `<div class="ld-tiers"><span class="ld-soon">Próximamente</span>${[['Supporter', 'Insignia y adelantos'], ['Fan', 'Lo anterior, más encuentros en vivo'], ['Superfan', 'Lo anterior, más lanzamientos exclusivos']].map(([n, d], i) => `<div class="ld-tier glass-soft ${i === 1 ? 'on' : ''}"><b>${n}</b><span>${d}</span></div>`).join('')}</div>`,
  ];
  return `<section class="ld-scenes" id="escenas" aria-label="Cómo funciona ZUENA">
    <header class="ld-prisma-head"><p>Escucha. Encuentro. Prisma.</p><p>La música en primer plano.<br>Todo lo demás, cerca.</p></header>
    <div class="ld-scenes-pin">
      ${SCENES.map(([ic, t, d], i) => `<article class="ld-scene" data-i="${i}">
        <div class="ld-scene-text"><span class="ld-ico">${icon(ic)}</span><h2>${t}</h2><p>${d}</p></div>
        <div class="ld-scene-visual" aria-hidden="true">${visual[i]}</div>
      </article>`).join('')}
      <div class="ld-scene-dots" aria-hidden="true">${SCENES.map(() => '<i></i>').join('')}</div>
    </div>
  </section>`;
}

const roleCard = (key, r) => `
  <article class="ld-role glass">
    <span class="ld-role-ico">${icon(r.ic)}</span>
    <h3>${r.title}</h3>
    <p>${r.lead}</p>
    <ul>${r.items.map((x) => `<li>${icon('check')}${x}</li>`).join('')}</ul>
    <button type="button" class="${key === 'artist' ? 'btn-primary' : 'btn-glass'} lit ld-big" data-wl="signup" data-role="${key}">${r.cta}${icon('arrowRight')}</button>
  </article>`;
