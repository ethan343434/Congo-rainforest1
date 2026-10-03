// =============================================================================
// hazards.js — survival systems for the ship and the spacesuit.
//
// Ship: a thermal model of the hull (sunlight, entry heating, hot air), plus
// structural limits (aerodynamic pressure, crushing depth, ring particles) and
// radiation. Calibrated so the hull fails around 0.02 AU from the Sun — about
// where a Parker Solar Probe-class heat shield would also be at its limit.
//
// Suit (on foot): life support (oxygen), hazard protection (heat, cold,
// radiation, crushing pressure), health and jetpack fuel, No Man's Sky style.
// =============================================================================
import { SIGMA, KELVIN } from '../constants.js';

const SHIP_ABSORPTIVITY = 0.35; // reflective hull vs sunlight
const SHIP_EMISSIVITY = 0.8;
const HEAT_CAPACITY = 9000;     // J/(m²·K) of hull skin
export const HULL_LIMITS = {
  damageTemp: 1300,     // K (≈1,030 °C) hull starts failing
  meltTemp: 2300,       // K: burns up
  dynPressureSafe: 80e3,
  dynPressureFatal: 450e3,
  pressureSafe: 100e5,  // 100 bar
  pressureFatal: 320e5,
  coolingLimit: 620,    // K ambient air the cooling system can reject indefinitely
  radiationShield: 0.08,
};

export class ShipSystems {
  constructor() { this.reset(); }

  reset() {
    this.hull = 100;
    this.hullTemp = 290;
    this.crewDose = 0;          // accumulated Sv
    this.lastDamageTime = -999;
    this.destroyed = false;
    this.cause = '';
    this.warnings = [];
  }

  damage(amount, cause, now) {
    if (this.destroyed || amount <= 0) return;
    this.hull -= amount;
    this.lastDamageTime = now;
    this.lastCause = cause;
    if (this.hull <= 0) this.destroy(cause);
  }

  destroy(cause) {
    if (this.destroyed) return;
    this.hull = 0;
    this.destroyed = true;
    this.cause = cause;
  }

  /**
   * env: { solarFlux (W/m², already shadowed), heatFlux, dynPressure, pressure,
   *        airTemp (K|null), airDensity, radiation (Sv/h), ringHazard (0..), insideSun,
   *        landed, now, dt }
   */
  update(env) {
    const { dt, now } = env;
    const w = [];
    if (this.destroyed) return w;
    if (env.insideSun) {
      this.destroy('Vaporized in the Sun’s photosphere (5,500 °C).');
      return w;
    }

    // ---- Thermal balance of the hull skin ----
    const solar = env.solarFlux || 0, heat = env.heatFlux || 0;
    let qIn = solar * SHIP_ABSORPTIVITY + heat;
    if (env.airTemp && env.airDensity > 0) {
      // Convection with the surrounding air (strong in thick atmospheres like Venus).
      const h = 6 * Math.sqrt(Math.max(env.airDensity, 0));
      qIn += h * (env.airTemp - this.hullTemp);
    }
    const qOut = SHIP_EMISSIVITY * SIGMA * this.hullTemp ** 4 - SHIP_EMISSIVITY * SIGMA * 3 ** 4;
    this.hullTemp += ((qIn - qOut) / HEAT_CAPACITY) * dt;
    this.hullTemp = Math.max(3, this.hullTemp);
    const T = this.hullTemp;
    if (T > HULL_LIMITS.meltTemp) {
      this.destroy(heat > solar * SHIP_ABSORPTIVITY
        ? 'Burned up: entry heating melted the hull.'
        : 'Burned up: the Sun’s heat melted the hull.');
      return w;
    }
    if (T > HULL_LIMITS.damageTemp) {
      const x = (T - HULL_LIMITS.damageTemp) / 200;
      this.damage(dt * (1.5 + 6 * x * x), heat > solar ? 'entry heating' : 'solar heating', now);
      w.push({ level: 'danger', text: `Hull temperature critical: ${Math.round(T - KELVIN).toLocaleString('en-US')} °C` });
    } else if (T > HULL_LIMITS.damageTemp - 250) {
      w.push({ level: 'caution', text: `Hull heating: ${Math.round(T - KELVIN).toLocaleString('en-US')} °C` });
    }
    if (env.airTemp && env.airTemp > HULL_LIMITS.coolingLimit) {
      this.damage(dt * 0.18 * (env.airTemp / HULL_LIMITS.coolingLimit), 'cooling overload', now);
      w.push({ level: 'caution', text: `Cooling overwhelmed: outside ${Math.round(env.airTemp - KELVIN)} °C` });
    }

    // ---- Structural loads ----
    if (env.dynPressure > HULL_LIMITS.dynPressureFatal) {
      this.destroy('Torn apart by aerodynamic pressure.');
      return w;
    }
    if (env.dynPressure > HULL_LIMITS.dynPressureSafe) {
      this.damage(dt * 4 * (env.dynPressure / HULL_LIMITS.dynPressureSafe - 1), 'aerodynamic stress', now);
      w.push({ level: 'danger', text: 'Structural stress: slow down!' });
    }
    if (env.pressure > HULL_LIMITS.pressureFatal) {
      this.destroy('Crushed by atmospheric pressure.');
      return w;
    }
    if (env.pressure > HULL_LIMITS.pressureSafe) {
      this.damage(dt * 6 * (env.pressure / HULL_LIMITS.pressureSafe - 1), 'crushing pressure', now);
      w.push({ level: 'danger', text: `Hull buckling: ${(env.pressure / 1e5).toFixed(0)} bar` });
    } else if (env.pressure > HULL_LIMITS.pressureSafe * 0.6) {
      w.push({ level: 'caution', text: `Pressure ${(env.pressure / 1e5).toFixed(0)} bar: approaching crush depth` });
    }

    // ---- Ring particles ----
    if (env.ringHazard > 0.01) {
      this.damage(dt * env.ringHazard, 'ring particle impacts', now);
      w.push({ level: env.ringHazard > 2 ? 'danger' : 'caution', text: 'Ring particle impacts' });
    }

    // ---- Radiation (crew dose and electronics) ----
    const dose = env.radiation * HULL_LIMITS.radiationShield; // Sv/h inside the ship
    this.crewDose += (dose * dt) / 3600;
    if (dose > 0.05) {
      this.damage(dt * dose * 0.6, 'radiation', now);
      w.push({ level: dose > 1 ? 'danger' : 'caution', text: `Radiation ${formatDose(dose)} inside the hull` });
    }

    // ---- Slow self-repair when safe ----
    if (now - this.lastDamageTime > 12 && this.hull < 100) {
      this.hull = Math.min(100, this.hull + dt * (env.landed ? 0.6 : 0.12));
    }
    this.warnings = w;
    return w;
  }
}

