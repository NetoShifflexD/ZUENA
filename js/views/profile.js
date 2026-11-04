// Perfil social: portada, foto, nombre, bio, tema, color y tipografía propios, y publicaciones.
import { app, registerActions } from '../app.js';
import { icon } from '../ui/icons.js';
import { esc, hueOf } from '../ui/format.js';
import { openModal, confirmModal } from '../ui/modal.js';
import { PRESETS, FONTS, MODES, modeOf, loadFont, fontStack, themeStyle, resolveTheme } from '../theme/theme.js';
import { USERNAME_RE, usernameTaken, processImage, saveProfile, setAccountType, syncAccount } from '../data/profiles.js';
import { claimStatus, inferAccountType, needsRoleChoice } from '../data/artist.js';
import { payments } from '../data/payments.js';
import { INTENDED_ROLE_KEY } from './welcome.js';
import { avatar, playlistCard, trackList, tick } from './common.js';
import { postCard, releaseCard } from './feed.js';
import { viewArtistPage } from './artistpage.js';

function hours(sec) {
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  return `${(sec / 3600).toFixed(sec < 36000 ? 1 : 0)} h`;
}

// etiqueta de la cabecera propia. "Artista · sin verificar" es privada: sólo la ve la propia cuenta
// (profileHeader sólo dibuja el perfil propio y la vista previa del editor).
const roleLabel = (p, verified) => {
  const ownerTag = app.auth?.isOwner && p?.uid === app.user?.uid ? 'Propietario · Administrador · ' : '';
  return `${ownerTag}${verified ? `${icon('verified', 'verified-ico')} Artista verificado` : p.accountType === 'artist' ? 'Artista · sin verificar' : 'Oyente'}`;
};

export function profileHeader(p, { preview = false } = {}) {
  loadFont(p.font);
  const verified = p.role === 'artist';
  const isOwner = Boolean(app.auth?.isOwner && p?.uid === app.user?.uid);
  const st = app.stats.data || { seconds: 0, plays: {} };
  const plays = Object.values(st.plays).reduce((a, b) => a + b, 0);
  const postsCount = app.posts.byUser(p.uid).length;
  // perfil abierto: cabecera editorial estructurada con tarjeta de identidad y métricas
  if (!preview) {
    const kind = p.cover ? 'cover' : p.avatar ? 'photo' : 'none';
    const media = kind === 'cover' ? `<div class="pv2-media" aria-hidden="true"><img src="${esc(p.cover)}" alt="" decoding="async"></div>`
      : `<div class="pv2-media none" style="--h:${hueOf(p.uid || p.displayName)}" aria-hidden="true"></div>`;
    return `<header class="pv2-hero kind-${kind}">${media}
      <div class="pv2-card">
        <div class="pv2-top">
          <div class="pv2-photo">${avatar(p, 'xl')}</div>
          <div class="community-profile-identity">
            <p class="eyebrow"><span class="pv2-role-pill${isOwner ? ' is-owner' : ''}">${roleLabel(p, verified)}</span></p>
            <h1 class="profile-name" style="font-family:${esc(fontStack(p.font))}">${esc(p.displayName)}${tick(verified, 'Artista verificado')}</h1>
            <p class="profile-handle">@${esc(p.username)}${app.user?.email ? ` · <span class="profile-email">${esc(app.user.email)}</span>` : ''}</p>
            ${p.bio ? `<p class="profile-bio">${esc(p.bio)}</p>` : '<p class="profile-bio muted">Agregá una bio desde Editar perfil para contar qué música te mueve.</p>'}
          </div>
          <div class="hero-actions">
            <button class="btn-primary lit" data-action="edit-profile">${icon('edit')}Editar perfil</button>
            ${verified ? `<button class="btn-glass lit" data-action="nav" data-view="studio">${icon('disc')}Estudio</button>` : ''}
            ${isOwner || app.auth?.isAdmin ? `<button class="btn-glass lit" data-action="nav" data-view="review">${icon('shield')}Moderación</button>` : ''}
          </div>
        </div>
        <div class="profile-stats">
          <div class="profile-stat-card"><b>${app.playlists.mine.length}</b><span>Playlists</span></div>
          <div class="profile-stat-card"><b>${plays}</b><span>Reproducciones</span></div>
          <div class="profile-stat-card"><b>${hours(st.seconds)}</b><span>Tiempo escuchado</span></div>
          <div class="profile-stat-card"><b>${postsCount}</b><span>Publicaciones</span></div>
        </div>
      </div>
    </header>`;
  }
  return `
    <div class="profile-banner ${p.cover ? 'has-img' : ''}">${p.cover ? `<img src="${esc(p.cover)}" alt="">` : ''}</div>
    <div class="profile-head">
      ${avatar(p, 'xl profile-avatar')}
      <div class="profile-id">
        <p class="eyebrow">${roleLabel(p, verified)}</p>
        <h1 class="profile-name" style="font-family:${esc(fontStack(p.font))}">${esc(p.displayName)}${tick(verified, 'Artista verificado')}</h1>
        <p class="profile-handle">@${esc(p.username)}</p>
        ${p.bio ? `<p class="profile-bio">${esc(p.bio)}</p>` : ''}
        ${preview ? '' : `<div class="profile-stats">
          <span><b>${app.playlists.mine.length}</b> playlists</span>
          <span><b>${plays}</b> reproducciones</span>
          <span><b>${hours(st.seconds)}</b> escuchadas</span>
          <span><b>${app.posts.byUser(p.uid).length}</b> publicaciones</span>
        </div>`}
      </div>
      ${preview ? '' : `<div class="hero-actions">
        <button class="btn-primary lit" data-action="edit-profile">${icon('edit')}Editar perfil</button>
        ${verified ? `<button class="btn-glass lit" data-action="nav" data-view="studio">${icon('disc')}Estudio</button>` : ''}
      </div>`}
    </div>`;
}

