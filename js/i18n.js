// Sistema de internacionalización (i18n) de ZUENA: Español ('es') e Inglés ('en').
// Selección automática según el país de la cuenta / taste o navegador, con selector manual en Ajustes e Isla.

export const SUPPORTED_LANGS = [
  { id: 'es', label: 'Español', flag: 'ES' },
  { id: 'en', label: 'English', flag: 'US' },
];

export const SPANISH_COUNTRIES = new Set([
  'AR', 'ES', 'MX', 'CO', 'CL', 'PE', 'UY', 'VE', 'EC', 'GT',
  'CU', 'BO', 'DO', 'HN', 'PY', 'SV', 'NI', 'CR', 'PA', 'PR', 'GQ'
]);

export function detectLanguage(region = null) {
  if (region && typeof region === 'string') {
    return SPANISH_COUNTRIES.has(region.toUpperCase()) ? 'es' : 'en';
  }
  const nav = typeof navigator !== 'undefined' ? (navigator.language || navigator.userLanguage || '') : '';
  return nav.toLowerCase().startsWith('es') ? 'es' : 'en';
}

const DICT = {
  es: {
    // Navegación y estructura
    'nav.home': 'Inicio',
    'nav.explore': 'Explorar',
    'nav.feed': 'Feed',
    'nav.library': 'Biblioteca',
    'nav.search': 'Buscar',
    'nav.settings': 'Ajustes',
    'nav.profile': 'Perfil',
    'nav.studio': 'ZUENA Studio',
    'nav.artist_dashboard': 'Panel de Artista',
    'nav.admin_dashboard': 'Panel de Administración',

    // Reproductor y transporte
    'player.now_playing': 'Ahora suena',
    'player.play': 'Reproducir',
    'player.pause': 'Pausar',
    'player.next': 'Siguiente',
    'player.previous': 'Anterior',
    'player.volume': 'Volumen',
    'player.mute': 'Silenciar',
    'player.unmute': 'Activar sonido',
    'player.queue': 'Cola de reproducción',
    'player.lyrics': 'Letra',
    'player.credits': 'Créditos',
    'player.technical': 'Detalles técnicos',
    'player.empty_queue': 'La cola está vacía',

    // Isla y búsqueda
    'island.search_placeholder': 'Buscar canciones, artistas o perfiles…',
    'island.close': 'Cerrar isla',
    'island.premieres': 'Estrenos',
    'island.recent': 'Escuchado recientemente',

    // Ajustes e idiomas
    'settings.title': 'Ajustes',
    'settings.language': 'Idioma',
    'settings.language_desc': 'Seleccioná el idioma de la interfaz (Español o Inglés).',
    'settings.country': 'País del contenido',
    'settings.sound': 'Sonido y audio espacial',
    'settings.appearance': 'Apariencia y tema',
    'settings.account': 'Cuenta',
    'settings.artist_section': 'Herramientas de Artista',
    'settings.admin_section': 'Herramientas de Administración',
    'settings.privacy': 'Privacidad y legal',

    // Roles y permisos
    'role.owner': 'Dueño / Propietario',
    'role.admin': 'Administración',
    'role.team': 'Equipo de Zuena',
    'role.artist': 'Artista',
    'role.listener': 'Oyente',
    'role.verified_artist': 'Artista Verificado',

    // Dashboard Admin
    'admin.title': 'Dashboard de Administración',
    'admin.subtitle': 'Control de reclamos, lanzamientos, moderación de feed y gestión de usuarios.',
    'admin.claims': 'Reclamaciones de artistas',
    'admin.releases': 'Subida de canciones y lanzamientos',
    'admin.feed_mod': 'Moderación del Feed',
    'admin.users': 'Gestión de cuentas',
    'admin.approve': 'Aprobar',
    'admin.reject': 'Rechazar',
    'admin.request_changes': 'Pedir cambios',
    'admin.revoke': 'Revocar',
    'admin.delete_post': 'Eliminar publicación',
    'admin.delete_comment': 'Eliminar comentario',
    'admin.suspend_account': 'Suspender cuenta',
    'admin.block_account': 'Bloquear cuenta',
    'admin.reactivate_account': 'Reactivar cuenta',
    'admin.delete_account': 'Eliminar cuenta',
    'admin.no_pending_claims': 'No hay reclamos de artistas pendientes.',
    'admin.no_pending_releases': 'No hay canciones ni lanzamientos pendientes de revisión.',
    'admin.action_success': 'Acción administrativa realizada con éxito.',
    'admin.access_denied': 'Acceso restringido únicamente a cuentas de administración.',

    // Dashboard Artista
    'artist.dashboard_title': 'ZUENA for Artists',
    'artist.dashboard_sub': 'Estadísticas en tiempo real, audiencia, rendimiento de temas y retiro de pagos.',
    'artist.monthly_listeners': 'Oyentes mensuales',
    'artist.total_streams': 'Reproducciones totales',
    'artist.followers': 'Seguidores',
    'artist.saves': 'Canciones guardadas',
    'artist.top_tracks': 'Canciones más reproducidas',
    'artist.top_regions': 'Principales países y regiones',
    'artist.payouts_title': 'Balance y Retiro de Pagos',
    'artist.available_balance': 'Saldo disponible',
    'artist.min_payout_notice': 'El retiro mínimo es de 10,00 €.',
    'artist.request_payout': 'Solicitar retiro de fondos',
    'artist.payout_amount': 'Importe a retirar (€)',
    'artist.payout_method': 'Método de pago (Stripe Connect o Transferencia)',
    'artist.payout_history': 'Historial de retiros',
    'artist.payout_status_pending': 'Pendiente',
    'artist.payout_status_paid': 'Pagado',
    'artist.payout_status_failed': 'Rechazado',
    'artist.stripe_connect_btn': 'Conectar cuenta con Stripe',
    'artist.stripe_connected': 'Cuenta de Stripe conectada para retiros automáticos.',
    'artist.payout_requested': 'Solicitud de retiro enviada con éxito.',
    'artist.payout_err_min': 'El importe mínimo para solicitar retiro es de 10,00 €.',
    'artist.payout_err_balance': 'El importe supera tu saldo disponible.',

    // General
    'common.save': 'Guardar',
    'common.cancel': 'Cancelar',
    'common.confirm': 'Confirmar',
    'common.delete': 'Eliminar',
    'common.edit': 'Editar',
    'common.loading': 'Cargando…',
    'common.back': 'Volver',
    'common.active': 'Activo',
    'common.suspended': 'Suspendida',
    'common.blocked': 'Bloqueada',
  },
  en: {
    // Navigation and layout
    'nav.home': 'Home',
    'nav.explore': 'Explore',
    'nav.feed': 'Feed',
    'nav.library': 'Library',
    'nav.search': 'Search',
    'nav.settings': 'Settings',
    'nav.profile': 'Profile',
    'nav.studio': 'ZUENA Studio',
    'nav.artist_dashboard': 'Artist Dashboard',
    'nav.admin_dashboard': 'Admin Dashboard',

    // Player & Transport
    'player.now_playing': 'Now Playing',
    'player.play': 'Play',
    'player.pause': 'Pause',
    'player.next': 'Next',
    'player.previous': 'Previous',
    'player.volume': 'Volume',
    'player.mute': 'Mute',
    'player.unmute': 'Unmute',
    'player.queue': 'Play Queue',
    'player.lyrics': 'Lyrics',
    'player.credits': 'Credits',
    'player.technical': 'Technical Details',
    'player.empty_queue': 'Queue is empty',

    // Island & Search
    'island.search_placeholder': 'Search songs, artists, or profiles…',
    'island.close': 'Close Island',
    'island.premieres': 'Premieres',
    'island.recent': 'Recently Played',

    // Settings & Languages
    'settings.title': 'Settings',
    'settings.language': 'Language',
    'settings.language_desc': 'Select interface language (Spanish or English).',
    'settings.country': 'Content Country',
    'settings.sound': 'Sound & Spatial Audio',
    'settings.appearance': 'Appearance & Theme',
    'settings.account': 'Account',
    'settings.artist_section': 'Artist Tools',
    'settings.admin_section': 'Administration Tools',
    'settings.privacy': 'Privacy & Legal',

    // Roles & permissions
    'role.owner': 'Owner',
    'role.admin': 'Administration',
    'role.team': 'Zuena Team',
    'role.artist': 'Artist',
    'role.listener': 'Listener',
    'role.verified_artist': 'Verified Artist',

    // Admin Dashboard
    'admin.title': 'Administration Dashboard',
    'admin.subtitle': 'Claims verification, music upload approvals, feed moderation, and user management.',
    'admin.claims': 'Artist Profile Claims',
    'admin.releases': 'Music Uploads & Releases',
    'admin.feed_mod': 'Feed Moderation',
    'admin.users': 'User Account Management',
    'admin.approve': 'Approve',
    'admin.reject': 'Reject',
    'admin.request_changes': 'Request Changes',
    'admin.revoke': 'Revoke',
    'admin.delete_post': 'Delete Post',
    'admin.delete_comment': 'Delete Comment',
    'admin.suspend_account': 'Suspend Account',
    'admin.block_account': 'Block Account',
    'admin.reactivate_account': 'Reactivate Account',
    'admin.delete_account': 'Delete Account',
    'admin.no_pending_claims': 'No pending artist claims at this time.',
    'admin.no_pending_releases': 'No pending releases awaiting approval.',
    'admin.action_success': 'Administrative action executed successfully.',
    'admin.access_denied': 'Access restricted strictly to administration accounts.',

    // Artist Dashboard
    'artist.dashboard_title': 'ZUENA for Artists',
    'artist.dashboard_sub': 'Real-time analytics, audience reach, track performance, and payout withdrawals.',
    'artist.monthly_listeners': 'Monthly Listeners',
    'artist.total_streams': 'Total Streams',
    'artist.followers': 'Followers',
    'artist.saves': 'Library Saves',
    'artist.top_tracks': 'Top Performing Tracks',
    'artist.top_regions': 'Top Countries & Regions',
    'artist.payouts_title': 'Balance & Payout Withdrawals',
    'artist.available_balance': 'Available Balance',
    'artist.min_payout_notice': 'Minimum withdrawal is €10.00.',
    'artist.request_payout': 'Request Withdrawal',
    'artist.payout_amount': 'Withdrawal Amount (€)',
    'artist.payout_method': 'Payment Method (Stripe Connect or Bank Transfer)',
    'artist.payout_history': 'Withdrawal History',
    'artist.payout_status_pending': 'Pending',
    'artist.payout_status_paid': 'Paid',
    'artist.payout_status_failed': 'Rejected',
    'artist.stripe_connect_btn': 'Connect with Stripe',
    'artist.stripe_connected': 'Stripe account connected for automated payouts.',
    'artist.payout_requested': 'Payout request submitted successfully.',
    'artist.payout_err_min': 'Minimum withdrawal amount is €10.00.',
    'artist.payout_err_balance': 'Amount exceeds available balance.',

    // General
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.confirm': 'Confirm',
    'common.delete': 'Delete',
    'common.edit': 'Edit',
    'common.loading': 'Loading…',
    'common.back': 'Back',
    'common.active': 'Active',
    'common.suspended': 'Suspended',
    'common.blocked': 'Blocked',
  },
};

let currentLanguage = 'es';

export function getLanguage() {
  return currentLanguage;
}

export function setLanguage(lang) {
  if (lang === 'en' || lang === 'es') {
    currentLanguage = lang;
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('lang', lang);
    }
  }
  return currentLanguage;
}

export function t(key, fallback = '') {
  const dict = DICT[currentLanguage] || DICT.es;
  return dict[key] || DICT.es[key] || fallback || key;
}
