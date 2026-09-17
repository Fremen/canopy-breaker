// ============================================================
// audio.js — procedural WebAudio: every SFX is synthesized from
// oscillators + filtered noise (zero audio assets, zero
// copyright surface), and the music is a 16-step sequencer whose
// layers fade in/out with a combat "intensity" value the game
// feeds in (0 calm … 3 boss). Swap-in point for real audio:
// replace the bodies of the Sfx functions / sequencer voices.
// ============================================================

import { Settings } from './settings.js';
import { rand, clamp, lerp } from './math.js';

let ctx = null;
let masterG = null, sfxG = null, musicG = null;
let noiseBuf = null;

// ---------- bootstrap ----------

// Must be called from a user gesture (menu click) to satisfy autoplay policy.
export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) { return; }

  masterG = ctx.createGain();
  masterG.connect(ctx.destination);
  sfxG = ctx.createGain();
  sfxG.connect(masterG);
  musicG = ctx.createGain();
  musicG.connect(masterG);

  // Shared 1s white-noise buffer for percussion / explosions / gunfire.
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

  applyVolumes();
}

export function applyVolumes() {
  if (!ctx) return;
  masterG.gain.value = Settings.masterVol;
  sfxG.gain.value = Settings.sfxVol;
  musicG.gain.value = Settings.musicVol * 0.6;
}

// ---------- synth primitives ----------

function noise(dest, t, dur, { type = 'lowpass', f0 = 1000, f1 = null, q = 1, gain = 0.5, decay = null } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  src.playbackRate.value = rand(0.85, 1.15);
  const filt = ctx.createBiquadFilter();
  filt.type = type;
  filt.frequency.setValueAtTime(f0, t);
  if (f1 !== null) filt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  filt.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + (decay || dur));
  src.connect(filt); filt.connect(g); g.connect(dest);
  src.start(t); src.stop(t + dur + 0.05);
}

function tone(dest, t, dur, { type = 'sine', f0 = 440, f1 = null, gain = 0.3, attack = 0.002 } = {}) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== null) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(dest);
  o.start(t); o.stop(t + dur + 0.05);
}

const now = () => ctx.currentTime;

// ---------- SFX ----------
// Each is fire-and-forget; cheap enough to call every frame of combat.

