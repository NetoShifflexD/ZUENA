// Textos legales de ZUENA (2026-11-02). TODOS SON BORRADORES pendientes de revisión profesional:
// describen lo que la app hace hoy (datos en el navegador, cuenta en la nube opcional, Google Fonts,
// sin publicidad y sin cobros activos) y dejan "pendiente" lo que no está decidido (titular, domicilio,
// identificación fiscal, dominio de correo, edad mínima definitiva). No inventar datos acá.
// Formato: secciones [título, bloques]; un bloque string es un párrafo, un array es una lista.
import { MIN_AGE } from './consent.js';

export const LEGAL_UPDATED = '2026-11-02';
export const PENDING = 'pendiente de definir';

// correos por área: el dominio todavía no existe, por eso se muestran como "próximamente"
export const CONTACT_AREAS = [
  { id: 'support', name: 'Ayuda general', text: 'Dudas sobre tu cuenta, la app o un problema técnico.' },
  { id: 'artists', name: 'Artistas', text: 'Perfiles de artista, reclamos de perfil, lanzamientos y estrenos.' },
  { id: 'copyright', name: 'Derechos de autor', text: 'Denuncias por contenido que infringe tus derechos y contranotificaciones.' },
  { id: 'legal', name: 'Legal', text: 'Requerimientos de autoridades y consultas legales.' },
  { id: 'privacy', name: 'Privacidad', text: 'Acceso, rectificación, supresión, portabilidad u oposición sobre tus datos.' },
  { id: 'security', name: 'Seguridad', text: 'Reportes de vulnerabilidades o accesos indebidos.' },
];

export const contactAddress = (id) => `${id}@…`;

const OWNER = [
  `Titular del servicio: ${PENDING} (razón social, domicilio y número de identificación fiscal pendientes).`,
  'Contacto: los correos por área están en Contacto y se habilitan cuando ZUENA tenga dominio propio.',
];

