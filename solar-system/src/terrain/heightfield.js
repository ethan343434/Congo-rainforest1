// =============================================================================
// heightfield.js — the exact shape of a solid world's surface.
//
// One pure function gives the terrain height (metres above the reference
// ellipsoid) for any direction from the body's centre. The same code runs in
// the terrain workers (to build meshes) and on the main thread (for landing
// gear, footsteps and collisions), so what you see is exactly what you stand on.
//
// Layers, largest first:
//   1. The real global elevation map (LOLA for the Moon, MOLA for Mars, …),
//      sampled with bicubic interpolation so the 8-bit data stays smooth.
//   2. Crater fields: up to ~15 octaves, from kilometres down to about a
//      metre, with a realistic size–frequency distribution (each halving of
//      size has four times as many craters), bowl/rim/ejecta profiles, flat
//      floors and central peaks above the simple-to-complex transition, and
//      random degradation (old craters are shallow and soft).
//   3. Rolling fractal relief with a 1/f spectrum.
//   4. Per-world features: dunes (Mars, Titan), ice ridges (Europa,
//      Enceladus), grooves (Ganymede, Phobos), calderas (Io), "cantaloupe"
//      dimples (Triton), fault cliffs (Miranda), Iapetus' equatorial ridge and
//      Mimas' Herschel crater.
//
// Detail is band-limited: features smaller than a mesh can show are left out
// of that mesh (`spacing`), and physics uses the finest band, which is what
// the mesh under your feet always contains.
// =============================================================================

const TAU = Math.PI * 2;
const INV_U32 = 1 / 4294967296;

/** Integer lattice hash → uint32 (well mixed). */
function hash3(x, y, z, seed) {
  let h = (Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f) ^ seed) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Smooth 3D value noise in [-1, 1]. */
function vnoise(x, y, z, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = hash3(ix, iy, iz, seed) * INV_U32, b = hash3(ix + 1, iy, iz, seed) * INV_U32;
  const c = hash3(ix, iy + 1, iz, seed) * INV_U32, d = hash3(ix + 1, iy + 1, iz, seed) * INV_U32;
  const e = hash3(ix, iy, iz + 1, seed) * INV_U32, f = hash3(ix + 1, iy, iz + 1, seed) * INV_U32;
  const g = hash3(ix, iy + 1, iz + 1, seed) * INV_U32, h = hash3(ix + 1, iy + 1, iz + 1, seed) * INV_U32;
  const x1 = a + (b - a) * ux, x2 = c + (d - c) * ux, x3 = e + (f - e) * ux, x4 = g + (h - g) * ux;
  const y1 = x1 + (x2 - x1) * uy, y2 = x3 + (x4 - x3) * uy;
  return (y1 + (y2 - y1) * uz) * 2 - 1;
}

