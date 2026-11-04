// Lectura de metadatos sin dependencias: ID3v2.2/2.3/2.4 (MP3), FLAC, MP4/M4A (AAC/ALAC),
// Ogg (Vorbis/Opus) y WAV. Devuelve también datos técnicos (códec, bits, frecuencia).
const dec = {
  latin1: new TextDecoder('latin1'),
  utf8: new TextDecoder('utf-8'),
  utf16le: new TextDecoder('utf-16le'),
  utf16be: new TextDecoder('utf-16be'),
};
const ascii = (u8, a, b) => String.fromCharCode(...u8.subarray(a, b));
const be16 = (u8, p) => (u8[p] << 8) | u8[p + 1];
const be32 = (u8, p) => ((u8[p] << 24) | (u8[p + 1] << 16) | (u8[p + 2] << 8) | u8[p + 3]) >>> 0;
const le32 = (u8, p) => (u8[p] | (u8[p + 1] << 8) | (u8[p + 2] << 16) | (u8[p + 3] << 24)) >>> 0;
const synch = (u8, p) => (u8[p] << 21) | (u8[p + 1] << 14) | (u8[p + 2] << 7) | u8[p + 3];
const clean = (s) => s.replace(/\0+$/, '').split('\0').filter(Boolean).join(', ').trim();

const FIELD = {
  TITLE: 'title', TIT2: 'title', TT2: 'title', '©nam': 'title', INAM: 'title',
  ARTIST: 'artist', TPE1: 'artist', TP1: 'artist', '©ART': 'artist', IART: 'artist',
  ALBUM: 'album', TALB: 'album', TAL: 'album', '©alb': 'album', IPRD: 'album',
  ALBUMARTIST: 'albumArtist', 'ALBUM ARTIST': 'albumArtist', TPE2: 'albumArtist', TP2: 'albumArtist', aART: 'albumArtist',
  COMPOSER: 'composers', TCOM: 'composers', TCM: 'composers', '©wrt': 'composers',
  PRODUCER: 'producers',
  TRACKNUMBER: 'track', TRCK: 'track', TRK: 'track',
  DISCNUMBER: 'disc', TPOS: 'disc', TPA: 'disc',
  DATE: 'year', YEAR: 'year', TYER: 'year', TYE: 'year', TDRC: 'year', '©day': 'year', ICRD: 'year',
  GENRE: 'genre', TCON: 'genre', TCO: 'genre', '©gen': 'genre', IGNR: 'genre',
  LYRICS: 'lyrics', UNSYNCEDLYRICS: 'lyrics', '©lyr': 'lyrics',
};

function put(out, key, val) {
  const f = FIELD[key];
  if (!f || val == null || val === '') return;
  if (out[f]) {
    if ((f === 'composers' || f === 'producers') && !out[f].split('; ').includes(String(val).trim())) out[f] += '; ' + String(val).trim();
    return;
  }
  if (f === 'track' || f === 'disc') {
    const n = parseInt(String(val), 10);
    if (n > 0) out[f] = n;
  } else if (f === 'year') out.year = String(val).slice(0, 4);
  else if (f === 'genre') out.genre = String(val).replace(/^\(\d+\)\s*/, '').trim() || String(val);
  else out[f] = String(val).trim();
}

function putGain(out, key, val) {
  const n = parseFloat(val);
  if (!Number.isFinite(n)) return;
  const k = key.toUpperCase();
  const map = { REPLAYGAIN_TRACK_GAIN: 'trackGain', REPLAYGAIN_TRACK_PEAK: 'trackPeak', REPLAYGAIN_ALBUM_GAIN: 'albumGain', REPLAYGAIN_ALBUM_PEAK: 'albumPeak' };
  if (!map[k]) return;
  out.replayGain ??= {};
  out.replayGain[map[k]] = n;
}

