// =============================================================================
// main.js — boots the game and runs the state machine + main loop.
//
// States:  menu -> playing <-> paused
//                  playing -> dying -> (respawn at crash site) -> playing
//                  playing -> cutscene (reached the village) -> won -> new game
// =============================================================================
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { generateMaze } from './maze.js';
import { buildWorld } from './world.js';
import { Player } from './player.js';
import { Animals } from './animals.js';
import { DayNight } from './dayNight.js';
import { AudioManager } from './audio.js';
import { UI } from './ui.js';
import { Cutscene } from './cutscene.js';
import { makeRng } from './utils.js';

// ---- Renderer, scene, camera ------------------------------------------------------
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  document.getElementById('fatal').textContent = 'Your browser could not start WebGL, which this game needs. Try a recent Chrome, Edge or Firefox.';
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.render.maxPixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = CONFIG.flashlight.castShadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.getElementById('game').appendChild(renderer.domElement);
const canvas = renderer.domElement;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, CONFIG.render.farPlane);
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const ui = new UI();
const audio = new AudioManager();
const dayNight = new DayNight(scene);
const player = new Player(camera, scene);

let state = 'menu';
let game = null;
let cutscene = null;
let elapsed = 0;
let deathTimer = 0;
let pointerLocked = false;
let lastHurtSound = -1;

// ---- Building / tearing down a run -----------------------------------------------
function disposeGame() {
  if (!game) return;
  for (const g of [game.world.root, game.animals.group]) {
    scene.remove(g);
    g.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }
  game = null;
}

function newGame(seed) {
  disposeGame();
  const t0 = performance.now();
  const maze = generateMaze(CONFIG.maze, seed);
  const world = buildWorld(maze, scene);
  const animals = new Animals(world, scene, makeRng(maze.seed ^ 0xa11ce), audio);
  game = {
    maze, world, animals,
    deaths: 0,
    playTime: 0,
    pickupsFound: 0,
    hints: new Set(),
    leftHub: false,
  };
  dayNight.time = CONFIG.time.startTime;
  dayNight.day = 1;
  player.battery = 100;
  player.spawn(world.spawn);
  world.village.cutsceneActive = false;
  if (CONFIG.debug) console.log(`maze seed ${maze.seed}, ${world.instanceCount} instances, built in ${(performance.now() - t0).toFixed(0)} ms`);
}

// ---- Player feedback hooks ------------------------------------------------------------
player.onDamage = (amount) => {
  ui.damageFlash(amount);
  if (elapsed - lastHurtSound > 0.6) {
    lastHurtSound = elapsed;
    audio.play('hurt');
  }
};
player.onStep = (landed, inWater) => audio.play(landed ? 'land' : inWater ? 'stepWater' : 'step');

function hint(key, message, seconds = 5) {
  if (game.hints.has(key)) return;
  game.hints.add(key);
  ui.toast(message, seconds);
}

// ---- State transitions -----------------------------------------------------------------
function lockPointer() {
  try {
    const p = canvas.requestPointerLock?.();
    if (p && p.catch) p.catch(() => {});
  } catch (e) { /* pointer lock unavailable: drag-to-look still works */ }
}

function beginPlaying() {
  if (state === 'menu') {
    player.yaw = game.world.spawn.yaw; // undo the title-screen camera sway
    player.pitch = 0;
  }
  audio.init();
  ui.hide('start');
  ui.hide('pause');
  ui.hide('win');
  ui.setHud(true);
  state = 'playing';
  lockPointer();
}

function pause() {
  if (state !== 'playing') return;
  state = 'paused';
  player.clearInput();
  ui.show('pause');
}

function startDeath() {
  state = 'dying';
  deathTimer = 0;
  player.clearInput();
  audio.play('death');
  ui.fade(1, 1.6);
  setTimeout(() => ui.showDeath(player.killedBy || 'the jungle'), 900);
}

function respawn() {
  game.deaths++;
  dayNight.skip(CONFIG.time.deathTimePenalty);
  game.animals.resetAll();
  player.spawn(game.world.spawn);
  game.leftHub = false;
  ui.hide('death');
  ui.fade(0, 1.2);
  ui.toast('You come to beside the wreck. An hour has passed. Try a different path.', 5);
  state = 'playing';
}

