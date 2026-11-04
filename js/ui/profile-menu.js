// Botón redondo de perfil (arriba a la derecha, fuera de la isla) con una burbuja de vidrio que lleva a cada
// sección. Reemplaza al desplegable "Ir a otra sección" que estaba dentro de la isla. Módulo aparte: sólo usa
// lo que expone window.zuena y el DOM de la app. Sin sesión o en la landing no se muestra.
import { icon, logo } from './icons.js';
import { roleBadges } from '../views/common.js';
import { ZUENA_OFFICIAL_UID } from '../config.js';

const OWNER_UID = 'bf3b1550-da87-4443-a8ba-0ae542fed5dd';

const ITEMS = [
  ['home', 'Inicio', 'home'], ['explore', 'Explorar', 'compass'], ['feed', 'Feed', 'feed'], ['search', 'Buscar', 'search'],
  ['songs', 'Biblioteca', 'library'], ['profile', 'Perfil', 'user'], ['settings', 'Ajustes', 'settings'], ['import', 'Agregar música', 'plus'],
];
const COLS = 4;

// vistas que no se llaman igual que su sección en la burbuja
const SECTION_OF = { albums: 'songs', artists: 'songs', playlists: 'songs', playlist: 'songs', album: 'songs', library: 'songs', likes: 'songs', queue: 'songs', mix: 'home', post: 'feed', podcast: 'explore', creator: 'explore', artistpage: 'explore', claim: 'profile', studio: 'profile', release: 'profile', review: 'profile' };

const whenApp = () => new Promise((resolve) => {
  const check = () => (window.zuena?.auth ? resolve(window.zuena) : setTimeout(check, 120));
  check();
});

const app = await whenApp();

const root = document.createElement('div');
root.className = 'pm';
root.hidden = true;
root.innerHTML = `<button type="button" class="pm-btn" data-press aria-haspopup="true" aria-expanded="false" aria-controls="pm-bubble" aria-label="Tu perfil y secciones"></button>
  <div class="pm-bubble" id="pm-bubble" inert>
    <div class="pm-head"><span class="pm-avatar" aria-hidden="true"></span><div class="pm-id"><b></b><span></span><div class="pm-badges"></div></div></div>
    <nav class="pm-grid" aria-label="Secciones">${ITEMS.map(([id, label, ic], i) => `<button type="button" class="pm-item" data-press data-pm="${id}" style="--i:${i}">${icon(ic)}<span>${label}</span></button>`).join('')}</nav>
    <div class="pm-account">
      <button type="button" class="pm-row" data-press data-pm-account="zuena-profile"><span class="pm-z-ico" aria-hidden="true">${logo()}</span><span>Perfil oficial de ZUENA</span></button>
      <button type="button" class="pm-row" data-press data-pm-account="identity-switch" hidden>${icon('shield')}<span class="js-pm-switch-label">Usar perfil Equipo de Zuena</span></button>
      <button type="button" class="pm-row" data-press data-pm-account="switch">${icon('user')}<span>Cambiar de cuenta</span></button>
      <button type="button" class="pm-row" data-press data-pm-account="logout">${icon('logout')}<span>Cerrar sesión</span></button>
    </div>
  </div>`;
document.body.append(root);

const btn = root.querySelector('.pm-btn');
const bubble = root.querySelector('.pm-bubble');
const items = [...root.querySelectorAll('.pm-item')];
const coreOf = () => document.querySelector('[data-island-core]');
const islandOpen = () => document.getElementById('island')?.classList.contains('open');
let open = false;

const initial = () => (app.profile?.displayName || app.user?.displayName || '?').trim().charAt(0).toUpperCase() || '?';

function avatarInto(el) {
  const url = app.profile?.avatar;
  const key = url || `ph:${initial()}`;
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  el.replaceChildren();
  if (url) {
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.src = url;
    // si la foto no carga queda la inicial
    img.onerror = () => { el.dataset.key = ''; el.textContent = initial(); };
    el.append(img);
  } else el.textContent = initial();
}

function refresh() {
  const visible = !!app.user && !document.body.classList.contains('welcome-open');
  if (root.hidden === visible) root.hidden = !visible;
  if (!visible) { if (open) close(); return; }
  avatarInto(btn);
  avatarInto(root.querySelector('.pm-avatar'));
  root.querySelector('.pm-id b').textContent = app.profile?.displayName || app.user?.displayName || 'Tu cuenta';
  root.querySelector('.pm-id span').textContent = app.profile?.username ? `@${app.profile.username}` : app.user?.email || '';
  const badgesEl = root.querySelector('.pm-badges');
  if (badgesEl) badgesEl.innerHTML = roleBadges(app.profile || app.user, { compact: true });
  const swBtn = root.querySelector('[data-pm-account="identity-switch"]');
  if (swBtn) {
    const canSwitch = Boolean(app.auth?.isOwner || app.auth?.isOfficialTeam || app.auth?.isAdmin);
    swBtn.hidden = !canSwitch;
    if (canSwitch) {
      const isZuena = app.user?.uid === ZUENA_OFFICIAL_UID || app.profile?.username === 'zuena';
      const lbl = swBtn.querySelector('.js-pm-switch-label');
      if (lbl) lbl.textContent = isZuena ? 'Volver a cuenta Dueño (@netostars)' : 'Usar perfil Equipo de Zuena (@zuena)';
    }
  }
}

