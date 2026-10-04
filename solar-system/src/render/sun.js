// =============================================================================
// sun.js — the Sun: an animated photosphere (boiling granulation, limb
// darkening, sunspots), a streaky corona, and a glare that stays a constant
// size on screen like a camera's bloom. The glare is hidden when a planet or
// moon blocks the Sun (eclipses work).
// =============================================================================
import * as THREE from 'three';
import { NOISE } from './glsl.js';
import { STAR, AU } from '../constants.js';

const SURFACE_VERT = /* glsl */ `
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

const SURFACE_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uTint;
${NOISE}
uniform float uTime;
uniform mat3 uRot;
varying vec3 vLocal;
varying vec3 vWorldPos;
void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vLocal);
  vec3 N = uRot * n;
  float mu = max(dot(N, normalize(-vWorldPos)), 0.0);
  // Granulation: convection cells ~1,000 km across, slowly boiling.
  vec3 p = n * 90.0;
  float t = uTime * 0.02;
  float g = fbm(p + vec3(t, -t, t * 0.7), 4);
  float cells = vnoise(n * 380.0 + vec3(0.0, t * 3.0, 0.0));
  float gran = 0.82 + 0.18 * g + 0.08 * cells;
  // Sunspots: dark umbrae in the mid-latitude bands.
  float lat = abs(n.y);
  float band = smoothstep(0.05, 0.25, lat) * smoothstep(0.6, 0.35, lat);
  float spots = smoothstep(0.78, 0.86, fbm(n * 14.0 + vec3(3.0), 3)) * band;
  // Limb darkening (Eddington approximation).
  float limb = 0.4 + 0.6 * pow(mu, 0.65);
  vec3 hot = vec3(1.0, 0.93, 0.82);
  vec3 col = hot * gran * limb * (1.0 - 0.75 * spots);
  col *= 3.2;
  gl_FragColor = vec4(col * uTint, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const GLOW_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec2 scale = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
  mv.xy += position.xy * scale;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;

const CORONA_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uTint;
${NOISE}
uniform float uTime;
uniform float uIntensity;
varying vec2 vUv;
void main() {
  #include <logdepthbuf_fragment>
  float r = length(vUv);
  float ang = atan(vUv.y, vUv.x);
  // r = 1 at the quad edge; the photosphere sits at r ≈ 0.125.
  float rs = r / 0.125;
  if (rs < 0.98) discard;
  float streak = 0.55 + 0.45 * fbm(vec3(ang * 3.0, ang * 1.3, uTime * 0.01), 4);
  float glow = pow(max(1.0 - (rs - 1.0) / 7.0, 0.0), 3.0) * streak + 0.35 * exp(-(rs - 1.0) * 2.2);
  vec3 col = vec3(1.0, 0.86, 0.66) * glow * uIntensity;
  gl_FragColor = vec4(col * uTint, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const GLARE_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uTint;
uniform float uIntensity;
varying vec2 vUv;
void main() {
  #include <logdepthbuf_fragment>
  float r = length(vUv);
  if (r > 1.0) discard;
  float core = exp(-r * r * 60.0) * 3.0;
  float halo = exp(-r * 7.0) * 0.6 + exp(-r * 2.6) * 0.12;
  // Six faint diffraction spikes, like a camera aperture.
  float a = atan(vUv.y, vUv.x);
  float spikes = pow(abs(cos(a * 3.0)), 80.0) * exp(-r * 9.0) * 0.45;
  vec3 col = vec3(1.0, 0.95, 0.86) * (core + halo + spikes) * uIntensity;
  gl_FragColor = vec4(col * uTint, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Colour of the star's disk, corona and glare (white for the Sun, red for Proxima). */
const TINT = { value: new THREE.Vector3(1, 1, 1) };

export class SunVisual {
  constructor(sunBody) {
    this.body = sunBody;
    this.group = new THREE.Group();
    this.surfaceMat = new THREE.ShaderMaterial({
      vertexShader: SURFACE_VERT,
      fragmentShader: SURFACE_FRAG,
      uniforms: { uTime: { value: 0 }, uRot: { value: new THREE.Matrix3() }, uTint: TINT },
    });
    this.surface = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 80), this.surfaceMat);
    this.surface.scale.setScalar(sunBody.radius);
    this.group.add(this.surface);

    const quad = new THREE.PlaneGeometry(2, 2);
    this.coronaMat = new THREE.ShaderMaterial({
      vertexShader: GLOW_VERT,
      fragmentShader: CORONA_FRAG,
      uniforms: { uTime: { value: 0 }, uIntensity: { value: 1 }, uTint: TINT },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.corona = new THREE.Mesh(quad, this.coronaMat);
    this.corona.scale.setScalar(sunBody.radius * 8);
    this.corona.frustumCulled = false;
    this.corona.renderOrder = 5;
    this.group.add(this.corona);

    this.glareMat = new THREE.ShaderMaterial({
      vertexShader: GLOW_VERT,
      fragmentShader: GLARE_FRAG,
      uniforms: { uIntensity: { value: 1 }, uTint: TINT },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.glare = new THREE.Mesh(quad, this.glareMat);
    this.glare.frustumCulled = false;
    this.glare.renderOrder = 10;
    this.group.add(this.glare);
  }

  /**
   * camRel: Sun centre minus camera (world). visibility: 0..1 fraction of the
   * disc not hidden behind other bodies.
   */
  update(time, camRel, visibility, exposure) {
    TINT.value.set(STAR.disk[0], STAR.disk[1], STAR.disk[2]);
    // The Sun can swell into a red giant and collapse (the "Sun's death" event).
    this.group.visible = !this.body.collapsed;
    if (this.body.collapsed) return;
    this.surface.scale.setScalar(this.body.radius);
    this.corona.scale.setScalar(this.body.radius * 8);
    this.group.position.copy(camRel);
    this.surfaceMat.uniforms.uTime.value = time;
    this.surfaceMat.uniforms.uRot.value.setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(this.body.quat));
    this.surface.quaternion.copy(this.body.quat);
    const d = camRel.length();
    // Glare: roughly constant on-screen size (like camera bloom), but never
    // smaller than a few solar radii so the disc itself stays visible up close.
    const sunAngle = Math.asin(Math.min(1, this.body.radius / d));
    const glareAngle = Math.min(1.2, Math.max(9 * Math.PI / 180, sunAngle * 2.2));
    this.glare.scale.setScalar(Math.tan(glareAngle) * d);
    const au = d / 1.495978707e11;
    const near = Math.min(1, 0.031 / (this.body.radius / d)); // fade glare when the disc fills the view
    const auEff = au / Math.sqrt(STAR.luminosity); // a dim red dwarf glares less
    this.glareMat.uniforms.uIntensity.value = visibility * near * Math.min(2.2, 1.0 / Math.pow(Math.max(auEff, 0.1), 0.5)) / Math.max(exposure, 0.3);
    this.glare.visible = visibility > 0.001;
    this.coronaMat.uniforms.uTime.value = time;
    this.coronaMat.uniforms.uIntensity.value = 1.1;
  }
}
