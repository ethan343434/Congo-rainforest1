// =============================================================================
// effects.js — motion and danger cues around the player:
//   * SpeedDust: faint dust in space and streaming streaks in air or at pulse
//     speed, moving with your velocity relative to the nearest world, so you
//     can feel speed where there is nothing else to see.
//   * DeepAtmosphere: what you see after sinking below a giant planet's cloud
//     tops: murky light fading with depth, the occasional lightning flash.
//   * Explosion: fireball and debris when the ship is destroyed.
// Everything is positioned relative to the camera (floating origin).
// =============================================================================
import * as THREE from 'three';

const _v = new THREE.Vector3();

export class SpeedDust {
  constructor(count = 700) {
    this.count = count;
    this.size = 240; // m: wrap-around cube centred on the camera
    this.pos = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) this.pos[i] = (Math.random() - 0.5) * this.size;
    this.geometry = new THREE.BufferGeometry();
    this.verts = new Float32Array(count * 6);
    this.colors = new Float32Array(count * 6);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.verts, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.lines = new THREE.LineSegments(this.geometry, this.material);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 7;
    this.color = new THREE.Color(1, 1, 1);
  }

  /**
   * vel: camera velocity relative to the local frame (world axes, m/s).
   * opts: { air (0..1 density factor), pulse (bool), color [r,g,b], amount (0..1) }
   */
  update(dt, vel, opts) {
    const S = this.size, half = S / 2;
    let v = vel.length();
    const dir = v > 1e-3 ? _v.copy(vel).divideScalar(v) : _v.set(0, 0, -1);
    // Visual speed: real up to a point, then stylised (pulse drive).
    let vis = Math.min(v, 900);
    if (opts.pulse) vis = 1400;
    const streak = Math.min(opts.pulse ? 90 : 40, vis * (opts.air > 0.02 ? 0.06 : 0.03));
    const amount = opts.amount ?? 1;
    const base = (opts.pulse ? 0.5 : opts.air > 0.02 ? 0.2 + opts.air * 0.45 : 0.05) * amount;
    const fadeIn = Math.min(1, Math.max(0, (v - 3) / 40));
    if (opts.color) this.color.setRGB(opts.color[0], opts.color[1], opts.color[2]);
    const p = this.pos, V = this.verts, C = this.colors;
    const dx = -dir.x * vis * dt, dy = -dir.y * vis * dt, dz = -dir.z * vis * dt;
    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      let x = p[k] + dx, y = p[k + 1] + dy, z = p[k + 2] + dz;
      // Wrap into the cube.
      if (x > half) x -= S; else if (x < -half) x += S;
      if (y > half) y -= S; else if (y < -half) y += S;
      if (z > half) z -= S; else if (z < -half) z += S;
      p[k] = x; p[k + 1] = y; p[k + 2] = z;
      const o = i * 6;
      V[o] = x; V[o + 1] = y; V[o + 2] = z;
      V[o + 3] = x - dir.x * streak; V[o + 4] = y - dir.y * streak; V[o + 5] = z - dir.z * streak;
      const d = Math.sqrt(x * x + y * y + z * z);
      const fade = Math.min(1, d / 12) * Math.max(0, 1 - d / half) * fadeIn * base * (0.5 + 0.5 * ((i * 7919) % 13) / 13);
      C[o] = this.color.r * fade; C[o + 1] = this.color.g * fade; C[o + 2] = this.color.b * fade;
      C[o + 3] = 0; C[o + 4] = 0; C[o + 5] = 0;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.lines.visible = fadeIn > 0 && amount > 0;
  }
}

