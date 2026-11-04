// Catálogo de PRUEBA: 30 artistas reales elegidos el 2026-11-01 para probar ZUENA con datos verdaderos.
// Todo lo que se muestra (lanzamientos, carátulas, canciones con vista previa de 30 s) viene del catálogo
// público de Apple Music. No se inventa nada: sin biografías, cifras, publicaciones ni mensajes atribuidos
// a estas personas. Se activa con TEST_CATALOG en js/config.js.
//
// Criterio (detalle en la nota "Catálogo de prueba" de la bóveda): ranking "más escuchadas" de Apple Music
// del 2026-11-01 en Argentina, España, México, Chile y EE. UU. (Puerto Rico y Reino Unido no respondieron),
// más los artistas globales con más oyentes en Spotify según conocimiento público. SoundCloud no tiene
// un ranking público consultable sin credenciales.
import { getJSON, fromItunesSong, big } from '../catalog/sources.js';
import { releaseKind } from '../catalog/artists.js';

export const TEST_ARTISTS = [
  // global (Spotify / Apple)
  { id: 159260351, name: 'Taylor Swift', m: ['global'] },
  { id: 479756766, name: 'The Weeknd', m: ['global'] },
  { id: 271256, name: 'Drake', m: ['global', 'us'] },
  { id: 1065981054, name: 'Billie Eilish', m: ['global'] },
  { id: 390647681, name: 'Sabrina Carpenter', m: ['global'] },
  { id: 278873078, name: 'Bruno Mars', m: ['global'] },
  { id: 277293880, name: 'Lady Gaga', m: ['global'] },
  { id: 183313439, name: 'Ed Sheeran', m: ['global'] },
  { id: 368183298, name: 'Kendrick Lamar', m: ['global'] },
  { id: 1446365464, name: 'Tate McRae', m: ['global', 'ar', 'es', 'cl'] },
  // latinos en varios países
  { id: 1126808565, name: 'Bad Bunny', m: ['global', 'pr', 'ar', 'es', 'mx', 'cl'] },
  { id: 290814601, name: 'KAROL G', m: ['global', 'ar', 'es', 'mx', 'cl'] },
  { id: 1107186883, name: 'Rauw Alejandro', m: ['pr', 'ar', 'es', 'mx', 'cl'] },
  { id: 996166916, name: 'Anuel AA', m: ['pr', 'ar', 'es', 'cl'] },
  { id: 283578837, name: 'Ozuna', m: ['pr', 'ar', 'es', 'cl'] },
  { id: 1210225867, name: 'Myke Towers', m: ['pr', 'ar', 'es', 'cl'] },
  { id: 1370744631, name: 'Omar Courtz', m: ['pr', 'ar', 'es', 'mx', 'cl'] },
  { id: 444520760, name: 'J Balvin', m: ['ar', 'mx', 'cl'] },
  { id: 164376380, name: 'Jay Wheeler', m: ['pr', 'ar', 'es', 'cl'] },
  { id: 889327, name: 'Shakira', m: ['global', 'es'] },
  { id: 1500139475, name: 'Peso Pluma', m: ['global', 'mx'] },
  { id: 1275690475, name: 'Fuerza Regida', m: ['mx', 'ar', 'cl'] },
  // por país
  { id: 1024801206, name: 'Eladio Carrión', m: ['pr', 'es'] },
  { id: 1275242928, name: 'JHAYCO', m: ['pr', 'ar', 'cl'] },
  { id: 377761784, name: 'Quevedo', m: ['es'] },
  { id: 1302824608, name: 'Aitana', m: ['es', 'ar', 'mx'] },
  { id: 1455524202, name: 'Emilia', m: ['ar'] },
  { id: 1406984792, name: 'Natanael Cano', m: ['mx'] },
  { id: 1504191840, name: 'Cris MJ', m: ['cl'] },
  { id: 1539048077, name: 'Jere Klein', m: ['cl'] },
];

export const MARKETS = { global: 'Global', pr: 'Puerto Rico', ar: 'Argentina', es: 'España', mx: 'México', cl: 'Chile', us: 'Estados Unidos' };

const ITUNES = 'https://itunes.apple.com';
const ids = TEST_ARTISTS.map((a) => a.id);
const TTL = 12 * 3600e3;

// la búsqueda de Apple admite varios ids por consulta (≈ 20 consultas/min de límite): se agrupa de a 15
async function lookupMany(entity, limit) {
  const groups = [];
  for (let i = 0; i < ids.length; i += 15) groups.push(ids.slice(i, i + 15));
  const parts = await Promise.all(groups.map((g) => getJSON(`${ITUNES}/lookup?id=${g.join(',')}&entity=${entity}&limit=${limit}&sort=recent&country=us`, { ttl: TTL }).catch(() => ({ results: [] }))));
  return parts.flatMap((p) => p.results || []);
}

