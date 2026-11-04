// Inicio con recomendaciones, Explorar (música, podcasts, radio), mixes, podcasts, artistas y búsqueda.
import { app, registerActions } from '../app.js';
import { EXTERNAL_CATALOG, TEST_CATALOG, ZUENA_OFFICIAL_UID } from '../config.js';
import { heroCarousel, mountHero } from './homeHero.js';
import { testReleases, testPlaylists, testArtistCards, testSongs, linkArtistNames } from '../data/testArtists.js';
import { icon, logo } from '../ui/icons.js';
import { esc, hueOf } from '../ui/format.js';
import { GENRES, GENRE_BY_ID, TOPICS, REGIONS, genreOf } from '../catalog/genres.js';
import { rank } from '../catalog/recommend.js';
import * as src from '../catalog/sources.js';
import { releaseCard } from './feed.js';
import { topArtistsShelf } from './artistpage.js';
import {
  art, trackList, albumCard, mediaCard, podcastCard, creatorCard, listKey, backBtn,
  skeletonRow, tick, compact, totalTime, see,
} from './common.js';

const mixes = new Map();
const retryLoads = new WeakMap();

const discoveryHead = (title, sub, label) => {
  const upcomingCount = app.releases?.upcoming?.()?.length || 0;
  const displayName = app.profile?.displayName || app.user?.displayName || '';
  return `<header class="discovery-head">
    <div class="discovery-head-main">
      <div class="discovery-head-topline">
        <p class="eyebrow"><span class="discovery-point" aria-hidden="true"></span>${label}</p>
        <span class="dh-telemetry"><i class="dh-pulse" aria-hidden="true"></i>MOTOR 24-BIT LOSSLESS</span>
        ${upcomingCount ? `<button type="button" class="dh-premiere-badge" data-action="discovery-jump" data-section="zu-premieres"><i class="p-live-dot" aria-hidden="true"></i>${upcomingCount} ${upcomingCount === 1 ? 'estreno en cuenta regresiva' : 'estrenos en cuenta regresiva'}</button>` : ''}
      </div>
      <h1 aria-label="${esc(title.replace(/<br\s*\/?>/gi, ' '))}">${title}</h1>
      <p class="discovery-deck">${sub}${displayName ? ` <span class="dh-greeting">· Sesión activa: <b>${esc(displayName)}</b></span>` : ''}</p>
    </div>
    <div class="discovery-head-aside">
      <div class="dh-quick-pills" role="navigation" aria-label="Accesos rápidos de estudio">
        <button type="button" class="dh-pill dh-pill-zuena lit" data-action="open-artist" data-id="zu:${ZUENA_OFFICIAL_UID}">
          <span class="dh-z-logo" aria-hidden="true">${logo()}</span>
          <span><b>Perfil ZUENA</b><small>Equipo oficial · @zuena</small></span>
        </button>
        <button type="button" class="dh-pill lit" data-action="discovery-jump" data-section="zu-premieres">
          ${icon('clock')}
          <span><b>Sala de Estrenos</b><small>${upcomingCount} en cuenta regresiva</small></span>
        </button>
        <button type="button" class="dh-pill lit" data-action="nav" data-view="feed">
          ${icon('feed')}
          <span><b>Comunidad</b><small>Feed de artistas</small></span>
        </button>
      </div>
      <span class="discovery-wordmark" aria-hidden="true">ZUENA</span>
    </div>
  </header>`;
};

const familyNav = () => `<nav class="discovery-families" aria-label="Secciones de Inicio">
  ${[['t-releases', 'Estrenos'], ['t-songs', 'Canciones'], ['t-playlists', 'Playlists'], ['t-artists', 'Artistas'], ['t-feed', 'Feed'], ['t-trends', 'Tendencias']].map(([id, label]) => `<button data-action="discovery-jump" data-section="${id}">${label}${icon('arrowRight')}</button>`).join('')}</nav>`;

const regionOf = () => app.taste.data.region || 'ar';
const regionLabel = () => REGIONS.find((r) => r.id === regionOf())?.label || 'tu país';
const recentIds = () => new Set((app.stats.data?.recent || []).slice(0, 15));

function section(id, title, sub = '', action = '') {
  return `<section class="home-sec" data-sec="${id}" data-reveal="fadeUp">
    <header class="sec-head"><div><h2 class="section-title" tabindex="-1">${title}</h2>${sub ? `<p class="sec-sub">${sub}</p>` : ''}</div>${action}</header>
    <div class="sec-body" aria-busy="true"><span class="discovery-loading" role="status">Cargando…</span>${skeletonRow()}</div>
  </section>`;
}

function shelfOf(items, { feature = false } = {}) {
  const key = listKey(items);
  return `<div class="shelf ${feature ? 'has-feature' : ''}">${items.map((it, i) => mediaCard(it, key, i, feature && i === 0 ? 'feature' : '')).join('')}</div>`;
}

// ranking en podio: los 3 primeros grandes y el resto en dos columnas (una sola cola de reproducción)
function podium(items) {
  const list = trackList(items, { numbered: 'index', album: false });
  const key = app.ui.lists.length - 1;
  const top = items.slice(0, 3).map((t, i) => `<div class="podium-card lit enter" style="--i:${i}" data-action="play" data-list="${key}" data-index="${i}" data-id="${esc(t.id)}">
      <span class="podium-n">${i + 1}</span>${art(t)}
      <div class="podium-meta"><div class="card-title">${esc(t.title)}</div><div class="card-sub">${esc(t.artist || '')}</div></div>
      <span class="card-play as-btn">${icon('play')}</span></div>`).join('');
  return `<div class="podium">${top}</div><div class="chart-rest">${list}</div>`;
}

