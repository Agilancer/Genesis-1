import * as THREE from './three.js';
import { B, BODY_SHEET, frontPrism, sidePrism, chamferBox, cylZ, cylX, loft, mesh, place, canvasTexture } from './atlas.js';

const V3 = THREE.Vector3;
const P = (geo, mat, faces, opts) => mesh(geo, mat, BODY_SHEET, faces, opts);
const mirror = (pts, s) => pts.map(([x, y]) => [x * s, y]);
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Leg segment lengths (pelvis → hip joint, thigh, shin, ankle → sole).
// Short thighs, tall shins and big feet, after Gundam proportions.
export const LEG = { hipDrop: 0.2, thigh: 1.65, shin: 2.0, foot: 0.55 };

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
    this.updateRams();
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
    this.group.updateMatrixWorld(true);
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
// Mech model
// ---------------------------------------------------------------------------

export class Mech {
  constructor(mats, glowTex) {
    this.mats = mats;
    this.glowTex = glowTex;
    this.thrusters = { main: [], vern: [], calf: [], sole: [] };
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
  }

  // ---- construction --------------------------------------------------------

  buildPelvis() {
    const M = this.mats, p = this.pelvis;
    // Waist block, white, narrowing to the crotch
    place(p, P(loft([
      { y: 0.3, w: 1.08, d: 0.92, c: 0.2 },
      { y: 0.0, w: 1.12, d: 0.96, c: 0.22 },
      { y: -0.32, w: 0.62, d: 0.66, c: 0.16 },
    ]), M.armor, { all: B.plainB, z: B.plainA }));
    // Red crotch plate with a yellow tip: the RX-78 "V"
    place(p, P(frontPrism([[-0.3, 0.2], [0.3, 0.2], [0.24, -0.2], [0.1, -0.44], [-0.1, -0.44], [-0.24, -0.2]], 0.2, 0.04),
      M.accent, { all: B.redSmall }), 0, -0.02, 0.42);
    place(p, P(frontPrism([[-0.12, 0], [0.12, 0], [0, -0.2]], 0.16, 0.02), M.trim), 0, -0.24, 0.5);
    place(p, P(chamferBox(0.5, 0.09, 0.1, 0.03), M.trim), 0, 0.16, 0.53);
    place(p, P(cylX(0.26, 1.4), M.joint), 0, -0.2, 0);

    // Front skirt plates swing with the thighs
    this.skirtF = [-1, 1].map((s) => {
      const g = new THREE.Group();
      g.position.set(s * 0.4, 0.2, 0.5);
      g.rotation.z = s * 0.06;
      p.add(g);
      place(g, P(frontPrism(mirror([[-0.32, 0], [0.3, 0], [0.33, -0.98], [-0.18, -0.86]], -s), 0.13, 0.035),
        M.armor, { pz: B.noStep, nz: B.plainA, all: B.plainB }), 0, 0, 0.02);
      place(g, P(chamferBox(0.2, 0.32, 0.05, 0.03), M.trim), s * 0.02, -0.62, 0.1);
      return g;
    });
    // Side skirts
    this.skirtS = [-1, 1].map((s) => {
      const g = new THREE.Group();
      g.position.set(s * 0.68, 0.22, -0.02);
      g.rotation.z = s * 0.14;
      p.add(g);
      place(g, P(sidePrism([[-0.48, 0], [0.46, 0], [0.38, -0.92], [-0.4, -0.86]], 0.14, 0.035),
        M.armor, { x: B.e07, all: B.plainB }), s * 0.07, 0, 0);
      return g;
    });
    // Rear skirt with a weapon hardpoint
    const r = new THREE.Group();
    r.position.set(0, 0.18, -0.48);
    p.add(r);
    place(r, P(frontPrism([[-0.56, 0], [0.56, 0], [0.48, -0.8], [-0.48, -0.8]], 0.14, 0.035),
      M.armor, { nz: B.plainA, all: B.plainB }));
    place(r, P(chamferBox(0.3, 0.2, 0.12, 0.04), M.frame, { all: B.mechA }), 0, -0.35, -0.1);
    this.skirtR = r;
  }

