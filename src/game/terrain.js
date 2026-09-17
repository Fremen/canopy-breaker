// ============================================================
// terrain.js — chunked, pre-rendered battlefield ground.
//
// The 7600px-tall level is split into 600px strips, each
// generated ONCE into an offscreen canvas from a deterministic
// seed: base palette gradient per section, soil noise, grass
// tufts, ferns, the winding dirt road with wheel ruts, the
// river + bridge, dug trenches, camp grounds and jungle walls.
//
// Persistent battle damage (scorch craters, corpses, wrecks,
// rubble) is painted directly INTO the chunk canvases — free
// persistence, zero per-frame cost, and the battlefield
// remembers every fight.
// ============================================================

import { TAU, mulberry32, lerp, clamp } from '../core/math.js';
import { VIEW_W, PLAY_X0, PLAY_X1, LEVEL_H } from './constants.js';

const CHUNK_H = 600;

const SECTION_PALS = {
  clearing:  { top: '#46582c', bottom: '#3e5026' },
  jungle:    { top: '#36471f', bottom: '#314020' },
  river:     { top: '#3c4c24', bottom: '#36471f' },
  trench:    { top: '#55492f', bottom: '#4a4128' },
  camp:      { top: '#564a32', bottom: '#4d432c' },
  arena:     { top: '#4d4631', bottom: '#46402c' },
  extraction:{ top: '#4c6030', bottom: '#46582c' },
};

export class Terrain {
  constructor(level) {
    this.level = level;
    this.chunks = new Map(); // index → canvas (kept forever; ~13 total)
  }

  chunk(i) {
    if (i < 0 || i * CHUNK_H >= LEVEL_H + CHUNK_H) return null;
    let c = this.chunks.get(i);
    if (!c) { c = this.build(i); this.chunks.set(i, c); }
    return c;
  }

  draw(ctx, camY, viewH) {
    const i0 = Math.floor(camY / CHUNK_H);
    const i1 = Math.floor((camY + viewH) / CHUNK_H);
    for (let i = i0; i <= i1; i++) {
      const c = this.chunk(i);
      // chunks carry a 1px bleed on top+bottom: adjacent strips
      // overlap so fractional camera offsets can't open hairline seams
      if (c) ctx.drawImage(c, 0, i * CHUNK_H - 1);
    }
    // prefetch the next chunk in the scroll direction (north = lower
    // index) so its one-time build cost never lands mid-combat
    this.chunk(i0 - 1);
  }

