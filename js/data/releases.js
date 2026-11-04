// Lanzamientos publicados y estrenos programados de TODAS las cuentas del equipo (el "catálogo ZUENA").
// Reglas: Requisitos/Subida de música y estrenos.md. En modo local "global" = todas las cuentas de este
// equipo (se rotula "Publicado en este equipo"); con nube, este módulo es el que se conecta a Firebase.
import { db } from '../store/db.js';

export const PREMIERE_MIN_MS = 15 * 60e3;     // mínimo 15 min a futuro
export const PREMIERE_MAX_MS = 365 * 864e5;   // máximo un año
export const RESCHEDULE_LOCK_MS = 60 * 60e3;  // en la última hora ya no se mueve

// ¿Se puede escuchar? (publicado, o programado cuya hora ya llegó)
export const isLive = (r, now = Date.now()) => r.status === 'published' || (r.status === 'scheduled' && now >= r.premiereAt);
export const isUpcoming = (r, now = Date.now()) => r.status === 'scheduled' && now < r.premiereAt;

// valida la fecha elegida para un estreno; devuelve el mensaje de error o ''
export function premiereError(at, now = Date.now()) {
  if (!Number.isFinite(at)) return 'Elegí la fecha y la hora del estreno';
  if (at < now + PREMIERE_MIN_MS) return 'El estreno tiene que ser al menos 15 minutos a futuro';
  if (at > now + PREMIERE_MAX_MS) return 'El estreno puede programarse hasta un año a futuro';
  return '';
}

// estado al aprobarse la revisión: estreno futuro → programado; si no (o la fecha ya pasó) → publicado
export function statusOnApprove(r, now = Date.now()) {
  return r.releaseMode === 'scheduled' && r.premiereAt > now ? 'scheduled' : 'published';
}

// cuenta regresiva legible
export function countdown(at, now = Date.now()) {
  const ms = Math.max(0, at - now);
  const m = Math.floor(ms / 60e3), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (h >= 48) return `Faltan ${d} días`;
  if (h >= 1) return `Faltan ${h} h ${String(m % 60).padStart(2, '0')} min`;
  const s = Math.floor(ms / 1000) % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const premiereLabel = (at) => new Date(at).toLocaleString('es', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export class Releases extends EventTarget {
  constructor() {
    super();
    this.all = [];
    this.channel = 'BroadcastChannel' in self ? new BroadcastChannel('zuena-releases') : null;
    if (this.channel) this.channel.onmessage = () => this.load();
  }

  emit() { this.dispatchEvent(new Event('change')); }

  async load() {
    this.all = await db.all('releases');
    this.emit();
  }

  // cambio hecho acá: avisar a las otras pestañas
  broadcast() { this.channel?.postMessage('changed'); }

  live(now = Date.now()) { return this.all.filter((r) => isLive(r, now)).sort((a, b) => (b.published || b.premiereAt || 0) - (a.published || a.premiereAt || 0)); }
  upcoming(now = Date.now()) { return this.all.filter((r) => isUpcoming(r, now)).sort((a, b) => a.premiereAt - b.premiereAt); }
  get(id) { return this.all.find((r) => r.id === id) || null; }
  byTrack(trackId) { return this.all.find((r) => r.tracks?.some((t) => t.trackId === trackId)) || null; }

  // programados cuya hora llegó → publicados. Idempotente: relee el registro y actúa sólo si sigue programado.
  // `onPublish(r)` materializa (pistas disponibles, post del feed).
  async resolveScheduled(onPublish, now = Date.now()) {
    const due = this.all.filter((r) => r.status === 'scheduled' && now >= r.premiereAt);
    for (const r of due) {
      const fresh = await db.get('releases', r.id);
      if (fresh?.status !== 'scheduled') continue;
      fresh.status = 'published';
      fresh.published = fresh.premiereAt; // la hora del estreno, no la hora en que se abrió la app
      fresh.updated = now;
      await db.put('releases', fresh);
      Object.assign(r, fresh);
      await onPublish?.(r);
    }
    if (due.length) { this.emit(); this.broadcast(); }
    return due.length;
  }
}
