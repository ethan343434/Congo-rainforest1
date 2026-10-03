// =============================================================================
// proximaLife.js — the living surface of Proxima b (imagined for the game).
//
// Proxima b is tidally locked, so where you are decides what lives there:
//   * scorch (under the star) and desert (day side): dune claws, armoured
//     scorpion-like hunters. Hostile.
//   * twilight ring: lumen grazers (big, gentle, glowing herbivores) and sky
//     jellies drifting overhead. Friendly. Black-violet "lamp trees", ferns.
//   * night side: night stalkers, lean predators with glowing eyes. Hostile.
//     Ice crystals.
// Also here: supply crates with a laser rifle, energy cells and med kits.
//
// Everything is placed from deterministic hashes on a grid over the planet,
// so the same herd, tree or crate is always in the same spot. Positions live in
// the planet's rotating frame and are drawn relative to the camera.
// =============================================================================
import * as THREE from 'three';
import { dirToFace, faceDir } from '../terrain/chunkBuilder.js';
import { rand3 } from '../terrain/heightfield.js';
import { applyLocalSun, applyLocalSunTree } from '../render/localSun.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

// ---- Biomes ----------------------------------------------------------------------------------
/** Biome for a local unit direction (the star is over local +X). */
export function biomeAt(dir) {
  const x = dir.x + 0.06 * Math.sin(dir.y * 9 + dir.z * 7);
  if (x > 0.72) return 'scorch';
  if (x > 0.3) return 'desert';
  if (x > -0.2) return 'twilight';
  return 'night';
}

// ---- Species --------------------------------------------------------------------------------
export const SPECIES = {
  grazer: {
    name: 'Lumen grazer', friendly: true, blurb: 'Friendly herbivore. Grazes the twilight moss in herds and glows to keep them together.',
    hp: 80, walk: 1.4, run: 6.5, radius: 1.5, height: 2.4,
  },
  jelly: {
    name: 'Sky jelly', friendly: true, blurb: 'Friendly. A gas-filled floater that drifts on the warm wind from the day side.',
    hp: 25, walk: 1.8, run: 5, radius: 1.3, height: 1.6, float: [7, 16],
  },
  duneclaw: {
    name: 'Dune claw', friendly: false, blurb: 'Hostile. An armoured ambush hunter of the hot sand seas. Keep your distance or keep shooting.',
    hp: 90, walk: 1.8, run: 7.2, radius: 1.3, height: 1.2, damage: 14, aggro: 55, reach: 2.6,
  },
  stalker: {
    name: 'Night stalker', friendly: false, blurb: 'Hostile. A fast predator of the frozen dark that hunts by heat. You are warm.',
    hp: 110, walk: 2.2, run: 8.4, radius: 1.1, height: 1.9, damage: 18, aggro: 70, reach: 2.4,
  },
};

const HERDS = {
  // [chance per cell, [[species, weight, min, max], ...]]
  twilight: [0.34, [['grazer', 0.6, 2, 5], ['jelly', 0.32, 2, 4], ['stalker', 0.08, 1, 1]]],
  desert: [0.24, [['duneclaw', 0.7, 1, 2], ['jelly', 0.3, 1, 3]]],
  scorch: [0.14, [['duneclaw', 1, 1, 2]]],
  night: [0.2, [['stalker', 1, 1, 2]]],
};

// ---- Small geometry helpers ------------------------------------------------------------------
function mergeGeometries(list) {
  let vCount = 0, iCount = 0;
  for (const g of list) { vCount += g.attributes.position.count; iCount += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3), idx = new Uint32Array(iCount);
  let vo = 0, io = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    const n = g.attributes.position.count;
    if (g.index) { for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.array[i] + vo; io += g.index.count; }
    else { for (let i = 0; i < n; i++) idx[io + i] = vo + i; io += n; }
    vo += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
const placed = (geo, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
  const g = geo.clone();
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz)));
  return g;
};

// ---- Creature models (origin at the feet, facing +Z) ------------------------------------------
function std(color, extra = {}) { return new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05, ...extra }); }
function glow(color, intensity = 2) { return new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: intensity, roughness: 0.4 }); }

function buildGrazer() {
  const g = new THREE.Group();
  const skin = std(0x2a1838), belly = std(0x4a2a55), lum = glow(0x3ff0d8, 2.4);
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), skin);
  body.scale.set(0.85, 0.7, 1.45); body.position.y = 1.55;
  const under = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), belly);
  under.scale.set(0.7, 0.45, 1.2); under.position.y = 1.3;
  g.add(body, under);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, 1.1, 10), skin);
  neck.position.set(0, 2.0, 1.25); neck.rotation.x = 0.7;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 10), skin);
  head.scale.set(0.8, 0.7, 1.3); head.position.set(0, 2.25, 1.75);
  g.add(neck, head);
  for (const s of [-1, 1]) {
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.6, 6), skin);
    ant.position.set(s * 0.15, 2.6, 1.7); ant.rotation.set(-0.4, 0, s * 0.4);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), lum);
    tip.position.set(s * 0.27, 2.86, 1.6);
    g.add(ant, tip);
  }
  // Glowing spots along the back.
  for (let i = 0; i < 9; i++) {
    const spot = new THREE.Mesh(new THREE.SphereGeometry(0.09 + (i % 3) * 0.02, 8, 6), lum);
    const a = (i / 8 - 0.5) * 2.2;
    spot.position.set(Math.sin(i * 2.4) * 0.45, 2.1 - Math.abs(a) * 0.12, a * 0.8);
    g.add(spot);
  }
  // Six legs.
  const legs = [];
  for (const z of [0.85, 0, -0.85]) {
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.55, 1.35, z);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.12, 1.35, 8), skin);
      leg.position.y = -0.67;
      pivot.add(leg);
      g.add(pivot);
      legs.push({ pivot, phase: (z * 1.7 + (s > 0 ? Math.PI : 0)) });
    }
  }
  return { group: g, legs, body };
}

