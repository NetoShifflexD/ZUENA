// "Reclamar perfil de Artista", estudio de lanzamientos (estilo distribuidora, gratis) y revisión.
import { app, registerActions } from '../app.js';
import { icon } from '../ui/icons.js';
import { esc, fmtTime, fmtRate, quality } from '../ui/format.js';
import { confirmModal, promptModal, openModal } from '../ui/modal.js';
import {
  PLATFORMS, GENRES, CLAIM_STATUS, RELEASE_STATUS, newClaim, validateRelease,
  qcErrors, qcWarnings, checkCover, typeLabel,
  claimStatus, claimTarget, buildEvidence, evidenceOf, evidenceOk, catalogLinkOk, canResubmit, inferAccountType,
  abuseSignals, isFreeEmail, noteError, STRONG_EVIDENCE,
} from '../data/artist.js';
import { saveProfile, syncAccount } from '../data/profiles.js';
import { TIER_BENEFITS, REF_CENTS, TIER_NAME_MAX, priceRule, referencePrice, canDeleteTier } from '../data/subs.js';
import { parseAmount, formatEUR } from '../data/payments.js';
import { TEST_CATALOG } from '../config.js';
import { TEST_ARTISTS, testArtistById } from '../data/testArtists.js';
import { statusOnApprove, premiereLabel, premiereError, isUpcoming, RESCHEDULE_LOCK_MS } from '../data/releases.js';
import { payments } from '../data/payments.js';
import { backBtn, statusPill, fieldError } from './common.js';

// estados en los que el contenido ya no se edita (sólo la salida, si es un estreno programado)
const LOCKED = new Set(['review', 'scheduled', 'published', 'hidden', 'withdrawn']);
const localNote = () => (app.auth.mode === 'local' ? ' en este equipo' : '');
// "2026-11-14T20:00" en la zona del equipo ↔ instante UTC
const toLocalInput = (ms) => (ms ? new Date(ms - new Date(ms).getTimezoneOffset() * 60e3).toISOString().slice(0, 16) : '');
const fromLocalInput = (v) => (v ? new Date(v).getTime() : NaN);
const releaseWhen = (r) => (r.status === 'scheduled' ? `Estreno ${premiereLabel(r.premiereAt)}` : r.published ? new Date(r.published).toLocaleDateString('es') : r.releaseMode === 'scheduled' && r.premiereAt ? `Estreno ${premiereLabel(r.premiereAt)}` : 'Al aprobarse');

// guardar y avisar al catálogo (y a otras pestañas)
async function saveRel(r) {
  await app.artist.saveRelease(r);
  await app.releases.load();
  app.releases.broadcast();
  return r;
}

let claimErrors = {};
let releaseErrors = {};

// ---------- reclamo (Requisitos/Perfiles con rol y reclamo de artista §4–§10) ----------

const NO_SERVER_NOTE = 'Este equipo no tiene servidor de verificación: tu verificación vale sólo acá.';
const fecha = (ms) => new Date(ms).toLocaleDateString('es');
const catalogNames = () => (TEST_CATALOG ? TEST_ARTISTS.map((x) => x.name) : []);
const catalogExists = (key) => /^am:\d+$/.test(key) && !!testArtistById(key.slice(3));
const EDITABLE = new Set(['draft', 'needs_info', 'withdrawn', 'rejected']);

// reclamo con el que trabaja la vista; un destino del catálogo pedido desde un perfil am: se aplica a un borrador vacío
function workingClaim() {
  const a = app.artist;
  const c = a.claim ? { ...a.claim } : newClaim(app.user, app.profile);
  const want = app.ui.claimTarget;
  if (want && EDITABLE.has(c.status) && (!c.artistName || claimTarget(c).key === want.key || !a.claim)) {
    c.target = { ...want };
    c.artistName = want.name;
  }
  return c;
}

export function viewClaim() {
  const a = app.artist;
  const p = app.profile;
  // un Oyente no reclama: primero cambia a Artista (§9 "Sin permiso")
  if (!a.verified && inferAccountType(p, a.claim) !== 'artist') {
    return `<section class="claim-hero" data-reveal="fadeUp"><div class="claim-hero-icon">${icon('mic')}</div>
      <div><p class="eyebrow">ZUENA para artistas</p><h1>Reclamar perfil de Artista</h1>
      <p class="muted">Para reclamar un perfil, cambiá tu cuenta a Artista.</p></div></section>
      <div class="hero-actions"><button class="btn-primary lit" data-action="account-type" data-type="artist" data-press>Cambiar a Artista</button></div>`;
  }
  const c = workingClaim();
  const t = claimTarget(c);
  const st = claimStatus(c.status);
  const e = claimErrors;
  const wanted = app.ui.claimTarget;
  const busyOther = wanted && a.claim && claimTarget(a.claim).key !== wanted.key && !EDITABLE.has(a.claim.status) && a.claim.status !== 'expired';
  const steps = [['Datos', !!c.artistName && !!c.legalName], ['Enlaces', Object.values(c.links || {}).some(Boolean)], ['Verificación', !!c.codeWhere], ['Revisión', !['draft', 'withdrawn'].includes(c.status)]];
  const title = t.kind === 'catalog' ? `Reclamo del perfil de ${esc(t.name)}` : 'Reclamar perfil de Artista';
  const adv = app.prefs.advanced ? `<p class="hint">Destino: <code>${esc(t.key)}</code></p>` : '';
  const local = a.hasServer ? '' : `<p class="hint claim-local">${icon('lock')}${NO_SERVER_NOTE}</p>`;

  const intro = `<section class="claim-hero" data-reveal="fadeUp">
      <div class="claim-hero-icon">${icon('mic')}</div>
      <div><p class="eyebrow">ZUENA para artistas</p><h1>${title}</h1>
      <p class="muted">Subí tu música gratis, con perfil verificado. Para proteger a los artistas reales, revisamos cada solicitud a mano: necesitamos tus datos, enlaces a tus perfiles en otras plataformas y el código publicado en una de tus redes.</p></div>
      ${statusPill(st)}
    </section>
    <ol class="steps" data-reveal="fadeUp">${steps.map(([l, done], i) => `<li class="${done ? 'done' : ''}"><span>${done ? icon('check') : i + 1}</span>${l}</li>`).join('')}</ol>${local}${adv}`;

  if (busyOther) {
    return `${intro}<div class="glass-soft notice warn">${icon('clock')}<p>Ya tenés una solicitud de verificación. Para reclamar otro artista, primero retirá la actual.</p>
      <button class="btn-glass lit" data-action="claim-clear-target" data-press>Ver mi solicitud</button></div>`;
  }
  if (c.status === 'approved') {
    const msg = c.verification === 'full' ? 'Perfil verificado. Ya podés subir lanzamientos desde tu estudio.' : 'Verificado en este equipo. Esta verificación no se comprueba con un servidor y sólo vale acá.';
    return `${intro}<div class="glass-soft notice ok">${icon('verified', 'verified-ico')}<p>${msg}</p>
      <button class="btn-primary lit" data-action="nav" data-view="studio" data-press>${icon('disc')}Ir al estudio</button></div>`;
  }
  if (c.status === 'pending') {
    return `${intro}<div class="glass-soft notice warn">${icon('clock')}<p>Tu solicitud está en revisión. Mantené el código publicado hasta que te confirmemos.</p></div>
      ${claimSummary(c)}
      <div class="hero-actions"><button class="btn-glass lit" data-action="claim-withdraw" data-press>Retirar solicitud y editar</button></div>`;
  }
  if (c.status === 'expired' || c.status === 'revoked') {
    const msg = c.status === 'expired' ? 'Tu borrador venció por inactividad. Empezá una solicitud nueva cuando quieras.' : `Tu verificación fue revocada. ${esc(c.revokeNote || '')} Tus lanzamientos están ocultos.`;
    return `${intro}<div class="glass-soft notice ${c.status === 'revoked' ? 'bad' : ''}">${icon(c.status === 'revoked' ? 'close' : 'clock')}<p>${msg}</p>
      <button class="btn-primary lit" data-action="claim-reopen" data-press>Empezar una solicitud nueva</button></div>`;
  }

  const can = canResubmit(a.attemptsInfo, Date.now());
  const notice = {
    needs_info: `<div class="glass-soft notice warn">${icon('edit')}<p>Necesitamos más información: ${esc(c.reviewNote || '')}</p></div>`,
    rejected: `<div class="glass-soft notice bad">${icon('close')}<p>No pudimos verificar tu perfil. ${esc(c.reviewNote || '')} Podés volver a enviar la solicitud el ${fecha(can.ok ? Date.now() : can.until)}.</p></div>`,
    withdrawn: `<div class="glass-soft notice">${icon('edit')}<p>Retiraste la solicitud. Podés editarla y volver a enviarla.</p></div>`,
  }[c.status] || '';
  const fixedName = t.kind === 'catalog';
  const linkOptions = PLATFORMS.map((pl) => `<option value="${pl.key}" ${c.codeWhere === pl.key ? 'selected' : ''}>${pl.label}</option>`).join('');

  return `${intro}${notice}
    ${e.form ? `<div class="glass-soft notice bad" role="alert">${icon('close')}<p>${esc(e.form)}</p></div>` : ''}
    <form class="claim-form" data-form="claim" novalidate>
      <fieldset class="glass-soft form-card" data-reveal="fadeUp">
        <legend>1 · Tus datos</legend>
        <div class="form-grid">
          <label class="field"><span>Nombre artístico *</span><input class="input" name="artistName" maxlength="60" value="${esc(c.artistName)}" placeholder="Como figurás en plataformas" ${fixedName ? 'readonly aria-readonly="true"' : ''}>${fieldError(e, 'artistName')}</label>
          <label class="field"><span>Nombre y apellido reales *</span><input class="input" name="legalName" maxlength="80" value="${esc(c.legalName)}" placeholder="Privado, sólo para verificar">${fieldError(e, 'legalName')}</label>
          <label class="field"><span>Correo de contacto *</span><input class="input" name="email" type="email" value="${esc(c.email)}">${app.auth.mode === 'local' ? '<small class="hint">Correo sin verificar (cuenta local).</small>' : ''}${fieldError(e, 'email')}</label>
          <label class="field"><span>País *</span><input class="input" name="country" maxlength="40" value="${esc(c.country)}" placeholder="Argentina">${fieldError(e, 'country')}</label>
        </div>
        <div class="field"><span>Géneros * <small class="muted">(de 1 a 3)</small></span>
          <div class="chips">${GENRES.map((g) => `<button type="button" class="chip lit ${c.genres.includes(g) ? 'on' : ''}" data-genre="${esc(g)}">${esc(g)}</button>`).join('')}</div>${fieldError(e, 'genres')}</div>
        <label class="field"><span>Bio de artista</span><textarea class="input" name="bio" rows="3" maxlength="500" placeholder="Opcional">${esc(c.bio)}</textarea></label>
      </fieldset>

      <fieldset class="glass-soft form-card" data-reveal="fadeUp">
        <legend>2 · Tus enlaces</legend>
        <p class="hint">Enlaces completos (https://…) a las plataformas donde ya está tu música y a tus redes.${fixedName ? ' El enlace de Apple Music tiene que ser el de este artista.' : ''}</p>
        <div class="form-grid">${PLATFORMS.map((pl) => `<label class="field"><span>${pl.label} <small class="tag ${pl.kind}">${{ music: 'música', social: 'red social', web: 'web' }[pl.kind]}</small></span>
          <input class="input" name="link_${pl.key}" type="url" inputmode="url" maxlength="300" placeholder="${pl.ph}" value="${esc(c.links?.[pl.key] || '')}">${fieldError(e, `link_${pl.key}`)}</label>`).join('')}</div>
      </fieldset>

      <fieldset class="glass-soft form-card" data-reveal="fadeUp">
        <legend>3 · Pruebas</legend>
        <p class="hint">Se necesitan al menos dos pruebas de tipos distintos, y una tiene que ser fuerte: tus enlaces cuentan como una; el código publicado es la prueba fuerte.</p>
        <p>Copiá este código y publicalo en la bio o en una publicación de una de las redes que enlazaste. Lo vamos a buscar para confirmar que la cuenta es tuya. Después de la aprobación lo podés borrar.</p>
        <div class="code-box"><code>${esc(c.code)}</code><button type="button" class="btn-glass lit" data-action="copy-code" data-code="${esc(c.code)}" data-press>Copiar</button></div>
        <label class="field"><span>¿Dónde publicaste el código?</span><select class="select lit" name="codeWhere"><option value="">Todavía no lo publiqué</option>${linkOptions}</select>${fieldError(e, 'codeWhere')}</label>
        <div class="claim-ev-off"><span>${icon('lock')}Correo de tu dominio oficial</span><small class="hint">Disponible cuando haya servidor de verificación.</small></div>
        ${fieldError(e, 'evidence')}
        <label class="check"><input type="checkbox" name="agree" ${c.agree ? 'checked' : ''}><span>Declaro que soy el artista (o su representante autorizado) y que la información es verdadera. Entiendo que la suplantación de identidad causa la baja de la cuenta.</span></label>${fieldError(e, 'agree')}
      </fieldset>

      <div class="form-actions" data-reveal="fadeUp">
        <button type="button" class="btn-glass lit" data-action="claim-save" data-press>Guardar borrador</button>
        <button class="btn-primary lit" data-claim-submit data-press>${icon('shield')}Enviar solicitud</button>
      </div>
    </form>`;
}

