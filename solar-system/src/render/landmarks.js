// =============================================================================
// landmarks.js — the six Apollo landing sites, where they really are.
//
// Each site has the descent stage left behind (gold Kapton foil, four legs),
// the flag, and for Apollo 15–17 the Lunar Roving Vehicle. Apollo 11's flag
// lies flat: Buzz Aldrin saw the ascent engine's blast knock it over. The
// others still stand (LRO photographed their shadows), bleached white by
// fifty years of unfiltered sunlight.
// =============================================================================
import * as THREE from 'three';

const foil = new THREE.MeshStandardMaterial({ color: 0xd4a23c, metalness: 1, roughness: 0.32, flatShading: true });
const dark = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, metalness: 0.4, roughness: 0.6 });
const grey = new THREE.MeshStandardMaterial({ color: 0xb8b8b0, metalness: 0.6, roughness: 0.45 });
const white = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, metalness: 0, roughness: 0.7 });

function flagTexture(bleached) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 80;
  const g = c.getContext('2d');
  const red = bleached ? '#e9dcd8' : '#b22234', blue = bleached ? '#dfe1e8' : '#3c3b6e';
  for (let i = 0; i < 13; i++) { g.fillStyle = i % 2 ? '#f4f4f0' : red; g.fillRect(0, (i * 80) / 13, 128, 80 / 13 + 0.5); }
  g.fillStyle = blue;
  g.fillRect(0, 0, 52, 43);
  g.fillStyle = '#f4f4f0';
  for (let y = 0; y < 5; y++) for (let x = 0; x < 6; x++) g.fillRect(4 + x * 8, 4 + y * 8, 2, 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function strut(a, b, r, mat) {
  const d = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 8), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  m.castShadow = true;
  return m;
}

/** A landing site group: origin on the ground, +Y up. */
export function createApolloSite(lm) {
  const g = new THREE.Group();
  g.name = lm.name;
  const n = Number((lm.name.match(/Apollo (\d+)/) || [])[1] || 11);
  // Descent stage (the base that stayed behind).
  const stage = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 1.65, 8), foil);
  stage.position.y = 1.65;
  stage.castShadow = stage.receiveShadow = true;
  g.add(stage);
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.15, 0.12, 8), grey);
  deck.position.y = 2.5;
  g.add(deck);
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.75, 0.9, 16, 1, true), dark);
  nozzle.position.y = 0.55;
  g.add(nozzle);
  // Legs and footpads.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const top = new THREE.Vector3(Math.cos(a) * 1.9, 2.2, Math.sin(a) * 1.9);
    const foot = new THREE.Vector3(Math.cos(a) * 4.1, 0.15, Math.sin(a) * 4.1);
    g.add(strut(top, foot, 0.08, foil));
    g.add(strut(new THREE.Vector3(Math.cos(a) * 2.0, 1.0, Math.sin(a) * 2.0), foot.clone().lerp(top, 0.35), 0.05, grey));
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.5, 0.12, 16), foil);
    pad.position.copy(foot);
    pad.castShadow = true;
    g.add(pad);
  }
  // Ladder on the front leg.
  const la = Math.PI / 4;
  for (let k = 0; k < 9; k++) {
    const rung = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.04), grey);
    const f = k / 9;
    rung.position.set(Math.cos(la) * (2.2 + 1.7 * f), 2.0 - 1.8 * f, Math.sin(la) * (2.2 + 1.7 * f));
    rung.rotation.y = -la + Math.PI / 2;
    g.add(rung);
  }
  // Flag.
  const flag = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.3, 8), white);
  pole.position.y = 1.15;
  flag.add(pole);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.25, 6), white);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0.62, 2.25, 0);
  flag.add(bar);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.78, 8, 4), new THREE.MeshStandardMaterial({ map: flagTexture(n !== 11), side: THREE.DoubleSide, roughness: 0.9 }));
  // A permanent ripple, as on the real flags (they were crinkled in storage).
  const p = cloth.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 5) * 0.04);
  cloth.geometry.computeVertexNormals();
  cloth.position.set(0.62, 1.86, 0);
  cloth.castShadow = true;
  flag.add(cloth);
  flag.position.set(-6.5, 0, 4);
  if (n === 11) { flag.rotation.z = Math.PI / 2 - 0.05; flag.position.y = 0.05; }
  g.add(flag);
  // Lunar Roving Vehicle on the J-missions.
  if (n >= 15) {
    const rover = new THREE.Group();
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 2.9), grey);
    chassis.position.y = 0.55;
    rover.add(chassis);
    for (const [x, z] of [[-0.95, -1.1], [0.95, -1.1], [-0.95, 1.1], [0.95, 1.1]]) {
      const w = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.09, 8, 16), dark);
      w.rotation.y = Math.PI / 2;
      w.position.set(x, 0.38, z);
      rover.add(w);
    }
    for (const x of [-0.4, 0.4]) {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.06), grey);
      seat.position.set(x, 0.85, 0.2);
      rover.add(seat);
    }
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, 0, 0.6), white);
    dish.position.set(0, 1.5, -1.2);
    dish.rotation.x = -0.6;
    rover.add(dish);
    rover.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    rover.position.set(9, 0, -7);
    rover.rotation.y = 0.7;
    g.add(rover);
  }
  return g;
}

export const LANDMARK_MATERIALS = [foil, dark, grey, white];
