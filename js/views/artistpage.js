// Perfil de artista unificado (Requisitos/Perfil de artista y catálogo): un solo diseño jerárquico para
// artistas verificados de ZUENA (zu:uid), de Audius (au:id) y del catálogo de Apple Music (am:id).
// Portada a sangre + cabecera (Seguir / Suscribirme) y pestañas Música / Publicaciones / Acerca de
// (Requisitos/Feed de artistas, suscripciones y charts §5). Una sección vacía no se dibuja.
import { app, registerActions } from '../app.js';
import { artColors } from '../ui/artcolor.js';
import { icon } from '../ui/icons.js';
import { esc, hueOf } from '../ui/format.js';
import { confirmModal, openModal } from '../ui/modal.js';
import {
  tierName, TIER_NAMES, canSubscribeSim, TIER_BENEFITS, supportVariant, subStateLabel, visibleTiers,
  counterDisplay, referencePrice, subscriptionWith, entitledTier,
} from '../data/subs.js';
import { db } from '../store/db.js';
import * as src from '../catalog/sources.js';
import { appleArtist, appleCollection, appleTopArtists } from '../catalog/artists.js';
import { isLive, isUpcoming } from '../data/releases.js';
import { TEST_CATALOG } from '../config.js';
import { testArtistById } from '../data/testArtists.js';
import { payments, parseAmount, donationError, formatEUR, PRESETS, MESSAGE_MAX } from '../data/payments.js';
import { trackList, backBtn, tick, compact } from './common.js';
import { postCard, releaseCard, followToggle } from './feed.js';

const KIND_TITLE = { single: 'Singles', ep: 'EPs', album: 'Álbumes' };
const country = () => (app.taste.data.region || 'ar').toLowerCase();
const tokenize = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/\s*(?:,|&| feat\.? | ft\.? | with | con | x | y )\s*/).map((x) => x.trim());

// ---------- normalizadores: cada fuente → el mismo modelo ----------
async function loadApple(id) {
  // los eventos "Nuevo lanzamiento" del catálogo de prueba se derivan en paralelo (no frenan el perfil)
  const cat = TEST_CATALOG && testArtistById(id) ? app.posts.loadCatalog().catch(() => {}) : null;
  const a = await appleArtist(id, country());
  await cat;
  // populares: primero lo que está en el ranking del país; si no hay nada del ranking, se rotula "Canciones"
  let inChart = [];
  try { inChart = (await src.appleChart(country(), 100)).filter((t) => t.artistId === a.id); } catch { /* sin ranking */ }
  const seen = new Set(inChart.map((t) => t.id));
  const popular = [...inChart, ...a.popular.filter((t) => !seen.has(t.id))].slice(0, 10);
  // ¿alguna cuenta de este equipo reclamó y verificó este perfil? (sólo rótulo; el catálogo sigue siendo de Apple)
  const claimedBy = (await db.all('claims').catch(() => [])).find((c) => !c.sim && c.status === 'approved' && c.target?.key === `am:${id}`)?.uid || null;
  return {
    claimedBy,
    name: a.name,
    badge: 'Perfil no reclamado · datos de Apple Music',
    sub: [a.genre, 'Vistas previas de 30 segundos'].filter(Boolean).join(' · '),
    popularTitle: inChart.length ? 'Populares' : 'Canciones',
    popular,
    shelves: ['single', 'ep', 'album'].map((k) => ({ kind: k, items: a[{ single: 'singles', ep: 'eps', album: 'albums' }[k]].map((r) => ({ ...r, source: 'apple' })) })),
    collabs: a.collabs,
    external: a.url && { label: 'Abrir en Apple Music', url: a.url },
    claim: true,
    catalog: !!(TEST_CATALOG && testArtistById(id)),
  };
}

async function loadAudius(id) {
  const [u, tracks] = await Promise.all([src.audiusUser(id), src.audiusUserTracks(id, 20)]);
  return {
    name: u.name,
    verified: u.verified,
    badge: u.verified ? 'Verificado en Audius' : 'Artista en Audius',
    sub: [u.location, `${compact(u.followers)} seguidores`, `${u.tracks} canciones`].filter(Boolean).join(' · '),
    cover: u.cover,
    avatar: u.avatar,
    popularTitle: 'Populares',
    popular: tracks.slice(0, 10),
    shelves: [],
    songs: tracks.slice(10),
    about: u.bio ? u.bio.slice(0, 600) : '',
    external: { label: 'Abrir en Audius', url: `https://audius.co/${u.handle}` },
  };
}

async function loadZuena(uid) {
  const [profile, claim] = await Promise.all([db.get('profiles', uid), db.get('claims', uid)]);
  const p = profile || (app.profile?.uid === uid ? app.profile : null);
  if (!p) throw new Error('Este perfil ya no existe.');
  const mine = app.user?.uid === uid;
  const verified = claim?.status === 'approved';
  const name = claim?.artistName || p.displayName;
  const rel = app.releases.all.filter((r) => r.uid === uid);
  const live = rel.filter((r) => isLive(r)).sort((a, b) => (b.published || 0) - (a.published || 0));
  const tracksOf = (r) => r.tracks.map((rt) => app.library.byId.get(rt.trackId)).filter((t) => app.isAvailable(t));
  const all = live.flatMap(tracksOf);
  // populares según reproducciones en este equipo; con pocos datos, "Recientes"
  const plays = app.stats.data?.plays || {};
  const total = all.reduce((s, t) => s + (plays[t.id] || 0), 0);
  const popular = total >= 5 ? [...all].sort((a, b) => (plays[b.id] || 0) - (plays[a.id] || 0)) : all;
  // colaboraciones: lanzamientos de otros artistas con su nombre en "invitados"
  const tok = tokenize(name)[0];
  const collabs = app.releases.live().filter((r) => r.uid !== uid && tokenize(r.featuring).includes(tok)).flatMap(tracksOf);
  return {
    name,
    verified,
    localVerified: verified && !claim?.sim && claim?.verification !== 'full',
    tierOptions: claim?.tierOptions || {},
    sim: !!(p.sim || claim?.sim),
    badge: verified ? 'Artista verificado' : 'En ZUENA',
    sub: `@${p.username}`,
    cover: p.cover,
    avatar: p.avatar,
    themed: p,
    popularTitle: total >= 5 ? 'Populares' : 'Recientes',
    popular: popular.slice(0, 10),
    upcoming: rel.filter((r) => isUpcoming(r)),
    shelves: ['single', 'ep', 'album'].map((k) => ({ kind: k, items: live.filter((r) => r.type === k).map((r) => ({ ...r, source: 'zuena' })) })),
    collabs,
    posts: zuPosts(uid, mine),
    about: p.bio || '',
    owner: mine,
    empty: mine ? { releases: 'Todavía no subiste nada. Empezá con un single.', posts: 'Todavía no publicaste nada.' } : null,
  };
}

// publicaciones del artista (anclado primero); los posts de lanzamientos retirados no se muestran a terceros
function zuPosts(uid, mine) {
  return app.posts.byUser(uid).filter((post) => {
    if (!post.attach?.releaseId || mine) return true;
    const r = app.releases.get(post.attach.releaseId);
    return r && (isLive(r) || isUpcoming(r));
  });
}

