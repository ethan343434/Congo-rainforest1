// =============================================================================
// assets.js — loads textures (with caching and progress reporting) and
// decodes height maps into Float32 grids for the terrain generator.
// =============================================================================
import * as THREE from 'three';

export class Assets {
  constructor(renderer, base = 'textures/') {
    this.renderer = renderer;
    this.base = base;
    this.loader = new THREE.TextureLoader();
    this.cache = new Map();
    this.heightCache = new Map();
    this.maxAniso = renderer.capabilities.getMaxAnisotropy();
    this.onProgress = null;
    this.loaded = 0;
    this.requested = 0;
  }

  texture(file, { srgb = true, wrap = true } = {}) {
    const key = `${file}|${srgb}`;
    if (this.cache.has(key)) return this.cache.get(key);
    this.requested++;
    const p = new Promise((resolve, reject) => {
      this.loader.load(
        this.base + file,
        (tex) => {
          tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          tex.anisotropy = Math.min(8, this.maxAniso);
          if (wrap) tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.ClampToEdgeWrapping;
          tex.generateMipmaps = true;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          this.loaded++;
          this.onProgress?.(this.loaded, this.requested, file);
          resolve(tex);
        },
        undefined,
        (err) => {
          this.loaded++;
          this.onProgress?.(this.loaded, this.requested, file);
          reject(new Error(`Could not load ${file}`));
        },
      );
    });
    this.cache.set(key, p);
    return p;
  }

  /** Decode an image's luminance (or alpha) channel into a Float32Array (0..1). */
  heightData(file, { channel = 'luminance' } = {}) {
    const key = `${file}|${channel}`;
    if (this.heightCache.has(key)) return this.heightCache.get(key);
    const p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0);
        const px = g.getImageData(0, 0, c.width, c.height).data;
        const data = new Float32Array(c.width * c.height);
        for (let i = 0; i < data.length; i++) {
          if (channel === 'alpha') data[i] = px[i * 4 + 3] / 255;
          else data[i] = (px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114) / 255;
        }
        resolve({ width: c.width, height: c.height, data });
      };
      img.onerror = () => reject(new Error(`Could not load ${file}`));
      img.src = this.base + file;
    });
    this.heightCache.set(key, p);
    return p;
  }
}
