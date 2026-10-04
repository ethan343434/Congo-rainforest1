// =============================================================================
// world.js — owns everything drawn in space: Milky Way, Sun, every planet and
// moon, the dots for distant bodies, and the local sunlight that lights the
// ship, astronaut and terrain. Updated once per frame relative to the camera.
// =============================================================================
import * as THREE from 'three';
import { STAR } from '../constants.js';
import { Sky } from './sky.js';
import { SunVisual } from './sun.js';
import { BodyVisual, BodyPoints, sunIntensityAt } from './bodyVisuals.js';
import { BlackHoleVisual } from './blackHole.js';
import { generateProceduralTexture } from './procTextures.js';

export class WorldRenderer {
  constructor(engine, eph, assets) {
    this.engine = engine;
    this.eph = eph;
    this.assets = assets;
    const scene = engine.scene;

    this.sky = new Sky();
    scene.add(this.sky.mesh);
    this.sun = new SunVisual(eph.sun);
    scene.add(this.sun.group);

    this.visuals = new Map();
    for (const b of eph.bodies) {
      if (b.id === 'sun' || b.kind === 'distantstar') continue;
      const v = b.kind === 'blackhole' ? new BlackHoleVisual(b) : new BodyVisual(b);
      this.visuals.set(b.id, v);
      scene.add(v.group);
    }
    // Eclipse casters: moons darken their planet; a planet darkens its moons.
    for (const b of eph.bodies) {
      const v = this.visuals.get(b.id);
      if (!v) continue;
      if (b.kind === 'moon') v.setOccluders([b.parent]);
      else v.setOccluders([...b.children].sort((p, q) => q.radius - p.radius).slice(0, 4));
    }

    this.points = new BodyPoints(eph.bodies);
    scene.add(this.points.points);

    // Local sunlight for nearby objects (ship, astronaut, terrain, rocks).
    this.sunLight = new THREE.DirectionalLight(0xffffff, 3);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    const sc = this.sunLight.shadow.camera;
    sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 1; sc.far = 800;
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.05;
    scene.add(this.sunLight);
    scene.add(this.sunLight.target);
    this.skyLight = new THREE.HemisphereLight(0x8899aa, 0x222018, 0.0);
    scene.add(this.skyLight);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.02);
    scene.add(this.ambient);

