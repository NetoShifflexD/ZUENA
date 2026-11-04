// Cola de reproducción: orden, aleatorio, repetición. Mantiene al motor siempre con la
// siguiente pista precargada para que la transición sea gapless.
export class Player extends EventTarget {
  constructor(engine) {
    super();
    this.engine = engine;
    this.queue = [];
    this.order = [];
    this.pos = -1;
    this.shuffle = false;
    this.repeat = 'off'; // off | all | one
    this.resumeAt = 0;   // posición a retomar tras reabrir la app

    engine.addEventListener('trackchange', (e) => {
      if (e.detail.auto) this.pos = this.nextPos();
      this.syncNext();
      this.emit('change');
    });
    engine.addEventListener('ended', () => this.emit('change'));
    engine.addEventListener('error', (e) => this.onError(e.detail.track));
  }

  emit(type) { this.dispatchEvent(new Event(type)); }

  get current() {
    return this.pos >= 0 ? this.queue[this.order[this.pos]] ?? null : null;
  }

  playList(tracks, index = 0) {
    const list = tracks.filter(Boolean);
    if (!list.length) return;
    index = Number.isInteger(index) ? Math.max(0, Math.min(index, list.length - 1)) : 0;
    this.queue = list.slice();
    this.buildOrder(Math.min(index, list.length - 1));
    this.pos = this.shuffle ? 0 : Math.min(index, list.length - 1);
    this.resumeAt = 0;
    this.start();
  }

  playAt(pos) {
    if (!Number.isInteger(pos) || pos < 0 || pos >= this.order.length) return;
    this.pos = pos;
    this.resumeAt = 0;
    this.start();
  }

  start() {
    let pending;
    const t = this.current;
    if (t) {
      const at = this.resumeAt;
      this.resumeAt = 0;
      this.dispatchEvent(new CustomEvent('playrequest', { detail: { track: t } }));
      pending = this.engine.play(t, at);
      if (pending?.catch) pending.catch((error) => {
        this.dispatchEvent(new CustomEvent('error', { detail: { track: t, error } }));
        this.emit('change');
      });
    }
    this.emit('change');
    return pending;
  }

  buildOrder(first) {
    const idx = this.queue.map((_, i) => i);
    if (this.shuffle) {
      for (let i = idx.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [idx[i], idx[j]] = [idx[j], idx[i]];
      }
      const k = idx.indexOf(first);
      if (k > 0) { idx.splice(k, 1); idx.unshift(first); }
    }
    this.order = idx;
  }

  // siguiente posición reproducible (saltea pistas que no se pudieron decodificar)
  nextPos(from = this.pos, manual = false) {
    if (this.repeat === 'one' && !manual) return from;
    const n = this.order.length;
    for (let step = 1; step <= n; step++) {
      let p = from + step;
      if (p >= n) {
        if (this.repeat === 'off') return -1;
        p %= n;
      }
      if (!this.queue[this.order[p]]?.unplayable) return p;
    }
    return -1;
  }

  syncNext() {
    const np = this.nextPos();
    this.engine.setNext(np >= 0 ? this.queue[this.order[np]] : null);
  }

  onError(track) {
    if (!track) return;
    // Un fallo de red o permisos no invalida el catálogo ni decide otra escucha.
    // El motor conserva la pista para que PlaybackSession permita reintentar.
    if (track !== this.current && track.id !== this.current?.id) {
      const next = this.nextPos();
      // El relevo natural pudo fallar antes de trackchange: retener esa selección fallida.
      // Un error de precarga no coincide con la voz actual y no mueve la cola.
      if (this.engine.current?.id !== track.id || next < 0 || this.queue[this.order[next]]?.id !== track.id) return;
      this.pos = next;
      this.syncNext();
    }
    this.emit('change');
  }

  toggle() {
    if (!this.current) return;
    if (!this.engine.current || this.engine.current.id !== this.current.id) return this.start();
    return this.engine.toggle();
  }

  play() {
    if (!this.current || this.engine.playing) return;
    if (!this.engine.current || this.engine.current.id !== this.current.id) return this.start();
    return this.engine.resume();
  }

  pause() { this.engine.pause(); }

