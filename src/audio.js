// =============================================================================
// audio.js — every sound is synthesised with the Web Audio API (no files).
//
// Ambience (day birds / night insects + frogs), footsteps, animal calls, the
// mosquito buzz, village drums, a tension drone when hunted, and the reunion
// swell. If audio is unavailable everything silently becomes a no-op.
// =============================================================================

export class AudioManager {
  constructor() {
    this.enabled = false;
    this.listener = { x: 0, z: 0, yaw: 0 };
    this.nextBird = 0;
    this.nextFrog = 0;
    this.nextDrum = 0;
    this.drumStep = 0;
    this.nextBeat = 0;
    this.levels = { darkness: 0, buzz: 0, drums: 0, threat: 0 };
  }

  /** Must be called from a user gesture (the Begin button). */
  init() {
    if (this.ctx) {
      this.ctx.resume?.();
      return;
    }
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = (this.ctx = new Ctx());
      this.master = ctx.createGain();
      this.master.gain.value = 0.8;
      const comp = ctx.createDynamicsCompressor();
      this.master.connect(comp).connect(ctx.destination);

      const len = ctx.sampleRate * 2;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

      // Day air: soft rustling canopy.
      this.dayBed = this.loopNoise('bandpass', 700, 0.4);
      // Night insects: high cicada shimmer with a pulsing tremolo.
      this.nightBed = this.loopNoise('bandpass', 5200, 6);
      const trem = ctx.createOscillator();
      const tremGain = ctx.createGain();
      trem.frequency.value = 24;
      tremGain.gain.value = 0.5;
      trem.connect(tremGain).connect(this.nightBed.amp.gain);
      trem.start();

      // Mosquito buzz: two detuned sawtooth whines.
      this.buzz = ctx.createGain();
      this.buzz.gain.value = 0;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900;
      bp.Q.value = 2;
      for (const f of [560, 567, 1130]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        const lfo = ctx.createOscillator();
        const lg = ctx.createGain();
        lfo.frequency.value = 3 + Math.random() * 4;
        lg.gain.value = 25;
        lfo.connect(lg).connect(o.frequency);
        o.connect(bp);
        o.start();
        lfo.start();
      }
      bp.connect(this.buzz).connect(this.master);

      // Tension drone when something is hunting you.
      this.drone = ctx.createGain();
      this.drone.gain.value = 0;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 180;
      for (const f of [55, 82.4, 58]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.connect(lp);
        o.start();
      }
      lp.connect(this.drone).connect(this.master);

      this.enabled = true;
    } catch (e) {
      console.warn('Audio disabled:', e);
      this.enabled = false;
    }
  }

  loopNoise(type, freq, q) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const amp = ctx.createGain();
    amp.gain.value = 0.5;
    const out = ctx.createGain();
    out.gain.value = 0;
    src.connect(f).connect(amp).connect(out).connect(this.master);
    src.start();
    return { out, amp, filter: f };
  }

  setListener(x, z, yaw) {
    this.listener.x = x;
    this.listener.z = z;
    this.listener.yaw = yaw;
  }

  /** Gain + stereo pan for a sound at a world position. */
  spatial(pos, range = 10) {
    if (!pos) return { gain: 1, pan: 0 };
    const dx = pos.x - this.listener.x;
    const dz = pos.z - this.listener.z;
    const d = Math.hypot(dx, dz);
    const gain = 1 / (1 + (d / range) ** 2);
    // Angle relative to where the player faces (-z forward rotated by yaw).
    const ang = Math.atan2(dx, dz) - (this.listener.yaw + Math.PI);
    return { gain, pan: Math.max(-1, Math.min(1, -Math.sin(ang))) };
  }

  out(pan) {
    const ctx = this.ctx;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      p.connect(this.master);
      return p;
    }
    return this.master;
  }

  // ---- Synth primitives -----------------------------------------------------------
  noiseHit({ type = 'bandpass', freq = 1000, q = 1, dur = 0.2, gain = 0.5, attack = 0.005, pan = 0, when = 0, freqEnd }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out(pan));
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  tone({ type = 'sine', f0 = 440, f1, dur = 0.3, gain = 0.3, attack = 0.01, pan = 0, when = 0, vibrato = 0 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    if (vibrato) {
      const l = ctx.createOscillator();
      const lg = ctx.createGain();
      l.frequency.value = 6;
      lg.gain.value = vibrato;
      l.connect(lg).connect(o.frequency);
      l.start(t);
      l.stop(t + dur);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out(pan));
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // ---- One-shot sounds -------------------------------------------------------------
  play(name, pos) {
    if (!this.enabled) return;
    try {
      const { gain: g, pan } = this.spatial(pos, name === 'trumpet' ? 25 : 12);
      if (g < 0.01) return;
      switch (name) {
        case 'growl':
          this.noiseHit({ type: 'lowpass', freq: 380, dur: 1.4, gain: 0.9 * g, attack: 0.15, pan });
          this.tone({ type: 'sawtooth', f0: 78, f1: 52, dur: 1.3, gain: 0.35 * g, attack: 0.2, pan, vibrato: 9 });
          break;
        case 'hiss':
          this.noiseHit({ type: 'highpass', freq: 3500, dur: 0.9, gain: 0.35 * g, attack: 0.08, pan });
          break;
        case 'croc':
          this.noiseHit({ type: 'lowpass', freq: 220, dur: 1.2, gain: 0.9 * g, attack: 0.2, pan });
          this.noiseHit({ type: 'highpass', freq: 2500, dur: 0.7, gain: 0.25 * g, pan, when: 0.3 });
          break;
        case 'hippo':
          for (let i = 0; i < 4; i++) this.tone({ type: 'sawtooth', f0: 120 - i * 8, f1: 70, dur: 0.35, gain: 0.4 * g, pan, when: i * 0.28 });
          break;
        case 'chestbeat':
          for (let i = 0; i < 9; i++) this.tone({ f0: 140, f1: 55, dur: 0.12, gain: 0.7 * g, pan, when: i * 0.1 });
          this.noiseHit({ type: 'lowpass', freq: 500, dur: 0.8, gain: 0.3 * g, pan, when: 0.9 });
          break;
        case 'trumpet':
          this.tone({ type: 'sawtooth', f0: 420, f1: 560, dur: 0.5, gain: 0.25 * g, attack: 0.05, pan, vibrato: 14 });
          this.tone({ type: 'sawtooth', f0: 560, f1: 360, dur: 0.9, gain: 0.25 * g, pan, when: 0.45, vibrato: 18 });
          break;
        case 'bite':
          this.noiseHit({ type: 'bandpass', freq: 1400, q: 0.8, dur: 0.15, gain: 0.8 * g, pan });
          this.tone({ f0: 160, f1: 45, dur: 0.25, gain: 0.7 * g, pan });
          break;
        case 'hurt':
          this.tone({ f0: 120, f1: 40, dur: 0.35, gain: 0.8 });
          this.noiseHit({ type: 'lowpass', freq: 900, dur: 0.25, gain: 0.4 });
          break;
        case 'pickup':
          this.tone({ f0: 880, dur: 0.18, gain: 0.25 });
          this.tone({ f0: 1320, dur: 0.35, gain: 0.25, when: 0.1 });
          break;
        case 'step':
          this.noiseHit({ type: 'bandpass', freq: 1500 + Math.random() * 600, q: 1.2, dur: 0.09, gain: 0.13 });
          this.noiseHit({ type: 'lowpass', freq: 260, dur: 0.07, gain: 0.25 });
          break;
        case 'stepWater':
          this.noiseHit({ type: 'lowpass', freq: 1100, dur: 0.22, gain: 0.3 });
          this.tone({ f0: 300, f1: 600, dur: 0.08, gain: 0.08 });
          break;
        case 'land':
          this.noiseHit({ type: 'lowpass', freq: 400, dur: 0.18, gain: 0.5 });
          break;
        case 'death':
          this.tone({ type: 'sawtooth', f0: 110, f1: 30, dur: 2.5, gain: 0.35, attack: 0.05 });
          this.noiseHit({ type: 'lowpass', freq: 300, dur: 2, gain: 0.3 });
          break;
        case 'flashlight':
          this.noiseHit({ type: 'highpass', freq: 4000, dur: 0.03, gain: 0.3 });
          break;
        case 'swell': // warm major chord for the family reunion
          [196, 246.9, 293.7, 392, 493.9].forEach((f, i) => this.tone({ f0: f, dur: 9, gain: 0.09, attack: 2.5, when: i * 0.15, vibrato: 2 }));
          [261.6, 329.6, 392, 523.3].forEach((f) => this.tone({ f0: f, dur: 7, gain: 0.08, attack: 2, when: 4.5, vibrato: 2 }));
          break;
        default:
          break;
      }
    } catch (e) {
      /* never let audio break the game */
    }
  }

  // ---- Continuous layers (call every frame) ---------------------------------------
  update(dt, { darkness = 0, buzz = 0, drums = 0, threat = 0, villagePos = null }) {
    if (!this.enabled) return;
    try {
      const t = this.ctx.currentTime;
      const smooth = (param, v) => param.setTargetAtTime(v, t, 0.4);
      smooth(this.dayBed.out.gain, 0.06 * (1 - darkness));
      smooth(this.nightBed.out.gain, 0.05 * darkness);
      smooth(this.buzz.gain, 0.06 * buzz);
      smooth(this.drone.gain, 0.12 * threat);

      // Day: bird calls from random directions.
      this.nextBird -= dt;
      if (this.nextBird <= 0) {
        this.nextBird = 1.5 + Math.random() * 4;
        if (darkness < 0.6) {
          const pan = Math.random() * 2 - 1;
          const base = 1800 + Math.random() * 1600;
          const n = 2 + Math.floor(Math.random() * 4);
          for (let i = 0; i < n; i++) this.tone({ f0: base, f1: base * (Math.random() < 0.5 ? 1.4 : 0.7), dur: 0.12, gain: 0.05, pan, when: i * 0.16 });
        }
      }
      // Night: frogs croaking.
      this.nextFrog -= dt;
      if (this.nextFrog <= 0) {
        this.nextFrog = 0.6 + Math.random() * 2.5;
        if (darkness > 0.5) {
          const pan = Math.random() * 2 - 1;
          const f = 220 + Math.random() * 200;
          for (let i = 0; i < 3; i++) this.tone({ type: 'square', f0: f, f1: f * 0.8, dur: 0.07, gain: 0.025, pan, when: i * 0.09 });
        }
      }
      // Village drums: guide the player home as they get close.
      this.nextDrum -= dt;
      if (drums > 0.02 && this.nextDrum <= 0) {
        const pattern = [1, 0, 0.6, 0, 1, 0.5, 0.6, 0];
        const v = pattern[this.drumStep % pattern.length];
        this.drumStep++;
        this.nextDrum = 0.24;
        const { pan } = this.spatial(villagePos);
        if (v) this.tone({ f0: v > 0.8 ? 95 : 140, f1: 50, dur: 0.3, gain: 0.5 * drums * v, pan });
      }
      // Heartbeat when badly hunted.
      this.nextBeat -= dt;
      if (threat > 0.5 && this.nextBeat <= 0) {
        this.nextBeat = 0.75;
        this.tone({ f0: 70, f1: 40, dur: 0.15, gain: 0.35 * threat });
        this.tone({ f0: 65, f1: 38, dur: 0.15, gain: 0.25 * threat, when: 0.2 });
      }
    } catch (e) {
      /* ignore */
    }
  }

  setMuted(m) {
    if (this.master) this.master.gain.value = m ? 0 : 0.8;
  }
}
