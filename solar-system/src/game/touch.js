// =============================================================================
// touch.js — on-screen controls for phones and tablets.
//
// * Left thumb: a floating joystick wherever you touch on the left side.
//   In the ship it is thrust (up/down) and roll (left/right); on foot it walks.
// * Right thumb: drag anywhere on the right side to steer the ship (like the
//   mouse's virtual stick) or to look around on foot.
// * Buttons: hold buttons for lift, boost, brake, jump, run and the laser; tap
//   buttons for everything else. They show only when they apply.
// Everything feeds the same Input object as the keyboard, so the game logic
// does not know the difference.
// =============================================================================

import { IS_TOUCH, toView, viewSize } from '../ui/view.js';

export { IS_TOUCH };

// [id, label, key code, hold?, when visible(ctx)]
const MAIN = [
  ['up', 'UP', 'Space', true, (c) => !c.foot && c.flying],
  ['down', 'DOWN', 'KeyC', true, (c) => !c.foot && c.flying],
  ['boost', 'BOOST', 'ShiftLeft', true, (c) => !c.foot && c.flying],
  ['brake', 'BRAKE', 'KeyX', true, (c) => !c.foot && c.flying && !c.pulse],
  ['jump', 'JUMP', 'Space', true, (c) => c.foot],
  ['jetdn', 'DOWN', 'KeyC', true, (c) => c.foot],
  ['run', 'RUN', 'ShiftLeft', true, (c) => c.foot],
  ['fire', 'FIRE', null, true, (c) => c.foot && c.armed],
  ['takeoff', 'TAKE OFF', 'Space', true, (c) => !c.foot && c.landed],
];
const CHIPS = [
  ['use', 'E', 'KeyE', false, (c) => c.foot || c.landed],
  ['land', 'LAND', 'KeyL', false, (c) => !c.foot && c.flying && !c.pulse && c.lowOverGround],
  ['auto', 'AUTOPILOT', 'KeyG', false, (c) => !c.foot && (c.flying || c.landed)],
  ['warp', 'WARP', 'KeyK', false, (c) => !c.foot && c.flying],
  ['pulse', 'PULSE', 'KeyJ', false, (c) => !c.foot && c.flying],
  ['target', 'TARGET', 'KeyT', false, (c) => !c.foot],
  ['assist', 'ASSIST', 'KeyZ', false, (c) => !c.foot && c.flying],
  ['view', 'VIEW', 'KeyV', false, (c) => !c.foot],
  ['scan', 'SCAN', 'KeyI', false, () => true],
  ['light', 'LIGHT', 'KeyF', false, () => true],
];

export class TouchControls {
  constructor(input) {
    this.input = input;
    this.stickId = null;
    this.lookId = null;
    this.buttons = new Map();
    document.body.classList.add('touch');
    // No pinch-zoom or double-tap zoom on iOS while playing.
    for (const ev of ['gesturestart', 'gesturechange', 'dblclick']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });

    // The pad sits under the HUD, so the compass list stays tappable.
    this.pad = el('div', 'touch-pad');
    this.ui = el('div', 'touch-ui');
    this.stickBase = el('div', 'touch-stick');
    this.stickKnob = el('i');
    this.stickBase.appendChild(this.stickKnob);
    this.main = el('div', 'touch-main');
    this.chips = el('div', 'touch-chips');
    this.pauseBtn = el('button', 'touch-pause');
    this.pauseBtn.type = 'button';
    this.pauseBtn.setAttribute('aria-label', 'Pause');
    this.pauseBtn.innerHTML = '<span></span><span></span>';
    this.ui.append(this.stickBase, this.main, this.chips, this.pauseBtn);
    document.body.append(this.pad, this.ui);

    for (const def of MAIN) this.addButton(def, this.main, 'tbtn');
    for (const def of CHIPS) this.addButton(def, this.chips, 'tchip');
    this.press(this.pauseBtn, 'Escape', false);

    this.pad.addEventListener('pointerdown', (e) => this.padDown(e));
    this.pad.addEventListener('pointermove', (e) => this.padMove(e));
    for (const ev of ['pointerup', 'pointercancel']) this.pad.addEventListener(ev, (e) => this.padUp(e));

