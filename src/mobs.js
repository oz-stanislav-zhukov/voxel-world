// Mobs: cows (passive, day) and zombies (chase at night, burn by day).
// Pure JS, node-testable (no three.js).
import { B } from './blocks.js';
import { mobDrops } from './inventory.js';

const GRAVITY = 26;
const R = 0.3, H = 1.4;

export class Mob {
  constructor(type, x, y, z) {
    this.type = type; // 'cow' | 'zombie'
    this.pos = { x, y, z };
    this.vel = { x: 0, y: 0, z: 0 };
    this.onGround = false;
    this.hp = type === 'zombie' ? 20 : 10;
    this.dead = false;
    this.wanderT = 0;
    this.wanderDir = { x: 0, z: 0 };
    this.attackCd = 0;
    this.burnT = 0;
    this.facing = 0;
    this.hitT = 0;      // white flash after being hit
    this.deathT = 0;    // death animation timer (falls over)
    this.kb = { x: 0, z: 0 }; // knockback velocity
    this.walkT = 0;     // walk-cycle phase for leg animation
  }

  // Apply damage: returns true if the mob died.
  hit(dmg, fromX, fromZ) {
    if (this.dead) return false;
    this.hp -= dmg;
    this.hitT = 0.25;
    const dx = this.pos.x - fromX, dz = this.pos.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    this.kb.x = (dx / d) * 6;
    this.kb.z = (dz / d) * 6;
    this.vel.y = 4;
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.deathT = 0.6;
    }
    return this.dead;
  }
}

export class MobManager {
  constructor(world) {
    this.world = world;
    this.mobs = [];
  }

  // Keep a small population near the player, despawn far ones.
  update(dt, px, py, pz, isNight, onDamagePlayer) {
    const DESPAWN = 48;
    for (const m of this.mobs) {
      m.hitT = Math.max(0, m.hitT - dt);
      if (m.dead) {
        m.deathT -= dt;
        if (m.deathT <= 0) m.gone = true;
      }
    }
    this.mobs = this.mobs.filter((m) => {
      if (m.gone) return false;
      if (m.dead) return true; // still playing death animation
      const d2 = (m.pos.x - px) ** 2 + (m.pos.z - pz) ** 2;
      return d2 < DESPAWN * DESPAWN;
    });
    const counts = { cow: 0, zombie: 0 };
    for (const m of this.mobs) counts[m.type]++;
    if (isNight) {
      if (counts.zombie < 3) this.trySpawn('zombie', px, pz);
    } else {
      if (counts.cow < 3) this.trySpawn('cow', px, pz);
    }
    for (const m of this.mobs) this.step(m, dt, px, pz, isNight, onDamagePlayer);
    this.mobs = this.mobs.filter((m) => !m.dead);
  }

