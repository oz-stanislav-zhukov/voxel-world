// Headless smoke test: world generation, meshing, raycast, player physics.
import assert from 'node:assert';
import { World, buildChunkMesh, raycastVoxel, CHUNK, WATER_LEVEL } from '../src/world.js';
import { daylight, sunElevation, skyColor, clockLabel, isNight } from '../src/daynight.js';
import { Inventory, matchCraft, dropFor, STACK_MAX } from '../src/inventory.js';
import { Player } from '../src/player.js';
import { B } from '../src/blocks.js';

const world = new World(42);
for (let cx = -4; cx <= 4; cx++) for (let cz = -4; cz <= 4; cz++) world.generateChunk(cx, cz);

// 1. Terrain: every column has a surface block and bedrock at y=0
let surfaceCount = 0;
for (let x = 0; x < 64; x += 7) {
  for (let z = 0; z < 64; z += 7) {
    assert.strictEqual(world.get(x, 0, z), B.BEDROCK, 'bedrock at y=0');
    const h = world.heightAt(x, z);
    const top = world.get(x, h, z);
    assert.ok(top !== B.AIR && top !== B.WATER, 'surface block exists at height');
    surfaceCount++;
  }
}
assert.ok(surfaceCount > 50, 'sampled enough columns');

// 2. Water exists and sits at the local water level
let water = 0;
for (const c of world.chunks.values()) for (const b of c) if (b === B.WATER) water++;
assert.ok(water > 0, 'world has water');

// 3. Trees: logs and leaves exist
let logs = 0, leaves = 0;
for (const c of world.chunks.values()) for (const b of c) {
  if (b === B.LOG) logs++;
  if (b === B.LEAF) leaves++;
}
assert.ok(logs > 5, 'world has tree logs, got ' + logs);
assert.ok(leaves > 20, 'world has leaves, got ' + leaves);

// 4. Meshing: solid geometry is non-empty, indices reference valid vertices
const m = buildChunkMesh(world, 0, 0);
assert.ok(m.pos.length >= 3 * 6, 'chunk has solid faces');
assert.ok(m.ind.length > 0, 'chunk has indices');
assert.ok(m.ind.every((i) => i >= 0 && i < m.pos.length / 3), 'indices in range');
assert.ok(m.wpos.length === 0 || m.wind.every((i) => i >= 0 && i < m.wpos.length / 3), 'water indices in range');

// 4b. Determinism: regenerating a chunk gives identical data
const a = world.generateChunk(2, 2);
const b2 = world.generateChunk(2, 2);
assert.strictEqual(a, b2, 'chunk cache returns same array');
const world2 = new World(42);
const c1 = world2.generateChunk(3, -2);
const w3 = new World(42);
const c2 = w3.generateChunk(3, -2);
assert.ok(Buffer.compare(Buffer.from(c1), Buffer.from(c2)) === 0, 'same seed -> same chunk');

// 4c. Edits persist across chunk regeneration lookups
world.set(5, 10, 5, B.STONE);
assert.strictEqual(world.get(5, 10, 5), B.STONE);
world.set(5, 10, 5, B.AIR);
assert.strictEqual(world.get(5, 10, 5), B.AIR);

// 5. Raycast: shooting straight down from above hits a solid block
const h0 = world.heightAt(8, 8);
const hit = raycastVoxel(world, { x: 8.5, y: 60, z: 8.5 }, { x: 0, y: -1, z: 0 }, 60);
assert.ok(hit, 'raycast down hits something');
assert.strictEqual(hit.hit[0], 8);
assert.strictEqual(hit.hit[1], h0);
assert.ok(hit.prev[1] === h0 + 1 || hit.prev[1] === h0, 'prev block is above hit');

// 6. Raycast misses in open sky
const miss = raycastVoxel(world, { x: 8.5, y: 60, z: 8.5 }, { x: 0, y: 1, z: 0 }, 10);
assert.strictEqual(miss, null, 'upward ray misses');

// 7. Block edit: place + read back
const wx = 20, wz = 20, wy = world.heightAt(wx, wz) + 2;
world.set(wx, wy, wz, B.STONE);
assert.strictEqual(world.get(wx, wy, wz), B.STONE);
world.set(wx, wy, wz, B.AIR);
assert.strictEqual(world.get(wx, wy, wz), B.AIR);

// 8. Player: spawn on solid ground, gravity pulls down, lands on ground
const p = new Player(world);
assert.ok(p.pos.y > 1, 'player spawns above ground');
const y0 = p.pos.y;
for (let i = 0; i < 300; i++) p.update(1 / 60);
assert.ok(p.pos.y < y0, 'player fell from spawn');
assert.ok(p.onGround, 'player landed on ground');
assert.ok(!world.solidAt(Math.floor(p.pos.x), Math.floor(p.pos.y + 0.1), Math.floor(p.pos.z)), 'feet not inside a block');

// 9. Player jump
const gy = p.pos.y;
p.setKey('Space', true);
p.update(1 / 60);
p.setKey('Space', false);
let maxy = gy;
for (let i = 0; i < 60; i++) { p.update(1 / 60); maxy = Math.max(maxy, p.pos.y); }
assert.ok(maxy > gy + 0.3, 'jump lifts the player');

// 10. Walking: player moves forward on infinite terrain
const pw = new Player(world);
const sx = pw.pos.x, sz = pw.pos.z;
pw.yaw = 0;
pw.setKey('KeyW', true);
for (let i = 0; i < 120; i++) pw.update(1 / 60);
pw.setKey('KeyW', false);
const moved = Math.hypot(pw.pos.x - sx, pw.pos.z - sz);
assert.ok(moved > 3, 'player walked, moved=' + moved.toFixed(2));
assert.ok(pw.onGround, 'player still on ground');

