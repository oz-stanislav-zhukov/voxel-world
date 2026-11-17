import * as THREE from 'three';
import { World, buildChunkMesh, raycastVoxel, CHUNK, WATER_LEVEL, HEIGHT } from './world.js';
import { Player } from './player.js';
import { B, BLOCK_INFO } from './blocks.js';
import { Inventory, itemInfo, dropFor, matchCraft, STACK_MAX, mobDrops } from './inventory.js';
import { drawAtlas, ATLAS_COLS, ATLAS_ROWS, TILE, itemTile } from './textures.js';
import { NetClient } from './net.js';
import * as sfx from './sound.js';
import { DAY_LENGTH, daylight, skyColor, sunDirection, moonDirection, isNight, clockLabel } from './daynight.js';
import { MobManager } from './mobs.js';
import { setLang, t, applyI18n } from './i18n.js';

// ---------- Renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('app').prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fd0f5);
scene.fog = new THREE.Fog(0x9fd0f5, 40, 110);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 300);

const sun = new THREE.DirectionalLight(0xffffff, 1.35);
sun.position.set(60, 100, 40);
scene.add(sun);
scene.add(sun.target);
const ambient = new THREE.AmbientLight(0xbfd8ff, 0.75);
scene.add(ambient);

// ---------- Sky: sun, moon, stars ----------
const sunMesh = new THREE.Mesh(
  new THREE.SphereGeometry(6, 16, 16),
  new THREE.MeshBasicMaterial({ color: 0xffe08a, fog: false })
);
const moonMesh = new THREE.Mesh(
  new THREE.SphereGeometry(4.5, 16, 16),
  new THREE.MeshBasicMaterial({ color: 0xd8e2f2, fog: false })
);
scene.add(sunMesh, moonMesh);

const STAR_COUNT = 800;
const starPos = new Float32Array(STAR_COUNT * 3);
for (let i = 0; i < STAR_COUNT; i++) {
  // Random point on a big sphere, upper hemisphere bias
  const th = Math.random() * Math.PI * 2;
  const ph = Math.acos(Math.random());
  const R = 250;
  starPos[i * 3] = R * Math.sin(ph) * Math.cos(th);
  starPos[i * 3 + 1] = Math.abs(R * Math.cos(ph)) - 20;
  starPos[i * 3 + 2] = R * Math.sin(ph) * Math.sin(th);
}
const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0 });
const stars = new THREE.Points(starGeo, starMat);
scene.add(stars);

let dayTime = 0.32; // start in the morning

// ---------- World ----------
const world = new World(20261116);

// Texture atlas
const atlasCanvas = document.createElement('canvas');
atlasCanvas.width = ATLAS_COLS * TILE;
atlasCanvas.height = ATLAS_ROWS * TILE;
drawAtlas(atlasCanvas.getContext('2d'));
const atlasTex = new THREE.CanvasTexture(atlasCanvas);
atlasTex.magFilter = THREE.NearestFilter;
atlasTex.minFilter = THREE.NearestFilter;
atlasTex.colorSpace = THREE.SRGBColorSpace;

// ---------- Item icons (from the atlas) ----------
const atlasURL = atlasCanvas.toDataURL();
function iconBg(id) {
  const tile = itemTile(id);
  const col = tile % ATLAS_COLS, row = Math.floor(tile / ATLAS_COLS);
  const px = col / (ATLAS_COLS - 1) * 100, py = row / (ATLAS_ROWS - 1) * 100;
  return "url(" + atlasURL + ") " + px + '% ' + py + '% / ' + ATLAS_COLS * 100 + '% ' + ATLAS_ROWS * 100 + '% no-repeat';
}
const iconTexCache = new Map();
function makeIconTexture(id) {
  if (iconTexCache.has(id)) return iconTexCache.get(id);
  const c = document.createElement('canvas');
  c.width = c.height = TILE;
  const g = c.getContext('2d');
  const tile = itemTile(id);
  g.drawImage(atlasCanvas, (tile % ATLAS_COLS) * TILE, Math.floor(tile / ATLAS_COLS) * TILE, TILE, TILE, 0, 0, TILE, TILE);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  iconTexCache.set(id, t);
  return t;
}

const solidMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: atlasTex, alphaTest: 0.5 });
const waterMat = new THREE.MeshLambertMaterial({
  vertexColors: true, map: atlasTex, transparent: true, opacity: 0.62, depthWrite: false
});

const chunkMeshes = new Map();

