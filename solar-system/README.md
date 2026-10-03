# Sol Voyager

A browser space game set in the real solar system, at real scale, with every body where
it actually is today. You fly a ship (third-person chase camera or cockpit) to any planet
or major moon, land on solid worlds and walk around in a spacesuit.

- **Real positions and sizes.** Planets, Pluto, the Moon and Jupiter's four big moons
  are computed for the current date with
  [astronomy-engine](https://github.com/cosinekitty/astronomy). Other moons follow
  their real orbits. Spin axes and rotation use the IAU models.
- **Realistic physics.** Gravity is Newtonian with real masses and switches body at each
  sphere of influence. Drag, entry heating (Sutton–Graves), dynamic pressure, crushing
  pressure, radiation belts and solar heating all use real numbers.
- **No Man's Sky-style travel.** The pulse drive crosses the system in under a minute
  but slows near planets. Autopilot flies you there. You can fly seamlessly from space
  down to the ground, then get out and walk with a jetpack.
- **Survival.** Fly too close to the Sun and the hull melts. Air hits hard if you enter
  it too fast. Jupiter's 2.5 g wins against your hover thrusters, and its pressure
  crushes you if you sink. On foot, your suit's life support and hazard protection drain.
  Each body's scanner entry has a survivability rating: Lethal, Hostile, Suit required or
  Habitable.
- **Warp drive.** Press `K` and you jump straight to the selected target. You arrive on
  its sunlit side, facing it.
- **A black hole beyond Pluto.** This one is fictional and marked as such in the
  scanner. It sits 15 AU past Pluto, with an accretion disk and a photon ring. Cross the
  event horizon and you are taken to `void.html`, a blank white page for the next place
  to build.
  - **Spaghettification.** Over the last few horizon radii, tidal forces stretch your ship,
    the view and the clock towards the hole. The light fades to black as you cross.
  - **Time dilation.** The clock at the top shows ship time against universe time. Near
    the hole your clock runs slow (Schwarzschild factor 1/√(1 − rₛ/r)). The rest of the
    universe, planets included, races ahead.
  - **Echoes.** Light that looped around the black hole shows where you were seconds ago.
    Look back and you will see faint copies of your own ship.
- **Earth is off-limits.** A defence grid 600 km up bounces you off. The Moon is fully
  landable, with the six Apollo landing sites where they really are.

## How to run

The page uses ES modules, so serve the repository folder instead of opening the file
directly:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/solar-system/> (use `localhost`, not `[::]`).
A desktop browser with WebGL 2 and a keyboard and mouse is best.

## Controls

| Key | In the ship | On foot |
| --- | --- | --- |
| Mouse | Steer (click to capture; drag works too) | Look |
| `W` / `S` | Thrust forward / reverse | Walk |
| `A` / `D` | Roll | Strafe |
| `Space` / `C` | Thrust up / down | Jump, hold for jetpack / jetpack down |
| `Shift` | Boost | Run |
| `J` | Pulse drive on / off | |
| `K` | Warp drive: jump to the target | |
| `G` | Autopilot to the target | |
| `T`, `0`–`9` | Next target / Sun, Mercury … Pluto (`T` also reaches the black hole) | same |
| `L` | Auto-land (low and slow over ground) | |
| `X` | Brake | |
| `Z` | Flight assist on / off (Newtonian) | |
| `E` | Step outside when landed | Board the ship |
| `V` | Chase / cockpit camera | Third / first person |
| `F` | Landing lights | Helmet lamp |
| `I` | Scanner: facts and survivability | same |
| Arrow keys | Pitch / yaw without a mouse | Walk |
| `H`, `M`, `O`, `Esc` | Help, mute, fps counter, pause | same |

Mouse wheel zooms the camera. Click a planet in the left compass to target it.

## Graphics and performance

- **Fixed 1080p.** The game always renders 1080 pixels tall, whatever the window size.
- **Frame rate.** A governor watches the frame time and keeps it at 30 fps or more. It
  only adjusts shadow-map size, atmosphere ray-march samples, dust particles and glare,
  in that order.
- **Terrain detail.** The governor never reduces terrain or resolution. Ground tiles
  are about 0.4 m apart under your feet, with geomorphing so tile boundaries never pop.
- **Textures.** NASA-derived maps for Earth (Blue Marble, Black Marble, topography,
  clouds), Mars (colour plus MOLA elevation), Mercury, the Moon, Venus, the giant
  planets, Saturn's rings and Pluto. Moons without public maps get procedural textures
  styled after Voyager, Galileo and Cassini images. See [CREDITS.md](CREDITS.md).

## Project layout

```
index.html, styles.css      page, HUD, menus
void.html                   the other side of the black hole (blank, for you to build)
src/main.js                 entry point
src/game/game.js            game loop, states, controls, hazards, camera, HUD wiring
src/game/cameraRig.js       chase / cockpit / on-foot cameras
src/game/input.js           keyboard + mouse virtual stick
src/data/bodies.js          33 bodies: physical data, atmospheres, terrain, facts, survivability
src/sim/ephemeris.js        where everything is, for any date
src/sim/ship.js             flight model, pulse drive, autopilot, landing
src/sim/environment.js      air, pressure, temperature, radiation, heating
src/sim/hazards.js          hull and spacesuit survival systems
src/sim/walker.js           astronaut on foot
src/terrain/                height function, tile builder (Web Workers), quadtree, ground material
src/render/                 planets, atmospheres, rings, Sun, sky, ship, astronaut, effects
src/audio/audio.js          synthesised sound (Web Audio, no files)
src/ui/hud.js               compass, markers, gauges, scanner
tests/                      node tests (flight physics, terrain, walking)
textures/, vendor/          image maps; three.js and astronomy-engine
```

## Tests

From this folder:

```bash
node --import ./tests/loader.mjs tests/flight.test.mjs
node --import ./tests/loader.mjs tests/terrain.test.mjs
```

The tests cover:
- hovering, free fall and orbits;
- autopilot trips (Earth to Moon ≈ 21 s, Earth to Neptune ≈ 46 s);
- the Earth barrier, auto-landing, sinking at Jupiter, and burning up near the Sun;
- that the terrain mesh sits exactly on the physics height function;
- jump height under lunar gravity.
