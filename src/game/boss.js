// ============================================================
// boss.js — "WARLORD", the armored patrol vehicle mini-boss.
//
// Three phases by remaining hull:
//   P1 (>66%): turret MG — aimed bursts and sweeping fans
//   P2 (>33%): + mortar volleys (telegraphed landing reticles)
//   P3:        + ramming charge across the arena; slamming the
//              wall stuns it and opens a 1.5× damage window
// It also calls in infantry support. Every attack telegraphs:
// turret glow before bursts, reticles before mortars, engine
// rev + exhaust before the ram.
// ============================================================

import { TAU, clamp, rand, spread, angTo, angApproach, norm, dist, chance, pick } from '../core/math.js';
import { difficulty, Settings } from '../core/settings.js';
import { Sfx } from '../core/audio.js';
import { rumble } from '../core/input.js';
import { spawnBullet } from './projectiles.js';
import { Grenade } from './grenades.js';
import { muzzleFlash, dustPuff, sparkBurst } from './particles.js';
import { Enemy } from './enemies.js';
import { spawnPickup } from './pickups.js';
import { PLAY_X0, PLAY_X1 } from './constants.js';

export const BOSS_SCORE = 5000;

export class Boss {
  constructor(arena) {
    this.name = 'WARLORD — ARMORED PATROL';
    this.arena = arena; // {top, bottom}
    this.x = (PLAY_X0 + PLAY_X1) / 2;
    this.y = arena.top - 160;            // drives in from beyond the arena
    // anchor scales with arena height so ultra-wide (short) viewports
    // still keep the hull fully on screen
    this.anchorY = arena.top + Math.min(210, (arena.bottom - arena.top) * 0.38);
    this.radius = 52;
    this.maxHp = 2400 * difficulty().ehp;
    this.hp = this.maxHp;
    this.bodyAng = Math.PI / 2;          // facing down-screen
    this.turretAng = Math.PI / 2;
    this.trackPhase = 0;
    this.flash = 0;
    this.dead = false;
    this.state = 'arrive';
    this.stateT = 0;
    this.attackCd = 2.2;
    this.mortarCd = 4;
    this.addsCd = 6;
    this.chargeCd = 5;
    this.burst = 0;
    this.shotT = 0;
    this.sweepDir = 1;
    this.sweepA = 0;
    this.chargeVec = { x: 0, y: 1 };
    this.mortarQueue = [];
    this._dieT = 0;
    this._lastPhase = 1;
  }

  get phase() {
    const f = this.hp / this.maxHp;
    return f > 0.66 ? 1 : f > 0.33 ? 2 : 3;
  }

  damage(game, dmg, ang, src) {
    if (this.dead || this.state === 'dying' || this.state === 'arrive') return;
    if (this.state === 'stunned') dmg *= 1.5;
    this.hp -= dmg;
    this.flash = 1;
    if (this.hp <= 0) {
      this.hp = 0;
      this.state = 'dying';
      this.stateT = 0;
      this._dieT = 0;
      game.camera.addShake(0.5);
      if (Settings.slowMo) game.engine.slowMo(0.3, 1.4);
      Sfx.bossDown();
      return;
    }
    const ph = this.phase;
    if (ph !== this._lastPhase) {
      this._lastPhase = ph;
      game.engine.addHitstop(0.1);
      game.camera.addShake(0.5);
      Sfx.alarm();
      game.addPopup(ph === 2 ? 'MORTARS ONLINE!' : 'WARLORD ENRAGED!', this.x, this.y - 70, '#ff5040');
    }
  }

