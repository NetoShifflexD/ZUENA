// Fuentes reales y legales de contenido:
// · Audius: música completa de artistas independientes reales (con verificación), API abierta.
// · Apple Music: rankings actuales por país + vistas previas oficiales de 30 s (iTunes Search API).
// · Podcasts: directorio de Apple Podcasts (iTunes) con episodios.
// · Radio: Radio Browser, directorio comunitario de radios en vivo.
// Todo se cachea en IndexedDB para no saturar las APIs y para funcionar rápido al reabrir.
import { db } from '../store/db.js';
import { SUPABASE_URL } from '../config.js';
import { genreOf, GENRE_BY_ID } from './genres.js';

const AUDIUS = 'https://discoveryprovider.audius.co/v1';
const APP = 'app_name=ZUENA';
const RADIO_HOSTS = ['https://de1.api.radio-browser.info', 'https://nl1.api.radio-browser.info', 'https://at1.api.radio-browser.info'];
const mem = new Map();

export async function getJSON(url, { ttl = 3 * 3600e3, proxy = false } = {}) {
  const key = `cache:${url}`;
  if (mem.has(key)) return mem.get(key);
  const cached = await db.kvGet(key).catch(() => null);
  if (cached && Date.now() - cached.t < ttl) { mem.set(key, cached.data); return cached.data; }
  // en un sitio estático no existe /api: los feeds sin CORS pasan por la función de Supabase
  const bridge = location.hostname.endsWith('.github.io') ? `${SUPABASE_URL}/functions/v1/fetch` : '/api/fetch';
  const target = proxy ? `${bridge}?url=${encodeURIComponent(url)}` : url;
  try {
    const r = await fetch(target, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    mem.set(key, data);
    db.kvSet(key, { t: Date.now(), data }).catch(() => {});
    return data;
  } catch (err) {
    if (cached) return cached.data; // sin conexión: lo último que hubo
    throw err;
  }
}

export const big = (url, size) => url?.replace(/\/\d+x\d+(bb)?\./, `/${size}x${size}bb.`);

// ---------- Audius ----------

function fromAudius(t) {
  const art = t.artwork || {};
  const u = t.user || {};
  return {
    id: `au:${t.id}`,
    kind: 'remote',
    source: 'audius',
    type: 'track',
    title: t.title,
    artist: u.name || u.handle,
    artistId: u.id,
    artistHandle: u.handle,
    artistAvatar: u.profile_picture?.['480x480'] || u.profile_picture?.['150x150'] || null,
    verified: !!u.is_verified,
    genre: genreOf(t.genre),
    genreRaw: t.genre,
    mood: t.mood,
    duration: t.duration,
    artwork: art['480x480'] || art['150x150'] || null,
    artworkLarge: art['1000x1000'] || art['480x480'] || null,
    stream: `${AUDIUS}/tracks/${t.id}/stream?${APP}`,
    externalUrl: t.permalink ? `https://audius.co${t.permalink}` : null,
    plays: t.play_count || 0,
  };
}

function fromAudiusUser(u) {
  return {
    id: u.id,
    name: u.name,
    handle: u.handle,
    verified: !!u.is_verified,
    avatar: u.profile_picture?.['480x480'] || u.profile_picture?.['150x150'] || null,
    cover: u.cover_photo?.['2000x'] || u.cover_photo?.['640x'] || null,
    bio: u.bio || '',
    followers: u.follower_count || 0,
    tracks: u.track_count || 0,
    location: u.location || '',
  };
}

export async function audiusTrending({ genre = null, time = 'week', limit = 24 } = {}) {
  const g = genre ? GENRE_BY_ID[genre]?.audius[0] : null;
  const url = `${AUDIUS}/tracks/trending?time=${time}&limit=${limit}${g ? `&genre=${encodeURIComponent(g)}` : ''}&${APP}`;
  const { data } = await getJSON(url);
  return data.filter((t) => t.is_streamable !== false).map(fromAudius);
}

export async function audiusSearch(q, limit = 12) {
  const { data } = await getJSON(`${AUDIUS}/tracks/search?query=${encodeURIComponent(q)}&limit=${limit}&${APP}`, { ttl: 3600e3 });
  return data.map(fromAudius);
}

export async function audiusUser(id) {
  const { data } = await getJSON(`${AUDIUS}/users/${id}?${APP}`);
  return fromAudiusUser(data);
}

export async function audiusUserTracks(id, limit = 20) {
  const { data } = await getJSON(`${AUDIUS}/users/${id}/tracks?limit=${limit}&sort=plays&${APP}`);
  return data.map(fromAudius);
}

export async function audiusUserSearch(q, limit = 8) {
  const { data } = await getJSON(`${AUDIUS}/users/search?query=${encodeURIComponent(q)}&limit=${limit}&${APP}`, { ttl: 3600e3 });
  return data.map(fromAudiusUser);
}

// ---------- Apple Music (rankings + vistas previas) ----------

export function fromItunesSong(s) {
  return {
    id: `am:${s.trackId}`,
    kind: 'remote',
    source: 'apple',
    type: 'track',
    preview: true,
    title: s.trackName,
    artist: s.artistName,
    artistId: s.artistId ? String(s.artistId) : null,
    album: s.collectionName,
    genre: genreOf(s.primaryGenreName),
    genreRaw: s.primaryGenreName,
    artwork: big(s.artworkUrl100, 600),
    artworkLarge: big(s.artworkUrl100, 1200),
    stream: s.previewUrl,
    duration: 30,
    fullDuration: s.trackTimeMillis ? s.trackTimeMillis / 1000 : null,
    explicit: s.trackExplicitness === 'explicit',
    externalUrl: s.trackViewUrl,
    year: s.releaseDate?.slice(0, 4),
  };
}

export async function appleChart(country = 'ar', limit = 20) {
  // el feed de rankings no tiene CORS: pasa por el servidor local; luego se buscan las vistas previas
  const feed = await getJSON(`https://rss.applemarketingtools.com/api/v2/${country}/music/most-played/${limit}/songs.json`, { proxy: true, ttl: 6 * 3600e3 });
  const ids = feed.feed.results.map((r) => r.id).join(',');
  const look = await getJSON(`https://itunes.apple.com/lookup?id=${ids}&country=${country}&entity=song`, { ttl: 6 * 3600e3 });
  const byId = new Map(look.results.filter((r) => r.kind === 'song' && r.previewUrl).map((r) => [String(r.trackId), r]));
  return feed.feed.results.map((r) => byId.get(String(r.id))).filter(Boolean).map(fromItunesSong);
}

export async function itunesSongs(term, country = 'ar', limit = 12) {
  const { results } = await getJSON(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&country=${country}&media=music&entity=song&limit=${limit}`, { ttl: 3600e3 });
  return results.filter((r) => r.previewUrl).map(fromItunesSong);
}

// ---------- Podcasts ----------

function fromPodcast(p) {
  return {
    id: `pc:${p.collectionId}`,
    kind: 'remote',
    source: 'itunes',
    type: 'podcast',
    collectionId: p.collectionId,
    title: p.collectionName,
    artist: p.artistName,
    artwork: big(p.artworkUrl100 || p.artworkUrl600, 600),
    genreRaw: p.primaryGenreName,
    episodes: p.trackCount,
    externalUrl: p.collectionViewUrl,
  };
}

function fromEpisode(e, show) {
  return {
    id: `ep:${e.trackId}`,
    kind: 'remote',
    source: 'itunes',
    type: 'episode',
    title: e.trackName,
    artist: show?.title || e.collectionName,
    showId: e.collectionId,
    artwork: e.artworkUrl600 || show?.artwork,
    stream: e.episodeUrl,
    duration: e.trackTimeMillis ? e.trackTimeMillis / 1000 : 0,
    date: e.releaseDate,
    description: (e.description || '').slice(0, 400),
    externalUrl: e.trackViewUrl,
  };
}

export async function podcastsByTerm(term, country = 'ar', limit = 8) {
  const { results } = await getJSON(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&country=${country}&media=podcast&entity=podcast&limit=${limit}`, { ttl: 12 * 3600e3 });
  return results.map(fromPodcast);
}

export async function topPodcasts(country = 'ar', limit = 12) {
  const feed = await getJSON(`https://rss.applemarketingtools.com/api/v2/${country}/podcasts/top/${limit}/podcasts.json`, { proxy: true, ttl: 12 * 3600e3 });
  const ids = feed.feed.results.map((r) => r.id).join(',');
  const look = await getJSON(`https://itunes.apple.com/lookup?id=${ids}&country=${country}`, { ttl: 12 * 3600e3 });
  return look.results.filter((r) => r.kind === 'podcast').map(fromPodcast);
}

export async function podcastDetail(collectionId, limit = 15) {
  const { results } = await getJSON(`https://itunes.apple.com/lookup?id=${collectionId}&entity=podcastEpisode&limit=${limit}`, { ttl: 3 * 3600e3 });
  const show = results.find((r) => r.kind === 'podcast' || r.wrapperType === 'collection');
  const info = show ? fromPodcast(show) : null;
  const episodes = results.filter((r) => r.kind === 'podcast-episode' && r.episodeUrl).map((e) => fromEpisode(e, info));
  return { show: info, episodes };
}

// ---------- Radio ----------

function fromStation(s) {
  const tags = (s.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
  return {
    id: `rd:${s.stationuuid}`,
    kind: 'remote',
    source: 'radio',
    type: 'radio',
    live: true,
    title: s.name.trim().replace(/\s+-\s+.*$/, '').slice(0, 60),
    fullName: s.name.trim(),
    artist: [s.state || s.country, tags.slice(0, 2).join(' · ')].filter(Boolean).join(' · ') || 'Radio en vivo',
    artwork: s.favicon || null,
    stream: s.url_resolved || s.url,
    codec: s.codec,
    bitrate: s.bitrate,
    country: s.countrycode,
    tags,
    genre: genreOf(s.tags),
    externalUrl: s.homepage || null,
  };
}

async function radioQuery(path, ttl = 6 * 3600e3) {
  let lastErr;
  for (const host of RADIO_HOSTS) {
    try { return (await getJSON(`${host}/json/${path}`, { ttl })).filter((s) => s.lastcheckok !== 0); } catch (err) { lastErr = err; }
  }
  throw lastErr;
}

export async function radiosByCountry(cc = 'AR', limit = 12) {
  const list = await radioQuery(`stations/bycountrycodeexact/${cc}?limit=${limit}&order=clickcount&reverse=true&hidebroken=true`);
  return list.map(fromStation).filter((r) => r.stream?.startsWith('https://'));
}

export async function radiosByTag(tag, limit = 10) {
  const list = await radioQuery(`stations/bytagexact/${encodeURIComponent(tag)}?limit=${limit}&order=clickcount&reverse=true&hidebroken=true`);
  return list.map(fromStation).filter((r) => r.stream?.startsWith('https://'));
}

export async function radioSearch(q, limit = 10) {
  const list = await radioQuery(`stations/search?name=${encodeURIComponent(q)}&limit=${limit}&order=clickcount&reverse=true&hidebroken=true`, 3600e3);
  return list.map(fromStation).filter((r) => r.stream?.startsWith('https://'));
}

