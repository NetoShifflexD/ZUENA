import { app } from './app.js';
import { AudioEngine } from './audio/engine.js';
import { EQ_BANDS, EQ_PRESETS } from './audio/eq.js';
import { Library } from './library.js';
import { Player } from './player.js';
import { PlaybackSession } from './playback-session.js';
import { FloatingPlayer } from './ui/floating-player.js';
import { bindIslandWheel } from './ui/island-wheel.js';
import { PLAYER_TABS, selectPlayerTab, enterPlayer, cancelPlayerPresentation, updateMiniProgress } from './ui/player-presentation.js';
import { Auth } from './auth/auth.js';
import { Playlists, Stats } from './data/playlists.js';
import { Artist } from './data/artist.js';
import { Posts } from './data/posts.js';
import { Releases, countdown, countdownParts } from './data/releases.js';
import { loadProfile, saveProfile, syncAccount } from './data/profiles.js';
import { Taste, Catalog } from './catalog/recommend.js';
import { defaultRegion } from './catalog/genres.js';
import { applyTheme, loadFont, fontStack, onSystemModeChange, followsSystem } from './theme/theme.js';
import { db } from './store/db.js';
import { icon, logo } from './ui/icons.js';
import { Scrubber } from './ui/scrubber.js';
import { Visualizer } from './ui/visualizer.js';
import { playIntro } from './ui/intro.js';
import { sounds, initUiSounds } from './ui/sounds.js';
import { closeTopModal, confirmModal } from './ui/modal.js';
import { closeMenu, openMenu } from './ui/menu.js';
import { searchHeadphones, loadHeadphoneProfile } from './audio/autoeq.js';
import { esc, fmtTime, fmtDb, fmtRate, quality } from './ui/format.js';
import { art, avatar, tick, playlistArt, flushChunks } from './views/common.js';
import * as lib from './views/library.js';
import * as disc from './views/discover.js';
import * as ap from './views/artistpage.js';
import { viewForArtists } from './views/forartists.js';
import { viewFeed, viewPost, feedLive, bindComposer, submitPost } from './views/feed.js';
import { tasteTest } from './views/taste.js';
import { viewProfile, profileEditor } from './views/profile.js';
import { viewClaim, viewStudio, viewRelease, viewReviewAsync, submitClaim, submitRelease, bindArtistInputs, addReleaseAudio, materializeRelease } from './views/artist.js';
import { panelEq, panelQueue, panelSettings, settingsCategories } from './views/panels.js';
import { openAuth, openPasswordRecovery } from './views/auth.js';
import { showWelcome } from './views/welcome.js';
import { creditsPane, trackCredits } from './ui/credits.js';
import { motion } from './motion/index.js';
import { createIslandLive } from './ui/island.js';
import { createIslandViewport } from './ui/island-viewport.js';
import { searchEverything } from './search.js';
import { searchMarkup, viewUnifiedSearch } from './views/search.js';
import { mountIslandContent, islandPostAvailable, refreshIslandPosts } from './views/islandContent.js';
import { applyLook } from './ui/appearance.js';
import { TEST_CATALOG } from './config.js';
import { Charts } from './data/charts.js';
import { SimSubs } from './data/subs.js';
import { createSimulator } from './sim/simulator.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const engine = new AudioEngine();
const library = new Library(engine);
const player = new Player(engine);
const auth = new Auth();
const playlists = new Playlists();
const stats = new Stats();
const artist = new Artist(auth);
const posts = new Posts(auth);
const releases = new Releases();
const taste = new Taste();
const catalog = new Catalog();
Object.assign(app, { engine, library, player, auth, playlists, stats, artist, posts, releases, taste, catalog, seen: new Map() });
// charts de oyentes/suscriptores y suscripciones simuladas (Requisitos/Feed de artistas, suscripciones y charts)
app.subs = new SimSubs();
posts.subscriptionTier = (listener, artistUid) => app.subs.tier(listener, artistUid);
app.charts = new Charts(app);
stats.onCount = (t, uid) => app.charts.listen(t, uid);
// ¿se puede escuchar? lanzamientos: sólo publicados (o estreno cumplido); música privada: sólo su dueño
app.isAvailable = (t) => {
  if (!t) return false;
  if (t.origin === 'release' || t.releaseId) { const r = releases.byTrack(t.id); return !!r && (r.status === 'published' || (r.status === 'scheduled' && Date.now() >= r.premiereAt)); }
  return !t.hidden && (!t.owner || t.owner === app.user?.uid);
};
app.resolve = (id) => library.byId.get(id) || catalog.get(id) || app.seen.get(id) || null;

const ui = app.ui;
const playback = new PlaybackSession(player, engine);
app.playback = playback;
playback.addEventListener('error', () => toast('Tocá Reproducir para continuar.'));
playback.addEventListener('change', () => { document.body.dataset.playerMode = playback.mode; scheduleTransportView(); });
const floating = new FloatingPlayer({
  snapshot: () => ({ ...playback.snapshot(), scheme: document.documentElement.dataset.scheme }),
  artwork: (track) => library.coverUrl(track),
  commands: {
    toggle: () => playback.dispatch('toggle'),
    retry: () => playback.dispatch('retry'),
    next: () => playback.dispatch('next'),
    prev: () => playback.dispatch('prev'),
    seek: (value) => playback.dispatch('seek', value),
    setVolume: (value) => { playback.dispatch('volume', value); syncVolume(); saveSettings(); },
    returnToApp: () => { window.focus(); floating.close(); setNp(true); },
  },
  onError: (err) => toast(err?.message || 'No se pudo abrir la ventana flotante.'),
});
app.floatingPlayer = floating;
floating.addEventListener('change', () => {
  playback.setMode(floating.isOpen ? 'external' : ui.npOpen ? 'fullscreen' : playback.inlineMode);
  $$('.js-float').forEach((b) => {
    b.setAttribute('aria-pressed', String(floating.isOpen));
    b.classList.toggle('on', floating.isOpen);
  });
});
const systemReducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const els = {
  main: $('#main'),
  island: $('#island'), floatbar: $('#floatbar'), view: $('#view'), dock: $('#dock'), np: $('#np'), panel: $('#panel'),
  status: $('#status'), toast: $('#toast'), drop: $('#drop'), bg: $('#bg'),
};
let dockScrub, npScrub, viz;
let booted = false;
const eqPreview = EQ_BANDS.map((b) => new BiquadFilterNode(engine.ctx, { type: b.type, frequency: b.freq, Q: b.q }));

boot().catch((err) => {
  console.error(err);
  document.body.classList.add('app-in');
  document.body.insertAdjacentHTML('beforeend', `<div class="fatal glass"><h2>ZUENA no pudo iniciar</h2><p>${esc(err.message)}</p></div>`);
});

async function boot() {
  // app instalable y apertura sin conexión (sólo en contexto seguro: localhost o https)
  if ('serviceWorker' in navigator && isSecureContext) navigator.serviceWorker.register('sw.js').catch((err) => console.warn('[sw]', err));
  document.documentElement.classList.toggle('standalone', matchMedia('(display-mode: standalone)').matches || navigator.standalone === true);
  const [device, prefs, introSeen] = await Promise.all([db.kvGet('settings'), db.kvGet('prefs'), db.kvGet('introSeen')]);
  app.prefs = prefs || {};
  engine.setSettings(device?.engine || {});
  player.shuffle = !!device?.shuffle;
  player.repeat = device?.repeat || 'off';
  applyMotion();
  applyAdvanced();
  applyLook();
  initUiSounds(app.prefs.uiSounds !== false);
  motion.init({ enabled: app.prefs.motion !== false });
  app.motion = motion;
  // el tema guardado se aplica sin transición para que no haya un destello de color al abrir
  document.documentElement.classList.add('booting');
  applyTheme(app.prefs.look || {});
  setDisplayFont(app.prefs.look?.font);
  requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.remove('booting')));
  // modo automático: sigue al sistema en vivo
  onSystemModeChange(() => { if (followsSystem(app.profile ? app.profile.mode : app.prefs.look?.mode)) { if (app.profile) app.applyUserTheme(); else applyTheme(app.prefs.look || {}); } });

  renderIsland();
  createIslandViewport(els.island);
  renderDock();
  renderNowPlaying();
  a11y(els.dock);
  a11y(els.np);
  els.np.setAttribute('role', 'dialog');
  els.np.inert = true;
  els.np.setAttribute('aria-label', 'Ahora suena');
  els.panel.setAttribute('role', 'region');
  els.panel.setAttribute('aria-label', 'Panel lateral');
  bindEvents();
  setupMediaSession();

  const ready = Promise.all([engine.init(), auth.init(), library.load(), catalog.load()]);
  await playIntro({ first: !introSeen });
  if (!introSeen) db.kvSet('introSeen', true);
  await ready;

  // sin sesión: la landing pública con el acceso integrado (preregistro / iniciar sesión)
  if (!auth.user) await showWelcome({ mode: introSeen ? 'signin' : 'signup' });
  while (!auth.user) await openAuth({ mode: 'signin', required: true });
  while (!await onUser()) {
    await showWelcome({ mode: 'signin' });
    while (!auth.user) await openAuth({ mode: 'signin', required: true });
  }
  if (player.restore(device?.queue, { get: app.resolve })) syncPlayer();
  render();
  // simulación de actividad para pruebas (sin IA, configurable desde Obsidian): sólo con el catálogo de prueba
  if (TEST_CATALOG) {
    app.sim = createSimulator(app);
    app.simReady = app.sim.start().catch((err) => { console.warn('[sim]', err); });
  }
  syncPlayState();
  syncVolume();
  requestAnimationFrame(frame);
  booted = true;
  await onboarding();
}

async function onboarding() {
  if (app.user?.isGuest) return;
  if (!app.profile.onboarded) await profileEditor({ welcome: true });
  if (!taste.data.done) await tasteTest({ required: true });
}

let userLoads = Promise.resolve();
function onUser() {
  const user = auth.user, generation = auth.generation;
  ui.accountLoading = true;
  const load = userLoads.catch(() => {}).then(() => hydrateUser(user, generation));
  userLoads = load;
  return load;
}
async function hydrateUser(user, generation) {
  const current = () => !!user && auth.user === user && auth.generation === generation && auth.checkGuest();
  if (!current()) return false;
  app.user = user;
  library.setOwner(user.uid);
  const profile = await loadProfile(auth);
  if (!current()) return false;
  app.profile = profile;
  if (app.user.isGuest) {
    Object.assign(app.profile, { role: 'listener', accountType: 'listener', onboarded: true, displayName: app.user.displayName });
    await saveProfile(auth, app.profile);
    if (!current()) return false;
  }
  // estética Prisma (2026-11-01): los perfiles existentes pasan una vez al tema nuevo en modo automático
  if (!app.profile.prisma) {
    Object.assign(app.profile, { theme: 'prisma', accent: null, mode: null, prisma: true });
    await saveProfile(auth, app.profile);
    if (!current()) return false;
  }
  await Promise.all([
    playlists.load(user.uid), stats.load(user.uid), artist.load(user.uid),
    taste.load(user.uid, defaultRegion()), posts.load().then(() => current() && posts.loadFollows(user.uid)), releases.load(),
    app.subs.load().then(() => app.charts.load()),
  ]);
  if (!current()) return false;
  await checkPremieres();
  if (!current()) return false;
  // role = verificado: sube con el reclamo aprobado y baja si ya no lo está; accountType se infiere en perfiles previos
  if (!app.user.isGuest && syncAccount(app.profile, artist.claim)) await saveProfile(auth, app.profile);
  if (!current()) return false;
  app.applyUserTheme();
  ui.accountLoading = false;
  return true;
}

// ---------- estrenos: programado → publicado al llegar la hora (al abrir, al volver y cada 30 s) ----------
async function checkPremieres() {
  const n = await releases.resolveScheduled(async (r) => {
    // el estudio guarda su propia copia de los lanzamientos de la cuenta: se sincroniza
    const mine = artist.getRelease(r.id);
    if (mine) Object.assign(mine, r);
    await materializeRelease(r);
    if (r.uid === app.user?.uid) toast(`«${r.title}» ya se estrenó`);
  });
  if (n && ['home', 'explore', 'feed', 'profile', 'studio', 'release'].includes(ui.view)) render();
}
setInterval(checkPremieres, 30e3);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkPremieres(); });

// un solo temporizador para todas las cuentas regresivas visibles
setInterval(() => {
  if (document.hidden) return;
  const now = Date.now();
  for (const el of document.querySelectorAll('[data-countdown]')) {
    const at = +el.dataset.countdown;
    el.textContent = at > now ? countdown(at, now) : 'Disponible ahora';
    if (at <= now && !el.dataset.done) { el.dataset.done = '1'; checkPremieres(); }
  }
  for (const box of document.querySelectorAll('[data-countdown-parts]')) {
    const at = +box.dataset.countdownParts;
    const parts = countdownParts(at, now);
    for (const k of ['d', 'h', 'm', 's']) {
      const node = box.querySelector(`[data-cd="${k}"]`);
      if (node && node.textContent !== parts[k]) node.textContent = parts[k];
    }
    if (parts.live && !box.dataset.done) { box.dataset.done = '1'; checkPremieres(); }
  }
}, 1000);

app.applyUserTheme = () => {
  const p = app.profile;
  if (!p) return;
  const look = { theme: p.theme, accent: p.accent, mode: p.mode, font: p.font };
  applyTheme(look);
  setDisplayFont(p.font);
  app.prefs.look = look;
  savePrefs();
  renderIsland();
  if (viz?.running) { viz.stop(); viz.start(); }
};

