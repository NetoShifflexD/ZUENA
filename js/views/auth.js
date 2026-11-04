// Acceso: crear cuenta (preregistro) / iniciar sesión con correo o Google.
// El formulario se monta en cualquier contenedor: dentro de un diálogo (openAuth) o en la landing pública.
import { app } from '../app.js';
import { icon, logo, googleLogo } from '../ui/icons.js';
import { esc } from '../ui/format.js';
import { openModal } from '../ui/modal.js';
import { consentFieldHtml, validateConsent, buildConsent, rememberPendingConsent, clearPendingConsent, saveConsent } from '../legal/consent.js';

function authHtml(tab, { brand = true, consent = false } = {}) {
  const cloud = !!app.auth.cloud;
  const nube = app.auth.cloudAccounts; // cuentas de correo en la nube de Supabase
  const local = app.auth.mode === 'local' && !cloud;
  return `
      <div class="auth access-editorial">
        ${brand ? `<div class="auth-brand"><span class="auth-logo">${logo()}</span><span>ZUENA</span></div>` : ''}
        <p class="access-kicker">${tab === 'signup' ? 'Tu lugar en ZUENA' : 'La música sigue acá'}</p>
        <h2 tabindex="-1">${tab === 'signup' ? 'Creá tu cuenta' : 'Volvé a escuchar'}</h2>
        <p class="muted">${tab === 'signup' ? 'Sumate desde el primer día: tu perfil, tus playlists y tu música, en un solo lugar.' : 'Ingresá para seguir escuchando.'}</p>
        <div class="seg two auth-tabs">
          <button type="button" class="seg-btn lit ${tab === 'signup' ? 'on' : ''}" data-tab="signup" aria-pressed="${tab === 'signup'}">Crear cuenta</button>
          <button type="button" class="seg-btn lit ${tab === 'signin' ? 'on' : ''}" data-tab="signin" aria-pressed="${tab === 'signin'}">Iniciar sesión</button>
        </div>
        ${local ? '' : `<button type="button" class="btn-google lit" data-google>${googleLogo}<span>Continuar con Google</span></button>`}
        <div class="or"><span>${local ? 'Con tu correo' : 'O con tu correo'}</span></div>
        <form class="auth-form" novalidate>
          <label class="field"><span>Correo electrónico</span>
            <div class="input-icon">${icon('mail')}<input class="input" name="email" type="email" autocomplete="email" placeholder="vos@correo.com" required></div>
            <span class="field-error" data-err="email"></span></label>
          <label class="field"><span>Contraseña</span>
            <div class="input-icon">${icon('lock')}<input class="input" name="password" type="password" autocomplete="${tab === 'signup' ? 'new-password' : 'current-password'}" placeholder="${tab === 'signup' ? 'Mínimo 8 caracteres' : 'Tu contraseña'}" required minlength="8">
            <button type="button" class="peek" data-peek title="Mostrar" aria-label="Mostrar contraseña">${icon('eye')}</button></div>
            ${tab === 'signup' ? '<div class="strength"><i></i></div>' : ''}
            <span class="field-error" data-err="password"></span></label>
          ${tab === 'signin' ? `<button type="button" class="link small" data-forgot>¿Olvidaste tu contraseña?</button>${nube ? '<button type="button" class="link small" data-magic>Enviarme un enlace de acceso</button>' : ''}` : ''}
          ${tab === 'signup' ? `${consentFieldHtml({ checked: consent })}<span class="field-error" data-err="consent" role="alert"></span>` : ''}
          <span class="field-error" data-err="form" role="alert"></span><span class="field-error" data-err="google" role="alert"></span>
          <p class="hint auth-notice" data-notice role="status" hidden></p>
          <button class="btn-primary lit wide" data-submit>${tab === 'signup' ? 'Crear cuenta' : 'Ingresar'}</button>
        </form>
        <aside class="access-guest" aria-label="Acceso temporal">
          <div><h3>Primero, conocé ZUENA.</h3><p class="hint">Cuenta temporal de 7 días, sin correo</p></div>
          <button type="button" class="btn-glass lit wide" data-guest>Seguir como invitado</button>
          <span class="field-error" data-err="guest" role="status">${esc(app.auth.guestMessage || '')}</span>
        </aside>
        ${local && nube ? `<p class="hint center">${icon('lock')} Tu cuenta se guarda en la nube de ZUENA: entrás desde cualquier dispositivo.</p>` : ''}
        ${local && !nube ? `<p class="hint center">${icon('lock')} Modo local: tu cuenta queda guardada sólo en este equipo.</p>` : ''}
        ${cloud ? `<p class="hint center">${icon('lock')} Con Google tu cuenta se guarda en la nube de ZUENA. Con correo queda sólo en este equipo.</p>` : ''}
      </div>`;
}

