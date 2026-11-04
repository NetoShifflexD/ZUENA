// Modales de vidrio con entrada/salida animada. Esc o clic afuera cierran (si es descartable).
const stack = [];

export function openModal(html, { cls = '', dismissable = true, onMount, onClose } = {}) {
  const root = document.createElement('div');
  root.className = 'modal-root';
  root.innerHTML = `<div class="modal-scrim"></div><div class="modal glass ${cls}" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(root);
  document.body.classList.add('modal-open');
  const modal = root.querySelector('.modal');
  const opener = document.activeElement; // el foco vuelve acá al cerrar
  let closed = false;
  // nombre accesible del diálogo: su primer título
  const heading = modal.querySelector('h2, h3');
  if (heading) { heading.id ||= `modal-h-${Date.now()}`; modal.setAttribute('aria-labelledby', heading.id); }
  // el foco del teclado no se escapa del diálogo (Tab / Shift+Tab ciclan adentro)
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const items = [...modal.querySelectorAll('button:not([disabled]), [href], input:not([type=hidden]):not([type=file]):not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  const close = () => {
    if (closed) return;
    closed = true;
    stack.splice(stack.indexOf(entry), 1);
    root.classList.remove('open');
    root.classList.add('closing');
    setTimeout(() => {
      root.remove();
      if (!stack.length) document.body.classList.remove('modal-open');
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    }, 320);
    onClose?.();
  };
  const entry = { root, close, dismissable };
  stack.push(entry);

  if (dismissable) root.querySelector('.modal-scrim').addEventListener('click', close);
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('open')));
  onMount?.(modal, close);
  setTimeout(() => modal.querySelector('[autofocus], input:not([type=hidden]):not([type=file]), button')?.focus({ preventScroll: true }), 60);
  return { modal, close };
}

export function closeTopModal() {
  const top = stack[stack.length - 1];
  if (top?.dismissable) { top.close(); return true; }
  return !!top;
}

export function confirmModal({ title, text, ok = 'Aceptar', cancel = 'Cancelar', danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    openModal(`
      <div class="confirm">
        <h3>${title}</h3>
        <p class="muted">${text}</p>
        <div class="confirm-actions">
          <button class="btn-glass lit" data-modal="cancel">${cancel}</button>
          <button class="btn-primary lit ${danger ? 'danger' : ''}" data-modal="ok">${ok}</button>
        </div>
      </div>`, {
      cls: 'sm',
      onMount: (m, close) => {
        m.querySelector('[data-modal=ok]').onclick = () => { result = true; close(); };
        m.querySelector('[data-modal=cancel]').onclick = close;
      },
      onClose: () => resolve(result),
    });
  });
}

export function promptModal({ title, label, value = '', ok = 'Guardar', placeholder = '' }) {
  return new Promise((resolve) => {
    let result = null;
    openModal(`
      <form class="confirm">
        <h3>${title}</h3>
        <label class="field"><span>${label}</span><input class="input" name="v" maxlength="80" placeholder="${placeholder}"></label>
        <div class="confirm-actions">
          <button type="button" class="btn-glass lit" data-modal="cancel">Cancelar</button>
          <button class="btn-primary lit">${ok}</button>
        </div>
      </form>`, {
      cls: 'sm',
      onMount: (m, close) => {
        const input = m.querySelector('input');
        input.value = value;
        m.querySelector('form').onsubmit = (e) => { e.preventDefault(); result = input.value.trim(); close(); };
        m.querySelector('[data-modal=cancel]').onclick = close;
      },
      onClose: () => resolve(result),
    });
  });
}
