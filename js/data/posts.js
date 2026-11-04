// Actualizaciones de estado (feed). Local en IndexedDB; con Firebase también en la colección `posts`.
// Eventos de catálogo (`kind:'catalog'`, id `cat-<collectionId>`): tarjetas generadas por el sistema con los
// lanzamientos reales del catálogo de prueba de Apple Music. No son publicaciones del artista: se derivan en
// memoria y se guardan recién con la primera interacción; nunca se sincronizan con la nube.
// Publicaciones de la nube Supabase (cloud: true, js/data/supabase.js): viven sólo en memoria (nunca en IndexedDB),
// se ven en todos los dispositivos y sus me gusta / seguidos van a las tablas likes y follows.
import { db } from '../store/db.js';
import { cloudSet, cloudRecent, cloudDelete } from './cloud.js';
import { TEST_CATALOG } from '../config.js';
import { testReleases } from './testArtists.js';
import { tierOf } from './subs.js';
import * as nube from './supabase.js';

export const POST_MAX = 280;
export const CATALOG_DAYS = 60; // ventana de eventos de catálogo en el feed (decisión D1)

// evento "Nuevo lanzamiento" a partir de un lanzamiento de testReleases(): fecha real de Apple, sin texto
export function catalogEvent(r) {
  const created = Date.parse(r.date);
  const uid = `am:${r.artistId}`;
  return {
    id: `cat-${r.collectionId}`, uid, kind: 'catalog', text: '', attach: null,
    catalog: { collectionId: r.collectionId, artistId: r.artistId, artist: r.artist, title: r.title, kindRel: r.kind, date: r.date, artwork: r.artwork, explicit: !!r.explicit, year: r.year || '', tracks: r.tracks || 0, url: r.url || '' },
    likes: [], reposts: [], replyTo: null, repostOf: null, sim: false, created,
    author: { uid, displayName: r.artist, username: '', avatar: r.artwork, role: 'catalog' },
  };
}

// sólo lanzamientos ya publicados (fecha válida ≤ ahora) dentro de la ventana; uno por collectionId
export function catalogEvents(releases, now = Date.now(), days = CATALOG_DAYS) {
  const seen = new Set(), out = [];
  for (const r of releases || []) {
    const t = Date.parse(r?.date);
    if (!r?.collectionId || !r.artistId || !Number.isFinite(t) || t > now || now - t > days * 864e5) continue;
    const k2 = `${r.artistId}:${String(r.title || '').toLowerCase()}`;
    if (seen.has(r.collectionId) || seen.has(k2)) continue;
    seen.add(r.collectionId); seen.add(k2);
    out.push(catalogEvent(r));
  }
  return out.sort((a, b) => b.created - a.created);
}

// mezcla de "Para vos": máx. 1 evento de catálogo cada `every` ítems y 1 por artista en cada página.
// Se respeta el orden por puntaje; lo que no entra se difiere. Como los eventos sin interacción tienen puntaje
// bajo, cuando quedan pocas publicaciones normales para intercalarlos (≤ 3 por evento pendiente) se ubican en
// cuanto entran, para no perderlos. Lo que no entra en ningún lado (sólo eventos al final) no se muestra.
export function mixCatalog(sorted, { every = 4, page = 40, isCat = (p) => p.kind === 'catalog', artistOf = (p) => p.uid } = {}) {
  const rank = new Map(sorted.map((p, i) => [p, i]));
  const norm = sorted.filter((p) => !isCat(p)), wait = sorted.filter(isCat);
  const out = [];
  const fits = (p) => {
    const n = out.length;
    for (let k = Math.max(0, n - (every - 1)); k < n; k++) if (isCat(out[k])) return false;
    for (let k = n - (n % page); k < n; k++) if (isCat(out[k]) && artistOf(out[k]) === artistOf(p)) return false;
    return true;
  };
  let i = 0;
  while (i < norm.length || wait.length) {
    const k = wait.findIndex(fits);
    const n = norm[i];
    if (k >= 0 && (!n || rank.get(wait[k]) < rank.get(n) || norm.length - i <= (every - 1) * wait.length)) { out.push(wait.splice(k, 1)[0]); continue; }
    if (!n) break;
    out.push(n);
    i++;
  }
  return out;
}

export class Posts extends EventTarget {
  constructor(auth) {
    super();
    this.auth = auth;
    this.list = [];
    this.authors = new Map();
    this.derived = new Map(); // eventos de catálogo aún sin interacción (sólo en memoria)
    this.catalogP = null;
    this.cloudFollowing = new Set();
    this.stopWatch = null;
  }

