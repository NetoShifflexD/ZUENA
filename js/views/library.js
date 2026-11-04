// Vistas de la biblioteca: canciones, álbumes, artistas y playlists (con pestañas), más el editor y el menú de canciones.
import { app, registerActions } from '../app.js';
import { icon } from '../ui/icons.js';
import { esc, quality } from '../ui/format.js';
import { openModal, confirmModal } from '../ui/modal.js';
import { openMenu } from '../ui/menu.js';
import { processImage } from '../data/profiles.js';
import { art, avatar, trackList, albumCard, artistCard, playlistCard, playlistArt, backBtn, totalTime } from './common.js';

function feature(ic, title, text, i) {
  return `<div class="feature glass-soft lit enter" style="--i:${i}">${icon(ic)}<h3>${title}</h3><p>${text}</p></div>`;
}

export function libTabs(active) {
  const tabs = [['songs', 'Canciones'], ['albums', 'Álbumes'], ['artists', 'Artistas'], ['playlists', 'Playlists']];
  return `<header class="page-head enter"><h1>Biblioteca</h1>
    <div class="lib-tabs">${tabs.map(([v, l]) => `<button class="lib-tab lit ${active === v ? 'on' : ''}" data-action="nav" data-view="${v}">${l}</button>`).join('')}</div></header>`;
}

export function emptyState() {
  return `<section class="empty">
    <h1 class="enter" style="--i:1">Tu biblioteca está vacía</h1>
    <p class="muted enter" style="--i:2">Arrastrá archivos o carpetas a la ventana. ZUENA lee FLAC, ALAC, WAV, MP3, AAC, Opus y Ogg y los reproduce sin cortes entre canciones.</p>
    <div class="hero-actions center enter" style="--i:3">
      <button class="btn-primary lit" data-action="import-files">${icon('plus')}Agregar archivos</button>
      <button class="btn-glass lit" data-action="import-folder">${icon('folder')}Importar carpeta</button>
    </div>
    <div class="feature-grid">
      ${feature('wave', 'Sin cortes', 'Los discos suenan como fueron pensados, sin silencios entre canciones.', 4)}
      ${feature('sparkle', 'Volumen parejo', 'Todo suena al mismo nivel sin aplastar la música.', 5)}
      ${feature('headphones', 'Audio espacial', 'Sonido envolvente en auriculares, con cualquier canción.', 6)}
      ${feature('playlist', 'Tus playlists', 'Mezclá tus archivos con la música publicada en ZUENA.', 7)}
    </div>
  </section>`;
}

export function viewSongs() {
  if (!app.library.tracks.length) return libTabs('songs') + emptyState();
  return `${libTabs('songs')}<div class="hero-actions pad-b">
      <button class="btn-primary lit" data-action="play-all">${icon('play')}Reproducir</button>
      <button class="btn-glass lit" data-action="shuffle-all">${icon('shuffle')}Aleatorio</button></div>
    ${trackList(app.library.tracks)}`;
}

export function viewAlbums() {
  if (!app.library.tracks.length) return libTabs('albums') + emptyState();
  return `${libTabs('albums')}<div class="grid">${app.library.derive().albums.map(albumCard).join('')}</div>`;
}
export function viewAlbum() {
  const a = app.library.derive().albumMap.get(app.ui.param);
  if (!a) return viewAlbums();
  const best = a.tracks.map(quality).sort((x, y) => (y.hi - x.hi) || (y.label.length - x.label.length))[0];
  const lossless = a.tracks.every((t) => t.lossless);
  return `${backBtn()}
    <section class="detail-head enter">
      ${art(a.cover || a.tracks[0], 'xl')}
      <div class="detail-meta">
        <p class="eyebrow">Álbum</p>
        <h1>${esc(a.title)}</h1>
        <button class="link" data-action="artist" data-name="${esc(a.tracks[0].artist || a.artist)}">${esc(a.artist)}</button>
        <p class="muted">${[a.year, `${a.tracks.length} canciones`, totalTime(a.tracks)].filter(Boolean).join(' · ')}</p>
        ${lossless ? `<span class="badge big ${best.hi ? 'hi' : ''}">${best.label}</span>` : ''}
        <div class="hero-actions">
          <button class="btn-primary lit" data-action="play-album" data-key="${a.key}">${icon('play')}Reproducir</button>
          <button class="btn-glass lit" data-action="shuffle-album" data-key="${a.key}">${icon('shuffle')}Aleatorio</button>
        </div>
      </div>
    </section>
    ${trackList(a.tracks, { numbered: true, album: false })}`;
}

