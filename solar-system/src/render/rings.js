// =============================================================================
// rings.js — planetary rings. Saturn uses its real colour/opacity profile;
// Uranus and Neptune get their narrow, dark ringlets at their true radii;
// Jupiter has a faint dusty ring. Rings are lit from the Sun's side, glow
// faintly when backlit, and fall into the planet's shadow.
// =============================================================================
import * as THREE from 'three';
import { BLACK_TEX } from './planetMaterial.js';

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
uniform sampler2D uTex;
uniform vec4 uParams;        // inner, outer, reversed, style (0 tex, 1 uranus, 2 neptune, 3 faint)
uniform vec3 uColor;
uniform float uOpacity;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uPlanetCenter;  // camera-relative
uniform float uPlanetRadius;
uniform vec3 uNormal;        // ring plane normal (world)
uniform float uRinglets[10];
uniform float uRingletWidth[10];
varying vec3 vLocal;
varying vec3 vWorldPos;

float ringletProfile(float r) {
  float a = 0.0;
  for (int i = 0; i < 10; i++) {
    float w = uRingletWidth[i];
    if (w <= 0.0) continue;
    a = max(a, smoothstep(w, 0.0, abs(r - uRinglets[i])));
  }
  return a;
}

void main() {
  #include <logdepthbuf_fragment>
  float r = length(vLocal.xz);
  if (r < uParams.x || r > uParams.y) discard;
  float u = (r - uParams.x) / (uParams.y - uParams.x);
  vec3 col;
  float alpha;
  if (uParams.w < 0.5) {
    vec4 t = texture(uTex, vec2(uParams.z > 0.5 ? 1.0 - u : u, 0.5));
    col = t.rgb;
    alpha = t.a;
  } else if (uParams.w < 2.5) {
    alpha = ringletProfile(r) * 0.85 + 0.03;
    col = uColor;
  } else {
    alpha = smoothstep(0.0, 0.25, u) * smoothstep(1.0, 0.55, u);
    col = uColor;
  }
  alpha *= uOpacity;
  if (alpha < 0.002) discard;

  // Planet shadow: does the ray towards the Sun hit the planet?
  vec3 P = vWorldPos;
  vec3 oc = P - uPlanetCenter;
  float b = dot(oc, uSunDir);
  float c = dot(oc, oc) - uPlanetRadius * uPlanetRadius;
  float disc = b * b - c;
  float shadow = 1.0;
  if (disc > 0.0 && b < 0.0) {
    float miss = sqrt(max(dot(oc, oc) - b * b, 0.0)) / uPlanetRadius;
    shadow = smoothstep(0.985, 1.0, miss);
  }
  // Lit side vs. back-lit side (forward scattering through the ring).
  vec3 V = normalize(-P);
  float sunSide = sign(dot(uNormal, uSunDir));
  float viewSide = sign(dot(uNormal, V));
  float litFace = sunSide == viewSide ? 1.0 : 0.25 + 0.6 * (1.0 - alpha);
  float elev = abs(dot(uNormal, uSunDir));
  float light = (0.25 + 0.75 * smoothstep(0.0, 0.35, elev)) * litFace;
  vec3 color = col * uSunColor * uSunIntensity * light * shadow * 0.9;
  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const URANUS_RINGLETS = [41837, 42234, 42571, 44718, 45661, 47176, 47627, 48300, 50023, 51149];
const URANUS_WIDTHS = [1.5, 2, 2.5, 7, 8, 2, 3, 6, 2, 45];
const NEPTUNE_RINGLETS = [41900, 53200, 57200, 62932, 0, 0, 0, 0, 0, 0];
const NEPTUNE_WIDTHS = [1000, 60, 600, 25, 0, 0, 0, 0, 0, 0];

export function createRings(body, texture) {
  const rings = body.def.rings;
  const geo = new THREE.RingGeometry(rings.inner, rings.outer, 256, 4);
  geo.rotateX(-Math.PI / 2); // into the local XZ (equatorial) plane
  const styleIndex = { saturn: 0, uranus: 1, neptune: 2, faint: 3 }[rings.style] ?? 0;
  const list = rings.style === 'uranus' ? URANUS_RINGLETS : NEPTUNE_RINGLETS;
  const widths = rings.style === 'uranus' ? URANUS_WIDTHS : NEPTUNE_WIDTHS;
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTex: { value: texture || BLACK_TEX },
      uParams: { value: new THREE.Vector4(rings.inner, rings.outer, rings.reversed ? 1 : 0, styleIndex) },
      uColor: { value: new THREE.Color(...(rings.color || (rings.style === 'uranus' ? [0.42, 0.42, 0.44] : [0.55, 0.52, 0.5]))) },
      uOpacity: { value: rings.opacity ?? (rings.style === 'saturn' ? 1 : rings.style === 'uranus' ? 0.55 : 0.18) },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uSunColor: { value: new THREE.Color(1, 1, 1) },
      uSunIntensity: { value: 1 },
      uPlanetCenter: { value: new THREE.Vector3() },
      uPlanetRadius: { value: body.radius },
      uNormal: { value: new THREE.Vector3(0, 1, 0) },
      uRinglets: { value: list.map((km) => km * 1000) },
      uRingletWidth: { value: widths.map((km) => km * 1000) },
    },
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  return mesh;
}

/** Ring particle density (0..1) at a point, for damage when flying through them. */
export function ringDensityAt(body, localPos, texData) {
  const rings = body.def.rings;
  if (!rings || rings.style !== 'saturn') return 0;
  const r = Math.hypot(localPos.x, localPos.z);
  if (r < rings.inner || r > rings.outer) return 0;
  const thickness = 400; // vertical extent of the main rings we treat as dangerous (m)
  if (Math.abs(localPos.y) > thickness) return 0;
  let u = (r - rings.inner) / (rings.outer - rings.inner);
  if (rings.reversed) u = 1 - u;
  if (!texData) return 0.6;
  const i = Math.min(texData.width - 1, Math.floor(u * texData.width));
  return texData.alpha[i] / 255;
}
