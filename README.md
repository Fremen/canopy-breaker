# CANOPY BREAKER

A modern, top-down, vertical-scrolling run-and-gun arcade shooter in the spirit of
classic 1985 arcade action — built from scratch with **zero dependencies**:
HTML5 Canvas for rendering, WebAudio for fully synthesized sound and dynamic music.
All art is procedural vector drawing; all audio is generated — there are no assets,
copyrighted or otherwise, in the repository.

**One soldier. Enemy territory. No retreat.**

[Play Canopy Breaker](https://fremen.github.io/canopy-breaker/)

## Run it

The game is plain static files, but ES modules require HTTP (not `file://`):

```bash
cd canopy-breaker
npm start                          # localhost only (python3 http.server)
# open http://localhost:8000
```

That's it. No build step, no install.

**Play over LAN** (another machine, a laptop with a gamepad, etc.):

```bash
npm run start:lan                  # binds 0.0.0.0
# or: npx serve -l tcp://0.0.0.0:8000 .
```

Then on the other device open `http://<this-machine's-ip>:8000` — find the IP
with `ipconfig getifaddr en0` (macOS) or `hostname -I` (Linux). macOS may ask
to allow Python to accept incoming connections the first time; allow it.
Nothing in the game needs a secure context, so plain HTTP over LAN works
(gamepad, audio, and the saved best score all function normally — the best
score is stored per-browser, so each device keeps its own record).

## Controls

| Action  | Keyboard / Mouse | Gamepad |
|---------|------------------|---------|
| Move    | WASD / arrows    | Left stick / D-pad |
| Aim     | Mouse            | Right stick |
| Fire    | Left mouse       | Right trigger (or A) |
| Grenade | Space            | Left trigger / left bumper |
| Pause   | Esc / P          | Start |

Accessibility (Options menu): **auto-fire**, **aim assist**, **screen-shake
slider**, **high-contrast projectiles**, **slow-motion toggle**, **rumble toggle**,
and three difficulty levels. Plus an optional **retro CRT filter** (scanlines +
tube-edge falloff) for the full Amiga-era homage — off by default.

## The mission

Push north through *Canopy Breaker*: insertion clearing → jungle road
checkpoints → river bridge chokepoint → trench lines → fortified camp → the
WARLORD armored patrol vehicle → extraction flare. 5–7 minutes, escalating
pressure, three rescueable captive scouts, an S/A/B/C grade at the end.

Rifle ammo is unlimited; grenades are not. Barrels chain-explode. Crates drop
pickups. Kills within 2 seconds of each other chain a combo multiplier up to ×8.
Accuracy, speed, grenade efficiency and rescues all feed your final grade.
Your best score and rank persist locally and sit on the main menu, daring you
to beat them.

## Project layout

```
index.html            shell + DOM menus
styles.css            menu styling (in-game HUD is canvas)
src/main.js           bootstrap
src/core/             engine-agnostic plumbing
  math.js             vectors, angles, seeded RNG, easing
  settings.js         persisted options + difficulty multipliers
  input.js            keyboard + mouse + gamepad unified (incl. rumble)
  audio.js            synthesized SFX + dynamic-intensity music sequencer
  camera.js           ratcheting scroll camera, trauma-based shake
  engine.js           main loop, hitstop, slow-motion
src/game/             the game itself
  constants.js        ALL tuning numbers in one place
  level.js            sections, road spline, river, set pieces, wave script
  terrain.js          chunked pre-rendered ground + persistent decals
  player.js           movement / weapons / grenades / damage
  soldier.js          shared procedural soldier renderer (palette-driven)
  enemies.js          6 archetypes, state-machine AI, fairness rules
  boss.js             WARLORD: 3 phases (MG → mortars → ram)
  spawner.js          progress triggers, staggered waves, active cap
  projectiles.js      swept bullets, cover blocking, readability rules
  grenades.js         arcing grenades + landing telegraphs
  pickups.js          drops, magnetism, powerup timers
  props.js            destructible cover, hostages, collision resolution
  particles.js        pooled VFX (explosions, casings, smoke, debris)
  score.js            combo chain, bonuses, grading
  hud.js              canvas HUD: health, combo, progress spine, boss bar
  game.js             orchestrator: state machine, update order, renderer
  menus.js            DOM menu glue + options persistence
```

See [DESIGN.md](DESIGN.md) for mechanics, enemy design, scoring math, and the
expansion roadmap.

## Swapping in real assets

The code is structured so art/audio replacement is local:

- **Characters** — replace `drawSoldier()` in [soldier.js](src/game/soldier.js)
  (one function, palette-driven; every infantry unit uses it).
- **Terrain** — replace the `build()` painter in [terrain.js](src/game/terrain.js);
  the chunk cache, decals, and scrolling stay untouched.
- **SFX/music** — replace the `Sfx.*` bodies and the sequencer voices in
  [audio.js](src/core/audio.js); call sites don't change.
- **Tuning** — nearly every gameplay number lives in
  [constants.js](src/game/constants.js) and the stat tables at the top of
  [enemies.js](src/game/enemies.js).

## Originality note

This game is an original work inspired by the *feel* of 1985-era vertical
run-and-gun arcade games. It contains no copyrighted names, characters, sprites,
sounds, music, maps, or UI from any existing game.

Released under the [MIT License](LICENSE).
