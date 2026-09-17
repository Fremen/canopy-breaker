// ============================================================
// enemies.js — enemy archetypes + state-machine AI.
//
//   rifleman  — advances to range, telegraphs, fires bursts,
//               repositions; takes cover when wounded
//   strafer   — orbits the player firing on the move
//   grenadier — keeps distance, lobs grenades at your
//               PREDICTED position (leads your movement)
//   rusher    — charging melee: stalk → roar (telegraph) →
//               committed straight-line charge you can dodge
//   bunker    — stationary emplacement, armored front plate
//               (flank it or grenade it)
//   technical — vehicle-mounted MG patrolling waypoints
//
// Fairness rules enforced for every type:
//   • can only attack while on screen
//   • 0.4s of "reaction grace" after first becoming visible
//   • every dangerous attack telegraphs (aim glint, roar "!",
//     muzzle warn blink, grenade landing reticle)
// ============================================================

import { TAU, clamp, dist, angTo, angDiff, angApproach, norm, rand, spread, chance } from '../core/math.js';
import { difficulty } from '../core/settings.js';
import { Sfx } from '../core/audio.js';
import { rumble } from '../core/input.js';
import { spawnBullet } from './projectiles.js';
import { Grenade } from './grenades.js';
import { muzzleFlash, bloodPuff, dustPuff } from './particles.js';
import { drawSoldier, PALETTES } from './soldier.js';
import { spawnPickup } from './pickups.js';
import { PLAY_X0, PLAY_X1 } from './constants.js';

export const ENEMY_TYPES = {
  rifleman:  { hp: 26,  speed: 100, radius: 13, score: 100, pal: 'rifleman',
               drops: [['medal', 0.12], ['grenade', 0.06]] },
  strafer:   { hp: 40,  speed: 140, radius: 13, score: 150, pal: 'strafer',
               drops: [['medal', 0.18], ['rapid', 0.04]] },
  grenadier: { hp: 34,  speed: 88,  radius: 13, score: 200, pal: 'grenadier',
               drops: [['grenade', 0.35], ['medal', 0.10]] },
  rusher:    { hp: 18,  speed: 170, radius: 12, score: 120, pal: 'rusher',
               drops: [['medkit', 0.07], ['medal', 0.08]] },
  bunker:    { hp: 150, speed: 0,   radius: 30, score: 400,
               drops: [['medal_big', 1]] },
  technical: { hp: 280, speed: 120, radius: 34, score: 600,
               drops: [['medal_big', 1], ['spread', 0.5], ['shield', 0.25]] },
};

const ENEMY_BULLET_SPEED = 330;

export class Enemy {
  constructor(type, x, y, opts = {}) {
    const def = ENEMY_TYPES[type];
    this.type = type;
    this.def = def;
    this.x = x; this.y = y;
    this.radius = def.radius;
    this.hp = def.hp * difficulty().ehp;
    this.maxHp = this.hp;
    this.speed = def.speed;
    this.aim = Math.PI / 2;
    this.moveAng = Math.PI / 2;
    this.phase = rand(0, TAU);
    this.moving = false;
    this.flash = 0;
    this.dead = false;
    this.untargetable = false;
    this.kvx = 0; this.kvy = 0;       // explosion knockback
    this.visibleT = 0;                 // fairness reaction grace
    this.ambushT = opts.ambush ? 0.7 : 0; // "!" indicator
    this.state = opts.enter ? 'enter' : 'main';
    this.stateT = 0;
    this.enterTarget = opts.enter || null;
    this.cd = rand(0.3, 1.0);
    this.burst = 0;
    this.shotT = 0;
    this.strafeSign = chance(0.5) ? 1 : -1;
    this.strafeT = rand(1.2, 2.4);
    this.coverProp = null;
    this.chargeDir = 0;
    this.weave = rand(0, TAU);
    // bunker / technical extras
    this.facing = opts.facing ?? Math.PI / 2;
    this.turretAng = this.facing;
    this.waypoints = opts.waypoints || null;
    this.wpIndex = 0;
  }

  // ---------- shared helpers ----------

  canAct(game) {
    return game.camera.onScreen(this.y, -20) && this.visibleT > 0.4 && !game.player.dead;
  }

