// =============================================================================
// models.js — every 3D model in the game, built procedurally from three.js
// primitives (medium-poly, no downloaded assets).
//
// Conventions:
//   * Creatures face +Z. Rotate their root group around Y to turn them.
//   * Each builder returns { root, ... } plus the moving parts an animation
//     function needs. Colour is baked into vertex colours so each rigid part is
//     a single mesh sharing one material.
// =============================================================================
import * as THREE from 'three';
import { paint, jitter, mergeGeometries, place } from './utils.js';

// ---- Shared materials ----------------------------------------------------------
export const MATS = {
  solid: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 }),
  foliage: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide }),
  // Eyes reflect the flashlight at night ("eyeshine"); dayNight.js brightens them.
  eyeshine: new THREE.MeshBasicMaterial({ color: 0x111111, fog: false }),
  eyeshineRed: new THREE.MeshBasicMaterial({ color: 0x111111, fog: false }),
  flame: new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9 }),
  flameCore: new THREE.MeshBasicMaterial({ color: 0xfff0a0 }),
};

const mesh = (geos, mat = MATS.solid) => {
  const m = new THREE.Mesh(mergeGeometries(Array.isArray(geos) ? geos : [geos]), mat);
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
};

// Small geometry shorthands. All return painted, positioned geometry.
const sphere = (r, color, t = {}, segs = [12, 9]) => paint(place(new THREE.SphereGeometry(r, segs[0], segs[1]), t), color);
const cyl = (rTop, rBot, h, color, t = {}, segs = 10) => paint(place(new THREE.CylinderGeometry(rTop, rBot, h, segs, 2), t), color);
const cone = (r, h, color, t = {}, segs = 10) => paint(place(new THREE.ConeGeometry(r, h, segs), t), color);
const box = (w, h, d, color, t = {}) => paint(place(new THREE.BoxGeometry(w, h, d), t), color);
const capsule = (r, len, color, t = {}) => paint(place(new THREE.CapsuleGeometry(r, len, 6, 12), t), color);

/** A limb that hangs down from its pivot (pivot at the top). */
function limb(len, rTop, rBot, color, segs = 8) {
  return cyl(rTop, rBot, len, color, { y: -len / 2 }, segs);
}

// =============================================================================
// Vegetation (geometries used by InstancedMesh in world.js)
// =============================================================================

/** Three tree species. Each returns { trunk, canopy } geometries at unit scale. */
export function makeTreeGeometries(rng) {
  const bark = [0x4a3a2a, 0x5b4a38, 0x3d3226];
  const leaf = [0x1f3d1c, 0x2a4a22, 0x23401f, 0x1a3318];

  // --- Species A: tall emergent hardwood with buttress roots (e.g. sapele) ---
  const aTrunk = [jitter(cyl(0.38, 0.75, 22, bark[0], { y: 11 }, 12), 0.08, rng)];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rng() * 0.4;
    aTrunk.push(paint(place(new THREE.CylinderGeometry(0.02, 0.18, 2.4, 4), {
      x: Math.cos(a) * 0.95, y: 1.0, z: Math.sin(a) * 0.95, rz: Math.cos(a) * 0.55, rx: -Math.sin(a) * 0.55, sx: 1, sz: 4,
    }), bark[1]));
  }
  for (let i = 0; i < 3; i++) {
    const a = rng() * Math.PI * 2;
    aTrunk.push(cyl(0.08, 0.16, 5, bark[0], { x: Math.cos(a) * 1.9, y: 17.5, z: Math.sin(a) * 1.9, rz: Math.cos(a) * 1.0, rx: -Math.sin(a) * 1.0 }, 6));
  }
  const aCanopy = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const r = i === 0 ? 0 : 2.6;
    aCanopy.push(jitter(sphere(2.6 + rng() * 1.4, leaf[i % 4], { x: Math.cos(a) * r, y: 21 + rng() * 2, z: Math.sin(a) * r, sy: 0.55 }, [9, 6]), 0.5, rng));
  }
  for (let i = 0; i < 5; i++) { // hanging lianas
    const a = rng() * Math.PI * 2;
    const len = 5 + rng() * 9;
    aCanopy.push(cyl(0.04, 0.05, len, 0x2d4020, { x: Math.cos(a) * 2.4, y: 20 - len / 2, z: Math.sin(a) * 2.4 }, 5));
  }

  // --- Species B: mid-storey tree with layered crown and vines ---
  const bTrunk = [jitter(cyl(0.28, 0.5, 15, bark[2], { y: 7.5 }, 10), 0.06, rng)];
  for (let i = 0; i < 4; i++) {
    const a = rng() * Math.PI * 2;
    bTrunk.push(cyl(0.06, 0.12, 3.5, bark[2], { x: Math.cos(a) * 1.2, y: 9 + i * 1.3, z: Math.sin(a) * 1.2, rz: Math.cos(a) * 0.9, rx: -Math.sin(a) * 0.9 }, 6));
  }
  const bCanopy = [];
  for (let i = 0; i < 4; i++) {
    bCanopy.push(jitter(sphere(3.4 - i * 0.6, leaf[(i + 1) % 4], { x: rng() - 0.5, y: 10.5 + i * 1.6, z: rng() - 0.5, sy: 0.45 }, [9, 6]), 0.45, rng));
  }
  for (let i = 0; i < 4; i++) {
    const a = rng() * Math.PI * 2;
    const len = 4 + rng() * 6;
    bCanopy.push(cyl(0.035, 0.045, len, 0x34502a, { x: Math.cos(a) * 2.2, y: 10 - len / 2, z: Math.sin(a) * 2.2 }, 5));
  }

  // --- Species C: raffia / oil palm with drooping fronds ---
  const cTrunk = [];
  for (let i = 0; i < 7; i++) {
    cTrunk.push(cyl(0.26, 0.3, 1.7, i % 2 ? 0x5a4a35 : 0x4d3f2d, { x: Math.sin(i * 0.35) * 0.35, y: 0.85 + i * 1.6, z: 0 }, 9));
  }
  const cCanopy = [];
  const top = 11.6;
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2;
    // Each frond: two flattened segments, the outer one drooping.
    const dx = Math.cos(a), dz = Math.sin(a);
    cCanopy.push(box(0.5, 0.05, 2.4, 0x2f5a24, { x: 0.9 + dx * 1.2, y: top + 0.35, z: dz * 1.2, ry: -a + Math.PI / 2, rx: -0.35 }));
    cCanopy.push(box(0.42, 0.05, 2.4, 0x3a6a2a, { x: 0.9 + dx * 3.2, y: top - 0.55, z: dz * 3.2, ry: -a + Math.PI / 2, rx: 0.45 }));
  }
  cCanopy.push(sphere(0.6, 0x3d2f1c, { x: 0.9, y: top, sy: 0.8 }));

  return [
    { trunk: mergeGeometries(aTrunk), canopy: mergeGeometries(aCanopy), weight: 0.45 },
    { trunk: mergeGeometries(bTrunk), canopy: mergeGeometries(bCanopy), weight: 0.4 },
    { trunk: mergeGeometries(cTrunk), canopy: mergeGeometries(cCanopy), weight: 0.15 },
  ];
}

