// ============================================================
// particles.js — pooled particle/VFX system.
//
// One flat array of light particle records, two render layers
// (0 = ground level: dust, casings, rings; 1 = above entities:
// fire, smoke, sparks). Particles can carry fake height `z`
// with gravity and bounce (shell casings, debris chunks), and
// colors that shift across their lifetime (fire → smoke).
// All combat juice routes through the emitter helpers at the
// bottom — muzzle flashes, impacts, blood puffs, explosions,
// water splashes — so visuals stay consistent everywhere.
// ============================================================

import { rand, spread, TAU, clamp, lerp } from '../core/math.js';

const MAX = 1600;

const lerpCol = (a, b, t) =>
  `rgb(${(lerp(a[0], b[0], t)) | 0},${(lerp(a[1], b[1], t)) | 0},${(lerp(a[2], b[2], t)) | 0})`;

export class ParticleSystem {
  constructor() {
    this.list = [];
  }

  spawn(p) {
    // at cap, overwrite-evict via swap (order within a layer is
    // irrelevant; shift() would move 1600 elements per spawn during
    // chain detonations)
    if (this.list.length >= MAX) {
      this.list[(Math.random() * this.list.length) | 0] = this.list[this.list.length - 1];
      this.list.pop();
    }
    this.list.push({
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      grav: 0, drag: 0,
      life: 1, maxLife: 1,
      size: 4, sizeEnd: null,
      col0: [255, 255, 255], col1: null,
      alpha: 1, add: false,
      rot: 0, vrot: 0,
      shape: 'circle',   // 'circle' | 'rect' | 'ring' | 'casing'
      layer: 1,
      bounces: 0,
      ...p,
      _max: p.life ?? 1,
    });
  }

  update(dt) {
    const arr = this.list;
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i];
      p.life -= dt;
      if (p.life <= 0) { arr[i] = arr[arr.length - 1]; arr.pop(); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.drag) {
        const d = Math.max(0, 1 - p.drag * dt);
        p.vx *= d; p.vy *= d;
      }
      if (p.grav || p.z > 0 || p.vz !== 0) {
        p.vz -= p.grav * dt;
        p.z += p.vz * dt;
        if (p.z <= 0 && p.vz < 0) {
          p.z = 0;
          if (p.shape === 'casing' && p.bounces < 2) {
            p.vz = -p.vz * 0.4;
            p.vx *= 0.55; p.vy *= 0.55;
            p.bounces++;
          } else {
            p.vz = 0; p.vx *= 0.4; p.vy *= 0.4;
          }
        }
      }
      p.rot += p.vrot * dt;
    }
  }

  // Draw one layer; caller wraps both calls around entity rendering.
  draw(ctx, layer, camY, viewH) {
    for (const p of this.list) {
      if (p.layer !== layer) continue;
      const sy = p.y - p.z;
      if (sy < camY - 60 || sy > camY + viewH + 60) continue;
      const t = 1 - p.life / p._max; // 0 → 1 over lifetime
      const size = p.sizeEnd === null ? p.size : lerp(p.size, p.sizeEnd, t);
      const col = p.col1 ? lerpCol(p.col0, p.col1, t) : `rgb(${p.col0[0]},${p.col0[1]},${p.col0[2]})`;
      // NOTE: p.alpha intentionally applies twice (quadratic) — it
      // softens translucent smoke/dust; every emitter is tuned to it
      ctx.globalAlpha = clamp(p.alpha * (p.life / p._max) * 1.4, 0, 1) * p.alpha;
      if (p.add) ctx.globalCompositeOperation = 'lighter';

      if (p.shape === 'circle') {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(p.x, sy, Math.max(0.4, size), 0, TAU);
        ctx.fill();
      } else if (p.shape === 'rect' || p.shape === 'casing') {
        ctx.save();
        ctx.translate(p.x, sy);
        ctx.rotate(p.rot);
        ctx.fillStyle = col;
        ctx.fillRect(-size / 2, -size / 4, size, size / 2);
        ctx.restore();
      } else if (p.shape === 'ring') {
        ctx.strokeStyle = col;
        ctx.lineWidth = Math.max(1, size * 0.12 * (1 - t));
        ctx.beginPath();
        ctx.arc(p.x, sy, Math.max(0.5, size * t + 2), 0, TAU);
        ctx.stroke();
      }

      if (p.add) ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
  }
}

