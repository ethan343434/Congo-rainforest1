// =============================================================================
// terrainMaterial.js — how the ground looks up close.
//
// A standard physically based material (so it takes the Sun's light, shadows
// of the ship and astronaut, and atmospheric fog) extended with:
//   * the body's real global colour map, looked up by direction;
//   * three scales of tileable detail (grain, pebbles, metre-scale lumps)
//     projected on three axes so nothing stretches on slopes;
//   * physically scaled bump detail (heights in metres), so fine relief
//     catches low sunlight the way lunar regolith does;
//   * brighter, rougher material on steep slopes (fresh crater walls).
// =============================================================================
import * as THREE from 'three';
import { EQUIRECT } from '../render/glsl.js';

/** Tileable 512² detail texture: R grain, G blotches, B pebbles, A bump height. */
export function createDetailTexture(size = 512) {
  const data = new Uint8Array(size * size * 4);
  const hash = (x, y, s) => {
    let h = Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ s;
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  // Periodic value noise with lattice period L (divides size).
  const noise = (x, y, L, s) => {
    const fx = (x / size) * L, fy = (y / size) * L;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = fx - ix, ty = fy - iy;
    const ux = tx * tx * (3 - 2 * tx), uy = ty * ty * (3 - 2 * ty);
    const w = (v) => ((v % L) + L) % L;
    const a = hash(w(ix), w(iy), s), b = hash(w(ix + 1), w(iy), s);
    const c = hash(w(ix), w(iy + 1), s), d = hash(w(ix + 1), w(iy + 1), s);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
  const fbm = (x, y, L0, oct, s) => {
    let v = 0, amp = 0.5, L = L0, norm = 0;
    for (let k = 0; k < oct; k++) { v += amp * noise(x, y, L, s + k * 17); norm += amp; amp *= 0.5; L *= 2; }
    return v / norm;
  };
  // Pebbles: jittered points on a periodic grid.
  const pebbles = new Float32Array(size * size);
  const cells = 48, cs = size / cells;
  for (let cy = 0; cy < cells; cy++) {
    for (let cx = 0; cx < cells; cx++) {
      const n = 1 + Math.floor(hash(cx, cy, 99) * 3);
      for (let k = 0; k < n; k++) {
        const px = (cx + hash(cx, cy, 100 + k)) * cs, py = (cy + hash(cx, cy, 200 + k)) * cs;
        const r = cs * (0.12 + 0.35 * Math.pow(hash(cx, cy, 300 + k), 2.5));
        const R = Math.ceil(r);
        for (let dy = -R; dy <= R; dy++) {
          for (let dx = -R; dx <= R; dx++) {
            const d = Math.hypot(dx + (px % 1), dy + (py % 1)) / r;
            if (d >= 1) continue;
            const x = (((Math.floor(px) + dx) % size) + size) % size;
            const y = (((Math.floor(py) + dy) % size) + size) % size;
            const h = Math.sqrt(1 - d * d);
            const i = y * size + x;
            if (h > pebbles[i]) pebbles[i] = h;
          }
        }
      }
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const grain = fbm(x, y, 64, 3, 1);
      const blot = fbm(x, y, 4, 4, 7);
      const p = pebbles[i];
      const height = 0.45 * fbm(x, y, 8, 5, 11) + 0.35 * p + 0.2 * grain;
      data[i * 4] = Math.round(grain * 255);
      data[i * 4 + 1] = Math.round(blot * 255);
      data[i * 4 + 2] = Math.round(p * 255);
      data[i * 4 + 3] = Math.round(Math.min(1, height) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const VERT_PARS = /* glsl */ `
attribute vec3 aDir;
attribute vec3 aDetail;
attribute vec4 aMorph;
varying vec3 vDir;
varying vec3 vDetail;
varying vec3 vLocalNormal;
`;
const VERT_MAIN = /* glsl */ `
{
  // Geomorph towards the parent tile's shape with distance (no LOD steps).
  float camDist = length((modelViewMatrix * vec4(transformed, 1.0)).xyz);
  float morphK = clamp((camDist - aMorph.w) / (aMorph.w * 0.48), 0.0, 1.0);
  transformed += aMorph.xyz * morphK;
}
vDir = aDir;
vDetail = aDetail;
vLocalNormal = normal;
`;

const FRAG_PARS = /* glsl */ `
${EQUIRECT}
uniform sampler2D uColorMap;
uniform sampler2D uDetailTex;
uniform float uHasColor;
uniform vec3 uBaseColor;
uniform vec3 uTint;
uniform float uSlopeBright;
uniform float uBumpScale;
uniform float uDetailContrast;
uniform float uMapContrast;
varying vec3 vDir;
varying vec3 vDetail;
varying vec3 vLocalNormal;
vec3 triW;
vec4 tri(vec3 p) {
  return texture2D(uDetailTex, p.yz) * triW.x + texture2D(uDetailTex, p.zx) * triW.y + texture2D(uDetailTex, p.xy) * triW.z;
}
vec3 perturbNormalPhys(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir) {
  vec3 vSigmaX = dFdx(surf_pos);
  vec3 vSigmaY = dFdy(surf_pos);
  vec3 R1 = cross(vSigmaY, surf_norm);
  vec3 R2 = cross(surf_norm, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDir;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}
`;

// Replaces <map_fragment>: albedo from the global map and the detail layers.
const FRAG_MAP = /* glsl */ `
vec3 ln = normalize(vLocalNormal);
triW = pow(abs(ln), vec3(4.0));
triW /= (triW.x + triW.y + triW.z);
vec4 dFine = tri(vDetail / 0.37);
vec4 dMid = tri(vDetail / 2.9);
vec4 dBig = tri(vDetail / 23.0);
vec4 dHuge = tri(vDetail / 190.0);
vec3 base = uHasColor > 0.5 ? mix(uBaseColor, sampleEquirect(uColorMap, normalize(vDir)).rgb, uMapContrast) : uBaseColor;
base *= uTint;
float slope = clamp(1.0 - dot(ln, normalize(vDir)), 0.0, 1.0);
float vari = (0.92 + 0.16 * dFine.r) * (0.9 + 0.2 * dMid.g) * (0.88 + 0.24 * dHuge.g);
vari = mix(1.0, vari, uDetailContrast);
float peb = dMid.b * 0.12 + dFine.b * 0.06;
vec3 albedo = base * vari * (1.0 + peb) * (1.0 + uSlopeBright * smoothstep(0.08, 0.5, slope));
diffuseColor.rgb *= albedo;
float detailH = dFine.a * 0.005 + dMid.a * 0.022 + dBig.a * 0.09 + dHuge.a * 0.35;
`;

// Replaces <normal_fragment_maps>: bump relief in metres.
const FRAG_NORMAL = /* glsl */ `
vec2 dHdxy = vec2(dFdx(detailH), dFdy(detailH)) * uBumpScale;
normal = perturbNormalPhys(-vViewPosition, normal, dHdxy, faceDirection);
`;

/**
 * opts: { colorMap (Texture|null), baseColor [r,g,b] (linear), tint [r,g,b],
 *         slopeBright, bump, roughness, detailContrast }
 */
export function createTerrainMaterial(detailTex, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: opts.roughness ?? 0.97, metalness: 0 });
  const uniforms = {
    uColorMap: { value: opts.colorMap || null },
    uDetailTex: { value: detailTex },
    uHasColor: { value: opts.colorMap ? 1 : 0 },
    uBaseColor: { value: new THREE.Vector3(...(opts.baseColor || [0.3, 0.3, 0.3])) },
    uTint: { value: new THREE.Vector3(...(opts.tint || [1, 1, 1])) },
    uSlopeBright: { value: opts.slopeBright ?? 0.35 },
    uBumpScale: { value: opts.bump ?? 1 },
    uDetailContrast: { value: opts.detailContrast ?? 1 },
    uMapContrast: { value: opts.mapContrast ?? 1 },
  };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <map_fragment>', FRAG_MAP)
      .replace('#include <normal_fragment_maps>', FRAG_NORMAL);
  };
  mat.customProgramCacheKey = () => 'terrain-v3';
  return mat;
}

/** Re-point a terrain material at another body's colour map. */
export function setTerrainColor(mat, colorMap, opts = {}) {
  const u = mat.userData.uniforms;
  u.uColorMap.value = colorMap || null;
  u.uHasColor.value = colorMap ? 1 : 0;
  if (opts.baseColor) u.uBaseColor.value.set(...opts.baseColor);
  u.uTint.value.set(...(opts.tint || [1, 1, 1]));
  if (opts.slopeBright !== undefined) u.uSlopeBright.value = opts.slopeBright;
  if (opts.bump !== undefined) u.uBumpScale.value = opts.bump;
}