  moveToward(game, dt, tx, ty, speed) {
    const n = norm(tx - this.x, ty - this.y);
    if (n.l < 4) { this.moving = false; return true; }
    this.x += n.x * speed * dt;
    this.y += n.y * speed * dt;
    this.moveAng = Math.atan2(n.y, n.x);
    this.moving = true;
    this.phase += dt * 12;
    return n.l < speed * dt * 2;
  }

  separate(game, dt) {
    for (const o of game.enemies) {
      if (o === this || o.dead || o.type === 'technical') continue;
      const dx = this.x - o.x, dy = this.y - o.y;
      const d2 = dx * dx + dy * dy;
      const min = this.radius + o.radius + 4;
      if (d2 < min * min && d2 > 0.01) {
        const d = Math.sqrt(d2);
        this.x += (dx / d) * 60 * dt;
        this.y += (dy / d) * 60 * dt;
      }
    }
  }

  shootAt(game, tx, ty, opts = {}) {
    const a = angTo(this.x, this.y, tx, ty) + spread(opts.jitter ?? 0.05);
    const mx = this.x + Math.cos(a) * (this.radius + 8);
    const my = this.y + Math.sin(a) * (this.radius + 8) - 3;
    spawnBullet(game, mx, my, a, opts.speed ?? ENEMY_BULLET_SPEED,
      (opts.dmg ?? 8) * difficulty().edmg, false, { heavy: opts.heavy });
    muzzleFlash(game.fx, mx, my, a);
    if (opts.heavy) Sfx.heavyShoot(); else Sfx.enemyShoot();
    this.aim = a;
  }

  // ---------- damage / death ----------

  damage(game, dmg, ang, src) {
    if (this.dead) return;
    // Bunker front plate: bullets arriving against its facing are deflected.
    if (this.type === 'bunker' && src === 'bullet' &&
        Math.abs(angDiff(ang + Math.PI, this.facing)) < 1.05) {
      dmg *= 0.25;
      Sfx.bulletHit();
    }
    this.hp -= dmg;
    this.flash = 1;
    if (this.type !== 'bunker' && this.type !== 'technical') {
      bloodPuff(game.fx, this.x, this.y - 4, ang);
    }
    if (this.hp <= 0) this.die(game, src);
  }

  knockback(ang, force) {
    if (this.type === 'bunker' || this.type === 'technical') return;
    this.kvx += Math.cos(ang) * force;
    this.kvy += Math.sin(ang) * force;
  }

  die(game, src) {
    this.dead = true;
    game.onEnemyKilled(this, src);

    if (this.type === 'technical') {
      game.explode(this.x, this.y, { radius: 90, dmg: 55, hits: 'all' });
      game.terrain.paintWreck(this.x, this.y, this.moveAng);
      game.engine.addHitstop(0.06);
      game.camera.addShake(0.4);
    } else if (this.type === 'bunker') {
      game.explode(this.x, this.y, { radius: 70, dmg: 0, hits: 'none' });
      game.terrain.paintRubble(this.x, this.y, this.radius, [90, 88, 78]);
      game.engine.addHitstop(0.05);
    } else {
      // infantry: blood, popped helmet, persistent corpse decal
      bloodPuff(game.fx, this.x, this.y, rand(0, TAU));
      dustPuff(game.fx, this.x, this.y, 3);
      const pal = PALETTES[this.def.pal];
      game.fx.spawn({
        x: this.x, y: this.y - 10, z: 10, shape: 'rect',
        vx: spread(120), vy: spread(120), vz: rand(120, 220), grav: 520,
        life: rand(0.5, 0.9), size: 7,
        col0: hexToRgb(pal.helmet), rot: rand(0, TAU), vrot: spread(16),
      });
      game.terrain.paintCorpse(this.x, this.y, this.moveAng, pal);
      game.engine.addHitstop(0.02);
      Sfx.enemyDie();
    }

    for (const [type, p] of this.def.drops) {
      if (chance(p)) { spawnPickup(game, type, this.x + spread(14), this.y + spread(14)); break; }
    }
    rumble(0.2, 0.35, 80);
  }

  // ---------- per-frame ----------