function setDisplayFont(font) {
  loadFont(font);
  document.documentElement.style.setProperty('--font-display', fontStack(font));
}

function applyMotion() {
  document.body.classList.toggle('no-motion', app.prefs.motion === false);
  motion.setEnabled(app.prefs.motion !== false);
  viz?.sync();
}
function applyAdvanced() { document.body.classList.toggle('advanced', !!app.prefs.advanced); }

let saveTimer = 0;
const deviceState = () => ({ engine: engine.settings, shuffle: player.shuffle, repeat: player.repeat, queue: player.snapshot() });
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => db.kvSet('settings', deviceState()), 300);
}
function savePrefs() { db.kvSet('prefs', app.prefs); }

// ---------- navegación ----------

const VIEWS = {
  home: disc.viewHome, explore: disc.viewExplore, mix: disc.viewMix, podcast: disc.viewPodcast, creator: disc.viewCreator, artistpage: ap.viewArtistPage, amalbum: ap.viewAppleAlbum, forartists: viewForArtists,
  feed: viewFeed, post: viewPost,
  songs: lib.viewSongs, albums: lib.viewAlbums, album: lib.viewAlbum, artists: lib.viewArtists, artist: lib.viewArtist,
  playlists: lib.viewPlaylists, playlist: lib.viewPlaylist,
  profile: viewProfile, claim: viewClaim, studio: viewStudio, release: viewRelease,
};
const SECTION_OF = {
  home: 'home', mix: 'home', forartists: 'home', explore: 'explore', podcast: 'explore', creator: 'explore', artistpage: 'explore', amalbum: 'explore', feed: 'feed', post: 'feed',
  songs: 'library', albums: 'library', album: 'library', artists: 'library', artist: 'library', playlists: 'library', playlist: 'library',
  profile: 'profile', claim: 'profile', studio: 'profile', release: 'profile', review: 'profile',
};

function go(view, param = null) {
  islandWheel?.reset();
  if (!auth.checkGuest() || ui.accountLoading) return;
  if (app.user?.isGuest && ['claim', 'studio', 'release', 'review'].includes(view)) { toast('Para acceder al área de artistas necesitás una cuenta permanente.'); return; }
  if (ui.npOpen) setNp(false);
  if (view === ui.view && param === ui.param && !ui.query) return;
  ui.back.push([ui.view, ui.param, els.view.scrollTop]);
  if (ui.back.length > 40) ui.back.shift();
  ui.view = view;
  ui.param = param;
  if (ui.query) { ui.query = ''; $('#search').value = ''; }
  closeIsland();
  transition(() => { render(); els.view.scrollTo({ top: 0 }); });
}
app.go = go;

function transition(fn) {
  return motion.transition(fn);
}

let renderToken = 0;
function render() {
  if (ui.accountLoading) { els.view.innerHTML = '<div class="loading-view" role="status">Cargando tu cuenta…</div>'; return; }
  ui.lists = [];
  ui.chunks = [];
  ui.mount = null;
  const token = ++renderToken;
  if (ui.view === 'review' && !ui.query) {
    els.view.innerHTML = '<div class="loading-view"><span class="pulse"></span></div>';
    viewReviewAsync().then((html) => { if (token === renderToken) { els.view.innerHTML = html; afterRender(); } });
  } else {
    els.view.innerHTML = ui.query ? viewUnifiedSearch() : (VIEWS[ui.view] || disc.viewHome)();
  }
  afterRender();
}
app.render = render;

function afterRender() {
  syncIsland();
  motion.reveal(els.view);
  initRanges(els.view);
  bindArtistInputs(els.view);
  bindComposer(els.view);
  markCurrent();
  a11y(els.view);
  const mount = ui.mount;
  ui.mount = null;
  mount?.(els.view);
  flushChunks(els.view);
}

// Accesibilidad: todo lo clickeable se alcanza con el teclado y tiene nombre para lectores de pantalla
function a11y(root = document) {
  root.querySelectorAll('[data-action]:not(button):not(a):not(input):not(select):not(label):not([tabindex])').forEach((el) => {
    el.tabIndex = 0;
    if (!el.getAttribute('role')) el.setAttribute('role', 'button');
  });
  root.querySelectorAll('button:not([aria-label])').forEach((b) => {
    if (!b.textContent.trim() && b.title) b.setAttribute('aria-label', b.title);
  });
  enhanceShelves(root);
}

// filas horizontales: flechas de vidrio para avanzar/retroceder con el mouse
function enhanceShelves(root) {
  root.querySelectorAll('.shelf:not([data-enh])').forEach((s) => {
    s.dataset.enh = '1';
    const wrap = document.createElement('div');
    wrap.className = 'shelf-wrap';
    s.before(wrap);
    wrap.append(s);
    wrap.insertAdjacentHTML('beforeend', `<button class="shelf-nav prev" tabindex="-1" aria-label="Anterior">${icon('chevronLeft')}</button><button class="shelf-nav next" tabindex="-1" aria-label="Siguiente">${icon('chevronLeft', 'rot180')}</button>`);
    const sync = () => {
      wrap.classList.toggle('at-start', s.scrollLeft < 8);
      wrap.classList.toggle('at-end', s.scrollLeft + s.clientWidth > s.scrollWidth - 8);
    };
    s.addEventListener('scroll', sync, { passive: true });
    wrap.addEventListener('pointerenter', sync);
    wrap.querySelector('.prev').onclick = () => s.scrollBy({ left: -s.clientWidth * 0.8, behavior: 'smooth' });
    wrap.querySelector('.next').onclick = () => s.scrollBy({ left: s.clientWidth * 0.8, behavior: 'smooth' });
    // sin medir al crear la fila: las flechas sólo se ven con el mouse encima y `pointerenter` ya mide antes de
    // mostrarlas. Medir en un fotograma forzaba un maquetado completo (40–60 ms) cada vez que llegaba una sección.
    wrap.classList.add('at-start');
  });
}
app.a11y = a11y;
app.markCurrent = () => markCurrent();

// contenido que llega después del render (secciones del inicio, búsqueda)
app.afterFill = (root) => { initRanges(root); markCurrent(); a11y(root); flushChunks(els.view); motion.reveal(root); };

// ---------- isla de navegación ----------

const ISLAND = [
  ['home', 'Inicio', 'home'], ['explore', 'Explorar', 'compass'], ['feed', 'Feed', 'feed'], ['search', 'Buscar', 'search'],
  ['songs', 'Biblioteca', 'library'], ['profile', 'Perfil', 'user'], ['settings', 'Ajustes', 'settings'], ['import', 'Agregar música', 'plus'],
];
let islandWheel = null;
const SECTION_LABEL = { home: 'Inicio', explore: 'Explorar', feed: 'Feed', library: 'Biblioteca', profile: 'Perfil' };

function renderIsland() {
  islandWheel?.reset();
  const searchBox = $('#search')?.closest('.search');
  const restoreSearch = document.activeElement?.id === 'search';
  const dock = els.dock;
  const p = app.profile;
  const lists = playlists.list.slice(0, 5);
  els.island.innerHTML = `
    <div class="island-panel" role="dialog" aria-label="Centro de ZUENA" aria-modal="true" tabindex="-1">
      <div class="island-heading"><span class="island-grabber" aria-hidden="true"></span><span class="island-brand">${logo()}<b>ZUENA</b></span><button type="button" class="btn-icon lit" data-island-close aria-label="Cerrar centro de ZUENA">${icon('close')}</button></div>
      <nav class="island-nav" aria-label="Ir a una sección">${ISLAND.filter(([id]) => !['search', 'import'].includes(id)).map(([id, label, ic]) => `<button type="button" class="island-item lit" data-island="${id}">${icon(ic)}<span>${label}</span></button>`).join('')}</nav>
      <div class="island-search-slot"></div>
      <div class="island-search-filters" aria-label="Secciones de la isla">${['Todo', 'Perfiles', 'Canciones', 'Estrenos', 'Playlists', 'Feed'].map((label, i) => `<button type="button" class="lit" data-search-filter="${i}" aria-pressed="${i === 0}">${label}</button>`).join('')}</div>
      <div class="island-content"><div class="island-results" aria-live="polite" hidden></div><div class="island-discovery">
      </div></div><div class="island-audio-slot"></div>
    </div>
    <button class="island-core" data-island-core aria-expanded="false" aria-haspopup="dialog" aria-label="Navegación (hacé clic o mantené el puntero 2 segundos)" title="Rueda sobre la sección para elegir; clic para abrir el menú.">
      <span class="island-fill" aria-hidden="true"></span>
      <span class="island-mark">${logo()}</span><span class="island-word">ZUENA</span><span class="island-label" id="island-label"></span>
      ${icon('chevronDown', 'island-chev')}
    </button>
    <div class="island-np mini-player" id="island-np" role="group" aria-label="Reproductor rápido" hidden>
      <button class="mini-art lit" data-action="player-open" aria-label="Abrir controles" title="Abrir controles"></button>
      <button class="mini-copy lit" data-action="open-np" title="Ampliar"><strong></strong><span></span></button>
      <button class="mini-toggle lit" data-action="toggle" aria-label="Reproducir" title="Reproducir">${icon('play')}</button>
      <button class="mini-next lit" data-action="next" aria-label="Siguiente" title="Siguiente">${icon('next')}</button>
      <button class="mini-expand lit" data-action="open-np" aria-label="Ampliar" title="Ampliar">${icon('expand')}</button>
      <span class="mini-progress" aria-hidden="true"><i></i></span>
    </div>`;
  if (searchBox) els.island.querySelector('.island-search-slot').append(searchBox);
  const audioSlot = els.island.querySelector('.island-audio-slot');
  audioSlot.append(dock);
  audioSlot.hidden = !player.current;
  const input = $('#search');
  if (input) { input.maxLength = 120; input.placeholder = 'Buscar música, perfiles, playlists y publicaciones'; input.setAttribute('aria-label', 'Buscar en ZUENA'); }
  els.island.querySelector('.island-panel').inert = !els.island.classList.contains('open');
  $$('.island-search-filters button', els.island).forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.searchFilter === islandSearchFilter)));
  if (els.island.classList.contains('open')) { searchIsland(); if (restoreSearch) $('#search')?.focus({ preventScroll: true }); }
  syncIsland();
  syncIslandNp();
  islandLive.attach(els.island);
  a11y(els.island);
}

// isla dinámica: actividades en vivo (js/ui/island.js · bóveda, carpeta Isla/)
const islandLive = createIslandLive({
  motion,
  onAction: (action) => {
    if (action === 'player') { if (player.current) setNp(true); }
    else if (action.startsWith('post:')) go('post', action.slice(5));
  },
});
app.island = islandLive;
let islandPostsSeen = Date.now();
function islandPosts() {
  const me = app.user?.uid;
  const fresh = posts.list.filter((p) => p.created > islandPostsSeen && !p.replyTo && p.uid !== me && posts.isFollowing(p.uid) && posts.visible(p));
  islandPostsSeen = Math.max(islandPostsSeen, ...posts.list.map((p) => p.created));
  if (!fresh.length || ui.view === 'feed') return;
  const p = fresh.at(-1), a = posts.author(p.uid) || p.author || {};
  islandLive.show({ id: 'post', kind: 'post', art: avatar(a, 'xs'), cap: fresh.length > 1 ? `${fresh.length} publicaciones nuevas` : 'Nueva publicación',
    title: a.displayName || 'Artista', sub: (p.text || '').slice(0, 60), ms: 4200, action: `post:${p.id}` });
}

// botón compacto "ahora suena" junto a la isla cuando el reproductor está retraído
function syncIslandNp() {
  const b = $('#island-np');
  if (!b) return;
  const t = player.current;
  b.hidden = !t;
  const audioSlot = els.island.querySelector('.island-audio-slot');
  if (audioSlot) audioSlot.hidden = !t;
  if (!t) { delete b.dataset.track; return; }
  if (b.dataset.track !== String(t.id)) {
    b.dataset.track = String(t.id);
    b.querySelector('.mini-art').innerHTML = art(t, 'xs');
  }
  b.querySelector('.mini-copy strong').textContent = t.title || 'Sin título';
  b.querySelector('.mini-copy span').textContent = t.artist || 'Artista desconocido';
  b.querySelector('.mini-copy').setAttribute('aria-label', `Ampliar: ${t.title || 'Sin título'}${t.artist ? ' · ' + t.artist : ''}`);
  b.querySelector('.mini-copy').title = [t.title, t.artist].filter(Boolean).join(' · ');
  const snapshot = playback.snapshot();
  b.dataset.transport = snapshot.status;
  const active = ['playing', 'buffering', 'loading'].includes(snapshot.status);
  const toggle = b.querySelector('.mini-toggle');
  if (toggle.dataset.active !== String(active)) {
    toggle.dataset.active = String(active);
    toggle.innerHTML = icon(active ? 'pause' : 'play');
  }
  toggle.setAttribute('aria-label', active ? 'Pausar' : 'Reproducir');
  toggle.title = snapshot.message;
  b.querySelector('.mini-next').disabled = player.nextPos(player.pos, true) < 0;
  updateMiniProgress(b, snapshot.position, snapshot.duration, snapshot.live);
}

// reproductor desplegable a la derecha de la isla; el conjunto se re-centra solo al cambiar de ancho
function setPlayer(open, byUser = false) {
  if (open && !player.current) return;
  if (byUser) ui.playerClosedByUser = !open;
  els.floatbar.classList.toggle('player-open', open);
  els.dock.setAttribute('aria-hidden', String(!open));
  els.dock.inert = !open;
  if (!ui.npOpen && !floating.isOpen) playback.setMode(open ? 'expanded' : 'compact');
  if (open) requestAnimationFrame(() => dockScrub?.resize());
  syncIslandNp();
  if (open && byUser) openIsland(true);
}

