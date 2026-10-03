// =============================================================================
// engine.js — the WebGL renderer, a fixed 1080p render resolution, and the
// quality governor that keeps the frame rate at or above 30 fps.
//
// The governor never touches resolution (always 1080p, 720p on phones) or terrain detail.
// It only trades shadow quality, atmosphere ray-march samples, cloud and
// particle effects, in that order.
// =============================================================================
import * as THREE from 'three';

// Fixed 1080p; phones get a fixed 720p, which is still sharp on a 6-inch
// screen and leaves their GPUs room for 30 fps. (`?rh=540` overrides it for
// automated tests on software GPUs.)
const RH_PARAM = Number(new URLSearchParams(globalThis.location?.search || '').get('rh'));
const PHONE = !!globalThis.matchMedia?.('(pointer: coarse)').matches && Math.min(globalThis.screen?.width || 9999, globalThis.screen?.height || 9999) < 600;
export const RENDER_HEIGHT = RH_PARAM >= 240 && RH_PARAM <= 2160 ? RH_PARAM : PHONE ? 720 : 1080;

// Quality tiers, best first. The governor moves down one tier at a time.
// `flora` scales plant density where there are plants (Proxima b).
export const QUALITY_TIERS = [
  { name: 'Ultra', shadowMap: 4096, shadows: true, atmoSteps: 12, atmoLightSteps: 5, particles: 1.0, glow: 1 },
  { name: 'High', shadowMap: 2048, shadows: true, atmoSteps: 10, atmoLightSteps: 4, particles: 1.0, glow: 1 },
  { name: 'Medium', shadowMap: 2048, shadows: true, atmoSteps: 8, atmoLightSteps: 3, particles: 0.7, glow: 1 },
  { name: 'Low', shadowMap: 1024, shadows: true, atmoSteps: 6, atmoLightSteps: 2, particles: 0.5, glow: 0.8 },
  { name: 'Minimum', shadowMap: 1024, shadows: false, atmoSteps: 5, atmoLightSteps: 2, particles: 0.3, glow: 0.7 },
];

// Proxima b: a 25 fps floor, and the headroom spent on looks. "Medium+" is a
// medium budget with sharper shadows, a richer sky and denser plants.
export const PROXIMA_TIERS = [
  { name: 'Medium+', shadowMap: 4096, shadows: true, atmoSteps: 12, atmoLightSteps: 5, particles: 1.0, glow: 1, flora: 1.35 },
  { name: 'Medium', shadowMap: 2048, shadows: true, atmoSteps: 9, atmoLightSteps: 3, particles: 0.8, glow: 1, flora: 1.0 },
  { name: 'Low', shadowMap: 1024, shadows: true, atmoSteps: 6, atmoLightSteps: 2, particles: 0.5, glow: 0.8, flora: 0.7 },
  { name: 'Minimum', shadowMap: 1024, shadows: false, atmoSteps: 5, atmoLightSteps: 2, particles: 0.3, glow: 0.7, flora: 0.45 },
];

export class Engine {
  /** opts: { minFps (30), tiers, startTier } */
  constructor(container, opts = {}) {
    this.minFps = opts.minFps ?? 30;
    this.tiers = opts.tiers ?? QUALITY_TIERS;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      logarithmicDepthBuffer: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(r.domElement);
    this.canvas = r.domElement;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 1e15);
    this.scene.add(this.camera);

    this.tierIndex = opts.startTier ?? 1;
    this.quality = { flora: 1, ...this.tiers[this.tierIndex] };
    this.frameTimes = [];
    this.lastTierChange = 0;
    this.fps = 60;
    this.onQualityChange = null;

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** Fixed resolution: the drawing buffer is always RENDER_HEIGHT pixels tall. */
  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(RENDER_HEIGHT / Math.max(h, 1));
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.bufferWidth = Math.round(w * (RENDER_HEIGHT / h));
    this.bufferHeight = RENDER_HEIGHT;
  }

  /** Pixels per radian at the screen centre (for apparent-size maths). */
  get pixelScale() {
    return this.bufferHeight / 2 / Math.tan((this.camera.fov * Math.PI) / 360);
  }

  /** Track frame time and step quality down (or back up) to hold ≥ 30 fps. */
  governQuality(frameMs, now) {
    this.frameTimes.push(frameMs);
    if (this.frameTimes.length > 90) this.frameTimes.shift();
    if (this.frameTimes.length < 45 || now - this.lastTierChange < 3) return;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const p80 = sorted[Math.floor(sorted.length * 0.8)];
    this.fps = 1000 / (sorted[Math.floor(sorted.length / 2)] || 16);
    let next = this.tierIndex;
    // Drop a tier when the slow frames are near the floor (30 fps → 34, 25 fps → 28);
    // raise it again with plenty of headroom.
    const dropAt = 1000 / (this.minFps * 1.13), raiseAt = 1000 / (this.minFps * 1.8);
    if (p80 > dropAt && this.tierIndex < this.tiers.length - 1) next++;
    else if (p80 < raiseAt && this.tierIndex > 0) next--;
    if (next !== this.tierIndex) {
      this.setTier(next);
      this.lastTierChange = now;
      this.frameTimes.length = 0;
    }
  }

  setTier(i) {
    this.tierIndex = i;
    Object.assign(this.quality, { flora: 1 }, this.tiers[i]);
    this.onQualityChange?.(this.quality);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
