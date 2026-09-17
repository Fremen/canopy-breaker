// ============================================================
// math.js — shared math helpers, RNG, easing.
// ============================================================

export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist2 = (ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; };
export const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));
export const angTo = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);
export const len = (x, y) => Math.sqrt(x * x + y * y);

// Normalize a vector; returns {x, y, l} (zero vector stays zero).
export function norm(x, y) {
  const l = Math.sqrt(x * x + y * y);
  if (l < 1e-6) return { x: 0, y: 0, l: 0 };
  return { x: x / l, y: y / l, l };
}

// Smallest signed difference between two angles, in [-PI, PI].
export function angDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

// Rotate angle `a` toward `b` by at most `step` radians.
export function angApproach(a, b, step) {
  const d = angDiff(a, b);
  if (Math.abs(d) <= step) return b;
  return a + Math.sign(d) * step;
}

// Frame-rate independent exponential damping factor.
// usage: x = lerp(x, target, damp(rate, dt))
export const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

// ---------- random ----------

export const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const chance = (p) => Math.random() < p;
export const spread = (amt) => (Math.random() - 0.5) * 2 * amt;

// Deterministic seeded RNG (terrain chunks must regenerate identically).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- easing ----------

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t) => t * t * t;
export const easeOutBack = (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

// Circle-vs-circle overlap.
export const circleHit = (ax, ay, ar, bx, by, br) => dist2(ax, ay, bx, by) < (ar + br) * (ar + br);
