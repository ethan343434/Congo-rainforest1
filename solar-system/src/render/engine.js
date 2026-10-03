// =============================================================================
// engine.js — the WebGL renderer, a fixed 1080p render resolution, and the
// quality governor that keeps the frame rate at or above 30 fps.
//
// The governor never touches resolution (always 1080p) or terrain detail.
// It only trades shadow quality, atmosphere ray-march samples, cloud and
// particle effects, in that order.
// =============================================================================
import * as THREE from 'three';

// Fixed 1080p. (`?rh=540` overrides it for automated tests on software GPUs.)
const RH_PARAM = Number(new URLSearchParams(globalThis.location?.search || '').get('rh'));
export const RENDER_HEIGHT = RH_PARAM >= 240 && RH_PARAM <= 2160 ? RH_PARAM : 1080;

// Quality tiers, best first. The governor moves down one tier at a time.
export const QUALITY_TIERS = [
  { name: 'Ultra', shadowMap: 4096, shadows: true, atmoSteps: 12, atmoLightSteps: 5, particles: 1.0, glow: 1 },
  { name: 'High', shadowMap: 2048, shadows: true, atmoSteps: 10, atmoLightSteps: 4, particles: 1.0, glow: 1 },
  { name: 'Medium', shadowMap: 2048, shadows: true, atmoSteps: 8, atmoLightSteps: 3, particles: 0.7, glow: 1 },
  { name: 'Low', shadowMap: 1024, shadows: true, atmoSteps: 6, atmoLightSteps: 2, particles: 0.5, glow: 0.8 },
  { name: 'Minimum', shadowMap: 1024, shadows: false, atmoSteps: 5, atmoLightSteps: 2, particles: 0.3, glow: 0.7 },
];

export class Engine {
  constructor(container) {
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

    this.tierIndex = 1;
    this.quality = { ...QUALITY_TIERS[this.tierIndex] };
    this.frameTimes = [];
    this.lastTierChange = 0;
    this.fps = 60;
    this.onQualityChange = null;

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** Fixed 1080p: the drawing buffer is always 1080 pixels tall. */
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
    if (p80 > 1000 / 34 && this.tierIndex < QUALITY_TIERS.length - 1) next++; // slower than ~34 fps: drop
    else if (p80 < 1000 / 55 && this.tierIndex > 0) next--;                   // plenty of headroom: raise
    if (next !== this.tierIndex) {
      this.setTier(next);
      this.lastTierChange = now;
      this.frameTimes.length = 0;
    }
  }

  setTier(i) {
    this.tierIndex = i;
    Object.assign(this.quality, QUALITY_TIERS[i]);
    this.onQualityChange?.(this.quality);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
