// =============================================================================
// holeGuns.js — the black hole gun (N) and the white hole gun (U).
//
// * Black hole gun: opens a black hole beside a world (your target, or the
//   nearest one). The world and its moons spiral in and fall through to the
//   Alpha Centauri system, where they come out in parking orbits around
//   Proxima. Go through the big black hole to visit them there.
// * White hole gun: a white hole opens in front of the ship and spits out a
//   world from the hole (Y picks which). It flies at your target and crashes
//   into it; with no target it flies straight ahead and falls back into the
//   hole after a minute if it misses everything.
// * Crashes: the impact energy (½·μ·v², μ the reduced mass) is compared with
//   each world's gravitational binding energy (3GM²/5R). A world hit harder
//   than that is blown apart; one that holds together survives. Stars, the
//   black hole and the Devourer swallow whatever hits them.
//
// The hole's contents are saved in the browser (`solv-captured`) until Reset
// game. Both pages load each other's captured worlds, so a world taken from
// either system can be thrown in either.
// =============================================================================
import * as THREE from 'three';
import { AU, DAY, G_CONST, formatSpeed } from '../constants.js';
import { SYSTEMS } from '../data/systems.js';
import { NOISE } from '../render/glsl.js';

const STORE = 'solv-captured';
const SUCK = 4;            // s for a world to spiral into the black hole
const APPEAR = 2.5;        // s for a parked world to come out at Alpha Centauri
const EMERGE = 1.6;        // s for a world to come out of the white hole
const FLIGHT = 60;         // s a thrown world flies before falling back into the hole
const TRIP = 8;            // s a throw takes to reach its target (or longer, never slower than MIN_SPEED)
const MIN_SPEED = 300e3;   // m/s
const FREE_SPEED = 2000e3; // m/s with no target
const PULL = 2.5;          // radii: closer than this, you go into the hole with the world
const SPARE = new Set(['sun', 'blackhole', 'devourer']);

/** The hole's contents: [{ id, slot }] (slot = parking orbit at Proxima). */
function loadList() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) || '[]');
    return Array.isArray(v) ? v.filter((e) => e && typeof e.id === 'string') : [];
  } catch (e) { return []; }
}
function loadDestroyed() {
  try { return new Set(JSON.parse(localStorage.getItem('solv-destroyed') || '[]')); } catch (e) { return new Set(); }
}

const PROXIMA_GM = SYSTEMS.proxima.bodies.find((b) => b.id === 'sun').GM;

/** A parking orbit around Proxima, outside Proxima b's (0.049 AU). */
function parkEphem(slot) {
  const a = (0.07 + 0.016 * slot) * AU;
  const period = (2 * Math.PI * Math.sqrt((a * a * a) / PROXIMA_GM)) / DAY;
  return { type: 'kepler', a, period, i: ((slot * 37) % 9) - 4, e: 0 };
}

/**
 * Worlds from the other star system that are in the hole, to add to this
 * system's bodies: { defs, nav }. At Proxima they are parked in orbit; in the
 * solar system they stay hidden in the hole until thrown.
 */
export function capturedImports(sys) {
  const other = sys.id === 'sol' ? SYSTEMS.proxima : SYSTEMS.sol;
  const own = new Set(sys.bodies.map((d) => d.id));
  const destroyed = loadDestroyed();
  const list = loadList().filter((e) => !own.has(e.id) && !destroyed.has(e.id) && !SPARE.has(e.id));
  const ids = new Set(list.map((e) => e.id));
  const defs = [], nav = [];
  for (const e of list) {
    const d = other.bodies.find((x) => x.id === e.id);
    if (!d) continue;
    const parentHere = d.parent && (ids.has(d.parent) || (own.has(d.parent) && d.parent !== 'sun'));
    if (parentHere) { defs.push(d); continue; }
    if (sys.id === 'proxima') {
      defs.push({ ...d, parent: 'sun', ephem: parkEphem(e.slot | 0) });
      nav.push(d.id);
    } else {
      // Hidden in the hole: any harmless orbit will do until it is thrown.
      defs.push({ ...d, parent: 'sun', ephem: d.parent === 'sun' ? d.ephem : parkEphem(e.slot | 0) });
    }
  }
  return { defs, nav };
}