  buildLeg(s) {
    const M = this.mats;
    const hip = new THREE.Group();
    hip.position.set(s * 0.54, -LEG.hipDrop, 0);
    this.pelvis.add(hip);
    place(hip, P(new THREE.SphereGeometry(0.3, 16, 10), M.joint));
    place(hip, P(new THREE.CylinderGeometry(0.22, 0.24, 1.5, 12), M.joint), 0, -0.8, 0);
    // Thigh: short, slightly flared at the knee
    place(hip, P(loft([
      { y: -0.2, w: 0.58, d: 0.66, c: 0.14 },
      { y: -0.95, w: 0.66, d: 0.74, c: 0.16 },
      { y: -1.42, w: 0.6, d: 0.66, c: 0.15 },
    ]), M.armor, { z: B.plainB, x: B.plainB, y: B.plainA }), 0, 0, 0.02);
    place(hip, P(chamferBox(0.68, 0.1, 0.76, 0.04), M.joint), 0, -1.2, 0.02);

    const knee = new THREE.Group();
    knee.position.y = -LEG.thigh;
    hip.add(knee);
    place(knee, P(cylX(0.28, 0.66), M.joint));
    // Knee guard
    place(knee, P(sidePrism([[0.18, 0.44], [0.5, 0.22], [0.58, -0.3], [0.44, -0.62], [0.16, -0.42]], 0.64, 0.05),
      M.armor, { pz: B.arrowPanel, all: B.plainA }));
    place(knee, P(chamferBox(0.3, 0.16, 0.08, 0.04), M.joint), 0, 0.02, 0.58);

    // Shin: tall, flaring toward the ankle with a deep calf for the vernier bay
    const SH = LEG.shin;
    place(knee, P(loft([
      { y: -0.05, w: 0.7, d: 0.74, c: 0.16, z: -0.02 },
      { y: -0.65, w: 0.8, d: 0.96, c: 0.2, z: -0.08 },
      { y: -1.45, w: 0.9, d: 1.06, c: 0.22, z: -0.1 },
      { y: -SH + 0.12, w: 0.92, d: 1.0, c: 0.22, z: -0.04 },
      { y: -SH, w: 0.82, d: 0.86, c: 0.2, z: 0 },
    ]), M.armor, { pz: B.plainB, nz: B.plainA, x: B.sideVents, y: B.plainA }));
    // Shin front plate with the service-access stencil
    place(knee, P(frontPrism([[-0.3, 0], [0.3, 0], [0.37, -1.05], [0.32, -1.45], [-0.32, -1.45], [-0.37, -1.05]], 0.12, 0.035),
      M.armor, { pz: B.e07, all: B.plainA }), 0, -0.3, 0.46, -0.04);
    place(knee, P(chamferBox(0.94, 0.12, 0.7, 0.04), M.accent, { all: B.redBar }), 0, -SH + 0.42, 0.2);

    // Calf vernier bay: recessed frame, two small nozzles, armored covers that open
    const bayY = -1.2;
    place(knee, P(chamferBox(0.62, 0.84, 0.14, 0.06), M.frame, { all: B.ventDark }), 0, bayY, -0.6);
    const calfThr = [];
    for (const x of [-0.15, 0.15]) {
      const t = new Thruster(knee, new V3(x, bayY + 0.05, -0.64), new V3(0, -0.85, -0.6), 0.15, this.glowTex);
      calfThr.push(t);
      this.thrusters.calf.push(t);
    }
    // Two-piece armored cover; it swings open when the verniers fire
    for (const [hy, open] of [[bayY + 0.44, 1.1], [bayY + 0.02, 1.5]]) {
      const pivot = new THREE.Group();
      pivot.position.set(0, hy, -0.74);
      knee.add(pivot);
      place(pivot, P(chamferBox(0.68, 0.44, 0.07, 0.05), M.armor, { all: B.plainA, nz: B.hot }), 0, -0.22, 0);
      for (const t of calfThr) t.flaps.push({ pivot, open });
    }

    const mount = new THREE.Group();
    mount.position.set(s * 0.48, -1.0, 0.0);
    mount.rotation.z = -s * Math.PI / 2;
    knee.add(mount);

    const ankle = new THREE.Group();
    ankle.position.y = -SH;
    knee.add(ankle);
    place(ankle, P(new THREE.SphereGeometry(0.24, 14, 10), M.joint));
    // Big wedge foot with a notched heel for the heel vernier
    place(ankle, P(sidePrism([[-0.46, -0.06], [0.32, -0.06], [0.98, -0.32], [1.1, -0.5], [1.1, -0.55], [-0.24, -0.55],
      [-0.28, -0.36], [-0.56, -0.3]], 0.8, 0.05),
    M.armor, { py: B.footPanel, pz: B.plainB, x: B.footPanel, ny: B.greyPlate }));
    place(ankle, P(chamferBox(0.84, 0.08, 1.36, 0.04), M.joint), 0, -0.53, 0.42);
    // Red toe cap and ankle guard
    place(ankle, P(loft([{ y: -0.2, w: 0.7, d: 0.3, c: 0.08 }, { y: -0.46, w: 0.82, d: 0.42, c: 0.1 }]), M.accent, { all: B.redSmall }), 0, 0, 0.86);
    place(ankle, P(sidePrism([[0.12, 0.3], [0.42, 0.1], [0.46, -0.18], [0.12, -0.12]], 0.56, 0.04), M.accent, { all: B.redSmall }));
    this.thrusters.sole.push(new Thruster(ankle, new V3(0, -0.36, -0.44), new V3(0, -1, -0.35), 0.18, this.glowTex));

    return { s, hip, knee, ankle, mount };
  }