const LOADERS = { am: loadApple, au: loadAudius, zu: loadZuena };

// ---------- estado del botón Seguir y pestañas por tipo de perfil (puras, con tests) ----------
// 'none' = sin botón (Audius) · 'owner' = perfil propio · 'guest' = sin sesión · 'following' / 'follow'
export function followState({ me = null, uid = '', following = false, source = 'zu' } = {}) {
  if (source === 'au') return 'none';
  if (me && source === 'zu' && uid === me) return 'owner';
  if (!me) return 'guest';
  return following ? 'following' : 'follow';
}

// Música nunca se oculta. Publicaciones: no existe para Audius. Acerca de: Audius sólo si trae biografía.
export function profileTabs(source, m = {}) {
  const tabs = ['music'];
  if (source !== 'au') tabs.push('posts');
  if (source !== 'au' || m.about || m.external) tabs.push('about');
  return tabs;
}
const TAB_LABEL = { music: 'Música', posts: 'Publicaciones', about: 'Acerca de' };
const followKey = (source, id) => (source === 'am' ? `am:${id}` : id);
const simTag = '<span class="post-sim" title="Contenido simulado para pruebas">Simulado</span>';

// ---------- vista ----------
export function viewArtistPage() {
  const [source, ...rest] = String(app.ui.param || '').split(':');
  const id = rest.join(':');
  const token = Symbol('ap');
  app.ui.apToken = token;
  // la pestaña elegida se recuerda mientras se mira el mismo artista; al cambiar de artista vuelve a "Música"
  if (app.ui.apTabFor !== app.ui.param) { app.ui.apTab = 'music'; app.ui.apTabFor = app.ui.param; app.ui.apPostsLimit = 10; }
  app.ui.mount = async (root) => {
    const host = root.querySelector('.ap');
    try {
      const m = await LOADERS[source](id);
      if (app.ui.apToken !== token || !host?.isConnected) return; // se navegó a otro lado
      app.ui.apModel = m;
      host.outerHTML = page(m, source, id);
      app.afterFill(root);
      // sección de apoyo (Requisitos/Suscripciones v2 §4.1): la variante la decide supportVariant
      if (source === 'zu' && m.verified) mountSupport(root, id, m);
      // perfiles del catálogo de prueba: vista de prueba fija (sin cobros, avisado; nunca simulada)
      else if (source === 'am' && TEST_CATALOG && testArtistById(id)) mountSupportPreview(root, 'am:' + id, m.name, 'test');
      // visualización de perfil para los charts (se registra, no se muestra: decisión D6)
      if (source === 'zu' || source === 'am') app.charts?.view(`${source}:${id}`, app.user?.uid, source === 'zu' ? id : null);
      mountScrollFx(root, m);
      root.querySelector('.ap-name')?.focus({ preventScroll: true });
    } catch (err) {
      console.warn('[artista]', err);
      if (host?.isConnected) host.innerHTML = `<div class="ap-error"><p>${esc(navigator.onLine ? (err.message?.startsWith('Este') ? err.message : 'No se pudo cargar el artista.') : 'Sin conexión. Conectate para ver este perfil.')}</p>
        <button class="btn-glass lit" data-action="artist-retry">Reintentar</button></div>`;
    }
  };
  return `<article class="ap" aria-busy="true"><div class="ap-hero skeleton"><div class="ap-head">${backBtn()}<div class="ap-id"><span class="sk-line w40"></span><span class="sk-line w70 tall"></span></div></div></div></article>`;
}

// La portada del disco pertenece al catálogo. La cabecera sólo usa imágenes del perfil.
function hero(m, source, id) {
  const kind = m.cover ? 'cover' : m.avatar ? 'photo' : 'none';
  const media = kind === 'cover'
    ? `<div class="ap-cover" aria-hidden="true"><img src="${esc(m.cover)}" alt="" decoding="async" loading="eager" referrerpolicy="no-referrer"></div>`
    : `<div class="ap-cover none" style="--h:${hueOf(m.name)}" aria-hidden="true"></div>`;
  return `<header class="ap-hero ap-v2 kind-${kind}">
    ${media}
    <div class="ap-head">
      ${backBtn()}
      ${kind === 'photo' ? `<div class="ap-photo"><img src="${esc(m.avatar)}" alt="Foto de ${esc(m.name)}" decoding="async" referrerpolicy="no-referrer"></div>` : ''}
      <div class="ap-row">
        <div class="ap-id">
          <p class="eyebrow">${esc(source === 'am' ? 'Catálogo de Apple Music' : m.badge)}</p>
          <h1 class="ap-name" tabindex="-1">${esc(m.name)}${tick(m.verified, m.badge)}</h1>
          ${m.sub ? `<p class="ap-sub">${esc(m.sub)}</p>` : ''}
        </div>
      </div>
      <div class="hero-actions">
        ${m.popular.length ? `<button class="btn-primary lit" data-action="artist-play">${icon('play')}Reproducir</button><button class="btn-icon lit ap-shuffle" data-action="artist-shuffle" aria-label="Reproducir en orden aleatorio" title="Aleatorio">${icon('shuffle')}</button>` : ''}
        ${followBtn(m, source, id)}
        ${m.owner ? `<button class="btn-glass lit" data-action="edit-profile">${icon('edit')}Editar perfil</button>` : ''}
      </div>
    </div>
  </header>`;
}

const sec = (id, title, body, extra = '') => `<section class="ap-sec" data-reveal="fadeUp" aria-labelledby="ap-${id}"><header class="sec-head"><h2 class="section-title" id="ap-${id}">${title}</h2>${extra}</header>${body}</section>`;

function releaseTile(r, i) {
  if (r.source === 'zuena') return releaseCard(r, i);
  return `<div class="card lit enter" style="--i:${Math.min(i, 10)}" role="button" tabindex="0" data-action="open-amc" data-id="${esc(r.collectionId)}" aria-label="${esc(r.title)}, ${esc(KIND_TITLE[r.kind].slice(0, -1))} ${esc(r.year || '')}">
    <div class="card-art"><div class="art"><img src="${esc(r.artwork)}" alt="" loading="lazy" decoding="async"></div><span class="card-play">${icon('play')}</span></div>
    <div class="card-title${r.explicit ? ' has-badge' : ''}">${r.explicit ? `<span class="ct-text">${esc(r.title)}</span><span class="badge">E</span>` : esc(r.title)}</div><div class="card-sub">${esc(r.year || '')}${r.tracks > 1 ? ` · ${r.tracks} canciones` : ''}</div></div>`;
}