function sniffImage(data, fallback) {
  if (data[0] === 0x89 && data[1] === 0x50) return 'image/png';
  if (data[0] === 0xFF && data[1] === 0xD8) return 'image/jpeg';
  if (data[8] === 0x57 && data[9] === 0x45) return 'image/webp';
  return fallback || 'image/jpeg';
}

function pickCover(out, pics) {
  const pic = pics.find((p) => p.type === 3) ?? pics[0];
  if (pic?.data?.length > 32) out.cover = { mime: sniffImage(pic.data, pic.mime), data: pic.data };
}

export function readTags(buffer, fileName = '') {
  const u8 = new Uint8Array(buffer);
  const out = {
    title: '', artist: '', album: '', albumArtist: '', track: 0, disc: 0, year: '', genre: '', lyrics: '',
    cover: null, codec: '', sampleRate: 0, bitDepth: 0, channels: 0, lossless: false, duration: 0, replayGain: null,
  };
  try {
    if (ascii(u8, 0, 3) === 'ID3') parseId3(u8, out, true);
    else if (ascii(u8, 0, 4) === 'fLaC') parseFlac(u8, 0, out);
    else if (ascii(u8, 4, 8) === 'ftyp') parseMp4(u8, out);
    else if (ascii(u8, 0, 4) === 'OggS') parseOgg(u8, out);
    else if (ascii(u8, 0, 4) === 'RIFF' && ascii(u8, 8, 12) === 'WAVE') parseWav(u8, out);
    else if (ascii(u8, 0, 4) === 'FORM') { out.codec = 'AIFF'; out.lossless = true; }
    else mpegInfo(u8, 0, out);
  } catch (err) {
    console.warn('[tags]', fileName, err);
  }
  if (!out.title) {
    const base = fileName.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
    const m = base.match(/^(?:\d+[\s.-]+)?(.+?)\s+-\s+(.+)$/);
    if (m && !out.artist) { out.artist = m[1]; out.title = m[2]; }
    else out.title = base.replace(/^\d+[\s.-]+/, '') || base;
  }
  return out;
}

// ---------- ID3v2 ----------

function decodeText(b, enc) {
  if (!b.length) return '';
  if (enc === 1) {
    if (b[0] === 0xFE && b[1] === 0xFF) return dec.utf16be.decode(b);
    return dec.utf16le.decode(b);
  }
  if (enc === 2) return dec.utf16be.decode(b);
  if (enc === 3) return dec.utf8.decode(b);
  return dec.latin1.decode(b);
}