// ============================================================
// Emitter helpers — the game's VFX vocabulary.
// ============================================================

export function muzzleFlash(fx, x, y, ang, big = false) {
  const k = big ? 1.8 : 1;
  fx.spawn({
    x: x + Math.cos(ang) * 6, y: y + Math.sin(ang) * 6,
    life: 0.05, size: 14 * k, sizeEnd: 4,
    col0: [255, 240, 160], add: true, layer: 1,
  });
  for (let i = 0; i < 3; i++) {
    const a = ang + spread(0.5);
    fx.spawn({
      x, y, vx: Math.cos(a) * rand(140, 320) , vy: Math.sin(a) * rand(140, 320),
      life: rand(0.04, 0.1), size: rand(2, 4) * k, sizeEnd: 0.5,
      col0: [255, 200, 90], col1: [180, 60, 20], add: true, drag: 6,
    });
  }
  // brief smoke wisp
  fx.spawn({
    x, y, vx: Math.cos(ang) * 40 + spread(20), vy: Math.sin(ang) * 40 - 25,
    life: rand(0.3, 0.5), size: 3, sizeEnd: 9,
    col0: [160, 160, 150], alpha: 0.35, layer: 1,
  });
}

export function shellCasing(fx, x, y, ang) {
  const side = ang + Math.PI / 2 + spread(0.4);
  fx.spawn({
    x, y, z: 14, shape: 'casing', layer: 0,
    vx: Math.cos(side) * rand(40, 90), vy: Math.sin(side) * rand(40, 90),
    vz: rand(60, 130), grav: 420,
    life: rand(0.9, 1.4), size: 4,
    col0: [212, 175, 90], col1: [140, 110, 50],
    rot: rand(0, TAU), vrot: spread(18), alpha: 0.95,
  });
}

export function bulletImpact(fx, x, y, ang) {
  for (let i = 0; i < 4; i++) {
    const a = ang + Math.PI + spread(0.9);
    fx.spawn({
      x, y, vx: Math.cos(a) * rand(80, 260), vy: Math.sin(a) * rand(80, 260),
      life: rand(0.08, 0.2), size: rand(1.5, 3), sizeEnd: 0.3,
      col0: [255, 220, 130], add: true, drag: 8,
    });
  }
  fx.spawn({
    x, y, life: 0.25, size: 3, sizeEnd: 8,
    col0: [150, 140, 120], alpha: 0.3,
  });
}

export function dustPuff(fx, x, y, n = 3) {
  for (let i = 0; i < n; i++) {
    fx.spawn({
      x: x + spread(6), y: y + spread(4),
      vx: spread(28), vy: spread(18) - 8,
      life: rand(0.3, 0.6), size: rand(3, 5), sizeEnd: rand(8, 12),
      col0: [148, 130, 96], alpha: 0.28, layer: 0,
    });
  }
}

export function bloodPuff(fx, x, y, ang) {
  for (let i = 0; i < 6; i++) {
    const a = ang + spread(0.8);
    fx.spawn({
      x, y, vx: Math.cos(a) * rand(40, 190), vy: Math.sin(a) * rand(40, 190),
      life: rand(0.15, 0.4), size: rand(2, 4.5), sizeEnd: 1,
      col0: [165, 30, 25], col1: [90, 15, 12], drag: 5,
    });
  }
}

export function leafBurst(fx, x, y) {
  for (let i = 0; i < 5; i++) {
    fx.spawn({
      x: x + spread(8), y: y + spread(8), z: rand(4, 16),
      vx: spread(80), vy: spread(80), vz: rand(10, 50), grav: 160,
      life: rand(0.4, 0.8), size: rand(2, 4), shape: 'rect',
      col0: [70, 110, 45], col1: [40, 70, 28],
      rot: rand(0, TAU), vrot: spread(10),
    });
  }
}

