// Charts de ZUENA: "Top oyentes mensuales" (oyentes únicos en los últimos 28 días) y "Top suscriptores
// mensuales" (suscripciones simuladas activas). Requisitos/Feed de artistas, suscripciones y charts §4 y §8.
// · Los datos son de ESTE EQUIPO (cuentas locales) más la actividad simulada de oyentes ficticios, que sólo
//   puede tocar artistas ficticios (`zu:sim-*`). Nunca se generan cifras sobre artistas reales.
// · kv `charts:day:<AAAA-MM-DD>` = { v:1, a: { "<clave>": { l:[uids], p:n, w:n, wl:[uids], s:[uids sim] } } }
//   kv `charts:month:<AAAA-MM>` = resumen compactado · kv `charts:meta` = { v:1, days, compacted, lastCompact }
// · Las funciones puras de arriba no tocan el DOM ni la base (se prueban en js/tests/run.js).
import { db } from '../store/db.js';
import { TEST_CATALOG } from '../config.js';
import { testArtistById, testArtistByName, testArtistCards } from './testArtists.js';

export const WINDOW_DAYS = 28;
export const KEEP_DAYS = 62;
export const KEEP_MONTHS = 24;
const pad = (n) => String(n).padStart(2, '0');

// días y meses por calendario LOCAL del dispositivo
export function dayKey(ts = Date.now()) { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function monthKey(ts = Date.now()) { return dayKey(ts).slice(0, 7); }
// claves de los últimos n días, hoy incluido como el día 1 (setDate respeta los cambios de horario)
export function windowKeys(now = Date.now(), n = WINDOW_DAYS) {
  const out = [];
  const d = new Date(now);
  d.setHours(12, 0, 0, 0);
  for (let i = 0; i < n; i++) { out.push(dayKey(d.getTime())); d.setDate(d.getDate() - 1); }
  return out;
}
export function monthStart(now = Date.now()) { const d = new Date(now); d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime(); }

export const isSimKey = (key) => /^zu:sim-/.test(String(key || ''));
export const isCatalogKey = (key) => /^am:/.test(String(key || ''));
// la actividad simulada sólo puede registrarse sobre artistas ficticios
export const simKeyAllowed = (key) => isSimKey(key);

// documento diario válido: { v:1, a:{ clave: { l:[], p:n } } }
export function validDay(doc) {
  if (!doc || doc.v !== 1 || typeof doc.a !== 'object' || !doc.a) return false;
  return Object.values(doc.a).every((e) => e && Array.isArray(e.l) && typeof e.p === 'number');
}

const entry = (doc, key) => (doc.a[key] ||= { l: [], p: 0, w: 0, wl: [], s: [] });

// una reproducción contada: oyente único por (día, artista, uid); las reproducciones se suman sin dedupe
export function recordListen(doc, key, uid, { sim = false } = {}) {
  const d = validDay(doc) ? doc : { v: 1, a: {} };
  if (!key || !uid) return d;
  if (sim && !simKeyAllowed(key)) return d;
  const e = entry(d, key);
  const set = sim ? (e.s ||= []) : e.l;
  if (!set.includes(uid)) set.push(uid);
  e.p++;
  return d;
}

// visualización de perfil: 1 por (día, artista, uid o "invitado")
export function recordView(doc, key, viewer) {
  const d = validDay(doc) ? doc : { v: 1, a: {} };
  const e = entry(d, key);
  e.wl ||= [];
  const who = viewer || 'invitado';
  if (!e.wl.includes(who)) { e.wl.push(who); e.w = (e.w || 0) + 1; }
  return d;
}

// oyentes únicos y reproducciones por artista dentro de la ventana
export function listenersByKey(days, now = Date.now(), { window = WINDOW_DAYS, includeSim = true } = {}) {
  const out = new Map();
  for (const k of windowKeys(now, window)) {
    const doc = days[k];
    if (!validDay(doc)) continue;
    for (const [key, e] of Object.entries(doc.a)) {
      const sim = isSimKey(key);
      if (sim && !includeSim) continue;
      let r = out.get(key);
      if (!r) out.set(key, (r = { key, uids: new Set(), plays: 0, sim, catalog: isCatalogKey(key) }));
      for (const u of e.l) r.uids.add(u);
      // los oyentes ficticios sólo cuentan para artistas ficticios (nunca para catálogo ni registrados)
      if (sim) for (const u of e.s || []) r.uids.add(u);
      r.plays += e.p;
    }
  }
  return out;
}

const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'es') || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