// Seguir / Siguiendo (zu: y am:, no Audius ni el dueño). Contador de seguidores sólo en artistas de ZUENA.
function followBtn(m, source, id) {
  const key = followKey(source, id);
  const st = followState({ me: app.user?.uid, uid: id, following: app.posts.isFollowing(key), source });
  if (st === 'none' || st === 'owner') return '';
  const on = st === 'following';
  const n = source === 'zu' ? app.charts?.followersOf(`zu:${id}`) || 0 : null;
  return `<button class="btn-glass lit ap-follow" data-action="ap-follow" data-uid="${esc(key)}" aria-pressed="${on}">${icon(on ? 'check' : 'plus')}<span>${on ? 'Siguiendo' : 'Seguir'}</span></button>
    ${n !== null ? `<span class="ap-fcount" data-n="${n}">${n} ${n === 1 ? 'seguidor' : 'seguidores'}${m.sim ? simTag : ''}</span>` : ''}`;
}

// pestaña Publicaciones: lo mismo que ve en el feed quien lo sigue (exclusivos bloqueados según su nivel)
function postsPanel(m, source, id) {
  if (source === 'am') {
    const evs = app.posts.catalogOf(id);
    return `<p class="sec-sub ap-note">Lanzamientos del catálogo de Apple Music. Este artista no publica en ZUENA.</p>
      ${evs.length ? `<div class="feed">${evs.map((p, i) => postCard(p, i)).join('')}</div>` : `<div class="glass-soft notice">${icon('disc')}<p>No hay lanzamientos recientes en el catálogo.</p></div>`}`;
  }
  const posts = source === 'zu' ? zuPosts(id, m.owner) : [];
  const limit = app.ui.apPostsLimit || 10;
  if (!posts.length) {
    return m.owner
      ? `<div class="glass-soft notice">${icon('edit')}<p>Todavía no publicaste nada. <button class="link small" data-action="nav" data-view="feed">Ir al feed</button></p></div>`
      : `<div class="glass-soft notice">${icon('edit')}<p>Todavía no hay publicaciones.</p></div>`;
  }
  return `<div class="feed">${posts.slice(0, limit).map((p, i) => postCard(p, i)).join('')}</div>
    ${posts.length > limit ? '<button class="btn-glass lit fx-more" data-action="ap-posts-more">Mostrar más</button>' : ''}`;
}

// "En los charts": posición y valor del artista en cada ranking (sólo si figura)
function chartsBlock(source, id, m) {
  if (!app.charts || (source !== 'zu' && source !== 'am')) return '';
  const pos = app.charts.positionOf(`${source}:${id}`);
  const rows = [];
  if (pos.listeners) rows.push(`<li><b>#${pos.listeners.pos}</b> en Top oyentes mensuales · ${pos.listeners.listeners} ${pos.listeners.listeners === 1 ? 'oyente' : 'oyentes'}</li>`);
  if (source === 'zu' && pos.subs) rows.push(`<li><b>#${pos.subs.pos}</b> en Top suscriptores mensuales · ${pos.subs.subs} ${pos.subs.subs === 1 ? 'suscriptor' : 'suscriptores'}</li>`);
  return `<div class="ap-charts glass-soft"><h3>En los charts ${m.sim && rows.length ? simTag : ''}</h3>
    ${rows.length ? `<ul>${rows.join('')}</ul><p class="hint">Últimos 28 días · Datos de este equipo.</p>` : '<p class="muted">Todavía no figura en los charts.</p>'}</div>`;
}

function aboutPanel(m, source, id) {
  const out = [];
  const links = [
    m.external ? `<a class="btn-glass lit" href="${esc(m.external.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(m.external.label)} (se abre en otra pestaña)">${icon('link')}${esc(m.external.label)}</a>` : '',
    m.owner ? `<button class="btn-glass lit" data-action="nav" data-view="studio">${icon('disc')}Ir a ZUENA Studio</button>` : '',
  ].filter(Boolean);
  if (source === 'am') {
    out.push('<p class="ap-about">Perfil del catálogo de Apple Music. No está registrado en ZUENA y no ofrece suscripciones.</p>');
    if (m.claimedBy) out.push(`<p class="ap-note">Este perfil fue reclamado por una cuenta de ZUENA verificada en este equipo. <button class="link small" data-action="open-artist" data-id="zu:${esc(m.claimedBy)}">Ver su perfil</button></p>`);
    // reclamo del perfil (Requisitos/Perfiles con rol y reclamo de artista §6): sólo a cuentas Artista
    else if (m.catalog && app.user && !app.artist?.verified) {
      out.push(app.profile?.accountType === 'artist'
        ? `<p class="ap-claim"><button class="link" data-action="claim-catalog" data-key="am:${esc(id)}" data-name="${esc(m.name)}">¿Sos este artista? Reclamá este perfil.</button></p>`
        : '<p class="ap-claim muted">Cambiá tu cuenta a Artista para reclamar este perfil.</p>');
    }
  } else {
    out.push(`<p class="ap-state">${m.verified ? icon('verified', 'verified-ico') : ''}${esc(m.badge)}</p>`);
    if (m.owner && m.localVerified) out.push('<p class="ap-note">Verificado en este equipo. Esta verificación no se comprueba con un servidor y sólo vale acá.</p>');
    if (m.sim) out.push(`<p class="ap-note">Perfil de prueba ${simTag}</p>`);
    if (m.about) out.push(`<p class="ap-about">${esc(m.about)}</p>`);
    if (m.noSupport) out.push('<p class="ap-note">Este artista todavía no recibe suscripciones.</p>');
  }
  out.push(chartsBlock(source, id, m));
  if (links.length) out.push(`<section class="ap-profile-links"><h3>Enlaces y gestión</h3><div>${links.join('')}</div></section>`);
  return out.join('');
}

function page(m, source, id) {
  const parts = [];
  if (m.popular.length) parts.push(sec('pop', m.popularTitle, `<div class="ap-popular">${trackList(m.popular.slice(0, 5), { numbered: true })}</div>
    ${m.popular.length > 5 ? `<div class="ap-more" hidden>${trackList(m.popular.slice(5), { numbered: false })}</div><button class="link small ap-more-btn" data-action="artist-more">Ver más</button>` : ''}`));
  if (m.upcoming?.length) parts.push(sec('soon', 'Próximamente', `<div class="shelf">${m.upcoming.map(releaseCard).join('')}</div>`));
  for (const s of m.shelves) {
    if (s.items.length) parts.push(sec(s.kind, KIND_TITLE[s.kind], `<div class="shelf">${s.items.slice(0, 24).map(releaseTile).join('')}</div>`));
  }
  if (m.empty && !m.shelves.some((s) => s.items.length) && !m.upcoming?.length) parts.push(sec('rel', 'Lanzamientos', `<div class="glass-soft notice">${icon('disc')}<p>${m.empty.releases}</p><button class="btn-primary lit" data-action="nav" data-view="studio">Ir al Estudio</button></div>`));
  if (m.songs?.length) parts.push(sec('songs', 'Canciones', trackList(m.songs)));
  if (m.collabs?.length) parts.push(sec('collab', 'Colaboraciones', trackList(m.collabs.slice(0, 12)), source === 'zu' ? '<p class="sec-sub">Según los créditos del lanzamiento</p>' : ''));
  if (!parts.length) parts.push('<div class="glass-soft notice"><p>Este artista todavía no tiene música disponible.</p></div>');
  const tabs = profileTabs(source, m);
  const cur = tabs.includes(app.ui.apTab) ? app.ui.apTab : 'music';
  const body = { music: () => parts.join(''), posts: () => postsPanel(m, source, id), about: () => aboutPanel(m, source, id) };
  const tablist = `<div class="ap-tabs" role="tablist" aria-label="Secciones del perfil">${tabs.map((t) => `<button role="tab" class="ap-tab ${t === cur ? 'on' : ''}" id="ap-tab-${t}" aria-controls="ap-panel-${t}" aria-selected="${t === cur}" tabindex="${t === cur ? 0 : -1}" data-action="ap-tab" data-tab="${t}">${TAB_LABEL[t]}</button>`).join('')}</div>`;
  const panels = tabs.map((t) => `<div class="ap-panel" role="tabpanel" id="ap-panel-${t}" aria-labelledby="ap-tab-${t}" tabindex="0" ${t === cur ? '' : 'hidden'}>${body[t]()}</div>`).join('');
  return `<article class="ap" data-source="${source}">${hero(m, source, id)}<div class="ap-body">${tablist}${panels}</div></article>`;
}

