# CANOPY BREAKER — Design Document

## Pillars

1. **Immediate** — input maps to motion with zero smoothing. The player owns
   every death.
2. **Readable** — anything that can hurt you is slower, brighter, and
   telegraphed. Your own bullets are fast and thin; you should be watching
   enemies, not your gunfire.
3. **Forward pressure** — the camera ratchets upward and never returns.
   Standing still is a choice the enemy punishes.
4. **Aggression pays** — combos, pickups dropped in the open, and a grade
   system that rewards accuracy *and* speed *and* risk.

## Core loop

Advance → trigger wave → read patterns, pick targets, manage grenades →
chain kills for multiplier → collect drops before they expire → advance.
A full run is 5–7 minutes; death costs a life and your combo, never progress.

## Game feel devices

| Device | Where |
|---|---|
| Hitstop (20–120 ms world freeze on kills/impacts) | `engine.addHitstop` |
| Trauma-based screen shake (shake = trauma², decays) | `camera.js` |
| Slow-motion (multi-kill blasts, boss death) | `engine.slowMo` |
| Muzzle light, shell casings with bounce, tracers | `player.js`, `particles.js` |
| Persistent corpses/scorch/wrecks painted into terrain | `terrain.js` decals |
| Dynamic music: layers fade in with combat heat | `audio.js` sequencer |
| Controller rumble on damage/explosions | `input.js rumble()` |
| Hit-marker ticks + confirm click on connect | `hud.js`, `game.onShotConnected` |
| Combo tier-up fanfare ("COMBO ×4" + jingle) | `game.onEnemyKilled` |
| Drifting cloud shadows over the battlefield | `game.drawCloudShadows` |
| Journey color grade (warm → jungle → smoke → arena) | `game.applyColorGrade` |
| Soft vignette always; optional CRT scanlines | `game.drawScreenFX` |
| Persistent best score / rank on the menu | `menus.js` (localStorage) |

## Combat math (Normal difficulty)

- Player: 100 hp, 3 lives, 272 px/s. Rifle: 8.5 rps, 14 dmg, 980 px/s bullets.
- Enemy bullets: 330–380 px/s (player moves at ~0.8× bullet speed — always dodgeable).
- Grenades: start 4 / cap 8, 96 px blast, 95 dmg center with falloff; refilled by
  pickups, crates, grenadier drops, and rescues.
- Powerups: spread (3-way, 10 s), rapid (×1.7 rof, 10 s), shield (7 s), medkit (+40).
- Difficulty scales enemy hp (×0.75/1/1.25), damage (×0.6/1/1.35),
  fire rate (×0.85/1/1.15) and infantry counts (×0.8/1/1.15).

## Enemy design

| Enemy | Role | Behaviour | Telegraph | HP / Score |
|---|---|---|---|---|
| Rifleman | baseline pressure | approach ring → aim → 3-burst → reposition; takes cover or retreats when wounded | aim glint line, 0.45 s | 26 / 100 |
| Strafer | tracking threat | orbits at ~290 px firing on the move, leads your velocity | constant motion (no stationary windup = lower dmg) | 40 / 150 |
| Grenadier | area denial | holds 360–470 px ring, lobs at your **predicted** position | crouch windup + red landing reticle all flight | 34 / 200 |
| Rusher | panic generator | weaving stalk → roar → committed straight charge | "!" + 0.38 s roar; charge is dodgeable | 18 / 120 |
| Bunker | terrain puzzle | stationary turret, 100° cone, armored front plate (bullets ×0.25) | muzzle blink 0.5 s | 150 / 400 |
| Technical | moving wall | patrols waypoints, 8-round MG sprays | muzzle blink 0.8 s | 280 / 600 |

**Fairness rules (hard-coded):** enemies only fire on screen, get a 0.4 s
"reaction grace" after first becoming visible, side-spawned ambushers carry a
"!" marker, and every dangerous attack telegraphs.

## The WARLORD (mini-boss)

Armored patrol vehicle, 2400 hp, arena-locked camera.

- **P1 (>66%)** — turret: aimed 8-round bursts and 13-round sweeping fans.
- **P2 (>33%)** — adds mortar volleys (4–6 shells, telegraphed reticles, leads you).
- **P3** — adds the ram: 1 s engine-rev telegraph, 540 px/s charge, wall slam →
  2.6 s stun at ×1.5 damage (the DPS window).
- Calls infantry support throughout. Death: chain explosions, slow-mo, wreck decal.

## Scoring

```
total = Σ(enemy score × combo multiplier)            base
      + 1500 × rescues
      + accuracy × 3000                              accuracy bonus
      + grenade kills × 60                           efficiency bonus
      + min(5000, (420 − seconds) × 25)              time bonus (victory only)
```
Combo: each kill refreshes a 2 s window; every 4 chained kills = +1 multiplier,
cap ×8; death breaks the chain.
Grades: **S ≥ 58 000, A ≥ 42 000, B ≥ 27 000, C** otherwise (loss caps at C).

## Level 1: Canopy Breaker (world y 7600 → 0)

| Zone | y range | Beat |
|---|---|---|
| Insertion clearing | 7600–6800 | tutorial prompts, light riflemen, first crates |
| Jungle road | 6800–5600 | checkpoints, first ambushes, strafers, grenadiers |
| River | 5600–4900 | bridge chokepoint: far-bank bunker + technical counterattack |
| Trenches | 4900–3900 | pop-up trench riflemen behind sandbag lips |
| Fortified camp | 3900–2400 | palisade gate + bunker, tents/towers, fuel-depot chain reaction, 2 hostages, second technical |
| Approach | 2400–1450 | mixed gauntlet, resupply crates |
| Boss arena | 1450–450 | WARLORD |
| Extraction | 450–0 | green flare, mission end |

20 progress triggers script the waves; a 22-enemy active cap with staggered
spawn queues keeps fights dense but legible.

## Future expansion ideas

- **Levels 2–3**: night harbor (searchlights as stealth-lite), mountain pass
  (vertical wind + rockslides). The section/trigger format in `level.js` already
  supports new levels as pure data.
- **Weapon pickups as slots** (flamethrower, LMG) instead of timers.
- **Co-op**: the input layer is already device-abstracted; player 2 = second
  gamepad + a second `Player` in the entity list.
- **Score attack / daily seed**: terrain and scatter already run on seeded RNG.
- **Boss roster**: helicopter (shadow + rotor wash, immune while airborne),
  train on the camp rails.
- **Meta**: per-grade unlock of starting loadouts; local leaderboard
  (localStorage) on the end screen.
