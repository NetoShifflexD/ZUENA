// Artistas del catálogo de Apple Music: los más escuchados (derivado del ranking real de canciones) y su
// catálogo (populares, singles/EPs/álbumes, colaboraciones). Sólo datos reales de Apple: nada de
// biografías, cifras ni publicaciones inventadas. Son "perfiles no reclamados": no reciben pagos.
import { getJSON, big, fromItunesSong } from './sources.js';

const ITUNES = 'https://itunes.apple.com';

// Top N artistas: ranking "más escuchadas" (100 canciones) → puntaje por posición y cantidad de apariciones
export async function appleTopArtists(country = 'ar', n = 20) {
  const feed = await getJSON(`https://rss.applemarketingtools.com/api/v2/${country}/music/most-played/100/songs.json`, { proxy: true, ttl: 6 * 3600e3 });
  const score = new Map();
  feed.feed.results.forEach((r, i) => {
    if (!r.artistId) return;
    const s = score.get(r.artistId) || { id: r.artistId, points: 0, songs: 0, art: r.artworkUrl100 };
    s.points += 100 - i;
    s.songs++;
    score.set(r.artistId, s);
  });
  const top = [...score.values()].sort((a, b) => b.points - a.points).slice(0, n);
  // nombres limpios ("KAROL G" y no "KAROL G, Judeline & rusowsky") desde el lookup
  const look = await getJSON(`${ITUNES}/lookup?id=${top.map((t) => t.id).join(',')}&country=${country}`, { ttl: 24 * 3600e3 });
  const byId = new Map(look.results.filter((r) => r.wrapperType === 'artist').map((r) => [String(r.artistId), r]));
  return top.map((t, i) => {
    const a = byId.get(String(t.id));
    return a && { id: String(t.id), rank: i + 1, name: a.artistName, genre: a.primaryGenreName, url: a.artistLinkUrl, artwork: big(t.art, 600), chartSongs: t.songs };
  }).filter(Boolean);
}

// clasificación de lanzamientos de Apple por nombre y cantidad de canciones
export function releaseKind(c) {
  const name = c.collectionName || '';
  if (/ - Single$/i.test(name)) return 'single';
  if (/ - EP$/i.test(name)) return 'ep';
  const n = c.trackCount || 0;
  return n <= 3 ? 'single' : n <= 6 ? 'ep' : 'album';
}
const cleanName = (s) => (s || '').replace(/ - (Single|EP)$/i, '');

function fromCollection(c) {
  return {
    id: `amc:${c.collectionId}`,
    collectionId: c.collectionId,
    title: cleanName(c.collectionName),
    artist: c.artistName,
    kind: releaseKind(c),
    tracks: c.trackCount,
    year: c.releaseDate?.slice(0, 4),
    date: c.releaseDate,
    artwork: big(c.artworkUrl100, 600),
    explicit: c.collectionExplicitness === 'explicit',
    url: c.collectionViewUrl,
  };
}

// colaboración real: el nombre del artista figura en el título o en el crédito de una canción de otro artista
const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export function isCollab(song, artistId, name) {
  if (String(song.artistId) === String(artistId)) return false;
  const n = norm(name);
  const credit = norm(song.artistName), title = norm(song.trackName);
  const re = new RegExp(`(^|[\\s,&(]|feat\\.?|ft\\.?|with|con)\\s*${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[\\s,&)])`);
  return re.test(credit) || (/(feat|ft\.|with|con )/.test(title) && re.test(title));
}

export async function appleArtist(artistId, country = 'ar') {
  const [albums, songs] = await Promise.all([
    getJSON(`${ITUNES}/lookup?id=${artistId}&entity=album&limit=200&country=${country}`, { ttl: 12 * 3600e3 }),
    getJSON(`${ITUNES}/lookup?id=${artistId}&entity=song&limit=50&country=${country}`, { ttl: 12 * 3600e3 }),
  ]);
  const info = albums.results.find((r) => r.wrapperType === 'artist') || songs.results.find((r) => r.wrapperType === 'artist');
  if (!info) throw new Error('No encontramos a este artista en Apple Music');
  const name = info.artistName;
  // sólo los lanzamientos propios (sin recopilatorios de otros), del más nuevo al más viejo, sin duplicados de edición
  const seen = new Set();
  const releases = albums.results
    .filter((r) => r.wrapperType === 'collection' && String(r.artistId) === String(artistId))
    .map(fromCollection)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .filter((r) => { const k = `${norm(r.title)}|${r.kind}`; if (seen.has(k)) return false; seen.add(k); return true; });
  // Apple devuelve las canciones del artista ordenadas por popularidad
  const top = songs.results.filter((r) => r.wrapperType === 'track' && r.previewUrl).map(fromItunesSong);
  // colaboraciones: búsqueda por nombre y filtro estricto (sólo créditos reales)
  let collabs = [];
  try {
    const s = await getJSON(`${ITUNES}/search?term=${encodeURIComponent(name)}&country=${country}&media=music&entity=song&limit=80`, { ttl: 12 * 3600e3 });
    const ids = new Set(top.map((t) => t.id));
    collabs = s.results.filter((r) => r.previewUrl && isCollab(r, artistId, name)).map(fromItunesSong).filter((t) => !ids.has(t.id)).slice(0, 20);
  } catch { /* sin colaboraciones si falla la búsqueda */ }
  return {
    id: String(artistId),
    name,
    genre: info.primaryGenreName,
    url: info.artistLinkUrl,
    cover: releases[0] ? big(releases[0].artwork, 1600) : top[0]?.artworkLarge || null,
    popular: top.slice(0, 10),
    singles: releases.filter((r) => r.kind === 'single'),
    eps: releases.filter((r) => r.kind === 'ep'),
    albums: releases.filter((r) => r.kind === 'album'),
    collabs,
  };
}

// canciones de un lanzamiento (para reproducirlo)
export async function appleCollection(collectionId, country = 'ar') {
  const { results } = await getJSON(`${ITUNES}/lookup?id=${collectionId}&entity=song&country=${country}`, { ttl: 24 * 3600e3 });
  return results.filter((r) => r.wrapperType === 'track' && r.previewUrl).sort((a, b) => (a.discNumber - b.discNumber) || (a.trackNumber - b.trackNumber)).map(fromItunesSong);
}
