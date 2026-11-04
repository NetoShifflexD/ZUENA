// Paneles: ecualizador, cola y ajustes. Lo técnico (LUFS, limitador, motor) sólo en Modo avanzado.
import { app } from '../app.js';
import { APP_VERSION, staleness } from '../version.js';
import { EQ_BANDS, EQ_PRESETS } from '../audio/eq.js';
import { icon } from '../ui/icons.js';
import { esc, fmtTime, fmtHz, fmtRate } from '../ui/format.js';
import { PRESETS, MODES, modeOf, FONTS, DEFAULT_FONT, loadFont, fontStack } from '../theme/theme.js';
import { LOOK, ACCENTS, lookValue } from '../ui/appearance.js';
import { REGIONS } from '../catalog/genres.js';
import { CLAIM_STATUS } from '../data/artist.js';
import { art, avatar, statusPill, tick } from './common.js';
import { authLabel } from './auth.js';
import { LEGAL_DOCS } from '../legal/docs.js';
import { cookieChoiceLabel } from '../legal/cookies.js';
import { getConsent, consentSummary } from '../legal/consent.js';

export function panelHead(title, extra = '') {
  return `<header class="panel-head"><h3>${title}</h3>${extra}<button class="btn-icon lit sm" data-action="close-panel" title="Cerrar">${icon('close')}</button></header>`;
}

function toggleRow(key, label, hint, on) {
  return `<label class="toggle-row lit"><div><div class="toggle-label">${label}</div><div class="hint">${hint}</div></div>
    <span class="switch"><input type="checkbox" data-setting="${key}" ${on ? 'checked' : ''}><i></i></span></label>`;
}

export function panelEq(fromSettings = false) {
  const s = app.engine.settings;
  const adv = app.prefs.advanced;
  const active = Object.entries(EQ_PRESETS).find(([, g]) => g.every((v, i) => v === s.eq[i]))?.[0];
  const sw = `<span class="switch"><input type="checkbox" data-setting="eqOn" aria-label="Activar ecualizador" ${s.eqOn ? 'checked' : ''}><i></i></span>`;
  // abierto desde Ajustes: misma cabecera que las demás categorías, con "volver"
  const head = fromSettings
    ? `<header class="panel-head set-head"><button class="btn-icon lit sm set-back" data-action="settings-back" aria-label="Volver a Ajustes" title="Ajustes">${icon('chevronLeft')}</button><h3>Ecualizador</h3>${sw}<button class="btn-icon lit sm" data-action="close-panel" title="Cerrar">${icon('close')}</button></header>`
    : panelHead('Ecualizador', sw);
  return `${head}
    <div class="panel-body">
      <canvas class="eq-curve" id="eq-curve"></canvas>
      <div class="eq-sliders ${s.eqOn ? '' : 'off'}">${EQ_BANDS.map((b, i) => `
        <div class="eq-band">
          <span class="eq-val" id="eqv-${i}">${s.eq[i] > 0 ? '+' : ''}${s.eq[i]}</span>
          <input type="range" class="range v" min="-12" max="12" step="0.5" value="${s.eq[i]}" data-eq="${i}" aria-label="${fmtHz(b.freq)} Hz">
          <span class="eq-f">${fmtHz(b.freq)}</span>
        </div>`).join('')}
      </div>
      <div class="chips">${Object.keys(EQ_PRESETS).map((n) => `<button class="chip lit ${n === active ? 'on' : ''}" data-action="eq-preset" data-name="${n}">${n}</button>`).join('')}</div>
      <p class="hint">Doble clic en una banda la vuelve a 0.${adv ? ' Filtros biquad (shelf + peaking, Q 1.41), preamp automático y limitador true-peak a −1 dBTP.' : ''}</p>
    </div>`;
}

