// Base de datos de la nube (Supabase: Postgres + Auth + Storage), 2026-11-02.
// Se activa con SUPABASE_URL y SUPABASE_KEY en js/config.js. La clave es la publicable: la seguridad la dan
// las políticas RLS de cada tabla y de los buckets (cada cuenta sólo escribe lo suyo y en `<uid>/...`).
// Tablas: profiles, consents, tracks, posts, likes, follows. Buckets públicos: audio (50 MB) y covers (5 MB).
// Las funciones de mapeo y validación son puras (tests en js/tests/run.js, área "nube").
import { SUPABASE_URL, SUPABASE_KEY, SUPABASE_JS } from '../config.js';

export const supabaseEnabled = () => !!(SUPABASE_URL && SUPABASE_KEY);

export const AUDIO_MAX = 50 * 1024 * 1024;
export const COVER_MAX = 5 * 1024 * 1024;
export const CLOUD_POST_MAX = 500; // límite de la tabla (la interfaz usa POST_MAX = 280)
const AUDIO_EXT = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/flac': 'flac', 'audio/x-flac': 'flac', 'audio/ogg': 'ogg', 'audio/webm': 'webm' };
const COVER_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

let clientP = null;

// cliente único (supabase-js por CDN con versión fija). Si no carga, se reintenta en la próxima llamada.
export function supa() {
  if (!supabaseEnabled()) return Promise.resolve(null);
  clientP ??= import(SUPABASE_JS)
    .then(({ createClient }) => createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'zuena-nube' },
    }))
    .catch((err) => { clientP = null; throw err; });
  return clientP;
}

// ---------- mapeos (puros) ----------
export function publicUrl(bucket, path, base = SUPABASE_URL) {
  if (!path) return null;
  return `${base}/storage/v1/object/public/${bucket}/${String(path).split('/').map(encodeURIComponent).join('/')}`;
}

export function fromProfileRow(r) {
  if (!r) return null;
  return {
    uid: r.id,
    username: r.username,
    displayName: r.display_name || r.username,
    accountType: r.account_type === 'artist' ? 'artist' : 'listener',
    bio: r.bio || '',
    avatar: r.avatar_url || null,
    // `role` es la verificación de ZUENA (reclamo aprobado): en la nube todavía no existe, nadie lleva la tilde
    role: 'listener',
    cloud: true,
    created: Date.parse(r.created_at) || 0,
  };
}

// sólo se suben URLs https (las imágenes locales en data URL quedan en este equipo)
export function toProfileRow(p) {
  return {
    id: p.uid,
    username: String(p.username || '').toLowerCase(),
    display_name: String(p.displayName || p.username || '').trim().slice(0, 60),
    account_type: p.accountType === 'artist' ? 'artist' : 'listener',
    bio: String(p.bio || '').slice(0, 300),
    avatar_url: /^https:\/\//.test(p.avatar || '') ? p.avatar : null,
  };
}

// pista de la nube → ítem reproducible (mismo formato que las fuentes remotas: `kind: 'remote'` + `stream`)
export function trackItem(r, base = SUPABASE_URL) {
  if (!r) return null;
  return {
    id: `sb:${r.id}`,
    kind: 'remote',
    source: 'zuena',
    type: 'track',
    title: r.title,
    artist: r.artist_name,
    duration: r.duration_s || 0,
    artwork: publicUrl('covers', r.cover_path, base),
    stream: publicUrl('audio', r.audio_path, base),
    cloudId: r.id,
    owner: r.owner,
    visibility: r.visibility,
  };
}

export const PROFILE_COLS = 'id,username,display_name,account_type,bio,avatar_url,created_at';
export const TRACK_COLS = 'id,owner,title,artist_name,audio_path,cover_path,duration_s,rights_declared,visibility,created_at';
export const POST_SELECT = `id,author,text,track_id,reply_to,created_at,profiles!posts_author_fkey(${PROFILE_COLS}),tracks(${TRACK_COLS}),likes(user_id)`;

// fila de posts (con autor, pista y me gusta embebidos) → publicación del feed
export function fromPostRow(r, base = SUPABASE_URL) {
  const a = fromProfileRow(r.profiles);
  const t = r.tracks ? trackItem(r.tracks, base) : null;
  return {
    id: r.id,
    uid: r.author,
    text: r.text || '',
    attach: t ? { type: 'track', item: t } : null,
    likes: (r.likes || []).map((l) => l.user_id),
    reposts: [],
    replyTo: r.reply_to || null,
    repostOf: null,
    sim: false,
    cloud: true,
    created: Date.parse(r.created_at) || Date.now(),
    author: a ? { uid: a.uid, displayName: a.displayName, username: a.username, avatar: a.avatar, role: 'listener', accountType: a.accountType, cloud: true } : { uid: r.author, displayName: 'Usuario', username: '', role: 'listener', cloud: true },
  };
}

export const extOf = (file, map = AUDIO_EXT) => map[file?.type] || (String(file?.name || '').match(/\.([a-z0-9]{2,4})$/i)?.[1] || '').toLowerCase();

