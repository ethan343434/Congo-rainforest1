// =============================================================================
// dayNight.js — the clock, sun/moon, sky and fog.
//
// Time runs 0..1 per day (0 = midnight, 0.5 = noon). Even at noon the canopy
// keeps the forest shadowy, so the flashlight always matters; at night the
// world beyond the flashlight cone is close to black.
// =============================================================================
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { lerp, smoothstep } from './utils.js';
import { MATS } from './models.js';

// Keyframes: t, fog/sky colour, hemisphere intensity, sun intensity, sun colour, fog near/far
const KEYS = [
  { t: 0.0, fog: 0x020306, hemi: 0.05, sun: 0.05, sunCol: 0x6f86c8, near: 1, far: 30 },
  { t: 0.21, fog: 0x030407, hemi: 0.05, sun: 0.05, sunCol: 0x6f86c8, near: 1, far: 30 },
  { t: 0.26, fog: 0x2a2724, hemi: 0.3, sun: 0.35, sunCol: 0xff9a5a, near: 2, far: 42 },
  { t: 0.33, fog: 0x3f4a3c, hemi: 0.75, sun: 1.0, sunCol: 0xffd8a0, near: 3, far: 58 },
  { t: 0.5, fog: 0x51624d, hemi: 0.85, sun: 1.3, sunCol: 0xfff2d8, near: 4, far: 66 },
  { t: 0.67, fog: 0x45503c, hemi: 0.8, sun: 1.1, sunCol: 0xffd090, near: 3, far: 58 },
  { t: 0.74, fog: 0x33261d, hemi: 0.35, sun: 0.4, sunCol: 0xff7a40, near: 2, far: 42 },
  { t: 0.79, fog: 0x030407, hemi: 0.05, sun: 0.05, sunCol: 0x6f86c8, near: 1, far: 30 },
  { t: 1.0, fog: 0x020306, hemi: 0.05, sun: 0.05, sunCol: 0x6f86c8, near: 1, far: 30 },
];

export class DayNight {
  constructor(scene) {
    this.scene = scene;
    this.time = CONFIG.time.startTime;
    this.day = 1;
    this.fog = new THREE.Fog(0x000000, 2, 60);
    scene.fog = this.fog;
    scene.background = new THREE.Color();
    this.hemi = new THREE.HemisphereLight(0x9ab8a0, 0x2a2016, 0.5);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    scene.add(this.sun);
    scene.add(this.sun.target);
    this.darkness = 0;
    this._a = new THREE.Color();
    this._b = new THREE.Color();
  }

  advance(seconds) {
    this.time += seconds / CONFIG.time.dayLengthSeconds;
    while (this.time >= 1) {
      this.time -= 1;
      this.day++;
    }
  }

  /** Skip forward by a fraction of a day (used as the death penalty). */
  skip(fraction) {
    this.advance(fraction * CONFIG.time.dayLengthSeconds);
  }

  get isNight() {
    return this.darkness > 0.6;
  }

  get clockText() {
    const minutes = Math.floor(this.time * 24 * 60);
    const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
    const mm = String(minutes % 60).padStart(2, '0');
    return `Day ${this.day} · ${hh}:${mm}`;
  }

  update(dt, center) {
    this.advance(dt);
    let i = 0;
    while (i < KEYS.length - 2 && this.time > KEYS[i + 1].t) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    const f = smoothstep(0, 1, (this.time - a.t) / (b.t - a.t));

    const fogCol = this._a.set(a.fog).lerp(this._b.set(b.fog), f);
    this.fog.color.copy(fogCol);
    this.scene.background.copy(fogCol);
    this.fog.near = lerp(a.near, b.near, f);
    this.fog.far = lerp(a.far, b.far, f);
    this.hemi.intensity = lerp(a.hemi, b.hemi, f);
    this.sun.intensity = lerp(a.sun, b.sun, f);
    this.sun.color.set(a.sunCol).lerp(this._b.set(b.sunCol), f);

    // Sun arcs east -> west; at night the same light plays a dim blue moon.
    const ang = (this.time - 0.25) * Math.PI * 2;
    const dayArc = Math.sin(ang) > 0;
    const elev = dayArc ? Math.sin(ang) : 0.6;
    this.sun.position.set(center.x + Math.cos(ang) * 60, center.y + 20 + elev * 80, center.z + 25);
    this.sun.target.position.copy(center);

    this.darkness = 1 - Math.min(1, this.hemi.intensity / 0.75);
    // Eyeshine: animal eyes catch the light once it gets dark.
    const glow = smoothstep(0.35, 0.85, this.darkness);
    MATS.eyeshine.color.setRGB(0.07 + glow * 0.75, 0.07 + glow * 0.9, 0.05 + glow * 0.35);
    MATS.eyeshineRed.color.setRGB(0.08 + glow * 0.95, 0.05 + glow * 0.3, 0.03 + glow * 0.05);
  }
}
