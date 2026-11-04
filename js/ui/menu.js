// Menú contextual de vidrio. items: [{ label, icon, run, danger, sub: [...] } | '-']
import { icon } from './icons.js';
import { esc } from './format.js';

let current = null;

export function closeMenu() {
  if (!current) return;
  const el = current;
  current = null;
  el.classList.remove('open');
  if (el.__opener?.isConnected && el.contains(document.activeElement)) el.__opener.focus({ preventScroll: true });
  setTimeout(() => el.remove(), 180);
}

function build(items) {
  const el = document.createElement('div');
  el.className = 'menu glass';
  el.setAttribute('role', 'menu');
  items.forEach((it) => {
    if (it === '-') { el.insertAdjacentHTML('beforeend', '<div class="menu-sep"></div>'); return; }
    const b = document.createElement('button');
    b.className = `menu-item lit ${it.danger ? 'danger' : ''} ${it.sub ? 'has-sub' : ''}`;
    b.setAttribute('role', 'menuitem');
    b.innerHTML = `${it.icon ? icon(it.icon) : '<span class="ico"></span>'}<span>${esc(it.label)}</span>${it.sub ? icon('chevronLeft', 'sub-arrow') : ''}`;
    if (it.sub) {
      const sub = build(it.sub);
      sub.classList.add('submenu');
      b.appendChild(sub);
      b.addEventListener('click', (e) => { e.stopPropagation(); b.classList.toggle('sub-open'); });
    } else {
      b.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); it.run?.(); });
    }
    el.appendChild(b);
  });
  return el;
}

export function openMenu(x, y, items) {
  closeMenu();
  const el = build(items);
  document.body.appendChild(el);
  const r = el.getBoundingClientRect();
  const left = Math.min(x, innerWidth - r.width - 12);
  const top = Math.min(y, innerHeight - r.height - 12);
  el.style.left = `${Math.max(12, left)}px`;
  el.style.top = `${Math.max(12, top)}px`;
  if (left + r.width * 2 > innerWidth) el.classList.add('flip');
  current = el;
  el.__opener = document.activeElement;
  // teclado: flechas para moverse, → abre submenú, ← vuelve
  el.addEventListener('keydown', (e) => {
    const items = [...(e.target.closest('.submenu') || el).querySelectorAll(':scope > .menu-item')];
    const i = items.indexOf(e.target.closest('.menu-item'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (e.key === 'ArrowRight' && e.target.classList.contains('has-sub')) {
      e.preventDefault();
      e.target.classList.add('sub-open');
      e.target.querySelector('.submenu .menu-item')?.focus();
    } else if (e.key === 'ArrowLeft' && e.target.closest('.submenu')) {
      e.preventDefault();
      const parent = e.target.closest('.has-sub');
      parent.classList.remove('sub-open');
      parent.focus();
    }
  });
  requestAnimationFrame(() => { el.classList.add('open'); el.querySelector('.menu-item')?.focus({ preventScroll: true }); });
}

addEventListener('pointerdown', (e) => { if (current && !current.contains(e.target)) closeMenu(); }, true);
addEventListener('keydown', (e) => { if (e.key === 'Escape' && current) { e.stopPropagation(); closeMenu(); } }, true);
addEventListener('resize', closeMenu);
addEventListener('wheel', (e) => { if (current && !current.contains(e.target)) closeMenu(); }, { passive: true });