function syncIsland() {
  const sec = ui.query ? 'search' : SECTION_OF[ui.view] || 'home';
  const label = $('#island-label');
  if (label) label.textContent = sec === 'search' ? 'Buscar' : SECTION_LABEL[sec] || '';
  $$('.island-item', els.island).forEach((b) => b.classList.toggle('active', b.dataset.island === sec || (b.dataset.island === 'songs' && sec === 'library')));
}

let islandHold = 0, islandLeave = 0;
let islandSearchTimer = 0, islandSearchToken = 0, islandSearchFilter = 0, islandSearchResult = null, islandSearchLimit = 20;
function drawIslandContent(more = false) {
  mountIslandContent(els.island.querySelector('.island-discovery'), islandSearchFilter, { more });
}
function drawIslandSearch() {
  const box = els.island.querySelector('.island-results');
  if (!box || !islandSearchResult) return;
  const restoreFocus = box.contains(document.activeElement);
  const labels = ['', 'Perfiles', 'Canciones', 'Estrenos y lanzamientos', 'Tus playlists', 'Publicaciones'];
  const groups = islandSearchResult.groups.filter((g) => !islandSearchFilter || g.label === labels[islandSearchFilter]);
  box.innerHTML = searchMarkup({ ...islandSearchResult, groups: groups.map((g) => ({ ...g, items: g.items.slice(0, islandSearchFilter ? islandSearchLimit : 5) })) });
  if (islandSearchFilter && groups.some((g) => g.items.length > islandSearchLimit)) box.insertAdjacentHTML('beforeend', '<button class="btn-glass lit" data-search-more>Cargar más</button>');
  if (!islandSearchFilter) box.insertAdjacentHTML('beforeend', groups.filter((g) => g.items.length > 5).map((g) => `<button class="btn-glass lit" data-search-filter="${labels.indexOf(g.label)}">Ver todos · ${esc(g.label)}</button>`).join(''));
  a11y(box);
  if (restoreFocus) box.querySelector('button')?.focus({ preventScroll: true });
}
function searchIsland() {
  clearTimeout(islandSearchTimer);
  const token = ++islandSearchToken, query = $('#search').value.trim(), uid = app.user?.uid;
  const box = els.island.querySelector('.island-results');
  const discovery = els.island.querySelector('.island-discovery');
  box.hidden = !query; discovery.hidden = !!query;
  islandSearchResult = null;
  if (!query) { drawIslandContent(); return; }
  if (query.length < 2) { box.textContent = 'Escribí al menos dos caracteres.'; return; }
  box.textContent = 'Buscando…';
  islandSearchTimer = setTimeout(async () => {
    try {
      const result = await searchEverything(app, query, { onPartial: (partial) => {
        if (token !== islandSearchToken || app.user?.uid !== uid || !box.isConnected) return;
        islandSearchResult = partial; drawIslandSearch();
      } });
      if (token !== islandSearchToken || app.user?.uid !== uid || !box.isConnected) return;
      islandSearchResult = result; islandSearchLimit = 20; drawIslandSearch();
    } catch { if (token === islandSearchToken && box.isConnected) box.textContent = 'No se pudo completar la búsqueda. Probá de nuevo.'; }
  }, 180);
}
function openIsland(focusFirst = false) {
  islandWheel?.reset();
  clearTimeout(islandHold);
  clearTimeout(islandLeave);
  els.island.classList.remove('charging');
  // la isla es navegación: abrirla cierra "Ahora suena" para que nunca se superpongan
  if (ui.npOpen) setNp(false);
  els.island.classList.add('open');
  els.main.inert = true;
  const hasTrack = !!player.current;
  els.dock.inert = !hasTrack;
  els.dock.setAttribute('aria-hidden', String(!hasTrack));
  const audioSlot = els.island.querySelector('.island-audio-slot');
  if (audioSlot) audioSlot.hidden = !hasTrack;
  els.island.querySelector('.island-panel').inert = false;
  els.floatbar.classList.add('island-open'); // en móvil el reproductor se repliega para no tapar el menú
  $('[data-island-core]')?.setAttribute('aria-expanded', 'true');
  syncIsland();
  // En pantallas táctiles no enfocar automáticamente el buscador al abrir la isla (evita desplegar el teclado virtual).
  if (focusFirst === 'search' || (focusFirst && matchMedia('(pointer: fine)').matches)) {
    $('#search')?.focus({ preventScroll: true });
  } else {
    els.island.querySelector('[data-island-close]')?.focus({ preventScroll: true });
  }
  requestAnimationFrame(() => dockScrub?.resize());
  searchIsland();
}
function closeIsland() {
  clearTimeout(islandHold);
  clearTimeout(islandLeave);
  els.island.classList.remove('open', 'charging');
  if (!ui.npOpen) els.main.inert = false;
  const active = document.activeElement;
  els.island.querySelector('.island-panel').inert = true;
  clearTimeout(islandSearchTimer); ++islandSearchToken;
  els.floatbar.classList.remove('island-open');
  $('[data-island-core]')?.setAttribute('aria-expanded', 'false');
  if (els.island.contains(active)) $('[data-island-core]')?.focus({ preventScroll: true });
}

function islandGo(id) {
  closeIsland();
  // la isla queda por encima de "Ahora suena": al navegar desde ella se cierra la pantalla completa
  if (ui.npOpen) setNp(false);
  if (id === 'search') { openIsland('search'); $('#search')?.select(); return; }
  if (id === 'settings') { openPanel('settings'); return; }
  if (id === 'import') { $('#pick-files').click(); return; }
  ui.back = [];
  go(id);
}

function bindIsland() {
  const isl = els.island;
  islandWheel = bindIslandWheel(isl, {
    items: ISLAND.filter(([id]) => id !== 'import'),
    current: () => ui.panel === 'settings' ? 'settings' : ui.query ? 'search' : SECTION_OF[ui.view] === 'library' ? 'songs' : SECTION_OF[ui.view] || 'home',
    canUse: () => !!app.user && !ui.accountLoading && !ui.npOpen && auth.checkGuest(),
    onInteract: () => { clearTimeout(islandHold); isl.classList.remove('charging'); },
    onPreview: ([id, label]) => {
      $('#island-label').textContent = label;
      const core = $('[data-island-core]');
      core.setAttribute('aria-label', `Ir a ${label}. Hacé clic para confirmar`);
      core.title = `Ir a ${label} · clic para confirmar · Escape para cancelar`;
      motion.animate($('#island-label'), [{ opacity: .35, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 160, commit: false });
    },
    onReset: () => {
      syncIsland();
      const core = $('[data-island-core]');
      core?.setAttribute('aria-label', 'Navegación (hacé clic o mantené el puntero 2 segundos)');
      if (core) core.title = 'Rueda sobre la sección para elegir; clic para abrir el menú.';
    },
    onCommit: (id) => islandGo(id),
  });
  let miniSwipe = null, miniSuppressUntil = 0;
  isl.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    const np = e.target.closest('#island-np');
    if (np) {
      miniSwipe = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), kind: 'mini' };
      return;
    }
    if (isl.classList.contains('open') && e.target.closest('.island-heading, .island-nav, .island-search-filters')) {
      miniSwipe = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), kind: 'panel' };
    }
  }, { passive: true });
  isl.addEventListener('pointerup', (e) => {
    if (!miniSwipe || e.pointerId !== miniSwipe.id) return;
    const dx = e.clientX - miniSwipe.x, dy = e.clientY - miniSwipe.y, dt = performance.now() - miniSwipe.t;
    const kind = miniSwipe.kind;
    miniSwipe = null;
    if (dt > 700) return;
    if (kind === 'mini' && player.current) {
      if (dy < -36 && Math.abs(dy) > Math.abs(dx) * 1.2) {
        miniSuppressUntil = performance.now() + 450;
        setNp(true);
      } else if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.35) {
        miniSuppressUntil = performance.now() + 450;
        playback.dispatch(dx < 0 ? 'next' : 'prev');
      }
    } else if (kind === 'panel' && isl.classList.contains('open')) {
      if (dy > 48 && Math.abs(dy) > Math.abs(dx) * 1.2) {
        miniSuppressUntil = performance.now() + 450;
        closeIsland();
      }
    }
  }, { passive: true });
  isl.addEventListener('pointercancel', () => { miniSwipe = null; }, { passive: true });
  isl.addEventListener('click', (e) => {
    if (miniSuppressUntil > performance.now()) {
      miniSuppressUntil = 0;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (!auth.checkGuest() || ui.accountLoading) { e.preventDefault(); e.stopPropagation(); return; }
    if (e.target.closest('[data-island-close]')) { closeIsland(); $('[data-island-core]')?.focus(); return; }
    const filter = e.target.closest('[data-search-filter]');
    if (filter) { islandSearchFilter = +filter.dataset.searchFilter; islandSearchLimit = 20; $$('.island-search-filters button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.searchFilter === islandSearchFilter))); if ($('#search').value.trim()) drawIslandSearch(); else drawIslandContent(); return; }
    if (e.target.closest('[data-island-more]')) { drawIslandContent(true); return; }
    if (e.target.closest('[data-island-refresh]')) { drawIslandContent(); return; }
    const postAction = e.target.closest('.ic-post [data-action]');
    if (postAction && ['post-like', 'post-share'].includes(postAction.dataset.action)) {
      e.stopPropagation();
      if (!islandPostAvailable(postAction.dataset.id)) { toast('Esta publicación ya no está disponible.'); refreshIslandPosts(els.island); return; }
      if (postAction.disabled) return;
      const share = postAction.dataset.action === 'post-share';
      if (share) postAction.disabled = true;
      Promise.resolve(app.actions[postAction.dataset.action](postAction, e)).catch(() => toast('No se pudo completar la acción. Probá de nuevo.')).finally(() => { if (share && postAction.isConnected) postAction.disabled = false; });
      return;
    }
    if (e.target.closest('[data-search-more]')) { islandSearchLimit += 20; drawIslandSearch(); return; }
    if (e.target.closest('[data-island-core]')) { if (isl.classList.contains('open')) { closeIsland(); $('[data-island-core]')?.focus(); } else openIsland(true); return; }
    const item = e.target.closest('[data-island]');
    if (item) { e.stopPropagation(); islandGo(item.dataset.island); }
    else if (e.target.closest('[data-action]') && !e.target.closest('#dock, #island-np') && !['post-like', 'post-share', 'post-repost'].includes(e.target.closest('[data-action]').dataset.action)) closeIsland();
  });
  // mantener el puntero 2 s sobre el BOTÓN (no sobre el área del menú cerrado) abre la isla;
  // el progreso se ve como un relleno de vidrio dentro del botón
  isl.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch' || !e.target.closest('[data-island-core]')) return;
    clearTimeout(islandLeave);
    if (isl.classList.contains('open') || isl.classList.contains('charging') || e.target.closest('[data-island-core]')?.hasAttribute('data-wheel-browsing')) return;
    isl.classList.add('charging');
    islandHold = setTimeout(openIsland, 2000);
  });
  isl.addEventListener('pointerout', (e) => {
    const core = e.target.closest('[data-island-core]');
    if (core && !core.contains(e.relatedTarget)) { clearTimeout(islandHold); isl.classList.remove('charging'); }
  });
  // abierta, se cierra al salir del botón y del menú
  isl.addEventListener('pointerenter', () => clearTimeout(islandLeave));
  isl.addEventListener('pointerleave', () => {
    clearTimeout(islandHold);
    isl.classList.remove('charging');
    // El panel permanece abierto mientras se usa búsqueda o audio.
  });
  let swallowOutsideClick = 0;
  document.addEventListener('pointerdown', (e) => {
    if (isl.classList.contains('open') && !isl.contains(e.target)) {
      if (e.pointerType !== 'mouse') swallowOutsideClick = performance.now() + 600;
      closeIsland();
    }
  }, true);
  document.addEventListener('click', (e) => {
    if (swallowOutsideClick > performance.now() && !isl.contains(e.target)) {
      swallowOutsideClick = 0;
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
}

// ---------- reproductor (arriba) y "Ahora suena" ----------

function controls(big = false) {
  return `<div class="controls ${big ? 'big' : ''}">
    <button class="btn-icon lit js-shuffle" data-action="shuffle" title="Aleatorio (S)">${icon('shuffle')}</button>
    <button class="btn-icon lit" data-action="prev" title="Anterior (Shift+←)">${icon('prev')}</button>
    <button class="btn-play lit js-play" data-action="toggle" title="Reproducir (Espacio)">${icon('play')}</button>
    <button class="btn-icon lit" data-action="next" title="Siguiente (Shift+→)">${icon('next')}</button>
    <button class="btn-icon lit js-repeat" data-action="repeat" title="Repetir (R)">${icon('repeat')}</button>
  </div>`;
}

function volume(cls = '') {
  return `<div class="volume ${cls}">
    <button class="btn-icon lit sm js-mute" data-action="mute" title="Silenciar (M)">${icon('volume')}</button>
    <input type="range" class="range js-vol" min="0" max="1" step="0.005" aria-label="Volumen">
  </div>`;
}

function renderDock() {
  els.dock.innerHTML = `
    <div class="pl-inner">
      <div class="dock-head">
      <button class="dock-art lit" data-action="open-np" id="dock-art" title="Ampliar reproductor" aria-label="Ampliar reproductor"></button>
      <div class="dock-meta">
        <div class="dock-title js-title">Nada sonando</div>
        <div class="dock-artist js-artist">Elegí algo para escuchar</div>
        <span class="transport-state js-transport-state" role="status"></span>
      </div>
      <button class="btn-icon lit sm js-like" data-action="like-current" title="Me gusta (L)" hidden>${icon('heart')}</button>
      <button class="btn-icon lit" data-action="open-np" title="Ampliar reproductor" aria-label="Ampliar reproductor">${icon('expand')}</button>
      </div>
      <div class="timeline"><span class="time js-pos">0:00</span><div class="scrub-wrap"><canvas class="scrub" id="dock-scrub"></canvas><span class="live-bar">En vivo</span></div><span class="time js-dur">0:00</span></div>
      <div class="dock-bottom">
      <div class="pl-controls">
        <button class="btn-icon lit js-shuffle dock-mode" data-action="shuffle" title="Aleatorio" aria-label="Aleatorio">${icon('shuffle')}</button>
        <button class="btn-icon lit sm" data-action="prev" title="Anterior (Shift+←)">${icon('prev')}</button>
        <button class="btn-play lit js-play" data-action="toggle" title="Reproducir (Espacio)">${icon('play')}</button>
        <button class="btn-icon lit sm" data-action="next" title="Siguiente (Shift+→)">${icon('next')}</button>
        <button class="btn-icon lit js-repeat dock-mode" data-action="repeat" title="Repetir">${icon('repeat')}</button>
      </div>
      <div class="dock-tools">
        <button class="btn-icon lit" data-action="player-view" data-tab="queue" title="A continuación" aria-label="A continuación">${icon('queue')}</button>
        ${volume('dock-volume')}
      </div>
      </div>
      <div class="transport-feedback js-transport-feedback" hidden><span class="js-transport-message"></span><button class="btn-glass lit js-retry" data-action="retry-playback">Reintentar</button></div>
    </div>`;
  dockScrub = new Scrubber($('#dock-scrub'), { onSeek: (t) => playback.dispatch('seek', t) });
  els.dock.inert = true;
  els.dock.setAttribute('aria-hidden', 'true');
}

function renderNowPlaying() {
  els.np.innerHTML = `
    <div class="np-bg" id="np-bg"></div>
    <canvas class="np-viz" id="np-viz" aria-hidden="true"></canvas>
    <header class="np-top">
      <span class="np-grabber" aria-hidden="true"></span>
      <button class="btn-icon lit" data-action="close-np" title="Cerrar (Esc)">${icon('chevronDown')}</button>
      <div class="np-tabs" role="tablist" aria-label="Vista">
        <span class="np-tab-indicator" aria-hidden="true"></span>
        ${PLAYER_TABS.map(([id, l, glyph]) => `<button class="np-tab lit" role="tab" id="np-tab-${id}" aria-controls="np-pane" data-action="np-tab" data-tab="${id}" aria-selected="false">${icon(glyph)}<span>${l}</span></button>`).join('')}
      </div>
      <div class="np-top-right">
        <button class="btn-icon lit js-float" data-action="floating-player" title="Abrir reproductor en otra ventana" aria-pressed="false">${icon('expand')}</button>
        <button class="btn-icon lit js-sleep" data-action="sleep-menu" title="Temporizador para dormir">${icon('moon')}</button>
        <button class="btn-icon lit" data-action="np-more" title="Más opciones">${icon('more')}</button>
      </div>
    </header>
    <div class="np-body">
      <div class="np-stage">
        <div class="np-orb" aria-hidden="true"></div>
        <div class="np-art" id="np-art"></div>
      </div>
      <div class="np-side">
        <div class="np-titles">
          <div class="np-title-row"><h2 class="js-title">Nada sonando</h2><button class="btn-icon lit js-like" data-action="like-current" title="Me gusta" hidden>${icon('heart')}</button></div>
          <h2 class="js-artist np-artist"></h2>
          <div class="np-album js-album"></div>
          <span class="transport-state js-transport-state" role="status"></span>
        </div>
        <div class="transport-feedback js-transport-feedback" hidden><span class="js-transport-message"></span><button class="btn-glass lit js-retry" data-action="retry-playback">Reintentar</button></div>
        <div class="np-pane" id="np-pane" role="tabpanel"></div>
        <div class="np-scrub">
          <div class="scrub-wrap"><canvas class="scrub big" id="np-scrub"></canvas><span class="live-bar">En vivo</span></div>
          <div class="np-times"><span class="js-pos">0:00</span><span class="badge js-badge" hidden></span><button class="np-dur js-dur" data-action="toggle-remaining" title="Mostrar tiempo restante">0:00</button></div>
        </div>
        ${controls(true)}
        ${volume('wide')}
        <button class="np-next lit" data-action="player-view" data-tab="queue" aria-label="Ver A continuación"><span class="np-next-copy"><small>A continuación</small><strong class="js-next-title">No hay más pistas</strong><span class="js-next-artist"></span></span>${icon('queue')}</button>
        <div class="np-extra" id="np-extra"></div>
        <div class="np-tech glass-soft adv-only" id="np-tech"></div>
      </div>
    </div>`;
  npScrub = new Scrubber($('#np-scrub'), { onSeek: (t) => playback.dispatch('seek', t), barWidth: 4, gap: 2 });
  viz = new Visualizer($('#np-viz'), engine.analyser);
  setNpTab(ui.npTab || 'now');
  scheduleTransportView();
  bindNowPlayingTouch();
}

function bindNowPlayingTouch() {
  let start = null;
  els.np.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || !ui.npOpen || e.target.closest('canvas.scrub, input[type=range], button, a')) {
      start = null;
      return;
    }
    const zone = e.target.closest('.np-top, .np-stage, .np-titles') ? 'stage' : e.target.closest('#np-pane') ? 'pane' : 'body';
    start = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), zone };
  }, { passive: true });
  els.np.addEventListener('pointerup', (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y, dt = performance.now() - start.t;
    const zone = start.zone;
    start = null;
    if (dt > 750 || !ui.npOpen) return;
    const body = els.np.querySelector('.np-body');
    if (dy > 58 && Math.abs(dy) > Math.abs(dx) * 1.25 && (zone === 'stage' || (body && body.scrollTop <= 2 && zone !== 'pane'))) {
      setNp(false);
    } else if (zone === 'stage' && Math.abs(dx) > 52 && Math.abs(dx) > Math.abs(dy) * 1.3) {
      playback.dispatch(dx < 0 ? 'next' : 'prev');
    }
  }, { passive: true });
  els.np.addEventListener('pointercancel', () => { start = null; }, { passive: true });
}

