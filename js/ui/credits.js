import { isLive } from '../data/releases.js';
import { testArtistById } from '../data/testArtists.js';
import { esc } from './format.js';

const clean = (value) => String(value ?? '').trim();
const separator = /(\s*,\s*|\s+(?:&|feat\.?|ft\.?|x|y|con)\s+)/i;
const button = (name, id) => `<button type="button" class="artist-link" data-action="np-artist" data-id="${esc(id)}" aria-label="Ver perfil de ${esc(name)}">${esc(name)}</button>`;

// El nombre mostrado puede ser compartido por varias personas. Sólo el titular identificado tiene enlace.
function performer(name, id, ownerName) {
  if (!id || !name) return esc(name);
  const owner = clean(ownerName);
  if (owner && name.toLowerCase() === owner.toLowerCase()) return button(name, id);
  const parts = name.split(separator);
  if (!owner && parts.length === 1) return button(name, id);
  return parts.map((part, i) => !(i % 2) && owner && part.trim().toLowerCase() === owner.toLowerCase()
    ? button(part, id) : esc(part)).join('');
}

export function trackCredits(track, releases, available) {
  if (!track || !available(track)) return { message: track ? 'Esta pista ya no está disponible.' : 'Elegí algo para escuchar.' };
  let release;
  if (track.releaseId) release = releases.get(track.releaseId);
  else if (track.kind !== 'remote' && track.origin !== 'local') {
    const matches = releases.all.filter((r) => r.tracks?.some((rt) => rt.trackId === track.id));
    if (matches.length === 1) release = matches[0];
  }
  const entry = release?.tracks?.find((rt) => rt.trackId === track.id);
  if ((track.releaseId || track.origin === 'release' || release) && (!entry || !isLive(release))) {
    return { message: 'Esta pista ya no está disponible.' };
  }
  const radio = track.live || track.type === 'radio';
  const program = ['episode', 'podcast'].includes(track.type);
  const name = clean(radio || track.type === 'podcast' ? track.title : release?.primaryArtist || track.artist);
  let id, owner;
  if (entry && release.uid) {
    id = 'zu:' + release.uid;
    owner = release.verifiedName;
  } else if (!radio && !program && track.artistId) {
    if (track.source === 'apple') { id = 'am:' + track.artistId; owner = testArtistById(track.artistId)?.name; }
    if (track.source === 'audius') { id = 'au:' + track.artistId; owner = name; }
  }
  const artist = performer(name, id, owner);
  const rows = [
    ['Composición', entry?.composers || track.composers],
    ['Producción', entry?.producers || track.producers],
    ['Artista del álbum', !release && clean(track.albumArtist) !== name ? track.albumArtist : ''],
    ['Participaciones del lanzamiento', release?.featuring],
    ['Sello', release?.label], ['Derechos ℗', release?.copyright],
  ].map(([label, value]) => [label, clean(value)]).filter(([, value]) => value);
  const linked = artist.includes('<button');
  return { artist, artistId: linked ? id : null, byline: release?.featuring ? artist + ' feat. ' + esc(release.featuring) : artist,
    role: radio ? 'Emisora' : program ? 'Programa' : 'Artista', rows,
    missingProfile: !!name && !linked && !radio && !program };
}

export function creditsPane(track, credits) {
  if (credits.message) return `<p class="hint">${credits.message}</p>`;
  const row = (label, html) => `<div><dt>${label}</dt><dd>${html}</dd></div>`;
  return `<section class="np-credits" aria-label="Créditos de ${esc(track.title)}" tabindex="0"><dl>
    ${credits.artist ? row(credits.role, credits.artist) : ''}
    ${credits.rows.map(([label, value]) => row(label, esc(value))).join('')}</dl>
    ${!credits.rows.length ? `<p class="hint">${credits.artist ? 'No hay créditos adicionales disponibles.' : 'No hay créditos disponibles para esta pista.'}</p>` : ''}
    ${credits.missingProfile ? '<p class="hint">Perfil de artista no disponible.</p>' : ''}
  </section>`;
}
