// Cliente del servidor de pagos (server/, Stripe Connect). Reglas: Requisitos/Monetización Fan-to-Artist.
// Reglas duras: nunca se simulan cobros ni se muestran cifras sin servidor; la tarjeta nunca pasa por la
// app (Stripe Checkout); el acceso lo decide el servidor (webhooks), no la vuelta del pago.
import { PAYMENTS_API_URL } from '../config.js';

export const DONATION_MIN = 300, DONATION_MAX = 50000, MESSAGE_MAX = 200;
export const PRESETS = [300, 500, 1000, 2000];

// "5,50" / "5.50" / "5" → 550 céntimos; inválido → NaN
export function parseAmount(text) {
  const s = String(text ?? '').trim().replace(/\s|€/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(parseFloat(s) * 100);
}

export const formatEUR = (cents) => (cents / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });

// devuelve el mensaje de error exacto o ''
export function donationError(cents, message = '') {
  if (!Number.isFinite(cents)) return 'Ingresá un importe válido, por ejemplo 5,50.';
  if (cents < DONATION_MIN || cents > DONATION_MAX) return 'El importe tiene que estar entre 3,00 € y 500,00 €.';
  if (message.length > MESSAGE_MAX) return 'El mensaje puede tener hasta 200 caracteres.';
  if (/(https?:\/\/|www\.|\b[\w.-]+\.(com|net|org|io|ar|es)\b|@[\w-]+\.\w)/i.test(message)) return 'Por seguridad, los mensajes no pueden incluir enlaces ni correos.';
  return '';
}

let health = null, healthAt = 0;

export const payments = {
  get configured() { return !!PAYMENTS_API_URL; },

  // { payments, stripeMode } o null si no hay servidor (cache 5 min, sólo en memoria)
  async health() {
    if (!PAYMENTS_API_URL) return null;
    if (health && Date.now() - healthAt < 5 * 60e3) return health;
    try {
      const r = await fetch(`${PAYMENTS_API_URL}/api/health`, { cache: 'no-store' });
      health = r.ok ? await r.json() : null;
    } catch { health = null; }
    healthAt = Date.now();
    return health?.payments ? health : null;
  },

  async call(path, { method = 'GET', body, auth } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth) {
      const token = await auth.idToken?.();
      if (!token) throw new Error('Para pagar necesitás una cuenta verificada.');
      headers.Authorization = `Bearer ${token}`;
    }
    if (method !== 'GET') headers['Idempotency-Key'] = crypto.randomUUID();
    let r;
    try { r = await fetch(`${PAYMENTS_API_URL}${path}`, { method, headers, body: body && JSON.stringify(body) }); }
    catch { throw new Error('El servicio de pagos no está disponible ahora. Probá más tarde.'); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error?.message || 'El servicio de pagos no está disponible ahora. Probá más tarde.');
    return data;
  },

  // perfil público de cobro de un artista: { monetizable, tiers: [...] }
  artist(artistUid) { return this.call(`/api/artists/${encodeURIComponent(artistUid)}/tiers`); },
  subscribe(auth, artistUid, tierId) { return this.call('/api/subscribe', { method: 'POST', auth, body: { artistId: artistUid, tierId, returnUrl: location.origin + location.pathname } }); },
  donate(auth, artistUid, amountCents, message, visibility) { return this.call('/api/donate', { method: 'POST', auth, body: { artistId: artistUid, amountCents, message, visibility, returnUrl: location.origin + location.pathname } }); },
  onboard(auth) { return this.call('/api/connect/onboard', { method: 'POST', auth, body: { returnUrl: location.origin + location.pathname } }); },
  earnings(auth) { return this.call('/api/artists/me/earnings', { auth }); },
  mySubscriptions(auth) { return this.call('/api/me/subscriptions', { auth }); },
};