function queueItem(t, pos, current = false) {
  return `<div class="qitem lit ${current ? 'is-current' : ''}" ${pos >= 0 ? `data-action="queue-play" data-pos="${pos}"` : ''}>
    ${art(t, 'xs')}
    <div class="row-main"><div class="row-title">${esc(t.title)}</div><div class="row-sub">${esc(t.artist || '')}${tick(t.verified)}</div></div>
    <span class="row-dur">${t.live ? 'En vivo' : t.duration ? fmtTime(t.duration) : '—'}</span>
  </div>`;
}

export function panelQueue() {
  const cur = app.player.current;
  const up = app.player.upcoming();
  return `${panelHead('A continuación', up.length ? '<button class="link small" data-action="queue-clear">Vaciar</button>' : '')}
    <div class="panel-body">
      ${cur ? `<h4>Sonando</h4>${queueItem(cur, -1, true)}` : '<p class="hint">La cola está vacía. Elegí una canción, un mix, un podcast o una radio.</p>'}
      ${up.length ? `<h4>Después${app.player.shuffle ? ' · aleatorio' : ''}${app.player.repeat === 'all' ? ' · repetir' : ''}</h4>${up.map((u) => queueItem(u.track, u.pos)).join('')}` : ''}
    </div>`;
}

// Salida multicanal: el sistema (Dolby Atmos para auriculares, Windows Sonic o un receptor) hace el resto
function outputField(s, adv) {
  const max = app.engine.ctx.destination.maxChannelCount;
  const opts = [['stereo', 'Estéreo', 2], ['5.1', '5.1', 6], ['7.1', '7.1', 8]];
  const active = app.engine.outChannels;
  const hint = max < 6
    ? 'Tu equipo solo admite estéreo. Si usás Dolby Atmos o Windows Sonic, activalo en Windows (Configuración › Sistema › Sonido › tu dispositivo › Audio espacial) y volvé a abrir ZUENA.'
    : active > 2
      ? `ZUENA envía ${active === 8 ? '7.1' : '5.1'} canales reales: voces al centro, graves al subwoofer y ambiente atrás. Si tenés Dolby Atmos o Windows Sonic activo, ellos los convierten en sonido envolvente.`
      : 'Elegí 5.1 o 7.1 si tenés un equipo envolvente o Dolby Atmos / Windows Sonic en Windows.';
  return `<div class="field"><span>Canales de salida${adv ? ` <b>${max} disponibles</b>` : ''}</span>
    <div class="seg three">${opts.map(([v, l, n]) => `<button class="seg-btn lit ${s.output === v ? 'on' : ''}" data-action="set-output" data-v="${v}" aria-pressed="${s.output === v}" ${n > max ? 'disabled' : ''}>${l}</button>`).join('')}</div>
    <span class="hint">${hint}</span></div>`;
}

function headphoneField(s, adv) {
  const p = s.headphoneEq;
  return `<div class="field"><span>Corrección de auriculares</span>
    ${p ? `<label class="toggle-row lit"><div><div class="toggle-label">${esc(p.name)}</div><div class="hint">Sonido ajustado a la curva de referencia${adv ? ` · ${esc(p.source)} · ${p.filters.length} filtros · preamp ${p.preamp} dB` : ''}</div></div>
      <span class="switch"><input type="checkbox" data-setting="headphoneEqOn" ${s.headphoneEqOn ? 'checked' : ''}><i></i></span></label>
      <button class="btn-glass lit sm" data-action="hp-clear">${icon('close')}Quitar perfil</button>`
    : `<input class="input lit" id="hp-search" type="search" placeholder="Buscá tu modelo (ej. Sony WH-1000XM5)" autocomplete="off" aria-label="Buscar modelo de auriculares">
      <div class="hp-results" id="hp-results" role="listbox"></div>
      <span class="hint">Ajusta el sonido a tu modelo con mediciones de laboratorio. Más de 8.000 auriculares.</span>`}
  </div>`;
}

