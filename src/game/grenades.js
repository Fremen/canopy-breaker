// ============================================================
// grenades.js — arcing grenades for player and enemies.
//
// A grenade is a start→target lerp with a sine height arc and a
// drop shadow, so the throw reads instantly from above. ENEMY
// grenades paint a pulsing red landing reticle for their whole
// flight — dangerous attacks must telegraph. Detonation goes
// through game.explode(), the single AoE entry point (damage,
// knockback, shake, scorch decals, chain reactions).
// ============================================================

import { lerp, TAU } from '../core/math.js';
import { Settings } from '../core/settings.js';
import { smokeTrail } from './particles.js';
import { GRENADE } from './constants.js';

export class Grenade {
  constructor(sx, sy, tx, ty, friendly, opts = {}) {
    this.sx = sx; this.sy = sy;
    this.tx = tx; this.ty = ty;
    this.x = sx; this.y = sy; this.z = 8;
    this.friendly = friendly;
    this.t = 0;
    this.flight = opts.flight ?? GRENADE.flightTime;
    this.radius = opts.radius ?? GRENADE.radius;
    this.dmg = opts.dmg ?? GRENADE.dmg;
    this.rot = 0;
    this.dead = false;
    this._trail = 0;
  }

  update(game, dt) {
    this.t += dt / this.flight;
    this.rot += dt * 14;
    if (this.t >= 1) {
      this.dead = true;
      game.explode(this.x = this.tx, this.y = this.ty, {
        radius: this.radius,
        dmg: this.dmg,
        // Ownership decides who the blast hurts: your grenades never
        // clip you, enemy grenades never farm their own side (which
        // would hand the player free score/combo). Props still chain.
        hits: this.friendly ? 'enemies' : 'player',
        grenade: this.friendly, // player grenade kills count for efficiency bonus
      });
      return;
    }
    this.x = lerp(this.sx, this.tx, this.t);
    this.y = lerp(this.sy, this.ty, this.t);
    this.z = 8 + GRENADE.arcHeight * Math.sin(Math.PI * this.t);
    this._trail -= dt;
    if (this._trail <= 0) {
      smokeTrail(game.fx, this.x, this.y, this.z);
      this._trail = 0.04;
    }
  }

  // Ground layer: shadow + enemy landing telegraph.
  drawUnder(ctx, time) {
    if (!this.friendly) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 14);
      const r = this.radius * 0.85;
      ctx.save();
      ctx.globalAlpha = 0.25 + 0.25 * pulse;
      ctx.strokeStyle = Settings.highContrast ? '#ff35e8' : '#ff4a30';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([8, 7]);
      ctx.beginPath(); ctx.arc(this.tx, this.ty, r * (0.8 + 0.08 * pulse), 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.10 + 0.12 * pulse;
      ctx.fillStyle = '#ff3020';
      ctx.beginPath(); ctx.arc(this.tx, this.ty, r * 0.8, 0, TAU); ctx.fill();
      ctx.restore();
    }
    // drop shadow shrinks with height
    const sh = 1 - this.z / (GRENADE.arcHeight + 20);
    ctx.globalAlpha = 0.3 * Math.max(0.2, sh);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y, 5 * (0.6 + 0.4 * sh), 3 * (0.6 + 0.4 * sh), 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Entity layer: the grenade body at its arc height.
  draw(ctx) {
    const dy = this.y - this.z;
    ctx.save();
    ctx.translate(this.x, dy);
    ctx.rotate(this.rot);
    ctx.fillStyle = this.friendly ? '#3a4527' : '#4a3525';
    ctx.beginPath(); ctx.ellipse(0, 0, 5, 4, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#222';
    ctx.fillRect(-1.5, -6, 3, 3);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, 4.5, -0.6, 0.9); ctx.stroke();
    ctx.restore();
  }
}

export function updateGrenades(game, dt) {
  const arr = game.grenades;
  for (let i = arr.length - 1; i >= 0; i--) {
    arr[i].update(game, dt);
    if (arr[i].dead) { arr[i] = arr[arr.length - 1]; arr.pop(); }
  }
}
