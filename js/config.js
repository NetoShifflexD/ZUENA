// Configuración de la nube. Mientras FIREBASE_CONFIG sea null, ZUENA funciona en "modo local":
// las cuentas y perfiles se guardan en este equipo y el acceso con Google queda deshabilitado.
// Para activar correo + Google reales, pegá acá la config de tu proyecto de Firebase
// (Consola de Firebase → Configuración del proyecto → Tus apps → SDK de Firebase).
export const FIREBASE_CONFIG = null;
/* Ejemplo:
export const FIREBASE_CONFIG = {
  apiKey: '...',
  authDomain: 'zuena-app.firebaseapp.com',
  projectId: 'zuena-app',
  appId: '...',
};
*/

// Correos con permiso para revisar reclamos de artista y lanzamientos.
export const ADMIN_EMAILS = ['equipo@zuena.app'];

// Perfil oficial y exclusivo del Equipo de ZUENA (publicación en el feed + permisos de administración).
export const ZUENA_OFFICIAL_UID = 'zuena-official';
export const ZUENA_OFFICIAL_EMAIL = 'equipo@zuena.app';

// Catálogo externo (Apple Music, Audius, podcasts de iTunes, radios). false = ZUENA arranca "desde cero":
// sólo se ve lo que publican los artistas registrados en ZUENA y la música propia de cada oyente.
// El código de las fuentes sigue en js/catalog/: poner true para volver a mostrarlas.
export const EXTERNAL_CATALOG = false;

// Catálogo de PRUEBA: 30 artistas reales con sus lanzamientos y canciones de Apple Music (js/data/testArtists.js),
// para probar Inicio, carrusel, playlists y perfiles. Poner false antes de abrir ZUENA al público.
export const TEST_CATALOG = true;

// Cuenta propietaria (OWNER): administración total en cualquier modo. Sólo el correo: la contraseña
// la elige su dueño al crear la cuenta y nunca se guarda en el código.
export const OWNER_EMAIL = 'lucianoagustinbengolea@gmail.com';

export const FIREBASE_VERSION = '10.12.2';

// Nube Supabase (proyecto `zuena`): cuentas con correo, perfiles, feed, me gusta, seguidos y pistas subidas.
// La clave es la PUBLICABLE (pública por diseño): la seguridad la dan las políticas RLS. Nunca poner acá
// la clave secreta ni la de servicio. Vacío = la app sigue en modo local. Detalle: js/data/supabase.js.
export const SUPABASE_URL = 'https://dyymeqjqyjfqkxtbxmvg.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_iN7wc3JXb2Hx76iFkQt53Q_kmDNCgXL';
// cliente supabase-js por CDN con versión exacta (si se cambia, revisar la CSP de index.html)
export const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

// Servidor de pagos (carpeta server/, Stripe Connect). Vacío = los cobros no están disponibles y la app
// no muestra botones, precios ni saldos. Ejemplo: 'https://pagos.tu-dominio.com'
export const PAYMENTS_API_URL = '';
