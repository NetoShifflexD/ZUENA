// Ranking editorial externo: posiciones originales de Apple, sin inferir ubicación.
import { app } from '../app.js';
import { REGIONS } from '../catalog/genres.js';
import { getJSON } from '../catalog/sources.js';
import { esc } from '../ui/format.js';

const requests = new Map();
const mounts = new WeakMap();
const regionOf = () => REGIONS.some((r) => r.id === app.taste?.data.region) ? app.taste.data.region : '';

export function regionalTopHtml() {
  const region = regionOf();
  return `<section class="fx-card glass-soft regional-top" data-regional-top aria-label="Top regional de Apple Music">
    <header><p class="regional-kicker">Apple Music · Más reproducidas</p><h2>Top regional</h2></header>
    <label class="regional-region"><span>Elegir región</span><select class="select lit" data-regional-region><option value="" ${region ? '' : 'selected'} disabled>Elegir región</option>${REGIONS.map((r) => `<option value="${r.id}" ${r.id === region ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select></label>
    <div data-regional-results aria-live="polite" aria-busy="true"><p class="regional-status" role="status">Cargando ranking…</p></div>
    <p class="regional-source">Fuente: Apple Music. Ranking del país elegido; no representa escuchas en ZUENA.</p>
  </section>`;
}

// El mismo placeholder sirve en el feed o en la isla; montar tras insertar.
export const renderRegionalTop = regionalTopHtml;

// Una promesa por país, compartida entre montajes y eventos del feed; reintento explícito.
function chart(region) {
  if (!requests.has(region)) {
    let timer;
    const fetchChart = getJSON(`https://rss.applemarketingtools.com/api/v2/${region}/music/most-played/10/songs.json`, { proxy: true, ttl: 6 * 3600e3 });
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Fuente sin respuesta')), 12000); });
    requests.set(region, Promise.race([fetchChart, deadline]).finally(() => clearTimeout(timer)).then((data) => {
      const rows = data?.feed?.results;
      if (!Array.isArray(rows) || rows.length < 5 || rows.slice(0, 5).some((r) => !r.name || !r.artistName)) throw new Error('Ranking incompleto');
      const updated = Date.parse(data.feed.updated);
      return { rows: rows.slice(0, 5), updated: Number.isFinite(updated) ? updated : null, consulted: Date.now() };
    }));
  }
  return requests.get(region);
}

function appleLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'music.apple.com' ? url.href : '';
  } catch { return ''; }
}

function rowsHtml(rows) {
  return `<ol class="regional-list">${rows.map((r, i) => {
    const url = appleLink(r.url);
    const body = `<span class="regional-rank" aria-hidden="true">${i + 1}</span>${r.artworkUrl100 && /^https:\/\//.test(r.artworkUrl100) ? `<img src="${esc(r.artworkUrl100)}" alt="" loading="lazy" decoding="async">` : ''}<span class="regional-song"><b>${esc(r.name)}</b><span>${esc(r.artistName)}</span></span>`;
    return `<li>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" aria-label="${i + 1}. ${esc(r.name)} — ${esc(r.artistName)}. Abrir en Apple Music, nueva pestaña">${body}</a>` : `<div class="regional-row">${body}</div>`}</li>`;
  }).join('')}</ol>`;
}

async function load(panel, st, region) {
  const token = ++st.token;
  st.region = region;
  st.uid = app.user?.uid;
  const uid = st.uid;
  const box = panel.querySelector('[data-regional-results]');
  if (!region) {
    box.setAttribute('aria-busy', 'false');
    box.innerHTML = '<p class="regional-status" role="status">Elegí una región para ver su top.</p>';
    return;
  }
  box.setAttribute('aria-busy', 'true');
  box.innerHTML = '<p class="regional-status" role="status">Cargando ranking…</p>';
  const current = () => panel.isConnected && mounts.get(panel) === st && token === st.token && regionOf() === region && app.user?.uid === uid;
  try {
    const { rows, updated, consulted } = await chart(region);
    if (!current()) return;
    const date = new Date(updated ?? consulted);
    box.innerHTML = rowsHtml(rows) + `<p class="regional-date">${updated == null ? 'Consultado en la app' : 'Fecha de Apple'}: <time datetime="${date.toISOString()}">${esc(date.toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' }))}</time>. Métrica: canciones más reproducidas. Período: ranking actual de la fuente; Apple no informa el intervalo.</p>`;
  } catch {
    if (!current()) return;
    box.innerHTML = '<p class="regional-status" role="status">Todavía no hay un top disponible para esta región.</p><p class="regional-status">No pudimos obtener cinco posiciones de Apple Music. Cambiá de región o probá de nuevo.</p><button type="button" class="btn-glass lit" data-regional-retry>Reintentar</button>';
  } finally {
    if (current()) box.setAttribute('aria-busy', 'false');
  }
}

// Llamar después de insertar la vista y desde feedLive. No hace consultas en render.
export function mountRegionalTop(root) {
  for (const panel of root.querySelectorAll('[data-regional-top]')) {
    let st = mounts.get(panel);
    if (!st) {
      st = { token: 0, region: null };
      mounts.set(panel, st);
      panel.addEventListener('change', (e) => {
        if (!e.target.matches('[data-regional-region]')) return;
        const region = e.target.value;
        if (!REGIONS.some((r) => r.id === region) || region === regionOf()) return;
        app.taste.data.region = region;
        // Invalidar antes del evento sincrónico de Taste.save().
        load(panel, st, region);
        app.taste.save();
      });
      panel.addEventListener('click', (e) => {
        if (!e.target.closest('[data-regional-retry]')) return;
        requests.delete(regionOf());
        load(panel, st, regionOf());
      });
    }
    const region = regionOf();
    panel.querySelector('[data-regional-region]').value = region;
    if (st.region !== region || st.uid !== app.user?.uid) load(panel, st, region);
  }
}