function selectTab(tab, focus = false) {
  const list = document.querySelector('.ap-tabs');
  if (!list) return;
  app.ui.apTab = tab;
  for (const b of list.querySelectorAll('[role=tab]')) {
    const on = b.dataset.tab === tab;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    if (on && focus) b.focus();
  }
  document.querySelectorAll('.ap-panel').forEach((p) => { p.hidden = p.id !== `ap-panel-${tab}`; });
}

// vuelve a dibujar Publicaciones (p. ej. al suscribirse o cancelar: los exclusivos se (des)bloquean al instante)
function refreshPanels() {
  const m = app.ui.apModel;
  const [source, ...rest] = String(app.ui.param || '').split(':');
  const id = rest.join(':');
  const posts = document.getElementById('ap-panel-posts');
  if (m && posts) { posts.innerHTML = postsPanel(m, source, id); app.afterFill(posts); }
  const about = document.getElementById('ap-panel-about');
  if (m && about) about.innerHTML = aboutPanel(m, source, id);
}

// pestañas con teclado: flechas izquierda/derecha, Inicio y Fin
document.addEventListener('keydown', (e) => {
  const tab = e.target.closest?.('.ap-tabs [role=tab]');
  if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  const all = [...tab.parentElement.querySelectorAll('[role=tab]')];
  const i = all.indexOf(tab);
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length;
  e.preventDefault();
  selectTab(all[next].dataset.tab, true);
});

// ---------- apoyar al artista (Requisitos/Suscripciones v2) ----------
// Variantes (§4.1): vista previa del dueño · simulada (sim-*) · vista de prueba (am:) · Próximamente (sin servidor)
// · sin apoyo / sin niveles (nada) · real (Stripe Checkout). Nunca se simula un cobro ni se pide tarjeta: el pago
// ocurre sólo en Stripe y el acceso lo confirma el servidor (/me/subscriptions → entitled).
const REF_TIERS = TIER_NAMES;
const PAY_OFF = 'Los pagos todavía no están activos en ZUENA. Hoy no se procesa ningún pago.';
const PAY_DOWN = 'No pudimos conectar con el servicio de pagos. Probá de nuevo en unos minutos.';
const advHint = (t) => (app.prefs?.advanced ? `<p class="hint">${t}</p>` : '');
const perksHtml = (slot) => `<ul class="tier-perks">${(TIER_BENEFITS[slot - 1] || []).map((b) => `<li>${icon('check')}${esc(b)}</li>`).join('')}</ul>`;

// caché en memoria (5 min) del perfil público de cobro por artista
const infoCache = new Map();
async function artistInfo(uid) {
  const hit = infoCache.get(uid);
  if (hit && Date.now() - hit.at < 5 * 60e3) return hit.info;
  const info = await payments.artist(uid).catch(() => null);
  if (info) infoCache.set(uid, { at: Date.now(), info });
  return info;
}

// suscripciones del usuario según el servidor (null = sin dato: todo bloqueado)
async function mySubs() {
  if (!app.user || !(await app.auth.idToken?.())) return null;
  try { return (await payments.mySubscriptions(app.auth)).subscriptions || []; } catch { return null; }
}

async function mountSupport(root, uid, m) {
  if (m.sim && !m.owner) {
    const v = supportVariant({ uid, testCatalog: TEST_CATALOG });
    if (v === 'sim') mountSupportSim(root, uid, m.name);
    return;
  }
  const configured = payments.configured;
  const h = configured ? await payments.health() : null;
  const serverUp = !!h;
  let info = null;
  if (serverUp) info = await artistInfo(uid);
  const tiers = visibleTiers(info?.tiers);
  const variant = supportVariant({ isOwner: m.owner, uid, serverUp, monetizable: !!info?.monetizable, tierCount: tiers.length, testCatalog: TEST_CATALOG });
  if (!root.querySelector('.ap-body')?.isConnected) return;
  if (variant === 'preview') {
    if (serverUp && info?.monetizable) mountRealPreview(root, uid, m.name, tiers);
    else mountSupportPreview(root, uid, m.name, 'owner');
    return;
  }
  if (variant === 'soon') { mountSupportPreview(root, uid, m.name, 'soon', configured ? PAY_DOWN : ''); return; }
  if (variant === 'none' || variant === 'empty') {
    m.noSupport = true;
    refreshPanels();
    return;
  }
  if (variant === 'real') mountReal(root, uid, m, tiers, h);
}

// Un solo botón en la cabecera del artista; al tocarlo se despliega la sección y la página se desplaza hasta ella.
function attachSupport(root, name, html, label = 'Suscribirme') {
  const body = root.querySelector('.ap-body');
  const actions = root.querySelector('.ap-head .hero-actions');
  if (!body?.isConnected) return;
  body.insertAdjacentHTML('afterbegin', `<section class="ap-sec support-panel" id="ap-support" aria-labelledby="ap-support-t" hidden>
    <header class="sec-head"><h2 class="section-title" id="ap-support-t">Apoyar a ${esc(name)}</h2>
      <button class="btn-icon lit sm" data-action="support-toggle" aria-label="Cerrar opciones de apoyo" title="Cerrar">${icon('close')}</button></header><div class="support-body">${html}</div></section>`);
  actions?.insertAdjacentHTML('beforeend', `<button class="btn-glass lit support-btn" data-action="support-toggle" aria-expanded="false" aria-controls="ap-support" data-press>${icon('heart')}<span class="support-label">${label}</span></button>`);
  // llegó desde "Desbloquear con <Nivel>" o desde "Ver cómo lo ve el público": se abre la sección
  if (app.ui.apOpenSupport) { app.ui.apOpenSupport = false; requestAnimationFrame(() => app.actions['support-toggle']?.()); }
}

// ---------- suscripción SIMULADA (sólo artistas ficticios `sim-*`) ----------
// Estado de prueba: sin importes, sin pantalla de pago y sin cobro. SoundDrop sigue deshabilitado.
const SIM_PERKS = [
  ['Publicaciones exclusivas para Fan', 'Insignia "Fan" en tus respuestas'],
  ['Todo lo de Fan', 'Publicaciones exclusivas para Superfan', 'Tus respuestas primero en los exclusivos'],
  ['Todo lo de Superfan', 'Publicaciones exclusivas para VIP', 'Tus respuestas primero también en sus publicaciones públicas'],
];

