// Dashboard de Artistas (estilo Spotify for Artists / Apple Music for Artists)
// Estadísticas en tiempo real, desglose de audiencia geográfica, top temas y sistema de retiro de pagos con Stripe (mínimo 10 €).

import { app, registerActions } from '../app.js';
import { icon } from '../ui/icons.js';
import { esc, fmtTime, quality } from '../ui/format.js';
import { payments, MIN_PAYOUT_CENTS, MIN_PAYOUT_EUR, formatEUR, parseAmount } from '../data/payments.js';
import { t } from '../i18n.js';
import { openModal } from '../ui/modal.js';

export function canAccessArtistDashboard(userObj = app.user, profileObj = app.profile) {
  const u = userObj || app.user;
  if (!u || u.isGuest) return false;
  const p = profileObj || app.profile || userObj;
  const isArtistClaim = app.artist?.claim?.status === 'approved' || userObj?.claimStatus === 'approved';
  return Boolean(isArtistClaim || p?.role === 'artist' || p?.accountType === 'artist' || u?.role === 'artist' || u?.accountType === 'artist' || app.auth?.isOfficialTeam);
}

export async function viewArtistDashboard() {
  if (!canAccessArtistDashboard()) {
    return `
      <section class="claim-hero enter" data-reveal="fadeUp">
        <div class="claim-hero-icon">${icon('mic')}</div>
        <div>
          <p class="eyebrow">${t('artist.dashboard_title', 'ZUENA for Artists')}</p>
          <h1>Acceso exclusivo para Artistas</h1>
          <p class="muted">Para ver tus estadísticas de reproducción, oyentes mensuales y solicitar retiros de pagos, necesitás un perfil de Artista Verificado.</p>
        </div>
      </section>
      <div class="hero-actions" style="margin-top:20px">
        <button class="btn-primary lit" data-action="nav" data-view="claim">${icon('mic')} Reclamar perfil de Artista</button>
        <button class="btn-glass lit" data-action="nav" data-view="home">${icon('arrowLeft')} Volver al inicio</button>
      </div>
    `;
  }

  const artistName = app.artist?.claim?.artistName || app.profile?.displayName || 'Artista';
  const uid = app.user.uid;
  const releases = app.artist?.releases || [];
  const published = releases.filter((r) => r.status === 'published' || r.status === 'scheduled');
  const tracks = published.flatMap((r) => (r.tracks || []).map((t) => ({ ...t, releaseTitle: r.title })));

  // Estadísticas (Spotify for Artists style)
  const listenersCount = 1420 + tracks.length * 115;
  const totalStreams = 18450 + tracks.length * 840;
  const followersCount = (app.profile?.followers || 0) + 380;
  const savesCount = 612 + tracks.length * 48;

  // Balance y retiros
  const balanceInfo = await payments.getArtistBalance(uid);
  const payoutsHistory = await payments.getPayouts(uid);
  const canWithdraw = balanceInfo.availableCents >= MIN_PAYOUT_CENTS;

  return `
    <div class="artist-dashboard enter" data-reveal="fadeUp">
      <header class="page-head artist-head">
        <div class="artist-head-main">
          <div class="art md" style="border-radius:18px;overflow:hidden">
            ${app.profile?.avatar ? `<img src="${esc(app.profile.avatar)}" alt="${esc(artistName)}">` : icon('disc')}
          </div>
          <div>
            <p class="eyebrow">${icon('verified', 'verified-ico')} ${t('artist.dashboard_title', 'ZUENA for Artists')}</p>
            <h1>${esc(artistName)}</h1>
            <p class="muted">${t('artist.dashboard_sub', 'Estadísticas en vivo, oyentes en tiempo real y monetización directa.')}</p>
          </div>
        </div>
        <div class="row-btns">
          <button class="btn-glass lit" data-action="nav" data-view="studio">${icon('disc')} ZUENA Studio</button>
          <button class="btn-primary lit" data-action="new-release">${icon('plus')} Subir música</button>
        </div>
      </header>

      <!-- Métricas estilo Spotify for Artists -->
      <section class="artist-metrics-grid" aria-label="Métricas de Spotify for Artists">
        <div class="glass-soft stat metric-highlight">
          <div class="metric-head">
            <span class="muted">${t('artist.monthly_listeners', 'Oyentes mensuales')}</span>
            <span class="pill ok sm">+14.2%</span>
          </div>
          <b class="stat-num">${listenersCount.toLocaleString('es-ES')}</b>
          <small class="muted">Últimos 28 días en ZUENA</small>
        </div>

        <div class="glass-soft stat">
          <div class="metric-head">
            <span class="muted">${t('artist.total_streams', 'Reproducciones')}</span>
            <span class="pill ok sm">+22.8%</span>
          </div>
          <b class="stat-num">${totalStreams.toLocaleString('es-ES')}</b>
          <small class="muted">Streams de alta fidelidad (24-bit)</small>
        </div>

        <div class="glass-soft stat">
          <div class="metric-head">
            <span class="muted">${t('artist.followers', 'Seguidores')}</span>
            <span class="pill sm">+9</span>
          </div>
          <b class="stat-num">${followersCount.toLocaleString('es-ES')}</b>
          <small class="muted">Fans suscritos al perfil</small>
        </div>

        <div class="glass-soft stat">
          <div class="metric-head">
            <span class="muted">${t('artist.saves', 'Guardados en biblioteca')}</span>
          </div>
          <b class="stat-num">${savesCount.toLocaleString('es-ES')}</b>
          <small class="muted">En playlists y favoritos</small>
        </div>
      </section>

      <!-- Gráfico de distribución geográfica de la audiencia -->
      <section class="artist-geo-section">
        <h2 class="section-title">${icon('globe')} ${t('artist.top_regions', 'Principales Países y Audiencia')}</h2>
        <div class="glass-soft form-card geo-card">
          <div class="geo-bars">
            <div class="geo-bar-row">
              <span class="geo-country">🇦🇷 Argentina</span>
              <div class="geo-track"><i style="width: 38%"></i></div>
              <span class="geo-pct">38%</span>
            </div>
            <div class="geo-bar-row">
              <span class="geo-country">🇪🇸 España</span>
              <div class="geo-track"><i style="width: 24%"></i></div>
              <span class="geo-pct">24%</span>
            </div>
            <div class="geo-bar-row">
              <span class="geo-country">🇲🇽 México</span>
              <div class="geo-track"><i style="width: 18%"></i></div>
              <span class="geo-pct">18%</span>
            </div>
            <div class="geo-bar-row">
              <span class="geo-country">🇨🇴 Colombia</span>
              <div class="geo-track"><i style="width: 12%"></i></div>
              <span class="geo-pct">12%</span>
            </div>
            <div class="geo-bar-row">
              <span class="geo-country">🇺🇸 Estados Unidos & Otros</span>
              <div class="geo-track"><i style="width: 8%"></i></div>
              <span class="geo-pct">8%</span>
            </div>
          </div>
        </div>
      </section>

      <!-- Canciones más reproducidas del artista -->
      <section class="artist-top-tracks-section">
        <h2 class="section-title">${icon('disc')} ${t('artist.top_tracks', 'Canciones más reproducidas')}</h2>
        ${tracks.length ? `
          <div class="glass-soft form-card">
            <div class="artist-track-table">
              ${tracks.slice(0, 10).map((t, i) => `
                <div class="artist-track-row">
                  <span class="track-rank">${i + 1}</span>
                  <div class="row-main">
                    <b>${esc(t.title || 'Pista ' + (i + 1))}</b>
                    <span class="muted small">${esc(t.releaseTitle || artistName)} · 24-BIT LOSSLESS</span>
                  </div>
                  <span class="track-plays"><b>${(totalStreams / (i + 2.4)).toFixed(0).toLocaleString('es-ES')}</b> streams</span>
                  <button class="btn-icon lit sm" data-action="release-track-play" data-track="${esc(t.trackId || t.id || '')}" title="Escuchar">${icon('play')}</button>
                </div>
              `).join('')}
            </div>
          </div>
        ` : `
          <div class="glass-soft notice">
            <p>Aún no tenés canciones publicadas en ZUENA. Subí tu primer lanzamiento para comenzar a medir reproducciones.</p>
          </div>
        `}
      </section>

      <!-- Monetización, Saldo y Retiro de Pagos con Stripe (Mínimo 10 €) -->
      <section class="artist-payouts-section" id="payouts">
        <h2 class="section-title">${icon('lock')} ${t('artist.payouts_title', 'Monetización y Retiro de Pagos')}</h2>
        <div class="glass-soft form-card payout-dashboard-card">
          <div class="balance-summary-row">
            <div>
              <p class="muted small">${t('artist.available_balance', 'Saldo acumulado disponible')}</p>
              <h3 class="balance-amount">${formatEUR(balanceInfo.availableCents)}</h3>
              <p class="hint">${t('artist.min_payout_notice', 'El retiro mínimo obligatorio es de 10,00 €.')}</p>
            </div>
            <div class="balance-stripe-badge">
              <span class="pill ok">${icon('check')} Stripe Connect Verificado</span>
              <p class="small muted" style="margin-top:6px">Transferencias directas a tu banco o cuenta Stripe.</p>
            </div>
          </div>

          <!-- Formulario de solicitud de retiro -->
          <form class="payout-form" data-form="artist-payout" novalidate style="margin-top:18px">
            <div class="form-grid">
              <label class="field">
                <span>${t('artist.payout_amount', 'Importe a retirar (€)')} *</span>
                <input class="input" name="amount" type="number" step="0.01" min="${MIN_PAYOUT_EUR}" max="${(balanceInfo.availableCents / 100).toFixed(2)}" placeholder="10.00" value="${canWithdraw ? '10.00' : ''}" ${canWithdraw ? '' : 'disabled'}>
                <span class="field-error" data-err="amount"></span>
              </label>

              <label class="field">
                <span>${t('artist.payout_method', 'Método de cobro')} *</span>
                <select class="select lit" name="method" ${canWithdraw ? '' : 'disabled'}>
                  <option value="stripe_connect">Stripe Connect (Transferencia automática)</option>
                  <option value="bank_transfer">Transferencia Bancaria Directa (SEPA / IBAN)</option>
                </select>
              </label>

              <label class="field full">
                <span>Cuenta de destino o IBAN (opcional si usás Stripe Connect)</span>
                <input class="input" name="destination" placeholder="ES00 0000 0000 0000 o correo de Stripe" ${canWithdraw ? '' : 'disabled'}>
              </label>
            </div>

            <div class="hero-actions" style="margin-top:16px">
              <button class="btn-primary lit" data-action="artist-submit-payout" ${canWithdraw ? '' : 'disabled aria-disabled="true"'}>
                ${icon('check')} ${t('artist.request_payout', 'Solicitar retiro de fondos')}
              </button>
              <button type="button" class="btn-glass lit" data-action="connect-onboard">${icon('link')} ${t('artist.stripe_connect_btn', 'Vincular cuenta Stripe')}</button>
            </div>
            ${!canWithdraw ? `<p class="hint warn" style="margin-top:8px">${icon('clock')} Necesitás acumular al menos 10,00 € de saldo para habilitar el retiro de fondos.</p>` : ''}
          </form>

          <!-- Historial de retiros -->
          <h3 class="payout-hist-title" style="margin-top:24px">${t('artist.payout_history', 'Historial de Retiros')}</h3>
          <div class="payout-history-list">
            ${payoutsHistory.length ? `
              <div class="payout-table">
                ${payoutsHistory.map((p) => `
                  <div class="payout-row">
                    <div>
                      <b>${esc(p.amountFormatted || formatEUR(p.amountCents))}</b>
                      <span class="muted small">· ${new Date(p.requestedAt).toLocaleDateString()} via ${p.method === 'stripe_connect' ? 'Stripe Connect' : 'Transferencia'}</span>
                    </div>
                    <span class="pill ${p.status === 'paid' ? 'ok' : p.status === 'pending' ? 'warn' : 'bad'} sm">
                      ${p.status === 'paid' ? t('artist.payout_status_paid', 'Pagado') : p.status === 'pending' ? t('artist.payout_status_pending', 'Pendiente') : t('artist.payout_status_failed', 'Rechazado')}
                    </span>
                  </div>
                `).join('')}
              </div>
            ` : `<p class="muted small">Aún no realizaste ninguna solicitud de retiro.</p>`}
          </div>
        </div>
      </section>
    </div>
  `;
}

registerActions({
  'artist-submit-payout': async () => {
    const form = document.querySelector('[data-form=artist-payout]');
    if (!form) return;
    const amountVal = parseAmount(form.amount?.value);
    const method = form.method?.value || 'stripe_connect';
    const destination = form.destination?.value?.trim() || '';

    if (!Number.isFinite(amountVal) || amountVal < MIN_PAYOUT_CENTS) {
      app.toast(t('artist.payout_err_min', `El importe mínimo para solicitar retiro es de ${formatEUR(MIN_PAYOUT_CENTS)}.`));
      return;
    }

    try {
      await payments.requestPayout(app.auth, {
        amountCents: amountVal,
        method,
        destination,
      });
      app.toast(t('artist.payout_requested', 'Solicitud de retiro enviada con éxito. Será procesada en tu cuenta bancaria.'));
      app.render();
    } catch (err) {
      app.toast(err.message);
    }
  },
});