function termEnd(b, start, enc) {
  if (enc === 1 || enc === 2) {
    for (let i = start; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i;
    return b.length;
  }
  const i = b.indexOf(0, start);
  return i < 0 ? b.length : i;
}
const termLen = (enc) => (enc === 1 || enc === 2 ? 2 : 1);

function deunsync(b) {
  const out = new Uint8Array(b.length);
  let j = 0;
  for (let i = 0; i < b.length; i++) {
    out[j++] = b[i];
    if (b[i] === 0xFF && b[i + 1] === 0x00) i++;
  }
  return out.subarray(0, j);
}

function parseId3(u8, out, scanAudio) {
  const ver = u8[3], flags = u8[5];
  let end = 10 + synch(u8, 6);
  let p = 10;
  if (flags & 0x40) p += ver === 4 ? synch(u8, 10) : be32(u8, 10) + 4;
  let tag = u8.subarray(p, end);
  if ((flags & 0x80) && ver < 4) tag = deunsync(tag);
  if (ver === 4 && (flags & 0x10)) end += 10;
  const v2 = ver === 2, hl = v2 ? 6 : 10, il = v2 ? 3 : 4;
  const pics = [];

  for (let q = 0; q + hl <= tag.length;) {
    const id = ascii(tag, q, q + il);
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
    const size = v2 ? (tag[q + 3] << 16) | (tag[q + 4] << 8) | tag[q + 5] : ver === 4 ? synch(tag, q + 4) : be32(tag, q + 4);
    const fl = v2 ? 0 : be16(tag, q + 8);
    let b = tag.subarray(q + hl, q + hl + size);
    q += hl + size;
    if (!b.length || (fl & (ver === 4 ? 0x000C : 0x00C0))) continue; // vacío, comprimido o cifrado
    if (ver === 4) {
      if (fl & 0x0002) b = deunsync(b);
      if (fl & 0x0001) b = b.subarray(4);
    }
    const enc = b[0];
    if (id === 'TXXX' || id === 'TXX') {
      const e = termEnd(b, 1, enc);
      const desc = clean(decodeText(b.subarray(1, e), enc));
      if (/^REPLAYGAIN_/i.test(desc)) putGain(out, desc, clean(decodeText(b.subarray(e + termLen(enc)), enc)));
    } else if (id[0] === 'T') {
      put(out, id, clean(decodeText(b.subarray(1), enc)));
    } else if (id === 'USLT' || id === 'ULT') {
      const e = termEnd(b, 4, enc);
      put(out, 'LYRICS', decodeText(b.subarray(e + termLen(enc)), enc).replace(/\0+$/, ''));
    } else if (id === 'APIC') {
      const me = b.indexOf(0, 1);
      const mime = dec.latin1.decode(b.subarray(1, me)).toLowerCase();
      const de = termEnd(b, me + 2, enc);
      pics.push({ type: b[me + 1], mime, data: b.slice(de + termLen(enc)) });
    } else if (id === 'PIC') {
      const de = termEnd(b, 5, enc);
      pics.push({ type: b[4], mime: ascii(b, 1, 4).toUpperCase() === 'PNG' ? 'image/png' : 'image/jpeg', data: b.slice(de + termLen(enc)) });
    }
  }
  pickCover(out, pics);
  if (!scanAudio) return;
  if (ascii(u8, end, end + 4) === 'fLaC') parseFlac(u8, end, out);
  else mpegInfo(u8, end, out);
}

function mpegInfo(u8, start, out) {
  out.codec ||= 'MP3';
  for (let i = start, n = Math.min(u8.length - 3, start + 65536); i < n; i++) {
    if (u8[i] !== 0xFF || (u8[i + 1] & 0xE0) !== 0xE0) continue;
    const ver = (u8[i + 1] >> 3) & 3, layer = (u8[i + 1] >> 1) & 3;
    const br = u8[i + 2] >> 4, sr = (u8[i + 2] >> 2) & 3;
    if (ver === 1 || layer === 0 || sr === 3 || br === 0 || br === 15) continue;
    const base = [44100, 48000, 32000][sr];
    out.sampleRate = ver === 3 ? base : ver === 2 ? base / 2 : base / 4;
    out.channels = (u8[i + 3] >> 6) === 3 ? 1 : 2;
    if (layer !== 1) out.codec = 'MP2';
    return;
  }
}

// ---------- FLAC / Vorbis comments ----------

function parseFlac(u8, off, out) {
  out.codec = 'FLAC';
  out.lossless = true;
  const pics = [];
  let p = off + 4;
  while (p + 4 <= u8.length) {
    const h = u8[p], type = h & 0x7F, len = (u8[p + 1] << 16) | (u8[p + 2] << 8) | u8[p + 3];
    const b = u8.subarray(p + 4, p + 4 + len);
    if (type === 0 && len >= 18) {
      out.sampleRate = (b[10] << 12) | (b[11] << 4) | (b[12] >> 4);
      out.channels = ((b[12] >> 1) & 7) + 1;
      out.bitDepth = (((b[12] & 1) << 4) | (b[13] >> 4)) + 1;
      const total = (b[13] & 0x0F) * 2 ** 32 + be32(b, 14);
      if (out.sampleRate) out.duration = total / out.sampleRate;
    } else if (type === 4) vorbisComments(b, 0, out, pics);
    else if (type === 6) pics.push(pictureBlock(b));
    p += 4 + len;
    if (h & 0x80) break;
  }
  pickCover(out, pics);
}

function vorbisComments(b, p, out, pics) {
  p += 4 + le32(b, p);
  const n = le32(b, p);
  p += 4;
  for (let i = 0; i < n && p + 4 <= b.length; i++) {
    const len = le32(b, p);
    p += 4;
    const s = dec.utf8.decode(b.subarray(p, p + len));
    p += len;
    const eq = s.indexOf('=');
    if (eq < 1) continue;
    const key = s.slice(0, eq).toUpperCase(), val = s.slice(eq + 1);
    if (key === 'METADATA_BLOCK_PICTURE') {
      try { pics.push(pictureBlock(Uint8Array.from(atob(val), (c) => c.charCodeAt(0)))); } catch { /* imagen corrupta */ }
    } else if (key.startsWith('REPLAYGAIN_')) putGain(out, key, val);
    else put(out, key, val);
  }
}

function pictureBlock(b) {
  let p = 0;
  const type = be32(b, p); p += 4;
  const ml = be32(b, p); p += 4;
  const mime = dec.latin1.decode(b.subarray(p, p + ml)); p += ml;
  p += 4 + be32(b, p);
  p += 16;
  const len = be32(b, p); p += 4;
  return { type, mime, data: b.slice(p, p + len) };
}

// ---------- Ogg ----------

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of parts) { out.set(a, o); o += a.length; }
  return out;
}

