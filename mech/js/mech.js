import * as THREE from './three.js';
import { B, BODY_SHEET, frontPrism, sidePrism, topPrism, chamferBox, cylZ, cylX, loft, mesh, place, canvasTexture, pieceGeo, addOutline } from './atlas.js';

const V3 = THREE.Vector3;
const P = (geo, mat, faces, opts) => mesh(geo, mat, BODY_SHEET, faces, opts);
const mirror = (pts, s) => pts.map(([x, y]) => [x * s, y]);
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Leg segment lengths (pelvis → hip joint, thigh, shin, ankle → sole).
// Long legs with a short thigh and a long shin, for a tall, hunched stance.
export const LEG = { hipDrop: 0.22, thigh: 1.8, shin: 2.6, foot: 0.55 };
// Leg splay (roll outward) and yaw (knees out), plus the idle stance's front-leg pose
const STANCE = { splay: 0.16, splayIdle: 0.14, yaw: 0.14, yawIdle: 0.14, fH: -0.66, fK: 1.22, bH: -0.16 };
const _leg = new THREE.Vector3();

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
// Geometry shaping for sharp, faceted armor
// ---------------------------------------------------------------------------

/**
 * Move every vertex through fn(v, n), where n is the vertex position normalized
 * to 0..1 inside the bounding box, then give the result flat, faceted normals.
 */
function warp(geo, fn) {
  if (geo.index) geo = geo.toNonIndexed();
  geo.computeBoundingBox();
  const bb = geo.boundingBox, size = bb.getSize(new V3());
  const p = geo.attributes.position, v = new V3(), n = new V3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    n.set((v.x - bb.min.x) / (size.x || 1), (v.y - bb.min.y) / (size.y || 1), (v.z - bb.min.z) / (size.z || 1));
    fn(v, n);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.deleteAttribute('normal');
  geo.computeVertexNormals();
  return geo;
}

/**
 * Side-profile blade ([z, y] points) extruded across X. Its thickness scales
 * from zs[0] at the back to zs[1] at the front, and ys[0] at the bottom to
 * ys[1] at the top, so edges taper to a point.
 */
