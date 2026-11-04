// Análisis de sonoridad ITU-R BS.1770-4 / EBU R128 (LUFS integrado con gating),
// true peak con sobremuestreo 4x y forma de onda para la barra de progreso.
self.onmessage = (e) => {
  const { id, channels, sampleRate } = e.data;
  try {
    self.postMessage({ id, ...analyze(channels, sampleRate) });
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};

// Coeficientes del filtro K para cualquier frecuencia de muestreo (pre-filtro shelving + RLB high-pass)
function kWeighting(fs) {
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan(Math.PI * f0 / fs);
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf = [
    (Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0,
    2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0,
  ];
  f0 = 38.13547087602444; Q = 0.5003270373238773;
  K = Math.tan(Math.PI * f0 / fs);
  a0 = 1 + K / Q + K * K;
  const hp = [1, -2, 1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
  return [shelf, hp];
}

function analyze(chs, fs) {
  const n = chs[0].length;
  const [s, h] = kWeighting(fs);
  const step = Math.round(0.1 * fs);
  const nSteps = Math.max(1, Math.floor(n / step));
  const stepEnergy = new Float64Array(nSteps);
  const BINS = 220;
  const binSize = Math.max(1, Math.floor(n / BINS));
  const wave = new Float64Array(BINS);
  let samplePeak = 0;

  for (let c = 0; c < chs.length; c++) {
    const x = chs[c];
    const G = c >= 3 ? 1.41 : 1; // canales surround (5.1+)
    let z1 = 0, z2 = 0, w1 = 0, w2 = 0;
    for (let i = 0; i < n; i++) {
      const v = x[i];
      const a = v < 0 ? -v : v;
      if (a > samplePeak) samplePeak = a;
      const y = s[0] * v + z1;
      z1 = s[1] * v - s[3] * y + z2;
      z2 = s[2] * v - s[4] * y;
      const w = h[0] * y + w1;
      w1 = h[1] * y - h[3] * w + w2;
      w2 = h[2] * y - h[4] * w;
      const k = (i / step) | 0;
      if (k < nSteps) stepEnergy[k] += G * w * w;
      const b = (i / binSize) | 0;
      if (b < BINS) wave[b] += v * v;
    }
  }

  // bloques de 400 ms con 75% de solapamiento
  const blockLen = 4 * step;
  const blocks = [];
  if (nSteps < 4) {
    let e = 0; for (const v of stepEnergy) e += v;
    blocks.push(e / Math.max(1, n));
  } else {
    for (let k = 0; k + 4 <= nSteps; k++) {
      blocks.push((stepEnergy[k] + stepEnergy[k + 1] + stepEnergy[k + 2] + stepEnergy[k + 3]) / blockLen);
    }
  }
  const lk = (z) => -0.691 + 10 * Math.log10(z);
  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const abs = blocks.filter((z) => z > 0 && lk(z) > -70);
  let lufs = -70;
  if (abs.length) {
    const rel = lk(mean(abs)) - 10;
    const gated = abs.filter((z) => lk(z) > rel);
    lufs = lk(mean(gated.length ? gated : abs));
  }

  // forma de onda: RMS por segmento, normalizada
  let wmax = 0;
  for (let b = 0; b < BINS; b++) { wave[b] = Math.sqrt(wave[b] / (binSize * chs.length)); if (wave[b] > wmax) wmax = wave[b]; }
  const waveform = Array.from(wave, (v) => Math.round((wmax ? Math.pow(v / wmax, 0.8) : 0) * 1000) / 1000);

  const tp = Math.max(samplePeak, truePeak(chs, samplePeak));
  const toDb = (v) => (v > 0 ? 20 * Math.log10(v) : -120);
  return { lufs, samplePeakDb: toDb(samplePeak), truePeakDb: toDb(tp), waveform };
}

// Interpolación polifásica 4x (sinc con ventana Blackman, 48 taps). Solo se evalúa
// cerca de las muestras altas, donde pueden aparecer picos inter-muestra.
function truePeak(chs, samplePeak) {
  if (samplePeak < 1e-4) return samplePeak;
  const P = 4, T = 12, N = P * T, M = (N - 1) / 2;
  const phases = [];
  for (let p = 0; p < P; p++) {
    const ph = new Float32Array(T);
    let sum = 0;
    for (let j = 0; j < T; j++) {
      const i = p + P * j;
      const t = (i - M) / P;
      const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
      const w = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)) + 0.08 * Math.cos(4 * Math.PI * i / (N - 1));
      ph[j] = sinc * w;
      sum += ph[j];
    }
    for (let j = 0; j < T; j++) ph[j] /= sum;
    phases.push(ph);
  }
  const thr = samplePeak * 0.5;
  let peak = 0;
  for (const x of chs) {
    for (let i = T - 1; i < x.length; i++) {
      const c = x[i - (T >> 1)];
      if (c < thr && c > -thr) continue;
      for (let p = 0; p < P; p++) {
        const ph = phases[p];
        let acc = 0;
        for (let j = 0; j < T; j++) acc += ph[j] * x[i - j];
        if (acc < 0) acc = -acc;
        if (acc > peak) peak = acc;
      }
    }
  }
  return peak;
}