  seek(time) {
    if (!Number.isFinite(time)) return;
    if (this.engine.current?.id === this.current?.id) this.engine.seek(time);
    else if (this.current) { this.resumeAt = Math.max(0, time); this.emit('change'); }
  }

  next() {
    if (!this.order.length) return;
    let np = this.nextPos(this.pos, true);
    if (np < 0 && this.repeat === 'off') return;
    if (np < 0) np = 0;
    this.playAt(np);
  }

  prev() {
    const pos = this.engine.current ? this.engine.position : this.resumeAt;
    if (pos > 3 || this.pos <= 0) {
      this.seek(0);
      return;
    }
    this.playAt(this.pos - 1);
  }

  setShuffle(on) {
    const cur = this.order[this.pos];
    this.shuffle = on;
    if (this.queue.length) {
      this.buildOrder(cur ?? 0);
      this.pos = on ? 0 : cur ?? 0;
      this.syncNext();
    }
    this.emit('change');
  }

  cycleRepeat() {
    this.repeat = { off: 'all', all: 'one', one: 'off' }[this.repeat];
    this.syncNext();
    this.emit('change');
  }

  playNext(track) {
    if (!this.queue.length) { this.playList([track], 0); return; }
    this.queue.push(track);
    this.order.splice(this.pos + 1, 0, this.queue.length - 1);
    this.syncNext();
    this.emit('change');
  }

  addToQueue(track) {
    if (!this.queue.length) { this.playList([track], 0); return; }
    this.queue.push(track);
    this.order.push(this.queue.length - 1);
    this.syncNext();
    this.emit('change');
  }

  // quita pistas borradas de la biblioteca sin cortar lo que suena (salvo que sea esa)
  removeTracks(ids) {
    if (!this.queue.length) return;
    const gone = new Set(ids);
    const cur = this.current;
    const wasCurrentGone = cur && gone.has(cur.id);
    const keepIdx = [];
    const remap = new Map();
    this.queue.forEach((t, i) => { if (!gone.has(t.id)) { remap.set(i, keepIdx.length); keepIdx.push(t); } });
    const oldOrder = this.order;
    this.queue = keepIdx;
    this.order = oldOrder.filter((i) => remap.has(i)).map((i) => remap.get(i));
    if (!this.queue.length) {
      this.pos = -1;
      this.engine.stop();
    } else if (wasCurrentGone) {
      const nextOld = oldOrder.slice(this.pos + 1).find((i) => remap.has(i));
      this.pos = nextOld != null ? this.order.indexOf(remap.get(nextOld)) : -1;
      if (this.pos >= 0) this.start(); else this.engine.stop();
    } else {
      this.pos = this.order.indexOf(remap.get(oldOrder[this.pos]));
      this.syncNext();
    }
    this.emit('change');
  }

  clear() {
    this.engine.stop();
    this.queue = [];
    this.order = [];
    this.pos = -1;
    this.resumeAt = 0;
    this.emit('change');
  }

  upcoming(limit = 80) {
    const out = [];
    for (let p = this.pos + 1; p < this.order.length && out.length < limit; p++) out.push({ pos: p, track: this.queue[this.order[p]] });
    return out;
  }

  snapshot() {
    return {
      ids: this.queue.map((t) => t.id),
      order: this.order,
      pos: this.pos,
      at: this.engine.current ? this.engine.position : this.resumeAt,
    };
  }

  restore(snap, byId) {
    if (!snap?.ids?.length) return false;
    const queue = snap.ids.map((id) => byId.get(id));
    if (queue.some((t) => !t || t.hidden)) return false;
    this.queue = queue;
    const validOrder = Array.isArray(snap.order) && snap.order.length === queue.length &&
      new Set(snap.order).size === queue.length && snap.order.every((i) => Number.isInteger(i) && i >= 0 && i < queue.length);
    this.order = validOrder ? [...snap.order] : queue.map((_, i) => i);
    this.pos = Number.isInteger(snap.pos) ? Math.min(Math.max(0, snap.pos), queue.length - 1) : 0;
    this.resumeAt = Number.isFinite(snap.at) ? Math.max(0, snap.at) : 0;
    this.emit('change');
    return true;
  }
}
