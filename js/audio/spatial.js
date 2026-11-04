// Audio espacial de ZUENA (renderizado binaural propio con HRTF).
// · 'spatial': cada canal se ubica como un parlante virtual alrededor de la cabeza.
//   Estéreo → frente L/R a ±30°, ambiente extraído (L−R) a ±110° y alturas a +35° con sala sintética.
//   5.1 / 7.1 → cada canal en su posición estándar (ITU-R BS.775), LFE repartido sin espacializar.
// · 'wide': ensanchamiento Mid/Side para parlantes.
// · 'off': puente directo, sin procesamiento.
// Dolby Atmos (E-AC-3 JOC / TrueHD) requiere licencia y decodificador propietarios que los navegadores
// no exponen; esto es un renderizador espacial propio que funciona con cualquier fuente.

const SPEAKERS = {
  2: [[-30, 0], [30, 0]],
  6: [[-30, 0], [30, 0], [0, 0], null, [-110, 0], [110, 0]],
  8: [[-30, 0], [30, 0], [0, 0], null, [-150, 0], [150, 0], [-90, 0], [90, 0]],
};

function placePanner(ctx, az, el, dist = 1.6) {
  const p = ctx.createPanner();
  p.panningModel = 'HRTF';
  p.distanceModel = 'linear';
  p.rolloffFactor = 0;
  const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180;
  p.positionX.value = Math.sin(a) * Math.cos(e) * dist;
  p.positionY.value = Math.sin(e) * dist;
  p.positionZ.value = -Math.cos(a) * Math.cos(e) * dist;
  return p;
}

// Respuesta al impulso de una sala chica y cálida (ruido decorrelado con caída exponencial)
function roomImpulse(ctx, seconds = 1.1, decay = 3.2) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      lp += 0.35 * ((Math.random() * 2 - 1) - lp); // ruido levemente filtrado: sala menos brillante
      d[i] = lp * Math.pow(1 - t, decay) * (i < ctx.sampleRate * 0.008 ? i / (ctx.sampleRate * 0.008) : 1);
    }
  }
  return buf;
}

