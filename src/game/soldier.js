// ============================================================
// soldier.js — procedural vector soldier used by the player and
// all infantry enemies. One draw function, many palettes, so
// every unit shares the same readable 2.5D language: ground
// shadow, animated boots, aim-tracking torso/weapon, helmeted
// head with a fake-height offset. Swap-in point for sprite art:
// replace this function, keep the call signature.
// ============================================================

import { TAU, clamp } from '../core/math.js';

// palette: { uniform, uniformDark, helmet, skin, vest, gun }
export const PALETTES = {
  player: {
    uniform: '#5a6e38', uniformDark: '#3c4a24', helmet: '#46562c',
    skin: '#d9a878', vest: '#8a7a4e', gun: '#23231e',
  },
  rifleman: {
    uniform: '#5d5f6b', uniformDark: '#41434d', helmet: '#33343c',
    skin: '#cfa074', vest: '#4a4c56', gun: '#1f1f1f',
  },
  strafer: {
    uniform: '#6b5d5d', uniformDark: '#4d4141', helmet: '#8a2f28',
    skin: '#cfa074', vest: '#5a4a4a', gun: '#1f1f1f',
  },
  grenadier: {
    uniform: '#6e6242', uniformDark: '#4d4530', helmet: '#5a503a',
    skin: '#c89a6e', vest: '#3d3526', gun: '#2a2a22',
  },
  rusher: {
    uniform: '#a8845c', uniformDark: '#7a5f40', helmet: '#b8342a', // bandana
    skin: '#c08858', vest: '#8a6a44', gun: '#444',
  },
};

export function drawSoldier(ctx, o) {
  // o: { x, y, aim, move, phase, pal, flash, scale, gunLen, crouch, moving }
  const s = o.scale ?? 1;
  const pal = o.pal;
  const crouch = o.crouch ? 0.85 : 1;
  const bob = o.moving ? Math.abs(Math.sin(o.phase)) * -1.6 * crouch : 0;

  ctx.save();
  ctx.translate(o.x, o.y);

  // --- ground shadow ---
  ctx.fillStyle = 'rgba(10,12,6,0.35)';
  ctx.beginPath();
  ctx.ellipse(0, 6 * s, 11 * s, 4.5 * s, 0, 0, TAU);
  ctx.fill();

  // --- boots (alternate along movement direction) ---
  const step = Math.sin(o.phase) * (o.moving ? 5.5 : 1.5) * s;
  const mx = Math.cos(o.move), my = Math.sin(o.move);
  const px = -my, py = mx; // perpendicular
  ctx.fillStyle = '#26221a';
  for (const dir of [1, -1]) {
    ctx.beginPath();
    ctx.ellipse(
      mx * step * dir + px * 4 * s * dir,
      5 * s + (my * step * dir + py * 2.2 * s * dir) * 0.55,
      3.2 * s, 2.2 * s, o.move, 0, TAU
    );
    ctx.fill();
  }

  // --- torso (with cheap radial shading) ---
  const ty = bob - 1 * s;
  const g = ctx.createRadialGradient(0, ty - 4 * s, 2, 0, ty, 11 * s);
  g.addColorStop(0, pal.uniform);
  g.addColorStop(1, pal.uniformDark);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, ty, 8.5 * s, 8.5 * s * crouch, 0, 0, TAU);
  ctx.fill();

  // backpack sits opposite the aim direction
  const ax = Math.cos(o.aim), ay = Math.sin(o.aim);
  ctx.fillStyle = pal.vest;
  ctx.beginPath();
  ctx.ellipse(-ax * 5 * s, ty - ay * 3 * s, 4.5 * s, 3.5 * s, o.aim, 0, TAU);
  ctx.fill();

  // --- weapon + arms, rotated to aim ---
  ctx.save();
  ctx.translate(0, ty);
  ctx.rotate(o.aim);
  const gl = (o.gunLen ?? 17) * s;
  if (gl > 0) {
    ctx.fillStyle = pal.gun;
    ctx.fillRect(3 * s, -1.4 * s, gl, 2.8 * s);          // barrel/receiver
    ctx.fillRect(3 * s, 1 * s, 4.5 * s, 3.2 * s);        // grip/mag
    ctx.fillStyle = pal.skin;
    ctx.beginPath(); ctx.arc(6 * s, 2.2 * s, 2.2 * s, 0, TAU); ctx.fill();   // trigger hand
    ctx.beginPath(); ctx.arc(gl * 0.65, -0.4 * s, 2.2 * s, 0, TAU); ctx.fill(); // fore hand
  } else {
    // melee posture: fists forward
    ctx.fillStyle = pal.skin;
    ctx.beginPath(); ctx.arc(8 * s, -4 * s, 2.6 * s, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(8 * s, 4 * s, 2.6 * s, 0, TAU); ctx.fill();
  }
  ctx.restore();

  // --- head + helmet (fake height: drawn above torso) ---
  const hx = ax * 1.6 * s, hy = ty - 8.5 * s * crouch + ay * 1 * s;
  ctx.fillStyle = pal.skin;
  ctx.beginPath(); ctx.arc(hx, hy + 1.5 * s, 4.2 * s, 0, TAU); ctx.fill();
  ctx.fillStyle = pal.helmet;
  ctx.beginPath(); ctx.arc(hx, hy, 5 * s, Math.PI * 0.95, Math.PI * 2.05); ctx.fill();
  ctx.beginPath(); ctx.ellipse(hx, hy + 0.5 * s, 5.6 * s, 1.8 * s, 0, 0, TAU); ctx.fill();
  // helmet highlight
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.beginPath(); ctx.ellipse(hx - 1.5 * s, hy - 1.5 * s, 2.5 * s, 1.2 * s, -0.5, 0, TAU); ctx.fill();

  // --- hit flash overlay ---
  if (o.flash > 0) {
    ctx.globalAlpha = clamp(o.flash, 0, 1);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(0, ty - 2 * s, 11 * s, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}