// ----- pestañas de "Ahora suena": reproducción, letra sincronizada y cola -----
let transportFrame = 0;
function scheduleTransportView() {
  if (!transportFrame) transportFrame = requestAnimationFrame(() => { transportFrame = 0; syncTransportView(); });
}

function syncTransportView() {
  const s = playback.snapshot();
  syncPlayState();
  syncIslandNp();
  for (const root of [els.dock, els.np]) {
    root.dataset.transport = s.status;
    const status = root.querySelector('.js-transport-state');
    if (status && status.textContent !== s.message) status.textContent = s.message;
    const feedback = root.querySelector('.js-transport-feedback');
    if (feedback) {
      feedback.hidden = !s.canRetry;
      feedback.querySelector('.js-transport-message').textContent = s.canRetry ? s.message : '';
    }
    root.querySelectorAll('[data-action="toggle"], [data-action="prev"], [data-action="next"]').forEach(b => { b.disabled = !s.track; });
    const scrub = root.querySelector('canvas.scrub');
    if (scrub) { scrub.setAttribute('aria-disabled', String(!s.canSeek)); scrub.tabIndex = s.canSeek ? 0 : -1; }
  }
  const title = els.np.querySelector('.js-next-title');
  if (title) title.textContent = s.nextTrack?.title || 'No hay más pistas';
  const nextLabel = els.np.querySelector('.np-next small');
  if (nextLabel) nextLabel.textContent = player.repeat === 'one' && s.track ? 'Se repetirá esta pista' : 'A continuación';
  const artist = els.np.querySelector('.js-next-artist');
  if (artist) artist.textContent = s.nextTrack?.artist || 'Podés agregar música a la cola';
}

let lyricsState = { id: null, data: null, active: -1, userScrollUntil: 0 };

function setNpTab(tab) {
  tab = PLAYER_TABS.some(([id]) => id === tab) ? tab : 'now';
  const changed = ui.npTab !== tab;
  ui.npTab = tab;
  els.np.dataset.tab = tab;
  $$('.np-tab', els.np).forEach((b) => { const on = b.dataset.tab === tab; b.classList.toggle('on', on); b.tabIndex = on ? 0 : -1; b.setAttribute('aria-selected', String(on)); });
  $('#np-pane').setAttribute('aria-labelledby', 'np-tab-' + tab);
  renderNpPane();
  selectPlayerTab(els.np, motion, tab, { animate: changed && ui.npOpen });
}

function renderNpPane() {
  const pane = $('#np-pane');
  if (!pane) return;
  const t = player.current;
  if (ui.npTab === 'credits') {
    pane.innerHTML = creditsPane(t, trackCredits(t, releases, app.isAvailable));
  } else if (ui.npTab === 'queue') {
    const up = player.upcoming(60);
    pane.innerHTML = `<div class="np-queue">${up.length ? up.map((u) => `<div class="qitem lit" role="button" tabindex="0" data-action="queue-play" data-pos="${u.pos}">${art(u.track, 'xs')}
      <div class="row-main"><div class="row-title">${esc(u.track.title)}</div><div class="row-sub">${esc(u.track.artist || '')}</div></div>
      <span class="row-dur">${u.track.live ? 'En vivo' : u.track.duration ? fmtTime(u.track.duration) : ''}</span></div>`).join('') : '<p class="hint">No hay nada más en la cola.</p>'}</div>`;
  } else if (ui.npTab === 'lyrics') {
    pane.innerHTML = '<div class="np-lyrics" id="np-lyrics"><p class="hint">Buscando la letra…</p></div>';
    loadNpLyrics(t);
  } else {
    pane.innerHTML = '';
  }
}

async function loadNpLyrics(t) {
  const box = $('#np-lyrics');
  if (!box || !t) return;
  if (lyricsState.id !== t.id) lyricsState = { id: t.id, data: null, active: -1, userScrollUntil: 0 };
  const { loadLyrics } = await import('./ui/lyrics.js');
  const state = lyricsState;
  const data = state.data || await loadLyrics(t);
  if (player.current?.id !== t.id || !box.isConnected) return;
  state.data = data;
  if (data.synced) {
    box.innerHTML = `${data.synced.map((l, i) => `<p class="ly" data-i="${i}" data-t="${l.t}" role="button" tabindex="-1">${esc(l.text) || '♪'}</p>`).join('')}<p class="ly-src">Letra: ${esc(data.source || 'archivo')}</p>`;
    box.onclick = (e) => { const p = e.target.closest('.ly'); if (p) player.seek(+p.dataset.t); };
    box.onwheel = box.ontouchmove = () => { lyricsState.userScrollUntil = performance.now() + 4000; };
    lyricsState.active = -1;
    syncLyrics(true);
  } else if (data.plain) {
    box.innerHTML = `<div class="ly-plain">${esc(data.plain).replace(/\n/g, '<br>')}</div><p class="ly-src">${data.preview ? 'Vista previa: letra sin sincronizar · ' : ''}Letra: ${esc(data.source || 'archivo')}</p>`;
  } else {
    box.innerHTML = `<p class="hint ly-none">${esc(data.reason)}</p>`;
  }
}

// resalta la línea actual y la mantiene centrada (salvo que el usuario esté desplazando)
function syncLyrics(force = false) {
  const data = lyricsState.data;
  if (!ui.npOpen || ui.npTab !== 'lyrics' || !data?.synced) return;
  const pos = currentPos() + 0.15;
  let i = data.synced.length - 1;
  while (i >= 0 && data.synced[i].t > pos) i--;
  if (i === lyricsState.active && !force) return;
  lyricsState.active = i;
  const box = $('#np-lyrics');
  if (!box) return;
  box.querySelector('.ly.on')?.classList.remove('on');
  const line = box.querySelector(`.ly[data-i="${Math.max(0, i)}"]`);
  if (i >= 0) line?.classList.add('on');
  if (line && performance.now() > lyricsState.userScrollUntil) {
    box.scrollTo({ top: line.offsetTop - box.clientHeight / 2 + line.clientHeight / 2, behavior: force || app.prefs.motion === false || systemReducedMotion.matches ? 'auto' : 'smooth' });
  }
}

// colores de la carátula para el fondo y el listón
async function tintNp(t) {
  const { artColors } = await import('./ui/artcolor.js');
  const url = t ? library.coverUrl(t) : null;
  const c = await artColors(url);
  if (t !== player.current) return;
  const rgb = (v) => (v ? `rgb(${v.join(' ')})` : null);
  els.np.style.setProperty('--np-a', rgb(c?.a) || 'var(--iri-1)');
  els.np.style.setProperty('--np-b', rgb(c?.b) || 'var(--iri-4)');
  viz?.setColors(c?.a, c?.b);
}

// ----- temporizador para dormir -----
let sleepTimer = { until: 0, endOfTrack: false, fading: false };

