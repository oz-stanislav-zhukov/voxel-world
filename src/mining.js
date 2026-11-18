// Mining (hold-LMB with per-block MINE_TIME), block placement, MMB pick,
// air swing, target highlight and crack overlay.
// Wired by main.js via initMining(ctx).
import * as THREE from 'three';
import { raycastVoxel, CHUNK } from './world.js';
import { B } from './blocks.js';
import { itemInfo, dropFor } from './inventory.js';
import { emit } from './events.js';

let mouseDown = false;
let mining = null; // { x, y, z, t } while holding LMB on a block

// How long (seconds) to break each block with bare hands
const MINE_TIME = {
  [B.GRASS]: 0.45, [B.DIRT]: 0.4, [B.SAND]: 0.4, [B.LEAF]: 0.3, [B.SNOW]: 0.4,
  [B.PLANKS]: 0.9, [B.LOG]: 0.9, [B.GLASS]: 0.5, [B.BRICK]: 1.2, [B.CRAFTING_TABLE]: 0.9,
  [B.STONE]: 1.6, [B.COAL_ORE]: 1.8, [B.IRON_ORE]: 1.8, [B.GOLD_ORE]: 1.8, [B.DIAMOND_ORE]: 2.0
};
export const mineTime = (b) => MINE_TIME[b] ?? 1.2;
export { MINE_TIME };

export function getMining() { return mining; }
export function setMouseDown(b) { mouseDown = b; }
export function resetMining() { mouseDown = false; mining = null; }

let ctx = null; // { scene, world, player, inv, selected, selectSlot, spawnPuff, spawnDrop, rebuildAt, netSendBlock, hitMob, getState, isModalOpen, canvas, renderHotbar, crosshair, t }
let highlight, crack;

export function initMining(c) {
  ctx = c;
  // Block highlight outline
  highlight = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 })
  );
  highlight.visible = false;
  c.scene.add(highlight);

  // Mining crack overlay (fades in as progress grows)
  crack = new THREE.Mesh(
    new THREE.BoxGeometry(1.006, 1.006, 1.006),
    new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0, depthWrite: false })
  );
  crack.visible = false;
  c.scene.add(crack);

  c.canvas.addEventListener('mousedown', (e) => {
    if (c.getState() !== 'play' || document.pointerLockElement !== c.canvas) return;
    blockAction(e.button);
  });
  c.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) { mouseDown = false; mining = null; }
  });
}

// Hold-to-mine: accumulate progress on the targeted block each frame.
export function updateMining(dt) {
  if (!mouseDown || document.pointerLockElement !== ctx.canvas || ctx.isModalOpen()) {
    mining = null;
    return;
  }
  const o = ctx.player.eye();
  const d = ctx.player.lookDir();
  if (ctx.hitMob(o, d, 3.5)) { mining = null; return; } // mob in the way
  const hit = raycastVoxel(ctx.world, o, d, 7);
  if (!hit) { mining = null; return; }
  const [x, y, z] = hit.hit;
  const b = ctx.world.get(x, y, z);
  if (b === B.AIR || b === B.BEDROCK) { mining = null; return; }
  if (!mining || mining.x !== x || mining.y !== y || mining.z !== z) {
    mining = { x, y, z, t: 0 };
    return;
  }
  const sel = ctx.inv.slots[ctx.selected()];
  // item speed is a time factor (lower = faster), e.g. pickaxe 0.3 = ~3.3x speed
  const mult = sel && itemInfo(sel.id).speed ? itemInfo(sel.id).speed : 1;
  mining.t += dt / mult;
  // Scrape sound: a few short cracks per second while holding
  if (!mining.snd || mining.snd <= 0) {
    mining.snd = 0.28;
    emit('mineTick', { id: b });
  } else {
    mining.snd -= dt;
  }
  if (mining.t >= mineTime(b)) {
    ctx.world.set(x, y, z, B.AIR);
    ctx.spawnPuff(x + 0.5, y + 0.5, z + 0.5, 8, 0x8b9096);
    ctx.spawnDrop(dropFor(b), 1, x + 0.5, y + 0.6, z + 0.5);
    ctx.rebuildAt(x, z);
    ctx.netSendBlock(x, y, z, B.AIR);
    emit('blockChanged', { x, y, z, id: B.AIR });
    emit('mine', { id: b });
    mining = null;
  }
}

