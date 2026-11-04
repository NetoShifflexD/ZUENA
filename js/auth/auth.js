// Cuentas de ZUENA.
// · Modo firebase (si js/config.js tiene config): correo/contraseña + Google reales.
// · Modo local: cuentas guardadas en este equipo; contraseñas con PBKDF2-SHA256 (210k iteraciones).
import { db } from '../store/db.js';
import { FIREBASE_CONFIG, FIREBASE_VERSION, ADMIN_EMAILS, OWNER_EMAIL, ZUENA_OFFICIAL_UID, ZUENA_OFFICIAL_EMAIL } from '../config.js';
import { createGuest, guestValid, isGuest, watchGuest } from './guest.js';
import { supabaseEnabled, supa } from '../data/supabase.js';

// Modo nube (Supabase): correo + contraseña reales y enlace de acceso por correo. Convive con el modo local
// (cuentas de este equipo) y el invitado: con Supabase configurado, crear cuenta va a la nube; iniciar sesión
// prueba la nube y, si el correo no existe ahí, una cuenta local de este equipo.
const SUPA_ERRORS = {
  user_already_exists: ['email', 'Ya existe una cuenta con ese correo'],
  email_exists: ['email', 'Ya existe una cuenta con ese correo'],
  email_address_invalid: ['email', 'Ingresá un correo válido'],
  validation_failed: ['email', 'Ingresá un correo válido'],
  weak_password: ['password', 'La contraseña es muy débil'],
  invalid_credentials: ['password', 'Correo o contraseña incorrectos'],
  email_not_confirmed: ['email', 'Confirmá tu correo: te enviamos un enlace al crear la cuenta.'],
  over_email_send_rate_limit: ['form', 'Se enviaron muchos correos. Probá de nuevo en unos minutos'],
  over_request_rate_limit: ['form', 'Demasiados intentos. Probá de nuevo en unos minutos'],
  email_address_not_authorized: ['email', 'La nube todavía no puede enviar correos a esa dirección. Avisanos para habilitarla.'],
  signup_disabled: ['form', 'Por ahora no se pueden crear cuentas nuevas'],
  otp_disabled: ['email', 'No hay ninguna cuenta con ese correo'],
  same_password: ['password', 'La contraseña nueva tiene que ser distinta de la anterior'],
};

export function supaError(err) {
  const known = SUPA_ERRORS[err?.code];
  if (known) return new AuthError(known[0], known[1]);
  if (err?.status === 0 || /fetch|network/i.test(err?.message || '')) return new AuthError('form', 'Sin conexión. Revisá tu internet');
  if (/confirm/i.test(err?.message || '')) return new AuthError('email', SUPA_ERRORS.email_not_confirmed[1]);
  return new AuthError('form', 'No se pudo completar. Intentá de nuevo');
}

// dirección a la que vuelven los enlaces de los correos (confirmación, acceso, recuperación)
const backUrl = () => location.origin + location.pathname;

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const enc = new TextEncoder();
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// Credenciales PBKDF2-SHA256 (210k iteraciones) precalculadas para la cuenta Propietario/Owner
// sincronizada con Supabase Auth (id: bf3b1550-da87-4443-a8ba-0ae542fed5dd).
const OWNER_UID = 'bf3b1550-da87-4443-a8ba-0ae542fed5dd';
const OWNER_SALT = 'enVlbmEtb3duZXItMjAyNg==';
const OWNER_HASH = '3ufigGc4AIdoCcXsnSHONlh9EbMgGFhCq9aTRz9jDnc=';

async function putAccountSafely(acc) {
  const email = String(acc.email || '').trim().toLowerCase();
  if (email) {
    const existing = await db.byIndex('accounts', 'email', email).catch(() => []);
    for (const old of existing) {
      if (old.uid !== acc.uid) await db.del('accounts', old.uid).catch(() => {});
    }
  }
  await db.put('accounts', { ...acc, email });
}

export async function ensureZuenaAccount() {
  const zuUid = ZUENA_OFFICIAL_UID;
  const zuEmail = ZUENA_OFFICIAL_EMAIL.trim().toLowerCase();
  const now = Date.now();
  await putAccountSafely({
    uid: zuUid,
    email: zuEmail,
    hash: OWNER_HASH,
    salt: OWNER_SALT,
    provider: 'password',
    role: 'admin',
    isAdmin: true,
    isOfficialTeam: true,
    emailVerified: true,
    created: now - 86400e3 * 21,
  });
  const curZuProf = await db.get('profiles', zuUid).catch(() => null);
  if (!curZuProf || !curZuProf.isOfficialTeam || !curZuProf.avatar) {
    await db.put('profiles', {
      uid: zuUid,
      username: 'zuena',
      displayName: 'ZUENA',
      bio: curZuProf?.bio || 'Perfil exclusivo del Equipo de ZUENA · Sonido de estudio en 24-bit, lanzamientos originales, estrenos inmersivos y anuncios oficiales de la plataforma.',
      avatar: 'brand/logo.svg',
      cover: curZuProf?.cover || 'brand/cover-zuena.svg',
      theme: 'prisma',
      accent: null,
      mode: 'light',
      font: 'syne',
      role: 'artist',
      accountType: 'artist',
      accountTypeSet: true,
      isOfficialTeam: true,
      isAdminProfile: true,
      exclusive: true,
      prisma: true,
      onboarded: true,
      created: now - 86400e3 * 21,
      updated: now,
    });
  }
  const curZuClaim = await db.get('claims', zuUid).catch(() => null);
  if (!curZuClaim || curZuClaim.status !== 'approved') {
    await db.put('claims', {
      uid: zuUid,
      artistName: 'ZUENA',
      legalName: 'Equipo de ZUENA',
      email: zuEmail,
      country: 'AR',
      genres: ['Editorial', 'Sesiones ZUENA', 'Alta Fidelidad'],
      bio: 'Equipo oficial y dirección editorial de ZUENA.',
      links: { web: 'https://netoshifflexd.github.io/ZUENA/' },
      status: 'approved',
      verification: 'full',
      created: now - 86400e3 * 21,
      updated: now,
    });
  }
}

