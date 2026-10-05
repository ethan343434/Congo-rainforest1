// =============================================================================
// cutscene.js — the escape: the survivor walks into the village and his
// family runs out to hug him.
//
// A tiny timeline: three camera shots, scripted movement, captions, and a
// fade at the end. Runs as its own game state ('cutscene') so it is easy to
// extend with more shots later.
// =============================================================================
import * as THREE from 'three';
import { makeHuman, Pose } from './models.js';
import { smoothstep, lerp } from './utils.js';

const DURATION = 19;

export class Cutscene {
  constructor(world, camera, ui, audio) {
    this.world = world;
    this.camera = camera;
    this.ui = ui;
    this.audio = audio;
    this.t = 0;
    this.done = false;

    const v = world.village;
    this.forward = v.outward.clone(); // into the village
    this.right = new THREE.Vector3(-this.forward.z, 0, this.forward.x);
    this.meet = v.entrance.clone().addScaledVector(this.forward, 9);

    // The survivor: dusty, torn clothes after days in the jungle.
    this.hero = makeHuman({ skin: 0xc8946c, top: 0x8a7a58, sleeve: 0x7a6a4a, bottom: 0x3e3a2e, hair: 0x2a1a10, height: 1.8, torn: true });
    this.heroStart = v.entrance.clone().addScaledVector(this.forward, 3);
    this.heroEnd = this.meet.clone();
    this.hero.root.position.copy(this.heroStart);
    world.root.add(this.hero.root);

    // Family members and where each ends up for the hug.
    this.family = v.family.map((f, k) => ({
      ...f,
      start: f.root.position.clone(),
      end: k === 0
        ? this.meet.clone().addScaledVector(this.forward, 0.34)
        : this.meet.clone().addScaledVector(this.forward, 0.22).addScaledVector(this.right, k === 1 ? 0.42 : -0.42),
      speed: k === 0 ? 1 : 1.25,
    }));
  }

  start() {
    this.world.village.cutsceneActive = true;
    // Warm "firelight" so the reunion reads clearly even if you arrive at night.
    // (The lights exist from the start at zero intensity, so no shader recompile hitch.)
    const { key, fill } = this.world.village.cutsceneLights;
    key.position.copy(this.meet).addScaledVector(this.right, 2.5).addScaledVector(this.forward, 2).setY(3.2);
    key.intensity = 40;
    fill.intensity = 0.35;
    this.ui.letterbox(true);
    this.ui.fade(1, 0);
    this.ui.fade(0, 1.2);
    this.audio.play('swell');
    this.captions = [
      { at: 6.5, text: 'You made it out of the Congo.' },
      { at: 10.5, text: 'They never stopped waiting for you.' },
      { at: 14.5, text: "You're home." },
    ];
  }

  update(dt) {
    if (this.done) return true;
    this.t += dt;
    const t = this.t;
    const f = this.forward;

    // --- Hero walks in, then hugs ---
    const walk = smoothstep(0.5, 5.2, t);
    this.hero.root.position.lerpVectors(this.heroStart, this.heroEnd, walk);
    this.hero.root.lookAt(this.hero.root.position.clone().add(f));
    if (t < 5.2) Pose.walk(this.hero.parts, t, 0.8);
    else Pose.hug(this.hero.parts, t, smoothstep(5.2, 6.2, t));

    // --- Family runs out to meet him ---
    this.family.forEach((m, k) => {
      const run = smoothstep(1.6 + k * 0.15, 5.4, t);
      m.root.position.lerpVectors(m.start, m.end, run);
      m.root.lookAt(this.hero.root.position.x, 0, this.hero.root.position.z);
      if (run < 1 && t > 1.6) Pose.walk(m.parts, t + k, 1.6 * m.speed);
      else if (t > 5.2) Pose.hug(m.parts, t + k, smoothstep(5.2, 6.0, t) * (k ? 0.75 : 1));
      else Pose.idle(m.parts, t);
    });

    // Villagers cheer once the family reaches him.
    if (t > 6) this.world.village.villagers.forEach((v, k) => Pose.cheer(v.parts, t + k));

    // --- Camera shots ---
    const heroPos = this.hero.root.position;
    const look = new THREE.Vector3();
    if (t < 5.5) {
      // Shot 1: over the shoulder as he stumbles out of the trees.
      const p = heroPos.clone().addScaledVector(f, -3.2).addScaledVector(this.right, 1.1);
      p.y = 2.2;
      this.camera.position.lerp(p, Math.min(1, dt * 4 + (t < 0.1 ? 1 : 0)));
      look.copy(heroPos).addScaledVector(f, 8).setY(1.5);
    } else if (t < 13) {
      // Shot 2: slow orbit around the embrace.
      const a = lerp(-0.9, 0.5, smoothstep(5.5, 13, t));
      const centre = this.meet.clone().addScaledVector(f, 0.3);
      const dir = this.right.clone().multiplyScalar(Math.cos(a)).addScaledVector(f, Math.sin(a));
      const p = centre.clone().addScaledVector(dir, lerp(4.2, 3.0, smoothstep(5.5, 13, t)));
      p.y = 1.6;
      if (t - dt < 5.5) this.camera.position.copy(p);
      else this.camera.position.lerp(p, Math.min(1, dt * 3));
      look.copy(centre).setY(1.15);
    } else {
      // Shot 3: rise up over the village and its fire.
      const k = smoothstep(13, 18, t);
      const centre = this.meet.clone();
      const p = centre.clone().addScaledVector(f, -6 - k * 8).addScaledVector(this.right, 3);
      p.y = 2 + k * 12;
      if (t - dt < 13) this.camera.position.copy(p);
      else this.camera.position.lerp(p, Math.min(1, dt * 2));
      look.copy(centre).addScaledVector(f, 6 * k).setY(1);
    }
    this.camera.lookAt(look);

    for (const c of this.captions) {
      if (!c.shown && t >= c.at) {
        c.shown = true;
        this.ui.caption(c.text);
      }
    }
    if (t > DURATION - 1.5 && !this.fading) {
      this.fading = true;
      this.ui.fade(1, 1.4);
    }
    if (t >= DURATION) {
      this.done = true;
      this.ui.caption('');
      this.ui.letterbox(false);
    }
    return this.done;
  }
}