function markCurrent() {
  const view = app.ui?.panel === 'settings' ? 'settings' : app.ui?.query ? 'search' : app.ui?.view;
  const section = SECTION_OF[view] || view;
  for (const b of items) {
    if (b.dataset.pm === section) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
}

function setOpen(next, { focus = true } = {}) {
  if (open === next) return;
  open = next;
  btn.setAttribute('aria-expanded', String(open));
  bubble.inert = !open;
  bubble.classList.toggle('on', open);
  if (open) {
    refresh();
    markCurrent();
    if (focus) (items.find((b) => b.hasAttribute('aria-current')) || items[0]).focus({ preventScroll: true });
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onEscape, true);
  } else {
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onEscape, true);
    if (focus) btn.focus({ preventScroll: true });
  }
}
const close = (opts) => setOpen(false, opts);

function onOutside(e) { if (!root.contains(e.target)) close({ focus: false }); }
function onEscape(e) {
  if (e.key !== 'Escape') return;
  e.stopPropagation();
  e.preventDefault();
  close();
}

// mismas acciones que tenía la isla (islandGo en js/main.js)
function navigate(id) {
  close({ focus: false });
  if (id === 'search') {
    if (!islandOpen()) coreOf()?.click();
    document.getElementById('search')?.select();
    return;
  }
  if (islandOpen()) coreOf()?.click();
  if (id === 'settings') app.openPanel('settings');
  else if (id === 'import') document.getElementById('pick-files')?.click();
  else {
    if (app.ui) app.ui.back = [];
    app.go(id);
  }
}

// usa la misma acción de Ajustes (pide confirmación). Cambiar de cuenta es salir y abrir "Iniciar sesión" en la landing.
async function leave(toSignIn) {
  close({ focus: false });
  await app.actions['sign-out']?.();
  if (!toSignIn || app.user) return; // canceló la confirmación
  for (let i = 0; i < 40 && !document.querySelector('.welcome [data-wl=signin]'); i++) await new Promise((r) => setTimeout(r, 100));
  document.querySelector('.welcome [data-wl=signin]')?.click();
}

btn.addEventListener('click', () => setOpen(!open));
bubble.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-pm]');
  if (b) navigate(b.dataset.pm);
  const a = e.target.closest('[data-pm-account]');
  if (!a) return;
  const kind = a.dataset.pmAccount;
  if (kind === 'zuena-profile') {
    close({ focus: false });
    if (islandOpen()) coreOf()?.click();
    app.go('artistpage', `zu:${ZUENA_OFFICIAL_UID}`);
    return;
  }
  if (kind === 'identity-switch') {
    close({ focus: false });
    const nextUid = app.user?.uid === ZUENA_OFFICIAL_UID ? OWNER_UID : ZUENA_OFFICIAL_UID;
    const ok = await app.auth?.switchIdentity?.(nextUid);
    if (ok) app.toast(nextUid === ZUENA_OFFICIAL_UID ? 'Actuando como Equipo de Zuena (@zuena)' : 'Sesión restaurada como Dueño (@netostars)');
    return;
  }
  leave(kind === 'switch');
});
bubble.addEventListener('keydown', (e) => {
  const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLS, ArrowUp: -COLS }[e.key];
  if (!step) return;
  const i = items.indexOf(document.activeElement);
  if (i < 0) return;
  const to = i + step;
  if (to < 0 || to >= items.length) return;
  e.preventDefault();
  e.stopPropagation();
  items[to].focus();
});
// al salir con Tab la burbuja se cierra sin robar el foco
root.addEventListener('focusout', (e) => {
  if (open && e.relatedTarget && !root.contains(e.relatedTarget)) close({ focus: false });
});

// sesión y landing: la clase del body cambia al abrir/cerrar la bienvenida; `auth` avisa antes de que la app
// termine de cargar el perfil, así que también se revisa cada vez que la app dibuja una vista
app.auth.addEventListener('change', refresh);
new MutationObserver(refresh).observe(document.body, { attributes: true, attributeFilter: ['class'] });
const view = document.getElementById('view');
if (view) new MutationObserver(() => { refresh(); if (open) markCurrent(); }).observe(view, { childList: true });
refresh();
