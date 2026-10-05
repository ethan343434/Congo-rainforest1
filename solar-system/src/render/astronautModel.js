// =============================================================================
// astronautModel.js — the player on foot: a white pressure suit with a gold
// visor, life-support backpack, helmet lamp and jetpack nozzles, with a
// procedural walk/run/jump animation. ~1.85 m tall, origin at the feet,
// facing +Z, up +Y.
// =============================================================================
import * as THREE from 'three';

export class AstronautModel {
  constructor() {
    const suit = new THREE.MeshStandardMaterial({ color: 0xe9e6df, roughness: 0.78, metalness: 0 });
    const soft = new THREE.MeshStandardMaterial({ color: 0xcfcac0, roughness: 0.9, metalness: 0 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b2f35, roughness: 0.55, metalness: 0.5 });
    const visor = new THREE.MeshStandardMaterial({ color: 0xc89a3a, roughness: 0.08, metalness: 1.0, envMapIntensity: 1.2 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xe0702a, roughness: 0.5, metalness: 0.1 });
    this.materials = [suit, soft, dark, visor, accent];
    this.visor = visor;
    const shadow = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
    const mesh = (g, m) => shadow(new THREE.Mesh(g, m));

    this.root = new THREE.Group();
    this.hips = new THREE.Group();
    this.hips.position.y = 0.98;
    this.root.add(this.hips);

    // Torso and backpack.
    this.torso = new THREE.Group();
    this.hips.add(this.torso);
    const chest = mesh(new THREE.CapsuleGeometry(0.21, 0.36, 6, 16), suit);
    chest.scale.set(1.15, 1, 0.82);
    chest.position.y = 0.32;
    this.torso.add(chest);
    const belly = mesh(new THREE.CylinderGeometry(0.2, 0.19, 0.18, 16), soft);
    belly.position.y = 0.04;
    this.torso.add(belly);
    const pack = mesh(new THREE.BoxGeometry(0.46, 0.62, 0.24), suit);
    pack.position.set(0, 0.38, -0.25);
    this.torso.add(pack);
    const packTop = mesh(new THREE.BoxGeometry(0.4, 0.1, 0.2), dark);
    packTop.position.set(0, 0.72, -0.25);
    this.torso.add(packTop);
    const box = mesh(new THREE.BoxGeometry(0.22, 0.13, 0.08), dark);
    box.position.set(0, 0.3, 0.2);
    this.torso.add(box);
    const stripe = mesh(new THREE.BoxGeometry(0.06, 0.4, 0.02), accent);
    stripe.position.set(0.16, 0.36, 0.18);
    this.torso.add(stripe);
    // Jetpack nozzles + flames.
    this.flames = [];
    this.flameMat = new THREE.MeshBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
    for (const sx of [-0.13, 0.13]) {
      const n = mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.1, 12), dark);
      n.position.set(sx, 0.04, -0.3);
      this.torso.add(n);
      const fg = new THREE.ConeGeometry(0.06, 0.5, 12, 1, true);
      fg.translate(0, -0.25, 0);
      fg.rotateX(Math.PI);
      const f = new THREE.Mesh(fg, this.flameMat);
      f.rotation.x = Math.PI;
      f.position.set(sx, -0.01, -0.3);
      f.visible = false;
      this.torso.add(f);
      this.flames.push(f);
    }

    // Helmet.
    this.head = new THREE.Group();
    this.head.position.y = 0.72;
    this.torso.add(this.head);
    const shell = mesh(new THREE.SphereGeometry(0.17, 28, 20), suit);
    shell.position.y = 0.06;
    this.head.add(shell);
    const vis = mesh(new THREE.SphereGeometry(0.152, 28, 20, -Math.PI * 0.42, Math.PI * 0.84, Math.PI * 0.26, Math.PI * 0.42), visor);
    vis.position.set(0, 0.06, 0.03);
    vis.rotation.y = 0;
    this.head.add(vis);
    const ring = mesh(new THREE.TorusGeometry(0.14, 0.03, 10, 24), dark);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.08;
    this.head.add(ring);
    const lampHousing = mesh(new THREE.BoxGeometry(0.05, 0.04, 0.06), dark);
    lampHousing.position.set(0.15, 0.13, 0.06);
    this.head.add(lampHousing);
    this.lampGlow = new THREE.Mesh(new THREE.CircleGeometry(0.018, 12), new THREE.MeshBasicMaterial({ color: 0xfff4dd }));
    this.lampGlow.position.set(0.15, 0.13, 0.092);
    this.head.add(this.lampGlow);
    this.lamp = new THREE.SpotLight(0xfff1dc, 0, 70, 0.55, 0.45, 1.6);
    this.lamp.position.set(0.15, 0.13, 0.1);
    this.lamp.target.position.set(0.15, -0.6, 3);
    this.head.add(this.lamp, this.lamp.target);

    // Limbs: pivot groups so they can swing.
    const limb = (len, r, mat) => {
      const g = new THREE.Group();
      const m = mesh(new THREE.CapsuleGeometry(r, len, 4, 12), mat);
      m.position.y = -len / 2;
      g.add(m);
      return g;
    };
    this.arms = [];
    for (const side of [-1, 1]) {
      const shoulder = limb(0.26, 0.075, suit);
      shoulder.position.set(side * 0.29, 0.5, 0);
      this.torso.add(shoulder);
      const elbow = limb(0.24, 0.068, suit);
      elbow.position.y = -0.33;
      shoulder.add(elbow);
      const glove = mesh(new THREE.SphereGeometry(0.075, 12, 10), dark);
      glove.position.y = -0.33;
      glove.scale.set(0.9, 1.1, 0.8);
      elbow.add(glove);
      this.arms.push({ shoulder, elbow, side });
    }
    this.legs = [];
    for (const side of [-1, 1]) {
      const hip = limb(0.36, 0.095, suit);
      hip.position.set(side * 0.12, 0, 0);
      this.hips.add(hip);
      const knee = limb(0.34, 0.085, suit);
      knee.position.y = -0.46;
      hip.add(knee);
      const boot = mesh(new THREE.BoxGeometry(0.15, 0.12, 0.28), soft);
      boot.position.set(0, -0.45, 0.05);
      knee.add(boot);
      this.legs.push({ hip, knee, side });
    }
    this.phase = 0;
    this.air = 0;
    this.lampOn = false;
  }

  setEnvMap(env) {
    for (const m of this.materials) { m.envMap = env; m.envMapIntensity = m === this.visor ? 1.3 : 0.35; m.needsUpdate = true; }
  }

  setLamp(on) {
    this.lampOn = on;
    this.lamp.intensity = on ? 60 : 0;
    this.lampGlow.material.color.set(on ? 0xffffff : 0x555555);
  }

  /** state: { speed, run, onGround, jetting, dt } */
  update(s) {
    const dt = s.dt;
    const moving = Math.min(1, s.speed / 1.2);
    this.phase += dt * (s.run ? 7.2 : 5.2) * (0.35 + 0.65 * moving) * Math.max(1, Math.sqrt(s.speed / 4.3)); // faster legs at a sprint
    this.air += ((s.onGround ? 0 : 1) - this.air) * Math.min(1, dt * 6);
    const a = Math.sin(this.phase) * moving * (s.run ? 0.75 : 0.5) * (1 - this.air);
    for (const l of this.legs) {
      const p = a * l.side;
      l.hip.rotation.x = -p - this.air * 0.35;
      l.knee.rotation.x = Math.max(0, -Math.sin(this.phase + (l.side > 0 ? 0 : Math.PI) + 0.6) * moving * 0.9) + this.air * 0.6;
    }
    for (const m of this.arms) {
      m.shoulder.rotation.x = a * m.side * 0.8 + this.air * -0.5;
      m.shoulder.rotation.z = m.side * (0.12 + this.air * 0.35);
      m.elbow.rotation.x = -0.35 - moving * 0.35;
    }
    this.hips.position.y = 0.98 + Math.abs(Math.cos(this.phase)) * 0.04 * moving * (1 - this.air);
    this.torso.rotation.x = 0.06 + moving * (s.run ? 0.16 : 0.07);
    for (const f of this.flames) {
      f.visible = s.jetting;
      if (s.jetting) f.scale.set(1, 0.7 + Math.random() * 0.6, 1);
    }
  }
}
