// Estado y comandos compartidos por las superficies. El audio pertenece a un único motor.
export class PlaybackSession extends EventTarget {
  constructor(player, engine) {
    super();
    this.player = player;
    this.engine = engine;
    this.mode = 'compact';
    this.inlineMode = 'compact';
    this.buffering = false;
    this._track = player.current;
    this.status = this._track ? (engine.playing && this._matches(engine.current, this._track) ? 'playing' : 'paused') : 'idle';
    this._userPaused = false;
    this._revision = 0;
    this._retry = null;
    this._awaitTrackChange = false;
    this.listeners = new AbortController();
    const signal = this.listeners.signal;
    const changed = () => this.dispatchEvent(new Event('change'));
    player.addEventListener('change', () => { this._syncTrack(); changed(); }, { signal });
    player.addEventListener('playrequest', () => {
      this._syncTrack();
      this._revision++;
      this._retry = null;
      this._userPaused = false;
      this._awaitTrackChange = true;
      this._setStatus('loading');
      changed();
    }, { signal });
    player.addEventListener('error', (e) => {
      if (this._userPaused || !this._matches(e.detail?.track, player.current)) return;
      this._setStatus('error');
      changed();
    }, { signal });
    for (const type of ['loading', 'buffering', 'state', 'interrupted', 'blocked', 'error', 'ended', 'trackchange']) {
      engine.addEventListener(type, (e) => {
        this._syncTrack();
        const detail = e.detail || {};
        if (!this._track || (detail.track && !this._matches(detail.track, this._track))) return;
        // Los eventos sin pista sólo describen la voz actual; una voz anterior no manda sobre la cola.
        if (!detail.track && engine.current && !this._matches(engine.current, this._track)) return;
        if (this._userPaused) {
          if ((type === 'state' && detail.playing) || (type === 'trackchange' && engine.playing)) this.player.pause();
          return;
        }
        const terminal = ['blocked', 'interrupted', 'error', 'ended'].includes(this.status);
        switch (type) {
          case 'loading':
            this._awaitTrackChange = true;
            this._setStatus('loading');
            break;
          case 'state':
            if (detail.playing) {
              if (['blocked', 'error', 'ended'].includes(this.status)) break;
              this._setStatus(this.status === 'loading' && this._awaitTrackChange ? 'loading' : 'playing');
            } else if (!terminal) this._setStatus('paused');
            break;
          case 'buffering':
            if (terminal || this._userPaused) break;
            if (detail.on && engine.playing && this.status !== 'loading') this._setStatus('buffering');
            else if (this.status === 'buffering') this._setStatus(engine.playing ? 'playing' : 'paused');
            break;
          case 'trackchange':
            this._awaitTrackChange = false;
            if (!terminal) this._setStatus(engine.playing && !this._userPaused ? 'playing' : 'paused');
            break;
          default:
            this._setStatus(type);
        }
        changed();
      }, { signal });
    }
  }

  _matches(a, b) { return !!a && !!b && (a === b || (a.id != null && b.id != null && a.id === b.id)); }

  _setStatus(status) {
    this.status = status;
    this.buffering = status === 'loading' || status === 'buffering';
  }

  _syncTrack() {
    const track = this.player.current;
    if (this._matches(track, this._track) || (!track && !this._track)) return;
    this._track = track;
    this._revision++;
    this._retry = null;
    this._awaitTrackChange = false;
    this._userPaused = false;
    this._setStatus(!track ? 'idle' : this._matches(this.engine.current, track) && this.engine.playing ? 'playing' : 'paused');
  }

  setMode(mode) {
    if (!['compact', 'expanded', 'fullscreen', 'external'].includes(mode) || mode === this.mode) return;
    this.mode = mode;
    if (mode === 'compact' || mode === 'expanded') this.inlineMode = mode;
    this.dispatchEvent(new Event('change'));
  }

  snapshot() {
    this._syncTrack();
    const track = this.player.current;
    const matches = this._matches(this.engine.current, track);
    const duration = matches ? this.engine.duration || track?.duration || 0 : track?.duration || 0;
    const messages = {
      idle: 'Elegí algo para escuchar', loading: 'Preparando audio…',
      playing: track?.live ? 'En vivo' : 'Reproduciendo', paused: 'En pausa',
      buffering: 'Cargando audio…', interrupted: 'Reproducción interrumpida. Podés reanudar cuando quieras.',
      blocked: 'Tocá Reproducir para continuar.',
      error: 'No se pudo reproducir esta pista.', ended: 'Reproducción finalizada',
    };
    const nextPos = track ? this.player.nextPos() : -1;
    return {
      track, mode: this.mode, playing: ['playing', 'buffering'].includes(this.status),
      buffering: this.buffering, live: !!track?.live,
      position: matches ? this.engine.position : this.player.resumeAt || 0,
      duration,
      volume: this.engine.settings.volume, muted: !!this.engine.settings.muted,
      status: this.status, message: messages[this.status],
      canRetry: !!track && ['interrupted', 'blocked', 'error'].includes(this.status),
      nextTrack: nextPos >= 0 ? this.player.queue[this.player.order[nextPos]] ?? null : null,
      canSeek: !!track && !track.live && Number.isFinite(duration) && duration > 0,
    };
  }

  dispatch(command, value) {
    this._syncTrack();
    if (['retry', 'play'].includes(command) && this._retry) return this._retry.promise;
    if (command === 'retry' || command === 'play') {
      // Registrar la promesa antes de emitir change: un consumidor puede reintentar desde su listener.
      const { promise, resolve } = Promise.withResolvers();
      const attempt = { promise };
      this._retry = attempt;
      this._runCommand(command, value).then((result) => {
        if (this._retry === attempt) this._retry = null;
        resolve(result);
      });
      return promise;
    }
    return this._runCommand(command, value);
  }

