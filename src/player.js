// =============================================================================
// player.js — the first-person survivor.
//
// Handles mouse-look, WASD movement, the timed sprint (5 s burst, 10 s
// recharge), jumping with gravity, collision against the jungle, wading in the
// river shallows, health, and the battery-powered flashlight.
// =============================================================================
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp } from './utils.js';

const P = CONFIG.player;
const F = CONFIG.flashlight;

export class Player {
  constructor(camera, scene) {
    this.camera = camera;
    this.position = new THREE.Vector3(); // feet position
    this.velocityY = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = true;
    this.keys = new Set();
    this.jumpQueued = false;

    this.health = P.maxHealth;
    this.sprint = 1;           // 0..1 meter
    this.sprintLocked = false; // true after emptying the meter until it refills
    this.sprinting = false;
    this.battery = 100;
    this.flashlightOn = true;
    this.lastDamageTime = -999;
    this.inWater = false;
    this.alive = true;
    this.stepPhase = 0;
    this.speedNow = 0;
    this.onStep = null;   // footstep callback (audio)
    this.onDamage = null; // (amount, sourceName) => void

    // Flashlight: a spotlight that rides on the camera, plus a faint fill light
    // so the player is never in absolute pitch black.
    this.flashlight = new THREE.SpotLight(0xfff1d6, F.intensity, F.distance, F.angle, F.penumbra, 1.5);
    this.flashlight.position.set(0.25, -0.25, 0);
    this.flashlight.target.position.set(0, -0.6, -10);
    this.flashlight.castShadow = F.castShadows;
    this.flashlight.shadow.mapSize.set(1024, 1024);
    this.flashlight.shadow.camera.near = 0.4;
    this.flashlight.shadow.camera.far = F.distance;
    this.flashlight.shadow.bias = -0.0015;
    camera.add(this.flashlight);
    camera.add(this.flashlight.target);
    this.fill = new THREE.PointLight(0xb8c8ff, 0.6, 7, 2);
    camera.add(this.fill);
    scene.add(camera);

    this.flickerTimer = 0;
  }

  // ---- Input ---------------------------------------------------------------
  onKey(code, down) {
    if (down) {
      this.keys.add(code);
      if (code === 'Space') this.jumpQueued = true;
      if (code === 'KeyF') this.flashlightOn = !this.flashlightOn;
    } else this.keys.delete(code);
  }
  onMouseMove(dx, dy) {
    this.yaw -= dx * P.mouseSensitivity;
    this.pitch = clamp(this.pitch - dy * P.mouseSensitivity, -1.45, 1.45);
  }
  clearInput() {
    this.keys.clear();
    this.jumpQueued = false;
  }

  // ---- Lifecycle -------------------------------------------------------------
  spawn(spawn) {
    this.position.copy(spawn.position);
    this.yaw = spawn.yaw;
    this.pitch = 0;
    this.velocityY = 0;
    this.health = P.maxHealth;
    this.sprint = 1;
    this.sprintLocked = false;
    this.battery = Math.max(this.battery, F.respawnMinBattery);
    this.alive = true;
    this.lastDamageTime = -999;
    this.clearInput();
    this.syncCamera(0);
  }

  damage(amount, source, now) {
    if (!this.alive) return;
    this.health = Math.max(0, this.health - amount);
    this.lastDamageTime = now;
    if (this.onDamage) this.onDamage(amount, source);
    if (this.health <= 0) {
      this.alive = false;
      this.killedBy = source;
    }
  }

  heal(amount) {
    this.health = Math.min(P.maxHealth, this.health + amount);
  }

