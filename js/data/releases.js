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

export function countdownParts(at, now = Date.now()) {
  const ms = Math.max(0, at - now);
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return { d: pad(d), h: pad(h), m: pad(m), s: pad(s), live: ms <= 0 };
}

// Personalización de la tarjeta de estreno v2 (2026-11-20). Cada atmósfera redefine dentro de la tarjeta los
// tokens de fondo, texto, línea y acción (css/brand-releases.css): antes sólo cambiaba un acento que el color
// guardado pisaba, y las cinco se veían iguales. `dark` indica fondo oscuro (texto claro).
export const PREMIERE_THEMES = [
  { id: 'paper', label: 'Papel ZUENA', accent: '#111111', dark: false },
  { id: 'obsidian', label: 'Obsidiana', accent: '#5ff0ff', dark: true },
  { id: 'aurora', label: 'Aurora violeta', accent: '#c084fc', dark: true },
  { id: 'gold', label: 'Cuarzo dorado', accent: '#b7791f', dark: false },
  { id: 'crimson', label: 'Pulso carmesí', accent: '#fb7185', dark: true },
  { id: 'prism', label: 'Esmeralda', accent: '#34d399', dark: true },
  { id: 'cover', label: 'Portada', accent: '#ffffff', dark: true },
];
export const PREMIERE_LAYOUTS = [
  { id: 'editorial', label: 'Editorial', hint: 'Portada al costado del título' },
  { id: 'poster', label: 'Póster', hint: 'Portada grande arriba' },
];
// acentos sugeridos (además del color libre)
export const PREMIERE_ACCENTS = ['#111111', '#5ff0ff', '#c084fc', '#fb7185', '#f5b841', '#34d399', '#60a5fa', '#ffffff'];
export const PREMIERE_NOTE_MAX = 160;
export const PREMIERE_DEFAULTS = { premiereTheme: 'paper', premiereLayout: 'editorial', premiereAccent: '#111111' };

const HEX = /^#[0-9a-f]{6}$/i;
// luminancia relativa WCAG de un color #rrggbb
export function luminance(hex) {
  if (!HEX.test(hex || '')) return 0;
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
// texto que se lee sobre un botón del color de acento
export const onAccent = (hex) => (contrast(hex, '#000000') >= contrast(hex, '#ffffff') ? '#000000' : '#ffffff');

// valores guardados → valores válidos (datos viejos, campos vacíos o inventados)
export function premiereStyle(r = {}) {
  const theme = PREMIERE_THEMES.find((t) => t.id === r.premiereTheme) || PREMIERE_THEMES[0];
  const layout = PREMIERE_LAYOUTS.some((l) => l.id === r.premiereLayout) ? r.premiereLayout : 'editorial';
  const accent = HEX.test(r.premiereAccent || '') ? r.premiereAccent.toLowerCase() : theme.accent;
  const note = String(r.premiereNote || '').trim().slice(0, PREMIERE_NOTE_MAX);
  return { theme: theme.id, dark: theme.dark, layout, accent, onAccent: onAccent(accent), note };
}

// aviso cuando el acento casi no se distingue del fondo de la atmósfera (no bloquea: el botón ya ajusta su texto)
export function accentWarning(themeId, accent) {
  const t = PREMIERE_THEMES.find((x) => x.id === themeId);
  if (!t || !HEX.test(accent || '')) return '';
  const bg = t.dark ? '#111111' : '#fafafa';
  return contrast(accent, bg) < 1.6 ? 'Este color casi no se distingue del fondo. Probá uno más claro o más oscuro.' : '';
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