export function viewProfile() {
  const p = app.profile;
  if (!p) return '';
  // un artista verificado ve su perfil público jerárquico (el mismo que ven sus oyentes)
  if (p.role === 'artist' && app.artist.verified) { app.ui.param = `zu:${p.uid}`; return viewArtistPage(); }
  const top = app.stats.top(10).map(([id]) => app.resolve(id)).filter((t) => t && !t.hidden);
  const lists = app.playlists.list.filter((x) => !x.system || x.trackIds.length);
  const releases = app.artist.releases.filter((r) => r.status === 'published' || r.status === 'scheduled');
  return `<section class="profile pv2 community-profile enter" style="${themeStyle(p)};--font-display:${esc(fontStack(p.font))}">
    ${profileHeader(p)}
    <div class="community-profile-layout"><div class="community-profile-main">
    ${artistStepCard(p)}
    ${p.role === 'artist' && releases.length ? `<h2 class="section-title">Lanzamientos</h2>
      <div class="shelf">${releases.map(releaseCard).join('')}</div>` : ''}
    <h2 class="section-title">Publicaciones</h2>
    ${app.posts.byUser(p.uid).length ? `<div class="feed">${app.posts.byUser(p.uid).slice(0, 20).map(postCard).join('')}</div>` : `<div class="glass-soft notice">${icon('edit')}<p>Todavía no publicaste nada. <button class="link small" data-action="nav" data-view="feed">Ir al feed</button></p></div>`}
    <h2 class="section-title">Lo más escuchado</h2>
    ${top.length ? trackList(top) : '<p class="muted">Escuchá un poco de música y tus favoritas van a aparecer acá.</p>'}
    </div><aside class="community-profile-side" aria-label="Tus playlists y tu cuenta">
    <p class="eyebrow">Tu colección</p><h2 class="section-title">Playlists</h2>${lists.length ? `<div class="shelf">${lists.map(playlistCard).join('')}</div>` : `<div class="glass-soft notice">${icon('playlist')}<p>Todavía no armaste playlists. <button class="link small" data-action="new-playlist">Crear la primera</button></p></div>`}
    ${p.role !== 'artist' && p.accountType !== 'artist' ? `<div class="glass-soft notice artist-cta lit">${icon('mic')}<p><b>¿Hacés música?</b> Cambiá tu cuenta a Artista para tener tu perfil de artista y, una vez verificado, subir tus lanzamientos gratis.</p><button class="btn-glass lit" data-action="account-type" data-type="artist" data-press>Cambiar a Artista</button></div>` : ''}
    </aside></div>
  </section>`;
}

// ---------- tipo de cuenta (Requisitos/Perfiles con rol y reclamo de artista §3) ----------