function startCutscene() {
  state = 'cutscene';
  player.clearInput();
  player.flashlight.visible = false;
  ui.setHud(false);
  ui.prompt.classList.remove('visible');
  cutscene = new Cutscene(game.world, camera, ui, audio);
  cutscene.start();
  try { document.exitPointerLock?.(); } catch (e) { /* ignore */ }
}

function finishGame() {
  state = 'won';
  const mins = Math.floor(game.playTime / 60);
  const secs = String(Math.floor(game.playTime % 60)).padStart(2, '0');
  ui.fade(0, 1);
  ui.showWin({ time: `${mins}:${secs}`, days: dayNight.day, deaths: game.deaths, pickups: game.pickupsFound });
}

// ---- Input ---------------------------------------------------------------------------------
document.getElementById('begin-btn').addEventListener('click', beginPlaying);
document.getElementById('resume-btn').addEventListener('click', beginPlaying);
document.getElementById('again-btn').addEventListener('click', () => {
  ui.hide('win');
  ui.setLoading(true);
  setTimeout(() => {
    newGame();
    ui.setLoading(false);
    beginPlaying();
  }, 30);
});

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (!locked && pointerLocked && state === 'playing') pause();
  pointerLocked = locked;
});
canvas.addEventListener('click', () => {
  if (state === 'playing' && !pointerLocked) lockPointer();
});
document.addEventListener('mousemove', (e) => {
  if (state !== 'playing') return;
  // Some browsers report one huge jump when pointer lock engages; ignore it.
  if (Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250) return;
  if (pointerLocked) player.onMouseMove(e.movementX, e.movementY);
  else if (e.buttons === 1) player.onMouseMove(e.movementX * 1.5, e.movementY * 1.5); // drag-to-look fallback
});
document.addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.code === 'KeyH') ui.toggleHelp();
  if (e.code === 'KeyM') {
    audio.muted = !audio.muted;
    audio.setMuted(audio.muted);
  }
  if (state === 'paused' && (e.code === 'Enter' || e.code === 'Escape')) { beginPlaying(); return; }
  if (state !== 'playing') return;
  if (e.code === 'Escape' && !pointerLocked) { pause(); return; }
  if (e.repeat) return;
  player.onKey(e.code, true);
  if (e.code === 'KeyF') audio.play('flashlight');
  if (e.code === 'KeyE') tryInteract();
});
document.addEventListener('keyup', (e) => player.onKey(e.code, false));
window.addEventListener('blur', () => player.clearInput());

// ---- Gameplay checks done every frame ------------------------------------------------------------
function nearestPickup() {
  let best = null, bestD = 2.2;
  for (const p of game.world.pickups) {
    if (p.taken) continue;
    const d = Math.hypot(p.position.x - player.position.x, p.position.z - player.position.z);
    if (d < bestD) { best = p; bestD = d; }
  }
  return best;
}

function tryInteract() {
  const p = nearestPickup();
  if (!p) return;
  p.taken = true;
  p.holder.visible = false;
  game.pickupsFound++;
  audio.play('pickup');
  if (p.type === 'battery') {
    player.battery = Math.min(100, player.battery + CONFIG.flashlight.batteryPickup);
    ui.toast('Batteries! Your flashlight is recharged.', 3);
  } else {
    player.heal(45);
    ui.toast('A first-aid kit from the wreck. You patch yourself up.', 3);
  }
}