// radios como cápsulas compactas "en vivo"
function radioPills(items) {
  const key = listKey(items);
  return `<div class="pills">${items.map((it, i) => `<div class="radio-pill lit enter" style="--i:${Math.min(i, 12)}" data-action="play" data-list="${key}" data-index="${i}" data-id="${esc(see(it).id)}">
      ${art(it, 'xs')}<div class="radio-pill-txt"><b>${esc(it.title)}</b><span>${esc(it.artist || '')}</span></div><i class="live-mini" aria-label="En vivo"></i></div>`).join('')}</div>`;
}
// cede el hilo principal: cada sección se arma en su propia tarea. Con los datos en caché, las siete
// secciones del inicio llegaban juntas y sumaban una tarea larga (> 50 ms) de HTML + estilos + maquetado.
const yieldTask = () => (globalThis.scheduler?.postTask
  ? scheduler.postTask(() => {}, { priority: 'user-visible' })
  : new Promise((r) => setTimeout(r, 0)));

// llena una sección cuando llegan los datos (si el usuario sigue en la vista)
async function fill(root, id, loader) {
  const body = root.querySelector(`[data-sec="${id}"] .sec-body`);
  if (!body) return;
  body.setAttribute('aria-busy', 'true');
  if (retryLoads.has(body)) {
    retryLoads.delete(body);
    body.innerHTML = `<span class="discovery-loading" role="status">Cargando…</span>${skeletonRow()}`;
  }
  try {
    const html = await loader();
    await yieldTask();
    if (!body.isConnected) return;
    body.innerHTML = html || `<div class="discovery-empty"><p>${id === 't-feed' ? 'Todavía no hay publicaciones para mostrar.' : id === 't-trends' ? 'Todavía no hay tendencias para mostrar.' : 'No encontramos resultados.'}</p></div>`;
    body.setAttribute('aria-busy', 'false');
    app.afterFill(body);
  } catch (err) {
    console.warn('[inicio]', id, err);
    if (body.isConnected) {
      body.setAttribute('aria-busy', 'false');
      retryLoads.set(body, () => fill(root, id, loader));
      body.innerHTML = '<div class="discovery-empty" role="status"><p>No pudimos cargar este contenido.</p><button class="btn-glass" data-action="discovery-retry">Reintentar</button></div>';
    }
  }
}

// ---------- Inicio ----------

// llamado a artistas: lleva a la presentación de ZUENA para artistas
const artistsCta = () => `<section class="zu-artists-cta lit" data-reveal="scaleIn">
    <div class="zac-glow" aria-hidden="true"></div>
    <div class="zac-copy"><p class="eyebrow">Para artistas</p><h2>Tu música, cerca de quien escucha.</h2>
      <p>Conocé el espacio para publicar tu música y encontrarte con tus oyentes.</p></div>
    <button class="btn-glass lit zac-btn" data-action="nav" data-view="forartists">${icon('play')}Ver la presentación</button>
  </section>`;

export function viewHome() {
  const p = app.profile;
  const taste = app.taste;
  const recentLocal = (app.stats.data?.recent || []).map((id) => app.resolve(id)).filter((t) => t && !t.hidden).slice(0, 6);
  const quick = [
    ...app.playlists.list.filter((x) => x.trackIds.length).slice(0, 3).map((pl) => ({ kind: 'pl', pl })),
    ...recentLocal.map((t) => ({ kind: 't', t })),
  ].slice(0, 6);
  const quickKey = listKey(recentLocal);
  const by = (app.stats.data?.recent || []).map((id) => app.resolve(id)).find((t) => t?.artist);

  app.ui.mount = (root) => {
    mountHero(root, { registerMix: (l) => mixes.set(l.id, l), mixCovers });
    // las entradas al desplazar las hace el motor (data-reveal en cada sección)
    loadHome(root, by);
    if (TEST_CATALOG) loadTestHome(root);
  };

  return `<div class="z-discovery z-home">
    ${discoveryHead('La música<br>que se siente.', 'Volvé a lo que te gusta. Encontrá lo que viene.', 'Inicio · Tu selección')}
    <section class="bento enter">
      ${heroCarousel(p)}
      ${quick.length ? `<aside class="discovery-recent"><p class="eyebrow">A mano · Tu actividad</p><div class="bento-quick">${quick.map((q, i) => q.kind === 'pl'
        ? `<button class="quick-tile lit enter" style="--i:${i + 1}" data-action="playlist" data-id="${esc(q.pl.id)}">${q.pl.system ? '<span class="art likes xs">' + icon('heartFill') + '</span>' : art(q.pl.trackIds.map(app.resolve).find(Boolean), 'xs')}<span>${esc(q.pl.name)}</span></button>`
        : `<button class="quick-tile lit enter" style="--i:${i + 1}" data-action="play" data-list="${quickKey}" data-index="${recentLocal.indexOf(q.t)}" data-id="${esc(q.t.id)}">${art(q.t, 'xs')}<span>${esc(q.t.title)}</span></button>`).join('')}</div></aside>` : ''}
    </section>    ${taste.data.done || !EXTERNAL_CATALOG ? '' : `<div class="glass-soft notice lit enter">${icon('sparkle')}<p><b>Contanos qué te gusta.</b> Con un test de un minuto armamos recomendaciones a tu medida.</p><button class="btn-primary lit" data-action="taste-test">Hacer el test</button></div>`}
    ${zuenaReleases() || (EXTERNAL_CATALOG || TEST_CATALOG ? '' : startEmpty())}
    ${TEST_CATALOG ? `<p class="discovery-source">Catálogo de prueba · Apple Music · Vistas previas, lanzamientos y artistas de fuentes reales.</p>${familyNav()}${testSections()}` : ''}
    ${(hookCharts(), chartsSection(true))}
    ${EXTERNAL_CATALOG ? `${section('mixes', 'Hecho para vos', 'Mixes que se actualizan con lo que escuchás')}
    ${section('foryou', 'Recomendado para vos', 'Artistas independientes con música completa en ZUENA')}` : ''}
    ${artistsCta()}
    ${EXTERNAL_CATALOG ? `${section('topartists', `Los más escuchados en ${regionLabel()}`, 'Según el ranking actual de Apple Music · perfiles con su catálogo')}
    ${section('chart', `Lo más escuchado en ${regionLabel()}`, 'Ranking actual de Apple Music · vistas previas de 30 segundos')}
    ${by ? section('because', `Porque escuchaste a ${esc(by.artist)}`) : ''}
    ${section('creators', 'Artistas para descubrir')}
    ${section('podcasts', 'Podcasts para vos', '', `<button class="link small" data-action="nav" data-view="explore" data-tab="podcasts">Ver más</button>`)}
    ${taste.data.radio !== false ? section('radio', 'Radio en vivo', '', `<button class="link small" data-action="nav" data-view="explore" data-tab="radio">Ver más</button>`) : ''}` : ''}
    ${app.library.tracks.length ? `<section class="home-sec"><header class="sec-head"><h2 class="section-title">Tu biblioteca</h2><button class="link" data-action="nav" data-view="songs">Ver biblioteca</button></header><div class="shelf">${app.library.derive().albums.slice(0, 12).map(albumCard).join('')}</div></section>` : ''}</div>`;
}

