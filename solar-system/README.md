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
  Crash into a rocky planet or moon and the ship survives as a wreck: you are thrown
  clear and stay grounded for 2 minutes while its repair drones fix it.
  When you die you can respawn (`Enter`) or reset the whole game (`R`): the universe
  clock goes back to now and your progress is cleared. The pause menu has Reset too.
  Each body's scanner entry has a survivability rating: Lethal, Hostile, Suit required or
  Habitable.
- **The Sun's death (optional).** Switch it on in the pause menu: the Sun swells into a red
  giant and swallows every world out to Neptune in five minutes (only Pluto and Charon are
  far enough out), collapses into a black hole, and drags Pluto in over three minutes. Ride
  Pluto through to Proxima, where it strikes Alpha Centauri B and the two merge into a new
  star, Nova Plutonis.
- **Mars.** Olympus Mons stands at its real place in full detail: a 600 km shield 21.9 km
  high, a 6–8 km cliff around its base and calderas 3 km deep, labelled from orbit. On the
  surface time runs 3,000× faster, so a whole sol passes in about 30 seconds.
- **The Devourer (optional).** Switch it on in the pause menu and an original cosmic giant
  flies through the Solar System as a physical body (gravity, collisions, a target you can
  warp to and scan) eating it, starting with Mercury (each planet's moons, then the planet). Be on
  or next to a world while it is eaten and you go with it. When every world is gone it dives
  into the black hole, eats Proxima's planets, then hunts you; the pulse drive can outrun it.
  Its progress is saved in the browser; Reset game brings every world back.
- **World-killer beam.** Press `B` (or tap BEAM) and a beam drills into the target's core
  (or the nearest world's): it melts into magma in 4 seconds and explodes 10 seconds
  later. Stay more than three radii away. The Sun, the black hole and the Devourer are spared.
- **Black hole and white hole guns.** `N` opens a black hole beside the target (or the
  nearest world): the world and its moons spiral in and fall through to Alpha Centauri,
  where they come out in parking orbits around Proxima (go through the big black hole to
  see them). Be within 2.5 radii and you go with it. `U` opens a white hole in front of
  the ship and throws a swallowed world (`Y` picks which) at your target, in about
  8 seconds whatever the distance. Each world is blown apart if the impact energy
  beats its gravitational binding energy: the Moon always wrecks Earth, but Jupiter
  shrugs off a Moon thrown from close by (a throw from farther away is faster and hits
  harder). Stars, the black hole and the Devourer swallow whatever hits them.
  Destroyed and swallowed worlds are saved in the browser until Reset game.
- **Warp drive.** Press `K` and you jump straight to the selected target. You arrive on
  its sunlit side, facing it.
- **A black hole beyond Pluto.** This one is fictional and marked as such in the
  scanner. It sits 15 AU past Pluto, with an accretion disk and a photon ring. Cross the
  event horizon and you come out at Proxima b (see below).
  - **Spaghettification.** Over the last few horizon radii, tidal forces stretch your ship,
    the view and the clock towards the hole. The light fades to black as you cross.
  - **Time dilation.** The clock at the top shows ship time against universe time. Near
    the hole your clock runs slow (Schwarzschild factor 1/√(1 − rₛ/r)). The rest of the
    universe, planets included, races ahead.
  - **Echoes.** Light that looped around the black hole shows where you were seconds ago.
    Look back and you will see faint copies of your own ship.
- **Earth is open.** Land anywhere (oceans are a flat sea surface), step out and breathe.
  The Moon is fully landable too, with the six Apollo landing sites where they really are.

## Proxima b: the far side of the black hole

`proxima.html` is the Alpha Centauri system's red dwarf, Proxima Centauri, 4.24 light-years
away. The star, its planets b and d, and Alpha Centauri A and B in the sky are real. They
use real sizes, orbits and light: 0.15% of the Sun's output and a 3,040 K red glow. Proxima
b's surface and life are imagined.

- **An eyeball world.** It is tidally locked, so there is a scorched desert under the star,
  a frozen night side, and a twilight ring between them. It has a breathable atmosphere you
  fly down through.
- **The highest detail in the game.** It has a 4K procedural surface map and terrain about
  0.25 m apart under your feet.
- **Wildlife depends on where you are.**
  - In the twilight ring: **lumen grazers** and **sky jellies**. They are friendly and
    flee if shot.
  - On the day side: **dune claws**. On the night side: **night stalkers**. Both are
    hostile. They hunt you on foot and attack in melee.
- **Supply crates.** They have glowing beacons and show up as HUD markers. The first one
  lands beside you when you step out. Inside is a **laser rifle**: left click or `R` fires
  where the crosshair points, and energy recharges. Other crates hold energy cells, med
  kits and supplies.
- **Plants and terrain.** Black-violet lamp trees with glowing blossoms, crimson ferns, ice
  crystals on the night side and amber spires in the desert.
- **Going home.** The pause menu has *Return to the Solar System*.
- **Graphics.** The solar system keeps at least **30 fps**. Proxima b keeps at least
  **25 fps**, and spends the extra headroom on a **Medium+** look: sharper 4K shadows, a
  richer sky (more atmosphere samples) and denser plant life. If the frame rate drops it
  steps down to Medium, Low and then Minimum. Terrain detail and 1080p are never reduced.

## How to run

The page uses ES modules, so serve the repository folder instead of opening the file
directly:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/solar-system/> (use `localhost`, not `[::]`).
A desktop browser with WebGL 2 and a keyboard and mouse is best.

### On a phone or tablet

Touch screens get on-screen controls: a joystick under the left thumb (thrust and
roll in the ship, walking on foot), drag with the right thumb to steer or look, round
buttons to hold (up, down, boost, brake, jump, run, fire) and small ones to tap
(exit/board, land, autopilot, warp, pulse, target, view, scan, lights). The game is
always landscape: if the phone shows the page in portrait (for example with the iPhone's
Portrait Orientation Lock on, to play lying down) the whole game is turned sideways, and
**Flip screen** in the pause menu turns it the other way round. On Windows,
`Play on Phone (same Wi-Fi).bat` serves the game to a phone on the same network;
`?touch=1` or `?touch=0` in the address forces touch controls on or off.

## Controls

| Key | In the ship | On foot |
| --- | --- | --- |
| Mouse | Steer (click to capture; drag works too) | Look |
| `W` / `S` | Thrust forward / reverse | Run (same speed on every world) |
| `A` / `D` | Roll | Strafe |
| `Space` / `C` | Thrust up / down | Jump, hold for jetpack / jetpack down |
| `Shift` | Boost | Sprint, up to 60 mph |
| `J` | Pulse drive on / off | |
| `K` | Warp drive: jump to the target | |
| `G` | Autopilot to the target | |
| `T`, `0`–`9` | Next target / Sun, Mercury … Pluto (`T` also reaches the black hole) | same |
| `L` | Auto-land from orbit over any solid world | |
| `X` | Brake | |
| `Z` | Flight assist on / off (Newtonian) | |
| `E` | Step outside when landed | Board the ship |
| `V` | Chase / cockpit camera | Third / first person |
| `F` | Landing lights | Helmet lamp |
| `I` | Scanner: facts and survivability | same |
| Arrow keys | Pitch / yaw without a mouse | Walk |
| `H`, `M`, `O`, `Esc` | Help, mute, fps counter, pause | same |

Mouse wheel zooms the camera. Click a planet in the left compass to target it. The
**Controls** panel on the right lists what each key does at that moment, ship or on foot,
and dims keys you can't use right now. `Tab` hides it.

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
proxima.html                the far side of the black hole (built from index.html by
                            tools/make-proxima-page.py: edit index.html, then rerun it)
src/main.js                 entry point
src/game/game.js            game loop, states, controls, hazards, camera, HUD wiring
src/game/cameraRig.js       chase / cockpit / on-foot cameras
src/game/input.js           keyboard + mouse virtual stick
src/game/touch.js           on-screen joystick and buttons for touch screens
src/ui/view.js              landscape lock: turns the page on phones held in portrait
src/game/devourer.js        the optional world-eating giant: its plan, model, stream and hunt
src/game/planetBuster.js    the world-killer beam, and the explosions it shares with crashes
src/game/holeGuns.js        the black hole and white hole guns: swallowing, parking, throwing, crashes
src/game/sunDeath.js        the optional red giant, collapse and Pluto's fall to Alpha Centauri B
src/data/bodies.js          33 bodies: physical data, atmospheres, terrain, facts, survivability
src/data/proxima.js         the Proxima Centauri system; src/data/systems.js picks the system
src/game/proximaLife.js     Proxima b's creatures, plants, supply crates and laser rifle
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
- landing on Earth, auto-landing, sinking at Jupiter, and burning up near the Sun;
- that the terrain mesh sits exactly on the physics height function;
- jump height under lunar gravity.
