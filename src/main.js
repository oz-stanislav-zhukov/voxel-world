import * as THREE from 'three';
import { World, buildChunkMesh, CHUNK, HEIGHT } from './world.js';
import { Player } from './player.js';
import { B } from './blocks.js';
import { Inventory } from './inventory.js';
import { createAtlasAssets } from './textures.js';
import { NetClient } from './net.js';
import * as sfx from './sound.js';
import { DAY_LENGTH, daylight, skyColor, sunDirection, moonDirection, isNight, clockLabel } from './daynight.js';
import { MobManager } from './mobs.js';
import * as mobview from './mob-view.js';
import * as remote from './remote.js';
import { on } from './events.js';
import { t } from './i18n.js';
import * as input from './input.js';
import * as mining from './mining.js';
import * as hand from './hand.js';
import * as drops from './drops.js';
import * as hud from './hud.js';
import * as overlays from './overlays.js';
import * as invui from './inv-ui.js';
import * as settings from './settings.js';

// ---------- Renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('app').prepend(renderer.domElement);
const canvas = renderer.domElement;
const crosshair = document.getElementById('crosshair');
const underwaterEl = document.getElementById('underwater');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fd0f5);
scene.fog = new THREE.Fog(0x9fd0f5, 40, 110);
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 300);
const sun = new THREE.DirectionalLight(0xffffff, 1.35);
sun.position.set(60, 100, 40);
scene.add(sun, sun.target);
const ambient = new THREE.AmbientLight(0xbfd8ff, 0.75);
scene.add(ambient);

// ---------- Sky: sun, moon, stars ----------
const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(6, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffe08a, fog: false }));
const moonMesh = new THREE.Mesh(new THREE.SphereGeometry(4.5, 16, 16), new THREE.MeshBasicMaterial({ color: 0xd8e2f2, fog: false }));
scene.add(sunMesh, moonMesh);
const STAR_COUNT = 800;
const starPos = new Float32Array(STAR_COUNT * 3);
for (let i = 0; i < STAR_COUNT; i++) {
  const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random()), R = 250;
  starPos[i * 3] = R * Math.sin(ph) * Math.cos(th); starPos[i * 3 + 1] = Math.abs(R * Math.cos(ph)) - 20;
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
const { atlasTex, iconBg, makeIconTexture } = createAtlasAssets(THREE);
const solidMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: atlasTex, alphaTest: 0.5 });
const waterMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: atlasTex, transparent: true, opacity: 0.62, depthWrite: false });
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
const VIEW = 4;
let lastCx = null, lastCz = null;
function streamChunks() {
  const pcx = Math.floor(player.pos.x / CHUNK), pcz = Math.floor(player.pos.z / CHUNK);
  if (pcx === lastCx && pcz === lastCz) return;
  lastCx = pcx; lastCz = pcz;
  for (const [key, m] of chunkMeshes) {
    const [cx, cz] = key.split(',').map(Number);
    if (Math.abs(cx - pcx) > VIEW + 1 || Math.abs(cz - pcz) > VIEW + 1) {
      scene.remove(m.solid, m.water);
      m.solid.geometry.dispose();
      m.water.geometry.dispose();
      chunkMeshes.delete(key);
    }
  }
  const todo = [];
  for (let cx = pcx - VIEW; cx <= pcx + VIEW; cx++) {
    for (let cz = pcz - VIEW; cz <= pcz + VIEW; cz++) {
      if (!chunkMeshes.has(cx + ',' + cz)) todo.push([cx, cz]);
    }
  }
  todo.sort((a, b) => (a[0] - pcx) ** 2 + (a[1] - pcz) ** 2 - ((b[0] - pcx) ** 2 + (b[1] - pcz) ** 2));
  for (const [cx, cz] of todo.slice(0, 6)) buildChunk(cx, cz);
}
function rebuildAt(x, z) {
  const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
  buildChunk(cx, cz);
  if (x % CHUNK === 0) buildChunk(cx - 1, cz);
  if (x % CHUNK === CHUNK - 1) buildChunk(cx + 1, cz);
  if (z % CHUNK === 0) buildChunk(cx, cz - 1);
  if (z % CHUNK === CHUNK - 1) buildChunk(cx, cz + 1);
}