function buildJelly() {
  const g = new THREE.Group();
  const bellMat = new THREE.MeshStandardMaterial({ color: 0xff7ac8, emissive: 0xff3fa8, emissiveIntensity: 0.8, transparent: true, opacity: 0.72, roughness: 0.3, side: THREE.DoubleSide, depthWrite: false });
  const bell = new THREE.Mesh(new THREE.SphereGeometry(1.3, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), bellMat);
  bell.scale.set(1, 0.8, 1);
  g.add(bell);
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 8), glow(0xffd0f0, 2.2));
  core.position.y = 0.35;
  g.add(core);
  const tentMat = new THREE.MeshStandardMaterial({ color: 0xffb0e0, emissive: 0xff60c0, emissiveIntensity: 0.6, transparent: true, opacity: 0.6, depthWrite: false });
  const legs = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const pivot = new THREE.Group();
    pivot.position.set(Math.cos(a) * 0.8, 0.1, Math.sin(a) * 0.8);
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.01, 3.2, 5), tentMat);
    t.position.y = -1.6;
    pivot.add(t);
    g.add(pivot);
    legs.push({ pivot, phase: a * 2 });
  }
  return { group: g, legs, body: bell };
}

function buildDuneclaw() {
  const g = new THREE.Group();
  const shell = std(0xb2652e, { roughness: 0.55, metalness: 0.15 }), dark = std(0x3a1a10), eye = glow(0xff2a10, 3);
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), shell);
  body.scale.set(0.95, 0.42, 1.25); body.position.y = 0.7;
  g.add(body);
  for (let i = 0; i < 4; i++) {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(1.3 - i * 0.12, 0.08, 0.32), dark);
    plate.position.set(0, 1.05 - i * 0.02, 0.5 - i * 0.38);
    g.add(plate);
  }
  // Tail curling up over the back with a stinger.
  let prev = new THREE.Vector3(0, 0.85, -1.1);
  for (let i = 0; i < 6; i++) {
    const a = (i / 5) * Math.PI * 0.9;
    const p = new THREE.Vector3(0, 0.85 + Math.sin(a) * 1.3, -1.1 - Math.sin(a * 0.5) * 0.9 + (1 - Math.cos(a)) * 0.4);
    const seg = new THREE.Mesh(new THREE.SphereGeometry(0.24 - i * 0.025, 10, 8), i === 5 ? eye : shell);
    seg.position.copy(p);
    g.add(seg);
    prev = p;
  }
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.9, 8), shell);
    arm.position.set(s * 0.75, 0.75, 1.1); arm.rotation.set(1.2, 0, -s * 0.5);
    const claw = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.6, 8), dark);
    claw.position.set(s * 0.95, 0.85, 1.6); claw.rotation.x = Math.PI / 2;
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), eye);
    e.position.set(s * 0.22, 0.95, 1.12);
    g.add(arm, claw, e);
  }
  const legs = [];
  for (const z of [0.6, 0.15, -0.3, -0.75]) {
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.7, 0.7, z);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.0, 6), dark);
      leg.position.set(s * 0.35, -0.3, 0); leg.rotation.z = s * 0.9;
      pivot.add(leg);
      g.add(pivot);
      legs.push({ pivot, phase: z * 3 + (s > 0 ? Math.PI : 0), side: true });
    }
  }
  return { group: g, legs, body };
}

function buildStalker() {
  const g = new THREE.Group();
  const hide = std(0x14161c, { roughness: 0.6 }), eye = glow(0xff2aff, 3.5), stripe = glow(0x8a2bff, 1.2);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.5, 6, 14), hide);
  body.rotation.x = Math.PI / 2; body.position.y = 1.45;
  g.add(body);
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.06), stripe);
    s.position.set(0, 1.62, 0.6 - i * 0.32);
    s.rotation.x = 0.1;
    g.add(s);
  }
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.9, 10), hide);
  head.rotation.x = Math.PI / 2; head.position.set(0, 1.65, 1.45);
  g.add(head);
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), eye);
    e.position.set(s * 0.15, 1.78, 1.32);
    g.add(e);
  }
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.12, 1.6, 8), hide);
  tail.position.set(0, 1.5, -1.4); tail.rotation.x = -1.1;
  g.add(tail);
  const legs = [];
  for (const z of [0.65, -0.65]) {
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.32, 1.35, z);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 1.4, 8), hide);
      leg.position.y = -0.7;
      pivot.add(leg);
      g.add(pivot);
      legs.push({ pivot, phase: z * 2.4 + (s > 0 ? Math.PI : 0) });
    }
  }
  return { group: g, legs, body };
}

const BUILDERS = { grazer: buildGrazer, jelly: buildJelly, duneclaw: buildDuneclaw, stalker: buildStalker };

