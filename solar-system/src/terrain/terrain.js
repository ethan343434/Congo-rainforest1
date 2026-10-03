// =============================================================================
// terrain.js — streams a landable world's surface around the player.
//
// * A quadtree on each of the six cube faces picks tiles by distance, so the
//   ground is finest under you (vertices ~0.3–1 m apart) and coarser towards
//   the horizon, and tiles hidden behind the horizon are skipped.
// * Tiles are built by Web Workers (falling back to the main thread if
//   workers are unavailable) and cached.
// * Detail is never reduced by the performance governor; the split distance
//   is fixed.
// * Rocks and boulders are scattered around the player from a deterministic
//   hash, so the same boulder is always in the same place.
// =============================================================================
import * as THREE from 'three';
import { createHeightfield, rand3 } from './heightfield.js';
import { buildChunk, buildIndices, faceDir, dirToFace, tileEdge, ellipsoidRadius, GRID } from './chunkBuilder.js';
import { createTerrainMaterial } from './terrainMaterial.js';

const SPLIT_K = 2.4;          // split a tile when closer than SPLIT_K × its edge length
const TARGET_SPACING = 0.42;  // m between vertices at the finest level
const MAX_MESHES = 900;

// =============================================================================
// Worker pool
// =============================================================================
export class TerrainWorkers {
  constructor() {
    this.workers = [];
    this.jobs = new Map();       // key → callback
    this.local = new Map();      // bodyId → { hf, axes } (fallback + physics)
    this.registered = new Map(); // bodyId → message for late/restarted workers
    this.fallback = false;
    this.queue = [];             // fallback queue
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    try {
      for (let i = 0; i < n; i++) this.spawn();
    } catch (e) {
      this.useFallback('workers unavailable');
    }
  }

  spawn() {
    const w = new Worker(new URL('./terrainWorker.js', import.meta.url), { type: 'module' });
    w.busy = new Set();
    w.onmessage = (e) => {
      const m = e.data;
      w.busy.delete(m.key);
      const cb = this.jobs.get(m.key);
      this.jobs.delete(m.key);
      if (cb && !m.failed) cb(m);
    };
    w.onerror = () => this.useFallback('worker failed to start');
    for (const msg of this.registered.values()) w.postMessage(msg);
    this.workers.push(w);
  }

  useFallback(reason) {
    if (this.fallback) return;
    console.warn(`Terrain: building on the main thread (${reason}).`);
    this.fallback = true;
    for (const w of this.workers) {
      for (const key of w.busy) this.jobs.delete(key);
      w.terminate();
    }
    this.workers = [];
  }

  registerBody(id, params, axes, hf) {
    const msg = { type: 'body', id, params, axes };
    this.registered.set(id, msg);
    this.local.set(id, { hf, axes });
    for (const w of this.workers) w.postMessage(msg);
  }

  dropBody(id) {
    this.registered.delete(id);
    this.local.delete(id);
    for (const w of this.workers) w.postMessage({ type: 'drop', id });
    this.queue = this.queue.filter((j) => j.bodyId !== id);
  }

  /** Free job slots right now. */
  free() {
    if (this.fallback) return Math.max(0, 2 - this.queue.length);
    let n = 0;
    for (const w of this.workers) n += Math.max(0, 3 - w.busy.size);
    return n;
  }

  submit(job, cb) {
    this.jobs.set(job.key, cb);
    if (this.fallback) { this.queue.push(job); return; }
    let best = this.workers[0];
    for (const w of this.workers) if (w.busy.size < best.busy.size) best = w;
    best.busy.add(job.key);
    best.postMessage({ type: 'chunk', ...job });
  }

  /** Main-thread fallback: build queued tiles within a time budget (ms). */
  pump(budgetMs = 7) {
    if (!this.fallback) return;
    const t0 = performance.now();
    while (this.queue.length && performance.now() - t0 < budgetMs) {
      const job = this.queue.shift();
      const b = this.local.get(job.bodyId);
      const cb = this.jobs.get(job.key);
      this.jobs.delete(job.key);
      if (!b || !cb) continue;
      cb({ key: job.key, ...buildChunk(b.hf, b.axes, job.face, job.level, job.x, job.y, job.splitK) });
    }
  }
}

