// Motor de recomendaciones de ZUENA.
// Perfil de gustos = respuestas del test inicial + señales de escucha (reproducciones completas,
// me gusta, saltos). Cada contenido se puntúa por afinidad de género, de artista, estado de ánimo,
// popularidad y novedad; las filas se arman con diversidad (máx. 2 por artista).
import { db } from '../store/db.js';
import { genreOf, MOODS, GENRE_BY_ID } from './genres.js';

const DAY = 864e5;

export function emptyTaste(region = 'ar') {
  return { done: false, genres: {}, artists: {}, moods: [], topics: [], radio: true, region, updated: Date.now() };
}

export class Taste extends EventTarget {
  constructor() {
    super();
    this.uid = null;
    this.data = emptyTaste();
    this.saveTimer = 0;
  }

  async load(uid, region) {
    this.uid = uid;
    const saved = uid && (await db.kvGet(`taste:${uid}`));
    this.data = saved || emptyTaste(region);
    this.decay();
  }

  // los gustos viejos pierden peso de a poco (2 % por día)
  decay() {
    const days = (Date.now() - (this.data.updated || Date.now())) / DAY;
    if (days < 1) return;
    const f = Math.pow(0.98, days);
    for (const map of [this.data.genres, this.data.artists]) for (const k in map) map[k] *= f;
    this.data.updated = Date.now();
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { if (this.uid) db.kvSet(`taste:${this.uid}`, this.data); }, 500);
    this.dispatchEvent(new Event('change'));
  }

  // respuestas del test
  setAnswers({ genres, artists, moods, topics, radio, region }) {
    const d = this.data;
    d.genres = {};
    for (const g of genres) d.genres[g] = 5;
    for (const a of artists) d.artists[a.toLowerCase()] = 6;
    d.moods = moods;
    d.topics = topics;
    d.radio = radio;
    if (region) d.region = region;
    d.done = true;
    d.updated = Date.now();
    this.save();
  }

  bump(map, key, delta, max = 20) {
    if (!key) return;
    map[key] = Math.max(-5, Math.min(max, (map[key] || 0) + delta));
  }

  // señales de escucha: 'play' (≥30 s), 'like', 'unlike', 'skip' (antes de 15 s)
  signal(item, kind) {
    if (!item || !this.uid) return;
    const genre = item.genre || genreOf(item.genreRaw) || genreOf(item.genreTag);
    const artist = (item.artist || '').toLowerCase().split(/ feat\.| & |, /)[0].trim();
    const w = { play: [1, 1.5], like: [2.5, 3], unlike: [-1.5, -2], skip: [-0.6, -1] }[kind];
    if (!w) return;
    this.bump(this.data.genres, genre, w[0]);
    this.bump(this.data.artists, artist, w[1]);
    this.data.updated = Date.now();
    this.save();
  }

  topGenres(n = 3) {
    return Object.entries(this.data.genres).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, n).map(([g]) => g).filter((g) => GENRE_BY_ID[g]);
  }

  moodAudius() {
    return new Set(this.data.moods.flatMap((m) => MOODS.find((x) => x.id === m)?.audius || []));
  }

  score(item, { recent = new Set(), popularityRank = 0 } = {}) {
    const d = this.data;
    const genre = item.genre || genreOf(item.genreRaw);
    const artist = (item.artist || '').toLowerCase().split(/ feat\.| & |, /)[0].trim();
    let s = 0;
    s += (d.genres[genre] || 0) * 1.0;
    s += (d.artists[artist] || 0) * 1.4;
    if (item.mood && this.moodAudius().has(item.mood)) s += 2;
    if (item.verified) s += 0.5;
    s += Math.max(0, 3 - popularityRank * 0.1);       // algo de peso a lo popular
    if (recent.has(item.id)) s -= 4;                    // novedad: no repetir lo recién escuchado
    return s;
  }
}

// Ordena por puntaje y aplica diversidad (máx. por artista)
export function rank(taste, items, { limit = 12, perArtist = 2, recent } = {}) {
  const scored = items.map((it, i) => ({ it, s: taste.score(it, { recent, popularityRank: i }) }));
  scored.sort((a, b) => b.s - a.s);
  const count = new Map(), out = [], seen = new Set();
  for (const { it } of scored) {
    if (seen.has(it.id)) continue;
    const a = (it.artist || '').toLowerCase();
    if ((count.get(a) || 0) >= perArtist) continue;
    count.set(a, (count.get(a) || 0) + 1);
    seen.add(it.id);
    out.push(it);
    if (out.length >= limit) break;
  }
  return out;
}

// Contenido externo guardado (para playlists, me gusta, historial y colas al reabrir)
export class Catalog {
  constructor() { this.items = new Map(); }

  async load() {
    for (const it of await db.all('catalog')) this.items.set(it.id, it);
  }

  get(id) { return this.items.get(id); }

  remember(item) {
    if (!item || item.kind !== 'remote') return;
    if (!this.items.has(item.id)) {
      this.items.set(item.id, item);
      db.put('catalog', item).catch(() => {});
    }
  }
}