  // Animated water shimmer, drawn live over the static river.
  drawWater(ctx, camY, viewH, time) {
    const r = this.level.river;
    if (camY > r.y1 + 40 || camY + viewH < r.y0 - 40) return;
    ctx.save();
    const bx0 = r.bridgeX - r.bridgeHalf - 6, bx1 = r.bridgeX + r.bridgeHalf + 6;
    const span = r.y1 - r.y0;
    for (let k = 0; k < 9; k++) {
      const wy = r.y0 + 10 + ((k * 23 + time * 26) % (span - 20));
      const wobble = Math.sin(time * 1.8 + k * 1.7) * 14;
      ctx.globalAlpha = 0.10 + 0.07 * Math.sin(time * 2.2 + k * 2.4);
      ctx.strokeStyle = '#bfe2ef';
      ctx.lineWidth = 1.6;
      for (const [sx, ex] of [[PLAY_X0 - 40, bx0], [bx1, PLAY_X1 + 40]]) {
        ctx.beginPath();
        ctx.moveTo(sx + 12 + wobble, wy);
        ctx.bezierCurveTo(
          lerp(sx, ex, 0.33) + wobble, wy + 3,
          lerp(sx, ex, 0.66) - wobble, wy - 3,
          ex - 8 + wobble, wy
        );
        ctx.stroke();
      }
    }
    // bank foam
    ctx.globalAlpha = 0.12 + 0.05 * Math.sin(time * 3);
    ctx.fillStyle = '#d8eef5';
    ctx.fillRect(PLAY_X0 - 40, r.y0, VIEW_W, 3);
    ctx.fillRect(PLAY_X0 - 40, r.y1 - 3, VIEW_W, 3);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ---------- chunk generation ----------

  build(index) {
    const cv = document.createElement('canvas');
    cv.width = VIEW_W;
    cv.height = CHUNK_H + 2; // 1px bleed top + bottom (see draw())
    const ctx = cv.getContext('2d');
    ctx.translate(0, 1);     // keep painters in chunk-local coords
    const rng = mulberry32(index * 7919 + 1237);
    const y0 = index * CHUNK_H;
    const L = this.level;

    // --- base gradient: smooth, continuous across chunk AND
    // section boundaries (sampled from a world-space color fn) ---
    const grad = ctx.createLinearGradient(0, 0, 0, CHUNK_H);
    for (let f = 0; f <= 1.001; f += 0.125) {
      const c = smoothGroundColor(L, y0 + f * CHUNK_H);
      grad.addColorStop(Math.min(f, 1), `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`);
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, -1, VIEW_W, CHUNK_H + 2);

    // --- soil noise ---
    for (let n = 0; n < 850; n++) {
      const x = rng() * VIEW_W, y = rng() * CHUNK_H;
      const d = rng();
      ctx.fillStyle = d < 0.5
        ? `rgba(20,26,10,${0.05 + rng() * 0.12})`
        : `rgba(150,160,90,${0.04 + rng() * 0.08})`;
      const s = 1.5 + rng() * 3.5;
      ctx.fillRect(x, y, s, s * (0.5 + rng()));
    }
    // mud patches
    for (let n = 0; n < 9; n++) {
      ctx.fillStyle = `rgba(52,44,26,${0.12 + rng() * 0.15})`;
      ctx.beginPath();
      ctx.ellipse(rng() * VIEW_W, rng() * CHUNK_H, 20 + rng() * 60, 12 + rng() * 30, rng() * TAU, 0, TAU);
      ctx.fill();
    }

    // --- grass tufts + ferns (denser in jungle sections) ---
    for (let n = 0; n < 130; n++) {
      const x = PLAY_X0 + rng() * (PLAY_X1 - PLAY_X0);
      const y = rng() * CHUNK_H;
      const sec = L.sectionAt(y0 + y);
      if (sec === 'camp' || sec === 'arena' || sec === 'trench') { if (rng() < 0.7) continue; }
      if (this.inWaterRect(y0 + y)) continue;
      ctx.strokeStyle = `rgba(${90 + (rng() * 50) | 0},${130 + (rng() * 50) | 0},60,0.5)`;
      ctx.lineWidth = 1.4;
      for (let b = 0; b < 3; b++) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (rng() - 0.5) * 8, y - 4 - rng() * 5);
        ctx.stroke();
      }
    }
    for (let n = 0; n < 22; n++) {
      const x = PLAY_X0 + rng() * (PLAY_X1 - PLAY_X0);
      const y = rng() * CHUNK_H;
      const sec = L.sectionAt(y0 + y);
      if (sec !== 'jungle' && sec !== 'clearing' && sec !== 'river' && sec !== 'extraction') continue;
      if (this.inWaterRect(y0 + y)) continue;
      drawFern(ctx, x, y, 7 + rng() * 9, rng);
    }

