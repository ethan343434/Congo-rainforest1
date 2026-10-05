// Browser test of core mechanics. Needs Playwright + Chromium and a static server:
//   python3 -m http.server 8765 &
//   node tests/gameplay.test.mjs [playwright-module-path]
// Player physics is stepped manually (deterministic 60 Hz) while the game sits on
// the title screen, then the death -> respawn loop is checked in real time.
const pwPath = process.argv[2] || 'playwright';
const { chromium } = await import(pwPath);

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:8765/?seed=12345');
await page.waitForFunction(() => !document.getElementById('begin-btn').disabled);

const results = await page.evaluate(() => {
  const out = [];
  const check = (name, ok, detail = '') => out.push({ name, ok: !!ok, detail });
  const p = congo.player;
  const w = congo.game.world;
  const m = congo.game.maze;
  let now = 100;
  const step = (seconds, keys = [], each) => {
    p.clearInput();
    keys.forEach((k) => p.keys.add(k));
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      p.update(1 / 60, now, w);
      now += 1 / 60;
      each?.(i / 60);
    }
    p.clearInput();
  };
  const face = (x, z) => { p.yaw = Math.atan2(-(x - p.position.x), -(z - p.position.z)); p.pitch = 0; };
  const reset = (x, z) => { p.position.set(x, 0, z); p.velocityY = 0; p.sprint = 1; p.sprintLocked = false; p.alive = true; p.health = 100; };

  // --- Sprint: 5 s burst then a 10 s lock-out recharge ---------------------------
  const hub = w.hubCenter;
  let sprintingAt49 = false, lockedAt51 = false;
  // Run back and forth across the open hub so walls never interfere.
  reset(hub.x - 13, hub.z + 13);
  face(hub.x + 13, hub.z + 13);
  step(5.2, ['KeyW', 'ShiftLeft'], (t) => {
    if (Math.abs(t - 4.9) < 0.01) sprintingAt49 = p.sprinting;
    if (Math.abs(t - 5.1) < 0.01) lockedAt51 = p.sprintLocked && !p.sprinting;
    if (p.position.x > hub.x + 12) { p.position.x = hub.x - 13; }
  });
  check('sprint lasts ~5 seconds', sprintingAt49 && lockedAt51, `at4.9=${sprintingAt49} lockedAt5.1=${lockedAt51}`);
  // Holding Shift during the lock-out must not sprint; release it after 9.6 s.
  let stillLockedAt9 = false;
  step(9.6, ['KeyW', 'ShiftLeft'], (t) => {
    if (Math.abs(t - 9.5) < 0.01) stillLockedAt9 = p.sprintLocked && !p.sprinting;
    if (p.position.x > hub.x + 12) { p.position.x = hub.x - 13; }
  });
  step(0.6, ['KeyW'], () => { if (p.position.x > hub.x + 12) p.position.x = hub.x - 13; });
  check('sprint recharges in 10 seconds', stillLockedAt9 && !p.sprintLocked && p.sprint >= 0.99, `locked@9.5=${stillLockedAt9} meter=${p.sprint.toFixed(2)}`);

  // --- Walls: cannot walk (or sprint) through the tree walls -------------------------
  // Find a cell with a closed wall to the east and push into it for 3 seconds.
  let wallCell = -1;
  for (let i = 0; i < m.size * m.size; i++) {
    const e = m.neighbour(i, 1);
    if (!m.isHub(i) && e >= 0 && !m.isOpen(i, e)) { wallCell = i; break; }
  }
  const c = w.cellCenter(wallCell);
  reset(c.x, c.z);
  face(c.x + 20, c.z);
  step(3, ['KeyW', 'ShiftLeft']);
  const wallX = c.x + m.cellSize / 2 - 1.3; // inner face of the wall (thickness 2.6)
  check('walls block movement', p.position.x <= wallX - 0.4 + 0.01, `x=${(p.position.x - c.x).toFixed(2)} wallFace=${(wallX - c.x).toFixed(2)}`);

  // --- Logs: blocked when walking, clearable by jumping ----------------------------------
  const log = w.logs[0];
  const box = [...w.colliders.query(log.x, log.z, 0.1)].find((b) => b.low);
  const alongX = box.maxX - box.minX < box.maxZ - box.minZ; // thin in X => passage runs along X
  const start = alongX ? { x: log.x - 3, z: log.z } : { x: log.x, z: log.z - 3 };
  const goal = alongX ? { x: log.x + 6, z: log.z } : { x: log.x, z: log.z + 6 };
  reset(start.x, start.z);
  face(goal.x, goal.z);
  step(2.5, ['KeyW']);
  const crossed = () => (alongX ? p.position.x > log.x + 0.8 : p.position.z > log.z + 0.8);
  check('fallen log blocks walking', !crossed());
  reset(start.x, start.z);
  face(goal.x, goal.z);
  step(0.35, ['KeyW']);
  p.jumpQueued = true;
  p.keys.add('KeyW');
  step(1.5, ['KeyW', 'Space'], (t) => { if (t < 0.02) p.jumpQueued = true; });
  check('jumping clears the log', crossed(), `pos=${p.position.x.toFixed(1)},${p.position.z.toFixed(1)} log=${log.x.toFixed(1)},${log.z.toFixed(1)}`);

  // --- Battery drains while the flashlight is on ---------------------------------------
  reset(hub.x, hub.z + 12);
  p.battery = 50;
  p.flashlightOn = true;
  step(6);
  check('flashlight battery drains', p.battery < 50 && p.battery > 47, p.battery.toFixed(2));

  // --- Every pickup and the exit are reachable on foot ------------------------------------
  check('village exit cell is on the solution route', m.solution[m.solution.length - 1] === m.exit.cell);
  return out;
});

// --- Real-time: pickups, death and respawn ---------------------------------------------------
await page.click('#begin-btn');
await page.waitForTimeout(500);
const pickupOk = await page.evaluate(async () => {
  const pk = congo.game.world.pickups[0];
  congo.player.position.set(pk.position.x, 0, pk.position.z);
  await new Promise((r) => setTimeout(r, 400));
  document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
  document.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
  return pk.taken;
});
results.push({ name: 'E picks up items', ok: pickupOk });

await page.evaluate(() => {
  const s = congo.game.world.swarms[0];
  congo.player.health = 3;
  congo.player.position.set(s.center.x, 0, s.center.z);
});
await page.waitForFunction(() => congo.state === 'dying', null, { timeout: 60000 }).catch(() => {});
const died = await page.evaluate(() => congo.state === 'dying' && congo.player.killedBy);
await page.waitForFunction(() => congo.state === 'playing', null, { timeout: 120000 }).catch(() => {});
const respawn = await page.evaluate(() => {
  const s = congo.game.world.spawn.position;
  const p = congo.player.position;
  return { state: congo.state, deaths: congo.game.deaths, health: congo.player.health, dist: Math.hypot(p.x - s.x, p.z - s.z) };
});
results.push({ name: 'mosquito swarm can kill you', ok: died === 'the mosquito swarm', detail: String(died) });
results.push({ name: 'death respawns you at the crash site', ok: respawn.state === 'playing' && respawn.deaths === 1 && respawn.health === 100 && respawn.dist < 1, detail: JSON.stringify(respawn) });

await browser.close();
let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
  if (!r.ok) failed++;
}
if (errors.length) { console.log('Page errors:\n' + errors.join('\n')); failed++; }
console.log(failed ? `\n${failed} failure(s)` : '\nAll gameplay checks passed.');
process.exit(failed ? 1 : 0);