function parseOgg(u8, out) {
  const packets = [];
  let cur = [];
  let p = 0;
  while (p + 27 <= u8.length && packets.length < 2 && ascii(u8, p, p + 4) === 'OggS') {
    const segs = u8[p + 26];
    let d = p + 27 + segs;
    for (let i = 0; i < segs && packets.length < 2; i++) {
      const s = u8[p + 27 + i];
      cur.push(u8.subarray(d, d + s));
      d += s;
      if (s < 255) { packets.push(concat(cur)); cur = []; }
    }
    p = d;
  }
  const [head, tags] = packets;
  if (head && ascii(head, 0, 8) === 'OpusHead') { out.codec = 'Opus'; out.channels = head[9]; out.sampleRate = 48000; }
  else if (head && ascii(head, 1, 7) === 'vorbis') { out.codec = 'Vorbis'; out.channels = head[11]; out.sampleRate = le32(head, 12); }
  else if (head && ascii(head, 1, 5) === 'FLAC') { out.codec = 'FLAC'; out.lossless = true; }
  const pics = [];
  if (tags && ascii(tags, 0, 8) === 'OpusTags') vorbisComments(tags, 8, out, pics);
  else if (tags && ascii(tags, 1, 7) === 'vorbis') vorbisComments(tags, 7, out, pics);
  pickCover(out, pics);
}

// ---------- MP4 / M4A ----------

const MP4_CONTAINERS = new Set(['moov', 'udta', 'ilst', 'trak', 'mdia', 'minf', 'stbl']);

function parseMp4(u8, out) {
  out.codec = 'AAC';
  const pics = [];
  const walk = (s, e, parent) => {
    for (let p = s; p + 8 <= e;) {
      let size = be32(u8, p);
      const type = ascii(u8, p + 4, p + 8);
      let h = 8;
      if (size === 1) { size = be32(u8, p + 8) * 2 ** 32 + be32(u8, p + 12); h = 16; }
      else if (size === 0) size = e - p;
      if (size < h) break;
      const cs = p + h, ce = Math.min(p + size, e);
      if (MP4_CONTAINERS.has(type)) walk(cs, ce, type);
      else if (type === 'meta') walk(cs + 4, ce, type);
      else if (type === 'mdhd' && !out.duration) {
        const v1 = u8[cs] === 1;
        const ts = be32(u8, cs + (v1 ? 20 : 12));
        const dur = v1 ? be32(u8, cs + 24) * 2 ** 32 + be32(u8, cs + 28) : be32(u8, cs + 16);
        if (ts) out.duration = dur / ts;
      } else if (type === 'stsd') sampleEntry(u8, cs + 8, out);
      else if (parent === 'ilst') ilstItem(u8, type, cs, ce, out, pics);
      p += size;
    }
  };
  walk(0, u8.length, '');
  pickCover(out, pics);
}