export class SuitSystems {
  constructor() { this.reset(); }

  reset() {
    this.health = 100;
    this.lifeSupport = 100;
    this.hazard = 100;
    this.jetpack = 100;
    this.lastHarm = -999;
    this.dead = false;
    this.cause = '';
    this.warnings = [];
  }

  /** Refill while inside the ship. */
  recharge(dt) {
    this.lifeSupport = Math.min(100, this.lifeSupport + dt * 25);
    this.hazard = Math.min(100, this.hazard + dt * 25);
    this.health = Math.min(100, this.health + dt * 4);
    this.jetpack = 100;
  }

  harm(amount, cause, now) {
    if (this.dead) return;
    this.health -= amount;
    this.lastHarm = now;
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      this.cause = cause;
    }
  }

  /** env: { temp (K), pressure (Pa), radiation (Sv/h), breathable, now, dt } */
  update(env) {
    const { dt, now } = env;
    const w = [];
    if (this.dead) return w;
    // Oxygen: 10 minutes of life support (no breathable air outside Earth).
    if (!env.breathable) this.lifeSupport = Math.max(0, this.lifeSupport - dt * (100 / 600));
    if (this.lifeSupport <= 0) {
      this.harm(dt * 4, 'Suffocated: life support ran out.', now);
      w.push({ level: 'danger', text: 'Life support depleted: return to the ship!' });
    } else if (this.lifeSupport < 25) {
      w.push({ level: 'caution', text: `Life support ${Math.ceil(this.lifeSupport)}%` });
    }
    // Hazard protection drains in extreme heat, cold, radiation or pressure.
    let drain = 0;
    const reasons = [];
    const T = env.temp;
    if (T !== null && T !== undefined) {
      if (T > 400) { drain += (T - 400) / 30; reasons.push(`heat ${Math.round(T - KELVIN)} °C`); }
      if (T < 110) { drain += (110 - T) / 45; reasons.push(`cold ${Math.round(T - KELVIN)} °C`); }
    }
    const dose = env.radiation * 0.5; // the suit blocks about half
    if (dose > 0.0008) { drain += Math.min(40, dose * 18); reasons.push(`radiation ${formatDose(dose)}`); }
    if (env.pressure > 4e5) { drain += (env.pressure / 4e5) * 3; reasons.push(`pressure ${(env.pressure / 1e5).toFixed(0)} bar`); }
    if (drain > 0) {
      this.hazard = Math.max(0, this.hazard - drain * dt);
      if (this.hazard <= 0) {
        this.harm(dt * Math.min(30, drain * 0.9), `Hazard protection failed (${reasons[0]}).`, now);
        w.push({ level: 'danger', text: `Hazard protection failed: ${reasons.join(', ')}` });
      } else {
        w.push({ level: this.hazard < 30 ? 'danger' : 'caution', text: `Hazard: ${reasons.join(', ')}` });
      }
    } else if (now - this.lastHarm > 6) {
      this.health = Math.min(100, this.health + dt * 1.2);
      this.hazard = Math.min(100, this.hazard + dt * 1.5);
    }
    this.warnings = w;
    return w;
  }
}

export function formatDose(svPerHour) {
  if (svPerHour >= 1) return `${svPerHour.toFixed(1)} Sv/h`;
  if (svPerHour >= 0.001) return `${(svPerHour * 1000).toFixed(svPerHour < 0.01 ? 2 : 0)} mSv/h`;
  return `${(svPerHour * 1e6).toFixed(svPerHour < 1e-5 ? 1 : 0)} µSv/h`;
}