export async function ensureOwnerAndInitialUsers() {
  await ensureZuenaAccount().catch(() => {});
  if (!OWNER_EMAIL) return;
  try {
    const email = OWNER_EMAIL.trim().toLowerCase();
    const existing = await db.byIndex('accounts', 'email', email).catch(() => []);
    const ownerAcc = existing.find((a) => !isGuest(a));
    const uid = ownerAcc?.uid || OWNER_UID;
    const now = Date.now();
    await putAccountSafely({
      uid,
      email,
      hash: OWNER_HASH,
      salt: OWNER_SALT,
      provider: 'password',
      role: 'owner',
      isOwner: true,
      isAdmin: true,
      emailVerified: true,
      created: ownerAcc?.created || now - 86400e3 * 14,
    });
    const curProf = await db.get('profiles', uid);
    if (!curProf || !curProf.onboarded || !curProf.isOwnerProfile || !curProf.isAdminProfile) {
      await db.put('profiles', {
        uid,
        username: curProf?.username || 'netostars',
        displayName: curProf?.displayName || 'Luciano Bengolea',
        bio: curProf?.bio || 'Fundador y administrador de ZUENA · Plataforma de música, sonido de alta fidelidad y comunidad de artistas.',
        avatar: curProf?.avatar || null,
        cover: curProf?.cover || null,
        theme: curProf?.theme || 'prisma',
        accent: curProf?.accent || null,
        mode: curProf?.mode || 'light',
        font: curProf?.font || 'syne',
        role: 'artist',
        accountType: 'artist',
        accountTypeSet: true,
        isOwnerProfile: true,
        isAdminProfile: true,
        prisma: true,
        onboarded: true,
        created: curProf?.created || now - 86400e3 * 14,
        updated: now,
      });
    }
    const curClaim = await db.get('claims', uid);
    if (!curClaim || curClaim.status !== 'approved') {
      await db.put('claims', {
        uid,
        artistName: 'Luciano Bengolea',
        legalName: 'Luciano Agustín Bengolea',
        email,
        country: 'AR',
        genres: ['Electrónica', 'Urbano', 'Alternativo'],
        bio: 'Fundador y creador en ZUENA.',
        links: { instagram: 'https://instagram.com/netostars' },
        status: 'approved',
        verification: 'full',
        created: now - 86400e3 * 14,
        updated: now,
      });
    }
    const curTaste = await db.kvGet(`taste:${uid}`);
    if (!curTaste?.done) {
      await db.kvSet(`taste:${uid}`, {
        uid,
        done: true,
        region: 'AR',
        genres: { urbano: 5, pop: 4, electronic: 5, rock: 3, indie: 4 },
        artists: {},
        tracks: {},
        updated: now,
      });
    }
    // Perfil oficial y exclusivo de ZUENA (@zuena · Equipo de Zuena · Administración)
    const zuUid = ZUENA_OFFICIAL_UID;
    const zuEmail = ZUENA_OFFICIAL_EMAIL.trim().toLowerCase();
    await putAccountSafely({
      uid: zuUid,
      email: zuEmail,
      hash: OWNER_HASH,
      salt: OWNER_SALT,
      provider: 'password',
      role: 'admin',
      isAdmin: true,
      isOfficialTeam: true,
      emailVerified: true,
      created: now - 86400e3 * 21,
    });
    const curZuProf = await db.get('profiles', zuUid);
    if (!curZuProf || !curZuProf.isOfficialTeam || !curZuProf.avatar) {
      await db.put('profiles', {
        uid: zuUid,
        username: 'zuena',
        displayName: 'ZUENA',
        bio: curZuProf?.bio || 'Perfil exclusivo del Equipo de ZUENA · Sonido de estudio en 24-bit, lanzamientos originales, estrenos inmersivos y anuncios oficiales de la plataforma.',
        avatar: 'brand/logo.svg',
        cover: curZuProf?.cover || 'brand/cover-zuena.svg',
        theme: 'prisma',
        accent: null,
        mode: 'light',
        font: 'syne',
        role: 'artist',
        accountType: 'artist',
        accountTypeSet: true,
        isOfficialTeam: true,
        isAdminProfile: true,
        exclusive: true,
        prisma: true,
        onboarded: true,
        created: now - 86400e3 * 21,
        updated: now,
      });
    }
    const curZuClaim = await db.get('claims', zuUid);
    if (!curZuClaim || curZuClaim.status !== 'approved') {
      await db.put('claims', {
        uid: zuUid,
        artistName: 'ZUENA',
        legalName: 'Equipo de ZUENA',
        email: zuEmail,
        country: 'AR',
        genres: ['Editorial', 'Sesiones ZUENA', 'Alta Fidelidad'],
        bio: 'Equipo oficial y dirección editorial de ZUENA.',
        links: { web: 'https://netoshifflexd.github.io/ZUENA/' },
        status: 'approved',
        verification: 'full',
        created: now - 86400e3 * 21,
        updated: now,
      });
    }
    if (!(await db.kvGet(`taste:${zuUid}`))?.done) {
      await db.kvSet(`taste:${zuUid}`, {
        uid: zuUid,
        done: true,
        region: 'AR',
        genres: { electronic: 5, urbano: 5, pop: 5, indie: 5, rock: 4 },
        artists: {},
        tracks: {},
        updated: now,
      });
    }
    const firstUsers = [
      {
        uid: 'zu-sofia-valle',
        username: 'sofiavalle',
        displayName: 'Sofía Valle',
        bio: 'Productora de synth-pop y diseño sonoro desde Buenos Aires. Explorando texturas analógicas en 24-bit.',
        theme: 'aurora',
        mode: 'light',
        font: 'instrument',
        role: 'artist',
        accountType: 'artist',
        accountTypeSet: true,
        onboarded: true,
        created: now - 86400e3 * 7,
        updated: now - 86400e3 * 2,
      },
      {
        uid: 'zu-mateo-soler',
        username: 'mateosoler',
        displayName: 'Mateo Soler',
        bio: 'Coleccionista de vinilos, sesiones nocturnas y curador de playlists en ZUENA.',
        theme: 'cobalt',
        mode: 'light',
        font: 'jakarta',
        role: 'listener',
        accountType: 'listener',
        accountTypeSet: true,
        onboarded: true,
        created: now - 86400e3 * 5,
        updated: now - 86400e3 * 1,
      },
      {
        uid: 'zu-clara-moreno',
        username: 'claramoreno',
        displayName: 'Clara Moreno',
        bio: 'Cantautora indie-folk · Grabaciones acústicas íntimas y cuaderno de estudio.',
        theme: 'amber',
        mode: 'light',
        font: 'fraunces',
        role: 'artist',
        accountType: 'artist',
        accountTypeSet: true,
        onboarded: true,
        created: now - 86400e3 * 4,
        updated: now - 86400e3 * 1,
      },
    ];
    for (const u of firstUsers) {
      if (!(await db.get('profiles', u.uid))) await db.put('profiles', u);
      if (u.role === 'artist' && !(await db.get('claims', u.uid))) {
        await db.put('claims', {
          uid: u.uid,
          artistName: u.displayName,
          legalName: u.displayName,
          email: `${u.username}@zuena.app`,
          country: 'AR',
          genres: ['Indie', 'Electrónica'],
          bio: u.bio,
          links: { instagram: `https://instagram.com/${u.username}` },
          status: 'approved',
          verification: 'full',
          created: u.created,
          updated: u.updated,
        });
      }
    }
    if (!(await db.get('posts', 'zu-post-zuena-1'))) {
      await db.put('posts', {
        id: 'zu-post-zuena-1',
        uid: ZUENA_OFFICIAL_UID,
        text: 'Presentamos la nueva experiencia de Estrenos en ZUENA: tarjetas inmersivas personalizables por cada artista con cuenta regresiva en vivo y avisos directos. Explorá el sonido de estudio en 24-bit. #ZUENA #Estrenos #AltaFidelidad',
        attach: null,
        likes: [uid, 'zu-sofia-valle', 'zu-mateo-soler', 'zu-clara-moreno'],
        reposts: [uid, 'zu-sofia-valle'],
        pinned: true,
        replyTo: null,
        repostOf: null,
        created: now - 3600e3 * 4,
        author: {
          uid: ZUENA_OFFICIAL_UID,
          displayName: 'ZUENA',
          username: 'zuena',
          avatar: 'brand/logo.svg',
          role: 'artist',
          isOfficialTeam: true,
          isAdminProfile: true,
          theme: 'prisma',
        },
      });
    }
    const existingOwnerPost = await db.get('posts', 'zu-post-owner-1');
    if (!existingOwnerPost || !existingOwnerPost.author?.isOwnerProfile) {
      const ownerProfile = await db.get('profiles', uid);
      await db.put('posts', {
        id: 'zu-post-owner-1',
        uid,
        text: 'Bienvenidos a ZUENA. Abrimos este espacio para escuchar con calidad real, descubrir catálogos curados y conectar directo entre artistas y oyentes. #ZUENA #Comunidad',
        attach: null,
        likes: existingOwnerPost?.likes || ['zu-sofia-valle', 'zu-mateo-soler', 'zu-clara-moreno', ZUENA_OFFICIAL_UID],
        reposts: existingOwnerPost?.reposts || ['zu-sofia-valle'],
        pinned: true,
        replyTo: null,
        repostOf: null,
        created: existingOwnerPost?.created || now - 3600e3 * 18,
        author: {
          uid,
          displayName: ownerProfile?.displayName || 'Luciano Bengolea',
          username: ownerProfile?.username || 'netostars',
          avatar: ownerProfile?.avatar || null,
          role: 'artist',
          isOwnerProfile: true,
          isAdminProfile: true,
          theme: ownerProfile?.theme || 'prisma',
        },
      });
    }
    if (!(await db.get('posts', 'zu-post-sofia-1'))) {
      await db.put('posts', {
        id: 'zu-post-sofia-1',
        uid: 'zu-sofia-valle',
        text: 'Terminando las mezclas del nuevo EP con el motor espacial de ZUENA. La diferencia en rango dinámico con el limitador true-peak activado es increíble. #Estudio #Sintetizadores',
        attach: null,
        likes: [uid, 'zu-mateo-soler'],
        reposts: [],
        pinned: false,
        replyTo: null,
        repostOf: null,
        created: now - 3600e3 * 11,
        author: {
          uid: 'zu-sofia-valle',
          displayName: 'Sofía Valle',
          username: 'sofiavalle',
          avatar: null,
          role: 'artist',
          theme: 'aurora',
        },
      });
    }
    if (!(await db.get('posts', 'zu-post-mateo-1'))) {
      await db.put('posts', {
        id: 'zu-post-mateo-1',
        uid: 'zu-mateo-soler',
        text: 'Armando la primera selección de escuchas nocturnas de la semana. Qué limpio se siente navegar sin distracciones. #Playlists #EscuchaActiva',
        attach: null,
        likes: [uid, 'zu-clara-moreno'],
        reposts: [],
        pinned: false,
        replyTo: null,
        repostOf: null,
        created: now - 3600e3 * 6,
        author: {
          uid: 'zu-mateo-soler',
          displayName: 'Mateo Soler',
          username: 'mateosoler',
          avatar: null,
          role: 'listener',
          theme: 'cobalt',
        },
      });
    }
    // Estrenos programados iniciales con tarjetas inmersivas personalizables
    const seededPremieres = [
      {
        id: 'zu-rel-zuena-1',
        uid: ZUENA_OFFICIAL_UID,
        artistName: 'ZUENA',
        title: 'Sesiones ZUENA · Vol. 01 (Master 24-Bit)',
        type: 'ep',
        genre: 'Alta Fidelidad · Electrónica',
        year: 2026,
        credits: 'Grabado y masterizado en el estudio central de ZUENA en 24-bit / 96 kHz.',
        coverUrl: 'brand/premiere-zuena.svg',
        premiereTheme: 'obsidian',
        premiereAccent: '#5ff0ff',
        premiereNote: 'Grabación binaural de estudio sin compresión. Activá el aviso para escuchar el estreno en directo.',
        audioQuality: '24-BIT · 96 KHZ FLAC',
        tracksCount: 4,
        tracks: [],
        status: 'scheduled',
        premiereAt: now + 3600e3 * 14 + 60e3 * 28,
        created: now - 3600e3 * 12,
        updated: now,
      },
      {
        id: 'zu-rel-owner-1',
        uid,
        artistName: 'Luciano Bengolea',
        title: 'Horizonte de Cuarzo',
        type: 'single',
        genre: 'Electrónica · Alternativo',
        year: 2026,
        credits: 'Producción, sintetizadores y mezcla por Luciano Bengolea.',
        coverUrl: 'brand/premiere-owner.svg',
        premiereTheme: 'gold',
        premiereAccent: '#ffd28a',
        premiereNote: 'Un viaje entre texturas analógicas y percusión espacial diseñado para escuchar con auriculares.',
        audioQuality: '24-BIT · LOSSLESS',
        tracksCount: 2,
        tracks: [],
        status: 'scheduled',
        premiereAt: now + 86400e3 * 2 + 3600e3 * 5,
        created: now - 3600e3 * 20,
        updated: now,
      },
      {
        id: 'zu-rel-sofia-1',
        uid: 'zu-sofia-valle',
        artistName: 'Sofía Valle',
        title: 'Arquitectura Nocturna EP',
        type: 'ep',
        genre: 'Synth-Pop · Diseño Sonoro',
        year: 2026,
        credits: 'Sintetizadores modulares y voz por Sofía Valle · Buenos Aires.',
        coverUrl: 'brand/premiere-sofia.svg',
        premiereTheme: 'aurora',
        premiereAccent: '#6ee7b7',
        premiereNote: 'Cinco piezas nocturnas construidas con sintetizadores modulares y espacio acústico real.',
        audioQuality: '24-BIT · 48 KHZ',
        tracksCount: 5,
        tracks: [],
        status: 'scheduled',
        premiereAt: now + 86400e3 * 4 + 3600e3 * 9,
        created: now - 3600e3 * 30,
        updated: now,
      },
    ];
    for (const rel of seededPremieres) {
      const curRel = await db.get('releases', rel.id);
      if (!curRel || curRel.premiereAt <= now + 3600e3) {
        await db.put('releases', curRel ? { ...rel, ...curRel, status: 'scheduled', premiereAt: rel.premiereAt } : rel);
      }
    }
  } catch (err) {
    console.warn('[auth] no se pudo inicializar la base de usuarios inicial', err);
  }
}

