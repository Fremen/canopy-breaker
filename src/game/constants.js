// ============================================================
// constants.js — the tuning table. One place to balance the
// whole game: dimensions, player feel, weapons, grenades,
// pickups, combo scoring. Enemy stat blocks live with their AI
// in enemies.js; level layout lives in level.js.
// ============================================================

// World/view geometry. World x maps 1:1 to the logical view, so
// only y scrolls. The playfield sits between two impassable
// jungle walls.
export const VIEW_W = 1100;
export const PLAY_X0 = 110;
export const PLAY_X1 = 990;
export const LEVEL_H = 7600;

export const PLAYER = {
  speed: 272,           // px/s — instant accel, arcade-precise
  radius: 13,
  hp: 100,
  lives: 3,
  hurtInvuln: 0.9,      // i-frames after taking a hit
  respawnInvuln: 2.6,   // i-frames after losing a life
  grenadesStart: 4,
  grenadesMax: 8,
};

export const RIFLE = {
  rof: 8.5,             // rounds/sec
  dmg: 14,
  speed: 980,           // bullet px/s — fast and readable
  jitter: 0.028,        // base spread (radians)
};

export const POWERUPS = {
  rapidRofMult: 1.7,
  rapidTime: 10,
  spreadShots: 3,
  spreadArc: 0.21,      // total fan angle (radians)
  spreadDmg: 11,
  spreadTime: 10,
  shieldTime: 7,
  medkitHeal: 40,
};

export const GRENADE = {
  rangeMin: 90,
  rangeMax: 440,
  flightTime: 0.62,
  radius: 96,
  dmg: 95,              // at center, falls off to ~35% at edge
  arcHeight: 70,
};

export const COMBO = {
  window: 2.0,          // seconds between kills to keep the chain
  killsPerTier: 4,      // chain kills per +1 multiplier
  maxMult: 8,
};

export const SCORING = {
  rescueBonus: 1500,
  accuracyBonusMax: 3000,
  grenadeKillBonus: 60,
  timePar: 420,         // seconds; finish faster → bonus
  timeBonusPerSec: 25,
  grades: [             // composite score thresholds (top-down check)
    { grade: 'S', min: 58000 },
    { grade: 'A', min: 42000 },
    { grade: 'B', min: 27000 },
    { grade: 'C', min: 0 },
  ],
};
