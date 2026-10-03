// =============================================================================
// config.js — every tunable number in the game lives here.
// Change these to rebalance the game without hunting through the code.
// =============================================================================

export const CONFIG = {
  // ---- Maze layout --------------------------------------------------------
  maze: {
    size: 13,            // grid is size x size cells (odd number keeps the hub centred)
    cellSize: 10,        // world units per cell
    wallThickness: 2.6,  // thickness of the tree "walls" between corridors
    hubRadius: 1,        // hub = (2*hubRadius+1)^2 cells around the centre (3x3)
    branches: 5,         // number of paths radiating out of the crash-site hub
    wrongLoops: 4,       // extra connections that make wrong paths loop back to the hub
    braidChance: 0.55,   // chance a wrong-path dead end is opened up into a loop
  },

  // ---- Player ---------------------------------------------------------------
  player: {
    eyeHeight: 1.7,
    radius: 0.45,
    walkSpeed: 4.2,
    sprintSpeed: 8.5,
    sprintDuration: 5,   // seconds of sprint available from a full meter
    sprintCooldown: 10,  // seconds to refill the meter from empty
    jumpVelocity: 6.6,
    gravity: 18,
    maxHealth: 100,
    healthRegenDelay: 6, // seconds without damage before health slowly regenerates
    healthRegenRate: 1.5,
    mouseSensitivity: 0.0022,
    waterSlowdown: 0.5,
  },

  // ---- Flashlight -----------------------------------------------------------
  flashlight: {
    intensity: 140,
    distance: 42,
    angle: 0.5,
    penumbra: 0.55,
    batteryDrainPerSec: 100 / 300, // full battery lasts 5 minutes
    batteryPickup: 45,
    respawnMinBattery: 60,         // the wreckage always has a few spare cells
    emptyIntensityFactor: 0.12,    // a dead battery still gives a faint glow
    castShadows: true,             // tree trunks cast flashlight shadows (turn off if slow)
  },

  // ---- Time of day ----------------------------------------------------------
  time: {
    dayLengthSeconds: 480, // one full day/night cycle in real seconds
    startTime: 0.6,        // 0 = midnight, 0.25 = 6am, 0.5 = noon, 0.75 = 6pm
    deathTimePenalty: 1 / 24, // dying skips an hour
  },

  // ---- Hazards ----------------------------------------------------------------
  hazards: {
    swarmRadius: 6.5,
    swarmDamagePerSec: 11,
    nightAggression: 1.45, // predator detection range multiplier at night
  },

  // ---- Rendering -----------------------------------------------------------------
  render: {
    maxPixelRatio: 1.5,
    farPlane: 95,
  },

  debug: false,
};