  // ¿la sesión actual es una cuenta de la nube? (los demás leen la nube pero no escriben)
  get cloudUser() { return this.auth?.user?.mode === 'supabase' ? this.auth.user.uid : null; }
  // publicar en la nube: cuenta de la nube con tipo Artista (todavía sin verificación: no lleva tilde)
  canCloudPost(profile) { return !!this.cloudUser && profile?.uid === this.cloudUser && profile.accountType === 'artist'; }

  // trae el feed de la nube y lo mezcla con lo local; con Realtime, los cambios llegan solos
  async loadCloud() {
    if (!nube.supabaseEnabled()) return;
    let rows;
    try { rows = await nube.fetchFeed(100); } catch (err) { console.warn('[posts] nube', err); return; }
    this.list = [...this.list.filter((p) => !p.cloud), ...rows].sort((a, b) => b.created - a.created);
    for (const p of rows) if (!this.authors.get(p.uid) || this.authors.get(p.uid).cloud) this.authors.set(p.uid, p.author);
    this.emit(true);
    if (!this.stopWatch) {
      let t = 0;
      this.stopWatch = await nube.watchFeed(() => { clearTimeout(t); t = setTimeout(() => this.loadCloud(), 600); }).catch(() => null);
    }
  }

  // con TEST_CATALOG apagado los eventos de catálogo (y sus respuestas) quedan guardados pero invisibles
  visible(p, testCatalog = TEST_CATALOG) {
    if (p.replyTo && !this.rootOf(p)) return false;
    if (p.cloud) return true;
    const original = p.repostOf && this.get(p.repostOf);
    if (p.repostOf && (!original || (original.kind !== 'catalog' && (this.author(original.uid) || original.author)?.role !== 'artist'))) return false;
    if (!p.replyTo && !p.repostOf && p.kind !== 'catalog' && (this.author(p.uid) || p.author)?.role !== 'artist') return false;
    if (testCatalog) return true;
    if (p.kind === 'catalog') return false;
    const root = this.rootOf(p);
    return root?.kind !== 'catalog' && this.get(p.repostOf)?.kind !== 'catalog';
  }

  // raíz de un hilo (las respuestas heredan la audiencia de la raíz)
  rootOf(p) {
    let r = p;
    const seen = new Set();
    while (r?.replyTo) {
      if (seen.has(r.id)) return null;
      seen.add(r.id);
      r = this.get(r.replyTo);
      if (!r) return null;
    }
    return r;
  }
  audienceTier(p) { const root = this.rootOf(p); return root ? tierOf(root) : 3; }

  commentAccess(profile, post, superComment = false) {
    const root = this.rootOf(post);
    if (!profile?.uid) return { ok: false, message: 'Iniciá sesión para comentar.' };
    if (!root) return { ok: false, message: 'Esta publicación ya no está disponible.' };
    if (root.kind === 'catalog') return { ok: false, message: 'Este lanzamiento del catálogo no admite comentarios.' };
    if (root.cloud) return this.cloudUser === profile.uid ? { ok: !superComment, tier: 0, message: 'Los supercomentarios no están disponibles en la nube.' } : { ok: false, message: 'Ingresá con tu cuenta de ZUENA en la nube para comentar.' };
    if (root.uid === profile.uid && profile.role === 'artist') return { ok: !superComment, message: 'Los supercomentarios son para suscriptores VIP.' };
    // Los niveles locales sólo sirven para contenido explícitamente simulado.
    const tier = root.sim ? (this.subscriptionTier?.(profile.uid, root.uid) || 0) : 0;
    const required = Math.max(this.audienceTier(root), superComment ? 3 : 1);
    return { ok: tier >= required, tier, message: superComment ? 'Necesitás una suscripción VIP activa para dejar un supercomentario.' : 'Necesitás una suscripción Fan o superior activa con este artista para comentar.' };
  }

  isSuperComment(post) {
    const root = this.rootOf(post);
    return !!post.superComment && !!root?.sim && (this.subscriptionTier?.(post.uid, root.uid) || 0) >= 3;
  }

