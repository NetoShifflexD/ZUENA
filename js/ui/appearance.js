// Apariencia y personalización v2 (2026-11-02). Dos niveles:
// · del perfil (viaja con la cuenta): modo, tema, color de acento propio y tipografía de títulos;
// · del equipo (app.prefs): densidad, intensidad del vidrio, tamaño de texto y fondo animado.
// Lo del equipo se aplica como atributos en <html> (data-density, data-glass, data-text, data-ambient) y lo
// interpreta css/appearance.css a través de los tokens de vidrio, sin tocar cada componente.
import { app, registerActions } from '../app.js';
import { db } from '../store/db.js';
import { saveProfile } from '../data/profiles.js';

export const LOOK = {
  density: { label: 'Densidad', def: 'comfy', opts: [['comfy', 'Cómoda'], ['compact', 'Compacta']], hint: 'Compacta muestra más filas y tarjetas en pantalla.' },
  glass: { label: 'Vidrio', def: 'balanced', opts: [['clear', 'Transparente'], ['balanced', 'Equilibrado'], ['solid', 'Sólido']], hint: 'Sólido quita la transparencia: se lee mejor y consume menos en equipos modestos.' },
  text: { label: 'Tamaño de texto', def: 'normal', opts: [['normal', 'Normal'], ['large', 'Grande'], ['xl', 'Muy grande']], hint: '' },
};
// colores de acento rápidos (además del selector libre)
export const ACCENTS = ['#2f7fd8', '#218cb1', '#1f9d6b', '#7a5af5', '#c2417a', '#d9622b', '#c98436', '#55606e'];

const val = (k) => (LOOK[k].opts.some(([v]) => v === app.prefs?.[k]) ? app.prefs[k] : LOOK[k].def);
export const lookValue = val;

export function applyLook() {
  const d = document.documentElement;
  for (const k of Object.keys(LOOK)) d.dataset[k] = val(k);
  d.dataset.ambient = app.prefs?.ambient === false ? 'off' : 'on';
}

const savePrefs = () => db.kvSet('prefs', app.prefs);
const saveLook = async (patch) => {
  if (!app.profile) return;
  Object.assign(app.profile, patch);
  await saveProfile(app.auth, app.profile);
  app.applyUserTheme();
  app.renderPanel?.();
};

registerActions({
  'look-pref': (el) => {
    const { k, v } = el.dataset;
    if (!LOOK[k]) return;
    app.prefs[k] = v;
    savePrefs();
    applyLook();
    app.renderPanel?.();
  },
  'look-ambient': (el) => {
    app.prefs.ambient = el.dataset.v !== 'off';
    savePrefs();
    applyLook();
    app.renderPanel?.();
  },
  'set-accent': (el) => saveLook({ accent: el.dataset.v || null }),
  'set-font': (el) => saveLook({ font: el.dataset.font || null }),
  'look-reset': () => {
    for (const k of Object.keys(LOOK)) delete app.prefs[k];
    delete app.prefs.ambient;
    savePrefs();
    applyLook();
    saveLook({ theme: 'prisma', accent: null, mode: 'light', font: null });
  },
});

// el selector de color libre guarda al soltar (no en cada movimiento)
document.addEventListener('change', (e) => {
  const el = e.target.closest?.('[data-accent-pick]');
  if (el) saveLook({ accent: el.value });
});