  // ---- Per-frame update -------------------------------------------------------
  update(dt, now, world) {
    if (!this.alive) return;
    const k = this.keys;

    // Direction from WASD, relative to where the camera faces.
    let fx = 0, fz = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) fz -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) fz += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) fx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) fx += 1;
    const moving = fx !== 0 || fz !== 0;
    const len = Math.hypot(fx, fz) || 1;
    fx /= len; fz /= len;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const dirX = fx * cos + fz * sin;
    const dirZ = -fx * sin + fz * cos;

    // Sprint: a 5-second burst; once emptied it is locked until fully recharged
    // (10 s from empty). Releasing early starts recharging straight away.
    const wantsSprint = (k.has('ShiftLeft') || k.has('ShiftRight')) && moving && fz <= 0;
    this.sprinting = wantsSprint && !this.sprintLocked && this.sprint > 0;
    if (this.sprinting) {
      this.sprint -= dt / P.sprintDuration;
      if (this.sprint <= 0) {
        this.sprint = 0;
        this.sprintLocked = true;
        this.sprinting = false;
      }
    } else if (this.sprint < 1) {
      this.sprint = Math.min(1, this.sprint + dt / P.sprintCooldown);
      if (this.sprint >= 1) this.sprintLocked = false;
    }

    this.inWater = world.river.isWater(this.position.x, this.position.z);
    let speed = this.sprinting ? P.sprintSpeed : P.walkSpeed;
    if (this.inWater) speed *= P.waterSlowdown;
    if (!moving) speed = 0;
    this.speedNow = speed;

    // Move in small sub-steps so fast sprinting never tunnels through walls.
    const dist = speed * dt;
    const steps = Math.max(1, Math.ceil(dist / 0.25));
    for (let i = 0; i < steps; i++) {
      this.position.x += (dirX * dist) / steps;
      this.position.z += (dirZ * dist) / steps;
      world.colliders.resolve(this.position, P.radius, this.position.y, 1.8);
    }

    // Jumping and gravity (jump clears fallen logs, not tree walls).
    if (this.jumpQueued && this.onGround) {
      this.velocityY = P.jumpVelocity;
      this.onGround = false;
    }
    this.jumpQueued = false;
    this.velocityY -= P.gravity * dt;
    this.position.y += this.velocityY * dt;
    const groundY = world.colliders.groundHeight(this.position.x, this.position.z, P.radius, this.position.y);
    if (this.position.y <= groundY) {
      if (!this.onGround && this.velocityY < -4 && this.onStep) this.onStep(true);
      this.position.y = groundY;
      this.velocityY = 0;
      this.onGround = true;
    } else if (this.position.y > groundY + 0.05) {
      this.onGround = false;
    }

    // Footsteps + head bob.
    if (this.onGround && speed > 0) {
      const before = Math.floor(this.stepPhase / Math.PI);
      this.stepPhase += dt * speed * 2.1;
      if (Math.floor(this.stepPhase / Math.PI) !== before && this.onStep) this.onStep(false, this.inWater);
    }

    // Slow health regeneration after a quiet spell.
    if (now - this.lastDamageTime > P.healthRegenDelay) this.heal(P.healthRegenRate * dt);

    // Flashlight battery.
    if (this.flashlightOn) this.battery = Math.max(0, this.battery - F.batteryDrainPerSec * dt);
    this.updateFlashlight(dt);
    this.syncCamera(dt);
  }

  updateFlashlight(dt) {
    let level = this.flashlightOn ? 1 : 0;
    if (this.flashlightOn) {
      if (this.battery <= 0) level = F.emptyIntensityFactor;
      else if (this.battery < 15) level = 0.45 + (this.battery / 15) * 0.55;
      // Occasional flicker, more often when the battery is low.
      this.flickerTimer -= dt;
      const flickerChance = this.battery < 15 ? 0.08 : 0.004;
      if (this.flickerTimer <= 0 && Math.random() < flickerChance) this.flickerTimer = 0.05 + Math.random() * 0.15;
      if (this.flickerTimer > 0) level *= 0.25 + Math.random() * 0.3;
    }
    this.flashlight.intensity = F.intensity * level;
    this.flashlight.visible = level > 0;
  }

  syncCamera() {
    const bob = this.onGround ? Math.sin(this.stepPhase) * 0.045 * Math.min(1, this.speedNow / P.walkSpeed) : 0;
    this.camera.position.set(this.position.x, this.position.y + P.eyeHeight + bob, this.position.z);
    this.camera.rotation.set(this.pitch, this.yaw, Math.sin(this.stepPhase * 0.5) * 0.006 * this.speedNow, 'YXZ');
  }

  /** Point in front of the camera, used for "press E" interactions. */
  forward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }
}
