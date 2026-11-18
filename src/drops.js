// Ground drops (items fall to the world, walk over to pick up) +
// particle puffs (mob/block death). Wired by main.js via initDrops(ctx).
import * as THREE from 'three';
import { itemInfo } from './inventory.js';
import { emit } from './events.js';

let ctx = null; // { scene, world, player, inv, makeIconTexture, sfx, renderHotbar }
const drops = []; // { mesh, id, n, vel, t }

export function initDrops(c) { ctx = c; }

export function spawnDrop(id, n, x, y, z) {
  const tex = ctx.makeIconTexture(id);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.24), mat);
  mesh.position.set(x, y, z);
  mesh.userData.baseY = y;
  ctx.scene.add(mesh);
  drops.push({ mesh, id, n, vel: { x: (Math.random() - 0.5) * 1.2, y: 2.2, z: (Math.random() - 0.5) * 1.2 }, t: 0 });
  emit('dropItem');
}

export function updateDrops(dt) {
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    d.t += dt;
    d.vel.y -= 22 * dt;
    d.mesh.position.x += d.vel.x * dt;
    d.mesh.position.y += d.vel.y * dt;
    d.mesh.position.z += d.vel.z * dt;
    // Land on the first solid block below (works in caves, not just the surface)
    if (d.vel.y <= 0) {
      const bx = Math.floor(d.mesh.position.x), bz = Math.floor(d.mesh.position.z);
      const by = Math.floor(d.mesh.position.y - 0.15);
      if (ctx.world.solidAt(bx, by, bz)) {
        d.mesh.position.y = by + 1.15;
        d.vel.y = 0;
        d.vel.x *= 0.7;
        d.vel.z *= 0.7;
        d.restY = by + 1.15;
      }
    }
    d.mesh.rotation.y += dt * 2.2;
    if (d.restY) d.mesh.position.y = d.restY + Math.sin(d.t * 3) * 0.03;
    const dx = d.mesh.position.x - ctx.player.pos.x;
    const dy = d.mesh.position.y - (ctx.player.pos.y + 0.6);
    const dz = d.mesh.position.z - ctx.player.pos.z;
    if (dx * dx + dy * dy + dz * dz < 1.7 * 1.7) {
      const left = ctx.inv.add(d.id, d.n);
      if (left > 0) continue; // full: leave it on the ground
      ctx.scene.remove(d.mesh);
      d.mesh.geometry.dispose();
      d.mesh.material.map.dispose();
      d.mesh.material.dispose();
      drops.splice(i, 1);
      ctx.renderHotbar();
      emit('pickup', { id: d.id, n: d.n });
    }
  }
}

// ---------- Particles (death puffs, block debris) ----------
const particles = []; // { mesh, vel, life, maxLife }
const puffGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
const puffMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });

export function spawnPuff(x, y, z, n = 12, color = 0xffffff) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(puffGeo, puffMat.clone());
    m.position.set(x, y, z);
    m.material.color.setHex(color);
    const a = Math.random() * Math.PI * 2;
    const up = 0.5 + Math.random() * 1.5;
    m.userData.vel = { x: Math.cos(a) * (0.5 + Math.random()), y: up, z: Math.sin(a) * (0.5 + Math.random()) };
    m.userData.life = 0.6 + Math.random() * 0.4;
    ctx.scene.add(m);
    particles.push(m);
  }
}

export function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const m = particles[i];
    m.userData.life -= dt;
    if (m.userData.life <= 0) {
      ctx.scene.remove(m);
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