export function viewArtists() {
  if (!app.library.tracks.length) return libTabs('artists') + emptyState();
  return `${libTabs('artists')}
    <div class="grid">${app.library.derive().artists.map(artistCard).join('')}</div>`;
}

export function viewArtist() {
  const d = app.library.derive();
  const ar = d.artistMap.get(app.ui.param);
  if (!ar) return viewArtists();
  const albums = [...ar.albums].map((k) => d.albumMap.get(k)).filter(Boolean);
  return `${backBtn()}
    <section class="detail-head enter">
      ${art(ar.cover || ar.tracks[0], 'xl round')}
      <div class="detail-meta">
        <p class="eyebrow">Artista</p>
        <h1>${esc(ar.name)}</h1>
        <p class="muted">${ar.tracks.length} canciones · ${albums.length} álbumes</p>
        <div class="hero-actions">
          <button class="btn-primary lit" data-action="play-artist" data-name="${esc(ar.name)}">${icon('play')}Reproducir</button>
          <button class="btn-glass lit" data-action="shuffle-artist" data-name="${esc(ar.name)}">${icon('shuffle')}Aleatorio</button>
        </div>
      </div>
    </section>
    <h2 class="section-title">Álbumes</h2>
    <div class="shelf">${albums.map(albumCard).join('')}</div>
    <h2 class="section-title">Canciones</h2>
    ${trackList(ar.tracks)}`;
}

export function playlistTracks(p) {
  // no disponibles (lanzamiento oculto/retirado, música privada de otra cuenta): se omiten sin error
  return p.trackIds.map((id) => app.resolve(id)).filter((t) => t && (t.kind === 'remote' || app.isAvailable(t)));
}

export function viewPlaylists() {
  const lists = app.playlists.list;
  return `${libTabs('playlists')}<div class="hero-actions pad-b"><button class="btn-primary lit" data-action="new-playlist">${icon('plus')}Nueva playlist</button></div>
    <div class="grid">${lists.map(playlistCard).join('')}</div>`;
}

export function viewPlaylist() {
  const p = app.playlists.get(app.ui.param);
  if (!p) return viewPlaylists();
  const tracks = playlistTracks(p);
  const isLikes = p.system === 'likes';
  return `${backBtn()}
    <section class="detail-head enter">
      ${playlistArt(p, 'xl')}
      <div class="detail-meta">
        <p class="eyebrow">${isLikes ? 'Colección' : 'Playlist'}</p>
        <h1>${esc(p.name)}</h1>
        ${p.description ? `<p class="detail-desc">${esc(p.description)}</p>` : ''}
        <p class="muted owner-line">${avatar(app.profile, 'xs')}${esc(app.profile?.displayName || '')} · ${tracks.length} canciones${tracks.length ? ` · ${totalTime(tracks)}` : ''}</p>
        <div class="hero-actions">
          <button class="btn-primary lit" data-action="play-playlist" data-id="${esc(p.id)}" ${tracks.length ? '' : 'disabled'}>${icon('play')}Reproducir</button>
          <button class="btn-glass lit" data-action="shuffle-playlist" data-id="${esc(p.id)}" ${tracks.length ? '' : 'disabled'}>${icon('shuffle')}Aleatorio</button>
          ${isLikes ? '' : `<button class="btn-icon lit" data-action="edit-playlist" data-id="${esc(p.id)}" title="Editar">${icon('edit')}</button>
          <button class="btn-icon lit" data-action="delete-playlist" data-id="${esc(p.id)}" title="Eliminar">${icon('trash')}</button>`}
        </div>
      </div>
    </section>
    ${tracks.length > 1 && !isLikes ? '<p class="hint pad-x">Arrastrá las canciones para reordenarlas.</p>' : ''}
    ${trackList(tracks, { numbered: 'index', playlistId: p.id, empty: isLikes ? 'Tocá el corazón de cualquier canción para guardarla acá.' : 'Agregá canciones con clic derecho → “Agregar a playlist”.' })}`;
}

