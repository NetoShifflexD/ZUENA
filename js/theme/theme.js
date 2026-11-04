// Temas de ZUENA (estética "Prisma": vidrio lechoso, neutros acero y luz iridiscente).
// Un tema es sólo un par de colores; el modo (automático, claro u oscuro) es independiente.
import { oklch, hexToOklch } from './color.js';

export const DEFAULT_THEME = 'prisma';
export const PRESETS = [
  { id: 'prisma', name: 'Prisma', accent: '#3a9fc4', accent2: '#f0b36c' },
  { id: 'aurora', name: 'Aurora', accent: '#8b6cf0', accent2: '#ff6fb5' },
  { id: 'oceano', name: 'Océano', accent: '#2fa6e0', accent2: '#5b6cff' },
  { id: 'coral', name: 'Coral', accent: '#f0705f', accent2: '#ffb84d' },
  { id: 'bosque', name: 'Bosque', accent: '#3fbf8a', accent2: '#2fb8c9' },
  { id: 'atardecer', name: 'Atardecer', accent: '#f08236', accent2: '#e9407a' },
  { id: 'rosa', name: 'Rosa', accent: '#ec5a9b', accent2: '#b45cff' },
  { id: 'medianoche', name: 'Medianoche', accent: '#6f8cff', accent2: '#6b4dff' },
  { id: 'grafito', name: 'Grafito', accent: '#7b8a99', accent2: '#c9b8ff' },
  { id: 'arena', name: 'Arena', accent: '#c98436', accent2: '#c24d6b' },
];

// modo del sistema operativo (para "Automático")
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
export const systemMode = () => (darkQuery.matches ? 'dark' : 'light');
export function onSystemModeChange(cb) { darkQuery.addEventListener('change', cb); }
// Tipografías sobrias que acompañan la estética de vidrio
export const DEFAULT_FONT = 'Inter Tight';
export const FONTS = [
  { id: 'Inter Tight', label: 'Inter Tight', css: null },
  { id: 'Geist', label: 'Geist', css: 'Geist:wght@500;600;700' },
  { id: 'Manrope', label: 'Manrope', css: 'Manrope:wght@500;600;700;800' },
  { id: 'Sora', label: 'Sora', css: 'Sora:wght@500;600;700' },
  { id: 'Plus Jakarta Sans', label: 'Jakarta', css: 'Plus+Jakarta+Sans:wght@500;600;700' },
  { id: 'Instrument Sans', label: 'Instrument', css: 'Instrument+Sans:wght@500;600;700' },
  { id: 'DM Sans', label: 'DM Sans', css: 'DM+Sans:wght@500;600;700' },
  { id: 'Urbanist', label: 'Urbanist', css: 'Urbanist:wght@500;600;700' },
  { id: 'system', label: 'Sistema', css: null },
];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const loadedFonts = new Set();

export function loadFont(id) {
  const f = FONTS.find((x) => x.id === id);
  if (!f?.css || loadedFonts.has(id)) return;
  loadedFonts.add(id);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${f.css}&display=swap`;
  document.head.appendChild(link);
}

// las tipografías viejas (Syne, Caveat…) caen a la predeterminada
export const fontStack = (id) => {
  if (id === 'system') return 'var(--font)';
  const f = FONTS.find((x) => x.id === id) || FONTS[0];
  return `"${f.id}", var(--font)`;
};

// El tema por defecto de ZUENA es el claro (2026-11-02). 'auto' sigue al sistema operativo.
export const DEFAULT_MODE = 'light';
export const MODES = [['light', 'Claro'], ['dark', 'Oscuro'], ['auto', 'Automático']];
export const modeOf = (mode) => (MODES.some(([v]) => v === mode) ? mode : DEFAULT_MODE);
export const followsSystem = (mode) => modeOf(mode) === 'auto';

// Resuelve { theme, accent, mode } de un perfil a colores concretos (mode null = claro)
export function resolveTheme({ theme = DEFAULT_THEME, accent = null, mode = null } = {}) {
  const p = PRESETS.find((x) => x.id === theme) || PRESETS[0];
  const m = modeOf(mode);
  return { accent: accent || p.accent, accent2: p.accent2, mode: m === 'auto' ? systemMode() : m };
}

// Superficies neutras (acero) apenas teñidas por el acento; la luz de fondo usa el acento y el
// segundo color en tonos pastel (claro) o luminosos (oscuro).
export function buildPalette({ accent, accent2, mode }) {
  const a = hexToOklch(accent), b = hexToOklch(accent2);
  const dark = mode === 'dark';
  const grey = a.C < 0.03;
  const steel = 4.05; // matiz azul acero (rad) para los neutros
  const nh = steel + (a.h - steel) * 0.15;
  const p = dark ? {
    accent: oklch(clamp(a.L, 0.76, 0.84), grey ? 0.02 : clamp(a.C, 0.08, 0.16), a.h),
    accent2: oklch(clamp(b.L, 0.72, 0.82), clamp(b.C, 0.06, 0.16), b.h),
    tint: oklch(0.24, 0.022, nh),
    text: oklch(0.96, 0.008, nh),
    onAccent: oklch(0.18, 0.02, a.h),
    bgBase: oklch(0.17, 0.025, nh),
    bg1: oklch(0.6, clamp(a.C, 0.08, 0.16), a.h),
    bg2: oklch(0.62, clamp(b.C, 0.08, 0.15), b.h),
    bg3: oklch(0.55, 0.12, 5.4),
  } : {
    accent: oklch(clamp(a.L, 0.52, 0.6), grey ? 0.02 : clamp(a.C, 0.09, 0.16), a.h),
    accent2: oklch(0.66, clamp(b.C, 0.08, 0.15), b.h),
    tint: oklch(0.975, 0.008, nh),
    text: oklch(0.27, 0.025, nh),
    onAccent: oklch(0.99, 0.004, a.h),
    bgBase: oklch(0.88, 0.022, nh),
    bg1: oklch(0.88, clamp(a.C, 0.07, 0.13), a.h),
    bg2: oklch(0.9, clamp(b.C, 0.06, 0.12), b.h),
    bg3: oklch(0.9, 0.07, 5.4),
  };
  p.scheme = dark ? 'dark' : 'light';
  return p;
}
const TOKENS = { accent: '--accent', accent2: '--accent-2', tint: '--tint', text: '--text', onAccent: '--on-accent', bgBase: '--bg-base', bg1: '--bg-1', bg2: '--bg-2', bg3: '--bg-3' };

export function applyTheme(settings, el = document.documentElement) {
  const palette = buildPalette(resolveTheme(settings));
  for (const [k, v] of Object.entries(TOKENS)) el.style.setProperty(v, palette[k]);
  if (el === document.documentElement) {
    el.dataset.scheme = palette.scheme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', palette.bgBase);
  }
  return palette;
}

// tokens como string de estilo en línea, para tarjetas y vistas previas de perfil
export function themeStyle(settings) {
  const p = buildPalette(resolveTheme(settings));
  return Object.entries(TOKENS).map(([k, v]) => `${v}:${p[k]}`).join(';');
}
