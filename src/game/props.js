// ============================================================
// props.js — world objects: cover, destructibles, hostages.
//
// Props are circles for physics but rich vector art for
// rendering. The important design rule: SOLID props block
// bullets for both sides, so sandbags/rocks/crates are real
// tactical cover; barrels and crates are the risk/reward layer
// (barrels chain-explode, crates drop pickups).
//
// Captive scouts ("hostages") are original to this game: allied
// recon soldiers in orange vests tied to a stake — walk up to
// free them for a big score bonus and a grenade resupply.
// ============================================================

import { TAU, rand, spread, chance, circleHit } from '../core/math.js';
import { Sfx } from '../core/audio.js';
import { dustPuff, leafBurst, sparkBurst } from './particles.js';
import { spawnPickup } from './pickups.js';
import { drawSoldier } from './soldier.js';
import { SCORING } from './constants.js';

const DEFS = {
  tree:    { radius: 9,  solid: true,  blocksBullets: true,  hp: Infinity },
  rock:    { radius: 17, solid: true,  blocksBullets: true,  hp: Infinity },
  barrel:  { radius: 11, solid: true,  blocksBullets: true,  hp: 16 },
  crate:   { radius: 15, solid: true,  blocksBullets: true,  hp: 22 },
  sandbag: { radius: 20, solid: true,  blocksBullets: true,  hp: 80 },
  fence:   { radius: 14, solid: true,  blocksBullets: true,  hp: 24 },
  tent:    { radius: 30, solid: true,  blocksBullets: true,  hp: 90 },
  tower:   { radius: 22, solid: true,  blocksBullets: true,  hp: Infinity },
  wall:    { radius: 20, solid: true,  blocksBullets: true,  hp: Infinity },
  stake:   { radius: 5,  solid: false, blocksBullets: false, hp: Infinity },
};

const LOOT_TABLE = [
  ['grenade', 0.24], ['medkit', 0.20], ['medal', 0.16], ['medal_big', 0.10],
  ['spread', 0.12], ['rapid', 0.12], ['shield', 0.06],
];

function rollLoot() {
  let r = Math.random(), acc = 0;
  for (const [type, w] of LOOT_TABLE) {
    acc += w;
    if (r < acc) return type;
  }
  return 'medal';
}

export class Prop {
  constructor(type, x, y, opts = {}) {
    const def = DEFS[type];
    this.type = type;
    this.x = x; this.y = y;
    this.radius = opts.radius ?? def.radius;
    this.hp = opts.hp ?? def.hp;
    this.maxHp = this.hp;
    this.solid = def.solid;
    this.blocksBullets = def.blocksBullets;
    this.destructible = isFinite(this.hp);
    this.loot = opts.loot; // crates: fixed loot type, else rolled
    this.vert = !!opts.vert;
    this.canopy = type === 'tree' ? (opts.canopy ?? rand(34, 52)) : 0;
    this.seed = rand(0, TAU);
    this.flash = 0;
    this.dead = false;
  }

  damage(game, dmg, ang) {
    if (!this.destructible || this.dead) return;
    this.hp -= dmg;
    this.flash = 1;
    if (this.type === 'tree') leafBurst(game.fx, this.x, this.y - 10);
    if (this.hp <= 0) this.die(game, ang);
  }

  die(game, ang = 0) {
    if (this.dead) return;
    this.dead = true;
    switch (this.type) {
      case 'barrel':
        // chain-reaction fuel barrel
        game.explode(this.x, this.y, { radius: 85, dmg: 70, hits: 'all' });
        break;
      case 'crate': {
        woodBurst(game, this.x, this.y);
        spawnPickup(game, this.loot ?? rollLoot(), this.x, this.y);
        Sfx.bulletHit();
        break;
      }
      case 'sandbag':
        dustPuff(game.fx, this.x, this.y, 10);
        game.terrain.paintRubble(this.x, this.y, this.radius, [120, 105, 70]);
        break;
      case 'fence':
        woodBurst(game, this.x, this.y);
        break;
      case 'tent':
        dustPuff(game.fx, this.x, this.y, 12);
        game.terrain.paintRubble(this.x, this.y, this.radius, [70, 72, 52]);
        break;
    }
  }

  update(game, dt) {
    this.flash = Math.max(0, this.flash - dt * 6);
  }

