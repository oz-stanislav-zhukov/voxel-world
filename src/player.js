// First-person controller: pointer-lock look, AABB physics, block editing.
import { B } from './blocks.js';
import { emit } from './events.js';

const GRAVITY = 26;
const JUMP = 8.6;
const WALK = 5.2;
const SPRINT = 8.2;
const EYE = 1.62;
const R = 0.32;
const H = 1.8;

export class Player {
  constructor(world) {
    this.world = world;
    this.pos = { x: 0, y: 0, z: 0 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.keys = {};
    this.waterTime = 0;
    this.hp = 20;
    this.maxHp = 20;
    this.spawn();
  }

  spawn() {
    // Find a dry spawn point near the world center (0,0).
    let best = null;
    for (let r = 0; r < 40 && !best; r++) {
      for (let a = 0; a < 12 && !best; a++) {
        const x = Math.floor(Math.cos(a / 12 * Math.PI * 2) * r);
        const z = Math.floor(Math.sin(a / 12 * Math.PI * 2) * r);
        const h = this.world.heightAt(x, z);
        if (this.world.surfaceType(x, z) === B.GRASS) best = { x, z, h };
      }
    }
    const p = best || { x: 0, z: 0, h: this.world.heightAt(0, 0) };
    this.pos.x = p.x + 0.5;
    this.pos.z = p.z + 0.5;
    this.pos.y = p.h + 1.01;
    this.vel.x = this.vel.y = this.vel.z = 0;
    this.hp = this.maxHp;
    this.dead = false;
    this.yaw = Math.PI * 0.25;
    this.pitch = -0.15;
  }

  damage(n) {
    if (this.dead) return;
    this.hp -= n;
    emit('damage', { n, hp: this.hp });
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true; // main.js shows the death screen (respawn is a choice)
      emit('death');
    }
  }

  look(dx, dy) {
    this.yaw -= dx * 0.0022;
    this.pitch -= dy * 0.0022;
    const lim = Math.PI / 2 - 0.02;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  setKey(code, down) {
    this.keys[code] = down;
  }

  // Release all held keys (used when opening menus / losing focus).
  clearKeys() {
    for (const k of Object.keys(this.keys)) this.keys[k] = false;
  }

  get forward() {
    return {
      x: -Math.sin(this.yaw),
      z: -Math.cos(this.yaw)
    };
  }

  update(dt) {
    dt = Math.min(dt, 0.05);
    const k = this.keys;
    // Swimming: head or feet in water. A short grace period after
    // surfacing so the physics does not flicker at the surface.
    const p0 = this.pos;
    const submerged =
      this.world.get(Math.floor(p0.x), Math.floor(p0.y + EYE), Math.floor(p0.z)) === B.WATER ||
      this.world.get(Math.floor(p0.x), Math.floor(p0.y + 0.3), Math.floor(p0.z)) === B.WATER;
    this.waterTime = submerged ? 0.3 : Math.max(0, this.waterTime - dt);
    const water = this.waterTime > 0;
    const sprint = k['ShiftLeft'] || k['ShiftRight'];
    const speed = water ? WALK * 0.55 : sprint ? SPRINT : WALK;
    const f = this.forward;
    const right = { x: -f.z, z: f.x };
    let mx = 0, mz = 0;
    if (k['KeyW']) { mx += f.x; mz += f.z; }
    if (k['KeyS']) { mx -= f.x; mz -= f.z; }
    if (k['KeyD']) { mx += right.x; mz += right.z; }
    if (k['KeyA']) { mx -= right.x; mz -= right.z; }
    const len = Math.hypot(mx, mz);
    if (len > 0) { mx = mx / len * speed; mz = mz / len * speed; }
    this.vel.x = mx;
    this.vel.z = mz;

    if (water) {
      // Swim: Space pushes up, water drag damps vertical motion so the
      // player glides at the surface instead of bouncing.
      if (k['Space']) this.vel.y += 22 * dt;
      else this.vel.y -= 6 * dt;
      this.vel.y *= Math.exp(-4.5 * dt);
      if (this.vel.y > 3.2) this.vel.y = 3.2;
      if (this.vel.y < -1.8) this.vel.y = -1.8;
    } else {
      if (k['Space'] && this.onGround) {
        this.vel.y = JUMP;
        this.onGround = false;
      }
      this.vel.y -= GRAVITY * dt;
      if (this.vel.y < -40) this.vel.y = -40;
    }

    this.moveAxis('x', this.vel.x * dt);
    this.moveAxis('z', this.vel.z * dt);
    this.onGround = this.moveAxis('y', this.vel.y * dt);
  }

  moveAxis(axis, amount) {
    if (amount === 0) return axis === 'y' ? this.onGround : false;
    this.pos[axis] += amount;
    const p = this.pos;
    const min = { x: p.x - R, y: p.y, z: p.z - R };
    const max = { x: p.x + R, y: p.y + H, z: p.z + R };
    let collided = false;
    for (let bx = Math.floor(min.x); bx <= Math.floor(max.x); bx++) {
      for (let by = Math.floor(min.y); by <= Math.floor(max.y); by++) {
        for (let bz = Math.floor(min.z); bz <= Math.floor(max.z); bz++) {
          if (!this.world.solidAt(bx, by, bz)) continue;
          collided = true;
          if (axis === 'x') {
            p.x = amount > 0 ? bx - R - 0.001 : bx + 1 + R + 0.001;
            this.vel.x = 0;
          } else if (axis === 'z') {
            p.z = amount > 0 ? bz - R - 0.001 : bz + 1 + R + 0.001;
            this.vel.z = 0;
          } else {
            if (amount > 0) {
              p.y = by - H - 0.001;
            } else {
              p.y = by + 1 + 0.001;
              this.onGround = true;
            }
            this.vel.y = 0;
          }
        }
      }
    }
    return axis === 'y' ? this.onGround : collided;
  }

  eye() {
    return { x: this.pos.x, y: this.pos.y + EYE, z: this.pos.z };
  }

  lookDir() {
    const cp = Math.cos(this.pitch);
    return {
      x: -Math.sin(this.yaw) * cp,
      y: Math.sin(this.pitch),
      z: -Math.cos(this.yaw) * cp
    };
  }
}