    this.exposure = 1;
    this.time = 0;
  }

  /** Load real textures and generate procedural ones. progress(fraction, label). */
  async load(progress) {
    const jobs = [];
    const add = (p) => jobs.push(p);
    const A = this.assets;
    add(A.texture('milky_way.jpg').then((t) => this.sky.setTexture(t)));
    for (const [id, v] of this.visuals) {
      const vis = v.body.def.visual || {};
      if (vis.map && !vis.proc) add(A.texture(vis.map).then((t) => v.setTexture('day', t)));
      if (vis.night) add(A.texture(vis.night).then((t) => v.setTexture('night', t)));
      if (vis.water) add(A.texture(vis.water, { srgb: false }).then((t) => v.setTexture('water', t)));
      if (vis.height) add(A.texture(vis.height, { srgb: false }).then((t) => v.setTexture('height', t)));
      if (vis.clouds) add(A.texture(vis.clouds, { srgb: false }).then((t) => v.setTexture('clouds', t)));
      const rings = v.body.def.rings;
      if (rings?.texture) add(A.texture(rings.texture, { wrap: false }).then((t) => v.setTexture('rings', t)));
    }
    let done = 0;
    const total = jobs.length;
    const tick = () => progress?.(0.6 * (++done / total), 'Loading planet maps');
    jobs.forEach((p) => p.then(tick, tick));
    await Promise.allSettled(jobs);
    // Procedural maps for worlds without a real image map, one at a time so
    // the loading screen keeps updating.
    const procs = [];
    for (const v of this.visuals.values()) {
      const vis = v.body.def.visual || {};
      if (vis.proc) procs.push([v, vis.proc, vis.procSize || (v.body.radius > 1e6 ? 2048 : 1024)]);
    }
    if (this.visuals.has('titan')) procs.push([null, 'titanSurface', 2048]);
    for (let i = 0; i < procs.length; i++) {
      const [v, style, size] = procs[i];
      progress?.(0.6 + 0.3 * (i / procs.length), `Building moon surfaces (${i + 1}/${procs.length})`);
      await new Promise((r) => setTimeout(r, 0));
      try {
        const tex = await generateProceduralTexture(this.engine.renderer, style, size);
        if (v) v.setTexture('day', tex);
        else this.titanSurface = tex;
      } catch (e) { console.error(e); }
    }
  }

  /**
   * Fraction (0..1) of the Sun's disc visible from a world position.
   * exclude: a body to ignore (the one whose terrain we are lighting).
   */
  sunVisibility(origin, exclude) {
    const sun = this.eph.sun;
    const toSun = sun.pos.clone().sub(origin);
    const dSun = toSun.length();
    toSun.divideScalar(dSun);
    const aSun = sun.radius / dSun;
    let vis = 1;
    for (const b of this.eph.bodies) {
      if (b === sun || b === exclude || b.eaten) continue;
      const to = b.pos.clone().sub(origin);
      const d = to.length();
      if (d > dSun) continue;
      const aB = Math.asin(Math.min(1, b.maxRadius / d));
      if (aB < aSun * 0.02) continue;
      const sep = Math.acos(Math.min(1, Math.max(-1, to.dot(toSun) / d)));
      if (sep > aSun + aB) continue;
      const cover = Math.min(1, (aSun + aB - sep) / (2 * Math.min(aSun, aB)));
      vis *= 1 - cover * Math.min(1, (aB * aB) / (aSun * aSun));
    }
    return Math.max(0, vis);
  }

  /**
   * ctx: { origin, time, dt, quality, localBody (BodyState near the camera),
   *        lightTarget (camera-relative point for shadow focus), inAtmo }
   */
  update(ctx) {
    const eng = this.engine;
    const sun = this.eph.sun;
    this.time = ctx.time;
    const pixelScale = eng.pixelScale;
    const vctx = { origin: ctx.origin, sun, time: ctx.time, dt: ctx.dt, pixelScale, quality: ctx.quality };
    for (const v of this.visuals.values()) v.update(vctx);
    const sunRel = sun.pos.clone().sub(ctx.origin);
    const sunVisAll = this.sunVisibility(ctx.origin);
    // The global sunlight ignores the body under you (its own day/night comes
    // from surface normals); nearby objects get LOCAL_SUN on top of this.
    const sunVis = ctx.sunExclude ? this.sunVisibility(ctx.origin, ctx.sunExclude) : sunVisAll;
    this.sunVis = sunVisAll;
    this.sun.update(ctx.time, sunRel, sunVisAll * (ctx.sunGlare ?? 1) * ctx.quality.glow, this.exposure);
    this.points.update(ctx.origin, sun, this.visuals, 1);

    // Local sunlight direction & strength at the camera.
    const dSun = sunRel.length();
    const dir = sunRel.clone().divideScalar(dSun);
    const intensity = sunIntensityAt(dSun);
    const focus = ctx.lightTarget || new THREE.Vector3();
    this.sunLight.position.copy(focus).addScaledVector(dir, 400);
    this.sunLight.target.position.copy(focus);
    this.sunLight.intensity = 3.2 * intensity * sunVis * (ctx.sunTransmission ?? 1);
    const sc = STAR.color;
    if (ctx.sunTint) this.sunLight.color.setRGB(ctx.sunTint[0] * sc[0], ctx.sunTint[1] * sc[1], ctx.sunTint[2] * sc[2]);
    else this.sunLight.color.setRGB(sc[0], sc[1], sc[2]);
    this.sunLight.castShadow = ctx.quality.shadows && !!ctx.wantShadows;
    if (this.sunLight.shadow.mapSize.x !== ctx.quality.shadowMap) {
      this.sunLight.shadow.mapSize.set(ctx.quality.shadowMap, ctx.quality.shadowMap);
      this.sunLight.shadow.map?.dispose();
      this.sunLight.shadow.map = null;
    }
    this.skyLight.intensity = ctx.skyLight ?? 0;
    if (ctx.skyColor) this.skyLight.color.setRGB(...ctx.skyColor);
    if (ctx.groundColor) this.skyLight.groundColor.setRGB(...ctx.groundColor);

    // Auto exposure: brighten the dim outer system a little, like an eye adapting,
    // and stop down when the Sun's disc fills a big part of the view.
    const sunAngle = Math.asin(Math.min(1, sun.radius / dSun));
    const glareStop = 1 / (1 + Math.max(0, sunAngle - 0.05) * 6 * sunVis);
    const boost = ctx.exposureBoost ?? 1;
    const target = ctx.exposureTarget ?? Math.min(2.4 * boost, Math.max(0.35, (boost / Math.pow(intensity, 0.55)) * glareStop));
    this.exposure += (target - this.exposure) * Math.min(1, ctx.dt * 1.5);
    eng.renderer.toneMappingExposure = this.exposure;
    // Near the Sun its glare drowns out the stars (as in SOHO/Parker images).
    const glareFade = 1 / (1 + ((sunAngle * sunVisAll) / 0.03) ** 2);
    this.sky.update((ctx.skyFade ?? 1) * glareFade);
  }
}
