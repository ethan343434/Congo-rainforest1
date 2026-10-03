// =============================================================================
// animals.js — Congo wildlife: models + behaviour.
//
// Hostile animals run a small state machine:
//   idle -> patrol -> (detect player) -> chase -> attack (on cooldown) -> return
// Maze animals path-find through the corridors (so a leopard follows you
// around corners). River animals (crocodiles, hippo) stay in and near the water.
// Passive animals wander, and flee — or warn, then retreat — when approached.
// =============================================================================
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { findPath } from './maze.js';
import { angleDiff } from './utils.js';
import {
  makeSnake, makeLeopard, makeCrocodile, makeHippo, makeGorilla, makeElephant, makeOkapi, makeDuiker,
} from './models.js';

const SPECIES = {
  viper: {
    name: 'a Gaboon viper', build: () => makeSnake('viper'), hostile: true, radius: 0.3,
    patrolSpeed: 0.45, chaseSpeed: 2.6, detect: 5.5, hearing: 2.5, attackRange: 1.7, damage: 22, cooldown: 1.7,
    windup: 0.45, leash: 8, wander: 1, sound: 'hiss', ambush: true,
  },
  mamba: {
    name: 'a green mamba', build: () => makeSnake('mamba'), hostile: true, radius: 0.25,
    patrolSpeed: 1.1, chaseSpeed: 4.6, detect: 7, hearing: 3, attackRange: 1.6, damage: 16, cooldown: 1.2,
    windup: 0.3, leash: 13, wander: 2, sound: 'hiss',
  },
  leopard: {
    name: 'a leopard', build: (rng) => makeLeopard(rng), hostile: true, radius: 0.5,
    patrolSpeed: 1.6, chaseSpeed: 6.2, detect: 14, hearing: 5, attackRange: 1.9, damage: 24, cooldown: 1.1,
    windup: 0.3, leash: 42, wander: 5, sound: 'growl',
  },
  croc: {
    name: 'a Nile crocodile', build: () => makeCrocodile(), hostile: true, radius: 0.8, river: true,
    patrolSpeed: 0.6, chaseSpeed: 7.2, detect: 9, hearing: 9, attackRange: 2.5, damage: 34, cooldown: 2.2,
    windup: 0.35, sound: 'croc', minV: 8, maxV: 22, chaseMinV: 2.5,
  },
  hippo: {
    name: 'a hippopotamus', build: () => makeHippo(), hostile: true, radius: 1.3, river: true,
    patrolSpeed: 0.7, chaseSpeed: 5.8, detect: 10, hearing: 10, attackRange: 2.8, damage: 42, cooldown: 2.6,
    windup: 0.5, sound: 'hippo', minV: 10, maxV: 22, chaseMinV: 0.5, pushes: true,
  },
  gorilla: {
    name: 'a silverback gorilla', build: () => makeGorilla(), hostile: false, radius: 0.75,
    patrolSpeed: 0.8, fleeSpeed: 3.2, warnRadius: 7, provokeRadius: 2.4, damage: 14, wander: 2, sound: 'chestbeat', pushes: true,
  },
  elephant: {
    name: 'a forest elephant', build: () => makeElephant(), hostile: false, radius: 1.3,
    patrolSpeed: 0.7, fleeSpeed: 2.6, warnRadius: 9, wander: 2, sound: 'trumpet', pushes: true,
  },
  okapi: {
    name: 'an okapi', build: () => makeOkapi(), hostile: false, radius: 0.5,
    patrolSpeed: 0.9, fleeSpeed: 6, fearRadius: 9, wander: 3,
  },
  duiker: {
    name: 'a duiker', build: () => makeDuiker(), hostile: false, radius: 0.3,
    patrolSpeed: 1.0, fleeSpeed: 7, fearRadius: 8, wander: 3,
  },
};

const tmp = new THREE.Vector3();

class Animal {
  constructor(type, spec, home, rng, opts = {}) {
    this.type = type;
    this.spec = spec;
    this.rng = rng;
    this.model = spec.build(rng);
    this.home = home.clone();
    this.pos = home.clone();
    this.yaw = rng() * Math.PI * 2;
    this.roams = !!opts.roams;
    this.state = 'idle';
    this.timer = rng() * 3;
    this.cooldown = 0;
    this.target = null;
    this.repath = 0;
    this.waypoint = null;
    this.lostSight = 0;
    this.speed = 0;
    this.animTime = rng() * 10;
    this.warned = false;
  }

  reset() {
    this.pos.copy(this.home);
    this.state = 'idle';
    this.timer = 2 + this.rng() * 3;
    this.target = null;
    this.waypoint = null;
    this.cooldown = 0;
    this.warned = false;
  }
}

