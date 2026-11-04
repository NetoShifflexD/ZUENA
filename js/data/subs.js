// Suscripciones y audiencia de publicaciones (Requisitos/Feed de artistas, suscripciones y charts §3).
// Sin servidor de pagos no existe ninguna suscripción real. Lo único que hay es el modo SIMULADO: un estado de
// prueba sólo con artistas ficticios (`sim-*`), rotulado "Simulado", sin importes, sin cobros y sin pagos.
// Se guarda en kv `subs:sim` = { "<oyente>|<artista>": { tier, since, updated, sim:true } }.
import { db } from '../store/db.js';
import { TEST_CATALOG } from '../config.js';

export const TIER_NAMES = ['Fan', 'Superfan', 'VIP'];
export const tierName = (n) => TIER_NAMES[Math.min(3, Math.max(1, n)) - 1];

// nivel que pide una publicación: 0 = pública. Un nivel desconocido se trata como el más restrictivo (VIP).
export function tierOf(post) {
  const a = post?.audience;
  if (!a || a === 'public') return 0;
  const n = /^tier:(\d)$/.exec(String(a));
  return n && +n[1] >= 1 && +n[1] <= 3 ? +n[1] : 3;
}

// ¿puede leer la publicación? Jerarquía acumulativa: VIP (3) ve 1..3, Fan (1) sólo 1.
// Sin servidor, un exclusivo que no sea simulado queda bloqueado para todos (nunca se muestra su contenido).
export function canView(post, tier = 0, { isAuthor = false } = {}) {
  const need = tierOf(post);
  if (!need) return true;
  if (isAuthor) return true;
  if (!post.sim) return false;
  return tier >= need;
}

// sólo los artistas ficticios del simulador admiten la suscripción simulada
export const isSimArtist = (artist) => !!artist && String(artist.uid || '').startsWith('sim-') && !!artist.sim;
export const canSubscribeSim = (artist, { testCatalog = TEST_CATALOG } = {}) => testCatalog && isSimArtist(artist);

// alta / cambio de nivel sobre el mapa (puro). Devuelve el resultado para elegir el mensaje.
export function applySub(map, listener, artistUid, tier, now = Date.now()) {
  const key = `${listener}|${artistUid}`;
  const prev = map[key];
  if (prev && prev.tier === tier) return { map, result: 'same', prev };
  const next = { ...map, [key]: { tier, since: prev?.since || now, updated: now, sim: true } };
  return { map: next, result: prev ? 'changed' : 'new', prev };
}

export function removeSub(map, listener, artistUid) {
  const key = `${listener}|${artistUid}`;
  if (!map[key]) return { map, removed: false };
  const next = { ...map };
  delete next[key];
  return { map: next, removed: true };
}

// ---------- Suscripciones v2 (Requisitos/Suscripciones v2): funciones puras ----------
// Beneficios fijos por ranura: los del contrato del servidor (server/src/services/tiers.ts, BENEFITS). D1.
export const TIER_BENEFITS = [
  ['Insignia de Oyente Fundador', 'Canal Broadcast del artista', 'Instrumentales oficiales'],
  ['Todo lo del nivel Fan', 'Bóveda de demos', 'Escucha anticipada de lanzamientos', 'Breakdowns del DAW'],
  ['Todo lo de los niveles anteriores', 'Stems y acapellas descargables', 'Agradecimientos especiales en los créditos', 'Listening party privada'],
];
export const REF_CENTS = [499, 999, 2499];
export const TIER_MIN = 299, TIER_MAX = 9999;
export const TIER_NAME_MAX = 24; // el servidor acepta hasta 24 (routes/artist.ts)

// cuál variante de la sección de apoyo corresponde (§4.1, la primera que aplica)
// 'preview' | 'sim' | 'test' | 'soon' | 'none' | 'empty' | 'real'
export function supportVariant({ isOwner = false, uid = '', serverUp = false, monetizable = false, tierCount = 0, testCatalog = TEST_CATALOG } = {}) {
  const id = String(uid || '');
  if (isOwner) return 'preview';
  if (id.startsWith('sim-')) return testCatalog ? 'sim' : 'none';
  if (id.startsWith('am:')) return testCatalog ? 'test' : 'none';
  if (!serverUp) return 'soon';
  if (!monetizable) return 'none';
  if (!tierCount) return 'empty';
  return 'real';
}

// estado del servidor → etiqueta, cabecera y acceso (§4.2). El acceso real lo decide `entitled` del servidor.
export function subStateLabel(state, until = null, tierLabel = '') {
  const fecha = until ? new Date(until).toLocaleDateString('es') : '';
  const sus = `Suscripto · ${tierLabel}`;
  switch (state) {
    case 'incomplete': return { label: 'Pendiente de pago', header: 'Suscripción pendiente', access: false };
    case 'active': return { label: 'Activa', header: sus, access: true };
    case 'canceling': return { label: `Se cancela el ${fecha}`, header: sus, access: true };
    case 'past_due': return { label: 'Pago pendiente', header: sus, access: null, warn: true };
    case 'unpaid': case 'canceled': case 'refunded': return { label: 'Finalizada', header: 'Suscribirme', access: false };
    default: return { label: '', header: 'Suscribirme', access: false };
  }
}

