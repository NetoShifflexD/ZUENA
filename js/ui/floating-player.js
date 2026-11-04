// Vista remota: el audio y su estado pertenecen siempre a la ventana principal.
export class FloatingPlayer extends EventTarget {
  constructor({ snapshot, commands = {}, artwork, onError } = {}) {
    super();
    this._snapshot = snapshot;
    this._commands = commands;
    this._artwork = artwork;
    this._onError = onError;
    this._child = null;
    this._pending = null;
    this._dispose = null;
    this._destroyed = false;
    this._generation = 0;
    // si la página queda en la caché de ida y vuelta (persisted) sólo se cierra la ventana: al volver se puede reabrir
    this._parentUnload = (event) => {
      try { if (event?.persisted) this.close(); else this.destroy(); } catch (error) { this._report(error); }
    };
    // pagehide en vez de unload: unload está obsoleto, bloquea la caché de ida y vuelta y Chrome lo deshabilita
    window.addEventListener('pagehide', this._parentUnload);
  }

  get isOpen() {
    return !!this._child && !this._child.closed;
  }

  // No hacer await antes de pedir la ventana: se perdería la activación del usuario.
  open({ normal = false } = {}) {
    if (this._destroyed) return Promise.resolve(null);
    if (this._pending) return this._pending;
    if (this.isOpen) {
      try { this._child.focus(); } catch (error) { this._report(error); }
      return Promise.resolve(this._child);
    }
    if (this._child) this._release();
    const generation = ++this._generation;
    let request;
    let pip = false;
    try {
      const api = window.documentPictureInPicture;
      pip = !normal && typeof api?.requestWindow === 'function';
      request = pip
        ? api.requestWindow({ width: 400, height: 500 })
        : window.open('about:blank', '_blank', 'popup,width=400,height=500');
      if (!request) throw new Error('El navegador bloqueó la ventana del reproductor. Permití las ventanas emergentes para abrirla.');
    } catch (error) {
      this._report(error);
      return Promise.resolve(null);
    }
    let timeout;
    const ready = Promise.resolve(request).then(child => {
      if (child && (this._destroyed || generation !== this._generation)) { child.close(); return null; }
      return child;
    });
    const deadline = new Promise((resolve, reject) => {
      timeout = window.setTimeout(() => reject(new Error('No se pudo abrir PiP. Podés probar con una ventana normal.')), 10000);
      this._cancelPending = () => { window.clearTimeout(timeout); resolve(null); };
    });
    this._pending = Promise.race([ready, deadline]).then(child => {
      if (!child && generation !== this._generation) return null;
      if (!child) throw new Error('No se pudo abrir la ventana del reproductor.');
      if (this._destroyed || generation !== this._generation) {
        child.close();
        return null;
      }
      this._child = child;
      this._mount(child, pip);
      this._change();
      return child;
    }).catch(error => {
      if (generation !== this._generation) return null;
      this.close();
      this._report(error);
      return null;
    }).finally(() => {
      window.clearTimeout(timeout);
      if (generation === this._generation) { this._pending = null; this._cancelPending = null; }
    });
    return this._pending;
  }

  close() {
    ++this._generation;
    this._cancelPending?.();
    this._cancelPending = null;
    this._pending = null;
    const child = this._child;
    this._release();
    try { if (child && !child.closed) child.close(); }
    catch (error) { this._report(error); }
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    window.removeEventListener('pagehide', this._parentUnload);
    this.close();
  }

  _report(error) {
    try {
      // El consumidor puede informar el bloqueo sin abrir otra ventana.
      const result = this._onError?.(error);
      if (result?.catch) result.catch(() => {});
    } catch { /* Un error del informador no debe romper el cierre. */ }
  }

  _change() {
    this.dispatchEvent(new CustomEvent('change', { detail: { isOpen: this.isOpen } }));
  }

  _release() {
    const hadChild = !!this._child;
    this._child = null;
    this._dispose?.();
    this._dispose = null;
    if (hadChild) this._change();
  }

