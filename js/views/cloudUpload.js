// Subir una canción a la nube (Supabase Storage + fila en `tracks`), 2026-11-02.
// Pública = la escucha cualquiera desde el feed; exige declarar los derechos. Privada = sólo la cuenta dueña.
// Nunca se piden datos de pago ni se muestran precios.
import { app, registerActions } from '../app.js';
import { esc } from '../ui/format.js';
import { openModal } from '../ui/modal.js';
import { uploadTrack, myTracks, validateTrack } from '../data/supabase.js';

// pistas propias de la nube (caché para el composer del feed)
export const cloudTracks = { uid: null, list: [], loading: null };

export function loadMyTracks(force = false) {
  const uid = app.posts?.cloudUser;
  if (!uid) { cloudTracks.uid = null; cloudTracks.list = []; return Promise.resolve([]); }
  if (!force && cloudTracks.uid === uid && !cloudTracks.loading) return Promise.resolve(cloudTracks.list);
  cloudTracks.loading ||= myTracks(uid)
    .then((list) => { if (app.posts?.cloudUser === uid) { cloudTracks.uid = uid; cloudTracks.list = list; } return list; })
    .catch((err) => { console.warn('[nube] pistas', err); return []; })
    .finally(() => { cloudTracks.loading = null; });
  return cloudTracks.loading;
}

// duración leída del propio archivo (sin subirlo)
function durationOf(file) {
  return new Promise((resolve) => {
    const a = new Audio();
    const url = URL.createObjectURL(file);
    const done = (v) => { URL.revokeObjectURL(url); resolve(v); };
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? a.duration : 0);
    a.onerror = () => done(0);
    a.src = url;
  });
}

const STEP = { audio: 'Subiendo el audio…', cover: 'Subiendo la portada…', row: 'Guardando…' };

export function openCloudUpload() {
  const uid = app.posts?.cloudUser;
  if (!uid) { app.toast('Para subir música ingresá con tu cuenta de ZUENA en la nube.'); return; }
  const name = app.profile?.displayName || '';
  openModal(`<form class="confirm cloud-upload" novalidate>
      <h3>Subir una canción</h3>
      <label class="field"><span>Archivo de audio</span><input class="input" type="file" name="file" accept="audio/*,.mp3,.m4a,.wav,.flac,.ogg">
        <small class="hint">MP3, AAC, WAV, FLAC u OGG, hasta 50 MB.</small><span class="field-error" data-err="file"></span></label>
      <label class="field"><span>Título</span><input class="input" name="title" maxlength="120" required><span class="field-error" data-err="title"></span></label>
      <label class="field"><span>Artista</span><input class="input" name="artist" maxlength="120" value="${esc(name)}" required><span class="field-error" data-err="artist"></span></label>
      <label class="field"><span>Portada (opcional)</span><input class="input" type="file" name="cover" accept="image/jpeg,image/png,image/webp"><span class="field-error" data-err="cover"></span></label>
      <label class="field"><span>Quién puede escucharla</span><select class="select lit" name="visibility">
        <option value="public">Pública: cualquiera en ZUENA</option><option value="private">Privada: sólo vos</option></select><span class="field-error" data-err="visibility"></span></label>
      <label class="check"><input type="checkbox" name="rights"><span>Declaro que soy titular de los derechos de esta grabación o tengo permiso para publicarla.</span></label>
      <span class="field-error" data-err="rights"></span>
      <label class="check"><input type="checkbox" name="post" checked><span>Publicarla en el feed</span></label>
      <span class="field-error" data-err="form"></span>
      <p class="hint" data-step role="status"></p>
      <div class="confirm-actions"><button type="button" class="btn-glass lit" data-modal="cancel">Cancelar</button><button class="btn-primary lit" data-submit>Subir</button></div>
    </form>`, {
    cls: 'sm',
    onMount: (m, close) => {
      const form = m.querySelector('form');
      const setErr = (field, msg) => { m.querySelectorAll('[data-err]').forEach((x) => { x.textContent = x.dataset.err === field ? msg : ''; }); };
      const sync = () => {
        // sólo se publica en el feed si es pública y la cuenta puede publicar
        const pub = form.visibility.value === 'public';
        form.post.disabled = !pub || !app.posts.canCloudPost(app.profile);
        if (form.post.disabled) form.post.checked = false;
      };
      form.visibility.onchange = sync;
      sync();
      form.file.onchange = () => { const f = form.file.files[0]; if (f && !form.title.value) form.title.value = f.name.replace(/\.[^.]+$/, '').slice(0, 120); };
      m.querySelector('[data-modal=cancel]').onclick = close;
      let busy = false;
      form.onsubmit = async (e) => {
        e.preventDefault();
        if (busy) return;
        const meta = { file: form.file.files[0], cover: form.cover.files[0] || null, title: form.title.value, artistName: form.artist.value, rights: form.rights.checked, visibility: form.visibility.value };
        const bad = validateTrack(meta);
        if (bad) { setErr(bad.field, bad.message); return; }
        busy = true;
        setErr('', '');
        const btn = form.querySelector('[data-submit]');
        btn.disabled = true;
        btn.classList.add('loading');
        const step = m.querySelector('[data-step]');
        try {
          meta.durationS = await durationOf(meta.file);
          const item = await uploadTrack(uid, meta, (s) => { step.textContent = STEP[s] || ''; });
          cloudTracks.list = [item, ...cloudTracks.list];
          if (form.post.checked) await app.posts.create(app.profile, '', { type: 'track', item });
          app.toast(form.post.checked ? 'Canción subida y publicada' : 'Canción subida');
          close();
        } catch (err) {
          setErr(err.field || 'form', err.cloudMessage || err.message || 'No se pudo subir. Probá de nuevo.');
          step.textContent = '';
        } finally {
          busy = false;
          btn.disabled = false;
          btn.classList.remove('loading');
        }
      };
    },
  });
}

registerActions({ 'cloud-upload': () => openCloudUpload() });
