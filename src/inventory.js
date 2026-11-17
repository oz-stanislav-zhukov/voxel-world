// Inventory, items and crafting. Pure JS, node-testable.
import { B, BLOCK_INFO } from './blocks.js';

// Refined (non-placeable) items from ores + tools + mob drops
export const ITEMS = {
  101: { name: 'item.coal', color: '#2b2e33', placeable: false },
  102: { name: 'item.iron', color: '#d8af93', placeable: false },
  103: { name: 'item.gold', color: '#f5d95a', placeable: false },
  104: { name: 'item.diamond', color: '#5ad8e8', placeable: false },
  105: { name: 'item.meat', color: '#c0563f', placeable: false },
  106: { name: 'item.leather', color: '#a9713f', placeable: false },
  107: { name: 'item.stick', color: '#8a6238', placeable: false },
  108: { name: 'item.sword', color: '#b08a54', placeable: false, attack: 6, speed: 0.45 },
  109: { name: 'item.pickaxe', color: '#8b9096', placeable: false, speed: 0.3 }
};

export function itemInfo(id) {
  if (ITEMS[id]) return ITEMS[id];
  const bi = BLOCK_INFO[id];
  return bi ? { name: bi.name, color: bi.color, placeable: true } : null;
}

// What a broken block drops (refined items for ores, dirt for grass).
const DROPS = {
  [B.GRASS]: B.DIRT,
  [B.COAL_ORE]: 101,
  [B.IRON_ORE]: 102,
  [B.GOLD_ORE]: 103,
  [B.DIAMOND_ORE]: 104
};
export function dropFor(b) { return DROPS[b] ?? b; }

// What a killed mob drops.
const MOB_DROPS = {
  cow: [105, 106],
  zombie: [105]
};
export function mobDrops(type) {
  const list = MOB_DROPS[type] || [];
  return list.map((id) => ({ id, n: 1 + Math.floor(Math.random() * 2) }));
}

export const STACK_MAX = 64;

export class Inventory {
  constructor(size = 36) {
    this.slots = new Array(size).fill(null); // {id, count} | null
  }
  add(id, n = 1) {
    // Stack onto matching slots first
    for (let i = 0; i < this.slots.length && n > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id && s.count < STACK_MAX) {
        const take = Math.min(STACK_MAX - s.count, n);
        s.count += take; n -= take;
      }
    }
    // Then empty slots
    for (let i = 0; i < this.slots.length && n > 0; i++) {
      if (!this.slots[i]) {
        const take = Math.min(STACK_MAX, n);
        this.slots[i] = { id, count: take };
        n -= take;
      }
    }
    return n; // leftover that did not fit
  }
  take(idx, n = 1) {
    const s = this.slots[idx];
    if (!s) return 0;
    const take = Math.min(s.count, n);
    s.count -= take;
    if (s.count <= 0) this.slots[idx] = null;
    return take;
  }
  count(id) {
    let c = 0;
    for (const s of this.slots) if (s && s.id === id) c += s.count;
    return c;
  }
  // Move/swap between slots (inventory-like click)
  click(fromIdx, toIdx) {
    const a = this.slots[fromIdx], b = this.slots[toIdx];
    if (!a) return;
    if (!b) { this.slots[toIdx] = a; this.slots[fromIdx] = null; return; }
    if (a.id === b.id) {
      const move = Math.min(a.count, STACK_MAX - b.count);
      b.count += move; a.count -= move;
      if (a.count <= 0) this.slots[fromIdx] = null;
    } else {
      this.slots[toIdx] = a; this.slots[fromIdx] = b;
    }
  }
}

// ---------- Crafting ----------
// Shaped recipes: pattern must fit in the grid with all other cells empty.
// Shapeless: multiset of items matches.
const RECIPES = [
  { out: { id: B.PLANKS, n: 4 }, shapeless: [B.LOG] },
  { out: { id: B.CRAFTING_TABLE, n: 1 }, shape: [[B.PLANKS, B.PLANKS], [B.PLANKS, B.PLANKS]] },
  { out: { id: B.BRICK, n: 4 }, shape: [[B.STONE, B.STONE], [B.STONE, B.STONE]] },
  { out: { id: B.GLASS, n: 4 }, shape: [[B.SAND, B.SAND], [B.SAND, B.SAND]] },
  { out: { id: B.LEAF, n: 4 }, shapeless: [B.LEAF, B.LEAF] },
  { out: { id: B.SNOW, n: 4 }, shapeless: [B.SNOW, B.SNOW] },
  { out: { id: 107, n: 4 }, shape: [[B.PLANKS], [B.PLANKS]] },
  { out: { id: 108, n: 1 }, shape: [[B.PLANKS, B.PLANKS], [null, 107]] },
  { out: { id: 109, n: 1 }, shape: [[B.PLANKS, B.PLANKS, B.PLANKS], [null, 107, null]] }
];

// grid: array of rows (2x2 or 3x3) of item ids or null.
// Returns { recipe, cells } (cells = grid indices to consume) or null.
export function matchCraft(grid) {
  const size = grid.length;
  const flat = grid.flat();
  // Shaped (patterns may be rectangular: rows x cols)
  for (const r of RECIPES) {
    if (!r.shape) continue;
    const ph = r.shape.length; // rows
    const pw = r.shape[0].length; // cols
    for (let dy = 0; dy <= size - ph; dy++) {
      for (let dx = 0; dx <= size - pw; dx++) {
        let ok = true;
        for (let y = 0; y < size && ok; y++) {
          for (let x = 0; x < size && ok; x++) {
            const inPat = y >= dy && y < dy + ph && x >= dx && x < dx + pw;
            const cell = grid[y][x];
            if (inPat) {
              if (cell !== r.shape[y - dy][x - dx]) ok = false;
            } else if (cell !== null) ok = false;
          }
        }
        if (ok) {
          const cells = [];
          for (let y = 0; y < ph; y++)
            for (let x = 0; x < pw; x++)
              if (r.shape[y][x] !== null) cells.push((dy + y) * size + (dx + x));
          return { recipe: r, cells };
        }
      }
    }
  }
  // Shapeless: consume one of each required item
  for (const r of RECIPES) {
    if (!r.shapeless) continue;
    const present = flat.filter((v) => v !== null);
    if (present.length !== r.shapeless.length) continue;
    const need = [...r.shapeless].sort();
    const have = [...present].sort();
    if (need.length === have.length && need.every((v, i) => v === have[i])) {
      const cells = [];
      const used = new Set();
      for (const item of r.shapeless) {
        const idx = flat.findIndex((v, i) => v === item && !used.has(i));
        if (idx < 0) { cells.length = 0; break; }
        used.add(idx);
        cells.push(idx);
      }
      if (cells.length === r.shapeless.length) return { recipe: r, cells };
    }
  }
  return null;
}

export { RECIPES };