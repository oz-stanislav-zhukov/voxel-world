// MC-style slot interaction: cursor stack, LMB/RMB/MMB/Shift/double-click,
// RMB-drag (place one per slot), LMB-drag (distribute evenly).
// State lives here; inv-ui.js wires DOM events to these functions.
import { STACK_MAX } from './inventory.js';

let cursorStack = null;
let hoverSlot = null; // { kind: 'main' | 'craft', i } | null
let rmbDrag = false;
let lmbDrag = false;
let lmbDragMoved = false; // only distribute if the cursor actually moved
let api = null; // { inv, craftSlots, refresh }

export function initInteract(a) {
  api = a;
  window.addEventListener('mouseup', () => {
    if (lmbDrag) { lmbDrag = false; if (lmbDragMoved) distribute(); } // spread only on a real drag (MC)
    rmbDrag = false;
  });
}

export function getCursorStack() { return cursorStack; }
export function setCursorStack(v) { cursorStack = v; }
export function getHoverSlot() { return hoverSlot; }
export function setHoverSlot(v) { hoverSlot = v; }

export function slotStack(kind, i) {
  return kind === 'main' ? api.inv.slots[i] : api.craftSlots[i].s;
}
export function setSlotStack(kind, i, v) {
  if (kind === 'main') api.inv.slots[i] = v; else api.craftSlots[i].s = v;
}

// LMB: pick up / merge / place. RMB: place one / take half. MMB: grab whole stack.
export function clickSlot(kind, i, button, shift) {
  const s = slotStack(kind, i);
  if (button === 1) {
    if (s) { cursorStack = s; setSlotStack(kind, i, null); }
  } else if (button === 2) {
    if (cursorStack) {
      if (s && s.id === cursorStack.id && s.count < STACK_MAX) {
        s.count++; cursorStack.count--;
        if (cursorStack.count <= 0) cursorStack = null;
      } else if (!s) {
        setSlotStack(kind, i, { id: cursorStack.id, count: 1 });
        cursorStack.count--;
        if (cursorStack.count <= 0) cursorStack = null;
      }
    } else if (s) {
      const take = Math.ceil(s.count / 2);
      cursorStack = { id: s.id, count: take };
      s.count -= take;
      if (s.count <= 0) setSlotStack(kind, i, null);
    }
  } else if (shift) {
    quickMove(kind, i);
    return;
  } else {
    if (cursorStack) {
      if (s && s.id === cursorStack.id && s.count < STACK_MAX) {
        const take = Math.min(STACK_MAX - s.count, cursorStack.count);
        s.count += take; cursorStack.count -= take;
        if (cursorStack.count <= 0) cursorStack = null;
      } else if (!s) {
        setSlotStack(kind, i, cursorStack); cursorStack = null;
      }
    } else if (s) {
      cursorStack = s; setSlotStack(kind, i, null);
    }
  }
  api.refresh();
}

// Shift+click: quick move between hotbar and storage (or craft -> inventory)
function quickMove(kind, i) {
  if (kind === 'craft') {
    const cs = api.craftSlots[i];
    if (!cs.s) return;
    const left = api.inv.add(cs.s.id, cs.s.count);
    if (left > 0) { api.toastFull(); return; }
    cs.s = null;
    api.refresh();
    return;
  }
  const s = api.inv.slots[i];
  if (!s) return;
  const isHotbar = i < 10;
  const from = isHotbar ? [10, 36] : [0, 10]; // target range
  for (let j = from[0]; j < from[1]; j++) {
    const st = api.inv.slots[j];
    if (st && st.id === s.id && st.count < STACK_MAX) {
      const take = Math.min(STACK_MAX - st.count, s.count);
      st.count += take; s.count -= take;
      if (s.count <= 0) { api.inv.slots[i] = null; api.refresh(); return; }
    }
  }
  for (let j = from[0]; j < from[1]; j++) {
    if (!api.inv.slots[j]) {
      api.inv.slots[j] = s; api.inv.slots[i] = null;
      api.refresh();
      return;
    }
  }
  api.toastFull();
}

// Double-click: gather all matching items into the cursor
export function collectDoubleClick(kind, i) {
  const s = slotStack(kind, i);
  if (!s) return;
  if (cursorStack && cursorStack.id !== s.id) return;
  const id = s.id;
  let total = cursorStack ? cursorStack.count : 0;
  for (let j = 0; j < api.inv.slots.length; j++) {
    const st = api.inv.slots[j];
    if (st && st.id === id) { total += st.count; api.inv.slots[j] = null; }
  }
  for (const cs of api.craftSlots) {
    if (cs.s && cs.s.id === id) { total += cs.s.count; cs.s = null; }
  }
  cursorStack = { id, count: Math.min(total, STACK_MAX) };
  const left = total - cursorStack.count;
  if (left > 0) {
    const cur = slotStack(kind, i);
    if (cur && cur.id === id) cur.count += left;
    else setSlotStack(kind, i, { id, count: left });
  }
  api.refresh();
}

// LMB-drag: spread the cursor stack evenly across all empty slots (MC)
function distribute() {
  if (!cursorStack) return;
  const id = cursorStack.id;
  let total = cursorStack.count;
  let empties = 0;
  for (let j = 0; j < api.inv.slots.length; j++) if (!api.inv.slots[j]) empties++;
  for (const cs of api.craftSlots) if (!cs.s) empties++;
  if (empties <= 0) return;
  const per = Math.floor(total / empties);
  const rem = total % empties;
  let placed = 0;
  for (let j = 0; j < api.inv.slots.length && placed < total; j++) {
    if (!api.inv.slots[j]) {
      const n = per + (j < rem ? 1 : 0);
      if (n > 0) { api.inv.slots[j] = { id, count: n }; placed += n; }
    }
  }
  for (let ci = 0; ci < api.craftSlots.length && placed < total; ci++) {
    if (!api.craftSlots[ci].s) {
      const n = per + (ci < rem ? 1 : 0);
      if (n > 0) { api.craftSlots[ci].s = { id, count: n }; placed += n; }
    }
  }
  cursorStack = placed < total ? { id, count: total - placed } : null;
  api.refresh();
}

// Place a single item from the cursor into a slot (used by RMB-drag)
export function dragPlace(kind, i) {
  if (!cursorStack) return;
  const s = slotStack(kind, i);
  if (s && s.id === cursorStack.id && s.count < STACK_MAX) {
    s.count++; cursorStack.count--;
    if (cursorStack.count <= 0) cursorStack = null;
  } else if (!s) {
    setSlotStack(kind, i, { id: cursorStack.id, count: 1 });
    cursorStack.count--;
    if (cursorStack.count <= 0) cursorStack = null;
  }
  api.refresh();
}

// Drag bookkeeping, called by slot mouseenter/mousedown in inv-ui.js
export function beginDrag(button, hadCursor) {
  if (button === 2 && cursorStack) rmbDrag = true;
  else if (button === 0 && !hadCursor && cursorStack) { lmbDrag = true; lmbDragMoved = false; }
}
export function enterSlot() {
  if (lmbDrag) lmbDragMoved = true;
}
// RMB-drag: place one item on every slot entered while the button is held
export function dragPlaceIfRmb(kind, i) {
  if (rmbDrag) dragPlace(kind, i);
}