  buildTorso() {
    const M = this.mats;
    const waist = (this.waist = new THREE.Group());
    waist.position.y = 0.32;
    waist.rotation.order = 'YXZ';
    this.body.add(waist);
    place(waist, P(new THREE.CylinderGeometry(0.4, 0.46, 0.66, 14), M.joint), 0, 0.2, 0);
    // Red abdomen block (the core block hatch)
    place(waist, P(loft([{ y: 0.42, w: 0.86, d: 0.5, c: 0.12 }, { y: -0.02, w: 0.7, d: 0.42, c: 0.1 }]), M.accent,
      { pz: B.a01, all: B.redSmall }), 0, 0, 0.18);
    for (const s of [-1, 1]) place(waist, P(chamferBox(0.1, 0.3, 0.3, 0.03), M.trim), s * 0.46, 0.22, 0.22);

    const chest = (this.chest = new THREE.Group());
    chest.position.y = 0.48;
    waist.add(chest);
    // Blue chest: wide at the shoulders, narrowing at the waist
    place(chest, P(loft([
      { y: 1.12, w: 1.7, d: 1.12, c: 0.3, z: -0.04 },
      { y: 0.95, w: 2.12, d: 1.3, c: 0.32 },
      { y: 0.45, w: 2.0, d: 1.24, c: 0.3 },
      { y: 0.0, w: 1.44, d: 1.02, c: 0.24, z: 0.02 },
    ]), M.second, { all: B.plainA, x: B.sideVents }));
    // Raised chest plates holding the yellow intake vents
    for (const s of [-1, 1]) {
      place(chest, P(frontPrism(mirror([[0.1, 0], [0.82, 0], [0.92, 0.48], [0.86, 0.6], [0.16, 0.6], [0.06, 0.42]], s), 0.14, 0.04),
        M.second, { all: B.plainA }), 0, 0.42, 0.62);
      place(chest, P(frontPrism(mirror([[0.2, 0.05], [0.74, 0.05], [0.8, 0.42], [0.24, 0.48], [0.14, 0.36]], s), 0.1, 0.03),
        M.vent, { pz: B.ventFrame, all: B.plainA }), 0, 0.46, 0.7);
    }
    // Center keel and cockpit hatch seam
    place(chest, P(frontPrism([[-0.1, 0], [0.1, 0], [0.12, 0.7], [-0.12, 0.7]], 0.1, 0.03), M.second, { all: B.plainA }), 0, 0.22, 0.66);
    place(chest, P(chamferBox(0.16, 0.06, 0.04, 0.02), M.sensor), 0, 0.82, 0.72);
    // White collar with a V-notch at the front
    place(chest, P(frontPrism([[-0.78, 0], [0.78, 0], [0.62, 0.24], [0.26, 0.2], [0, 0.06], [-0.26, 0.2], [-0.62, 0.24]], 0.96, 0.04),
      M.armor, { all: B.plainB }), 0, 1.1, -0.12);

    // Shoulder weapon mounts ride on the chest, not the arms
    for (const [key, s] of [['shoulderR', -1], ['shoulderL', 1]]) {
      const m = new THREE.Group();
      m.position.set(s * 1.26, 1.2, -0.82);
      m.rotation.x = -0.1;
      chest.add(m);
      this.mounts[key] = m;
    }
  }