// ZUENA desde cero: todavía no hay lanzamientos publicados
const startEmpty = () => `<div class="zu-empty glass-soft enter">
    <span class="zu-empty-ico">${icon('disc')}</span>
    <div><h2>La música de ZUENA empieza acá.</h2>
      <p>Todavía no hay lanzamientos publicados. Cuando los primeros artistas suban su música, la vas a ver en esta pantalla. Mientras tanto podés escuchar tu propia música desde la Biblioteca.</p></div>
    <div class="hero-actions"><button class="btn-glass lit" data-action="nav" data-view="songs">${icon('library')}Ir a la Biblioteca</button></div>
  </div>`;

// lanzamientos de artistas verificados en ZUENA: próximos estrenos y lo recién publicado
function zuenaReleases() {
  const soon = app.releases.upcoming(), live = app.releases.live().slice(0, 16);
  if (!soon.length && !live.length) return '';
  const note = app.auth.mode === 'local' ? 'Publicados en este equipo por artistas verificados' : 'De artistas verificados en ZUENA';
  return `${soon.length ? `<section class="home-sec home-sec-premieres" data-sec="zu-premieres" data-reveal="fadeUp">
      <header class="sec-head">
        <div>
          <p class="eyebrow"><span class="p-live-dot" aria-hidden="true"></span>Sala de estrenos · Cuenta regresiva en tiempo real</p>
          <h2 class="section-title" tabindex="-1">Próximos estrenos</h2>
          <p class="sec-sub">Tarjetas inmersivas personalizadas por cada artista. Activá el recordatorio para escuchar en el segundo exacto del estreno.</p>
        </div>
        <div class="sec-head-actions">
          ${app.artist?.verified ? `<button class="btn-glass lit sm" data-action="nav" data-view="studio">${icon('plus')}Programar estreno</button>` : ''}
          <button class="link small" data-action="open-premieres-feed">Ver todos en el Feed</button>
        </div>
      </header>
      <div class="premiere-grid">${soon.map((r, i) => releaseCard(r, i)).join('')}</div>
    </section>` : ''}
    ${live.length ? `<section class="home-sec"><header class="sec-head"><div><h2 class="section-title">Nuevo en ZUENA</h2><p class="sec-sub">${note}</p></div></header><div class="shelf">${live.map(releaseCard).join('')}</div></section>` : ''}`;
}

async function loadHome(root, by) {
  const taste = app.taste;
  const region = regionOf();
  const top = taste.topGenres(3);
  const genres = top.length ? top : ['pop', 'urbano', 'electronic'];
  const recent = recentIds();

  const trendingAll = src.audiusTrending({ limit: 40 }).catch(() => []);
  const perGenre = Promise.all(genres.map((g) => src.audiusTrending({ genre: g, limit: 30 }).catch(() => [])));

  fill(root, 'mixes', async () => {
    const lists = await perGenre;
    const cards = genres.map((g, i) => {
      const local = app.library.tracks.filter((t) => genreOf(t.genre) === g);
      const items = [...rank(taste, lists[i], { limit: 18, recent }), ...local.slice(0, 8)];
      if (items.length < 4) return '';
      const id = `mix-${g}`;
      mixes.set(id, { id, title: `Mix ${GENRE_BY_ID[g].label}`, genre: g, items, sub: `Mix diario ${i + 1}` });
      return mixCard(mixes.get(id), i);
    }).join('');
    return cards ? `<div class="shelf big">${cards}</div>` : '';
  });
  fill(root, 'foryou', async () => {
    const pool = [...(await trendingAll), ...(await perGenre).flat()];
    const items = rank(taste, pool, { limit: 14, recent });
    return items.length ? shelfOf(items, { feature: true }) : '';
  });
  fill(root, 'chart', async () => {
    const items = (await src.appleChart(region, 20)).slice(0, 10);
    return items.length ? podium(items) : '';
  });
  if (by) fill(root, 'because', async () => {
    const name = by.artist.split(/ feat\.| & |, /)[0].trim();
    let items = by.source === 'audius' ? await src.audiusUserTracks(by.artistId, 12) : await src.itunesSongs(name, region, 15);
    // la búsqueda por texto devuelve cualquier cosa si el artista no existe: sólo coincidencias reales
    if (by.source !== 'audius') items = items.filter((t) => t.artist.toLowerCase().includes(name.toLowerCase()));
    items = items.filter((t) => t.id !== by.id);
    return items.length >= 3 ? shelfOf(items) : '';
  });
  fill(root, 'topartists', topArtistsShelf);
  fill(root, 'creators', async () => {
    const pool = [...(await perGenre).flat(), ...(await trendingAll)];
    const seen = new Set();
    const users = [];
    for (const t of rank(taste, pool, { limit: 60, perArtist: 1 })) {
      if (!t.artistId || seen.has(t.artistId)) continue;
      seen.add(t.artistId);
      users.push({ id: t.artistId, name: t.artist, verified: t.verified, avatar: t.artistAvatar });
      if (users.length >= 10) break;
    }
    return users.length ? `<div class="shelf">${users.map(creatorCard).join('')}</div>` : '';
  });
  fill(root, 'podcasts', async () => {
    const topics = taste.data.topics.length ? taste.data.topics : ['news', 'comedy', 'music'];
    const lists = await Promise.all(topics.slice(0, 4).map((id) => src.podcastsByTerm(TOPICS.find((t) => t.id === id)?.term || id, region, 5).catch(() => [])));
    let items = interleave(lists);
    if (items.length < 4) items = await src.topPodcasts(region, 12).catch(() => items);
    return items.length ? `<div class="mosaic">${dedupe(items).slice(0, 9).map(podcastCard).join('')}</div>` : '';
  });
  if (taste.data.radio !== false) fill(root, 'radio', async () => {
    const cc = REGIONS.find((r) => r.id === region)?.radio || 'AR';
    const [local, byGenre] = await Promise.all([
      src.radiosByCountry(cc, 14).catch(() => []),
      genres[0] ? src.radiosByTag(GENRE_BY_ID[genres[0]].label.split(' ')[0].toLowerCase(), 6).catch(() => []) : [],
    ]);
    const items = dedupe([...local, ...byGenre]).slice(0, 14);
    return items.length ? radioPills(items) : '';
  });
}