// =============================================================================
// Quadtree node
// =============================================================================
class Node {
  constructor(t, face, level, x, y) {
    this.face = face; this.level = level; this.x = x; this.y = y;
    this.key = `${t.body.id}:${face}/${level}/${x}/${y}`;
    this.children = null;
    this.mesh = null;
    this.pending = false;
    this.lastUsed = 0;
    const size = 2 / (1 << level);
    const d = faceDir(face, -1 + (x + 0.5) * size, -1 + (y + 0.5) * size, [0, 0, 0]);
    this.dx = d[0]; this.dy = d[1]; this.dz = d[2];
    this.edge = tileEdge(t.R, level);
    this.angRadius = (this.edge / t.R) * 0.82;
    this.hMid = 0;
  }

  split(t) {
    if (this.children) return this.children;
    const L = this.level + 1, x = this.x * 2, y = this.y * 2;
    this.children = [new Node(t, this.face, L, x, y), new Node(t, this.face, L, x + 1, y), new Node(t, this.face, L, x, y + 1), new Node(t, this.face, L, x + 1, y + 1)];
    for (const c of this.children) c.hMid = this.hMid;
    return this.children;
  }
}

// =============================================================================
// Terrain of one body
// =============================================================================
let SHARED_INDEX = null;

export class Terrain {
  /**
   * opts: { workers, detailTex, heightmap ({width,height,data}|null),
   *         colorMap (Texture|null), look: {tint, baseColor, slopeBright, bump} }
   */
  constructor(body, opts) {
    this.body = body;
    this.workers = opts.workers;
    this.R = body.radius;
    this.axes = [body.axes.x, body.axes.y, body.axes.z];
    const params = {
      id: body.id,
      radius: body.radius,
      gravity: body.GM / (body.radius * body.radius),
      terrain: body.def.terrain,
      heightmap: opts.heightmap || null,
    };
    this.hf = createHeightfield(params);
    const spacing = body.def.terrain?.spacing ?? TARGET_SPACING;
    this.maxLevel = Math.max(4, Math.ceil(Math.log2((this.R * Math.PI * 0.5) / (GRID * spacing))));
    this.finestSpacing = tileEdge(this.R, this.maxLevel) / GRID;
    this.workers.registerBody(body.id, params, this.axes, this.hf);

    if (!SHARED_INDEX) SHARED_INDEX = new THREE.BufferAttribute(buildIndices(), 1);
    const look = opts.look || {};
    this.material = createTerrainMaterial(opts.detailTex, { colorMap: opts.colorMap, ...look });
    this.group = new THREE.Group();
    this.group.name = `terrain-${body.id}`;
    this.roots = [0, 1, 2, 3, 4, 5].map((f) => new Node(this, f, 0, 0, 0));
    this.meshNodes = new Set();
    this.drawn = new Set();
    this.drawList = [];
    this.wanted = [];
    this.ready = false;
    this.time = 0;

    this.rocks = new RockField(this, opts.rockColor || [0.3, 0.3, 0.3]);
    this.group.add(this.rocks.group);
    this._v = new THREE.Vector3();
  }

  /** Exact height (m above the reference ellipsoid) under a local unit direction. */
  height(dir) {
    return this.hf.height(dir.x, dir.y, dir.z, this.finestSpacing);
  }

  /** Surface radius (m from the centre) in a local unit direction. */
  surfaceRadius(dir) {
    return ellipsoidRadius(this.axes, dir.x, dir.y, dir.z) + this.height(dir);
  }