export function makeBushGeometry(rng) {
  const parts = [];
  for (let i = 0; i < 3; i++) {
    parts.push(jitter(sphere(0.8 + rng() * 0.5, [0x24401e, 0x2c4b23, 0x1d361a][i], {
      x: (rng() - 0.5) * 1.2, y: 0.6 + rng() * 0.4, z: (rng() - 0.5) * 1.2, sy: 0.8,
    }, [8, 5]), 0.3, rng));
  }
  return mergeGeometries(parts);
}

export function makeFernGeometry() {
  const parts = [];
  for (let i = 0; i < 8; i++) {
    const leafGeo = new THREE.PlaneGeometry(0.32, 1.5, 1, 5);
    const pos = leafGeo.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const y = pos.getY(v) + 0.75; // 0..1.5 along the frond
      pos.setXYZ(v, pos.getX(v) * (1 - y / 1.7), y, -0.25 * y * y); // taper + arch
    }
    leafGeo.computeVertexNormals();
    parts.push(paint(place(leafGeo, { ry: (i / 8) * Math.PI * 2, rx: 0.5 }), i % 2 ? 0x356b2a : 0x2b5a22));
  }
  return mergeGeometries(parts);
}

export function makeRockGeometry(rng) {
  return mergeGeometries([jitter(paint(new THREE.DodecahedronGeometry(0.7, 0), 0x5a5a52), 0.25, rng)]);
}

// =============================================================================
// Props
// =============================================================================

export function makeLog(length) {
  const parts = [cyl(0.42, 0.46, length, 0x4f3d2a, { rz: Math.PI / 2, y: 0.4 }, 12)];
  parts.push(box(length * 0.8, 0.06, 0.5, 0x3d5a2a, { y: 0.83 })); // moss on top
  parts.push(cyl(0.08, 0.12, 0.8, 0x4f3d2a, { x: length * 0.2, y: 0.9, rz: 0.4 }, 6)); // snapped branch
  const m = mesh(parts);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** A crashed twin-prop bush plane, broken in two. ~16 units long. */
export function makePlaneWreck() {
  const root = new THREE.Group();
  const white = 0xd8d8d0, red = 0x9a2a22, dark = 0x2a2a2a, scorch = 0x1e1a16;
  const fuselage = [];
  fuselage.push(cyl(1.25, 1.25, 7, white, { rx: Math.PI / 2, z: 1.5, y: 1.25 }, 16));
  fuselage.push(cyl(1.26, 1.26, 7.02, red, { rx: Math.PI / 2, z: 1.5, y: 1.25, sx: 1.002, sy: 0.18, sz: 1 }, 16));
  fuselage.push(cone(1.25, 2.6, white, { rx: Math.PI / 2, z: 6.3, y: 1.25 }, 16));
  fuselage.push(sphere(0.9, 0x223040, { z: 5.0, y: 1.9, sy: 0.6, sz: 1.2 })); // cockpit glass
  for (let i = 0; i < 4; i++) {
    fuselage.push(box(0.05, 0.45, 0.6, 0x1c2630, { x: 1.24, y: 1.6, z: 3.5 - i * 1.3 }));
    fuselage.push(box(0.05, 0.45, 0.6, 0x1c2630, { x: -1.24, y: 1.6, z: 3.5 - i * 1.3 }));
  }
  fuselage.push(box(0.06, 1.6, 1.0, dark, { x: 1.25, y: 1.0, z: 0.5 })); // open door
  fuselage.push(jitter(sphere(1.0, scorch, { x: 0.6, y: 1.9, z: -1.2, sy: 0.4 }), 0.2));
  const front = mesh(fuselage);
  front.rotation.set(0.08, 0.15, 0.22);
  root.add(front);

  // Broken tail section lying a few metres behind
  const tail = [];
  tail.push(cyl(0.6, 1.2, 5, white, { rx: Math.PI / 2, y: 1.0 }, 14));
  tail.push(box(0.15, 2.2, 1.8, white, { y: 2.6, z: -2.0, rx: -0.2 }));
  tail.push(box(0.16, 0.5, 1.82, red, { y: 3.3, z: -2.2, rx: -0.2 }));
  tail.push(box(3.6, 0.1, 1.2, white, { y: 1.3, z: -2.1 }));
  const tailMesh = mesh(tail);
  tailMesh.position.set(-2.5, 0, -6.5);
  tailMesh.rotation.set(0, 0.7, -0.35);
  root.add(tailMesh);

  // Wings: one still attached, one torn off and lying in the dirt
  const wingA = mesh([
    box(7, 0.18, 1.8, white, { x: 4.4, y: 1.6, z: 2.6 }),
    cyl(0.45, 0.5, 1.8, dark, { x: 3.0, y: 1.3, z: 3.4, rx: Math.PI / 2 }, 12), // engine nacelle
    box(0.1, 1.9, 0.2, 0x111111, { x: 3.0, y: 1.3, z: 4.4, rz: 0.6 }), // bent propeller
    box(0.1, 1.9, 0.2, 0x111111, { x: 3.0, y: 1.3, z: 4.4, rz: -1.1 }),
  ]);
  wingA.rotation.copy(front.rotation);
  root.add(wingA);
  const wingB = mesh([
    box(6, 0.18, 1.8, white, { y: 0.2 }),
    box(1.2, 0.2, 1.82, red, { x: -2.6, y: 0.21 }),
  ]);
  wingB.position.set(-6.5, 0.1, 2.5);
  wingB.rotation.set(0.05, -0.5, 0.12);
  root.add(wingB);

  // Scattered debris: suitcases, panels, a seat
  const debris = [];
  const cols = [0x6b3a1e, 0x2a3a5a, 0x5a5a5a, white];
  for (let i = 0; i < 9; i++) {
    const a = i * 2.1;
    const d = 5 + (i % 3) * 1.7;
    debris.push(box(0.8 + (i % 2) * 0.4, 0.35, 0.55, cols[i % 4], { x: Math.cos(a) * d, y: 0.17, z: Math.sin(a) * d, ry: a }));
  }
  debris.push(box(0.6, 0.7, 0.6, 0x3a2a20, { x: 4, y: 0.35, z: -3, ry: 0.4 }));
  root.add(mesh(debris));

  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return root;
}

/** Village hut: mud walls and a thatched cone roof. */
export function makeHut(rng) {
  const parts = [];
  parts.push(jitter(cyl(2.2, 2.35, 2.1, 0x8a6a48, { y: 1.05 }, 16), 0.06, rng));
  parts.push(box(0.9, 1.6, 0.2, 0x1a120c, { y: 0.8, z: 2.28 })); // doorway
  parts.push(jitter(cone(3.1, 2.6, 0xb59a5c, { y: 3.3 }, 16), 0.12, rng));
  parts.push(cone(3.15, 0.5, 0x9a804a, { y: 2.3 }, 16)); // thatch fringe
  const m = mesh(parts);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Campfire with animated flames. Returns { root, flames, light }. */
export function makeCampfire(scale = 1) {
  const root = new THREE.Group();
  const parts = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    parts.push(jitter(paint(new THREE.DodecahedronGeometry(0.22 * scale, 0), 0x55524c), 0.05));
    place(parts[parts.length - 1], { x: Math.cos(a) * 0.75 * scale, y: 0.12 * scale, z: Math.sin(a) * 0.75 * scale });
  }
  for (let i = 0; i < 4; i++) {
    parts.push(cyl(0.1 * scale, 0.12 * scale, 1.3 * scale, 0x3a2a1a, { y: 0.25 * scale, rz: Math.PI / 2 - 0.35, ry: (i / 4) * Math.PI }, 7));
  }
  root.add(mesh(parts));
  const flames = [];
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.28 * scale, 1.1 * scale, 7), i === 0 ? MATS.flameCore : MATS.flame);
    f.position.set((i - 1.5) * 0.12 * scale, 0.55 * scale, ((i * 7) % 3 - 1) * 0.1 * scale);
    root.add(f);
    flames.push(f);
  }
  return { root, flames };
}

