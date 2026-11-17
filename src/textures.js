// Procedural texture atlas: 8x4 tiles of 16px, drawn on a canvas.
// Node-safe: exports drawAtlas(ctx, size) so tests can run without DOM.
import { B, BLOCK_INFO } from './blocks.js';

export const ATLAS_COLS = 8;
export const ATLAS_ROWS = 4;
export const TILE = 16;

function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Paint one 16x16 tile at (tx, ty) using a per-pixel callback.
function tile(ctx, tx, ty, fn, seed = 1) {
  const rnd = mulberry(seed * 7919 + tx * 31 + ty);
  for (let x = 0; x < TILE; x++) {
    for (let y = 0; y < TILE; y++) {
      const [r, g, b, a] = fn(x, y, rnd);
      ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + (a === undefined ? 1 : a) + ')';
      ctx.fillRect(tx * TILE + x, ty * TILE + y, 1, 1);
    }
  }
}

function noisy(base, amount, seed) {
  return function (x, y, rnd) {
    const d = (rnd() - 0.5) * 2 * amount;
    return [base[0] + d, base[1] + d, base[2] + d];
  };
}

function oreSpeckles(base, speck, count, seed) {
  const rnd = mulberry(seed * 104729);
  const spots = [];
  for (let i = 0; i < count; i++) spots.push([Math.floor(rnd() * 15), Math.floor(rnd() * 15)]);
  return function (x, y, r2) {
    const d = (r2() - 0.5) * 2 * 14;
    const hit = spots.some(([sx, sy]) => (x - sx) ** 2 + (y - sy) ** 2 <= 2.2);
    if (hit) return [speck[0] + d * 0.4, speck[1] + d * 0.4, speck[2] + d * 0.4];
    return [base[0] + d, base[1] + d, base[2] + d];
  };
}