function buildChunk(cx, cz) {
  const key = cx + ',' + cz;
  const old = chunkMeshes.get(key);
  if (old) {
    scene.remove(old.solid, old.water);
    old.solid.geometry.dispose();
    old.water.geometry.dispose();
  }
  const m = buildChunkMesh(world, cx, cz);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(m.pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(m.col, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(m.uv, 2));
  geo.setIndex(m.ind);
  const solid = new THREE.Mesh(geo, solidMat);

  const wgeo = new THREE.BufferGeometry();
  wgeo.setAttribute('position', new THREE.Float32BufferAttribute(m.wpos, 3));
  wgeo.setAttribute('color', new THREE.Float32BufferAttribute(m.wcol, 3));
  wgeo.setAttribute('uv', new THREE.Float32BufferAttribute(m.wuv, 2));
  wgeo.setIndex(m.wind);
  const water = new THREE.Mesh(wgeo, waterMat);
  water.renderOrder = 1;

  scene.add(solid, water);
  chunkMeshes.set(key, { solid, water });
}

// ---------- Chunk streaming (infinite world) ----------
const VIEW = 4; // chunks in each direction
let lastCx = null, lastCz = null;

function streamChunks() {
  const pcx = Math.floor(player.pos.x / CHUNK), pcz = Math.floor(player.pos.z / CHUNK);
  if (pcx === lastCx && pcz === lastCz) return;
  lastCx = pcx; lastCz = pcz;
  // Unload far chunks
  for (const [key, m] of chunkMeshes) {
    const [cx, cz] = key.split(',').map(Number);
    if (Math.abs(cx - pcx) > VIEW + 1 || Math.abs(cz - pcz) > VIEW + 1) {
      scene.remove(m.solid, m.water);
      m.solid.geometry.dispose();
      m.water.geometry.dispose();
      chunkMeshes.delete(key);
    }
  }
  // Build missing nearby chunks, nearest first
  const todo = [];
  for (let cx = pcx - VIEW; cx <= pcx + VIEW; cx++) {
    for (let cz = pcz - VIEW; cz <= pcz + VIEW; cz++) {
      if (!chunkMeshes.has(cx + ',' + cz)) todo.push([cx, cz]);
    }
  }
  todo.sort((a, b) => (a[0] - pcx) ** 2 + (a[1] - pcz) ** 2 - ((b[0] - pcx) ** 2 + (b[1] - pcz) ** 2));
  for (const [cx, cz] of todo.slice(0, 6)) buildChunk(cx, cz);
}

// Hold-to-mine: accumulate progress on the targeted block each frame.
function updateMining(dt) {
  if (!mouseDown || document.pointerLockElement !== renderer.domElement || modalOpen) {
    mining = null;
    return;
  }
  const o = player.eye();
  const d = player.lookDir();
  if (mobManager.hitMob(o, d, 3.5)) { mining = null; return; } // mob in the way
  const hit = raycastVoxel(world, o, d, 7);
  if (!hit) { mining = null; return; }
  const [x, y, z] = hit.hit;
  const b = world.get(x, y, z);
  if (b === B.AIR || b === B.BEDROCK) { mining = null; return; }
  if (!mining || mining.x !== x || mining.y !== y || mining.z !== z) {
    mining = { x, y, z, t: 0 };
    return;
  }
  const sel = inv.slots[selected];
  // item speed is a time factor (lower = faster), e.g. pickaxe 0.3 = ~3.3x speed
  const mult = sel && itemInfo(sel.id).speed ? itemInfo(sel.id).speed : 1;
  mining.t += dt / mult;
  // Scrape sound: a few short cracks per second while holding
  if (!mining.snd || mining.snd <= 0) {
    mining.snd = 0.28;
    sfx.mine(b);
  } else {
    mining.snd -= dt;
  }
  if (mining.t >= mineTime(b)) {
    world.set(x, y, z, B.AIR);
    sfx.breakBlock(b);
    spawnPuff(x + 0.5, y + 0.5, z + 0.5, 8, 0x8b9096);
    const left = inv.add(dropFor(b), 1);
    if (left > 0) toast(t('toast.invFull'));
    else toast(t('toast.broken'));
    renderHotbar();
    rebuildAt(x, z);
    netSendBlock(x, y, z, B.AIR);
    mining = null;
  }
}

// Block highlight outline
const highlight = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
  new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 })
);
highlight.visible = false;
scene.add(highlight);

// Mining crack overlay (fades in as progress grows)
const crack = new THREE.Mesh(
  new THREE.BoxGeometry(1.006, 1.006, 1.006),
  new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0, depthWrite: false })
);
crack.visible = false;
scene.add(crack);

// Red damage vignette (MC-style impact)
const dmgFlashEl = document.getElementById('dmgFlash');
let dmgFlashT = 0;
function damageFlash() {
  dmgFlashT = 0.45;
}

// ---------- Mobs ----------
const mobManager = new MobManager(world);
const mobGroups = new Map(); // mob -> THREE.Group

function mobMesh(m) {
  const g = new THREE.Group();
  const mats = [];
  const mat = (hex) => { const mm = new THREE.MeshLambertMaterial({ color: hex }); mats.push(mm); return mm; };
  const parts = { legs: [], arms: [] };
  if (m.type === 'cow') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.9), mat(0x8a6f52));
    body.position.y = 0.75;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), mat(0x9c8265));
    head.position.set(0, 1.1, 0.55);
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.15), mat(0xe8d8c8));
    snout.position.set(0, 1.02, 0.78);
    g.add(body, head, snout);
    for (const [lx, lz] of [[0.2, 0.3], [-0.2, 0.3], [0.2, -0.3], [-0.2, -0.3]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.5, 0.14), mat(0x7a5f46));
      leg.geometry.translate(0, -0.25, 0); // pivot at the hip
      leg.position.set(lx, 0.5, lz);
      g.add(leg);
      parts.legs.push(leg);
    }
  } else {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.35), mat(0x3e7a3a));
    body.position.y = 0.85;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), mat(0x4a9a44));
    head.position.y = 1.45;
    g.add(body, head);
    for (const sx of [1, -1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.5, 0.18), mat(0x3e7a3a));
      arm.geometry.translate(0, -0.25, 0);
      arm.position.set(0.38 * sx, 1.15, 0.1);
      arm.rotation.x = -Math.PI / 2; // zombie: arms stretched forward
      g.add(arm);
      parts.arms.push(arm);
    }
    for (const sx of [1, -1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.7, 0.2), mat(0x35603a));
      leg.geometry.translate(0, -0.35, 0);
      leg.position.set(0.16 * sx, 0.7, 0);
      g.add(leg);
      parts.legs.push(leg);
    }
  }
  g.userData = { mats, parts };
  return g;
}