// '' si está bien; si no, { field, message }
export function validateTrack({ file, title, artistName, rights, visibility, cover } = {}) {
  if (!file) return { field: 'file', message: 'Elegí un archivo de audio.' };
  if (!AUDIO_EXT[file.type] && !/^(mp3|m4a|aac|wav|flac|ogg|webm)$/.test(extOf(file))) return { field: 'file', message: 'El archivo tiene que ser de audio (MP3, AAC, WAV, FLAC u OGG).' };
  if (file.size > AUDIO_MAX) return { field: 'file', message: 'El audio puede pesar hasta 50 MB.' };
  if (!file.size) return { field: 'file', message: 'El archivo está vacío.' };
  const t = String(title || '').trim();
  if (!t) return { field: 'title', message: 'Poné un título.' };
  if (t.length > 120) return { field: 'title', message: 'El título puede tener hasta 120 caracteres.' };
  const a = String(artistName || '').trim();
  if (!a) return { field: 'artist', message: 'Poné el nombre del artista.' };
  if (a.length > 120) return { field: 'artist', message: 'El nombre puede tener hasta 120 caracteres.' };
  if (visibility !== 'public' && visibility !== 'private') return { field: 'visibility', message: 'Elegí quién puede escucharla.' };
  if (visibility === 'public' && !rights) return { field: 'rights', message: 'Para publicarla tenés que declarar que tenés los derechos.' };
  if (cover && (!COVER_EXT[cover.type] || cover.size > COVER_MAX)) return { field: 'cover', message: 'La portada tiene que ser una imagen JPG, PNG o WebP de hasta 5 MB.' };
  return '';
}

// consentimiento de js/legal/consent.js → filas de `consents` (una por documento aceptado)
export function consentRows(uid, rec) {
  if (!uid || !rec?.ageDeclared) return [];
  return [
    { user_id: uid, kind: 'terms', version: rec.termsVersion, accepted: true },
    { user_id: uid, kind: 'privacy', version: rec.privacyVersion, accepted: true },
    { user_id: uid, kind: 'age', version: `min-${rec.minAge}${rec.minAgeProvisional ? '-provisional' : ''}`, accepted: true },
  ].filter((r) => r.version);
}

// errores de Postgres/Storage → mensaje para la persona
export function dbMessage(err) {
  const code = err?.code || '';
  if (code === '23505') return 'Ese dato ya está en uso.';
  if (code === '42501' || /row-level security|not authorized|unauthorized/i.test(err?.message || '')) return 'No tenés permiso para hacer eso.';
  if (/payload too large|exceeded the maximum/i.test(err?.message || '')) return 'El archivo es demasiado grande.';
  if (/fetch|network/i.test(err?.message || '')) return 'Sin conexión. Revisá tu internet.';
  return 'No se pudo guardar en la nube. Probá de nuevo.';
}

const fail = (err) => { const e = new Error(dbMessage(err)); e.cause = err; e.cloudMessage = e.message; throw e; };

// ---------- perfiles ----------
const profileKnown = new Set();

export async function fetchProfile(uid) {
  const c = await supa();
  const { data, error } = await c.from('profiles').select(PROFILE_COLS).eq('id', uid).maybeSingle();
  if (error) fail(error);
  if (data) profileKnown.add(uid);
  return fromProfileRow(data);
}

// crea o actualiza la fila; si el usuario está tomado, error con code 23505
export async function upsertProfile(profile) {
  const c = await supa();
  const { error } = await c.from('profiles').upsert(toProfileRow(profile), { onConflict: 'id' });
  if (error) { if (error.code === '23505') throw Object.assign(new Error('Ese nombre de usuario ya está en uso.'), { code: '23505' }); fail(error); }
  profileKnown.add(profile.uid);
  await syncConsents(profile.uid).catch((err) => console.warn('[nube] consentimiento', err));
}

export async function usernameTakenCloud(username, uid) {
  const c = await supa();
  const { data, error } = await c.from('profiles').select('id').eq('username', username).limit(1);
  if (error) return false;
  return !!data?.some((r) => r.id !== uid);
}

// las tablas con autor exigen que exista el perfil (claves foráneas)
async function needProfile(uid) {
  if (profileKnown.has(uid)) return;
  if (!(await fetchProfile(uid))) throw Object.assign(new Error('Completá tu perfil antes de participar.'), { cloudMessage: 'Completá tu perfil antes de participar.' });
}

// ---------- consentimiento ----------
// El alta guarda el registro en los metadatos de la cuenta (no hay sesión hasta confirmar el correo);
// al haber perfil, se copia a la tabla `consents` una sola vez.
export async function syncConsents(uid) {
  const c = await supa();
  const { data: { user } } = await c.auth.getUser();
  const rec = user?.id === uid ? user.user_metadata?.consent : null;
  const rows = consentRows(uid, rec);
  if (!rows.length) return 0;
  const { data, error } = await c.from('consents').select('kind,version').eq('user_id', uid);
  if (error) throw error;
  const have = new Set((data || []).map((r) => `${r.kind}:${r.version}`));
  const missing = rows.filter((r) => !have.has(`${r.kind}:${r.version}`));
  if (!missing.length) return 0;
  const { error: e2 } = await c.from('consents').insert(missing);
  if (e2) throw e2;
  return missing.length;
}

