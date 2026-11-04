// Primer instante de la carga, antes de cualquier módulo: aplica el modo y el color guardados para que la cubierta
// de index.html coincida con la intro y no se vea nunca el fondo de la app. Lo guarda applyTheme (js/theme/theme.js).
try {
  const saved = JSON.parse(localStorage.getItem('zuena:boot') || 'null');
  if (saved?.scheme) document.documentElement.dataset.scheme = saved.scheme;
  if (saved?.bg) document.documentElement.style.setProperty('--boot-bg', saved.bg);
} catch { /* sin almacenamiento: queda el color por defecto */ }
