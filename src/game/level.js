// ============================================================
// level.js — LEVEL 1: "JUNGLE INFILTRATION"
//
// World y runs 7600 (start, bottom) → 0 (extraction, top):
//
//   0– 450  extraction clearing (flare pad)
//  450–1450  BOSS ARENA — fortified motor pool
// 1450–2400  stronghold approach (gauntlet)
// 2400–3900  fortified camp (tents, towers, fuel depot, gate)
// 3900–4900  trench lines
// 4900–5600  river + bridge chokepoint
// 5600–6800  jungle road (checkpoints, ambushes)
// 6800–7600  insertion clearing (tutorial pacing)
//
// Everything data-driven: the path spline, hand-placed set
// pieces, hostage spots, and the progress-triggered wave script
// (difficulty escalates by composition, not just count).
// ============================================================

import { mulberry32, clamp, lerp } from '../core/math.js';
import { Prop, Hostage } from './props.js';
import { PLAY_X0, PLAY_X1, LEVEL_H } from './constants.js';

const SECTIONS = [
  { y0: 0,    y1: 450,  type: 'extraction' },
  { y0: 450,  y1: 1450, type: 'arena' },
  { y0: 1450, y1: 3900, type: 'camp' },
  { y0: 3900, y1: 4900, type: 'trench' },
  { y0: 4900, y1: 5600, type: 'river' },
  { y0: 5600, y1: 6800, type: 'jungle' },
  { y0: 6800, y1: 7600, type: 'clearing' },
];

// Road centerline control points, top → bottom.
const PATH = [
  [0, 550], [1450, 550], [1700, 555], [2100, 545], [2450, 560],
  [2800, 540], [3150, 590], [3500, 540], [3850, 560], [4150, 620],
  [4500, 520], [4800, 500], [5060, 560], [5240, 560], [5400, 565],
  [5800, 600], [6250, 430], [6700, 470], [7150, 580], [7600, 550],
];

const RIVER = { y0: 5060, y1: 5240, bridgeX: 560, bridgeHalf: 72 };

const TRENCHES = [
  { y: 4650, x0: 220, x1: 680 },
  { y: 4350, x0: 430, x1: 920 },
];

const HOSTAGE_SPOTS = [
  [300, 6150],   // jungle clearing, off the road
  [840, 3480],   // inside the camp, behind the fuel depot
  [430, 2620],   // north camp, guarded
];

function pathXAt(y) {
  y = clamp(y, 0, LEVEL_H);
  for (let i = 0; i < PATH.length - 1; i++) {
    const [y0, x0] = PATH[i], [y1, x1] = PATH[i + 1];
    if (y >= y0 && y <= y1) return lerp(x0, x1, (y - y0) / (y1 - y0));
  }
  return 550;
}

function sectionAt(y) {
  for (const s of SECTIONS) if (y >= s.y0 && y < s.y1) return s.type;
  return y < 0 ? 'extraction' : 'clearing';
}

// ---------- props ----------

