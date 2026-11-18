// First-person hand: arm + sleeve + held item, circular swing arc (listens
// to the 'swing' event), walk bob. Wired by main.js via initHand(ctx).
import * as THREE from 'three';
import { B } from './blocks.js';
import { on } from './events.js';

let ctx = null; // { camera, scene, makeIconTexture, inv, selected }
let handGroup, handArm, handSleeve, heldItem;
let swingT = 0; // >0 while swinging
let bobT = 0;

export function getSwing() { return swingT; }

export function initHand(c) {
  ctx = c;
  handGroup = new THREE.Group();
  handArm = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.14, 0.5),
    new THREE.MeshLambertMaterial({ color: 0xd9a066 })
  );
  handArm.position.z = -0.25; // arm reaches away from the camera
  handSleeve = new THREE.Mesh(
    new THREE.BoxGeometry(0.17, 0.17, 0.22),
    new THREE.MeshLambertMaterial({ color: 0x3f6fb5 })
  );
  handSleeve.position.z = 0.05; // sleeve sits closest to the viewer
  heldItem = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.12, 0.12),
    new THREE.MeshBasicMaterial({ map: c.makeIconTexture(B.PLANKS), transparent: true })
  );
  heldItem.position.set(0.05, 0.12, -0.45); // held at the far end of the arm
  handGroup.add(handArm, handSleeve, heldItem);
  handGroup.position.set(0.42, -0.42, -0.7);
  handGroup.rotation.x = 0.25;
  c.camera.add(handGroup);
  c.scene.add(c.camera);
  on('swing', () => { swingT = 0.28; });
}

// Per-frame: circular swing arc (MC-style) + walk bob, held item follows the selected slot.
export function updateHand(dt, player) {
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
  const held = ctx.inv.slots[ctx.selected()];
  heldItem.visible = !!held; // hide the item cube when the slot is empty
  if (held) {
    const map = ctx.makeIconTexture(held.id);
    if (heldItem.material.map !== map) heldItem.material.map = map;
    heldItem.material.needsUpdate = true;
  }
}
