// Portada de Inicio: carrusel a sangre dentro del recuadro de bienvenida (sin marcos internos).
// Diapositiva 1: portada editorial quieta, sin bucles decorativos.
// Siguientes: último lanzamiento, playlists destacadas y artistas, con datos del catálogo de prueba
// (js/data/testArtists.js, Apple Music) o de lo publicado en ZUENA.
import { app } from '../app.js';
import { icon } from '../ui/icons.js';
import { esc, greeting } from '../ui/format.js';
import { sounds } from '../ui/sounds.js';
import { TEST_CATALOG, ZUENA_OFFICIAL_UID } from '../config.js';
import { testReleases, testPlaylists, testArtistCards, linkArtistNames } from '../data/testArtists.js';
import { countdown, premiereLabel } from '../data/releases.js';
import { roleBadges } from './common.js';

const INTRO_NOTE = 392;
const AUTO_ADVANCE_MS = 7500;

export function heroCarousel(p) {
  return `<div class="bento-hero hc" role="region" aria-roledescription="carrusel" aria-label="Destacados">
    <div class="hc-track">
      <article class="hc-slide hc-intro on" data-tab="ZUENA" aria-roledescription="diapositiva" aria-label="Presentación de ZUENA">
        <div class="hc-editorial-disc" aria-hidden="true">
          <span class="hc-disc-ring"></span>
          <span class="hc-disc-grooves"></span>
          <span class="hc-disc-core"><b>ZUENA</b><small>24-BIT · AUDIO</small></span>
        </div>
        <div class="hc-copy">
          <p class="eyebrow">${greeting()}${p?.displayName ? `, ${esc(p.displayName)}` : ''}</p>
          <div class="hc-scene" aria-live="off"><div class="hc-sc in"><h2>Poné algo<br>que te mueva.</h2><p>Tu próxima escucha empieza acá.</p></div></div>
          <div class="hero-actions"><button class="btn-primary" data-action="nav" data-view="explore">Explorar música ${icon('arrowRight')}</button><button class="btn-glass" data-action="nav" data-view="songs">Tu biblioteca</button></div>
        </div>
        <button class="btn-icon lit sm hc-sound" data-hc="sound" aria-label="Activar sonido de la presentación" title="Sonido">${icon('mute')}</button>
      </article>
    </div>
    <div class="hc-nav">
      <button class="btn-icon lit sm" data-hc="prev" aria-label="Anterior">${icon('chevronLeft')}</button>
      <div class="hc-dots" role="group" aria-label="Elegir destacado"></div>
      <span class="hc-position" aria-live="polite"></span>
      <button class="btn-icon lit sm hc-next" data-hc="next" aria-label="Siguiente">${icon('arrowRight')}</button>
    </div>
  </div>`;
}

let state = null;

export function mountHero(root, { registerMix, mixCovers }) {
  stopHero();
  const el = root.querySelector('.hc');
  if (!el) return;
  state = { el, idx: 0, timer: 0, paused: false, sound: false, onScreen: true, io: null, off: new AbortController() };
  // fuera de pantalla, con la pestaña oculta o en otra diapositiva la presentación no consume nada
  state.io = new IntersectionObserver(([e]) => { if (state?.el === el) { state.onScreen = e.isIntersecting; syncScenes(); } });
  state.io.observe(el);
  document.addEventListener('visibilitychange', syncScenes, { signal: state.off.signal });
  bind(el);
  renderDots();
  schedule();
  loadSlides(el, registerMix, mixCovers);
}

function stopHero() {
  if (!state) return;
  clearTimeout(state.timer);
  state.io?.disconnect();
  state.off.abort();
  state = null;
}

const alive = () => state && state.el.isConnected;

function syncScenes() {
  if (!state) return;
  if (!alive()) { stopHero(); return; }
  const active = state.onScreen && !document.hidden && state.idx === 0;
  state.el.classList.toggle('hc-idle', !active);
}

// ---------- carrusel ----------
function slides() { return [...state.el.querySelectorAll('.hc-slide')]; }