const simLabel = (uid) => {
  const t = app.subs?.tier(app.user?.uid, uid) || 0;
  return `${t ? `Suscripto · ${esc(tierName(t))}` : 'Suscribirme'} ${simTag}`;
};

function simSupportHtml(uid) {
  const cur = app.subs?.tier(app.user?.uid, uid) || 0;
  const count = counterDisplay(app.subs?.countFor(uid) || 0, true, { sim: true });
  return `<p class="pay-test sim-note">${simTag} Suscripción simulada: no se cobra nada ni se crea ningún pago.</p>
    <p class="hint sub-count">${esc(count.text)} ${simTag}</p>
    <div class="tiers">${TIER_NAMES.map((n, i) => {
      const t = i + 1, mine = cur === t;
      const btn = mine ? 'Tu nivel (simulado)' : cur ? `Cambiar a ${n} (simulado)` : 'Suscribirme (simulado)';
      return `<div class="tier glass-soft ${i === 1 ? 'featured' : ''} ${mine ? 'current' : ''}">
        ${mine ? `<span class="pill ok">Tu nivel</span>` : i === 1 ? '<span class="pill">Más popular</span>' : ''}
        <h3>${esc(n)}</h3><p class="tier-price"><b>Sin cobro</b> <small class="muted">simulado</small></p>
        <ul class="tier-perks">${SIM_PERKS[i].map((b) => `<li>${icon('check')}${esc(b)}</li>`).join('')}</ul>
        <button class="${mine ? 'btn-glass' : 'btn-primary'} lit" data-action="sub-sim" data-artist="${esc(uid)}" data-tier="${t}" ${mine ? 'aria-pressed="true"' : ''} data-press>${btn}</button></div>`;
    }).join('')}</div>
    ${cur ? `<div class="sim-actions"><button class="btn-glass lit" data-action="sub-sim-cancel" data-artist="${esc(uid)}" data-press>Cancelar suscripción simulada</button></div>` : ''}
    <div class="donate glass-soft"><h3>SoundDrop</h3><p class="hint">Un apoyo único con mensaje. Nunca se simula: requiere el servicio de pagos.</p>
      <button type="button" class="btn-primary lit" disabled aria-disabled="true">Enviar SoundDrop · Próximamente</button></div>`;
}

function mountSupportSim(root, uid, name) {
  attachSupport(root, name, simSupportHtml(uid), simLabel(uid));
}

function refreshSimSupport(uid) {
  const body = document.querySelector('#ap-support .support-body');
  if (body) body.innerHTML = simSupportHtml(uid);
  const label = document.querySelector('.support-btn .support-label');
  if (label) label.innerHTML = simLabel(uid);
  refreshPanels();
}

// ---------- vista previa / vista de prueba / Próximamente (botones siempre deshabilitados) ----------
// kind: 'owner' (el propio artista) · 'test' (perfil am: del catálogo) · 'soon' (artista registrado sin servidor)
export function previewHtml(kind, drafts = null, extra = '') {
  const own = kind !== 'test' && Array.isArray(drafts) ? drafts : [];
  const head = kind === 'test'
    ? '<p class="pay-test">Perfil de prueba: este artista no está registrado en ZUENA y no ofrece suscripciones. Así se vería la sección de apoyo de un artista de ZUENA.</p>'
    : kind === 'owner' ? '<p class="pay-test">Vista previa: así ven tus oyentes esta sección. Editá los niveles en tu Estudio, en Cobros.</p>' : '';
  return `${head}
    <div class="pay-off glass-soft">${icon('lock')}<p>${PAY_OFF}</p></div>
    ${extra ? `<p class="hint pay-down" role="status">${esc(extra)}</p>` : ''}
    <div class="tiers">${[1, 2, 3].map((slot, i) => {
      const t = own[i] || {};
      return `<div class="tier glass-soft ${i === 1 ? 'featured' : ''}">
      ${i === 1 ? '<span class="pill ok">Más popular</span>' : ''}
      <h3>${esc(t.name || REF_TIERS[i])}</h3><p class="tier-price"><b>${formatEUR(referencePrice(t, slot))}</b> / mes · <small class="muted">precio de referencia</small></p>
      ${t.description ? `<p class="hint">${esc(t.description)}</p>` : ''}
      ${perksHtml(slot)}
      <button class="btn-primary lit" disabled aria-disabled="true">Suscribirme · Próximamente</button></div>`;
    }).join('')}</div>
    ${advHint('El 88 % de cada suscripción irá al artista.')}
    <div class="donate glass-soft"><h3>SoundDrop</h3><p class="hint">Un apoyo único con mensaje.</p>
      <div class="donate-presets">${PRESETS.map((c) => `<span class="seg-btn">${formatEUR(c)}</span>`).join('')}</div>
      <button type="button" class="btn-primary lit" disabled aria-disabled="true">Enviar SoundDrop · Próximamente</button></div>`;
}

async function mountSupportPreview(root, uid, name, kind, extra = '') {
  const claim = kind === 'test' ? null : await db.get('claims', uid).catch(() => null);
  if (!root.querySelector('.ap-body')?.isConnected) return;
  attachSupport(root, name, previewHtml(kind, claim?.tierDrafts || null, extra), kind === 'owner' ? 'Ver mi sección de apoyo' : 'Suscribirme');
}

// el dueño con cobros activos: sus niveles reales, sin poder suscribirse
function mountRealPreview(root, uid, name, tiers) {
  const html = `<p class="pay-test">Vista previa: así ven tus oyentes esta sección. Editá los niveles en tu Estudio, en Cobros.</p>
    ${tiers.length ? `<div class="tiers">${tiers.map((t) => tierCard(t, { disabled: true })).join('')}</div>` : '<p class="hint">Publicá al menos un nivel para recibir suscripciones.</p>'}`;
  attachSupport(root, name, html, 'Ver mi sección de apoyo');
}

// ---------- variante real (servidor activo, artista monetizable, niveles publicados) ----------
function tierCard(t, { disabled = false, sub = null } = {}) {
  const closed = t.state === 'closed_to_new';
  const mine = sub && sub.tier?.slot === t.slot;
  let btn;
  if (disabled) btn = '<button class="btn-primary lit" disabled aria-disabled="true">Suscribirme</button>';
  else if (mine) btn = '<span class="pill ok">Tu nivel</span>';
  else if (sub) btn = '<button class="btn-glass lit" disabled aria-disabled="true">Cambiar de nivel · Próximamente</button>';
  else if (closed) btn = '<button class="btn-primary lit" disabled aria-disabled="true">Suscribirme</button>';
  else btn = `<button class="btn-primary lit" data-action="support-subscribe" data-tier="${esc(t.id)}" data-press>Suscribirme</button>`;
  return `<div class="tier glass-soft ${t.slot === 2 ? 'featured' : ''} ${mine ? 'current' : ''}">
    ${closed ? '<span class="pill muted">Cerrado a nuevas altas</span>' : ''}
    <h3>${esc(t.name)}</h3><p class="tier-price"><b>${formatEUR(t.amountCents)}</b> / mes</p>
    ${t.description ? `<p class="hint">${esc(t.description)}</p>` : ''}
    ${perksHtml(t.slot)}
    ${btn}</div>`;
}