export class Animals {
  constructor(world, scene, rng, audio) {
    this.world = world;
    this.maze = world.maze;
    this.audio = audio;
    this.rng = rng;
    this.list = [];
    this.group = new THREE.Group();
    scene.add(this.group);

    const jitter = (c, r) => new THREE.Vector3(c.x + (rng() - 0.5) * r, 0, c.z + (rng() - 0.5) * r);
    for (const spot of this.maze.spots) {
      const c = world.cellCenter(spot.cell);
      this.add(spot.type, jitter(c, spot.nest ? 4.5 : 3), { roams: spot.roams, nest: spot.nest });
    }
    // River residents: three crocodiles and a hippo.
    const { bank } = world.river;
    const mid = (bank.u0 + bank.u1) / 2;
    for (let k = 0; k < 3; k++) this.add('croc', world.river.toWorld(mid - 10 + k * 10 + (rng() - 0.5) * 4, 12 + rng() * 6));
    this.add('hippo', world.river.toWorld(mid + (rng() < 0.5 ? -6 : 6), 15));
  }

  add(type, home, opts = {}) {
    const spec = SPECIES[type];
    const a = new Animal(type, spec, home, this.rng, opts);
    if (opts.nest) a.spec = { ...spec, leash: 12, detect: spec.detect * 0.9 };
    this.group.add(a.model.root);
    this.list.push(a);
    this.place(a);
    return a;
  }

  resetAll() {
    for (const a of this.list) {
      a.reset();
      this.place(a);
    }
  }

  // ---- Helpers --------------------------------------------------------------------
  /** Pick somewhere to wander to. */
  wanderTarget(a) {
    if (a.spec.river) {
      const { u, v } = this.world.river.toLocal(a.home.x, a.home.z);
      return this.world.river.toWorld(u + (this.rng() - 0.5) * 14, Math.min(a.spec.maxV, Math.max(a.spec.minV, v + (this.rng() - 0.5) * 8)));
    }
    let cell = this.world.cellAt(a.pos.x, a.pos.z);
    if (cell < 0) return a.home.clone();
    const steps = 1 + Math.floor(this.rng() * (a.spec.wander ?? 2));
    for (let s = 0; s < steps; s++) {
      const options = this.maze.openNeighbours(cell).filter((n) => {
        if (this.maze.isHub(n) && a.spec.hostile) return false; // predators don't camp the crash site
        const c = this.world.cellCenter(n);
        const limit = a.roams ? 38 : (a.spec.leash ?? 14) * 0.7;
        return c.distanceTo(a.home) < limit;
      });
      if (!options.length) break;
      cell = options[Math.floor(this.rng() * options.length)];
    }
    const c = this.world.cellCenter(cell);
    return c.add(new THREE.Vector3((this.rng() - 0.5) * 3, 0, (this.rng() - 0.5) * 3));
  }

  /** The next point to walk towards on the way to `target` (handles corners). */
  steer(a, target, dt) {
    if (a.spec.river) return target;
    a.repath -= dt;
    if (a.repath > 0 && a.waypoint) return a.waypoint;
    a.repath = 0.35;
    const from = this.world.cellAt(a.pos.x, a.pos.z);
    const to = this.world.cellAt(target.x, target.z);
    if (from < 0 || to < 0 || from === to || this.world.colliders.lineOfSight(a.pos.x, a.pos.z, target.x, target.z, 1.0)) {
      a.waypoint = target;
      return target;
    }
    const path = findPath(this.maze, from, to);
    if (!path || path.length < 2) {
      a.waypoint = target;
      return target;
    }
    // Aim through the opening between this cell and the next, a little past it.
    const c0 = this.world.cellCenter(path[0]);
    const c1 = this.world.cellCenter(path[1]);
    a.waypoint = c0.lerp(c1, 0.62);
    return a.waypoint;
  }

  moveToward(a, point, speed, dt) {
    tmp.set(point.x - a.pos.x, 0, point.z - a.pos.z);
    const d = tmp.length();
    if (d < 0.05) {
      a.speed = 0;
      return d;
    }
    const desiredYaw = Math.atan2(tmp.x, tmp.z);
    a.yaw += angleDiff(a.yaw, desiredYaw) * Math.min(1, dt * 6);
    const facing = Math.cos(angleDiff(a.yaw, desiredYaw));
    const step = Math.min(d, speed * dt * Math.max(0.2, facing));
    a.pos.x += Math.sin(a.yaw) * step;
    a.pos.z += Math.cos(a.yaw) * step;
    a.speed = step / Math.max(dt, 1e-4);
    if (!a.spec.river) this.world.colliders.resolve(a.pos, a.spec.radius, 0, 1.5, true);
    else this.clampRiver(a);
    return d;
  }