function seedOf(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h | 0;
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Catmull–Rom weights. */
function cubicW(t, out) {
  const t2 = t * t, t3 = t2 * t;
  out[0] = -0.5 * t3 + t2 - 0.5 * t;
  out[1] = 1.5 * t3 - 2.5 * t2 + 1;
  out[2] = -1.5 * t3 + 2 * t2 + 0.5 * t;
  out[3] = 0.5 * t3 - 0.5 * t2;
}

/**
 * Build a height sampler for one body.
 * params: { id, radius, gravity, terrain (definition from bodies.js),
 *           heightmap: { width, height, data (0..1) } | null }
 */
export function createHeightfield(params) {
  const T = params.terrain || {};
  const R = params.radius;
  const seed = seedOf(params.id);
  const hm = params.heightmap && T.heightmap ? params.heightmap : null;
  const hmScale = T.heightmap ? T.heightmap.scale : 0;
  // Without an explicit datum, centre the map on its mean so "altitude" is
  // measured from the average surface.
  let hmOffset = T.heightmap ? T.heightmap.offset : 0;
  if (hm && hmOffset === undefined) {
    let sum = 0;
    for (let i = 0; i < hm.data.length; i += 7) sum += hm.data[i];
    hmOffset = -(sum / Math.ceil(hm.data.length / 7)) * hmScale;
  }
  const wx = new Float64Array(4), wy = new Float64Array(4);

  // ---- Crater octaves ----
  const cr = T.craters && T.craters.density > 0 ? T.craters : null;
  const octaves = [];
  if (cr) {
    // Simple-to-complex transition scales inversely with gravity (Moon ≈ 7.5 km radius).
    const transition = 7500 * (1.62 / Math.max(params.gravity, 0.01));
    for (let r = cr.maxRadius, k = 0; r >= cr.minRadius && k < 18; r /= 2, k++) {
      octaves.push({ r, cell: r * 4, density: cr.density, depth: cr.depth, transition, seed: seed + k * 7919, rim: true });
    }
  }
  if (T.calderas) octaves.push({ r: 30000, cell: 120000, density: 0.35, depth: 0.35, transition: 1e3, seed: seed ^ 0x51ed, rim: false, flat: 0.8 });
  if (T.cantaloupe) octaves.push({ r: 16000, cell: 64000, density: 0.95, depth: 0.05, transition: 1e9, seed: seed ^ 0x2bad, rim: false });

  // A single named giant crater (Mimas' Herschel).
  let big = null;
  if (T.bigCrater) {
    const la = (T.bigCrater.lat * Math.PI) / 180, lo = (T.bigCrater.lon * Math.PI) / 180;
    big = { x: Math.cos(la) * Math.cos(lo), y: Math.sin(la), z: -Math.cos(la) * Math.sin(lo), r: T.bigCrater.radius, depth: T.bigCrater.depth };
  }
  const groove = T.grooves ? { spacing: 40 * Math.cbrt(R), amp: 1.4 * Math.cbrt(R) } : null;
  const maxH = estimateRange();

  /** Global elevation map, bicubic. */
  function heightmapAt(x, y, z) {
    const lon = Math.atan2(-z, x);
    const lat = Math.asin(Math.max(-1, Math.min(1, y)));
    const W = hm.width, H = hm.height, d = hm.data;
    const px = (0.5 + lon / TAU) * W - 0.5;
    const py = (0.5 - lat / Math.PI) * H - 0.5;
    const ix = Math.floor(px), iy = Math.floor(py);
    cubicW(px - ix, wx);
    cubicW(py - iy, wy);
    let s = 0;
    for (let j = 0; j < 4; j++) {
      const yy = Math.min(H - 1, Math.max(0, iy - 1 + j)) * W;
      let row = 0;
      for (let i = 0; i < 4; i++) {
        let xx = (ix - 1 + i) % W;
        if (xx < 0) xx += W;
        row += d[yy + xx] * wx[i];
      }
      s += row * wy[j];
    }
    return s * hmScale + hmOffset;
  }

  /**
   * Height of a crater (relative to the surface it hit) at normalised
   * distance x = d / r. Fresh simple craters: depth ≈ 0.2 × diameter, rim
   * ≈ 0.04 × diameter, ejecta fading out at two radii.
   */
  function craterProfile(x, r, o, fresh) {
    const complex = r > o.transition;
    const depthRatio = complex ? 0.4 * Math.pow(o.transition / r, 0.55) : 0.4;
    const depth = r * depthRatio * o.depth * fresh;
    const rimH = o.rim ? r * 0.08 * o.depth * fresh * (complex ? 0.7 : 1) : 0;
    const floor = rimH - depth;
    if (x < 1) {
      let h = floor + (rimH - floor) * x * x;
      const flat = o.flat ?? (complex ? Math.min(0.6, 0.25 + 0.1 * Math.log2(r / o.transition + 1)) : 0);
      if (flat > 0) {
        const fh = floor + (rimH - floor) * flat * flat;
        // Smooth maximum between bowl and flat floor.
        const k = depth * 0.08 + 1e-6;
        const m = Math.max(h, fh);
        h = m + k * Math.log(Math.exp((h - m) / k) + Math.exp((fh - m) / k)) - k * Math.LN2 * 0.5;
        if (complex && o.rim) h += depth * 0.35 * Math.exp(-((x / 0.16) ** 2)); // central peak
      }
      return h;
    }
    if (!o.rim) return 0;
    if (x >= 2) return 0;
    return rimH * ((1 / (x * x * x)) - 0.125) / 0.875;
  }

  /** All craters of one octave touching point p (on the sphere, radius R). */
  function craterOctave(px, py, pz, o) {
    const cell = o.cell;
    const gx = px / cell, gy = py / cell, gz = pz / cell;
    const ix = Math.floor(gx), iy = Math.floor(gy), iz = Math.floor(gz);
    let h = 0;
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        for (let c = -1; c <= 1; c++) {
          const cx = ix + a, cy = iy + b, cz = iz + c;
          const h0 = hash3(cx, cy, cz, o.seed);
          if ((h0 & 0xffff) / 65536 > o.density) continue;
          // Crater centre: a random point in the cell, kept only if it lies
          // near the surface, then projected onto it.
          const qx = (cx + hash3(cx, cy, cz, o.seed ^ 0x68e31da4) * INV_U32) * cell;
          const qy = (cy + hash3(cx, cy, cz, o.seed ^ 0x1b56c4e9) * INV_U32) * cell;
          const qz = (cz + hash3(cx, cy, cz, o.seed ^ 0x2f2a5d71) * INV_U32) * cell;
          const ql = Math.sqrt(qx * qx + qy * qy + qz * qz);
          if (Math.abs(ql - R) > cell * 0.5) continue;
          const s = R / ql;
          const dx = px - qx * s, dy = py - qy * s, dz = pz - qz * s;
          const d2 = dx * dx + dy * dy + dz * dz;
          const u = (h0 >>> 16) / 65536;
          const r = o.r * (0.5 + 0.5 * u);
          if (d2 >= 4 * r * r) continue;
          const fresh = 0.22 + 0.78 * Math.pow(hash3(cx, cy, cz, o.seed ^ 0x7a3c) * INV_U32, 1.6);
          h += craterProfile(Math.sqrt(d2) / r, r, o, fresh);
        }
      }
    }
    return h;
  }

  /** fBm in metres: amplitude amp at wavelength scale, halving down to minScale. */
  function fbm(px, py, pz, amp, scale, minScale, s) {
    let h = 0, a = amp, f = 1 / scale;
    for (let k = 0; k < 20 && 1 / f >= minScale; k++) {
      h += a * vnoise(px * f, py * f, pz * f, s + k * 131);
      a *= 0.5; f *= 2;
    }
    return h;
  }

  function ridged(px, py, pz, amp, scale, minScale, s) {
    let h = 0, a = amp, f = 1 / scale;
    for (let k = 0; k < 12 && 1 / f >= minScale; k++) {
      const n = 1 - Math.abs(vnoise(px * f, py * f, pz * f, s + k * 977));
      h += a * n * n;
      a *= 0.45; f *= 2.1;
    }
    return h - amp * 0.35;
  }

  /**
   * Height (m) above the reference ellipsoid in local direction (x, y, z)
   * (unit vector). spacing = mesh vertex spacing in metres: features
   * smaller than ~2.5 × spacing are left out (band limit).
   */
  function height(x, y, z, spacing = 0.5) {
    const px = x * R, py = y * R, pz = z * R;
    let h = 0;
    if (hm) h += heightmapAt(x, y, z);
    const minFeature = spacing * 2.5;
    if (T.noise) {
      let n = fbm(px, py, pz, T.noise.amp, T.noise.scale, minFeature, seed ^ 0x1234);
      if (T.cliffs) {
        // Fault-block terrain: terraces with steep risers (Miranda's Verona Rupes).
        const step = T.noise.amp * 0.55;
        const q = n / step, fl = Math.floor(q);
        n = (fl + smoothstep(0.82, 1, q - fl)) * step * 1.4;
      }
      h += n;
    }
    // Eyeball worlds (tidally locked; the star is over local +X): sand seas on
    // the day side, wind-carved ice ridges on the night side.
    const dayW = T.eyeball ? smoothstep(0.25, 0.6, x) : 1;
    const nightW = T.eyeball ? smoothstep(-0.1, -0.45, x) : 1;
    if (T.ridges) h += ridged(px, py, pz, T.ridges.amp, T.ridges.scale, minFeature, seed ^ 0x777) * (T.eyeball ? 0.35 + 0.65 * nightW : 1);
    for (const o of octaves) {
      if (o.r < minFeature) break;
      h += craterOctave(px, py, pz, o);
    }
    if (big) {
      const dx = x - big.x, dy = y - big.y, dz = z - big.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) * R;
      if (d < big.r * 2) h += craterProfile(d / big.r, big.r, { transition: big.r * 0.3, depth: big.depth / (big.r * 0.4 * Math.pow(0.3, 0.55)), rim: true }, 1);
    }
    if (T.dunes && T.dunes.wavelength >= minFeature) {
      const w = T.dunes.wavelength;
      const mask = smoothstep(0.1, 0.5, vnoise(px / (w * 40), py / (w * 40), pz / (w * 40), seed ^ 0xd00e));
      if (mask > 0) {
        const warp = vnoise(px / (w * 6), py / (w * 6), pz / (w * 6), seed ^ 0xbeef) * 2.2;
        const phase = ((px * 0.8 + pz * 0.6) / w) * TAU + warp;
        const s = 0.5 + 0.5 * Math.sin(phase + 0.7 * Math.sin(phase));
        h += T.dunes.amp * mask * s * s * (T.eyeball ? dayW * 1.6 : 1);
      }
    }
    if (groove && groove.spacing >= minFeature) {
      const ph = (px * 0.36 + py * 0.48 + pz * 0.8) / groove.spacing;
      const fr = ph - Math.floor(ph);
      const mask = smoothstep(-0.2, 0.4, vnoise(px / (groove.spacing * 12), py / (groove.spacing * 12), pz / (groove.spacing * 12), seed ^ 0x9999));
      h -= groove.amp * mask * Math.exp(-(((fr - 0.5) / 0.12) ** 2));
    }
    if (T.ridge) {
      // Iapetus' equatorial ridge.
      const lat = Math.asin(Math.max(-1, Math.min(1, y)));
      h += T.ridge.amp * Math.exp(-((lat / T.ridge.width) ** 2)) * (0.75 + 0.25 * vnoise(px / 80000, py / 80000, pz / 80000, seed));
    }
    if (T.rocks && minFeature < 3) {
      // Regolith micro-relief: small lumps and pits under your boots.
      h += 0.06 * vnoise(px / 1.3, py / 1.3, pz / 1.3, seed ^ 0x4242) + 0.025 * vnoise(px / 0.45, py / 0.45, pz / 0.45, seed ^ 0x4343);
    }
    return h;
  }

  /** Rough bound on |height| for culling (metres). */
  function estimateRange() {
    let m = 50;
    if (T.heightmap) m += T.heightmap.scale * 0.6 + Math.abs(T.heightmap.offset || 0) * 0.3;
    if (T.noise) m += T.noise.amp * 2;
    if (T.ridges) m += T.ridges.amp * 1.5;
    if (cr) m += cr.maxRadius * 0.45 * cr.depth;
    if (T.ridge) m += T.ridge.amp;
    if (big) m += big.depth;
    if (T.dunes) m += T.dunes.amp;
    if (T.calderas) m += 4000;
    return m;
  }

  return { height, maxHeight: maxH, radius: R, seed };
}

/** Deterministic 0..1 random for an integer triple (shared with rock placement). */
export function rand3(x, y, z, seed) {
  return hash3(x, y, z, seed) * INV_U32;
}
