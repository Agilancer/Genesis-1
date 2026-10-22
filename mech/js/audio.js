// Synthesized sound effects. Nothing is loaded from disk; every sound is
// built from oscillators and filtered noise when it plays.

export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.8;
    this.listener = { x: 0, y: 0, z: 0 };
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? this.volume : 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // Brown noise for rumbles
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }

    // Continuous thruster roar, driven by setThrust().
    this.thrust = this.loop(this.noise, 'bandpass', 700, 0.6);
    this.thrustLow = this.loop(this.brown, 'lowpass', 300, 0.8);
    // Sustained mega-beam hum
    this.beamLoop = this.loop(this.noise, 'bandpass', 2400, 2);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 92;
    this.beamOsc = ctx.createGain();
    this.beamOsc.gain.value = 0;
    osc.connect(this.beamOsc).connect(this.master);
    osc.start();
  }

  loop(buffer, type, freq, q) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master);
    src.start();
    return { src, f, g };
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? this.volume : 0, this.ctx.currentTime, 0.05);
  }

  get ok() { return this.ctx && this.enabled && this.ctx.state === 'running'; }

  // Distance attenuation relative to the listener (camera)
  att(pos) {
    if (!pos) return 1;
    const dx = pos.x - this.listener.x, dy = pos.y - this.listener.y, dz = pos.z - this.listener.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return 1 / (1 + Math.max(0, d - 15) / 35);
  }

  env(g, t, a, peak, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + decay);
  }

  noiseHit({ type = 'lowpass', freq = 800, freqEnd, q = 1, peak = 0.5, attack = 0.003, decay = 0.3, pos, rate = 1, buffer }) {
    if (!this.ok) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buffer || this.noise;
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + attack + decay);
    const g = ctx.createGain();
    this.env(g, t, attack, peak * this.att(pos), decay);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + attack + decay + 0.05);
  }

  tone({ type = 'sine', freq = 440, freqEnd, peak = 0.3, attack = 0.002, decay = 0.2, pos, delay = 0 }) {
    if (!this.ok) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + attack + decay);
    const g = ctx.createGain();
    this.env(g, t, attack, peak * this.att(pos), decay);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + attack + decay + 0.05);
  }

  // ---- library -------------------------------------------------------------

  beam(pos) {
    this.tone({ type: 'sawtooth', freq: 1900, freqEnd: 160, peak: 0.16, decay: 0.28, pos });
    this.tone({ type: 'square', freq: 980, freqEnd: 90, peak: 0.08, decay: 0.32, pos });
    this.noiseHit({ type: 'highpass', freq: 3000, peak: 0.18, decay: 0.2, pos });
  }
  gun(pos) {
    this.noiseHit({ type: 'bandpass', freq: 1400, q: 0.8, peak: 0.35, decay: 0.07, pos });
    this.tone({ type: 'sine', freq: 140, freqEnd: 50, peak: 0.3, decay: 0.08, pos });
  }
  shotgun(pos) {
    this.noiseHit({ type: 'lowpass', freq: 2500, freqEnd: 300, peak: 0.7, decay: 0.35, pos });
    this.tone({ type: 'sine', freq: 110, freqEnd: 35, peak: 0.6, decay: 0.3, pos });
  }
  thump(pos) {
    this.noiseHit({ type: 'lowpass', freq: 1200, freqEnd: 200, peak: 0.5, decay: 0.25, pos });
    this.tone({ type: 'sine', freq: 90, freqEnd: 40, peak: 0.5, decay: 0.25, pos });
  }
  rocket(pos) {
    this.noiseHit({ type: 'bandpass', freq: 500, freqEnd: 2600, q: 1.2, peak: 0.55, attack: 0.02, decay: 0.7, pos });
    this.tone({ type: 'sine', freq: 70, freqEnd: 40, peak: 0.5, decay: 0.3, pos });
  }
  missile(pos) {
    this.noiseHit({ type: 'bandpass', freq: 700, freqEnd: 3200, q: 1.5, peak: 0.3, attack: 0.01, decay: 0.45, pos });
    this.noiseHit({ type: 'highpass', freq: 5000, peak: 0.08, decay: 0.1, pos });
  }
  explosion(pos, size = 1) {
    if (!this.ok) return;
    const p = Math.min(1.2, 0.45 + size * 0.4);
    this.noiseHit({ type: 'lowpass', freq: 2200, freqEnd: 120, peak: p, attack: 0.005, decay: 1.2 + size * 0.5, pos });
    this.noiseHit({ buffer: this.brown, type: 'lowpass', freq: 400, peak: p * 1.2, decay: 1.6 + size * 0.6, pos });
    this.tone({ type: 'sine', freq: 70, freqEnd: 28, peak: p * 0.8, decay: 0.7, pos });
  }
  impact(pos) {
    this.noiseHit({ type: 'highpass', freq: 2400, peak: 0.18, decay: 0.12, pos });
    this.tone({ type: 'triangle', freq: 1300, freqEnd: 600, peak: 0.07, decay: 0.12, pos });
  }
  footstep(pos, heavy = 1) {
    this.tone({ type: 'sine', freq: 75, freqEnd: 32, peak: 0.55 * heavy, decay: 0.32, pos });
    this.noiseHit({ type: 'lowpass', freq: 500, freqEnd: 90, peak: 0.35 * heavy, decay: 0.3, pos });
    this.tone({ type: 'square', freq: 210, freqEnd: 160, peak: 0.035 * heavy, decay: 0.08, pos, delay: 0.03 });
  }
  crunch(pos) {
    this.noiseHit({ type: 'lowpass', freq: 1800, freqEnd: 300, peak: 0.55, decay: 0.35, pos });
    this.noiseHit({ type: 'bandpass', freq: 3200, q: 2, peak: 0.25, decay: 0.18, pos });
    this.tone({ type: 'square', freq: 180, freqEnd: 60, peak: 0.12, decay: 0.2, pos });
  }
  servo(pos) {
    this.tone({ type: 'sawtooth', freq: 260, freqEnd: 420, peak: 0.035, attack: 0.03, decay: 0.25, pos });
  }
  lock() { this.tone({ type: 'square', freq: 1760, peak: 0.06, decay: 0.05 }); }
  lockFull() {
    this.tone({ type: 'square', freq: 2093, peak: 0.07, decay: 0.07 });
    this.tone({ type: 'square', freq: 2637, peak: 0.07, decay: 0.09, delay: 0.08 });
  }
  hatch(pos) {
    this.tone({ type: 'square', freq: 120, freqEnd: 70, peak: 0.08, decay: 0.12, pos });
    this.noiseHit({ type: 'bandpass', freq: 1800, q: 3, peak: 0.12, decay: 0.1, pos });
  }
  charge(pos, dur) {
    this.tone({ type: 'sawtooth', freq: 120, freqEnd: 1400, peak: 0.12, attack: dur * 0.9, decay: 0.1, pos });
    this.tone({ type: 'sine', freq: 240, freqEnd: 2200, peak: 0.1, attack: dur * 0.9, decay: 0.1, pos });
  }
  reload() {
    this.tone({ type: 'square', freq: 300, freqEnd: 180, peak: 0.06, decay: 0.08 });
    this.tone({ type: 'square', freq: 500, freqEnd: 320, peak: 0.06, decay: 0.08, delay: 0.18 });
  }
  click() { this.tone({ type: 'triangle', freq: 1200, freqEnd: 900, peak: 0.08, decay: 0.05 }); }
  empty() { this.tone({ type: 'square', freq: 220, peak: 0.05, decay: 0.05 }); }
  alarm() {
    this.tone({ type: 'square', freq: 880, peak: 0.07, decay: 0.12 });
    this.tone({ type: 'square', freq: 660, peak: 0.07, decay: 0.12, delay: 0.15 });
  }
  boostIgnite() {
    this.noiseHit({ type: 'bandpass', freq: 400, freqEnd: 1600, q: 0.7, peak: 0.45, attack: 0.01, decay: 0.4 });
    this.tone({ type: 'sine', freq: 60, freqEnd: 120, peak: 0.3, decay: 0.3 });
  }

  // Continuous layers -------------------------------------------------------
  setThrust(level, dt) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.thrust.g.gain.setTargetAtTime(level * 0.22, t, 0.06);
    this.thrust.f.frequency.setTargetAtTime(500 + level * 900, t, 0.08);
    this.thrustLow.g.gain.setTargetAtTime(level * 0.5, t, 0.08);
  }
  setBeam(level) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.beamLoop.g.gain.setTargetAtTime(level * 0.35, t, 0.04);
    this.beamOsc.gain.setTargetAtTime(level * 0.09, t, 0.04);
  }
}
