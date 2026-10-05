// =============================================================================
// planetMaterial.js — the shader for planet and moon surfaces seen from space
// (and for giant planets at any distance).
//
// Lighting: Lambert mixed with Lommel–Seeliger for airless bodies (that is
// why the full Moon looks flat, with no darkening towards its edge), bump
// detail from height maps, Earth's night lights / ocean glint / cloud
// shadows, Saturn's ring shadow and eclipse shadows from other bodies.
// =============================================================================
import * as THREE from 'three';
import { EQUIRECT, ECLIPSE, RING_SHADOW, NOISE } from './glsl.js';

const VERT = /* glsl */ `
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

const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${EQUIRECT}
${ECLIPSE}
${RING_SHADOW}
${NOISE}
uniform float uDetail;      // giant planets up close: turbulent cloud detail
uniform float uDetailScale;
uniform float uTime;
uniform sampler2D uDay;
uniform sampler2D uNight;
uniform sampler2D uWater;
uniform sampler2D uHeight;
uniform sampler2D uClouds;
uniform vec4 uFlags;      // hasNight, hasWater, hasHeight, hasClouds
uniform vec2 uHeightTexel;
uniform float uBump;
uniform float uCloudRot;
uniform mat3 uRot;        // local → world rotation
uniform vec3 uAxes;       // ellipsoid semi-axes, normalised
uniform vec3 uSunDir;     // world, planet → Sun
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform float uAiry;      // 1 = airless regolith (Lommel–Seeliger), 0 = Lambert
uniform float uWrap;      // terminator softening for bodies with atmospheres
uniform vec3 uAmbient;
uniform vec3 uTint;
uniform float uLimbDark;  // giant-planet limb darkening
varying vec3 vLocal;
varying vec3 vWorldPos;

float heightAt(vec3 n, vec2 off) { return sampleEquirectOffset(uHeight, n, off).r; }

void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vLocal);
  vec3 nl = normalize(vLocal / uAxes);
  vec3 albedo = sampleEquirect(uDay, n).rgb * uTint;
  if (uDetail > 0.001) {
    // Eddies and festoons finer than the map, stretched east–west like the belts.
    vec3 q = n * uDetailScale;
    q.y *= 3.2;
    float t = uTime * 0.0015;
    float w = fbm(q + vec3(t, 0.0, -t), 4);
    float w2 = fbm(q * 4.1 + vec3(w * 2.3), 4);
    float d = (w * 0.55 + w2 * 0.45) - 0.5;
    albedo *= 1.0 + d * 0.55 * uDetail;
  }

  // Bump mapping from the height map (east/north gradient).
  if (uFlags.z > 0.5) {
    vec3 east = cross(vec3(0.0, 1.0, 0.0), n);
    float el = length(east);
    if (el > 1e-4) {
      east /= el;
      vec3 north = cross(n, east);
      float hE = heightAt(n, vec2(uHeightTexel.x, 0.0));
      float hW = heightAt(n, vec2(-uHeightTexel.x, 0.0));
      float hN = heightAt(n, vec2(0.0, uHeightTexel.y));
      float hS = heightAt(n, vec2(0.0, -uHeightTexel.y));
      float coslat = max(el, 0.08);
      float dLon = (hE - hW) / (2.0 * uHeightTexel.x * 6.2831853);
      float dLat = (hN - hS) / (2.0 * uHeightTexel.y * 3.1415927);
      nl = normalize(nl - uBump * 0.03 * (dLon / coslat * east + dLat * north));
    }
  }
  vec3 N = normalize(uRot * nl);
  vec3 V = normalize(-vWorldPos);
  float mu0 = dot(N, uSunDir);
  float mu = max(dot(N, V), 0.0);

  // Diffuse: Lambert vs Lommel–Seeliger, softened terminator if there is air.
  float lambert = clamp((mu0 + uWrap) / (1.0 + uWrap), 0.0, 1.0);
  float ls = mu0 > 0.0 ? 2.0 * mu0 / (mu0 + mu + 1e-4) : 0.0;
  float diffuse = mix(lambert, ls * 0.6 + lambert * 0.4, uAiry);
  if (uLimbDark > 0.0) diffuse *= mix(1.0, pow(mu, 0.35), uLimbDark);

  float shadow = eclipseLight(vWorldPos) * ringShadow(vWorldPos, uSunDir);

  // Earth: clouds cast shadows a little sunward of where they float.
  if (uFlags.w > 0.5) {
    vec3 sunLocal = transpose(uRot) * uSunDir;
    vec3 shifted = normalize(n + (sunLocal - n * dot(n, sunLocal)) * 0.0035);
    float a = cos(uCloudRot), b = sin(uCloudRot);
    vec3 rc = vec3(a * shifted.x - b * shifted.z, shifted.y, b * shifted.x + a * shifted.z);
    float c = sampleEquirect(uClouds, rc).r;
    shadow *= 1.0 - 0.55 * c * smoothstep(-0.05, 0.2, mu0);
  }

  vec3 color = albedo * uSunColor * uSunIntensity * diffuse * shadow + albedo * uAmbient;

  // Earth: specular glint on oceans and city lights on the night side.
  if (uFlags.y > 0.5) {
    float water = sampleEquirect(uWater, n).r;
    vec3 H = normalize(uSunDir + V);
    float nh = max(dot(N, H), 0.0);
    // Sun glint on water: tight core plus a soft sheen (Fresnel-weighted).
    float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(V, H), 0.0), 5.0);
    float spec = pow(nh, 600.0) * 0.7 + pow(nh, 60.0) * 0.035;
    color += uSunColor * uSunIntensity * spec * (0.25 + fresnel) * water * shadow * smoothstep(0.0, 0.15, mu0);
  }
  if (uFlags.x > 0.5) {
    vec3 lights = sampleEquirect(uNight, n).rgb;
    float night = smoothstep(0.05, -0.18, mu0);
    color += pow(lights, vec3(1.6)) * vec3(1.0, 0.8, 0.5) * night * 3.2;
  }

  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** 1×1 placeholder so every sampler is always bound to something valid. */
export const BLACK_TEX = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
BLACK_TEX.needsUpdate = true;
export const WHITE_TEX = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
WHITE_TEX.needsUpdate = true;
export const GREY_TEX = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
GREY_TEX.needsUpdate = true;

export function createPlanetMaterial({ airless = false, wrap = 0, limbDark = 0, bump = 0, tint = [1, 1, 1] } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uDay: { value: GREY_TEX },
      uNight: { value: BLACK_TEX },
      uWater: { value: BLACK_TEX },
      uHeight: { value: GREY_TEX },
      uClouds: { value: BLACK_TEX },
      uFlags: { value: new THREE.Vector4(0, 0, 0, 0) },
      uHeightTexel: { value: new THREE.Vector2(1 / 1024, 1 / 512) },
      uBump: { value: bump },
      uCloudRot: { value: 0 },
      uRot: { value: new THREE.Matrix3() },
      uAxes: { value: new THREE.Vector3(1, 1, 1) },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uSunColor: { value: new THREE.Color(1, 0.98, 0.95) },
      uSunIntensity: { value: 1 },
      uAiry: { value: airless ? 1 : 0 },
      uWrap: { value: wrap },
      uAmbient: { value: new THREE.Color(0.004, 0.004, 0.005) },
      uTint: { value: new THREE.Color(...tint) },
      uLimbDark: { value: limbDark },
      uOccluders: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
      uOccluderCount: { value: 0 },
      uSunPos: { value: new THREE.Vector3() },
      uSunRadius: { value: 6.957e8 },
      uRingTex: { value: BLACK_TEX },
      uRingParams: { value: new THREE.Vector4(0, 0, 0, 0) },
      uRingNormal: { value: new THREE.Vector3(0, 1, 0) },
      uPlanetCenter: { value: new THREE.Vector3() },
      uDetail: { value: 0 },
      uDetailScale: { value: 600 },
      uTime: { value: 0 },
    },
  });
}
