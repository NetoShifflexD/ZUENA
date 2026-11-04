// Ecualizador paramétrico de 10 bandas (ISO, una octava por banda)
export const EQ_BANDS = [
  { freq: 32, type: 'lowshelf', q: 0.71 },
  { freq: 64, type: 'peaking', q: 1.41 },
  { freq: 125, type: 'peaking', q: 1.41 },
  { freq: 250, type: 'peaking', q: 1.41 },
  { freq: 500, type: 'peaking', q: 1.41 },
  { freq: 1000, type: 'peaking', q: 1.41 },
  { freq: 2000, type: 'peaking', q: 1.41 },
  { freq: 4000, type: 'peaking', q: 1.41 },
  { freq: 8000, type: 'peaking', q: 1.41 },
  { freq: 16000, type: 'highshelf', q: 0.71 },
];

export const EQ_PRESETS = {
  'Plano': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Graves+': [5.5, 4.5, 3, 1.2, 0, 0, 0, 0, 0, 0],
  'Voces': [-2, -1.5, -1, 0.5, 2, 3, 3, 2, 0.5, -0.5],
  'Acústico': [3, 2.5, 1.5, 0.5, 1, 1, 2, 2.5, 2, 1.5],
  'Electrónica': [4.5, 3.5, 1, 0, -1.5, 1, 0.5, 1.5, 4, 4.5],
  'Rock': [4, 3, 1.5, 0, -1, -0.5, 1, 2.5, 3.5, 4],
  'Hip-Hop': [5, 4, 1.5, 2.5, -1, -1, 1, -0.5, 1.5, 2.5],
  'Nocturno': [3.5, 2.5, 1, 0, 0, 0, 0, 1, 2.5, 3],
  'Claridad': [0, 0, -1, -1, 0, 1, 2.5, 3.5, 3, 2],
  'Agudos+': [0, 0, 0, 0, 0, 0.5, 2, 3.5, 4.5, 5],
};
