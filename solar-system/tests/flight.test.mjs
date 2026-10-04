// Flight-model tests. Run:  node --import ./tests/loader.mjs tests/flight.test.mjs
import * as THREE from 'three';
import { BODIES } from '../src/data/bodies.js';
import { Ephemeris } from '../src/sim/ephemeris.js';
import { ShipSim, SHIP } from '../src/sim/ship.js';
import { ShipSystems } from '../src/sim/hazards.js';
import { AU, C_LIGHT } from '../src/constants.js';

const START = Date.UTC(2026, 9, 3, 12, 0, 0);
let failures = 0;
const results = [];
function check(name, ok, detail) {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}

function setup(bodyId, altitude, opts = {}) {
  const eph = new Ephemeris(BODIES);
  eph.update(START);
  const ship = new ShipSim(eph);
  const b = eph.byId[bodyId];
  const dir = (opts.dir || new THREE.Vector3(1, 0.2, 0.3)).normalize();
  const refR = b.surfaceRadiusLocal(b.toLocal(dir.clone()));
  ship.placeNear(b, b.pos.clone().addScaledVector(dir, refR + altitude));
  ship.lookAt(b.pos);
  ship.flightAssist = opts.fa ?? true;
  ship.updateTelemetry();
  return { eph, ship, b, t: 0 };
}

function run(ctx, seconds, dt = 1 / 60, each) {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    ctx.t += dt;
    if (i % 30 === 0) ctx.eph.update(START + ctx.t * 1000);
    ctx.ship.update(dt);
    if (each && each(ctx.t) === false) break;
  }
}

// 1. Flight-assist hover above the Moon.
{
  const c = setup('moon', 10000);
  const a0 = c.ship.telemetry.altitude;
  run(c, 60);
  const drift = Math.abs(c.ship.telemetry.altitude - a0);
  check('Flight assist hovers against lunar gravity', drift < 30, `drift ${drift.toFixed(2)} m in 60 s`);
}

// 2. Free fall on the Moon (assist off): realistic fall time, crash at ~57 m/s.
{
  const c = setup('moon', 1000, { fa: false });
  let tImpact = null, impactSpeed = null;
  run(c, 80, 1 / 120, () => {
    const ev = c.ship.events.find((e) => e.type === 'crash' || e.type === 'impact' || e.type === 'landed');
    if (ev) { tImpact = c.t; impactSpeed = ev.speed; return false; }
  });
  const expected = Math.sqrt((2 * 1000) / 1.625);
  check('Lunar free fall time matches √(2h/g)', tImpact && Math.abs(tImpact - expected) < 1.0, `${tImpact?.toFixed(2)} s vs ${expected.toFixed(2)} s`);
  const crash = c.ship.events.find((e) => e.type === 'crash');
  check('A 57 m/s lunar impact is a survivable crash landing', crash?.survivable && c.ship.mode === 'landed', `impact ${impactSpeed?.toFixed(1)} m/s, ship ${c.ship.mode}`);
}

// 3. One full circular orbit of the Moon at 100 km (assist off).
{
  const c = setup('moon', 100e3, { fa: false });
  const r0 = c.ship.rel.length();
  const v = Math.sqrt(c.b.GM / r0);
  const tangent = new THREE.Vector3().crossVectors(c.b.pole, c.ship.rel).normalize();
  c.ship.vel.copy(tangent).multiplyScalar(v);
  const period = (2 * Math.PI * r0) / v;
  let minR = Infinity, maxR = 0;
  run(c, period, 1 / 30, () => { const r = c.ship.rel.length(); minR = Math.min(minR, r); maxR = Math.max(maxR, r); });
  const back = c.ship.rel.clone().normalize().dot(new THREE.Vector3(1, 0.2, 0.3).normalize());
  check('Circular lunar orbit stays circular for a full period', (maxR - minR) / r0 < 0.004, `radius varied ${((maxR - minR) / 1000).toFixed(2)} km, period ${(period / 60).toFixed(1)} min`);
  check('Ship returns to its starting point after one period', back > 0.995, `cos = ${back.toFixed(5)}`);
}

