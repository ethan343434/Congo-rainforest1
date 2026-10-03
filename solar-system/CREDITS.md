# Credits

## Code libraries (bundled in `vendor/`)

- **three.js r160** by mrdoob and contributors, MIT licence (`vendor/three.LICENSE`).
- **astronomy-engine 2.1.19** by Don Cross, MIT licence. Provides planet and moon
  positions (VSOP87, ELP/MPP02, L1.2) and the IAU rotation models.

## Planet maps (`textures/`)

All maps are derived from spacecraft data. Some were resized or reprojected for the game.

| File | Source |
| --- | --- |
| `earth_day.jpg` | NASA Blue Marble (via the three-globe example assets) |
| `earth_night.jpg` | NASA Black Marble / Earth at Night (via three-globe) |
| `earth_height.jpg`, `earth_water.jpg`, `earth_clouds.jpg` | NASA topography, water mask and cloud imagery (via three-globe) |
| `mercury_color.jpg` | Solar System Scope, CC BY 4.0, based on NASA MESSENGER |
| `venus_surface.jpg` | Planet Pixel Emporium (James Hastings-Trew), based on NASA Magellan radar |
| `moon_color.jpg`, `moon_height.jpg` | Planet Pixel Emporium, based on NASA/USGS Clementine and Lunar Orbiter data |
| `mars_color.jpg` | Solar System Scope / Planet Pixel Emporium, based on NASA Viking and MGS |
| `mars_height.jpg` | Planet Pixel Emporium, based on NASA MGS MOLA elevation |
| `jupiter.jpg`, `saturn.jpg`, `uranus.jpg`, `neptune.jpg` | Solar System Scope, CC BY 4.0, based on NASA Cassini, Voyager and Hubble |
| `saturn_rings.png` | Solar System Scope, CC BY 4.0, based on NASA Cassini |
| `pluto_color.jpg`, `pluto_height.jpg` | Planet Pixel Emporium (made before New Horizons, so artistic) |
| `milky_way.jpg` | Solar System Scope, CC BY 4.0, based on ESO / S. Brunier |
| `ceres_color.jpg` | Solar System Scope, CC BY 4.0 (not used yet) |

Solar System Scope textures (<https://www.solarsystemscope.com/textures/>) are under the
Creative Commons Attribution 4.0 licence. Planet Pixel Emporium maps
(<https://planetpixelemporium.com>) are free for non-commercial use with credit. NASA
imagery is public domain.

The moons without a public colour map are drawn procedurally, styled after Galileo,
Cassini and Voyager images. That covers Io, Europa, Ganymede, Callisto, Saturn's and
Uranus's moons, Triton, Proteus, Nereid, Charon, Phobos, Deimos and Titan's surface. So is
all the close-up ground detail: craters, rocks, dunes, ridges and regolith.

## Data

- **Physical data and facts:** NASA/JPL planetary fact sheets, the JPL Solar System
  Dynamics site and mission results (Apollo, Venera, Galileo, Cassini–Huygens,
  New Horizons, Juno, MESSENGER).
- **Apollo landing sites:** NASA/LRO coordinates.
- **Radiation-belt doses:** published estimates for the Galilean moons.
- **Entry heating:** the Sutton–Graves stagnation-point correlation.
