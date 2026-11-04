// Retratos del catálogo de prueba: identidad exacta en enwiki → Wikidata P18 → Commons.
// Sin búsquedas aproximadas ni carátulas de Apple. La UI conserva su placeholder si falta un ID.
import { TEST_ARTISTS } from './testArtists.js';
import { db } from '../store/db.js';

const WIKIDATA = 'https://www.wikidata.org/w/api.php';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const TTL = 7 * 24 * 3600e3;
const TIMEOUT = 6000;
const CACHE_KEY = 'artistPortraits:commons:v1';
const LOCAL_CATALOG = '/js/data/artistPortraits.catalog.json';
const WIKI_TITLES = Object.freeze({
  'Taylor Swift': 'Taylor Swift',
  'The Weeknd': 'The Weeknd',
  Drake: 'Drake (musician)',
  'Billie Eilish': 'Billie Eilish',
  'Sabrina Carpenter': 'Sabrina Carpenter',
  'Bruno Mars': 'Bruno Mars',
  'Lady Gaga': 'Lady Gaga',
  'Ed Sheeran': 'Ed Sheeran',
  'Kendrick Lamar': 'Kendrick Lamar',
  'Tate McRae': 'Tate McRae',
  'Bad Bunny': 'Bad Bunny',
  'KAROL G': 'Karol G',
  'Rauw Alejandro': 'Rauw Alejandro',
  'Anuel AA': 'Anuel AA',
  Ozuna: 'Ozuna',
  'Myke Towers': 'Myke Towers',
  'Omar Courtz': 'Omar Courtz',
  'J Balvin': 'J Balvin',
  'Jay Wheeler': 'Jay Wheeler',
  Shakira: 'Shakira',
  'Peso Pluma': 'Peso Pluma',
  'Fuerza Regida': 'Fuerza Regida',
  'Eladio Carrión': 'Eladio Carrión',
  JHAYCO: 'Jhayco',
  Quevedo: 'Quevedo (rapper)',
  Aitana: 'Aitana (singer)',
  Emilia: 'Emilia Mernes',
  'Natanael Cano': 'Natanael Cano',
  'Cris MJ': 'Cris MJ',
  'Jere Klein': 'Jere Klein',
});
const artists = TEST_ARTISTS.filter((a) => Object.hasOwn(WIKI_TITLES, a.name));
const idsByTitle = new Map(artists.map((a) => [WIKI_TITLES[a.name], String(a.id)]));
const ids = new Set(artists.map((a) => String(a.id)));
const signature = artists.map((a) => `${a.id}:${WIKI_TITLES[a.name]}`).join('|');
let shared, expires = 0;