  /** Local-frame surface normal by finite differences (≈1 m baseline). */
  normal(dir, out = new THREE.Vector3()) {
    const R = this.R;
    const e = Math.max(0.6, this.finestSpacing * 1.5) / R;
    // Tangent basis around dir.
    const up = Math.abs(dir.y) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let tx = up[1] * dir.z - up[2] * dir.y, ty = up[2] * dir.x - up[0] * dir.z, tz = up[0] * dir.y - up[1] * dir.x;
    const tl = Math.hypot(tx, ty, tz); tx /= tl; ty /= tl; tz /= tl;
    const bx = dir.y * tz - dir.z * ty, by = dir.z * tx - dir.x * tz, bz = dir.x * ty - dir.y * tx;
    const p = (ox, oy, oz) => {
      let x = dir.x + ox, y = dir.y + oy, z = dir.z + oz;
      const l = Math.hypot(x, y, z); x /= l; y /= l; z /= l;
      const r = ellipsoidRadius(this.axes, x, y, z) + this.hf.height(x, y, z, this.finestSpacing);
      return [x * r, y * r, z * r];
    };
    const a = p(tx * e, ty * e, tz * e), b = p(-tx * e, -ty * e, -tz * e);
    const c = p(bx * e, by * e, bz * e), d = p(-bx * e, -by * e, -bz * e);
    const ux = a[0] - b[0], uy = a[1] - b[1], uz = a[2] - b[2];
    const vx = c[0] - d[0], vy = c[1] - d[1], vz = c[2] - d[2];
    out.set(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx).normalize();
    if (out.dot(dir) < 0) out.negate();
    return out;
  }

  /**
   * Per-frame: choose tiles for a camera at camLocal (local frame, metres),
   * request missing ones and place the terrain relative to the render origin.
   * playerLocal: where rocks are scattered (ship or astronaut).
   */
  update(camLocal, origin, dt, playerLocal) {
    this.time += dt;
    const body = this.body;
    this.group.position.subVectors(body.pos, origin);
    this.group.quaternion.copy(body.quat);

    const camD = camLocal.length();
    const cx = camLocal.x / camD, cy = camLocal.y / camD, cz = camLocal.z / camD;
    const maxH = this.hf.maxHeight;
    const Ro = Math.max(1, this.R - maxH);
    this.visAngle = camD > Ro ? Math.acos(Ro / camD) + Math.acos(Ro / (this.R + maxH)) : Math.PI;
    this.cam = { x: cx, y: cy, z: cz, d: camD };
    this.drawList.length = 0;
    this.wanted.length = 0;
    for (const r of this.roots) this.visit(r);

    // Show the chosen tiles, hide the rest.
    const nowDrawn = new Set(this.drawList);
    for (const n of this.drawn) if (!nowDrawn.has(n) && n.mesh) n.mesh.visible = false;
    for (const n of nowDrawn) { n.mesh.visible = true; n.lastUsed = this.time; }
    this.drawn = nowDrawn;
    // The coarse sphere can be hidden once every root tile exists.
    this.ready = this.roots.every((r) => r.mesh || r.children);

    // Request missing tiles, nearest first.
    this.wanted.sort((a, b) => a.dist - b.dist);
    let free = this.workers.free();
    for (const w of this.wanted) {
      if (free <= 0) break;
      const n = w.node;
      if (n.pending || n.mesh) continue;
      n.pending = true;
      free--;
      this.workers.submit({ key: n.key, bodyId: body.id, face: n.face, level: n.level, x: n.x, y: n.y, splitK: SPLIT_K }, (res) => this.onTile(n, res));
    }
    this.workers.pump();
    if (this.meshNodes.size > MAX_MESHES) this.evict();
    if (playerLocal) this.rocks.update(playerLocal);
  }

  angleTo(n) {
    const c = this.cam;
    return Math.acos(Math.max(-1, Math.min(1, c.x * n.dx + c.y * n.dy + c.z * n.dz)));
  }

  culled(n) {
    return this.angleTo(n) - n.angRadius > this.visAngle;
  }