// ---------- Ajustes en dos niveles: lista de categorías → categoría (Requisitos/Ajustes por categorías) ----------
const TARGETS = [[-14, 'Normal (recomendado)', '−14 LUFS'], [-16, 'Suave', '−16 LUFS · Apple Music'], [-18, 'Dinámico', '−18 LUFS · ReplayGain'], [-23, 'Máxima dinámica', '−23 LUFS · EBU R128']];
const SPATIAL = [['off', 'Apagado'], ['wide', 'Amplio'], ['spatial', 'Espacial']];
const SPATIAL_HINT = { off: 'Sonido original, sin cambios.', wide: 'Escena más abierta, ideal para parlantes.', spatial: 'Sonido envolvente en auriculares: la música te rodea.' };
const MODE_LABEL = Object.fromEntries(MODES);

// categorías visibles para el estado actual (sesión, modo local, admin)
export function settingsCategories() {
  const s = app.engine.settings, p = app.profile, adv = !!app.prefs.advanced, claim = app.artist.claim;
  const theme = PRESETS.find((t) => t.id === p?.theme)?.name || 'Prisma';
  const sound = [SPATIAL.find(([v]) => v === s.spatial && v !== 'off')?.[1], s.normalize && 'Volumen parejo', s.smartVolume && 'Volumen inteligente'].filter(Boolean);
  const ch = { 8: '7.1', 6: '5.1' }[app.engine.outChannels] || 'Estéreo';
  const hp = s.headphoneEq && s.headphoneEqOn ? `${adv ? 'AutoEQ ' : ''}${s.headphoneEq.name}` : ch !== 'Estéreo' ? 'Auriculares sin corregir' : '';
  const n = app.library.tracks.length;
  const list = [
    { id: 'sonido', icon: 'wave', name: 'Sonido', sub: sound.slice(0, 2).join(' · ') || 'Sin efectos' },
    { id: 'salida', icon: 'headphones', name: 'Salida y auriculares', sub: [ch, hp].filter(Boolean).join(' · ') },
    { id: 'eq', icon: 'eq', name: 'Ecualizador', sub: s.eqOn ? `Activado · ${eqPresetName(s.eq)}` : 'Desactivado' },
    { id: 'apariencia', icon: 'palette', name: 'Apariencia', sub: `${MODE_LABEL[modeOf(p?.mode)]} · ${theme}` },
    { id: 'inicio', icon: 'sparkle', name: 'Inicio y recomendaciones', sub: `${REGIONS.find((r) => r.id === app.taste.data.region)?.label || 'Global'}${app.taste.data.done ? ' · con tus gustos' : ''}` },
    { id: 'biblioteca', icon: 'library', name: 'Biblioteca', sub: n ? `${n} canciones` : 'Vacía' },
  ];
  if (p) list.push({ id: 'cuenta', icon: 'user', name: 'Cuenta', sub: app.user?.mode === 'cloud' ? 'Google · nube' : app.auth.mode === 'local' ? 'Cuenta local' : app.user?.providerId === 'google.com' ? 'Google' : 'Correo' });
  if (p) list.push({ id: 'artista', icon: claim?.status === 'approved' ? 'disc' : 'mic', name: 'Artista', sub: claim?.status === 'approved' ? 'Estudio de artista' : claim?.status === 'rejected' ? 'Reclamo rechazado' : claim ? 'Reclamo en revisión' : 'Subí tu música gratis' });
  list.push({ id: 'legal', icon: 'shield', name: 'Privacidad y legal', sub: `Cookies: ${cookieChoiceLabel().toLowerCase()} · textos en borrador` });
  list.push({ id: 'avanzado', icon: 'gauge', name: 'Avanzado', sub: adv ? 'Activado' : 'Desactivado' });
  if (app.auth.mode === 'local') list.push({ id: 'desarrollo', icon: 'code', name: 'Desarrollo', sub: app.prefs.dev ? 'Activado' : 'Desactivado' });
  else if (app.auth.isAdmin) list.push({ id: 'desarrollo', icon: 'shield', name: 'Administración', sub: 'Revisión de reclamos' });
  return list;
}

