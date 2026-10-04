// =============================================================================
// planetBuster.js — the ship's world-killer beam (B).
//
// The beam locks onto a world's core (your target, or the nearest world) and
// melts it into magma in a few seconds; ten seconds later the world explodes
// in a flash and a spray of debris, and is gone: no gravity, no surface,
// crossed out in the compass. Anyone within three radii when it blows dies.
// Destroyed worlds stay destroyed (saved in the browser) until Reset game.
// =============================================================================
import * as THREE from 'three';
import { NOISE } from '../render/glsl.js';

const STORE = 'solv-destroyed';
const MELT = 4;          // s of beam until the world is molten
const FUSE = 10;         // s from molten to the explosion
const BLAST = 8;         // s the explosion lasts on screen
const SPARE = new Set(['sun', 'blackhole', 'devourer']);

const MAGMA_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vLocal;
void main() {
  vLocal = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;
const MAGMA_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${NOISE}
uniform float uMelt;
uniform float uTime;
uniform float uPulse;
varying vec3 vLocal;
void main() {
  #include <logdepthbuf_fragment>
  vec3 p = vLocal * 5.0;
  float f = fbm(p + vec3(0.0, uTime * 0.15, 0.0), 5);
  float cracks = 1.0 - smoothstep(0.0, 0.08, abs(f - 0.5));
  float lava = smoothstep(0.35, 0.75, fbm(p * 2.3 - vec3(uTime * 0.1), 4));
  vec3 crust = vec3(0.12, 0.03, 0.01);
  vec3 glow = mix(vec3(1.0, 0.25, 0.02), vec3(1.0, 0.85, 0.35), lava);
  float heat = clamp(uMelt * 1.4 - 0.2, 0.0, 1.0);
  vec3 col = mix(crust, glow * (2.0 + 2.5 * uPulse), clamp(cracks + lava * heat + heat * 0.35, 0.0, 1.0));
  gl_FragColor = vec4(col, smoothstep(0.0, 0.25, uMelt));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class PlanetBuster {
  constructor(game) {
    this.game = game;
    this.eph = game.eph;
    this.job = null;          // { body, t } — the world being destroyed
    this.blasts = [];         // explosions on screen
    this.destroyed = new Set();
    try { for (const id of JSON.parse(localStorage.getItem(STORE) || '[]')) this.destroyed.add(id); } catch (e) { /* none */ }
    for (const id of this.destroyed) if (this.eph.byId[id]) this.eph.byId[id].destroyed = true;
    const scene = game.engine.scene;

    // Beam: a tapered glow from the ship's nose to the world's core, with a white-hot core.
    this.beamOuter = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xff6a1a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.beamInner = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff1d0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    for (const m of [this.beamOuter, this.beamInner]) { m.frustumCulled = false; m.visible = false; m.renderOrder = 9; scene.add(m); }

    // Magma shell over the world.
    this.magmaMat = new THREE.ShaderMaterial({
      vertexShader: MAGMA_VERT, fragmentShader: MAGMA_FRAG, transparent: true, depthWrite: false,
      uniforms: { uMelt: { value: 0 }, uTime: { value: 0 }, uPulse: { value: 0 } },
    });
    this.magma = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), this.magmaMat);
    this.magma.visible = false;
    this.magma.renderOrder = 2;
    scene.add(this.magma);
  }

  /** B: fire at the target (or the nearest world). */
  fire() {
    const g = this.game, hud = g.hud;
    const deny = (why) => { hud.toast('Beam', why, 'warn', 3); g.audio.play('denied'); };
    if (this.job) return deny(`Already destroying ${this.job.body.name}.`);
    if (g.onFoot) return deny('Board your ship first.');
    let b = g.target;
    if (!b || b.eaten || SPARE.has(b.id) || b.kind === 'star' || b.kind === 'distantstar') {
      // The nearest world instead.
      const P = g.playerWorld;
      b = null;
      let best = Infinity;
      for (const c of this.eph.bodies) {
        if (c.eaten || SPARE.has(c.id) || c.kind === 'star' || c.kind === 'distantstar' || c.kind === 'blackhole') continue;
        const d = c.pos.distanceTo(P) - c.radius;
        if (d < best) { best = d; b = c; }
      }
    }
    if (!b) return deny('Nothing to aim at.');
    this.job = { body: b, t: 0 };
    hud.toast(`Beam locked on ${b.name}`, `Its core melts in ${MELT} seconds, then it explodes ${FUSE} seconds later. Keep clear!`, 'warn', 6);
    g.audio.play('laser');
  }

  reset() {
    this.job = null;
    for (const id of this.destroyed) if (this.eph.byId[id]) this.eph.byId[id].destroyed = false;
    this.destroyed.clear();
    this.save();
  }

  save() { try { localStorage.setItem(STORE, JSON.stringify([...this.destroyed])); } catch (e) { /* not saved */ } }

  /** Per frame, after the other world-removing events (keeps destroyed worlds gone). */
  update(dt) {
    const g = this.game;
    for (const id of this.destroyed) { const b = this.eph.byId[id]; if (b) { b.destroyed = true; b.eaten = true; } }
    const job = this.job;
    if (!job || g.state !== 'play') return;
    job.t += dt;
    const b = job.body;
    if (b.eaten) { this.job = null; return; } // eaten by something else first
    const near = g.playerWorld.distanceTo(b.pos) < b.radius * 3;
    if (job.t >= MELT + FUSE) {
      // Boom.
      this.job = null;
      g.hud.toast(`${b.name} is destroyed`, 'Nothing is left but a cloud of glowing debris.', 'warn', 7);
      this.explode(b);
      return;
    }
    if (job.t >= MELT && near) g.warnings.unshift({ level: 'danger', text: `${b.name} explodes in ${Math.ceil(MELT + FUSE - job.t)} s: get clear!` });
  }

  /**
   * Blow a world apart now: gone for good (until Reset game), with a flash and
   * debris. Kills the player within three radii. Also used by planet crashes.
   */
  explode(b, cause = `You were too close when ${b.name} exploded.`) {
    const g = this.game;
    const near = g.playerWorld.distanceTo(b.pos) < b.radius * 3;
    this.destroyed.add(b.id);
    this.save();
    b.destroyed = b.eaten = true;
    this.blast(b.pos, b.radius);
    g.audio.play('explosion');
    if (near && g.state === 'play') g.die('Blown apart', cause);
  }

  /** A flash and a debris cloud at a world point. */
  blast(pos, radius) {
    this.blasts.push({ pos: pos.clone(), radius, t: 0, mesh: makeBlast(this.game.engine.scene) });
  }

  render(origin, time, dt) {
    const g = this.game, job = this.job;
    // Beam and magma.
    const beamOn = !!job && job.t < MELT + 1 && !g.onFoot;
    this.beamOuter.visible = this.beamInner.visible = beamOn;
    this.magma.visible = !!job;
    if (job) {
      const b = job.body;
      const center = b.pos.clone().sub(origin);
      if (beamOn) {
        const start = g.ship.worldPos(new THREE.Vector3()).sub(origin).addScaledVector(g.ship.forward(new THREE.Vector3()), 6);
        const dir = center.clone().sub(start);
        const len = dir.length();
        dir.divideScalar(len);
        const flick = 0.85 + 0.15 * Math.sin(time * 40);
        for (const [m, k] of [[this.beamOuter, 1], [this.beamInner, 0.35]]) {
          m.position.copy(start).addScaledVector(dir, len / 2);
          m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
          // Wide enough to see from the ship and from afar (a fraction of the distance).
          const r = Math.max(4, len * 0.0012) * k * flick;
          m.scale.set(r, len, r);
        }
      }
      const melt = Math.min(1, job.t / MELT);
      const u = this.magmaMat.uniforms;
      u.uMelt.value = melt;
      u.uTime.value = time;
      u.uPulse.value = job.t > MELT ? 0.5 + 0.5 * Math.sin(time * (4 + 10 * (job.t - MELT) / FUSE)) : 0;
      this.magma.position.copy(center);
      this.magma.quaternion.copy(b.quat);
      this.magma.scale.setScalar(b.maxRadius * 1.004 * (1 + 0.03 * u.uPulse.value * (job.t - MELT) / FUSE));
    }
    // Explosions: a flash that swells and fades, and debris flying outward.
    this.blasts = this.blasts.filter((x) => {
      x.t += dt;
      const k = x.t / BLAST;
      if (k >= 1) { x.mesh.flash.removeFromParent(); x.mesh.debris.removeFromParent(); return false; }
      const c = x.pos.clone().sub(origin);
      x.mesh.flash.position.copy(c);
      x.mesh.flash.scale.setScalar(x.radius * (1 + 5 * Math.sqrt(k)));
      x.mesh.flash.material.opacity = Math.max(0, 1 - k * 1.6);
      x.mesh.debris.position.copy(c);
      x.mesh.debris.scale.setScalar(x.radius * (0.6 + 8 * k));
      x.mesh.debris.material.opacity = 1 - k;
      return true;
    });
  }
}

function makeBlast(scene) {
  const flash = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  flash.frustumCulled = false;
  const n = 3000, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(0.3 + Math.random() * 0.7);
    pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const debris = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xff8a3a, size: 3, sizeAttenuation: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  debris.frustumCulled = false;
  scene.add(flash, debris);
  return { flash, debris };
}
