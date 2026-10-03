// =============================================================================
// walker.js — the astronaut on foot.
//
// Real surface gravity, and grip that comes from it: friction can only push
// you as hard as your weight presses you into the ground, so on the Moon you
// speed up, stop and turn slowly and every jump floats (3 m high, 4 s of
// hang time). On Phobos a jump can take minutes to come down, so the
// jetpack can also push you down and forward.
//
// Positions are in the body's rotating frame, so the ground doesn't slide
// away under you as the world turns.
// =============================================================================
import * as THREE from 'three';

export const WALK = {
  walk: 1.9,          // m/s
  run: 4.3,
  jump: 2.7,          // m/s take-off speed (≈0.37 m jump on Earth)
  gripMu: 1.1,        // traction ≈ μ·g
  minGrip: 0.35,      // m/s² (boot cleats in regolith)
  maxGrip: 9,
  jetUp: 6.5,         // m/s² of jetpack thrust (on top of fighting gravity)
  jetSide: 3.2,
  jetDrain: 24,       // % per second
  jetRecharge: 30,
  safeFall: 6.5,      // m/s landing speed before it hurts
  shipRadius: 6.2,    // keep-out radius around the landed ship
};

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _up = new THREE.Vector3();

export class Walker {
  constructor() {
    this.body = null;
    this.terrain = null;
    this.pos = new THREE.Vector3();   // local frame (m)
    this.vel = new THREE.Vector3();   // local frame, relative to the ground
    this.onGround = false;
    this.facing = new THREE.Vector3(1, 0, 0);
    this.input = { forward: 0, right: 0, run: false, jump: false, jet: false, down: false };
    this.cameraForward = new THREE.Vector3(0, 0, -1); // world (set by the camera rig)
    this.cameraRight = new THREE.Vector3(1, 0, 0);
    this.events = [];
    this.stepPhase = 0;
    this.airTime = 0;
    this.jetting = false;
    this.speed = 0;
    this.shipLocal = null;            // landed ship position (local frame)
    this.groundR = 0;
  }

  /** Put the astronaut on the ground at a local direction. */
  spawn(body, terrain, localPos, shipLocal) {
    this.body = body;
    this.terrain = terrain;
    this.pos.copy(localPos);
    this.vel.set(0, 0, 0);
    this.shipLocal = shipLocal ? shipLocal.clone() : null;
    this.snapToGround(true);
    const up = _up.copy(this.pos).normalize();
    this.facing.copy(this.north(up, _v));
  }

  surfaceR(dir) {
    return this.terrain ? this.terrain.surfaceRadius(dir) : this.body.surfaceRadiusLocal(dir);
  }

  snapToGround(force) {
    const up = _up.copy(this.pos).normalize();
    const r = this.surfaceR(up);
    this.groundR = r;
    if (force || this.pos.length() < r) {
      this.pos.copy(up).multiplyScalar(r);
      this.onGround = true;
    }
  }

  north(up, out) {
    out.set(0, 1, 0).addScaledVector(up, -up.y);
    if (out.lengthSq() < 1e-8) out.set(1, 0, 0).addScaledVector(up, -up.x);
    return out.normalize();
  }

  /** World-space frame for the camera rig: { pos, up, north, east }. */
  frameWorld() {
    const b = this.body;
    const up = this.pos.clone().normalize();
    const north = this.north(up, new THREE.Vector3());
    const east = new THREE.Vector3().crossVectors(north, up).normalize();
    return {
      pos: this.pos.clone().applyQuaternion(b.quat).add(b.pos),
      up: up.applyQuaternion(b.quat),
      north: north.applyQuaternion(b.quat),
      east: east.applyQuaternion(b.quat),
    };
  }

  worldPos(out = new THREE.Vector3()) {
    return out.copy(this.pos).applyQuaternion(this.body.quat).add(this.body.pos);
  }

  /** Ground-relative velocity in world axes (for the HUD). */
  worldVel(out = new THREE.Vector3()) {
    return out.copy(this.vel).applyQuaternion(this.body.quat);
  }

