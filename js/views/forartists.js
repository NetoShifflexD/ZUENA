// ZUENA para artistas: presentación en "motion design" (escenas animadas con texto y sonido de cristal)
// y la página de ventajas. La animación es HTML/CSS: no hay archivo de video. El sonido se sintetiza
// (js/ui/sounds.js) y sólo arranca con el clic del usuario; respeta "Sonidos de interfaz" y "Animaciones".
import { app, registerActions } from '../app.js';
import { icon, logo } from '../ui/icons.js';
import { sounds } from '../ui/sounds.js';

// cada escena: título, bajada, duración y nota base del acorde (pentatónica de Do)
const SCENES = [
  { k: 'logo', t: 'ZUENA', s: 'Música que se siente.', ms: 4200, note: 261.63 },
  { k: 'upload', t: 'Publicá gratis.', s: 'Sin distribuidora y sin costo por subir tu música.', ms: 5200, note: 293.66 },
  { k: 'premiere', t: 'Estrenos con cuenta regresiva.', s: 'Tu público llega al segundo exacto del lanzamiento.', ms: 5200, note: 329.63 },
  { k: 'feed', t: 'Tu feed, tu comunidad.', s: 'Publicá, anclá lo importante y hablá con quienes te escuchan.', ms: 5200, note: 392.0 },
  { k: 'support', t: 'Apoyo directo.', s: '88 % de cada suscripción y 90 % de cada SoundDrop son tuyos.', ms: 5600, note: 440.0 },
  { k: 'sound', t: 'Sonido sin pérdida.', s: 'Tu mezcla, tal como la escuchaste en el estudio.', ms: 5200, note: 523.25 },
  { k: 'end', t: 'Hecho para artistas.', s: 'Empezá hoy. Es gratis.', ms: 5000, note: 392.0 },
];
const TOTAL = SCENES.reduce((a, s) => a + s.ms, 0);

export const VALUES = [
  ['upload', 'Publicá sin intermediarios', 'Subí singles, EPs y álbumes desde ZUENA Studio. Revisamos calidad y derechos, y quedan publicados en tu perfil.'],
  ['clock', 'Estrenos que generan expectativa', 'Programá la fecha y la hora: tus oyentes ven la cuenta regresiva en Inicio y en tu feed, y la canción se publica sola.'],
  ['feed', 'Una comunidad propia', 'Tu feed funciona como una red social: publicaciones, lanzamientos anclados y la conversación con tus fans.'],
  ['heart', 'Ingresos directos de tus fans', 'Niveles de suscripción mensual y SoundDrops (aportes únicos con mensaje). Vos te quedás con el 88 % y el 90 %.'],
  ['wave', 'Calidad de estudio', 'Reproducción sin pérdida, sonoridad normalizada por estándar y un motor de audio pensado para escuchar de verdad.'],
  ['shield', 'Tus derechos primero', 'Verificamos la identidad de cada artista para que nadie publique a tu nombre. Tu música sigue siendo tuya.'],
];

let run = null; // estado de la reproducción actual

// escenario de la presentación (se usa en la vista forartists y en la landing pública)
export const stageHtml = () => `
    <section class="fa-stage" aria-label="Presentación animada de ZUENA para artistas">
      <div class="fa-bg" aria-hidden="true"><i class="b1"></i><i class="b2"></i><i class="b3"></i>
        <svg class="fa-ribbon" viewBox="0 0 800 450" preserveAspectRatio="none"><path d="M-20 330 C 160 300, 260 180, 420 210 S 680 300, 820 150" pathLength="1"/></svg></div>
      <div class="fa-scene" aria-live="polite"></div>
      <div class="fa-poster">
        <span class="fa-logo">${logo()}</span>
        <button class="btn-primary lit fa-play" data-action="fa-play">${icon('play')}Reproducir presentación</button>
        <p class="hint">Con sonido. Podés silenciarlo en cualquier momento.</p>
      </div>
      <div class="fa-bar">
        <button class="btn-icon lit sm" data-action="fa-toggle" title="Pausar" aria-label="Pausar">${icon('pause')}</button>
        <div class="fa-progress" role="progressbar" aria-label="Avance de la presentación" aria-valuemin="0" aria-valuemax="100"><i></i></div>
        <button class="btn-icon lit sm" data-action="fa-mute" title="Silenciar" aria-label="Silenciar">${icon('volume')}</button>
        <button class="btn-icon lit sm" data-action="fa-replay" title="Ver de nuevo" aria-label="Ver de nuevo">${icon('repeat')}</button>
      </div>
    </section>`;

