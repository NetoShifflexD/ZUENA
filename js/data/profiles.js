// Perfiles de usuario (oyente o artista). Las imágenes se guardan como data URL WebP comprimido
// para que entren en IndexedDB y en un documento de Firestore (< 1 MB).
import { db } from '../store/db.js';
import { cloudGet, cloudSet, cloudWhere } from './cloud.js';
import { inferAccountType } from './artist.js';
import { fetchProfile, upsertProfile, usernameTakenCloud } from './supabase.js';

const isSupa = (auth) => auth?.user?.mode === 'supabase';

export const USERNAME_RE = /^[a-z0-9._]{3,20}$/;

export function defaultProfile(user) {
  const local = (user.email || 'oyente').split('@')[0].toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 16) || 'oyente';
  return {
    uid: user.uid,
    username: `${local}${Math.floor(Math.random() * 900 + 100)}`,
    displayName: user.displayName || local,
    bio: '',
    avatar: user.photoURL || null,
    cover: null,
    theme: 'prisma',
    accent: null,
    mode: null,
    font: 'Outfit',
    // role = resultado verificado ('artist' sólo con reclamo aprobado); accountType = lo que la persona
    // eligió ser ('listener' | 'artist'; null = sin elegir, se infiere en perfiles previos)
    role: 'listener',
    accountType: null,
    onboarded: false,
    created: Date.now(),
    updated: Date.now(),
  };
}

export async function loadProfile(auth) {
  const user = auth.user;
  const local = await db.get('profiles', user.uid);
  let remote;
  if (isSupa(auth)) {
    // nube Supabase: la fila manda en los datos públicos (usuario, nombre, tipo de cuenta, bio); el resto
    // (tema, portada local, preferencias) queda en este equipo. Si ya hay fila, el perfil ya se creó en otro dispositivo.
    let row = null;
    try { row = await fetchProfile(user.uid); } catch (err) { console.warn('[profiles] nube', err); }
    const base = { ...defaultProfile(user), ...local };
    if (row) {
      const { username, displayName, accountType, bio } = row;
      Object.assign(base, { username, displayName, accountType, bio, cloud: true }, local ? {} : { onboarded: true });
      if (row.avatar && !local?.avatar) base.avatar = row.avatar;
    }
    await db.put('profiles', base);
    return base;
  }
  try { remote = await cloudGet(auth, 'profiles', user.uid); } catch (err) { console.warn('[profiles] nube', err); }
  const best = [local, remote].filter(Boolean).sort((a, b) => (b.updated || 0) - (a.updated || 0))[0];
  const profile = { ...defaultProfile(user), ...best };
  if (!local || local.updated !== profile.updated) await db.put('profiles', profile);
  return profile;
}

export async function saveProfile(auth, profile) {
  profile.updated = Date.now();
  await db.put('profiles', profile);
  // la fila de la nube se crea recién al terminar la bienvenida (la elección Oyente / Artista)
  if (isSupa(auth) && profile.onboarded) {
    // si falla (sin red o usuario tomado) queda guardado en este equipo y se reintenta al volver a guardar
    // o al participar (needProfile avisa "Completá tu perfil antes de participar.")
    try { await upsertProfile(profile); profile.cloud = true; } catch (err) { console.warn('[profiles] no se sincronizó', err); }
    return profile;
  }
  try { await cloudSet(auth, 'profiles', profile.uid, profile); } catch (err) { console.warn('[profiles] no se sincronizó', err); }
  return profile;
}

// alinea `role` con la verificación (sube y baja) e infiere `accountType` en perfiles ya creados.
// Devuelve true si cambió algo (hay que guardar). Puro salvo la mutación del perfil.
export function syncAccount(profile, claim) {
  if (!profile || profile.sim) return false;
  let changed = false;
  const verified = claim?.status === 'approved';
  if (verified && profile.role !== 'artist') { profile.role = 'artist'; changed = true; }
  if (!verified && profile.role === 'artist') { profile.role = 'listener'; changed = true; }
  if (!profile.accountType && profile.onboarded) { profile.accountType = inferAccountType(profile, claim); changed = true; }
  if (verified && profile.accountType !== 'artist') { profile.accountType = 'artist'; changed = true; }
  return changed;
}

// cambia el tipo de cuenta (no toca `role`, que sólo cambia con la verificación)
export async function setAccountType(auth, profile, type, now = Date.now()) {
  if (type !== 'listener' && type !== 'artist') throw new Error('Tipo de cuenta inválido');
  profile.accountType = type;
  profile.accountTypeSet = now;
  return saveProfile(auth, profile);
}

export async function usernameTaken(auth, username, uid) {
  const local = await db.byIndex('profiles', 'username', username);
  if (local.some((p) => p.uid !== uid)) return true;
  if (isSupa(auth)) return usernameTakenCloud(username, uid);
  try {
    const remote = await cloudWhere(auth, 'profiles', 'username', username);
    return !!remote?.some((p) => p.uid !== uid);
  } catch {
    return false;
  }
}

// Recorta al centro (cover) y comprime a WebP
export async function processImage(file, width, height, quality = 0.86) {
  if (!/^image\//.test(file.type)) throw new Error('El archivo no es una imagen');
  const bmp = await createImageBitmap(file);
  const scale = Math.max(width / bmp.width, height / bmp.height);
  const sw = width / scale, sh = height / scale;
  const cv = document.createElement('canvas');
  cv.width = width; cv.height = height;
  const cx = cv.getContext('2d');
  cx.imageSmoothingQuality = 'high';
  cx.drawImage(bmp, (bmp.width - sw) / 2, (bmp.height - sh) / 2, sw, sh, 0, 0, width, height);
  bmp.close();
  return cv.toDataURL('image/webp', quality);
}