function go(i, user = false) {
  if (!alive()) return;
  const focusedSlide = document.activeElement?.closest('.hc-slide');
  for (const slide of state.el.querySelectorAll('[data-hero-post]')) {
    const post = app.posts.get(slide.dataset.heroPost);
    if (!post || !app.posts.visible(post)) slide.remove();
  }
  const all = slides();
  if (!all.length) return;
  const prevIdx = state.idx;
  const nextIdx = (i + all.length) % all.length;
  const dir = i >= prevIdx ? 'next' : 'prev';
  state.el.dataset.dir = dir;
  state.idx = nextIdx;
  all.forEach((s, k) => {
    const isCurrent = k === state.idx;
    const wasPrev = k === prevIdx && prevIdx !== state.idx;
    s.classList.toggle('on', isCurrent);
    s.classList.toggle('leaving', wasPrev);
    s.inert = !isCurrent;
    s.setAttribute('aria-hidden', String(!isCurrent));
  });
  renderDots();
  syncScenes();
  if (focusedSlide && !focusedSlide.classList.contains('on')) state.el.querySelector('[data-hc="next"]')?.focus();
  if (user && state.sound) sounds.whoosh(0.4, 0.04);
  schedule();
}

function schedule() {
  if (!state) return;
  clearTimeout(state.timer);
  const all = slides();
  if (state.paused || !state.onScreen || document.hidden || app.prefs?.motion === false || all.length < 2) return;
  state.timer = setTimeout(() => {
    if (alive() && !state.paused && state.onScreen && !document.hidden) go(state.idx + 1, false);
  }, AUTO_ADVANCE_MS);
}

function renderDots() {
  const all = slides();
  const dots = state.el.querySelector('.hc-dots');
  state.el.querySelector('.hc-nav').hidden = all.length < 2;
  const markup = all.map((s, k) => `<button class="hc-dot ${k === state.idx ? 'on' : ''}" data-hc="dot" data-i="${k}" aria-pressed="${k === state.idx}" aria-label="${esc(s.getAttribute('aria-label') || `Destacado ${k + 1}`)}"><i></i>${tabOf(s)}</button>`).join('');
  // No reemplazar el control enfocado al pausar o cambiar de tarjeta.
  if (dots.children.length !== all.length) dots.innerHTML = markup;
  [...dots.children].forEach((dot, k) => { dot.classList.toggle('on', k === state.idx); dot.setAttribute('aria-pressed', String(k === state.idx)); });
  state.el.querySelector('.hc-position').textContent = all.length > 1 ? `${state.idx + 1} de ${all.length}` : '';
  dots.classList.toggle('paused', state.paused || app.prefs.motion === false);
}

// miniatura y título corto de cada diapositiva (se ven sólo con la portada ancha, ver css/home-carousels.css)
function tabOf(s) {
  const thumb = s.dataset.thumb;
  const round = s.classList.contains('hc-art') || s.classList.contains('hc-post');
  return `<span class="hc-tab" aria-hidden="true">${thumb ? `<img class="hc-tab-art${round ? ' round' : ''}" src="${esc(thumb)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : '<span class="hc-tab-art"></span>'}<b>${esc(s.dataset.tab || 'Destacado')}</b></span>`;
}

