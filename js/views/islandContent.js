// Descubrimiento de la isla. Sin historial ficticio ni permisos distintos a los del feed.
import { app } from '../app.js';
import { TEST_CATALOG } from '../config.js';
import { TEST_ARTISTS, testReleases } from '../data/testArtists.js';
import { loadArtistPortraits } from '../data/artistPortraits.js';
import { canView } from '../data/subs.js';
import { esc, fmtTime } from '../ui/format.js';
import { icon } from '../ui/icons.js';
import { art, avatar, playlistArt, tick, see } from './common.js';
import { richText, timeAgo } from '../data/posts.js';

const states = new WeakMap();
const TITLES = ['Tu universo', 'Artistas para descubrir', 'Volvé a escucharlas', 'Lo que está por llegar', 'Hechas por vos', 'La voz de tus artistas'];
const SUBS = ['Un lugar para descubrir, escuchar y conectar.', 'Perfiles, música y nuevas perspectivas.', 'Tus últimas escuchas, en su orden original.', 'Próximos estrenos y lo destacado de esta semana.', 'Tu música, a tu manera.', 'Publicaciones de la comunidad, dentro de ZUENA.'];
const image = (url, cls = '') => url && /^(https?:|blob:|data:image\/)/.test(url) ? `<img class="${cls}" src="${esc(url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : '';
const empty = (ic, title, sub) => `<div class="ic-empty">${icon(ic)}<b>${esc(title)}</b><p>${esc(sub)}</p></div>`;
const section = (name, filter, body) => `<section class="ic-section"><header><h3>${name}</h3><button class="ic-text-link lit" data-search-filter="${filter}">Ver todo ${icon('arrowRight')}</button></header>${body}</section>`;
export function islandPostAvailable(id) {
  const post = app.posts.get(id);
  if (!post || !app.posts.visible(post)) return false;
  const root = app.posts.rootOf(post) || post;
  return canView(root, app.subs?.tier(app.user?.uid, root.uid) || 0, { isAuthor: !!app.user && root.uid === app.user.uid });
}
export function refreshIslandPosts(root) {
  if (!root) return;
  for (const card of root.querySelectorAll('.ic-post[data-post]')) {
    if (!islandPostAvailable(card.dataset.post)) card.remove();
  }
  const feed = root.querySelector('.ic-feed');
  if (!feed) return;
  const shown = new Set([...feed.querySelectorAll('[data-post]')].map((p) => p.dataset.post));
  const latest = Math.max(0, ...[...shown].map((id) => app.posts.get(id)?.created || 0));
  const unseen = islandSnapshot(app).posts.some((p) => !shown.has(p.id) && p.created > latest);
  if (unseen && !feed.querySelector('[data-island-refresh]')) feed.insertAdjacentHTML('afterbegin', '<button class="btn-glass lit ic-more" data-island-refresh>Actualizar publicaciones</button>');
}

export function islandSnapshot(context, now = Date.now()) {
  const artists = [...(context.posts?.authors?.values() || [])].filter((p) => p.role === 'artist').map((p) => ({ id: `zu:${p.uid}`, name: p.displayName, avatar: p.avatar, sim: p.sim, verified: !p.sim }));
  if (context.profile?.role === 'artist' && !artists.some((a) => a.id === `zu:${context.profile.uid}`)) artists.unshift({ id: `zu:${context.profile.uid}`, name: context.profile.displayName, avatar: context.profile.avatar, verified: true });
  if (TEST_CATALOG) artists.push(...TEST_ARTISTS.map((a) => ({ id: `am:${a.id}`, name: a.name, appleId: a.id })));
  artists.sort((a, b) => Number(!!a.sim) - Number(!!b.sim));
  const uid = context.user?.uid;
  const recent = uid && (!context.stats?.uid || context.stats.uid === uid) ? [...new Set(context.stats?.data?.recent || [])].map((id) => context.resolve(id)).filter((t) => t && context.isAvailable(t)) : [];
  const playlists = uid ? (context.playlists?.list || []).filter((p) => p.owner === uid || (!p.owner && context.playlists.uid === uid)).sort((a, b) => (b.updated || b.created || 0) - (a.updated || a.created || 0) || String(a.id).localeCompare(String(b.id))) : [];
  const upcoming = context.releases.upcoming(now);
  const week = 7 * 864e5;
  const featured = upcoming.find((r) => r.premiereAt < now + week) || context.releases.live(now).find((r) => (r.published || r.premiereAt || 0) >= now - week && (r.published || r.premiereAt || 0) <= now) || null;
  const posts = [...new Map([...(context.posts?.timeline() || []), ...(context.posts?.catalogFeed() || [])].map((p) => [p.id, p])).values()].filter((p) => {
    if (p.replyTo || p.repostOf || !context.posts.visible(p)) return false;
    const root = context.posts.rootOf(p) || p;
    return canView(root, context.subs?.tier(context.user?.uid, root.uid) || 0, { isAuthor: !!context.user && root.uid === context.user.uid });
  }).sort((a, b) => b.created - a.created);
  return { artists, recent, playlists, upcoming, featured, posts };
}

function artistCard(a, small = false) {
  return `<article class="ic-artist ${small ? 'small' : ''}" ${a.appleId ? `data-portrait-id="${a.appleId}"` : ''}>
    <button class="ic-artist-open lit" data-action="open-artist" data-id="${esc(a.id)}" aria-label="Ver perfil de ${esc(a.name)}">
      <span class="ic-portrait" data-initial="${esc((a.name || '?').charAt(0))}">${image(a.avatar) || `<span class="ic-initial">${esc((a.name || '?').charAt(0))}</span>`}<span class="ic-portrait-glow" aria-hidden="true"></span></span>
      <span class="ic-artist-meta"><b>${esc(a.name)}${tick(a.verified)}</b><small>${a.sim ? 'Perfil simulado' : a.appleId ? 'Catálogo de prueba' : 'Artista de ZUENA'}</small></span>
    </button><span class="ic-photo-credit" data-photo-credit></span>
  </article>`;
}
function recentRow(t) {
  see(t);
  return `<button class="ic-song lit" data-action="search-track" data-id="${esc(t.id)}" aria-label="Reproducir ${esc(t.title)}">${art(t, 'sm')}<span><b>${esc(t.title)}</b><small>${esc(t.artist || 'Tu biblioteca')}</small></span><small class="ic-duration">${fmtTime(t.duration)}</small><span class="ic-play">${icon('play')}</span></button>`;
}
function playlistTile(p) {
  const count = p.trackIds?.length || 0;
  return `<button class="ic-playlist lit" data-action="playlist" data-id="${esc(p.id)}">${playlistArt(p, 'sm')}<span><b>${esc(p.name)}</b><small>${count} ${count === 1 ? 'canción' : 'canciones'}</small></span>${icon('arrowRight')}</button>`;
}
function releaseTile(r, featured = false) {
  const date = r.premiereAt || r.published || Date.parse(r.date);
  const soon = r.status === 'scheduled' && date > Date.now();
  const action = r.collectionId ? 'open-amc' : 'search-release';
  return `<button class="ic-release ${featured ? 'ic-spotlight' : ''} lit" data-action="${action}" data-id="${esc(r.collectionId || r.id)}">
    <span class="ic-release-cover">${image(r.coverThumb || r.artwork) || icon('disc')}</span><span class="ic-release-copy">
    <small class="ic-eyebrow">${featured ? 'El estreno de la semana' : 'Próximo estreno'}</small><b>${esc(r.title)}</b><span>${esc(r.artistName || r.primaryArtist || r.artist || 'Artista de ZUENA')}</span>
    <small>${soon ? 'Estrena ' : featured ? 'Publicado esta semana · ' : ''}${Number.isFinite(date) ? esc(new Date(date).toLocaleDateString('es', { day: 'numeric', month: 'short' })) : ''}</small></span><span class="ic-release-arrow">${icon('arrowRight')}</span></button>`;
}
function miniPost(p) {
  const catalog = p.kind === 'catalog';
  const a = app.posts.author(p.uid) || p.author || {};
  const liked = (p.likes || []).includes(app.user?.uid);
  const exclusive = app.posts.audienceTier(p) > 0;
  return `<article class="ic-post fx-post" data-post="${esc(p.id)}">
    <header><button class="ic-post-author" data-action="open-artist" data-id="${esc(catalog ? p.uid : `zu:${p.uid}`)}">${catalog ? `<span class="ic-post-icon">${icon('disc')}</span>` : avatar(a, 'sm')}<span><b>${esc(a.displayName || 'Artista')}${tick(!catalog && a.role === 'artist' && !p.sim)}</b><small>${catalog ? 'Novedad del catálogo' : p.sim ? 'Publicación simulada' : 'Publicación'} · ${esc(timeAgo(p.created))}</small></span></button></header>
    <div class="ic-post-text">${catalog ? `Nuevo lanzamiento: <b>${esc(p.catalog?.title || '')}</b>` : richText(p.text || '', esc)}</div>
    ${p.catalog?.artwork ? `<button class="ic-post-release lit" data-action="open-amc" data-id="${esc(p.catalog.collectionId)}">${image(p.catalog.artwork)}<span><b>${esc(p.catalog.title)}</b><small>${esc(p.catalog.artist)}</small></span>${icon('arrowRight')}</button>` : ''}
    <footer><button class="pa pa-like ${liked ? 'on' : ''}" data-action="post-like" data-id="${esc(p.id)}" aria-label="Me gusta" aria-pressed="${liked}">${icon(liked ? 'heartFill' : 'heart')}<span data-n="likes">${p.likes?.length || 0}</span></button>
      <button class="pa" data-action="post-open" data-id="${esc(p.id)}" aria-label="Ver publicación y comentarios">${icon('feed')}<span data-n="replies">${app.posts.replyCount(p.id)}</span></button>
      <button class="pa pa-share" data-action="post-share" data-id="${esc(p.id)}" aria-label="Compartir" ${exclusive ? 'disabled title="El contenido exclusivo no se puede compartir"' : ''}>${icon('upload')}</button></footer>
  </article>`;
}

function weekly(data) {
  return data.featured ? releaseTile(data.featured, true) : empty('disc', 'No hay estrenos destacados esta semana.', 'Las nuevas fechas y lanzamientos aparecerán acá.');
}
function renderContent(data, filter, limit) {
  const artists = (n) => `<div class="ic-artists">${data.artists.slice(0, n).map((a) => artistCard(a, filter === 0)).join('')}</div>`;
  const songs = (n) => data.recent.slice(0, n).map(recentRow).join('');
  const lists = (n) => `<div class="ic-playlists">${data.playlists.slice(0, n).map(playlistTile).join('')}</div>`;
  const posts = (n) => `<div class="ic-feed">${data.posts.slice(0, n).map(miniPost).join('')}</div>`;
  let body, count = 0;
  if (filter === 1) { body = data.artists.length ? artists(limit) : empty('user', 'No hay perfiles disponibles.', 'Los perfiles publicados aparecerán acá.'); count = data.artists.length; }
  else if (filter === 2) { body = data.recent.length ? `<div class="ic-songs">${songs(limit)}</div>` : empty('music', app.user ? 'Todavía no tenés canciones recientes disponibles.' : 'Iniciá sesión para ver tus canciones recientes.', 'Escuchá una canción y volvé para encontrarla acá.'); count = data.recent.length; }
  else if (filter === 3) { body = `<div data-weekly-slot>${weekly(data)}</div><h3 class="ic-subheading">En el horizonte</h3>${data.upcoming.length ? data.upcoming.slice(0, limit).map((r) => releaseTile(r)).join('') : empty('clock', 'No hay próximos estrenos disponibles.', 'Cuando un artista anuncie una fecha, la vas a ver acá.')}`; count = data.upcoming.length; }
  else if (filter === 4) { body = data.playlists.length ? lists(limit) : empty('playlist', app.user ? 'Todavía no tenés playlists.' : 'Iniciá sesión para ver tus playlists.', 'Creá una en tu biblioteca y la vas a encontrar acá.'); count = data.playlists.length; }
  else if (filter === 5) { body = data.posts.length ? posts(limit) : empty('feed', 'No hay publicaciones disponibles para vos.', 'Las publicaciones de tus artistas aparecerán acá.'); count = data.posts.length; }
  else body = `<div class="ic-mosaic"><div class="ic-mosaic-wide" data-weekly-slot>${weekly(data)}</div>
      ${section('Descubrí artistas', 1, data.artists.length ? artists(3) : empty('user', 'Nuevas voces, muy pronto', 'Acá vas a descubrir artistas.'))}
      <div class="ic-mosaic-pair"><button class="ic-summary lit" data-search-filter="2">${icon('music')}<small>Tu historia sonora</small><b>Volvé a escuchar</b><span>${data.recent.length} canciones recientes ${icon('arrowRight')}</span></button><button class="ic-summary lit ic-summary-alt" data-search-filter="4">${icon('playlist')}<small>Tu colección</small><b>Tus playlists</b><span>${data.playlists.length} para acompañarte ${icon('arrowRight')}</span></button></div>
      ${data.recent.length ? section('En tu rotación', 2, songs(3)) : ''}
      ${data.playlists.length ? section('A tu manera', 4, lists(2)) : ''}
      ${section('Desde el feed', 5, data.posts.length ? posts(2) : empty('feed', 'La comunidad está por llegar', 'Las publicaciones aparecerán en este espacio.'))}
    </div>`;
  return `<div class="ic-hub"><header class="ic-intro"><p class="ic-eyebrow">${filter === 0 ? 'Hecho para vos' : 'Explorá tu isla'}</p><h2>${TITLES[filter]}</h2><p>${SUBS[filter]}</p></header>${body}${count > limit && limit < 100 ? '<button class="btn-glass lit ic-more" data-island-more>Cargar más</button>' : count > 100 ? '<p class="muted">Mostrando los primeros 100 elementos.</p>' : ''}</div>`;
}

// La navegación entre secciones ya no vive acá: está en la burbuja de perfil (js/ui/profile-menu.js).
export function mountIslandContent(root, filter = 0, { more = false } = {}) {
  if (!root) return;
  const prev = states.get(root);
  const state = { filter, uid: app.user?.uid, limit: more && prev?.filter === filter ? Math.min(100, prev.limit + 20) : 20, token: (prev?.token || 0) + 1 };
  states.set(root, state);
  const data = islandSnapshot(app);
  const focused = root.contains(document.activeElement);
  root.innerHTML = renderContent(data, filter, state.limit);
  if (!more) root.parentElement.scrollTop = 0;
  if (focused) root.querySelector('button')?.focus({ preventScroll: true });
  app.a11y?.(root);
  if (!root.dataset.icBound) {
    root.dataset.icBound = '1';
    root.addEventListener('error', (event) => {
      const portrait = event.target.closest?.('.ic-portrait');
      if (!portrait || event.target.tagName !== 'IMG') return;
      portrait.innerHTML = `<span class="ic-initial">${esc(portrait.dataset.initial)}</span>`;
      const credit = portrait.closest('.ic-artist')?.querySelector('[data-photo-credit]');
      if (credit) credit.textContent = '';
    }, true);
  }
  const current = () => root.isConnected && !root.hidden && root.closest('.island')?.classList.contains('open') && states.get(root) === state && app.user?.uid === state.uid;
  if (filter === 0 || filter === 1) loadArtistPortraits().then((photos) => {
    if (!current()) return;
    for (const [id, photo] of Object.entries(photos)) for (const card of root.querySelectorAll(`[data-portrait-id="${CSS.escape(id)}"]`)) {
      card.querySelector('.ic-portrait').innerHTML = `${image(photo.url)}<span class="ic-portrait-glow" aria-hidden="true"></span>`;
      card.querySelector('[data-photo-credit]').innerHTML = `<a href="${esc(photo.source)}" target="_blank" rel="noopener noreferrer" title="${esc(`${photo.author} · ${photo.license}`)}">Foto: ${esc(photo.author)} · ${esc(photo.license)}</a>`;
    }
  }).catch(() => {});
  if ((filter === 0 || filter === 3) && !data.featured && TEST_CATALOG) testReleases().then((rows) => {
    if (!current()) return;
    const now = Date.now(), week = 7 * 864e5;
    const recent = rows.find((r) => { const at = Date.parse(r.date); return at <= now && at >= now - week; });
    if (recent) root.querySelector('[data-weekly-slot]').innerHTML = releaseTile(recent, true);
  }).catch(() => {});
}
