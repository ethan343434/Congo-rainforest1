// =============================================================================
// bodyVisuals.js — the visible parts of every planet and moon: surface
// sphere/ellipsoid, atmosphere shell, Earth's clouds and defence barrier,
// rings, and the star-like point a body becomes when it is too far away to
// show a disc. Everything is placed relative to the camera each frame
// (floating origin), so distances of billions of km stay precise.
// =============================================================================
import * as THREE from 'three';
import { createPlanetMaterial, BLACK_TEX } from './planetMaterial.js';
import { createAtmosphereMaterial, updateAtmosphereUniforms } from './atmosphere.js';
import { createRings } from './rings.js';
import { EQUIRECT } from './glsl.js';
import { AU, STAR } from '../constants.js';

const SPHERE_HI = new THREE.SphereGeometry(1, 256, 128);
const SPHERE_MID = new THREE.SphereGeometry(1, 128, 64);
const SPHERE_LO = new THREE.SphereGeometry(1, 64, 32);

/** Brightness of sunlight at a distance, compressed so the outer planets aren't black. */
export function sunIntensityAt(distance) {
  return Math.min(2.2, Math.pow((AU * Math.sqrt(STAR.luminosity)) / distance, 0.55));
}

// ---- Earth's clouds -------------------------------------------------------------------
const CLOUD_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${EQUIRECT}
uniform sampler2D uClouds;
uniform float uCloudRot;
uniform mat3 uRot;
uniform vec3 uSunDir;
uniform float uSunIntensity;
varying vec3 vLocal;
varying vec3 vWorldPos;
void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vLocal);
  float a = cos(uCloudRot), b = sin(uCloudRot);
  vec3 rc = vec3(a * n.x - b * n.z, n.y, b * n.x + a * n.z);
  float c = sampleEquirect(uClouds, rc).r;
  vec3 N = normalize(uRot * n);
  float mu0 = dot(N, uSunDir);
  float light = smoothstep(-0.12, 0.25, mu0);
  // Sunset tint along the terminator.
  vec3 tint = mix(vec3(1.0, 0.55, 0.3), vec3(1.0), smoothstep(0.0, 0.3, mu0));
  vec3 col = vec3(0.95) * tint * light * uSunIntensity + vec3(0.004);
  gl_FragColor = vec4(col, c * 0.92);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
const SIMPLE_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vLocal;
varying vec3 vWorldPos;
void main() {
  vLocal = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}
