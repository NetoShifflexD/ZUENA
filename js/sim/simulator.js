// Simulador de actividad (pruebas): hace que ZUENA se comporte como si ya estuviera lanzada.
// · Corre dentro de la app, sin IA: no gasta tokens ni contexto.
// · Personas FICTICIAS (artistas y oyentes inventados, marcados `sim: true`): nunca se simula a personas reales.
// · Configuración en Obsidian: Salida/Simulación/Configuración.md (bloque ```json), servida por serve.ps1 en
//   /api/sim-config. Registro de actividad: serve.ps1 agrega líneas a Salida/Simulación/Registro.md (/api/sim-log).
// · También simula suscripciones (sin cobros ni importes), seguidores y escuchas de oyentes ficticios, siempre
//   sobre artistas ficticios: nunca genera cifras de artistas reales (catálogo o registrados).
// · Sin serve.ps1 o sin la nota, usa DEFAULTS. Todo lo simulado se borra con `zuena.sim.reset()`.
import { db } from '../store/db.js';

const DEFAULTS = { enabled: true, intervalSeconds: 25, seedPosts: 45, seedHours: 72, activity: 'media', engageWithUser: true, logEveryMinutes: 10 };
const ACTIVITY = { baja: 0.5, media: 1, alta: 2 };

const ARTISTS = [
  ['nara-velez', 'Nara Vélez', 'naravelez', 'Pop alternativo desde Rosario. Canciones para manejar de noche.', ['pop', 'indie']],
  ['ciro-malva', 'Ciro Malva', 'ciromalva', 'Productor y trapero. Beats hechos en un monoambiente.', ['trap', 'urbano']],
  ['luz-austral', 'Luz Austral', 'luzaustral', 'Folk electrónico del sur. Sintetizadores y viento patagónico.', ['electronica', 'folk']],
  ['dante-rios', 'Dante Ríos', 'danterios', 'Rock de garage. Tres acordes y la verdad.', ['rock']],
  ['kalu', 'KALÚ', 'kalumusic', 'Reggaetón romántico. Nuevo single cada mes.', ['reggaeton', 'urbano']],
  ['mora-delta', 'Mora Delta', 'moradelta', 'R&B y neo soul. Grabo todo en casa.', ['rnb']],
  ['tomas-ebano', 'Tomás Ébano', 'tomasebano', 'Pianista. Música para estudiar y para extrañar.', ['clasica', 'ambient']],
  ['sol-prisma', 'Sol Prisma', 'solprisma', 'Cumbia digital. Si no se baila, no sale.', ['cumbia']],
  ['vera-norte', 'Vera Norte', 'veranorte', 'Cantautora. Letras primero, siempre.', ['cantautor', 'pop']],
  ['bruma-club', 'Bruma Club', 'brumaclub', 'Dúo de house melódico. Sets de domingo.', ['electronica', 'house']],
];
const LISTENERS = [
  ['ana-p', 'Ana P.', 'anaplaylists'], ['mati-r', 'Mati R.', 'matirocks'], ['flor-g', 'Flor G.', 'florgonzalez'],
  ['juli-s', 'Juli S.', 'julisonidos'], ['nico-b', 'Nico B.', 'nicobeats'], ['caro-m', 'Caro M.', 'caromusica'],
  ['lean-d', 'Lean D.', 'leandj'], ['sofi-t', 'Sofi T.', 'sofitemas'], ['gonza-v', 'Gonza V.', 'gonzavinilo'],
  ['meli-a', 'Meli A.', 'meliauris'], ['tomi-c', 'Tomi C.', 'tomicumbia'], ['agus-l', 'Agus L.', 'aguslofi'],
  ['pau-h', 'Pau H.', 'pauhits'], ['fede-n', 'Fede N.', 'fedenoches'],
];

