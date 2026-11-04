// Física de resortes del motor (masa–resorte–amortiguador, solución analítica).
// · springEasing(): convierte un resorte en una curva CSS `linear(...)` para usarla en CSS o en la API de
//   Animaciones Web: el navegador la ejecuta en el compositor (sin JS por fotograma).
// · springValue(): resorte en JS para valores que siguen al puntero (arrastres, imán, seguimiento).

// posición normalizada (0 → 1) del resorte en el tiempo t (s)
function solve({ stiffness = 170, damping = 26, mass = 1, velocity = 0 } = {}) {
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  const v0 = -velocity;
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return (t) => 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0 - v0) / wd) * Math.sin(wd * t));
  }
  if (zeta > 1.00001) {
    const d = Math.sqrt(zeta * zeta - 1);
    const r1 = -w0 * (zeta - d), r2 = -w0 * (zeta + d);
    const a = (velocity + r2) / (r1 - r2);
    return (t) => 1 + a * Math.exp(r1 * t) + (-1 - a) * Math.exp(r2 * t);
  }
  return (t) => 1 - Math.exp(-w0 * t) * (1 + (w0 - velocity) * t);
}

// duración hasta que el resorte queda quieto (error < 0,1 %)
export function springDuration(cfg) {
  const f = solve(cfg);
  for (let t = 0.05; t < 5; t += 0.01) {
    let settled = true;
    for (let k = 0; k < 0.2; k += 0.02) if (Math.abs(1 - f(t + k)) > 0.001) { settled = false; break; }
    if (settled) return Math.round(t * 1000);
  }
  return 5000;
}

const cache = new Map();

// resorte → { easing: 'linear(...)', duration: ms }
export function springEasing(cfg = {}) {
  const key = JSON.stringify(cfg);
  if (cache.has(key)) return cache.get(key);
  const duration = springDuration(cfg);
  const f = solve(cfg);
  const steps = Math.min(80, Math.max(24, Math.round(duration / 16)));
  const pts = [];
  for (let i = 0; i <= steps; i++) pts.push(+f((i / steps) * (duration / 1000)).toFixed(4));
  pts[pts.length - 1] = 1;
  const out = { easing: `linear(${pts.join(', ')})`, duration };
  cache.set(key, out);
  return out;
}

// resorte en JS que persigue un objetivo (para valores continuos, p. ej. seguir al puntero)
export function springValue(initial = 0, { stiffness = 260, damping = 28, mass = 1, onUpdate } = {}) {
  let x = initial, v = 0, target = initial, raf = 0, last = 0;
  const tick = (now) => {
    const dt = Math.min(0.032, (now - last) / 1000 || 0.016);
    last = now;
    const a = (-stiffness * (x - target) - damping * v) / mass;
    v += a * dt;
    x += v * dt;
    onUpdate?.(x);
    if (Math.abs(v) < 0.01 && Math.abs(x - target) < 0.01) { x = target; onUpdate?.(x); raf = 0; return; }
    raf = requestAnimationFrame(tick);
  };
  return {
    set(t) { target = t; if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); } },
    jump(t) { cancelAnimationFrame(raf); raf = 0; last = 0; target = x = t; v = 0; onUpdate?.(x); },
    get value() { return x; },
    stop() { cancelAnimationFrame(raf); raf = 0; },
  };
}