// ---- Inside a giant planet -------------------------------------------------------------------
const DEEP_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}
`;
const DEEP_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uUp;
uniform vec3 uSunDir;
uniform vec3 uTop;
uniform vec3 uBottom;
uniform float uLight;
uniform float uOpacity;
uniform float uFlash;
uniform vec3 uFlashDir;
uniform float uTime;
varying vec3 vDir;
float h3(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float n3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
void main() {
  #include <logdepthbuf_fragment>
  vec3 d = normalize(vDir);
  float up = dot(d, uUp);
  vec3 col = mix(uBottom, uTop, smoothstep(-0.6, 0.8, up));
  // Brighter towards the Sun's side of the murk.
  col *= 0.75 + 0.5 * max(0.0, dot(d, uSunDir));
  // Billowing cloud structure.
  float c = n3(d * 6.0 + vec3(0.0, uTime * 0.02, 0.0)) * 0.6 + n3(d * 17.0) * 0.4;
  col *= 0.75 + 0.5 * c;
  col *= uLight;
  float flash = uFlash * smoothstep(0.55, 1.0, dot(d, uFlashDir)) * (0.6 + 0.4 * c);
  col += vec3(0.75, 0.85, 1.0) * flash * 2.5 + vec3(0.4, 0.45, 0.5) * uFlash * 0.25;
  gl_FragColor = vec4(col, uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class DeepAtmosphere {
  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: DEEP_VERT,
      fragmentShader: DEEP_FRAG,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uUp: { value: new THREE.Vector3(0, 1, 0) },
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uTop: { value: new THREE.Color(1, 1, 1) },
        uBottom: { value: new THREE.Color(0.2, 0.15, 0.1) },
        uLight: { value: 1 },
        uOpacity: { value: 0 },
        uFlash: { value: 0 },
        uFlashDir: { value: new THREE.Vector3(0, -1, 0) },
        uTime: { value: 0 },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24), this.material);
    this.mesh.renderOrder = 5;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.flash = 0;
    this.time = 0;
  }

  /**
   * s: { opacity, up (world), sunDir (world), top [r,g,b], bottom [r,g,b], light,
   *      lightning (bool), dt }
   */
  update(s) {
    const u = this.material.uniforms;
    this.time += s.dt;
    this.mesh.visible = s.opacity > 0.003;
    if (!this.mesh.visible) return;
    u.uOpacity.value = s.opacity;
    u.uUp.value.copy(s.up);
    u.uSunDir.value.copy(s.sunDir);
    u.uTop.value.setRGB(...s.top);
    u.uBottom.value.setRGB(...s.bottom);
    u.uLight.value = s.light;
    u.uTime.value = this.time;
    // Lightning: Juno saw it flashing deep in Jupiter's water clouds.
    this.flash = Math.max(0, this.flash - s.dt * 5);
    if (s.lightning && Math.random() < s.dt * 0.35) {
      this.flash = 0.6 + Math.random() * 0.6;
      const r = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      u.uFlashDir.value.copy(s.up).multiplyScalar(-0.9).add(r.multiplyScalar(0.8)).normalize();
      this.onFlash?.();
    }
    u.uFlash.value = this.flash;
  }
}

// ---- Explosion ----------------------------------------------------------------------------------
export class Explosion {
  constructor() {
    this.group = new THREE.Group();
    this.group.visible = false;
    this.fireMat = new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.fire = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.fireMat);
    this.group.add(this.fire);
    this.debrisMat = new THREE.MeshStandardMaterial({ color: 0x777b80, roughness: 0.6, metalness: 0.5, emissive: 0xff5a1a, emissiveIntensity: 1 });
    this.debris = [];
    for (let i = 0; i < 36; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.4 + Math.random() * 1.6, 0.1 + Math.random() * 0.5, 0.3 + Math.random() * 1.2), this.debrisMat);
      this.group.add(m);
      this.debris.push({ m, v: new THREE.Vector3(), w: new THREE.Vector3() });
    }
    this.world = new THREE.Vector3();
    this.t = 0;
    this.active = false;
  }

  trigger(worldPos) {
    this.world.copy(worldPos);
    this.t = 0;
    this.active = true;
    this.group.visible = true;
    for (const d of this.debris) {
      d.m.position.set(0, 0, 0);
      d.v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(15 + Math.random() * 60);
      d.w.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    }
  }

  update(dt, origin) {
    if (!this.active) return;
    this.t += dt;
    const t = this.t;
    this.group.position.subVectors(this.world, origin);
    const r = 4 + 70 * (1 - Math.exp(-t * 2.5));
    this.fire.scale.setScalar(r);
    this.fireMat.opacity = Math.max(0, 1 - t / 2.2);
    this.fireMat.color.setRGB(1, 0.75 - Math.min(0.5, t * 0.3), 0.45 - Math.min(0.4, t * 0.3));
    this.debrisMat.emissiveIntensity = Math.max(0, 1.2 - t * 0.5);
    for (const d of this.debris) {
      d.m.position.addScaledVector(d.v, dt);
      d.m.rotation.x += d.w.x * dt; d.m.rotation.y += d.w.y * dt; d.m.rotation.z += d.w.z * dt;
    }
    if (t > 8) { this.active = false; this.group.visible = false; }
  }
}
