// =============================================================================
// procTextures.js — equirectangular surface maps generated on the GPU for
// worlds where no public image map is bundled. Each style is modelled on what
// spacecraft photographed (Galileo for Jupiter's moons, Cassini for Saturn's,
// Voyager 2 for Uranus' and Neptune's, New Horizons for Charon).
//
// Output is linear colour (no sRGB decode needed when sampling).
// =============================================================================
import * as THREE from 'three';
import { NOISE } from './glsl.js';

const STYLES = [
  'io', 'europa', 'ganymede', 'callisto', 'mimas', 'enceladus', 'tethys', 'dione', 'rhea', 'titan',
  'iapetus', 'miranda', 'ariel', 'umbriel', 'titania', 'oberon', 'triton', 'proteus', 'nereid',
  'phobos', 'deimos', 'charon', 'venusClouds', 'titanSurface', 'regolith', 'proxb',
];

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = /* glsl */ `
${NOISE}
uniform float uSeed;
varying vec2 vUv;

vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }

// Direction on a unit sphere for each texel of the equirectangular map.
vec3 dirFromUv(vec2 uv) {
  float lon = (uv.x - 0.5) * 6.28318530718;
  float lat = (uv.y - 0.5) * 3.14159265359;
  return vec3(cos(lat) * cos(lon), sin(lat), -cos(lat) * sin(lon));
}
vec3 dirLatLon(float latDeg, float lonDeg) {
  float lat = radians(latDeg), lon = radians(lonDeg);
  return vec3(cos(lat) * cos(lon), sin(lat), -cos(lat) * sin(lon));
}
// Spot field: (core, halo) intensities for volcanoes / bright craters.
vec2 spots(vec3 p, float density) {
  vec3 i = floor(p);
  vec2 r = vec2(0.0);
  for (int x = -1; x <= 1; x++)
  for (int y = -1; y <= 1; y++)
  for (int z = -1; z <= 1; z++) {
    vec3 c = i + vec3(x, y, z);
    vec3 h = hash33(c + uSeed);
    if (h.x > density) continue;
    float d = length(p - c - h);
    r.x = max(r.x, smoothstep(0.12 + 0.1 * h.y, 0.0, d));
    r.y = max(r.y, smoothstep(0.55 + 0.3 * h.z, 0.1, d) * (0.5 + 0.5 * h.y));
  }
  return r;
}
float craters(vec3 n, float scale, float amount) {
  vec2 c = craterField(n * scale + uSeed);
  return c.x * 0.35 * amount - c.y * 0.18 * amount;
}
float bigCrater(vec3 n, vec3 center, float radius) {
  float d = acos(clamp(dot(n, center), -1.0, 1.0)) / radius;
  return smoothstep(1.15, 0.95, d) * smoothstep(0.75, 1.0, d) - smoothstep(0.9, 0.2, d) * 0.4 + smoothstep(0.12, 0.0, d) * 0.3;
}
float lines(vec3 p, float sharp) {
  float r = ridged(p, 4);
  return pow(r, sharp);
}

vec3 cratered(vec3 n, vec3 a, vec3 b, float mottle, float craterAmt) {
  float m = fbm(n * 5.0 + uSeed, 6);
  vec3 col = mix(srgb(a), srgb(b), smoothstep(0.3, 0.7, m) * mottle + (1.0 - mottle) * 0.5);
  float c = craters(n, 18.0, craterAmt) + craters(n, 45.0, craterAmt * 0.8) + craters(n, 110.0, craterAmt * 0.6);
  return col * (1.0 + c);
}

vec3 shade(vec3 n) {
#if STYLE == 0
  { // Io: sulfur, lava, plume deposits
    float base = fbm(n * 3.0 + uSeed, 5);
    vec3 col = mix(srgb(vec3(0.86, 0.79, 0.40)), srgb(vec3(0.95, 0.91, 0.66)), base);
    float red = smoothstep(0.52, 0.72, fbm(n * 2.2 + 7.0, 4));
    col = mix(col, srgb(vec3(0.78, 0.47, 0.22)), red * 0.55);
    col = mix(col, srgb(vec3(0.48, 0.37, 0.26)), smoothstep(0.55, 0.95, abs(n.y)) * 0.75);
    vec2 v = spots(n * 7.0, 0.32);
    col = mix(col, srgb(vec3(0.82, 0.33, 0.12)), v.y * 0.55);
    col = mix(col, srgb(vec3(0.06, 0.05, 0.04)), v.x);
    vec2 w = spots(n * 13.0 + 3.0, 0.2);
    col = mix(col, srgb(vec3(0.96, 0.96, 0.9)), w.y * 0.35);
    return col;
  }
#endif
#if STYLE == 1
  { // Europa: ice, chaos terrain, lineae
    vec3 col = srgb(vec3(0.86, 0.82, 0.73));
    float mott = fbm(n * 4.0 + uSeed, 6);
    col = mix(col, srgb(vec3(0.66, 0.52, 0.39)), smoothstep(0.5, 0.72, mott) * 0.6);
    float l1 = lines(n * vec3(5.0, 2.2, 5.0) + 11.0, 14.0);
    float l2 = lines(n * vec3(3.0, 6.0, 3.0) + 2.0, 18.0);
    col = mix(col, srgb(vec3(0.55, 0.34, 0.22)), clamp(l1 + l2, 0.0, 1.0) * 0.75);
    col *= 1.0 + craters(n, 30.0, 0.15);
    return col;
  }
#endif
#if STYLE == 2
  { // Ganymede: dark ancient terrain + bright grooved terrain
    float region = smoothstep(0.42, 0.58, fbm(n * 1.7 + uSeed, 5));
    vec3 light = srgb(vec3(0.70, 0.68, 0.64)) * (0.9 + 0.2 * sin(dot(n, vec3(40.0, 25.0, 33.0)) + fbm(n * 8.0, 3) * 6.0) * 0.5);
    vec3 dark = srgb(vec3(0.40, 0.36, 0.31)) * (0.85 + 0.3 * fbm(n * 9.0, 4));
    vec3 col = mix(light, dark, region);
    col *= 1.0 + craters(n, 22.0, 0.9);
    col += spots(n * 25.0, 0.15).y * 0.12;
    col = mix(col, srgb(vec3(0.85, 0.85, 0.86)), smoothstep(0.72, 0.9, abs(n.y)) * 0.6);
    return col;
  }
#endif
#if STYLE == 3
  { // Callisto: dark, saturated with bright-rimmed craters
    vec3 col = srgb(vec3(0.34, 0.30, 0.26)) * (0.8 + 0.4 * fbm(n * 6.0 + uSeed, 5));
    col += spots(n * 38.0, 0.45).y * 0.18 + spots(n * 90.0, 0.4).y * 0.1;
    col *= 1.0 + craters(n, 25.0, 1.0);
    vec3 v = dirLatLon(14.0, -56.0); // Valhalla multi-ring basin
    float dv = acos(clamp(dot(n, v), -1.0, 1.0));
    col += srgb(vec3(0.5)) * (smoothstep(0.25, 0.0, dv) * 0.35 + 0.08 * (0.5 + 0.5 * sin(dv * 90.0)) * smoothstep(0.6, 0.2, dv));
    return col;
  }
#endif
#if STYLE == 4
  { // Mimas: Herschel crater
    vec3 col = cratered(n, vec3(0.70, 0.69, 0.66), vec3(0.82, 0.81, 0.78), 0.6, 1.0);
    col *= 1.0 + bigCrater(n, dirLatLon(-1.0, -112.0), 0.34) * 0.6;
    return col;
  }
#endif
#if STYLE == 5
  { // Enceladus: fresh snow, south-polar tiger stripes
    vec3 col = srgb(vec3(0.95, 0.96, 0.97));
    col *= 1.0 + craters(n, 26.0, 0.35) * smoothstep(-0.2, 0.4, n.y);
    float south = smoothstep(-0.55, -0.75, n.y);
    float stripes = smoothstep(0.92, 1.0, sin(n.x * 38.0 + n.z * 14.0 + fbm(n * 6.0, 3) * 3.0));
    col = mix(col, srgb(vec3(0.62, 0.78, 0.88)), stripes * south * 0.8);
    col = mix(col, srgb(vec3(0.85, 0.9, 0.94)), lines(n * 9.0, 10.0) * 0.3);
    return col;
  }
#endif
#if STYLE == 6
  { // Tethys: Odysseus crater, Ithaca Chasma
    vec3 col = cratered(n, vec3(0.80, 0.78, 0.74), vec3(0.9, 0.89, 0.86), 0.5, 0.9);
    col *= 1.0 + bigCrater(n, dirLatLon(30.0, -130.0), 0.36) * 0.4;
    float chasma = abs(dot(n, normalize(vec3(0.3, 0.2, 0.93))));
    col *= 1.0 - smoothstep(0.06, 0.0, chasma) * 0.3;
    return col;
  }
#endif
#if STYLE == 7
  { // Dione: wispy ice cliffs on the trailing side
    vec3 col = cratered(n, vec3(0.62, 0.61, 0.59), vec3(0.78, 0.77, 0.74), 0.6, 1.0);
    float trailing = smoothstep(0.1, 0.6, -n.z);
    col = mix(col, srgb(vec3(0.95, 0.95, 0.94)), lines(n * vec3(4.0, 7.0, 4.0) + 5.0, 9.0) * trailing * 0.7);
    return col;
  }
#endif
#if STYLE == 8
  { // Rhea
    vec3 col = cratered(n, vec3(0.64, 0.63, 0.6), vec3(0.8, 0.79, 0.76), 0.6, 1.1);
    col = mix(col, srgb(vec3(0.93)), lines(n * vec3(3.0, 6.0, 3.0) + 9.0, 12.0) * smoothstep(0.0, 0.5, -n.z) * 0.5);
    return col;
  }
#endif
#if STYLE == 9
  { // Titan seen from space: orange haze with a darker north polar hood
    float band = fbm(vec3(n.y * 6.0, 0.0, 0.0) + uSeed, 3);
    vec3 col = mix(srgb(vec3(0.85, 0.58, 0.24)), srgb(vec3(0.92, 0.68, 0.32)), band);
    col *= 1.0 - smoothstep(0.6, 0.95, n.y) * 0.35;
    col *= 0.95 + 0.05 * fbm(n * 12.0, 3);
    return col;
  }
#endif
#if STYLE == 10
  { // Iapetus: dark leading hemisphere (Cassini Regio), bright trailing
    vec3 bright = cratered(n, vec3(0.78, 0.76, 0.72), vec3(0.9, 0.88, 0.84), 0.5, 0.8);
    vec3 dark = srgb(vec3(0.17, 0.12, 0.08)) * (0.8 + 0.4 * fbm(n * 8.0, 4));
    float lead = dot(n, vec3(0.0, 0.0, 1.0)) + 0.25 * (fbm(n * 5.0 + uSeed, 4) - 0.5) - abs(n.y) * 0.45;
    return mix(bright, dark, smoothstep(0.05, 0.25, lead));
  }
#endif
#if STYLE == 11
  { // Miranda: patchwork coronae with chevrons
    vec3 col = cratered(n, vec3(0.62, 0.62, 0.6), vec3(0.75, 0.75, 0.73), 0.5, 0.8);
    float cor = smoothstep(0.55, 0.6, fbm(n * 1.5 + 4.0, 3));
    float stripes = 0.5 + 0.5 * sin((n.x * 30.0 + n.y * 22.0) + fbm(n * 4.0, 3) * 8.0);
    col = mix(col, col * (0.75 + 0.45 * stripes), cor);
    return col;
  }
#endif
#if STYLE == 12
  { // Ariel
    vec3 col = cratered(n, vec3(0.7, 0.69, 0.67), vec3(0.82, 0.81, 0.79), 0.5, 0.7);
    col *= 1.0 - lines(n * vec3(6.0, 2.0, 6.0) + 3.0, 16.0) * 0.4;
    return col;
  }
#endif
#if STYLE == 13
  { // Umbriel: dark, with the bright ring of Wunda crater
    vec3 col = cratered(n, vec3(0.30, 0.30, 0.29), vec3(0.4, 0.4, 0.39), 0.5, 0.9);
    float d = acos(clamp(dot(n, dirLatLon(-8.0, -87.0)), -1.0, 1.0));
    col += srgb(vec3(0.7)) * smoothstep(0.03, 0.0, abs(d - 0.06)) * 0.6;
    return col;
  }
#endif
#if STYLE == 14
  { // Titania
    vec3 col = cratered(n, vec3(0.55, 0.53, 0.5), vec3(0.68, 0.66, 0.63), 0.5, 0.9);
    col *= 1.0 - lines(n * vec3(2.5, 5.0, 2.5) + 6.0, 18.0) * 0.45;
    return col;
  }
#endif
#if STYLE == 15
  { // Oberon: dark-floored craters
    vec3 col = cratered(n, vec3(0.48, 0.44, 0.40), vec3(0.6, 0.56, 0.52), 0.5, 1.1);
    col *= 1.0 - spots(n * 30.0, 0.3).x * 0.6;
    return col;
  }
#endif
#if STYLE == 16
  { // Triton: pink south polar cap with dark geyser streaks, cantaloupe north
    float cap = smoothstep(0.1, -0.25, n.y + 0.15 * fbm(n * 3.0, 3));
    vec3 north = srgb(vec3(0.62, 0.66, 0.6)) * (0.85 + 0.3 * fbm(n * 14.0 + uSeed, 4));
    vec3 south = srgb(vec3(0.93, 0.82, 0.78));
    vec3 col = mix(north, south, cap);
    float streak = smoothstep(0.7, 0.9, fbm(vec3(n.x * 40.0, n.y * 6.0, n.z * 40.0), 3));
    col = mix(col, srgb(vec3(0.3, 0.25, 0.22)), streak * cap * 0.6);
    return col;
  }
#endif
#if STYLE == 17 || STYLE == 18
  { // Proteus, Nereid: dark, cratered
    return cratered(n, vec3(0.20, 0.19, 0.18), vec3(0.27, 0.26, 0.25), 0.5, 1.2);
  }
#endif
#if STYLE == 19
  { // Phobos: grooves and Stickney
    vec3 col = cratered(n, vec3(0.26, 0.22, 0.19), vec3(0.34, 0.29, 0.25), 0.4, 1.2);
    col *= 1.0 - smoothstep(0.85, 1.0, sin(n.y * 120.0 + n.x * 30.0)) * 0.25;
    col *= 1.0 + bigCrater(n, dirLatLon(1.0, -49.0), 0.45) * 0.4;
    return col;
  }
#endif
#if STYLE == 20
  { // Deimos: dusty and smooth
    return cratered(n, vec3(0.32, 0.27, 0.23), vec3(0.38, 0.33, 0.28), 0.4, 0.5);
  }
#endif
#if STYLE == 21
  { // Charon: grey with the reddish Mordor Macula
    vec3 col = cratered(n, vec3(0.55, 0.53, 0.51), vec3(0.66, 0.64, 0.61), 0.5, 0.9);
    col = mix(col, srgb(vec3(0.46, 0.27, 0.2)), smoothstep(0.65, 0.85, n.y + 0.1 * fbm(n * 6.0, 3)) * 0.8);
    return col;
  }
#endif
#if STYLE == 22
  { // Venus cloud tops: creamy, faint dark chevrons
    float y = n.y;
    float chev = fbm(vec3(abs(y) * 4.0 + atan(n.z, n.x) * 0.35, y * 2.0, 0.0) + uSeed, 5);
    vec3 col = mix(srgb(vec3(0.97, 0.91, 0.72)), srgb(vec3(0.82, 0.72, 0.52)), smoothstep(0.45, 0.8, chev) * 0.6);
    col *= 0.96 + 0.04 * fbm(n * 20.0, 3);
    return col;
  }
#endif
#if STYLE == 23
  { // Titan's surface under the haze: dark dune seas, bright uplands
    float h = fbm(n * 3.0 + uSeed, 6);
    vec3 dunes = srgb(vec3(0.24, 0.17, 0.11)) * (0.8 + 0.3 * sin(n.x * 300.0 + n.z * 120.0));
    vec3 high = srgb(vec3(0.62, 0.48, 0.32));
    vec3 col = mix(dunes, high, smoothstep(0.45, 0.6, h));
    col = mix(col, srgb(vec3(0.05, 0.05, 0.06)), smoothstep(0.7, 0.9, n.y) * smoothstep(0.52, 0.6, fbm(n * 5.0, 4)));
    return col;
  }
#endif
#if STYLE == 25
  { // Proxima b (imagined): an eyeball world under a red dwarf
    // +X points at the star. Warp the zone edges so they wander naturally.
    float warp = (fbm(n * 3.0 + uSeed, 5) - 0.5) * 0.35 + (fbm(n * 11.0, 3) - 0.5) * 0.08;
    float x = n.x + warp;
    float detail = fbm(n * 24.0 + 5.0, 5);
    float fine = fbm(n * 90.0 + 9.0, 4);
    // Scorched salt flats and pale sand right under the star.
    vec3 salt = mix(srgb(vec3(0.86, 0.72, 0.56)), srgb(vec3(0.95, 0.86, 0.74)), smoothstep(0.45, 0.7, detail));
    salt *= 0.9 + 0.2 * smoothstep(0.55, 0.6, fine);
    // Red-orange dune seas and dark basalt plateaus.
    vec3 sand = mix(srgb(vec3(0.62, 0.30, 0.16)), srgb(vec3(0.78, 0.45, 0.25)), detail);
    sand = mix(sand, srgb(vec3(0.22, 0.14, 0.12)), smoothstep(0.62, 0.72, fbm(n * 7.0 + 2.0, 5)) * 0.85);
    // Twilight ring: near-black violet forests, maroon moss, teal lichen, dark lakes.
    vec3 forest = mix(srgb(vec3(0.10, 0.05, 0.12)), srgb(vec3(0.22, 0.07, 0.16)), smoothstep(0.35, 0.65, detail));
    forest = mix(forest, srgb(vec3(0.10, 0.26, 0.26)), smoothstep(0.62, 0.75, fbm(n * 16.0 + 3.0, 4)) * 0.6);
    forest = mix(forest, srgb(vec3(0.02, 0.04, 0.07)), smoothstep(0.66, 0.7, fbm(n * 5.0 + 8.0, 5)));
    // Night side: glaciers, blue ice, dark nunataks.
    vec3 ice = mix(srgb(vec3(0.72, 0.78, 0.86)), srgb(vec3(0.90, 0.93, 0.97)), detail);
    ice = mix(ice, srgb(vec3(0.38, 0.52, 0.66)), smoothstep(0.6, 0.72, fbm(n * 14.0 + 1.0, 4)) * 0.6);
    ice = mix(ice, srgb(vec3(0.20, 0.20, 0.22)), smoothstep(0.66, 0.74, fbm(n * 9.0 + 4.0, 5)) * 0.8);
    vec3 col = ice;
    col = mix(col, forest, smoothstep(-0.3, -0.12, x));
    col = mix(col, sand, smoothstep(0.24, 0.42, x));
    col = mix(col, salt, smoothstep(0.7, 0.85, x));
    return col;
  }
#endif
  // regolith (fallback)
#if STYLE == 24
  return cratered(n, vec3(0.45), vec3(0.6), 0.5, 1.0);
#endif
  return vec3(0.5);
}

void main() {
  vec3 n = dirFromUv(vUv);
  gl_FragColor = vec4(shade(n), 1.0);
}
`;

