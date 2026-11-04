// Dashboard de Administradores: gestión completa de reclamos, lanzamientos, moderación de feed y cuentas.
// Restringido estrictamente a cuentas con permisos de administración (Owner / Admin).

import { app, registerActions } from '../app.js';
import { db } from '../store/db.js';
import { icon } from '../ui/icons.js';
import { esc, fmtTime } from '../ui/format.js';
import { confirmModal, promptModal } from '../ui/modal.js';
import { claimStatus, typeLabel } from '../data/artist.js';
import { statusPill } from './common.js';
import { t } from '../i18n.js';

export function canAccessAdmin(authObj = app.auth) {
  const a = authObj || app.auth;
  return Boolean(a?.isOwner || a?.isAdmin);
}

let activeTab = 'claims'; // 'claims' | 'releases' | 'feed' | 'users'
let userFilter = 'all'; // 'all' | 'listener' | 'artist' | 'admin'
let userSearch = '';

export async function viewAdminDashboard() {
  if (!canAccessAdmin()) {
    queueMicrotask(() => {
      app.toast(t('admin.access_denied', 'Acceso restringido a cuentas de administración.'));
      app.go('home');
    });
    return '';
  }

  const [claims, releases, posts, accounts, profiles] = await Promise.all([
    db.all('claims').catch(() => []),
    db.all('releases').catch(() => []),
    Promise.resolve(app.posts.list || []),
    db.all('accounts').catch(() => []),
    db.all('profiles').catch(() => []),
  ]);

  const profileMap = new Map(profiles.map((p) => [p.uid, p]));

  return `
    <div class="admin-dashboard enter" data-reveal="fadeUp">
      <header class="page-head">
        <div>
          <p class="eyebrow">${icon('shield')} ${t('admin.title', 'Dashboard de Administración')}</p>
          <h1>${t('admin.title', 'Panel de Control de Administración')}</h1>
          <p class="muted">${t('admin.subtitle', 'Gestión de reclamos de artistas, subida de canciones, moderación de feed y usuarios.')}</p>
        </div>
        <div class="row-btns">
          <span class="pill ok">${app.auth.isOwner ? 'Dueño / Propietario' : 'Administrador'}</span>
          <button class="btn-glass lit" data-action="nav" data-view="home">${icon('arrowLeft')}${t('common.back', 'Volver')}</button>
        </div>
      </header>

      <!-- Métricas globales del sistema -->
      <section class="admin-metrics-grid" aria-label="Métricas del sistema">
        <div class="glass-soft stat">
          <b>${accounts.filter((a) => !a.isGuest).length}</b>
          <span>Usuarios registrados</span>
        </div>
        <div class="glass-soft stat">
          <b>${claims.filter((c) => c.status === 'approved').length}</b>
          <span>Artistas verificados</span>
        </div>
        <div class="glass-soft stat">
          <b>${claims.filter((c) => c.status === 'pending').length}</b>
          <span>Reclamos pendientes</span>
        </div>
        <div class="glass-soft stat">
          <b>${releases.filter((r) => r.status === 'review' || r.status === 'scheduled').length}</b>
          <span>Canciones por revisar</span>
        </div>
      </section>

      <!-- Selector de pestañas del Dashboard -->
      <nav class="seg four admin-tabs" role="tablist" aria-label="Secciones de administración">
        <button class="seg-btn lit ${activeTab === 'claims' ? 'on' : ''}" data-action="admin-set-tab" data-tab="claims">
          ${icon('mic')} ${t('admin.claims', 'Reclamos de Artistas')} (${claims.filter((c) => c.status === 'pending').length})
        </button>
        <button class="seg-btn lit ${activeTab === 'releases' ? 'on' : ''}" data-action="admin-set-tab" data-tab="releases">
          ${icon('disc')} ${t('admin.releases', 'Subida de Canciones')} (${releases.filter((r) => r.status === 'review').length})
        </button>
        <button class="seg-btn lit ${activeTab === 'feed' ? 'on' : ''}" data-action="admin-set-tab" data-tab="feed">
          ${icon('chat')} ${t('admin.feed_mod', 'Moderación Feed')}
        </button>
        <button class="seg-btn lit ${activeTab === 'users' ? 'on' : ''}" data-action="admin-set-tab" data-tab="users">
          ${icon('user')} ${t('admin.users', 'Gestión de Cuentas')} (${accounts.filter((a) => !a.isGuest).length})
        </button>
      </nav>

      <!-- Contenido según la pestaña activa -->
      <div class="admin-tab-body">
        ${renderActiveTab({ claims, releases, posts, accounts, profileMap })}
      </div>
    </div>
  `;
}