const interleave = (lists) => { const out = []; for (let i = 0; i < 12; i++) for (const l of lists) if (l[i]) out.push(l[i]); return out; };
const dedupe = (items) => { const s = new Set(); return items.filter((x) => !s.has(x.id) && s.add(x.id)); };

const mixCovers = (m) => m.items.map((t) => app.library.coverUrl(t)).filter(Boolean).slice(0, 3);
const mixLabel = (m) => m.label || GENRE_BY_ID[m.genre]?.label || '';

function mixCard(m, i) {
  const covers = mixCovers(m);
  return `<div class="card mix lit enter" style="--i:${i};--h:${hueOf(m.genre)}" data-action="mix" data-id="${m.id}">
    <div class="card-art"><div class="art mix-art">${covers.map((u, k) => `<img src="${esc(u)}" alt="" style="--k:${k}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`).join('')}<span class="mix-label">${esc(mixLabel(m))}</span></div>
    <button class="card-play" data-action="play-mix" data-id="${m.id}" title="Reproducir">${icon('play')}</button></div>
    <div class="card-title">${esc(m.title)}</div><div class="card-sub">${esc(m.sub)}</div>
  </div>`;
}

export function viewMix() {
  const m = mixes.get(app.ui.param);
  if (!m) return viewHome();
  return `${backBtn()}
    <section class="detail-head enter">
      <div class="art xl mix-art" style="--h:${hueOf(m.genre)}">${m.items.map((t) => app.library.coverUrl(t)).filter(Boolean).slice(0, 3).map((u, k) => `<img src="${esc(u)}" alt="" style="--k:${k}" referrerpolicy="no-referrer">`).join('')}<span class="mix-label">${esc(mixLabel(m))}</span></div>
      <div class="detail-meta">
        <p class="eyebrow">${esc(m.sub)}</p><h1>${esc(m.title)}</h1>
        <p class="muted">${m.label ? 'Playlist de ZUENA' : `Armado para ${esc(app.profile?.displayName || 'vos')}`} · ${m.items.length} canciones · ${totalTime(m.items)}</p>
        <div class="hero-actions"><button class="btn-primary lit" data-action="play-mix" data-id="${m.id}">${icon('play')}Reproducir</button>
        <button class="btn-glass lit" data-action="shuffle-mix" data-id="${m.id}">${icon('shuffle')}Aleatorio</button></div>
      </div>
    </section>
    ${trackList(m.items)}`;
}

// ---------- charts: Top oyentes mensuales y Top suscriptores mensuales (js/data/charts.js) ----------
// Datos de este equipo + actividad simulada (rotulada) de oyentes ficticios sobre artistas ficticios.
// Sin animación por fotograma: se recalcula al abrir y al cambiar los datos (máx. 1 vez cada 10 s), y la
// lista sólo se reemplaza si cambió el orden o los valores.
const simPill = '<span class="post-sim" title="Contenido simulado para pruebas">Simulado</span>';
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function chartRow(r, i, kind) {
  const val = kind === 'subs'
    ? `${plural(r.subs, 'suscriptor', 'suscriptores')}${r.monthNew ? `<small>+${r.monthNew} este mes</small>` : ''}`
    : plural(r.listeners, 'oyente', 'oyentes');
  const av = r.avatar ? `<span class="avatar sm"><img src="${esc(r.avatar)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></span>`
    : `<span class="avatar sm ph" style="--h:${hueOf(r.key)}"><span>${esc((r.name || '?').charAt(0).toUpperCase())}</span></span>`;
  return `<li><button class="chart-row lit" data-action="open-artist" data-id="${esc(r.key)}" aria-label="${i + 1}. ${esc(r.name)}, ${kind === 'subs' ? plural(r.subs, 'suscriptor', 'suscriptores') : plural(r.listeners, 'oyente', 'oyentes')}">
    <span class="chart-n">${i + 1}</span>${av}<span class="chart-main"><b>${esc(r.name)}</b>${r.sim ? simPill : r.catalog ? '<span class="pill cat">Catálogo</span>' : ''}${app.prefs.advanced ? `<small class="chart-key">${esc(r.key)}</small>` : ''}</span>
    <span class="chart-val">${val}</span></button></li>`;
}