// ---- Supply crate -----------------------------------------------------------------------------
function buildCrate() {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x3a4048, metalness: 0.7, roughness: 0.4 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xe0702a, metalness: 0.3, roughness: 0.5 });
  const light = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x4fe0ff, emissiveIntensity: 2.5 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 0.75), metal);
  base.position.y = 0.25;
  g.add(base);
  for (const z of [-0.39, 0.39]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.08, 0.02), trim);
    band.position.set(0, 0.32, z);
    g.add(band);
  }
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 0.02), light);
  strip.position.set(0, 0.16, 0.385);
  g.add(strip);
  const lid = new THREE.Group();
  lid.position.set(0, 0.5, -0.375);
  const lidMesh = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.14, 0.77), metal);
  lidMesh.position.set(0, 0.07, 0.385);
  const lidStrip = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.05), light);
  lidStrip.position.set(0, 0.145, 0.385);
  lid.add(lidMesh, lidStrip);
  g.add(lid);
  // Beacon so you can spot it from afar.
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6, 1, true), new THREE.MeshBasicMaterial({ color: 0x4fe0ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
  beacon.position.y = 1.8;
  g.add(beacon);
  g.traverse((o) => { if (o.isMesh && o !== beacon) { o.castShadow = true; o.receiveShadow = true; } });
  applyLocalSunTree(g);
  return { group: g, lid, beacon, strip };
}

// ---- Laser rifle (held by the astronaut) ----------------------------------------------------
export function buildRifle() {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x2b3038, metalness: 0.8, roughness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xe0702a, metalness: 0.4, roughness: 0.45 });
  const glowMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x4fe0ff, emissiveIntensity: 3 });
  // Built along −Y (the forearm's direction when the arm is raised to aim).
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.42, 0.13), body);
  receiver.position.set(0, -0.32, 0.02);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.4, 10), body);
  barrel.position.set(0, -0.72, 0.03);
  const coil = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.18, 10), glowMat);
  coil.position.set(0, -0.6, 0.03);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.08), accent);
  stock.position.set(0, -0.08, -0.04);
  g.add(receiver, barrel, coil, stock);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, -0.94, 0.03);
  g.add(muzzle);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  applyLocalSunTree(g);
  return { group: g, muzzle, coil: glowMat };
}

// ---- Flora (instanced) ------------------------------------------------------------------------
function floraGeometries() {
  const trunk = placed(new THREE.CylinderGeometry(0.06, 0.16, 1, 7), 0, 0.5, 0);
  const bulbs = mergeGeometries([0, 1, 2, 3, 4, 5].map((i) => {
    const a = i * 1.1;
    return placed(new THREE.SphereGeometry(0.16 + (i % 3) * 0.05, 10, 8), Math.cos(a) * 0.3, (i % 2) * 0.12, Math.sin(a) * 0.3);
  }));
  const fern = mergeGeometries([0, 1, 2, 3, 4, 5, 6].map((i) => {
    const a = (i / 7) * Math.PI * 2;
    return placed(new THREE.ConeGeometry(0.16, 1.1, 4), Math.cos(a) * 0.2, 0.45, Math.sin(a) * 0.2, Math.cos(a) * 0.55, 0, -Math.sin(a) * 0.55, 1, 1, 0.25);
  }));
  const crystal = mergeGeometries([0, 1, 2].map((i) => placed(new THREE.OctahedronGeometry(0.3, 0), (i - 1) * 0.25, 0.6 + i * 0.1, (i % 2) * 0.2, 0.2 * i, i, 0.15 * (i - 1), 0.7, 2.6 - i * 0.5, 0.7)));
  return { trunk, bulbs, fern, crystal };
}

const FLORA_CELL = 3.2;   // m
const FLORA_RANGE = 34;   // cells (~110 m)