function depth(b) { let d = 0; for (let p = b.parent; p; p = p.parent) d++; return d; }
const smooth = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const mass = (b) => b.GM / G_CONST;
const binding = (b) => (0.6 * G_CONST * mass(b) ** 2) / b.radius;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

export class HoleGuns {
  constructor(game) {
    this.game = game;
    this.eph = game.eph;
    this.atProxima = game.sys.id === 'proxima';
    this.list = loadList();
    this.orig = new Map();   // id → the world's own definition (orbit), to restore
    this.suck = null;        // { root, members:[{b, from}], hole, t, scale }
    this.flights = [];       // thrown worlds
    this.appear = new Map(); // id → t (coming out into a parking orbit)
    this.pick = null;        // the world the white hole throws next
    for (const b of this.eph.bodies) this.orig.set(b.id, b.def);
    const destroyed = loadDestroyed();
    this.list = this.list.filter((e) => !destroyed.has(e.id));
    for (const e of this.list) {
      const b = this.eph.byId[e.id];
      if (!b) continue;
      b.captured = true;
      if (this.atProxima) this.park(b, e.slot);
      else b.inHole = true;
    }
    this.syncFlags();
    this.buildVisuals(game.engine.scene);
  }

  // ---- State helpers --------------------------------------------------------------------------
  save() { try { localStorage.setItem(STORE, JSON.stringify(this.list)); } catch (e) { /* not saved */ } }

  /** Swap a world's orbit definition (and parent) at run time. */
  setDef(b, def) {
    if (b.def === def) return;
    if ((b.def.parent || null) !== (def.parent || null)) {
      const old = b.parent;
      if (old) old.children.splice(old.children.indexOf(b), 1);
      b.parent = def.parent ? this.eph.byId[def.parent] : null;
      b.parent?.children.push(b);
      this.eph.order.sort((p, q) => depth(p) - depth(q));
    }
    b.def = def;
  }

  /** Put a world in its parking orbit at Proxima (moons whose planet is here stay with it). */
  park(b, slot) {
    const p = b.parent;
    if (p && p.id !== 'sun' && !p.eaten) return; // follows its planet
    this.setDef(b, { ...this.orig.get(b.id), parent: 'sun', ephem: parkEphem(slot) });
  }

  /** A world and its moons: the ones still here, or (held) the ones in the hole with it. */
  family(b, held = false) {
    const out = [b];
    for (const c of b.children) {
      const take = held ? !c.destroyed && !c.loose && (c.captured || !c.eaten) : !c.eaten && !c.loose;
      if (take) out.push(...this.family(c, held));
    }
    return out;
  }

  entry(id) { return this.list.find((e) => e.id === id); }

  nextSlot() {
    const used = new Set(this.list.map((e) => e.slot));
    let s = 0;
    while (used.has(s)) s++;
    return s;
  }

  /** Worlds that can come out of the white hole here. */
  available() {
    const flying = new Set(this.flights.flatMap((f) => f.members.map((m) => m.b.id)));
    return this.list
      .map((e) => this.eph.byId[e.id])
      .filter((b) => b && b.captured && !b.destroyed && !flying.has(b.id) && !(this.suck && this.suck.members.some((m) => m.b === b)))
      // Moons riding with their planet come out with it.
      .filter((b) => !(b.parent && b.parent.captured && b.parent.id !== 'sun' && this.entry(b.parent.id)));
  }

  heldCount() { return this.available().length; }

  /** The hole's flags drive everything else: in the hole = absent. */
  syncFlags() {
    for (const b of this.eph.bodies) {
      if (b.inHole) { b.eaten = true; b.eatScale = 0; }
    }
    for (const [id, t] of this.appear) {
      const b = this.eph.byId[id];
      if (b && !b.eaten) b.eatScale = smooth(t / APPEAR);
    }
  }