export function viewForArtists() {
  app.ui.mount = (root) => attachPresentation(root);
  const claim = app.artist?.claim?.status;
  const cta = claim === 'approved' ? ['studio', 'Ir a ZUENA Studio'] : claim ? ['claim', 'Ver mi solicitud'] : ['claim', 'Empezar como artista'];
  return `<div class="fa">
    <header class="fa-head enter"><p class="eyebrow">ZUENA para artistas</p>
      <h1>Tu música merece un lugar propio.</h1>
      <p class="muted">Mirá la presentación (${Math.round(TOTAL / 1000)} s, con sonido).</p></header>

    ${stageHtml()}

    <section class="fa-values">${VALUES.map(([ic, t, d], i) => `
      <article class="fa-card glass-soft enter" style="--i:${i + 2}"><span class="fa-ico">${icon(ic)}</span><h3>${t}</h3><p>${d}</p></article>`).join('')}
    </section>

    <section class="fa-steps glass-soft enter" style="--i:8"><h2 class="section-title">Cómo empezar</h2>
      <ol><li><b>Solicitá tu perfil de artista.</b> Vinculá tu plataforma musical y una red social para verificar que sos vos.</li>
        <li><b>Subí tu música en ZUENA Studio.</b> Carátula, créditos y, si querés, fecha de estreno.</li>
        <li><b>Hacé crecer tu comunidad.</b> Publicá en tu feed y activá el apoyo de tus fans cuando los pagos estén habilitados.</li></ol>
      <div class="hero-actions"><button class="btn-primary lit" data-action="nav" data-view="${cta[0]}">${icon('mic')}${cta[1]}</button>
        <button class="btn-glass lit" data-action="nav" data-view="home">Volver al inicio</button></div>
      <p class="hint">Los cobros (suscripciones y SoundDrops) se activan cuando el servidor de pagos esté en marcha: hasta entonces no se procesa ningún pago.</p>
    </section>
  </div>`;
}

export function attachPresentation(root) {
  stop();
  run = { root, stage: root.querySelector('.fa-stage'), idx: -1, t0: 0, elapsed: 0, paused: true, raf: 0, timer: 0, muted: !sounds.enabled };
  syncMute();
}

function stop() {
  if (!run) return;
  cancelAnimationFrame(run.raf);
  clearTimeout(run.timer);
  run = null;
}

// letras que entran una por una (spans con retardo); el texto completo queda para lectores de pantalla
const letters = (txt, base = 0) => [...txt].map((c, i) => `<span style="--l:${base + i}">${c === ' ' ? '&nbsp;' : c}</span>`).join('');

function sceneHtml(sc) {
  const motif = {
    logo: `<span class="fa-logo big">${logo()}</span>`,
    upload: '<div class="fa-motif fa-up"><i></i><i></i><i></i></div>',
    premiere: '<div class="fa-motif fa-count"><b>00</b><span>:</span><b>00</b><span>:</span><b>10</b></div>',
    feed: '<div class="fa-motif fa-posts"><i></i><i></i><i></i></div>',
    support: '<div class="fa-motif fa-split"><b>88%</b><b>90%</b></div>',
    sound: '<div class="fa-motif fa-wave">' + Array.from({ length: 24 }, (_, i) => `<i style="--w:${i}"></i>`).join('') + '</div>',
    end: `<span class="fa-logo big">${logo()}</span>`,
  }[sc.k];
  return `<div class="fa-sc fa-${sc.k}">${motif}<h2 aria-label="${sc.t}"><span aria-hidden="true">${letters(sc.t)}</span></h2><p>${sc.s}</p></div>`;
}