  async _runCommand(command, value) {
    const track = this.player.current;
    const revision = this._revision;
    try { return await this._dispatch(command, value); }
    catch (error) {
      if (revision === this._revision && !this._userPaused && this._matches(track, this.player.current)) {
        this._syncTrack();
        this._setStatus('error');
        this.dispatchEvent(new Event('change'));
      }
      this.dispatchEvent(new CustomEvent('error', { detail: { command, error } }));
    }
  }

  // Media Session completa (controles del sistema, pantalla bloqueada, auriculares, PiP): acciones, estado y
  // posición. La posición se publica en cada cambio (play, pausa, búsqueda, pista) y no por fotograma: el
  // sistema la extrapola. En vivo o sin duración se quitan la barra y las acciones de búsqueda.
  attachMediaSession(ms = globalThis.navigator?.mediaSession) {
    if (!ms || this._media) return;
    this._media = ms;
    const signal = this.listeners.signal;
    const pos = () => this.snapshot().position;
    const actions = {
      play: () => this.dispatch('play'),
      pause: () => this.dispatch('pause'),
      stop: () => this.dispatch('stop'),
      previoustrack: () => this.dispatch('prev'),
      nexttrack: () => this.dispatch('next'),
      seekto: (d) => this.dispatch('seek', d?.seekTime),
      seekbackward: (d) => this.dispatch('seek', pos() - (d?.seekOffset || 10)),
      seekforward: (d) => this.dispatch('seek', pos() + (d?.seekOffset || 10)),
    };
    const handle = (name, fn) => { try { ms.setActionHandler(name, fn); } catch { /* acción no soportada */ } };
    for (const [name, fn] of Object.entries(actions)) handle(name, fn);
    this._mediaActions = Object.keys(actions);
    let seekable = true, last = '';
    const sync = () => {
      const s = this.snapshot();
      const state = s.status === 'idle' ? 'none' : ['playing', 'buffering'].includes(s.status) ? 'playing' : 'paused';
      try { if (ms.playbackState !== state) ms.playbackState = state; } catch { /* opcional */ }
      const canSeek = s.canSeek;
      if (canSeek !== seekable) {
        seekable = canSeek;
        for (const name of ['seekto', 'seekbackward', 'seekforward']) handle(name, canSeek ? actions[name] : null);
      }
      if (typeof ms.setPositionState !== 'function') return;
      const position = canSeek && Number.isFinite(s.position) ? Math.max(0, Math.min(s.position, s.duration)) : 0;
      const key = canSeek ? `${s.duration.toFixed(2)}|${position.toFixed(1)}|${state}` : 'none';
      if (key === last) return;
      last = key;
      try {
        if (canSeek) ms.setPositionState({ duration: s.duration, position, playbackRate: 1 });
        else ms.setPositionState();
      } catch { /* valores rechazados por el sistema */ }
    };
    for (const type of ['state', 'seek', 'trackchange', 'ended', 'buffering']) this.engine.addEventListener(type, sync, { signal });
    this.player.addEventListener('change', sync, { signal });
    this.addEventListener('change', sync, { signal });
    sync();
  }

  _dispatch(command, value) {
    // "detener" desde el sistema pausa sin vaciar la cola (se puede retomar)
    if (command === 'pause' || command === 'stop' || (command === 'toggle' && ['playing', 'buffering', 'loading'].includes(this.status))) {
      this._syncTrack();
      this._revision++;
      this._retry = null;
      this._userPaused = true;
      this._setStatus(this.player.current ? 'paused' : 'idle');
      this.dispatchEvent(new Event('change'));
      return this.player.pause();
    }
    if (!this.player.current) return;
    switch (command) {
      case 'retry': {
        const { track, live, position, duration } = this.snapshot();
        const at = live || !Number.isFinite(position) ? 0 : Math.max(0, Number.isFinite(duration) && duration > 0 ? Math.min(position, Math.max(0, duration - 0.2)) : position);
        this._userPaused = false;
        this._setStatus('loading');
        this.dispatchEvent(new Event('change'));
        return this.engine.play(track, at);
      }
      case 'play':
      case 'toggle': {
        if (this.status === 'playing') return;
        if (command === 'play' && this.status === 'loading') return;
        const ended = this.status === 'ended';
        this._userPaused = false;
        this._awaitTrackChange = ended || !this._matches(this.engine.current, this.player.current);
        this._setStatus('loading');
        this.dispatchEvent(new Event('change'));
        if (ended) return this.engine.play(this.player.current, 0);
        // Un contexto interrumpido puede conservar engine.playing=true: Player.play no lo reanuda.
        if (this._matches(this.engine.current, this.player.current)) {
          const revision = this._revision;
          return Promise.resolve(this.engine.resume()).then(() => {
            if (revision === this._revision && !this._userPaused && this.status === 'loading' && !this._awaitTrackChange && this.engine.playing) {
              this._setStatus('playing');
              this.dispatchEvent(new Event('change'));
            }
          });
        }
        return this.player.play();
      }
      case 'next': return this.player.next();
      case 'prev': return this.player.prev();
      case 'seek': {
        const { canSeek, duration } = this.snapshot();
        if (canSeek && Number.isFinite(value)) return this.player.seek(Math.min(duration, Math.max(0, value)));
        return;
      }
      case 'volume':
        if (Number.isFinite(value)) this.engine.setSettings({ volume: Math.max(0, Math.min(1, value)), muted: false });
        return;
    }
  }

  destroy() {
    this._revision++;
    this._retry = null;
    this.listeners.abort();
    for (const name of this._mediaActions || []) { try { this._media.setActionHandler(name, null); } catch { /* idem */ } }
    this._media = null;
  }
}