const ARTIST_POSTS = [
  'Terminé de mezclar el single nuevo. Lo escuché quince veces seguidas y todavía me gusta. Buena señal. #EnElEstudio',
  'Mañana a las 20 h estreno. Gracias a los que pusieron el recordatorio. #NuevoSingle',
  '¿Qué canción mía querés que toque en vivo la próxima? Leo todo.',
  'Hoy grabamos voces hasta las 4 de la mañana. El café ya no hace efecto. #EnElEstudio',
  'Subí la versión acústica. Para los que pedían algo más tranquilo. #Acústico',
  'Hace un año nadie escuchaba esto. Hoy son miles. Gracias de verdad.',
  'Probando sintes nuevos para el EP. Se viene algo distinto. #ProcesoCreativo',
  'La letra de esta salió en el colectivo, en el celular, en tres paradas. #Composición',
  'Primer show con entradas agotadas. No tengo palabras.',
  'Si te gustó el tema, compartilo con alguien que lo necesite hoy.',
  'Ensayo general. Mañana suena todo en vivo por primera vez. #EnVivo',
  'Estoy armando una playlist con lo que me inspiró para el disco. ¿Les interesa?',
  'Nuevo video detrás de escena del último single. Link en mi perfil. #DetrásDeEscena',
  'Ya se puede pre-guardar el EP. Faltan 5 días. #NuevoEP',
];
const LISTENER_POSTS = [
  'No puedo dejar de escuchar lo nuevo de @{a}. Temazo. #ZUENA',
  'Armé una playlist para correr y es puro fuego. ¿Alguien quiere el link?',
  'Descubrí a @{a} ayer y ya me escuché todo. ¿Cómo no lo conocía?',
  'Domingo de vinilos y mate. ¿Qué están escuchando ustedes?',
  'La calidad sin pérdida en auriculares buenos es otra cosa. #Audiófilos',
  'Necesito recomendaciones de algo tranquilo para estudiar. Lo que sea.',
  'El estreno de @{a} con cuenta regresiva estuvo buenísimo, estábamos todos esperando. #NuevoSingle',
  'Top 3 de la semana: lo nuevo de @{a}, algo de cumbia digital y mucho lo-fi. #MiSemana',
];
const REPLIES = [
  'Temazo.', 'Lo tengo en loop desde ayer.', 'Ya lo agregué a mi playlist.', '¡Por fin!', 'Esta es la mejor hasta ahora.',
  'Necesito la versión extendida.', '¿Cuándo hay show en Córdoba?', 'La producción está impecable.', 'Me erizó la piel.',
  'Aguante esto.', 'Lo vengo esperando hace meses.', 'Esa letra me pegó fuerte.', 'Subí la letra, por favor.',
  '¡Gracias por leer siempre los comentarios!', 'Ya puse el recordatorio.', 'Mostrá más del estudio.',
];
const ARTIST_REPLIES = ['¡Gracias por escuchar!', 'Me alegra un montón que te guste.', 'Pronto, prometido.', 'Esa fue la más difícil de escribir.', 'Leo todo, gracias.'];
// publicaciones exclusivas (sólo de artistas ficticios): el adelanto es una plantilla fija
const EXCLUSIVE_POSTS = [
  'Les dejo la maqueta original del single, grabada con el celular. Sólo para ustedes.',
  'Primer vistazo a la tapa del EP. Díganme qué les parece antes que nadie.',
  'Así sonaba la canción antes de cambiarle el estribillo. Escuchen la diferencia.',
  'Lista de canciones del próximo disco, en orden. Todavía no la vio nadie más.',
  'Mañana hago un vivo cerrado para suscriptores. Traigan preguntas.',
  'Las letras completas del EP, con notas de cómo salió cada una.',
];
const TEASER = 'Adelanto para suscriptores del artista.';
// respuestas genéricas y neutrales para eventos de catálogo: nunca nombran al artista ni afirman nada sobre él
const CATALOG_REPLIES = ['Temazo.', 'Ya lo agregué a mi playlist.', 'Lo estaba esperando.', 'Lo tengo en loop.', 'Muy bueno.', 'Para escuchar todo el fin de semana.'];

