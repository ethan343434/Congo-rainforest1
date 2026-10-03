// =============================================================================
// constants.js — physical constants and unit helpers. SI units everywhere
// (metres, seconds, kilograms, kelvin, pascals) unless a name says otherwise.
// =============================================================================

export const AU = 149597870700;            // astronomical unit, m
export const C_LIGHT = 299792458;          // speed of light, m/s
export const G_CONST = 6.6743e-11;         // gravitational constant
export const SIGMA = 5.670374419e-8;       // Stefan–Boltzmann constant
export const SOLAR_LUMINOSITY = 3.828e26;  // W
export const SOLAR_CONSTANT = 1361;        // W/m² at 1 AU
export const G0 = 9.80665;                 // standard gravity, m/s²
export const DEG = Math.PI / 180;
export const OBLIQUITY = 23.4392911 * DEG; // J2000 mean obliquity of the ecliptic
export const DAY = 86400;
export const KELVIN = 273.15;

/**
 * The star at the centre of the current system. The Sun by default; set by
 * the game when you arrive at Proxima Centauri (a red dwarf: 0.15% of the
 * Sun's light, 3,040 K).
 *   luminosity: in Suns · color: tint of its light · disk: tint of its surface
 */
export const STAR = { luminosity: 1, color: [1, 0.98, 0.95], disk: [1, 1, 1] };

/** Human-friendly distance: m, km, thousands of km, AU, plus light-time for big ones. */
export function formatDistance(m) {
  const a = Math.abs(m);
  if (a < 1000) return `${a.toFixed(0)} m`;
  if (a < 1e6) return `${(a / 1000).toFixed(a < 1e4 ? 2 : 1)} km`;
  if (a < 0.02 * AU) return `${Math.round(a / 1000).toLocaleString('en-US')} km`;
  return `${(a / AU).toFixed(a < 10 * AU ? 3 : 2)} AU`;
}

export function formatSpeed(v) {
  const a = Math.abs(v);
  if (a < 1000) return `${a.toFixed(a < 10 ? 1 : 0)} m/s`;
  if (a < 0.01 * C_LIGHT) return `${(a / 1000).toFixed(a < 1e4 ? 2 : 1)} km/s`;
  return `${(a / C_LIGHT).toFixed(a < 10 * C_LIGHT ? 2 : 0)} c`;
}

export function formatDuration(s) {
  if (!isFinite(s)) return '—';
  if (s < 90) return `${s.toFixed(0)} s`;
  if (s < 5400) return `${(s / 60).toFixed(0)} min`;
  if (s < 2 * DAY) return `${(s / 3600).toFixed(1)} h`;
  if (s < 730 * DAY) return `${(s / DAY).toFixed(s < 10 * DAY ? 2 : 0)} days`;
  return `${(s / (365.25 * DAY)).toFixed(1)} years`;
}

export function formatPressure(pa) {
  if (pa <= 0) return 'vacuum';
  if (pa < 1e-3) return `${pa.toExponential(1)} Pa`;
  if (pa < 1000) return `${pa.toPrecision(3)} Pa`;
  if (pa < 1e5 * 0.1) return `${(pa / 1000).toFixed(2)} kPa`;
  return `${(pa / 1e5).toFixed(pa < 1e6 ? 2 : 0)} bar`;
}

export function formatTemp(k) {
  return `${Math.round(k - KELVIN)} °C`;
}
