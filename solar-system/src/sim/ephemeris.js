// =============================================================================
// ephemeris.js — where every body is, how fast it moves and how it is turned,
// for any moment in time.
//
// * Sun, planets, Pluto, Earth's Moon and Jupiter's four big moons come from
//   astronomy-engine (VSOP87 / ELP / L1.2 theories), for the real date.
// * Other moons follow Keplerian orbits in their planet's equatorial plane
//   with real sizes, periods, inclinations and eccentricities (their phases
//   are not real, since no compact public theory exists for them).
// * Spin axes and rotation angles use IAU models where available; other
//   moons are tidally locked (the same face always points at the planet).
//
// World frame: heliocentric, metres, three.js axes with +Y = ecliptic north,
// +X = vernal equinox, +Z = −(ecliptic Y). Body-local frame (matches the
// texture mapping): +X = longitude 0, +Y = north pole, −Z = longitude 90°E.
// =============================================================================
import * as THREE from 'three';
import * as Astro from 'astronomy-engine';
import { AU, DEG, OBLIQUITY, DAY } from '../constants.js';

const COS_E = Math.cos(OBLIQUITY);
const SIN_E = Math.sin(OBLIQUITY);
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

/** Equatorial J2000 (AU or any unit) → world frame (same unit). */
export function eqjToWorld(x, y, z, out = new THREE.Vector3()) {
  const ye = y * COS_E + z * SIN_E;  // ecliptic Y
  const ze = -y * SIN_E + z * COS_E; // ecliptic Z (north)
  return out.set(x, ze, -ye);
}

/** World → equatorial J2000 (inverse of eqjToWorld). */
export function worldToEqj(v, out = new THREE.Vector3()) {
  const xe = v.x, ye = -v.z, ze = v.y;
  return out.set(xe, ye * COS_E - ze * SIN_E, ye * SIN_E + ze * COS_E);
}

