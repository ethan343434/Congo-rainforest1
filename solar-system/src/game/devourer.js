// =============================================================================
// devourer.js — an optional cosmic giant that eats the worlds.
//
// Switched on from the pause menu, the Devourer works through the Solar
// System from Mercury outwards (each planet's moons first, then the planet),
// shrinking each world into a glowing stream. It then dives into the black
// hole, eats Proxima's planets, and finally hunts the player. Standing on (or
// right next to) a world while it is eaten kills you; so does being caught.
//
// It is a physical body in the simulation: it flies through space at a
// steady speed (about 40 c) from world to world, it has gravity, flying into
// it destroys the ship, and it can be targeted, scanned, warped to and seen
// from afar as a reddish point of light.
//
// Progress is one clock (seconds of play while it is switched on), saved in
// the browser so it carries across visits and between the two star systems.
// =============================================================================
import * as THREE from 'three';
import { BODIES, NAV_ORDER } from '../data/bodies.js';
import { PROXIMA_BODIES } from '../data/proxima.js';
import { AU, C_LIGHT, formatDistance } from '../constants.js';

const STORE = 'solv-devourer';
const TIMES = { planetEat: 60, moonEat: 20, minPlanetTravel: 15, minMoonTravel: 8, arrive: 10 };
const SPEED = 0.08 * AU;          // m/s of the clock: about 40 c between worlds
// Mean distances from the star (AU), for travel times between planetary systems.
const ORBIT_AU = { mercury: 0.387, venus: 0.723, earth: 1, mars: 1.524, jupiter: 5.203, saturn: 9.537, uranus: 19.19, neptune: 30.07, pluto: 39.5, blackhole: 54.5, proxd: 0.0289, proxb: 0.0486 };
const HUNT_SPEED = 60 * C_LIGHT;  // the pulse drive (up to 2,400 c) can outrun it
const BASE_SIZE = 2.5e7;          // m: its height beside a small world
const BODY_FRACTION = 0.3;        // radius of its solid core as a fraction of its height
const SURFACE_G = 20;             // m/s² at its core's surface (about 2 g)

/** The Devourer as a body in the ephemeris; its position is set by this module. */
export const DEVOURER_DEF = {
  id: 'devourer',
  name: 'The Devourer',
  kind: 'devourer',
  parent: 'sun',
  radius: BASE_SIZE * BODY_FRACTION,
  GM: SURFACE_G * (BASE_SIZE * BODY_FRACTION) ** 2,
  ephem: { type: 'external' },
  rotation: { type: 'none' },
  visual: { pointColor: '#ff7a45', magnitude: 0.5 },
  stats: { type: 'Cosmic world-eater', day: '—', temp: 'Unknown' },
  survivability: {
    rating: 'Lethal',
    summary: 'A giant that eats whole worlds. Its gravity pulls at your ship and touching it destroys you.',
    hazards: ['Eats the world you are on, and you with it', 'Hunts the last survivor once every world is gone', 'Crashing into it destroys the ship'],
  },
  facts: [
    'It eats each planet\'s moons first, then the planet, working outward from the star.',
    'It travels between worlds at about 40 times the speed of light. The pulse drive is faster.',
    'Its height grows with its meal: three and a half times the radius of the world it is eating.',
  ],
};
/** The whole meal, in order, with start and end times on the Devourer's clock. */
function buildPlan() {
  const steps = [];
  // Where each target sits: its planetary system's distance from the star,
  // and (for a moon) its distance from the planet.
  const where = (def) => def.kind === 'moon' ? { sys: def.parent, r: ORBIT_AU[def.parent] * AU, a: def.ephem.a || 4e8 } : { sys: def.id, r: ORBIT_AU[def.id] * AU, a: 0 };
  let last = null; // where it came from
  const eat = (def, system) => {
    const moon = def.kind === 'moon';
    const w = where(def);
    const dist = !last ? 0.25 * AU : last.sys === w.sys ? Math.abs(last.a - w.a) : Math.abs(last.r - w.r) + w.a;
    const travel = Math.max(moon ? TIMES.minMoonTravel : TIMES.minPlanetTravel, dist / SPEED);
    steps.push({ kind: 'eat', id: def.id, name: def.name, system, radius: def.radius, travel, eat: moon ? TIMES.moonEat : TIMES.planetEat });
    last = w;
  };
  for (const id of NAV_ORDER) {
    const def = BODIES.find((b) => b.id === id);
    if (!def || id === 'sun' || def.kind === 'blackhole') continue;
    BODIES.filter((b) => b.parent === id).sort((p, q) => (p.ephem.a ?? 0) - (q.ephem.a ?? 0)).forEach((m) => eat(m, 'sol'));
    eat(def, 'sol');
  }
  steps.push({ kind: 'transit', system: 'sol', duration: Math.max(20, ((ORBIT_AU.blackhole - ORBIT_AU.pluto) * AU) / SPEED) });
  steps.push({ kind: 'arrive', system: 'proxima', duration: TIMES.arrive });
  last = null;
  PROXIMA_BODIES.filter((b) => b.kind === 'planet').sort((p, q) => p.ephem.a - q.ephem.a).forEach((p) => eat(p, 'proxima'));
  let t = 0;
  for (const s of steps) {
    s.start = t;
    t += s.kind === 'eat' ? s.travel + s.eat : s.duration;
    s.end = t;
  }
  return { steps, huntAt: t };
}
const PLAN = buildPlan();
const SYSTEM_NAME = { sol: 'the Solar System', proxima: 'Proxima Centauri' };