export const Sfx = {
  shoot() {
    if (!ctx) return;
    const t = now();
    noise(sfxG, t, 0.09, { type: 'highpass', f0: 1800, gain: 0.25, decay: 0.07 });
    tone(sfxG, t, 0.07, { type: 'square', f0: 160, f1: 70, gain: 0.16 });
  },
  enemyShoot() {
    if (!ctx) return;
    const t = now();
    noise(sfxG, t, 0.08, { type: 'bandpass', f0: 900, q: 1.4, gain: 0.14, decay: 0.07 });
    tone(sfxG, t, 0.06, { type: 'square', f0: 110, f1: 55, gain: 0.1 });
  },
  heavyShoot() { // bunkers, vehicle MG, boss turret
    if (!ctx) return;
    const t = now();
    noise(sfxG, t, 0.12, { type: 'lowpass', f0: 2400, f1: 300, gain: 0.3, decay: 0.1 });
    tone(sfxG, t, 0.09, { type: 'sawtooth', f0: 90, f1: 40, gain: 0.18 });
  },
  explosion(big = false) {
    if (!ctx) return;
    const t = now();
    const k = big ? 1.5 : 1;
    noise(sfxG, t, 0.7 * k, { type: 'lowpass', f0: 1600, f1: 60, gain: 0.8 * k, q: 0.7 });
    tone(sfxG, t, 0.5 * k, { type: 'sine', f0: 110, f1: 28, gain: 0.7 });
    noise(sfxG, t + 0.05, 0.9 * k, { type: 'bandpass', f0: 400, f1: 120, q: 0.5, gain: 0.3 });
  },
  grenadeThrow() {
    if (!ctx) return;
    noise(sfxG, now(), 0.25, { type: 'bandpass', f0: 600, f1: 1400, q: 2, gain: 0.12 });
  },
  dryFire() {
    if (!ctx) return;
    tone(sfxG, now(), 0.05, { type: 'square', f0: 700, f1: 500, gain: 0.08 });
  },
  bulletHit() {
    if (!ctx) return;
    noise(sfxG, now(), 0.05, { type: 'highpass', f0: 2500, gain: 0.1, decay: 0.04 });
  },
  hitTick() { // quiet confirm tick when your shot connects
    if (!ctx) return;
    tone(sfxG, now(), 0.035, { type: 'square', f0: 1320, f1: 980, gain: 0.045 });
  },
  comboUp() { // multiplier tier rises
    if (!ctx) return;
    const t = now();
    tone(sfxG, t, 0.09, { type: 'square', f0: 740, gain: 0.1 });
    tone(sfxG, t + 0.07, 0.14, { type: 'square', f0: 1108, gain: 0.12 });
  },
  hurt() {
    if (!ctx) return;
    const t = now();
    tone(sfxG, t, 0.18, { type: 'square', f0: 140, f1: 60, gain: 0.3 });
    noise(sfxG, t, 0.12, { type: 'lowpass', f0: 800, gain: 0.2 });
  },
  enemyDie() {
    if (!ctx) return;
    const t = now();
    tone(sfxG, t, 0.22, { type: 'sawtooth', f0: rand(180, 240), f1: 50, gain: 0.18 });
    noise(sfxG, t, 0.15, { type: 'lowpass', f0: 1200, f1: 200, gain: 0.15 });
  },
  melee() {
    if (!ctx) return;
    const t = now();
    noise(sfxG, t, 0.1, { type: 'lowpass', f0: 600, gain: 0.35, decay: 0.09 });
    tone(sfxG, t, 0.08, { type: 'sine', f0: 90, f1: 40, gain: 0.3 });
  },
  pickup() {
    if (!ctx) return;
    const t = now();
    tone(sfxG, t, 0.1, { type: 'triangle', f0: 660, gain: 0.18 });
    tone(sfxG, t + 0.07, 0.14, { type: 'triangle', f0: 990, gain: 0.18 });
  },
  medal() {
    if (!ctx) return;
    const t = now();
    [880, 1108, 1318].forEach((f, i) => tone(sfxG, t + i * 0.05, 0.12, { type: 'triangle', f0: f, gain: 0.14 }));
  },
  powerup() {
    if (!ctx) return;
    const t = now();
    [523, 659, 784, 1046].forEach((f, i) => tone(sfxG, t + i * 0.045, 0.15, { type: 'square', f0: f, gain: 0.09 }));
  },
  rescue() {
    if (!ctx) return;
    const t = now();
    [659, 784, 988, 1318].forEach((f, i) => tone(sfxG, t + i * 0.09, 0.22, { type: 'triangle', f0: f, gain: 0.16 }));
  },
  click() {
    if (!ctx) return;
    tone(sfxG, now(), 0.06, { type: 'square', f0: 480, f1: 320, gain: 0.1 });
  },
  alarm() { // boss arrival siren
    if (!ctx) return;
    const t = now();
    for (let i = 0; i < 3; i++) {
      tone(sfxG, t + i * 0.5, 0.24, { type: 'sawtooth', f0: 520, gain: 0.12, attack: 0.04 });
      tone(sfxG, t + i * 0.5 + 0.25, 0.24, { type: 'sawtooth', f0: 392, gain: 0.12, attack: 0.04 });
    }
  },
  bossDown() {
    if (!ctx) return;
    const t = now();
    for (let i = 0; i < 5; i++) {
      noise(sfxG, t + i * 0.18, 0.8, { type: 'lowpass', f0: 1400, f1: 50, gain: 0.5 });
      tone(sfxG, t + i * 0.18, 0.5, { type: 'sine', f0: 100, f1: 25, gain: 0.5 });
    }
  },
  victory() {
    if (!ctx) return;
    const t = now();
    [523, 659, 784, 1046, 784, 1046].forEach((f, i) =>
      tone(sfxG, t + i * 0.13, 0.3, { type: 'triangle', f0: f, gain: 0.16 }));
  },
  gameOver() {
    if (!ctx) return;
    const t = now();
    [392, 370, 349, 311].forEach((f, i) =>
      tone(sfxG, t + i * 0.3, 0.5, { type: 'sawtooth', f0: f, gain: 0.12, attack: 0.05 }));
  },
};

// ============================================================
// Dynamic music — 16-step sequencer at 112 BPM, A-minor i/VI/iv/V.
// Layer thresholds (intensity): pad 0+, drums+bass 0.6+,
// snare+arp 1.4+, lead stabs 2.2+. The game raises intensity with
// nearby aggro enemies and pins it to 3 during the boss.
// ============================================================

const BPM = 112;
const STEP = 60 / BPM / 4; // 16th note
const NOTE = (semi) => 440 * Math.pow(2, semi / 12); // semitones from A4