// ---------- Particles (death puffs, block debris) ----------
const particles = []; // { mesh, vel, life, maxLife }
const puffGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
const puffMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
function spawnPuff(x, y, z, n = 12, color = 0xffffff) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(puffGeo, puffMat.clone());
    m.position.set(x, y, z);
    m.material.color.setHex(color);
    const a = Math.random() * Math.PI * 2;
    const up = 0.5 + Math.random() * 1.5;
    m.userData.vel = { x: Math.cos(a) * (0.5 + Math.random()), y: up, z: Math.sin(a) * (0.5 + Math.random()) };
    m.userData.life = 0.6 + Math.random() * 0.4;
    scene.add(m);
    particles.push(m);
  }
}
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const m = particles[i];
    m.userData.life -= dt;
    if (m.userData.life <= 0) {
      scene.remove(m);
      m.material.dispose();
      particles.splice(i, 1);
      continue;
    }
    const v = m.userData.vel;
    m.position.x += v.x * dt;
    m.position.y += v.y * dt;
    m.position.z += v.z * dt;
    v.y -= 2.5 * dt; // gentle gravity
    m.material.opacity = Math.min(0.9, m.userData.life * 1.6);
    const sc = Math.max(0.05, m.userData.life);
    m.scale.setScalar(sc);
  }
}

function syncMobs() {
  for (const [m, g] of [...mobGroups]) {
    if (!mobManager.mobs.includes(m)) {
      scene.remove(g);
      mobGroups.delete(m);
      if (m.dead && !m.dropped) {
        m.dropped = true;
        spawnPuff(m.pos.x, m.pos.y + 0.7, m.pos.z, 14, 0xf5f5f5); // MC-style white death cloud
        sfx.mobDeath();
        for (const d of mobDrops(m.type)) {
          const left = inv.add(d.id, d.n);
          if (left > 0) toast(t('toast.invFull'));
        }
        renderHotbar();
      }
    }
  }
  for (const m of mobManager.mobs) {
    if (!mobGroups.has(m)) {
      const g = mobMesh(m);
      scene.add(g);
      mobGroups.set(m, g);
    }
  }
  for (const [m, g] of mobGroups) {
    g.position.set(m.pos.x, m.pos.y, m.pos.z);
    g.rotation.y = m.facing;
    const u = g.userData;
    if (m.dead) {
      // Fall over during the death animation
      const p = Math.min(1, 1 - m.deathT / 0.6);
      g.rotation.x = -p * Math.PI / 2;
      g.position.y -= p * 0.15;
    } else {
      g.rotation.x = 0;
      const sw = Math.sin(m.walkT);
      u.parts.legs.forEach((leg, i) => { leg.rotation.x = sw * (i % 2 ? 1 : -1) * 0.7; });
      if (u.parts.arms.length) {
        u.parts.arms.forEach((arm, i) => { arm.rotation.x = -Math.PI / 2 + sw * (i % 2 ? 1 : -1) * 0.15; });
      }
    }
    // White flash right after being hit
    const f = m.hitT > 0 ? (m.hitT / 0.25) * 0.9 : 0;
    for (const mm of u.mats) mm.emissive.setRGB(f, f, f);
  }
}

// ---------- Player ----------
const player = new Player(world);

// ---------- Player hand (first person) ----------
const handGroup = new THREE.Group();
const handArm = new THREE.Mesh(
  new THREE.BoxGeometry(0.14, 0.14, 0.5),
  new THREE.MeshLambertMaterial({ color: 0xd9a066 })
);
handArm.position.z = -0.25; // arm reaches away from the camera
const handSleeve = new THREE.Mesh(
  new THREE.BoxGeometry(0.17, 0.17, 0.22),
  new THREE.MeshLambertMaterial({ color: 0x3f6fb5 })
);
handSleeve.position.z = 0.05; // sleeve sits closest to the viewer
const heldItem = new THREE.Mesh(
  new THREE.BoxGeometry(0.12, 0.12, 0.12),
  new THREE.MeshBasicMaterial({ map: makeIconTexture(B.PLANKS), transparent: true })
);
heldItem.position.set(0.05, 0.12, -0.45); // held at the far end of the arm
handGroup.add(handArm, handSleeve, heldItem);
handGroup.position.set(0.42, -0.42, -0.7);
handGroup.rotation.x = 0.25;
camera.add(handGroup);
scene.add(camera);
let swingT = 0; // >0 while swinging
let bobT = 0;
let mouseDown = false;
let mining = null; // { x, y, z, t } while holding LMB on a block

// How long (seconds) to break each block with bare hands
const MINE_TIME = {
  [B.GRASS]: 0.45, [B.DIRT]: 0.4, [B.SAND]: 0.4, [B.LEAF]: 0.3, [B.SNOW]: 0.4,
  [B.PLANKS]: 0.9, [B.LOG]: 0.9, [B.GLASS]: 0.5, [B.BRICK]: 1.2, [B.CRAFTING_TABLE]: 0.9,
  [B.STONE]: 1.6, [B.COAL_ORE]: 1.8, [B.IRON_ORE]: 1.8, [B.GOLD_ORE]: 1.8, [B.DIAMOND_ORE]: 2.0
};
const mineTime = (b) => MINE_TIME[b] ?? 1.2;

// ---------- HUD ----------
const $ = (id) => document.getElementById(id);
const hud = $('hud');
const fpsEl = $('fps');
const posEl = $('pos');
const clockEl = $('clock');
const heartsEl = $('hearts');
const underwaterEl = $('underwater');
const crosshair = $('crosshair');
const toastEl = $('toast');
const hotbarEl = $('hotbar');

// ---------- Inventory & crafting ----------
const inv = new Inventory(36);
inv.add(B.PLANKS, 32);
inv.add(B.LOG, 16);
const invModal = $('modalInv');
const invGridEl = $('invGrid');
const craftGridEl = $('craftGrid');
const craftOutEl = $('craftOut');
let cursorStack = null;
let craftSize = 2;
const craftSlots = [];

function itemColor(id) { const info = itemInfo(id); return info ? info.color : '#ffffff'; }
function itemName(id) { const info = itemInfo(id); return info ? t(info.name) : '?'; }

