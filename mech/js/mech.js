import * as THREE from './three.js';
import { B, BODY_SHEET, frontPrism, sidePrism, chamferBox, cylZ, cylX, loft, mesh, place, canvasTexture, pieceGeo, addOutline } from './atlas.js';

const V3 = THREE.Vector3;
const P = (geo, mat, faces, opts) => mesh(geo, mat, BODY_SHEET, faces, opts);
const mirror = (pts, s) => pts.map(([x, y]) => [x * s, y]);
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Leg segment lengths (pelvis → hip joint, thigh, shin, ankle → sole).
// Short, thick legs for a squat, heavy stance.
export const LEG = { hipDrop: 0.18, thigh: 1.15, shin: 1.45, foot: 0.5 };

// ---------------------------------------------------------------------------
// Thruster
//
// A bell nozzle hung from a gimbal ring, with hydraulic actuators linking the
// bell to its housing. The exhaust is a camera-facing plume with shock
// diamonds, a hot inner bell and a glow sprite at the exit.
// ---------------------------------------------------------------------------

const PLUME_VERT = /* glsl */`
uniform float uWidth;
varying float vT;
varying float vX;
void main() {
  vT = -position.y;
  vX = position.x * 2.0;
  vec3 base = (modelMatrix * vec4(0.0, position.y, 0.0, 1.0)).xyz;
  vec3 axis = normalize((modelMatrix * vec4(0.0, -1.0, 0.0, 0.0)).xyz);
  vec3 side = cross(axis, cameraPosition - base);
  float L = length(side);
  side = L > 1e-5 ? side / L : vec3(1.0, 0.0, 0.0);
  float t = vT;
  float w = uWidth * (1.0 + 0.6 * t * (1.0 - t)) * mix(1.0, 0.4, t);
  gl_Position = projectionMatrix * viewMatrix * vec4(base + side * position.x * w, 1.0);
}`;

const PLUME_FRAG = /* glsl */`
uniform float uTime;
uniform float uPower;
uniform float uSeed;
uniform vec3 uCore;
uniform vec3 uMid;
uniform vec3 uEdge;
varying float vT;
varying float vX;
float hash(float n) { return fract(sin(n) * 43758.5453); }
float noise(float x) { float i = floor(x), f = fract(x); return mix(hash(i), hash(i + 1.0), f * f * (3.0 - 2.0 * f)); }
void main() {
  float r = abs(vX);
  float t = vT;
  float body = (1.0 - smoothstep(0.0, 1.0, r)) * pow(1.0 - t, 1.4);
  float core = exp(-r * r * 22.0) * pow(1.0 - t, 0.7);
  // Shock diamonds: stationary bright knots along the core
  float knots = pow(abs(cos(t * 5.5 * 3.14159 + 0.4)), 10.0) * smoothstep(0.85, 0.05, t);
  float flick = 0.8 + 0.4 * noise(t * 9.0 - uTime * 30.0 + uSeed);
  vec3 col = mix(uMid, uEdge, smoothstep(0.15, 0.9, t)) * body * flick;
  col += uCore * core * (0.35 + 1.3 * knots) * flick;
  gl_FragColor = vec4(col * uPower, 1.0);
}`;

