import * as THREE from './three.js';
import { B, BODY_SHEET, frontPrism, sidePrism, chamferBox, cylZ, cylX, mesh, place } from './atlas.js';

const V3 = THREE.Vector3;
const P = (geo, mat, faces, opts) => mesh(geo, mat, BODY_SHEET, faces, opts);
const mirror = (pts, s) => pts.map(([x, y]) => [x * s, y]);
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Leg segment lengths (pelvis → hip joint, thigh, shin, ankle → sole)
export const LEG = { hipDrop: 0.18, thigh: 1.85, shin: 1.85, foot: 0.56 };

// ---------------------------------------------------------------------------
// Thruster: nozzle bell, two nested flame cones and a glow sprite
// ---------------------------------------------------------------------------

const FLAME_VERT = /* glsl */`
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

const FLAME_FRAG = /* glsl */`
uniform float uTime;
uniform float uPower;
uniform float uSeed;
uniform vec3 uCore;
uniform vec3 uMid;
uniform vec3 uEdge;
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
  float fres = abs(dot(vN, vV));
  float n = noise(vec2(vUv.x * 7.0 + uSeed, t * 5.0 - uTime * 22.0));
  float n2 = noise(vec2(vUv.x * 13.0 - uSeed, t * 9.0 - uTime * 31.0));
  float body = pow(fres, 1.6) * pow(1.0 - t, 1.3);
  float diamonds = 0.75 + 0.25 * sin(t * 34.0 - uTime * 6.0);
  float a = body * (0.55 + 0.45 * n + 0.25 * n2) * diamonds * uPower;
  vec3 col = mix(uCore, uMid, smoothstep(0.0, 0.3, t));
  col = mix(col, uEdge, smoothstep(0.35, 1.0, t));
  gl_FragColor = vec4(col * a * 2.2, 1.0);
}`;

let flameGeoOuter, flameGeoCore, nozzleGeo, glowMat;

export class Thruster {
  constructor(parent, mats, pos, dir, size, glowTex) {
    this.size = size;
    this.level = 0;
    this.seed = Math.random() * 100;
    const g = (this.group = new THREE.Group());
    g.position.copy(pos);
    g.quaternion.setFromUnitVectors(new V3(0, -1, 0), dir.clone().normalize());
    parent.add(g);

    if (!nozzleGeo) {
      const prof = [[0.42, 0.04], [0.5, 0.0], [0.6, -0.3], [0.78, -0.66], [0.72, -0.7], [0.56, -0.36], [0.44, -0.06], [0.38, 0.04]];
      nozzleGeo = new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 18);
      flameGeoOuter = new THREE.CylinderGeometry(0.62, 0.06, 1, 18, 1, true).translate(0, -0.5, 0);
      flameGeoCore = new THREE.CylinderGeometry(0.36, 0.02, 1, 14, 1, true).translate(0, -0.5, 0);
      glowMat = new THREE.SpriteMaterial({
        map: glowTex, color: 0x9fd0ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false,
      });
    }
    const noz = new THREE.Mesh(nozzleGeo, mats.nozzle);
    noz.scale.setScalar(size);
    noz.castShadow = true;
    g.add(noz);
    // Hot throat
    const throatMat = new THREE.MeshBasicMaterial({ color: 0xffb070, toneMapped: false, transparent: true, opacity: 0.3 });
    const throat = new THREE.Mesh(new THREE.CircleGeometry(0.42 * size, 16), throatMat);
    throat.rotation.x = Math.PI / 2;
    throat.position.y = -0.02 * size;
    g.add(throat);
    this.throat = throat;

    const mk = (geo, core, mid, edge) => {
      const m = new THREE.ShaderMaterial({
        vertexShader: FLAME_VERT,
        fragmentShader: FLAME_FRAG,
        uniforms: {
          uTime: { value: 0 }, uPower: { value: 0 }, uSeed: { value: this.seed },
          uCore: { value: new THREE.Color(core) }, uMid: { value: new THREE.Color(mid) }, uEdge: { value: new THREE.Color(edge) },
        },
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      });
      const f = new THREE.Mesh(geo, m);
      f.position.y = -0.62 * size;
      f.renderOrder = 5;
      f.frustumCulled = false;
      g.add(f);
      return f;
    };
    this.outer = mk(flameGeoOuter, 0xd8ecff, 0x4f8dff, 0x7a3cff);
    this.core = mk(flameGeoCore, 0xffffff, 0xcfe6ff, 0x6fa8ff);
    this.glow = new THREE.Sprite(glowMat.clone());
    this.glow.position.y = -0.8 * size;
    this.glow.renderOrder = 6;
    g.add(this.glow);
    this.set(0, 0);
  }

  set(level, time) {
    this.level = level;
    const on = level > 0.01;
    this.outer.visible = this.core.visible = this.glow.visible = on;
    this.throat.material.opacity = 0.15 + 0.85 * Math.min(1, level * 1.5);
    if (!on) return;
    const s = this.size;
    const flick = 0.85 + Math.random() * 0.3;
    const len = s * (0.8 + 7.5 * level) * flick;
    const wid = s * (0.85 + 0.35 * level);
    this.outer.scale.set(wid, len, wid);
    this.core.scale.set(wid, len * 0.55, wid);
    for (const f of [this.outer, this.core]) {
      f.material.uniforms.uTime.value = time;
      f.material.uniforms.uPower.value = Math.min(1.2, 0.35 + level);
    }
    this.glow.scale.setScalar(s * (1.6 + 4.5 * level) * flick);
    this.glow.material.opacity = Math.min(1, level * 1.3);
  }

  worldExhaust(pos, dir) {
    this.glow.getWorldPosition(pos);
    dir.set(0, -1, 0).applyQuaternion(this.group.getWorldQuaternion(new THREE.Quaternion()));
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
    place(p, P(frontPrism([[-0.56, 0.22], [0.56, 0.22], [0.44, -0.3], [0.15, -0.56], [-0.15, -0.56], [-0.44, -0.3]], 0.95, 0.05),
      M.armor, { pz: B.plainA, nz: B.plainA, all: B.plainB }));
    place(p, P(frontPrism([[-0.21, 0.12], [0.21, 0.12], [0.1, -0.42], [-0.1, -0.42]], 0.18, 0.03), M.accent, { all: B.redSmall }), 0, -0.04, 0.5);
    place(p, P(chamferBox(0.46, 0.1, 0.12, 0.03), M.trim), 0, 0.15, 0.52);
    place(p, P(cylX(0.27, 1.3), M.joint), 0, -0.14, 0);

    // Front skirt plates swing with the thighs
    this.skirtF = [-1, 1].map((s) => {
      const g = new THREE.Group();
      g.position.set(s * 0.43, 0.14, 0.5);
      p.add(g);
      place(g, P(frontPrism(mirror([[-0.3, 0], [0.3, 0], [0.32, -1.05], [-0.2, -0.95]], -s), 0.12, 0.03),
        M.armor, { pz: B.noStep, nz: B.plainA, all: B.plainB }), 0, 0, 0.02);
      place(g, P(chamferBox(0.08, 0.7, 0.05, 0.02), M.trim), s * 0.2, -0.45, 0.09);
      return g;
    });
    // Side skirts
    this.skirtS = [-1, 1].map((s) => {
      const g = new THREE.Group();
      g.position.set(s * 0.73, 0.16, 0);
      g.rotation.z = s * 0.12;
      p.add(g);
      place(g, P(sidePrism([[-0.46, 0], [0.46, 0], [0.38, -0.92], [-0.38, -0.92]], 0.14, 0.03),
        M.armor, { x: B.e07, all: B.plainB }));
      return g;
    });
    // Rear skirt
    const r = new THREE.Group();
    r.position.set(0, 0.12, -0.5);
    p.add(r);
    place(r, P(frontPrism([[-0.55, 0], [0.55, 0], [0.45, -0.82], [-0.45, -0.82]], 0.14, 0.03),
      M.armor, { nz: B.plainA, all: B.plainB }));
    this.skirtR = r;
  }

  buildLeg(s) {
    const M = this.mats;
    const hip = new THREE.Group();
    hip.position.set(s * 0.5, -LEG.hipDrop, 0);
    this.pelvis.add(hip);
    place(hip, P(new THREE.SphereGeometry(0.28, 16, 10), M.joint));
    place(hip, P(new THREE.CylinderGeometry(0.2, 0.2, 1.6, 12), M.joint), 0, -0.9, 0);
    place(hip, P(sidePrism([[0.36, -0.25], [0.4, -1.2], [0.3, -1.55], [-0.3, -1.55], [-0.38, -1.1], [-0.34, -0.25]], 0.64, 0.05), M.armor,
      { pz: B.longSlash, nz: B.plainA, x: B.plainB, y: B.plainA }), 0, 0, 0.02);
    place(hip, P(chamferBox(0.64, 0.12, 0.74, 0.04), M.joint), 0, -0.2, 0.03);

    const knee = new THREE.Group();
    knee.position.y = -LEG.thigh;
    hip.add(knee);
    place(knee, P(cylX(0.27, 0.64), M.joint));
    // Knee armor
    place(knee, P(sidePrism([[0.16, 0.44], [0.52, 0.2], [0.58, -0.42], [0.34, -0.64], [0.14, -0.24]], 0.62, 0.05),
      M.armor, { pz: B.arrowPanel, all: B.plainA }));
    // Shin: wide calf at the back for the thruster housing
    place(knee, P(sidePrism([[0.2, 0.0], [0.38, -0.28], [0.46, -1.2], [0.44, -1.8], [-0.36, -1.8],
      [-0.56, -0.95], [-0.46, -0.2], [-0.16, 0.02]], 0.86, 0.05),
    M.armor, { pz: B.e07, nz: B.hot, x: B.sideVents, y: B.plainA }));
    place(knee, P(chamferBox(0.88, 0.12, 0.6, 0.03), M.accent, { all: B.redBar }), 0, -1.5, 0.18);
    // Hazard tape on the calf
    place(knee, P(chamferBox(0.5, 0.12, 0.04, 0.01), M.frame, { all: B.hazard }), 0, -0.3, -0.47, -0.35);

    this.thrusters.calf.push(new Thruster(knee, M, new V3(0, -1.3, -0.5), new V3(0, -0.55, -1), 0.32, this.glowTex));

    const mount = new THREE.Group();
    mount.position.set(s * 0.46, -0.95, 0.02);
    mount.rotation.z = -s * Math.PI / 2;
    knee.add(mount);

    const ankle = new THREE.Group();
    ankle.position.y = -LEG.shin;
    knee.add(ankle);
    place(ankle, P(new THREE.SphereGeometry(0.22, 14, 10), M.joint));
    place(ankle, P(sidePrism([[-0.46, -0.06], [0.3, -0.06], [0.86, -0.3], [0.98, -0.47], [0.98, -0.53],
      [-0.52, -0.53], [-0.56, -0.26]], 0.7, 0.04),
    M.armor, { py: B.footPanel, pz: B.plainB, x: B.footPanel, ny: B.greyPlate }));
    place(ankle, P(chamferBox(0.74, 0.08, 1.56, 0.04), M.joint), 0, -0.53, 0.21);
    place(ankle, P(chamferBox(0.32, 0.15, 0.22, 0.04), M.red), 0, -0.34, 0.9);
    this.thrusters.sole.push(new Thruster(ankle, M, new V3(0, -0.5, -0.14), new V3(0, -1, -0.15), 0.22, this.glowTex));

    return { s, hip, knee, ankle, mount };
  }

  buildTorso() {
    const M = this.mats;
    const waist = (this.waist = new THREE.Group());
    waist.position.y = 0.3;
    waist.rotation.order = 'YXZ';
    this.body.add(waist);
    place(waist, P(new THREE.CylinderGeometry(0.34, 0.42, 0.6, 14), M.joint), 0, 0.15, 0);
    place(waist, P(chamferBox(0.62, 0.42, 0.34, 0.08), M.accent, { pz: B.a01, all: B.redSmall }), 0, 0.18, 0.26);
    place(waist, P(chamferBox(0.86, 0.22, 0.76, 0.06), M.frame, { all: B.mechA }), 0, 0.0, -0.05);

    const chest = (this.chest = new THREE.Group());
    chest.position.y = 0.45;
    waist.add(chest);
    place(chest, P(frontPrism([[-0.6, 0], [0.6, 0], [0.98, 0.5], [1.02, 0.96], [0.56, 1.1], [-0.56, 1.1],
      [-1.02, 0.96], [-0.98, 0.5]], 1.24, 0.07), M.second, { pz: B.plainA, nz: B.plainA, x: B.sideVents, y: B.plainB }));
    // Yellow chest vents
    for (const s of [-1, 1]) {
      place(chest, P(frontPrism(mirror([[0.12, 0], [0.62, 0], [0.7, 0.36], [0.2, 0.42], [0.08, 0.3]], s), 0.14, 0.04),
        M.vent, { pz: B.ventFrame, all: B.plainA }), 0, 0.56, 0.6);
    }
    // Cockpit hatch
    place(chest, P(chamferBox(0.56, 0.4, 0.12, 0.09), M.armor, { pz: B.plainB, all: B.plainA }), 0, 0.26, 0.64);
    place(chest, P(chamferBox(0.36, 0.06, 0.04, 0.02), M.trim), 0, 0.2, 0.71);
    place(chest, P(chamferBox(0.18, 0.07, 0.05, 0.02), M.sensor), 0, 0.5, 0.66);
    // Collar
    place(chest, P(frontPrism([[-0.62, 0], [0.62, 0], [0.48, 0.2], [-0.48, 0.2]], 0.8, 0.04),
      M.armor, { all: B.plainB }), 0, 1.04, -0.18);

    // Head
    const head = (this.head = new THREE.Group());
    head.position.set(0, 1.12, 0.02);
    head.scale.setScalar(0.92);
    head.rotation.order = 'YXZ';
    chest.add(head);
    place(head, P(new THREE.CylinderGeometry(0.16, 0.2, 0.3, 10), M.joint), 0, 0.02, 0);
    place(head, P(frontPrism([[-0.3, 0], [0.3, 0], [0.34, 0.32], [0.26, 0.58], [-0.26, 0.58], [-0.34, 0.32]], 0.66, 0.05),
      M.armor, { all: B.plainA }), 0, 0.1, 0);
    place(head, P(frontPrism([[-0.17, 0], [0.17, 0], [0.22, 0.22], [-0.22, 0.22]], 0.12, 0.02), M.armor, { all: B.plainA }), 0, 0.1, 0.32);
    place(head, P(new THREE.BoxGeometry(0.5, 0.15, 0.03), M.joint), 0, 0.38, 0.33);
    for (const s of [-1, 1]) {
      const eye = place(head, new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.06, 0.04), M.eye), s * 0.11, 0.38, 0.345);
      eye.rotation.z = s * 0.22;
      // V-fin
      place(head, P(frontPrism(mirror([[0, 0], [0.07, 0.03], [0.64, 0.38], [0.62, 0.45], [0, 0.12]], s), 0.045, 0.01), M.trim), 0, 0.5, 0.35);
      place(head, P(cylZ(0.045, 0.045, 0.16, 8), M.joint), s * 0.31, 0.47, 0.27);
      place(head, P(chamferBox(0.1, 0.28, 0.34, 0.03), M.armor, { all: B.plainB }), s * 0.36, 0.3, 0);
    }
    place(head, P(chamferBox(0.12, 0.1, 0.1, 0.02), M.red), 0, 0.12, 0.38);
    place(head, P(chamferBox(0.11, 0.13, 0.1, 0.02), M.red), 0, 0.52, 0.34);
    place(head, new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), M.eye), 0, 0.53, 0.4);
    place(head, P(new THREE.CylinderGeometry(0.02, 0.03, 0.5, 6), M.joint), 0.18, 0.75, -0.25, -0.3, 0, -0.2);

    // Shoulder weapon mounts ride on the chest, not the arms
    for (const [key, s] of [['shoulderR', -1], ['shoulderL', 1]]) {
      const m = new THREE.Group();
      m.position.set(s * 1.2, 1.25, -0.78);
      m.rotation.x = -0.1;
      chest.add(m);
      this.mounts[key] = m;
    }
  }

  buildArm(s) {
    const M = this.mats;
    const sh = new THREE.Group();
    sh.position.set(s * 1.28, 0.84, 0);
    sh.rotation.order = 'YXZ';
    this.chest.add(sh);
    place(sh, P(new THREE.SphereGeometry(0.3, 14, 10), M.joint));
    const pauldron = new THREE.Group();
    pauldron.position.set(s * 0.2, 0.1, 0);
    sh.add(pauldron);
    place(pauldron, P(sidePrism([[-0.56, -0.28], [-0.56, 0.2], [-0.36, 0.44], [0.36, 0.44], [0.56, 0.2],
      [0.56, -0.28], [0.42, -0.42], [-0.42, -0.42]], 0.88, 0.06), M.armor,
    { x: B.panel07, py: B.plainA, z: B.plainB, ny: B.plainB }));
    place(pauldron, P(chamferBox(0.9, 0.1, 0.12, 0.03), M.accent, { all: B.redBar }), 0, 0.32, 0.55);
    place(pauldron, P(chamferBox(0.9, 0.08, 0.12, 0.03), M.trim), 0, -0.3, 0.52);

    place(sh, P(new THREE.CylinderGeometry(0.2, 0.2, 0.6, 12), M.joint), 0, -0.35, 0);
    place(sh, P(chamferBox(0.48, 0.66, 0.52, 0.1), M.armor, { all: B.plainB, x: B.plainA }), 0, -0.72, 0);

    const elbow = new THREE.Group();
    elbow.position.y = -1.08;
    sh.add(elbow);
    place(elbow, P(cylX(0.22, 0.52), M.joint));
    place(elbow, P(sidePrism([[0.26, -0.05], [0.33, -0.86], [0.27, -1.02], [-0.27, -1.02], [-0.33, -0.84], [-0.26, -0.05]], 0.62, 0.05),
      M.armor, { x: B.r07, z: B.plainB, y: B.plainA }));
    place(elbow, P(chamferBox(0.66, 0.1, 0.7, 0.03), M.accent, { all: B.redBar }), 0, -0.9, 0);

    const shieldMount = new THREE.Group();
    shieldMount.position.set(s * 0.36, -0.5, 0.04);
    shieldMount.rotation.y = s * Math.PI / 2;
    elbow.add(shieldMount);

    const hand = new THREE.Group();
    hand.position.set(0, -1.12, 0.03);
    elbow.add(hand);
    place(hand, P(chamferBox(0.32, 0.36, 0.42, 0.06), M.joint), 0, -0.16, 0);
    place(hand, P(chamferBox(0.3, 0.17, 0.42, 0.04), M.joint), 0, -0.36, 0.06, 0.35);
    place(hand, P(chamferBox(0.1, 0.24, 0.12, 0.03), M.joint), -s * 0.16, -0.22, 0.18, 0.3);
    const mount = new THREE.Group();
    mount.position.set(0, -0.24, 0.02);
    mount.rotation.x = Math.PI / 2;
    hand.add(mount);
    return { s, sh, pauldron, elbow, hand, mount, shieldMount };
  }

  buildBackpack() {
    const M = this.mats;
    const bp = new THREE.Group();
    bp.position.set(0, 0.78, -0.72);
    this.chest.add(bp);
    this.backpack = bp;
    place(bp, P(chamferBox(1.24, 1.16, 0.62, 0.16), M.armor, { nz: B.intake, pz: B.plainA, x: B.vent, y: B.plainA }), 0, 0, -0.2);
    place(bp, P(chamferBox(0.9, 0.3, 0.3, 0.05), M.frame, { all: B.mechA }), 0, -0.68, -0.25);
    for (const s of [-1, 1]) {
      const hilt = new THREE.Group();
      hilt.position.set(s * 0.42, 0.62, -0.32);
      hilt.rotation.set(-0.35, 0, -s * 0.22);
      bp.add(hilt);
      place(hilt, P(new THREE.CylinderGeometry(0.09, 0.09, 0.62, 10), M.armor, { all: B.plainB }), 0, 0.2, 0);
      place(hilt, P(new THREE.CylinderGeometry(0.1, 0.1, 0.1, 10), M.red), 0, 0.5, 0);
      this.thrusters.main.push(new Thruster(bp, M, new V3(s * 0.36, -0.5, -0.5), new V3(0, -0.42, -1), 0.56, this.glowTex));
      this.thrusters.vern.push(new Thruster(bp, M, new V3(s * 0.66, 0.36, -0.36), new V3(s * 0.35, 0.15, -1), 0.24, this.glowTex));
    }
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
      // walk
      let hip = -Math.sin(p) * 0.52 * g;
      let knee = 0.1 + Math.max(0, Math.cos(p)) * 0.95 * g + 0.12 * g;
      // airborne: tuck one leg
      const airHip = i === 1 ? -0.55 : 0.12, airKnee = i === 1 ? 1.0 : 0.38;
      hip += (airHip - hip) * w.air;
      knee += (airKnee - knee) * w.air;
      // dash: legs trail, skating stance
      const dHip = i === 1 ? 0.12 : 0.32, dKnee = i === 1 ? 0.55 : 0.75;
      hip += (dHip - hip) * w.dash;
      knee += (dKnee - knee) * w.dash;
      // crouch
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
      L.hip.rotation.z = L.s * (0.04 + 0.05 * w.air);
      L.knee.rotation.x = q.knee;
      L.ankle.rotation.x = q.ankle;
      const h = LEG.foot + LEG.thigh * Math.cos(q.hip) + LEG.shin * Math.cos(q.hip + q.knee) + LEG.hipDrop;
      height = Math.max(height, h);
      this.skirtF[i].rotation.x = Math.min(0, q.hip) * 0.85 - 0.06;
    }
    this.skirtR.rotation.x = Math.max(0, Math.max(pose[0].hip, pose[1].hip)) * 0.6 + 0.05;

    // Bob and sway
    const bob = -Math.abs(Math.cos(ph)) * 0.1 * g * (1 - w.air) * (1 - w.dash);
    this.body.position.y = height + bob;
    this.body.rotation.z = Math.sin(ph) * 0.025 * g * (1 - w.air);
    this.pelvis.rotation.z = -Math.sin(ph) * 0.03 * g;

    // --- torso ---
    const idleBreath = Math.sin(t * 1.6) * 0.012;
    this.waist.rotation.y = clamp(w.twist, -1.1, 1.1) + Math.sin(ph) * 0.07 * g;
    this.waist.rotation.x = 0.06 + w.dash * 0.32 + w.crouch * 0.25 - st.aimPitch * 0.12 + idleBreath + g * 0.05;
    this.chest.rotation.y = 0;
    this.head.rotation.y = clamp((st.aimYaw - w.twist) * 0.8, -0.6, 0.6) + Math.sin(t * 0.37) * 0.04 * (1 - w.aim[0]);
    this.head.rotation.x = clamp(-st.aimPitch * 0.65, -0.5, 0.45) - (w.dash * 0.25) - this.waist.rotation.x * 0.5;

    // --- arms ---
    for (let i = 0; i < 2; i++) {
      const A = this.arms[i], s = A.s;
      const swing = -Math.sin(ph + (i === 0 ? 0 : Math.PI)) * 0.32 * g * (1 - w.dash);
      const isShield = i === 1 && st.hasShield;
      // Idle / walking pose (weapon held at low ready)
      let shx = 0.12 + swing, shy = 0, shz = s * 0.1, elx = isShield ? -1.25 : -0.85;
      // Air/dash: arms flare back
      shx += (0.35 - shx) * w.dash * 0.8;
      shz += s * 0.25 * w.air;
      // Aim: raise arm toward the crosshair
      const a = w.aim[i];
      const aimX = -Math.PI / 2 - st.aimPitch - this.waist.rotation.x + 0.06;
      shx += (aimX - shx) * a;
      shy += (-s * 0.14 - shy) * a;
      shz += (s * 0.04 - shz) * a;
      elx += (-0.12 - elx) * a;
      // Shield block
      if (isShield) {
        const b = w.shield;
        shx += (-1.05 - shx) * b;
        shy += (-s * 0.75 - shy) * b;
        elx += (-1.45 - elx) * b;
      }
      // Reload: arm dips and forearm rises
      const r = w.reload[i];
      shx += (0.15 - shx) * r;
      elx += (-1.7 - elx) * r;
      // Recoil kick
      shx -= w.recoil[i] * 0.22;
      elx -= w.recoil[i] * 0.4;
      A.sh.rotation.set(shx, shy, shz);
      A.elbow.rotation.x = elx;
      A.hand.rotation.x = -0.05 + w.recoil[i] * 0.15;
      A.pauldron.rotation.x = -shx * 0.55;
    }

    // --- thrusters ---
    const T = this.thrusters, th = st.thrust;
    for (const x of T.main) x.set(th.main, t);
    for (const x of T.vern) x.set(th.vern, t);
    for (const x of T.calf) x.set(th.calf, t);
    for (const x of T.sole) x.set(th.sole, t);

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
