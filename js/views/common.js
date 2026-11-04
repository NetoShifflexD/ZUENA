// Piezas de markup compartidas entre vistas.
import { app } from '../app.js';
import { icon } from '../ui/icons.js';
import { esc, fmtTime, quality, hueOf } from '../ui/format.js';
import { EXTERNAL_CATALOG, TEST_CATALOG } from '../config.js';
import { linkArtistNames } from '../data/testArtists.js';

// los contenidos externos que se muestran quedan registrados para poder resolverlos por id
export function see(item) {
  if (item?.kind === 'remote') app.seen.set(item.id, item);
  return item;
}

// en miniaturas (filas, píldoras: ≤ 56 px) la carátula de Apple se pide a 160 px en vez de 600: ~14 veces menos para decodificar
const thumb = (u, cls) => (u && /\b(xs|sm)\b/.test(cls) && u.includes('mzstatic.com') ? u.replace(/\/\d+x\d+(bb)?\./, '/160x160bb.') : u);

export function art(t, cls = '') {
  const url = thumb(app.library.coverUrl(t), cls);
  const ic = t?.type === 'radio' ? 'radio' : t?.type === 'podcast' || t?.type === 'episode' ? 'mic' : 'music';
  const h = `--h:${hueOf((t && (t.album || t.title)) || 'zuena')}`;
  if (url) {
    // si la carátula no carga, se reemplaza por el marcador con ícono (mismo degradado que sin portada)
    const fb = `<div class="art ph ${cls}" style="${h}">${icon(ic)}</div>`;
    return `<div class="art ${cls}" data-fallback="${esc(fb)}"><img src="${esc(url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.parentNode.outerHTML=this.parentNode.dataset.fallback"></div>`;
  }
  return `<div class="art ph ${cls}" style="${h}">${icon(ic)}</div>`;
}

export function avatar(p, cls = '') {
  const url = p?.avatar;
  if (url) return `<div class="avatar ${cls}"><img src="${esc(url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></div>`;
  const ch = (p?.displayName || p?.name || '?').trim().charAt(0).toUpperCase();
  return `<div class="avatar ph ${cls}" style="--h:${hueOf(p?.uid || p?.id || 'x')}"><span>${esc(ch)}</span></div>`;
}

export const tick = (on, title = 'Verificado') => (on ? `<span class="tick" title="${title}">${icon('verified')}</span>` : '');

// Insignias personalizadas de rol: Equipo de Zuena (exclusivo), Dueño y Administración.
export function roleBadges(entity, { compact = false } = {}) {
  if (!entity) return '';
  const uid = String(entity.uid || '');
  const username = String(entity.username || '').toLowerCase();
  const isTeam = Boolean(entity.isOfficialTeam || uid === 'zuena-official' || username === 'zuena');
  const isOwner = Boolean(entity.isOwnerProfile || uid === 'bf3b1550-da87-4443-a8ba-0ae542fed5dd' || (app.auth?.isOwner && uid && uid === app.user?.uid));
  const isAdmin = Boolean(entity.isAdminProfile || isOwner || isTeam);
  const pills = [];
  if (isTeam) {
    pills.push(`<span class="z-badge z-badge-team${compact ? ' sm' : ''}" title="Perfil exclusivo oficial del Equipo de ZUENA"><span class="z-badge-logo" aria-hidden="true">Z</span><span>Equipo de Zuena</span></span>`);
  }
  if (isOwner) {
    pills.push(`<span class="z-badge z-badge-owner${compact ? ' sm' : ''}" title="Dueño y fundador de ZUENA">${icon('crown', 'z-badge-ico')}<span>Dueño</span></span>`);
  }
  if (isAdmin) {
    pills.push(`<span class="z-badge z-badge-admin${compact ? ' sm' : ''}" title="Permisos de administración">${icon('shield', 'z-badge-ico')}<span>Administración</span></span>`);
  }
  return pills.length ? `<span class="z-badges${compact ? ' sm' : ''}">${pills.join('')}</span>` : '';
}

export function playlistArt(p, cls = '') {
  if (p.cover) return `<div class="art ${cls}"><img src="${esc(p.cover)}" alt="" loading="lazy" decoding="async"></div>`;
  if (p.system === 'likes') return `<div class="art likes ${cls}">${icon('heartFill')}</div>`;
  const tracks = p.trackIds.map((id) => app.resolve(id)).filter((t) => t && app.library.coverUrl(t)).slice(0, 4);
  if (tracks.length >= 4) return `<div class="art mosaic ${cls}">${tracks.map((t) => `<img src="${esc(thumb(app.library.coverUrl(t), cls))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`).join('')}</div>`;
  if (tracks.length) return art(tracks[0], cls);
  return `<div class="art ph ${cls}" style="--h:${hueOf(p.id)}">${icon('playlist')}</div>`;
}

