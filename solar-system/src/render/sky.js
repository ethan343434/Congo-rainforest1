// =============================================================================
// sky.js — the Milky Way. A real all-sky panorama in galactic coordinates,
// rotated into our ecliptic world frame, so the galaxy's band sits at its
// true ~60° angle to the planets' orbits and the galactic centre lies in
// Sagittarius, where you would really see it.
// =============================================================================
import * as THREE from 'three';
import { OBLIQUITY } from '../constants.js';

// Equatorial (J2000) → galactic rotation (IAU 1958 / Hipparcos values).
const EQ_TO_GAL = [
  [-0.0548755604162154, -0.8734370902348850, -0.4838350155487132],
  [0.4941094278755837, -0.4448296299600112, 0.7469822444972189],
  [-0.8676661490190047, -0.1980763734312015, 0.4559837761750669],
];

function worldToGalacticMatrix() {
  const c = Math.cos(OBLIQUITY), s = Math.sin(OBLIQUITY);
  // World → equatorial: x_eq = x; y_eq = -z·c - y·s; z_eq = -z·s + y·c
  const W2E = [
    [1, 0, 0],
    [0, -s, -c],
    [0, c, -s],
  ];
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) M[i][j] += EQ_TO_GAL[i][k] * W2E[k][j];
  // THREE.Matrix3.set takes row-major arguments.
  return new THREE.Matrix3().set(...M[0], ...M[1], ...M[2]);
}

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uSky;
uniform mat3 uToGal;
uniform float uBrightness;
varying vec3 vDir;
void main() {
  vec3 g = uToGal * normalize(vDir);
  float l = atan(g.y, g.x);
  float b = asin(clamp(g.z, -1.0, 1.0));
  vec2 uv = vec2(0.5 - l / 6.28318530718, 0.5 + b / 3.14159265359);
  // Seam-safe derivatives (the panorama wraps at l = 180°).
  vec2 uv2 = vec2(fract(uv.x + 0.5), uv.y);
  vec2 dx = dFdx(uv), dy = dFdy(uv), dx2 = dFdx(uv2), dy2 = dFdy(uv2);
  if (dot(dx2, dx2) + dot(dy2, dy2) < dot(dx, dx) + dot(dy, dy)) { dx = dx2; dy = dy2; }
  vec3 c = textureGrad(uSky, uv, dx, dy).rgb;
  // Lift faint stars a little and keep the dark sky truly dark.
  c = max(c - 0.004, 0.0) * uBrightness;
  c += pow(c, vec3(2.0)) * 2.0 * uBrightness;
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Sky {
  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uSky: { value: null },
        uToGal: { value: worldToGalacticMatrix() },
        uBrightness: { value: 1.6 },
      },
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1e6, 64, 32), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -100;
    this.mesh.visible = false;
  }

  setTexture(tex) {
    this.material.uniforms.uSky.value = tex;
    this.mesh.visible = true;
  }

  /** brightness: 0 when inside a bright daytime sky, 1 in open space. */
  update(brightness) {
    this.material.uniforms.uBrightness.value = 1.6 * brightness;
    this.mesh.visible = !!this.material.uniforms.uSky.value && brightness > 0.01;
  }
}
