import * as THREE from './three.js';
import { loadTextures, makeMaterials, applyPaint, PAINTS } from './atlas.js';
import { FX } from './fx.js';
import { Sound } from './audio.js';
import { World, SUN_DIR } from './world.js';
import { Mech } from './mech.js';
import { WeaponSystem, PRESETS } from './weapons.js';
import { Input } from './input.js';
import { HUD, Hangar } from './ui.js';

const V3 = THREE.Vector3;
const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const dampAngle = (cur, target, rate, dt) => cur + wrap(target - cur) * (1 - Math.exp(-rate * dt));

// The world is scaled around the mech: METERS (meters per game unit) is set at
// startup from the mech's measured height so that it stands 40 ft tall.
const MECH_HEIGHT_M = 40 * 0.3048;
let METERS = 1.7;

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* storage blocked */ } },
};

const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

// ---------------------------------------------------------------------------
// Renderer & scene
// ---------------------------------------------------------------------------

const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.6, 9000);

const settings = Object.assign({ sound: true, shadows: !isTouch, invert: false, sens: 1, hires: !isTouch, outlines: true }, store.get('fs07.settings', {}));

function applySettings() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, settings.hires ? 2 : 1.25));
  resize();
  renderer.shadowMap.enabled = settings.shadows;
  if (world) world.sun.castShadow = settings.shadows;
  scene.traverse((o) => { if (o.material && o.material.needsUpdate !== undefined) o.material.needsUpdate = true; });
  sound.setEnabled(settings.sound);
  if (weapons) weapons.outlines = settings.outlines;
  scene.traverse((o) => { if (o.userData.isOutline) o.visible = settings.outlines; });
  store.set('fs07.settings', settings);
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// Environment map so metal and painted armor pick up sky reflections.
function buildEnvironment() {
  const envScene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { uSun: { value: SUN_DIR.clone() } },
    vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uSun; varying vec3 vD;
      void main(){ vec3 d = normalize(vD); float h = d.y;
        vec3 sky = mix(vec3(0.85,0.87,0.88), vec3(0.28,0.46,0.75), pow(max(h,0.0),0.6));
        vec3 gnd = vec3(0.36,0.37,0.38);
        vec3 c = h > 0.0 ? sky : mix(sky, gnd, smoothstep(0.0,-0.2,h));
        c += vec3(1.0,0.9,0.75) * pow(max(dot(d,uSun),0.0), 64.0) * 6.0;
        gl_FragColor = vec4(c,1.0); }`,
  });
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), mat));
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(envScene, 0.02);
  scene.environment = rt.texture;
  scene.environmentIntensity = 0.55;
  pm.dispose();
}

// ---------------------------------------------------------------------------
// Game objects (created after textures load)
// ---------------------------------------------------------------------------

const sound = new Sound();
const input = new Input(canvas);
input.touchMode = isTouch;
let world, fx, mech, weapons, hud, hangar, mats;

const DEFAULT = PRESETS[0];
// Bumped storage key: loadouts saved for the earlier frame start fresh on this one.
const loadout = store.get('fs07.loadout.ac', null) || { paint: DEFAULT.paint, slots: JSON.parse(JSON.stringify(DEFAULT.slots)) };
if (!PAINTS.some((p) => p.id === loadout.paint)) loadout.paint = PAINTS[0].id;

// Additive glow on the ground under the thrusters
const washMat = new THREE.MeshBasicMaterial({ color: 0x7fb4ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
let wash;

const P = {
  pos: new V3(0, 0, 0),
  vel: new V3(),
  yaw: Math.PI, pitch: 0.05,
  bodyYaw: Math.PI,
  grounded: true,
  boost: 100, overheat: false, boostDelay: 0,
  jumpT: 0, launchT: 0, landT: 0, airT: 0,
  phase: 0, gaitDir: 1, legYaw: 0,
  dashing: false, ascending: false,
  thrust: { main: 0, vern: 0, calf: 0, sole: 0 },
};
const cam = { dist: 16, shake: 0, fov: 60, pivotY: 7, orbit: 0, orbitR: 15, orbitSpeed: 0.18, lookY: 4.6, orbitY: 5.6 };
let mode = 'loading'; // loading | intro | play | hangar
let time = 0;

function shake(pos, amount) {
  const d = pos ? pos.distanceTo(P.pos) : 0;
  cam.shake = Math.min(1.2, cam.shake + amount / (1 + d / 40));
}

/** Height of the top of the mech's head in its idle stance, in game units */
function measureMech() {
  const st = {
    gait: 0, air: 0, dash: 0, crouch: 0, vel: new V3(), bodyYaw: 0, ground: 0, legYaw: 0, aimYaw: 0, aimPitch: 0,
    aim: [0, 0], recoil: [0, 0], reload: [false, false], shield: false, hasShield: false,
    thrust: { main: 0, vern: 0, calf: 0, sole: 0 }, time: 0,
  };
  for (let i = 0; i < 90; i++) mech.animate(1 / 30, st);
  mech.root.updateMatrixWorld(true);
  let top = 0;
  const v = new V3();
  mech.head.traverse((o) => {
    if (!o.isMesh || o.userData.isOutline) return;
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) top = Math.max(top, v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).y);
  });
  return top - mech.root.position.y;
}

async function init() {
  resize();
  const tex = await loadTextures(renderer, (p) => { $('#load-bar').style.width = `${Math.round(p * 100)}%`; });
  $('#load-msg').textContent = 'Assembling frame…';
  await new Promise((r) => setTimeout(r, 30));

  buildEnvironment();
  mats = makeMaterials(tex);
  applyPaint(mats, PAINTS.find((p) => p.id === loadout.paint) || PAINTS[0]);
  fx = new FX(scene, { onShake: shake, sound });
  hud = new HUD();
  mech = new Mech(mats, fx.glowTex);
  METERS = MECH_HEIGHT_M / measureMech();
  $('#load-msg').textContent = 'Building Lower Manhattan…';
  await new Promise((r) => setTimeout(r, 30));
  world = new World(scene, mats, fx, sound, { M: 1 / METERS, cityTex: tex.city }, {
    onHit: () => hud.hit(false),
    onKill: () => { hud.hit(true); hud.addKill(); },
  });
  P.pos.copy(world.spawn);
  mech.root.position.copy(P.pos);
  mech.resetFeet();
  if (world.city.landmark) {
    P.yaw = P.bodyYaw = Math.atan2(world.city.landmark.x - P.pos.x, world.city.landmark.z - P.pos.z);
  }
  cam.orbit = P.bodyYaw + 0.5;
  washMat.map = fx.glowTex;
  wash = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), washMat);
  wash.rotation.x = -Math.PI / 2;
  wash.renderOrder = 2;
  scene.add(wash);
  mech.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(mech.root);
  weapons = new WeaponSystem({ scene, fx, sound, world, mech, mats });
  weapons.onShake = shake;
  weapons.equip(loadout);

  hangar = new Hangar({
    loadout, settings, sound,
    onChange: () => {
      applyPaint(mats, PAINTS.find((p) => p.id === loadout.paint) || PAINTS[0]);
      weapons.equip(loadout);
      store.set('fs07.loadout.ac', loadout);
    },
    onSettings: applySettings,
  });
  applySettings();

  if (isTouch) {
    document.body.classList.add('touch');
    input.setupTouch($('#touch'));
  }
  input.onLockChange = (locked) => {
    if (!locked && mode === 'play' && !input.lockFailed) openHangar();
  };

  $('#btn-launch').addEventListener('click', () => { sound.unlock(); startPlay(); });
  $('#btn-intro-hangar').addEventListener('click', () => { sound.unlock(); $('#intro').hidden = true; openHangar(); });
  $('#btn-close-hangar').addEventListener('click', () => { sound.unlock(); startPlay(); });
  $('#btn-hangar').addEventListener('click', () => openHangar());
  $('#t-menu').addEventListener('click', () => openHangar());
  canvas.addEventListener('click', () => {
    sound.unlock();
    if (mode === 'play' && !input.locked) input.requestLock();
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && mode === 'hangar') startPlay();
  });

  // Warm up shaders so the first shots don't hitch
  renderer.compile(scene, camera);

  $('#loading').hidden = true;
  $('#intro').hidden = false;
  mode = 'intro';
  requestAnimationFrame(frame);
}

function startPlay() {
  $('#intro').hidden = true;
  $('#hangar').hidden = true;
  $('#hud').hidden = false;
  if (isTouch) $('#touch').hidden = false;
  mode = 'play';
  input.requestLock();
}

function openHangar() {
  if (mode === 'hangar') return;
  mode = 'hangar';
  $('#hangar').hidden = false;
  $('#touch').hidden = true;
  input.exitLock();
  cam.orbit = P.bodyYaw + 0.6;
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

const _f = new V3(), _r = new V3(), _w = new V3(), _t = new V3(), _t2 = new V3();
const NO_INPUT = { move: { x: 0, y: 0 }, lookX: 0, lookY: 0 };

function updatePlayer(dt, c) {
  const playing = mode === 'play';
  if (!playing) c = Object.assign({}, NO_INPUT, { wheel: c.wheel });

  // Look
  const sens = 0.0022 * settings.sens;
  P.yaw -= c.lookX * sens;
  P.pitch = clamp(P.pitch - c.lookY * sens * (settings.invert ? -1 : 1), -0.7, 1.0);
  // Lock-on steers the camera so the target stays in view; the mouse still adds on top
  if (playing && hard.target) {
    _t.subVectors(hard.target.pos, _t2.set(P.pos.x, P.pos.y + 6.2, P.pos.z));
    const ty = Math.atan2(_t.x, _t.z);
    const tp = clamp(Math.atan2(_t.y, Math.hypot(_t.x, _t.z)) + 0.04, -0.7, 1.0);
    P.yaw = dampAngle(P.yaw, ty, 3.5, dt);
    P.pitch = damp(P.pitch, tp, 3, dt);
  }
  if (c.wheel) cam.dist = clamp(cam.dist + c.wheel * 1.5, 9, 26);

  _f.set(Math.sin(P.yaw), 0, Math.cos(P.yaw));
  _r.set(-Math.cos(P.yaw), 0, Math.sin(P.yaw));
  _w.set(0, 0, 0).addScaledVector(_f, c.move.y).addScaledVector(_r, c.move.x);
  const wishLen = _w.length();
  if (wishLen > 1) _w.divideScalar(wishLen);

  // Boost / dash
  const canBoost = P.boost > 0 && !P.overheat;
  if (playing && c.dashPressed && canBoost && P.boost > 6) {
    sound.boostIgnite();
    P.boost -= 6;
    const dir = wishLen > 0.1 ? _t.copy(_w).normalize() : _t.copy(_f);
    P.vel.x += dir.x * 14; P.vel.z += dir.z * 14;
    if (P.grounded) fx.dust(P.pos, 0.8, 8);
  }
  P.dashing = playing && !!c.dash && canBoost;
  const maxSpeed = P.dashing ? 36 : 7.5;
  const accel = P.grounded ? (P.dashing ? 70 : 30) : (P.dashing ? 45 : 14);
  const target = _t.set(0, 0, 0);
  if (wishLen > 0.08) target.copy(_w).multiplyScalar(maxSpeed);
  else if (P.dashing) target.copy(_f).multiplyScalar(maxSpeed);
  const landSlow = P.landT > 0 ? 0.25 : 1;
  target.multiplyScalar(landSlow);
  _t2.set(target.x - P.vel.x, 0, target.z - P.vel.z);
  const dv = _t2.length();
  const decel = wishLen < 0.08 && !P.dashing && P.grounded ? 45 : accel;
  if (dv > 0) {
    const step = Math.min(dv, decel * dt);
    P.vel.x += (_t2.x / dv) * step;
    P.vel.z += (_t2.z / dv) * step;
  }

  // Vertical
  P.ascending = false;
  P.launchT = Math.max(0, P.launchT - dt);
  P.landT = Math.max(0, P.landT - dt);
  if (P.grounded) {
    P.airT = 0;
    if (playing && c.jumpPressed && P.jumpT <= 0 && P.landT <= 0.05) { P.jumpT = 0.13; sound.servo(P.pos); }
    if (P.jumpT > 0) {
      P.jumpT -= dt;
      if (P.jumpT <= 0) {
        P.vel.y = 15;
        P.grounded = false;
        P.launchT = 0.35;
        if (canBoost) P.boost -= 4;
        sound.boostIgnite();
        fx.dust(P.pos, 1.2, 14);
        shake(null, 0.25);
      }
    }
  } else {
    P.airT += dt;
    let g = 32;
    if (playing && c.jump && canBoost && P.airT > 0.12) {
      P.ascending = true;
      P.vel.y = Math.min(14, P.vel.y + 62 * dt);
      g = 0;
      P.boost -= 24 * dt;
    } else if (P.dashing) {
      g = 9;
      P.vel.y = Math.max(P.vel.y, -6);
    }
    P.vel.y -= g * dt;
  }
  if (P.dashing) P.boost -= 26 * dt;

  // Integrate
  const px = P.pos.x, pz = P.pos.z;
  P.pos.addScaledVector(P.vel, dt);
  // Blocked by a wall: keep only the motion that actually happened (slide along it)
  if (world.resolve(P.pos, 1.5, 7) && dt > 0) {
    P.vel.x = (P.pos.x - px) / dt;
    P.vel.z = (P.pos.z - pz) / dt;
  }
  const ground = world.groundHeight(P.pos.x, P.pos.z, P.pos.y, 0.9);
  if (P.pos.y <= ground) {
    if (!P.grounded) {
      const impact = -P.vel.y;
      if (impact > 5) {
        P.landT = clamp(impact / 45, 0.12, 0.45);
        shake(null, clamp(impact / 40, 0.15, 0.7));
        fx.dust(P.pos, clamp(impact / 15, 0.8, 2), 16);
        sound.footstep(P.pos, 1.4);
      }
    }
    P.pos.y = ground;
    P.vel.y = Math.max(0, P.vel.y);
    P.grounded = true;
  } else if (P.grounded && P.pos.y > ground + 0.05) {
    P.grounded = false;
  }
  if (P.grounded && P.pos.y > ground) P.pos.y = ground;

  // Boost regen and overheat
  if (P.dashing || P.ascending) P.boostDelay = 0.6;
  else if (P.grounded) {
    P.boostDelay -= dt;
    if (P.boostDelay <= 0) P.boost = Math.min(100, P.boost + 42 * dt);
  }
  if (P.boost <= 0 && !P.overheat) {
    P.boost = 0;
    P.overheat = true;
    hud.toast('OVERHEAT', 1.6);
    sound.alarm();
  }
  if (P.overheat && P.boost >= 40) P.overheat = false;

  // Facing and legs
  P.bodyYaw = dampAngle(P.bodyYaw, P.yaw, mode === 'play' ? 7 : 2, dt);
  const fwdB = _t.set(Math.sin(P.bodyYaw), 0, Math.cos(P.bodyYaw));
  const speed = Math.hypot(P.vel.x, P.vel.z);
  const lz = P.vel.x * fwdB.x + P.vel.z * fwdB.z;
  const lx = P.vel.x * fwdB.z - P.vel.z * fwdB.x; // component toward the mech's left (+X local)
  if (speed > 0.6) {
    if (lz >= -0.35 * speed) { P.legYaw = clamp(Math.atan2(lx, lz), -1.2, 1.2); P.gaitDir = 1; }
    else { P.legYaw = clamp(Math.atan2(-lx, -lz), -1.0, 1.0); P.gaitDir = -1; }
  } else P.legYaw *= 0.9;
  const walking = P.grounded && !P.dashing && P.landT <= 0;
  const gait = walking ? clamp(speed / 7.5, 0, 1) : 0;

  // Thrusters
  const T = P.thrust;
  const tMain = P.dashing ? 1 : P.ascending ? 0.85 : P.launchT > 0 ? 0.9 : !P.grounded ? 0.12 : 0;
  const tVern = P.dashing ? 0.75 : P.ascending ? 0.55 : P.launchT > 0 ? 0.5 : 0;
  const tCalf = P.ascending ? 0.9 : P.dashing ? 0.55 : P.launchT > 0 ? 0.8 : 0;
  const tSole = P.ascending ? 1 : P.launchT > 0 ? 1 : 0;
  T.main = damp(T.main, tMain, 14, dt);
  T.vern = damp(T.vern, tVern, 14, dt);
  T.calf = damp(T.calf, tCalf, 14, dt);
  T.sole = damp(T.sole, tSole, 14, dt);
  sound.setThrust(Math.max(T.main, T.sole * 0.8), dt);

  // Exhaust particles and ground wash
  if (T.main > 0.3 || T.sole > 0.3) {
    for (const th of mech.allThrusters()) {
      if (th.level < 0.3) continue;
      th.worldExhaust(_t, _t2);
      const s = 6 + 10 * th.level;
      fx.fire.emit(_t.x, _t.y, _t.z, _t2.x * s + P.vel.x, _t2.y * s + P.vel.y, _t2.z * s + P.vel.z,
        0.07, th.size * 1.3, th.size * 0.3, 0.35, 0.5, 1.0, 0.7, 0.4, 0.2, 0.9, 0, 2);
    }
    const alt = P.pos.y - ground;
    if (alt < 9 && (P.ascending || P.launchT > 0) && Math.random() < 0.7) {
      const k = 1 - alt / 9;
      fx.dust(_t.set(P.pos.x, ground, P.pos.z), 0.7 + k, 2);
    }
  }
  {
    const alt = P.pos.y - ground;
    const k = Math.max(T.main * 0.7, T.sole) * Math.max(0, 1 - alt / 12);
    washMat.opacity = k * (0.55 + Math.random() * 0.15);
    wash.position.set(P.pos.x, ground + 0.06, P.pos.z);
    wash.scale.setScalar(6 + alt * 0.8);
  }
  if (P.dashing && P.grounded && Math.random() < 0.8) {
    // Skid sparks and dust behind the feet
    for (let i = 0; i < 2; i++) {
      mech.footWorld(i, _t);
      fx.sparks.emit(_t.x, ground + 0.2, _t.z, -P.vel.x * 0.4 + (Math.random() - 0.5) * 6, Math.random() * 5, -P.vel.z * 0.4 + (Math.random() - 0.5) * 6,
        0.35, 0.16, 0.05, 3, 2, 0.8, 1, 1, 0.4, 0.1, 0.5, 1, -25);
    }
    if (Math.random() < 0.5) {
      const g = 0.5;
      fx.smoke.emit(P.pos.x, ground + 0.4, P.pos.z, -P.vel.x * 0.15, 1, -P.vel.z * 0.15, 1.4, 1.5, 5, g, g * 0.94, g * 0.86, 0.45, g, g, g, 0, 1.5, 0.2);
    }
  }

  return { speed, gait, ground };
}

// ---------------------------------------------------------------------------
// Camera & aim
// ---------------------------------------------------------------------------

const aim = { point: new V3(), dir: new V3() };

// Lock-on button: holds one target for the aimed weapons and the camera
const hard = { target: null };
const _ndc = new V3();

function lockCandidates() {
  const out = [];
  for (const t of world.targets) {
    if (!t.alive || t.pos.distanceTo(P.pos) > 460) continue;
    _ndc.copy(t.pos).project(camera);
    if (_ndc.z > 1) continue;
    const r = Math.hypot(_ndc.x * camera.aspect, _ndc.y);
    if (r < 1.25) out.push({ t, r });
  }
  return out.sort((a, b) => a.r - b.r);
}

function setHardLock(t) {
  hard.target = t;
  weapons.hardTarget = t;
}

function pressLock() {
  const c = lockCandidates();
  if (!c.length) {
    if (hard.target) { setHardLock(null); hud.toast('LOCK RELEASED', 0.8); }
    else sound.empty();
    return;
  }
  // Pressing again while still pointed at the locked target releases it
  if (hard.target && c[0].t === hard.target) { setHardLock(null); hud.toast('LOCK RELEASED', 0.8); sound.click(); return; }
  setHardLock(c[0].t);
  sound.lockFull();
}

function updateHardLock() {
  const t = hard.target;
  if (!t) return;
  if (!t.alive) {
    // Roll onto the next target in view, if any
    const c = lockCandidates();
    setHardLock(c.length ? c[0].t : null);
    if (hard.target) sound.lock();
  } else if (t.pos.distanceTo(P.pos) > 520) setHardLock(null);
}

function leadPoint(out) {
  const t = hard.target;
  const s = weapons.slots.rightHand;
  const speed = s && s.def.speed ? s.def.speed : 0;
  const d = t.pos.distanceTo(P.pos);
  out.copy(t.pos);
  if (speed > 0) out.addScaledVector(t.vel, Math.min(2, d / speed));
  return out;
}
const camDir = new V3(), camRight = new V3(), pivot = new V3(), camPos = new V3();

function updateCamera(dt, speed) {
  cam.pivotY = damp(cam.pivotY, P.pos.y + 7.4, 10, dt);
  pivot.set(P.pos.x, cam.pivotY, P.pos.z);
  if (mode === 'play' && !cam.debugOrbit) {
    camDir.set(Math.sin(P.yaw) * Math.cos(P.pitch), Math.sin(P.pitch), Math.cos(P.yaw) * Math.cos(P.pitch));
    camRight.set(-Math.cos(P.yaw), 0, Math.sin(P.yaw));
    // Shoulder offset, pulled in when a wall is close on that side
    let side = 4.4;
    const sideHit = world.raycast(pivot, camRight, side + 1.2, { targets: false });
    if (sideHit) side = Math.max(0, sideHit.dist - 1.2);
    const origin = _t.copy(pivot).addScaledVector(camRight, side);
    // Pull in when something blocks the view
    const back = _t2.copy(camDir).negate();
    const hit = world.raycast(origin, back, cam.dist, { targets: false });
    const dist = hit ? Math.max(3, hit.dist - 0.8) : cam.dist;
    camPos.copy(origin).addScaledVector(back, dist);
    camPos.y += 1.0;
    camPos.y = Math.max(camPos.y, world.groundHeight(camPos.x, camPos.z, camPos.y) + 0.8);
    camera.position.copy(camPos);
    camera.lookAt(_t.copy(camPos).add(camDir));
    const fovT = P.dashing ? 72 : 60;
    cam.fov = damp(cam.fov, fovT, 4, dt);
  } else {
    // Showroom orbit for the intro and hangar
    cam.orbit += dt * cam.orbitSpeed;
    const r = cam.orbitR;
    camPos.set(P.pos.x + Math.sin(cam.orbit) * r, P.pos.y + cam.orbitY, P.pos.z + Math.cos(cam.orbit) * r);
    camera.position.copy(camPos);
    const look = _t.set(P.pos.x, P.pos.y + cam.lookY, P.pos.z);
    // Shift the mech left of center while a side panel covers the right
    const panelOpen = mode === 'hangar' && window.innerWidth > 720;
    const introOpen = mode === 'intro' && window.innerWidth > 720;
    if (panelOpen || introOpen) {
      _t2.subVectors(look, camPos).normalize().cross(new V3(0, 1, 0)).normalize();
      look.addScaledVector(_t2, panelOpen ? 4.5 : -4.5);
    }
    if (mode === 'hangar' && window.innerWidth <= 720) look.y -= 2.5;
    camera.lookAt(look);
    camDir.subVectors(look, camPos).normalize();
    cam.fov = damp(cam.fov, 50, 3, dt);
  }
  if (cam.free) {
    // Debug/screenshot camera: { pos: [x, y, z], look: [x, y, z], fov }
    camera.position.set(...cam.free.pos);
    camera.lookAt(_t.set(...cam.free.look));
    cam.fov = cam.free.fov || cam.fov;
  }
  camera.fov = cam.fov;
  camera.updateProjectionMatrix();

  // Shake
  if (cam.shake > 0) {
    const s = cam.shake * cam.shake * 0.5;
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
    camera.position.z += (Math.random() - 0.5) * s;
    cam.shake = Math.max(0, cam.shake - dt * 1.8);
  }

  // Aim point: ray through screen center starting at the mech's depth
  const startT = Math.max(0, _t.subVectors(pivot, camera.position).dot(camDir));
  const o = _t2.copy(camera.position).addScaledVector(camDir, startT);
  const hit = world.raycast(o, camDir, 700);
  aim.point.copy(hit ? hit.point : o.addScaledVector(camDir, 700));
  if (hard.target && mode === 'play') leadPoint(aim.point);
  aim.dir.copy(camDir);

  sound.listener.x = camera.position.x;
  sound.listener.y = camera.position.y;
  sound.listener.z = camera.position.z;
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

let last = performance.now();
const feetA = new V3(), feetB = new V3();
const shoulder = new V3();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = window.__mech && window.__mech.fixedDt ? window.__mech.fixedDt : Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;

  const c = input.sample();
  if (c.menu) { if (mode === 'play') openHangar(); else if (mode === 'hangar') startPlay(); }
  if (c.reload && mode === 'play') weapons.reloadAll();
  if (c.lockon && mode === 'play') pressLock();
  updateHardLock();

  const { speed, gait } = updatePlayer(dt, c);
  updateCamera(dt, speed);

  // Aim angles from the shoulders toward the aim point
  shoulder.set(P.pos.x, P.pos.y + 6.2, P.pos.z);
  _t.subVectors(aim.point, shoulder);
  const aimYawWorld = Math.atan2(_t.x, _t.z);
  const aiming = mode === 'play' && !cam.debugOrbit;
  const aimPitch = aiming ? clamp(Math.atan2(_t.y, Math.hypot(_t.x, _t.z)), -0.8, 1.0) : 0;
  const aimYaw = aiming ? clamp(wrap(aimYawWorld - P.bodyYaw), -1.2, 1.2) : 0;

  // Weapons (input only while playing)
  const wc = mode === 'play' ? c : { fireR: false, fireL: false, fireS: false, missile: false, salvo: false };
  weapons.update(dt, wc, aim, camera);

  // Animate mech
  mech.root.position.copy(P.pos);
  mech.root.rotation.y = P.bodyYaw;
  const H = weapons.hand;
  const res = mech.animate(dt, {
    gait, air: P.grounded ? 0 : 1, dash: P.dashing ? 1 : 0,
    vel: P.vel, bodyYaw: P.bodyYaw, ground: P.pos.y,
    crouch: P.jumpT > 0 ? 1 : P.landT > 0 ? Math.min(1, P.landT * 3) : 0,
    legYaw: P.legYaw, aimYaw, aimPitch,
    aim: [H[0].aim, H[1].aim], recoil: [H[0].recoil, H[1].recoil], reload: [H[0].reload, H[1].reload],
    shield: weapons.shieldUp, hasShield: !!(weapons.slots.leftHand && weapons.slots.leftHand.def.kind === 'shield'),
    thrust: (window.__mech && window.__mech.forceThrust) || P.thrust, time,
  });
  if (res.step >= 0) {
    mech.footWorld(res.step, _t);
    _t.y = P.pos.y;
    const k = res.soft ? 0.45 : 1;
    fx.dust(_t, (0.6 + gait * 0.4) * k, res.soft ? 4 : 8);
    sound.footstep(_t, (0.75 + gait * 0.4) * k);
    shake(null, (0.16 + gait * 0.12) * k);
  }

  world.update(dt, P.pos, { grounded: P.grounded, feet: [mech.footWorld(0, feetA), mech.footWorld(1, feetB)] });
  fx.update(dt);

  if (mode === 'play' || mode === 'hangar') {
    hud.update(dt, {
      boost: P.boost, overheat: P.overheat,
      speed: speed * METERS * 3.6, alt: (P.pos.y) * METERS,
      locks: weapons.lock.locks, missiles: weapons.missilesLoaded, missileCap: weapons.missileCapacity,
      weapons: weapons.status(), camera, hard: hard.target, meters: METERS,
    });
  }

  if (!(window.__mech && window.__mech.skipRender)) renderer.render(scene, camera);
}

init().catch((err) => {
  console.error(err);
  $('#load-msg').textContent = `Could not start: ${err.message}`;
});

// Debug/test hook
window.__mech = {
  P, cam, input, startPlay, openHangar,
  applyPaintById: (id) => applyPaint(mats, PAINTS.find((p) => p.id === id) || PAINTS[0]),
  renderer, get METERS() { return METERS; }, get time() { return time; }, get weapons() { return weapons; }, get world() { return world; }, get mech() { return mech; }, get mode() { return mode; },
};