function hash01(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

/** Solve Kepler's equation M = E − e sin E. */
function eccentricAnomaly(M, e) {
  let E = e < 0.8 ? M : Math.PI;
  for (let i = 0; i < 12; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  return E;
}

const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const ECL_NORTH = new THREE.Vector3(0, 1, 0);
const _r1 = new THREE.Vector3();
const _r2 = new THREE.Vector3();
const _r3 = new THREE.Vector3();
const _r4 = new THREE.Vector3();

/** Orientation from IAU pole (RA hours, Dec deg) and spin angle W (deg). */
function iauQuaternion(raHours, decDeg, spinDeg, out) {
  const a = raHours * 15 * DEG + Math.PI / 2;
  const b = Math.PI / 2 - decDeg * DEG;
  const W = spinDeg * DEG;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cw = Math.cos(W), sw = Math.sin(W);
  // Body-fixed X (prime meridian), Y (90°E), Z (pole) expressed in EQJ.
  const X = [ca * cw - sa * cb * sw, sa * cw + ca * cb * sw, sb * sw];
  const Y = [-ca * sw - sa * cb * cw, -sa * sw + ca * cb * cw, sb * cw];
  const Z = [sa * sb, -ca * sb, cb];
  eqjToWorld(X[0], X[1], X[2], _x);          // local X = lon 0
  eqjToWorld(Z[0], Z[1], Z[2], _y);          // local Y = north
  eqjToWorld(-Y[0], -Y[1], -Y[2], _z);       // local Z = −(90°E)
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

export class BodyState {
  constructor(def) {
    this.def = def;
    this.id = def.id;
    this.name = def.name;
    this.kind = def.kind;
    this.radius = def.radius;
    this.GM = def.GM;
    this.flattening = def.flattening || 0;
    // Ellipsoid semi-axes in the local frame (x, y = polar, z).
    if (def.shape) {
      this.axes = new THREE.Vector3(def.shape[0], def.shape[2], def.shape[1]);
    } else {
      const req = this.radius / Math.cbrt(1 - this.flattening);
      this.axes = new THREE.Vector3(req, req * (1 - this.flattening), req);
    }
    this.maxRadius = Math.max(this.axes.x, this.axes.y, this.axes.z);
    this.parent = null;
    this.children = [];
    this.pos = new THREE.Vector3();      // world, m
    this.vel = new THREE.Vector3();      // world, m/s
    this.quat = new THREE.Quaternion();  // local → world
    this.quatInv = new THREE.Quaternion();
    this.pole = new THREE.Vector3(0, 1, 0);
    this.omega = new THREE.Vector3();    // angular velocity, world rad/s
    this.soi = Infinity;
    this.atmosphere = def.atmosphere || null;
    this.phase = hash01(def.id) * Math.PI * 2;
    this._prevPos = new THREE.Vector3();
    this._prevQuat = new THREE.Quaternion();
    this._prevTime = null;
  }

  /** Radius of the reference surface (ellipsoid) in a local-frame direction. */
  surfaceRadiusLocal(dirLocal) {
    const a = this.axes;
    const x = dirLocal.x / a.x, y = dirLocal.y / a.y, z = dirLocal.z / a.z;
    return 1 / Math.sqrt(x * x + y * y + z * z);
  }

  /** Convert a world vector (relative to this body's centre) into the local frame. */
  toLocal(v, out = new THREE.Vector3()) {
    return out.copy(v).applyQuaternion(this.quatInv);
  }

  toWorld(v, out = new THREE.Vector3()) {
    return out.copy(v).applyQuaternion(this.quat);
  }

  /** Velocity of the co-rotating surface/atmosphere at offset r from the centre. */
  surfaceVelocity(r, out = new THREE.Vector3()) {
    return out.crossVectors(this.omega, r);
  }
}

export class Ephemeris {
  constructor(bodyDefs) {
    this.bodies = bodyDefs.map((d) => new BodyState(d));
    this.byId = Object.fromEntries(this.bodies.map((b) => [b.id, b]));
    for (const b of this.bodies) {
      if (b.def.parent) {
        b.parent = this.byId[b.def.parent];
        b.parent.children.push(b);
      }
    }
    this.sun = this.byId.sun;
    // Order so parents are always computed before their moons.
    this.order = [...this.bodies].sort((p, q) => depth(p) - depth(q));
    this.time = null;
  }

  /** Recompute everything for a JS Date (or ms timestamp). */
  update(dateLike) {
    const ms = dateLike instanceof Date ? dateLike.getTime() : dateLike;
    const date = new Date(ms);
    const astroTime = Astro.MakeTime(date);
    let jupiterMoons = null;
    for (const b of this.order) {
      this.computePosition(b, astroTime, ms, () => (jupiterMoons ||= Astro.JupiterMoons(astroTime)));
      this.computeRotation(b, astroTime, ms);
    }
    // Velocities and spin rates by finite difference (refreshed ~4×/s).
    const dt = this.time === null ? 0 : (ms - this.time) / 1000;
    if (this.time === null || Math.abs(dt) > 0.25) this.updateRates(ms);
    this.time = ms;
    this.computeSOIs();
  }

  computePosition(b, t, ms, getJupiterMoons) {
    const e = b.def.ephem;
    switch (e.type) {
      case 'origin':
        b.pos.set(0, 0, 0);
        break;
      case 'astro': {
        const v = Astro.HelioVector(e.body, t);
        eqjToWorld(v.x * AU, v.y * AU, v.z * AU, b.pos);
        break;
      }
      case 'geoMoon': {
        const v = Astro.GeoMoon(t);
        eqjToWorld(v.x * AU, v.y * AU, v.z * AU, b.pos).add(b.parent.pos);
        break;
      }
      case 'jupiterMoon': {
        const s = getJupiterMoons()[e.key];
        eqjToWorld(s.x * AU, s.y * AU, s.z * AU, b.pos).add(b.parent.pos);
        break;
      }
      case 'fixed':
        b.pos.set(e.au[0] * AU, e.au[1] * AU, e.au[2] * AU);
        break;
      case 'beyond': {
        // Fixed distance past another body, on the line from the Sun.
        const ref = this.byId[e.body].pos;
        const d = ref.length();
        if (d > 0) b.pos.copy(ref).multiplyScalar((d + e.extra * AU) / d);
        else b.pos.set((40 + e.extra) * AU, 0, 0);
        break;
      }
      case 'kepler':
        this.keplerPosition(b, ms, b.pos).add(b.parent.pos);
        break;
      default:
        throw new Error(`Unknown ephemeris type ${e.type}`);
    }
  }

  /** Position of a Kepler-orbit moon relative to its parent (world axes). */
  keplerPosition(b, ms, out) {
    const e = b.def.ephem;
    const N = b.parent.pole;
    // Basis in the parent's equatorial plane: node of the equator on the ecliptic.
    _a.crossVectors(ECL_NORTH, N);
    if (_a.lengthSq() < 1e-10) _a.set(1, 0, 0);
    _a.normalize();
    _b.crossVectors(N, _a).normalize();
    // Inclined orbit: tilt about a node line rotated by a fixed per-moon angle.
    const node = b.phase * 1.7;
    const p = _x.copy(_a).multiplyScalar(Math.cos(node)).addScaledVector(_b, Math.sin(node));
    const q = _y.copy(_a).multiplyScalar(-Math.sin(node)).addScaledVector(_b, Math.cos(node));
    const inc = (e.i || 0) * DEG;
    q.multiplyScalar(Math.cos(inc)).addScaledVector(N, Math.sin(inc));
    const n = (2 * Math.PI) / (Math.abs(e.period) * DAY);
    const M = b.phase + n * ((ms - J2000_MS) / 1000);
    const ecc = e.e || 0;
    let r, nu;
    if (ecc < 0.01) {
      r = e.a; nu = M;
    } else {
      const E = eccentricAnomaly(((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), ecc);
      nu = 2 * Math.atan2(Math.sqrt(1 + ecc) * Math.sin(E / 2), Math.sqrt(1 - ecc) * Math.cos(E / 2));
      r = e.a * (1 - ecc * Math.cos(E));
    }
    return out.copy(p).multiplyScalar(r * Math.cos(nu)).addScaledVector(q, r * Math.sin(nu));
  }

  computeRotation(b, t, ms) {
    const rot = b.def.rotation;
    if (rot.type === 'iau') {
      const ax = Astro.RotationAxis(rot.body, t);
      iauQuaternion(ax.ra, ax.dec, ax.spin, b.quat);
    } else if (rot.type === 'tidal' || rot.type === 'spin') {
      // North = orbit normal; longitude 0 faces the parent (tidal lock).
      // (Own scratch vectors: keplerPosition() reuses the shared ones.)
      const ahead = this.keplerOrJupiterAhead(b, ms);
      const rel = _r1.subVectors(b.pos, b.parent.pos);
      const normal = _r2.crossVectors(rel, ahead).normalize();
      if (normal.lengthSq() < 0.5) normal.copy(b.parent.pole);
      const toParent = _r3.copy(rel).multiplyScalar(-1).normalize();
      if (rot.type === 'spin') {
        // Free spin about the orbit normal (e.g. Nereid).
        const ang = (((ms - J2000_MS) / 1000) / (rot.periodHours * 3600)) * Math.PI * 2;
        toParent.applyAxisAngle(normal, ang);
      }
      toParent.addScaledVector(normal, -toParent.dot(normal)).normalize();
      _r4.crossVectors(toParent, normal);
      _m.makeBasis(toParent, normal, _r4);
      b.quat.setFromRotationMatrix(_m);
    }
    b.quatInv.copy(b.quat).invert();
    b.pole.set(0, 1, 0).applyQuaternion(b.quat);
  }

  /** A point slightly ahead along a moon's orbit (gives the orbit's direction of motion). */
  keplerOrJupiterAhead(b, ms) {
    if (b.def.ephem.type === 'kepler') {
      const p1 = this.keplerPosition(b, ms + 60000, new THREE.Vector3());
      const p0 = this.keplerPosition(b, ms, new THREE.Vector3());
      return p1.sub(p0);
    }
    // Galilean moons: use the velocity from the last finite difference, else assume prograde.
    if (b.vel.lengthSq() > 0) return b.vel.clone().sub(b.parent.vel);
    return new THREE.Vector3().crossVectors(b.parent.pole, b.pos.clone().sub(b.parent.pos));
  }

  /** Velocities (m/s) and angular velocities (rad/s) by a 10-second finite difference. */
  updateRates(ms) {
    const dt = 10;
    const pos0 = this.bodies.map((b) => b.pos.clone());
    const quat0 = this.bodies.map((b) => b.quat.clone());
    const t2 = Astro.MakeTime(new Date(ms + dt * 1000));
    let jm = null;
    for (const b of this.order) {
      this.computePosition(b, t2, ms + dt * 1000, () => (jm ||= Astro.JupiterMoons(t2)));
      this.computeRotation(b, t2, ms + dt * 1000);
    }
    this.bodies.forEach((b, i) => {
      b.vel.subVectors(b.pos, pos0[i]).divideScalar(dt);
      // ω from the change in orientation: q1 · q0⁻¹ = rotation over dt.
      const dq = b.quat.clone().multiply(quat0[i].clone().invert());
      if (dq.w < 0) { dq.x = -dq.x; dq.y = -dq.y; dq.z = -dq.z; dq.w = -dq.w; }
      const s = Math.sqrt(1 - Math.min(1, dq.w * dq.w));
      const angle = 2 * Math.acos(Math.min(1, dq.w));
      if (s > 1e-12) b.omega.set(dq.x / s, dq.y / s, dq.z / s).multiplyScalar(angle / dt);
      else b.omega.set(0, 0, 0);
      // Restore the state for time ms.
      b.pos.copy(pos0[i]);
      b.quat.copy(quat0[i]);
      b.quatInv.copy(b.quat).invert();
      b.pole.set(0, 1, 0).applyQuaternion(b.quat);
    });
  }

  /** Sphere-of-influence radii (Laplace): r = a · (m / M)^(2/5). */
  computeSOIs() {
    for (const b of this.bodies) {
      if (!b.parent) { b.soi = Infinity; continue; }
      const a = b.pos.distanceTo(b.parent.pos);
      const soi = a * Math.pow(b.GM / b.parent.GM, 0.4);
      // Small moons get a minimum bubble so their own gravity applies near them.
      b.soi = Math.max(soi, b.maxRadius * 4);
    }
  }

  /** Deepest body whose sphere of influence contains the world point. */
  dominantBody(worldPos) {
    let best = this.sun;
    let changed = true;
    while (changed) {
      changed = false;
      for (const c of best.children) {
        if (c.pos.distanceTo(worldPos) < c.soi) {
          best = c;
          changed = true;
          break;
        }
      }
    }
    return best;
  }
}

function depth(b) {
  let d = 0;
  for (let p = b.parent; p; p = p.parent) d++;
  return d;
}
