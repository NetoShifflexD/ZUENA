// Consentimiento al crear una cuenta (2026-11-02): términos del servicio + política de privacidad + declaración
// de edad mínima. Los textos son BORRADORES pendientes de revisión profesional; la versión queda registrada
// para poder pedir una nueva aceptación cuando cambien.
// API para la capa de cuentas (js/auth/auth.js la usa para guardar el consentimiento en la nube):
//   getPendingConsent()  → registro aceptado en el último intento de alta (o null)
//   clearPendingConsent() · saveConsent(uid, registro) · getConsent(uid) · hasAcceptedCurrent(registro)
import { esc } from '../ui/format.js';

export const TERMS_VERSION = '2026-11-02-borrador';
export const PRIVACY_VERSION = '2026-11-02-borrador';
// Edad mínima PROVISIONAL: pendiente de definir por la dirección legal (Decisiones ejecutivas → edad).
export const MIN_AGE = 14;
export const MIN_AGE_PROVISIONAL = true;

export const CONSENT_ERROR = 'Para crear tu cuenta tenés que aceptar los términos y la política de privacidad, y confirmar tu edad.';

const PENDING_KEY = 'zuena:pendingConsent';
const SAVED_PREFIX = 'zuena:consent:';

// casilla obligatoria del formulario de alta; los enlaces abren el documento sin salir del formulario
export function consentFieldHtml({ checked = false } = {}) {
  return `<label class="consent-row">
      <input type="checkbox" name="consent" ${checked ? 'checked' : ''} required aria-describedby="consent-note">
      <span>Acepto los <button type="button" class="link-inline" data-legal="terminos">Términos del servicio</button> y la
        <button type="button" class="link-inline" data-legal="privacidad">Política de privacidad</button>, y declaro tener al menos ${esc(String(MIN_AGE))} años.</span>
    </label>
    <p class="consent-note" id="consent-note">Textos en borrador, pendientes de revisión profesional.${MIN_AGE_PROVISIONAL ? ' La edad mínima es provisional.' : ''}</p>`;
}

// '' si está bien; si no, el mensaje que se muestra junto a la casilla
export const validateConsent = (checked) => (checked ? '' : CONSENT_ERROR);

// registro de lo que la persona aceptó (sin datos personales: el uid se agrega al guardarlo)
export function buildConsent({ checked, method = 'password', now = Date.now() } = {}) {
  if (!checked) return null;
  return {
    termsVersion: TERMS_VERSION,
    privacyVersion: PRIVACY_VERSION,
    minAge: MIN_AGE,
    minAgeProvisional: MIN_AGE_PROVISIONAL,
    ageDeclared: true,
    method,
    acceptedAt: new Date(now).toISOString(),
  };
}

// ¿el registro corresponde a las versiones vigentes?
export const hasAcceptedCurrent = (rec) => !!rec && rec.ageDeclared === true
  && rec.termsVersion === TERMS_VERSION && rec.privacyVersion === PRIVACY_VERSION && rec.minAge >= MIN_AGE;

const store = (kind) => { try { return kind === 'session' ? sessionStorage : localStorage; } catch { return null; } };
const read = (s, key) => { try { const v = s?.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; } };
const write = (s, key, val) => { try { s?.setItem(key, JSON.stringify(val)); return true; } catch { return false; } };

// consentimiento del intento de alta en curso (lo lee auth.js al crear la cuenta)
export const rememberPendingConsent = (rec) => write(store('session'), PENDING_KEY, rec);
export const getPendingConsent = () => read(store('session'), PENDING_KEY);
export const clearPendingConsent = () => { try { store('session')?.removeItem(PENDING_KEY); } catch {} };

// copia local por cuenta (en este equipo); la nube la guarda auth.js cuando esté conectada
export function saveConsent(uid, rec) {
  if (!uid || !rec) return false;
  return write(store('local'), SAVED_PREFIX + uid, { ...rec, uid });
}
export const getConsent = (uid) => (uid ? read(store('local'), SAVED_PREFIX + uid) : null);

// texto corto para Ajustes
export function consentSummary(rec) {
  if (!rec) return 'No hay registro de aceptación en este equipo.';
  const d = new Date(rec.acceptedAt);
  const when = Number.isNaN(d.getTime()) ? 'fecha desconocida' : d.toLocaleDateString('es');
  return hasAcceptedCurrent(rec)
    ? `Aceptaste la versión vigente (${rec.termsVersion}) el ${when}.`
    : `Aceptaste una versión anterior (${rec.termsVersion}) el ${when}. Hay una versión nueva para revisar.`;
}