  visit(n) {
    const ang = this.angleTo(n);
    if (ang - n.angRadius > this.visAngle) return;
    const horiz = Math.max(0, ang - n.angRadius) * this.R;
    const vert = Math.max(0, this.cam.d - (this.R + n.hMid));
    const dist = Math.hypot(horiz, vert);
    n.lastUsed = this.time;
    if (n.level < this.maxLevel && dist < SPLIT_K * n.edge) {
      const kids = n.split(this);
      let ready = true;
      for (const k of kids) {
        if (!k.mesh && !this.culled(k)) {
          ready = false;
          this.wanted.push({ node: k, dist });
        }
      }
      if (ready || !n.mesh) {
        if (ready) { for (const k of kids) this.visit(k); return; }
      }
    }
    if (n.mesh) this.drawList.push(n);
    else this.wanted.push({ node: n, dist: dist * 0.5 });
  }

  onTile(n, res) {
    n.pending = false;
    if (this.disposed) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(res.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(res.normal, 3));
    g.setAttribute('aDir', new THREE.BufferAttribute(res.dir, 3));
    g.setAttribute('aDetail', new THREE.BufferAttribute(res.detail, 3));
    g.setAttribute('aMorph', new THREE.BufferAttribute(res.morph, 4));
    g.setIndex(SHARED_INDEX);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, this.material);
    m.position.set(res.center[0], res.center[1], res.center[2]);
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    m.receiveShadow = true;
    // Terrain only receives shadows: the shadow map covers ~120 m, and terrain
    // shading itself would cut off in a hard line at its edge.
    m.castShadow = false;
    m.visible = false;
    this.group.add(m);
    n.mesh = m;
    n.hMid = (res.hMin + res.hMax) / 2;
    if (n.children) for (const c of n.children) if (!c.mesh) c.hMid = n.hMid;
    this.meshNodes.add(n);
  }

  evict() {
    const list = [...this.meshNodes].filter((n) => !this.drawn.has(n) && n.level > 1 && this.time - n.lastUsed > 2);
    list.sort((a, b) => a.lastUsed - b.lastUsed);
    let excess = this.meshNodes.size - Math.floor(MAX_MESHES * 0.8);
    for (const n of list) {
      if (excess-- <= 0) break;
      this.freeMesh(n);
    }
  }

  freeMesh(n) {
    const g = n.mesh.geometry;
    g.index = null; // the index buffer is shared by every tile
    g.dispose();
    this.group.remove(n.mesh);
    n.mesh = null;
    this.meshNodes.delete(n);
  }

  dispose() {
    this.disposed = true;
    for (const n of [...this.meshNodes]) this.freeMesh(n);
    this.rocks.dispose();
    this.material.dispose();
    this.group.removeFromParent();
    this.workers.dropBody(this.body.id);
  }

  /** Number of tiles currently drawn / cached (debug overlay). */
  stats() {
    return { drawn: this.drawList.length, cached: this.meshNodes.size, maxLevel: this.maxLevel };
  }
}

// =============================================================================
// Rocks
// =============================================================================
const ROCK_CELL = 2.6;   // m
const ROCK_RANGE = 34;   // cells each way (~90 m)

function rockGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = v.clone().normalize();
    // Lumpy, faceted shape: several random planes clip the sphere.
    let r = 1;
    for (let k = 0; k < 7; k++) {
      const a = rand3(k, seed, 1, 77) * Math.PI * 2, b = Math.acos(rand3(k, seed, 2, 77) * 2 - 1);
      const pl = new THREE.Vector3(Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a));
      const d = 0.62 + rand3(k, seed, 3, 77) * 0.3;
      const dot = n.dot(pl);
      if (dot > 0) r = Math.min(r, d / dot);
    }
    r *= 0.92 + 0.08 * Math.sin(n.x * 9 + seed) * Math.sin(n.y * 7) * Math.sin(n.z * 8);
    v.copy(n).multiplyScalar(r);
    p.setXYZ(i, v.x, v.y * 0.72, v.z);
  }
  g.computeVertexNormals();
  return g;
}

class RockField {
  constructor(terrain, color) {
    this.t = terrain;
    this.group = new THREE.Group();
    const density = terrain.body.def.terrain?.rocks ?? 0;
    this.density = density * 0.22;
    this.enabled = this.density > 0;
    this.cells = new Map();
    this.anchor = new THREE.Vector3();
    this.lastCell = '';
    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
    this.baseColor = new THREE.Color().setRGB(color[0], color[1], color[2]);
    this.meshes = [11, 23, 37].map((s) => {
      const m = new THREE.InstancedMesh(rockGeometry(s), this.material, 1400);
      m.count = 0;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      this.group.add(m);
      return m;
    });
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._c = new THREE.Color();
  }