function buildProps() {
  const props = [];
  const rng = mulberry32(99173);
  const P = (type, x, y, opts) => props.push(new Prop(type, x, y, opts));

  // --- procedural tree + rock scatter ---
  const treeOk = (x, y) => {
    const sec = sectionAt(y);
    if (sec === 'arena' || sec === 'extraction') return false;
    if ((sec === 'camp' || sec === 'trench') && rng() > 0.12) return false;
    if (Math.abs(x - pathXAt(y)) < 95) return false;
    if (y > RIVER.y0 - 70 && y < RIVER.y1 + 70) return false;
    for (const [hx, hy] of HOSTAGE_SPOTS) {
      if ((x - hx) ** 2 + (y - hy) ** 2 < 80 * 80) return false;
    }
    return true;
  };
  for (let y = 480; y < LEVEL_H - 60; y += 46) {
    if (rng() < 0.62) {
      const side = rng() < 0.5;
      const x = side ? PLAY_X0 + 16 + rng() * 130 : PLAY_X1 - 16 - rng() * 130;
      if (treeOk(x, y)) P('tree', x, y, { canopy: 30 + rng() * 26 });
    }
    if (rng() < 0.16) {
      const x = PLAY_X0 + 120 + rng() * (PLAY_X1 - PLAY_X0 - 240);
      if (treeOk(x, y)) P('tree', x, y, { canopy: 34 + rng() * 22 });
    }
  }
  for (let n = 0; n < 16; n++) {
    const y = 500 + rng() * (LEVEL_H - 700);
    const x = PLAY_X0 + 40 + rng() * (PLAY_X1 - PLAY_X0 - 80);
    if (treeOk(x, y)) P('rock', x, y);
  }

  // --- insertion clearing: tutorial toys ---
  P('crate', 460, 7180, { loot: 'grenade' });
  P('barrel', 660, 7060); P('barrel', 690, 7090);
  P('sandbag', 520, 6950); P('sandbag', 600, 6950);

  // --- jungle road checkpoints ---
  const cp1 = pathXAt(6450);
  P('sandbag', cp1 - 64, 6450); P('sandbag', cp1, 6442); P('sandbag', cp1 + 64, 6450);
  P('barrel', cp1 + 130, 6420);
  P('crate', cp1 - 140, 6430);
  P('barrel', 350, 6100); P('barrel', 382, 6128);
  P('crate', 820, 5950, { loot: 'rapid' });
  const cp2 = pathXAt(5520);
  P('sandbag', cp2 - 64, 5520); P('sandbag', cp2, 5512); P('sandbag', cp2 + 64, 5520);
  P('crate', 720, 5470, { loot: 'medkit' });

  // --- river banks ---
  P('sandbag', 300, 5330); P('sandbag', 810, 5320);
  P('sandbag', 470, 4980); P('sandbag', 660, 4985);

  // --- trench lines: sandbag lips ---
  for (let x = 250; x <= 650; x += 68) P('sandbag', x, 4694, { vert: false });
  for (let x = 460; x <= 890; x += 68) P('sandbag', x, 4394, { vert: false });
  P('barrel', 720, 4520); P('crate', 250, 4470, { loot: 'grenade' });
  P('rock', 360, 4520);

  // --- camp gate: palisade with a road gap ---
  const gateX = pathXAt(3850);
  for (let x = PLAY_X0 + 22, i = 0; x < PLAY_X1 - 10; x += 42, i++) {
    if (Math.abs(x - gateX) < 85) continue;
    P('wall', x, 3850 + (i % 2) * 6);
  }
  P('tower', 330, 3880); P('tower', 800, 3880);

  // --- camp interior ---
  P('tent', 270, 3590); P('tent', 850, 3620); P('tent', 300, 2950); P('tent', 820, 2750);
  // fuel depot (chain reaction bait)
  P('barrel', 680, 3270); P('barrel', 722, 3282); P('barrel', 700, 3322);
  P('barrel', 742, 3334); P('barrel', 662, 3320);
  P('crate', 450, 3450, { loot: 'spread' });
  P('crate', 620, 3150, { loot: 'grenade' });
  P('crate', 380, 2850, { loot: 'shield' });
  P('crate', 750, 2580, { loot: 'medkit' });
  P('sandbag', 500, 3050); P('sandbag', 566, 3044); P('sandbag', 632, 3050);
  P('sandbag', 350, 2700); P('sandbag', 416, 2700);
  P('tower', 180, 3200); P('tower', 900, 2900);
  P('fence', 200, 3700, { vert: true }); P('fence', 200, 3640, { vert: true });
  P('fence', 910, 3350, { vert: true }); P('fence', 910, 3290, { vert: true });

  // --- stronghold approach ---
  const ap = pathXAt(2150);
  P('sandbag', ap - 70, 2150); P('sandbag', ap, 2142); P('sandbag', ap + 70, 2150);
  P('barrel', 480, 1900); P('barrel', 516, 1924);
  P('crate', 650, 1750, { loot: 'rapid' });
  P('crate', 400, 1620, { loot: 'grenade' });
  P('rock', 700, 2050); P('rock', 260, 1980);

  // --- pre-boss resupply ---
  P('crate', 520, 1530, { loot: 'medkit' });
  P('crate', 600, 1530, { loot: 'grenade' });

  // --- boss arena: sparse cover, explosive corners ---
  P('rock', 250, 700); P('rock', 850, 650); P('rock', 300, 1200); P('rock', 820, 1250);
  P('barrel', 200, 920); P('barrel', 884, 1010);

  // --- hostage stakes ---
  for (const [hx, hy] of HOSTAGE_SPOTS) P('stake', hx, hy - 6);

  return props;
}

