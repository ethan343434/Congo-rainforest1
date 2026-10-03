// =============================================================================
// maze.js — generates the jungle maze layout (pure logic, no rendering).
//
// Shape of the maze:
//   * The crash site is a clearing (the "hub") in the CENTRE of the grid.
//   * Several paths ("branches") radiate out of the hub. Each branch is grown
//     as its own winding maze region, so branches never touch each other
//     except where we deliberately join them.
//   * Exactly ONE branch is the "true" branch: its deepest edge cell opens out
//     to the native village. Nothing else ever connects into the true branch,
//     so there is only one route to the village.
//   * The other branches are "wrong" paths. We join them to each other and
//     back into the hub, so following them winds around and dumps you back at
//     the crash site. Some of their dead ends hold hazards instead: the river
//     (crocodiles + hippo), a predator nest, and mosquito swarms.
//
// Cells are indexed i = y * size + x. Direction 0=N(-y) 1=E(+x) 2=S(+y) 3=W(-x).
// =============================================================================
import { makeRng } from './rng.js';

export const DIRS = [
  { dx: 0, dy: -1 }, // N
  { dx: 1, dy: 0 },  // E
  { dx: 0, dy: 1 },  // S
  { dx: -1, dy: 0 }, // W
];
export const HUB = -1; // region id used for hub cells

const edgeKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);

export function generateMaze(options, seed = (Math.random() * 2 ** 32) >>> 0) {
  // A tiny fraction of seeds can produce a layout we don't like (e.g. no
  // wrong branch touches a side for the river). Just try the next seed.
  for (let attempt = 0; attempt < 50; attempt++) {
    const maze = tryGenerate(options, (seed + attempt * 7919) >>> 0);
    if (maze) return maze;
  }
  throw new Error('Could not generate a valid maze');
}

