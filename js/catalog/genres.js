// Géneros unificados de ZUENA y su correspondencia con Audius, Apple Music y etiquetas de archivos.
export const GENRES = [
  { id: 'pop', label: 'Pop', audius: ['Pop', 'Hyperpop'], re: /\b(pop|k-?pop|hyperpop)\b/i },
  { id: 'urbano', label: 'Urbano latino', audius: ['Latin', 'Dancehall', 'Moombahton'], re: /(urban|reggae?t[oó]n|latin|dancehall|dembow|moombah)/i },
  { id: 'hiphop', label: 'Hip-Hop / Rap', audius: ['Hip-Hop/Rap'], re: /(hip.?hop|\brap\b)/i },
  { id: 'trap', label: 'Trap', audius: ['Trap'], re: /\btrap\b/i },
  { id: 'electronic', label: 'Electrónica', audius: ['Electronic', 'Electro', 'Dubstep', 'Drum & Bass', 'Future Bass', 'Trance', 'Glitch Hop', 'Jungle', 'Hardstyle'], re: /(electr|edm|dubstep|drum|bass|trance|jungle|hardstyle)/i },
  { id: 'house', label: 'House', audius: ['House', 'Tech House', 'Deep House', 'Progressive House', 'Future House', 'Tropical House', 'Disco'], re: /(house|disco)/i },
  { id: 'techno', label: 'Techno', audius: ['Techno'], re: /techno/i },
  { id: 'rnb', label: 'R&B / Soul', audius: ['R&B/Soul', 'Funk'], re: /(r&b|r ?n ?b|soul|funk)/i },
  { id: 'rock', label: 'Rock', audius: ['Rock', 'Punk'], re: /(rock|punk)/i },
  { id: 'indie', label: 'Indie / Alternativa', audius: ['Alternative', 'Experimental'], re: /(indie|alternativ|experimental)/i },
  { id: 'metal', label: 'Metal', audius: ['Metal'], re: /metal/i },
  { id: 'lofi', label: 'Lo-fi / Chill', audius: ['Lo-Fi', 'Downtempo', 'Vaporwave'], re: /(lo.?fi|chill|downtempo|vaporwave)/i },
  { id: 'ambient', label: 'Ambient', audius: ['Ambient'], re: /ambient/i },
  { id: 'jazz', label: 'Jazz / Blues', audius: ['Jazz', 'Blues'], re: /(jazz|blues)/i },
  { id: 'acoustic', label: 'Acústico / Folk', audius: ['Acoustic', 'Folk', 'Country'], re: /(acoustic|ac[uú]stic|folk|country|singer)/i },
  { id: 'classical', label: 'Clásica / Cine', audius: ['Classical', 'Soundtrack'], re: /(classical|cl[aá]sic|soundtrack|score|banda sonora)/i },
];

export const GENRE_BY_ID = Object.fromEntries(GENRES.map((g) => [g.id, g]));

export const MOODS = [
  { id: 'focus', label: 'Concentrarme', audius: ['Peaceful', 'Easygoing', 'Sophisticated', 'Cool'], genres: ['lofi', 'ambient', 'classical', 'jazz'] },
  { id: 'workout', label: 'Entrenar', audius: ['Energizing', 'Aggressive', 'Fiery', 'Empowering', 'Excited'], genres: ['electronic', 'hiphop', 'trap', 'rock'] },
  { id: 'party', label: 'Fiesta', audius: ['Upbeat', 'Excited', 'Rowdy'], genres: ['urbano', 'house', 'pop', 'electronic'] },
  { id: 'chill', label: 'Relajarme', audius: ['Peaceful', 'Tender', 'Easygoing', 'Romantic'], genres: ['lofi', 'rnb', 'acoustic', 'indie'] },
  { id: 'travel', label: 'Viajar', audius: ['Yearning', 'Cool', 'Upbeat', 'Sentimental'], genres: ['indie', 'pop', 'rock', 'acoustic'] },
  { id: 'sleep', label: 'Dormir', audius: ['Peaceful', 'Tender'], genres: ['ambient', 'classical', 'lofi'] },
];

export const TOPICS = [
  { id: 'news', label: 'Noticias', term: 'noticias' },
  { id: 'comedy', label: 'Humor', term: 'humor' },
  { id: 'tech', label: 'Tecnología', term: 'tecnología' },
  { id: 'music', label: 'Música', term: 'música' },
  { id: 'sports', label: 'Deportes', term: 'fútbol' },
  { id: 'history', label: 'Historia', term: 'historia' },
  { id: 'crime', label: 'Policiales', term: 'true crime' },
  { id: 'business', label: 'Negocios', term: 'negocios' },
  { id: 'science', label: 'Ciencia', term: 'ciencia' },
  { id: 'wellness', label: 'Bienestar', term: 'bienestar' },
];

// Devuelve el id de género ZUENA a partir de cualquier texto (tag de archivo, género de Apple o Audius)
export function genreOf(text) {
  if (!text) return null;
  const s = String(text);
  for (const g of GENRES) if (g.audius.some((a) => a.toLowerCase() === s.toLowerCase())) return g.id;
  for (const g of GENRES) if (g.re.test(s)) return g.id;
  return null;
}

export const REGIONS = [
  { id: 'ar', label: 'Argentina', radio: 'AR' },
  { id: 'mx', label: 'México', radio: 'MX' },
  { id: 'es', label: 'España', radio: 'ES' },
  { id: 'cl', label: 'Chile', radio: 'CL' },
  { id: 'co', label: 'Colombia', radio: 'CO' },
  { id: 'uy', label: 'Uruguay', radio: 'UY' },
  { id: 'us', label: 'Estados Unidos', radio: 'US' },
];

export function defaultRegion() {
  const m = /-([A-Za-z]{2})$/.exec(navigator.language || '');
  const id = m?.[1].toLowerCase();
  return REGIONS.some((r) => r.id === id) ? id : 'ar';
}