// ---------- editor de playlist ----------

export function playlistEditor(existing = null, trackIds = []) {
  const p = existing || { name: '', description: '', cover: null };
  let cover = p.cover;
  openModal(`
    <form class="pl-editor">
      <h3>${existing ? 'Editar playlist' : 'Nueva playlist'}</h3>
      <div class="pl-editor-grid">
        <label class="pl-cover lit" title="Cambiar portada">
          <div class="pl-cover-img">${cover ? `<img src="${esc(cover)}" alt="" loading="lazy" decoding="async">` : icon('playlist')}</div>
          <span class="pl-cover-hint">${icon('camera')}Portada</span>
          <input type="file" accept="image/*" hidden name="cover">
        </label>
        <div class="pl-fields">
          <label class="field"><span>Nombre</span>
            <div class="input-row">
            <input class="input" name="name" maxlength="60" required placeholder="Mi playlist" value="${esc(p.name)}"></div></label>
          <label class="field"><span>Descripción</span><textarea class="input" name="description" rows="3" maxlength="300" placeholder="Opcional">${esc(p.description)}</textarea></label>
        </div>
      </div>
      <div class="confirm-actions">
        ${cover ? '<button type="button" class="btn-glass lit" data-clear-cover>Quitar portada</button>' : ''}
        <button type="button" class="btn-glass lit" data-cancel>Cancelar</button>
        <button class="btn-primary lit">${existing ? 'Guardar' : 'Crear'}</button>
      </div>
    </form>`, {
    onMount: (m, close) => {
      const form = m.querySelector('form');
      const box = m.querySelector('.pl-cover-img');
      const paint = () => { box.innerHTML = cover ? `<img src="${esc(cover)}" alt="">` : icon('playlist'); };
      form.cover.onchange = async () => {
        const f = form.cover.files[0];
        if (!f) return;
        try { cover = await processImage(f, 600, 600); paint(); } catch (err) { app.toast(err.message); }
      };
      m.querySelector('[data-clear-cover]')?.addEventListener('click', () => { cover = null; paint(); });
      m.querySelector('[data-cancel]').onclick = close;
      form.onsubmit = async (e) => {
        e.preventDefault();
        const data = { name: form.name.value.trim() || 'Nueva playlist', description: form.description.value.trim(), cover };
        if (existing) { await app.playlists.update(existing.id, data); app.toast('Playlist actualizada'); }
        else {
          const created = await app.playlists.create({ ...data, trackIds });
          app.toast(trackIds.length ? `“${created.name}” creada con ${trackIds.length} canción${trackIds.length > 1 ? 'es' : ''}` : `“${created.name}” creada`);
          if (!trackIds.length) app.go('playlist', created.id);
        }
        close();
      };
    },
  });
}

// ---------- menú contextual de canciones ----------