function renderActiveTab({ claims, releases, posts, accounts, profileMap }) {
  if (activeTab === 'claims') return renderClaimsTab(claims);
  if (activeTab === 'releases') return renderReleasesTab(releases);
  if (activeTab === 'feed') return renderFeedTab(posts);
  if (activeTab === 'users') return renderUsersTab(accounts, profileMap);
  return '';
}

// 1. Pestaña de Reclamos de Artistas
function renderClaimsTab(claims) {
  if (!claims.length) {
    return `<div class="glass-soft notice">${icon('check')}<p>${t('admin.no_pending_claims', 'No hay reclamos de artistas en el sistema.')}</p></div>`;
  }
  const pending = claims.filter((c) => c.status === 'pending');
  const others = claims.filter((c) => c.status !== 'pending');

  return `
    <div class="admin-section">
      <h2 class="section-title">Reclamos Pendientes (${pending.length})</h2>
      ${pending.length ? `<div class="admin-card-list">${pending.map((c) => renderClaimRow(c)).join('')}</div>`
        : `<p class="muted">No hay solicitudes pendientes en este momento.</p>`}

      <h2 class="section-title" style="margin-top:28px">Historial de Reclamos (${others.length})</h2>
      <div class="admin-card-list">${others.map((c) => renderClaimRow(c)).join('')}</div>
    </div>
  `;
}