export const LEGAL_DOCS = [
  {
    id: 'contacto', icon: 'mail', title: 'Contacto', lead: 'A quién escribir según el tema.',
    sections: [
      ['Correos por área', ['Cada área tendrá su propio correo. Todavía no tenemos dominio definitivo, así que las direcciones aparecen como «próximamente». No uses direcciones que no figuren acá.']],
      ['Mientras tanto', ['ZUENA está en preregistro. Si encontrás un problema de seguridad o un contenido que infringe tus derechos, guardá los datos (enlace, captura, fecha) para enviarlos apenas el canal esté disponible.']],
    ],
  },
  {
    id: 'terminos', icon: 'check', title: 'Términos del servicio', lead: 'Las reglas para usar ZUENA.',
    sections: [
      ['Quiénes somos', OWNER],
      ['Qué es ZUENA', [
        'ZUENA es una app para escuchar música, seguir artistas y publicar contenido. Escuchar y publicar es gratis y no hay publicidad.',
        'Hoy ZUENA está en preregistro: algunas funciones son de prueba y pueden cambiar o desaparecer.',
      ]],
      ['Tu cuenta', [
        [
          `Tenés que tener al menos ${MIN_AGE} años para crear una cuenta (edad mínima provisional, pendiente de definir por país).`,
          'Sos responsable de lo que se haga con tu cuenta y de mantener tu contraseña segura.',
          'Podés crear una cuenta con correo, con Google (si la nube está conectada) o seguir como invitado: la cuenta de invitado es local, temporal y vence a los 7 días.',
          'Con correo en modo local, tu cuenta queda guardada sólo en este navegador: si borrás los datos del navegador, se pierde.',
        ],
      ]],
      ['Tu contenido', [
        'Lo que publicás sigue siendo tuyo. Al publicarlo nos das el permiso necesario para guardarlo, mostrarlo y reproducirlo dentro de ZUENA mientras siga publicado. El alcance exacto de esa licencia está pendiente de revisión profesional.',
        'Sólo podés subir contenido sobre el que tengas los derechos o permiso. La música que sumás desde tu equipo a tu biblioteca queda privada y no se publica.',
      ]],
      ['Uso aceptable', ['Tenés que respetar las Normas de la comunidad y la Política de copyright. Podemos retirar contenido o suspender cuentas que las incumplan.']],
      ['Pagos', ['Hoy ZUENA no cobra nada ni procesa pagos. Las suscripciones y apoyos a artistas se van a regir por términos propios cuando el sistema de pagos esté habilitado; hasta entonces no se muestran precios ni se aceptan cobros.']],
      ['Contenido de terceros', ['Algunas secciones muestran contenido de fuentes externas (por ejemplo, avances de Apple Music o radios públicas). Ese contenido pertenece a sus titulares y se rige por sus propias condiciones.']],
      ['Garantías y responsabilidad', [`El servicio se ofrece en estado de prueba. Las limitaciones de responsabilidad, la ley aplicable y la jurisdicción están ${PENDING} con asesoramiento profesional y respetarán los derechos que te da la ley de tu país.`]],
      ['Cambios', ['Si cambian estos términos, te vamos a pedir que aceptes la nueva versión antes de seguir usando tu cuenta.']],
    ],
  },
  {
    id: 'privacidad', icon: 'lock', title: 'Política de privacidad', lead: 'Qué datos usamos, para qué y dónde quedan.',
    sections: [
      ['Responsable', OWNER],
      ['Qué guardamos en tu navegador', [
        [
          'Cuenta local: correo y contraseña protegida con hash (nunca en texto plano), perfil, preferencias y gustos.',
          'Tu biblioteca: los archivos de música que sumás quedan en este navegador (IndexedDB) y no se suben a ningún servidor.',
          'Historial de escucha, playlists, publicaciones y ajustes de sonido y apariencia.',
        ],
        'Todo esto queda en tu equipo. La biblioteca se vacía desde Ajustes; el resto, borrando los datos del sitio en tu navegador.',
      ]],
      ['Qué sale de tu equipo', [
        [
          'Si iniciás sesión con Google o en la nube: tu correo, nombre e identificador de cuenta se guardan en nuestro proveedor de base de datos y autenticación (Supabase). También registramos qué versión de los términos aceptaste y cuándo.',
          'Tipografías: tu navegador descarga fuentes de Google Fonts y Google recibe tu dirección IP.',
          'Contenido externo: al reproducir avances o radios, tu navegador se conecta a esos servicios (por ejemplo Apple o Radio Browser), que reciben tu IP.',
        ],
      ]],
      ['Qué no hacemos', [['No hay publicidad ni analítica de terceros.', 'No vendemos tus datos.', 'No procesamos pagos ni pedimos datos de tarjeta.']]],
      ['Para qué y con qué base', [`Usamos los datos para prestarte el servicio que pediste (tu cuenta, tu biblioteca, tus preferencias). La base jurídica precisa por país, los plazos de conservación y las transferencias internacionales están ${PENDING} con asesoramiento profesional.`]],
      ['Tus derechos', ['Podés pedir acceso, rectificación, supresión, portabilidad u oposición. El canal es el correo de privacidad (próximamente, ver Contacto). Mientras tanto, los datos locales los controlás vos desde tu navegador.']],
      ['Menores', [`ZUENA no está pensada para menores de ${MIN_AGE} años (edad provisional). Si detectamos una cuenta de un menor de esa edad, la vamos a eliminar.`]],
    ],
  },
  {
    id: 'cookies', icon: 'settings', title: 'Política de cookies', lead: 'Qué guarda ZUENA en tu navegador.',
    sections: [
      ['En pocas palabras', ['ZUENA no usa cookies de publicidad ni de analítica. Guarda en tu navegador sólo lo necesario para funcionar y descarga tipografías de Google Fonts.']],
      ['Detalle', [[
        'Almacenamiento local (IndexedDB, localStorage, sessionStorage): sesión, cuenta local, preferencias, biblioteca, caché y tu elección sobre este aviso. Necesario.',
        'Google Fonts: descarga de tipografías desde servidores de Google. No crea cookies de ZUENA, pero Google recibe tu IP.',
        'Inicio de sesión con Google o en la nube: sólo si lo usás, el proveedor puede guardar sus datos de sesión.',
      ]]],
      ['Cómo cambiar tu elección', ['Desde Ajustes › Privacidad y legal, o con el botón de abajo. También podés borrar los datos del sitio desde tu navegador.']],
    ],
  },
  {
    id: 'normas', icon: 'user', title: 'Normas de la comunidad', lead: 'Cómo convivimos en ZUENA.',
    sections: [
      ['Lo básico', ['ZUENA es para la música y la gente que la hace y la escucha. Tratá a los demás con respeto.']],
      ['No está permitido', [[
        'Subir música, portadas o videos sin tener los derechos o el permiso de sus titulares.',
        'Hacerse pasar por otra persona, artista o marca.',
        'Acoso, amenazas, discursos de odio o contenido sexual con menores.',
        'Contenido ilegal, malware, estafas o spam.',
        'Inflar escuchas, seguidores o apoyos con bots, cuentas falsas o cualquier manipulación.',
        'Publicar datos personales de otras personas sin su permiso.',
      ]]],
      ['Contenido con inteligencia artificial', ['Si usás IA para crear contenido, indicalo. No está permitido clonar la voz o la imagen de una persona sin su permiso. La política completa está pendiente.']],
      ['Qué pasa si se incumplen', ['Podemos retirar el contenido, limitar funciones o suspender la cuenta, según la gravedad y la reincidencia. Vas a poder pedir una revisión de la decisión (el procedimiento está pendiente de definir).']],
      ['Cómo denunciar', ['Por el correo correspondiente de Contacto (próximamente). La opción de denunciar desde cada publicación o perfil todavía no está disponible.']],
    ],
  },
  {
    id: 'copyright', icon: 'disc', title: 'Política de copyright y denuncias', lead: 'Qué hacer si tu obra aparece sin permiso.',
    sections: [
      ['Principio', ['Quien publica en ZUENA conserva sus derechos y declara tener los necesarios. ZUENA sólo recibe el permiso para mostrar y reproducir el contenido dentro del servicio.']],
      ['Cómo denunciar una infracción', [
        'Escribí al correo de derechos de autor (próximamente, ver Contacto) con:',
        [
          'tus datos de contacto y, si actuás en nombre de otra persona, en calidad de qué;',
          'la obra protegida (título, titular, enlace si existe);',
          'el enlace exacto al contenido en ZUENA;',
          'una declaración de buena fe de que el uso no está autorizado y de que la información es exacta.',
        ],
      ]],
      ['Qué hacemos', ['Revisamos la denuncia, retiramos o bloqueamos el contenido si corresponde y avisamos a quien lo publicó, con la posibilidad de presentar una contranotificación. Las cuentas que infringen de forma reiterada pueden suspenderse.']],
      ['Marco aplicable', [`El procedimiento se adaptará a cada territorio (por ejemplo, el aviso y retirada de la DMCA en Estados Unidos y el mecanismo de notificación y acción de la Ley de Servicios Digitales en la Unión Europea). Los plazos y el agente designado están ${PENDING}.`]],
      ['Denuncias falsas', ['Las denuncias hechas de mala fe pueden tener consecuencias legales y llevar a la suspensión de la cuenta denunciante.']],
    ],
  },
  {
    id: 'aviso', icon: 'shield', title: 'Aviso legal', lead: 'Datos del titular del servicio.',
    sections: [
      ['Titular', [[
        `Razón social: ${PENDING}.`,
        `Domicilio: ${PENDING}.`,
        `Número de identificación fiscal: ${PENDING}.`,
        `Datos de registro: ${PENDING}.`,
        'Correo de contacto: próximamente (ver Contacto).',
      ]]],
      ['Objeto', ['ZUENA es una app web de música en preregistro. Escuchar y publicar es gratis, no hay publicidad y no se procesan pagos.']],
      ['Propiedad intelectual', ['La marca, el diseño y el código de ZUENA pertenecen a su titular. La música y las imágenes publicadas pertenecen a sus autores o titulares.']],
      ['Estado de estos textos', ['Todos los textos legales de ZUENA son borradores pendientes de revisión profesional y pueden cambiar antes del lanzamiento.']],
    ],
  },
];

export const legalDoc = (id) => LEGAL_DOCS.find((d) => d.id === id) || null;
