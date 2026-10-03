// =============================================================================
// atmosphere.js — physically based single-scattering atmosphere (Rayleigh +
// Mie), drawn as a back-faced shell around the planet so it works both from
// space (the blue limb of Earth, Mars' dusty haze) and from inside (the sky
// above you when you fly down).
//
// All maths runs in units of the planet radius, with the camera height passed
// in from the CPU in double precision, so it stays stable whether you are
// a metre above the ground or a billion kilometres away.
// =============================================================================
import * as THREE from 'three';

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uCamPos;     // camera relative to planet centre, in planet radii
uniform float uCamH;      // |uCamPos| − 1, computed in double precision
uniform float uAtmoR;     // atmosphere top radius, planet radii
uniform vec3 uBetaR;      // Rayleigh scattering per planet radius
uniform float uBetaM;     // Mie scattering per planet radius
uniform float uHR;        // Rayleigh scale height, planet radii
uniform float uHM;        // Mie scale height, planet radii
uniform float uG;         // Mie anisotropy
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uMieColor;
uniform int uSteps;
uniform int uLightSteps;
varying vec3 vWorldPos;

void main() {
  #include <logdepthbuf_fragment>
  vec3 dir = normalize(vWorldPos);
  float b = dot(uCamPos, dir);
  float r0 = 1.0 + uCamH;
  float ca = (r0 - uAtmoR) * (r0 + uAtmoR);
  float da = b * b - ca;
  if (da <= 0.0) discard;
  float sa = sqrt(da);
  float t0 = max(-b - sa, 0.0);
  float t1 = -b + sa;
  if (t1 <= 0.0) discard;
  float cp = uCamH * (2.0 + uCamH);
  float dp = b * b - cp;
  if (dp > 0.0) {
    float tp = -b - sqrt(dp);
    if (tp > 0.0) t1 = min(t1, tp);
  }
  float seg = (t1 - t0) / float(uSteps);
  vec3 sumR = vec3(0.0), sumM = vec3(0.0);
  float odR = 0.0, odM = 0.0;
  for (int i = 0; i < 16; i++) {
    if (i >= uSteps) break;
    vec3 P = uCamPos + dir * (t0 + seg * (float(i) + 0.5));
    float h = length(P) - 1.0;
    float dR = exp(-h / uHR) * seg;
    float dM = exp(-h / uHM) * seg;
    odR += dR;
    odM += dM;
    float bl = dot(P, uSunDir);
    float pp = dot(P, P);
    // In the planet's shadow?  (sun ray hits the ground)
    float dpl = bl * bl - (pp - 1.0);
    if (bl < 0.0 && dpl > 0.0) continue;
    float tl = -bl + sqrt(max(bl * bl - (pp - uAtmoR * uAtmoR), 0.0));
    float segL = tl / float(uLightSteps);
    float odRl = 0.0, odMl = 0.0;
    for (int j = 0; j < 8; j++) {
      if (j >= uLightSteps) break;
      vec3 Q = P + uSunDir * (segL * (float(j) + 0.5));
      float hl = length(Q) - 1.0;
      odRl += exp(-hl / uHR) * segL;
      odMl += exp(-hl / uHM) * segL;
    }
    vec3 tau = uBetaR * (odR + odRl) + uBetaM * 1.1 * (odM + odMl) * uMieColor;
    vec3 att = exp(-tau);
    sumR += dR * att;
    sumM += dM * att;
  }
  float mu = dot(dir, uSunDir);
  float phaseR = 0.0596831 * (1.0 + mu * mu);
  float g = uG;
  float phaseM = 0.1193662 * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
  vec3 color = uSunColor * uSunIntensity * (sumR * uBetaR * phaseR + sumM * uBetaM * uMieColor * phaseM);
  vec3 trans = exp(-(uBetaR * odR + uBetaM * 1.1 * odM * uMieColor));
  gl_FragColor = vec4(color, clamp(dot(trans, vec3(0.3333)), 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * Build the material for a body's atmosphere definition.
 * Returns the material plus an update(camRelPlanetCenter, sunDir, sunIntensity) helper.
 */
export function createAtmosphereMaterial(body) {
  const atm = body.atmosphere;
  const R = body.radius;
  const mieColor = atm.mieColor || atm.haze || [1, 1, 1];
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.SrcAlphaFactor,
    uniforms: {
      uCamPos: { value: new THREE.Vector3() },
      uCamH: { value: 1 },
      uAtmoR: { value: 1 + atm.top / R },
      uBetaR: { value: new THREE.Vector3(...atm.rayleigh).multiplyScalar(R) },
      uBetaM: { value: (atm.mie || 0) * R },
      uHR: { value: atm.scaleHeight / R },
      uHM: { value: (atm.mieScaleHeight || atm.scaleHeight * 0.2) / R },
      uG: { value: atm.mieG ?? 0.76 },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uSunColor: { value: new THREE.Color(1, 1, 1) },
      uSunIntensity: { value: 18 },
      uMieColor: { value: new THREE.Vector3(...normalizeColor(mieColor)) },
      uSteps: { value: 10 },
      uLightSteps: { value: 4 },
    },
  });
  return mat;
}

function normalizeColor(c) {
  // Mie "colour" here is an extinction tint: dusty air absorbs blue more.
  const m = Math.max(...c);
  return c.map((v) => 0.4 + 0.6 * (v / m));
}

/**
 * Per-frame uniforms. camToCenter = planet centre minus camera (world, metres,
 * double precision). quality: { steps, lightSteps }.
 */
export function updateAtmosphereUniforms(mat, body, camToCenter, sunDir, sunIntensity, quality) {
  const u = mat.uniforms;
  const R = body.radius;
  // Camera relative to centre in planet radii; height computed precisely.
  const d = camToCenter.length();
  u.uCamPos.value.copy(camToCenter).multiplyScalar(-1 / R);
  // For an oblate body use the local reference radius under the camera.
  u.uCamH.value = d / R - 1;
  u.uSunDir.value.copy(sunDir);
  u.uSunIntensity.value = sunIntensity;
  u.uSteps.value = quality.atmoSteps;
  u.uLightSteps.value = quality.atmoLightSteps;
}
