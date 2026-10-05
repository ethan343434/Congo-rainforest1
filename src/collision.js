// =============================================================================
// collision.js — axis-aligned boxes in a spatial hash.
//
// Everything solid in the jungle (tree walls, the wreck, logs, deep water,
// huts) is a box { minX, maxX, minZ, maxZ, minY, maxY }. Movers are vertical
// cylinders (circle in XZ + feet/head height), which lets the player jump
// over low boxes like fallen logs but never over the tree walls.
// =============================================================================

const CELL = 5;
const STEP_HEIGHT = 0.3; // movers can walk up ledges lower than this

export class CollisionWorld {
  constructor() {
    this.boxes = [];
    this.grid = new Map();
  }

  add(box) {
    const b = { minY: 0, maxY: 50, low: false, ...box };
    this.boxes.push(b);
    for (let gx = Math.floor(b.minX / CELL); gx <= Math.floor(b.maxX / CELL); gx++) {
      for (let gz = Math.floor(b.minZ / CELL); gz <= Math.floor(b.maxZ / CELL); gz++) {
        const key = gx * 100003 + gz;
        let list = this.grid.get(key);
        if (!list) this.grid.set(key, (list = []));
        list.push(b);
      }
    }
    return b;
  }

  /** Boxes whose XZ footprint might overlap the circle (x, z, r). */
  query(x, z, r) {
    const out = new Set();
    for (let gx = Math.floor((x - r) / CELL); gx <= Math.floor((x + r) / CELL); gx++) {
      for (let gz = Math.floor((z - r) / CELL); gz <= Math.floor((z + r) / CELL); gz++) {
        const list = this.grid.get(gx * 100003 + gz);
        if (list) for (const b of list) out.add(b);
      }
    }
    return out;
  }

  /**
   * Push a circle out of every box it overlaps (in-place on pos.x / pos.z).
   * feetY lets movers pass over boxes they are standing on or jumping over.
   * ignoreLow: animals ignore logs (they step over them in the animation).
   */
  resolve(pos, r, feetY = 0, height = 1.8, ignoreLow = false) {
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const b of this.query(pos.x, pos.z, r)) {
        if (ignoreLow && b.low) continue;
        if (feetY >= b.maxY - STEP_HEIGHT || feetY + height <= b.minY) continue;
        const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
        const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
        let dx = pos.x - cx;
        let dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          pos.x += (dx / d) * (r - d);
          pos.z += (dz / d) * (r - d);
        } else {
          // Centre is inside the box: push out along the shallowest axis.
          const left = pos.x - b.minX, right = b.maxX - pos.x;
          const back = pos.z - b.minZ, front = b.maxZ - pos.z;
          const m = Math.min(left, right, back, front);
          if (m === left) pos.x = b.minX - r;
          else if (m === right) pos.x = b.maxX + r;
          else if (m === back) pos.z = b.minZ - r;
          else pos.z = b.maxZ + r;
        }
        moved = true;
      }
      if (!moved) break;
    }
  }

  /** Highest surface under the circle that the mover can stand on. */
  groundHeight(x, z, r, feetY) {
    let h = 0;
    for (const b of this.query(x, z, r)) {
      if (b.maxY > 5) continue; // walls are not walkable surfaces
      if (feetY < b.maxY - STEP_HEIGHT) continue;
      const cx = Math.max(b.minX, Math.min(x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r * 0.5) h = Math.max(h, b.maxY);
    }
    return h;
  }

  /** True if nothing tall blocks the straight line between two points. */
  lineOfSight(ax, az, bx, bz, eyeY = 1.0) {
    const dist = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(dist / 0.6);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      for (const b of this.query(x, z, 0)) {
        if (b.maxY < eyeY || b.minY > eyeY) continue;
        if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) return false;
      }
    }
    return true;
  }
}