function eqPresetName(eq) {
  const hit = Object.entries(EQ_PRESETS).find(([, v]) => v.every((g, i) => Math.abs(g - (eq?.[i] || 0)) < 0.05));
  return hit ? hit[0] : 'A medida';
}

export function panelSettings(view = null) {
  const cats = settingsCategories();
  const cat = cats.find((c) => c.id === view);
  if (!cat) return settingsList(cats);
  return `<header class="panel-head set-head">
      <button class="btn-icon lit sm set-back" data-action="settings-back" aria-label="Volver a Ajustes" title="Ajustes">${icon('chevronLeft')}</button>
      <h3>${cat.name}</h3>
      <button class="btn-icon lit sm" data-action="close-panel" title="Cerrar">${icon('close')}</button></header>
    <div class="panel-body set-body">${SECTIONS[cat.id]()}</div>`;
}

function settingsList(cats) {
  const p = app.profile;
  // Las categorías mantienen sus rutas y condiciones; los grupos ayudan a encontrarlas.
  const groups = [
    ['Tu experiencia', ['sonido', 'salida', 'eq', 'apariencia', 'inicio']],
    ['Tu espacio', ['biblioteca', 'cuenta', 'artista']],
    ['Control y privacidad', ['legal', 'avanzado', 'desarrollo']],
  ];
  const grouped = new Set(groups.flatMap(([, ids]) => ids));
  const extra = cats.filter((c) => !grouped.has(c.id));
  if (extra.length) groups.push(['Otros ajustes', extra.map((c) => c.id)]);
  return `${panelHead('Ajustes')}
    <div class="panel-body set-list">
      <p class="set-intro">Hacé ZUENA tuya. Elegí qué querés ajustar.</p>
      ${p ? `<button class="account-card lit" data-action="nav" data-view="profile">${avatar(p, 'md')}<span class="row-main"><span class="row-title">${esc(p.displayName)}${tick(p.role === 'artist')}</span><span class="row-sub">Ver perfil</span></span>${icon('arrowRight')}</button>`
        : '<p class="hint">Iniciá sesión para guardar tus ajustes.</p>'}
      <nav class="set-cats" aria-label="Categorías de ajustes">${groups.map(([title, ids]) => `<h4 class="set-group">${title}</h4>${cats.filter((c) => ids.includes(c.id)).map((c) => `
        <button class="set-cat lit" data-action="settings-cat" data-cat="${c.id}">
          <span class="set-ico">${icon(c.icon)}</span>
          <span class="row-main"><span class="row-title">${c.name}</span><span class="row-sub">${esc(c.sub)}</span></span>
          ${icon('arrowRight')}</button>`).join('')}`).join('')}
      </nav>
    </div>`;
}