export function waterSplash(fx, x, y, big = false) {
  const n = big ? 16 : 7;
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU);
    fx.spawn({
      x, y, z: 2,
      vx: Math.cos(a) * rand(30, big ? 160 : 80), vy: Math.sin(a) * rand(20, big ? 110 : 60),
      vz: rand(60, big ? 220 : 120), grav: 500,
      life: rand(0.3, 0.6), size: rand(2, 3.5), sizeEnd: 1,
      col0: [200, 230, 245], alpha: 0.8,
    });
  }
  fx.spawn({
    x, y, shape: 'ring', life: 0.5, size: big ? 60 : 26,
    col0: [220, 240, 250], alpha: 0.5, layer: 0,
  });
}

// The big one. radius drives every sub-effect's scale.
export function explosion(fx, x, y, radius) {
  const k = radius / 95;
  // core flash
  fx.spawn({
    x, y, life: 0.09, size: radius * 0.9, sizeEnd: radius * 0.3,
    col0: [255, 250, 220], add: true,
  });
  fx.spawn({
    x, y, life: 0.16, size: radius * 0.55, sizeEnd: radius * 0.95,
    col0: [255, 200, 90], col1: [200, 60, 20], add: true,
  });
  // shockwave ring
  fx.spawn({
    x, y, shape: 'ring', life: 0.35, size: radius * 2.1,
    col0: [255, 230, 180], alpha: 0.8, layer: 0,
  });
  // fireballs
  for (let i = 0; i < 10 * k; i++) {
    const a = rand(0, TAU), sp = rand(30, 170) * k;
    fx.spawn({
      x: x + spread(radius * 0.25), y: y + spread(radius * 0.25),
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30,
      life: rand(0.25, 0.55), size: rand(8, 16) * k, sizeEnd: 2,
      col0: [255, 180, 60], col1: [120, 40, 15], add: true, drag: 3,
    });
  }
  // smoke column
  for (let i = 0; i < 9 * k; i++) {
    fx.spawn({
      x: x + spread(radius * 0.4), y: y + spread(radius * 0.4),
      vx: spread(30), vy: -rand(25, 80),
      life: rand(0.8, 1.8), size: rand(10, 18) * k, sizeEnd: rand(26, 40) * k,
      col0: [80, 75, 70], col1: [40, 38, 36], alpha: 0.5, drag: 1.5,
    });
  }
  // debris chunks with height
  for (let i = 0; i < 8 * k; i++) {
    const a = rand(0, TAU);
    fx.spawn({
      x, y, z: 4, shape: 'rect',
      vx: Math.cos(a) * rand(60, 240) * k, vy: Math.sin(a) * rand(60, 240) * k,
      vz: rand(120, 320), grav: 560,
      life: rand(0.5, 1.1), size: rand(3, 7),
      col0: [60, 50, 40], col1: [35, 30, 25],
      rot: rand(0, TAU), vrot: spread(20),
    });
  }
  // sparks
  for (let i = 0; i < 12 * k; i++) {
    const a = rand(0, TAU);
    fx.spawn({
      x, y, vx: Math.cos(a) * rand(200, 480) * k, vy: Math.sin(a) * rand(200, 480) * k,
      life: rand(0.1, 0.3), size: rand(1.5, 3), sizeEnd: 0.3,
      col0: [255, 230, 140], add: true, drag: 4,
    });
  }
}

export function smokeTrail(fx, x, y, z) {
  fx.spawn({
    x: x + spread(2), y: y + spread(2), z,
    vx: spread(10), vy: spread(10),
    life: rand(0.25, 0.45), size: 3, sizeEnd: 7,
    col0: [190, 190, 185], alpha: 0.4,
  });
}

export function sparkBurst(fx, x, y, n = 8) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU);
    fx.spawn({
      x, y, vx: Math.cos(a) * rand(100, 320), vy: Math.sin(a) * rand(100, 320),
      life: rand(0.1, 0.28), size: rand(1.5, 3.2), sizeEnd: 0.4,
      col0: [255, 235, 150], add: true, drag: 5,
    });
  }
}