  /** Fuel is a percentage held by the suit; returns new fuel. */
  update(dt, suit) {
    const b = this.body;
    const inp = this.input;
    const up = _up.copy(this.pos).normalize();
    const r = this.pos.length();
    const g = b.GM / (r * r);
    // Camera-relative move direction in the tangent plane (local frame).
    const fwd = _v.copy(this.cameraForward).applyQuaternion(b.quatInv);
    fwd.addScaledVector(up, -fwd.dot(up));
    if (fwd.lengthSq() < 1e-8) fwd.copy(this.facing);
    fwd.normalize();
    const right = _w.crossVectors(fwd, up).normalize();
    const move = new THREE.Vector3().addScaledVector(fwd, inp.forward).addScaledVector(right, inp.right);
    if (move.lengthSq() > 1) move.normalize();
    const target = (inp.run ? WALK.run : WALK.walk);
    const vN = this.vel.dot(up);
    const vH = this.vel.clone().addScaledVector(up, -vN);

    // Jetpack.
    this.jetting = false;
    if ((inp.jet || inp.down) && suit.jetpack > 0 && (!this.onGround || inp.down || this.airTime > 0)) {
      this.jetting = true;
      const thrust = new THREE.Vector3();
      if (inp.jet) thrust.addScaledVector(up, WALK.jetUp + Math.min(g, 12));
      if (inp.down) thrust.addScaledVector(up, -WALK.jetUp);
      thrust.addScaledVector(move, WALK.jetSide);
      this.vel.addScaledVector(thrust, dt);
      suit.jetpack = Math.max(0, suit.jetpack - WALK.jetDrain * dt);
    }

    if (this.onGround) {
      this.airTime = 0;
      // Traction comes from weight.
      const grip = Math.min(WALK.maxGrip, Math.max(WALK.minGrip, WALK.gripMu * g));
      const want = move.multiplyScalar(target);
      const diff = want.sub(vH);
      const dv = diff.length();
      const maxDv = grip * dt;
      if (dv > maxDv) diff.multiplyScalar(maxDv / dv);
      this.vel.copy(vH).add(diff);
      if (inp.jump) {
        this.vel.addScaledVector(up, WALK.jump);
        this.onGround = false;
        this.airTime = 0.0001;
        this.events.push({ type: 'jump' });
      }
      if (!this.jetting) suit.jetpack = Math.min(100, suit.jetpack + WALK.jetRecharge * dt);
    } else {
      this.airTime += dt;
      this.vel.addScaledVector(up, -g * dt);
    }

    // Move.
    this.pos.addScaledVector(this.vel, dt);

    // Keep out of the landed ship.
    if (this.shipLocal) {
      const d = this.pos.clone().sub(this.shipLocal);
      const dUp = d.dot(up);
      d.addScaledVector(up, -dUp);
      const l = d.length();
      if (l < WALK.shipRadius && dUp < 4.5) {
        const push = l > 1e-3 ? d.divideScalar(l) : this.facing.clone();
        this.pos.addScaledVector(push, WALK.shipRadius - l);
        const into = this.vel.dot(push);
        if (into < 0) this.vel.addScaledVector(push, -into);
      }
    }

    // Ground contact.
    const up2 = _up.copy(this.pos).normalize();
    const groundR = this.surfaceR(up2);
    this.groundR = groundR;
    const h = this.pos.length() - groundR;
    if (h <= 0) {
      const vIn = -this.vel.dot(up2);
      this.pos.copy(up2).multiplyScalar(groundR);
      if (vIn > 0) this.vel.addScaledVector(up2, vIn);
      if (!this.onGround) {
        this.events.push({ type: 'land', speed: vIn });
        if (vIn > WALK.safeFall) this.events.push({ type: 'fall', damage: (vIn - WALK.safeFall) * 9 });
      }
      this.onGround = true;
    } else if (this.onGround) {
      // Follow the ground down gentle slopes; leave it if running off an edge.
      const vDown = -this.vel.dot(up2);
      if (h < 0.25 + Math.max(0, vDown) * dt * 2) {
        this.pos.copy(up2).multiplyScalar(groundR);
      } else {
        this.onGround = false;
      }
    }

    // Facing and footsteps.
    const vH2 = this.vel.clone().addScaledVector(up2, -this.vel.dot(up2));
    this.speed = vH2.length();
    if (this.speed > 0.25) this.facing.copy(vH2).normalize();
    else this.facing.addScaledVector(up2, -this.facing.dot(up2)).normalize();
    if (this.onGround && this.speed > 0.3) {
      this.stepPhase += (this.speed * dt) / (inp.run ? 1.5 : 0.85);
      if (this.stepPhase >= 1) { this.stepPhase -= 1; this.events.push({ type: 'step', run: inp.run }); }
    }
  }

  /** Distance to the ship (m), or Infinity. */
  distanceToShip() {
    return this.shipLocal ? this.pos.distanceTo(this.shipLocal) : Infinity;
  }
}
