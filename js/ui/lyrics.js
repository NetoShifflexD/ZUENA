// Letras para "Ahora suena": primero las del archivo (tags), después LRCLIB (base comunitaria con
// letras sincronizadas, API abierta). Se cachean en IndexedDB.
import { db } from '../store/db.js';

export const parseLrc = (text) => {
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    const words = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of stamps) lines.push({ t: +m[1] * 60 + +m[2] + (m[3] ? +`0.${m[3]}` : 0), text: words });
  }
  return lines.sort((a, b) => a.t - b.t);
};

export async function loadLyrics(t) {
  if (!t || t.live || t.type === 'episode') return { none: true, reason: t?.live ? 'Las radios en vivo no tienen letra.' : 'Los podcasts no tienen letra.' };
  if (t.lyrics) {
    const synced = /\[\d{1,2}:\d{2}/.test(t.lyrics) ? parseLrc(t.lyrics) : null;
    return synced?.length ? { synced } : { plain: t.lyrics };
  }
  const artist = (t.artist || '').split(/ feat\.| & |, /)[0].trim();
  const title = (t.title || '').replace(/\s*[([].*?(feat|with|remaster|version|mix).*?[)\]]/gi, '').trim();
  if (!artist || !title) return { none: true, reason: 'No encontramos la letra de esta canción.' };
  const key = `lyrics:${artist.toLowerCase()}|${title.toLowerCase()}`;
  const cached = await db.kvGet(key).catch(() => null);
  let data = cached;
  if (!data) {
    const params = new URLSearchParams({ artist_name: artist, track_name: title });
    if (t.fullDuration || (t.duration && !t.preview)) params.set('duration', Math.round(t.fullDuration || t.duration));
    try {
      let r = await fetch(`https://lrclib.net/api/get?${params}`);
      if (r.status === 404) {
        params.delete('duration');
        r = await fetch(`https://lrclib.net/api/search?${params}`);
        const list = r.ok ? await r.json() : [];
        data = list.find((x) => x.syncedLyrics) || list[0] || { missing: true };
      } else {
        data = r.ok ? await r.json() : { missing: true };
      }
    } catch {
      return { none: true, reason: 'Sin conexión: no se pudo buscar la letra.' };
    }
    db.kvSet(key, { syncedLyrics: data.syncedLyrics || null, plainLyrics: data.plainLyrics || null, instrumental: !!data.instrumental, missing: !!data.missing }).catch(() => {});
  }
  if (data.instrumental) return { none: true, reason: 'Instrumental' };
  // las vistas previas de 30 s arrancan a mitad de canción: los tiempos no coinciden, se muestra sin sincronizar
  if (data.syncedLyrics && !t.preview) return { synced: parseLrc(data.syncedLyrics), source: 'LRCLIB' };
  if (data.plainLyrics || data.syncedLyrics) return { plain: data.plainLyrics || data.syncedLyrics.replace(/\[[^\]]*\]/g, '').trim(), source: 'LRCLIB', preview: t.preview };
  return { none: true, reason: 'No encontramos la letra de esta canción.' };
}
