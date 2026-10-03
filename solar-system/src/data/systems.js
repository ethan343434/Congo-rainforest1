// =============================================================================
// systems.js — the star systems you can play in. The page picks one with
// window.SOL_SYSTEM ('sol' by default; proxima.html sets 'proxima').
// =============================================================================
import { BODIES, NAV_ORDER } from './bodies.js';
import { PROXIMA_BODIES, PROXIMA_NAV } from './proxima.js';

export const SYSTEMS = {
  sol: {
    id: 'sol',
    bodies: BODIES,
    nav: NAV_ORDER,
    star: { luminosity: 1, color: [1, 0.98, 0.95], disk: [1, 1, 1] },
    // New ships appear high over Earth's day side, Moon targeted.
    start: { body: 'earth', target: 'moon', altitude: 1900e3, terminator: false },
    preload: 'moon',
    welcome: ['Welcome aboard', 'Target: the Moon. Press G for autopilot, or J for the pulse drive. H shows all controls.'],
    respawnLabel: 'Respawn near Earth',
    // Falling into the black hole leads here.
    exitPage: 'proxima.html',
  },
  proxima: {
    id: 'proxima',
    bodies: PROXIMA_BODIES,
    nav: PROXIMA_NAV,
    // A red dwarf: 0.155% of the Sun's light, ~3,040 K.
    star: { luminosity: 0.00155, color: [1.0, 0.66, 0.46], disk: [1.0, 0.5, 0.3] },
    // You emerge over Proxima b's twilight ring, where life is.
    start: { body: 'proxb', target: 'proxb', altitude: 900e3, terminator: true },
    preload: 'proxb',
    welcome: ['4.24 light-years from home', 'You came out of the black hole above Proxima b. Fly down through the air, land in the twilight ring and look for supply crates.'],
    respawnLabel: 'Respawn above Proxima b',
    homePage: 'index.html',
  },
};
