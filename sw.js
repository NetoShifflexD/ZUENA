// Service worker de ZUENA: la app abre sin conexión.
// Archivos propios: red primero (siempre la versión nueva) y caché como respaldo.
// Contenido externo (streams, carátulas, APIs) no se intercepta: lo maneja el navegador.
// Precarga (2026-11-03): además del armazón fijo, al instalarse recorre index.html y el grafo de módulos
// (import, import(), new URL(...), rutas a vendor/json) para guardar la lista real de archivos sin mantenerla a mano.
const CACHE = 'zuena-shell-v4-032';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './brand/logo.svg', './brand/logo-invertido.svg', './brand/cover-zuena.svg'];
// rutas relativas o absolutas a archivos propios dentro del código (las plantillas con ${} quedan afuera)
const REF = /["'`]((?:\.{1,2}\/|\/(?:js|css)\/)[^"'`$\s]+\.(?:js|css|json))["'`]/g;
const SKIP = /\/js\/tests\//;

async function precacheGraph(cache) {
  const seen = new Set();
  const queue = [];
  const add = (path, base) => {
    const url = new URL(path, base);
    if (url.origin !== location.origin || SKIP.test(url.pathname) || seen.has(url.pathname)) return;
    seen.add(url.pathname);
    queue.push(url.href);
  };
  const html = await (await fetch('./index.html', { cache: 'no-cache' })).text();
  for (const m of html.matchAll(/(?:href|src)="((?:css|js)\/[^"?#]+)"/g)) add(m[1], location.href);
  while (queue.length) {
    const batch = queue.splice(0, 8);
    await Promise.all(batch.map(async (href) => {
      const res = await fetch(href, { cache: 'no-cache' }).catch(() => null);
      if (!res?.ok) return;
      await cache.put(href, res.clone());
      if (href.endsWith('.js') && !href.includes('/vendor/')) for (const m of (await res.text()).matchAll(REF)) add(m[1], href);
    }));
  }
  return seen.size;
}

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(SHELL).then(() => precacheGraph(c).catch((err) => console.warn('[sw] precarga parcial', err))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // audio local con Range: el navegador lo pide por partes, no se cachea
  if (req.headers.has('range')) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); }
      return res;
    } catch {
      const hit = await caches.match(req, { ignoreSearch: url.pathname.endsWith('.html') || url.pathname === '/' });
      if (hit) return hit;
      if (req.mode === 'navigate') return (await caches.match('./index.html')) || Response.error();
      return Response.error();
    }
  })());
});