async function mountReal(root, uid, m, tiers, h) {
  const subs = await mySubs();
  const sub = subscriptionWith(subs, uid);
  const st = sub ? subStateLabel(sub.state, sub.accessUntil || sub.currentPeriodEnd, sub.tier?.name || '') : subStateLabel(null);
  app.ui.apTiers = tiers;
  app.ui.apSub = sub;
  const count = counterDisplay(m.subscriberCount ?? null, !!m.tierOptions?.showCounter, { serverUp: true });
  const test = h.stripeMode === 'test' ? '<p class="pay-test">Modo de prueba: los pagos no son reales.</p>' : '';
  const status = sub ? `<div class="glass-soft notice ${st.warn ? 'warn' : ''}"><p><b>${esc(sub.tier?.name || '')}</b> · ${esc(st.label)}</p>
      ${sub.state === 'past_due' ? '<p>Hay un problema con tu último pago. Actualizalo para no perder el acceso.</p>' : ''}
      ${sub.state === 'canceling' ? `<p>Tu suscripción se cancela el ${new Date(sub.accessUntil || sub.currentPeriodEnd).toLocaleDateString('es')}. Seguís con acceso hasta entonces.</p>` : ''}
      ${['unpaid', 'canceled', 'refunded'].includes(sub.state) ? '<p>Tu suscripción finalizó.</p>' : ''}
      ${['active', 'canceling', 'past_due'].includes(sub.state) ? `<button class="btn-glass lit" data-action="support-portal" data-sub="${esc(sub.id)}" data-press>Administrar suscripción</button>` : ''}</div>` : '';
  const live = sub && ['active', 'canceling', 'past_due', 'incomplete'].includes(sub.state) ? sub : null;
  attachSupport(root, m.name, `${test}${status}
    ${count ? `<p class="hint sub-count">${esc(count.text)}</p>` : ''}
    <div class="tiers">${tiers.map((t) => tierCard(t, { sub: live })).join('')}</div>
    ${advHint('El 88 % de tu suscripción va al artista.')}
    <form class="donate glass-soft" data-form="donate" data-artist="${esc(uid)}" novalidate>
      <h3>SoundDrop</h3><p class="hint">Un apoyo único.${app.prefs.advanced ? ' El 90 % va al artista.' : ''}</p>
      <div class="donate-presets">${PRESETS.map((c, i) => `<button type="button" class="seg-btn lit ${i === 1 ? 'on' : ''}" data-amount="${c}">${formatEUR(c)}</button>`).join('')}</div>
      <label class="field"><span>Otro importe (€)</span><input class="input" name="amount" inputmode="decimal" placeholder="5,00"></label>
      <label class="field"><span>Mensaje <small class="muted">opcional</small></span><textarea class="input" name="message" maxlength="${MESSAGE_MAX}" rows="2"></textarea></label>
      <label class="check"><input type="checkbox" name="public" checked><span>Mostrar mi apoyo en su feed</span></label>
      <label class="check"><input type="checkbox" name="terms"><span>Confirmo que tengo 18 años o más y acepto los Términos y la Política de reembolsos.</span></label>
      <p class="hint"><span class="link disabled" aria-disabled="true">Términos en preparación</span></p>
      <p class="hint">Los apoyos de más de 100 € se acreditan al artista a los 7 días.</p>
      <p class="field-error" data-donate-error></p>
      <button type="button" class="btn-primary lit" data-action="support-donate" data-press>Enviar SoundDrop</button>
    </form>`, live ? (live.state === 'incomplete' ? 'Suscripción pendiente' : st.header) : 'Suscribirme');
  root.querySelectorAll('.donate-presets [data-amount]').forEach((b) => {
    b.onclick = () => { b.parentElement.querySelectorAll('.on').forEach((x) => x.classList.remove('on')); b.classList.add('on'); b.form.amount.value = ''; };
  });
}

// modal de alta: nivel, precio, renovación y casilla de términos. Sin campos de tarjeta.
async function subscribeFlow(tierId) {
  const m = app.ui.apModel;
  const [, ...rest] = String(app.ui.param || '').split(':');
  const uid = rest.join(':');
  const t = (app.ui.apTiers || []).find((x) => x.id === tierId);
  if (!m || !t) return;
  if (!app.user) { app.toast('Iniciá sesión para suscribirte.'); return; }
  if (!navigator.onLine) { app.toast('Sin conexión. Conectate para suscribirte.'); return; }
  if (!(await app.auth.idToken?.())) { app.toast('Para suscribirte iniciá sesión con una cuenta de Google.'); return; }
  if (app.ui.apSub && ['active', 'canceling', 'past_due'].includes(app.ui.apSub.state)) { app.toast('Ya estás suscripto a este artista. Podés cambiar de nivel.'); return; }
  openModal(`<form class="confirm sub-confirm" novalidate>
      <h3>Suscribirte a ${esc(m.name)}</h3>
      <p class="muted">${esc(t.name)} · ${formatEUR(t.amountCents)} / mes. Se renueva cada mes hasta que canceles. Vas a pagar en una página segura de Stripe; ZUENA no ve ni guarda los datos de tu tarjeta.</p>
      <label class="check"><input type="checkbox" name="terms"><span>Tengo 18 años o más y acepto los Términos y la Política de reembolsos.</span></label>
      <p class="hint"><span class="link disabled" aria-disabled="true">Términos en preparación</span></p>
      <p class="field-error" data-err></p>
      <div class="confirm-actions"><button type="button" class="btn-glass lit" data-modal="cancel">Cancelar</button><button class="btn-primary lit" data-press>Continuar al pago</button></div>
    </form>`, {
    cls: 'sm',
    onMount: (box, close) => {
      const f = box.querySelector('form'), btn = f.querySelector('.btn-primary');
      box.querySelector('[data-modal=cancel]').onclick = close;
      f.onsubmit = async (e) => {
        e.preventDefault();
        if (btn.getAttribute('aria-busy') === 'true') return; // doble clic: una sola redirección
        if (!f.terms.checked) { box.querySelector('[data-err]').textContent = 'Aceptá los Términos y la Política de reembolsos para continuar.'; return; }
        btn.setAttribute('aria-busy', 'true');
        try {
          const { checkoutUrl } = await payments.call('/api/subscribe', { method: 'POST', auth: app.auth, body: { artistId: uid, tierId: t.id, acceptTerms: true, returnUrl: location.origin + location.pathname } });
          if (checkoutUrl) location.href = checkoutUrl;
        } catch (err) {
          btn.removeAttribute('aria-busy');
          box.querySelector('[data-err]').textContent = err.message;
          infoCache.delete(uid);
        }
      };
    },
  });
}

