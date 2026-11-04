// Feed v4 (2026-11-02) con la estética Prisma: tarjetas de vidrio, fila "Ahora en ZUENA", pestañas
// "Para vos" / "Siguiendo" / "Estrenos" con indicador deslizante y ranking con afinidad y variedad de autores.
// Base estilo X: composer con contador circular,
// respuestas en hilo (vista de publicación), reposts, me gusta, compartir, hashtags, tendencias y
// "a quién seguir". Lo que publica el simulador (js/sim/simulator.js) no re-dibuja la lista: aparece el
// aviso "Ver N publicaciones nuevas" y los contadores se actualizan en su lugar.
import { app, registerActions } from '../app.js';
import { icon } from '../ui/icons.js';
import { esc } from '../ui/format.js';
import { confirmModal } from '../ui/modal.js';
import { openMenu } from '../ui/menu.js';
import { POST_MAX, richText, timeAgo, mixCatalog } from '../data/posts.js';
import { isLive, isUpcoming, countdown, premiereLabel } from '../data/releases.js';
import { tierOf, tierName, canView } from '../data/subs.js';
import { TEST_CATALOG } from '../config.js';
import { avatar, art, tick, listKey, see, backBtn } from './common.js';
import { regionalTopHtml, mountRegionalTop } from './regionalTop.js';
import { cloudTracks, loadMyTracks } from './cloudUpload.js';
export { mountRegionalTop, renderRegionalTop } from './regionalTop.js';

// Eventos de catálogo (kind:'catalog'): tarjeta del sistema "Nuevo lanzamiento: …" con datos reales de Apple
// Music, sin tilde, sin @usuario y con el pie rotulado. Exclusivos (audience 'tier:n', sólo simulados sin
// servidor): sin derecho se dibuja una tarjeta bloqueada que NO lleva el texto real en el DOM.
const PAGE = 40;
const FIRST_CARDS = 10; // tarjetas del primer pintado (el resto llega en la tarea siguiente)
const FEED_TABS = [['foryou', 'Para vos'], ['following', 'Siguiendo'], ['releases', 'Estrenos']];
const KIND_LABEL = { single: 'Single', ep: 'EP', album: 'Álbum' };
const RING = 2 * Math.PI * 9; // circunferencia del contador circular (r = 9)

// ---------- composer ----------
export function composer({ replyTo = null, placeholder } = {}) {
  const p = app.profile;
  const parent = replyTo && app.posts.get(replyTo);
  const nube = !replyTo && app.posts.canCloudPost(p);
  if (!replyTo && !nube && app.posts.cloudUser) return '<div class="fx-reader-note"><b>La voz de tus artistas</b><p>Seguí a quienes te gustan y dejá Me gusta. Para publicar y subir música, elegí el tipo de cuenta Artista en tu perfil.</p></div>';
  if (!replyTo && !nube && (!app.artist.verified || p?.role !== 'artist')) return '<div class="fx-reader-note"><b>La voz de tus artistas</b><p>Seguí sus novedades, dejá Me gusta y compartí sus publicaciones. Los suscriptores pueden comentar.</p></div>';
  if (replyTo) {
    const access = app.posts.commentAccess(p, parent);
    if (!access.ok) return `<p class="fx-reader-note" role="status">${esc(access.message)}</p>`;
  }
  const cur = app.player.current;
  return `<form class="composer fx-composer community-composer ${replyTo ? 'reply' : ''}" data-form="post" ${replyTo ? `data-reply="${esc(replyTo)}"` : ''}>
    ${avatar(p, 'md')}
    <div class="composer-main">
      <p class="community-composer-title">${replyTo ? 'Sumate a la conversación' : 'Una novedad para tu comunidad'}</p>
      <textarea class="composer-input" name="text" aria-label="${replyTo ? 'Escribir una respuesta' : 'Escribir una publicación'}" maxlength="${POST_MAX}" rows="${replyTo ? 1 : 2}" placeholder="${esc(placeholder || (replyTo ? 'Publicá tu respuesta' : '¿Qué está pasando con tu música?'))}"></textarea>
      <div class="composer-bar">
        <div class="composer-tools">
          ${replyTo && app.posts.commentAccess(p, parent, true).ok ? '<label class="check"><input type="checkbox" name="superComment"><span>Supercomentario · VIP</span></label>' : ''}
          ${nube ? cloudTools() : ''}
          ${cur && !replyTo && !nube ? `<label class="attach-toggle lit" title="Adjuntar lo que está sonando"><input type="checkbox" name="attach"><span>${icon('music')}<span class="attach-label">${esc(cur.title)}</span></span></label>` : ''}
          ${app.artist.verified && !replyTo && !nube ? `<select class="select lit composer-audience" name="audience" aria-label="Quién puede verla" title="Las publicaciones exclusivas requieren el servicio de pagos.">
            <option value="public">Público</option>
            ${['Fan', 'Superfan', 'VIP'].map((n) => `<option disabled>${n} o superior · Requiere el servicio de pagos.</option>`).join('')}</select>` : ''}
        </div>
        <span class="composer-ring" aria-hidden="true"><svg viewBox="0 0 22 22"><circle cx="11" cy="11" r="9" class="bg"/><circle cx="11" cy="11" r="9" class="fg" style="stroke-dasharray:${RING};stroke-dashoffset:${RING}"/></svg><b data-count hidden></b></span>
        <button class="btn-primary lit" data-submit disabled>${replyTo ? 'Responder' : 'Publicar'}</button>
      </div>
    </div>
  </form>`;
}