// Top oyentes: oyentes desc → reproducciones → seguidores → nombre → clave. Sin filas en cero.
export function rankListeners(days, now = Date.now(), { window = WINDOW_DAYS, includeSim = true, meta = () => ({}), limit = 10 } = {}) {
  const rows = [...listenersByKey(days, now, { window, includeSim }).values()]
    .map((r) => ({ key: r.key, listeners: r.uids.size, plays: r.plays, sim: r.sim, catalog: r.catalog, followers: 0, name: '', ...meta(r.key) }))
    .filter((r) => r.listeners >= 1);
  rows.sort((a, b) => b.listeners - a.listeners || b.plays - a.plays || (b.followers || 0) - (a.followers || 0) || byName(a, b));
  return rows.slice(0, limit);
}

// Top suscriptores: sólo suscripciones simuladas activas de artistas ficticios. El catálogo nunca entra.
export function rankSubscribers(subs, days, now = Date.now(), { includeSim = true, meta = () => ({}), limit = 10 } = {}) {
  if (!includeSim) return [];
  const since = monthStart(now);
  const per = new Map();
  for (const [k, v] of Object.entries(subs || {})) {
    const artist = k.split('|')[1] || '';
    if (!artist.startsWith('sim-') || !(v?.tier >= 1)) continue;
    const key = `zu:${artist}`;
    const r = per.get(key) || { key, subs: 0, monthNew: 0 };
    r.subs++;
    if ((v.since || 0) >= since) r.monthNew++;
    per.set(key, r);
  }
  const lis = listenersByKey(days, now, { includeSim });
  const rows = [...per.values()].map((r) => ({ ...r, listeners: lis.get(r.key)?.uids.size || 0, sim: true, catalog: false, name: '', ...meta(r.key) }))
    .filter((r) => r.subs >= 1);
  rows.sort((a, b) => b.subs - a.subs || b.monthNew - a.monthNew || b.listeners - a.listeners || byName(a, b));
  return rows.slice(0, limit);
}

// resumen mensual: oyentes únicos del mes (sin repetir uid entre días), reproducciones y visualizaciones
export function compactMonth(docs) {
  const acc = new Map();
  for (const doc of docs || []) {
    if (!validDay(doc)) continue;
    for (const [key, e] of Object.entries(doc.a)) {
      const r = acc.get(key) || { uids: new Set(), plays: 0, views: 0 };
      for (const u of e.l) r.uids.add(u);
      if (isSimKey(key)) for (const u of e.s || []) r.uids.add(u);
      r.plays += e.p;
      r.views += e.w || 0;
      acc.set(key, r);
    }
  }
  const a = {};
  for (const [key, r] of acc) a[key] = { listeners: r.uids.size, plays: r.plays, views: r.views, followers: 0, subs: 0 };
  return { v: 1, a };
}

// artista principal de una pista (los colaboradores no suman en v1). null = no cuenta.
// Cuentan: lanzamientos de ZUENA disponibles y vistas previas de artistas del catálogo de prueba.
// No cuentan: biblioteca privada del oyente, radio, podcasts, Audius y estrenos aún no vigentes.
export function artistKeyOf(track, { releaseOf = () => null, isAvailable = () => true, byId = testArtistById, byName = testArtistByName } = {}) {
  if (!track || track.live || (track.type && track.type !== 'track')) return null;
  if (track.origin === 'release' || track.releaseId) {
    const r = releaseOf(track.id);
    if (!r?.uid || !isAvailable(track)) return null;
    return { key: `zu:${r.uid}`, owner: r.uid };
  }
  if (track.source === 'apple') {
    const a = (track.artistId && byId(track.artistId)) || byName(track.artist);
    return a ? { key: `am:${a.id}`, owner: null } : null;
  }
  return null;
}

// ---------- almacenamiento y consulta (usa la base local) ----------
export class Charts extends EventTarget {
  constructor(app) {
    super();
    this.app = app;
    this.days = {};
    this.meta = { v: 1, days: [], compacted: [] };
    this.dirty = new Set();
    this.timer = 0;
    this.cache = null;
    this.localFollowers = new Map();
    this.simFollows = {};
    this.warned = false;
    this.lastEmit = 0;
  }

