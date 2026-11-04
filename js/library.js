// Biblioteca local: importación, metadatos, carátulas y cola de análisis de sonoridad.
// Cada pista subida por un oyente es privada de su cuenta (`owner`). Las de lanzamientos de artista llevan
// `origin: 'release'`: no son de nadie en particular y se escuchan desde el catálogo cuando se publican.
import { db } from './store/db.js';
import { readTags } from './meta/tags.js';

const MAX_LOCAL = 500 * 1024 * 1024;   // subida privada del oyente
const MAX_RELEASE = 400 * 1024 * 1024; // pista de lanzamiento
const AUDIO_EXT = /\.(flac|mp3|m4a|mp4|aac|alac|ogg|oga|opus|wav|wave|aif|aiff|webm|weba)$/i;

export class Library extends EventTarget {
  constructor(engine) {
    super();
    this.engine = engine;
    this.items = [];
    this.byId = new Map();
    this.covers = new Map();
    this.blobUrls = new WeakMap(); // Blob → dirección (compartida entre pistas con la misma carátula)
    this.coverBlobOf = new Map(); // dirección → Blob, para limpiar al liberar
    this.visible = null;
    this.memo = null;
    this.uid = null; // cuenta activa: sólo ve su música (y la importada antes de que hubiera dueños)
    this.skipped = [];
    this.analyzing = false;
    this.pendingCount = 0;
    this.queue = Promise.resolve();
    this.jobs = new Map();
    this.jobId = 0;
    this.worker = new Worker(new URL('./audio/loudness-worker.js', import.meta.url));
    this.worker.onmessage = (e) => {
      const resolve = this.jobs.get(e.data.id);
      this.jobs.delete(e.data.id);
      resolve?.(e.data);
    };
    this.worker.onerror = (e) => console.warn('[library] worker', e.message);
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  get tracks() {
    return (this.visible ??= this.items.filter((t) => !t.hidden && t.origin !== 'release' && (!t.owner || t.owner === this.uid)));
  }

  changed() {
    this.visible = null;
    this.memo = null;
    this.emit('change');
  }

  async load() {
    const [tracks, analysis] = await Promise.all([db.all('tracks'), db.all('analysis')]);
    const byId = new Map(analysis.map((a) => [a.id, a]));
    for (const t of tracks) {
      const a = byId.get(t.id);
      if (a) { t.analysis = a; t.duration = a.duration || t.duration; }
    }
    this.items = tracks.sort((a, b) => b.added - a.added);
    this.byId = new Map(tracks.map((t) => [t.id, t]));
    this.changed();
    this.pump();
  }

  isAudio(file) {
    return AUDIO_EXT.test(file.name) || /^audio\//.test(file.type);
  }

  // Las importaciones se encolan: dos arrastres seguidos nunca duplican pistas.
  import(files, opts = {}) {
    const run = this.queue.then(() => this.importNow(files, opts));
    this.queue = run.catch(() => {});
    return run;
  }

  setOwner(uid) { this.uid = uid || null; this.changed(); }

  async importNow(files, { hidden = false, releaseId = null } = {}) {
    const max = releaseId ? MAX_RELEASE : MAX_LOCAL;
    const all = [...files].filter((f) => this.isAudio(f));
    const list = all.filter((f) => f.size <= max);
    this.skipped = all.filter((f) => f.size > max).map((f) => f.name);
    const added = [];
    if (!list.length) return added;
    const base = Date.now();
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      // id con prefijo: dos cuentas (o un lanzamiento) con el mismo archivo no chocan
      const raw = `${f.name}:${f.size}:${f.lastModified}`;
      const id = releaseId ? `rel:${releaseId}:${raw}` : `${(this.uid || 'anon').slice(0, 8)}:${raw}`;
      const legacy = !releaseId && this.byId.get(raw);
      const existing = this.byId.get(id) || (legacy && (!legacy.owner || legacy.owner === this.uid) ? legacy : null);
      if (existing) {
        if (hidden) added.push(existing);
        continue;
      }
      this.emit('progress', { done: i, total: list.length, name: f.name });
      try {
        const tags = readTags(await f.arrayBuffer(), f.name);
        const { cover, ...meta } = tags;
        const track = {
          id,
          ...meta,
          fileName: f.name,
          size: f.size,
          added: base + (list.length - i),
          blob: f,
          coverBlob: cover ? new Blob([cover.data], { type: cover.mime }) : null,
          hidden,
          releaseId,
          origin: releaseId ? 'release' : 'local',
          owner: releaseId ? null : this.uid,
        };
        await db.put('tracks', track);
        this.items.unshift(track);
        this.byId.set(id, track);
        added.push(track);
      } catch (err) {
        console.warn('[library] no se pudo importar', f.name, err);
      }
    }
    this.items.sort((a, b) => b.added - a.added);
    this.emit('progress', { done: list.length, total: list.length });
    this.changed();
    this.pump();
    return added;
  }

  async update(track, patch) {
    Object.assign(track, patch);
    if ('coverBlob' in patch) this.dropCover(track.id);
    const { analysis, analysisFailed, unplayable, ...stored } = track;
    await db.put('tracks', stored);
    this.changed();
  }

  dropCover(id) {
    const url = this.covers.get(id);
    if (!url) return;
    this.covers.delete(id);
    // la dirección puede estar compartida con otras pistas de la misma carátula: sólo se libera con la última
    for (const u of this.covers.values()) if (u === url) return;
    URL.revokeObjectURL(url);
    const blob = this.coverBlobOf.get(url);
    if (blob) { this.blobUrls.delete(blob); this.coverBlobOf.delete(url); }
  }

