// Motor de audio de ZUENA.
// Fuentes:
// · Archivos locales: decodificación completa a PCM float32 y programación sample-accurate → gapless real.
// · Fuentes externas (catálogo, podcasts, radio): streaming por <audio> enrutado al mismo grafo
//   (si el servidor permite CORS); si no, reproducción directa con el volumen del sistema.
// Cadena: voz → fundido → normalización → bus → preamp → EQ → espacial → crossfeed → limitador true-peak
//         → [medidores] → transporte (pausa) → volumen → volumen inteligente → salida
import { EQ_BANDS } from './eq.js';
import { Spatializer, Crossfeed } from './spatial.js';

const dbToGain = (db) => Math.pow(10, db / 20);
const XF_POINTS = 128;
const curve = (fn) => Float32Array.from({ length: XF_POINTS }, (_, i) => fn(i / (XF_POINTS - 1)));
const FADE_IN = curve((t) => Math.sin(t * Math.PI / 2));
const FADE_OUT = curve((t) => Math.cos(t * Math.PI / 2));
// Presupuesto de PCM retenido; no incluye memoria temporal del decodificador.
const bufferBudget = () => {
  const nav = globalThis.navigator;
  const memory = nav?.deviceMemory;
  const mobile = nav?.userAgentData?.mobile || /Android|iPhone|iPad|iPod/i.test(nav?.userAgent || '')
    || (nav?.platform === 'MacIntel' && nav?.maxTouchPoints > 1);
  return (memory > 0 && memory <= 2 ? 32 : mobile || (memory > 0 && memory <= 4) ? 64 : 192) * 1024 * 1024;
};

export const DEFAULT_SETTINGS = {
  volume: 0.8,
  muted: false,
  normalize: true,
  target: -14,
  crossfade: 0,
  eqOn: true,
  eq: EQ_BANDS.map(() => 0),
  limiter: true,
  sinkId: '',
  spatial: 'off',        // off | wide | spatial
  crossfeed: false,
  smartVolume: false,    // compensación de sonoridad a bajo volumen (ISO 226)
  output: 'stereo',      // stereo | 5.1 | 7.1 (para Dolby Atmos / Windows Sonic / receptor)
  headphoneEq: null,     // perfil AutoEQ { name, source, preamp, filters }
  headphoneEqOn: true,
  dspOn: true,           // procesador de masterización ZUENA Studio
  dspPreset: 'audiophile',
  dspWarmth: 0.20,       // calidez analógica / cinta (0 a 1)
  dspBassDrive: 0.30,    // graves psicoacústicos (0 a 1)
  dspAirClarity: 0.25,   // claridad y aire de estudio (0 a 1)
  dspStereoWidth: 1.15,  // campo estéreo holográfico (0.5 a 2.0)
  dspVocalFocus: 0.15,   // presencia vocal (0 a 1)
  dspMonoMaker: true,    // subgraves en mono < 110 Hz
};

export class AudioEngine extends EventTarget {
  constructor() {
    super();
    this.ctx = new AudioContext({ latencyHint: 'playback' });
    const ctx = this.ctx;
    this.bus = ctx.createGain();
    this.bus.channelCountMode = 'max';
    this.preamp = ctx.createGain();
    this.filters = EQ_BANDS.map((b) => new BiquadFilterNode(ctx, { type: b.type, frequency: b.freq, Q: b.q, gain: 0 }));
    this.corrIn = ctx.createGain();   // corrección de auriculares (AutoEQ)
    this.corrOut = ctx.createGain();
    this.corrNodes = [];
    this.corrIn.connect(this.corrOut);
    this.spatial = new Spatializer(ctx);
    this.crossfeed = new Crossfeed(ctx);
    this.transport = ctx.createGain();
    this.master = ctx.createGain();
    this.lowComp = new BiquadFilterNode(ctx, { type: 'lowshelf', frequency: 90, gain: 0 });
    this.highComp = new BiquadFilterNode(ctx, { type: 'highshelf', frequency: 11000, gain: 0 });
    this.analyser = new AnalyserNode(ctx, { fftSize: 8192, smoothingTimeConstant: 0.72, minDecibels: -96, maxDecibels: -12 });
    this.limiter = null;
    this.dsp = null;
    this.gainReduction = 0;
    this.truePeakOut = -120;

    this.settings = structuredClone(DEFAULT_SETTINGS);
    this.voice = null;
    this.pending = null;
    this.nextTrack = null;
    this.buffers = new Map();
    this.bufferCosts = new Map();
    this.bufferLoads = new Map();
    this.bufferBudget = bufferBudget();
    this.preparedTrack = null;
    this.token = 0;
    this.playing = false;
    this.pauseTimer = 0;
    this.pausedAt = 0;
    this.pauseRevision = 0;
    this.resumeRequest = 0;
    this.noDecode = new Set(); // pistas que Web Audio no decodifica: se reproducen por <audio> desde el blob
    this.tickTimer = 0;
    this.wake = null;          // reintentos de reanudación tras una interrupción del sistema
    this.contextRecovery = null;
    this.lostSink = '';        // salida elegida que se desconectó (se recupera si vuelve)
  }