export function makeTorch() {
  const root = new THREE.Group();
  root.add(mesh([cyl(0.05, 0.07, 1.8, 0x3a2a1a, { y: 0.9 }, 6), cyl(0.12, 0.08, 0.25, 0x2a1a10, { y: 1.85 }, 8)]));
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.5, 6), MATS.flame);
  flame.position.y = 2.15;
  root.add(flame);
  return { root, flame };
}

export function makeBattery() {
  return mesh([
    cyl(0.16, 0.16, 0.5, 0x222222, { y: 0.25 }, 12),
    cyl(0.165, 0.165, 0.2, 0xd9a400, { y: 0.4 }, 12),
    cyl(0.06, 0.06, 0.06, 0xbbbbbb, { y: 0.53 }, 8),
  ], new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.3, emissive: 0x332200 }));
}

export function makeMedkit() {
  return mesh([
    box(0.6, 0.38, 0.42, 0xeeeeee, { y: 0.19 }),
    box(0.4, 0.1, 0.43, 0xcc1111, { y: 0.19 }),
    box(0.12, 0.3, 0.43, 0xcc1111, { y: 0.19 }),
    box(0.2, 0.05, 0.06, 0x444444, { y: 0.41 }),
  ], new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: 0x220000 }));
}

export function makeBones(rng) {
  const parts = [];
  for (let i = 0; i < 9; i++) {
    const x = (rng() - 0.5) * 4, z = (rng() - 0.5) * 4, ry = rng() * Math.PI;
    parts.push(cyl(0.05, 0.05, 0.9, 0xd8d0b8, { x, y: 0.06, z, rz: Math.PI / 2, ry }, 6));
    parts.push(sphere(0.09, 0xd8d0b8, { x: x + Math.cos(ry) * 0.45, y: 0.07, z: z - Math.sin(ry) * 0.45 }, [6, 4]));
  }
  parts.push(sphere(0.28, 0xd8d0b8, { x: 0.8, y: 0.2, z: -0.6, sz: 1.3 })); // skull
  parts.push(sphere(0.07, 0x111111, { x: 0.68, y: 0.26, z: -0.85 }, [6, 4]));
  parts.push(sphere(0.07, 0x111111, { x: 0.92, y: 0.26, z: -0.85 }, [6, 4]));
  return mesh(parts);
}

// =============================================================================
// Creatures
// =============================================================================

function eyes(r, x, y, z, mat = MATS.eyeshine) {
  const g = new THREE.SphereGeometry(r, 8, 6);
  const a = new THREE.Mesh(g, mat);
  const b = new THREE.Mesh(g, mat);
  a.position.set(x, y, z);
  b.position.set(-x, y, z);
  return [a, b];
}

