// =============================================================================
// world.js — turns the maze layout into the 3D jungle.
//
// Builds: ground, instanced tree walls + undergrowth, the crash-site hub,
// the river (with its bank), the native village, hazard zones (mosquito
// swarms, predator nest), fallen logs to jump, pickups, and ambient life
// (fireflies, monkeys, birds). Also registers every collider.
// =============================================================================
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { CollisionWorld } from './collision.js';
import { DIRS } from './maze.js';
import { makeRng } from './utils.js';
import {
  MATS, makeTreeGeometries, makeBushGeometry, makeFernGeometry, makeRockGeometry, makeLog,
  makePlaneWreck, makeHut, makeCampfire, makeTorch, makeBattery, makeMedkit, makeBones,
  makeMonkey, makeHuman, Pose,
} from './models.js';

const CHUNK = 28; // world units per instancing chunk (lets the GPU skip off-screen chunks)

/** Groups instances by (kind, chunk) and turns them into InstancedMeshes. */
class InstanceBatcher {
  constructor() {
    this.kinds = new Map();
  }
  kind(name, geometry, material, { castShadow = false, receiveShadow = true } = {}) {
    this.kinds.set(name, { geometry, material, castShadow, receiveShadow, chunks: new Map() });
  }
  add(name, matrix, color) {
    const k = this.kinds.get(name);
    const e = new THREE.Vector3().setFromMatrixPosition(matrix);
    const key = `${Math.floor(e.x / CHUNK)},${Math.floor(e.z / CHUNK)}`;
    let list = k.chunks.get(key);
    if (!list) k.chunks.set(key, (list = []));
    list.push({ matrix: matrix.clone(), color });
  }
  build(parent) {
    let count = 0;
    for (const k of this.kinds.values()) {
      for (const list of k.chunks.values()) {
        const im = new THREE.InstancedMesh(k.geometry, k.material, list.length);
        list.forEach((inst, i) => {
          im.setMatrixAt(i, inst.matrix);
          im.setColorAt(i, inst.color ?? new THREE.Color(1, 1, 1));
        });
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.computeBoundingSphere();
        im.castShadow = k.castShadow;
        im.receiveShadow = k.receiveShadow;
        parent.add(im);
        count += list.length;
      }
    }
    return count;
  }
}

