// =============================================================================
// blackHole.js — how the (fictional) black hole beyond Pluto looks:
//   * the event horizon: a perfectly black sphere;
//   * an accretion disk of glowing gas, white-hot near the middle and orange
//     further out, turning faster close in (differential rotation), brighter
//     on the side swinging towards you (Doppler beaming);
//   * a camera-facing photon ring: the lensed image of the far side of the
//     disk wrapped around the black shadow, as in the Event Horizon Telescope
//     images and "Interstellar".
// Same interface as BodyVisual, so the world renderer treats it like any body.
// =============================================================================
import * as THREE from 'three';
import { NOISE } from './glsl.js';

const DISK_VERT = /* glsl */ `
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

const DISK_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${NOISE}
uniform float uTime;
uniform vec3 uSpinAxis;   // world
uniform vec3 uCenter;     // camera-relative centre
varying vec3 vLocal;
varying vec3 vWorldPos;
void main() {
  #include <logdepthbuf_fragment>
  float r = length(vLocal.xz);
  float a = atan(vLocal.z, vLocal.x);
  // Inner gas orbits faster (Kepler: angular speed ∝ r^-1.5).
  float rot = a + uTime * 0.9 / pow(r, 1.5);
  vec3 q = vec3(cos(rot) * r * 2.2, sin(rot) * r * 2.2, r * 1.3);
  float n = fbm(q, 4) * 0.7 + fbm(q * 3.1 + 7.0, 3) * 0.3;
  float t = 1.0 - smoothstep(1.6, 7.0, r);
  vec3 col = mix(vec3(1.0, 0.32, 0.06), vec3(1.0, 0.92, 0.8), pow(t, 1.4));
  float inner = smoothstep(1.55, 1.85, r);
  float intensity = pow(t, 1.3) * (0.35 + 1.1 * n) * inner;
  // Doppler beaming: gas moving towards the camera looks brighter.
  vec3 toCam = normalize(-vWorldPos);
  vec3 radial = normalize(vWorldPos - uCenter);
  vec3 orbitDir = normalize(cross(uSpinAxis, radial));
  float beam = 1.0 + 0.65 * dot(orbitDir, toCam);
  gl_FragColor = vec4(col * intensity * beam * 0.55, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const RING_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${NOISE}
uniform float uTime;
varying vec2 vUv;
void main() {
  #include <logdepthbuf_fragment>
  vec2 p = vUv * 2.0 - 1.0;          // quad spans ±3 horizon radii
  float r = length(p) * 3.0;
  float a = atan(p.y, p.x);
  // Thin photon ring just outside the shadow, plus a softer lensed halo of the disk.
  float ring = exp(-pow((r - 1.32) / 0.04, 2.0)) * 0.9;
  float halo = exp(-pow((r - 1.6) / 0.35, 2.0)) * 0.18 * (0.6 + 0.8 * fbm(vec3(cos(a) * 3.0, sin(a) * 3.0, uTime * 0.05), 3));
  float glow = exp(-max(r - 1.2, 0.0) * 2.5) * 0.03;
  float shadow = smoothstep(1.02, 1.12, r);
  vec3 col = vec3(1.0, 0.72, 0.42) * (ring + halo) + vec3(1.0, 0.55, 0.3) * glow;
  gl_FragColor = vec4(col * shadow, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const QUAD_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;

export class BlackHoleVisual {
  constructor(body) {
    this.body = body;
    this.group = new THREE.Group();
    this.group.name = body.id;
    const R = body.radius;
    this.terrainActive = false;
    this.atmoDim = 1;

    // Tilt the system so the disk is seen at an angle from the inner solar system.
    this.tilt = new THREE.Group();
    this.tilt.rotation.set(0.35, 0, 0.15);
    this.group.add(this.tilt);

    this.horizon = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    this.horizon.scale.setScalar(R);
    this.horizon.renderOrder = 2;
    this.tilt.add(this.horizon);

    const diskGeo = new THREE.RingGeometry(1.5, 7, 256, 8);
    diskGeo.rotateX(-Math.PI / 2);
    this.diskMat = new THREE.ShaderMaterial({
      vertexShader: DISK_VERT,
      fragmentShader: DISK_FRAG,
      uniforms: { uTime: { value: 0 }, uSpinAxis: { value: new THREE.Vector3(0, 1, 0) }, uCenter: { value: new THREE.Vector3() } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.disk = new THREE.Mesh(diskGeo, this.diskMat);
    this.disk.scale.setScalar(R);
    this.disk.renderOrder = 3;
    this.tilt.add(this.disk);

    this.ringMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: RING_FRAG,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), this.ringMat);
    this.ring.scale.setScalar(R);
    this.ring.renderOrder = 4;
    this.group.add(this.ring);
    this._rel = new THREE.Vector3();
    this._axis = new THREE.Vector3();
  }

  setTexture() {}
  setOccluders() {}
  barrierImpact() {}

  update(ctx) {
    const b = this.body;
    const rel = this._rel.subVectors(b.pos, ctx.origin);
    const dist = rel.length();
    this.group.position.copy(rel);
    const apparentPx = ((b.radius * 4) / Math.max(dist, 1)) * ctx.pixelScale;
    this.apparentPx = apparentPx;
    this.group.visible = apparentPx > 0.35;
    if (!this.group.visible) return apparentPx;
    this.diskMat.uniforms.uTime.value = ctx.time;
    this.ringMat.uniforms.uTime.value = ctx.time;
    this.diskMat.uniforms.uCenter.value.copy(rel);
    this.group.updateMatrixWorld(true);
    this.diskMat.uniforms.uSpinAxis.value.set(0, 1, 0).applyQuaternion(this.tilt.getWorldQuaternion(new THREE.Quaternion()));
    // Photon ring always faces the camera (which sits at the origin).
    this.ring.lookAt(0, 0, 0);
    return apparentPx;
  }
}
