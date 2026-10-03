// =============================================================================
// ship.js — the flight model. Pure simulation (no rendering) so it can be
// tested headless.
//
// * Gravity: Newtonian, from the body whose sphere of influence you're in
//   (patched conics, like Kerbal Space Program), with real GM values.
// * Thrusters: main engine, vertical/lateral thrusters and boost. Flight
//   assist nulls drift and holds you in place against gravity — but only as
//   hard as the engines can push, so on Jupiter (2.5 g) you will still sink.
// * Air: drag and convective heating relative to the planet's rotating
//   atmosphere; dynamic pressure shakes and can break the ship.
// * Pulse drive: faster than light, its speed proportional to your distance
//   from the nearest surface, so you can cross the system in under a minute
//   and still never ram a planet. It cuts out inside gravity wells/atmospheres.
// * Autopilot: aligns, pulses, routes around the Sun, and drops you out on the
//   sunlit side of the target.
// * Landing: gentle touchdowns on solid ground; hard ones damage or destroy.
// =============================================================================
import * as THREE from 'three';
import { C_LIGHT, AU, G0 } from '../constants.js';
import { atmosphereAt, entryHeating, dynamicPressure } from './environment.js';

export const SHIP = {
  mainAccel: 32,        // m/s², forward
  reverseAccel: 18,
  liftAccel: 22,        // up/down thrusters
  boost: 2.4,           // multiplier with Shift
  faGain: 1.6,          // flight-assist velocity correction (1/s)
  pitchRate: 1.15,      // rad/s
  yawRate: 0.9,
  rollRate: 2.2,
  angAccel: 5.0,        // rad/s²
  ballistic: 0.0024,    // Cd·A / m  (m²/kg)
  gearHeight: 2.1,      // m from ship origin to ground when landed
  safeTouchdown: 4.5,   // m/s vertical
  safeSlide: 4.0,       // m/s horizontal
  crashSpeed: 28,       // m/s: above this, the ship is destroyed
  pulseK: 0.75,         // pulse speed per metre of clearance (1/s)
  pulseMax: 2400 * C_LIGHT,
  pulseSpool: 1.2,      // s
};

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _m = new THREE.Matrix4();