  update(game, dt) {
    this.flash = Math.max(0, this.flash - dt * 6);
    this.stateT += dt;
    this.cd -= dt;
    this.ambushT = Math.max(0, this.ambushT - dt);
    if (game.camera.onScreen(this.y, -20)) this.visibleT += dt; else this.visibleT = 0;

    // knockback impulse decay
    this.x += this.kvx * dt; this.y += this.kvy * dt;
    this.kvx *= Math.max(0, 1 - 7 * dt);
    this.kvy *= Math.max(0, 1 - 7 * dt);

    this.moving = false;

    if (this.state === 'enter') {
      this.moveToward(game, dt, this.enterTarget.x, this.enterTarget.y, this.speed * 1.15);
      if (dist(this.x, this.y, this.enterTarget.x, this.enterTarget.y) < 20 || this.stateT > 3.5) {
        this.setState('main');
      }
    } else {
      switch (this.type) {
        case 'rifleman': this.updateRifleman(game, dt); break;
        case 'strafer': this.updateStrafer(game, dt); break;
        case 'grenadier': this.updateGrenadier(game, dt); break;
        case 'rusher': this.updateRusher(game, dt); break;
        case 'bunker': this.updateBunker(game, dt); break;
        case 'technical': this.updateTechnical(game, dt); break;
      }
    }

    if (this.type !== 'bunker' && this.type !== 'technical') {
      this.separate(game, dt);
      game.resolveSolids(this);
      // skip the playfield clamp while walking in from a flank spawn —
      // clamping would teleport the ambusher into view on frame one
      if (this.state !== 'enter') {
        this.x = clamp(this.x, PLAY_X0 + this.radius, PLAY_X1 - this.radius);
      }
    }

    // Scrolled far past → despawn quietly (no free kills, no unfair
    // shots). Margin must exceed every AI standoff ring (~470px) so
    // live combatants holding distance never vanish mid-fight.
    if (this.y > game.camera.y + game.camera.viewH + 520) this.dead = true;
  }

  setState(s, t = 0) { this.state = s; this.stateT = t; }

  facePlayer(game) {
    this.aim = angTo(this.x, this.y, game.player.x, game.player.y);
  }

  // ---------- rifleman ----------

  updateRifleman(game, dt) {
    const pl = game.player;
    switch (this.state) {
      case 'main':
      case 'reposition': {
        if (!this.goal || this.stateT === 0) {
          const dir = norm(this.x - pl.x, this.y - pl.y);
          const d = rand(230, 330);
          const tan = rand(-90, 90);
          this.goal = {
            x: clamp(pl.x + dir.x * d - dir.y * tan, PLAY_X0 + 30, PLAY_X1 - 30),
            y: pl.y + dir.y * d + dir.x * tan,
          };
        }
        this.facePlayer(game);
        const arrived = this.moveToward(game, dt, this.goal.x, this.goal.y, this.speed);
        if ((arrived || this.stateT > 2.4) && this.canAct(game)) {
          this.goal = null;
          // wounded? try cover or retreat
          if (this.hp < this.maxHp * 0.35) {
            const cover = findCover(game, this, pl);
            if (cover) { this.coverProp = cover; this.setState('tocover'); break; }
            if (chance(0.5)) { this.setState('retreat'); break; }
          }
          this.setState('aim');
        }
        break;
      }
      case 'aim':
        this.facePlayer(game);
        if (this.stateT > 0.45) { this.setState('fire'); this.burst = 3; this.shotT = 0; }
        break;
      case 'fire':
        this.shotT -= dt;
        if (this.shotT <= 0 && this.burst > 0) {
          if (this.canAct(game)) this.shootAt(game, game.player.x, game.player.y, { jitter: 0.07 });
          this.burst--;
          this.shotT = 0.13 / difficulty().erof;
        }
        if (this.burst <= 0) this.setState('reposition');
        break;
      case 'retreat': {
        const dir = norm(this.x - pl.x, this.y - pl.y);
        this.moveToward(game, dt, this.x + dir.x * 80, this.y + dir.y * 80, this.speed * 1.25);
        if (this.stateT > 1.1) this.setState('reposition');
        break;
      }
      case 'tocover': {
        if (!this.coverProp || this.coverProp.dead) { this.setState('reposition'); break; }
        const hp = hidePoint(this.coverProp, pl);
        if (this.moveToward(game, dt, hp.x, hp.y, this.speed * 1.2) || this.stateT > 2.2) {
          this.setState('covered');
        }
        break;
      }
      case 'covered':
        this.facePlayer(game);
        if (!this.coverProp || this.coverProp.dead) { this.setState('reposition'); break; }
        if (this.stateT > 0.8 && this.canAct(game)) this.setState('peek');
        break;
      case 'peek':
        this.facePlayer(game);
        if (this.stateT > 0.3) {
          if (this.canAct(game)) {
            this.shootAt(game, game.player.x, game.player.y, { jitter: 0.06 });
            this.shootAt(game, game.player.x, game.player.y, { jitter: 0.09 });
          }
          this.setState('covered');
        }
        break;
    }
  }