function bounded(promise, ms, onTimeout = () => {}) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { onTimeout(); reject(new Error('Tiempo agotado')); }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function query(endpoint, params) {
  const url = new URL(endpoint);
  url.search = new URLSearchParams({ format: 'json', origin: '*', ...params });
  const controller = new AbortController();
  return bounded((async () => {
    const response = await fetch(url.href, {
      mode: 'cors', credentials: 'omit', redirect: 'error',
      signal: controller.signal, headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Wikimedia HTTP ${response.status}`);
    const data = await response.json();
    if (!data || data.error) throw new Error('Respuesta Wikimedia inválida');
    return data;
  })(), TIMEOUT, () => controller.abort());
}

// DOM inerte, nunca se insertan los metadatos HTML en la página.
function plain(value) {
  if (typeof value !== 'string') return '';
  const doc = new DOMParser().parseFromString(value, 'text/html');
  doc.querySelectorAll('script, style, iframe, object, template').forEach((n) => n.remove());
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}

function safeURL(value, kind) {
  try {
    if (typeof value !== 'string') return '';
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
    const valid = kind === 'image'
      ? ['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(url.hostname)
        && url.pathname.startsWith('/wikipedia/commons/')
      : url.hostname === 'commons.wikimedia.org' && url.pathname.startsWith('/wiki/File:');
    return valid ? url.href : '';
  } catch { return ''; }
}

function cleanPortrait(value) {
  if (!value || typeof value !== 'object') return null;
  const url = safeURL(value.url, 'image'), source = safeURL(value.source, 'source');
  const author = plain(value.author), license = plain(value.license);
  return url && source && author && license ? { url, author, license, source } : null;
}

function cachedPortraits(data) {
  const result = {};
  if (!data || typeof data !== 'object' || Array.isArray(data)) return result;
  for (const [id, value] of Object.entries(data)) {
    if (!ids.has(id)) continue;
    const portrait = cleanPortrait(value);
    if (portrait) result[id] = portrait;
  }
  return result;
}

function imageFile(entity) {
  const statements = (entity.claims?.P18 || []).filter((c) => c.rank !== 'deprecated'
    && c.mainsnak?.snaktype === 'value' && c.mainsnak.datatype === 'commonsMedia');
  const preferred = statements.filter((c) => c.rank === 'preferred');
  for (const claim of preferred.length ? preferred : statements) {
    const file = claim.mainsnak.datavalue?.value;
    // Sólo fotos raster vinculadas al sujeto por P18; excluir señales de portadas y gráficos.
    if (typeof file === 'string' && /\.(jpe?g|png|webp)$/i.test(file)
      && !/[|\r\n]/.test(file)
      && !/(?:\balbum\b|\bcover\b|\bportada\b|\bcar[aá]tula\b|\blogo\b|\bposter\b|\bartwork\b)/i.test(file)) return file;
  }
  return '';
}

async function resolvePortraits() {
  // El snapshot oficial evita depender de APIs externas para el primer render.
  // Se valida igual que la caché; ausente, vencido o inválido permite continuar en vivo.
  try {
    const controller = new AbortController();
    const catalog = await bounded((async () => {
      const response = await fetch(LOCAL_CATALOG, {
        mode: 'same-origin', credentials: 'omit', redirect: 'error',
        signal: controller.signal, headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error('Catálogo local no disponible');
      return response.json();
    })(), TIMEOUT, () => controller.abort());
    const generated = typeof catalog.generatedAt === 'string' ? Date.parse(catalog.generatedAt) : NaN;
    const age = Date.now() - generated;
    if (age >= 0 && age < TTL) {
      const result = cachedPortraits(catalog.portraits);
      if (Object.keys(result).length) {
        expires = generated + TTL;
        return result;
      }
    }
  } catch { /* La caché y las APIs oficiales siguen disponibles como respaldo. */ }
  const cached = await bounded(db.kvGet(CACHE_KEY), 1000).catch(() => null);
  const age = Date.now() - cached?.t;
  if (cached?.signature === signature && age >= 0 && age < TTL) {
    const result = cachedPortraits(cached.data);
    if (Object.keys(result).length) {
      expires = cached.t + TTL;
      return result;
    }
  }

  const data = await query(WIKIDATA, {
    action: 'wbgetentities', sites: 'enwiki', titles: [...idsByTitle.keys()].join('|'),
    props: 'claims|sitelinks', sitefilter: 'enwiki',
  });
  const idsByFile = new Map();
  for (const entity of Object.values(data.entities || {})) {
    // No asociar por orden, etiqueta ni similitud: exigir el enlace exacto a enwiki.
    const id = idsByTitle.get(entity.sitelinks?.enwiki?.title);
    const file = id && imageFile(entity);
    if (file) {
      const title = `File:${file.replace(/_/g, ' ')}`;
      if (!idsByFile.has(title)) idsByFile.set(title, []);
      idsByFile.get(title).push(id);
    }
  }

  const titles = [...idsByFile.keys()], result = {};
  const batches = [];
  // extmetadata es costoso: lotes chicos, todos fuera del render de las tarjetas.
  for (let i = 0; i < titles.length; i += 5) batches.push(titles.slice(i, i + 5));
  let failed = false;
  await Promise.all(batches.map(async (batch) => {
    try {
      const images = await query(COMMONS, {
        action: 'query', titles: batch.join('|'), prop: 'imageinfo',
        iiprop: 'url|extmetadata|mime', iiurlwidth: '320',
        iiextmetadatafilter: 'Artist|LicenseShortName', iiextmetadatalanguage: 'en',
      });
      for (const page of Object.values(images.query?.pages || {})) {
        if (Object.hasOwn(page, 'missing')) continue;
        const info = page.imageinfo?.[0];
        if (!info || !/^image\/(jpeg|png|webp)$/.test(info.mime)) continue;
        const portrait = cleanPortrait({
          url: info.thumburl, source: info.descriptionurl,
          author: info.extmetadata?.Artist?.value,
          license: info.extmetadata?.LicenseShortName?.value,
        });
        if (!portrait) continue;
        for (const id of idsByFile.get(page.title) || []) result[id] = portrait;
      }
    } catch { failed = true; } // Un lote fallido no oculta los demás retratos.
  }));
  expires = Date.now() + (failed || !Object.keys(result).length ? 60000 : TTL);
  // No persistir fallos parciales durante siete días. Escritura fuera del camino de respuesta.
  if (!failed && Object.keys(result).length) {
    void bounded(db.kvSet(CACHE_KEY, { t: Date.now(), signature, data: result }), 1000).catch(() => {});
  }
  return result;
}

/**
 * @returns {Promise<Object<string, {url: string, author: string, license: string, source: string}>>}
 * Cargar en segundo plano una vez y renderizar con portraits[String(appleArtistId)].
 * Los campos author/license son texto: usar textContent o escape al mostrarlos.
 * Sin foto o ante errores, el ID se omite (o se devuelve {}); la UI decide su placeholder.
 */
export function loadArtistPortraits() {
  if (!shared || (expires && Date.now() >= expires)) {
    expires = 0;
    shared = resolvePortraits().catch(() => { expires = Date.now() + 60000; return {}; });
  }
  return shared;
}