/** Soft round sprite texture drawn on a canvas (smoke, glows, fireflies). */
function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildWorld(maze, scene) {
  const rng = makeRng(maze.seed ^ 0x5eed);
  const root = new THREE.Group();
  root.name = 'world';
  scene.add(root);

  const { size: N, cellSize: CS } = maze;
  const T = CONFIG.maze.wallThickness;
  const HALF = (N * CS) / 2;
  const colliders = new CollisionWorld();
  const batch = new InstanceBatcher();
  const glowTex = makeGlowTexture();
  const updaters = []; // per-frame animation callbacks
  const addFernLater = []; // decoration positions flushed into a second batch later
  const addRockLater = [];

  // ---- Coordinate helpers ---------------------------------------------------
  const cellCenter = (i) => new THREE.Vector3(-HALF + (maze.xOf(i) + 0.5) * CS, 0, -HALF + (maze.yOf(i) + 0.5) * CS);
  const cellAt = (x, z) => {
    const cx = Math.floor((x + HALF) / CS);
    const cz = Math.floor((z + HALF) / CS);
    return cx >= 0 && cz >= 0 && cx < N && cz < N ? maze.idx(cx, cz) : -1;
  };
  // Side frames: u runs along a maze edge, v points outwards from it.
  const toWorld = (side, u, v) => {
    switch (side) {
      case 0: return new THREE.Vector3(u, 0, -HALF - v);
      case 1: return new THREE.Vector3(HALF + v, 0, u);
      case 2: return new THREE.Vector3(u, 0, HALF + v);
      default: return new THREE.Vector3(-HALF - v, 0, u);
    }
  };
  const toLocal = (side, x, z) => {
    switch (side) {
      case 0: return { u: x, v: -HALF - z };
      case 1: return { u: z, v: x - HALF };
      case 2: return { u: x, v: z - HALF };
      default: return { u: z, v: -HALF - x };
    }
  };
  const uOfCell = (side, cell) => {
    const c = cellCenter(cell);
    return side === 0 || side === 2 ? c.x : c.z;
  };
  const localBox = (side, u0, u1, v0, v1, extra = {}) => {
    const a = toWorld(side, u0, v0);
    const b = toWorld(side, u1, v1);
    return colliders.add({
      minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x),
      minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z), ...extra,
    });
  };
  const inLocalRect = (side, rect, x, z) => {
    const { u, v } = toLocal(side, x, z);
    return u >= rect.u0 && u <= rect.u1 && v >= rect.v0 && v <= rect.v1;
  };

  // ---- Special areas outside the maze -----------------------------------------
  const exitSide = maze.exit.dir;
  const exitU = uOfCell(exitSide, maze.exit.cell);
  const village = {
    side: exitSide,
    rect: { u0: Math.max(-HALF, exitU - 22), u1: Math.min(HALF, exitU + 22), v0: 0, v1: 40 },
  };
  village.center = toWorld(exitSide, exitU, 22);
  village.entrance = toWorld(exitSide, exitU, 1);
  village.outward = new THREE.Vector3(DIRS[exitSide].dx, 0, DIRS[exitSide].dy);

  const riverSide = maze.river.dir;
  const riverU = uOfCell(riverSide, maze.river.cell);
  const river = {
    side: riverSide,
    bank: { u0: Math.max(-HALF, riverU - 15), u1: Math.min(HALF, riverU + 15), v0: 0, v1: 7 },
    shallow: { u0: Math.max(-HALF, riverU - 15), u1: Math.min(HALF, riverU + 15), v0: 7, v1: 11.5 },
    waterLevel: 0.3,
    toWorld: (u, v) => toWorld(riverSide, u, v),
    toLocal: (x, z) => toLocal(riverSide, x, z),
  };
  river.entrance = toWorld(riverSide, riverU, 1);
  river.isWater = (x, z) => {
    const { u, v } = toLocal(riverSide, x, z);
    return v > 7 && u > river.bank.u0 - 30 && u < river.bank.u1 + 30;
  };
  river.inZone = (x, z) => inLocalRect(riverSide, { ...river.bank, v1: 30 }, x, z);

  // ---- Colliders: maze walls ----------------------------------------------------
  const wallSegments = []; // [x0, z0, x1, z1] centre lines for decoration
  const addWall = (x0, z0, x1, z1) => {
    wallSegments.push([x0, z0, x1, z1]);
    colliders.add({
      minX: Math.min(x0, x1) - T / 2, maxX: Math.max(x0, x1) + T / 2,
      minZ: Math.min(z0, z1) - T / 2, maxZ: Math.max(z0, z1) + T / 2,
    });
  };
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = maze.idx(x, y);
      const x0 = -HALF + x * CS, z0 = -HALF + y * CS;
      const e = maze.neighbour(i, 1);
      if (e >= 0 && !maze.isOpen(i, e)) addWall(x0 + CS, z0, x0 + CS, z0 + CS);
      const s = maze.neighbour(i, 2);
      if (s >= 0 && !maze.isOpen(i, s)) addWall(x0, z0 + CS, x0 + CS, z0 + CS);
      // Outer boundary, except the village exit and the river opening.
      const isGap = (dir) => (maze.exit.cell === i && maze.exit.dir === dir) || (maze.river.cell === i && maze.river.dir === dir);
      if (y === 0 && !isGap(0)) addWall(x0, z0, x0 + CS, z0);
      if (x === N - 1 && !isGap(1)) addWall(x0 + CS, z0, x0 + CS, z0 + CS);
      if (y === N - 1 && !isGap(2)) addWall(x0, z0 + CS, x0 + CS, z0 + CS);
      if (x === 0 && !isGap(3)) addWall(x0, z0, x0, z0 + CS);
    }
  }

  // Village enclosure (open towards the maze exit only).
  const vr = village.rect;
  localBox(exitSide, vr.u0 - 4, vr.u0, -1, vr.v1 + 4);
  localBox(exitSide, vr.u1, vr.u1 + 4, -1, vr.v1 + 4);
  localBox(exitSide, vr.u0, vr.u1, vr.v1, vr.v1 + 4);

  // River bank enclosure + deep water.
  const rb = river.bank;
  localBox(riverSide, rb.u0 - 4, rb.u0, -1, 14);
  localBox(riverSide, rb.u1, rb.u1 + 4, -1, 14);
  localBox(riverSide, rb.u0, rb.u1, 11.5, 16); // too deep to wade further

  // ---- Instanced vegetation -------------------------------------------------------
  const trees = makeTreeGeometries(rng);
  trees.forEach((t, k) => {
    batch.kind(`trunk${k}`, t.trunk, MATS.solid, { castShadow: CONFIG.flashlight.castShadows });
    batch.kind(`canopy${k}`, t.canopy, MATS.solid);
  });
  batch.kind('bush', makeBushGeometry(rng), MATS.solid);
  batch.kind('fern', makeFernGeometry(), MATS.foliage);
  batch.kind('rock', makeRockGeometry(rng), MATS.solid);

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  // Per-instance colour multiplier (vertex colour x tint) for natural variety.
  const tint = (r, g, b, spread) => {
    const k = 1 + (rng() - 0.5) * spread;
    return new THREE.Color(r * k * (1 + (rng() - 0.5) * 0.12), g * k, b * k * (1 + (rng() - 0.5) * 0.12));
  };
  const pickSpecies = () => {
    const r = rng();
    let acc = 0;
    for (let k = 0; k < trees.length; k++) {
      acc += trees[k].weight;
      if (r <= acc) return k;
    }
    return 0;
  };
  const monkeyPerches = [];
  const addTree = (x, z, scale = 0.85 + rng() * 0.4, species = pickSpecies()) => {
    q.setFromAxisAngle(up, rng() * Math.PI * 2);
    m4.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(scale, scale * (0.9 + rng() * 0.25), scale));
    batch.add(`trunk${species}`, m4, tint(1, 1, 1, 0.35));
    batch.add(`canopy${species}`, m4, tint(0.95, 1.05, 0.9, 0.45));
    if (species !== 2 && rng() < 0.05) monkeyPerches.push(new THREE.Vector3(x, 0, z));
  };
  const addBush = (x, z, s = 1) => {
    q.setFromAxisAngle(up, rng() * Math.PI * 2);
    m4.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s * (0.9 + rng() * 0.6), s * (0.8 + rng() * 0.7), s * (0.9 + rng() * 0.6)));
    batch.add('bush', m4, tint(0.95, 1.05, 0.9, 0.4));
  };
  const addFern = (x, z, s = 1) => {
    q.setFromAxisAngle(up, rng() * Math.PI * 2);
    m4.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s, s));
    batch.add('fern', m4, tint(0.95, 1.05, 0.95, 0.4));
  };
  const addRock = (x, z, s = 1) => {
    q.setFromEuler(new THREE.Euler(rng(), rng() * 6, rng()));
    m4.compose(new THREE.Vector3(x, 0.1, z), q, new THREE.Vector3(s, s * 0.7, s));
    batch.add('rock', m4, tint(1, 1, 1, 0.3));
  };

  // Trees + bushes densely along every wall so walls read as impassable jungle.
  const vertexTrees = new Set();
  for (const [x0, z0, x1, z1] of wallSegments) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const nx = -(z1 - z0) / len, nz = (x1 - x0) / len;
    for (const [vx, vz] of [[x0, z0], [x1, z1]]) {
      const key = `${vx},${vz}`;
      if (!vertexTrees.has(key)) {
        vertexTrees.add(key);
        addTree(vx + (rng() - 0.5) * 0.6, vz + (rng() - 0.5) * 0.6);
      }
    }
    for (let k = 0; k < 2; k++) {
      const t = (k + 0.5) / 2 + (rng() - 0.5) * 0.2;
      const side = (rng() - 0.5) * T * 0.35;
      addTree(x0 + (x1 - x0) * t + nx * side, z0 + (z1 - z0) * t + nz * side);
    }
    for (let k = 0; k < 4; k++) {
      const t = rng();
      const side = (rng() - 0.5) * T * 0.9;
      addBush(x0 + (x1 - x0) * t + nx * side, z0 + (z1 - z0) * t + nz * side, 1.1);
    }
    for (let k = 0; k < 3; k++) {
      const t = rng();
      const side = (rng() < 0.5 ? -1 : 1) * (T / 2 + 0.4 + rng() * 0.6);
      addFern(x0 + (x1 - x0) * t + nx * side, z0 + (z1 - z0) * t + nz * side, 0.8 + rng() * 0.6);
    }
    if (rng() < 0.3) addRock(x0 + (x1 - x0) * rng() + nx * (T / 2 + 0.3), z0 + (z1 - z0) * rng() + nz * (T / 2 + 0.3), 0.5 + rng() * 0.6);
  }

  // Thick filler forest outside the maze so the world never visibly ends.
  const isSpecialOutside = (x, z) =>
    inLocalRect(exitSide, { u0: vr.u0 - 2, u1: vr.u1 + 2, v0: -2, v1: vr.v1 + 1 }, x, z) ||
    inLocalRect(riverSide, { u0: rb.u0 - 2, u1: rb.u1 + 2, v0: -2, v1: 25 }, x, z) ||
    river.isWater(x, z) && toLocal(riverSide, x, z).v < 26;
  const FILL = 28; // depth of the filler forest beyond the maze edge
  for (let x = -HALF - FILL; x <= HALF + FILL; x += 5.0) {
    for (let z = -HALF - FILL; z <= HALF + FILL; z += 5.0) {
      const jx = x + (rng() - 0.5) * 3, jz = z + (rng() - 0.5) * 3;
      const outside = Math.max(Math.abs(jx), Math.abs(jz)) > HALF + 1.5;
      if (!outside || isSpecialOutside(jx, jz)) continue;
      addTree(jx, jz, 0.9 + rng() * 0.45);
      if (rng() < 0.35) addBush(jx + 1.5, jz - 1, 1.3);
    }
  }
  // Village edges: dense trees around the clearing.
  for (let u = vr.u0 - 2; u <= vr.u1 + 2; u += 3.5) {
    const p = toWorld(exitSide, u, vr.v1 + 2 + rng() * 2);
    addTree(p.x, p.z);
    addBush(p.x, p.z, 1.3);
  }
  for (let v = 2; v <= vr.v1; v += 3.5) {
    for (const u of [vr.u0 - 2, vr.u1 + 2]) {
      const p = toWorld(exitSide, u + (rng() - 0.5), v);
      addTree(p.x, p.z);
      addBush(p.x, p.z, 1.3);
    }
  }
  // River: bank ends and the far bank.
  for (let v = 0; v <= 12; v += 3) {
    for (const u of [rb.u0 - 2, rb.u1 + 2]) {
      const p = toWorld(riverSide, u, v);
      addTree(p.x, p.z);
      addBush(p.x, p.z, 1.4);
    }
  }
  for (let u = rb.u0 - 40; u <= rb.u1 + 40; u += 3.8) {
    const p = toWorld(riverSide, u + (rng() - 0.5) * 2, 27 + rng() * 4);
    addTree(p.x, p.z, 1 + rng() * 0.3);
    if (rng() < 0.5) addBush(p.x, p.z, 1.3);
  }
  // Ferns sprinkled through corridors (walkable, non-blocking).
  for (let i = 0; i < N * N; i++) {
    if (maze.isHub(i)) continue;
    const c = cellCenter(i);
    for (let k = 0; k < 3; k++) addFern(c.x + (rng() - 0.5) * (CS - T - 1), c.z + (rng() - 0.5) * (CS - T - 1), 0.6 + rng() * 0.5);
  }

  const instanceCount = batch.build(root);

  // ---- Ground ------------------------------------------------------------------
  const groundSize = N * CS + 120;
  const groundGeo = new THREE.PlaneGeometry(groundSize, groundSize, 150, 150);
  groundGeo.rotateX(-Math.PI / 2);
  const gpos = groundGeo.attributes.position;
  const gcol = new Float32Array(gpos.count * 3);
  const earth = new THREE.Color(0x3b2e22), moss = new THREE.Color(0x1f2e18), litter = new THREE.Color(0x4a3a24);
  const villageEarth = new THREE.Color(0x6a4a30), mud = new THREE.Color(0x2e2a1e);
  const col = new THREE.Color();
  for (let i = 0; i < gpos.count; i++) {
    const x = gpos.getX(i), z = gpos.getZ(i);
    const n = Math.sin(x * 0.35) * Math.cos(z * 0.31) * 0.5 + Math.sin(x * 1.3 + z * 0.7) * 0.25 + (rng() - 0.5) * 0.4;
    const inWall = [...colliders.query(x, z, 0)].some((b) => b.maxY > 5 && x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ);
    if (inLocalRect(exitSide, vr, x, z)) col.copy(villageEarth).lerp(earth, 0.3 + n * 0.2);
    else if (inLocalRect(riverSide, { ...rb, v1: 30 }, x, z)) col.copy(mud).lerp(earth, 0.2 + n * 0.2);
    else if (inWall || Math.max(Math.abs(x), Math.abs(z)) > HALF) col.copy(moss).lerp(earth, 0.25 + n * 0.25);
    else col.copy(earth).lerp(litter, 0.5 + n * 0.5);
    gcol[i * 3] = col.r; gcol[i * 3 + 1] = col.g; gcol[i * 3 + 2] = col.b;
  }
  groundGeo.setAttribute('color', new THREE.BufferAttribute(gcol, 3));
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  ground.receiveShadow = true;
  root.add(ground);

  // ---- The crash site (hub) ----------------------------------------------------------
  const hubCenter = cellCenter(maze.centre);
  const wreck = makePlaneWreck();
  wreck.position.copy(hubCenter);
  root.add(wreck);
  const wreckBox = (x0, x1, z0, z1, extra) => colliders.add({ minX: hubCenter.x + x0, maxX: hubCenter.x + x1, minZ: hubCenter.z + z0, maxZ: hubCenter.z + z1, ...extra });
  wreckBox(-1.6, 1.8, -2.4, 7.8);         // front fuselage
  wreckBox(-5.2, 0.2, -9.5, -4.2);       // tail section
  wreckBox(1.5, 8.2, 1.6, 3.6);          // attached wing + engine
  wreckBox(-9.5, -3.6, 1.0, 4.0, { maxY: 0.55, low: true }); // torn wing lying flat (jumpable)

  const crashFire = makeCampfire(1.3);
  crashFire.root.position.set(hubCenter.x + 4.2, 0, hubCenter.z - 1.8);
  root.add(crashFire.root);
  const crashLight = new THREE.PointLight(0xff7a30, 30, 28, 1.6);
  crashLight.position.set(crashFire.root.position.x, 1.6, crashFire.root.position.z);
  root.add(crashLight);
  colliders.add({ minX: crashFire.root.position.x - 0.8, maxX: crashFire.root.position.x + 0.8, minZ: crashFire.root.position.z - 0.8, maxZ: crashFire.root.position.z + 0.8, maxY: 0.4, low: true });

  // Smoke column so the crash site is recognisable when you loop back to it.
  const smoke = [];
  const smokeMat = new THREE.SpriteMaterial({ map: glowTex, color: 0x555048, transparent: true, opacity: 0.35, depthWrite: false });
  for (let i = 0; i < 26; i++) {
    const s = new THREE.Sprite(smokeMat);
    s.userData.t = i / 26;
    root.add(s);
    smoke.push(s);
  }
  updaters.push((dt, time) => {
    for (const s of smoke) {
      s.userData.t = (s.userData.t + dt * 0.06) % 1;
      const t = s.userData.t;
      s.position.set(crashFire.root.position.x + Math.sin(t * 9 + time * 0.3) * (0.5 + t * 3), 1 + t * 26, crashFire.root.position.z + Math.cos(t * 7) * t * 2);
      s.scale.setScalar(1.5 + t * 9);
    }
    flicker(crashFire.flames, time, 1);
    crashLight.intensity = 26 + Math.sin(time * 13) * 4 + Math.sin(time * 7.3) * 3;
  });

  // ---- Fallen logs to jump over ------------------------------------------------------------
  const logs = [];
  const straightCells = [];
  for (let i = 0; i < N * N; i++) {
    if (maze.isHub(i) || i === maze.exit.cell || i === maze.river.cell || i === maze.nestCell || maze.swarmCells.includes(i)) continue;
    if (maze.pickups.some((p) => p.cell === i) || maze.dist[i] < 2) continue;
    const open = [0, 1, 2, 3].filter((d) => { const n = maze.neighbour(i, d); return n >= 0 && maze.isOpen(i, n); });
    if (open.length === 2 && (open[0] + 2) % 4 === open[1]) straightCells.push({ cell: i, axis: open[0] % 2 }); // axis 0 = N-S passage
  }
  const onRoute = rng.shuffle(straightCells.filter((s) => maze.solution.includes(s.cell))).slice(0, 2);
  const offRoute = rng.shuffle(straightCells.filter((s) => !maze.solution.includes(s.cell))).slice(0, 5);
  for (const { cell, axis } of [...onRoute, ...offRoute]) {
    const c = cellCenter(cell);
    const log = makeLog(CS - T + 1.6);
    log.position.copy(c);
    log.rotation.y = axis === 0 ? 0 : Math.PI / 2; // log lies across the passage
    root.add(log);
    const half = (CS - T) / 2 + 0.6;
    if (axis === 0) colliders.add({ minX: c.x - half, maxX: c.x + half, minZ: c.z - 0.45, maxZ: c.z + 0.45, maxY: 0.85, low: true });
    else colliders.add({ minX: c.x - 0.45, maxX: c.x + 0.45, minZ: c.z - half, maxZ: c.z + half, maxY: 0.85, low: true });
    logs.push(c);
  }

  // ---- Hazard zones -----------------------------------------------------------------
  // Mosquito swarms in damp, puddled thickets.
  const swarms = [];
  const puddleMat = new THREE.MeshStandardMaterial({ color: 0x0b1410, roughness: 0.05, metalness: 0.6 });
  for (const cell of maze.swarmCells) {
    const c = cellCenter(cell);
    for (let k = 0; k < 3; k++) {
      const p = new THREE.Mesh(new THREE.CircleGeometry(1 + rng() * 1.3, 18), puddleMat);
      p.rotation.x = -Math.PI / 2;
      p.position.set(c.x + (rng() - 0.5) * 4, 0.02, c.z + (rng() - 0.5) * 4);
      root.add(p);
    }
    for (let k = 0; k < 10; k++) addFernLater.push([c.x + (rng() - 0.5) * 6, c.z + (rng() - 0.5) * 6]);
    const count = 320;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 3);
    for (let k = 0; k < count; k++) {
      seeds[k * 3] = rng() * 100; seeds[k * 3 + 1] = rng() * 100; seeds[k * 3 + 2] = 0.4 + rng();
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x2e2a22, size: 0.16, map: glowTex, transparent: true, depthWrite: false, opacity: 0.95 }));
    pts.frustumCulled = false;
    root.add(pts);
    const swarm = { home: c.clone(), center: c.clone().setY(1.4), points: pts, seeds, count };
    swarms.push(swarm);
  }

  // Predator nest: trampled clearing littered with bones.
  const nestCenter = cellCenter(maze.nestCell);
  const bones = makeBones(rng);
  bones.position.copy(nestCenter);
  root.add(bones);
  for (let k = 0; k < 4; k++) addRockLater.push([nestCenter.x + (rng() - 0.5) * 6, nestCenter.z + (rng() - 0.5) * 6]);

  // A second (small) batch for things placed after the main batch was built.
  const lateBatch = new InstanceBatcher();
  lateBatch.kind('fern', batch.kinds.get('fern').geometry, MATS.foliage);
  lateBatch.kind('rock', batch.kinds.get('rock').geometry, MATS.solid);
  for (const [x, z] of addFernLater) {
    q.setFromAxisAngle(up, rng() * 6.28);
    lateBatch.add('fern', m4.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(1.2, 1.4, 1.2)), new THREE.Color(0.8, 1, 0.8));
  }
  for (const [x, z] of addRockLater) {
    q.setFromEuler(new THREE.Euler(rng(), rng() * 6, rng()));
    lateBatch.add('rock', m4.compose(new THREE.Vector3(x, 0.1, z), q, new THREE.Vector3(0.8, 0.5, 0.8)), new THREE.Color(0.7, 0.7, 0.7));
  }
  lateBatch.build(root);

  // ---- The river ------------------------------------------------------------------
  const riverLen = N * CS + 120;
  const waterGeo = new THREE.PlaneGeometry(riverLen, 20, 110, 10);
  waterGeo.rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(waterGeo, new THREE.MeshStandardMaterial({ color: 0x1d3a36, roughness: 0.15, metalness: 0.35, transparent: true, opacity: 0.88 }));
  const wc = toWorld(riverSide, 0, 17);
  water.position.set(wc.x, river.waterLevel, wc.z);
  if (riverSide === 1 || riverSide === 3) water.rotation.y = Math.PI / 2;
  water.receiveShadow = true;
  root.add(water);
  const wpos = waterGeo.attributes.position;
  const wbase = Float32Array.from(wpos.array);
  updaters.push((dt, time) => {
    for (let i = 0; i < wpos.count; i++) {
      const x = wbase[i * 3], z = wbase[i * 3 + 2];
      wpos.setY(i, Math.sin(x * 0.25 + time * 1.4) * 0.06 + Math.sin(z * 0.6 + x * 0.1 + time * 0.9) * 0.05);
    }
    wpos.needsUpdate = true;
    waterGeo.computeVertexNormals();
  });
  // Reeds along the bank.
  const reedGeos = [];
  for (let k = 0; k < 60; k++) {
    const p = toWorld(riverSide, rb.u0 + rng() * (rb.u1 - rb.u0), 6 + rng() * 2.5);
    const h = 0.8 + rng() * 1.2;
    const g = new THREE.CylinderGeometry(0.015, 0.03, h, 4);
    g.translate(p.x, h / 2, p.z);
    reedGeos.push(g);
  }
  root.add(new THREE.Mesh(mergeReeds(reedGeos), new THREE.MeshStandardMaterial({ color: 0x5a6a2a, roughness: 0.9 })));

  // ---- The native village ------------------------------------------------------------
  const villageGroup = new THREE.Group();
  root.add(villageGroup);
  const vFire = makeCampfire(1.4);
  vFire.root.position.copy(village.center);
  villageGroup.add(vFire.root);
  const villageLight = new THREE.PointLight(0xff8a3a, 60, 45, 1.4);
  villageLight.position.copy(village.center).setY(2.2);
  villageGroup.add(villageLight);
  const cutKey = new THREE.PointLight(0xffb070, 0, 22, 1.4);
  const cutFill = new THREE.HemisphereLight(0xffd8a8, 0x2a1a10, 0);
  villageGroup.add(cutKey, cutFill);
  village.cutsceneLights = { key: cutKey, fill: cutFill };
  colliders.add({ minX: village.center.x - 1.2, maxX: village.center.x + 1.2, minZ: village.center.z - 1.2, maxZ: village.center.z + 1.2, maxY: 0.5, low: true });
  const huts = [];
  for (let k = 0; k < 6; k++) {
    const a = Math.PI * 1.25 + (k / 5) * Math.PI * 1.5; // ring of huts, open towards the jungle exit
    const p = toWorld(exitSide, exitU + Math.cos(a + Math.PI / 2) * 12, 22 + Math.sin(a + Math.PI / 2) * 11);
    const hut = makeHut(rng);
    hut.position.copy(p);
    hut.lookAt(village.center.x, 0, village.center.z);
    villageGroup.add(hut);
    huts.push(hut);
    colliders.add({ minX: p.x - 2.2, maxX: p.x + 2.2, minZ: p.z - 2.2, maxZ: p.z + 2.2 });
  }
  const torches = [];
  for (const du of [-3.5, 3.5]) {
    for (const v of [2, 9]) {
      const t = makeTorch();
      t.root.position.copy(toWorld(exitSide, exitU + du, v));
      villageGroup.add(t.root);
      torches.push(t.flame);
    }
  }
  const torchGlowMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xff9a40, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
  for (const f of torches) {
    const g = new THREE.Sprite(torchGlowMat);
    g.scale.setScalar(2.2);
    f.add(g);
  }
  // Villagers (two waving near the huts) and the survivor's family by the fire.
  const villagers = [];
  const looks = [
    { skin: 0x5a3a28, top: 0xb5462a, bottom: 0x2a3a6a, hair: 0x111111, height: 1.72 },
    { skin: 0x4a3020, top: 0x2a7a5a, bottom: 0xd9a33a, hair: 0x111111, height: 1.65, dress: true, headwrap: 0xd9a33a },
  ];
  looks.forEach((look, k) => {
    const v = makeHuman(look);
    v.root.position.copy(toWorld(exitSide, exitU + (k ? 7 : -7), 16));
    v.root.lookAt(village.entrance.x, 0, village.entrance.z);
    villageGroup.add(v.root);
    villagers.push(v);
  });
  const family = [
    makeHuman({ skin: 0xc8946c, top: 0x7a3a5a, bottom: 0x3a4a6a, hair: 0x2a1a10, height: 1.66, dress: true }), // wife
    makeHuman({ skin: 0xc8946c, top: 0xe0b030, bottom: 0x2a4a7a, hair: 0x2a1a10, height: 1.2 }),              // son
    makeHuman({ skin: 0xc8946c, top: 0x5aa0d0, bottom: 0xd06a8a, hair: 0x3a2212, height: 1.05, dress: true }), // daughter
  ];
  family.forEach((f, k) => {
    f.root.position.copy(toWorld(exitSide, exitU + (k - 1) * 1.6, 18.5));
    f.root.lookAt(village.entrance.x, 0, village.entrance.z);
    villageGroup.add(f.root);
  });
  updaters.push((dt, time) => {
    flicker(vFire.flames, time, 1.3);
    torches.forEach((f, k) => { f.scale.set(1 + Math.sin(time * 11 + k) * 0.15, 1 + Math.sin(time * 9 + k * 2) * 0.25, 1); });
    villageLight.intensity = 55 + Math.sin(time * 10) * 6 + Math.sin(time * 6.1) * 4;
    if (village.cutsceneActive) return; // the cutscene poses everyone itself
    villagers.forEach((v, k) => (k ? Pose.idle(v.parts, time + k) : Pose.wave(v.parts, time)));
    family.forEach((f, k) => Pose.idle(f.parts, time + k * 1.7));
  });
  village.family = family;
  village.villagers = villagers;
  village.contains = (x, z) => inLocalRect(exitSide, { ...vr, v0: 3.5 }, x, z);

  // ---- Pickups -------------------------------------------------------------------
  const pickupGlowMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xfff2a0, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
  const pickups = maze.pickups.map(({ cell, type }) => {
    const c = cellCenter(cell);
    const model = type === 'battery' ? makeBattery() : makeMedkit();
    const holder = new THREE.Group();
    holder.position.set(c.x, 0.6, c.z);
    holder.add(model);
    const glow = new THREE.Sprite(pickupGlowMat);
    glow.scale.setScalar(1.6);
    glow.position.y = 0.25;
    holder.add(glow);
    root.add(holder);
    return { type, position: new THREE.Vector3(c.x, 0, c.z), holder, taken: false };
  });
  updaters.push((dt, time) => {
    for (const p of pickups) {
      if (p.taken) continue;
      p.holder.rotation.y = time * 1.2;
      p.holder.position.y = 0.5 + Math.sin(time * 2 + p.position.x) * 0.12;
    }
  });

  // ---- Ambient life: fireflies, monkeys, birds -------------------------------------------
  const fireflyCount = 160;
  const ffGeo = new THREE.BufferGeometry();
  const ffPos = new Float32Array(fireflyCount * 3);
  const ffSeed = Array.from({ length: fireflyCount }, () => [rng() * 100, rng() * 100, rng() * 100]);
  ffGeo.setAttribute('position', new THREE.BufferAttribute(ffPos, 3));
  const fireflyMat = new THREE.PointsMaterial({ color: 0xd8ff6a, size: 0.35, map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
  const fireflies = new THREE.Points(ffGeo, fireflyMat);
  fireflies.frustumCulled = false;
  root.add(fireflies);

  const monkeys = monkeyPerches.slice(0, 8).map((p, k) => {
    const m = makeMonkey();
    const a = k * 2.4;
    const base = new THREE.Vector3(p.x + Math.cos(a) * 0.9, 6.5 + (k % 3), p.z + Math.sin(a) * 0.9);
    m.root.position.copy(base);
    root.add(m.root);
    return { ...m, base, climb: 0, fleeTimer: 0 };
  });

  const birds = [];
  for (let k = 0; k < 6; k++) {
    const b = new THREE.Group();
    const wingGeo = new THREE.BoxGeometry(0.7, 0.03, 0.25);
    const wingMat = new THREE.MeshBasicMaterial({ color: 0x151515 });
    const l = new THREE.Mesh(wingGeo, wingMat); l.position.x = 0.35;
    const r = new THREE.Mesh(wingGeo, wingMat); r.position.x = -0.35;
    const lw = new THREE.Group(); lw.add(l);
    const rw = new THREE.Group(); rw.add(r);
    b.add(lw, rw, new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), wingMat));
    root.add(b);
    birds.push({ group: b, lw, rw, phase: k * 1.1, radius: 8 + k * 2.5, height: 24 + k * 1.5 });
  }

  const tmpV = new THREE.Vector3();
  const update = (dt, time, ctx) => {
    for (const u of updaters) u(dt, time, ctx);
    const { playerPos, darkness } = ctx;

    // Mosquito swarms drift toward the player a little (leashed to their thicket).
    for (const s of swarms) {
      tmpV.copy(playerPos).sub(s.home).setY(0);
      const d = tmpV.length();
      const target = d < CONFIG.hazards.swarmRadius + 4 ? tmpV.clampLength(0, 3.5).add(s.home) : s.home;
      s.center.x += (target.x - s.center.x) * Math.min(1, dt * 1.5);
      s.center.z += (target.z - s.center.z) * Math.min(1, dt * 1.5);
      const arr = s.points.geometry.attributes.position.array;
      for (let k = 0; k < s.count; k++) {
        const [a, b, r] = [s.seeds[k * 3], s.seeds[k * 3 + 1], s.seeds[k * 3 + 2]];
        arr[k * 3] = s.center.x + Math.sin(time * (2 + r) + a) * 2.2 * r + Math.sin(time * 17 + b) * 0.08;
        arr[k * 3 + 1] = s.center.y + Math.sin(time * (1.3 + r) + b) * 0.9 + Math.cos(time * 19 + a) * 0.06;
        arr[k * 3 + 2] = s.center.z + Math.cos(time * (1.7 + r) + a * 1.3) * 2.2 * r;
      }
      s.points.geometry.attributes.position.needsUpdate = true;
    }

    // Fireflies glow at night around the player.
    fireflyMat.opacity = Math.max(0, (darkness - 0.45) * 1.6);
    fireflies.visible = fireflyMat.opacity > 0.01;
    if (fireflies.visible) {
      for (let k = 0; k < fireflyCount; k++) {
        const [a, b, c] = ffSeed[k];
        const wrap = (v) => ((v % 36) + 36) % 36 - 18;
        const px = playerPos.x + wrap(a * 7.3 + time * 0.3 * Math.sin(c));
        const pz = playerPos.z + wrap(b * 5.1 + time * 0.25 * Math.cos(c));
        ffPos[k * 3] = px + Math.sin(time * 0.7 + c) * 0.6;
        ffPos[k * 3 + 1] = 0.6 + ((c * 0.37) % 2.4) + Math.sin(time * 1.3 + a) * 0.3;
        ffPos[k * 3 + 2] = pz + Math.cos(time * 0.6 + b) * 0.6;
      }
      ffGeo.attributes.position.needsUpdate = true;
      fireflyMat.size = 0.28 + Math.sin(time * 3) * 0.05;
    }

    // Monkeys watch you and scramble up the trunk if you come close.
    for (const m of monkeys) {
      const d = Math.hypot(playerPos.x - m.base.x, playerPos.z - m.base.z);
      if (d < 7) m.fleeTimer = 8;
      m.fleeTimer = Math.max(0, m.fleeTimer - dt);
      const goal = m.fleeTimer > 0 ? 9 : 0;
      m.climb += (goal - m.climb) * Math.min(1, dt * (goal ? 2.5 : 0.4));
      m.root.position.set(m.base.x, m.base.y + m.climb + Math.sin(time * 3 + m.base.x) * 0.05, m.base.z);
      m.root.rotation.y = Math.atan2(playerPos.x - m.base.x, playerPos.z - m.base.z);
    }

    // Birds circle over the crash-site clearing by day.
    for (const b of birds) {
      b.group.visible = darkness < 0.6;
      if (!b.group.visible) continue;
      const a = time * 0.25 + b.phase;
      b.group.position.set(hubCenter.x + Math.cos(a) * b.radius, b.height + Math.sin(time + b.phase) * 0.5, hubCenter.z + Math.sin(a) * b.radius);
      b.group.rotation.y = -a;
      const flap = Math.sin(time * 9 + b.phase) * 0.6;
      b.lw.rotation.z = flap;
      b.rw.rotation.z = -flap;
    }
  };

  // Spawn: beside the wreck, looking past the fire at the broken fuselage.
  const spawn = { position: new THREE.Vector3(hubCenter.x + 12, 0, hubCenter.z - 3), yaw: Math.PI / 2 - 0.12 };

  return {
    root, colliders, maze, cellCenter, cellAt, spawn, hubCenter, village, river, swarms, nestCenter,
    pickups, logs, monkeys, update, instanceCount, glowTex,
    isHubCell: (x, z) => { const c = cellAt(x, z); return c >= 0 && maze.isHub(c); },
  };

  // (hoisted helpers)
  function flicker(flames, time, s) {
    flames.forEach((f, k) => {
      f.scale.set(s * (0.85 + Math.sin(time * 12 + k * 2) * 0.15), s * (0.8 + Math.sin(time * 9 + k * 3.1) * 0.3), s * (0.85 + Math.cos(time * 11 + k) * 0.15));
    });
  }
}

function mergeReeds(geos) {
  let total = 0;
  const parts = geos.map((g) => { const n = g.toNonIndexed(); total += n.attributes.position.count; return n; });
  const pos = new Float32Array(total * 3);
  let off = 0;
  for (const g of parts) { pos.set(g.attributes.position.array, off * 3); off += g.attributes.position.count; }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.computeVertexNormals();
  return merged;
}