// ---------- efectos de desplazamiento del perfil ----------
// La portada se aleja con paralaje y se desvanece; al pasarla aparece una barra compacta de vidrio con el
// nombre y "Reproducir". Las secciones entran al llegar a ellas. Sólo transform/opacity (barato).
function mountScrollFx(root, m) {
  const ap = root.querySelector('.ap');
  const heroEl = ap?.querySelector('.ap-hero');
  const view = root.closest?.('.view') || document.querySelector('.view');
  if (!ap || !heroEl || !view) return;
  ap.insertAdjacentHTML('afterbegin', `<div class="ap-mini" aria-hidden="true"><b>${esc(m.name)}</b>${tick(m.verified, m.badge)}
    ${m.popular.length ? `<button class="btn-primary lit sm" data-action="artist-play" tabindex="-1">${icon('play')}Reproducir</button>` : ''}</div>`);
  const mini = ap.querySelector('.ap-mini');
  const motion = app.motion;
  // sangrado de color: los tonos de la portada (o de la foto) tiñen la página hacia abajo
  // sin imágenes de perfil, el color sale de la carátula de su canción más popular (sólo color: no se muestra)
  const img = m.cover || m.avatar || (m.popular[0] && app.library.coverUrl(m.popular[0])) || m.shelves?.flatMap((s) => s.items)[0]?.artwork;
  if (img) artColors(img).then((c) => {
    if (!c || !ap.isConnected) return;
    const [a, b] = [c.a || c.b, c.b || c.a];
    if (!a) return;
    ap.style.setProperty('--ap-c1', `rgb(${a.join(' ')})`);
    ap.style.setProperty('--ap-c2', `rgb(${b.join(' ')})`);
    ap.classList.add('ap-tinted');
  });
  const end = () => Math.max(1, (heroEl.offsetHeight || 1) * 0.85);
  // paralaje nativo (ScrollTimeline): el navegador mueve portada, foto y nombre con el scroll, sin JS por fotograma
  const native = motion?.support.scrollTimeline && motion.enabled;
  if (native) {
    ap.classList.add('ap-native-px');
    const range = { start: 0, end: end() };
    motion.parallax(view, ap.querySelector('.ap-cover'), [{ transform: 'none', opacity: 1 }, { transform: 'translate3d(0, 90px, 0) scale(1.08)', opacity: 0.15 }], range);
    motion.parallax(view, ap.querySelector('.ap-photo'), [{ transform: 'none', opacity: 1 }, { transform: 'translate3d(0, 40px, 0) scale(.75)', opacity: 0 }], range);
    motion.parallax(view, ap.querySelector('.ap-v2 .ap-id'), [{ transform: 'none', opacity: 1 }, { transform: 'translate3d(0, -24px, 0)', opacity: 0.1 }], range);
  }
  // la barra compacta sólo necesita saber si se pasó la portada (un listener pasivo, sin escribir estilos por fotograma)
  let raf = 0;
  const update = () => {
    raf = 0;
    if (!ap.isConnected) { view.removeEventListener('scroll', onScroll); return; }
    const p = Math.min(1, Math.max(0, view.scrollTop / end()));
    if (!native) ap.style.setProperty('--p', p.toFixed(3)); // respaldo sin ScrollTimeline
    const on = p >= 0.98;
    if (mini.classList.contains('on') !== on) { mini.classList.toggle('on', on); mini.setAttribute('aria-hidden', String(!on)); mini.querySelector('button')?.setAttribute('tabindex', on ? '0' : '-1'); }
  };
  const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
  view.addEventListener('scroll', onScroll, { passive: true });
  update();
}
async function startCheckout(fn) {
  if (!app.user) { app.toast('Iniciá sesión para apoyar a este artista.'); return; }
  try {
    const { checkoutUrl } = await fn();
    if (checkoutUrl) location.href = checkoutUrl;
  } catch (err) { app.toast(err.message); }
}

// vuelta de Stripe Checkout (§4.4): ?pago=ok no concede nada. Se consulta /me/subscriptions con espera creciente
// (máx. ~60 s) y sólo se avisa el éxito cuando el servidor informa una suscripción con derecho.
async function confirmReturn() {
  app.toast?.('Estamos confirmando tu pago…');
  const before = await mySubs();
  const had = new Set((before || []).filter((s) => s.entitled).map((s) => s.id));
  let wait = 2000, spent = 0;
  while (spent < 60e3) {
    await new Promise((r) => setTimeout(r, wait));
    spent += wait;
    wait = Math.min(wait * 1.6, 15e3);
    const subs = await mySubs();
    const fresh = (subs || []).find((s) => entitledTier([s], s.artistId) && !had.has(s.id));
    if (fresh) { app.toast?.(`Ya sos ${fresh.tier?.name || ''} de ${fresh.artistName || ''}.`); infoCache.clear(); if (app.ui.view === 'artistpage') app.render(); return; }
  }
  app.toast?.('Tu pago se está procesando. Cuando se confirme vas a ver tu suscripción acá.');
}
{
  const ret = new URLSearchParams(location.search).get('pago');
  if (ret) {
    history.replaceState(null, '', location.pathname);
    if (ret === 'ok') setTimeout(() => confirmReturn().catch(() => {}), 1800);
    else setTimeout(() => app.toast?.('No se completó el pago. No se te cobró nada.'), 1800);
  }
}
// al volver a la pestaña se reconsulta el estado de la suscripción (otra pestaña pudo suscribirse)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && app.ui?.view === 'artistpage' && app.ui.apSub !== undefined && payments.configured) { infoCache.clear(); app.render(); }
});

// ---------- detalle de un lanzamiento de Apple Music ----------
export function viewAppleAlbum() {
  const id = app.ui.param;
  app.ui.mount = async (root) => {
    const body = root.querySelector('.amc-body');
    try {
      const tracks = await appleCollection(id, country());
      if (!body?.isConnected) return;
      const t = tracks[0];
      root.querySelector('.amc-head').innerHTML = t ? `<div class="art xl"><img src="${esc(t.artworkLarge || t.artwork)}" alt=""></div>
        <div class="detail-meta"><p class="eyebrow">Apple Music · vistas previas de 30 segundos</p><h1>${esc((t.album || '').replace(/ - (Single|EP)$/i, ''))}</h1>
        <p class="muted">${t.artistId ? `<button class="link" data-action="open-artist" data-id="am:${esc(t.artistId)}">${esc(t.artist)}</button>` : esc(t.artist)}${t.year ? ` · ${esc(t.year)}` : ''} · ${tracks.length} canciones</p>
        <div class="hero-actions"><button class="btn-primary lit" data-action="amc-play">${icon('play')}Reproducir</button>
        ${t.externalUrl ? `<a class="btn-glass lit" href="${esc(t.externalUrl.replace(/\?i=\d+.*/, ''))}" target="_blank" rel="noopener noreferrer">${icon('link')}Abrir en Apple Music</a>` : ''}</div></div>` : '';
      app.ui.amcTracks = tracks;
      body.innerHTML = trackList(tracks, { numbered: true, album: false, empty: 'Este lanzamiento no tiene vistas previas disponibles.' });
      app.afterFill(root);
    } catch {
      if (body?.isConnected) body.innerHTML = '<p class="muted">No se pudo cargar el lanzamiento.</p>';
    }
  };
  return `${backBtn()}<section class="detail-head amc-head"><div class="loading-view"><span class="pulse"></span></div></section><div class="amc-body"></div>`;
}