    // --- dirt road with wheel ruts ---
    for (let ly = -10; ly < CHUNK_H + 10; ly += 7) {
      const wy = y0 + ly;
      if (this.inWaterRect(wy)) continue; // the bridge carries the road
      const cx = L.pathXAt(wy);
      const wob = Math.sin(wy * 0.02) * 5;
      ctx.fillStyle = 'rgba(118,98,62,0.95)';
      ctx.fillRect(cx - 62 + wob, ly, 124, 8);
      ctx.fillStyle = 'rgba(100,82,50,0.5)'; // soft edges
      ctx.fillRect(cx - 74 + wob, ly, 12, 8);
      ctx.fillRect(cx + 62 + wob, ly, 12, 8);
      // ruts
      ctx.fillStyle = 'rgba(74,60,36,0.8)';
      ctx.fillRect(cx - 22 + wob, ly, 7, 8);
      ctx.fillRect(cx + 15 + wob, ly, 7, 8);
    }
    // road pebbles
    for (let n = 0; n < 60; n++) {
      const ly = rng() * CHUNK_H;
      if (this.inWaterRect(y0 + ly)) continue;
      const cx = L.pathXAt(y0 + ly) + (rng() - 0.5) * 120;
      ctx.fillStyle = `rgba(150,135,100,${0.2 + rng() * 0.3})`;
      ctx.beginPath(); ctx.arc(cx, ly, 1 + rng() * 2, 0, TAU); ctx.fill();
    }

    // --- river + bridge ---
    this.paintRiver(ctx, y0, rng);

    // --- trenches ---
    for (const tr of L.trenches) {
      if (tr.y + 26 < y0 || tr.y - 26 > y0 + CHUNK_H) continue;
      const ly = tr.y - y0;
      ctx.fillStyle = '#2c2516';
      roundRect(ctx, tr.x0, ly - 17, tr.x1 - tr.x0, 34, 16);
      ctx.fill();
      ctx.fillStyle = 'rgba(190,170,120,0.35)'; // lip highlight
      ctx.fillRect(tr.x0 + 6, ly - 20, tr.x1 - tr.x0 - 12, 4);
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(tr.x0 + 6, ly + 14, tr.x1 - tr.x0 - 12, 4);
      // duckboards
      ctx.fillStyle = 'rgba(110,90,56,0.55)';
      for (let bx = tr.x0 + 14; bx < tr.x1 - 14; bx += 30) {
        ctx.fillRect(bx, ly - 12, 8, 24);
      }
    }

    // --- jungle walls on both flanks ---
    for (const [x0, x1, inward] of [[0, PLAY_X0, 1], [PLAY_X1, VIEW_W, -1]]) {
      const g = ctx.createLinearGradient(x0, 0, x1, 0);
      if (inward === 1) { g.addColorStop(0, '#141d0b'); g.addColorStop(1, '#1f2c11'); }
      else { g.addColorStop(0, '#1f2c11'); g.addColorStop(1, '#141d0b'); }
      ctx.fillStyle = g;
      ctx.fillRect(x0, -1, x1 - x0, CHUNK_H + 2);
      // overhanging leaf clumps along the inner edge
      const edge = inward === 1 ? x1 : x0;
      for (let n = 0; n < 26; n++) {
        const y = rng() * CHUNK_H;
        const r = 10 + rng() * 22;
        const shade = 30 + rng() * 30;
        ctx.fillStyle = `rgb(${(shade * 0.8) | 0},${(shade + 25) | 0},${(shade * 0.55) | 0})`;
        ctx.beginPath();
        ctx.ellipse(edge + inward * rng() * 26, y, r, r * 0.6, rng() * TAU, 0, TAU);
        ctx.fill();
      }
    }

    // --- extraction pad marker near the top of the level ---
    if (y0 < 320) {
      const lm = L.landmarks.extraction;
      const px = lm.x, py = lm.y - 5 - y0;
      if (py > -90 && py < CHUNK_H + 90) {
        ctx.fillStyle = 'rgba(220,215,190,0.18)';
        ctx.beginPath(); ctx.arc(px, py, 80, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(235,225,190,0.6)';
        ctx.lineWidth = 5;
        ctx.beginPath(); ctx.arc(px, py, 70, 0, TAU); ctx.stroke();
        ctx.font = 'bold 44px "Arial Black", sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(235,225,190,0.6)';
        ctx.fillText('E', px, py + 2);
      }
    }
    return cv;
  }

  inWaterRect(wy) {
    const r = this.level.river;
    return wy > r.y0 && wy < r.y1;
  }