function claimSummary(c, { review = false } = {}) {
  const links = PLATFORMS.filter((p) => c.links?.[p.key]);
  const t = claimTarget(c);
  return `<div class="glass-soft form-card">
    <div class="summary-grid">
      <div><span>Nombre artístico</span><b>${esc(c.artistName)}</b></div>
      <div><span>Tipo</span><b>${t.kind === 'catalog' ? `Perfil del catálogo: ${esc(t.name)}` : 'Nombre nuevo'}</b></div>
      <div><span>País</span><b>${esc(c.country)}</b></div>
      <div><span>Géneros</span><b>${esc((c.genres || []).join(', '))}</b></div>
      <div><span>Código</span><b><code>${esc(c.code)}</code></b></div>
      ${review ? `<div><span>Correo</span><b>${esc(c.email)}${isFreeEmail(c.email) ? ' <small class="muted">(dominio gratuito)</small>' : ''}</b></div>` : ''}
    </div>
    <div class="link-list">${links.map((p) => `<a href="${esc(c.links[p.key])}" target="_blank" rel="noopener noreferrer" class="link-chip lit">${icon('link')}${p.label}</a>`).join('')}</div>
  </div>`;
}

function readClaim(form) {
  const c = workingClaim();
  for (const k of ['artistName', 'legalName', 'email', 'country', 'bio']) c[k] = form[k].value.trim();
  c.links = {};
  for (const p of PLATFORMS) {
    const v = form[`link_${p.key}`].value.trim();
    if (v) c.links[p.key] = v;
  }
  c.genres = [...form.querySelectorAll('[data-genre].on')].map((b) => b.dataset.genre);
  c.codeWhere = form.codeWhere.value;
  c.codePlaced = !!c.codeWhere;
  c.agree = form.agree.checked;
  c.username = app.profile?.username;
  c.evidence = buildEvidence(c);
  return c;
}

// ---------- estudio ----------

export function viewStudio() {
  const a = app.artist;
  if (!a.verified) return viewClaim();
  const rel = a.releases;
  return `<section class="studio-hero enter">
      <div><p class="eyebrow">${icon('verified', 'verified-ico')} ${esc(a.claim.artistName)}</p><h1>Estudio</h1>
      <p class="muted">Subí singles, EPs y álbumes gratis. Cada lanzamiento pasa por control de calidad de audio y una revisión antes de publicarse.</p></div>
      <button class="btn-primary lit" data-action="new-release">${icon('plus')}Nuevo lanzamiento</button>
    </section>
    <div class="studio-stats enter" style="--i:1">
      ${[['Publicados', rel.filter((r) => r.status === 'published').length], ['Estrenos', rel.filter((r) => r.status === 'scheduled').length], ['En revisión', rel.filter((r) => r.status === 'review').length], ['Borradores', rel.filter((r) => r.status === 'draft' || r.status === 'rejected').length]].map(([l, n]) => `<div class="glass-soft stat"><b>${n}</b><span>${l}</span></div>`).join('')}
    </div>
    ${app.auth.mode === 'local' ? '<p class="hint">Sin nube conectada, "publicado" significa visible para todas las cuentas de este equipo.</p>' : ''}
    ${cobrosSection(a)}
    <h2 class="section-title">Tus lanzamientos</h2>
    ${rel.length ? `<div class="release-list">${rel.map((r, i) => `<div class="release-row lit enter" style="--i:${i}" data-action="open-release" data-id="${r.id}">
        <div class="art sm">${r.coverThumb ? `<img src="${esc(r.coverThumb)}" alt="" loading="lazy" decoding="async">` : icon('disc')}</div>
        <div class="row-main"><div class="row-title">${esc(r.title || 'Sin título')}</div><div class="row-sub">${esc(typeLabel(r.type))} · ${r.tracks.length} ${r.tracks.length === 1 ? 'canción' : 'canciones'} · ${esc(releaseWhen(r))}</div></div>
        ${statusPill(RELEASE_STATUS[r.status])}
      </div>`).join('')}</div>` : `<div class="glass-soft notice">${icon('disc')}<p>Todavía no subiste nada. Empezá con un single.</p></div>`}`;
}

// ---------- cobros (Requisitos/Suscripciones v2 §5 y §7) ----------
// Sin servidor: borradores locales (nombre, descripción y precio previsto). Beneficios fijos por ranura (contrato
// del servidor, D1): se muestran en sólo lectura. Con servidor: estado, precio vigente, suscriptores y acciones.
const SLOT_NAMES = ['Fan', 'Superfan', 'VIP'];
const TIER_STATE = { draft: 'Borrador', published: 'Publicado', closed_to_new: 'Cerrado a nuevas altas' };
const eur = (c) => formatEUR(c || 0);
const centsText = (c) => (Number.isInteger(c) ? (c / 100).toFixed(2).replace('.', ',') : '');
const perks = (i) => `<ul class="tier-perks ro">${TIER_BENEFITS[i].map((b) => `<li>${icon('check')}${esc(b)}</li>`).join('')}</ul>`;