    // Tell the player how it works, and swap keyboard hints for touch ones.
    const hint = document.querySelector('#menu p.small:not([id])');
    if (hint) hint.textContent = 'Left thumb: thrust or walk · right thumb: drag to steer or look';
    const card = document.querySelector('#help .card');
    if (card) {
      const p = el('p', null, 'note');
      p.textContent = 'On a phone: the left thumb is a joystick (thrust and roll in the ship, walking on foot); drag with the right thumb to steer or look around. The round buttons are held, the small ones tapped. The keys below are the keyboard equivalents.';
      card.insertBefore(p, card.children[1]);
    }
    this.setVisible(false);
  }

  addButton([id, label, code, hold, when], parent, cls) {
    const b = el('button', null, cls);
    b.type = 'button';
    b.textContent = label;
    parent.appendChild(b);
    this.buttons.set(id, { b, when });
    this.press(b, code, hold, id === 'fire');
  }

  /** Wire a button: hold buttons keep the key down while touched. */
  press(b, code, hold, fire = false) {
    const inp = this.input;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { b.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      b.classList.add('on');
      if (fire) { inp.fireHeld = true; return; }
      inp.actions.push(code);
      if (hold) inp.keys.add(code);
    });
    const up = () => {
      b.classList.remove('on');
      if (fire) inp.fireHeld = false;
      else if (hold) inp.keys.delete(code);
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up); // e.g. hidden while held
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  padDown(e) {
    e.preventDefault();
    const p = toView(e.clientX, e.clientY); // game coordinates (the page may be turned)
    const left = p.x < viewSize().w * 0.45;
    if (left && this.stickId === null) {
      this.stickId = e.pointerId;
      this.stickOrigin = p;
      this.stickBase.style.left = `${p.x}px`;
      this.stickBase.style.top = `${p.y}px`;
      this.stickBase.classList.add('on');
      this.moveStick(e);
    } else if (!left && this.lookId === null) {
      this.lookId = e.pointerId;
      this.lookStart = p;
      this.lookLast = p;
      this.input.dragging = true;
    } else return;
    try { this.pad.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }

  padMove(e) {
    if (e.pointerId === this.stickId) this.moveStick(e);
    else if (e.pointerId === this.lookId) {
      const inp = this.input;
      const p = toView(e.clientX, e.clientY);
      const { w, h } = viewSize();
      const r = Math.min(w, h) * 0.28;
      inp.stick.x = (p.x - this.lookStart.x) / r;
      inp.stick.y = (p.y - this.lookStart.y) / r;
      const m = Math.hypot(inp.stick.x, inp.stick.y);
      if (m > 1) { inp.stick.x /= m; inp.stick.y /= m; }
      inp.look.dx += (p.x - this.lookLast.x) * 2.2;
      inp.look.dy += (p.y - this.lookLast.y) * 2.2;
      this.lookLast = p;
    }
  }

  moveStick(e) {
    const R = 56;
    const p = toView(e.clientX, e.clientY);
    let dx = (p.x - this.stickOrigin.x) / R, dy = (p.y - this.stickOrigin.y) / R;
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    this.stickKnob.style.transform = `translate(${dx * R}px, ${dy * R}px)`;
    // Small dead zone so a resting thumb does not cancel the autopilot.
    const dz = (v) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
    this.input.analog.x = dz(dx);
    this.input.analog.y = dz(dy);
  }

  padUp(e) {
    if (e.pointerId === this.stickId) {
      this.stickId = null;
      this.input.analog.x = this.input.analog.y = 0;
      this.stickBase.classList.remove('on');
      this.stickKnob.style.transform = '';
    } else if (e.pointerId === this.lookId) {
      this.lookId = null;
      this.input.dragging = false;
    }
  }

  setVisible(v) {
    if (this.visible === v) return;
    this.visible = v;
    this.pad.hidden = this.ui.hidden = !v;
    if (!v) {
      // Let go of everything so nothing stays held behind a menu.
      for (const { b } of this.buttons.values()) b.classList.remove('on');
      for (const code of ['Space', 'KeyC', 'ShiftLeft', 'KeyX']) this.input.keys.delete(code);
      this.input.fireHeld = false;
      this.input.analog.x = this.input.analog.y = 0;
      this.input.dragging = false;
      this.stickId = this.lookId = null;
      this.stickBase.classList.remove('on');
    }
  }

  /** ctx: { playing, foot, flying, landed, pulse, armed, lowOverGround, useLabel } */
  update(ctx) {
    this.setVisible(ctx.playing);
    if (!ctx.playing) return;
    for (const [id, { b, when }] of this.buttons) {
      const show = when(ctx);
      if (b.hidden === show) b.hidden = !show;
      if (id === 'use' && b.textContent !== ctx.useLabel) b.textContent = ctx.useLabel;
    }
  }
}

function el(tag, id, cls) {
  const e = document.createElement(tag);
  if (id) e.id = id;
  if (cls) e.className = cls;
  return e;
}