// niveles que ve el público: publicados y cerrados a nuevas altas (draft y archived nunca)
export const visibleTiers = (tiers) => (tiers || []).filter((t) => t && (t.state === 'published' || t.state === 'closed_to_new')).sort((a, b) => a.slot - b.slot);

// precios por ranura (céntimos o null si la ranura no existe): rango 299–9999 y estrictamente crecientes
export function priceRule(prices) {
  const set = (prices || []).filter((p) => p != null && p !== '');
  if (set.some((p) => !Number.isInteger(p) || p < TIER_MIN || p > TIER_MAX)) return 'El precio de un nivel tiene que estar entre 2,99 € y 99,99 €.';
  for (let i = 1; i < set.length; i++) if (set[i] <= set[i - 1]) return 'Los precios tienen que ser crecientes: Fan < Superfan < VIP.';
  return '';
}

// contador público (§6.2): opt-in, nunca exacto por debajo de 5; los `sim-*` llevan "Simulado"
export function counterDisplay(count, optIn = false, { sim = false, serverUp = true } = {}) {
  const n = Math.max(0, Math.floor(+count || 0));
  if (sim) return { text: `${n} ${n === 1 ? 'suscriptor' : 'suscriptores'}`, sim: true };
  if (!serverUp || !optIn || count == null) return null;
  if (n < 5) return { text: 'Menos de 5 suscriptores', sim: false };
  return { text: `${n} suscriptores`, sim: false };
}

// "precio de referencia" (variante Próximamente): el previsto del borrador o el de referencia. slot 1..3
export function referencePrice(draft, slot) {
  const p = draft?.plannedCents;
  return Number.isInteger(p) && p >= TIER_MIN && p <= TIER_MAX ? p : REF_CENTS[Math.min(3, Math.max(1, slot)) - 1];
}

export const canDeleteTier = (tier) => !(tier && +tier.subscribers > 0);

// nivel con derecho según el servidor (/me/subscriptions → entitled). La vuelta de Stripe (?pago=ok) no
// cuenta: sin respuesta del servidor no hay acceso.
export function entitledTier(subscriptions, artistUid) {
  if (!Array.isArray(subscriptions)) return 0;
  const s = subscriptions.find((x) => x && x.artistId === artistUid && x.entitled === true);
  return s ? s.tier?.slot || 0 : 0;
}

// fila de suscripción vigente del usuario con ese artista (para la cabecera), aunque no tenga derecho
export const subscriptionWith = (subscriptions, artistUid) => (Array.isArray(subscriptions) ? subscriptions.find((x) => x && x.artistId === artistUid && !['canceled', 'refunded'].includes(x.state)) || null : null);

export class SimSubs extends EventTarget {
  constructor() {
    super();
    this.map = {};
  }

  async load() {
    if (!TEST_CATALOG) { this.map = {}; await db.kvDel('subs:sim').catch(() => {}); return; }
    const raw = await db.kvGet('subs:sim').catch(() => null);
    this.map = raw && typeof raw === 'object' ? raw : {};
  }

  async save() {
    await db.kvSet('subs:sim', this.map);
    this.dispatchEvent(new Event('change'));
  }

  // nivel vigente (0 = sin suscripción)
  tier(listener, artistUid) {
    if (!TEST_CATALOG || !listener) return 0;
    return this.map[`${listener}|${artistUid}`]?.tier || 0;
  }

  entry(listener, artistUid) { return this.map[`${listener}|${artistUid}`] || null; }

  async subscribe(listener, artist, tier, now = Date.now()) {
    if (!listener || !canSubscribeSim(artist) || listener === artist.uid || !(tier >= 1 && tier <= 3)) return { result: 'rejected' };
    const r = applySub(this.map, listener, artist.uid, tier, now);
    if (r.result !== 'same') { this.map = r.map; await this.save(); }
    return r;
  }

  async cancel(listener, artistUid) {
    const r = removeSub(this.map, listener, artistUid);
    if (r.removed) { this.map = r.map; await this.save(); }
    return r.removed;
  }

  // suscriptores activos de un artista y cuántos con derecho a un nivel
  countFor(artistUid, minTier = 1) {
    let n = 0;
    for (const [k, v] of Object.entries(this.map)) if (k.endsWith(`|${artistUid}`) && v.tier >= minTier) n++;
    return n;
  }

  async clear() { this.map = {}; await db.kvDel('subs:sim').catch(() => {}); this.dispatchEvent(new Event('change')); }

  async purgeArtist(artistUid) {
    let changed = false;
    for (const k of Object.keys(this.map)) if (k.endsWith(`|${artistUid}`)) { delete this.map[k]; changed = true; }
    if (changed) await this.save();
  }
}