async function hashPassword(password, saltB64) {
  const salt = saltB64 ? fromB64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 210000 }, key, 256);
  return { hash: toB64(bits), salt: toB64(salt) };
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export class AuthError extends Error {
  constructor(field, message) {
    super(message);
    this.field = field;
  }
}

const FIREBASE_ERRORS = {
  'auth/email-already-in-use': ['email', 'Ya existe una cuenta con ese correo'],
  'auth/invalid-email': ['email', 'Ingresá un correo válido'],
  'auth/weak-password': ['password', 'La contraseña es muy débil'],
  'auth/invalid-credential': ['password', 'Correo o contraseña incorrectos'],
  'auth/wrong-password': ['password', 'Correo o contraseña incorrectos'],
  'auth/user-not-found': ['email', 'No hay ninguna cuenta con ese correo'],
  'auth/too-many-requests': ['password', 'Demasiados intentos. Probá de nuevo en unos minutos'],
  'auth/popup-closed-by-user': ['google', 'Se cerró la ventana de Google'],
  'auth/popup-blocked': ['google', 'El navegador bloqueó la ventana de Google'],
  'auth/network-request-failed': ['form', 'Sin conexión. Revisá tu internet'],
};

function fbError(err) {
  const [field, msg] = FIREBASE_ERRORS[err?.code] || ['form', 'No se pudo completar. Intentá de nuevo'];
  return new AuthError(field, msg);
}

