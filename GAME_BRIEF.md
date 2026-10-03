# Congo Crash — Build Brief for Claude Sonnet

> **How to use this file:** Paste the whole document to Claude Sonnet as the task
> prompt. It is written as an instruction to the model, not as marketing copy.
> Everything under "Non-negotiable constraints" must hold; everything under
> "Stretch goals" is optional and only to be attempted once the core game runs.

---

## 1. Role & objective

You are building a **playable 3D first-person survival game** called **"Congo
Crash."** The player is the sole survivor of a plane crash in the dense Congo
rainforest and must explore, survive the wildlife, and find a way out. Deliver a
game that **runs in a web browser with no install step** and **starts in a
playable state on the first try**.

The single most important success criterion: **a person can open the game, move
around a 3D jungle, encounter animals, watch day turn to night, and reach a win
or lose state.** A beautiful engine that doesn't boot is a failure; a simple
world that actually plays is a success. Prioritize accordingly.

---

## 2. Technology (decided — do not substitute without saying why)

- **Three.js** (loaded from a CDN, latest stable r16x) for all 3D rendering.
- **Plain HTML + JavaScript (ES modules).** No build step, no bundler, no
  framework. The game must run by opening `index.html` (served over a local
  static server to satisfy module/CORS rules — document the one command needed,
  e.g. `python3 -m http.server`).
- **PointerLockControls** (from Three.js examples) for mouse-look first-person
  camera.
- **No external game assets that require downloading or licensing.** Build the
  world from Three.js primitives (boxes, cylinders, cones, planes) and
  procedural placement. Trees = tapered cylinder trunk + stacked cone canopy;
  animals = simple primitive-based models. This keeps the game self-contained
  and guaranteed to load. Keep models low-poly and readable.

Rationale for this stack: it is the lowest-friction path to a 3D game that is
guaranteed to run for the user without toolchain setup. If you believe a
different stack is clearly better, state your reasoning in a comment at the top
of `index.html` before changing it — but default to this.

---

## 3. The world

- A large flat-to-gently-rolling rainforest terrain (a ground plane or
  low-resolution heightmap), bounded so the player cannot walk off the edge —
  use dense impassable foliage or a subtle invisible wall as the boundary, not a
  hard visible cliff.
- **Tall trees, densely placed** — this is the signature look. Scatter hundreds
  of trees procedurally with varied height and rotation so the forest feels
  deep and enclosing. Use fog (greenish, moderate density) to hide the draw
  distance and sell the "lost in the jungle" claustrophobia.
- **At least one river** winding through the terrain: a semi-transparent blue
  plane with gentle animated UVs or vertex motion. Rivers are where crocodiles
  and hippos live and are dangerous to cross.
- Undergrowth: ferns, bushes, fallen logs, rocks scattered as ground detail.
- **The crashed plane** sits in a small clearing and is the player's spawn
  point / landmark. It's where the game begins.
- An **extraction objective** somewhere far across the map (see §6).

Performance: the forest will be the heaviest cost. Use **instanced meshes**
(`InstancedMesh`) for trees and foliage. Target a smooth frame rate on a normal
laptop — if you must choose, reduce tree count or draw distance rather than ship
something that stutters.

## 4. Creatures

This game is set **only in the Congo rainforest** — use real Congo Basin
wildlife, not generic "jungle" or Amazonian animals. Implement a mix of passive
and hostile creatures. Favor menace and atmosphere, but keep every animal
something that genuinely lives in the Congo.

Implement at minimum:

- **Snakes** — Congo species such as the **Gaboon viper** (heavy-bodied, on the
  forest floor, superbly camouflaged) or **green mamba** (in low branches).
  Slither/patrol; strike and poison/damage the player if approached. Low and
  hard to spot.
- **Nile crocodiles** — in and near rivers; lunge at the player who enters or
  lingers at the water. High damage. (Use crocodiles, not alligators — Congo
  rivers have crocs.)
- **A large predator — the African leopard** — patrols the forest; chases and
  attacks on sight within a detection radius. The apex hunter of this biome.
- **Hippopotamus** — near rivers/wetland; territorial and extremely dangerous if
  the player gets between it and the water. Charges. (Optional but a great
  Congo-authentic threat.)
- **Passive creatures** — Congo natives such as **forest elephants**, **western
  lowland gorillas** (keep them passive unless provoked), **okapi** or a small
  **duiker** antelope, **monkeys** in the canopy, and birds. Harmless, add life
  and ambient sound, flee (or, for gorillas/elephants, warn then retreat) when
  approached.

Each hostile animal needs a minimal **AI state machine**: `idle/patrol →
detect player (by distance + optional line of sight) → chase → attack (on
cooldown) → return`. Keep it simple and readable; favor a few animals that work
over many that half-work.

## 5. Day / night cycle

- A continuously advancing clock (a full cycle in a few real minutes — make the
  duration a tunable constant).
- A **directional "sun" light** that arcs across the sky; sky color, fog color,
  and ambient light interpolate through dawn → day → dusk → night.
