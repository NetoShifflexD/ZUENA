// Presentación efímera sobre Prisma Motion: sin estado de audio ni temporizadores propios.
export const PLAYER_TABS = [
  ['now', 'Ahora suena', 'music'], ['lyrics', 'Letra', 'mic'],
  ['queue', 'Cola', 'queue'], ['credits', 'Créditos', 'disc'],
];

export function selectPlayerTab(root, motion, tab, { animate = true } = {}) {
  const index = Math.max(0, PLAYER_TABS.findIndex(([id]) => id === tab));
  const indicator = root.querySelector('.np-tab-indicator');
  const from = indicator && animate && motion.enabled ? getComputedStyle(indicator).transform : null;
  root.style.setProperty('--np-tab-index', String(index));
  if (indicator) {
    motion.cancel(indicator);
    if (from) motion.animate(indicator, [{ transform: from }, { transform: `translateX(${index * 100}%)` }], { spring: 'snappy', duration: 300, commit: false });
  }
  const pane = root.querySelector('#np-pane');
  motion.cancel(pane);
  const surface = pane?.hasChildNodes() ? pane : root.querySelector('.np-titles');
  motion.cancel(root.querySelector('.np-titles'));
  if (animate && surface) motion.animate(surface,
    [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }],
    { duration: 240, commit: false });
}

export function enterPlayer(root, motion) {
  motion.animate(root.querySelector('.np-stage'),
    [{ opacity: .2, transform: 'translateY(20px) scale(.97)' }, { opacity: 1, transform: 'none' }],
    { spring: 'smooth', duration: 480, commit: false });
  motion.animate(root.querySelector('.np-side'),
    [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }],
    { duration: 360, commit: false });
}

export function cancelPlayerPresentation(root, motion) {
  motion.cancel(root.querySelectorAll('.np-stage, .np-side, .np-art, .np-pane, .np-titles, .np-tab-indicator'));
}

export function updateMiniProgress(root, position, duration, live = false) {
  if (!root || root.hidden) return;
  const fraction = !live && Number.isFinite(duration) && duration > 0 && Number.isFinite(position)
    ? Math.max(0, Math.min(1, position / duration)) : 0;
  const value = fraction.toFixed(4);
  if (root.dataset.progress === value) return;
  root.dataset.progress = value;
  const line = root.querySelector('.mini-progress > i');
  if (line) line.style.transform = `scaleX(${value})`;
}