function chartCard(kind, rows, { more = false } = {}) {
  const title = kind === 'subs' ? 'Top suscriptores mensuales' : 'Top oyentes mensuales';
  const empty = kind === 'subs' ? 'Todavía no hay suscriptores.' : 'Todavía no hay datos de oyentes.';
  return `<section class="chart-card glass-soft" data-chart="${kind}">
    <header class="sec-head"><div><h3>${title}</h3><p class="sec-sub">${kind === 'subs' ? 'Suscripciones activas hoy' : 'Últimos 28 días'}</p></div>
      ${more ? '<button class="link small" data-action="nav" data-view="explore">Ver charts</button>' : ''}</header>
    ${rows.length ? `<ol class="chart-list">${rows.map((r, i) => chartRow(r, i, kind)).join('')}</ol>` : `<p class="muted">${empty}</p>`}
    <p class="hint chart-foot">${rows.some((r) => r.sim) ? 'Datos de este equipo. Incluye actividad simulada de oyentes ficticios.' : 'Datos de este equipo.'}</p></section>`;
}

const chartSig = (rows) => rows.map((r) => `${r.key}:${r.listeners}:${r.subs || 0}:${r.monthNew || 0}`).join('|');

// Explorar: las dos listas (10 filas). Inicio: sólo "Top oyentes mensuales" (5 filas) y sólo si hay filas.
function chartsSection(compact = false) {
  if (!app.charts) return '';
  const { listeners, subs } = app.charts.top(compact ? 5 : 10);
  if (compact) {
    // sin filas queda un marcador oculto: si llegan datos (p. ej. el simulador) se completa en su lugar
    if (!listeners.length) return '<section class="charts-sec compact" data-charts="home" data-sig="" hidden></section>';
    return `<section class="charts-sec compact" data-charts="home" data-sig="${esc(chartSig(listeners))}">${chartCard('listeners', listeners, { more: true })}</section>`;
  }
  return `<section class="charts-sec" data-charts="explore" data-sig="${esc(chartSig(listeners) + '#' + chartSig(subs))}">
    <header class="sec-head"><div><h2 class="section-title">Charts</h2></div></header>
    <div class="charts-grid">${chartCard('listeners', listeners)}${chartCard('subs', subs)}</div></section>`;
}

let chartsHooked = false;
function hookCharts() {
  if (chartsHooked || !app.charts) return;
  chartsHooked = true;
  app.charts.addEventListener('change', () => {
    const el = document.querySelector('[data-charts]');
    if (!el?.isConnected) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = chartsSection(el.dataset.charts === 'home');
    const next = tmp.firstElementChild;
    if (next && next.dataset.sig !== el.dataset.sig) el.replaceWith(next);
  });
}

// ---------- catálogo de prueba (TEST_CATALOG): lanzamientos, playlists y artistas reales de Apple Music ----------
// Cada carrusel tiene su propio formato de tarjeta y se arma recién cuando se acerca a la pantalla.
const testSections = () => `${section('t-releases', 'Nuevos lanzamientos', 'Lo más reciente de los artistas más escuchados')}
    ${section('t-songs', 'Para escuchar ahora', 'Vistas previas de 30 segundos')}
    ${section('t-playlists', 'Playlists por país', 'Lo más escuchado en el mundo y en cada país')}
    ${section('t-artists', 'Artistas que están sonando', 'Global · Puerto Rico · Argentina · España · México · Chile')}
    ${section('t-feed', 'Desde el feed', 'Lo que se está comentando', `<button class="link small" data-action="nav" data-view="feed">Ver feed</button>`)}
    ${section('t-trends', 'Tendencias', 'Hashtags de las últimas 72 horas')}`;

const KIND_LABEL = { single: 'Single', ep: 'EP', album: 'Álbum' };

const relCard = (r, i) => `<div class="rl-card rl-rel lit enter" style="--i:${Math.min(i, 8)}" role="button" tabindex="0" data-action="open-amc" data-id="${esc(r.collectionId)}" aria-label="${esc(r.title)}, ${esc(r.artist)}">
    <img src="${esc(r.artwork)}" alt="" loading="lazy" decoding="async">
    <div class="rl-rel-meta"><span class="rl-tag">${KIND_LABEL[r.kind] || 'Lanzamiento'}</span><div class="rl-title">${esc(r.title)}</div><div class="rl-sub">${esc(r.artist)}</div></div></div>`;

function songRail(items) {
  const key = listKey(items);
  return `<div class="shelf rl rl-songs">${items.map((t, i) => `<div class="rl-card rl-song lit enter" style="--i:${Math.min(i, 8)}" role="button" tabindex="0" data-action="play" data-list="${key}" data-index="${i}" data-id="${esc(see(t).id)}" aria-label="Reproducir ${esc(t.title)}, ${esc(t.artist || '')}">
      ${art(t, 'xs')}<div class="rl-song-meta"><div class="rl-title">${esc(t.title)}</div><div class="rl-sub">${esc(t.artist || '')}</div></div><span class="rl-song-play">${icon('play')}</span></div>`).join('')}</div>`;
}

// carátulas de cada playlist sin repetir las de las anteriores: varios países comparten sus primeras canciones
function coversFor(lists) {
  const used = new Set();
  return lists.map((l) => {
    const all = [...new Set(l.items.map((t) => app.library.coverUrl(t)).filter(Boolean))];
    const picked = [...all.filter((u) => !used.has(u)), ...all.filter((u) => used.has(u))].slice(0, 3);
    picked.forEach((u) => used.add(u));
    return picked;
  });
}

