// Inventory & crafting UI: modal, storage/hotbar grids, craft grid + output,
// hotbar, Q-drop, digit-shove. Slot interactions live in inv-interact.js.
// Emits 'craft' events. Wired via initInvUI(ctx).
import { itemInfo, matchCraft } from './inventory.js';
import * as interact from './inv-interact.js';
import { on, emit } from './events.js';

let ctx = null; // { inv, iconBg, t, toast, player, world, HEIGHT, B, show, exitLock }
const $ = (id) => document.getElementById(id);
const invModal = $('modalInv');
const invGridEl = $('storageGrid');
const hotbarGridEl = $('hotbarGrid');
const craftGridEl = $('craftGrid');
const craftOutEl = $('craftOut');
const hotbarEl = $('hotbar');
const cursorEl = $('cursorItem');

let craftSize = 2;
const craftSlots = [];
let selected = 0;

export function selectedSlot() { return selected; }
export function selectSlot(i) {
  selected = i;
  [...hotbarEl.children].forEach((s, j) => s.classList.toggle('is-active', j === i));
}
export function getCursorStack() { return interact.getCursorStack(); }
export function setCursorStack(v) { interact.setCursorStack(v); }

function itemName(id) { const info = itemInfo(id); return info ? ctx.t(info.name) : '?'; }

function renderSlotEl(el, s) {
  el.innerHTML = '';
  if (!s) return;
  const icon = document.createElement('span');
  icon.className = 'inv-icon';
  icon.style.background = ctx.iconBg(s.id);
  icon.title = itemName(s.id);
  el.appendChild(icon);
  if (s.count > 1) {
    const c = document.createElement('span');
    c.className = 'inv-count';
    c.textContent = s.count;
    el.appendChild(c);
  }
}

function makeSlotEl() {
  const el = document.createElement('div');
  el.className = 'inv-slot';
  return el;
}

function buildCraftGrid(size) {
  craftSize = size;
  craftGridEl.innerHTML = '';
  craftGridEl.style.gridTemplateColumns = 'repeat(' + size + ', 44px)';
  craftSlots.length = 0;
  for (let i = 0; i < size * size; i++) {
    const el = makeSlotEl();
    const idx = i;
    el.addEventListener('mousedown', (e) => { e.preventDefault(); const had = interact.getCursorStack(); interact.clickSlot('craft', idx, e.button, e.shiftKey); interact.beginDrag(e.button, had); });
    el.addEventListener('dblclick', () => interact.collectDoubleClick('craft', idx));
    el.addEventListener('mouseenter', () => { interact.setHoverSlot({ kind: 'craft', i: idx }); if (interact.getCursorStack()) { interact.enterSlot(); interact.dragPlaceIfRmb('craft', idx); } });
    el.addEventListener('mouseleave', () => { const h = interact.getHoverSlot(); if (h && h.i === idx) interact.setHoverSlot(null); });
    craftGridEl.appendChild(el);
    craftSlots.push({ el, s: null });
  }
  renderCraft();
}

function currentCraftGrid() {
  const g = [];
  for (let y = 0; y < craftSize; y++) {
    const row = [];
    for (let x = 0; x < craftSize; x++) {
      const cs = craftSlots[y * craftSize + x];
      row.push(cs.s ? cs.s.id : null);
    }
    g.push(row);
  }
  return g;
}

function renderCraft() {
  for (const cs of craftSlots) renderSlotEl(cs.el, cs.s);
  const m = matchCraft(currentCraftGrid());
  craftOutEl.classList.toggle('can-craft', !!m);
  renderSlotEl(craftOutEl, m ? { id: m.recipe.out.id, count: m.recipe.out.n } : null);
  craftOutEl.title = m ? itemName(m.recipe.out.id) : '';
}

function refreshInv() {
  renderInvGrid();
  renderCraft();
  renderHotbar();
  renderCursor();
}

// Floating cursor item that follows the mouse
export function renderCursor() {
  const cs = interact.getCursorStack();
  if (!cs) { cursorEl.classList.remove('is-on'); cursorEl.innerHTML = ''; return; }
  cursorEl.classList.add('is-on');
  cursorEl.innerHTML =
    '<span class="inv-icon" style="background:' + ctx.iconBg(cs.id) + '"></span>' +
    (cs.count > 1 ? '<span class="inv-count">' + cs.count + '</span>' : '');
}
// The browser context menu would interrupt RMB-drag in the inventory
invModal.addEventListener('contextmenu', (e) => e.preventDefault());
invModal.addEventListener('mousemove', (e) => {
  const r = invModal.getBoundingClientRect();
  cursorEl.style.left = (e.clientX - r.left + 12) + 'px';
  cursorEl.style.top = (e.clientY - r.top + 12) + 'px';
});

function collectCraft() {
  const m = matchCraft(currentCraftGrid());
  if (!m) return;
  for (const ci of m.cells) {
    const cs = craftSlots[ci];
    cs.s.count--;
    if (cs.s.count <= 0) cs.s = null;
  }
  for (const cs of craftSlots) {
    if (cs.s) {
      const left = ctx.inv.add(cs.s.id, cs.s.count);
      if (left > 0) ctx.toast(ctx.t('toast.invFull'));
      cs.s = null;
    }
  }
  const left = ctx.inv.add(m.recipe.out.id, m.recipe.out.n);
  if (left > 0) ctx.toast(ctx.t('toast.invFull'));
  renderCraft();
  renderHotbar();
  emit('craft', { id: m.recipe.out.id, n: m.recipe.out.n });
}
craftOutEl.addEventListener('click', collectCraft);