/** Four legs on pivots. Returns pivots ordered FL, FR, BL, BR. */
function addLegs(root, { hipY, frontZ, backZ, spread, len, rTop, rBot, color, hoof = null }) {
  const legs = [];
  for (const [x, z] of [[spread, frontZ], [-spread, frontZ], [spread, backZ], [-spread, backZ]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, hipY, z);
    const geos = [limb(len, rTop, rBot, color)];
    if (hoof) geos.push(cyl(rBot * 1.05, rBot * 1.15, 0.1, hoof, { y: -len + 0.05 }, 8));
    pivot.add(mesh(geos));
    root.add(pivot);
    legs.push(pivot);
  }
  return legs;
}

/** Generic four-legged walk cycle used by most creatures. */
function quadrupedAnim(parts, stride = 0.5) {
  return (t, speed) => {
    const amp = Math.min(1, speed / 2) * stride;
    const ph = t * (3 + speed * 1.6);
    const [fl, fr, bl, br] = parts.legs;
    fl.rotation.x = Math.sin(ph) * amp;
    br.rotation.x = Math.sin(ph) * amp;
    fr.rotation.x = Math.sin(ph + Math.PI) * amp;
    bl.rotation.x = Math.sin(ph + Math.PI) * amp;
    if (parts.body) parts.body.position.y = Math.abs(Math.sin(ph)) * 0.04 * Math.min(1, speed);
    if (parts.tail) parts.tail.rotation.y = Math.sin(t * 2.2) * 0.35;
    if (parts.head) parts.head.rotation.x = Math.sin(t * 0.7) * 0.06;
  };
}

export function makeLeopard(rng) {
  const root = new THREE.Group();
  const coat = 0xc79a42, belly = 0xe9dcbc, spot = 0x2a1c10;
  const bodyGeos = [capsule(0.3, 1.0, coat, { rx: Math.PI / 2, y: 0.68, sy: 1, sx: 1 }), capsule(0.24, 0.8, belly, { rx: Math.PI / 2, y: 0.58, sx: 0.9 })];
  for (let i = 0; i < 46; i++) { // rosettes
    const a = rng() * Math.PI * 1.4 - 0.2;
    const z = (rng() - 0.5) * 1.3;
    bodyGeos.push(sphere(0.05 + rng() * 0.03, spot, { x: Math.cos(a) * 0.3, y: 0.68 + Math.sin(a) * 0.3, z, sy: 0.4 }, [6, 4]));
  }
  const body = mesh(bodyGeos);
  root.add(body);
  const head = new THREE.Group();
  head.position.set(0, 0.86, 0.85);
  head.add(mesh([
    sphere(0.22, coat, { sz: 1.05 }),
    sphere(0.12, belly, { y: -0.06, z: 0.17, sx: 1.2 }),
    sphere(0.035, 0x1a1210, { y: -0.01, z: 0.27 }, [6, 4]),
    cone(0.07, 0.12, coat, { x: 0.13, y: 0.19, z: -0.03 }, 6),
    cone(0.07, 0.12, coat, { x: -0.13, y: 0.19, z: -0.03 }, 6),
  ]));
  const eyePair = eyes(0.035, 0.08, 0.06, 0.18);
  eyePair.forEach((e) => head.add(e));
  root.add(head);
  const tail = new THREE.Group();
  tail.position.set(0, 0.72, -0.78);
  const tailGeos = [];
  for (let i = 0; i < 7; i++) tailGeos.push(cyl(0.05, 0.06, 0.18, i % 2 ? coat : spot, { y: 0.03 * i - 0.02 * i * i * 0.1, z: -0.14 * i - 0.05, rx: Math.PI / 2 + 0.25 }, 6));
  tail.add(mesh(tailGeos));
  root.add(tail);
  const legs = addLegs(root, { hipY: 0.62, frontZ: 0.45, backZ: -0.45, spread: 0.17, len: 0.58, rTop: 0.08, rBot: 0.06, color: coat, hoof: belly });
  return { root, legs, body, head, tail, eyes: eyePair, anim: quadrupedAnim({ legs, body, head, tail }, 0.7) };
}

export function makeElephant() {
  const root = new THREE.Group();
  const grey = 0x6b6660, dark = 0x55504b;
  const body = mesh([jitter(sphere(1.0, grey, { y: 1.9, sx: 1.05, sy: 0.95, sz: 1.45 }, [16, 12]), 0.05), sphere(0.8, dark, { y: 1.55, sx: 0.95, sz: 1.2 })]);
  root.add(body);
  const head = new THREE.Group();
  head.position.set(0, 2.25, 1.35);
  head.add(mesh([
    sphere(0.62, grey, { sz: 1.0 }, [14, 10]),
    sphere(0.55, dark, { x: 0.55, y: -0.05, z: -0.2, sx: 0.15, sy: 1.0, sz: 0.85 }), // ears (forest elephants: rounded)
    sphere(0.55, dark, { x: -0.55, y: -0.05, z: -0.2, sx: 0.15, sy: 1.0, sz: 0.85 }),
    cone(0.06, 0.8, 0xe8dfc8, { x: 0.25, y: -0.55, z: 0.45, rx: 2.6 }, 8), // straight downward tusks
    cone(0.06, 0.8, 0xe8dfc8, { x: -0.25, y: -0.55, z: 0.45, rx: 2.6 }, 8),
  ]));
  const trunk = [];
  let parentObj = head;
  for (let i = 0; i < 6; i++) {
    const seg = new THREE.Group();
    seg.position.set(0, i === 0 ? -0.25 : -0.3, i === 0 ? 0.5 : 0.0);
    seg.add(mesh([cyl(0.17 - i * 0.02, 0.19 - i * 0.02, 0.32, grey, { y: -0.15 }, 10)]));
    parentObj.add(seg);
    parentObj = seg;
    trunk.push(seg);
  }
  const eyePair = eyes(0.05, 0.42, 0.12, 0.42);
  eyePair.forEach((e) => head.add(e));
  root.add(head);
  const tail = new THREE.Group();
  tail.position.set(0, 2.2, -1.4);
  tail.add(mesh([cyl(0.04, 0.06, 0.9, dark, { y: -0.45 }, 6)]));
  root.add(tail);
  const legs = addLegs(root, { hipY: 1.5, frontZ: 0.75, backZ: -0.75, spread: 0.55, len: 1.5, rTop: 0.3, rBot: 0.27, color: grey, hoof: 0x8a857e });
  const walk = quadrupedAnim({ legs, body, tail }, 0.35);
  const anim = (t, speed, state) => {
    walk(t, speed);
    trunk.forEach((s, i) => { s.rotation.x = Math.sin(t * 1.3 + i * 0.4) * 0.12 + (state === 'warn' ? -0.35 : 0.05); });
  };
  return { root, legs, body, head, eyes: eyePair, anim };
}

