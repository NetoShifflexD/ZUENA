// Test de gustos al crear la cuenta: géneros → momentos → artistas reales → podcasts y radio.
import { app, registerActions } from '../app.js';
import { icon } from '../ui/icons.js';
import { esc, hueOf } from '../ui/format.js';
import { openModal } from '../ui/modal.js';
import { GENRES, MOODS, TOPICS, REGIONS } from '../catalog/genres.js';
import * as src from '../catalog/sources.js';

export function tasteTest({ required = false } = {}) {
  return new Promise((resolve) => {
    const d = app.taste.data;
    const st = {
      step: 0,
      genres: new Set(Object.entries(d.genres).filter(([, v]) => v > 0).map(([g]) => g)),
      moods: new Set(d.moods),
      artists: new Set(Object.keys(d.artists)),
      topics: new Set(d.topics),
      radio: d.radio !== false,
      region: d.region || 'ar',
      pool: null,
    };
    let done = false;
    const STEPS = ['Géneros', 'Momentos', 'Artistas', 'Podcasts y radio'];

    const chip = (set, id, label, extra = '') => `<button type="button" class="chip big lit ${set.has(id) ? 'on' : ''}" data-pick="${id}" ${extra}>${esc(label)}</button>`;

    const stepBody = () => {
      if (st.step === 0) return `<h3>¿Qué música te mueve?</h3><p class="muted">Elegí al menos 3 géneros.</p>
        <div class="genre-grid">${GENRES.map((g) => `<button type="button" class="genre-tile lit ${st.genres.has(g.id) ? 'on' : ''}" data-pick="${g.id}" style="--h:${hueOf(g.id)}"><span>${esc(g.label)}</span>${icon('check', 'genre-check')}</button>`).join('')}</div>`;
      if (st.step === 1) return `<h3>¿Para qué momentos escuchás?</h3><p class="muted">Opcional, ayuda a afinar los mixes.</p>
        <div class="chips">${MOODS.map((m) => chip(st.moods, m.id, m.label)).join('')}</div>
        <label class="field narrow"><span>Tu país</span><select class="select" data-region>${REGIONS.map((r) => `<option value="${r.id}" ${st.region === r.id ? 'selected' : ''}>${r.label}</option>`).join('')}</select></label>`;
      if (st.step === 2) return `<h3>Elegí artistas que te gusten</h3><p class="muted">Artistas reales que suenan ahora en tus géneros. Elegí los que quieras.</p>
        <div class="artist-pick">${st.pool ? st.pool.map((a) => `<button type="button" class="artist-tile lit ${st.artists.has(a.name.toLowerCase()) ? 'on' : ''}" data-pick="${esc(a.name.toLowerCase())}">
          ${a.avatar ? `<img src="${esc(a.avatar)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : `<span class="avatar ph" style="--h:${hueOf(a.name)}"><span>${esc(a.name[0])}</span></span>`}
          <span class="artist-tile-name">${esc(a.name)}${a.verified ? icon('verified', 'tick-ico') : ''}</span><span class="artist-tile-src">${esc(a.src)}</span></button>`).join('') : '<div class="loading-view"><span class="pulse"></span></div>'}</div>`;
      return `<h3>Podcasts y radio</h3><p class="muted">¿Qué temas te interesan?</p>
        <div class="chips">${TOPICS.map((t) => chip(st.topics, t.id, t.label)).join('')}</div>
        <label class="toggle-row lit"><div><div class="toggle-label">Radios en vivo</div><div class="hint">Mostrar radios de tu país en el inicio</div></div>
        <span class="switch"><input type="checkbox" data-radio ${st.radio ? 'checked' : ''}><i></i></span></label>`;
    };

    const body = () => `<div class="taste">
      <header class="taste-head"><div class="taste-steps">${STEPS.map((s, i) => `<span class="${i === st.step ? 'on' : i < st.step ? 'done' : ''}"><i></i>${s}</span>`).join('')}</div>
      ${required ? '' : `<button type="button" class="btn-icon lit sm" data-close>${icon('close')}</button>`}</header>
      <div class="taste-body enter">${stepBody()}</div>
      <footer class="confirm-actions">
        ${st.step ? '<button type="button" class="btn-glass lit" data-back>Atrás</button>' : required ? '<button type="button" class="btn-glass lit" data-skip>Saltear</button>' : ''}
        <button type="button" class="btn-primary lit" data-next ${st.step === 0 && st.genres.size < 3 ? 'disabled' : ''}>${st.step === STEPS.length - 1 ? 'Terminar' : 'Siguiente'}${icon('arrowRight')}</button>
      </footer></div>`;

    async function loadArtists(paint) {
      if (st.pool) return;
      const genres = [...st.genres];
      const [audius, apple] = await Promise.all([
        Promise.all(genres.slice(0, 4).map((g) => src.audiusTrending({ genre: g, limit: 12 }).catch(() => []))),
        src.appleChart(st.region, 25).catch(() => []),
      ]);
      const seen = new Set();
      const pool = [];
      const add = (name, avatar, verified, from) => {
        const k = (name || '').toLowerCase().split(/ feat\.| & |, /)[0].trim();
        if (!k || seen.has(k)) return;
        seen.add(k);
        pool.push({ name: name.split(/ feat\.| & |, /)[0].trim(), avatar, verified, src: from });
      };
      // intercala ranking actual con independientes de los géneros elegidos
      const indie = audius.flatMap((list) => list.slice(0, 6));
      for (let i = 0; i < Math.max(apple.length, indie.length); i++) {
        if (apple[i]) add(apple[i].artist, null, false, 'Ranking actual');
        if (indie[i]) add(indie[i].artist, indie[i].artistAvatar, indie[i].verified, 'Independiente');
      }
      // las fotos de artistas de Apple salen de su carátula más reciente
      for (const a of pool) if (!a.avatar) a.avatar = apple.find((t) => t.artist.toLowerCase().startsWith(a.name.toLowerCase()))?.artwork || null;
      st.pool = pool.slice(0, 30);
      paint();
    }

    openModal(body(), {
      cls: 'taste-modal',
      dismissable: !required,
      onClose: () => resolve(done),
      onMount: (m, close) => {
        const paint = () => { m.innerHTML = body(); bind(); };
        const finish = () => {
          app.taste.setAnswers({
            genres: [...st.genres], moods: [...st.moods], topics: [...st.topics],
            artists: [...st.artists], radio: st.radio, region: st.region,
          });
          done = true;
          close();
          app.toast('Listo. Tu inicio ya está armado con tus gustos');
          app.render();
        };
        const bind = () => {
          m.querySelector('[data-close]')?.addEventListener('click', close);
          m.querySelector('[data-skip]')?.addEventListener('click', () => { app.taste.data.done = true; app.taste.save(); close(); });
          m.querySelector('[data-back]')?.addEventListener('click', () => { st.step--; paint(); });
          m.querySelector('[data-next]').addEventListener('click', () => {
            if (st.step === STEPS.length - 1) { finish(); return; }
            st.step++;
            paint();
            if (st.step === 2) loadArtists(paint);
          });
          m.querySelector('[data-region]')?.addEventListener('change', (e) => { st.region = e.target.value; st.pool = null; });
          m.querySelector('[data-radio]')?.addEventListener('change', (e) => { st.radio = e.target.checked; });
          m.querySelectorAll('[data-pick]').forEach((b) => {
            b.onclick = () => {
              const set = [st.genres, st.moods, st.artists, st.topics][st.step];
              const id = b.dataset.pick;
              if (set.has(id)) set.delete(id); else set.add(id);
              if (st.step === 0) st.pool = null;
              b.classList.toggle('on', set.has(id));
              const next = m.querySelector('[data-next]');
              if (st.step === 0) next.disabled = st.genres.size < 3;
            };
          });
        };
        bind();
      },
    });
  });
}

registerActions({ 'taste-test': () => tasteTest() });
