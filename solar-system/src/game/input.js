// =============================================================================
// input.js — keyboard + mouse. The mouse drives a "virtual stick": with
// pointer lock, mouse movement pushes the stick, which slowly re-centres; if
// pointer lock isn't available (some embedded frames), drag with the left
// button instead. Key presses are queued as one-shot actions. Touch controls
// (touch.js) feed the same keys, stick and look, plus the analog joystick.
// =============================================================================

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.actions = [];          // one-shot key presses (codes)
    this.stick = { x: 0, y: 0 }; // -1..1 steering (x = yaw, y = pitch)
    this.look = { dx: 0, dy: 0 }; // raw mouse look deltas (on foot)
    this.analog = { x: 0, y: 0 }; // touch joystick: x right, y down (-1..1)
    this.wheel = 0;
    this.locked = false;
    this.dragging = false;
    this.enabled = false;
    this.sensitivity = 0.0032;

    document.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.actions.push(e.code);
      this.keys.add(e.code);
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    this.fireHeld = false;
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (this.locked && e.button === 0) this.fireHeld = true;
      if (!this.locked) {
        this.requestLock();
        if (e.button === 0) { this.dragging = true; this.dragStart = { x: e.clientX, y: e.clientY }; }
      }
    });
    window.addEventListener('mouseup', () => { this.dragging = false; this.fireHeld = false; });
    document.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return; // pointer-lock jump glitch
      if (this.locked) {
        this.stick.x += e.movementX * this.sensitivity;
        this.stick.y += e.movementY * this.sensitivity;
        this.look.dx += e.movementX;
        this.look.dy += e.movementY;
      } else if (this.dragging) {
        const r = Math.min(window.innerWidth, window.innerHeight) * 0.25;
        this.stick.x = (e.clientX - this.dragStart.x) / r;
        this.stick.y = (e.clientY - this.dragStart.y) / r;
        this.look.dx += e.movementX * 1.6;
        this.look.dy += e.movementY * 1.6;
      }
      const m = Math.hypot(this.stick.x, this.stick.y);
      if (m > 1) { this.stick.x /= m; this.stick.y /= m; }
    });
    canvas.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      this.onLockChange?.(this.locked);
    });
  }

  requestLock() {
    try {
      const p = this.canvas.requestPointerLock?.();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* not allowed here: drag-to-steer still works */ }
  }

  releaseLock() {
    try { document.exitPointerLock?.(); } catch (e) { /* ignore */ }
  }

  down(...codes) {
    return codes.some((c) => this.keys.has(c));
  }

  axis(neg, pos) {
    return (this.down(...pos) ? 1 : 0) - (this.down(...neg) ? 1 : 0);
  }

  /** Re-centre the virtual stick a little each frame (pointer-lock mode). */
  decayStick(dt) {
    if (!this.locked) {
      if (!this.dragging) { this.stick.x *= Math.exp(-dt * 10); this.stick.y *= Math.exp(-dt * 10); }
      return;
    }
    const k = Math.exp(-dt * 1.4);
    this.stick.x *= k;
    this.stick.y *= k;
  }

  takeActions() {
    const a = this.actions;
    this.actions = [];
    return a;
  }

  takeLook() {
    const l = { ...this.look };
    this.look.dx = 0;
    this.look.dy = 0;
    return l;
  }

  takeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }
}