export function drawAtlas(ctx, size = TILE * ATLAS_COLS) {
  const put = (id, fn, seed) => {
    tile(ctx, id % ATLAS_COLS, Math.floor(id / ATLAS_COLS), fn, seed);
  };
  const C = (hex) => hexToRgb(hex);
  const grassTop = C('#5fae4a'), dirt = C('#7a5230'), stone = C('#8b9096');
  const sand = C('#e0cf8e'), logSide = C('#6b4a2b'), logTop = C('#9c7a4a');
  const leaf = C('#3e8f3a'), snow = C('#f2f6fa'), bedrock = C('#3a3d42');
  const water = C('#3f7fd6'), planks = C('#b08a54'), brick = C('#9c5a48');
  const coal = C('#4a5866'), iron = C('#d8af93'), gold = C('#f5d95a'), diamond = C('#5ad8e8');

  put(0, noisy(grassTop, 16, 1));                                    // grass top
  put(1, function (x, y, r) {                                        // grass side
    if (y < 3 + (r() > 0.5 ? 1 : 0)) return [grassTop[0] + (r() - 0.5) * 30, grassTop[1] + (r() - 0.5) * 30, grassTop[2] + (r() - 0.5) * 30];
    const d = (r() - 0.5) * 28; return [dirt[0] + d, dirt[1] + d, dirt[2] + d];
  }, 2);
  put(2, noisy(dirt, 18, 3));                                        // dirt
  put(3, noisy(stone, 12, 4));                                       // stone
  put(4, noisy(sand, 10, 5));                                        // sand
  put(5, function (x, y, r) {                                        // log side (bark stripes)
    const s = (x % 4 === 0) ? -22 : 0; const d = (r() - 0.5) * 16; return [logSide[0] + s + d, logSide[1] + s + d, logSide[2] + s + d];
  }, 6);
  put(6, function (x, y, r) {                                        // log top (rings)
    const ddx = x - 7.5, ddy = y - 7.5; const ring = Math.floor(Math.sqrt(ddx * ddx + ddy * ddy)) % 2; const d = (r() - 0.5) * 12; return [logTop[0] + ring * -18 + d, logTop[1] + ring * -18 + d, logTop[2] + ring * -18 + d];
  }, 7);
  put(7, function (x, y, r) {                                        // leaf (alpha holes -> see-through via alphaTest)
    if (r() < 0.14) return [0, 0, 0, 0];
    const d = (r() - 0.5) * 36; return [leaf[0] + d, leaf[1] + d, leaf[2] + d];
  }, 8);
  put(8, noisy(snow, 6, 9));                                         // snow
  put(9, function (x, y, r) {                                        // bedrock
    const d = (r() - 0.5) * 60; return [bedrock[0] + d, bedrock[1] + d, bedrock[2] + d];
  }, 10);
  put(10, function (x, y, r) {                                       // water
    const d = (r() - 0.5) * 14 + Math.sin(x * 0.8 + y * 0.4) * 8; return [water[0] + d, water[1] + d, water[2] + d];
  }, 11);
  put(11, function (x, y, r) {                                       // planks (boards)
    const board = Math.floor(y / 4); const gap = y % 4 === 0; const d = (r() - 0.5) * 14;
    return gap ? [planks[0] - 30, planks[1] - 30, planks[2] - 30] : [planks[0] + d + (board % 2) * 8, planks[1] + d + (board % 2) * 8, planks[2] + d + (board % 2) * 8];
  }, 12);
  put(12, function (x, y, r) {                                       // glass (frame + shine)
    const edge = x === 0 || y === 0 || x === 15 || y === 15;
    if (edge) return [200, 230, 245];
    if (x + y === 18 || x + y === 19) return [235, 250, 255];
    return [198, 228, 246]; // opaque light blue: survives alphaTest, reads as glass
  }, 13);
  put(13, function (x, y, r) {                                       // brick
    const row = Math.floor(y / 4); const off = (row % 2) * 4;
    const mortar = y % 4 === 3 || (x + off) % 8 === 7;
    if (mortar) return [180, 170, 160];
    const d = (r() - 0.5) * 16; return [brick[0] + d, brick[1] + d, brick[2] + d];
  }, 14);
  put(14, oreSpeckles(stone, coal, 9, 15));                          // coal ore
  put(15, oreSpeckles(stone, iron, 6, 16));                          // iron ore
  put(16, oreSpeckles(stone, gold, 6, 17));                          // gold ore
  put(17, oreSpeckles(stone, diamond, 6, 18));                       // diamond ore
  put(18, function (x, y, r) {                                       // table top
    const d = (r() - 0.5) * 14; const border = x < 2 || y < 2 || x > 13 || y > 13;
    return border ? [planks[0] - 40, planks[1] - 40, planks[2] - 40] : [planks[0] + d, planks[1] + d, planks[2] + d];
  }, 19);
  put(19, function (x, y, r) {                                       // table side (grid)
    const d = (r() - 0.5) * 12; const grid = x % 5 === 0 || y % 5 === 0;
    return grid ? [planks[0] - 36, planks[1] - 36, planks[2] - 36] : [planks[0] + d, planks[1] + d, planks[2] + d];
  }, 20);

    // ---------- Item icons (tiles 20-24) ----------
    const meat = C('#c0563f'), meatDark = C('#8e3a2c');
    put(20, function (x, y, r) {                                       // steak
      const inSteak = (x - 7.5) ** 2 / 42 + (y - 8) ** 2 / 26 < 1;
      if (!inSteak) return [0, 0, 0, 0];
      const bone = Math.abs(x - 4) < 2 && y > 4 && y < 12;
      if (bone) return [235, 230, 215];
      const d = (r() - 0.5) * 20;
      return (x + y) % 5 === 0 ? [meatDark[0] + d, meatDark[1] + d, meatDark[2] + d] : [meat[0] + d, meat[1] + d, meat[2] + d];
    }, 21);
    const leather = C('#a9713f');
    put(21, function (x, y, r) {                                       // leather
      const inSkin = (x - 7.5) ** 2 / 48 + (y - 7.5) ** 2 / 52 < 1;
      if (!inSkin) return [0, 0, 0, 0];
      const d = (r() - 0.5) * 16; const edge = (x - 7.5) ** 2 / 48 + (y - 7.5) ** 2 / 52 > 0.78;
      return edge ? [leather[0] - 30, leather[1] - 30, leather[2] - 30] : [leather[0] + d, leather[1] + d, leather[2] + d];
    }, 22);
    const stickC = C('#8a6238');
    put(22, function (x, y, r) {                                       // stick (diagonal)
      const dx = x - y; const inStick = dx > -2 && dx < 3 && x > 1 && x < 14;
      if (!inStick) return [0, 0, 0, 0];
      const d = (r() - 0.5) * 14; return [stickC[0] + d, stickC[1] + d, stickC[2] + d];
    }, 23);
    const blade = C('#b08a54');
    put(23, function (x, y, r) {                                       // wooden sword (diagonal)
      const dx = x - y;
      const inBlade = dx > 1 && dx < 5 && x > 6 && x < 15;
      const inHilt = dx > -5 && dx <= 1 && x > 0 && x < 7;
      if (!inBlade && !inHilt) return [0, 0, 0, 0];
      if (inBlade) { const d = (r() - 0.5) * 14; return [blade[0] + d, blade[1] + d, blade[2] + d]; }
      return [60, 40, 24];
    }, 24);
    const headC = C('#8b9096');
    put(24, function (x, y, r) {                                       // wooden pickaxe
      const dx = x - y;
      const inHandle = Math.abs(dx) < 2 && x > 2 && x < 13;
      const arc = Math.sqrt((x - 7.5) ** 2 + (y - 7.5) ** 2);
      const inHead = arc > 4.5 && arc < 7 && y < 8;
      if (!inHandle && !inHead) return [0, 0, 0, 0];
      if (inHead) { const d = (r() - 0.5) * 12; return [headC[0] + d, headC[1] + d, headC[2] + d]; }
      const d = (r() - 0.5) * 12; return [stickC[0] + d, stickC[1] + d, stickC[2] + d];
    }, 25);
  }

  // Icon tile for any item id (blocks use their side tile).
  export const ITEM_TILES = {
    101: 14, 102: 15, 103: 16, 104: 17,
    105: 20, 106: 21, 107: 22, 108: 23, 109: 24
  };
  export function itemTile(id) {
    if (ITEM_TILES[id] !== undefined) return ITEM_TILES[id];
    const bi = BLOCK_INFO[id];
    return bi ? bi.tiles.side : 3;
  }

// Which tile a face of a block uses.
export function tileFor(block, face) {
  const info = BLOCK_INFO[block];
  if (!info || !info.tiles) return 3;
  return face === 'top' ? info.tiles.top : face === 'bottom' ? info.tiles.bottom : info.tiles.side;
}

export function uvRect(tileId) {
  const tx = tileId % ATLAS_COLS, ty = Math.floor(tileId / ATLAS_COLS);
  const pad = 0.02 / ATLAS_COLS; // small inset to avoid bleeding
  return {
    u0: tx / ATLAS_COLS + pad, v0: 1 - (ty + 1) / ATLAS_ROWS + pad,
    u1: (tx + 1) / ATLAS_COLS - pad, v1: 1 - ty / ATLAS_ROWS - pad
  };
}