function setSleep(minutes) {
  sleepTimer = { until: minutes > 0 ? Date.now() + minutes * 60000 : 0, endOfTrack: minutes === -1, fading: false };
  $$('.js-sleep').forEach((b) => b.classList.toggle('on', !!(sleepTimer.until || sleepTimer.endOfTrack)));
  toast(minutes === 0 ? 'Temporizador desactivado' : minutes === -1 ? 'Se va a pausar al terminar esta canción' : `Se va a pausar en ${minutes} minutos`);
}

function checkSleep() {
  if (!sleepTimer.until || sleepTimer.fading || !engine.playing) return;
  if (Date.now() >= sleepTimer.until) {
    // fundido de 8 s y pausa; después se restaura el volumen
    sleepTimer.fading = true;
    const vol = engine.settings.volume;
    const t0 = Date.now();
    const fade = setInterval(() => {
      const k = Math.min(1, (Date.now() - t0) / 8000);
      engine.setSettings({ volume: vol * (1 - k) });
      if (k >= 1) { clearInterval(fade); engine.pause(); engine.setSettings({ volume: vol }); syncVolume(); setSleep(0); }
    }, 200);
  }
}
function setNp(open) {
  if (!!ui.npOpen === open) return;
  if (open && !player.current) return;
  if (open) islandWheel?.reset();
  cancelAnimationFrame(npFocusFrame);
  // un panel (Ajustes, cola, EQ) abierto quedaba encima de la pantalla completa
  if (open && ui.panel) { ui.panel = null; renderPanel(); }
  if (open) npOpener = document.activeElement;
  if (open) closeIsland();
  $('#app').inert = open;
  els.floatbar.inert = open;
  const restoreFocus = !open && els.np.contains(document.activeElement);
  ui.npOpen = open;
  if (!floating.isOpen) playback.setMode(open ? 'fullscreen' : els.floatbar.classList.contains('player-open') ? 'expanded' : 'compact');
  els.np.classList.toggle('open', open);
  els.np.setAttribute('aria-hidden', String(!open));
  // con "Ahora suena" abierto la cápsula del reproductor se oculta (los controles ya están en pantalla)
  els.floatbar.classList.toggle('np-mode', open); // no 'np': esa clase es la pantalla completa
  // cerrado no se puede tabular por sus controles; abierto el foco entra y al cerrar vuelve
  els.np.inert = !open;
  if (open) {
    enterPlayer(els.np, motion);
    viz.start();
    npScrub.resize();
    renderTech();
    if (ui.npTab === 'credits') renderNpPane();
    els.np.querySelector('[data-action=close-np]')?.focus({ preventScroll: true });
  } else {
    cancelPlayerPresentation(els.np, motion);
    viz.stop();
    if (restoreFocus) {
      const opener = npOpener;
      npFocusFrame = requestAnimationFrame(() => {
        if (ui.npOpen) return;
        const visible = (el) => el?.isConnected && !el.closest('[inert], [hidden]') && getComputedStyle(el).visibility === 'visible' && el.getBoundingClientRect().width > 0;
        const fallback = $('#island-np .mini-art');
        (visible(opener) ? opener : visible(fallback) ? fallback : $('[data-island-core]'))?.focus({ preventScroll: true });
      });
    }
    npOpener = null;
  }
}
let npOpener = null, npFocusFrame = 0;

let lastTrackId = null;
function syncArtist(t) {
  const credit = trackCredits(t, releases, app.isAvailable);
  const markup = credit.byline || credit.message || 'Artista desconocido';
  $$('.js-artist').forEach((el) => {
    if (el.dataset.byline !== markup) { el.innerHTML = markup; el.dataset.byline = markup; }
  });
}
function syncPlayer() {
  const t = player.current;
  const q = t && t.kind !== 'remote' ? quality(t) : null;
  $$('.js-title').forEach((e) => { e.textContent = t ? t.title : 'Nada sonando'; });
  // el nombre lleva al perfil si el artista lo tiene (ZUENA o catálogo de prueba)
  syncArtist(t);
  $$('.js-album').forEach((e) => { e.textContent = t ? [t.album, t.year].filter(Boolean).join(' · ') : ''; });
  $$('.js-badge').forEach((e) => {
    const label = t?.live ? 'En vivo' : t?.preview ? 'Vista previa' : q?.label;
    e.hidden = !label;
    if (label) { e.textContent = label; e.title = q?.detail || ''; e.classList.toggle('hi', !!q?.hi); e.classList.toggle('live', !!t?.live); }
  });
  document.body.classList.toggle('is-live', !!t?.live);
  syncLike();
  if (t?.id !== lastTrackId) {
    lastTrackId = t?.id ?? null;
    $('#dock-art').innerHTML = art(t, 'sm');
    const npArt = $('#np-art');
    npArt.innerHTML = art(t, 'cover');
    if (ui.npOpen) motion.animate(npArt, [{ opacity: .3, transform: 'scale(.975)' }, { opacity: 1, transform: 'none' }], { duration: 320, commit: false });
    const url = t?.kind === 'remote' ? t.artworkLarge || t.artwork : library.coverUrl(t);
    $('#np-bg').style.backgroundImage = url ? `url("${url}")` : '';
    els.np.dataset.kind = t?.type || 'track';
    tintNp(t);
    if (ui.npTab !== 'now') renderNpPane();
    $('#np-extra').innerHTML = t?.preview && t.externalUrl
      ? `<a class="link-chip lit" href="${esc(t.externalUrl)}" target="_blank" rel="noopener noreferrer">${icon('link')}Vista previa de 30 s · escuchala completa en Apple Music</a>`
      : t?.source === 'audius' && t.artistId ? `<button class="link-chip lit" data-action="creator" data-id="${esc(t.artistId)}">${icon('mic')}Ver a ${esc(t.artist)}${tick(t.verified)}</button>` : '';
    updateMediaSession(t);
  }
  const wave = t?.analysis?.waveform;
  dockScrub.setWave(wave);
  npScrub.setWave(wave);
  $$('.js-shuffle').forEach((b) => { b.classList.toggle('on', player.shuffle); b.setAttribute('aria-pressed', String(player.shuffle)); });
  $$('.js-repeat').forEach((b) => { b.classList.toggle('on', player.repeat !== 'off'); b.innerHTML = icon(player.repeat === 'one' ? 'repeat1' : 'repeat'); b.setAttribute('aria-label', { off: 'Repetir: apagado', all: 'Repetir: todo', one: 'Repetir: una' }[player.repeat]); });
  syncSpatialBtn();
  syncIslandNp();
  if (!t) setPlayer(false);
  document.title = t ? `${t.title} — ${t.artist || 'ZUENA'}` : 'ZUENA';
  lastSec = -1;
  markCurrent();
  if (ui.panel === 'queue') renderPanel();
  if (ui.npOpen && ui.npTab === 'queue') renderNpPane();
  if (!t && ui.npOpen) setNp(false);
  saveSettings();
}

function syncSpatialBtn() {
  const m = engine.settings.spatial;
  $$('.js-spatial').forEach((b) => {
    b.classList.toggle('on', m !== 'off');
    b.title = `Audio espacial: ${{ off: 'apagado', wide: 'amplio', spatial: 'espacial' }[m]}`;
    b.setAttribute('aria-label', b.title);
    b.setAttribute('aria-pressed', String(m !== 'off'));
  });
}

function syncLike() {
  const t = player.current;
  const liked = t && playlists.isLiked(t.id);
  $$('.js-like').forEach((b) => {
    b.hidden = !t;
    b.classList.toggle('on', !!liked);
    b.innerHTML = icon(liked ? 'heartFill' : 'heart');
    b.setAttribute('aria-pressed', String(!!liked));
    b.setAttribute('aria-label', liked ? 'Quitar de Me gusta' : 'Me gusta');
  });
}

function syncPlayState() {
  const playing = ['playing', 'buffering', 'loading'].includes(playback.status);
  document.body.classList.toggle('is-playing', playback.snapshot().playing);
  $$('.js-play').forEach((b) => { b.innerHTML = icon(playing ? 'pause' : 'play'); b.title = playing ? 'Pausar (Espacio)' : 'Reproducir (Espacio)'; b.setAttribute('aria-label', playing ? 'Pausar' : 'Reproducir'); });
}

function syncVolume() {
  const { volume: v, muted } = engine.settings;
  $$('.js-vol').forEach((r) => { r.value = v; fill(r); });
  $$('.js-mute').forEach((b) => { b.innerHTML = icon(muted || v === 0 ? 'mute' : v < 0.5 ? 'volumeLow' : 'volume'); b.setAttribute('aria-label', muted || v === 0 ? 'Activar sonido' : 'Silenciar'); b.setAttribute('aria-pressed', String(muted)); });
}

function markCurrent() {
  const id = player.current?.id;
  $$('.row, .card[data-id]').forEach((r) => r.classList.toggle('is-current', !!id && r.dataset.id === id));
}

function refreshLikes() {
  $$('.row-like').forEach((b) => {
    const on = playlists.isLiked(b.dataset.id);
    b.classList.toggle('on', on);
    b.innerHTML = icon(on ? 'heartFill' : 'heart');
  });
  syncLike();
}

// Panel técnico (sólo Modo avanzado): fuente, salida, sonoridad y medidores en vivo
function meterBar(db, min = -48) {
  const pct = Math.max(0, Math.min(100, ((db - min) / -min) * 100));
  return `<div class="meter"><i style="width:${pct.toFixed(1)}%" class="${db > -1 ? 'hot' : ''}"></i></div>`;
}

function renderTech() {
  const box = $('#np-tech');
  const t = player.current;
  if (!t || !app.prefs.advanced) { box.innerHTML = ''; return; }
  const a = t.analysis, o = engine.outputInfo, m = engine.readMeters() || {};
  const ch = o.channels ? (o.channels === 1 ? 'mono' : o.channels === 2 ? 'estéreo' : `${o.channels} canales`) : t.channels === 2 ? 'estéreo' : '';
  const srcLine = t.kind === 'remote'
    ? `${{ audius: 'Audius (stream completo)', apple: 'Apple Music (vista previa AAC)', itunes: 'Episodio de podcast', radio: `Radio ${t.codec || ''} ${t.bitrate ? `${t.bitrate} kbps` : ''}` }[t.source] || 'Externa'}`
    : [quality(t).detail, ch].filter(Boolean).join(' · ');
  const resample = o.sourceRate && o.sourceRate !== o.sampleRate ? `remuestreado ${fmtRate(o.sourceRate)} → ${fmtRate(o.sampleRate)}` : o.streaming ? 'stream' : 'sin remuestreo';
  box.innerHTML = `
    <div class="tech-row"><span>Fuente</span><b>${esc(srcLine)}</b></div>
    <div class="tech-row"><span>Salida</span><b>${fmtRate(o.sampleRate)} · float 32 · ${resample} · ${o.latency.toFixed(0)} ms${o.processed ? '' : ' · <em>sin procesamiento (la fuente no lo permite)</em>'}</b></div>
    <div class="tech-row"><span>Espacial</span><b>${{ off: 'apagado', wide: 'ensanchamiento M/S', spatial: `HRTF binaural · ${o.channels >= 6 ? `${o.channels} parlantes virtuales` : 'upmix 2 → 7.1.4 virtual'}` }[engine.settings.spatial]}${engine.settings.crossfeed && engine.settings.spatial !== 'spatial' ? ' · crossfeed' : ''}</b></div>
    <div class="tech-row"><span>Integrada</span><b>${a ? `${a.lufs.toFixed(1)} LUFS → ${engine.settings.normalize ? fmtDb(engine.normDb(t)) : 'sin normalizar'} · TP ${a.truePeakDb.toFixed(1)} dBTP` : t.kind === 'remote' ? 'no disponible en streams' : t.analysisFailed ? 'no disponible' : 'analizando…'}</b></div>
    <div class="tech-row"><span>Momentánea</span><b>${m.momentary > -70 ? `${m.momentary.toFixed(1)} LUFS` : '—'}</b></div>
    <div class="tech-row meters"><span>Pico L / R</span><div>${meterBar(m.peakL)}${meterBar(m.peakR)}</div><b>${m.peakL > -90 ? `${m.peakL.toFixed(1)} / ${m.peakR.toFixed(1)} dBFS` : '—'}</b></div>
    <div class="tech-row"><span>Pico al limitador</span><b>${m.truePeak > -90 ? `${m.truePeak.toFixed(1)} dBTP (salida ≤ −1 dBTP)` : '—'}</b></div>
    <div class="tech-row"><span>Correlación</span><div class="corr"><i style="left:${((m.correlation + 1) * 50).toFixed(1)}%"></i></div><b>${(m.correlation || 0).toFixed(2)}</b></div>
    <div class="tech-row"><span>Limitador</span><div class="gr"><i style="width:${Math.min(100, (m.gr / 6) * 100).toFixed(1)}%"></i></div><b>${!engine.settings.limiter ? 'apagado' : m.gr > 0.05 ? `−${m.gr.toFixed(1)} dB` : 'en reposo'}</b></div>`;
}

// ---------- paneles ----------

// openPanel('settings') alterna y abre en la lista; con sección va directo a esa categoría (no alterna)
function openPanel(name, section = null) {
  islandWheel?.reset();
  if (ui.npOpen) setNp(false);
  if (section && name === 'settings') {
    if (section === 'eq') { ui.panel = 'eq'; ui.settingsView = null; ui.eqFromSettings = true; renderPanel(true); return; }
    ui.panel = 'settings';
    ui.settingsView = settingsCategories().some((c) => c.id === section) ? section : null;
  } else {
    ui.panel = ui.panel === name ? null : name;
    ui.settingsView = null;
    ui.eqFromSettings = false;
  }
  renderPanel();
  if (ui.settingsView) $('.set-back', els.panel)?.focus({ preventScroll: true });
}