  paintRiver(ctx, y0, rng) {
    const r = this.level.river;
    if (r.y1 < y0 - 20 || r.y0 > y0 + CHUNK_H + 20) return;
    const top = r.y0 - y0, bot = r.y1 - y0;

    // sandy banks
    ctx.fillStyle = '#8d7c50';
    ctx.fillRect(0, top - 14, VIEW_W, 14);
    ctx.fillRect(0, bot, VIEW_W, 14);
    ctx.fillStyle = 'rgba(60,50,28,0.35)';
    ctx.fillRect(0, top - 3, VIEW_W, 3);
    ctx.fillRect(0, bot, VIEW_W, 3);

    // water body
    const g = ctx.createLinearGradient(0, top, 0, bot);
    g.addColorStop(0, '#2e4f60');
    g.addColorStop(0.5, '#1e3a49');
    g.addColorStop(1, '#2a4a59');
    ctx.fillStyle = g;
    ctx.fillRect(0, top, VIEW_W, bot - top);
    // static depth streaks
    for (let n = 0; n < 26; n++) {
      ctx.fillStyle = `rgba(12,26,34,${0.15 + rng() * 0.2})`;
      ctx.fillRect(rng() * VIEW_W, top + 8 + rng() * (bot - top - 16), 30 + rng() * 80, 2 + rng() * 3);
    }

    // bridge: planks over the road crossing
    const bx = r.bridgeX, half = r.bridgeHalf;
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; // bridge shadow on water
    ctx.fillRect(bx - half - 6, top + 4, half * 2 + 12, bot - top);
    const wood = ctx.createLinearGradient(bx - half, 0, bx + half, 0);
    wood.addColorStop(0, '#6b563a'); wood.addColorStop(0.5, '#83694a'); wood.addColorStop(1, '#5d4a32');
    ctx.fillStyle = wood;
    ctx.fillRect(bx - half, top - 16, half * 2, bot - top + 32);
    ctx.strokeStyle = 'rgba(40,30,18,0.6)';
    ctx.lineWidth = 2;
    for (let py = top - 14; py < bot + 16; py += 11) {
      ctx.beginPath(); ctx.moveTo(bx - half + 2, py); ctx.lineTo(bx + half - 2, py); ctx.stroke();
    }
    // side rails
    ctx.fillStyle = '#3f3220';
    ctx.fillRect(bx - half - 5, top - 16, 7, bot - top + 32);
    ctx.fillRect(bx + half - 2, top - 16, 7, bot - top + 32);
  }

  // ---------- persistent decals (painted into chunks) ----------

  paintInto(x, y, margin, fn) {
    // ±1: chunks display a 1px bleed row beyond their band, so a
    // decal ending in that row must paint the neighbor too
    const i0 = Math.floor((y - margin - 1) / CHUNK_H);
    const i1 = Math.floor((y + margin + 1) / CHUNK_H);
    for (let i = i0; i <= i1; i++) {
      const c = this.chunk(i);
      if (!c) continue;
      const ctx = c.getContext('2d');
      ctx.save();
      ctx.translate(0, -i * CHUNK_H + 1); // +1: chunk bleed offset
      fn(ctx);
      ctx.restore();
    }
  }

