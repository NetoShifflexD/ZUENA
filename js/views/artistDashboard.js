// Panel de artistas: datos reales del catálogo propio y cobros sólo a través del servidor de pagos.
// Reglas duras (CLAUDE.md): nunca se inventan métricas, saldos ni retiros; sin servidor no se muestran cifras de dinero.
// Los retiros los hace Stripe Connect directo a la cuenta del artista: la app no pide IBAN ni registra retiros propios.

import { app } from '../app.js';
import { icon } from '../ui/icons.js';
import { esc } from '../ui/format.js';
import { payments } from '../data/payments.js';
import { t } from '../i18n.js';

export function canAccessArtistDashboard(userObj = app.user, profileObj = app.profile) {
  const u = userObj || app.user;
  if (!u || u.isGuest) return false;
  const p = profileObj || app.profile || userObj;
  const isArtistClaim = app.artist?.claim?.status === 'approved' || userObj?.claimStatus === 'approved';
  return Boolean(isArtistClaim || p?.role === 'artist' || p?.accountType === 'artist' || u?.role === 'artist' || u?.accountType === 'artist' || app.auth?.isOfficialTeam);
}

// métricas reales que la app conoce hoy (catálogo propio y seguidores); el resto no se estima
export function dashboardStats(releases = [], profile = {}) {
  const published = releases.filter((r) => r.status === 'published' || r.status === 'scheduled');
  const tracks = published.flatMap((r) => (r.tracks || []).map((tr) => ({ ...tr, releaseTitle: r.title })));
  return {
    releases: published.length,
    tracks,
    followers: Number.isFinite(profile?.followers) ? profile.followers : 0,
  };
}

const stat = (label, value, note) => `
  <div class="glass-soft stat">
    <div class="metric-head"><span class="muted">${label}</span></div>
    <b class="stat-num">${value}</b>
    <small class="muted">${note}</small>
  </div>`;

function moneySection() {
  if (!payments.configured) {
    return `<p class="hint">Los cobros no están disponibles en esta instalación. Cuando se conecte el servidor de pagos vas a poder vincular tu cuenta de Stripe y ver tus ingresos reales.</p>`;
  }
  return `<p>Stripe Connect transfiere tus ingresos directo a tu cuenta bancaria. ZUENA no guarda datos bancarios.</p>
    <div class="hero-actions" style="margin-top:16px">
      <button type="button" class="btn-primary lit" data-action="connect-onboard">${icon('link')} ${t('artist.stripe_connect_btn', 'Vincular cuenta Stripe')}</button>
      <button type="button" class="btn-glass lit" data-action="connect-earnings">${icon('check')} Ver ingresos</button>
    </div>`;
}

export async function viewArtistDashboard() {
  if (!canAccessArtistDashboard()) {
    return `
      <section class="claim-hero enter" data-reveal="fadeUp">
        <div class="claim-hero-icon">${icon('mic')}</div>
        <div>
          <p class="eyebrow">${t('artist.dashboard_title', 'ZUENA for Artists')}</p>
          <h1>Acceso exclusivo para Artistas</h1>
          <p class="muted">Para ver tu catálogo, tus seguidores y tus cobros necesitás un perfil de Artista Verificado.</p>
        </div>
      </section>
      <div class="hero-actions" style="margin-top:20px">
        <button class="btn-primary lit" data-action="nav" data-view="claim">${icon('mic')} Reclamar perfil de Artista</button>
        <button class="btn-glass lit" data-action="nav" data-view="home">${icon('arrowLeft')} Volver al inicio</button>
      </div>
    `;
  }

  const artistName = app.artist?.claim?.artistName || app.profile?.displayName || 'Artista';
  const { releases, tracks, followers } = dashboardStats(app.artist?.releases || [], app.profile);

  return `
    <div class="artist-dashboard enter" data-reveal="fadeUp">
      <header class="page-head artist-head">
        <div class="artist-head-main">
          <div class="art md dashboard-avatar">
            ${app.profile?.avatar ? `<img src="${esc(app.profile.avatar)}" alt="${esc(artistName)}">` : icon('disc')}
          </div>
          <div>
            <p class="eyebrow">${icon('verified', 'verified-ico')} ${t('artist.dashboard_title', 'ZUENA for Artists')}</p>
            <h1>${esc(artistName)}</h1>
            <p class="muted">Tu catálogo, tus seguidores y tus cobros.</p>
          </div>
        </div>
        <div class="row-btns">
          <button class="btn-glass lit" data-action="nav" data-view="studio">${icon('disc')} ZUENA Studio</button>
          <button class="btn-primary lit" data-action="new-release">${icon('plus')} Subir música</button>
        </div>
      </header>

      <section class="artist-metrics-grid" aria-label="Resumen del artista">
        ${stat('Lanzamientos', releases.toLocaleString('es-ES'), 'Publicados o programados')}
        ${stat('Canciones', tracks.length.toLocaleString('es-ES'), 'En tus lanzamientos')}
        ${stat(t('artist.followers', 'Seguidores'), followers.toLocaleString('es-ES'), 'Personas que siguen tu perfil')}
      </section>
      <p class="hint">Las reproducciones y la audiencia por país aparecen cuando ZUENA tenga datos reales de escucha. No se muestran estimaciones.</p>

      <section class="artist-top-tracks-section">
        <h2 class="section-title">${icon('disc')} Tus canciones</h2>
        ${tracks.length ? `
          <div class="glass-soft form-card">
            <div class="artist-track-table">
              ${tracks.slice(0, 10).map((tr, i) => `
                <div class="artist-track-row">
                  <span class="track-rank">${i + 1}</span>
                  <div class="row-main">
                    <b>${esc(tr.title || 'Pista ' + (i + 1))}</b>
                    <span class="muted small">${esc(tr.releaseTitle || artistName)}</span>
                  </div>
                  <button class="btn-icon lit" data-action="release-track-play" data-track="${esc(tr.trackId || tr.id || '')}" title="Escuchar" aria-label="Escuchar">${icon('play')}</button>
                </div>
              `).join('')}
            </div>
          </div>
        ` : `
          <div class="glass-soft notice">
            <p>Aún no tenés canciones publicadas en ZUENA. Subí tu primer lanzamiento.</p>
          </div>
        `}
      </section>

      <section class="artist-payouts-section" id="payouts">
        <h2 class="section-title">${icon('lock')} Cobros</h2>
        <div class="glass-soft form-card payout-dashboard-card">${moneySection()}</div>
      </section>
    </div>
  `;
}

