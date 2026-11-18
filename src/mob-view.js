// Mob meshes: build a THREE.Group per mob type, sync transforms/animation
// to the MobManager state, spawn death puffs + drops when a mob is removed.
import * as THREE from 'three';
import { mobDrops } from './inventory.js';
import * as drops from './drops.js';
import { emit } from './events.js';

let scene, mobManager;
const mobGroups = new Map(); // mob -> THREE.Group

export function initMobView(s, mm) { scene = s; mobManager = mm; }

export function mobMesh(m) {
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
      leg.geometry.translate(0, -0.25, 0);
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
      arm.rotation.x = -Math.PI / 2;
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

export function syncMobs() {
  for (const [m, g] of [...mobGroups]) {
    if (!mobManager.mobs.includes(m)) {
      scene.remove(g);
      mobGroups.delete(m);
      if (m.dead && !m.dropped) {
        m.dropped = true;
        drops.spawnPuff(m.pos.x, m.pos.y + 0.7, m.pos.z, 14, 0xf5f5f5);
        emit('mobDeath');
        for (const d of mobDrops(m.type)) {
          drops.spawnDrop(d.id, d.n, m.pos.x + (Math.random() - 0.5) * 0.5, m.pos.y + 0.6, m.pos.z + (Math.random() - 0.5) * 0.5);
        }
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
    const f = m.hitT > 0 ? (m.hitT / 0.25) * 0.9 : 0;
    for (const mm of u.mats) mm.emissive.setRGB(f, f, f);
  }
}