const listCard = (l, i, covers) => `<div class="rl-card rl-list lit enter" style="--i:${Math.min(i, 8)}" role="button" tabindex="0" data-action="mix" data-id="${esc(l.id)}" aria-label="Playlist ${esc(l.title)}">
    <div class="rl-stack" aria-hidden="true">${covers.map((u, k) => `<img src="${esc(u)}" alt="" style="--k:${k}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`).join('')}</div>
    <div class="rl-list-foot"><h3 class="rl-list-name">${esc(l.label || l.title)}</h3><div class="rl-sub">${l.items.length} canciones</div></div>
    <button class="card-play" data-action="play-mix" data-id="${esc(l.id)}" aria-label="Reproducir ${esc(l.title)}">${icon('play')}</button></div>`;

const faceCard = (a, i) => `<div class="rl-face enter" style="--i:${Math.min(i, 8)}" role="button" tabindex="0" data-action="open-artist" data-id="am:${esc(a.id)}" aria-label="${esc(a.name)}">
    ${a.artwork ? `<img src="${esc(a.artwork)}" alt="" loading="lazy" decoding="async">` : '<span class="rl-face-ph"></span>'}<div class="rl-title">${esc(a.name)}</div></div>`;

function postCard(p, i) {
  const a = app.posts.author(p.uid) || p.author || {};
  const name = a.displayName || 'Autor de ZUENA';
  const av = a.avatar ? `<span class="avatar"><img src="${esc(a.avatar)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></span>`
    : `<span class="avatar ph" style="--h:${hueOf(p.uid)}"><span>${esc(name.charAt(0).toUpperCase())}</span></span>`;
  return `<div class="rl-card rl-post lit enter" style="--i:${Math.min(i, 8)}" role="button" tabindex="0" data-action="post-open" data-id="${esc(p.id)}" aria-label="Publicación de ${esc(name)}">
    <div class="rl-post-head">${av}<div class="rl-title">${esc(name)}</div>${p.sim ? simPill : ''}</div>
    <p class="rl-post-text">${esc(p.text)}</p>
    <div class="rl-post-foot"><span aria-label="${p.likes?.length || 0} Me gusta">${icon('heart')}${p.likes?.length || 0}</span><span aria-label="${app.posts.replyCount(p.id)} respuestas">${icon('feed')}${app.posts.replyCount(p.id)}</span></div></div>`;
}

const trendPill = (t, i) => `<button class="rl-card rl-trend lit enter" style="--i:${Math.min(i, 8)}" data-action="feed-tag" data-tag="${esc(t.tag)}"><b>#${esc(t.tag)}</b><span>${t.posts} ${t.posts === 1 ? 'publicación' : 'publicaciones'}</span></button>`;

// una canción por artista: la fila no se llena con el mismo nombre
function onePerArtist(songs) {
  const seen = new Set();
  return songs.filter((s) => { const k = String(s.artistId || s.artist); if (seen.has(k)) return false; seen.add(k); return true; });
}

// arma cada sección cuando está por entrar en pantalla (el desplazamiento de Inicio es #view, por eso es la raíz)
function fillWhenNear(root, loaders) {
  const pending = new Map(Object.entries(loaders));
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const id = e.target.dataset.sec;
      io.unobserve(e.target);
      const loader = pending.get(id);
      pending.delete(id);
      if (loader) fill(root, id, loader);
    }
    if (!pending.size) io.disconnect();
  }, { root: root.closest('#view') || (root.id === 'view' ? root : null), rootMargin: '480px 0px' });
  for (const id of pending.keys()) {
    const sec = root.querySelector(`[data-sec="${id}"]`);
    if (sec) io.observe(sec); else pending.delete(id);
  }
}

export const amReleaseCard = (r, i) => `<div class="card lit enter" style="--i:${Math.min(i, 10)}" role="button" tabindex="0" data-action="open-amc" data-id="${esc(r.collectionId)}" aria-label="${esc(r.title)}, ${esc(r.artist)}">
    <div class="card-art"><div class="art"><img src="${esc(r.artwork)}" alt="" loading="lazy" decoding="async"></div><span class="card-play">${icon('play')}</span></div>
    <div class="card-title${r.explicit ? ' has-badge' : ''}">${r.explicit ? `<span class="ct-text">${esc(r.title)}</span><span class="badge">E</span>` : esc(r.title)}</div><div class="card-sub">${linkArtistNames(r.artist, esc)}</div></div>`;

export const amArtistCard = (a, i) => `<div class="card artist lit enter" style="--i:${Math.min(i, 10)}" role="button" tabindex="0" data-action="open-artist" data-id="am:${a.id}" aria-label="${esc(a.name)}">
    <div class="card-art"><div class="art round">${a.artwork ? `<img src="${esc(a.artwork)}" alt="" loading="lazy" decoding="async">` : ''}</div></div>
    <div class="card-title">${esc(a.name)}</div><div class="card-sub">${esc((a.m || []).filter((x) => x !== 'us').slice(0, 3).map((x) => ({ global: 'Global', pr: 'PR', ar: 'AR', es: 'ES', mx: 'MX', cl: 'CL' }[x])).join(' · '))}</div></div>`;

function loadTestHome(root) {
  fillWhenNear(root, {
    't-releases': async () => { const r = await testReleases(); return r.length ? `<div class="shelf rl rl-rels">${r.slice(0, 24).map(relCard).join('')}</div>` : ''; },
    't-songs': async () => { const s = onePerArtist(await testSongs()).slice(0, 18); return s.length >= 3 ? songRail(s) : ''; },
    't-playlists': async () => {
      const lists = await testPlaylists();
      lists.forEach((l) => mixes.set(l.id, l));
      const covers = coversFor(lists);
      return lists.length ? `<div class="shelf rl rl-lists">${lists.map((l, i) => listCard(l, i, covers[i])).join('')}</div>` : '';
    },
    't-artists': async () => { const a = await testArtistCards(); return a.length ? `<div class="shelf rl rl-faces">${a.map(faceCard).join('')}</div>` : ''; },
    // sólo publicaciones reales o simuladas (rotuladas); sin publicaciones la sección no aparece
    't-feed': async () => { const p = app.posts.popular(10, 72).filter((x) => app.posts.visible(x)); return p.length ? `<div class="shelf rl rl-posts">${p.map(postCard).join('')}</div>` : ''; },
    't-trends': async () => { const t = app.posts.trends(12); return t.length ? `<div class="shelf rl rl-trends">${t.map(trendPill).join('')}</div>` : ''; },
  });
}