export function trackMenu(x, y, t, ctx = {}, index = -1) {
  const lists = app.playlists.mine;
  const items = [
    { label: 'Reproducir a continuación', icon: 'next', run: () => { app.player.playNext(t); app.toast(`“${t.title}” suena a continuación`); } },
    { label: 'Agregar a la cola', icon: 'queue', run: () => { app.player.addToQueue(t); app.toast('Agregada a la cola'); } },
    {
      label: 'Agregar a playlist', icon: 'playlist', sub: [
        { label: 'Nueva playlist…', icon: 'plus', run: () => playlistEditor(null, [t.id]) },
        ...(lists.length ? ['-'] : []),
        ...lists.map((p) => ({ label: p.name, run: async () => {
          app.catalog.remember(t);
          const n = await app.playlists.add(p.id, [t.id]);
          app.toast(n ? `Agregada a “${p.name}”` : `Ya estaba en “${p.name}”`);
        } })),
      ],
    },
    { label: app.playlists.isLiked(t.id) ? 'Quitar de Me gusta' : 'Me gusta', icon: 'heart', run: () => app.actions.like({ dataset: { id: t.id } }) },
    '-',
    ...(t.kind === 'remote' ? [
      ...(t.source === 'audius' && t.artistId ? [{ label: 'Ir al artista', icon: 'mic', run: () => app.go('creator', t.artistId) }] : []),
      ...(t.type === 'episode' && t.showId ? [{ label: 'Ir al podcast', icon: 'mic', run: () => app.go('podcast', String(t.showId)) }] : []),
      ...(t.externalUrl ? [{ label: t.preview ? 'Escuchar completa en Apple Music' : 'Abrir en la fuente', icon: 'link', run: () => window.open(t.externalUrl, '_blank', 'noopener') }] : []),
    ] : [
      { label: 'Ir al álbum', icon: 'album', run: () => app.go('album', `${encodeURIComponent(t.albumArtist || t.artist || 'Artista desconocido')}|${encodeURIComponent(t.album || 'Sin álbum')}`) },
      { label: 'Ir al artista', icon: 'mic', run: () => app.go('artist', t.artist || 'Artista desconocido') },
    ]),
    ...(app.artist.verified ? [{ label: 'Compartir en el feed', icon: 'edit', run: () => app.shareToFeed(t) }] : []),
  ];
  if (ctx.playlistId && index >= 0) {
    const p = app.playlists.get(ctx.playlistId);
    items.push('-', { label: `Quitar de “${p?.name}”`, icon: 'close', run: () => app.playlists.removeAt(ctx.playlistId, p.trackIds.indexOf(t.id)) });
  }
  if (t.kind !== 'remote') items.push({ label: 'Eliminar de la biblioteca', icon: 'trash', danger: true, run: async () => {
    if (await confirmModal({ title: '¿Eliminar de la biblioteca?', text: `“${esc(t.title)}” se quita de ZUENA y de tus playlists. El archivo original no se toca.`, ok: 'Eliminar', danger: true })) {
      await app.library.remove(t.id);
      app.toast('Canción eliminada');
    }
  } });
  openMenu(x, y, items);
}

registerActions({
  'new-playlist': () => playlistEditor(),
  playlist: (el) => app.go('playlist', el.dataset.id),
  'play-playlist': (el) => app.playGroup(playlistTracks(app.playlists.get(el.dataset.id) || { trackIds: [] }), false),
  'shuffle-playlist': (el) => app.playGroup(playlistTracks(app.playlists.get(el.dataset.id) || { trackIds: [] }), true),
  'edit-playlist': (el) => playlistEditor(app.playlists.get(el.dataset.id)),
  'delete-playlist': async (el) => {
    const p = app.playlists.get(el.dataset.id);
    if (!p) return;
    if (await confirmModal({ title: '¿Eliminar playlist?', text: `Se borra “${esc(p.name)}”. Las canciones siguen en tu biblioteca.`, ok: 'Eliminar', danger: true })) {
      await app.playlists.remove(p.id);
      app.go('playlists');
      app.toast('Playlist eliminada');
    }
  },
  like: async (el) => {
    const t = app.resolve(el.dataset.id);
    if (!t) return;
    app.catalog.remember(t);
    const liked = await app.playlists.toggleLike(t.id);
    app.taste.signal(t, liked ? 'like' : 'unlike');
    app.toast(liked ? 'Agregada a Me gusta' : 'Quitada de Me gusta');
  },
  'row-menu': (el, e) => {
    const entry = app.ui.lists[+el.dataset.list];
    const t = entry?.tracks[+el.dataset.index];
    if (!t) return;
    const r = el.getBoundingClientRect();
    trackMenu(r.left - 180, r.bottom + 4, t, entry.ctx, +el.dataset.index);
    e.stopPropagation();
  },
});