  async init() {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* API opcional */ }
    const ctx = this.ctx;
    try {
      await ctx.audioWorklet.addModule(new URL('./limiter-worklet.js', import.meta.url));
      // hasta 8 canales si el dispositivo lo admite (5.1/7.1, Dolby Atmos para auriculares, Windows Sonic)
      this.maxOut = ctx.destination.maxChannelCount >= 6 ? 8 : 2;
      this.limiter = new AudioWorkletNode(ctx, 'sipa-limiter', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [this.maxOut],
        channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'discrete',
      });
      this.limiter.port.onmessage = (e) => { this.gainReduction = e.data.gr; this.truePeakOut = e.data.tp; };
    } catch (err) {
      console.warn('[engine] limitador no disponible', err);
    }

    try {
      await ctx.audioWorklet.addModule(new URL('./dsp-worklet.js', import.meta.url));
      this.dsp = new AudioWorkletNode(ctx, 'zuena-dsp', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [this.maxOut],
        channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'discrete',
      });
    } catch (err) {
      console.warn('[engine] DSP de estudio no disponible', err);
    }

    let node = this.bus;
    node.connect(this.preamp);
    node = this.preamp;
    for (const f of this.filters) { node.connect(f); node = f; }
    node.connect(this.corrIn);
    this.corrOut.connect(this.spatial.input);
    this.spatial.output.connect(this.crossfeed.input);
    node = this.crossfeed.output;
    if (this.dsp) { node.connect(this.dsp); node = this.dsp; }
    if (this.limiter) { node.connect(this.limiter); node = this.limiter; }
    node.connect(this.analyser);
    this.buildMeters(node);
    node.connect(this.transport);
    this.transport.connect(this.master).connect(this.lowComp).connect(this.highComp).connect(ctx.destination);

    this.applyVolume(true);
    this.applyEq(true);
    this.applyDsp(true);
    this.applyLimiter();
    this.applyCorrection();
    this.applyOutput();
    if (this.settings.sinkId) {
      const id = this.settings.sinkId;
      // la salida guardada no está conectada: suena por la del sistema y se recupera si aparece
      this.setSink(id, { auto: true }).catch(() => { this.lostSink = id; this.settings.sinkId = ''; });
    }
    // robustez: interrupciones del sistema (iOS/Safari), cambios de dispositivo de salida
    ctx.addEventListener('statechange', () => this.onContextState());
    ctx.addEventListener?.('sinkchange', () => this.applyOutput());
    navigator.mediaDevices?.addEventListener?.('devicechange', () => this.onDeviceChange());
    // Con activación previa de la página el contexto nace corriendo: en reposo se suspende (el hilo de audio
    // y el dispositivo no trabajan hasta el primer play, que lo despierta).
    if (!this.playing && ctx.state === 'running') ctx.suspend().catch(() => {});
  }

  // ---------- robustez ----------

  // El contexto dejó de correr sin que lo pidiéramos (llamada, Siri, otra app, bloqueo en iOS/Safari):
  // se reintenta en cuanto la página vuelve a ser visible o hay un gesto del usuario.
  onContextState() {
    const s = this.ctx.state;
    if (s === 'running') { this.disarmWake(); this.recoverContext(); return; }
    if (s === 'closed' || !this.playing) return;
    this.contextRecovery = { voice: this.voice, token: this.token, revision: this.pauseRevision };
    this.emit('interrupted', { state: s });
    this.armWake();
    if (!document.hidden) this.ctx.resume().catch(() => {});
  }

  recoverContext() {
    const recovery = this.contextRecovery;
    if (!recovery) return;
    const v = this.voice;
    if (!this.playing || !v || v.dead || v !== recovery.voice || this.token !== recovery.token
      || this.pauseRevision !== recovery.revision) {
      this.contextRecovery = null;
      return;
    }
    if (this.ctx.state !== 'running' || v.el?.paused) return;
    this.contextRecovery = null;
    this.emit('state', { playing: true });
  }

  armWake() {
    if (this.wake) return;
    const ac = new AbortController();
    const retry = () => {
      if (!this.playing || this.ctx.state === 'running') { this.disarmWake(); return; }
      this.ctx.resume().then(() => {
        const el = this.voice?.el;
        if (this.playing && el?.paused) el.play().then(() => this.recoverContext()).catch(() => {});
        else this.recoverContext();
      }).catch(() => {});
    };
    const opts = { capture: true, passive: true, signal: ac.signal };
    for (const type of ['pointerdown', 'keydown', 'touchend']) document.addEventListener(type, retry, opts);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) retry(); }, { signal: ac.signal });
    this.wake = ac;
  }

  disarmWake() { this.wake?.abort(); this.wake = null; }

  // Se conectó o desconectó un dispositivo: si la salida elegida desapareció se vuelve a la del sistema
  // (y se recupera sola si vuelve); la cantidad de canales del nuevo destino puede ser otra.
  async onDeviceChange() {
    try {
      const want = this.settings.sinkId || this.lostSink;
      if (want && navigator.mediaDevices?.enumerateDevices && typeof this.ctx.setSinkId === 'function') {
        const outs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput');
        const known = outs.some((d) => d.deviceId); // sin permiso los ids vienen vacíos: no se decide nada
        const present = outs.some((d) => d.deviceId === want);
        if (known && !present && this.settings.sinkId) {
          this.lostSink = want;
          await this.setSink('', { auto: true });
          this.emit('sinkchange', { id: '', lost: want });
          return;
        }
        if (known && present && !this.settings.sinkId && this.lostSink) {
          this.lostSink = '';
          await this.setSink(want, { auto: true });
          this.emit('sinkchange', { id: want, restored: true });
          return;
        }
      }
    } catch (err) { console.warn('[engine] cambio de dispositivo', err); }
    this.applyOutput();
  }

  // Medidores profesionales: pico, RMS, correlación estéreo y sonoridad momentánea (filtro K, 400 ms).
  // Se conectan sólo mientras alguien los lee (panel técnico del Modo avanzado): el resto del tiempo el hilo
  // de audio no procesa sus 4 analizadores ni los filtros K (menos CPU, sobre todo en móvil).
  buildMeters(src) {
    const ctx = this.ctx;
    const split = ctx.createChannelSplitter(2);
    this.meter = { src, split, on: false, idle: 0, raw: [], k: [], buf: new Float32Array(2048), kbuf: new Float32Array(16384) };
    for (let c = 0; c < 2; c++) {
      const raw = new AnalyserNode(ctx, { fftSize: 2048 });
      split.connect(raw, c);
      const shelf = new BiquadFilterNode(ctx, { type: 'highshelf', frequency: 1681.97, gain: 4 });
      const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 38.13, Q: 0.5 });
      const k = new AnalyserNode(ctx, { fftSize: 16384 });
      split.connect(shelf, c);
      shelf.connect(hp).connect(k);
      this.meter.raw.push(raw);
      this.meter.k.push(k);
    }
    this.meter.kbuf2 = new Float32Array(16384);
    this.meter.buf2 = new Float32Array(2048);
  }

  meterTap() {
    const m = this.meter;
    clearTimeout(m.idle);
    if (!m.on) { m.src.connect(m.split); m.on = true; }
    m.idle = setTimeout(() => {
      try { m.src.disconnect(m.split); } catch { /* ya desconectado */ }
      m.on = false;
    }, 3000);
  }

  readMeters() {
    const m = this.meter;
    if (!m) return null;
    this.meterTap();
    const [a, b] = [m.buf, m.buf2];
    m.raw[0].getFloatTimeDomainData(a);
    m.raw[1].getFloatTimeDomainData(b);
    let pl = 0, pr = 0, sl = 0, sr = 0, slr = 0;
    for (let i = 0; i < a.length; i++) {
      const l = a[i], r = b[i];
      pl = Math.max(pl, Math.abs(l)); pr = Math.max(pr, Math.abs(r));
      sl += l * l; sr += r * r; slr += l * r;
    }
    const [ka, kb] = [m.kbuf, m.kbuf2];
    m.k[0].getFloatTimeDomainData(ka);
    m.k[1].getFloatTimeDomainData(kb);
    const win = Math.min(ka.length, Math.round(this.ctx.sampleRate * 0.4));
    let kl = 0, kr = 0;
    for (let i = ka.length - win; i < ka.length; i++) { kl += ka[i] * ka[i]; kr += kb[i] * kb[i]; }
    const z = (kl + kr) / win;
    const toDb = (v) => (v > 1e-7 ? 20 * Math.log10(v) : -120);
    return {
      peakL: toDb(pl), peakR: toDb(pr),
      rmsL: toDb(Math.sqrt(sl / a.length)), rmsR: toDb(Math.sqrt(sr / b.length)),
      correlation: sl && sr ? slr / Math.sqrt(sl * sr) : 0,
      momentary: z > 1e-10 ? -0.691 + 10 * Math.log10(z) : -120,
      truePeak: this.truePeakOut,
      gr: this.gainReduction,
    };
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  // ---------- ajustes ----------

  setSettings(partial) {
    const prev = this.settings;
    this.settings = { ...prev, ...partial };
    if ('volume' in partial || 'muted' in partial || 'smartVolume' in partial) this.applyVolume();
    if ('eq' in partial || 'eqOn' in partial) this.applyEq();
    if ('dspOn' in partial || 'dspPreset' in partial || 'dspWarmth' in partial || 'dspBassDrive' in partial || 'dspAirClarity' in partial || 'dspStereoWidth' in partial || 'dspVocalFocus' in partial || 'dspMonoMaker' in partial) this.applyDsp();
    if ('limiter' in partial) this.applyLimiter();
    if ('spatial' in partial || 'crossfeed' in partial) this.applySpatial();
    if ('headphoneEq' in partial || 'headphoneEqOn' in partial) this.applyCorrection();
    if ('output' in partial) this.applyOutput();
    if ('normalize' in partial || 'target' in partial) this.refreshGains();
    if ('crossfade' in partial && partial.crossfade !== prev.crossfade) this.scheduleNext();
  }

  volumeGain() {
    const { volume, muted } = this.settings;
    return muted ? 0 : Math.pow(volume, 3); // curva perceptual
  }

  applyVolume(instant = false) {
    const g = this.volumeGain();
    const tc = instant ? 0 : 0.03;
    this.setParam(this.master.gain, g, tc);
    // volumen inteligente: a bajo volumen el oído pierde graves y agudos (curvas ISO 226)
    const volDb = g > 0 ? 20 * Math.log10(g) : -60;
    const on = this.settings.smartVolume;
    this.setParam(this.lowComp.gain, on ? Math.min(9, Math.max(0, -volDb * 0.3)) : 0, 0.08);
    this.setParam(this.highComp.gain, on ? Math.min(4, Math.max(0, -volDb * 0.12)) : 0, 0.08);
    if (this.voice?.direct) this.voice.el.volume = Math.min(1, g);
  }

  applyEq(instant = false) {
    const { eq, eqOn } = this.settings;
    const tc = instant ? 0 : 0.04;
    this.filters.forEach((f, i) => this.setParam(f.gain, eqOn ? eq[i] : 0, tc));
    const boost = eqOn ? Math.max(0, ...eq) : 0;
    this.setParam(this.preamp.gain, dbToGain(-boost), tc);
  }

  applyLimiter() {
    if (this.limiter) this.limiter.parameters.get('bypass').value = this.settings.limiter ? 0 : 1;
  }

  applyDsp(instant = false) {
    if (!this.dsp) return;
    const s = this.settings;
    const t = this.ctx.currentTime;
    const tc = instant ? 0 : 0.03;
    const p = this.dsp.parameters;
    const set = (name, val) => {
      const param = p.get(name);
      if (!param) return;
      if (instant || tc === 0) {
        param.cancelScheduledValues(t);
        param.setValueAtTime(val, t);
      } else {
        param.setTargetAtTime(val, t, tc);
      }
    };
    const on = s.dspOn !== false;
    set('bypass', on ? 0 : 1);
    set('warmth', on ? (s.dspWarmth ?? 0.20) : 0);
    set('bassDrive', on ? (s.dspBassDrive ?? 0.30) : 0);
    set('airClarity', on ? (s.dspAirClarity ?? 0.25) : 0);
    set('stereoWidth', on ? (s.dspStereoWidth ?? 1.15) : 1.0);
    set('vocalFocus', on ? (s.dspVocalFocus ?? 0.15) : 0);
    set('monoMaker', on && s.dspMonoMaker !== false ? 1 : 0);
  }

  // canales de salida efectivos según la elección y lo que admite el dispositivo
  get outChannels() {
    const max = this.ctx.destination.maxChannelCount;
    const want = { '7.1': 8, '5.1': 6 }[this.settings.output] || 2;
    return want <= max && want <= (this.maxOut || 2) ? want : 2;
  }

  applyOutput() {
    const n = this.outChannels;
    const dest = this.ctx.destination;
    try {
      dest.channelCount = n;
      dest.channelInterpretation = n > 2 ? 'discrete' : 'speakers';
      if (this.limiter) this.limiter.channelCount = n;
    } catch (err) { console.warn('[engine] salida multicanal no disponible', err); }
    this.applySpatial();
  }

  applySpatial() {
    const ch = this.voice?.buffer?.numberOfChannels || 2;
    const src = ch >= 8 ? 8 : ch >= 6 ? 6 : 2;
    const out = this.outChannels;
    // con salida multicanal, el modo espacial reparte a parlantes reales/virtuales (no binaural)
    const mode = out > 2 ? (this.settings.spatial === 'off' && src === 2 ? 'off' : 'upmix') : this.settings.spatial;
    this.spatial.setMode(mode, src, out);
    this.crossfeed.set(out === 2 && this.settings.crossfeed && this.settings.spatial !== 'spatial');
  }

  // corrección de auriculares AutoEQ: preamp + hasta 10 filtros paramétricos
  applyCorrection() {
    try { this.corrIn.disconnect(); } catch { /* ya desconectado */ }
    for (const n of this.corrNodes) { try { n.disconnect(); } catch { /* idem */ } }
    this.corrNodes = [];
    const p = this.settings.headphoneEqOn ? this.settings.headphoneEq : null;
    this.corrIn.gain.value = p ? Math.pow(10, Math.min(0, p.preamp) / 20) : 1;
    let node = this.corrIn;
    for (const f of p?.filters?.slice(0, 12) || []) {
      const b = new BiquadFilterNode(this.ctx, { type: f.type, frequency: f.f, Q: f.q, gain: f.g });
      node.connect(b);
      this.corrNodes.push(b);
      node = b;
    }
    node.connect(this.corrOut);
  }

  setParam(param, value, tc) {
    const t = this.ctx.currentTime;
    param.cancelScheduledValues(t);
    if (tc <= 0) param.setValueAtTime(value, t);
    else param.setTargetAtTime(value, t, tc);
  }

  async setSink(id, { auto = false } = {}) {
    if (typeof this.ctx.setSinkId !== 'function') return false;
    if (!auto) this.lostSink = ''; // una elección explícita reemplaza a la salida perdida
    await this.ctx.setSinkId(id || '');
    if (this.voice?.direct && this.voice.el.setSinkId) await this.voice.el.setSinkId(id || '');
    this.settings.sinkId = id || '';
    this.applyOutput(); // otro dispositivo puede admitir otra cantidad de canales
    return true;
  }

  normDb(track) {
    if (!this.settings.normalize || !track) return 0;
    const a = track.analysis;
    const rg = track.replayGain;
    let gain = null, tp = null;
    if (a && Number.isFinite(a.lufs) && a.lufs > -70) {
      gain = this.settings.target - a.lufs;
      tp = a.truePeakDb;
    } else if (rg && Number.isFinite(rg.trackGain)) {
      gain = rg.trackGain + (this.settings.target + 18);
      if (rg.trackPeak > 0) tp = 20 * Math.log10(rg.trackPeak);
    }
    if (gain == null) return 0;
    if (gain > 0 && tp != null) gain = Math.min(gain, Math.max(0, -1 - tp));
    return Math.max(-24, Math.min(12, gain));
  }

  refreshGains(trackId) {
    for (const v of [this.voice, this.pending]) {
      if (!v?.norm || (trackId && v.track.id !== trackId)) continue;
      this.setParam(v.norm.gain, dbToGain(this.normDb(v.track)), 0.12);
    }
  }

  // ---------- buffers (archivos locales) ----------

  loadBuffer(track) {
    // Inicialización diferida también para motores de prueba sin constructor Web Audio.
    this.bufferCosts ??= new Map();
    this.bufferLoads ??= new Map();
    this.bufferBudget ??= bufferBudget();
    let p = this.buffers.get(track.id);
    if (p) {
      this.buffers.delete(track.id);
      this.buffers.set(track.id, p);
      return p;
    }
    p = this.bufferLoads.get(track.id);
    if (p) return p;
    // Las cargas en curso no son expulsables: prefetch, play y planificación comparten una promesa.
    p = Promise.resolve().then(() => track.blob.arrayBuffer())
      .then((ab) => this.ctx.decodeAudioData(ab))
      .then((buffer) => {
        this.noDecode.delete(track.id);
        this.buffers.set(track.id, p);
        this.bufferCosts.set(track.id, buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT);
        this.trimCache();
        return buffer;
      }, (error) => {
        // Sólo un error de formato merece respaldo persistente; lectura/memoria/contexto permiten reintento.
        if (track.blob && error?.name === 'EncodingError') this.noDecode.add(track.id);
        throw error;
      }).finally(() => {
        if (this.bufferLoads.get(track.id) === p) this.bufferLoads.delete(track.id);
      });
    this.bufferLoads.set(track.id, p);
    return p;
  }

  trimCache() {
    if (!this.bufferCosts) return;
    const keep = new Set([this.voice?.track.id, this.pending?.track.id, this.nextTrack?.id, this.preparedTrack?.track.id]);
    let bytes = this.cachedBufferBytes;
    for (const id of this.buffers.keys()) {
      if (bytes <= this.bufferBudget) break;
      if (keep.has(id)) continue;
      bytes -= this.bufferCosts.get(id) || 0;
      this.buffers.delete(id);
      this.bufferCosts.delete(id);
    }
  }

  get cachedBufferBytes() {
    let bytes = 0;
    for (const cost of this.bufferCosts?.values() || []) bytes += cost;
    return bytes;
  }

  // ---------- transporte ----------

  get position() {
    const v = this.voice;
    if (!v) return 0;
    if (v.retryPosition != null) return v.retryPosition;
    if (v.el) return v.el.currentTime || 0;
    const now = this.ctx.currentTime - (this.ctx.outputLatency || 0);
    return Math.min(v.buffer.duration, Math.max(0, now - v.startAt) + v.offset);
  }

  get duration() {
    const v = this.voice;
    if (!v) return 0;
    if (v.retryDuration != null) return v.retryDuration;
    if (v.el) return Number.isFinite(v.el.duration) ? v.el.duration : 0;
    return v.buffer.duration;
  }

  get current() { return this.voice?.track ?? null; }
  get live() { return !!this.voice?.track.live; }

  async play(track, offset = 0, auto = false) {
    const token = ++this.token;
    this.contextRecovery = null;
    const prepared = this.preparedTrack = { track, token };
    try {
      const pauseRevision = this.pauseRevision;
      this.emit('loading', { track });
      if (track.kind === 'remote') return this.playStream(track, offset, auto, token);
      // Se despierta el contexto ya, en paralelo con la decodificación: reduce la latencia de inicio y en
      // iOS/Safari la reanudación tiene que pedirse dentro del gesto del usuario (antes de cualquier await).
      if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
      let buffer = null;
      if (!this.noDecode.has(track.id)) {
        try {
          buffer = await this.loadBuffer(track);
        } catch (err) {
          if (token !== this.token) return;
          if (!track.blob) { this.failed(track, err, auto, token, offset); return; }
        }
      }
      if (token !== this.token) return;
      // respaldo: el navegador puede reproducir por <audio> formatos que decodeAudioData rechaza (sin gapless)
      if (!buffer) return this.playStream(track, offset, auto, token, URL.createObjectURL(track.blob));
      if (pauseRevision === this.pauseRevision) await this.resume(true);
      if (token !== this.token) return;
      if (!this.playing) await this.ctx.suspend();
      if (token !== this.token) return;
      this.killVoice(this.voice, 0.015);
      this.killVoice(this.pending, 0.005);
      this.pending = null;
      this.voice = this.makeVoice(track, buffer, offset, this.ctx.currentTime + 0.02, 0.01);
      this.applySpatial();
      this.emit('trackchange', { track, auto });
      this.scheduleNext();
    } finally {
      if (this.preparedTrack === prepared) this.preparedTrack = null;
      this.trimCache();
    }
  }

  // ----- streaming -----

  // `url` (opcional): fuente distinta de track.stream, p. ej. el blob de un archivo local que Web Audio no decodifica
  async playStream(track, offset, auto, token, url) {
    const revoke = () => { if (url?.startsWith('blob:')) URL.revokeObjectURL(url); };
    await this.resume(true);
    if (token !== this.token) { revoke(); return; }
    if (!this.playing) { revoke(); this.emit('buffering', { on: false }); return; }
    this.killVoice(this.voice, 0.02);
    this.killVoice(this.pending, 0.005);
    this.pending = null;
    let v;
    try {
      v = await this.openStream(track, offset, true, url);
    } catch (first) {
      try {
        // el servidor no permite procesar: reproducción directa (un blob propio no tiene ese problema)
        if (url || first?.name === 'NotAllowedError') throw first;
        v = await this.openStream(track, offset, false);
      } catch (err) {
        revoke();
        this.failed(track, err, auto, token, offset);
        return;
      }
    }
    if (token !== this.token) { this.killVoice(v, 0); return; }
    this.voice = v;
    this.trimCache();
    this.applySpatial();
    if (v.blocked) {
      // el navegador no dejó arrancar sin un gesto: la pista queda cargada y en pausa (no se saltea)
      if (this.playing) { this.playing = false; this.emit('state', { playing: false }); }
      this.ramp(this.transport.gain, 0, 0.01);
      this.ctx.suspend().catch(() => {});
      this.emit('blocked', { track });
    }
    // si se pausó mientras la fuente cargaba, se respeta la pausa
    if (!this.playing) { v.el.pause(); this.emit('buffering', { on: false }); }
    this.emit('trackchange', { track, auto });
  }

  openStream(track, offset, routed, url = track.stream) {
    return new Promise((resolve, reject) => {
      const el = new Audio();
      el.preload = 'auto';
      if (routed && !url.startsWith('blob:')) el.crossOrigin = 'anonymous';
      // listeners atados a la voz: se quitan todos juntos al descartarla
      const ac = new AbortController();
      const on = (type, fn) => el.addEventListener(type, fn, { signal: ac.signal });
      const v = { track, el, ac, url, direct: !routed, dead: false, startAt: 0, offset: 0, xf: 0 };
      if (routed) {
        v.src = this.ctx.createMediaElementSource(el);
        v.fade = this.ctx.createGain();
        v.norm = this.ctx.createGain();
        v.fade.gain.value = 0;
        v.src.connect(v.fade).connect(v.norm).connect(this.bus);
      } else {
        el.volume = Math.min(1, this.volumeGain());
        if (this.settings.sinkId && el.setSinkId) el.setSinkId(this.settings.sinkId).catch(() => {});
      }
      let settled = false;
      const fail = () => {
        if (settled) { if (!v.dead && v === this.voice) this.onStreamError(v); return; }
        settled = true;
        this.killVoice(v, 0);
        reject(el.error || new Error('No se pudo abrir la fuente'));
      };
      on('error', fail);
      on('ended', () => this.onVoiceEnded(v));
      on('waiting', () => v === this.voice && this.playing && this.emit('buffering', { on: true }));
      on('playing', () => v === this.voice && this.emit('buffering', { on: false }));
      // el sistema pausó el elemento (auriculares desconectados, otra app, control del sistema): se refleja la pausa
      on('pause', () => { if (!v.dead && v === this.voice && this.playing && !el.ended && !el.error) this.pause(); });
      el.src = url;
      if (offset && !track.live) el.currentTime = offset;
      el.play().then(() => {
        if (settled) return;
        settled = true;
        if (v.fade) { const t = this.ctx.currentTime; v.fade.gain.setValueAtTime(0, t); v.fade.gain.linearRampToValueAtTime(1, t + 0.03); }
        resolve(v);
      }).catch((err) => {
        if (settled || err?.name !== 'NotAllowedError') { fail(); return; }
        // falta un gesto del usuario (autoplay): la fuente es válida, queda lista en pausa
        settled = true;
        v.blocked = true;
        if (v.fade) v.fade.gain.value = 1;
        resolve(v);
      });
    });
  }

  // Un fallo confirmado conserva selección y posición para retry; nunca decide saltar de pista.
  failed(track, error, auto, token, offset = 0) {
    if (token !== this.token) return;
    this.failVoice(track, error, offset);
  }

  failVoice(track, error, offset = 0) {
    const same = this.voice?.track?.id === track.id;
    const position = track.live ? 0 : same && !this.voice.dead ? this.position : offset;
    const duration = same ? this.duration : track.duration;
    this.token++;
    this.pauseRevision++;
    this.resumeRequest++;
    this.contextRecovery = null;
    clearTimeout(this.tickTimer);
    clearTimeout(this.pauseTimer);
    this.disarmWake();
    this.killVoice(this.voice, 0);
    this.killVoice(this.pending, 0);
    this.pending = null;
    this.preparedTrack = null;
    const failedVoice = this.voice = {
      track, dead: true,
      retryPosition: Number.isFinite(position) ? Math.max(0, position) : 0,
      retryDuration: Number.isFinite(duration) ? Math.max(0, duration) : 0,
    };
    this.playing = false;
    this.trimCache();
    // Estado definitivo antes de notificar: los listeners pueden iniciar retry sin limpieza posterior.
    this.emit('state', { playing: false });
    this.emit('buffering', { on: false });
    this.idle();
    this.emit('error', { track, error, position: failedVoice.retryPosition, duration: failedVoice.retryDuration });
  }

  onStreamError(v) {
    if (v !== this.voice || v.dead) return;
    this.failVoice(v.track, v.el.error);
  }

  // ----- pausa / reanudación -----

  async resume(forPreparedPlay = false) {
    const failed = this.voice;
    // El marcador de error no es una fuente reanudable. El play ya preparado evita volver a entrar aquí.
    if (failed?.retryPosition != null && !forPreparedPlay) {
      return this.play(failed.track, failed.track.live ? 0 : failed.retryPosition);
    }
    const revision = this.pauseRevision;
    const request = ++this.resumeRequest;
    clearTimeout(this.pauseTimer);
    if (this.ctx.state !== 'running') await this.ctx.resume();
    if (revision !== this.pauseRevision || request !== this.resumeRequest) {
      if (request === this.resumeRequest && !this.playing) await this.ctx.suspend();
      return;
    }
    const v = this.voice;
    if (v?.el && v.el.paused) {
      // una radio pausada un rato vuelve al vivo
      if (v.track.live && Date.now() - this.pausedAt > 5000) { const s = v.el.src; v.el.src = ''; v.el.src = s; }
      try { await v.el.play(); } catch (err) {
        // sin gesto del usuario no es un error de la pista: se queda en pausa y no se saltea
        if (err?.name === 'NotAllowedError') {
          if (!this.playing && request === this.resumeRequest) this.ctx.suspend().catch(() => {});
          this.emit('blocked', { track: v.track });
        } else this.emit('error', { track: v.track, error: err });
        return;
      }
      v.blocked = false;
    }
    if (revision !== this.pauseRevision || request !== this.resumeRequest) {
      if (request === this.resumeRequest) v?.el?.pause();
      return;
    }
    this.ramp(this.transport.gain, 1, 0.07);
    if (!this.playing) { this.playing = true; this.emit('state', { playing: true }); }
    else this.recoverContext();
  }

  pause() {
    this.pauseRevision++;
    this.contextRecovery = null;
    this.disarmWake();
    if (!this.playing) return;
    this.playing = false;
    this.pausedAt = Date.now();
    this.emit('state', { playing: false });
    this.emit('buffering', { on: false });
    this.ramp(this.transport.gain, 0, 0.07);
    const v = this.voice;
    if (v?.direct) v.el.pause();
    this.pauseTimer = setTimeout(() => {
      if (this.playing) return;
      if (this.voice?.el) this.voice.el.pause();
      this.ctx.suspend();
    }, 100);
  }

  toggle() { return this.playing ? this.pause() : this.resume(); }

  ramp(param, value, dur) {
    const t = this.ctx.currentTime;
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
    else { param.cancelScheduledValues(t); param.setValueAtTime(param.value, t); }
    param.linearRampToValueAtTime(value, t + dur);
  }

  seek(time) {
    const v = this.voice;
    if (!v) return;
    if (v.retryPosition != null) {
      if (v.track.live || !Number.isFinite(time)) return;
      v.retryPosition = Math.max(0, v.retryDuration > 0 ? Math.min(time, Math.max(0, v.retryDuration - 0.2)) : time);
      this.emit('seek', { time: v.retryPosition });
      return;
    }
    if (v.el) {
      if (v.track.live || !Number.isFinite(v.el.duration)) return;
      v.el.currentTime = Math.max(0, Math.min(time, v.el.duration - 0.2));
      this.emit('seek', { time });
      return;
    }
    const t = Math.max(0, Math.min(time, v.buffer.duration - 0.05));
    this.killVoice(v, 0.012);
    this.killVoice(this.pending, 0.005);
    this.pending = null;
    this.voice = this.makeVoice(v.track, v.buffer, t, this.ctx.currentTime + 0.004, 0.014);
    this.scheduleNext();
    this.emit('seek', { time: t });
  }

  stop() {
    this.pauseRevision++;
    this.contextRecovery = null;
    this.token++;
    this.killVoice(this.voice, 0.02);
    this.killVoice(this.pending, 0.005);
    this.voice = this.pending = null;
    this.preparedTrack = null;
    this.trimCache();
    if (this.playing) { this.playing = false; this.emit('state', { playing: false }); }
  }

  setNext(track) {
    if (track === this.nextTrack && (this.pending || !track)) return;
    this.nextTrack = track || null;
    if (track && track.kind !== 'remote' && !this.noDecode.has(track.id)) this.loadBuffer(track).catch(() => {});
    this.scheduleNext();
    this.trimCache();
  }

  // ---------- voces de buffer ----------

  makeVoice(track, buffer, offset, when, fadeIn) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const fade = ctx.createGain();
    const norm = ctx.createGain();
    norm.gain.value = dbToGain(this.normDb(track));
    if (fadeIn > 0) {
      fade.gain.setValueAtTime(0, when);
      fade.gain.linearRampToValueAtTime(1, when + fadeIn);
    }
    src.connect(fade).connect(norm).connect(this.bus);
    src.start(when, offset);
    const v = { track, buffer, src, fade, norm, startAt: when, offset, endAt: when + buffer.duration - offset, xf: 0, dead: false };
    src.onended = () => this.onVoiceEnded(v);
    return v;
  }

  // descarta una voz: fundido corto y luego se desconectan TODOS sus nodos y listeners (sin fugas)
  killVoice(v, fade) {
    if (!v || v.dead) return;
    v.dead = true;
    const release = () => {
      for (const n of [v.src, v.fade, v.norm]) { try { n?.disconnect(); } catch { /* ya desconectado */ } }
    };
    if (v.el) {
      const el = v.el;
      v.ac?.abort();
      const stopEl = () => {
        el.pause(); el.removeAttribute('src'); el.load(); release();
        if (v.url?.startsWith('blob:')) URL.revokeObjectURL(v.url);
      };
      if (v.fade && fade > 0) { this.ramp(v.fade.gain, 0, fade); setTimeout(stopEl, (fade + 0.05) * 1000); }
      else stopEl();
      return;
    }
    const t = this.ctx.currentTime;
    v.src.onended = null;
    this.ramp(v.fade.gain, 0, fade);
    try { v.src.stop(t + fade + 0.005); } catch { /* ya detenida */ }
    setTimeout(release, (fade + 0.2) * 1000);
  }

  crossfadeFor(a, b) {
    const xf = this.settings.crossfade;
    if (!xf || !a || !b) return 0;
    const sameAlbum = a.album && a.album === b.album && (a.albumArtist || a.artist) === (b.albumArtist || b.artist);
    if (sameAlbum && b.track === a.track + 1) return 0;
    return Math.min(xf, (a.duration || 30) / 3, (b.duration || 30) / 3);
  }

  scheduleNext() {
    const v = this.voice;
    if (this.pending) {
      this.killVoice(this.pending, 0.005);
      this.pending = null;
      if (v && v.xf && !v.el && this.ctx.currentTime < v.endAt - v.xf) {
        const g = v.fade.gain, t = this.ctx.currentTime;
        g.cancelScheduledValues(t);
        g.setValueAtTime(1, t);
        v.xf = 0;
      }
    }
    const next = this.nextTrack;
    if (!v || v.dead || v.el || !next || next.kind === 'remote' || this.noDecode.has(next.id)) return;
    const token = this.token;
    this.loadBuffer(next).then((buffer) => {
      if (token !== this.token || v !== this.voice || v.dead || this.nextTrack !== next || this.pending) return;
      const xf = this.crossfadeFor(v.track, next);
      const when = Math.max(this.ctx.currentTime + 0.05, v.endAt - xf);
      const p = this.makeVoice(next, buffer, 0, when, 0);
      if (xf > 0) {
        p.fade.gain.setValueCurveAtTime(FADE_IN, when, xf);
        v.fade.gain.cancelScheduledValues(when);
        v.fade.gain.setValueCurveAtTime(FADE_OUT, when, xf);
        v.xf = p.xf = xf;
      }
      this.pending = p;
      this.armTick();
    }).catch((error) => {
      if (token !== this.token || this.nextTrack !== next) return;
      // si hay archivo se reproducirá por <audio> al llegar (sin gapless); sin archivo, la pista no sirve
      if (!next.blob) this.emit('error', { track: next, error });
    });
  }

  promote() {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    this.voice = p;
    this.trimCache();
    this.emit('trackchange', { track: p.track, auto: true });
  }

  onVoiceEnded(v) {
    if (v.dead) return;
    // voz anterior que terminó después del relevo gapless: se liberan sus nodos (antes quedaban conectados)
    if (v !== this.voice) { this.killVoice(v, 0); return; }
    if (this.pending) { this.promote(); return; }
    if (this.nextTrack) {
      // Sin relevo preparado (stream, decode en curso o precarga transitoria fallida), cargar bajo demanda.
      // Es avance natural al terminar, no un salto tras error; failed conserva esta selección si falla.
      this.play(this.nextTrack, 0, true);
      return;
    }
    this.killVoice(v, 0);
    this.voice = null;
    this.playing = false;
    this.emit('state', { playing: false });
    this.emit('ended', { track: v.track });
    this.idle();
  }

  // fin de la cola: el contexto se suspende tras un momento (sin trabajo del hilo de audio en reposo)
  idle() {
    this.trimCache();
    clearTimeout(this.pauseTimer);
    this.pauseTimer = setTimeout(() => { if (!this.playing) this.ctx.suspend().catch(() => {}); }, 500);
  }

  // La siguiente pista pasa a ser la actual a mitad del fundido. Antes era un sondeo cada 100 ms durante toda
  // la sesión; ahora un único temporizador apuntado a ese instante (se re-arma si el contexto estuvo en pausa).
  armTick() {
    clearTimeout(this.tickTimer);
    this.tickTimer = 0;
    const p = this.pending;
    if (!p) return;
    const wait = (p.startAt + p.xf / 2 - this.ctx.currentTime) * 1000;
    this.tickTimer = setTimeout(() => this.tick(), Math.max(20, Math.min(wait, 60000)));
  }

  tick() {
    this.tickTimer = 0;
    const p = this.pending;
    if (!p) return;
    if (this.ctx.currentTime >= p.startAt + p.xf / 2) this.promote();
    else this.armTick();
  }

  get outputInfo() {
    const v = this.voice;
    return {
      sampleRate: this.ctx.sampleRate,
      latency: ((this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0)) * 1000,
      sourceRate: v?.buffer?.sampleRate,
      channels: v?.buffer?.numberOfChannels,
      streaming: !!v?.el,
      processed: !v?.direct,
      outChannels: this.outChannels,
      maxChannels: this.ctx.destination.maxChannelCount,
      bufferCache: {
        entries: this.buffers.size,
        bytes: this.cachedBufferBytes,
        budgetBytes: this.bufferBudget ?? bufferBudget(),
        inFlight: this.bufferLoads?.size || 0,
        overBudget: this.cachedBufferBytes > (this.bufferBudget ?? bufferBudget()),
      },
    };
  }
}