const stagger = (i) => `style="--i:${Math.min(i, 18)}"`;

export function listKey(tracks, ctx = {}) {
  app.ui.lists.push({ tracks, ctx });
  return app.ui.lists.length - 1;
}

export function sourceBadge(t) {
  if (t.kind !== 'remote') {
    const q = quality(t);
    return t.lossless ? `<span class="badge ${q.hi ? 'hi' : ''}">${q.hi ? 'Hi-Res' : 'Lossless'}</span>` : '';
  }
  if (t.live) return '<span class="badge live">En vivo</span>';
  if (t.preview) return '<span class="badge">Vista previa</span>';
  if (t.type === 'episode') return '<span class="badge">Episodio</span>';
  return '';
}

// el nombre del artista lleva a su perfil sólo si lo tiene: artistas de ZUENA o del catálogo de prueba
function artistLink(t) {
  const name = esc(t.artist || 'Artista desconocido');
  if (t.source === 'zuena' && t.uid) return `<button class="row-sub link-sub" data-action="open-artist" data-id="zu:${esc(t.uid)}">${name}</button>`;
  if (TEST_CATALOG && t.artist) {
    const linked = linkArtistNames(t.artist, esc, 'link-sub-in');
    if (linked.includes('<button')) return `<div class="row-sub">${linked}</div>`;
  }
  if (EXTERNAL_CATALOG && t.source === 'audius' && t.artistId) return `<button class="row-sub link-sub" data-action="creator" data-id="${esc(t.artistId)}">${name}${tick(t.verified)}</button>`;
  if (EXTERNAL_CATALOG && t.source === 'apple' && t.artistId) return `<button class="row-sub link-sub" data-action="open-artist" data-id="am:${esc(t.artistId)}">${name}</button>`;
  return `<div class="row-sub">${name}</div>`;
}

function rowHtml(t, i, key, { numbered, album, playlistId }) {
  const liked = app.playlists.isLiked(t.id);
  const dur = t.live ? '' : t.duration ? fmtTime(t.duration) : '—';
  return `<div class="row lit enter ${t.unplayable ? 'broken' : ''}" ${stagger(i)} role="button" tabindex="0" aria-label="${esc(`${t.title}, ${t.artist || 'artista desconocido'}`)}" data-action="play" data-list="${key}" data-index="${i}" data-id="${esc(t.id)}" ${playlistId ? 'draggable="true"' : ''}>
      <div class="row-lead">${numbered ? `<span class="row-num">${numbered === 'index' ? i + 1 : t.track || i + 1}</span>` : art(t, 'xs')}<span class="bars"><i></i><i></i><i></i></span></div>
      <div class="row-main"><div class="row-title">${esc(t.title)}</div>${artistLink(t)}</div>
      ${album ? `<div class="row-album">${esc(t.album || '')}</div>` : ''}
      <div class="row-q">${sourceBadge(t)}</div>
      <button class="row-like ${liked ? 'on' : ''}" data-action="like" data-id="${esc(t.id)}" aria-pressed="${liked}" aria-label="${liked ? 'Quitar de Me gusta' : 'Me gusta'}" title="${liked ? 'Quitar de Me gusta' : 'Me gusta'}">${icon(liked ? 'heartFill' : 'heart')}</button>
      <div class="row-dur">${dur}</div>
      <button class="row-more" data-action="row-menu" data-list="${key}" data-index="${i}" aria-label="Más opciones para ${esc(t.title)}" title="Más opciones">${icon('more')}</button>
    </div>`;
}

// Listas largas: las primeras filas se muestran al instante y el resto se agrega por tandas
// en momentos libres del navegador, sin bloquear la interfaz.
const FIRST = 60, CHUNK = 40;

export function trackList(tracks, { numbered = false, album = true, playlistId = null, empty = 'No hay canciones.' } = {}) {
  if (!tracks.length) return `<p class="muted pad">${empty}</p>`;
  tracks.forEach(see);
  const key = listKey(tracks, { playlistId });
  const opts = { numbered, album, playlistId };
  if (tracks.length > FIRST) app.ui.chunks.push({ key, tracks, from: FIRST, opts });
  return `<div class="tracks ${album ? '' : 'no-album'}" data-key="${key}" ${playlistId ? `data-playlist="${esc(playlistId)}"` : ''}>${tracks.slice(0, FIRST).map((t, i) => rowHtml(t, i, key, opts)).join('')}</div>`;
}