  // ---------- strafer ----------

  updateStrafer(game, dt) {
    const pl = game.player;
    this.facePlayer(game);
    const dir = norm(this.x - pl.x, this.y - pl.y);
    const d = dist(this.x, this.y, pl.x, pl.y);

    this.strafeT -= dt;
    if (this.strafeT <= 0) { this.strafeSign *= -1; this.strafeT = rand(1.3, 2.5); }

    // tangential strafe + spring toward preferred ring radius
    let tx = -dir.y * this.strafeSign, ty = dir.x * this.strafeSign;
    // flip early at playfield walls — only when strafing INTO the wall,
    // otherwise a wall-pinned strafer flips every frame and jitters
    if ((this.x < PLAY_X0 + 50 && tx < 0) || (this.x > PLAY_X1 - 50 && tx > 0)) {
      this.strafeSign *= -1; tx = -tx; ty = -ty;
      this.strafeT = rand(1.3, 2.5);
    }
    const ringErr = clamp((d - 290) / 120, -1, 1);
    let vx = tx * this.speed - dir.x * ringErr * this.speed * 0.8;
    let vy = ty * this.speed - dir.y * ringErr * this.speed * 0.8;
    this.x += vx * dt; this.y += vy * dt;
    this.moveAng = Math.atan2(vy, vx);
    this.moving = true;
    this.phase += dt * 12;

    if (this.cd <= 0 && this.canAct(game)) {
      // light prediction — leads the player's current velocity
      this.shootAt(game, pl.x + pl.velX * 0.3, pl.y + pl.velY * 0.3, { jitter: 0.05 });
      this.cd = rand(0.55, 0.85) / difficulty().erof;
    }
  }

  // ---------- grenadier ----------

  updateGrenadier(game, dt) {
    const pl = game.player;
    const d = dist(this.x, this.y, pl.x, pl.y);
    this.facePlayer(game);

    if (this.state === 'windup') {
      if (this.stateT > 0.75) {
        if (this.canAct(game)) {
          // predicted landing point: lead the player's velocity
          const flight = 0.95;
          let tx = pl.x + clamp(pl.velX * flight * 0.65, -130, 130);
          let ty = pl.y + clamp(pl.velY * flight * 0.65, -130, 130);
          tx = clamp(tx, PLAY_X0 + 10, PLAY_X1 - 10);
          game.grenades.push(new Grenade(this.x, this.y, tx, ty, false, {
            flight, radius: 80, dmg: 30 * difficulty().edmg,
          }));
          Sfx.grenadeThrow();
        }
        this.cd = rand(3.0, 3.8) / difficulty().erof;
        this.setState('main');
      }
      return;
    }

    if (d < 150) {
      // too close — panic and run
      const dir = norm(this.x - pl.x, this.y - pl.y);
      this.moveToward(game, dt, this.x + dir.x * 100, this.y + dir.y * 100, this.speed * 1.5);
    } else if (d < 330) {
      const dir = norm(this.x - pl.x, this.y - pl.y);
      this.moveToward(game, dt, this.x + dir.x * 60, this.y + dir.y * 60, this.speed);
    } else if (d > 470) {
      this.moveToward(game, dt, pl.x, pl.y, this.speed);
    } else {
      // hold the ring, drift sideways
      this.weave += dt;
      const dir = norm(pl.x - this.x, pl.y - this.y);
      this.x += -dir.y * Math.sin(this.weave * 1.4) * 40 * dt;
      this.y += dir.x * Math.sin(this.weave * 1.4) * 40 * dt;
      if (this.cd <= 0 && this.canAct(game)) this.setState('windup');
    }
  }