  scorch(x, y, r, force = false) {
    if (this.inWaterRect(y) && !force) return; // no craters in the river (bridge deck passes force)
    this.paintInto(x, y, r, (ctx) => {
      const g = ctx.createRadialGradient(x, y, 2, x, y, r);
      g.addColorStop(0, 'rgba(12,10,8,0.6)');
      g.addColorStop(0.55, 'rgba(18,14,10,0.4)');
      g.addColorStop(1, 'rgba(20,16,10,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(8,6,4,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, r * 0.45, 0, TAU); ctx.stroke();
    });
  }

  paintCorpse(x, y, ang, pal) {
    this.paintInto(x, y, 30, (ctx) => {
      // blood pool
      ctx.fillStyle = 'rgba(110,18,14,0.4)';
      ctx.beginPath(); ctx.ellipse(x + 3, y + 3, 14, 9, ang, 0, TAU); ctx.fill();
      // prone figure
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = pal.uniformDark;
      ctx.beginPath(); ctx.ellipse(0, 0, 11, 6, 0, 0, TAU); ctx.fill();  // torso
      ctx.fillStyle = pal.uniform;
      ctx.beginPath(); ctx.ellipse(-8, 1, 6, 4, 0.3, 0, TAU); ctx.fill(); // legs
      ctx.fillStyle = pal.skin;
      ctx.beginPath(); ctx.arc(9, -2, 4, 0, TAU); ctx.fill();             // head
      ctx.fillStyle = pal.helmet;
      ctx.beginPath(); ctx.arc(13, 2, 4.5, 0, TAU); ctx.fill();           // dropped helmet
      ctx.restore();
      ctx.globalAlpha = 1;
    });
  }

  // NOTE: decal painters that use randomness must seed it from the
  // decal position — paintInto replays the callback once per
  // overlapped chunk, and Math.random() would draw mismatched halves
  // across a chunk seam.
  paintWreck(x, y, ang, scale = 1) {
    this.paintInto(x, y, 80 * scale, (ctx) => {
      const rng = mulberry32(((x * 73856093) ^ (y * 19349663)) | 0);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = '#1c1a14';
      roundRect(ctx, -34 * scale, -20 * scale, 68 * scale, 40 * scale, 8);
      ctx.fill();
      ctx.fillStyle = '#2e2a20';
      roundRect(ctx, -26 * scale, -14 * scale, 52 * scale, 28 * scale, 6);
      ctx.fill();
      ctx.fillStyle = 'rgba(80,60,30,0.5)';
      for (let n = 0; n < 6; n++) {
        ctx.beginPath();
        ctx.arc((rng() - 0.5) * 60 * scale, (rng() - 0.5) * 36 * scale, 2 + rng() * 4, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    });
    this.scorch(x, y, 70 * scale);
  }

  paintRubble(x, y, r, col) {
    this.paintInto(x, y, r + 10, (ctx) => {
      const rng = mulberry32(((x * 73856093) ^ (y * 19349663)) | 0);
      for (let n = 0; n < 12; n++) {
        const a = rng() * TAU, d = rng() * r;
        ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${0.4 + rng() * 0.4})`;
        ctx.save();
        ctx.translate(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.7);
        ctx.rotate(a);
        ctx.fillRect(-3, -2, 6 + rng() * 5, 4);
        ctx.restore();
      }
    });
  }
}

// ---------- little helpers ----------

function hexToRgb(h) {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

// Piecewise ground color: blend top→bottom within each section.
function rawGroundColor(L, wy) {
  wy = clamp(wy, 0, LEVEL_H - 1);
  let sec = L.sections[L.sections.length - 1];
  for (const s of L.sections) if (wy >= s.y0 && wy < s.y1) { sec = s; break; }
  const pal = SECTION_PALS[sec.type] || SECTION_PALS.jungle;
  const a = hexToRgb(pal.top), b = hexToRgb(pal.bottom);
  const t = clamp((wy - sec.y0) / (sec.y1 - sec.y0), 0, 1);
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

// Averaged over a ±90px window so section borders melt together.
function smoothGroundColor(L, wy) {
  const a = rawGroundColor(L, wy - 90);
  const b = rawGroundColor(L, wy);
  const c = rawGroundColor(L, wy + 90);
  return [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawFern(ctx, x, y, size, rng) {
  ctx.strokeStyle = `rgba(${50 + (rng() * 30) | 0},${100 + (rng() * 40) | 0},45,0.6)`;
  ctx.lineWidth = 1.3;
  for (let f = 0; f < 5; f++) {
    const a = -Math.PI / 2 + (f - 2) * 0.5 + (rng() - 0.5) * 0.2;
    const ex = x + Math.cos(a) * size, ey = y + Math.sin(a) * size * 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a) * size * 0.5, y + Math.sin(a) * size * 0.5 - 2, ex, ey);
    ctx.stroke();
  }
}
