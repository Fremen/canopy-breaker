// ============================================================
// hud.js — canvas-rendered in-game HUD (menus are DOM).
//
// Layout: health/lives/grenades/powerups top-left, score+combo
// top-right, mission progress spine on the right edge, boss bar
// top-center, banners mid-screen, tutorial prompts bottom,
// damage vignette, and the custom crosshair.
// All drawn in LOGICAL view coordinates (VIEW_W wide).
// ============================================================

import { clamp, TAU, lerp } from '../core/math.js';
import { Input } from '../core/input.js';
import { Settings } from '../core/settings.js';
import { VIEW_W, PLAYER, LEVEL_H, COMBO, POWERUPS } from './constants.js';

export function drawHUD(game, ctx) {
  const H = game.viewH;
  const pl = game.player;

  ctx.save();
  ctx.textBaseline = 'alphabetic';

  // ---------- health ----------
  const hx = 24, hy = 24, hw = 250, hh = 16;
  panel(ctx, hx - 6, hy - 6, hw + 12, hh + 12);
  const frac = clamp(pl.hp / PLAYER.hp, 0, 1);
  ctx.fillStyle = '#1a1f10';
  ctx.fillRect(hx, hy, hw, hh);
  const hg = ctx.createLinearGradient(hx, 0, hx + hw, 0);
  if (frac > 0.35) { hg.addColorStop(0, '#7fb33d'); hg.addColorStop(1, '#a8d44f'); }
  else { hg.addColorStop(0, '#c23b22'); hg.addColorStop(1, '#e2552e'); }
  ctx.fillStyle = hg;
  ctx.fillRect(hx, hy, hw * frac, hh);
  // segments
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  for (let i = 1; i < 5; i++) ctx.fillRect(hx + (hw / 5) * i - 1, hy, 2, hh);
  if (game.damageFlash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${game.damageFlash})`;
    ctx.fillRect(hx, hy, hw, hh);
  }
  // low-hp pulse edge
  if (frac < 0.3 && !pl.dead) {
    ctx.strokeStyle = `rgba(255,60,40,${0.5 + 0.4 * Math.sin(game.time * 8)})`;
    ctx.lineWidth = 2;
    ctx.strokeRect(hx - 1, hy - 1, hw + 2, hh + 2);
  }

  // lives (mini helmets)
  for (let i = 0; i < pl.lives; i++) {
    const lx = hx + 8 + i * 24, ly = hy + hh + 18;
    ctx.fillStyle = '#5a6e38';
    ctx.beginPath(); ctx.arc(lx, ly, 7, Math.PI, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(lx, ly, 9, 3, 0, 0, TAU); ctx.fill();
  }

  // grenade pips
  for (let i = 0; i < pl.grenades; i++) {
    const gx = hx + 8 + i * 17, gy = hy + hh + 42;
    ctx.fillStyle = '#74874a';
    ctx.beginPath(); ctx.ellipse(gx, gy, 5, 6.5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#39431f';
    ctx.fillRect(gx - 2, gy - 10, 4, 4);
  }

  // powerup chips
  let py = hy + hh + 62;
  const chips = [
    ['SPREAD', pl.spreadTimer, POWERUPS.spreadTime, '#ffd24a'],
    ['RAPID', pl.rapidTimer, POWERUPS.rapidTime, '#ffb13d'],
    ['SHIELD', pl.shieldTimer, POWERUPS.shieldTime, '#5aaaff'],
  ];
  for (const [label, t, max, col] of chips) {
    if (t <= 0) continue;
    panel(ctx, hx - 6, py, 132, 22);
    ctx.fillStyle = col;
    ctx.font = 'bold 11px "Arial Black", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(label, hx + 2, py + 15);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(hx + 62, py + 7, 56, 8);
    ctx.fillStyle = col;
    ctx.fillRect(hx + 62, py + 7, 56 * clamp(t / max, 0, 1), 8);
    py += 28;
  }

  // ---------- score + combo (top right) ----------
  const sx = VIEW_W - 26;
  ctx.textAlign = 'right';
  ctx.font = 'bold 30px "Arial Black", sans-serif';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillText(String(game.score.score).padStart(7, '0'), sx + 2, 48);
  ctx.fillStyle = '#f2ead0';
  ctx.fillText(String(game.score.score).padStart(7, '0'), sx, 46);

  const mult = game.score.multiplier;
  if (game.score.comboTimer > 0 && mult > 1) {
    const pulse = 1 + 0.12 * Math.sin(game.time * 12);
    ctx.font = `bold ${Math.round(24 * pulse)}px "Arial Black", sans-serif`;
    ctx.fillStyle = '#ffb13d';
    ctx.fillText(`×${mult}`, sx, 78);
    // combo window drain bar
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(sx - 90, 86, 90, 6);
    ctx.fillStyle = '#ffb13d';
    const cf = clamp(game.score.comboTimer / COMBO.window, 0, 1);
    ctx.fillRect(sx - 90 * cf, 86, 90 * cf, 6);
  }

  // ---------- mission progress spine (right edge) ----------
  const tx = VIEW_W - 14, t0 = 110, t1 = H - 90;
  ctx.strokeStyle = 'rgba(216,200,154,0.25)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(tx, t0); ctx.lineTo(tx, t1); ctx.stroke();
  const lm = game.level.landmarks;
  const marks = [
    [lm.river, 'rgba(120,190,230,0.8)'],
    [lm.gate, 'rgba(216,200,154,0.8)'],
    [lm.boss, 'rgba(255,80,60,0.9)'],
  ];
  for (const [my, col] of marks) {
    const yy = lerp(t1, t0, 1 - my / LEVEL_H);
    ctx.fillStyle = col;
    ctx.fillRect(tx - 5, yy - 1.5, 10, 3);
  }
  const pf = clamp(1 - pl.y / LEVEL_H, 0, 1);
  const pyy = lerp(t1, t0, pf);
  ctx.fillStyle = '#a8d44f';
  ctx.beginPath();
  ctx.moveTo(tx - 9, pyy); ctx.lineTo(tx - 2, pyy - 5); ctx.lineTo(tx - 2, pyy + 5);
  ctx.closePath(); ctx.fill();

  // ---------- boss bar ----------
  const boss = game.boss;
  if (boss && !boss.dead && boss.state !== 'arrive') {
    const bw = 460, bx = (VIEW_W - bw) / 2, by = 30;
    ctx.textAlign = 'center';
    ctx.font = 'bold 13px "Arial Black", sans-serif';
    ctx.fillStyle = '#ff7a60';
    ctx.fillText(boss.name, VIEW_W / 2, by - 8);
    panel(ctx, bx - 4, by - 2, bw + 8, 18);
    ctx.fillStyle = '#2a0f0a';
    ctx.fillRect(bx, by + 2, bw, 10);
    const bf = clamp(boss.hp / boss.maxHp, 0, 1);
    const bg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    bg.addColorStop(0, '#c23b22'); bg.addColorStop(1, '#ff6a3d');
    ctx.fillStyle = bg;
    ctx.fillRect(bx, by + 2, bw * bf, 10);
    for (const f of [0.33, 0.66]) { // phase ticks
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(bx + bw * f - 1, by + 2, 2, 10);
    }
  }

  // ---------- banners (stacked, so simultaneous triggers never overlap) ----------
  ctx.textAlign = 'center';
  for (let bi = 0; bi < game.banners.length; bi++) {
    const b = game.banners[bi];
    const a = b.t < 0.3 ? b.t / 0.3 : b.life < 0.5 ? b.life / 0.5 : 1;
    const by = H * 0.3 + bi * 46;
    ctx.globalAlpha = a;
    ctx.font = 'bold 34px "Arial Black", sans-serif';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 5;
    ctx.strokeText(b.text, VIEW_W / 2, by);
    ctx.fillStyle = '#f2ead0';
    ctx.fillText(b.text, VIEW_W / 2, by);
    ctx.globalAlpha = 1;
  }

  // ---------- tutorial prompt ----------
  const tut = game.tutorial;
  const step = tut.steps[tut.index];
  if (step && tut.alpha > 0.02) {
    ctx.globalAlpha = tut.alpha;
    const text = step.text;
    ctx.font = 'bold 15px "Arial Black", sans-serif';
    const tw = ctx.measureText(text).width;
    panel(ctx, (VIEW_W - tw) / 2 - 18, H - 96, tw + 36, 34);
    ctx.fillStyle = '#d8c89a';
    ctx.fillText(text, VIEW_W / 2, H - 73);
    ctx.globalAlpha = 1;
  }

  // ---------- respawn overlay ----------
  if (pl.dead && pl.lives > 0) {
    ctx.fillStyle = 'rgba(20,8,4,0.45)';
    ctx.fillRect(0, 0, VIEW_W, H);
    ctx.font = 'bold 40px "Arial Black", sans-serif';
    ctx.fillStyle = '#ff5040';
    ctx.fillText('SOLDIER DOWN', VIEW_W / 2, H * 0.45);
    ctx.font = 'bold 15px "Arial Black", sans-serif';
    ctx.fillStyle = '#d8c89a';
    ctx.fillText('REDEPLOYING…', VIEW_W / 2, H * 0.45 + 32);
  }

  // ---------- damage vignette ----------
  const lowHp = !pl.dead && frac < 0.3 ? 0.12 + 0.08 * Math.sin(game.time * 8) : 0;
  const va = clamp(game.damageFlash * 0.7 + lowHp, 0, 0.55);
  if (va > 0.01) {
    const vg = ctx.createRadialGradient(VIEW_W / 2, H / 2, H * 0.35, VIEW_W / 2, H / 2, H * 0.85);
    vg.addColorStop(0, 'rgba(120,10,5,0)');
    vg.addColorStop(1, `rgba(140,12,6,${va})`);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, VIEW_W, H);
  }

  // ---------- crosshair ----------
  if (!pl.dead) {
    let cxx, cyy;
    if (Input.usingGamepad) {
      cxx = pl.x + Math.cos(pl.aim) * 130;
      cyy = pl.y + Math.sin(pl.aim) * 130 - game.camera.y;
    } else {
      cxx = Input.mouse.x / game.scaleCss;
      cyy = Input.mouse.y / game.scaleCss;
    }
    ctx.strokeStyle = 'rgba(240,240,230,0.9)';
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(cxx, cyy, 9, 0, TAU); ctx.stroke();
    ctx.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.moveTo(cxx + dx * 5, cyy + dy * 5);
      ctx.lineTo(cxx + dx * 12, cyy + dy * 12);
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,80,60,0.9)';
    ctx.beginPath(); ctx.arc(cxx, cyy, 1.6, 0, TAU); ctx.fill();

    // hit marker: four ticks flick outward when a shot connects
    if (game.hitMarkerT > 0) {
      const t = 1 - game.hitMarkerT / 0.12;
      const d = 7 + t * 7;
      ctx.strokeStyle = `rgba(255,255,255,${(0.9 * (1 - t)).toFixed(2)})`;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        ctx.moveTo(cxx + sx * d, cyy + sy * d);
        ctx.lineTo(cxx + sx * (d + 5), cyy + sy * (d + 5));
      }
      ctx.stroke();
    }
  }

  ctx.restore();
}

function panel(ctx, x, y, w, h) {
  ctx.fillStyle = 'rgba(10,13,6,0.55)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(216,200,154,0.22)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}