  trySpawn(type, px, pz) {
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 12 + Math.random() * 12;
      const x = Math.floor(px + Math.cos(a) * r);
      const z = Math.floor(pz + Math.sin(a) * r);
      const h = this.world.heightAt(x, z);
      const surface = this.world.surfaceType(x, z);
      if (type === 'cow' && surface !== B.GRASS) continue;
      if (this.world.get(x, h, z) === B.WATER) continue;
      const y = h + 1;
      if (this.world.get(x, y, z) !== B.AIR || this.world.get(x, y + 1, z) !== B.AIR) continue;
      this.mobs.push(new Mob(type, x + 0.5, y, z + 0.5));
      return true;
    }
    return false;
  }

  step(m, dt, px, pz, isNight, onDamagePlayer) {
    const w = this.world;
    if (m.dead) return; // frozen during death animation
    m.attackCd = Math.max(0, m.attackCd - dt);
    let mx = 0, mz = 0;
    const dx = px - m.pos.x, dz = pz - m.pos.z;
    const dist = Math.hypot(dx, dz);
    if (m.type === 'zombie') {
      if (isNight && dist < 20) {
        mx = (dx / (dist || 1)) * 2.4;
        mz = (dz / (dist || 1)) * 2.4;
        if (dist < 1.7 && m.attackCd === 0) {
          m.attackCd = 1;
          onDamagePlayer(4);
        }
      } else if (!isNight) {
        m.burnT += dt;
        if (m.burnT > 2) { m.dead = true; return; }
      }
    } else {
      // Cow: wander slowly
      m.wanderT -= dt;
      if (m.wanderT <= 0) {
        m.wanderT = 2 + Math.random() * 4;
        if (Math.random() < 0.7) {
          const a = Math.random() * Math.PI * 2;
          m.wanderDir = { x: Math.cos(a), z: Math.sin(a) };
        } else m.wanderDir = { x: 0, z: 0 };
      }
      mx = m.wanderDir.x * 1.1;
      mz = m.wanderDir.z * 1.1;
    }
    m.vel.x = mx + m.kb.x;
    m.vel.z = mz + m.kb.z;
    m.kb.x *= Math.exp(-4 * dt);
    m.kb.z *= Math.exp(-4 * dt);
    if (Math.abs(m.kb.x) < 0.05) m.kb.x = 0;
    if (Math.abs(m.kb.z) < 0.05) m.kb.z = 0;
    if (mx || mz || m.kb.x || m.kb.z) m.facing = Math.atan2(m.vel.x, m.vel.z);
    if (Math.abs(m.vel.x) > 0.2 || Math.abs(m.vel.z) > 0.2) m.walkT += dt * 8;
    // Hop over 1-block steps
    if (m.onGround && (mx || mz)) {
      const ax = Math.floor(m.pos.x + mx * 0.4), az = Math.floor(m.pos.z + mz * 0.4);
      if (w.solidAt(ax, Math.floor(m.pos.y), az)) m.vel.y = 8.5;
    }
    m.vel.y -= GRAVITY * dt;
    if (m.vel.y < -30) m.vel.y = -30;
    this.moveAxis(m, 'x', m.vel.x * dt);
    this.moveAxis(m, 'z', m.vel.z * dt);
    m.onGround = this.moveAxis(m, 'y', m.vel.y * dt);
  }

  // Drops for a killed mob (called once by the renderer when it despawns).
  dropsFor(type) {
    return mobDrops(type);
  }

  moveAxis(m, axis, amount) {
    if (amount === 0) return axis === 'y' ? m.onGround : false;
    m.pos[axis] += amount;
    const p = m.pos;
    const min = { x: p.x - R, y: p.y, z: p.z - R };
    const max = { x: p.x + R, y: p.y + H, z: p.z + R };
    let collided = false;
    for (let bx = Math.floor(min.x); bx <= Math.floor(max.x); bx++) {
      for (let by = Math.floor(min.y); by <= Math.floor(max.y); by++) {
        for (let bz = Math.floor(min.z); bz <= Math.floor(max.z); bz++) {
          if (!this.world.solidAt(bx, by, bz)) continue;
          collided = true;
          if (axis === 'x') { p.x = amount > 0 ? bx - R - 0.001 : bx + 1 + R + 0.001; m.vel.x = 0; }
          else if (axis === 'z') { p.z = amount > 0 ? bz - R - 0.001 : bz + 1 + R + 0.001; m.vel.z = 0; }
          else {
            if (amount > 0) p.y = by - H - 0.001;
            else { p.y = by + 1 + 0.001; m.onGround = true; }
            m.vel.y = 0;
          }
        }
      }
    }
    return axis === 'y' ? m.onGround : collided;
  }

  // Ray vs mob AABB (slab test). Returns { mob, t } or null.
  hitMob(o, d, maxDist = 3.5) {
    let best = null, bestT = maxDist;
    for (const m of this.mobs) {
      if (m.dead) continue;
      const min = { x: m.pos.x - R, y: m.pos.y, z: m.pos.z - R };
      const max = { x: m.pos.x + R, y: m.pos.y + H, z: m.pos.z + R };
      let tmin = 0, tmax = maxDist;
      let ok = true;
      for (const ax of ['x', 'y', 'z']) {
        if (Math.abs(d[ax]) < 1e-8) {
          if (o[ax] < min[ax] || o[ax] > max[ax]) { ok = false; break; }
        } else {
          let t1 = (min[ax] - o[ax]) / d[ax];
          let t2 = (max[ax] - o[ax]) / d[ax];
          if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
          tmin = Math.max(tmin, t1);
          tmax = Math.min(tmax, t2);
          if (tmin > tmax) { ok = false; break; }
        }
      }
      if (ok && tmin <= bestT) { bestT = tmin; best = m; }
    }
    return best ? { mob: best, t: bestT } : null;
  }
}
