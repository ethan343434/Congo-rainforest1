# Congo Crash — Build Brief for Claude Sonnet

> **How to use this file:** Paste the whole document to Claude Sonnet as the task
> prompt. It is written as an instruction to the model, not as marketing copy.
> Everything under "Non-negotiable constraints" must hold; everything under
> "Stretch goals" is optional and only to be attempted once the core game runs.

---

## 1. Role & objective

You are building a **playable 3D first-person survival game** called **"Congo
Crash."** The player is the sole survivor of a plane crash in the dense Congo
rainforest. The forest is **dim and maze-like**: the player moves through it in
**first person, guided by a flashlight**, navigating winding overgrown paths and
dead ends while surviving the wildlife, searching for the way out — **the exit
is a small native village** on the far side of the forest. Deliver a game that
**runs in a web browser with no install step** and **starts in a playable state
on the first try**.

The core experience to nail: **a tense walk through a dark, disorienting jungle
maze, flashlight sweeping across trees, not sure which way leads out, animals
lurking — until the lights of a native village finally appear.**

The single most important success criterion: **a person can open the game, walk
through the dim maze-like forest with their flashlight from the central crash
site, hit wrong paths that loop back or get them killed (respawning at the crash
site), and eventually find the true route to the native village (win).** A
beautiful engine that doesn't boot is a failure; a simple world that actually
plays is a success. Prioritize accordingly.

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
- **The forest is a maze with the crash site at its CENTER (a hub).** This is
  central, not decoration. Several paths **radiate out from the crash site**,
  but only **one true route** eventually reaches the village. The others are
  wrong paths — they **wind and wrap around in confusing, looping ways** and
  either:
  - **loop back to the crash site** in the center (so the player realizes
    they've gone in a circle), or
  - **lead into a hazard zone** — the river with its dangerous animals, a
    predator nest, or a mosquito-swarm thicket (see §4) — that damages or kills
    the player.

  How to build it:
  - **(Recommended) Generate a grid/graph maze** (e.g. recursive backtracker),
    place the start cell at the center, then **braid it** — knock out some extra
    walls to create loops and multiple routes so wrong paths curve back on
    themselves instead of ending in clean dead ends. Pick one far cell as the
    village exit and compute the true path to it. Mark several other branches as
    "wrong": route them back toward the center or into a hazard clearing.
    Optionally re-randomize each new game for replayability.
  - Or hand-author a smaller radial labyrinth of overgrown corridors.
  - Either way: **the true route to the village must exist and be solvable**,
    the wrong routes should feel disorienting (loop back / wrap around), and at
    least some wrong routes must open into the hazard zones below.
  - The confusing wrap-around is the intended feel: the dim lighting, repeated
    tree instances, and fog should make it genuinely hard to tell paths apart.
- **Dim and enclosing by default.** Tall, densely placed trees with a thick
  canopy keep the forest shadowy even in daytime; use fog (greenish, moderate
  density) and relatively low ambient light so the player leans on the
  flashlight to see the path ahead. This is the signature mood — disorienting,
  claustrophobic, not sure what's around the next bend.
- **At least one river** winding through the terrain: a semi-transparent blue
  plane with gentle animated UVs or vertex motion. Rivers are where crocodiles
  and hippos live and are dangerous to cross. A river can double as a maze
  obstacle (a corridor the player must cross at a shallow point or log bridge).
- Undergrowth: ferns, bushes, fallen logs, rocks scattered as ground detail,
  and to thicken the maze walls.
- **The crashed plane** sits in a small clearing at the **center of the forest**
  — the hub the maze radiates from, the spawn point, and the **respawn point on
  death** (see §6). Make it a recognizable landmark (wreckage, smoke, a bit of
  light) so the player knows when they've looped back to it.
- **Hazard zones** sit at the ends of some wrong paths: the river (crocodiles /
  hippos), a predator **nest** (clustered aggressive animals), and a **mosquito-
  swarm thicket**. Entering/lingering drains health fast; see §4 and §6.
- **The native village** is the maze exit and win condition (see §6): a small
  cluster of huts, a fire/torches, and visible light that the player is drawn
  toward. Place it at the far end of the true route from the crash site.

Performance: the forest will be the heaviest cost. Use **instanced meshes**
(`InstancedMesh`) for trees and foliage. Target a smooth frame rate on a normal
laptop — if you must choose, reduce tree count or draw distance rather than ship
something that stutters. (The dimness + fog conveniently let you keep draw
distance short.)

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
- **Mosquito swarm** — a drifting cloud (particle system / sprite swarm) in
  certain damp thickets at the ends of wrong paths. It doesn't chase far, but
  **continuously claws at the health bar** while the player is inside it, and can
  kill if they don't retreat. A cheap, nasty hazard that teaches "this was the
  wrong way."
- **Predator nest** — a clearing with **several clustered aggressive animals**
  (snakes or a leopard pair) that all detect and converge on the player at once.
  A wrong path that turns deadly fast.
- **Passive creatures** — Congo natives such as **forest elephants**, **western
  lowland gorillas** (keep them passive unless provoked), **okapi** or a small
  **duiker** antelope, **monkeys** in the canopy, and birds. Harmless, add life
  and ambient sound, flee (or, for gorillas/elephants, warn then retreat) when
  approached.

Each hostile animal needs a minimal **AI state machine**: `idle/patrol →
detect player (by distance + optional line of sight) → chase → attack (on
cooldown) → return`. The mosquito swarm is simpler — a damage volume: while the
player is inside its radius, drain health per second. Keep it simple and
readable; favor a few animals that work over many that half-work.

## 5. Lighting, flashlight & day / night cycle

**The flashlight is the core mechanic, not an accessory.** Because the forest is
dim at all times (thick canopy + fog + low ambient light), the player sees the
maze mainly through their flashlight:

- Implement it as a **spotlight attached to the camera** (plus a small point
  light so the player isn't in pitch black), toggleable with **F**. It should
  cast a believable cone down the path and across tree trunks.
- The flashlight is **on by default** and central to navigation — sweep it to
  spot the path, forks, animals' eyeshine, and the village glow.
- Optionally give it a **battery that slowly drains** and can be recharged from
  pickups found in the maze — this adds tension without being punishing. If a
  battery mechanic risks softlocking the player in the dark, make it generous or
  make it optional.

**Day / night cycle** (keeps the world alive and ramps difficulty):

- A continuously advancing clock (a full cycle in a few real minutes — make the
  duration a tunable constant).
- A **directional "sun" light** that arcs across the sky; sky color, fog color,
  and ambient light interpolate through dawn → day → dusk → night. Even "day"
  stays shadowy under the canopy — the flashlight always matters.
- **Night is meaningfully harder:** near-total darkness beyond the flashlight
  cone, more aggressive or more numerous predators. Night should feel genuinely
  frightening.
- Show the current time / day count in the HUD.

## 6. Core gameplay loop & win/lose conditions

Give the game an actual point — the player must find their way out of the maze.

- **Goal:** navigate the dim forest maze from the crash site and **reach the
  small native village** on the far side. Reaching the village = **WIN**, which
  triggers the escape cutscene below.
- **Win cutscene (on reaching the village):** when the player steps into the
  village, hand control over to a short scripted **cutscene** — the survivor is
  reunited with his **family, who run up and hug him**. Keep it simple and
  guaranteed to work with the primitive art style: e.g. lock the camera to a
  framed shot, fade in the village/firelight, animate a few simple human figures
  (the family) moving toward and embracing the player figure, and overlay text
  like *"You made it out of the Congo."* / *"You're home."* Pair it with swelling
  ambient/music if audio is in. End on a win screen with stats and restart.
  Implement it as its own game state (`cutscene`) so it's easy to extend later.
- Keep the primary objective simple: *get to the village alive.* The maze itself
  is the challenge. Optionally sprinkle a few **pickups along the way**
  (flashlight batteries, bandages/med supplies, maybe a torn map fragment that
  hints at the direction) to reward exploration — but do not gate the win behind
  fetch-quests unless the core maze already plays well. Finding the route and
  surviving the animals is the game.
- **Death = respawn at the crash site (the hub), not game over.** When health
  hits zero — mauled by an animal, caught in the nest, or drained by the
  mosquito swarm — the player **respawns back at the crash site in the center**
  with health restored, and tries a different path. This is the core rhythm:
  venture out → wrong path loops back or kills you → respawn at the hub → pick a
  different direction → eventually find the true route to the village. Fade to
  black and back on death, and show a brief "You were killed by …" line so the
  player learns what got them.
  - Give respawn a small cost so death still stings: e.g. **reset to the hub and
    lose a chunk of daylight** (time jumps forward / a death counter ticks up),
    or drop any carried batteries. Keep it fair, not punishing.
  - **Optional true LOSE:** if you want a fail state, cap it at a number of
    deaths or have the day counter run out — then show a real game-over screen.
    If in doubt, infinite respawns + a death counter is fine; the win is the
    goal, not the lose.
- **Survival pressures** (pick a sensible subset; don't over-build):
  - **Health** — depleted by animal attacks and the mosquito swarm; zero =
    death + respawn at the hub (above).
  - **Sprint (timed burst, not a drain bar).** Holding sprint (**Shift**) makes
    the player run fast for **exactly 5 seconds**, then it **cuts out and must
    recharge for 10 seconds** before it can be used again. Show this clearly in
    the HUD as a **sprint meter / cooldown bar** (full → draining over 5s →
    empty, then refilling over 10s). Sprint is the player's tool for escaping
    predators, bolting out of the mosquito swarm, or crossing a dangerous
    stretch — but the forced 10s cooldown means they can't spam it and must time
    it. Make the 5s / 10s values tunable constants.
  - Optionally **hunger/thirst or warmth** that ticks down and must be managed
    (eat gathered fruit, drink from safe water). Keep it light; a frustrating
    meter is worse than none.
- Clear **start and win screens** (and a lose screen only if you add a true fail
  state). Start screen explains the premise and controls and has a "Begin"
  button (also needed to trigger pointer-lock on click). Win screen shows stats
  (time taken, deaths/respawns) and a restart button.

## 7. Controls & HUD

- **WASD** move, **mouse** look, **Shift** sprint (5s burst, 10s cooldown — see
  §6), **Space** jump (optional), **F** toggle flashlight, **E** interact/pick
  up, **Esc** release mouse / pause.
- Document the control scheme both on the start screen and in a corner of the
  HUD or a toggleable help overlay.
- **HUD:** health bar, **sprint meter/cooldown bar** (showing the 5s burst and
  10s recharge), any survival meters, time of day / day counter, death/respawn
  counter, and a minimal interaction prompt ("Press E to collect"). Keep it
  clean and unobtrusive.

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
   collision with maze walls/terrain, a solvable route to the village, wrong
   paths that loop back or hit hazards, at least two working hostile threats
   (one animal + the mosquito swarm), the day/night cycle, health/damage,
   death→respawn at the crash site, and the village win must all actually
   function.

## 10. Suggested file layout

```
index.html          # entry point, canvas, UI overlays, loads main.js as a module
styles.css          # HUD and menu styling
src/
  main.js           # bootstrap, game loop, state machine (menu/playing/cutscene/win/lose)
  maze.js           # maze generation (grid) + layout data, start/exit cells
  world.js          # terrain, trees (instanced) dressing the maze, river, village, crash site
  player.js         # first-person controller, movement, collision, stats, flashlight
  animals.js        # animal models + AI state machines + spawner
  dayNight.js       # clock, sun light, sky/fog interpolation, dim-lighting curve
  ui.js             # HUD, menus, objective tracking, screens
  audio.js          # optional; safe no-op if audio unavailable
README.md           # one-paragraph premise + exact run command + controls
```

Adjust if you have a cleaner structure, but keep concerns separated.

## 11. Build order (do this in sequence so there's always a runnable game)

1. Boot a Three.js scene: ground, dim sky, fog, a first-person camera that moves
   with WASD + mouse-look, and the **flashlight** (camera spotlight). **Verify it
   runs.**
2. Generate the **maze layout** with the crash site at the center, build its
   walls from instanced trees with a walkable path and collision, braid it so
   wrong paths loop back, and place the **native village** at the far end of the
   true route. Confirm the true route is solvable.
3. Add player stats (health, **5s-sprint / 10s-cooldown**), the HUD, and
   **respawn-at-crash-site on death**.
4. Add the day/night cycle and tune the dim lighting around the flashlight.
5. Add animals + hazard zones — start with one hostile (crocodile at the river)
   and the mosquito swarm, then add the nest and a passive animal. Wire up damage
   and death→respawn.
6. Add the **win trigger at the village**, the **family-hug escape cutscene**,
   optional pickups, and the win screen (+ optional lose screen) + restart.
7. Polish: audio, more animals, night difficulty, undergrowth detail, balancing,
   village lighting/glow as a navigation beacon.

After each step the game should still open and play. Commit logically.

## 12. Stretch goals (only after the core is solid)

- Simple inventory and crafting (torch from branch + cloth, etc.).
- A minimap or compass — but consider leaving it out, since getting lost is the
  point; a partial/fogged map found as a pickup is a good middle ground.
- Distant village glow or sound as a faint directional beacon through the trees.
- Weather (rain, affecting visibility/sound).
- Save/restore progress via `localStorage`.
- More elaborate animal models and animations.

---

### Final instruction to the model

Build the whole thing, keep it running at every step, and finish with a short
summary of what works, what's stubbed, how to run it, and the exact controls.
When in doubt, choose the simpler option that ships and plays over the fancier
one that risks not loading.