function validate(email, password) {
  if (!EMAIL_RE.test(email)) throw new AuthError('email', 'Ingresá un correo válido');
  if (password.length < 8) throw new AuthError('password', 'La contraseña necesita al menos 8 caracteres');
}

export class Auth extends EventTarget {
  constructor() {
    super();
    this.user = null;
    this.mode = FIREBASE_CONFIG ? 'firebase' : 'local';
    this.fb = null;
    // Nube de Cloudflare (cloud/worker.js): si la app se sirve desde ahí, Google guarda la cuenta en D1.
    // Los datos (biblioteca, lanzamientos) siguen siendo de este equipo: por eso `mode` sigue en 'local'.
    this.cloud = null; // { clientId, token }
    this.stopGuest = null;
    this.guestPending = null;
    this.generation = 0;
    this.guestMessage = '';
    this.supa = null; // cliente de Supabase cuando cargó
    this.supaReady = false;
  }

  // ¿crear cuenta va a la nube de Supabase?
  get cloudAccounts() { return supabaseEnabled() && this.mode !== 'firebase'; }
  get canGoogle() { return this.mode === 'firebase' || !!this.cloud; }
  // Propietario: sólo con identidad verificada por un proveedor (Supabase con correo confirmado, Firebase o Google
  // en Cloudflare). Una cuenta local se crea en el navegador sin verificar el correo: cualquiera podría usar el de
  // OWNER_EMAIL, así que nunca otorga el rol. La contraseña la elige su dueño al crear la cuenta en la nube.
  get isOwner() {
    const u = this.user;
    if (!u || isGuest(u) || !OWNER_EMAIL) return false;
    const verified = u.mode === 'supabase' || u.mode === 'cloud' || this.mode === 'firebase' || u.ownerVerified === true;
    return verified && String(u.email || '').trim().toLowerCase() === OWNER_EMAIL.toLowerCase();
  }
  get isOfficialTeam() {
    const u = this.user;
    if (!u || isGuest(u)) return false;
    return u.uid === ZUENA_OFFICIAL_UID || u.isOfficialTeam === true || String(u.email || '').trim().toLowerCase() === ZUENA_OFFICIAL_EMAIL.toLowerCase();
  }
  get role() { return isGuest(this.user) ? 'guest' : this.isOwner ? 'owner' : this.isAdmin ? 'admin' : this.user ? 'user' : 'guest'; }
  // Sólo las cuentas del Propietario, del Equipo de ZUENA o de ADMIN_EMAILS verificados tienen permisos de administración
  // y acceso al modo desarrollador. Las cuentas de oyentes o artistas nunca tienen permisos de administración.
  get isAdmin() {
    if (!this.user || isGuest(this.user)) return false;
    if (this.isOwner || this.isOfficialTeam || this.user.isAdmin === true) return true;
    const email = String(this.user.email || '').trim().toLowerCase();
    const verified = this.user.mode === 'supabase' || this.user.mode === 'cloud' || this.mode === 'firebase' || this.user.emailVerified === true;
    return Boolean(verified && email && ADMIN_EMAILS.some((e) => e.toLowerCase() === email));
  }