  update(game, dt) {
    this.stateT += dt;
    this.flash = Math.max(0, this.flash - dt * 5);
    this.trackPhase += dt * 30;
    const pl = game.player;

    // launch queued mortar shells
    for (let i = this.mortarQueue.length - 1; i >= 0; i--) {
      const m = this.mortarQueue[i];
      m.t -= dt;
      if (m.t <= 0) {
        game.grenades.push(new Grenade(this.x, this.y - 20, m.x, m.y, false, {
          flight: 1.25, radius: 72, dmg: 35 * difficulty().edmg,
        }));
        Sfx.grenadeThrow();
        this.mortarQueue.splice(i, 1);
      }
    }

    // heavy smoke when wounded
    if (this.hp < this.maxHp * 0.45 && this.state !== 'dying' && chance(dt * 10)) {
      game.fx.spawn({
        x: this.x + spread(30), y: this.y + spread(20), vy: -35, vx: spread(12),
        life: rand(0.6, 1.2), size: 8, sizeEnd: 20,
        col0: [55, 52, 50], alpha: 0.5,
      });
    }

    switch (this.state) {
      case 'arrive':
        this.y += 120 * dt;
        game.camera.addShake(0.012);
        if (this.y >= this.anchorY) { this.y = this.anchorY; this.state = 'combat'; this.stateT = 0; }
        break;

      case 'combat': {
        // drift to mirror the player laterally; turret tracks with lag
        this.x += clamp(pl.x - this.x, -1, 1) * 42 * dt;
        this.x = clamp(this.x, PLAY_X0 + 90, PLAY_X1 - 90);
        this.y += Math.sin(game.time * 0.8) * 6 * dt;
        const want = angTo(this.x, this.y, pl.x, pl.y);
        this.turretAng = angApproach(this.turretAng, want, 1.5 * dt);
        this.bodyAng = angApproach(this.bodyAng, Math.PI / 2, 0.6 * dt);

        this.attackCd -= dt;
        this.mortarCd -= dt;
        this.addsCd -= dt;
        this.chargeCd -= dt;

        if (!pl.dead) {
          if (this.phase >= 3 && this.chargeCd <= 0) {
            this.state = 'charge_warn'; this.stateT = 0;
            break;
          }
          if (this.phase >= 2 && this.mortarCd <= 0) {
            this.fireMortarVolley(game);
            this.mortarCd = (this.phase >= 3 ? 5.2 : 6.5) / difficulty().erof;
          }
          if (this.attackCd <= 0) {
            this.state = chance(0.45) ? 'sweep_warn' : 'burst_warn';
            this.stateT = 0;
          }
          if (this.addsCd <= 0 && game.enemies.length < 4) {
            this.callAdds(game);
            this.addsCd = 9;
          }
        }
        break;
      }

      case 'burst_warn':
        this.turretAng = angApproach(this.turretAng, angTo(this.x, this.y, pl.x, pl.y), 1.5 * dt);
        if (this.stateT > 0.7) { this.state = 'burst'; this.stateT = 0; this.burst = 8; this.shotT = 0; }
        break;

      case 'burst':
        this.shotT -= dt;
        if (this.shotT <= 0 && this.burst > 0) {
          this.fireTurret(game, this.turretAng + spread(0.05));
          this.burst--;
          this.shotT = 0.1 / difficulty().erof;
        }
        if (this.burst <= 0) { this.endAttack(); }
        break;

      case 'sweep_warn':
        if (this.stateT > 0.7) {
          this.state = 'sweep'; this.stateT = 0;
          this.burst = 13; this.shotT = 0;
          this.sweepDir = chance(0.5) ? 1 : -1;
          this.sweepA = angTo(this.x, this.y, pl.x, pl.y) - 0.65 * this.sweepDir;
        }
        break;

      case 'sweep':
        this.shotT -= dt;
        this.turretAng = this.sweepA;
        if (this.shotT <= 0 && this.burst > 0) {
          this.fireTurret(game, this.sweepA);
          this.sweepA += 0.1 * this.sweepDir;
          this.burst--;
          this.shotT = 0.09 / difficulty().erof;
        }
        if (this.burst <= 0) this.endAttack();
        break;

      case 'charge_warn': {
        // engine rev: shake, exhaust, body aims at the player
        const want = angTo(this.x, this.y, pl.x, pl.y);
        this.bodyAng = angApproach(this.bodyAng, want, 2.2 * dt);
        game.camera.addShake(0.02);
        if (chance(dt * 30)) {
          game.fx.spawn({
            x: this.x - Math.cos(this.bodyAng) * 50, y: this.y - Math.sin(this.bodyAng) * 50,
            vx: spread(20), vy: -20, life: 0.5, size: 6, sizeEnd: 16,
            col0: [40, 40, 40], alpha: 0.6,
          });
        }
        if (this.stateT > 1.0) {
          const n = norm(pl.x - this.x, pl.y - this.y);
          this.chargeVec = n;
          this.state = 'charge'; this.stateT = 0;
          Sfx.heavyShoot();
        }
        break;
      }

      case 'charge': {
        const sp = 540;
        this.x += this.chargeVec.x * sp * dt;
        this.y += this.chargeVec.y * sp * dt;
        this.bodyAng = Math.atan2(this.chargeVec.y, this.chargeVec.x);
        this.trackPhase += dt * 90;
        dustPuff(game.fx, this.x - this.chargeVec.x * 40, this.y - this.chargeVec.y * 40, 2);
        // contact damage
        if (!pl.dead && dist(this.x, this.y, pl.x, pl.y) < this.radius + pl.radius) {
          pl.damage(game, 40 * difficulty().edmg);
        }
        // wall slam
        const hitX = this.x < PLAY_X0 + 70 || this.x > PLAY_X1 - 70;
        const hitY = this.y < this.arena.top + 70 || this.y > this.arena.bottom - 70;
        if (hitX || hitY || this.stateT > 1.6) {
          this.x = clamp(this.x, PLAY_X0 + 70, PLAY_X1 - 70);
          // guard against degenerate (very short) arenas where the
          // margins would cross over
          const yLo = this.arena.top + 70;
          const yHi = Math.max(this.arena.bottom - 70, yLo);
          this.y = clamp(this.y, yLo, yHi);
          this.state = 'stunned'; this.stateT = 0;
          game.camera.addShake(0.7);
          game.engine.addHitstop(0.07);
          Sfx.explosion(false);
          rumble(1, 0.8, 350);
          sparkBurst(game.fx, this.x, this.y, 18);
          dustPuff(game.fx, this.x, this.y, 14);
        }
        break;
      }

      case 'stunned':
        if (chance(dt * 12)) sparkBurst(game.fx, this.x + spread(40), this.y + spread(26), 4);
        if (this.stateT > 2.6) { this.state = 'return'; this.stateT = 0; }
        break;

      case 'return': {
        const n = norm((PLAY_X0 + PLAY_X1) / 2 - this.x, this.anchorY - this.y);
        this.x += n.x * 150 * dt;
        this.y += n.y * 150 * dt;
        this.bodyAng = angApproach(this.bodyAng, Math.PI / 2, 2 * dt);
        if (dist(this.x, this.y, (PLAY_X0 + PLAY_X1) / 2, this.anchorY) < 24 || this.stateT > 2.5) {
          this.state = 'combat'; this.stateT = 0;
          this.chargeCd = 6.5; this.attackCd = 1;
        }
        break;
      }

      case 'dying': {
        this._dieT -= dt;
        if (this._dieT <= 0) {
          this._dieT = 0.18;
          const ox = spread(44), oy = spread(30);
          game.explode(this.x + ox, this.y + oy, { radius: 50, dmg: 0, hits: 'none' });
        }
        if (this.stateT > 1.7) {
          this.dead = true;
          game.explode(this.x, this.y, { radius: 150, dmg: 0, hits: 'none' });
          game.terrain.paintWreck(this.x, this.y, this.bodyAng, 1.6);
          spawnPickup(game, 'medal_big', this.x - 40, this.y);
          spawnPickup(game, 'medal_big', this.x + 40, this.y);
          spawnPickup(game, 'medkit', this.x, this.y + 36);
          game.onBossDefeated(this);
        }
        break;
      }
    }

    // The hull is solid: push the player out on overlap.
    if (!pl.dead && this.state !== 'dying') {
      const dx = pl.x - this.x, dy = pl.y - this.y;
      const rr = this.radius + pl.radius;
      const d2 = dx * dx + dy * dy;
      if (d2 < rr * rr && d2 > 0.01) {
        const d = Math.sqrt(d2);
        pl.x = this.x + (dx / d) * rr;
        pl.y = this.y + (dy / d) * rr;
      }
    }
  }