  async remove(id) {
    if (!this.byId.has(id)) return;
    await Promise.all([db.del('tracks', id), db.del('analysis', id)]);
    this.items = this.items.filter((x) => x.id !== id);
    this.byId.delete(id);
    this.dropCover(id);
    this.emit('removed', { id });
    this.changed();
  }

  async clear() {
    // sólo la música privada de esta cuenta: lanzamientos y música de otras cuentas no se tocan
    const mine = new Set(this.tracks);
    const keep = this.items.filter((t) => !mine.has(t));
    const ids = [];
    for (const t of mine) { await db.del('tracks', t.id); await db.del('analysis', t.id); this.dropCover(t.id); ids.push(t.id); }
    this.items = keep;
    this.byId = new Map(keep.map((t) => [t.id, t]));
    this.emit('removed', { ids });
    this.changed();
  }

  coverUrl(track) {
    if (track?.kind === 'remote') return track.artwork || null;
    if (!track?.coverBlob) return track?.coverUrl || track?.artwork || null;
    let url = this.covers.get(track.id);
    if (!url) {
      // una dirección por Blob, no por pista: con una por pista el navegador decodificaba y guardaba la misma
      // carátula cientos de veces y al soltarlas bloqueaba el hilo principal (~90 ms al cambiar de vista)
      url = this.blobUrls.get(track.coverBlob);
      if (!url) { url = URL.createObjectURL(track.coverBlob); this.blobUrls.set(track.coverBlob, url); this.coverBlobOf.set(url, track.coverBlob); }
      this.covers.set(track.id, url);
    }
    return url;
  }

  // ---------- análisis de sonoridad en segundo plano ----------

  async pump() {
    if (this.analyzing) return;
    this.analyzing = true;
    try {
      for (;;) {
        const todo = this.items.filter((t) => !t.analysis && !t.analysisFailed);
        this.pendingCount = todo.length;
        this.emit('analysis', { remaining: todo.length });
        if (!todo.length) break;
        const cur = this.engine.current;
        const t = todo.find((x) => x === cur) ?? todo.find((x) => x.hidden) ?? todo[0];
        await this.analyzeTrack(t);
        await new Promise((r) => setTimeout(r, 30));
      }
    } finally {
      this.analyzing = false;
    }
  }

  async analyzeTrack(t) {
    try {
      // si el motor ya decodificó la pista, se reutiliza en vez de decodificar dos veces
      const cached = this.engine.buffers.get(t.id);
      const buffer = cached ? await cached : await this.engine.ctx.decodeAudioData(await t.blob.arrayBuffer());
      const channels = [];
      for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c).slice());
      const id = ++this.jobId;
      const res = await new Promise((resolve) => {
        this.jobs.set(id, resolve);
        this.worker.postMessage({ id, channels, sampleRate: buffer.sampleRate }, channels.map((c) => c.buffer));
      });
      if (res.error) throw new Error(res.error);
      const analysis = {
        id: t.id,
        lufs: res.lufs,
        truePeakDb: res.truePeakDb,
        samplePeakDb: res.samplePeakDb,
        waveform: res.waveform,
        duration: buffer.duration,
        at: Date.now(),
      };
      if (!this.byId.has(t.id)) return; // se borró mientras se analizaba
      await db.put('analysis', analysis);
      t.analysis = analysis;
      t.duration = buffer.duration;
      this.memo = null;
      this.emit('analyzed', { track: t });
    } catch (err) {
      console.warn('[library] análisis falló', t.fileName, err);
      t.analysisFailed = true;
      this.emit('analyzed', { track: t, failed: true });
    }
  }

  // ---------- vistas derivadas ----------

  derive() {
    if (this.memo) return this.memo;
    const albums = new Map();
    const artists = new Map();
    for (const t of this.tracks) {
      const artist = t.albumArtist || t.artist || 'Artista desconocido';
      const title = t.album || 'Sin álbum';
      const key = `${encodeURIComponent(artist)}|${encodeURIComponent(title)}`;
      let a = albums.get(key);
      if (!a) albums.set(key, (a = { key, title, artist, year: t.year, tracks: [], cover: null, added: 0 }));
      a.tracks.push(t);
      if (!a.cover && t.coverBlob) a.cover = t;
      a.added = Math.max(a.added, t.added);
      a.year ||= t.year;

      const name = t.artist || 'Artista desconocido';
      let ar = artists.get(name);
      if (!ar) artists.set(name, (ar = { name, tracks: [], albums: new Set(), cover: null }));
      ar.tracks.push(t);
      ar.albums.add(key);
      if (!ar.cover && t.coverBlob) ar.cover = t;
    }
    const byDisc = (x, y) => (x.disc || 1) - (y.disc || 1) || (x.track || 0) - (y.track || 0) || x.title.localeCompare(y.title);
    for (const a of albums.values()) a.tracks.sort(byDisc);
    this.memo = {
      albums: [...albums.values()].sort((x, y) => y.added - x.added),
      albumMap: albums,
      artists: [...artists.values()].sort((x, y) => x.name.localeCompare(y.name)),
      artistMap: artists,
    };
    return this.memo;
  }

  search(q) {
    const s = q.trim().toLowerCase();
    if (!s) return this.tracks;
    return this.tracks.filter((t) => `${t.title} ${t.artist} ${t.album} ${t.albumArtist}`.toLowerCase().includes(s));
  }
}