// 4–6. Autopilot pulse journeys.
for (const [from, to, maxTime] of [['earth', 'moon', 40], ['earth', 'mars', 90], ['earth', 'neptune', 120], ['earth', 'sun', 90], ['mars', 'jupiter', 120]]) {
  const c = setup(from, { earth: 15000e3, mars: 7000e3 }[from]);
  const target = c.eph.byId[to];
  c.ship.engageAutopilot(target);
  let arrived = null, maxSpeed = 0, minClear = Infinity, burned = false;
  run(c, maxTime + 30, 1 / 30, (t) => {
    maxSpeed = Math.max(maxSpeed, c.ship.telemetry.speed);
    const wp = c.ship.worldPos();
    const sunD = wp.distanceTo(c.eph.sun.pos);
    if (sunD < 0.08 * AU) burned = true;
    for (const b of c.eph.bodies) {
      const cl = wp.distanceTo(b.pos) - b.radius;
      if (cl < minClear) minClear = cl;
    }
    if (c.ship.events.some((e) => e.type === 'arrived')) { arrived = t; return false; }
  });
  const dist = c.ship.worldPos().distanceTo(target.pos);
  const want = c.ship.arrivalDistance(target);
  check(`Autopilot ${from} → ${to} arrives in time`, arrived !== null && arrived < maxTime,
    `${arrived?.toFixed(1)} s, top speed ${(maxSpeed / C_LIGHT).toFixed(0)} c, ends ${(dist / want).toFixed(2)}× arrival distance`);
  check(`Autopilot ${from} → ${to} never grazes a body or the Sun`, minClear > 0 && !burned, `closest surface ${(minClear / 1000).toFixed(0)} km`);
}

// 7. Earth's barrier stops a dive.
{
  const c = setup('earth', 1500e3, { fa: false });
  c.ship.vel.copy(c.ship.rel).normalize().multiplyScalar(-8000);
  let minAlt = Infinity, bounced = false;
  run(c, 200, 1 / 60, () => {
    minAlt = Math.min(minAlt, c.ship.rel.length() - c.b.radius);
    if (c.ship.events.some((e) => e.type === 'barrier')) bounced = true;
  });
  check('Earth barrier keeps ships above 600 km', bounced && minAlt >= 600e3 - 10, `lowest ${(minAlt / 1000).toFixed(1)} km`);
}

// 8. Auto-land on the Moon from 600 m.
{
  const c = setup('moon', 600);
  c.ship.updateTelemetry();
  const ok = c.ship.autoLand();
  let landedSpeed = null;
  run(c, 240, 1 / 60, () => {
    const ev = c.ship.events.find((e) => e.type === 'landed' || e.type === 'crash');
    if (ev) { landedSpeed = ev.type === 'landed' ? ev.speed : -1; return false; }
  });
  check('Auto-land touches down gently on the Moon', ok && landedSpeed !== null && landedSpeed >= 0 && landedSpeed < SHIP.safeTouchdown && c.ship.mode === 'landed', `touchdown ${landedSpeed?.toFixed(2)} m/s after ${c.t.toFixed(0)} s`);
  // Stays put on the rotating Moon.
  const p0 = c.ship.landed.local.clone();
  run(c, 30);
  check('Landed ship stays fixed to the rotating surface', c.ship.landed && c.ship.landed.local.distanceTo(p0) < 1e-6);
}

// 9. Jupiter: engines can't hold you against 2.5 g at the cloud tops.
{
  const c = setup('jupiter', 2000);
  const a0 = c.ship.telemetry.altitude;
  run(c, 20);
  const sank = a0 - c.ship.telemetry.altitude;
  check('Flight assist cannot hover at Jupiter’s cloud tops (sinks)', sank > 100, `sank ${sank.toFixed(0)} m in 20 s, g = ${c.ship.telemetry.gravity.toFixed(1)} m/s²`);
}