function sampleEntry(u8, e, out) {
  const fmt = ascii(u8, e + 4, e + 8);
  out.channels = be16(u8, e + 24);
  out.bitDepth = be16(u8, e + 26);
  out.sampleRate = be32(u8, e + 32) >>> 16;
  if (fmt === 'alac') {
    out.codec = 'ALAC';
    out.lossless = true;
    const c = e + 36;
    if (ascii(u8, c + 4, c + 8) === 'alac') {
      const cfg = c + 12;
      out.bitDepth = u8[cfg + 5];
      out.channels = u8[cfg + 9];
      out.sampleRate = be32(u8, cfg + 20);
    }
  } else if (fmt === 'fLaC') { out.codec = 'FLAC'; out.lossless = true; }
  else if (fmt === 'Opus') { out.codec = 'Opus'; out.bitDepth = 0; }
  else { out.codec = 'AAC'; out.bitDepth = 0; }
}

function ilstItem(u8, type, s, e, out, pics) {
  let name = '';
  for (let p = s; p + 8 <= e;) {
    const size = be32(u8, p);
    if (size < 8) break;
    const child = ascii(u8, p + 4, p + 8);
    if (child === 'name') name = dec.utf8.decode(u8.subarray(p + 12, p + size));
    else if (child === 'data' && size >= 16) {
      const kind = be32(u8, p + 8) & 0xFFFFFF;
      const d = u8.subarray(p + 16, p + size);
      if (type === 'covr') pics.push({ type: 3, mime: kind === 14 ? 'image/png' : 'image/jpeg', data: d.slice() });
      else if (type === 'trkn' || type === 'disk') { if (d.length >= 4) put(out, type === 'trkn' ? 'TRACKNUMBER' : 'DISCNUMBER', be16(d, 2)); }
      else if (type === '----') { if (/^replaygain_/i.test(name)) putGain(out, name, dec.utf8.decode(d)); }
      else if (kind === 1) put(out, type, dec.utf8.decode(d));
    }
    p += size;
  }
}

// ---------- WAV ----------

function parseWav(u8, out) {
  out.codec = 'WAV';
  out.lossless = true;
  for (let p = 12; p + 8 <= u8.length;) {
    const id = ascii(u8, p, p + 4), size = le32(u8, p + 4), b = p + 8;
    if (id === 'fmt ') {
      const fmt = u8[b] | (u8[b + 1] << 8);
      out.channels = u8[b + 2] | (u8[b + 3] << 8);
      out.sampleRate = le32(u8, b + 4);
      out.bitDepth = u8[b + 14] | (u8[b + 15] << 8);
      if (fmt === 3) out.codec = 'WAV float';
    } else if (id === 'LIST' && ascii(u8, b, b + 4) === 'INFO') {
      for (let q = b + 4; q + 8 <= b + size;) {
        const k = ascii(u8, q, q + 4), l = le32(u8, q + 4);
        put(out, k, clean(dec.latin1.decode(u8.subarray(q + 8, q + 8 + l))));
        q += 8 + l + (l & 1);
      }
    } else if ((id === 'id3 ' || id === 'ID3 ') && ascii(u8, b, b + 3) === 'ID3') {
      parseId3(u8.subarray(b, b + size), out, false);
    } else if (id === 'data' && out.sampleRate && out.channels && out.bitDepth) {
      out.duration = size / (out.sampleRate * out.channels * (out.bitDepth / 8));
    }
    p += 8 + size + (size & 1);
  }
}