function gameplayChecks(dt) {
  const { world } = game;
  const pos = player.position;

  // Mosquito swarms gnaw at your health while you stand in them.
  let buzz = 0;
  for (const s of world.swarms) {
    const d = Math.hypot(pos.x - s.center.x, pos.z - s.center.z);
    buzz = Math.max(buzz, 1 - Math.max(0, d - 2) / 14);
    if (d < CONFIG.hazards.swarmRadius) {
      player.damage(CONFIG.hazards.swarmDamagePerSec * dt, 'the mosquito swarm', elapsed);
      hint('swarm', 'Mosquitoes! Thousands of them. Get out of this swamp, fast!', 4);
    }
  }

  // Zone hints.
  if (world.river.inZone(pos.x, pos.z)) hint('river', 'A wide brown river... and something is moving in the water.', 5);
  if (Math.hypot(pos.x - world.nestCenter.x, pos.z - world.nestCenter.z) < 7) hint('nest', 'Bones everywhere. This is a predator’s den.', 4);
  for (const l of world.logs) {
    if (Math.hypot(pos.x - l.x, pos.z - l.z) < 4.5) hint('log', 'A fallen log blocks the path. Press SPACE to jump over it.', 4);
  }
  const villageDist = Math.hypot(pos.x - world.village.center.x, pos.z - world.village.center.z);
  if (villageDist < 42) hint('drums', 'Drums... and the glow of a fire through the trees. The village must be close!', 5);
  if (player.battery < 15 && player.flashlightOn) hint('lowbattery', 'Your flashlight is dying. Look for batteries in the wreckage scattered through the jungle.', 5);
  if (dayNight.isNight) hint('night', 'Night has fallen. The predators are bolder in the dark.', 5);

  // Looping back to the crash site.
  const cell = world.cellAt(pos.x, pos.z);
  if (cell >= 0 && game.maze.dist[cell] >= 3) game.leftHub = true;
  if (cell >= 0 && game.maze.isHub(cell) && game.leftHub) {
    game.leftHub = false;
    ui.toast('The wreck again... that path just led you around in a circle.', 4);
  }

  // Interaction prompt.
  const p = nearestPickup();
  const prompt = p ? `Press E to pick up ${p.type === 'battery' ? 'batteries' : 'the first-aid kit'}` : null;

  // Escape!
  if (world.village.contains(pos.x, pos.z)) startCutscene();

  return { buzz, drums: Math.max(0, 1 - villageDist / 48), prompt };
}

// ---- Main loop ---------------------------------------------------------------------------------
const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  elapsed += dt;
  if (!game) return;
  const { world, animals } = game;
  let layers = { buzz: 0, drums: 0, prompt: null };

  if (state === 'playing') {
    game.playTime += dt;
    dayNight.update(dt, player.position);
    player.update(dt, elapsed, world);
    animals.update(dt, elapsed, player, dayNight);
    layers = gameplayChecks(dt);
    if (!player.alive && state === 'playing') startDeath();
  } else if (state === 'dying') {
    deathTimer += dt;
    dayNight.update(dt, player.position);
    animals.update(dt, elapsed, player, dayNight);
    // Collapse to the ground.
    const k = Math.min(1, deathTimer / 1.2);
    camera.position.y = player.position.y + CONFIG.player.eyeHeight * (1 - k * 0.8);
    camera.rotation.z = k * 0.9;
    if (deathTimer > 3.2) respawn();
  } else if (state === 'cutscene') {
    dayNight.update(dt, player.position);
    if (cutscene.update(dt)) finishGame();
  } else if (state === 'menu') {
    // Slow look around the crash site behind the title screen.
    dayNight.update(dt * 0.2, player.position);
    player.yaw = world.spawn.yaw + Math.sin(elapsed * 0.08) * 0.35;
    player.pitch = 0.04;
    player.syncCamera();
  }

  world.update(dt, elapsed, { playerPos: player.position, darkness: dayNight.darkness });
  // Nothing past the fog is visible, so don't draw it (big win at night).
  const far = Math.min(CONFIG.render.farPlane, dayNight.fog.far + 12);
  if (Math.abs(camera.far - far) > 0.5) {
    camera.far = far;
    camera.updateProjectionMatrix();
  }
  audio.setListener(player.position.x, player.position.z, player.yaw);
  audio.update(dt, {
    darkness: dayNight.darkness,
    buzz: state === 'playing' ? layers.buzz : 0,
    drums: state === 'cutscene' ? 0.6 : layers.drums,
    threat: state === 'playing' ? animals.threatLevel(player) : 0,
    villagePos: world.village.center,
  });
  ui.update(dt, {
    health: player.health,
    sprint: player.sprint,
    sprintLocked: player.sprintLocked,
    sprinting: player.sprinting,
    battery: player.battery,
    flashlightOn: player.flashlightOn,
    clock: dayNight.clockText,
    deaths: game.deaths,
    prompt: state === 'playing' ? layers.prompt : null,
  });
  renderer.render(scene, camera);
}

// ---- Boot -------------------------------------------------------------------------------------
ui.setLoading(true);
setTimeout(() => {
  const params = new URLSearchParams(location.search);
  newGame(params.has('seed') ? Number(params.get('seed')) : undefined);
  ui.setLoading(false);
  ui.show('start');
  frame();
}, 50);

// Handy hooks for testing/tuning from the browser console.
window.congo = {
  get state() { return state; },
  player, dayNight, camera, CONFIG, renderer, scene,
  get game() { return game; },
  begin: beginPlaying,
  teleport(x, z) { player.position.set(x, 0, z); },
  setTime(t) { dayNight.time = t; },
};
