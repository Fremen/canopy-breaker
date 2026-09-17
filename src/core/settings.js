// ============================================================
// settings.js — persisted player options (localStorage).
// Accessibility lives here: auto-fire, aim assist, reduced
// screen shake, high-contrast projectiles, difficulty.
// ============================================================

const KEY = 'canopy-breaker-settings-v1';

const DEFAULTS = {
  masterVol: 0.8,
  musicVol: 0.6,
  sfxVol: 0.85,
  screenShake: 1.0,   // 0..1 multiplier (0 = reduced-motion friendly)
  difficulty: 'normal', // 'easy' | 'normal' | 'hard'
  autoFire: false,
  aimAssist: false,
  highContrast: false,
  slowMo: true,
  rumble: true,
  crtFilter: false,   // retro scanline overlay — homage, not default
};

export const Settings = { ...DEFAULTS };

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      for (const k of Object.keys(DEFAULTS)) {
        if (k in saved) Settings[k] = saved[k];
      }
    }
  } catch (e) { /* private mode / corrupt data — keep defaults */ }
}

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(Settings)); } catch (e) { /* ignore */ }
}

// Difficulty multipliers applied across enemy stats and spawns.
export const DIFFICULTY = {
  easy:   { ehp: 0.75, edmg: 0.60, erof: 0.85, count: 0.80, label: 'RECRUIT' },
  normal: { ehp: 1.00, edmg: 1.00, erof: 1.00, count: 1.00, label: 'SOLDIER' },
  hard:   { ehp: 1.25, edmg: 1.35, erof: 1.15, count: 1.15, label: 'VETERAN' },
};

export const difficulty = () => DIFFICULTY[Settings.difficulty] || DIFFICULTY.normal;
