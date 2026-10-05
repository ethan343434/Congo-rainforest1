// =============================================================================
// glsl.js — GLSL snippets shared by several shaders.
// =============================================================================

/** Hash + value noise + fBm, stable for inputs up to ~10⁴. */
export const NOISE = /* glsl */ `
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), u.x),
                 mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), u.x), u.y),
             mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), u.x),
                 mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), u.x), u.y), u.z);
}
float fbm(vec3 p, int oct) {
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    s += a * vnoise(p);
    n += a;
    p = p * 2.03 + vec3(1.7, 9.2, 4.1);
    a *= 0.5;
  }
  return s / n;
}
float ridged(vec3 p, int oct) {
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    float v = 1.0 - abs(vnoise(p) * 2.0 - 1.0);
    s += a * v * v;
    n += a;
    p = p * 2.07 + vec3(3.1, 1.3, 7.7);
    a *= 0.5;
  }
  return s / n;
}
// Cellular crater field: returns (rim-ish brightness, floor darkness) for albedo.
vec2 craterField(vec3 p) {
  vec3 i = floor(p);
  vec2 res = vec2(0.0);
  for (int x = -1; x <= 1; x++)
  for (int y = -1; y <= 1; y++)
  for (int z = -1; z <= 1; z++) {
    vec3 c = i + vec3(x, y, z);
    vec3 h = hash33(c);
    if (h.x > 0.55) continue;
    vec3 center = c + h;
    float r = 0.18 + 0.32 * h.y;
    float d = length(p - center) / r;
    if (d < 1.6) {
      res.x = max(res.x, smoothstep(0.25, 0.0, abs(d - 1.0)) * (0.5 + 0.5 * h.z));
      res.y = max(res.y, smoothstep(0.95, 0.4, d) * (0.4 + 0.6 * h.z));
    }
  }
  return res;
}
`;

/** Equirectangular lookup that hides the 180° seam (picks seam-free derivatives). */
export const EQUIRECT = /* glsl */ `
vec2 equirectUV(vec3 n) {
  float lon = atan(-n.z, n.x);
  float lat = asin(clamp(n.y, -1.0, 1.0));
  return vec2(0.5 + lon / 6.28318530718, 0.5 + lat / 3.14159265359);
}
vec4 sampleEquirect(sampler2D t, vec3 n) {
  vec2 uv = equirectUV(n);
  vec2 uv2 = vec2(fract(uv.x + 0.5), uv.y);
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  vec2 dx2 = dFdx(uv2), dy2 = dFdy(uv2);
  if (dot(dx2, dx2) + dot(dy2, dy2) < dot(dx, dx) + dot(dy, dy)) { dx = dx2; dy = dy2; }
  return textureGrad(t, uv, dx, dy);
}
vec4 sampleEquirectOffset(sampler2D t, vec3 n, vec2 offset) {
  vec2 uv = equirectUV(n) + offset;
  vec2 uv2 = vec2(fract(uv.x + 0.5), uv.y);
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  vec2 dx2 = dFdx(uv2), dy2 = dFdy(uv2);
  if (dot(dx2, dx2) + dot(dy2, dy2) < dot(dx, dx) + dot(dy, dy)) { dx = dx2; dy = dy2; }
  return textureGrad(t, vec2(fract(uv.x), clamp(uv.y, 0.0, 1.0)), dx, dy);
}
`;

/**
 * Soft shadow from spherical occluders (eclipses, moon shadows on giant
 * planets). Positions are camera-relative world metres.
 */
export const ECLIPSE = /* glsl */ `
uniform vec4 uOccluders[4];
uniform int uOccluderCount;
uniform vec3 uSunPos;
uniform float uSunRadius;
float eclipseLight(vec3 P) {
  float light = 1.0;
  vec3 toSun = uSunPos - P;
  float dSun = length(toSun);
  vec3 sdir = toSun / dSun;
  float aSun = uSunRadius / dSun;
  for (int i = 0; i < 4; i++) {
    if (i >= uOccluderCount) break;
    vec3 toOcc = uOccluders[i].xyz - P;
    float dOcc = length(toOcc);
    if (dOcc > dSun) continue;
    float aOcc = uOccluders[i].w / dOcc;
    float sep = acos(clamp(dot(toOcc / dOcc, sdir), -1.0, 1.0));
    // Fraction of the Sun's disc covered (smooth approximation).
    float cover = clamp((aSun + aOcc - sep) / (2.0 * min(aSun, aOcc) + 1e-9), 0.0, 1.0);
    float maxCover = min(1.0, (aOcc * aOcc) / (aSun * aSun));
    light *= 1.0 - cover * maxCover;
  }
  return light;
}
`;

/** Rings shadow on a planet: transmission along the ray towards the Sun. */
export const RING_SHADOW = /* glsl */ `
uniform sampler2D uRingTex;
uniform vec4 uRingParams; // inner, outer, enabled, reversed
uniform vec3 uRingNormal;  // planet pole, world
uniform vec3 uPlanetCenter; // camera-relative
float ringShadow(vec3 P, vec3 sunDir) {
  if (uRingParams.z < 0.5) return 1.0;
  float denom = dot(sunDir, uRingNormal);
  if (abs(denom) < 1e-4) return 1.0;
  float t = dot(uPlanetCenter - P, uRingNormal) / denom;
  if (t <= 0.0) return 1.0;
  vec3 hit = P + sunDir * t;
  float r = length(hit - uPlanetCenter);
  if (r < uRingParams.x || r > uRingParams.y) return 1.0;
  float u = (r - uRingParams.x) / (uRingParams.y - uRingParams.x);
  if (uRingParams.w > 0.5) u = 1.0 - u;
  float a = texture(uRingTex, vec2(u, 0.5)).a;
  return 1.0 - a * 0.85;
}
`;