// 10. Sphere-of-influence handover keeps position continuous (Earth → Moon).
{
  const c = setup('moon', 70000e3);
  // Point at the Moon and thrust; watch for the handover.
  c.ship.flightAssist = false;
  const moon = c.eph.byId.moon;
  c.ship.placeNear(c.eph.byId.earth, moon.pos.clone().add(new THREE.Vector3(moon.soi * 1.002, 0, 0)));
  c.ship.vel.set(-4000, 0, 0).add(moon.vel).sub(c.eph.byId.earth.vel);
  let prev = c.ship.worldPos(), maxJump = 0, switched = false;
  // Ephemeris every step so planetary motion is smooth (the game does this per frame).
  const steps = 60 * 60;
  for (let i = 0; i < steps; i++) {
    c.t += 1 / 60;
    c.eph.update(START + c.t * 1000);
    c.ship.update(1 / 60);
    const p = c.ship.worldPos();
    const parentStep = c.ship.parent.vel.length() / 60;
    maxJump = Math.max(maxJump, p.distanceTo(prev) - parentStep);
    prev = p;
    if (c.ship.parent.id === 'moon') switched = true;
  }
  if (false) run(c, 0, 1 / 60, () => {
    const p = c.ship.worldPos();
    maxJump = Math.max(maxJump, p.distanceTo(prev));
    prev = p;
    if (c.ship.parent.id === 'moon') switched = true;
  });
  check('Sphere-of-influence handover is seamless', switched && maxJump < 4000 / 60 + 1100 / 60 + 50, `largest step beyond orbital motion ${maxJump.toFixed(1)} m`);
}

// 11. Cruise engines: 0.9 c in open space, never more, and they slow you on approach.
{
  const c = setup('earth', 1.9e6, { dir: new THREE.Vector3(0, 0, 1) });
  c.ship.lookAt(c.ship.worldPos().add(new THREE.Vector3(1, 0, 0).multiplyScalar(1e12)));
  c.ship.input.thrust = 1;
  let tReach = null, vMax = 0;
  run(c, 40, 1 / 60, (t) => {
    const v = c.ship.vel.length();
    vMax = Math.max(vMax, v);
    if (tReach === null && v > 0.899 * C_LIGHT) tReach = t;
  });
  check('Holding W reaches 0.9 c within 25 s', tReach !== null && tReach < 25, `${tReach?.toFixed(1)} s`);
  check('Speed never exceeds 0.9 c', vMax <= 0.9 * C_LIGHT + 1, `${(vMax / C_LIGHT).toFixed(4)} c`);
  c.ship.input.thrust = 0;
  const t0 = c.t;
  run(c, 60, 1 / 60, () => c.ship.vel.length() > 50);
  check('Flight assist brakes from 0.9 c within 30 s', c.t - t0 < 30, `${(c.t - t0).toFixed(1)} s`);

  const m = setup('earth', 1.9e6, { fa: false });
  const moon = m.eph.byId.moon;
  m.ship.input.thrust = 1;
  m.ship.input.boost = true;
  let minClear = Infinity, tArrive = null, vAt50 = null;
  run(m, 120, 1 / 60, (t) => {
    m.ship.lookAt(moon.pos);
    const clear = m.ship.surfaceInfo(moon, m.ship.worldPos().sub(moon.pos)).ground;
    minClear = Math.min(minClear, clear);
    if (vAt50 === null && clear < 50000) vAt50 = m.ship.vel.clone().add(m.ship.parent.vel).sub(moon.vel).length();
    if (clear < 1000) { tArrive = t; return false; }
    return m.ship.mode === 'flight';
  });
  const v = m.ship.vel.clone().add(m.ship.parent.vel).sub(moon.vel).length();
  check('Full-throttle approach slows down before reaching the Moon', minClear > 0 && vAt50 < 51000, `${(vAt50 / 1000).toFixed(2)} km/s at 50 km`);
  check('…and arrives at landing speed, quickly', m.ship.mode === 'flight' && v < 1100 && tArrive < 60, `${v.toFixed(0)} m/s at 1 km after ${tArrive?.toFixed(1)} s`);
  // Coast down to the ground with no thrust: the limiter holds 200 m/s at most.
  m.ship.input.thrust = 0;
  m.ship.input.boost = false;
  let vLow = null;
  run(m, 30, 1 / 60, () => {
    const clear = m.ship.surfaceInfo(moon, m.ship.worldPos().sub(moon.pos)).ground;
    if (clear < 150) { vLow = m.ship.vel.clone().add(m.ship.parent.vel).sub(moon.vel).length(); return false; }
  });
  check('Over airless ground the limiter slows you to 200 m/s', vLow !== null && vLow <= 201, `${vLow?.toFixed(0)} m/s below 150 m`);
}