// ---------- estante de Inicio: los más escuchados del país ----------
export async function topArtistsShelf() {
  const list = await appleTopArtists(country(), 20);
  return list.length ? `<div class="shelf">${list.map((a, i) => `<div class="card artist lit enter" style="--i:${Math.min(i, 10)}" role="button" tabindex="0" data-action="open-artist" data-id="am:${esc(a.id)}" aria-label="${a.rank}. ${esc(a.name)}">
    <div class="card-art"><div class="art round"><img src="${esc(a.artwork)}" alt="" loading="lazy" decoding="async"></div><span class="rank-chip">${a.rank}</span></div>
    <div class="card-title">${esc(a.name)}</div><div class="card-sub">${esc(a.genre || 'Artista')}</div></div>`).join('')}</div>` : '';
}

registerActions({
  'open-artist': (el, e) => { e?.stopPropagation(); app.go('artistpage', el.dataset.id); },
  'artist-retry': () => app.render(),
  'artist-play': () => { const m = app.ui.apModel; if (m) app.playGroup(m.popular, false); },
  'artist-shuffle': () => { const m = app.ui.apModel; if (m) app.playGroup(m.popular, true); },
  'artist-more': (el) => { const more = el.previousElementSibling; more.hidden = !more.hidden; el.textContent = more.hidden ? 'Ver más' : 'Ver menos'; },
  'open-amc': (el) => app.go('amalbum', el.dataset.id),
  'amc-play': () => { if (app.ui.amcTracks?.length) app.playGroup(app.ui.amcTracks, false); },
  'support-toggle': () => {
    const panel = document.getElementById('ap-support');
    if (!panel) return;
    const open = panel.hidden;
    panel.hidden = !open;
    document.querySelectorAll('.support-btn').forEach((b) => b.setAttribute('aria-expanded', String(open)));
    if (open) {
      panel.classList.remove('in');
      requestAnimationFrame(() => panel.classList.add('in'));
      panel.scrollIntoView({ behavior: app.prefs.motion === false ? 'auto' : 'smooth', block: 'start' });
      panel.querySelector('button:not([disabled]), input')?.focus({ preventScroll: true });
    } else document.querySelector('.support-btn')?.focus({ preventScroll: true });
  },
  'ap-tab': (el) => selectTab(el.dataset.tab),
  'ap-posts-more': () => { app.ui.apPostsLimit = (app.ui.apPostsLimit || 10) + 10; refreshPanels(); },
  // Seguir / Siguiendo: un clic a la vez (aria-busy mientras se guarda)
  'ap-follow': async (el) => {
    if (el.getAttribute('aria-busy') === 'true') return;
    el.setAttribute('aria-busy', 'true');
    const on = await followToggle(el.dataset.uid, app.ui.apModel?.name || '');
    el.removeAttribute('aria-busy');
    if (on === null) return;
    el.className = 'btn-glass lit ap-follow';
    el.setAttribute('aria-pressed', String(on));
    el.innerHTML = `${icon(on ? 'check' : 'plus')}<span>${on ? 'Siguiendo' : 'Seguir'}</span>`;
    const cnt = el.parentElement?.querySelector('.ap-fcount');
    if (cnt) {
      const n = Math.max(0, +cnt.dataset.n + (on ? 1 : -1));
      cnt.dataset.n = n;
      cnt.innerHTML = `${n} ${n === 1 ? 'seguidor' : 'seguidores'}${app.ui.apModel?.sim ? simTag : ''}`;
    }
  },
  'sub-sim': async (el) => {
    if (!app.user) { app.toast('Iniciá sesión para suscribirte.'); return; }
    const uid = el.dataset.artist, tier = +el.dataset.tier;
    const name = app.ui.apModel?.name || '';
    const artist = app.posts.author(uid) || (await db.get('profiles', uid).catch(() => null));
    if (!canSubscribeSim(artist)) return;
    const r = await app.subs.subscribe(app.user.uid, artist, tier);
    if (r.result === 'rejected') return;
    if (r.result === 'same') { app.toast(`Ya sos ${tierName(tier)} de ${name} (simulado).`); return; }
    if (r.result === 'new') {
      app.toast(`Te suscribiste a ${name} como ${tierName(tier)} (simulado).`);
      // al suscribirse se sigue automáticamente (dejar de seguir después no cancela)
      if (!app.posts.isFollowing(uid)) {
        try {
          await app.posts.toggleFollow(uid);
          const fb = document.querySelector('.ap-follow');
          if (fb) { fb.className = 'btn-glass lit ap-follow'; fb.setAttribute('aria-pressed', 'true'); fb.innerHTML = `${icon('check')}<span>Siguiendo</span>`; }
          app.charts?.refreshFollowers();
        } catch { /* el seguimiento es opcional */ }
      }
    } else app.toast(`Pasaste a ${tierName(tier)} (simulado).`);
    refreshSimSupport(uid);
  },
  'sub-sim-cancel': async (el) => {
    const uid = el.dataset.artist, name = app.ui.apModel?.name || '';
    if (!(await confirmModal({ title: `¿Cancelar tu suscripción simulada a ${name}?`, text: 'Vas a perder el acceso a su contenido exclusivo.', ok: 'Cancelar suscripción', cancel: 'Volver', danger: true }))) return;
    if (await app.subs.cancel(app.user.uid, uid)) app.toast('Se canceló tu suscripción simulada.');
    refreshSimSupport(uid);
  },
  'support-subscribe': (el) => subscribeFlow(el.dataset.tier),
  'support-portal': async (el) => {
    if (el.getAttribute('aria-busy') === 'true') return;
    el.setAttribute('aria-busy', 'true');
    try { const { url } = await payments.call(`/api/me/subscriptions/${encodeURIComponent(el.dataset.sub)}/portal`, { method: 'POST', auth: app.auth, body: { returnUrl: location.origin + location.pathname } }); if (url) location.href = url; } catch (err) { app.toast(err.message); }
    el.removeAttribute('aria-busy');
  },
  'support-donate': (el, e) => {
    e?.preventDefault();
    const f = el.form;
    const typed = f.amount.value.trim();
    const cents = typed ? parseAmount(typed) : +f.querySelector('.donate-presets .on')?.dataset.amount;
    const msg = f.message.value.trim();
    const err = donationError(cents, msg) || (f.terms.checked ? '' : 'Confirmá que tenés 18 años o más y aceptás los Términos.');
    f.querySelector('[data-donate-error]').textContent = err;
    if (err) return;
    // el servidor exige acceptTerms: true (casilla marcada por la persona)
    startCheckout(() => payments.call('/api/donate', { method: 'POST', auth: app.auth, body: { artistId: f.dataset.artist, amountCents: cents, message: msg, visibility: f.public.checked ? 'public' : 'private', acceptTerms: true, returnUrl: location.origin + location.pathname } }));
  },
});
