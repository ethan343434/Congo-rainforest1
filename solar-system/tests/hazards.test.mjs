// Survival-system checks (run: node --import ./tests/loader.mjs tests/hazards.test.mjs)
import { ShipSystems, SuitSystems } from '../src/sim/hazards.js';
import { solarFlux, atmosphereAt, depthForPressure, entryHeating } from '../src/sim/environment.js';
import { BODIES } from '../src/data/bodies.js';
import { AU } from '../src/constants.js';

let failed = 0;
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
  if (!ok) failed++;
};
const byId = Object.fromEntries(BODIES.map((b) => [b.id, b]));
const base = { solarFlux: 0, heatFlux: 0, dynPressure: 0, pressure: 0, airTemp: null, airDensity: 0, radiation: 0, ringHazard: 0, insideSun: false, landed: false };

/** Seconds until the hull is destroyed (or Infinity within maxT). */
function timeToDeath(env, maxT = 3600) {
  const s = new ShipSystems();
  const dt = 0.05;
  for (let t = 0; t < maxT; t += dt) {
    s.update({ ...base, ...env, dt, now: t });
    if (s.destroyed) return { t, cause: s.cause };
  }
  return { t: Infinity, cause: '' };
}

// ---- The Sun ------------------------------------------------------------------------------------
const at1 = timeToDeath({ solarFlux: solarFlux(1 * AU) });
check('Safe at Earth’s distance from the Sun', at1.t === Infinity);
const at02 = timeToDeath({ solarFlux: solarFlux(0.2 * AU) });
check('Survivable at 0.2 AU', at02.t === Infinity);
const at003 = timeToDeath({ solarFlux: solarFlux(0.03 * AU) });
check('Burns up within a minute at 0.03 AU', at003.t < 60, `${at003.t.toFixed(0)} s: ${at003.cause}`);
const inside = timeToDeath({ solarFlux: solarFlux(0.004 * AU), insideSun: true });
check('Vaporised inside the photosphere', inside.t < 0.1, inside.cause);

// ---- Giant planets and Venus ---------------------------------------------------------------------
const jup = byId.jupiter;
const crushAlt = depthForPressure({ atmosphere: jup.atmosphere }, 330e5);
const deep = atmosphereAt({ atmosphere: jup.atmosphere }, crushAlt);
const crush = timeToDeath({ pressure: deep.pressure, airTemp: deep.temperature, airDensity: deep.density });
check('Jupiter crushes the ship near 330 bar', crush.t < 5, `${(-crushAlt / 1000).toFixed(0)} km below the cloud tops, ${crush.cause}`);
const ven = byId.venus;
const vs = atmosphereAt({ atmosphere: ven.atmosphere }, 0);
const venus = timeToDeath({ pressure: vs.pressure, airTemp: vs.temperature, airDensity: vs.density, landed: true });
check('The ship lasts minutes, not hours, on Venus’ surface', venus.t > 60 && venus.t < 1800, `${(venus.t / 60).toFixed(1)} min, ${(vs.pressure / 1e5).toFixed(0)} bar, ${(vs.temperature - 273).toFixed(0)} °C`);

// ---- Entry ----------------------------------------------------------------------------------------
const mars = byId.mars;
const m30 = atmosphereAt({ atmosphere: mars.atmosphere }, 30e3);
const q = entryHeating(m30.density, 5500);
check('Mars entry at 5.5 km/s heats the nose by hundreds of kW/m²', q > 1e5 && q < 3e6, `${(q / 1e3).toFixed(0)} kW/m² at 30 km`);
const hotEntry = timeToDeath({ heatFlux: entryHeating(atmosphereAt({ atmosphere: byId.titan.atmosphere }, 120e3).density, 9000) });
check('A fast plunge into Titan’s thick air burns up the ship', hotEntry.t < 30, `${hotEntry.t.toFixed(1)} s`);

// ---- Spacesuit ------------------------------------------------------------------------------------
const suitTime = (env, maxT = 3600) => {
  const s = new SuitSystems();
  for (let t = 0; t < maxT; t += 0.1) {
    s.update({ ...env, dt: 0.1, now: t });
    if (s.dead) return t;
  }
  return Infinity;
};
const moonDay = suitTime({ temp: 380, pressure: 0, radiation: 0.0001, breathable: false });
check('Ten minutes of life support on the Moon', moonDay > 600 && moonDay < 700, `${(moonDay / 60).toFixed(1)} min`);
const venusFoot = suitTime({ temp: vs.temperature, pressure: vs.pressure, radiation: 0, breathable: false });
check('Seconds to live on foot on Venus', venusFoot < 10, `${venusFoot.toFixed(1)} s`);
const io = suitTime({ temp: 130, pressure: 0, radiation: 1.5, breathable: false });
check('Io’s radiation kills within a few minutes', io < 300, `${io.toFixed(0)} s`);

// Heat damage switched off: entry heating, the Sun's heat and hot air leave the hull intact.
{
  const sys = new ShipSystems();
  sys.heatImmune = true;
  for (let i = 0; i < 600; i++) sys.update({ dt: 0.1, now: i * 0.1, solarFlux: 5e6, heatFlux: 5e6, dynPressure: 0, pressure: 0, airTemp: 1500, airDensity: 1, radiation: 0, ringHazard: 0 });
  sys.update({ dt: 0.1, now: 61, insideSun: true, solarFlux: 0, heatFlux: 0, dynPressure: 0, pressure: 0, radiation: 0, ringHazard: 0 });
  check('With heat damage off the hull survives any heating', !sys.destroyed && sys.hull === 100, `hull ${sys.hull.toFixed(0)}%, ${Math.round(sys.hullTemp)} K`);
  const hot = new ShipSystems();
  for (let i = 0; i < 600 && !hot.destroyed; i++) hot.update({ dt: 0.1, now: i * 0.1, solarFlux: 0, heatFlux: 5e6, dynPressure: 0, pressure: 0, radiation: 0, ringHazard: 0 });
  check('…and with it on, the same heating burns the ship up', hot.destroyed, hot.cause);
}

// Infinite suit shield: Venus' surface and Io's radiation can't hurt you; oxygen still runs down.
{
  const suit = new SuitSystems();
  suit.infiniteShield = true;
  for (let i = 0; i < 3000; i++) suit.update({ dt: 0.1, now: i * 0.1, temp: 737, pressure: 92e5, radiation: 1.5, breathable: false });
  check('With the infinite suit shield, Venus and Io radiation do no harm for 5 minutes', !suit.dead && suit.health === 100 && suit.hazard === 100, `health ${suit.health.toFixed(0)}%, shield ${suit.hazard.toFixed(0)}%, oxygen ${suit.lifeSupport.toFixed(0)}%`);
}

console.log(failed ? `\n${failed} hazard test(s) failed.` : '\nAll hazard tests passed.');
process.exit(failed ? 1 : 0);