  // lanzamientos del catálogo de prueba como eventos derivados. Se llama sin esperar (no frena el feed).
  loadCatalog() {
    if (!TEST_CATALOG) return Promise.resolve();
    this.catalogP ||= testReleases().then(async (rels) => {
      for (const ev of catalogEvents(rels)) {
        const saved = this.list.find((p) => p.id === ev.id);
        if (!saved) { this.derived.set(ev.id, ev); continue; }
        // prevalece Apple: título y carátula actuales (nunca el texto de las respuestas)
        if (saved.catalog?.title !== ev.catalog.title || saved.catalog?.artwork !== ev.catalog.artwork) {
          saved.catalog = { ...saved.catalog, ...ev.catalog };
          saved.author = ev.author;
          await db.put('posts', saved).catch(() => {});
        }
      }
      this.emit(true);
    }).catch((err) => console.warn('[posts] catálogo', err));
    return this.catalogP;
  }

  // eventos de catálogo visibles en el feed: derivados + guardados dentro de la ventana o con respuesta/repost
  catalogFeed(now = Date.now()) {
    if (!TEST_CATALOG) return [];
    const saved = this.list.filter((p) => p.kind === 'catalog' && (now - p.created <= CATALOG_DAYS * 864e5 || p.reposts?.length || this.replyCount(p.id)));
    const ids = new Set(saved.map((p) => p.id));
    return [...[...this.derived.values()].filter((p) => !ids.has(p.id)), ...saved];
  }

  // eventos de un artista de catálogo para su perfil (hasta 10; los que tienen respuesta o repost se conservan)
  catalogOf(artistId, now = Date.now()) {
    const uid = `am:${artistId}`;
    return this.catalogFeed(now).filter((p) => p.uid === uid).sort((a, b) => b.created - a.created).slice(0, 10);
  }

  // el evento se escribe en `posts` recién con la primera interacción (sin cloudSet)
  async ensure(id) {
    const have = this.list.find((p) => p.id === id);
    if (have) return have;
    const d = this.derived.get(id);
    if (!d) return null;
    await db.put('posts', d);
    this.derived.delete(id);
    const existing = this.list.find((p) => p.id === id);
    if (existing) return existing;
    this.list.push(d);
    this.list.sort((a, b) => b.created - a.created);
    return d;
  }

  // detail.sim = el cambio lo hizo el simulador (la interfaz no re-dibuja, sólo actualiza en su lugar)
  emit(sim = false) { this.dispatchEvent(new CustomEvent('change', { detail: { sim } })); }

  async load() {
    const [local, profiles] = await Promise.all([db.all('posts'), db.all('profiles')]);
    let remote = [];
    try { remote = (await cloudRecent(this.auth, 'posts', 'created', 100)) || []; } catch (err) { console.warn('[posts] nube', err); }
    const byId = new Map([...local, ...remote].map((p) => [p.id, p]));
    this.list = [...byId.values()].sort((a, b) => b.created - a.created);
    for (const p of profiles) this.authors.set(p.uid, p);
    for (const p of remote) if (p.author && !this.authors.has(p.uid)) this.authors.set(p.uid, p.author);
    this.emit();
    this.loadCatalog();
    this.loadCloud();
  }

  author(uid) { return this.authors.get(uid) || null; }

