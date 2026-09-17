// ============================================================
// menus.js — DOM menu glue: main menu, options (with all
// accessibility toggles), briefing, pause, and the shared
// end screen (game over + victory with animated tally).
// Settings changes persist immediately to localStorage.
// ============================================================

import { Settings, saveSettings } from '../core/settings.js';
import { initAudio, applyVolumes, startMusic, Sfx } from '../core/audio.js';

const $ = (id) => document.getElementById(id);

// ---------- persistent best score (the "come back and beat it" hook) ----------

const BEST_KEY = 'canopy-breaker-best-v1';

function loadBest() {
  // shape-validate: a corrupt/tampered value must degrade to "no
  // record", never throw during boot (this runs inside show('menu'))
  try {
    const b = JSON.parse(localStorage.getItem(BEST_KEY));
    if (b && Number.isFinite(b.total) && typeof b.grade === 'string') return b;
    return null;
  } catch (e) { return null; }
}

const GRADE_RANK = { C: 0, B: 1, A: 2, S: 3 };

function saveBest(best) {
  try { localStorage.setItem(BEST_KEY, JSON.stringify(best)); } catch (e) { /* ignore */ }
}

function refreshMenuBest() {
  const best = loadBest();
  const el = $('menu-best');
  if (best) {
    el.textContent = `BEST: ${best.total.toLocaleString('en-US')} — RANK ${best.grade}`;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

export function initMenus(game) {
  const screens = {
    menu: $('screen-menu'),
    options: $('screen-options'),
    help: $('screen-help'),
    pause: $('screen-pause'),
    end: $('screen-end'),
  };
  let optionsReturnTo = 'menu';

  const menus = {
    current: 'menu', // which screen is up (null = none) — game.update
                     // routes gamepad/keyboard navigation off this
    show(name) {
      this.current = name;
      if (name === 'menu') refreshMenuBest();
      for (const [k, el] of Object.entries(screens)) el.classList.toggle('hidden', k !== name);
    },
    hideAll() {
      this.current = null;
      for (const el of Object.values(screens)) el.classList.add('hidden');
    },
    showEnd(victory, stats) {
      $('end-title').textContent = victory ? 'MISSION COMPLETE' : 'K.I.A. — MISSION FAILED';
      $('end-title').style.color = victory ? '#d8c89a' : '#e23b2e';
      const rows = [
        ['ENEMIES ELIMINATED', stats.kills],
        ['SCOUTS RESCUED', stats.rescues],
        ['BEST COMBO', `×${stats.maxMultiplier} (${stats.maxCombo} chain)`],
        ['BASE SCORE', stats.base],
        ['ACCURACY', `${Math.round(stats.accuracy * 100)}%  (+${stats.accuracyBonus})`],
        ['GRENADE KILLS', `${stats.grenadeKills}  (+${stats.grenadeBonus})`],
        ['MISSION TIME', `${formatTime(stats.timeSec)}  (+${stats.timeBonus})`],
        ['TOTAL', stats.total, true],
      ];
      $('end-stats').innerHTML = rows.map(([label, value, total]) =>
        `<div class="stat-label${total ? ' stat-total' : ''}">${label}</div>` +
        `<div class="stat-value${total ? ' stat-total' : ''}">${value}</div>`
      ).join('');
      const gradeEl = $('end-grade');
      gradeEl.textContent = stats.grade;
      gradeEl.classList.toggle('grade-s', stats.grade === 'S');
      // best-score bookkeeping: best total and best grade improve
      // independently, so a high-scoring death (grade-capped to C)
      // can raise the score record without erasing an earned rank
      const prev = loadBest();
      const isRecord = stats.total > (prev ? prev.total : 0);
      const bestGrade = prev && GRADE_RANK[prev.grade] > GRADE_RANK[stats.grade]
        ? prev.grade : stats.grade;
      if (isRecord || (prev && bestGrade !== prev.grade)) {
        saveBest({ total: Math.max(stats.total, prev ? prev.total : 0), grade: bestGrade });
      }
      $('end-record').classList.toggle('hidden', !(isRecord && victory));
      this.show('end');
    },
  };

  game.menus = menus;

  // ---------- buttons ----------
  const click = (id, fn) => $(id).addEventListener('click', () => { initAudio(); Sfx.click(); fn(); });

  click('btn-deploy', () => { startMusic(); game.startGame(); });
  click('btn-options', () => { optionsReturnTo = 'menu'; menus.show('options'); });
  click('btn-help', () => menus.show('help'));
  click('btn-help-back', () => menus.show('menu'));
  click('btn-options-back', () => menus.show(optionsReturnTo));

  click('btn-resume', () => game.resume());
  click('btn-pause-options', () => { optionsReturnTo = 'pause'; menus.show('options'); });
  click('btn-restart', () => game.startGame());
  click('btn-quit', () => game.toMenu());

  click('btn-end-restart', () => game.startGame());
  click('btn-end-menu', () => game.toMenu());

  // ---------- options controls ----------
  const bindRange = (id, key) => {
    const el = $(id);
    el.value = Settings[key];
    el.addEventListener('input', () => {
      Settings[key] = parseFloat(el.value);
      saveSettings();
      applyVolumes();
    });
  };
  const bindCheck = (id, key) => {
    const el = $(id);
    el.checked = Settings[key];
    el.addEventListener('change', () => {
      Settings[key] = el.checked;
      saveSettings();
    });
  };

  bindRange('opt-master', 'masterVol');
  bindRange('opt-music', 'musicVol');
  bindRange('opt-sfx', 'sfxVol');
  bindRange('opt-shake', 'screenShake');
  bindCheck('opt-autofire', 'autoFire');
  bindCheck('opt-aimassist', 'aimAssist');
  bindCheck('opt-contrast', 'highContrast');
  bindCheck('opt-slowmo', 'slowMo');
  bindCheck('opt-rumble', 'rumble');
  bindCheck('opt-crt', 'crtFilter');

  const diffEl = $('opt-difficulty');
  diffEl.value = Settings.difficulty;
  diffEl.addEventListener('change', () => {
    Settings.difficulty = diffEl.value;
    saveSettings();
  });

  // NOTE: keyboard/gamepad menu navigation (Esc to back out,
  // Enter / gamepad-A to confirm) is routed through game.update via
  // Input.pauseJust / Input.confirmJust — one input path for all
  // devices, so controller-only players can operate every screen.

  menus.show('menu');
  return menus;
}

function formatTime(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