  buildHead() {
    const M = this.mats;
    const head = (this.head = new THREE.Group());
    head.position.set(0, 1.2, 0.04);
    head.rotation.order = 'YXZ';
    this.chest.add(head);
    place(head, P(new THREE.CylinderGeometry(0.15, 0.2, 0.3, 10), M.joint), 0, 0.02, 0);
    // Helmet
    place(head, P(loft([
      { y: 0.08, w: 0.6, d: 0.6, c: 0.14 },
      { y: 0.42, w: 0.66, d: 0.66, c: 0.16 },
      { y: 0.64, w: 0.48, d: 0.56, c: 0.14, z: -0.02 },
    ]), M.armor, { all: B.plainA }));
    // Brow ridge over the eyes
    place(head, P(frontPrism([[-0.3, 0], [0.3, 0], [0.26, 0.1], [-0.26, 0.1]], 0.1, 0.02), M.armor, { all: B.plainA }), 0, 0.42, 0.3);
    // Dark face recess with the twin eyes
    place(head, P(frontPrism([[-0.25, 0.12], [0.25, 0.12], [0.27, 0.43], [-0.27, 0.43]], 0.06, 0.01), M.joint), 0, 0, 0.31);
    for (const s of [-1, 1]) {
      const eye = place(head, new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.055, 0.03), M.eye), s * 0.115, 0.355, 0.345);
      eye.rotation.z = s * 0.24;
    }
    // Faceplate with vent slits, red chin
    place(head, P(frontPrism([[-0.17, 0.06], [0.17, 0.06], [0.21, 0.24], [0.08, 0.3], [-0.08, 0.3], [-0.21, 0.24]], 0.1, 0.02),
      M.armor, { all: B.plainA }), 0, 0, 0.34);
    for (const x of [-0.12, -0.075, 0.075, 0.12]) place(head, new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.11, 0.02), M.joint), x, 0.17, 0.4);
    place(head, P(chamferBox(0.13, 0.08, 0.1, 0.02), M.red), 0, 0.05, 0.36);
    // Forehead camera and V-fin
    place(head, P(chamferBox(0.11, 0.13, 0.1, 0.02), M.red), 0, 0.52, 0.34);
    place(head, new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 6), M.eye), 0, 0.53, 0.4);
    for (const s of [-1, 1]) {
      place(head, P(frontPrism(mirror([[0, 0], [0.08, 0.02], [0.66, 0.4], [0.64, 0.47], [0, 0.13]], s), 0.045, 0.01), M.trim), 0, 0.5, 0.36);
      // Head vulcans in the temples
      place(head, P(chamferBox(0.1, 0.12, 0.2, 0.03), M.armor, { all: B.plainA }), s * 0.3, 0.46, 0.22);
      place(head, P(cylZ(0.035, 0.035, 0.12, 8), M.joint), s * 0.3, 0.46, 0.33);
      // Ear blocks
      place(head, P(chamferBox(0.1, 0.3, 0.34, 0.04), M.armor, { all: B.plainB }), s * 0.36, 0.3, -0.02);
      place(head, P(cylX(0.08, 0.04, 10), M.trim), s * 0.42, 0.3, -0.02);
    }
    place(head, P(new THREE.CylinderGeometry(0.02, 0.03, 0.5, 6), M.joint), 0.18, 0.78, -0.25, -0.3, 0, -0.2);
  }

  buildArm(s) {
    const M = this.mats;
    const sh = new THREE.Group();
    sh.position.set(s * 1.24, 0.86, 0);
    sh.rotation.order = 'YXZ';
    this.chest.add(sh);
    place(sh, P(new THREE.SphereGeometry(0.32, 14, 10), M.joint));
    // Shoulder armor: a broad block with a sloped top and the unit number on its face
    const pauldron = new THREE.Group();
    pauldron.position.set(s * 0.24, 0.08, 0);
    sh.add(pauldron);
    place(pauldron, P(sidePrism([[-0.6, -0.42], [-0.62, 0.2], [-0.42, 0.5], [0.42, 0.5], [0.62, 0.2], [0.6, -0.42], [0.46, -0.56], [-0.46, -0.56]], 0.96, 0.07),
      M.armor, { x: B.panel07, py: B.plainA, z: B.plainB, ny: B.plainB }));
    place(pauldron, P(chamferBox(0.98, 0.1, 0.14, 0.03), M.accent, { all: B.redBar }), 0, 0.32, 0.6);

    // Short upper arm
    place(sh, P(new THREE.CylinderGeometry(0.21, 0.21, 0.6, 12), M.joint), 0, -0.4, 0);
    place(sh, P(loft([{ y: -0.42, w: 0.52, d: 0.54, c: 0.12 }, { y: -0.88, w: 0.54, d: 0.56, c: 0.13 }]), M.armor, { all: B.plainB }));

    const elbow = new THREE.Group();
    elbow.position.y = -0.98;
    sh.add(elbow);
    place(elbow, P(cylX(0.23, 0.54), M.joint));
    // Long forearm, thickest just above the wrist
    place(elbow, P(loft([
      { y: -0.06, w: 0.56, d: 0.6, c: 0.13 },
      { y: -0.75, w: 0.7, d: 0.74, c: 0.16 },
      { y: -1.08, w: 0.68, d: 0.72, c: 0.16 },
      { y: -1.18, w: 0.58, d: 0.62, c: 0.13 },
    ]), M.armor, { x: B.r07, z: B.plainB, y: B.plainA }));
    place(elbow, P(chamferBox(0.72, 0.1, 0.76, 0.03), M.trim), 0, -0.98, 0);

    const shieldMount = new THREE.Group();
    shieldMount.position.set(s * 0.42, -0.6, 0.04);
    // The shield stands upright when the forearm is level: its long axis runs along the
    // forearm's +Z and its face points outward.
    {
      const Z = new V3(s, 0, 0), Y = new V3(0, 0, 1), X = new V3().crossVectors(Y, Z);
      shieldMount.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    }
    elbow.add(shieldMount);

    const hand = new THREE.Group();
    hand.position.set(0, -1.2, 0.03);
    elbow.add(hand);
    place(hand, P(chamferBox(0.36, 0.38, 0.44, 0.07), M.joint), 0, -0.17, 0);
    place(hand, P(chamferBox(0.34, 0.18, 0.44, 0.05), M.joint), 0, -0.38, 0.06, 0.35);
    place(hand, P(chamferBox(0.11, 0.26, 0.13, 0.03), M.joint), -s * 0.18, -0.23, 0.18, 0.3);
    const mount = new THREE.Group();
    mount.position.set(0, -0.26, 0.02);
    mount.rotation.x = Math.PI / 2;
    hand.add(mount);
    return { s, sh, pauldron, elbow, hand, mount, shieldMount };
  }

  buildBackpack() {
    const M = this.mats;
    const bp = new THREE.Group();
    bp.position.set(0, 0.56, -0.62);
    this.chest.add(bp);
    this.backpack = bp;
    // Main pack
    place(bp, P(loft([
      { y: 0.66, w: 1.26, d: 0.5, c: 0.14, z: -0.2 },
      { y: 0.1, w: 1.4, d: 0.6, c: 0.16, z: -0.24 },
      { y: -0.36, w: 1.32, d: 0.56, c: 0.16, z: -0.22 },
    ]), M.armor, { nz: B.plainA, pz: B.plainA, x: B.vent, y: B.plainA }));
    // Intake grille set into the back of the pack
    place(bp, P(chamferBox(0.62, 0.5, 0.08, 0.08), M.armor, { all: B.danger }), 0, 0.22, -0.53);
    place(bp, P(chamferBox(1.0, 0.1, 0.08, 0.03), M.frame, { all: B.hazard }), 0, 0.56, -0.5);

    for (const s of [-1, 1]) {
      // Beam saber racks
      const hilt = new THREE.Group();
      hilt.position.set(s * 0.44, 0.62, -0.3);
      hilt.rotation.set(-0.38, 0, -s * 0.22);
      bp.add(hilt);
      place(hilt, P(new THREE.CylinderGeometry(0.1, 0.1, 0.24, 10), M.joint), 0, -0.02, 0);
      place(hilt, P(new THREE.CylinderGeometry(0.085, 0.085, 0.6, 10), M.armor, { all: B.plainB }), 0, 0.36, 0);
      place(hilt, P(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 10), M.red), 0, 0.68, 0);

      // Main thruster housing: an armored block bolted to the pack's lower corner
      const hx = s * 0.4;
      place(bp, P(loft([
        { y: -0.2, w: 0.56, d: 0.7, c: 0.14, z: -0.36 },
        { y: -0.62, w: 0.6, d: 0.74, c: 0.16, z: -0.42 },
        { y: -0.84, w: 0.5, d: 0.6, c: 0.14, z: -0.44 },
      ]), M.armor, { x: B.hot, nz: B.plainA, pz: B.plainA, y: B.plainA }), hx, 0, 0);
      place(bp, P(chamferBox(0.62, 0.1, 0.76, 0.04), M.joint), hx, -0.36, -0.42);
      // Gimbal mount plate on the housing's rear-lower corner
      const dir = new V3(0, -1, -0.45).normalize();
      const mountPos = new V3(hx, -0.84, -0.6);
      const plate = place(bp, P(new THREE.CylinderGeometry(0.34, 0.38, 0.12, 16), M.joint), mountPos.x, mountPos.y, mountPos.z);
      plate.quaternion.setFromUnitVectors(new V3(0, -1, 0), dir);
      // Feed line from the pack into the housing
      place(bp, P(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8), M.joint), hx + s * 0.3, -0.42, -0.62, 0.3, 0, 0);
      const main = new Thruster(bp, mountPos.clone().addScaledVector(dir, 0.02), dir, 0.44, this.glowTex, {
        actuators: [new V3(hx + 0.3, -0.7, -0.5), new V3(hx - 0.3, -0.7, -0.5), new V3(hx, -0.72, -0.82)],
      });
      this.thrusters.main.push(main);

      // Vernier pods high on the pack's outer corners
      const vx = s * 0.72;
      place(bp, P(loft([{ y: 0.5, w: 0.26, d: 0.4, c: 0.07, z: -0.3 }, { y: 0.12, w: 0.3, d: 0.46, c: 0.08, z: -0.34 }]), M.armor,
        { all: B.plainA, x: B.ventB }), vx, 0, 0);
      this.thrusters.vern.push(new Thruster(bp, new V3(vx, 0.3, -0.58), new V3(s * 0.25, 0.05, -1), 0.17, this.glowTex));
    }

    // Thruster wash light: one fixed light so shader variants never change
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

    // --- legs ---
    const pose = [];
    for (let i = 0; i < 2; i++) {
      const p = ph + (i === 1 ? 0 : Math.PI);
      let hip = -Math.sin(p) * 0.5 * g;
      let knee = 0.1 + Math.max(0, Math.cos(p)) * 0.95 * g + 0.12 * g;
      const airHip = i === 1 ? -0.55 : 0.12, airKnee = i === 1 ? 1.0 : 0.38;
      hip += (airHip - hip) * w.air;
      knee += (airKnee - knee) * w.air;
      const dHip = i === 1 ? 0.12 : 0.32, dKnee = i === 1 ? 0.55 : 0.75;
      hip += (dHip - hip) * w.dash;
      knee += (dKnee - knee) * w.dash;
      hip -= 0.6 * w.crouch;
      knee += 1.15 * w.crouch;
      let ankle = -(hip + knee);
      ankle += (0.35 - ankle) * w.air * 0.6 + w.dash * 0.25;
      pose.push({ hip, knee, ankle });
    }
    this.pelvis.rotation.y = w.legYaw;
    let height = 0;
    for (let i = 0; i < 2; i++) {
      const L = this.legs[i], q = pose[i];
      L.hip.rotation.x = q.hip;
      L.hip.rotation.z = L.s * (0.05 + 0.05 * w.air);
      L.knee.rotation.x = q.knee;
      L.ankle.rotation.x = q.ankle;
      L.ankle.rotation.z = -L.s * 0.05;
      const h = LEG.foot + LEG.thigh * Math.cos(q.hip) + LEG.shin * Math.cos(q.hip + q.knee) + LEG.hipDrop;
      height = Math.max(height, h);
      this.skirtF[i].rotation.x = Math.min(0, q.hip) * 0.85 - 0.06;
    }
    this.skirtR.rotation.x = Math.max(0, Math.max(pose[0].hip, pose[1].hip)) * 0.6 + 0.05;

    const bob = -Math.abs(Math.cos(ph)) * 0.1 * g * (1 - w.air) * (1 - w.dash);
    this.body.position.y = height + bob;
    this.body.rotation.z = Math.sin(ph) * 0.025 * g * (1 - w.air);
    this.pelvis.rotation.z = -Math.sin(ph) * 0.03 * g;

    // --- torso ---
    const idleBreath = Math.sin(t * 1.6) * 0.012;
    this.waist.rotation.y = clamp(w.twist, -1.1, 1.1) + Math.sin(ph) * 0.07 * g;
    this.waist.rotation.x = 0.06 + w.dash * 0.32 + w.crouch * 0.25 - st.aimPitch * 0.12 + idleBreath + g * 0.05;
    this.head.rotation.y = clamp((st.aimYaw - w.twist) * 0.8, -0.6, 0.6) + Math.sin(t * 0.37) * 0.04 * (1 - w.aim[0]);
    this.head.rotation.x = clamp(-st.aimPitch * 0.65, -0.5, 0.45) - (w.dash * 0.25) - this.waist.rotation.x * 0.5;

    // --- arms ---
    for (let i = 0; i < 2; i++) {
      const A = this.arms[i], s = A.s;
      const swing = -Math.sin(ph + (i === 0 ? 0 : Math.PI)) * 0.32 * g * (1 - w.dash);
      const isShield = i === 1 && st.hasShield;
      let shx = 0.12 + swing, shy = 0, shz = s * 0.1, elx = isShield ? -1.25 : -0.85;
      shx += (0.35 - shx) * w.dash * 0.8;
      shz += s * 0.25 * w.air;
      const a = w.aim[i];
      const aimX = -Math.PI / 2 - st.aimPitch - this.waist.rotation.x + 0.06;
      shx += (aimX - shx) * a;
      shy += (-s * 0.14 - shy) * a;
      shz += (s * 0.04 - shz) * a;
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
      A.pauldron.rotation.x = -shx * 0.55;
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
