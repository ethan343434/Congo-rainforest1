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
//   and still never ram a planet. It works anywhere, even from the ground:
//   near a surface it keeps a minimum speed, skims over the terrain, and
//   stops just above the ground if you dive into it.
// * Cruise engines: away from planets the main engines spool up
//   exponentially, so holding W takes you from rest to the 0.9 c ceiling in
//   about 20 s (14 s with boost). Near a surface (or the top of an atmosphere)
//   speed is limited in proportion to the clearance, down to 200 m/s over
//   airless ground, so you arrive ready to land and never pass through a
//   planet between two frames.
// * Flight assist also keeps atmospheric entries survivable: air speed stays
//   below what the hull can shed as heat. Turn assist off for a real,
//   unprotected entry.
// * Autopilot: aligns, pulses, routes around the Sun, and drops you out on the
//   sunlit side of the target. Auto-land flies you down from orbit to the
//   ground below in a fixed 10 seconds.
// * Landing: gentle touchdowns on solid ground; hard ones damage the ship,
//   and a crash on a rocky world or moon wrecks it (the game layer throws
//   you clear and runs the repairs).
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
  cruiseRate: 1.1,      // e-folds per second of engine spool-up
  cruiseMaxMult: 1e6,   // spooled thrust multiplier ceiling (32 m/s² → 3.2e7 m/s²)
  cruiseVScale: 40,     // above natural speeds, thrust grows by 1× per 40 m/s
  cruiseNear: 2000,     // m: no cruise boost closer than this to a surface
  cruiseFar: 30000,     // m: full cruise boost beyond this
  cruiseK: 1.0,         // speed limit per metre of clearance (1/s)
  landingSpeed: 200,    // m/s: the limiter slows you to this over solid ground
  safeHeatFlux: 60e3,   // W/m²: with flight assist, entry heating is held here (hull ≈ 800 °C)
  safeDynPressure: 48e3, // Pa: …and air pressure on the hull here (60% of its limit)
  cruiseMax: 0.9 * C_LIGHT,
  autoLandTime: 10,     // s: auto-land always takes this long
  pulseK: 0.75,         // pulse speed per metre of clearance (1/s)
  pulseMax: 2400 * C_LIGHT,
  pulseSpool: 1.2,      // s
  pulseMin: 1500,       // m/s: slowest pulse speed, right by a surface
  pulseHover: 5,        // m: the pulse drive never goes lower than this above ground
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
    this.parent = eph.byId.earth || eph.sun;
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
    this.cruise = 0;                // cruise-engine spool (s)
    this.approachLimit = true;      // slow down near planets (the game can switch it off)
    this.heatImmune = false;        // heat can't hurt the hull, so entries are limited by pressure only
    this.input = { thrust: 0, lift: 0, strafe: 0, pitch: 0, yaw: 0, roll: 0, boost: false, brake: false };
    this.telemetry = {
      altitude: Infinity, ground: Infinity, vSpeed: 0, speed: 0, density: 0, pressure: 0, temperature: null,
      heatFlux: 0, dynPressure: 0, gLoad: 0, gravity: 0, nearest: null, nearestDist: Infinity, inAtmosphere: false,
    };
    this.groundHeight = () => 0;   // terrain hook: (body, dirLocal) → metres above the reference ellipsoid
    this.groundNormal = null;      // optional hook: (body, dirLocal) → local normal
    this.groundReady = null;       // optional hook: (body) → is the detailed ground loaded?
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
    this.cruise = 0;
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
      if (b.eaten) continue;
      const d = this.clearance(b, worldPos);
      if (d < bestD) { bestD = d; best = b; }
    }
    return { body: best, distance: bestD };
  }

  /**
   * Cruise envelope: clearance to the nearest surface (or atmosphere top) and
   * the tightest speed limit over all bodies. Each body allows cruiseK × its
   * clearance, but never less than landingSpeed over airless ground (so you
   * arrive ready to land) or what gravity alone could produce in an
   * atmosphere or near the Sun (so entries and plunges stay real). Black
   * holes impose no limit. Speeds are measured relative to each body.
   */
  cruiseEnvelope(worldPos, info) {
    const env = { clear: Infinity, limit: Infinity, body: null };
    for (const b of this.eph.bodies) {
      if (b.eaten) continue;
      if (b.kind === 'blackhole') continue;
      const dist = b.pos.distanceTo(worldPos);
      const solid = b.def.terrain !== undefined;
      const atm = b.atmosphere;
      const natural = 1.2 * Math.sqrt((2 * b.GM) / dist) + 1000;
      let limit, clear;
      if (solid) {
        // Down to landing speed over the ground; with air, arrive at the top of
        // the atmosphere no faster than gravity alone would bring you.
        const ground = b === this.parent ? info.ground : dist - b.maxRadius;
        limit = Math.max(SHIP.landingSpeed, SHIP.cruiseK * ground);
        if (atm) limit = Math.min(limit, Math.max(natural, SHIP.cruiseK * (dist - b.maxRadius - atm.top)));
        clear = ground;
      } else {
        // Gas giants, the Sun, shielded Earth: the cloud tops / surface, natural speeds.
        clear = dist - b.maxRadius - (atm ? atm.top : 0);
        limit = Math.max(natural, SHIP.cruiseK * clear);
      }
      if (clear < env.clear) env.clear = clear;
      if (limit < env.limit) { env.limit = limit; env.body = b; }
    }
    return env;
  }

  /**
   * Fast enough to cross a world in one step: find the first solid world
   * whose sphere (below its deepest basins) this step's path enters, and stop
   * there with the velocity unchanged so the impact registers. Returns
   * 'parent' for the body you are over (its contact check runs as usual),
   * 'other' after handling an impact on another world, or false.
   */
  sweepToSurface(body, dt) {
    const v = _v.copy(this.vel).multiplyScalar(dt);
    const step = v.length();
    if (step < 1000) return false; // under 1 km per step: the contact check is enough
    let hit = null, first = 1;
    const p = new THREE.Vector3(), vb = new THREE.Vector3();
    for (const b of this.eph.bodies) {
      if (b.eaten) continue;
      if (b.def.terrain === undefined) continue;
      p.copy(this.rel).add(body.pos).sub(b.pos);           // relative to b
      if (p.length() - b.radius > step * 1.5) continue;     // out of reach this step
      vb.copy(this.vel).add(body.vel).sub(b.vel).multiplyScalar(dt);
      const R = b.radius * 0.985;
      const A = vb.lengthSq(), B = 2 * p.dot(vb), C = p.lengthSq() - R * R;
      const disc = B * B - 4 * A * C;
      if (C <= 0 || disc < 0 || A === 0) continue;
      const sHit = (-B - Math.sqrt(disc)) / (2 * A);
      if (sHit >= 0 && sHit <= first) { first = sHit; hit = b; }
    }
    if (!hit) return false;
    this.rel.addScaledVector(v, first);
    if (hit === body) return 'parent';
    this.setParent(hit);
    this.handleContact(this.surfaceInfo(hit, this.rel), hit, hit.surfaceVelocity(this.rel, new THREE.Vector3()));
    return 'other';
  }

  /** Auto-land works from orbit: anywhere within a few radii of solid ground. */
  autoLandRange(body = this.parent) {
    return Math.max(2e6, 4 * body.radius);
  }

  canAutoLand() {
    return this.mode === 'flight' && this.parent.def.terrain !== undefined && this.telemetry.ground < this.autoLandRange();
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
    if (this.mode === 'destroyed') return { ok: false, why: 'The ship is wrecked' };
    return { ok: true };
  }

  /** The autopilot still climbs clear of atmospheres and gravity wells before it pulses. */
  autopilotCanPulse() {
    return this.canPulse().ok && this.telemetry.altitude >= this.interdictionAltitude(this.parent);
  }

  /**
   * Clearance for the pulse drive: the nearest surface, using the real ground
   * (terrain included) under the ship for the body you are over.
   */
  pulseClearance(worldPos) {
    const near = this.nearestSurface(worldPos);
    const ground = this.surfaceInfo(this.parent, worldPos.clone().sub(this.parent.pos)).ground;
    if (ground < near.distance) return { body: this.parent, distance: ground };
    return near;
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
    if (this.mode === 'landed') this.takeOff(); // straight off the ground
    this.spool = 0.0001;
    this.events.push({ type: 'pulse-spool' });
    return true;
  }

  exitPulse(reason) {
    const wasPulsing = this.mode === 'pulse';
    this.spool = 0;
    if (!wasPulsing) return;
    this.mode = 'flight';
    // Drop out at rest relative to whatever dominates here (moving with the
    // ground when low over a world, so there's no sudden wind).
    const wp = this.worldPos(new THREE.Vector3());
    const dom = this.eph.dominantBody(wp);
    this.parent = dom;
    this.rel.copy(wp).sub(dom.pos);
    dom.surfaceVelocity(this.rel, this.vel).multiplyScalar(this.coRotation(this.surfaceInfo(dom, this.rel).altitude, dom));
    this.pulseSpeed = 0;
    this.events.push({ type: 'pulse-exit', reason, body: dom });
  }

  /** Arrival distance from a body's centre for the autopilot. */
  arrivalDistance(body) {
    if (body.id === 'sun') return 0.3 * AU;
    if (body.kind === 'blackhole') return body.radius * 14; // outside the accretion disk
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
    // Taking over mid-landing: hold position over the ground, don't keep falling.
    if (this.autopilot.phase === 'land' && this.mode === 'flight') {
      this.vel.copy(this.parent.surfaceVelocity(this.rel, new THREE.Vector3()));
    }
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
      if (b.eaten) continue;
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

  /** 1 near the surface (hold position over the turning ground), 0 far out. */
  coRotation(altitude, body = this.parent) {
    const atm = body.atmosphere;
    const zone = Math.max(atm ? atm.top * 1.5 : 0, body.radius * 0.08);
    return 1 - smoothstep(zone, zone * 3, altitude);
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
    if (this.autopilot?.phase === 'land') this.updateAutoLand(dt);
    else if (this.mode === 'pulse') this.updatePulse(dt);
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
    const coRot = this.coRotation(info.altitude);
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

    // Cruise engines: spool up while working hard away from surfaces, and
    // stay strong while moving faster than anything gravity could explain.
    const assist = this.flightAssist || inp.brake;
    const env = this.cruiseEnvelope(this.worldPos(new THREE.Vector3()), info);
    const cruiseW = smoothstep(SHIP.cruiseNear, SHIP.cruiseFar, env.clear);
    const vNatural = 1.2 * Math.sqrt((2 * body.GM) / d) + 1000;
    const errMag = this.vel.distanceTo(vRef);
    const working = cruiseW > 0 && (inp.thrust !== 0 || inp.brake || (assist && errMag > 50));
    this.cruise = working ? Math.min(this.cruise + dt, 30) : Math.max(0, this.cruise - 3 * dt);
    const mult = 1 + cruiseW * (Math.min(SHIP.cruiseMaxMult, Math.max(Math.exp(SHIP.cruiseRate * this.cruise), 1 + Math.max(0, errMag - vNatural) / SHIP.cruiseVScale)) - 1);

    // Thrust in the ship frame (x right, y up, z back).
    const boost = (inp.boost ? SHIP.boost : 1) * mult;
    const caps = { x: SHIP.liftAccel * boost, y: SHIP.liftAccel * boost, zf: SHIP.mainAccel * boost, zb: SHIP.reverseAccel * boost };
    const cmd = new THREE.Vector3(inp.strafe, inp.lift, -inp.thrust);
    const qInv = this.quat.clone().invert();
    let local = new THREE.Vector3();
    if (assist) {
      // Desired: kill velocity relative to the reference frame and cancel gravity.
      const err = this.vel.clone().sub(vRef);
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
    // Speed limit: 0.9 c, and proportional to clearance near planets (never
    // below what gravity alone could produce).
    this.telemetry.speedLimited = false;
    if (env.body && this.approachLimit) {
      // Speed relative to the limiting body; for the body you are over, relative
      // to its turning surface (Mars' ground moves at 240 m/s).
      const lb = env.body;
      const ref = lb === body ? vRef : _v.copy(lb.vel).sub(body.vel);
      const vb = _w.copy(this.vel).sub(ref);
      const sb = vb.length();
      if (sb > env.limit) {
        vb.multiplyScalar(env.limit / sb);
        this.vel.copy(vb).add(ref);
        this.telemetry.speedLimited = env.limit < SHIP.cruiseMax;
      }
    }
    const speed = this.vel.length();
    if (speed > SHIP.cruiseMax) this.vel.multiplyScalar(SHIP.cruiseMax / speed);
    // Flight assist keeps an entry survivable: air speed stays under what the
    // hull can shed as heat and bear as pressure. Assist off: no protection.
    this.telemetry.entryLimited = false;
    if (density > 0 && (assist || this.autopilot)) {
      const vSafe = Math.min(
        this.heatImmune ? Infinity : Math.cbrt(SHIP.safeHeatFlux / entryHeating(density, 1)),
        Math.sqrt((2 * SHIP.safeDynPressure) / density),
      );
      const vAir = _w.copy(this.vel).sub(vSurf);
      const sa = vAir.length();
      if (sa > vSafe) {
        this.vel.copy(vSurf).addScaledVector(vAir, vSafe / sa);
        this.telemetry.entryLimited = true;
      }
    }
    this.telemetry.cruise = mult;
    // Fast enough to cross a world in one step (no approach limit): stop at
    // its surface so the crash registers instead of passing through.
    const swept = this.sweepToSurface(body, dt);
    if (swept === 'other') { this.telemetry.density = density; return; } // hit a moon: handled there
    if (!swept) this.rel.addScaledVector(this.vel, dt);

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
    else if (after.ground < 0 && !atm?.gasGiant && body.id !== 'sun' && body.kind !== 'blackhole') this.handleContact(after, body, vSurf);
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
      if (body.def.terrain !== undefined) {
        // Solid ground: a crash landing. The ship survives, badly damaged.
        this.land(body, normal);
        this.events.push({ type: 'crash', body, speed: impact, survivable: true });
        return;
      }
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
    const near = this.pulseClearance(wp);
    let vTarget = Math.min(SHIP.pulseMax, Math.max(SHIP.pulseMin, SHIP.pulseK * Math.max(near.distance, 0)));
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
    // Accelerate exponentially, decelerate quickly.
    const rate = vTarget > this.pulseSpeed ? 1.6 : 6;
    this.pulseSpeed += (vTarget - this.pulseSpeed) * Math.min(1, dt * rate);
    const fwd = this.forward(_fwd);
    wp.addScaledVector(fwd, this.pulseSpeed * dt);
    const dom = this.eph.dominantBody(wp);
    this.parent = dom;
    this.rel.copy(wp).sub(dom.pos);
    this.vel.copy(fwd).multiplyScalar(Math.min(this.pulseSpeed, 3e4));
    const up = this.rel.clone().normalize();
    // Earth's defence grid stops the pulse drive too.
    const bar = dom.def.barrier;
    if (bar && this.rel.length() < dom.radius + bar.altitude) {
      this.rel.copy(up).multiplyScalar(dom.radius + bar.altitude + 5);
      this.exitPulse('barrier');
      this.events.push({ type: 'barrier', body: dom, dirLocal: dom.toLocal(up.clone()), speed: this.pulseSpeed });
      return;
    }
    // Never below the ground: skim over it, or stop just above it when diving in.
    const ground = this.surfaceInfo(dom, this.rel).ground;
    if (ground < SHIP.pulseHover) {
      this.rel.addScaledVector(up, SHIP.pulseHover - ground);
      if (fwd.dot(up) < -0.5) this.exitPulse('surface');
    }
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
        if (!this.autopilotCanPulse()) {
          // Too low to pulse: climb straight up first.
          ap.phase = 'climb';
        } else {
          ap.phase = 'cruise';
          if (this.mode !== 'pulse' && this.spool === 0) this.togglePulse();
        }
      }
    } else if (ap.phase === 'climb') {
      this.input.lift = 1;
      if (this.autopilotCanPulse()) ap.phase = 'align';
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
    if (t.ground > this.autoLandRange()) { this.events.push({ type: 'pulse-denied', why: `Get within ${Math.round(this.autoLandRange() / 1000).toLocaleString('en-US')} km of the surface to auto-land` }); return false; }
    const info = this.surfaceInfo();
    this.autopilot = { target: this.parent, phase: 'land', t: 0, ground0: Math.max(0, info.ground), dirLocal: info.dirLocal.clone() };
    this.events.push({ type: 'autoland' });
    return true;
  }

  /**
   * Auto-land: a scripted descent onto the ground straight below, turning
   * with the world, that always takes SHIP.autoLandTime. Height above the
   * ground follows (1−u)³(1+3u) of the starting height (u = t / T): it
   * starts gently, drops fast, then eases in, and the ship sets down level.
   * The descent is shielded: no entry heating or air loads while it flies.
   */
  updateAutoLand(dt) {
    const ap = this.autopilot;
    const body = this.parent;
    ap.t += dt;
    this.telemetry.speedLimited = this.telemetry.entryLimited = false;
    // Don't set down before the detailed ground is known: hover just above.
    if (ap.t >= SHIP.autoLandTime && this.groundReady && !this.groundReady(body)) ap.t = SHIP.autoLandTime * 0.995;
    const u = Math.min(1, ap.t / SHIP.autoLandTime);
    const h = ap.ground0 * (1 - u) ** 3 * (1 + 3 * u);
    const dir = body.toWorld(ap.dirLocal.clone()).normalize();
    const groundR = body.surfaceRadiusLocal(ap.dirLocal) + this.groundHeight(body, ap.dirLocal);
    const prev = this.rel.clone();
    this.rel.copy(dir).multiplyScalar(groundR + SHIP.gearHeight + h);
    // Velocity: the ground's motion plus the descent, for the HUD and effects.
    this.vel.copy(this.rel).sub(prev).divideScalar(Math.max(dt, 1e-6));
    if (u >= 1) {
      const normalLocal = this.groundNormal ? this.groundNormal(body, ap.dirLocal) : ap.dirLocal;
      const descent = ap.ground0 * 12 * u * (1 - u) ** 2 / SHIP.autoLandTime;
      this.land(body, body.toWorld(normalLocal.clone()));
      this.events.push({ type: 'landed', body, speed: Math.max(0.8, descent) });
    }
  }

  updateTelemetry() {
    const t = this.telemetry;
    const body = this.parent;
    const info = this.surfaceInfo(body, this.rel);
    const up = this.rel.clone().divideScalar(info.d);
    const vSurf = body.surfaceVelocity(this.rel, new THREE.Vector3());
    // Speeds are shown relative to the frame flight assist holds: turning with
    // the ground near the surface, non-rotating far out.
    const vRel = this.vel.clone().sub(vSurf.clone().multiplyScalar(this.coRotation(info.altitude)));
    t.relVel = vRel;
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
      const vAir = this.vel.distanceTo(vSurf);
      const shielded = this.mode === 'pulse' || this.autopilot?.phase === 'land';
      t.heatFlux = shielded ? 0 : entryHeating(s.density, vAir);
      t.dynPressure = shielded ? 0 : dynamicPressure(s.density, vAir);
    } else {
      t.pressure = 0; t.density = 0; t.temperature = null; t.inAtmosphere = false; t.heatFlux = 0; t.dynPressure = 0;
    }
  }
}