// Monta el formulario en `el`; llama a onUser(user) al entrar. Devuelve { setTab } para cambiar de pestaña desde afuera.
export function mountAuthForm(el, { mode = 'signup', onUser, brand = true, autofocus = true } = {}) {
  let tab = mode;
  let busy = false;
  let consent = false; // la casilla se conserva al cambiar de pestaña
  const paint = () => { el.innerHTML = authHtml(tab, { brand, consent }); bind(); };
  const notice = (msg) => { const n = el.querySelector('[data-notice]'); if (n) { n.textContent = msg; n.hidden = !msg; } };
  const setErr = (field, msg) => {
    notice('');
    if (!el.querySelector(`[data-err="${field}"]`)) field = 'form';
    el.querySelectorAll('[data-err]').forEach((x) => { x.textContent = x.dataset.err === field ? msg : ''; });
    el.querySelector(`[name=${field}]`)?.classList.add('invalid');
  };
  const run = async (fn) => {
    if (busy) return;
    busy = true;
    el.querySelector('.auth').setAttribute('aria-busy', 'true');
    el.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    el.querySelector('[data-submit]')?.classList.add('loading');
    try {
      const user = await fn();
      // nube con confirmación de correo: la cuenta existe pero se activa desde el enlace del correo
      if (user?.pendingConfirm) {
        el.querySelectorAll('[data-err]').forEach((x) => { x.textContent = ''; });
        notice(`Te enviamos un correo a ${user.email}. Abrí el enlace para activar tu cuenta y después iniciá sesión.`);
      } else if (user) onUser?.(user);
    } catch (err) {
      setErr(err.field || 'form', err.message);
    } finally {
      busy = false;
      el.querySelector('.auth').setAttribute('aria-busy', 'false');
      el.querySelectorAll('button').forEach((b) => { b.disabled = false; });
      const guest = el.querySelector('[data-guest]');
      if (guest) guest.textContent = 'Seguir como invitado';
      el.querySelector('[data-submit]')?.classList.remove('loading');
    }
  };
  const withConsent = async (method, enter) => {
    if (tab !== 'signup') return enter();
    const checked = !!el.querySelector('[name=consent]')?.checked;
    const error = validateConsent(checked);
    if (error) throw Object.assign(new Error(error), { field: 'consent' });
    const record = buildConsent({ checked, method });
    rememberPendingConsent(record);
    try {
      const user = await enter();
      if (user && !user.isGuest) saveConsent(user.uid, record);
      return user;
    } finally { clearPendingConsent(); }
  };
  const bind = () => {
    const form = el.querySelector('form');
    el.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { tab = b.dataset.tab; paint(); }; });
    const google = el.querySelector('[data-google]'); // sólo se dibuja si Google está disponible
    if (google) google.onclick = () => run(() => withConsent('google', () => app.auth.google()));
    el.querySelector('[data-guest]').onclick = () => run(() => {
      el.querySelector('[data-guest]').textContent = 'Preparando acceso…';
      return app.auth.guestSignIn();
    });
    el.querySelector('[data-peek]').onclick = (e) => {
      const shown = form.password.type === 'password';
      form.password.type = shown ? 'text' : 'password';
      e.currentTarget.setAttribute('aria-label', shown ? 'Ocultar contraseña' : 'Mostrar contraseña');
      e.currentTarget.title = shown ? 'Ocultar' : 'Mostrar';
    };
    form.addEventListener('input', (e) => {
      e.target.classList.remove('invalid');
      if (e.target.name === 'consent') { consent = e.target.checked; if (consent) el.querySelector('[data-err=consent]').textContent = ''; }
      if (e.target.name === 'password' && tab === 'signup') {
        const v = e.target.value;
        const score = [v.length >= 8, v.length >= 12, /[A-Z]/.test(v) && /[a-z]/.test(v), /\d/.test(v), /[^A-Za-z0-9]/.test(v)].filter(Boolean).length;
        const bar = el.querySelector('.strength i');
        bar.style.width = `${(score / 5) * 100}%`;
        bar.dataset.level = score <= 2 ? 'low' : score <= 3 ? 'mid' : 'high';
      }
    });
    el.querySelector('[data-forgot]')?.addEventListener('click', () => run(async () => {
      await app.auth.resetPassword(form.email.value);
      app.toast('Te enviamos un correo para restablecer la contraseña');
      return null;
    }));
    el.querySelector('[data-magic]')?.addEventListener('click', () => run(async () => {
      await app.auth.magicLink(form.email.value);
      notice('Si hay una cuenta con ese correo, te llega un enlace para entrar. Abrilo en este dispositivo.');
      return null;
    }));
    form.onsubmit = (e) => {
      e.preventDefault();
      const { email, password } = form;
      run(() => tab === 'signup' ? withConsent('password', () => app.auth.signUp(email.value, password.value)) : app.auth.signIn(email.value, password.value));
    };
    if (autofocus) setTimeout(() => form.email.focus({ preventScroll: true }), 60);
  };
  paint();
  // focus: 'email' (teclado físico) o 'title' (táctil: el foco entra al diálogo sin abrir el teclado)
  return { setTab: (t, { focus = 'email' } = {}) => { if (busy) return; if (t !== tab) { tab = t; paint(); } el.querySelector(focus === 'title' ? '.auth h2' : 'input[name=email]')?.focus({ preventScroll: true }); } };
}