export function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export class ShipSim {
  constructor(eph) {
    this.eph = eph;
    this.parent = eph.byId.earth;
    this.rel = new THREE.Vector3(); // position relative to parent centre (world axes)
    this.vel = new THREE.Vector3(); // velocity relative to parent (inertial)
    this.quat = new THREE.Quaternion();
    this.angVel = new THREE.Vector3(); // body frame: x pitch, y yaw, z roll
    this.mode = 'flight';           // flight | pulse | landed | destroyed
    this.flightAssist = true;
    this.landed = null;             // { body, local: Vector3, localQuat: Quaternion }
    this.autopilot = null;
    this.pulseSpeed = 0;
    this.spool = 0;                 // pulse spool-up progress (s)
    this.input = { thrust: 0, lift: 0, strafe: 0, pitch: 0, yaw: 0, roll: 0, boost: false, brake: false };
    this.telemetry = {
      altitude: Infinity, ground: Infinity, vSpeed: 0, speed: 0, density: 0, pressure: 0, temperature: null,
      heatFlux: 0, dynPressure: 0, gLoad: 0, gravity: 0, nearest: null, nearestDist: Infinity, inAtmosphere: false,
    };
    this.groundHeight = () => 0;   // terrain hook: (body, dirLocal) → metres above the reference ellipsoid
    this.groundNormal = null;      // optional hook: (body, dirLocal) → local normal
    this.events = [];              // queued events for the game layer
    this.gearDown = false;
  }

  // ---- Frames -----------------------------------------------------------------------
  worldPos(out = new THREE.Vector3()) {
    return out.copy(this.parent.pos).add(this.rel);
  }

  /** Move into another body's frame, keeping world position and world velocity. */
  setParent(body) {
    if (body === this.parent) return;
    const worldP = this.worldPos(_v);
    const worldV = _w.copy(this.vel).add(this.parent.vel);
    this.parent = body;
    this.rel.copy(worldP).sub(body.pos);
    this.vel.copy(worldV).sub(body.vel);
  }

  /** Place the ship at rest relative to a body, at a world position. */
  placeNear(body, worldPos, lookAt) {
    this.parent = body;
    this.rel.copy(worldPos).sub(body.pos);
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.mode = 'flight';
    this.landed = null;
    this.autopilot = null;
    this.pulseSpeed = 0;
    if (lookAt) this.lookAt(lookAt);
  }

  lookAt(worldTarget, upHint) {
    const p = this.worldPos(_v);
    _up.copy(upHint || this.parent.pole);
    _m.lookAt(p, worldTarget, _up);
    this.quat.setFromRotationMatrix(_m);
  }

  forward(out = new THREE.Vector3()) { return out.set(0, 0, -1).applyQuaternion(this.quat); }
  up(out = new THREE.Vector3()) { return out.set(0, 1, 0).applyQuaternion(this.quat); }

  // ---- Queries ------------------------------------------------------------------------
  /** Distance from the ship to a body's surface (reference ellipsoid). */
  clearance(body, worldPos) {
    const d = body.pos.distanceTo(worldPos);
    return d - body.maxRadius;
  }

  /** Nearest surface over all bodies (for the pulse-drive speed limiter). */
  nearestSurface(worldPos) {
    let best = null, bestD = Infinity;
    for (const b of this.eph.bodies) {
      const d = this.clearance(b, worldPos);
      if (d < bestD) { bestD = d; best = b; }
    }
    return { body: best, distance: bestD };
  }

  /** Local "up", altitude above the reference surface and above terrain. */
  surfaceInfo(body = this.parent, rel = this.rel) {
    const d = rel.length();
    const dirLocal = body.toLocal(_w.copy(rel).divideScalar(d), new THREE.Vector3());
    const refR = body.surfaceRadiusLocal(dirLocal);
    const h = this.groundHeight(body, dirLocal);
    return { d, dirLocal, refR, altitude: d - refR, ground: d - refR - h, terrainH: h };
  }

  // ---- Pulse drive & autopilot ------------------------------------------------------------
  canPulse() {
    if (this.mode === 'landed' || this.mode === 'destroyed') return { ok: false, why: 'Take off first' };
    const t = this.telemetry;
    const body = this.parent;
    const atm = body.atmosphere;
    if (atm && t.altitude < atm.top * 1.2) return { ok: false, why: 'Pulse drive unavailable inside an atmosphere' };
    if (t.altitude < this.interdictionAltitude(body)) return { ok: false, why: 'Too deep in the gravity well: climb higher' };
    return { ok: true };
  }

  interdictionAltitude(body) {
    if (body.id === 'sun') return 0.02 * AU;
    const atmTop = body.atmosphere ? body.atmosphere.top * 1.2 : 0;
    return Math.max(atmTop, body.radius * 0.12, 8000);
  }

  togglePulse() {
    if (this.mode === 'pulse' || this.spool > 0) {
      this.exitPulse('manual');
      return true;
    }
    const c = this.canPulse();
    if (!c.ok) { this.events.push({ type: 'pulse-denied', why: c.why }); return false; }
    this.spool = 0.0001;
    this.events.push({ type: 'pulse-spool' });
    return true;
  }

  exitPulse(reason) {
    const wasPulsing = this.mode === 'pulse';
    this.spool = 0;
    if (!wasPulsing) return;
    this.mode = 'flight';
    // Drop out at rest relative to whatever dominates here.
    const wp = this.worldPos(new THREE.Vector3());
    const dom = this.eph.dominantBody(wp);
    this.parent = dom;
    this.rel.copy(wp).sub(dom.pos);
    this.vel.set(0, 0, 0);
    this.pulseSpeed = 0;
    this.events.push({ type: 'pulse-exit', reason, body: dom });
  }

  /** Arrival distance from a body's centre for the autopilot. */
  arrivalDistance(body) {
    if (body.id === 'sun') return 0.3 * AU;
    if (body.atmosphere?.gasGiant) return body.radius * 3.4;
    if (body.radius < 50e3) return body.maxRadius * 6 + 20e3;
    const barrier = body.def.barrier ? body.radius + body.def.barrier.altitude : 0;
    return Math.max(body.radius * 2.6, barrier * 1.6);
  }

  engageAutopilot(target) {
    if (!target || target === this.parent && this.telemetry.altitude < this.arrivalDistance(target) - target.radius) {
      this.events.push({ type: 'pulse-denied', why: 'Already at the target' });
      return;
    }
    if (this.mode === 'landed') { this.events.push({ type: 'pulse-denied', why: 'Take off first' }); return; }
    this.autopilot = { target, phase: 'align', waypoint: null };
    this.events.push({ type: 'autopilot', target });
  }

  cancelAutopilot(silent) {
    if (!this.autopilot) return;
    this.autopilot = null;
    if (!silent) this.events.push({ type: 'autopilot-off' });
  }

  /**
   * Final arrival point near the target (on its sunlit side) plus a steering
   * point that detours around any body (the Sun, a planet) sitting in the way.
   */
  autopilotAim(out, steerOut) {
    const ap = this.autopilot;
    const T = ap.target;
    const ship = this.worldPos(new THREE.Vector3());
    const D = this.arrivalDistance(T);
    const fromT = ship.clone().sub(T.pos).normalize();
    const toSun = this.eph.sun.pos.clone().sub(T.pos).normalize();
    if (T.id === 'sun') toSun.copy(fromT);
    const dir = fromT.clone().multiplyScalar(0.55).addScaledVector(toSun, 0.45).normalize();
    out.copy(T.pos).addScaledVector(dir, D);
    if (steerOut) steerOut.copy(out);
    ap.waypoint = null;
    // Check every other body sitting near the straight path.
    // Check every other body near the straight path (measured in metres along
    // the path, so a planet right beside the start point counts too).
    let worst = null, worstAlong = Infinity;
    const seg = out.clone().sub(ship);
    const len = seg.length();
    if (len > 1) {
      seg.divideScalar(len);
      for (const b of this.eph.bodies) {
        if (b === T || (b === T.parent && T.kind === 'moon')) continue;
        const safe = b.id === 'sun' ? 0.25 * AU : b.maxRadius + this.interdictionAltitude(b) * 2.5;
        const along = b.pos.clone().sub(ship).dot(seg);
        if (along <= 0 || along >= len) continue;
        const closest = ship.clone().addScaledVector(seg, along);
        if (closest.distanceTo(b.pos) < safe && along < worstAlong) { worst = { b, closest, safe }; worstAlong = along; }
      }
    }
    if (worst && steerOut) {
      const away = worst.closest.clone().sub(worst.b.pos);
      if (away.lengthSq() < 1) away.copy(worst.b.pole);
      away.normalize();
      steerOut.copy(worst.b.pos).addScaledVector(away, worst.safe * 1.6);
      ap.waypoint = worst.b.id;
    }
    return out;
  }

  // ---- Main update ----------------------------------------------------------------------------
  update(dt) {
    if (this.mode === 'destroyed') return;
    if (this.mode === 'landed') { this.updateLanded(dt); return; }

    // Sphere-of-influence handover.
    const wp = this.worldPos(new THREE.Vector3());
    const dom = this.eph.dominantBody(wp);
    if (dom !== this.parent) this.setParent(dom);

    this.updateRotation(dt);
    if (this.spool > 0 && this.mode !== 'pulse') {
      this.spool += dt;
      if (this.spool >= SHIP.pulseSpool) {
        const c = this.canPulse();
        if (c.ok) { this.mode = 'pulse'; this.pulseSpeed = Math.max(2000, this.vel.length()); this.events.push({ type: 'pulse-start' }); }
        else this.events.push({ type: 'pulse-denied', why: c.why });
        this.spool = 0;
      }
    }
    if (this.autopilot) this.updateAutopilot(dt);
    if (this.mode === 'pulse') this.updatePulse(dt);
    else this.updateFlight(dt);
    this.updateTelemetry();
  }

  updateRotation(dt) {
    const inp = this.input;
    const target = _v.set(inp.pitch * SHIP.pitchRate, inp.yaw * SHIP.yawRate, inp.roll * SHIP.rollRate);
    if (this.autopilot && this.autopilot.steer) target.copy(this.autopilot.steer);
    const step = SHIP.angAccel * dt;
    for (const k of ['x', 'y', 'z']) {
      const diff = target[k] - this.angVel[k];
      this.angVel[k] += Math.max(-step, Math.min(step, diff));
    }
    const ang = this.angVel.length();
    if (ang > 1e-6) {
      _q.setFromAxisAngle(_w.copy(this.angVel).divideScalar(ang), ang * dt);
      this.quat.multiply(_q).normalize();
    }
  }

  updateFlight(dt) {
    const body = this.parent;
    const inp = this.input;
    const r = this.rel;
    const d = r.length();
    const info = this.surfaceInfo(body, r);
    _up.copy(r).divideScalar(d);

    // Gravity (point mass) + co-rotating reference frame near the surface.
    const gMag = body.GM / (d * d);
    const gravity = new THREE.Vector3().copy(_up).multiplyScalar(-gMag);
    const vSurf = body.surfaceVelocity(r, new THREE.Vector3());
    const atm = body.atmosphere;
    const coRotZone = Math.max(atm ? atm.top * 1.5 : 0, body.radius * 0.08);
    const coRot = 1 - smoothstep(coRotZone, coRotZone * 3, info.altitude);
    const vRef = vSurf.clone().multiplyScalar(coRot);

    // Air: drag relative to the rotating atmosphere, integrated implicitly so
    // that even a 12 km/s plunge into Jupiter stays numerically stable.
    const accel = gravity.clone();
    let density = 0;
    let dragAccel = 0;
    if (atm) {
      const state = atmosphereAt(body, info.altitude);
      density = state.density;
      if (density > 0) {
        const vAir = this.vel.clone().sub(vSurf);
        const s = vAir.length();
        const k = 0.5 * density * s * SHIP.ballistic;
        const vAirNew = vAir.clone().divideScalar(1 + k * dt);
        dragAccel = vAir.distanceTo(vAirNew) / dt;
        this.vel.copy(vSurf).add(vAirNew);
      }
    }

    // Thrust in the ship frame (x right, y up, z back).
    const boost = inp.boost ? SHIP.boost : 1;
    const caps = { x: SHIP.liftAccel * boost, y: SHIP.liftAccel * boost, zf: SHIP.mainAccel * boost, zb: SHIP.reverseAccel * boost };
    const cmd = new THREE.Vector3(inp.strafe, inp.lift, -inp.thrust);
    const qInv = this.quat.clone().invert();
    let local = new THREE.Vector3();
    const assist = this.flightAssist || inp.brake || (this.autopilot && this.autopilot.phase === 'land');
    if (assist) {
      // Desired: kill velocity relative to the reference frame and cancel gravity.
      const err = this.vel.clone().sub(vRef);
      if (this.autopilot && this.autopilot.phase === 'land') {
        const descent = -Math.max(1.6, Math.min(30, info.ground * 0.12));
        err.addScaledVector(_up, -descent);
      }
      const desired = err.multiplyScalar(-SHIP.faGain * (inp.brake ? 2.5 : 1)).sub(gravity);
      const desiredLocal = desired.applyQuaternion(qInv);
      local.copy(desiredLocal);
      if (!inp.brake) {
        if (cmd.x !== 0) local.x = cmd.x * caps.x;
        if (cmd.y !== 0) local.y = cmd.y * caps.y;
        if (cmd.z !== 0) local.z = cmd.z < 0 ? cmd.z * caps.zf : cmd.z * caps.zb;
      }
    } else {
      local.set(cmd.x * caps.x, cmd.y * caps.y, cmd.z < 0 ? cmd.z * caps.zf : cmd.z * caps.zb);
    }
    const brakeBoost = inp.brake ? SHIP.boost : 1;
    local.x = Math.max(-caps.x * brakeBoost, Math.min(caps.x * brakeBoost, local.x));
    local.y = Math.max(-caps.y * brakeBoost, Math.min(caps.y * brakeBoost, local.y));
    local.z = Math.max(-caps.zf * brakeBoost, Math.min(caps.zb * brakeBoost, local.z));
    this.thrustLocal = local.clone();
    const thrustWorld = local.applyQuaternion(this.quat);
    accel.add(thrustWorld);
    this.telemetry.gLoad = (thrustWorld.length() + dragAccel) / G0; // felt acceleration (thrust + drag)

    // Semi-implicit Euler.
    this.vel.addScaledVector(accel, dt);
    this.rel.addScaledVector(this.vel, dt);

    // Earth's defence barrier.
    const bar = body.def.barrier;
    if (bar) {
      const limit = body.radius + bar.altitude;
      const dd = this.rel.length();
      if (dd < limit) {
        const n = this.rel.clone().divideScalar(dd);
        this.rel.copy(n).multiplyScalar(limit + 5);
        const vn = this.vel.dot(n);
        if (vn < 0) this.vel.addScaledVector(n, -vn * 1.6);
        this.events.push({ type: 'barrier', body, dirLocal: body.toLocal(n), speed: -vn });
      }
    }

    // Ground contact.
    const after = this.surfaceInfo(body, this.rel);
    if (after.ground < SHIP.gearHeight && body.def.terrain !== undefined) this.handleContact(after, body, vSurf);
    else if (after.ground < 0 && !atm?.gasGiant && body.id !== 'sun') this.handleContact(after, body, vSurf);
    this.telemetry.density = density;
  }

  handleContact(info, body, vSurf) {
    const up = this.rel.clone().normalize();
    const normalLocal = this.groundNormal ? this.groundNormal(body, info.dirLocal) : info.dirLocal;
    const normal = body.toWorld(normalLocal.clone());
    const vRel = this.vel.clone().sub(vSurf);
    const vn = vRel.dot(normal);
    const vt = vRel.clone().addScaledVector(normal, -vn).length();
    const shipUp = this.up(new THREE.Vector3());
    const tilt = Math.acos(Math.max(-1, Math.min(1, shipUp.dot(normal))));
    const impact = Math.hypot(Math.min(0, vn), vt);
    // Push back up onto the ground.
    const lift = SHIP.gearHeight - info.ground;
    this.rel.addScaledVector(up, lift);
    if (vn < 0 && -vn <= SHIP.safeTouchdown && vt <= SHIP.safeSlide && tilt < 0.6 && this.input.lift <= 0) {
      this.land(body, normal);
      this.events.push({ type: 'landed', body, speed: -vn });
      return;
    }
    if (vn >= 0) return; // sliding/climbing away
    if (impact > SHIP.crashSpeed) {
      this.events.push({ type: 'crash', body, speed: impact, fatal: true });
      this.mode = 'destroyed';
      this.vel.copy(vSurf);
      return;
    }
    // Hard landing: bounce and take damage.
    this.vel.addScaledVector(normal, -vn * 1.35);
    this.vel.lerp(vSurf, 0.3);
    if (impact > SHIP.safeTouchdown) this.events.push({ type: 'impact', body, speed: impact });
  }

  land(body, normalWorld) {
    this.mode = 'landed';
    this.cancelAutopilot(true);
    this.angVel.set(0, 0, 0);
    // Level the ship on the ground, keeping its heading.
    const fwd = this.forward(new THREE.Vector3());
    fwd.addScaledVector(normalWorld, -fwd.dot(normalWorld));
    if (fwd.lengthSq() < 1e-6) fwd.set(1, 0, 0).addScaledVector(normalWorld, -normalWorld.x);
    fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, normalWorld).normalize();
    _m.makeBasis(right, normalWorld, fwd.clone().multiplyScalar(-1));
    this.quat.setFromRotationMatrix(_m);
    this.landed = {
      body,
      local: body.toLocal(this.rel.clone()),
      localQuat: body.quatInv.clone().multiply(this.quat),
    };
    this.vel.set(0, 0, 0);
  }

  updateLanded(dt) {
    const L = this.landed;
    const body = L.body;
    if (this.parent !== body) this.parent = body;
    this.rel.copy(L.local).applyQuaternion(body.quat);
    this.quat.copy(body.quat).multiply(L.localQuat);
    this.vel.copy(body.surfaceVelocity(this.rel, new THREE.Vector3()));
    this.updateTelemetry();
    const inp = this.input;
    if (inp.lift > 0 || inp.thrust !== 0) this.takeOff();
  }

  takeOff() {
    if (this.mode !== 'landed') return;
    const body = this.landed.body;
    const up = this.rel.clone().normalize();
    this.mode = 'flight';
    this.vel.copy(body.surfaceVelocity(this.rel, new THREE.Vector3())).addScaledVector(up, 3);
    this.rel.addScaledVector(up, 0.6);
    this.landed = null;
    this.events.push({ type: 'takeoff', body });
  }

  updatePulse(dt) {
    const wp = this.worldPos(new THREE.Vector3());
    const near = this.nearestSurface(wp);
    let vTarget = Math.min(SHIP.pulseMax, SHIP.pulseK * Math.max(near.distance, 0));
    const ap = this.autopilot;
    let aim = null;
    if (ap && ap.phase === 'cruise') {
      aim = this.autopilotAim(new THREE.Vector3());
      const dAim = aim.distanceTo(wp);
      vTarget = Math.min(vTarget, 1.1 * dAim);
      if (dAim < Math.max(3000, this.arrivalDistance(ap.target) * 0.02)) {
        this.exitPulse('arrived');
        ap.phase = 'arrived';
        this.lookAt(ap.target.pos);
        this.events.push({ type: 'arrived', target: ap.target });
        this.autopilot = null;
        return;
      }
    }
    // Gravity-well interdiction: drop out before the speed collapses near a surface.
    const nb = near.body;
    if (nb && near.distance < this.interdictionAltitude(nb) * 1.05) {
      this.exitPulse('interdicted');
      return;
    }
    // Accelerate exponentially, decelerate quickly.
    const rate = vTarget > this.pulseSpeed ? 1.6 : 6;
    this.pulseSpeed += (vTarget - this.pulseSpeed) * Math.min(1, dt * rate);
    const fwd = this.forward(_fwd);
    wp.addScaledVector(fwd, this.pulseSpeed * dt);
    const dom = this.eph.dominantBody(wp);
    this.parent = dom;
    this.rel.copy(wp).sub(dom.pos);
    this.vel.copy(fwd).multiplyScalar(Math.min(this.pulseSpeed, 3e4));
  }

  updateAutopilot(dt) {
    const ap = this.autopilot;
    const wp = this.worldPos(new THREE.Vector3());
    if (ap.phase === 'land') {
      ap.steer = this.levelSteer();
      return;
    }
    const steerTo = new THREE.Vector3();
    this.autopilotAim(new THREE.Vector3(), steerTo);
    const want = steerTo.sub(wp).normalize();
    const fwd = this.forward(new THREE.Vector3());
    const angle = Math.acos(Math.max(-1, Math.min(1, fwd.dot(want))));
    // Steer: rotation axis in the ship frame, proportional rate.
    const axisWorld = new THREE.Vector3().crossVectors(fwd, want);
    const axisLocal = axisWorld.applyQuaternion(this.quat.clone().invert());
    const rate = Math.min(1.4, angle * 2.5);
    ap.steer = axisLocal.lengthSq() > 1e-12 ? axisLocal.normalize().multiplyScalar(rate) : new THREE.Vector3();
    if (ap.phase === 'align') {
      if (angle < 0.03) {
        const c = this.canPulse();
        if (!c.ok) {
          // Too low to pulse: climb straight up first.
          ap.phase = 'climb';
        } else {
          ap.phase = 'cruise';
          if (this.mode !== 'pulse' && this.spool === 0) this.togglePulse();
        }
      }
    } else if (ap.phase === 'climb') {
      this.input.lift = 1;
      if (this.canPulse().ok) ap.phase = 'align';
    } else if (ap.phase === 'cruise' && this.mode !== 'pulse' && this.spool === 0) {
      // Dropped out early (interdiction) — re-align and continue if possible.
      ap.phase = 'align';
    }
  }

  /** Angular velocity that brings the ship's up axis to the local vertical. */
  levelSteer() {
    const up = this.rel.clone().normalize();
    const shipUpLocal = new THREE.Vector3(0, 1, 0);
    const wantLocal = up.applyQuaternion(this.quat.clone().invert());
    const axis = new THREE.Vector3().crossVectors(shipUpLocal, wantLocal);
    const s = axis.length();
    const angle = Math.atan2(s, shipUpLocal.dot(wantLocal));
    return s > 1e-9 ? axis.divideScalar(s).multiplyScalar(Math.min(1.2, angle * 2)) : new THREE.Vector3();
  }

  autoLand() {
    const t = this.telemetry;
    if (this.mode !== 'flight') return false;
    if (!this.parent.def.terrain) { this.events.push({ type: 'pulse-denied', why: 'There is no solid ground here' }); return false; }
    if (t.ground > 1500) { this.events.push({ type: 'pulse-denied', why: 'Descend below 1,500 m to auto-land' }); return false; }
    this.autopilot = { target: this.parent, phase: 'land' };
    this.events.push({ type: 'autoland' });
    return true;
  }

  updateTelemetry() {
    const t = this.telemetry;
    const body = this.parent;
    const info = this.surfaceInfo(body, this.rel);
    const up = this.rel.clone().divideScalar(info.d);
    const vSurf = body.surfaceVelocity(this.rel, new THREE.Vector3());
    const vRel = this.vel.clone().sub(vSurf);
    t.altitude = info.altitude;
    t.ground = info.ground;
    t.terrainH = info.terrainH;
    t.vSpeed = this.mode === 'landed' ? 0 : vRel.dot(up);
    t.speed = this.mode === 'pulse' ? this.pulseSpeed : this.vel.length();
    t.surfaceSpeed = vRel.length();
    t.gravity = body.GM / (info.d * info.d);
    const wp = this.worldPos(new THREE.Vector3());
    const near = this.nearestSurface(wp);
    t.nearest = near.body;
    t.nearestDist = near.distance;
    const atm = body.atmosphere;
    if (atm) {
      const s = atmosphereAt(body, info.altitude);
      t.pressure = s.pressure;
      t.density = s.density;
      t.temperature = s.temperature;
      t.inAtmosphere = s.density > 0 && info.altitude < atm.top;
      t.heatFlux = this.mode === 'pulse' ? 0 : entryHeating(s.density, t.surfaceSpeed);
      t.dynPressure = dynamicPressure(s.density, t.surfaceSpeed);
    } else {
      t.pressure = 0; t.density = 0; t.temperature = null; t.inAtmosphere = false; t.heatFlux = 0; t.dynPressure = 0;
    }
  }
}
