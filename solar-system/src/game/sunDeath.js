// =============================================================================
// sunDeath.js — an optional end of the Solar System, switched on from the
// pause menu.
//
//   1. The Sun swells into a red giant in five minutes, swallowing every world
//      out to Neptune (anyone caught inside dies). Pluto and Charon survive.
//   2. It collapses into a black hole where the Sun was.
//   3. Over three minutes the black hole drags Pluto and Charon in on a
//      tightening spiral until they vanish. Ride Pluto in and you go with it.
//   4. At Proxima, Pluto comes through and slams into Alpha Centauri B: the
//      flash fades into something new, a hotter, brighter merged star,
//      Nova Plutonis.
//
// Like the Devourer, its progress is one saved clock shared by both systems.
// =============================================================================
import * as THREE from 'three';
import { AU, STAR } from '../constants.js';

const STORE = 'solv-sundeath';
const EXPAND = 300, COLLAPSE = 20, PULL = 180, IMPACT = 60;
const T_COLLAPSE = EXPAND, T_PULL = EXPAND + COLLAPSE, T_IMPACT = T_PULL + PULL, T_END = T_IMPACT + IMPACT;
const MAX_RADIUS = 31 * AU;     // just past Neptune; Pluto (~34 AU) is spared
const SURVIVORS = new Set(['sun', 'pluto', 'charon', 'blackhole', 'devourer']);
const smooth = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const clockText = (s) => { const t = Math.ceil(Math.max(0, s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

export class SunDeath {
  constructor(game) {
    this.game = game;
    this.eph = game.eph;
    this.sysId = game.sys.id;
    this.on = false;
    this.clock = 0;
    try {
      const s = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (s) { this.on = !!s.on; this.clock = Math.max(0, +s.clock || 0); }
    } catch (e) { /* defaults */ }
    const sun = this.eph.sun;
    this.base = { radius: sun.radius, star: { luminosity: STAR.luminosity, color: [...STAR.color], disk: [...STAR.disk] } };
    const acb = this.eph.byId.alphacenB;
    if (acb) this.acb = { name: acb.name, magnitude: acb.def.visual.magnitude, color: acb.def.visual.pointColor };
    this.pullStart = null;      // Pluto's and Charon's positions when the pull began
    this.saveTimer = 0;
    this.lastPhase = this.phase();
  }

  setOn(on) { this.on = on; this.lastPhase = this.phase(); this.save(); this.restore(); }
  reset() { this.clock = 0; this.pullStart = null; this.lastPhase = this.phase(); this.save(); this.restore(); }
  save() { try { localStorage.setItem(STORE, JSON.stringify({ on: this.on, clock: Math.round(this.clock * 10) / 10 })); } catch (e) { /* not saved */ } }

  phase() {
    if (!this.on) return 'off';
    if (this.clock < T_COLLAPSE) return 'expand';
    if (this.clock < T_PULL) return 'collapse';
    if (this.clock < T_IMPACT) return 'pull';
    if (this.clock < T_END) return 'impact';
    return 'done';
  }

  /** Put everything back as it was (switched off or reset). */
  restore() {
    const sun = this.eph.sun;
    sun.radius = sun.maxRadius = this.base.radius;
    sun.axes.setScalar(this.base.radius);
    sun.collapsed = false;
    Object.assign(STAR, { luminosity: this.base.star.luminosity, color: [...this.base.star.color], disk: [...this.base.star.disk] });
    for (const b of this.eph.bodies) b.engulfed = false;
    if (this.acb) {
      const b = this.eph.byId.alphacenB;
      b.name = this.acb.name;
      b.def.name = this.acb.name;
      b.def.visual.magnitude = this.acb.magnitude;
      b.def.visual.pointColor = this.acb.color;
    }
  }

  /** Per frame, right after the ephemeris and before the ship moves. */
  update(dt) {
    const g = this.game;
    if (!this.on) return;
    if (g.state === 'play') {
      this.clock += dt;
      this.saveTimer += dt;
      if (this.saveTimer > 2) { this.saveTimer = 0; this.save(); }
    }
    if (this.sysId === 'sol') this.updateSol(dt);
    else this.updateProxima();
    this.announce();
  }

  updateSol(dt) {
    const eph = this.eph, sun = eph.sun, t = this.clock;
    let R = this.base.radius;
    if (t < T_COLLAPSE) R = this.base.radius * Math.pow(MAX_RADIUS / this.base.radius, t / EXPAND);
    else if (t < T_PULL) R = MAX_RADIUS * Math.pow(2e7 / MAX_RADIUS, smooth((t - T_COLLAPSE) / COLLAPSE));
    else R = 2e7;
    sun.radius = sun.maxRadius = R;
    sun.axes.setScalar(R);
    sun.collapsed = t >= T_PULL;
    // A red giant: redder and brighter as it swells; after the collapse, darkness.
    const k = Math.min(1, t / EXPAND);
    if (!sun.collapsed) {
      STAR.color = [1, 0.98 - 0.5 * k, 0.95 - 0.7 * k];
      STAR.disk = [1, 1 - 0.55 * k, 1 - 0.75 * k];
      STAR.luminosity = this.base.star.luminosity * (1 + 4 * k);
    } else {
      STAR.luminosity = 0.0004; // only the black hole's accretion glow
    }
    // Swallow every world the photosphere reaches (once swallowed, gone).
    for (const b of eph.bodies) {
      if (SURVIVORS.has(b.id)) continue;
      if (!b.engulfed && (t >= T_COLLAPSE || b.pos.distanceTo(sun.pos) - b.radius < R)) b.engulfed = true;
      if (b.engulfed) b.eaten = true;
    }
    // The black hole sits where the Sun was.
    const bh = eph.byId.blackhole;
    if (bh && sun.collapsed) { bh.pos.copy(sun.pos); bh.vel.set(0, 0, 0); }
    // The pull: Pluto and Charon spiral in and vanish.
    const pluto = eph.byId.pluto, charon = eph.byId.charon;
    if (t >= T_IMPACT && pluto && !pluto.engulfed) {
      // Already gone (e.g. after a reload).
      pluto.engulfed = true;
      if (charon) charon.engulfed = true;
    }
    if (t >= T_PULL && pluto && !pluto.engulfed) {
      if (!this.pullStart) this.pullStart = { pluto: pluto.pos.clone(), charonOff: charon ? charon.pos.clone().sub(pluto.pos) : null };
      const u = Math.min(1, (t - T_PULL) / PULL);
      const r0 = this.pullStart.pluto.clone().sub(sun.pos);
      const prev = pluto.pos.clone();
      const radial = r0.clone().multiplyScalar(1 - u * u);            // accelerating fall
      radial.applyAxisAngle(new THREE.Vector3(0, 1, 0), 5 * Math.PI * u * u); // and a tightening spiral
      pluto.pos.copy(sun.pos).add(radial);
      if (dt > 0) pluto.vel.copy(pluto.pos).sub(prev).divideScalar(dt);
      if (charon && this.pullStart.charonOff) { charon.pos.copy(pluto.pos).add(this.pullStart.charonOff.clone().multiplyScalar(1 - u)); charon.vel.copy(pluto.vel); }
      if (u >= 1 && !pluto.engulfed) {
        pluto.engulfed = pluto.eaten = true;
        if (charon) charon.engulfed = charon.eaten = true;
        // Riding Pluto in: you go through with it.
        const g = this.game;
        if (g.state === 'play' && g.playerWorld.distanceTo(prev) < pluto.radius * 4) g.enterVoid();
      }
    }
    if (pluto?.engulfed) { pluto.eaten = true; if (charon) charon.eaten = true; }
    this.checkDanger();
  }

  updateProxima() {
    const b = this.eph.byId.alphacenB;
    if (!b || this.clock < T_IMPACT) return;
    // Pluto arrives and strikes Alpha Centauri B: a flash, then a new star.
    const u = Math.min(1, (this.clock - T_IMPACT) / IMPACT);
    const flash = Math.exp(-u * 5);
    b.def.visual.magnitude = -9.5 - 6 * flash;
    b.def.visual.pointColor = u < 0.15 ? '#ffffff' : '#b9dcff';
    if (u >= 0.15 && b.name !== 'Nova Plutonis') {
      b.name = b.def.name = 'Nova Plutonis';
      b.def.stats = { type: 'Newborn merged star (Alpha Centauri B + Pluto)', temp: '≈ 9,000 °C, still settling' };
      b.def.facts = ['Pluto fell through the black hole that was once the Sun, crossed 4.24 light-years in an instant and struck Alpha Centauri B.', 'The impact stirred the star into a hotter, bluer, brighter new star: Nova Plutonis.'];
      b.def.survivability = { rating: 'Lethal', summary: 'A newborn star.', hazards: ['Star'] };
    }
  }

  checkDanger() {
    const g = this.game, sun = this.eph.sun;
    if (g.state !== 'play') return;
    const d = g.playerWorld.distanceTo(sun.pos);
    if (!sun.collapsed && d < sun.radius) { g.die('Engulfed', 'The swelling Sun swallowed you.'); return; }
    if (!sun.collapsed && this.clock < T_COLLAPSE) {
      // Warn while the photosphere races outward toward you.
      const t = this.clock, speed = Math.log(MAX_RADIUS / this.base.radius) / EXPAND;
      const tReach = Math.log(d / sun.radius) / speed;
      if (tReach < 45 && d < MAX_RADIUS) g.warnings.unshift({ level: 'danger', text: `The Sun reaches you in ${clockText(tReach)}: flee beyond Neptune!` });
    }
  }

  announce() {
    const p = this.phase();
    if (p === this.lastPhase) return;
    this.lastPhase = p;
    const hud = this.game.hud;
    if (this.sysId === 'sol') {
      if (p === 'expand') hud.toast('The Sun is dying', 'It is swelling into a red giant and will swallow everything out to Neptune in five minutes. Only Pluto is far enough out.', 'warn', 10);
      if (p === 'collapse') hud.toast('The Sun collapses', 'The red giant is falling in on itself…', 'warn', 6);
      if (p === 'pull') hud.toast('A black hole where the Sun was', 'It is dragging Pluto in. Land on Pluto to ride it through.', 'warn', 9);
      if (p === 'impact') hud.toast('Pluto is gone', 'It fell through the black hole, towards Alpha Centauri.', 'warn', 8);
    } else if (p === 'impact') {
      hud.toast('Pluto strikes Alpha Centauri B', 'Look for the flash in the sky: Pluto came through the black hole and hit the star.', 'warn', 10);
    } else if (p === 'done') {
      hud.toast('Nova Plutonis', 'Alpha Centauri B and Pluto have merged into a new, hotter, brighter star.', 'discovery', 10);
    }
    this.game.audio.play('growl');
  }

  /** Compass status line for the pause menu button. */
  statusText() {
    const p = this.phase(), t = this.clock;
    return { off: 'off', expand: `expanding · ${clockText(T_COLLAPSE - t)}`, collapse: 'collapsing', pull: `pulling Pluto · ${clockText(T_IMPACT - t)}`, impact: 'Pluto hits Alpha Centauri B', done: 'over' }[p];
  }
}
