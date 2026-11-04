// Reclamo de perfil de artista y lanzamientos (estilo distribuidora, gratuito).
// Flujo del reclamo: borrador → en revisión → verificado | rechazado.
// Verificación: el artista publica un código único en la bio de una de sus redes y enlaza
// sus perfiles en plataformas musicales; un revisor lo comprueba antes de aprobar.
import { db } from '../store/db.js';
import { premiereError } from './releases.js';
import { cloudGet, cloudSet, cloudWhere } from './cloud.js';
import { EMAIL_RE } from '../auth/auth.js';

export const PLATFORMS = [
  { key: 'spotify', label: 'Spotify', kind: 'music', re: /^https:\/\/open\.spotify\.com\/(intl-[a-z]+\/)?artist\/[A-Za-z0-9]+/i, ph: 'https://open.spotify.com/artist/…' },
  { key: 'appleMusic', label: 'Apple Music', kind: 'music', re: /^https:\/\/music\.apple\.com\/[a-z]{2}\/artist\//i, ph: 'https://music.apple.com/ar/artist/…' },
  { key: 'youtube', label: 'YouTube', kind: 'music', re: /^https:\/\/(www\.|music\.)?youtube\.com\/(@|channel\/|c\/)/i, ph: 'https://youtube.com/@…' },
  { key: 'soundcloud', label: 'SoundCloud', kind: 'music', re: /^https:\/\/(www\.)?soundcloud\.com\/[^/\s]+/i, ph: 'https://soundcloud.com/…' },
  { key: 'bandcamp', label: 'Bandcamp', kind: 'music', re: /^https:\/\/[a-z0-9-]+\.bandcamp\.com/i, ph: 'https://artista.bandcamp.com' },
  { key: 'deezer', label: 'Deezer', kind: 'music', re: /^https:\/\/(www\.)?deezer\.com\/([a-z]{2}\/)?artist\/\d+/i, ph: 'https://deezer.com/artist/…' },
  { key: 'instagram', label: 'Instagram', kind: 'social', re: /^https:\/\/(www\.)?instagram\.com\/[A-Za-z0-9._]+/i, ph: 'https://instagram.com/…' },
  { key: 'tiktok', label: 'TikTok', kind: 'social', re: /^https:\/\/(www\.)?tiktok\.com\/@[A-Za-z0-9._]+/i, ph: 'https://tiktok.com/@…' },
  { key: 'x', label: 'X / Twitter', kind: 'social', re: /^https:\/\/(www\.)?(x|twitter)\.com\/[A-Za-z0-9_]+/i, ph: 'https://x.com/…' },
  { key: 'facebook', label: 'Facebook', kind: 'social', re: /^https:\/\/(www\.)?facebook\.com\/[^/\s]+/i, ph: 'https://facebook.com/…' },
  { key: 'website', label: 'Sitio web', kind: 'web', re: /^https:\/\/[^\s.]+\.[^\s]{2,}/i, ph: 'https://…' },
];

export const GENRES = ['Pop', 'Rock', 'Hip-Hop / Rap', 'Trap', 'Reggaetón', 'R&B / Soul', 'Electrónica', 'House', 'Techno', 'Indie', 'Alternativa', 'Folk', 'Jazz', 'Clásica', 'Cumbia', 'Cuarteto', 'Tango', 'Salsa', 'Metal', 'Punk', 'Lo-fi', 'Ambient', 'Soundtrack', 'Otro'];

export const CLAIM_STATUS = {
  draft: { label: 'Borrador', tone: 'muted' },
  pending: { label: 'En revisión', tone: 'warn' },
  approved: { label: 'Verificado', tone: 'ok' },
  rejected: { label: 'Rechazado', tone: 'bad' },
  needs_info: { label: 'Faltan datos', tone: 'warn' },
  withdrawn: { label: 'Retirado', tone: 'muted' },
  expired: { label: 'Vencido', tone: 'muted' },
  revoked: { label: 'Revocado', tone: 'bad' },
};
// estado desconocido → "Borrador" (lectores viejos y documentos de otra versión)
export const claimStatus = (s) => CLAIM_STATUS[s] || CLAIM_STATUS.draft;

// ---------- reclamo v2 (Requisitos/Perfiles con rol y reclamo de artista) ----------
// Plazos y límites (D6: constantes fáciles de ajustar). En modo local valen "en este equipo".
const DAY = 86400e3;
export const CLAIM_RULES = {
  draftExpireMs: 30 * DAY,      // borrador sin tocar → vencido
  needsInfoExpireMs: 14 * DAY,  // "faltan datos" sin respuesta → vencido
  maxSubmits: 3,                // envíos (o retiros) por ventana móvil
  windowMs: 30 * DAY,
  rejectWaitMs: [DAY, 7 * DAY, 30 * DAY], // tras 1, 2 y 3+ rechazos seguidos
  nameReserveMs: 90 * DAY,      // nombre reservado tras dejar de ser artista
  protectAfter: 3,              // rechazos del mismo artista (cuentas distintas) → protegido
  historyMax: 50,
  noteMin: 5, noteMax: 300,
};

// transiciones válidas (§4.2). revoked → draft sólo como "reclamo nuevo".
const TRANSITIONS = {
  draft: ['pending', 'withdrawn', 'expired'],
  pending: ['approved', 'needs_info', 'rejected', 'withdrawn'],
  needs_info: ['pending', 'withdrawn', 'expired'],
  approved: ['revoked'],
  rejected: ['draft'],
  withdrawn: ['draft'],
  expired: ['draft'],
  revoked: ['draft'],
};
export const claimTransitionAllowed = (from, to) => !!TRANSITIONS[from]?.includes(to);

// estados que ocupan el lugar de un artista (los borradores no bloquean)
export const ACTIVE_FOR_TARGET = new Set(['pending', 'needs_info', 'approved']);

export const normalizeArtistName = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// destino del reclamo; un documento viejo sin `target` es un nombre nuevo
export function claimTarget(c) {
  if (c?.target?.key) return c.target;
  return { kind: 'new', key: `name:${normalizeArtistName(c?.artistName)}`, name: c?.artistName || '' };
}

// evidencia: fuertes = código publicado y correo de dominio propio
export const STRONG_EVIDENCE = new Set(['code', 'email_domain']);
const linkStrength = (key) => (PLATFORMS.find((p) => p.key === key)?.kind === 'music' ? 'media' : 'debil');

// evidencias del reclamo; un documento viejo (sin `evidence`) se adapta desde `links` + `codePlaced`
export function evidenceOf(c) {
  if (Array.isArray(c?.evidence)) return c.evidence;
  const out = Object.entries(c?.links || {}).filter(([, v]) => v).map(([platform, value]) => ({ kind: 'link', platform, value, strength: linkStrength(platform), addedAt: c.created || 0, status: 'unchecked' }));
  if (c?.codePlaced) out.push({ kind: 'code', value: c.code, where: '', addedAt: c.created || 0, status: 'unchecked' });
  return out;
}

// arma la evidencia a partir del formulario conservando lo que el revisor ya comprobó
export function buildEvidence(c, now = Date.now()) {
  const prev = Array.isArray(c.evidence) ? c.evidence : [];
  const keep = (e) => prev.find((p) => p.kind === e.kind && p.value === e.value && (p.where || '') === (e.where || '')) || e;
  const out = Object.entries(c.links || {}).filter(([, v]) => v).map(([platform, value]) => keep({ kind: 'link', platform, value, strength: linkStrength(platform), addedAt: now, status: 'unchecked' }));
  if (c.codeWhere && c.links?.[c.codeWhere]) out.push(keep({ kind: 'code', value: c.code, where: c.codeWhere, addedAt: now, status: 'unchecked' }));
  return out;
}

// ≥ 2 tipos distintos y ≥ 1 fuerte. Para aprobar, la fuerte tiene que estar comprobada (ok / manual_ok).
export function evidenceOk(c, { approval = false } = {}) {
  const ev = evidenceOf(c).filter((e) => e.status !== 'fail');
  const kinds = new Set(ev.map((e) => e.kind));
  const strong = ev.filter((e) => STRONG_EVIDENCE.has(e.kind) && (!approval || e.status === 'ok' || e.status === 'manual_ok'));
  return kinds.size >= 2 && strong.length >= 1;
}

// límites de reenvío (§5.3). attempts = { at:[ts], rejections, rejectedAt, lockUntil }
export function canResubmit(attempts, now = Date.now(), rules = CLAIM_RULES) {
  const a = attempts || {};
  let until = 0, reason = '';
  const recent = (a.at || []).filter((t) => now - t < rules.windowMs).sort((x, y) => x - y);
  if (recent.length >= rules.maxSubmits) { until = recent[recent.length - rules.maxSubmits] + rules.windowMs; reason = 'limit'; }
  const n = a.rejections || 0;
  if (n && a.rejectedAt) {
    const wait = rules.rejectWaitMs[Math.min(n, rules.rejectWaitMs.length) - 1];
    if (a.rejectedAt + wait > now && a.rejectedAt + wait > until) { until = a.rejectedAt + wait; reason = 'wait'; }
  }
  if (a.lockUntil && a.lockUntil > now && a.lockUntil > until) { until = a.lockUntil; reason = 'wait'; }
  return until > now ? { ok: false, until, reason } : { ok: true, until: 0, reason: '' };
}

// poda los intentos de más de 30 días
export const pruneAttempts = (a, now = Date.now(), rules = CLAIM_RULES) => ({ ...(a || {}), at: ((a || {}).at || []).filter((t) => now - t < rules.windowMs) });

// tipo de cuenta: lo que la persona eligió o, si no eligió (perfiles previos), se infiere
export function inferAccountType(profile, claim) {
  if (profile?.accountType === 'artist' || profile?.accountType === 'listener') return profile.accountType;
  return profile?.role === 'artist' || claim?.status === 'approved' ? 'artist' : 'listener';
}
// la pantalla de elección sólo aparece al crear el perfil (no a quien ya está onboarded)
export const needsRoleChoice = (profile) => !!profile && !profile.accountType && !profile.onboarded && !profile.sim;

// nombre artístico: formato y palabras reservadas (la unicidad se mira aparte)
const RESERVED = /\b(oficial|verificado|zuena|admin)\b/;
export function artistNameError(name) {
  const n = String(name || '').trim();
  if (n.length < 2 || n.length > 60 || !/[\p{L}\p{N}]/u.test(n)) return 'Escribí tu nombre artístico';
  if (RESERVED.test(normalizeArtistName(n))) return 'Ese nombre no se puede usar.';
  return '';
}

// ¿el nombre coincide con un artista del catálogo de prueba? (bloquea el tipo `new`)
export const catalogNameMatch = (name, catalogNames = []) => {
  const n = normalizeArtistName(name);
  return !!n && catalogNames.some((c) => normalizeArtistName(c) === n);
};

// el enlace de Apple Music tiene que contener el artistId del perfil am: reclamado
export function appleLinkMatches(url, artistId) {
  if (!url || !artistId || !/^\d+$/.test(String(artistId))) return false;
  return new RegExp(`^https://music\\.apple\\.com/[a-z]{2}/artist/(?:[^/?#]+/)?${artistId}(?:[/?#]|$)`, 'i').test(url);
}

// ¿otro reclamo activo ocupa ese artista? (mismo destino o mismo nombre normalizado). Ignora borradores,
// los de la propia cuenta y las reservas vencidas.
export function claimConflict(claims, c, now = Date.now()) {
  const t = claimTarget(c), name = normalizeArtistName(c.artistName);
  return (claims || []).some((o) => {
    if (!o || o.uid === c.uid) return false;
    const reserved = o.status === 'revoked' && o.revokedBy === 'user' && o.reservedUntil > now;
    if (!ACTIVE_FOR_TARGET.has(o.status) && !reserved) return false;
    return claimTarget(o).key === t.key || (!!name && normalizeArtistName(o.artistName) === name);
  });
}

// artista "protegido": rechazado para 3 cuentas distintas
export function targetProtected(claims, key, rules = CLAIM_RULES) {
  const uids = new Set((claims || []).filter((o) => claimTarget(o).key === key && (o.status === 'rejected' || (o.history || []).some((h) => h.to === 'rejected'))).map((o) => o.uid));
  return uids.size >= rules.protectAfter;
}

// vencimiento automático (§4.2): devuelve 'expired' o null
export function claimExpiry(c, now = Date.now(), rules = CLAIM_RULES) {
  if (!c || c.sim) return null;
  if (c.status === 'draft' && c.updated && now - c.updated > rules.draftExpireMs) return 'expired';
  if (c.status === 'needs_info' && (c.needsInfoAt || c.updated) && now - (c.needsInfoAt || c.updated) > rules.needsInfoExpireMs) return 'expired';
  return null;
}

// agrega una entrada al historial (tope 50) y cambia el estado
export function pushHistory(c, to, by = '', note = '', now = Date.now(), rules = CLAIM_RULES) {
  const h = [...(c.history || []), { at: now, from: c.status, to, by, note }];
  c.history = h.slice(-rules.historyMax);
  c.status = to;
  return c;
}

// reclamo de un perfil del catálogo: Apple Music con ese artistId o un enlace musical comprobado por el revisor
export function catalogLinkOk(c) {
  const t = claimTarget(c);
  if (t.kind !== 'catalog') return true;
  const id = t.key.replace(/^am:/, '');
  return evidenceOf(c).some((e) => e.kind === 'link' && e.status !== 'fail' && ((e.platform === 'appleMusic' && appleLinkMatches(e.value, id)) || (linkStrength(e.platform) === 'media' && (e.status === 'manual_ok' || e.status === 'ok'))));
}

export const noteError = (note, rules = CLAIM_RULES) => {
  const n = String(note || '').trim().length;
  return n < rules.noteMin || n > rules.noteMax ? 'Contale al artista qué falta (mínimo 5 caracteres).' : '';
};

const FREE_DOMAINS = /@(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|icloud|me|mac|proton|protonmail|aol|gmx|yandex|mail|zoho)\./i;
export const isFreeEmail = (email) => FREE_DOMAINS.test(String(email || ''));

function distance(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

// señales para el revisor (§5.4): no bloquean solas
export function abuseSignals(c, others = [], { catalogNames = [], accountCreated = 0, now = Date.now() } = {}) {
  const out = [];
  const name = normalizeArtistName(c.artistName);
  const approved = others.filter((o) => o.uid !== c.uid && o.status === 'approved').map((o) => normalizeArtistName(o.artistName));
  const near = [...approved, ...catalogNames.map(normalizeArtistName)].find((n) => n && n !== name && distance(n, name) <= 2);
  if (near) out.push('Nombre parecido a un artista ya verificado o del catálogo.');
  const mine = new Set(evidenceOf(c).filter((e) => e.kind === 'link').map((e) => e.value));
  if (others.some((o) => o.uid !== c.uid && evidenceOf(o).some((e) => e.kind === 'link' && mine.has(e.value)))) out.push('Un enlace ya se usó como prueba en otra solicitud.');
  if (others.some((o) => o.uid !== c.uid && o.code && o.code === c.code)) out.push('El código aparece en más de una solicitud.');
  if (accountCreated && now - accountCreated < DAY) out.push('Cuenta creada hace menos de 24 horas.');
  if (isFreeEmail(c.email)) out.push('Correo de un dominio gratuito.');
  return out;
}

export const RELEASE_STATUS = {
  draft: { label: 'Borrador', tone: 'muted' },
  review: { label: 'En revisión', tone: 'warn' },
  scheduled: { label: 'Estreno programado', tone: 'warn' },
  published: { label: 'Publicado', tone: 'ok' },
  hidden: { label: 'Oculto', tone: 'muted' },
  withdrawn: { label: 'Retirado', tone: 'bad' },
  rejected: { label: 'Requiere cambios', tone: 'bad' },
};

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeCode() {
  const r = crypto.getRandomValues(new Uint8Array(6));
  return `ZUENA-${[...r].map((n) => CODE_ALPHABET[n % CODE_ALPHABET.length]).join('')}`;
}

export const ISRC_RE = /^[A-Z]{2}-?[A-Z0-9]{3}-?\d{2}-?\d{5}$/i;

export function newClaim(user, profile) {
  return {
    uid: user.uid,
    status: 'draft',
    artistName: '',
    legalName: '',
    email: user.email || '',
    country: '',
    genres: [],
    bio: '',
    links: {},
    code: makeCode(),
    codePlaced: false,
    codeWhere: '', // plataforma enlazada donde se publicó el código (evidencia fuerte)
    agree: false,
    target: null,  // { kind: 'new'|'catalog', key, name }; null = nombre nuevo (claimTarget)
    evidence: [],
    history: [],
    created: Date.now(),
    updated: Date.now(),
    username: profile?.username,
  };
}

// formato del formulario y evidencia mínima. La unicidad y los límites se comprueban al enviar (Artist.submitClaim).
export function validateClaim(c) {
  const e = {};
  const nameErr = artistNameError(c.artistName);
  if (nameErr) e.artistName = nameErr;
  const legal = c.legalName?.trim() || '';
  if (legal.split(/\s+/).length < 2 || legal.length > 80) e.legalName = 'Nombre y apellido reales (no se muestran en público)';
  if (!EMAIL_RE.test(c.email || '')) e.email = 'Correo de contacto inválido';
  if (!c.country?.trim() || c.country.trim().length > 40) e.country = 'Indicá tu país';
  if (!c.genres?.length || c.genres.length > 3) e.genres = 'Elegí entre 1 y 3 géneros';
  const seen = new Map();
  for (const p of PLATFORMS) {
    const v = (c.links?.[p.key] || '').trim();
    if (!v) continue;
    if (v.length > 300 || !p.re.test(v)) e[`link_${p.key}`] = `El enlace no parece de ${p.label}`;
    else if (seen.has(v.toLowerCase())) e[`link_${p.key}`] = 'Ese enlace ya está cargado en otra plataforma';
    seen.set(v.toLowerCase(), p.key);
  }
  if (c.codeWhere && !c.links?.[c.codeWhere]) e.codeWhere = 'El código tiene que estar publicado en una de las redes que enlazaste.';
  const ev = { ...c, evidence: buildEvidence(c) };
  if (!e.codeWhere && !evidenceOk(ev)) e.evidence = 'Sumá una prueba más: publicá el código en una de tus redes o verificá el correo de tu dominio.';
  // reclamo de un perfil del catálogo: el enlace de Apple Music tiene que ser de ese artista
  const t = claimTarget(c);
  if (t.kind === 'catalog' && c.links?.appleMusic && !appleLinkMatches(c.links.appleMusic, t.key.replace(/^am:/, ''))) e.link_appleMusic = 'El enlace de Apple Music tiene que ser el de este artista.';
  if (!c.agree) e.agree = 'Tenés que aceptar la declaración';
  return e;
}

export function validateRelease(r, tracks) {
  const e = {};
  if (!r.title?.trim()) e.title = 'El lanzamiento necesita un título';
  if (!r.primaryArtist?.trim()) e.primaryArtist = 'Falta el artista principal';
  // nadie publica como otra persona: el artista principal tiene que incluir el nombre verificado
  else if (r.verifiedName && !norm(r.primaryArtist).includes(norm(r.verifiedName))) e.primaryArtist = `El artista principal tiene que incluir tu nombre verificado (${r.verifiedName})`;
  if (!r.genre) e.genre = 'Elegí un género';
  if (r.releaseMode === 'scheduled') { const pe = premiereError(r.premiereAt); if (pe) e.premiereAt = pe; }
  if ((r.postText || '').length > 280) e.postText = 'Máximo 280 caracteres';
  if (!r.cover) e.cover = 'Subí la portada (cuadrada, mínimo 1400 × 1400 px)';
  if (!r.copyright?.trim()) e.copyright = 'Completá la línea de copyright (ej. ℗ 2026 Tu Nombre)';
  const need = { single: [1, 3], ep: [2, 7], album: [6, 40] }[r.type] || [1, 40];
  if (tracks.length < need[0] || tracks.length > need[1]) e.tracks = `Un ${typeLabel(r.type)} lleva entre ${need[0]} y ${need[1]} canciones`;
  r.tracks.forEach((rt, i) => {
    const t = tracks[i];
    if (!rt.title?.trim()) e[`t${i}_title`] = 'Falta el título';
    if (rt.isrc && !ISRC_RE.test(rt.isrc.trim())) e[`t${i}_isrc`] = 'ISRC inválido (ej. AR-ABC-26-00001)';
    if (t && qcErrors(t).length) e[`t${i}_qc`] = qcErrors(t)[0];
    if (t && !t.analysis && !t.analysisFailed) e[`t${i}_qc`] = 'Analizando el audio…';
  });
  if (!r.rights) e.rights = 'Confirmá que tenés los derechos de todo el material';
  return e;
}

const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export const typeLabel =(t) => ({ single: 'single', ep: 'EP', album: 'álbum' }[t] || 'lanzamiento');

// Control de calidad del audio subido
export function qcErrors(t) {
  const out = [];
  if (!t.lossless) out.push('Se requiere audio sin pérdida: WAV, FLAC, ALAC o AIFF');
  if (t.sampleRate && t.sampleRate < 44100) out.push('Frecuencia mínima: 44.1 kHz');
  if (t.bitDepth && t.bitDepth < 16) out.push('Profundidad mínima: 16 bits');
  if (t.analysisFailed) out.push('No se pudo leer el audio');
  return out;
}

export function qcWarnings(t) {
  const a = t.analysis, out = [];
  if (!a) return out;
  if (a.truePeakDb > -1) out.push(`True peak ${a.truePeakDb.toFixed(1)} dBTP: puede distorsionar al codificarse (ideal ≤ −1)`);
  if (a.lufs > -7) out.push(`Muy fuerte (${a.lufs.toFixed(1)} LUFS): las plataformas lo van a bajar`);
  if (a.lufs < -20) out.push(`Muy bajo (${a.lufs.toFixed(1)} LUFS)`);
  if (t.duration && t.duration < 30) out.push('Dura menos de 30 s');
  return out;
}

export async function checkCover(file) {
  if (!/^image\/(jpeg|png)$/.test(file.type)) throw new Error('La portada tiene que ser JPG o PNG');
  if (file.size > 20 * 1024 * 1024) throw new Error('La portada puede pesar hasta 20 MB');
  const bmp = await createImageBitmap(file);
  const { width, height } = bmp;
  bmp.close();
  if (width !== height) throw new Error(`La portada tiene que ser cuadrada (es ${width} × ${height})`);
  if (width < 1400) throw new Error(`Mínimo 1400 × 1400 px (es ${width} × ${height}); recomendado 3000 × 3000`);
  if (width > 6000) throw new Error(`Máximo 6000 × 6000 px (es ${width} × ${height})`);
  return { width, height };
}

export class Artist extends EventTarget {
  constructor(auth) {
    super();
    this.auth = auth;
    this.claim = null;
    this.releases = [];
  }

  emit() { this.dispatchEvent(new Event('change')); }

  get verified() { return this.claim?.status === 'approved'; }
  // verificación sólo "en este equipo" (sin servidor de verificación)
  get localOnly() { return this.verified && this.claim.verification !== 'full'; }
  // ¿hay servidor de verificación? Sólo con cuentas verificables (Firebase); el modo local nunca lo tiene
  get hasServer() { return this.auth?.mode === 'firebase'; }

  async load(uid) {
    this.claim = null;
    this.releases = [];
    if (!uid) { this.emit(); return; }
    const local = await db.get('claims', uid);
    let remote;
    try { remote = await cloudGet(this.auth, 'artistClaims', uid); } catch (err) { console.warn('[artist] nube', err); }
    this.claim = [local, remote].filter(Boolean).sort((a, b) => (b.updated || 0) - (a.updated || 0))[0] || null;
    if (this.claim && this.claim !== local) await db.put('claims', this.claim);
    // documento viejo: aprobado sin `verification` → local salvo nube con revisor verificado (§11)
    if (this.claim?.status === 'approved' && !this.claim.verification && !this.claim.sim) this.claim.verification = this.hasServer ? 'full' : 'local';
    // vencimiento por inactividad (borrador 30 días, "faltan datos" 14 días)
    if (claimExpiry(this.claim) === 'expired') { pushHistory(this.claim, 'expired', 'sistema'); await this.saveClaim(this.claim).catch(() => {}); }
    this.releases = (await db.byIndex('releases', 'uid', uid)).sort((a, b) => b.updated - a.updated);
    this.attemptsInfo = await this.attempts(uid);
    this.emit();
  }

  // relee el reclamo guardado (otra pestaña o un revisor pudo cambiarlo)
  async fresh(uid = this.claim?.uid) {
    if (!uid) return null;
    const c = await db.get('claims', uid).catch(() => null);
    if (c && this.claim?.uid === uid && (c.updated || 0) >= (this.claim.updated || 0)) { this.claim = c; }
    return c;
  }

  async stillVerified() {
    const c = await this.fresh();
    return c?.status === 'approved';
  }

  async saveClaim(claim) {
    claim.updated = Date.now();
    try { await db.put('claims', claim); } catch (err) {
      console.warn('[artist] no se guardó', err);
      throw new Error('No se pudo guardar. Liberá espacio e intentá de nuevo.');
    }
    this.claim = claim;
    try { await cloudSet(this.auth, 'artistClaims', claim.uid, claim); } catch (err) { console.warn('[artist] no se sincronizó', err); }
    this.emit();
    return claim;
  }

  // intentos por cuenta (kv claimAttempts:<uid>), sobreviven a borrar el reclamo
  async attempts(uid) {
    return pruneAttempts(await db.kvGet(`claimAttempts:${uid}`).catch(() => null));
  }

  async saveAttempts(uid, a) {
    const v = pruneAttempts(a);
    await db.kvSet(`claimAttempts:${uid}`, v).catch(() => {});
    if (this.claim?.uid === uid || this.auth?.user?.uid === uid) this.attemptsInfo = v;
  }

  async allClaims() {
    let remote;
    try { remote = await cloudWhere(this.auth, 'artistClaims', 'status', 'pending'); } catch { /* sin nube */ }
    const local = await db.all('claims');
    const map = new Map(local.map((c) => [c.uid, c]));
    for (const c of remote || []) if (!map.has(c.uid) || (c.updated || 0) > (map.get(c.uid).updated || 0)) map.set(c.uid, c);
    return [...map.values()];
  }

  // Envío (§4–§5): formato, evidencia, unicidad por artista, nombres del catálogo, límites y conexión.
  // Devuelve null si se envió o un objeto { campo: mensaje }. `form` = mensaje general (sin campo).
  async submitClaim(claim, { catalogNames = [], catalogExists = null, online = navigator.onLine, now = Date.now() } = {}) {
    if (claim.sim) return { form: 'Este perfil no se puede reclamar.' };
    // dos pestañas: si otra ya la envió, no se duplica
    const saved = await db.get('claims', claim.uid).catch(() => null);
    if (saved?.status === 'pending' || saved?.status === 'approved' || !['draft', 'needs_info'].includes(claim.status)) return { form: 'Tu solicitud ya está en revisión.' };
    claim.evidence = buildEvidence(claim, now);
    claim.codePlaced = !!claim.codeWhere;
    const errors = validateClaim(claim);
    const t = claimTarget(claim);
    if (!errors.artistName && t.kind === 'new' && catalogNameMatch(claim.artistName, catalogNames)) errors.artistName = 'Ese nombre coincide con un artista del catálogo. Si sos esa persona, reclamá su perfil.';
    if (t.kind === 'catalog' && catalogExists && !catalogExists(t.key)) errors.form = 'Ese perfil ya no está disponible en el catálogo.';
    if (Object.keys(errors).length) return errors;
    const all = await this.allClaims();
    if (targetProtected(all, t.key)) return { form: 'Este artista necesita una revisión especial. Escribinos.' };
    if (claimConflict(all, claim, now)) return t.kind === 'catalog' ? { form: 'Este artista ya tiene una solicitud en curso o una cuenta verificada. Si creés que es un error, escribinos.' } : { artistName: 'Ese nombre ya está en uso o tiene una solicitud en curso.' };
    const attempts = await this.attempts(claim.uid);
    const can = canResubmit(attempts, now);
    if (!can.ok) {
      const fecha = new Date(can.until).toLocaleDateString('es');
      return { form: can.reason === 'limit' ? `Llegaste al límite de solicitudes por ahora. Podés volver a intentarlo el ${fecha}.` : `Podés volver a enviar la solicitud el ${fecha}.` };
    }
    if (!online) { await this.saveClaim(claim); return { form: 'No hay conexión. Guardamos tu borrador; enviá la solicitud cuando vuelvas a estar en línea.', offline: true }; }
    pushHistory(claim, 'pending', claim.uid, '', now);
    claim.submitted = now;
    claim.reviewNote = '';
    claim.target = t;
    await this.saveClaim(claim);
    await this.saveAttempts(claim.uid, { ...attempts, at: [...(attempts.at || []), now] });
    return null;
  }

  // retirar (pending/needs_info → withdrawn) cuenta como intento; un borrador también se puede retirar
  async withdrawClaim(claim = this.claim, now = Date.now()) {
    if (!claim || !claimTransitionAllowed(claim.status, 'withdrawn')) return false;
    const counts = claim.status === 'pending' || claim.status === 'needs_info';
    pushHistory(claim, 'withdrawn', claim.uid, '', now);
    claim.withdrawnAt = now;
    await this.saveClaim(claim);
    if (counts) { const a = await this.attempts(claim.uid); await this.saveAttempts(claim.uid, { ...a, at: [...(a.at || []), now] }); }
    return true;
  }

  // volver a editar: withdrawn / rejected / expired → draft. Tras revocado o vencido, código nuevo.
  async reopenClaim(claim = this.claim, now = Date.now()) {
    if (!claim || !claimTransitionAllowed(claim.status, 'draft')) return false;
    const fresh = claim.status === 'revoked' || claim.status === 'expired';
    pushHistory(claim, 'draft', claim.uid, '', now);
    if (fresh) { claim.code = makeCode(); claim.codeWhere = ''; claim.codePlaced = false; claim.evidence = []; claim.verification = undefined; }
    await this.saveClaim(claim);
    return true;
  }

  // ----- revisión (administradores / modo desarrollador) -----
  // filtro: pending | needs_info | rejected | approved | revoked. Más antiguos primero; los `sim` nunca.
  async reviewQueue(filter = 'pending') {
    const all = (await this.allClaims()).filter((c) => !c.sim);
    return { all, list: all.filter((c) => c.status === filter).sort((a, b) => (a.submitted || a.updated || 0) - (b.submitted || b.updated || 0)) };
  }

  async pendingClaims() { return (await this.reviewQueue('pending')).list; }

  // acción del revisor. reviewer = { uid, name, canSelf } · expected = estado que vio el revisor.
  // Devuelve { claim } o { error }.
  async reviewClaim(uid, action, { note = '', reviewer = {}, expected = null, now = Date.now() } = {}) {
    const claim = (await db.get('claims', uid)) || (await cloudGet(this.auth, 'artistClaims', uid).catch(() => null));
    if (!claim || claim.sim) return { error: 'No encontramos ese reclamo.' };
    if (expected && claim.status !== expected) return { error: 'Este reclamo ya fue resuelto por otra persona.' };
    const to = { approve: 'approved', reject: 'rejected', needs_info: 'needs_info', revoke: 'revoked' }[action];
    if (!to || !claimTransitionAllowed(claim.status, to)) return { error: 'Este reclamo ya fue resuelto por otra persona.' };
    const self = reviewer.uid && reviewer.uid === claim.uid;
    if (self && action !== 'revoke' && !reviewer.canSelf) return { error: 'No podés revisar tu propia solicitud.' };
    if (action !== 'approve' && noteError(note)) return { error: noteError(note) };
    if (action === 'approve') {
      if (!evidenceOk(claim, { approval: true }) || !catalogLinkOk(claim)) return { error: 'Faltan pruebas: se necesitan al menos dos y una fuerte.' };
      const all = await this.allClaims();
      if (claimConflict(all.filter((o) => o.status === 'approved'), claim, now)) return { error: 'Este artista ya fue verificado por otra cuenta.' };
      claim.verification = this.hasServer && !self ? 'full' : 'local';
    }
    pushHistory(claim, to, reviewer.uid || '', note.trim(), now);
    claim.reviewNote = note.trim();
    claim.reviewed = now;
    claim.reviewedBy = { uid: reviewer.uid || '', name: reviewer.name || '' };
    if (to === 'needs_info') claim.needsInfoAt = now;
    if (to === 'revoked') { claim.revokedAt = now; claim.revokeNote = note.trim(); claim.revokedBy = 'admin'; }
    claim.updated = now;
    await db.put('claims', claim);
    try { await cloudSet(this.auth, 'artistClaims', uid, claim); } catch (err) { console.warn(err); }
    // rechazos seguidos → espera; una aprobación reinicia el contador
    const a = await this.attempts(uid);
    if (to === 'rejected') await this.saveAttempts(uid, { ...a, rejections: (a.rejections || 0) + 1, rejectedAt: now });
    if (to === 'approved') await this.saveAttempts(uid, { ...a, rejections: 0, rejectedAt: 0 });
    if (to === 'revoked') await this.hideReleasesOf(uid);
    if (this.claim?.uid === uid) { this.claim = claim; this.emit(); }
    return { claim };
  }

  // el revisor marca una evidencia como comprobada (manual_ok) o no hallada (fail)
  async markEvidence(uid, index, status, reviewer = {}, now = Date.now()) {
    const claim = await db.get('claims', uid);
    if (!claim) return null;
    const ev = evidenceOf(claim).map((e) => ({ ...e }));
    if (!ev[index] || !['manual_ok', 'fail', 'unchecked'].includes(status)) return null;
    Object.assign(ev[index], { status, checkedAt: now, checkedBy: reviewer.uid || '' });
    claim.evidence = ev;
    claim.updated = now;
    await db.put('claims', claim);
    try { await cloudSet(this.auth, 'artistClaims', uid, claim); } catch { /* sin nube */ }
    if (this.claim?.uid === uid) { this.claim = claim; this.emit(); }
    return claim;
  }

  // dejar de ser artista verificado (§3.3): revocado por la persona, nombre reservado 90 días
  async leaveArtist(now = Date.now()) {
    const c = this.claim;
    if (!c || c.status !== 'approved') return false;
    pushHistory(c, 'revoked', c.uid, 'Dejó de ser artista', now);
    Object.assign(c, { revokedAt: now, revokedBy: 'user', reservedUntil: now + CLAIM_RULES.nameReserveMs });
    await this.saveClaim(c);
    await this.hideReleasesOf(c.uid);
    return true;
  }

  // revocar oculta (no borra) lo publicado y los estrenos programados
  async hideReleasesOf(uid) {
    const list = await db.byIndex('releases', 'uid', uid).catch(() => []);
    for (const r of list) {
      if (r.status !== 'published' && r.status !== 'scheduled') continue;
      r.status = 'hidden';
      r.hiddenByRevoke = true;
      r.updated = Date.now();
      await db.put('releases', r);
      const mine = this.releases.find((x) => x.id === r.id);
      if (mine) Object.assign(mine, r);
    }
  }

  // ----- lanzamientos -----
  newRelease(profile) {
    if (!this.verified) throw new Error('Sólo los artistas verificados pueden crear lanzamientos');
    return {
      id: crypto.randomUUID(),
      uid: this.claim.uid,
      status: 'draft',
      type: 'single',
      title: '',
      primaryArtist: this.claim.artistName,
      featuring: '',
      genre: this.claim.genres?.[0] || '',
      language: 'Español',
      releaseDate: new Date().toISOString().slice(0, 10),
      // salida: 'onApprove' (publicar apenas se apruebe) o 'scheduled' (estreno en premiereAt, instante UTC)
      releaseMode: 'onApprove',
      premiereAt: null,
      premiereTz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      postMode: 'auto',
      postText: '',
      announce: false,
      pinOnPublish: false,
      explicit: false,
      label: '',
      copyright: `℗ ${new Date().getFullYear()} ${this.claim.artistName}`,
      cover: null,
      coverSize: null,
      tracks: [],
      rights: false,
      created: Date.now(),
      updated: Date.now(),
      username: profile?.username,
    };
  }

  getRelease(id) { return this.releases.find((r) => r.id === id); }

  async saveRelease(r) {
    r.updated = Date.now();
    await db.put('releases', r);
    if (r.uid !== this.claim?.uid) return r; // lanzamiento de otra cuenta (revisión)
    if (!this.releases.includes(r)) this.releases.unshift(r);
    this.releases.sort((a, b) => b.updated - a.updated);
    this.emit();
    return r;
  }

  async deleteRelease(id) {
    await db.del('releases', id);
    this.releases = this.releases.filter((r) => r.id !== id);
    this.emit();
  }

  async pendingReleases() {
    return (await db.all('releases')).filter((r) => r.status === 'review');
  }
}