function blockAction(button) {
  if (ctx.getState() !== 'play' || document.pointerLockElement !== ctx.canvas) return;
  const o = ctx.player.eye();
  const d = ctx.player.lookDir();
  const hit = raycastVoxel(ctx.world, o, d, 7);
  if (button === 0) emit('swing'); // always swing, even at empty air (MC)
  if (!hit) return;
  if (button === 1) {
    // Pick block (survival): select the slot already holding this block
    const [x, y, z] = hit.hit;
    const b = ctx.world.get(x, y, z);
    if (b !== B.AIR && b !== B.WATER) {
      for (let i = 0; i < ctx.inv.slots.length; i++) {
        const st = ctx.inv.slots[i];
        if (st && st.id === b) { ctx.selectSlot(i); emit('uiClick'); return; }
      }
    }
    return;
  }
  if (button === 0) {
    mouseDown = true;
    // Attack a mob first (closer than a block)
    const mobHit = ctx.hitMob({ x: o.x, y: o.y, z: o.z }, { x: d.x, y: d.y, z: d.z }, 3.5);
    if (mobHit) {
      mining = null;
      const sel = ctx.inv.slots[ctx.selected()];
      const atk = sel && itemInfo(sel.id).attack ? itemInfo(sel.id).attack : 4;
      const died = mobHit.mob.hit(atk, o.x, o.z);
      emit('hitMob');
      if (died) emit('toast', { key: 'toast.mobKilled' });
      else emit('toast', { key: 'toast.attack' });
      return;
    }
    const [x, y, z] = hit.hit;
    if (ctx.world.get(x, y, z) === B.BEDROCK) { mining = null; return; }
    // Start (or keep) mining this block; progress accumulates in the frame loop
    if (!mining || mining.x !== x || mining.y !== y || mining.z !== z) mining = { x, y, z, t: 0 };
  } else if (button === 2) {
    const [x, y, z] = hit.prev;
    const pb = ctx.world.get(x, y, z);
    if (pb !== B.AIR && pb !== B.WATER) return;
    // Do not place inside the player
    const p = ctx.player.pos;
    if (
      x + 1 > p.x - 0.32 && x < p.x + 0.32 &&
      z + 1 > p.z - 0.32 && z < p.z + 0.32 &&
      y + 1 > p.y && y < p.y + 1.8
    ) return;
    const sel = ctx.inv.slots[ctx.selected()];
    if (!sel || !itemInfo(sel.id).placeable) { emit('toast', { key: 'toast.noBlock' }); return; }
    ctx.world.set(x, y, z, sel.id);
    ctx.inv.take(ctx.selected(), 1);
    ctx.renderHotbar();
    ctx.rebuildAt(x, z);
    if (sel.id === B.CRAFTING_TABLE) emit('toast', { key: 'toast.craftTable' });
    else emit('toast', { key: 'toast.placed' });
    ctx.netSendBlock(x, y, z, sel.id);
    emit('place', { id: sel.id, x, y, z });
  }
}

export function blockActionPublic(button) { blockAction(button); }

// Per-frame visuals: target highlight + crack overlay.
export function renderMining() {
  const { world, player, crosshair, getState } = ctx;
  if (getState() === 'play') {
    const hit = raycastVoxel(world, player.eye(), player.lookDir(), 7);
    if (hit) {
      highlight.visible = true;
      highlight.position.set(hit.hit[0] + 0.5, hit.hit[1] + 0.5, hit.hit[2] + 0.5);
      crosshair.classList.add('is-block');
    } else {
      highlight.visible = false;
      crosshair.classList.remove('is-block');
    }
  } else {
    highlight.visible = false;
    crosshair.classList.remove('is-block');
  }
  if (mining) {
    const mb = world.get(mining.x, mining.y, mining.z);
    if (mb !== B.AIR) {
      crack.visible = true;
      crack.position.set(mining.x + 0.5, mining.y + 0.5, mining.z + 0.5);
      crack.material.opacity = 0.1 + 0.5 * Math.min(1, mining.t / mineTime(mb));
    } else {
      crack.visible = false;
    }
  } else {
    crack.visible = false;
  }
}

// Rebuild the chunk(s) around an edited block (used by mining and net).
export function rebuildAt(x, z, buildChunk) {
  const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
  buildChunk(cx, cz);
  if (x % CHUNK === 0) buildChunk(cx - 1, cz);
  if (x % CHUNK === CHUNK - 1) buildChunk(cx + 1, cz);
  if (z % CHUNK === 0) buildChunk(cx, cz - 1);
  if (z % CHUNK === CHUNK - 1) buildChunk(cx, cz + 1);
}
