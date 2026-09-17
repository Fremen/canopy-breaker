// ============================================================
// score.js — arcade scoring: combo multiplier, accuracy,
// grenade efficiency, rescues, time bonus, end-of-level grade.
//
// The combo chain is the aggression driver: every kill refreshes
// a 2s window; every 4 chained kills bumps the multiplier
// (×1 → ×8). Dying breaks the chain. The final grade is computed
// from the composite score, so all bonuses funnel into one
// number the player can chase.
// ============================================================

import { clamp } from '../core/math.js';
import { COMBO, SCORING } from './constants.js';
import { BOSS_SCORE } from './boss.js';

export class ScoreSystem {
  constructor() {
    this.score = 0;
    this.kills = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.grenadesThrown = 0;
    this.grenadeKills = 0;
    this.rescues = 0;
    this.combo = 0;          // current chain length
    this.comboTimer = 0;
    this.maxCombo = 0;
    this.bossKilled = false;
  }

  get multiplier() {
    return clamp(1 + Math.floor(this.combo / COMBO.killsPerTier), 1, COMBO.maxMult);
  }

  registerShots(n) { this.shotsFired += n; }
  registerHit() { this.shotsHit++; }
  registerGrenade() { this.grenadesThrown++; }
  addRescue() { this.rescues++; }

  addPoints(pts) {
    this.score += pts;
    return pts;
  }

  // Returns the awarded points so the caller can show a popup.
  addKill(enemy, src) {
    this.combo++;
    this.comboTimer = COMBO.window;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    if (src === 'grenade') this.grenadeKills++;
    this.kills++;
    const pts = enemy.def.score * this.multiplier;
    this.score += pts;
    return pts;
  }

  addBossKill() {
    this.bossKilled = true;
    this.score += BOSS_SCORE;
    return BOSS_SCORE;
  }

  breakCombo() { this.combo = 0; this.comboTimer = 0; }

  update(dt) {
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }
  }

  get accuracy() {
    return this.shotsFired > 0 ? this.shotsHit / this.shotsFired : 0;
  }

  // End-of-level tally. `timeSec` = mission time, `victory` gates the time bonus.
  finalize(timeSec, victory) {
    const accuracyBonus = Math.round(this.accuracy * SCORING.accuracyBonusMax);
    const grenadeBonus = this.grenadeKills * SCORING.grenadeKillBonus;
    const timeBonus = victory
      ? Math.min(5000, Math.max(0, Math.round((SCORING.timePar - timeSec) * SCORING.timeBonusPerSec)))
      : 0;
    const total = this.score + accuracyBonus + grenadeBonus + timeBonus;
    let grade = 'C';
    for (const g of SCORING.grades) {
      if (total >= g.min) { grade = g.grade; break; }
    }
    if (!victory) grade = 'C';
    return {
      base: this.score,
      kills: this.kills,
      rescues: this.rescues,
      maxCombo: this.maxCombo,
      maxMultiplier: clamp(1 + Math.floor(this.maxCombo / COMBO.killsPerTier), 1, COMBO.maxMult),
      accuracy: this.accuracy,
      accuracyBonus,
      grenadeKills: this.grenadeKills,
      grenadeBonus,
      timeSec,
      timeBonus,
      total,
      grade,
    };
  }
}