function renderSlotEl(el, s) {
  el.innerHTML = '';
  if (!s) return;
  const icon = document.createElement('span');
  icon.className = 'inv-icon';
  icon.style.background = iconBg(s.id);
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
    el.addEventListener('mousedown', (e) => { e.preventDefault(); clickSlot('craft', idx, e.button, e.shiftKey); if (e.button === 2 && cursorStack) rmbDrag = true; });
    el.addEventListener('dblclick', () => collectDoubleClick('craft', idx));
    el.addEventListener('mouseenter', () => { hoverSlot = { kind: 'craft', i: idx }; if (rmbDrag) dragPlace('craft', idx); });
    el.addEventListener('mouseleave', () => { if (hoverSlot && hoverSlot.i === idx) hoverSlot = null; });
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

// ---------- MC-style inventory interaction ----------
let hoverSlot = null; // { kind: 'main' | 'craft', i } | null
let rmbDrag = false; // right-button drag: place one item per slot passed over (MC)

function slotStack(kind, i) {
  return kind === 'main' ? inv.slots[i] : craftSlots[i].s;
}
function setSlotStack(kind, i, v) {
  if (kind === 'main') inv.slots[i] = v; else craftSlots[i].s = v;
}

// LMB: pick up / merge / place. RMB: place one / take half. MMB: grab whole stack.
function clickSlot(kind, i, button, shift) {
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
  refreshInv();
}

// Shift+click: quick move between hotbar and storage (or craft -> inventory)
function quickMove(kind, i) {
  if (kind === 'craft') {
    const cs = craftSlots[i];
    if (!cs.s) return;
    const left = inv.add(cs.s.id, cs.s.count);
    if (left > 0) { toast(t('toast.invFull')); return; }
    cs.s = null;
    refreshInv();
    return;
  }
  const s = inv.slots[i];
  if (!s) return;
  const isHotbar = i < 10;
  const from = isHotbar ? [10, 36] : [0, 10]; // target range
  for (let j = from[0]; j < from[1]; j++) {
    const st = inv.slots[j];
    if (st && st.id === s.id && st.count < STACK_MAX) {
      const take = Math.min(STACK_MAX - st.count, s.count);
      st.count += take; s.count -= take;
      if (s.count <= 0) { inv.slots[i] = null; refreshInv(); return; }
    }
  }
  for (let j = from[0]; j < from[1]; j++) {
    if (!inv.slots[j]) {
      inv.slots[j] = s; inv.slots[i] = null;
      refreshInv();
      return;
    }
  }
  toast(t('toast.invFull'));
}

// Double-click: gather all matching items into the cursor
function collectDoubleClick(kind, i) {
  const s = slotStack(kind, i);
  if (!s) return;
  if (cursorStack && cursorStack.id !== s.id) return;
  const id = s.id;
  let total = cursorStack ? cursorStack.count : 0;
  for (let j = 0; j < inv.slots.length; j++) {
    const st = inv.slots[j];
    if (st && st.id === id) { total += st.count; inv.slots[j] = null; }
  }
  for (const cs of craftSlots) {
    if (cs.s && cs.s.id === id) { total += cs.s.count; cs.s = null; }
  }
  cursorStack = { id, count: Math.min(total, STACK_MAX) };
  const left = total - cursorStack.count;
  if (left > 0) {
    const cur = slotStack(kind, i);
    if (cur && cur.id === id) cur.count += left;
    else setSlotStack(kind, i, { id, count: left });
  }
  refreshInv();
}

// Place a single item from the cursor into a slot (used by RMB-drag)
function dragPlace(kind, i) {
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
  refreshInv();
}

function refreshInv() {
  renderInvGrid();
  renderCraft();
  renderHotbar();
  renderCursor();
}

// Floating cursor item that follows the mouse
const cursorEl = $('cursorItem');
function renderCursor() {
  if (!cursorStack) { cursorEl.classList.remove('is-on'); cursorEl.innerHTML = ''; return; }
  cursorEl.classList.add('is-on');
  cursorEl.innerHTML =
    '<span class="inv-icon" style="background:' + iconBg(cursorStack.id) + '"></span>' +
    (cursorStack.count > 1 ? '<span class="inv-count">' + cursorStack.count + '</span>' : '');
}
window.addEventListener('mouseup', () => { rmbDrag = false; });
invModal.addEventListener('mousemove', (e) => {
  const r = invModal.getBoundingClientRect();
  cursorEl.style.left = (e.clientX - r.left + 12) + 'px';
  cursorEl.style.top = (e.clientY - r.top + 12) + 'px';
});

function collectCraft() {
  const m = matchCraft(currentCraftGrid());
  if (!m) return;
  // Consume the recipe cells
  for (const ci of m.cells) {
    const cs = craftSlots[ci];
    cs.s.count--;
    if (cs.s.count <= 0) cs.s = null;
  }
  // Return leftover craft-grid items to the inventory
  for (const cs of craftSlots) {
    if (cs.s) {
      const left = inv.add(cs.s.id, cs.s.count);
      if (left > 0) toast(t('toast.invFull'));
      cs.s = null;
    }
  }
  const left = inv.add(m.recipe.out.id, m.recipe.out.n);
  if (left > 0) toast(t('toast.invFull'));
  renderCraft();
  renderHotbar();
}
craftOutEl.addEventListener('click', collectCraft);

function buildInvGrid() {
  invGridEl.innerHTML = '';
  for (let i = 0; i < inv.slots.length; i++) {
    const el = makeSlotEl();
    el.addEventListener('mousedown', (e) => { e.preventDefault(); clickSlot('main', i, e.button, e.shiftKey); if (e.button === 2 && cursorStack) rmbDrag = true; });
    el.addEventListener('dblclick', () => collectDoubleClick('main', i));
    el.addEventListener('mouseenter', () => { hoverSlot = { kind: 'main', i }; if (rmbDrag) dragPlace('main', i); });
    el.addEventListener('mouseleave', () => { if (hoverSlot && hoverSlot.i === i) hoverSlot = null; });
    invGridEl.appendChild(el);
  }
  renderInvGrid();
}

function renderInvGrid() {
  [...invGridEl.children].forEach((el, i) => renderSlotEl(el, inv.slots[i]));
}

// (mainClick merged into clickSlot)

function nearTable() {
  const px = Math.floor(player.pos.x), pz = Math.floor(player.pos.z);
  for (let dx = -5; dx <= 5; dx++) {
    for (let dz = -5; dz <= 5; dz++) {
      for (let y = 0; y < HEIGHT; y++) {
        if (world.get(px + dx, y, pz + dz) === B.CRAFTING_TABLE) return true;
      }
    }
  }
  return false;
}

function openInv() {
  modalOpen = 'modalInv';
  cursorStack = null;
  hoverSlot = null;
  player.clearKeys();
  const hasTable = nearTable();
  buildCraftGrid(hasTable ? 3 : 2);
  buildInvGrid();
  show(invModal);
  if (document.pointerLockElement) document.exitPointerLock();
  toast(hasTable ? t('toast.craftTable') : t('toast.noTable'));
}

// ---------- Hotbar (inventory slots 0-9) ----------
let selected = 0;

function renderHotbar() {
  hotbarEl.innerHTML = '';
  for (let i = 0; i < 10; i++) {
    const s = inv.slots[i];
    const slot = document.createElement('button');
    slot.className = 'slot' + (i === selected ? ' is-active' : '');
    slot.setAttribute('aria-label', s ? t(itemInfo(s.id).name) : '');
    slot.innerHTML =
      '<span class="slot__num">' + (i + 1) + '</span>' +
      '<span class="slot__icon" style="background:' + (s ? iconBg(s.id) : 'transparent') + '"></span>' +
      '<span class="slot__name">' + (s ? (s.count > 1 ? s.count + ' ' : '') + t(itemInfo(s.id).name) : '') + '</span>';
    slot.addEventListener('click', () => selectSlot(i));
    hotbarEl.appendChild(slot);
  }
}

function selectSlot(i) {
  selected = i;
  [...hotbarEl.children].forEach((s, j) => s.classList.toggle('is-active', j === i));
}

renderHotbar();

let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('is-show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('is-show'), 1400);
}

// ---------- Game state ----------
let state = 'start'; // start | play | pause
let modalOpen = null;

const startOv = $('start');
const pauseOv = $('pause');
const helpModal = $('modalHelp');
const settingsModal = $('modalSettings');

function show(el) { el.hidden = false; el.classList.remove('is-hidden'); }
function hide(el) { el.classList.add('is-hidden'); setTimeout(() => { el.hidden = true; }, 250); }

function lock() {
  try {
    const p = renderer.domElement.requestPointerLock();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (e) {
    // Headless / no-gesture contexts: pointer lock is unavailable, keep playing.
  }
}

function startGame() {
  state = 'play';
  hide(startOv);
  lock();
  sfx.unlock();
}

function pauseGame() {
  state = 'pause';
  player.clearKeys();
  mouseDown = false;
  mining = null;
  show(pauseOv);
}

function resumeGame() {
  state = 'play';
  hide(pauseOv);
  lock();
}

function openModal(id) {
  modalOpen = id;
  player.clearKeys();
  show($(id));
}

function closeModal() {
  if (!modalOpen) return;
  // Inventory: return the held stack to the inventory (MC behavior)
  if (modalOpen === 'modalInv' && cursorStack) {
    const left = inv.add(cursorStack.id, cursorStack.count);
    if (left > 0) {
      // No room: drop it at the player's feet
      spawnPuff(player.pos.x, player.pos.y + 0.3, player.pos.z, 6, 0xcccccc);
      sfx.dropItem();
    }
    cursorStack = null;
    hoverSlot = null;
    renderCursor();
    renderHotbar();
  }
  hide($(modalOpen));
  modalOpen = null;
  if (state === 'play') lock();
}

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

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  if (!locked && state === 'play' && !modalOpen) pauseGame();
  if (locked && state === 'pause') { state = 'play'; hide(pauseOv); }
});

