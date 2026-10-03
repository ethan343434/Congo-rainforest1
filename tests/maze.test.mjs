// Run with:  node tests/maze.test.mjs
// Generates many mazes and checks the design guarantees from GAME_BRIEF.md.
import { generateMaze, findPath, HUB } from '../src/maze.js';

const OPTS = { size: 13, cellSize: 10, wallThickness: 2.6, hubRadius: 1, branches: 5, wrongLoops: 4, braidChance: 0.55 };
const RUNS = 400;
let failures = 0;
const fail = (seed, msg) => {
  failures++;
  if (failures < 20) console.error(`seed ${seed}: ${msg}`);
};

for (let run = 0; run < RUNS; run++) {
  const m = generateMaze(OPTS, run * 1013 + 17);
  const total = m.size * m.size;
  const s = m.seed;

  // 1. Solvable: a path exists from the crash site to the exit cell.
  const path = findPath(m, m.centre, m.exit.cell);
  if (!path) fail(s, 'exit unreachable');

  // 2. Exit is on the boundary side it claims to open through.
  const x = m.xOf(m.exit.cell), y = m.yOf(m.exit.cell);
  const onSide = [y === 0, x === m.size - 1, y === m.size - 1, x === 0][m.exit.dir];
  if (!onSide) fail(s, 'exit not on its side');

  // 3. Only one route: the true branch touches the hub through exactly one
  //    passage and never touches any wrong branch.
  let hubLinks = 0;
  for (let i = 0; i < total; i++) {
    if (!m.isTrue(i)) continue;
    for (const n of m.openNeighbours(i)) {
      if (m.isHub(n)) hubLinks++;
      else if (!m.isTrue(n)) fail(s, `true branch cell ${i} opens into wrong cell ${n}`);
    }
  }
  if (hubLinks !== 1) fail(s, `true branch has ${hubLinks} links to the hub`);

  // 3b. Inside the true branch the passages form a tree (no shortcuts), so the
  //     route from hub to village is unique.
  let trueCells = 0, trueEdges = 0;
  for (let i = 0; i < total; i++) {
    if (!m.isTrue(i)) continue;
    trueCells++;
    for (const n of m.openNeighbours(i)) if (m.isTrue(n) && n > i) trueEdges++;
  }
  if (trueEdges !== trueCells - 1) fail(s, `true branch is not a tree (${trueCells} cells, ${trueEdges} edges)`);

  // 4. Wrong paths loop: the hub + wrong branches contain cycles.
  let wrongCells = 0, wrongEdges = 0;
  for (let i = 0; i < total; i++) {
    if (!(m.isWrong(i) || m.isHub(i))) continue;
    wrongCells++;
    for (const n of m.openNeighbours(i)) if ((m.isWrong(n) || m.isHub(n)) && n > i) wrongEdges++;
  }
  // Subtract the hub's own internal clearing edges (they form cycles by themselves).
  const hubInternal = 12; // 3x3 grid has 12 internal edges, 8 for a tree => 4 cycles
  const extraCycles = wrongEdges - (wrongCells - 1) - (hubInternal - 8);
  if (extraCycles < 2) fail(s, `wrong paths barely loop (${extraCycles} cycles)`);

  // 5. Hazards live where they should.
  if (!m.isWrong(m.river.cell)) fail(s, 'river is not on a wrong path');
  if (!m.isWrong(m.nestCell)) fail(s, 'nest is not on a wrong path');
  if (m.openNeighbours(m.nestCell).length !== 1) fail(s, 'nest is not a dead end');
  if (m.swarmCells.length < 2) fail(s, 'fewer than 2 mosquito swarms');
  for (const c of m.swarmCells) {
    if (m.solution.includes(c)) fail(s, 'swarm blocks the true route');
    if (m.openNeighbours(c).length !== 1) fail(s, 'swarm cell is not a dead end');
  }
  if (m.solution.includes(m.nestCell)) fail(s, 'nest blocks the true route');
  if (m.river.dir === m.exit.dir) fail(s, 'river and village on the same side');

  // 6. Every cell is reachable (no sealed-off pockets).
  for (let i = 0; i < total; i++) if (m.dist[i] < 0) fail(s, `cell ${i} unreachable`);

  // 7. Creatures are placed.
  const types = new Set(m.spots.map((p) => p.type));
  for (const t of ['viper', 'leopard', 'gorilla']) if (!types.has(t)) fail(s, `no ${t}`);
  if (m.region[m.centre] !== HUB) fail(s, 'centre is not the hub');
}

if (failures) {
  console.error(`\n${failures} failure(s) across ${RUNS} mazes`);
  process.exit(1);
}
console.log(`OK: ${RUNS} mazes generated, all solvable with a single true route, looping wrong paths and placed hazards.`);
