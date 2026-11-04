/* Geometría visible de la isla; no modifica foco, scroll ni sesión de audio. */
const instances = new WeakMap();

export function createIslandViewport(island) {
  if (!island) return null;
  if (instances.has(island)) return instances.get(island);
  const viewport = window.visualViewport;
  const properties = ['--island-vw', '--island-vh', '--island-cx', '--island-cy'];
  let frame = 0, listening = false, destroyed = false;
  const previous = new Map();

  function update() {
    frame = 0;
    if (destroyed || !island.classList.contains('open')) return;
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    if (!(width > 0 && height > 0)) return;
    const values = [width, height, (viewport?.offsetLeft ?? 0) + width / 2, (viewport?.offsetTop ?? 0) + height / 2];
    values.forEach((value, index) => {
      const next = `${Math.round(value * 100) / 100}px`;
      if (previous.get(properties[index]) === next) return;
      island.style.setProperty(properties[index], next);
      previous.set(properties[index], next);
    });
    island.toggleAttribute('data-island-compact', width <= 600 || height <= 560);
  }

  function schedule() {
    if (!destroyed && !frame) frame = requestAnimationFrame(update);
  }

  function listen(enabled) {
    if (enabled === listening) return;
    listening = enabled;
    const method = enabled ? 'addEventListener' : 'removeEventListener';
    viewport?.[method]('resize', schedule);
    viewport?.[method]('scroll', schedule);
    window[method]('resize', schedule);
    window[method]('pageshow', schedule);
  }

  function clear() {
    cancelAnimationFrame(frame); frame = 0;
    properties.forEach((property) => island.style.removeProperty(property));
    previous.clear();
    island.removeAttribute('data-island-compact');
  }

  function sync() {
    if (destroyed) return;
    const open = island.classList.contains('open');
    listen(open);
    if (open) schedule(); else clear();
  }

  // Observar sólo la raíz estable: renderIsland reemplaza sus hijos.
  const observer = new MutationObserver(sync);
  observer.observe(island, { attributes: true, attributeFilter: ['class'] });
  const api = { sync, destroy() {
    if (destroyed) return;
    destroyed = true;
    observer.disconnect(); listen(false); clear(); instances.delete(island);
  } };
  instances.set(island, api);
  sync();
  return api;
}