  // Return to combat stance; faster follow-ups in later phases.
  endAttack() {
    this.state = 'combat';
    this.stateT = 0;
    this.attackCd = (this.phase >= 3 ? 1.2 : this.phase === 2 ? 1.6 : 2.0) / difficulty().erof;
  }

  fireTurret(game, a) {
    const mx = this.x + Math.cos(a) * 58;
    const my = this.y - 14 + Math.sin(a) * 58;
    spawnBullet(game, mx, my, a, 380, 10 * difficulty().edmg, false, { heavy: true });
    muzzleFlash(game.fx, mx, my, a, true);
    Sfx.heavyShoot();
    game.camera.addShake(0.02);
  }

  fireMortarVolley(game) {
    const pl = game.player;
    game.addPopup('INCOMING!', pl.x, pl.y - 60, '#ff5040');
    const n = this.phase >= 3 ? 6 : 4;
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), r = i === 0 ? 0 : rand(50, 150);
      this.mortarQueue.push({
        t: i * 0.14,
        x: clamp(pl.x + pl.velX * 0.8 + Math.cos(a) * r, PLAY_X0 + 16, PLAY_X1 - 16),
        y: clamp(pl.y + pl.velY * 0.8 + Math.sin(a) * r, this.arena.top + 30, this.arena.bottom - 16),
      });
    }
  }

  callAdds(game) {
    for (let i = 0; i < 2; i++) {
      const side = chance(0.5) ? PLAY_X0 - 30 : PLAY_X1 + 30;
      const y = this.arena.top + rand(120, 380);
      const type = pick(['rifleman', 'rusher']);
      game.enemies.push(new Enemy(type, side, y, {
        ambush: true,
        enter: { x: clamp(side, PLAY_X0 + 60, PLAY_X1 - 60), y },
      }));
    }
  }

  draw(ctx, game) {
    const x = this.x, y = this.y;
    ctx.save();
    ctx.translate(x, y);
    // shadow
    ctx.fillStyle = 'rgba(8,10,4,0.4)';
    ctx.beginPath(); ctx.ellipse(4, 10, 58, 32, 0, 0, TAU); ctx.fill();
    ctx.rotate(this.bodyAng - Math.PI / 2); // art drawn facing "down"

    // tracks with animated treads
    ctx.fillStyle = '#181813';
    ctx.fillRect(-46, -38, 16, 80);
    ctx.fillRect(30, -38, 16, 80);
    ctx.fillStyle = '#2c2c24';
    for (let i = 0; i < 8; i++) {
      const ty = -36 + ((i * 10 + this.trackPhase) % 76);
      ctx.fillRect(-45, ty, 14, 4);
      ctx.fillRect(31, ty, 14, 4);
    }
    // hull
    const g = ctx.createLinearGradient(-30, 0, 34, 0);
    g.addColorStop(0, '#5d6248'); g.addColorStop(0.5, '#767c5c'); g.addColorStop(1, '#494e38');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-30, -42); ctx.lineTo(30, -42); ctx.lineTo(36, -20);
    ctx.lineTo(36, 34); ctx.lineTo(24, 44); ctx.lineTo(-24, 44);
    ctx.lineTo(-36, 34); ctx.lineTo(-36, -20);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#2e3224'; ctx.lineWidth = 2.5; ctx.stroke();
    // front ram blade (points "down" = toward player)
    ctx.fillStyle = '#3a3d2c';
    ctx.beginPath();
    ctx.moveTo(-30, 44); ctx.lineTo(30, 44); ctx.lineTo(38, 58); ctx.lineTo(-38, 58);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#23261a'; ctx.lineWidth = 2;
    for (const lx of [-24, -8, 8, 24]) {
      ctx.beginPath(); ctx.moveTo(lx, 45); ctx.lineTo(lx + 4, 57); ctx.stroke();
    }
    // hatch + vents
    ctx.fillStyle = '#41452f';
    ctx.fillRect(-18, -36, 36, 14);
    ctx.fillStyle = '#2e3224';
    for (const vy of [-33, -29, -25]) ctx.fillRect(-15, vy, 30, 2);
    // battle damage
    if (this.hp < this.maxHp * 0.55) {
      ctx.fillStyle = 'rgba(20,18,12,0.55)';
      ctx.beginPath(); ctx.ellipse(-14, 8, 11, 7, 0.5, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(18, -10, 8, 6, -0.4, 0, TAU); ctx.fill();
    }
    ctx.restore();

    // turret (independent rotation), raised above hull
    ctx.save();
    ctx.translate(x, y - 14);
    ctx.rotate(this.turretAng);
    const warn = this.state === 'burst_warn' || this.state === 'sweep_warn';
    ctx.fillStyle = '#34382a';
    ctx.fillRect(14, -5, 48, 10);
    ctx.fillStyle = '#23261c';
    ctx.fillRect(56, -7, 10, 14); // muzzle brake
    const tg = ctx.createRadialGradient(-3, -3, 2, 0, 0, 22);
    tg.addColorStop(0, '#6e745a'); tg.addColorStop(1, '#3d4230');
    ctx.fillStyle = tg;
    ctx.beginPath(); ctx.arc(0, 0, 21, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#23261a'; ctx.lineWidth = 2; ctx.stroke();
    if (warn) {
      const blink = Math.sin(game.time * 22) > 0;
      if (blink) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(255,110,50,0.8)';
        ctx.beginPath(); ctx.arc(64, 0, 6, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    ctx.restore();

    // stun stars
    if (this.state === 'stunned') {
      for (let i = 0; i < 3; i++) {
        const a = game.time * 4 + (i * TAU) / 3;
        ctx.fillStyle = '#ffd24a';
        ctx.font = 'bold 16px "Arial Black", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('✦', x + Math.cos(a) * 30, y - 56 + Math.sin(a) * 8);
      }
    }

    if (this.flash > 0) {
      ctx.globalAlpha = this.flash * 0.35;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(x, y, 60, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
  }
}