  /** Rocks of one grid cell (deterministic). */
  cell(face, i, j, n) {
    const key = `${face}:${i}:${j}`;
    let c = this.cells.get(key);
    if (c) return c;
    c = [];
    const seed = this.t.hf.seed ^ (face * 0x9e3779b1);
    if (i >= 0 && j >= 0 && i < n && j < n && rand3(i, j, 1, seed) < this.density) {
      const u = Math.max(1e-4, rand3(i, j, 2, seed));
      const size = Math.min(2.8, 0.07 * Math.pow(1 / u, 0.62));
      const s = -1 + ((i + rand3(i, j, 3, seed)) / n) * 2;
      const t = -1 + ((j + rand3(i, j, 4, seed)) / n) * 2;
      const d = faceDir(face, s, t, [0, 0, 0]);
      const dir = new THREE.Vector3(d[0], d[1], d[2]);
      const r = this.t.surfaceRadius(dir) - size * 0.28;
      c.push({
        pos: dir.clone().multiplyScalar(r), dir, size,
        spin: rand3(i, j, 5, seed) * Math.PI * 2, tilt: rand3(i, j, 6, seed) - 0.5,
        variant: Math.floor(rand3(i, j, 7, seed) * 3), shade: 0.7 + 0.5 * rand3(i, j, 8, seed),
      });
    }
    this.cells.set(key, c);
    return c;
  }

  update(playerLocal) {
    if (!this.enabled) return;
    const len = playerLocal.length();
    const dx = playerLocal.x / len, dy = playerLocal.y / len, dz = playerLocal.z / len;
    // Only near the ground (rocks are pointless from high up).
    const alt = len - this.t.surfaceRadius(new THREE.Vector3(dx, dy, dz));
    this.group.visible = alt < 400;
    if (!this.group.visible) return;
    const f = dirToFace(dx, dy, dz);
    const n = Math.round((this.t.R * Math.PI * 0.5) / ROCK_CELL);
    const ci = Math.floor(((f.s + 1) / 2) * n), cj = Math.floor(((f.t + 1) / 2) * n);
    const key = `${f.face}:${ci}:${cj}`;
    if (key === this.lastCell) return;
    this.lastCell = key;
    // New anchor near the player keeps instance matrices precise in float32.
    this.anchor.set(dx, dy, dz).multiplyScalar(len);
    this.group.position.copy(this.anchor);
    const counts = [0, 0, 0];
    const keep = new Set();
    for (let j = cj - ROCK_RANGE; j <= cj + ROCK_RANGE; j++) {
      for (let i = ci - ROCK_RANGE; i <= ci + ROCK_RANGE; i++) {
        const di = i - ci, dj = j - cj;
        if (di * di + dj * dj > ROCK_RANGE * ROCK_RANGE) continue;
        keep.add(`${f.face}:${i}:${j}`);
        for (const r of this.cell(f.face, i, j, n)) {
          const mesh = this.meshes[r.variant];
          const k = counts[r.variant];
          if (k >= mesh.instanceMatrix.count) continue;
          this._q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), r.dir);
          this._q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(r.tilt * 0.5, r.spin, r.tilt * 0.3)));
          this._m.compose(r.pos.clone().sub(this.anchor), this._q, new THREE.Vector3(r.size, r.size, r.size));
          mesh.setMatrixAt(k, this._m);
          mesh.setColorAt(k, this._c.copy(this.baseColor).multiplyScalar(r.shade));
          counts[r.variant]++;
        }
      }
    }
    this.meshes.forEach((m, i) => {
      m.count = counts[i];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
    for (const k of this.cells.keys()) if (!keep.has(k)) this.cells.delete(k);
  }

  dispose() {
    for (const m of this.meshes) { m.geometry.dispose(); m.dispose(); }
    this.material.dispose();
  }
}