let artistsP, releasesP, songsP;

// fichas de artista (foto = carátula del lanzamiento más reciente; Apple no da foto de artista por API)
export function testArtistCards() {
  artistsP ||= Promise.all([testReleases(), testSongs()]).then(([rels, songs]) => TEST_ARTISTS.map((a) => {
    const r = rels.find((x) => x.artistId === a.id);
    const s = songs.find((x) => String(x.artistId) === String(a.id));
    return { ...a, artwork: r?.artwork || s?.artworkLarge || s?.artwork || '', latest: r || null };
  }));
  return artistsP;
}

// lanzamientos más recientes (uno o dos por artista), del más nuevo al más viejo
export function testReleases() {
  releasesP ||= lookupMany('album', 3).then((rows) => {
    const seen = new Set();
    return rows.filter((r) => r.wrapperType === 'collection' && ids.includes(r.artistId))
      .map((c) => ({
        collectionId: c.collectionId, artistId: c.artistId, artist: c.artistName,
        title: (c.collectionName || '').replace(/ - (Single|EP)$/i, ''), kind: releaseKind(c),
        date: c.releaseDate, year: (c.releaseDate || '').slice(0, 4), tracks: c.trackCount,
        artwork: big(c.artworkUrl100, 600), explicit: c.collectionExplicitness === 'explicit',
        url: c.collectionViewUrl || '',
      }))
      .filter((r) => { const k = `${r.artistId}:${r.title.toLowerCase()}`; if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  });
  return releasesP;
}

// canciones populares con vista previa (las que Apple devuelve primero para cada artista)
export function testSongs() {
  songsP ||= lookupMany('song', 6).then((rows) => rows.filter((s) => s.wrapperType === 'track' && s.previewUrl && ids.includes(s.artistId)).map(fromItunesSong));
  return songsP;
}

// playlists editoriales de prueba: top global y una por país, con las canciones de sus artistas
export async function testPlaylists() {
  const songs = await testSongs();
  const byArtist = new Map();
  for (const s of songs) {
    const a = TEST_ARTISTS.find((x) => x.name.toLowerCase() === (s.artist || '').toLowerCase()) || TEST_ARTISTS.find((x) => (s.artist || '').toLowerCase().startsWith(x.name.toLowerCase()));
    if (!a) continue;
    if (!byArtist.has(a.id)) byArtist.set(a.id, []);
    byArtist.get(a.id).push(s);
  }
  const pick = (market, perArtist) => TEST_ARTISTS.filter((a) => a.m.includes(market))
    .flatMap((a) => (byArtist.get(a.id) || []).slice(0, perArtist));
  const lists = [
    { id: 'tp-global', title: 'Top Global ZUENA', label: 'Global', sub: 'Lo más escuchado en el mundo', items: pick('global', 2) },
    ...['pr', 'ar', 'es', 'mx', 'cl'].map((m) => ({ id: `tp-${m}`, title: `Top ${MARKETS[m]}`, label: MARKETS[m], sub: `Lo más escuchado en ${MARKETS[m]}`, items: pick(m, 2) })),
  ];
  return lists.filter((l) => l.items.length >= 4);
}

// ---------- nombres de artista que llevan al perfil (sólo los del catálogo de prueba) ----------
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const BY_NAME = new Map(TEST_ARTISTS.map((a) => [norm(a.name), a]));
const BY_ID = new Map(TEST_ARTISTS.map((a) => [String(a.id), a]));

export const testArtistById = (id) => BY_ID.get(String(id)) || null;
export const testArtistByName = (name) => BY_NAME.get(norm(name)) || null;

// "Eladio Carrión, Rauw Alejandro & De La Rose" → cada nombre del catálogo de prueba es un botón al perfil;
// los demás quedan como texto. `esc` viene de quien llama (evita depender de la interfaz desde los datos).
export function linkArtistNames(text, esc, cls = 'artist-link') {
  const src = String(text || '');
  const parts = src.split(/(\s*(?:,|&|\by\b|\bx\b|\bfeat\.?|\bft\.?|\bcon\b)\s*)/i);
  return parts.map((p, i) => {
    if (i % 2) return esc(p);
    const a = testArtistByName(p);
    return a ? `<button class="${cls}" data-action="open-artist" data-id="am:${a.id}">${esc(p)}</button>` : esc(p);
  }).join('');
}
