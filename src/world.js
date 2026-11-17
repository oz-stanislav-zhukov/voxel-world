// Voxel world: generation + chunk meshing. Pure JS, no three.js (node-testable).
import { B, BLOCK_INFO, isSolid, isOpaque } from './blocks.js';
import { fbm2, ridge2, hash3 } from './noise.js';
import { tileFor, uvRect } from './textures.js';

export const CHUNK = 16;
export const HEIGHT = 64;
export const WATER_LEVEL = 18;

const mod = (n, m) => ((n % m) + m) % m;

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// Face table: outward quads, CCW winding as seen from outside.
const FACES = [
  { dir: [1, 0, 0], shade: 0.82, corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { dir: [-1, 0, 0], shade: 0.82, corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { dir: [0, 1, 0], shade: 1.0, corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { dir: [0, -1, 0], shade: 0.5, corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { dir: [0, 0, 1], shade: 0.72, corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { dir: [0, 0, -1], shade: 0.72, corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] }
];

export class World {
  constructor(seed = 1337) {
    this.seed = seed;
    this.chunks = new Map(); // "cx,cz" -> Uint8Array
    this.edits = new Map(); // "x,y,z" -> block id (player edits)
  }

  heightAt(x, z) {
    const n = fbm2(x * 0.016, z * 0.016, this.seed, 4);
    const r = ridge2(x * 0.011, z * 0.011, this.seed + 31, 3);
    let h = 3 + n * 20 + Math.pow(r, 2.4) * 36;
    const wl = this.waterLevel(x, z);
    if (h < wl) h = Math.min(h, wl - 2);
    return Math.max(3, Math.min(HEIGHT - 8, Math.floor(h)));
  }

  waterLevel(x, z) {
    return Math.round(WATER_LEVEL + (fbm2(x * 0.003, z * 0.003, this.seed + 77, 2) - 0.5) * 8);
  }

  generateChunk(cx, cz) {
    const key = cx + ',' + cz;
    if (this.chunks.has(key)) return this.chunks.get(key);
    const c = new Uint8Array(CHUNK * CHUNK * HEIGHT);
    c._ox = cx * CHUNK;
    c._oz = cz * CHUNK;
    const set = (lx, y, lz, b) => {
      if (y < 0 || y >= HEIGHT || lx < 0 || lx >= CHUNK || lz < 0 || lz >= CHUNK) return;
      c[(y * CHUNK + lz) * CHUNK + lx] = b;
    };
    for (let lx = 0; lx < CHUNK; lx++) {
      for (let lz = 0; lz < CHUNK; lz++) {
        const x = cx * CHUNK + lx, z = cz * CHUNK + lz;
        const h = this.heightAt(x, z);
        const wl = this.waterLevel(x, z);
        const beach = h <= wl + 1;
        for (let y = 0; y <= h; y++) {
          let b;
          if (y === 0) b = B.BEDROCK;
          else if (y === h) b = beach ? B.SAND : h >= 36 ? B.SNOW : B.GRASS;
          else if (y >= h - 3) b = beach ? B.SAND : B.DIRT;
          else {
            b = B.STONE;
            // Ores in stone: deeper = rarer and richer
            const r = hash3(x, y, z, this.seed + 555);
            if (y < 8 && r < 0.012) b = B.DIAMOND_ORE;
            else if (y < 14 && r < 0.02) b = B.GOLD_ORE;
            else if (r < 0.03) b = B.IRON_ORE;
            else if (r < 0.07) b = B.COAL_ORE;
          }
          set(lx, y, lz, b);
        }
        if (h < wl) {
          for (let y = h + 1; y <= wl; y++) set(lx, y, lz, B.WATER);
        }
      }
    }
    // Trees: deterministic per column; include a margin so canopies that
    // cross the chunk border are drawn in full.
    for (let lx = -3; lx < CHUNK + 3; lx++) {
      for (let lz = -3; lz < CHUNK + 3; lz++) {
        const x = cx * CHUNK + lx, z = cz * CHUNK + lz;
        const h = this.heightAt(x, z);
        if (this.surfaceType(x, z) !== B.GRASS) continue;
        if (hash3(x, h, z, this.seed + 99) >= 0.02) continue;
        this.growTreeInto(c, set, x, h, z);
      }
    }
    this.chunks.set(key, c);
    return c;
  }

  surfaceType(x, z) {
    const h = this.heightAt(x, z);
    const wl = this.waterLevel(x, z);
    if (h <= wl + 1) return B.SAND;
    if (h >= 36) return B.SNOW;
    return B.GRASS;
  }

  surfaceBlock(x, y, z) {
    const e = this.edits.get(x + ',' + y + ',' + z);
    if (e !== undefined) return e;
    const c = this.chunks.get(Math.floor(x / CHUNK) + ',' + Math.floor(z / CHUNK));
    if (!c) return B.AIR;
    return c[(y * CHUNK + mod(z, CHUNK)) * CHUNK + mod(x, CHUNK)];
  }

  growTreeInto(c, set, x, h, z) {
    const t = 4 + Math.floor(hash3(x, 0, z, this.seed + 7) * 3);
    for (let y = h + 1; y <= h + t; y++) set(x - c._ox, y, z - c._oz, B.LOG);
    for (let ly = h + t - 1; ly <= h + t + 2; ly++) {
      const r = ly <= h + t - 1 ? 2 : 1;
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (r === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2 && hash3(x + dx, ly, z + dz, this.seed + 5) < 0.5) continue;
          set(x + dx - c._ox, ly, z + dz - c._oz, B.LEAF);
        }
      }
    }
  }

  chunkOf(x, z) {
    return Math.floor(x / CHUNK) + ',' + Math.floor(z / CHUNK);
  }

  get(x, y, z) {
    if (y < 0) return B.BEDROCK;
    if (y >= HEIGHT) return B.AIR;
    const e = this.edits.get(x + ',' + y + ',' + z);
    if (e !== undefined) return e;
    const c = this.generateChunk(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
    return c[(y * CHUNK + mod(z, CHUNK)) * CHUNK + mod(x, CHUNK)];
  }

  set(x, y, z, b) {
    if (y < 0 || y >= HEIGHT) return;
    this.edits.set(x + ',' + y + ',' + z, b);
  }

  // Physics: below the world is solid.
  solidAt(x, y, z) {
    if (y < 0) return true;
    if (y >= HEIGHT) return false;
    return isSolid(this.get(x, y, z));
  }

  // Meshing: below the world is opaque so no bottom faces are drawn.
  opaqueAt(x, y, z) {
    if (y < 0) return true;
    if (y >= HEIGHT) return false;
    return isOpaque(this.get(x, y, z));
  }

  countBlocks() {
    const counts = {};
    for (const c of this.chunks.values()) {
      for (let i = 0; i < c.length; i++) {
        const b = c[i];
        if (b) counts[b] = (counts[b] || 0) + 1;
      }
    }
    return counts;
  }
}

// Builds the face data for one chunk. Returns { pos, col, ind, uv, wpos, wcol, wind, wuv }.
export function buildChunkMesh(world, cx, cz) {
  const pos = [], col = [], ind = [], uv = [];
  const wpos = [], wcol = [], wind = [], wuv = [];
  const ox = cx * CHUNK, oz = cz * CHUNK;
  const waterBase = hexToRgb(BLOCK_INFO[B.WATER].color);

  for (let lx = 0; lx < CHUNK; lx++) {
    for (let lz = 0; lz < CHUNK; lz++) {
      for (let y = 0; y < HEIGHT; y++) {
        const x = ox + lx, z = oz + lz;
        const b = world.get(x, y, z);
        if (b === B.AIR) continue;

        if (b === B.WATER) {
          const above = world.get(x, y + 1, z);
          for (const f of FACES) {
            const nx = x + f.dir[0], ny = y + f.dir[1], nz = z + f.dir[2];
            const nb = world.get(nx, ny, nz);
            if (nb !== B.AIR) continue;
            if (f.dir[1] === -1) continue;
            const shade = f.dir[1] === 1 ? 1.0 : 0.8;
            const vi = wpos.length / 3;
            const face = f.dir[1] === 1 ? 'top' : 'side';
            const rect = uvRect(tileFor(B.WATER, face));
            const uvs = [[rect.u0, rect.v0], [rect.u1, rect.v0], [rect.u1, rect.v1], [rect.u0, rect.v1]];
            for (let i = 0; i < 4; i++) {
              const c = f.corners[i];
              wpos.push(x + c[0], y + c[1] - 0.06, z + c[2]);
              wcol.push(waterBase[0] * shade, waterBase[1] * shade, waterBase[2] * shade);
              wuv.push(uvs[i][0], uvs[i][1]);
            }
            wind.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
          }
          continue;
        }

        const base = hexToRgb(BLOCK_INFO[b].color);
        for (const f of FACES) {
          if (world.opaqueAt(x + f.dir[0], y + f.dir[1], z + f.dir[2])) continue;
          const jitter = 0.93 + 0.07 * hash3(x + f.dir[0], y + f.dir[1], z + f.dir[2], world.seed);
          const shade = f.shade * jitter;
          const vi = pos.length / 3;
          const face = f.dir[1] === 1 ? 'top' : f.dir[1] === -1 ? 'bottom' : 'side';
          const rect = uvRect(tileFor(b, face));
          const uvs = [[rect.u0, rect.v0], [rect.u1, rect.v0], [rect.u1, rect.v1], [rect.u0, rect.v1]];
          for (let i = 0; i < 4; i++) {
            const c = f.corners[i];
            pos.push(x + c[0], y + c[1], z + c[2]);
            col.push(base[0] * shade, base[1] * shade, base[2] * shade);
            uv.push(uvs[i][0], uvs[i][1]);
          }
          ind.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
        }
      }
    }
  }
  return { pos, col, ind, uv, wpos, wcol, wind, wuv };
}

// Amanatides & Woo voxel DDA. Returns { hit: [x,y,z], prev: [x,y,z] } or null.
export function raycastVoxel(world, o, d, maxDist = 7) {
  let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
  const stepX = d.x > 0 ? 1 : -1;
  const stepY = d.y > 0 ? 1 : -1;
  const stepZ = d.z > 0 ? 1 : -1;
  const tdx = Math.abs(1 / d.x), tdy = Math.abs(1 / d.y), tdz = Math.abs(1 / d.z);
  let tmx = d.x !== 0 ? (stepX > 0 ? x + 1 - o.x : o.x - x) * tdx : Infinity;
  let tmy = d.y !== 0 ? (stepY > 0 ? y + 1 - o.y : o.y - y) * tdy : Infinity;
  let tmz = d.z !== 0 ? (stepZ > 0 ? z + 1 - o.z : o.z - z) * tdz : Infinity;
  let face = null;
  let t = 0;
  while (t <= maxDist) {
    if (isSolid(world.get(x, y, z))) {
      return { hit: [x, y, z], prev: face ? [x + face[0], y + face[1], z + face[2]] : [x, y, z] };
    }
    if (tmx < tmy && tmx < tmz) {
      x += stepX; t = tmx; tmx += tdx; face = [-stepX, 0, 0];
    } else if (tmy < tmz) {
      y += stepY; t = tmy; tmy += tdy; face = [0, -stepY, 0];
    } else {
      z += stepZ; t = tmz; tmz += tdz; face = [0, 0, -stepZ];
    }
  }
  return null;
}