  // ---- Black hole gun ---------------------------------------------------------------------------
  fireBlack() {
    const g = this.game, hud = g.hud;
    const deny = (why) => { hud.toast('Black hole gun', why, 'warn', 3); g.audio.play('denied'); };
    if (this.suck) return deny(`Still swallowing ${this.suck.root.name}.`);
    if (g.onFoot) return deny('Board your ship first.');
    const ok = (c) => c && !c.eaten && !c.loose && !SPARE.has(c.id) && c.kind !== 'star' && c.kind !== 'distantstar' && c.kind !== 'blackhole' && c.kind !== 'devourer';
    let b = g.target;
    if (b && this.atProxima && b.captured) return deny(`${b.name} is already at Alpha Centauri. Throw it with the white hole gun (U).`);
    if (!ok(b)) {
      const P = g.playerWorld;
      b = null;
      let best = Infinity;
      for (const c of this.eph.bodies) {
        if (!ok(c) || (this.atProxima && c.captured)) continue;
        const d = c.pos.distanceTo(P) - c.radius;
        if (d < best) { best = d; b = c; }
      }
    }
    if (!b) return deny('Nothing to swallow.');
    const members = this.family(b).map((m) => ({ b: m, from: m.pos.clone(), def: m.def }));
    // The hole opens beside the world, on your side (or the far side if you are too close).
    const P = g.playerWorld;
    const toShip = _a.subVectors(P, b.pos);
    const d = toShip.length();
    toShip.normalize();
    const R = b.maxRadius;
    const hole = b.pos.clone().addScaledVector(toShip, d > R * 4 ? R * 2 : -R * 2);
    for (const m of members) {
      this.setDef(m.b, { ...m.def, ephem: { type: 'external' } });
      m.b.loose = true;
    }
    this.suck = { root: b, members, hole, t: 0, R, warned: false };
    hud.toast(`Black hole on ${b.name}`, `It falls through to Alpha Centauri in ${SUCK} seconds.${d < R * PULL ? ' You are close enough to go with it!' : ''}`, 'warn', 6);
    g.audio.play('pulse-start');
  }

  updateSuck(dt) {
    const s = this.suck;
    if (!s) return;
    const g = this.game;
    s.t += dt;
    const u = Math.min(1, s.t / SUCK);
    const e = u * u; // slow at first, then everything falls in
    for (const m of s.members) {
      _a.copy(m.b.pos);
      m.b.pos.lerpVectors(m.from, s.hole, e);
      m.b.vel.subVectors(m.b.pos, _a).divideScalar(Math.max(dt, 1e-3));
      m.b.eatScale = 1 - smooth((u - 0.15) / 0.85);
    }
    if (u < 1) return;
    // Through.
    const near = g.playerWorld.distanceTo(s.hole) < s.R * PULL;
    for (const m of s.members) {
      const b = m.b;
      this.setDef(b, m.def);
      b.loose = false;
      b.captured = true;
      if (!this.entry(b.id)) this.list.push({ id: b.id, slot: this.nextSlot() });
      if (this.atProxima) {
        this.park(b, this.entry(b.id).slot);
        this.appear.set(b.id, 0);
      } else {
        b.inHole = true;
      }
    }
    this.save();
    this.suck = null;
    const name = s.root.name;
    if (this.atProxima) g.hud.toast(`${name} came out at Proxima`, 'It is in a new orbit around the star. Throw it with the white hole gun (U).', 'discovery', 7);
    else g.hud.toast(`${name} is gone`, 'Sucked through to Alpha Centauri, where it now orbits Proxima. Throw it back with the white hole gun (U).', 'discovery', 8);
    g.audio.play('pulse-exit');
    if (near && g.state === 'play') {
      if (this.atProxima) g.die('Spaghettified', `You were pulled into the black hole with ${name}.`);
      else { g.hud.toast('Pulled through!', `You fell into the black hole with ${name}.`, 'warn', 4); g.enterVoid(); }
    }
  }

  // ---- White hole gun ---------------------------------------------------------------------------
  /** Y: choose which world comes out next. */
  cycle() {
    const g = this.game;
    const list = this.available();
    if (!list.length) { g.hud.toast('White hole gun', 'The hole is empty. Swallow a world with the black hole gun (N) first.', 'warn', 4); g.audio.play('denied'); return; }
    const i = list.findIndex((b) => b.id === this.pick);
    this.pick = list[(i + 1) % list.length].id;
    g.hud.toast('White hole gun', `Loaded: ${this.eph.byId[this.pick].name} (${list.length} in the hole).`, '', 3);
    g.audio.play('blip');
  }