// tarjeta de siguiente paso para un Artista sin verificar: invitación a verificar o estado del reclamo
function artistStepCard(p) {
  if (p.accountType !== 'artist' || app.artist.verified) return '';
  const c = app.artist.claim;
  if (c && c.status !== 'withdrawn' && c.status !== 'expired') {
    const st = claimStatus(c.status);
    return `<div class="glass-soft notice prf-step lit" data-reveal="fadeUp">${icon('mic')}<p><b>Tu solicitud de verificación</b> <span class="pill ${st.tone}">${esc(st.label)}</span></p>
      <button class="btn-glass lit" data-action="nav" data-view="claim" data-press>Ver mi solicitud</button></div>`;
  }
  if (p.verifyCardHidden) return '';
  return `<div class="glass-soft notice prf-step lit" data-reveal="fadeUp">${icon('verified')}<p><b>Verificá tu perfil de artista</b></p>
    <div class="row-btns"><button class="btn-primary lit" data-action="nav" data-view="claim" data-press>Empezar</button><button class="btn-glass lit" data-action="verify-later" data-press>Más tarde</button></div></div>`;
}

const ROLE_CARDS = [
  { type: 'listener', title: 'Oyente', text: 'Escuchá, armá playlists, seguí artistas y participá en el feed.', icon: 'headphones',
    perks: ['Escuchar, playlists y tu biblioteca', 'Seguir, dar me gusta y responder en el feed'] },
  { type: 'artist', title: 'Artista', text: 'Todo lo del oyente, más tu perfil de artista. Para subir lanzamientos y publicar en el feed tenés que verificar tu perfil. Es gratis.', icon: 'mic',
    perks: ['Todo lo del oyente', 'Niveles de suscripción en borrador', 'Con el perfil verificado: lanzamientos, publicaciones y tilde'] },
];

// rol elegido en la landing (welcome.js); se usa una vez para preseleccionar y se borra
function intendedRole() {
  try {
    const v = sessionStorage.getItem(INTENDED_ROLE_KEY);
    sessionStorage.removeItem(INTENDED_ROLE_KEY);
    return v === 'listener' || v === 'artist' ? v : null;
  } catch { return null; }
}

// "¿Cómo vas a usar ZUENA?": modal no descartable antes de "Armá tu perfil". Guarda accountType.
export function chooseAccountType() {
  return new Promise((resolve) => {
    let pick = intendedRole();
    const card = (r) => `<button type="button" class="prf-role lit ${pick === r.type ? 'on' : ''}" role="radio" aria-checked="${pick === r.type}" tabindex="${pick === r.type || (!pick && r.type === 'listener') ? 0 : -1}" data-role="${r.type}" data-press>
        <span class="prf-role-ico">${icon(r.icon)}</span>
        <span class="prf-role-title">${r.title}</span>
        <span class="prf-role-text">${r.text}</span>
        <span class="prf-role-perks"><span class="prf-role-k">Qué cambia</span>${r.perks.map((x) => `<span>${icon('check')}${x}</span>`).join('')}</span>
      </button>`;
    const body = () => `<div class="prf-choose">
        <header><h2>¿Cómo vas a usar ZUENA?</h2><p class="muted">Elegí una opción. Podés cambiarla después desde tu perfil.</p></header>
        <div class="prf-roles" role="radiogroup" aria-label="Tipo de cuenta">${ROLE_CARDS.map(card).join('')}</div>
        <p class="hint prf-foot">Nadie más ve que elegiste Artista hasta que tu perfil esté verificado.</p>
        <div class="confirm-actions"><button type="button" class="btn-primary lit" data-continue ${pick ? '' : 'disabled'} data-press>Continuar</button></div>
      </div>`;
    openModal(body(), {
      cls: 'prf-modal',
      dismissable: false,
      onMount: (m, close) => {
        const select = (type, focus = true) => {
          pick = type;
          m.querySelectorAll('[data-role]').forEach((b) => {
            const on = b.dataset.role === type;
            b.classList.toggle('on', on);
            b.setAttribute('aria-checked', String(on));
            b.tabIndex = on ? 0 : -1;
            if (on && focus) b.focus();
          });
          m.querySelector('[data-continue]').disabled = false;
        };
        m.querySelectorAll('[data-role]').forEach((b) => { b.onclick = () => select(b.dataset.role); });
        m.querySelector('.prf-roles').addEventListener('keydown', (e) => {
          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
            e.preventDefault();
            const order = ROLE_CARDS.map((r) => r.type);
            const i = order.indexOf(pick ?? e.target.dataset.role);
            select(order[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : order.length - 1)) % order.length]);
          } else if (e.key === 'Enter' && pick) { e.preventDefault(); m.querySelector('[data-continue]').click(); }
        });
        m.querySelector('[data-continue]').onclick = async (e) => {
          if (!pick || e.currentTarget.getAttribute('aria-busy') === 'true') return;
          e.currentTarget.setAttribute('aria-busy', 'true');
          await setAccountType(app.auth, app.profile, pick);
          close();
        };
      },
      onClose: () => resolve(pick),
    });
  });
}