// ---------- Mobs (AI in mobs.js, meshes in mob-view.js) ----------
const mobManager = new MobManager(world);

// ---------- Core objects ----------
const player = new Player(world);
const inv = new Inventory(36);
inv.add(B.PLANKS, 32);
inv.add(B.LOG, 16);

// ---------- Wire the modules ----------
sfx.initSound();
mobview.initMobView(scene, mobManager);
remote.initRemote(scene);
overlays.initOverlays({
  canvas, player, sfx,
  resetMining: mining.resetMining,
  spawnPuff: drops.spawnPuff,
  inv,
  renderCursor: invui.renderCursor,
  renderHotbar: invui.renderHotbar,
  dropItemSfx: () => sfx.dropItem(),
  cursorStack: invui.getCursorStack, setCursorStack: invui.setCursorStack
});
hud.initHud({
  fpsEl: document.getElementById('fps'), posEl: document.getElementById('pos'),
  clockEl: document.getElementById('clock'), heartsEl: document.getElementById('hearts'),
  dmgFlashEl: document.getElementById('dmgFlash'), toastEl: document.getElementById('toast'),
  player, getDayTime: () => dayTime, clockLabel
});
mining.initMining({
  scene, world, player, inv,
  selected: invui.selectedSlot, selectSlot: invui.selectSlot,
  spawnPuff: drops.spawnPuff, spawnDrop: drops.spawnDrop,
  rebuildAt, netSendBlock, hitMob: (o, d, r) => mobManager.hitMob(o, d, r),
  getState: overlays.getState, isModalOpen: overlays.isModalOpen,
  canvas, renderHotbar: invui.renderHotbar, crosshair, t
});
hand.initHand({ camera, scene, makeIconTexture, inv, selected: invui.selectedSlot });
drops.initDrops({ scene, world, player, inv, makeIconTexture, sfx, renderHotbar: invui.renderHotbar });
invui.initInvUI({
  inv, iconBg, t, toast: hud.toast, player, world, HEIGHT, B,
  show: (el) => { el.hidden = false; el.classList.remove('is-hidden'); },
  hide: (el) => { el.classList.add('is-hidden'); setTimeout(() => { el.hidden = true; }, 250); },
  exitLock: () => { if (document.pointerLockElement) document.exitPointerLock(); },
  spawnPuff: drops.spawnPuff, dropItemSfx: () => sfx.dropItem()
});
input.initInput({
  player, canvas,
  getState: overlays.getState, isModalOpen: overlays.isModalOpen,
  closeModal: () => {
    if (overlays.isModalOpen() === 'modalInv') invui.closeInv();
    else overlays.closeModal();
  }, resumeGame: overlays.resumeGame, pauseGame: overlays.pauseGame,
  startGame: overlays.startGame, respawn: overlays.respawn,
  openInv: invui.openInv, openModal: overlays.openModal,
  selectSlot: invui.selectSlot, selected: invui.selectedSlot,
  dropSelected: (all) => invui.dropSelected(all, drops.spawnDrop),
  shoveToHotbar: invui.shoveToHotbar,
  lock: overlays.lock,
  renderKeyBinds: settings.renderKeyBindsPublic,
  onBlur: () => { player.clearKeys(); mining.resetMining(); }
});
settings.initSettings({
  renderHotbarNames: () => invui.renderHotbar(),
  renderHelpGrid: () => {
    document.getElementById('helpGrid').innerHTML = HELP.map(([k, key]) =>
      '<div class="help-item"><kbd>' + k + '</kbd><span>' + t(key) + '</span></div>').join('');
  }
});

// ---------- Help grid ----------
const HELP = [['WASD', 'help.wasd'], ['Mouse', 'help.mouse'], ['Space', 'help.jump'], ['Shift', 'help.sprint'],
  ['LMB', 'help.break'], ['RMB', 'help.place'], ['MMB', 'key.pick'], ['Q / Ctrl+Q', 'key.drop'],
  ['1-10', 'help.slot'], ['E', 'help.inventory'], ['Shift+click', 'key.shiftClick'],
  ['2x click', 'key.doubleClick'], ['Esc / P', 'help.pause'], ['H', 'help.help']];
