// =============================================================================
// cameraRig.js — where the camera sits each frame (in double-precision world
// coordinates; the renderer then moves the universe so the camera is at 0).
//
// Ship: a lagging third-person chase camera (mouse wheel zooms) or cockpit.
// On foot: an over-the-shoulder orbit camera with the planet's "up" as up.
// =============================================================================
import * as THREE from 'three';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'chase';         // chase | cockpit
    this.footMode = 'third';     // third | first
    this.zoom = 1;
    this.world = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.smoothQuat = new THREE.Quaternion();
    this.initialised = false;
    this.fov = 62;
    this.footYaw = 0;
    this.footPitch = -0.15;
    this.shakeT = 0;
  }

  toggleView(onFoot) {
    if (onFoot) this.footMode = this.footMode === 'third' ? 'first' : 'third';
    else this.mode = this.mode === 'chase' ? 'cockpit' : 'chase';
  }

  zoomBy(steps) {
    this.zoom = Math.max(0.55, Math.min(4, this.zoom * Math.pow(1.12, steps)));
  }

  updateShip(ship, dt, opts) {
    const shipWorld = ship.worldPos(_v);
    if (!this.initialised) { this.smoothQuat.copy(ship.quat); this.initialised = true; }
    // Lag the camera's orientation behind the ship for a sense of motion.
    const lag = opts.pulse ? 3.5 : 6;
    this.smoothQuat.slerp(ship.quat, 1 - Math.exp(-dt * lag));
    let targetFov = 62;
    if (this.mode === 'cockpit') {
      this.world.copy(shipWorld).add(new THREE.Vector3(0, 0.95, -2.9).applyQuaternion(ship.quat));
      this.quat.copy(ship.quat);
    } else {
      const pull = opts.pulse ? 1.35 : 1;
      const off = new THREE.Vector3(0, 4.0, 17).multiplyScalar(this.zoom * pull);
      this.world.copy(shipWorld).add(off.applyQuaternion(this.smoothQuat));
      // Keep the camera above the ground when skimming the surface.
      if (opts.minCamUp !== undefined && opts.upDir) {
        const above = this.world.clone().sub(shipWorld).dot(opts.upDir);
        if (above < opts.minCamUp) this.world.addScaledVector(opts.upDir, opts.minCamUp - above);
      }
      // Look slightly over the ship.
      const lookAt = shipWorld.clone().add(new THREE.Vector3(0, 1.4, -8).applyQuaternion(this.smoothQuat));
      _m.lookAt(this.world, lookAt, new THREE.Vector3(0, 1, 0).applyQuaternion(this.smoothQuat));
      this.quat.setFromRotationMatrix(_m);
    }
    if (opts.pulse) targetFov = 78;
    this.applyShake(dt, opts.shake || 0);
    this.fov += (targetFov - this.fov) * Math.min(1, dt * 3);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
  }

  /** On foot: orbit camera around the astronaut. look = { dx, dy } mouse deltas. */
  updateFoot(walker, dt, look) {
    this.footYaw -= look.dx * 0.0032;
    this.footPitch = Math.max(-1.35, Math.min(1.2, this.footPitch - look.dy * 0.0032));
    const frame = walker.frameWorld(); // { pos, up, north, east }
    const yawQ = _q.setFromAxisAngle(frame.up, this.footYaw);
    const fwd = frame.north.clone().applyQuaternion(yawQ);
    const right = new THREE.Vector3().crossVectors(fwd, frame.up).normalize();
    const pitchQ = new THREE.Quaternion().setFromAxisAngle(right, this.footPitch);
    const lookDir = fwd.clone().applyQuaternion(pitchQ);
    walker.cameraForward = fwd.clone();
    walker.cameraRight = right.clone();
    if (this.footMode === 'first') {
      this.world.copy(frame.pos).addScaledVector(frame.up, 1.62);
    } else {
      const dist = 4.2 * this.zoom;
      this.world.copy(frame.pos).addScaledVector(frame.up, 1.75).addScaledVector(lookDir, -dist).addScaledVector(right, 0.7);
      const minUp = walker.cameraClearance ?? 0.4;
      const above = this.world.clone().sub(frame.pos).dot(frame.up);
      if (above < minUp) this.world.addScaledVector(frame.up, minUp - above);
    }
    const target = this.world.clone().add(lookDir);
    _m.lookAt(this.world, target, frame.up);
    this.quat.setFromRotationMatrix(_m);
    this.fov += (66 - this.fov) * Math.min(1, dt * 3);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
  }

  applyShake(dt, amount) {
    if (amount <= 0) return;
    this.shakeT += dt * 40;
    const a = amount * 0.012;
    const e = new THREE.Euler(Math.sin(this.shakeT * 1.3) * a, Math.sin(this.shakeT * 1.7 + 1) * a, Math.sin(this.shakeT * 2.3 + 2) * a * 0.5);
    this.quat.multiply(new THREE.Quaternion().setFromEuler(e));
  }
}