  // y-sorted entity layer
  draw(ctx, game) {
    const t = game.time + this.seed;
    ctx.save();
    ctx.translate(this.x, this.y);
    switch (this.type) {
      case 'tree': drawTrunk(ctx); break;
      case 'rock': drawRock(ctx, this.seed); break;
      case 'barrel': drawBarrel(ctx, this.hp / this.maxHp); break;
      case 'crate': drawCrate(ctx); break;
      case 'sandbag': drawSandbags(ctx, this.vert, this.hp / this.maxHp, this.seed); break;
      case 'fence': drawFence(ctx, this.vert); break;
      case 'tent': drawTent(ctx); break;
      case 'tower': drawTowerBase(ctx); break;
      case 'wall': drawWall(ctx, this.vert); break;
      case 'stake': drawStake(ctx); break;
    }
    if (this.flash > 0 && this.destructible) {
      ctx.globalAlpha = this.flash * 0.5;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(0, 0, this.radius + 3, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  // canopy / overhead layer
  drawOver(ctx, game) {
    if (this.type === 'tree') drawCanopy(ctx, this.x, this.y, this.canopy, this.seed, game.time);
    else if (this.type === 'tower') drawTowerTop(ctx, this.x, this.y);
  }
}

function woodBurst(game, x, y) {
  for (let i = 0; i < 8; i++) {
    game.fx.spawn({
      x, y, z: 6, shape: 'rect',
      vx: spread(170), vy: spread(170), vz: rand(60, 200), grav: 500,
      life: rand(0.4, 0.8), size: rand(3, 7),
      col0: [150, 112, 60], col1: [100, 75, 40],
      rot: rand(0, TAU), vrot: spread(14),
    });
  }
  dustPuff(game.fx, x, y, 4);
}

// ---------- prop art ----------

function drawTrunk(ctx) {
  ctx.fillStyle = 'rgba(10,12,6,0.3)';
  ctx.beginPath(); ctx.ellipse(2, 4, 10, 5, 0, 0, TAU); ctx.fill();
  const g = ctx.createLinearGradient(-7, 0, 7, 0);
  g.addColorStop(0, '#4a3a26'); g.addColorStop(0.5, '#6b563a'); g.addColorStop(1, '#3a2d1e');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, 8, 0, TAU); ctx.fill();
}

function drawCanopy(ctx, x, y, r, seed, time) {
  const sway = Math.sin(time * 0.7 + seed) * 2;
  ctx.save();
  ctx.translate(x + sway, y - 26);
  // layered leaf blobs, slightly transparent so action reads through
  ctx.globalAlpha = 0.92;
  for (const [dr, col] of [[1, '#2c4220'], [0.72, '#39562a'], [0.45, '#4a6c34']]) {
    ctx.fillStyle = col;
    ctx.beginPath();
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + seed;
      const rr = r * dr * (0.82 + 0.18 * Math.sin(seed * 3 + i * 2.1));
      ctx.ellipse(Math.cos(a) * rr * 0.55, Math.sin(a) * rr * 0.38, rr * 0.5, rr * 0.34, a, 0, TAU);
    }
    ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  // canopy ground shadow
  ctx.fillStyle = 'rgba(8,12,4,0.18)';
  ctx.beginPath(); ctx.ellipse(x + 6, y + 8, r * 0.8, r * 0.45, 0, 0, TAU); ctx.fill();
}

function drawRock(ctx, seed) {
  ctx.fillStyle = 'rgba(10,12,6,0.3)';
  ctx.beginPath(); ctx.ellipse(3, 5, 17, 8, 0, 0, TAU); ctx.fill();
  const g = ctx.createLinearGradient(-12, -14, 10, 10);
  g.addColorStop(0, '#9a948a'); g.addColorStop(1, '#5d584f');
  ctx.fillStyle = g;
  ctx.beginPath();
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU;
    const rr = 16 * (0.8 + 0.25 * Math.sin(seed + i * 2.7));
    const px = Math.cos(a) * rr, py = Math.sin(a) * rr * 0.78 - 4;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath(); ctx.ellipse(-4, -9, 7, 4, -0.4, 0, TAU); ctx.fill();
}

function drawBarrel(ctx, hpFrac) {
  ctx.fillStyle = 'rgba(10,12,6,0.3)';
  ctx.beginPath(); ctx.ellipse(2, 4, 12, 6, 0, 0, TAU); ctx.fill();
  const g = ctx.createLinearGradient(-10, 0, 10, 0);
  g.addColorStop(0, '#7e2018'); g.addColorStop(0.4, '#b03326'); g.addColorStop(1, '#5d150f');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-9, -12); ctx.lineTo(9, -12); ctx.lineTo(10, 8); ctx.lineTo(-10, 8);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#c8402f';
  ctx.beginPath(); ctx.ellipse(0, -12, 9, 4, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#88281c';
  ctx.beginPath(); ctx.ellipse(0, -12, 5.5, 2.4, 0, 0, TAU); ctx.fill();
  // hazard stripe
  ctx.fillStyle = '#e8c93d';
  ctx.fillRect(-9.5, -4, 19, 3.5);
  if (hpFrac < 0.6) { // dented when damaged
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(3, -2, 4, 5, 0.5, 0, TAU); ctx.fill();
  }
}

function drawCrate(ctx) {
  ctx.fillStyle = 'rgba(10,12,6,0.3)';
  ctx.beginPath(); ctx.ellipse(3, 6, 16, 7, 0, 0, TAU); ctx.fill();
  const g = ctx.createLinearGradient(0, -14, 0, 12);
  g.addColorStop(0, '#a3814f'); g.addColorStop(1, '#6e5433');
  ctx.fillStyle = g;
  ctx.fillRect(-13, -13, 26, 24);
  ctx.strokeStyle = '#4d3a22'; ctx.lineWidth = 2;
  ctx.strokeRect(-13, -13, 26, 24);
  ctx.beginPath();
  ctx.moveTo(-13, -13); ctx.lineTo(13, 11); ctx.moveTo(13, -13); ctx.lineTo(-13, 11);
  ctx.stroke();
  ctx.fillStyle = '#3a2c18';
  ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
  ctx.fillText('+', 0, 2);
}

function drawSandbags(ctx, vert, hpFrac, seed) {
  ctx.save();
  if (vert) ctx.rotate(Math.PI / 2);
  ctx.fillStyle = 'rgba(10,12,6,0.3)';
  ctx.beginPath(); ctx.ellipse(2, 7, 24, 8, 0, 0, TAU); ctx.fill();
  const rows = hpFrac > 0.5 ? 2 : 1; // top row blown off when damaged
  for (let row = rows - 1; row >= 0; row--) {
    for (let i = -1; i <= 1; i++) {
      const bx = i * 15 + (row === 0 ? 0 : 7) + Math.sin(seed + i) * 1.5;
      const by = 4 - row * 9;
      const g = ctx.createLinearGradient(bx, by - 6, bx, by + 6);
      g.addColorStop(0, row === rows - 1 ? '#c4ad7a' : '#a8946a');
      g.addColorStop(1, '#7d6c4a');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(bx, by, 9.5, 5.5, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(60,50,30,0.5)'; ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawFence(ctx, vert) {
  ctx.save();
  if (vert) ctx.rotate(Math.PI / 2);
  ctx.fillStyle = 'rgba(10,12,6,0.25)';
  ctx.beginPath(); ctx.ellipse(1, 5, 16, 5, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#6e5a38';
  ctx.fillRect(-15, -3, 30, 4);   // rails
  ctx.fillRect(-15, -10, 30, 4);
  ctx.fillStyle = '#5a4830';
  for (const px of [-12, 0, 12]) ctx.fillRect(px - 2, -14, 4, 20); // posts
  ctx.restore();
}

function drawTent(ctx) {
  ctx.fillStyle = 'rgba(10,12,6,0.3)';
  ctx.beginPath(); ctx.ellipse(4, 12, 34, 12, 0, 0, TAU); ctx.fill();
  const g = ctx.createLinearGradient(0, -30, 0, 16);
  g.addColorStop(0, '#7a7c58'); g.addColorStop(1, '#4d503a');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-30, 14); ctx.lineTo(0, -26); ctx.lineTo(30, 14);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#3a3c2a'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, -26); ctx.lineTo(0, 14); ctx.stroke();
  ctx.fillStyle = 'rgba(20,22,14,0.85)';
  ctx.beginPath();
  ctx.moveTo(-9, 14); ctx.lineTo(0, -2); ctx.lineTo(9, 14);
  ctx.closePath(); ctx.fill();
}

function drawTowerBase(ctx) {
  ctx.fillStyle = 'rgba(10,12,6,0.3)';
  ctx.beginPath(); ctx.ellipse(3, 6, 26, 10, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#5a4830'; ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-18, 8); ctx.lineTo(-12, -34);
  ctx.moveTo(18, 8); ctx.lineTo(12, -34);
  ctx.moveTo(-16, -8); ctx.lineTo(16, -2);
  ctx.moveTo(16, -8); ctx.lineTo(-16, -2);
  ctx.stroke();
}

function drawTowerTop(ctx, x, y) {
  ctx.save();
  ctx.translate(x, y - 44);
  ctx.fillStyle = 'rgba(8,10,4,0.25)';
  ctx.beginPath(); ctx.ellipse(8, 52, 30, 10, 0, 0, TAU); ctx.fill();
  const g = ctx.createLinearGradient(0, -14, 0, 10);
  g.addColorStop(0, '#7d6a48'); g.addColorStop(1, '#55482f');
  ctx.fillStyle = g;
  ctx.fillRect(-22, -8, 44, 18);
  ctx.fillStyle = '#3f3522';
  ctx.fillRect(-22, -12, 44, 5);
  // roof
  ctx.fillStyle = '#4d503a';
  ctx.beginPath();
  ctx.moveTo(-26, -12); ctx.lineTo(0, -30); ctx.lineTo(26, -12);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawWall(ctx, vert) {
  ctx.save();
  if (vert) ctx.rotate(Math.PI / 2);
  ctx.fillStyle = 'rgba(10,12,6,0.3)';
  ctx.beginPath(); ctx.ellipse(2, 8, 24, 8, 0, 0, TAU); ctx.fill();
  // palisade logs
  for (let i = -2; i <= 2; i++) {
    const g = ctx.createLinearGradient(i * 9 - 4, 0, i * 9 + 4, 0);
    g.addColorStop(0, '#6b563a'); g.addColorStop(0.5, '#82684a'); g.addColorStop(1, '#4a3a26');
    ctx.fillStyle = g;
    ctx.fillRect(i * 9 - 4, -22 - (i % 2) * 4, 8, 30 + (i % 2) * 4);
    ctx.beginPath();
    ctx.moveTo(i * 9 - 4, -22 - (i % 2) * 4);
    ctx.lineTo(i * 9, -29 - (i % 2) * 4);
    ctx.lineTo(i * 9 + 4, -22 - (i % 2) * 4);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

function drawStake(ctx) {
  ctx.fillStyle = '#4a3a26';
  ctx.fillRect(-3, -22, 6, 26);
  ctx.fillStyle = '#352a1c';
  ctx.fillRect(-3, -22, 6, 4);
}

// ============================================================
// Hostages — captive allied scouts.
// ============================================================

const HOSTAGE_PAL = {
  uniform: '#b06a28', uniformDark: '#7d4a1c', helmet: '#8a5a24',
  skin: '#d9a878', vest: '#d98a30', gun: '#000',
};

export class Hostage {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.radius = 12;
    this.freed = false;
    this.phase = 0;
    this.dead = false; // removed after running off
  }

  update(game, dt) {
    if (!this.freed) {
      const pl = game.player;
      if (!pl.dead && circleHit(this.x, this.y, this.radius + 26, pl.x, pl.y, pl.radius)) {
        this.freed = true;
        Sfx.rescue();
        game.score.addRescue();
        game.score.addPoints(SCORING.rescueBonus);
        game.addPopup('SCOUT RESCUED!', this.x, this.y - 34, '#ffd24a');
        spawnPickup(game, 'grenade', this.x + spread(20), this.y + 18);
      }
      return;
    }
    // freed: sprint down-screen to safety (respecting walls and the
    // river like every other entity — no clipping through the camp
    // palisade in full view)
    this.phase += dt * 13;
    this.y += 200 * dt;
    this.x += Math.sin(this.phase * 0.4) * 30 * dt;
    game.resolveSolids(this);
    if (this.y > game.camera.y + game.camera.viewH + 80) this.dead = true;
  }

  draw(ctx, game) {
    if (!this.freed) {
      // kneeling, hands bound — pulsing glow ring marks the objective
      const pulse = 0.5 + 0.5 * Math.sin(game.time * 4);
      ctx.save();
      ctx.globalAlpha = 0.25 + 0.2 * pulse;
      ctx.strokeStyle = '#ffd24a';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(this.x, this.y, 24 + pulse * 4, 0, TAU); ctx.stroke();
      ctx.restore();

      drawSoldier(ctx, {
        x: this.x, y: this.y + 3,
        aim: Math.PI / 2, move: Math.PI / 2,
        phase: 0, moving: false,
        pal: HOSTAGE_PAL, flash: 0,
        gunLen: 0, crouch: true, scale: 0.95,
      });
      // rope
      ctx.strokeStyle = '#c8b88a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(this.x, this.y - 1, 9, -0.6, Math.PI + 0.6); ctx.stroke();
    } else {
      drawSoldier(ctx, {
        x: this.x, y: this.y,
        aim: Math.PI / 2, move: Math.PI / 2,
        phase: this.phase, moving: true,
        pal: HOSTAGE_PAL, flash: 0, gunLen: 0,
      });
    }
  }
}

// Push a circular entity out of all solid props (cheap and stable).
export function resolveEntityVsProps(game, ent) {
  for (const p of game.props) {
    if (p.dead || !p.solid) continue;
    const dx = ent.x - p.x, dy = ent.y - p.y;
    const rr = ent.radius + p.radius;
    const d2 = dx * dx + dy * dy;
    if (d2 < rr * rr && d2 > 0.0001) {
      const d = Math.sqrt(d2);
      ent.x = p.x + (dx / d) * rr;
      ent.y = p.y + (dy / d) * rr;
    }
  }
}
