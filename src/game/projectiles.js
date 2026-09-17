// ============================================================
// projectiles.js — bullets for both sides.
//
// Fairness + readability rules baked in here:
//  • Player bullets: fast thin tracers (you shouldn't watch
//    your own shots, you should watch enemies).
//  • Enemy bullets: slower glowing orbs — always dodgeable,
//    always visible, bigger/brighter in high-contrast mode.
//  • Solid cover blocks bullets for BOTH sides, so sandbags
//    matter to the player and to enemy AI equally.
// Fast bullets are swept in sub-steps so they can't tunnel
// through a soldier between frames.
// ============================================================

import { circleHit, TAU } from '../core/math.js';
import { Settings } from '../core/settings.js';
import { bulletImpact, sparkBurst } from './particles.js';
import { PLAY_X0, PLAY_X1 } from './constants.js';

export function spawnBullet(game, x, y, ang, speed, dmg, friendly, opts = {}) {
  game.bullets.push({
    x, y,
    vx: Math.cos(ang) * speed,
    vy: Math.sin(ang) * speed,
    ang, dmg, friendly,
    life: opts.life ?? 1.6,
    heavy: !!opts.heavy,       // bunker/vehicle rounds: bigger visual
    dead: false,
  });
}

export function updateBullets(game, dt) {
  const arr = game.bullets;
  for (let i = arr.length - 1; i >= 0; i--) {
    const b = arr[i];
    b.life -= dt;
    if (b.life <= 0) b.dead = true;

    if (!b.dead) {
      // Sub-step sweep: max ~10px per collision check.
      const dx = b.vx * dt, dy = b.vy * dt;
      const distance = Math.hypot(dx, dy);
      const steps = Math.min(6, Math.max(1, Math.ceil(distance / 10)));
      for (let s = 0; s < steps && !b.dead; s++) {
        b.x += dx / steps;
        b.y += dy / steps;
        collideBullet(game, b);
      }
      // Leave the playfield → gone (jungle walls eat bullets).
      if (b.x < PLAY_X0 - 18 || b.x > PLAY_X1 + 18) b.dead = true;
    }

    if (b.dead) { arr[i] = arr[arr.length - 1]; arr.pop(); }
  }
}

function collideBullet(game, b) {
  // Solid props stop everything (cover!).
  for (const p of game.props) {
    if (p.dead || !p.blocksBullets) continue;
    if (circleHit(b.x, b.y, 1, p.x, p.y, p.radius)) {
      if (p.destructible) p.damage(game, b.dmg, b.ang);
      bulletImpact(game.fx, b.x, b.y, b.ang);
      b.dead = true;
      return;
    }
  }

  if (b.friendly) {
    for (const e of game.enemies) {
      if (e.dead || e.untargetable) continue;
      if (circleHit(b.x, b.y, 2, e.x, e.y, e.radius)) {
        e.damage(game, b.dmg, b.ang, 'bullet');
        game.score.registerHit();
        game.onShotConnected();
        b.dead = true;
        return;
      }
    }
    if (game.boss && !game.boss.dead &&
        circleHit(b.x, b.y, 2, game.boss.x, game.boss.y, game.boss.radius)) {
      game.boss.damage(game, b.dmg, b.ang, 'bullet');
      game.score.registerHit();
      game.onShotConnected();
      sparkBurst(game.fx, b.x, b.y, 3);
      b.dead = true;
      return;
    }
  } else {
    const pl = game.player;
    if (!pl.dead && circleHit(b.x, b.y, 3, pl.x, pl.y, pl.radius)) {
      pl.damage(game, b.dmg);
      b.dead = true;
    }
  }
}

export function drawBullets(game, ctx) {
  const hc = Settings.highContrast;
  for (const b of game.bullets) {
    if (b.friendly) {
      // thin hot tracer
      const tx = b.x - b.vx * 0.016, ty = b.y - b.vy * 0.016;
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(255,235,150,0.95)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.fillStyle = '#fff7d0';
      ctx.beginPath(); ctx.arc(b.x, b.y, 1.8, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    } else {
      // glowing orb, deliberately slower + larger
      const r = (b.heavy ? 5.5 : 4) * (hc ? 1.5 : 1);
      if (hc) {
        // dark backing ring must render BEFORE switching to additive
        // blending (black is invisible in 'lighter' mode)
        ctx.fillStyle = 'rgba(0,0,0,0.9)';
        ctx.beginPath(); ctx.arc(b.x, b.y, r + 2.5, 0, TAU); ctx.fill();
      }
      ctx.globalCompositeOperation = 'lighter';
      if (hc) {
        ctx.fillStyle = '#ff35e8';
      } else {
        ctx.fillStyle = 'rgba(255,90,40,0.35)';
        ctx.beginPath(); ctx.arc(b.x, b.y, r + 4, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ff7840';
      }
      ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(b.x, b.y, r * 0.45, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
  }
}