export class Spatializer {
  constructor(ctx) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.input.channelCountMode = 'max';
    this.output = ctx.createGain();
    this.mode = 'off';
    this.channels = 2;
    this.nodes = [];
    this.impulse = null;
    this.input.connect(this.output);
  }

  setMode(mode, channels = this.channels, outChannels = 2) {
    if (mode === this.mode && channels === this.channels && outChannels === this.outChannels) return;
    this.mode = mode;
    this.channels = channels;
    this.outChannels = outChannels;
    this.teardown();
    if (mode === 'upmix') this.buildUpmix(channels, outChannels);
    else if (mode === 'spatial') this.buildSpatial(channels);
    else if (mode === 'wide') this.buildWide();
    else this.input.connect(this.output);
  }

  teardown() {
    try { this.input.disconnect(); } catch { /* ya desconectado */ }
    for (const n of this.nodes) { try { n.disconnect(); } catch { /* idem */ } }
    this.nodes = [];
  }

  keep(...n) { this.nodes.push(...n); return n[0]; }

  // Salida a parlantes reales o a un virtualizador del sistema (Dolby Atmos para auriculares,
  // Windows Sonic, receptor 5.1/7.1). Orden de canales Windows/WAVE: FL FR FC LFE (BL BR) SL SR.
  // Fuentes multicanal pasan tal cual; el estéreo se reparte: centro (voz) extraído, LFE con los
  // graves, envolventes con la diferencia L−R retardada y suavizada (no "ensucia" el frente).
  buildUpmix(srcCh, outCh) {
    const { ctx } = this;
    const n = outCh >= 8 ? 8 : 6;
    const merge = this.keep(ctx.createChannelMerger(n));
    merge.channelInterpretation = 'discrete';
    const split = this.keep(ctx.createChannelSplitter(Math.max(2, Math.min(8, srcCh))));
    this.input.connect(split);
    const route = (from, to, gain = 1, filters = []) => {
      let node = this.keep(new GainNode(ctx, { gain }));
      split.connect(node, from);
      for (const f of filters) { const k = this.keep(f); node.connect(k); node = k; }
      node.connect(merge, 0, to);
    };
    if (srcCh >= 6) {
      // multicanal nativo: 5.1 → 5.1/7.1 y 7.1 → 7.1 (o 7.1 → 5.1 plegando traseros en laterales)
      for (let c = 0; c < Math.min(srcCh, n); c++) route(c, c);
      if (srcCh === 8 && n === 6) { route(6, 4, 0.7); route(7, 5, 0.7); }
      if (srcCh === 6 && n === 8) { route(4, 6, 0.8); route(5, 7, 0.8); }
    } else {
      const lp = (f) => new BiquadFilterNode(ctx, { type: 'lowpass', frequency: f, Q: 0.707 });
      const hp = (f) => new BiquadFilterNode(ctx, { type: 'highpass', frequency: f, Q: 0.707 });
      const dl = (s) => new DelayNode(ctx, { delayTime: s });
      route(0, 0, 0.9); route(1, 1, 0.9);
      route(0, 2, 0.32, [hp(120), lp(9000)]); route(1, 2, 0.32, [hp(120), lp(9000)]);      // centro: voz
      route(0, 3, 0.35, [lp(110)]); route(1, 3, 0.35, [lp(110)]);                          // LFE
      const sl = n === 8 ? 6 : 4, sr = n === 8 ? 7 : 5;
      route(0, sl, 0.5, [dl(0.012), lp(7000)]); route(1, sl, -0.5, [dl(0.012), lp(7000)]); // L−R
      route(1, sr, 0.5, [dl(0.014), lp(7000)]); route(0, sr, -0.5, [dl(0.014), lp(7000)]); // R−L
      if (n === 8) {
        route(0, 4, 0.36, [dl(0.022), lp(5000)]); route(1, 4, -0.36, [dl(0.022), lp(5000)]);
        route(1, 5, 0.36, [dl(0.025), lp(5000)]); route(0, 5, -0.36, [dl(0.025), lp(5000)]);
      }
    }
    merge.connect(this.output);
  }

  buildWide(k = 1.45) {
    const { ctx } = this;
    const split = this.keep(ctx.createChannelSplitter(2));
    const merge = this.keep(ctx.createChannelMerger(2));
    const a = (1 + k) / 2, b = (1 - k) / 2;
    const ll = this.keep(new GainNode(ctx, { gain: a })), lr = this.keep(new GainNode(ctx, { gain: b }));
    const rr = this.keep(new GainNode(ctx, { gain: a })), rl = this.keep(new GainNode(ctx, { gain: b }));
    const trim = this.keep(new GainNode(ctx, { gain: 0.72 }));
    this.input.connect(split);
    split.connect(ll, 0); split.connect(rl, 0);
    split.connect(rr, 1); split.connect(lr, 1);
    ll.connect(merge, 0, 0); lr.connect(merge, 0, 0);
    rr.connect(merge, 0, 1); rl.connect(merge, 0, 1);
    merge.connect(trim).connect(this.output);
  }

  buildSpatial(channels) {
    const { ctx } = this;
    const layout = SPEAKERS[channels] || SPEAKERS[2];
    const n = Math.max(2, layout.length);
    const split = this.keep(ctx.createChannelSplitter(n));
    // compensación medida: la suma de parlantes virtuales HRTF + sala sube ~8 dB el pico; así el modo
    // espacial suena al mismo nivel que el estéreo y no hace trabajar al limitador
    const sum = this.keep(new GainNode(ctx, { gain: channels > 2 ? 0.36 : 0.42 }));
    this.input.connect(split);

    layout.forEach((pos, i) => {
      if (!pos) {
        // LFE: sin espacializar, a ambos oídos, −3 dB y sólo graves
        const lp = this.keep(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 120 }));
        const g = this.keep(new GainNode(ctx, { gain: 0.5 }));
        split.connect(lp, i);
        lp.connect(g).connect(sum);
        return;
      }
      const p = this.keep(placePanner(ctx, pos[0], pos[1]));
      split.connect(p, i);
      p.connect(sum);
    });

    if (channels <= 2) {
      // ambiente: (L − R) retardado y suavizado hacia parlantes laterales traseros
      const sideL = this.keep(new GainNode(ctx, { gain: 0.5 })), sideR = this.keep(new GainNode(ctx, { gain: -0.5 }));
      const diffL = this.keep(new GainNode(ctx, { gain: 0.5 })), diffR = this.keep(new GainNode(ctx, { gain: -0.5 }));
      split.connect(sideL, 0); split.connect(sideR, 1);
      const side = this.keep(new GainNode(ctx, { gain: 0.55 }));
      sideL.connect(side); sideR.connect(side);
      split.connect(diffL, 1); split.connect(diffR, 0);
      const side2 = this.keep(new GainNode(ctx, { gain: 0.55 }));
      diffL.connect(side2); diffR.connect(side2);
      const d1 = this.keep(new DelayNode(ctx, { delayTime: 0.011 })), d2 = this.keep(new DelayNode(ctx, { delayTime: 0.017 }));
      const lp1 = this.keep(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 6500 }));
      const lp2 = this.keep(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 6500 }));
      side.connect(d1).connect(lp1).connect(this.keep(placePanner(ctx, -110, 0))).connect(sum);
      side2.connect(d2).connect(lp2).connect(this.keep(placePanner(ctx, 110, 0))).connect(sum);
    }

    // alturas + sala: le da "aire" y saca el sonido de adentro de la cabeza
    this.impulse ??= roomImpulse(ctx);
    const mid = this.keep(new GainNode(ctx, { gain: 0.5 }));
    split.connect(mid, 0); split.connect(mid, 1);
    const verb = this.keep(new ConvolverNode(ctx, { buffer: this.impulse, disableNormalization: false }));
    const verbGain = this.keep(new GainNode(ctx, { gain: 0.16 }));
    const hpf = this.keep(new BiquadFilterNode(ctx, { type: 'highpass', frequency: 220 }));
    mid.connect(hpf).connect(verb).connect(verbGain);
    const hl = this.keep(placePanner(ctx, -45, 35)), hr = this.keep(placePanner(ctx, 45, 35));
    verbGain.connect(hl).connect(sum);
    verbGain.connect(hr).connect(sum);

    sum.connect(this.output);
  }
}

