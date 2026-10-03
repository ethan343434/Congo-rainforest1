// =============================================================================
// shipModel.js — the player's ship, built procedurally (~14 m long): lathed
// fuselage, glass canopy, swept wings, twin engines with glowing nozzles,
// tail fins, retractable landing gear, navigation lights, exhaust plumes and
// the plasma sheath that wraps the hull during atmospheric entry.
// Ship axes: forward −Z, up +Y, right +X (same as the flight model).
// =============================================================================
import * as THREE from 'three';
import { NOISE } from './glsl.js';

function mats(envMap) {
  const common = { envMap, envMapIntensity: 0.6 };
  return {
    hull: new THREE.MeshStandardMaterial({ color: 0xdfe3e6, metalness: 0.35, roughness: 0.42, ...common }),
    accent: new THREE.MeshStandardMaterial({ color: 0xe0702a, metalness: 0.3, roughness: 0.45, ...common }),
    dark: new THREE.MeshStandardMaterial({ color: 0x353a40, metalness: 0.75, roughness: 0.38, ...common }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0c1520, metalness: 0.9, roughness: 0.06, emissive: 0x0a2236, emissiveIntensity: 0.6, ...common, envMapIntensity: 1.4 }),
    nozzle: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.6, roughness: 0.5, emissive: 0xff7a2a, emissiveIntensity: 0 }),
    gear: new THREE.MeshStandardMaterial({ color: 0x8a9096, metalness: 0.8, roughness: 0.35, ...common }),
  };
}

function wingGeometry(span, rootChord, tipChord, sweep, thickness) {
  const s = new THREE.Shape();
  s.moveTo(0, -rootChord / 2);
  s.lineTo(span, -rootChord / 2 + sweep);
  s.lineTo(span, -rootChord / 2 + sweep + tipChord);
  s.lineTo(0, rootChord / 2);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: thickness, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.06, bevelSegments: 2 });
  g.rotateX(Math.PI / 2); // shape XY → XZ plane
  g.translate(0, thickness / 2, 0);
  return g;
}

const PLUME_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;
const PLUME_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${NOISE}
uniform float uTime;
uniform float uPower;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  #include <logdepthbuf_fragment>
  float along = vUv.y;              // 1 at the nozzle, 0 at the tip
  float flick = 0.75 + 0.25 * vnoise(vec3(vUv.x * 8.0, along * 6.0 - uTime * 30.0, uTime * 3.0));
  float shape = pow(along, 1.6) * flick;
  vec3 col = mix(uColor, vec3(1.0, 0.95, 0.9), pow(along, 6.0)) * shape * uPower * 3.0;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const PLASMA_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vN;
