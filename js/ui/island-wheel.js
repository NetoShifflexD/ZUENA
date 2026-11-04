// Navegación por rueda: preselección local, sin cargar vistas ni tocar el audio.
export function wheelPixels(event, pageHeight = 600) {
  const { deltaX = 0, deltaY = 0, deltaMode = 0 } = event;
  if (!Number.isFinite(deltaY) || !Number.isFinite(deltaX) || Math.abs(deltaX) > Math.abs(deltaY)) return 0;
  return deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? pageHeight : 1);
}

export function createWheelStepper() {
  let sum = 0, last = -Infinity, lockedUntil = -Infinity;
  return {
    reset() { sum = 0; last = lockedUntil = -Infinity; },
    push(delta, now) {
      if (!Number.isFinite(delta) || !Number.isFinite(now) || !delta) return 0;
      if (now - last > 180 || Math.sign(delta) !== Math.sign(sum)) sum = 0;
      last = now;
      if (now < lockedUntil) { sum = 0; return 0; }
      sum += delta;
      if (Math.abs(sum) < 45) return 0;
      const direction = Math.sign(sum);
      sum = 0;
      lockedUntil = now + 280;
      return direction;
    },
  };
}

export function bindIslandWheel(root, { items, current, canUse, onInteract, onPreview, onReset, onCommit }) {
  const stepper = createWheelStepper();
  const mouse = matchMedia('(any-hover: hover) and (any-pointer: fine)');
  const listeners = new AbortController();
  const options = { signal: listeners.signal };
  let selected = -1;
  const coreOf = (target) => target?.closest?.('[data-island-core]');
  const reset = ({ suspended = false } = {}) => {
    selected = -1;
    stepper.reset();
    const core = root.querySelector('[data-island-core]');
    if (core) { delete core.dataset.wheelPreview; if (!suspended) delete core.dataset.wheelBrowsing; }
    onReset();
  };
  root.addEventListener('wheel', (event) => {
    const core = coreOf(event.target);
    if (!core || !event.target.closest('.island-label') || !mouse.matches || !canUse()
      || root.classList.contains('open') || core.closest('[inert]') || !event.cancelable
      || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const delta = wheelPixels(event, root.ownerDocument.defaultView.innerHeight);
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    core.dataset.wheelBrowsing = 'true';
    onInteract();
    const step = stepper.push(delta, performance.now());
    if (!step || !items.length) return;
    const start = selected < 0 ? Math.max(0, items.findIndex(([id]) => id === current())) : selected;
    selected = (start + step + items.length) % items.length;
    core.dataset.wheelPreview = 'true';
    onPreview(items[selected]);
  }, { ...options, passive: false });
  root.addEventListener('click', (event) => {
    if (selected < 0 || !coreOf(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const item = items[selected];
    reset({ suspended: true });
    if (canUse()) onCommit(item[0]);
    // Confirmar no rearma el hover bajo el cursor: sólo salir y volver a entrar lo hace.
    const core = root.querySelector('[data-island-core]');
    if (core) core.dataset.wheelBrowsing = 'true';
    onInteract();
  }, { ...options, capture: true });
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !coreOf(event.target) || selected < 0) return;
    event.preventDefault();
    event.stopPropagation();
    reset({ suspended: true });
  }, options);
  root.addEventListener('pointerout', (event) => {
    const core = coreOf(event.target);
    if (core && !core.contains(event.relatedTarget)) reset();
  }, options);
  return { reset, destroy() { listeners.abort(); reset(); } };
}