// avatar simple (degradado + inicial) como data URI: no se descarga nada
function avatarFor(name, i) {
  const h1 = (i * 47) % 360, h2 = (h1 + 60) % 360;
  const ch = name.replace(/[^A-Za-zÁÉÍÓÚÑ]/g, '').charAt(0).toUpperCase() || '?';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h1},70%,62%)"/><stop offset="1" stop-color="hsl(${h2},65%,42%)"/></linearGradient></defs><rect width="96" height="96" fill="url(#g)"/><text x="48" y="62" font-family="Inter,Arial" font-size="42" font-weight="700" fill="rgba(255,255,255,.92)" text-anchor="middle">${ch}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// azar con semilla (las corridas son reproducibles dentro de una sesión)
let seed = Date.now() % 2147483647;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

export function createSimulator(app) {
  let cfg = { ...DEFAULTS }, timer = 0, logTimer = 0, running = false, ready = false;
  const counts = { posts: 0, replies: 0, likes: 0, reposts: 0, subs: 0, listens: 0 };
  let personas = { artists: [], listeners: [] };

  async function loadConfig() {
    try {
      const r = await fetch('/api/sim-config', { cache: 'no-store' });
      if (r.ok) cfg = { ...DEFAULTS, ...(await r.json()) };
    } catch { /* sin servidor o sin nota: valores por defecto */ }
    return cfg;
  }

  async function log(line) {
    try {
      await fetch('/api/sim-log', { method: 'POST', headers: { 'content-type': 'text/plain; charset=utf-8' }, body: line.slice(0, 500) });
    } catch { /* sin servidor: sólo consola */ }
  }

  async function ensurePersonas() {
    const now = Date.now() - 400 * 864e5;
    const make = async (rows, role) => {
      const out = [];
      for (const [i, row] of rows.entries()) {
        const [slug, displayName, username, bio, genres] = row;
        const uid = `sim-${slug}`;
        const p = { uid, displayName, username, bio: bio || '', role, avatar: avatarFor(displayName, i + (role === 'artist' ? 0 : 20)), genres: genres || [], sim: true, created: now };
        await db.put('profiles', p);
        if (role === 'artist') await db.put('claims', { uid, status: 'approved', artistName: displayName, sim: true, updated: now });
        app.posts.authors.set(uid, p);
        out.push(p);
      }
      return out;
    };
    personas = { artists: await make(ARTISTS, 'artist'), listeners: await make(LISTENERS, 'listener') };
  }

  const anyone = () => (rnd() < 0.35 ? pick(personas.artists) : pick(personas.listeners));
  const fill = (txt) => txt.replace('{a}', pick(personas.artists).username);
  const tierPick = () => { const r = rnd(); return r < 0.6 ? 1 : r < 0.9 ? 2 : 3; }; // muchos Fan, pocos VIP

  // quién puede interactuar: en un exclusivo sólo el artista y los oyentes ficticios con nivel suficiente;
  // en un evento de catálogo sólo oyentes (el artista real nunca actúa)
  function who(target) {
    if (target.kind === 'catalog') return pick(personas.listeners);
    const need = app.posts.audienceTier(target);
    if (!need) return anyone();
    const root = app.posts.rootOf(target);
    const ok = personas.listeners.filter((l) => (app.subs?.tier(l.uid, root.uid) || 0) >= need);
    return ok.length ? pick(ok) : null;
  }

  async function newPost(created) {
    const artist = rnd() < 0.6;
    const author = artist ? pick(personas.artists) : pick(personas.listeners);
    counts.posts++;
    // algunas publicaciones de artistas ficticios son exclusivas (simuladas) para un nivel
    if (artist && rnd() < 0.15) return app.posts.create(author, pick(EXCLUSIVE_POSTS), null, { sim: true, created, audience: `tier:${tierPick()}`, teaser: TEASER });
    const text = artist ? pick(ARTIST_POSTS) : fill(pick(LISTENER_POSTS));
    return app.posts.create(author, text, null, { sim: true, created });
  }

  async function reply(target, created) {
    if (!target) return null;
    const author = app.posts.author(target.uid);
    const cat = target.kind === 'catalog';
    // a veces responde el propio artista ficticio (como en una red real); nunca en eventos de catálogo
    const w = !cat && author?.sim && author.role === 'artist' && app.posts.replyCount(target.id) > 0 && rnd() < 0.3 ? author : who(target);
    if (!w || (w.uid === target.uid && w.role !== 'artist')) return null;
    counts.replies++;
    const text = cat ? pick(CATALOG_REPLIES) : w.role === 'artist' && w.uid === target.uid ? pick(ARTIST_REPLIES) : pick(REPLIES);
    return app.posts.create(w, text, null, { sim: true, replyTo: target.id, created });
  }

  async function like(target) {
    if (!target) return;
    const w = who(target);
    if (!w || target.likes.includes(w.uid)) return;
    counts.likes++;
    await app.posts.toggleLike(target.id, w.uid, true, true);
  }

  async function repost(target) {
    if (!target || target.repostOf || app.posts.audienceTier(target)) return;
    const w = who(target);
    if (!w || (target.reposts || []).includes(w.uid) || w.uid === target.uid) return;
    counts.reposts++;
    await app.posts.toggleRepost(target.id, w);
  }

  // elige una publicación reciente, con más chances para las populares y para las del usuario.
  // Los eventos de catálogo pesan el 60 % de una publicación normal (no distorsionan el orden).
  function target() {
    const pool = app.posts.timeline().filter((p) => !p.repostOf && p.text && !p.cloud).slice(0, 60); // nunca sobre la nube
    const cats = app.posts.catalogFeed().slice(0, 30);
    if (!pool.length && !cats.length) return null;
    const mine = cfg.engageWithUser ? pool.filter((p) => p.uid === app.user?.uid) : [];
    if (mine.length && rnd() < 0.3) return pick(mine);
    const w = pool.map((p) => 1 + p.likes.length * 0.4);
    for (const c of cats) { pool.push(c); w.push(0.6 * (1 + c.likes.length * 0.4)); }
    let r = rnd() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < pool.length; i++) { r -= w[i]; if (r <= 0) return pool[i]; }
    return pool[0];
  }

  async function seedHistory() {
    if (app.posts.list.some((p) => p.sim)) return false;
    const now = Date.now(), span = cfg.seedHours * 3600e3;
    const times = Array.from({ length: cfg.seedPosts }, () => now - rnd() * span).sort((a, b) => a - b);
    for (const t of times) {
      const p = await newPost(t);
      if (!p) continue;
      const n = Math.floor(rnd() * 4);
      for (let k = 0; k < n; k++) await reply(p, Math.min(now, t + rnd() * 6 * 3600e3));
    }
    // interacciones del historial
    const top = app.posts.timeline().filter((p) => p.sim);
    for (const p of top) {
      const likes = Math.floor(rnd() * rnd() * 14);
      for (let k = 0; k < likes; k++) await like(p);
      if (rnd() < 0.3) await repost(p);
    }
    await log(`${stamp()} · historial inicial: ${counts.posts} publicaciones, ${counts.replies} respuestas, ${counts.likes} me gusta, ${counts.reposts} reposts`);
    return true;
  }

  // ---------- suscripciones, seguidores y escuchas simuladas (sólo artistas ficticios `sim-*`) ----------
  // popularidad fija por sesión: pocos artistas muy escuchados y una cola larga
  let weights = new Map();
  const popularity = () => {
    if (weights.size !== personas.artists.length) {
      const order = [...personas.artists].sort(() => rnd() - 0.5);
      weights = new Map(order.map((a, i) => [a.uid, 1 / (1 + i * 0.6)]));
    }
    return weights;
  };
  function weightedArtist() {
    const w = popularity();
    let r = rnd() * [...w.values()].reduce((s, x) => s + x, 0);
    for (const a of personas.artists) { r -= w.get(a.uid); if (r <= 0) return a; }
    return personas.artists[0];
  }

  async function seedSubs() {
    if (!app.subs || Object.keys(app.subs.map).some((k) => k.startsWith('sim-'))) return;
    const now = Date.now();
    for (const l of personas.listeners) {
      const n = Math.floor(rnd() * rnd() * 4); // 0–3, sesgado a pocas
      const chosen = new Set();
      while (chosen.size < n) chosen.add(weightedArtist().uid);
      for (const a of chosen) app.subs.map[`${l.uid}|${a}`] = { tier: tierPick(), since: Math.round(now - rnd() * 90 * 864e5), updated: now, sim: true };
    }
    await app.subs.save();
  }

  async function seedFollows() {
    if (!app.charts || Object.keys(app.charts.simFollows || {}).length) return;
    const map = {};
    const add = (a, l) => { (map[a] ||= []); if (!map[a].includes(l)) map[a].push(l); };
    for (const l of personas.listeners) {
      const n = 1 + Math.floor(rnd() * 5);
      for (let k = 0; k < n; k++) add(weightedArtist().uid, l.uid);
    }
    // quien se suscribe también sigue
    for (const k of Object.keys(app.subs?.map || {})) { const [l, a] = k.split('|'); if (l.startsWith('sim-')) add(a, l); }
    await app.charts.setSimFollows(map);
  }

  // historial de 28 días de oyentes ficticios (0–10 por artista y por día)
  async function seedCharts() {
    if (!app.charts || app.charts.simSeeded) return;
    const now = Date.now(), w = popularity();
    for (let d = 0; d < 28; d++) {
      const ts = now - d * 864e5;
      for (const a of personas.artists) {
        const n = Math.min(10, Math.floor(rnd() * 11 * w.get(a.uid)));
        const ears = [...personas.listeners].sort(() => rnd() - 0.5).slice(0, n);
        for (const l of ears) {
          const plays = 1 + Math.floor(rnd() * 4);
          for (let k = 0; k < plays; k++) app.charts.add(`zu:${a.uid}`, l.uid, { sim: true, ts });
        }
      }
    }
    await app.charts.markSimSeeded(true);
  }

  // alta, cambio de nivel o baja de un oyente ficticio (≈ 5 % de las acciones)
  async function subChange() {
    if (!app.subs) return;
    const l = pick(personas.listeners), a = weightedArtist();
    const cur = app.subs.tier(l.uid, a.uid);
    if (cur && rnd() < 0.5) await app.subs.cancel(l.uid, a.uid);
    else await app.subs.subscribe(l.uid, a, tierPick());
    counts.subs++;
  }

  function simListen() {
    if (!app.charts) return;
    app.charts.add(`zu:${weightedArtist().uid}`, pick(personas.listeners).uid, { sim: true });
    counts.listens++;
  }

  async function step() {
    if (!running || document.hidden) return;
    if (rnd() < 0.3) simListen();
    const r = rnd();
    if (r < 0.05) await subChange();
    else if (r < 0.25) await newPost();
    else if (r < 0.47) await reply(target());
    else if (r < 0.86) await like(target());
    else await repost(target());
  }

  function schedule() {
    clearTimeout(timer);
    if (!running) return;
    const base = (cfg.intervalSeconds * 1000) / (ACTIVITY[cfg.activity] || 1);
    timer = setTimeout(async () => { try { await step(); } catch (err) { console.warn('[sim]', err); } schedule(); }, base * (0.5 + rnd()));
  }

  const stamp = () => new Date().toLocaleString('es', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  let last = { ...counts };
  async function flushLog() {
    const d = Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v - last[k]]));
    last = { ...counts };
    if (Object.values(d).some(Boolean)) await log(`${stamp()} · ${d.posts} publicaciones, ${d.replies} respuestas, ${d.likes} me gusta, ${d.reposts} reposts, ${d.subs} cambios de suscripción simulada, ${d.listens} escuchas simuladas`);
  }

  return {
    get config() { return cfg; },
    counts,
    async start(force = false) {
      await loadConfig();
      if (!cfg.enabled && !force) { console.info('[sim] desactivado en la configuración'); return false; }
      if (!ready) { await ensurePersonas(); ready = true; }
      await seedHistory();
      await seedSubs();
      await seedFollows();
      await seedCharts();
      running = true;
      schedule();
      clearInterval(logTimer);
      logTimer = setInterval(flushLog, Math.max(1, cfg.logEveryMinutes) * 60e3);
      return true;
    },
    stop() { running = false; clearTimeout(timer); clearInterval(logTimer); flushLog(); },
    async reset() {
      this.stop();
      const n = await app.posts.clearSim();
      for (const p of [...personas.artists, ...personas.listeners]) { await db.del('profiles', p.uid); await db.del('claims', p.uid).catch(() => {}); app.posts.authors.delete(p.uid); }
      // suscripciones simuladas (también la del usuario real), seguidores simulados y datos simulados de charts
      await app.subs?.clear();
      await app.charts?.purgeSim();
      ready = false;
      await log(`${stamp()} · simulación borrada (${n} publicaciones, suscripciones simuladas y datos simulados de charts)`);
      return n;
    },
    status() {
      if (!running) return '';
      return `Activa: artistas y oyentes ficticios publican, reaccionan, escuchan y se suscriben (simulado, sin cobros) cada ~${cfg.intervalSeconds} s (actividad ${cfg.activity}). Todo lo simulado lleva la etiqueta "Simulado".`;
    },
    get running() { return running; },
  };
}