function tryGenerate(opts, seed) {
  const rng = makeRng(seed);
  const N = opts.size;
  const centre = Math.floor(N / 2);
  const total = N * N;

  const idx = (x, y) => y * N + x;
  const xOf = (i) => i % N;
  const yOf = (i) => Math.floor(i / N);
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < N && y < N;
  const neighbour = (i, d) => {
    const x = xOf(i) + DIRS[d].dx;
    const y = yOf(i) + DIRS[d].dy;
    return inBounds(x, y) ? idx(x, y) : -1;
  };

  const open = new Set();
  const isOpen = (a, b) => open.has(edgeKey(a, b));
  const carve = (a, b) => open.add(edgeKey(a, b));

  const region = new Int32Array(total).fill(-2); // -2 = unvisited
  const parent = new Int32Array(total).fill(-1);
  const treeDepth = new Int32Array(total).fill(0);

  // ---- 1. The hub (crash-site clearing) -----------------------------------
  const hubCells = [];
  for (let y = centre - opts.hubRadius; y <= centre + opts.hubRadius; y++) {
    for (let x = centre - opts.hubRadius; x <= centre + opts.hubRadius; x++) {
      const i = idx(x, y);
      hubCells.push(i);
      region[i] = HUB;
    }
  }
  const isHub = (i) => region[i] === HUB;
  for (const i of hubCells) {
    for (let d = 0; d < 4; d++) {
      const n = neighbour(i, d);
      if (n >= 0 && isHub(n)) carve(i, n);
    }
  }

  // ---- 2. Seed one branch per side of the hub, plus extras ------------------
  const perimeterBySide = [[], [], [], []];
  for (const h of hubCells) {
    for (let d = 0; d < 4; d++) {
      const n = neighbour(h, d);
      if (n >= 0 && !isHub(n)) perimeterBySide[d].push({ h, n, d });
    }
  }
  const seeds = [];
  const usedOutside = new Set();
  for (let d = 0; d < 4 && seeds.length < opts.branches; d++) {
    const choice = rng.pick(perimeterBySide[d]);
    seeds.push(choice);
    usedOutside.add(choice.n);
  }
  const leftovers = rng.shuffle(perimeterBySide.flat().filter((p) => !usedOutside.has(p.n)));
  while (seeds.length < opts.branches && leftovers.length) {
    const p = leftovers.pop();
    // Keep extra seeds away from existing ones so branches start apart.
    if (seeds.some((s) => Math.abs(xOf(s.n) - xOf(p.n)) + Math.abs(yOf(s.n) - yOf(p.n)) < 2)) continue;
    seeds.push(p);
    usedOutside.add(p.n);
  }

  // ---- 3. Grow every branch at the same time (round-robin backtrackers) ------
  const stacks = seeds.map((s, k) => {
    carve(s.h, s.n);
    region[s.n] = k;
    parent[s.n] = s.h;
    treeDepth[s.n] = 1;
    return [s.n];
  });
  let growing = true;
  while (growing) {
    growing = false;
    for (let k = 0; k < stacks.length; k++) {
      const stack = stacks[k];
      if (!stack.length) continue;
      growing = true;
      const cur = stack[stack.length - 1];
      const options = [];
      for (let d = 0; d < 4; d++) {
        const n = neighbour(cur, d);
        if (n >= 0 && region[n] === -2) options.push(n);
      }
      if (!options.length) {
        stack.pop();
        continue;
      }
      const next = rng.pick(options);
      carve(cur, next);
      region[next] = k;
      parent[next] = cur;
      treeDepth[next] = treeDepth[cur] + 1;
      stack.push(next);
    }
  }

  // ---- 4. Choose the true branch and the village exit ------------------------
  const sidesOf = (i) => {
    const s = [];
    if (yOf(i) === 0) s.push(0);
    if (xOf(i) === N - 1) s.push(1);
    if (yOf(i) === N - 1) s.push(2);
    if (xOf(i) === 0) s.push(3);
    return s;
  };
  const bestBoundary = []; // per region: deepest boundary cell
  for (let i = 0; i < total; i++) {
    const r = region[i];
    if (r < 0 || !sidesOf(i).length) continue;
    if (bestBoundary[r] === undefined || treeDepth[i] > treeDepth[bestBoundary[r]]) bestBoundary[r] = i;
  }
  const regionsWithExit = bestBoundary.map((c, r) => (c === undefined ? -1 : r)).filter((r) => r >= 0);
  if (regionsWithExit.length < 2) return null;
  const maxDepth = Math.max(...regionsWithExit.map((r) => treeDepth[bestBoundary[r]]));
  const trueRegion = rng.pick(regionsWithExit.filter((r) => treeDepth[bestBoundary[r]] >= maxDepth * 0.8));
  const exitCell = bestBoundary[trueRegion];
  const exitDir = rng.pick(sidesOf(exitCell));
  const isTrue = (i) => region[i] === trueRegion;
  const isWrong = (i) => region[i] >= 0 && region[i] !== trueRegion;

  const solution = [];
  for (let c = exitCell; c !== -1 && !isHub(c); c = parent[c]) solution.unshift(c);
  solution.unshift(parent[solution[0]]); // the hub cell the true branch leaves from

  // ---- 5. River opening: a wrong branch that reaches another side ------------
  const sidePreference = [(exitDir + 2) % 4, (exitDir + 1) % 4, (exitDir + 3) % 4];
  let riverCell = -1;
  let riverDir = -1;
  for (const side of sidePreference) {
    const candidates = [];
    for (let i = 0; i < total; i++) {
      if (isWrong(i) && sidesOf(i).includes(side) && sidesOf(i).length === 1) candidates.push(i);
    }
    if (!candidates.length) continue;
    candidates.sort((a, b) => treeDepth[b] - treeDepth[a]);
    riverCell = candidates[0];
    riverDir = side;
    break;
  }
  if (riverCell < 0) return null;

  // ---- 6. Make wrong branches loop into each other (and so back to the hub) --
  const candidates = [];
  for (let a = 0; a < total; a++) {
    if (!isWrong(a)) continue;
    for (const d of [1, 2]) { // E and S only, so each wall is considered once
      const b = neighbour(a, d);
      if (b < 0 || !isWrong(b) || region[a] === region[b] || isOpen(a, b)) continue;
      candidates.push({ a, b, score: treeDepth[a] + treeDepth[b] + rng() * 4 });
    }
  }
  candidates.sort((p, q) => q.score - p.score);
  const usedPairs = new Set();
  let loops = 0;
  for (const c of candidates) {
    if (loops >= opts.wrongLoops) break;
    const pair = edgeKey(region[c.a], region[c.b]);
    if (usedPairs.has(pair)) continue;
    usedPairs.add(pair);
    carve(c.a, c.b);
    loops++;
  }

  // ---- 7. Find dead ends; reserve some for hazards / pickups, braid the rest --
  const openNeighbours = (i) => {
    const list = [];
    for (let d = 0; d < 4; d++) {
      const n = neighbour(i, d);
      if (n >= 0 && isOpen(i, n)) list.push(n);
    }
    return list;
  };
  const isDeadEnd = (i) => !isHub(i) && i !== exitCell && i !== riverCell && openNeighbours(i).length === 1;
  const wrongDeadEnds = [];
  const trueDeadEnds = [];
  for (let i = 0; i < total; i++) {
    if (!isDeadEnd(i)) continue;
    if (isWrong(i)) wrongDeadEnds.push(i);
    else if (isTrue(i)) trueDeadEnds.push(i);
  }
  wrongDeadEnds.sort((a, b) => treeDepth[b] - treeDepth[a]);
  trueDeadEnds.sort((a, b) => treeDepth[b] - treeDepth[a]);
  if (wrongDeadEnds.length < 3) return null;

  const reserved = new Set([exitCell, riverCell]);
  const takeFrom = (list, pred = () => true) => {
    const i = list.find((c) => !reserved.has(c) && pred(c));
    if (i === undefined) return -1;
    reserved.add(i);
    return i;
  };
  let nestCell = takeFrom(wrongDeadEnds, (c) => region[c] !== region[riverCell]);
  if (nestCell < 0) nestCell = takeFrom(wrongDeadEnds);
  const swarmCells = [];
  const swarmA = takeFrom(wrongDeadEnds, (c) => region[c] !== region[nestCell]);
  if (swarmA >= 0) swarmCells.push(swarmA);
  const swarmB = takeFrom(trueDeadEnds, (c) => treeDepth[c] >= 3);
  if (swarmB >= 0) swarmCells.push(swarmB);
  else {
    const extra = takeFrom(wrongDeadEnds);
    if (extra >= 0) swarmCells.push(extra);
  }

  const pickups = [];
  const pickupTypes = ['battery', 'medkit', 'battery', 'medkit', 'battery'];
  for (const list of [trueDeadEnds, wrongDeadEnds, trueDeadEnds, wrongDeadEnds, wrongDeadEnds]) {
    const c = takeFrom(list);
    if (c >= 0) pickups.push({ cell: c, type: pickupTypes[pickups.length] });
  }

  // Braid: open remaining wrong dead ends towards the hub (lower depth first),
  // never into the true branch. This is what makes wrong paths circle back.
  for (const de of wrongDeadEnds) {
    if (reserved.has(de) || rng() > opts.braidChance) continue;
    const options = [];
    for (let d = 0; d < 4; d++) {
      const n = neighbour(de, d);
      if (n < 0 || isOpen(de, n) || reserved.has(n)) continue;
      if (isWrong(n) || isHub(n)) options.push(n);
    }
    if (!options.length) continue;
    options.sort((a, b) => (isHub(a) ? -1 : treeDepth[a]) - (isHub(b) ? -1 : treeDepth[b]));
    carve(de, options[0]);
  }

  // ---- 8. Final distances from the hub and a solvability check --------------
  const dist = new Int32Array(total).fill(-1);
  const queue = [...hubCells];
  for (const h of hubCells) dist[h] = 0;
  while (queue.length) {
    const c = queue.shift();
    for (const n of openNeighbours(c)) {
      if (dist[n] < 0) {
        dist[n] = dist[c] + 1;
        queue.push(n);
      }
    }
  }
  if (dist[exitCell] < 0 || dist.some((d) => d < 0)) return null;

  // ---- 9. Where the creatures live -------------------------------------------
  const spots = [];
  const manhattan = (a, b) => Math.abs(xOf(a) - xOf(b)) + Math.abs(yOf(a) - yOf(b));
  const special = new Set([...reserved, ...hubCells]);
  const corridorCells = [];
  for (let i = 0; i < total; i++) if (!special.has(i) && dist[i] >= 3) corridorCells.push(i);
  const spread = (pool, count, minGap, taken) => {
    const out = [];
    for (const c of rng.shuffle([...pool])) {
      if (out.length >= count) break;
      if ([...taken, ...out].some((t) => manhattan(t, c) < minGap)) continue;
      out.push(c);
    }
    return out;
  };

  // One snake sits roughly midway along the true route so it is never trivial.
  const midRoute = solution[Math.floor(solution.length * 0.55)];
  const snakeCells = [midRoute];
  snakeCells.push(...spread(corridorCells.filter((c) => !solution.includes(c)), 4, 3, [midRoute, nestCell, ...swarmCells]));
  for (const c of snakeCells) spots.push({ type: rng() < 0.65 ? 'viper' : 'mamba', cell: c });

  const wrongCorridors = corridorCells.filter(isWrong);
  const deepWrong = [...wrongCorridors].sort((a, b) => dist[b] - dist[a]);
  const leopardHome = deepWrong.find((c) => manhattan(c, nestCell) > 3) ?? deepWrong[0];
  spots.push({ type: 'leopard', cell: leopardHome, roams: true });
  spots.push({ type: 'leopard', cell: nestCell, nest: true });
  spots.push({ type: 'leopard', cell: nestCell, nest: true });
  spots.push({ type: 'viper', cell: nestCell, nest: true });
  spots.push({ type: 'mamba', cell: nestCell, nest: true });

  const passivePool = corridorCells.filter((c) => !snakeCells.includes(c) && c !== leopardHome);
  const [gorillaCell, okapiCell, duiker1, duiker2, elephantCell] = spread(passivePool, 5, 3, []);
  if (gorillaCell !== undefined) spots.push({ type: 'gorilla', cell: gorillaCell });
  if (elephantCell !== undefined) spots.push({ type: 'elephant', cell: elephantCell });
  if (okapiCell !== undefined) spots.push({ type: 'okapi', cell: okapiCell });
  if (duiker1 !== undefined) spots.push({ type: 'duiker', cell: duiker1 });
  if (duiker2 !== undefined) spots.push({ type: 'duiker', cell: duiker2 });

  return {
    seed,
    size: N,
    cellSize: opts.cellSize,
    centre: idx(centre, centre),
    hubCells,
    region,
    trueRegion,
    open,
    dist,
    exit: { cell: exitCell, dir: exitDir },
    river: { cell: riverCell, dir: riverDir },
    solution,
    nestCell,
    swarmCells,
    pickups,
    spots,
    // helpers
    idx,
    xOf,
    yOf,
    neighbour,
    isOpen,
    openNeighbours,
    isHub,
    isTrue,
    isWrong,
  };
}

/**
 * Breadth-first path between two cells through open passages.
 * Returns the list of cells from `from` to `to` (inclusive), or null.
 * Used by predators to chase the player around corners.
 */
export function findPath(maze, from, to) {
  if (from === to) return [from];
  const prev = new Int32Array(maze.size * maze.size).fill(-1);
  prev[from] = from;
  const queue = [from];
  while (queue.length) {
    const c = queue.shift();
    for (const n of maze.openNeighbours(c)) {
      if (prev[n] !== -1) continue;
      prev[n] = c;
      if (n === to) {
        const path = [to];
        for (let p = c; p !== from; p = prev[p]) path.push(p);
        path.push(from);
        return path.reverse();
      }
      queue.push(n);
    }
  }
  return null;
}
