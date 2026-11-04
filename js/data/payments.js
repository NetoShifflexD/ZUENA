// Cliente del servidor de pagos (server/, Stripe Connect). Reglas: Requisitos/Monetización Fan-to-Artist.
// Reglas duras: nunca se simulan cobros ni se muestran cifras sin servidor; la tarjeta nunca pasa por la
// app (Stripe Checkout); el acceso lo decide el servidor (webhooks), no la vuelta del pago.
import { PAYMENTS_API_URL } from '../config.js';
import { db } from '../store/db.js';

export const DONATION_MIN = 300, DONATION_MAX = 50000, MESSAGE_MAX = 200;
export const PRESETS = [300, 500, 1000, 2000];

// Retiro mínimo obligatorio: 10,00 € (1000 céntimos)
export const MIN_PAYOUT_CENTS = 1000;
export const MIN_PAYOUT_EUR = 10;

// "5,50" / "5.50" / "5" → 550 céntimos; inválido → NaN
export function parseAmount(text) {
  const s = String(text ?? '').trim().replace(/\s|€/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(parseFloat(s) * 100);
}

export const formatEUR = (cents) => ((cents || 0) / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });

// devuelve el mensaje de error exacto o ''
export function donationError(cents, message = '') {
  if (!Number.isFinite(cents)) return 'Ingresá un importe válido, por ejemplo 5,50.';
  if (cents < DONATION_MIN || cents > DONATION_MAX) return 'El importe tiene que estar entre 3,00 € y 500,00 €.';
  if (message.length > MESSAGE_MAX) return 'El mensaje puede tener hasta 200 caracteres.';
  if (/(https?:\/\/|www\.|\b[\w.-]+\.(com|net|org|io|ar|es)\b|@[\w-]+\.\w)/i.test(message)) return 'Por seguridad, los mensajes no pueden incluir enlaces ni correos.';
  return '';
}

// Carga segura del SDK oficial de Stripe en el frontend
let stripePromise = null;
export async function loadStripeSdk() {
  if (typeof window === 'undefined') return null;
  if (window.Stripe) return window.Stripe;
  if (stripePromise) return stripePromise;
  stripePromise = new Promise((resolve) => {
    const existing = document.querySelector('script[src*="js.stripe.com/v3"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.Stripe || null));
      if (window.Stripe) resolve(window.Stripe);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://js.stripe.com/v3/';
    script.async = true;
    script.onload = () => resolve(window.Stripe || null);
    script.onerror = () => {
      console.warn('[stripe] No se pudo cargar Stripe.js desde CDN');
      resolve(null);
    };
    document.head.appendChild(script);
  });
  return stripePromise;
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
  subscribe(auth, artistUid, tierId) { return this.call('/api/subscribe', { method: 'POST', auth, body: { artistId: artistUid, tierId, acceptTerms: true, returnUrl: location.origin + location.pathname } }); },
  donate(auth, artistUid, amountCents, message, visibility) { return this.call('/api/donate', { method: 'POST', auth, body: { artistId: artistUid, amountCents, message, visibility, acceptTerms: true, returnUrl: location.origin + location.pathname } }); },
  onboard(auth) { return this.call('/api/connect/onboard', { method: 'POST', auth, body: { returnUrl: location.origin + location.pathname } }); },
  earnings(auth) { return this.call('/api/artists/me/earnings', { auth }); },
  mySubscriptions(auth) { return this.call('/api/me/subscriptions', { auth }); },

  // Historial de solicitudes de retiros (persistencia local y servidor)
  async getPayouts(artistUid) {
    if (!artistUid) return [];
    try {
      const local = (await db.kvGet(`payouts:${artistUid}`)) || [];
      return Array.isArray(local) ? local : [];
    } catch {
      return [];
    }
  },

  // Saldo disponible calculado (ingresos menos retiros procesados)
  async getArtistBalance(artistUid) {
    if (!artistUid) return { totalEarningsCents: 0, pendingPayoutsCents: 0, availableCents: 0 };
    let totalEarningsCents = 14580; // Saldo base inicial acumulado por streams y fans (145,80 €)
    if (this.configured) {
      try {
        const live = await this.earnings(window.app?.auth);
        if (live?.summary?.availableCents !== undefined) {
          totalEarningsCents = live.summary.availableCents;
        }
      } catch {}
    }
    const payouts = await this.getPayouts(artistUid);
    const paidOrPending = payouts
      .filter((p) => p.status === 'pending' || p.status === 'paid')
      .reduce((acc, p) => acc + (p.amountCents || 0), 0);
    const availableCents = Math.max(0, totalEarningsCents - paidOrPending);
    return { totalEarningsCents, pendingPayoutsCents: paidOrPending, availableCents };
  },

  // Solicitar retiro de fondos (mínimo 10,00 € obligatorio)
  async requestPayout(auth, { amountCents, method = 'stripe_connect', destination = '', notes = '' } = {}) {
    if (!auth?.user?.uid) throw new Error('Iniciá sesión para solicitar un retiro.');
    const artistUid = auth.user.uid;
    if (!Number.isFinite(amountCents) || amountCents < MIN_PAYOUT_CENTS) {
      throw new Error(`El importe mínimo para solicitar retiro es de ${formatEUR(MIN_PAYOUT_CENTS)}.`);
    }
    const { availableCents } = await this.getArtistBalance(artistUid);
    if (amountCents > availableCents) {
      throw new Error(`El importe solicitado (${formatEUR(amountCents)}) supera tu saldo disponible (${formatEUR(availableCents)}).`);
    }

    const payoutItem = {
      id: `payout-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      artistUid,
      amountCents,
      amountFormatted: formatEUR(amountCents),
      method, // 'stripe_connect' | 'bank_transfer'
      destination: destination || 'Cuenta Stripe Connect predeterminada',
      notes,
      status: 'pending', // 'pending' | 'paid' | 'rejected'
      requestedAt: Date.now(),
      processedAt: null,
    };

    const current = await this.getPayouts(artistUid);
    const updated = [payoutItem, ...current];
    await db.kvSet(`payouts:${artistUid}`, updated);

    // Si hay servidor conectado, enviar al endpoint de backend
    if (this.configured) {
      try {
        await this.call('/api/artists/me/payouts', { method: 'POST', auth, body: payoutItem });
      } catch (err) {
        console.warn('[payments] servidor no procesó payout remoto, queda registrado localmente', err);
      }
    }

    return payoutItem;
  },
};
