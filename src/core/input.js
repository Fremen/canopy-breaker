// ============================================================
// input.js — unified keyboard + mouse + gamepad input.
//
// Exposes a device-agnostic view of player intent:
//   Input.move        {x, y}  normalized movement vector
//   Input.mouse       {x, y, down} canvas-space pixels
//   Input.stickAim    {x, y, active} right-stick direction
//   Input.fireHeld    rifle trigger held (LMB / RT)
//   Input.grenadeJust grenade pressed this frame (Space / LT / LB)
//   Input.pauseJust   pause pressed this frame (Esc / P / Start)
//   Input.usingGamepad — last device the player touched
//
// Game code never reads raw keys; remapping happens here only.
// ============================================================

import { norm } from './math.js';
import { Settings } from './settings.js';

const keys = new Set();
const keysJust = new Set();

export const Input = {
  move: { x: 0, y: 0 },
  mouse: { x: 0, y: 0, down: false },
  stickAim: { x: 0, y: 0, active: false },
  fireHeld: false,
  grenadeJust: false,
  pauseJust: false,
  confirmJust: false,  // Enter / gamepad A — menus & restart shortcuts
  usingGamepad: false,
  _padPrev: [],
  _pad: null,
};

const DEADZONE = 0.22;

export function initInput(canvas) {
  window.addEventListener('keydown', (e) => {
    // Keep arrows/space from scrolling the page.
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (!e.repeat) keysJust.add(e.code);
    keys.add(e.code);
    Input.usingGamepad = false;
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => { keys.clear(); Input.mouse.down = false; });

  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    Input.mouse.x = e.clientX - r.left;
    Input.mouse.y = e.clientY - r.top;
    Input.usingGamepad = false;
  });
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) Input.mouse.down = true;
    Input.usingGamepad = false;
  });
  window.addEventListener('mouseup', (e) => { if (e.button === 0) Input.mouse.down = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

function pollGamepad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let pad = null;
  for (const p of pads) if (p && p.connected) { pad = p; break; }
  Input._pad = pad;
  if (!pad) return { mx: 0, my: 0, ax: 0, ay: 0, fire: false, grenadeJust: false, pauseJust: false, confirmJust: false };

  const axis = (i) => {
    const v = pad.axes[i] || 0;
    return Math.abs(v) < DEADZONE ? 0 : v;
  };
  const btn = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
  const btnJust = (i) => btn(i) && !Input._padPrev[i];

  let mx = axis(0), my = axis(1);
  // D-pad as movement fallback.
  if (btn(14)) mx = -1; if (btn(15)) mx = 1;
  if (btn(12)) my = -1; if (btn(13)) my = 1;

  const ax = axis(2), ay = axis(3);
  // RT (7) fire; also A (0) for accessibility. LT (6) / LB (4) grenade.
  const fire = btn(7) || btn(0);
  const grenadeJust = btnJust(6) || btnJust(4);
  const pauseJust = btnJust(9);
  const confirmJust = btnJust(0);

  if (mx || my || ax || ay || fire) Input.usingGamepad = true;

  const out = { mx, my, ax, ay, fire, grenadeJust, pauseJust, confirmJust };
  Input._padPrev = pad.buttons.map((b) => b.pressed);
  return out;
}

// Call once per frame, before game update.
export function updateInput() {
  const gp = pollGamepad();

  // --- movement: WASD + arrows + left stick ---
  let x = 0, y = 0;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
  if (keys.has('KeyW') || keys.has('ArrowUp')) y -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) y += 1;
  x += gp.mx; y += gp.my;
  const n = norm(x, y);
  // Preserve analog magnitude up to 1 for sticks, snap digital to 1.
  const mag = Math.min(1, Math.max(Math.abs(x), Math.abs(y), n.l));
  Input.move.x = n.x * mag;
  Input.move.y = n.y * mag;

  // --- aim: right stick (mouse handled by game via Input.mouse) ---
  const al = Math.sqrt(gp.ax * gp.ax + gp.ay * gp.ay);
  if (al > 0.01) {
    Input.stickAim.x = gp.ax / al;
    Input.stickAim.y = gp.ay / al;
    Input.stickAim.active = true;
  } else {
    Input.stickAim.active = false;
  }

  Input.fireHeld = Input.mouse.down || gp.fire;
  Input.grenadeJust = keysJust.has('Space') || gp.grenadeJust;
  Input.pauseJust = keysJust.has('Escape') || keysJust.has('KeyP') || gp.pauseJust;
  Input.confirmJust = keysJust.has('Enter') || gp.confirmJust;

  keysJust.clear();
}

// Controller rumble (Chrome's vibrationActuator). Fails silently elsewhere.
// The Settings.rumble guard lives HERE so no call site can forget it.
export function rumble(strong, weak, ms) {
  if (!Settings.rumble) return;
  const pad = Input._pad;
  if (!pad || !pad.vibrationActuator || !pad.vibrationActuator.playEffect) return;
  try {
    pad.vibrationActuator.playEffect('dual-rumble', {
      duration: ms, strongMagnitude: strong, weakMagnitude: weak,
    });
  } catch (e) { /* unsupported */ }
}
