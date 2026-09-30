/* Genesis: a touch-first arcade game for iOS Safari.
 * Absorb smaller motes to grow, avoid bigger ones, clear stages.
 * No dependencies; runs from static hosting.
 */
(() => {
  'use strict';

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d', { alpha: false });
  const ui = {
    hud: $('hud'),
    score: $('hud-score'),
    stage: $('hud-stage'),
    progress: $('hud-progress'),
    combo: $('hud-combo'),
    title: $('screen-title'),
    pause: $('screen-pause'),
    stageScreen: $('screen-stage'),
    stageTitle: $('stage-title'),
    stageSub: $('stage-sub'),
    over: $('screen-over'),
    overScore: $('over-score'),
    overStage: $('over-stage'),
    overBest: $('over-best'),
    titleBest: $('title-best'),
    installHint: $('install-hint'),
    soundBtn: $('btn-sound'),
  };

  // ---------- Storage (Safari private mode can throw) ----------
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem('genesis.' + key);
        return v === null ? fallback : JSON.parse(v);
      } catch (_) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('genesis.' + key, JSON.stringify(value)); } catch (_) { /* ignore */ }
    },
  };

  // ---------- Audio (Web Audio, unlocked on first gesture) ----------
  const audio = {
    ctx: null,
    master: null,
    enabled: store.get('sound', true),
    unlock() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.35;
        this.master.connect(this.ctx.destination);
        // Play a silent buffer: required by older iOS versions to fully unlock.
        const buf = this.ctx.createBuffer(1, 1, 22050);
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.connect(this.master);
        src.start(0);
      }
      // iOS may leave the context 'suspended' or 'interrupted' after backgrounding.
      if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    },
    tone(freq, dur, { type = 'sine', vol = 0.5, slide = 0, delay = 0 } = {}) {
      if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
      const t = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g);
      g.connect(this.master);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    },
    absorb(combo) {
      const base = 440 * Math.pow(2, Math.min(combo, 12) / 12);
      this.tone(base, 0.12, { type: 'sine', vol: 0.35, slide: base * 0.5 });
    },
    nova() {
      [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.18, { type: 'triangle', vol: 0.3, delay: i * 0.06 }));
    },
    stage() {
      [392, 494, 587, 784].forEach((f, i) => this.tone(f, 0.5, { type: 'triangle', vol: 0.25, delay: i * 0.09 }));
    },
    death() {
      this.tone(220, 0.7, { type: 'sawtooth', vol: 0.3, slide: -180 });
      this.tone(110, 0.9, { type: 'square', vol: 0.15, slide: -80, delay: 0.05 });
    },
  };

  // ---------- Viewport ----------
  let W = 0, H = 0, DPR = 1, U = 1; // U = unit size (min dimension)
  let bgCanvas = null;
  let stars = [];

  function resize() {
    const vv = window.visualViewport;
    const newW = Math.round(vv ? vv.width : window.innerWidth);
    const newH = Math.round(vv ? vv.height : window.innerHeight);
    if (newW === W && newH === H) return;
    const oldU = U, oldW = W, oldH = H;
    W = newW; H = newH;
    U = Math.min(W, H);
    DPR = Math.min(window.devicePixelRatio || 1, 2); // cap for performance on 3x phones
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    buildBackground();
    if (oldW && oldH) rescaleWorld(oldW, oldH, oldU);
  }

  function buildBackground() {
    bgCanvas = document.createElement('canvas');
    bgCanvas.width = canvas.width;
    bgCanvas.height = canvas.height;
    const b = bgCanvas.getContext('2d');
    b.scale(DPR, DPR);
    b.fillStyle = '#05060f';
    b.fillRect(0, 0, W, H);
    const blobs = [
      [0.2, 0.25, 0.7, 'rgba(80, 60, 180, 0.22)'],
      [0.85, 0.7, 0.8, 'rgba(20, 120, 170, 0.18)'],
      [0.5, 1.0, 0.6, 'rgba(160, 50, 120, 0.12)'],
    ];
    for (const [x, y, r, c] of blobs) {
      const g = b.createRadialGradient(x * W, y * H, 0, x * W, y * H, r * Math.max(W, H));
      g.addColorStop(0, c);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      b.fillStyle = g;
      b.fillRect(0, 0, W, H);
    }
    stars = [];
    const count = Math.round((W * H) / 3500);
    for (let i = 0; i < count; i++) {
      stars.push({ x: Math.random() * W, y: Math.random() * H, z: Math.random() * 0.8 + 0.2, tw: Math.random() * Math.PI * 2 });
    }
  }

  // Keep the game consistent across rotations / Safari toolbar show-hide.
  function rescaleWorld(oldW, oldH, oldU) {
    const k = U / oldU;
    const sx = W / oldW, sy = H / oldH;
    const fix = (o) => { o.x *= sx; o.y *= sy; if (o.r) o.r *= k; if (o.vx !== undefined) { o.vx *= k; o.vy *= k; } };
    fix(player);
    player.tx *= sx; player.ty *= sy;
    player.baseR *= k; player.goalR *= k;
    motes.forEach(fix);
    particles.forEach(fix);
  }

  // ---------- Game state ----------
  const S = { TITLE: 0, PLAYING: 1, PAUSED: 2, CLEAR: 3, DYING: 4, OVER: 5 };
  let state = S.TITLE;
  let stage = 1;
  let score = 0;
  let best = store.get('best', 0);
  let combo = 0, comboTimer = 0;
  let nova = 0;          // seconds of nova remaining
  let grace = 0;         // spawn invulnerability
  let spawnTimer = 0;
  let stateTimer = 0;
  let shake = 0;
  let time = 0;

  const player = { x: 0, y: 0, r: 0, tx: 0, ty: 0, vx: 0, vy: 0, baseR: 0, goalR: 0, trail: [] };
  const motes = [];
  const particles = [];

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function stageParams(n) {
    return {
      speed: 1 + 0.12 * (n - 1),
      danger: Math.min(0.28 + 0.035 * n, 0.55),
      maxMotes: Math.min(12 + n * 2, 30),
      spawnEvery: Math.max(0.55 - n * 0.03, 0.25),
      hunterChance: n >= 3 ? Math.min(0.08 + (n - 3) * 0.04, 0.35) : 0,
      goldChance: 0.035,
    };
  }

  function startGame() {
    stage = 1;
    score = 0;
    startStage();
    setState(S.PLAYING);
  }

  function startStage() {
    motes.length = 0;
    player.baseR = U * 0.032;
    player.goalR = player.baseR * 2.4;
    player.r = player.baseR;
    player.x = player.tx = W / 2;
    player.y = player.ty = H * 0.6;
    player.vx = player.vy = 0;
    player.trail.length = 0;
    combo = 0; comboTimer = 0; nova = 0;
    grace = 1.5;
    spawnTimer = 0;
    // Seed the field with a few easy motes.
    for (let i = 0; i < 8; i++) spawnMote(true);
    ui.stage.textContent = stage;
  }

  function spawnMote(onScreen = false) {
    const p = stageParams(stage);
    const pr = player.r;
    let kind = 'normal';
    let r;
    const roll = Math.random();
    if (!onScreen && roll < p.goldChance) {
      kind = 'gold';
      r = pr * 0.55;
    } else if (!onScreen && Math.random() < p.danger) {
      r = Math.min(pr * rand(1.15, 2.1), U * 0.22);
      if (Math.random() < p.hunterChance) kind = 'hunter';
    } else {
      r = pr * rand(0.28, 0.85);
    }

    let x, y;
    const speed = U * rand(0.05, 0.13) * p.speed * (kind === 'gold' ? 1.6 : 1);
    if (onScreen) {
      // Pick a spot away from the player.
      let tries = 0;
      do {
        x = rand(r, W - r);
        y = rand(r + 60, H - r);
        tries++;
      } while (Math.hypot(x - player.x, y - player.y) < U * 0.25 && tries < 20);
      const a = rand(0, Math.PI * 2);
      motes.push(makeMote(x, y, r, Math.cos(a) * speed * 0.5, Math.sin(a) * speed * 0.5, kind));
      return;
    }
    const edge = Math.floor(Math.random() * 4);
    const m = r + 4;
    if (edge === 0) { x = rand(0, W); y = -m; }
    else if (edge === 1) { x = W + m; y = rand(0, H); }
    else if (edge === 2) { x = rand(0, W); y = H + m; }
    else { x = -m; y = rand(0, H); }
    // Aim at a random point in the inner field so motes cross the screen.
    const ax = rand(W * 0.2, W * 0.8), ay = rand(H * 0.2, H * 0.8);
    const d = Math.hypot(ax - x, ay - y) || 1;
    motes.push(makeMote(x, y, r, ((ax - x) / d) * speed, ((ay - y) / d) * speed, kind));
  }

  function makeMote(x, y, r, vx, vy, kind) {
    return { x, y, r, vx, vy, kind, phase: Math.random() * Math.PI * 2, born: time, dead: false };
  }

  // ---------- Input: relative drag, so the finger never hides the player ----------
  const input = { id: null, sx: 0, sy: 0, px: 0, py: 0 };
  const SENS = 1.35;

  canvas.addEventListener('pointerdown', (e) => {
    audio.unlock();
    if (state !== S.PLAYING || input.id !== null) return;
    input.id = e.pointerId;
    input.sx = e.clientX; input.sy = e.clientY;
    input.px = player.tx; input.py = player.ty;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== input.id || state !== S.PLAYING) return;
    player.tx = clamp(input.px + (e.clientX - input.sx) * SENS, player.r, W - player.r);
    player.ty = clamp(input.py + (e.clientY - input.sy) * SENS, player.r, H - player.r);
    // Re-anchor when clamped so reversing direction responds immediately.
    if (player.tx === player.r || player.tx === W - player.r) { input.sx = e.clientX; input.px = player.tx; }
    if (player.ty === player.r || player.ty === H - player.r) { input.sy = e.clientY; input.py = player.ty; }
    e.preventDefault();
  });
  const endPointer = (e) => { if (e.pointerId === input.id) input.id = null; };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  // Block iOS Safari gestures: pinch-zoom, double-tap zoom, scroll bounce.
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((t) =>
    document.addEventListener(t, (e) => e.preventDefault(), { passive: false }));
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1 || e.target === canvas) e.preventDefault(); }, { passive: false });
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouchEnd < 300 && e.target === canvas) e.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // Keyboard, for desktop testing.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'p') {
      if (state === S.PLAYING) pauseGame(); else if (state === S.PAUSED) resumeGame();
    } else if ((e.key === ' ' || e.key === 'Enter') && (state === S.TITLE || state === S.OVER)) {
      audio.unlock(); startGame();
    }
  });

  // ---------- Buttons ----------
  const tap = (el, fn) => el.addEventListener('click', (e) => { audio.unlock(); fn(e); });
  tap($('btn-play'), startGame);
  tap($('btn-retry'), startGame);
  tap($('btn-pause'), pauseGame);
  tap($('btn-resume'), resumeGame);
  tap($('btn-quit'), () => setState(S.TITLE));
  tap($('btn-menu'), () => setState(S.TITLE));
  tap(ui.soundBtn, () => {
    audio.enabled = !audio.enabled;
    store.set('sound', audio.enabled);
    updateSoundLabel();
  });
  function updateSoundLabel() { ui.soundBtn.textContent = 'Sound: ' + (audio.enabled ? 'On' : 'Off'); }
  updateSoundLabel();

  function pauseGame() { if (state === S.PLAYING) setState(S.PAUSED); }
  function resumeGame() { if (state === S.PAUSED) { lastT = performance.now(); setState(S.PLAYING); } }

  // Auto-pause when Safari is backgrounded, the tab switches, or the phone locks.
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });
  window.addEventListener('pagehide', pauseGame);
  window.addEventListener('blur', pauseGame);

  function setState(s) {
    state = s;
    stateTimer = 0;
    input.id = null;
    ui.title.classList.toggle('hidden', s !== S.TITLE);
    ui.pause.classList.toggle('hidden', s !== S.PAUSED);
    ui.stageScreen.classList.toggle('hidden', s !== S.CLEAR);
    ui.over.classList.toggle('hidden', s !== S.OVER);
    ui.hud.classList.toggle('hidden', !(s === S.PLAYING || s === S.CLEAR || s === S.DYING || s === S.PAUSED));
    if (s === S.TITLE) {
      ui.titleBest.textContent = best.toLocaleString();
      motes.length = 0;
      for (let i = 0; i < 14; i++) spawnAmbient();
    }
    if (s === S.OVER) {
      const isBest = score > best;
      if (isBest) { best = score; store.set('best', best); }
      ui.overScore.textContent = score.toLocaleString();
      ui.overStage.textContent = stage;
      ui.overBest.textContent = isBest ? 'New best!' : 'Best: ' + best.toLocaleString();
    }
  }

  // Motes drifting behind the title screen.
  function spawnAmbient() {
    const r = U * rand(0.01, 0.06);
    const a = rand(0, Math.PI * 2), sp = U * rand(0.01, 0.04);
    motes.push(makeMote(rand(0, W), rand(0, H), r, Math.cos(a) * sp, Math.sin(a) * sp, Math.random() < 0.1 ? 'gold' : 'normal'));
  }

  // ---------- Particles ----------
  function burst(x, y, color, n, speed, life = 0.6, size = 2.5) {
    for (let i = 0; i < n; i++) {
      if (particles.length > 500) particles.shift();
      const a = rand(0, Math.PI * 2), s = speed * rand(0.2, 1);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color, r: size * rand(0.6, 1.4) });
    }
  }

  // ---------- Update ----------
  function update(dt) {
    time += dt;
    stateTimer += dt;
    shake = Math.max(0, shake - dt * 2.5);

    updateParticles(dt);

    if (state === S.TITLE || state === S.OVER) {
      for (const m of motes) {
        m.x += m.vx * dt; m.y += m.vy * dt;
        if (m.x < -m.r) m.x = W + m.r; if (m.x > W + m.r) m.x = -m.r;
        if (m.y < -m.r) m.y = H + m.r; if (m.y > H + m.r) m.y = -m.r;
      }
      return;
    }
    if (state === S.PAUSED) return;

    if (state === S.DYING) {
      moveMotes(dt);
      if (stateTimer > 1.3) setState(S.OVER);
      return;
    }

    if (state === S.CLEAR) {
      // Pull everything into the player, then shrink back and start the next stage.
      for (const m of motes) {
        m.x += (player.x - m.x) * Math.min(1, dt * 3);
        m.y += (player.y - m.y) * Math.min(1, dt * 3);
        m.r *= 1 - Math.min(1, dt * 2.5);
      }
      player.r += (player.baseR - player.r) * Math.min(1, dt * 1.5);
      if (stateTimer > 2.2) {
        stage++;
        startStage();
        setState(S.PLAYING);
      }
      return;
    }

    // --- PLAYING ---
    const p = stageParams(stage);
    grace = Math.max(0, grace - dt);
    nova = Math.max(0, nova - dt);
    if (comboTimer > 0) { comboTimer -= dt; if (comboTimer <= 0) combo = 0; }

    // Player eases toward the drag target.
    const k = 1 - Math.exp(-dt * 16);
    const nx = player.x + (player.tx - player.x) * k;
    const ny = player.y + (player.ty - player.y) * k;
    player.vx = (nx - player.x) / dt; player.vy = (ny - player.y) / dt;
    player.x = nx; player.y = ny;
    player.trail.push({ x: player.x, y: player.y });
    if (player.trail.length > 14) player.trail.shift();

    // Spawning
    spawnTimer -= dt;
    if (spawnTimer <= 0 && motes.length < p.maxMotes) {
      spawnMote();
      spawnTimer = p.spawnEvery * rand(0.6, 1.4);
    }
    // Always keep some food around so the stage stays winnable.
    const edible = motes.reduce((n, m) => n + (m.r < player.r ? 1 : 0), 0);
    if (edible < 4 && motes.length < p.maxMotes + 6) spawnFood();

    moveMotes(dt);

    // Collisions
    for (const m of motes) {
      if (m.dead) continue;
      const d = Math.hypot(m.x - player.x, m.y - player.y);
      const canEat = m.r < player.r || nova > 0 || m.kind === 'gold';
      if (canEat) {
        if (d < player.r + m.r * 0.25) absorb(m);
      } else if (grace <= 0 && d < (player.r + m.r) * 0.8) {
        die(m);
        return;
      }
    }
    for (let i = motes.length - 1; i >= 0; i--) if (motes[i].dead) motes.splice(i, 1);

    // Stage progress
    const prog = clamp((player.r - player.baseR) / (player.goalR - player.baseR), 0, 1);
    ui.progress.style.width = (prog * 100).toFixed(1) + '%';
    if (prog >= 1) clearStage();
  }

  function spawnFood() {
    // A guaranteed-edible mote from a random edge.
    const pr = player.r;
    const r = pr * rand(0.3, 0.7);
    const edge = Math.floor(Math.random() * 4);
    let x, y;
    if (edge === 0) { x = rand(0, W); y = -r; } else if (edge === 1) { x = W + r; y = rand(0, H); }
    else if (edge === 2) { x = rand(0, W); y = H + r; } else { x = -r; y = rand(0, H); }
    const ax = rand(W * 0.25, W * 0.75), ay = rand(H * 0.25, H * 0.75);
    const d = Math.hypot(ax - x, ay - y) || 1;
    const sp = U * rand(0.06, 0.1) * stageParams(stage).speed;
    motes.push(makeMote(x, y, r, ((ax - x) / d) * sp, ((ay - y) / d) * sp, 'normal'));
  }

  function moveMotes(dt) {
    for (let i = motes.length - 1; i >= 0; i--) {
      const m = motes[i];
      if (m.kind === 'hunter' && state === S.PLAYING) {
        // Hunters drift toward the player, but flee during nova.
        const dx = player.x - m.x, dy = player.y - m.y;
        const d = Math.hypot(dx, dy) || 1;
        const dir = nova > 0 ? -1 : 1;
        const acc = U * 0.06 * dir;
        m.vx += (dx / d) * acc * dt;
        m.vy += (dy / d) * acc * dt;
        const max = U * 0.12 * stageParams(stage).speed;
        const sp = Math.hypot(m.vx, m.vy);
        if (sp > max) { m.vx *= max / sp; m.vy *= max / sp; }
      }
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      const margin = m.r + 40;
      // Cull motes that have left the field (after they had a chance to enter).
      if (time - m.born > 2 && (m.x < -margin || m.x > W + margin || m.y < -margin || m.y > H + margin)) {
        motes.splice(i, 1);
      }
    }
  }

  function absorb(m) {
    m.dead = true;
    // Growth by area; eating something large during nova is damped.
    const ratio = m.r / player.r;
    const gain = ratio > 1 ? 0.35 : 0.6;
    player.r = Math.sqrt(player.r * player.r + m.r * m.r * gain);

    combo++;
    comboTimer = 1.3;
    const mult = Math.min(1 + Math.floor(combo / 3) * 0.5, 4);
    const pts = Math.round((m.r / U) * 1200 * mult) + (m.kind === 'gold' ? 250 : 0);
    score += pts;
    ui.score.textContent = score.toLocaleString();

    if (mult > 1) {
      ui.combo.textContent = 'x' + mult + ' COMBO';
      ui.combo.classList.add('show');
    }

    const color = m.kind === 'gold' ? '#ffd166' : '#7fe3ff';
    burst(m.x, m.y, color, 10 + Math.round(ratio * 8), U * 0.35, 0.5, U * 0.006);

    if (m.kind === 'gold') {
      nova = 5;
      audio.nova();
      shake = Math.max(shake, 0.25);
    } else {
      audio.absorb(combo);
    }
  }

  function die(m) {
    audio.death();
    shake = 1;
    burst(player.x, player.y, '#7fe3ff', 60, U * 0.6, 1.1, U * 0.008);
    burst(player.x, player.y, '#ffffff', 25, U * 0.3, 0.8, U * 0.005);
    m.r += player.r * 0.5;
    player.r = 0;
    ui.combo.classList.remove('show');
    setState(S.DYING);
  }

  function clearStage() {
    const bonus = 500 * stage;
    score += bonus;
    ui.score.textContent = score.toLocaleString();
    ui.stageTitle.textContent = 'Stage ' + stage + ' Cleared';
    ui.stageSub.textContent = '+' + bonus.toLocaleString() + ' bonus';
    ui.progress.style.width = '0%';
    ui.combo.classList.remove('show');
    audio.stage();
    burst(player.x, player.y, '#b69cff', 50, U * 0.5, 1.2, U * 0.007);
    setState(S.CLEAR);
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const q = particles[i];
      q.life -= dt;
      if (q.life <= 0) { particles.splice(i, 1); continue; }
      q.x += q.vx * dt; q.y += q.vy * dt;
      q.vx *= 1 - dt * 2; q.vy *= 1 - dt * 2;
    }
    if (comboTimer <= 0) ui.combo.classList.remove('show');
  }

  // ---------- Render ----------
  function moteColor(m) {
    if (state === S.TITLE || state === S.OVER) return m.kind === 'gold' ? [255, 209, 102] : [127, 227, 255];
    if (m.kind === 'gold') return [255, 209, 102];
    if (nova > 0) return [127, 227, 255];
    if (m.r < player.r) {
      // Small = cyan, nearly-equal = teal/green, so you can judge size at a glance.
      const t = clamp(m.r / player.r, 0, 1);
      return [Math.round(90 + 60 * t), Math.round(200 + 40 * t), Math.round(255 - 110 * t)];
    }
    if (m.kind === 'hunter') return [230, 80, 255];
    return [255, 90, 110];
  }

  function drawOrb(x, y, r, [cr, cg, cb], glow = 1.8, alpha = 1) {
    if (r <= 0.5) return;
    const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * glow);
    g.addColorStop(0, `rgba(${cr},${cg},${cb},${0.55 * alpha})`);
    g.addColorStop(0.5, `rgba(${cr},${cg},${cb},${0.18 * alpha})`);
    g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * glow, 0, Math.PI * 2);
    ctx.fill();

    const core = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    core.addColorStop(0, `rgba(255,255,255,${0.95 * alpha})`);
    core.addColorStop(0.35, `rgba(${cr},${cg},${cb},${0.95 * alpha})`);
    core.addColorStop(1, `rgba(${cr >> 1},${cg >> 1},${cb >> 1},${0.9 * alpha})`);
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.drawImage(bgCanvas, 0, 0, W, H);

    // Screen shake
    if (shake > 0) {
      const s = shake * shake * U * 0.02;
      ctx.translate(rand(-s, s), rand(-s, s));
    }

    // Parallax stars
    const ox = (player.x - W / 2) * 0.03, oy = (player.y - H / 2) * 0.03;
    ctx.fillStyle = '#ffffff';
    for (const st of stars) {
      const a = 0.35 + 0.35 * Math.sin(time * 1.5 + st.tw);
      ctx.globalAlpha = a * st.z;
      let x = (st.x - ox * st.z) % W; if (x < 0) x += W;
      let y = (st.y - oy * st.z) % H; if (y < 0) y += H;
      ctx.fillRect(x, y, st.z * 1.6, st.z * 1.6);
    }
    ctx.globalAlpha = 1;

    ctx.globalCompositeOperation = 'lighter';

    // Motes
    for (const m of motes) {
      const pulse = 1 + Math.sin(time * 3 + m.phase) * 0.04;
      const fadeIn = clamp((time - m.born) * 3, 0, 1);
      drawOrb(m.x, m.y, m.r * pulse, moteColor(m), m.kind === 'gold' ? 2.6 : 1.8, fadeIn);
      if (m.kind === 'hunter' && state === S.PLAYING && m.r >= player.r) {
        ctx.strokeStyle = `rgba(230,80,255,${0.3 + 0.2 * Math.sin(time * 6)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r * 1.25, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Player
    if (state === S.PLAYING || state === S.CLEAR || state === S.PAUSED) {
      const pc = nova > 0 ? [255, 209, 102] : [140, 240, 255];
      // Trail
      for (let i = 0; i < player.trail.length; i++) {
        const t = player.trail[i];
        const f = i / player.trail.length;
        ctx.fillStyle = `rgba(${pc[0]},${pc[1]},${pc[2]},${0.08 * f})`;
        ctx.beginPath();
        ctx.arc(t.x, t.y, player.r * (0.4 + 0.6 * f), 0, Math.PI * 2);
        ctx.fill();
      }
      const blink = grace > 0 ? 0.5 + 0.5 * Math.sin(time * 20) : 1;
      drawOrb(player.x, player.y, player.r, pc, nova > 0 ? 3 : 2.2, blink);

      // Goal ring shows the size you need to reach.
      if (state === S.PLAYING) {
        ctx.strokeStyle = 'rgba(182,156,255,0.25)';
        ctx.setLineDash([4, 6]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(player.x, player.y, player.goalR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // Nova timer ring
      if (nova > 0) {
        ctx.strokeStyle = 'rgba(255,209,102,0.8)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(player.x, player.y, player.r + 6, -Math.PI / 2, -Math.PI / 2 + (nova / 5) * Math.PI * 2);
        ctx.stroke();
      }
    }

    // Particles
    for (const q of particles) {
      ctx.globalAlpha = clamp(q.life / q.max, 0, 1);
      ctx.fillStyle = q.color;
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---------- Main loop ----------
  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min((now - lastT) / 1000, 1 / 30); // clamp big gaps (e.g. after unlock)
    lastT = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  // ---------- Boot ----------
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 250));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
  resize();

  const isIOS = /iP(hone|od|ad)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIOS && !window.navigator.standalone) ui.installHint.classList.remove('hidden');

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  setState(S.TITLE);
  requestAnimationFrame(frame);

  // Test hook (harmless in production).
  window.__genesis = { get state() { return state; }, get score() { return score; }, get stage() { return stage; }, player, motes };
})();
