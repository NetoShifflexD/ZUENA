// Corrección de auriculares con AutoEQ (proyecto abierto, licencia MIT): perfiles paramétricos medidos
// para ~8.800 modelos que llevan cada auricular a la curva de referencia Harman.
// El índice se descarga una vez y se guarda 30 días en IndexedDB.
import { db } from '../store/db.js';

const BASE = 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results';
// mediciones preferidas cuando un modelo tiene varias (laboratorio > comunidad)
const SOURCE_RANK = { oratory1990: 0, crinacle: 1, 'Rtings': 2, 'Innerfidelity': 3, 'Headphone.com Legacy': 4 };
let indexP = null;

export function loadIndex() {
  return (indexP ??= (async () => {
    const cached = await db.kvGet('autoeq:index').catch(() => null);
    if (cached && Date.now() - cached.t < 30 * 864e5) return cached.list;
    const r = await fetch(`${BASE}/INDEX.md`);
    if (!r.ok) throw new Error('No se pudo descargar el índice de AutoEQ');
    const list = [];
    for (const m of (await r.text()).matchAll(/^- \[(.+?)\]\(\.\/(.+?)\) by (.+?)(?: on (.+))?$/gm)) {
      list.push({ name: m[1], path: decodeURIComponent(m[2]), source: m[3], rig: m[4] || '' });
    }
    db.kvSet('autoeq:index', { t: Date.now(), list }).catch(() => {});
    return list;
  })().catch((err) => { indexP = null; throw err; }));
}

export async function searchHeadphones(q, limit = 12) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const list = await loadIndex();
  const hits = list.filter((e) => words.every((w) => e.name.toLowerCase().includes(w)));
  hits.sort((a, b) => (SOURCE_RANK[a.source] ?? 9) - (SOURCE_RANK[b.source] ?? 9) || a.name.length - b.name.length);
  // un resultado por modelo (la mejor medición)
  const seen = new Set();
  return hits.filter((e) => !seen.has(e.name) && seen.add(e.name)).slice(0, limit);
}

const TYPE = { PK: 'peaking', LSC: 'lowshelf', HSC: 'highshelf', LS: 'lowshelf', HS: 'highshelf' };

export function parseParametric(text) {
  const preamp = parseFloat(/Preamp:\s*(-?[\d.]+)/i.exec(text)?.[1] || '0');
  const filters = [];
  for (const m of text.matchAll(/Filter\s*\d+:\s*ON\s+(\w+)\s+Fc\s+([\d.]+)\s*Hz\s+Gain\s+(-?[\d.]+)\s*dB\s+Q\s+([\d.]+)/gi)) {
    const type = TYPE[m[1].toUpperCase()];
    if (type) filters.push({ type, f: +m[2], g: +m[3], q: +m[4] });
  }
  return { preamp, filters };
}

export async function loadHeadphoneProfile(entry) {
  const leaf = entry.path.split('/').pop();
  const url = `${BASE}/${entry.path}/${leaf} ParametricEQ.txt`.split('/').map((s, i) => (i < 3 ? s : encodeURIComponent(s))).join('/');
  const r = await fetch(url);
  if (!r.ok) throw new Error('Ese modelo no tiene perfil paramétrico');
  const p = parseParametric(await r.text());
  if (!p.filters.length) throw new Error('El perfil está vacío');
  return { name: entry.name, source: entry.source, ...p };
}