function setSettingsView(id) {
  const from = ui.settingsView;
  if (id === 'eq') { openPanel('settings', 'eq'); return; }
  if (id) ui.settingsListScroll = $('.panel-body', els.panel)?.scrollTop || 0;
  ui.settingsView = id;
  renderPanel(true);
  if (id) $('.set-back', els.panel)?.focus({ preventScroll: true });
  else {
    $('.panel-body', els.panel).scrollTop = ui.settingsListScroll || 0;
    $(`[data-cat="${from}"]`, els.panel)?.focus({ preventScroll: true });
  }
}
app.openPanel = openPanel;

// buscador de perfiles AutoEQ en Ajustes
let hpResults = [], hpTimer = 0, hpSeq = 0;
async function searchHp(q) {
  const box = $('#hp-results');
  if (!box) return;
  const seq = ++hpSeq;
  if (q.trim().length < 2) { box.innerHTML = ''; hpResults = []; return; }
  box.innerHTML = '<p class="hint">Buscando…</p>';
  try {
    const list = await searchHeadphones(q, 8);
    if (seq !== hpSeq) return;
    hpResults = list;
    box.innerHTML = list.length
      ? list.map((h, i) => `<button class="hp-item lit" role="option" data-action="hp-pick" data-i="${i}"><span class="row-title">${esc(h.name)}</span>${app.prefs.advanced ? `<span class="row-sub">${esc(h.source)}</span>` : ''}</button>`).join('')
      : '<p class="hint">No encontramos ese modelo. Probá con la marca y el modelo.</p>';
  } catch {
    if (seq === hpSeq) box.innerHTML = '<p class="hint">Sin conexión: no se pudo buscar.</p>';
  }
}

// viewChanged: se entró o salió de una categoría (no se conserva el scroll ni el foco anterior)
function renderPanel(viewChanged = false) {
  const p = els.panel;
  $$('[data-action="panel"]').forEach((b) => b.classList.toggle('on', b.dataset.panel === ui.panel));
  if (!ui.panel) {
    ui.settingsView = null;
    p.classList.remove('open');
    p.setAttribute('aria-hidden', 'true');
    return;
  }
  const scroll = viewChanged ? 0 : $('.panel-body', p)?.scrollTop || 0;
  // al re-pintar se pierde el foco: se devuelve al control equivalente
  const a = !viewChanged && p.contains(document.activeElement) ? document.activeElement : null;
  const key = a && (a.dataset.setting ? `[data-setting="${a.dataset.setting}"]` : a.dataset.action ? `[data-action="${a.dataset.action}"]${a.dataset.v != null ? `[data-v="${a.dataset.v}"]` : ''}${a.dataset.theme ? `[data-theme="${a.dataset.theme}"]` : ''}${a.dataset.cat ? `[data-cat="${a.dataset.cat}"]` : ''}` : a.id ? `#${a.id}` : null);
  p.innerHTML = { eq: () => panelEq(ui.eqFromSettings), queue: panelQueue, settings: () => panelSettings(ui.settingsView) }[ui.panel]();
  $('.panel-body', p).scrollTop = scroll;
  p.dataset.view = ui.panel === 'settings' && ui.settingsView ? 'detail' : '';
  p.setAttribute('aria-label', $('.panel-head h3', p)?.textContent || '');
  p.classList.add('open');
  p.setAttribute('aria-hidden', 'false');
  initRanges(p);
  if (key) $(key, p)?.focus({ preventScroll: true });
  if (ui.panel === 'eq') drawEqCurve();
  if (ui.panel === 'settings' && ui.settingsView === 'salida') fillDevices();
}
app.renderPanel = renderPanel;

async function fillDevices() {
  if (typeof engine.ctx.setSinkId !== 'function' || !navigator.mediaDevices?.enumerateDevices) return;
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput');
  const field = $('#sink-field');
  if (!field || devices.length < 2) return;
  const sel = $('select', field);
  sel.innerHTML = devices.map((d, i) => `<option value="${d.deviceId === 'default' ? '' : esc(d.deviceId)}">${esc(d.label || (d.deviceId === 'default' ? 'Predeterminada del sistema' : `Salida ${i + 1}`))}</option>`).join('');
  sel.value = engine.settings.sinkId || '';
  field.hidden = false;
}

function drawEqCurve() {
  const cv = $('#eq-curve');
  if (!cv) return;
  const dpr = window.devicePixelRatio || 1;
  const r = cv.getBoundingClientRect();
  cv.width = Math.round(r.width * dpr);
  cv.height = Math.round(r.height * dpr);
  const W = cv.width, H = cv.height, cx = cv.getContext('2d');
  const N = 220;
  const freqs = new Float32Array(N).map((_, i) => 20 * Math.pow(1000, i / (N - 1)));
  const mag = new Float32Array(N), ph = new Float32Array(N), total = new Float32Array(N);
  const s = engine.settings;
  eqPreview.forEach((f, i) => {
    f.gain.value = s.eqOn ? s.eq[i] : 0;
    f.getFrequencyResponse(freqs, mag, ph);
    for (let k = 0; k < N; k++) total[k] += 20 * Math.log10(mag[k]);
  });
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--accent').trim(), text = css.getPropertyValue('--text').trim();
  const y = (v) => H / 2 - (v / 15) * (H / 2 - 6 * dpr);
  cx.clearRect(0, 0, W, H);
  cx.globalAlpha = 0.14; cx.strokeStyle = text; cx.lineWidth = dpr;
  for (const f of [100, 1000, 10000]) {
    const x = (Math.log10(f / 20) / 3) * W;
    cx.beginPath(); cx.moveTo(x, 0); cx.lineTo(x, H); cx.stroke();
  }
  cx.beginPath(); cx.moveTo(0, H / 2); cx.lineTo(W, H / 2); cx.stroke();
  cx.globalAlpha = 1;
  cx.beginPath();
  for (let k = 0; k < N; k++) { const px = (k / (N - 1)) * W; if (k) cx.lineTo(px, y(total[k])); else cx.moveTo(px, y(total[k])); }
  cx.strokeStyle = accent; cx.lineWidth = 2.2 * dpr; cx.lineJoin = 'round'; cx.stroke();
  cx.lineTo(W, H / 2); cx.lineTo(0, H / 2); cx.closePath();
  const g = cx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, accent); g.addColorStop(0.5, 'transparent'); g.addColorStop(1, accent);
  cx.globalAlpha = 0.22; cx.fillStyle = g; cx.fill(); cx.globalAlpha = 1;
}

function setEqBand(i, v) {
  const eq = engine.settings.eq.slice();
  eq[i] = v;
  engine.setSettings({ eq });
  const label = $(`#eqv-${i}`);
  if (label) label.textContent = `${v > 0 ? '+' : ''}${v}`;
  drawEqCurve();
  $$('.chip.on', els.panel).forEach((c) => c.classList.remove('on'));
  saveSettings();
}

function fill(range) {
  const min = +range.min, max = +range.max;
  range.style.setProperty('--fill', `${((+range.value - min) / (max - min)) * 100}%`);
}
function initRanges(root) { $$('input[type=range]', root).forEach(fill); }

// ---------- importación y avisos ----------

async function importFiles(files) {
  const list = [...files];
  if (!list.length) return;
  if (!app.user) { toast('Para subir música tenés que iniciar sesión'); return; }
  // que el navegador no borre la música cuando falta espacio (si lo niega, igual se importa)
  navigator.storage?.persist?.().catch(() => {});
  try {
    const { usage = 0, quota = 0 } = (await navigator.storage?.estimate?.()) || {};
    const size = list.reduce((s, f) => s + f.size, 0);
    if (quota && usage + size > quota * 0.9) { toast('No hay espacio suficiente en este equipo para esos archivos'); return; }
  } catch { /* sin estimación: se intenta igual */ }
  toast(`Leyendo ${list.length} archivo${list.length > 1 ? 's' : ''}…`);
  const added = await library.import(list);
  if (library.skipped.length) toast(`${library.skipped.length} archivo${library.skipped.length > 1 ? 's superan' : ' supera'} los 500 MB y no se agreg${library.skipped.length > 1 ? 'aron' : 'ó'}`);
  else toast(added.length ? `${added.length} canci${added.length > 1 ? 'ones agregadas' : 'ón agregada'}` : 'No se encontraron archivos de audio nuevos');
  if (added.length && !(await db.kvGet('privateNotice'))) {
    db.kvSet('privateNotice', true);
    setTimeout(() => toast('Tu música subida es privada: sólo la escuchás vos en esta cuenta.'), 2600);
  }
}

async function filesFromDrop(dt) {
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...dt.files];
  const out = [];
  const walk = async (entry) => {
    if (entry.isFile) out.push(await new Promise((res, rej) => entry.file(res, rej)));
    else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const c of batch) await walk(c);
      } while (batch.length);
    }
  };
  for (const e of entries) await walk(e);
  return out;
}

let toastTimer = 0;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.remove('show');
  void els.toast.offsetWidth;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 3200);
}
app.toast = toast;

let importing = null, buffering = false;
function setStatus() {
  const n = library.pendingCount;
  els.status.innerHTML = importing
    ? `<span class="pulse"></span>Importando ${importing.done}/${importing.total}`
    : buffering ? '<span class="pulse"></span>Cargando…'
      : n && app.prefs.advanced ? `<span class="pulse"></span>Analizando sonoridad · ${n}` : '';
}

app.shareToFeed = (t) => {
  if (!app.artist.verified || app.profile?.role !== 'artist') { toast('Sólo los artistas verificados pueden publicar en el feed.'); return; }
  app.catalog.remember(t);
  if (ui.view !== 'feed') go('feed');
  setTimeout(() => {
    const form = $('[data-form=post]');
    if (!form) return;
    if (player.current?.id === t.id && form.attach) { form.attach.checked = true; form.attach.dispatchEvent(new Event('change')); }
    form.text.value = `Escuchando “${t.title}” de ${t.artist || 'artista desconocido'}`;
    form.text.dispatchEvent(new Event('input'));
    form.text.focus();
  }, 450);
};

// ---------- Media Session ----------

// acciones, estado y posición viven en la sesión de reproducción (playback-session.js)
function setupMediaSession() {
  if ('mediaSession' in navigator) playback.attachMediaSession(navigator.mediaSession);
}

function updateMediaSession(t) {
  if (!('mediaSession' in navigator)) return;
  if (!t) { navigator.mediaSession.metadata = null; return; }
  const url = library.coverUrl(t);
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.title, artist: t.artist, album: t.album || '',
    artwork: url ? [{ src: url, sizes: '512x512', type: t.coverBlob?.type || 'image/jpeg' }] : [],
  });
}

// ---------- bucle de animación ----------

const currentPos = () => (engine.current ? engine.position : player.resumeAt);
const bins = new Uint8Array(engine.analyser.frequencyBinCount);
let lastSec = -1, lastTech = 0, energy = 0, lastEnergy = -1, lastScroll = 0;
// cualquier desplazamiento (en cualquier contenedor) pausa el pulso del fondo mientras dura
// y también la deriva de las manchas (#bg.calm): así el compositor no redibuja el fondo entero en cada fotograma del scroll
let calmT = 0;
document.addEventListener('scroll', () => {
  lastScroll = performance.now();
  // mientras se desplaza: sin hover (tarjetas que se elevan, brillos, sonidos) ni animaciones decorativas
  if (!calmT) { els.bg.classList.add('calm'); document.documentElement.classList.add('scrolling'); } else clearTimeout(calmT);
  calmT = setTimeout(() => { calmT = 0; els.bg.classList.remove('calm'); document.documentElement.classList.remove('scrolling'); }, 250);
}, { capture: true, passive: true });

function frame(ts) {
  if (document.hidden) { requestAnimationFrame(frame); return; }
  const pos = currentPos();
  const dur = engine.duration || player.current?.duration || 0;
  dockScrub.set(pos, dur);
  if (ui.npOpen) npScrub.set(pos, dur);
  const sec = Math.floor(pos);
  if (sec !== lastSec) {
    lastSec = sec;
    if (!ui.npOpen && !els.island.classList.contains('open')) updateMiniProgress($('#island-np'), pos, dur, !!player.current?.live);
    $$('.js-pos').forEach((e) => { e.textContent = fmtTime(pos); });
    $$('.js-dur').forEach((e) => {
      const remaining = ui.remaining && e.classList.contains('np-dur');
      e.textContent = engine.live ? '' : !dur ? '—' : remaining ? `−${fmtTime(Math.max(0, dur - pos))}` : fmtTime(dur);
    });
    if ('mediaSession' in navigator && dur && engine.current && !engine.live) {
      try { navigator.mediaSession.setPositionState({ duration: dur, position: Math.min(pos, dur), playbackRate: 1 }); } catch { /* ignorado */ }
    }
  }
  if (ui.npOpen && ui.npTab === 'now' && app.prefs.advanced && ts - lastTech > 120) { lastTech = ts; renderTech(); }
  if (ui.npOpen && ui.npTab === 'lyrics') syncLyrics();
  // El pulso del fondo sólo se ve con "Ahora suena" abierto; en el resto de las vistas el fondo queda detrás de
  // superficies de vidrio y moverlo obliga a re-desenfocarlas en cada fotograma (lo que hacía lento el scroll).
  if (app.prefs.motion !== false && !systemReducedMotion.matches && (ui.npOpen || lastEnergy !== 0)) {
    let target = 0;
    if (engine.playing && ui.npOpen && ts - lastScroll > 160) {
      engine.analyser.getByteFrequencyData(bins);
      let sum = 0;
      for (let i = 2; i < 24; i++) sum += bins[i];
      target = Math.max(0, sum / 22 / 255 - 0.35) / 0.65;
    }
    energy += (target - energy) * (target > energy ? 0.25 : 0.06);
    // sólo se toca el estilo cuando el cambio es visible (en reposo no hay trabajo por fotograma)
    if (Math.abs(energy - lastEnergy) > 0.004) { lastEnergy = energy; els.bg.style.setProperty('--energy', energy.toFixed(3)); }
  }
  requestAnimationFrame(frame);
}

