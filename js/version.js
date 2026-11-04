// Versiones de ZUENA: la app y cada función. Sirve para saber en qué nivel quedó cada parte y priorizar
// la actualización de las más viejas. Regla: al cambiar una función, subir su versión (mayor = rediseño,
// menor = mejora, parche = arreglo), poner la fecha de hoy y reflejarlo en Wiki/Registro/Versiones.md.
export const APP_VERSION = '0.26.0';

// [id, nombre, versión, última actualización]
export const FEATURES = [
  ['audio', 'Motor de audio (gapless, LUFS, EQ, espacial, 5.1/7.1, limitador)', '3.4.0', '2026-11-03'],
  ['np', 'Reproductor, cápsula rápida y navegación inmersiva', '4.3.0', '2026-11-03'],
  ['viz', 'Espectro "seda"', '2.0.0', '2026-11-01'],
  ['home', 'Inicio y carrusel de portada', '3.2.2', '2026-11-03'],
  ['search', 'Búsqueda unificada de música, perfiles y feed', '1.1.0', '2026-11-02'],
  ['explore', 'Explorar y búsqueda', '2.0.2', '2026-11-03'],
  ['feed', 'Feed v4 (tarjetas de vidrio, Ahora en ZUENA, Estrenos, ranking con afinidad, publicaciones de la nube)', '4.1.1', '2026-11-03'],
  ['motion', 'Motor de animaciones Prisma Motion', '0.3.0', '2026-11-02'],
  ['sim', 'Simulador de actividad', '1.1.0', '2026-11-02'],
  ['artistpage', 'Perfil de artista', '3.3.2', '2026-11-03'],
  ['charts', 'Charts de oyentes y suscriptores', '1.0.0', '2026-11-02'],
  ['profile', 'Perfil de oyente (tipo de cuenta Oyente / Artista, fila en la nube)', '2.2.0', '2026-11-03'],
  ['support', 'Apoyo al artista (Suscripciones v2, sin cobros)', '2.0.0', '2026-11-02'],
  ['releases', 'Lanzamientos y estrenos', '1.1.0', '2026-11-01'],
  ['studio', 'Programa de artistas, reclamo v2 y Estudio', '2.0.1', '2026-11-03'],
  ['library', 'Biblioteca y música propia', '1.2.1', '2026-11-03'],
  ['playlists', 'Playlists', '1.0.0', '2026-10-30'],
  ['settings', 'Ajustes (con Privacidad y legal)', '2.3.0', '2026-11-03'],
  ['sounds', 'Sonidos de interfaz', '1.0.0', '2026-11-01'],
  ['auth', 'Landing v4 con la isla y el vidrio de la app, acceso a pantalla completa, invitado temporal, casilla de términos y nube Supabase', '4.0.0', '2026-11-03'],
  ['legal', 'Apartados legales, aviso de cookies y consentimiento (borradores)', '0.1.0', '2026-11-03'],
  ['forartists', 'Presentación para artistas', '1.1.0', '2026-11-01'],
  ['catalog', 'Catálogo de prueba (30 artistas)', '1.1.0', '2026-11-01'],
  ['cloud', 'Nube Cloudflare (Worker + D1)', '0.1.0', '2026-11-01'],
  ['supabase', 'Nube Supabase (cuentas, perfiles, feed, me gusta, seguidos y pistas subidas)', '0.1.0', '2026-11-03'],
  ['payments', 'Servidor de pagos (sin ejecutar)', '0.1.0', '2026-11-01'],
  ['pwa', 'App instalable', '1.1.1', '2026-11-03'],
  ['theme', 'Temas, apariencia y personalización (claro por defecto)', '3.0.1', '2026-11-03'],
  ['island', 'Isla de contenido: mosaicos, artistas, recientes y feed', '3.0.0', '2026-11-02'],
];

// prioridad de actualización: más días sin tocar y versión más baja → primero
export function staleness(now = Date.now()) {
  return FEATURES.map(([id, name, version, date]) => {
    const days = Math.floor((now - Date.parse(date)) / 864e5);
    const major = +version.split('.')[0];
    return { id, name, version, date, days, score: days + (major < 1 ? 30 : major < 2 ? 10 : 0) };
  }).sort((a, b) => b.score - a.score);
}
