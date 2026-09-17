// ============================================================
// spawner.js — progress-triggered wave scripting.
//
// The level defines triggers: "when the player pushes past
// world-y N, spawn this group". Groups stagger their entries so
// waves flow in instead of popping, counts scale with the
// difficulty setting, and a global active-enemy cap keeps
// encounters tuned for fun instead of chaos (excess spawns wait
// for a free slot).
// ============================================================

import { rand, clamp, chance } from '../core/math.js';
import { difficulty } from '../core/settings.js';
import { Enemy } from './enemies.js';
import { PLAY_X0, PLAY_X1 } from './constants.js';

const MAX_ACTIVE = 22;

export class Spawner {
  constructor(triggers) {
    this.triggers = triggers.map((t) => ({ ...t, fired: false }));
    this.queue = [];
  }

  update(game, dt) {
    const py = game.player.y;
    for (const t of this.triggers) {
      if (!t.fired && py < t.atY) {
        t.fired = true;
        this.fire(game, t);
      }
    }
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const q = this.queue[i];
      q.delay -= dt;
      if (q.delay <= 0) {
        if (game.enemies.length >= MAX_ACTIVE) { q.delay = 0.5; continue; }
        this.spawnNow(game, q);
        this.queue.splice(i, 1);
      }
    }
  }

  fire(game, t) {
    if (t.boss) { game.startBossFight(); return; }
    if (t.message) game.addBanner(t.message);
    for (const s of t.spawn || []) {
      const baseCount = s.count ?? 1;
      // big-unit types don't scale up, infantry does
      const scales = s.type !== 'bunker' && s.type !== 'technical';
      const count = scales
        ? Math.max(1, Math.round(baseCount * difficulty().count))
        : baseCount;
      for (let i = 0; i < count; i++) {
        this.queue.push({ ...s, delay: (s.delay ?? 0) + i * (s.stagger ?? 0.4) });
      }
    }
  }

  spawnNow(game, s) {
    const cam = game.camera;
    let x, y, enter = null, ambush = false;

    switch (s.from ?? 'top') {
      case 'top':
        x = s.x ?? rand(PLAY_X0 + 60, PLAY_X1 - 60);
        y = cam.y - rand(40, 110);
        enter = { x: clamp(x + rand(-60, 60), PLAY_X0 + 40, PLAY_X1 - 40), y: cam.y + rand(120, 280) };
        break;
      case 'left':
      case 'right': {
        const left = s.from === 'left';
        x = left ? PLAY_X0 - 40 : PLAY_X1 + 40;
        y = s.y ?? game.player.y + rand(-160, 60);
        enter = { x: left ? PLAY_X0 + rand(60, 150) : PLAY_X1 - rand(60, 150), y };
        ambush = true;
        break;
      }
      case 'point': // hand-placed: bunkers, vehicles, trench poppers
        x = s.x; y = s.y;
        if (s.enter) enter = s.enter;
        ambush = !!s.ambush;
        break;
    }

    game.enemies.push(new Enemy(s.type, x, y, {
      enter, ambush,
      facing: s.facing,
      waypoints: s.waypoints,
    }));
  }
}