varying vec3 vView;
varying vec3 vLocal;
void main() {
  vLocal = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;
const PLASMA_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${NOISE}
uniform float uTime;
uniform float uIntensity;  // 0..1
uniform vec3 uFlow;        // airflow direction in ship-local space
varying vec3 vN;
varying vec3 vView;
varying vec3 vLocal;
void main() {
  #include <logdepthbuf_fragment>
  float rim = pow(1.0 - abs(dot(vN, vView)), 1.5);
  float front = smoothstep(-0.4, 0.9, dot(normalize(vLocal), -uFlow));
  float n = fbm(vLocal * 0.6 + uFlow * uTime * 9.0, 4);
  float a = (rim * 0.9 + 0.25) * front * (0.55 + 0.9 * n) * uIntensity;
  vec3 hot = mix(vec3(1.0, 0.45, 0.25), vec3(1.0, 0.85, 0.95), smoothstep(0.5, 1.0, uIntensity));
  gl_FragColor = vec4(hot * a * 2.4, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class ShipModel {
  constructor(envMap) {
    const M = (this.mats = mats(envMap));
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    const add = (geo, mat, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.body.add(m);
      return m;
    };

    // Fuselage: lathe profile along the ship's length, flattened.
    const prof = [];
    const pts = [[0, -7.4], [0.25, -7.1], [0.6, -6.2], [0.95, -4.6], [1.2, -2.5], [1.3, 0], [1.25, 2.5], [1.05, 4.4], [0.7, 5.6], [0, 5.9]];
    for (const [r, z] of pts) prof.push(new THREE.Vector2(r, z));
    const fus = new THREE.LatheGeometry(prof, 40);
    fus.rotateX(Math.PI / 2);   // lathe axis Y → Z
    add(fus, M.hull).scale.set(1.25, 0.72, 1);
    // Dorsal spine + orange stripe.
    add(new THREE.BoxGeometry(0.5, 0.35, 7.5), M.accent, 0, 0.92, 1.0);
    add(new THREE.BoxGeometry(1.65, 0.06, 2.2), M.accent, 0, 0.62, -5.0).rotation.x = 0.12;
    // Canopy.
    const canopy = add(new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), M.glass, 0, 0.55, -2.6);
    canopy.scale.set(0.72, 0.62, 1.9);
    // Intakes under the nose.
    add(new THREE.BoxGeometry(2.1, 0.45, 2.4), M.dark, 0, -0.55, -1.2);

    // Wings with a slight anhedral, accent tips.
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(wingGeometry(5.0, 4.6, 1.5, 2.6, 0.22), M.hull);
      wing.castShadow = wing.receiveShadow = true;
      wing.scale.x = side;
      wing.position.set(side * 0.9, -0.15, 0.4);
      wing.rotation.z = side * -0.06;
      this.body.add(wing);
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.5, 1.7), M.accent);
      tip.position.set(side * 5.85, -0.05, 2.3);
      tip.castShadow = true;
      this.body.add(tip);
    }

    // Twin engines with nozzles.
    this.nozzles = [];
    for (const side of [-1, 1]) {
      const pod = add(new THREE.CylinderGeometry(0.62, 0.7, 4.8, 24), M.dark, side * 1.95, -0.05, 2.6);
      pod.rotation.x = Math.PI / 2;
      const ring = add(new THREE.TorusGeometry(0.66, 0.08, 10, 28), M.accent, side * 1.95, -0.05, 0.25);
      ring.rotation.x = 0;
      const noz = add(new THREE.CylinderGeometry(0.55, 0.42, 0.7, 24, 1, true), M.nozzle, side * 1.95, -0.05, 5.3);
      noz.rotation.x = Math.PI / 2;
      noz.material = M.nozzle;
      const glow = add(new THREE.CircleGeometry(0.44, 24), new THREE.MeshBasicMaterial({ color: 0xffa060 }), side * 1.95, -0.05, 5.5);
      glow.castShadow = false;
      this.nozzles.push(glow);
    }
    // Tail fins.
    for (const side of [-1, 1]) {
      const s = new THREE.Shape();
      s.moveTo(0, 0); s.lineTo(1.9, 0); s.lineTo(2.9, 2.2); s.lineTo(1.9, 2.2); s.closePath();
      const fin = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.14, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 1 }), M.hull);
      fin.rotation.y = -Math.PI / 2;
      fin.position.set(side * 0.95, 0.45, 2.6);
      fin.rotation.z = side * 0.28;
      fin.castShadow = true;
      this.body.add(fin);
    }

    // Landing gear (three legs).
    this.gear = [];
    for (const [x, z] of [[0, -4.2], [-2.1, 2.6], [2.1, 2.6]]) {
      const leg = new THREE.Group();
      leg.position.set(x, -0.6, z);
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 1.5, 10), M.gear);
      strut.position.y = -0.75;
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 0.12, 16), M.dark);
      pad.position.y = -1.5;
      strut.castShadow = pad.castShadow = true;
      leg.add(strut, pad);
      this.body.add(leg);
      this.gear.push(leg);
    }
    this.gearExtend = 0;

    // Navigation lights.
    this.navLights = [];
    for (const [x, y, z, color] of [[-5.9, 0, 1.6, 0xff2a2a], [5.9, 0, 1.6, 0x2aff5a], [0, 1.2, 5.2, 0xffffff]]) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color }));
      l.position.set(x, y, z);
      this.body.add(l);
      this.navLights.push(l);
    }

    // Exhaust plumes (open cones pointing backwards).
    this.plumeMat = new THREE.ShaderMaterial({
      vertexShader: PLUME_VERT,
      fragmentShader: PLUME_FRAG,
      uniforms: { uTime: { value: 0 }, uPower: { value: 0 }, uColor: { value: new THREE.Color(1.0, 0.55, 0.25) } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.plumes = [];
    for (const side of [-1, 1]) {
      const g = new THREE.CylinderGeometry(0.42, 0.05, 1, 20, 1, true);
      g.translate(0, -0.5, 0);
      g.rotateX(-Math.PI / 2); // tip towards +Z (behind the ship)
      const p = new THREE.Mesh(g, this.plumeMat);
      p.position.set(side * 1.95, -0.05, 5.6);
      p.frustumCulled = false;
      this.body.add(p);
      this.plumes.push(p);
    }

    // Plasma sheath for atmospheric entry.
    this.plasmaMat = new THREE.ShaderMaterial({
      vertexShader: PLASMA_VERT,
      fragmentShader: PLASMA_FRAG,
      uniforms: { uTime: { value: 0 }, uIntensity: { value: 0 }, uFlow: { value: new THREE.Vector3(0, 0, 1) } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.plasma = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), this.plasmaMat);
    this.plasma.scale.set(8.5, 4.5, 11);
    this.plasma.visible = false;
    this.root.add(this.plasma);

    this.time = 0;
  }

  /**
   * state: { thrust (0..1 main), lift, pulse (bool), gearDown (bool), heat (0..1 plasma),
   *          flowLocal (Vector3 airflow dir in ship space), shake (m), dt }
   */
  update(state) {
    this.time += state.dt;
    const t = this.time;
    // Gear.
    const target = state.gearDown ? 1 : 0;
    this.gearExtend += (target - this.gearExtend) * Math.min(1, state.dt * 3);
    for (const leg of this.gear) {
      leg.scale.y = 0.05 + 0.95 * this.gearExtend;
      leg.visible = this.gearExtend > 0.03;
    }
    // Engines.
    const power = state.pulse ? 1.6 : Math.max(0, state.thrust) * (state.boost ? 1.5 : 1) + 0.12;
    this.plumeMat.uniforms.uTime.value = t;
    this.plumeMat.uniforms.uPower.value = power;
    this.plumeMat.uniforms.uColor.value.set(state.pulse ? 0x7fb4ff : state.boost ? 0xffb070 : 0xff7a3a);
    const len = state.pulse ? 26 : 1.5 + 9 * Math.max(0, state.thrust) * (state.boost ? 1.6 : 1);
    for (const p of this.plumes) p.scale.set(1, 1, len);
    this.mats.nozzle.emissiveIntensity = 0.4 + power * 1.8;
    this.mats.nozzle.emissive.set(state.pulse ? 0x6fa8ff : 0xff7a2a);
    for (const n of this.nozzles) n.material.color.set(state.pulse ? 0xbfe0ff : 0xffb070).multiplyScalar(0.6 + power);
    // Nav lights blink.
    this.navLights[0].visible = this.navLights[1].visible = Math.sin(t * 3) > -0.6;
    this.navLights[2].visible = (t % 1.4) < 0.08;
    // Plasma.
    const heat = state.heat || 0;
    this.plasma.visible = heat > 0.02;
    if (this.plasma.visible) {
      this.plasmaMat.uniforms.uTime.value = t;
      this.plasmaMat.uniforms.uIntensity.value = Math.min(1, heat);
      if (state.flowLocal) this.plasmaMat.uniforms.uFlow.value.copy(state.flowLocal).normalize();
    }
    // Buffeting.
    const s = state.shake || 0;
    this.body.position.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s * 0.5);
  }
}