// Oyente ↔ Artista (§3.3). Un verificado sólo deja de serlo con "Dejar de ser artista".
export async function changeAccountType(type) {
  const p = app.profile;
  if (!p || p.accountType === type) return false;
  if (type === 'artist') {
    await setAccountType(app.auth, p, 'artist');
    app.toast('Tu cuenta ahora es de artista. Verificá tu perfil para publicar.');
    return true;
  }
  if (app.artist.verified) return leaveArtist();
  const c = app.artist.claim;
  if (c && (c.status === 'pending' || c.status === 'needs_info')) {
    if (!(await confirmModal({ title: 'Cambiar a oyente', text: 'Si cambiás a oyente se retira tu solicitud de verificación. ¿Querés continuar?', ok: 'Confirmar', cancel: 'Cancelar' }))) return false;
    await app.artist.withdrawClaim(c);
  }
  await setAccountType(app.auth, p, 'listener');
  app.toast('Tu cuenta ahora es de oyente.');
  return true;
}

// "Dejar de ser artista": sin estrenos programados ni suscriptores activos, y escribiendo el nombre artístico
export async function leaveArtist() {
  const c = app.artist.claim;
  if (!c || c.status !== 'approved') return false;
  if (app.artist.releases.some((r) => r.status === 'scheduled')) { app.toast('Antes de dejar de ser artista tenés que cancelar tus estrenos programados.'); return false; }
  // con servidor de pagos: no se puede con suscriptores activos (los cuenta el servidor)
  if (await payments.health()) {
    const own = await payments.call('/api/artists/me/tiers', { auth: app.auth }).catch(() => null);
    if ((own?.tiers || []).some((t) => +t.subscribers > 0)) { app.toast('Tenés suscriptores activos. Escribinos para cerrar tus niveles antes de dejar de ser artista.'); return false; }
  }
  const name = c.artistName || '';
  const ok = await new Promise((resolve) => {
    let result = false;
    openModal(`<form class="confirm" novalidate>
        <h3>Dejar de ser artista</h3>
        <p class="muted">Tus lanzamientos publicados se van a ocultar y vas a perder la verificación. Para confirmar, escribí tu nombre artístico: <b>${esc(name)}</b>.</p>
        <label class="field"><span>Nombre artístico</span><input class="input" name="v" maxlength="60" autocomplete="off"></label>
        <div class="confirm-actions"><button type="button" class="btn-glass lit" data-modal="cancel">Cancelar</button><button class="btn-primary lit danger" disabled data-press>Dejar de ser artista</button></div>
      </form>`, {
      cls: 'sm',
      onMount: (m, close) => {
        const input = m.querySelector('input'), btn = m.querySelector('.btn-primary');
        input.oninput = () => { btn.disabled = input.value.trim() !== name.trim(); };
        m.querySelector('form').onsubmit = (e) => { e.preventDefault(); if (input.value.trim() !== name.trim()) return; result = true; close(); };
        m.querySelector('[data-modal=cancel]').onclick = close;
      },
      onClose: () => resolve(result),
    });
  });
  if (!ok) return false;
  await app.artist.leaveArtist();
  syncAccount(app.profile, app.artist.claim);
  await setAccountType(app.auth, app.profile, 'listener');
  await app.releases?.load?.();
  app.releases?.broadcast?.();
  app.renderSidebar?.();
  app.toast('Tu cuenta ahora es de oyente.');
  return true;
}

// sección "Tipo de cuenta" del editor de perfil
function accountTypeField(p) {
  const verified = app.artist.verified;
  const cur = p.accountType || inferAccountType(p, app.artist.claim);
  if (verified) {
    return `<div class="field prf-type"><span>Tipo de cuenta</span>
      <p class="hint">${icon('verified', 'verified-ico')} Artista verificado${app.artist.localOnly ? ' en este equipo' : ''}</p>
      <button type="button" class="btn-glass danger lit" data-leave-artist data-press>Dejar de ser artista</button></div>`;
  }
  return `<div class="field prf-type"><span>Tipo de cuenta</span>
    <div class="seg two">${[['listener', 'Oyente'], ['artist', 'Artista']].map(([v, l]) => `<button type="button" class="seg-btn lit ${cur === v ? 'on' : ''}" data-acct="${v}" aria-pressed="${cur === v}">${l}</button>`).join('')}</div>
    ${cur === 'artist' ? '<span class="hint">Artista · sin verificar. Nadie más lo ve hasta que tu perfil esté verificado.</span>' : ''}</div>`;
}

