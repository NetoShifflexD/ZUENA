// Limitador brickwall TRUE-PEAK con lookahead, para 1 a 8 canales (estéreo, 5.1, 7.1).
// La detección se hace sobre la señal sobremuestreada 4x (interpolación polifásica, sinc con ventana)
// para atrapar los picos entre muestras. La ganancia es común a todos los canales (no altera la
// imagen espacial): mínimo deslizante de la ganancia requerida + suavizado de caja sobre la misma
// ventana, con la señal retrasada la ventana + la latencia del interpolador.
const P = 4, T = 8, N = P * T, D = T / 2, MAX_CH = 8;

function designPhases() {
  const M = (N - 1) / 2;
  const phases = [];
  for (let p = 0; p < P; p++) {
    const h = new Float32Array(T);
    let sum = 0;
    for (let j = 0; j < T; j++) {
      const i = p + P * j;
      const t = (i - M) / P;
      const sinc = Math.abs(t) < 1e-9 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
      const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (N - 1));
      h[j] = sinc * w;
      sum += h[j];
    }
    for (let j = 0; j < T; j++) h[j] /= sum;
    phases.push(h);
  }
  return phases;
}

class SipaLimiter extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'ceiling', defaultValue: 0.891, minValue: 0.1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'bypass', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    const L = Math.max(16, Math.round(sampleRate * 0.0025));
    this.L = L;
    this.W = L + 1;
    this.DL = L + D;
    this.delay = Array.from({ length: MAX_CH }, () => new Float32Array(this.DL));
    this.hist = Array.from({ length: MAX_CH }, () => new Float32Array(T));
    this.dp = 0;
    this.hp = 0;
    this.phases = designPhases();
    this.box = new Float64Array(L).fill(1);
    this.bp = 0;
    this.dqVal = new Float32Array(this.W + 1);
    this.dqIdx = new Float64Array(this.W + 1);
    this.dqHead = 0;
    this.dqSize = 0;
    this.n = 0;
    this.env = 1;
    this.rel = Math.exp(-1 / (sampleRate * 0.2));
    this.minGain = 1;
    this.peakIn = 0;
    this.blocks = 0;
  }

  truePeak(c) {
    const h = this.hist[c], ph = this.phases;
    let peak = 0;
    for (let p = 0; p < P; p++) {
      const k = ph[p];
      let acc = 0, idx = this.hp;
      for (let j = 0; j < T; j++) {
        idx = idx === 0 ? T - 1 : idx - 1;
        acc += k[j] * h[idx];
      }
      if (acc < 0) acc = -acc;
      if (acc > peak) peak = acc;
    }
    return peak;
  }

  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0];
    const frames = out[0].length;
    if (!inp || inp.length === 0) {
      for (const ch of out) ch.fill(0);
      return true;
    }
    const nIn = Math.min(inp.length, MAX_CH);
    const nOut = Math.min(out.length, MAX_CH);
    const ceil = params.ceiling[0];
    const bypass = params.bypass[0] >= 0.5;
    const { L, W, DL, dqVal, dqIdx, box, delay, hist } = this;
    const cap = W + 1;

    let sum = 0;
    for (let i = 0; i < L; i++) sum += box[i];

    for (let i = 0; i < frames; i++) {
      let peak = 0;
      for (let c = 0; c < nIn; c++) hist[c][this.hp] = inp[c][i];
      this.hp = (this.hp + 1) % T;
      for (let c = 0; c < nIn; c++) { const tp = this.truePeak(c); if (tp > peak) peak = tp; }
      if (peak > this.peakIn) this.peakIn = peak;
      const r = bypass || peak <= ceil ? 1 : ceil / peak;

      while (this.dqSize > 0) {
        const back = (this.dqHead + this.dqSize - 1) % cap;
        if (dqVal[back] >= r) this.dqSize--; else break;
      }
      const slot = (this.dqHead + this.dqSize) % cap;
      dqVal[slot] = r; dqIdx[slot] = this.n; this.dqSize++;
      while (dqIdx[this.dqHead] <= this.n - W) { this.dqHead = (this.dqHead + 1) % cap; this.dqSize--; }
      const m = dqVal[this.dqHead];

      this.env = m < this.env ? m : m + (this.env - m) * this.rel;
      sum += this.env - box[this.bp];
      box[this.bp] = this.env;
      this.bp = (this.bp + 1) % L;
      const g = sum / L;
      if (g < this.minGain) this.minGain = g;

      for (let c = 0; c < nOut; c++) {
        const d = delay[c];
        const y = d[this.dp];
        d[this.dp] = c < nIn ? inp[c][i] : 0;
        out[c][i] = y * g;
      }
      this.dp = (this.dp + 1) % DL;
      this.n++;
    }

    if (++this.blocks >= 16) {
      this.port.postMessage({ gr: -20 * Math.log10(Math.max(this.minGain, 1e-6)), tp: 20 * Math.log10(Math.max(this.peakIn, 1e-6)) });
      this.blocks = 0;
      this.minGain = 1;
      this.peakIn = 0;
    }
    return true;
  }
}

registerProcessor('sipa-limiter', SipaLimiter);
