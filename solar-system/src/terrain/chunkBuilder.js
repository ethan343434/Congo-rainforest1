// =============================================================================
// chunkBuilder.js — turns one quadtree tile of a cube-sphere into mesh data.
//
// The planet is a cube whose six faces are bent onto the sphere (with a
// tangent warp so tiles are nearly equal in size). Each face is split into a
// quadtree; every tile is a 33 × 33 vertex grid plus "skirts" that hang down
// along its edges to hide cracks where neighbouring tiles differ in detail.
//
// Positions are stored relative to the tile's centre so they stay precise in
// 32-bit floats even on a planet thousands of kilometres across. Shared by the
// terrain workers and the main-thread fallback.
// =============================================================================

export const GRID = 32;                 // segments per tile edge
export const VERTS = (GRID + 1) * (GRID + 1);
export const SKIRT_VERTS = GRID * 4;
export const DETAIL_PERIOD = 4096;     // m: wrap for detail-texture coordinates

// Cube faces: normal n, then axes u and v (u × v = n, so triangles face outward).
export const FACES = [
  [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
  [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
  [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
  [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
];

const QUARTER_PI = Math.PI / 4;

/** Unit direction for face coordinates (s, t) in [-1, 1]. */
export function faceDir(face, s, t, out) {
  const [n, u, v] = FACES[face];
  const a = Math.tan(s * QUARTER_PI), b = Math.tan(t * QUARTER_PI);
  const x = n[0] + u[0] * a + v[0] * b;
  const y = n[1] + u[1] * a + v[1] * b;
  const z = n[2] + u[2] * a + v[2] * b;
  const l = Math.sqrt(x * x + y * y + z * z);
  out[0] = x / l; out[1] = y / l; out[2] = z / l;
  return out;
}

/** Inverse: which face and (s, t) a unit direction falls on. */
export function dirToFace(x, y, z) {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  let face;
  if (ax >= ay && ax >= az) face = x > 0 ? 0 : 1;
  else if (ay >= az) face = y > 0 ? 2 : 3;
  else face = z > 0 ? 4 : 5;
  const [n, u, v] = FACES[face];
  const dn = x * n[0] + y * n[1] + z * n[2];
  const a = (x * u[0] + y * u[1] + z * u[2]) / dn;
  const b = (x * v[0] + y * v[1] + z * v[2]) / dn;
  return { face, s: Math.atan(a) / QUARTER_PI, t: Math.atan(b) / QUARTER_PI };
}

/** Radius of the reference ellipsoid in a local direction. */
export function ellipsoidRadius(axes, x, y, z) {
  const a = x / axes[0], b = y / axes[1], c = z / axes[2];
  return 1 / Math.sqrt(a * a + b * b + c * c);
}

/** Arc length of a tile's edge (m) at a quadtree level. */
export function tileEdge(radius, level) {
  return (radius * Math.PI * 0.5) / (1 << level);
}

/**
 * Build one tile. hf = heightfield, axes = ellipsoid semi-axes [x, y, z].
 * Returns typed arrays ready for a BufferGeometry, plus the tile centre
 * (local frame, metres) and its height range.
 */
export function buildChunk(hf, axes, face, level, ix, iy, splitK = 2.4) {
  const N = GRID;
  const E = N + 3;                       // extended grid (one ring outside) for normals
  const size = 2 / (1 << level);
  const s0 = -1 + ix * size, t0 = -1 + iy * size;
  const step = size / N;
  const spacing = tileEdge(hf.radius, level) / N;
  const P = new Float64Array(E * E * 3);
  const D = new Float64Array(E * E * 3);
  const dir = [0, 0, 0];
  let hMin = Infinity, hMax = -Infinity;
  for (let j = 0; j < E; j++) {
    for (let i = 0; i < E; i++) {
      faceDir(face, s0 + (i - 1) * step, t0 + (j - 1) * step, dir);
      const h = hf.height(dir[0], dir[1], dir[2], spacing);
      const r = ellipsoidRadius(axes, dir[0], dir[1], dir[2]) + h;
      const k = (j * E + i) * 3;
      P[k] = dir[0] * r; P[k + 1] = dir[1] * r; P[k + 2] = dir[2] * r;
      D[k] = dir[0]; D[k + 1] = dir[1]; D[k + 2] = dir[2];
      if (i > 0 && j > 0 && i < E - 1 && j < E - 1) {
        if (h < hMin) hMin = h;
        if (h > hMax) hMax = h;
      }
    }
  }
  // Tile centre: the middle vertex.
  const mid = ((N / 2 + 1) * E + (N / 2 + 1)) * 3;
  const cx = P[mid], cy = P[mid + 1], cz = P[mid + 2];
  const total = VERTS + SKIRT_VERTS;
  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const dirs = new Float32Array(total * 3);
  const detail = new Float32Array(total * 3);
  // Geomorphing: each vertex also knows where it would sit with the parent
  // tile's (coarser) detail, and slides there as it nears the distance where
  // the parent takes over, so tile boundaries never show a step.
  const morph = new Float32Array(total * 4);
  const morphStart = splitK * tileEdge(hf.radius, level) * 1.35;
  const ox = mod(cx, DETAIL_PERIOD), oy = mod(cy, DETAIL_PERIOD), oz = mod(cz, DETAIL_PERIOD);

  let v = 0;
  const put = (k, sink) => {
    const o = v * 3;
    position[o] = P[k] - cx; position[o + 1] = P[k + 1] - cy; position[o + 2] = P[k + 2] - cz;
    dirs[o] = D[k]; dirs[o + 1] = D[k + 1]; dirs[o + 2] = D[k + 2];
    detail[o] = ox + position[o]; detail[o + 1] = oy + position[o + 1]; detail[o + 2] = oz + position[o + 2];
    if (sink) {
      position[o] -= D[k] * sink; position[o + 1] -= D[k + 1] * sink; position[o + 2] -= D[k + 2] * sink;
    }
  };
  // Grid vertices with normals from central differences.
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const k = ((j + 1) * E + (i + 1)) * 3;
      put(k, 0);
      {
        const dx = D[k], dy = D[k + 1], dz = D[k + 2];
        const fine = Math.sqrt(P[k] * P[k] + P[k + 1] * P[k + 1] + P[k + 2] * P[k + 2]);
        const coarse = ellipsoidRadius(axes, dx, dy, dz) + hf.height(dx, dy, dz, spacing * 2);
        const dh = coarse - fine;
        const o4 = v * 4;
        morph[o4] = dx * dh; morph[o4 + 1] = dy * dh; morph[o4 + 2] = dz * dh; morph[o4 + 3] = morphStart;
      }
      const kx0 = k - 3, kx1 = k + 3, ky0 = k - E * 3, ky1 = k + E * 3;
      const ax = P[kx1] - P[kx0], ay = P[kx1 + 1] - P[kx0 + 1], az = P[kx1 + 2] - P[kx0 + 2];
      const bx = P[ky1] - P[ky0], by = P[ky1 + 1] - P[ky0 + 1], bz = P[ky1 + 2] - P[ky0 + 2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const o = v * 3;
      normal[o] = nx; normal[o + 1] = ny; normal[o + 2] = nz;
      v++;
    }
  }
  // Skirts: copies of the edge vertices pushed down towards the centre.
  const sink = Math.max(spacing * 4, (hMax - hMin) * 0.25 + spacing);
  const edge = [];
  for (let i = 0; i < N; i++) edge.push([i, 0]);
  for (let j = 0; j < N; j++) edge.push([N, j]);
  for (let i = N; i > 0; i--) edge.push([i, N]);
  for (let j = N; j > 0; j--) edge.push([0, j]);
  for (const [i, j] of edge) {
    const k = ((j + 1) * E + (i + 1)) * 3;
    const src = (j * (N + 1) + i) * 3;
    put(k, sink);
    const o = v * 3;
    normal[o] = normal[src]; normal[o + 1] = normal[src + 1]; normal[o + 2] = normal[src + 2];
    const s4 = (j * (N + 1) + i) * 4, o4 = v * 4;
    morph[o4] = morph[s4]; morph[o4 + 1] = morph[s4 + 1]; morph[o4 + 2] = morph[s4 + 2]; morph[o4 + 3] = morph[s4 + 3];
    v++;
  }
  return { position, normal, dir: dirs, detail, morph, center: [cx, cy, cz], hMin, hMax, spacing };
}

/** Index buffer shared by every tile (grid + skirts). */
export function buildIndices() {
  const N = GRID;
  const idx = [];
  const at = (i, j) => j * (N + 1) + i;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
      // Alternate the diagonal for a more even look.
      if ((i + j) & 1) idx.push(a, b, d, a, d, c);
      else idx.push(a, b, c, b, d, c);
    }
  }
  // Skirt quads between each edge vertex and its sunken copy.
  const edge = [];
  for (let i = 0; i < N; i++) edge.push(at(i, 0));
  for (let j = 0; j < N; j++) edge.push(at(N, j));
  for (let i = N; i > 0; i--) edge.push(at(i, N));
  for (let j = N; j > 0; j--) edge.push(at(0, j));
  const base = VERTS;
  const n = edge.length;
  for (let k = 0; k < n; k++) {
    const a = edge[k], b = edge[(k + 1) % n];
    const sa = base + k, sb = base + ((k + 1) % n);
    idx.push(a, sa, b, b, sa, sb);
  }
  return new Uint32Array(idx);
}

function mod(a, m) {
  return a - Math.floor(a / m) * m;
}
