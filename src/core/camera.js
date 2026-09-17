// ============================================================
// camera.js — vertical-scroll camera with trauma-based shake.
//
// World x spans [0, VIEW_W] and matches the screen 1:1, so the
// camera only tracks y. Scrolling RATCHETS: it follows the
// player upward but never back down — classic run-and-gun
// forward pressure. Shake uses the trauma model (shake amount
// = trauma², decaying linearly) so small hits feel small and
// explosions feel huge without manual tuning per event.
// ============================================================

import { clamp, lerp, damp } from './math.js';
import { Settings } from './settings.js';

export class Camera {
  constructor(viewW, viewH, levelH) {
    this.viewW = viewW;
    this.viewH = viewH;
    this.levelH = levelH;
    this.y = levelH - viewH;       // top of view, world coords
    this.trauma = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.lockY = null;             // boss arena: camera pinned here
    this._t = 0;
  }

  // Place the player ~62% down the screen so most of the view shows
  // what's ahead (the direction of travel).
  follow(playerY, dt) {
    const target = clamp(playerY - this.viewH * 0.62, 0, this.levelH - this.viewH);
    if (this.lockY !== null) {
      // Smoothly settle onto the arena lock position.
      this.y = lerp(this.y, this.lockY, damp(4, dt));
    } else if (target < this.y) {
      // Ratchet: only scroll up (decreasing y). Snappy but smoothed.
      this.y = lerp(this.y, target, damp(10, dt));
    }
  }

  addShake(amount) {
    this.trauma = clamp(this.trauma + amount, 0, 1);
  }

  update(dt) {
    this._t += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const s = this.trauma * this.trauma * 16 * Settings.screenShake;
    // Incommensurate frequencies → organic, non-circular wobble.
    this.shakeX = s * Math.sin(this._t * 127.3);
    this.shakeY = s * Math.sin(this._t * 161.7 + 2.1);
  }

  // Is a world-space point near the visible window? (margin in px)
  onScreen(y, margin = 60) {
    return y > this.y - margin && y < this.y + this.viewH + margin;
  }
}