export function makeGorilla() {
  const root = new THREE.Group();
  const fur = 0x1c1a19, silver = 0x6e6c68, skin = 0x2b2522;
  const body = new THREE.Group();
  body.add(mesh([
    jitter(sphere(0.62, fur, { y: 1.15, z: 0.1, sx: 1.05, sy: 1.0, sz: 0.85 }, [14, 10]), 0.04),
    sphere(0.5, silver, { y: 1.18, z: -0.25, sx: 0.95, sy: 0.7, sz: 0.6 }), // silverback saddle
    sphere(0.45, fur, { y: 0.75, z: -0.15, sx: 1.0, sy: 0.8 }),
    sphere(0.3, skin, { y: 1.15, z: 0.55, sx: 1.1, sy: 0.9, sz: 0.4 }), // chest
  ]));
  root.add(body);
  const head = new THREE.Group();
  head.position.set(0, 1.62, 0.45);
  head.add(mesh([
    sphere(0.28, fur, { sy: 1.1 }),
    sphere(0.2, fur, { y: 0.16, z: -0.05, sy: 0.8 }), // sagittal crest
    sphere(0.17, skin, { y: -0.08, z: 0.16, sx: 1.2, sy: 0.85 }), // face
    box(0.36, 0.06, 0.08, fur, { y: 0.07, z: 0.22 }), // brow
  ]));
  const eyePair = eyes(0.03, 0.08, 0.02, 0.27);
  eyePair.forEach((e) => head.add(e));
  root.add(head);
  const arms = [];
  for (const side of [1, -1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.62, 1.45, 0.3);
    shoulder.add(mesh([limb(1.25, 0.18, 0.15, fur), sphere(0.15, skin, { y: -1.28, sx: 1.2 })]));
    root.add(shoulder);
    arms.push(shoulder);
  }
  const legs = [];
  for (const side of [1, -1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.3, 0.7, -0.25);
    hip.add(mesh([limb(0.68, 0.17, 0.13, fur), box(0.2, 0.08, 0.3, skin, { y: -0.68, z: 0.08 })]));
    root.add(hip);
    legs.push(hip);
  }
  const anim = (t, speed, state) => {
    const ph = t * (3 + speed * 1.5);
    const amp = Math.min(1, speed / 1.5) * 0.5;
    if (state === 'warn') { // chest beat
      arms[0].rotation.x = -1.6 + Math.sin(t * 16) * 0.3;
      arms[1].rotation.x = -1.6 + Math.sin(t * 16 + Math.PI) * 0.3;
      arms[0].rotation.z = 0.6; arms[1].rotation.z = -0.6;
      body.rotation.x = -0.15;
      head.rotation.x = -0.2;
    } else {
      arms[0].rotation.set(Math.sin(ph) * amp - 0.15, 0, 0.1);
      arms[1].rotation.set(Math.sin(ph + Math.PI) * amp - 0.15, 0, -0.1);
      body.rotation.x = 0.1;
      head.rotation.x = Math.sin(t * 0.6) * 0.08;
    }
    legs[0].rotation.x = Math.sin(ph + Math.PI) * amp;
    legs[1].rotation.x = Math.sin(ph) * amp;
  };
  return { root, head, eyes: eyePair, anim };
}

export function makeOkapi() {
  const root = new THREE.Group();
  const coat = 0x3b2219, stripe = 0xe8e2d6;
  const body = mesh([capsule(0.38, 1.1, coat, { rx: Math.PI / 2, y: 1.25 })]);
  root.add(body);
  const head = new THREE.Group();
  head.position.set(0, 1.55, 0.8);
  head.add(mesh([
    cyl(0.14, 0.2, 0.9, coat, { y: 0.35, z: 0.1, rx: 0.45 }, 10), // neck
    capsule(0.15, 0.4, coat, { y: 0.8, z: 0.35, rx: 1.3 }),
    sphere(0.12, 0x8a7a6a, { y: 0.68, z: 0.62 }),
    cone(0.08, 0.28, coat, { x: 0.13, y: 0.98, z: 0.25, rz: -0.5 }, 6),
    cone(0.08, 0.28, coat, { x: -0.13, y: 0.98, z: 0.25, rz: 0.5 }, 6),
  ]));
  const eyePair = eyes(0.035, 0.12, 0.84, 0.45);
  eyePair.forEach((e) => head.add(e));
  root.add(head);
  const legs = [];
  for (const [x, z] of [[0.2, 0.5], [-0.2, 0.5], [0.2, -0.5], [-0.2, -0.5]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 1.15, z);
    const geos = [];
    for (let s = 0; s < 7; s++) { // the okapi's famous zebra-striped legs
      const col = z < 0 && s >= 1 && s <= 4 ? (s % 2 ? stripe : coat) : s === 5 ? stripe : coat;
      geos.push(cyl(0.075, 0.07, 0.165, col, { y: -0.08 - s * 0.165 }, 8));
    }
    pivot.add(mesh(geos));
    root.add(pivot);
    legs.push(pivot);
  }
  return { root, head, eyes: eyePair, anim: quadrupedAnim({ legs, body, head }, 0.55) };
}

