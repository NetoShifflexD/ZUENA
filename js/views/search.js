import { app, registerActions } from '../app.js';
import { searchEverything } from '../search.js';
import { esc } from '../ui/format.js';
import { icon } from '../ui/icons.js';
import { see } from './common.js';

export function searchMarkup(result) {
  if (result.error) return `<p role="status" class="us-empty">${esc(result.error)}</p>`;
  const groups = result.groups.map((g) => `<section class="us-group"><h3>${esc(g.label)}</h3>${g.items.map((r) => {
    if (r.track) see(r.track);
    const attrs = r.track ? `data-action="search-track" data-id="${esc(r.track.id)}" aria-label="Reproducir ${esc(r.title)}"`
      : `data-action="${r.action}" data-id="${esc(r.id)}"${r.view ? ` data-view="${r.view}"` : ''}`;
    return `<button type="button" class="us-result lit" ${attrs}><span class="us-result-icon">${icon(r.track ? 'music' : g.label === 'Publicaciones' ? 'feed' : g.label === 'Perfiles' ? 'user' : 'disc')}</span><span><b>${esc(r.title)}</b><small>${esc(r.sub || r.extra || '')}</small></span>${icon('arrowRight')}</button>`;
  }).join('')}</section>`).join('');
  return `${result.loading ? '<p class="muted" role="status">Completando resultados del catálogo…</p>' : ''}${result.partial ? '<p class="muted" role="status">Parte del catálogo no está disponible. Mostramos los resultados accesibles.</p>' : ''}${groups || (result.loading ? '' : '<p class="us-empty" role="status">No encontramos coincidencias. Probá con otro nombre.</p>')}`;
}

export function viewUnifiedSearch() {
  const query = app.ui.query, uid = app.user?.uid;
  app.ui.mount = (root) => {
    const box = root.querySelector('[data-search-page]');
    searchEverything(app, query).then((result) => {
      if (!box?.isConnected || app.ui.query !== query || app.user?.uid !== uid) return;
      box.innerHTML = searchMarkup(result);
      app.afterFill?.(box);
    }).catch(() => { if (box?.isConnected) box.textContent = 'No se pudo completar la búsqueda. Probá de nuevo.'; });
  };
  return `<header class="page-head"><h1>Buscar en ZUENA</h1><p>${esc(query)}</p></header><div data-search-page class="unified-search" aria-live="polite">Buscando…</div>`;
}
registerActions({ 'search-track': (el) => {
  const track = app.resolve(el.dataset.id);
  if (!track || !app.isAvailable(track)) { app.toast('Esta canción ya no está disponible.'); return; }
  app.playGroup([track], false);
}, 'search-release': (el) => {
  const r = app.releases.get(el.dataset.id);
  if (!r) { app.toast('Este lanzamiento ya no está disponible.'); return; }
  app.go('artistpage', `zu:${r.uid}`);
} });