export function openAuth({ mode = 'signup', required = false } = {}) {
  return new Promise((resolve) => {
    let result = null;
    openModal('', {
      cls: 'auth-modal',
      dismissable: !required,
      onClose: () => resolve(result),
      onMount: (m, close) => {
        const content = document.createElement('div');
        m.append(content);
        m.setAttribute('aria-label', 'Acceso a ZUENA');
        mountAuthForm(content, { mode, onUser: (u) => { result = u; close(); } });
        if (!required) {
          const back = document.createElement('button');
          back.type = 'button';
          back.className = 'access-close btn-icon';
          back.setAttribute('aria-label', 'Cerrar acceso');
          back.innerHTML = icon('close');
          back.onclick = close;
          m.prepend(back);
        }
      },
    });
  });
}

export const authLabel = (user) => (user?.isGuest || user?.provider === 'guest' || user?.mode === 'guest'
  ? `${esc(user.displayName || 'Invitado')} · Invitado · cuenta local temporal · Tu acceso vence el ${esc(new Date(user.expiresAt).toLocaleString())}.`
  : user ? `${esc(user.email)} · ${user.provider === 'google' ? 'Google' : 'correo'}${user.mode === 'local' ? ' · local' : user.mode === 'supabase' ? ' · nube' : ''}` : '');

// después del enlace de recuperación de contraseña (evento 'recovery' de la cuenta de la nube)
export function openPasswordRecovery() {
  openModal(`<form class="confirm access-recovery" novalidate>
      <div class="auth-brand"><span class="auth-logo">${logo()}</span><span>ZUENA</span></div>
      <p class="access-kicker">Recuperá tu acceso</p>
      <h3>Elegí una contraseña nueva</h3>
      <label class="field"><span>Contraseña nueva</span><input class="input" name="password" type="password" autocomplete="new-password" minlength="8" placeholder="Mínimo 8 caracteres" required>
        <span class="field-error" data-err="password" role="alert"></span></label>
      <div class="confirm-actions"><button type="button" class="btn-glass lit" data-modal="cancel">Cancelar</button><button class="btn-primary lit">Guardar</button></div>
    </form>`, {
    cls: 'sm access-recovery-modal',
    onMount: (m, close) => {
      const form = m.querySelector('form');
      m.querySelector('[data-modal=cancel]').onclick = close;
      form.onsubmit = async (e) => {
        e.preventDefault();
        try { await app.auth.updatePassword(form.password.value); app.toast('Contraseña actualizada'); close(); }
        catch (err) { m.querySelector('[data-err=password]').textContent = err.message; }
      };
      setTimeout(() => form.password.focus(), 60);
    },
  });
}