export function makeDuiker() {
  const root = new THREE.Group();
  const coat = 0x8a4a22;
  const body = mesh([capsule(0.17, 0.5, coat, { rx: Math.PI / 2, y: 0.5 }), capsule(0.12, 0.4, 0xb08060, { rx: Math.PI / 2, y: 0.44 })]);
  root.add(body);
  const head = new THREE.Group();
  head.position.set(0, 0.62, 0.38);
  head.add(mesh([
    capsule(0.08, 0.16, coat, { y: 0.06, z: 0.06, rx: 1.1 }),
    cone(0.025, 0.12, 0x2a1a10, { x: 0.04, y: 0.17, z: 0.02, rx: -0.4 }, 5),
    cone(0.025, 0.12, 0x2a1a10, { x: -0.04, y: 0.17, z: 0.02, rx: -0.4 }, 5),
  ]));
  const eyePair = eyes(0.02, 0.06, 0.09, 0.1);
  eyePair.forEach((e) => head.add(e));
  root.add(head);
  const legs = addLegs(root, { hipY: 0.45, frontZ: 0.22, backZ: -0.22, spread: 0.08, len: 0.45, rTop: 0.035, rBot: 0.025, color: coat, hoof: 0x1a1a1a });
  return { root, head, eyes: eyePair, anim: quadrupedAnim({ legs, body, head }, 0.8) };
}

export function makeHippo() {
  const root = new THREE.Group();
  const hide = 0x6e5a5a, pink = 0x9b7470;
  const body = mesh([jitter(sphere(1.0, hide, { y: 1.0, sx: 1.0, sy: 0.85, sz: 1.6 }, [16, 12]), 0.04), sphere(0.85, pink, { y: 0.75, sz: 1.4, sx: 0.9 })]);
  root.add(body);
  const head = new THREE.Group();
  head.position.set(0, 1.25, 1.55);
  head.add(mesh([
    sphere(0.6, hide, { sx: 1.0, sy: 0.75, sz: 1.1 }, [14, 10]),
    sphere(0.55, hide, { y: -0.05, z: 0.55, sx: 1.25, sy: 0.6 }),
    sphere(0.1, hide, { x: 0.3, y: 0.42, z: -0.2 }, [6, 4]),
    sphere(0.1, hide, { x: -0.3, y: 0.42, z: -0.2 }, [6, 4]),
  ]));
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.2, 0.3);
  jaw.add(mesh([
    sphere(0.5, pink, { y: -0.12, z: 0.3, sx: 1.2, sy: 0.4 }),
    cone(0.06, 0.35, 0xf0e8d0, { x: 0.3, y: 0.08, z: 0.55 }, 6),
    cone(0.06, 0.35, 0xf0e8d0, { x: -0.3, y: 0.08, z: 0.55 }, 6),
  ]));
  head.add(jaw);
  const eyePair = eyes(0.05, 0.25, 0.32, 0.12, MATS.eyeshineRed);
  eyePair.forEach((e) => head.add(e));
  root.add(head);
  const legs = addLegs(root, { hipY: 0.65, frontZ: 0.9, backZ: -0.9, spread: 0.55, len: 0.65, rTop: 0.28, rBot: 0.25, color: hide });
  const walk = quadrupedAnim({ legs, body, head }, 0.4);
  const anim = (t, speed, state) => {
    walk(t, speed);
    jaw.rotation.x = state === 'attack' || state === 'warn' ? 0.9 + Math.sin(t * 6) * 0.1 : 0.05;
  };
  return { root, head, eyes: eyePair, anim };
}

export function makeCrocodile() {
  const root = new THREE.Group();
  const olive = 0x3b4a2a, belly = 0x8c8a5c, dark = 0x2a3320;
  const bodyGeos = [capsule(0.38, 1.6, olive, { rx: Math.PI / 2, y: 0.3, sx: 1.25, sy: 0.6 }), capsule(0.32, 1.4, belly, { rx: Math.PI / 2, y: 0.18, sx: 1.2, sy: 0.4 })];
  for (let i = 0; i < 9; i++) { // armoured scutes along the back
    bodyGeos.push(cone(0.06, 0.12, dark, { x: 0.15, y: 0.55, z: 0.8 - i * 0.2 }, 4));
    bodyGeos.push(cone(0.06, 0.12, dark, { x: -0.15, y: 0.55, z: 0.8 - i * 0.2 }, 4));
  }
  const body = mesh(bodyGeos);
  root.add(body);
  const head = new THREE.Group();
  head.position.set(0, 0.35, 1.2);
  const teeth = [];
  for (let i = 0; i < 7; i++) {
    teeth.push(cone(0.025, 0.08, 0xeeeedd, { x: 0.17, y: -0.06, z: 0.15 + i * 0.13, rx: Math.PI }, 4));
    teeth.push(cone(0.025, 0.08, 0xeeeedd, { x: -0.17, y: -0.06, z: 0.15 + i * 0.13, rx: Math.PI }, 4));
  }
  head.add(mesh([
    box(0.42, 0.18, 1.0, olive, { y: 0.0, z: 0.5 }),
    box(0.3, 0.14, 0.4, olive, { y: 0.0, z: 1.1 }),
    sphere(0.09, dark, { x: 0.13, y: 0.13, z: 0.1 }, [6, 4]), // raised eye bumps
    sphere(0.09, dark, { x: -0.13, y: 0.13, z: 0.1 }, [6, 4]),
    ...teeth,
  ]));
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.08, 0.05);
  jaw.add(mesh([box(0.38, 0.1, 1.3, belly, { y: -0.05, z: 0.65 })]));
  head.add(jaw);
  const eyePair = eyes(0.04, 0.13, 0.19, 0.12, MATS.eyeshineRed);
  eyePair.forEach((e) => head.add(e));
  root.add(head);
  const tail = [];
  let parentObj = root;
  for (let i = 0; i < 7; i++) {
    const seg = new THREE.Group();
    seg.position.set(0, i === 0 ? 0.3 : 0, i === 0 ? -1.15 : -0.32);
    seg.add(mesh([box(0.5 - i * 0.06, 0.32 - i * 0.03, 0.34, olive, { z: -0.16 }), cone(0.05, 0.12, dark, { y: 0.2 - i * 0.015, z: -0.16 }, 4)]));
    parentObj.add(seg);
    parentObj = seg;
    tail.push(seg);
  }
  const legs = [];
  for (const [x, z] of [[0.42, 0.55], [-0.42, 0.55], [0.42, -0.55], [-0.42, -0.55]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.25, z);
    pivot.add(mesh([cyl(0.08, 0.07, 0.4, olive, { x: Math.sign(x) * 0.15, y: -0.12, rz: Math.sign(x) * 1.0 }, 6)]));
    root.add(pivot);
    legs.push(pivot);
  }
  const anim = (t, speed, state) => {
    const ph = t * (2 + speed * 2);
    tail.forEach((s, i) => { s.rotation.y = Math.sin(ph - i * 0.6) * (0.12 + Math.min(1, speed) * 0.15); });
    legs.forEach((l, i) => { l.rotation.y = Math.sin(ph + (i % 3 ? Math.PI : 0)) * 0.5 * Math.min(1, speed); });
    jaw.rotation.x = state === 'attack' ? 0.7 : state === 'chase' ? 0.25 : 0.02;
  };
  return { root, head, eyes: eyePair, anim };
}