  loaded() {
    const list = this.available();
    return list.find((b) => b.id === this.pick) || list[list.length - 1] || null;
  }

  fireWhite() {
    const g = this.game, hud = g.hud;
    const deny = (why) => { hud.toast('White hole gun', why, 'warn', 3); g.audio.play('denied'); };
    if (g.onFoot) return deny('Board your ship first.');
    const b = this.loaded();
    if (!b) return deny('The hole is empty. Swallow a world with the black hole gun (N) first.');
    if (this.pick === b.id) this.pick = null;
    const members = this.family(b, true);
    // Out of its parking orbit (at Proxima) or out of the hole.
    this.appear.delete(b.id);
    const fwd = g.ship.forward(new THREE.Vector3());
    const R = b.maxRadius;
    const hole = g.playerWorld.clone().addScaledVector(fwd, Math.max(R * 2.5, 2e5));
    const target = this.throwTarget(b, members, fwd);
    const rel = members.map((m) => ({ b: m, def: m.def, off: m.pos.clone().sub(b.pos) }));
    for (const m of rel) {
      m.b.inHole = false;
      m.b.captured = false;
      m.b.loose = true;
      m.b.eaten = false;
      m.b.eatScale = 0;
    }
    this.setDef(b, { ...b.def, ephem: { type: 'external' } });
    // Moons keep their orbits around it; move them with it this frame.
    const delta = _a.subVectors(hole, b.pos);
    b.pos.copy(hole);
    for (const m of rel) if (m.b !== b) m.b.pos.add(delta);
    b.vel.set(0, 0, 0);
    const dist = target ? target.pos.distanceTo(hole) : 0;
    const speed = target ? Math.max(MIN_SPEED, dist / TRIP) : FREE_SPEED;
    this.flights.push({ root: b, members: rel, hole: hole.clone(), dir: fwd.clone(), target, speed, t: 0 });
    hud.toast(`White hole: ${b.name}`, target ? `Thrown at ${target.name} at ${formatSpeed(speed)}. Impact in about ${Math.max(1, Math.round(EMERGE + dist / speed))} s.` : `Thrown straight ahead at ${formatSpeed(speed)}. Pick a target (T) to aim.`, 'warn', 6);
    g.audio.play('pulse-exit');
  }

  /** The target, if it can be hit; else the world closest to the crosshair (within 8°). */
  throwTarget(b, members, fwd) {
    const g = this.game;
    const valid = (c) => c && !c.eaten && !c.loose && !members.includes(c) && c.kind !== 'distantstar' && !c.inHole;
    if (valid(g.target)) return g.target;
    let best = null, bestAng = 8 * Math.PI / 180;
    for (const c of this.eph.bodies) {
      if (!valid(c)) continue;
      const ang = _b.subVectors(c.pos, g.playerWorld).normalize().angleTo(fwd);
      if (ang < bestAng) { bestAng = ang; best = c; }
    }
    return best;
  }

  updateFlights(dt) {
    const g = this.game;
    for (const f of [...this.flights]) {
      f.t += dt;
      const b = f.root;
      const k = smooth(f.t / EMERGE);
      for (const m of f.members) m.b.eatScale = k;
      if (f.t < EMERGE) { b.vel.set(0, 0, 0); continue; } // coming out of the white hole
      if (f.target && (f.target.eaten || f.target.loose)) f.target = null; // gone: fly on straight
      if (f.target) {
        const T = f.target;
        const lead = T.pos.distanceTo(b.pos) / f.speed;
        f.dir.copy(T.pos).addScaledVector(T.vel, lead).sub(b.pos).normalize();
      }
      const v = f.speed * smooth((f.t - EMERGE) / 0.8 + 0.15);
      const p0 = _c.copy(b.pos);
      b.vel.copy(f.dir).multiplyScalar(v);
      const step = _a.copy(b.vel).multiplyScalar(dt);
      b.pos.add(step);
      for (const m of f.members) if (m.b !== b) m.b.pos.add(step);
      if (this.checkHit(f, p0, step)) continue;
      if (f.t > FLIGHT + EMERGE) this.backIntoHole(f);
    }
  }

