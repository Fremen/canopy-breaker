// ============================================================
// pickups.js — risk/reward drops.
//
// Pickups bob, glow, blink before despawning, and magnet to the
// player at close range. Crates and tough enemies drop them in
// the open — you have to step INTO the fight to collect, which
// is the aggression incentive the design calls for.
// ============================================================

import { TAU, dist2, rand, clamp } from '../core/math.js';
import { Sfx } from '../core/audio.js';
import { POWERUPS, PLAYER } from './constants.js';

const LIFETIME = 14;
const MAGNET_R2 = 34 * 34;

export const PICKUP_TYPES = {
  grenade: { score: 0, label: '+2 GRENADES' },
  medkit:  { score: 0, label: '+HEALTH' },
  spread:  { score: 0, label: 'SPREAD SHOT' },
  rapid:   { score: 0, label: 'RAPID FIRE' },
  shield:  { score: 0, label: 'SHIELD' },
  medal:   { score: 200, label: '+200' },
  medal_big: { score: 500, label: '+500' },
};

export function spawnPickup(game, type, x, y) {
  game.pickups.push({ type, x, y, life: LIFETIME, t: rand(0, TAU), dead: false });
}

export function updatePickups(game, dt) {
  const arr = game.pickups;
  const pl = game.player;
  for (let i = arr.length - 1; i >= 0; i--) {
    const p = arr[i];
    p.life -= dt;
    p.t += dt;
    if (p.life <= 0) p.dead = true;

    if (!p.dead && !pl.dead) {
      const d2 = dist2(p.x, p.y, pl.x, pl.y);
      if (d2 < MAGNET_R2 * 4) {
        // gentle pull inside double-magnet range
        const d = Math.sqrt(d2) || 1;
        const pull = d2 < MAGNET_R2 ? 260 : 60;
        p.x += ((pl.x - p.x) / d) * pull * dt;
        p.y += ((pl.y - p.y) / d) * pull * dt;
      }
      if (d2 < (pl.radius + 12) * (pl.radius + 12)) {
        collect(game, p);
        p.dead = true;
      }
    }
    if (p.dead) { arr[i] = arr[arr.length - 1]; arr.pop(); }
  }
}

function collect(game, p) {
  const pl = game.player;
  switch (p.type) {
    case 'grenade':
      pl.grenades = clamp(pl.grenades + 2, 0, PLAYER.grenadesMax);
      Sfx.pickup();
      break;
    case 'medkit':
      pl.hp = clamp(pl.hp + POWERUPS.medkitHeal, 0, PLAYER.hp);
      Sfx.pickup();
      break;
    case 'spread':
      pl.spreadTimer = POWERUPS.spreadTime;
      Sfx.powerup();
      break;
    case 'rapid':
      pl.rapidTimer = POWERUPS.rapidTime;
      Sfx.powerup();
      break;
    case 'shield':
      pl.shieldTimer = POWERUPS.shieldTime;
      Sfx.powerup();
      break;
    case 'medal':
    case 'medal_big':
      Sfx.medal();
      break;
  }
  const def = PICKUP_TYPES[p.type];
  if (def.score) game.score.addPoints(def.score);
  game.addPopup(def.label, p.x, p.y - 14, p.type.startsWith('medal') ? '#ffd24a' : '#bfe680');
}

// ---------- rendering ----------

export function drawPickups(game, ctx) {
  for (const p of game.pickups) {
    const bob = Math.sin(p.t * 3.2) * 3;
    const blink = p.life < 3 && Math.sin(p.t * 16) > 0;
    if (blink) continue;
    const x = p.x, y = p.y + bob;

    // ground shadow + glow halo
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(p.x, p.y + 8, 9, 4, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.5 + 0.2 * Math.sin(p.t * 5);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = glowColor(p.type);
    ctx.beginPath(); ctx.arc(x, y, 14, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    drawIcon(ctx, p.type, x, y);
  }
}

function glowColor(type) {
  switch (type) {
    case 'medkit': return 'rgba(255,90,90,0.25)';
    case 'shield': return 'rgba(90,170,255,0.3)';
    case 'medal': case 'medal_big': return 'rgba(255,210,74,0.3)';
    case 'grenade': return 'rgba(160,200,90,0.25)';
    default: return 'rgba(255,170,60,0.3)';
  }
}

function drawIcon(ctx, type, x, y) {
  ctx.save();
  ctx.translate(x, y);
  switch (type) {
    case 'grenade':
      ctx.fillStyle = '#4a5a2c';
      ctx.beginPath(); ctx.ellipse(0, 1, 6, 7, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#2b3318';
      ctx.fillRect(-2, -9, 4, 4);
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-6, 1); ctx.lineTo(6, 1); ctx.moveTo(0, -6); ctx.lineTo(0, 8); ctx.stroke();
      break;
    case 'medkit':
      ctx.fillStyle = '#f2f0e8';
      ctx.fillRect(-8, -6, 16, 13);
      ctx.fillStyle = '#d92f20';
      ctx.fillRect(-2, -4, 4, 9);
      ctx.fillRect(-5.5, -0.5, 11, 4);
      break;
    case 'spread':
      ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      for (const a of [-0.5, 0, 0.5]) {
        ctx.beginPath();
        ctx.moveTo(0, 6);
        ctx.lineTo(Math.sin(a) * 11, 6 - Math.cos(a) * 13);
        ctx.stroke();
      }
      break;
    case 'rapid':
      ctx.fillStyle = '#ffb13d';
      ctx.beginPath();
      ctx.moveTo(2, -9); ctx.lineTo(-5, 2); ctx.lineTo(-1, 2);
      ctx.lineTo(-2, 9); ctx.lineTo(5, -2); ctx.lineTo(1, -2);
      ctx.closePath(); ctx.fill();
      break;
    case 'shield':
      ctx.fillStyle = '#5aaaff';
      ctx.beginPath();
      ctx.moveTo(0, -8); ctx.lineTo(7, -5); ctx.lineTo(7, 2);
      ctx.quadraticCurveTo(7, 8, 0, 10);
      ctx.quadraticCurveTo(-7, 8, -7, 2);
      ctx.lineTo(-7, -5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#cfe7ff';
      ctx.fillRect(-1.5, -5, 3, 10);
      break;
    case 'medal':
    case 'medal_big': {
      const big = type === 'medal_big';
      ctx.fillStyle = big ? '#ffd24a' : '#e8b73a';
      star(ctx, 0, 0, big ? 9 : 7, big ? 4.5 : 3.5, 5);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath(); ctx.arc(-1.5, -1.5, 1.6, 0, TAU); ctx.fill();
      break;
    }
  }
  ctx.restore();
}

function star(ctx, x, y, ro, ri, n) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? ro : ri;
    const a = (i / (n * 2)) * TAU - Math.PI / 2;
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}