function show(i) {
  const sc = SCENES[i];
  run.idx = i;
  const box = run.root.querySelector('.fa-scene');
  const old = box.firstElementChild;
  if (old) { old.classList.add('out'); setTimeout(() => old.remove(), 600); }
  box.insertAdjacentHTML('beforeend', sceneHtml(sc));
  requestAnimationFrame(() => box.lastElementChild?.classList.add('in'));
  run.stage.dataset.scene = sc.k;
  if (!run.muted) {
    if (i > 0) sounds.whoosh(0.5, 0.05);
    setTimeout(() => run && !run.muted && sounds.chord(sc.note, 0.045), i > 0 ? 220 : 0);
  }
}

function tick() {
  if (!run || !run.stage?.isConnected) { stop(); return; }
  const t = run.elapsed + (performance.now() - run.t0);
  const bar = run.stage.querySelector('.fa-progress i');
  if (bar) bar.style.transform = `scaleX(${Math.min(1, t / TOTAL)})`;
  let acc = 0, i = 0;
  while (i < SCENES.length - 1 && t >= acc + SCENES[i].ms) acc += SCENES[i++].ms;
  if (i !== run.idx) show(i);
  if (t >= TOTAL) { pause(true); run.stage.classList.add('done'); return; }
  run.raf = requestAnimationFrame(tick);
}

function play() {
  if (!run) return;
  if (run.stage.classList.contains('done')) restart();
  run.paused = false;
  run.t0 = performance.now();
  run.stage.classList.add('playing');
  run.stage.classList.remove('paused');
  setToggleIcon();
  sounds.resume();
  run.raf = requestAnimationFrame(tick);
}

function pause(ended = false) {
  if (!run || run.paused) return;
  run.elapsed += performance.now() - run.t0;
  run.paused = true;
  cancelAnimationFrame(run.raf);
  if (!ended) run.stage.classList.add('paused');
  setToggleIcon();
}

function restart() {
  run.elapsed = 0;
  run.idx = -1;
  run.stage.classList.remove('done');
  run.root.querySelector('.fa-scene').innerHTML = '';
}

function setToggleIcon() {
  const b = run.root.querySelector('[data-action="fa-toggle"]');
  if (!b) return;
  const label = run.paused ? 'Reproducir' : 'Pausar';
  b.innerHTML = icon(run.paused ? 'play' : 'pause');
  b.title = label;
  b.setAttribute('aria-label', label);
}

function syncMute() {
  const b = run?.root.querySelector('[data-action="fa-mute"]');
  if (!b) return;
  const label = run.muted ? 'Activar sonido' : 'Silenciar';
  b.innerHTML = icon(run.muted ? 'mute' : 'volume');
  b.title = label;
  b.setAttribute('aria-label', label);
}

registerActions({
  'fa-play': () => {
    if (!run) return;
    // el sonido de la presentación sigue el ajuste "Sonidos de interfaz"; si están apagados, arranca en silencio
    run.muted = !sounds.enabled;
    syncMute();
    play();
  },
  'fa-toggle': () => { if (run) (run.paused ? play() : pause()); },
  'fa-replay': () => { if (!run) return; pause(); restart(); play(); },
  'fa-mute': () => {
    if (!run) return;
    if (run.muted && !sounds.enabled) { app.toast?.('Activá "Sonidos de interfaz" en Ajustes → Apariencia para escucharla'); return; }
    run.muted = !run.muted;
    syncMute();
  },
});