`;

// ---- Earth's defence barrier (hexagonal energy shield) ---------------------------------------
const BARRIER_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uTime;
uniform float uStrength;
uniform vec3 uHitDir;
uniform float uHit;
uniform vec3 uCenter;
varying vec3 vLocal;
varying vec3 vWorldPos;
float hexDist(vec2 p) {
  p = abs(p);
  return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x);
}
void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vLocal);
  float lon = atan(-n.z, n.x), lat = asin(n.y);
  vec2 p = vec2(lon * 60.0 * cos(lat), lat * 60.0);
  vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(p, r) - h, b = mod(p - h, r) - h;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  float edge = smoothstep(0.42, 0.5, hexDist(g));
  vec3 V = normalize(-vWorldPos);
  float fres = pow(1.0 - abs(dot(normalize(vWorldPos - uCenter), -V)), 2.0);
  float pulse = 0.6 + 0.4 * sin(uTime * 2.0 + lat * 20.0);
  float hit = uHit * smoothstep(0.35, 0.0, acos(clamp(dot(n, uHitDir), -1.0, 1.0)));
  float alpha = (edge * 0.35 * pulse + fres * 0.25) * uStrength + hit * (0.4 + edge);
  vec3 col = mix(vec3(0.25, 0.75, 1.0), vec3(1.0, 0.6, 0.2), clamp(hit, 0.0, 1.0)) * 2.0;
  gl_FragColor = vec4(col * alpha, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class BodyVisual {
  constructor(body) {
    this.body = body;
    const def = body.def;
    this.group = new THREE.Group();
    this.group.name = body.id;
    const big = body.radius > 1.5e6;
    const atm = body.atmosphere;
    const airless = !atm || atm.thin;
    this.material = createPlanetMaterial({
      airless,
      wrap: atm && !atm.thin ? 0.12 : 0,
      limbDark: atm && atm.gasGiant ? 0.55 : 0,
      bump: def.visual?.bump || 0,
    });
    this.surface = new THREE.Mesh(big ? SPHERE_HI : body.radius > 3e5 ? SPHERE_MID : SPHERE_LO, this.material);
    this.surface.scale.copy(body.axes);
    this.group.add(this.surface);

    if (atm && !atm.thin) {
      this.atmoMat = createAtmosphereMaterial(body);
      this.atmo = new THREE.Mesh(SPHERE_MID, this.atmoMat);
      this.atmo.scale.set(body.axes.x + atm.top, body.axes.y + atm.top, body.axes.z + atm.top);
      this.atmo.renderOrder = 3;
      this.group.add(this.atmo);
    }

    if (def.visual?.clouds) {
      this.cloudMat = new THREE.ShaderMaterial({
        vertexShader: SIMPLE_VERT,
        fragmentShader: CLOUD_FRAG,
        transparent: true,
        depthWrite: false,
        uniforms: {
          uClouds: { value: BLACK_TEX },
          uCloudRot: { value: 0 },
          uRot: { value: new THREE.Matrix3() },
          uSunDir: { value: new THREE.Vector3() },
          uSunIntensity: { value: 1 },
        },
      });
      this.clouds = new THREE.Mesh(SPHERE_HI, this.cloudMat);
      this.clouds.scale.setScalar(body.radius + 9000);
      this.clouds.renderOrder = 1;
      this.group.add(this.clouds);
    }

    if (def.barrier) {
      this.barrierMat = new THREE.ShaderMaterial({
        vertexShader: SIMPLE_VERT,
        fragmentShader: BARRIER_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { uTime: { value: 0 }, uStrength: { value: 0 }, uHitDir: { value: new THREE.Vector3(1, 0, 0) }, uHit: { value: 0 }, uCenter: { value: new THREE.Vector3() } },
      });
      this.barrier = new THREE.Mesh(SPHERE_MID, this.barrierMat);
      this.barrier.scale.setScalar(body.radius + def.barrier.altitude);
      this.barrier.renderOrder = 4;
      this.barrierHit = 0;
      this.group.add(this.barrier);
    }

    if (def.rings) {
      this.rings = createRings(body, null);
      this.group.add(this.rings);
    }

    this.occluders = [];
    this.cloudRot = 0;
    this.terrainActive = false;
  }

  /** Wire up loaded textures (any of them may arrive later). */
  setTexture(slot, tex) {
    const u = this.material.uniforms;
    switch (slot) {
      case 'day': u.uDay.value = tex; break;
      case 'night': u.uNight.value = tex; u.uFlags.value.x = 1; break;
      case 'water': u.uWater.value = tex; u.uFlags.value.y = 1; break;
      case 'height':
        u.uHeight.value = tex; u.uFlags.value.z = 1;
        if (tex.image) u.uHeightTexel.value.set(1 / tex.image.width, 1 / tex.image.height);
        break;
      case 'clouds':
        u.uClouds.value = tex; u.uFlags.value.w = 1;
        if (this.cloudMat) this.cloudMat.uniforms.uClouds.value = tex;
        break;
      case 'rings':
        if (this.rings) this.rings.material.uniforms.uTex.value = tex;
        u.uRingTex.value = tex;
        break;
      default: break;
    }
  }

  /** Choose which bodies can throw shadows on this one (eclipses). */
  setOccluders(list) {
    this.occluders = list.slice(0, 4);
  }

  /**
   * Per-frame update. ctx: { origin (world camera pos), sun (BodyState),
   * time, pixelScale (pixels per radian), quality, exposure }.
   * Returns the body's apparent radius in pixels.
   */
  update(ctx) {
    const b = this.body;
    const rel = this._rel || (this._rel = new THREE.Vector3());
    rel.subVectors(b.pos, ctx.origin);
    const dist = rel.length();
    this.group.position.copy(rel);
    this.group.quaternion.copy(b.quat);
    const apparentPx = (b.maxRadius / Math.max(dist, 1)) * ctx.pixelScale;
    const ringPx = this.rings ? (b.def.rings.outer / dist) * ctx.pixelScale : 0;
    this.apparentPx = apparentPx;
    const eat = b.eaten ? 0 : b.eatScale ?? 1; // being eaten by the Devourer: shrinks away
    const visible = eat > 0.002 && (apparentPx * eat > 0.35 || ringPx * eat > 0.6);
    this.group.visible = visible;
    if (!visible) return apparentPx;

    const sunDir = this._sunDir || (this._sunDir = new THREE.Vector3());
    sunDir.subVectors(ctx.sun.pos, b.pos);
    const sunDist = sunDir.length();
    sunDir.divideScalar(sunDist);
    const intensity = sunIntensityAt(sunDist);
    const u = this.material.uniforms;
    u.uRot.value.setFromMatrix4(this._m4 || (this._m4 = new THREE.Matrix4()).makeRotationFromQuaternion(b.quat));
    u.uAxes.value.copy(b.axes).divideScalar(b.maxRadius);
    u.uSunDir.value.copy(sunDir);
    u.uSunIntensity.value = intensity;
    u.uSunColor.value.setRGB(STAR.color[0], STAR.color[1], STAR.color[2]);
    u.uSunPos.value.subVectors(ctx.sun.pos, ctx.origin);
    u.uSunRadius.value = ctx.sun.radius;
    u.uPlanetCenter.value.copy(rel);
    if (b.atmosphere?.gasGiant) {
      const alt = dist - b.radius;
      u.uDetail.value = 1 - THREE.MathUtils.smoothstep(alt, b.radius * 0.04, b.radius * 0.7);
      u.uTime.value = ctx.time;
    }
    let k = 0;
    for (const occ of this.occluders) {
      u.uOccluders.value[k].set(occ.pos.x - ctx.origin.x, occ.pos.y - ctx.origin.y, occ.pos.z - ctx.origin.z, occ.radius);
      k++;
    }
    u.uOccluderCount.value = k;
    if (this.rings) {
      const r = b.def.rings;
      u.uRingParams.value.set(r.inner, r.outer, r.style === 'saturn' ? 1 : 0, r.reversed ? 1 : 0);
      u.uRingNormal.value.copy(b.pole);
      const ru = this.rings.material.uniforms;
      ru.uSunDir.value.copy(sunDir);
      ru.uSunIntensity.value = intensity;
      ru.uPlanetCenter.value.copy(rel);
      ru.uNormal.value.copy(b.pole);
      this.rings.visible = ringPx > 0.6;
    }

    // Earth's clouds drift slowly relative to the ground.
    if (this.clouds) {
      this.cloudRot = (ctx.time * 2e-6) % (Math.PI * 2);
      const cu = this.cloudMat.uniforms;
      cu.uCloudRot.value = this.cloudRot;
      cu.uRot.value.copy(u.uRot.value);
      cu.uSunDir.value.copy(sunDir);
      cu.uSunIntensity.value = intensity;
      u.uCloudRot.value = this.cloudRot;
      this.clouds.visible = apparentPx > 3;
    }
    if (this.atmo) {
      // atmoDim: light lost in cloud decks above the camera (Venus, Titan).
      updateAtmosphereUniforms(this.atmoMat, b, rel, sunDir, intensity * 20 * (this.atmoDim ?? 1), ctx.quality);
      this.atmo.visible = apparentPx > 2;
    }
    if (this.barrier) {
      const alt = dist - b.radius;
      const near = 1 - Math.min(1, Math.max(0, (alt - b.def.barrier.altitude) / 4.5e6));
      this.barrierHit = Math.max(0, this.barrierHit - ctx.dt * 0.8);
      const bu = this.barrierMat.uniforms;
      bu.uTime.value = ctx.time;
      bu.uCenter.value.copy(rel);
      bu.uStrength.value = near * near * 0.5;
      bu.uHit.value = this.barrierHit;
      this.barrier.visible = near > 0.01 || this.barrierHit > 0;
    }
    this.surface.visible = !this.terrainActive;
    this.group.scale.setScalar(eat);
    if (eat < 1) {
      for (const part of [this.atmo, this.clouds, this.rings, this.barrier]) if (part) part.visible = false;
      this.surface.visible = true;
    }
    return apparentPx * eat;
  }

  /** Flash the barrier where the ship struck it (local direction). */
  barrierImpact(dirLocal) {
    if (!this.barrier) return;
    this.barrierMat.uniforms.uHitDir.value.copy(dirLocal).normalize();
    this.barrierHit = 1;
  }
}

// ---- Distant bodies as points of light ------------------------------------------------------
const POINT_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aSize;
attribute vec3 aColor;
varying vec3 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize;
  #include <logdepthbuf_vertex>
}
`;
const POINT_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec3 vColor;
void main() {
  #include <logdepthbuf_fragment>
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = dot(c, c);
  if (r > 1.0) discard;
  float a = exp(-r * 4.0);
  gl_FragColor = vec4(vColor * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class BodyPoints {
  constructor(bodies) {
    this.bodies = bodies.filter((b) => b.id !== 'sun');
    const n = this.bodies.length;
    this.geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(n * 3);
    this.sizes = new Float32Array(n);
    this.colors = new Float32Array(n * 3);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3));
    this.material = new THREE.ShaderMaterial({
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    this._c = new THREE.Color();
  }

  update(origin, sun, visuals, pixelRatio) {
    this.bodies.forEach((b, i) => {
      if (b.eaten) { this.sizes[i] = 0; return; }
      const x = b.pos.x - origin.x, y = b.pos.y - origin.y, z = b.pos.z - origin.z;
      // Keep the point inside float range while preserving direction.
      const d = Math.hypot(x, y, z);
      const s = d > 1e12 ? 1e12 / d : 1;
      this.positions[i * 3] = x * s;
      this.positions[i * 3 + 1] = y * s;
      this.positions[i * 3 + 2] = z * s;
      const vis = visuals.get(b.id);
      const px = vis ? vis.apparentPx || 0 : 0;
      // Apparent brightness ~ albedo · R² / (d_sun² · d²), mapped to a dot size.
      const dSun = b.pos.distanceTo(sun.pos);
      const albedo = b.def.visual?.albedo ?? 0.3;
      const flux = (albedo * b.radius * b.radius) / (dSun * dSun * d * d);
      // Calibrated so m ≈ real apparent magnitude (Jupiter from Earth ≈ −2.5, Neptune ≈ +7.8).
      const m = b.def.visual?.magnitude ?? -2.5 * Math.log10(flux + 1e-60) - 82.4;
      const fade = Math.max(0, Math.min(1, 1.8 - px / 1.5)); // fade out once a disc is visible
      const size = Math.max(1.0, Math.min(7, 2.0 + (4.0 - m) * 0.5)) * fade * pixelRatio;
      this.sizes[i] = size;
      this._c.set(b.def.visual?.pointColor || '#ffffff');
      const bright = Math.max(0.12, Math.min(1.6, 1.3 - (m + 2) * 0.09)) * fade;
      this.colors[i * 3] = this._c.r * bright;
      this.colors[i * 3 + 1] = this._c.g * bright;
      this.colors[i * 3 + 2] = this._c.b * bright;
    });
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
    this.geometry.attributes.aColor.needsUpdate = true;
  }
}
