// =============================================================================
// environment.js — what the outside world does to you at a given spot:
// air density, pressure and temperature, sunlight intensity, radiation dose,
// and the heat of atmospheric entry. Used by both the ship and the suit.
// =============================================================================
import * as THREE from 'three';
import { SOLAR_LUMINOSITY, SIGMA, AU, STAR } from '../constants.js';

/** Solar irradiance (W/m²) at a distance (m) from the Sun's centre. */
export function solarFlux(distance) {
  return (SOLAR_LUMINOSITY * STAR.luminosity) / (4 * Math.PI * distance * distance);
}

/**
 * Atmosphere state at an altitude above the body's reference surface
 * (the 1-bar level for giant planets, where altitude can go negative).
 */
export function atmosphereAt(body, altitude) {
  const atm = body.atmosphere;
  if (!atm) return { pressure: 0, density: 0, temperature: null };
  if (altitude > atm.top * 1.6) return { pressure: 0, density: 0, temperature: null };
  // Below ~25 scale heights (thousands of bar) nothing survives; cap the model there.
  const f = Math.exp(-Math.max(altitude, -25 * atm.scaleHeight) / atm.scaleHeight);
  // Temperature: cools with height above the surface; giant planets heat up
  // steadily as you sink below the 1-bar level (Galileo probe: +2.4 K per km).
  let T;
  if (atm.gasGiant) T = altitude > 0 ? atm.tempK - 0.0012 * altitude : atm.tempK + 0.0024 * -altitude;
  else T = atm.tempK - (atm.lapse || 0) * altitude;
  T = Math.max(T, atm.tempK * 0.55);
  return { pressure: atm.pressure * f, density: atm.rho0 * f, temperature: T };
}

/** Altitude at which a giant planet's pressure reaches p (Pa). */
export function depthForPressure(body, p) {
  const atm = body.atmosphere;
  return -atm.scaleHeight * Math.log(p / atm.pressure);
}

// Jupiter's radiation belts, dose rate (Sv/hour) vs distance in Jupiter radii.
// Anchored to published surface doses: Io ≈ 36 Sv/day, Europa ≈ 5.4 Sv/day,
// Ganymede ≈ 0.08 Sv/day, Callisto ≈ 0.0001 Sv/day.
const JUPITER_BELT = [
  [1.0, 3], [1.3, 60], [2, 40], [3.5, 12], [5.9, 1.5], [9.4, 0.225],
  [15.0, 0.0033], [26.3, 0.000004], [60, 0.000001],
];
const GCR_SV_PER_HOUR = 0.075e-3; // galactic cosmic rays in deep space (~1.8 mSv/day)

function logInterp(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1], [x1, y1] = table[i];
      const t = (Math.log(x) - Math.log(x0)) / (Math.log(x1) - Math.log(x0));
      return Math.exp(Math.log(y0) + t * (Math.log(y1) - Math.log(y0)));
    }
  }
  return table[table.length - 1][1];
}

/**
 * Ambient radiation dose rate in Sv/hour at a world position.
 * Planetary bodies shield the half of the sky they cover (factor ~0.5 at the surface).
 */
export function radiationDose(eph, worldPos) {
  let dose = GCR_SV_PER_HOUR;
  const jup = eph.byId.jupiter;
  const rj = jup ? jup.pos.distanceTo(worldPos) / jup.radius : Infinity;
  if (rj < 60) {
    // Belts are concentrated near the magnetic equator.
    const rel = worldPos.clone().sub(jup.pos).normalize();
    const lat = Math.asin(Math.min(1, Math.abs(rel.dot(jup.pole))));
    dose += logInterp(JUPITER_BELT, rj) * Math.exp(-((lat / 0.6) ** 2));
  }
  // Saturn's belts are weak; give a mild bump inside the main rings' region.
  const sat = eph.byId.saturn;
  const rs = sat ? sat.pos.distanceTo(worldPos) / sat.radius : Infinity;
  if (rs < 8) dose += 0.002 * Math.exp(-((rs - 3) ** 2));
  // Near any body the planet blocks part of the cosmic ray sky.
  const near = eph.dominantBody(worldPos);
  if (near && near.id !== 'sun') {
    const d = near.pos.distanceTo(worldPos);
    const shadow = 0.5 * Math.min(1, (near.radius / d) ** 2);
    dose *= 1 - shadow;
  }
  return dose;
}

/** Equilibrium temperature (K) of a surface absorbing a heat flux (W/m²). */
export function equilibriumTemperature(flux, emissivity = 0.85) {
  return Math.pow(Math.max(flux, 0) / (emissivity * SIGMA) + 3 ** 4, 0.25);
}

/** Sutton–Graves stagnation-point convective heating (W/m²) for 1 m nose radius. */
export function entryHeating(density, speed) {
  return 1.83e-4 * Math.sqrt(Math.max(density, 0)) * speed * speed * speed;
}

/** Dynamic pressure q = ½ρv² (Pa). */
export function dynamicPressure(density, speed) {
  return 0.5 * density * speed * speed;
}

/**
 * Surface temperature (K) at a spot on an airless or thin-air body, from how
 * high the Sun is in that spot's sky (day/night and latitude).
 */
export function surfaceTemperature(body, upWorld, sunDirWorld) {
  const t = body.def.temps;
  if (!t) return 150;
  if (body.atmosphere && body.atmosphere.pressure > 5e4) return t.dayK; // thick air evens it out
  const cosZ = upWorld.dot(sunDirWorld);
  const sun = Math.max(0, cosZ);
  return t.nightK + (t.dayK - t.nightK) * Math.pow(sun, 0.3);
}

/** How strongly sunlight reaches a point inside an atmosphere (0..1), plus its tint. */
export function sunlightTransmission(body, altitude, sunElevationCos) {
  const atm = body.atmosphere;
  if (!atm) return { factor: 1, tint: [1, 1, 1] };
  const airmass = 1 / Math.max(0.035, sunElevationCos + 0.15 * Math.exp(-sunElevationCos * 8));
  const columnFraction = Math.exp(-Math.max(altitude, 0) / atm.scaleHeight);
  const beta = atm.rayleigh;
  const H = atm.scaleHeight;
  // Optical depth of the column above the point, per colour channel.
  const tau = beta.map((b) => (b + (atm.mie || 0) * 0.3) * H * columnFraction * airmass);
  let tint = tau.map((t) => Math.exp(-t));
  // Thick, cloudy atmospheres (Venus, Titan) let only a little light down to the ground.
  const floor = atm.surfaceLight ?? 1;
  const thickness = Math.exp(-Math.max(altitude, 0) / (H * 2.5));
  const factor = (1 - thickness) + thickness * floor;
  const mx = Math.max(...tint, 1e-6);
  tint = tint.map((t) => t / mx);
  return { factor: factor * Math.min(1, mx * 1.2 + 0.05), tint };
}

export const ENV_CONSTANTS = { AU };