const SECTIONS = {
  sonido() {
    const s = app.engine.settings, adv = !!app.prefs.advanced;
    return `<div class="field"><span>Audio espacial</span>
        <div class="seg three">${SPATIAL.map(([v, l]) => `<button class="seg-btn lit ${s.spatial === v ? 'on' : ''}" data-action="set-spatial" data-v="${v}" aria-pressed="${s.spatial === v}">${l}</button>`).join('')}</div>
        <span class="hint">${SPATIAL_HINT[s.spatial]}</span></div>
      ${toggleRow('crossfeed', 'Sonido natural en auriculares', 'Mezcla un poco de cada lado en el otro oído, como con parlantes. Cansa menos.', s.crossfeed)}
      ${toggleRow('smartVolume', 'Volumen inteligente', 'Cuando escuchás bajito, realza graves y agudos para que no se pierdan.', s.smartVolume)}
      ${toggleRow('normalize', 'Volumen parejo', 'Todas las canciones suenan al mismo nivel.', s.normalize)}
      ${s.normalize ? `<label class="field"><span>Nivel</span>
        <select class="select lit" data-setting="target">${TARGETS.map(([v, l, tech]) => `<option value="${v}" ${s.target === v ? 'selected' : ''}>${l}${adv ? ` · ${tech}` : ''}</option>`).join('')}</select></label>` : ''}
      <label class="field"><span>Transición entre canciones <b id="xf-val">${s.crossfade ? `${s.crossfade} s` : 'Sin cortes'}</b></span>
        <input type="range" class="range" min="0" max="12" step="1" value="${s.crossfade}" data-setting="crossfade"></label>`;
  },
  salida() {
    const s = app.engine.settings, adv = !!app.prefs.advanced;
    return `<label class="field" id="sink-field" hidden><span>Salida de audio</span><select class="select lit" data-setting="sinkId"></select></label>
      ${outputField(s, adv)}
      ${headphoneField(s, adv)}`;
  },
  eq: () => '',
  // Apariencia v2: vista previa en vivo, modo con muestras, tema, acento propio, tipografía y ajustes del equipo
  apariencia() {
    const p = app.profile;
    const mode = modeOf(p?.mode);
    const seg = (k) => `<div class="field"><span>${LOOK[k].label}</span><div class="seg ${LOOK[k].opts.length === 3 ? 'three' : 'two'}">${LOOK[k].opts.map(([v, l]) => `<button class="seg-btn lit ${lookValue(k) === v ? 'on' : ''}" data-action="look-pref" data-k="${k}" data-v="${v}" aria-pressed="${lookValue(k) === v}">${l}</button>`).join('')}</div>${LOOK[k].hint ? `<span class="hint">${LOOK[k].hint}</span>` : ''}</div>`;
    const ambient = app.prefs.ambient !== false;
    return `<div class="ap-preview" aria-hidden="true">
        <div class="ap-pv-bg"><i></i><i></i></div>
        <div class="ap-pv-island"><span></span><b>ZUENA</b></div>
        <div class="ap-pv-card"><span class="ap-pv-art"></span><span class="ap-pv-lines"><b style="font-family:${fontStack(p?.font)}">Así se ve ZUENA</b><i></i><i></i></span><span class="ap-pv-btn">Reproducir</span></div>
        <div class="ap-pv-bar"><span class="ap-pv-art sm"></span><i></i><span class="ap-pv-play"></span></div>
      </div>
      ${p ? `<div class="field"><span>Modo</span><div class="ap-modes">${MODES.map(([v, l]) => `<button class="ap-mode lit ${mode === v ? 'on' : ''}" data-action="set-mode" data-v="${v}" aria-pressed="${mode === v}"><span class="ap-mode-sw ${v}"><i></i><i></i></span><span>${l}</span></button>`).join('')}</div></div>
      <div class="field"><span>Tema</span><div class="theme-grid compact">${PRESETS.map((t) => `<button class="theme-chip lit ${p.theme === t.id && !p.accent ? 'on' : ''}" data-action="set-theme" data-theme="${t.id}" style="--a:${t.accent};--b:${t.accent2}" title="${t.name}" aria-pressed="${p.theme === t.id && !p.accent}"><i></i><span>${t.name}</span></button>`).join('')}</div></div>
      <div class="field"><span>Color de acento</span><div class="ap-accents">
        ${ACCENTS.map((c) => `<button class="ap-accent lit ${p.accent === c ? 'on' : ''}" data-action="set-accent" data-v="${c}" style="--c:${c}" aria-label="Acento ${c}" aria-pressed="${p.accent === c}"></button>`).join('')}
        <label class="ap-accent ap-accent-pick ${p.accent && !ACCENTS.includes(p.accent) ? 'on' : ''}" title="Elegir otro color"><input type="color" data-accent-pick value="${esc(p.accent || PRESETS.find((t) => t.id === p.theme)?.accent || '#218cb1')}" aria-label="Elegir otro color de acento">${icon('plus')}</label>
        ${p.accent ? '<button class="link small" data-action="set-accent" data-v="">Usar el del tema</button>' : ''}</div></div>
      <div class="field"><span>Tipografía de títulos</span><div class="ap-fonts">${FONTS.map((f) => { loadFont(f.id); const on = (p.font || DEFAULT_FONT) === f.id; return `<button class="ap-font lit ${on ? 'on' : ''}" data-action="set-font" data-font="${f.id}" aria-pressed="${on}"><b style="font-family:${fontStack(f.id)}">Aa</b><span>${f.label}</span></button>`; }).join('')}</div></div>`
      : '<p class="hint">Iniciá sesión para elegir modo, tema, color y tipografía.</p>'}
      <h4 class="ap-sub">En este equipo</h4>
      ${seg('density')}${seg('glass')}${seg('text')}
      <div class="field"><span>Luz ambiental</span><div class="seg two">${[['on', 'Con reflejos'], ['off', 'Liso']].map(([v, l]) => `<button class="seg-btn lit ${(ambient ? 'on' : 'off') === v ? 'on' : ''}" data-action="look-ambient" data-v="${v}" aria-pressed="${(ambient ? 'on' : 'off') === v}">${l}</button>`).join('')}</div></div>
      ${toggleRow('motion', 'Animaciones', 'Transiciones, aparición de secciones y efectos de luz.', app.prefs.motion !== false)}
      ${toggleRow('uiSounds', 'Sonidos de interfaz', 'Toques suaves de cristal al pasar el mouse y al hacer clic.', app.prefs.uiSounds !== false)}
      <button class="btn-glass lit ap-reset" data-action="look-reset">Restablecer la apariencia</button>`;
  },
  inicio() {
    return `<label class="field"><span>País del contenido</span><select class="select lit" data-action-change="region">${REGIONS.map((r) => `<option value="${r.id}" ${app.taste.data.region === r.id ? 'selected' : ''}>${r.label}</option>`).join('')}</select>
        <span class="hint">Cambia las canciones y radios que te mostramos en Inicio.</span></label>
      <button class="btn-glass lit" data-action="taste-test">${icon('sparkle')}Rehacer el test de gustos</button>`;
  },
  biblioteca() {
    const n = app.library.tracks.length, adv = !!app.prefs.advanced;
    return `<p class="hint">${n ? `${n} canciones en este equipo` : 'Todavía no agregaste canciones'}${adv && app.library.pendingCount ? ` · ${app.library.pendingCount} por analizar` : ''}</p>
      <div class="row-btns">
        <button class="btn-glass lit" data-action="import-files">${icon('plus')}Agregar música</button>
        ${n ? `<button class="btn-glass danger lit" data-action="clear-library">${icon('trash')}Vaciar biblioteca</button>` : ''}
      </div>`;
  },
  cuenta() {
    const p = app.profile;
    if (!p) return '<p class="hint">Iniciá sesión para guardar tus ajustes.</p>';
    return `<button class="account-card lit" data-action="nav" data-view="profile">${avatar(p, 'md')}<span class="row-main"><span class="row-title">${esc(p.displayName)}${tick(p.role === 'artist')}</span><span class="row-sub">${authLabel(app.user)}</span></span>${icon('arrowRight')}</button>
      <div class="row-btns"><button class="btn-glass lit" data-action="edit-profile">${icon('edit')}Editar perfil</button><button class="btn-glass lit" data-action="sign-out">${icon('logout')}Cerrar sesión</button></div>`;
  },
  artista() {
    const claim = app.artist.claim;
    return `<button class="artist-claim lit" data-action="nav" data-view="${claim?.status === 'approved' ? 'studio' : 'claim'}">
        <span class="artist-claim-ico">${icon(claim?.status === 'approved' ? 'disc' : 'mic')}</span>
        <span class="row-main"><span class="row-title">${claim?.status === 'approved' ? 'Estudio de artista' : 'Reclamar perfil de Artista'}</span>
        <span class="row-sub">${claim ? `Estado: ${CLAIM_STATUS[claim.status].label}` : 'Subí tu música gratis con perfil verificado'}</span></span>
        ${claim ? statusPill(CLAIM_STATUS[claim.status]) : icon('arrowRight')}
      </button>`;
  },
  // apartados legales (js/legal/): documentos en borrador, elección de cookies y registro de aceptación
  legal() {
    const rec = app.user && !app.user.isGuest ? getConsent(app.user.uid) : null;
    return `<p class="hint">Textos en borrador, pendientes de revisión profesional.</p>
      <nav class="set-cats" aria-label="Documentos legales">${LEGAL_DOCS.map((d) => `<button type="button" class="set-cat lit" data-legal="${d.id}"><span class="set-ico">${icon(d.icon)}</span><span class="row-main"><span class="row-title">${esc(d.title)}</span><span class="row-sub">${esc(d.lead)}</span></span>${icon('arrowRight')}</button>`).join('')}</nav>
      <div class="field"><span>Cookies y almacenamiento</span><span class="hint">${cookieChoiceLabel()}. Hoy sólo se guarda lo necesario y no hay publicidad ni analítica.</span>
        <button type="button" class="btn-glass lit" data-cookie-settings>${icon('settings')}Configurar cookies</button></div>
      ${app.user && !app.user.isGuest ? `<p class="hint">${esc(consentSummary(rec))}</p>` : ''}`;
  },
  avanzado() {
    const s = app.engine.settings, adv = !!app.prefs.advanced;
    return `${toggleRow('advanced', 'Modo avanzado', adv ? 'Sonoridad (LUFS), true peak, correlación, limitador y motor de audio.' : 'Muestra datos técnicos del sonido y medidores en la pantalla Ahora suena.', adv)}
      ${adv ? `${toggleRow('limiter', 'Limitador true-peak', 'Detección sobremuestreada 4x, 2.5 ms de anticipación, techo −1 dBTP', s.limiter)}
        <p class="hint">Motor: Web Audio · ${fmtRate(app.engine.ctx.sampleRate)} float 32 · ${app.engine.limiter ? 'limitador true-peak multicanal en AudioWorklet' : 'sin AudioWorklet'} · salida ${app.engine.outChannels} canales (máx. ${app.engine.ctx.destination.maxChannelCount}) · espacial HRTF binaural${s.headphoneEq && s.headphoneEqOn ? ` · AutoEQ ${esc(s.headphoneEq.name)}` : ''} · nube: ${app.auth.mode === 'firebase' ? 'Firebase' : 'modo local'}</p>` : ''}
      <p class="hint">ZUENA ${APP_VERSION}${adv ? `</p>
      <details class="versions"><summary>Versiones de cada función</summary><ul>${staleness().map((f) => `<li><span>${esc(f.name)}</span><b>${f.version}</b><small>${f.days ? `hace ${f.days} d` : 'hoy'}</small></li>`).join('')}</ul></details>` : '</p>'}`;
  },
  desarrollo() {
    if (app.auth.mode !== 'local') return `<button class="btn-glass lit" data-action="nav" data-view="review">${icon('shield')}Revisión</button>`;
    return `${toggleRow('dev', 'Modo desarrollador', 'Panel de revisión para aprobar reclamos y lanzamientos en este equipo.', !!app.prefs.dev)}
      ${app.prefs.dev ? `<div class="row-btns"><button class="btn-glass lit" data-action="nav" data-view="review">${icon('shield')}Revisión</button><a class="btn-glass lit" href="tests.html" target="_blank">${icon('code')}Tests</a></div>` : ''}`;
  },
};
