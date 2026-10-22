// Keyboard, mouse (pointer lock) and touch input, merged into one control
// snapshot per frame.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.edges = new Set();
    this.mouse = { L: false, R: false, M: false };
    this.look = { x: 0, y: 0 };
    this.wheel = 0;
    this.locked = false;
    this.lockFailed = false;
    this.enabled = true;
    this.touchMode = false;
    this.touch = { move: { x: 0, y: 0 }, fireR: false, fireL: false, fireS: false, jump: false, dash: false };
    this.onMenu = null;

    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      const k = e.code;
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
      if (!this.keys.has(k)) this.edges.add(k);
      this.keys.add(k);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.L = this.mouse.R = this.mouse.M = false; });

    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouse.L = true;
      if (e.button === 1) { this.mouse.M = true; e.preventDefault(); }
      if (e.button === 2) this.mouse.R = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.L = false;
      if (e.button === 1) this.mouse.M = false;
      if (e.button === 2) this.mouse.R = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (this.touchMode) return;
      // Without pointer lock, look by dragging with any button held.
      if (this.locked || (this.lockFailed && (this.mouse.L || this.mouse.R || this.mouse.M))) {
        this.look.x += e.movementX || 0;
        this.look.y += e.movementY || 0;
      }
    });
    canvas.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.locked) this.lockFailed = false;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    document.addEventListener('pointerlockerror', () => { this.lockFailed = true; });
  }

  requestLock() {
    if (this.touchMode || this.locked) return;
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => { this.lockFailed = true; });
    } catch (_) {
      this.lockFailed = true;
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // ---- touch -----------------------------------------------------------------

  setupTouch(root) {
    const stick = root.querySelector('#stick');
    const knob = root.querySelector('#stick-knob');
    const lookZone = root.querySelector('#look-zone');
    const moveZone = root.querySelector('#move-zone');
    const R = 56;
    let stickId = null, ox = 0, oy = 0;
    moveZone.addEventListener('pointerdown', (e) => {
      if (stickId !== null) return;
      stickId = e.pointerId;
      moveZone.setPointerCapture(e.pointerId);
      ox = e.clientX; oy = e.clientY;
      stick.style.left = `${ox}px`;
      stick.style.top = `${oy}px`;
      stick.classList.add('on');
      knob.style.transform = 'translate(-50%, -50%)';
    });
    moveZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== stickId) return;
      let dx = e.clientX - ox, dy = e.clientY - oy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      this.touch.move.x = dx / R;
      this.touch.move.y = -dy / R;
    });
    const endStick = (e) => {
      if (e.pointerId !== stickId) return;
      stickId = null;
      this.touch.move.x = this.touch.move.y = 0;
      stick.classList.remove('on');
    };
    moveZone.addEventListener('pointerup', endStick);
    moveZone.addEventListener('pointercancel', endStick);

    // Look: drag anywhere on the right side, and also while holding fire buttons
    const lookDrag = (el, onDown, onUp) => {
      let id = null, lx = 0, ly = 0;
      el.addEventListener('pointerdown', (e) => {
        if (id !== null) return;
        id = e.pointerId;
        el.setPointerCapture(e.pointerId);
        lx = e.clientX; ly = e.clientY;
        el.classList.add('held');
        onDown && onDown();
        e.preventDefault();
      });
      el.addEventListener('pointermove', (e) => {
        if (e.pointerId !== id) return;
        this.look.x += (e.clientX - lx) * 1.6;
        this.look.y += (e.clientY - ly) * 1.6;
        lx = e.clientX; ly = e.clientY;
      });
      const up = (e) => {
        if (e.pointerId !== id) return;
        id = null;
        el.classList.remove('held');
        onUp && onUp();
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    };
    lookDrag(lookZone);
    const hold = (sel, key) => {
      const el = root.querySelector(sel);
      if (!el) return;
      lookDrag(el, () => { this.touch[key] = true; }, () => { this.touch[key] = false; });
    };
    hold('#t-fire', 'fireR');
    hold('#t-fireL', 'fireL');
    hold('#t-cannon', 'fireS');
    hold('#t-jump', 'jump');
    hold('#t-dash', 'dash');
    const tap = (sel, code) => {
      const el = root.querySelector(sel);
      if (!el) return;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.edges.add(code);
        el.classList.add('held');
        setTimeout(() => el.classList.remove('held'), 140);
      });
    };
    tap('#t-msl', 'KeyQ');
    tap('#t-salvo', 'KeyE');
    tap('#t-reload', 'KeyR');
    tap('#t-lock', 'KeyT');
  }

  // ---- per-frame snapshot ----------------------------------------------------

  sample() {
    const k = this.keys, e = this.edges, t = this.touch;
    let mx = 0, my = 0;
    if (k.has('KeyW')) my += 1;
    if (k.has('KeyS')) my -= 1;
    if (k.has('KeyD')) mx += 1;
    if (k.has('KeyA')) mx -= 1;
    mx += t.move.x; my += t.move.y;
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    let lx = this.look.x, ly = this.look.y;
    if (k.has('ArrowLeft')) lx -= 9;
    if (k.has('ArrowRight')) lx += 9;
    if (k.has('ArrowUp')) ly -= 6;
    if (k.has('ArrowDown')) ly += 6;
    this.look.x = this.look.y = 0;
    // Mouse buttons only count while the pointer is captured (or in drag-look mode)
    const mouseLive = this.locked || this.lockFailed;
    const c = {
      move: { x: mx, y: my },
      lookX: lx, lookY: ly,
      fireR: (mouseLive && this.mouse.L) || t.fireR || k.has('KeyJ'),
      fireL: (mouseLive && this.mouse.R) || t.fireL || k.has('KeyK'),
      fireS: k.has('KeyF') || (mouseLive && this.mouse.M) || t.fireS,
      jump: k.has('Space') || t.jump,
      jumpPressed: e.has('Space'),
      dash: k.has('ShiftLeft') || k.has('ShiftRight') || t.dash,
      missile: e.has('KeyQ'),
      salvo: e.has('KeyE'),
      reload: e.has('KeyR'),
      lockon: e.has('KeyT'),
      menu: e.has('Tab') || e.has('KeyM'),
      camera: e.has('KeyV'),
      wheel: this.wheel,
    };
    this.wheel = 0;
    // Touch jump presses register as an edge on the first held frame
    if (t.jump && !this._tj) c.jumpPressed = true;
    this._tj = t.jump;
    if (t.dash && !this._td) c.dashPressed = true;
    if ((k.has('ShiftLeft') || k.has('ShiftRight')) && (e.has('ShiftLeft') || e.has('ShiftRight'))) c.dashPressed = true;
    this._td = t.dash;
    e.clear();
    return c;
  }
}
