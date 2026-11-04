// Procesador de Masterización y Audio de Alta Definición ZUENA Studio (AudioWorklet).
// Funciones DSP:
// 1. Calidez analógica (saturación suave asimétrica tipo cinta y válvulas de consola)
// 2. Graves psicoacústicos (Missing Fundamental: síntesis armónica de subgraves < 110 Hz)
// 3. Aire y claridad de estudio (excitador armónico de frecuencias cristalinas > 9.5 kHz)
// 4. Imagen estéreo holográfica (matriz Mid/Side con ensanchamiento 3D)
// 5. Sub Mono-Maker (colapsa subgraves < 110 Hz a mono para evitar cancelaciones de fase)
// 6. Presencia vocal dinámica (realce en el canal central para inteligibilidad y presencia)

const MAX_CH = 8;

class CytomicSVF {
  constructor() {
    this.ic1eq = 0;
    this.ic2eq = 0;
  }
  reset() {
    this.ic1eq = 0;
    this.ic2eq = 0;
  }
  processLP(v0, g, k) {
    const v1 = (this.ic1eq + g * (v0 - this.ic2eq)) / (1 + g * (g + k));
    const v2 = this.ic2eq + g * v1;
    this.ic1eq = 2 * v1 - this.ic1eq;
    this.ic2eq = 2 * v2 - this.ic2eq;
    return v2;
  }
  processHP(v0, g, k) {
    const v1 = (this.ic1eq + g * (v0 - this.ic2eq)) / (1 + g * (g + k));
    const v2 = this.ic2eq + g * v1;
    this.ic1eq = 2 * v1 - this.ic1eq;
    this.ic2eq = 2 * v2 - this.ic2eq;
    return v0 - k * v1 - v2;
  }
  processBP(v0, g, k) {
    const v1 = (this.ic1eq + g * (v0 - this.ic2eq)) / (1 + g * (g + k));
    const v2 = this.ic2eq + g * v1;
    this.ic1eq = 2 * v1 - this.ic1eq;
    this.ic2eq = 2 * v2 - this.ic2eq;
    return v1;
  }
}

class ZuenaDspProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'bypass', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'warmth', defaultValue: 0.25, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'bassDrive', defaultValue: 0.35, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'airClarity', defaultValue: 0.20, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'stereoWidth', defaultValue: 1.15, minValue: 0.5, maxValue: 2.0, automationRate: 'k-rate' },
      { name: 'vocalFocus', defaultValue: 0.15, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'monoMaker', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    // Filtros por canal
    this.lpSide = new CytomicSVF();
    this.lpSubL = new CytomicSVF();
    this.bpSubHarmL = new CytomicSVF();
    this.lpSubR = new CytomicSVF();
    this.bpSubHarmR = new CytomicSVF();
    this.hpAirL = new CytomicSVF();
    this.hpAirR = new CytomicSVF();
    this.bpVocal = new CytomicSVF();

    // Multicanal (Centro, LFE)
    this.bpCenterVocal = new CytomicSVF();
    this.hpCenterAir = new CytomicSVF();
    this.lpLfeSub = new CytomicSVF();
    this.bpLfeHarm = new CytomicSVF();

    // Coeficientes precalculados
    const sr = typeof sampleRate === 'number' && sampleRate > 0 ? sampleRate : 48000;
    this.gLow = Math.tan(Math.PI * 110 / sr);
    this.kLow = 1.4142; // Butterworth Q = 0.7071
    this.gAir = Math.tan(Math.PI * 9500 / sr);
    this.kAir = 1.4142;
    this.gVocal = Math.tan(Math.PI * 2800 / sr);
    this.kVocal = 1.0;
    this.gHarmBp = Math.tan(Math.PI * 160 / sr);
    this.kHarmBp = 1.0;
  }

  // Saturación analógica con modelado suave de válvulas y cinta
  saturate(x, warmth) {
    if (warmth <= 0.005) return x;
    const drive = 1.0 + warmth * 1.8;
    const xd = x * drive;
    // Asimetría suave que introduce armónicos pares musicales
    const asym = xd + 0.06 * warmth * (xd * xd - Math.abs(xd));
    const denom = Math.tanh(drive);
    return denom > 0 ? Math.tanh(asym) / denom : x;
  }

  process(inputs, outputs, params) {
    const inp = inputs[0];
    const out = outputs[0];

    if (!inp || inp.length === 0) {
      if (out) for (let c = 0; c < out.length; c++) out[c].fill(0);
      return true;
    }

    const nIn = inp.length;
    const nOut = out ? out.length : 0;
    const frames = inp[0].length;

    // Si está en bypass, copia directa de entrada a salida
    const isBypass = params.bypass[0] >= 0.5;
    if (isBypass) {
      for (let c = 0; c < nOut; c++) {
        if (c < nIn) out[c].set(inp[c]);
        else out[c].fill(0);
      }
      return true;
    }

    const warmth = params.warmth[0];
    const bassDrive = params.bassDrive[0];
    const airClarity = params.airClarity[0];
    const width = params.stereoWidth[0];
    const vocalFocus = params.vocalFocus[0];
    const monoMaker = params.monoMaker[0] >= 0.5;

    const {
      gLow, kLow, gAir, kAir, gVocal, kVocal, gHarmBp, kHarmBp,
      lpSide, lpSubL, bpSubHarmL, lpSubR, bpSubHarmR, hpAirL, hpAirR, bpVocal,
      bpCenterVocal, hpCenterAir, lpLfeSub, bpLfeHarm
    } = this;

    const inL = inp[0];
    const inR = nIn > 1 ? inp[1] : inL;
    const outL = out[0];
    const outR = nOut > 1 ? out[1] : null;

    // Procesamiento Estéreo principal (Front L/R)
    for (let i = 0; i < frames; i++) {
      let l = inL[i];
      let r = inR[i];

      // Protecciones contra NaN o denormales
      if (!Number.isFinite(l)) l = 0;
      if (!Number.isFinite(r)) r = 0;

      // 1. Imagen Estéreo & Sub Mono-Maker (Mid/Side)
      let mid = (l + r) * 0.5;
      let side = (l - r) * 0.5;

      if (monoMaker) {
        // Extrae subgraves del lateral y los elimina de Side
        const sideSub = lpSide.processLP(side, gLow, kLow);
        side -= sideSub;
      }

      // Ensanchamiento estéreo sobre la banda media/alta
      side *= width;

      // Presencia vocal sobre el canal Mid (Centro acústico)
      if (vocalFocus > 0.005) {
        const voc = bpVocal.processBP(mid, gVocal, kVocal);
        mid += voc * vocalFocus * 0.35;
      }

      // Reconstrucción estéreo L/R
      l = mid + side;
      r = mid - side;

      // 2. Graves Psicoacústicos (Missing Fundamental: armónicos 2do y 3ero)
      if (bassDrive > 0.005) {
        // Canal Izquierdo
        const subL = lpSubL.processLP(l, gLow, kLow);
        // Excitador no lineal cuadrático + cúbico
        const rawHarmL = (subL * subL - 0.04) * 1.6 + (subL * subL * subL) * 0.6;
        const harmL = bpSubHarmL.processBP(rawHarmL, gHarmBp, kHarmBp);
        l += harmL * bassDrive * 0.45;

        // Canal Derecho
        const subR = lpSubR.processLP(r, gLow, kLow);
        const rawHarmR = (subR * subR - 0.04) * 1.6 + (subR * subR * subR) * 0.6;
        const harmR = bpSubHarmR.processBP(rawHarmR, gHarmBp, kHarmBp);
        r += harmR * bassDrive * 0.45;
      }

      // 3. Aire y Claridad de Estudio (> 9.5 kHz)
      if (airClarity > 0.005) {
        const airL = hpAirL.processHP(l, gAir, kAir);
        const airR = hpAirR.processHP(r, gAir, kAir);
        // Excitación sutil de agudos
        l += airL * airClarity * 0.35;
        r += airR * airClarity * 0.35;
      }

      // 4. Calidez Analógica y Saturación de Válvula / Cinta
      if (warmth > 0.005) {
        l = this.saturate(l, warmth);
        r = this.saturate(r, warmth);
      }

      outL[i] = l;
      if (outR) outR[i] = r;
    }

    // Si la salida es Multicanal (5.1 / 7.1), procesamos Centro (2), LFE (3) y envolventes
    if (nOut >= 6 && nIn >= 3) {
      const inC = inp[2];
      const inLFE = nIn > 3 ? inp[3] : null;
      const outC = out[2];
      const outLFE = out[3];

      for (let i = 0; i < frames; i++) {
        // Centro (Voces): Claridad vocal y calidez analógica
        let c = inC ? inC[i] : 0;
        if (vocalFocus > 0.005) {
          const cv = bpCenterVocal.processBP(c, gVocal, kVocal);
          c += cv * vocalFocus * 0.4;
        }
        if (airClarity > 0.005) {
          const ca = hpCenterAir.processHP(c, gAir, kAir);
          c += ca * airClarity * 0.25;
        }
        if (warmth > 0.005) c = this.saturate(c, warmth);
        outC[i] = c;

        // LFE: Refuerzo subgrave
        if (inLFE && outLFE) {
          let lfe = inLFE[i];
          if (bassDrive > 0.005) {
            const lfeSub = lpLfeSub.processLP(lfe, gLow, kLow);
            const rawHarm = (lfeSub * lfeSub - 0.04) * 1.5;
            const lfeHarm = bpLfeHarm.processBP(rawHarm, gHarmBp, kHarmBp);
            lfe += lfeHarm * bassDrive * 0.4;
          }
          outLFE[i] = lfe;
        }
      }

      // Surrounds y laterales: aplicar calidez y aire suave
      for (let ch = 4; ch < Math.min(nIn, nOut); ch++) {
        const chIn = inp[ch];
        const chOut = out[ch];
        for (let i = 0; i < frames; i++) {
          let s = chIn[i];
          if (warmth > 0.005) s = this.saturate(s, warmth * 0.7);
          chOut[i] = s;
        }
      }
    } else {
      // Si hay canales de salida adicionales no cubiertos
      for (let c = 2; c < nOut; c++) {
        if (c < nIn) out[c].set(inp[c]);
        else out[c].fill(0);
      }
    }

    return true;
  }
}

registerProcessor('zuena-dsp', ZuenaDspProcessor);
