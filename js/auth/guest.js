// Identidad temporal local: no requiere contexto seguro ni crypto.subtle.
export const GUEST_DURATION = 7 * 24 * 60 * 60 * 1000;
export const isGuest = (user) => !!user && (user.isGuest === true || user.provider === 'guest' || user.mode === 'guest');

export function guestValid(user, now = Date.now()) {
  return isGuest(user) && user.isGuest === true && user.provider === 'guest' && user.mode === 'guest'
    && typeof user.uid === 'string' && !!user.uid && /^Invitado [A-Za-z0-9]{8}$/.test(user.displayName)
    && !user.email && !user.hash && !user.salt && user.emailVerified === false && !user.expired
    && Number.isFinite(user.created) && Number.isFinite(user.expiresAt)
    && user.expiresAt === user.created + GUEST_DURATION && user.created <= now && now < user.expiresAt;
}

export function createGuest(now = Date.now()) {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  const uid = typeof crypto.randomUUID === 'function' ? crypto.randomUUID()
    : `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let suffix = '';
  while (suffix.length < 8) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte < 248 && suffix.length < 8) suffix += alphabet[byte % alphabet.length];
    }
  }
  return { uid, displayName: `Invitado ${suffix}`, provider: 'guest', mode: 'guest', isGuest: true,
    emailVerified: false, created: now, expiresAt: now + GUEST_DURATION };
}

// Revisa el reloj real al vencer, como máximo cada 30 s y al volver a la pestaña.
export function watchGuest(user, check) {
  let timer;
  let stopped = false;
  const tick = () => {
    clearTimeout(timer);
    if (stopped) return;
    check();
    if (!stopped) timer = setTimeout(tick, Math.min(30000, Math.max(1, user.expiresAt - Date.now())));
  };
  const visible = () => { if (!document.hidden) tick(); };
  document.addEventListener('visibilitychange', visible);
  timer = setTimeout(tick, Math.min(30000, Math.max(1, user.expiresAt - Date.now())));
  return () => { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', visible); };
}