- **Night is meaningfully harder and darker:** lower visibility, more aggressive
  or more numerous predators, and the player relies on a limited **flashlight /
  torch** (a spotlight attached to the camera, toggleable, optionally with a
  battery/fuel limit). Night should feel tense, not merely dim.
- Show the current time / day count in the HUD.

## 6. Core gameplay loop & win/lose conditions

Give the game an actual point — the player asked to "find a way out."

- **Goal:** find the way out of the jungle. Concretely: locate a small number of
  objectives (e.g. **3 supply/parts caches** scattered across the map, or a
  radio + fuel + a path marker) and then reach the **extraction point** (a river
  boat, a ranger station, or a clearing with a rescue signal). Reaching
  extraction with the objectives met = **WIN**.
- **Survival pressures** (pick a sensible subset; don't over-build):
  - **Health** — depleted by animal attacks; game over at zero = **LOSE**.
  - **Stamina** — sprinting drains it, it regenerates when resting.
  - Optionally **hunger/thirst or warmth** that ticks down and must be managed
    (eat gathered fruit, drink from safe water). Keep it light; a frustrating
    meter is worse than none.
- Clear **start, win, and lose screens.** Start screen explains the premise and
  controls and has a "Begin" button (also needed to trigger pointer-lock on
  click). Win/lose screens show stats (days survived, objectives found) and a
  restart button.

## 7. Controls & HUD

- **WASD** move, **mouse** look, **Shift** sprint, **Space** jump (optional),
  **F** toggle flashlight, **E** interact/pick up, **Esc** release mouse / pause.
- Document the control scheme both on the start screen and in a corner of the
  HUD or a toggleable help overlay.
- **HUD:** health bar, stamina bar, any survival meters, objectives remaining,
  time of day / day counter, and a minimal interaction prompt ("Press E to
  collect"). Keep it clean and unobtrusive.

## 8. Audio (optional but valued)

Use the Web Audio API with simple synthesized or short, free, self-contained
sounds if practical: ambient jungle loop, a day/night insect shift, animal
cues, footsteps, an attack/hurt sound, and a pickup chime. If sourcing audio
adds any risk to "it just runs," skip it and leave hooks/comments for where
sound would attach. Never block the game from loading on an audio asset.

## 9. Non-negotiable constraints

1. **It must run** by opening the served `index.html` — no build errors, no
   missing-module crashes, no blank screen. Test the critical path mentally
   before finishing.
2. **Self-contained** — all code and assets committed; only Three.js comes from
   a pinned CDN URL.
3. **Readable, commented code** organized into clear modules/sections (world
   generation, player controller, animals, day-night, UI/game-state). The user
   is non-expert and may hand this back to a model to extend — optimize for a
   future editor's comprehension.
4. **Graceful degradation** — if something optional fails, the game still plays.
5. **No placeholder "TODO: implement later" in the core loop.** Movement,
   collision with trees/terrain, at least two working hostile animals, the
   day/night cycle, health/damage, and win+lose must all actually function.

## 10. Suggested file layout

```
index.html          # entry point, canvas, UI overlays, loads main.js as a module
styles.css          # HUD and menu styling
src/
  main.js           # bootstrap, game loop, state machine (menu/playing/win/lose)
  world.js          # terrain, trees (instanced), river, foliage, crash site
  player.js         # first-person controller, movement, collision, stats
  animals.js        # animal models + AI state machines + spawner
  dayNight.js       # clock, sun light, sky/fog interpolation, flashlight
  ui.js             # HUD, menus, objective tracking, screens
  audio.js          # optional; safe no-op if audio unavailable
README.md           # one-paragraph premise + exact run command + controls
```

Adjust if you have a cleaner structure, but keep concerns separated.

## 11. Build order (do this in sequence so there's always a runnable game)

1. Boot a Three.js scene: ground, sky, fog, a first-person camera that moves
   with WASD + mouse-look. **Verify it runs.**
2. Add the forest (instanced trees), river, crash-site spawn, and world bounds +
   tree collision.
3. Add player stats (health/stamina) and the HUD.
4. Add the day/night cycle and flashlight.
5. Add animals — start with one hostile (alligator at the river) and one passive,
   then expand. Wire up damage and death.
6. Add objectives, the extraction point, and win/lose screens + restart.
7. Polish: audio, more animals, night difficulty, undergrowth detail, balancing.

After each step the game should still open and play. Commit logically.

## 12. Stretch goals (only after the core is solid)

- Simple inventory and crafting (torch from branch + cloth, etc.).
- A minimap or compass pointing toward the next objective.
- Weather (rain, affecting visibility/sound).
- Save/restore progress via `localStorage`.
- More elaborate animal models and animations.

---

### Final instruction to the model

Build the whole thing, keep it running at every step, and finish with a short
summary of what works, what's stubbed, how to run it, and the exact controls.
When in doubt, choose the simpler option that ships and plays over the fancier
one that risks not loading.