  clampRiver(a) {
    const r = this.world.river;
    const { u, v } = r.toLocal(a.pos.x, a.pos.z);
    const minV = a.state === 'chase' || a.state === 'attack' ? a.spec.chaseMinV : a.spec.minV;
    const cu = Math.min(r.bank.u1 + 15, Math.max(r.bank.u0 - 15, u));
    const cv = Math.min(a.spec.maxV, Math.max(minV, v));
    if (cu !== u || cv !== v) a.pos.copy(r.toWorld(cu, cv));
  }

  canSee(a, player) {
    return this.world.colliders.lineOfSight(a.pos.x, a.pos.z, player.position.x, player.position.z, 1.0);
  }

  place(a) {
    const root = a.model.root;
    root.position.copy(a.pos);
    if (a.spec.river) {
      const inWater = this.world.river.isWater(a.pos.x, a.pos.z);
      const sink = a.type === 'hippo' ? 0.75 : 0.18;
      root.position.y = inWater ? this.world.river.waterLevel - sink : 0;
    }
    root.rotation.y = a.yaw;
  }

  // ---- Main update ---------------------------------------------------------------
  update(dt, now, player, dayNight) {
    const night = dayNight.isNight;
    const nightMul = night ? CONFIG.hazards.nightAggression : 1;
    for (const a of this.list) {
      a.animTime += dt;
      a.cooldown = Math.max(0, a.cooldown - dt);
      const dist = Math.hypot(player.position.x - a.pos.x, player.position.z - a.pos.z);
      // Far-away animals idle cheaply.
      if (dist > 70 && a.state !== 'return') {
        a.model.root.visible = false;
        continue;
      }
      a.model.root.visible = true;
      if (a.spec.hostile) this.updateHostile(a, dt, now, player, dist, nightMul);
      else this.updatePassive(a, dt, now, player, dist);
      this.place(a);
      a.model.anim(a.animTime, a.speed, a.state);

      // Big animals physically block the player.
      if (a.spec.pushes && player.alive) {
        const min = a.spec.radius + CONFIG.player.radius;
        if (dist < min && dist > 0.001) {
          player.position.x = a.pos.x + ((player.position.x - a.pos.x) / dist) * min;
          player.position.z = a.pos.z + ((player.position.z - a.pos.z) / dist) * min;
        }
      }
    }
  }

  updateHostile(a, dt, now, player, dist, nightMul) {
    const s = a.spec;
    const homeDist = Math.hypot(player.position.x - a.home.x, player.position.z - a.home.z);
    const playerReachable = s.river
      ? this.world.river.inZone(player.position.x, player.position.z) && this.world.river.toLocal(player.position.x, player.position.z).v > 1
      : homeDist < (a.roams ? 60 : s.leash + s.detect);

    const sees = () => this.canSee(a, player);
    const detects = () => player.alive && playerReachable && dist < s.detect * nightMul && (dist < s.hearing * nightMul || sees());

    switch (a.state) {
      case 'idle':
        a.speed = 0;
        a.timer -= dt;
        if (detects()) this.startChase(a, now);
        else if (a.timer <= 0 && !s.ambush) {
          a.target = this.wanderTarget(a);
          a.state = 'patrol';
        } else if (a.timer <= 0) a.timer = 4;
        break;
      case 'patrol': {
        if (detects()) { this.startChase(a, now); break; }
        const d = this.moveToward(a, this.steer(a, a.target, dt), s.patrolSpeed, dt);
        if (d < 0.6 && this.world.cellAt(a.pos.x, a.pos.z) === this.world.cellAt(a.target.x, a.target.z)) {
          a.state = 'idle';
          a.timer = 2 + this.rng() * 5;
        }
        break;
      }
      case 'warn': // snakes rear up before striking
        a.speed = 0;
        a.timer -= dt;
        this.face(a, player.position, dt);
        if (a.timer <= 0) a.state = 'chase';
        break;
      case 'chase': {
        if (!player.alive) { a.state = 'return'; break; }
        const seeing = sees();
        a.lostSight = seeing ? 0 : a.lostSight + dt;
        const leashBroken = s.river ? !playerReachable : homeDist > (a.roams ? 60 : s.leash) && !(a.roams && dist < 10);
        if (leashBroken || a.lostSight > 5) { a.state = 'return'; break; }
        if (dist < s.attackRange && a.cooldown <= 0 && seeing) {
          a.state = 'attack';
          a.timer = s.windup;
          break;
        }
        const nightBoost = nightMul > 1 ? 1.08 : 1;
        if (dist > s.attackRange * 0.7) this.moveToward(a, this.steer(a, player.position, dt), s.chaseSpeed * nightBoost, dt);
        else { a.speed = 0; this.face(a, player.position, dt); }
        break;
      }
      case 'attack':
        a.timer -= dt;
        this.face(a, player.position, dt);
        if (a.timer > 0) {
          this.moveToward(a, player.position, s.chaseSpeed * 0.5, dt); // the lunge
        } else {
          if (dist < s.attackRange + 0.7 && player.alive) {
            player.damage(s.damage, s.name, now);
            this.audio?.play('bite', a.pos);
          }
          a.cooldown = s.cooldown;
          a.state = 'chase';
        }
        break;
      case 'return': {
        if (detects() && a.cooldown <= 0 && (s.river || homeDist < s.leash)) { this.startChase(a, now); break; }
        const d = this.moveToward(a, this.steer(a, a.home, dt), s.patrolSpeed * 1.6, dt);
        if (d < 1) {
          a.state = 'idle';
          a.timer = 2 + this.rng() * 3;
        }
        break;
      }
      default:
        a.state = 'idle';
    }
  }

