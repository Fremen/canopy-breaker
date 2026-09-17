// ============================================================
// game.js — the orchestrator. Owns the state machine
// (menu → playing → paused → gameover/victory), the world
// arrays, the update order, the render pipeline (painter's-
// sorted 2.5D), and the single explosion entry point that ties
// damage, knockback, chains, decals, shake and slow-mo together.
// ============================================================

import { Engine } from '../core/engine.js';
import { Camera } from '../core/camera.js';
import { Input, updateInput, rumble } from '../core/input.js';
import { Settings } from '../core/settings.js';
import { Sfx, startMusic, setMusicIntensity, initAudio } from '../core/audio.js';
import { clamp, dist, angTo, TAU, rand, spread } from '../core/math.js';
import { VIEW_W, LEVEL_H, PLAY_X0, PLAY_X1 } from './constants.js';
import { Player } from './player.js';
import { updateEnemies } from './enemies.js';
import { Boss } from './boss.js';
import { updateBullets, drawBullets } from './projectiles.js';
import { updateGrenades } from './grenades.js';
import { updatePickups, drawPickups } from './pickups.js';
import { ParticleSystem, explosion, waterSplash } from './particles.js';
import { resolveEntityVsProps } from './props.js';
import { Terrain } from './terrain.js';
import { createLevel } from './level.js';
import { Spawner } from './spawner.js';
import { ScoreSystem } from './score.js';
import { drawHUD } from './hud.js';

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.state = 'menu';
    this.menus = null; // wired by menus.js
    this.engine = new Engine((dt) => this.update(dt), () => this.render());
    this.time = 0;
    this.resize();
    this.resetWorld();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth, h = document.getElementById("game-root").clientHeight || window.innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.scaleCss = w / VIEW_W;                 // CSS px per logical unit
    this.scale = this.canvas.width / VIEW_W;    // backing px per logical unit
    this.viewH = h / this.scaleCss;             // logical view height
    this._vignette = null;                      // size-keyed FX caches
    this._crtEdge = null;
    if (this.camera) this.camera.viewH = this.viewH;
    // a resize mid-boss-fight must re-derive the arena lock, or the
    // locked window and the boss's walls drift apart (cheese spots /
    // off-screen wall slams)
    if (this.boss && this.camera && this.camera.lockY !== null) {
      const arena = this.level.arena;
      this.camera.lockY = clamp(arena.bottom - this.viewH + 40, 0, LEVEL_H - this.viewH);
      this.boss.arena.top = this.camera.lockY + 50;
      this.boss.arena.bottom = arena.bottom - 16;
    }
  }

  resetWorld() {
    this.level = createLevel();
    this.terrain = new Terrain(this.level);
    this.fx = new ParticleSystem();
    this.props = this.level.buildProps();
    this.hostages = this.level.buildHostages();
    this.enemies = [];
    this.bullets = [];
    this.grenades = [];
    this.pickups = [];
    this.popups = [];
    this.banners = [];
    this.spawner = new Spawner(this.level.triggers);
    this.score = new ScoreSystem();
    this.player = new Player(this.level.playerStart.x, this.level.playerStart.y);
    this.camera = new Camera(VIEW_W, this.viewH, LEVEL_H);
    this.camera.y = clamp(this.player.y - this.viewH * 0.62, 0, LEVEL_H - this.viewH);
    this.boss = null;
    this.bossDefeated = false;
    this.damageFlash = 0;
    this.missionTime = 0;
    this._flareT = 0;
    this.hitMarkerT = 0;
    this._lastTickT = -1;
    this.tutorial = {
      steps: [
        { text: 'MOVE — WASD / ARROWS / LEFT STICK', done: (g) => g.player.movedDist > 150 },
        { text: 'AIM — MOUSE  •  FIRE — LEFT CLICK / RT', done: (g) => g.score.shotsFired >= 6 },
        { text: 'GRENADE — SPACE / LT', done: (g) => g.score.grenadesThrown >= 1 },
        { text: 'FREE CAPTIVE SCOUTS  •  CHAIN KILLS FOR COMBO', timer: 5 },
      ],
      index: 0,
      alpha: 0,
    };
  }

  // ---------- state transitions (called by DOM menus too) ----------

  startGame() {
    this.resetWorld();
    this.engine.reset(); // never start a run inside leftover slow-mo
    this.state = 'playing';
    initAudio();
    startMusic();
    this.menus.hideAll();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.engine.frozen = true; // preserve hitstop/slow-mo across the pause
    this.menus.show('pause');
  }

  resume() {
    this.state = 'playing';
    this.engine.frozen = false;
    this.menus.hideAll();
  }

  toMenu() {
    this.state = 'menu';
    this.resetWorld();
    this.engine.reset();
    setMusicIntensity(0);
    this.menus.show('menu');
  }

  onGameOver() {
    if (this.state !== 'playing') return;
    this.state = 'gameover';
    setMusicIntensity(0);
    Sfx.gameOver();
    const stats = this.score.finalize(this.missionTime, false);
    setTimeout(() => this.menus.showEnd(false, stats), 1400);
  }

  onVictory() {
    if (this.state !== 'playing') return;
    this.state = 'victory';
    setMusicIntensity(0);
    Sfx.victory();
    const stats = this.score.finalize(this.missionTime, true);
    setTimeout(() => this.menus.showEnd(true, stats), 1200);
  }

  // ---------- boss flow ----------

  startBossFight() {
    const arena = this.level.arena;
    this.camera.lockY = clamp(arena.bottom - this.viewH + 40, 0, LEVEL_H - this.viewH);
    const box = { top: this.camera.lockY + 50, bottom: arena.bottom - 16 };
    this.boss = new Boss(box);
    Sfx.alarm();
    this.addBanner('⚠ WARLORD INBOUND ⚠');
    this.camera.addShake(0.3);
  }

  onBossDefeated(boss) {
    const pts = this.score.addBossKill();
    this.addPopup(`+${pts}`, boss.x, boss.y - 40, '#ffd24a', 22);
    this.boss = null;
    this.bossDefeated = true;
    this.camera.lockY = null;
    this.addBanner('REACH THE EXTRACTION FLARE');
    if (Settings.rumble) rumble(1, 1, 600);
  }

  // ---------- helpers used across systems ----------

  mouseWorld() {
    return {
      x: Input.mouse.x / this.scaleCss,
      y: Input.mouse.y / this.scaleCss + this.camera.y,
    };
  }

  addPopup(text, x, y, col = '#f2ead0', size = 14) {
    this.popups.push({ text, x, y, life: 1.1, maxLife: 1.1, col, size });
  }

  addBanner(text) {
    this.banners.push({ text, t: 0, life: 2.6 });
  }

  onEnemyKilled(e, src) {
    const before = this.score.multiplier;
    const pts = this.score.addKill(e, src);
    const mult = this.score.multiplier;
    this.addPopup(mult > 1 ? `+${pts} ×${mult}` : `+${pts}`, e.x, e.y - 24,
      mult >= 4 ? '#ffd24a' : '#f2ead0', mult >= 4 ? 17 : 14);
    if (mult > before) {
      // multiplier tier-up: celebrate it — this is the aggression loop
      this.addPopup(`COMBO ×${mult}`, this.player.x, this.player.y - 52, '#ffb13d', 21);
      Sfx.comboUp();
    }
  }

  // brief crosshair hit-marker + quiet confirm tick (throttled so
  // rapid fire doesn't turn it into noise)
  onShotConnected() {
    this.hitMarkerT = 0.12;
    if (this.time - this._lastTickT > 0.09) {
      this._lastTickT = this.time;
      Sfx.hitTick();
    }
  }

  // Push entities out of solid props, and out of the river
  // (unless they're on the bridge). One function for everyone.
  resolveSolids(ent) {
    resolveEntityVsProps(this, ent);
    const r = this.level.river;
    if (ent.y > r.y0 && ent.y < r.y1) {
      const lo = r.bridgeX - r.bridgeHalf + ent.radius;
      const hi = r.bridgeX + r.bridgeHalf - ent.radius;
      if (ent.x < lo || ent.x > hi) {
        const upD = ent.y - r.y0;
        const downD = r.y1 - ent.y;
        const toBridge = ent.x < lo ? lo - ent.x : ent.x - hi;
        if (toBridge < Math.min(upD, downD) + 10) {
          ent.x = clamp(ent.x, lo, hi);
        } else if (upD < downD) {
          ent.y = r.y0 - ent.radius * 0.2;
        } else {
          ent.y = r.y1 + ent.radius * 0.2;
        }
      }
    }
  }

  // The single AoE entry point: grenades, barrels, mortars,
  // vehicle deaths. Handles fx, sound, shake, rumble, damage
  // with falloff, knockback, prop chains, decals, slow-mo.
  //
  // Accepted opts (anything else is ignored):
  //   radius  blast radius in px (default 95)
  //   dmg     damage at center, falls off to ~35% at the edge
  //   hits    who takes dmg: 'all' | 'enemies' | 'player' | 'none'
  //           (props ALWAYS chain regardless — that's the barrel game)
  //   grenade true if a player grenade — kills count for the
  //           grenade-efficiency bonus
  explode(x, y, opts = {}) {
    const radius = opts.radius ?? 95;
    const dmg = opts.dmg ?? 0;
    const hits = opts.hits ?? 'all';
    const src = opts.grenade ? 'grenade' : 'explosion';

    explosion(this.fx, x, y, radius);
    this.camera.addShake(clamp(radius / 95, 0.4, 1.6) * 0.42);
    Sfx.explosion(radius > 110);
    rumble(0.8, 0.5, 220);

    // the bridge deck counts as land: splash in the river, scorch
    // everywhere else (including the planks)
    const river = this.level.river;
    const onBridge = Math.abs(x - river.bridgeX) < river.bridgeHalf;
    if (this.terrain.inWaterRect(y) && !onBridge) waterSplash(this.fx, x, y, true);
    else this.terrain.scorch(x, y, radius * 0.8, onBridge);

    let kills = 0;
    if (dmg > 0 && (hits === 'enemies' || hits === 'all')) {
      for (const e of this.enemies) {
        if (e.dead) continue;
        const d = dist(x, y, e.x, e.y);
        if (d < radius + e.radius) {
          const f = 1 - 0.65 * clamp(d / radius, 0, 1);
          const a = angTo(x, y, e.x, e.y);
          e.damage(this, dmg * f, a, src);
          e.knockback(a, 260 * (1 - clamp(d / radius, 0, 1)));
          if (e.dead) kills++;
        }
      }
      if (this.boss && !this.boss.dead) {
        const d = dist(x, y, this.boss.x, this.boss.y);
        if (d < radius + this.boss.radius) {
          this.boss.damage(this, dmg * (1 - 0.5 * clamp(d / radius, 0, 1)), 0, src);
        }
      }
    }
    if (dmg > 0 && (hits === 'player' || hits === 'all')) {
      const pl = this.player;
      if (!pl.dead) {
        const d = dist(x, y, pl.x, pl.y);
        if (d < radius + pl.radius) {
          pl.damage(this, dmg * (1 - 0.6 * clamp(d / radius, 0, 1)));
        }
      }
    }
    // props always chain (barrels!)
    for (const p of this.props) {
      if (p.dead || !p.destructible) continue;
      const d = dist(x, y, p.x, p.y);
      if (d < radius + p.radius) {
        p.damage(this, Math.max(dmg, 40), angTo(x, y, p.x, p.y));
      }
    }

    if (kills >= 2) this.engine.addHitstop(0.05);
    if (kills >= 3 && Settings.slowMo) this.engine.slowMo(0.35, 0.55);
    if (kills >= 3) this.addPopup(`${kills} KILL BLAST!`, x, y - radius * 0.6, '#ffd24a', 18);
  }

  // ---------- per-frame update ----------

  update(dt) {
    updateInput();
    this.time += dt;

    if (this.state === 'menu') {
      // attract mode: slow scenic scroll behind the DOM menu
      this.camera.y -= 26 * dt;
      if (this.camera.y < 0) this.camera.y = LEVEL_H - this.viewH;
      this.camera.update(dt);
      this.fx.update(dt);
      // menu navigation works for every device (Esc backs out,
      // Enter / gamepad-A deploys)
      if (Input.pauseJust && (this.menus.current === 'options' || this.menus.current === 'help')) {
        this.menus.show('menu');
      } else if (Input.confirmJust && this.menus.current === 'menu') {
        this.startGame();
      }
      return;
    }
    if (this.state === 'paused') {
      // Esc/P/Start toggles back out; options backs to pause first
      if (Input.pauseJust) {
        if (this.menus.current === 'options') this.menus.show('pause');
        else this.resume();
      }
      return;
    }
    if (this.state === 'gameover' || this.state === 'victory') {
      // keep the world simmering behind the end screen; the music
      // must wind down even though the combat-heat block below
      // no longer runs (it once stayed pinned at boss intensity)
      setMusicIntensity(0);
      this.fx.update(dt);
      this.camera.update(dt);
      this.hitMarkerT = Math.max(0, this.hitMarkerT - dt); // don't freeze mid-flick
      if (Input.confirmJust && this.menus.current === 'end') this.startGame();
      return;
    }

    if (Input.pauseJust) { this.pause(); return; }

    this.missionTime += dt;
    this.damageFlash = Math.max(0, this.damageFlash - dt * 2);
    this.hitMarkerT = Math.max(0, this.hitMarkerT - dt);

    this.player.update(this, dt);
    updateEnemies(this, dt);
    if (this.boss) this.boss.update(this, dt);
    updateBullets(this, dt);
    updateGrenades(this, dt);
    updatePickups(this, dt);

    for (let i = this.props.length - 1; i >= 0; i--) {
      const p = this.props[i];
      p.update(this, dt);
      if (p.dead) { this.props[i] = this.props[this.props.length - 1]; this.props.pop(); }
    }
    for (let i = this.hostages.length - 1; i >= 0; i--) {
      const h = this.hostages[i];
      h.update(this, dt);
      if (h.dead) this.hostages.splice(i, 1);
    }

    this.fx.update(dt);
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.life -= dt; p.y -= 34 * dt;
      if (p.life <= 0) this.popups.splice(i, 1);
    }
    for (let i = this.banners.length - 1; i >= 0; i--) {
      const b = this.banners[i];
      b.t += dt; b.life -= dt;
      if (b.life <= 0) this.banners.splice(i, 1);
    }

    this.spawner.update(this, dt);
    this.camera.follow(this.player.y, dt);
    this.camera.update(dt);
    this.score.update(dt);

    // dynamic music intensity: combat heat + boss override
    if (this.boss && !this.boss.dead) {
      setMusicIntensity(3);
    } else {
      const visible = this.enemies.reduce((n, e) => n + (e.visibleT > 0 ? 1 : 0), 0);
      setMusicIntensity(clamp(visible / 3, 0, 2.2));
    }

    // tutorial progression
    const tut = this.tutorial;
    const step = tut.steps[tut.index];
    if (step) {
      tut.alpha = Math.min(1, tut.alpha + dt * 2);
      let done = false;
      if (step.timer !== undefined) { step.timer -= dt; done = step.timer <= 0; }
      else done = step.done(this);
      if (done) { tut.index++; tut.alpha = 0; }
    }

    // extraction flare (after the boss falls)
    if (this.bossDefeated) {
      const flare = this.level.landmarks.extraction;
      this._flareT -= dt;
      if (this._flareT <= 0) {
        this._flareT = 0.05;
        this.fx.spawn({
          x: flare.x + spread(8), y: flare.y + spread(4), vy: -rand(30, 70), vx: spread(14),
          life: rand(0.8, 1.6), size: rand(5, 9), sizeEnd: rand(16, 26),
          col0: [90, 220, 120], col1: [30, 90, 50], alpha: 0.5,
        });
      }
      if (this.player.y < this.level.landmarks.winY && !this.player.dead) this.onVictory();
    }
  }

  // ---------- render ----------

  render() {
    const ctx = this.ctx, cam = this.camera;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#10160a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.save();
    ctx.scale(this.scale, this.scale);

    // ---- world space ----
    ctx.save();
    ctx.translate(cam.shakeX, cam.shakeY - cam.y);

    this.terrain.draw(ctx, cam.y, this.viewH);
    this.terrain.drawWater(ctx, cam.y, this.viewH, this.time);
    this.drawCloudShadows(ctx, cam);
    this.fx.draw(ctx, 0, cam.y, this.viewH);

    for (const g of this.grenades) g.drawUnder(ctx, this.time);
    drawPickups(this, ctx);

    // painter's-sorted entity layer (the 2.5D illusion)
    const order = [];
    const m = 90;
    const vis = (y) => y > cam.y - m && y < cam.y + this.viewH + m;
    for (const p of this.props) if (vis(p.y)) order.push({ y: p.y, fn: () => p.draw(ctx, this) });
    for (const e of this.enemies) if (vis(e.y)) order.push({ y: e.y, fn: () => e.draw(ctx, this) });
    for (const h of this.hostages) if (vis(h.y)) order.push({ y: h.y, fn: () => h.draw(ctx, this) });
    if (this.boss) order.push({ y: this.boss.y, fn: () => this.boss.draw(ctx, this) });
    if (this.state !== 'menu') order.push({ y: this.player.y, fn: () => this.player.draw(this, ctx) });
    for (const g of this.grenades) order.push({ y: g.y, fn: () => g.draw(ctx) });
    order.sort((a, b) => a.y - b.y);
    for (const o of order) o.fn();

    // overhead layer: tree canopies, tower platforms
    for (const p of this.props) {
      if (!p.dead && vis(p.y) && (p.type === 'tree' || p.type === 'tower')) p.drawOver(ctx, this);
    }

    drawBullets(this, ctx);
    this.fx.draw(ctx, 1, cam.y, this.viewH);

    // extraction flare glow
    if (this.bossDefeated) {
      const f = this.level.landmarks.extraction;
      const g = ctx.createRadialGradient(f.x, f.y, 4, f.x, f.y, 90);
      g.addColorStop(0, 'rgba(90,230,130,0.5)');
      g.addColorStop(1, 'rgba(90,230,130,0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(f.x, f.y, 90, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }

    // score popups (world-space)
    ctx.textAlign = 'center';
    for (const p of this.popups) {
      const a = clamp(p.life / p.maxLife * 1.6, 0, 1);
      ctx.globalAlpha = a;
      ctx.font = `bold ${p.size}px "Arial Black", sans-serif`;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 3;
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = p.col;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;

    ctx.restore(); // end world space

    // ---- screen space ----
    this.applyColorGrade(ctx);
    if (this.state === 'menu') {
      // darken the attract backdrop for menu legibility
      ctx.fillStyle = 'rgba(6,9,4,0.35)';
      ctx.fillRect(0, 0, VIEW_W, this.viewH);
    } else {
      drawHUD(this, ctx);
    }
    this.drawScreenFX(ctx);

    ctx.restore();
  }

  // Soft cloud shadows crawling over the battlefield — cheap ambient
  // motion that sells the canopy overhead (drawn in world space).
  drawCloudShadows(ctx, cam) {
    const span = this.viewH + 700;
    for (let k = 0; k < 4; k++) {
      const cy = cam.y - 350 + ((k * 977 + this.time * (8 + k * 2.5)) % span);
      // ±470 wrap margin exceeds the largest cloud radius (450)
      const cx = ((k * 463 + this.time * (5 + k * 1.7)) % (VIEW_W + 940)) - 470;
      const r = 240 + k * 70;
      const g = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
      g.addColorStop(0, 'rgba(8,12,18,0.10)');
      g.addColorStop(1, 'rgba(8,12,18,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * 0.62, 0.4, 0, TAU);
      ctx.fill();
    }
  }

  // Journey color grade: warm insertion light → cool deep jungle →
  // smoky camp → harsh arena → clean extraction. Keyed to progress.
  applyColorGrade(ctx) {
    const denom = Math.max(1, LEVEL_H - this.viewH);
    // menu attract wraps the camera; pin its grade so the tint
    // doesn't pop when the loop restarts
    const p = this.state === 'menu' ? 0.35 : clamp(1 - this.camera.y / denom, 0, 1);
    const KEYS = GRADE_KEYS;
    let a = KEYS[0], b = KEYS[KEYS.length - 1];
    for (let i = 0; i < KEYS.length - 1; i++) {
      if (p >= KEYS[i][0] && p <= KEYS[i + 1][0]) { a = KEYS[i]; b = KEYS[i + 1]; break; }
    }
    const t = (p - a[0]) / Math.max(0.0001, b[0] - a[0]);
    const mix = (i) => Math.round(a[i] + (b[i] - a[i]) * t);
    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = `rgba(${mix(1)},${mix(2)},${mix(3)},${(a[4] + (b[4] - a[4]) * t).toFixed(3)})`;
    ctx.fillRect(0, 0, VIEW_W, this.viewH);
    ctx.globalCompositeOperation = 'source-over';
  }

  // Always-on soft vignette + the optional retro CRT scanline pass.
  // Gradients are cached per window size (invalidated in resize()).
  drawScreenFX(ctx) {
    const w = VIEW_W, h = this.viewH;

    if (!this._vignette) {
      const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.45, w / 2, h / 2, Math.max(w, h) * 0.72);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(5,8,3,0.28)');
      this._vignette = vg;
    }
    // ease the cosmetic vignette off while the HUD's red damage
    // vignette ramps up — the two must never stack into an opaque
    // border exactly when peripheral readability matters most
    const pl = this.player;
    const hurt = this.damageFlash * 0.7 + (pl && !pl.dead && pl.hp < 30 ? 0.2 : 0);
    ctx.globalAlpha = clamp(1 - hurt * 1.4, 0.35, 1);
    ctx.fillStyle = this._vignette;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;

    if (Settings.crtFilter) {
      // scanlines in DEVICE space with an integer pixel period —
      // logical-space patterns moiré at fractional canvas scales
      const period = Math.max(2, Math.round(3 * this.scale));
      if (!this._scanPattern || this._scanPeriod !== period) {
        const pc = document.createElement('canvas');
        pc.width = 1; pc.height = period;
        const pctx = pc.getContext('2d');
        pctx.fillStyle = 'rgba(0,0,0,0.22)';
        pctx.fillRect(0, period - 1, 1, 1);
        this._scanPattern = ctx.createPattern(pc, 'repeat');
        this._scanPeriod = period;
      }
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = this._scanPattern;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.restore();
      // slight edge falloff, like a curved tube
      if (!this._crtEdge) {
        const eg = ctx.createLinearGradient(0, 0, w, 0);
        eg.addColorStop(0, 'rgba(0,0,0,0.16)');
        eg.addColorStop(0.07, 'rgba(0,0,0,0)');
        eg.addColorStop(0.93, 'rgba(0,0,0,0)');
        eg.addColorStop(1, 'rgba(0,0,0,0.16)');
        this._crtEdge = eg;
      }
      ctx.fillStyle = this._crtEdge;
      ctx.fillRect(0, 0, w, h);
    }
  }
}

// Color-grade keyframes: [progress, r, g, b, alpha].
const GRADE_KEYS = [
  [0.00, 255, 196, 120, 0.050],
  [0.30, 70, 100, 120, 0.060],
  [0.62, 160, 100, 65, 0.050],
  [0.88, 205, 70, 55, 0.045],
  [1.00, 185, 230, 165, 0.050],
];
