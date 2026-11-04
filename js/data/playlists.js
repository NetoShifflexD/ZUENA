// Playlists y "Me gusta" de cada usuario (con canciones de sus archivos locales),
// más estadísticas de escucha para el perfil.
import { db } from '../store/db.js';

export class Playlists extends EventTarget {
  constructor() {
    super();
    this.uid = null;
    this.list = [];
  }

  emit() { this.dispatchEvent(new Event('change')); }

  async load(uid) {
    this.uid = uid;
    this.list = uid ? await db.byIndex('playlists', 'owner', uid) : [];
    if (uid && !this.likes) {
      const likes = { id: `likes-${uid}`, owner: uid, system: 'likes', name: 'Me gusta', trackIds: [], created: Date.now(), updated: Date.now() };
      await db.put('playlists', likes);
      this.list.push(likes);
    }
    this.sort();
    this.emit();
  }

  sort() { this.list.sort((a, b) => (a.system ? -1 : b.system ? 1 : b.updated - a.updated)); }

  get likes() { return this.list.find((p) => p.system === 'likes'); }
  get mine() { return this.list.filter((p) => !p.system); }
  get(id) { return this.list.find((p) => p.id === id); }

  async save(p) {
    p.updated = Date.now();
    await db.put('playlists', p);
    this.sort();
    this.emit();
    return p;
  }

  async create({ name, description = '', cover = null, trackIds = [] }) {
    const p = { id: crypto.randomUUID(), owner: this.uid, name: name.trim() || 'Nueva playlist', description, cover, trackIds: [...new Set(trackIds)], created: Date.now() };
    this.list.push(p);
    return this.save(p);
  }

  async update(id, patch) {
    const p = this.get(id);
    if (!p) return null;
    Object.assign(p, patch);
    return this.save(p);
  }

  async remove(id) {
    const p = this.get(id);
    if (!p || p.system) return;
    await db.del('playlists', id);
    this.list = this.list.filter((x) => x !== p);
    this.emit();
  }

  async add(id, trackIds) {
    const p = this.get(id);
    if (!p) return 0;
    const before = p.trackIds.length;
    p.trackIds = [...new Set([...p.trackIds, ...trackIds])];
    await this.save(p);
    return p.trackIds.length - before;
  }

  async removeAt(id, index) {
    const p = this.get(id);
    if (!p) return;
    p.trackIds.splice(index, 1);
    await this.save(p);
  }

  async move(id, from, to) {
    const p = this.get(id);
    if (!p || from === to) return;
    const [x] = p.trackIds.splice(from, 1);
    p.trackIds.splice(to, 0, x);
    await this.save(p);
  }

  isLiked(trackId) { return !!this.likes?.trackIds.includes(trackId); }

  async toggleLike(trackId) {
    const p = this.likes;
    if (!p) return false;
    const i = p.trackIds.indexOf(trackId);
    if (i >= 0) p.trackIds.splice(i, 1); else p.trackIds.unshift(trackId);
    await this.save(p);
    return i < 0;
  }

  // borra referencias a pistas que salieron de la biblioteca (en todas las cuentas del equipo)
  async prune(ids) {
    const gone = new Set(ids || []);
    const all = await db.all('playlists');
    for (const p of all) {
      const keep = p.trackIds.filter((id) => !gone.has(id));
      if (keep.length !== p.trackIds.length) { p.trackIds = keep; await db.put('playlists', p); }
    }
    if (this.uid) await this.load(this.uid);
  }
}

// Estadísticas de escucha: una reproducción cuenta después de 30 s
export class Stats {
  constructor() {
    this.uid = null;
    this.data = null;
    this.trackId = null;
    this.listened = 0;
    this.counted = false;
    this.dirty = false;
  }

  async load(uid) {
    if (this.dirty) await this.flush();
    this.uid = uid;
    this.data = (uid && (await db.kvGet(`stats:${uid}`))) || { plays: {}, recent: [], seconds: 0 };
  }

  tick(track, seconds) {
    if (!this.uid || !track) return;
    if (track.id !== this.trackId) { this.trackId = track.id; this.listened = 0; this.counted = false; }
    this.listened += seconds;
    this.data.seconds += seconds;
    this.dirty = true;
    if (!this.counted && this.listened >= Math.min(30, (track.duration || 60) * 0.5)) {
      this.counted = true;
      this.data.plays[track.id] = (this.data.plays[track.id] || 0) + 1;
      this.data.recent = [track.id, ...this.data.recent.filter((id) => id !== track.id)].slice(0, 50);
      // misma regla para los charts (oyentes por artista y por día): una vez por reproducción
      try { this.onCount?.(track, this.uid); } catch (err) { console.warn('[stats] charts', err); }
    }
  }

  restart() { this.trackId = null; }

  async flush() {
    if (!this.uid || !this.dirty) return;
    this.dirty = false;
    await db.kvSet(`stats:${this.uid}`, this.data);
  }

  top(n = 10) {
    return Object.entries(this.data?.plays || {}).sort((a, b) => b[1] - a[1]).slice(0, n);
  }
}