// ---------- Explorar ----------

// sin catálogo externo: Explorar muestra todo lo publicado en ZUENA
function exploreZuena() {
  const live = app.releases.live(), soon = app.releases.upcoming();
  if (TEST_CATALOG) {
    app.ui.mount = (root) => {
      fill(root, 'x-artists', async () => { const a = await testArtistCards(); return a.length ? `<div class="grid">${a.map(amArtistCard).join('')}</div>` : ''; });
      fill(root, 'x-releases', async () => { const r = await testReleases(); return r.length ? `<div class="grid">${r.map(amReleaseCard).join('')}</div>` : ''; });
    };
  }
  return `<div class="z-discovery z-explore">${discoveryHead('Escuchá más allá.', 'Lanzamientos, artistas y voces para seguir descubriendo.', 'Explorar · El catálogo')}
    ${TEST_CATALOG ? '<p class="discovery-source">Catálogo de prueba · Apple Music · Vistas previas y perfiles de artistas reales.</p>' : ''}
    ${soon.length ? `<h2 class="section-title">Próximos estrenos</h2><div class="shelf">${soon.map(releaseCard).join('')}</div>` : ''}
    ${live.length ? `<h2 class="section-title">Publicado en ZUENA</h2><div class="grid">${live.map(releaseCard).join('')}</div>` : TEST_CATALOG ? '' : startEmpty()}
    ${(hookCharts(), chartsSection(false))}
    ${TEST_CATALOG ? `${section('x-artists', 'Artistas')}${section('x-releases', 'Lanzamientos recientes')}` : ''}
    ${artistsCta()}</div>`;
}

export function viewExplore() {
  if (!EXTERNAL_CATALOG) return exploreZuena();
  const tab = app.ui.exploreTab || 'music';
  const chip = app.ui.exploreChip || '';
  const tabs = [['music', 'Música', 'music'], ['podcasts', 'Podcasts', 'mic'], ['radio', 'Radio', 'radio']];
  const chips = tab === 'music' ? GENRES.map((g) => [g.id, g.label]) : tab === 'podcasts' ? TOPICS.map((t) => [t.id, t.label]) : GENRES.slice(0, 12).map((g) => [g.id, g.label]);
  app.ui.mount = (root) => loadExplore(root, tab, chip);
  return `<div class="z-discovery z-explore">${discoveryHead('Escuchá más allá.', 'Música independiente, podcasts y radio. Elegí por dónde empezar.', 'Explorar · Fuentes reales')}
    <section class="discovery-filters" aria-label="Filtrar catálogo"><div class="seg three explore-tabs" role="group" aria-label="Tipo de contenido">${tabs.map(([id, l, ic]) => `<button class="seg-btn lit ${tab === id ? 'on' : ''}" aria-pressed="${tab === id}" data-action="explore-tab" data-tab="${id}">${icon(ic)}<span>${l}</span></button>`).join('')}</div>
    <div class="chips scroll enter" role="group" aria-label="Categorías" style="--i:1"><button class="chip lit ${!chip ? 'on' : ''}" aria-pressed="${!chip}" data-action="explore-chip" data-chip="">${tab === 'radio' ? regionLabel() : 'Destacado'}</button>${chips.map(([id, l]) => `<button class="chip lit ${chip === id ? 'on' : ''}" aria-pressed="${chip === id}" data-action="explore-chip" data-chip="${id}">${esc(l)}</button>`).join('')}</div></section>
    <p class="discovery-source">${tab === 'music' ? 'Audius · Música independiente completa / Apple Music · Ranking y vistas previas de 30 segundos' : tab === 'podcasts' ? 'Apple Podcasts · Catálogo de podcasts' : 'Radio Browser · Emisoras en vivo'}</p>
    <div class="explore-body"><div class="home-sec" data-sec="explore"><div class="sec-body">${skeletonRow(8)}</div></div>
    ${tab === 'music' && !chip ? `<div class="home-sec" data-sec="explore-chart"><h2 class="section-title">Ranking en ${regionLabel()}</h2><div class="sec-body">${skeletonRow()}</div></div>` : ''}</div></div>`;
}

async function loadExplore(root, tab, chip) {
  const region = regionOf();
  if (tab === 'music') {
    fill(root, 'explore', async () => {
      const items = await src.audiusTrending({ genre: chip || null, limit: 30 });
      if (!items.length) return '';
      return `<h2 class="section-title">${chip ? `Tendencias · ${esc(GENRE_BY_ID[chip].label)}` : 'Tendencias en ZUENA'}</h2>${trackList(items)}`;
    });
    if (!chip) fill(root, 'explore-chart', async () => { const items = await src.appleChart(region, 25); return items.length ? podium(items) : ''; });
  } else if (tab === 'podcasts') {
    fill(root, 'explore', async () => {
      const items = chip ? await src.podcastsByTerm(TOPICS.find((t) => t.id === chip).term, region, 18) : await src.topPodcasts(region, 20);
      if (!items.length) return '';
      return `<h2 class="section-title">${chip ? esc(TOPICS.find((t) => t.id === chip).label) : `Top podcasts en ${regionLabel()}`}</h2><div class="grid">${items.map(podcastCard).join('')}</div>`;
    });
  } else {
    fill(root, 'explore', async () => {
      const cc = REGIONS.find((r) => r.id === region)?.radio || 'AR';
      const items = chip ? await src.radiosByTag(GENRE_BY_ID[chip].label.split(' ')[0].toLowerCase(), 24) : await src.radiosByCountry(cc, 24);
      if (!items.length) return '';
      const key = listKey(items);
      return `<h2 class="section-title">${chip ? `Radios de ${esc(GENRE_BY_ID[chip].label)}` : `Radios de ${regionLabel()}`}</h2><div class="grid">${items.map((it, i) => mediaCard(it, key, i)).join('')}</div>`;
    });
  }
}