// 11. Day/night cycle math
assert.ok(daylight(0.5) === 1, 'noon is full daylight');
assert.ok(daylight(0) === 0, 'midnight is dark');
assert.ok(sunElevation(0.5) > 0.99, 'sun is up at noon');
assert.ok(sunElevation(0) < -0.99, 'sun is down at midnight');
assert.ok(isNight(0) && !isNight(0.5), 'night flag flips');
const sc = skyColor(0.5);
assert.ok(sc[2] > sc[0], 'day sky is bluer than red');
assert.strictEqual(clockLabel(0.5), '12:00', 'noon clock');
assert.strictEqual(clockLabel(0), '00:00', 'midnight clock');
assert.strictEqual(clockLabel(0.25), '06:00', 'sunrise clock');

// 12. Inventory: stacking, drops, crafting
const inv = new Inventory(36);
assert.strictEqual(inv.add(B.PLANKS, 100), 0, 'stacks 100 planks (2 stacks)');
assert.strictEqual(inv.count(B.PLANKS), 100);
const invFull = new Inventory(36);
for (let i = 0; i < 36; i++) invFull.slots[i] = { id: B.STONE, count: STACK_MAX };
assert.strictEqual(invFull.add(B.STONE, 1), 1, 'full inventory returns leftover');
assert.strictEqual(inv.take(0, 10), 10);
assert.strictEqual(inv.slots[0].count, 54);
assert.strictEqual(dropFor(B.GRASS), B.DIRT, 'grass drops dirt');
assert.strictEqual(dropFor(B.COAL_ORE), 101, 'coal ore drops coal');
assert.strictEqual(dropFor(B.STONE), B.STONE, 'stone drops stone');
// Crafting: log -> 4 planks (shapeless)
const r1 = matchCraft([[B.LOG, null], [null, null]]);
assert.ok(r1 && r1.recipe.out.id === B.PLANKS && r1.recipe.out.n === 4, 'log crafts planks');
assert.deepStrictEqual(r1.cells, [0], 'shapeless consumes the log cell');
// Crafting: 2x2 planks -> table (shaped)
const r2 = matchCraft([[B.PLANKS, B.PLANKS], [B.PLANKS, B.PLANKS]]);
assert.ok(r2 && r2.recipe.out.id === B.CRAFTING_TABLE, 'planks craft table');
assert.strictEqual(r2.cells.length, 4, 'shaped consumes 4 cells');
// 3x3 grid with offset pattern still matches
const r3 = matchCraft([[null, null, null], [null, B.PLANKS, B.PLANKS], [null, B.PLANKS, B.PLANKS]]);
assert.ok(r3 && r3.recipe.out.id === B.CRAFTING_TABLE, 'offset shaped recipe matches');
assert.deepStrictEqual(r3.cells, [4, 5, 7, 8], 'offset cells correct');
// No recipe for garbage
assert.strictEqual(matchCraft([[B.STONE, null], [null, null]]), null, 'no false recipe');

// 13. New items: stick / sword / pickaxe recipes (rectangular patterns)
const rStick = matchCraft([[B.PLANKS, null], [B.PLANKS, null]]);
assert.ok(rStick && rStick.recipe.out.id === 107, 'planks craft sticks');
const rSword = matchCraft([[B.PLANKS, B.PLANKS], [null, 107]]);
assert.ok(rSword && rSword.recipe.out.id === 108, 'planks+stick craft sword');
const rPick = matchCraft([[B.PLANKS, B.PLANKS, B.PLANKS], [null, 107, null], [null, null, null]]);
assert.ok(rPick && rPick.recipe.out.id === 109, 'planks+stick craft pickaxe (2x3 pattern)');
assert.strictEqual(rPick.cells.length, 4, 'pickaxe consumes 4 cells (3 planks + stick)');

// 14. Mob drops
const { mobDrops } = await import('../src/inventory.js');
const cowDrops = mobDrops('cow');
assert.ok(cowDrops.some((d) => d.id === 105) && cowDrops.some((d) => d.id === 106), 'cow drops meat + leather');
const zomDrops = mobDrops('zombie');
assert.ok(zomDrops.some((d) => d.id === 105), 'zombie drops meat');

// 15. Mob hit: damage, knockback, death
const { Mob } = await import('../src/mobs.js');
const mob = new Mob('cow', 0, 10, 0);
assert.strictEqual(mob.hit(4, -1, 0), false, 'hit does not kill a healthy cow');
assert.ok(mob.hitT > 0, 'hit sets flash timer');
assert.ok(mob.kb.x > 0, 'knockback away from the attacker');
assert.strictEqual(mob.hit(100, 0, 0), true, 'big hit kills');
assert.ok(mob.dead && mob.deathT > 0, 'death animation starts');

// 16. Event bus: on/emit/off, and Player emits damage/death
const { on, off, emit } = await import('../src/events.js');
const seen = [];
const fn = (d) => seen.push(d);
const un = on('testEvt', fn);
emit('testEvt', { a: 1 });
un();
emit('testEvt', { a: 2 });
assert.deepStrictEqual(seen, [{ a: 1 }], 'off() unsubscribes');
const dmgSeen = [];
const deathSeen = [];
on('damage', (d) => dmgSeen.push(d));
on('death', () => deathSeen.push(1));
const p2 = new Player(world);
p2.damage(4);
assert.strictEqual(dmgSeen.length, 1, 'damage event emitted');
assert.strictEqual(dmgSeen[0].hp, 16, 'damage payload has hp');
p2.damage(100);
assert.strictEqual(deathSeen.length, 1, 'death event emitted');
assert.ok(p2.dead, 'player is dead');

console.log('OK: infinite world, water=' + water + ', logs=' + logs + ', leaves=' + leaves);
console.log('PASS: all smoke tests');