const SHELL_VERT = /* glsl */`
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const SHELL_FRAG = /* glsl */`
uniform float uTime;
uniform float uPower;
uniform float uSeed;
uniform vec3 uCore;
uniform vec3 uMid;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  float t = 1.0 - vUv.y;
  float fres = 0.3 + 0.7 * abs(dot(vN, vV));
  float n = noise(vec2(vUv.x * 9.0 + uSeed, t * 6.0 - uTime * 26.0));
  float a = pow(fres, 1.5) * pow(1.0 - t, 2.0) * (0.6 + 0.6 * n) * uPower;
  vec3 col = mix(uCore, uMid, smoothstep(0.0, 0.5, t));
  gl_FragColor = vec4(col * a * 1.6, 1.0);
}`;

let nozzleKit;
function getNozzleKit(glowTex) {
  if (nozzleKit) return nozzleKit;
  // Bell nozzle: tight throat that flares quickly, then straightens out.
  const bell = (rt, re, len, n = 12) => {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const s = i / n;
      pts.push(new THREE.Vector2(rt + (re - rt) * (1 - Math.pow(1 - s, 2.3)), -len * s));
    }
    return pts;
  };
  const outer = bell(0.32, 0.74, 1.2);
  const lip = [new THREE.Vector2(0.81, -1.2), new THREE.Vector2(0.81, -1.26), new THREE.Vector2(0.7, -1.26)];
  const profile = [new THREE.Vector2(0.4, 0.06), new THREE.Vector2(0.4, 0.0), ...outer.map((p) => new THREE.Vector2(p.x + 0.05, p.y)), ...lip];
  const inner = bell(0.28, 0.7, 1.2).reverse();

  // Heat-tinted metal: gold near the throat through violet and blue to steel at the lip,
  // with machined rib bands.
  const heat = canvasTexture(64, (g, s) => {
    const gr = g.createLinearGradient(0, s, 0, 0); // bottom = throat (v=0)
    gr.addColorStop(0.0, '#2a2826');
    gr.addColorStop(0.1, '#3a3632');
    gr.addColorStop(0.2, '#a07a36');
    gr.addColorStop(0.36, '#7a4f6e');
    gr.addColorStop(0.52, '#3f4f7c');
    gr.addColorStop(0.72, '#4a4e56');
    gr.addColorStop(1.0, '#5d6168');
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
    g.fillStyle = 'rgba(15,15,18,0.55)';
    for (const v of [0.18, 0.34, 0.52, 0.7, 0.86]) g.fillRect(0, s - v * s - 1, s, 2);
  });
  const glow = canvasTexture(64, (g, s) => {
    const gr = g.createLinearGradient(0, 0, 0, s); // inner lathe is reversed: top = throat
    gr.addColorStop(0.0, 'rgba(40,60,120,0)');
    gr.addColorStop(0.55, 'rgba(120,180,255,0.6)');
    gr.addColorStop(1.0, 'rgba(255,250,240,1)');
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
  }, false);

  nozzleKit = {
    bellGeo: new THREE.LatheGeometry(profile, 24),
    innerGeo: new THREE.LatheGeometry(inner, 24),
    bandGeo: new THREE.TorusGeometry(0.5, 0.045, 6, 24).rotateX(Math.PI / 2),
    collarGeo: new THREE.CylinderGeometry(0.48, 0.48, 0.16, 20),
    plumeGeo: new THREE.PlaneGeometry(1, 1, 1, 12).translate(0, -0.5, 0),
    shellGeo: new THREE.CylinderGeometry(0.66, 0.08, 1, 18, 1, true).translate(0, -0.5, 0),
    pistonGeo: new THREE.CylinderGeometry(1, 1, 1, 8),
    bellMat: new THREE.MeshStandardMaterial({ map: heat, roughness: 0.5, metalness: 0.7, envMapIntensity: 0.5, side: THREE.DoubleSide }),
    collarMat: new THREE.MeshStandardMaterial({ color: 0x2b2e34, roughness: 0.35, metalness: 0.85 }),
    rodMat: new THREE.MeshStandardMaterial({ color: 0xc9ccd2, roughness: 0.15, metalness: 1.0 }),
    glowMap: glow,
    glowTex,
  };
  return nozzleKit;
}

const _a = new V3();
const _b = new V3();
const _up = new V3(0, 1, 0);

export class Thruster {
  /**
   * parent: Object3D the thruster hangs from
   * pos: position in parent space; dir: exhaust direction in parent space
   * size: nozzle scale; opts.actuators: anchor points (parent space) for hydraulic rams
   */
  constructor(parent, pos, dir, size, glowTex, opts = {}) {
    const K = getNozzleKit(glowTex);
    this.size = size;
    this.level = 0;
    this.gimbalTarget = 0;
    this.seed = Math.random() * 100;
    this.flaps = [];
    const g = (this.group = new THREE.Group());
    g.position.copy(pos);
    g.quaternion.setFromUnitVectors(new V3(0, -1, 0), dir.clone().normalize());
    parent.add(g);

    // Fixed collar the gimbal swings inside
    const collar = new THREE.Mesh(K.collarGeo, K.collarMat);
    collar.scale.setScalar(size);
    collar.position.y = 0.06 * size;
    collar.castShadow = true;
    g.add(collar);

    const gim = (this.gimbal = new THREE.Group());
    g.add(gim);
    const bell = new THREE.Mesh(K.bellGeo, K.bellMat);
    bell.scale.setScalar(size);
    bell.castShadow = true;
    gim.add(bell);
    const band = new THREE.Mesh(K.bandGeo, K.collarMat);
    band.scale.setScalar(size * 1.12);
    band.position.y = -0.5 * size;
    gim.add(band);

    // Hot inner wall, visible when looking into the nozzle
    this.innerMat = new THREE.MeshBasicMaterial({
      map: K.glowMap, color: 0x9fd0ff, transparent: true, opacity: 0.2, side: THREE.BackSide,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    const inner = new THREE.Mesh(K.innerGeo, this.innerMat);
    inner.scale.setScalar(size * 0.99);
    gim.add(inner);

    // Exhaust: soft plume ribbon + turbulent inner shell + exit glow
    const uni = (core, mid, edge) => ({
      uTime: { value: 0 }, uPower: { value: 0 }, uSeed: { value: this.seed }, uWidth: { value: 1 },
      uCore: { value: new THREE.Color(core) }, uMid: { value: new THREE.Color(mid) }, uEdge: { value: new THREE.Color(edge) },
    });
    const additive = { transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor };
    this.plume = new THREE.Mesh(K.plumeGeo, new THREE.ShaderMaterial({
      vertexShader: PLUME_VERT, fragmentShader: PLUME_FRAG, uniforms: uni(0xf4f8ff, 0x5aa0ff, 0x6a3cff), ...additive,
    }));
    this.shell = new THREE.Mesh(K.shellGeo, new THREE.ShaderMaterial({
      vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG, uniforms: uni(0xe8f2ff, 0x5a8cff, 0x5a3cff), ...additive,
    }));
    for (const m of [this.plume, this.shell]) {
      m.position.y = -1.2 * size;
      m.frustumCulled = false;
      m.renderOrder = 5;
      gim.add(m);
    }
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: K.glowTex, color: 0xa8d4ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false,
    }));
    this.glow.position.y = -1.22 * size;
    this.glow.renderOrder = 6;
    gim.add(this.glow);

    // Hydraulic rams from the housing to the bell's band
    this.rams = [];
    const qInv = g.quaternion.clone().invert();
    for (const anchor of opts.actuators || []) {
      const a = new THREE.Object3D();
      a.position.copy(anchor).sub(pos).applyQuaternion(qInv);
      g.add(a);
      const b = new THREE.Object3D();
      // Attach on the band, on the same side as the anchor
      const side = new V3(a.position.x, 0, a.position.z).normalize().multiplyScalar(0.56 * size);
      b.position.set(side.x, -0.5 * size, side.z);
      gim.add(b);
      const barrel = new THREE.Mesh(K.pistonGeo, K.collarMat);
      const rod = new THREE.Mesh(K.pistonGeo, K.rodMat);
      barrel.castShadow = rod.castShadow = true;
      g.add(barrel, rod);
      this.rams.push({ a, b, barrel, rod, r: 0.045 * Math.max(1, size * 1.6) });
    }
    this.set(0, 0, 0);
  }

  set(level, time, dt = 0) {
    this.level = level;
    const k = 1 - Math.exp(-(dt || 0.016) * 6);
    this.gimbal.rotation.x += (this.gimbalTarget - this.gimbal.rotation.x) * k;
    for (const f of this.flaps) f.pivot.rotation.x += (f.open * Math.min(1, level * 3) - f.pivot.rotation.x) * Math.min(1, k * 2);
    this.innerMat.opacity = 0.05 + 0.95 * Math.min(1, level * 1.4);
    const on = level > 0.01;
    this.plume.visible = this.shell.visible = this.glow.visible = on;
    if (!on) return;
    const s = this.size;
    const flick = 0.9 + Math.random() * 0.2;
    const len = s * (1.2 + 9 * level) * flick;
    this.plume.scale.set(1, len, 1);
    this.plume.material.uniforms.uWidth.value = s * (1.0 + 0.3 * level);
    this.shell.scale.set(s * (0.9 + 0.25 * level), len * 0.5, s * (0.9 + 0.25 * level));
    for (const m of [this.plume, this.shell]) {
      m.material.uniforms.uTime.value = time;
      m.material.uniforms.uPower.value = (0.25 + 0.6 * Math.min(1, level)) * (m === this.shell ? 0.6 : 1);
    }
    this.glow.scale.setScalar(s * (1.6 + 2.4 * level) * flick);
    this.glow.material.opacity = Math.min(0.85, level * 1.2);
  }

  updateRams() {
    if (!this.rams.length) return;
    for (const R of this.rams) {
      _a.copy(R.a.position);
      R.b.getWorldPosition(_b);
      this.group.worldToLocal(_b);
      const len = _a.distanceTo(_b);
      const dir = _b.clone().sub(_a).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(_up, dir);
      const bl = len * 0.58;
      R.barrel.position.copy(_a).addScaledVector(dir, bl / 2);
      R.barrel.quaternion.copy(q);
      R.barrel.scale.set(R.r, bl, R.r);
      R.rod.position.copy(_a).addScaledVector(dir, len / 2);
      R.rod.quaternion.copy(q);
      R.rod.scale.set(R.r * 0.5, len, R.r * 0.5);
    }
  }

  worldExhaust(pos, dir) {
    this.glow.getWorldPosition(pos);
    dir.set(0, -1, 0).applyQuaternion(this.gimbal.getWorldQuaternion(new THREE.Quaternion()));
  }
}

// ---------------------------------------------------------------------------
// Hydraulic piston between two parts that move relative to each other
// ---------------------------------------------------------------------------

let pistonGeo, pistonMats;
class Piston {
  constructor(parentA, posA, parentB, posB, r, mats) {
    if (!pistonGeo) {
      pistonGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
      pistonMats = {
        barrel: mats.joint,
        rod: new THREE.MeshStandardMaterial({ color: 0xd2d5da, roughness: 0.15, metalness: 1.0 }),
      };
    }
    this.parent = parentA;
    this.a = posA.clone();
    this.b = new THREE.Object3D();
    this.b.position.copy(posB);
    parentB.add(this.b);
    this.barrel = new THREE.Mesh(pistonGeo, pistonMats.barrel);
    this.rod = new THREE.Mesh(pistonGeo, pistonMats.rod);
    this.barrel.castShadow = this.rod.castShadow = true;
    this.barrel.userData.noOutline = this.rod.userData.noOutline = true;
    parentA.add(this.barrel, this.rod);
    this.r = r;
  }

  update() {
    this.b.getWorldPosition(_b);
    this.parent.worldToLocal(_b);
    const len = this.a.distanceTo(_b);
    const dir = _b.sub(this.a).normalize();
    const q = this.barrel.quaternion.setFromUnitVectors(_up, dir);
    this.rod.quaternion.copy(q);
    const bl = len * 0.55;
    this.barrel.position.copy(this.a).addScaledVector(dir, bl / 2);
    this.barrel.scale.set(this.r, bl, this.r);
    this.rod.position.copy(this.a).addScaledVector(dir, len / 2);
    this.rod.scale.set(this.r * 0.5, len, this.r * 0.5);
  }
}

// ---------------------------------------------------------------------------
// Mech model: a squat, armored-core style suit. Angular plate armor over an
// exposed frame, hydraulics at the knees and elbows, a visor-slit sensor head
// and a booster pack.
// ---------------------------------------------------------------------------

export class Mech {
  constructor(mats, glowTex) {
    this.mats = mats;
    this.glowTex = glowTex;
    this.thrusters = { main: [], vern: [], calf: [], sole: [] };
    this.pistons = [];
    this.mounts = {};
    this.w = { gait: 0, air: 0, dash: 0, crouch: 0, aim: [0, 0], shield: 0, reload: [0, 0], recoil: [0, 0], legYaw: 0, twist: 0 };
    this.prevCos = 1;

    const root = (this.root = new THREE.Group());
    const body = (this.body = new THREE.Group());
    root.add(body);
    this.pelvis = new THREE.Group();
    body.add(this.pelvis);
    this.buildPelvis();
    this.legs = [-1, 1].map((s) => this.buildLeg(s));
    this.buildTorso();
    this.buildHead();
    this.arms = [-1, 1].map((s) => this.buildArm(s)); // [right, left]
    this.buildBackpack();

    this.mounts.rightHand = this.arms[0].mount;
    this.mounts.leftHand = this.arms[1].mount;
    this.mounts.leftShield = this.arms[1].shieldMount;
    this.mounts.legR = this.legs[0].mount;
    this.mounts.legL = this.legs[1].mount;
    this.outlines = addOutline(this.root);
  }

  // ---- construction --------------------------------------------------------

  /** Bolt a cut-out armor piece from the sheet onto a part. */
  plate(parent, name, width, x, y, z, rx = 0, ry = 0, rz = 0, mat = this.mats.armor) {
    const m = new THREE.Mesh(pieceGeo(name, width), mat);
    m.castShadow = m.receiveShadow = true;
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    parent.add(m);
    return m;
  }

  buildPelvis() {
    const M = this.mats, p = this.pelvis;
    // Dark mechanical hip block with armor plates bolted on
    place(p, P(loft([
      { y: 0.3, w: 1.16, d: 0.96, c: 0.18 },
      { y: 0.02, w: 1.2, d: 1.0, c: 0.2 },
      { y: -0.34, w: 0.7, d: 0.72, c: 0.16 },
    ]), M.frame, { all: B.mechA }));
    place(p, P(frontPrism([[-0.44, 0.22], [0.44, 0.22], [0.38, -0.16], [0.16, -0.42], [-0.16, -0.42], [-0.38, -0.16]], 0.16, 0.04),
      M.armor, { pz: B.plainB, all: B.plainA }), 0, 0, 0.5);
    place(p, P(chamferBox(0.52, 0.08, 0.06, 0.02), M.frame, { all: B.hazard }), 0, 0.08, 0.6);
    place(p, P(frontPrism([[-0.5, 0.2], [0.5, 0.2], [0.4, -0.3], [-0.4, -0.3]], 0.14, 0.04), M.armor, { all: B.plainA }), 0, 0, -0.5);
    place(p, P(cylX(0.24, 1.5), M.joint), 0, -0.18, 0);
    // Hip armor blocks
    this.hipPads = [-1, 1].map((s) => {
      const g = new THREE.Group();
      g.position.set(s * 0.8, 0.1, 0);
      g.rotation.z = s * 0.1;
      p.add(g);
      place(g, P(sidePrism([[-0.5, 0.16], [0.46, 0.16], [0.56, -0.1], [0.36, -0.6], [-0.44, -0.56]], 0.22, 0.04),
        M.second, { x: B.e07, all: B.plainA }));
      place(g, P(chamferBox(0.24, 0.06, 0.8, 0.02), M.accent, { all: B.redBar }), 0, 0.17, 0);
      this.plate(g, 'noStep', 0.6, s * 0.135, -0.2, 0, 0, s * Math.PI / 2, -s * 0.05);
      return g;
    });
  }

  buildLeg(s) {
    const M = this.mats;
    const hip = new THREE.Group();
    hip.position.set(s * 0.56, -LEG.hipDrop, 0);
    this.pelvis.add(hip);
    place(hip, P(new THREE.SphereGeometry(0.3, 16, 10), M.joint));
    // Exposed twin-strut thigh frame with an armor shell over the front and outside
    for (const x of [-0.13, 0.13]) place(hip, P(new THREE.CylinderGeometry(0.11, 0.11, 0.95, 10), M.joint), x, -0.55, -0.04);
    place(hip, P(loft([
      { y: -0.12, w: 0.64, d: 0.7, c: 0.15 },
      { y: -0.6, w: 0.7, d: 0.78, c: 0.17 },
      { y: -0.92, w: 0.6, d: 0.64, c: 0.14 },
    ]), M.armor, { z: B.plainB, x: B.plainB, y: B.plainA }), s * 0.04, 0, 0.06);
    this.plate(hip, 'handlePanel', 0.42, s * 0.04, -0.52, 0.47, -0.04);

    const knee = new THREE.Group();
    knee.position.y = -LEG.thigh;
    hip.add(knee);
    place(knee, P(cylX(0.3, 0.72), M.joint));
    // Big angular knee pad
    place(knee, P(sidePrism([[0.12, 0.46], [0.56, 0.22], [0.64, -0.26], [0.46, -0.56], [0.12, -0.36]], 0.74, 0.05),
      M.second, { pz: B.arrowPanel, all: B.plainA }));
    this.plate(knee, 'hazardPad', 0.4, 0, 0.0, 0.64, -0.12);
    // Chunky shin
    const SH = LEG.shin;
    place(knee, P(loft([
      { y: -0.05, w: 0.86, d: 0.86, c: 0.18, z: -0.04 },
      { y: -0.5, w: 1.0, d: 1.1, c: 0.24, z: -0.08 },
      { y: -1.08, w: 1.04, d: 1.12, c: 0.24, z: -0.06 },
      { y: -SH, w: 0.9, d: 0.92, c: 0.2 },
    ]), M.armor, { pz: B.plainB, nz: B.plainA, x: B.sideVents, y: B.plainA }));
    // Shin blade with a stencil
    this.plate(knee, 'shinPlate', 0.54, 0, -0.78, 0.55, -0.06);
    place(knee, P(chamferBox(1.06, 0.1, 0.8, 0.03), M.accent, { all: B.redBar }), 0, -SH + 0.3, 0.06);
    // Knee hydraulics: thigh frame to calf
    this.pistons.push(new Piston(hip, new V3(0, -0.45, -0.38), knee, new V3(0, -0.42, -0.5), 0.075, M));

    // Calf vernier bay behind armored covers
    const bayY = -0.78;
    place(knee, P(chamferBox(0.62, 0.66, 0.14, 0.06), M.frame, { all: B.ventDark }), 0, bayY, -0.6);
    const calfThr = [];
    for (const x of [-0.15, 0.15]) {
      const t = new Thruster(knee, new V3(x, bayY + 0.05, -0.64), new V3(0, -0.85, -0.6), 0.15, this.glowTex);
      calfThr.push(t);
      this.thrusters.calf.push(t);
    }
    for (const [hy, open] of [[bayY + 0.36, 1.1], [bayY + 0.02, 1.5]]) {
      const pivot = new THREE.Group();
      pivot.position.set(0, hy, -0.74);
      knee.add(pivot);
      place(pivot, P(chamferBox(0.68, 0.36, 0.07, 0.05), M.armor, { all: B.plainA, nz: B.hot }), 0, -0.18, 0);
      for (const t of calfThr) t.flaps.push({ pivot, open });
    }

    const mount = new THREE.Group();
    mount.position.set(s * 0.56, -0.72, 0.0);
    mount.rotation.z = -s * Math.PI / 2;
    knee.add(mount);

    const ankle = new THREE.Group();
    ankle.position.y = -SH;
    knee.add(ankle);
    place(ankle, P(new THREE.SphereGeometry(0.26, 14, 10), M.joint));
    // Wide, flat foot with split toes
    place(ankle, P(sidePrism([[-0.48, -0.05], [0.22, -0.05], [0.62, -0.22], [0.7, -0.5], [-0.26, -0.5],
      [-0.3, -0.33], [-0.6, -0.28]], 0.98, 0.05),
    M.second, { py: B.footPanel, x: B.footPanel, ny: B.greyPlate, z: B.plainB }));
    for (const x of [-0.25, 0.25]) {
      place(ankle, P(loft([{ y: -0.2, w: 0.42, d: 0.36, c: 0.08 }, { y: -0.5, w: 0.46, d: 0.48, c: 0.1 }]), M.armor,
        { all: B.plainA }), x, 0, 0.86);
    }
    place(ankle, P(chamferBox(1.02, 0.06, 1.56, 0.04), M.joint), 0, -0.5, 0.24);
    for (const sd of [-1, 1]) this.plate(ankle, 'redBar', 0.9, sd * 0.5, -0.4, 0.1, 0, sd * Math.PI / 2);
    place(ankle, P(loft([{ y: -0.28, w: 0.36, d: 0.3, c: 0.07, z: -0.62 }, { y: -0.5, w: 0.4, d: 0.42, c: 0.09, z: -0.7 }]), M.second, { all: B.plainA }));
    place(ankle, P(sidePrism([[0.1, 0.32], [0.42, 0.1], [0.46, -0.2], [0.1, -0.12]], 0.62, 0.04), M.armor, { all: B.plainA }));
    this.thrusters.sole.push(new Thruster(ankle, new V3(0, -0.32, -0.46), new V3(0, -1, -0.35), 0.2, this.glowTex));

    return { s, hip, knee, ankle, mount };
  }

  buildTorso() {
    const M = this.mats;
    const waist = (this.waist = new THREE.Group());
    waist.position.y = 0.3;
    waist.rotation.order = 'YXZ';
    this.body.add(waist);
    place(waist, P(new THREE.CylinderGeometry(0.42, 0.48, 0.6, 14), M.joint), 0, 0.15, 0);
    for (const s of [-1, 1]) place(waist, P(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 8), M.frame), s * 0.3, 0.2, 0.36);
    place(waist, P(loft([{ y: 0.38, w: 0.72, d: 0.3, c: 0.08 }, { y: 0.02, w: 0.56, d: 0.26, c: 0.06 }]), M.second, { all: B.plainA }), 0, 0, 0.36);
    this.plate(waist, 'a01', 0.44, 0, 0.21, 0.53, -0.08);

    const chest = (this.chest = new THREE.Group());
    chest.position.y = 0.42;
    waist.add(chest);
    // Core block: deep, chunky, leaning forward at the chest
    place(chest, P(loft([
      { y: 1.28, w: 1.5, d: 1.06, c: 0.26, z: -0.04 },
      { y: 1.02, w: 2.0, d: 1.36, c: 0.3, z: 0.02 },
      { y: 0.42, w: 1.96, d: 1.42, c: 0.3, z: 0.08 },
      { y: 0.0, w: 1.36, d: 1.04, c: 0.22 },
    ]), M.armor, { all: B.plainA, x: B.sideVents }));
    // Framed cockpit hatch with the unit number
    // Cockpit: armored hatch under a tinted canopy, Destroid style, with twin chest guns
    place(chest, P(chamferBox(0.8, 0.76, 0.12, 0.12), M.frame, { all: B.mechA }), 0, 0.6, 0.78, -0.06);
    this.plate(chest, 'e07', 0.64, 0, 0.6, 0.85, -0.06);
    place(chest, P(frontPrism([[-0.5, 0], [0.5, 0], [0.42, 0.2], [-0.42, 0.2]], 0.1, 0.02), M.frame, { all: B.mechA }), 0, 1.0, 0.68, -0.45);
    const glass = new THREE.MeshStandardMaterial({ color: 0x0d1318, roughness: 0.05, metalness: 0.9, emissive: 0x0a2230, emissiveIntensity: 0.4 });
    const canopy = place(chest, new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.11, 0.04), glass), 0, 1.09, 0.72, -0.45);
    canopy.userData.noOutline = true;
    for (const s of [-1, 1]) {
      place(chest, P(chamferBox(0.16, 0.16, 0.24, 0.04), M.frame, { all: B.mechA }), s * 0.62, 1.0, 0.68);
      for (const dx of [-0.04, 0.04]) place(chest, P(cylZ(0.03, 0.03, 0.3, 8), M.joint), s * 0.62 + dx, 1.0, 0.86);
    }
    for (const s of [-1, 1]) {
      // Side intakes angled across the chest corners
      const intake = place(chest, P(frontPrism(mirror([[-0.18, -0.26], [0.2, -0.26], [0.24, 0.26], [-0.14, 0.3]], s), 0.2, 0.04),
        M.frame, { pz: B.ventDark, all: B.plainA }), s * 0.8, 0.56, 0.58);
      intake.rotation.y = s * 0.4;
      // Colored side panels with a cut-out vent plate, and heat-sink fins behind
      place(chest, P(sidePrism([[-0.5, 0.12], [0.55, 0.12], [0.6, 0.9], [-0.45, 1.0]], 0.1, 0.03), M.second, { x: B.plainA, all: B.plainA }), s * 1.0, 0, 0.04);
      this.plate(chest, 'ventPanel', 0.56, s * 1.07, 0.6, 0.18, 0, s * Math.PI / 2);
      for (let f = 0; f < 5; f++) place(chest, P(chamferBox(0.16, 0.46, 0.035, 0.02), M.joint), s * 1.02, 0.5, -0.2 - f * 0.08);
      // Collar guards flanking the head
      place(chest, P(loft([{ y: 0, w: 0.42, d: 0.9, c: 0.12 }, { y: 0.22, w: 0.3, d: 0.68, c: 0.1, z: -0.04 }]), M.second, { all: B.plainA }), s * 0.66, 1.2, -0.08);
      place(chest, P(chamferBox(0.32, 0.05, 0.6, 0.02), M.accent, { all: B.redBar }), s * 0.66, 1.43, -0.1);
    }
    place(chest, P(chamferBox(0.9, 0.07, 0.08, 0.03), M.frame, { all: B.hazard }), 0, 0.14, 0.76);

    for (const [key, s] of [['shoulderR', -1], ['shoulderL', 1]]) {
      const m = new THREE.Group();
      m.position.set(s * 1.3, 1.2, -0.7);
      m.rotation.x = -0.1;
      chest.add(m);
      this.mounts[key] = m;
    }
  }

  buildHead() {
    const M = this.mats;
    const head = (this.head = new THREE.Group());
    head.position.set(0, 1.34, 0.1);
    head.scale.setScalar(1.22);
    head.rotation.order = 'YXZ';
    this.chest.add(head);
    place(head, P(new THREE.CylinderGeometry(0.17, 0.22, 0.36, 10), M.joint), 0, -0.04, 0);
    // Low, wide wedge helmet
    place(head, P(loft([
      { y: 0.06, w: 0.74, d: 0.76, c: 0.16 },
      { y: 0.3, w: 0.88, d: 0.86, c: 0.2, z: 0.04 },
      { y: 0.52, w: 0.62, d: 0.68, c: 0.16, z: -0.03 },
    ]), M.armor, { all: B.plainA }));
    // Visor band with a single glowing slit
    place(head, P(frontPrism([[-0.42, 0], [0.42, 0], [0.4, 0.17], [-0.4, 0.17]], 0.08, 0.01), M.joint), 0, 0.24, 0.44);
    place(head, new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.045, 0.03), M.eye), 0, 0.33, 0.49);
    // Asymmetric lens cluster on the right cheek
    for (const [x, y, r] of [[-0.29, 0.15, 0.06], [-0.18, 0.15, 0.04], [-0.1, 0.15, 0.028]]) {
      place(head, P(cylZ(r * 1.35, r * 1.35, 0.06, 12), M.joint), x, y, 0.47);
      place(head, new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), M.lens), x, y, 0.5);
    }
    // Brow overhang with a red stripe
    const brow = place(head, P(frontPrism([[-0.47, 0], [0.47, 0], [0.38, 0.1], [-0.38, 0.1]], 0.32, 0.03), M.armor, { all: B.plainA }), 0, 0.4, 0.34);
    brow.rotation.x = -0.12;
    place(head, P(chamferBox(0.5, 0.04, 0.05, 0.01), M.red), 0, 0.47, 0.5);
    // Jaw guard with grille slits
    place(head, P(frontPrism([[-0.3, 0], [0.3, 0], [0.38, 0.15], [-0.38, 0.15]], 0.22, 0.03), M.armor, { all: B.plainA }), 0, 0.04, 0.38);
    for (const x of [0.08, 0.16, 0.24]) place(head, new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.09, 0.02), M.joint), x, 0.11, 0.5);
    // Dorsal crest
    place(head, P(sidePrism([[0.42, 0], [0.12, 0.16], [-0.42, 0.11], [-0.46, 0]], 0.06, 0.01), M.trim), 0, 0.5, 0);
    // One-sided blade antenna and a short whip on the other side
    const blade = place(head, P(frontPrism([[-0.03, 0], [0.04, 0], [0.01, 0.78]], 0.025, 0.004), M.trim), 0.38, 0.36, -0.12);
    blade.rotation.set(-0.35, 0, -0.3);
    place(head, P(new THREE.CylinderGeometry(0.015, 0.025, 0.4, 6), M.joint), -0.38, 0.55, -0.16, -0.3, 0, 0.2);
    for (const s of [-1, 1]) {
      place(head, P(cylX(0.13, 0.12, 12), M.frame, { all: B.mechA }), s * 0.47, 0.24, -0.02);
      place(head, P(cylX(0.08, 0.03, 10), M.trim), s * 0.54, 0.24, -0.02);
    }
  }

  buildArm(s) {
    const M = this.mats;
    const sh = new THREE.Group();
    sh.position.set(s * 1.22, 0.95, 0);
    sh.rotation.order = 'YXZ';
    this.chest.add(sh);
    place(sh, P(new THREE.SphereGeometry(0.33, 14, 10), M.joint));
    // Angled shoulder shield: a heavy upper plate over a colored skirt plate
    const pauldron = new THREE.Group();
    pauldron.position.set(s * 0.24, 0.12, 0);
    pauldron.rotation.z = s * 0.16;
    sh.add(pauldron);
    place(pauldron, P(sidePrism([[-0.64, -0.46], [-0.68, 0.14], [-0.46, 0.46], [0.5, 0.46], [0.68, 0.12], [0.62, -0.46]], 0.66, 0.06),
      M.armor, { x: B.panel07, y: B.plainA, z: B.plainB }), s * 0.18, 0, 0);
    place(pauldron, P(sidePrism([[-0.56, 0], [0.56, 0], [0.5, -0.36], [-0.5, -0.36]], 0.7, 0.04), M.second, { all: B.plainA }), s * 0.24, -0.42, 0);
    place(pauldron, P(chamferBox(0.44, 0.05, 0.96, 0.02), M.frame, { all: B.hazard }), s * 0.18, 0.47, 0);
    // Cut-out armor piece on the outer face: the red slash on the left, the E-07 panel on the right
    if (s > 0) this.plate(pauldron, 'slash', 0.66, s * 0.53, -0.02, 0, 0, s * Math.PI / 2);
    else this.plate(pauldron, 'e07', 0.86, s * 0.53, -0.02, 0, 0, s * Math.PI / 2);

    // Upper arm: frame with an outer armor shell
    place(sh, P(new THREE.CylinderGeometry(0.2, 0.2, 0.6, 12), M.joint), 0, -0.35, 0);
    place(sh, P(loft([{ y: -0.3, w: 0.44, d: 0.5, c: 0.1 }, { y: -0.7, w: 0.48, d: 0.54, c: 0.12 }]), M.armor, { all: B.plainB }), s * 0.06, 0, 0);

    const elbow = new THREE.Group();
    elbow.position.y = -0.84;
    sh.add(elbow);
    place(elbow, P(cylX(0.24, 0.56), M.joint));
    // Chunky forearm with an outer plate
    place(elbow, P(loft([
      { y: -0.05, w: 0.62, d: 0.66, c: 0.14 },
      { y: -0.6, w: 0.76, d: 0.8, c: 0.17 },
      { y: -0.88, w: 0.74, d: 0.78, c: 0.17 },
      { y: -0.98, w: 0.62, d: 0.66, c: 0.14 },
    ]), M.armor, { x: B.r07, z: B.plainB, y: B.plainA }));
    place(elbow, P(sidePrism([[-0.4, -0.08], [0.3, -0.08], [0.42, -0.84], [-0.4, -0.8]], 0.1, 0.03), M.second, { all: B.plainA }), s * 0.41, 0, 0);
    if (s < 0) this.plate(elbow, 'r07', 0.42, s * 0.47, -0.48, 0, 0, s * Math.PI / 2);
    else this.plate(elbow, 'redPlate', 0.27, s * 0.47, -0.5, 0, 0, s * Math.PI / 2);
    // Elbow hydraulics
    this.pistons.push(new Piston(sh, new V3(0, -0.42, 0.28), elbow, new V3(0, -0.34, 0.36), 0.06, M));

    const shieldMount = new THREE.Group();
    shieldMount.position.set(s * 0.48, -0.5, 0.04);
    {
      const Z = new V3(s, 0, 0), Y = new V3(0, 0, 1), X = new V3().crossVectors(Y, Z);
      shieldMount.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    }
    shieldMount.scale.setScalar(0.85);
    elbow.add(shieldMount);

    const hand = new THREE.Group();
    hand.position.set(0, -1.02, 0.03);
    elbow.add(hand);
    place(hand, P(chamferBox(0.42, 0.42, 0.5, 0.08), M.joint), 0, -0.18, 0);
    place(hand, P(chamferBox(0.4, 0.2, 0.5, 0.05), M.joint), 0, -0.42, 0.07, 0.35);
    place(hand, P(chamferBox(0.12, 0.28, 0.14, 0.03), M.joint), -s * 0.21, -0.25, 0.2, 0.3);
    const mount = new THREE.Group();
    mount.position.set(0, -0.28, 0.02);
    mount.rotation.x = Math.PI / 2;
    mount.scale.setScalar(0.85);
    hand.add(mount);
    return { s, sh, pauldron, elbow, hand, mount, shieldMount };
  }

  buildBackpack() {
    const M = this.mats;
    const bp = new THREE.Group();
    bp.position.set(0, 0.5, -0.68);
    this.chest.add(bp);
    this.backpack = bp;
    // Booster pack
    place(bp, P(loft([
      { y: 0.62, w: 1.5, d: 0.55, c: 0.16, z: -0.2 },
      { y: 0.1, w: 1.58, d: 0.62, c: 0.18, z: -0.24 },
      { y: -0.32, w: 1.34, d: 0.56, c: 0.16, z: -0.22 },
    ]), M.armor, { nz: B.plainA, pz: B.plainA, x: B.vent, y: B.plainA }));
    this.plate(bp, 'danger', 0.66, 0, 0.16, -0.57, 0, Math.PI);
    place(bp, P(chamferBox(1.1, 0.1, 0.08, 0.03), M.frame, { all: B.hazard }), 0, 0.54, -0.52);

    for (const s of [-1, 1]) {
      // Radiator fins raked back over the shoulders
      const fin = new THREE.Group();
      fin.position.set(s * 0.5, 0.56, -0.36);
      fin.rotation.set(-0.55, 0, -s * 0.3);
      bp.add(fin);
      place(fin, P(frontPrism([[-0.1, 0], [0.1, 0], [0.13, 0.82], [0, 0.98], [-0.1, 0.8]], 0.07, 0.015), M.second, { all: B.plainA }));
      for (const y of [0.25, 0.45, 0.65]) place(fin, P(chamferBox(0.22, 0.03, 0.09, 0.01), M.joint), 0, y, 0);

      // Main thruster housing under the pack's lower corner
      const hx = s * 0.42;
      place(bp, P(loft([
        { y: -0.2, w: 0.56, d: 0.7, c: 0.14, z: -0.36 },
        { y: -0.62, w: 0.6, d: 0.74, c: 0.16, z: -0.42 },
        { y: -0.84, w: 0.5, d: 0.6, c: 0.14, z: -0.44 },
      ]), M.armor, { x: B.hot, nz: B.plainA, pz: B.plainA, y: B.plainA }), hx, 0, 0);
      place(bp, P(chamferBox(0.62, 0.1, 0.76, 0.04), M.joint), hx, -0.36, -0.42);
      const dir = new V3(0, -1, -0.45).normalize();
      const mountPos = new V3(hx, -0.84, -0.6);
      const plate = place(bp, P(new THREE.CylinderGeometry(0.34, 0.38, 0.12, 16), M.joint), mountPos.x, mountPos.y, mountPos.z);
      plate.quaternion.setFromUnitVectors(new V3(0, -1, 0), dir);
      place(bp, P(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8), M.joint), hx + s * 0.3, -0.42, -0.62, 0.3, 0, 0);
      this.thrusters.main.push(new Thruster(bp, mountPos.clone().addScaledVector(dir, 0.02), dir, 0.44, this.glowTex, {
        actuators: [new V3(hx + 0.3, -0.7, -0.5), new V3(hx - 0.3, -0.7, -0.5), new V3(hx, -0.72, -0.82)],
      }));

      // Vernier pods on the pack's outer corners
      const vx = s * 0.8;
      place(bp, P(loft([{ y: 0.42, w: 0.26, d: 0.42, c: 0.07, z: -0.3 }, { y: 0.04, w: 0.3, d: 0.48, c: 0.08, z: -0.34 }]), M.second,
        { all: B.plainA, x: B.ventB }), vx, 0, 0);
      this.thrusters.vern.push(new Thruster(bp, new V3(vx, 0.22, -0.6), new V3(s * 0.25, 0.05, -1), 0.17, this.glowTex));
    }

    this.thrustLight = new THREE.PointLight(0x8fb8ff, 0, 22, 1.8);
    this.thrustLight.position.set(0, -1.6, -0.9);
    bp.add(this.thrustLight);
  }

  allThrusters() {
    const t = this.thrusters;
    return [...t.main, ...t.vern, ...t.calf, ...t.sole];
  }

  // ---- weapons -------------------------------------------------------------

  attach(slot, obj) {
    const m = this.mounts[slot];
    if (!m) return;
    for (const c of [...m.children]) m.remove(c);
    if (obj) m.add(obj);
  }

  // ---- animation -----------------------------------------------------------

  /**
   * st: {
   *   phase, gait (0..1), air (0/1), dash (0/1), crouch (0..1), legYaw,
   *   aimYaw (torso twist relative to root), aimPitch,
   *   aim: [right, left] 0..1, recoil: [r, l], reload: [r, l], shield (0/1),
   *   thrust: { main, vern, calf, sole }, time
   * }
   * Returns body height above feet so the caller can place the mech.
   */
  animate(dt, st) {
    const w = this.w;
    w.gait = damp(w.gait, st.gait, 8, dt);
    w.air = damp(w.air, st.air, 7, dt);
    w.dash = damp(w.dash, st.dash, 6, dt);
    w.crouch = damp(w.crouch, st.crouch, 16, dt);
    w.legYaw = damp(w.legYaw, st.legYaw, 7, dt);
    w.twist = damp(w.twist, st.aimYaw, 14, dt);
    w.shield = damp(w.shield, st.shield ? 1 : 0, 9, dt);
    for (let i = 0; i < 2; i++) {
      w.aim[i] = damp(w.aim[i], st.aim[i], st.aim[i] > w.aim[i] ? 11 : 4, dt);
      w.reload[i] = damp(w.reload[i], st.reload[i] ? 1 : 0, 8, dt);
      w.recoil[i] = st.recoil[i];
    }
    const g = w.gait, ph = st.phase, t = st.time;

    // How much of the standing idle stance shows through
    const idle = (1 - g) * (1 - w.air) * (1 - w.dash) * (1 - w.crouch);
    w.idle = idle;

    // --- legs ---
    // Always slightly crouched: heavy suits carry their weight on bent knees.
    const pose = [];
    for (let i = 0; i < 2; i++) {
      const p = ph + (i === 1 ? 0 : Math.PI);
      let hip = -0.14 - Math.sin(p) * 0.55 * g;
      let knee = 0.38 + Math.max(0, Math.cos(p)) * 0.95 * g;
      const airHip = i === 1 ? -0.65 : 0.05, airKnee = i === 1 ? 1.1 : 0.5;
      hip += (airHip - hip) * w.air;
      knee += (airKnee - knee) * w.air;
      const dHip = i === 1 ? 0.05 : 0.28, dKnee = i === 1 ? 0.7 : 0.9;
      hip += (dHip - hip) * w.dash;
      knee += (dKnee - knee) * w.dash;
      hip -= 0.6 * w.crouch;
      knee += 1.15 * w.crouch;
      pose.push({ hip, knee });
    }
    // Idle: staggered stance, left foot forward. Solve the back knee so both feet stay planted.
    {
      const fH = -0.4, fK = 0.72, bH = 0.04;
      const h = LEG.thigh * Math.cos(fH) + LEG.shin * Math.cos(fH + fK);
      const bK = Math.acos(clamp((h - LEG.thigh * Math.cos(bH)) / LEG.shin, -1, 1)) - bH;
      pose[1].hip += (fH - pose[1].hip) * idle; pose[1].knee += (fK - pose[1].knee) * idle;
      pose[0].hip += (bH - pose[0].hip) * idle; pose[0].knee += (bK - pose[0].knee) * idle;
    }
    for (const q of pose) {
      q.ankle = -(q.hip + q.knee);
      q.ankle += (0.35 - q.ankle) * w.air * 0.6 + w.dash * 0.25;
    }
    this.pelvis.rotation.y = w.legYaw - 0.2 * idle;
    let height = 0;
    for (let i = 0; i < 2; i++) {
      const L = this.legs[i], q = pose[i];
      const splay = 0.07 + 0.07 * idle + 0.05 * w.air;
      L.hip.rotation.x = q.hip;
      L.hip.rotation.z = L.s * splay;
      L.knee.rotation.x = q.knee;
      L.ankle.rotation.x = q.ankle;
      L.ankle.rotation.z = -L.s * splay;
      const h = LEG.foot + (LEG.thigh * Math.cos(q.hip) + LEG.shin * Math.cos(q.hip + q.knee)) * Math.cos(splay) + LEG.hipDrop;
      height = Math.max(height, h);
      this.hipPads[i].rotation.x = Math.min(0, q.hip) * 0.45;
    }

    const breath = Math.sin(t * 1.5);
    const bob = -Math.abs(Math.cos(ph)) * 0.09 * g * (1 - w.air) * (1 - w.dash) + breath * 0.015 * idle;
    this.body.position.y = height + bob;
    this.body.rotation.z = Math.sin(ph) * 0.03 * g * (1 - w.air) + 0.03 * idle;
    this.pelvis.rotation.z = -Math.sin(ph) * 0.035 * g;

    // --- torso ---
    this.waist.rotation.y = clamp(w.twist, -1.1, 1.1) + Math.sin(ph) * 0.08 * g + 0.14 * idle;
    this.waist.rotation.x = 0.1 + w.dash * 0.32 + w.crouch * 0.25 - st.aimPitch * 0.12 + breath * 0.012 + g * 0.06 + 0.06 * idle;
    this.waist.rotation.z = -0.03 * idle;
    // Idle head: chin down, and an occasional sensor sweep
    const sweep = Math.pow(Math.sin(t * 0.42), 5) * 0.5 * idle * (1 - w.aim[0]);
    this.head.rotation.y = clamp((st.aimYaw - w.twist) * 0.8, -0.6, 0.6) - 0.12 * idle + sweep;
    this.head.rotation.x = clamp(-st.aimPitch * 0.65, -0.5, 0.45) - (w.dash * 0.25) - this.waist.rotation.x * 0.5 + 0.12 * idle;
    this.head.rotation.z = 0.05 * idle;

    // --- arms ---
    for (let i = 0; i < 2; i++) {
      const A = this.arms[i], s = A.s;
      const swing = -Math.sin(ph + (i === 0 ? 0 : Math.PI)) * 0.32 * g * (1 - w.dash);
      const isShield = i === 1 && st.hasShield;
      let shx = 0.12 + swing, shy = 0, shz = s * 0.14, elx = isShield ? -1.25 : -0.9;
      // Idle: rifle at low ready angled across the body; shield arm up in a guard
      if (isShield) {
        shx += (-0.3 - shx) * idle; shy += (-s * 0.1 - shy) * idle; elx += (-1.15 - elx) * idle;
      } else {
        shx += (-0.4 - shx) * idle; shy += (-s * 0.34 - shy) * idle; elx += (-0.95 - elx) * idle;
      }
      shx += breath * 0.02 * idle;
      shx += (0.35 - shx) * w.dash * 0.8;
      shz += s * 0.25 * w.air;
      const a = w.aim[i];
      const aimX = -Math.PI / 2 - st.aimPitch - this.waist.rotation.x + 0.06;
      shx += (aimX - shx) * a;
      shy += (-s * 0.14 - shy) * a;
      shz += (s * 0.05 - shz) * a;
      elx += (-0.12 - elx) * a;
      if (isShield) {
        const b = w.shield;
        shx += (-1.05 - shx) * b;
        shy += (-s * 0.75 - shy) * b;
        elx += (-1.45 - elx) * b;
      }
      const r = w.reload[i];
      shx += (0.15 - shx) * r;
      elx += (-1.7 - elx) * r;
      shx -= w.recoil[i] * 0.22;
      elx -= w.recoil[i] * 0.4;
      A.sh.rotation.set(shx, shy, shz);
      A.elbow.rotation.x = elx;
      A.hand.rotation.x = -0.05 + w.recoil[i] * 0.15;
      A.pauldron.rotation.x = -shx * 0.5;
    }

    // --- thrusters ---
    // Main nozzles gimbal to push the way the suit is going: back for a dash, down for a climb.
    const T = this.thrusters, th = st.thrust;
    const mainGimbal = 0.5 * w.dash - 0.22 * w.air * (1 - w.dash);
    for (const x of T.main) { x.gimbalTarget = mainGimbal; x.set(th.main, t, dt); }
    for (const x of T.vern) x.set(th.vern, t, dt);
    for (const x of T.calf) x.set(th.calf, t, dt);
    for (const x of T.sole) x.set(th.sole, t, dt);
    this.thrustLight.intensity = (th.main + th.sole * 0.4) * 45 * (0.85 + Math.random() * 0.3);

    // Hydraulics follow the joints
    this.root.updateMatrixWorld(true);
    for (const x of T.main) x.updateRams();
    for (const pst of this.pistons) pst.update();

    // --- footstep events ---
    const c = Math.cos(ph);
    let step = -1;
    if (g > 0.25 && w.air < 0.3 && w.dash < 0.3) {
      if (this.prevCos > 0 && c <= 0) step = 1;
      else if (this.prevCos < 0 && c >= 0) step = 0;
    }
    this.prevCos = c;
    return { height, step };
  }

  footWorld(i, out) {
    return this.legs[i].ankle.getWorldPosition(out);
  }
}
