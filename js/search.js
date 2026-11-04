// Búsqueda unificada. Sólo datos accesibles de la cuenta y catálogo de prueba habilitado.
import { TEST_CATALOG } from './config.js';
import { TEST_ARTISTS, testSongs, testReleases, testArtistCards } from './data/testArtists.js';
import { canView } from './data/subs.js';

const fold = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim().replace(/\s+/g, ' ');
export const normalizeSearch = (value) => fold(value).slice(0, 120);
export function searchRank(query, title, extra = '') {
  const q = normalizeSearch(query), t = fold(title), all = `${t} ${fold(extra)}`;
  if (!q || !q.split(' ').every((word) => all.includes(word))) return 0;
  return t === q ? 100 : t.startsWith(q) ? 80 : t.includes(q) ? 60 : 30;
}
function bounded(promise) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Fuente sin respuesta')), 8000); })]).finally(() => clearTimeout(timer));
}
function dedupTracks(list) {
  const seen = new Set();
  const out = [];
  for (const t of list) {
    const sig = `${fold(t.title)}|${fold(t.artist)}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(t);
  }
  return out;
}

export async function searchEverything(app, query, { catalog = TEST_CATALOG, onPartial } = {}) {
  if (String(query ?? '').length > 120) return { groups: [], partial: false, error: 'Usá hasta 120 caracteres.' };
  const includeCatalog = TEST_CATALOG && catalog;
  const q = normalizeSearch(query);
  if (q.length < 2) return { groups: [], partial: false };
  const groups = [];
  const add = (label, rows) => {
    const hits = rows.map((r) => ({ ...r, score: searchRank(q, r.title, r.extra) })).filter((r) => r.score)
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'es') || String(a.id || a.track?.id).localeCompare(String(b.id || b.track?.id)));
    const index = groups.findIndex((group) => group.label === label);
    if (index >= 0) groups.splice(index, 1);
    if (hits.length) groups.push({ label, items: hits });
  };
  const profiles = [...(app.posts?.authors?.values() || [])];
  if (app.profile && !profiles.some((p) => p.uid === app.profile.uid)) profiles.push(app.profile);
  const zuProfiles = profiles.filter((p) => p.role === 'artist' || p.uid === app.user?.uid).map((p) => ({
    title: p.displayName || p.username || 'Perfil', extra: p.username, sub: p.role === 'artist' ? 'Artista de ZUENA' : 'Tu perfil',
    action: p.role === 'artist' ? 'open-artist' : 'nav', id: `zu:${p.uid}`, view: 'profile', art: p.avatar || null,
  }));
  add('Perfiles', [...zuProfiles, ...(includeCatalog ? TEST_ARTISTS.map((p) => ({ title: p.name, sub: 'Catálogo de prueba · Apple Music', action: 'open-artist', id: `am:${p.id}` })) : [])]);
  const remotePending = includeCatalog ? Promise.allSettled([bounded(testSongs()), bounded(testReleases()), bounded(testArtistCards())]) : Promise.resolve([]);
  const tracks = new Map([...(app.library?.tracks || [])].filter((t) => !app.isAvailable || app.isAvailable(t)).map((t) => [t.id, t]));
  add('Canciones', dedupTracks([...tracks.values()]).map((t) => ({ title: t.title, extra: t.artist, sub: t.artist || 'Tu biblioteca', track: t, art: t.artwork || null })));
  add('Estrenos y lanzamientos', [...(app.releases?.upcoming() || []), ...(app.releases?.live() || [])].map((r) => ({
    title: r.title, extra: r.artistName || r.artist, sub: r.status === 'scheduled' ? 'Próximo estreno' : 'Publicado en ZUENA', action: 'search-release', id: r.id, art: r.coverThumb || r.artwork || null,
  })));
  add('Tus playlists', (app.playlists?.list || []).filter((p) => !p.owner || p.owner === app.user?.uid).map((p) => ({ title: p.name, sub: 'Playlist privada de tu biblioteca', action: 'playlist', id: p.id })));
  const posts = [...new Map([...(app.posts?.list || []), ...(app.posts?.derived?.values() || [])].map((p) => [p.id, p])).values()];
  add('Publicaciones', posts.filter((p) => {
    if (p.replyTo || p.repostOf || !app.posts.visible(p)) return false;
    const root = app.posts.rootOf(p) || p;
    return canView(root, app.subs?.tier(app.user?.uid, root.uid) || 0, { isAuthor: !!app.user && root.uid === app.user.uid });
  }).map((p) => ({ title: (p.kind === 'catalog' ? `Nuevo lanzamiento: ${p.catalog?.title || ''}` : p.text || '').slice(0, 280), extra: (app.posts.author(p.uid) || p.author)?.displayName,
    sub: (app.posts.author(p.uid) || p.author)?.displayName || 'Catálogo de ZUENA', action: 'post-open', id: p.id })));
  if (includeCatalog) onPartial?.({ groups: [...groups], partial: false, loading: true });
  const remote = await remotePending;
  const songs = remote[0]?.status === 'fulfilled' ? remote[0].value : [];
  const releases = remote[1]?.status === 'fulfilled' ? remote[1].value : [];
  const cards = remote[2]?.status === 'fulfilled' ? remote[2].value : [];
  if (cards.length) {
    const cardArt = new Map(cards.map((c) => [String(c.id), c.artwork]));
    add('Perfiles', [...zuProfiles, ...(includeCatalog ? TEST_ARTISTS.map((p) => ({ title: p.name, sub: 'Catálogo de prueba · Apple Music', action: 'open-artist', id: `am:${p.id}`, art: cardArt.get(String(p.id)) || null })) : [])]);
  }
  for (const t of songs) if (!app.isAvailable || app.isAvailable(t)) tracks.set(t.id, t);
  add('Canciones', dedupTracks([...tracks.values()]).map((t) => ({ title: t.title, extra: t.artist, sub: t.artist || 'Tu biblioteca', track: t, art: t.artwork || null })));
  const localReleases = groups.find((g) => g.label === 'Estrenos y lanzamientos')?.items || [];
  add('Estrenos y lanzamientos', [...localReleases, ...releases.map((r) => ({ title: r.title, extra: r.artist, sub: r.artist, action: 'open-amc', id: r.collectionId, art: r.artwork || null }))]);
  const order = ['Perfiles', 'Canciones', 'Estrenos y lanzamientos', 'Tus playlists', 'Publicaciones'];
  groups.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
  return { groups, partial: remote.slice(0, 2).some((r) => r.status === 'rejected') };
}