// ---------- Podcast ----------

export function viewPodcast() {
  const id = app.ui.param;
  const cached = app.seen.get(`pc:${id}`);
  app.ui.mount = (root) => fill(root, 'podcast', async () => {
    const { show, episodes } = await src.podcastDetail(id, 20);
    const s = show || cached;
    const head = root.querySelector('.podcast-head');
    if (s && head) head.outerHTML = podcastHead(s, episodes.length);
    return trackList(episodes, { album: false, empty: 'Este podcast no tiene episodios disponibles.' });
  });
  return `${backBtn()}${cached ? podcastHead(cached) : '<section class="detail-head podcast-head"><div class="art xl skeleton"></div></section>'}
    <div class="home-sec" data-sec="podcast"><h2 class="section-title">Episodios</h2><div class="sec-body"><div class="loading-view"><span class="pulse"></span></div></div></div>`;
}

function podcastHead(s, n) {
  return `<section class="detail-head podcast-head enter">${art(s, 'xl')}
    <div class="detail-meta"><p class="eyebrow">Podcast</p><h1>${esc(s.title)}</h1><p class="muted">${esc(s.artist)}${s.genreRaw ? ` · ${esc(s.genreRaw)}` : ''}${n ? ` · ${n} episodios recientes` : ''}</p>
    ${s.externalUrl ? `<a class="link-chip lit" href="${esc(s.externalUrl)}" target="_blank" rel="noopener noreferrer">${icon('link')}Apple Podcasts</a>` : ''}</div></section>`;
}

// ---------- Artista (Audius) ----------

export function viewCreator() {
  const id = app.ui.param;
  app.ui.mount = async (root) => {
    try {
      const [u, tracks] = await Promise.all([src.audiusUser(id), src.audiusUserTracks(id, 20)]);
      const head = root.querySelector('.creator-head');
      if (!head?.isConnected) return;
      head.outerHTML = creatorHead(u);
      const body = root.querySelector('[data-sec="creator"] .sec-body');
      body.innerHTML = trackList(tracks, { empty: 'Todavía no publicó canciones.' });
      app.afterFill(root);
    } catch (err) {
      console.warn(err);
      root.querySelector('[data-sec="creator"] .sec-body').innerHTML = '<p class="muted">No se pudo cargar el artista.</p>';
    }
  };
  return `${backBtn()}<section class="creator-head profile"><div class="profile-banner"></div></section>
    <div class="home-sec" data-sec="creator"><h2 class="section-title">Canciones populares</h2><div class="sec-body"><div class="loading-view"><span class="pulse"></span></div></div></div>`;
}

function creatorHead(u) {
  return `<section class="creator-head profile enter">
    <div class="profile-banner ${u.cover ? 'has-img' : ''}">${u.cover ? `<img src="${esc(u.cover)}" alt="" referrerpolicy="no-referrer">` : ''}</div>
    <div class="profile-head">
      ${u.avatar ? `<div class="avatar xl profile-avatar"><img src="${esc(u.avatar)}" alt="" referrerpolicy="no-referrer"></div>` : `<div class="avatar xl ph profile-avatar" style="--h:${hueOf(u.id)}"><span>${esc(u.name.charAt(0))}</span></div>`}
      <div class="profile-id">
        <p class="eyebrow">${u.verified ? `${icon('verified', 'verified-ico')} Artista verificado` : 'Artista'} · en Audius</p>
        <h1 class="profile-name">${esc(u.name)}${tick(u.verified)}</h1>
        <p class="profile-handle">@${esc(u.handle)}${u.location ? ` · ${esc(u.location)}` : ''}</p>
        ${u.bio ? `<p class="profile-bio">${esc(u.bio.slice(0, 280))}</p>` : ''}
        <div class="profile-stats"><span><b>${compact(u.followers)}</b> seguidores</span><span><b>${u.tracks}</b> canciones</span></div>
      </div>
      <div class="hero-actions"><button class="btn-primary lit" data-action="play-creator" data-id="${esc(u.id)}">${icon('play')}Reproducir</button>
      <a class="btn-glass lit" href="https://audius.co/${esc(u.handle)}" target="_blank" rel="noopener noreferrer">${icon('link')}Audius</a></div>
    </div>
  </section>`;
}

// ---------- acciones ----------

registerActions({
  'open-premieres-feed': () => {
    app.ui.feedTab = 'releases';
    app.go('feed');
  },
  'discovery-jump': (el) => {
    const targetId = el.dataset.section === 't-releases' && el.closest('.z-discovery')?.querySelector('[data-sec="zu-premieres"]')
      ? 'zu-premieres'
      : el.dataset.section;
    const section = el.closest('.z-discovery')?.querySelector(`[data-sec="${targetId}"]`);
    section?.scrollIntoView({ behavior: app.motion?.enabled === false ? 'instant' : 'smooth', block: 'start' });
    section?.querySelector('.section-title')?.focus({ preventScroll: true });
  },
  'discovery-retry': (el) => retryLoads.get(el.closest('.sec-body'))?.(),
  mix: (el) => app.go('mix', el.dataset.id),
  'play-mix': (el, e) => { e?.stopPropagation(); app.playGroup(mixes.get(el.dataset.id)?.items, false); },
  'shuffle-mix': (el) => app.playGroup(mixes.get(el.dataset.id)?.items, true),
  podcast: (el) => app.go('podcast', el.dataset.id),
  creator: (el, e) => { e?.stopPropagation(); app.go('artistpage', `au:${el.dataset.id}`); },
  'play-creator': async (el) => app.playGroup(await src.audiusUserTracks(el.dataset.id, 20), false),
  'explore-tab': (el) => { app.ui.exploreTab = el.dataset.tab; app.ui.exploreChip = ''; app.render(); },
  'explore-chip': (el) => { app.ui.exploreChip = el.dataset.chip; app.render(); },
});

export { see };