function cobrosSection(a) {
  const drafts = [0, 1, 2].map((i) => ({ name: SLOT_NAMES[i], description: '', ...(a.claim.tierDrafts?.[i] || {}) }));
  const server = payments.configured;
  const adv = !!app.prefs.advanced;
  if (server) app.ui.mount = (root) => mountCobros(root);
  return `<h2 class="section-title">Cobros</h2>
    <div class="glass-soft form-card cobros" data-reveal="fadeUp">
      ${server ? `<p>Recibí suscripciones mensuales y SoundDrops de tus oyentes.${adv ? ' El 88 % de cada suscripción y el 90 % de cada SoundDrop van a tu cuenta.' : ''}</p>
        <div class="row-btns"><button class="btn-primary lit" data-action="connect-onboard" data-press>Configurar cobros con Stripe</button><button class="btn-glass lit" data-action="connect-earnings" data-press>Ver ingresos</button></div>
        <div class="tiers-live" data-tiers-live><p class="hint">Cargando tus niveles…</p></div>`
        : '<p class="hint">Los cobros no están disponibles en esta instalación. Podés preparar tus niveles: se activan cuando se conecte el servidor de pagos.</p>'}
      <form class="tier-drafts" data-form="tiers" novalidate ${server ? 'hidden' : ''}>${drafts.map((t, i) => `<fieldset class="tier-draft">
        <legend>${esc(SLOT_NAMES[i])} <small class="muted">Borrador local. No tiene precio vigente.</small></legend>
        <label class="field"><span>Nombre</span><input class="input" name="t${i}_name" maxlength="${TIER_NAME_MAX}" value="${esc(t.name)}"></label>
        <label class="field"><span>Descripción</span><input class="input" name="t${i}_description" maxlength="140" value="${esc(t.description || '')}"></label>
        <label class="field"><span>Precio previsto (€ / mes) <small class="muted">opcional</small></span><input class="input" name="t${i}_price" inputmode="decimal" placeholder="${centsText(REF_CENTS[i])}" value="${esc(centsText(t.plannedCents))}"></label>
        <div class="field"><span>Beneficios del nivel</span>${perks(i)}</div></fieldset>`).join('')}
        <p class="field-error" data-tiers-error></p>
        <div class="row-btns"><button type="button" class="btn-glass lit" data-action="tiers-save" data-press>Guardar niveles</button>
        <button type="button" class="btn-glass lit" data-action="tiers-preview" data-press>${icon('eye')}Ver cómo lo ve el público</button></div></form>
    </div>`;
}

// lee y valida los borradores: nombre 2–24 y distinto, descripción ≤ 140, precio previsto 2,99–99,99 € creciente
function readTierDrafts(f) {
  const out = [], names = new Set();
  for (const i of [0, 1, 2]) {
    const name = f[`t${i}_name`].value.trim() || SLOT_NAMES[i];
    const priceTxt = f[`t${i}_price`].value.trim();
    const plannedCents = priceTxt ? parseAmount(priceTxt) : null;
    if (name.length < 2 || name.length > TIER_NAME_MAX || /[<>]/.test(name)) return { error: `El nombre del nivel tiene que tener entre 2 y ${TIER_NAME_MAX} caracteres.` };
    if (names.has(name.toLowerCase())) return { error: 'Cada nivel necesita un nombre distinto.' };
    names.add(name.toLowerCase());
    if (priceTxt && !Number.isFinite(plannedCents)) return { error: 'El precio de un nivel tiene que estar entre 2,99 € y 99,99 €.' };
    const prev = app.artist.claim.tierDrafts?.[i] || {};
    out.push({ ...prev, name, description: f[`t${i}_description`].value.trim().slice(0, 140), plannedCents });
  }
  const err = priceRule(out.map((t) => t.plannedCents));
  return err ? { error: err } : { drafts: out };
}

// con servidor: niveles reales del artista (GET /api/artists/me/tiers). No verificable sin ejecutar server/.
export async function mountCobros(root) {
  const host = root.querySelector('[data-tiers-live]');
  if (!host) return;
  const h = await payments.health();
  if (!host.isConnected) return;
  if (!h) { host.innerHTML = '<p class="hint">No pudimos conectar con el servicio de pagos. Probá de nuevo en unos minutos.</p>'; root.querySelector('[data-form=tiers]')?.removeAttribute('hidden'); return; }
  let own;
  try { own = await payments.call('/api/artists/me/tiers', { auth: app.auth }); } catch (err) { host.innerHTML = `<p class="hint">${esc(err.message)}</p>`; return; }
  if (!host.isConnected) return;
  const tiers = own.tiers || [];
  app.ui.ownTiers = tiers;
  const c = app.artist.claim;
  const bySlot = (s) => tiers.find((t) => t.slot === s && t.state !== 'archived');
  const total = tiers.reduce((n, t) => n + (+t.subscribers || 0), 0);
  const drafts = c.tierDrafts || [];
  const offerImport = drafts.some((d) => d?.name || d?.plannedCents) && !tiers.some((t) => t.state !== 'archived');
  const adv = !!app.prefs.advanced;
  host.innerHTML = `${offerImport ? `<div class="glass-soft notice">${icon('sparkle')}<p>Tenés niveles preparados. ¿Querés publicarlos?</p><button class="btn-glass lit" data-action="tiers-import" data-press>Revisar niveles</button></div>` : ''}
    <p class="hint">Suscriptores: <b>${total}</b></p>
    <form class="tier-drafts live" data-form="tiers-live" novalidate>${[1, 2, 3].map((s) => {
      const t = bySlot(s) || { slot: s, name: drafts[s - 1]?.name || SLOT_NAMES[s - 1], description: drafts[s - 1]?.description || '', state: null, amountCents: drafts[s - 1]?.plannedCents || REF_CENTS[s - 1], subscribers: 0 };
      const subs = +t.subscribers || 0;
      return `<fieldset class="tier-draft" data-slot="${s}">
        <legend>${esc(SLOT_NAMES[s - 1])} <span class="pill ${t.state === 'published' ? 'ok' : 'muted'}">${t.state ? TIER_STATE[t.state] || '' : 'Sin crear'}</span></legend>
        <label class="field"><span>Nombre</span><input class="input" name="s${s}_name" maxlength="${TIER_NAME_MAX}" value="${esc(t.name)}"></label>
        <label class="field"><span>Descripción</span><input class="input" name="s${s}_description" maxlength="140" value="${esc(t.description || '')}"></label>
        <label class="field"><span>Precio (€ / mes)</span><input class="input" name="s${s}_price" inputmode="decimal" value="${esc(centsText(t.publishedPriceCents ?? t.amountCents))}"></label>
        <p class="hint">${subs} ${subs === 1 ? 'suscriptor' : 'suscriptores'}${adv && t.priceVersion ? ` · versión de precio ${t.priceVersion}` : ''}</p>
        <div class="field"><span>Beneficios del nivel</span>${perks(s - 1)}</div>
        <div class="row-btns">
          <button type="button" class="btn-glass lit" data-action="tier-save" data-slot="${s}" data-press>Guardar</button>
          ${t.state === 'draft' || !t.state ? `<button type="button" class="btn-primary lit" data-action="tier-state" data-slot="${s}" data-to="published" data-press>Publicar</button>` : ''}
          ${t.state === 'published' ? `<button type="button" class="btn-glass lit" data-action="tier-state" data-slot="${s}" data-to="closed_to_new" data-press>Cerrar a nuevas altas</button>` : ''}
          ${t.state === 'closed_to_new' ? `<button type="button" class="btn-glass lit" data-action="tier-state" data-slot="${s}" data-to="published" data-press>Reabrir</button>` : ''}
          ${t.state ? `<button type="button" class="btn-glass danger lit" data-action="tier-delete" data-slot="${s}" data-press>Eliminar</button>` : ''}
        </div></fieldset>`;
    }).join('')}</form>
    <label class="check"><input type="checkbox" data-tiers-counter ${c.tierOptions?.showCounter ? 'checked' : ''}><span>Mostrar el contador de suscriptores en mi perfil</span></label>
    <button type="button" class="btn-glass lit" data-action="tiers-preview" data-press>${icon('eye')}Ver cómo lo ve el público</button>`;
  const box = host.querySelector('[data-tiers-counter]');
  if (box) box.onchange = () => app.actions['tiers-counter'](box);
}

async function tierCall(slot, body, create) {
  return payments.call(create ? '/api/artists/me/tiers' : `/api/artists/me/tiers/${slot}`, { method: create ? 'POST' : 'PATCH', auth: app.auth, body: create ? { slot, ...body } : body });
}