  // ---------- rusher ----------

  updateRusher(game, dt) {
    const pl = game.player;
    switch (this.state) {
      case 'main': { // stalk with weave
        this.weave += dt * 6;
        const n = norm(pl.x - this.x, pl.y - this.y);
        const wx = -n.y * Math.sin(this.weave) * 60;
        const wy = n.x * Math.sin(this.weave) * 60;
        this.moveToward(game, dt, pl.x + wx, pl.y + wy, this.speed);
        this.aim = this.moveAng;
        if (dist(this.x, this.y, pl.x, pl.y) < 150 && this.canAct(game)) {
          this.setState('roar');
          Sfx.melee();
        }
        break;
      }
      case 'roar': // telegraphed wind-up — "!" above head
        this.facePlayer(game);
        this.moveAng = this.aim;
        if (this.stateT > 0.38) {
          this.chargeDir = angTo(this.x, this.y, pl.x, pl.y); // committed direction
          this.setState('charge');
        }
        break;
      case 'charge': {
        const sp = 350;
        this.x += Math.cos(this.chargeDir) * sp * dt;
        this.y += Math.sin(this.chargeDir) * sp * dt;
        this.moveAng = this.aim = this.chargeDir;
        this.moving = true;
        this.phase += dt * 22;
        dustPuff(game.fx, this.x - Math.cos(this.chargeDir) * 10, this.y + 4, 1);
        if (!pl.dead && dist(this.x, this.y, pl.x, pl.y) < this.radius + pl.radius + 4) {
          pl.damage(game, 18 * difficulty().edmg);
          Sfx.melee();
          this.setState('recover');
        } else if (this.stateT > 0.55) {
          this.setState('recover');
        }
        break;
      }
      case 'recover':
        if (this.stateT > 0.55) this.setState('main');
        break;
    }
  }

  // ---------- bunker ----------

  updateBunker(game, dt) {
    const pl = game.player;
    const d = dist(this.x, this.y, pl.x, pl.y);
    const toPlayer = angTo(this.x, this.y, pl.x, pl.y);
    const inCone = Math.abs(angDiff(toPlayer, this.facing)) < 1.0;

    if (inCone && d < 560) {
      this.turretAng = angApproach(this.turretAng, toPlayer, 1.7 * dt);
    }
    this.aim = this.turretAng;

    switch (this.state) {
      case 'main':
        if (this.cd <= 0 && inCone && d < 540 && this.canAct(game) &&
            Math.abs(angDiff(this.turretAng, toPlayer)) < 0.25) {
          this.setState('warn');
        }
        break;
      case 'warn': // muzzle blink telegraph
        if (this.stateT > 0.5) { this.setState('burst'); this.burst = 5; this.shotT = 0; }
        break;
      case 'burst':
        this.shotT -= dt;
        if (this.shotT <= 0 && this.burst > 0) {
          if (this.canAct(game)) {
            const a = this.turretAng + spread(0.06);
            this.shootAt(game,
              this.x + Math.cos(a) * 100, this.y + Math.sin(a) * 100,
              { jitter: 0.03, dmg: 10, speed: 360, heavy: true });
          }
          this.burst--;
          this.shotT = 0.11 / difficulty().erof;
        }
        if (this.burst <= 0) { this.cd = 1.4 / difficulty().erof; this.setState('main'); }
        break;
    }
  }

  // ---------- technical (vehicle MG) ----------