  /** Swept test of this frame's flight against every world, and you. */
  checkHit(f, p0, step) {
    const g = this.game;
    const b = f.root;
    const len2 = Math.max(step.lengthSq(), 1e-9);
    const closest = (c) => {
      const s = Math.min(1, Math.max(0, _b.subVectors(c, p0).dot(step) / len2));
      return { s, d: _b.copy(p0).addScaledVector(step, s).distanceTo(c) };
    };
    // You.
    if (g.state === 'play' && closest(g.playerWorld).d < b.maxRadius * 1.02) {
      g.die('Flattened', `${b.name} came out of the white hole and hit you.`);
      return false;
    }
    let hit = null, hitS = 2;
    for (const c of this.eph.bodies) {
      if (c.eaten || c.loose || c.inHole || c.kind === 'distantstar' || f.members.some((m) => m.b === c)) continue;
      const r = closest(c.pos);
      if (r.d < c.maxRadius + b.maxRadius * 0.9 && r.s < hitS) { hit = c; hitS = r.s; }
    }
    if (!hit) return false;
    b.pos.copy(p0).addScaledVector(step, hitS);
    this.impact(f, hit);
    return true;
  }

  impact(f, c) {
    const g = this.game, buster = g.buster;
    const b = f.root;
    const speed = _a.subVectors(b.vel, c.vel).length();
    const contact = _b.subVectors(b.pos, c.pos).normalize().multiplyScalar(c.radius).add(c.pos);
    const dropFlight = () => { this.flights.splice(this.flights.indexOf(f), 1); };
    const destroyRoot = () => {
      dropFlight();
      for (const m of f.members) { m.b.loose = false; this.setDef(m.b, m.def); }
      for (const m of [...f.members].reverse()) buster.explode(m.b, `You were too close when ${b.name} hit ${c.name}.`);
      this.list = this.list.filter((e) => !f.members.some((m) => m.b.id === e.id));
      this.save();
    };
    if (c.kind === 'star' || c.kind === 'blackhole' || c.kind === 'devourer') {
      destroyRoot();
      const how = c.kind === 'star' ? 'fell into' : c.kind === 'blackhole' ? 'vanished into' : 'was eaten by';
      g.hud.toast(`${b.name} ${how} ${c.name}`, `It hit at ${formatSpeed(speed)} and is gone.`, 'warn', 7);
      return;
    }
    // Who survives: impact energy against each world's binding energy.
    const m1 = mass(b), m2 = mass(c);
    const mu = (m1 * m2) / (m1 + m2);
    const E = 0.5 * mu * speed * speed;
    const rootGone = E > binding(b), otherGone = E > binding(c);
    if (otherGone) buster.explode(c, `You were too close when ${b.name} hit ${c.name}.`);
    else buster.blast(contact, Math.min(b.radius, c.radius) * 1.5);
    let text;
    if (rootGone && otherGone) text = `Both worlds are blown apart.`;
    else if (rootGone) text = `${b.name} is blown apart; ${c.name} survives with a giant scar.`;
    else if (otherGone) text = `${c.name} is blown apart; ${b.name} ploughs on through the debris.`;
    else text = 'Both worlds hold together.';
    g.hud.toast(`${b.name} hit ${c.name}!`, `${formatSpeed(speed)} impact. ${text}`, 'warn', 8);
    if (rootGone || !otherGone) {
      if (rootGone) destroyRoot();
      else { buster.blast(contact, b.radius); this.backIntoHole(f, true); }
    } else {
      f.target = null; // flies on
      g.audio.play('explosion');
    }
  }

  /** A miss: back into the hole (at Proxima: back into its parking orbit). */
  backIntoHole(f, quiet = false) {
    const g = this.game;
    this.flights.splice(this.flights.indexOf(f), 1);
    for (const m of f.members) {
      const b = m.b;
      this.setDef(b, m.def);
      b.loose = false;
      b.captured = true;
      if (!this.entry(b.id)) this.list.push({ id: b.id, slot: this.nextSlot() });
      if (this.atProxima) { this.park(b, this.entry(b.id).slot); this.appear.set(b.id, 0); } else b.inHole = true;
    }
    this.save();
    if (!quiet) g.hud.toast(`${f.root.name} missed`, 'It fell back into the hole. Pick a target (T) and throw it again.', '', 5);
  }