export function viewRelease() {
  const a = app.artist;
  const r = a.getRelease(app.ui.param);
  if (!r) return viewStudio();
  const tracks = r.tracks.map((rt) => app.library.byId.get(rt.trackId)).filter(Boolean);
  const e = releaseErrors;
  const locked = LOCKED.has(r.status);
  const st = RELEASE_STATUS[r.status];
  return `${backBtn()}
    <section class="release-head enter">
      <label class="release-cover lit ${locked ? 'locked' : ''}">
        ${r.coverThumb ? `<img src="${esc(r.coverThumb)}" alt="">` : `<span>${icon('image')}Portada<br><small>JPG/PNG cuadrada · mín. 1400 px</small></span>`}
        ${locked ? '' : '<input type="file" accept="image/jpeg,image/png" hidden data-release-cover>'}
      </label>
      <div class="detail-meta">
        <p class="eyebrow">${esc(typeLabel(r.type))} ${statusPill(st)}</p>
        <h1>${esc(r.title || 'Nuevo lanzamiento')}</h1>
        <p class="muted">${esc(r.primaryArtist)}${r.featuring ? ` feat. ${esc(r.featuring)}` : ''} · ${tracks.length} ${tracks.length === 1 ? 'canción' : 'canciones'} · ${esc(releaseWhen(r))}</p>
        ${r.status === 'scheduled' ? `<p class="premiere-line">${icon('clock')}<span data-countdown="${r.premiereAt}"></span></p>` : ''}
        ${r.status === 'published' ? `<p class="hint">Publicado${localNote()}: todos pueden escucharlo.</p>` : ''}
        ${r.status === 'hidden' ? '<p class="hint">Oculto: nadie más lo ve. Podés volver a publicarlo cuando quieras.</p>' : ''}
        ${r.status === 'withdrawn' ? `<p class="field-error">Retirado${r.reviewNote ? `: ${esc(r.reviewNote)}` : ''}. El audio se borró.</p>` : ''}
        ${r.coverSize ? `<p class="hint">Portada ${r.coverSize.width} × ${r.coverSize.height} px ${r.coverSize.width >= 3000 ? '✓' : '· recomendado 3000 px'}</p>` : ''}
        ${fieldError(e, 'cover')}
        ${r.status === 'rejected' && r.reviewNote ? `<p class="field-error">Revisión: ${esc(r.reviewNote)}</p>` : ''}
      </div>
    </section>

    <form class="release-form" data-form="release" data-id="${r.id}" novalidate>
      <fieldset class="glass-soft form-card enter" style="--i:1" ${locked ? 'disabled' : ''}>
        <legend>Información</legend>
        <div class="seg three type-seg">${['single', 'ep', 'album'].map((t) => `<button type="button" class="seg-btn lit ${r.type === t ? 'on' : ''}" data-rtype="${t}">${typeLabel(t)[0].toUpperCase() + typeLabel(t).slice(1)}</button>`).join('')}</div>
        <div class="form-grid">
          <label class="field"><span>Título *</span><input class="input" name="title" maxlength="100" value="${esc(r.title)}">${fieldError(e, 'title')}</label>
          <label class="field"><span>Artista principal *</span><input class="input" name="primaryArtist" maxlength="80" value="${esc(r.primaryArtist)}">${fieldError(e, 'primaryArtist')}</label>
          <label class="field"><span>Artistas invitados</span><input class="input" name="featuring" maxlength="120" value="${esc(r.featuring)}" placeholder="Separados por coma"></label>
          <label class="field"><span>Género *</span><select class="select" name="genre"><option value="">Elegí…</option>${GENRES.map((g) => `<option ${r.genre === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>${fieldError(e, 'genre')}</label>
          <label class="field"><span>Idioma</span><input class="input" name="language" maxlength="30" value="${esc(r.language)}"></label>
          <label class="field"><span>Sello</span><input class="input" name="label" maxlength="80" value="${esc(r.label)}" placeholder="Independiente"></label>
          <label class="field"><span>Copyright (℗) *</span><input class="input" name="copyright" maxlength="120" value="${esc(r.copyright)}">${fieldError(e, 'copyright')}</label>
        </div>
        <label class="check"><input type="checkbox" name="explicit" ${r.explicit ? 'checked' : ''}><span>Contenido explícito</span></label>
      </fieldset>

      <fieldset class="glass-soft form-card enter" style="--i:2" ${locked ? 'disabled' : ''}>
        <legend>Canciones</legend>
        <p class="hint">Audio sin pérdida (WAV, FLAC, ALAC o AIFF), 44.1 kHz o más, 16 o 24 bits. ZUENA analiza la sonoridad y los picos de cada archivo.</p>
        ${tracks.length ? `<div class="rtracks">${r.tracks.map((rt, i) => releaseTrack(rt, app.library.byId.get(rt.trackId), i, e)).join('')}</div>` : ''}
        ${fieldError(e, 'tracks')}
        ${locked ? '' : `<label class="dropzone lit">${icon('upload')}<span><b>Agregar audio</b> o arrastrá archivos acá</span><input type="file" accept=".wav,.flac,.m4a,.aif,.aiff,audio/*" multiple hidden data-release-audio></label>`}
      </fieldset>

      ${salidaFieldset(r, e)}

      <fieldset class="glass-soft form-card enter" style="--i:4" ${locked ? 'disabled' : ''}>
        <legend>Derechos</legend>
        <label class="check"><input type="checkbox" name="rights" ${r.rights ? 'checked' : ''}><span>Tengo los derechos de todo el material (grabación, composición, portada y samples) o las licencias necesarias para distribuirlo.</span></label>${fieldError(e, 'rights')}
      </fieldset>

      <div class="form-actions">
        ${r.status === 'review' ? '<button type="button" class="btn-glass lit" data-action="release-withdraw">Retirar de revisión</button>' : ''}
        ${!LOCKED.has(r.status) ? `<button type="button" class="btn-glass danger lit" data-action="release-delete">${icon('trash')}Eliminar</button>
          <button type="button" class="btn-glass lit" data-action="release-save">Guardar borrador</button>
          <button class="btn-primary lit">${icon('upload')}Enviar a revisión</button>` : ''}
        ${r.status === 'scheduled' ? `<button type="button" class="btn-glass lit" data-action="release-cancel-premiere">Cancelar estreno</button>
          <button type="button" class="btn-glass lit" data-action="release-play">${icon('play')}Escuchar</button>
          <button type="button" class="btn-primary lit" data-action="release-publish-now">Publicar ahora</button>` : ''}
        ${r.status === 'published' ? `<button type="button" class="btn-glass danger lit" data-action="release-retire">Retirar</button>
          <button type="button" class="btn-glass lit" data-action="release-hide">Ocultar</button>
          ${postOf(r) ? `<button type="button" class="btn-glass lit" data-action="release-pin">${icon('star')}${postOf(r).pinned ? 'Desanclar del feed' : 'Anclar en mi feed'}</button>` : ''}
          <button type="button" class="btn-primary lit" data-action="release-play">${icon('play')}Escuchar</button>` : ''}
        ${r.status === 'hidden' ? `<button type="button" class="btn-glass danger lit" data-action="release-retire">Retirar</button>
          <button type="button" class="btn-primary lit" data-action="release-republish">Volver a publicar</button>` : ''}
      </div>
    </form>`;
}

const postOf = (r) => app.posts.list.find((p) => p.id === `rel-${r.id}`) || null;

// cuándo sale y cómo se anuncia. En un estreno programado sólo se puede mover la fecha (hasta 1 h antes).
function salidaFieldset(r, e) {
  const draft = !LOCKED.has(r.status);
  const canMove = r.status === 'scheduled' && r.premiereAt - Date.now() > RESCHEDULE_LOCK_MS;
  const sched = r.releaseMode === 'scheduled';
  const tz = (r.premiereTz || Intl.DateTimeFormat().resolvedOptions().timeZone).replace(/_/g, ' ');
  const min = toLocalInput(Date.now() + 16 * 60e3);
  return `<fieldset class="glass-soft form-card enter" style="--i:3" ${draft || canMove ? '' : 'disabled'}>
    <legend>Salida y feed</legend>
    ${draft ? `<div class="seg two" role="radiogroup" aria-label="Cuándo sale">
      <button type="button" class="seg-btn lit ${sched ? '' : 'on'}" data-rmode="onApprove" aria-pressed="${!sched}">Apenas se apruebe</button>
      <button type="button" class="seg-btn lit ${sched ? 'on' : ''}" data-rmode="scheduled" aria-pressed="${sched}">Programar estreno</button></div>` : ''}
    <input type="hidden" name="releaseMode" value="${sched ? 'scheduled' : 'onApprove'}">
    ${sched || r.status === 'scheduled' ? `<label class="field"><span>Fecha y hora del estreno <small class="muted">hora de ${esc(tz)}</small></span>
      <input class="input" type="datetime-local" name="premiereAt" min="${min}" value="${toLocalInput(r.premiereAt)}">${fieldError(e, 'premiereAt')}
      <span class="hint">${r.status === 'scheduled' && !canMove ? 'Falta menos de una hora: ya no se puede mover. Podés cancelar el estreno.' : 'Antes del estreno los oyentes ven la portada y una cuenta regresiva, sin audio.'}</span></label>` : ''}
    ${r.status === 'scheduled' && canMove ? '<button type="button" class="btn-glass lit" data-action="release-reschedule">Guardar nueva fecha</button>' : ''}
    ${draft ? `<label class="check"><input type="checkbox" name="postAuto" ${r.postMode !== 'none' ? 'checked' : ''}><span>Publicar el lanzamiento en mi feed</span></label>
      <label class="field"><span>Texto de la publicación <small class="muted">opcional</small></span>
        <textarea class="input" name="postText" maxlength="280" rows="2" placeholder="${sched ? 'Estreno el …: «título»' : 'Nuevo lanzamiento: «título»'}">${esc(r.postText || '')}</textarea>${fieldError(e, 'postText')}</label>
      ${sched ? `<label class="check"><input type="checkbox" name="announce" ${r.announce ? 'checked' : ''}><span>Anunciar el estreno en el feed apenas se apruebe</span></label>` : ''}
      <label class="check"><input type="checkbox" name="pinOnPublish" ${r.pinOnPublish ? 'checked' : ''}><span>Anclarlo en mi feed (reemplaza al anclado actual)</span></label>` : ''}
  </fieldset>`;
}

function releaseTrack(rt, t, i, e) {
  if (!t) return '';
  const q = quality(t);
  const errs = qcErrors(t);
  const warns = qcWarnings(t);
  const a = t.analysis;
  return `<div class="rtrack ${errs.length ? 'bad' : ''}" data-index="${i}">
    <span class="rtrack-n">${i + 1}</span>
    <div class="rtrack-fields">
      <div class="form-grid tight">
        <label class="field"><span>Título</span><input class="input" name="t_title_${i}" value="${esc(rt.title)}">${fieldError(e, `t${i}_title`)}</label>
        <label class="field"><span>ISRC <small class="muted">opcional</small></span><input class="input" name="t_isrc_${i}" value="${esc(rt.isrc || '')}" placeholder="AR-ABC-26-00001">${fieldError(e, `t${i}_isrc`)}</label>
        <label class="field"><span>Compositores</span><input class="input" name="t_composers_${i}" value="${esc(rt.composers || '')}"></label>
        <label class="field"><span>Productores</span><input class="input" name="t_producers_${i}" value="${esc(rt.producers || '')}"></label>
      </div>
      <div class="qc">
        <span class="badge ${t.lossless ? (q.hi ? 'hi' : '') : 'bad'}">${esc(q.label)}</span>
        <span>${esc([t.codec, t.bitDepth ? `${t.bitDepth}-bit` : '', fmtRate(t.sampleRate)].filter(Boolean).join(' · '))}</span>
        <span>${t.duration ? fmtTime(t.duration) : ''}</span>
        ${a ? `<span>${a.lufs.toFixed(1)} LUFS · ${a.truePeakDb.toFixed(1)} dBTP</span>` : t.analysisFailed ? '' : '<span class="analyzing"><span class="pulse"></span>Analizando…</span>'}
      </div>
      ${errs.map((x) => `<p class="field-error">${esc(x)}</p>`).join('')}
      ${warns.map((x) => `<p class="qc-warn">⚠ ${esc(x)}</p>`).join('')}
      ${fieldError(e, `t${i}_qc`)}
    </div>
    <div class="rtrack-actions">
      <button type="button" class="btn-icon lit sm" data-action="release-track-play" data-track="${esc(t.id)}" title="Escuchar">${icon('play')}</button>
      <button type="button" class="btn-icon lit sm" data-action="release-track-up" data-index="${i}" title="Subir" ${i ? '' : 'disabled'}>${icon('chevronLeft', 'rot90')}</button>
      <button type="button" class="btn-icon lit sm" data-action="release-track-remove" data-index="${i}" title="Quitar">${icon('close')}</button>
    </div>
  </div>`;
}

function readRelease(form, r) {
  for (const k of ['title', 'primaryArtist', 'featuring', 'genre', 'language', 'label', 'copyright']) if (form[k]) r[k] = form[k].value.trim();
  if (form.releaseMode) r.releaseMode = form.releaseMode.value;
  if (form.premiereAt) { r.premiereAt = fromLocalInput(form.premiereAt.value); r.premiereTz = Intl.DateTimeFormat().resolvedOptions().timeZone; }
  if (form.postAuto) r.postMode = form.postAuto.checked ? 'auto' : 'none';
  if (form.postText) r.postText = form.postText.value.trim().slice(0, 280);
  if (form.announce) r.announce = form.announce.checked;
  if (form.pinOnPublish) r.pinOnPublish = form.pinOnPublish.checked;
  r.releaseDate = new Date(r.releaseMode === 'scheduled' && Number.isFinite(r.premiereAt) ? r.premiereAt : Date.now()).toISOString().slice(0, 10);
  r.explicit = !!form.explicit?.checked;
  r.rights = !!form.rights?.checked;
  r.tracks.forEach((rt, i) => {
    for (const k of ['title', 'isrc', 'composers', 'producers']) {
      const el = form[`t_${k}_${i}`];
      if (el) rt[k] = k === 'isrc' ? el.value.trim().toUpperCase() : el.value.trim();
    }
  });
  return r;
}

const currentRelease = () => app.artist.getRelease(app.ui.param);
const releaseForm = () => document.querySelector('[data-form=release]');

async function persistRelease(silent = true) {
  const r = currentRelease();
  const form = releaseForm();
  if (!r || !form || LOCKED.has(r.status)) return r;
  if (!silent && !(await app.artist.stillVerified())) { app.toast('Tu verificación ya no está activa. No se pudo guardar el lanzamiento.'); return r; }
  readRelease(form, r);
  await app.artist.saveRelease(r);
  if (!silent) app.toast('Borrador guardado');
  return r;
}

export async function addReleaseAudio(files) {
  const r = await persistRelease();
  if (!r) return;
  const added = await app.library.import(files, { hidden: true, releaseId: r.id });
  if (!added.length) { app.toast('No se encontraron archivos de audio'); return; }
  for (const t of added) {
    if (r.tracks.some((x) => x.trackId === t.id)) continue;
    r.tracks.push({ trackId: t.id, title: t.title, isrc: '', composers: '', producers: '' });
  }
  await app.artist.saveRelease(r);
  app.render();
}

async function setReleaseCover(file) {
  const r = await persistRelease();
  try {
    r.coverSize = await checkCover(file);
  } catch (err) {
    releaseErrors = { ...releaseErrors, cover: err.message };
    app.render();
    return;
  }
  const { processImage } = await import('../data/profiles.js');
  r.cover = file;
  r.coverThumb = await processImage(file, 600, 600, 0.9);
  delete releaseErrors.cover;
  await app.artist.saveRelease(r);
  app.render();
}

// Publicación efectiva (al aprobarse o al llegar la hora del estreno): las pistas quedan disponibles para
// todos desde el catálogo (origin 'release', fuera de las bibliotecas privadas) y aparece el post del feed.
export async function materializeRelease(r) {
  const coverBlob = r.cover instanceof Blob ? r.cover : null;
  const year = (r.releaseDate || '').slice(0, 4);
  for (let i = 0; i < r.tracks.length; i++) {
    const rt = r.tracks[i];
    const t = app.library.byId.get(rt.trackId);
    if (!t) continue;
    await app.library.update(t, {
      hidden: false,
      origin: 'release',
      owner: null,
      title: rt.title || t.title,
      artist: r.featuring ? `${r.primaryArtist} feat. ${r.featuring}` : r.primaryArtist,
      albumArtist: r.primaryArtist,
      album: r.title,
      track: i + 1,
      year,
      genre: r.genre,
      coverBlob: coverBlob || t.coverBlob,
      added: Date.now() + (r.tracks.length - i),
    });
  }
  if (r.postMode !== 'none') await upsertReleasePost(r);
  if (r.pinOnPublish) await app.posts.pin(`rel-${r.id}`, r.uid);
}

// un único post por lanzamiento (`rel-<id>`): teaser mientras es estreno, tarjeta reproducible al publicarse
async function upsertReleasePost(r) {
  const prof = app.posts.author(r.uid) || (r.uid === app.user?.uid ? app.profile : null) || {};
  const soon = isUpcoming(r);
  return app.posts.upsert({
    id: `rel-${r.id}`,
    uid: r.uid,
    text: r.postText || (soon ? `Estreno el ${premiereLabel(r.premiereAt)}: «${r.title}»` : `Nuevo lanzamiento: «${r.title}»`),
    attach: { type: 'release', releaseId: r.id, title: r.title, artist: r.primaryArtist, cover: r.coverThumb, count: r.tracks.length },
    created: soon ? Date.now() : r.published || Date.now(),
    author: { uid: r.uid, displayName: prof.displayName || r.primaryArtist, username: prof.username || r.username, avatar: prof.avatar, role: 'artist' },
  });
}

export async function publishRelease(r) {
  r.status = 'published';
  r.published = Date.now();
  await saveRel(r);
  await materializeRelease(r);
}

// ---------- revisión (§7): owner/admin; en cuentas locales sólo con "Modo desarrollador" ----------

export const canReview = () => {
  const r = app.auth.role;
  if (r !== 'owner' && r !== 'admin') return false;
  return app.auth.mode !== 'local' || app.user?.mode === 'cloud' || !!app.prefs.dev;
};
// el propio reclamo sólo se aprueba en modo local con Modo desarrollador (queda "Verificado en este equipo")
const reviewer = () => ({ uid: app.user?.uid || '', name: app.profile?.displayName || '', canSelf: !app.artist.hasServer && !!app.prefs.dev });
const REVIEW_FILTERS = [['pending', 'Pendientes'], ['needs_info', 'Faltan datos'], ['rejected', 'Rechazados'], ['approved', 'Aprobados'], ['revoked', 'Revocados']];
const EV_STATUS = { unchecked: ['Sin comprobar', 'muted'], ok: ['Comprobada', 'ok'], manual_ok: ['Comprobada a mano', 'ok'], fail: ['No encontrada', 'bad'] };
const evLabel = (e) => (e.kind === 'code' ? `Código publicado en ${PLATFORMS.find((p) => p.key === e.where)?.label || 'una red'}` : e.kind === 'email_domain' ? 'Correo del dominio oficial' : `Enlace · ${PLATFORMS.find((p) => p.key === e.platform)?.label || 'enlace'}`);

function reviewCard(c, i, all) {
  const me = reviewer();
  const self = me.uid === c.uid;
  const t = claimTarget(c);
  const ev = evidenceOf(c);
  const enough = evidenceOk(c, { approval: true }) && catalogLinkOk(c);
  const signals = abuseSignals(c, all, { catalogNames: catalogNames(), accountCreated: c.accountCreated || 0 });
  const catalogBad = t.kind === 'catalog' && !catalogLinkOk(c);
  const adv = !!app.prefs.advanced;
  let actions = '';
  if (c.status === 'pending') {
    actions = self && !me.canSelf
      ? '<p class="hint">No podés revisar tu propia solicitud.</p>'
      : `<div class="hero-actions">
        <button class="btn-glass lit" data-action="review-claim" data-op="needs_info" data-uid="${esc(c.uid)}" data-expected="pending" data-press>Pedir cambios</button>
        <button class="btn-glass danger lit" data-action="review-claim" data-op="reject" data-uid="${esc(c.uid)}" data-expected="pending" data-press>Rechazar</button>
        ${self && app.artist.hasServer ? '' : `<button class="btn-primary lit" data-action="review-claim" data-op="approve" data-uid="${esc(c.uid)}" data-expected="pending" ${enough ? '' : 'disabled aria-disabled="true"'} data-press>${icon('check')}Aprobar</button>`}
      </div>${enough ? '' : '<p class="hint">Faltan pruebas: se necesitan al menos dos y una fuerte.</p>'}`;
  } else if (c.status === 'approved') {
    actions = `<div class="hero-actions"><button class="btn-glass danger lit" data-action="review-claim" data-op="revoke" data-uid="${esc(c.uid)}" data-expected="approved" data-press>Revocar</button></div>`;
  }
  return `<div class="glass-soft form-card review-claim" data-reveal="fadeUp" style="--i:${i}">
    <div class="review-head"><div><b>${esc(c.artistName)}</b> ${statusPill(claimStatus(c.status))}
      <span class="muted">· ${t.kind === 'catalog' ? `Perfil del catálogo: ${esc(t.name)}` : 'Nombre nuevo'} · ${esc(c.legalName)} · ${esc(c.country)}</span>
      ${c.verification ? `<span class="muted"> · ${c.verification === 'full' ? 'Verificación completa' : 'Verificado en este equipo'}</span>` : ''}
      ${adv ? `<small class="muted"> · <code>${esc(t.key)}</code></small>` : ''}</div></div>
    ${self ? '<p class="hint">Es tu propia solicitud.</p>' : ''}
    ${claimSummary(c, { review: true })}
    <div class="review-ev"><h3>Pruebas</h3><ul>${ev.map((e, k) => {
      const [l, tone] = EV_STATUS[e.status] || EV_STATUS.unchecked;
      const red = catalogBad && e.kind === 'link' && e.platform === 'appleMusic';
      return `<li class="${red ? 'bad' : ''}"><span>${STRONG_EVIDENCE.has(e.kind) ? '<b>Fuerte</b> · ' : ''}${esc(evLabel(e))}</span>
        ${e.kind === 'link' ? `<a href="${esc(e.value)}" target="_blank" rel="noopener noreferrer" class="link small">Abrir</a>` : ''}
        <span class="pill ${tone}">${l}</span>
        ${c.status === 'pending' ? `<button class="btn-glass lit sm" data-action="review-ev" data-uid="${esc(c.uid)}" data-i="${k}" data-st="manual_ok" data-press>Comprobada</button><button class="btn-glass lit sm" data-action="review-ev" data-uid="${esc(c.uid)}" data-i="${k}" data-st="fail" data-press>No encontrada</button>` : ''}
        ${adv ? `<small class="muted"><code>${esc(e.kind)}:${k}</code></small>` : ''}</li>`;
    }).join('') || '<li class="muted">Sin pruebas cargadas.</li>'}</ul>
      ${catalogBad ? '<p class="field-error">El enlace de Apple Music no corresponde al artista reclamado.</p>' : ''}</div>
    ${signals.length ? `<div class="review-signals"><h3>Para tener en cuenta</h3><ul>${signals.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>` : ''}
    ${c.reviewNote ? `<p class="hint">Nota: ${esc(c.reviewNote)}</p>` : ''}
    ${(c.history || []).length ? `<details class="review-hist"><summary>Historial</summary><ul>${c.history.slice().reverse().map((h) => `<li>${new Date(h.at).toLocaleString('es')} · ${esc(claimStatus(h.from).label)} → ${esc(claimStatus(h.to).label)}${h.note ? ` · ${esc(h.note)}` : ''}</li>`).join('')}</ul></details>` : ''}
    ${actions}
  </div>`;
}

export async function viewReviewAsync() {
  if (!canReview()) { queueMicrotask(() => app.go('home')); return ''; }
  const filter = REVIEW_FILTERS.some(([k]) => k === app.ui.reviewFilter) ? app.ui.reviewFilter : 'pending';
  const [{ all, list }, releases] = await Promise.all([app.artist.reviewQueue(filter), app.artist.pendingReleases()]);
  return `<header class="page-head" data-reveal="fadeUp"><h1>Revisión</h1><span class="pill warn">${app.auth.mode === 'local' ? 'Modo desarrollador' : 'Administración'}</span></header>
    <h2 class="section-title">Reclamos de artista</h2>
    ${app.artist.hasServer ? '' : '<p class="hint">Estado local: no se pudo comprobar contra otros equipos.</p>'}
    <div class="seg review-filters" role="group" aria-label="Filtrar reclamos">${REVIEW_FILTERS.map(([k, l]) => `<button class="seg-btn lit ${k === filter ? 'on' : ''}" data-action="review-filter" data-f="${k}" aria-pressed="${k === filter}">${l}</button>`).join('')}</div>
    ${list.length ? list.map((c, i) => reviewCard(c, i, all)).join('') : '<p class="muted">No hay reclamos en este estado.</p>'}
    <h2 class="section-title">Lanzamientos</h2>
    ${releases.length ? releases.map((r, i) => `<div class="glass-soft form-card review-release enter" style="--i:${i}">
      <div class="art sm">${r.coverThumb ? `<img src="${esc(r.coverThumb)}" alt="" loading="lazy" decoding="async">` : ''}</div>
      <div class="row-main"><b>${esc(r.title)}</b><div class="muted">${esc(r.primaryArtist)} · ${esc(typeLabel(r.type))} · ${r.tracks.length} ${r.tracks.length === 1 ? 'canción' : 'canciones'} · ${esc(releaseWhen(r))}</div></div>
      <div class="hero-actions"><button class="btn-glass danger lit" data-action="review-release" data-id="${r.id}" data-ok="0">Pedir cambios</button><button class="btn-primary lit" data-action="review-release" data-id="${r.id}" data-ok="1">${icon('check')}Publicar</button></div>
    </div>`).join('') : '<p class="muted">No hay lanzamientos pendientes.</p>'}`;
}

// nota del revisor (5–300 caracteres) y, para revocar, confirmación escrita con el nombre artístico
function reviewNoteModal({ title, ok, confirmName = '' }) {
  return new Promise((resolve) => {
    let result = null;
    openModal(`<form class="confirm" novalidate>
        <h3>${esc(title)}</h3>
        <label class="field"><span>Se le muestra al artista</span><textarea class="input" name="note" rows="3" maxlength="300"></textarea></label>
        ${confirmName ? `<label class="field"><span>Para confirmar, escribí el nombre artístico: <b>${esc(confirmName)}</b></span><input class="input" name="name" maxlength="60" autocomplete="off"></label>` : ''}
        <p class="field-error" data-err></p>
        <div class="confirm-actions"><button type="button" class="btn-glass lit" data-modal="cancel">Cancelar</button><button class="btn-primary lit" data-press>${esc(ok)}</button></div>
      </form>`, {
      cls: 'sm',
      onMount: (m, close) => {
        const f = m.querySelector('form');
        f.onsubmit = (e) => {
          e.preventDefault();
          const err = noteError(f.note.value);
          if (err) { m.querySelector('[data-err]').textContent = err; return; }
          if (confirmName && f.name.value.trim() !== confirmName.trim()) { m.querySelector('[data-err]').textContent = `Escribí ${confirmName} para confirmar.`; return; }
          result = f.note.value.trim();
          close();
        };
        m.querySelector('[data-modal=cancel]').onclick = close;
      },
      onClose: () => resolve(result),
    });
  });
}

// ---------- acciones ----------

registerActions({
  'claim-save': async () => {
    const form = document.querySelector('[data-form=claim]');
    const c = readClaim(form);
    try {
      // retirado o rechazado: al editar vuelve a borrador
      if (['withdrawn', 'rejected'].includes(c.status)) { app.artist.claim = c; await app.artist.reopenClaim(c); }
      else await app.artist.saveClaim(c);
      app.toast('Borrador guardado');
      app.render();
    } catch (err) { app.toast(err.message); }
  },
  // "Retirar solicitud y editar": pending → withdrawn → draft (cuenta como intento)
  'claim-withdraw': async () => {
    const c = await app.artist.fresh() || app.artist.claim;
    if (!c || c.status !== 'pending') { app.render(); return; }
    await app.artist.withdrawClaim(c);
    await app.artist.reopenClaim(c);
    claimErrors = {};
    app.toast('Retiraste la solicitud. Podés editarla y volver a enviarla.');
    app.render();
  },
  'claim-reopen': async () => {
    const c = app.artist.claim;
    if (c) await app.artist.reopenClaim(c);
    claimErrors = {};
    app.render();
  },
  'claim-clear-target': () => { app.ui.claimTarget = null; app.render(); },
  // desde un perfil am: del catálogo de prueba (sólo cuentas Artista; un Oyente ve la invitación a cambiar)
  'claim-catalog': (el) => {
    app.ui.claimTarget = { kind: 'catalog', key: el.dataset.key, name: el.dataset.name };
    claimErrors = {};
    app.go('claim');
  },
  'copy-code': async (el) => {
    try { await navigator.clipboard.writeText(el.dataset.code); app.toast('Código copiado'); } catch { app.toast(el.dataset.code); }
  },
  'new-release': async () => {
    const r = app.artist.newRelease(app.profile);
    await app.artist.saveRelease(r);
    releaseErrors = {};
    app.go('release', r.id);
  },
  'open-release': (el) => { releaseErrors = {}; app.go('release', el.dataset.id); },
  'release-save': () => persistRelease(false),
  'release-delete': async () => {
    const r = currentRelease();
    if (!(await confirmModal({ title: '¿Eliminar el lanzamiento?', text: 'Se borran el borrador y su audio subido.', ok: 'Eliminar', danger: true }))) return;
    for (const rt of r.tracks) { const t = app.library.byId.get(rt.trackId); if (t?.hidden) await app.library.remove(t.id); }
    await app.artist.deleteRelease(r.id);
    app.go('studio');
  },
  'release-withdraw': async () => {
    const r = currentRelease();
    r.status = 'draft';
    await app.artist.saveRelease(r);
    app.render();
  },
  'release-play': () => {
    const r = currentRelease();
    app.playGroup(r.tracks.map((rt) => app.library.byId.get(rt.trackId)).filter(Boolean), false);
  },
  'release-track-play': (el) => {
    const t = app.library.byId.get(el.dataset.track);
    if (t) app.player.playList([t], 0);
  },
  'release-track-up': async (el) => {
    const r = await persistRelease();
    const i = +el.dataset.index;
    if (i > 0) [r.tracks[i - 1], r.tracks[i]] = [r.tracks[i], r.tracks[i - 1]];
    await app.artist.saveRelease(r);
    app.render();
  },
  'release-track-remove': async (el) => {
    const r = await persistRelease();
    const [rt] = r.tracks.splice(+el.dataset.index, 1);
    const t = app.library.byId.get(rt.trackId);
    if (t?.hidden && !app.artist.releases.some((x) => x.tracks.some((y) => y.trackId === t.id))) await app.library.remove(t.id);
    await app.artist.saveRelease(r);
    app.render();
  },
  // ----- cobros -----
  'tiers-save': async () => {
    const f = document.querySelector('[data-form=tiers]');
    const r = readTierDrafts(f);
    f.querySelector('[data-tiers-error]').textContent = r.error || '';
    if (r.error) return;
    const c = app.artist.claim;
    c.tierDrafts = r.drafts; // los `benefits` viejos se conservan como dato histórico (no se muestran)
    try { await app.artist.saveClaim(c); app.toast('Niveles guardados'); } catch (err) { app.toast(err.message); }
  },
  'tiers-preview': () => { app.ui.apOpenSupport = true; app.go('artistpage', `zu:${app.user.uid}`); },
  'tiers-counter': async (el) => {
    const c = app.artist.claim;
    c.tierOptions = { ...(c.tierOptions || {}), showCounter: !!el.checked };
    await app.artist.saveClaim(c);
  },
  'tiers-import': () => document.querySelector('[data-form=tiers-live]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
  // ----- niveles con servidor (sin ejecutar en este equipo) -----
  'tier-save': async (el) => {
    const s = +el.dataset.slot, f = document.querySelector('[data-form=tiers-live]');
    const own = (app.ui.ownTiers || []).find((t) => t.slot === s && t.state !== 'archived');
    const name = f[`s${s}_name`].value.trim(), description = f[`s${s}_description`].value.trim().slice(0, 140);
    const priceCents = parseAmount(f[`s${s}_price`].value);
    if (name.length < 2 || name.length > TIER_NAME_MAX || /[<>]/.test(name)) { app.toast(`El nombre del nivel tiene que tener entre 2 y ${TIER_NAME_MAX} caracteres.`); return; }
    const prices = [1, 2, 3].map((x) => (x === s ? priceCents : (app.ui.ownTiers || []).find((t) => t.slot === x && t.state !== 'archived')?.amountCents ?? null));
    const perr = Number.isFinite(priceCents) ? priceRule(prices) : 'El precio de un nivel tiene que estar entre 2,99 € y 99,99 €.';
    if (perr) { app.toast(perr); return; }
    const body = { name, description, priceCents };
    const before = own?.publishedPriceCents ?? own?.amountCents;
    if (own && +own.subscribers > 0 && before && before !== priceCents) {
      const migrate = await new Promise((resolve) => {
        let res = null;
        openModal(`<div class="confirm"><h3>Cambiar precio</h3>
          <p class="muted">El precio de ${esc(name)} pasa de ${eur(before)} a ${eur(priceCents)}. Quienes ya están suscriptos conservan el precio anterior. Si querés aplicarlo también a ellos, se les avisa con 30 días de anticipación.</p>
          <label class="check"><input type="checkbox" data-migrate><span>Aplicar también a quienes ya están suscriptos</span></label>
          <div class="confirm-actions"><button class="btn-glass lit" data-modal="cancel">Cancelar</button><button class="btn-primary lit" data-modal="ok">Guardar</button></div></div>`, {
          cls: 'sm',
          onMount: (m, close) => { m.querySelector('[data-modal=ok]').onclick = () => { res = m.querySelector('[data-migrate]').checked; close(); }; m.querySelector('[data-modal=cancel]').onclick = close; },
          onClose: () => resolve(res),
        });
      });
      if (migrate === null) return;
      body.migrateExisting = migrate;
    }
    try { await tierCall(s, body, !own); app.toast('Niveles guardados'); mountCobros(document); } catch (err) { app.toast(err.message); }
  },
  'tier-state': async (el) => {
    const s = +el.dataset.slot, to = el.dataset.to;
    const own = (app.ui.ownTiers || []).find((t) => t.slot === s && t.state !== 'archived');
    const name = own?.name || SLOT_NAMES[s - 1];
    if (to === 'published') {
      if (app.artist.claim?.verification !== 'full') { app.toast('Tu perfil tiene que estar verificado para publicar niveles.'); return; }
      if (!own) { app.toast('Guardá el nivel antes de publicarlo.'); return; }
      if (own.state === 'draft' && !(await confirmModal({ title: 'Publicar nivel', text: `Al publicar, los oyentes podrán suscribirse a ${esc(name)} por ${eur(own.amountCents)} / mes.`, ok: 'Publicar' }))) return;
    } else if (to === 'closed_to_new' && !(await confirmModal({ title: 'Cerrar a nuevas altas', text: `Nadie nuevo podrá suscribirse a ${esc(name)}. Quienes ya están suscriptos conservan sus beneficios.`, ok: 'Cerrar a nuevas altas' }))) return;
    try { await tierCall(s, { state: to }, false); mountCobros(document); } catch (err) { app.toast(/artist_not_ready/.test(err.message) ? 'Este artista todavía no puede recibir apoyo.' : err.message); }
  },
  'tier-delete': async (el) => {
    const s = +el.dataset.slot;
    const own = (app.ui.ownTiers || []).find((t) => t.slot === s && t.state !== 'archived');
    if (!own) return;
    if (!canDeleteTier(own)) { app.toast('Este nivel tiene suscriptores. Podés cerrarlo a nuevas altas.'); return; }
    if (!(await confirmModal({ title: 'Eliminar nivel', text: `¿Eliminar el nivel ${esc(own.name)}? Esta acción no se puede deshacer.`, ok: 'Eliminar', danger: true }))) return;
    try { await payments.call(`/api/artists/me/tiers/${s}`, { method: 'DELETE', auth: app.auth }); mountCobros(document); } catch (err) { app.toast(err.message); }
  },
  'connect-onboard': async () => {
    try { const { url } = await payments.onboard(app.auth); if (url) location.href = url; } catch (err) { app.toast(err.message); }
  },
  'connect-earnings': async () => {
    try {
      const e = await payments.earnings(app.auth);
      const { openModal } = await import('../ui/modal.js');
      openModal(`<div class="modal-head"><h2>Ingresos</h2></div><div class="earn-grid">${[['Bruto', e.grossCents], ['Comisión de ZUENA', e.platformFeeCents], ['Neto', e.netCents], ['Retenido', e.heldCents], ['Disponible', e.availableCents]].map(([l, v]) => `<div class="glass-soft stat"><b>${eur(v || 0)}</b><span>${l}</span></div>`).join('')}</div>
        ${e.stripeMode === 'test' ? '<p class="pay-test">Modo de prueba: los pagos no son reales.</p>' : ''}`, { label: 'Ingresos' });
    } catch (err) { app.toast(err.message); }
  },
  // ----- estrenos y publicados (Requisitos §5.5 y §7.2) -----
  'release-reschedule': async () => {
    const r = currentRelease();
    const at = fromLocalInput(releaseForm()?.premiereAt?.value);
    if (r.premiereAt - Date.now() <= RESCHEDULE_LOCK_MS) { app.toast('Falta menos de una hora: ya no se puede mover. Podés cancelar el estreno.'); return; }
    const err = premiereError(at);
    if (err) { releaseErrors = { premiereAt: err }; app.render(); return; }
    r.premiereAt = at;
    r.releaseDate = new Date(at).toISOString().slice(0, 10);
    await saveRel(r);
    if (postOf(r)) await upsertReleasePost(r);
    releaseErrors = {};
    app.toast(`Estreno movido al ${premiereLabel(at)}`);
    app.render();
  },
  'release-publish-now': async () => {
    const r = currentRelease();
    if (!(await confirmModal({ title: '¿Publicar ahora?', text: `«${r.title}» sale ya, sin esperar al estreno.`, ok: 'Publicar ahora' }))) return;
    await publishRelease(r);
    app.toast(`«${r.title}» publicado${localNote()}`);
    app.render();
  },
  'release-cancel-premiere': async () => {
    const r = currentRelease();
    if (!(await confirmModal({ title: '¿Cancelar el estreno?', text: 'Vuelve a borrador; la cuenta regresiva y el anuncio del feed desaparecen. Si no cambiás el contenido, no hace falta otra revisión.', ok: 'Cancelar estreno', cancel: 'Volver', danger: true }))) return;
    r.status = 'draft';
    await saveRel(r);
    if (postOf(r)) await app.posts.remove(`rel-${r.id}`);
    app.toast('Estreno cancelado');
    app.render();
  },
  'release-hide': async () => {
    const r = currentRelease();
    if (!(await confirmModal({ title: '¿Ocultar el lanzamiento?', text: 'Deja de verse en ZUENA y en el feed. Las playlists de otros lo muestran como no disponible. Podés volver a publicarlo cuando quieras.', ok: 'Ocultar' }))) return;
    r.status = 'hidden';
    await saveRel(r);
    const post = postOf(r);
    if (post?.pinned) await app.posts.pin(post.id, r.uid, false);
    app.toast('Lanzamiento oculto');
    app.render();
  },
  'release-republish': async () => {
    const r = currentRelease();
    r.status = 'published';
    await saveRel(r);
    app.toast(`«${r.title}» publicado de nuevo`);
    app.render();
  },
  'release-retire': async () => {
    const r = currentRelease();
    const typed = await promptModal({ title: 'Retirar definitivamente', label: `Se borra el audio y no se puede deshacer. Escribí «${r.title}» para confirmar.`, ok: 'Retirar', placeholder: r.title });
    if (typed === null) return;
    if (typed.trim() !== r.title.trim()) { app.toast('El título no coincide: no se retiró'); return; }
    for (const rt of r.tracks) if (app.library.byId.get(rt.trackId)) await app.library.remove(rt.trackId);
    r.status = 'withdrawn';
    r.withdrawn = Date.now();
    r.cover = null;
    await saveRel(r);
    const post = postOf(r);
    if (post?.pinned) await app.posts.pin(post.id, r.uid, false);
    app.toast('Lanzamiento retirado');
    app.render();
  },
  'release-pin': async () => {
    const r = currentRelease();
    const post = postOf(r);
    if (!post) return;
    const prev = app.posts.pinnedOf(r.uid);
    if (!post.pinned && prev && prev.id !== post.id && !(await confirmModal({ title: '¿Reemplazar el anclado?', text: 'Ya tenés otra publicación anclada. Se reemplaza por este lanzamiento.', ok: 'Reemplazar' }))) return;
    await app.posts.pin(post.id, r.uid, !post.pinned);
    app.toast(post.pinned ? 'Anclado en tu feed' : 'Desanclado');
    app.render();
  },
  'review-filter': (el) => { app.ui.reviewFilter = el.dataset.f; app.render(); },
  'review-ev': async (el) => {
    if (!canReview()) return;
    await app.artist.markEvidence(el.dataset.uid, +el.dataset.i, el.dataset.st, reviewer());
    app.render();
  },
  // aprobar / pedir cambios / rechazar / revocar. El segundo revisor que llega tarde ve "ya fue resuelto".
  'review-claim': async (el) => {
    if (!canReview() || el.getAttribute('aria-busy') === 'true') return;
    const op = el.dataset.op, uid = el.dataset.uid;
    let note = '';
    if (op !== 'approve') {
      const titles = { needs_info: ['Pedir cambios', 'Enviar'], reject: ['Motivo del rechazo', 'Rechazar'], revoke: ['Revocar verificación', 'Revocar'] };
      const claim = op === 'revoke' ? await app.artist.fresh(uid) || (await app.artist.reviewQueue('approved')).list.find((c) => c.uid === uid) : null;
      note = await reviewNoteModal({ title: titles[op][0], ok: titles[op][1], confirmName: op === 'revoke' ? claim?.artistName || '' : '' });
      if (note === null) return;
    }
    el.setAttribute('aria-busy', 'true');
    const r = await app.artist.reviewClaim(uid, op, { note, reviewer: reviewer(), expected: el.dataset.expected });
    el.removeAttribute('aria-busy');
    if (r.error) { app.toast(r.error); app.render(); return; }
    if (r.claim.uid === app.user?.uid && syncAccount(app.profile, r.claim)) {
      await saveProfile(app.auth, app.profile);
      app.renderSidebar();
    }
    if (op === 'revoke') { await app.releases.load(); app.releases.broadcast(); }
    app.toast({ approve: r.claim.verification === 'full' ? 'Artista verificado' : 'Verificado en este equipo', needs_info: 'Se pidieron cambios', reject: 'Reclamo rechazado', revoke: 'Verificación revocada' }[op]);
    app.render();
  },
  'review-release': async (el) => {
    const r = (await app.artist.pendingReleases()).find((x) => x.id === el.dataset.id);
    if (!r) return;
    if (el.dataset.ok === '1') {
      const rel = app.artist.getRelease(r.id) || r;
      rel.reviewApproved = true;
      if (statusOnApprove(rel) === 'scheduled') {
        rel.status = 'scheduled';
        await saveRel(rel);
        if (rel.announce && rel.postMode !== 'none') await upsertReleasePost(rel);
        if (rel.announce && rel.pinOnPublish) await app.posts.pin(`rel-${rel.id}`, rel.uid);
        app.toast(`Estreno de «${rel.title}» programado para el ${premiereLabel(rel.premiereAt)}`);
      } else {
        const late = rel.releaseMode === 'scheduled';
        await publishRelease(rel);
        app.toast(late ? 'El estreno programado ya había pasado: se publicó al aprobarse.' : `«${rel.title}» publicado${localNote()}`);
      }
    } else {
      const note = await promptModal({ title: 'Cambios necesarios', label: 'Se le muestra al artista', ok: 'Enviar', placeholder: 'La portada tiene texto ilegible' });
      if (note === null) return;
      const rel = app.artist.getRelease(r.id) || r;
      rel.status = 'rejected';
      rel.reviewNote = note;
      await saveRel(rel);
    }
    app.render();
  },
});

// formularios (submit) y entradas propias de estas vistas
let claimBusy = false;
export async function submitClaim(form) {
  if (claimBusy) return; // doble clic: un solo envío
  claimBusy = true;
  const btn = form.querySelector('[data-claim-submit]');
  btn?.setAttribute('aria-busy', 'true');
  try {
    const c = readClaim(form);
    app.artist.claim = app.artist.claim || c;
    // retirado o rechazado: se reabre (→ borrador) antes de volver a enviar
    if (['withdrawn', 'rejected'].includes(c.status)) await app.artist.reopenClaim(c);
    claimErrors = (await app.artist.submitClaim(c, { catalogNames: catalogNames(), catalogExists })) || {};
    if (Object.keys(claimErrors).length) {
      if (!claimErrors.offline && ['draft', 'needs_info'].includes(c.status)) await app.artist.saveClaim(c).catch(() => {});
      app.render();
      document.querySelector('.field-error:not(:empty), .notice.bad[role=alert]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      app.toast(claimErrors.form || 'Revisá los campos marcados');
      return;
    }
    app.ui.claimTarget = null;
    app.toast('Solicitud enviada. Te avisamos acá cuando haya novedades.');
    app.render();
  } catch (err) {
    app.toast(err.message);
  } finally {
    claimBusy = false;
    btn?.removeAttribute('aria-busy');
  }
}

export async function submitRelease(form) {
  const r = currentRelease();
  // la verificación pudo revocarse mientras se editaba (§9)
  if (!(await app.artist.stillVerified())) { app.toast('Tu verificación ya no está activa. No se pudo guardar el lanzamiento.'); return; }
  readRelease(form, r);
  const tracks = r.tracks.map((rt) => app.library.byId.get(rt.trackId)).filter(Boolean);
  r.verifiedName = app.artist.claim?.artistName || '';
  releaseErrors = validateRelease(r, tracks);
  if (Object.keys(releaseErrors).length) {
    await app.artist.saveRelease(r);
    app.render();
    document.querySelector('.field-error:not(:empty)')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    app.toast('Hay cosas para corregir antes de enviar');
    return;
  }
  r.status = 'review';
  r.submitted = Date.now();
  r.reviewNote = '';
  await app.artist.saveRelease(r);
  app.toast('Lanzamiento enviado a revisión');
  app.render();
}

export function bindArtistInputs(root) {
  root.querySelectorAll('[data-genre]').forEach((b) => {
    b.onclick = () => {
      const on = b.parentElement.querySelectorAll('.on').length;
      if (!b.classList.contains('on') && on >= 3) { app.toast('Máximo 3 géneros'); return; }
      b.classList.toggle('on');
    };
  });
  root.querySelectorAll('[data-rtype]').forEach((b) => {
    b.onclick = async () => {
      const r = await persistRelease();
      r.type = b.dataset.rtype;
      await app.artist.saveRelease(r);
      app.render();
    };
  });
  root.querySelectorAll('[data-rmode]').forEach((b) => {
    b.onclick = async () => {
      const r = await persistRelease();
      r.releaseMode = b.dataset.rmode;
      // propuesta inicial: mañana a las 20:00
      if (r.releaseMode === 'scheduled' && !Number.isFinite(r.premiereAt)) { const d = new Date(Date.now() + 864e5); d.setHours(20, 0, 0, 0); r.premiereAt = d.getTime(); }
      await app.artist.saveRelease(r);
      app.render();
    };
  });
  root.querySelector('[data-release-cover]')?.addEventListener('change', (e) => { const f = e.target.files[0]; if (f) setReleaseCover(f); });
  root.querySelector('[data-release-audio]')?.addEventListener('change', (e) => { addReleaseAudio(e.target.files); });
  const dz = root.querySelector('.dropzone');
  if (dz) {
    dz.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); dz.classList.remove('over'); addReleaseAudio(e.dataTransfer.files); });
  }
}