function bind(el) {
  const signal = state.off.signal;
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-hc]');
    if (!b || !state || state.el !== el) return;
    const k = b.dataset.hc;
    if (k === 'next') go(state.idx + 1, true);
    else if (k === 'prev') go(state.idx - 1, true);
    else if (k === 'dot') go(+b.dataset.i, true);
    else if (k === 'sound') {
      if (!sounds.enabled) { app.toast('Activá "Sonidos de interfaz" en Ajustes → Apariencia para escucharla'); return; }
      state.sound = !state.sound;
      b.innerHTML = icon(state.sound ? 'volume' : 'mute');
      b.setAttribute('aria-label', state.sound ? 'Silenciar la presentación' : 'Activar sonido de la presentación');
      if (state.sound) sounds.chord(INTRO_NOTE, 0.035);
    }
  }, { signal });
  const pause = (v) => { if (!state || state.el !== el) return; state.paused = v; renderDots(); schedule(); };
  el.addEventListener('pointerenter', () => pause(true), { signal });
  el.addEventListener('pointerleave', () => pause(false), { signal });
  el.addEventListener('focusin', () => pause(true), { signal });
  el.addEventListener('focusout', (e) => { if (!el.contains(e.relatedTarget)) pause(false); }, { signal });
  el.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (e.key === 'ArrowRight') { go(state.idx + 1, true); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { go(state.idx - 1, true); e.preventDefault(); }
  }, { signal });
  // deslizar en pantallas táctiles y trackpad con seguimiento táctil en vivo
  let start = null;
  const resetDrag = () => {
    start = null;
    el.classList.remove('hc-dragging');
    el.style.removeProperty('--hc-drag');
    pause(false);
  };
  el.addEventListener('pointercancel', resetDrag, { passive: true, signal });
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest('.hc-nav, button, a, [data-action]')) return;
    start = { x: e.clientX, y: e.clientY, t: performance.now(), locked: null };
    if (e.pointerType !== 'mouse') pause(true);
  }, { passive: true, signal });
  el.addEventListener('pointermove', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (!start.locked && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      start.locked = Math.abs(dx) > Math.abs(dy) * 1.1 ? 'x' : 'y';
    }
    if (start.locked === 'x') {
      el.classList.add('hc-dragging');
      const damped = Math.max(-88, Math.min(88, dx * 0.45));
      el.style.setProperty('--hc-drag', `${damped.toFixed(1)}px`);
    }
  }, { passive: true, signal });
  el.addEventListener('pointerup', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const dt = Math.max(16, performance.now() - start.t);
    const vx = Math.abs(dx) / dt;
    const locked = start.locked;
    resetDrag();
    if (locked !== 'y' && (Math.abs(dx) > 36 || (Math.abs(dx) > 18 && vx > 0.35)) && Math.abs(dx) > Math.abs(dy)) {
      go(state.idx + (dx < 0 ? 1 : -1), true);
    }
  }, { passive: true, signal });
}

// ---------- diapositivas con datos ----------
async function loadSlides(el, registerMix, mixCovers) {
  const owner = state;
  const uid = app.user?.uid;
  const current = () => state === owner && el.isConnected && uid === app.user?.uid;
  const html = [];
  const upcoming = app.releases.upcoming();
  if (upcoming.length) {
    html.push(slidePremiere(upcoming[0]));
  }
  const zu = app.releases.live();
  if (zu.length) {
    const r = zu[0];
    html.push(slideRelease({ title: r.title, artist: r.artistName || r.artist || '', art: app.library.coverUrl?.(r) || '', eyebrow: 'Nuevo en ZUENA', action: `data-action="play-release" data-id="${esc(r.id)}"`, cta: 'Escuchar' }));
  }
  if (TEST_CATALOG) {
    const [rels, lists, artists] = await Promise.all([testReleases().catch(() => []), testPlaylists().catch(() => []), testArtistCards().catch(() => [])]);
    if (!current()) return;
    rels.slice(0, 2).forEach((r) => html.push(slideRelease({ title: r.title, artist: r.artist, art: r.artwork, eyebrow: `Catálogo de prueba · ${kindLabel(r.kind)}`, action: `data-action="open-amc" data-id="${esc(r.collectionId)}"`, cta: 'Ver lanzamiento' })));
    const region = app.taste.data.region;
    const top = lists.find((l) => l.id === 'tp-global');
    const local = lists.find((l) => l.id === `tp-${region}`) || lists.find((l) => l.id !== 'tp-global');
    for (const l of [top, local].filter(Boolean)) {
      registerMix(l);
      html.push(slidePlaylist(l, mixCovers(l)));
    }
    if (artists.length) html.push(slideArtists(artists.slice(0, 8)));
  }
  // publicaciones más populares del feed (con la simulación, se espera a que termine su historial)
  await Promise.race([app.simReady, new Promise((r) => setTimeout(r, 4000))]).catch(() => {});
  if (!current()) return;
  app.posts.popular(2, 72).filter((p) => app.posts.visible(p)).forEach((p) => html.push(slidePost(p)));
  if (!html.length || !current()) return;
  el.querySelector('.hc-track').insertAdjacentHTML('beforeend', html.join(''));
  slides().forEach((s, k) => { s.inert = k !== state.idx; s.setAttribute('aria-hidden', String(k !== state.idx)); });
  renderDots();
  schedule();
  app.afterFill?.(el);
}

