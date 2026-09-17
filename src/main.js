// ============================================================
// main.js — bootstrap: settings → input → game → menus → loop.
// ============================================================

import { loadSettings } from './core/settings.js';
import { initInput } from './core/input.js';
import { initAudio } from './core/audio.js';
import { Game } from './game/game.js';
import { initMenus } from './game/menus.js';

loadSettings();

const canvas = document.getElementById('game-canvas');
initInput(canvas);

const game = new Game(canvas);
initMenus(game);

// Browsers require a user gesture before audio — arm it on the
// first interaction anywhere (menu clicks also call initAudio).
window.addEventListener('pointerdown', () => initAudio(), { once: true });

game.engine.start();

// Handy for debugging / automated playtests.
window.__game = game;
