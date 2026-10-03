import * as THREE from 'three';
import { BODIES } from '../src/data/bodies.js';
import { Ephemeris } from '../src/sim/ephemeris.js';
import { AU } from '../src/constants.js';
const eph = new Ephemeris(BODIES);
const t0 = performance.now();
eph.update(new Date());
console.log('first update ms', (performance.now() - t0).toFixed(1));
const t1 = performance.now(); for (let i = 0; i < 100; i++) eph.update(Date.now() + i * 16); console.log('avg update ms', ((performance.now() - t1) / 100).toFixed(3));
const B = eph.byId;
const d = (a, b) => B[a].pos.distanceTo(B[b].pos);
console.log('Earth–Sun AU', (d('earth','sun')/AU).toFixed(4), ' Earth–Moon km', (d('earth','moon')/1000).toFixed(0));
console.log('Earth speed km/s', (B.earth.vel.length()/1000).toFixed(2), ' Moon rel speed km/s', (B.moon.vel.clone().sub(B.earth.vel).length()/1000).toFixed(3));
for (const id of ['io','europa','ganymede','callisto','titan','triton','phobos','charon','nereid']) {
  const b = B[id]; const rel = b.pos.clone().sub(b.parent.pos); const v = b.vel.clone().sub(b.parent.vel);
  const h = rel.clone().cross(v).normalize();
  const toParent = rel.clone().multiplyScalar(-1).normalize();
  const lon0 = new THREE.Vector3(1,0,0).applyQuaternion(b.quat);
  console.log(id.padEnd(9), 'dist km', (rel.length()/1000).toFixed(0).padStart(8), ' v km/s', (v.length()/1000).toFixed(3), ' orbit·pole', h.dot(b.parent.pole).toFixed(3), ' lon0·toParent', lon0.dot(toParent).toFixed(4), ' SOI km', (b.soi/1000).toFixed(0));
}
const moonX = new THREE.Vector3(1,0,0).applyQuaternion(B.moon.quat);
console.log('Moon lon0 · toEarth', moonX.dot(B.earth.pos.clone().sub(B.moon.pos).normalize()).toFixed(4), '(near side faces Earth if ≈1)');
console.log('Earth spin period h', (2*Math.PI/B.earth.omega.length()/3600).toFixed(3), ' Jupiter', (2*Math.PI/B.jupiter.omega.length()/3600).toFixed(3), ' Uranus pole·omega', B.uranus.pole.dot(B.uranus.omega.clone().normalize()).toFixed(2));
console.log('Earth axial tilt deg', (Math.acos(B.earth.pole.y)*180/Math.PI).toFixed(2), ' Uranus tilt', (Math.acos(B.uranus.pole.y)*180/Math.PI).toFixed(1));
console.log('SOI km: earth', (B.earth.soi/1000).toFixed(0), ' moon', (B.moon.soi/1000).toFixed(0), ' jupiter', (B.jupiter.soi/1000).toFixed(0));
console.log('dominant near Moon:', eph.dominantBody(B.moon.pos.clone().add(new THREE.Vector3(2e6,0,0))).id, ' near Earth:', eph.dominantBody(B.earth.pos.clone().add(new THREE.Vector3(1e7,0,0))).id, ' deep space:', eph.dominantBody(new THREE.Vector3(2*AU, 0, 0)).id);
// Where is the subsolar point on Earth right now? (lon of the Sun direction in Earth's local frame)
const sunLocal = B.sun.pos.clone().sub(B.earth.pos).normalize().applyQuaternion(B.earth.quatInv);
const lon = Math.atan2(-sunLocal.z, sunLocal.x) * 180 / Math.PI, lat = Math.asin(sunLocal.y) * 180 / Math.PI;
const now = new Date(); const utcH = now.getUTCHours() + now.getUTCMinutes()/60;
console.log('Subsolar point lat', lat.toFixed(1), 'lon', lon.toFixed(1), ' expected lon ≈', (((12 - utcH) * 15 + 540) % 360 - 180).toFixed(1), 'at UTC', utcH.toFixed(2));