// Crossfeed para auriculares (inspirado en Bauer bs2b): mezcla una parte filtrada y retardada de cada
// canal en el oído opuesto, como pasa con parlantes. Reduce la fatiga en mezclas muy abiertas.
export class Crossfeed {
  constructor(ctx) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.on = false;
    this.nodes = [];
    this.input.connect(this.output);
  }

  set(on) {
    if (on === this.on) return;
    this.on = on;
    try { this.input.disconnect(); } catch { /* ya desconectado */ }
    for (const n of this.nodes) { try { n.disconnect(); } catch { /* idem */ } }
    this.nodes = [];
    if (!on) { this.input.connect(this.output); return; }
    const { ctx } = this;
    const k = (...n) => { this.nodes.push(...n); return n[0]; };
    const split = k(ctx.createChannelSplitter(2));
    const merge = k(ctx.createChannelMerger(2));
    this.input.connect(split);
    for (const [from, to] of [[0, 0], [1, 1]]) {
      const direct = k(new GainNode(ctx, { gain: 0.86 }));
      split.connect(direct, from);
      direct.connect(merge, 0, to);
    }
    for (const [from, to] of [[0, 1], [1, 0]]) {
      const lp = k(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 700, Q: 0.5 }));
      const d = k(new DelayNode(ctx, { delayTime: 0.00028 }));
      const g = k(new GainNode(ctx, { gain: 0.32 }));
      split.connect(lp, from);
      lp.connect(d).connect(g).connect(merge, 0, to);
    }
    merge.connect(this.output);
  }
}