const quad = { geometry: null, camera: null };

/**
 * Render one style into an equirectangular map. Each style is its own small
 * shader (STYLE is a preprocessor constant), because one shader holding every
 * style takes minutes to compile on Windows (ANGLE / Direct3D). The program is
 * compiled in the background where the browser supports it, so the page keeps
 * drawing while it builds.
 */
export async function generateProceduralTexture(renderer, style, width = 1024) {
  const index = STYLES.indexOf(style);
  if (index < 0) throw new Error(`Unknown procedural style ${style}`);
  const height = width / 2;
  const target = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.UnsignedByteType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
  });
  if (!quad.geometry) {
    quad.geometry = new THREE.PlaneGeometry(2, 2);
    quad.camera = new THREE.Camera();
  }
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    defines: { STYLE: index },
    uniforms: { uSeed: { value: (index * 17.31) % 7.0 } },
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(quad.geometry, mat);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  try {
    await renderer.compileAsync(scene, quad.camera);
  } catch (e) { /* fall back to compiling on first render */ }
  const prevTarget = renderer.getRenderTarget();
  const prevToneMapping = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setRenderTarget(target);
  renderer.render(scene, quad.camera);
  renderer.setRenderTarget(prevTarget);
  renderer.toneMapping = prevToneMapping;
  mat.dispose();
  target.texture.colorSpace = THREE.NoColorSpace;
  target.texture.anisotropy = 4;
  return target.texture;
}
