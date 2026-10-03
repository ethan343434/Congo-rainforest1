// Temporary viewer used while building the renderer (replaced by the game).
import * as THREE from 'three';
import { BODIES } from './data/bodies.js';
import { Ephemeris } from './sim/ephemeris.js';
import { Engine } from './render/engine.js';
import { Assets } from './render/assets.js';
import { WorldRenderer } from './render/world.js';

const engine = new Engine(document.getElementById('app'));
const eph = new Ephemeris(BODIES);
let simTime = Date.now();
eph.update(simTime);
const assets = new Assets(engine.renderer);
const world = new WorldRenderer(engine, eph, assets);

const view = { body: 'earth', dist: 3, az: 40, el: 12, roll: 0 };
const camWorld = new THREE.Vector3();
const camQuat = new THREE.Quaternion();
function placeCamera() {
  const b = eph.byId[view.body];
  const toSun = (view.from === 'parent' && b.parent ? b.parent.pos : eph.sun.pos).clone().sub(b.pos).normalize();
  if (b.id === 'sun') toSun.set(1, 0, 0);
  const up = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3().crossVectors(up, toSun).normalize();
  const az = (view.az * Math.PI) / 180, el = (view.el * Math.PI) / 180;
  const dir = toSun.clone().multiplyScalar(Math.cos(az) * Math.cos(el)).addScaledVector(side, Math.sin(az) * Math.cos(el)).addScaledVector(up, Math.sin(el));
  const dist = view.dist * (b.def.rings && view.dist < 6 ? b.def.rings.outer / b.radius : 1) * b.radius;
  camWorld.copy(b.pos).addScaledVector(dir, dist);
  const m = new THREE.Matrix4().lookAt(camWorld, b.pos, up);
  camQuat.setFromRotationMatrix(m);
}

const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.1);
  simTime += dt * 1000;
  eph.update(simTime);
  placeCamera();
  engine.camera.position.set(0, 0, 0);
  engine.camera.quaternion.copy(camQuat);
  world.update({ origin: camWorld, time: simTime / 1000, dt, quality: engine.quality });
  engine.render();
}

world.load((f) => (document.getElementById('load-bar').style.width = `${f * 100}%`)).then(() => {
  document.getElementById('loading').classList.remove('visible');
  window.solarReady = true;
});
frame();
window.solar = { view, eph, world, engine, setView: (o) => Object.assign(view, o) };