// ---------- Input (rebindable, MC-style) ----------
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
    renderKeyBinds();
    return;
  }
  if (e.code === 'Escape') {
    if (modalOpen) { closeModal(); return; }
    if (state === 'pause') { resumeGame(); return; }
    // In play: the browser releases pointer lock on Esc and
    // pointerlockchange opens the pause menu. If we are not locked
    // (headless), pause manually.
    if (state === 'play' && document.pointerLockElement !== renderer.domElement) pauseGame();
    return;
  }
  // Inventory open: digits shove the hovered stack into that hotbar slot (MC)
  if (modalOpen === 'modalInv') {
    if (e.code.startsWith('Digit') && hoverSlot) {
      const n = parseInt(e.code.slice(5), 10);
      if (n >= 1 && n <= 10) shoveToHotbar(n - 1);
    }
    return;
  }
  if (modalOpen) return;
  if (state !== 'play') {
    if (e.code === 'Enter' && state === 'start') startGame();
    return;
  }
  const canon = keyMap[e.code];
  if (canon) player.setKey(canon, true);
  if (e.code.startsWith('Digit')) {
    const n = parseInt(e.code.slice(5), 10);
    if (n >= 1 && n <= 10) selectSlot(n - 1);
  }
  if (BINDS.inv.includes(e.code)) openInv();
  if (e.code === 'KeyH') openModal('modalHelp');
  if (BINDS.pause.includes(e.code)) pauseGame();
  if (BINDS.drop.includes(e.code) && !e.repeat) dropSelected(e.ctrlKey);
});

