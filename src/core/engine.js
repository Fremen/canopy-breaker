// ============================================================
// engine.js — main loop with juice controls.
//
// Variable timestep clamped to 50ms (tab-switch safe), plus two
// game-feel devices used everywhere:
//   • hitstop  — freeze the world a few ms on impactful kills
//   • timeScale — slow-motion ramp (big explosions, boss death)
// Render always runs so freezes look intentional, not janky.
// ============================================================

export class Engine {
  constructor(update, render) {
    this.updateFn = update;
    this.renderFn = render;
    this.last = performance.now();
    this.timeScale = 1;
    this._timeScaleTarget = 1;
    this._slowmoTimer = 0;
    this.hitstop = 0;
    this.running = false;
    this.frozen = false; // pause: stops juice timers from decaying
    this._raf = 0;
  }

  // Clear all juice state — called on restart so a new run never
  // begins inside a leftover slow-mo or hitstop window.
  reset() {
    this.timeScale = 1;
    this._timeScaleTarget = 1;
    this._slowmoTimer = 0;
    this.hitstop = 0;
    this.frozen = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now) => {
      if (!this.running) return;
      this._raf = requestAnimationFrame(tick);
      let raw = (now - this.last) / 1000;
      this.last = now;
      if (raw > 0.05) raw = 0.05;

      if (this.frozen) {
        // paused: keep processing input + rendering, but freeze
        // hitstop/slow-mo so earned effects survive the pause
        this.updateFn(0, raw);
        this.renderFn();
        return;
      }

      if (this.hitstop > 0) {
        this.hitstop -= raw;
      } else {
        // Slow-mo decays back to full speed automatically.
        if (this._slowmoTimer > 0) {
          this._slowmoTimer -= raw;
          if (this._slowmoTimer <= 0) this._timeScaleTarget = 1;
        }
        this.timeScale += (this._timeScaleTarget - this.timeScale) * Math.min(1, raw * 6);
        this.updateFn(raw * this.timeScale, raw);
      }
      this.renderFn();
    };
    this._raf = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
  }

  // Freeze world updates for `sec` (rendering continues).
  addHitstop(sec) {
    this.hitstop = Math.max(this.hitstop, sec);
  }

  // Drop to `scale` speed for `sec`, then ease back to 1.
  slowMo(scale, sec) {
    this._timeScaleTarget = scale;
    this.timeScale = Math.min(this.timeScale, scale + 0.2);
    this._slowmoTimer = sec;
  }
}