  // ---- Per frame --------------------------------------------------------------------------------
  /** After the ephemeris, before the ship flies. */
  update(dt) {
    const g = this.game;
    const playing = g.state === 'play';
    if (playing) {
      this.updateSuck(dt);
      this.updateFlights(dt);
      for (const [id, t] of this.appear) {
        if (t + dt < APPEAR) { this.appear.set(id, t + dt); continue; }
        this.appear.delete(id);
        const b = this.eph.byId[id];
        if (b) b.eatScale = 1;
      }
    }
    this.syncFlags();
  }

  /** Warnings (after the HUD's warning list is rebuilt). */
  updateDanger() {
    const g = this.game, s = this.suck;
    if (s && g.state === 'play' && g.playerWorld.distanceTo(s.hole) < s.R * PULL) {
      g.warnings.unshift({ level: 'danger', text: `${s.root.name} is falling into a black hole, and you with it!` });
    }
    for (const f of this.flights) {
      if (g.state !== 'play') break;
      const d = g.playerWorld.distanceTo(f.root.pos);
      if (f.t > EMERGE && d < f.root.radius * 6 && f.root.vel.dot(_a.subVectors(g.playerWorld, f.root.pos)) > 0) {
        g.warnings.unshift({ level: 'danger', text: `${f.root.name} is flying at you!` });
      }
    }
  }

  reset() {
    for (const f of this.flights) for (const m of f.members) { this.setDef(m.b, m.def); m.b.loose = false; }
    if (this.suck) for (const m of this.suck.members) { this.setDef(m.b, m.def); m.b.loose = false; }
    this.flights = [];
    this.suck = null;
    this.appear.clear();
    this.pick = null;
    const own = new Set(this.game.sys.bodies.map((d) => d.id));
    for (const b of this.eph.bodies) {
      if (!this.orig.has(b.id)) continue;
      if (this.orig.get(b.id) !== b.def) this.setDef(b, this.orig.get(b.id));
      b.loose = false;
      b.captured = false;
      b.eatScale = 1;
      // Worlds from the other system go home.
      b.inHole = !own.has(b.id) && b.kind !== 'devourer';
      if (b.inHole) b.eaten = true;
      else if (b.eaten && !b.destroyed && !b.engulfed) b.eaten = false;
    }
    this.list = [];
    this.save();
  }