  _mount(child, pip) {
    const doc = child.document;
    doc.documentElement.lang = 'es';
    doc.title = 'ZUENA · Reproductor';
    const style = doc.createElement('style');
    style.textContent = `
      :root{color-scheme:dark;--bg:#101112;--ink:#f1f1ef;--muted:#a6a9ad;--glass:#191b1d;--line:#eef1f424;--accent:#f1f1ef}
      :root[data-scheme="light"]{color-scheme:light;--bg:#f5f5f3;--ink:#181a1c;--muted:#62666a;--glass:#fff;--line:#1a1e2221;--accent:#181a1c}
      *{box-sizing:border-box}body{margin:0;min-width:240px;min-height:100vh;background:var(--bg);color:var(--ink);font:14px/1.4 Inter,system-ui,sans-serif}
      main{width:100%;max-width:520px;margin:auto;padding:12px;display:grid;gap:8px}
      .glass{padding:12px;border:1px solid var(--line);border-radius:24px;background:var(--glass);backdrop-filter:blur(24px);box-shadow:0 14px 44px #00000018;display:grid;gap:8px}
      .track{display:grid;grid-template-columns:80px minmax(0,1fr);gap:12px;align-items:center}
      .heading,.row{display:flex;align-items:center;justify-content:space-between;gap:10px}.brand{letter-spacing:.16em;font-size:12px;font-weight:700}
      .cover{width:80px;aspect-ratio:1;justify-self:center;border-radius:14px;overflow:hidden;background:var(--line);display:grid;place-items:center}
      .cover img{width:100%;height:100%;object-fit:cover}.cover span{font-size:32px}.metadata{text-align:center;min-width:0}h1{font-size:19px;margin:0;overflow-wrap:anywhere}p{margin:4px 0 0;overflow-wrap:anywhere}.muted,.notice{color:var(--muted);font-size:12px}.notice{margin:0}
      button{min-width:44px;min-height:44px;border:1px solid var(--line);border-radius:14px;background:var(--glass);color:inherit;font:inherit;padding:8px 12px;cursor:pointer}
      button:disabled,input:disabled{opacity:.45;cursor:default}button:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:3px}.transport{display:flex;justify-content:center;gap:10px}.toggle{font-weight:550;min-width:112px;background:var(--ink);color:var(--bg);border-radius:999px}
      input[type=range]{width:100%;min-width:0;margin:0;accent-color:var(--accent);min-height:44px}.time{font-variant-numeric:tabular-nums}.volume{display:grid;grid-template-columns:auto minmax(40px,1fr) 38px;gap:10px;align-items:center}.volume output{text-align:right}.status{min-height:17px;text-align:center}
      [hidden]{display:none!important}@media(max-width:320px){.track{grid-template-columns:56px minmax(0,1fr)}.cover{width:56px}.transport{gap:4px}button{padding:8px}.toggle{min-width:90px}}@media(max-height:420px){main{padding:10px;gap:8px}.glass{padding:12px;gap:7px}.track{grid-template-columns:64px minmax(0,1fr)}.cover{width:64px}.metadata h1{font-size:16px}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}
    `;
    doc.head.replaceChildren(style);
    doc.body.innerHTML = `
      <main>
        <div class="heading"><span class="brand">ZUENA</span><button type="button" data-ui="return">Volver a la app</button></div>
        <p class="notice" data-ui="notice"></p>
        <section class="glass" aria-label="Reproductor flotante">
          <div class="track"><div class="cover"><span data-ui="placeholder" aria-hidden="true">♫</span><img data-ui="art" alt="" hidden></div>
          <div class="metadata"><h1 data-ui="title">Sin pista</h1><p data-ui="artist" class="muted"></p><p data-ui="album" class="muted"></p></div></div>
          <div class="status muted" data-ui="status" role="status"></div><button type="button" data-ui="retry" hidden>Reintentar</button>
          <div><input data-ui="seek" type="range" min="0" max="1" step="0.1" value="0" aria-label="Posición de reproducción" disabled><div class="row muted time"><span data-ui="position">0:00</span><span data-ui="duration">0:00</span></div></div>
          <div class="transport"><button type="button" data-ui="prev" aria-label="Pista anterior" disabled>Anterior</button><button type="button" data-ui="toggle" class="toggle" disabled>Reproducir</button><button type="button" data-ui="next" aria-label="Pista siguiente" disabled>Siguiente</button></div>
          <label class="volume"><span>Volumen</span><input data-ui="volume" type="range" min="0" max="1" step="0.01" value="1" disabled><output data-ui="volumeText">100%</output></label>
        </section>
      </main>`;
    const ui = Object.fromEntries([...doc.querySelectorAll('[data-ui]')].map(el => [el.dataset.ui, el]));
    ui.notice.textContent = pip
      ? 'Ventana flotante. La superposición depende del sistema.'
      : 'Ventana normal: no permanece siempre encima de otras ventanas.';
    const removers = [];
    let active = true;
    let artKey;
    let artVersion = 0;
    const dragging = { seek: false, volume: false };
    const set = (el, key, value) => { if (el[key] !== value) el[key] = value; };
    const listen = (target, type, handler) => {
      const safe = event => {
        try { Promise.resolve(handler(event)).catch(error => this._report(error)); }
        catch (error) { this._report(error); }
      };
      target.addEventListener(type, safe);
      removers.push(() => target.removeEventListener(type, safe));
    };
    const command = (name, ...args) => this._commands[name]?.(...args);
    const time = seconds => {
      const value = Math.max(0, Math.floor(Number(seconds) || 0));
      const hours = Math.floor(value / 3600);
      return `${hours ? `${hours}:` : ''}${hours ? String(Math.floor(value / 60) % 60).padStart(2, '0') : Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
    };
    const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    const update = () => {
      try {
        if (!active) return;
        if (child.closed) { this._release(); return; }
        if (doc.hidden) return;
        const s = (typeof this._snapshot === 'function' ? this._snapshot() : this._snapshot) || {};
        const track = s.track;
        const loading = !track || !!s.buffering;
        const duration = Math.max(0, number(s.duration));
        const position = Math.min(duration || Infinity, Math.max(0, number(s.position)));
        const volume = Math.min(1, Math.max(0, number(s.volume, 1)));
        const scheme = s.scheme === 'light' ? 'light' : 'dark';
        if (doc.documentElement.dataset.scheme !== scheme) doc.documentElement.dataset.scheme = scheme;
        set(ui.title, 'textContent', String(track?.title || 'Sin pista'));
        set(ui.artist, 'textContent', String(track?.artist || ''));
        set(ui.album, 'textContent', String(track?.album || ''));
        set(ui.status, 'textContent', s.message || (s.buffering ? 'Cargando…' : !track ? 'Elegí una pista en la app' : s.live ? 'En vivo' : ''));
        set(ui.toggle, 'textContent', s.playing || s.buffering ? 'Pausar' : 'Reproducir');
        set(ui.retry, 'hidden', !s.canRetry || typeof this._commands.retry !== 'function');
        for (const name of ['toggle', 'prev', 'next']) set(ui[name], 'disabled', !track || typeof this._commands[name] !== 'function');
        set(ui.seek, 'disabled', loading || !!s.live || duration <= 0 || typeof this._commands.seek !== 'function');
        set(ui.volume, 'disabled', loading || typeof this._commands.setVolume !== 'function');
        set(ui.return, 'disabled', typeof this._commands.returnToApp !== 'function');
        if (!dragging.seek) {
          set(ui.seek, 'max', String(duration || 1));
          set(ui.seek, 'value', String(position));
          set(ui.position, 'textContent', time(position));
        }
        set(ui.duration, 'textContent', s.live ? 'En vivo' : time(duration));
        if (!dragging.volume) {
          set(ui.volume, 'value', String(s.muted ? 0 : volume));
          set(ui.volumeText, 'textContent', `${Math.round((s.muted ? 0 : volume) * 100)}%`);
        }
        const key = JSON.stringify(track ? [track.id, track.title, track.artist, track.album] : null);
        if (key !== artKey) {
          artKey = key;
          const version = ++artVersion;
          ui.art.hidden = true;
          ui.art.removeAttribute('src');
          ui.placeholder.hidden = false;
          Promise.resolve(track ? this._artwork?.(track) : null).then(url => {
            if (!active || version !== artVersion || !url) return;
            const parsed = new URL(String(url), window.location.href);
            if (!['https:', 'http:', 'blob:', 'data:'].includes(parsed.protocol)) return;
            ui.art.src = parsed.href;
            ui.art.hidden = false;
            ui.placeholder.hidden = true;
          }).catch(error => this._report(error));
        }
      } catch (error) { this._report(error); }
    };
    for (const name of ['toggle', 'prev', 'next']) listen(ui[name], 'click', () => command(name));
    listen(ui.retry, 'click', () => command('retry'));
    listen(ui.return, 'click', () => command('returnToApp'));
    for (const name of ['seek', 'volume']) {
      const slider = ui[name];
      listen(slider, 'pointerdown', () => { dragging[name] = true; });
      listen(slider, 'input', () => {
        dragging[name] = true;
        if (name === 'seek') set(ui.position, 'textContent', time(slider.value));
        else set(ui.volumeText, 'textContent', `${Math.round(Number(slider.value) * 100)}%`);
      });
      listen(slider, 'change', () => {
        dragging[name] = false;
        if (!slider.disabled) return command(name === 'seek' ? 'seek' : 'setVolume', Number(slider.value));
      });
      listen(slider, 'blur', () => { dragging[name] = false; });
      listen(child, 'pointerup', () => { dragging[name] = false; });
      listen(child, 'pointercancel', () => { dragging[name] = false; });
    }
    listen(ui.art, 'error', () => { ui.art.hidden = true; ui.placeholder.hidden = false; });
    listen(child, 'pagehide', () => this._release());
    listen(doc, 'visibilitychange', update);
    const timer = window.setInterval(update, 500);
    this._dispose = () => {
      active = false;
      ++artVersion;
      window.clearInterval(timer);
      for (const remove of removers) remove();
    };
    update();
  }
}
