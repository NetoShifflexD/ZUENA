// Aviso de cookies y almacenamiento (2026-11-02). Hoy ZUENA sólo guarda lo necesario para funcionar
// (sesión, preferencias, biblioteca) y pide tipografías a Google Fonts; no hay publicidad ni analítica.
// Por eso "Sólo necesarias" y "Aceptar todo" funcionan igual: la elección queda guardada para cuando existan
// categorías opcionales, y el texto lo dice sin rodeos.
import { icon } from '../ui/icons.js';
import { motion } from '../motion/index.js';

export const COOKIE_KEY = 'zuena:cookies';
export const COOKIE_POLICY_VERSION = '2026-11-02-borrador';
export const COOKIE_CHOICES = ['necessary', 'all'];

// categorías reales; `optional: false` = no se puede apagar desde ZUENA
export const STORAGE_GROUPS = [
  { id: 'necessary', name: 'Necesario', optional: false,
    text: 'Sesión, cuenta local, preferencias, tu biblioteca y la caché de la app, guardados en este navegador (IndexedDB, localStorage y sessionStorage). Sin esto ZUENA no puede funcionar.' },
  { id: 'fonts', name: 'Tipografías de Google Fonts', optional: false,
    text: 'Para mostrar las fuentes, tu navegador las descarga de servidores de Google, que reciben tu dirección IP. ZUENA no pone cookies con esto. Si las bloqueás en tu navegador, se usa una fuente del sistema.' },
  { id: 'account', name: 'Cuenta en la nube e inicio con Google', optional: false,
    text: 'Sólo si iniciás sesión con Google o en la nube: el proveedor de identidad puede guardar sus propios datos de sesión. Si no lo usás, no se carga.' },
  { id: 'analytics', name: 'Analítica y publicidad', optional: true, none: true,
    text: 'ZUENA no usa cookies de analítica ni de publicidad. Si algún día las usa, te lo vamos a preguntar antes.' },
];

export function parseCookieChoice(raw) {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!v || !COOKIE_CHOICES.includes(v.choice)) return null;
    return { choice: v.choice, version: v.version || '', at: v.at || '' };
  } catch { return null; }
}

// elección guardada: { choice: 'necessary' | 'all', version, at } o null si todavía no eligió
export function getCookieChoice() {
  try { return parseCookieChoice(localStorage.getItem(COOKIE_KEY)); } catch { return null; }
}

export function setCookieChoice(choice, now = Date.now()) {
  if (!COOKIE_CHOICES.includes(choice)) throw new Error('Elección de cookies desconocida');
  const rec = { choice, version: COOKIE_POLICY_VERSION, at: new Date(now).toISOString() };
  try { localStorage.setItem(COOKIE_KEY, JSON.stringify(rec)); } catch {}
  document.dispatchEvent(new CustomEvent('zuena-cookie-choice', { detail: rec }));
  return rec;
}

export const cookieChoiceLabel = (c = getCookieChoice()) => (!c ? 'Sin elegir' : c.choice === 'all' ? 'Aceptaste todo' : 'Sólo necesarias');

// ---------- banner de primera vez ----------
let banner = null;

export function showCookieBanner({ force = false } = {}) {
  if (banner?.isConnected) return banner;
  if (!force && getCookieChoice()) return null;
  banner = document.createElement('section');
  banner.className = 'cookie-banner glass';
  banner.setAttribute('role', 'region');
  banner.setAttribute('aria-label', 'Aviso de cookies y almacenamiento');
  banner.innerHTML = `
    <span class="cookie-ico" aria-hidden="true">${icon('lock')}</span>
    <div class="cookie-text">
      <h2>Cookies y almacenamiento</h2>
      <p>ZUENA guarda en tu navegador sólo lo necesario para funcionar (sesión, preferencias y tu biblioteca) y descarga tipografías de Google Fonts. No usamos publicidad ni analítica.
        <button type="button" class="link-inline" data-legal="cookies">Política de cookies</button></p>
    </div>
    <div class="cookie-actions">
      <button type="button" class="btn-glass lit" data-cookie="settings">Configurar</button>
      <button type="button" class="btn-glass lit" data-cookie="necessary">Sólo necesarias</button>
      <button type="button" class="btn-primary lit" data-cookie="all">Aceptar todo</button>
    </div>`;
  banner.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cookie]');
    if (!b) return;
    if (b.dataset.cookie === 'settings') { openCookieSettings(); return; }
    setCookieChoice(b.dataset.cookie);
    hideCookieBanner();
  });
  document.body.append(banner);
  motion.play('fadeUp', banner, { delay: 400 });
  return banner;
}

export async function hideCookieBanner() {
  const b = banner;
  banner = null;
  if (!b?.isConnected) return;
  await motion.play('exitDown', b);
  b.remove();
}

// ---------- configuración: qué se guarda, con la verdad de que hoy no hay opcionales ----------
export async function openCookieSettings() {
  const { openLegal } = await import('./view.js');
  openLegal('cookies', { settings: true });
}

// bloque de configuración que dibuja la vista legal (dentro del documento de cookies)
export function cookieSettingsHtml() {
  const c = getCookieChoice();
  return `<div class="lg-cookie-cfg" data-cookie-cfg>
      <h3>Tu elección</h3>
      <ul class="lg-groups">${STORAGE_GROUPS.map((g) => `<li class="lg-group">
        <div><b>${g.name}</b><p>${g.text}</p></div>
        <span class="lg-pill ${g.none ? 'off' : ''}">${g.none ? 'No se usa' : 'Siempre activo'}</span></li>`).join('')}</ul>
      <p class="lg-muted">Hoy no hay categorías opcionales: las dos opciones funcionan igual. Guardamos tu elección para preguntarte de nuevo si eso cambia.</p>
      <div class="lg-cfg-actions">
        <button type="button" class="btn-glass lit" data-cookie-set="necessary" aria-pressed="${c?.choice === 'necessary'}">Sólo necesarias</button>
        <button type="button" class="btn-primary lit" data-cookie-set="all" aria-pressed="${c?.choice === 'all'}">Aceptar todo</button>
      </div>
      <p class="lg-muted" data-cookie-state role="status">Estado: ${cookieChoiceLabel(c)}.</p>
    </div>`;
}