  // token verificable por el servidor de pagos; las cuentas locales no tienen identidad verificable
  async idToken() {
    if (!this.user || isGuest(this.user) || this.mode !== 'firebase') return null;
    return this.fb?.auth.currentUser?.getIdToken() ?? null;
  }

  set(user) {
    this.stopGuest?.();
    this.stopGuest = null;
    ++this.generation;
    this.user = user;
    if (isGuest(user)) this.stopGuest = watchGuest(user, () => this.verifyGuestSession());
    this.dispatchEvent(new Event('change'));
  }

  checkGuest() {
    const user = this.user;
    if (!isGuest(user) || guestValid(user)) return true;
    this.guestMessage = 'Tu acceso de invitado venció. Podés iniciar un nuevo acceso temporal o ingresar con una cuenta.';
    // Otra pestaña puede haber entrado con otra identidad: no borrar su sesión.
    db.kvGet('session').then((uid) => {
      if (uid === user.uid) return db.kvSet('session', null);
    }).catch(() => {});
    db.put('accounts', { ...user, expired: true }).catch(() => {});
    this.set(null);
    return false;
  }

  async verifyGuestSession() {
    if (!this.checkGuest() || !isGuest(this.user)) return false;
    const user = this.user;
    const generation = this.generation;
    try {
      const session = await db.kvGet('session');
      const acc = await db.get('accounts', user.uid);
      if (generation !== this.generation) return false;
      if (session !== user.uid || !guestValid(acc)) {
        this.guestMessage = 'Este acceso de invitado no está disponible. Volvé a ingresar.';
        this.set(null);
        return false;
      }
      return this.checkGuest();
    } catch {
      if (generation === this.generation) {
        this.guestMessage = 'No pudimos recuperar el acceso de invitado. Probá de nuevo.';
        this.set(null);
      }
      return false;
    }
  }

  guestSignIn() {
    if (this.guestPending) return this.guestPending;
    const generation = this.generation;
    this.guestPending = this.enterGuest(generation).finally(() => { this.guestPending = null; });
    return this.guestPending;
  }

  async enterGuest(generation) {
    if (this.user) return this.user;
    try {
      const uid = await db.kvGet('guestAccount');
      let acc = uid && await db.get('accounts', uid);
      if (!guestValid(acc)) {
        if (isGuest(acc)) await db.put('accounts', { ...acc, expired: true });
        acc = createGuest();
        const accounts = await db.all('accounts');
        while (accounts.some((a) => a.displayName === acc.displayName)) acc = createGuest();
        await db.put('accounts', acc);
      }
      if (!await db.get('profiles', acc.uid)) {
        await db.put('profiles', { uid: acc.uid, displayName: acc.displayName, role: 'listener',
          accountType: 'listener', onboarded: true, created: acc.created, updated: acc.created });
      }
      if (generation !== this.generation || this.user) return null;
      // Un invitado nunca conserva una credencial remota de otra identidad.
      await db.kvSet('cloudToken', null);
      if (this.cloud) this.cloud.token = null;
      await db.kvSet('guestAccount', acc.uid);
      if (generation !== this.generation || this.user) return null;
      await db.kvSet('session', acc.uid);
      if (generation !== this.generation || this.user) return null;
      if (!guestValid(acc)) throw new Error('guest expirado');
      this.guestMessage = '';
      this.set(this.localUser(acc));
      return this.user;
    } catch {
      if (generation === this.generation && !this.user) await db.kvSet('session', null).catch(() => {});
      throw new AuthError('guest', 'No pudimos crear el acceso de invitado. Revisá que el navegador permita guardar datos y probá de nuevo.');
    }
  }

