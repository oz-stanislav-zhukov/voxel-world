// Remote players (multiplayer): simple blocky avatars that lerp toward
// the last position received from the network.
import * as THREE from 'three';

let scene;
const remotePlayers = new Map(); // id -> { group, pos, yaw, target }

export function initRemote(s) { scene = s; }

export function upsertRemote(p) {
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

export function removeRemote(id) {
  const r = remotePlayers.get(id);
  if (r) {
    scene.remove(r.group);
    remotePlayers.delete(id);
  }
}

export function updateRemote(dt) {
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