export function flushChunks(root) {
  const pending = app.ui.chunks.splice(0);
  const idle = window.requestIdleCallback || ((fn) => setTimeout(() => fn({ timeRemaining: () => 8 }), 16));
  for (const job of pending) {
    // tandas chicas mientras el navegador tenga tiempo libre en este fotograma (sin tareas largas)
    const step = (deadline) => {
      const box = root.querySelector(`.tracks[data-key="${job.key}"]`);
      if (!box?.isConnected || app.ui.lists[job.key]?.tracks !== job.tracks) return;
      do {
        const to = Math.min(job.tracks.length, job.from + CHUNK);
        box.insertAdjacentHTML('beforeend', job.tracks.slice(job.from, to).map((t, k) => rowHtml(t, job.from + k, job.key, job.opts)).join(''));
        job.from = to;
      } while (job.from < job.tracks.length && deadline?.timeRemaining?.() > 6);
      app.markCurrent?.();
      if (job.from < job.tracks.length) idle(step, { timeout: 500 });
    };
    idle(step, { timeout: 300 });
  }
}

export function albumCard(a, i = 0) {
  return `<div class="card lit enter" ${stagger(i)} data-action="album" data-key="${a.key}">
    <div class="card-art">${art(a.cover || a.tracks[0])}<button class="card-play" data-action="play-album" data-key="${a.key}" title="Reproducir">${icon('play')}</button></div>
    <div class="card-title">${esc(a.title)}</div><div class="card-sub">${esc(a.artist)}${a.year ? ` · ${esc(a.year)}` : ''}</div>
  </div>`;
}

export function artistCard(ar, i = 0) {
  return `<div class="card artist lit enter" ${stagger(i)} data-action="artist" data-name="${esc(ar.name)}">
    <div class="card-art round">${art(ar.cover || ar.tracks[0])}</div>
    <div class="card-title">${esc(ar.name)}</div><div class="card-sub">${ar.tracks.length} canciones</div>
  </div>`;
}

export function playlistCard(p, i = 0) {
  return `<div class="card lit enter" ${stagger(i)} data-action="playlist" data-id="${esc(p.id)}">
    <div class="card-art">${playlistArt(p)}<button class="card-play" data-action="play-playlist" data-id="${esc(p.id)}" title="Reproducir">${icon('play')}</button></div>
    <div class="card-title">${esc(p.name)}</div><div class="card-sub">${p.trackIds.length} canciones</div>
  </div>`;
}

// tarjeta para una canción externa suelta: reproduce la fila completa a partir de ella
export function mediaCard(item, key, i = 0, cls = '') {
  see(item);
  const round = item.type === 'radio' ? 'radio-art' : '';
  return `<div class="card lit enter ${cls}" ${stagger(i)} data-action="play" data-list="${key}" data-index="${i}" data-id="${esc(item.id)}">
    <div class="card-art ${round}">${art(item)}<span class="card-play as-btn">${icon('play')}</span>${item.live ? '<span class="live-dot">En vivo</span>' : ''}</div>
    <div class="card-title">${esc(item.title)}</div>
    <div class="card-sub">${esc(item.artist || '')}${tick(item.verified)}</div>
  </div>`;
}

export function podcastCard(p, i = 0) {
  see(p);
  return `<div class="card lit enter" ${stagger(i)} data-action="podcast" data-id="${esc(String(p.collectionId))}">
    <div class="card-art">${art(p)}</div>
    <div class="card-title">${esc(p.title)}</div><div class="card-sub">${esc(p.artist)}</div>
  </div>`;
}

export function creatorCard(u, i = 0) {
  return `<div class="card artist lit enter" ${stagger(i)} data-action="creator" data-id="${esc(u.id)}">
    <div class="card-art round">${u.avatar ? `<div class="art"><img src="${esc(u.avatar)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></div>` : art(null)}</div>
    <div class="card-title">${esc(u.name)}${tick(u.verified)}</div><div class="card-sub">${u.followers ? `${compact(u.followers)} seguidores` : 'Artista'}</div>
  </div>`;
}

export function compact(n) {
  return new Intl.NumberFormat('es', { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0);
}

export const backBtn = () => `<button class="btn-back lit" data-action="back">${icon('chevronLeft')}<span>Volver</span></button>`;

export function totalTime(tracks) {
  const s = tracks.reduce((a, t) => a + (t.duration || 0), 0);
  return s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.round(s / 60)} min`;
}

export const statusPill = (st) => `<span class="pill ${st.tone}">${st.label}</span>`;

export function fieldError(errors, key) {
  return errors?.[key] ? `<span class="field-error">${esc(errors[key])}</span>` : '';
}

// data-enh: el esqueleto no lleva flechas (se reemplaza enseguida); así no fuerza un maquetado por estante al montar
export function skeletonRow(n = 6) {
  return `<div class="shelf" data-enh="skel">${Array.from({ length: n }, () => '<div class="card skeleton"><div class="card-art"><div class="art"></div></div><div class="sk-line"></div><div class="sk-line short"></div></div>').join('')}</div>`;
}