const smooth = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const clockText = (s) => { const t = Math.ceil(Math.max(0, s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const sizeFor = (radius) => Math.max(BASE_SIZE, 3.5 * radius);

export class Devourer {
  constructor(game) {
    this.game = game;
    this.eph = game.eph;
    this.sysId = game.sys.id;
    this.on = false;
    this.clock = 0;
    try {
      const s = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (s) { this.on = !!s.on; this.clock = Math.max(0, +s.clock || 0); }
    } catch (e) { /* defaults */ }
    this.pos = new THREE.Vector3();   // world position (m)
    this.size = BASE_SIZE;
    this.here = false;                // in this star system and visible
    this.huntPos = null;
    this.lastKey = this.stateKey();
    this.saveTimer = 0;

    this.model = buildModel();
    this.model.root.visible = false;
    game.engine.scene.add(this.model.root);
    this.stream = buildStream();
    game.engine.scene.add(this.stream.points);

    // Its body in the simulation (gravity, collisions, targeting, compass).
    this.body = this.eph.byId.devourer || null;
    this.status = '';
    this.sync(0);
  }

  // ---- Switch, reset, saving ---------------------------------------------------
  setOn(on) {
    this.on = on;
    this.lastKey = this.stateKey();
    this.save();
    this.sync(0);
  }

  reset() {
    this.clock = 0;
    this.huntPos = null;
    this.lastKey = this.stateKey();
    this.save();
    this.sync(0);
  }

  save() {
    try { localStorage.setItem(STORE, JSON.stringify({ on: this.on, clock: Math.round(this.clock * 10) / 10 })); } catch (e) { /* not saved */ }
  }

  /** The plan step at the current clock (null once it is hunting). */
  step() {
    for (const s of PLAN.steps) if (this.clock < s.end) return s;
    return null;
  }

  stateKey() {
    if (!this.on) return 'off';
    const s = this.step();
    if (!s) return 'hunt';
    if (s.kind !== 'eat') return s.kind;
    return `${s.id}:${this.clock < s.start + s.travel ? 'travel' : 'eat'}`;
  }

  // ---- Per frame ----------------------------------------------------------------
  /**
   * Advance the clock while playing, shrink and remove eaten worlds, move the
   * giant. Called right after the ephemeris each frame, before the ship moves.
   */
  update(dt) {
    const g = this.game;
    const playing = g.state === 'play';
    if (this.on && playing) {
      this.clock += dt;
      this.saveTimer += dt;
      if (this.saveTimer > 2) { this.saveTimer = 0; this.save(); }
    }
    this.sync(dt);
  }

  /** Messages, warnings and deaths; after the ship has moved this frame. */
  updateDanger(dt) {
    const g = this.game;
    if (!this.on) return;
    const playing = g.state === 'play';
    this.announce();
    if (playing) this.checkDanger(dt);
  }

  /** Worlds' eaten state, the Devourer's position, and its body in the simulation. */
  sync(dt) {
    this.place();
    const b = this.body;
    if (!b) return;
    const present = this.on && this.here && this.size > 1;
    b.devourerOn = this.on;
    b.eaten = !present; // absent: no gravity, no collisions, hidden from the compass and markers
    if (!present) {
      b.vel.set(0, 0, 0);
      this.wasPresent = false;
      return;
    }
    if (this.wasPresent && dt > 0) b.vel.subVectors(this.pos, b.pos).divideScalar(dt);
    else b.vel.set(0, 0, 0);
    this.wasPresent = true;
    b.pos.copy(this.pos);
    const R = this.size * BODY_FRACTION;
    b.radius = R;
    b.maxRadius = R;
    b.axes.setScalar(R);
    b.GM = SURFACE_G * R * R;
  }

  /** Where the Devourer is and how big, for the current clock. */
  place() {
    const clock = this.on ? this.clock : 0;
    for (const s of PLAN.steps) {
      if (s.kind !== 'eat') continue;
      const b = this.eph.byId[s.id];
      if (!b) continue;
      const eatStart = s.start + s.travel;
      b.eaten = clock >= s.end || !!b.engulfed || !!b.destroyed; // (the Sun's death or the beam can take it too)
      b.eatScale = b.eaten ? 0 : clock > eatStart ? 1 - smooth((clock - eatStart) / s.eat) : 1;
    }
    this.here = false;
    this.eating = null;
    if (!this.on) return;
    const s = this.step();
    if (!s) return this.placeHunter();
    if (s.system !== this.sysId) return;
    this.here = true;
    if (s.kind === 'transit') {
      // Through the black hole: shrink into it at the end.
      const prev = this.lastEatIn('sol');
      const from = prev ? this.eatSpot(this.eph.byId[prev.id], sizeFor(prev.radius)) : this.entryPoint();
      const bh = this.eph.byId.blackhole;
      const u = (this.clock - s.start) / s.duration;
      this.pos.lerpVectors(from, bh ? bh.pos : from, smooth(u));
      this.size = (prev ? sizeFor(prev.radius) : BASE_SIZE) * (1 - smooth((u - 0.75) / 0.25));
      this.face = bh ? bh.pos : null;
      return;
    }
    if (s.kind === 'arrive') {
      const u = (this.clock - s.start) / s.duration;
      this.pos.copy(this.entryPoint());
      this.size = BASE_SIZE * smooth(u);
      this.face = this.eph.sun.pos;
      return;
    }
    const b = this.eph.byId[s.id];
    const size = sizeFor(s.radius);
    const spot = this.eatSpot(b, size);
    const t = this.clock - s.start;
    if (t < s.travel) {
      const i = PLAN.steps.indexOf(s);
      const prev = PLAN.steps[i - 1];
      const fromBody = prev?.kind === 'eat' && prev.system === this.sysId ? prev : null;
      const from = fromBody ? this.eatSpot(this.eph.byId[fromBody.id], sizeFor(fromBody.radius)) : this.entryPoint();
      const u = smooth(t / s.travel);
      this.pos.lerpVectors(from, spot, u);
      this.size = (fromBody ? sizeFor(fromBody.radius) : BASE_SIZE) * (1 - u) + size * u;
    } else {
      this.pos.copy(spot);
      this.size = size;
      this.eating = b;
    }
    this.face = b.pos;
  }

  lastEatIn(system) {
    let last = null;
    for (const s of PLAN.steps) if (s.kind === 'eat' && s.system === system) last = s;
    return last;
  }

  /** Where it stands while eating a world: beside it, on its sunlit flank. */
  eatSpot(b, size) {
    const toSun = this.eph.sun.pos.clone().sub(b.pos).normalize();
    const side = new THREE.Vector3().crossVectors(b.pole, toSun);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize().multiplyScalar(0.8).addScaledVector(toSun, 0.6).normalize();
    return b.pos.clone().addScaledVector(side, b.radius + size * 0.45);
  }

  /** Where it first appears in a system: high above the first world it will eat. */
  entryPoint() {
    const first = PLAN.steps.find((s) => s.kind === 'eat' && s.system === this.sysId);
    const b = first && this.eph.byId[first.id];
    const base = b ? b.pos : this.eph.sun.pos;
    return base.clone().add(new THREE.Vector3(0, this.sysId === 'sol' ? 0.25 * AU : 0.05 * AU, 0));
  }

  /** Hunting: it comes for you, wherever you are. */
  placeHunter() {
    const g = this.game;
    this.here = true;
    this.size = 6e7;
    this.eating = null;
    const player = g.playerWorld;
    if (!this.huntPos) this.spawnHunter();
    this.pos.copy(this.huntPos);
    this.face = player;
  }

  spawnHunter() {
    const dir = new THREE.Vector3(Math.random() - 0.5, (Math.random() - 0.5) * 0.3, Math.random() - 0.5).normalize();
    this.huntPos = this.game.playerWorld.clone().addScaledVector(dir, 2 * AU);
  }

  /** After a respawn the hunt starts again from a distance. */
  onRespawn() {
    if (this.on && !this.step()) this.spawnHunter();
  }

  // ---- Messages, danger and death -------------------------------------------------
  announce() {
    const key = this.stateKey();
    if (key === this.lastKey) return;
    this.lastKey = key;
    const g = this.game, s = this.step();
    const toast = (title, body, kind = 'warn', secs = 6) => g.hud.toast(title, body, kind, secs);
    if (!s) {
      toast('The Devourer hunts you', 'Every world is gone. Now it is coming for you: run, and keep running.', 'warn', 9);
      g.audio.play('growl');
      return;
    }
    if (s.kind === 'transit' && this.sysId === 'sol') toast('The Devourer leaves', 'Every world here is gone. It is diving into the black hole, towards Proxima Centauri.', 'warn', 8);
    if (s.kind === 'arrive' && this.sysId === 'proxima') { toast('The Devourer is here', 'It came through the black hole after you.', 'warn', 8); g.audio.play('growl'); }
    if (s.kind !== 'eat' || s.system !== this.sysId) return;
    const eating = this.clock >= s.start + s.travel;
    if (eating) { toast(`The Devourer is eating ${s.name}`, 'Anyone on it, or near it, goes with it.', 'warn', 6); g.audio.play('growl'); }
    else toast(`The Devourer is coming for ${s.name}`, `It starts eating in ${clockText(s.start + s.travel - this.clock)}.`, 'warn', 5);
    const i = PLAN.steps.indexOf(s);
    const prev = PLAN.steps[i - 1];
    if (!eating && prev?.kind === 'eat' && prev.system === this.sysId) toast(`${prev.name} is gone`, 'Nothing is left of it.', '', 5);
  }

  checkDanger(dt) {
    const g = this.game;
    if (!this.here) return;
    const P = g.playerWorld;
    const s = this.step();
    if (!s) {
      // Hunting: close in on the player.
      const to = P.clone().sub(this.huntPos);
      const d = to.length();
      const stepLen = Math.min(d, HUNT_SPEED * dt);
      if (d > 0) this.huntPos.addScaledVector(to, stepLen / d);
      this.pos.copy(this.huntPos);
      const gap = Math.max(0, d - stepLen);
      if (gap < this.size * BODY_FRACTION * 1.2) { g.die('Devoured', 'The Devourer caught you.'); return; }
      if (gap < 0.5 * AU) g.warnings.unshift({ level: 'danger', text: `The Devourer is ${formatDistance(gap)} away: run!` });
      return;
    }
    if (s.kind !== 'eat') return;
    const b = this.eph.byId[s.id];
    if (!b) return;
    const near = P.distanceTo(b.pos) < b.radius * 2.5;
    if (this.eating === b && near) {
      g.die('Devoured', `You were on ${b.name} when the Devourer ate it.`);
    } else if (near) {
      g.warnings.unshift({ level: 'danger', text: `The Devourer is coming for ${b.name}: leave! ${clockText(s.start + s.travel - this.clock)}` });
    }
  }

  // ---- Drawing ----------------------------------------------------------------------
  render(origin, time) {
    const m = this.model;
    const show = this.on && this.here && this.size > 1;
    m.root.visible = show;
    this.stream.points.visible = false;
    if (!show) return;
    m.root.position.subVectors(this.pos, origin);
    // Seen from afar it is a point of light (fading out as its shape appears).
    if (this.body) this.body.apparentPx = (this.size * 0.5 / Math.max(1, m.root.position.length())) * this.game.engine.pixelScale;
    m.root.scale.setScalar(this.size);
    if (this.face) m.root.lookAt(m.root.position.clone().add(this.face.clone().sub(this.pos)));
    m.eyes.material.emissiveIntensity = 3 + Math.sin(time * 2.3) * 0.8;
    m.halo.rotation.z = time * 0.05;
    // The feeding stream: a world pouring into the maw.
    const b = this.eating;
    if (!b) return;
    const st = this.stream;
    st.points.visible = true;
    const maw = m.maw.getWorldPosition(new THREE.Vector3()); // camera-relative
    const center = b.pos.clone().sub(origin);
    const dir = maw.clone().sub(center).normalize();
    const r = b.radius * Math.max(0.05, b.eatScale ?? 1);
    const start = center.clone().addScaledVector(dir, r);
    const P = st.positions;
    for (let i = 0; i < st.count; i++) {
      const u = (st.phase[i] + time * 0.18) % 1;
      const k = i * 3;
      const spread = (1 - u) * r * 0.9;
      P[k] = start.x + (maw.x - start.x) * u + st.jitter[k] * spread;
      P[k + 1] = start.y + (maw.y - start.y) * u + st.jitter[k + 1] * spread;
      P[k + 2] = start.z + (maw.z - start.z) * u + st.jitter[k + 2] * spread;
    }
    st.geometry.attributes.position.needsUpdate = true;
  }

  /** Its status under its name in the compass (the compass row itself is the HUD's). */
  updateHud() {
    if (!this.on) return;
    const s = this.step();
    let text;
    if (!s) text = 'hunting you';
    else if (s.system !== this.sysId) text = s.kind === 'eat' ? `in ${SYSTEM_NAME[s.system]} · eating ${s.name}` : `heading for ${SYSTEM_NAME[s.system]}`;
    else if (s.kind === 'transit') text = 'diving into the black hole';
    else if (s.kind === 'arrive') text = 'coming through';
    else if (this.eating) text = `eating ${s.name} · ${clockText(s.end - this.clock)}`;
    else text = `→ ${s.name} · ${clockText(s.start + s.travel - this.clock)}`;
    if (text === this.status) return;
    this.status = text;
    const row = this.game.hud.rows.get('devourer');
    if (row) row.li.querySelector('.name').innerHTML = `The Devourer<small>${text}</small>`;
  }
}

// ---- The giant: an original design built from simple shapes (height 1, facing +z) ----------
function buildModel() {
  const root = new THREE.Group();
  root.name = 'devourer';
  const skin = new THREE.MeshStandardMaterial({ color: 0x1d1429, roughness: 0.85, metalness: 0.2, emissive: 0x2a1245, emissiveIntensity: 1.2 });
  const ember = new THREE.MeshStandardMaterial({ color: 0x2a0d06, emissive: 0xff6a1a, emissiveIntensity: 2.2 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xfff0c0, emissiveIntensity: 3 });
  const haloMat = new THREE.MeshBasicMaterial({ color: 0xb69cff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    root.add(m);
    return m;
  };
  add(new THREE.ConeGeometry(0.3, 0.62, 28, 1, true), skin, 0, -0.19, 0);               // flowing robe
  add(new THREE.CylinderGeometry(0.15, 0.23, 0.3, 24), skin, 0, 0.21, 0);               // torso
  add(new THREE.SphereGeometry(0.17, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), skin, 0, 0.37, -0.01); // shoulders
  add(new THREE.SphereGeometry(0.085, 24, 16), skin, 0, 0.47, 0.01);                    // head
  add(new THREE.ConeGeometry(0.11, 0.2, 24, 1, true), skin, 0, 0.52, -0.01);            // hood
  const eyes = new THREE.Group();
  for (const x of [-0.03, 0.03]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), eyeMat);
    eye.position.set(x, 0.475, 0.08);
    eyes.add(eye);
  }
  root.add(eyes);
  const maw = add(new THREE.TorusGeometry(0.055, 0.016, 12, 32), ember, 0, 0.22, 0.17);  // glowing maw in the chest
  add(new THREE.CircleGeometry(0.05, 24), ember, 0, 0.22, 0.168);
  for (const side of [-1, 1]) {
    // Long arms reaching forward, with ember-lit claws.
    add(new THREE.CylinderGeometry(0.035, 0.05, 0.42, 12), skin, side * 0.22, 0.24, 0.16, Math.PI / 2.6, 0, side * 0.35);
    add(new THREE.SphereGeometry(0.05, 14, 10), ember, side * 0.17, 0.12, 0.36);
  }
  const halo = add(new THREE.TorusGeometry(0.2, 0.005, 8, 96), haloMat, 0, 0.46, -0.09);
  return { root, maw, halo, eyes: { material: eyeMat } };
}

function buildStream() {
  const count = 600;
  const positions = new Float32Array(count * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({
    color: 0xffb070, size: 3, sizeAttenuation: false, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  points.frustumCulled = false;
  points.visible = false;
  points.renderOrder = 8;
  const phase = new Float32Array(count), jitter = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    phase[i] = Math.random();
    const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(Math.random());
    jitter[i * 3] = v.x; jitter[i * 3 + 1] = v.y; jitter[i * 3 + 2] = v.z;
  }
  return { points, geometry, positions, phase, jitter, count };
}

/** Test hook: the plan (for tools and tests). */
export const DEVOURER_PLAN = PLAN;