  startChase(a, now) {
    a.lostSight = 0;
    if (a.type === 'viper' || a.type === 'mamba') {
      a.state = 'warn';
      a.timer = a.spec.ambush ? 0.55 : 0.3;
    } else a.state = 'chase';
    if (a.spec.sound && now - (a.lastSound ?? -99) > 4) {
      a.lastSound = now;
      this.audio?.play(a.spec.sound, a.pos);
    }
  }

  updatePassive(a, dt, now, player, dist) {
    const s = a.spec;
    switch (a.state) {
      case 'idle':
      case 'patrol': {
        if (player.alive && s.fearRadius && dist < s.fearRadius) {
          a.state = 'flee';
          a.timer = 4;
          break;
        }
        if (player.alive && s.warnRadius && dist < s.warnRadius && !a.warned) {
          a.state = 'warn';
          a.timer = 2.6;
          a.warned = true;
          if (now - (a.lastSound ?? -99) > 3) {
            a.lastSound = now;
            this.audio?.play(s.sound, a.pos);
          }
          break;
        }
        if (a.warned && dist > s.warnRadius + 6) a.warned = false;
        if (a.state === 'idle') {
          a.speed = 0;
          a.timer -= dt;
          if (a.timer <= 0) {
            a.target = this.wanderTarget(a);
            a.state = 'patrol';
          }
        } else {
          const d = this.moveToward(a, this.steer(a, a.target, dt), s.patrolSpeed, dt);
          if (d < 0.6) {
            a.state = 'idle';
            a.timer = 3 + this.rng() * 6;
          }
        }
        break;
      }
      case 'warn':
        // Gorilla beats its chest / elephant trumpets: a clear "back off".
        a.speed = 0;
        a.timer -= dt;
        this.face(a, player.position, dt);
        if (s.provokeRadius && dist < s.provokeRadius && a.cooldown <= 0 && player.alive) {
          player.damage(s.damage, s.name, now); // provoked: a hard shove
          a.cooldown = 3;
          this.audio?.play('bite', a.pos);
        }
        if (a.timer <= 0) {
          a.state = 'flee';
          a.timer = 5;
        }
        break;
      case 'flee': {
        a.timer -= dt;
        // Head for the neighbouring cell that is farthest from the player.
        if (!a.target || a.repath <= 0) {
          a.repath = 0.8;
          const cell = this.world.cellAt(a.pos.x, a.pos.z);
          const pc = this.world.cellAt(player.position.x, player.position.z);
          if (cell >= 0) {
            const options = this.maze.openNeighbours(cell).filter((n) => !this.maze.isHub(n));
            let best = null, bestScore = -Infinity;
            for (const n of options) {
              const p = pc >= 0 ? findPath(this.maze, n, pc) : null;
              const score = (p ? p.length : 0) + this.rng() * 0.5;
              if (score > bestScore) { bestScore = score; best = n; }
            }
            if (best !== null) a.target = this.world.cellCenter(best);
          }
        }
        a.repath -= dt;
        if (a.target) this.moveToward(a, a.target, s.fleeSpeed, dt);
        if (a.timer <= 0 && dist > (s.fearRadius ?? s.warnRadius) + 3) {
          a.state = 'idle';
          a.timer = 3;
          a.target = null;
        } else if (a.timer <= 0) a.timer = 2;
        break;
      }
      default:
        a.state = 'idle';
    }
  }

  face(a, p, dt) {
    const desired = Math.atan2(p.x - a.pos.x, p.z - a.pos.z);
    a.yaw += angleDiff(a.yaw, desired) * Math.min(1, dt * 8);
  }

  /** Closest hostile animal that is currently hunting the player (for music/UI). */
  threatLevel(player) {
    let best = 0;
    for (const a of this.list) {
      if (!a.spec.hostile || (a.state !== 'chase' && a.state !== 'attack' && a.state !== 'warn')) continue;
      const d = a.pos.distanceTo(player.position);
      best = Math.max(best, 1 - Math.min(1, d / 20));
    }
    return best;
  }
}