// ---------- feed ----------
export async function fetchFeed(limit = 100) {
  const c = await supa();
  const { data, error } = await c.from('posts').select(POST_SELECT).order('created_at', { ascending: false }).limit(limit);
  if (error) fail(error);
  return (data || []).map((r) => fromPostRow(r));
}

export async function createPost(uid, { text = '', trackId = null, replyTo = null } = {}) {
  await needProfile(uid);
  const c = await supa();
  const row = { author: uid, text: String(text).trim().slice(0, CLOUD_POST_MAX), track_id: trackId, reply_to: replyTo };
  const { data, error } = await c.from('posts').insert(row).select(POST_SELECT).single();
  if (error) fail(error);
  return fromPostRow(data);
}

export async function deletePost(id) {
  const c = await supa();
  const { error } = await c.from('posts').delete().eq('id', id);
  if (error) fail(error);
}

export async function setLike(uid, postId, on) {
  await needProfile(uid);
  const c = await supa();
  const { error } = on
    ? await c.from('likes').upsert({ user_id: uid, post_id: postId }, { onConflict: 'user_id,post_id', ignoreDuplicates: true })
    : await c.from('likes').delete().eq('user_id', uid).eq('post_id', postId);
  if (error) fail(error);
}

export async function fetchFollows(uid) {
  const c = await supa();
  const { data, error } = await c.from('follows').select('followee').eq('follower', uid);
  if (error) fail(error);
  return (data || []).map((r) => r.followee);
}

export async function setFollow(uid, followee, on) {
  await needProfile(uid);
  const c = await supa();
  const { error } = on
    ? await c.from('follows').upsert({ follower: uid, followee }, { onConflict: 'follower,followee', ignoreDuplicates: true })
    : await c.from('follows').delete().eq('follower', uid).eq('followee', followee);
  if (error) fail(error);
}

// cambios en vivo (si las tablas están en la publicación de Realtime; si no, no llega nada y no pasa nada)
export async function watchFeed(onChange) {
  const c = await supa();
  const ch = c.channel('zuena-feed')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'likes' }, onChange)
    .subscribe();
  return () => c.removeChannel(ch);
}

// ---------- pistas ----------
export async function myTracks(uid) {
  const c = await supa();
  const { data, error } = await c.from('tracks').select(TRACK_COLS).eq('owner', uid).order('created_at', { ascending: false });
  if (error) fail(error);
  return (data || []).map((r) => trackItem(r));
}

// sube el audio (y la portada) a `<uid>/...` y crea la fila; si algo falla no deja archivos sueltos
export async function uploadTrack(uid, { file, cover = null, title, artistName, rights = false, visibility = 'private', durationS = 0 } = {}, onStep = () => {}) {
  const bad = validateTrack({ file, title, artistName, rights, visibility, cover });
  if (bad) throw Object.assign(new Error(bad.message), { field: bad.field, cloudMessage: bad.message });
  await needProfile(uid);
  const c = await supa();
  const id = crypto.randomUUID();
  const audioPath = `${uid}/${id}.${extOf(file) || 'audio'}`;
  const coverPath = cover ? `${uid}/${id}.${extOf(cover, COVER_EXT)}` : null;
  onStep('audio');
  const up = await c.storage.from('audio').upload(audioPath, file, { contentType: file.type || 'application/octet-stream', upsert: false });
  if (up.error) fail(up.error);
  try {
    if (cover) {
      onStep('cover');
      const uc = await c.storage.from('covers').upload(coverPath, cover, { contentType: cover.type, upsert: false });
      if (uc.error) fail(uc.error);
    }
    onStep('row');
    const row = { owner: uid, title: title.trim(), artist_name: artistName.trim(), audio_path: audioPath, cover_path: coverPath, duration_s: Math.round(durationS) || null, rights_declared: !!rights, visibility };
    const { data, error } = await c.from('tracks').insert(row).select(TRACK_COLS).single();
    if (error) fail(error);
    return trackItem(data);
  } catch (err) {
    await c.storage.from('audio').remove([audioPath]).catch(() => {});
    if (coverPath) await c.storage.from('covers').remove([coverPath]).catch(() => {});
    throw err;
  }
}

export async function deleteTrack(item) {
  const c = await supa();
  const { error } = await c.from('tracks').delete().eq('id', item.cloudId);
  if (error) fail(error);
  const path = (u, bucket) => u && decodeURIComponent(u.split(`/object/public/${bucket}/`)[1] || '');
  await c.storage.from('audio').remove([path(item.stream, 'audio')]).catch(() => {});
  if (item.artwork) await c.storage.from('covers').remove([path(item.artwork, 'covers')]).catch(() => {});
}
