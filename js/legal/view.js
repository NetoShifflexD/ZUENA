// Apartados legales (2026-11-02): hoja de vidrio con índice de documentos y lectura. Se abre desde la landing,
// el panel de acceso, el aviso de cookies y Ajustes (cualquier botón con data-legal="id").
// Va fuera de #app y por encima de la landing; Escape o el fondo la cierran y el foco vuelve a quien la abrió.
import { icon } from '../ui/icons.js';
import { esc } from '../ui/format.js';
import { motion } from '../motion/index.js';
import { LEGAL_DOCS, LEGAL_UPDATED, CONTACT_AREAS, contactAddress, legalDoc } from './docs.js';
import { cookieSettingsHtml, setCookieChoice, cookieChoiceLabel, hideCookieBanner } from './cookies.js';

let root = null;
let opener = null;

const block = (b) => (Array.isArray(b) ? `<ul>${b.map((li) => `<li>${esc(li)}</li>`).join('')}</ul>` : `<p>${esc(b)}</p>`);

function contactHtml() {
  return `<ul class="lg-contacts">${CONTACT_AREAS.map((a) => `<li class="lg-contact glass-soft">
      <span class="lg-c-ico" aria-hidden="true">${icon('mail')}</span>
      <div><b>${esc(a.name)}</b><p>${esc(a.text)}</p><code>${esc(contactAddress(a.id))}</code></div>
      <span class="lg-pill">Próximamente</span></li>`).join('')}</ul>`;
}

function docHtml(doc) {
  return `<article class="lg-doc" aria-labelledby="lg-title">
      <p class="lg-draft" role="note">${icon('edit')}<span><b>BORRADOR</b> · Pendiente de revisión profesional. No es un texto legal definitivo.</span></p>
      <h2 id="lg-title" tabindex="-1">${esc(doc.title)}</h2>
      <p class="lg-lead">${esc(doc.lead)} <span class="lg-muted">Versión ${LEGAL_UPDATED}.</span></p>
      ${doc.id === 'contacto' ? contactHtml() : ''}
      ${doc.sections.map(([h, blocks]) => `<section><h3>${esc(h)}</h3>${blocks.map(block).join('')}</section>`).join('')}
      ${doc.id === 'cookies' ? cookieSettingsHtml() : ''}
    </article>`;
}

function show(id, { focus = true } = {}) {
  const doc = legalDoc(id) || LEGAL_DOCS[0];
  root.dataset.doc = doc.id;
  root.querySelectorAll('[data-lg-tab]').forEach((b) => {
    const on = b.dataset.lgTab === doc.id;
    b.classList.toggle('on', on);
    b.setAttribute('aria-current', on ? 'page' : 'false');
  });
  const body = root.querySelector('.lg-body');
  body.innerHTML = docHtml(doc);
  body.scrollTop = 0;
  motion.play('fadeUp', body.querySelectorAll('.lg-draft, h2, .lg-lead, .lg-contacts, section, .lg-cookie-cfg'), { stagger: 30 });
  if (focus) body.querySelector('#lg-title')?.focus({ preventScroll: true });
}

export function openLegal(id = 'terminos', { settings = false } = {}) {
  if (root?.isConnected) { show(id); return root; }
  opener = document.activeElement;
  root = document.createElement('div');
  root.className = 'lg-root';
  root.innerHTML = `
    <div class="lg-scrim" data-lg-close></div>
    <div class="lg-sheet glass" role="dialog" aria-modal="true" aria-label="Información legal de ZUENA" data-lenis-prevent>
      <header class="lg-head">
        <div class="lg-brand"><span class="lg-badge">Borrador</span><h1>Legal y privacidad</h1></div>
        <button type="button" class="btn-icon lit lg-x" data-lg-close aria-label="Cerrar">${icon('close')}</button>
      </header>
      <nav class="lg-nav" aria-label="Documentos legales">${LEGAL_DOCS.map((d) => `
        <button type="button" class="lg-tab lit" data-lg-tab="${d.id}">${icon(d.icon)}<span>${esc(d.title)}</span></button>`).join('')}</nav>
      <div class="lg-body"></div>
    </div>`;
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-lg-close]')) { closeLegal(); return; }
    const tab = e.target.closest('[data-lg-tab]');
    if (tab) { show(tab.dataset.lgTab); return; }
    const inner = e.target.closest('[data-legal]');
    if (inner) { e.stopPropagation(); show(inner.dataset.legal); return; }
    const set = e.target.closest('[data-cookie-set]');
    if (set) {
      const rec = setCookieChoice(set.dataset.cookieSet);
      root.querySelectorAll('[data-cookie-set]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cookieSet === rec.choice)));
      root.querySelector('[data-cookie-state]').textContent = `Estado: ${cookieChoiceLabel(rec)}. Guardado.`;
      hideCookieBanner();
    }
  });
  // las teclas no llegan a los atajos de la app; Tab queda dentro de la hoja
  root.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); closeLegal(); return; }
    if (e.key !== 'Tab') return;
    const items = [...root.querySelectorAll('.lg-sheet button:not([disabled]), .lg-sheet [href], .lg-sheet [tabindex="0"]')].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  document.body.append(root);
  document.body.classList.add('legal-open');
  motion.play('fadeIn', root.querySelector('.lg-scrim'));
  motion.play('scaleIn', root.querySelector('.lg-sheet'));
  show(id);
  if (settings) root.querySelector('[data-cookie-cfg]')?.scrollIntoView({ block: 'start' });
  return root;
}

export async function closeLegal() {
  const r = root;
  root = null;
  if (!r?.isConnected) return;
  document.body.classList.remove('legal-open');
  motion.animate(r.querySelector('.lg-scrim'), [{ opacity: 1 }, { opacity: 0 }], { duration: motion.tokens.DUR.base });
  await motion.play('exitDown', r.querySelector('.lg-sheet'));
  r.remove();
  if (opener?.isConnected) opener.focus({ preventScroll: true });
  opener = null;
}

export const legalOpen = () => !!root?.isConnected;