function renderClaimRow(c) {
  const isPending = c.status === 'pending';
  const isApproved = c.status === 'approved';
  const links = Object.entries(c.links || {}).filter(([, url]) => Boolean(url));

  return `
    <div class="glass-soft form-card admin-claim-card enter">
      <div class="admin-card-head">
        <div>
          <b>${esc(c.artistName)}</b> ${statusPill(claimStatus(c.status))}
          <div class="muted small">${esc(c.legalName || 'Sin nombre real')} · ${esc(c.country || 'Sin país')} · ${esc(c.email || '')}</div>
        </div>
        <div class="admin-badges">
          ${c.verification ? `<span class="pill ok">${c.verification === 'full' ? 'Verificación Oficial' : 'Verificado Local'}</span>` : ''}
        </div>
      </div>

      <div class="admin-claim-details">
        <p><b>Géneros:</b> ${esc((c.genres || []).join(', ') || 'No especificados')}</p>
        ${c.code ? `<p><b>Código de verificación:</b> <code>${esc(c.code)}</code> ${c.codeWhere ? `(en ${esc(c.codeWhere)})` : ''}</p>` : ''}
        ${links.length ? `<div class="link-list">${links.map(([k, url]) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" class="link-chip lit">${icon('link')}${esc(k)}</a>`).join('')}</div>` : ''}
        ${c.bio ? `<p class="hint">Bio: ${esc(c.bio)}</p>` : ''}
      </div>

      <div class="hero-actions" style="margin-top:14px">
        ${isPending ? `
          <button class="btn-primary lit" data-action="admin-claim-action" data-op="approve" data-uid="${esc(c.uid)}">${icon('check')} Aprobar y Verificar</button>
          <button class="btn-glass lit" data-action="admin-claim-action" data-op="needs_info" data-uid="${esc(c.uid)}">Pedir más datos</button>
          <button class="btn-glass danger lit" data-action="admin-claim-action" data-op="reject" data-uid="${esc(c.uid)}">Rechazar</button>
        ` : ''}
        ${isApproved ? `
          <button class="btn-glass danger lit" data-action="admin-claim-action" data-op="revoke" data-uid="${esc(c.uid)}">Revocar Verificación</button>
        ` : ''}
        ${!isPending && !isApproved ? `
          <button class="btn-glass lit" data-action="admin-claim-action" data-op="approve" data-uid="${esc(c.uid)}">Reabrir y Aprobar</button>
        ` : ''}
      </div>
    </div>
  `;
}

// 2. Pestaña de Subida de Canciones y Lanzamientos
function renderReleasesTab(releases) {
  if (!releases.length) {
    return `<div class="glass-soft notice">${icon('disc')}<p>${t('admin.no_pending_releases', 'No hay canciones ni lanzamientos en la plataforma.')}</p></div>`;
  }
  return `
    <div class="admin-section">
      <h2 class="section-title">Lanzamientos en Revisión y Publicados (${releases.length})</h2>
      <div class="admin-card-list">
        ${releases.map((r) => `
          <div class="glass-soft form-card admin-release-card enter">
            <div class="admin-release-head">
              <div class="art sm">${r.coverThumb || r.coverUrl ? `<img src="${esc(r.coverThumb || r.coverUrl)}" alt="" loading="lazy">` : icon('disc')}</div>
              <div class="row-main">
                <b>${esc(r.title)}</b>
                <div class="muted small">${esc(r.primaryArtist || r.artistName || 'Artista')} · ${esc(typeLabel(r.type || 'single'))} · ${(r.tracks || []).length} canciones · ${esc(r.genre || 'Género')}</div>
                ${r.audioQuality ? `<span class="pill sm hi" style="margin-top:4px">${esc(r.audioQuality)}</span>` : ''}
              </div>
              <div>${statusPill({ label: r.status, tone: r.status === 'published' ? 'ok' : r.status === 'scheduled' ? 'hi' : 'warn' })}</div>
            </div>

            <div class="hero-actions" style="margin-top:14px">
              ${r.status === 'review' || r.status === 'draft' ? `
                <button class="btn-primary lit" data-action="admin-release-action" data-op="publish" data-id="${esc(r.id)}">${icon('check')} Aprobar y Publicar</button>
                <button class="btn-glass danger lit" data-action="admin-release-action" data-op="reject" data-id="${esc(r.id)}">Pedir cambios</button>
              ` : ''}
              ${r.status === 'scheduled' ? `
                <button class="btn-primary lit" data-action="admin-release-action" data-op="publish_now" data-id="${esc(r.id)}">Publicar Ahora (Adelantar estreno)</button>
              ` : ''}
              ${r.status === 'published' ? `
                <button class="btn-glass danger lit" data-action="admin-release-action" data-op="hide" data-id="${esc(r.id)}">Ocultar de catálogo</button>
              ` : ''}
              <button class="btn-glass danger lit" data-action="admin-release-action" data-op="delete" data-id="${esc(r.id)}">${icon('trash')} Eliminar</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// 3. Pestaña de Moderación del Feed y Comentarios
function renderFeedTab(posts) {
  if (!posts.length) {
    return `<div class="glass-soft notice">${icon('chat')}<p>No hay publicaciones en el feed para moderar.</p></div>`;
  }
  return `
    <div class="admin-section">
      <h2 class="section-title">Moderación de Publicaciones y Comentarios (${posts.length})</h2>
      <div class="admin-card-list">
        ${posts.slice(0, 50).map((p) => `
          <div class="glass-soft form-card admin-post-card enter">
            <div class="admin-post-meta">
              <b>${esc(p.author?.displayName || p.author?.username || 'Usuario')}</b>
              <span class="muted">@${esc(p.author?.username || p.uid)} · ${new Date(p.created).toLocaleString()}</span>
              ${p.replyTo ? `<span class="pill sm warn">Comentario / Respuesta</span>` : `<span class="pill sm ok">Publicación</span>`}
            </div>
            <p class="admin-post-text">${esc(p.text || '(Sin texto / multimedia)')}</p>
            <div class="hero-actions" style="margin-top:10px">
              <button class="btn-glass danger lit sm" data-action="admin-delete-post" data-id="${esc(p.id)}">
                ${icon('trash')} ${p.replyTo ? t('admin.delete_comment', 'Eliminar comentario') : t('admin.delete_post', 'Eliminar publicación')}
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// 4. Pestaña de Gestión y Moderación de Cuentas de Usuario
function renderUsersTab(accounts, profileMap) {
  const nonGuest = accounts.filter((a) => !a.isGuest);
  const filtered = nonGuest.filter((a) => {
    const prof = profileMap.get(a.uid) || {};
    if (userFilter === 'artist' && prof.role !== 'artist' && prof.accountType !== 'artist') return false;
    if (userFilter === 'listener' && (prof.role === 'artist' || prof.accountType === 'artist')) return false;
    if (userFilter === 'admin' && !a.isAdmin && !a.isOwner) return false;
    if (userSearch) {
      const q = userSearch.toLowerCase();
      const matchEmail = (a.email || '').toLowerCase().includes(q);
      const matchName = (prof.displayName || '').toLowerCase().includes(q);
      const matchUser = (prof.username || '').toLowerCase().includes(q);
      if (!matchEmail && !matchName && !matchUser) return false;
    }
    return true;
  });

  return `
    <div class="admin-section">
      <div class="admin-user-toolbar">
        <div class="seg four user-filter-seg">
          <button class="seg-btn lit ${userFilter === 'all' ? 'on' : ''}" data-action="admin-user-filter" data-f="all">Todos (${nonGuest.length})</button>
          <button class="seg-btn lit ${userFilter === 'artist' ? 'on' : ''}" data-action="admin-user-filter" data-f="artist">Artistas</button>
          <button class="seg-btn lit ${userFilter === 'listener' ? 'on' : ''}" data-action="admin-user-filter" data-f="listener">Oyentes</button>
          <button class="seg-btn lit ${userFilter === 'admin' ? 'on' : ''}" data-action="admin-user-filter" data-f="admin">Administración</button>
        </div>
        <input class="input admin-user-search" placeholder="Buscar por correo, nombre o @usuario…" value="${esc(userSearch)}" data-action-input="admin-user-search">
      </div>

      <div class="admin-card-list" style="margin-top:16px">
        ${filtered.length ? filtered.map((a) => renderUserCard(a, profileMap.get(a.uid))).join('') : '<p class="muted">No hay cuentas que coincidan con la búsqueda.</p>'}
      </div>
    </div>
  `;
}

function renderUserCard(a, prof = {}) {
  const isSuspended = !!a.suspended;
  const isBlocked = !!a.blocked;
  const isOwner = a.isOwner || (app.auth.isOwner && app.auth.user?.uid === a.uid);
  const isAdmin = a.isAdmin;

  let statusBadge = `<span class="pill ok">${t('common.active', 'Activa')}</span>`;
  if (isBlocked) statusBadge = `<span class="pill bad">${t('common.blocked', 'Bloqueada')}</span>`;
  else if (isSuspended) statusBadge = `<span class="pill warn">${t('common.suspended', 'Suspendida')}</span>`;

  return `
    <div class="glass-soft form-card admin-user-row enter">
      <div class="admin-user-info">
        <div class="row-main">
          <b>${esc(prof.displayName || 'Sin nombre')}</b>
          <span class="muted">@${esc(prof.username || a.uid)} · <code>${esc(a.email || 'sin-correo')}</code></span>
          <div class="admin-user-pills" style="margin-top:4px">
            <span class="pill sm">${prof.role === 'artist' || prof.accountType === 'artist' ? 'Artista' : 'Oyente'}</span>
            ${isAdmin ? `<span class="pill sm hi">Admin</span>` : ''}
            ${statusBadge}
          </div>
        </div>
      </div>

      <div class="hero-actions">
        ${!isOwner ? `
          ${!isSuspended && !isBlocked ? `
            <button class="btn-glass warn lit sm" data-action="admin-user-op" data-op="suspend" data-uid="${esc(a.uid)}">${t('admin.suspend_account', 'Suspender')}</button>
            <button class="btn-glass danger lit sm" data-action="admin-user-op" data-op="block" data-uid="${esc(a.uid)}">${t('admin.block_account', 'Bloquear')}</button>
          ` : `
            <button class="btn-primary lit sm" data-action="admin-user-op" data-op="reactivate" data-uid="${esc(a.uid)}">${t('admin.reactivate_account', 'Reactivar')}</button>
          `}
          <button class="btn-glass danger lit sm" data-action="admin-user-op" data-op="delete" data-uid="${esc(a.uid)}">${icon('trash')} ${t('admin.delete_account', 'Eliminar')}</button>
        ` : '<span class="muted small">Cuenta Propietario protegida</span>'}
      </div>
    </div>
  `;
}

// Acciones administrativas registradas
registerActions({
  'admin-set-tab': (el) => {
    activeTab = el.dataset.tab || 'claims';
    app.render();
  },

  'admin-user-filter': (el) => {
    userFilter = el.dataset.f || 'all';
    app.render();
  },

  'admin-user-search': (el) => {
    userSearch = el.value.trim();
    app.render();
  },

  // Moderación de reclamos
  'admin-claim-action': async (el) => {
    const { op, uid } = el.dataset;
    if (!canAccessAdmin()) return;
    try {
      const claim = await db.get('claims', uid);
      if (!claim) throw new Error('Reclamo no encontrado');

      if (op === 'approve') {
        claim.status = 'approved';
        claim.verification = 'full';
        claim.reviewedAt = Date.now();
        await db.put('claims', claim);
        // Promover perfil de usuario a artista verificado
        const prof = await db.get('profiles', uid);
        if (prof) {
          prof.role = 'artist';
          prof.accountType = 'artist';
          prof.accountTypeSet = true;
          await db.put('profiles', prof);
        }
        app.toast('Reclamo aprobado con éxito. El perfil ahora es Artista Verificado.');
      } else if (op === 'needs_info') {
        const note = await promptModal('Pedir información al artista:', 'Detallá qué pruebas faltan…');
        if (!note) return;
        claim.status = 'needs_info';
        claim.reviewNote = note;
        await db.put('claims', claim);
        app.toast('Se solicitó información adicional al artista.');
      } else if (op === 'reject') {
        const ok = await confirmModal('¿Rechazar esta solicitud de artista?');
        if (!ok) return;
        claim.status = 'rejected';
        claim.reviewedAt = Date.now();
        await db.put('claims', claim);
        app.toast('Reclamo rechazado.');
      } else if (op === 'revoke') {
        const ok = await confirmModal('¿Revocar verificación del artista? Sus lanzamientos quedarán ocultos.');
        if (!ok) return;
        claim.status = 'revoked';
        await db.put('claims', claim);
        const prof = await db.get('profiles', uid);
        if (prof) {
          prof.role = 'listener';
          prof.accountType = 'listener';
          await db.put('profiles', prof);
        }
        app.toast('Verificación revocada.');
      }
      app.render();
    } catch (err) {
      app.toast(err.message);
    }
  },

  // Moderación de lanzamientos
  'admin-release-action': async (el) => {
    const { op, id } = el.dataset;
    if (!canAccessAdmin()) return;
    try {
      const rel = await db.get('releases', id);
      if (!rel) throw new Error('Lanzamiento no encontrado');

      if (op === 'publish' || op === 'publish_now') {
        rel.status = 'published';
        rel.published = Date.now();
        await db.put('releases', rel);
        await app.releases.load();
        app.toast('Lanzamiento aprobado y publicado en toda la plataforma.');
      } else if (op === 'reject') {
        const note = await promptModal('Motivo de rechazo o cambios requeridos:');
        if (!note) return;
        rel.status = 'rejected';
        rel.reviewNote = note;
        await db.put('releases', rel);
        app.toast('Cambios solicitados al artista.');
      } else if (op === 'hide') {
        rel.status = 'hidden';
        await db.put('releases', rel);
        await app.releases.load();
        app.toast('Lanzamiento ocultado del catálogo.');
      } else if (op === 'delete') {
        const ok = await confirmModal('¿Eliminar definitivamente este lanzamiento?');
        if (!ok) return;
        await db.del('releases', id);
        await app.releases.load();
        app.toast('Lanzamiento eliminado.');
      }
      app.render();
    } catch (err) {
      app.toast(err.message);
    }
  },

  // Moderación de publicaciones
  'admin-delete-post': async (el) => {
    const { id } = el.dataset;
    if (!canAccessAdmin()) return;
    const ok = await confirmModal('¿Eliminar esta publicación o comentario del feed?');
    if (!ok) return;
    try {
      await app.posts.remove(id);
      app.toast('Publicación eliminada correctamente.');
      app.render();
    } catch (err) {
      app.toast(err.message);
    }
  },

  // Moderación de cuentas
  'admin-user-op': async (el) => {
    const { op, uid } = el.dataset;
    if (!canAccessAdmin()) return;
    try {
      const acc = await db.get('accounts', uid);
      if (!acc) throw new Error('Cuenta no encontrada.');

      if (op === 'suspend') {
        const ok = await confirmModal(`¿Suspender temporalmente la cuenta de ${acc.email}?`);
        if (!ok) return;
        acc.suspended = true;
        await db.put('accounts', acc);
        app.toast('Cuenta suspendida.');
      } else if (op === 'block') {
        const ok = await confirmModal(`¿Bloquear permanentemente la cuenta de ${acc.email}?`);
        if (!ok) return;
        acc.blocked = true;
        acc.suspended = true;
        await db.put('accounts', acc);
        app.toast('Cuenta bloqueada.');
      } else if (op === 'reactivate') {
        acc.suspended = false;
        acc.blocked = false;
        await db.put('accounts', acc);
        app.toast('Cuenta reactivada.');
      } else if (op === 'delete') {
        const ok = await confirmModal(`¿ELIMINAR DEFINITIVAMENTE la cuenta de ${acc.email} y todos sus datos?`);
        if (!ok) return;
        await db.del('accounts', uid);
        await db.del('profiles', uid);
        await db.del('claims', uid).catch(() => {});
        app.toast('Cuenta eliminada con éxito.');
      }
      app.render();
    } catch (err) {
      app.toast(err.message);
    }
  },
});