/**
 * Snakes are a chain of spheres that slither with a travelling sine wave.
 * kind: 'viper' (Gaboon viper: thick, camouflaged) or 'mamba' (green mamba).
 */
export function makeSnake(kind) {
  const root = new THREE.Group();
  const viper = kind === 'viper';
  const count = viper ? 16 : 22;
  const spacing = viper ? 0.13 : 0.12;
  const pattern = viper ? [0xa08a62, 0x5a3e2a, 0x7a6a8a, 0x3a2a1e] : [0x3f8a2a, 0x4a9a30];
  const segments = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const r = (viper ? 0.13 : 0.06) * (i === 0 ? 1.15 : (1 - t * 0.75) * (t < 0.15 ? 0.85 + t : 1));
    const geo = viper && i === 0
      ? paint(place(new THREE.SphereGeometry(r, 10, 7), { sx: 1.35, sy: 0.6, sz: 1.3 }), 0x8a7452) // broad triangular head
      : paint(new THREE.SphereGeometry(r, 9, 6), pattern[i % pattern.length]);
    const seg = new THREE.Mesh(geo, MATS.solid);
    seg.position.z = -i * spacing;
    seg.position.y = r * 0.8;
    root.add(seg);
    segments.push(seg);
  }
  const eyePair = eyes(viper ? 0.025 : 0.015, viper ? 0.1 : 0.04, viper ? 0.1 : 0.06, 0.05);
  eyePair.forEach((e) => segments[0].add(e));
  const baseY = segments.map((s) => s.position.y);
  const anim = (t, speed, state) => {
    const ph = t * (2 + speed * 5);
    const amp = state === 'attack' ? 0.05 : viper ? 0.1 : 0.16;
    for (let i = 0; i < count; i++) {
      const s = segments[i];
      s.position.x = Math.sin(ph - i * 0.55) * amp * Math.min(1, i / 3 + 0.2);
      s.position.y = baseY[i];
    }
    if (state === 'attack' || state === 'warn') { // rear up, ready to strike
      const lift = state === 'attack' ? 0.45 : 0.3;
      for (let i = 0; i < 5; i++) segments[i].position.y = baseY[i] + lift * (1 - i / 5);
    }
  };
  return { root, head: segments[0], eyes: eyePair, anim };
}

/** A small monkey sitting in the trees (decorative, flees upward). */
export function makeMonkey() {
  const root = new THREE.Group();
  const fur = 0x4a3a2c, face = 0xc8a888;
  root.add(mesh([
    sphere(0.22, fur, { y: 0.25, sy: 1.2 }),
    sphere(0.15, fur, { y: 0.6 }),
    sphere(0.09, face, { y: 0.58, z: 0.1, sx: 1.1 }),
    cyl(0.04, 0.04, 0.45, fur, { x: 0.2, y: 0.25, z: 0.08, rx: 0.8, rz: 0.4 }, 5),
    cyl(0.04, 0.04, 0.45, fur, { x: -0.2, y: 0.25, z: 0.08, rx: 0.8, rz: -0.4 }, 5),
    cyl(0.03, 0.02, 0.8, fur, { y: -0.2, z: -0.25, rx: 0.5 }, 5),
  ]));
  const eyePair = eyes(0.02, 0.04, 0.62, 0.13);
  eyePair.forEach((e) => root.add(e));
  return { root, eyes: eyePair };
}

// =============================================================================
// People (village + the survivor), with pose-able joints for the cutscene
// =============================================================================

/**
 * opts: { skin, top, bottom, hair, height (m), dress (bool), headwrap (color) }
 * Returns { root, parts: { hips, torso, head, armL, armR, foreL, foreR, legL, legR, shinL, shinR } }
 */
