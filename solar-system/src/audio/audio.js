// =============================================================================
// audio.js — every sound is synthesised live with the Web Audio API (no
// audio files): engine hum, manoeuvring thrusters, the pulse drive, wind that
// only exists where there is air, the jetpack, footsteps carried through the
// suit, alarms, the Earth barrier's zap, touchdowns and explosions.
// =============================================================================

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.started = false;
    this.lastAlarm = 0;
  }

  /** Must be called from a user gesture (click / key press). */
  start() {
    if (this.started) { this.ctx?.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch (e) { return; }
    this.started = true;
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(c.destination);

    // White noise source shared by the continuous layers.
    const len = c.sampleRate * 2;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    const noise = () => { const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; s.start(); return s; };
    const gain = (v = 0) => { const g = c.createGain(); g.gain.value = v; return g; };
    const filter = (type, f, q = 0.7) => { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    const osc = (type, f) => { const o = c.createOscillator(); o.type = type; o.frequency.value = f; o.start(); return o; };

    // Engine: detuned saws through a low-pass that opens with thrust.
    this.engG = gain(0);
    this.engF = filter('lowpass', 180, 1.2);
    this.engO1 = osc('sawtooth', 46);
    this.engO2 = osc('sawtooth', 46.7);
    this.engO1.connect(this.engF); this.engO2.connect(this.engF);
    const engNoise = noise();
    const engNF = filter('lowpass', 300);
    const engNG = gain(0.5);
    engNoise.connect(engNF).connect(engNG).connect(this.engF);
    this.engF.connect(this.engG).connect(this.master);

    // Manoeuvring thrusters: hiss.
    this.rcsG = gain(0);
    noise().connect(filter('bandpass', 1500, 0.8)).connect(this.rcsG).connect(this.master);

    // Wind / atmospheric roar.
    this.windG = gain(0);
    this.windF = filter('bandpass', 400, 0.6);
    noise().connect(this.windF).connect(this.windG).connect(this.master);

    // Pulse drive: rumble + shimmering tone.
    this.pulseG = gain(0);
    this.pulseF = filter('lowpass', 200, 2);
    noise().connect(this.pulseF).connect(this.pulseG).connect(this.master);
    this.pulseToneG = gain(0);
    this.pulseTone = osc('sine', 220);
    this.pulseTone2 = osc('triangle', 331);
    this.pulseTone.connect(this.pulseToneG); this.pulseTone2.connect(this.pulseToneG);
    this.pulseToneG.connect(this.master);

    // Jetpack.
    this.jetG = gain(0);
    noise().connect(filter('bandpass', 900, 0.9)).connect(this.jetG).connect(this.master);

    // Deep-space ambience (very quiet drone).
    this.ambG = gain(0.0);
    const a1 = osc('sine', 55), a2 = osc('sine', 82.4);
    const lfo = osc('sine', 0.07);
    const lfoG = gain(0.02);
    lfo.connect(lfoG).connect(this.ambG.gain);
    a1.connect(this.ambG); a2.connect(this.ambG);
    this.ambG.connect(this.master);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  ramp(param, v, t = 0.08) {
    param.setTargetAtTime(v, this.ctx.currentTime, t);
  }

  /**
   * Continuous layers. s: { thrust (0..1), boost, rcs (0..1), spool (0..1),
   * pulse (bool), wind (0..1), windSpeed (m/s), jet (bool), inShip, airDensity }
   */
  update(s) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    // In vacuum you hear the ship through its structure, so engines stay audible
    // but quieter; outside the ship you only hear your suit.
    const hull = s.inShip ? 1 : 0;
    const air = Math.min(1, Math.sqrt(Math.max(0, s.airDensity || 0)) * 2);
    this.ramp(this.engG.gain, hull * (0.05 + 0.2 * s.thrust * (s.boost ? 1.3 : 1)));
    this.ramp(this.engF.frequency, 160 + 900 * s.thrust * (s.boost ? 1.4 : 1));
    this.engO1.frequency.setTargetAtTime(42 + 18 * s.thrust, this.ctx.currentTime, 0.2);
    this.engO2.frequency.setTargetAtTime(42.6 + 18.5 * s.thrust, this.ctx.currentTime, 0.2);
    this.ramp(this.rcsG.gain, hull * 0.07 * s.rcs);
    this.ramp(this.windG.gain, 0.32 * s.wind * (0.3 + 0.7 * air));
    this.ramp(this.windF.frequency, 180 + Math.min(2400, (s.windSpeed || 0) * 0.9));
    const p = s.pulse ? 1 : s.spool;
    this.ramp(this.pulseG.gain, hull * 0.28 * p, 0.25);
    this.ramp(this.pulseF.frequency, 120 + 500 * p, 0.3);
    this.ramp(this.pulseToneG.gain, hull * (s.pulse ? 0.025 : 0.05 * s.spool), 0.2);
    this.pulseTone.frequency.setTargetAtTime(160 + 260 * (s.pulse ? 1 : s.spool), this.ctx.currentTime, 0.4);
    this.pulseTone2.frequency.setTargetAtTime(240 + 390 * (s.pulse ? 1 : s.spool), this.ctx.currentTime, 0.4);
    this.ramp(this.jetG.gain, s.jet ? 0.14 : 0, 0.05);
    this.ramp(this.ambG.gain, 0.025 * (1 - Math.min(1, s.wind * 2)), 1);
  }

  /** One-shot effects. */
  play(name, opts = {}) {
    if (!this.ctx || this.muted || this.ctx.state !== 'running') return;
    const c = this.ctx, t = c.currentTime;
    const env = (g, peak, attack, decay) => {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    };
    const tone = (type, f0, f1, peak, dur, attack = 0.005) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      env(g, peak, attack, dur);
      o.connect(g).connect(this.master);
      o.start(t); o.stop(t + attack + dur + 0.05);
    };
    const burst = (type, f0, f1, peak, dur, q = 0.8, attack = 0.005) => {
      const s = c.createBufferSource(); s.buffer = this.noiseBuf;
      const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
      f.frequency.setValueAtTime(f0, t);
      f.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = c.createGain();
      env(g, peak, attack, dur);
      s.connect(f).connect(g).connect(this.master);
      s.start(t, Math.random()); s.stop(t + attack + dur + 0.05);
    };
    switch (name) {
      case 'blip': tone('sine', 1320, 1320, 0.07, 0.07); break;
      case 'select': tone('sine', 880, 1320, 0.07, 0.09); break;
      case 'toast': tone('sine', 660, 990, 0.05, 0.12); tone('sine', 990, 990, 0.04, 0.1); break;
      case 'denied': tone('square', 220, 180, 0.06, 0.18); break;
      case 'alarm': tone('square', 880, 880, 0.05, 0.12); break;
      case 'spool': tone('sawtooth', 80, 420, 0.06, 1.2, 0.3); burst('lowpass', 200, 2000, 0.15, 1.2, 0.7, 0.4); break;
      case 'pulse-start': burst('lowpass', 3000, 120, 0.5, 1.2); tone('sine', 90, 40, 0.3, 0.8); break;
      case 'pulse-exit': burst('lowpass', 1500, 100, 0.35, 0.9); tone('sine', 300, 70, 0.15, 0.6); break;
      case 'zap':
        tone('sawtooth', 1400, 160, 0.16, 0.45);
        burst('highpass', 4000, 1500, 0.25, 0.35, 0.5);
        break;
      case 'land': tone('sine', 70, 40, 0.35, 0.35); burst('lowpass', 500, 80, 0.3, 0.3); break;
      case 'impact': tone('sine', 60, 30, 0.6, 0.5); burst('lowpass', 1200, 60, 0.6, 0.6); break;
      case 'explosion':
        burst('lowpass', 2500, 40, 0.95, 2.6, 0.5, 0.01);
        tone('sine', 55, 25, 0.7, 1.8);
        break;
      case 'step': {
        const k = opts.vacuum ? 0.06 : 0.12;
        burst('lowpass', opts.run ? 700 : 500, 90, k, 0.09, 1.2, 0.003);
        break;
      }
      case 'jump': burst('lowpass', 400, 100, 0.08, 0.12); break;
      case 'door': tone('triangle', 300, 600, 0.06, 0.25); burst('bandpass', 2000, 600, 0.08, 0.3); break;
      case 'hurt': tone('sawtooth', 300, 120, 0.12, 0.25); break;
      case 'laser': tone('sawtooth', 2200, 380, 0.09, 0.16); tone('sine', 1300, 900, 0.06, 0.12); break;
      case 'growl': burst('lowpass', 420, 120, 0.22, 0.55, 2.5, 0.04); tone('sawtooth', 95, 70, 0.08, 0.5, 0.05); break;
      case 'chime': tone('sine', 880, 1175, 0.06, 0.5, 0.02); tone('sine', 1320, 1760, 0.035, 0.6, 0.05); break;
      case 'crate': tone('triangle', 220, 440, 0.08, 0.3); burst('bandpass', 1800, 500, 0.1, 0.4); tone('sine', 660, 990, 0.06, 0.25); break;
      default: break;
    }
  }

  /** Repeating warning beep while a danger warning is shown. */
  alarm(now, active) {
    if (!active || now - this.lastAlarm < 1.1) return;
    this.lastAlarm = now;
    this.play('alarm');
  }
}