  async init() {
    await ensureZuenaAccount().catch(() => {});
    await ensureOwnerAndInitialUsers().catch(() => {});
    const session = await db.kvGet('session');
    const saved = session && await db.get('accounts', session);
    if (isGuest(saved)) {
      if (guestValid(saved) && await db.get('profiles', saved.uid)) this.set(this.localUser(saved));
      else {
        this.guestMessage = 'Este acceso de invitado no está disponible. Volvé a ingresar.';
        if (saved.expiresAt <= Date.now()) this.guestMessage = 'Tu acceso de invitado venció. Podés iniciar un nuevo acceso temporal o ingresar con una cuenta.';
        await db.kvSet('session', null);
        await db.put('accounts', { ...saved, expired: true });
      }
      return;
    }
    if (saved && saved.uid === ZUENA_OFFICIAL_UID) {
      this.user = this.localUser(saved);
      return;
    }
    if (this.mode === 'firebase') {
      try {
        await this.initFirebase();
        return;
      } catch (err) {
        console.warn('[auth] Firebase no disponible, se usa el modo local', err);
        this.mode = 'local';
      }
    }
    if (this.cloudAccounts) {
      await this.initSupabase();
      if (this.user) return;
    }
    await this.initCloud();
    if (this.user) return;
    const uid = await db.kvGet('session');
    const acc = uid && (await db.get('accounts', uid));
    if (acc) this.user = this.localUser(acc);
  }

  // ---------- nube de Supabase ----------
  // Carga el cliente (con tope de 6 s: sin red o sin CDN la app sigue en modo local) y recupera la sesión,
  // incluida la que llega en el enlace de confirmación o de acceso (detectSessionInUrl).
  async initSupabase() {
    // el cliente limpia la dirección al leer el enlace: se mira antes si es de recuperación
    const recovering = /type=recovery/.test(location.hash);
    try {
      const c = await Promise.race([supa(), new Promise((_, rej) => setTimeout(() => rej(new Error('tiempo agotado')), 6000))]);
      this.supa = c;
      const { data } = await c.auth.getSession();
      const u = data?.session?.user;
      if (u) this.user = this.supaUser(u);
      if (u && recovering) setTimeout(() => this.emitRecovery(), 1500);
      c.auth.onAuthStateChange((event, session) => {
        // fuera del callback: supabase-js no admite otras llamadas suyas dentro de él
        setTimeout(() => this.onSupaEvent(event, session), 0);
      });
      this.supaReady = true;
    } catch (err) {
      console.warn('[auth] nube Supabase no disponible, se usa el modo local', err);
    }
  }

  onSupaEvent(event, session) {
    if (event === 'PASSWORD_RECOVERY') { this.emitRecovery(); return; }
    if (event === 'SIGNED_OUT') { if (this.user?.mode === 'supabase') this.set(null); return; }
    const u = session?.user;
    if (!u || isGuest(this.user) || (this.user && this.user.mode !== 'supabase')) return;
    // otra pestaña o el enlace del correo abrió la sesión
    if (this.user?.uid !== u.id) { db.kvSet('session', null).catch(() => {}); this.set(this.supaUser(u)); }
    else if (event === 'USER_UPDATED') this.user = this.supaUser(u);
  }

  emitRecovery() { if (this.recoveryShown) return; this.recoveryShown = true; this.dispatchEvent(new Event('recovery')); }

  supaUser(u) {
    return { uid: u.id, email: u.email, displayName: u.user_metadata?.display_name || null, provider: 'password',
      emailVerified: !!u.email_confirmed_at, created: Date.parse(u.created_at) || Date.now(), mode: 'supabase' };
  }

  async supaClient() {
    if (this.supa) return this.supa;
    try { this.supa = await supa(); } catch { throw new AuthError('form', 'No se pudo conectar con la nube. Revisá tu internet'); }
    return this.supa;
  }

  // alta en la nube: exige el consentimiento de js/legal/consent.js (casilla del formulario). Como hasta
  // confirmar el correo no hay sesión, el registro viaja en los metadatos de la cuenta y la capa de datos
  // lo copia a la tabla `consents` al crear el perfil (syncConsents en js/data/supabase.js).
  async signUpCloud(email, password) {
    let rec = null, legal = null;
    try { legal = await import('../legal/consent.js'); rec = legal.getPendingConsent(); } catch { legal = null; }
    if (!legal || !legal.hasAcceptedCurrent(rec)) {
      throw new AuthError('consent', legal?.CONSENT_ERROR || 'Para crear tu cuenta tenés que aceptar los términos y la política de privacidad, y confirmar tu edad.');
    }
    const c = await this.supaClient();
    const { data, error } = await c.auth.signUp({ email, password, options: { emailRedirectTo: backUrl(), data: { consent: rec } } });
    if (error) {
      if ((error.code === 'user_already_exists' || error.code === 'email_exists') && (await db.byIndex('accounts', 'email', email)).some((a) => !isGuest(a))) {
        return this.signIn(email, password);
      }
      throw supaError(error);
    }
    legal.clearPendingConsent();
    const uid = data.user?.id || crypto.randomUUID();
    if (uid) legal.saveConsent(uid, rec);
    // Guardamos respaldo local PBKDF2 para que la cuenta pueda operar de inmediato en este dispositivo
    const { hash, salt } = await hashPassword(password);
    const acc = { uid, email, hash, salt, provider: 'password', created: Date.now() };
    await db.put('accounts', acc).catch(() => {});
    if (!data.session) {
      await db.kvSet('session', acc.uid);
      this.set(this.localUser(acc));
      return this.user;
    }
    await db.kvSet('session', null);
    this.set(this.supaUser(data.session.user));
    return this.user;
  }

  // devuelve null si el correo no está en la nube o aún no confirmó enlace pero existe cuenta local verificable
  async signInCloud(email, password) {
    if (email === ZUENA_OFFICIAL_EMAIL.toLowerCase()) return null;
    let c;
    try { c = await this.supaClient(); } catch {
      if ((await db.byIndex('accounts', 'email', email)).some((a) => !isGuest(a))) return null;
      throw new AuthError('form', 'No se pudo conectar con la nube. Revisá tu internet');
    }
    const { data, error } = await c.auth.signInWithPassword({ email, password });
    if (error) {
      const hasLocal = (await db.byIndex('accounts', 'email', email)).some((a) => !isGuest(a));
      if (hasLocal) return null;
      throw supaError(error);
    }
    await db.kvSet('session', null);
    this.set(this.supaUser(data.user));
    return this.user;
  }