  async load(now = Date.now()) {
    const meta = await db.kvGet('charts:meta').catch(() => null);
    this.meta = meta?.v === 1 ? { days: [], compacted: [], ...meta } : { v: 1, days: [], compacted: [] };
    this.days = {};
    const keys = windowKeys(now, KEEP_DAYS);
    const tomorrow = dayKey(now + 864e5);
    const docs = await Promise.all(keys.map((k) => db.kvGet(`charts:day:${k}`).catch(() => null)));
    keys.forEach((k, i) => {
      if (docs[i] == null) return;
      if (!validDay(docs[i])) { console.warn('[charts] día con formato inválido, se descarta', k); return; }
      this.days[k] = docs[i];
    });
    // días "futuros" (reloj que retrocedió): se ignoran salvo mañana
    this.meta.days = this.meta.days.filter((k) => k <= tomorrow || this.days[k]);
    this.simFollows = (TEST_CATALOG && (await db.kvGet('follows:sim').catch(() => null))) || {};
    await this.compact(now);
    if (!TEST_CATALOG) await this.purgeSim();
    this.refreshFollowers();
    if (!this.subsHooked && this.app.subs) { this.subsHooked = true; this.app.subs.addEventListener('change', () => this.notify()); }
    // fotos del catálogo de prueba (carátula más reciente; Apple no da foto de artista)
    if (TEST_CATALOG) testArtistCards().then((cards) => { this.art = new Map(cards.map((c) => [String(c.id), c.artwork])); this.cache = null; }).catch(() => {});
    this.cache = null;
  }

  // cierre de mes: los meses anteriores al actual se resumen una vez; los días > 62 y los meses > 24 se borran
  async compact(now = Date.now()) {
    const cur = monthKey(now);
    const done = new Set(this.meta.compacted);
    const months = [...new Set(this.meta.days.map((k) => k.slice(0, 7)))].filter((m) => m < cur && !done.has(m));
    for (const m of months) {
      const docs = [];
      for (const k of this.meta.days.filter((x) => x.startsWith(m))) {
        const d = this.days[k] ?? (await db.kvGet(`charts:day:${k}`).catch(() => null));
        if (validDay(d)) docs.push(d);
      }
      const doc = compactMonth(docs);
      for (const [key, r] of Object.entries(doc.a)) {
        r.followers = this.followersOf(key);
        if (isSimKey(key)) r.subs = this.app.subs?.countFor(key.slice(3)) || 0;
      }
      await db.kvSet(`charts:month:${m}`, doc).catch(() => {});
      this.meta.compacted.push(m);
    }
    const keep = new Set(windowKeys(now, KEEP_DAYS));
    const today = dayKey(now);
    for (const k of this.meta.days.filter((x) => !keep.has(x) && x < today)) {
      await db.kvDel(`charts:day:${k}`).catch(() => {});
      delete this.days[k];
    }
    this.meta.days = this.meta.days.filter((k) => keep.has(k) || k > today);
    this.meta.compacted.sort();
    while (this.meta.compacted.length > KEEP_MONTHS) await db.kvDel(`charts:month:${this.meta.compacted.shift()}`).catch(() => {});
    this.meta.lastCompact = now;
    await db.kvSet('charts:meta', this.meta).catch(() => {});
  }

  // reproducción contada (Stats.tick) de una cuenta con sesión
  listen(track, uid) {
    if (!uid) return false;
    const info = artistKeyOf(track, { releaseOf: (id) => this.app.releases?.byTrack?.(id), isAvailable: (t) => this.app.isAvailable?.(t) ?? true });
    if (!info || info.owner === uid) return false; // el artista escuchándose no suma
    return this.add(info.key, uid);
  }

  // escucha registrada (real o simulada). Lo simulado sólo sobre artistas ficticios.
  add(key, uid, { sim = false, ts = Date.now() } = {}) {
    if (sim && (!TEST_CATALOG || !simKeyAllowed(key))) return false;
    const k = dayKey(ts);
    this.days[k] = recordListen(this.days[k], key, uid, { sim });
    this.touch(k);
    return true;
  }

  view(key, viewer, owner = null) {
    if (!key || (viewer && viewer === owner)) return;
    const k = dayKey();
    this.days[k] = recordView(this.days[k], key, viewer);
    this.touch(k);
  }