function blade(pts, width, zs = [1, 1], ys = [1, 1], bevel = 0.02) {
  return warp(sidePrism(pts, width, bevel), (v, n) => {
    v.x *= (zs[0] + (zs[1] - zs[0]) * n.z) * (ys[0] + (ys[1] - ys[0]) * n.y);
  });
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
        barrel: mats.trim,
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
// Mech model, after Armored Core: a tall, hunched frame under sharp, swept
// plate armor. Low arrowhead sensor head between raised collar plates, long
// arms with heavy forearms, blade knees, thin shins and talon feet, and a
// booster pack with swept stabilizer fins.
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
    this.outlines = addOutline(this.root, 0.016);
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
    // Hip block: dark frame core on a hip axle
    place(p, P(loft([
      { y: 0.26, w: 0.84, d: 0.76, c: 0.18 },
      { y: 0.02, w: 0.98, d: 0.84, c: 0.2 },
      { y: -0.3, w: 0.5, d: 0.58, c: 0.14 },
    ]), M.second, { all: B.mechA }));
    place(p, P(cylX(0.2, 1.6), M.joint), 0, -0.16, 0);
    // Pointed codpiece and rear plate
    place(p, P(frontPrism([[-0.3, 0.16], [0.3, 0.16], [0.18, -0.2], [0, -0.46], [-0.18, -0.2]], 0.16, 0.03), M.armor, { all: B.plainA }), 0, 0, 0.42);
    place(p, P(chamferBox(0.28, 0.04, 0.05, 0.015), M.trim), 0, 0.07, 0.51);
    place(p, P(frontPrism([[-0.42, 0.2], [0.42, 0.2], [0.28, -0.32], [-0.28, -0.32]], 0.12, 0.03), M.armor, { all: B.plainA }), 0, 0, -0.44);
    // Hip blades swept back along the sides
    this.hipPads = [-1, 1].map((s) => {
      const g = new THREE.Group();
      g.position.set(s * 0.8, 0.12, -0.02);
      g.rotation.z = s * 0.16;
      p.add(g);
      place(g, P(blade([[0.36, 0.12], [-0.3, 0.2], [-1.0, -0.06], [-0.64, -0.32], [0.22, -0.48]], 0.14, [0.35, 1]), M.armor, { all: B.plainA }));
      place(g, P(chamferBox(0.05, 0.04, 0.7, 0.012), M.trim), s * 0.075, 0.1, -0.16);
      return g;
    });
  }

  buildLeg(s) {
    const M = this.mats;
    const hip = new THREE.Group();
    hip.position.set(s * 0.62, -LEG.hipDrop, 0);
    this.pelvis.add(hip);
    place(hip, P(new THREE.SphereGeometry(0.27, 16, 10), M.joint));
    place(hip, P(cylX(0.13, 0.08, 12), M.trim), s * 0.27, 0, 0);
    // Thigh: frame strut inside a shell that pinches toward the knee
    const TH = LEG.thigh;
    place(hip, P(new THREE.CylinderGeometry(0.15, 0.17, TH - 0.2, 10), M.joint), 0, -TH / 2, -0.02);
    place(hip, P(loft([
      { y: -0.12, w: 0.66, d: 0.8, c: 0.18, z: 0.02 },
      { y: -0.8, w: 0.62, d: 0.78, c: 0.18, z: 0.07 },
      { y: -TH + 0.32, w: 0.42, d: 0.5, c: 0.13, z: 0.04 },
    ]), M.second, { all: B.plainB }));
    // Outer thigh fin sweeping back past the hip, layered over a front plate
    place(hip, P(blade([[0.48, 0.02], [0.44, -0.9], [0.06, -1.42], [-0.46, -1.16], [-1.08, -0.3], [-0.56, -0.12], [-0.42, 0.04]], 0.12, [0.3, 1], [0.6, 1]), M.armor,
      { all: B.plainA }), s * 0.36, 0, 0.02);
    place(hip, P(frontPrism([[-0.26, -0.16], [0.26, -0.16], [0.24, -0.86], [0, -1.08], [-0.24, -0.86]], 0.1, 0.03), M.armor, { all: B.plainA }), 0, 0, 0.44);
    this.plate(hip, 'redPlate', 0.17, s * 0.425, -0.64, 0.08, 0, s * Math.PI / 2);

    const knee = new THREE.Group();
    knee.position.y = -TH;
    hip.add(knee);
    place(knee, P(cylX(0.24, 0.56), M.joint));
    for (const x of [-0.3, 0.3]) place(knee, P(cylX(0.13, 0.06, 10), M.trim), x, 0, 0);
    // Big knee blade jutting forward and up, and a spur raking back off the joint
    place(knee, P(blade([[0.04, -0.52], [0.48, -0.26], [0.76, 0.38], [0.58, 0.92], [0.36, 0.38], [0.1, 0.08]], 0.54, [1, 1], [1, 0.32]), M.armor,
      { all: B.plainA }));
    place(knee, P(blade([[-0.16, 0.2], [-0.98, 0.5], [-0.86, 0.32], [-0.3, -0.22]], 0.16, [0.3, 1]), M.armor, { all: B.plainA }));
    this.pistons.push(new Piston(hip, new V3(s * 0.22, -0.5, -0.3), knee, new V3(s * 0.22, -0.45, -0.32), 0.06, M));

    // Shin: long, pinched thin through the middle
    const SH = LEG.shin;
    place(knee, P(loft([
      { y: -0.02, w: 0.6, d: 0.76, c: 0.16, z: -0.08 },
      { y: -0.7, w: 0.6, d: 0.84, c: 0.17, z: -0.16 },
      { y: -1.5, w: 0.38, d: 0.48, c: 0.11, z: -0.08 },
      { y: -SH + 0.36, w: 0.32, d: 0.38, c: 0.09, z: -0.02 },
      { y: -SH + 0.08, w: 0.38, d: 0.44, c: 0.1, z: 0 },
    ]), M.second, { all: B.plainB, x: B.sideVents }));
    // Front shin blade with the tall vented panel from the sheet
    place(knee, P(blade([[0.24, -0.12], [0.46, -0.55], [0.34, -1.6], [0.18, -SH + 0.3], [0.1, -1.3], [0.1, -0.22]], 0.46, [1, 1], [0.45, 1]), M.armor,
      { all: B.plainA }));
    this.plate(knee, 'shinPlate', 0.24, 0, -1.0, 0.44, 0.1);
    // Big calf fin swept back, with the verniers tucked under its root
    place(knee, P(blade([[-0.3, -0.22], [-1.08, -0.46], [-1.12, -0.6], [-0.62, -1.18], [-0.32, -1.22]], 0.24, [0.3, 1]), M.armor, { all: B.plainA }));
    const bayY = -1.4;
    place(knee, P(chamferBox(0.34, 0.36, 0.1, 0.04), M.frame, { all: B.ventDark }), 0, bayY, -0.36);
    const calfThr = [];
    for (const x of [-0.08, 0.08]) {
      const t = new Thruster(knee, new V3(x, bayY + 0.04, -0.4), new V3(0, -0.85, -0.6), 0.1, this.glowTex);
      calfThr.push(t);
      this.thrusters.calf.push(t);
    }
    for (const [hy, open] of [[bayY + 0.2, 1.1], [bayY + 0.0, 1.5]]) {
      const pivot = new THREE.Group();
      pivot.position.set(0, hy, -0.44);
      knee.add(pivot);
      place(pivot, P(chamferBox(0.38, 0.2, 0.05, 0.03), M.armor, { all: B.plainA, nz: B.hot }), 0, -0.1, 0);
      for (const t of calfThr) t.flaps.push({ pivot, open });
    }

    const mount = new THREE.Group();
    mount.position.set(s * 0.3, -1.05, -0.06);
    mount.rotation.z = -s * Math.PI / 2;
    knee.add(mount);

    const ankle = new THREE.Group();
    ankle.position.y = -SH;
    knee.add(ankle);
    place(ankle, P(new THREE.SphereGeometry(0.2, 14, 10), M.trim));
    place(ankle, P(loft([{ y: 0.3, w: 0.42, d: 0.5, c: 0.1 }, { y: -0.1, w: 0.5, d: 0.6, c: 0.12 }]), M.second, { all: B.plainB }));
    // Talon foot: long center blade, splayed side claws and a raised heel blade
    place(ankle, P(blade([[-0.14, -0.06], [0.3, -0.12], [1.14, -0.47], [1.16, -0.55], [-0.24, -0.55]], 0.44, [1, 0.35]), M.armor,
      { all: B.plainA, y: B.plainB }));
    for (const sd of [-1, 1]) {
      const toe = place(ankle, P(blade([[0, -0.22], [0.7, -0.47], [0.72, -0.55], [0, -0.55]], 0.15, [1, 0.35]), M.second,
        { all: B.plainB }), sd * 0.22, 0, 0.1);
      toe.rotation.y = sd * 0.36;
    }
    place(ankle, P(blade([[0.04, -0.08], [-0.22, 0.08], [-0.96, -0.46], [-0.9, -0.56], [0.04, -0.55]], 0.26, [0.3, 1]), M.armor,
      { all: B.plainA }));
    place(ankle, P(chamferBox(0.48, 0.04, 1.28, 0.02), M.joint), 0, -0.535, 0.18);
    this.thrusters.sole.push(new Thruster(ankle, new V3(0, -0.36, 0.22), new V3(0, -1, -0.15), 0.15, this.glowTex));

    return { s, hip, knee, ankle, mount };
  }

  buildTorso() {
    const M = this.mats;
    const waist = (this.waist = new THREE.Group());
    waist.position.y = 0.3;
    waist.rotation.order = 'YXZ';
    this.body.add(waist);
    // Exposed spine with gold struts and a small belly plate
    place(waist, P(new THREE.CylinderGeometry(0.3, 0.36, 0.72, 12), M.joint), 0, 0.2, -0.04);
    for (const sd of [-1, 1]) place(waist, P(new THREE.CylinderGeometry(0.04, 0.04, 0.64, 8), M.trim), sd * 0.24, 0.24, 0.24, 0, 0, sd * 0.12);
    place(waist, P(loft([{ y: 0.44, w: 0.56, d: 0.26, c: 0.07, z: 0.3 }, { y: 0.02, w: 0.36, d: 0.22, c: 0.06, z: 0.27 }]), M.armor, { all: B.plainA }));

    const chest = (this.chest = new THREE.Group());
    chest.position.y = 0.5;
    waist.add(chest);
    // Core: narrow at the waist, broad and deep across the shoulders
    place(chest, P(loft([
      { y: 0.0, w: 0.96, d: 0.8, c: 0.18, z: -0.08 },
      { y: 0.55, w: 1.8, d: 1.2, c: 0.3, z: -0.1 },
      { y: 1.1, w: 2.12, d: 1.26, c: 0.32, z: -0.14 },
      { y: 1.36, w: 1.5, d: 0.96, c: 0.26, z: -0.2 },
    ]), M.second, { all: B.plainB, x: B.sideVents }));
    // Arrowhead chest plates that sweep back to the shoulders
    for (const sd of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(0, 0, 0.66);
      g.rotation.y = sd * 0.34;
      chest.add(g);
      place(g, P(frontPrism(mirror([[0.03, 0.34], [0.68, 0.48], [1.1, 0.9], [1.05, 1.28], [0.36, 1.38], [0.03, 1.2]], sd), 0.16, 0.03),
        M.armor, { all: B.plainA }));
      place(g, P(frontPrism(mirror([[0.56, 0.6], [0.98, 0.94], [0.94, 1.0], [0.52, 0.68]], sd), 0.04, 0.005), M.trim), 0, 0, 0.09);
    }
    // Center keel and a V plate pointing down to the waist
    place(chest, P(blade([[0.0, 0.32], [0.16, 0.52], [0.12, 0.98], [0.0, 1.08]], 0.14, [1, 0.5]), M.second, { all: B.plainA }), 0, 0, 0.7);
    place(chest, P(frontPrism([[-0.48, 0.42], [0.48, 0.42], [0.26, 0.02], [0, -0.3], [-0.26, 0.02]], 0.14, 0.03), M.armor, { all: B.plainA }), 0, 0, 0.6);
    place(chest, P(chamferBox(0.06, 0.06, 0.04, 0.01), M.eye), 0, 0.2, 0.68).userData.noOutline = true;
    for (const sd of [-1, 1]) {
      // Raised collar plates flanking the head
      place(chest, P(blade([[0.36, 0], [0.26, 0.24], [-0.08, 0.4], [-0.42, 0.3], [-0.4, 0]], 0.24, [1, 1], [1, 0.5]), M.armor,
        { all: B.plainA }), sd * 0.7, 1.26, -0.04);
      // Heat-sink fins on the side torso
      for (let f = 0; f < 4; f++) place(chest, P(chamferBox(0.14, 0.42, 0.03, 0.015), M.joint), sd * 0.98, 0.6, -0.18 - f * 0.08);
    }

    // Back weapon mounts sit on top of the booster pack
    for (const [key, s] of [['shoulderR', -1], ['shoulderL', 1]]) {
      const m = new THREE.Group();
      m.position.set(s * 0.84, 1.36, -0.96);
      m.rotation.x = -0.12;
      chest.add(m);
      this.mounts[key] = m;
    }
  }

  buildHead() {
    const M = this.mats;
    const head = (this.head = new THREE.Group());
    head.position.set(0, 1.36, 0.34);
    head.scale.setScalar(1.15);
    head.rotation.order = 'YXZ';
    this.chest.add(head);
    place(head, P(new THREE.CylinderGeometry(0.12, 0.16, 0.3, 10), M.joint), 0, -0.02, -0.06);
    // Helmet: a cranium that tapers to a narrower jaw, so it reads as a head
    place(head, P(loft([
      { y: 0.66, w: 0.36, d: 0.48, c: 0.12, z: -0.06 },
      { y: 0.46, w: 0.56, d: 0.64, c: 0.16, z: -0.02 },
      { y: 0.26, w: 0.52, d: 0.6, c: 0.15, z: -0.02 },
      { y: 0.06, w: 0.36, d: 0.46, c: 0.11, z: 0.0 },
    ]), M.armor, { all: B.plainA }));
    // Pointed brow that overhangs the eyes and slopes down to the front
    place(head, P(warp(topPrism([[-0.3, -0.12], [0.3, -0.12], [0.31, 0.18], [0.1, 0.36], [0, 0.42], [-0.1, 0.36], [-0.31, 0.18]], 0.1, 0.02),
      (v, n) => { v.y -= n.z * 0.06; }), M.armor, { all: B.plainA }), 0, 0.5, 0.02);
    // Dark face recess with two angled eyes under the brow
    place(head, P(frontPrism([[-0.25, 0.2], [0.25, 0.2], [0.24, 0.46], [-0.24, 0.46]], 0.06, 0.01), M.joint), 0, 0, 0.3);
    for (const sd of [-1, 1]) {
      const eye = place(head, new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.035, 0.02), M.eye), sd * 0.12, 0.385, 0.34);
      eye.rotation.set(0, sd * 0.3, sd * 0.24);
      eye.userData.noOutline = true;
    }
    // Faceplate: a nose ridge over mouth vents and a pointed chin
    place(head, P(frontPrism([[-0.2, 0.3], [0.2, 0.3], [0.22, 0.16], [0.1, -0.02], [0, -0.08], [-0.1, -0.02], [-0.22, 0.16]], 0.1, 0.02),
      M.armor, { all: B.plainB }), 0, 0, 0.3);
    place(head, P(blade([[0.0, 0.32], [0.05, 0.3], [0.04, 0.14], [0.0, 0.12]], 0.05), M.second, { all: B.plainA }), 0, 0, 0.36);
    for (const [y, w] of [[0.1, 0.22], [0.05, 0.16]]) place(head, new THREE.Mesh(new THREE.BoxGeometry(w, 0.016, 0.02), M.joint), 0, y, 0.36);
    for (const sd of [-1, 1]) {
      // Cheek guards wrapping forward along the jaw
      place(head, P(blade([[-0.22, 0.34], [0.22, 0.3], [0.32, 0.08], [0.18, -0.04], [-0.2, 0.0]], 0.05, [1, 0.6]), M.second, { all: B.plainA }),
        sd * 0.27, 0, 0).rotation.y = -sd * 0.22;
      // Ear sensors and swept rear antennas
      place(head, P(cylX(0.08, 0.12, 12), M.frame, { all: B.mechA }), sd * 0.31, 0.36, -0.08);
      place(head, new THREE.Mesh(new THREE.CircleGeometry(0.05, 12), M.lens), sd * 0.372, 0.36, -0.08, 0, sd * Math.PI / 2, 0);
      const ant = place(head, P(blade([[0.04, 0.0], [-0.62, 0.16], [-0.64, 0.12], [0.04, -0.04]], 0.03, [0.4, 1]), M.second,
        { all: B.plainA }), sd * 0.22, 0.46, -0.24);
      ant.rotation.y = sd * 0.22;
    }
    // Gold crest along the crown
    place(head, P(blade([[0.4, 0.0], [0.08, 0.1], [-0.32, 0.12], [-0.36, 0.0]], 0.05, [1, 0.5]), M.trim), 0, 0.64, -0.04);
  }

  buildArm(s) {
    const M = this.mats;
    const sh = new THREE.Group();
    sh.position.set(s * 1.32, 1.0, -0.04);
    sh.rotation.order = 'YXZ';
    this.chest.add(sh);
    place(sh, P(new THREE.SphereGeometry(0.3, 14, 10), M.joint));
    // Shoulder block with a fin sweeping up and back
    const pauldron = new THREE.Group();
    pauldron.position.set(s * 0.3, 0.12, 0);
    sh.add(pauldron);
    // Faceted dome capping the joint, with a lip that curls down in front of the arm
    const dome = warp(new THREE.SphereGeometry(1, 9, 6), (v) => {
      v.set(v.x * 0.64, v.y * 0.5, v.z * 0.8);
      if (v.y < -0.1) v.y = -0.1 + (v.y + 0.1) * 0.35;  // flatten the underside
      v.z += Math.max(0, v.y) * 0.25;                  // lean the crown forward
    });
    place(pauldron, P(dome, M.armor, { all: B.plainA }), s * 0.1, 0.06, 0);
    place(pauldron, P(blade([[0.42, 0.22], [0.86, 0.02], [0.92, -0.52], [0.7, -0.8], [0.58, -0.3], [0.3, -0.02]], 0.9, [1, 0.7], [0.6, 1]), M.armor,
      { all: B.plainA }), s * 0.12, 0, 0);
    // Layered outer plate carrying a cut-out panel from the sheet
    place(pauldron, P(blade([[0.62, -0.08], [0.32, 0.26], [-0.5, 0.2], [-0.72, -0.26], [-0.2, -0.52], [0.46, -0.56]], 0.08, [0.6, 1]), M.second,
      { all: B.plainA }), s * 0.66, -0.34, 0);
    if (s > 0) this.plate(pauldron, 'slash', 0.44, s * 0.705, -0.36, -0.02, 0, s * Math.PI / 2);
    else this.plate(pauldron, 'e07', 0.5, s * 0.705, -0.36, -0.02, 0, s * Math.PI / 2);
    // Fin rising off the back of the shoulder
    place(pauldron, P(blade([[0.0, 0.0], [-0.46, 0.3], [-1.0, 0.92], [-0.86, 0.5], [-0.36, -0.08]], 0.08, [0.4, 1]), M.armor, { all: B.plainA }),
      s * 0.18, 0.52, -0.2);
    place(pauldron, P(cylX(0.1, 0.46, 10), M.trim), s * 0.14, -0.22, 0.34);

    // Upper arm: frame strut with a light shell
    place(sh, P(new THREE.CylinderGeometry(0.15, 0.15, 0.9, 10), M.joint), 0, -0.5, 0);
    place(sh, P(loft([{ y: -0.34, w: 0.4, d: 0.46, c: 0.1 }, { y: -0.82, w: 0.44, d: 0.5, c: 0.11 }]), M.second, { all: B.plainB }), s * 0.04, 0, 0);

    const elbow = new THREE.Group();
    elbow.position.y = -1.0;
    sh.add(elbow);
    place(elbow, P(cylX(0.2, 0.48), M.joint));
    for (const x of [-0.26, 0.26]) place(elbow, P(cylX(0.11, 0.05, 10), M.trim), x, 0, 0);
    // Heavy forearm, widest at mid-length, with a guard jutting back past the elbow
    place(elbow, P(loft([
      { y: -0.04, w: 0.5, d: 0.58, c: 0.12, z: -0.02 },
      { y: -0.5, w: 0.66, d: 0.8, c: 0.16, z: 0.02 },
      { y: -1.02, w: 0.6, d: 0.72, c: 0.15, z: 0.02 },
      { y: -1.18, w: 0.46, d: 0.56, c: 0.12 },
    ]), M.armor, { all: B.plainA }));
    // Outer blade plate running the forearm's length and raking back past the elbow
    place(elbow, P(blade([[0.38, -0.12], [0.44, -0.92], [0.2, -1.18], [-0.42, -1.02], [-0.7, 0.26], [-0.34, 0.3]], 0.1, [0.5, 1]), M.armor,
      { all: B.plainA }), s * 0.36, 0, 0);
    if (s < 0) this.plate(elbow, 'r07', 0.34, s * 0.415, -0.58, 0.0, 0, s * Math.PI / 2);
    else this.plate(elbow, 'redPlate', 0.19, s * 0.415, -0.56, 0.0, 0, s * Math.PI / 2);
    // Elbow hydraulics
    this.pistons.push(new Piston(sh, new V3(0, -0.42, 0.24), elbow, new V3(0, -0.3, 0.32), 0.055, M));

    const shieldMount = new THREE.Group();
    shieldMount.position.set(s * 0.48, -0.55, 0.04);
    {
      const Z = new V3(s, 0, 0), Y = new V3(0, 0, 1), X = new V3().crossVectors(Y, Z);
      shieldMount.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    }
    shieldMount.scale.setScalar(0.8);
    elbow.add(shieldMount);

    const hand = new THREE.Group();
    hand.position.set(0, -1.24, 0.02);
    elbow.add(hand);
    place(hand, P(chamferBox(0.36, 0.38, 0.44, 0.07), M.joint), 0, -0.16, 0);
    place(hand, P(chamferBox(0.34, 0.18, 0.44, 0.05), M.joint), 0, -0.38, 0.06, 0.35);
    place(hand, P(chamferBox(0.38, 0.05, 0.1, 0.02), M.trim), 0, -0.08, 0.2);
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
    bp.position.set(0, 0.72, -0.66);
    this.chest.add(bp);
    this.backpack = bp;
    // Booster pack
    place(bp, P(loft([
      { y: 0.62, w: 1.2, d: 0.5, c: 0.14, z: -0.2 },
      { y: 0.05, w: 1.36, d: 0.62, c: 0.18, z: -0.26 },
      { y: -0.38, w: 1.1, d: 0.52, c: 0.16, z: -0.22 },
    ]), M.armor, { all: B.plainA, x: B.vent }));
    place(bp, P(chamferBox(0.54, 0.72, 0.1, 0.06), M.second, { all: B.mechA }), 0, 0.12, -0.56);
    this.plate(bp, 'hotPanel', 0.36, 0, 0.12, -0.62, 0, Math.PI);

    for (const s of [-1, 1]) {
      // Stabilizer fins sweeping back and out
      const wing = new THREE.Group();
      wing.position.set(s * 0.56, 0.3, -0.4);
      wing.rotation.set(0.2, s * 0.35, -s * 1.12);
      bp.add(wing);
      place(wing, P(blade([[0.1, 0.0], [-0.42, 0.32], [-1.5, 0.92], [-1.36, 0.58], [-0.4, -0.2]], 0.08, [0.4, 1]), M.armor, { all: B.plainA }));
      place(wing, P(blade([[-0.5, 0.2], [-1.3, 0.7], [-1.26, 0.62], [-0.5, 0.12]], 0.1, [0.5, 1]), M.trim));

      // Main thruster housing under the pack's lower corner
      const hx = s * 0.4;
      place(bp, P(loft([
        { y: -0.2, w: 0.54, d: 0.68, c: 0.14, z: -0.36 },
        { y: -0.62, w: 0.58, d: 0.72, c: 0.16, z: -0.42 },
        { y: -0.84, w: 0.48, d: 0.58, c: 0.14, z: -0.44 },
      ]), M.second, { x: B.hot, all: B.plainA }), hx, 0, 0);
      place(bp, P(chamferBox(0.6, 0.1, 0.74, 0.04), M.joint), hx, -0.36, -0.42);
      const dir = new V3(0, -1, -0.45).normalize();
      const mountPos = new V3(hx, -0.84, -0.6);
      const ring = place(bp, P(new THREE.CylinderGeometry(0.34, 0.38, 0.12, 16), M.joint), mountPos.x, mountPos.y, mountPos.z);
      ring.quaternion.setFromUnitVectors(new V3(0, -1, 0), dir);
      place(bp, P(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8), M.trim), hx + s * 0.3, -0.42, -0.62, 0.3, 0, 0);
      this.thrusters.main.push(new Thruster(bp, mountPos.clone().addScaledVector(dir, 0.02), dir, 0.44, this.glowTex, {
        actuators: [new V3(hx + 0.3, -0.7, -0.5), new V3(hx - 0.3, -0.7, -0.5), new V3(hx, -0.72, -0.82)],
      }));

      // Vernier pods on the pack's outer corners
      const vx = s * 0.72;
      place(bp, P(loft([{ y: 0.4, w: 0.24, d: 0.42, c: 0.07, z: -0.3 }, { y: 0.02, w: 0.28, d: 0.48, c: 0.08, z: -0.34 }]), M.second,
        { all: B.plainA, x: B.ventB }), vx, 0, 0);
      this.thrusters.vern.push(new Thruster(bp, new V3(vx, 0.2, -0.6), new V3(s * 0.25, 0.05, -1), 0.16, this.glowTex));
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

  legPose(L, hip, knee, splay, yaw) {
    L.hip.rotation.set(hip, L.s * yaw, L.s * splay);
    L.knee.rotation.x = knee;
  }

  /** How far below the body origin a leg's ankle sits, through the real joint transforms. */
  drop(L) {
    L.knee.updateMatrix(); L.hip.updateMatrix(); this.pelvis.updateMatrix();
    _leg.copy(L.ankle.position).applyMatrix4(L.knee.matrix).applyMatrix4(L.hip.matrix).applyMatrix4(this.pelvis.matrix);
    return -_leg.y;
  }

  /** Back-knee angle that puts both feet on the ground in the idle stance. */
  solveIdleKnee() {
    const F = this.legs[1], K = this.legs[0];
    const splay = STANCE.splay + STANCE.splayIdle, yaw = STANCE.yaw + STANCE.yawIdle;
    this.pelvis.rotation.set(0, 0, 0);
    this.legPose(F, STANCE.fH, STANCE.fK, splay, yaw);
    const target = this.drop(F);
    let lo = 0, hi = 2.6;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      this.legPose(K, STANCE.bH, mid, splay, yaw);
      if (this.drop(K) > target) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

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

    // --- legs ---
    // Wide, splayed stance: thighs angle out, knees point outward, and the knees
    // stay bent so the long legs carry the body low and coiled.
    const splay = STANCE.splay + STANCE.splayIdle * idle + 0.04 * w.air;
    const yaw = STANCE.yaw + STANCE.yawIdle * idle;
    if (this.idleBackKnee == null) this.idleBackKnee = this.solveIdleKnee();
    const pose = [];
    for (let i = 0; i < 2; i++) {
      const p = ph + (i === 1 ? 0 : Math.PI);
      let hip = -0.3 - Math.sin(p) * 0.55 * g;
      let knee = 0.66 + Math.max(0, Math.cos(p)) * 0.9 * g;
      const airHip = i === 1 ? -0.8 : -0.05, airKnee = i === 1 ? 1.3 : 0.65;
      hip += (airHip - hip) * w.air;
      knee += (airKnee - knee) * w.air;
      const dHip = i === 1 ? -0.05 : 0.2, dKnee = i === 1 ? 0.9 : 1.0;
      hip += (dHip - hip) * w.dash;
      knee += (dKnee - knee) * w.dash;
      hip -= 0.6 * w.crouch;
      knee += 1.15 * w.crouch;
      pose.push({ hip, knee });
    }
    // Idle: staggered stance, left foot forward, back knee solved so both feet stay planted
    pose[1].hip += (STANCE.fH - pose[1].hip) * idle; pose[1].knee += (STANCE.fK - pose[1].knee) * idle;
    pose[0].hip += (STANCE.bH - pose[0].hip) * idle; pose[0].knee += (this.idleBackKnee - pose[0].knee) * idle;
    this.pelvis.rotation.y = w.legYaw - 0.22 * idle;
    this.pelvis.rotation.z = -Math.sin(ph) * 0.035 * g;
    let height = 0;
    for (let i = 0; i < 2; i++) {
      const L = this.legs[i], q = pose[i];
      this.legPose(L, q.hip, q.knee, splay, yaw);
      L.ankle.rotation.set(-(q.hip + q.knee) + (0.4 + (q.hip + q.knee)) * w.air * 0.6 + w.dash * 0.25, -L.s * yaw * 0.6, -L.s * splay);
      height = Math.max(height, this.drop(L) + LEG.foot);
      this.hipPads[i].rotation.x = Math.min(0, q.hip) * 0.45;
    }

    const breath = Math.sin(t * 1.5);
    const bob = -Math.abs(Math.cos(ph)) * 0.11 * g * (1 - w.air) * (1 - w.dash) + breath * 0.015 * idle;
    this.body.position.y = height + bob;
    this.body.rotation.z = Math.sin(ph) * 0.03 * g * (1 - w.air) + 0.03 * idle;

    // --- torso ---
    // Hunched forward over the hips, more so when idle
    this.waist.rotation.y = clamp(w.twist, -1.1, 1.1) + Math.sin(ph) * 0.08 * g + 0.16 * idle;
    this.waist.rotation.x = 0.26 + w.dash * 0.3 + w.crouch * 0.25 - st.aimPitch * 0.12 + breath * 0.012 + g * 0.06 + 0.14 * idle;
    this.waist.rotation.z = -0.03 * idle;
    const sweep = Math.pow(Math.sin(t * 0.42), 5) * 0.5 * idle * (1 - w.aim[0]);
    this.head.rotation.y = clamp((st.aimYaw - w.twist) * 0.8, -0.6, 0.6) - 0.12 * idle + sweep;
    this.head.rotation.x = clamp(-st.aimPitch * 0.65, -0.5, 0.45) - (w.dash * 0.25) - this.waist.rotation.x * 0.7 + 0.08 * idle;
    this.head.rotation.z = 0.04 * idle;

    // --- arms ---
    for (let i = 0; i < 2; i++) {
      const A = this.arms[i], s = A.s;
      const swing = -Math.sin(ph + (i === 0 ? 0 : Math.PI)) * 0.32 * g * (1 - w.dash);
      const isShield = i === 1 && st.hasShield;
      let shx = 0.05 + swing, shy = 0, shz = s * (0.2 + 0.16 * idle), elx = isShield ? -1.2 : -0.75;
      // Idle: rifle at low ready across the body; shield arm in a guard
      if (isShield) {
        shx += (-0.42 - shx) * idle; shy += (-s * 0.12 - shy) * idle; elx += (-1.15 - elx) * idle;
      } else {
        shx += (-0.5 - shx) * idle; shy += (-s * 0.34 - shy) * idle; elx += (-0.9 - elx) * idle;
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
      A.pauldron.rotation.x = -shx * 0.4;
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