const kindLabel = (k) => ({ single: 'Single', ep: 'EP', album: 'Álbum' }[k] || 'Lanzamiento');

function slidePremiere(r) {
  const art = r.coverUrl || r.coverThumb || 'brand/premiere-zuena.svg';
  const prof = app.posts?.author?.(r.uid) || { uid: r.uid, displayName: r.primaryArtist, role: 'artist', isOfficialTeam: r.uid === ZUENA_OFFICIAL_UID };
  return `<article class="hc-slide hc-rel hc-premiere" data-tab="Estreno · ${esc(r.title)}" data-thumb="${esc(art)}" aria-roledescription="diapositiva" aria-label="Próximo estreno: ${esc(r.title)}">
    ${art ? `<div class="hc-bg" style="background-image:url('${esc(art)}')" aria-hidden="true"></div>` : ''}
    <div class="hc-copy">
      <div class="ap-badges-row">
        <p class="eyebrow"><span class="p-live-dot" aria-hidden="true"></span>Estreno programado · <span data-countdown="${r.premiereAt}">${esc(countdown(r.premiereAt))}</span></p>
        ${roleBadges(prof, { compact: true })}
      </div>
      <h2>${esc(r.title)}</h2>
      <p class="hc-by">${esc(r.primaryArtist)} · ${esc(premiereLabel(r.premiereAt))}${r.audioQuality ? ` · ${esc(r.audioQuality)}` : ''}</p>
      <div class="hero-actions">
        <button class="btn-primary lit" data-action="discovery-jump" data-section="zu-premieres">${icon('clock')}Ver cuenta regresiva</button>
        <button class="btn-glass lit" data-action="open-artist" data-id="zu:${esc(r.uid)}">Perfil de ${esc(r.primaryArtist)}</button>
      </div>
    </div>
    ${art ? `<img class="hc-cover" src="${esc(art)}" alt="" loading="lazy" decoding="async">` : ''}
  </article>`;
}

function slideRelease({ title, artist, art, eyebrow, action, cta }) {
  return `<article class="hc-slide hc-rel" data-tab="${esc(title)}" data-thumb="${esc(art)}" aria-roledescription="diapositiva" aria-label="${esc(eyebrow)}: ${esc(title)}">
    ${art ? `<div class="hc-bg" style="background-image:url('${esc(art)}')" aria-hidden="true"></div>` : ''}
    <div class="hc-copy"><p class="eyebrow">${esc(eyebrow)}</p><h2>${esc(title)}</h2><p class="hc-by">${linkArtistNames(artist, esc)}</p>
      <div class="hero-actions"><button class="btn-primary lit" ${action}>${icon('play')}${cta}</button></div></div>
    ${art ? `<img class="hc-cover" src="${esc(art)}" alt="" loading="lazy" decoding="async">` : ''}
  </article>`;
}