  touch(k) {
    this.dirty.add(k);
    this.cache = null;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.save(), 1500);
    this.notify();
  }

  // aviso de cambio con límite de una vez cada 10 s (las vistas recalculan sólo si cambió el orden)
  notify() {
    this.cache = null;
    if (this.emitTimer) return;
    const wait = Math.max(0, this.lastEmit + 10e3 - Date.now());
    this.emitTimer = setTimeout(() => { this.emitTimer = 0; this.lastEmit = Date.now(); this.dispatchEvent(new Event('change')); }, wait);
  }

  async save() {
    const keys = [...this.dirty];
    this.dirty.clear();
    try {
      for (const k of keys) await db.kvSet(`charts:day:${k}`, this.days[k]);
      for (const k of keys) if (!this.meta.days.includes(k)) this.meta.days.push(k);
      await db.kvSet('charts:meta', this.meta);
    } catch (err) {
      console.warn('[charts] no se guardó', err);
      if (!this.warned) { this.warned = true; this.app.toast?.('No se pudieron guardar las estadísticas.'); }
    }
  }

  // historial simulado ya cargado (lo marca el simulador para no repetirlo)
  get simSeeded() { return !!this.meta.simSeeded; }
  async markSimSeeded(on = true) { this.meta.simSeeded = on; await this.save(); }

  async setSimFollows(map) {
    this.simFollows = map || {};
    this.cache = null;
    await db.kvSet('follows:sim', this.simFollows).catch(() => {});
  }

  // borra todo lo simulado: claves zu:sim-*, oyentes ficticios y seguidores simulados
  async purgeSim() {
    for (const [k, doc] of Object.entries(this.days)) {
      let changed = false;
      for (const key of Object.keys(doc.a)) {
        if (isSimKey(key)) { delete doc.a[key]; changed = true; continue; }
        const e = doc.a[key];
        if (e.s?.length) { e.s = []; changed = true; }
        const l = e.l.filter((u) => !String(u).startsWith('sim-'));
        if (l.length !== e.l.length) { e.l = l; changed = true; }
      }
      if (changed) this.dirty.add(k);
    }
    this.meta.simSeeded = false;
    this.simFollows = {};
    await db.kvDel('follows:sim').catch(() => {});
    this.cache = null;
    await this.save();
    this.dispatchEvent(new Event('change'));
  }

  // seguidores: cuentas de este equipo (follows:<uid>) + seguidores simulados (sólo artistas ficticios)
  async refreshFollowers() {
    try {
      const accounts = await db.all('accounts');
      const lists = await Promise.all(accounts.map((a) => db.kvGet(`follows:${a.uid}`).catch(() => null)));
      const m = new Map();
      for (const l of lists) for (const uid of l || []) m.set(uid, (m.get(uid) || 0) + 1);
      this.localFollowers = m;
      this.cache = null;
    } catch { /* sin cuentas locales */ }
  }

  followersOf(key) {
    const uid = String(key).replace(/^zu:/, '');
    const sim = isSimKey(key) && TEST_CATALOG ? (this.simFollows[uid] || []).length : 0;
    return (this.localFollowers.get(uid) || 0) + sim;
  }

  metaOf(key) {
    const s = String(key);
    if (s.startsWith('am:')) {
      const a = testArtistById(s.slice(3));
      return { name: a?.name || 'Artista', followers: 0, avatar: this.art?.get(s.slice(3)) || '' };
    }
    const uid = s.slice(3);
    const p = this.app.posts?.author(uid);
    return { name: p?.displayName || 'Artista', avatar: p?.avatar || '', followers: this.followersOf(key) };
  }

  // rankings con caché de 10 s (sin recalcular por fotograma)
  top(limit = 10, now = Date.now()) {
    if (this.cache && now - this.cache.at < 10e3 && this.cache.limit >= limit) {
      return { listeners: this.cache.listeners.slice(0, limit), subs: this.cache.subs.slice(0, limit) };
    }
    const meta = (k) => this.metaOf(k);
    const listeners = rankListeners(this.days, now, { includeSim: TEST_CATALOG, meta, limit });
    const subs = rankSubscribers(TEST_CATALOG ? this.app.subs?.map : {}, this.days, now, { includeSim: TEST_CATALOG, meta, limit });
    this.cache = { at: now, limit, listeners, subs };
    return { listeners, subs };
  }

  // posición de un artista en cada ranking (para "En los charts" del perfil)
  positionOf(key) {
    const { listeners, subs } = this.top(10);
    const li = listeners.findIndex((r) => r.key === key), si = subs.findIndex((r) => r.key === key);
    return { listeners: li >= 0 ? { pos: li + 1, ...listeners[li] } : null, subs: si >= 0 ? { pos: si + 1, ...subs[si] } : null };
  }
}
