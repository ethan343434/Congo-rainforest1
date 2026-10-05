// Terrain + on-foot checks (run: node --import ./tests/loader.mjs tests/terrain.test.mjs)
import * as THREE from 'three';
import { BODIES } from '../src/data/bodies.js';
import { createHeightfield } from '../src/terrain/heightfield.js';
import { buildChunk, buildIndices, faceDir, dirToFace, tileEdge, GRID } from '../src/terrain/chunkBuilder.js';
import { Walker, WALK } from '../src/sim/walker.js';

let failed = 0;
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
  if (!ok) failed++;
};
const byId = Object.fromEntries(BODIES.map((b) => [b.id, b]));

// ---- Height function ----------------------------------------------------------------------
const moon = byId.moon;
const g = moon.GM / moon.radius ** 2;
const hf = createHeightfield({ id: 'moon', radius: moon.radius, gravity: g, terrain: moon.terrain, heightmap: null });
const hf2 = createHeightfield({ id: 'moon', radius: moon.radius, gravity: g, terrain: moon.terrain, heightmap: null });
let same = true, finite = true, maxAbs = 0;
for (let i = 0; i < 2000; i++) {
  const v = new THREE.Vector3(Math.sin(i * 1.3), Math.cos(i * 0.7), Math.sin(i * 2.9)).normalize();
  const a = hf.height(v.x, v.y, v.z, 0.5), b = hf2.height(v.x, v.y, v.z, 0.5);
  if (a !== b) same = false;
  if (!Number.isFinite(a)) finite = false;
  maxAbs = Math.max(maxAbs, Math.abs(a));
}
check('Height function is deterministic (worker and physics agree)', same);
check('Heights are finite everywhere', finite, `max |h| ${maxAbs.toFixed(0)} m, bound ${hf.maxHeight.toFixed(0)} m`);
check('Heights stay within the culling bound', maxAbs <= hf.maxHeight);

// Craters: sample a fine line and look for bowls (big negative excursions).
let minH = Infinity, maxH = -Infinity;
for (let i = 0; i < 4000; i++) {
  const a = 0.3 + (i * 2) / moon.radius;
  const h = hf.height(Math.cos(a), 0.1, -Math.sin(a), 0.5);
  minH = Math.min(minH, h); maxH = Math.max(maxH, h);
}
check('An 8 km traverse of the Moon has crater-scale relief', maxH - minH > 20, `relief ${(maxH - minH).toFixed(1)} m`);

// ---- Cube-sphere mapping ---------------------------------------------------------------------
let roundTrip = 0;
for (let f = 0; f < 6; f++) {
  for (const [s, t] of [[-0.9, 0.3], [0.1, -0.7], [0.95, 0.95], [0, 0]]) {
    const d = faceDir(f, s, t, [0, 0, 0]);
    const back = dirToFace(d[0], d[1], d[2]);
    if (back.face !== f || Math.abs(back.s - s) > 1e-9 || Math.abs(back.t - t) > 1e-9) roundTrip++;
  }
}
check('Cube face mapping round-trips', roundTrip === 0, `${roundTrip} mismatches`);

// ---- Tiles ---------------------------------------------------------------------------------------
const axes = [moon.radius, moon.radius, moon.radius];
const L = 16;
const c = buildChunk(hf, axes, 2, L, 12345, 23456);
let bad = 0;
for (const arr of [c.position, c.normal, c.morph, c.dir]) for (const v of arr) if (!Number.isFinite(v)) bad++;
check('Finest-level tile has no NaNs', bad === 0);
// Tile vertex heights must equal the physics height at the same direction.
let maxErr = 0;
for (let k = 0; k < (GRID + 1) * (GRID + 1); k += 37) {
  const p = new THREE.Vector3(c.position[k * 3] + c.center[0], c.position[k * 3 + 1] + c.center[1], c.position[k * 3 + 2] + c.center[2]);
  const dir = p.clone().normalize();
  const h = hf.height(dir.x, dir.y, dir.z, c.spacing);
  maxErr = Math.max(maxErr, Math.abs(p.length() - (moon.radius + h)));
}
check('Mesh vertices sit exactly on the height function', maxErr < 0.01, `max error ${(maxErr * 1000).toFixed(2)} mm`);
check('Finest vertex spacing under 1.5 m', c.spacing < 1.5, `${c.spacing.toFixed(2)} m at level ${L}`);
const idx = buildIndices();
check('Index buffer is in range', Math.max(...idx) < (GRID + 1) ** 2 + GRID * 4);
check('Tile edge at level 0 is a quarter circumference', Math.abs(tileEdge(moon.radius, 0) - (Math.PI / 2) * moon.radius) < 1);

// ---- Walking on the Moon --------------------------------------------------------------------------
const R = moon.radius;
const body = { GM: moon.GM, quat: new THREE.Quaternion(), quatInv: new THREE.Quaternion(), pos: new THREE.Vector3(), surfaceRadiusLocal: () => R };
const flat = { surfaceRadius: () => R };
const w = new Walker();
w.spawn(body, flat, new THREE.Vector3(R, 0, 0), null);
w.cameraForward.set(0, 1, 0);
const suit = { jetpack: 100 };
w.input.forward = 1;
for (let i = 0; i < 60; i++) w.update(1 / 60, suit);
check('Running reaches full speed on the Moon as fast as anywhere', Math.abs(w.speed - WALK.run) < 0.05, `${w.speed.toFixed(2)} m/s after 1 s`);
w.input.run = true;
let tSprint = 0;
while (w.speed < WALK.sprint - 0.05 && tSprint < 10) { w.update(1 / 60, suit); tSprint += 1 / 60; }
for (let i = 0; i < 60; i++) w.update(1 / 60, suit);
check('Sprinting tops out at 60 mph, cheetah-fast', Math.abs(w.speed - WALK.sprint) < 0.05 && tSprint < 3.5 && w.onGround, `${(w.speed * 2.23694).toFixed(1)} mph after ${tSprint.toFixed(1)} s, on the ground: ${w.onGround}`);
// Jump: measure height and hang time.
w.input.forward = 0; w.input.run = false;
for (let i = 0; i < 600; i++) w.update(1 / 60, suit); // stop
w.input.jump = true;
let t = 0, peak = 0;
w.update(1 / 120, suit); w.input.jump = false; t += 1 / 120;
while (!w.onGround && t < 20) { w.update(1 / 120, suit); t += 1 / 120; peak = Math.max(peak, w.pos.length() - R); }
const expectPeak = WALK.jump ** 2 / (2 * (moon.GM / R ** 2));
check('Jump height matches lunar gravity (v²/2g)', Math.abs(peak - expectPeak) < 0.05, `${peak.toFixed(2)} m vs ${expectPeak.toFixed(2)} m, airborne ${t.toFixed(2)} s`);
// Jetpack holds you up against gravity.
w.input.jump = true; w.update(1 / 60, suit); w.input.jump = false; w.input.jet = true;
for (let i = 0; i < 60; i++) w.update(1 / 60, suit);
w.input.jet = false;
check('Jetpack climbs and burns fuel', w.pos.length() - R > 2 && suit.jetpack < 100, `${(w.pos.length() - R).toFixed(1)} m up, fuel ${suit.jetpack.toFixed(0)}%`);

console.log(failed ? `\n${failed} terrain test(s) failed.` : '\nAll terrain tests passed.');
process.exit(failed ? 1 : 0);