// herramientas del composer en la nube: adjuntar una canción propia pública y subir una nueva
function cloudTools() {
  if (cloudTracks.uid !== app.posts.cloudUser) loadMyTracks().then((l) => { if (l.length && app.ui.view === 'feed') app.render(); });
  const pub = cloudTracks.list.filter((t) => t.visibility === 'public');
  return `<button type="button" class="btn-glass lit sm" data-action="cloud-upload">${icon('upload')}Subir canción</button>
    ${pub.length ? `<select class="select lit composer-audience" name="cloudTrack" aria-label="Adjuntar una canción"><option value="">Sin canción</option>${pub.map((t) => `<option value="${esc(t.cloudId)}">${esc(t.title)}</option>`).join('')}</select>` : ''}`;
}

export function bindComposer(root) {
  mountRegionalTop(root);
  root.querySelectorAll('[data-form=post]').forEach((form) => {
    const ta = form.text;
    const btn = form.querySelector('[data-submit]');
    const fg = form.querySelector('.composer-ring .fg');
    const num = form.querySelector('[data-count]');
    const sync = () => {
      const n = ta.value.length, left = POST_MAX - n;
      btn.disabled = !ta.value.trim() && !form.attach?.checked && !form.cloudTrack?.value;
      if (fg) {
        fg.style.strokeDashoffset = String(RING * (1 - Math.min(1, n / POST_MAX)));
        fg.classList.toggle('warn', left <= 20);
        fg.classList.toggle('over', left <= 0);
        num.hidden = left > 20;
        num.textContent = left;
      }
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(260, ta.scrollHeight)}px`;
    };
    ta.addEventListener('input', sync);
    form.attach?.addEventListener('change', sync);
    form.cloudTrack?.addEventListener('change', sync);
  });
}

export async function submitPost(form) {
  if (form.dataset.busy) return false;
  form.dataset.busy = '1';
  form.setAttribute('aria-busy', 'true');
  form.text.readOnly = true;
  const button = form.querySelector('[data-submit]');
  button.disabled = true;
  try {
    const cur = app.player.current;
    const ct = form.cloudTrack?.value && cloudTracks.list.find((t) => t.cloudId === form.cloudTrack.value);
    const attach = ct ? { type: 'track', item: ct } : form.attach?.checked && cur ? { type: 'track', item: snapshot(cur) } : null;
    const replyTo = form.dataset.reply || null;
    const post = await app.posts.create(app.profile, form.text.value, attach, { replyTo, superComment: !!form.elements.superComment?.checked });
    if (post) app.toast(replyTo ? 'Respuesta publicada' : 'Publicado');
    return !!post;
  } catch (err) {
    app.toast(err.message || 'No se pudo publicar. Probá de nuevo.');
    return false;
  } finally {
    delete form.dataset.busy;
    form.removeAttribute('aria-busy');
    form.text.readOnly = false;
    button.disabled = !form.text.value.trim() && !form.attach?.checked && !form.cloudTrack?.value;
  }
}

// para contenido local sólo se guarda lo necesario (el archivo no viaja)
function snapshot(t) {
  if (t.kind === 'remote') return t;
  return { id: t.id, title: t.title, artist: t.artist, album: t.album };
}

// ---------- tarjeta ----------
const authorOf = (post) => app.posts.author(post.uid) || post.author || {};
const fmtN = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.', ',')} mil` : n ? String(n) : '');

function profileBtn(a, uid, inner, cls = '') {
  return a.role === 'artist'
    ? `<button class="${cls}" data-action="open-artist" data-id="zu:${esc(uid)}" aria-label="Ver el perfil de ${esc(a.displayName || '')}">${inner}</button>`
    : uid === app.user?.uid ? `<button class="${cls}" data-action="nav" data-view="profile" aria-label="Ver tu perfil">${inner}</button>`
      : `<span class="${cls}">${inner}</span>`;
}

// derecho del lector sobre una publicación (las respuestas heredan la audiencia de la raíz)
export function accessOf(post) {
  const root = app.posts.rootOf(post) || post;
  const need = tierOf(root);
  if (!need) return { need: 0, ok: true, root, isAuthor: false };
  const isAuthor = !!app.user && root.uid === app.user.uid;
  const tier = app.subs?.tier(app.user?.uid, root.uid) || 0;
  return { need, ok: canView(root, tier, { isAuthor }), root, isAuthor, tier };
}

const timeEl = (ts, full = false) => `<time class="post-time" datetime="${new Date(ts).toISOString()}" title="${full ? new Date(ts).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' }) : new Date(ts).toLocaleString('es')}">${timeAgo(ts)}</time>`;
const simTag = '<span class="post-sim" title="Contenido simulado para pruebas">Simulado</span>';

// tarjeta bloqueada: autor, fecha, nivel, adelanto y "Desbloquear". El texto real nunca entra al DOM.
export function lockedCard(post, need, i = 0, by = null) {
  const a = authorOf(post);
  const root = app.posts.rootOf(post) || post;
  const name = tierName(need);
  const teaser = post === root && post.teaser ? post.teaser : '';
  return `<article class="post fx-post community-post locked enter" style="--i:${Math.min(i, 12)}" data-post="${esc(post.id)}" data-locked="1">
    ${by ? `<p class="post-context">${icon('repeat')}${esc(by.displayName || 'Alguien')} reposteó</p>` : ''}
    ${profileBtn(a, post.uid, avatar(a, 'md'), 'post-avatar')}
    <div class="post-body">
      <header class="post-head">
        ${profileBtn(a, post.uid, `<b class="post-name">${esc(a.displayName || 'Usuario')}</b>${tick(a.role === 'artist', 'Artista verificado')}`, 'post-who')}
        <span class="post-handle">@${esc(a.username || '')}</span><span class="post-dot">·</span>${timeEl(post.created)}
        ${post.sim ? simTag : ''}
      </header>
      <div class="post-lock">
        <span class="post-lock-ico">${icon('lock')}</span>
        <div class="post-lock-main"><span class="pill tier">Para ${esc(name)} o superior</span>
          <p class="post-teaser">${teaser ? esc(teaser) : 'Contenido exclusivo'}</p>
          <p class="hint">Contenido para ${esc(name)} o superior.</p></div>
        <button class="btn-primary lit sm" data-action="unlock-tier" data-artist="${esc(root.uid)}">Desbloquear con ${esc(name)}</button>
      </div>
    </div>
  </article>`;
}

// cabecera y cuerpo del evento de catálogo: generado por ZUENA con datos de Apple Music
function catalogParts(post) {
  const c = post.catalog || {};
  const open = (inner, cls) => `<button class="${cls}" data-action="open-artist" data-id="am:${esc(c.artistId)}" aria-label="Ver el perfil de ${esc(c.artist || '')}">${inner}</button>`;
  const n = +c.tracks || 0;
  const meta = [KIND_LABEL[c.kindRel] || 'Lanzamiento', c.year, n ? `${n} ${n === 1 ? 'canción' : 'canciones'}` : ''].filter(Boolean).map(esc).join(' · ');
  return {
    avatar: open(avatar({ avatar: c.artwork, displayName: c.artist, uid: post.uid }, 'md'), 'post-avatar'),
    who: `${open(`<b class="post-name">${esc(c.artist || 'Artista')}</b>`, 'post-who')}<span class="post-dot">·</span>${timeEl(post.created, true)}`,
    body: `<p class="post-text post-cat-line">Nuevo lanzamiento: ${esc(c.title || '')}</p>
      <div class="post-attach lit cat-attach" role="button" tabindex="0" data-action="open-amc" data-id="${esc(c.collectionId)}" title="${esc(c.title || '')}">
        <div class="art sm">${c.artwork ? `<img src="${esc(c.artwork)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : icon('disc')}</div>
        <div class="row-main"><div class="row-title">${esc(c.title || '')}${c.explicit ? ' <span class="badge">E</span>' : ''}</div><div class="row-sub">${meta}</div></div><span class="post-play">${icon('play')}</span></div>
      <p class="post-cat-foot"><span class="pill cat">Catálogo</span><span>Dato de Apple Music. Lo generó ZUENA; no lo escribió el artista.</span></p>`,
  };
}

// insignia del nivel en respuestas de suscriptores (sólo con suscripción vigente con el artista respondido)
function tierBadge(post, root) {
  if (!post.replyTo || !root || root.uid === post.uid || root.kind === 'catalog') return '';
  if (authorOf(post).role === 'artist') return '';
  const t = app.subs?.tier(post.uid, root.uid) || 0;
  if (!t) return '';
  return `<span class="pill tier-badge t${t}">${tierName(t)}</span>${post.sim ? '' : simTag}`;
}

export function postCard(post, i = 0, { detail = false, compact = false } = {}) {
  // un repost se muestra como la publicación original con la línea "X reposteó"
  let by = null;
  if (post.repostOf && !post.text) {
    const orig = app.posts.get(post.repostOf);
    if (!orig) return '';
    by = authorOf(post);
    post = orig;
  }
  const acc = accessOf(post);
  if (!acc.ok) return lockedCard(post, acc.need, i, by);
  const cat = post.kind === 'catalog';
  const a = authorOf(post);
  const me = app.user?.uid;
  const liked = post.likes.includes(me);
  const reposted = (post.reposts || []).includes(me);
  const replies = app.posts.replyCount(post.id);
  const parent = post.replyTo ? app.posts.get(post.replyTo) : null;
  const ce = cat ? catalogParts(post) : null;
  const excl = acc.need > 0;
  // chip de audiencia: el artista ve a quién va dirigida (con el conteo simulado); el suscriptor, "Exclusivo"
  const aud = !excl ? '' : acc.isAuthor
    ? `<p class="post-aud"><span class="pill tier">Sólo ${esc(tierName(acc.need))} o superior</span><span class="muted">${app.subs?.countFor(acc.root.uid, acc.need) || 0} con acceso</span>${simTag}</p>`
    : post === acc.root ? `<p class="post-aud"><span class="pill tier on">Exclusivo · ${esc(tierName(acc.need))}</span></p>` : '';
  const noShare = excl ? ' disabled aria-disabled="true" title="El contenido exclusivo no se puede compartir"' : '';
  const noRepost = post.cloud ? ' disabled aria-disabled="true" title="Repostear todavía no está disponible para publicaciones de la nube"' : noShare;
  const replying = parent && !detail
    ? parent.kind === 'catalog'
      ? `<p class="post-replying">Respondiendo al lanzamiento de <b>${esc(parent.catalog?.artist || '')}</b></p>`
      : `<p class="post-replying">Respondiendo a <b>@${esc(authorOf(parent).username || '')}</b></p>`
    : '';
  return `<article class="post fx-post community-post enter ${cat ? 'catalog' : ''} ${excl ? 'exclusive' : ''} ${post.pinned ? 'pinned' : ''} ${detail ? 'detail' : ''} ${compact ? 'compact' : ''}" style="--i:${Math.min(i, 12)}" data-post="${esc(post.id)}" data-flip="${esc(post.id)}" ${detail ? '' : `data-open="${esc(post.id)}"`}>
    ${by ? `<p class="post-context">${icon('repeat')}${esc(by.displayName || 'Alguien')} reposteó</p>` : post.pinned && !detail ? `<p class="post-context">${icon('star')}Anclado</p>` : ''}
    ${cat ? ce.avatar : profileBtn(a, post.uid, avatar(a, 'md'), 'post-avatar')}
    <div class="post-body">
      <header class="post-head">
        ${cat ? ce.who : `${profileBtn(a, post.uid, `<b class="post-name">${esc(a.displayName || 'Usuario')}</b>${tick(a.role === 'artist', 'Artista verificado')}`, 'post-who')}
        ${tierBadge(post, acc.root)}<span class="post-handle">@${esc(a.username || '')}</span><span class="post-dot">·</span>${timeEl(post.created)}`}
        ${post.sim ? simTag : ''}
        <button class="post-more" data-action="post-menu" data-id="${esc(post.id)}" title="Opciones" aria-label="Opciones de la publicación">${icon('more')}</button>
      </header>
      ${replying}${aud}${app.posts.isSuperComment(post) ? '<p class="post-super">Supercomentario</p>' : ''}
      ${cat ? ce.body : `${post.text ? `<p class="post-text">${richText(post.text, esc)}</p>` : ''}${attachHtml(post)}`}
      ${detail ? `<p class="post-when">${new Date(post.created).toLocaleString('es', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short', year: 'numeric' })}</p>` : ''}
      <footer class="post-actions" role="group" aria-label="Acciones">
        <button class="pa pa-reply" data-action="post-reply" data-id="${esc(post.id)}" aria-label="Responder${replies ? `, ${replies} respuestas` : ''}">${icon('feed')}<span data-n="replies">${fmtN(replies)}</span></button>
        <button class="pa pa-repost ${reposted ? 'on' : ''}" data-action="post-repost" data-id="${esc(post.id)}" aria-pressed="${reposted}" aria-label="Repostear"${noRepost}>${icon('repeat')}<span data-n="reposts">${fmtN(post.reposts?.length || 0)}</span></button>
        <button class="pa pa-like ${liked ? 'on' : ''}" data-action="post-like" data-id="${esc(post.id)}" aria-pressed="${liked}" aria-label="Me gusta">${icon(liked ? 'heartFill' : 'heart')}<span data-n="likes">${fmtN(post.likes.length)}</span></button>
        <button class="pa pa-share" data-action="post-share" data-id="${esc(post.id)}" aria-label="Compartir"${noShare}>${icon('upload')}</button>
      </footer>
    </div>
  </article>`;
}

function attachHtml(post) {
  if (post.attach?.type === 'release') return releaseAttach(post.attach);
  if (!post.attach?.item) return '';
  const it = see(post.attach.item.kind === 'remote' ? post.attach.item : app.resolve(post.attach.item.id) || post.attach.item);
  const key = listKey([it]);
  return `<div class="post-attach lit" data-action="play" data-list="${key}" data-index="0" data-id="${esc(it.id)}">${art(it, 'sm')}
    <div class="row-main"><div class="row-title">${esc(it.title)}</div><div class="row-sub">${esc(it.artist || '')}</div></div><span class="post-play">${icon('play')}</span></div>`;
}

// lanzamiento adjunto: se resuelve en vivo contra su estado actual (no contra la copia del post)
function releaseAttach(a) {
  const r = app.releases.get(a.releaseId);
  const cover = r?.coverThumb || a.cover;
  const img = cover ? `<div class="art sm"><img src="${esc(cover)}" alt="" loading="lazy" decoding="async"></div>` : `<div class="art sm">${icon('disc')}</div>`;
  const title = esc(r?.title || a.title), artist = esc(r?.primaryArtist || a.artist || '');
  if (r && isUpcoming(r)) {
    return `<div class="post-attach release-teaser"><span class="fx-live soon">Estreno</span>${img}
      <div class="row-main"><div class="row-title">${title}</div><div class="row-sub">${artist} · Estreno ${esc(premiereLabel(r.premiereAt))}</div></div>
      <span class="countdown" data-countdown="${r.premiereAt}">${esc(countdown(r.premiereAt))}</span></div>`;
  }
  if (r && isLive(r)) {
    return `<div class="post-attach lit" role="button" tabindex="0" data-action="play-release" data-id="${esc(r.id)}">${img}
      <div class="row-main"><div class="row-title">${title}</div><div class="row-sub">${artist} · ${r.tracks.length} ${r.tracks.length === 1 ? 'canción' : 'canciones'}</div></div><span class="post-play">${icon('play')}</span></div>`;
  }
  return `<div class="post-attach unavailable">${img}<div class="row-main"><div class="row-title">${title}</div><div class="row-sub">No disponible</div></div></div>`;
}

// ---------- vista Feed ----------
function items() {
  const tab = app.ui.feedTab || 'foryou';
  const tag = app.ui.feedTag;
  // eventos de catálogo: derivados en memoria + guardados dentro de la ventana (o con respuesta/repost)
  let list = app.posts.timeline().filter((p) => p.kind !== 'catalog');
  if (TEST_CATALOG) list = list.concat(app.posts.catalogFeed());
  if (tag) list = list.filter((p) => (p.text || app.posts.get(p.repostOf)?.text || '').toLowerCase().includes(`#${tag.toLowerCase()}`));
  const me = app.user?.uid;
  const orig = (p) => (p.repostOf && !p.text ? app.posts.get(p.repostOf) || p : p);
  if (tab === 'following') list = list.filter((p) => p.uid === me || app.posts.isFollowing(p.uid)).sort((a, b) => b.created - a.created);
  // Estrenos: lanzamientos de catálogo y publicaciones con un lanzamiento adjunto, lo más nuevo primero
  if (tab === 'releases') list = list.filter((p) => orig(p).kind === 'catalog' || orig(p).attach?.type === 'release').sort((a, b) => b.created - a.created);
  // una publicación aparece una sola vez aunque tenga varios reposts (se queda la más reciente:
  // el original o el repost de alguien, que lleva la línea "X reposteó")
  const seen = new Set();
  list = list.filter((p) => {
    const key = p.repostOf && !p.text ? p.repostOf : p.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (tab !== 'foryou') return list; // cronológico
  // ranking con los contadores calculados una sola vez (antes se recorría la lista en cada comparación)
  const now = Date.now();
  const replies = new Map();
  for (const p of app.posts.list) if (p.replyTo) replies.set(p.replyTo, (replies.get(p.replyTo) || 0) + 1);
  const score = new Map(list.map((p) => {
    const o = orig(p);
    const eng = o.likes.length + 2 * (o.reposts?.length || 0) + 1.5 * (replies.get(o.id) || 0);
    const hours = Math.max(0, (now - p.created) / 3600e3);
    // lo propio de los últimos 10 minutos queda arriba, como en cualquier red
    // (entre lo propio reciente manda la fecha: lo último que hiciste va primero)
    if (p.uid === me && now - p.created < 10 * 60e3) return [p.id, 2e6 + (p.created - now) / 1000];
    // afinidad: lo de quienes seguís pesa más, y una publicación con música adjunta un poco más
    const affinity = (app.posts.isFollowing(o.uid) ? 1.6 : 1) * (o.attach ? 1.2 : 1);
    return [p.id, (affinity * (1 + eng)) / Math.pow(hours + 2, 1.35)];
  }));
  const sorted = diversify([...list].sort((a, b) => score.get(b.id) - score.get(a.id)), (p) => orig(p).uid);
  // tope de catálogo: 1 cada 4 ítems y 1 por artista por página (un repost cuenta como su original)
  return mixCatalog(sorted, { every: 4, page: PAGE, isCat: (p) => orig(p).kind === 'catalog', artistOf: (p) => orig(p).uid });
}

// variedad: evita dos publicaciones seguidas de la misma persona adelantando la siguiente de otra
// (mira hasta 6 lugares adelante; si no hay otra, la deja donde está)
export function diversify(list, authorOf) {
  const out = [], rest = [...list];
  while (rest.length) {
    const last = out.length ? authorOf(out[out.length - 1]) : null;
    let k = rest.findIndex((p, i) => i < 6 && authorOf(p) !== last);
    if (k < 0) k = 0;
    out.push(rest.splice(k, 1)[0]);
  }
  return out;
}

// "Ahora en ZUENA": artistas con publicaciones en las últimas 48 h (anillo si es de las últimas 6 h)
function storiesHtml() {
  const now = Date.now(), seen = new Map();
  for (const p of app.posts.list) {
    if (p.replyTo || p.kind === 'catalog' || now - p.created > 48 * 3600e3 || !app.posts.visible(p)) continue;
    const a = authorOf(p);
    if (a.role !== 'artist' || p.uid === app.user?.uid) continue;
    const prev = seen.get(p.uid);
    if (!prev || prev.created < p.created) seen.set(p.uid, { a, created: p.created });
  }
  const list = [...seen.entries()].sort((x, y) => y[1].created - x[1].created).slice(0, 14);
  if (list.length < 3) return '';
  return `<nav class="fx-stories" aria-label="Artistas con novedades">${list.map(([uid, { a, created }]) => profileBtn(a, uid,
    `<span class="fx-story-ring ${now - created < 6 * 3600e3 ? 'new' : ''}">${avatar(a, 'md')}</span><span class="fx-story-name">${esc(a.displayName || '')}</span>`, 'fx-story')).join('')}</nav>`;
}

// estado visual de los botones de una publicación en todas sus tarjetas (lista, hilo, repost)
function syncPostButtons(id) {
  const p = app.posts.get(id);
  if (!p) return;
  const me = app.user?.uid;
  for (const card of document.querySelectorAll(`.fx-post[data-post="${CSS.escape(id)}"]`)) {
    const like = card.querySelector('.pa-like'), rep = card.querySelector('.pa-repost');
    const liked = p.likes.includes(me), reposted = (p.reposts || []).includes(me);
    if (like && like.classList.contains('on') !== liked) {
      like.classList.toggle('on', liked);
      like.setAttribute('aria-pressed', String(liked));
      like.querySelector('svg')?.replaceWith(document.createRange().createContextualFragment(icon(liked ? 'heartFill' : 'heart')));
    }
    if (rep) { rep.classList.toggle('on', reposted); rep.setAttribute('aria-pressed', String(reposted)); }
    const set = (k, n) => { const s = card.querySelector(`[data-n="${k}"]`); if (s) s.textContent = fmtN(n); };
    set('likes', p.likes.length);
    set('reposts', p.reposts?.length || 0);
    set('replies', app.posts.replyCount(p.id));
  }
}

let shown = new Set();
const shownIds = () => new Set([...app.posts.list.map((p) => p.id), ...app.posts.derived.keys()]);

export function viewFeed() {
  const tab = app.ui.feedTab || 'foryou';
  const tag = app.ui.feedTag;
  const list = items();
  const page = list.slice(0, app.ui.feedLimit || PAGE);
  shown = shownIds();
  const empty = tab === 'following'
    ? `<div class="fx-empty">${icon('feed')}<h3>Todavía no seguís a nadie</h3><p>Seguí artistas desde "A quién seguir" y sus publicaciones van a aparecer acá.</p></div>`
    : tab === 'releases'
      ? `<div class="fx-empty">${icon('disc')}<h3>Todavía no hay estrenos</h3><p>Los lanzamientos y estrenos programados de los artistas van a aparecer acá.</p></div>`
      : `<div class="fx-empty">${icon('edit')}<h3>Todavía no hay publicaciones para mostrar.</h3><p>Las novedades de los artistas de ZUENA van a aparecer acá.</p></div>`;
  const tabs = FEED_TABS.findIndex(([k]) => k === tab);
  // primero las que entran en pantalla; el resto en una tarea aparte cuando el hilo queda libre
  // (las 40 juntas eran ~2100 nodos: una tarea de 35–50 ms en PC y más de 150 ms en móvil)
  const more = list.length > page.length;
  const rest = page.splice(FIRST_CARDS);
  if (rest.length) {
    app.ui.mount = (root) => {
      const box = root.querySelector('.fx-main > .fx-list');
      const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 16));
      idle(() => {
        if (!box?.isConnected) return; // se volvió a dibujar o se cambió de vista
        box.insertAdjacentHTML('beforeend', rest.map((p, i) => postCard(p, i + FIRST_CARDS)).join(''));
        app.afterFill?.(box);
      }, { timeout: 200 });
    };
  }
  return `<div class="fx fx4 community-feed">
    <section class="fx-main">
      <header class="fx-head enter">
        <div class="community-feed-intro"><p class="eyebrow">Comunidad / ZUENA</p><h1>Feed</h1><p class="muted">La música también se conversa.</p></div>
        <div class="fx-tabs" role="tablist" aria-label="Qué ver" style="--tabs:${FEED_TABS.length};--tab-i:${Math.max(0, tabs)}">
          ${FEED_TABS.map(([k, l]) => `<button role="tab" class="fx-tab ${tab === k ? 'on' : ''}" aria-selected="${tab === k}" data-action="feed-tab" data-tab="${k}">${l}</button>`).join('')}
          <i class="fx-tab-ink" aria-hidden="true"></i>
        </div>
        ${tag ? `<div class="fx-filter"><span>#${esc(tag)}</span><button class="btn-icon lit sm" data-action="feed-tag" data-tag="" aria-label="Quitar filtro">${icon('close')}</button></div>` : ''}
      </header>
      ${tab === 'foryou' && !tag ? storiesHtml() : ''}
      ${composer()}
      <button class="fx-new" data-action="feed-new" hidden></button>
      <div class="fx-list">${page.length ? page.map((p, i) => postCard(p, i)).join('') : empty}</div>
      ${more ? `<button class="btn-glass lit fx-more" data-action="feed-more">Mostrar más</button>` : ''}
    </section>
    <aside class="fx-side" aria-label="Tendencias y sugerencias">${sideHtml()}</aside>
  </div>`;
}

function sideHtml() {
  const trends = app.posts.trends(6);
  const me = app.user?.uid;
  const artists = [...app.posts.authors.values()].filter((a) => (a.role === 'artist' || (a.cloud && a.accountType === 'artist')) && a.uid !== me && !app.posts.isFollowing(a.uid)).slice(0, 4);
  const sim = app.sim?.status?.();
  return `${regionalTopHtml()}${trends.length ? `<section class="fx-card glass-soft"><h2>Tendencias</h2>${trends.map((t, i) => `
      <button class="fx-trend" data-action="feed-tag" data-tag="${esc(t.tag)}"><span class="muted">${i + 1} · Tendencia en ZUENA</span><b>#${esc(t.tag)}</b><span class="muted">${t.posts} ${t.posts === 1 ? 'publicación' : 'publicaciones'}</span></button>`).join('')}</section>` : ''}
    ${artists.length ? `<section class="fx-card glass-soft"><h2>A quién seguir</h2>${artists.map((a) => `
      <div class="fx-who">${profileBtn(a, a.uid, avatar(a, 'sm'), 'fx-who-av')}
        <div class="row-main"><div class="row-title">${esc(a.displayName)}${tick(a.role === 'artist', 'Artista verificado')}</div><div class="row-sub">@${esc(a.username || '')}</div></div>
        <button class="btn-primary lit sm" data-action="feed-follow" data-uid="${esc(a.uid)}" data-name="${esc(a.displayName || '')}">Seguir</button></div>`).join('')}</section>` : ''}
    ${sim ? `<section class="fx-card glass-soft fx-simcard"><h2>Simulación</h2><p class="muted">${esc(sim)}</p></section>` : ''}`;
}

// ---------- vista de una publicación (hilo) ----------
export function viewPost() {
  const post = app.posts.get(app.ui.param);
  if (!post || !app.posts.visible(post)) return `${backBtn()}<div class="fx-empty">${icon('feed')}<h3>Esta publicación no está disponible</h3></div>`;
  shown = shownIds();
  // exclusivo sin derecho: sólo la tarjeta bloqueada (sin respuestas ni composer)
  const acc = accessOf(post);
  if (!acc.ok) {
    return `<div class="fx fx-thread community-feed"><section class="fx-main">
      <header class="fx-head enter">${backBtn()}<h1>Publicación</h1></header>${lockedCard(acc.root, acc.need)}
    </section><aside class="fx-side">${sideHtml()}</aside></div>`;
  }
  const chain = [];
  const visited = new Set([post.id]);
  for (let p = post.replyTo && app.posts.get(post.replyTo); p && !visited.has(p.id); p = p.replyTo && app.posts.get(p.replyTo)) {
    visited.add(p.id);
    chain.unshift(p);
  }
  const replies = orderReplies(post, app.posts.repliesOf(post.id), acc);
  const placeholder = post.kind === 'catalog' ? 'Respondé al lanzamiento' : `Respondé a @${authorOf(post).username || ''}`;
  return `<div class="fx fx-thread community-feed"><section class="fx-main">
    <header class="fx-head enter">${backBtn()}<h1>Publicación</h1></header>
    ${chain.map((p) => postCard(p, 0, { compact: true })).join('')}
    ${postCard(post, 0, { detail: true })}
    ${app.user ? composer({ replyTo: post.id, placeholder }) : ''}
    <div class="fx-list">${replies.map((p, i) => postCard(p, i)).join('') || '<p class="muted fx-noreplies">Todavía no hay respuestas.</p>'}</div>
  </section><aside class="fx-side">${sideHtml()}</aside></div>`;
}

// orden del hilo: en exclusivos, primero las respuestas de Superfan o superior; en publicaciones públicas de un
// artista, primero las de VIP. Dentro de cada grupo, por fecha.
export function orderReplies(post, replies, acc = { need: tierOf(post) }) {
  return [...replies].sort((a, b) => Number(app.posts.isSuperComment(b)) - Number(app.posts.isSuperComment(a)) || a.created - b.created || String(a.id).localeCompare(String(b.id)));
}

// ---------- cambios del simulador: contadores en su lugar y aviso de nuevas ----------
export function feedLive(root) {
  if (!root.querySelector('.fx')) return false;
  for (const id of new Set([...root.querySelectorAll('.fx-post[data-post]')].map((el) => el.dataset.post))) syncPostButtons(id);
  // horas relativas al día ("ahora", "3 min"…)
  for (const t of root.querySelectorAll('.fx-post time[datetime]')) {
    const txt = timeAgo(Date.parse(t.getAttribute('datetime')));
    if (t.textContent !== txt) t.textContent = txt;
  }
  // los eventos de catálogo que llegan tarde (Apple respondió después de dibujar) sólo suman al contador
  const fresh = [...app.posts.list, ...app.posts.derived.values()].filter((p) => !shown.has(p.id) && !p.replyTo && app.posts.visible(p));
  const pill = root.querySelector('.fx-new');
  if (pill) {
    pill.hidden = !fresh.length;
    if (fresh.length) {
      const faces = fresh.slice(0, 3).map((p) => avatar(authorOf(p), 'xs')).join('');
      pill.innerHTML = `<span class="fx-faces">${faces}</span>Ver ${fresh.length} ${fresh.length === 1 ? 'publicación nueva' : 'publicaciones nuevas'}`;
    }
  }
  // en el hilo, las respuestas nuevas se agregan al final sin re-dibujar
  const thread = root.querySelector('.fx-thread');
  if (thread) {
    const list = thread.querySelector('.fx-list');
    const add = app.posts.list.filter((p) => !shown.has(p.id) && p.replyTo === app.ui.param).sort((a, b) => a.created - b.created);
    if (list && add.length) {
      const parent = app.posts.get(app.ui.param);
      list.querySelector('.fx-noreplies')?.remove();
      const ordered = orderReplies(parent, app.posts.repliesOf(app.ui.param));
      for (const reply of add) {
        const next = ordered.slice(ordered.indexOf(reply) + 1).map((p) => list.querySelector(`[data-post="${CSS.escape(p.id)}"]`)).find(Boolean);
        if (next) next.insertAdjacentHTML('beforebegin', postCard(reply));
        else list.insertAdjacentHTML('beforeend', postCard(reply));
      }
      add.forEach((p) => shown.add(p.id));
    }
  }
  const side = root.querySelector('.fx-side');
  // la columna lateral se re-dibuja sólo si cambió (re-dibujarla igual costaba ~8 ms de estilo por evento)
  if (side && !side.contains(document.activeElement)) {
    const html = sideHtml();
    if (sideMemo.get(side) !== html) {
      const regional = side.querySelector('[data-regional-top]');
      side.innerHTML = html;
      if (regional) side.querySelector('[data-regional-top]')?.replaceWith(regional);
      sideMemo.set(side, html);
    }
  }
  mountRegionalTop(root);
  return true;
}
const sideMemo = new WeakMap();

// ---------- tarjeta de lanzamiento para estantes (Inicio, perfil) ----------
export function releaseCard(r, i = 0) {
  const soon = isUpcoming(r);
  return `<div class="card lit enter ${soon ? 'teaser' : ''}" style="--i:${i}" ${soon ? '' : `role="button" tabindex="0" data-action="play-release" data-id="${esc(r.id)}"`}>
    <div class="card-art"><div class="art">${r.coverThumb ? `<img src="${esc(r.coverThumb)}" alt="" loading="lazy" decoding="async">` : icon('disc')}</div>
      ${soon ? `<span class="card-countdown" data-countdown="${r.premiereAt}">${esc(countdown(r.premiereAt))}</span>` : `<span class="card-play">${icon('play')}</span>`}</div>
    <div class="card-title">${esc(r.title)}</div>
    <div class="card-sub">${esc(r.primaryArtist)} · ${soon ? `Estreno ${esc(premiereLabel(r.premiereAt))}` : esc(r.type === 'single' ? 'Single' : r.type === 'ep' ? 'EP' : 'Álbum')}</div></div>`;
}

const rerender = () => { if (app.ui.view === 'feed' || app.ui.view === 'post') app.render(); };

// Seguir / dejar de seguir (feed, menú y perfil usan lo mismo). `uid` = uid de ZUENA o `am:<artistId>`.
// Devuelve el estado nuevo o null si no se pudo (sin sesión o error al guardar: el estado no cambia).
export async function followToggle(uid, name = '') {
  if (!app.user) { app.toast('Iniciá sesión para seguir a este artista.'); return null; }
  try {
    const on = await app.posts.toggleFollow(uid);
    // dejar de seguir no cancela la suscripción (simulada): se avisa
    if (!on && app.subs?.tier(app.user.uid, uid)) app.toast(`Seguís suscripto a ${name || 'este artista'}. Podés cancelarlo desde su perfil.`);
    else app.toast(on ? 'Ahora lo seguís' : 'Dejaste de seguirlo');
    app.charts?.refreshFollowers();
    return on;
  } catch (err) {
    console.warn('[seguir]', err);
    app.toast(err?.cloudMessage || 'No se pudo guardar. Probá de nuevo.');
    return null;
  }
}

registerActions({
  'play-release': (el) => {
    const r = app.releases.get(el.dataset.id);
    const tracks = (r?.tracks || []).map((rt) => app.library.byId.get(rt.trackId)).filter((t) => app.isAvailable(t));
    if (!tracks.length) { app.toast('Este lanzamiento no está disponible'); return; }
    app.playGroup(tracks, false);
  },
  'post-like': async (el, e) => {
    e?.stopPropagation();
    if (!app.user) { app.toast('Iniciá sesión para participar.'); return; }
    if (el.disabled) return;
    el.disabled = true;
    try {
      const on = !el.classList.contains('on');
      await app.posts.toggleLike(el.dataset.id, app.user.uid, on);
      syncPostButtons(el.dataset.id);
      if (on) app.motion?.play('pop', el.querySelector('svg'));
    } catch (err) { app.toast(err?.cloudMessage || 'No se pudo guardar el Me gusta. Probá de nuevo.'); }
    finally { el.disabled = false; }
  },
  'post-repost': async (el, e) => {
    e?.stopPropagation();
    if (!app.user) { app.toast('Iniciá sesión para participar.'); return; }
    if (el.disabled) return;
    el.disabled = true;
    try { await app.posts.toggleRepost(el.dataset.id, app.profile); }
    catch { app.toast('No se pudo compartir. Probá de nuevo.'); return; }
    finally { el.disabled = false; }
    syncPostButtons(el.dataset.id);
    app.toast((app.posts.get(el.dataset.id)?.reposts || []).includes(app.user.uid) ? 'Reposteado' : 'Repost quitado');
  },
  'post-reply': (el, e) => {
    e?.stopPropagation();
    if (!app.user) { app.toast('Iniciá sesión para participar.'); return; }
    if (app.ui.view === 'post' && app.ui.param === el.dataset.id) { document.querySelector('[data-form=post][data-reply] textarea')?.focus(); return; }
    app.go('post', el.dataset.id);
    setTimeout(() => document.querySelector('[data-form=post][data-reply] textarea')?.focus(), 80);
  },
  'post-share': async (el, e) => {
    e?.stopPropagation();
    const p = app.posts.get(el.dataset.id);
    if (p && app.posts.audienceTier(p)) { app.toast('El contenido exclusivo no se puede compartir'); return; }
    const a = p && authorOf(p);
    const c = p?.catalog;
    const text = !p ? '' : p.kind === 'catalog'
      ? `Nuevo lanzamiento: ${c.title} · ${c.artist} (Apple Music)${c.url ? ` ${c.url}` : ''}`
      : `${a.displayName} (@${a.username}) en ZUENA: ${p.text}`;
    try {
      if (navigator.share) await navigator.share({ title: 'ZUENA', text });
      else { await navigator.clipboard.writeText(text); app.toast('Copiado para compartir'); }
    } catch (err) { if (err.name !== 'AbortError') app.toast('No se pudo compartir. Probá de nuevo.'); }
  },
  'post-open': (el) => app.go('post', el.dataset.id),
  'feed-tab': (el) => { app.ui.feedTab = el.dataset.tab; app.ui.feedLimit = PAGE; rerender(); },
  'feed-tag': (el, e) => {
    e?.stopPropagation();
    app.ui.feedTag = el.dataset.tag || null;
    app.ui.feedLimit = PAGE;
    if (app.ui.view !== 'feed') app.go('feed'); else app.render();
  },
  // las nuevas entran desde arriba y las que estaban se corren con FLIP (motor de animaciones)
  'feed-new': () => {
    const done = app.motion?.flip(document, '.fx-post[data-flip]') || (() => {});
    document.querySelector('.view')?.scrollTo({ top: 0, behavior: app.motion?.enabled ? 'smooth' : 'auto' });
    app.render();
    done();
  },
  'feed-more': () => { app.ui.feedLimit = (app.ui.feedLimit || PAGE) + PAGE; app.render(); },
  'feed-follow': async (el) => {
    const on = await followToggle(el.dataset.uid, el.dataset.name || '');
    if (on !== null) rerender();
  },
  // tarjeta bloqueada → perfil del artista con la sección de apoyo abierta
  'unlock-tier': (el, e) => {
    e?.stopPropagation();
    app.ui.apOpenSupport = true;
    app.go('artistpage', `zu:${el.dataset.artist}`);
  },
  'post-menu': (el, e) => {
    e.stopPropagation();
    const r = el.getBoundingClientRect();
    const post = app.posts.get(el.dataset.id);
    if (!post) return;
    const mine = post.uid === app.user?.uid;
    const a = authorOf(post);
    const menu = [];
    // evento de catálogo: sólo "Copiar enlace" (al lanzamiento en Apple Music)
    if (post.kind === 'catalog') {
      const c = post.catalog || {};
      menu.push({
        label: 'Copiar enlace', icon: 'link',
        run: async () => {
          try { await navigator.clipboard.writeText(c.url || `Nuevo lanzamiento: ${c.title} · ${c.artist} (Apple Music)`); app.toast('Enlace copiado'); } catch { app.toast('No se pudo copiar'); }
        },
      });
      openMenu(r.left - 180, r.bottom + 4, menu);
      return;
    }
    if (mine) {
      if (!post.cloud) menu.push({
        label: post.pinned ? 'Desanclar' : 'Anclar en mi perfil', icon: 'star',
        run: async () => {
          const prev = app.posts.pinnedOf(post.uid);
          if (!post.pinned && prev && prev.id !== post.id && !(await confirmModal({ title: '¿Reemplazar el anclado?', text: 'Ya tenés otra publicación anclada. Se reemplaza por esta.', ok: 'Reemplazar' }))) return;
          await app.posts.pin(post.id, post.uid, !post.pinned);
          app.toast(post.pinned ? 'Anclado en tu perfil' : 'Desanclado');
          rerender();
        },
      });
      menu.push({
        label: 'Eliminar publicación', icon: 'trash', danger: true,
        run: async () => {
          if (await confirmModal({ title: '¿Eliminar la publicación?', text: 'No se puede deshacer.', ok: 'Eliminar', danger: true })) {
            await app.posts.remove(post.id);
            if (app.ui.view === 'post' && app.ui.param === post.id) app.go('feed'); else rerender();
          }
        },
      });
    } else if (a.role === 'artist' || post.cloud) {
      menu.push({ label: app.posts.isFollowing(post.uid) ? `Dejar de seguir a @${a.username}` : `Seguir a @${a.username}`, icon: 'user', run: async () => { if ((await followToggle(post.uid, a.displayName)) !== null) rerender(); } });
    }
    menu.push({ label: 'Ver publicación', icon: 'feed', run: () => app.go('post', post.id) });
    openMenu(r.left - 180, r.bottom + 4, menu);
  },
});

// tocar el cuerpo de una publicación (no un botón ni un enlace) abre su hilo
document.addEventListener('click', (e) => {
  const card = e.target.closest?.('.fx-post[data-open]');
  if (!card || e.target.closest('button, a, [data-action], input, textarea, select, label')) return;
  if (window.getSelection?.().toString()) return;
  app.go('post', card.dataset.open);
});