// ---------- wave script ----------
// atY: fires when the player pushes above this world-y.

const TRIGGERS = [
  { atY: 7240, message: 'PUSH NORTH', spawn: [
    { type: 'rifleman', from: 'top', count: 2, stagger: 0.6 },
  ]},
  { atY: 7000, spawn: [
    { type: 'rifleman', from: 'top', count: 3, stagger: 0.5 },
  ]},
  { atY: 6760, spawn: [
    { type: 'rusher', from: 'left', count: 3, stagger: 0.5 },
    { type: 'rifleman', from: 'top', count: 1, delay: 1 },
  ]},
  { atY: 6520, spawn: [
    { type: 'rifleman', from: 'top', count: 3, stagger: 0.45 },
    { type: 'grenadier', from: 'top', count: 1, delay: 1.2 },
  ]},
  { atY: 6220, spawn: [
    { type: 'strafer', from: 'top', count: 2, stagger: 0.8 },
    { type: 'rifleman', from: 'top', count: 1, delay: 0.6 },
  ]},
  { atY: 5950, spawn: [
    { type: 'rifleman', from: 'top', count: 2, stagger: 0.5 },
    { type: 'grenadier', from: 'top', count: 1 },
    { type: 'rusher', from: 'right', count: 2, stagger: 0.4, delay: 1.5 },
  ]},
  { atY: 5650, message: 'RIVER CROSSING AHEAD', spawn: [
    { type: 'rusher', from: 'left', count: 2, stagger: 0.4 },
    { type: 'rusher', from: 'right', count: 2, stagger: 0.4, delay: 0.7 },
    { type: 'bunker', from: 'point', x: 560, y: 4952, facing: Math.PI / 2 },
  ]},
  { atY: 5460, spawn: [
    { type: 'rifleman', from: 'top', count: 2, stagger: 0.7 },
    { type: 'grenadier', from: 'top', count: 1, delay: 1.4 },
  ]},
  { atY: 5120, spawn: [ // crossing the bridge — counterattack on the far bank
    { type: 'technical', from: 'point', x: 850, y: 4760,
      waypoints: [{ x: 850, y: 4760 }, { x: 250, y: 4760 }] },
    { type: 'rifleman', from: 'top', count: 2, stagger: 0.6, delay: 0.8 },
  ]},
  { atY: 4790, spawn: [ // trench line 1 pops up
    { type: 'rifleman', from: 'point', x: 280, y: 4650, ambush: true },
    { type: 'rifleman', from: 'point', x: 450, y: 4645, ambush: true, delay: 0.3 },
    { type: 'rifleman', from: 'point', x: 620, y: 4655, ambush: true, delay: 0.6 },
    { type: 'grenadier', from: 'top', count: 1, delay: 1.6 },
  ]},
  { atY: 4480, spawn: [ // trench line 2 + flankers
    { type: 'rifleman', from: 'point', x: 520, y: 4350, ambush: true },
    { type: 'rifleman', from: 'point', x: 760, y: 4345, ambush: true, delay: 0.3 },
    { type: 'strafer', from: 'top', count: 2, stagger: 0.8, delay: 0.8 },
    { type: 'rusher', from: 'left', count: 2, stagger: 0.5, delay: 1.4 },
    { type: 'bunker', from: 'point', x: 560, y: 3760, facing: Math.PI / 2 }, // pre-seeded gate bunker
  ]},
  { atY: 4060, message: 'BREACH THE CAMP GATE', spawn: [
    { type: 'rifleman', from: 'top', count: 3, stagger: 0.5 },
    { type: 'grenadier', from: 'top', count: 1, delay: 1.5 },
  ]},
  { atY: 3700, spawn: [ // camp interior
    { type: 'rifleman', from: 'top', count: 3, stagger: 0.45 },
    { type: 'strafer', from: 'top', count: 2, stagger: 0.9, delay: 0.7 },
    { type: 'rusher', from: 'right', count: 2, stagger: 0.5, delay: 1.8 },
  ]},
  { atY: 3380, spawn: [ // fuel depot fight — shoot the barrels
    { type: 'grenadier', from: 'top', count: 2, stagger: 1.1 },
    { type: 'rifleman', from: 'top', count: 2, stagger: 0.5, delay: 0.6 },
  ]},
  { atY: 3120, spawn: [
    { type: 'technical', from: 'point', x: 180, y: 2820,
      waypoints: [{ x: 180, y: 2820 }, { x: 900, y: 2845 }] },
    { type: 'strafer', from: 'top', count: 2, stagger: 0.8, delay: 1 },
  ]},
  { atY: 2840, spawn: [ // hostage guards
    { type: 'rifleman', from: 'top', count: 4, stagger: 0.4 },
    { type: 'grenadier', from: 'top', count: 1, delay: 1.2 },
    { type: 'rusher', from: 'left', count: 2, stagger: 0.5, delay: 2 },
  ]},
  { atY: 2520, spawn: [
    { type: 'rifleman', from: 'top', count: 2, stagger: 0.5 },
    { type: 'strafer', from: 'top', count: 2, stagger: 0.9, delay: 0.5 },
  ]},
  { atY: 2240, message: 'STRONGHOLD APPROACH', spawn: [
    { type: 'rifleman', from: 'top', count: 3, stagger: 0.45 },
    { type: 'grenadier', from: 'top', count: 2, stagger: 1.2, delay: 0.8 },
    { type: 'rusher', from: 'left', count: 2, stagger: 0.6, delay: 1.4 },
    { type: 'rusher', from: 'right', count: 1, delay: 2.2 },
  ]},
  { atY: 1950, spawn: [
    { type: 'strafer', from: 'top', count: 3, stagger: 0.7 },
    { type: 'grenadier', from: 'top', count: 2, stagger: 1.3, delay: 1 },
  ]},
  { atY: 1680, message: 'ENEMY ARMOR DETECTED', spawn: [
    { type: 'rifleman', from: 'top', count: 3, stagger: 0.5 },
    { type: 'rusher', from: 'right', count: 2, stagger: 0.5, delay: 1.2 },
  ]},
  { atY: 1430, boss: true },
];

export function createLevel() {
  return {
    height: LEVEL_H,
    playerStart: { x: 550, y: 7350 },
    sections: SECTIONS,
    sectionAt,
    pathXAt,
    river: RIVER,
    trenches: TRENCHES,
    arena: { top: 490, bottom: 1430 },
    // single source of truth for landmark coordinates — the HUD
    // progress spine, the extraction flare, and the victory line
    // all read from here
    landmarks: {
      river: 5150,
      gate: 3850,
      boss: 950,
      extraction: { x: 550, y: 205 },
      winY: 300,
    },
    buildProps,
    buildHostages: () => HOSTAGE_SPOTS.map(([x, y]) => new Hostage(x, y)),
    triggers: TRIGGERS,
  };
}