// 12. Mars: auto-land from the warp arrival point, and entries with and without flight assist.
{
  const arrive = (fa) => {
    const c = setup('mars', 1, { fa });
    const m = c.b;
    const dir = c.eph.sun.pos.clone().sub(m.pos).normalize();
    c.ship.placeNear(m, m.pos.clone().addScaledVector(dir, c.ship.arrivalDistance(m)));
    c.ship.lookAt(m.pos);
    c.ship.flightAssist = fa;
    c.ship.updateTelemetry();
    return c;
  };
  const a = arrive(true);
  check('Auto-land is available from the warp arrival point over Mars', a.ship.autoLand());
  let touch = null;
  const hull = new ShipSystems(); // heat damage on
  run(a, 60, 1 / 60, (t) => {
    const tel = a.ship.telemetry;
    hull.update({ dt: 1 / 60, now: t, solarFlux: 590, heatFlux: tel.heatFlux, dynPressure: tel.dynPressure, pressure: tel.pressure, airTemp: tel.temperature, airDensity: tel.density, radiation: 0, ringHazard: 0 });
    const ev = a.ship.events.find((e) => ['landed', 'crash', 'impact'].includes(e.type));
    a.ship.events.length = 0;
    if (ev) { touch = { ...ev, t }; return false; }
  });
  check('Auto-land touches down gently on Mars in 10 seconds, from 5,400 km up', touch?.type === 'landed' && Math.abs(touch.t - SHIP.autoLandTime) < 0.1 && touch.speed < SHIP.safeTouchdown, `${touch?.type} at ${touch?.speed?.toFixed(1)} m/s after ${touch?.t?.toFixed(2)} s`);
  check('…through the atmosphere without heat or air damage', !hull.destroyed && hull.hull === 100, `hull ${hull.hull.toFixed(0)}%`);

  const entry = (fa) => {
    const c = arrive(fa);
    const sys = new ShipSystems();
    c.ship.input.thrust = 1;
    let fate = 'still flying';
    run(c, 120, 1 / 60, (t) => {
      c.ship.lookAt(c.b.pos);
      const tel = c.ship.telemetry;
      sys.update({ dt: 1 / 60, now: t, solarFlux: 590, heatFlux: tel.heatFlux, dynPressure: tel.dynPressure, pressure: tel.pressure, airTemp: tel.temperature, airDensity: tel.density, radiation: 0, ringHazard: 0 });
      if (sys.destroyed) { fate = sys.cause; return false; }
      if (c.ship.mode !== 'flight') { fate = c.ship.mode; return false; }
    });
    return fate;
  };
  const withFa = entry(true), without = entry(false);
  check('Diving into Mars at full thrust with flight assist survives the entry', !withFa.startsWith('Burned') && !withFa.startsWith('Torn'), withFa);
  check('…and without flight assist the entry burns the ship up', /heating|Burned/.test(without), without);
}

// 13. Planet slowdown switched off: a 0.9 c dive still hits the Moon (and Phobos), never passes through.
for (const id of ['moon', 'phobos']) {
  const c = setup(id, 5e5, { fa: false });
  const m = c.b;
  c.ship.approachLimit = false;
  const dir = c.ship.rel.clone().normalize();
  c.ship.setParent(c.eph.dominantBody(c.ship.worldPos()));
  c.ship.vel.copy(dir).multiplyScalar(-0.9 * C_LIGHT).add(m.vel).sub(c.ship.parent.vel);
  let hit = null;
  run(c, 2, 1 / 20, () => {
    hit = c.ship.events.find((e) => e.type === 'crash');
    return !hit;
  });
  check(`Without the planet slowdown a 0.9 c dive hits ${m.name} instead of passing through`, hit?.body === m, hit ? `crash at ${(hit.speed / C_LIGHT).toFixed(2)} c` : 'passed through');
}

console.log(results.join('\n'));
console.log(failures ? `\n${failures} failure(s)` : '\nAll flight tests passed.');
process.exit(failures ? 1 : 0);
