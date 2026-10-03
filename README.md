# Congo Crash

A first-person 3D survival game that runs in the browser. Your plane has gone down in the
middle of the Congo rainforest and you are the only survivor. The jungle is a dim, tangled
maze. Most paths wind back to the crash site or lead into danger: a crocodile-infested
river, a leopard den, or a swamp full of mosquitoes. Only one route leads out, to a
small village where your family is waiting.

Built with [three.js](https://threejs.org) (vendored in `vendor/`, so it runs offline).
There are no image, model or sound files: every tree, animal, person and sound is
generated in code.

## How to run

Browsers block ES modules on pages opened straight from disk, so serve the folder:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Any static file server works (`npx serve`, VS Code
Live Server, …). Add `?seed=1234` to the URL to replay a specific jungle.

## Controls

| Key | Action |
| --- | --- |
| `W A S D` / arrows | Move |
| Mouse | Look (click the game to capture the mouse; drag also works) |
| `Shift` | Sprint: a **5 second** burst, then **10 seconds** to recharge |
| `Space` | Jump over fallen logs and debris |
| `F` | Flashlight on / off |
| `E` | Pick up batteries and first-aid kits |
| `H` | Show / hide controls |
| `M` | Mute |
| `Esc` | Pause |

## How the game works

- **The maze.** Each new game generates a new jungle. The crash site is a clearing in the
  centre with five paths leading out. One path is the true route to the village and
  nothing else ever joins it. The other paths loop into each other and back to the
  wreck, or end at a hazard.
- **Hazards.** The river has Nile crocodiles and a hippo. The predator den has leopards
  and snakes. Damp thickets hold mosquito swarms that drain your health while you stand
  in them. Gaboon vipers and green mambas sit in the corridors, one of them on the true
  route, and a leopard prowls the wrong paths. It hunts by sight and sound and follows
  you around corners.
- **Wildlife.** Forest elephants, a silverback gorilla, an okapi, duikers, monkeys in the
  trees and birds over the clearing. The gorilla and the elephant warn you off before
  they retreat. Get too close to the gorilla and it will shove you.
- **Dying** sends you back to the crash site with full health, but an hour of daylight
  is gone. Try a different path.
- **Day and night.** A full day lasts 8 minutes. Even at noon the canopy keeps things
  dim. At night it's close to pitch black outside your flashlight, predators detect you
  from further away, and fireflies come out.
- **Flashlight.** The battery drains while it's on. Batteries from the wreckage recharge
  it. When it's empty it still gives a weak, flickering glow.
- **Escape.** When you reach the village, a cutscene plays: you walk in and your family
  runs out to hug you.

## Project layout

```
index.html        page, HUD and menus; loads three.js through an import map
styles.css        HUD / menu styling
src/config.js     every tunable number (sprint timing, speeds, day length, maze size…)
src/maze.js       maze generator: hub, branches, true route, loops, hazard placement
src/world.js      builds the 3D jungle from the maze: trees, river, village, hazards
src/models.js     procedural medium-poly models: trees, animals, people, plane, huts
src/collision.js  box colliders, jump/step heights, line-of-sight
src/player.js     first-person controller, sprint, jump, health, flashlight
src/animals.js    animal behaviour state machines and maze pathfinding
src/dayNight.js   clock, sun, sky, fog and eyeshine
src/audio.js      synthesised sound effects and ambience (Web Audio)
src/cutscene.js   the family-reunion ending
src/ui.js         HUD, toasts, fades, captions
src/main.js       game states and the main loop
tests/maze.test.mjs  checks hundreds of generated mazes
vendor/           three.js r160 (MIT)
```

## Tuning

Open `src/config.js`. For example, `CONFIG.player.sprintDuration` and
`CONFIG.player.sprintCooldown` set the sprint timings, `CONFIG.time.dayLengthSeconds`
sets the length of a day, and `CONFIG.maze.size` sets how big the jungle is. If the
game runs slowly, set `CONFIG.flashlight.castShadows = false` or lower
`CONFIG.render.maxPixelRatio`.

## Tests

```bash
node tests/maze.test.mjs
```

This generates 400 jungles and checks each one: it can be solved, there is exactly one
route to the village, the wrong paths really loop, and every hazard sits where it
should.
