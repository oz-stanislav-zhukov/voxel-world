// Game screens and modals: start, pause, death (respawn / main menu),
// help, settings. Listens to 'death'/'respawn' events. Wired via initOverlays(ctx).
import { on, emit } from './events.js';

let ctx = null; // { canvas, player, sfx, resetMining, spawnPuff, inv, renderCursor, renderHotbar, cursorStack, setCursorStack }
let state = 'start'; // start | play | pause | dead
let modalOpen = null;

const $ = (id) => document.getElementById(id);
const startOv = $('start');
const pauseOv = $('pause');
const deathOv = $('death');
const helpModal = $('modalHelp');
const settingsModal = $('modalSettings');

function show(el) { el.hidden = false; el.classList.remove('is-hidden'); }
function hide(el) { el.classList.add('is-hidden'); setTimeout(() => { el.hidden = true; }, 250); }

export function lock() {
  try {
    const p = ctx.canvas.requestPointerLock();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (e) {
    // Headless / no-gesture contexts: pointer lock is unavailable, keep playing.
  }
}

export function getState() { return state; }
export function isModalOpen() { return modalOpen; }

export function startGame() {
  state = 'play';
  hide(startOv);
  lock();
  ctx.sfx.unlock();
  emit('uiClick');
}

export function pauseGame() {
  state = 'pause';
  ctx.player.clearKeys();
  ctx.resetMining();
  show(pauseOv);
}

export function resumeGame() {
  state = 'play';
  hide(pauseOv);
  lock();
}

export function die() {
  state = 'dead';
  ctx.player.clearKeys();
  ctx.resetMining();
  if (document.pointerLockElement) document.exitPointerLock();
  show(deathOv);
}

export function respawn() {
  ctx.player.spawn();
  state = 'play';
  hide(deathOv);
  lock();
  emit('respawn');
}

export function toMainMenu() {
  state = 'start';
  hide(deathOv);
  show(startOv);
}

export function openModal(id) {
  modalOpen = id;
  ctx.player.clearKeys();
  show($(id));
  emit('modalOpen', { id });
}

export function closeModal() {
  if (!modalOpen || modalOpen === 'modalInv') return; // inventory closes via inv-ui.closeInv
  const id = modalOpen;
  hide($(id));
  modalOpen = null;
  emit('modalClosed', { id });
  if (state === 'play') lock();
}

export function initOverlays(c) {
  ctx = c;
  // Inventory is opened from inv-ui.js: track it via the bus
  on('modalOpen', ({ id }) => { modalOpen = id; });
  on('modalClosed', () => { modalOpen = null; });
  $('btnStart').addEventListener('click', startGame);
  $('btnResume').addEventListener('click', resumeGame);
  $('btnHelpStart').addEventListener('click', () => openModal('modalHelp'));
  $('btnSettingsStart').addEventListener('click', () => openModal('modalSettings'));
  $('btnHelpPause').addEventListener('click', () => openModal('modalHelp'));
  $('btnSettingsPause').addEventListener('click', () => openModal('modalSettings'));
  document.querySelectorAll('.modal__close').forEach((b) => {
    b.addEventListener('click', closeModal);
  });
  [helpModal, settingsModal].forEach((m) => {
    m.addEventListener('click', (e) => { if (e.target === m) closeModal(); });
  });
  $('btnRespawn').addEventListener('click', respawn);
  $('btnDeathMenu').addEventListener('click', toMainMenu);

  on('death', die);

  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === c.canvas;
    if (!locked && state === 'play' && !modalOpen) pauseGame();
    if (!locked && state === 'dead') show(deathOv);
    if (locked && state === 'pause') { state = 'play'; hide(pauseOv); }
  });
}