document.addEventListener('keyup', (e) => {
  const canon = keyMap[e.code];
  if (canon) player.setKey(canon, false);
});

// Lost focus (Alt+Tab, click outside): release all held keys so the
// player does not keep walking inside the menus.
window.addEventListener('blur', () => { player.clearKeys(); mouseDown = false; mining = null; });

// Hotbar: scroll the wheel to switch slots.
window.addEventListener('wheel', (e) => {
  if (state !== 'play' || modalOpen) return;
  const dir = e.deltaY > 0 ? 1 : e.deltaY < 0 ? -1 : 0;
  if (!dir) return;
  selectSlot((selected + dir + 10) % 10);
}, { passive: true });

// Click on the canvas re-captures the mouse if the lock was lost.
renderer.domElement.addEventListener('click', () => {
  if (state === 'play' && !modalOpen && document.pointerLockElement !== renderer.domElement) lock();
});

document.addEventListener('mousemove', (e) => {
  if (state !== 'play' || document.pointerLockElement !== renderer.domElement) return;
  player.look(e.movementX, e.movementY);
});

function blockAction(button) {
  if (state !== 'play' || document.pointerLockElement !== renderer.domElement) return;
  const o = player.eye();
  const d = player.lookDir();
  const hit = raycastVoxel(world, o, d, 7);
  if (!hit) return;
  if (button === 1) {
    // Pick block (survival): select the slot already holding this block
    const [x, y, z] = hit.hit;
    const b = world.get(x, y, z);
    if (b !== B.AIR && b !== B.WATER) {
      for (let i = 0; i < inv.slots.length; i++) {
        const st = inv.slots[i];
        if (st && st.id === b) { selectSlot(i); sfx.uiClick(); return; }
      }
    }
    return;
  }
  if (button === 0) {
      mouseDown = true;
      swingT = 0.28;
      // Attack a mob first (closer than a block)
      const mobHit = mobManager.hitMob({ x: o.x, y: o.y, z: o.z }, { x: d.x, y: d.y, z: d.z }, 3.5);
      if (mobHit) {
        mining = null;
        const sel = inv.slots[selected];
        const atk = sel && itemInfo(sel.id).attack ? itemInfo(sel.id).attack : 4;
        const died = mobHit.mob.hit(atk, o.x, o.z);
        sfx.hitMob();
        if (died) toast(t('toast.mobKilled'));
        else toast(t('toast.attack'));
        return;
      }
      const [x, y, z] = hit.hit;
      if (world.get(x, y, z) === B.BEDROCK) { mining = null; return; }
      // Start (or keep) mining this block; progress accumulates in the frame loop
      if (!mining || mining.x !== x || mining.y !== y || mining.z !== z) mining = { x, y, z, t: 0 };
} else if (button === 2) {
    const [x, y, z] = hit.prev;
    const pb = world.get(x, y, z);
    if (pb !== B.AIR && pb !== B.WATER) return;
    // Do not place inside the player
    const p = player.pos;
    if (
      x + 1 > p.x - 0.32 && x < p.x + 0.32 &&
      z + 1 > p.z - 0.32 && z < p.z + 0.32 &&
      y + 1 > p.y && y < p.y + 1.8
    ) return;
    const sel = inv.slots[selected];
    if (!sel || !itemInfo(sel.id).placeable) { toast(t('toast.noBlock')); return; }
    world.set(x, y, z, sel.id);
    inv.take(selected, 1);
    renderHotbar();
    rebuildAt(x, z);
    if (sel.id === B.CRAFTING_TABLE) toast(t('toast.craftTable'));
    else toast(t('toast.placed'));
    netSendBlock(x, y, z, sel.id);
    sfx.place();
  }
}

function rebuildAt(x, z) {
  const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
  buildChunk(cx, cz);
  if (x % CHUNK === 0) buildChunk(cx - 1, cz);
  if (x % CHUNK === CHUNK - 1) buildChunk(cx + 1, cz);
  if (z % CHUNK === 0) buildChunk(cx, cz - 1);
  if (z % CHUNK === CHUNK - 1) buildChunk(cx, cz + 1);
}

renderer.domElement.addEventListener('mousedown', (e) => {
  if (state !== 'play' || document.pointerLockElement !== renderer.domElement) return;
  blockAction(e.button);
});

renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('mouseup', (e) => {
  if (e.button === 0) { mouseDown = false; mining = null; }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Help grid ----------
const HELP = [
  ['WASD', 'help.wasd'],
  ['Mouse', 'help.mouse'],
  ['Space', 'help.jump'],
  ['Shift', 'help.sprint'],
  ['LMB', 'help.break'],
  ['RMB', 'help.place'],
  ['MMB', 'key.pick'],
  ['Q / Ctrl+Q', 'key.drop'],
  ['1-10', 'help.slot'],
  ['E', 'help.inventory'],
  ['Shift+click', 'key.shiftClick'],
  ['2x click', 'key.doubleClick'],
  ['Esc / P', 'help.pause'],
  ['H', 'help.help']
];
$('helpGrid').innerHTML = HELP.map(([k, key]) =>
  '<div class="help-item"><kbd>' + k + '</kbd><span>' + t(key) + '</span></div>'
).join('');

// ---------- Settings ----------
const segLang = $('segLang');
const segTheme = $('segTheme');
const tglMotion = $('tglMotion');

function syncSeg(seg, value) {
  [...seg.children].forEach((b) => b.classList.toggle('is-on', b.dataset.lang === value || b.dataset.theme === value));
}

function setTheme(th) {
  document.documentElement.setAttribute('data-theme', th);
  syncSeg(segTheme, th);
  localStorage.setItem('vw-theme', th);
}

function setReducedMotion(on) {
  document.documentElement.setAttribute('data-ui-motion', on ? 'reduced' : 'full');
  tglMotion.setAttribute('aria-pressed', String(on));
  localStorage.setItem('vw-motion', on ? '1' : '0');
}

segLang.addEventListener('click', (e) => {
  const l = e.target.dataset.lang;
  if (!l) return;
  setLang(l);
  applyI18n();
  syncSeg(segLang, l);
  localStorage.setItem('vw-lang', l);
  // Rebuild hotbar names + help grid in the new language
  [...hotbarEl.children].forEach((s, i) => {
    s.querySelector('.slot__name').textContent = t(BLOCK_INFO[HOTBAR[i]].name);
    s.setAttribute('aria-label', t(BLOCK_INFO[HOTBAR[i]].name));
  });
  $('helpGrid').innerHTML = HELP.map(([k, key]) =>
    '<div class="help-item"><kbd>' + k + '</kbd><span>' + t(key) + '</span></div>'
  ).join('');
});

segTheme.addEventListener('click', (e) => {
  const th = e.target.dataset.theme;
  if (th) setTheme(th);
});

tglMotion.addEventListener('click', () => {
  setReducedMotion(tglMotion.getAttribute('aria-pressed') !== 'true');
});

// Sound on/off + volume
const tglSound = $('tglSound');
const volSlider = $('volSlider');
function setSound(on) {
  sfx.setEnabled(on);
  tglSound.setAttribute('aria-pressed', String(on));
  localStorage.setItem('vw-sound', on ? '1' : '0');
}
function setVolume(v) {
  sfx.setVolume(v);
  volSlider.value = Math.round(v * 100);
  localStorage.setItem('vw-vol', String(v));
}
tglSound.addEventListener('click', () => {
  setSound(tglSound.getAttribute('aria-pressed') !== 'true');
  sfx.unlock();
  sfx.uiClick();
});
volSlider.addEventListener('input', () => setVolume(volSlider.value / 100));

// Keybinds grid (click a key, then press the new one)
const keyBindsEl = $('keyBinds');
const BIND_ROWS = [
  ['move', 0, 'key.move'], ['move', 1, 'key.move'], ['move', 2, 'key.move'], ['move', 3, 'key.move'],
  ['jump', 0, 'key.jump'], ['sprint', 0, 'key.sprint'],
  ['drop', 0, 'key.drop'], ['inv', 0, 'key.inv'], ['pause', 0, 'key.quit']
];
function keyLabel(code) {
  if (!code) return '?';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return code.slice(5);
  return code;
}
function renderKeyBinds() {
  keyBindsEl.innerHTML = BIND_ROWS.map(([action, idx, key], row) =>
    '<div class="keybind"><span>' + t(key) + '</span>' +
    '<button class="keybind__key" data-action="' + action + '" data-idx="' + idx + '">' + keyLabel(BINDS[action][idx]) + '</button></div>'
  ).join('');
}
keyBindsEl.addEventListener('click', (e) => {
  const b = e.target.closest('.keybind__key');
  if (!b) return;
  rebindTarget = { action: b.dataset.action, index: +b.dataset.idx };
  [...keyBindsEl.querySelectorAll('.keybind__key')].forEach((x) => x.classList.toggle('is-listening', x === b));
});
renderKeyBinds();

// Restore saved settings
loadBinds();
setSound(localStorage.getItem('vw-sound') !== '0');
setVolume(parseFloat(localStorage.getItem('vw-vol') ?? '0.5'));
setLang(localStorage.getItem('vw-lang') || 'ru');
setTheme(localStorage.getItem('vw-theme') || 'dark');
setReducedMotion(localStorage.getItem('vw-motion') === '1');
applyI18n();
syncSeg(segLang, localStorage.getItem('vw-lang') || 'ru');

// ---------- Multiplayer (optional WebSocket) ----------
const net = new NetClient(location.protocol === 'https:' ? 'wss://' : 'ws://' + location.host + '/net');
net.onState((on) => {
  if (on) toast(t('toast.netOn'));
});
function netSendBlock(x, y, z, id) {
  net.send({ t: 'block', x, y, z, id });
}
net.onBlock(({ x, y, z, id }) => {
  if (world.get(x, y, z) === id) return;
  world.set(x, y, z, id);
  rebuildAt(x, z);
});
net.onPlayer((p) => upsertRemote(p));
net.onLeave((id) => removeRemote(id));

// Remote players (simple blocky avatars)
const remotePlayers = new Map(); // id -> { group, pos, yaw, target }
function upsertRemote(p) {
  let r = remotePlayers.get(p.id);
  if (!r) {
    const g = new THREE.Group();
    const mat = (hex) => new THREE.MeshLambertMaterial({ color: hex });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.3), mat(p.color));
    body.position.y = 0.85;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), mat(0xd9a066));
    head.position.y = 1.42;
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.16), mat(p.color));
    armL.position.set(0.34, 0.9, 0);
    const armR = armL.clone();
    armR.position.x = -0.34;
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.2), mat(0x33415c));
    legL.position.set(0.14, 0.25, 0);
    const legR = legL.clone();
    legR.position.x = -0.14;
    g.add(body, head, armL, armR, legL, legR);
    scene.add(g);
    r = { group: g, pos: { x: p.x, y: p.y, z: p.z }, yaw: p.yaw };
    remotePlayers.set(p.id, r);
  }
  r.target = { x: p.x, y: p.y, z: p.z, yaw: p.yaw };
}
function removeRemote(id) {
  const r = remotePlayers.get(id);
  if (r) {
    scene.remove(r.group);
    remotePlayers.delete(id);
  }
}
function updateRemote(dt) {
  for (const r of remotePlayers.values()) {
    if (!r.target) continue;
    const k = Math.min(1, dt * 12);
    r.pos.x += (r.target.x - r.pos.x) * k;
    r.pos.y += (r.target.y - r.pos.y) * k;
    r.pos.z += (r.target.z - r.pos.z) * k;
    r.yaw += (r.target.yaw - r.yaw) * k;
    r.group.position.set(r.pos.x, r.pos.y, r.pos.z);
    r.group.rotation.y = r.yaw;
  }
}

