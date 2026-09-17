// ============================================================
// player.js — the player controller. Everything here serves
// "immediate and precise": velocity is set directly from input
// (no acceleration curves), aim is decoupled from movement
// (mouse or right stick), and firing gives instant feedback
// (muzzle light, casing, tracer, tiny camera kick).
//
// Accessibility hooks: auto-fire (Settings.autoFire) and aim
// assist (gentle angular pull toward the best target in a
// narrow cone — never a lock-on).
// ============================================================

import { Input, rumble } from '../core/input.js';
import { Settings } from '../core/settings.js';
import { Sfx } from '../core/audio.js';
import { clamp, norm, angTo, angDiff, dist, spread, TAU } from '../core/math.js';
import { PLAYER, RIFLE, POWERUPS, GRENADE, PLAY_X0, PLAY_X1 } from './constants.js';
import { spawnBullet } from './projectiles.js';
import { Grenade } from './grenades.js';
import { muzzleFlash, shellCasing, dustPuff, sparkBurst, bloodPuff } from './particles.js';
import { drawSoldier, PALETTES } from './soldier.js';

export class Player {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.radius = PLAYER.radius;
    this.hp = PLAYER.hp;
    this.lives = PLAYER.lives;
    this.grenades = PLAYER.grenadesStart;
    this.aim = -Math.PI / 2;   // facing up-screen
    this.moveAng = -Math.PI / 2;
    this.phase = 0;
    this.moving = false;
    this.fireCd = 0;
    this.muzzleT = 0;
    this.invuln = 0;
    this.dead = false;
    this.respawnT = 0;
    this.spreadTimer = 0;
    this.rapidTimer = 0;
    this.shieldTimer = 0;
    this.flash = 0;
    this._dustT = 0;
    this.velX = 0;            // actual velocity (enemy AI leads this)
    this.velY = 0;
    this.movedDist = 0;       // tutorial: "you've learned to move"
  }

  update(game, dt) {
    this.fireCd -= dt;
    this.invuln -= dt;
    this.flash = Math.max(0, this.flash - dt * 6);
    this.muzzleT = Math.max(0, this.muzzleT - dt);
    this.spreadTimer = Math.max(0, this.spreadTimer - dt);
    this.rapidTimer = Math.max(0, this.rapidTimer - dt);
    this.shieldTimer = Math.max(0, this.shieldTimer - dt);

    if (this.dead) {
      this.respawnT -= dt;
      if (this.respawnT <= 0 && this.lives > 0) this.respawn(game);
      return;
    }

    // ---- movement: 8-direction, instant ----
    const prevX = this.x, prevY = this.y;
    const mv = Input.move;
    this.moving = Math.abs(mv.x) + Math.abs(mv.y) > 0.05;
    if (this.moving) {
      this.x += mv.x * PLAYER.speed * dt;
      this.y += mv.y * PLAYER.speed * dt;
      this.moveAng = Math.atan2(mv.y, mv.x);
      this.phase += dt * 13;
      this._dustT -= dt;
      if (this._dustT <= 0) {
        dustPuff(game.fx, this.x, this.y + 5, 1);
        this._dustT = 0.16;
      }
    }

    game.resolveSolids(this);

    // Keep the player inside the playfield and the visible window.
    const cam = game.camera;
    this.x = clamp(this.x, PLAY_X0 + this.radius, PLAY_X1 - this.radius);
    const yMin = cam.y + this.radius + 6;
    const yMax = cam.y + cam.viewH - this.radius - 6;
    this.y = clamp(this.y, yMin, yMax);

    // post-collision velocity, used by enemies that lead their shots
    this.velX = dt > 0 ? (this.x - prevX) / dt : 0;
    this.velY = dt > 0 ? (this.y - prevY) / dt : 0;
    this.movedDist += dist(prevX, prevY, this.x, this.y);

    // ---- aim: stick wins if active, else mouse world position ----
    if (Input.stickAim.active) {
      this.aim = Math.atan2(Input.stickAim.y, Input.stickAim.x);
    } else {
      const m = game.mouseWorld();
      this.aim = angTo(this.x, this.y, m.x, m.y);
    }

    // ---- rifle ----
    if ((Input.fireHeld || Settings.autoFire) && this.fireCd <= 0) {
      this.fire(game);
    }

    // ---- grenade ----
    if (Input.grenadeJust) {
      if (this.grenades > 0) this.throwGrenade(game);
      else { Sfx.dryFire(); game.addPopup('NO GRENADES', this.x, this.y - 28, '#ff9c8a'); }
    }
  }

  fire(game) {
    const rapid = this.rapidTimer > 0;
    const rof = RIFLE.rof * (rapid ? POWERUPS.rapidRofMult : 1);
    this.fireCd = 1 / rof;
    this.muzzleT = 0.05;

    const muzzleX = this.x + Math.cos(this.aim) * 22;
    const muzzleY = this.y + Math.sin(this.aim) * 22 - 3;

    const shots = this.spreadTimer > 0 ? POWERUPS.spreadShots : 1;
    const arc = this.spreadTimer > 0 ? POWERUPS.spreadArc : 0;
    const dmg = this.spreadTimer > 0 ? POWERUPS.spreadDmg : RIFLE.dmg;

    for (let i = 0; i < shots; i++) {
      let a = this.aim + (shots > 1 ? (i / (shots - 1) - 0.5) * arc : 0) + spread(RIFLE.jitter);
      a = this.applyAimAssist(game, a);
      spawnBullet(game, muzzleX, muzzleY, a, RIFLE.speed, dmg, true);
    }
    game.score.registerShots(shots);

    muzzleFlash(game.fx, muzzleX, muzzleY, this.aim);
    shellCasing(game.fx, this.x + Math.cos(this.aim) * 10, this.y + Math.sin(this.aim) * 10 - 4, this.aim);
    Sfx.shoot();
    game.camera.addShake(0.018);
  }

  // Gentle pull toward the best enemy within a narrow cone.
  applyAimAssist(game, a) {
    if (!Settings.aimAssist) return a;
    let best = null, bestScore = Infinity;
    const consider = (x, y) => {
      const d = dist(this.x, this.y, x, y);
      if (d > 640) return;
      const off = Math.abs(angDiff(a, angTo(this.x, this.y, x, y)));
      if (off > 0.24) return;
      const s = off * 2 + d / 640;
      if (s < bestScore) { bestScore = s; best = { x, y }; }
    };
    for (const e of game.enemies) if (!e.dead && !e.untargetable) consider(e.x, e.y);
    if (game.boss && !game.boss.dead) consider(game.boss.x, game.boss.y);
    if (!best) return a;
    return a + angDiff(a, angTo(this.x, this.y, best.x, best.y)) * 0.45;
  }

  throwGrenade(game) {
    this.grenades--;
    let tx, ty;
    if (Input.stickAim.active || Input.usingGamepad) {
      tx = this.x + Math.cos(this.aim) * 320;
      ty = this.y + Math.sin(this.aim) * 320;
    } else {
      const m = game.mouseWorld();
      const d = clamp(dist(this.x, this.y, m.x, m.y), GRENADE.rangeMin, GRENADE.rangeMax);
      tx = this.x + Math.cos(this.aim) * d;
      ty = this.y + Math.sin(this.aim) * d;
    }
    game.grenades.push(new Grenade(this.x, this.y, tx, ty, true));
    game.score.registerGrenade();
    Sfx.grenadeThrow();
  }

  damage(game, dmg) {
    if (this.dead || this.invuln > 0) return;
    if (this.shieldTimer > 0) {
      sparkBurst(game.fx, this.x, this.y, 6);
      Sfx.bulletHit();
      return;
    }
    this.hp -= dmg;
    this.flash = 1;
    this.invuln = PLAYER.hurtInvuln;
    game.damageFlash = 0.35;
    game.camera.addShake(0.3);
    bloodPuff(game.fx, this.x, this.y, Math.random() * TAU);
    Sfx.hurt();
    if (Settings.rumble) rumble(0.7, 0.4, 200);
    if (this.hp <= 0) this.die(game);
  }

  die(game) {
    this.dead = true;
    this.hp = 0;
    this.lives--;
    this.respawnT = 1.8;
    this.spreadTimer = this.rapidTimer = this.shieldTimer = 0;
    game.score.breakCombo();
    game.camera.addShake(0.6);
    game.engine.addHitstop(0.12);
    for (let i = 0; i < 3; i++) bloodPuff(game.fx, this.x + spread(8), this.y + spread(8), Math.random() * TAU);
    dustPuff(game.fx, this.x, this.y, 8);
    game.terrain.paintCorpse(this.x, this.y, this.moveAng, PALETTES.player);
    Sfx.explosion(false);
    if (Settings.rumble) rumble(1, 1, 400);
    if (this.lives <= 0) game.onGameOver();
  }

  respawn(game) {
    const cam = game.camera;
    this.dead = false;
    this.hp = PLAYER.hp;
    this.grenades = Math.max(this.grenades, 2);
    this.invuln = PLAYER.respawnInvuln;
    this.x = (PLAY_X0 + PLAY_X1) / 2;
    this.y = cam.y + cam.viewH * 0.8;
    game.resolveSolids(this);
  }

  draw(game, ctx) {
    if (this.dead) return;
    // invulnerability flicker
    if (this.invuln > 0 && Math.sin(game.time * 26) > 0) ctx.globalAlpha = 0.45;

    // subtle aim direction line (readability helper)
    ctx.save();
    ctx.globalAlpha *= 0.14;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 6]);
    ctx.beginPath();
    ctx.moveTo(this.x + Math.cos(this.aim) * 24, this.y + Math.sin(this.aim) * 24 - 3);
    ctx.lineTo(this.x + Math.cos(this.aim) * 64, this.y + Math.sin(this.aim) * 64 - 3);
    ctx.stroke();
    ctx.restore();

    drawSoldier(ctx, {
      x: this.x, y: this.y,
      aim: this.aim, move: this.moveAng,
      phase: this.phase, moving: this.moving,
      pal: PALETTES.player, flash: this.flash * 0.7,
      gunLen: 18,
    });

    // muzzle glow light
    if (this.muzzleT > 0) {
      const mx = this.x + Math.cos(this.aim) * 24;
      const my = this.y + Math.sin(this.aim) * 24 - 3;
      const g = ctx.createRadialGradient(mx, my, 0, mx, my, 38);
      g.addColorStop(0, 'rgba(255,220,130,0.5)');
      g.addColorStop(1, 'rgba(255,220,130,0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(mx, my, 38, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }

    // shield bubble
    if (this.shieldTimer > 0) {
      const blink = this.shieldTimer < 1.5 ? (Math.sin(game.time * 18) > 0 ? 0.4 : 1) : 1;
      ctx.globalAlpha = 0.35 * blink;
      const g = ctx.createRadialGradient(this.x, this.y - 4, 6, this.x, this.y - 4, 24);
      g.addColorStop(0, 'rgba(120,190,255,0)');
      g.addColorStop(0.8, 'rgba(120,190,255,0.35)');
      g.addColorStop(1, 'rgba(180,225,255,0.8)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(this.x, this.y - 4, 24, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