export function makeHuman(opts) {
  const h = opts.height ?? 1.75;
  const s = h / 1.75;
  const root = new THREE.Group();
  const legLen = 0.86 * s;
  const torsoLen = 0.58 * s;

  const hips = new THREE.Group();
  hips.position.y = legLen;
  root.add(hips);

  const torso = new THREE.Group();
  hips.add(torso);
  const torsoGeos = [
    capsule(0.17 * s, torsoLen - 0.1 * s, opts.top, { y: torsoLen / 2 + 0.02 * s, sx: 1.15, sz: 0.75 }),
    cyl(0.07 * s, 0.08 * s, 0.12 * s, opts.skin, { y: torsoLen + 0.12 * s }, 8), // neck
  ];
  if (opts.dress) torsoGeos.push(cyl(0.2 * s, 0.34 * s, 0.75 * s, opts.bottom, { y: -0.3 * s }, 14));
  if (opts.torn) torsoGeos.push(box(0.12 * s, 0.1 * s, 0.02, 0x3a2a20, { x: 0.08 * s, y: torsoLen * 0.6, z: 0.13 * s, rz: 0.4 }));
  torso.add(mesh(torsoGeos));

  const head = new THREE.Group();
  head.position.y = torsoLen + 0.3 * s;
  const headGeos = [
    sphere(0.12 * s, opts.skin, { sy: 1.12 }),
    sphere(0.125 * s, opts.hair, { y: 0.04 * s, z: -0.015 * s, sy: 0.9 }),
    sphere(0.018 * s, 0x111111, { x: 0.045 * s, y: 0.02 * s, z: 0.105 * s }, [6, 4]),
    sphere(0.018 * s, 0x111111, { x: -0.045 * s, y: 0.02 * s, z: 0.105 * s }, [6, 4]),
    sphere(0.025 * s, opts.skin, { y: -0.015 * s, z: 0.12 * s }, [6, 4]),
  ];
  if (opts.headwrap) headGeos.push(sphere(0.135 * s, opts.headwrap, { y: 0.08 * s, z: -0.02 * s, sy: 0.75 }));
  head.add(mesh(headGeos));
  torso.add(head);

  const arm = (side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.22 * s, torsoLen - 0.02 * s, 0);
    shoulder.add(mesh([limb(0.3 * s, 0.055 * s, 0.05 * s, opts.sleeve ?? opts.top)]));
    const elbow = new THREE.Group();
    elbow.position.y = -0.3 * s;
    elbow.add(mesh([limb(0.27 * s, 0.045 * s, 0.04 * s, opts.skin), sphere(0.045 * s, opts.skin, { y: -0.29 * s })]));
    shoulder.add(elbow);
    torso.add(shoulder);
    return [shoulder, elbow];
  };
  const [armL, foreL] = arm(1);
  const [armR, foreR] = arm(-1);

  const leg = (side) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.1 * s, 0, 0);
    hip.add(mesh([limb(0.44 * s, 0.075 * s, 0.06 * s, opts.dress ? opts.skin : opts.bottom)]));
    const knee = new THREE.Group();
    knee.position.y = -0.44 * s;
    knee.add(mesh([limb(0.4 * s, 0.055 * s, 0.045 * s, opts.dress ? opts.skin : opts.bottom), box(0.09 * s, 0.06 * s, 0.22 * s, 0x2a1e16, { y: -0.41 * s, z: 0.05 * s })]));
    hip.add(knee);
    hips.add(hip);
    return [hip, knee];
  };
  const [legL, shinL] = leg(1);
  const [legR, shinR] = leg(-1);

  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { root, parts: { hips, torso, head, armL, armR, foreL, foreR, legL, legR, shinL, shinR }, legLen };
}

const DOWN = new THREE.Vector3(0, -1, 0);
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _v = new THREE.Vector3();
/**
 * Point a hanging limb along `dir` (given in the torso's frame). For a forearm,
 * pass its upper arm as `parent` so the direction is converted into that frame.
 */
function aimLimb(limbGroup, parent, dir, amount) {
  _v.set(dir[0], dir[1], dir[2]).normalize();
  if (parent) _v.applyQuaternion(_qi.copy(parent.quaternion).invert());
  _q.setFromUnitVectors(DOWN, _v);
  limbGroup.quaternion.identity().slerp(_q, amount);
}

/** Simple pose helpers for human figures. */
export const Pose = {
  walk(p, t, speed = 1) {
    const ph = t * 7 * speed;
    const a = 0.55 * Math.min(1, speed);
    p.legL.rotation.x = Math.sin(ph) * a;
    p.legR.rotation.x = -Math.sin(ph) * a;
    p.shinL.rotation.x = Math.max(0, -Math.sin(ph)) * a * 1.2;
    p.shinR.rotation.x = Math.max(0, Math.sin(ph)) * a * 1.2;
    p.armL.rotation.set(-Math.sin(ph) * a * 0.8, 0, 0.08);
    p.armR.rotation.set(Math.sin(ph) * a * 0.8, 0, -0.08);
    p.foreL.rotation.x = -0.3;
    p.foreR.rotation.x = -0.3;
    p.torso.rotation.x = 0.05 * speed;
  },
  idle(p, t) {
    for (const k of ['legL', 'legR', 'shinL', 'shinR']) p[k].rotation.x = 0;
    p.armL.rotation.set(Math.sin(t) * 0.03, 0, 0.1);
    p.armR.rotation.set(-Math.sin(t) * 0.03, 0, -0.1);
    p.foreL.rotation.x = -0.1;
    p.foreR.rotation.x = -0.1;
    p.torso.rotation.x = Math.sin(t * 1.3) * 0.015;
  },
  hug(p, t, amount = 1) {
    for (const k of ['legL', 'legR', 'shinL', 'shinR']) p[k].rotation.x = 0;
    // Upper arms reach forward and in; forearms wrap around the other person.
    aimLimb(p.armL, null, [-0.35, -0.3, 0.88], amount);
    aimLimb(p.armR, null, [0.35, -0.3, 0.88], amount);
    aimLimb(p.foreL, p.armL, [-0.95, -0.05, 0.3], amount);
    aimLimb(p.foreR, p.armR, [0.95, -0.05, 0.3], amount);
    p.torso.rotation.x = 0.08 * amount + Math.sin(t * 2) * 0.02 * amount; // gentle sway
    p.head.rotation.y = 0.35 * amount;
  },
  wave(p, t) {
    Pose.idle(p, t);
    p.armR.rotation.set(-0.3, 0, -2.6);
    p.foreR.rotation.set(0, 0, Math.sin(t * 8) * 0.5);
  },
  cheer(p, t) {
    Pose.idle(p, t);
    const b = Math.sin(t * 6) * 0.15;
    p.armL.rotation.set(0, 0, 2.7 + b);
    p.armR.rotation.set(0, 0, -2.7 - b);
  },
};