  // enlace de acceso por correo (sólo cuentas ya creadas: el alta pasa por el consentimiento)
  async magicLink(email) {
    email = email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new AuthError('email', 'Ingresá tu correo para recibir el enlace');
    if (!this.cloudAccounts) throw new AuthError('email', 'El acceso por enlace necesita la nube');
    const c = await this.supaClient();
    const { error } = await c.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: backUrl() } });
    if (error) throw supaError(error);
  }

  // después del enlace de recuperación (evento 'recovery')
  async updatePassword(password) {
    if (password.length < 8) throw new AuthError('password', 'La contraseña necesita al menos 8 caracteres');
    const c = await this.supaClient();
    const { error } = await c.auth.updateUser({ password });
    if (error) throw supaError(error);
  }

  // ---------- nube de Cloudflare ----------
  async cloudCall(path, { method = 'GET', body } = {}) {
    const headers = {};
    if (body) headers['content-type'] = 'application/json';
    if (this.cloud?.token) headers.authorization = `Bearer ${this.cloud.token}`;
    let r;
    try { r = await fetch(path, { method, headers, body: body && JSON.stringify(body) }); }
    catch { throw new AuthError('google', 'Sin conexión. Revisá tu internet'); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new AuthError('google', data.error?.message || 'No se pudo completar. Intentá de nuevo'), { status: r.status });
    return data;
  }

  async initCloud() {
    if (location.protocol !== 'https:') return; // sólo en el despliegue (serve.ps1 no tiene nube)
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2500);
      const r = await fetch('/api/health', { signal: ctrl.signal });
      clearTimeout(timer);
      const h = r.ok ? await r.json() : null;
      if (!h?.cloud || !h.googleClientId) return;
      this.cloud = { clientId: h.googleClientId, token: await db.kvGet('cloudToken') };
    } catch { return; }
    if (!this.cloud.token) return;
    try { this.user = this.cloudUser((await this.cloudCall('/api/me')).user); }
    catch (err) {
      // sesión vencida o revocada: se descarta; sin red se reintenta en el próximo inicio
      if (err.status === 401) { this.cloud.token = null; await db.kvSet('cloudToken', null); }
    }
  }

  cloudUser(u) {
    return { uid: `g-${u.id}`, email: u.email, displayName: u.profile?.displayName || u.name, photoURL: u.picture, provider: 'google', emailVerified: true, created: u.created, mode: 'cloud' };
  }

  // botón oficial de Google (Google Identity Services) dentro de un diálogo; devuelve el ID token
  async googleCredential() {
    if (!window.google?.accounts?.id) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.async = true;
        s.onload = resolve;
        s.onerror = () => reject(new AuthError('google', 'No se pudo cargar el acceso de Google. Revisá tu conexión'));
        document.head.append(s);
      });
    }
    return new Promise((resolve, reject) => {
      const box = document.createElement('div');
      box.className = 'gsi-overlay';
      box.innerHTML = '<div class="gsi-card glass"><p>Elegí tu cuenta de Google</p><div class="gsi-btn"></div><button type="button" class="link small" data-cancel>Cancelar</button></div>';
      const done = (fn, v) => { box.remove(); fn(v); };
      box.querySelector('[data-cancel]').onclick = () => done(reject, new AuthError('google', 'Se canceló el acceso con Google'));
      document.body.append(box);
      window.google.accounts.id.initialize({
        client_id: this.cloud.clientId,
        callback: (res) => (res?.credential ? done(resolve, res.credential) : done(reject, new AuthError('google', 'Google no devolvió la cuenta'))),
        ux_mode: 'popup',
        cancel_on_tap_outside: false,
      });
      window.google.accounts.id.renderButton(box.querySelector('.gsi-btn'), { theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', locale: 'es' });
    });
  }

  localUser(acc) {
    if (isGuest(acc)) {
      if (!guestValid(acc)) throw new AuthError('guest', 'Este acceso de invitado no está disponible. Volvé a ingresar.');
      return { uid: acc.uid, displayName: acc.displayName, provider: 'guest', mode: 'guest', isGuest: true,
        emailVerified: false, created: acc.created, expiresAt: acc.expiresAt };
    }
    const isVerifiedOwner = Boolean(OWNER_EMAIL && String(acc.email || '').toLowerCase() === OWNER_EMAIL.toLowerCase() && acc.hash === OWNER_HASH && acc.salt === OWNER_SALT);
    const isOfficialTeam = Boolean((acc.uid === ZUENA_OFFICIAL_UID || acc.isOfficialTeam || String(acc.email || '').toLowerCase() === ZUENA_OFFICIAL_EMAIL.toLowerCase()) && acc.hash === OWNER_HASH && acc.salt === OWNER_SALT);
    return {
      uid: acc.uid,
      email: acc.email,
      provider: acc.provider,
      created: acc.created,
      emailVerified: isVerifiedOwner || isOfficialTeam || !!acc.emailVerified,
      ownerVerified: isVerifiedOwner,
      isOfficialTeam,
      isAdmin: isVerifiedOwner || isOfficialTeam || acc.isAdmin === true,
      mode: 'local',
    };
  }

  async switchIdentity(targetUid) {
    if (!this.isOwner && !this.isOfficialTeam) return null;
    const acc = await db.get('accounts', targetUid);
    if (!acc) return null;
    await this.supa?.auth.signOut({ scope: 'local' }).catch(() => {});
    await db.kvSet('session', acc.uid);
    this.set(this.localUser(acc));
    return this.user;
  }

  async initFirebase() {
    const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
    const [{ initializeApp }, A] = await Promise.all([import(`${base}/firebase-app.js`), import(`${base}/firebase-auth.js`)]);
    const fbApp = initializeApp(FIREBASE_CONFIG);
    const auth = A.getAuth(fbApp);
    this.fb = { app: fbApp, auth, A };
    await new Promise((resolve) => {
      let first = true;
      A.onAuthStateChanged(auth, (u) => {
        if (isGuest(this.user)) { if (first) { first = false; resolve(); } return; }
        const user = u ? {
          uid: u.uid,
          email: u.email,
          displayName: u.displayName,
          photoURL: u.photoURL,
          provider: u.providerData.some((p) => p.providerId === 'google.com') ? 'google' : 'password',
          emailVerified: u.emailVerified,
          created: Date.parse(u.metadata.creationTime) || Date.now(),
          mode: 'firebase',
        } : null;
        if (first) { first = false; this.user = user; resolve(); }
        else this.set(user);
      });
    });
  }

  async signUp(email, password) {
    email = email.trim().toLowerCase();
    validate(email, password);
    if (this.mode === 'firebase') {
      if (!this.fb) await this.initFirebase();
      const { A, auth } = this.fb;
      try {
        const cred = await A.createUserWithEmailAndPassword(auth, email, password);
        A.sendEmailVerification(cred.user).catch(() => {});
      } catch (err) { throw fbError(err); }
      return this.user;
    }
    if (this.cloudAccounts) return this.signUpCloud(email, password);
    if ((await db.byIndex('accounts', 'email', email)).length) throw new AuthError('email', 'Ya existe una cuenta con ese correo');
    const { hash, salt } = await hashPassword(password);
    const acc = { uid: crypto.randomUUID(), email, hash, salt, provider: 'password', created: Date.now() };
    await db.put('accounts', acc);
    await db.kvSet('session', acc.uid);
    this.set(this.localUser(acc));
    return this.user;
  }

  async signIn(email, password) {
    email = String(email || '').trim().toLowerCase();
    const isZuenaAlias = ['zuena', '@zuena', 'equipo@zuena.app', 'zuena@zuena.app', 'zuena@zuena.com', 'zuena@gmail.com'].includes(email);
    if (isZuenaAlias) {
      email = ZUENA_OFFICIAL_EMAIL.toLowerCase();
      await ensureZuenaAccount();
    } else if (OWNER_EMAIL && email === OWNER_EMAIL.toLowerCase()) {
      await ensureOwnerAndInitialUsers();
    }
    if (!EMAIL_RE.test(email)) throw new AuthError('email', 'Ingresá un correo válido');
    if (!password) throw new AuthError('password', 'Ingresá tu contraseña');
    if (this.mode === 'firebase') {
      if (!this.fb) await this.initFirebase();
      try { await this.fb.A.signInWithEmailAndPassword(this.fb.auth, email, password); } catch (err) { throw fbError(err); }
      return this.user;
    }
    if (this.cloudAccounts && !isZuenaAlias) {
      const user = await this.signInCloud(email, password);
      if (user) return user;
    }
    let [acc] = await db.byIndex('accounts', 'email', email);
    if (!acc && isZuenaAlias) {
      await ensureZuenaAccount();
      acc = await db.get('accounts', ZUENA_OFFICIAL_UID);
    }
    if (!acc || isGuest(acc)) throw new AuthError('email', 'No hay ninguna cuenta con ese correo en este equipo');
    const { hash } = await hashPassword(password, acc.salt);
    if (!safeEqual(hash, acc.hash)) throw new AuthError('password', 'Contraseña incorrecta');
    // una sesión de la nube que quedara abierta no debe ganarle a la cuenta local al recargar
    await this.supa?.auth.signOut({ scope: 'local' }).catch(() => {});
    await db.kvSet('session', acc.uid);
    this.set(this.localUser(acc));
    return this.user;
  }

  async google() {
    if (this.mode !== 'firebase' && this.cloud) {
      const credential = await this.googleCredential();
      const { token, user } = await this.cloudCall('/api/auth/google', { method: 'POST', body: { credential } });
      this.cloud.token = token;
      await db.kvSet('cloudToken', token);
      this.set(this.cloudUser(user));
      return this.user;
    }
    if (this.mode !== 'firebase') throw new AuthError('google', 'El acceso con Google se activa al conectar Firebase (ver js/config.js)');
    if (!this.fb) await this.initFirebase();
    const { A, auth } = this.fb;
    try { await A.signInWithPopup(auth, new A.GoogleAuthProvider()); } catch (err) { throw fbError(err); }
    return this.user;
  }

  async resetPassword(email) {
    email = email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new AuthError('email', 'Ingresá tu correo para recuperar la contraseña');
    if (this.cloudAccounts) {
      const c = await this.supaClient();
      const { error } = await c.auth.resetPasswordForEmail(email, { redirectTo: backUrl() });
      if (error) throw supaError(error);
      return;
    }
    if (this.mode !== 'firebase') throw new AuthError('email', 'En modo local no se pueden enviar correos de recuperación');
    if (!this.fb) await this.initFirebase();
    try { await this.fb.A.sendPasswordResetEmail(this.fb.auth, email); } catch (err) { throw fbError(err); }
  }

  async signOut() {
    ++this.generation;
    if (isGuest(this.user)) {
      await db.kvSet('session', null);
      await db.kvSet('cloudToken', null);
      if (this.cloud) this.cloud.token = null;
      this.set(null);
      return;
    }
    if (this.mode === 'firebase') await this.fb.A.signOut(this.fb.auth);
    else if (this.user?.mode === 'supabase') {
      await this.supa?.auth.signOut({ scope: 'local' }).catch(() => {});
      this.set(null);
    } else if (this.user?.mode === 'cloud') {
      await this.cloudCall('/api/auth/logout', { method: 'POST' }).catch(() => {});
      this.cloud.token = null;
      await db.kvSet('cloudToken', null);
      window.google?.accounts?.id?.disableAutoSelect();
      this.set(null);
    } else { await db.kvSet('session', null); this.set(null); }
  }
}