function slidePlaylist(l, covers) {
  return `<article class="hc-slide hc-pl" data-tab="${esc(l.title)}" data-thumb="${esc(covers[0] || '')}" aria-roledescription="diapositiva" aria-label="Playlist ${esc(l.title)}">
    ${covers[0] ? `<div class="hc-bg" style="background-image:url('${esc(covers[0])}')" aria-hidden="true"></div>` : ''}
    <div class="hc-copy"><p class="eyebrow">${TEST_CATALOG ? 'Catálogo de prueba · ' : ''}Playlist destacada</p><h2>${esc(l.title)}</h2><p class="hc-by">${esc(l.sub)} · ${l.items.length} canciones</p>
      <div class="hero-actions"><button class="btn-primary lit" data-action="play-mix" data-id="${esc(l.id)}">${icon('play')}Reproducir</button>
      <button class="btn-glass lit" data-action="mix" data-id="${esc(l.id)}">Ver playlist</button></div></div>
    <div class="hc-stack" aria-hidden="true">${covers.slice(0, 3).map((u, k) => `<img src="${esc(u)}" alt="" style="--k:${k}" loading="lazy" decoding="async">`).join('')}</div>
  </article>`;
}

function slideArtists(list) {
  return `<article class="hc-slide hc-art" data-tab="Artistas" data-thumb="${esc(list[0]?.artwork || '')}" aria-roledescription="diapositiva" aria-label="Artistas más escuchados">
    <div class="hc-copy"><p class="eyebrow">Catálogo de prueba · Los más escuchados</p><h2>Artistas que están sonando</h2>
      <p class="hc-by">Global, Puerto Rico, Argentina, España, México y Chile</p></div>
    <div class="hc-faces">${list.map((a, i) => `<button class="hc-face" style="--i:${i}" data-action="open-artist" data-id="am:${a.id}" aria-label="${esc(a.name)}">${a.artwork ? `<img src="${esc(a.artwork)}" alt="" loading="lazy" decoding="async">` : ''}<span>${esc(a.name)}</span></button>`).join('')}</div>
  </article>`;
}

function slidePost(p) {
  const a = app.posts.author(p.uid) || p.author || {};
  const ini = esc((a.displayName || '?').charAt(0));
  const av = a.avatar ? `<span class="avatar"><img src="${esc(a.avatar)}" alt="" decoding="async"></span>` : `<span class="avatar ph"><span>${ini}</span></span>`;
  const date = new Date(p.created);
  const when = Number.isFinite(date.getTime()) ? `<time datetime="${date.toISOString()}">${esc(date.toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' }))}</time>` : '';
  const attached = p.attach?.item;
  const release = p.attach?.type === 'release' && app.releases.get(p.attach.releaseId);
  const context = attached?.title || release?.title;
  return `<article class="hc-slide hc-post" data-hero-post="${esc(p.id)}" data-tab="${esc(a.displayName || 'Desde el feed')}" data-thumb="${esc(a.avatar || '')}" aria-hidden="true" inert aria-roledescription="diapositiva" aria-label="Publicación de ${esc(a.displayName || 'Autor de ZUENA')}">
    <div class="hc-post-bg" aria-hidden="true"></div>
    <div class="hc-copy"><p class="eyebrow">Desde el feed${p.sim ? ' · Publicación simulada' : ''}</p>
      <h2 class="hc-post-heading">Voces de la comunidad</h2>
      <div class="hc-post-card">
      <div class="hc-author">${av}<span><b>${esc(a.displayName || 'Autor de ZUENA')}</b>${a.username ? `<span>@${esc(a.username)}</span>` : ''}${when}</span></div>
      <blockquote class="hc-quote">${esc(p.text)}</blockquote>
      ${context ? `<p class="hc-post-context">${icon('music')}En esta publicación: ${esc(context)}</p>` : ''}
      <div class="hc-stats"><span aria-label="${p.likes?.length || 0} Me gusta">${icon('heart')}${p.likes?.length || 0}</span><span aria-label="${p.reposts?.length || 0} reposts">${icon('repeat')}${p.reposts?.length || 0}</span><span aria-label="${app.posts.replyCount(p.id)} respuestas">${icon('feed')}${app.posts.replyCount(p.id)}</span></div></div>
      <div class="hero-actions"><button class="btn-primary lit" data-action="post-open" data-id="${esc(p.id)}">Ver publicación</button>
      <button class="btn-glass lit" data-action="nav" data-view="feed">Ir al feed</button></div></div>
  </article>`;
}