// ---------- editor ----------

// Cuenta nueva: primero "¿Cómo vas a usar ZUENA?" (no se salta con "Después"), después "Armá tu perfil".
export async function profileEditor({ welcome = false } = {}) {
  if (welcome && needsRoleChoice(app.profile)) await chooseAccountType();
  return editorModal({ welcome });
}

function editorModal({ welcome = false } = {}) {
  return new Promise((resolve) => {
    const draft = { ...app.profile };
    let errors = {};
    let saved = false;

    const preview = () => `<div class="pe-preview profile" style="${themeStyle(draft)}">${profileHeader(draft, { preview: true })}</div>`;

    const body = () => `
      <form class="pe community-editor" novalidate>
        <header class="pe-head">
          <div><h3>${welcome ? 'Armá tu perfil' : 'Editar perfil'}</h3>${welcome ? '<p class="muted">Así te van a ver. Podés cambiarlo cuando quieras.</p>' : ''}</div>
          ${welcome ? '' : `<button type="button" class="btn-icon lit sm" data-close>${icon('close')}</button>`}
        </header>
        <div class="pe-body">
          <div class="pe-live">${preview()}</div>
          <div class="pe-fields">
            <div class="pe-media">
              <label class="btn-glass lit">${icon('camera')}Foto<input type="file" accept="image/*" hidden data-img="avatar"></label>
              <label class="btn-glass lit">${icon('image')}Portada<input type="file" accept="image/*" hidden data-img="cover"></label>
              ${draft.avatar || draft.cover ? '<button type="button" class="btn-glass lit" data-clear-img>Quitar imágenes</button>' : ''}
            </div>
            <label class="field"><span>Nombre</span>
              <div class="input-row">
              <input class="input" name="displayName" maxlength="40" value="${esc(draft.displayName)}" required></div>
              <span class="field-error">${esc(errors.displayName || '')}</span></label>
            <label class="field"><span>Usuario</span>
              <div class="input-icon prefix"><span class="at">@</span><input class="input" name="username" maxlength="20" value="${esc(draft.username)}" autocomplete="off"></div>
              <span class="field-error">${esc(errors.username || '')}</span></label>
            <label class="field"><span>Bio</span>
              <textarea class="input" name="bio" rows="3" maxlength="160" placeholder="Contá qué música te mueve">${esc(draft.bio)}</textarea>
              <span class="counter"><b data-count>${draft.bio.length}</b>/160</span></label>
            ${welcome ? '' : accountTypeField(draft)}
            <div class="field"><span>Tema</span>
              <div class="theme-grid">${PRESETS.map((t) => `<button type="button" class="theme-chip lit ${draft.theme === t.id && !draft.accent ? 'on' : ''}" data-theme="${t.id}" style="--a:${t.accent};--b:${t.accent2}" title="${t.name}"><i></i><span>${t.name}</span></button>`).join('')}</div></div>
            <div class="field-row">
              <label class="field"><span>Color propio</span>
                <div class="color-pick"><input type="color" name="accent" value="${resolveTheme(draft).accent}"><span>${esc(draft.accent || 'del tema')}</span>${draft.accent ? '<button type="button" class="link small" data-reset-accent>restablecer</button>' : ''}</div></label>
              <div class="field"><span>Modo</span>
                <div class="seg three">${MODES.map(([v, l]) => `<button type="button" class="seg-btn lit ${modeOf(draft.mode) === v ? 'on' : ''}" data-mode="${v}">${l}</button>`).join('')}</div></div>
            </div>
            <div class="field"><span>Tipografía</span>
              <div class="font-grid">${FONTS.map((f) => { loadFont(f.id); return `<button type="button" class="font-chip lit ${draft.font === f.id ? 'on' : ''}" data-font="${f.id}" style="font-family:${esc(fontStack(f.id))}">${f.label}</button>`; }).join('')}</div></div>
          </div>
        </div>
        <footer class="confirm-actions">
          ${welcome ? '<button type="button" class="btn-glass lit" data-skip>Después</button>' : '<button type="button" class="btn-glass lit" data-close>Cancelar</button>'}
          <button class="btn-primary lit" data-submit>${welcome ? 'Listo, a escuchar' : 'Guardar cambios'}</button>
        </footer>
      </form>`;

    openModal(body(), {
      cls: 'pe-modal',
      dismissable: !welcome,
      onClose: () => resolve(saved),
      onMount: (m, close) => {
        const refreshPreview = () => { m.querySelector('.pe-live').innerHTML = preview(); };
        const paint = () => {
          const scroll = m.querySelector('.pe-fields')?.scrollTop || 0;
          m.innerHTML = body();
          m.querySelector('.pe-fields').scrollTop = scroll;
          bind();
        };
        const bind = () => {
          const form = m.querySelector('form');
          m.querySelectorAll('[data-close]').forEach((b) => { b.onclick = close; });
          m.querySelector('[data-skip]')?.addEventListener('click', async () => {
            app.profile.onboarded = true;
            await saveProfile(app.auth, app.profile);
            close();
          });
          m.querySelectorAll('[data-img]').forEach((inp) => {
            inp.onchange = async () => {
              const f = inp.files[0];
              if (!f) return;
              try {
                draft[inp.dataset.img] = inp.dataset.img === 'avatar' ? await processImage(f, 400, 400) : await processImage(f, 1500, 500, 0.82);
                paint();
              } catch (err) { app.toast(err.message); }
            };
          });
          m.querySelector('[data-clear-img]')?.addEventListener('click', () => { draft.avatar = null; draft.cover = null; paint(); });
          // tipo de cuenta: se aplica al instante (tiene sus propias confirmaciones), no con "Guardar cambios"
          const syncDraft = () => { Object.assign(draft, { role: app.profile.role, accountType: app.profile.accountType, accountTypeSet: app.profile.accountTypeSet }); paint(); app.render?.(); };
          m.querySelectorAll('[data-acct]').forEach((b) => { b.onclick = async () => { if (await changeAccountType(b.dataset.acct)) syncDraft(); }; });
          m.querySelector('[data-leave-artist]')?.addEventListener('click', async () => { if (await leaveArtist()) syncDraft(); });
          form.addEventListener('input', (e) => {
            const t = e.target;
            if (t.name === 'displayName') draft.displayName = t.value;
            else if (t.name === 'username') { t.value = t.value.toLowerCase().replace(/[^a-z0-9._]/g, ''); draft.username = t.value; }
            else if (t.name === 'bio') { draft.bio = t.value; m.querySelector('[data-count]').textContent = t.value.length; }
            else if (t.name === 'accent') { draft.accent = t.value; t.nextElementSibling.textContent = t.value; }
            refreshPreview();
          });
          m.querySelectorAll('[data-theme]').forEach((b) => { b.onclick = () => { draft.theme = b.dataset.theme; draft.accent = null; paint(); }; });
          m.querySelector('[data-reset-accent]')?.addEventListener('click', () => { draft.accent = null; paint(); });
          m.querySelectorAll('[data-mode]').forEach((b) => { b.onclick = () => { draft.mode = b.dataset.mode || 'light'; paint(); }; });
          m.querySelectorAll('[data-font]').forEach((b) => { b.onclick = () => { draft.font = b.dataset.font; paint(); }; });
          form.onsubmit = async (e) => {
            e.preventDefault();
            errors = {};
            draft.displayName = draft.displayName.trim();
            if (draft.displayName.length < 2) errors.displayName = 'Mínimo 2 caracteres';
            if (!USERNAME_RE.test(draft.username)) errors.username = 'De 3 a 20 caracteres: letras, números, punto o guion bajo';
            else if (await usernameTaken(app.auth, draft.username, draft.uid)) errors.username = 'Ese usuario ya está en uso';
            if (Object.keys(errors).length) { paint(); return; }
            draft.onboarded = true;
            // el rol y el tipo de cuenta no salen del borrador del editor (cambian por su propio flujo)
            const { role, accountType, accountTypeSet, ...rest } = draft;
            Object.assign(app.profile, rest);
            await saveProfile(app.auth, app.profile);
            app.applyUserTheme();
            saved = true;
            close();
            app.toast('Perfil guardado');
          };
        };
        bind();
      },
    });
  });
}

registerActions({
  'edit-profile': () => profileEditor(),
  'account-type': async (el) => { if (await changeAccountType(el.dataset.type)) app.render(); },
  'verify-later': async () => {
    app.profile.verifyCardHidden = true;
    await saveProfile(app.auth, app.profile);
    app.render();
  },
});