  // ---- Looks --------------------------------------------------------------------------------------
  buildVisuals(scene) {
    // Black hole: a black ball, a glowing accretion disc, and a stream of matter spiralling in.
    this.bhCore = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    this.bhDisc = new THREE.Mesh(new THREE.RingGeometry(1.3, 4, 96, 1), discMaterial([1.0, 0.55, 0.15], [1.0, 0.92, 0.7]));
    this.whCore = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.MeshBasicMaterial({ color: 0xf2f6ff }));
    this.whDisc = new THREE.Mesh(new THREE.RingGeometry(1.2, 4.5, 96, 1), discMaterial([0.55, 0.75, 1.0], [1.0, 1.0, 1.0]));
    this.bhGlow = makeGlow(0xff9a40);
    this.whGlow = makeGlow(0xd8e6ff);
    for (const m of [this.bhCore, this.bhDisc, this.whCore, this.whDisc, this.bhGlow, this.whGlow]) {
      m.frustumCulled = false;
      m.visible = false;
      scene.add(m);
    }
    this.bhCore.renderOrder = 3;
    const n = 2000;
    this.streamSeeds = Array.from({ length: n }, () => ({ s: Math.random(), a: Math.random() * Math.PI * 2, r: Math.sqrt(Math.random()), z: Math.random() * 2 - 1 }));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.stream = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffb070, size: 2.5, sizeAttenuation: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.stream.frustumCulled = false;
    this.stream.visible = false;
    scene.add(this.stream);
    this.whites = []; // white hole flashes still fading
  }

  render(origin, time, dt) {
    const s = this.suck;
    // Black hole.
    const bhOn = !!s;
    for (const m of [this.bhCore, this.bhDisc, this.bhGlow, this.stream]) m.visible = bhOn;
    if (s) {
      const u = Math.min(1, s.t / SUCK);
      const size = s.R * 0.35 * smooth(u / 0.15) * (1 - smooth((u - 0.92) / 0.08));
      const c = _a.subVectors(s.hole, origin);
      this.placeHole(this.bhCore, this.bhDisc, this.bhGlow, c, size, time, 1);
      // Matter from the world spiralling into the hole.
      const b = s.root;
      const from = _b.subVectors(b.pos, origin);
      const scale = b.maxRadius * Math.max(0.05, b.eatScale ?? 1);
      const axis = _c.subVectors(c, from);
      const len = axis.length();
      axis.divideScalar(len || 1);
      const side = new THREE.Vector3(0, 1, 0).cross(axis);
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
      side.normalize();
      const up = new THREE.Vector3().crossVectors(axis, side);
      const pos = this.stream.geometry.attributes.position;
      for (let i = 0; i < this.streamSeeds.length; i++) {
        const q = this.streamSeeds[i];
        const k = (q.s + time * 0.45) % 1;                     // 0 at the world, 1 at the hole
        const radial = scale * q.r * (1 - k) + size * 3 * Math.sin(k * Math.PI) * (1 - k);
        const ang = q.a + k * 9;                               // spiral
        const x = from.x + axis.x * len * k + (side.x * Math.cos(ang) + up.x * Math.sin(ang)) * radial;
        const y = from.y + axis.y * len * k + (side.y * Math.cos(ang) + up.y * Math.sin(ang)) * radial;
        const z = from.z + axis.z * len * k + (side.z * Math.cos(ang) + up.z * Math.sin(ang)) * radial;
        pos.setXYZ(i, x, y, z);
      }
      pos.needsUpdate = true;
      this.stream.material.opacity = 0.9 * smooth(u / 0.1) * (1 - smooth((u - 0.85) / 0.15));
    }
    // White holes: open while a world comes out, then close.
    const open = this.flights.filter((f) => f.t < EMERGE + 1.2);
    const f = open[open.length - 1];
    for (const m of [this.whCore, this.whDisc, this.whGlow]) m.visible = !!f;
    if (f) {
      const k = f.t / (EMERGE + 1.2);
      const size = f.root.maxRadius * 0.45 * smooth(k / 0.2) * (1 - smooth((k - 0.6) / 0.4));
      this.placeHole(this.whCore, this.whDisc, this.whGlow, _a.subVectors(f.hole, origin), size, time, -1);
    }
  }

  placeHole(core, disc, glow, c, size, time, spin) {
    const visible = size > 1;
    core.visible = disc.visible = glow.visible = visible;
    if (!visible) return;
    core.position.copy(c);
    core.scale.setScalar(size);
    disc.position.copy(c);
    disc.scale.setScalar(size);
    // Tilt the disc towards the camera a little so it reads as a disc, not a line.
    const toCam = _c.copy(c).negate().normalize();
    disc.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), toCam);
    disc.rotateX(1.05);
    disc.material.uniforms.uTime.value = time * spin;
    glow.position.copy(c);
    glow.scale.setScalar(size * 9);
  }
}

function discMaterial(inner, outer) {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec2 vP;
      void main() {
        vP = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      ${NOISE}
      uniform float uTime;
      uniform vec3 uInner;
      uniform vec3 uOuter;
      varying vec2 vP;
      void main() {
        #include <logdepthbuf_fragment>
        float r = length(vP);
        float a = atan(vP.y, vP.x);
        float swirl = fbm(vec3(cos(a - uTime * 1.5 + r * 1.7) * r, sin(a - uTime * 1.5 + r * 1.7) * r, uTime * 0.2), 4);
        float fall = smoothstep(4.0, 1.4, r) * smoothstep(1.2, 1.5, r);
        vec3 col = mix(uOuter, uInner, smoothstep(1.4, 3.5, r)) * (0.6 + 1.2 * swirl);
        gl_FragColor = vec4(col * 2.2, fall * (0.55 + 0.45 * swirl));
      }`,
    uniforms: { uTime: { value: 0 }, uInner: { value: new THREE.Color(...inner) }, uOuter: { value: new THREE.Color(...outer) } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  });
}

function makeGlow(color) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  const grd = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.2, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(cv);
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
}