  updateTechnical(game, dt) {
    const pl = game.player;
    if (this.waypoints && this.waypoints.length) {
      const wp = this.waypoints[this.wpIndex];
      if (this.moveToward(game, dt, wp.x, wp.y, this.speed)) {
        this.wpIndex = (this.wpIndex + 1) % this.waypoints.length;
      }
      this.phase += dt * this.speed * 0.06; // wheel/track animation
    }
    const d = dist(this.x, this.y, pl.x, pl.y);
    const toPlayer = angTo(this.x, this.y, pl.x, pl.y);
    this.turretAng = angApproach(this.turretAng, toPlayer, 2.2 * dt);
    this.aim = this.turretAng;

    if (this.hp < this.maxHp * 0.4 && chance(dt * 8)) {
      game.fx.spawn({
        x: this.x + spread(14), y: this.y + spread(10), vy: -30, vx: spread(10),
        life: rand(0.5, 1), size: 6, sizeEnd: 14,
        col0: [60, 58, 55], alpha: 0.5,
      });
    }

    switch (this.state) {
      case 'main':
        if (this.cd <= 0 && d < 560 && this.canAct(game)) this.setState('warn');
        break;
      case 'warn':
        if (this.stateT > 0.8) { this.setState('spray'); this.burst = 8; this.shotT = 0; }
        break;
      case 'spray':
        this.shotT -= dt;
        if (this.shotT <= 0 && this.burst > 0) {
          if (this.canAct(game)) {
            this.shootAt(game, pl.x + pl.velX * 0.25, pl.y + pl.velY * 0.25,
              { jitter: 0.13, dmg: 8, speed: 340, heavy: true });
          }
          this.burst--;
          this.shotT = 0.09 / difficulty().erof;
        }
        if (this.burst <= 0) { this.cd = 1.7 / difficulty().erof; this.setState('main'); }
        break;
    }
  }

  // ---------- rendering ----------

  draw(ctx, game) {
    if (this.type === 'bunker') { this.drawBunker(ctx, game); return; }
    if (this.type === 'technical') { this.drawTechnical(ctx, game); return; }

    // aim telegraph glint while winding up a shot
    if ((this.state === 'aim' || this.state === 'peek' || this.state === 'warn') && this.canAct(game)) {
      const t = clamp(this.stateT / 0.45, 0, 1);
      ctx.save();
      ctx.globalAlpha = 0.3 * t;
      ctx.strokeStyle = '#ff5040';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(this.x + Math.cos(this.aim) * 18, this.y + Math.sin(this.aim) * 18 - 3);
      ctx.lineTo(this.x + Math.cos(this.aim) * (30 + 40 * t), this.y + Math.sin(this.aim) * (30 + 40 * t) - 3);
      ctx.stroke();
      ctx.restore();
    }

    drawSoldier(ctx, {
      x: this.x, y: this.y,
      aim: this.aim, move: this.moveAng,
      phase: this.phase, moving: this.moving,
      pal: PALETTES[this.def.pal],
      flash: this.flash * 0.8,
      gunLen: this.type === 'rusher' ? 0 : 16,
      crouch: this.state === 'covered' || this.state === 'windup',
    });

    // "!" telegraph: rusher roar / ambush spawn
    if (this.state === 'roar' || this.ambushT > 0) {
      ctx.save();
      ctx.fillStyle = '#ff4a30';
      ctx.font = 'bold 18px "Arial Black", sans-serif';
      ctx.textAlign = 'center';
      const bounce = Math.abs(Math.sin(game.time * 10)) * 4;
      ctx.fillText('!', this.x, this.y - 30 - bounce);
      ctx.restore();
    }
  }

