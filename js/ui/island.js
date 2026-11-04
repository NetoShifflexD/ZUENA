// Isla dinámica · actividades en vivo (2026-11-02). La esencia de ZUENA: la isla de navegación se estira
// con un resorte del motor para mostrar lo que pasa (qué empezó a sonar, una publicación nueva de alguien que
// seguís, el progreso de una importación) y vuelve a su forma al terminar. Documentación: bóveda, carpeta Isla/.
//   const live = createIslandLive({ motion, onAction });  live.attach(islandEl)   (después de cada render de la isla)
//   live.show({ id, kind, art, icon, cap, title, sub, ms, action, progress, sticky })   live.update(id, {...})   live.end(id)
// · Una actividad a la vez. Las transitorias (ms) tienen prioridad; las persistentes (sticky) vuelven cuando no hay otra.
// · La misma id reemplaza a la anterior (p. ej. dos cambios de canción seguidos no hacen cola).
// · Con movimiento reducido el cambio es instantáneo. Nunca tapa el menú: si la isla está abierta, espera.
import { esc } from './format.js';
import { icon } from './icons.js';

export const ISLAND_LIVE_VERSION = '1.0.0';
const RING = 2 * Math.PI * 15;

export function createIslandLive({ motion, onAction } = {}) {
  let island = null, el = null, current = null, timer = 0, coreW = 0;
  const queue = [];   // transitorias en espera
  const sticky = new Map(); // persistentes por id

  const ensure = () => {
    if (!island) return null;
    if (el?.isConnected && island.contains(el)) return el;
    el = document.createElement('button');
    el.className = 'island-live lit';
    el.type = 'button';
    el.hidden = true;
    el.setAttribute('aria-live', 'polite');
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const act = current;
      if (act?.action) onAction?.(act.action, act);
      if (act && !act.sticky) finish();
    });
    island.querySelector('.island-core')?.after(el);
    return el;
  };

  const html = (a) => {
    const lead = a.art ? `<span class="il-art">${a.art}</span>` : `<span class="il-ico">${icon(a.icon || 'sparkle')}</span>`;
    const tail = a.progress != null
      ? `<span class="il-ring" aria-hidden="true"><svg viewBox="0 0 34 34"><circle cx="17" cy="17" r="15" class="bg"/><circle cx="17" cy="17" r="15" class="fg" style="stroke-dasharray:${RING};stroke-dashoffset:${RING * (1 - Math.min(1, Math.max(0, a.progress)))}"/></svg></span>`
      : a.kind === 'track' ? '<span class="il-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span>' : '';
    return `${lead}<span class="il-text">${a.cap ? `<small>${esc(a.cap)}</small>` : ''}<b>${esc(a.title || '')}</b>${a.sub ? `<span>${esc(a.sub)}</span>` : ''}</span>${tail}`;
  };

  // muestra `a` con el resorte de la interfaz: la isla pasa del ancho del botón al de la actividad
  const present = (a) => {
    const node = ensure();
    if (!node) return;
    clearTimeout(timer);
    const core = island.querySelector('.island-core');
    if (!current && core?.offsetWidth) coreW = core.offsetWidth;
    const from = (current ? node : core)?.getBoundingClientRect().width || 0;
    current = a;
    node.innerHTML = html(a);
    node.dataset.kind = a.kind || '';
    node.setAttribute('aria-label', [a.cap, a.title, a.sub].filter(Boolean).join(', '));
    node.hidden = false;
    island.classList.add('live');
    const to = node.getBoundingClientRect().width;
    if (from && Math.abs(from - to) > 1) motion?.animate(node, [{ width: `${from}px` }, { width: `${to}px` }], { spring: 'ui', commit: false });
    motion?.play('fadeIn', node.querySelectorAll('.il-text, .il-art, .il-ico, .il-ring, .il-bars'));
    if (a.ms) timer = setTimeout(finish, a.ms);
  };

  const hide = async () => {
    const node = el;
    current = null;
    if (!node || node.hidden) { island?.classList.remove('live'); return; }
    // se encoge hasta el ancho que tenía el botón y recién ahí el botón vuelve a su lugar
    const from = node.getBoundingClientRect().width;
    motion?.animate(node.children, [{ opacity: 1 }, { opacity: 0 }], { spring: 'snappy' });
    if (coreW) await motion?.animate(node, [{ width: `${from}px` }, { width: `${coreW}px` }], { spring: 'ui', commit: false });
    if (current) return; // llegó otra actividad mientras se cerraba
    node.hidden = true;
    island.classList.remove('live');
  };

  // siguiente actividad: primero las transitorias en cola, después la persistente más reciente
  const next = () => {
    if (island?.classList.contains('open')) { timer = setTimeout(next, 600); return; }
    const a = queue.shift() || [...sticky.values()].at(-1);
    if (a) present(a); else hide();
  };
  const finish = () => { clearTimeout(timer); current = null; next(); };

  return {
    version: ISLAND_LIVE_VERSION,
    attach(root) {
      island = root;
      el = null;
      if (current) { const a = current; current = null; present(a); }
    },
    show(a) {
      if (a.sticky) sticky.set(a.id, a);
      const i = queue.findIndex((q) => q.id === a.id);
      if (i >= 0) queue.splice(i, 1);
      if (!current || current.id === a.id || (current.sticky && !a.sticky)) {
        if (island?.classList.contains('open')) { if (!a.sticky) queue.unshift(a); return; }
        present(a);
      } else if (!a.sticky) queue.push(a);
    },
    update(id, patch) {
      const a = sticky.get(id) || (current?.id === id ? current : null);
      if (!a) return;
      Object.assign(a, patch);
      if (current?.id === id && el) {
        const fg = el.querySelector('.il-ring .fg');
        if (fg && patch.progress != null && Object.keys(patch).length === 1) fg.style.strokeDashoffset = RING * (1 - Math.min(1, patch.progress));
        else el.innerHTML = html(a);
      }
    },
    end(id) {
      sticky.delete(id);
      const i = queue.findIndex((q) => q.id === id);
      if (i >= 0) queue.splice(i, 1);
      if (current?.id === id) finish();
    },
    get current() { return current; },
  };
}
