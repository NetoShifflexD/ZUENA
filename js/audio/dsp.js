// Presets y configuración del procesador de masterización ZUENA Studio.

export const DSP_PRESETS = {
  audiophile: {
    id: 'audiophile',
    name: 'Estudio Audiófilo',
    sub: 'Transparente, orgánico y equilibrado para alta fidelidad',
    warmth: 0.20,
    bassDrive: 0.30,
    airClarity: 0.25,
    stereoWidth: 1.15,
    vocalFocus: 0.15,
    monoMaker: true,
  },
  vinyl: {
    id: 'vinyl',
    name: 'Cinta y Válvulas',
    sub: 'Calidez analógica rica de consola vintage y graves redondos',
    warmth: 0.55,
    bassDrive: 0.40,
    airClarity: 0.10,
    stereoWidth: 1.05,
    vocalFocus: 0.15,
    monoMaker: true,
  },
  club: {
    id: 'club',
    name: 'Club / Bajos Profundos',
    sub: 'Excitación psicoacústica intensa de subgraves para electrónica y urbana',
    warmth: 0.25,
    bassDrive: 0.70,
    airClarity: 0.30,
    stereoWidth: 1.30,
    vocalFocus: 0.10,
    monoMaker: true,
  },
  vocal: {
    id: 'vocal',
    name: 'Acústico y Voces',
    sub: 'Voces al frente con aire cristalino en la banda alta',
    warmth: 0.15,
    bassDrive: 0.15,
    airClarity: 0.45,
    stereoWidth: 1.20,
    vocalFocus: 0.50,
    monoMaker: true,
  },
  spatial3d: {
    id: 'spatial3d',
    name: 'Escenario 3D',
    sub: 'Apertura estéreo ultra-amplia con subgraves en mono centrados',
    warmth: 0.20,
    bassDrive: 0.35,
    airClarity: 0.35,
    stereoWidth: 1.55,
    vocalFocus: 0.25,
    monoMaker: true,
  },
  bypass: {
    id: 'bypass',
    name: 'Puro / Directo',
    sub: 'Sonido sin procesamiento adicional',
    warmth: 0,
    bassDrive: 0,
    airClarity: 0,
    stereoWidth: 1.0,
    vocalFocus: 0,
    monoMaker: false,
  },
};

export function findMatchingPreset(settings) {
  if (!settings || settings.dspOn === false) return 'bypass';
  const w = settings.dspWarmth ?? settings.warmth ?? 0.20;
  const b = settings.dspBassDrive ?? settings.bassDrive ?? 0.30;
  const a = settings.dspAirClarity ?? settings.airClarity ?? 0.25;
  const s = settings.dspStereoWidth ?? settings.stereoWidth ?? 1.15;
  const v = settings.dspVocalFocus ?? settings.vocalFocus ?? 0.15;

  for (const [id, p] of Object.entries(DSP_PRESETS)) {
    if (id === 'bypass') continue;
    const match =
      Math.abs(w - p.warmth) < 0.04 &&
      Math.abs(b - p.bassDrive) < 0.04 &&
      Math.abs(a - p.airClarity) < 0.04 &&
      Math.abs(s - p.stereoWidth) < 0.04 &&
      Math.abs(v - p.vocalFocus) < 0.04;
    if (match) return id;
  }
  return 'custom';
}