  drawBunker(ctx, game) {
    const x = this.x, y = this.y;
    ctx.save();
    ctx.translate(x, y);
    // sandbag skirt
    ctx.fillStyle = 'rgba(10,12,6,0.35)';
    ctx.beginPath(); ctx.ellipse(3, 8, 34, 16, 0, 0, TAU); ctx.fill();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      const g = ctx.createLinearGradient(0, -6, 0, 6);
      g.addColorStop(0, '#b3a075'); g.addColorStop(1, '#7d6c4a');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * 26, Math.sin(a) * 18 + 2, 9, 5.5, a, 0, TAU);
      ctx.fill();
    }
    // armored dome
    const g2 = ctx.createRadialGradient(-4, -10, 2, 0, -2, 26);
    g2.addColorStop(0, '#7c8068'); g2.addColorStop(1, '#43463a');
    ctx.fillStyle = g2;
    ctx.beginPath(); ctx.ellipse(0, -4, 21, 16, 0, 0, TAU); ctx.fill();
    // front plate marker (visual cue for the armored arc)
    ctx.strokeStyle = '#2c2e26'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(0, -4, 19, this.facing - 0.9, this.facing + 0.9); ctx.stroke();
    ctx.restore();

    // gun barrel + warn blink
    const bx = x + Math.cos(this.turretAng) * 16;
    const by = y - 4 + Math.sin(this.turretAng) * 12;
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(this.turretAng);
    ctx.fillStyle = '#1f1f1c';
    ctx.fillRect(0, -2.5, 24, 5);
    if (this.state === 'warn') {
      const blink = Math.sin(game.time * 24) > 0;
      if (blink) {
        ctx.fillStyle = '#ff6a30';
        ctx.beginPath(); ctx.arc(26, 0, 4, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();

    if (this.flash > 0) {
      ctx.globalAlpha = this.flash * 0.4;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(x, y - 4, 26, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    drawHpBar(ctx, x, y - 34, 44, this.hp / this.maxHp);
  }

  drawTechnical(ctx, game) {
    const x = this.x, y = this.y;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(10,12,6,0.35)';
    ctx.beginPath(); ctx.ellipse(3, 8, 38, 18, 0, 0, TAU); ctx.fill();
    ctx.rotate(this.moveAng);

    // wheels
    ctx.fillStyle = '#15140f';
    for (const wx of [-22, 16]) {
      ctx.fillRect(wx, -21, 14, 7);
      ctx.fillRect(wx, 14, 14, 7);
    }
    // truck bed + cab
    const g = ctx.createLinearGradient(0, -18, 0, 18);
    g.addColorStop(0, '#6e6a52'); g.addColorStop(1, '#45422f');
    ctx.fillStyle = g;
    ctx.fillRect(-32, -16, 64, 32);
    ctx.fillStyle = '#383525';
    ctx.fillRect(-32, -16, 22, 32);          // bed
    ctx.fillStyle = '#23211a';
    ctx.fillRect(14, -13, 16, 26);           // windshield block
    ctx.fillStyle = 'rgba(160,200,220,0.35)';
    ctx.fillRect(15, -11, 5, 22);
    ctx.restore();

    // gunner + mounted gun (world-rotation independent)
    const gx = x - Math.cos(this.moveAng) * 14;
    const gy = y - Math.sin(this.moveAng) * 14;
    ctx.save();
    ctx.translate(gx, gy - 8);
    ctx.rotate(this.turretAng);
    ctx.fillStyle = '#1c1c18';
    ctx.fillRect(2, -2.5, 30, 5);
    ctx.fillRect(-4, -5, 10, 10);
    if (this.state === 'warn' && Math.sin(game.time * 24) > 0) {
      ctx.fillStyle = '#ff6a30';
      ctx.beginPath(); ctx.arc(34, 0, 4, 0, TAU); ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = '#4d4135';
    ctx.beginPath(); ctx.arc(gx, gy - 14, 5, 0, TAU); ctx.fill();

    if (this.flash > 0) {
      ctx.globalAlpha = this.flash * 0.4;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(x, y, 38, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    drawHpBar(ctx, x, y - 34, 56, this.hp / this.maxHp);
  }
}

// ---------- helpers ----------

function drawHpBar(ctx, x, y, w, frac) {
  if (frac >= 1) return;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x - w / 2, y, w, 5);
  ctx.fillStyle = frac > 0.4 ? '#d8523a' : '#ff2e1a';
  ctx.fillRect(x - w / 2 + 1, y + 1, (w - 2) * clamp(frac, 0, 1), 3);
}

function findCover(game, e, pl) {
  let best = null, bestD = 260 * 260;
  for (const p of game.props) {
    if (p.dead || !p.solid || !p.blocksBullets || p.radius < 14) continue;
    if (p.type === 'tree') continue;
    const d2 = (p.x - e.x) ** 2 + (p.y - e.y) ** 2;
    if (d2 < bestD) { bestD = d2; best = p; }
  }
  return best;
}

function hidePoint(prop, pl) {
  const n = norm(prop.x - pl.x, prop.y - pl.y);
  return { x: prop.x + n.x * (prop.radius + 16), y: prop.y + n.y * (prop.radius + 16) };
}

function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function updateEnemies(game, dt) {
  const arr = game.enemies;
  for (let i = arr.length - 1; i >= 0; i--) {
    const e = arr[i];
    if (!e.dead) e.update(game, dt);
    if (e.dead) { arr[i] = arr[arr.length - 1]; arr.pop(); }
  }
}