// =============================================================================
export class ProximaLife {
  /** game: the Game (for terrain, suit, audio, HUD, walker, astronaut). */
  constructor(game, body) {
    this.game = game;
    this.body = body;
    this.group = new THREE.Group();
    this.group.name = 'proxima-life';
    game.engine.scene.add(this.group);
    this.cells = new Map();        // herd cells → creatures
    this.creatures = [];
    this.dead = new Set();
    this.discovered = new Set();
    this.crates = new Map();       // id → crate
    this.opened = new Set();
    this.weapon = { has: false, energy: 100, lastShot: -9, lastUse: -9 };
    this.beams = [];
    this.time = 0;
    this.grace = 0;
    this.dropPlaced = false;
    this.seed = 0x51a7;
    this.cellSize = 160;
    this.crateCell = 420;
    this.R = body.radius;

    // Flora.
    const fg = floraGeometries();
    const mk = (geo, mat, max) => {
      const m = new THREE.InstancedMesh(geo, mat, max);
      m.count = 0; m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true;
      return m;
    };
    this.floraAnchor = new THREE.Group();
    this.group.add(this.floraAnchor);
    const trunkMat = applyLocalSun(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }));
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const fernMat = applyLocalSun(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide }));
    const crystalMat = applyLocalSun(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.15, metalness: 0.1, emissive: 0x2a4a7a, emissiveIntensity: 0.6, transparent: true, opacity: 0.85 }));
    this.flora = {
      trunk: mk(fg.trunk, trunkMat, 900),
      bulbs: mk(fg.bulbs, bulbMat, 900),
      fern: mk(fg.fern, fernMat, 3500),
      crystal: mk(fg.crystal, crystalMat, 1600),
    };
    this.flora.bulbs.castShadow = false;
    for (const m of Object.values(this.flora)) this.floraAnchor.add(m);
    this.floraCells = new Map();
    this.floraKey = '';
    this.floraDirty = true;

    // Laser effects.
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0x8ff6ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    this.beamGlowMat = new THREE.MeshBasicMaterial({ color: 0x2ab8ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
    this.beamGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
    this.flashMat = new THREE.MeshBasicMaterial({ color: 0xbff8ff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    this.flashGeo = new THREE.SphereGeometry(1, 12, 8);

    // Rifle for the astronaut's right hand.
    this.rifle = buildRifle();
    this.rifle.group.visible = false;
    const hand = game.astro.arms.find((a) => a.side > 0);
    hand.elbow.add(this.rifle.group);
  }

  get armed() { return this.weapon.has; }

  terrain() { return this.game.terrainFor(this.body); }

  /** Local position → camera-relative render position. */
  toRender(local, out) {
    return out.copy(local).applyQuaternion(this.body.quat).add(this.body.pos).sub(this.game.camWorld);
  }

  groundAt(dir) {
    const t = this.terrain();
    return t ? t.surfaceRadius(dir) : this.body.surfaceRadiusLocal(dir);
  }

  /** Player position in the planet frame and whether they are on foot here. */
  player() {
    const g = this.game;
    if (g.onFoot && g.walker.body === this.body) return { pos: g.walker.pos, onFoot: true };
    if (g.ship.parent !== this.body) return null;
    return { pos: this.body.toLocal(g.ship.rel.clone()), onFoot: false };
  }

  // ---- Per-frame -------------------------------------------------------------------------
  update(dt) {
    this.time += dt;
    const g = this.game;
    const body = this.body;
    this.group.position.subVectors(body.pos, g.camWorld);
    this.group.quaternion.copy(body.quat);
    const p = this.player();
    const t = this.terrain();
    const active = !!(p && t && (p.pos.length() - this.R) < 25e3);
    this.group.visible = active;
    if (!active) { this.updateBeams(dt); return; }
    const up = p.pos.clone().normalize();
    const alt = p.pos.length() - this.groundAt(up);
    this.updateHerds(p, alt);
    this.updateCrates(p);
    for (const c of this.creatures) this.updateCreature(c, dt, p);
    this.updateFlora(p, alt);
    this.updateRifle(dt);
    this.updateBeams(dt);
    this.updateAim();
  }

  // ---- Herds --------------------------------------------------------------------------------
  cellCoords(local, size) {
    const d = local.clone().normalize();
    const f = dirToFace(d.x, d.y, d.z);
    const n = Math.round((this.R * Math.PI * 0.5) / size);
    return { face: f.face, i: Math.floor(((f.s + 1) / 2) * n), j: Math.floor(((f.t + 1) / 2) * n), n };
  }

  cellCenter(face, i, j, n, jx = 0.5, jy = 0.5) {
    const d = faceDir(face, -1 + ((i + jx) / n) * 2, -1 + ((j + jy) / n) * 2, [0, 0, 0]);
    return new THREE.Vector3(d[0], d[1], d[2]);
  }

  updateHerds(p, alt) {
    if (alt > 3000) return;
    const c = this.cellCoords(p.pos, this.cellSize);
    const key = `${c.face}:${c.i}:${c.j}`;
    if (key === this.herdKey) return;
    this.herdKey = key;
    const keep = new Set();
    const R = 3;
    for (let dj = -R; dj <= R; dj++) {
      for (let di = -R; di <= R; di++) {
        const i = c.i + di, j = c.j + dj;
        if (i < 0 || j < 0 || i >= c.n || j >= c.n) continue;
        const k = `${c.face}:${i}:${j}`;
        keep.add(k);
        if (!this.cells.has(k)) this.cells.set(k, this.spawnCell(c.face, i, j, c.n, k));
      }
    }
    for (const [k, list] of this.cells) {
      if (keep.has(k)) continue;
      for (const cr of list) { this.group.remove(cr.group); }
      this.cells.delete(k);
    }
    this.creatures = [...this.cells.values()].flat();
  }

  spawnCell(face, i, j, n, key) {
    const s = this.seed + face * 7919;
    const center = this.cellCenter(face, i, j, n, rand3(i, j, 1, s), rand3(i, j, 2, s));
    const biome = biomeAt(center);
    const [chance, options] = HERDS[biome];
    if (rand3(i, j, 3, s) > chance) return [];
    let r = rand3(i, j, 4, s), pick = options[0];
    for (const o of options) { if (r < o[1]) { pick = o; break; } r -= o[1]; }
    const [species, , min, max] = pick;
    const count = min + Math.floor(rand3(i, j, 5, s) * (max - min + 1));
    const list = [];
    for (let k = 0; k < count; k++) {
      const id = `${key}:${k}`;
      if (this.dead.has(id)) continue;
      // Scatter the herd within ~25 m of the cell's centre.
      const a = rand3(i, j, 10 + k, s) * Math.PI * 2, dist = 4 + rand3(i, j, 20 + k, s) * 22;
      const east = new THREE.Vector3().crossVectors(UP, center).normalize();
      if (east.lengthSq() < 0.5) east.set(1, 0, 0);
      const north = new THREE.Vector3().crossVectors(center, east).normalize();
      const dir = center.clone().addScaledVector(east, (Math.cos(a) * dist) / this.R).addScaledVector(north, (Math.sin(a) * dist) / this.R).normalize();
      list.push(this.makeCreature(species, id, dir, rand3(i, j, 30 + k, s)));
    }
    return list;
  }

  makeCreature(species, id, dir, r) {
    const sp = SPECIES[species];
    const model = BUILDERS[species]();
    applyLocalSunTree(model.group);
    model.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const scale = 0.85 + r * 0.35;
    model.group.scale.setScalar(scale);
    this.group.add(model.group);
    const pos = dir.clone().multiplyScalar(this.groundAt(dir));
    const heading = new THREE.Vector3().crossVectors(dir, UP).normalize();
    if (heading.lengthSq() < 0.5) heading.set(0, 0, 1);
    heading.applyAxisAngle(dir, r * 6.28);
    return {
      id, species, sp, model, group: model.group, scale,
      home: pos.clone(), pos, heading, speed: 0, hp: sp.hp, state: 'wander',
      timer: r * 4, phase: r * 10, attackCd: 0, deadT: 0, hover: sp.float ? sp.float[0] + r * (sp.float[1] - sp.float[0]) : 0,
      fleeT: 0, angry: 0,
    };
  }

  updateCreature(c, dt, p) {
    const sp = c.sp;
    const up = _v.copy(c.pos).normalize().clone();
    if (c.state === 'dead') {
      c.deadT += dt;
      this.orient(c, up, c.deadT);
      if (c.deadT > 12) c.group.visible = false;
      return;
    }
    // Where is the player, along the ground?
    const toP = p.pos.clone().sub(c.pos);
    const distP = toP.length();
    const flatP = toP.clone().addScaledVector(up, -toP.dot(up));
    const flatDist = flatP.length();
    let want = null, speed = sp.walk;
    if (!this.discovered.has(c.species) && distP < 90) {
      this.discovered.add(c.species);
      this.game.hud.toast(`Lifeform: ${sp.name}`, sp.blurb, sp.friendly ? 'discovery' : 'warn', 8);
      this.game.audio.play(sp.friendly ? 'chime' : 'growl');
    }
    if (!sp.friendly) {
      const hunting = p.onFoot && this.grace <= 0 && (distP < sp.aggro || (c.angry > 0 && distP < 160));
      if (hunting) {
        c.state = 'chase';
        want = flatP.normalize();
        speed = sp.run;
        if (distP < sp.reach * c.scale + 0.6) {
          speed = 0;
          c.attackCd -= dt;
          if (c.attackCd <= 0) {
            c.attackCd = 1.3;
            this.game.suit.harm(sp.damage, `Killed by a ${sp.name.toLowerCase()} on Proxima b.`, this.game.playTime);
            this.game.damageFlash = 1;
            this.game.audio.play('growl');
            this.game.audio.play('hurt');
          }
        }
      } else if (c.state === 'chase') c.state = 'wander';
      c.angry = Math.max(0, c.angry - dt);
    } else {
      c.fleeT = Math.max(0, c.fleeT - dt);
      if (c.fleeT > 0) {
        want = flatP.normalize().negate();
        speed = sp.run;
      } else if (p.onFoot && distP < 7 && !sp.float) {
        // Curious: stop and look at you.
        want = flatP.normalize();
        speed = 0;
      }
    }
    if (!want) {
      // Wander, drifting back towards home.
      c.timer -= dt;
      if (c.timer <= 0) {
        c.timer = 3 + Math.random() * 6;
        c.heading.applyAxisAngle(up, (Math.random() - 0.5) * 2.4);
        c.pause = Math.random() < 0.35;
      }
      const toHome = c.home.clone().sub(c.pos);
      if (toHome.length() > 45) c.heading.lerp(toHome.addScaledVector(up, -toHome.dot(up)).normalize(), 0.05);
      want = c.heading.clone();
      speed = c.pause ? 0 : sp.walk;
    }
    // Turn towards the wanted heading and move.
    want.addScaledVector(up, -want.dot(up));
    if (want.lengthSq() > 1e-6) c.heading.lerp(want.normalize(), Math.min(1, dt * 3)).normalize();
    c.heading.addScaledVector(up, -c.heading.dot(up)).normalize();
    c.speed += (speed - c.speed) * Math.min(1, dt * 3);
    c.pos.addScaledVector(c.heading, c.speed * dt);
    const dir = c.pos.clone().normalize();
    const ground = this.groundAt(dir);
    c.pos.copy(dir).multiplyScalar(ground + (c.hover ? c.hover + Math.sin(this.time * 0.7 + c.phase) * 0.8 : 0));
    c.phase += dt * (1.5 + c.speed * 2.2);
    this.orient(c, dir, 0);
    // Legs.
    const swing = Math.min(1, c.speed / Math.max(sp.walk, 0.1)) * 0.5 + (sp.float ? 0.25 : 0);
    for (const l of c.model.legs) {
      const a = Math.sin(c.phase + l.phase) * swing;
      if (l.side) l.pivot.rotation.y = a * 0.6; else l.pivot.rotation.x = a;
    }
    if (sp.float) c.model.body.scale.set(1 + Math.sin(this.time * 2 + c.phase) * 0.06, 0.8 - Math.sin(this.time * 2 + c.phase) * 0.05, 1 + Math.sin(this.time * 2 + c.phase) * 0.06);
  }

  orient(c, up, fall) {
    const fwd = c.heading.clone().addScaledVector(up, -c.heading.dot(up)).normalize();
    const right = new THREE.Vector3().crossVectors(up, fwd).normalize();
    _m.makeBasis(right, up, fwd);
    c.group.quaternion.setFromRotationMatrix(_m);
    if (fall) {
      _q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.min(1.5, fall * 2.5));
      c.group.quaternion.multiply(_q);
    }
    c.group.position.copy(c.pos);
  }

  // ---- Crates -----------------------------------------------------------------------------
  updateCrates(p) {
    const c = this.cellCoords(p.pos, this.crateCell);
    const key = `${c.face}:${c.i}:${c.j}`;
    if (key !== this.crateKey) {
      this.crateKey = key;
      const keep = new Set();
      for (let dj = -2; dj <= 2; dj++) {
        for (let di = -2; di <= 2; di++) {
          const i = c.i + di, j = c.j + dj;
          if (i < 0 || j < 0 || i >= c.n || j >= c.n) continue;
          const s = this.seed ^ 0x0c4a7e ^ (c.face * 131);
          if (rand3(i, j, 1, s) > 0.42) continue;
          const id = `crate:${c.face}:${i}:${j}`;
          keep.add(id);
          if (!this.crates.has(id)) this.placeCrate(id, this.cellCenter(c.face, i, j, c.n, rand3(i, j, 2, s), rand3(i, j, 3, s)), rand3(i, j, 4, s));
        }
      }
      for (const [id, cr] of this.crates) {
        if (!keep.has(id) && !id.startsWith('drop')) { this.group.remove(cr.group); this.crates.delete(id); }
      }
    }
    // Lids and beacons.
    for (const cr of this.crates.values()) {
      cr.lidT += ((cr.open ? 1 : 0) - cr.lidT) * 0.08;
      cr.lid.rotation.x = -cr.lidT * 1.9;
      cr.beacon.visible = !cr.open;
      cr.beacon.material.opacity = 0.25 + 0.15 * Math.sin(this.time * 3);
    }
  }

  placeCrate(id, dir, r) {
    const model = buildCrate();
    const pos = dir.clone().multiplyScalar(this.groundAt(dir) - 0.05);
    const t = this.terrain();
    const n = t ? t.normal(dir) : dir.clone();
    model.group.position.copy(pos);
    model.group.quaternion.setFromUnitVectors(UP, n).multiply(new THREE.Quaternion().setFromAxisAngle(UP, r * 6.28));
    this.group.add(model.group);
    const open = this.opened.has(id);
    this.crates.set(id, { id, ...model, pos, open, lidT: open ? 1 : 0 });
  }

  /** The first time you step outside, the ship drops a crate right beside you. */
  onExitShip() {
    if (this.dropPlaced) return;
    this.dropPlaced = true;
    this.grace = 10; // a moment to look around before anything hunts you
    const w = this.game.walker;
    const fwd = w.facing.clone();
    const dir = w.pos.clone().addScaledVector(fwd, 9).normalize();
    this.placeCrate('drop:1', dir, 0.3);
  }

  /** E pressed on foot: open a nearby crate. Returns true if handled. */
  use() {
    const p = this.player();
    if (!p || !p.onFoot) return false;
    let best = null, bestD = 3.2;
    for (const cr of this.crates.values()) {
      const d = cr.pos.distanceTo(p.pos);
      if (!cr.open && d < bestD) { best = cr; bestD = d; }
    }
    if (!best) return false;
    best.open = true;
    this.opened.add(best.id);
    const g = this.game, wpn = this.weapon;
    g.audio.play('crate');
    if (!wpn.has) {
      wpn.has = true;
      wpn.energy = 100;
      g.hud.toast('Laser rifle', 'Left click (or R) to fire. Energy recharges on its own. Crates hold energy cells.', 'discovery', 9);
    } else {
      const roll = (best.id.length * 7 + Math.floor(this.time)) % 3;
      if (roll === 0) { wpn.energy = 100; g.hud.toast('Energy cell', 'Laser fully charged.', '', 4); }
      else if (roll === 1) { g.suit.health = Math.min(100, g.suit.health + 50); g.hud.toast('Med kit', '+50 health.', '', 4); }
      else { g.suit.jetpack = 100; wpn.energy = Math.min(100, wpn.energy + 50); g.hud.toast('Supplies', 'Jetpack refilled, +50% laser energy.', '', 4); }
    }
    return true;
  }

  /** Nearest unopened crate within reach, for the HUD prompt. */
  nearCrate() {
    const p = this.player();
    if (!p || !p.onFoot) return null;
    for (const cr of this.crates.values()) if (!cr.open && cr.pos.distanceTo(p.pos) < 3.2) return cr;
    return null;
  }

  /** Unopened crates within 1.5 km as HUD markers. */
  landmarks() {
    const out = [];
    const p = this.player();
    if (!p) return out;
    for (const cr of this.crates.values()) {
      if (cr.open) continue;
      const d = cr.pos.distanceTo(p.pos);
      if (d < 1500 && d > 4) out.push({ name: 'Supply crate', world: cr.pos.clone().applyQuaternion(this.body.quat).add(this.body.pos), distance: d });
    }
    return out.sort((a, b) => a.distance - b.distance).slice(0, 4);
  }

  // ---- Flora --------------------------------------------------------------------------------
  updateFlora(p, alt) {
    const show = alt < 350;
    this.floraAnchor.visible = show;
    if (!show) return;
    const c = this.cellCoords(p.pos, FLORA_CELL);
    const key = `${c.face}:${c.i}:${c.j}`;
    if (key === this.floraKey && !this.floraPending) return;
    this.floraKey = key;
    // Anchor near the player keeps instance matrices precise.
    const anchor = p.pos.clone();
    this.floraAnchor.position.copy(anchor);
    const counts = { trunk: 0, bulbs: 0, fern: 0, crystal: 0 };
    const keep = new Set();
    let budget = 500; // new cells per frame (each needs a terrain height)
    this.floraPending = false;
    const col = new THREE.Color();
    for (let dj = -FLORA_RANGE; dj <= FLORA_RANGE; dj++) {
      for (let di = -FLORA_RANGE; di <= FLORA_RANGE; di++) {
        if (di * di + dj * dj > FLORA_RANGE * FLORA_RANGE) continue;
        const i = c.i + di, j = c.j + dj;
        if (i < 0 || j < 0 || i >= c.n || j >= c.n) continue;
        const k = `${c.face}:${i}:${j}`;
        keep.add(k);
        let cell = this.floraCells.get(k);
        if (!cell) {
          if (budget-- <= 0) { this.floraPending = true; continue; }
          cell = this.makeFloraCell(c.face, i, j, c.n);
          this.floraCells.set(k, cell);
        }
        for (const f of cell) {
          const mesh = this.flora[f.kind];
          if (counts[f.kind] >= mesh.instanceMatrix.count) continue;
          _q.setFromUnitVectors(UP, f.up).multiply(new THREE.Quaternion().setFromAxisAngle(UP, f.spin));
          _m.compose(f.pos.clone().sub(anchor), _q, f.scale);
          mesh.setMatrixAt(counts[f.kind], _m);
          mesh.setColorAt(counts[f.kind], col.setRGB(f.color[0], f.color[1], f.color[2]));
          counts[f.kind]++;
          if (f.kind === 'trunk') {
            const b = this.flora.bulbs;
            if (counts.bulbs < b.instanceMatrix.count) {
              const top = f.pos.clone().addScaledVector(f.up, f.scale.y * 0.98).sub(anchor);
              const s = 0.9 + f.scale.x * 0.5;
              _m.compose(top, _q, new THREE.Vector3(s, s, s));
              b.setMatrixAt(counts.bulbs, _m);
              b.setColorAt(counts.bulbs, col.setRGB(f.glow[0], f.glow[1], f.glow[2]));
              counts.bulbs++;
            }
          }
        }
      }
    }
    for (const k of this.floraCells.keys()) if (!keep.has(k)) this.floraCells.delete(k);
    for (const [kind, m] of Object.entries(this.flora)) {
      m.count = counts[kind];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  makeFloraCell(face, i, j, n) {
    const s = 0x7f10a ^ (face * 977);
    const out = [];
    const r0 = rand3(i, j, 1, s);
    const dir = this.cellCenter(face, i, j, n, rand3(i, j, 2, s), rand3(i, j, 3, s));
    const biome = biomeAt(dir);
    let kind = null, scale, color, glow;
    const r1 = rand3(i, j, 4, s);
    if (biome === 'twilight') {
      if (r0 < 0.05) {
        kind = 'trunk';
        const h = 3 + r1 * 5;
        scale = new THREE.Vector3(1 + r1 * 0.6, h, 1 + r1 * 0.6);
        color = [0.07, 0.04, 0.09];
        const hue = rand3(i, j, 5, s);
        glow = hue < 0.5 ? [0.25, 0.95, 0.85] : hue < 0.8 ? [0.55, 0.45, 1.0] : [1.0, 0.45, 0.75];
      } else if (r0 < 0.33) {
        kind = 'fern';
        const sc = 0.6 + r1 * 1.3;
        scale = new THREE.Vector3(sc, sc * (0.8 + r1 * 0.5), sc);
        const v = rand3(i, j, 6, s);
        color = v < 0.6 ? [0.09, 0.03, 0.11] : v < 0.85 ? [0.2, 0.04, 0.09] : [0.05, 0.16, 0.15];
      }
    } else if (biome === 'night') {
      if (r0 < 0.07) {
        kind = 'crystal';
        const sc = 0.6 + r1 * 2.2;
        scale = new THREE.Vector3(sc, sc, sc);
        color = [0.6, 0.78, 0.95];
      }
    } else if (biome === 'desert') {
      if (r0 < 0.025) {
        kind = 'crystal';
        const sc = 0.5 + r1 * 1.4;
        scale = new THREE.Vector3(sc, sc * 0.8, sc);
        color = [0.9, 0.55, 0.3];
      } else if (r0 < 0.06) {
        kind = 'fern';
        const sc = 0.4 + r1 * 0.6;
        scale = new THREE.Vector3(sc, sc * 0.6, sc);
        color = [0.16, 0.06, 0.04];
      }
    }
    if (!kind) return out;
    const up = dir.clone();
    const pos = dir.clone().multiplyScalar(this.groundAt(dir) - 0.05);
    out.push({ kind, pos, up, spin: rand3(i, j, 7, s) * 6.28, scale, color, glow });
    return out;
  }

  // ---- Laser rifle ------------------------------------------------------------------------
  updateRifle(dt) {
    const g = this.game, w = this.weapon;
    this.grace = Math.max(0, this.grace - dt);
    this.rifle.group.visible = w.has && g.onFoot;
    if (!w.has) return;
    if (this.time - w.lastShot > 0.9) w.energy = Math.min(100, w.energy + dt * 7);
    this.rifle.coil.emissiveIntensity = 1 + 2.5 * (w.energy / 100);
    // Hold the rifle up and aim where the camera looks.
    if (g.onFoot) {
      const arm = g.astro.arms.find((a) => a.side > 0);
      arm.shoulder.rotation.set(-Math.PI / 2 - g.rig.footPitch, 0, 0.08);
      arm.elbow.rotation.set(0, 0, 0);
    }
    const firing = g.onFoot && g.state === 'play' && (g.input.fireHeld || g.input.down('KeyR'));
    if (firing && this.time - w.lastShot > 0.16) this.fire();
  }

  fire() {
    const g = this.game, w = this.weapon;
    if (w.energy < 4) {
      if (this.time - (w.lastEmpty || 0) > 1) { w.lastEmpty = this.time; g.audio.play('denied'); g.hud.toast('Laser', 'Out of energy. It recharges while you are not firing.', 'warn', 3); }
      return;
    }
    w.lastShot = this.time;
    w.energy -= 4;
    // Ray from the camera along the crosshair.
    const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(g.rig.quat);
    const hit = this.raycast(camDir, 320);
    const muzzle = this.rifle.muzzle.getWorldPosition(new THREE.Vector3());
    this.addBeam(muzzle, hit.point);
    g.audio.play('laser');
    if (hit.creature) this.damage(hit.creature, 24);
  }

  /** Hit test along a camera-space ray: creatures first, then the ground. */
  raycast(dirRender, maxDist) {
    let best = null, bestT = maxDist;
    const c = new THREE.Vector3();
    for (const cr of this.creatures) {
      if (cr.state === 'dead' || !cr.group.visible) continue;
      this.toRender(cr.pos, c);
      const up = cr.pos.clone().normalize().applyQuaternion(this.body.quat);
      c.addScaledVector(up, cr.sp.height * 0.5 * cr.scale);
      const r = cr.sp.radius * cr.scale;
      const b = c.dot(dirRender);
      const d2 = c.lengthSq() - b * b;
      if (b > 0 && d2 < r * r) {
        const t = b - Math.sqrt(r * r - d2);
        if (t < bestT) { bestT = t; best = cr; }
      }
    }
    // Ground: march along the ray in the planet frame.
    const origin = this.body.toLocal(this.game.camWorld.clone().sub(this.body.pos));
    const dirL = this.body.toLocal(dirRender.clone());
    let tG = null;
    for (let t = 1; t < bestT; t += t < 30 ? 1 : t < 120 ? 2.5 : 5) {
      const pt = origin.clone().addScaledVector(dirL, t);
      const dd = pt.length();
      if (dd < this.groundAt(pt.divideScalar(dd))) { tG = t; break; }
    }
    if (tG !== null && tG < bestT) return { point: dirRender.clone().multiplyScalar(tG), creature: null, t: tG };
    return { point: dirRender.clone().multiplyScalar(best ? bestT : maxDist), creature: best, t: bestT };
  }

  damage(cr, amount) {
    const g = this.game;
    cr.hp -= amount;
    if (cr.sp.friendly) cr.fleeT = 7;
    else cr.angry = 15;
    if (cr.hp <= 0) {
      cr.state = 'dead';
      cr.deadT = 0;
      this.dead.add(cr.id);
      g.audio.play('impact');
    } else g.audio.play(cr.sp.friendly ? 'chime' : 'growl');
  }

  addBeam(from, to) {
    const len = from.distanceTo(to);
    if (len < 0.1) return;
    const mid = from.clone().add(to).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, to.clone().sub(from).normalize());
    const core = new THREE.Mesh(this.beamGeo, this.beamMat.clone());
    core.scale.set(0.025, len, 0.025);
    const glowM = new THREE.Mesh(this.beamGeo, this.beamGlowMat.clone());
    glowM.scale.set(0.09, len, 0.09);
    const flash = new THREE.Mesh(this.flashGeo, this.flashMat.clone());
    flash.scale.setScalar(0.35);
    // Store in the planet frame so the beam stays put while you move.
    const toLocal = (v) => this.body.toLocal(v.clone().add(this.game.camWorld).sub(this.body.pos));
    const beam = { core, glow: glowM, flash, t: 0, midL: toLocal(mid), endL: toLocal(to), qL: this.body.quatInv.clone().multiply(q) };
    for (const m of [core, glowM, flash]) { m.frustumCulled = false; this.game.engine.scene.add(m); }
    this.beams.push(beam);
  }

  updateBeams(dt) {
    for (const b of this.beams) {
      b.t += dt;
      const f = Math.max(0, 1 - b.t / 0.18);
      this.toRender(b.midL, b.core.position);
      b.glow.position.copy(b.core.position);
      b.core.quaternion.copy(this.body.quat).multiply(b.qL);
      b.glow.quaternion.copy(b.core.quaternion);
      this.toRender(b.endL, b.flash.position);
      b.core.material.opacity = 0.95 * f;
      b.glow.material.opacity = 0.35 * f;
      b.flash.material.opacity = f;
      b.flash.scale.setScalar(0.25 + b.t * 3);
    }
    const done = this.beams.filter((b) => b.t > 0.2);
    for (const b of done) for (const m of [b.core, b.glow, b.flash]) { m.removeFromParent(); m.material.dispose(); }
    this.beams = this.beams.filter((b) => b.t <= 0.2);
  }

  // ---- What the crosshair is on ---------------------------------------------------------
  updateAim() {
    const el = document.getElementById('aim-label');
    if (!el) return;
    const g = this.game;
    if (!g.onFoot || this.time - (this.lastAim || 0) < 0.1) return;
    this.lastAim = this.time;
    const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(g.rig.quat);
    let best = null, bestT = 220;
    const c = new THREE.Vector3();
    for (const cr of this.creatures) {
      if (!cr.group.visible) continue;
      this.toRender(cr.pos, c);
      const up = cr.pos.clone().normalize().applyQuaternion(this.body.quat);
      c.addScaledVector(up, cr.sp.height * 0.5 * cr.scale);
      const r = cr.sp.radius * cr.scale * 1.4;
      const b = c.dot(camDir), d2 = c.lengthSq() - b * b;
      if (b > 0 && d2 < r * r && b < bestT) { bestT = b; best = cr; }
    }
    el.hidden = !best;
    if (!best) return;
    const hp = Math.max(0, best.hp / best.sp.hp);
    const txt = `<b>${best.sp.name}</b><span class="${best.sp.friendly ? 'ok' : 'bad'}">${best.state === 'dead' ? 'Dead' : best.sp.friendly ? 'Friendly' : 'Hostile'}</span><i style="width:${(hp * 100).toFixed(0)}%"></i><small>${bestT.toFixed(0)} m</small>`;
    if (el.innerHTML !== txt) el.innerHTML = txt;
  }

  dispose() {
    this.group.removeFromParent();
  }
}
