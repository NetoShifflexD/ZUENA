// Puerta de entrada de los apartados legales (2026-11-02). Se carga desde index.html, aparte de main.js:
// cualquier botón con data-legal="id" abre ese documento, data-cookie-settings abre la configuración
// de almacenamiento, y la primera visita muestra el aviso de cookies.
import { showCookieBanner, getCookieChoice, openCookieSettings } from './cookies.js';

export { getCookieChoice };

document.addEventListener('click', async (e) => {
  const t = e.target.closest?.('[data-legal], [data-cookie-settings]');
  if (!t || t.closest('.lg-root')) return;
  e.preventDefault();
  if (t.hasAttribute('data-cookie-settings')) { openCookieSettings(); return; }
  const { openLegal } = await import('./view.js');
  openLegal(t.dataset.legal);
});

const start = () => showCookieBanner();
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