// ---------- acciones ----------

function setVolume(v) {
  engine.setSettings({ volume: Math.min(1, Math.max(0, v)), muted: false });
  syncVolume();
  saveSettings();
}

app.playGroup = (tracks, shuffle) => {
  if (!tracks?.length) return;
  player.shuffle = shuffle;
  player.playList(tracks, shuffle ? Math.floor(Math.random() * tracks.length) : 0);
  saveSettings();
};

Object.assign(app.actions, {
  nav: (el) => {
    if (el.dataset.tab) { ui.exploreTab = el.dataset.tab; ui.exploreChip = ''; }
    ui.back = [];
    if (ui.view === el.dataset.view && el.dataset.tab) { render(); return; }
    go(el.dataset.view);
  },
  back: () => {
    const [v, p, top = 0] = ui.back.pop() || ['home', null, 0];
    ui.view = v; ui.param = p;
    // se vuelve a la posición en la que estabas (y se reintenta si el contenido carga después)
    transition(() => { render(); els.view.scrollTop = top; });
    if (top) setTimeout(() => { if (els.view.scrollTop < top - 4) els.view.scrollTop = top; }, 700);
  },
  play: (el) => {
    const entry = ui.lists[+el.dataset.list];
    if (entry) player.playList(entry.tracks, +el.dataset.index);
  },
  album: (el) => go('album', el.dataset.key),
  artist: (el) => go('artist', el.dataset.name),
  'play-album': (el, e) => { e?.stopPropagation(); app.playGroup(library.derive().albumMap.get(el.dataset.key)?.tracks, false); },
  'shuffle-album': (el) => app.playGroup(library.derive().albumMap.get(el.dataset.key)?.tracks, true),
  'play-artist': (el) => app.playGroup(library.derive().artistMap.get(el.dataset.name)?.tracks, false),
  'shuffle-artist': (el) => app.playGroup(library.derive().artistMap.get(el.dataset.name)?.tracks, true),
  'play-all': () => app.playGroup(library.tracks, false),
  'shuffle-all': () => app.playGroup(library.tracks, true),
  toggle: () => playback.dispatch('toggle'),
  'floating-player': (el) => {
    islandWheel?.reset();
    floating.open().then((child) => {
      if (child || !el?.isConnected) return;
      const r = el.getBoundingClientRect();
      openMenu(r.right - 220, r.bottom + 6, [{
        label: 'Abrir ventana normal', icon: 'expand', run: () => floating.open({ normal: true }),
      }]);
    }).catch(() => toast('No se pudo abrir la ventana flotante.'));
  },
  next: () => playback.dispatch('next'),
  prev: () => playback.dispatch('prev'),
  shuffle: () => { player.setShuffle(!player.shuffle); saveSettings(); },
  repeat: () => { player.cycleRepeat(); saveSettings(); },
  mute: () => { engine.setSettings({ muted: !engine.settings.muted }); syncVolume(); saveSettings(); },
  'like-current': () => { const t = player.current; if (t) app.actions.like({ dataset: { id: t.id } }); },
  'open-np': () => setNp(true),
  'player-view': ({ dataset }) => { setNp(true); setNpTab(dataset.tab || 'now'); },
  'retry-playback': () => playback.dispatch('retry'),
  'np-tab': (el) => setNpTab(el.dataset.tab),
  'np-artist': (el) => {
    const { artistId } = trackCredits(player.current, releases, app.isAvailable);
    if (artistId && artistId === el.dataset.id) go('artistpage', artistId);
    else { syncArtist(player.current); if (ui.npTab === 'credits') renderNpPane(); }
  },
  'toggle-remaining': () => { ui.remaining = !ui.remaining; lastSec = -1; },
  'np-more': (el) => {
    const t = player.current;
    if (!t) return;
    const r = el.getBoundingClientRect();
    lib.trackMenu(r.right - 240, r.bottom + 6, t, {}, -1);
  },
  'sleep-menu': (el) => {
    const r = el.getBoundingClientRect();
    const on = sleepTimer.until || sleepTimer.endOfTrack;
    openMenu(r.right - 240, r.bottom + 6, [
      ...[15, 30, 45, 60].map((m) => ({ label: `En ${m} minutos`, icon: 'clock', run: () => setSleep(m) })),
      { label: 'Al terminar la canción', icon: 'music', run: () => setSleep(-1) },
      ...(on ? ['-', { label: 'Desactivar temporizador', icon: 'close', run: () => setSleep(0) }] : []),
    ]);
  },
  'player-open': () => (window.innerWidth <= 720 || matchMedia('(pointer: coarse)').matches ? setNp(true) : setPlayer(true, true)),
  'player-close': () => setPlayer(false, true),
  'close-np': () => setNp(false),
  panel: (el) => openPanel(el.dataset.panel),
  'close-panel': () => { ui.panel = null; renderPanel(); },
  'eq-preset': (el) => { engine.setSettings({ eq: EQ_PRESETS[el.dataset.name].slice(), eqOn: true }); renderPanel(); saveSettings(); },
  'settings-cat': (el) => setSettingsView(el.dataset.cat),
  'settings-back': () => (ui.panel === 'eq' ? (ui.panel = 'settings', ui.eqFromSettings = false, ui.settingsView = 'eq', setSettingsView(null)) : setSettingsView(null)),
  'settings-open': (el) => openPanel('settings', el.dataset.cat),
  'set-output': (el) => {
    engine.setSettings({ output: el.dataset.v });
    if (el.dataset.v !== 'stereo' && engine.outChannels === 2) toast('Tu dispositivo no admite esa cantidad de canales');
    renderPanel();
    saveSettings();
  },
  'hp-pick': async (el) => {
    const entry = hpResults[+el.dataset.i];
    if (!entry) return;
    el.disabled = true;
    try {
      const profile = await loadHeadphoneProfile(entry);
      engine.setSettings({ headphoneEq: profile, headphoneEqOn: true });
      saveSettings();
      renderPanel();
      toast(`Corrección activa: ${profile.name}`);
    } catch (err) {
      el.disabled = false;
      toast(err.message || 'No se pudo cargar el perfil');
    }
  },
  'hp-clear': () => { engine.setSettings({ headphoneEq: null }); saveSettings(); renderPanel(); },
  'set-spatial': (el) => { engine.setSettings({ spatial: el.dataset.v }); syncSpatialBtn(); renderPanel(); saveSettings(); },
  'cycle-spatial': () => {
    const next = { off: 'spatial', spatial: 'wide', wide: 'off' }[engine.settings.spatial];
    engine.setSettings({ spatial: next });
    syncSpatialBtn();
    if (ui.panel === 'settings') renderPanel();
    toast(`Audio espacial: ${{ off: 'apagado', wide: 'amplio (parlantes)', spatial: 'espacial (auriculares)' }[next]}`);
    saveSettings();
  },
  'queue-play': (el) => player.playAt(+el.dataset.pos),
  'queue-clear': () => {
    player.queue = player.current ? [player.current] : [];
    player.order = player.queue.map((_, i) => i);
    player.pos = player.queue.length ? 0 : -1;
    player.syncNext();
    syncPlayer();
  },
  'import-files': () => $('#pick-files').click(),
  'import-folder': () => $('#pick-folder').click(),
  'set-mode': async (el) => {
    if (!app.profile) return;
    app.profile.mode = el.dataset.v || 'light';
    await saveProfile(auth, app.profile);
    app.applyUserTheme();
    renderPanel();
  },
  'set-theme': async (el) => {
    if (!app.profile) return;
    app.profile.theme = el.dataset.theme;
    app.profile.accent = null;
    await saveProfile(auth, app.profile);
    app.applyUserTheme();
    renderPanel();
  },
  'sign-out': async () => {
    if (!(await confirmModal({ title: '¿Cerrar sesión?', text: 'Tu música queda en este equipo. Tus playlists y tu perfil te esperan cuando vuelvas.', ok: 'Cerrar sesión' }))) return;
    await stats.flush();
    await auth.signOut();
  },
  'clear-library': async () => {
    if (await confirmModal({ title: '¿Vaciar la biblioteca?', text: 'Se quitan todas tus canciones locales de ZUENA (y de las playlists). Tus archivos originales no se tocan.', ok: 'Vaciar', danger: true })) {
      await library.clear();
      toast('Biblioteca vacía');
    }
  },
});

app.forms.claim = submitClaim;
app.forms.release = submitRelease;
app.forms.post = async (form) => {
  if (!(await submitPost(form))) return;
  // la vista del feed es `.fx` (antes `.feed`): re-dibujar limpia el texto y pone lo propio arriba
  if (ui.view === 'feed' || ui.view === 'post') render();
  else { form.reset(); form.text?.dispatchEvent(new Event('input')); }
};

// ---------- eventos ----------

let playedSec = 0, prevTrack = null;

