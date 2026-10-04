// =============================================================================
// proxima.js — the far side of the black hole: the Proxima Centauri system,
// 4.24 light-years away, the nearest star to the Sun.
//
// Real: Proxima Centauri is a red dwarf (M5.5, 0.12 solar masses, 0.154 solar
// radii, ~3,040 K, 0.15% of the Sun's light). Proxima b (found 2016) orbits
// in 11.2 days at 0.049 AU, inside the habitable zone, and is almost
// certainly tidally locked: one side always faces the star. Proxima d (2022)
// is a small hot world closer in. Alpha Centauri A and B, a Sun-like pair,
// shine about 13,000 AU away as the two brightest stars in the sky.
//
// Imagined for the game: Proxima b's breathable air, its terrain and its life.
// It is an "eyeball" world: a scorched desert under the star, a frozen night
// side, and a ring of twilight between them where life thrives.
// =============================================================================

const KM = 1000;
const R_SUN = 695700 * KM;
const GM_SUN = 1.32712440018e20;
const GM_EARTH = 3.986004418e14;

export const PROXIMA_BODIES = [
  {
    // Kept as id "sun": it is the star the whole game lights and orbits by.
    id: 'sun', name: 'Proxima Centauri', kind: 'star', parent: null,
    radius: 0.1542 * R_SUN, GM: 0.1221 * GM_SUN, mass: 2.43e29,
    ephem: { type: 'origin' },
    rotation: { type: 'fixed' },
    visual: { pointColor: '#ff7a4a' },
    stats: { type: 'Red dwarf (M5.5 V)', day: '83 days', temp: '3,040 °C surface', age: '4.85 billion years' },
    facts: [
      'The closest star to the Sun: 4.24 light-years away.',
      'Only 15% as wide as the Sun and 0.15% as bright. It is too faint to see from Earth without a telescope.',
      'A flare star: it can brighten many times over in minutes.',
      'It will keep shining for about 4 trillion years, 400 times longer than the Sun.',
    ],
    survivability: { rating: 'Lethal', summary: 'Small and dim, but still a star: its surface is over 3,000 °C, and its flares blast nearby planets with X-rays.', hazards: ['Photosphere 3,040 °C', 'Stellar flares'] },
  },
  {
    id: 'proxb', name: 'Proxima b', kind: 'planet', parent: 'sun',
    radius: 6950 * KM, GM: 1.07 * GM_EARTH, mass: 6.4e24,
    ephem: { type: 'kepler', a: 0.04857 * 149597870700, period: 11.1868, i: 0, e: 0.02 },
    rotation: { type: 'tidal' },
    // The highest-detail world in the game: 4K map, ~0.25 m terrain spacing.
    visual: { proc: 'proxb', procSize: 4096, pointColor: '#d9a07a', albedo: 0.3 },
    atmosphere: {
      pressure: 1.12e5, scaleHeight: 8.9 * KM, top: 100 * KM, tempK: 278, lapse: 0.006, rho0: 1.36,
      composition: '76% N₂ · 21% O₂ · 2% Ar · CO₂ (breathable)',
      rayleigh: [5.0e-6, 11.8e-6, 29.0e-6], mie: 5e-6, mieScaleHeight: 1.4 * KM, mieG: 0.78,
      haze: [0.82, 0.6, 0.55], breathable: true, eyeball: true,
    },
    temps: { dayK: 325, nightK: 205 },
    terrain: {
      spacing: 0.25,
      eyeball: true,
      craters: { density: 0.05, maxRadius: 6 * KM, minRadius: 3, depth: 0.45 },
      noise: { amp: 900, scale: 32 * KM },
      ridges: { amp: 260, scale: 7 * KM },
      dunes: { amp: 22, wavelength: 190 },
      rocks: 0.9,
    },
    stats: { type: 'Rocky planet, tidally locked', day: 'Locked: permanent day on one side', year: '11.2 Earth days', temp: '−70 °C night side to 50 °C under the star', moons: 0, orbit: '7.3 million km from Proxima' },
    facts: [
      'Real: found in 2016. It is at least 1.07 times Earth’s mass, inside Proxima’s habitable zone.',
      'Real: it is so close to its star that a year lasts 11.2 days. It almost certainly always shows the star the same face.',
      'Imagined for the game: breathable air, a scorched day side, a frozen night side and a ring of twilight teeming with life.',
      'Plants here are dark violet to black, so they soak up as much of the dim red light as they can.',
      'Alpha Centauri A and B, a pair of Sun-like stars, are the two brightest stars in its sky.',
    ],
    survivability: {
      rating: 'Habitable',
      summary: 'Breathable air and mild temperatures in the twilight ring. The wildlife is the danger: dune claws hunt on the day side and night stalkers in the dark.',
      hazards: ['Hostile wildlife on the day and night sides', 'Stellar flares', 'Frozen night side'],
    },
  },
  {
    id: 'proxd', name: 'Proxima d', kind: 'planet', parent: 'sun',
    radius: 4100 * KM, GM: 0.26 * GM_EARTH, mass: 1.55e24,
    ephem: { type: 'kepler', a: 0.02885 * 149597870700, period: 5.122, i: 0, e: 0.04 },
    rotation: { type: 'tidal' },
    visual: { proc: 'regolith', pointColor: '#b9a08a', albedo: 0.15 },
    temps: { dayK: 470, nightK: 90 },
    terrain: { craters: { density: 0.55, maxRadius: 12 * KM, minRadius: 1, depth: 0.8 }, noise: { amp: 260, scale: 9 * KM }, rocks: 1.0 },
    stats: { type: 'Small rocky planet', day: 'Tidally locked', year: '5.1 Earth days', temp: '~200 °C day side', moons: 0, orbit: '4.3 million km from Proxima' },
    facts: [
      'Real: confirmed in 2022, it is only about a quarter of Earth’s mass.',
      'Real: it orbits so close that a year lasts just 5 days.',
      'Imagined for the game: an airless, cratered rock.',
    ],
    survivability: { rating: 'Hostile', summary: 'Airless and baked on its star-facing side.', hazards: ['Vacuum', '~200 °C day side', 'Stellar flares'] },
  },
  {
    id: 'alphacenA', name: 'Alpha Centauri A', kind: 'distantstar', parent: null,
    radius: 1.22 * R_SUN, GM: 1.1 * GM_SUN, mass: 2.2e30,
    ephem: { type: 'fixed', au: [-8700, 2300, 9600] },
    rotation: { type: 'fixed' },
    visual: { pointColor: '#fff2dc', magnitude: -6.8 },
    stats: { type: 'Sun-like star (G2 V)', temp: '5,520 °C' },
    facts: ['A near-twin of the Sun, about 13,000 AU (0.2 light-years) from Proxima.'],
    survivability: { rating: 'Lethal', summary: 'A star.', hazards: ['Star'] },
  },
  {
    id: 'alphacenB', name: 'Alpha Centauri B', kind: 'distantstar', parent: null,
    radius: 0.86 * R_SUN, GM: 0.9 * GM_SUN, mass: 1.8e30,
    ephem: { type: 'fixed', au: [-8690, 2290, 9608] },
    rotation: { type: 'fixed' },
    visual: { pointColor: '#ffd29a', magnitude: -5.3 },
    stats: { type: 'Orange dwarf (K1 V)', temp: '5,000 °C' },
    facts: ['Orbits Alpha Centauri A every 80 years.'],
    survivability: { rating: 'Lethal', summary: 'A star.', hazards: ['Star'] },
  },
];

export const PROXIMA_NAV = ['sun', 'proxd', 'proxb'];

// Named places on Proxima b, labelled from orbit (the star is over 0°, 0°).
const proxbDef = PROXIMA_BODIES.find((b) => b.id === 'proxb');
if (proxbDef) {
  proxbDef.features = [
    { name: 'Substellar Point · the Scorch', lat: 0, lon: 0, height: 0, major: true },
    { name: 'Antistellar Point · the Long Night', lat: 0, lon: 180, height: 0, major: true },
    { name: 'Twilight Ring (east)', lat: 0, lon: 90, height: 0, major: true },
    { name: 'Twilight Ring (west)', lat: 0, lon: -90, height: 0, major: true },
    { name: 'North Pole', lat: 89.9, lon: 0, height: 0 },
    { name: 'South Pole', lat: -89.9, lon: 0, height: 0 },
  ];
}
