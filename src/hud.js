// HUD: FPS/position/clock readout, hearts, damage vignette, toasts.
// Listens to 'damage' events. Wired via initHud(ctx).
import { on } from './events.js';

let ctx = null; // { fpsEl, posEl, clockEl, heartsEl, dmgFlashEl, toastEl, player, getDayTime, clockLabel }
let toastTimer = null;
let dmgFlashT = 0;
let fpsFrames = 0, fpsLast = performance.now();

export function toast(msg) {
  ctx.toastEl.textContent = msg;
  ctx.toastEl.classList.add('is-show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ctx.toastEl.classList.remove('is-show'), 1400);
}

export function initHud(c) {
  ctx = c;
  on('damage', () => { dmgFlashT = 0.45; });
}

// Per-frame: vignette decay + (every 500 ms) FPS/pos/clock/hearts.
export function updateHud(dt, now) {
  if (dmgFlashT > 0) {
    dmgFlashT -= dt;
    ctx.dmgFlashEl.style.opacity = Math.max(0, dmgFlashT / 0.45 * 0.55);
  } else if (ctx.dmgFlashEl.style.opacity !== '0') {
    ctx.dmgFlashEl.style.opacity = '0';
  }
  fpsFrames++;
  if (now - fpsLast >= 500) {
    ctx.fpsEl.textContent = Math.round(fpsFrames * 1000 / (now - fpsLast));
    fpsFrames = 0;
    fpsLast = now;
    const p = ctx.player.pos;
    ctx.posEl.textContent = Math.floor(p.x) + ', ' + Math.floor(p.y) + ', ' + Math.floor(p.z);
    ctx.clockEl.textContent = ctx.clockLabel(ctx.getDayTime());
    const h = Math.ceil(ctx.player.hp / 4);
    ctx.heartsEl.textContent = '❤️'.repeat(h) + '🖤'.repeat(5 - h);
  }
}