function bindEvents() {
  bindIsland();
  player.addEventListener('error', () => toast('Tocá Reproducir para continuar.'));
  releases.addEventListener('change', () => {
    syncArtist(player.current);
    if (ui.npTab === 'credits') renderNpPane();
  });
  player.addEventListener('change', syncPlayer);
  engine.addEventListener('state', (e) => {
    syncPlayState();
    // al empezar a sonar se despliega el reproductor, salvo que el usuario lo haya retraído
    if (e.detail.playing && !ui.playerClosedByUser) setPlayer(true);
  });
  engine.addEventListener('buffering', (e) => { buffering = e.detail.on; setStatus(); });
  engine.addEventListener('trackchange', (e) => {
    if (e.detail.auto && sleepTimer.endOfTrack) { engine.pause(); sleepTimer = { until: 0, endOfTrack: false, fading: false }; $$('.js-sleep').forEach((b) => b.classList.remove('on')); }
    if (ui.npTab === 'queue') renderNpPane();
    // saltear antes de 15 s cuenta como señal negativa para las recomendaciones
    if (prevTrack && !e.detail.auto && playedSec < 15 && prevTrack.id !== e.detail.track.id && !prevTrack.live) taste.signal(prevTrack, 'skip');
    prevTrack = e.detail.track;
    playedSec = 0;
    const tr = e.detail.track;
    // La cápsula ya informa la pista: evitar otra actividad que desplace sus hitboxes al pulsar Play.
    catalog.remember(e.detail.track);
    stats.restart();
  });
  engine.addEventListener('error', (e) => { if (e.detail.track?.id === player.current?.id && !ui.npOpen && !els.island.classList.contains('open')) toast('No se pudo reproducir esta pista. Abrí el reproductor para reintentar.'); });
  library.addEventListener('change', () => {
    if (ui.view !== 'release') render();
    setStatus();
    if (ui.panel === 'settings') renderPanel();
  });
  library.addEventListener('progress', (e) => {
    const d = e.detail;
    importing = d.done < d.total ? d : null;
    setStatus();
    if (importing) islandLive.show({ id: 'import', kind: 'import', icon: 'musicPlus', cap: 'Agregando música', title: `${d.done} de ${d.total}`, progress: d.done / d.total, sticky: true });
    else islandLive.end('import');
  });
  library.addEventListener('analysis', setStatus);
  library.addEventListener('analyzed', (e) => {
    const t = e.detail.track;
    engine.refreshGains(t.id);
    if (t === player.current) { dockScrub.setWave(t.analysis?.waveform); npScrub.setWave(t.analysis?.waveform); }
    $$(`.row[data-id="${CSS.escape(t.id)}"] .row-dur`).forEach((el) => { el.textContent = t.duration ? fmtTime(t.duration) : '—'; });
    if (t.hidden && ui.view === 'release') render();
  });
  library.addEventListener('removed', (e) => {
    const ids = e.detail.ids || [e.detail.id];
    player.removeTracks(ids);
    // pistas de lanzamientos retirados: las playlists conservan el id (se ven como no disponibles)
    playlists.prune(ids.filter((id) => !String(id).startsWith('rel:')));
  });
  playlists.addEventListener('change', () => {
    renderIsland();
    refreshLikes();
    if (['playlist', 'playlists', 'profile'].includes(ui.view) && !ui.query) render();
  });
  // feed e hilo: contadores y aviso de nuevas en su lugar (sin re-dibujar mientras se lee o se escribe)
  posts.addEventListener('change', (e) => {
    islandPosts();
    if (els.island.classList.contains('open') && !$('#search').value.trim()) refreshIslandPosts(els.island);
    if (ui.query) return;
    if (ui.view === 'feed' || ui.view === 'post') { feedLive(els.view); return; }
    if (ui.view === 'profile' && !e.detail?.sim && !document.activeElement?.closest?.('[data-form=post]')) render();
  });
  app.subs.addEventListener('change', () => {
    if (els.island.classList.contains('open')) searchIsland();
    if (ui.view === 'feed' || ui.view === 'post') render();
  });
  artist.addEventListener('change', () => { if (ui.panel === 'settings') renderPanel(); });
  app.renderSidebar = renderIsland;
  auth.addEventListener('recovery', openPasswordRecovery); // enlace de recuperación (nube)
  auth.addEventListener('change', async () => {
    if (!booted || (auth.user && auth.user.uid === app.user?.uid)) return;
    ui.accountLoading = true;
    app.user = null; app.profile = null;
    els.view.innerHTML = '<div class="loading-view" role="status">Cargando tu cuenta…</div>';
    if (ui.npOpen) setNp(false);
    ++islandSearchToken; clearTimeout(islandSearchTimer); islandSearchResult = null;
    $('#search').value = '';
    closeIsland();
    player.clear();
    if (auth.user) {
      if (!await onUser()) return;
      ui.view = 'home';
      ui.back = [];
      render();
      onboarding();
      return;
    }
    app.user = null;
    app.profile = null;
    ui.panel = null;
    renderPanel();
    library.setOwner(null);
    await userLoads.catch(() => {});
    if (auth.user) return;
    await Promise.all([playlists.load(null), artist.load(null), stats.load(null), taste.load(null)]);
    if (auth.user) return;
    ui.accountLoading = false;
    renderIsland();
    els.view.innerHTML = '';
    if (!auth.user) await showWelcome({ mode: 'signin' });
    while (!auth.user) await openAuth({ mode: 'signin', required: true });
  });

  // ticks de estadísticas, señales de gusto y guardado de sesión
  setInterval(() => {
    if (document.hidden && 'mediaSession' in navigator) {
      const { duration, position, live } = playback.snapshot();
      if (duration > 0 && Number.isFinite(duration) && !live) {
        try { navigator.mediaSession.setPositionState({ duration, position: Math.max(0, Math.min(position, duration)), playbackRate: 1 }); } catch { /* acción opcional */ }
      }
    }
    const t = engine.current;
    if (!engine.playing || !t) return;
    stats.tick(t, 1);
    checkSleep();
    playedSec++;
    if (playedSec === 30 && !t.live) taste.signal(t, 'play');
  }, 1000);
  setInterval(() => { stats.flush(); if (engine.playing) saveSettings(); }, 10000);
  const persist = () => { stats.flush(); db.kvSet('settings', deviceState()); };
  addEventListener('pagehide', persist);
  document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled || el.closest('fieldset[disabled]')) return;
    if (!auth.checkGuest() || ui.accountLoading) { e.preventDefault(); return; }
    if (e.detail > 0 && el.matches('button') && !el.closest('#np, #dock, #island-np')) el.blur();
    const fn = app.actions[el.dataset.action];
    if (fn) fn(el, e);
  });

  document.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    if (!auth.checkGuest() || ui.accountLoading) return;
    app.forms[form.dataset.form]?.(form, e);
  });

  document.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.row[data-id], .card[data-id][data-list]');
    if (!row) return;
    e.preventDefault();
    const entry = ui.lists[+row.dataset.list];
    const t = entry?.tracks[+row.dataset.index] || app.resolve(row.dataset.id);
    if (t) lib.trackMenu(e.clientX, e.clientY, t, entry?.ctx || {}, +row.dataset.index);
  });

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.matches('.js-vol')) setVolume(+el.value);
    else if (el.dataset.eq != null) { setEqBand(+el.dataset.eq, +el.value); fill(el); }
    else if (el.dataset.setting === 'crossfade') {
      engine.setSettings({ crossfade: +el.value });
      $('#xf-val').textContent = +el.value ? `${el.value} s` : 'Sin cortes';
      fill(el);
      saveSettings();
    } else if (el.id === 'hp-search') {
      clearTimeout(hpTimer);
      hpTimer = setTimeout(() => searchHp(el.value), 220);
    } else if (el.id === 'search') {
      searchIsland();
    }
  });

  document.addEventListener('dblclick', (e) => {
    const el = e.target.closest('[data-eq]');
    if (!el) return;
    el.value = 0;
    fill(el);
    setEqBand(+el.dataset.eq, 0);
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    const key = el.dataset.setting;
    if (el.id === 'pick-files' || el.id === 'pick-folder') { importFiles(el.files); el.value = ''; return; }
    if (el.dataset.actionChange === 'region') {
      taste.data.region = el.value;
      taste.save();
      if (ui.view === 'home' || ui.view === 'explore') render();
      return;
    }
    if (!key || key === 'crossfade') return;
    if (key === 'uiSounds') {
      app.prefs.uiSounds = el.checked;
      savePrefs();
      sounds.set(el.checked);
      if (el.checked) sounds.toggle(true);
      return;
    }
    if (key === 'motion' || key === 'dev' || key === 'advanced') {
      app.prefs[key] = el.checked;
      savePrefs();
      applyMotion();
      applyAdvanced();
      setStatus();
      renderPanel();
      if (key === 'advanced' && ui.npOpen) renderTech();
      return;
    }
    if (key === 'sinkId') {
      engine.setSink(el.value).then((ok) => ok && saveSettings()).catch(() => toast('No se pudo cambiar la salida de audio'));
      return;
    }
    const value = el.type === 'checkbox' ? el.checked : key === 'target' ? +el.value : el.value;
    engine.setSettings({ [key]: value });
    if (key === 'eqOn') { $('.eq-sliders')?.classList.toggle('off', !value); drawEqCurve(); }
    if (key === 'normalize') renderPanel();
    saveSettings();
  });

  document.addEventListener('keydown', (e) => {
    if (!auth.checkGuest() || ui.accountLoading) { if (e.key !== 'Tab') e.preventDefault(); return; }
    if (els.island.classList.contains('open')) {
      const panel = els.island.querySelector('.island-panel');
      if (['ArrowDown', 'ArrowUp'].includes(e.key) && (e.target.id === 'search' || e.target.closest('.us-result'))) {
        const results = [...panel.querySelectorAll('.us-result')];
        const index = results.indexOf(e.target);
        const next = index < 0 ? 0 : index + (e.key === 'ArrowDown' ? 1 : -1);
        if (results.length) { e.preventDefault(); (next < 0 ? $('#search') : results[Math.min(next, results.length - 1)]).focus(); }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if ($('#search').value) { $('#search').value = ''; searchIsland(); }
        else { closeIsland(); $('[data-island-core]')?.focus(); }
        return;
      }
      if (e.key === 'Tab') {
        const items = [...panel.querySelectorAll('button:not([disabled]), input:not([disabled]), a[href], select')].filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
        const first = items[0], last = items.at(-1);
        if (e.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { e.preventDefault(); first?.focus(); }
        return;
      }
    }
    if (e.target.matches?.('input[type=range]') && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    if (e.target.matches?.('.np-tab') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
      const tabs = $$('.np-tab', els.np);
      const i = tabs.indexOf(e.target);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
      e.preventDefault();
      setNpTab(tabs[next].dataset.tab);
      tabs[next].focus();
      return;
    }
    if (e.key === ' ' && e.target.closest?.('button')) return;
    // Enter / Espacio activan filas y tarjetas igual que un clic
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[role=button][data-action]:not(button)')) {
      e.preventDefault();
      e.target.click();
      return;
    }
    if (document.body.classList.contains('modal-open')) {
      if (e.key === 'Escape') { e.preventDefault(); closeTopModal(); }
      return;
    }
    // dentro del menú contextual o de la isla, las flechas navegan (no son atajos globales)
    if (e.target.closest?.('.menu, .island-panel') && !e.target.matches?.('input, textarea, select')) {
      if (e.target.closest('.island-panel') && e.key.startsWith('Arrow')) {
        const items = [...els.island.querySelectorAll('.island-panel button')];
        const i = items.indexOf(e.target);
        const step = { ArrowRight: 1, ArrowDown: e.target.closest('.island-grid') ? 4 : 1, ArrowLeft: -1, ArrowUp: e.target.closest('.island-grid') ? -4 : -1 }[e.key];
        items[Math.max(0, Math.min(items.length - 1, i + step))]?.focus();
        e.preventDefault();
      } else if (e.key === 'Escape' && els.island.classList.contains('open')) { closeIsland(); $('[data-island-core]')?.focus(); }
      return;
    }
    if (e.target.matches?.('input:not([type=range]):not([type=checkbox]), select, textarea')) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const actions = {
      ' ': () => playback.dispatch('toggle'),
      ArrowRight: () => (e.shiftKey ? player.next() : player.seek(currentPos() + 5)),
      ArrowLeft: () => (e.shiftKey ? player.prev() : player.seek(Math.max(0, currentPos() - 5))),
      ArrowUp: () => setVolume(engine.settings.volume + 0.05),
      ArrowDown: () => setVolume(engine.settings.volume - 0.05),
      m: () => app.actions.mute(),
      s: () => app.actions.shuffle(),
      r: () => app.actions.repeat(),
      l: () => app.actions['like-current'](),
      f: () => setNp(!ui.npOpen),
      e: () => openPanel('eq'),
      q: () => openPanel('queue'),
      a: () => app.actions['cycle-spatial'](),
      n: () => (els.island.classList.contains('open') ? closeIsland() : openIsland(true)),
      '/': () => openIsland(true),
      Escape: () => { closeMenu(); if (els.island.classList.contains('open')) closeIsland(); else if (ui.panel === 'settings' && ui.settingsView) setSettingsView(null); else if (ui.panel) { ui.panel = null; renderPanel(); } else if (ui.npOpen) setNp(false); },
    };
    if (e.target.matches?.('input[type=range]') && k.startsWith('Arrow')) return;
    if (actions[k]) { e.preventDefault(); actions[k](); }
  });

  // brillo que sigue al cursor: como mucho una actualización por fotograma, y nunca sobre el
  // panel principal (repintarlo entero en cada movimiento era lo que trababa el mouse)
  let pm = null, pmQueued = false;
  document.addEventListener('pointermove', (e) => {
    // con el dedo no hay hover: el brillo no se ve y sólo costaba estilo en cada arrastre
    if (e.pointerType === 'touch') return;
    pm = e;
    if (pmQueued) return;
    pmQueued = true;
    requestAnimationFrame(() => {
      pmQueued = false;
      const ev = pm;
      const lit = ev.target.closest?.('.lit');
      if (lit) {
        const r = lit.getBoundingClientRect();
        lit.style.setProperty('--mx', `${ev.clientX - r.left}px`);
        lit.style.setProperty('--my', `${ev.clientY - r.top}px`);
      }
      // luz de vidrio (motor 0.2): brillo y reflejo de borde que siguen al puntero sobre las superficies
      // (sin .fx-main: es la columna entera del feed; su canto queda con la luz fija de motion.css)
      const surf = ev.target.closest?.(':is(.glass-soft, .fx-card, .hc, .wl-card, .fa-card, .tier, .ap-popular, .zu-empty):not(.lit)');
      if (surf) {
        const r = surf.getBoundingClientRect();
        surf.style.setProperty('--sx', `${Math.round(ev.clientX - r.left)}px`);
        surf.style.setProperty('--sy', `${Math.round(ev.clientY - r.top)}px`);
      }
      const glass = ev.target.closest?.('.glass.spot');
      if (glass) {
        const r = glass.getBoundingClientRect();
        glass.style.setProperty('--gx', `${ev.clientX - r.left}px`);
        glass.style.setProperty('--gy', `${ev.clientY - r.top}px`);
      }
    });
  }, { passive: true });

  // reordenar playlists arrastrando
  let dragFrom = -1;
  document.addEventListener('dragstart', (e) => {
    const row = e.target.closest?.('.tracks[data-playlist] .row');
    if (!row) return;
    dragFrom = +row.dataset.index;
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', row.dataset.id);
  });
  document.addEventListener('dragover', (e) => {
    if (dragFrom < 0) return;
    const row = e.target.closest?.('.tracks[data-playlist] .row');
    if (!row) return;
    e.preventDefault();
    $$('.row.drop-before, .row.drop-after').forEach((r) => r.classList.remove('drop-before', 'drop-after'));
    const r = row.getBoundingClientRect();
    row.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
  });
  document.addEventListener('drop', (e) => {
    if (dragFrom < 0) return;
    const row = e.target.closest?.('.tracks[data-playlist] .row');
    const list = row?.closest('.tracks');
    if (row && list) {
      e.preventDefault();
      e.stopPropagation();
      const pl = playlists.get(list.dataset.playlist);
      const entry = ui.lists[+row.dataset.list];
      const fromId = entry.tracks[dragFrom]?.id;
      let to = +row.dataset.index + (row.classList.contains('drop-after') ? 1 : 0);
      if (to > dragFrom) to--;
      if (pl && fromId) playlists.move(pl.id, pl.trackIds.indexOf(fromId), pl.trackIds.indexOf(entry.tracks[Math.min(to, entry.tracks.length - 1)].id));
    }
  }, true);
  document.addEventListener('dragend', () => {
    dragFrom = -1;
    $$('.row.dragging, .row.drop-before, .row.drop-after').forEach((r) => r.classList.remove('dragging', 'drop-before', 'drop-after'));
  });

  // arrastrar archivos o carpetas
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e) || document.body.classList.contains('modal-open')) return;
    e.preventDefault();
    depth++;
    $('#drop h2').textContent = ui.view === 'release' ? 'Soltá el audio del lanzamiento' : 'Soltá tu música acá';
    els.drop.classList.add('show');
  });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; els.drop.classList.remove('show'); } });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    els.drop.classList.remove('show');
    const toRelease = ui.view === 'release' && !$('[data-form=release] fieldset[disabled]');
    filesFromDrop(e.dataTransfer).then((files) => (toRelease ? addReleaseAudio(files) : importFiles(files)));
  });

  window.addEventListener('resize', () => { if (ui.panel === 'eq') drawEqCurve(); });
}

// acceso para depuración desde la consola
window.zuena = app;