// Chords as semitone offsets from A4: Am, F, Dm, E.
const PROG = [
  [-12, -9, -5],   // A C E
  [-16, -12, -9],  // F A C
  [-19, -15, -12], // D F A
  [-17, -13, -8],  // E G# B
];
const BASS_ROOT = [-36, -40, -43, -41]; // A1, F1, D1, E1

const music = {
  on: false,
  step: 0,
  nextT: 0,
  timer: null,
  intensity: 0,
  target: 0,
  layers: null, // gain nodes: pad, drums, melody, lead
};

export function startMusic() {
  if (!ctx || music.on) return;
  music.on = true;
  music.step = 0;
  music.nextT = ctx.currentTime + 0.1;
  if (!music.layers) {
    music.layers = {};
    for (const name of ['pad', 'drums', 'melody', 'lead']) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(musicG);
      music.layers[name] = g;
    }
  }
  music.timer = setInterval(scheduler, 30);
}

export function stopMusic() {
  if (music.timer) clearInterval(music.timer);
  music.timer = null;
  music.on = false;
}

export function setMusicIntensity(v) {
  music.target = clamp(v, 0, 3);
}

function scheduler() {
  if (!ctx || !music.on) return;
  // Smooth layer levels toward the intensity target.
  music.intensity = lerp(music.intensity, music.target, 0.06);
  const i = music.intensity;
  const lvl = (th) => clamp((i - th) / 0.6, 0, 1);
  music.layers.pad.gain.value = 0.5 + 0.2 * lvl(0);
  music.layers.drums.gain.value = lvl(0.6);
  music.layers.melody.gain.value = lvl(1.4);
  music.layers.lead.gain.value = lvl(2.2);

  // If the tab was throttled (background setInterval runs ~1/s),
  // skip the missed steps instead of replaying them all at once.
  if (music.nextT < ctx.currentTime) music.nextT = ctx.currentTime + 0.05;

  while (music.nextT < ctx.currentTime + 0.15) {
    scheduleStep(music.step, music.nextT);
    music.step = (music.step + 1) % 128; // 8 bars
    music.nextT += STEP;
  }
}

function scheduleStep(step, t) {
  const bar = Math.floor(step / 16);
  const s16 = step % 16;
  const chord = PROG[Math.floor(bar / 2) % 4];

  // Pad: chord swell at the start of every 2-bar phrase.
  if (step % 32 === 0) {
    for (const semi of chord) {
      tone(music.layers.pad, t, STEP * 32, { type: 'sawtooth', f0: NOTE(semi), gain: 0.05, attack: 0.8 });
      tone(music.layers.pad, t, STEP * 32, { type: 'triangle', f0: NOTE(semi - 12), gain: 0.05, attack: 0.8 });
    }
  }

  // Kick on quarter notes.
  if (s16 % 4 === 0) {
    tone(music.layers.drums, t, 0.14, { type: 'sine', f0: 120, f1: 38, gain: 0.55 });
  }
  // Hats on off-eighths.
  if (s16 % 2 === 1) {
    noise(music.layers.drums, t, 0.04, { type: 'highpass', f0: 6500, gain: 0.1, decay: 0.03 });
  }
  // Bass: driving eighths, octave hop at phrase end.
  if (s16 % 2 === 0) {
    const root = BASS_ROOT[Math.floor(bar / 2) % 4] + (s16 === 14 ? 12 : 0);
    tone(music.layers.drums, t, STEP * 1.8, { type: 'square', f0: NOTE(root), gain: 0.12, attack: 0.005 });
  }
  // Snare on 2 & 4.
  if (s16 === 4 || s16 === 12) {
    noise(music.layers.melody, t, 0.12, { type: 'bandpass', f0: 1800, q: 0.8, gain: 0.3, decay: 0.09 });
  }
  // Arp: 16th-note chord tones, rising.
  {
    const semi = chord[s16 % 3] + 12 * (1 + (s16 % 6 === 5 ? 1 : 0));
    tone(music.layers.melody, t, STEP * 0.9, { type: 'triangle', f0: NOTE(semi), gain: 0.07 });
  }
  // Lead stabs: aggressive syncopated saws when things get hot.
  if (s16 === 0 || s16 === 6 || s16 === 10) {
    const semi = chord[(bar + s16) % 3];
    tone(music.layers.lead, t, STEP * 2.4, { type: 'sawtooth', f0: NOTE(semi + 12), gain: 0.08, attack: 0.01 });
    tone(music.layers.lead, t, STEP * 2.4, { type: 'sawtooth', f0: NOTE(semi + 12) * 1.005, gain: 0.06, attack: 0.01 });
  }
}