document.getElementById('helpGrid').innerHTML = HELP.map(([k, key]) =>
  '<div class="help-item"><kbd>' + k + '</kbd><span>' + t(key) + '</span></div>').join('');

// ---------- Event subscriptions (the glue) ----------
on('toast', ({ key }) => hud.toast(t(key)));
on('damage', () => hud.toast(t('toast.hurt')));
on('respawn', () => hud.toast(t('toast.respawned')));
on('craft', () => hud.toast(t('toast.crafted')));

// ---------- Multiplayer (optional WebSocket) ----------
const net = new NetClient(location.protocol === 'https:' ? 'wss://' : 'ws://' + location.host + '/net');
net.onState((on2) => { if (on2) hud.toast(t('toast.netOn')); });
function netSendBlock(x, y, z, id) { net.send({ t: 'block', x, y, z, id }); }
net.onBlock(({ x, y, z, id }) => {
  if (world.get(x, y, z) === id) return;
  world.set(x, y, z, id);
  rebuildAt(x, z);
});
net.onPlayer((p) => remote.upsertRemote(p));
net.onLeave((id) => remote.removeRemote(id));

// ---------- Loop ----------
let last = performance.now();
let netTick = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = (now - last) / 1000;
  last = now;
  if (overlays.getState() === 'play') {
    player.update(dt);
    streamChunks();
    mining.updateMining(dt);
    mobManager.update(dt, player.pos.x, player.pos.y, player.pos.z, isNight(dayTime), (n) => player.damage(n));
    mobview.syncMobs();
    netTick -= dt;
    if (netTick <= 0) {
      netTick = 0.1;
      net.send({ t: 'pos', x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw });
    }
  }
  remote.updateRemote(dt);
  drops.updateParticles(dt);
  drops.updateDrops(dt);
  hud.updateHud(dt, now);
  hand.updateHand(dt, player);
  mining.renderMining();

  camera.position.set(player.pos.x, player.pos.y + 1.62, player.pos.z);
  camera.rotation.set(0, 0, 0);
  camera.rotateY(player.yaw);
  camera.rotateX(player.pitch);

  // Day/night cycle
  if (overlays.getState() === 'play') dayTime = (dayTime + dt / DAY_LENGTH) % 1;
  const dLight = daylight(dayTime);
  const sky = skyColor(dayTime);
  const sunDir = sunDirection(dayTime);
  const moonDir = moonDirection(dayTime);
  const eye = { x: player.pos.x, y: player.pos.y + 1.62, z: player.pos.z };
  sun.position.set(eye.x + sunDir.x * 120, eye.y + sunDir.y * 120, eye.z + sunDir.z * 120);
  sun.target.position.set(eye.x, eye.y, eye.z);
  sun.intensity = 0.22 + dLight * 1.35; ambient.intensity = 0.3 + dLight * 0.6;
  sunMesh.position.set(eye.x + sunDir.x * 220, eye.y + sunDir.y * 220, eye.z + sunDir.z * 220);
  moonMesh.position.set(eye.x + moonDir.x * 220, eye.y + moonDir.y * 220, eye.z + moonDir.z * 220);
  stars.position.set(eye.x, eye.y, eye.z); starMat.opacity = Math.max(0, 1 - dLight * 2.2);
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
}
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
requestAnimationFrame(frame);

// Test hook: ?autostart=1 starts the game immediately (headless checks)
if (location.search.includes('autostart')) setTimeout(overlays.startGame, 300);

// Debug/test hook
window.__voxel = {
  world, player, state: overlays.getState, chunkMeshes, inv, mobManager, net, scene,
  blockAction: mining.blockActionPublic, mineTime: mining.mineTime, MINE_TIME: mining.MINE_TIME,
  getMining: mining.getMining, setMouseDown: mining.setMouseDown,
  spawnPuff: drops.spawnPuff, updateParticles: drops.updateParticles,
  spawnDrop: drops.spawnDrop, updateDrops: drops.updateDrops,
  getSwing: hand.getSwing, die: overlays.die, respawn: overlays.respawn, toMainMenu: overlays.toMainMenu
};
window.addEventListener('error', (e) => { window.__lastErr = e.message + ' @' + (e.lineno || '?'); });