// ---------- Loop ----------
let last = performance.now();
let netTick = 0;
let fpsAcc = 0, fpsFrames = 0, fpsLast = last;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = (now - last) / 1000;
  last = now;

  if (state === 'play') {
    player.update(dt);
    streamChunks();
    updateMining(dt);
    mobManager.update(dt, player.pos.x, player.pos.y, player.pos.z, isNight(dayTime), (n) => {
      player.damage(n);
      toast(t('toast.hurt'));
      damageFlash();
      sfx.hurt();
    });
    syncMobs();
    // Broadcast position ~10 times a second
    netTick -= dt;
    if (netTick <= 0) {
      netTick = 0.1;
      net.send({ t: 'pos', x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw });
    }
  }
  updateRemote(dt);
  updateParticles(dt);
  if (dmgFlashT > 0) {
    dmgFlashT -= dt;
    dmgFlashEl.style.opacity = Math.max(0, dmgFlashT / 0.45 * 0.55);
  } else if (dmgFlashEl.style.opacity !== '0') {
    dmgFlashEl.style.opacity = '0';
  }

  // Hand: circular swing arc (MC-style) + walk bob, held item follows the selected slot
  swingT = Math.max(0, swingT - dt);
  const moving = player.vel.x * player.vel.x + player.vel.z * player.vel.z > 1;
  if (moving) bobT += dt * 9;
  const bobY = moving ? Math.sin(bobT) * 0.025 : 0;
  const bobX = moving ? Math.cos(bobT * 0.5) * 0.015 : 0;
  handGroup.position.set(0.42 + bobX, -0.42 + bobY, -0.7);
  if (swingT > 0) {
    // One full arc: the fist sweeps up-left then down-right (like MC's punch)
    const p = 1 - swingT / 0.28; // 0..1
    const a = Math.sin(p * Math.PI); // 0 -> 1 -> 0
    handGroup.rotation.x = 0.25 - a * 1.1;
    handGroup.rotation.z = -a * 1.3;
    handGroup.position.x = 0.42 + bobX + a * 0.18;
    handGroup.position.y = -0.42 + bobY + a * 0.12;
  } else {
    handGroup.rotation.x = 0.25;
    handGroup.rotation.z = 0;
  }
  const held = inv.slots[selected];
  heldItem.visible = !!held; // hide the item cube when the slot is empty
  if (held) {
    const map = makeIconTexture(held.id);
    if (heldItem.material.map !== map) heldItem.material.map = map;
    heldItem.material.needsUpdate = true;
  }

  camera.position.set(player.pos.x, player.pos.y + 1.62, player.pos.z);
  camera.rotation.set(0, 0, 0);
  camera.rotateY(player.yaw);
  camera.rotateX(player.pitch);

  // Highlight targeted block
  if (state === 'play') {
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

  // Mining crack overlay
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

  // Day/night cycle
  if (state === 'play') dayTime = (dayTime + dt / DAY_LENGTH) % 1;
  const dLight = daylight(dayTime);
  const sky = skyColor(dayTime);
  const sunDir = sunDirection(dayTime);
  const moonDir = moonDirection(dayTime);
  const eye = { x: player.pos.x, y: player.pos.y + 1.62, z: player.pos.z };
  sun.position.set(eye.x + sunDir.x * 120, eye.y + sunDir.y * 120, eye.z + sunDir.z * 120);
  sun.target.position.set(eye.x, eye.y, eye.z);
  sun.intensity = 0.22 + dLight * 1.35;
  ambient.intensity = 0.3 + dLight * 0.6;
  sunMesh.position.set(eye.x + sunDir.x * 220, eye.y + sunDir.y * 220, eye.z + sunDir.z * 220);
  moonMesh.position.set(eye.x + moonDir.x * 220, eye.y + moonDir.y * 220, eye.z + moonDir.z * 220);
  stars.position.set(eye.x, eye.y, eye.z);
  starMat.opacity = Math.max(0, 1 - dLight * 2.2);

  // Underwater tint or sky color
  const eyeBlock = world.get(Math.floor(eye.x), Math.floor(eye.y), Math.floor(eye.z));
  underwaterEl.classList.toggle('is-on', eyeBlock === B.WATER);
  if (eyeBlock === B.WATER) {
    scene.fog.color.setHex(0x2a5da8);
    scene.background.setHex(0x2a5da8);
  } else {
    scene.fog.color.setRGB(sky[0], sky[1], sky[2]);
    scene.background.setRGB(sky[0], sky[1], sky[2]);
  }

  renderer.render(scene, camera);

  // FPS + position + clock readout
  fpsFrames++;
  if (now - fpsLast >= 500) {
    fpsEl.textContent = Math.round(fpsFrames * 1000 / (now - fpsLast));
    fpsFrames = 0;
    fpsLast = now;
    posEl.textContent = Math.floor(player.pos.x) + ', ' + Math.floor(player.pos.y) + ', ' + Math.floor(player.pos.z);
    clockEl.textContent = clockLabel(dayTime);
    heartsEl.textContent = '❤️'.repeat(Math.ceil(player.hp / 4)) + '🖤'.repeat(5 - Math.ceil(player.hp / 4));
  }
}

requestAnimationFrame(frame);

// Debug/test hook
window.__voxel = { world, player, state: () => state, chunkMeshes, inv, mobManager, net, scene, blockAction, mineTime, MINE_TIME, getMining: () => mining, setMouseDown: (b) => { mouseDown = b; }, spawnPuff, updateParticles };
window.addEventListener('error', (e) => { window.__lastErr = e.message + ' @' + (e.lineno || '?'); });
