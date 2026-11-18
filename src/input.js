// Keyboard, mouse, pointer lock, rebindable MC-style binds.
// Wired by main.js via initInput(ctx).
import { emit } from './events.js';

const BINDS = {
  move: ['KeyW', 'KeyA', 'KeyS', 'KeyD'],
  jump: ['Space'],
  sprint: ['ShiftLeft'],
  drop: ['KeyQ'],
  inv: ['KeyE'],
  pause: ['KeyP']
};
const CANON_MOVE = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
let keyMap = {}; // physical code -> canonical code the player understands
function buildKeyMap() {
  keyMap = {};
  BINDS.move.forEach((c, i) => { keyMap[c] = CANON_MOVE[i]; });
  for (const c of BINDS.jump) keyMap[c] = 'Space';
  for (const c of BINDS.sprint) keyMap[c] = 'ShiftLeft';
}
buildKeyMap();
let rebindTarget = null; // { action, index } while waiting for a new key
function saveBinds() { localStorage.setItem('vw-binds', JSON.stringify(BINDS)); }
function loadBinds() {
  try {
    const b = JSON.parse(localStorage.getItem('vw-binds') || 'null');
    if (b && Array.isArray(b.move) && b.move.length === 4) Object.assign(BINDS, b);
  } catch (e) { /* ignore */ }
  buildKeyMap();
}

export function getBinds() { return BINDS; }

export function initInput(ctx) {
  // ctx: { player, canvas, getState, isModalOpen, closeModal, resumeGame, pauseGame,
  //        startGame, respawn, openInv, openModal, selectSlot, dropSelected, shoveToHotbar, renderKeyBinds }
  document.addEventListener('keydown', (e) => {
    // Rebind capture: any key (except Esc) assigns to the pending action
    if (rebindTarget) {
      e.preventDefault();
      if (e.code !== 'Escape') {
        BINDS[rebindTarget.action][rebindTarget.index] = e.code;
        saveBinds();
        buildKeyMap();
      }
      rebindTarget = null;
      ctx.renderKeyBinds();
      return;
    }
    if (e.code === 'Escape') {
      if (ctx.isModalOpen()) { ctx.closeModal(); return; }
      if (ctx.getState() === 'pause') { ctx.resumeGame(); return; }
      // In play: the browser releases pointer lock on Esc and
      // pointerlockchange opens the pause menu. If we are not locked
      // (headless), pause manually.
      if (ctx.getState() === 'play' && document.pointerLockElement !== ctx.canvas) ctx.pauseGame();
      return;
    }
    // Inventory open: digits shove the hovered stack into that hotbar slot (MC)
    if (ctx.isModalOpen() === 'modalInv') {
      if (e.code.startsWith('Digit')) {
        const n = parseInt(e.code.slice(5), 10);
        if (n >= 1 && n <= 10) ctx.shoveToHotbar(n - 1);
      }
      return;
    }
    if (ctx.isModalOpen()) return;
    const st = ctx.getState();
    if (st !== 'play') {
      if (e.code === 'Enter' && st === 'start') ctx.startGame();
      if (e.code === 'Enter' && st === 'dead') ctx.respawn();
      return;
    }
    const canon = keyMap[e.code];
    if (canon) ctx.player.setKey(canon, true);
    if (e.code.startsWith('Digit')) {
      const n = parseInt(e.code.slice(5), 10);
      if (n >= 1 && n <= 10) ctx.selectSlot(n - 1);
    }
    if (BINDS.inv.includes(e.code)) ctx.openInv();
    if (e.code === 'KeyH') ctx.openModal('modalHelp');
    if (BINDS.pause.includes(e.code)) ctx.pauseGame();
    if (BINDS.drop.includes(e.code) && !e.repeat) ctx.dropSelected(e.ctrlKey);
  });

  document.addEventListener('keyup', (e) => {
    const canon = keyMap[e.code];
    if (canon) ctx.player.setKey(canon, false);
  });

  // Lost focus (Alt+Tab, click outside): release all held keys so the
  // player does not keep walking inside the menus.
  window.addEventListener('blur', () => ctx.onBlur());

  // Hotbar: scroll the wheel to switch slots.
  window.addEventListener('wheel', (e) => {
    if (ctx.getState() !== 'play' || ctx.isModalOpen()) return;
    const dir = e.deltaY > 0 ? 1 : e.deltaY < 0 ? -1 : 0;
    if (!dir) return;
    ctx.selectSlot((ctx.selected() + dir + 10) % 10);
  }, { passive: true });

  // Click on the canvas re-captures the mouse if the lock was lost.
  ctx.canvas.addEventListener('click', () => {
    if (ctx.getState() === 'play' && !ctx.isModalOpen() && document.pointerLockElement !== ctx.canvas) ctx.lock();
  });

  document.addEventListener('mousemove', (e) => {
    if (ctx.getState() !== 'play' || document.pointerLockElement !== ctx.canvas) return;
    ctx.player.look(e.movementX, e.movementY);
  });

  loadBinds();
}

export function setRebindTarget(t) { rebindTarget = t; }