  // en el perfil el anclado va siempre primero
  byUser(uid) { return this.list.filter((p) => p.uid === uid && !p.replyTo && this.visible(p)).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)); }

  // opts: { replyTo, repostOf, created, sim } — respuestas y reposts son publicaciones con referencia
  async create(profile, text, attach = null, opts = {}) {
    if (!profile?.uid || this.auth?.user?.uid !== profile.uid) throw new Error('Iniciá sesión para participar.');
    if (this.cloudUser && !opts.sim) return this.createCloud(profile, text, attach, opts);
    if (opts.replyTo && this.get(opts.replyTo)?.cloud) throw new Error('Ingresá con tu cuenta de ZUENA en la nube para comentar.');
    if (opts.repostOf) {
      const original = this.get(opts.repostOf);
      if (opts.replyTo || String(text).trim() || attach || !original || !this.visible(original) || this.audienceTier(original)) {
        throw new Error('Sólo podés compartir una publicación pública disponible.');
      }
    }
    if (opts.replyTo) {
      const access = this.commentAccess(profile, this.get(opts.replyTo), !!opts.superComment);
      if (!access.ok) throw new Error(access.message);
      if (this.rootOf(this.get(opts.replyTo))?.uid === profile.uid) {
        const claim = await db.get('claims', profile.uid);
        if (claim?.status !== 'approved') throw new Error('Sólo los artistas verificados pueden responder en sus publicaciones.');
      }
    } else if (!opts.repostOf) {
      const claim = await db.get('claims', profile.uid);
      if (profile.role !== 'artist' || claim?.status !== 'approved') throw new Error('Sólo los artistas verificados pueden publicar en el feed.');
    }
    if (this.auth?.user?.uid !== profile.uid) throw new Error('La sesión cambió. Volvé a intentarlo.');
    if (String(text).length > POST_MAX) throw new Error('La publicación puede tener hasta 280 caracteres.');
    const body = text.trim().slice(0, POST_MAX);
    if (!body && !attach && !opts.repostOf) return null;
    // responder o repostear un evento de catálogo lo guarda (con su id estable)
    if (opts.replyTo) await this.ensure(opts.replyTo);
    if (opts.repostOf) await this.ensure(opts.repostOf);
    const post = {
      id: crypto.randomUUID(),
      uid: profile.uid,
      text: body,
      attach,
      likes: [],
      reposts: [],
      replyTo: opts.replyTo || null,
      superComment: !!opts.replyTo && !!opts.superComment,
      repostOf: opts.repostOf || null,
      sim: !!opts.sim,
      created: opts.created || Date.now(),
      ...(opts.audience && opts.audience !== 'public' ? { audience: opts.audience, teaser: String(opts.teaser || '').slice(0, 80) } : {}),
      // copia mínima del autor para mostrarlo en otros equipos (modo nube)
      author: {
        uid: profile.uid,
        displayName: profile.displayName,
        username: profile.username,
        avatar: profile.avatar,
        role: profile.role,
        isOfficialTeam: !!profile.isOfficialTeam,
        isOwnerProfile: !!profile.isOwnerProfile,
        isAdminProfile: !!profile.isAdminProfile,
      },
    };
    await db.put('posts', post);
    this.authors.set(profile.uid, profile);
    this.list.push(post);
    this.list.sort((a, b) => b.created - a.created);
    this.emit(!!opts.sim);
    cloudSet(this.auth, 'posts', post.id, post).catch((err) => console.warn('[posts] no se sincronizó', err));
    return post;
  }

  // publicación en la nube (sin reposts ni exclusivos por ahora)
  async createCloud(profile, text, attach, opts) {
    if (opts.repostOf) throw new Error('Compartir publicaciones todavía no está disponible en la nube.');
    const parent = opts.replyTo && this.get(opts.replyTo);
    if (opts.replyTo) {
      if (!parent?.cloud) throw new Error('Sólo podés responder publicaciones de la nube con esta cuenta.');
      const access = this.commentAccess(profile, parent, !!opts.superComment);
      if (!access.ok) throw new Error(access.message);
    } else if (!this.canCloudPost(profile)) throw new Error('Para publicar en el feed elegí el tipo de cuenta Artista en tu perfil.');
    if (String(text).length > POST_MAX) throw new Error('La publicación puede tener hasta 280 caracteres.');
    const body = String(text).trim();
    const trackId = attach?.item?.cloudId || null;
    if (attach && !trackId) throw new Error('Desde la nube sólo podés adjuntar canciones subidas a la nube.');
    if (!body && !trackId) return null;
    const post = await nube.createPost(profile.uid, { text: body, trackId, replyTo: opts.replyTo || null });
    if (this.auth?.user?.uid !== profile.uid) return null;
    this.authors.set(profile.uid, this.authors.get(profile.uid) || post.author);
    this.list = [post, ...this.list.filter((p) => p.id !== post.id)].sort((a, b) => b.created - a.created);
    this.emit();
    return post;
  }

  // post con id fijo (p. ej. `rel-<id>` de un lanzamiento): crear o actualizar, nunca duplicar
  async upsert(post) {
    const prev = this.list.find((p) => p.id === post.id) || (await db.get('posts', post.id));
    const next = { likes: [], pinned: null, ...prev, ...post };
    await db.put('posts', next);
    this.list = [next, ...this.list.filter((p) => p.id !== post.id)].sort((a, b) => b.created - a.created);
    if (next.author && !this.authors.has(next.uid)) this.authors.set(next.uid, next.author);
    this.emit();
    if (next.kind !== 'catalog') cloudSet(this.auth, 'posts', next.id, next).catch(() => {});
    return next;
  }

  pinnedOf(uid) { return this.list.find((p) => p.uid === uid && p.pinned) || null; }

  // un solo post anclado por autor: anclar uno desancla el anterior
  async pin(id, uid, on = true) {
    if (this.get(id)?.cloud) throw new Error('Anclar todavía no está disponible en la nube.');
    for (const p of this.list.filter((x) => x.uid === uid && (x.pinned || x.id === id))) {
      p.pinned = on && p.id === id ? Date.now() : null;
      await db.put('posts', p);
      cloudSet(this.auth, 'posts', p.id, { pinned: p.pinned }).catch(() => {});
    }
    this.emit();
  }

  async toggleLike(id, uid, on = null, sim = false) {
    const p = this.list.find((x) => x.id === id) || (await this.ensure(id));
    if (!p) return;
    if (p.cloud) return this.toggleCloudLike(p, uid, on, sim);
    const likes = [...(p.likes || [])];
    const i = likes.indexOf(uid);
    if (on === null ? i >= 0 : !on) { if (i >= 0) likes.splice(i, 1); } else if (i < 0) likes.push(uid);
    await db.put('posts', { ...p, likes });
    p.likes = likes;
    this.emit(sim);
    if (p.kind !== 'catalog') cloudSet(this.auth, 'posts', id, { likes: p.likes }).catch(() => {});
  }

  async toggleCloudLike(p, uid, on, sim) {
    if (sim) return; // el simulador nunca escribe en la nube
    if (!this.cloudUser || uid !== this.cloudUser) throw Object.assign(new Error('nube'), { cloudMessage: 'Ingresá con tu cuenta de ZUENA en la nube para dar Me gusta.' });
    const had = p.likes.includes(uid);
    const want = on === null ? !had : !!on;
    if (want === had) return;
    await nube.setLike(uid, p.id, want);
    p.likes = want ? [...p.likes, uid] : p.likes.filter((u) => u !== uid);
    this.emit();
  }

  // repostear = guardar el uid en el original (contador) y una publicación propia que lo referencia.
  // Un exclusivo no se puede repostear (filtraría su contenido).
  async toggleRepost(id, profile) {
    const p = (await this.ensure(id)) || this.get(id);
    if (!p || this.audienceTier(p)) return;
    if (p.cloud) throw Object.assign(new Error('nube'), { cloudMessage: 'Compartir publicaciones todavía no está disponible en la nube.' });
    if (!profile?.uid || this.auth?.user?.uid !== profile.uid) throw new Error('Iniciá sesión para compartir.');
    p.reposts ||= [];
    const i = p.reposts.indexOf(profile.uid);
    if (i >= 0) {
      const mine = this.list.find((x) => x.repostOf === id && x.uid === profile.uid && !x.text);
      if (mine) await this.remove(mine.id);
      p.reposts.splice(i, 1);
    } else {
      await this.create(profile, '', null, { repostOf: id, sim: profile.sim });
      p.reposts.push(profile.uid);
    }
    await db.put('posts', p);
    this.emit(!!profile.sim);
  }

  // seguidos (por cuenta, en este equipo)
  async loadFollows(uid) {
    this.me = uid;
    this.following = new Set((uid && (await db.kvGet(`follows:${uid}`))) || []);
    this.cloudFollowing = new Set();
    if (uid && this.cloudUser === uid) {
      try { this.cloudFollowing = new Set(await nube.fetchFollows(uid)); } catch (err) { console.warn('[posts] seguidos de la nube', err); }
    }
  }
  isFollowing(uid) { return !!this.following?.has(uid) || this.cloudFollowing.has(uid); }
  // `uid` puede ser un uid de ZUENA o `am:<artistId>` (artista del catálogo). Si no se puede guardar,
  // el estado no cambia y se lanza el error (la interfaz avisa "No se pudo guardar. Probá de nuevo.").
  async toggleFollow(uid) {
    if (!this.me || uid === this.me) return false;
    // perfiles de la nube: tabla follows (sólo con cuenta de la nube)
    if (this.author(uid)?.cloud) {
      if (this.cloudUser !== this.me) throw Object.assign(new Error('nube'), { cloudMessage: 'Ingresá con tu cuenta de ZUENA en la nube para seguir a esta persona.' });
      const on = !this.cloudFollowing.has(uid);
      await nube.setFollow(this.me, uid, on);
      if (on) this.cloudFollowing.add(uid); else this.cloudFollowing.delete(uid);
      this.emit();
      return on;
    }
    this.following ||= new Set();
    const had = this.following.has(uid);
    if (had) this.following.delete(uid); else this.following.add(uid);
    try { await db.kvSet(`follows:${this.me}`, [...this.following]); } catch (err) {
      if (had) this.following.add(uid); else this.following.delete(uid);
      throw err;
    }
    this.emit();
    return this.following.has(uid);
  }

  get(id) { return (id && (this.list.find((x) => x.id === id) || this.derived.get(id))) || null; }
  repliesOf(id) { return this.list.filter((p) => p.replyTo === id && this.visible(p)).sort((a, b) => Number(this.isSuperComment(b)) - Number(this.isSuperComment(a)) || a.created - b.created || String(a.id).localeCompare(String(b.id))); }
  replyCount(id) { let n = 0; for (const p of this.list) if (p.replyTo === id) n++; return n; }

  // publicaciones de primer nivel (sin respuestas). Los reposts aparecen como tarjeta del original.
  timeline(testCatalog = TEST_CATALOG) { return this.list.filter((p) => !p.replyTo && this.visible(p, testCatalog)); }

  // ranking 'Para vos': interacción con caída por antigüedad (estilo 'hot')
  score(p, now = Date.now()) {
    const hours = Math.max(0, (now - p.created) / 3600e3);
    const eng = (p.likes?.length || 0) + 2 * (p.reposts?.length || 0) + 1.5 * this.replyCount(p.id);
    return (1 + eng) / Math.pow(hours + 2, 1.35);
  }

  popular(n = 5, withinHours = 72) {
    const now = Date.now();
    return this.list.filter((p) => !p.replyTo && !p.repostOf && p.text && !tierOf(p) && p.kind !== 'catalog' && now - p.created < withinHours * 3600e3)
      .sort((a, b) => ((b.likes?.length || 0) + 2 * (b.reposts?.length || 0)) - ((a.likes?.length || 0) + 2 * (a.reposts?.length || 0))).slice(0, n);
  }

  // tendencias: hashtags de las últimas 72 h por cantidad de publicaciones
  trends(n = 6) {
    const since = Date.now() - 72 * 3600e3, count = new Map();
    for (const p of this.list) {
      if (p.created < since || !p.text || this.audienceTier(p) || !this.visible(p)) continue;
      for (const m of p.text.matchAll(/#([\p{L}\p{N}_]{2,40})/gu)) count.set(m[1], (count.get(m[1]) || 0) + 1);
    }
    return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([tag, posts]) => ({ tag, posts }));
  }

  // borra todo lo simulado (publicaciones de prueba)
  async clearSim() {
    const sim = this.list.filter((p) => p.sim);
    for (const p of sim) await db.del('posts', p.id);
    this.list = this.list.filter((p) => !p.sim);
    // me gusta y reposts de personajes ficticios sobre publicaciones reales y eventos de catálogo
    for (const p of [...this.list, ...this.derived.values()]) {
      const likes = (p.likes || []).filter((u) => !String(u).startsWith('sim-'));
      const reposts = (p.reposts || []).filter((u) => !String(u).startsWith('sim-'));
      if (likes.length === (p.likes || []).length && reposts.length === (p.reposts || []).length) continue;
      p.likes = likes; p.reposts = reposts;
      if (this.list.includes(p)) await db.put('posts', p);
    }
    this.emit();
    return sim.length;
  }

  async remove(id) {
    if (this.get(id)?.cloud) {
      await nube.deletePost(id);
      this.list = this.list.filter((p) => p.id !== id && p.replyTo !== id);
      this.emit();
      return;
    }
    // también los reposts sin texto que apuntan a ella (si no, quedan huérfanos en IndexedDB)
    const orphans = this.list.filter((p) => p.repostOf === id && !p.text);
    for (const o of orphans) await db.del('posts', o.id);
    await db.del('posts', id);
    const gone = new Set([id, ...orphans.map((o) => o.id)]);
    this.list = this.list.filter((p) => !gone.has(p.id));
    this.emit();
    cloudDelete(this.auth, 'posts', id).catch(() => {});
  }
}

// texto plano → HTML seguro con enlaces, @menciones y #hashtags resaltados
export function richText(text, esc) {
  return esc(text)
    .replace(/(https:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|\s)@([a-z0-9._]{3,20})/gi, '$1<span class="mention">@$2</span>')
    .replace(/(^|\s)#([\p{L}\p{N}_]{2,40})/gu, '$1<button class="hashtag" data-action="feed-tag" data-tag="$2">#$2</button>')
    .replace(/\n/g, '<br>');
}

export function timeAgo(ts) {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'ahora';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} d`;
  return new Date(ts).toLocaleDateString('es', { day: 'numeric', month: 'short' });
}
