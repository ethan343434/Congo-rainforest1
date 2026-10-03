// =============================================================================
// game.js — Sol Voyager's game loop.
//
// Owns the simulation (ephemeris, ship, astronaut, survival systems), the
// streaming terrain, the camera and every per-frame visual, and turns key
// presses into actions. States: loading → menu → play ⇄ paused, play → dead.
//
// Everything lives in double-precision heliocentric coordinates (metres);
// each frame the universe is drawn relative to the camera (floating origin).
// =============================================================================
import * as THREE from 'three';
import { SYSTEMS } from '../data/systems.js';
import { G0, KELVIN, STAR, formatDistance, formatSpeed } from '../constants.js';
import { Ephemeris } from '../sim/ephemeris.js';
import { ShipSim, SHIP, smoothstep } from '../sim/ship.js';
import { ShipSystems, SuitSystems } from '../sim/hazards.js';
import { solarFlux, radiationDose, surfaceTemperature, sunlightTransmission, atmosphereAt } from '../sim/environment.js';
import { Walker, WALK } from '../sim/walker.js';
import { Engine } from '../render/engine.js';
import { Assets } from '../render/assets.js';
import { WorldRenderer } from '../render/world.js';
import { ShipModel } from '../render/shipModel.js';
import { AstronautModel } from '../render/astronautModel.js';
import { SpeedDust, DeepAtmosphere, Explosion } from '../render/effects.js';
import { createApolloSite, LANDMARK_MATERIALS } from '../render/landmarks.js';
import { LOCAL_SUN, applyLocalSun, applyLocalSunTree } from '../render/localSun.js';
import { ringDensityAt } from '../render/rings.js';
import { TerrainWorkers, Terrain } from '../terrain/terrain.js';
import { createDetailTexture } from '../terrain/terrainMaterial.js';
import { CameraRig } from './cameraRig.js';
import { Input } from './input.js';
import { Hud } from '../ui/hud.js';
import { AudioEngine } from '../audio/audio.js';
import { ProximaLife } from './proximaLife.js';

const $ = (id) => document.getElementById(id);
const PHYS_STEP = 1 / 120;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();

// How each landable world's ground looks up close (colour multipliers are linear).
const GROUND_LOOK = {
  // Venera 13/14 saw dark basalt slabs; the radar map is not a colour map.
  venus: { noMap: true, baseColor: [0.11, 0.095, 0.08], slopeBright: 0.1 },
  mars: { tint: [1.0, 0.96, 0.92], slopeBright: 0.12 },
  // Huygens: dark orange-brown plains strewn with rounded ice pebbles.
  titan: { mapContrast: 0.22, baseColor: [0.17, 0.1, 0.05], slopeBright: 0.1 },
  io: { slopeBright: 0.1 },
  proxb: { slopeBright: 0.18 },
};

// Optical "visibility" of the air near the ground (m) for aerial perspective.
const VISIBILITY = { mars: 70e3, venus: 9e3, titan: 14e3, pluto: 400e3, triton: 500e3, proxb: 55e3 };

/** Linear scene colour → final on-screen colour (three.js ACES filmic + sRGB). */
function toDisplay(rgb, exposure) {
  const r = (rgb[0] * exposure) / 0.6, g = (rgb[1] * exposure) / 0.6, b = (rgb[2] * exposure) / 0.6;
  const fit = (v) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
  const x = fit(0.59719 * r + 0.35458 * g + 0.04823 * b);
  const y = fit(0.076 * r + 0.90834 * g + 0.01566 * b);
  const z = fit(0.0284 * r + 0.13383 * g + 0.83777 * b);
  const out = [1.60475 * x - 0.53108 * y - 0.07367 * z, -0.10208 * x + 1.10813 * y - 0.00605 * z, -0.00327 * x - 0.07276 * y + 1.07602 * z];
  return out.map((c) => {
    const v = Math.min(1, Math.max(0, c));
    return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  });
}

export class Game {
  constructor(systemId = 'sol') {
    this.sys = SYSTEMS[systemId] || SYSTEMS.sol;
    Object.assign(STAR, this.sys.star);
    this.engine = new Engine($('app'));
    const eng = this.engine;
    this.clock = 0;
    this.eph = new Ephemeris(this.sys.bodies);
    this.simTime = Date.now();
    this.eph.update(this.simTime);
    this.assets = new Assets(eng.renderer);
    this.world = new WorldRenderer(eng, this.eph, this.assets);

    this.ship = new ShipSim(this.eph);
    this.systems = new ShipSystems();
    this.suit = new SuitSystems();
    this.walker = new Walker();
    this.ship.groundHeight = (body, dir) => this.terrainFor(body)?.height(dir) ?? 0;
    this.ship.groundNormal = (body, dir) => this.terrainFor(body)?.normal(dir) ?? dir.clone();

    this.shipModel = new ShipModel(null);
    eng.scene.add(this.shipModel.root);
    this.shipLights = [];
    for (const x of [-1.3, 1.3]) {
      const l = new THREE.SpotLight(0xfff3e0, 0, 900, 0.42, 0.5, 1.4);
      l.position.set(x, -0.7, -5.6);
      l.target.position.set(x * 3, -40, -110);
      this.shipModel.root.add(l, l.target);
      this.shipLights.push(l);
    }
    applyLocalSunTree(this.shipModel.root);
    this.astro = new AstronautModel();
    this.astro.root.visible = false;
    eng.scene.add(this.astro.root);
    applyLocalSunTree(this.astro.root);
    for (const m of LANDMARK_MATERIALS) applyLocalSun(m);

    this.dust = new SpeedDust();
    eng.scene.add(this.dust.lines);
    this.deep = new DeepAtmosphere();
    eng.scene.add(this.deep.mesh);
    this.explosion = new Explosion();
    eng.scene.add(this.explosion.group);

    this.rig = new CameraRig(eng.camera);
    this.input = new Input(eng.canvas);
    this.hud = new Hud(this.eph, (b) => this.selectTarget(b, true), this.sys.nav);
    this.audio = new AudioEngine();

    this.workers = new TerrainWorkers();
    this.detailTex = createDetailTexture();
    this.terrains = new Map();     // bodyId → Terrain (at most two kept)
    this.terrainLoading = new Map();
    this.terrain = null;           // the one currently drawn
    this.landmarkSites = new Map();

    this.state = 'loading';
    this.onFoot = false;
    this.target = null;
    this.playTime = 0;
    this.lightsOn = false;
    this.showFps = false;
    this.visited = new Set();
    this.lastBody = null;
    this.wasInAtmo = false;
    this.closing = 0;
    this.prevTargetDist = null;
    this.camWorld = new THREE.Vector3();
    this.playerWorld = new THREE.Vector3();
    this.warnings = [];
    this.lastBarrierToast = -99;
    this.damageFlash = 0;
    this.env = { temp: null, pressure: 0, radiation: 0, solarFlux: 0 };
    this.wasLocked = false;
    this.lastTime = performance.now();
    this.bindUI();
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }

  // ===========================================================================
  // Loading, menu, states
  // ===========================================================================
  async load() {
    const bar = $('load-bar'), label = $('load-label');
    const fileWarn = location.protocol === 'file:';
    try {
      await this.world.load((f) => {
        bar.style.width = `${Math.round(f * 100)}%`;
        if (!fileWarn) label.textContent = `Loading planet maps… ${Math.round(f * 100)}%`;
      });
    } catch (e) {
      console.error(e);
    }
    this.assets.texture('milky_way.jpg').then((t) => this.makeEnvMap(t)).catch(() => {});
    this.assets.heightData('saturn_rings.png', { channel: 'alpha' }).then((d) => {
      const alpha = new Uint8Array(d.width);
      for (let i = 0; i < d.width; i++) alpha[i] = Math.round(d.data[i] * 255);
      this.ringTex = { width: d.width, alpha };
    }).catch(() => {});
    this.prepareTerrain(this.eph.byId[this.sys.preload]);
    this.respawn();
    this.state = 'menu';
    $('loading').classList.remove('visible');
    $('menu').classList.add('visible');
    const d = new Date(this.simTime);
    $('menu-date').textContent = `Planet positions for ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
    window.solarReady = true;
  }

  makeEnvMap(tex) {
    const pm = new THREE.PMREMGenerator(this.engine.renderer);
    const env = pm.fromEquirectangular(tex).texture;
    pm.dispose();
    this.shipModel.root.traverse((o) => {
      if (o.material && o.material.isMeshStandardMaterial) { o.material.envMap = env; o.material.needsUpdate = true; }
    });
    this.astro.setEnvMap(env);
  }

  bindUI() {
    $('start-btn').addEventListener('click', () => this.start());
    $('resume-btn').addEventListener('click', () => this.resume());
    $('respawn-btn').addEventListener('click', () => this.respawnAfterDeath());
    $('respawn-btn').textContent = this.sys.respawnLabel;
    const home = $('home-btn');
    if (home) {
      home.hidden = !this.sys.homePage;
      home.addEventListener('click', () => { location.href = this.sys.homePage; });
    }
    document.addEventListener('click', (e) => {
      const close = e.target.closest?.('[data-close]');
      if (close) $(close.dataset.close).hidden = true;
      const open = e.target.closest?.('[data-open]');
      if (open) $(open.dataset.open).hidden = false;
    });
    this.input.onLockChange = (locked) => {
      if (!locked && this.wasLocked && this.state === 'play') this.pause();
      this.wasLocked = locked;
    };
    if (!this.engine.renderer.capabilities.isWebGL2) $('webgl-warning').textContent = 'WebGL 2 is not available: the game may not run in this browser.';
  }

  start() {
    if (this.state !== 'menu') return;
    this.audio.start();
    this.state = 'play';
    $('menu').classList.remove('visible');
    this.hud.show(true);
    this.input.enabled = true;
    this.input.requestLock();
    this.hud.toast(this.sys.welcome[0], this.sys.welcome[1], '', 9);
  }

  pause() {
    if (this.state !== 'play') return;
    this.state = 'paused';
    $('pause').classList.add('visible');
    $('quality-label').textContent = `Rendering at 1080p · quality ${this.engine.quality.name} · ${this.engine.fps.toFixed(0)} fps`;
    this.input.releaseLock();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'play';
    $('pause').classList.remove('visible');
    $('help').hidden = true;
    this.audio.start();
    this.input.requestLock();
  }

  die(title, cause) {
    if (this.state === 'dead') return;
    this.state = 'dead';
    this.deadAt = this.clock;
    $('dead-title').textContent = title;
    $('dead-cause').textContent = cause;
    this.input.releaseLock();
  }

  respawnAfterDeath() {
    $('dead').classList.remove('visible');
    this.respawn();
    this.state = 'play';
    this.input.requestLock();
    this.hud.toast(this.sys.respawnLabel.replace('Respawn', 'Respawned'), 'A new ship is waiting in high orbit.', '', 6);
  }

  /** New ship in high orbit (over Earth's day side, or Proxima b's twilight ring). */
  respawn() {
    const eph = this.eph;
    const S = this.sys.start;
    const earth = eph.byId[S.body], moon = eph.byId[S.target], sun = eph.sun;
    let up;
    if (S.terminator) {
      // Over the twilight ring of a tidally locked world (the star is on local +X).
      up = earth.toWorld(new THREE.Vector3(0.12, 0.3, -0.95).normalize());
    } else {
      const toSun = sun.pos.clone().sub(earth.pos).normalize();
      const side = new THREE.Vector3().crossVectors(earth.pole, toSun).normalize();
      up = toSun.clone().multiplyScalar(0.78).addScaledVector(side, 0.5).addScaledVector(earth.pole, 0.3).normalize();
    }
    const alt = S.altitude;
    const pos = earth.pos.clone().addScaledVector(up, earth.radius + alt);
    this.ship.placeNear(earth, pos);
    this.ship.mode = 'flight';
    this.ship.flightAssist = true;
    // Level towards the target's (or the star's) bearing, then nose down so the
    // planet's limb fills the lower half of the view.
    const toMoon = (S.terminator ? sun.pos : moon.pos).clone().sub(pos);
    const level = toMoon.clone().addScaledVector(up, -toMoon.dot(up)).normalize();
    const right = new THREE.Vector3().crossVectors(level, up).normalize();
    const fwd = level.clone().applyAxisAngle(right, -0.42);
    this.ship.lookAt(pos.clone().add(fwd), up.clone().applyAxisAngle(right, -0.42));
    this.ship.updateTelemetry();
    this.systems.reset();
    this.suit.reset();
    this.onFoot = false;
    this.astro.root.visible = false;
    this.rig.initialised = false;
    this.rig.mode = 'chase';
    this.explosion.active = false;
    this.explosion.group.visible = false;
    this.warp = null;
    this.selectTarget(moon, false);
    this.lastBody = earth;
  }

  // ===========================================================================
  // Targets
  // ===========================================================================
  currentBody() {
    return this.onFoot ? this.walker.body : this.ship.parent;
  }

  selectTarget(body, user) {
    this.target = body;
    this.prevTargetDist = null;
    if (body?.def.terrain) this.prepareTerrain(body);
    if (user) {
      this.audio.play('select');
      if (this.ship.autopilot && this.ship.autopilot.target !== body) this.ship.cancelAutopilot(true);
    }
  }

  cycleTarget() {
    const cur = this.currentBody();
    const sys = cur.kind === 'moon' ? cur.parent : cur;
    const list = this.sys.nav.map((id) => this.eph.byId[id]);
    const moons = [...sys.children].sort((a, b) => a.def.ephem.a - b.def.ephem.a);
    const i = list.indexOf(sys);
    list.splice(i + 1, 0, ...moons);
    const k = list.indexOf(this.target);
    this.selectTarget(list[(k + 1) % list.length], true);
  }

  // ===========================================================================
  // Terrain
  // ===========================================================================
  terrainFor(body) {
    const t = this.terrains.get(body.id);
    return t && !t.disposed ? t : null;
  }

  /** How close (altitude, m) before the detailed ground replaces the sphere. */
  terrainRange(body) {
    const atm = body.atmosphere;
    if (atm?.cloudBase) return atm.cloudBase;
    if (atm?.hazeTop) return 160e3;
    return body.radius * 0.35 + 60e3;
  }

  /** Load the height map and create the terrain for a body (async, cached). */
  prepareTerrain(body) {
    if (!body?.def.terrain || this.terrains.has(body.id) || this.terrainLoading.has(body.id)) return;
    const T = body.def.terrain;
    const hmPromise = T.heightmap ? this.assets.heightData(T.heightmap.file).catch(() => null) : Promise.resolve(null);
    const vis = body.def.visual || {};
    let colorPromise;
    if (GROUND_LOOK[body.id]?.noMap) colorPromise = Promise.resolve(null);
    else if (body.id === 'titan') colorPromise = Promise.resolve(this.world.titanSurface || null);
    else if (vis.map) colorPromise = this.assets.texture(vis.map).catch(() => null);
    else colorPromise = Promise.resolve(this.world.visuals.get(body.id)?.material.uniforms.uDay.value || null);
    const p = Promise.all([hmPromise, colorPromise]).then(([hm, color]) => {
      this.terrainLoading.delete(body.id);
      const rock = new THREE.Color(vis.pointColor || '#888888');
      const hsl = {};
      rock.getHSL(hsl);
      rock.setHSL(hsl.h, hsl.s * 0.55, Math.min(0.42, hsl.l * 0.5));
      const t = new Terrain(body, {
        workers: this.workers,
        detailTex: this.detailTex,
        heightmap: hm,
        colorMap: color,
        look: GROUND_LOOK[body.id] || {},
        rockColor: [rock.r, rock.g, rock.b],
      });
      applyLocalSun(t.rocks.material);
      t.group.visible = false;
      this.engine.scene.add(t.group);
      this.terrains.set(body.id, t);
      this.addLandmarks(body, t);
      // Keep at most two worlds' terrain in memory.
      if (this.terrains.size > 2) {
        for (const [id, old] of this.terrains) {
          if (old === t || old.body === this.currentBody() || old.body === this.target) continue;
          old.dispose();
          this.terrains.delete(id);
          this.landmarkSites.delete(id);
          break;
        }
      }
      return t;
    });
    this.terrainLoading.set(body.id, p);
  }

  addLandmarks(body, terrain) {
    const list = body.def.landmarks;
    if (!list) return;
    const sites = [];
    for (const lm of list) {
      const la = (lm.lat * Math.PI) / 180, lo = (lm.lon * Math.PI) / 180;
      const dir = new THREE.Vector3(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo));
      const local = dir.clone().multiplyScalar(terrain.surfaceRadius(dir));
      const g = createApolloSite(lm);
      g.position.copy(local);
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      g.visible = false;
      terrain.group.add(g);
      sites.push({ lm, local, group: g, dir, visited: false });
    }
    this.landmarkSites.set(body.id, sites);
  }

  updateTerrain(dt) {
    const body = this.currentBody();
    if (body.def.terrain) this.prepareTerrain(body);
    const t = this.terrainFor(body);
    let active = null;
    if (t) {
      const alt = this.onFoot ? 0 : this.ship.telemetry.altitude;
      if (alt < this.terrainRange(body)) active = t;
    }
    for (const tt of this.terrains.values()) {
      if (tt !== active) {
        tt.group.visible = false;
        const v = this.world.visuals.get(tt.body.id);
        if (v) v.terrainActive = false;
      }
    }
    this.terrain = active;
    if (!active) return;
    const camLocal = body.toLocal(_v.subVectors(this.camWorld, body.pos), new THREE.Vector3());
    const playerLocal = body.toLocal(_w.subVectors(this.playerWorld, body.pos), new THREE.Vector3());
    active.update(camLocal, this.camWorld, dt, playerLocal);
    active.group.visible = true;
    const v = this.world.visuals.get(body.id);
    if (v) v.terrainActive = active.ready;
    // Landmarks within 30 km are drawn.
    for (const s of this.landmarkSites.get(body.id) || []) {
      const d = s.local.distanceTo(playerLocal);
      s.group.visible = d < 30e3;
      s.distance = d;
      if (d < 120 && !s.visited) {
        s.visited = true;
        this.hud.toast(s.lm.name, s.lm.note, 'discovery', 8);
        this.audio.play('toast');
      }
    }
  }

  // ===========================================================================
  // Per-frame
  // ===========================================================================
  frame(now) {
    requestAnimationFrame(this.frame);
    const dtReal = Math.min(0.25, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;
    const dt = Math.min(dtReal, 0.05);
    this.clock += dt;
    this.handleActions();
    if (this.state === 'loading') { this.engine.render(); return; }
    const running = this.state === 'play' || this.state === 'menu' || this.state === 'dead';
    if (running) {
      // Near the black hole your clock runs slow: the universe races ahead.
      this.simTime += dt * 1000 * (this.dilation || 1);
      this.eph.update(this.simTime);
      if (this.state === 'play') this.playTime += dt;
      this.applyControls(dt);
      if (this.state === 'play') this.updateWarp(dt);
      this.step(dt);
      this.processEvents();
      this.updateSystems(dt);
    }
    this.updateCamera(dt);
    this.updateTerrain(dt);
    this.updateVisuals(dt);
    this.updateHud(dt);
    this.updateAudio(dt);
    if (this.state === 'dead' && this.clock - this.deadAt > 1.8) $('dead').classList.add('visible');
    this.engine.render();
    if (this.state === 'play') this.engine.governQuality(dtReal * 1000, now / 1000);
  }

  handleActions() {
    for (const code of this.input.takeActions()) {
      if (this.state === 'menu') {
        if (code === 'Enter') this.start();
        continue;
      }
      if (this.state === 'dead') {
        if (code === 'Enter' && $('dead').classList.contains('visible')) this.respawnAfterDeath();
        continue;
      }
      if (code === 'Escape') {
        if (!$('info').hidden) { $('info').hidden = true; continue; }
        if (!$('help').hidden) { $('help').hidden = true; continue; }
        if (this.state === 'play') this.pause();
        else if (this.state === 'paused') this.resume();
        continue;
      }
      if (code === 'KeyH') { $('help').hidden = !$('help').hidden; continue; }
      if (this.state !== 'play') continue;
      const ship = this.ship;
      switch (code) {
        case 'KeyJ':
          if (!this.onFoot) { ship.cancelAutopilot(true); ship.togglePulse(); }
          break;
        case 'KeyG':
          if (this.onFoot) break;
          if (ship.autopilot) ship.cancelAutopilot();
          else if (this.target) ship.engageAutopilot(this.target);
          break;
        case 'KeyT': this.cycleTarget(); break;
        case 'KeyZ':
          if (this.onFoot) break;
          ship.flightAssist = !ship.flightAssist;
          this.hud.toast('Flight assist', ship.flightAssist ? 'On: the ship holds position against gravity.' : 'Off: pure Newtonian flight. Momentum is yours to manage.', '', 4);
          this.audio.play('blip');
          break;
        case 'KeyL': if (!this.onFoot) ship.autoLand(); break;
        case 'KeyK': this.startWarp(); break;
        case 'KeyE':
          if (this.onFoot) { if (!this.life?.use()) this.enterShip(); } else this.exitShip();
          break;
        case 'KeyV': this.rig.toggleView(this.onFoot); this.audio.play('blip'); break;
        case 'KeyI': this.toggleScanner(); break;
        case 'KeyM': this.audio.setMuted(!this.audio.muted); this.hud.toast('Sound', this.audio.muted ? 'Muted' : 'On', '', 2); break;
        case 'KeyF': this.toggleLights(); break;
        case 'KeyO': this.showFps = !this.showFps; break;
        case 'Tab':
          this.keysHidden = !this.keysHidden;
          try { localStorage.setItem('solv-keys-hidden', this.keysHidden ? '1' : '0'); } catch (e) { /* storage blocked */ }
          break;
        case 'Space': if (this.onFoot) this.walker.input.jump = true; break;
        default:
          if (code.startsWith('Digit')) {
            const id = this.sys.nav[Number(code.slice(5))];
            if (id) this.selectTarget(this.eph.byId[id], true);
          }
      }
    }
  }

  toggleScanner() {
    const info = $('info');
    if (!info.hidden) { info.hidden = true; return; }
    const body = this.target || this.currentBody();
    this.hud.showInfo(body, this.playerWorld);
    this.audio.play('blip');
  }

  toggleLights() {
    this.lightsOn = !this.lightsOn;
    for (const l of this.shipLights) l.intensity = this.lightsOn ? 9000 : 0;
    this.astro.setLamp(this.lightsOn);
    this.audio.play('blip');
  }

  applyControls(dt) {
    const inp = this.input;
    this.input.decayStick(dt);
    const s = this.ship.input;
    const playing = this.state === 'play';
    if (!playing || this.onFoot) {
      s.thrust = s.lift = s.strafe = s.pitch = s.yaw = s.roll = 0;
      s.boost = s.brake = false;
    }
    if (!playing) {
      const w = this.walker.input;
      w.forward = w.right = 0;
      w.run = w.jet = w.down = w.jump = false;
      return;
    }
    if (this.onFoot) {
      const w = this.walker.input;
      w.forward = inp.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']);
      w.right = inp.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
      w.run = inp.down('ShiftLeft', 'ShiftRight');
      w.jet = inp.down('Space');
      w.down = inp.down('KeyC', 'ControlLeft');
      return;
    }
    s.thrust = inp.axis(['KeyS'], ['KeyW']);
    s.lift = inp.axis(['KeyC', 'ControlLeft'], ['Space']);
    s.strafe = inp.axis(['KeyQ'], ['KeyR']);
    s.roll = inp.axis(['KeyD'], ['KeyA']);
    const kbPitch = inp.axis(['ArrowDown'], ['ArrowUp']);
    const kbYaw = inp.axis(['ArrowRight'], ['ArrowLeft']);
    s.pitch = Math.max(-1, Math.min(1, -inp.stick.y + kbPitch));
    s.yaw = Math.max(-1, Math.min(1, -inp.stick.x + kbYaw));
    s.boost = inp.down('ShiftLeft', 'ShiftRight');
    s.brake = inp.down('KeyX');
    const ap = this.ship.autopilot;
    if (ap) {
      const stickMag = Math.hypot(inp.stick.x, inp.stick.y);
      const manual = s.thrust !== 0 || s.roll !== 0 || kbPitch !== 0 || kbYaw !== 0 || stickMag > 0.45 || (ap.phase === 'land' && s.lift !== 0);
      if (manual) this.ship.cancelAutopilot();
      else { s.pitch = s.yaw = 0; if (ap.phase !== 'climb') s.lift = 0; }
    }
  }

  step(dt) {
    if (this.state === 'dead' && this.ship.mode === 'destroyed' && !this.onFoot) return;
    if (this.onFoot) {
      const n = Math.max(1, Math.min(4, Math.ceil(dt / PHYS_STEP)));
      for (let i = 0; i < n; i++) {
        this.walker.update(dt / n, this.suit);
        this.walker.input.jump = false;
      }
      this.ship.update(dt);
    } else {
      const n = Math.max(1, Math.min(10, Math.ceil(dt / PHYS_STEP)));
      for (let i = 0; i < n; i++) this.ship.update(dt / n);
    }
    if (this.onFoot) this.walker.worldPos(this.playerWorld);
    else this.ship.worldPos(this.playerWorld);
  }

  // ---- Ship / walker events --------------------------------------------------------------
  processEvents() {
    const ship = this.ship;
    for (const e of ship.events) {
      switch (e.type) {
        case 'pulse-denied': this.hud.toast('Unavailable', e.why, 'warn', 4); this.audio.play('denied'); break;
        case 'pulse-spool': this.audio.play('spool'); break;
        case 'pulse-start': this.audio.play('pulse-start'); break;
        case 'pulse-exit':
          this.audio.play('pulse-exit');
          if (e.reason === 'interdicted') this.hud.toast('Pulse drive disengaged', `${e.body.name}’s gravity well pulled you out of pulse.`, 'warn', 4);
          break;
        case 'autopilot': this.hud.toast('Autopilot', `Course laid in for ${e.target.name}.`, '', 4); this.audio.play('blip'); break;
        case 'autopilot-off': this.hud.toast('Autopilot off', 'Manual control.', '', 3); break;
        case 'arrived': {
          const s = e.target.def.survivability;
          this.hud.toast(`Arrived: ${e.target.name}`, s ? `${s.rating}. ${s.summary}` : 'Press I to scan.', 'discovery', 9);
          this.audio.play('toast');
          break;
        }
        case 'barrier': {
          this.world.visuals.get(e.body.id)?.barrierImpact(e.dirLocal);
          this.audio.play('zap');
          if (this.clock - this.lastBarrierToast > 6) {
            this.lastBarrierToast = this.clock;
            this.hud.toast('Earth Defense Grid', 'Landing on Earth is not permitted. The shield holds 600 km above the surface.', 'warn', 6);
          }
          break;
        }
        case 'landed':
          this.audio.play('land');
          this.hud.toast(`Touchdown on ${e.body.name}`, `${formatSpeed(e.speed)} descent. Press E to step outside.`, '', 6);
          break;
        case 'impact':
          this.systems.damage((e.speed - SHIP.safeTouchdown) * 3.2, 'hard landing', this.playTime);
          this.audio.play('impact');
          this.damageFlash = 1;
          this.hud.toast('Hard landing', `Hit the ground at ${formatSpeed(e.speed)}.`, 'warn', 4);
          break;
        case 'crash':
          this.systems.destroy(`Crashed into ${e.body.name} at ${formatSpeed(e.speed)}.`);
          break;
        case 'autoland': this.hud.toast('Auto-land', 'Descending to the surface.', '', 4); break;
        case 'takeoff': this.audio.play('door'); break;
        default: break;
      }
    }
    ship.events.length = 0;
    for (const e of this.walker.events) {
      const vac = !(this.walker.body?.atmosphere);
      if (e.type === 'step') this.audio.play('step', { run: e.run, vacuum: vac });
      else if (e.type === 'jump') this.audio.play('jump');
      else if (e.type === 'land') this.audio.play('step', { run: true, vacuum: vac });
      else if (e.type === 'fall') {
        this.suit.harm(e.damage, 'Fatal fall.', this.playTime);
        this.audio.play('hurt');
        this.damageFlash = 1;
      }
    }
    this.walker.events.length = 0;
  }

  // ---- Warp drive: jump straight to the selected target ------------------------------------
  startWarp() {
    const ship = this.ship;
    const T = this.target;
    const deny = (why) => { this.hud.toast('Warp drive', why, 'warn', 4); this.audio.play('denied'); };
    if (this.warp) return;
    if (this.onFoot) return deny('Board your ship first.');
    if (!T) return deny('Select a target first (T, 0–9 or click the compass).');
    if (ship.mode === 'landed') return deny('Take off first.');
    if (ship.mode === 'destroyed') return;
    const d = T.pos.distanceTo(this.playerWorld);
    if (d < ship.arrivalDistance(T) * 1.3) return deny(`You are already at ${T.name}.`);
    ship.cancelAutopilot(true);
    if (ship.mode === 'pulse' || ship.spool > 0) ship.exitPulse('manual');
    this.warp = { target: T, t: 0 };
    this.hud.toast('Warp drive', `Charging. Jumping to ${T.name}.`, '', 3);
    this.audio.play('spool');
  }

  updateWarp(dt) {
    const w = this.warp;
    const flash = $('warp-flash');
    if (!w) {
      if (flash) flash.style.opacity = Math.max(0, Number(flash.style.opacity || 0) - dt * 1.2).toFixed(3);
      return;
    }
    w.t += dt;
    if (flash) flash.style.opacity = Math.min(1, (w.t / 1.4) ** 2).toFixed(3);
    if (w.t < 1.4) return;
    this.warp = null;
    const T = w.target;
    const ship = this.ship;
    // Arrive on the sunlit side, a safe distance out, facing the target.
    const from = this.playerWorld.clone().sub(T.pos).normalize();
    const toSun = this.eph.sun.pos.clone().sub(T.pos).normalize();
    if (T.id === 'sun') toSun.copy(from);
    const dir = from.multiplyScalar(0.3).addScaledVector(toSun, 0.7).normalize();
    const point = T.pos.clone().addScaledVector(dir, ship.arrivalDistance(T));
    ship.placeNear(this.eph.dominantBody(point), point);
    ship.flightAssist = true;
    ship.lookAt(T.pos.clone(), T.pole);
    ship.updateTelemetry();
    ship.worldPos(this.playerWorld);
    this.rig.initialised = false;
    this.prevTargetDist = null;
    if (T.def.terrain) this.prepareTerrain(T);
    this.audio.play('pulse-exit');
    const s = T.def.survivability;
    this.hud.toast(`Warped to ${T.name}`, s ? `${s.rating}. ${s.summary}` : 'Press I to scan.', 'discovery', 8);
  }

  /** Past the event horizon: everything goes black, then the other side. */
  enterVoid() {
    if (this.state === 'void') return;
    this.state = 'void';
    this.warp = null;
    this.input.releaseLock();
    this.hud.show(false);
    $('void').classList.add('visible');
    this.audio.play('pulse-start');
    setTimeout(() => { location.href = this.sys.exitPage || 'index.html'; }, 3200);
  }

  // ---- Black hole: tidal stretching, time dilation and echoes of your past self -------------
  updateBlackHole(dt, origin) {
    const bh = this.eph.byId.blackhole;
    if (!bh) { this.dilation = 1; return; }
    const R = bh.radius;
    const shipW = this.ship.worldPos(new THREE.Vector3());
    const r = Math.max(1.0001, shipW.distanceTo(bh.pos) / R);
    const near = !this.onFoot && this.ship.mode !== 'destroyed' && r < 30;
    // Gravitational time dilation (Schwarzschild): outside clocks run 1/√(1 − rs/r) faster.
    this.dilation = near ? Math.min(5000, 1 / Math.sqrt(1 - 1 / r)) : 1;
    // Tidal stretch grows over the last few horizon radii.
    const s = near ? smoothstep(5, 1.05, r) : 0;
    this.stretchAmount = s;
    const toHole = bh.pos.clone().sub(shipW).normalize();
    const sm = this.shipModel;
    if (s > 0.001) {
      const dLocal = toHole.clone().applyQuaternion(_q.copy(this.ship.quat).invert());
      sm.setStretch(dLocal, 1 + 3 * s * s);
    } else sm.setStretch(new THREE.Vector3(0, 0, 1), 1);
    // Screen and timer stretch towards the hole; light fades to black at the horizon.
    const camQ = _q.copy(this.rig.quat).invert();
    const v = toHole.clone().applyQuaternion(camQ);
    let ang = 0;
    if (v.z < 0) { const ux = v.x, uy = -v.y, l = Math.hypot(ux, uy) || 1; ang = Math.atan2(-ux / l, uy / l); }
    const tf = s > 0.001 ? `rotate(${ang.toFixed(3)}rad) scale(${(1 + 0.08 * s).toFixed(3)}, ${(1 + 1.6 * s * s).toFixed(3)}) rotate(${(-ang).toFixed(3)}rad)` : '';
    for (const id of ['app', 'markers', 'clock']) { const el = $(id); if (el && el.style.transform !== tf) el.style.transform = tf; }
    const black = $('blackout');
    if (black) black.style.opacity = this.state === 'void' ? '1' : (near ? smoothstep(1.7, 1.0, r) : 0).toFixed(3);

    // Echoes: light that looped around the black hole shows where you were seconds ago.
    if (!this.echoes) {
      this.echoHistory = [];
      this.echoes = [0, 1].map((i) => {
        const mat = new THREE.MeshBasicMaterial({ color: i ? 0x6f8cff : 0x9fd0ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
        const g = sm.body.clone(true);
        g.position.set(0, 0, 0);
        g.traverse((o) => {
          if (!o.isMesh) return;
          // Exhaust plumes and glows don't belong in the echo: just the hull.
          if (o.material.isShaderMaterial || o.material.isMeshBasicMaterial) { o.visible = false; return; }
          o.material = mat;
          o.castShadow = false;
        });
        g.visible = false;
        this.engine.scene.add(g);
        return { g, mat, delay: i ? 11 : 5 };
      });
    }
    const hist = this.echoHistory;
    if (near && r < 12) {
      const last = hist[hist.length - 1];
      if (!last || this.clock - last.t > 0.08) hist.push({ t: this.clock, rel: shipW.clone().sub(bh.pos), quat: this.ship.quat.clone() });
      while (hist.length && this.clock - hist[0].t > 20) hist.shift();
    } else if (hist.length) hist.length = 0;
    for (const e of this.echoes) {
      const want = this.clock - e.delay;
      let rec = null;
      if (near && r < 12) for (let i = hist.length - 1; i >= 0; i--) if (hist[i].t <= want) { rec = hist[i]; break; }
      // Only worth drawing once you have moved away from where you were.
      const show = rec && rec.rel.distanceTo(shipW.clone().sub(bh.pos)) > 25;
      e.g.visible = !!show;
      if (!show) continue;
      e.g.position.copy(bh.pos).add(rec.rel).sub(origin);
      e.g.quaternion.copy(rec.quat);
      e.mat.opacity = smoothstep(12, 4, r) * (e.delay > 6 ? 0.25 : 0.4) * (0.85 + 0.15 * Math.sin(this.clock * 3 + e.delay));
    }
  }

  exitShip() {
    const ship = this.ship;
    if (ship.mode !== 'landed') {
      this.hud.toast('Cannot exit', ship.parent.def.terrain ? 'Land first (L to auto-land when low and slow).' : 'There is no solid ground here.', 'warn', 4);
      this.audio.play('denied');
      return;
    }
    const body = ship.landed.body;
    const terrain = this.terrainFor(body);
    if (!terrain) { this.hud.toast('One moment', 'Surface survey still loading.', 'warn', 3); return; }
    const shipLocal = body.toLocal(ship.rel.clone());
    const right = body.toLocal(_v.set(1, 0, 0).applyQuaternion(ship.quat).clone());
    const spawn = shipLocal.clone().addScaledVector(right, -(WALK.shipRadius + 1.2));
    this.walker.spawn(body, terrain, spawn, shipLocal);
    // Face the same way as the ship.
    const fwdW = ship.forward(new THREE.Vector3());
    const f = this.walker.frameWorld();
    const heading = Math.atan2(fwdW.dot(f.east), fwdW.dot(f.north));
    this.rig.footYaw = -heading;
    this.rig.footPitch = -0.12;
    this.onFoot = true;
    this.astro.root.visible = true;
    this.audio.play('door');
    if (this.life && body === this.life.body) this.life.onExitShip();
    const s = body.def.survivability;
    this.hud.toast(`On ${body.name}`, `${s ? `${s.rating}: ${s.hazards?.[0] || s.summary}. ` : ''}Life support ${Math.ceil(this.suit.lifeSupport)}%. Return with E.`, '', 7);
  }

  enterShip() {
    if (this.walker.distanceToShip() > 13) {
      this.hud.toast('Too far', 'Walk back to the ship to board it.', 'warn', 3);
      return;
    }
    this.onFoot = false;
    this.astro.root.visible = false;
    this.rig.initialised = false;
    this.audio.play('door');
  }

  // ---- Environment and survival ----------------------------------------------------------
  updateSystems(dt) {
    if (this.state !== 'play' && this.state !== 'menu') return;
    const eph = this.eph, sun = eph.sun;
    const body = this.currentBody();
    const P = this.playerWorld;
    const rel = _v.subVectors(P, body.pos);
    const dist = rel.length();
    const up = rel.clone().divideScalar(dist);
    const sunDir = _w.subVectors(sun.pos, P).normalize().clone();
    const t = this.ship.telemetry;
    const altitude = this.onFoot ? Math.max(0, this.walker.pos.length() - this.walker.groundR) : t.altitude;
    const sunVis = this.world.sunVisibility(P);
    let trans = 1;
    if (body.atmosphere) trans = sunlightTransmission(body, altitude, up.dot(sunDir)).factor;
    const flux = solarFlux(P.distanceTo(sun.pos)) * sunVis * trans;
    let radiation = radiationDose(eph, P);
    if (body.atmosphere) {
      const st = atmosphereAt(body, altitude);
      const g = body.GM / (dist * dist);
      radiation *= Math.exp(-(st.pressure / g) / 500);
    }
    const now = this.playTime;
    // Ship.
    let ringHazard = 0;
    const parent = this.ship.parent;
    if (parent.def.rings?.style === 'saturn') {
      const local = parent.toLocal(this.ship.rel.clone());
      const density = ringDensityAt(parent, local, this.ringTex);
      if (density > 0) {
        const r = Math.hypot(local.x, local.z);
        const vCirc = Math.sqrt(parent.GM / r);
        const orbitDir = new THREE.Vector3().crossVectors(parent.pole, this.ship.rel).normalize();
        const vRel = this.ship.vel.clone().sub(orbitDir.multiplyScalar(vCirc)).length();
        ringHazard = density * Math.min(60, 1 + vRel / 300);
      }
    }
    const shipWarn = this.systems.update({
      dt, now,
      solarFlux: this.onFoot ? solarFlux(P.distanceTo(sun.pos)) * sunVis * trans : flux,
      heatFlux: t.heatFlux,
      dynPressure: t.dynPressure,
      pressure: t.pressure,
      airTemp: t.temperature,
      airDensity: t.density,
      radiation,
      ringHazard,
      insideSun: this.ship.worldPos(_v).distanceTo(sun.pos) < sun.radius,
      landed: this.ship.mode === 'landed',
    });
    // Suit.
    let temp, pressure;
    if (this.onFoot) {
      if (body.atmosphere && body.atmosphere.pressure > 5e4) {
        const st = atmosphereAt(body, altitude);
        temp = st.temperature; pressure = st.pressure;
      } else {
        temp = surfaceTemperature(body, up, sunDir);
        if (sunVis < 0.5 && body.def.temps) temp = Math.min(temp, body.def.temps.nightK + (temp - body.def.temps.nightK) * sunVis);
        pressure = body.atmosphere ? atmosphereAt(body, altitude).pressure : 0;
      }
    } else {
      temp = t.temperature;
      pressure = t.pressure;
    }
    // Tidally locked "eyeball" world: hot under the star, frozen on the far side.
    if (body.atmosphere?.eyeball && temp !== null && temp !== undefined && body.def.temps) {
      const x = body.toLocal(up.clone()).x;
      const T = body.def.temps;
      const ground = T.nightK + (T.dayK - T.nightK) * smoothstep(-0.45, 0.85, x);
      temp = ground + (temp - body.atmosphere.tempK);
    }
    this.env = { temp, pressure, radiation, solarFlux: flux };
    let suitWarn = [];
    if (this.onFoot) {
      suitWarn = this.suit.update({ dt, now, temp, pressure, radiation, breathable: !!body.atmosphere?.breathable });
    } else {
      this.suit.recharge(dt);
    }
    this.warnings = [...suitWarn, ...shipWarn];
    // The black hole: warnings as you near the horizon, then the other side.
    if (body.kind === 'blackhole') {
      const r = dist / body.radius;
      if (r < 1) { this.enterVoid(); return; }
      if (r < 4) this.warnings.unshift({ level: r < 2 ? 'danger' : 'caution', text: `Event horizon ${formatDistance(dist - body.radius)} away: gravity ${(t.gravity / G0).toFixed(1)} g` });
    }
    // Gas giants: gravity can beat the thrusters.
    if (!this.onFoot && body.atmosphere?.gasGiant && t.altitude < body.atmosphere.top && t.gravity > SHIP.liftAccel * 0.95 && this.ship.mode === 'flight') {
      this.warnings.push({ level: 'caution', text: `Gravity ${(t.gravity / G0).toFixed(1)} g beats the hover thrusters: boost (Shift) to climb` });
    }
    if (this.systems.hull < this.lastHull - 0.4) this.damageFlash = Math.min(1, this.damageFlash + 0.5);
    this.lastHull = this.systems.hull;

    if (this.state !== 'play') return;
    if (this.systems.destroyed && this.ship.mode !== 'destroyed') {
      this.ship.mode = 'destroyed';
      if (!this.onFoot) {
        this.explosion.trigger(this.ship.worldPos(new THREE.Vector3()));
        this.audio.play('explosion');
        this.die('Ship destroyed', this.systems.cause);
      } else {
        this.hud.toast('Ship destroyed', `${this.systems.cause} You are stranded.`, 'warn', 8);
      }
    }
    if (this.onFoot && this.suit.dead) this.die('You died', this.suit.cause);
    if (this.onFoot && this.ship.mode === 'destroyed' && this.suit.lifeSupport <= 0 && this.suit.health <= 0) this.die('You died', 'Stranded without a ship.');

    // Arrivals and discoveries.
    if (body !== this.lastBody) {
      if (!this.visited.has(body.id) && body.id !== 'sun') {
        this.visited.add(body.id);
        const s = body.def.survivability;
        this.hud.toast(`Entering ${body.name}’s gravity`, s ? `${s.rating}. ${s.summary}` : '', 'discovery', 8);
        this.audio.play('toast');
      }
      this.lastBody = body;
    }
    const inAtmo = !this.onFoot && t.inAtmosphere;
    if (inAtmo && !this.wasInAtmo) {
      this.hud.toast(`Entering ${body.name}’s atmosphere`, body.atmosphere.composition, '', 5);
    }
    this.wasInAtmo = inAtmo;
  }

  // ---- Camera ------------------------------------------------------------------------------
  updateCamera(dt) {
    const look = this.input.takeLook();
    const wheel = this.input.takeWheel();
    if (wheel) this.rig.zoomBy(wheel);
    if (this.onFoot) {
      this.rig.updateFoot(this.walker, dt, look);
    } else {
      const t = this.ship.telemetry;
      const q = t.dynPressure || 0;
      let shake = Math.min(2.5, q / 25e3);
      if (this.ship.mode === 'pulse') shake += 0.15;
      if (this.ship.spool > 0) shake += this.ship.spool * 0.6;
      if (this.warp) shake += this.warp.t * 0.8;
      const cb = this.currentBody();
      if (cb.kind === 'blackhole') shake += Math.max(0, 3 - this.playerWorld.distanceTo(cb.pos) / cb.radius) * 0.6;
      this.rig.updateShip(this.ship, dt, { pulse: this.ship.mode === 'pulse', shake });
    }
    // Never let the camera dip under the ground.
    const body = this.currentBody();
    const t = this.terrainFor(body);
    if (t || body.def.terrain) {
      const rel = _v.subVectors(this.rig.world, body.pos);
      const local = body.toLocal(rel, new THREE.Vector3());
      const d = local.length();
      const dir = local.clone().divideScalar(d);
      const ground = t ? t.surfaceRadius(dir) : body.surfaceRadiusLocal(dir);
      const minUp = this.onFoot ? 0.35 : 1.2;
      if (d < ground + minUp) this.rig.world.addScaledVector(rel.divideScalar(d), ground + minUp - d);
    }
    this.camWorld.copy(this.rig.world);
    const cam = this.engine.camera;
    cam.position.set(0, 0, 0);
    cam.quaternion.copy(this.rig.quat);
    cam.updateMatrixWorld();
  }

  // ---- Visuals -------------------------------------------------------------------------------
  updateVisuals(dt) {
    const eng = this.engine;
    const scene = eng.scene;
    const origin = this.camWorld;
    const body = this.currentBody();
    const sun = this.eph.sun;
    const sunDir = new THREE.Vector3().subVectors(sun.pos, origin).normalize();
    const camRel = new THREE.Vector3().subVectors(origin, body.pos);
    const camDist = camRel.length();
    const upCam = camRel.clone().divideScalar(camDist);
    // Altitude above the reference ellipsoid (the giant planets are flattened).
    const refR = body.surfaceRadiusLocal(body.toLocal(upCam.clone()));
    const camAlt = camDist - refR;
    const elev = upCam.dot(sunDir);

    // Sun above the local horizon for nearby objects (ship parked on the night side).
    const pDist = this.playerWorld.distanceTo(body.pos);
    const dip = Math.acos(Math.min(1, refR / Math.max(refR, pDist)));
    const upP = _v.subVectors(this.playerWorld, body.pos).normalize();
    const e = upP.dot(_w.subVectors(sun.pos, this.playerWorld).normalize());
    LOCAL_SUN.value = body.id === 'sun' ? 1 : smoothstep(-Math.sin(dip) - 0.012, -Math.sin(dip) + 0.02, e);

    // Atmosphere around the camera.
    const atm = body.atmosphere;
    let sunTrans = 1, sunTint = null, skyFade = 1, skyLight = 0, skyColor = null, groundColor = null, glare = 1;
    let fogDensity = 0, fogLinear = null;
    let exposureBoost = 1;
    let dome = null;
    for (const v of this.world.visuals.values()) v.atmoDim = 1;
    if (atm && camAlt < atm.top * 1.3 && body.id !== 'sun') {
      const st = sunlightTransmission(body, Math.max(0, camAlt), elev);
      sunTrans = st.factor;
      sunTint = st.tint;
      glare = sunTrans;
      const day = smoothstep(-0.12, 0.2, elev);
      const H = atm.mieScaleHeight || atm.scaleHeight;
      const dens = Math.exp(-Math.max(0, camAlt) / atm.scaleHeight);
      const beta = (atm.rayleigh[0] + atm.rayleigh[1] + atm.rayleigh[2]) / 3 + (atm.mie || 0);
      const tau = beta * atm.scaleHeight * dens;
      // How much the daytime sky glow drowns out the stars (Mars: all of them;
      // Pluto's 1 Pa haze: none).
      const thick = Math.min(1, tau * 12) * Math.min(1, atm.pressure / 200);
      skyFade = 1 - day * thick * 0.95;
      const haze = atm.haze || [0.6, 0.7, 0.9];
      // Cloud and haze decks overhead (Venus, Titan) dim everything below them;
      // the eye adapts part of the way.
      const thickF = Math.exp(-Math.max(0, camAlt) / (atm.scaleHeight * 2.5));
      const dim = (1 - thickF) + thickF * (atm.surfaceLight ?? 1);
      const vis0 = this.world.visuals.get(body.id);
      if (vis0) vis0.atmoDim = dim;
      exposureBoost = Math.min(5, 1 / Math.sqrt(Math.max(dim, 0.01)));
      skyLight = day * Math.min(1, tau * 3) * 0.9 * dim;
      skyColor = [haze[0] * 0.9, haze[1] * 0.95, haze[2]];
      groundColor = [haze[0] * 0.35, haze[1] * 0.3, haze[2] * 0.25];
      const light = (0.03 + 0.97 * day) * dim;
      const vis = VISIBILITY[body.id];
      if (vis && this.terrain && this.terrain.body === body) {
        fogDensity = (Math.sqrt(Math.LN10) / vis) * Math.exp(-Math.max(0, camAlt) / H);
        fogLinear = [haze[0] * light * 0.9, haze[1] * light * 0.9, haze[2] * light * 0.9];
      }
      if (atm.gasGiant) {
        // Below a giant planet's cloud tops: murk that darkens with depth.
        const o = smoothstep(25e3, -60e3, camAlt);
        if (o > 0) {
          dome = {
            opacity: o, top: atm.cloudColor || haze, bottom: atm.deepColor || [0.2, 0.15, 0.1],
            light: (0.04 + 0.96 * day) * Math.exp(Math.min(0, camAlt) / 90e3), lightning: camAlt < 0, fog: 0.004 * o,
          };
        }
      } else if ((atm.surfaceLight ?? 1) < 0.3) {
        // Venus and Titan: an overcast of sulfuric-acid cloud or orange haze.
        const deckTop = atm.cloudTop ?? atm.hazeTop ?? atm.top;
        const o = smoothstep(deckTop, deckTop * 0.55, camAlt);
        const inCloud = atm.cloudBase ? smoothstep(atm.cloudTop, atm.cloudTop - 6e3, camAlt) * (1 - smoothstep(atm.cloudBase + 4e3, atm.cloudBase - 2e3, camAlt)) : 0;
        const cc = atm.cloudColor || haze;
        const sky = atm.overcast || haze;
        if (o > 0) {
          dome = {
            opacity: Math.min(1, o * 0.96 + inCloud),
            top: [0, 1, 2].map((k) => sky[k] * (1 - inCloud) + cc[k] * inCloud),
            bottom: sky.map((c) => c * 0.4),
            light: (0.04 + 0.96 * day) * Math.max(dim, 0.02) * 1.6, lightning: false, fog: 0.003 * inCloud,
          };
        }
      }
      if (dome) {
        this.deep.update({ ...dome, up: upCam, sunDir, dt });
        const hz = [0, 1, 2].map((k) => (dome.bottom[k] + 0.43 * (dome.top[k] - dome.bottom[k])) * dome.light);
        fogLinear = fogLinear ? fogLinear.map((c, k) => c + (hz[k] - c) * dome.opacity) : hz;
        fogDensity = Math.max(fogDensity, dome.fog);
        skyFade *= 1 - dome.opacity;
        glare *= 1 - dome.opacity;
        sunTrans *= 1 - 0.8 * dome.opacity;
        skyLight = Math.max(skyLight, dome.opacity * dome.light * 1.4);
        skyColor = dome.top.map((c) => c * 0.9);
        groundColor = dome.bottom.slice();
      } else this.deep.update({ opacity: 0, dt });
    } else {
      this.deep.update({ opacity: 0, dt });
      // Airless ground: light bounced off the sunlit surface fills shadows.
      if (body.def.terrain && camAlt < 50e3) {
        const albedo = body.def.visual?.albedo ?? 0.12;
        skyLight = Math.max(0, elev) * albedo * 1.6;
        skyColor = [0.02, 0.02, 0.025];
        const c = new THREE.Color(body.def.visual?.pointColor || '#999999');
        groundColor = [c.r, c.g, c.b];
        // A bright sunlit landscape stops the camera down: fewer stars.
        if (camAlt < 5e3 && elev > 0) skyFade = 0.45;
      }
    }
    if (fogDensity > 1e-7 && fogLinear) {
      if (!scene.fog) scene.fog = new THREE.FogExp2(0x000000, 0);
      scene.fog.density = fogDensity;
      // Fog is blended after tone mapping, so give it the on-screen colour.
      const d = toDisplay(fogLinear, eng.renderer.toneMappingExposure);
      scene.fog.color.setRGB(d[0], d[1], d[2]);
    } else if (scene.fog) {
      scene.fog.density = 0;
    }

    const shipRel = this.ship.worldPos(_v).sub(origin);
    const focus = this.onFoot ? this.walker.worldPos(_w).sub(origin).clone() : shipRel.clone();
    this.world.update({
      origin,
      time: this.clock,
      dt,
      quality: eng.quality,
      lightTarget: focus,
      sunTransmission: sunTrans,
      sunTint,
      wantShadows: true,
      skyLight,
      skyColor,
      groundColor,
      skyFade,
      sunGlare: glare,
      exposureBoost,
      // The accretion disk lights itself: don't brighten it like dim sunlight.
      exposureTarget: body.kind === 'blackhole' ? 0.9 : undefined,
      sunExclude: body.id === 'sun' ? null : body,
    });

    // Ship model.
    const sm = this.shipModel;
    sm.root.visible = this.ship.mode !== 'destroyed';
    const cockpit = !this.onFoot && this.rig.mode === 'cockpit' && this.state !== 'menu';
    const frame = $('cockpit-frame');
    if (frame && frame.hidden === cockpit) frame.hidden = !cockpit;
    sm.root.position.copy(shipRel);
    sm.root.quaternion.copy(this.ship.quat);
    const t = this.ship.telemetry;
    const qInv = _q.copy(this.ship.quat).invert();
    const vSurf = this.ship.parent.surfaceVelocity(this.ship.rel, new THREE.Vector3());
    const vAir = this.ship.vel.clone().sub(vSurf);
    const flowLocal = vAir.clone().negate().applyQuaternion(qInv);
    const heat = t.heatFlux > 1.5e5 ? Math.min(1, Math.log10(t.heatFlux / 1.5e5) / 1.5) : 0;
    const thrustLocal = this.ship.thrustLocal || _w.set(0, 0, 0);
    const pulse = this.ship.mode === 'pulse' || this.ship.spool > 0;
    sm.update({
      thrust: Math.max(this.ship.input.thrust, -thrustLocal.z / SHIP.mainAccel * 0.6),
      lift: this.ship.input.lift,
      pulse,
      boost: this.ship.input.boost,
      gearDown: this.ship.mode === 'landed' || (t.ground < 160 && (t.surfaceSpeed || 0) < 90),
      heat,
      flowLocal,
      shake: Math.min(0.12, (t.dynPressure || 0) / 4e5),
      dt,
    });
    this.heatGlow = heat;
    this.updateBlackHole(dt, origin);

    // Astronaut.
    if (this.onFoot) {
      const w = this.walker;
      const f = w.frameWorld();
      const a = this.astro;
      a.root.visible = this.rig.footMode !== 'first';
      a.root.position.subVectors(f.pos, origin);
      const facing = (this.life?.armed ? w.cameraForward.clone() : w.facing.clone().applyQuaternion(w.body.quat));
      facing.addScaledVector(f.up, -facing.dot(f.up)).normalize();
      const right = new THREE.Vector3().crossVectors(f.up, facing).normalize();
      _m.makeBasis(right, f.up, facing);
      a.root.quaternion.setFromRotationMatrix(_m);
      a.update({ speed: w.speed, run: w.input.run, onGround: w.onGround, jetting: w.jetting, dt });
    }

    // Proxima b's wildlife, crates, plants and the laser rifle.
    if (this.sys.id === 'proxima') {
      if (!this.life && this.eph.byId.proxb) this.life = new ProximaLife(this, this.eph.byId.proxb);
      if (this.state === 'play' || this.state === 'paused') this.life?.update(this.state === 'play' ? dt : 0);
    }

    // Speed dust: motion relative to the nearest world's surface.
    let vel;
    if (this.onFoot) vel = this.walker.worldVel(new THREE.Vector3());
    else if (this.ship.mode === 'pulse') vel = this.ship.forward(new THREE.Vector3()).multiplyScalar(this.ship.pulseSpeed);
    else vel = (t.relVel || vAir).clone();
    const airDust = atm && camAlt < atm.top ? Math.exp(-Math.max(0, camAlt) / atm.scaleHeight) : 0;
    const haze = atm?.haze || [1, 1, 1];
    this.dust.update(dt, vel, {
      air: airDust,
      pulse: this.ship.mode === 'pulse' && !this.onFoot,
      color: this.ship.mode === 'pulse' ? [0.75, 0.88, 1] : airDust > 0.02 ? haze : [0.85, 0.9, 1],
      amount: eng.quality.particles,
    });
    this.explosion.update(dt, origin);
  }

  // ---- HUD -------------------------------------------------------------------------------------
  updateHud(dt) {
    if (this.state === 'menu' || this.state === 'loading') return;
    const body = this.currentBody();
    const P = this.playerWorld;
    const ship = this.ship;
    let telemetry = ship.telemetry;
    const rel = new THREE.Vector3().subVectors(P, body.pos);
    const up = rel.clone().normalize();
    if (this.onFoot) {
      const w = this.walker;
      const r = w.pos.length();
      telemetry = {
        altitude: Math.max(0, r - w.groundR),
        ground: Math.max(0, r - w.groundR),
        vSpeed: w.vel.dot(w.pos.clone().normalize()),
        speed: w.speed,
        gravity: body.GM / (r * r),
        nearest: body,
        nearestDist: Math.max(0, r - w.groundR),
      };
    }
    // Heading (degrees from north, clockwise).
    let surface = null;
    const alt = telemetry.altitude;
    if (alt < 200e3 && body.id !== 'sun') {
      const fwd = this.onFoot ? this.walker.cameraForward.clone() : ship.forward(new THREE.Vector3());
      const north = body.pole.clone().addScaledVector(up, -body.pole.dot(up)).normalize();
      const east = new THREE.Vector3().crossVectors(north, up);
      let hd = (Math.atan2(fwd.dot(east), fwd.dot(north)) * 180) / Math.PI;
      if (hd < 0) hd += 360;
      surface = { altitude: alt, ground: telemetry.ground ?? alt, heading: hd };
    }
    // Closing speed on the target.
    let closing = 0;
    if (this.target) {
      const d = this.target.pos.distanceTo(P);
      if (this.prevTargetDist !== null && dt > 0) {
        const c = (this.prevTargetDist - d) / dt;
        this.closing += (c - this.closing) * Math.min(1, dt * 3);
        closing = this.closing;
      }
      this.prevTargetDist = d;
    }
    const relVel = this.onFoot || !ship.telemetry.relVel ? null : ship.telemetry.relVel.clone();
    // Landmarks.
    const landmarks = [];
    for (const s of this.landmarkSites.get(body.id) || []) {
      const world = s.local.clone().applyQuaternion(body.quat).add(body.pos);
      landmarks.push({ name: s.lm.name.split(' · ')[0], world, distance: world.distanceTo(P) });
    }
    if (this.life) landmarks.push(...this.life.landmarks());
    // Prompt.
    let prompt = null;
    if (this.state === 'play') {
      if (this.onFoot) {
        if (this.life?.nearCrate()) prompt = '<kbd>E</kbd> Open supply crate';
        else if (this.walker.distanceToShip() < 13) prompt = '<kbd>E</kbd> Board ship';
      } else if (ship.mode === 'landed') {
        prompt = '<kbd>E</kbd> Step outside · <kbd>Space</kbd> take off';
      } else if (ship.mode === 'flight' && body.def.terrain && telemetry.ground < 1500 && !ship.autopilot) {
        prompt = '<kbd>L</kbd> Auto-land';
      } else if (ship.mode === 'flight' && this.target && !ship.autopilot && this.target.pos.distanceTo(P) > ship.arrivalDistance(this.target) * 2) {
        prompt = '<kbd>K</kbd> Warp to target · <kbd>G</kbd> autopilot · <kbd>J</kbd> pulse';
      }
    }
    const ap = ship.autopilot;
    const apLabel = ap ? { align: 'ALIGNING', climb: 'CLIMBING', cruise: 'CRUISE', land: 'LANDING', arrived: 'ARRIVED' }[ap.phase] : null;
    this.hud.update({
      origin: this.camWorld,
      camQuat: this.rig.quat,
      camera: this.engine.camera,
      target: this.target,
      current: body,
      playerPos: P,
      telemetry,
      systems: this.systems,
      suit: this.suit,
      onFoot: this.onFoot,
      env: this.env,
      landmarks,
      now: this.clock,
      relVel,
      mode: ship.mode,
      surface,
      walkerSpeed: this.walker.speed,
      walkerAir: this.onFoot && !this.walker.onGround,
      autopilot: apLabel,
      flightAssist: ship.flightAssist,
      surfaceSpeed: telemetry.surfaceSpeed,
      closingSpeed: closing,
      warnings: this.warnings,
      prompt,
      showFps: this.showFps,
      fps: this.engine.fps,
      qualityName: this.engine.quality.name,
    });
    // Laser rifle energy.
    const lg = $('g-laser');
    if (lg) {
      const armed = !!this.life?.armed && this.onFoot;
      lg.hidden = !armed;
      if (armed) this.hud.gauge('g-laser', this.life.weapon.energy, `${Math.floor(this.life.weapon.energy)}%`);
    }
    if (!this.onFoot || !this.life) { const al = $('aim-label'); if (al) al.hidden = true; }
    // Ship clock vs universe clock (time dilation near the black hole).
    if (this.clock - (this.lastClockText || 0) > 0.1) {
      this.lastClockText = this.clock;
      const el = $('clock');
      if (el) {
        el.hidden = this.state !== 'play' && this.state !== 'paused';
        const T = Math.floor(this.playTime);
        const pad = (n) => String(n).padStart(2, '0');
        const ship = `T+ ${pad(Math.floor(T / 3600))}:${pad(Math.floor(T / 60) % 60)}:${pad(T % 60)}`;
        const u = new Date(this.simTime);
        const univ = `${u.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} ${u.toLocaleTimeString('en-GB')}`;
        const d = this.dilation || 1;
        const txt = `<span><b>SHIP</b> ${ship}</span><span><b>UNIVERSE</b> ${univ}</span>${d > 1.005 ? `<span class="dil"><b>TIME</b> ×${d < 100 ? d.toFixed(2) : Math.round(d).toLocaleString('en-US')}</span>` : ''}`;
        if (el.innerHTML !== txt) el.innerHTML = txt;
        el.classList.toggle('dilated', d > 1.05);
      }
    }
    this.updateKeysPanel();
    // Virtual stick indicator.
    const st = $('stick');
    if (st) {
      const show = !this.onFoot && this.state === 'play' && ship.mode !== 'landed';
      st.hidden = !show;
      if (show) st.style.transform = `translate(${(this.input.stick.x * 90).toFixed(1)}px, ${(this.input.stick.y * 90).toFixed(1)}px)`;
    }
    // Heat / damage vignettes.
    const heatEl = $('heat-vignette');
    if (heatEl) {
      const T = this.systems.hullTemp;
      const hot = Math.max(this.heatGlow || 0, smoothstep(900, 2000, T));
      heatEl.style.opacity = hot.toFixed(3);
    }
    this.damageFlash = Math.max(0, this.damageFlash - dt * 2);
    const dmg = $('damage-flash');
    if (dmg) dmg.style.opacity = (this.damageFlash * 0.6).toFixed(3);
    const danger = this.warnings.some((w) => w.level === 'danger');
    this.audio.alarm(this.clock, danger && this.state === 'play');
  }

  // ---- Controls panel (right side): what each key does right now ------------------------------
  updateKeysPanel() {
    if (this.keysHidden === undefined) {
      try { this.keysHidden = localStorage.getItem('solv-keys-hidden') === '1'; } catch (e) { this.keysHidden = false; }
    }
    if (this.clock - (this.lastKeysUpdate || 0) < 0.2) return;
    this.lastKeysUpdate = this.clock;
    const panel = $('keys'), tab = $('keys-tab');
    if (!panel) return;
    const ship = this.ship, t = ship.telemetry;
    const foot = this.onFoot;
    const flying = ship.mode === 'flight' || ship.mode === 'pulse';
    const landed = ship.mode === 'landed';
    const hasTarget = !!this.target;
    const nearShip = foot && this.walker.distanceToShip() < 13;
    const lowSlow = ship.mode === 'flight' && this.currentBody().def.terrain && t.ground < 1500;
    // [keys, what it does, available now?, highlighted?]
    const rows = foot ? [
      [['Mouse'], 'Look around', true],
      [['W', 'A', 'S', 'D'], 'Walk', true],
      [['Shift'], 'Run', true],
      [['Space'], 'Jump · hold in the air for the jetpack', true],
      [['C'], 'Jetpack down', !this.walker.onGround],
      ...(this.life?.nearCrate() ? [[['E'], 'Open supply crate', true, true]] : [[['E'], 'Board the ship', nearShip, nearShip]]),
      ...(this.life?.armed ? [[['Click', 'R'], `Fire laser (${Math.floor(this.life.weapon.energy)}%)`, true]] : []),
      [['V'], 'Third / first person', true],
      [['F'], `Helmet lamp ${this.lightsOn ? 'off' : 'on'}`, true],
      [['I'], 'Scan: facts and survivability', true],
      [['T', '0–9'], 'Choose a target', true],
      [['M'], this.audio.muted ? 'Sound on' : 'Mute', true],
      [['Esc'], 'Pause', true],
    ] : [
      [['Mouse'], 'Steer (click the view first)', flying],
      [['W', 'S'], 'Thrust forward / reverse', !landed],
      [['A', 'D'], 'Roll', flying],
      [['Space', 'C'], landed ? 'Take off / thrust down' : 'Thrust up / down', true],
      [['Shift'], 'Boost', !landed],
      [['X'], 'Brake to a stop', flying],
      [['T', '0–9'], 'Choose a target', true],
      [['K'], hasTarget ? `Warp to ${this.target.name}` : 'Warp drive (needs a target)', hasTarget && !landed, false],
      [['G'], ship.autopilot ? 'Cancel autopilot' : 'Autopilot to the target', hasTarget && !landed],
      [['J'], ship.mode === 'pulse' ? 'Leave pulse drive' : 'Pulse drive (faster than light)', flying],
      [['L'], 'Auto-land', !!lowSlow, !!lowSlow],
      [['E'], 'Step outside', landed, landed],
      [['Z'], ship.flightAssist ? 'Flight assist off' : 'Flight assist on', flying],
      [['V'], this.rig.mode === 'chase' ? 'Cockpit view' : 'Chase view', true],
      [['F'], `Landing lights ${this.lightsOn ? 'off' : 'on'}`, true],
      [['I'], 'Scan: facts and survivability', true],
      [['Wheel'], 'Zoom the camera', true],
      [['M'], this.audio.muted ? 'Sound on' : 'Mute', true],
      [['Esc'], 'Pause', true],
    ];
    const html = rows.map(([keys, label, on, hot]) => `<li class="${on ? '' : 'off'}${hot ? ' hot' : ''}"><span class="k">${keys.map((k) => `<kbd>${k}</kbd>`).join('')}</span><span class="d">${label}</span></li>`).join('');
    if (this.keysHtml !== html) { this.keysHtml = html; $('keys-list').innerHTML = html; }
    $('keys-mode').textContent = foot ? 'ON FOOT' : 'SHIP';
    // Fit between the target panel and the status panel; hide if there is no room.
    const tgt = $('target').getBoundingClientRect(), st = $('status').getBoundingClientRect();
    const top = (tgt.height ? tgt.bottom : 16) + 10;
    const room = st.top - 10 - top;
    const show = !this.keysHidden && room > 140;
    panel.hidden = !show;
    tab.hidden = show || room < 30;
    if (show) { panel.style.top = `${top}px`; panel.style.maxHeight = `${room}px`; }
    else tab.style.top = `${top}px`;
  }

  updateAudio() {
    if (!this.audio.started) return;
    const ship = this.ship;
    const t = ship.telemetry;
    const inShip = !this.onFoot;
    const thrustLocal = ship.thrustLocal || _v.set(0, 0, 0);
    const thrust = this.state === 'play' && ship.mode === 'flight' ? Math.min(1, Math.max(Math.abs(ship.input.thrust), thrustLocal.length() / SHIP.mainAccel * 0.5)) : 0;
    const rcs = this.state === 'play' && ship.mode === 'flight' ? Math.min(1, Math.abs(ship.input.lift) + Math.abs(ship.input.roll) * 0.5 + Math.hypot(ship.input.pitch, ship.input.yaw) * 0.3) : 0;
    const q = this.onFoot ? 0 : t.dynPressure || 0;
    const wind = this.state === 'play' ? Math.min(1, Math.sqrt(q / 20e3)) : 0;
    this.audio.update({
      thrust, boost: ship.input.boost, rcs,
      spool: ship.spool > 0 ? Math.min(1, ship.spool / SHIP.pulseSpool) : 0,
      pulse: ship.mode === 'pulse' && this.state === 'play',
      wind, windSpeed: t.surfaceSpeed || 0,
      jet: this.onFoot && this.walker.jetting,
      inShip, airDensity: this.onFoot ? atmosphereAt(this.walker.body, 0).density : t.density,
    });
  }
}