function buildInvGrid() {
  // Storage (slots 10-35) on top, hotbar (0-9) as a separate strip below
  invGridEl.innerHTML = '';
  hotbarGridEl.innerHTML = '';
  for (let i = 0; i < ctx.inv.slots.length; i++) {
    const el = makeSlotEl();
    el.addEventListener('mousedown', (e) => { e.preventDefault(); const had = interact.getCursorStack(); interact.clickSlot('main', i, e.button, e.shiftKey); interact.beginDrag(e.button, had); });
    el.addEventListener('dblclick', () => interact.collectDoubleClick('main', i));
    el.addEventListener('mouseenter', () => { interact.setHoverSlot({ kind: 'main', i }); if (interact.getCursorStack()) { interact.enterSlot(); interact.dragPlaceIfRmb('main', i); } });
    el.addEventListener('mouseleave', () => { const h = interact.getHoverSlot(); if (h && h.i === i) interact.setHoverSlot(null); });
    (i < 10 ? hotbarGridEl : invGridEl).appendChild(el);
  }
  renderInvGrid();
}

function renderInvGrid() {
  [...invGridEl.children].forEach((el, k) => renderSlotEl(el, ctx.inv.slots[10 + k]));
  [...hotbarGridEl.children].forEach((el, k) => renderSlotEl(el, ctx.inv.slots[k]));
}

function nearTable() {
  const px = Math.floor(ctx.player.pos.x), pz = Math.floor(ctx.player.pos.z);
  for (let dx = -5; dx <= 5; dx++) {
    for (let dz = -5; dz <= 5; dz++) {
      for (let y = 0; y < ctx.HEIGHT; y++) {
        if (ctx.world.get(px + dx, y, pz + dz) === ctx.B.CRAFTING_TABLE) return true;
      }
    }
  }
  return false;
}

export function openInv() {
  interact.setCursorStack(null);
  interact.setHoverSlot(null);
  ctx.player.clearKeys();
  const hasTable = nearTable();
  buildCraftGrid(hasTable ? 3 : 2);
  buildInvGrid();
  ctx.show(invModal);
  ctx.exitLock();
  ctx.toast(hasTable ? ctx.t('toast.craftTable') : ctx.t('toast.noTable'));
  emit('modalOpen', { id: 'modalInv' });
}

export function closeInv() {
  // Return the held stack to the inventory (MC behavior)
  const cs = interact.getCursorStack();
  if (cs) {
    const left = ctx.inv.add(cs.id, cs.count);
    if (left > 0) {
      ctx.spawnPuff(ctx.player.pos.x, ctx.player.pos.y + 0.3, ctx.player.pos.z, 6, 0xcccccc);
      ctx.dropItemSfx();
    }
    interact.setCursorStack(null);
    renderCursor();
    renderHotbar();
  }
  ctx.hide(invModal);
  emit('modalClosed', { id: 'modalInv' });
}

export function renderHotbar() {
  hotbarEl.innerHTML = '';
  for (let i = 0; i < 10; i++) {
    const s = ctx.inv.slots[i];
    const slot = document.createElement('button');
    slot.className = 'slot' + (i === selected ? ' is-active' : '');
    slot.setAttribute('aria-label', s ? ctx.t(itemInfo(s.id).name) : '');
    slot.innerHTML =
      '<span class="slot__num">' + (i + 1) + '</span>' +
      '<span class="slot__icon" style="background:' + (s ? ctx.iconBg(s.id) : 'transparent') + '"></span>' +
      '<span class="slot__name">' + (s ? (s.count > 1 ? s.count + ' ' : '') + ctx.t(itemInfo(s.id).name) : '') + '</span>';
    slot.addEventListener('click', () => selectSlot(i));
    hotbarEl.appendChild(slot);
  }
}

// Q: drop the selected item to the ground (Ctrl+Q: the whole stack)
export function dropSelected(all, spawnDrop) {
  const s = ctx.inv.slots[selected];
  if (!s) return;
  const n = all ? s.count : 1;
  s.count -= n;
  if (s.count <= 0) ctx.inv.slots[selected] = null;
  const f = ctx.player.forward;
  spawnDrop(s.id, n, ctx.player.pos.x + f.x * 0.8, ctx.player.pos.y + 0.6, ctx.player.pos.z + f.z * 0.8);
  renderHotbar();
}

// Digits while hovering an inventory slot: shove that stack into the hotbar (MC)
export function shoveToHotbar(idx) {
  const h = interact.getHoverSlot();
  if (!h) return;
  const s = interact.slotStack(h.kind, h.i);
  if (!s) return;
  const target = ctx.inv.slots[idx];
  if (target && target.id === s.id && target.count < 64) {
    const take = Math.min(64 - target.count, s.count);
    target.count += take; s.count -= take;
    if (s.count <= 0) interact.setSlotStack(h.kind, h.i, null);
  } else if (!target) {
    ctx.inv.slots[idx] = s;
    interact.setSlotStack(h.kind, h.i, null);
  }
  refreshInv();
}

export function initInvUI(c) {
  ctx = c; // { inv, iconBg, t, toast, player, world, HEIGHT, B, show, hide, exitLock, spawnPuff, dropItemSfx }
  interact.initInteract({
    inv: c.inv,
    craftSlots,
    refresh: refreshInv,
    toastFull: () => c.toast(c.t('toast.invFull'))
  });
  renderHotbar();
  on('langChanged', () => renderHotbar());
}
